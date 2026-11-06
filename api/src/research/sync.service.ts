// ads-research-v1 §3 + C.5: coletas da Ad Library (fila própria em research_syncs: status + notBefore, sem Job).
//  - Coleta de Página (PAGE): fusão por ad_archive_id, trava de 30 %, anúncio ausente numa coleta COMPLETA = parou,
//    limite adaptativo, 3 falhas "Página sumiu" seguidas = concorrente aposentado (evento pro CompetitorsService).
//  - Sonda da descoberta (KEYWORD, sem fonte): os anúncios entram na base global (o grid não fica vazio na importação).
//  - Poster copiado pro storage na coleta (a URL do fbcdn vence em ~4,4 dias e o sync é semanal); vídeo só ao salvar/usar.
//  - 402 concurrent-runs (RETRYABLE) volta pra fila com notBefore (não é cobrado); teto global estourado = dia seguinte.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import type { AccountAccess } from '@maquina/contratos';
import { Prisma, type AdSource, type ResearchSync, type ResearchTrigger } from '@prisma/client';
import { Readable } from 'node:stream';
import { StorageService } from '../arquivos/storage.service';
import { failReasonFor } from '../common/errors/falhas';
import type { LibraryAdDraft, ResearchScrapeResult } from '../integracoes';
import { isIntegracaoError } from '../integracoes';
import type { AdLibraryResearchService } from '../integracoes/contrato';
import { ADS_RESEARCH_SERVICE } from '../integracoes/portas';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService, nextDayUtc } from './caps.service';
import { DAY_MS, isSuspectSync } from './regras';
import { ResearchConfig } from './research.config';

/** Evento: a Página da fonte sumiu 3 coletas seguidas (PAGE_PRIVATE) → concorrentes RETIRED e vaga pra reserva. */
export const RESEARCH_SOURCE_GONE = 'research.source.gone';
/** Evento: coleta MEDIA terminou (o MediaService baixa o vídeo e acorda o campeão que espera). */
export const RESEARCH_MEDIA_SYNCED = 'research.media.synced';
export interface MediaSyncedEvent { syncId: string; targetAdId: string; ok: boolean; errorCode: string | null }

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 30_000;
const POSTER_TIMEOUT_MS = 15_000;
const GONE_CODES = new Set(['PAGE_PRIVATE', 'ADS_NOT_FOUND', 'PAGE_NOT_FOUND']);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const dateOrNull = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : null);

export const posterKeyOf = (adArchiveId: string) => `research/${adArchiveId}/poster.jpg`;
export const videoKeyOf = (adArchiveId: string) => `research/${adArchiveId}/video.mp4`;
export const avatarKeyOf = (pageId: string) => `research/pages/${pageId}/avatar.jpg`;

/** Erro do scrape já traduzido pro status da coleta. */
interface ScrapeFailure { code: string; reason: string; retry: boolean; costUsd?: number; runId?: string }

export interface MergeResult { adIds: string[]; created: number; active: number; byPage: Map<string, { pageName: string; adIds: string[] }> }

