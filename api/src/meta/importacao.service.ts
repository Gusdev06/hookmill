// meta-v1.md §3.2 / D13: "Pick from Meta" = POST /iterate { metaAdId } (único caminho). Aqui vive a parte da Meta:
// achar o anúncio no snapshot, reaproveitar o campeão já importado, e o job META_IMPORT (fetching_video →
// downloading_video) que baixa o vídeo pelo `storage.ingestVideoWithThumbnail` e põe o Champion em ANALYZING.
// O lote em si (VariationBatch AUTO, análise, plano) continua no iteracao.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Champion, Prisma } from '@prisma/client';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { ChampionStateMachine } from '../campeoes/champion-state-machine';
import { editMapOf, sectionsOf } from '../campeoes/champion-views';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaService, isMetaError } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertUsable, markTokenInvalid, metaAuthOf } from './comum';

/** Como o lote deve começar com este campeão (mesmos modos do iteracao): import = baixar da Meta primeiro. */
export type ImportMode = 'import' | 'reuse' | 'analyze' | 'wait';

export interface ImportSource {
  champion: Champion;
  isNew: boolean;
  newData: Prisma.ChampionUncheckedCreateInput | null;
  mode: ImportMode;
  offerLanguage: string;
}

const STAGE_PROGRESS = { fetching_video: 15, downloading_video: 50 } as const;

class ImportError extends Error {
  constructor(readonly code: string, readonly reason: string) {
    super(code);
  }
}

