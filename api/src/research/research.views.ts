// ads-research-v1 §5/§7 + C.6/C.7: montagem das views do contrato (contratos/src/research.ts). Mídia global fora de File:
// chave `research/...` assinada na leitura, ou a URL do fbcdn enquanto vale (~4,4 dias; vídeo só com 10 min de folga).
import { Injectable } from '@nestjs/common';
import type {
  AccountAccess, Competitor as CompetitorView, CompetitorDiscoveryView, DiscoveryStage, LibraryAdPlatform, ResearchAdCard, ResearchAdDetail, ResearchAdMedia,
  ResearchMediaUrl, ResearchSyncRef,
} from '@maquina/contratos';
import type { AdSource, Competitor, LibraryAd, Prisma, ResearchSync } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { num } from '../common/util/format';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService } from './caps.service';
import { DAY_MS, adLibraryAdUrl, adLibraryPageUrl, tierOf } from './regras';
import { ResearchConfig } from './research.config';

const VIDEO_MARGIN_MS = 10 * 60_000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type CardJson = { headline?: string | null; body?: string | null; linkUrl?: string | null; mediaKind?: 'VIDEO' | 'IMAGE' | null; posterUrl?: string | null; videoUrl?: string | null };
export const cardsOf = (v: Prisma.JsonValue | null): CardJson[] => (Array.isArray(v) ? (v as CardJson[]).filter((c) => c && typeof c === 'object') : []);

/** Onde está o vídeo do anúncio agora (pra usar/salvar/mostrar). */
export function videoState(ad: Pick<LibraryAd, 'hasVideo' | 'videoKey' | 'videoSourceUrl' | 'mediaExpiresAt'>, now = Date.now()): 'stored' | 'remote' | 'expired' | 'none' {
  if (!ad.hasVideo) return 'none';
  if (ad.videoKey) return 'stored';
  if (ad.videoSourceUrl && (!ad.mediaExpiresAt || ad.mediaExpiresAt.getTime() > now + VIDEO_MARGIN_MS)) return 'remote';
  return 'expired';
}

