// ads-research-v1 §7: `GET /research/status` e `GET/POST /research/discovery`.
import { Inject, Injectable } from '@nestjs/common';
import type { CompetitorDiscoveryView, DiscoveryStage, ResearchStatus } from '@maquina/contratos';
import type { AuthContext } from '../common/auth/auth-context';
import type { AdLibraryResearchService } from '../integracoes/contrato';
import { ADS_RESEARCH_SERVICE } from '../integracoes/portas';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService } from './caps.service';
import { DiscoveryService } from './discovery.service';
import { ResearchConfig } from './research.config';
import { ResearchViews } from './research.views';

@Injectable()
export class ResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
    private readonly discovery: DiscoveryService,
    private readonly views: ResearchViews,
    @Inject(ADS_RESEARCH_SERVICE) private readonly adlib: AdLibraryResearchService,
  ) {}

  /** Reserva vigente = RESERVE da última descoberta concluída, sem quem já foi seguido ou removido. */
  async reserveCount(workspaceId: string): Promise<number> {
    const last = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, status: { in: ['SUCCEEDED', 'EMPTY'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!last) return 0;
    const taken = await this.prisma.competitor.findMany({ where: { workspaceId, status: { in: ['ACTIVE', 'DISMISSED'] } }, select: { source: { select: { pageId: true } } } });
    const blocked = new Set(taken.map((t) => t.source.pageId));
    const rows = await this.prisma.competitorCandidate.findMany({ where: { discoveryId: last.id, status: 'RESERVE' }, select: { pageId: true } });
    return rows.filter((r) => r.pageId && !blocked.has(r.pageId)).length;
  }

  async status(auth: AuthContext): Promise<ResearchStatus> {
    const ws = auth.workspaceId;
    const mode = this.cfg.mode;
    const access = await this.caps.access(ws);
    const st = mode === 'off' ? { available: false, reason: 'not_configured' as const, retryAfter: null } : await this.adlib.status();
    const [active, reserveCount, spend, last, firstSource] = await Promise.all([
      this.prisma.competitor.count({ where: { workspaceId: ws, status: 'ACTIVE' } }),
      this.reserveCount(ws),
      this.caps.spend(ws, access),
      this.prisma.competitorDiscovery.findFirst({ where: { workspaceId: ws, NOT: { trigger: 'BRAIN_CHANGED', status: 'QUEUED', notBefore: { gt: new Date() } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.competitor.findFirst({ where: { workspaceId: ws, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { source: { select: { countryCode: true } } } }),
    ]);
    return {
      mode, available: st.available, reason: st.reason, retryAfter: st.retryAfter,
      limits: {
        access, maxCompetitors: this.cfg.maxCompetitors(access), activeCompetitors: active, reserveMax: this.cfg.reserveMax(access), reserveCount,
        maxAdsPerCompetitor: this.cfg.maxAds(access), refreshEveryHours: this.cfg.refreshHours(access), autoSync: access !== 'SAMPLE',
      },
      spend,
      discovery: { status: last?.status ?? null, stage: last?.status === 'RUNNING' ? ((last.stage as DiscoveryStage | null) ?? 'propose') : null },
      countryCode: firstSource?.source.countryCode ?? last?.countryCode ?? null,
      winnerDays: this.cfg.winnerDays, winnerVersions: this.cfg.winnerVersions, newDays: this.cfg.newDays,
    };
  }

  async discoveryView(auth: AuthContext): Promise<CompetitorDiscoveryView> {
    const access = await this.caps.access(auth.workspaceId);
    return this.views.discovery(auth.workspaceId, access, await this.discovery.manualAvailableAt(auth.workspaceId));
  }

  async requestDiscovery(auth: AuthContext): Promise<CompetitorDiscoveryView> {
    await this.discovery.requestManual(auth);
    return this.discoveryView(auth);
  }
}
