// ads-research-v1 §2.5 + C.2: concorrentes seguidos do workspace. O cliente não adiciona (G2): só remove (a vaga é
// preenchida na hora pela reserva) e desfaz. A equipe (INTERNAL OWNER) adiciona manual (R10). "Atualizar agora" = coleta
// MANUAL (1× por janela; teto do workspace e global). Aposentar (Página sumiu / 30 dias sem anúncio) também abre vaga.
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Competitor as CompetitorView, DismissCompetitorResponse, DismissReason } from '@maquina/contratos';
import type { Competitor } from '@prisma/client';
import { testMode } from '../amostra/acesso';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService } from './caps.service';
import { countryOf, pageIdFrom } from './regras';
import { ResearchConfig } from './research.config';
import { ResearchViews } from './research.views';
import { pickReplacement } from './selecao';
import { RESEARCH_SOURCE_GONE, ResearchSyncService } from './sync.service';
import type { AddCompetitorDto } from './dto/research.dto';

@Injectable()
export class CompetitorsService {
  private readonly log = new Logger('ResearchCompetitors');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
    private readonly sync: ResearchSyncService,
    private readonly views: ResearchViews,
  ) {}

  private async load(workspaceId: string, id: string): Promise<Competitor> {
    const c = await this.prisma.competitor.findFirst({ where: { id, workspaceId } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  async list(auth: AuthContext, status: 'active' | 'dismissed' | 'retired' = 'active'): Promise<{ items: CompetitorView[] }> {
    const st = status === 'dismissed' ? 'DISMISSED' : status === 'retired' ? 'RETIRED' : 'ACTIVE';
    const rows = await this.prisma.competitor.findMany({ where: { workspaceId: auth.workspaceId, status: st }, orderBy: { createdAt: 'asc' } });
    const items = await this.views.competitors(auth.workspaceId, rows);
    // C.2: diretos primeiro, depois por anúncios ativos (desc)
    if (st === 'ACTIVE') items.sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'DIRECT' ? -1 : 1) || b.counts.active - a.counts.active);
    return { items };
  }

  async rename(auth: AuthContext, id: string, name: string): Promise<CompetitorView> {
    await this.load(auth.workspaceId, id);
    const c = await this.prisma.competitor.update({ where: { id }, data: { name: name.trim().slice(0, 80) } });
    return this.views.competitor(auth.workspaceId, c);
  }

  /** §2.5: ACTIVE → DISMISSED (bloqueio de Página e domínio) e a vaga vai pro 1º da reserva, sem custo de descoberta. */
  async dismiss(auth: AuthContext, id: string, reason: DismissReason): Promise<DismissCompetitorResponse> {
    const cur = await this.load(auth.workspaceId, id);
    if (cur.status !== 'ACTIVE') throw new AppException('INVALID_STATE', { state: cur.status, allowed: ['ACTIVE'], reason: 'not_active' });
    const r = await this.prisma.competitor.updateMany({
      where: { id, status: 'ACTIVE' }, data: { status: 'DISMISSED', dismissedAt: new Date(), dismissedById: auth.userId, dismissReason: reason },
    });
    if (!r.count) throw new AppException('INVALID_STATE', { state: 'DISMISSED', allowed: ['ACTIVE'], reason: 'not_active' });
    await this.sync.refreshSourceStatus(cur.sourceId);
    const replacement = await this.fillVacancy(auth.workspaceId, auth.userId);
    const dismissed = await this.prisma.competitor.findUniqueOrThrow({ where: { id } });
    return { dismissed: await this.views.competitor(auth.workspaceId, dismissed), replacement: replacement ? await this.views.competitor(auth.workspaceId, replacement) : null };
  }

  /** Desfazer: volta se houver vaga (sem vaga = 409 competitor_limit). */
  async restore(auth: AuthContext, id: string): Promise<CompetitorView> {
    const cur = await this.load(auth.workspaceId, id);
    if (cur.status !== 'DISMISSED') throw new AppException('INVALID_STATE', { state: cur.status, allowed: ['DISMISSED'], reason: 'not_dismissed' });
    const access = await this.caps.access(auth.workspaceId);
    const active = await this.prisma.competitor.count({ where: { workspaceId: auth.workspaceId, status: 'ACTIVE' } });
    if (active >= this.cfg.maxCompetitors(access)) throw new AppException('INVALID_STATE', { state: cur.status, allowed: ['DISMISSED'], reason: 'competitor_limit' });
    await this.prisma.competitor.update({ where: { id }, data: { status: 'ACTIVE', dismissedAt: null, dismissedById: null, dismissReason: null } });
    await this.sync.refreshSourceStatus(cur.sourceId);
    // fonte sem coleta recente (> 7 dias) ganha uma; senão o seguidor vê os dados na hora (§3 "fonte já existe")
    await this.importIfStale(auth.workspaceId, auth.userId, cur.sourceId, access);
    return this.views.competitor(auth.workspaceId, await this.prisma.competitor.findUniqueOrThrow({ where: { id } }));
  }

  /** `POST …/:id/refresh` ("Atualizar agora"): 1× por janela; teto do workspace (409) e global (503 quota). */
  async refresh(auth: AuthContext, id: string): Promise<CompetitorView> {
    const cur = await this.load(auth.workspaceId, id);
    if (cur.status !== 'ACTIVE') throw new AppException('NOT_FOUND');
    if (this.cfg.mode === 'off') throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'not_configured', retryAfter: null });
    const access = await this.caps.access(auth.workspaceId);
    const hours = this.cfg.refreshHours(access);
    if (hours == null) throw new AppException('PAYMENT_REQUIRED', { reason: 'research_tier', unlock: { pieces: 0 } });
    const source = await this.prisma.adSource.findUniqueOrThrow({ where: { id: cur.sourceId } });
    const open = await this.sync.openSync(source.id);
    if (open) throw new AppException('INVALID_STATE', { state: open.status, allowed: ['SUCCEEDED', 'FAILED', 'SUSPECT'], reason: 'sync_running' });
    const availableAt = await this.views.refreshAvailableAt(auth.workspaceId, source.id, access);
    if (availableAt && availableAt.getTime() > Date.now()) throw new AppException('RATE_LIMITED', { retryAfter: availableAt.toISOString() });
    const limit = this.cfg.adaptiveLimit(await this.sync.sourceAccess(source.id), source.lastActiveCount);
    const estimate = this.cfg.scrapeEstimateUsd(limit);
    await this.caps.assertWorkspace(auth.workspaceId, estimate, access);
    await this.caps.assertGlobal(estimate);
    await this.sync.enqueuePage({ source, trigger: 'MANUAL', limit, workspaceId: auth.workspaceId, userId: auth.userId });
    return this.views.competitor(auth.workspaceId, cur);
  }

  /** R10: só a equipe (INTERNAL OWNER). Página por id ou URL com o id; país = o do corpo, o das outras fontes ou US. */
  async add(auth: AuthContext, dto: AddCompetitorDto): Promise<CompetitorView> {
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { access: true } });
    if (auth.role !== 'OWNER' || !(testMode() || me?.access === 'INTERNAL')) throw new AppException('FORBIDDEN');
    const both = !!dto.pageId && !!dto.pageUrl;
    const pageId = both ? null : pageIdFrom(dto);
    if (!pageId) throw new AppException('VALIDATION_ERROR', { fields: [{ field: dto.pageUrl ? 'pageUrl' : 'pageId', rule: 'research_source_invalid' }] });
    if (this.cfg.mode === 'off') throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'not_configured', retryAfter: null });
    const access = await this.caps.access(auth.workspaceId);
    const country = countryOf(dto.countryCode)
      ?? (await this.prisma.competitor.findFirst({ where: { workspaceId: auth.workspaceId, status: 'ACTIVE' }, include: { source: { select: { countryCode: true } } } }))?.source.countryCode
      ?? 'US';
    const existing = await this.prisma.competitor.findFirst({ where: { workspaceId: auth.workspaceId, source: { pageId, countryCode: country } } });
    if (existing?.status === 'ACTIVE') throw new AppException('INVALID_STATE', { state: 'ACTIVE', allowed: [], reason: 'already_following' });
    const active = await this.prisma.competitor.count({ where: { workspaceId: auth.workspaceId, status: 'ACTIVE' } });
    if (active >= this.cfg.maxCompetitors(access)) throw new AppException('INVALID_STATE', { state: 'ACTIVE', allowed: [], reason: 'competitor_limit' });
    const source = await this.sync.ensureSource({ pageId, countryCode: country, displayName: dto.name ?? pageId });
    await this.sync.linkPageAds(source);
    const c = existing
      ? await this.prisma.competitor.update({ where: { id: existing.id }, data: { status: 'ACTIVE', retiredAt: null, dismissedAt: null, dismissedById: null, dismissReason: null, ...(dto.name && { name: dto.name }) } })
      : await this.prisma.competitor.create({
        data: { workspaceId: auth.workspaceId, sourceId: source.id, name: (dto.name ?? source.displayName).slice(0, 80), origin: 'MANUAL', relation: 'DIRECT', createdById: auth.userId },
      });
    await this.sync.refreshSourceStatus(source.id);
    await this.importIfStale(auth.workspaceId, auth.userId, source.id, access);
    return this.views.competitor(auth.workspaceId, c);
  }

  /** Coleta INITIAL se a fonte nunca coletou ou a última válida tem > 7 dias (e não há uma aberta). */
  private async importIfStale(workspaceId: string, userId: string | null, sourceId: string, access: Awaited<ReturnType<ResearchCapsService['access']>>): Promise<void> {
    const source = await this.prisma.adSource.findUniqueOrThrow({ where: { id: sourceId } });
    const stale = !source.lastValidSyncAt || Date.now() - source.lastValidSyncAt.getTime() > 7 * 86_400_000;
    if (!stale) return;
    if (await this.sync.openSync(sourceId)) return;
    if (!(await this.caps.fits(workspaceId, this.cfg.scrapeEstimateUsd(this.cfg.maxAds(access)), access))) return; // sem folga: fica pro semanal
    await this.sync.enqueuePage({ source, trigger: 'INITIAL', limit: this.cfg.maxAds(access), workspaceId, userId });
  }

  /**
   * Vaga aberta: o 1º da reserva vigente (RESERVE da última descoberta concluída) com ≥ 2 anúncios vistos; sem ninguém
   * assim, o 1º da reserva. Segue, importa e marca o candidato FOLLOWED. null = reserva vazia (a UI oferece "Procurar de novo").
   */
  async fillVacancy(workspaceId: string, userId: string | null): Promise<Competitor | null> {
    const access = await this.caps.access(workspaceId);
    const active = await this.prisma.competitor.count({ where: { workspaceId, status: 'ACTIVE' } });
    if (active >= this.cfg.maxCompetitors(access)) return null;
    const last = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, status: { in: ['SUCCEEDED', 'EMPTY'] } }, orderBy: { createdAt: 'desc' } });
    if (!last?.countryCode) return null;
    const taken = await this.prisma.competitor.findMany({ where: { workspaceId, status: { in: ['ACTIVE', 'DISMISSED'] } }, include: { source: { select: { pageId: true } } } });
    const blocked = new Set(taken.map((c) => c.source.pageId));
    const blockedDomains = taken.filter((c) => c.status === 'DISMISSED').map((c) => c.domain).filter(Boolean);
    const reserve = (await this.prisma.competitorCandidate.findMany({ where: { discoveryId: last.id, status: 'RESERVE', pageId: { not: null } }, orderBy: { rank: 'asc' } }))
      .filter((c) => !blocked.has(c.pageId!) && !(c.domain && blockedDomains.includes(c.domain)));
    const pick = pickReplacement(reserve.map((c) => ({ ...c, adsSeen: c.activeAdsSeen })));
    if (!pick) return null;
    const source = await this.sync.ensureSource({ pageId: pick.pageId!, countryCode: last.countryCode, displayName: pick.pageName ?? pick.pageId! });
    await this.sync.linkPageAds(source);
    const c = await this.prisma.competitor.upsert({
      where: { workspaceId_sourceId: { workspaceId, sourceId: source.id } },
      create: {
        workspaceId, sourceId: source.id, name: (pick.brandName || pick.pageName || pick.pageId!).slice(0, 80), origin: 'DISCOVERED', relation: pick.relation ?? 'DIRECT',
        nicheScore: pick.nicheScore, discoveryId: last.id, reason: pick.reason, domain: pick.domain,
      },
      update: { status: 'ACTIVE', retiredAt: null, relation: pick.relation ?? 'DIRECT', nicheScore: pick.nicheScore, reason: pick.reason },
    });
    await this.prisma.competitorCandidate.update({ where: { id: pick.id }, data: { status: 'FOLLOWED' } });
    await this.sync.refreshSourceStatus(source.id);
    await this.importIfStale(workspaceId, userId, source.id, access);
    return c;
  }

  /** Concorrentes da fonte → RETIRED (vaga aberta, a reserva assume). */
  async retireSource(sourceId: string): Promise<void> {
    const rows = await this.prisma.competitor.findMany({ where: { sourceId, status: 'ACTIVE' } });
    for (const c of rows) {
      const r = await this.prisma.competitor.updateMany({ where: { id: c.id, status: 'ACTIVE' }, data: { status: 'RETIRED', retiredAt: new Date() } });
      if (r.count) await this.fillVacancy(c.workspaceId, null).catch((e) => this.log.warn(`vaga de ${c.workspaceId}: ${(e as Error).message}`));
    }
    await this.sync.refreshSourceStatus(sourceId);
  }

  @OnEvent(RESEARCH_SOURCE_GONE, { async: true })
  async onSourceGone(e: { sourceId: string }): Promise<void> {
    await this.retireSource(e.sourceId).catch((err) => this.log.warn(`aposentar fonte ${e.sourceId}: ${(err as Error).message}`));
  }
}
