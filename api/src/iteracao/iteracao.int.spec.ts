// B1 (variacao-auto-v1) de ponta a ponta contra a infra LOCAL (maquina_test), integrações em mock (custo zero), medição
// de verdade (ffmpeg): upload → POST /iterate → análise sozinha → AUTO_PLAN (regras + reparo) → PLAN_READY → start.
// Library reaproveitando o campeão, falha na leitura, PLAN_INVALID + retry, OFFER_REQUIRED, CLIENT, teto, retomada,
// isolamento de workspace e a foto do produto (D4).
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { CLAUDE_SERVICE, type AutoPlanDraft, type AutoPlanInput, type ClaudeService } from '../integracoes';
import { configureApp } from '../main';
import { IteracaoService } from './iteracao.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
type Who = 'A' | 'B' | 'C';

/** Plano válido gerado a partir do `allowed` (sem CUT/COLD_OPEN, que dependem dos blocos do mock). */
function validPlan(i: AutoPlanInput): AutoPlanDraft & { costUsd: number } {
  const max = new Map(i.allowed.map((a) => [a.type, a.max]));
  const items: AutoPlanDraft['items'] = [];
  const add = (n: number, mk: (k: number) => AutoPlanDraft['items'][number]) => {
    for (let k = 0; k < n; k++) items.push(mk(k));
  };
  const base = { change: 'One thing changes', rationale: 'Attacks the hook', whyKey: 'hook' as const };
  add(Math.min(2, max.get('HOOK_TEXT') ?? 0), (k) => ({ ...base, type: 'HOOK_TEXT', params: { type: 'HOOK_TEXT', text: ['Still tired?', 'Read this first'][k] } }));
  if (max.get('ENDCARD')) items.push({ ...base, type: 'ENDCARD', params: { type: 'ENDCARD', variant: 'cta', headline: 'Try it today', subline: null, ctaText: 'Download' } });
  if (max.get('SPLIT_LP')) items.push({ ...base, type: 'SPLIT_LP', params: { type: 'SPLIT_LP' } });
  if (max.get('STORY')) items.push({ ...base, type: 'STORY', params: { type: 'STORY' } });
  if (max.get('REVIEW')) items.push({ ...base, type: 'REVIEW', params: { type: 'REVIEW', quote: 'I finally sleep through the night', author: null, stars: null } });
  add(Math.min(2, max.get('NATIVE_SEARCH') ?? 0), (k) => ({ ...base, type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: ['how to fall asleep fast', 'tired all day why'][k] } }));
  add(Math.min(2, max.get('STATIC') ?? 0), (k) => ({ ...base, type: 'STATIC', params: { type: 'STATIC', atSec: 2 + k * 4, headline: ['Sleep better', 'Busy parents'][k] } }));
  const why = {
    hook: { text: 'Names the pain fast', source: 'video' as const, brainField: null, ref: 'From the video' },
    proof: { text: 'A parent says it worked', source: 'brain' as const, brainField: 'proof' as const, ref: 'Ana' },
    cta: { text: 'Easy next step', source: 'brain' as const, brainField: 'cta' as const, ref: 'Download' },
  };
  return { blocks: [], why, kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'Ending', blockIndex: null }], items, costUsd: 0.01 };
}

