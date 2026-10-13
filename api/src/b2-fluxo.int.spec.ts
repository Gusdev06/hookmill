// Fluxo B2 de ponta a ponta contra a infra LOCAL (Postgres 5433 + S3 9000), integrações em mock (custo zero)
// e render fake (ffmpeg). Oferta → roteiros → rostos (com falha forçada) → motor → geração → render → aprovar →
// biblioteca, mais extração 403, cena com falha, SSE e a retomada no boot. Pula se o banco não for localhost.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off'; // outro processo de teste pode estar usando o mesmo banco
const PORT = 3197; // fixa: a mídia do mock é baixada de PUBLIC_API_URL
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { configureApp } from './main';
import { RecuperacaoService } from './recuperacao/recuperacao.service';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);
const RUN = `b2-${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';

describe(isLocal ? 'B2 fluxo (integração local)' : 'B2 fluxo [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  let base: string;
  let token: string;
  let wsId: string;
  const prisma = new PrismaClient();

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as any;
    return { status: r.status, data: json?.data, error: json?.error, meta: json?.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
      v = await fn();
    }
    if (!ok(v)) throw new Error(`timeout: ${JSON.stringify(v).slice(0, 400)}`);
    return v;
  };
  const stateOf = async (id: string) => (await call('GET', `/creatives/${id}`)).data?.state as string;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT);
    base = `http://127.0.0.1:${PORT}`;
    const email = `${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { email, name: 'B2 Fluxo', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: RUN, shortCode: 'TS', monthlySpendCapUsd: 200, memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    wsId = w.id;
    const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = ((await r.json()) as any).data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    if (wsId) {
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { email: `${RUN}@teste.local` } });
    }
    await prisma.$disconnect();
  });

  it('extração: URL com mock-403 → job FAILED PAGE_FORBIDDEN, action paste_page_text; texto colado → SUCCEEDED', async () => {
    const j = await call('POST', '/offers/extract', { url: 'https://exemplo.com/mock-403' });
    expect(j.status).toBe(202);
    const fim = await until(() => call('GET', `/jobs/${j.data.id}`), (r) => ['SUCCEEDED', 'FAILED'].includes(r.data?.status));
    expect(fim.data).toMatchObject({ status: 'FAILED', errorCode: 'PAGE_FORBIDDEN', action: 'paste_page_text' });
    expect(fim.data.failReason).toMatch(/403/);
    const ok = await call('POST', '/offers/extract', { pageText: 'Orbit Budget\nVocê encontra dinheiro esquecido.' });
    const fim2 = await until(() => call('GET', `/jobs/${ok.data.id}`), (r) => ['SUCCEEDED', 'FAILED'].includes(r.data?.status));
    expect(fim2.data.status).toBe('SUCCEEDED');
    expect(fim2.data.output.fieldSources.name).toBe('page');
  });

  it('fluxo inteiro em mock até a Biblioteca, com falhas forçadas no caminho', async () => {
    const offer = await call('POST', '/offers', {
      name: 'Orbit Budget', language: 'en', what: 'A budgeting app', promise: 'Find forgotten money', cta: 'Start free', notes: '[mock:fail-slot:1]',
    });
    expect(offer.status).toBe(201);
    const created = await call('POST', '/creatives', { offerId: offer.data.id });
    expect(created.status).toBe(201);
    const id = created.data.id;
    expect(created.data).toMatchObject({ state: 'SCRIPTS_WRITING', name: 'Orbit Budget · 1', status: 'progress' });

    // SSE: snapshot primeiro
    const sse = await fetch(`${base}/api/v1/creatives/${id}/events`, { headers: { authorization: `Bearer ${token}` } });
    const reader = sse.body!.getReader();
    let sseText = '';
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) break;
        sseText += new TextDecoder().decode(value);
      }
    })();

    // roteiros: slot 1 falha → job PARTIAL, criativo SCRIPTS_READY
    await until(() => stateOf(id), (s) => s !== 'SCRIPTS_WRITING');
    expect(await stateOf(id)).toBe('SCRIPTS_READY');
    const scripts = await call('GET', `/creatives/${id}/scripts`);
    expect(scripts.data.job).toMatchObject({ status: 'PARTIAL', action: 'retry' });
    expect(scripts.data.scripts.map((s: any) => s.status)).toEqual(['READY', 'FAILED', 'READY', 'READY']);
    const pick = scripts.data.scripts[0];

    // escolher roteiro → AVATAR_PENDING + sugestão de rosto
    const sel = await call('POST', `/creatives/${id}/scripts/${pick.id}/select`, {});
    expect(sel.data.state).toBe('AVATAR_PENDING');
    await until(() => call('GET', `/creatives/${id}/faces`), (r) => !!r.data?.description);

    // rostos com SAFETY_BLOCK → FACES_FAILED com action change_description
    const bad = await call('POST', `/creatives/${id}/faces/generate`, { description: 'woman in her 30s [mock:SAFETY_BLOCK]' });
    expect(bad.status).toBe(202);
    await until(() => stateOf(id), (s) => s !== 'FACES_GENERATING');
    expect(await stateOf(id)).toBe('FACES_FAILED');
    const faces1 = await call('GET', `/creatives/${id}/faces`);
    expect(faces1.data.batches[0].faces).toHaveLength(4); // §13.13: padrão 4 no v1
    expect(faces1.data.faceUnitPriceUsd).toBeGreaterThan(0);
    expect((await call('POST', `/creatives/${id}/faces/generate`, { description: 'woman in her 30s, kitchen', count: 5 })).status).toBe(400);
    expect((await call('POST', `/creatives/${id}/faces/generate`, { description: 'woman in her 30s, kitchen', count: 0 })).status).toBe(400);
    expect(faces1.data.batches[0].faces[0]).toMatchObject({ status: 'FAILED', errorCode: 'SAFETY_BLOCK', action: 'change_description' });
    expect((await call('GET', '/creatives?filter=needs_you')).data.map((c: any) => c.id)).toContain(id);

    // lote bom → FACES_READY com imagem validada no storage
    const g2 = await call('POST', `/creatives/${id}/faces/generate`, { description: 'woman in her 30s, kitchen, natural light', count: 2 });
    expect(g2.data.faces).toHaveLength(2);
    await until(() => stateOf(id), (s) => s !== 'FACES_GENERATING');
    const faces2 = await call('GET', `/creatives/${id}/faces`);
    expect(faces2.data.batches.map((b: any) => b.batch)).toEqual([2, 1]);
    expect(faces2.data.batches[0].faces.map((f: any) => f.position)).toEqual([0, 1]);
    const face = faces2.data.batches[0].faces[0];
    expect(face.status).toBe('READY');
    expect(face.image.url).toContain('X-Amz-Signature');
    expect((await call('POST', `/creatives/${id}/faces/${face.id}/select`, {})).data.state).toBe('ENGINE_PENDING');

    // estimativa + ESTIMATE_CHANGED + Generate
    const est = await call('GET', `/creatives/${id}/estimate?engine=SCENES&model=kling-3.0&format=SQUARE_1_1`);
    expect(est.data.costUsd).toBeGreaterThan(0);
    expect(est.data.warnings).toEqual([]);
    const gen0 = { engine: 'SCENES', engineModel: 'kling-3.0', format: 'SQUARE_1_1' };
    expect((await call('POST', `/creatives/${id}/generate`, { ...gen0, expectedCostUsd: est.data.costUsd / 2 })).error.code).toBe('ESTIMATE_CHANGED');
    const gen = await call('POST', `/creatives/${id}/generate`, { ...gen0, expectedCostUsd: est.data.costUsd });
    expect(gen.status).toBe(202);
    expect(gen.data.scenes.length).toBe(est.data.sceneCount);

    // cenas → render automático → RENDER_READY
    const seen = new Set<string>();
    await until(async () => { const s = await stateOf(id); seen.add(s); return s; }, (s) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), 90_000);
    expect(await stateOf(id)).toBe('RENDER_READY');
    expect(seen.has('RENDERING') || seen.has('SCENES_GENERATING')).toBe(true);
    const sc = await call('GET', `/creatives/${id}/scenes`);
    expect(sc.data.summary).toMatchObject({ failed: 0, ready: sc.data.scenes.length });
    expect(sc.data.scenes.every((s: any) => s.clip?.url)).toBe(true);
    expect(sc.data.scenes.every((s: any) => s.thumbnail?.mimeType === 'image/jpeg' && s.thumbnail.url.includes('/thumbnail/'))).toBe(true);
    const thumbIds = await prisma.scene.findMany({ where: { creativeId: id, stale: false }, select: { thumbnailFileId: true } });
    expect(thumbIds.every((t) => !!t.thumbnailFileId)).toBe(true);
    const words = await prisma.scene.findMany({ where: { creativeId: id, stale: false }, select: { words: true } });
    expect(words.every((w) => Array.isArray(w.words) && (w.words as unknown[]).length > 0)).toBe(true);

    // revisão: LINE com falha forçada → só aquela cena falha → SCENES_FAILED; regerar → volta
    const line = await call('POST', `/creatives/${id}/changes`, { type: 'LINE', sceneIndex: 1, newSpeech: 'New line [mock:PROVIDER_ERROR]' });
    expect(line.data.returnTo).toBe('generation');
    await until(() => stateOf(id), (s) => s !== 'SCENES_GENERATING', 60_000);
    expect(await stateOf(id)).toBe('SCENES_FAILED');
    const failed = (await call('GET', `/creatives/${id}/scenes`)).data.scenes[1];
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', action: 'regenerate', attempt: 2 });
    expect((await call('POST', `/creatives/${id}/scenes/1/regenerate`, { speech: 'A clean new line.' })).status).toBe(202);
    await until(() => stateOf(id), (s) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), 90_000);
    expect(await stateOf(id)).toBe('RENDER_READY');

    // edição suja bloqueia aprovar; renderiza de novo e aprova
    expect((await call('PATCH', `/creatives/${id}/edit`, { captionStyle: 'line' })).data.dirty).toBe(true);
    expect(await stateOf(id)).toBe('EDIT_PENDING');
    expect((await call('POST', `/creatives/${id}/approve`, {})).status).toBe(409);
    expect((await call('POST', `/creatives/${id}/render`, {})).status).toBe(202);
    await until(() => stateOf(id), (s) => s === 'RENDER_READY');
    const review = await call('GET', `/creatives/${id}/review`);
    expect(review.data.video.url).toContain(`ws/${wsId}/render_video/`);
    expect(review.data.facts).toMatchObject({ offerName: 'Orbit Budget', scriptLetter: 'A', engineLabel: 'Kling 3.0', format: 'SQUARE_1_1' });
    const ap = await call('POST', `/creatives/${id}/approve`, {});
    expect(ap.data).toMatchObject({ state: 'APPROVED', step: 'library', status: 'approved' });

    // biblioteca + vencedor
    const lib = await call('GET', '/library');
    expect(lib.data.map((x: any) => x.id)).toEqual([id]);
    expect(lib.meta.offers).toEqual([{ id: offer.data.id, name: 'Orbit Budget' }]);
    expect((await call('PUT', `/library/${id}/winner`, { isWinner: true })).data).toEqual({ id, isWinner: true });
    expect((await call('GET', `/offers/${offer.data.id}`)).data).toMatchObject({ creativesCount: 1, winnersCount: 1 });

    // SSE fecha sozinho em APPROVED e recebeu os deltas
    await until(async () => sseText, (t) => t.includes('"state":"APPROVED"'), 10_000);
    await pump;
    for (const ev of ['snapshot', 'script.delta', 'job.updated', 'face.updated', 'scene.updated', 'render.updated', 'creative.updated']) {
      expect(sseText).toContain(`event: ${ev}`);
    }
    // custo real gravado por chamada (mock = US$ 0)
    expect(await prisma.costEntry.count({ where: { creativeId: id } })).toBeGreaterThan(0);
  });

  it('boot: job RUNNING vira FAILED INTERRUPTED e o criativo sai de SCRIPTS_WRITING; render RENDERING volta pra fila', async () => {
    const offer = await prisma.offer.create({ data: { workspaceId: wsId, name: 'Boot', language: 'en', what: 'x', promise: 'y', createdById: (await prisma.user.findFirstOrThrow({ where: { email: `${RUN}@teste.local` } })).id } });
    const c = await prisma.creative.create({ data: { workspaceId: wsId, offerId: offer.id, name: 'Boot · 1', language: 'en', state: 'SCRIPTS_WRITING', createdById: offer.createdById } });
    const job = await prisma.job.create({ data: { workspaceId: wsId, type: 'SCRIPTS_GENERATE', status: 'RUNNING', input: {}, creativeId: c.id, createdById: offer.createdById } });
    await prisma.script.create({ data: { workspaceId: wsId, creativeId: c.id, letter: 'A', status: 'WRITING', jobId: job.id } });
    await app.get(RecuperacaoService).recover({ workspaceId: wsId });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', errorCode: 'INTERRUPTED' });
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('SCRIPTS_FAILED');
  });
});
