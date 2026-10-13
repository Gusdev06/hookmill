import { Injectable } from '@nestjs/common';
import type { AnalysisStage, AutoInsight, FileRef, IterateAnalysis, IterateBatch, IterateError, IteratePiece, IterateStatus } from '@maquina/contratos';
import type { Job, Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { measurementsOf } from '../campeoes/champion-views';
import { initials, num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { PecasAutoService } from '../edicao/pecas.service';
import { PrismaService } from '../prisma/prisma.service';
import { autoFailReason } from './plano-auto.service';
import { ZipService } from './zip.service';

export const ITERATE_INCLUDE = {
  offer: true,
  workspace: { select: { name: true, uiLocale: true } },
  createdBy: { select: { id: true, name: true } },
  champion: { include: { videoFile: true, thumbnailFile: true, teardown: { select: { measurements: true } } } },
  items: { orderBy: { index: 'asc' }, select: { id: true } },
} satisfies Prisma.VariationBatchInclude;
export type IterateRow = Prisma.VariationBatchGetPayload<{ include: typeof ITERATE_INCLUDE }>;

/** Formatos por peça (§3): 9:16, 4:5, 1:1. */
const FORMATS_PER_PIECE = 3;

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

/** Fase da tela (§3.1): analyze até o start; generate com peça na fila/renderizando; download quando tudo assentou. */
export function phaseOf(status: IterateStatus, pieces: Pick<IteratePiece, 'status'>[]): IterateBatch['phase'] {
  if (status !== 'LAUNCHED') return 'analyze';
  return pieces.some((p) => p.status === 'queued' || p.status === 'rendering') ? 'generate' : 'download';
}

@Injectable()
export class IteracaoViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cfg: AppConfig,
    private readonly pecas: PecasAutoService,
    private readonly zips: ZipService,
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
    const pieces = await this.pecas.pieces({ id: b.id, workspaceId: b.workspaceId, status: b.status });
    const cost = await this.costOf(b);
    const m = measurementsOf(b.champion.teardown?.measurements);
    const video = b.champion.videoFile;
    const lang = /^pt\b/i.test(b.offer.language) ? 'PT' : 'EN';
    const zip = await this.zips.view(b.workspaceId, b.id);
    return {
      id: b.id, status, phase: phaseOf(status, pieces),
      offer: { id: b.offer.id, name: b.offer.name, language: b.offer.language },
      codeLanguage: lang,
      source: {
        championId: b.championId, name: b.champion.name, fromLibrary: !!b.champion.sourceCreativeId,
        durationSec: m?.durationSec ?? num(b.champion.durationSec), width: video?.width ?? m?.width ?? null, height: video?.height ?? m?.height ?? null,
        ratioLabel: ratioLabel(video?.width ?? m?.width ?? null, video?.height ?? m?.height ?? null), cuts: m ? m.cuts.length : null,
        thumbnail: await this.ref(b.champion.thumbnailFile), video: await this.ref(video),
      },
      analysis: await this.analysis(b, champJob, planJob),
      insight: (b.insight as unknown as AutoInsight | null) ?? null,
      error: this.error(b, cost.analysisUsd),
      pieces,
      summary: {
        pieces: pieces.length,
        stretch: pieces.filter((p) => p.axis === 'ITERATION').length,
        newAudience: pieces.filter((p) => p.axis === 'DIVERSITY').length,
        files: pieces.filter((p) => p.status !== 'left_out').length * FORMATS_PER_PIECE,
        ready: pieces.filter((p) => p.status === 'ready').length,
        failed: pieces.filter((p) => p.status === 'failed').length,
        leftOut: pieces.filter((p) => p.status === 'left_out').length,
        renderEtaSec: launched ? await this.pecas.renderEtaSec(b.id) : null,
        videoCreditsUsd: 0,
      },
      cost: { analysisEstimateUsd: num(b.estimatedCostUsd) ?? 0, analysisUsd: cost.analysisUsd, renderUsd: 0, totalUsd: cost.analysisUsd },
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

  /** Gasto real (cost_entries) do lote + do campeão desde que o lote nasceu: a análise desta rodada. */
  private async costOf(b: IterateRow): Promise<{ analysisUsd: number }> {
    const rows = await this.prisma.costEntry.aggregate({
      where: { OR: [{ variationBatchId: b.id }, { championId: b.championId, createdAt: { gte: b.createdAt }, variationBatchId: null, creativeId: null }] },
      _sum: { amountUsd: true },
    });
    return { analysisUsd: r4(num(rows._sum.amountUsd) ?? 0) };
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