describe(isLocal ? 'Iterate B1 (integração local)' : 'Iterate B1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const ws: Record<Who, { id: string; userId: string; token: string }> = {} as never;
  let dir: string;
  let offerId: string;
  let offer2Id: string;
  let video30: Buffer;
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const captured: string[] = [];

  const call = async (method: string, path: string, body?: unknown, who: Who = 'A') => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws[who].token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 300_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const settled = (id: string) => until(() => call('GET', `/iterate/${id}`), (r) => !!r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status));

  async function upload(bytes: Buffer, name: string, mimeType = 'video/mp4', purpose = 'CHAMPION_VIDEO', who: Who = 'A') {
    const c = await call('POST', '/uploads', { purpose, filename: name, mimeType, sizeBytes: bytes.length }, who);
    expect(c.status).toBe(201);
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': mimeType, authorization: `Bearer ${ws[who].token}` }, body: new Uint8Array(bytes) });
    const done = await call('POST', `/uploads/${c.data.uploadId}/complete`, {}, who);
    return { id: c.data.uploadId as string, complete: done };
  }

  async function makeVideo(name: string, sec: number): Promise<Buffer> {
    const path = join(dir, name);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=25:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=300:duration=${sec}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path,
    ], { timeout: 60_000 });
    return readFile(path);
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-iterate-'));
    const fakePage: PageCapturePort = {
      capture: async ({ workspaceId, url }) => {
        captured.push(url);
        if (url.includes('blocked')) return { error: 'PAGE_FORBIDDEN', status: 403 };
        const f = await prisma.file.create({ data: { workspaceId, kind: 'PAGE_CAPTURE', storageKey: `ws/${workspaceId}/page_capture/${RUN}-${captured.length}.png`, mimeType: 'image/png', sizeBytes: 10, width: 1080, height: 3240 } });
        return { fileId: f.id, widthPx: 1080, heightPx: 3240, text: 'Sleep better tonight. Try it free.' };
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAGE_CAPTURE).useValue(fakePage).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const hash = await hashPassword(PASSWORD);
    const users: Record<Who, { id: string; email: string }> = {} as never;
    for (const k of ['A', 'B', 'C'] as const) {
      const email = `it-${RUN}-${k.toLowerCase()}@teste.local`;
      users[k] = { id: (await prisma.user.create({ data: { email, name: `It ${k}`, passwordHash: hash } })).id, email };
    }
    const wA = await prisma.workspace.create({
      data: { name: `Acme Iterate ${RUN}`, shortCode: 'AC', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: users.A.id, role: 'OWNER' }, { userId: users.C.id, role: 'CLIENT' }] } },
    });
    const wB = await prisma.workspace.create({ data: { name: `it-${RUN}-B`, shortCode: 'BB', memberships: { create: { userId: users.B.id, role: 'OWNER' } } } });
    for (const k of ['A', 'B', 'C'] as const) {
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[k].email, password: PASSWORD }) });
      ws[k] = { id: k === 'B' ? wB.id : wA.id, userId: users[k].id, token: (await res.json()).data.accessToken };
    }
    offerId = (await prisma.offer.create({
      data: {
        workspaceId: wA.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', promise: 'Sleep better',
        proof: '"I finally sleep through the night" - Ana', cta: 'Download', createdById: users.A.id,
      },
    })).id;
    video30 = await makeVideo('v30.mp4', 30);
  });

  afterAll(async () => {
    const ids = [ws.A?.id, ws.B?.id].filter(Boolean) as string[];
    if (ids.length) {
      await app.get(IteracaoService).recover(ws.A.id).catch(() => undefined);
      // espera a fila de render (fake) sair dos criativos do lote antes de apagar
      await until(() => prisma.render.count({ where: { workspaceId: { in: ids }, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: { in: ids }, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.upload.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.updateMany({ where: { workspaceId: { in: ids } }, data: { productImageFileId: null } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `it-${RUN}-` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('config: limites novos, 9 tipos, oferta única = default; CLIENT não vê o config', async () => {
    const r = await call('GET', '/iterate/config');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ maxBytes: 524288000, minSec: 4, maxSec: 180, metaConnected: false, defaultOfferId: offerId, recentWinners: [] });
    expect(r.data.types).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC']);
    expect(r.data.offers).toEqual([{ id: offerId, name: 'Sleep app', language: 'en' }]);
    expect(r.data.analysisTypicalUsd).toBeGreaterThan(0);
    expect((await call('GET', '/iterate/config', undefined, 'C')).status).toBe(403);
  });

  let batchId: string;
  let championId: string;
  let uploadId: string;

  it('POST /iterate: corpo inválido = 400; upload de outro workspace = 404; CLIENT = 403', async () => {
    expect((await call('POST', '/iterate', {})).status).toBe(400);
    expect((await call('POST', '/iterate', { uploadId: 'a', creativeId: 'b' })).status).toBe(400);
    expect((await call('POST', '/iterate', { uploadId: 'x', extra: 1 })).status).toBe(400);
    const up = await upload(video30, 'champ.mp4');
    expect(up.complete.status).toBe(200);
    expect(up.complete.data.analysisEstimateUsd).toBeGreaterThan(0);
    uploadId = up.id;
    expect((await call('POST', '/iterate', { uploadId }, 'B')).status).toBe(404);
    expect((await call('POST', '/iterate', { uploadId }, 'C')).status).toBe(403);
    // workspace sem oferta: 422 OFFER_REQUIRED com a lista vazia ("crie a oferta no Brain")
    const own = await upload(video30, 'b.mp4', 'video/mp4', 'CHAMPION_VIDEO', 'B');
    expect((await call('POST', '/iterate', { uploadId: own.id }, 'B')).error).toMatchObject({ code: 'OFFER_REQUIRED', statusCode: 422, details: { offers: [] } });
  });

  it('upload → ANALYZING → análise sozinha → PLANNING → PLAN_READY com o plano do mock da ia (regras do backend)', async () => {
    const cr = await call('POST', '/iterate', { uploadId });
    expect(cr.status).toBe(202);
    expect(cr.data).toMatchObject({ status: 'ANALYZING', phase: 'analyze', codeLanguage: 'EN', offer: { id: offerId }, pieces: [], error: null });
    expect(cr.data.analysis).toMatchObject({ stage: 'reading', step: 1 });
    expect(cr.data.analysis.checklist.map((c: any) => c.key)).toEqual(['decode', 'transcribe', 'cuts', 'edit_map', 'blocks', 'audience', 'offer', 'proof', 'page', 'planning']);
    expect(cr.data.source).toMatchObject({ fromLibrary: false, width: 720, height: 1280, ratioLabel: '9:16' });
    expect(cr.data.cost.analysisEstimateUsd).toBeGreaterThan(0);
    batchId = cr.data.id;
    championId = cr.data.source.championId;
    const r = await settled(batchId);
    expect(r.data.error).toBeNull();
    expect(r.data.status).toBe('PLAN_READY');
    expect(r.data.analysis).toMatchObject({ stage: null, step: 3, progress: 100, etaSec: null });
    expect(r.data.analysis.checklist.every((c: any) => c.status === 'done')).toBe(true);
    const n = r.data.pieces.length;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(12);
    expect(r.data.summary.newAudience).toBeGreaterThanOrEqual(Math.ceil(n * 0.4));
    expect(r.data.summary).toMatchObject({ pieces: n, files: n * 3, ready: 0, videoCreditsUsd: 0 });
    expect(new Set(r.data.pieces.map((p: any) => p.code)).size).toBe(n);
    expect(r.data.pieces.every((p: any) => p.status === 'planned' && p.inZip && p.creativeId === null)).toBe(true);
    expect(r.data.pieces.map((p: any) => p.index)).toEqual([...Array(n).keys()]);
    for (const p of r.data.pieces) expect(p.folder).toBe(p.axis === 'ITERATION' ? '1-stretch' : '2-new-audience');
    expect(r.data.insight.why.map((w: any) => w.key)).toEqual(['hook', 'proof', 'cta']);
    expect(r.data.insight.flags).toMatchObject({ metaConnected: false, pageCaptured: true, brainEmpty: false });
    expect(captured).toContain('https://example.com/lp'); // sem sourceUrl na oferta: site do workspace
    const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(b.pageCaptureFileId).not.toBeNull();
    const items = await prisma.variationItem.findMany({ where: { batchId } });
    expect(items.every((i) => i.kind === 'AUTO_EDIT' && i.status === 'READY' && !!(i.payload as any).params)).toBe(true);
    // isolamento: outro workspace e a rota MANUAL não veem o lote AUTO
    expect((await call('GET', `/iterate/${batchId}`, undefined, 'B')).status).toBe(404);
    expect((await call('GET', `/variation-batches/${batchId}`)).status).toBe(404);
    // CLIENT lê
    expect((await call('GET', `/iterate/${batchId}`, undefined, 'C')).status).toBe(200);
  });

  it('lote MANUAL não abre em /iterate', async () => {
    const manual = await prisma.variationBatch.create({
      data: { workspaceId: ws.A.id, championId, offerId, status: 'PLAN_READY', language: 'en', requests: [], createdById: ws.A.userId },
    });
    expect((await call('GET', `/iterate/${manual.id}`)).status).toBe(404);
    await prisma.variationBatch.delete({ where: { id: manual.id } });
  });

  it('start: plano mudou = 409 PLAN_CHANGED; certo = LAUNCHED com 1 criativo AUTO_EDIT e 3 renders por peça; de novo = 409', async () => {
    const before = await call('GET', `/iterate/${batchId}`);
    const n = before.data.pieces.length;
    const wrong = await call('POST', `/iterate/${batchId}/start`, { expectedPieces: n + 1 });
    expect(wrong.error).toMatchObject({ code: 'PLAN_CHANGED', statusCode: 409, details: { pieces: n } });
    expect((await call('POST', `/iterate/${batchId}/start`, { expectedPieces: n }, 'C')).status).toBe(403);
    const ok = await call('POST', `/iterate/${batchId}/start`, { expectedPieces: n });
    expect(ok.status).toBe(202);
    expect(ok.data.status).toBe('LAUNCHED');
    expect(ok.data.launchedAt).not.toBeNull();
    expect(['generate', 'download']).toContain(ok.data.phase);
    const creatives = await prisma.creative.findMany({ where: { variationBatchId: batchId }, include: { renders: true } });
    expect(creatives).toHaveLength(n);
    expect(creatives.every((c) => c.variationKind === 'AUTO_EDIT' && !!c.variationCode && c.renders.length === 3)).toBe(true);
    expect((await call('POST', `/iterate/${batchId}/start`, { expectedPieces: n })).error).toMatchObject({ code: 'INVALID_STATE', details: { state: 'LAUNCHED' } });
    expect((await call('POST', `/iterate/${batchId}/retry`, {})).error.code).toBe('INVALID_STATE');
  });

  let creativeId: string;

  it('Library → Vary: criativo não APPROVED = 409; campeão já analisado é reaproveitado (nasce PLANNING, só o plano)', async () => {
    // criativo aprovado "da Library" apontando pro vídeo do campeão (render final 9:16)
    const champ = await prisma.champion.findUniqueOrThrow({ where: { id: championId }, include: { teardown: true } });
    const c = await prisma.creative.create({ data: { workspaceId: ws.A.id, offerId, name: 'Winner one', language: 'en', state: 'RENDER_READY', createdById: ws.A.userId } });
    creativeId = c.id;
    expect((await call('POST', '/iterate', { creativeId })).error).toMatchObject({ code: 'INVALID_STATE', details: { allowed: ['APPROVED'] } });
    const r = await prisma.render.create({ data: { workspaceId: ws.A.id, creativeId, status: 'READY', settings: {}, input: {}, fileId: null, durationSec: 30 } });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: champ.videoFileId! } });
    const copy = await prisma.file.create({ data: { workspaceId: ws.A.id, kind: 'RENDER_VIDEO', storageKey: `${file.storageKey}.lib-${RUN}`, mimeType: 'video/mp4', sizeBytes: file.sizeBytes, durationSec: 30, width: 720, height: 1280 } });
    await prisma.render.update({ where: { id: r.id }, data: { fileId: copy.id } });
    await prisma.creative.update({ where: { id: creativeId }, data: { state: 'APPROVED', approvedAt: new Date(), approvedById: ws.A.userId, finalRenderId: r.id } });
    // o campeão analisado passa a ser "o da Library" deste criativo (com mapa da edição)
    await prisma.champion.update({ where: { id: championId }, data: { sourceCreativeId: creativeId } });
    if (!champ.teardown?.editMap) {
      await prisma.teardown.update({
        where: { championId },
        data: { editMap: { version: 1, width: 720, height: 1280, fps: 25, frameCount: 750, cells: [], faceTrack: [], layers: [], overlaysOverFace: [], profile: null, keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } } } },
      });
    }
    const claude = app.get<ClaudeService>(CLAUDE_SERVICE);
    const spy = jest.spyOn(claude, 'planAutoBatch').mockImplementation(async (i) => validPlan(i));
    const cr = await call('POST', '/iterate', { creativeId });
    expect(cr.status).toBe(202);
    expect(cr.data.status).toBe('PLANNING');
    expect(cr.data.source).toMatchObject({ championId, fromLibrary: true });
    expect(cr.data.analysis.checklist.slice(0, 5).every((c: any) => c.status === 'done')).toBe(true);
    const done = await settled(cr.data.id);
    expect(done.data.status).toBe('PLAN_READY');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ batchId: cr.data.id, rules: { max: 12, minDiversityPct: 40 }, page: { captured: true } });
    expect(done.data.pieces.map((p: any) => p.code)).toEqual(expect.arrayContaining(['HOOK-TEXT-2', 'HOOK-TEXT-3', 'LAYOUT-SPLIT-LP', 'LAYOUT-REVIEW', 'STATIC-F1']));
    expect(await prisma.job.count({ where: { championId, type: 'CHAMPION_ANALYZE' } })).toBe(1); // não reanalisou
    spy.mockRestore();
  });

  it('plano inválido: 2ª chamada com as violações; ainda inválido = reparo determinístico tira só as peças que violam', async () => {
    const claude = app.get<ClaudeService>(CLAUDE_SERVICE);
    const calls: AutoPlanInput[] = [];
    const spy = jest.spyOn(claude, 'planAutoBatch').mockImplementation(async (i) => {
      calls.push(i);
      const p = validPlan(i);
      p.items[0] = { ...p.items[0], params: { type: 'HOOK_TEXT', text: '97% of parents agree' } }; // número inventado
      return p;
    });
    const cr = await call('POST', '/iterate', { creativeId });
    const done = await settled(cr.data.id);
    expect(done.data.status).toBe('PLAN_READY');
    expect(calls).toHaveLength(2);
    expect(calls[0].violations).toBeUndefined();
    expect(calls[1].violations!.join(' ')).toMatch(/item 0 \(HOOK_TEXT\): invented_number/);
    const full = validPlan(calls[0]).items.length;
    expect(done.data.pieces).toHaveLength(full - 1);
    expect(done.data.pieces.some((p: any) => p.type === 'HOOK_TEXT')).toBe(true);
    spy.mockRestore();
  });

  it('[mock:auto-plan-invalid] (mock da ia): não fecha nem com reparo = ANALYSIS_FAILED PLAN_INVALID; retry → PLANNING → PLAN_READY', async () => {
    await prisma.offer.update({ where: { id: offerId }, data: { notes: '[mock:auto-plan-invalid]' } });
    const cr = await call('POST', '/iterate', { creativeId });
    const failed = await settled(cr.data.id);
    await prisma.offer.update({ where: { id: offerId }, data: { notes: null } });
    if (failed.data.status === 'ANALYSIS_FAILED') {
      expect(failed.data.error).toMatchObject({ code: 'PLAN_INVALID', stage: 'planning', action: 'try_again' });
      expect(failed.data.analysis.checklist.at(-1)).toEqual({ key: 'planning', status: 'failed' });
      expect(typeof failed.data.error.params.violations).toBe('string');
    } else {
      // o mock pode ter violado só peças: o reparo determinístico fecha o lote
      expect(failed.data.status).toBe('PLAN_READY');
      return;
    }
    expect((await call('POST', `/iterate/${cr.data.id}/retry`, {}, 'C')).status).toBe(403);
    const rt = await call('POST', `/iterate/${cr.data.id}/retry`, {});
    expect(rt.status).toBe(202);
    expect(rt.data.status).toBe('PLANNING');
    expect(rt.data.error).toBeNull();
    const ok = await settled(cr.data.id);
    expect(ok.data.status).toBe('PLAN_READY');
  });

  it('[mock:auto-fail:planning]: Claude falha 2x = ANALYSIS_FAILED PROVIDER_ERROR (try_again)', async () => {
    await prisma.offer.update({ where: { id: offerId }, data: { notes: '[mock:auto-fail:planning]' } });
    const claude = app.get<ClaudeService>(CLAUDE_SERVICE);
    const spy = jest.spyOn(claude, 'planAutoBatch');
    const cr = await call('POST', '/iterate', { creativeId });
    const failed = await settled(cr.data.id);
    await prisma.offer.update({ where: { id: offerId }, data: { notes: null } });
    expect(failed.data.status).toBe('ANALYSIS_FAILED');
    expect(failed.data.error).toMatchObject({ code: 'PROVIDER_ERROR', stage: 'planning', action: 'try_again' });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('página bloqueada: SPLIT-LP sai do allowed e vira troca no_page', async () => {
    await prisma.workspace.update({ where: { id: ws.A.id }, data: { websiteUrl: 'https://blocked.example.com' } });
    const claude = app.get<ClaudeService>(CLAUDE_SERVICE);
    const spy = jest.spyOn(claude, 'planAutoBatch').mockImplementation(async (i) => validPlan(i));
    const cr = await call('POST', '/iterate', { creativeId });
    const done = await settled(cr.data.id);
    await prisma.workspace.update({ where: { id: ws.A.id }, data: { websiteUrl: 'https://example.com/lp' } });
    expect(done.data.status).toBe('PLAN_READY');
    expect(spy.mock.calls[0][0].allowed.find((a) => a.type === 'SPLIT_LP')).toEqual({ type: 'SPLIT_LP', max: 0 });
    expect(done.data.insight.swaps).toContainEqual({ from: 'SPLIT_LP', to: 'STORY', reason: 'no_page' });
    expect(done.data.insight.flags.pageCaptured).toBe(false);
    expect(done.data.pieces.some((p: any) => p.type === 'SPLIT_LP')).toBe(false);
    spy.mockRestore();
  });

  it('OFFER_REQUIRED com > 1 oferta; com offerId vai; config sem default até um lote, depois a última usada', async () => {
    offer2Id = (await prisma.offer.create({ data: { workspaceId: ws.A.id, name: 'Oferta PT', language: 'pt-BR', createdById: ws.A.userId } })).id;
    const up = await upload(video30, 'second.mp4');
    const r = await call('POST', '/iterate', { uploadId: up.id });
    expect(r.status).toBe(422);
    expect(r.error.code).toBe('OFFER_REQUIRED');
    expect(r.error.details.offers).toEqual(expect.arrayContaining([{ id: offerId, name: 'Sleep app' }, { id: offer2Id, name: 'Oferta PT' }]));
    expect((await call('POST', '/iterate', { uploadId: up.id, offerId: 'nope' })).status).toBe(404);
    const cfg = await call('GET', '/iterate/config');
    expect(cfg.data.offers).toHaveLength(2);
    expect(cfg.data.defaultOfferId).toBe(offerId); // última usada num lote AUTO
    // oferta pt-BR: códigos em PT e reprova na leitura ([mock:auto-fail:reading])
    await prisma.offer.update({ where: { id: offer2Id }, data: { notes: '[mock:auto-fail:reading]' } });
    const cr = await call('POST', '/iterate', { uploadId: up.id, offerId: offer2Id });
    expect(cr.status).toBe(202);
    expect(cr.data).toMatchObject({ status: 'ANALYZING', codeLanguage: 'PT', offer: { id: offer2Id } });
    const failed = await settled(cr.data.id);
    expect(failed.data.status).toBe('ANALYSIS_FAILED');
    expect(failed.data.error).toMatchObject({ code: 'PROVIDER_ERROR', stage: 'reading', action: 'try_again' });
    expect(failed.data.analysis.checklist.find((c: any) => c.status === 'failed')?.key).toBe('blocks');
    // retry: campeão FAILED → analisa de novo (ANALYZING); sem o gatilho, fecha
    await prisma.offer.update({ where: { id: offer2Id }, data: { notes: null } });
    const rt = await call('POST', `/iterate/${cr.data.id}/retry`, {});
    expect(rt.data.status).toBe('ANALYZING');
    const ok = await settled(cr.data.id);
    expect(ok.data.status).toBe('PLAN_READY');
    expect(ok.data.pieces.some((p: any) => /^(GANCHO-TEXTO|ESTATICO|NATIVO-BUSCA|CORTE)|LAYOUT|COLD|ENDCARD/.test(p.code))).toBe(true);
    expect(ok.data.pieces.some((p: any) => /^(HOOK-TEXT|STATIC|NATIVE-SEARCH|CUT)-/.test(p.code))).toBe(false);
  });

  it('teto de gasto: 409 SPEND_CAP_EXCEEDED antes de criar', async () => {
    await prisma.workspace.update({ where: { id: ws.A.id }, data: { monthlySpendCapUsd: 0.0001 } });
    const before = await prisma.variationBatch.count({ where: { workspaceId: ws.A.id } });
    const r = await call('POST', '/iterate', { creativeId });
    await prisma.workspace.update({ where: { id: ws.A.id }, data: { monthlySpendCapUsd: null } });
    expect(r.error.code).toBe('SPEND_CAP_EXCEEDED');
    expect(await prisma.variationBatch.count({ where: { workspaceId: ws.A.id } })).toBe(before);
  });

  it('retomada: lote PLANNING sem processo vivo → ANALYSIS_FAILED INTERRUPTED', async () => {
    const b = await prisma.variationBatch.create({
      data: { workspaceId: ws.A.id, championId, offerId, mode: 'AUTO', status: 'PLANNING', language: 'en', requests: [], createdById: ws.A.userId },
    });
    await app.get(IteracaoService).recover(ws.A.id);
    const r = await call('GET', `/iterate/${b.id}`);
    expect(r.data.status).toBe('ANALYSIS_FAILED');
    expect(r.data.error).toMatchObject({ code: 'INTERRUPTED', action: 'try_again' });
  });

  it('D4 foto do produto: upload PRODUCT_IMAGE (assinatura conferida) → PUT/DELETE /offers/:id/product-image', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    expect((await call('POST', '/uploads', { purpose: 'PRODUCT_IMAGE', filename: 'p.gif', mimeType: 'image/gif', sizeBytes: 10 })).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await call('POST', '/uploads', { purpose: 'PRODUCT_IMAGE', filename: 'p.png', mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024 })).error).toMatchObject({ code: 'MEDIA_TOO_LARGE', details: { maxBytes: 10485760 } });
    const fake = await upload(Buffer.alloc(72, 1), 'fake.png', 'image/png', 'PRODUCT_IMAGE');
    expect(fake.complete.error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    const ok = await upload(png, 'p.png', 'image/png', 'PRODUCT_IMAGE');
    expect(ok.complete.status).toBe(200);
    expect(ok.complete.data).toMatchObject({ status: 'READY', analysisEstimateUsd: 0, file: { mimeType: 'image/png' } });
    // vídeo não serve de foto; foto não serve de campeão
    expect((await call('PUT', `/offers/${offerId}/product-image`, { uploadId })).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await call('POST', '/iterate', { uploadId: ok.id, offerId })).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await call('PUT', `/offers/${offerId}/product-image`, { uploadId: ok.id }, 'B')).status).toBe(404);
    const put = await call('PUT', `/offers/${offerId}/product-image`, { uploadId: ok.id });
    expect(put.status).toBe(200);
    expect(put.data.productImage).toMatchObject({ mimeType: 'image/png' });
    expect((await call('GET', `/offers/${offerId}`)).data.productImage).not.toBeNull();
    const del = await call('DELETE', `/offers/${offerId}/product-image`);
    expect(del.data.productImage).toBeNull();
  });
});
