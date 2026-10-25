import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { hashPassword, sha256 } from '../common/util/crypto';
import { AuthService } from './auth.service';

const config = { refreshTtlDays: 30, jwtAccessTtlSec: 900 } as any;
/** OnboardingService falso: o cálculo real é testado em workspaces/onboarding.spec.ts. */
const onboarding = {
  calcOne: jest.fn().mockResolvedValue({ steps: [], percent: 0 }),
  calcMany: jest.fn().mockImplementation(async (ws: { id: string }[]) => new Map(ws.map((w) => [w.id, { steps: [], percent: 0 }]))),
} as any;
/** Linha de workspace como o banco devolve (a sessão lê status/onboarding dela). */
const wsRow = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, onboardingStep: 1, onboardingCompletedAt: null, pausedAt: null, businessType: null, monthlySpendCapUsd: null, onboardingUpdatedAt: null, ...over,
});
const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret', signOptions: { expiresIn: 900 } });

const user = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'u1', email: 'gusta@exemplo.com', name: 'Gusta', uiLocale: 'EN', isActive: true, passwordHash: '', ...over,
});

function makePrisma() {
  return {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), create: jest.fn(), findUniqueOrThrow: jest.fn() },
    workspace: { findUniqueOrThrow: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(wsRow(where.id, 'WS'))), create: jest.fn() },
    membership: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    refreshToken: { create: jest.fn().mockResolvedValue({}), findUnique: jest.fn(), updateMany: jest.fn() },
    invite: { findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppException ? e.code : String(e);
  }
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AuthService;
  let pwHash: string;

  beforeAll(async () => {
    pwHash = await hashPassword('senha-certa-123');
  });
  beforeEach(() => {
    prisma = makePrisma();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    svc = new AuthService(prisma, jwt, config, onboarding);
  });

  describe('login', () => {
    it('e-mail normalizado, senha certa: access com sub/wid/role + refresh salvo só como hash', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ passwordHash: pwHash }));
      prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER', workspaceId: 'w1' });
      const s = await svc.login('  GUSTA@Exemplo.com ', 'senha-certa-123');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'gusta@exemplo.com' } });
      const payload = await jwt.verifyAsync(s.accessToken);
      expect(payload).toMatchObject({ sub: 'u1', wid: 'w1', role: 'OWNER' });
      expect(s.expiresIn).toBe(900);
      expect(s.workspace).toEqual({ id: 'w1', name: 'WS', role: 'OWNER', status: 'SETUP', onboarding: { step: 1, percent: 0, completedAt: null }, tourCompletedAt: null });
      expect(s.user.accountMode).toBeNull();
      const saved = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(saved.tokenHash).toBe(sha256(s.refreshToken));
      expect(JSON.stringify(saved)).not.toContain(s.refreshToken);
      expect((s.user as any).passwordHash).toBeUndefined();
    });

    it('senha errada / e-mail inexistente / usuário inativo: INVALID_CREDENTIALS', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user({ passwordHash: pwHash }));
      expect(await code(svc.login('gusta@exemplo.com', 'errada'))).toBe('INVALID_CREDENTIALS');
      prisma.user.findUnique.mockResolvedValueOnce(null);
      expect(await code(svc.login('ninguem@x.com', 'qualquer'))).toBe('INVALID_CREDENTIALS');
      prisma.user.findUnique.mockResolvedValueOnce(user({ passwordHash: pwHash, isActive: false }));
      expect(await code(svc.login('gusta@exemplo.com', 'senha-certa-123'))).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('refresh rotativo', () => {
    const row = (over = {}) => ({ id: 'r1', userId: 'u1', workspaceId: 'w1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), ...over });

    it('gira: revoga o antigo com compare-and-set e devolve um par novo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(row());
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.membership.findUnique.mockResolvedValue({ role: 'ADMIN', workspaceId: 'w1', user: user(), tourCompletedAt: new Date('2026-10-01T00:00:00Z') });
      const s = await svc.refresh('token-antigo-xxxxxxxxxxxxxxxx');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('token-antigo-xxxxxxxxxxxxxxxx') } });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { id: 'r1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
      expect(s.refreshToken).not.toBe('token-antigo-xxxxxxxxxxxxxxxx');
      expect(s.workspace.role).toBe('ADMIN');
      expect(s.workspace.tourCompletedAt).toBe('2026-10-01T00:00:00.000Z');
    });

    it('duas requisições com o mesmo token: só uma ganha (a outra REFRESH_INVALID)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(row());
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      prisma.membership.findUnique.mockResolvedValue({ role: 'OWNER', workspaceId: 'w1', user: user() });
      const [a, b] = await Promise.all([code(svc.refresh('t'.repeat(30))), code(svc.refresh('t'.repeat(30)))]);
      expect([a, b].sort()).toEqual(['OK', 'REFRESH_INVALID']);
    });

    it('revogado, vencido, inexistente ou membro removido: REFRESH_INVALID', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(row({ revokedAt: new Date() }));
      expect(await code(svc.refresh('x'.repeat(30)))).toBe('REFRESH_INVALID');
      prisma.refreshToken.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date(Date.now() - 1) }));
      expect(await code(svc.refresh('x'.repeat(30)))).toBe('REFRESH_INVALID');
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      expect(await code(svc.refresh('x'.repeat(30)))).toBe('REFRESH_INVALID');
      prisma.refreshToken.findUnique.mockResolvedValueOnce(row());
      prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.membership.findUnique.mockResolvedValueOnce(null);
      expect(await code(svc.refresh('x'.repeat(30)))).toBe('REFRESH_INVALID');
    });
  });

  describe('switch-workspace', () => {
    it('workspace do qual não é membro: NOT_FOUND (não vaza existência)', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      expect(await code(svc.switchWorkspace({ userId: 'u1', workspaceId: 'w1', role: 'OWNER' }, 'w-alheio'))).toBe('NOT_FOUND');
    });
  });

  describe('convites', () => {
    const invite = (over = {}) => ({
      id: 'i1', workspaceId: 'w1', email: 'novo@x.com', role: 'MEMBER', acceptedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 1e6), workspace: { id: 'w1', name: 'WS' }, ...over,
    });

    it('expirado, revogado ou usado: INVITE_INVALID', async () => {
      for (const over of [{ expiresAt: new Date(Date.now() - 1) }, { revokedAt: new Date() }, { acceptedAt: new Date() }]) {
        prisma.invite.findUnique.mockResolvedValueOnce(invite(over));
        expect(await code(svc.getInvite('tok'))).toBe('INVITE_INVALID');
      }
    });

    it('e-mail novo: cria usuário, consome o convite (CAS) e entra no workspace com o papel do convite', async () => {
      prisma.invite.findUnique.mockResolvedValue(invite());
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve(user({ id: 'u2', ...data })));
      prisma.invite.updateMany.mockResolvedValue({ count: 1 });
      prisma.membership.upsert.mockResolvedValue({ role: 'MEMBER' });
      const s = await svc.acceptInvite('tok', { name: 'Novo', password: 'senha-nova-123' });
      expect(s.workspace).toMatchObject({ id: 'w1', name: 'WS', role: 'MEMBER', status: 'SETUP' });
      expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toMatch(/^scrypt\$/);
    });

    it('e-mail novo sem nome/senha: VALIDATION_ERROR', async () => {
      prisma.invite.findUnique.mockResolvedValue(invite());
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await code(svc.acceptInvite('tok', {}))).toBe('VALIDATION_ERROR');
    });

    it('e-mail com conta: sem login e sem senha = UNAUTHORIZED; logado como OUTRO usuário = INVALID_CREDENTIALS', async () => {
      prisma.invite.findUnique.mockResolvedValue(invite());
      prisma.user.findUnique.mockResolvedValue(user({ id: 'u9', email: 'novo@x.com', passwordHash: pwHash }));
      expect(await code(svc.acceptInvite('tok', {}))).toBe('UNAUTHORIZED');
      expect(await code(svc.acceptInvite('tok', {}, { userId: 'outro', workspaceId: 'w5', role: 'OWNER' }))).toBe('INVALID_CREDENTIALS');
    });

    it('corrida: convite consumido entre a leitura e o aceite = INVITE_INVALID', async () => {
      prisma.invite.findUnique.mockResolvedValue(invite());
      prisma.user.findUnique.mockResolvedValue(user({ id: 'u9', email: 'novo@x.com' }));
      prisma.invite.updateMany.mockResolvedValue({ count: 0 });
      expect(await code(svc.acceptInvite('tok', {}, { userId: 'u9', workspaceId: 'w5', role: 'OWNER' }))).toBe('INVITE_INVALID');
    });
  });

  describe('signup (fase2-cadastro.md)', () => {
    const body = { name: ' Ana ', email: ' Ana@Agencia.com ', password: 'senha-nova-1234', agencyName: 'Mattress Company' };
    const make = (over: Record<string, unknown> = {}) =>
      new AuthService(prisma, jwt, { ...config, signupEnabled: true, signupDefaultSpendCapUsd: 10, ...over }, onboarding);
    beforeEach(() => {
      prisma.workspace.create = jest.fn().mockResolvedValue({ id: 'w9', name: 'Mattress Company' });
      prisma.workspace.findUniqueOrThrow.mockImplementation(({ where }: any) => Promise.resolve(wsRow(where.id, 'Mattress Company')));
      prisma.membership.create = jest.fn().mockResolvedValue({});
      prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve(user({ id: 'u9', ...data })));
    });

    it('cria User → Workspace (SETUP, passo 1, shortCode, teto) → OWNER numa transação e devolve sessão', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const s = await make().signup(body as any);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'ana@agencia.com', name: 'Ana', uiLocale: 'EN', isActive: true });
      expect(prisma.workspace.create.mock.calls[0][0].data).toMatchObject({
        name: 'Mattress Company', shortCode: 'MC', onboardingStep: 1, onboardingCompletedAt: null, pausedAt: null, monthlySpendCapUsd: 10,
      });
      expect(prisma.membership.create.mock.calls[0][0].data).toEqual({ workspaceId: 'w9', userId: 'u9', role: 'OWNER' });
      expect(s.workspace).toMatchObject({ id: 'w9', name: 'Mattress Company', role: 'OWNER', status: 'SETUP', onboarding: { step: 1, percent: 0, completedAt: null }, tourCompletedAt: null });
      expect(prisma.user.create.mock.calls[0][0].data.accountMode).toBeNull(); // conta nova nasce sem resposta (D2)
      expect(await jwt.verifyAsync(s.accessToken)).toMatchObject({ sub: 'u9', wid: 'w9', role: 'OWNER' });
    });

    it('sem agencyName = "New client" (NC); uiLocale vai pro usuário e pro cliente', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await make().signup({ ...body, agencyName: undefined, uiLocale: 'PT_BR' } as any);
      expect(prisma.workspace.create.mock.calls[0][0].data).toMatchObject({ name: 'New client', shortCode: 'NC', uiLocale: 'PT_BR' });
      expect(prisma.user.create.mock.calls[0][0].data.uiLocale).toBe('PT_BR');
    });

    it('SIGNUP_ENABLED=false → FORBIDDEN sem tocar no banco', async () => {
      expect(await code(make({ signupEnabled: false }).signup(body as any))).toBe('FORBIDDEN');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('e-mail existente (normalizado) → EMAIL_TAKEN com a mensagem fixa, sem criar nada', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      const err = await make().signup(body as any).catch((e) => e);
      expect(err).toBeInstanceOf(AppException);
      expect(err.code).toBe('EMAIL_TAKEN');
      expect(err.body().message).toBe('An account with this email already exists. Log in instead.');
      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ email: 'ana@agencia.com' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('corrida no unique do e-mail (P2002) → EMAIL_TAKEN', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      expect(await code(make().signup(body as any))).toBe('EMAIL_TAKEN');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });
});
