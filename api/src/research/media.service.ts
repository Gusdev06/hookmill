// ads-research-v1 §6.1/§6.2/§6.3: vídeo do anúncio no NOSSO storage só ao salvar/usar (chave research/<adArchiveId>/video.mp4,
// global, fora de File). URL do fbcdn vencida = coleta MEDIA da fonte (conta no teto, não na janela do "Atualizar agora").
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { LibraryAd } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService } from './caps.service';
import { ResearchConfig } from './research.config';
import { videoState } from './research.views';
import { RESEARCH_MEDIA_SYNCED, ResearchSyncService, videoKeyOf, type MediaSyncedEvent } from './sync.service';

const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const VIDEO_TIMEOUT_MS = 180_000;

/** Evento: o vídeo do anúncio está no storage (ok) ou não vai vir (falhou). Quem espera (campeão RESOLVING) ouve. */
export const RESEARCH_VIDEO_READY = 'research.video.ready';
export interface VideoReadyEvent { adId: string; ok: boolean; errorCode: string | null }

@Injectable()
export class ResearchMediaService {
  private readonly log = new Logger('ResearchMedia');
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
    private readonly sync: ResearchSyncService,
    private readonly jobs: JobsService,
    private readonly bus: EventEmitter2,
  ) {}

  /** Baixa o vídeo remoto (URL válida) pro storage. true = `videoKey` gravado (ou já estava). Dedup por anúncio. */
  storeNow(ad: Pick<LibraryAd, 'id' | 'adArchiveId' | 'hasVideo' | 'videoKey' | 'videoSourceUrl' | 'mediaExpiresAt'>): Promise<boolean> {
    if (ad.videoKey) return Promise.resolve(true);
    if (videoState(ad) !== 'remote') return Promise.resolve(false);
    const cur = this.inFlight.get(ad.id);
    if (cur) return cur;
    const run = (async () => {
      const key = videoKeyOf(ad.adArchiveId);
      const ok = await this.sync.copyRemote(ad.videoSourceUrl!, key, 'video/mp4', VIDEO_MAX_BYTES, VIDEO_TIMEOUT_MS);
      if (ok) await this.prisma.libraryAd.update({ where: { id: ad.id }, data: { videoKey: key } });
      return ok;
    })().finally(() => this.inFlight.delete(ad.id));
    this.inFlight.set(ad.id, run);
    return run;
  }

  /** Salvar com URL válida: baixa em segundo plano (vencida: baixa quando alguém usar). */
  storeInBackground(ad: LibraryAd): void {
    if (videoState(ad) !== 'remote') return;
    void this.jobs.detach(null, `vídeo do anúncio ${ad.adArchiveId}`, () => this.storeNow(ad));
  }

  /** Coleta MEDIA aberta pra este anúncio? */
  async refreshing(adId: string): Promise<boolean> {
    return (await this.prisma.researchSync.count({ where: { targetAdId: adId, status: { in: ['QUEUED', 'RUNNING'] } } })) > 0;
  }

  /**
   * Garante que o vídeo vai chegar ao storage: guardado = nada; URL válida = baixa agora (segundo plano);
   * vencida = coleta MEDIA da fonte (teto do workspace 409 scope research; global 503). `run: false` = não roda ainda
   * (quem chama dispara depois do commit com `kick`). Devolve o que vai acontecer.
   */
  async ensureVideo(workspaceId: string, userId: string | null, ad: LibraryAd, opts: { run?: boolean } = {}): Promise<{ state: 'stored' | 'remote' | 'refreshing'; syncId: string | null }> {
    if (!ad.hasVideo) throw new AppException('INVALID_STATE', { state: ad.format, allowed: ['VIDEO'], reason: 'ad_has_no_video' });
    const st = videoState(ad);
    if (st === 'stored') return { state: 'stored', syncId: null };
    if (st === 'remote') return { state: 'remote', syncId: null };
    const open = await this.prisma.researchSync.findFirst({ where: { targetAdId: ad.id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (open) return { state: 'refreshing', syncId: open.id };
    if (this.cfg.mode === 'off') throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'not_configured', retryAfter: null });
    const link = await this.prisma.adSourceAd.findFirst({ where: { adId: ad.id }, orderBy: { lastSeenAt: 'desc' }, include: { source: true } });
    if (!link) throw new AppException('INVALID_STATE', { state: 'expired', allowed: ['stored', 'remote'], reason: 'no_media' });
    const access = await this.caps.access(workspaceId);
    const limit = this.cfg.adaptiveLimit(access, link.source.lastActiveCount);
    const estimate = this.cfg.scrapeEstimateUsd(limit);
    await this.caps.assertWorkspace(workspaceId, estimate, access);
    await this.caps.assertGlobal(estimate);
    const s = await this.sync.enqueuePage({ source: link.source, trigger: 'MEDIA', limit, workspaceId, userId, targetAdId: ad.id, run: opts.run ?? true });
    return { state: 'refreshing', syncId: s.id };
  }

  /** `POST /research/ads/:id/media`: 409 media_refreshing / no_media; guardado/válido = baixa (se faltar) e devolve. */
  async requestRefresh(auth: AuthContext, ad: LibraryAd): Promise<void> {
    if (!ad.hasVideo) throw new AppException('INVALID_STATE', { state: ad.format, allowed: ['VIDEO'], reason: 'no_media' });
    if (await this.refreshing(ad.id)) throw new AppException('INVALID_STATE', { state: 'refreshing', allowed: ['expired'], reason: 'media_refreshing' });
    const r = await this.ensureVideo(auth.workspaceId, auth.userId, ad);
    if (r.state === 'remote') this.storeInBackground(ad);
  }

  /** Fim da coleta MEDIA: o vídeo veio com URL nova → baixa pro storage e avisa quem espera. */
  @OnEvent(RESEARCH_MEDIA_SYNCED, { async: true })
  async onMediaSynced(e: MediaSyncedEvent): Promise<void> {
    try {
      const ad = await this.prisma.libraryAd.findUnique({ where: { id: e.targetAdId } });
      if (!ad) return;
      const ok = e.ok && (await this.storeNow(ad));
      this.emitReady(ad.id, ok, ok ? null : e.ok ? 'AD_NOT_FOUND' : e.errorCode ?? 'AD_NOT_FOUND');
    } catch (err) {
      this.log.warn(`mídia do anúncio ${e.targetAdId}: ${(err as Error).message}`);
      this.emitReady(e.targetAdId, false, 'PROVIDER_ERROR');
    }
  }

  emitReady(adId: string, ok: boolean, errorCode: string | null): void {
    this.bus.emit(RESEARCH_VIDEO_READY, { adId, ok, errorCode } satisfies VideoReadyEvent);
  }
}
