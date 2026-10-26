import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EditResponse, EditSettings, Render, Template } from '@maquina/contratos';
import type { Creative, Prisma, VideoFormat } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CreativeStateMachine, assertNotAutoPiece, assertState, invalidState, pickEvent } from '../criativos/state-machine';
import { CreativeViews, currentScenes, editSettingsOf } from '../criativos/views';
import { EventosService } from '../eventos/eventos.service';
import { PrismaService } from '../prisma/prisma.service';
import { mergeEngineWords, remixKeepInput } from './remix-keep';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { editMapOf, transcriptOf } from '../campeoes/champion-views';
import type { EditDoc, EditMap, ScratchSource, TranscriptWord } from '@maquina/contratos';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** §13.6: template que reaproveita o vídeo do campeão (manter a edição). */
export const REMIX_KEEP_TEMPLATE = 'remix-keep';
import {
  RenderError, RenderThrottledError, type RenderImpl, type RenderInput, type RenderKind, type RenderPort, type RenderResult, type RenderSnapshot,
  type RenderSubmission, type ScratchRenderInput,
} from '../render/contrato';
import { RENDER_PORTS } from '../render/render.module';
import type { RenderPorts } from '../render/portas';
import { decidirWebhook, lambdaConfig, prazoEstourado, type LambdaConfig } from '../render/lambda';
import { UpdateEditDto } from './edicao.dto';
import { normalizarDoc, resolverProps } from '@maquina/video';
import { EDITABLE, aplicarMudancaDeSettings, definidos, cenaPronta, docJson, editDocOf, montarScratchSource } from './editor-doc';
import { EditorSaves, anunciarEdicao } from './editor-saves';
import { integracoesMode } from '../integracoes';
import { computeAdName, isAdNameConflict } from '../biblioteca/ad-names';
import { AUTO_EDIT_BUILDER, type AutoEditBuilder, type AutoEditContext } from './auto-edit-input';
import { AUTO_EDIT_TEMPLATE, frameTemplateOf, mockRenderFail, pieceOutcome, primaryFormatOf } from './pecas';
import { FRAME_BUILDER, frameSpecOf, type FrameBuilder } from './frame-input';
import { capturaValida } from './captura-valida';
import { HEADLINE_BUILDER, type HeadlineBuilder } from './headline-input';
import { paletaDoEstatico } from '../iteracao/paleta';
import type { CaptionsAuto } from '@maquina/video';
import { SegundaFonteService, precisaSegundaFonte } from './segunda-fonte';
import { blocksOf } from '../iteracao/contexto';
import type { AutoVariationType } from '@maquina/contratos';

/** Código de falha de um formato da peça AUTO (variacao-auto-v1 §5.3; rev. 23/10 §14.3: os da imagem do STATIC). */
export type AutoFailCode =
  | 'SOURCE_UNAVAILABLE' | 'RENDER_ERROR' | 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT'
  | 'SAFETY_BLOCK' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'DOWNLOAD_INVALID'
  /** 25/10 (molduras §B2/§B3.1) */
  | 'FRAME_TEXT_OVERFLOW' | 'BROLL_UNAVAILABLE'
  /** render-lambda-v1 §2.8: timeout depois das tentativas */
  | 'RENDER_TIMEOUT'
  /** headline-e-legenda-v1 §1.3/§1.4 (HeadlineError do buildHeadlineInput): refazer não adianta (Leave out) */
  | 'HEADLINE_TOO_LONG' | 'HEADLINE_NO_ROOM' | 'HEADLINE_OVER_FACE' | 'HEADLINE_LOW_CONFIDENCE';
export const HEADLINE_FAIL_CODES = ['HEADLINE_TOO_LONG', 'HEADLINE_NO_ROOM', 'HEADLINE_OVER_FACE', 'HEADLINE_LOW_CONFIDENCE'] as const;

/** Falha da peça AUTO antes do render (sem vídeo do campeão, etc.): vira o errorCode do formato (e da peça, no 9:16). */
class AutoPieceError extends Error {
  constructor(readonly code: AutoFailCode, message: string) {
    super(message);
  }
}
export const AUTO_FAIL_REASON: Record<AutoFailCode, string> = {
  SOURCE_UNAVAILABLE: 'The original video is no longer available.',
  RENDER_ERROR: 'The render failed. Retry.',
  PAGE_FORBIDDEN: 'The page blocked our reader.',
  PAGE_UNREADABLE: 'We could not read the page.',
  PAGE_TIMEOUT: 'The page took too long to load.',
  SAFETY_BLOCK: 'The image model refused this concept. Retry tries again; Leave out removes it.',
  PROVIDER_TIMEOUT: 'The image took too long to come back. Retry.',
  PROVIDER_ERROR: 'The image provider failed. Retry.',
  DOWNLOAD_INVALID: 'The image came back broken. Retry.',
  FRAME_TEXT_OVERFLOW: 'The frame text does not fit. Leave it out.',
  BROLL_UNAVAILABLE: 'The b-roll clip is no longer available. Retry picks the next one.',
  RENDER_TIMEOUT: 'The render took too long. Render again.',
  HEADLINE_TOO_LONG: "The new headline doesn't fit the original box. Leave it out.",
  HEADLINE_NO_ROOM: 'There is no free room for a headline in this video. Leave it out.',
  HEADLINE_OVER_FACE: 'The headline would cover the face. Leave it out.',
  HEADLINE_LOW_CONFIDENCE: "We couldn't read the original headline style. Leave it out.",
};
const AD_NAME_ATTEMPTS = 5;
/** render-lambda-v1 §2.7: 1 tentativa nova no timeout/retryable; finalize até 3x; submit sem externalId há 2 min = fila. */
const RENDER_MAX_ATTEMPTS = 2;
const FINALIZE_MAX_TRIES = 3;
const FINALIZE_STALE_MS = 10 * 60_000;
const STUCK_SUBMIT_MS = 2 * 60_000;
const POLL_PARALLEL = 20;

type RenderRow = Prisma.RenderGetPayload<{ include: { creative: true } }>;



