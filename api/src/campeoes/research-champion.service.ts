// ads-research-v1 §6.1: "Usar em template" com um anúncio do Ad Radar (`researchAdId` em fits/use/iterate). 1 campeão por
// workspace × anúncio (@@unique; arquivado = desarquiva e reaproveita; o 2º uso reaproveita a análise). rights THIRD_PARTY
// (R1: só registro, nada trava), adLibraryUrl/adArchiveId/adMeta da LibraryAd (sources = AD_LIBRARY).
// Vídeo: nasce RESOLVING; guardado ou URL válida = baixa já (segundo plano); vencida = coleta MEDIA da fonte e espera.
// Pronto → RESOLVED (ANALYZING) + CHAMPION_ANALYZE; o lote em ANALYZING avança quando o campeão termina (varredura do iteracao).
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import type { AdLibraryMeta } from '@maquina/contratos';
import { Prisma, type Champion, type LibraryAd } from '@prisma/client';
import { IngestError, StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchAdsService } from '../research/ads.service';
import { RESEARCH_VIDEO_READY, ResearchMediaService, type VideoReadyEvent } from '../research/media.service';
import { adLibraryAdUrl, daysBetween } from '../research/regras';
import { videoState } from '../research/research.views';
import { ResearchSyncService } from '../research/sync.service';
import { AnaliseService } from './analise.service';
import { ChampionStateMachine } from './champion-state-machine';
import { editMapOf, sectionsOf } from './champion-views';

export type ResearchChampionMode = 'reuse' | 'wait' | 'analyze';
export interface ResearchChampionSource {
  champion: Champion;
  isNew: boolean;
  newData: Prisma.ChampionUncheckedCreateInput | null;
  mode: ResearchChampionMode;
  offerLanguage: string;
  /** chamar DEPOIS do commit do lote: dispara a resolução do vídeo (download / coleta MEDIA já enfileirada) */
  afterCommit: ((championId: string) => void) | null;
}

const SWEEP_MS = 60_000;
/** Evento: o campeão terminou (READY ou FAILED) fora do fluxo do lote (Ad Radar); o IteracaoService avança os lotes dele. */
export const CHAMPION_SETTLED = 'champion.settled';
export interface ChampionSettledEvent { championId: string }
const STALE_MS = 3 * 60_000;

/** AdLibraryMeta do contrato a partir da LibraryAd (campeão por link antigo usa o mesmo formato). */
export function adMetaOf(ad: LibraryAd, now = new Date()): AdLibraryMeta {
  const end = ad.isActive ? now : ad.stoppedAt ?? ad.endDate ?? now;
  return {
    status: 'resolved', adArchiveId: ad.adArchiveId, pageName: ad.pageName, startDate: ad.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: ad.endDate?.toISOString().slice(0, 10) ?? null, isActive: ad.isActive, daysRunning: ad.startDate ? daysBetween(ad.startDate, end) : null,
    collationCount: ad.collationCount, euReach: ad.euReach, primaryText: ad.primaryText, headline: ad.headline, ctaText: ad.ctaText, linkUrl: ad.linkUrl,
    fetchedAt: now.toISOString(),
  };
}

@Injectable()
export class ResearchChampionService {
  private readonly log = new Logger('ResearchChampion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly sm: ChampionStateMachine,
    private readonly analise: AnaliseService,
    private readonly ads: ResearchAdsService,
    private readonly media: ResearchMediaService,
    private readonly sync: ResearchSyncService,
    private readonly bus: EventEmitter2,
  ) {}

  /** Campeão do workspace pra esse anúncio, se já existe (fits: sem criar nada). */
  findExisting(workspaceId: string, researchAdId: string) {
    return this.prisma.champion.findUnique({ where: { workspaceId_researchAdId: { workspaceId, researchAdId } }, include: { teardown: { select: { sections: true } } } });
  }

