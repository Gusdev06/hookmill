// meta-v1.md §3.2 e §5.3: job META_SYNC (anúncios de vídeo + 3 janelas → meta_ad_snapshots, substituídos inteiros),
// cron (META_SYNC_EVERY_HOURS, escalonado 30 s por workspace, backoff 5 min → 6 h por conexão quando a Meta falha;
// health 1×/dia), GET /meta/ads e GET /meta/summary.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Job, MetaAdOfferInfo, MetaAdRow, MetaAdVerdict, MetaAdsMeta, MetaCampaignAdRow, MetaOfferFit, MetaOfferListMeta, MetaOfferScope, MetaPeriod, MetaSort, MetaStatusFilter, MetaSummary, MetaSyncState } from '@maquina/contratos';
import type { MetaAdSnapshot, MetaConnection, Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaService, compareAds, isEligible, isMetaError, medianCpaOf } from '../integracoes';
import { median } from '../integracoes/meta/vencedor';
import type { MetaKnownCreativeLink, MetaWinnerRule } from '../integracoes/contrato';
import { JobsService } from '../jobs/jobs.service';
import { presentJob } from '../jobs/job.presenter';
import { legacyBusinessTypeOf } from '../workspaces/resultado';
import { PrismaService } from '../prisma/prisma.service';
import { assertHealthy, assertSelected, assertUsable, isForeignToMode, markTokenInvalid, metaAuthOf, metricsOf, ownConnectionsWhere } from './comum';
import { MetaConexaoService, storedHealthOf } from './conexao.service';
import { type RowCtx, adsManagerObjectUrl, canToggleOf, canWriteOf, matchesStatus, periodMetrics, sortRows, statusCounts, toggleOf } from './campanhas.views';
import { SyncBackoff } from './sync-backoff';
import { MetaOfferLinksService, type OfferMatch } from './oferta-links.service';
import { FIT_RANK, linkCoverage } from './oferta-match';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Mínimo entre syncs manuais (§3.2). */
export const MANUAL_SYNC_MIN_MS = 5 * 60_000;
/** `stale` = syncedAt há mais de 12 h (§5.3). */
export const STALE_AFTER_MS = 12 * HOUR_MS;
const CRON_TICK_MS = 60_000;
const STAGGER_MS = 30_000;
const STAGE_PROGRESS: Record<string, number> = { listing_campaigns: 2, listing_adsets: 4, listing_ads: 6, scoring: 95 };

