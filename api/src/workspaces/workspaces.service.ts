import { Injectable } from '@nestjs/common';
import type { ClientCard, ClientsMeta, CreateClientResponse, TourCompleteResponse, TourState, TourStop, Workspace as WorkspaceView } from '@maquina/contratos';
import type { BusinessType, MemberRole, Prisma, ResultType, Workspace } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { randomToken, sha256 } from '../common/util/crypto';
import { initials, normalizeEmail, num } from '../common/util/format';
import { CreateClientDto, CreateInviteDto, UpdateWorkspaceDto } from './dto/workspaces.dto';
import { clientStatusOf, presentWorkspace, shortCodeFromName } from './cliente';
import { normalizeHex } from '../iteracao/paleta';
import { legacyBusinessTypeOf, resultPatchOf, resultStateError } from './resultado';
import { NO_FACTS, OnboardingService, onboardingCalc, onboardingFull, type OnboardingCalc, type UpdatedByRow } from './onboarding';
import { waitingOnYou, ZERO_WAITING } from './waiting';

const WS_WITH_UPDATED_BY = { onboardingUpdatedBy: { select: { id: true, name: true } } } satisfies Prisma.WorkspaceInclude;
type WsFull = Prisma.WorkspaceGetPayload<{ include: typeof WS_WITH_UPDATED_BY }>;

/** GET /workspaces: teto sem paginação (fase2-agencia.md §3.1). */
export const CLIENTS_LIMIT = 200;