  /**
   * POST /iterate|/ad-templates/use { researchAdId }: anúncio visível (404), com vídeo (409 ad_has_no_video), oferta (422
   * OFFER_REQUIRED), vídeo vencido = teto da pesquisa (409 scope research) / global (503). Não grava nada além da coleta MEDIA
   * enfileirada (parada); o campeão novo nasce na transação do lote (newData).
   */
  async prepare(auth: AuthContext, researchAdId: string, offerId?: string): Promise<ResearchChampionSource> {
    const ad = await this.ads.loadVisible(auth.workspaceId, researchAdId);
    if (!ad.hasVideo) throw new AppException('INVALID_STATE', { state: ad.format, allowed: ['VIDEO'], reason: 'ad_has_no_video' });
    const offers = await this.prisma.offer.findMany({ where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
    const offer = offerId ? offers.find((o) => o.id === offerId) : offers.length === 1 ? offers[0] : undefined;
    if (offerId && !offer) throw new AppException('NOT_FOUND');
    if (!offer) throw new AppException('OFFER_REQUIRED', { offers: offers.map((o) => ({ id: o.id, name: o.name })) });

    const existing = await this.prisma.champion.findUnique({ where: { workspaceId_researchAdId: { workspaceId: auth.workspaceId, researchAdId } }, include: { teardown: true } });
    if (existing) {
      if (existing.archivedAt) await this.prisma.champion.update({ where: { id: existing.id }, data: { archivedAt: null } });
      const { teardown, ...champion } = existing;
      const ready = existing.status === 'READY' && !!sectionsOf(teardown?.sections) && !!editMapOf(teardown?.editMap);
      if (ready) return { champion: { ...champion, archivedAt: null }, isNew: false, newData: null, mode: 'reuse', offerLanguage: offer.language, afterCommit: null };
      if (existing.status === 'ANALYZING' || existing.status === 'RESOLVING') return { champion: champion as Champion, isNew: false, newData: null, mode: 'wait', offerLanguage: offer.language, afterCommit: null };
      if (existing.videoFileId) return { champion: champion as Champion, isNew: false, newData: null, mode: 'analyze', offerLanguage: offer.language, afterCommit: null };
      // FAILED sem vídeo: volta a RESOLVING e busca o vídeo de novo (IMPORT_AGAIN, fora da transação do lote)
      const plan = await this.media.ensureVideo(auth.workspaceId, auth.userId, ad, { run: false });
      await this.sm.transition({ championId: existing.id, event: 'IMPORT_AGAIN', from: 'FAILED', to: 'RESOLVING', data: { errorCode: null, failReason: null } });
      return { champion: { ...(champion as Champion), status: 'RESOLVING' }, isNew: false, newData: null, mode: 'wait', offerLanguage: offer.language, afterCommit: (id) => this.startResolve(id, plan.syncId) };
    }
    const plan = await this.media.ensureVideo(auth.workspaceId, auth.userId, ad, { run: false });
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: offer.id, name: (ad.headline?.trim() || ad.pageName).slice(0, 120) || `Ad ${ad.adArchiveId}`, status: 'RESOLVING',
      rights: 'THIRD_PARTY', adLibraryUrl: adLibraryAdUrl(ad.adArchiveId), adArchiveId: ad.adArchiveId,
      adMeta: adMetaOf(ad) as unknown as Prisma.InputJsonValue, researchAdId: ad.id, createdById: auth.userId,
    };
    return {
      champion: { ...newData, id: '', language: null, durationSec: null, videoFileId: null } as unknown as Champion,
      isNew: true, newData, mode: 'wait', offerLanguage: offer.language, afterCommit: (id) => this.startResolve(id, plan.syncId),
    };
  }

  /** Retry do lote com o campeão FAILED sem vídeo: confere teto/fonte, volta a RESOLVING e devolve o disparo (pós-commit). */
  async retryVideo(auth: AuthContext, c: Champion): Promise<() => void> {
    const ad = await this.prisma.libraryAd.findUnique({ where: { id: c.researchAdId! } });
    if (!ad) throw new AppException('INVALID_STATE', { state: c.status, allowed: ['READY'], reason: 'upload_another' });
    const plan = await this.media.ensureVideo(auth.workspaceId, auth.userId, ad, { run: false });
    await this.sm.transition({ championId: c.id, event: 'IMPORT_AGAIN', from: 'FAILED', to: 'RESOLVING', data: { errorCode: null, failReason: null } });
    return () => this.startResolve(c.id, plan.syncId);
  }

  /** Depois do commit: coleta MEDIA enfileirada = roda (o fim acorda o campeão); senão baixa o vídeo já. */
  startResolve(championId: string, mediaSyncId: string | null): void {
    if (mediaSyncId) {
      this.sync.kick(mediaSyncId);
      return;
    }
    void this.jobs.detach(null, `vídeo do campeão ${championId} (Ad Radar)`, () => this.resolve(championId));
  }

  /** O vídeo do anúncio está (ou não vai estar) no storage: acorda os campeões RESOLVING desse anúncio. */
  @OnEvent(RESEARCH_VIDEO_READY, { async: true })
  async onVideoReady(e: VideoReadyEvent): Promise<void> {
    const waiting = await this.prisma.champion.findMany({ where: { researchAdId: e.adId, status: 'RESOLVING' }, select: { id: true } });
    for (const c of waiting) {
      if (e.ok) await this.resolve(c.id);
      else await this.fail(c.id, e.errorCode === 'AD_LIBRARY_UNAVAILABLE' ? 'AD_LIBRARY_UNAVAILABLE' : 'AD_NOT_FOUND');
    }
  }

  /** RESOLVING → ANALYZING (vídeo no File do workspace + miniatura) → análise. Nunca lança. */
  async resolve(championId: string): Promise<void> {
    try {
      const c = await this.prisma.champion.findUnique({ where: { id: championId } });
      if (!c || c.status !== 'RESOLVING' || !c.researchAdId) return;
      let ad = await this.prisma.libraryAd.findUnique({ where: { id: c.researchAdId } });
      if (!ad) return this.fail(championId, 'AD_NOT_FOUND');
      if (!ad.videoKey && videoState(ad) === 'remote') {
        await this.media.storeNow(ad);
        ad = (await this.prisma.libraryAd.findUnique({ where: { id: ad.id } }))!;
      }
      const url = ad.videoKey ? null : videoState(ad) === 'remote' ? ad.videoSourceUrl : null;
      if (!ad.videoKey && !url) {
        // vencida e sem coleta aberta: pede a MEDIA (sem checar teto de novo: já conferido no pedido)
        if (!(await this.media.refreshing(ad.id))) await this.media.ensureVideo(c.workspaceId, c.createdById, ad).catch(() => this.fail(championId, 'AD_LIBRARY_UNAVAILABLE'));
        return;
      }
      let file: { id: string; durationSec: Prisma.Decimal | null; width: number | null; height: number | null };
      let thumbnail: { id: string };
      try {
        ({ file, thumbnail } = ad.videoKey
          ? await this.storage.ingestVideoWithThumbnailFromKey(ad.videoKey, { workspaceId: c.workspaceId, kind: 'CHAMPION_VIDEO' })
          : await this.storage.ingestVideoWithThumbnail(url!, { workspaceId: c.workspaceId, kind: 'CHAMPION_VIDEO' }));
      } catch (e) {
        return this.fail(championId, e instanceof IngestError ? 'MEDIA_INVALID' : 'AD_NOT_FOUND');
      }
      const d = num(file.durationSec) ?? 0;
      if (d < this.config.championMinSec || d > this.config.championMaxSec || Math.min(file.width ?? 0, file.height ?? 0) < 240) return this.fail(championId, 'MEDIA_INVALID');
      const job = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, championId, event: 'RESOLVED', from: 'RESOLVING', to: 'ANALYZING', data: { videoFileId: file.id, thumbnailFileId: thumbnail.id, durationSec: d, errorCode: null, failReason: null } });
        return tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId }, championId, offerId: c.offerId, createdById: c.createdById } });
      });
      await this.analise.runAnalyze(job.id, championId);
      await this.advance(championId);
    } catch (e) {
      this.log.error(`campeão ${championId}: ${(e as Error)?.stack ?? e}`);
      await this.fail(championId, 'PROVIDER_ERROR');
    }
  }

  private async fail(championId: string, code: 'AD_NOT_FOUND' | 'MEDIA_INVALID' | 'AD_LIBRARY_UNAVAILABLE' | 'PROVIDER_ERROR'): Promise<void> {
    await this.sm.transition({ championId, event: 'RESOLVE_FAILED', from: 'RESOLVING', to: 'FAILED', data: { errorCode: code, failReason: failReasonFor(code) } }).catch(() => undefined);
    await this.advance(championId);
  }

  /** Lote AUTO em ANALYZING desse campeão avança (o IteracaoService ouve; também varre, mas aqui não espera a varredura). */
  private async advance(championId: string): Promise<void> {
    this.bus.emit(CHAMPION_SETTLED, { championId } satisfies ChampionSettledEvent);
  }

  /** Varredura: RESOLVING do Ad Radar parado (reinício no meio) sem coleta MEDIA aberta = tenta de novo. */
  @Interval('research-champion-sweep', SWEEP_MS)
  async sweep(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.BOOT_RECOVERY === 'off') return;
    const stale = await this.prisma.champion.findMany({
      where: { status: 'RESOLVING', researchAdId: { not: null }, updatedAt: { lt: new Date(Date.now() - STALE_MS) } }, select: { id: true, researchAdId: true }, take: 20,
    }).catch(() => []);
    for (const c of stale) {
      if (await this.media.refreshing(c.researchAdId!)) continue;
      await this.resolve(c.id);
    }
  }
}
