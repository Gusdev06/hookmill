import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { EditResponse, EditSettings, Render, Template } from '@maquina/contratos';
import type { Creative, Prisma } from '@prisma/client';
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
import { RenderError, type RenderInput, type RenderProgress, type RenderService, type ScratchRenderInput } from '../render/contrato';
import { UpdateEditDto } from './edicao.dto';
import { normalizarDoc, resolverProps } from '@maquina/video';
import { EDITABLE, aplicarMudancaDeSettings, definidos, cenaPronta, docJson, editDocOf, montarScratchSource } from './editor-doc';
import { EditorSaves, anunciarEdicao } from './editor-saves';
import { integracoesMode } from '../integracoes';
import { computeAdName, isAdNameConflict } from '../biblioteca/ad-names';
import { AUTO_EDIT_BUILDER, type AutoEditBuilder, type AutoEditContext } from './auto-edit-input';
import { AUTO_EDIT_TEMPLATE, mockRenderFail, pieceOutcome } from './pecas';
import type { AutoVariationType } from '@maquina/contratos';

/** Falha da peça AUTO antes do render (sem vídeo do campeão, etc.): vira o errorCode do item (variacao-auto-v1 §5.3). */
class AutoPieceError extends Error {
  constructor(readonly code: 'SOURCE_UNAVAILABLE' | 'RENDER_ERROR' | 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT', message: string) {
    super(message);
  }
}
const AUTO_FAIL_REASON: Record<AutoPieceError['code'], string> = {
  SOURCE_UNAVAILABLE: 'The original video is no longer available.',
  RENDER_ERROR: 'The render failed. Retry.',
  PAGE_FORBIDDEN: 'The page blocked our reader.',
  PAGE_UNREADABLE: 'We could not read the page.',
  PAGE_TIMEOUT: 'The page took too long to load.',
};
const AD_NAME_ATTEMPTS = 5;

export const RENDER_PORT = Symbol('RENDER_PORT');