export function defaultEditSettings(offerCta: string | null): EditSettings {
  return { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: offerCta ?? '', endCard: true };
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class EdicaoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Edicao');
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly eventos: EventosService,
    private readonly locks: KeyedMutex,
    private readonly config: AppConfig,
    @Inject(RENDER_PORTS) private readonly ports: RenderPorts,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
    private readonly saves: EditorSaves,
    @Inject(AUTO_EDIT_BUILDER) private readonly buildAutoInput: AutoEditBuilder,
    @Inject(FRAME_BUILDER) private readonly buildFrameInput: FrameBuilder,
    @Inject(HEADLINE_BUILDER) private readonly buildHeadline: HeadlineBuilder,
    private readonly segundas: SegundaFonteService,
  ) {}

  onModuleDestroy() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  templates(): Template[] {
    return this.ports.templates().map((t) => ({
      id: t.id as Template['id'],
      kind: t.kind, // §13.6: remix-keep vem com kind 'remix' (fora da escolha do criativo do zero)
      labelKey: t.labelKey,
      thumbnail: { url: `${this.config.publicApiUrl}/api/v1/templates/${t.id}/thumbnail` },
      supportsHeadline: t.supportsHeadline,
    }));
  }

  templateThumbnail(id: string): string | null {
    return this.ports.templates().find((t) => t.id === id)?.thumbnailPath || null;
  }

  private async creative(auth: AuthContext, id: string): Promise<Creative> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  async get(auth: AuthContext, creativeId: string): Promise<EditResponse> {
    const c = await this.creative(auth, creativeId);
    const settings = editSettingsOf(c.editSettings);
    if (!settings) throw invalidState(c.state, [...EDITABLE]);
    const [latest, preview, scenes] = await Promise.all([
      this.prisma.render.findFirst({ where: { creativeId: c.id }, orderBy: { createdAt: 'desc' }, include: { file: true } }),
      this.prisma.render.findFirst({ where: { creativeId: c.id, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' }, include: { file: true } }),
      currentScenes(this.prisma, c.id),
    ]);
    return {
      settings,
      dirty: c.editDirty,
      latestRender: latest ? await this.views.render(latest) : null,
      previewRender: preview ? await this.views.render(preview) : null,
      // editor-v1 §5: doc salvo que, normalizado contra as cenas vigentes, ainda muda algo (corte de cena regerada não conta)
      // · o "Editar no vídeo" abre (do zero, estado editável, todas as cenas prontas)
      hasEditorChanges: !!(await this.views.docNormalizado(c, settings, c.editDoc)),
      editorAvailable: settings.templateId !== REMIX_KEEP_TEMPLATE && (EDITABLE as readonly string[]).includes(c.state)
        && scenes.length > 0 && scenes.every(cenaPronta),
    };
  }

  /** Autosave dos ajustes. Com o vídeo pronto (RENDER_READY) vira EDIT_PENDING; sempre liga editDirty. */
  async update(auth: AuthContext, creativeId: string, dto: UpdateEditDto): Promise<{ settings: EditSettings; dirty: true }> {
    return this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotAutoPiece(c); // variacao-auto-v1 §3.3
      const current = editSettingsOf(c.editSettings);
      // §13.7: criativo remix-keep usa a edição do campeão; nada aqui é editável
      if (current?.templateId === REMIX_KEEP_TEMPLATE) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'variation_locked' });
      assertState(c.state, [...EDITABLE]);
      if (!current) throw invalidState(c.state, [...EDITABLE]);
      const settings: EditSettings = { ...current, ...(definidos(dto) as Partial<EditSettings>) };
      // editor-v1 §3.2: trocar template apaga os transform; trocar a posição da legenda apaga o dela. Revisão + 1 (§4)
      const before = editDocOf(c.editDoc);
      const doc = aplicarMudancaDeSettings(before, current, settings);
      const revision = c.editRevision + 1;
      const data: Prisma.CreativeUncheckedUpdateManyInput = {
        editSettings: settings as unknown as Prisma.InputJsonValue, editDirty: true, editRevision: revision,
        ...(doc !== before && { editDoc: docJson(doc) }),
      };
      if (c.state === 'RENDER_READY') {
        await this.sm.transition({ creativeId: c.id, event: 'EDIT_CHANGED', from: 'RENDER_READY', to: 'EDIT_PENDING', data });
      } else {
        await this.prisma.creative.update({ where: { id: c.id }, data });
        this.sm.announce(c.id);
      }
      await anunciarEdicao({ prisma: this.prisma, eventos: this.eventos, saves: this.saves }, c.id, auth.userId, revision, new Date());
      return { settings, dirty: true as const };
    });
  }

  /** POST /render: EDIT_PENDING | RENDER_FAILED | RENDER_READY → RENDERING, com todas as cenas prontas. */
  async requestRender(auth: AuthContext, creativeId: string): Promise<Render> {
    const id = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotAutoPiece(c); // peça AUTO: retry pela rota da peça (só os formatos FAILED)
      pickEvent(c.state, ['RENDER']);
      const scenes = await currentScenes(this.prisma, c.id);
      if (!scenes.length || scenes.some((s) => s.status !== 'READY')) throw invalidState(c.state, ['EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY']);
      const r = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'RENDER', from: c.state, to: 'RENDERING' });
        return this.createRender(tx, c.id);
      });
      this.sm.announce(c.id);
      return r.id;
    });
    this.kick();
    const r = await this.prisma.render.findUniqueOrThrow({ where: { id }, include: { file: true } });
    return this.views.render(r);
  }

  async getRender(auth: AuthContext, creativeId: string, renderId: string): Promise<Render> {
    const c = await this.creative(auth, creativeId);
    const r = await this.prisma.render.findFirst({ where: { id: renderId, creativeId: c.id, workspaceId: c.workspaceId }, include: { file: true } });
    if (!r) throw new AppException('NOT_FOUND');
    return this.views.render(r);
  }

  /** Cria o render QUEUED com a cópia dos ajustes (dentro da transação de quem muda o estado pra RENDERING). */
  async createRender(tx: Prisma.TransactionClient, creativeId: string) {
    const c = await tx.creative.findUniqueOrThrow({ where: { id: creativeId }, include: { offer: { select: { cta: true } } } });
    let settings = editSettingsOf(c.editSettings);
    if (!settings) {
      settings = defaultEditSettings(c.offer.cta);
      await tx.creative.update({ where: { id: c.id }, data: { editSettings: settings as unknown as Prisma.InputJsonValue, editDirty: false } });
    }
    const remix = settings.templateId === REMIX_KEEP_TEMPLATE;
    // editor-v1 §3.4/§4: cópia do doc NORMALIZADO contra as cenas que vão pro render (corte/correção de cena regerada cai;
    // vazio = NULL) e a revisão renderizada (o dirty compara com ela). remix-keep: doc null até o F3.
    const fonte = remix ? null : await this.fonteDoRender(tx, c);
    const doc = fonte ? normalizarDoc(editDocOf(c.editDoc), fonte, settings) : null;
    const render = await tx.render.create({
      data: {
        workspaceId: c.workspaceId, creativeId: c.id, status: 'QUEUED', settings: settings as unknown as Prisma.InputJsonValue, input: {},
        doc: docJson(doc), editRevision: c.editRevision,
      },
    });
    // remix-keep: o input pesado (baixa o clipe, acha o rosto) é montado fora da transação, na fila (process)
    if (!fonte) return render;
    const input = this.inputDe(render.id, fonte, settings, doc);
    return tx.render.update({ where: { id: render.id }, data: { input: input as unknown as Prisma.InputJsonValue } });
  }

  /**
   * §13.6: RenderInput do remix-keep. Mapa e transcrição = a fotografia do lote (a mesma do plano); Trocar avatar = o take
   * vigente (clipe, rosto do clipe pelo YuNet, janela); gancho escrito = o texto novo do item.
   */
  private async buildRemixInput(renderId: string, c: Creative): Promise<RenderInput> {
    if (!c.championId || !c.variationKind) throw new Error('criativo sem campeão/tipo');
    const [ch, batch, item] = await Promise.all([
      this.prisma.champion.findUniqueOrThrow({ where: { id: c.championId }, include: { videoFile: true, teardown: true } }),
      c.variationBatchId ? this.prisma.variationBatch.findUnique({ where: { id: c.variationBatchId }, select: { teardownSnapshot: true } }) : null,
      c.variationItemId ? this.prisma.variationItem.findUnique({ where: { id: c.variationItemId } }) : null,
    ]);
    const snap = (batch?.teardownSnapshot ?? null) as { editMap?: EditMap | null; words?: TranscriptWord[]; sections?: { hook?: { status: string; data: { endSec: number } | null } } } | null;
    const editMap = snap?.editMap ?? editMapOf(ch.teardown?.editMap);
    if (!editMap) throw new Error('campeão sem mapa da edição');
    if (!ch.videoFile) throw new Error('campeão sem vídeo');
    const words = snap?.words ?? transcriptOf(ch.teardown?.transcript)?.words ?? [];
    const hook = snap?.sections?.hook;
    const hookEndSec = hook?.status === 'ok' && hook.data && hook.data.endSec > 0 ? hook.data.endSec : 3;
    const videoUrl = await this.storage.signedUrl(ch.videoFile);
    let swap: Parameters<typeof remixKeepInput>[0]['swap'];
    let swapSpans: Parameters<typeof remixKeepInput>[0]['swapSpans'];
    const swapScenes = c.variationKind === 'SWAP_AVATAR' ? (await currentScenes(this.prisma, c.id)).filter((s) => s.pipeline === 'SWAP_VIDEO') : [];
    if (swapScenes.length) {
      // §13.15: um clipe por trecho main (Kling/Seedance + v2v), rosto do clipe pelo YuNet (score)
      swapSpans = [];
      for (const s of swapScenes) {
        const f = s.status === 'READY' && s.clipFileId ? await this.prisma.file.findUnique({ where: { id: s.clipFileId } }) : null;
        if (!f || s.startFrame == null || s.endFrame == null) throw new Error(`trecho ${s.index} sem clipe`);
        const dir = await mkdtemp(join(tmpdir(), 'maquina-remix-'));
        try {
          const path = join(dir, 'clip.mp4');
          await this.storage.downloadTo(f, path);
          const p = await this.media.probe(path);
          const best = (await this.media.detectFaces(path, 2)).flatMap((x) => x.faces).sort((a, b) => b.score - a.score)[0];
          if (!best) throw new Error(`nenhum rosto no clipe do trecho ${s.index}`);
          swapSpans.push({ startFrame: s.startFrame, endFrame: s.endFrame, clipUrl: await this.storage.signedUrl(f), clip: { w: p.width, h: p.height }, clipFace: best.box });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    } else if (c.variationKind === 'SWAP_AVATAR') {
      const take = await this.prisma.take.findFirst({ where: { creativeId: c.id, stale: false, status: 'READY' }, orderBy: { generation: 'desc' }, include: { clipFile: true } });
      if (!take?.clipFile) throw new Error('take sem clipe');
      const dir = await mkdtemp(join(tmpdir(), 'maquina-remix-'));
      try {
        const path = join(dir, 'take.mp4');
        await this.storage.downloadTo(take.clipFile, path);
        const p = await this.media.probe(path);
        const samples = await this.media.detectFaces(path, 2);
        const best = samples.flatMap((s) => s.faces).sort((a, b) => b.score - a.score)[0];
        if (!best) throw new Error('nenhum rosto no clipe do take');
        swap = { clipUrl: await this.storage.signedUrl(take.clipFile), clip: { w: p.width, h: p.height }, clipFace: best.box, takeSourceStartSec: Number(take.sourceStartSec ?? 0) };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    const payload = (item?.payload ?? {}) as { hook?: { onScreenText: string | null } };
    // §13.15.4 (B) voz do motor: áudio = campeão com cada trecho trocado pela voz da cena (o clipe dela); legenda mesclada
    const engineVoice = swapSpans && c.voiceSource === 'ENGINE_VOICE'
      ? { audioSplice: { fadeMs: 10, spans: swapSpans.map((p) => ({ startFrame: p.startFrame, endFrame: p.endFrame, url: p.clipUrl })) } }
      : undefined;
    const captionWords = engineVoice
      ? mergeEngineWords(words, swapScenes.map((s) => ({ startFrame: s.startFrame!, endFrame: s.endFrame!, words: Array.isArray(s.words) ? (s.words as unknown as TranscriptWord[]) : [] })), editMap.fps)
      : words;
    return remixKeepInput({
      renderId, editMap, baseVideoUrl: videoUrl, audioPassthroughUrl: videoUrl, words: captionWords, hookEndSec, swap, swapSpans, engineVoice,
      hookText: c.variationKind === 'NEW_HOOKS' ? payload.hook?.onScreenText ?? null : undefined,
      fitCrop: (clip, face, region, fir) => this.media.fitCrop(clip, face, region, fir),
    });
  }

  /** Cenas vigentes com URL assinada nova do clipe (a miniatura não entra no render). */
  private async fonteDoRender(db: Db, c: Pick<Creative, 'id' | 'format' | 'language'>): Promise<ScratchSource> {
    const scenes = await currentScenes(db, c.id);
    const files = new Map((await db.file.findMany({ where: { id: { in: scenes.map((x) => x.clipFileId).filter((x): x is string => !!x) } } })).map((f) => [f.id, f]));
    return montarScratchSource(scenes.map((x) => ({ ...x, thumbnailFileId: null })), files, async (f) => ({ id: f.id, url: await this.storage.signedUrl(f), mimeType: f.mimeType }), c);
  }

  /**
   * RenderInput pelo MESMO resolverProps do Player (editor-v1 §7.3): template → EditSettings → EditDoc.
   * Doc nulo = as props de hoje (fatias do take emendadas no clipe inteiro).
   */
  private inputDe(renderId: string, fonte: ScratchSource, s: EditSettings, doc: EditDoc | null): RenderInput {
    return { renderId, fps: 30, ...resolverProps(fonte, s, doc) } as ScratchRenderInput;
  }

  // ───────── fila de render (render-lambda-v1 §2, §6.1.1: despachante + RenderPort assíncrona) ─────────
  // Despachante: claim do QUEUED (priority DESC, createdAt ASC, notBefore vencido, só engine REMOTION) → monta o input →
  // `ports.para(input).submit` sem esperar. Teto: local/fake = RENDER_CONCURRENCY no ar (a ordem da fila continua valendo);
  // lambda = RENDER_LAMBDA_MAX_INFLIGHT e …_PER_WORKSPACE (§10). Fim: local/fake pelo `onEvent`; lambda pelo poller
  // (`snapshot` a cada RENDER_LAMBDA_POLL_MS) e pelo webhook. Os dois caem no `settle` (claim por finalizingAt).

  private lambdaCfg(): LambdaConfig {
    return lambdaConfig((k) => this.config.optional(k) ?? undefined);
  }

  private hasLambda(): boolean {
    return this.ports.todos().some((p) => p.impl === 'lambda');
  }

  /** `kind` de roteamento de um render que ainda não tem input (RENDER_LAMBDA_KINDS). */
  private kindOf(r: { settings: Prisma.JsonValue; creative: { variationItem: { autoType: string | null } | null } }): RenderKind {
    const t = (r.settings as { templateId?: string } | null)?.templateId;
    if (t === AUTO_EDIT_TEMPLATE) {
      const at = r.creative.variationItem?.autoType as string | null | undefined;
      return at === 'FRAME' ? 'frame' : at === 'HEADLINE' ? 'remix-keep' : 'auto-edit'; // HEADLINE = remix-keep (§1.3)
    }
    if (t === REMIX_KEEP_TEMPLATE) return 'remix-keep';
    return 'scratch';
  }

  /**
   * Adaptador pra um render novo. §13.6 (regra de antes, agora por porta): com o `fake`, o remix-keep usa o Remotion local
   * de verdade fora do Jest (só se confere com a peça real); RENDER_REMIX_IMPL força.
   */
  private portFor(kind: RenderKind): RenderPort {
    const p = this.ports.para({ kind });
    if (p.impl === 'fake' && kind === 'remix-keep') {
      const remix = process.env.RENDER_REMIX_IMPL ?? (process.env.JEST_WORKER_ID ? 'fake' : 'remotion');
      if (remix !== 'fake') return this.ports.porImpl('local');
    }
    return p;
  }

  /** §10: cabe mais um render neste adaptador? */
  private async hasRoom(impl: RenderImpl, workspaceId: string): Promise<boolean> {
    if (impl === 'lambda') {
      const cfg = this.lambdaCfg();
      const where = { status: 'RENDERING' as const, engine: 'REMOTION' as const, impl: 'lambda' };
      const [all, mine] = await Promise.all([this.prisma.render.count({ where }), this.prisma.render.count({ where: { ...where, workspaceId } })]);
      return all < cfg.maxInflight && mine < cfg.maxInflightPerWorkspace;
    }
    const busy = await this.prisma.render.count({ where: { status: 'RENDERING', engine: 'REMOTION', impl: { in: ['local', 'fake'] } } });
    return busy < this.localConcurrency;
  }

  private get localConcurrency(): number {
    const n = Number(this.config.optional('RENDER_CONCURRENCY'));
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

  /** Acorda a fila. Idempotente: se já está rodando, o laço pega o novo render. */
  kick(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    void this.drain()
      .catch((e) => this.log.error(`fila de render: ${(e as Error).stack ?? e}`))
      .finally(() => {
        this.running = false;
      });
  }

  private async drain() {
    while (!this.stopped) {
      const now = new Date();
      const cands = await this.prisma.render.findMany({
        // §14.2: formato pedido sob demanda (priority 10) passa na frente do lote (0); o STATIC (IMAGE_GEN) não entra aqui
        where: { status: 'QUEUED', engine: 'REMOTION', creative: { archivedAt: null }, OR: [{ notBefore: null }, { notBefore: { lte: now } }] },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 50,
        select: { id: true, workspaceId: true, settings: true, creative: { select: { variationItem: { select: { autoType: true } } } } },
      });
      let claimedOne = false;
      for (const c of cands) {
        const port = this.portFor(this.kindOf(c));
        if (!(await this.hasRoom(port.impl, c.workspaceId))) continue; // adaptador cheio: o próximo da fila pode ir pro outro
        const claimed = await this.prisma.render.updateMany({
          where: { id: c.id, status: 'QUEUED' },
          data: {
            status: 'RENDERING', stage: 'bundling', progress: 0, startedAt: new Date(), impl: port.impl,
            externalId: null, externalBucket: null, submittedAt: null, finalizingAt: null, notBefore: null,
          },
        });
        if (claimed.count !== 1) continue;
        claimedOne = true;
        await this.process(c.id, port).catch((e) => this.log.error(`render ${c.id}: ${(e as Error).stack ?? e}`));
        break; // de novo do topo: a prioridade vale a cada render
      }
      if (!claimedOne) return;
    }
  }

  /** `render.updated` no SSE do criativo (a fila, o STATIC e o pedido de formato usam). */
  async publish(renderId: string) {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { file: true } });
    if (r) this.eventos.publish(r.creativeId, 'render.updated', await this.views.render(r));
  }

  /** Claim feito: monta o input (URLs assinadas agora, §2.4) e submete. */
  private async process(renderId: string, port: RenderPort) {
    const r = await this.prisma.render.findUniqueOrThrow({ where: { id: renderId }, include: { creative: true } });
    const auto = (r.settings as { templateId?: string } | null)?.templateId === AUTO_EDIT_TEMPLATE;
    const input = auto ? await this.buildAuto(r) : await this.buildScratch(r);
    if (!input) return; // falhou ao montar: já gravado
    await this.prisma.render.update({ where: { id: r.id }, data: { input: input as unknown as Prisma.InputJsonValue } });
    await this.publish(r.id);
    if (auto && (await this.mockFails(r, input))) {
      await this.failRender(r.id, 'RENDER_ERROR', 0, 'mock render-fail');
      return;
    }
    const attempt = r.attempt + 1;
    try {
      const sub = await port.submit(input, { attempt, webhookUrl: this.webhookUrl() });
      await this.prisma.render.updateMany({
        where: { id: r.id, status: 'RENDERING' },
        data: { impl: sub.impl, externalId: sub.externalId, externalBucket: sub.bucket, serveUrl: sub.serveUrl, attempt: sub.attempt, submittedAt: new Date() },
      });
    } catch (e) {
      if (e instanceof RenderThrottledError) {
        // §2.7: cota da AWS / rede = não é falha: volta pra fila, MESMO attempt, espera retryAfterMs
        this.log.warn(`render ${r.id}: ${e.reason} (${e.message}); de volta pra fila em ${e.retryAfterMs} ms`);
        await this.prisma.render.updateMany({
          where: { id: r.id, status: 'RENDERING' },
          data: { status: 'QUEUED', stage: null, progress: 0, startedAt: null, impl: null, notBefore: new Date(Date.now() + e.retryAfterMs) },
        });
        await this.publish(r.id);
        setTimeout(() => this.kick(), e.retryAfterMs + 50).unref?.();
        return;
      }
      this.log.warn(`render ${r.id}: submit falhou: ${(e as Error).message}`);
      await this.failRender(r.id, 'RENDER_ERROR', e instanceof RenderError ? e.failedFrame : null, (e as Error).message);
    }
  }

  private webhookUrl(): string | null {
    if (!this.hasLambda() || !this.lambdaCfg().webhook) return null;
    return `${this.config.publicApiUrl}/api/v1/webhooks/render`;
  }

  /** Input do criativo do zero / remix-keep. Sem o que montar = falha explícita do render (nunca peça inventada). */
  private async buildScratch(r: RenderRow): Promise<RenderInput | null> {
    const rs = r.settings as unknown as EditSettings;
    try {
      return rs.templateId === REMIX_KEEP_TEMPLATE
        ? await this.buildRemixInput(r.id, r.creative)
        : this.inputDe(r.id, await this.fonteDoRender(this.prisma, r.creative), rs, editDocOf(r.doc));
    } catch (e) {
      this.log.warn(`render ${r.id}: input falhou: ${(e as Error).message}`);
      await this.prisma.render.update({ where: { id: r.id }, data: { input: { renderId: r.id, failed: true } as Prisma.InputJsonValue } });
      await this.failRender(r.id, 'RENDER_ERROR', null, `Could not prepare the edit: ${(e as Error).message}`);
      return null;
    }
  }

  // ───────── fim do render (local/fake por evento; lambda por poller/webhook) ─────────

  private readonly lastWrite = new Map<string, number>();
  private readonly finalizeTries = new Map<string, number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  onModuleInit() {
    for (const p of this.ports.todos()) {
      p.onEvent?.((renderId, snap) => void this.onPortEvent(renderId, snap).catch((e) => this.log.error(`evento do render ${renderId}: ${(e as Error).stack ?? e}`)));
    }
    if (this.hasLambda() && process.env.RENDER_LAMBDA_POLLER !== 'off') {
      this.pollTimer = setInterval(() => void this.pollLambda(), this.lambdaCfg().pollMs);
      this.pollTimer.unref?.();
    }
  }

  /** local/fake: o `onEvent` substitui o onProgress de antes (máx. 2 gravações/s); done → settle; falha → regra do §2.7. */
  private async onPortEvent(renderId: string, snap: RenderSnapshot) {
    if (snap.state === 'running') return this.writeProgress(renderId, snap);
    if (snap.state === 'done') return this.settle(renderId);
    return this.handleFailed(renderId, snap);
  }

  private async writeProgress(renderId: string, snap: RenderSnapshot, force = false) {
    const now = Date.now();
    if (!force && now - (this.lastWrite.get(renderId) ?? 0) < 500) return;
    this.lastWrite.set(renderId, now);
    const p = snap.progress;
    const r = await this.prisma.render.updateMany({
      where: { id: renderId, status: 'RENDERING', finalizingAt: null },
      data: {
        stage: p.stage, progress: Math.min(99, Math.round(p.progress)), frame: p.frame, totalFrames: p.totalFrames || null,
        ...(snap.costUsd != null && { costUsd: snap.costUsd }),
      },
    });
    if (r.count) await this.publish(renderId);
  }

  private subOf(r: { id: string; impl: string | null; externalId: string | null; externalBucket: string | null; serveUrl: string | null; attempt: number }): RenderSubmission {
    return { impl: (r.impl ?? 'local') as RenderImpl, externalId: r.externalId ?? r.id, bucket: r.externalBucket, serveUrl: r.serveUrl, attempt: r.attempt };
  }

  /**
   * §6.1.1 passo 5: claim por finalizingAt (webhook × poller × evento) → `uploading` → `finalize` → `storage.put` → READY
   * (e a transição do criativo, igual antes) → `release` → apaga a pasta → CostEntry AWS_LAMBDA/RENDER (1 por tentativa).
   * Falha no finalize/upload: lambda tenta de novo no próximo ciclo (até 3x); depois FAILED.
   */
  async settle(renderId: string): Promise<void> {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { creative: true } });
    if (!r || r.status !== 'RENDERING' || r.stale) return;
    const claimed = await this.prisma.render.updateMany({
      where: { id: r.id, status: 'RENDERING', finalizingAt: null },
      data: { finalizingAt: new Date(), stage: 'uploading', progress: 99 },
    });
    if (claimed.count !== 1) return;
    await this.publish(r.id);
    const port = this.ports.porImpl(r.impl);
    const input = r.input as unknown as RenderInput;
    const sub = this.subOf(r);
    let res: RenderResult & { costUsd?: number | null };
    try {
      res = await port.finalize(input, sub);
      const auto = (r.settings as { templateId?: string } | null)?.templateId === AUTO_EDIT_TEMPLATE;
      if (auto) await this.completeAuto(r, res);
      else await this.completeScratch(r, res);
    } catch (e) {
      if (await this.retryFinalize(r, e)) return;
      this.log.warn(`render ${r.id}: finalize falhou: ${(e as Error).message}`);
      await this.failRender(r.id, 'RENDER_ERROR', e instanceof RenderError ? e.failedFrame : null, (e as Error).message, true);
      return;
    }
    this.finalizeTries.delete(r.id);
    this.lastWrite.delete(r.id);
    await port.release(input, sub);
    await rm(dirname(res.outputPath), { recursive: true, force: true }).catch(() => undefined);
    await this.recordCost(r, res.costUsd ?? null);
    this.kick();
  }

  /** Lambda: throttling ou falha de rede/upload = solta o claim pro próximo ciclo do poller (até 3 tentativas, §2.7). */
  private async retryFinalize(r: { id: string; impl: string | null }, e: unknown): Promise<boolean> {
    const n = (this.finalizeTries.get(r.id) ?? 0) + 1;
    const throttled = e instanceof RenderThrottledError;
    if (r.impl !== 'lambda' || (!throttled && n >= FINALIZE_MAX_TRIES)) {
      this.finalizeTries.delete(r.id);
      return false;
    }
    if (!throttled) this.finalizeTries.set(r.id, n);
    await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { finalizingAt: null } });
    return true;
  }

  /** Criativo do zero / remix: vídeo + pôster no storage → READY → transição do criativo (editor-v1 §4: dirty). */
  private async completeScratch(r: RenderRow, res: RenderResult) {
    const [video, poster] = await Promise.all([
      this.storage.put(res.outputPath, { workspaceId: r.workspaceId, kind: 'RENDER_VIDEO', mimeType: 'video/mp4', meta: { durationSec: res.durationSec, width: res.width, height: res.height } }),
      this.storage.put(res.posterPath, {
        workspaceId: r.workspaceId, kind: 'THUMBNAIL', mimeType: res.posterPath.endsWith('.png') ? 'image/png' : 'image/jpeg', meta: { width: res.width, height: res.height },
      }),
    ]);
    await this.locks.run(r.creativeId, async () => {
      await this.prisma.render.update({
        where: { id: r.id },
        data: { status: 'READY', stage: null, progress: 100, fileId: video.id, durationSec: res.durationSec, finishedAt: new Date(), finalizingAt: null },
      });
      const [c, fresh] = await Promise.all([this.prisma.creative.findUnique({ where: { id: r.creativeId } }), this.prisma.render.findUniqueOrThrow({ where: { id: r.id } })]);
      if (!c || c.state !== 'RENDERING' || fresh.stale) return;
      // editor-v1 §4: revisão do criativo ≠ revisão renderizada = edição não exportada; render antigo (sem revisão) = regra de antes
      const dirty = fresh.editRevision != null ? c.editRevision !== fresh.editRevision : JSON.stringify(c.editSettings) !== JSON.stringify(fresh.settings);
      await this.sm.transition({
        creativeId: c.id, event: 'RENDER_FINISHED', from: 'RENDERING', to: dirty ? 'EDIT_PENDING' : 'RENDER_READY',
        data: { editDirty: dirty, thumbnailFileId: poster.id },
      });
    });
    await this.publish(r.id);
  }

  /** Peça AUTO: arquivo (+ pôster) no storage → READY → assenta a peça pelo 9:16 (§14.2). */
  private async completeAuto(r: RenderRow, res: RenderResult) {
    const format = r.format ?? 'VERTICAL_9_16';
    const still = res.mimeType === 'image/png' || res.outputPath.endsWith('.png');
    const out = await this.storage.put(res.outputPath, {
      workspaceId: r.workspaceId, kind: still ? 'RENDER_IMAGE' : 'RENDER_VIDEO', mimeType: still ? 'image/png' : 'video/mp4',
      meta: { durationSec: still ? undefined : res.durationSec, width: res.width, height: res.height },
    });
    const poster = still ? out : await this.storage.put(res.posterPath, {
      workspaceId: r.workspaceId, kind: 'THUMBNAIL', mimeType: res.posterPath.endsWith('.png') ? 'image/png' : 'image/jpeg', meta: { width: res.width, height: res.height },
    });
    await this.prisma.render.update({
      where: { id: r.id },
      data: { status: 'READY', stage: null, progress: 100, fileId: out.id, durationSec: res.durationSec, finishedAt: new Date(), finalizingAt: null },
    });
    // pôster da peça = frame do 9:16 (o único formato do Gerar, §14.2)
    if (format === 'VERTICAL_9_16') await this.prisma.creative.update({ where: { id: r.creativeId }, data: { thumbnailFileId: poster.id } });
    await this.publish(r.id);
    await this.settleAuto(r.creativeId);
  }

  /** §10: CostEntry AWS_LAMBDA/RENDER por tentativa (externalRef = externalId, único) + `renders.cost_usd`. Só lambda. */
  private async recordCost(r: { id: string; workspaceId: string; creativeId: string; impl: string | null; externalId: string | null; creative: { variationBatchId: string | null } }, costUsd: number | null) {
    if (r.impl !== 'lambda' || !r.externalId || costUsd == null) return;
    const amountUsd = Math.round(costUsd * 10_000) / 10_000;
    await this.prisma.render.update({ where: { id: r.id }, data: { costUsd: amountUsd } }).catch(() => undefined);
    await this.prisma.costEntry.upsert({
      where: { externalRef: r.externalId },
      create: {
        workspaceId: r.workspaceId, creativeId: r.creativeId, variationBatchId: r.creative.variationBatchId, provider: 'AWS_LAMBDA', kind: 'RENDER',
        model: this.lambdaCfg().functionName || 'remotion-lambda', units: 1, unit: 'render', amountUsd, externalRef: r.externalId,
      },
      update: { amountUsd },
    });
  }

  /**
   * §2.7: `timeout` ou erro retryable (pedaço morto por throttling, render local perdido no restart) = 1 tentativa nova
   * (volta pra fila, attempt+1 no próximo submit, URLs assinadas de novo); na 2ª falha FAILED (`RENDER_TIMEOUT` pro
   * timeout, `RENDER_ERROR` pro resto). Não retryable = FAILED RENDER_ERROR com failedFrame.
   */
  private async handleFailed(renderId: string, snap: RenderSnapshot) {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { creative: true } });
    if (!r || r.status !== 'RENDERING' || r.finalizingAt) return;
    this.lastWrite.delete(r.id);
    await this.recordCost(r, snap.costUsd);
    const timeout = snap.state === 'timeout';
    // bug 25/10: 429/5xx do storage ao baixar mídia dentro do render = transitório (o Lambda bateu no rate limit): 1 tentativa nova
    const transitorio = /status code of (429|50[234])|\b429\b|Too Many Requests/i.test(snap.error?.message ?? '');
    if ((timeout || snap.error?.retryable || transitorio) && r.attempt < RENDER_MAX_ATTEMPTS) {
      const back = await this.prisma.render.updateMany({
        where: { id: r.id, status: 'RENDERING', externalId: r.externalId },
        data: { status: 'QUEUED', stage: null, progress: 0, startedAt: null, impl: null, externalId: null, externalBucket: null, submittedAt: null, finalizingAt: null },
      });
      if (back.count) {
        this.log.warn(`render ${r.id}: ${timeout ? 'timeout' : snap.error?.message}; tentativa nova`);
        await this.publish(r.id);
        this.kick();
      }
      return;
    }
    await this.failRender(r.id, timeout ? 'RENDER_TIMEOUT' : 'RENDER_ERROR', snap.error?.failedFrame ?? null, snap.error?.message ?? 'render failed');
  }

  /**
   * FAILED com o código. Peça AUTO = `failAuto` (código no formato/peça, a peça assenta); criativo do zero = render FAILED
   * + RENDER_FINISHED → RENDER_FAILED (igual antes). `claimed` = já está com finalizingAt (vindo do settle).
   */
  private async failRender(renderId: string, code: 'RENDER_ERROR' | 'RENDER_TIMEOUT', failedFrame: number | null, message: string, claimed = false) {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { creative: true } });
    if (!r || r.status !== 'RENDERING' || (r.finalizingAt && !claimed)) return;
    this.lastWrite.delete(r.id);
    const auto = (r.settings as { templateId?: string } | null)?.templateId === AUTO_EDIT_TEMPLATE;
    if (auto) {
      await this.failAuto(r, code, failedFrame);
    } else {
      const reason = code === 'RENDER_TIMEOUT' ? AUTO_FAIL_REASON.RENDER_TIMEOUT
        : failedFrame != null ? `The render failed at frame ${failedFrame}. Render again.`
          : message.startsWith('Could not prepare') ? message.slice(0, 300) : failReasonFor('RENDER_ERROR');
      await this.locks.run(r.creativeId, async () => {
        await this.prisma.render.update({
          where: { id: r.id }, data: { status: 'FAILED', stage: null, errorCode: code, failReason: reason, failedFrame, finishedAt: new Date(), finalizingAt: null },
        });
        const c = await this.prisma.creative.findUnique({ where: { id: r.creativeId } });
        if (c?.state === 'RENDERING' && !r.stale) await this.sm.transition({ creativeId: c.id, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_FAILED' });
      });
      await this.publish(r.id);
    }
    this.kick();
  }

  // ───────── lambda: poller e webhook (§2.3, §6.1.1 passos 3-4) ─────────

  /**
   * Linhas `impl='lambda'` em RENDERING (seja qual for o RENDER_IMPL atual: segura o rollback). Com externalId: snapshot →
   * progresso/custo; done → settle; failed/timeout → §2.7; snapshot sem notícia e prazo estourado = timeout. Sem
   * externalId há mais de 2 min (caiu entre invocar e gravar) → QUEUED. finalizingAt com mais de 10 min = solto de novo.
   */
  async pollLambda(now = Date.now()): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const port = this.ports.porImpl('lambda');
      const cfg = this.lambdaCfg();
      const rows = await this.prisma.render.findMany({ where: { status: 'RENDERING', engine: 'REMOTION', impl: 'lambda' }, take: 500 });
      const live: typeof rows = [];
      for (const r of rows) {
        if (!r.externalId) {
          if (r.startedAt && now - r.startedAt.getTime() > STUCK_SUBMIT_MS) {
            await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING', externalId: null }, data: { status: 'QUEUED', stage: null, progress: 0, impl: null, startedAt: null } });
          }
          continue;
        }
        if (r.finalizingAt) {
          if (now - r.finalizingAt.getTime() > FINALIZE_STALE_MS) {
            await this.prisma.render.updateMany({ where: { id: r.id, finalizingAt: r.finalizingAt }, data: { finalizingAt: null } });
            void this.settle(r.id);
          }
          continue;
        }
        live.push(r);
      }
      for (let i = 0; i < live.length; i += POLL_PARALLEL) {
        await Promise.all(live.slice(i, i + POLL_PARALLEL).map((r) => this.pollOne(port, r, cfg.functionTimeoutSec, now)));
      }
      this.kick(); // o que terminou liberou vaga
    } catch (e) {
      this.log.warn(`poller do lambda: ${(e as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async pollOne(port: RenderPort, r: { id: string; impl: string | null; externalId: string | null; externalBucket: string | null; serveUrl: string | null; attempt: number; submittedAt: Date | null }, timeoutSec: number, now: number) {
    let snap: RenderSnapshot;
    try {
      snap = await port.snapshot(this.subOf(r));
    } catch (e) {
      // sem notícia neste ciclo (throttling, rede, render sem metadados ainda): só vira timeout depois do prazo
      if (r.submittedAt && prazoEstourado(r.submittedAt, now, timeoutSec)) {
        await this.handleFailed(r.id, { state: 'timeout', progress: { stage: 'rendering', progress: 0, frame: 0, totalFrames: 0 }, costUsd: null, error: { message: (e as Error).message, failedFrame: null, retryable: true } });
      }
      return;
    }
    if (snap.state === 'running') return this.writeProgress(r.id, snap, true);
    if (snap.state === 'done') return this.settle(r.id);
    return this.handleFailed(r.id, snap);
  }

  /**
   * `POST /api/v1/webhooks/render` (corpo cru). false = assinatura inválida (ou lambda desligado): 401, nada gravado.
   * Válido: `decidirWebhook` descarta duplicado/atrasado/outra impl; success → settle; error/timeout → mesma regra do poller.
   */
  async renderWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<boolean> {
    if (!this.hasLambda()) return false;
    const port = this.ports.porImpl('lambda');
    const ev = port.parseWebhook?.(raw, headers) ?? null;
    if (!ev) return false;
    const row = await this.prisma.render.findUnique({ where: { id: ev.renderId } });
    const d = decidirWebhook(ev, row ? { id: row.id, status: row.status, impl: row.impl, externalId: row.externalId, attempt: row.attempt, finalizingAt: row.finalizingAt } : null);
    if (d.acao === 'ignorar') {
      this.log.log(`webhook do render ${ev.renderId} ignorado: ${d.motivo}`);
      return true;
    }
    if (ev.status === 'success') void this.settle(row!.id).catch((e) => this.log.error(`settle ${row!.id}: ${(e as Error).message}`));
    else void this.pollOne(port, row!, this.lambdaCfg().functionTimeoutSec, Date.now()).catch(() => undefined);
    return true;
  }

  // ───────── peças AUTO (variacao-auto-v1 §3.3, §5.1; rev. 23/10 §14.2): 1 criativo, 1 render por formato (9:16 no Gerar) ─────────

  /** Contexto plano do builder do video (§7.3). Sem vídeo do campeão = SOURCE_UNAVAILABLE. */
  private async autoContext(renderId: string, c: Creative): Promise<AutoEditContext> {
    if (!c.championId || !c.variationItemId || !c.variationBatchId) throw new AutoPieceError('RENDER_ERROR', 'peça sem campeão/item/lote');
    const [ch, item, batch, ws] = await Promise.all([
      this.prisma.champion.findUniqueOrThrow({ where: { id: c.championId }, include: { videoFile: true, teardown: true } }),
      this.prisma.variationItem.findUniqueOrThrow({ where: { id: c.variationItemId } }),
      this.prisma.variationBatch.findUniqueOrThrow({ where: { id: c.variationBatchId }, include: { pageCapture: true, offer: { include: { productImage: true } } } }),
      this.prisma.workspace.findUniqueOrThrow({ where: { id: c.workspaceId }, select: { name: true } }),
    ]);
    if (!ch.videoFile || !(await this.storage.head(ch.videoFile.storageKey))) throw new AutoPieceError('SOURCE_UNAVAILABLE', 'vídeo do campeão sumiu do storage');
    const editMap = editMapOf(ch.teardown?.editMap);
    const sections = (ch.teardown?.sections ?? {}) as {
      structure?: { status?: string; data?: { blocks?: { startSec: number; endSec: number }[] } | null };
      hook?: { status?: string; data?: { endSec?: number } | null };
    };
    const meas = (ch.teardown?.measurements ?? {}) as { silences?: { startSec: number; endSec: number }[]; palette?: string[] };
    const insight = (batch.insight ?? null) as { blocks?: { index: number; startSec: number; endSec: number }[] } | null;
    const teardownBlocks = sections.structure?.data?.blocks?.map((b, index) => ({ index, startSec: b.startSec, endSec: b.endSec }));
    const payload = (item.payload ?? {}) as { params?: Record<string, unknown>; useProductPhoto?: boolean };
    const durationSec = num(ch.durationSec) ?? num(ch.videoFile.durationSec) ?? (editMap ? editMap.frameCount / editMap.fps : 0);
    // SPLIT-LP: foto do produto (D4, pedida no Retry) ou a captura da página tirada na análise
    const photo = payload.useProductPhoto && batch.offer.productImage ? batch.offer.productImage : null;
    const page = photo
      ? { imageUrl: await this.storage.signedUrl(photo), kind: 'product_photo' as const }
      : batch.pageCapture && (item.autoType !== 'SPLIT_LP' || (await capturaValida(this.storage, batch.pageCapture, `SPLIT-LP ${renderId}`)))
        ? { imageUrl: await this.storage.signedUrl(batch.pageCapture), kind: 'page' as const } : null; // bug 25/10: captura quebrada = sem página
    // §5.3: SPLIT-LP sem captura que sirva (nem foto) = PAGE_UNREADABLE na peça; o retry sugere a foto do produto (D4)
    if (item.autoType === 'SPLIT_LP' && !page) throw new AutoPieceError('PAGE_UNREADABLE', 'SPLIT-LP sem captura da página nem foto do produto');
    return {
      renderId, type: item.autoType as AutoVariationType,
      params: { type: item.autoType, ...(payload.params ?? {}) } as unknown as AutoEditContext['params'],
      language: batch.language,
      source: {
        videoUrl: await this.storage.signedUrl(ch.videoFile),
        width: ch.videoFile.width ?? editMap?.width ?? 1080, height: ch.videoFile.height ?? editMap?.height ?? 1920,
        fps: editMap?.fps ?? 30, durationSec, hasAudio: !!ch.audioFileId || ch.hasSpeech,
      },
      editMap, words: transcriptOf(ch.teardown?.transcript)?.words ?? [], silences: meas.silences ?? [],
      blocks: teardownBlocks?.length ? teardownBlocks : insight?.blocks ?? [],
      hookEndSec: typeof sections.hook?.data?.endSec === 'number' ? sections.hook.data.endSec : null,
      palette: meas.palette ?? [], brandName: ws.name, page,
    };
  }

  /** Input da peça AUTO (auto-edit ou moldura). Falhou ao montar = peça/formato `failed` com o código; null. */
  private async buildAuto(r: RenderRow): Promise<RenderInput | null> {
    const format = r.format ?? 'VERTICAL_9_16';
    try {
      const ctx = await this.autoContext(r.id, r.creative);
      // headline-e-legenda-v1 §2: legenda automática do lote (campeão sem legenda queimada) em toda peça de vídeo
      const captions = await this.captionsDoLote(r, ctx);
      const tipo = ctx.type as string;
      if (tipo === 'HEADLINE') {
        // §1.3: troca/acrescenta a headline pelo remix-keep (buildHeadlineInput do video), no aspecto do campeão
        const p = ctx.params as unknown as { mode: 'replace' | 'add'; text: string; highlight: string | null; language?: string };
        return this.buildHeadline({ mode: p.mode, text: p.text, highlight: p.highlight, language: p.language ?? ctx.language, brandColor: await this.brandColorOf(r), captions }, ctx);
      }
      if (tipo === 'FRAME') {
        // 25/10 §B2: moldura = composição `Moldura` do video (`kind 'frame'`), montada pelo buildFrameInput dele
        let params = ctx.params as unknown as Record<string, unknown>;
        if (precisaSegundaFonte(frameTemplateOf(params)) && !params.second) params = await this.segundaFonte(r, ctx, params);
        const fi = this.buildFrameInput(frameSpecOf(params), ctx, format);
        return captions ? ({ ...fi, captions } as RenderInput) : fi;
      }
      const ai = this.buildAutoInput(ctx, format);
      return captions && tipo !== 'STATIC' ? ({ ...ai, captions } as RenderInput) : ai;
    } catch (e) {
      const hc = (e as { code?: string })?.code;
      const code: AutoFailCode = e instanceof AutoPieceError ? e.code
        : hc === 'FRAME_TEXT_OVERFLOW' ? 'FRAME_TEXT_OVERFLOW'
          : hc && (HEADLINE_FAIL_CODES as readonly string[]).includes(hc) ? (hc as AutoFailCode) : 'RENDER_ERROR';
      this.log.warn(`render AUTO ${r.id}: input falhou: ${(e as Error).message}`);
      await this.failAuto(r, code, null);
      this.kick();
      return null;
    }
  }

  /**
   * §B3/§B3.1 (Gusta 25/10): 2ª fonte da moldura de 2 fontes, resolvida 1x por peça e gravada no item (o Retry e os
   * formatos sob demanda reusam; a proveniência do b-roll vai na peça e no README do zip).
   */
  private async segundaFonte(r: RenderRow, ctx: AutoEditContext, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const c = r.creative;
    const [td, offer] = await Promise.all([
      c.championId ? this.prisma.teardown.findUnique({ where: { championId: c.championId } }) : null,
      this.prisma.offer.findUnique({ where: { id: c.offerId }, select: { name: true, kind: true, what: true, audience: true, notes: true } }),
    ]);
    const res = await this.segundas.resolver({
      workspaceId: r.workspaceId, variationBatchId: c.variationBatchId ?? '', template: frameTemplateOf(params)!, language: ctx.language,
      durationSec: ctx.source.durationSec, blocks: blocksOf(td, ctx.source.durationSec), words: ctx.words, editMap: ctx.editMap,
      offer: offer ? { name: offer.name, kind: offer.kind, what: offer.what, audience: offer.audience } : null, notes: offer?.notes ?? null,
      itemId: c.variationItemId, variante: typeof params.brollVariant === 'number' ? params.brollVariant : null,
    });
    if (!res) throw new AutoPieceError('RENDER_ERROR', 'moldura de 2 fontes sem 2ª fonte (sem b-roll e sem trecho de prova ≥ 3 s)');
    const next: Record<string, unknown> = { ...params, second: res.second, secondNote: res.nota, ...(res.variante != null && { brollVariant: res.variante }) };
    if (c.variationItemId) {
      const item = await this.prisma.variationItem.findUnique({ where: { id: c.variationItemId }, select: { payload: true } });
      const payload = (item?.payload ?? {}) as Record<string, unknown>;
      const saved = { ...((payload.params as Record<string, unknown>) ?? {}), second: res.second, secondNote: res.nota, ...(res.variante != null && { brollVariant: res.variante }) };
      await this.prisma.variationItem.update({ where: { id: c.variationItemId }, data: { payload: { ...payload, params: saved } as unknown as Prisma.InputJsonValue } });
    }
    this.log.log(`moldura ${r.id}: 2ª fonte = ${res.nota}`);
    return next;
  }

  /** §2.1/§2.2: `captionsAuto` do lote → palavras do campeão (tempo do arquivo), destaque na cor da marca e idioma da fala. */
  private async captionsDoLote(r: RenderRow, ctx: AutoEditContext): Promise<CaptionsAuto | null> {
    if (!r.creative.variationBatchId) return null;
    const b = await this.prisma.variationBatch.findUnique({ where: { id: r.creative.variationBatchId }, select: { insight: true } });
    if ((b?.insight as { captionsAuto?: boolean } | null)?.captionsAuto !== true || !ctx.words.length) return null;
    const { accent } = paletaDoEstatico({ brandColor: await this.brandColorOf(r), championPalette: ctx.palette });
    return { words: ctx.words.map((w) => ({ word: w.word, startSec: w.startSec, endSec: w.endSec })), highlightColor: accent, language: ctx.language };
  }

  private async brandColorOf(r: RenderRow): Promise<string | null> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: r.workspaceId }, select: { brandColor: true } });
    return ws?.brandColor ?? null;
  }

  /** §14.7 / §B6: gatilhos de mock por oferta (só INTEGRACOES_MODE=mock), valem com qualquer adaptador (antes do submit). */
  private async mockFails(r: RenderRow, input: RenderInput): Promise<boolean> {
    if (integracoesMode() !== 'mock') return false;
    const format = r.format ?? 'VERTICAL_9_16';
    const [offer, attempt, item] = await Promise.all([
      this.prisma.offer.findUnique({ where: { id: r.creative.offerId }, select: { notes: true } }),
      this.prisma.render.count({ where: { creativeId: r.creativeId, format } }),
      r.creative.variationItemId ? this.prisma.variationItem.findUnique({ where: { id: r.creative.variationItemId }, select: { autoType: true, payload: true } }) : null,
    ]);
    const type = item?.autoType ?? (input as { type?: string }).type ?? null;
    const params = ((item?.payload ?? {}) as { params?: Record<string, unknown> }).params ?? null;
    return mockRenderFail(offer?.notes ?? null, type, format, attempt, frameTemplateOf(params));
  }

  /**
   * Formato da peça FAILED com o código no render (§14.2: `Render.errorCode` → `PieceFormat.errorCode`). 9:16 = o código
   * vai também pro item (peça `failed`) e a peça assenta; 4:5/1:1 sob demanda = só aquele formato (a peça segue `ready`).
   * A falha de uma peça não para as outras: a fila segue.
   */
  async failAuto(r: { id: string; creativeId: string; format: VideoFormat | null; creative: Pick<Creative, 'variationItemId'> }, code: AutoFailCode, failedFrame: number | null) {
    const reason = AUTO_FAIL_REASON[code];
    await this.prisma.render.updateMany({ where: { id: r.id }, data: { status: 'FAILED', stage: null, errorCode: code, failReason: reason, failedFrame, finishedAt: new Date() } });
    if ((r.format ?? 'VERTICAL_9_16') === 'VERTICAL_9_16' && r.creative.variationItemId) {
      await this.prisma.variationItem.update({ where: { id: r.creative.variationItemId }, data: { errorCode: code, failReason: reason } });
    }
    await this.publish(r.id);
    await this.settleAuto(r.creativeId);
  }

  /**
   * Peça assentada (§14.2: o 9:16 saiu da fila): 9:16 READY → RENDER_FINISHED (RENDER_READY) + AUTO_APPROVE (APPROVED) na
   * mesma transação, com adName congelado (CLIENTE_MMDD_CODIGO + `_2` em colisão) e finalRender = 9:16; 9:16 FAILED →
   * RENDER_FAILED. 9:16 na fila = nada. Formato sob demanda nunca mexe no criativo (ele já está APPROVED).
   */
  async settleAuto(creativeId: string): Promise<void> {
    await this.locks.run(creativeId, async () => {
      const c = await this.prisma.creative.findUnique({ where: { id: creativeId } });
      if (!c || c.state !== 'RENDERING' || c.archivedAt) return;
      const renders = await this.prisma.render.findMany({ where: { creativeId, stale: false } });
      const item = c.variationItemId ? await this.prisma.variationItem.findUnique({ where: { id: c.variationItemId }, select: { autoType: true, payload: true } }) : null;
      const primary = primaryFormatOf(item?.autoType ?? null, ((item?.payload ?? {}) as { params?: Record<string, unknown> }).params ?? null);
      const outcome = pieceOutcome(renders, primary);
      if (!outcome) return;
      if (outcome === 'failed') {
        await this.sm.transition({ creativeId, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_FAILED' });
        return;
      }
      const vertical = renders.filter((x) => x.format === primary && x.status === 'READY').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const approvedAt = new Date();
      for (let attempt = 1; ; attempt++) {
        const adName = await computeAdName(this.prisma, creativeId);
        try {
          await this.prisma.$transaction(async (tx) => {
            await this.sm.transition({ tx, creativeId, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_READY', data: { editDirty: false } });
            await this.sm.transition({
              tx, creativeId, event: 'AUTO_APPROVE', from: 'RENDER_READY', to: 'APPROVED',
              data: { approvedAt, approvedById: c.createdById, finalRenderId: vertical.id, adName },
            });
            if (c.variationItemId) await tx.variationItem.update({ where: { id: c.variationItemId }, data: { errorCode: null, failReason: null } });
          });
          break;
        } catch (e) {
          if (!isAdNameConflict(e) || attempt >= AD_NAME_ATTEMPTS) throw e;
        }
      }
      this.sm.announce(creativeId);
    });
  }
}