@Injectable()
export class MetaImportService {
  private readonly log = new Logger('MetaImport');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly sm: ChampionStateMachine,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  /**
   * POST /iterate { metaAdId }: conexão utilizável (422), anúncio no snapshot (404), oferta (a do corpo ou a única
   * ativa; 422 OFFER_REQUIRED). Campeão do mesmo anúncio não arquivado = reaproveita (vídeo e análise); senão nasce
   * RESOLVING com rights OWN (D12), nome = nome do anúncio, metaAdId/metaAdAccountId gravados.
   */
  async prepare(auth: AuthContext, metaAdId: string, offerId?: string): Promise<ImportSource> {
    const conn = assertUsable(await this.prisma.metaConnection.findUnique({ where: { workspaceId: auth.workspaceId } }));
    const ad = await this.prisma.metaAdSnapshot.findFirst({ where: { workspaceId: auth.workspaceId, connectionId: conn.id, metaAdId } });
    if (!ad) throw new AppException('NOT_FOUND');
    // campanhas-v1 §4: o sync agora guarda imagem também; "Iterate this ad" só em vídeo
    if (!ad.videoId) throw new AppException('INVALID_STATE', { state: ad.effectiveStatus, allowed: ['VIDEO'], reason: 'not_a_video' });
    const offers = await this.prisma.offer.findMany({ where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
    const offer = offerId ? offers.find((o) => o.id === offerId) : offers.length === 1 ? offers[0] : undefined;
    if (offerId && !offer) throw new AppException('NOT_FOUND');
    if (!offer) throw new AppException('OFFER_REQUIRED', { offers: offers.map((o) => ({ id: o.id, name: o.name })) });

    const existing = await this.prisma.champion.findFirst({
      where: { workspaceId: auth.workspaceId, metaAdId, archivedAt: null }, include: { teardown: true }, orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const ready = existing.status === 'READY' && !!sectionsOf(existing.teardown?.sections) && !!editMapOf(existing.teardown?.editMap);
      const mode: ImportMode = ready ? 'reuse'
        : existing.status === 'ANALYZING' || existing.status === 'RESOLVING' ? 'wait'
          : existing.videoFileId ? 'analyze' : 'import'; // FAILED sem vídeo (download falhou) = baixa de novo
      const { teardown: _t, ...champion } = existing;
      return { champion: champion as Champion, isNew: false, newData: null, mode, offerLanguage: offer.language };
    }
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: offer.id, name: ad.name.trim().slice(0, 120) || `Meta ad ${metaAdId}`, status: 'RESOLVING',
      rights: 'OWN', rightsDeclaredById: auth.userId, rightsDeclaredAt: new Date(),
      metaAdId, metaAdAccountId: ad.adAccountId, createdById: auth.userId,
    };
    return { champion: { ...newData, id: '', language: null, durationSec: null, videoFileId: null } as unknown as Champion, isNew: true, newData, mode: 'import', offerLanguage: offer.language };
  }

  /** Job META_IMPORT pendurado no campeão (criado na mesma transação do lote). */
  newImportJob(tx: Prisma.TransactionClient, c: Pick<Champion, 'id' | 'workspaceId' | 'offerId' | 'metaAdId'>, userId: string) {
    return tx.job.create({
      data: { workspaceId: c.workspaceId, type: 'META_IMPORT', status: 'QUEUED', input: { championId: c.id, metaAdId: c.metaAdId }, championId: c.id, offerId: c.offerId, createdById: userId },
    });
  }

  /** Campeão FAILED sem vídeo volta a RESOLVING pra baixar de novo (retry do lote). */
  async importAgain(tx: Prisma.TransactionClient, c: Champion): Promise<void> {
    await this.sm.transition({ tx, championId: c.id, event: 'IMPORT_AGAIN', from: c.status, to: 'RESOLVING', data: { errorCode: null, failReason: null } });
  }

  /**
   * Roda o META_IMPORT: fetching_video (URL temporária pela porta) → downloading_video (ingest + miniatura) →
   * RESOLVED (ANALYZING) + job CHAMPION_ANALYZE, cujo id volta pra quem chamou rodar a análise. Falha = campeão FAILED
   * com META_VIDEO_UNAVAILABLE (action upload_video) ou MEDIA_INVALID; devolve null. Nunca lança.
   */
  async run(jobId: string, championId: string, createdById: string): Promise<string | null> {
    try {
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId } });
      if (!c.metaAdId) throw new ImportError('META_VIDEO_UNAVAILABLE', failReasonFor('META_VIDEO_UNAVAILABLE'));
      const conn = assertUsable(await this.prisma.metaConnection.findUnique({ where: { workspaceId: c.workspaceId } }));
      const ad = await this.prisma.metaAdSnapshot.findFirst({ where: { connectionId: conn.id, metaAdId: c.metaAdId } });
      if (!ad?.videoId) throw new ImportError('META_VIDEO_UNAVAILABLE', failReasonFor('META_VIDEO_UNAVAILABLE'));
      await this.jobs.stage(jobId, 'fetching_video', STAGE_PROGRESS.fetching_video);
      let source: { sourceUrl: string };
      try {
        source = await this.meta.videoSource(metaAuthOf(conn, this.config), ad.videoId, { adAccountId: conn.adAccountId, pageId: conn.pageId });
      } catch (e) {
        if (isMetaError(e)) {
          this.log.warn(`vídeo ${ad.videoId} do anúncio ${c.metaAdId} indisponível: ${e.failDetail ?? e.code}`);
          if (e.code === 'META_TOKEN_INVALID') await markTokenInvalid(this.prisma, conn.id);
          throw new ImportError(e.code === 'META_VIDEO_UNAVAILABLE' || e.code === 'META_TOKEN_INVALID' ? e.code : 'META_VIDEO_UNAVAILABLE', e.message);
        }
        throw e;
      }
      await this.jobs.stage(jobId, 'downloading_video', STAGE_PROGRESS.downloading_video);
      let file: { id: string; durationSec: Prisma.Decimal | null; width: number | null; height: number | null };
      let thumbnail: { id: string };
      try {
        ({ file, thumbnail } = await this.storage.ingestVideoWithThumbnail(source.sourceUrl, { workspaceId: c.workspaceId, kind: 'CHAMPION_VIDEO' }));
      } catch (e) {
        throw new ImportError(e instanceof IngestError ? 'MEDIA_INVALID' : 'META_VIDEO_UNAVAILABLE', failReasonFor(e instanceof IngestError ? 'MEDIA_INVALID' : 'META_VIDEO_UNAVAILABLE'));
      }
      const d = num(file.durationSec) ?? 0;
      if (d < this.config.championMinSec || d > this.config.championMaxSec || Math.min(file.width ?? 0, file.height ?? 0) < 240) {
        throw new ImportError('MEDIA_INVALID', failReasonFor('MEDIA_INVALID'));
      }
      const analyze = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, championId, event: 'RESOLVED', from: 'RESOLVING', to: 'ANALYZING', data: { videoFileId: file.id, thumbnailFileId: thumbnail.id, durationSec: d, errorCode: null, failReason: null } });
        return tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId }, championId, offerId: c.offerId, createdById } });
      });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { videoFileId: file.id } });
      return analyze.id;
    } catch (e) {
      const code = e instanceof ImportError ? e.code : 'PROVIDER_ERROR';
      const reason = e instanceof ImportError ? e.reason : failReasonFor('PROVIDER_ERROR');
      if (!(e instanceof ImportError)) this.log.error(`import ${championId}: ${(e as Error).stack ?? e}`);
      await this.sm.transition({ championId, event: 'RESOLVE_FAILED', from: 'RESOLVING', to: 'FAILED', data: { errorCode: code, failReason: reason } }).catch(() => undefined);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: reason }).catch(() => undefined);
      return null;
    }
  }
}
