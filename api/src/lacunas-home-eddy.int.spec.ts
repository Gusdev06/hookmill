// lacunas-home-eddy-v1 (31/10) contra a infra LOCAL (maquina_test), integrações em mock: PATCH /workspace { confirm }
// (idempotente, OWNER/ADMIN, vale com onboarding concluído, sai no GET /workspace e no GET /auth/me), GET /iterate
// (lista, etapa, needsYou, cursor, CLIENT lê) e o nó `batch` no GET /brain/graph.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.META_MODE = 'off';
process.env.META_CRON = 'off';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PREFIX = `lhe-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'member' | 'client';

describe(isLocal ? 'Lacunas Home/Eddy (integração local)' : 'Lacunas Home/Eddy [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let wid: string;
  let offerId: string;
  let champ: string;
  const batches: string[] = [];

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: (r.status === 204 ? null : await r.json()) as any };
  };

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;
    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'member', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { access: 'INTERNAL', email, name: `LHE ${k}`, passwordHash: hash, accountMode: 'OWN' } });
      users[k] = { id: u.id, email, token: '' };
    }
    wid = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}ws`, shortCode: 'LH', onboardingStep: 1,
        memberships: { create: [{ userId: users.owner.id, role: 'OWNER' }, { userId: users.member.id, role: 'MEMBER' }, { userId: users.client.id, role: 'CLIENT' }] },
      },
    })).id;
    offerId = (await prisma.offer.create({ data: { workspaceId: wid, name: 'Offer', language: 'en', createdById: users.owner.id } })).id;
    champ = (await prisma.champion.create({
      data: { workspaceId: wid, offerId, name: 'Winner ad', status: 'READY', metaAdId: 'ad_lhe_1', createdById: users.owner.id },
    })).id;
    const mk = (status: 'PLAN_READY' | 'PLANNING', at: Date) => prisma.variationBatch.create({
      data: { workspaceId: wid, championId: champ, offerId, status, mode: 'AUTO', language: 'en', requests: [], createdById: users.owner.id, createdAt: at },
    });
    batches.push((await mk('PLANNING', new Date(Date.now() - 60_000))).id);
    batches.push((await mk('PLAN_READY', new Date())).id);
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.body.data.accessToken;
    }
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: wid } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app?.close();
  });

  it('PATCH /workspace { confirm }: idempotente, na ordem, no GET /workspace e no GET /auth/me; % não muda', async () => {
    const before = await call('GET', '/workspace', users.owner.token);
    expect(before.body.data.onboarding.confirmed).toEqual([]);
    const a = await call('PATCH', '/workspace', users.owner.token, { confirm: 'business' });
    expect(a.status).toBe(200);
    expect(a.body.data.onboarding.confirmed).toEqual(['business']);
    expect(a.body.data.onboarding.percent).toBe(before.body.data.onboarding.percent);
    await call('PATCH', '/workspace', users.owner.token, { confirm: 'meta', onboardingStep: 3 });
    const again = await call('PATCH', '/workspace', users.owner.token, { confirm: 'business' });
    expect(again.body.data.onboarding.confirmed).toEqual(['business', 'meta']);
    expect(again.body.data.onboarding.step).toBe(3);
    const me = await call('GET', '/auth/me', users.owner.token);
    expect(me.body.data.workspace.onboarding.confirmed).toEqual(['business', 'meta']);
  });

  it('confirm inválido = 400; MEMBER/CLIENT = 403; com onboarding concluído continua valendo', async () => {
    expect((await call('PATCH', '/workspace', users.owner.token, { confirm: 'nope' })).status).toBe(400);
    expect((await call('PATCH', '/workspace', users.member.token, { confirm: 'kit' })).status).toBe(403);
    expect((await call('PATCH', '/workspace', users.client.token, { confirm: 'kit' })).status).toBe(403);
    await prisma.workspace.update({ where: { id: wid }, data: { onboardingCompletedAt: new Date(), onboardingStep: 6 } });
    const r = await call('PATCH', '/workspace', users.owner.token, { confirm: 'kit' });
    expect(r.status).toBe(200);
    expect(r.body.data.onboarding.confirmed).toEqual(['business', 'meta', 'kit']);
  });

  it('GET /iterate: lista por updatedAt desc com etapa, needsYou, origem e cursor; CLIENT lê', async () => {
    const r = await call('GET', '/iterate?limit=1', users.client.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({
      id: batches[1], mode: 'AUTO', stage: 'plan_ready', needsYou: true, statusKey: 'status.batch_plan_ready', statusParams: {},
      champion: { id: champ, name: 'Winner ad' }, offer: { id: offerId, name: 'Offer' }, source: { metaAdId: 'ad_lhe_1', creativeId: null }, pieces: 0, ready: 0,
    });
    expect(r.body.meta.nextCursor).toEqual(expect.any(String));
    const p2 = await call('GET', `/iterate?limit=1&cursor=${encodeURIComponent(r.body.meta.nextCursor)}`, users.owner.token);
    expect(p2.body.data.map((x: { id: string; stage: string }) => [x.id, x.stage])).toEqual([[batches[0], 'planning']]);
    expect(p2.body.meta.nextCursor).toBeNull();
    expect((await call('GET', '/iterate?limit=0', users.owner.token)).status).toBe(400);
    expect((await call('GET', '/iterate?mode=MANUAL', users.owner.token)).body.data).toEqual([]);
  });

  it('GET /brain/graph: lote vira nó `batch` ligado à oferta, com needsYou; drawer abre `batch`', async () => {
    const g = await call('GET', '/brain/graph?fresh=1', users.owner.token);
    expect(g.status).toBe(200);
    const node = g.body.data.nodes.find((n: { id: string }) => n.id === `batch:${batches[1]}`);
    expect(node).toMatchObject({ kind: 'batch', category: 'creatives', needsYou: true, statusLabel: { key: 'status.batch_plan_ready' } });
    expect(g.body.data.edges).toEqual(expect.arrayContaining([{ from: `batch:${batches[1]}`, to: `offer:${offerId}`, kind: 'for_offer' }]));
    const d = await call('GET', `/brain/node/${encodeURIComponent(`batch:${batches[1]}`)}`, users.client.token);
    expect(d.status).toBe(200);
    expect(d.body.data.open).toEqual({ route: 'batch', id: batches[1] });
  });
});