const DAY_MS = 86_400_000;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly authService: AuthService,
    private readonly onboarding: OnboardingService,
  ) {}

  /** `Workspace` do contrato com `onboarding.percent/steps/updatedBy/updatedAt` (onboarding-v2 §3.2). */
  private async present(ws: WsFull): Promise<WorkspaceView> {
    return { ...presentWorkspace(ws), onboarding: onboardingFull(ws, await this.onboarding.calcOne(ws), ws.onboardingUpdatedBy) };
  }

  private async load(workspaceId: string): Promise<WsFull> {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, include: WS_WITH_UPDATED_BY });
  }

  async get(auth: AuthContext): Promise<WorkspaceView> {
    return this.present(await this.load(auth.workspaceId));
  }

  /** PATCH /workspace (fase2-agencia.md §3.3): autosave do onboarding, dados do cliente e pausar. */
  async update(auth: AuthContext, dto: UpdateWorkspaceDto): Promise<WorkspaceView> {
    const cur = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } });
    if (dto.onboardingStep !== undefined && cur.onboardingCompletedAt) {
      throw new AppException('INVALID_STATE', { state: clientStatusOf(cur), allowed: ['SETUP'], reason: 'onboarding_completed' });
    }
    const result = resultDataOf(dto, cur);
    const ws = await this.prisma.workspace.update({
      where: { id: auth.workspaceId },
      include: WS_WITH_UPDATED_BY,
      data: {
        // onboarding-v2 §1: qualquer campo do PATCH conta como "mexeu no setup" (tela "Setup in progress")
        onboardingUpdatedById: auth.userId,
        onboardingUpdatedAt: new Date(),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.uiLocale !== undefined && { uiLocale: dto.uiLocale }),
        ...(dto.monthlySpendCapUsd !== undefined && { monthlySpendCapUsd: dto.monthlySpendCapUsd }),
        ...(dto.shortCode !== undefined && { shortCode: dto.shortCode }),
        ...(dto.industry !== undefined && { industry: text(dto.industry) }),
        ...(dto.market !== undefined && { market: text(dto.market) }),
        ...result,
        ...(dto.websiteUrl !== undefined && { websiteUrl: text(dto.websiteUrl) }),
        // D3: `#RRGGBB` maiúsculo; null limpa (a paleta volta a ser derivada, §A3.3)
        ...(dto.brandColor !== undefined && { brandColor: dto.brandColor === null ? null : normalizeHex(dto.brandColor) }),
        ...(dto.onboardingStep !== undefined && { onboardingStep: dto.onboardingStep }),
        // pausar é só rótulo (D4): não mexe no onboarding nem bloqueia geração
        ...(dto.paused !== undefined && { pausedAt: dto.paused ? cur.pausedAt ?? new Date() : null }),
      },
    });
    return this.present(ws);
  }

  /** POST /workspace/onboarding/complete: idempotente; precisa do tipo de negócio e de >= 1 oferta não arquivada. */
  async completeOnboarding(auth: AuthContext): Promise<WorkspaceView> {
    const ws = await this.load(auth.workspaceId);
    if (ws.onboardingCompletedAt) return this.present(ws);
    const offers = await this.prisma.offer.count({ where: { workspaceId: ws.id, archivedAt: null } });
    const missing: ('resultType' | 'offer')[] = [];
    if (!ws.resultType) missing.push('resultType');
    if (!offers) missing.push('offer');
    if (missing.length) throw new AppException('ONBOARDING_INCOMPLETE', { missing });
    await this.prisma.workspace.updateMany({
      where: { id: ws.id, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date(), onboardingStep: 6, onboardingUpdatedById: auth.userId, onboardingUpdatedAt: new Date() },
    });
    return this.present(await this.load(ws.id));
  }

  // ───────── onboarding-v2 §3.4: tour ─────────

  /**
   * GET /workspace/tour: `completedAt` do membership do usuário neste workspace; `stops` sem `iterate` quando não há
   * conexão Meta ativa com um anúncio WINNER no snapshot (D6: a parada só existe com vencedor real).
   */
  async tour(auth: AuthContext): Promise<TourState> {
    const [m, winners] = await Promise.all([
      this.prisma.membership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: auth.workspaceId, userId: auth.userId } }, select: { tourCompletedAt: true } }),
      this.config.metaEnabled
        ? this.prisma.metaAdSnapshot.count({ where: { workspaceId: auth.workspaceId, verdict: 'WINNER', connection: { status: 'ACTIVE', adAccountId: { not: null } } } })
        : Promise.resolve(0),
    ]);
    const stops: TourStop[] = ['brain', ...(winners > 0 ? (['iterate'] as TourStop[]) : []), 'concepts', 'eddy', 'home'];
    return { completedAt: m.tourCompletedAt?.toISOString() ?? null, stops };
  }

  /** POST /workspace/tour/complete: idempotente (já concluído devolve a data gravada). CLIENT também pode. */
  async completeTour(auth: AuthContext): Promise<TourCompleteResponse> {
    const where = { workspaceId: auth.workspaceId, userId: auth.userId };
    await this.prisma.membership.updateMany({ where: { ...where, tourCompletedAt: null }, data: { tourCompletedAt: new Date() } });
    const m = await this.prisma.membership.findUniqueOrThrow({ where: { workspaceId_userId: where }, select: { tourCompletedAt: true } });
    return { tourCompletedAt: m.tourCompletedAt!.toISOString() };
  }

  /**
   * GET /workspaces (tela Clients): todos os workspaces em que o usuário é membro. 1 query de memberships + os 2 groupBy
   * do waitingOnYou (a MESMA função da Home). Ordem: não pausados antes, waitingOnYou.total desc, name asc.
   */
  async listClients(auth: AuthContext): Promise<{ items: ClientCard[]; meta: ClientsMeta }> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: auth.userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CLIENTS_LIMIT,
      include: { workspace: { include: WS_WITH_UPDATED_BY } },
    });
    const [waiting, calc] = await Promise.all([
      waitingOnYou(this.prisma, memberships.map((m) => m.workspaceId)),
      this.onboarding.calcMany(memberships.map((m) => m.workspace)),
    ]);
    const items = memberships.map((m) => card(m.workspace, m.role, m.workspaceId === auth.workspaceId, waiting.get(m.workspaceId)!, calc.get(m.workspaceId)!, m.workspace.onboardingUpdatedBy));
    items.sort((a, b) =>
      Number(a.status === 'PAUSED') - Number(b.status === 'PAUSED') ||
      b.waitingOnYou.total - a.waitingOnYou.total ||
      a.name.localeCompare(b.name));
    const count = (s: ClientCard['status']) => items.filter((c) => c.status === s).length;
    return {
      items,
      meta: {
        summary: { live: count('LIVE'), setup: count('SETUP'), paused: count('PAUSED'), waitingTotal: items.reduce((a, c) => a + c.waitingOnYou.total, 0) },
        canCreate: auth.role === 'OWNER' || auth.role === 'ADMIN',
      },
    };
  }

  /**
   * POST /workspaces (New client): workspace em SETUP, criador OWNER, copia os OWNER/ADMIN do workspace ativo (copyTeam,
   * padrão true, D3), numa transação. Devolve tokens novos com o wid do cliente (igual ao switch-workspace).
   */
  async createClient(auth: AuthContext, dto: CreateClientDto): Promise<CreateClientResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { uiLocale: true } });
    const name = dto.name.trim();
    if (!name) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'name', rule: 'minLength' }] });
    const ws = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name,
          shortCode: dto.shortCode ?? shortCodeFromName(name),
          uiLocale: dto.uiLocale ?? user.uiLocale,
          websiteUrl: text(dto.websiteUrl),
          industry: text(dto.industry),
          market: text(dto.market),
          ...resultDataOf(dto, { resultType: null, resultTypeOther: null }),
          ...(dto.brandColor && { brandColor: normalizeHex(dto.brandColor) }),
          onboardingStep: 1,
        },
      });
      await tx.membership.create({ data: { workspaceId: created.id, userId: auth.userId, role: 'OWNER' } });
      if (dto.copyTeam !== false) {
        const team = await tx.membership.findMany({
          where: { workspaceId: auth.workspaceId, role: { in: ['OWNER', 'ADMIN'] }, userId: { not: auth.userId } },
          select: { userId: true, role: true },
        });
        if (team.length) await tx.membership.createMany({ data: team.map((m) => ({ workspaceId: created.id, userId: m.userId, role: m.role })) });
      }
      return created;
    });
    const session = await this.authService.switchWorkspace(auth, ws.id);
    return { ...session, client: card(ws, session.workspace.role, true, { ...ZERO_WAITING }, onboardingCalc(ws, NO_FACTS, this.onboarding.metaEnabled), null) };
  }

  async members(auth: AuthContext) {
    const [memberships, invites] = await Promise.all([
      this.prisma.membership.findMany({
        where: { workspaceId: auth.workspaceId },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.invite.findMany({
        where: { workspaceId: auth.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      members: memberships.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        initials: initials(m.user.name),
      })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
    };
  }

  async createInvite(auth: AuthContext, dto: CreateInviteDto) {
    const email = normalizeEmail(dto.email);
    const already = await this.prisma.membership.findFirst({
      where: { workspaceId: auth.workspaceId, user: { email } },
      select: { id: true },
    });
    if (already) throw new AppException('EMAIL_TAKEN');

    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.config.inviteTtlDays * DAY_MS);
    const invite = await this.prisma.$transaction(async (tx) => {
      // Um convite vivo por e-mail: o novo substitui o anterior.
      await tx.invite.updateMany({
        where: { workspaceId: auth.workspaceId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.invite.create({
        data: { workspaceId: auth.workspaceId, email, role: dto.role, tokenHash: sha256(token), expiresAt, createdById: auth.userId },
      });
    });
    return { id: invite.id, inviteUrl: `${this.config.webOrigins[0]}/invite/${token}`, expiresAt: expiresAt.toISOString() };
  }

  async revokeInvite(auth: AuthContext, inviteId: string) {
    const r = await this.prisma.invite.updateMany({
      where: { id: inviteId, workspaceId: auth.workspaceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count !== 1) throw new AppException('NOT_FOUND');
    return { ok: true as const };
  }

  async updateMember(auth: AuthContext, userId: string, role: MemberRole) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId: auth.workspaceId, userId } },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!m) throw new AppException('NOT_FOUND');
      if (m.role === 'OWNER' && role !== 'OWNER') await assertNotLastOwner(tx, auth.workspaceId);
      const updated = await tx.membership.update({ where: { id: m.id }, data: { role } });
      return { userId: m.user.id, name: m.user.name, email: m.user.email, role: updated.role, initials: initials(m.user.name) };
    });
  }

  async removeMember(auth: AuthContext, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId: auth.workspaceId, userId } } });
      if (!m) throw new AppException('NOT_FOUND');
      if (m.role === 'OWNER') await assertNotLastOwner(tx, auth.workspaceId);
      await tx.membership.delete({ where: { id: m.id } });
      await tx.refreshToken.updateMany({
        where: { userId, workspaceId: auth.workspaceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { ok: true as const };
  }

  services() {
    const anthropic = this.config.optional('ANTHROPIC_API_KEY');
    const wavespeed = this.config.optional('WAVESPEED_API_KEY');
    const hfId = this.config.optional('HF_API_KEY_ID');
    const hfOk = !!(hfId && this.config.optional('HF_API_KEY_SECRET'));
    const apify = this.config.optional('APIFY_TOKEN');
    const storageKey = this.config.optional('STORAGE_ACCESS_KEY_ID');
    const storageOk = !!(storageKey && this.config.optional('STORAGE_SECRET_ACCESS_KEY') && this.config.optional('STORAGE_ENDPOINT'));
    // meta-v1: mock = conectado (custo zero); live = app id + secret + chave do cofre; off = desligado
    const metaMode = this.config.metaMode;
    const metaOk = metaMode === 'mock' || (metaMode === 'live' && !!(this.config.metaAppId && this.config.metaAppSecret && this.config.metaTokenKey));
    return [
      { provider: 'ANTHROPIC' as const, connected: !!anthropic, keyMasked: mask(anthropic) },
      { provider: 'WAVESPEED' as const, connected: !!wavespeed, keyMasked: mask(wavespeed) },
      { provider: 'HIGGSFIELD' as const, connected: hfOk, keyMasked: mask(hfId) },
      { provider: 'APIFY' as const, connected: !!apify, keyMasked: mask(apify) },
      { provider: 'STORAGE' as const, connected: storageOk, keyMasked: mask(storageKey) },
      { provider: 'META' as const, connected: metaOk, keyMasked: metaMode === 'live' ? mask(this.config.metaAppId) : metaMode === 'mock' ? 'mock' : null },
    ];
  }

  /** Gasto do mês (UTC) a partir das cost_entries (escritas só pela ia; aqui é só leitura). */
  async spend(auth: AuthContext, month?: string) {
    const now = new Date();
    const key = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const [y, m] = key.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const where = { workspaceId: auth.workspaceId, createdAt: { gte: from, lt: to } };
    const [ws, total, byProvider, byKind] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { monthlySpendCapUsd: true } }),
      this.prisma.costEntry.aggregate({ where, _sum: { amountUsd: true } }),
      this.prisma.costEntry.groupBy({ by: ['provider'], where, _sum: { amountUsd: true } }),
      this.prisma.costEntry.groupBy({ by: ['kind'], where, _sum: { amountUsd: true } }),
    ]);
    return {
      month: key,
      spentUsd: num(total._sum.amountUsd) ?? 0,
      capUsd: num(ws.monthlySpendCapUsd),
      byProvider: byProvider.map((r) => ({ provider: r.provider, amountUsd: num(r._sum.amountUsd) ?? 0 })),
      byKind: byKind.map((r) => ({ kind: r.kind, amountUsd: num(r._sum.amountUsd) ?? 0 })),
    };
  }
}

