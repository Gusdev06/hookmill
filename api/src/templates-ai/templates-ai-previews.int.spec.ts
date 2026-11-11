// templates-ia-previas-v1 (B1/B2) de ponta a ponta contra o banco local de teste desta frente (maquina_previas_test),
// planejador semantic-v2 em mock (I1), rostos/TTS/lipsync em mock, render fake: nenhum gasto externo.
// /use com previews → 4 prévias (5 candidatas, 1 inválida) → aprovação incremental (1 + depois mais 1) → MP4 por peça;
// idempotência e conflito das 4 rotas, aprovação concorrente, tetos 3/6 e retry 2, PLAN_FAILED, CLIENT 403, outro workspace 404.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.META_CRON = 'off';
process.env.BOOT_RECOVERY = 'off';
process.env.RENDER_IMPL = 'fake';
process.env.AI_TEMPLATES_ENABLED = 'on';
process.env.AI_PREVIEWS = 'on';
process.env.PUBLIC_API_URL = 'http://127.0.0.1:3290';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import type { AiPreviewsView, SemanticPlanV2 } from '@maquina/contratos';
import { AppModule } from '../app.module';
import { configureApp } from '../main';
import { bancoDeTesteAtivo } from '../common/testing/ambiente-teste';
import { CreditosService } from '../creditos/creditos.service';
import { SEMANTIC_PLANNER, type SemanticPlannerPort } from '../integracoes/claude/semantic-planner';
import { JobsService } from '../jobs/jobs.service';
import { RecuperacaoService } from '../recuperacao/recuperacao.service';
import { AiPreviewsService } from './previews.service';
import { TemplatesAiService } from './templates-ai.service';

