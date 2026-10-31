// legenda-protegida-v1 §8 (29/10): "Gerar mesmo assim" num formato bloqueado pela legenda queimada, contra a infra LOCAL
// (maquina_test), integrações em mock (custo zero), render fake. Campeão com legenda queimada (camada caption no editMap)
// → lote PLAN_READY → forçar moldura com candidata guardada (sem chamada) e NATIVE_SEARCH sem candidata (1 chamada do
// plano) → peça com captionOverride, forced no insight, estimativa sem a checagem → desfazer e forçar de novo sem pagar →
// start com `[mock:caption-covered]` → a peça forçada fica pronta (CAPTION_COVERED não reprova).
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3192;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { configureApp } from '../main';
import { IteracaoService } from './iteracao.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = `t${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);

type Piece = { id: string; type: string; status: string; captionOverride?: boolean; frame?: { template: string } | null; errorCode: string | null };
type Blocked = { type: string; template: string | null; forced?: boolean };

describe(isLocal ? 'Legenda queimada: Gerar mesmo assim (integração local)' : 'Gerar mesmo assim [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let token = '';
  let wsId = '';
  let dir = '';
  let sampleWsId = '';
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
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
  const forcePlanJobs = (batchId: string) => prisma.job.count({ where: { variationBatchId: batchId, type: 'AUTO_PLAN', input: { path: ['captionForce'], not: Prisma.AnyNull } } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-forcar-'));
    const fakePage: PageCapturePort = {
      capture: async ({ workspaceId }) => {
        const f = await prisma.file.create({ data: { workspaceId, kind: 'PAGE_CAPTURE', storageKey: `ws/${workspaceId}/page_capture/${RUN}-${Date.now()}.png`, mimeType: 'image/png', sizeBytes: 10, width: 1080, height: 3240 } });
        return { fileId: f.id, widthPx: 1080, heightPx: 3240, text: 'Sleep better tonight. Try it free.' };
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAGE_CAPTURE).useValue(fakePage).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const email = `it-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'It F', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Acme Forcar ${RUN}`, shortCode: 'MF', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    wsId = w.id;
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = (await res.json()).data.accessToken;
    await prisma.offer.create({
      data: {
        workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
        promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: user.id,
        notes: '[mock:caption-covered]',
      },
    });
  });

  afterAll(async () => {
    if (sampleWsId) {
      await prisma.variationBatch.deleteMany({ where: { workspaceId: sampleWsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: sampleWsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: sampleWsId } });
      await prisma.workspace.deleteMany({ where: { id: sampleWsId } });
    }
    if (wsId) {
      await app.get(IteracaoService).recover(wsId).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: wsId, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: wsId, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: wsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: wsId } });
      await prisma.upload.deleteMany({ where: { workspaceId: wsId } });
      await prisma.job.deleteMany({ where: { workspaceId: wsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `it-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  let batchId = '';
  let frameTemplate = '';

  it('campeão com legenda queimada → lote PLAN_READY com formatos bloqueados', async () => {
    const path = join(dir, 'v30.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(bytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const first = await settled((await call('POST', '/iterate', { uploadId: c.data.uploadId })).data.id);
    expect(first.data.status).toBe('PLAN_READY');
    const championId = first.data.source.championId;
    // legenda queimada no meio-baixo do quadro, o vídeo inteiro
    const td = await prisma.teardown.findUniqueOrThrow({ where: { championId } });
    const em = td.editMap as Record<string, unknown>;
    const fc = Number(em.frameCount) || 750;
    const caption = {
      id: 'cap1', kind: 'caption', startFrame: 0, endFrame: fc, box: { x: 80, y: 820, w: 560, h: 120 },
      background: { kind: 'none', color: null, box: null }, text: null, wordsPerPage: 3, source: 'vision',
      style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 48, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' },
    };
    await prisma.teardown.update({ where: { championId }, data: { editMap: { ...em, layers: [caption] } as unknown as Prisma.InputJsonValue } });
    const b = await settled((await call('POST', '/iterate', { championId })).data.id);
    expect(b.data.status).toBe('PLAN_READY');
    batchId = b.data.id;

    // Cenário fixo, independente do que a guarda real bloqueou neste vídeo sintético:
    // NATIVE_SEARCH = o Claude nem planejou (sem candidata); 1 moldura = planejada e tirada pela guarda (candidata guardada)
    const items = await prisma.variationItem.findMany({ where: { batchId } });
    const frame = items.find((i) => i.autoType === 'FRAME');
    expect(frame).toBeDefined();
    const fp = (frame!.payload as { params: { template: string } }).params;
    frameTemplate = fp.template;
    const candidate = { index: frame!.index, type: 'FRAME', code: frame!.code, axis: frame!.axis, change: frame!.change, rationale: frame!.rationale, whyKey: 'hook', params: fp };
    await prisma.variationItem.deleteMany({ where: { batchId, OR: [{ autoType: 'NATIVE_SEARCH' }, { id: frame!.id }] } });
    // folga pro teto de 12 selecionadas
    const inc = await prisma.variationItem.findMany({ where: { batchId, included: true }, orderBy: { index: 'asc' }, select: { id: true } });
    await prisma.variationItem.updateMany({ where: { id: { in: inc.slice(8).map((x) => x.id) } }, data: { included: false, selection: 'user_removed' } });
    const row = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
    const insight = row.insight as Record<string, unknown>;
    const blocked = ((insight.captionBlocked as Blocked[] | undefined) ?? []).filter((x) => x.type !== 'NATIVE_SEARCH' && x.template !== frameTemplate);
    await prisma.variationBatch.update({
      where: { id: batchId },
      data: {
        insight: { ...insight, captionBlocked: [...blocked, { type: 'NATIVE_SEARCH', template: null, reason: 'burned_captions' }, { type: 'FRAME', template: frameTemplate, reason: 'burned_captions' }] } as unknown as Prisma.InputJsonValue,
        settings: { ...(row.settings as object), captionCandidates: [candidate] } as unknown as Prisma.InputJsonValue,
      },
    });
  });

  it('forçar: candidata guardada (sem chamada) e sem candidata (1 chamada do plano); override, forced e estimativa', async () => {
    const before = await call('GET', `/iterate/${batchId}`);
    const estimate = before.data.cost.generateEstimateUsd;
    const pieces0 = before.data.pieces.length;
    // formato que não está bloqueado = 400
    expect((await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'CUT', template: null })).status).toBe(400);

    const jobs0 = await forcePlanJobs(batchId);
    const f = await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'FRAME', template: frameTemplate });
    expect(f.status).toBe(200);
    expect(await forcePlanJobs(batchId)).toBe(jobs0); // candidata guardada: nenhuma chamada
    const fp = f.data.pieces.find((p: Piece) => p.type === 'FRAME' && p.frame?.template === frameTemplate);
    expect(fp).toMatchObject({ captionOverride: true, selection: 'user_added' });
    expect(f.data.insight.captionBlocked.find((x: Blocked) => x.template === frameTemplate).forced).toBe(true);

    const costs0 = await prisma.costEntry.count({ where: { variationBatchId: batchId } });
    const n = await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'NATIVE_SEARCH', template: null });
    expect(n.status).toBe(200);
    expect(await forcePlanJobs(batchId)).toBe(jobs0 + 1); // sem candidata: 1 chamada do plano
    expect(await prisma.costEntry.count({ where: { variationBatchId: batchId } })).toBe(costs0 + 1);
    const np = n.data.pieces.find((p: Piece) => p.type === 'NATIVE_SEARCH');
    expect(np).toMatchObject({ captionOverride: true });
    expect(n.data.insight.captionBlocked.find((x: Blocked) => x.type === 'NATIVE_SEARCH').forced).toBe(true);
    expect(n.data.pieces.length).toBe(pieces0 + 2);
    // peça forçada não soma a checagem por visão (US$ 0,008) na estimativa
    expect(n.data.cost.generateEstimateUsd).toBe(estimate);
    const item = await prisma.variationItem.findUniqueOrThrow({ where: { id: np.id } });
    expect((item.payload as { captionOverride?: boolean }).captionOverride).toBe(true);
    // outras peças seguem sem override
    expect(n.data.pieces.filter((p: Piece) => p.captionOverride).length).toBe(2);
  });

  it('desfazer tira a peça; forçar de novo reusa a candidata (sem nova chamada)', async () => {
    const d = await call('DELETE', `/iterate/${batchId}/caption-blocked/force`, { type: 'NATIVE_SEARCH', template: null });
    expect(d.status).toBe(200);
    expect(d.data.pieces.some((p: Piece) => p.type === 'NATIVE_SEARCH')).toBe(false);
    expect(d.data.insight.captionBlocked.find((x: Blocked) => x.type === 'NATIVE_SEARCH').forced).toBe(false);
    expect((await call('DELETE', `/iterate/${batchId}/caption-blocked/force`, { type: 'NATIVE_SEARCH', template: null })).status).toBe(404);
    const jobs = await forcePlanJobs(batchId);
    const again = await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'NATIVE_SEARCH', template: null });
    expect(again.status).toBe(200);
    expect(await forcePlanJobs(batchId)).toBe(jobs);
    expect(again.data.pieces.find((p: Piece) => p.type === 'NATIVE_SEARCH')?.captionOverride).toBe(true);
  });

  it('render: a peça forçada sai pronta, sem faixa protegida e sem CAPTION_COVERED (mesmo com o mock tampando)', async () => {
    const b = await call('GET', `/iterate/${batchId}`);
    const st = await call('POST', `/iterate/${batchId}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: b.data.cost.generateEstimateUsd ?? 0 });
    expect(st.status).toBe(202);
    const forcedIds = b.data.pieces.filter((p: Piece) => p.captionOverride).map((p: Piece) => p.id);
    const done = await until(() => call('GET', `/iterate/${batchId}`), (r) => r.data.pieces.every((p: Piece) => ['ready', 'failed', 'left_out'].includes(p.status)));
    // controle: sem o override, o mock tampa a legenda e a peça de vídeo cai em CAPTION_COVERED
    const covered = done.data.pieces.filter((p: Piece) => !p.captionOverride && p.errorCode === 'CAPTION_COVERED');
    expect(covered.length).toBeGreaterThan(0);
    for (const id of forcedIds) {
      const p = done.data.pieces.find((x: Piece) => x.id === id);
      expect(p.errorCode).not.toBe('CAPTION_COVERED');
      expect(p.status).toBe('ready');
      const r = await prisma.render.findFirstOrThrow({ where: { creative: { variationItemId: id }, format: 'VERTICAL_9_16' }, orderBy: { createdAt: 'desc' } });
      const input = r.input as Record<string, unknown>;
      expect(input.captionCheck).toBeUndefined();
      const bands = (input.protectedBands ?? (input.video as { protectedBands?: unknown[] } | undefined)?.protectedBands ?? []) as unknown[];
      expect(bands.length).toBe(0);
    }
  });

  it('lote LAUNCHED destravado: forçar cria criativo + render já na fila; pronta sem CAPTION_COVERED; DELETE = 409', async () => {
    const row = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.status).toBe('LAUNCHED');
    const insight = row.insight as Record<string, unknown>;
    await prisma.variationBatch.update({
      where: { id: batchId },
      data: { insight: { ...insight, captionBlocked: [...(insight.captionBlocked as Blocked[]), { type: 'REVIEW', template: null, reason: 'burned_captions' }] } as unknown as Prisma.InputJsonValue },
    });
    const before = await call('GET', `/iterate/${batchId}`);
    const f = await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'REVIEW', template: null });
    expect(f.status).toBe(200);
    expect(f.data.status).toBe('LAUNCHED');
    const p = f.data.pieces.find((x: Piece) => x.type === 'REVIEW' && x.captionOverride);
    expect(p).toBeDefined();
    expect(f.data.pieces.length).toBe(before.data.pieces.length + 1);
    expect(f.data.insight.captionBlocked.find((x: Blocked) => x.type === 'REVIEW').forced).toBe(true);
    const c = await prisma.creative.findFirstOrThrow({ where: { variationItemId: p.id } });
    expect(await prisma.render.count({ where: { creativeId: c.id, priority: 0 } })).toBe(1);
    // forçar de novo = nada novo (nem criativo nem render)
    expect((await call('POST', `/iterate/${batchId}/caption-blocked/force`, { type: 'REVIEW', template: null })).status).toBe(200);
    expect(await prisma.creative.count({ where: { variationItemId: p.id } })).toBe(1);
    const done = await until(() => call('GET', `/iterate/${batchId}`), (r) => ['ready', 'failed'].includes(r.data.pieces.find((x: Piece) => x.id === p.id)?.status));
    const ready = done.data.pieces.find((x: Piece) => x.id === p.id);
    expect(ready.errorCode).toBeNull();
    expect(ready.status).toBe('ready');
    expect(done.data.phase).toBe('download');
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: c.id }, orderBy: { createdAt: 'desc' } });
    expect((r.input as Record<string, unknown>).captionCheck).toBeUndefined();
    const del = await call('DELETE', `/iterate/${batchId}/caption-blocked/force`, { type: 'REVIEW', template: null });
    expect(del.status).toBe(409);
    expect(del.error.details.reason).toBe('launched');
  });

  it('amostra travada (workspace sem plano) em LAUNCHED = 402 locked', async () => {
    const email = `it-${RUN}-s@teste.local`;
    const user = await prisma.user.create({ data: { access: 'SAMPLE', email, name: 'It S', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Acme Amostra ${RUN}`, shortCode: 'MS', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    sampleWsId = w.id;
    const offer = await prisma.offer.create({ data: { workspaceId: w.id, name: 'Sleep', language: 'en', createdById: user.id } });
    const ch = await prisma.champion.create({ data: { workspaceId: w.id, offerId: offer.id, name: 'C', status: 'READY', createdById: user.id } });
    const sb = await prisma.variationBatch.create({
      data: {
        workspaceId: w.id, championId: ch.id, offerId: offer.id, mode: 'AUTO', status: 'LAUNCHED', language: 'en', requests: [], createdById: user.id, launchedAt: new Date(),
        settings: { sample: true }, insight: { captionBlocked: [{ type: 'NATIVE_SEARCH', template: null, reason: 'burned_captions' }] } as unknown as Prisma.InputJsonValue,
      },
    });
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    const own = token;
    token = (await res.json()).data.accessToken;
    try {
      const r = await call('POST', `/iterate/${sb.id}/caption-blocked/force`, { type: 'NATIVE_SEARCH', template: null });
      expect(r.status).toBe(402);
      expect(r.error.details).toMatchObject({ reason: 'locked', unlock: { pieces: 0 } });
    } finally {
      token = own;
    }
  });
});
