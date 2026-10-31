import { DEFAULT_ANSWERS, selectionInfo, WANT_OF } from './selecao';
import type { IterateAnswers, IterateWant, VariationSelection } from '@maquina/contratos';
import { Inject, Injectable } from '@nestjs/common';
import type { AnalysisStage, AutoInsight, FileRef, IterateAnalysis, IterateBatch, IterateError, IteratePiece, IterateStatus } from '@maquina/contratos';
import type { Job, Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { editMapOf, measurementsOf } from '../campeoes/champion-views';
import { faixasDoCampeao } from '../campeoes/faixas-protegidas';
import { CAPTION_CHECK_USD } from '../edicao/checagem-legenda';
import { initials, num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { PRIORITY_BATCH, estimateStaticUsd } from '../edicao/pecas';
import { PecasAutoService } from '../edicao/pecas.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { autoFailReason } from './plano-auto.service';
import { ZipService } from './zip.service';
import { isSampleSettings } from '../amostra/acesso';

export const ITERATE_INCLUDE = {
  offer: true,
  workspace: { select: { name: true, uiLocale: true } },
  createdBy: { select: { id: true, name: true } },
  champion: { include: { videoFile: true, thumbnailFile: true, teardown: { select: { measurements: true } } } },
  items: { orderBy: { index: 'asc' }, select: { id: true, included: true, selection: true, wantKey: true } },
} satisfies Prisma.VariationBatchInclude;
export type IterateRow = Prisma.VariationBatchGetPayload<{ include: typeof ITERATE_INCLUDE }>;


/** Chaves do checklist (§5.2), em ordem. */
export const READING_KEYS = ['decode', 'transcribe', 'cuts', 'edit_map', 'blocks'] as const;
export const BRAIN_KEYS = ['audience', 'offer', 'proof', 'page'] as const;
/** Etapa do CHAMPION_ANALYZE → índice da chave de leitura. */
const READING_STAGE: Record<string, number> = { reading_video: 0, extracting_audio: 1, transcribing: 1, measuring: 2, mapping_edit: 3, diagnosing: 4 };

/** Sem histórico: análise ~40 s (30 leitura + 10 plano), §5.2. */
const ETA_READING_DEFAULT = 30;
const ETA_PLAN_DEFAULT = 10;
const HISTORY = 20;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** "9:16", "4:5", "1:1"… (o mais perto até 3 %); senão a razão reduzida. */
export function ratioLabel(w: number | null, h: number | null): string | null {
  if (!w || !h) return null;
  const known: [string, number][] = [['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['16:9', 16 / 9], ['3:4', 3 / 4], ['4:3', 4 / 3], ['2:3', 2 / 3], ['3:2', 3 / 2]];
  const r = w / h;
  const hit = known.find(([, v]) => Math.abs(r - v) / v <= 0.03);
  if (hit) return hit[0];
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  return `${w / d}:${h / d}`;
}

/**
 * `summary.files` (§14.2): antes do start = nº de peças (o Gerar faz 1 arquivo, o 9:16, por peça); depois = Σ formatos
 * `queued`/`rendering`/`ready` das peças que não estão `left_out`.
 */
export function filesOf(launched: boolean, pieces: Pick<IteratePiece, 'status' | 'formats'>[]): number {
  if (!launched) return pieces.length;
  return pieces
    .filter((p) => p.status !== 'left_out')
    .reduce((n, p) => n + (p.formats ?? []).filter((f) => f.state === 'queued' || f.state === 'rendering' || f.state === 'ready').length, 0);
}

/**
 * Fase da tela (§3.1): analyze até o start; generate enquanto houver 9:16 DO GERAR (prioridade 0) na fila/renderizando;
 * download depois. 25/10 (estatico-montado-e-molduras-v1 §A10 1b): Retry e formato sob demanda rodam com prioridade 10 e
 * NÃO voltam o lote pra Generate (a peça mostra o próprio estado). `generatePending` = nº desses 9:16 pendentes.
 */
export function phaseOf(status: IterateStatus, generatePending: number): IterateBatch['phase'] {
  if (status !== 'LAUNCHED') return 'analyze';
  return generatePending > 0 ? 'generate' : 'download';
}

/**
 * legenda-protegida-v1 §8 (29/10): `captionBlocked[].forced` = há peça incluída no plano, com `captionOverride`, desse
 * tipo/moldura ("Gerar mesmo assim"). Sem `captionBlocked` = como veio.
 */
export function withForced(insight: AutoInsight, pieces: Pick<IteratePiece, 'type' | 'captionOverride' | 'frame'>[]): AutoInsight {
  if (!insight.captionBlocked?.length) return insight;
  return {
    ...insight,
    captionBlocked: insight.captionBlocked.map((e) => ({
      ...e, forced: pieces.some((p) => p.captionOverride === true && p.type === e.type && (p.type !== 'FRAME' || (p.frame?.template ?? null) === e.template)),
    })),
  };
}

@Injectable()
export class IteracaoViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cfg: AppConfig,
    private readonly pecas: PecasAutoService,
    private readonly zips: ZipService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  private async ref(f: import('@prisma/client').File | null | undefined): Promise<FileRef | null> {
    return f ? this.storage.fileRef(f) : null;
  }

  async batch(b: IterateRow): Promise<IterateBatch> {
    const status = b.status as IterateStatus;
    const launched = status === 'LAUNCHED';
    const [champJob, planJob] = await Promise.all([
      this.prisma.job.findFirst({ where: { championId: b.championId, type: 'CHAMPION_ANALYZE' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.job.findFirst({ where: { variationBatchId: b.id, type: 'AUTO_PLAN' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const answers = b.answers as unknown as IterateAnswers | null;
    const all = await this.pecas.pieces({ id: b.id, workspaceId: b.workspaceId, status: b.status });
    const metadata = new Map(b.items.map((i) => [i.id, i]));
    for (const piece of all) {
      const it = metadata.get(piece.id);
      piece.wantKey = (it?.wantKey as IterateWant | null) ?? WANT_OF[piece.type] ?? null;
      piece.selection = (it?.selection as VariationSelection | null) ?? null;
      piece.askedByUser = !!piece.wantKey && !!answers?.wants.includes(piece.wantKey);
      piece.priceUsd = piece.type === 'STATIC' ? this.pecas.staticImageUsd() : null;
    }
    const pieces = all.filter((p) => metadata.get(p.id)?.included !== false);
    const notSelected = all.filter((p) => ['not_asked', 'user_removed'].includes(metadata.get(p.id)?.selection ?? ''));
    const leftOut = [...new Set(notSelected.map((p) => p.wantKey).filter((w): w is IterateWant => !!w))].map((wantKey) => {
      const ps = notSelected.filter((p) => p.wantKey === wantKey);
      return { wantKey, count: ps.length, pieceIds: ps.map((p) => p.id) };
    });
    const cost = await this.costOf(b);
    const generateEstimateUsd = status === 'PLAN_READY' ? await this.generateEstimateUsd(b.id) : null;
    const m = measurementsOf(b.champion.teardown?.measurements);
    const video = b.champion.videoFile;
    const lang = /^pt\b/i.test(b.offer.language) ? 'PT' : 'EN';
    const zip = await this.zips.view(b.workspaceId, b.id);
    return {
      id: b.id, status, phase: phaseOf(status, launched ? await this.generatePending(b.id) : 0),
      offer: { id: b.offer.id, name: b.offer.name, language: b.offer.language },
      codeLanguage: lang,
      source: {
        championId: b.championId, name: b.champion.name, fromLibrary: !!b.champion.sourceCreativeId, fromMeta: !!b.champion.metaAdId,
        durationSec: m?.durationSec ?? num(b.champion.durationSec), width: video?.width ?? m?.width ?? null, height: video?.height ?? m?.height ?? null,
        ratioLabel: ratioLabel(video?.width ?? m?.width ?? null, video?.height ?? m?.height ?? null), cuts: m ? m.cuts.length : null,
        thumbnail: await this.ref(b.champion.thumbnailFile), video: await this.ref(video),
      },
      analysis: await this.analysis(b, champJob, planJob),
      insight: b.insight ? withForced({ ...(b.insight as unknown as AutoInsight), flags: { ...(b.insight as unknown as AutoInsight).flags, smallBatch: pieces.length < 8 } }, pieces) : null,
      error: this.error(b, cost.analysisUsd),
      sample: isSampleSettings(b.settings), // amostra-gratis-v1 §2
      quizEnabled: !!(b.settings as Record<string, unknown> | null)?.quizEnabled,
      answers, selectionInfo: selectionInfo(answers ?? DEFAULT_ANSWERS), notSelected, leftOut,
      pieces,
      summary: {
        pieces: pieces.length,
        stretch: pieces.filter((p) => p.axis === 'ITERATION').length,
        newAudience: pieces.filter((p) => p.axis === 'DIVERSITY').length,
        files: filesOf(launched, pieces),
        ready: pieces.filter((p) => p.status === 'ready').length,
        failed: pieces.filter((p) => p.status === 'failed').length,
        leftOut: pieces.filter((p) => p.status === 'left_out').length,
        renderEtaSec: launched ? await this.pecas.renderEtaSec(b.id) : null,
        videoCreditsUsd: 0,
      },
      cost: {
        analysisEstimateUsd: num(b.estimatedCostUsd) ?? 0, analysisUsd: cost.analysisUsd, generateEstimateUsd, imagesUsd: cost.imagesUsd,
        renderUsd: 0, totalUsd: r4(cost.analysisUsd + cost.imagesUsd),
      },
      zip,
      downloadedAt: b.downloadedAt?.toISOString() ?? null,
      createdBy: { id: b.createdBy.id, name: b.createdBy.name, initials: initials(b.createdBy.name) },
      createdAt: b.createdAt.toISOString(),
      launchedAt: b.launchedAt?.toISOString() ?? null,
    };
  }

  /** §5.2: etapa, passo, progresso, ETA e checklist da análise. */
  private async analysis(b: IterateRow, champJob: Job | null, planJob: Job | null): Promise<IterateAnalysis> {
    const st = b.status as IterateStatus;
    const failed = st === 'ANALYSIS_FAILED';
    const stage: AnalysisStage | null =
      st === 'ANALYZING' ? 'reading'
        : st === 'PLANNING' ? (planJob?.stage === 'planning' ? 'planning' : 'brain')
          : failed ? ((b.failStage as AnalysisStage | null) ?? 'planning') : null;
    const step = stage === 'reading' ? 1 : stage === 'brain' ? 2 : 3;
    // leitura: pela etapa do CHAMPION_ANALYZE quando ela está acontecendo (ou foi onde falhou)
    const readingNow = stage === 'reading';
    const cur = readingNow ? (champJob?.stage ? READING_STAGE[champJob.stage] ?? 0 : 0) : READING_KEYS.length;
    const mark = (i: number, current: number, nowHere: boolean): 'done' | 'running' | 'pending' | 'failed' =>
      !nowHere ? 'done' : i < current ? 'done' : i === current ? (failed ? 'failed' : 'running') : 'pending';
    const checklist: IterateAnalysis['checklist'] = [];
    READING_KEYS.forEach((key, i) => checklist.push({ key, status: mark(i, cur, readingNow) }));
    const brainNow = stage === 'brain';
    const pastBrain = stage === 'planning' || stage === null;
    BRAIN_KEYS.forEach((key, i) =>
      checklist.push({ key, status: readingNow ? 'pending' : pastBrain ? 'done' : brainNow ? mark(i, BRAIN_KEYS.length - 1, true) : 'pending' }));
    checklist.push({ key: 'planning', status: stage === null ? 'done' : stage === 'planning' ? (failed ? 'failed' : 'running') : 'pending' });

    const progress = stage === null ? 100
      : stage === 'reading' ? Math.round((champJob?.progress ?? 0) * 0.7)
        : stage === 'brain' ? 75 : 85;
    let etaSec: number | null = null;
    if (st === 'ANALYZING' || st === 'PLANNING') {
      const [medRead, medPlan] = await this.medians(b.workspaceId);
      const since = (j: Job | null) => (j ? (Date.now() - (j.startedAt ?? j.createdAt).getTime()) / 1000 : 0);
      etaSec = st === 'ANALYZING'
        ? Math.max(1, Math.round(Math.max(0, medRead - since(champJob)) + medPlan))
        : Math.max(1, Math.round(medPlan - since(planJob)));
    }
    return { stage, step: step as 1 | 2 | 3, progress, etaSec, checklist };
  }

  /** Mediana das últimas 20 leituras (CHAMPION_ANALYZE) e dos últimos 20 planos (AUTO_PLAN) do workspace. */
  private async medians(workspaceId: string): Promise<[number, number]> {
    const dur = async (type: 'CHAMPION_ANALYZE' | 'AUTO_PLAN', dflt: number) => {
      const js = await this.prisma.job.findMany({
        where: { workspaceId, type, status: 'SUCCEEDED', finishedAt: { not: null } }, orderBy: { finishedAt: 'desc' }, take: HISTORY,
        select: { createdAt: true, startedAt: true, finishedAt: true },
      });
      return median(js.map((j) => (j.finishedAt!.getTime() - (j.startedAt ?? j.createdAt).getTime()) / 1000)) ?? dflt;
    };
    return Promise.all([dur('CHAMPION_ANALYZE', ETA_READING_DEFAULT), dur('AUTO_PLAN', ETA_PLAN_DEFAULT)]);
  }

  /**
   * Gasto real (cost_entries): `analysisUsd` = lote + campeão desde que o lote nasceu, sem IMAGE (a análise desta rodada);
   * `imagesUsd` (rev. 23/10 §14.4) = IMAGE do lote (STATIC no Gerar, retries e formatos sob demanda).
   */
  private async costOf(b: IterateRow): Promise<{ analysisUsd: number; imagesUsd: number }> {
    const [analysis, images] = await Promise.all([
      this.prisma.costEntry.aggregate({
        where: {
          kind: { not: 'IMAGE' },
          OR: [{ variationBatchId: b.id }, { championId: b.championId, createdAt: { gte: b.createdAt }, variationBatchId: null, creativeId: null }],
        },
        _sum: { amountUsd: true },
      }),
      this.prisma.costEntry.aggregate({ where: { kind: 'IMAGE', variationBatchId: b.id }, _sum: { amountUsd: true } }),
    ]);
    return { analysisUsd: r4(num(analysis._sum.amountUsd) ?? 0), imagesUsd: r4(num(images._sum.amountUsd) ?? 0) };
  }

  /** §A10 1b: 9:16 do Gerar (prioridade 0, não stale) ainda na fila/renderizando. */
  private generatePending(batchId: string): Promise<number> {
    return this.prisma.render.count({
      where: { stale: false, format: 'VERTICAL_9_16', priority: PRIORITY_BATCH, status: { in: ['QUEUED', 'RENDERING'] }, creative: { variationBatchId: batchId, variationKind: 'AUTO_EDIT' } },
    });
  }

  /**
   * §14.4: "Generate N pieces" = nº de itens STATIC do plano × staticImageUsd (vídeo no Remotion = 0). legenda-protegida-v1
   * §4.2: campeão com legenda queimada (sem a versão sem legenda) soma a checagem por visão de cada peça de vídeo.
   */
  async generateEstimateUsd(batchId: string): Promise<number> {
    const [n, allVideos, forced, templates, b] = await Promise.all([
      this.prisma.variationItem.count({ where: { batchId, kind: 'AUTO_EDIT', included: true, autoType: 'STATIC' } }),
      this.prisma.variationItem.count({ where: { batchId, kind: 'AUTO_EDIT', included: true, autoType: { notIn: ['STATIC', 'CHAT_DM', 'PERSON_MOTION'] } } }),
      // §8 (29/10): peça forçada ("Gerar mesmo assim") não passa pela checagem por visão
      this.prisma.variationItem.count({ where: { batchId, kind: 'AUTO_EDIT', included: true, autoType: { notIn: ['STATIC', 'CHAT_DM', 'PERSON_MOTION'] }, payload: { path: ['captionOverride'], equals: true } } }),
      this.prisma.variationItem.count({ where: { batchId, kind: 'AUTO_EDIT', included: true, autoType: { in: ['CHAT_DM', 'PERSON_MOTION'] } } }),
      this.prisma.variationBatch.findUnique({
        where: { id: batchId },
        select: { champion: { select: { cleanVideoFileId: true, videoFile: { select: { width: true, height: true } }, teardown: { select: { editMap: true } } } } },
      }),
    ]);
    const videos = allVideos - forced;
    const ch = b?.champion;
    const m = editMapOf(ch?.teardown?.editMap);
    const burned = !!ch && !ch.cleanVideoFileId && faixasDoCampeao(m, { width: ch.videoFile?.width ?? m?.width ?? 0, height: ch.videoFile?.height ?? m?.height ?? 0 }).length > 0;
    const captionUsd = ((burned ? videos : 0) + templates) * CAPTION_CHECK_USD;
    return Math.round((estimateStaticUsd(this.catalog, n) + captionUsd) * 10_000) / 10_000;
  }

  private error(b: IterateRow, chargedUsd: number): IterateError | null {
    if (b.status !== 'ANALYSIS_FAILED' || !b.errorCode) return null;
    const code = b.errorCode;
    const durationSec = num(b.champion.durationSec) ?? 0;
    const params: Record<string, string | number> =
      code === 'MEDIA_TOO_SHORT' ? { durationSec, minSec: this.cfg.championMinSec }
        : code === 'MEDIA_INVALID' ? { durationSec }
          : code === 'PLAN_INVALID' ? { violations: b.failDetail ?? '' } : {};
    return {
      code, reason: b.failReason ?? autoFailReason(code), detail: b.failDetail, params,
      stage: (b.failStage as AnalysisStage | null) ?? 'planning', chargedUsd,
      action: code === 'MEDIA_INVALID' || code === 'MEDIA_TOO_SHORT' ? 'upload_another' : 'try_again',
    };
  }

}

