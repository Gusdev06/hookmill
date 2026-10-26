import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import type { IterateBatch, IterateConfig, LibraryItem } from '@maquina/contratos';
import type { Champion, Prisma } from '@prisma/client';
import { AnaliseService } from '../campeoes/analise.service';
import { ChampionStateMachine } from '../campeoes/champion-state-machine';
import { editMapOf, sectionsOf } from '../campeoes/champion-views';
import { CHAMPION_MIME_TYPES, autoAnalysisEstimateUsd } from '../campeoes/limites';
import { BibliotecaService } from '../biblioteca/biblioteca.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CustosService } from '../custos/custos.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { MetaImportService, type ImportMode } from '../meta/importacao.service';
import { PecasAutoService } from '../edicao/pecas.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { BATCH_ENTRY, BatchStateMachine, assertBatchCan } from '../variacoes/batch-state-machine';
import type { CreateIterateDto } from './iteracao.dto';
import { ITERATE_INCLUDE, IteracaoViews } from './iteracao.views';
import { AutoPlanError, PlanoAutoService } from './plano-auto.service';
import { AUTO_TYPES_NOVOS } from './regras';
import type { AutoVariationType } from '@maquina/contratos';

/** Varredura dos lotes ANALYZING cujo campeão terminou por outro caminho (outro lote, /champions, reinício). */
const ADVANCE_EVERY_MS = 3000;

/** import = meta-v1 D13: baixar o vídeo da Meta antes da análise (job META_IMPORT). */
type Reuse = ImportMode;

/**
 * Lote AUTO (variacao-auto-v1 §3.1, §5): POST /iterate cria o lote e dispara a análise sozinha (CHAMPION_ANALYZE do
 * campeão → AUTO_PLAN). Workspace sempre do token; lote MANUAL ou de outro workspace = 404.
 */
