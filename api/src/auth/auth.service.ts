import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccountMode, AuthSession, AuthUser, ClientStatus, MeResponse, OnboardingSummary, Role } from '@maquina/contratos';
import { Prisma, type AccountMode as AccountModeRow, type MemberRole, type User, type UiLocale, type Workspace } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256, verifyPassword } from '../common/util/crypto';
import { normalizeEmail } from '../common/util/format';
import { clientStatusOf, shortCodeFromName } from '../workspaces/cliente';
import { OnboardingService, onboardingSummaryOf } from '../workspaces/onboarding';
import { AcceptInviteDto, SignupDto, UpdateMeDto } from './dto/auth.dto';

/** AuthUser do contrato (accountMode sempre presente; null = ainda não respondeu). */
export interface PublicUser extends AuthUser { id: string; name: string; email: string; uiLocale: UiLocale; accountMode: AccountMode | null }
/**
 * WorkspaceRef do contrato (onboarding-v2 §3.5): `status` e `onboarding` sempre; `tourCompletedAt` só no workspace ATIVO
 * (membership do usuário nele), nunca nos itens de MeResponse.workspaces[].
 */
export interface WorkspaceRef { id: string; name: string; role: Role; status: ClientStatus; onboarding: OnboardingSummary; tourCompletedAt?: string | null }
export interface Session extends AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
  workspace: WorkspaceRef;
}

