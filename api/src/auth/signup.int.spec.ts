// Fase 2 · cadastro self-serve (docs/contratos/fase2-cadastro.md, B3) contra a infra LOCAL (maquina_test), integrações em mock.
// POST /auth/signup: sessão OWNER + 1º cliente em SETUP; e-mail repetido; senha curta; cadastro fechado; throttle; login depois.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.SIGNUP_ENABLED = 'true';
process.env.SIGNUP_DEFAULT_SPEND_CAP_USD = '10';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../app.module';
import { AppConfig } from '../config/app-config';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PREFIX = `signup-${RUN}-`;
const PASSWORD = 'senha-teste-1234';

describe(isLocal ? 'Cadastro self-serve (integração local)' : 'Cadastro [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const email = `${PREFIX}ana@teste.local`;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = r.status === 204 ? null : await r.json();
    return { status: r.status, body: json as any };
  };
  const counts = async () => ({
    users: await prisma.user.count({ where: { email: { startsWith: PREFIX } } }),
    workspaces: await prisma.workspace.count({ where: { memberships: { some: { user: { email: { startsWith: PREFIX } } } } } }),
  });

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;
  });

  afterAll(async () => {
    const where = { memberships: { some: { user: { email: { startsWith: PREFIX } } } } };
    await prisma.workspace.deleteMany({ where });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('201: sessão OWNER; GET /workspace vem SETUP, passo 1, shortCode da agência e teto do env', async () => {
    const r = await call('POST', '/auth/signup', undefined, {
      name: '  Ana Teste ', email: `  ${email.toUpperCase()} `, password: PASSWORD, agencyName: 'Mattress Company', uiLocale: 'PT_BR',
    });
    expect(r.status).toBe(201);
    const s = r.body.data;
    expect(s).toMatchObject({ user: { email, name: 'Ana Teste', uiLocale: 'PT_BR' }, workspace: { name: 'Mattress Company', role: 'OWNER' } });
    expect(typeof s.accessToken).toBe('string');
    expect(typeof s.refreshToken).toBe('string');
    expect(s.expiresIn).toBeGreaterThan(0);
    expect(s.user.passwordHash).toBeUndefined();

    const ws = await call('GET', '/workspace', s.accessToken);
    expect(ws.status).toBe(200);
    expect(ws.body.data).toMatchObject({
      id: s.workspace.id, name: 'Mattress Company', shortCode: 'MC', uiLocale: 'PT_BR', status: 'SETUP',
      monthlySpendCapUsd: 10, onboarding: { step: 1, completedAt: null },
    });
    expect(await prisma.membership.count({ where: { userId: s.user.id } })).toBe(1);
  });

  it('sem agencyName: cliente "New client" (NC), idioma EN', async () => {
    const r = await call('POST', '/auth/signup', undefined, { name: 'Bia', email: `${PREFIX}bia@teste.local`, password: PASSWORD });
    expect(r.status).toBe(201);
    const ws = await call('GET', '/workspace', r.body.data.accessToken);
    expect(ws.body.data).toMatchObject({ name: 'New client', shortCode: 'NC', uiLocale: 'EN', status: 'SETUP', onboarding: { step: 1 } });
  });

  it('e-mail repetido (maiúscula/espaço) → 409 EMAIL_TAKEN com mensagem fixa, sem criar nada', async () => {
    const before = await counts();
    for (const e of [email, `  ${email.toUpperCase()}  `]) {
      const r = await call('POST', '/auth/signup', undefined, { name: 'Outra', email: e, password: PASSWORD, agencyName: 'Outra' });
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Log in instead.' });
    }
    expect(await counts()).toEqual(before);
  });

  it('senha de 9 → 400 VALIDATION_ERROR no campo password', async () => {
    const r = await call('POST', '/auth/signup', undefined, { name: 'Cris', email: `${PREFIX}cris@teste.local`, password: '123456789' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.fields).toContainEqual({ field: 'password', rule: 'minLength' });
    expect(await prisma.user.count({ where: { email: `${PREFIX}cris@teste.local` } })).toBe(0);
  });

  it('SIGNUP_ENABLED=false → 403 FORBIDDEN', async () => {
    const config = app.get(AppConfig);
    Object.defineProperty(config, 'signupEnabled', { get: () => false, configurable: true });
    try {
      const r = await call('POST', '/auth/signup', undefined, { name: 'Duda', email: `${PREFIX}duda@teste.local`, password: PASSWORD });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FORBIDDEN');
      expect(await prisma.user.count({ where: { email: `${PREFIX}duda@teste.local` } })).toBe(0);
    } finally {
      delete (config as any).signupEnabled;
    }
    expect(app.get(AppConfig).signupEnabled).toBe(true);
  });

  it('throttle do login: 6ª tentativa no mesmo minuto (IP + e-mail) → 429 RATE_LIMITED', async () => {
    const body = { name: 'Edu', email: `${PREFIX}edu@teste.local`, password: 'curta' };
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/signup', undefined, body)).status).toBe(400);
    const r = await call('POST', '/auth/signup', undefined, body);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });

  it('login com a conta nova funciona e cai no 1º cliente como OWNER', async () => {
    const r = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.data.workspace).toMatchObject({ name: 'Mattress Company', role: 'OWNER' });
  });
});
