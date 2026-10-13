import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../errors/app-exception';
import { CLIENT_ALLOWED_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './auth-context';
import { AuthGuard, extractBearer } from './auth.guard';

const SECRET = 'test-secret-test-secret-test-secret';
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: 900 } });

function ctx(headers: Record<string, string>, meta: Record<string, unknown> = {}, method = 'GET') {
  const req: Record<string, any> = { headers, method };
  const handler = () => undefined;
  class C {}
  Reflect.defineMetadata(IS_PUBLIC_KEY, meta[IS_PUBLIC_KEY], handler);
  Reflect.defineMetadata(ROLES_KEY, meta[ROLES_KEY], handler);
  Reflect.defineMetadata(CLIENT_ALLOWED_KEY, meta[CLIENT_ALLOWED_KEY], handler);
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => C,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function guardWith(membership: { role: string; user: { isActive: boolean } } | null) {
  const findUnique = jest.fn().mockResolvedValue(membership);
  const prisma = { membership: { findUnique } } as any;
  return { guard: new AuthGuard(new Reflector(), jwt, prisma), findUnique };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppException ? e.code : String(e);
  }
}

describe('AuthGuard (JWT + workspace)', () => {
  const token = () => jwt.signAsync({ sub: 'u1', wid: 'w1', role: 'OWNER' });

  it('sem token: 401 UNAUTHORIZED', async () => {
    const { guard } = guardWith(null);
    expect(await code(guard.canActivate(ctx({}).context))).toBe('UNAUTHORIZED');
  });

  it('token com outra assinatura: 401', async () => {
    const { guard } = guardWith({ role: 'OWNER', user: { isActive: true } });
    const forged = await new JwtService({ secret: 'outro-segredo-qualquer-outro' }).signAsync({ sub: 'u1', wid: 'w1', role: 'OWNER' });
    expect(await code(guard.canActivate(ctx({ authorization: `Bearer ${forged}` }).context))).toBe('UNAUTHORIZED');
  });

  it('token vencido: 401', async () => {
    const { guard } = guardWith({ role: 'OWNER', user: { isActive: true } });
    const old = await jwt.signAsync({ sub: 'u1', wid: 'w1', role: 'OWNER' }, { expiresIn: -10 });
    expect(await code(guard.canActivate(ctx({ authorization: `Bearer ${old}` }).context))).toBe('UNAUTHORIZED');
  });

  it('membro removido do workspace do token perde acesso na hora: 401', async () => {
    const { guard, findUnique } = guardWith(null);
    expect(await code(guard.canActivate(ctx({ authorization: `Bearer ${await token()}` }).context))).toBe('UNAUTHORIZED');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } } }),
    );
  });

  it('usuário desativado: 401', async () => {
    const { guard } = guardWith({ role: 'OWNER', user: { isActive: false } });
    expect(await code(guard.canActivate(ctx({ authorization: `Bearer ${await token()}` }).context))).toBe('UNAUTHORIZED');
  });

  it('ok: preenche req.auth com o workspace do token e o papel do BANCO', async () => {
    const { guard } = guardWith({ role: 'MEMBER', user: { isActive: true } }); // token diz OWNER, banco diz MEMBER
    const { context, req } = ctx({ authorization: `Bearer ${await token()}` });
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.auth).toEqual({ userId: 'u1', workspaceId: 'w1', role: 'MEMBER' });
  });

  it('@Roles: papel fora da lista = 403 FORBIDDEN', async () => {
    const { guard } = guardWith({ role: 'MEMBER', user: { isActive: true } });
    const { context } = ctx({ authorization: `Bearer ${await token()}` }, { [ROLES_KEY]: ['OWNER', 'ADMIN'] });
    expect(await code(guard.canActivate(context))).toBe('FORBIDDEN');
  });

  it('@Public sem token passa; com token válido também preenche req.auth', async () => {
    const { guard } = guardWith({ role: 'ADMIN', user: { isActive: true } });
    expect(await guard.canActivate(ctx({}, { [IS_PUBLIC_KEY]: true }).context)).toBe(true);
    const { context, req } = ctx({ authorization: `Bearer ${await token()}` }, { [IS_PUBLIC_KEY]: true });
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.auth.role).toBe('ADMIN');
  });

  it('@Public com token inválido segue anônimo (não derruba a rota pública)', async () => {
    const { guard } = guardWith(null);
    const { context, req } = ctx({ authorization: 'Bearer lixo' }, { [IS_PUBLIC_KEY]: true });
    expect(await guard.canActivate(context)).toBe(true);
    expect(req.auth).toBeUndefined();
  });

  it('extractBearer', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer abc')).toBe('abc');
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });

  describe('papel CLIENT (fase2-agencia.md §4): só lê, a menos que a rota tenha @ClientAllowed()', () => {
    const run = async (method: string, meta: Record<string, unknown> = {}, role = 'CLIENT') => {
      const { guard } = guardWith({ role, user: { isActive: true } });
      return code(guard.canActivate(ctx({ authorization: `Bearer ${await token()}` }, meta, method).context));
    };
    it('GET e HEAD passam', async () => {
      expect(await run('GET')).toBe('OK');
      expect(await run('HEAD')).toBe('OK');
    });
    it('POST/PATCH/PUT/DELETE sem decorator: 403 FORBIDDEN', async () => {
      for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(await run(m)).toBe('FORBIDDEN');
    });
    it('com @ClientAllowed() passa', async () => {
      expect(await run('POST', { [CLIENT_ALLOWED_KEY]: true })).toBe('OK');
      expect(await run('PUT', { [CLIENT_ALLOWED_KEY]: true })).toBe('OK');
    });
    it('@ClientAllowed() não fura o @Roles', async () => {
      expect(await run('POST', { [CLIENT_ALLOWED_KEY]: true, [ROLES_KEY]: ['OWNER', 'ADMIN'] })).toBe('FORBIDDEN');
    });
    it('MEMBER não é afetado pela regra', async () => {
      expect(await run('POST', {}, 'MEMBER')).toBe('OK');
    });
  });
});