const DAY_MS = 86_400_000;
const SIGNUP_DEFAULT_CLIENT_NAME = 'New client';
const EMAIL_TAKEN_SIGNUP = 'An account with this email already exists. Log in instead.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly onboarding: OnboardingService,
  ) {}

  async login(emailRaw: string, password: string): Promise<Session> {
    const email = normalizeEmail(emailRaw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Mesmo custo de CPU com ou sem usuário (não vaza quais e-mails existem).
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok || !user.isActive) throw new AppException('INVALID_CREDENTIALS');

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true, role: true },
    });
    if (!membership) throw new AppException('INVALID_CREDENTIALS');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user, membership.workspaceId, membership.role);
  }

  /**
   * Cadastro self-serve (fase2-cadastro.md §3). Numa transação: User → Workspace (1º cliente, SETUP, passo 1, teto do
   * cadastro) → Membership OWNER. Nunca deixa usuário órfão. E-mail existente (ativo ou não, inclusive na corrida do
   * unique) → EMAIL_TAKEN com mensagem fixa, sem dizer mais nada sobre a conta.
   */
  async signup(dto: SignupDto): Promise<Session> {
    if (!this.config.signupEnabled) throw new AppException('FORBIDDEN');
    const email = normalizeEmail(dto.email);
    const taken = () => new AppException('EMAIL_TAKEN', undefined, EMAIL_TAKEN_SIGNUP);
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) throw taken();

    const uiLocale: UiLocale = dto.uiLocale ?? 'EN';
    const wsName = dto.agencyName?.trim() || SIGNUP_DEFAULT_CLIENT_NAME;
    const passwordHash = await hashPassword(dto.password);
    let created: { user: User; workspace: { id: string; name: string } };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, name: dto.name.trim(), passwordHash, uiLocale, isActive: true, accountMode: dto.accountMode ?? null },
        });
        const workspace = await tx.workspace.create({
          data: {
            name: wsName,
            shortCode: shortCodeFromName(wsName),
            uiLocale,
            onboardingStep: 1,
            onboardingCompletedAt: null,
            pausedAt: null,
            monthlySpendCapUsd: this.config.signupDefaultSpendCapUsd,
          },
          select: { id: true, name: true },
        });
        await tx.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' } });
        return { user, workspace };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw taken();
      throw e;
    }
    return this.issue(created.user, created.workspace.id, 'OWNER');
  }

  /** Refresh rotativo: o token apresentado é revogado (compare-and-set) e um novo par sai. */
  async refresh(refreshToken: string): Promise<Session> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new AppException('REFRESH_INVALID');

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new AppException('REFRESH_INVALID'); // outra requisição já girou este token

    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: row.userId } },
      include: { user: true },
    });
    if (!membership || !membership.user.isActive) throw new AppException('REFRESH_INVALID');
    return this.issue(membership.user, membership.workspaceId, membership.role);
  }

  async logout(auth: AuthContext, refreshToken: string): Promise<{ ok: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * GET /auth/me (onboarding-v2 §3.5): cada workspace vem com `status` e `onboarding { step, percent, completedAt }`,
   * calculados em lote (1 query de memberships + 1 de ofertas + 1 de conexões Meta; sem N+1). Só o ativo traz
   * `tourCompletedAt`.
   */
  async me(auth: AuthContext): Promise<MeResponse & { user: PublicUser; workspace: WorkspaceRef; workspaces: WorkspaceRef[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const memberships = await this.prisma.membership.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'asc' },
      include: { workspace: true },
    });
    const calc = await this.onboarding.calcMany(memberships.map((m) => m.workspace));
    const workspaces = memberships.map((m) => workspaceRef(m.workspace, m.role, calc.get(m.workspaceId)!));
    const active = memberships.find((m) => m.workspaceId === auth.workspaceId)!;
    const workspace: WorkspaceRef = { ...workspaces.find((w) => w.id === auth.workspaceId)!, tourCompletedAt: active.tourCompletedAt?.toISOString() ?? null };
    return { user: publicUser(user), workspace, workspaces };
  }

  async switchWorkspace(auth: AuthContext, workspaceId: string): Promise<Session> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: auth.userId } },
      include: { user: true },
    });
    if (!membership) throw new AppException('NOT_FOUND');
    return this.issue(membership.user, membership.workspaceId, membership.role);
  }

  async updateMe(auth: AuthContext, dto: UpdateMeDto): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const data: { name?: string; uiLocale?: UiLocale; passwordHash?: string; accountMode?: AccountModeRow } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.uiLocale !== undefined) data.uiLocale = dto.uiLocale;
    // onboarding-v2 D9: AGENCY → OWN é permitido mesmo com > 1 membership (nada é apagado; o shell só esconde o seletor)
    if (dto.accountMode !== undefined) data.accountMode = dto.accountMode;
    if (dto.password) {
      if (!(await verifyPassword(dto.password.current, user.passwordHash))) throw new AppException('INVALID_CREDENTIALS');
      data.passwordHash = await hashPassword(dto.password.next);
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data });
    if (data.passwordHash) {
      // Senha nova derruba as outras sessões (a atual renova normalmente no próximo login).
      await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return publicUser(updated);
  }

  // ───────── convites ─────────

  private async findValidInvite(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { id: true, name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
      throw new AppException('INVITE_INVALID');
    }
    return invite;
  }

  async getInvite(token: string) {
    const invite = await this.findValidInvite(token);
    return { workspaceName: invite.workspace.name, email: invite.email, role: invite.role };
  }

  /**
   * Aceitar convite.
   * - e-mail sem conta: exige { name, password } e cria o usuário;
   * - e-mail com conta: aceita se a pessoa está logada com esse e-mail, ou se mandou a senha certa dessa conta.
   */
  async acceptInvite(token: string, dto: AcceptInviteDto, auth?: AuthContext): Promise<Session> {
    const invite = await this.findValidInvite(token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });

    let user: User;
    if (existing) {
      const loggedAsSame = auth?.userId === existing.id;
      const passwordOk = !loggedAsSame && dto.password ? await verifyPassword(dto.password, existing.passwordHash) : false;
      if (!loggedAsSame && !passwordOk) {
        if (auth || dto.password) throw new AppException('INVALID_CREDENTIALS');
        throw new AppException('UNAUTHORIZED');
      }
      if (!existing.isActive) throw new AppException('INVALID_CREDENTIALS');
      user = existing;
    } else {
      const missing = [!dto.name && 'name', !dto.password && 'password'].filter(Boolean) as string[];
      if (missing.length) {
        throw new AppException('VALIDATION_ERROR', { fields: missing.map((field) => ({ field, rule: 'isDefined' })) });
      }
      user = await this.prisma.user.create({
        data: { email: invite.email, name: dto.name!.trim(), passwordHash: await hashPassword(dto.password!) },
      });
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppException('INVITE_INVALID');
      const m = await tx.membership.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
        create: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
        update: {}, // já era membro: mantém o papel atual
      });
      return m.role;
    });

    return this.issue(user, invite.workspaceId, role);
  }

  // ───────── tokens ─────────

  /** Sessão nova no workspace: o `workspace` da resposta vem com status, onboarding (%) e o tourCompletedAt do membership. */
  private async issue(user: User, workspaceId: string, role: MemberRole): Promise<Session> {
    const payload: AccessTokenPayload = { sub: user.id, wid: workspaceId, role };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        workspaceId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.refreshTtlDays * DAY_MS),
      },
    });
    const [ws, membership] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, select: { tourCompletedAt: true } }),
    ]);
    const workspace: WorkspaceRef = { ...workspaceRef(ws, role, await this.onboarding.calcOne(ws)), tourCompletedAt: membership?.tourCompletedAt?.toISOString() ?? null };
    return { accessToken, refreshToken, expiresIn: this.config.jwtAccessTtlSec, user: publicUser(user), workspace };
  }
}

export function publicUser(u: User): PublicUser {
  // amostra-gratis-v1 §1/§2: plano da conta e se a amostra já foi gasta
  return { id: u.id, name: u.name, email: u.email, uiLocale: u.uiLocale, accountMode: u.accountMode ?? null, access: u.access, sampleUsed: !!u.sampleUsedAt };
}

/** Item de `workspaces[]`/`workspace` da sessão (sem tourCompletedAt; quem chama põe no ativo). */
export function workspaceRef(ws: Workspace, role: MemberRole, calc: import('../workspaces/onboarding').OnboardingCalc): WorkspaceRef {
  return { id: ws.id, name: ws.name, role, status: clientStatusOf(ws), onboarding: onboardingSummaryOf(ws, calc) };
}
