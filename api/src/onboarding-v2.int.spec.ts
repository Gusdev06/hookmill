// Onboarding v2 (docs/contratos/onboarding-v2.md, B2) contra a infra LOCAL (maquina_test), integrações em mock.
// accountMode (signup null, PATCH /auth/me, AGENCY → OWN com 2 memberships = 200, D9), sessão/me com status + percent em
// lote, percent por conteúdo (0 % → oferta → business → 100 %), updatedBy após PATCH de outro usuário, 403 por papel,
// tour (stops sem/com WINNER, complete idempotente, CLIENT pode), backfill da migração.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.META_MODE = 'mock';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PREFIX = `ob2-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'admin' | 'member' | 'client';

describe(isLocal ? 'Onboarding v2 (integração local)' : 'Onboarding v2 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string; // cliente em SETUP (owner, admin, member, client)
  let w2: string; // 2º cliente do owner (LIVE)
  let signupWs: string | null = null;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = r.status === 204 ? null : await r.json();
    return { status: r.status, body: json as any };
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
    for (const k of ['owner', 'admin', 'member', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `OB ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    const role = (k: Who): 'OWNER' | 'ADMIN' | 'MEMBER' | 'CLIENT' => (k === 'owner' ? 'OWNER' : k === 'admin' ? 'ADMIN' : k === 'member' ? 'MEMBER' : 'CLIENT');
    w1 = (await prisma.workspace.create({
      data: { name: 'New client', shortCode: 'NC', onboardingStep: 1, memberships: { create: (['owner', 'admin', 'member', 'client'] as Who[]).map((k) => ({ userId: users[k].id, role: role(k) })) } },
    })).id;
    w2 = (await prisma.workspace.create({
      data: { name: `${PREFIX}live`, shortCode: 'LV', onboardingStep: 6, onboardingCompletedAt: new Date(), memberships: { create: { userId: users.owner.id, role: 'OWNER', tourCompletedAt: new Date() } } },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.body.data.accessToken;
    }
  });

  afterAll(async () => {
    const ids = [w1, w2, signupWs].filter((x): x is string => !!x);
    await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('backfill da migração: usuários e memberships anteriores ao onboarding_v2 vêm AGENCY / tour concluído', async () => {
    const [{ users: u, memberships: m }] = await prisma.$queryRaw<{ users: number; memberships: number }[]>`
      select
        (select count(*)::int from users u, _prisma_migrations mg where mg.migration_name = '20261021000100_onboarding_v2'
           and u.created_at < (mg.started_at at time zone 'UTC') and u.account_mode is distinct from 'AGENCY') as users,
        (select count(*)::int from memberships ms, _prisma_migrations mg where mg.migration_name = '20261021000100_onboarding_v2'
           and ms.created_at < (mg.started_at at time zone 'UTC') and ms.tour_completed_at is null) as memberships`;
    expect(u).toBe(0);
    expect(m).toBe(0);
  });

  it('signup: conta nova nasce accountMode null e tourCompletedAt null; sessão traz status SETUP e o % do conteúdo', async () => {
    const r = await call('POST', '/auth/signup', undefined, { name: 'Nova', email: `${PREFIX}nova@teste.local`, password: PASSWORD, agencyName: 'Mooncloth' });
    expect(r.status).toBe(201);
    const s = r.body.data;
    signupWs = s.workspace.id;
    expect(s.user.accountMode).toBeNull();
    // D10: o cadastro grava o teto do env (SIGNUP_DEFAULT_SPEND_CAP_USD), mas o passo goals só entra no % depois que a pessoa passa por ele → 0 %
    expect(s.workspace).toMatchObject({ role: 'OWNER', status: 'SETUP', onboarding: { step: 1, percent: 0, completedAt: null }, tourCompletedAt: null });
    const ws = await call('GET', '/workspace', r.body.data.accessToken);
    expect(ws.body.data.onboarding.percent).toBe(0);
    expect(ws.body.data.onboarding.steps.find((st: any) => st.key === 'goals').state).toBe('done'); // o trilho continua mostrando o teto preenchido
    // signup com accountMode grava
    const r2 = await call('POST', '/auth/signup', undefined, { name: 'Own', email: `${PREFIX}own@teste.local`, password: PASSWORD, accountMode: 'OWN' });
    expect(r2.status).toBe(201);
    expect(r2.body.data.user.accountMode).toBe('OWN');
    await prisma.workspace.delete({ where: { id: r2.body.data.workspace.id } });
  });

  it('PATCH /auth/me { accountMode }: OWN com 2 memberships = 200 (D9); valor fora de AGENCY|OWN = 400; refresh/me devolvem', async () => {
    expect(await prisma.membership.count({ where: { userId: users.owner.id } })).toBe(2);
    const r = await call('PATCH', '/auth/me', users.owner.token, { accountMode: 'OWN' });
    expect(r.status).toBe(200);
    expect(r.body.data.accountMode).toBe('OWN');
    const me = await call('GET', '/auth/me', users.owner.token);
    expect(me.body.data.user.accountMode).toBe('OWN');
    expect(me.body.data.workspaces).toHaveLength(2); // nada some (D9)
    const bad = await call('PATCH', '/auth/me', users.owner.token, { accountMode: 'SOLO' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toContainEqual({ field: 'accountMode', rule: 'isIn' });
    const back = await call('PATCH', '/auth/me', users.owner.token, { accountMode: 'AGENCY' });
    expect(back.body.data.accountMode).toBe('AGENCY');
    // CLIENT também pode (é do próprio usuário)
    expect((await call('PATCH', '/auth/me', users.client.token, { accountMode: 'OWN' })).status).toBe(200);
  });

  it('GET /auth/me: cada workspace com status + onboarding { step, percent, completedAt }; só o ativo com tourCompletedAt', async () => {
    const me = await call('GET', '/auth/me', users.owner.token);
    expect(me.status).toBe(200);
    const { workspace, workspaces } = me.body.data;
    expect(workspace).toMatchObject({ id: w1, status: 'SETUP', onboarding: { step: 1, percent: 0, completedAt: null }, tourCompletedAt: null });
    const live = workspaces.find((w: any) => w.id === w2);
    expect(live).toMatchObject({ status: 'LIVE', onboarding: { step: 6, percent: 100 } });
    expect(live.onboarding.completedAt).toEqual(expect.any(String));
    expect('tourCompletedAt' in live).toBe(false);
    expect('steps' in workspaces.find((w: any) => w.id === w1).onboarding).toBe(false); // lista do seletor: sem steps[]
  });

  it('percent por conteúdo + D10 (só passo done já alcançado): oferta sem avançar → 0 %; business + step 3 → 17 %; step 6 → 67 %; GET /workspaces e GET /workspace batem', async () => {
    const ws0 = await call('GET', '/workspace', users.owner.token);
    expect(ws0.body.data.onboarding).toMatchObject({ percent: 0, updatedBy: null, updatedAt: null });
    expect(ws0.body.data.onboarding.steps.map((s: any) => [s.key, s.state, s.enabled])).toEqual([
      ['business', 'current', true], ['meta', 'todo', true], ['offer', 'todo', true], ['audience', 'todo', true], ['goals', 'todo', true], ['brain', 'todo', true],
    ]);

    const offer = await call('POST', '/offers', users.member.token, { name: 'Sheets', language: 'en', what: 'Bamboo sheets', promise: 'Sleep cooler' });
    expect(offer.status).toBe(201);
    const ws1 = await call('GET', '/workspace', users.owner.token);
    expect(ws1.body.data.onboarding.steps.find((s: any) => s.key === 'offer').state).toBe('done');
    expect(ws1.body.data.onboarding.percent).toBe(0); // done, mas o passo 3 ainda não foi alcançado (onboardingStep 1)
    expect(ws1.body.data.onboarding.updatedBy).toMatchObject({ id: users.member.id, name: 'OB member' }); // oferta em SETUP conta

    const patch = await call('PATCH', '/workspace', users.admin.token, { name: 'Mooncloth', businessType: 'ONLINE_STORE', monthlySpendCapUsd: 25, onboardingStep: 3 });
    expect(patch.status).toBe(200);
    expect(patch.body.data.onboarding).toMatchObject({ step: 3, percent: 17, updatedBy: { id: users.admin.id, initials: 'OA' } }); // business (1 < 3); offer e goals done mas não alcançados
    expect(patch.body.data.onboarding.steps.find((s: any) => s.key === 'goals').state).toBe('done');
    expect(patch.body.data.onboarding.steps.find((s: any) => s.key === 'meta').state).toBe('skipped');
    expect(patch.body.data.onboarding.updatedAt).toEqual(expect.any(String));

    const cards = await call('GET', '/workspaces', users.owner.token);
    const card = cards.body.data.find((c: any) => c.id === w1);
    expect(card.onboarding).toMatchObject({ step: 3, percent: 17, updatedBy: { id: users.admin.id } });
    const me = await call('GET', '/auth/me', users.member.token);
    expect(me.body.data.workspace.onboarding).toEqual({ step: 3, percent: 17, completedAt: null });

    const audience = await call('PATCH', `/offers/${offer.body.data.id}`, users.owner.token, { audience: 'Hot sleepers' });
    expect(audience.status).toBe(200);
    expect((await call('GET', '/workspace', users.owner.token)).body.data.onboarding.percent).toBe(17); // audience done, passo 4 não alcançado
    // Continue até o passo 6: business + offer + audience + goals contam (meta skipped não) = 4 de 6
    const fwd = await call('PATCH', '/workspace', users.owner.token, { onboardingStep: 6 });
    expect(fwd.status).toBe(200);
    expect(fwd.body.data.onboarding.percent).toBe(67);
    expect((await call('GET', '/workspaces', users.owner.token)).body.data.find((c: any) => c.id === w1).onboarding.percent).toBe(67);
    // borda aceita (D10): voltar pelo trilho regrava o step menor e o % cai até avançar de novo
    expect((await call('PATCH', '/workspace', users.owner.token, { onboardingStep: 2 })).body.data.onboarding.percent).toBe(17);
    expect((await call('PATCH', '/workspace', users.owner.token, { onboardingStep: 6 })).body.data.onboarding.percent).toBe(67);
  });

  it('403 por papel: MEMBER e CLIENT não editam o setup; CLIENT não cria oferta', async () => {
    expect((await call('PATCH', '/workspace', users.member.token, { name: 'X' })).status).toBe(403);
    expect((await call('PATCH', '/workspace', users.client.token, { name: 'X' })).status).toBe(403);
    expect((await call('POST', '/workspace/onboarding/complete', users.member.token)).status).toBe(403);
    expect((await call('POST', '/offers', users.client.token, { name: 'Y', language: 'en' })).status).toBe(403);
    // CLIENT lê o setup (tela "Setup in progress")
    const ws = await call('GET', '/workspace', users.client.token);
    expect(ws.status).toBe(200);
    expect(ws.body.data.onboarding.updatedBy).toMatchObject({ id: users.owner.id });
  });

  it('tour: stops sem iterate; complete idempotente; CLIENT completa o dele; com WINNER no snapshot a parada iterate entra', async () => {
    const t0 = await call('GET', '/workspace/tour', users.client.token);
    expect(t0.status).toBe(200);
    expect(t0.body.data).toEqual({ completedAt: null, stops: ['brain', 'concepts', 'eddy', 'home'] });

    const c1 = await call('POST', '/workspace/tour/complete', users.client.token, {});
    expect(c1.status).toBe(200);
    const at = c1.body.data.tourCompletedAt;
    expect(at).toEqual(expect.any(String));
    const c2 = await call('POST', '/workspace/tour/complete', users.client.token, {});
    expect(c2.body.data.tourCompletedAt).toBe(at);
    expect((await call('GET', '/workspace/tour', users.client.token)).body.data.completedAt).toBe(at);
    // por usuário × workspace: o owner continua sem tour neste workspace
    expect((await call('GET', '/workspace/tour', users.owner.token)).body.data.completedAt).toBeNull();
    expect((await call('GET', '/auth/me', users.owner.token)).body.data.workspace.tourCompletedAt).toBeNull();
    // a sessão reflete o tour feito
    const sw = await call('POST', '/auth/switch-workspace', users.client.token, { workspaceId: w1 });
    expect(sw.body.data.workspace.tourCompletedAt).toBe(at);

    const conn = await prisma.metaConnection.create({
      data: { workspaceId: w1, status: 'ACTIVE', metaUserId: 'mock_user', metaUserName: 'Mock', adAccountId: 'act_1', pageId: 'pg_1', connectedById: users.owner.id, tokenCiphertext: 'x' },
    });
    const metrics = { spend: 100, impressions: 1000, clicks: 10, ctr: 1, results: 5, resultType: 'omni_purchase', cpa: 20, roas: null, plays2s: null, hookRate: null, thruplays: null, frequency: null };
    await prisma.metaAdSnapshot.create({
      data: { workspaceId: w1, connectionId: conn.id, adAccountId: 'act_1', metaAdId: 'ad_1', name: 'Ad', effectiveStatus: 'ACTIVE', campaignId: 'c', campaignName: 'C', adsetId: 's', adsetName: 'S', metrics, metrics7d: metrics, metricsPrev7d: metrics, verdict: 'WINNER', syncedAt: new Date() },
    });
    expect((await call('GET', '/workspace/tour', users.owner.token)).body.data.stops).toEqual(['brain', 'iterate', 'concepts', 'eddy', 'home']);
    // conexão com conta e página = passo meta done
    expect((await call('GET', '/workspace', users.owner.token)).body.data.onboarding.steps.find((s: any) => s.key === 'meta').state).toBe('done');
  });

  it('complete: percent 100, status LIVE na sessão/me, updatedBy = quem concluiu', async () => {
    const r = await call('POST', '/workspace/onboarding/complete', users.owner.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'LIVE', onboarding: { step: 6, percent: 100, updatedBy: { id: users.owner.id } } });
    const me = await call('GET', '/auth/me', users.admin.token);
    expect(me.body.data.workspace).toMatchObject({ status: 'LIVE', onboarding: { step: 6, percent: 100 } });
    // uma oferta editada depois de LIVE não muda o updatedBy
    const offers = await call('GET', '/offers', users.admin.token);
    await call('PATCH', `/offers/${offers.body.data[0].id}`, users.admin.token, { pains: 'Night sweats' });
    expect((await call('GET', '/workspace', users.admin.token)).body.data.onboarding.updatedBy.id).toBe(users.owner.id);
  });
});