@Injectable()
export class MetaSyncService {
  private readonly log = new Logger('MetaSync');
  /** Backoff do cron por conexão (em memória): só o cron consulta; o manual segue livre. */
  readonly backoff = new SyncBackoff();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly jobs: JobsService,
    private readonly conexao: MetaConexaoService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
    private readonly offerLinks: MetaOfferLinksService,
  ) {}

  // ───────── disparo ─────────

  private runningJob(workspaceId: string) {
    return this.prisma.job.findFirst({ where: { workspaceId, type: 'META_SYNC', status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * POST /meta/sync: 202 { job } novo; sync já rodando = 200 com o job em andamento; manual a menos de 5 min do
   * último sync concluído (`lastSyncAt`, seja do cron, da seleção ou manual) ou do último manual disparado (mesmo que
   * tenha falhado) = 429 RATE_LIMITED { retryAfterSec } (§3.2; QA rodada 2 item 9). O cron e o 1º sync após a seleção
   * não passam por aqui, então não são limitados.
   */
  async start(auth: AuthContext, now = Date.now()): Promise<{ job: Job; created: boolean }> {
    const c = await this.conexao.selected(auth.workspaceId);
    const running = await this.runningJob(auth.workspaceId);
    if (running) return { job: presentJob(running), created: false };
    const lastManual = await this.prisma.job.findFirst({
      where: { workspaceId: auth.workspaceId, type: 'META_SYNC', input: { path: ['manual'], equals: true } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    const last = Math.max(c.lastSyncAt?.getTime() ?? 0, lastManual?.createdAt.getTime() ?? 0);
    // reconectou depois do último sync (token novo, escopo novo): libera na hora
    const reconnected = !!c.connectedAt && c.connectedAt.getTime() > last;
    if (last && !reconnected && now - last < MANUAL_SYNC_MIN_MS) {
      throw new AppException('RATE_LIMITED', { retryAfterSec: Math.max(1, Math.ceil((MANUAL_SYNC_MIN_MS - (now - last)) / 1000)) });
    }
    const job = await this.kick(c, auth.userId, true);
    return { job, created: true };
  }

  /** 1º sync depois da seleção (PUT /meta/selection) e cron: só se não houver outro rodando. */
  async startIfIdle(c: MetaConnection, createdById: string): Promise<Job | null> {
    if (isForeignToMode(c, this.config.metaMode)) return null;
    if (await this.runningJob(c.workspaceId)) return null;
    return this.kick(c, createdById, false);
  }

  /** Cria o job e roda em segundo plano (quem chama já conferiu que não há outro rodando). */
  async kick(c: MetaConnection, createdById: string, manual: boolean): Promise<Job> {
    // fora de live, a porta é fake: conexão real nem é lida (incidente 22/10)
    if (isForeignToMode(c, this.config.metaMode)) throw new AppException('META_NOT_CONFIGURED', { reason: 'not_configured' }, 'This server runs Meta in mock mode and cannot read a real Meta connection.');
    const job = await this.jobs.create({ workspaceId: c.workspaceId, type: 'META_SYNC', createdById, input: { connectionId: c.id, adAccountId: c.adAccountId, manual } });
    await this.prisma.metaConnection.update({ where: { id: c.id }, data: { lastSyncJobId: job.id } });
    void this.jobs.detach(job.id, 'sync da Meta', () => this.run(job.id, c.id));
    return job;
  }

  /** Job META_SYNC: listing_ads → reading_insights → scoring; snapshots substituídos inteiros numa transação. */
  async run(jobId: string, connectionId: string): Promise<void> {
    const c = await this.prisma.metaConnection.findUniqueOrThrow({ where: { id: connectionId } });
    if (isForeignToMode(c, this.config.metaMode)) {
      // nunca devia chegar aqui (kick barra); se chegar, encerra o job sem tocar na conexão
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: 'META_ERROR', failReason: 'This server runs Meta in mock mode and cannot read a real Meta connection.' }).catch(() => undefined);
      return;
    }
    const job0 = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { input: true } });
    const baseInput = (job0.input && typeof job0.input === 'object' && !Array.isArray(job0.input) ? job0.input : {}) as Record<string, unknown>;
    let stages = Promise.resolve();
    const stage = (key: string, progress: number, counts?: { done: number; total: number }) => {
      stages = stages
        .then(async () => {
          await this.jobs.stage(jobId, key, progress);
          // sync.progress do sumário (§5.3) lê done/total do input do job
          if (counts) await this.prisma.job.update({ where: { id: jobId }, data: { input: { ...baseInput, ...counts } as Prisma.InputJsonValue } });
        })
        .catch(() => undefined);
    };
    try {
      assertSelected(assertUsable(c));
      const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: c.workspaceId }, select: { resultType: true } });
      stage('listing_ads', STAGE_PROGRESS.listing_ads);
      const knownCreativeLinks = await this.knownCreativeLinks(c);
      let r = await this.meta.syncAds(metaAuthOf(c, this.config), { adAccountId: c.adAccountId!, currency: c.currency ?? 'USD', businessType: legacyBusinessTypeOf(ws.resultType), resultType: ws.resultType, hasPixel: !!c.pixelId, knownCreativeLinks }, (p) => {
        if (p.stage === 'reading_insights') stage('reading_insights', 10 + Math.round((p.total ? p.done / p.total : 1) * 80), { done: p.done, total: p.total });
        else stage(p.stage, STAGE_PROGRESS[p.stage] ?? 50, { done: p.done, total: p.total });
      });
      await stages;
      const syncedAt = new Date(r.syncedAt);
      // PUT /meta/selection trocou a conta enquanto este sync rodava: não grava snapshot da conta velha nem lastSyncAt;
      // encerra o job e dispara o 1º sync da conta nova (o startIfIdle da seleção devolveu null por causa deste job)
      const fresh = await this.prisma.metaConnection.findUniqueOrThrow({ where: { id: c.id } });
      if (fresh.adAccountId !== c.adAccountId || fresh.status !== 'ACTIVE') {
        await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { ads: 0, listed: r.listed, skipped: 'account_changed', adAccountId: c.adAccountId } });
        if (fresh.status === 'ACTIVE' && fresh.adAccountId && fresh.pageId) await this.startIfIdle(fresh, fresh.connectedById);
        return;
      }
      const json = (m: unknown) => m as Prisma.InputJsonValue;
      const date = (s: string | null | undefined) => (s ? new Date(s) : null);
      // a Graph pode repetir objeto entre páginas: duplicata derrubava a transação inteira (live 28/10, conta do Tordan, 500 ads)
      const uniq = <T,>(xs: T[] | undefined, key: (x: T) => string) => (xs ? [...new Map(xs.map((x) => [key(x), x])).values()] : xs);
      r = { ...r, ads: uniq(r.ads, (a) => a.metaAdId)!, campaigns: uniq(r.campaigns, (k) => k.campaignId), adsets: uniq(r.adsets, (k) => k.adsetId) };
      await this.prisma.$transaction(async (tx) => {
        // 02/11 (QA F4): dois syncs da mesma conexão em paralelo apagavam juntos e inseriam juntos → unique (connection_id,
        // campaign_id). A trava por conexão faz o 2º esperar o 1º terminar; aí ele apaga o que o 1º gravou e grava o dele.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'meta_sync:' + c.id}))`;
        // campanhas-v1 §2: as 3 tabelas substituídas inteiras no MESMO instante; porta antiga (sem campaigns/adsets) = vazias
        await tx.metaCampaignSnapshot.deleteMany({ where: { connectionId: c.id } });
        await tx.metaAdsetSnapshot.deleteMany({ where: { connectionId: c.id } });
        if (r.campaigns?.length) {
          await tx.metaCampaignSnapshot.createMany({
            data: r.campaigns.map((k) => ({
              workspaceId: c.workspaceId, connectionId: c.id, adAccountId: c.adAccountId!, campaignId: k.campaignId, name: k.name, objective: k.objective,
              status: k.status, effectiveStatus: k.effectiveStatus, buyingType: k.buyingType, bidStrategy: k.bidStrategy,
              dailyBudgetMinor: k.dailyBudgetMinor, lifetimeBudgetMinor: k.lifetimeBudgetMinor, budgetRemainingMinor: k.budgetRemainingMinor,
              specialAdCategories: k.specialAdCategories ?? [], startTime: date(k.startTime), stopTime: date(k.stopTime), createdTime: date(k.createdTime),
              metrics: json(k.metrics), metrics7d: json(k.metrics7d), metricsPrev7d: json(k.metricsPrev7d), syncedAt,
            })),
          });
        }
        if (r.adsets?.length) {
          await tx.metaAdsetSnapshot.createMany({
            data: r.adsets.map((k) => ({
              workspaceId: c.workspaceId, connectionId: c.id, adAccountId: c.adAccountId!, campaignId: k.campaignId, adsetId: k.adsetId, name: k.name,
              status: k.status, effectiveStatus: k.effectiveStatus, optimizationGoal: k.optimizationGoal, billingEvent: k.billingEvent, bidStrategy: k.bidStrategy,
              dailyBudgetMinor: k.dailyBudgetMinor, lifetimeBudgetMinor: k.lifetimeBudgetMinor, budgetRemainingMinor: k.budgetRemainingMinor,
              learningStage: k.learningStage, startTime: date(k.startTime), endTime: date(k.endTime), createdTime: date(k.createdTime),
              metrics: json(k.metrics), metrics7d: json(k.metrics7d), metricsPrev7d: json(k.metricsPrev7d), syncedAt,
            })),
          });
        }
        await tx.metaAdSnapshot.deleteMany({ where: { connectionId: c.id } });
        if (r.ads.length) {
          await tx.metaAdSnapshot.createMany({
            data: r.ads.map((a) => ({
              status: a.status ?? (a.effectiveStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE'), // porta antiga sem `status`: deriva do effective
              workspaceId: c.workspaceId, connectionId: c.id, adAccountId: c.adAccountId!, metaAdId: a.metaAdId, name: a.name, effectiveStatus: a.effectiveStatus,
              campaignId: a.campaign.id, campaignName: a.campaign.name, adsetId: a.adset.id, adsetName: a.adset.name,
              metaCreativeId: a.metaCreativeId, videoId: a.videoId, thumbnailUrl: a.thumbnailUrl, resultType: a.resultType,
              metrics: a.metrics as unknown as Prisma.InputJsonValue, metrics7d: a.metrics7d as unknown as Prisma.InputJsonValue, metricsPrev7d: a.metricsPrev7d as unknown as Prisma.InputJsonValue,
              verdict: a.verdict, trend: a.trend, adCreatedTime: a.adCreatedTime ? new Date(a.adCreatedTime) : null, syncedAt,
              // meta-oferta-v1 §2: porta antiga sem os campos = não lido (null), relido no próximo sync
              destinationUrls: a.destinationUrls ?? [], destinationSource: a.destinationSource ?? null, urlTags: a.urlTags ?? null,
            })),
          });
        }
        // publicações nossas: sumiu da conta = DELETED; status do Ads Manager reflete em ACTIVE/PAUSED (§6)
        const seen = new Map(r.ads.map((a) => [a.metaAdId, a.effectiveStatus]));
        const pubs = await tx.metaPublication.findMany({ where: { connectionId: c.id, status: { in: ['PAUSED', 'ACTIVE'] }, metaAdId: { not: null } }, select: { id: true, metaAdId: true, status: true } });
        for (const p of pubs) {
          const st = seen.get(p.metaAdId!);
          const next = st === undefined ? 'DELETED' : st === 'ACTIVE' ? 'ACTIVE' : /PAUSED/.test(st) ? 'PAUSED' : null;
          if (next && next !== p.status) await tx.metaPublication.update({ where: { id: p.id }, data: { status: next } });
        }
        // cartão de saúde (QA ME-01): adsCount/activeCount do lastHealth refletem o sync sem esperar o "Check again"
        const cur = await tx.metaConnection.findUniqueOrThrow({ where: { id: c.id }, select: { lastHealth: true } });
        const health = storedHealthOf(cur.lastHealth);
        const lastHealth = health
          ? ({ ...health, adsCount: r.ads.filter((a) => !!a.videoId).length, activeCount: r.ads.filter((a) => !!a.videoId && a.effectiveStatus === 'ACTIVE').length } as unknown as Prisma.InputJsonValue)
          : undefined;
        await tx.metaConnection.update({ where: { id: c.id }, data: { lastSyncAt: syncedAt, lastSyncJobId: jobId, lastSyncError: null, ...(lastHealth && { lastHealth }) } });
      }, { maxWait: 15_000, timeout: 120_000 }); // padrão de 5 s estourava com centenas de anúncios entre a VPS e o Supabase
      this.backoff.succeed(c.id);
      await this.jobs.finish(jobId, {
        status: 'SUCCEEDED',
        output: { ads: r.ads.length, campaigns: r.campaigns?.length ?? 0, adsets: r.adsets?.length ?? 0, truncated: !!r.truncated, listed: r.listed, medianCpa: r.medianCpa, syncedAt: r.syncedAt },
      });
    } catch (e) {
      await stages;
      const code = isMetaError(e) ? e.code : e instanceof AppException ? e.code : 'META_ERROR';
      const reason = isMetaError(e) ? e.message : e instanceof AppException ? e.body().message : 'Meta did not answer as expected. Try again.';
      if (!isMetaError(e) && !(e instanceof AppException)) this.log.error(`sync ${connectionId}: ${(e as Error).stack ?? e}`);
      if (code === 'META_TOKEN_INVALID') await markTokenInvalid(this.prisma, c.id);
      const nextAt = this.backoff.fail(c.id);
      this.log.warn(`sync ${c.id} falhou (${code}); cron volta a tentar em ${Math.round((nextAt - Date.now()) / 60_000)} min (falha nº ${this.backoff.failures(c.id)})`);
      await this.prisma.metaConnection.update({ where: { id: c.id }, data: { lastSyncError: code, lastSyncJobId: jobId } }).catch(() => undefined);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: reason }).catch(() => undefined);
    }
  }

  /**
   * meta-oferta-v1 §2.2: cache por criativo a partir dos snapshots atuais da mesma conexão e conta (só os já lidos,
   * destinationSource != null). O criativo da Meta é imutável depois de criado, então o link não envelhece.
   */
  async knownCreativeLinks(c: MetaConnection): Promise<Record<string, MetaKnownCreativeLink>> {
    if (!c.adAccountId) return {};
    const rows = await this.prisma.metaAdSnapshot.findMany({
      where: { connectionId: c.id, adAccountId: c.adAccountId, metaCreativeId: { not: null }, destinationSource: { not: null } },
      select: { metaCreativeId: true, destinationUrls: true, destinationSource: true, urlTags: true },
    });
    const out: Record<string, MetaKnownCreativeLink> = {};
    for (const r of rows) {
      out[r.metaCreativeId!] = { destinationUrls: r.destinationUrls ?? [], destinationSource: r.destinationSource as MetaKnownCreativeLink['destinationSource'], urlTags: r.urlTags };
    }
    return out;
  }

  // ───────── cron (§6) ─────────

  @Interval('meta-sync-cron', CRON_TICK_MS)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.BOOT_RECOVERY === 'off') return; // int specs dividem o banco
    if (!this.config.metaCronEnabled) return; // só META_MODE=live e META_CRON≠off (incidente 22/10)
    try {
      await this.tickSync();
      await this.tickHealth();
    } catch (e) {
      this.log.warn(`cron: ${(e as Error).message}`);
    }
  }

  /**
   * Conexões ACTIVE com conta escolhida e lastSyncAt mais velho que META_SYNC_EVERY_HOURS (ou nunca): 1 job cada, 30 s
   * entre elas. Conexão cujo último sync falhou espera o backoff (5 → 15 → 60 min → 6 h) em vez de bater a cada minuto.
   */
  async tickSync(now = Date.now()): Promise<number> {
    const before = new Date(now - this.config.metaSyncEveryHours * HOUR_MS);
    const due = await this.prisma.metaConnection.findMany({
      where: { status: 'ACTIVE', adAccountId: { not: null }, pageId: { not: null }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: before } }], ...ownConnectionsWhere(this.config.metaMode) },
      orderBy: { lastSyncAt: 'asc' }, take: 50,
    });
    let n = 0;
    for (const c of due) {
      if (!this.backoff.allows(c.id, now)) continue;
      if (await this.runningJob(c.workspaceId)) continue;
      const delay = n * STAGGER_MS;
      const start = () => this.kick(c, c.connectedById, false).catch((e) => this.log.warn(`cron sync ${c.id}: ${(e as Error).message}`));
      if (delay) setTimeout(() => void start(), delay).unref();
      else await start();
      n++;
    }
    return n;
  }

  /** Health 1×/dia por conexão ACTIVE com conta escolhida. */
  async tickHealth(now = Date.now()): Promise<number> {
    const due = await this.prisma.metaConnection.findMany({
      where: { status: 'ACTIVE', adAccountId: { not: null }, OR: [{ lastHealthAt: null }, { lastHealthAt: { lt: new Date(now - DAY_MS) } }], ...ownConnectionsWhere(this.config.metaMode) }, take: 50,
    });
    for (const c of due) await this.conexao.runHealth(c.id).catch((e) => this.log.warn(`cron health ${c.id}: ${(e as Error).message}`));
    return due.length;
  }

  // ───────── leitura (§3.2) ─────────

  /** Estado do sync (§5.3), derivado. */
  async syncState(c: MetaConnection, hasSnapshots: boolean, now = Date.now()): Promise<MetaSyncState> {
    const running = await this.runningJob(c.workspaceId);
    const last = c.lastSyncJobId ? await this.prisma.job.findUnique({ where: { id: c.lastSyncJobId } }) : null;
    const syncedAt = c.lastSyncAt?.toISOString() ?? null;
    if (!c.adAccountId || !c.pageId) return { state: 'never', syncedAt, progress: null, job: null };
    if (running) {
      const inp = (running.input ?? {}) as { done?: number; total?: number };
      const progress = inp.total ? { done: inp.done ?? 0, total: inp.total, unit: 'ads' as const } : null;
      return { state: hasSnapshots ? 'syncing' : 'first_sync', syncedAt, progress, job: presentJob(running) };
    }
    const failedLast = last?.status === 'FAILED' && (!c.lastSyncAt || last.createdAt > c.lastSyncAt);
    if (failedLast || (c.lastSyncError && !c.lastSyncAt)) return { state: 'failed', syncedAt, progress: null, job: last ? presentJob(last) : null };
    if (!c.lastSyncAt) return { state: hasSnapshots ? 'ok' : 'never', syncedAt, progress: null, job: null };
    if (now - c.lastSyncAt.getTime() > STALE_AFTER_MS) return { state: 'stale', syncedAt, progress: null, job: null };
    return { state: 'ok', syncedAt, progress: null, job: null };
  }

  /** Gusta 25/10: snapshot só com a conexão saudável (login vencido ou permissão faltando = 422, nunca o dado guardado). */
  private async readable(workspaceId: string): Promise<MetaConnection> {
    return assertHealthy(await this.prisma.metaConnection.findUnique({ where: { workspaceId } }));
  }

  /** campanhas-v1 D2: o sync guarda todos os formatos; Home/summary/tour seguem só com vídeo (mesma mediana de antes). */
  private async snapshots(c: MetaConnection, format: 'video' | 'all' = 'video'): Promise<MetaAdSnapshot[]> {
    return this.prisma.metaAdSnapshot.findMany({ where: { connectionId: c.id, ...(format === 'video' && { videoId: { not: null } }) } });
  }

  /** GET /meta/summary?period=7d|30d (§3.2, §5.3). */
  async summary(auth: AuthContext, period: MetaPeriod = '30d', now = Date.now()): Promise<MetaSummary> {
    const c = await this.readable(auth.workspaceId);
    return this.summaryOf(c, await this.snapshots(c), period, now);
  }

  summaryOf(c: MetaConnection, rows: MetaAdSnapshot[], period: MetaPeriod, now = Date.now()): Promise<MetaSummary> {
    const rule = this.meta.rule();
    const ads = rows.map((r) => ({ metrics: metricsOf(r.metrics), metrics7d: metricsOf(r.metrics7d), metricsPrev7d: metricsOf(r.metricsPrev7d), row: r }));
    const cur = ads.map((a) => (period === '7d' ? a.metrics7d : a.metrics));
    const prev = period === '7d' ? ads.map((a) => a.metricsPrev7d) : null;
    const agg = aggregate(cur);
    const prevAgg = prev ? aggregate(prev) : null;
    const eligible = ads.filter((a) => isEligible(a.metrics, rule, c.currency));
    const weekAgo = now - 7 * DAY_MS;
    return this.syncState(c, rows.length > 0, now).then((sync) => ({
      period, currency: c.currency,
      spend: agg.spend, results: agg.results, resultType: agg.resultType, cpa: agg.cpa, roas: agg.roas, ctr: agg.ctr, hookRate: agg.hookRate,
      prev: prevAgg && prev!.some((m) => m.spend > 0) ? { spend: prevAgg.spend, cpa: prevAgg.cpa, roas: prevAgg.roas } : null,
      medianCpa: medianCpaOf(ads, rule, c.currency),
      adsCount: rows.length, activeAds: rows.filter((r) => r.effectiveStatus === 'ACTIVE').length,
      newThisWeek: rows.filter((r) => r.adCreatedTime && r.adCreatedTime.getTime() >= weekAgo).length,
      eligibleCount: eligible.length, winnersCount: rows.filter((r) => r.verdict === 'WINNER').length,
      tiringCount: rows.filter((r) => r.effectiveStatus === 'ACTIVE' && r.trend === 'TIRING').length,
      rule: { minSpendUsd: rule.minSpendUsd, minResults: rule.minResults },
      sync,
    }));
  }

  /** Regra do vencedor da porta (meta-v1 §5), pro veredito dentro da oferta (meta-oferta-v1 §4.3). */
  ruleOf(): MetaWinnerRule {
    return this.meta.rule();
  }

  /** Contexto das linhas (link do Ads Manager por nível, quem pode escrever, mínimo da conta). */
  rowCtx(auth: AuthContext, c: MetaConnection): RowCtx {
    const adAccountId = c.adAccountId ?? '';
    return {
      adAccountId, currency: c.currency ?? 'USD',
      minimumMinor: storedHealthOf(c.lastHealth)?._account?.minimumDailyBudgetMinor ?? null,
      canWrite: canWriteOf(auth.role, c),
      url: (level, id) => this.meta.objectUrl?.(adAccountId, level, id) ?? (level === 'ad' ? this.meta.adsManagerUrl(adAccountId, id) : adsManagerObjectUrl(adAccountId, level, id)),
    };
  }

  /** creative (publicação HookMill) e championId por anúncio, em 2 queries. */
  async adLinks(workspaceId: string, ids: string[]) {
    const [pubs, champs] = ids.length
      ? await Promise.all([
          this.prisma.metaPublication.findMany({ where: { workspaceId, metaAdId: { in: ids } }, include: { creative: { select: { id: true, name: true, adName: true } } }, orderBy: { createdAt: 'desc' } }),
          this.prisma.champion.findMany({ where: { workspaceId, metaAdId: { in: ids }, archivedAt: null }, select: CHAMP_LINK_SELECT, orderBy: { createdAt: 'desc' } }),
        ])
      : [[], []];
    const pubBy = new Map<string, { id: string; name: string; adName: string | null }>();
    for (const p of pubs) if (p.metaAdId && !pubBy.has(p.metaAdId)) pubBy.set(p.metaAdId, p.creative);
    const champBy = new Map<string, string>();
    for (const ch of champs) if (ch.metaAdId && !champBy.has(ch.metaAdId)) champBy.set(ch.metaAdId, ch.id);
    return { pubBy, champBy, iterBy: lastIteratedBy(champs) };
  }

  /**
   * GET /meta/ads (§3.2 + campanhas-v1 §3): `format` padrão video (Pick from Meta e tour iguais); a Campaigns manda all.
   * Filtros verdict/trend/status/origin/campaignId/adsetId/q; ordem padrão WINNER primeiro, gasto desc; `sort` + `period` + `dir`.
   */
  async ads(auth: AuthContext, q: MetaAdsFilter): Promise<{ items: MetaAdRow[]; meta: MetaAdsMeta }> {
    // meta-oferta-v1 §4.1: offerScope só com offerId; offerId de outro workspace = 404
    if (q.offerScope && !q.offerId) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'offerScope', rule: 'requires_offer' }] });
    if (q.offerId) await this.offerLinks.assertOffer(auth.workspaceId, q.offerId);
    const c = await this.readable(auth.workspaceId);
    const all = await this.snapshots(c, 'all');
    const videoRows = all.filter((r) => !!r.videoId);
    const now = Date.now();
    // §3: casamento calculado na leitura sobre a conta inteira (o irmão precisa dos vizinhos); §4.3 veredito da oferta
    const om = await this.offerLinks.match(auth, c, all, q.offerId ?? null);
    const ov = q.offerId ? offerVerdicts(all, om, this.meta.rule(), c.currency) : null;
    const verdictOf = (r: MetaAdSnapshot): MetaAdVerdict => ov?.verdicts.get(r.metaAdId) ?? r.verdict;
    let list = q.format === 'all' ? all : videoRows;
    if (q.verdict) list = list.filter((r) => verdictOf(r) === q.verdict);
    if (q.trend) list = list.filter((r) => r.trend === q.trend);
    if (q.campaignId) list = list.filter((r) => r.campaignId === q.campaignId);
    if (q.adsetId) list = list.filter((r) => r.adsetId === q.adsetId);
    if (q.q) {
      const needle = q.q.trim().toLowerCase();
      list = list.filter((r) => r.metaAdId === q.q!.trim() || r.name.toLowerCase().includes(needle) || r.campaignName.toLowerCase().includes(needle) || r.adsetName.toLowerCase().includes(needle));
    }
    // origem HookMill precisa das publicações de toda a lista (antes de paginar)
    const links = q.origin === 'hookmill' ? await this.adLinks(c.workspaceId, list.map((r) => r.metaAdId)) : null;
    if (links) list = list.filter((r) => links.pubBy.has(r.metaAdId));
    // campanhas-v1 §10: contagem por status com os outros filtros, ignorando o de status
    const counts = statusCounts(list, (r, f) => matchesStatus(r.effectiveStatus, f));
    if (q.status) list = list.filter((r) => matchesStatus(r.effectiveStatus, q.status));
    // meta-oferta-v1 §4.2-4.4: contagem por grupo e cobertura de link com os filtros de hoje, antes do offerScope
    let offerMeta: MetaOfferListMeta | undefined;
    if (q.offerId && ov) {
      offerMeta = {
        offerId: q.offerId, counts: fitCounts(list, (r) => om.fit(r.metaAdId)),
        verdictScope: ov.scope, medianCpa: ov.medianCpa,
        links: linkCoverage(list.map((r) => ({ destinationUrls: r.destinationUrls ?? [], destinationSource: r.destinationSource }))),
        offerHasUrl: om.offerHasUrl(),
      };
      if (q.offerScope && q.offerScope !== 'all') list = list.filter((r) => om.fit(r.metaAdId) === q.offerScope);
    }
    const period = q.period ?? '30d';
    const scored = list.map((r) => ({ row: r, verdict: verdictOf(r), metrics: periodMetrics(r, period) }));
    // `dir` sem `sort` = ordena por gasto nessa direção (o web não ordena mais no cliente)
    let ordered = q.sort || q.dir
      ? sortRows(scored, (x) => ({ m: x.metrics, budget: null, name: x.row.name }), (q.sort ?? 'spend') as MetaSort, q.dir)
      : scored.sort(compareAds);
    // §4.2 passo 4: grupo primeiro (this → unknown → other), o sort de hoje dentro do grupo (sort estável)
    if (q.offerId) ordered = [...ordered].sort((a, b) => FIT_RANK[om.fit(a.row.metaAdId) ?? 'unknown'] - FIT_RANK[om.fit(b.row.metaAdId) ?? 'unknown']);
    // campanhas-v1 §11: totais do conjunto FILTRADO inteiro (antes de paginar), na janela de `period`
    const t = aggregate(ordered.map((x) => x.metrics));
    const totals = { count: ordered.length, spend: t.spend, results: t.results, resultType: t.resultType, cpa: t.cpa, ctr: t.ctr, hookRate: t.hookRate };
    const limit = q.limit ?? 30;
    const offset = decodeOffset(q.cursor);
    const slice = ordered.slice(offset, offset + limit);
    const nextCursor = offset + limit < ordered.length ? encodeOffset(offset + limit) : null;
    const { pubBy, champBy, iterBy } = links ?? (await this.adLinks(c.workspaceId, slice.map((s) => s.row.metaAdId)));
    const ctx = this.rowCtx(auth, c);
    const items = slice.map(({ row: r, verdict }) => ({
      ...presentAd(r, pubBy.get(r.metaAdId) ?? null, champBy.get(r.metaAdId) ?? null, now, ctx, iterBy.get(r.metaAdId) ?? null, om.info(r)),
      verdict,
    }));
    return { items, meta: { nextCursor, counts, totals, summary: await this.summaryOf(c, videoRows, '30d', now), ...(offerMeta && { offer: offerMeta }) } };
  }
}

