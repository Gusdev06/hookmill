import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.META_CRON = 'off';
process.env.BOOT_RECOVERY = 'off';
process.env.AI_VARIATIONS_ENABLED = 'on';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../app.module';
import { configureApp } from '../main';
import { JobsService } from '../jobs/jobs.service';
import { SEMANTIC_PLANNER } from '../integracoes/claude/semantic-planner';
import { MockSemanticPlanner } from '../integracoes/mock/semantic-planner';
import type { SemanticContext } from './contexto';

jest.setTimeout(120000);
describe('variação IA: HTTP + PostgreSQL, integração mock sem gasto', () => {
  const db = new PrismaClient();
  const planner = new MockSemanticPlanner();
  const plan = jest.spyOn(planner, 'plan');
  const estimate = jest.spyOn(planner, 'estimate');
  let app: NestExpressApplication, base: string;
  const users: string[] = [], workspaces: string[] = [];
  let a: { token: string; workspaceId: string; championId: string; offerId: string }, b: typeof a, clientToken: string;
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, ...await r.json() };
  };
  const body = () => ({ championId: a.championId, requestId: randomUUID(), focus: 'AUTO', instructions: 'Transformar a explicação em novos formatos.', formatIds: ['F02', 'F04', 'F10'] });
  const idle = () => app.get(JobsService).idle();
  beforeAll(async () => {
    const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`;
    expect(name).toBe('maquina_test');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEMANTIC_PLANNER).useValue(planner).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureApp(app); await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;
    async function fixture(name: string) {
      const u = await db.user.create({ data: { email: `semantic-${randomUUID()}@teste.local`, name, passwordHash: 'test-only', access: 'INTERNAL' } }); users.push(u.id);
      const w = await db.workspace.create({ data: { name, shortCode: 'AI', memberships: { create: { userId: u.id, role: 'OWNER' } } } }); workspaces.push(w.id);
      const o = await db.offer.create({ data: { workspaceId: w.id, name: 'Planejador de refeições', language: 'pt-BR', what: 'Aplicativo que organiza refeições e lista de compras.', cta: 'Veja a demonstração.', audience: 'Pessoas que planejam as refeições da semana.', createdById: u.id } });
      const c = await db.champion.create({ data: { workspaceId: w.id, offerId: o.id, name: 'Talking head', status: 'READY', rights: 'OWN', createdById: u.id, teardown: { create: { workspaceId: w.id, sections: {}, transcript: { language: 'pt-BR', words: [{ word: 'Organize', startSec: 0, endSec: 1 }] } } } } });
      return { token: app.get(JwtService).sign({ sub: u.id, wid: w.id, role: 'OWNER' }), workspaceId: w.id, offerId: o.id, championId: c.id };
    }
    a = await fixture('Semantic A'); b = await fixture('Semantic B');
    const client = await db.user.create({ data: { email: `semantic-client-${randomUUID()}@teste.local`, name: 'Client', passwordHash: 'test-only' } }); users.push(client.id);
    await db.membership.create({ data: { userId: client.id, workspaceId: a.workspaceId, role: 'CLIENT' } });
    clientToken = app.get(JwtService).sign({ sub: client.id, wid: a.workspaceId, role: 'CLIENT' });
  });
  afterAll(async () => {
    if (app) { await idle(); await app.close(); }
    // Somente os IDs criados por este spec.
    if (workspaces.length) await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
    if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  beforeEach(() => { plan.mockClear(); estimate.mockReturnValue(0); });

  it('salva, retoma e exporta três hipóteses; pedido duplicado não gera novamente', async () => {
    const req = body();
    const r = await call('POST', '/ai-variations', a.token, req);
    expect(r.status).toBe(202); await idle();
    const saved = await call('GET', `/ai-variations/${r.data.id}`, a.token);
    expect(saved.data.status).toBe('SUCCEEDED');
    expect(saved.data.plan.variations).toHaveLength(3);
    expect(saved.data.plan).toMatchObject({ generationMode: 'mock', mediaGenerated: false, costUsd: 0 });
    const again = await call('POST', '/ai-variations', a.token, { ...req });
    expect(again.data.id).toBe(r.data.id); expect(plan).toHaveBeenCalledTimes(1);
    expect((await call('POST', '/ai-variations', a.token, { ...req, instructions: 'Outro pedido' })).status).toBe(409);
    expect((await call('GET', `/ai-variations/${r.data.id}`, b.token)).status).toBe(404);
    expect((await call('GET', '/ai-variations', b.token)).data).toEqual([]);
    expect(await db.variationBatch.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
    expect(await db.providerTask.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
  });
  it('bloqueia outra conta, CLIENT, entradas inválidas e fonte não pronta antes da chamada', async () => {
    expect((await call('POST', '/ai-variations', b.token, body())).status).toBe(404);
    expect((await call('POST', '/ai-variations', clientToken, body())).status).toBe(403);
    expect((await call('POST', '/ai-variations', undefined, body())).status).toBe(401);
    expect((await call('POST', '/ai-variations', a.token, { ...body(), formatIds: ['F10', 'F10'] })).status).toBe(400);
    expect((await call('POST', '/ai-variations', a.token, { ...body(), workspaceId: b.workspaceId })).status).toBe(400);
    await db.champion.update({ where: { id: a.championId }, data: { status: 'ANALYZING' } });
    expect((await call('POST', '/ai-variations', a.token, body())).status).toBe(409);
    await db.champion.update({ where: { id: a.championId }, data: { status: 'READY' } });
    expect(plan).not.toHaveBeenCalled();
  });
  it('respeita oferta incompleta, teto e exclusão comercial de SAMPLE', async () => {
    await db.offer.update({ where: { id: a.offerId }, data: { cta: null } });
    expect((await call('POST', '/ai-variations', a.token, body())).status).toBe(422);
    await db.offer.update({ where: { id: a.offerId }, data: { cta: 'Veja a demonstração.' } });
    await db.workspace.update({ where: { id: a.workspaceId }, data: { monthlySpendCapUsd: 0 } }); estimate.mockReturnValue(0.5);
    expect((await call('POST', '/ai-variations', a.token, body())).error.code).toBe('SPEND_CAP_EXCEEDED');
    await db.workspace.update({ where: { id: a.workspaceId }, data: { monthlySpendCapUsd: null } });
    await db.user.update({ where: { id: users[0] }, data: { access: 'SAMPLE' } });
    expect((await call('GET', '/ai-variations/config', a.token)).data.reason).toBe('access_required');
    expect((await call('POST', '/ai-variations', a.token, body())).status).toBe(403);
    await db.user.update({ where: { id: users[0] }, data: { access: 'INTERNAL' } });
    expect(plan).not.toHaveBeenCalled();
  });
  it('dois pedidos concorrentes não abrem duas chamadas; falha fica salva', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    plan.mockImplementationOnce(async (_ctx: SemanticContext) => { await gate; throw new Error('fixture failure'); });
    const req = body();
    const [one, two] = await Promise.all([call('POST', '/ai-variations', a.token, req), call('POST', '/ai-variations', a.token, req)]);
    expect(one.status).toBe(202); expect(two.data.id).toBe(one.data.id);
    expect((await call('POST', '/ai-variations', a.token, body())).status).toBe(409);
    release(); await idle();
    const failed = await call('GET', `/ai-variations/${one.data.id}`, a.token);
    expect(failed.data).toMatchObject({ status: 'FAILED', plan: null, errorCode: 'PROVIDER_ERROR' });
    expect(plan).toHaveBeenCalledTimes(1);
  });
});
