// ads-research-v1 §3 (aposentar) + §4/C.4 (retenção). Roda 1×/dia pelo tique do ResearchSyncService.
//  - Concorrente sem nenhum anúncio ativo há ADS_RESEARCH_RETIRE_DAYS (30) = RETIRED (vaga aberta, a reserva assume).
//  - Anúncio que nenhuma coleta vê há ADS_RESEARCH_RETENTION_DAYS (90), não salvo nem usado = apaga linha e chaves.
//  - Candidatos rejeitados/NOT_FOUND/TOO_FEW_ADS/BLOCKED com mais de 180 dias saem; aprovados e termos ficam.
import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../arquivos/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompetitorsService } from './competitors.service';
import { DAY_MS } from './regras';
import { ResearchConfig } from './research.config';
import { ResearchSyncService } from './sync.service';

const CANDIDATE_RETENTION_DAYS = 180;
const BATCH = 200;

@Injectable()
export class ResearchRetencaoService {
  private readonly log = new Logger('ResearchRetencao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly storage: StorageService,
    private readonly competitors: CompetitorsService,
    sync: ResearchSyncService,
  ) {
    sync.housekeeping = async () => { await this.runDaily(); };
  }

  async runDaily(now = new Date()): Promise<{ retired: number; adsDeleted: number; candidatesDeleted: number }> {
    const retired = await this.retireIdle(now);
    const adsDeleted = await this.purgeAds(now);
    const candidatesDeleted = await this.purgeCandidates(now);
    if (retired || adsDeleted || candidatesDeleted) this.log.log(`faxina: ${retired} fonte(s) aposentada(s), ${adsDeleted} anúncio(s) e ${candidatesDeleted} candidato(s) apagados`);
    return { retired, adsDeleted, candidatesDeleted };
  }

  /** Fontes seguidas, já coletadas, sem anúncio ativo, cujo último anúncio parou (ou foi visto) há mais de RETIRE_DAYS. */
  async retireIdle(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - this.cfg.retireDays * DAY_MS);
    const sources = await this.prisma.adSource.findMany({
      where: { lastValidSyncAt: { not: null }, competitors: { some: { status: 'ACTIVE' } }, ads: { none: { ad: { isActive: true } } } },
      select: { id: true, lastValidSyncAt: true, createdAt: true },
    });
    let n = 0;
    for (const s of sources) {
      const last = await this.prisma.libraryAd.findFirst({
        where: { sources: { some: { sourceId: s.id } } }, orderBy: [{ stoppedAt: { sort: 'desc', nulls: 'last' } }], select: { stoppedAt: true, lastSeenAt: true },
      });
      const lastActive = last?.stoppedAt ?? last?.lastSeenAt ?? s.createdAt;
      if (lastActive.getTime() > limit.getTime()) continue;
      await this.competitors.retireSource(s.id);
      n++;
    }
    return n;
  }

  async purgeAds(now = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - this.cfg.retentionDays * DAY_MS);
    let total = 0;
    for (;;) {
      const ads = await this.prisma.libraryAd.findMany({
        where: { lastSeenAt: { lt: limit }, saves: { none: {} }, champions: { none: {} } },
        select: { id: true, posterKey: true, videoKey: true }, take: BATCH,
      });
      if (!ads.length) break;
      for (const a of ads) {
        if (a.posterKey) await this.storage.deleteObject(a.posterKey);
        if (a.videoKey) await this.storage.deleteObject(a.videoKey);
      }
      const r = await this.prisma.libraryAd.deleteMany({ where: { id: { in: ads.map((a) => a.id) } } });
      total += r.count;
      if (ads.length < BATCH) break;
    }
    return total;
  }

  async purgeCandidates(now = new Date()): Promise<number> {
    const r = await this.prisma.competitorCandidate.deleteMany({
      where: { status: { in: ['REJECTED_NICHE', 'NOT_FOUND', 'TOO_FEW_ADS', 'BLOCKED'] }, createdAt: { lt: new Date(now.getTime() - CANDIDATE_RETENTION_DAYS * DAY_MS) } },
    });
    return r.count;
  }
}