async function assertNotLastOwner(tx: { membership: PrismaService['membership'] }, workspaceId: string) {
  const owners = await tx.membership.count({ where: { workspaceId, role: 'OWNER' } });
  if (owners <= 1) throw new AppException('LAST_OWNER');
}

function card(ws: Workspace, role: MemberRole, isActive: boolean, waiting: ClientCard['waitingOnYou'], calc: OnboardingCalc, updatedBy: UpdatedByRow): ClientCard {
  return {
    id: ws.id, name: ws.name, shortCode: ws.shortCode, role, isActive,
    status: clientStatusOf(ws), onboarding: onboardingFull(ws, calc, updatedBy),
    industry: ws.industry, businessType: legacyBusinessTypeOf(ws.resultType), websiteUrl: ws.websiteUrl,
    resultType: ws.resultType,
    waitingOnYou: waiting,
    updatedAt: ws.updatedAt.toISOString(),
  };
}

/**
 * resultado-v1: colunas de resultado do PATCH/POST (resultType manda; businessType antigo migra), com o estado final
 * validado (OTHER exige texto → 400) e a coluna business_type gravada derivada (compat por 1 versão).
 */
function resultDataOf(
  dto: { resultType?: ResultType | null; resultTypeOther?: string | null; businessType?: BusinessType | null },
  cur: { resultType: ResultType | null; resultTypeOther: string | null },
): { resultType?: ResultType | null; resultTypeOther?: string | null; businessType?: BusinessType | null } {
  const patch = resultPatchOf(dto);
  if (patch.resultType === undefined && patch.resultTypeOther === undefined) return {};
  const finalType = patch.resultType !== undefined ? patch.resultType : cur.resultType;
  const finalOther = finalType === 'OTHER' ? (patch.resultTypeOther !== undefined ? patch.resultTypeOther : cur.resultTypeOther) : null;
  const why = resultStateError(finalType, finalOther);
  if (why) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'resultTypeOther', rule: why }] });
  return { resultType: finalType, resultTypeOther: finalOther, businessType: legacyBusinessTypeOf(finalType) };
}

/** Texto livre opcional: aparado; vazio vira null. */
function text(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function mask(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return '…' + key.slice(-2);
  const prefix = key.startsWith('sk-') ? 'sk-' : key.slice(0, 3);
  return `${prefix}…${key.slice(-4)}`;
}
