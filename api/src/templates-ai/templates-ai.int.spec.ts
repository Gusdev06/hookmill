import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.META_CRON = 'off';
process.env.BOOT_RECOVERY = 'off';
process.env.RENDER_IMPL = process.env.AI_TEMPLATE_TEST_RENDER === 'local' ? 'local' : 'fake';
process.env.AI_TEMPLATES_ENABLED = 'on';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:3289';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../app.module';
import { configureApp } from '../main';
import { JobsService } from '../jobs/jobs.service';
import { CreditosService } from '../creditos/creditos.service';
import { SEMANTIC_PLANNER } from '../integracoes/claude/semantic-planner';
import { MockSemanticPlanner } from '../integracoes/mock/semantic-planner';
import { TemplatesAiService } from './templates-ai.service';
import { RecuperacaoService } from '../recuperacao/recuperacao.service';

jest.setTimeout(180000);
describe('Templates IA: HTTP → plano interno → vozes/rostos → MP4, sem gasto externo', () => {
  const db = new PrismaClient();
  const planner = new MockSemanticPlanner();
  const plan = jest.spyOn(planner, 'plan');
  let app: NestExpressApplication;
  const users: string[] = [], workspaces: string[] = [];
  let paid: { token: string; ws: string; championId: string; userId: string }, other: typeof paid, internal: typeof paid;
  let clientToken: string;
  let saved: { id: string; credits: number | null; status: 'DRAFT' | 'LIVE' | 'HIDDEN'; uses: number };
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:3289/api/v1${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, ...await res.json() };
  };
  const request = () => ({ championId: paid.championId, generation: { requestId: randomUUID(), expectedCredits: 5 } });
  const post = (body: unknown, token = paid.token) => call('POST', '/ad-templates/podcast-conversation/use', token, body);
  const settle = async (id: string, who = paid) => {
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      await app.get(TemplatesAiService).advance(id);
      await app.get(CreditosService).settleAll(who.ws);
      const r = await call('GET', `/iterate/${id}`, who.token);
      if (r.data?.template?.status === 'SETTLED') return r.data;
      await new Promise((done) => setTimeout(done, 300));
    }
    throw new Error(`pipeline timeout: ${JSON.stringify(await call('GET', `/iterate/${id}`, who.token))}`);
  };
  beforeAll(async () => {
    expect((await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name).toBe('maquina_test');
    saved = await db.template.findUniqueOrThrow({ where: { slug: 'podcast-conversation' }, select: { id: true, credits: true, status: true, uses: true } });
    await db.template.update({ where: { id: saved.id }, data: { credits: 5, status: 'LIVE' } });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SEMANTIC_PLANNER).useValue(planner).compile();
    app = mod.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureApp(app); await app.listen(3289, '127.0.0.1');
    const fixture = async (access: 'INTERNAL' | 'PAID') => {
      const u = await db.user.create({ data: { email: `ai-template-${randomUUID()}@teste.local`, name: 'AI template QA', passwordHash: 'test-only', access, accountMode: 'OWN' } }); users.push(u.id);
      const w = await db.workspace.create({ data: { name: 'AI templates QA', shortCode: 'AI', memberships: { create: { userId: u.id, role: 'OWNER' } } } }); workspaces.push(w.id);
      const o = await db.offer.create({ data: { workspaceId: w.id, name: 'Meal planner', language: 'en', what: 'An app that organizes weekly meals and shopping lists.', cta: 'Visit the website and see the demonstration.', audience: 'People planning their meals for the week.', createdById: u.id } });
      const c = await db.champion.create({ data: { workspaceId: w.id, offerId: o.id, name: 'Winning talking head', status: 'READY', durationSec: 30, createdById: u.id,
        teardown: { create: { workspaceId: w.id, sections: { identification: { status: 'pending' }, whySells: { status: 'pending' } }, transcript: { language: 'en', words: [{ word: 'Organize', startSec: 0, endSec: 1 }] } } } } });
      await db.$transaction((tx) => app.get(CreditosService).post(tx, { userId: u.id, workspaceId: w.id, pool: 'CREDITS', kind: 'GRANT', amount: 50, delta: 50, key: randomUUID() }));
      return { token: app.get(JwtService).sign({ sub: u.id, wid: w.id, role: 'OWNER' }), ws: w.id, championId: c.id, userId: u.id };
    };
    paid = await fixture('PAID'); other = await fixture('PAID'); internal = await fixture('INTERNAL');
    const client = await db.user.create({ data: { email: `ai-template-client-${randomUUID()}@teste.local`, name: 'Client', passwordHash: 'test-only' } }); users.push(client.id);
    await db.membership.create({ data: { userId: client.id, workspaceId: paid.ws, role: 'CLIENT' } });
    clientToken = app.get(JwtService).sign({ sub: client.id, wid: paid.ws, role: 'CLIENT' });
  });
  afterAll(async () => {
    if (app) { await app.get(JobsService).idle(); await app.close(); }
    if (workspaces.length) {
      await db.creative.updateMany({ where: { workspaceId: { in: workspaces } }, data: { finalRenderId: null, selectedFaceId: null } });
      await db.render.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.creative.deleteMany({ where: { workspaceId: { in: workspaces } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
    }
    if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
    if (saved) await db.template.update({ where: { id: saved.id }, data: { credits: saved.credits, status: saved.status, uses: saved.uses } });
    await db.$disconnect();
  });
  beforeEach(() => plan.mockClear());

  it('catálogo liga os três formatos para equipe e só o publicado/preçado para cliente', async () => {
    const team = await call('GET', '/ad-templates', internal.token);
    expect(team.status).toBe(200);
    expect(team.data.items.filter((x: { autoGenerate: boolean }) => x.autoGenerate)).toHaveLength(3);
    const customer = await call('GET', '/ad-templates', paid.token);
    expect(customer.data.items.filter((x: { autoGenerate: boolean }) => x.autoGenerate)).toHaveLength(1);
    expect(customer.data.items.find((x: { slug: string }) => x.slug === 'podcast-conversation')).toMatchObject({ available: true, outputs: 1 });
  });

  it('bloqueia origem alheia, cliente readonly, preço alterado e clique sem autorização antes de cobrar', async () => {
    expect((await post(request(), other.token)).status).toBe(404);
    expect((await post(request(), clientToken)).status).toBe(403);
    expect((await post({ championId: paid.championId })).status).toBe(400);
    expect((await post({ ...request(), generation: { requestId: randomUUID(), expectedCredits: 4 } })).error.code).toBe('CREDITS_CHANGED');
    expect(await db.creditEntry.count({ where: { userId: paid.userId, kind: 'RESERVE' } })).toBe(0);
    expect(plan).not.toHaveBeenCalled();
  });

  it('duplo clique gera uma produção com dois rostos/vozes e entrega MP4 sem PLAN_READY', async () => {
    const body = request();
    const [a, b] = await Promise.all([post(body), post(body)]);
    expect([a.status, a.error, b.status, b.error]).toEqual([202, undefined, 202, undefined]);
    expect(a.data.id).toBe(b.data.id);
    await app.get(JobsService).idle();
    expect(plan).toHaveBeenCalledTimes(1);
    expect((await post(body)).data.id).toBe(a.data.id);
    expect((await post({ ...body, championId: other.championId })).error.details.reason).toBe('idempotency_conflict');
    expect((await call('GET', `/iterate/${a.data.id}`, other.token)).status).toBe(404);
    const result = await settle(a.data.id);
    expect(result).toMatchObject({ status: 'LAUNCHED', phase: 'download', template: { status: 'SETTLED', charged: 5, refunded: 0, autoGenerate: true, productionStage: 'done' } });
    expect(result.pieces[0].status).toBe('ready');
    const scenes = await db.scene.findMany({ where: { creativeId: result.pieces[0].creativeId }, orderBy: { index: 'asc' } });
    expect(scenes).toHaveLength(4);
    expect(scenes.map((s) => s.voiceId)).toEqual(['Casual_Guy', 'Calm_Woman', 'Casual_Guy', 'Calm_Woman']);
    expect(new Set(scenes.map((s) => s.faceId)).size).toBe(2);
    expect(scenes[0].faceId).toBe(scenes[2].faceId);
    expect(scenes.every((s) => s.status === 'READY' && s.clipFileId && s.words)).toBe(true);
    const tasks = await db.providerTask.findMany({ where: { sceneId: { in: scenes.map((s) => s.id) } } });
    expect(tasks.filter((t) => t.kind === 'TTS')).toHaveLength(4);
    expect(tasks.filter((t) => t.kind === 'LIPSYNC')).toHaveLength(4);
    const bytes = Buffer.from(await (await fetch(result.pieces[0].files[0].url)).arrayBuffer());
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    const dir = resolve(process.cwd(), '../reports/templates-ia-background-2026-11-04');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, 'pipeline-mock.mp4'), bytes);
    const render = await db.render.findFirstOrThrow({ where: { creativeId: result.pieces[0].creativeId, status: 'READY' } });
    await writeFile(resolve(dir, 'verification.json'), JSON.stringify({ mode: 'mock', paidProviderSpend: 0, batchId: a.data.id, sceneCount: scenes.length, voices: scenes.map((s) => s.voiceId), bytes: bytes.length, renderInput: render.input }, null, 2));
    expect(await db.creditEntry.count({ where: { userId: paid.userId, kind: 'RESERVE' } })).toBe(1);
  });

  it('falha de planejamento estorna uma vez; retry explícito produz um vídeo', async () => {
    plan.mockRejectedValueOnce(new Error('provider unavailable'));
    const r = await post(request());
    await app.get(JobsService).idle();
    const failed = await settle(r.data.id);
    expect(failed.template).toMatchObject({ charged: 0, refunded: 5 });
    expect(failed.pieces[0].status).toBe('failed');
    const before = await db.creditEntry.count({ where: { userId: paid.userId, kind: 'REFUND' } });
    await app.get(TemplatesAiService).advance(r.data.id);
    expect(await db.creditEntry.count({ where: { userId: paid.userId, kind: 'REFUND' } })).toBe(before);
    const retry = await call('POST', `/iterate/pieces/${failed.pieces[0].id}/retry`, paid.token, {});
    expect([retry.status, retry.error]).toEqual([202, undefined]);
    await app.get(JobsService).idle();
    expect((await settle(r.data.id)).pieces[0].status).toBe('ready');
  });

  it('reinício não repete uma chamada paga de planejamento com resultado desconhecido', async () => {
    let release!: (v: never) => void;
    plan.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const r = await post(request());
    await new Promise((done) => setTimeout(done, 100));
    try {
      await app.get(RecuperacaoService).recover({ workspaceId: paid.ws });
      await app.get(TemplatesAiService).advance(r.data.id);
      expect(plan).toHaveBeenCalledTimes(1);
    } finally { release(null as never); }
    await app.get(JobsService).idle();
    const result = await settle(r.data.id);
    expect(result.pieces[0].status).toBe('failed');
    expect(result.template.refunded).toBe(5);
  });

  it.each(['ai-faq', 'podcast-solo'])('%s entrega vídeo com uma única pessoa e voz', async (slug) => {
    const r = await call('POST', `/ad-templates/${slug}/use`, internal.token, { championId: internal.championId, generation: { requestId: randomUUID(), expectedCredits: 0 } });
    expect([r.status, r.error]).toEqual([202, undefined]);
    await app.get(JobsService).idle();
    const result = await settle(r.data.id, internal);
    expect(result.pieces[0].status).toBe('ready');
    const scenes = await db.scene.findMany({ where: { creativeId: result.pieces[0].creativeId } });
    expect(scenes).toHaveLength(3);
    expect(new Set(scenes.map((s) => s.faceId)).size).toBe(1);
    expect(new Set(scenes.map((s) => s.voiceId)).size).toBe(1);
    expect(result.pieces[0].files[0].mimeType).toBe('video/mp4');
  });
});
