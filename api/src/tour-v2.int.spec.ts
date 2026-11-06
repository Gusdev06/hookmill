// tour-v2 (docs/contratos/tour-v2.md) contra a infra LOCAL (maquina_test), integrações e Meta em mock (custo zero):
// GET /workspace/tour?v=2 (paradas por papel e por unlimited, vencedor de vídeo de menor CPA, legado intacto), dicas
// (POST idempotente, DELETE zera, por usuário), POST /events (lote, tetos, sessão manda no workspace/usuário/papel) e o
// helper dos marcos de ativação (só a 1ª vez).
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
import { markActivation } from './workspaces/ativacao';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PREFIX = `tv2-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'member' | 'client' | 'staff';

describe(isLocal ? 'Tour v2 (integração local)' : 'Tour v2 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let wPaid: string; // owner PAID + member + client
  let wStaff: string; // owner INTERNAL (unlimited)

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
    const access: Record<Who, 'PAID' | 'INTERNAL'> = { owner: 'PAID', member: 'PAID', client: 'PAID', staff: 'INTERNAL' };
    for (const k of Object.keys(access) as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { access: access[k], email, name: `TV ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    wPaid = (await prisma.workspace.create({
      data: {
        name: 'Paid co', shortCode: 'PC', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: [{ userId: users.owner.id, role: 'OWNER' }, { userId: users.member.id, role: 'MEMBER' }, { userId: users.client.id, role: 'CLIENT' }] },
      },
    })).id;
    wStaff = (await prisma.workspace.create({
      data: { name: 'Staff co', shortCode: 'SC', onboardingStep: 6, onboardingCompletedAt: new Date(), memberships: { create: { userId: users.staff.id, role: 'OWNER' } } },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.body.data.accessToken;
    }
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [wPaid, wStaff].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('GET ?v=2: OWNER/MEMBER pago = brain, templates, credits; CLIENT = brain, review; unlimited sem credits; v inválido = 400', async () => {
    const empty = { completedAt: null, winnerMetaAdId: null, winnerName: null, tipsSeen: [] };
    expect((await call('GET', '/workspace/tour?v=2', users.owner.token)).body.data).toEqual({ ...empty, stops: ['brain', 'templates', 'credits'] });
    expect((await call('GET', '/workspace/tour?v=2', users.member.token)).body.data.stops).toEqual(['brain', 'templates', 'credits']);
    expect((await call('GET', '/workspace/tour?v=2', users.client.token)).body.data).toEqual({ ...empty, stops: ['brain', 'review'] });
    expect((await call('GET', '/workspace/tour?v=2', users.staff.token)).body.data.stops).toEqual(['brain', 'templates']);
    // legado (sem v): paradas v1 de antes + os aditivos
    expect((await call('GET', '/workspace/tour', users.owner.token)).body.data).toEqual({ ...empty, stops: ['brain', 'concepts', 'eddy', 'home'] });
    expect((await call('GET', '/workspace/tour?v=3', users.owner.token)).status).toBe(400);
  });

  it('vencedor: WINNER de vídeo de menor CPA na conexão ativa (imagem e OK ficam fora); legado ganha iterate', async () => {
    const conn = await prisma.metaConnection.create({
      data: { workspaceId: wPaid, status: 'ACTIVE', metaUserId: 'mock_user', metaUserName: 'Mock', adAccountId: 'act_1', pageId: 'pg_1', connectedById: users.owner.id, tokenCiphertext: 'x' },
    });
    const ad = (metaAdId: string, name: string, cpa: number, verdict: 'WINNER' | 'OK', videoId: string | null) => {
      const metrics = { spend: 100, impressions: 1000, clicks: 10, ctr: 1, results: 5, resultType: 'omni_purchase', cpa, roas: null, plays2s: null, hookRate: null, thruplays: null, frequency: null };
      return prisma.metaAdSnapshot.create({
        data: { workspaceId: wPaid, connectionId: conn.id, adAccountId: 'act_1', metaAdId, name, effectiveStatus: 'ACTIVE', campaignId: 'c', campaignName: 'C', adsetId: 's', adsetName: 'S', videoId, metrics, metrics7d: metrics, metricsPrev7d: metrics, verdict, syncedAt: new Date() },
      });
    };
    await ad('ad_img', 'Image winner', 5, 'WINNER', null);
    await ad('ad_ok', 'Cheap but OK', 1, 'OK', 'v_ok');
    await ad('ad_b', 'Video B', 20, 'WINNER', 'v_b');
    await ad('ad_c', 'Video C', 10, 'WINNER', 'v_c');
    const t = (await call('GET', '/workspace/tour?v=2', users.owner.token)).body.data;
    expect(t).toMatchObject({ stops: ['brain', 'templates', 'credits'], winnerMetaAdId: 'ad_c', winnerName: 'Video C' });
    const legacy = (await call('GET', '/workspace/tour', users.member.token)).body.data;
    expect(legacy).toMatchObject({ stops: ['brain', 'iterate', 'concepts', 'eddy', 'home'], winnerMetaAdId: 'ad_c' });
    // conexão caída = sem vencedor
    await prisma.metaConnection.update({ where: { id: conn.id }, data: { status: 'TOKEN_INVALID' } });
    expect((await call('GET', '/workspace/tour?v=2', users.owner.token)).body.data).toMatchObject({ winnerMetaAdId: null, winnerName: null });
  });

  it('dicas: POST idempotente na ordem vista, chave inválida 400, por usuário, DELETE zera; CLIENT pode', async () => {
    expect((await call('POST', '/workspace/tour/tips', users.owner.token, { tip: 'plan' })).body.data).toEqual({ tipsSeen: ['plan'] });
    const again = await call('POST', '/workspace/tour/tips', users.owner.token, { tip: 'plan' });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ tipsSeen: ['plan'] });
    expect((await call('POST', '/workspace/tour/tips', users.owner.token, { tip: 'library' })).body.data).toEqual({ tipsSeen: ['plan', 'library'] });
    const bad = await call('POST', '/workspace/tour/tips', users.owner.token, { tip: 'eddy' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await call('GET', '/workspace/tour?v=2', users.owner.token)).body.data.tipsSeen).toEqual(['plan', 'library']);
    expect((await call('GET', '/workspace/tour?v=2', users.member.token)).body.data.tipsSeen).toEqual([]);
    expect((await call('POST', '/workspace/tour/tips', users.client.token, { tip: 'send' })).status).toBe(200);
    const reset = await call('DELETE', '/workspace/tour/tips', users.owner.token);
    expect(reset.status).toBe(200);
    expect(reset.body.data).toEqual({ tipsSeen: [] });
    expect((await call('GET', '/workspace/tour?v=2', users.owner.token)).body.data.tipsSeen).toEqual([]);
    // o do client não foi junto
    expect((await call('GET', '/workspace/tour?v=2', users.client.token)).body.data.tipsSeen).toEqual(['send']);
  });

  it('POST /events: 204 em lote, workspace/usuário/papel da sessão, hora inválida = servidor; tetos e nome desconhecido = 400 sem gravar', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const ok = await call('POST', '/events', users.member.token, {
      events: [
        { name: 'tour_stop_viewed', at, props: { stop: 'templates', n: 2, total: 3, workspaceId: 'forjado', variant: { meta: true, winner: true, sample: false } } },
        { name: 'tip_dismissed', at: 'ontem', props: { tip: 'plan', how: 'got_it' } },
        { name: 'tour_started' },
      ],
    });
    expect(ok.status).toBe(204);
    const rows = await prisma.productEvent.findMany({ where: { workspaceId: wPaid }, orderBy: { name: 'asc' } });
    expect(rows.map((r) => [r.name, r.userId, r.role])).toEqual([
      ['tip_dismissed', users.member.id, 'MEMBER'], ['tour_started', users.member.id, 'MEMBER'], ['tour_stop_viewed', users.member.id, 'MEMBER'],
    ]);
    const viewed = rows.find((r) => r.name === 'tour_stop_viewed')!;
    expect(viewed.at.toISOString()).toBe(at);
    expect(viewed.props).toMatchObject({ stop: 'templates', n: 2, workspaceId: 'forjado' }); // só props; a coluna veio da sessão
    expect(Math.abs(rows.find((r) => r.name === 'tip_dismissed')!.at.getTime() - Date.now())).toBeLessThan(60_000);
    expect(rows.find((r) => r.name === 'tour_started')!.props).toEqual({});

    expect((await call('POST', '/events', users.client.token, { events: [{ name: 'tour_completed', props: { msTotal: 1200 } }] })).status).toBe(204);
    const fail = async (body: unknown) => {
      const r = await call('POST', '/events', users.owner.token, body);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    };
    await fail({ events: [{ name: 'page_view' }] });
    await fail({ events: [] });
    await fail({ events: Array.from({ length: 51 }, () => ({ name: 'tip_shown' })) });
    await fail({ events: [{ name: 'tip_shown' }, { name: 'tip_shown', props: { blob: 'x'.repeat(2100) } }] });
    expect(await prisma.productEvent.count({ where: { workspaceId: wPaid } })).toBe(4);
    expect(await prisma.productEvent.count({ where: { workspaceId: wPaid, role: 'CLIENT' } })).toBe(1);
    expect((await call('POST', '/events', undefined, { events: [{ name: 'tip_shown' }] })).status).toBe(401);
  });

  it('marcos de ativação: markActivation grava só na 1ª vez (CAS no null)', async () => {
    const t1 = new Date('2026-11-04T10:00:00.000Z');
    expect(await markActivation(prisma, wStaff, 'firstBatchAt', t1)).toBe(true);
    expect(await markActivation(prisma, wStaff, 'firstBatchAt', new Date())).toBe(false);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wStaff } });
    expect(ws.firstBatchAt).toEqual(t1);
    expect([ws.firstGenerateAt, ws.firstReadyAt, ws.firstSendAt]).toEqual([null, null, null]);
  });
});