export function defaultEditSettings(offerCta: string | null): EditSettings {
  return { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: offerCta ?? '', endCard: true };
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class EdicaoService implements OnModuleDestroy {
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
    @Inject(RENDER_PORT) private readonly renderer: RenderService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
    private readonly saves: EditorSaves,
    @Inject(AUTO_EDIT_BUILDER) private readonly buildAutoInput: AutoEditBuilder,
  ) {}

  onModuleDestroy() {
    this.stopped = true;
  }

  templates(): Template[] {
    return this.renderer.templates().map((t) => ({
      id: t.id as Template['id'],
      kind: t.kind, // §13.6: remix-keep vem com kind 'remix' (fora da escolha do criativo do zero)
      labelKey: t.labelKey,
      thumbnail: { url: `${this.config.publicApiUrl}/api/v1/templates/${t.id}/thumbnail` },
      supportsHeadline: t.supportsHeadline,
    }));
  }

  templateThumbnail(id: string): string | null {
    return this.renderer.templates().find((t) => t.id === id)?.thumbnailPath || null;
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

  // ───────── fila de render (no banco, um por vez, mais antigo primeiro) ─────────

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
      const next = await this.prisma.render.findFirst({
        where: { status: 'QUEUED', creative: { archivedAt: null } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!next) return;
      const claimed = await this.prisma.render.updateMany({
        where: { id: next.id, status: 'QUEUED' },
        data: { status: 'RENDERING', stage: 'bundling', startedAt: new Date() },
      });
      if (claimed.count === 1) await this.process(next.id).catch((e) => this.log.error(`render ${next.id}: ${(e as Error).stack ?? e}`));
    }
  }

  private async publish(renderId: string) {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { file: true } });
    if (r) this.eventos.publish(r.creativeId, 'render.updated', await this.views.render(r));
  }

  private async process(renderId: string) {
    const r = await this.prisma.render.findUniqueOrThrow({ where: { id: renderId }, include: { creative: true } });
    const rs = r.settings as unknown as EditSettings;
    if ((rs as { templateId?: string }).templateId === AUTO_EDIT_TEMPLATE) return this.processAuto(r);
    let input: RenderInput;
    try {
      input = rs.templateId === REMIX_KEEP_TEMPLATE
        ? await this.buildRemixInput(r.id, r.creative)
        : this.inputDe(r.id, await this.fonteDoRender(this.prisma, r.creative), rs, editDocOf(r.doc));
    } catch (e) {
      // sem o que montar (mapa/clipe/rosto): falha explícita do render, nunca peça inventada
      this.log.warn(`render ${r.id}: input remix-keep falhou: ${(e as Error).message}`);
      input = { renderId: r.id, templateId: REMIX_KEEP_TEMPLATE, kind: 'remix-keep', canvas: { width: 0, height: 0, fps: 0, frameCount: 0 }, baseVideoUrl: '', audioPassthroughUrl: '', overlays: [], textLayers: [] };
      await this.prisma.render.updateMany({ where: { id: r.id }, data: { status: 'FAILED', stage: null, failReason: `Could not prepare the edit: ${(e as Error).message}`.slice(0, 300), finishedAt: new Date() } });
      await this.locks.run(r.creativeId, async () => {
        const c = await this.prisma.creative.findUnique({ where: { id: r.creativeId } });
        if (c?.state === 'RENDERING') await this.sm.transition({ creativeId: c.id, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_FAILED' });
      });
      await this.publish(r.id);
      return;
    }
    await this.prisma.render.update({ where: { id: r.id }, data: { input: input as unknown as Prisma.InputJsonValue } });
    await this.publish(r.id);

    let lastWrite = 0;
    const onProgress = (p: RenderProgress) => {
      const now = Date.now();
      if (now - lastWrite < 500 && p.progress < 100) return;
      lastWrite = now;
      void this.prisma.render
        .updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { stage: p.stage, progress: Math.min(99, Math.round(p.progress)), frame: p.frame, totalFrames: p.totalFrames } })
        .then(() => this.publish(r.id))
        .catch(() => undefined);
    };

    let outcome: { ok: true; fileId: string; posterId: string; durationSec: number } | { ok: false; failedFrame: number | null; message: string };
    try {
      const res = await this.renderer.render(input, onProgress);
      await this.prisma.render.updateMany({ where: { id: r.id }, data: { stage: 'uploading', progress: 99 } });
      const [video, poster] = await Promise.all([
        this.storage.put(res.outputPath, {
          workspaceId: r.workspaceId, kind: 'RENDER_VIDEO', mimeType: 'video/mp4',
          meta: { durationSec: res.durationSec, width: res.width, height: res.height },
        }),
        this.storage.put(res.posterPath, {
          workspaceId: r.workspaceId, kind: 'THUMBNAIL', mimeType: res.posterPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
          meta: { width: res.width, height: res.height },
        }),
      ]);
      await rm(dirname(res.outputPath), { recursive: true, force: true }).catch(() => undefined);
      outcome = { ok: true, fileId: video.id, posterId: poster.id, durationSec: res.durationSec };
    } catch (e) {
      const failedFrame = e instanceof RenderError ? e.failedFrame : null;
      this.log.warn(`render ${r.id} falhou: ${(e as Error).message}`);
      outcome = { ok: false, failedFrame, message: (e as Error).message };
    }

    await this.locks.run(r.creativeId, async () => {
      if (outcome.ok) {
        await this.prisma.render.update({
          where: { id: r.id },
          data: { status: 'READY', stage: null, progress: 100, fileId: outcome.fileId, durationSec: outcome.durationSec, finishedAt: new Date() },
        });
      } else {
        const reason = outcome.failedFrame != null ? `The render failed at frame ${outcome.failedFrame}. Render again.` : failReasonFor('RENDER_ERROR');
        await this.prisma.render.update({
          where: { id: r.id },
          data: { status: 'FAILED', stage: null, failReason: reason, failedFrame: outcome.failedFrame, finishedAt: new Date() },
        });
      }
      const [c, fresh] = await Promise.all([
        this.prisma.creative.findUnique({ where: { id: r.creativeId } }),
        this.prisma.render.findUniqueOrThrow({ where: { id: r.id } }),
      ]);
      if (!c || c.state !== 'RENDERING' || fresh.stale) return;
      if (outcome.ok) {
        // editor-v1 §4: revisão do criativo ≠ revisão renderizada = edição não exportada; render antigo (sem revisão) = regra de antes
        const dirty = fresh.editRevision != null ? c.editRevision !== fresh.editRevision : JSON.stringify(c.editSettings) !== JSON.stringify(fresh.settings);
        await this.sm.transition({
          creativeId: c.id, event: 'RENDER_FINISHED', from: 'RENDERING', to: dirty ? 'EDIT_PENDING' : 'RENDER_READY',
          data: { editDirty: dirty, thumbnailFileId: outcome.posterId },
        });
      } else {
        await this.sm.transition({ creativeId: c.id, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_FAILED' });
      }
    });
    await this.publish(r.id);
  }

  // ───────── peças AUTO (variacao-auto-v1 §3.3 e §5.1): 1 criativo, 3 renders (um por formato) ─────────

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
      : batch.pageCapture ? { imageUrl: await this.storage.signedUrl(batch.pageCapture), kind: 'page' as const } : null;
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

  private async processAuto(r: Prisma.RenderGetPayload<{ include: { creative: true } }>) {
    const format = r.format ?? 'VERTICAL_9_16';
    let input: RenderInput;
    try {
      input = this.buildAutoInput(await this.autoContext(r.id, r.creative), format);
      await this.prisma.render.update({ where: { id: r.id }, data: { input: input as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      const code = e instanceof AutoPieceError ? e.code : 'RENDER_ERROR';
      this.log.warn(`render AUTO ${r.id}: input falhou: ${(e as Error).message}`);
      await this.failAuto(r, code, null);
      return;
    }
    await this.publish(r.id);

    let lastWrite = 0;
    const onProgress = (p: RenderProgress) => {
      const now = Date.now();
      if (now - lastWrite < 500 && p.progress < 100) return;
      lastWrite = now;
      void this.prisma.render
        .updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { stage: p.stage, progress: Math.min(99, Math.round(p.progress)), frame: p.frame, totalFrames: p.totalFrames } })
        .catch(() => undefined);
    };
    try {
      // §10: gatilho de mock por oferta (só INTEGRACOES_MODE=mock): a 1ª tentativa do 4:5 do tipo falha
      if (integracoesMode() === 'mock') {
        const [offer, attempt] = await Promise.all([
          this.prisma.offer.findUnique({ where: { id: r.creative.offerId }, select: { notes: true } }),
          this.prisma.render.count({ where: { creativeId: r.creativeId, format } }),
        ]);
        if (mockRenderFail(offer?.notes ?? null, (input as { type?: string }).type ?? null, format, attempt)) throw new RenderError('RENDER_ERROR', 0, 'mock render-fail');
      }
      const res = await this.renderer.render(input, onProgress);
      await this.prisma.render.updateMany({ where: { id: r.id }, data: { stage: 'uploading', progress: 99 } });
      const still = res.mimeType === 'image/png' || res.outputPath.endsWith('.png');
      const out = await this.storage.put(res.outputPath, {
        workspaceId: r.workspaceId, kind: still ? 'RENDER_IMAGE' : 'RENDER_VIDEO', mimeType: still ? 'image/png' : 'video/mp4',
        meta: { durationSec: still ? undefined : res.durationSec, width: res.width, height: res.height },
      });
      const poster = still ? out : await this.storage.put(res.posterPath, {
        workspaceId: r.workspaceId, kind: 'THUMBNAIL', mimeType: res.posterPath.endsWith('.png') ? 'image/png' : 'image/jpeg', meta: { width: res.width, height: res.height },
      });
      await rm(dirname(res.outputPath), { recursive: true, force: true }).catch(() => undefined);
      await this.prisma.render.update({
        where: { id: r.id },
        data: { status: 'READY', stage: null, progress: 100, fileId: out.id, durationSec: res.durationSec, finishedAt: new Date() },
      });
      // pôster da peça = frame do 9:16 (o preview libera antes dos outros formatos, §3.2)
      if (format === 'VERTICAL_9_16') await this.prisma.creative.update({ where: { id: r.creativeId }, data: { thumbnailFileId: poster.id } });
      await this.publish(r.id);
      await this.settleAuto(r.creativeId);
    } catch (e) {
      this.log.warn(`render AUTO ${r.id} falhou: ${(e as Error).message}`);
      await this.failAuto(r, 'RENDER_ERROR', e instanceof RenderError ? e.failedFrame : null);
    }
  }

  /** Render da peça FAILED + código no item (a falha de uma peça não para as outras: a fila segue). */
  private async failAuto(r: { id: string; creativeId: string; creative: Creative }, code: AutoPieceError['code'], failedFrame: number | null) {
    const reason = AUTO_FAIL_REASON[code];
    await this.prisma.render.updateMany({ where: { id: r.id }, data: { status: 'FAILED', stage: null, failReason: reason, failedFrame, finishedAt: new Date() } });
    if (r.creative.variationItemId) {
      await this.prisma.variationItem.update({ where: { id: r.creative.variationItemId }, data: { errorCode: code, failReason: reason } });
    }
    await this.publish(r.id);
    await this.settleAuto(r.creativeId);
  }

  /**
   * Peça assentada (nenhum formato na fila): 3 READY → RENDER_FINISHED (RENDER_READY) + AUTO_APPROVE (APPROVED) na mesma
   * transação, com adName congelado (CLIENTE_MMDD_CODIGO + `_2` em colisão) e finalRender = 9:16; algum FAILED →
   * RENDER_FAILED. Ainda falta formato = nada.
   */
  async settleAuto(creativeId: string): Promise<void> {
    await this.locks.run(creativeId, async () => {
      const c = await this.prisma.creative.findUnique({ where: { id: creativeId } });
      if (!c || c.state !== 'RENDERING' || c.archivedAt) return;
      const renders = await this.prisma.render.findMany({ where: { creativeId, stale: false } });
      const outcome = pieceOutcome(renders);
      if (!outcome) return;
      if (outcome === 'failed') {
        await this.sm.transition({ creativeId, event: 'RENDER_FINISHED', from: 'RENDERING', to: 'RENDER_FAILED' });
        return;
      }
      const vertical = renders.filter((x) => x.format === 'VERTICAL_9_16' && x.status === 'READY').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
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