/**
 * meta-oferta-v1 §4.3 (D7): com ≥ 3 anúncios de vídeo elegíveis no grupo `this`, o veredito das linhas `this` é recalculado
 * contra a mediana de CPA só desses (WINNER ≤ mediana, OK acima, LOW_DATA não elegível). Abaixo disso vale o da conta.
 * `unknown`/`other` mantêm o da conta; o snapshot não muda.
 */
export function offerVerdicts(rows: MetaAdSnapshot[], om: Pick<OfferMatch, 'fit'>, rule: MetaWinnerRule, currency: string | null): { scope: 'offer' | 'account'; medianCpa: number | null; verdicts: Map<string, MetaAdVerdict> } {
  const mine = rows.filter((r) => om.fit(r.metaAdId) === 'this');
  const cpas = mine.filter((r) => !!r.videoId).map((r) => metricsOf(r.metrics)).filter((m) => isEligible(m, rule, currency)).map((m) => m.cpa as number);
  if (cpas.length < OFFER_VERDICT_MIN_ELIGIBLE) return { scope: 'account', medianCpa: null, verdicts: new Map() };
  const med = median(cpas)!;
  const verdicts = new Map<string, MetaAdVerdict>();
  for (const r of mine) {
    const m = metricsOf(r.metrics);
    verdicts.set(r.metaAdId, !isEligible(m, rule, currency) ? 'LOW_DATA' : (m.cpa as number) <= med ? 'WINNER' : 'OK');
  }
  return { scope: 'offer', medianCpa: med, verdicts };
}
/** D7 (aprovado 04/11): mínimo de elegíveis na oferta pro veredito dentro dela. */
export const OFFER_VERDICT_MIN_ELIGIBLE = 3;

