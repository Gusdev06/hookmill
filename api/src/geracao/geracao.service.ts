import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreativeDetail, CreativeState, EngineCatalog, Estimate, EstimateWarning, GenerateResponse, Scene, ScenesResponse, ScenesSummary, Voice,
} from '@maquina/contratos';
import { Prisma, type Creative, type Scene as SceneRow } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { markStale, requireConfirm } from '../criativos/downstream';
import { CreativeEvent, CreativeStateMachine, allowedFrom, assertState, invalidState, pickEvent, assertNotVariation, assertVariationGenerate } from '../criativos/state-machine';
import { CreativeViews, blocksOf, currentScenes, currentTake, scenesSummary } from '../criativos/views';
import { CustosService } from '../custos/custos.service';
import { EdicaoService } from '../edicao/edicao.service';
import { EventosService } from '../eventos/eventos.service';
import {
  CATALOG_SERVICE, GENERATION_SERVICE, isIntegracaoError, takeSecondsFor, type CatalogService, type GenerationService, type SceneDraft,
} from '../integracoes';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { PrismaService } from '../prisma/prisma.service';
import { TAKE_MAX_AUDIO_SEC, takeAudioSec, takeEstimate, takeSeed } from './take';
import { TakeService } from './take.service';
import { TrocaService } from '../troca/troca.service';
import type { Take, TakeKind, TranscriptWord } from '@maquina/contratos';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docDeGeracaoNova, docJson } from '../edicao/editor-doc';

export const FORMATS = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const;
type EngineId = 'SCENES' | 'LIPSYNC';
type Format = (typeof FORMATS)[number];

/** Até o Generate, as escolhas do motor podem mudar (autosave). Depois, só com novo Generate + confirm. */
const ENGINE_EDITABLE: CreativeState[] = ['SCRIPTS_READY', 'SCRIPTS_FAILED', 'SCRIPTS_WRITING', 'AVATAR_PENDING', 'FACES_GENERATING', 'FACES_READY', 'FACES_FAILED', 'ENGINE_PENDING'];
const MAX_ESTIMATE_DRIFT = 1.1;
const AUDIO_LIPSYNC_MIN_SEC = 2; // piso do Pruna (feature 2 §5.1)
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Take planejado de uma geração (§13.5). */
export interface PlannedTake {
  kind: TakeKind;
  speech: string | null;
  sourceStartSec: number | null; sourceEndSec: number | null;
  /** AUDIO_LIPSYNC: palavras do teardown na janela, relativas ao início do take */
  words: TranscriptWord[] | null;
}

/** 422 LIPSYNC_AUDIO_TOO_LONG quando o áudio do take passa de 600 s (texto: duração estimada pela fala). */
export function assertTakeLength(t: Pick<PlannedTake, 'kind' | 'speech' | 'sourceStartSec' | 'sourceEndSec'>): void {
  const sec = t.kind === 'AUDIO_LIPSYNC' ? (t.sourceEndSec ?? 0) - (t.sourceStartSec ?? 0) : takeSecondsFor(t.speech ?? '');
  if (sec > TAKE_MAX_AUDIO_SEC) throw new AppException('LIPSYNC_AUDIO_TOO_LONG', { durationSec: r3(sec), maxSec: 600 });
}

@Injectable()
export class GeracaoService {
  private readonly log = new Logger('Geracao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly custos: CustosService,
    private readonly eventos: EventosService,
    private readonly edicao: EdicaoService,
    private readonly locks: KeyedMutex,
    private readonly takes: TakeService,
    private readonly troca: TrocaService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
  ) {}

  // ───────── catálogo ─────────

  engines(): EngineCatalog {
    return { engines: this.catalog.engines(), formats: [...FORMATS] };
  }

  voices(language?: string): Voice[] {
    return this.catalog.voices(language).map((v) => ({ id: v.id, name: v.name, language: v.language, gender: v.gender, sample: { url: v.sampleUrl } }));
  }