jest.setTimeout(240000);
type Fx = { token: string; ws: string; championId: string; userId: string };
type R = { status: number; success?: boolean; data?: any; error?: { code: string; details?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('Templates IA com prévias: 4 prévias grátis → aprovar → só as aprovadas viram vídeo', () => {
  const db = new PrismaClient();
  let app: NestExpressApplication;
  const users: string[] = [], workspaces: string[] = [];
  let paid: Fx, other: Fx, internal: Fx, few: Fx, clientToken: string;
  let saved: { id: string; credits: number | null; status: 'DRAFT' | 'LIVE' | 'HIDDEN'; uses: number };
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<R> => {
    const res = await fetch(`http://127.0.0.1:3290/api/v1${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, ...await res.json() };
  };
  const use = (who: Fx, slug = 'podcast-solo', requestId = randomUUID()) => call('POST', `/ad-templates/${slug}/use`, who.token, { championId: who.championId, previews: { requestId } });
  const ai = async (id: string, who: Fx): Promise<AiPreviewsView> => (await call('GET', `/iterate/${id}`, who.token)).data.ai;
  /** Avança (o sweep fica desligado nos specs) até `done(view)` ou estoura. */
  const until = async (id: string, who: Fx, done: (v: AiPreviewsView, b: any) => boolean, label: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const limit = Date.now() + 150000;
    while (Date.now() < limit) {
      await app.get(TemplatesAiService).advance(id);
      await app.get(CreditosService).settleAll(who.ws);
      const b = (await call('GET', `/iterate/${id}`, who.token)).data;
      if (b?.ai && done(b.ai, b)) return b;
      await new Promise((ok) => setTimeout(ok, 250));
    }
    throw new Error(`timeout (${label}): ${JSON.stringify((await call('GET', `/iterate/${id}`, who.token)).data?.ai)}`);
  };
  const ready = (id: string, who: Fx) => until(id, who, (v) => v.phase === 'previews_ready' && v.generating === 0, 'prévias');

  beforeAll(async () => {
    expect((await db.$queryRaw<{ name: string }[]>`SELECT current_database() as name`)[0].name).toBe(bancoDeTesteAtivo());
    saved = await db.template.findUniqueOrThrow({ where: { slug: 'podcast-solo' }, select: { id: true, credits: true, status: true, uses: true } });
    await db.template.update({ where: { id: saved.id }, data: { credits: 5, status: 'LIVE' } });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
    configureApp(app); await app.listen(3290, '127.0.0.1');
    const fixture = async (access: 'INTERNAL' | 'PAID', what = 'An app that organizes weekly meals and shopping lists.') => {
      const u = await db.user.create({ data: { email: `ai-previews-${randomUUID()}@teste.local`, name: 'AI previews QA', passwordHash: 'test-only', access, accountMode: 'OWN' } }); users.push(u.id);
      const w = await db.workspace.create({ data: { name: 'AI previews QA', shortCode: 'AP', memberships: { create: { userId: u.id, role: 'OWNER' } } } }); workspaces.push(w.id);
      const o = await db.offer.create({ data: { workspaceId: w.id, name: 'Meal planner', language: 'en', what, cta: 'Visit the website and see the demonstration.', audience: 'People planning their meals for the week.', createdById: u.id } });
      const c = await db.champion.create({ data: { workspaceId: w.id, offerId: o.id, name: 'Winning talking head', status: 'READY', durationSec: 30, createdById: u.id,
        teardown: { create: { workspaceId: w.id, sections: { identification: { status: 'pending' }, whySells: { status: 'pending' } }, transcript: { language: 'en', words: [{ word: 'Organize', startSec: 0, endSec: 1 }] } } } } });
      await db.$transaction((tx) => app.get(CreditosService).post(tx, { userId: u.id, workspaceId: w.id, pool: 'CREDITS', kind: 'GRANT', amount: 50, delta: 50, key: randomUUID() }));
      return { token: app.get(JwtService).sign({ sub: u.id, wid: w.id, role: 'OWNER' }), ws: w.id, championId: c.id, userId: u.id };
    };
    paid = await fixture('PAID'); other = await fixture('PAID'); internal = await fixture('INTERNAL');
    few = await fixture('INTERNAL', 'An app that organizes weekly meals and shopping lists. [mock:plan-few]');
    const client = await db.user.create({ data: { email: `ai-previews-client-${randomUUID()}@teste.local`, name: 'Client', passwordHash: 'test-only' } }); users.push(client.id);
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

  it('/use: previews no lugar de generation; 202 PLANNING; idempotente; conflito de chave; sem reserva', async () => {
    const legacy = await call('POST', '/ad-templates/podcast-solo/use', paid.token, { championId: paid.championId, generation: { requestId: randomUUID(), expectedCredits: 5 } });
    expect([legacy.status, legacy.error?.code, legacy.error?.details?.fields?.[0]]).toEqual([400, 'VALIDATION_ERROR', { field: 'generation', rule: 'notAllowed' }]);
    const missing = await call('POST', '/ad-templates/podcast-solo/use', paid.token, { championId: paid.championId });
    expect([missing.status, missing.error?.details?.fields?.[0]?.field]).toEqual([400, 'previews']);
    const key = randomUUID();
    const a = await use(paid, 'podcast-solo', key);
    expect([a.status, a.error]).toEqual([202, undefined]);
    expect(a.data.status).toBe('PLANNING');
    expect(a.data.ai).toMatchObject({ phase: 'planning', format: 'F09', prices: { videoEach: 5 } }); // previews [] até o planejador (o mock responde na hora)
    const again = await use(paid, 'podcast-solo', key);
    expect([again.status, again.data.id]).toEqual([202, a.data.id]);
    const conflict = await call('POST', '/ad-templates/podcast-solo/use', paid.token, { championId: other.championId, previews: { requestId: key } }); // mesma chave, outra fonte
    expect([conflict.status, conflict.error?.code, conflict.error?.details?.reason]).toEqual([409, 'INVALID_STATE', 'request_conflict']);
    expect(await db.creditEntry.count({ where: { userId: paid.userId, kind: 'RESERVE' } })).toBe(0);
    await app.get(JobsService).idle();
    const b = await ready(a.data.id, paid);
    // 5 candidatas do mock, a 2ª inválida: guarda 4, cada uma com apresentador próprio e voz no gênero do rosto, sem repetir
    expect(b.ai.previews.map((p: { letter: string }) => p.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(b.ai.previews.every((p: { status: string; cast: { image: unknown }[] }) => p.status === 'ready' && p.cast.length === 1 && p.cast[0].image)).toBe(true);
    expect(new Set(b.ai.previews.map((p: { title: string }) => p.title)).size).toBe(4);
    expect(new Set(b.ai.previews.map((p: { cast: { voiceId: string }[] }) => p.cast[0].voiceId)).size).toBe(4);
    expect(b.status).toBe('PLAN_READY');
    expect(b.pieces).toEqual([]); // prévias não são peças
    expect(b.ai).toMatchObject({ approvable: 4, generating: 0, approvals: [] });
    expect(await db.creative.count({ where: { variationBatchId: a.data.id } })).toBe(0); // criativo só nasce na aprovação
  });

  it('aprovação incremental (1 e depois mais 1), idempotente, concorrente e com reserva por aprovação; só as aprovadas viram MP4', async () => {
    const a = await use(paid);
    await app.get(JobsService).idle();
    const b = await ready(a.data.id, paid);
    const [p1, p2, p3] = b.ai.previews.map((p: { id: string }) => p.id);
    const route = `/iterate/${a.data.id}/ai-previews/approve`;
    const k1 = randomUUID();
    expect((await call('POST', route, clientToken, { requestId: k1, previewIds: [p1], expectedCredits: 5 })).status).toBe(403);
    expect((await call('POST', route, other.token, { requestId: k1, previewIds: [p1], expectedCredits: 5 })).status).toBe(404);
    const changed = await call('POST', route, paid.token, { requestId: k1, previewIds: [p1], expectedCredits: 0 });
    expect([changed.status, changed.error?.code, changed.error?.details]).toEqual([409, 'CREDITS_CHANGED', { credits: 5 }]);
    // clique duplo com a mesma chave = 1 reserva
    const [x, y] = await Promise.all([call('POST', route, paid.token, { requestId: k1, previewIds: [p1], expectedCredits: 5 }), call('POST', route, paid.token, { requestId: k1, previewIds: [p1], expectedCredits: 5 })]);
    expect([x.status, y.status]).toEqual([202, 202]);
    expect(x.data.status).toBe('LAUNCHED');
    const otherBody = await call('POST', route, paid.token, { requestId: k1, previewIds: [p2], expectedCredits: 5 });
    expect([otherBody.status, otherBody.error?.details?.reason]).toEqual([409, 'request_conflict']);
    const again = await call('POST', route, paid.token, { requestId: randomUUID(), previewIds: [p1], expectedCredits: 5 });
    expect([again.status, again.error?.details?.reason, again.error?.details?.previewIds]).toEqual([409, 'preview_not_ready', [p1]]);
    // duas abas, chaves diferentes, mesma prévia: uma passa, a outra 409 preview_not_ready
    const tabs = await Promise.all([randomUUID(), randomUUID()].map((k) => call('POST', route, paid.token, { requestId: k, previewIds: [p2], expectedCredits: 5 })));
    expect(tabs.map((t) => t.status).sort()).toEqual([202, 409]);
    expect(tabs.find((t) => t.status === 409)!.error?.details?.reason).toBe('preview_not_ready');
    expect(await db.creditEntry.count({ where: { userId: paid.userId, kind: 'RESERVE' } })).toBe(2);
    const run = await db.templateRun.findUniqueOrThrow({ where: { batchId: a.data.id } });
    expect([run.status, run.held, run.attempt, (run.lines as unknown[]).length]).toEqual(['RESERVED', 10, 2, 2]);
    const done = await until(a.data.id, paid, (v) => v.phase === 'done', 'vídeos');
    expect(done.pieces.map((p: { id: string }) => p.id).sort()).toEqual([p1, p2].sort());
    expect(done.pieces.every((p: { status: string; files: { mimeType: string }[] }) => p.status === 'ready' && p.files[0]?.mimeType === 'video/mp4')).toBe(true);
    expect(done.ai.previews.filter((p: { status: string }) => p.status === 'approved').map((p: { pieceId: string }) => p.pieceId).sort()).toEqual([p1, p2].sort());
    expect(done.ai).toMatchObject({ approvable: 2 }); // "Make them too"
    expect(done.ai.approvals).toHaveLength(2);
    // a imagem aprovada é o quadro do lipsync: as cenas apontam pro rosto da prévia, sem rosto novo
    const item = await db.variationItem.findUniqueOrThrow({ where: { id: p1 }, include: { creative: true } });
    const faceId = (item.payload as { preview: { cast: { faceId: string }[] } }).preview.cast[0].faceId;
    const scenes = await db.scene.findMany({ where: { creativeId: item.creative!.id } });
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    expect(scenes.every((s) => s.faceId === faceId)).toBe(true);
    await app.get(CreditosService).settleAll(paid.ws);
    const settled = await db.templateRun.findUniqueOrThrow({ where: { batchId: a.data.id } });
    expect([settled.status, settled.charged, settled.refunded]).toEqual(['SETTLED', 10, 0]);
    // volta depois e aprova a 3ª (P4): run SETTLED → RESERVED de novo, só a linha nova fica held
    const late = await call('POST', route, paid.token, { requestId: randomUUID(), previewIds: [p3], expectedCredits: 5 });
    expect(late.status).toBe(202);
    const reopened = await db.templateRun.findUniqueOrThrow({ where: { batchId: a.data.id } });
    expect([reopened.status, reopened.held, (reopened.lines as { state: string }[]).map((l) => l.state)]).toEqual(['RESERVED', 5, ['charged', 'charged', 'held']]);
  });

  it('Novo ângulo: troca ideia e apresentador, grátis, teto 3 por prévia e 6 por lote, idempotente', async () => {
    const a = await use(internal, 'podcast-conversation');
    await app.get(JobsService).idle();
    const b = await ready(a.data.id, internal);
    expect(b.ai.previews.every((p: { cast: unknown[] }) => p.cast.length === 2)).toBe(true); // F10: dupla
    const [p1, p2, p3] = b.ai.previews.map((p: { id: string }) => p.id);
    const before = b.ai.previews[0];
    const regen = (id: string, key = randomUUID()) => call('POST', `/iterate/${a.data.id}/ai-previews/${id}/regenerate`, internal.token, { requestId: key });
    const k = randomUUID();
    const r1 = await regen(p1, k);
    expect([r1.status, r1.data.status, r1.data.regenerations]).toEqual([202, 'planned', { used: 1, max: 3 }]);
    expect((await regen(p1, k)).data.regenerations.used).toBe(1); // mesma chave não conta de novo
    const busy = await regen(p1);
    expect(busy.status).toBe(409); // planned ou imaging (o mock responde na hora): só READY regenera
    expect(['planned', 'imaging']).toContain(busy.error?.details?.state);
    await app.get(JobsService).idle();
    let v = (await until(a.data.id, internal, (x) => x.previews[0].status === 'ready', 'novo ângulo')).ai as AiPreviewsView;
    expect(v.previews[0].title).not.toBe(before.title);
    expect(v.previews[0].cast.map((c) => c.name)).not.toEqual(before.cast.map((c: { name: string }) => c.name));
    expect(v.phase).toBe('previews_ready');
    for (let n = 2; n <= 3; n++) { expect((await regen(p1)).status).toBe(202); await app.get(JobsService).idle(); await until(a.data.id, internal, (x) => x.previews[0].status === 'ready', `regen ${n}`); }
    const capped = await regen(p1);
    expect([capped.status, capped.error?.code, capped.error?.details]).toEqual([429, 'REGEN_LIMIT', { scope: 'preview', used: 3, max: 3 }]);
    for (const id of [p2, p2, p3]) { expect((await regen(id)).status).toBe(202); await app.get(JobsService).idle(); await until(a.data.id, internal, (x) => x.previews.every((p) => p.status === 'ready'), 'regen lote'); }
    const batchCap = await regen(p3);
    expect([batchCap.status, batchCap.error?.details]).toEqual([429, { scope: 'batch', used: 6, max: 6 }]);
    v = await ai(a.data.id, internal);
    expect(v.limits).toMatchObject({ regenUsed: 6, regenPerBatch: 6 });
    expect(await db.creditEntry.count({ where: { userId: internal.userId } })).toBe(1); // só o GRANT: prévias grátis
  });

  it('Try again: prévia que falhou (imagem) volta a gerar com o mesmo apresentador, fora do teto, máx. 2', async () => {
    const a = await use(internal, 'ai-faq');
    await app.get(JobsService).idle();
    const b = await ready(a.data.id, internal);
    const target = b.ai.previews[0];
    // simula imagem FAILED (nsfw/provedor) direto no rosto da prévia
    const item = await db.variationItem.findUniqueOrThrow({ where: { id: target.id } });
    const faceId = (item.payload as { preview: { cast: { faceId: string }[] } }).preview.cast[0].faceId;
    await db.variationItem.update({ where: { id: target.id }, data: { previewStatus: 'IMAGING' } });
    await db.face.update({ where: { id: faceId }, data: { status: 'FAILED', errorCode: 'SAFETY_BLOCK' } });
    const failed = (await until(a.data.id, internal, (x) => x.previews[0].status === 'failed', 'falha')).ai.previews[0];
    expect(failed).toMatchObject({ failStage: 'imaging', action: 'retry', errorCode: 'SAFETY_BLOCK', failureCode: 'image_blocked' });
    expect((await call('POST', `/iterate/${a.data.id}/ai-previews/${b.ai.previews[1].id}/retry`, internal.token, { requestId: randomUUID() })).status).toBe(409);
    const r = await call('POST', `/iterate/${a.data.id}/ai-previews/${target.id}/retry`, internal.token, { requestId: randomUUID() });
    expect([r.status, r.data.status, r.data.retries, r.data.regenerations.used]).toEqual([202, 'imaging', { used: 1, max: 2 }, 0]);
    const back = (await until(a.data.id, internal, (x) => x.previews[0].status === 'ready', 'retry')).ai.previews[0];
    expect(back.title).toBe(target.title);
    expect(back.cast[0].name).toBe(target.cast[0].name);
    expect(back.cast[0].image.fileId).not.toBe(target.cast[0].image.fileId); // rosto novo (seed nova)
  });

  it('planejador com < 2 produzíveis = PLAN_FAILED; approve recusado; reinício não repete chamada do planejador', async () => {
    const a = await use(few, 'podcast-solo');
    await app.get(JobsService).idle();
    const b = await until(a.data.id, few, (v) => v.phase === 'failed', 'plan-few');
    expect(b.status).toBe('PLAN_FAILED');
    expect(b.ai).toMatchObject({ errorCode: 'PROVIDER_ERROR', previews: [], failureCode: 'too_few_previews' });
    const r = await call('POST', `/iterate/${a.data.id}/ai-previews/approve`, few.token, { requestId: randomUUID(), previewIds: ['x'], expectedCredits: 0 });
    expect([r.status, r.error?.details?.state]).toEqual([409, 'PLAN_FAILED']);
    // reinício com o planejador inicial RUNNING: job INTERRUPTED, lote PLAN_FAILED, nenhuma 2ª chamada
    const planner = app.get<SemanticPlannerPort>(SEMANTIC_PLANNER);
    let release!: (v: SemanticPlanV2) => void;
    const spy = jest.spyOn(planner, 'planPreviews').mockImplementationOnce(() => new Promise((ok) => { release = ok; }));
    const c = await use(internal, 'podcast-solo');
    await new Promise((ok) => setTimeout(ok, 150));
    try {
      await app.get(RecuperacaoService).recover({ workspaceId: internal.ws });
      await app.get(TemplatesAiService).advance(c.data.id);
      expect(spy).toHaveBeenCalledTimes(1);
      const v = await ai(c.data.id, internal);
      expect([v.phase, v.errorCode, (v as unknown as { failureCode: string }).failureCode]).toEqual(['failed', 'INTERRUPTED', 'planning_interrupted']);
    } finally { release({ version: 'semantic-v2', language: 'en', uiLocale: 'en', facts: [], variations: [], generationMode: 'mock', costUsd: 0 }); spy.mockRestore(); }
    await app.get(JobsService).idle();
    expect((await call('GET', `/iterate/${c.data.id}`, internal.token)).data.status).toBe('PLAN_FAILED');
    // ALTO-1 (QA 07/11): reinício com o job inicial QUEUED (nenhuma chamada feita) pelo caminho REAL do /use: o job nasce
    // com kind 'ai_previews', a retomada o deixa QUEUED e o sweep dispara → lote chega a PLAN_READY. Job QUEUED de outro
    // tipo segue virando INTERRUPTED como antes.
    const detach = jest.spyOn(app.get(JobsService), 'detach').mockImplementationOnce(async () => undefined); // o processo "morre" antes do kick
    const d = await use(internal, 'podcast-solo');
    detach.mockRestore();
    const real = await db.job.findFirstOrThrow({ where: { variationBatchId: d.data.id, type: 'AUTO_PLAN' } });
    expect([real.status, (real.input as { kind?: string }).kind]).toEqual(['QUEUED', 'ai_previews']);
    const other = await db.job.create({ data: { workspaceId: internal.ws, createdById: internal.userId, type: 'AUTO_PLAN', status: 'QUEUED', input: { batchId: d.data.id } } });
    try {
      await app.get(RecuperacaoService).recover({ workspaceId: internal.ws });
      expect((await db.job.findUniqueOrThrow({ where: { id: real.id } })).status).toBe('QUEUED');
      expect((await db.job.findUniqueOrThrow({ where: { id: other.id } })).errorCode).toBe('INTERRUPTED');
    } finally { await db.job.deleteMany({ where: { id: other.id } }); }
    const resumed = await ready(d.data.id, internal);
    expect([resumed.status, resumed.ai.previews.length]).toEqual(['PLAN_READY', 4]);
    expect((await db.job.findUniqueOrThrow({ where: { id: real.id } })).status).toBe('SUCCEEDED');
  });

  it('AI_PREVIEWS=off: rotas novas dão 404 e lote de prévias não aceita Generate nem desmarcar', async () => {
    const a = await use(internal, 'podcast-solo');
    await app.get(JobsService).idle();
    const b = await ready(a.data.id, internal);
    const start = await call('POST', `/iterate/${a.data.id}/start`, internal.token, { expectedPieces: 1, expectedCredits: 0 });
    expect(start.status).toBe(409);
    const sel = await call('PATCH', `/iterate/${a.data.id}/items/${b.ai.previews[0].id}`, internal.token, { included: true });
    expect(sel.status).toBe(409);
    process.env.AI_PREVIEWS = 'off';
    try {
      const r = await call('POST', `/iterate/${a.data.id}/ai-previews/approve`, internal.token, { requestId: randomUUID(), previewIds: [b.ai.previews[0].id], expectedCredits: 0 });
      expect(r.status).toBe(404);
    } finally { process.env.AI_PREVIEWS = 'on'; }
    expect(app.get(AiPreviewsService)).toBeDefined();
  });
});