/** §4.2: { this, unknown, other }. Sem fit (sem offerId) conta como unknown. */
export function fitCounts<T>(rows: T[], fit: (r: T) => MetaOfferFit | null): { this: number; unknown: number; other: number } {
  const out = { this: 0, unknown: 0, other: 0 };
  for (const r of rows) out[fit(r) ?? 'unknown']++;
  return out;
}

/** Filtros do GET /meta/ads (meta-v1 §3.2 + campanhas-v1 §3). */
export interface MetaAdsFilter {
  verdict?: string; trend?: string; q?: string; sort?: string; limit?: number; cursor?: string;
  status?: MetaStatusFilter; origin?: 'all' | 'hookmill'; campaignId?: string; adsetId?: string; format?: 'video' | 'all'; period?: MetaPeriod; dir?: 'asc' | 'desc';
  /** meta-oferta-v1 §4.1 */
  offerId?: string; offerScope?: MetaOfferScope;
}

/** lacunas-home-eddy-v1 §4: o lote mais novo de cada campeão vem junto da consulta de campeões (sem query nova). */
export const CHAMP_LINK_SELECT = {
  id: true, metaAdId: true, batches: { select: { createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;
/** metaAdId → createdAt do lote mais recente entre os campeões (não arquivados) daquele anúncio. */
export function lastIteratedBy(champs: { metaAdId: string | null; batches: { createdAt: Date }[] }[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const ch of champs) {
    const at = ch.batches[0]?.createdAt;
    if (!ch.metaAdId || !at) continue;
    const cur = out.get(ch.metaAdId);
    if (!cur || at > cur) out.set(ch.metaAdId, at);
  }
  return out;
}

export function presentAd(
  r: MetaAdSnapshot, creative: { id: string; name: string; adName: string | null } | null, championId: string | null, now = Date.now(),
  ctx?: Pick<RowCtx, 'canWrite' | 'url'>, lastIteratedAt: Date | null = null, offer?: MetaAdOfferInfo,
): MetaCampaignAdRow {
  return {
    ...(offer && { offer }), // meta-oferta-v1 §4.5
    lastIteratedAt: lastIteratedAt?.toISOString() ?? null, // lacunas-home-eddy-v1 §4
    // campanhas-v1 §3: sempre presentes (o toggle, selo HookMill, link por nível, permissões)
    status: toggleOf(r.status ?? 'ACTIVE'), fromHookMill: !!creative,
    adsManagerUrl: ctx?.url('ad', r.metaAdId) ?? '', canToggle: canToggleOf(ctx?.canWrite ?? false, r.effectiveStatus), canIterate: !!r.videoId,
    metaAdId: r.metaAdId, name: r.name, effectiveStatus: r.effectiveStatus,
    campaign: { id: r.campaignId, name: r.campaignName }, adset: { id: r.adsetId, name: r.adsetName },
    thumbnailUrl: r.thumbnailUrl, videoId: r.videoId,
    metrics: metricsOf(r.metrics), metrics7d: metricsOf(r.metrics7d), metricsPrev7d: metricsOf(r.metricsPrev7d),
    verdict: r.verdict, trend: r.trend,
    daysRunning: r.adCreatedTime ? Math.max(0, Math.floor((now - r.adCreatedTime.getTime()) / DAY_MS)) : null,
    creative, championId,
    adCreatedTime: r.adCreatedTime?.toISOString() ?? null, syncedAt: r.syncedAt.toISOString(),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Soma de MetaMetrics: cpa = gasto/resultados, ctr = cliques/impressões, roas ponderado pelo gasto, hookRate = plays2s/impressões (video_continuous_2_sec_watched_actions, 22/10). */
export function aggregate(ms: { spend: number; impressions: number; clicks: number; results: number; resultType: string | null; roas: number | null; plays2s: number | null }[]) {
  const spend = r2(ms.reduce((a, m) => a + m.spend, 0));
  const impressions = ms.reduce((a, m) => a + m.impressions, 0);
  const clicks = ms.reduce((a, m) => a + m.clicks, 0);
  const results = ms.reduce((a, m) => a + m.results, 0);
  const roasSpend = ms.filter((m) => m.roas != null && m.spend > 0);
  const value = roasSpend.reduce((a, m) => a + (m.roas as number) * m.spend, 0);
  const roasBase = roasSpend.reduce((a, m) => a + m.spend, 0);
  const withPlays = ms.filter((m) => m.plays2s != null);
  const plays = withPlays.reduce((a, m) => a + (m.plays2s as number), 0);
  const playsImp = withPlays.reduce((a, m) => a + m.impressions, 0);
  return {
    spend, results, impressions, clicks,
    resultType: ms.find((m) => m.resultType)?.resultType ?? null,
    cpa: results > 0 ? r2(spend / results) : null,
    ctr: impressions > 0 ? r2((clicks / impressions) * 100) : null,
    roas: roasBase > 0 ? r2(value / roasBase) : null,
    hookRate: playsImp > 0 ? r2((plays / playsImp) * 100) : null,
  };
}

export function encodeOffset(n: number): string {
  return Buffer.from(JSON.stringify({ o: n })).toString('base64url');
}
export function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const n = Number((JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: unknown }).o);
    if (!Number.isInteger(n) || n < 0) throw new Error('bad');
    return n;
  } catch {
    throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'cursor', rule: 'isCursor' }] });
  }
}