@Injectable()
export class ResearchSyncService {
  private readonly log = new Logger('ResearchSync');
  private ticking = false;
  private lastHousekeepingDay = '';
  /** Retenção/aposentar 1×/dia (registrado pelo RetencaoService pra não criar ciclo de construtor). */
  housekeeping: (() => Promise<void>) | null = null;
  /** Descobertas na fila (registrado pelo DiscoveryService). */
  discoveryTick: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly bus: EventEmitter2,
    @Inject(ADS_RESEARCH_SERVICE) private readonly adlib: AdLibraryResearchService,
  ) {}

  // ───────── fontes ─────────

  /** Fonte = Página + país (global). Atualiza nome/curtidas; avatar copiado na 1ª vez (best effort). */
  async ensureSource(i: { pageId: string; countryCode: string; displayName: string; likeCount?: number | null; avatarUrl?: string | null }): Promise<AdSource> {
    const src = await this.prisma.adSource.upsert({
      where: { pageId_countryCode: { pageId: i.pageId, countryCode: i.countryCode } },
      create: { pageId: i.pageId, countryCode: i.countryCode, displayName: i.displayName.slice(0, 200) || i.pageId, likeCount: i.likeCount ?? null },
      update: { displayName: i.displayName.slice(0, 200) || undefined, ...(i.likeCount != null && { likeCount: i.likeCount }) },
    });
    if (!src.avatarKey && i.avatarUrl) {
      const key = avatarKeyOf(i.pageId);
      if (await this.copyRemote(i.avatarUrl, key, 'image/jpeg', 5 * 1024 * 1024)) {
        return this.prisma.adSource.update({ where: { id: src.id }, data: { avatarKey: key } });
      }
    }
    return src;
  }

  /** Fonte com seguidor ativo = ACTIVE; sem nenhum = PAUSED (não sincroniza). */
  async refreshSourceStatus(sourceId: string): Promise<void> {
    const followers = await this.prisma.competitor.count({ where: { sourceId, status: 'ACTIVE' } });
    await this.prisma.adSource.update({ where: { id: sourceId }, data: { status: followers ? 'ACTIVE' : 'PAUSED' } });
  }

  /** Liga à fonte os anúncios da Página que já estão na base global (vieram das sondas da descoberta). */
  async linkPageAds(source: Pick<AdSource, 'id' | 'pageId'>): Promise<number> {
    const ads = await this.prisma.libraryAd.findMany({ where: { pageId: source.pageId }, select: { id: true } });
    if (!ads.length) return 0;
    await this.prisma.adSourceAd.createMany({ data: ads.map((a) => ({ sourceId: source.id, adId: a.id })), skipDuplicates: true });
    return ads.length;
  }

  /** Teto de anúncios da fonte = o maior plano entre os seguidores ativos. */
  async sourceAccess(sourceId: string): Promise<AccountAccess> {
    const ws = await this.prisma.competitor.findMany({ where: { sourceId, status: 'ACTIVE' }, select: { workspaceId: true }, distinct: ['workspaceId'] });
    const order: AccountAccess[] = ['SAMPLE', 'PAID', 'INTERNAL'];
    let best: AccountAccess = 'SAMPLE';
    for (const w of ws) {
      const a = await this.caps.access(w.workspaceId);
      if (order.indexOf(a) > order.indexOf(best)) best = a;
    }
    return best;
  }

  // ───────── fila ─────────

  /** Coleta aberta (QUEUED/RUNNING) da fonte, se houver. */
  openSync(sourceId: string): Promise<ResearchSync | null> {
    return this.prisma.researchSync.findFirst({ where: { sourceId, kind: 'PAGE', status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Põe uma coleta de Página na fila e (se não for pra depois) já roda em segundo plano. 1 por fonte: se já há uma aberta,
   * devolve ela (quem precisa de 409 confere antes). `delayToTomorrow` = teto global estourado (descoberta/importação/semanal).
   */
  async enqueuePage(i: {
    source: Pick<AdSource, 'id' | 'pageId' | 'countryCode'>; trigger: ResearchTrigger; limit: number;
    workspaceId?: string | null; userId?: string | null; discoveryId?: string | null; targetAdId?: string | null; run?: boolean;
  }): Promise<ResearchSync> {
    const open = await this.openSync(i.source.id);
    if (open) {
      // mídia pedida com uma coleta já aberta: aponta o anúncio pra ela (o fim da coleta acorda quem espera)
      if (i.targetAdId && !open.targetAdId) return this.prisma.researchSync.update({ where: { id: open.id }, data: { targetAdId: i.targetAdId } });
      return open;
    }
    const estimate = this.cfg.scrapeEstimateUsd(i.limit);
    const delay = i.trigger !== 'MANUAL' && i.trigger !== 'MEDIA' && !(await this.caps.globalFits(estimate));
    const s = await this.prisma.researchSync.create({
      data: {
        sourceId: i.source.id, kind: 'PAGE', query: i.source.pageId, countryCode: i.source.countryCode, trigger: i.trigger, status: 'QUEUED',
        requestedByWorkspaceId: i.workspaceId ?? null, requestedById: i.userId ?? null, discoveryId: i.discoveryId ?? null,
        targetAdId: i.targetAdId ?? null, requestedLimit: Math.max(10, i.limit), notBefore: delay ? nextDayUtc() : null,
      },
    });
    if (!delay && i.run !== false) this.kick(s.id);
    return s;
  }

  kick(syncId: string): void {
    void this.jobs.detach(null, `coleta ${syncId}`, () => this.run(syncId));
  }

  /** Roda uma coleta QUEUED (CAS pra RUNNING). Nunca lança. */
  async run(syncId: string): Promise<void> {
    const claimed = await this.prisma.researchSync.updateMany({
      where: { id: syncId, status: 'QUEUED', OR: [{ notBefore: null }, { notBefore: { lte: new Date() } }] },
      data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (!claimed.count) return;
    const s = await this.prisma.researchSync.findUniqueOrThrow({ where: { id: syncId }, include: { source: true } });
    try {
      if (this.cfg.mode === 'off') throw { code: 'AD_LIBRARY_UNAVAILABLE', reason: failReasonFor('AD_LIBRARY_UNAVAILABLE'), retry: false } satisfies ScrapeFailure;
      const r = await this.scrapeOrFail({ kind: 'PAGE', query: s.query, countryCode: s.countryCode, limit: s.requestedLimit, ref: s.id });
      await this.finishPage(s, r);
    } catch (e) {
      const f = this.failureOf(e);
      if (f.retry && s.attempts < MAX_ATTEMPTS) {
        await this.prisma.researchSync.update({ where: { id: s.id }, data: { status: 'QUEUED', notBefore: new Date(Date.now() + RETRY_DELAY_MS), startedAt: null } });
        return;
      }
      await this.prisma.researchSync.update({
        where: { id: s.id }, data: { status: 'FAILED', errorCode: f.retry ? 'PROVIDER_ERROR' : f.code, failReason: f.reason, finishedAt: new Date() },
      });
      await this.recordFailureCost(s, f);
      if (s.sourceId) await this.prisma.adSource.update({ where: { id: s.sourceId }, data: { lastSyncAt: new Date() } }).catch(() => undefined);
      this.mediaDone(s, false, f.code);
    }
  }

  private async scrapeOrFail(i: { kind: 'PAGE' | 'KEYWORD'; query: string; searchType?: 'unordered' | 'exact_phrase'; countryCode: string; limit: number; ref: string }): Promise<ResearchScrapeResult> {
    const timeout = this.cfg.syncTimeoutMs + 30_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.adlib.scrape({ ...i, limit: Math.max(10, i.limit) }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej({ code: 'PROVIDER_TIMEOUT', reason: failReasonFor('PROVIDER_TIMEOUT'), retry: false }), timeout); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private failureOf(e: unknown): ScrapeFailure {
    if (e && typeof e === 'object' && 'retry' in e && 'code' in e) return e as ScrapeFailure;
    if (isIntegracaoError(e)) {
      const code = e.code as string;
      if (code === 'RETRYABLE') return { code, reason: failReasonFor('PROVIDER_ERROR'), retry: true };
      const cost = typeof e.details?.costUsd === 'number' ? e.details.costUsd : undefined;
      const runId = typeof e.details?.runId === 'string' ? e.details.runId : undefined;
      if (code === 'AD_LIBRARY_UNAVAILABLE' || code === 'PROVIDER_TIMEOUT' || code === 'AD_NOT_FOUND') return { code, reason: failReasonFor(code), retry: false, costUsd: cost, runId };
      return { code: 'PROVIDER_ERROR', reason: failReasonFor('PROVIDER_ERROR'), retry: false, costUsd: cost, runId };
    }
    this.log.error(`coleta falhou: ${(e as Error)?.stack ?? e}`);
    return { code: 'PROVIDER_ERROR', reason: failReasonFor('PROVIDER_ERROR'), retry: false };
  }

  /** Fim de uma coleta de Página: custo, Página sumiu, trava de 30 %, fusão, parados, fonte. */
  private async finishPage(s: ResearchSync & { source: AdSource | null }, r: ResearchScrapeResult): Promise<void> {
    await this.recordCost(s, r);
    const source = s.source;
    const gone = r.items.length === 0 && r.errors.some((e) => GONE_CODES.has(e.code));
    if (gone || !source) {
      await this.prisma.researchSync.update({
        where: { id: s.id }, data: { status: 'FAILED', errorCode: 'AD_NOT_FOUND', failReason: failReasonFor('AD_NOT_FOUND'), itemsRaw: r.itemsRaw, itemsError: r.errors.length, finishedAt: new Date() },
      });
      if (source) {
        const src = await this.prisma.adSource.update({ where: { id: source.id }, data: { consecutiveFailures: { increment: 1 }, lastSyncAt: new Date() } });
        if (src.consecutiveFailures >= 3) this.bus.emit(RESEARCH_SOURCE_GONE, { sourceId: source.id });
      }
      this.mediaDone(s, false, 'AD_NOT_FOUND');
      return;
    }
    const active = r.items.filter((d) => d.isActive).length;
    if (isSuspectSync(active, source.lastActiveCount)) {
      await this.prisma.researchSync.update({
        where: { id: s.id }, data: { status: 'SUSPECT', itemsRaw: r.itemsRaw, itemsError: r.errors.length, adsActive: active, finishedAt: new Date() },
      });
      await this.prisma.adSource.update({ where: { id: source.id }, data: { lastSyncAt: new Date() } });
      this.mediaDone(s, false, 'PROVIDER_ERROR');
      return;
    }
    const m = await this.merge(r.items, source);
    // anúncio da fonte ausente numa coleta COMPLETA (veio menos que o limite) = parou hoje
    let stopped = 0;
    if (r.items.length < s.requestedLimit) {
      const res = await this.prisma.libraryAd.updateMany({
        where: { isActive: true, sources: { some: { sourceId: source.id } }, id: { notIn: m.adIds } },
        data: { isActive: false, stoppedAt: today() },
      });
      stopped = res.count;
    }
    const first = r.items[0];
    await this.prisma.adSource.update({
      where: { id: source.id },
      data: {
        lastSyncAt: new Date(), lastValidSyncAt: new Date(), nextSyncAt: new Date(Date.now() + 7 * DAY_MS), lastActiveCount: active, consecutiveFailures: 0,
        ...(first?.pageLikeCount != null && { likeCount: first.pageLikeCount }),
        ...(first?.pageName && { displayName: first.pageName.slice(0, 200) }),
      },
    });
    if (!source.avatarKey && first?.pageAvatarUrl) await this.ensureSource({ pageId: source.pageId, countryCode: source.countryCode, displayName: first.pageName, avatarUrl: first.pageAvatarUrl });
    await this.prisma.researchSync.update({
      where: { id: s.id },
      data: { status: 'SUCCEEDED', itemsRaw: r.itemsRaw, itemsError: r.errors.length, adsActive: active, adsNew: m.created, adsStopped: stopped, finishedAt: new Date() },
    });
    await this.copyPosters(r.items);
    this.mediaDone(s, true, null);
  }

  /** Custo real no sync (teto global) + parte atribuída (CostEntry): pedida = workspace inteiro; semanal = rateio. */
  private async recordCost(s: ResearchSync, r: ResearchScrapeResult): Promise<void> {
    const cost = round4(r.costUsd);
    await this.prisma.researchSync.update({ where: { id: s.id }, data: { costUsd: cost, apifyRunId: r.runId || null } }).catch(async () => {
      // runId repetido (mock determinístico): grava sem ele
      await this.prisma.researchSync.update({ where: { id: s.id }, data: { costUsd: cost } });
    });
    if (s.trigger === 'SCHEDULED' && s.sourceId) {
      await this.caps.chargeShared({ syncId: s.id, sourceId: s.sourceId, amountUsd: cost, model: r.actor });
      return;
    }
    if (s.requestedByWorkspaceId) {
      await this.caps.chargeSync(this.prisma, { syncId: s.id, workspaceId: s.requestedByWorkspaceId, discoveryId: s.discoveryId, amountUsd: cost, model: r.actor, units: 1 });
    }
  }

  /** Run que falhou mas foi cobrado (PROVIDER_ERROR com custo): grava igual (teto global e do workspace). */
  private async recordFailureCost(s: ResearchSync, f: ScrapeFailure): Promise<void> {
    if (!f.costUsd || f.costUsd <= 0) return;
    await this.recordCost(s, { items: [], errors: [], runId: f.runId ?? '', costUsd: f.costUsd, itemsRaw: 0, actor: 'apify' });
  }

  private mediaDone(s: ResearchSync, ok: boolean, errorCode: string | null): void {
    if (s.targetAdId) this.bus.emit(RESEARCH_MEDIA_SYNCED, { syncId: s.id, targetAdId: s.targetAdId, ok, errorCode } satisfies MediaSyncedEvent);
  }

  // ───────── sonda da descoberta (KEYWORD) ─────────

  /**
   * D2/D3: uma busca por termo/domínio, síncrona dentro da descoberta. Grava o ResearchSync (sem fonte) com custo e o
   * CostEntry inteiro no workspace (discoveryId). Os anúncios entram na base global. Erro = null (a descoberta segue).
   */
  async probe(i: {
    discoveryId: string; workspaceId: string; query: string; searchType: 'unordered' | 'exact_phrase'; countryCode: string; limit: number;
  }): Promise<{ result: ResearchScrapeResult; merge: MergeResult; syncId: string } | { error: string; syncId: string; costUsd: number }> {
    let s = await this.prisma.researchSync.create({
      data: {
        kind: 'KEYWORD', query: i.query.slice(0, 300), countryCode: i.countryCode, trigger: 'DISCOVERY', status: 'RUNNING', startedAt: new Date(), attempts: 1,
        requestedByWorkspaceId: i.workspaceId, discoveryId: i.discoveryId, requestedLimit: Math.max(10, i.limit),
      },
    });
    for (;;) {
      try {
        const r = await this.scrapeOrFail({ kind: 'KEYWORD', query: i.query, searchType: i.searchType, countryCode: i.countryCode, limit: i.limit, ref: s.id });
        await this.recordCost(s, r);
        const merge = await this.merge(r.items, null);
        await this.prisma.researchSync.update({
          where: { id: s.id }, data: { status: 'SUCCEEDED', itemsRaw: r.itemsRaw, itemsError: r.errors.length, adsActive: r.items.filter((d) => d.isActive).length, adsNew: merge.created, finishedAt: new Date() },
        });
        await this.copyPosters(r.items).catch(() => undefined);
        return { result: r, merge, syncId: s.id };
      } catch (e) {
        const f = this.failureOf(e);
        if (f.retry && s.attempts < MAX_ATTEMPTS) {
          s = await this.prisma.researchSync.update({ where: { id: s.id }, data: { attempts: { increment: 1 } } });
          await new Promise((res) => setTimeout(res, process.env.NODE_ENV === 'test' ? 10 : 3000));
          continue;
        }
        await this.prisma.researchSync.update({ where: { id: s.id }, data: { status: 'FAILED', errorCode: f.retry ? 'PROVIDER_ERROR' : f.code, failReason: f.reason, finishedAt: new Date() } });
        await this.recordFailureCost(s, f);
        return { error: f.code, syncId: s.id, costUsd: f.costUsd ?? 0 };
      }
    }
  }

  // ───────── fusão ─────────

  /** Upsert por ad_archive_id (base global) e, com fonte, o elo AdSourceAd. */
  async merge(items: readonly LibraryAdDraft[], source: Pick<AdSource, 'id'> | null): Promise<MergeResult> {
    const byPage = new Map<string, { pageName: string; adIds: string[] }>();
    if (!items.length) return { adIds: [], created: 0, active: 0, byPage };
    const unique = [...new Map(items.map((d) => [d.adArchiveId, d])).values()];
    const existing = new Map(
      (await this.prisma.libraryAd.findMany({ where: { adArchiveId: { in: unique.map((d) => d.adArchiveId) } }, select: { id: true, adArchiveId: true, isActive: true } }))
        .map((a) => [a.adArchiveId, a]),
    );
    const now = new Date();
    const adIds: string[] = [];
    let created = 0;
    for (const d of unique) {
      const data = this.adData(d);
      const prev = existing.get(d.adArchiveId);
      const stoppedAt = d.isActive ? null : prev && !prev.isActive ? undefined : dateOrNull(d.endDate) ?? today();
      // upsert nativo (ON CONFLICT): sondas paralelas da descoberta trazem o mesmo anúncio ao mesmo tempo
      const row = await this.prisma.libraryAd.upsert({
        where: { adArchiveId: d.adArchiveId },
        create: { adArchiveId: d.adArchiveId, ...data, stoppedAt: stoppedAt ?? null, firstSeenAt: now, lastSeenAt: now },
        update: { ...data, lastSeenAt: now, ...(stoppedAt !== undefined && { stoppedAt }) },
      });
      if (!prev) created++;
      adIds.push(row.id);
      if (d.pageId) {
        const g = byPage.get(d.pageId) ?? { pageName: d.pageName, adIds: [] };
        g.adIds.push(row.id);
        byPage.set(d.pageId, g);
      }
    }
    if (source) {
      await this.prisma.adSourceAd.createMany({ data: adIds.map((adId) => ({ sourceId: source.id, adId })), skipDuplicates: true });
      await this.prisma.adSourceAd.updateMany({ where: { sourceId: source.id, adId: { in: adIds } }, data: { lastSeenAt: now } });
    }
    return { adIds, created, active: unique.filter((d) => d.isActive).length, byPage };
  }

  private adData(d: LibraryAdDraft): Omit<Prisma.LibraryAdUncheckedCreateInput, 'adArchiveId'> {
    return {
      pageId: d.pageId, pageName: (d.pageName || d.pageId || 'Unknown').slice(0, 300), format: d.format, hasVideo: d.hasVideo,
      primaryText: d.primaryText, headline: d.headline, ctaText: d.ctaText, linkUrl: d.linkUrl, linkHost: d.linkHost,
      cards: (d.cards?.length ? d.cards : Prisma.JsonNull) as Prisma.InputJsonValue, platforms: d.platforms,
      startDate: dateOrNull(d.startDate), endDate: dateOrNull(d.endDate), isActive: d.isActive,
      collationCount: d.collationCount, euReach: d.euReach, lowImpressions: d.lowImpressions, language: d.language,
      ...(d.videoUrl && { videoSourceUrl: d.videoUrl }),
      ...((d.videoUrl || d.posterUrl) && { mediaExpiresAt: d.mediaExpiresAt ? new Date(d.mediaExpiresAt) : null }),
      width: d.width, height: d.height, durationSec: d.durationSec,
    };
  }

  // ───────── mídia remota → storage ─────────

  /** Poster de cada anúncio sem `posterKey` (best effort; falhou = tenta na próxima coleta). */
  async copyPosters(items: readonly LibraryAdDraft[]): Promise<void> {
    const want = items.filter((d) => d.posterUrl);
    if (!want.length) return;
    const missing = new Set(
      (await this.prisma.libraryAd.findMany({ where: { adArchiveId: { in: want.map((d) => d.adArchiveId) }, posterKey: null }, select: { adArchiveId: true } })).map((a) => a.adArchiveId),
    );
    for (const d of want) {
      if (!missing.has(d.adArchiveId)) continue;
      const key = posterKeyOf(d.adArchiveId);
      if (await this.copyRemote(d.posterUrl!, key, 'image/jpeg', 10 * 1024 * 1024)) {
        await this.prisma.libraryAd.updateMany({ where: { adArchiveId: d.adArchiveId }, data: { posterKey: key } });
      }
    }
  }

  private readonly copying = new Map<string, Promise<boolean>>();

  /** Baixa uma URL pública e sobe na chave dada. false = falhou (nunca lança). 1 cópia por chave por vez (sondas paralelas
   *  trazem o mesmo poster; duas leituras da mesma URL ao mesmo tempo só gastam banda). */
  copyRemote(url: string, key: string, fallbackMime: string, maxBytes: number, timeoutMs = POSTER_TIMEOUT_MS): Promise<boolean> {
    const cur = this.copying.get(key);
    if (cur) return cur;
    const run = this.doCopy(url, key, fallbackMime, maxBytes, timeoutMs).finally(() => this.copying.delete(key));
    this.copying.set(key, run);
    return run;
  }

  private async doCopy(url: string, key: string, fallbackMime: string, maxBytes: number, timeoutMs: number): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      // corpo não lido + servidor fechando o socket = asserção interna do undici (Node 24): sempre consumir ou cancelar
      const drop = async () => { await res.body?.cancel().catch(() => undefined); return false; };
      if (!res.ok || !res.body) {
        if (process.env.RADAR_DEBUG) this.log.warn(`cópia ${key}: HTTP ${res.status} ${url}`);
        return drop();
      }
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len && len > maxBytes) return drop();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > maxBytes) return false;
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim() || fallbackMime;
      await this.storage.putStream(key, Readable.from(buf), type);
      return true;
    } catch (e) {
      this.log.warn(`cópia de mídia falhou (${key}): ${(e as Error).message}`);
      return false;
    }
  }

  // ───────── tique: fila, semanal, faxina ─────────

  @Interval('research-tick', 60_000)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.BOOT_RECOVERY === 'off') return; // int specs dividem o banco
    if (this.ticking || this.cfg.mode === 'off') return;
    this.ticking = true;
    try {
      await this.drain();
      if (this.discoveryTick) await this.discoveryTick().catch((e) => this.log.warn(`fila de descobertas: ${(e as Error).message}`));
      if (this.cfg.cronEnabled) await this.scheduleWeekly();
      const day = new Date().toISOString().slice(0, 10);
      if (this.housekeeping && day !== this.lastHousekeepingDay) {
        this.lastHousekeepingDay = day;
        await this.housekeeping().catch((e) => this.log.warn(`faxina: ${(e as Error).message}`));
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Coletas vencidas da fila (notBefore ≤ agora; QUEUED esquecida > 2 min) e RUNNING presa (reinício) = FAILED INTERRUPTED. */
  async drain(): Promise<void> {
    const now = new Date();
    const stale = new Date(now.getTime() - (this.cfg.syncTimeoutMs * 2 + 60_000));
    const stuck = await this.prisma.researchSync.findMany({ where: { status: 'RUNNING', startedAt: { lt: stale } }, select: { id: true, targetAdId: true } });
    for (const s of stuck) {
      await this.prisma.researchSync.update({ where: { id: s.id }, data: { status: 'FAILED', errorCode: 'INTERRUPTED', failReason: failReasonFor('INTERRUPTED'), finishedAt: now } });
      if (s.targetAdId) this.bus.emit(RESEARCH_MEDIA_SYNCED, { syncId: s.id, targetAdId: s.targetAdId, ok: false, errorCode: 'INTERRUPTED' } satisfies MediaSyncedEvent);
    }
    const due = await this.prisma.researchSync.findMany({
      where: { status: 'QUEUED', kind: 'PAGE', OR: [{ notBefore: { lte: now } }, { notBefore: null, createdAt: { lt: new Date(now.getTime() - 120_000) } }] },
      orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, requestedLimit: true, trigger: true },
    });
    for (const s of due) {
      // ainda sem espaço no global: empurra pro dia seguinte de novo (não falha)
      if (s.trigger !== 'MANUAL' && s.trigger !== 'MEDIA' && !(await this.caps.globalFits(this.cfg.scrapeEstimateUsd(s.requestedLimit)))) {
        await this.prisma.researchSync.update({ where: { id: s.id }, data: { notBefore: nextDayUtc() } });
        continue;
      }
      await this.run(s.id);
    }
  }

  /** Semanal (§3): fontes ACTIVE com nextSyncAt vencido, ≤ 20 por tique, 30 s entre elas, limite adaptativo. */
  async scheduleWeekly(): Promise<void> {
    const sources = await this.prisma.adSource.findMany({
      where: { status: 'ACTIVE', competitors: { some: { status: 'ACTIVE' } }, OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: new Date() } }] },
      orderBy: { nextSyncAt: 'asc' }, take: 20,
    });
    for (const [n, src] of sources.entries()) {
      if (await this.openSync(src.id)) continue;
      const limit = this.cfg.adaptiveLimit(await this.sourceAccess(src.id), src.lastActiveCount);
      const s = await this.enqueuePage({ source: src, trigger: 'SCHEDULED', limit, run: false });
      await this.prisma.adSource.update({ where: { id: src.id }, data: { nextSyncAt: new Date(Date.now() + 7 * DAY_MS) } });
      if (s.notBefore) continue;
      await this.run(s.id);
      if (n < sources.length - 1) await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
