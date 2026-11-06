// templates-lista-v1 T-B2 (04/11) de ponta a ponta contra a infra LOCAL (maquina_test), integrações em mock (o fake da ia
// escreve a lista), render fake: equipe usa o template DRAFT `versus` → plano com 1 peça LIST_OVERLAY (ListSpec, vista
// `list`, textos `list.*`) → PATCH …/list (look, colunas, 422/400) → texto inventado 422 → `[mock:list-thin]` = fill pending
// fora do quote até "Fill from Brain" → `[mock:list-no-room]` = 422 no_room → Gerar → render `template` versus.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.TEMPLATES = 'on';
const PORT = 3199;
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
import { configureApp } from '../main';
import { IteracaoService } from './iteracao.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = `tl${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
type Piece = { id: string; type: string; code: string; status: string; list: { templateId: string; look: string; mode: string; fill: string | null; lines: { id: string; text: string }[]; preview: unknown } | null; formats: { format: string; supported?: boolean }[] };

describe(isLocal ? 'Templates de lista (integração local)' : 'Templates de lista [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let token = '';
  let wsId = '';
  let offerId = '';
  let dir = '';
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
  const notes = (n: string | null) => prisma.offer.update({ where: { id: offerId }, data: { notes: n } });
  let championId = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-lista-'));
    const fakePage: PageCapturePort = { capture: async () => ({ error: 'PAGE_UNREADABLE', status: null }) };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAGE_CAPTURE).useValue(fakePage).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const email = `it-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'It L', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Acme Lista ${RUN}`, shortCode: 'MC', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    wsId = w.id;
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = (await res.json()).data.accessToken;
    const o = await prisma.offer.create({
      data: {
        workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app with guided sounds.', audience: 'Busy parents',
        pains: 'Waking up tired. Drinking coffee all day. Scrolling at midnight.', promise: 'Fall asleep fast. Wake up rested.',
        proof: '4000 parents use it. Rated 4.8 stars.', offerAndPrice: '$9.90 per month', cta: 'Download now', createdById: user.id,
      },
    });
    offerId = o.id;
  });

  afterAll(async () => {
    if (wsId) {
      await app.get(IteracaoService).recover(wsId).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: wsId, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: wsId, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creditEntry.deleteMany({ where: { workspaceId: wsId } }).catch(() => undefined);
      await prisma.templateRun.deleteMany({ where: { workspaceId: wsId } });
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
  let piece: Piece;

  it('equipe usa o versus (DRAFT): plano com 1 peça LIST_OVERLAY, vista `list` e textos `list.*`', async () => {
    const path = join(dir, 'v30.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(bytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const use = await call('POST', '/ad-templates/versus/use', { uploadId: c.data.uploadId, offerId });
    expect([use.status, use.error]).toEqual([202, undefined]);
    batchId = use.data.id;
    const b = await settled(batchId);
    expect(b.data.status).toBe('PLAN_READY');
    championId = b.data.source.championId;
    expect(b.data.template.fit).toEqual({ level: 'ok', reason: null });
    expect(b.data.pieces).toHaveLength(1);
    piece = b.data.pieces[0];
    expect(piece).toMatchObject({ type: 'LIST_OVERLAY', code: 'VERSUS', list: { templateId: 'versus', look: 'ink', mode: 'two-col', fill: null } });
    expect(piece.list!.lines.length).toBeGreaterThanOrEqual(6);
    expect(piece.list!.preview).toMatchObject({ props: { mode: 'two-col', look: 'ink' } });
    const texts = b.data.template.texts.find((t: { pieceId: string }) => t.pieceId === piece.id).items.map((x: { path: string }) => x.path);
    expect(texts).toEqual(expect.arrayContaining(['list.heads.bad', 'list.heads.good', 'list.lines.l1']));
    const item = await prisma.variationItem.findUniqueOrThrow({ where: { id: piece.id } });
    expect((item.payload as { params: Record<string, unknown> }).params).toMatchObject({ type: 'LIST_OVERLAY', templateId: 'versus', look: 'ink', columns: 2, fill: null });
    expect(b.data.summary.pieces).toBe(1);
    expect(b.data.template.quote).toBe(1);
  });

  it('PATCH …/list: look e colunas; corpo vazio 400; texto inventado 422 TEXT_INVALID', async () => {
    const r = await call('PATCH', `/iterate/${batchId}/items/${piece.id}/list`, { look: 'paper', columns: 1 });
    expect([r.status, r.error]).toEqual([200, undefined]);
    expect(r.data.pieces[0].list).toMatchObject({ look: 'paper', mode: 'one-col' });
    expect((await call('PATCH', `/iterate/${batchId}/items/${piece.id}/list`, {})).status).toBe(400);
    expect((await call('PATCH', `/iterate/${batchId}/items/${piece.id}/list`, { look: 'neon' })).status).toBe(400);
    const back = await call('PATCH', `/iterate/${batchId}/items/${piece.id}/list`, { columns: 2 });
    expect(back.data.pieces[0].list.mode).toBe('two-col');
    const bad = await call('PATCH', `/iterate/${batchId}/items/${piece.id}/texts`, { texts: [{ path: 'list.lines.l1', value: 'Lost 97 hours' }] });
    expect(bad.status).toBe(422);
    expect(bad.error).toMatchObject({ code: 'TEXT_INVALID' });
    expect(bad.error.details.violations).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'list.lines.l1', rule: 'invented_number' })]));
    const ok = await call('PATCH', `/iterate/${batchId}/items/${piece.id}/texts`, { texts: [{ path: 'list.lines.l1', value: 'Always tired' }] });
    expect([ok.status, ok.error]).toEqual([200, undefined]);
    expect(ok.data.pieces[0].list.lines[0].text).toBe('Always tired');
  });

  it('[mock:list-thin]: fill pending fica fora do quote; Fill from Brain inclui; value-stack não aceita colunas', async () => {
    await notes('[mock:list-thin]');
    const use = await call('POST', '/ad-templates/value-stack/use', { championId, offerId });
    expect([use.status, use.error]).toEqual([202, undefined]);
    const b = await settled(use.data.id);
    expect(b.data.status).toBe('PLAN_READY');
    const p: Piece = b.data.pieces[0];
    expect(p).toMatchObject({ type: 'LIST_OVERLAY', list: { templateId: 'value-stack', fill: 'pending' } });
    expect(b.data.summary.pieces).toBe(0);
    expect(b.data.template.quote).toBe(0);
    const cols = await call('PATCH', `/iterate/${use.data.id}/items/${p.id}/list`, { columns: 2 });
    expect([cols.status, cols.error?.code]).toEqual([422, 'EDIT_NOT_SUPPORTED']);
    const fill = await call('PATCH', `/iterate/${use.data.id}/items/${p.id}/list`, { acceptFill: true });
    expect([fill.status, fill.error]).toEqual([200, undefined]);
    expect(fill.data.pieces[0].list.fill).toBe('accepted');
    expect(fill.data.summary.pieces).toBe(1);
    expect(fill.data.template.quote).toBe(1);
  });

  it('[mock:list-no-room]: anúncio lido = 422 TEMPLATE_DOESNT_FIT no_room (hard; o DRAFT não aparece na galeria)', async () => {
    await notes('[mock:list-no-room]');
    const use = await call('POST', '/ad-templates/versus/use', { championId, offerId });
    expect(use.status).toBe(422);
    expect(use.error).toMatchObject({ code: 'TEMPLATE_DOESNT_FIT', details: { reason: 'no_room' } });
    await notes(null);
  });

  it('Gerar: render `template` versus pronto no 9:16', async () => {
    const b = await call('GET', `/iterate/${batchId}`);
    const st = await call('POST', `/iterate/${batchId}/start`, { expectedPieces: b.data.summary.pieces, expectedCostUsd: b.data.cost.generateEstimateUsd ?? 0, expectedCredits: b.data.template.quote });
    expect([st.status, st.error]).toEqual([202, undefined]);
    const done = await until(() => call('GET', `/iterate/${batchId}`), (r) => ['ready', 'failed'].includes(r.data.pieces[0]?.status));
    const p = done.data.pieces[0];
    expect(p.status).toBe('ready');
    const r = await prisma.render.findFirstOrThrow({ where: { creative: { variationItemId: p.id }, format: 'VERTICAL_9_16' }, orderBy: { createdAt: 'desc' } });
    expect(r.input).toMatchObject({ kind: 'template', templateId: 'versus', props: { mode: 'two-col' } });
    expect((r.input as { checkpoints: unknown[] }).checkpoints).toHaveLength(3);
  });
});