@Injectable()
export class ResearchViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
  ) {}

  private async signed(key: string | null, mimeType: string): Promise<ResearchMediaUrl | null> {
    return key ? { url: await this.storage.signedUrlForKey(key), mimeType } : null;
  }

  private tierRules() {
    return { winnerDays: this.cfg.winnerDays, winnerVersions: this.cfg.winnerVersions, newDays: this.cfg.newDays };
  }

  /** where do selo "provável vencedor" (C.6) pra contagens/filtros no banco. */
  winnerWhere(now = new Date()): Prisma.LibraryAdWhereInput {
    return { isActive: true, OR: [{ startDate: { lte: new Date(now.getTime() - this.cfg.winnerDays * DAY_MS) } }, { collationCount: { gte: this.cfg.winnerVersions } }] };
  }

  // ───────── concorrentes ─────────

  syncRef(s: ResearchSync | null): ResearchSyncRef | null {
    return s ? {
      id: s.id, trigger: s.trigger, status: s.status, adsActive: s.adsActive, adsNew: s.adsNew, adsStopped: s.adsStopped,
      errorCode: s.errorCode, failReason: s.failReason, startedAt: iso(s.startedAt), finishedAt: iso(s.finishedAt),
    } : null;
  }

  /** "Atualizar agora": última MANUAL deste workspace nesta fonte + janela do plano (null = já pode / sem janela). */
  async refreshAvailableAt(workspaceId: string, sourceId: string, access: AccountAccess): Promise<Date | null> {
    const hours = this.cfg.refreshHours(access);
    if (hours == null) return null;
    const last = await this.prisma.researchSync.findFirst({
      where: { sourceId, trigger: 'MANUAL', requestedByWorkspaceId: workspaceId, status: { not: 'FAILED' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (!last) return null;
    const at = new Date(last.createdAt.getTime() + hours * 3_600_000);
    return at.getTime() > Date.now() ? at : null;
  }

  async competitor(workspaceId: string, c: Competitor): Promise<CompetitorView> {
    return (await this.competitors(workspaceId, [c]))[0];
  }

  async competitors(workspaceId: string, rows: Competitor[]): Promise<CompetitorView[]> {
    if (!rows.length) return [];
    const access = await this.caps.access(workspaceId);
    const { monthUsd, capUsd } = await this.caps.spend(workspaceId, access);
    const now = new Date();
    const sources = new Map((await this.prisma.adSource.findMany({ where: { id: { in: rows.map((r) => r.sourceId) } } })).map((s) => [s.id, s]));
    const out: CompetitorView[] = [];
    for (const c of rows) {
      const src = sources.get(c.sourceId)!;
      const inSource: Prisma.LibraryAdWhereInput = { sources: { some: { sourceId: src.id } } };
      const [active, winners, new7d, stopped30d, lastSync, lastDone] = await Promise.all([
        this.prisma.libraryAd.count({ where: { ...inSource, isActive: true } }),
        this.prisma.libraryAd.count({ where: { ...inSource, ...this.winnerWhere(now) } }),
        this.prisma.libraryAd.count({ where: { ...inSource, isActive: true, startDate: { gte: new Date(now.getTime() - this.cfg.newDays * DAY_MS) } } }),
        this.prisma.libraryAd.count({ where: { ...inSource, isActive: false, stoppedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
        this.prisma.researchSync.findFirst({ where: { sourceId: src.id, kind: 'PAGE' }, orderBy: { createdAt: 'desc' } }),
        this.prisma.researchSync.findFirst({ where: { sourceId: src.id, kind: 'PAGE', status: { in: ['SUCCEEDED', 'SUSPECT'] } }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
      ]);
      const refreshAt = c.status === 'ACTIVE' ? await this.refreshAvailableAt(workspaceId, src.id, access) : null;
      out.push({
        id: c.id, name: c.name, status: c.status, origin: c.origin, relation: c.relation, nicheScore: c.nicheScore, reason: c.reason,
        source: this.sourceView(src, await this.signed(src.avatarKey, 'image/jpeg')),
        domain: c.domain,
        counts: { active, winners, new7d, stopped30d },
        activeIsLowerBound: !src.lastValidSyncAt,
        sync: this.syncRef(lastSync),
        lastValidSyncAt: iso(src.lastValidSyncAt),
        nextSyncAt: this.cfg.cronEnabled && access !== 'SAMPLE' ? iso(src.nextSyncAt) : null,
        refreshAvailableAt: iso(refreshAt),
        lastSyncSuspect: lastDone?.status === 'SUSPECT',
        autoSyncPausedByCap: monthUsd >= capUsd,
        dismissedAt: iso(c.dismissedAt), dismissReason: c.dismissReason,
        createdAt: c.createdAt.toISOString(),
      });
    }
    return out;
  }

  private sourceView(s: AdSource, avatar: ResearchMediaUrl | null): CompetitorView['source'] {
    return { pageId: s.pageId, countryCode: s.countryCode, displayName: s.displayName, avatar, likeCount: s.likeCount, adLibraryUrl: adLibraryPageUrl(s.pageId, s.countryCode) };
  }

  // ───────── anúncios ─────────

  async media(ad: LibraryAd, refreshing: boolean): Promise<ResearchAdMedia> {
    const now = Date.now();
    const remoteOk = !ad.mediaExpiresAt || ad.mediaExpiresAt.getTime() > now;
    const firstCardPoster = cardsOf(ad.cards).find((c) => c.posterUrl)?.posterUrl ?? null;
    const poster = ad.posterKey ? await this.signed(ad.posterKey, 'image/jpeg') : firstCardPoster && remoteOk ? { url: firstCardPoster, mimeType: 'image/jpeg' } : null;
    const state = videoState(ad, now);
    const dims = { ...(ad.width && { width: ad.width }), ...(ad.height && { height: ad.height }) };
    const video = state === 'stored' ? { ...(await this.signed(ad.videoKey, 'video/mp4'))!, ...dims }
      : state === 'remote' ? { url: ad.videoSourceUrl!, mimeType: 'video/mp4', ...dims } : null;
    const status: ResearchAdMedia['status'] = refreshing && state !== 'stored' ? 'refreshing' : state;
    return { playable: !!video, status, poster, video, durationSec: num(ad.durationSec), expiresAt: state === 'remote' ? iso(ad.mediaExpiresAt) : null };
  }

  /** Cards de uma página de anúncios do workspace (concorrentes, salvos, lotes e coleta MEDIA aberta em lote). */
  async cards(workspaceId: string, ads: LibraryAd[]): Promise<ResearchAdCard[]> {
    if (!ads.length) return [];
    const ids = ads.map((a) => a.id);
    const [links, saved, champions, refreshing] = await Promise.all([
      this.prisma.adSourceAd.findMany({ where: { adId: { in: ids } }, include: { source: { select: { id: true, pageId: true, countryCode: true, avatarKey: true, competitors: { where: { workspaceId, status: 'ACTIVE' }, select: { id: true, name: true } } } } } }),
      this.prisma.savedAd.findMany({ where: { workspaceId, adId: { in: ids } }, select: { adId: true } }),
      this.prisma.champion.findMany({ where: { workspaceId, researchAdId: { in: ids } }, select: { researchAdId: true, _count: { select: { batches: true } } } }),
      this.prisma.researchSync.findMany({ where: { targetAdId: { in: ids }, status: { in: ['QUEUED', 'RUNNING'] } }, select: { targetAdId: true } }),
    ]);
    const savedSet = new Set(saved.map((s) => s.adId));
    const used = new Map(champions.map((c) => [c.researchAdId!, c._count.batches]));
    const refreshSet = new Set(refreshing.map((r) => r.targetAdId!));
    const avatars = new Map<string, ResearchMediaUrl | null>();
    const out: ResearchAdCard[] = [];
    for (const ad of ads) {
      const mine = links.filter((l) => l.adId === ad.id);
      const competitors = mine.flatMap((l) => l.source.competitors);
      const src = mine.find((l) => l.source.competitors.length)?.source ?? mine[0]?.source ?? null;
      let avatar: ResearchMediaUrl | null = null;
      if (src?.avatarKey) {
        if (!avatars.has(src.avatarKey)) avatars.set(src.avatarKey, await this.signed(src.avatarKey, 'image/jpeg'));
        avatar = avatars.get(src.avatarKey) ?? null;
      }
      const t = tierOf(ad, this.tierRules());
      const media = await this.media(ad, refreshSet.has(ad.id));
      out.push({
        id: ad.id, adArchiveId: ad.adArchiveId, adLibraryUrl: adLibraryAdUrl(ad.adArchiveId),
        page: { id: ad.pageId, name: ad.pageName, avatar },
        competitors: [...new Map(competitors.map((c) => [c.id, c])).values()],
        format: ad.format, hasVideo: ad.hasVideo, media,
        primaryText: ad.primaryText, headline: ad.headline, ctaText: ad.ctaText, linkUrl: ad.linkUrl, linkHost: ad.linkHost,
        platforms: ad.platforms as LibraryAdPlatform[], language: ad.language, countryCode: src?.countryCode ?? null,
        startDate: isoDay(ad.startDate), stoppedAt: isoDay(ad.stoppedAt), isActive: ad.isActive,
        daysRunning: t.daysRunning, tier: t.tier, killedFast: t.killedFast,
        collationCount: ad.collationCount, euReach: ad.euReach, lowImpressions: ad.lowImpressions,
        saved: savedSet.has(ad.id), usedInBatches: used.get(ad.id) ?? 0,
        usable: ad.hasVideo,
      });
    }
    return out;
  }

  async detail(workspaceId: string, ad: LibraryAd): Promise<ResearchAdDetail> {
    const [card] = await this.cards(workspaceId, [ad]);
    const [save, champion] = await Promise.all([
      this.prisma.savedAd.findUnique({ where: { workspaceId_adId: { workspaceId, adId: ad.id } }, select: { note: true } }),
      this.prisma.champion.findUnique({ where: { workspaceId_researchAdId: { workspaceId, researchAdId: ad.id } }, select: { id: true, archivedAt: true } }),
    ]);
    const remoteOk = !ad.mediaExpiresAt || ad.mediaExpiresAt.getTime() > Date.now();
    return {
      ...card,
      cards: cardsOf(ad.cards).map((c) => ({
        headline: c.headline ?? null, body: c.body ?? null, linkUrl: c.linkUrl ?? null, mediaKind: c.mediaKind ?? null,
        poster: c.posterUrl && remoteOk ? { url: c.posterUrl, mimeType: 'image/jpeg' } : null,
      })),
      firstSeenAt: ad.firstSeenAt.toISOString(), lastSeenAt: ad.lastSeenAt.toISOString(),
      savedNote: save?.note ?? null,
      championId: champion && !champion.archivedAt ? champion.id : null,
    };
  }

  // ───────── descoberta ─────────

  async discovery(workspaceId: string, access: AccountAccess, manualAvailableAt: Date | null): Promise<CompetitorDiscoveryView> {
    const now = new Date();
    const pending = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, trigger: 'BRAIN_CHANGED', status: 'QUEUED', notBefore: { gt: now } }, orderBy: { createdAt: 'desc' } });
    const d = await this.prisma.competitorDiscovery.findFirst({
      where: { workspaceId, ...(pending && { id: { not: pending.id } }) }, orderBy: { createdAt: 'desc' },
      include: { candidates: { include: { term: { select: { term: true } } }, orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] }, terms: { orderBy: { createdAt: 'asc' } } },
    });
    const staff = access === 'INTERNAL';
    const sample = access === 'SAMPLE';
    return {
      last: d ? {
        id: d.id, trigger: d.trigger, status: d.status, stage: d.status === 'RUNNING' ? ((d.stage as DiscoveryStage | null) ?? 'propose') : null,
        countryCode: d.countryCode, keywords: d.keywords, candidatesFound: d.candidatesFound, followed: d.followed, reserved: d.reserved,
        candidates: staff ? d.candidates.map((c) => ({
          pageId: c.pageId, pageName: c.pageName, brandName: c.brandName, domain: c.domain, origin: c.origin, status: c.status, relation: c.relation, rank: c.rank,
          activeAdsSeen: c.activeAdsSeen, oldestDays: c.oldestDays, nicheScore: c.nicheScore, suspectDisposable: c.suspectDisposable, term: c.term?.term ?? null, reason: c.reason,
        })) : [],
        terms: staff ? d.terms.map((t) => ({ term: t.term, kind: t.kind, origin: t.origin, outcome: t.outcome, pagesFound: t.pagesFound, pagesMultiAd: t.pagesMultiAd, approvedCount: t.approvedCount })) : [],
        costUsd: staff ? num(d.costUsd) : null,
        errorCode: d.errorCode, failReason: d.failReason, createdAt: d.createdAt.toISOString(), finishedAt: iso(d.finishedAt),
      } : null,
      manualAvailableAt: sample ? null : iso(manualAvailableAt),
      manualAllowed: !sample,
      autoPendingAt: iso(pending?.notBefore),
      estimateUsd: this.cfg.discoveryEstimateUsd,
    };
  }
}