  private assertModel(engine: EngineId, model: string) {
    const e = this.catalog.engines().find((x) => x.id === engine);
    if (!e?.models.some((m) => m.id === model)) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'model', rule: 'isEngineModel' }] });
    }
  }

  private async creative(auth: AuthContext, id: string): Promise<Creative> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  /** Cenas planejadas a partir do roteiro escolhido (a ia decide a quebra). Exige roteiro E rosto escolhidos. */
  private async plan(c: Creative, engine: EngineId, model: string): Promise<{ drafts: SceneDraft[]; faceDescription: string | null }> {
    if (!c.selectedScriptId || !c.selectedFaceId) throw invalidState(c.state, ['ENGINE_PENDING']);
    this.assertModel(engine, model);
    const script = await this.prisma.script.findUniqueOrThrow({ where: { id: c.selectedScriptId } });
    const face = await this.prisma.face.findUnique({ where: { id: c.selectedFaceId }, select: { description: true } });
    try {
      return { drafts: this.catalog.splitScenes(blocksOf(script.blocks), engine, model), faceDescription: c.faceDescription ?? face?.description ?? null };
    } catch (e) {
      if (isIntegracaoError(e)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'model', rule: e.code }] });
      throw e;
    }
  }

  private calc(engine: EngineId, model: string, drafts: SceneDraft[], format: Format, voiceId?: string | null, faceDescription?: string | null) {
    // voiceId/faceDescription: o aviso de voz × rosto é da ia (estrutura.md §2.1); objeto montado antes pra
    // funcionar com a assinatura antiga e a nova do CatalogService.estimate.
    const input = { engine, model, scenes: drafts, format, ...(voiceId && { voiceId }), ...(faceDescription && { faceDescription }) };
    try {
      return this.catalog.estimate(input);
    } catch (e) {
      if (isIntegracaoError(e)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'model', rule: e.code }] });
      throw e;
    }
  }

  async estimate(auth: AuthContext, creativeId: string, q: { engine: EngineId; model: string; format: Format; voiceId?: string }): Promise<Estimate> {
    const c = await this.creative(auth, creativeId);
    const vplan = c.origin === 'VARIATION' ? await this.variationPlan(c) : null;
    const { drafts, faceDescription } = vplan ?? (await this.plan(c, q.engine, q.model));
    const e = vplan?.swap
      ? await this.swapGenerationEstimate(c, vplan)
      : vplan
        ? this.calcVariation(q.model, vplan, q.format, q.voiceId, faceDescription)
        : this.calc(q.engine, q.model, drafts, q.format, q.voiceId, faceDescription);
    const kinds = ['VIDEO', 'TTS', 'LIPSYNC', 'TRANSCRIBE'] as const;
    return {
      costUsd: e.costUsd,
      etaSec: e.etaSec,
      sceneCount: drafts.length,
      lines: e.lines
        .filter((l): l is typeof l & { kind: (typeof kinds)[number] } => (kinds as readonly string[]).includes(l.kind))
        .map((l) => ({ kind: l.kind, units: l.units, unit: l.unit, unitPriceUsd: l.unitPriceUsd, amountUsd: l.amountUsd })),
      spend: await this.custos.spendWith(auth.workspaceId, e.costUsd),
      warnings: (e.warnings as string[]).filter((w): w is EstimateWarning => w === 'voice_gender_mismatch'),
    };
  }

  async updateEngine(auth: AuthContext, creativeId: string, dto: { engine?: EngineId; engineModel?: string; voiceId?: string | null; format?: Format }): Promise<CreativeDetail> {
    await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotVariation(c);
      assertState(c.state, ENGINE_EDITABLE);
      const engine = dto.engine ?? c.engine;
      const model = dto.engineModel ?? (dto.engine && dto.engine !== c.engine ? null : c.engineModel);
      if (engine && model) this.assertModel(engine, model);
      if (dto.voiceId && !this.catalog.voices().some((v) => v.id === dto.voiceId)) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'voiceId', rule: 'isVoice' }] });
      }
      await this.prisma.creative.update({
        where: { id: c.id },
        data: {
          ...(dto.engine !== undefined && { engine: dto.engine, engineModel: model }),
          ...(dto.engineModel !== undefined && { engineModel: dto.engineModel }),
          ...(dto.voiceId !== undefined && { voiceId: dto.voiceId }),
          ...(dto.format !== undefined && { format: dto.format }),
        },
      });
      this.sm.announce(c.id);
    });
    return (await this.views.detailById(auth.workspaceId, creativeId))!;
  }

  // ───────── Generate ─────────

  async generate(
    auth: AuthContext, creativeId: string,
    dto: { engine: EngineId; engineModel: string; voiceId?: string; format: Format; expectedCostUsd: number; confirm?: boolean },
  ): Promise<GenerateResponse> {
    const sceneIds = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertVariationGenerate(c, dto);
      if (c.origin !== 'VARIATION' && dto.engine === 'LIPSYNC' && !dto.voiceId) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'voiceId', rule: 'isNotEmpty' }] });
      }
      const ev = pickEvent(c.state, ['GENERATE', 'REGENERATE_ALL']);
      if (dto.voiceId && !this.catalog.voices().some((v) => v.id === dto.voiceId)) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'voiceId', rule: 'isVoice' }] });
      }
      // variação: mesmo plano de cenas da última geração (trechos/pipelines do lote); do zero: plano v1 pelo roteiro
      const vplan = c.origin === 'VARIATION' ? await this.variationPlan(c) : null;
      const { drafts, faceDescription } = vplan ?? (await this.plan(c, dto.engine, dto.engineModel));
      const est = vplan?.swap
        ? await this.swapGenerationEstimate(c, vplan)
        : vplan
          ? this.calcVariation(dto.engineModel, vplan, dto.format, dto.voiceId, faceDescription)
          : this.calc(dto.engine, dto.engineModel, drafts, dto.format, dto.voiceId, faceDescription);
      // §13.5: lipsync = 1 take por geração (criativo do zero: TTS do texto inteiro; variação: o take do plano)
      const take: PlannedTake | null = vplan
        ? vplan.take
        : dto.engine === 'LIPSYNC'
          ? { kind: 'TTS_LIPSYNC', speech: joinSpeech(drafts.map((d) => d.speech)), sourceStartSec: null, sourceEndSec: null, words: null }
          : null;
      if (take) assertTakeLength(take);
      if (est.costUsd > dto.expectedCostUsd * MAX_ESTIMATE_DRIFT) throw new AppException('ESTIMATE_CHANGED', { estimateUsd: est.costUsd });
      if (ev === 'REGENERATE_ALL') await requireConfirm(this.prisma, c.id, dto.confirm);
      await this.custos.assertWithinCap(auth.workspaceId, est.costUsd);

      const ids = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({
          tx, creativeId: c.id, event: ev, from: c.state, to: 'SCENES_GENERATING',
          data: {
            engine: dto.engine, engineModel: dto.engineModel, voiceId: dto.engine === 'LIPSYNC' ? dto.voiceId ?? null : null,
            format: dto.format, estimatedCostUsd: est.costUsd, generatedAt: new Date(),
            // editor-v1 §3.2: Generate novo zera cortes e correções de palavra; as camadas ficam
            ...(c.editDoc != null && { editDoc: docJson(docDeGeracaoNova(c.editDoc)) }),
          },
        });
        await markStale(tx, c.id);
        const last = await tx.scene.findFirst({ where: { creativeId: c.id }, orderBy: { generation: 'desc' }, select: { generation: true } });
        const lastTake = await tx.take.findFirst({ where: { creativeId: c.id }, orderBy: { generation: 'desc' }, select: { generation: true } });
        const generation = Math.max(last?.generation ?? 0, lastTake?.generation ?? 0) + 1;
        const now = new Date();
        const takeRow = take ? await this.createTake(tx, c, generation, take, now) : null;
        const out: string[] = [];
        for (const [k, d] of drafts.entries()) {
          const v = vplan?.scenes[k];
          const s = await tx.scene.create({
            data: {
              workspaceId: c.workspaceId, creativeId: c.id, generation, index: d.index, label: d.label,
              startSec: d.startSec, endSec: d.endSec, speech: d.speech, visualPrompt: d.visualPrompt, status: 'QUEUED', startedAt: now,
              ...(takeRow
                ? { pipeline: 'TAKE_SLICE' as const, takeId: takeRow.id }
                : v && {
                    pipeline: v.pipeline, sourceStartSec: v.sourceStartSec, sourceEndSec: v.sourceEndSec,
                    ...(v.words ? { words: v.words as Prisma.InputJsonValue } : {}),
                    ...(v.startFrame != null && v.endFrame != null && { startFrame: v.startFrame, endFrame: v.endFrame }),
                  }),
            },
          });
          out.push(s.id);
        }
        return { sceneIds: out, takeId: takeRow?.id ?? null };
      });
      this.sm.announce(c.id);
      return ids;
    });

    const fresh = await this.prisma.creative.findUniqueOrThrow({ where: { id: creativeId } });
    let submitted = 0;
    if (sceneIds.takeId) {
      if (await this.takes.submitFirstStep(fresh, sceneIds.takeId)) submitted++;
    } else {
      for (const id of sceneIds.sceneIds) if (await this.submitFirstStep(fresh, id)) submitted++;
    }
    await this.settle(creativeId); // cenas que já falharam na submissão podem fechar a geração
    if (!submitted) {
      throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' });
    }
    const scenes = await this.prisma.scene.findMany({ where: { id: { in: sceneIds.sceneIds } }, orderBy: { index: 'asc' }, include: { clipFile: true } });
    return {
      creative: (await this.views.detailById(auth.workspaceId, creativeId))!,
      scenes: await Promise.all(scenes.map((s) => this.views.scene({ ...s, status: s.status === 'GENERATING' ? 'QUEUED' : s.status }))),
    };
  }

  /** Cria o take da geração (status QUEUED, seed 7). As fatias são criadas pelo chamador com takeId. */
  async createTake(tx: Prisma.TransactionClient, c: Pick<Creative, 'id' | 'workspaceId'>, generation: number, t: PlannedTake, now: Date) {
    return tx.take.create({
      data: {
        workspaceId: c.workspaceId, creativeId: c.id, generation, kind: t.kind, status: 'QUEUED', seed: takeSeed(1), startedAt: now,
        speech: t.speech, sourceStartSec: t.sourceStartSec, sourceEndSec: t.sourceEndSec,
        durationSec: t.kind === 'AUDIO_LIPSYNC' && t.sourceStartSec != null && t.sourceEndSec != null ? r3(t.sourceEndSec - t.sourceStartSec) : null,
        ...(t.words && { words: t.words as unknown as Prisma.InputJsonValue }),
      },
    });
  }

  /** URL assinada do rosto escolhido (6 h) pra a ia. */
  async faceUrl(c: Pick<Creative, 'selectedFaceId'>): Promise<string> {
    const face = c.selectedFaceId ? await this.prisma.face.findUnique({ where: { id: c.selectedFaceId }, include: { file: true } }) : null;
    if (!face?.file) throw new Error('rosto escolhido sem arquivo');
    return this.storage.signedUrl(face.file);
  }

  /** Primeiro passo da cadeia da cena: SCENE_VIDEO (SCENES) ou TTS (LIPSYNC). Falha na submissão = cena FAILED. */
  async submitFirstStep(c: Creative, sceneId: string): Promise<boolean> {
    const s = await this.prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
    // feature 2: REUSE não chama provedor (copia da dona quando ela fica READY)
    if (s.pipeline === 'REUSE') {
      await this.syncReuse(s.id);
      return true;
    }
    // §13.5: fatia de take não tem passo próprio (o take é submetido por TakeService); SOURCE_CUT não chama provedor
    if (s.pipeline === 'TAKE_SLICE') return true;
    // §13.15: trecho do Trocar avatar com Kling/Seedance (janelas em sequência, cadeia própria)
    if (s.pipeline === 'SWAP_VIDEO') return this.troca.submitFirstStep(c, s.id);
    try {
      if (s.pipeline === 'AUDIO_LIPSYNC') {
        await this.submitAudioLipsync(c, s);
      } else if (c.engine === 'LIPSYNC') {
        if (!c.voiceId) throw new Error('LIPSYNC sem voiceId');
        await this.gen.submitTts({ workspaceId: c.workspaceId, sceneId: s.id, voiceId: c.voiceId, text: s.speech, language: c.language });
      } else {
        await this.gen.submitSceneVideo({
          workspaceId: c.workspaceId, sceneId: s.id, model: c.engineModel ?? '', faceImageUrl: await this.faceUrl(c),
          speech: s.speech, visualPrompt: s.visualPrompt, durationSec: (num(s.endSec) ?? 0) - (num(s.startSec) ?? 0),
          format: c.format, language: c.language,
        });
      }
      await this.prisma.scene.updateMany({ where: { id: s.id, status: 'QUEUED' }, data: { status: 'GENERATING', progress: 5 } });
      return true;
    } catch (e) {
      // bloqueio de conteúdo na submissão = cena FAILED SAFETY_BLOCK (não conta como provedor fora do ar)
      const blocked = isIntegracaoError(e) && e.code === 'SAFETY_BLOCK';
      this.log.warn(`submissão da cena ${s.id} falhou: ${(e as Error).message}`);
      await this.failScene(s.id, blocked ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR');
      return blocked;
    }
  }

  async failScene(sceneId: string, code: string) {
    const s = await this.prisma.scene.update({
      where: { id: sceneId },
      data: { status: 'FAILED', errorCode: asAsyncErrorCode(code), failReason: failReasonFor(asAsyncErrorCode(code)) },
      include: { clipFile: true },
    });
    await this.publishScene(s);
    await this.propagateToFollowers(s.id); // feature 2: seguidoras REUSE falham com o mesmo código
  }

  // ───────── feature 2: AUDIO_LIPSYNC e REUSE ─────────

  /**
   * Plano de cenas de um criativo de variação = o da última geração (mesmos trechos do campeão e pipelines do lote).
   * REUSE vira cena própria: no novo Generate o rosto pode ter mudado (pedido FACE) e a dona é de outro criativo.
   */
  private async variationPlan(c: Creative) {
    const last = await this.prisma.scene.findFirst({ where: { creativeId: c.id }, orderBy: { generation: 'desc' }, select: { generation: true } });
    if (!last || !c.selectedFaceId) throw invalidState(c.state, ['ENGINE_PENDING']);
    const prev = await this.prisma.scene.findMany({ where: { creativeId: c.id, generation: last.generation }, orderBy: { index: 'asc' } });
    // §13.5: geração anterior com take = mesmo take (tipo, janela do campeão, palavras); a fala é a das fatias
    const prevTake = prev.some((p) => p.pipeline === 'TAKE_SLICE')
      ? await this.prisma.take.findFirst({ where: { creativeId: c.id, generation: last.generation } })
      : null;
    const take: PlannedTake | null = prevTake
      ? {
          kind: prevTake.kind, speech: prevTake.kind === 'TTS_LIPSYNC' ? joinSpeech(prev.map((p) => p.speech)) : prevTake.speech,
          sourceStartSec: num(prevTake.sourceStartSec), sourceEndSec: num(prevTake.sourceEndSec),
          words: prevTake.kind === 'AUDIO_LIPSYNC' && Array.isArray(prevTake.words) ? (prevTake.words as unknown as TranscriptWord[]) : null,
        }
      : null;
    const scenes = prev.map((p) => ({
      pipeline: (p.pipeline === 'REUSE' ? 'TTS_LIPSYNC' : p.pipeline) as SceneRow['pipeline'],
      sourceStartSec: p.sourceStartSec, sourceEndSec: p.sourceEndSec,
      // §13.15: SWAP_VIDEO mantém o trecho (frames) e as palavras do teardown; janelas replanejadas na submissão
      words: p.pipeline === 'AUDIO_LIPSYNC' || p.pipeline === 'SWAP_VIDEO' ? p.words : null,
      startFrame: p.pipeline === 'SWAP_VIDEO' ? p.startFrame : null, endFrame: p.pipeline === 'SWAP_VIDEO' ? p.endFrame : null,
    }));
    const drafts: SceneDraft[] = prev.map((p) => ({
      index: p.index, label: p.label, startSec: num(p.startSec) ?? 0, endSec: num(p.endSec) ?? 0, speech: p.speech, visualPrompt: p.visualPrompt,
    }));
    const face = await this.prisma.face.findUnique({ where: { id: c.selectedFaceId }, select: { description: true } });
    return { drafts, scenes, take, faceDescription: c.faceDescription ?? face?.description ?? null, swap: prev.some((p) => p.pipeline === 'SWAP_VIDEO') };
  }

  /** §13.15: (re)fazer todos os trechos SWAP_VIDEO da geração (pedido FACE + novo Generate): soma dos trechos. */
  private async swapGenerationEstimate(c: Creative, v: Awaited<ReturnType<GeracaoService['variationPlan']>>) {
    let costUsd = 0;
    let etaSec = 0;
    for (const s of v.scenes.filter((x) => x.pipeline === 'SWAP_VIDEO')) {
      const e = await this.troca.regenerateEstimate(c, s);
      costUsd += e.costUsd;
      etaSec = Math.max(etaSec, e.etaSec);
    }
    if (!costUsd) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' }); // catálogo ainda sem cotação (I6)
    return { costUsd: Math.round(costUsd * 10_000) / 10_000, etaSec, lines: [] as { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }[], warnings: [] as string[] };
  }

  private calcVariation(model: string, v: Awaited<ReturnType<GeracaoService['variationPlan']>>, format: Format, voiceId?: string | null, faceDescription?: string | null) {
    const audioSecByScene = v.scenes.map((s, i) =>
      s.sourceStartSec != null && s.sourceEndSec != null
        ? Math.max(AUDIO_LIPSYNC_MIN_SEC, (num(s.sourceEndSec) ?? 0) - (num(s.sourceStartSec) ?? 0))
        : v.drafts[i].endSec - v.drafts[i].startSec,
    );
    try {
      if (v.take) {
        const t = v.take;
        return this.catalog.estimate({
          engine: 'LIPSYNC', model, scenes: v.drafts, format, ...(voiceId && { voiceId }), ...(faceDescription && { faceDescription }),
          pipelines: v.drafts.map(() => 'TAKE_SLICE' as const),
          take: { kind: t.kind, ...(t.kind === 'AUDIO_LIPSYNC' && { audioSec: Math.max(AUDIO_LIPSYNC_MIN_SEC, (t.sourceEndSec ?? 0) - (t.sourceStartSec ?? 0)) }) },
        });
      }
      return this.catalog.estimate({
        engine: 'LIPSYNC', model, scenes: v.drafts, format, ...(voiceId && { voiceId }), ...(faceDescription && { faceDescription }),
        pipelines: v.scenes.map((s) => s.pipeline), audioSecByScene,
      });
    } catch (e) {
      if (isIntegracaoError(e)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'model', rule: e.code }] });
      throw e;
    }
  }

  /** AUDIO_LIPSYNC: corta o trecho do áudio do campeão (piso de 2 s do Pruna), sobe como SCENE_AUDIO e chama o lipsync. */
  private async submitAudioLipsync(c: Creative, s: SceneRow): Promise<void> {
    if (!c.championId) throw new Error('AUDIO_LIPSYNC sem campeão');
    const ch = await this.prisma.champion.findUnique({ where: { id: c.championId }, include: { audioFile: true } });
    if (!ch?.audioFile) throw new Error('campeão sem áudio extraído');
    const start = num(s.sourceStartSec) ?? 0;
    const total = num(ch.durationSec) ?? Number.MAX_SAFE_INTEGER;
    let end = num(s.sourceEndSec) ?? start + AUDIO_LIPSYNC_MIN_SEC;
    if (end - start < AUDIO_LIPSYNC_MIN_SEC) end = Math.min(total, start + AUDIO_LIPSYNC_MIN_SEC);
    const dir = await mkdtemp(join(tmpdir(), 'maquina-slice-'));
    try {
      const src = join(dir, 'champion.m4a');
      await this.storage.downloadTo(ch.audioFile, src);
      const [out] = await this.media.sliceAudio(src, [{ startSec: start, endSec: end }], dir);
      const file = await this.storage.put(out, {
        workspaceId: c.workspaceId, kind: 'SCENE_AUDIO', mimeType: /\.wav$/i.test(out) ? 'audio/wav' : 'audio/mp4', meta: { durationSec: end - start },
      });
      await this.prisma.scene.update({ where: { id: s.id }, data: { audioFileId: file.id, progress: 35 } });
      await this.gen.submitLipsync({
        workspaceId: c.workspaceId, sceneId: s.id, faceImageUrl: await this.faceUrl(c),
        audioUrl: await this.storage.signedUrl(file), visualPrompt: s.visualPrompt, format: c.format,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Cena REUSE: se a dona já está READY, copia clipe/miniatura/áudio/words (arquivo imutável, só referência) e marca
   * READY sem custo; dona FAILED = seguidora FAILED com o mesmo código; dona pendente = espera.
   */
  async syncReuse(sceneId: string): Promise<void> {
    const s = await this.prisma.scene.findUnique({ where: { id: sceneId }, include: { reuseOf: true } });
    if (!s || s.pipeline !== 'REUSE' || s.stale || (s.status !== 'QUEUED' && s.status !== 'GENERATING')) return;
    const owner = s.reuseOf;
    if (!owner) return this.failScene(s.id, 'PROVIDER_ERROR');
    if (owner.status === 'READY' && owner.clipFileId && owner.thumbnailFileId) {
      const r = await this.prisma.scene.updateMany({
        where: { id: s.id, status: { in: ['QUEUED', 'GENERATING'] } },
        data: {
          status: 'READY', progress: 100, readyAt: new Date(), clipFileId: owner.clipFileId, thumbnailFileId: owner.thumbnailFileId,
          audioFileId: owner.audioFileId, words: owner.words ?? Prisma.DbNull, failReason: null, errorCode: null,
        },
      });
      if (r.count) await this.publishScene(await this.prisma.scene.findUniqueOrThrow({ where: { id: s.id } }));
    } else if (owner.status === 'FAILED') {
      const code = asAsyncErrorCode(owner.errorCode);
      await this.prisma.scene.updateMany({ where: { id: s.id, status: { in: ['QUEUED', 'GENERATING'] } }, data: { status: 'FAILED', errorCode: code, failReason: failReasonFor(code) } });
      await this.publishScene(await this.prisma.scene.findUniqueOrThrow({ where: { id: s.id } }));
    }
  }

  /** Dona mudou (READY ou FAILED): atualiza as seguidoras REUSE pendentes e fecha a geração dos criativos delas. */
  async propagateToFollowers(ownerSceneId: string): Promise<void> {
    const followers = await this.prisma.scene.findMany({
      where: { reuseOfSceneId: ownerSceneId, pipeline: 'REUSE', stale: false, status: { in: ['QUEUED', 'GENERATING'] } },
      select: { id: true, creativeId: true },
    });
    for (const f of followers) {
      await this.syncReuse(f.id);
      await this.settle(f.creativeId);
    }
  }

  async publishScene(s: SceneRow) {
    if (!this.eventos.listenerCount(s.creativeId)) return;
    const summary = scenesSummary(await currentScenes(this.prisma, s.creativeId));
    this.eventos.publish(s.creativeId, 'scene.updated', { ...(await this.views.scene(s)), summary });
  }

  /**
   * Nenhuma cena vigente pendente: todas READY → RENDERING com render automático; ≥1 FAILED → SCENES_FAILED.
   * Serializado por criativo (duas cenas terminando juntas não se perdem uma da outra).
   */
  async settle(creativeId: string) {
    let kick = false;
    await this.locks.run(creativeId, async () => {
      const c = await this.prisma.creative.findUnique({ where: { id: creativeId } });
      if (!c || c.archivedAt || c.state !== 'SCENES_GENERATING') return;
      const scenes = await currentScenes(this.prisma, creativeId);
      if (!scenes.length || scenes.some((s) => s.status === 'QUEUED' || s.status === 'GENERATING')) return;
      if (scenes.every((s) => s.status === 'READY')) {
        await this.prisma.$transaction(async (tx) => {
          await this.sm.transition({ tx, creativeId, event: 'SCENES_SETTLED', from: 'SCENES_GENERATING', to: 'RENDERING' });
          await this.edicao.createRender(tx, creativeId);
        });
        kick = true;
      } else {
        await this.sm.transition({ creativeId, event: 'SCENES_SETTLED', from: 'SCENES_GENERATING', to: 'SCENES_FAILED' }).catch(() => undefined);
      }
    });
    if (kick) {
      this.sm.announce(creativeId);
      this.edicao.kick();
    }
  }

  // ───────── cenas ─────────

  async scenes(auth: AuthContext, creativeId: string): Promise<ScenesResponse> {
    const c = await this.creative(auth, creativeId);
    const rows = await currentScenes(this.prisma, c.id);
    const files = await this.prisma.file.findMany({ where: { id: { in: rows.map((r) => r.clipFileId).filter((x): x is string => !!x) } } });
    const byId = new Map(files.map((f) => [f.id, f]));
    const summary: ScenesSummary = scenesSummary(rows);
    return { summary, scenes: await Promise.all(rows.map((s) => this.views.scene({ ...s, clipFile: s.clipFileId ? byId.get(s.clipFileId) ?? null : null }))) };
  }

  /**
   * Regerar UMA cena (alvo READY ou FAILED) sem mexer nas outras. Também usado por "Request changes" SCENE/LINE
   * (evento CHANGE_SCENE). Renders vigentes viram stale.
   */
  async regenerateScene(
    auth: AuthContext, creativeId: string, index: number,
    patch: { visualPrompt?: string; speech?: string; confirm?: boolean; expectedCostUsd?: number },
    event: Extract<CreativeEvent, 'REGENERATE_SCENE' | 'CHANGE_SCENE'> = 'REGENERATE_SCENE',
    onCommit?: (tx: Prisma.TransactionClient, c: Creative) => Promise<unknown>,
  ): Promise<Scene> {
    // §13.5: fatia de take → refazer = o take inteiro (rota de cena exige confirm + expectedCostUsd; o pedido de
    // ajuste da revisão já mostrou o preço em changeOptions e vale como confirmação)
    const pre = await this.creative(auth, creativeId);
    const target = (await currentScenes(this.prisma, pre.id)).find((s) => s.index === index);
    if (target?.pipeline === 'TAKE_SLICE' && target.takeId) {
      const take = await this.prisma.take.findUniqueOrThrow({ where: { id: target.takeId } });
      const speechPatch = patch.speech !== undefined ? { index, speech: patch.speech } : undefined;
      if (event === 'REGENERATE_SCENE' && (!patch.confirm || patch.expectedCostUsd === undefined)) {
        const estimateUsd = this.takeEstimateFor(pre, take, speechPatch ? await this.patchedSpeech(take.id, speechPatch) : take.speech).costUsd;
        throw new AppException('INVALID_STATE', { state: pre.state, allowed: allowedFrom(event), reason: 'regenerate_take', takeId: take.id, estimateUsd });
      }
      await this.regenerateTake(auth, creativeId, { expectedCostUsd: patch.expectedCostUsd, speechPatch }, event, onCommit);
      const s = await this.prisma.scene.findUniqueOrThrow({ where: { id: target.id }, include: { clipFile: true } });
      return this.views.scene({ ...s, status: s.status === 'GENERATING' ? 'QUEUED' : s.status });
    }
    const sceneId = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      pickEvent(c.state, [event]);
      const scene = (await currentScenes(this.prisma, c.id)).find((s) => s.index === index);
      if (!scene) throw new AppException('NOT_FOUND');
      if (scene.pipeline === 'TAKE_SLICE' || scene.pipeline === 'SOURCE_CUT') throw invalidState(c.state, allowedFrom(event));
      if (scene.status !== 'READY' && scene.status !== 'FAILED') throw invalidState(c.state, allowedFrom(event));
      // §13.15: trecho SWAP_VIDEO = todas as janelas + v2v de novo; a copy é a do campeão (speech não muda)
      const swap = scene.pipeline === 'SWAP_VIDEO';
      const draft: SceneDraft = {
        index, label: scene.label, startSec: num(scene.startSec) ?? 0, endSec: num(scene.endSec) ?? 0,
        speech: swap ? scene.speech : patch.speech ?? scene.speech, visualPrompt: patch.visualPrompt ?? scene.visualPrompt,
      };
      let est: { costUsd: number };
      if (swap) {
        est = await this.troca.regenerateEstimate(c, scene);
        if (event === 'REGENERATE_SCENE' && (!patch.confirm || patch.expectedCostUsd === undefined)) {
          throw new AppException('INVALID_STATE', { state: c.state, allowed: allowedFrom(event), reason: 'regenerate_swap_scene', estimateUsd: est.costUsd });
        }
        if (patch.expectedCostUsd !== undefined && est.costUsd > patch.expectedCostUsd * MAX_ESTIMATE_DRIFT) {
          throw new AppException('ESTIMATE_CHANGED', { estimateUsd: est.costUsd });
        }
      } else {
        est = this.calc((c.engine ?? 'SCENES') as EngineId, c.engineModel ?? '', [draft], c.format, c.voiceId);
      }
      await this.custos.assertWithinCap(auth.workspaceId, est.costUsd);
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event, from: c.state, to: 'SCENES_GENERATING' });
        const r = await tx.scene.updateMany({
          where: { id: scene.id, status: { in: ['READY', 'FAILED'] } },
          data: {
            status: 'QUEUED', progress: 0, attempt: { increment: 1 }, failReason: null, errorCode: null, clipFileId: null, thumbnailFileId: null, audioFileId: null,
            // AUDIO_LIPSYNC/SWAP_VIDEO (A): as words são do trecho original (não mudam); o resto recebe do TRANSCRIBE
            ...(scene.pipeline !== 'AUDIO_LIPSYNC' && !swap && { words: Prisma.DbNull }),
            ...(swap && TrocaService.resetData()),
            // "Refazer cena" numa seguidora REUSE a torna independente (cobrada), feature 2 §5.2
            ...(scene.pipeline === 'REUSE' && { pipeline: 'TTS_LIPSYNC' as const, reuseOfSceneId: null }),
            readyAt: null, startedAt: new Date(), speech: draft.speech, visualPrompt: draft.visualPrompt,
          },
        });
        if (r.count !== 1) throw invalidState(c.state, allowedFrom(event));
        await markStale(tx, c.id, { scenes: false, renders: true });
        if (onCommit) await onCommit(tx, c);
      });
      this.sm.announce(c.id);
      return scene.id;
    });
    const c = await this.prisma.creative.findUniqueOrThrow({ where: { id: creativeId } });
    const ok = await this.submitFirstStep(c, sceneId);
    await this.settle(creativeId);
    if (!ok) {
      throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' });
    }
    const s = await this.prisma.scene.findUniqueOrThrow({ where: { id: sceneId }, include: { clipFile: true } });
    await this.publishScene(s);
    return this.views.scene({ ...s, status: s.status === 'GENERATING' ? 'QUEUED' : s.status });
  }


  // ───────── §13.5: take ─────────

  private takeEstimateFor(c: Pick<Creative, 'format' | 'voiceId'>, t: Pick<import('@prisma/client').Take, 'kind' | 'durationSec' | 'sourceStartSec' | 'sourceEndSec'>, speech: string | null, sameAudio = true) {
    try {
      return takeEstimate(this.catalog, { ...t, speech, durationSec: sameAudio ? t.durationSec : null }, c.format, c.voiceId);
    } catch (e) {
      if (isIntegracaoError(e)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'model', rule: e.code }] });
      throw e;
    }
  }

  /** Texto inteiro do take com a fala nova de uma fatia (pedido LINE). */
  private async patchedSpeech(takeId: string, p: { index: number; speech: string }): Promise<string> {
    const slices = await this.prisma.scene.findMany({ where: { takeId, stale: false }, orderBy: { index: 'asc' } });
    return joinSpeech(slices.map((s) => (s.index === p.index ? p.speech : s.speech)));
  }

  /**
   * Refaz o take inteiro (POST /take/regenerate, "Refazer cena" numa fatia com confirm, pedido SCENE/LINE da revisão).
   * Take READY|FAILED; nova tentativa (attempt + 1, seed 7 + attempt); fatias voltam a QUEUED; renders viram stale.
   * expectedCostUsd ausente = sem checagem de deriva (pedido da revisão, preço já mostrado no changeOptions).
   */
  async regenerateTake(
    auth: AuthContext, creativeId: string,
    opts: { expectedCostUsd?: number; speechPatch?: { index: number; speech: string } },
    event: Extract<CreativeEvent, 'REGENERATE_SCENE' | 'CHANGE_SCENE'> = 'REGENERATE_SCENE',
    onCommit?: (tx: Prisma.TransactionClient, c: Creative) => Promise<unknown>,
  ): Promise<Take> {
    const takeId = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      pickEvent(c.state, [event]);
      const take = await currentTake(this.prisma, c.id);
      if (!take) throw invalidState(c.state, []);
      if (take.status !== 'READY' && take.status !== 'FAILED') throw invalidState(c.state, allowedFrom(event));
      const p = opts.speechPatch;
      if (p && take.kind !== 'TTS_LIPSYNC') throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'change_not_available' });
      const speech = p ? await this.patchedSpeech(take.id, p) : take.speech;
      if (p) assertTakeLength({ kind: take.kind, speech, sourceStartSec: null, sourceEndSec: null });
      const est = this.takeEstimateFor(c, take, speech, !p);
      if (opts.expectedCostUsd !== undefined && est.costUsd > opts.expectedCostUsd * MAX_ESTIMATE_DRIFT) {
        throw new AppException('ESTIMATE_CHANGED', { estimateUsd: est.costUsd });
      }
      await this.custos.assertWithinCap(auth.workspaceId, est.costUsd);
      const tts = take.kind === 'TTS_LIPSYNC';
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event, from: c.state, to: 'SCENES_GENERATING' });
        const attempt = take.attempt + 1;
        const r = await tx.take.updateMany({
          where: { id: take.id, status: { in: ['READY', 'FAILED'] } },
          data: {
            status: 'QUEUED', progress: 0, attempt, seed: takeSeed(attempt), clipFileId: null, thumbnailFileId: null,
            errorCode: null, failReason: null, readyAt: null, startedAt: new Date(), speech,
            // TTS: áudio e palavras vêm de novo; AUDIO_LIPSYNC: a janela e as palavras do teardown não mudam
            ...(tts && { audioFileId: null, durationSec: null, words: Prisma.DbNull }),
          },
        });
        if (r.count !== 1) throw invalidState(c.state, allowedFrom(event));
        if (p) await tx.scene.updateMany({ where: { takeId: take.id, stale: false, index: p.index }, data: { speech: p.speech } });
        await tx.scene.updateMany({
          where: { takeId: take.id, stale: false },
          data: {
            status: 'QUEUED', progress: 0, attempt: { increment: 1 }, failReason: null, errorCode: null, clipFileId: null, thumbnailFileId: null,
            audioFileId: null, words: Prisma.DbNull, readyAt: null, startedAt: new Date(),
          },
        });
        await markStale(tx, c.id, { scenes: false, renders: true });
        if (onCommit) await onCommit(tx, c);
      });
      this.sm.announce(c.id);
      return take.id;
    });
    const c = await this.prisma.creative.findUniqueOrThrow({ where: { id: creativeId } });
    const ok = await this.takes.submitFirstStep(c, takeId);
    await this.settle(creativeId);
    if (!ok) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' });
    const t = await this.prisma.take.findUniqueOrThrow({ where: { id: takeId } });
    return this.views.take({ ...t, status: t.status === 'GENERATING' ? 'QUEUED' : t.status }, c.format);
  }
}

/** Falas das fatias unidas, na ordem (o texto inteiro do take). */
export function joinSpeech(parts: string[]): string {
  return parts.map((x) => x.trim()).filter(Boolean).join(' ');
}