@Injectable()
export class IteracaoService {
  private readonly log = new Logger('Iteracao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: IteracaoViews,
    private readonly sm: BatchStateMachine,
    private readonly championSm: ChampionStateMachine,
    private readonly analise: AnaliseService,
    private readonly plano: PlanoAutoService,
    private readonly uploads: UploadsService,
    private readonly custos: CustosService,
    private readonly jobs: JobsService,
    private readonly locks: KeyedMutex,
    private readonly cfg: AppConfig,
    private readonly moduleRef: ModuleRef,
    private readonly pecas: PecasAutoService,
    private readonly metaImport: MetaImportService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  // ───────── leitura ─────────

  private async load(workspaceId: string, id: string) {
    const b = await this.prisma.variationBatch.findFirst({ where: { id, workspaceId, mode: 'AUTO', champion: { archivedAt: null } }, include: ITERATE_INCLUDE });
    if (!b) throw new AppException('NOT_FOUND');
    return b;
  }

  async get(auth: AuthContext, id: string): Promise<IterateBatch> {
    return this.views.batch(await this.load(auth.workspaceId, id));
  }

  /** GET /iterate/config (§4). */
  async config(auth: AuthContext): Promise<IterateConfig> {
    const typical = autoAnalysisEstimateUsd(this.catalog, 30);
    const offers = await this.prisma.offer.findMany({
      where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { id: true, name: true, language: true },
    });
    let defaultOfferId: string | null = offers.length === 1 ? offers[0].id : null;
    if (offers.length > 1) {
      const last = await this.prisma.variationBatch.findFirst({ where: { workspaceId: auth.workspaceId, mode: 'AUTO' }, orderBy: { createdAt: 'desc' }, select: { offerId: true } });
      defaultOfferId = last && offers.some((o) => o.id === last.offerId) ? last.offerId : null;
    }
    return {
      maxBytes: this.cfg.uploadMaxBytes, minSec: this.cfg.championMinSec, maxSec: this.cfg.championMaxSec, mimeTypes: [...CHAMPION_MIME_TYPES],
      analysisUsdPerSec: Math.round((typical / 30) * 10_000) / 10_000, analysisTypicalUsd: typical,
      types: [...AUTO_TYPES_NOVOS] as AutoVariationType[], metaConnected: false, offers, defaultOfferId,
      staticImageUsd: this.pecas.staticImageUsd(), // rev. 23/10 §14.4
      recentWinners: await this.recentWinners(auth),
    };
  }

  /** Até 3 vencedores em vídeo da Library (a lista e o formato do item são da biblioteca, B2). */
  private async recentWinners(auth: AuthContext): Promise<LibraryItem[]> {
    const lib = this.moduleRef.get(BibliotecaService, { strict: false });
    const r = await lib.list(auth, { winners: true, limit: 10 });
    return r.items.filter((i) => (i as LibraryItem & { media?: string }).media !== 'image' && i.video?.mimeType?.startsWith('video/')).slice(0, 3);
  }

  // ───────── criar (POST /iterate) ─────────

  async create(auth: AuthContext, dto: CreateIterateDto): Promise<IterateBatch> {
    const given = [dto.uploadId && 'uploadId', dto.creativeId && 'creativeId', dto.metaAdId && 'metaAdId', dto.championId && 'championId'].filter(Boolean) as string[];
    if (given.length !== 1) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: given[1] ?? 'uploadId', rule: 'exactlyOneOf:uploadId,creativeId,metaAdId,championId' }] });
    }
    const src = dto.uploadId ? await this.fromUpload(auth, dto.uploadId, dto.offerId)
      : dto.championId ? await this.fromChampion(auth, dto.championId)
      : dto.metaAdId ? await this.metaImport.prepare(auth, dto.metaAdId, dto.offerId) // meta-v1 D13: Pick from Meta
        : await this.fromLibrary(auth, dto.creativeId!);
    // legenda-protegida-v1 D-LP5: a versão sem legenda fica presa no lote e é conferida antes do plano (a análise precisa acabar)
    const cleanFile = dto.cleanUploadId ? await this.uploads.readyFile(auth.workspaceId, dto.cleanUploadId) : null;
    const durationSec = num(src.champion.durationSec) ?? 30;
    const estimate = autoAnalysisEstimateUsd(this.catalog, durationSec, src.mode === 'reuse');
    await this.custos.assertWithinCap(auth.workspaceId, estimate);

    const r = await this.prisma.$transaction(async (tx) => {
      let champion = src.champion;
      if (src.isNew) champion = await tx.champion.create({ data: src.newData! });
      else if (src.mode === 'analyze') await this.reanalyzeChampion(tx, champion);
      else if (src.mode === 'import') await this.metaImport.importAgain(tx, champion);
      const batch = await tx.variationBatch.create({
        data: {
          workspaceId: auth.workspaceId, championId: champion.id, offerId: champion.offerId, mode: 'AUTO',
          status: src.mode === 'reuse' ? BATCH_ENTRY.AUTO_REUSE : BATCH_ENTRY.AUTO_ANALYZE,
          language: champion.language ?? src.offerLanguage, requests: [], settings: cleanFile ? { cleanFileId: cleanFile.id } : {}, estimatedCostUsd: estimate, createdById: auth.userId,
        },
      });
      const job = src.mode === 'wait' ? null
        : src.mode === 'reuse' ? await this.newPlanJob(tx, batch.id, champion, auth.userId)
          : src.mode === 'import' ? await this.metaImport.newImportJob(tx, champion, auth.userId)
            : await tx.job.create({ data: { workspaceId: auth.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: champion.id }, championId: champion.id, offerId: champion.offerId, createdById: auth.userId } });
      return { batchId: batch.id, jobId: job?.id ?? null, championId: champion.id };
    });
    this.kick(r.batchId, src.mode, r.jobId, r.championId, auth.userId);
    return this.get(auth, r.batchId);
  }

  /** Upload → campeão novo (rights do schema: só registro). Oferta: a do corpo, ou a única ativa (§5.1, D3). */
  private async fromUpload(auth: AuthContext, uploadId: string, offerId?: string) {
    const file = await this.uploads.readyFile(auth.workspaceId, uploadId); // 404/409/410 antes de pedir a oferta
    const offers = await this.prisma.offer.findMany({ where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
    const offer = offerId ? offers.find((o) => o.id === offerId) : offers.length === 1 ? offers[0] : undefined;
    if (offerId && !offer) throw new AppException('NOT_FOUND');
    if (!offer) throw new AppException('OFFER_REQUIRED', { offers: offers.map((o) => ({ id: o.id, name: o.name })) });
    const up = await this.prisma.upload.findUnique({ where: { id: uploadId }, select: { filename: true } });
    const name = (up?.filename ?? 'Champion').replace(/\.[A-Za-z0-9]{2,4}$/, '').trim().slice(0, 120) || 'Champion';
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: offer.id, name, status: 'ANALYZING', videoFileId: file.id, durationSec: file.durationSec, createdById: auth.userId,
    };
    return { champion: { ...newData, id: '', language: null, durationSec: file.durationSec } as unknown as Champion, isNew: true, newData, mode: 'analyze' as Reuse, offerLanguage: offer.language };
  }

  /**
   * Library → "Vary" (§5.1 esclarecimento 2): criativo APPROVED com vídeo. Campeão com sourceCreativeId não arquivado:
   * READY com teardown e editMap = reaproveita (lote nasce PLANNING); ANALYZING = espera; FAILED ou READY sem mapa =
   * analisa de novo. Sem campeão: cria um (rights OWN, vídeo = render final 9:16, nome do criativo).
   */
  /**
   * 26/10 "Novo lote": campeão já analisado do workspace (READY, com teardown e mapa) → reaproveita a análise (nasce
   * PLANNING, só o plano). Outro workspace/arquivado = 404; analisando/falhou = 409 INVALID_STATE `allowed: ['READY']`.
   */
  private async fromChampion(auth: AuthContext, championId: string) {
    const c = await this.prisma.champion.findFirst({ where: { id: championId, workspaceId: auth.workspaceId, archivedAt: null }, include: { teardown: true, offer: true } });
    if (!c || c.offer.archivedAt) throw new AppException('NOT_FOUND');
    if (c.status !== 'READY' || !sectionsOf(c.teardown?.sections)) throw new AppException('INVALID_STATE', { state: c.status, allowed: ['READY'] });
    const { teardown: _t, offer, ...champion } = c;
    return { champion: champion as Champion, isNew: false, newData: null, mode: 'reuse' as Reuse, offerLanguage: offer.language };
  }

  private async fromLibrary(auth: AuthContext, creativeId: string) {
    const c = await this.prisma.creative.findFirst({
      where: { id: creativeId, workspaceId: auth.workspaceId, archivedAt: null },
      include: { finalRender: { include: { file: true } }, offer: true },
    });
    if (!c) throw new AppException('NOT_FOUND');
    if (c.state !== 'APPROVED') throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'] });
    const file = c.finalRender?.file;
    if (!file || !file.mimeType.startsWith('video/')) throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'not_a_video' });
    if (c.offer.archivedAt) throw new AppException('NOT_FOUND');
    const existing = await this.prisma.champion.findFirst({
      where: { workspaceId: auth.workspaceId, sourceCreativeId: c.id, archivedAt: null }, include: { teardown: true }, orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const ready = existing.status === 'READY' && !!sectionsOf(existing.teardown?.sections) && !!editMapOf(existing.teardown?.editMap);
      const mode: Reuse = ready ? 'reuse' : existing.status === 'ANALYZING' || existing.status === 'RESOLVING' ? 'wait' : 'analyze';
      return { champion: existing as Champion, isNew: false, newData: null, mode, offerLanguage: c.offer.language };
    }
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: c.offerId, name: c.name.slice(0, 120), status: 'ANALYZING', rights: 'OWN',
      rightsDeclaredById: auth.userId, rightsDeclaredAt: new Date(), videoFileId: file.id,
      durationSec: file.durationSec ?? c.finalRender?.durationSec ?? null, sourceCreativeId: c.id, createdById: auth.userId,
    };
    return { champion: { ...newData, id: '', language: null } as unknown as Champion, isNew: true, newData, mode: 'analyze' as Reuse, offerLanguage: c.offer.language };
  }

  /** Campeão existente FAILED/READY → ANALYZING (máquina do campeão). Seções editadas à mão são refeitas (o lote é da IA). */
  private async reanalyzeChampion(tx: Prisma.TransactionClient, c: Champion) {
    await this.championSm.transition({ tx, championId: c.id, event: 'ANALYZE_AGAIN', from: c.status, to: 'ANALYZING', data: { errorCode: null, failReason: null } });
  }

  private newPlanJob(tx: Prisma.TransactionClient, batchId: string, c: Pick<Champion, 'id' | 'workspaceId' | 'offerId'>, userId: string) {
    return tx.job.create({
      data: { workspaceId: c.workspaceId, type: 'AUTO_PLAN', status: 'QUEUED', input: { batchId }, variationBatchId: batchId, championId: c.id, offerId: c.offerId, createdById: userId },
    });
  }

  /** Depois do commit: dispara o trabalho em segundo plano. */
  private kick(batchId: string, mode: Reuse, jobId: string | null, championId: string, userId: string) {
    if (!jobId) return; // 'wait': a varredura avança quando o campeão terminar
    if (mode === 'reuse') {
      void this.jobs.detach(jobId, 'plano do lote AUTO', () => this.plano.run(jobId, batchId));
    } else if (mode === 'import') {
      // meta-v1 D13: META_IMPORT baixa o vídeo → campeão ANALYZING + job de análise → segue como o upload
      void this.jobs.detach(jobId, 'import do anúncio da Meta (lote AUTO)', async () => {
        const analyzeJobId = await this.metaImport.run(jobId, championId, userId);
        if (analyzeJobId) await this.analise.runAnalyze(analyzeJobId, championId);
        await this.advanceFromChampion(championId);
      });
    } else {
      void this.jobs.detach(jobId, 'análise do campeão (lote AUTO)', async () => {
        await this.analise.runAnalyze(jobId, championId);
        await this.advanceFromChampion(championId);
      });
    }
  }

  // ───────── campeão terminou → lote avança (§3.1) ─────────

  /** Lotes AUTO em ANALYZING deste campeão: READY → PLANNING (+ job AUTO_PLAN); FAILED → ANALYSIS_FAILED (reading). */
  async advanceFromChampion(championId: string): Promise<void> {
    const c = await this.prisma.champion.findUnique({ where: { id: championId } });
    if (!c || (c.status !== 'READY' && c.status !== 'FAILED')) return;
    const batches = await this.prisma.variationBatch.findMany({ where: { championId, mode: 'AUTO', status: 'ANALYZING' }, select: { id: true, createdById: true } });
    for (const b of batches) {
      if (c.status === 'READY') {
        const jobId = await this.prisma.$transaction(async (tx) => {
          await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_READING_DONE', from: 'ANALYZING', to: 'PLANNING' });
          return (await this.newPlanJob(tx, b.id, c, b.createdById)).id;
        }).catch(() => null); // outro processo/varredura avançou antes (CAS)
        if (jobId) void this.jobs.detach(jobId, 'plano do lote AUTO', () => this.plano.run(jobId, b.id));
      } else {
        const code = this.readingCode(c);
        await this.plano.fail(b.id, null, new AutoPlanError(code, 'reading', c.failReason ?? c.errorCode ?? null));
      }
    }
  }

  /** Código do lote a partir da falha do campeão: vídeo inválido e curto demais = MEDIA_TOO_SHORT (§5.3). */
  private readingCode(c: Champion): string {
    const code = c.errorCode ?? 'PROVIDER_ERROR';
    if (code === 'MEDIA_INVALID' && (num(c.durationSec) ?? Infinity) < this.cfg.championMinSec) return 'MEDIA_TOO_SHORT';
    return code;
  }

  @Interval('iterate-advance', ADVANCE_EVERY_MS)
  async sweep(): Promise<void> {
    if (process.env.BOOT_RECOVERY === 'off' && process.env.NODE_ENV === 'test') return; // int specs dividem o banco: cada um avança o seu
    const rows = await this.prisma.variationBatch.findMany({
      where: { mode: 'AUTO', status: 'ANALYZING', champion: { status: { in: ['READY', 'FAILED'] } } }, select: { championId: true }, take: 50,
    }).catch(() => []);
    for (const championId of new Set(rows.map((r) => r.championId))) await this.advanceFromChampion(championId).catch((e) => this.log.warn(`varredura ${championId}: ${(e as Error).message}`));
  }

  // ───────── retry da análise ─────────

  /** POST /iterate/:id/retry: ANALYSIS_FAILED → ANALYZING (campeão não READY) ou PLANNING. Vídeo inválido = 409 upload_another. */
  async retry(auth: AuthContext, id: string): Promise<IterateBatch> {
    const kick = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth.workspaceId, id);
      assertBatchCan(b.status, 'AUTO_RETRY');
      if (b.errorCode === 'MEDIA_INVALID' || b.errorCode === 'MEDIA_TOO_SHORT') {
        throw new AppException('INVALID_STATE', { state: b.status, allowed: ['ANALYSIS_FAILED'], reason: 'upload_another' });
      }
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId } });
      const mode: Reuse = c.status === 'READY' && sectionsOf((await this.prisma.teardown.findUnique({ where: { championId: c.id } }))?.sections) ? 'reuse'
        : c.status === 'ANALYZING' || c.status === 'RESOLVING' ? 'wait'
          : c.metaAdId && !c.videoFileId ? 'import' // meta-v1 D13: o download falhou; baixa de novo
            : 'analyze';
      await this.custos.assertWithinCap(auth.workspaceId, autoAnalysisEstimateUsd(this.catalog, num(c.durationSec) ?? 30, mode === 'reuse'));
      const clear = { errorCode: null, failReason: null, failDetail: null, failStage: null };
      const jobId = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_RETRY', from: 'ANALYSIS_FAILED', to: mode === 'reuse' ? 'PLANNING' : 'ANALYZING', data: clear });
        if (mode === 'wait') return null;
        if (mode === 'reuse') return (await this.newPlanJob(tx, b.id, c, auth.userId)).id;
        if (mode === 'import') {
          await this.metaImport.importAgain(tx, c);
          return (await this.metaImport.newImportJob(tx, c, auth.userId)).id;
        }
        await this.reanalyzeChampion(tx, c);
        return (await tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: c.id }, championId: c.id, offerId: c.offerId, createdById: auth.userId } })).id;
      });
      return { mode, jobId, championId: c.id };
    });
    this.kick(id, kick.mode, kick.jobId, kick.championId, auth.userId);
    return this.get(auth, id);
  }

  /**
   * `POST /iterate/:id/replan` (legenda-protegida-v1 D-LP5): PLAN_READY → PLANNING com um job AUTO_PLAN novo sobre a análise
   * pronta (não cobra a análise de novo; o teto confere só o plano). Os itens do plano antigo são descartados. Lote LAUNCHED
   * = 409 INVALID_STATE `reason: 'launched'` (as peças já são criativos; o caminho é um lote novo do mesmo campeão);
   * PLANNING/ANALYZING = 409 (já está planejando); ANALYSIS_FAILED = use `retry`.
   */
  async replan(auth: AuthContext, id: string): Promise<IterateBatch> {
    const r = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth.workspaceId, id);
      if (b.status !== 'PLAN_READY') {
        throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], ...(b.status === 'LAUNCHED' && { reason: 'launched' }) });
      }
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId } });
      const td = await this.prisma.teardown.findUnique({ where: { championId: c.id } });
      if (c.status !== 'READY' || !sectionsOf(td?.sections)) throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], reason: 'champion_not_ready' });
      await this.custos.assertWithinCap(auth.workspaceId, autoAnalysisEstimateUsd(this.catalog, num(c.durationSec) ?? 30, true));
      const jobId = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_REPLAN', from: 'PLAN_READY', to: 'PLANNING', data: { errorCode: null, failReason: null, failDetail: null, failStage: null } });
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        return (await this.newPlanJob(tx, b.id, c, auth.userId)).id;
      });
      return { jobId, championId: c.id };
    });
    this.kick(id, 'reuse', r.jobId, r.championId, auth.userId);
    return this.get(auth, id);
  }

  // ───────── gerar (start) ─────────

  /**
   * POST /iterate/:id/start: PLAN_READY → LAUNCHED; as peças (B2) nascem na MESMA transação (§3.3), só o 9:16 (§14.2).
   * §14.4: estimativa (nº de STATIC × staticImageUsd) > expectedCostUsd × 1,10 = 409 ESTIMATE_CHANGED; teto = 409
   * SPEND_CAP_EXCEEDED (estimativa 0 não chama o teto). As imagens do STATIC são submetidas depois do commit.
   */
  async start(auth: AuthContext, id: string, expectedPieces: number, expectedCostUsd?: number): Promise<IterateBatch> {
    const launched = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth.workspaceId, id);
      assertBatchCan(b.status, 'AUTO_START');
      if (b.items.length !== expectedPieces) throw new AppException('PLAN_CHANGED', { pieces: b.items.length });
      const estimateUsd = await this.views.generateEstimateUsd(b.id);
      if (estimateUsd > (expectedCostUsd ?? 0) * 1.1 + 1e-9) throw new AppException('ESTIMATE_CHANGED', { estimateUsd });
      if (estimateUsd > 0) await this.custos.assertWithinCap(auth.workspaceId, estimateUsd);
      const launchedAt = new Date();
      return this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_START', from: 'PLAN_READY', to: 'LAUNCHED', data: { launchedAt } });
        return this.pecas.createPieces(tx, { batchId: b.id, userId: auth.userId, launchedAt });
      }, { timeout: 30_000 });
    });
    this.pecas.launched(launched);
    return this.get(auth, id);
  }

  // ───────── retomada ─────────

  /**
   * Boot (depois da retomada dos jobs e dos campeões): lote PLANNING sem processo vivo → ANALYSIS_FAILED INTERRUPTED;
   * lote ANALYZING cujo campeão já assentou (FAILED pela retomada) avança pelo campeão.
   */
  async recover(workspaceId?: string): Promise<number> {
    const ws = workspaceId ? { workspaceId } : {};
    const planning = await this.prisma.variationBatch.findMany({ where: { ...ws, mode: 'AUTO', status: 'PLANNING' }, select: { id: true } });
    for (const b of planning) await this.plano.fail(b.id, null, new AutoPlanError('INTERRUPTED', 'planning'));
    const analyzing = await this.prisma.variationBatch.findMany({ where: { ...ws, mode: 'AUTO', status: 'ANALYZING' }, select: { championId: true } });
    for (const championId of new Set(analyzing.map((b) => b.championId))) await this.advanceFromChampion(championId);
    return planning.length + analyzing.length;
  }
}
