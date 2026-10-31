// B2 da variação automática v1 (variacao-auto-v1 §11; Revisão 23/10 §14) contra a infra LOCAL (maquina_test), integrações em
// mock e render fake de verdade (ffmpeg): lote AUTO com 11 peças → 11 renders 9:16 (STATIC no GPT Image 2 via stub da porta,
// fora da fila do Remotion), formato sob demanda na frente do lote, idempotência, formato falho não derruba a peça, STATIC
// recusado → reenvio seguro, custo em imagesUsd, teto, Leave out/Retry, nome e colisão, download ?format (format_not_ready),
// Library, travas, zip com os formatos prontos, Home conta o lote 1 vez, retomada do IMAGE_GEN.
// O plano e o LAUNCHED (B1) são simulados direto no banco; o start chama PecasAutoService.createPieces como o B1 chama.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3189;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AutoVariationType, type VariationAxis } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { StorageService } from '../arquivos/storage.service';
import { hashPassword } from '../common/util/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZipService } from '../iteracao/zip.service';
import { JobsService } from '../jobs/jobs.service';
import { configureApp } from '../main';
import { PecasAutoService } from './pecas.service';
import { mmddUtc } from './pecas';
import { ImagemEstaticaService } from './imagem-estatica.service';
import { installStaticImageStub, type StaticStub } from './imagem-estatica.stub';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const PLAN: { type: AutoVariationType; code: string; axis: VariationAxis; params: Record<string, unknown> }[] = [
  { type: 'CUT', code: 'CUT-15S', axis: 'ITERATION', params: { targetSec: 15, blockIndexes: [0, 2] } },
  { type: 'CUT', code: 'CUT-20S', axis: 'ITERATION', params: { targetSec: 20, blockIndexes: [0, 1, 2] } },
  { type: 'COLD_OPEN', code: 'COLD-OPEN', axis: 'ITERATION', params: { teaserStartSec: 5, teaserEndSec: 7 } },
  { type: 'HOOK_TEXT', code: 'HOOK-TEXT-2', axis: 'ITERATION', params: { text: 'Hook 2' } },
  { type: 'ENDCARD', code: 'ENDCARD-CTA', axis: 'ITERATION', params: { variant: 'cta', headline: 'Download', subline: null, ctaText: 'Get it' } },
  { type: 'HOOK_TEXT', code: 'HOOK-TEXT-3', axis: 'ITERATION', params: { text: 'Hook 3' } },
  { type: 'SPLIT_LP', code: 'LAYOUT-SPLIT-LP', axis: 'DIVERSITY', params: {} },
  { type: 'STORY', code: 'LAYOUT-STORY', axis: 'DIVERSITY', params: {} },
  { type: 'REVIEW', code: 'LAYOUT-REVIEW', axis: 'DIVERSITY', params: { quote: 'Great', author: null, stars: 5 } },
  { type: 'NATIVE_SEARCH', code: 'NATIVE-SEARCH', axis: 'DIVERSITY', params: { query: 'how to x' } },
  { type: 'STATIC', code: 'STATIC-F1', axis: 'DIVERSITY', params: { headline: 'Proof', refAtSec: 3, visual: { object: 'A parent in their 30s', scene: 'Kitchen at night', vibe: 'Warm lamp light', style: 'everyday_photo', headlinePlacement: 'top' } } },
];

describe(isLocal ? 'Peças do lote AUTO B2 (integração local)' : 'Peças AUTO [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const who: Record<'A' | 'B' | 'C', { id: string; userId: string; token: string }> = {} as never;
  let dir: string;
  let offerId: string;
  let championId: string;
  let batchId: string;
  let launchedAt: Date;
  const items: Record<string, string> = {}; // code → pieceId
  let stub: StaticStub;
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown, k: 'A' | 'B' | 'C' = 'A') => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${who[k].token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error, meta: j.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 240_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  const pieces = () => app.get(PecasAutoService).pieces({ id: batchId, workspaceId: who.A.id, status: 'LAUNCHED' });
  const settled = (ps: { status: string }[]) => ps.every((p) => ['ready', 'failed', 'left_out'].includes(p.status));

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-b2auto-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    stub = installStaticImageStub(app, { publicApiUrl: process.env.PUBLIC_API_URL!, usd: 0.4, delayMs: 300 });
    const hash = await hashPassword(PASSWORD);
    const login = async (email: string) => {
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      return (await res.json()).data.accessToken as string;
    };
    for (const k of ['A', 'B'] as const) {
      const email = `b2auto-${RUN}-${k.toLowerCase()}@teste.local`;
      const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: `B2auto ${k}`, passwordHash: hash } });
      const w = await prisma.workspace.create({ data: { name: `b2auto-${RUN}-${k}`, shortCode: 'TS', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      who[k] = { id: w.id, userId: user.id, token: await login(email) };
    }
    const cEmail = `b2auto-${RUN}-c@teste.local`;
    const cu = await prisma.user.create({ data: { access: 'INTERNAL', email: cEmail, name: 'B2auto Client', passwordHash: hash, memberships: { create: { workspaceId: who.A.id, role: 'CLIENT' } } } });
    who.C = { id: who.A.id, userId: cu.id, token: await login(cEmail) };

    offerId = (await prisma.offer.create({
      data: { workspaceId: who.A.id, name: 'Oferta auto', language: 'en', what: 'App', promise: 'Save time', cta: 'Download', notes: 'teste [mock:render-fail:STORY] [mock:format-fail:CUT]', createdById: who.A.userId },
    })).id;
    // campeão "analisado": vídeo de verdade no storage de teste, 8 s
    const path = join(dir, 'champ.mp4');
    await run(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const video = await app.get(StorageService).put(path, { workspaceId: who.A.id, kind: 'CHAMPION_VIDEO', mimeType: 'video/mp4', meta: { durationSec: 8, width: 360, height: 640 } });
    championId = (await prisma.champion.create({
      data: { workspaceId: who.A.id, offerId, name: 'Champ promo', status: 'READY', rights: 'OWN', videoFileId: video.id, durationSec: 8, hasSpeech: true, language: 'en', createdById: who.A.userId },
    })).id;

    const words = Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
    await prisma.teardown.create({
      data: {
        workspaceId: who.A.id, championId,
        transcript: { language: 'en', text: words.map((w) => w.word).join(' '), words, wpm: 120, wordsSource: 'whisper' },
        measurements: { silences: words.slice(1).map((w, i) => ({ startSec: words[i].endSec, endSec: w.startSec })), palette: ['#112233', '#ddeeff'] },
        sections: {
          hook: { status: 'ok', naReason: null, data: { endSec: 2, visual: 'v', onScreenText: null, spoken: 'w0 w1 w2 w3' } },
          structure: { status: 'ok', naReason: null, data: { blocks: [
            { label: 'hook', function: 'hook', startSec: 0, endSec: 2, onScreen: '', speech: '' },
            { label: 'body', function: 'body', startSec: 2, endSec: 6, onScreen: '', speech: '' },
            { label: 'cta', function: 'cta', startSec: 6, endSec: 8, onScreen: '', speech: '' },
          ] } },
        },
      },
    });

    // colisão: outro criativo do workspace já tem o nome do CUT-15S de hoje (D6 → a peça ganha _2)
    launchedAt = new Date();
    await prisma.creative.create({
      data: { workspaceId: who.A.id, offerId, name: 'velho', language: 'en', state: 'APPROVED', createdById: who.A.userId, adName: `TS_${mmddUtc(launchedAt)}_CUT-15S` },
    });

    // plano pronto + LAUNCHED (o que o B1 faz), e o start chamando o serviço do B2 na mesma transação
    const png = join(dir, 'page.png');
    await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=270x480', '-frames:v', '1', png]);
    const pageCapture = await app.get(StorageService).put(png, { workspaceId: who.A.id, kind: 'PAGE_CAPTURE', mimeType: 'image/png', meta: { width: 270, height: 480 } });
    const b = await prisma.variationBatch.create({
      data: {
        pageCaptureFileId: pageCapture.id,
        workspaceId: who.A.id, championId, offerId, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: who.A.userId,
        insight: { blocks: [{ index: 0, label: 'hook', fn: 'hook', startSec: 0, endSec: 2, kept: true }, { index: 1, label: 'body', fn: 'proof', startSec: 2, endSec: 6, kept: false }, { index: 2, label: 'cta', fn: 'cta', startSec: 6, endSec: 8, kept: true }] },
        items: {
          create: PLAN.map((p, index) => ({
            workspaceId: who.A.id, kind: 'AUTO_EDIT' as const, index, status: 'READY' as const, autoType: p.type, code: p.code, axis: p.axis,
            change: `changes ${p.code}`, rationale: 'r', payload: { params: { type: p.type, ...p.params } },
          })),
        },
      },
      include: { items: true },
    });
    batchId = b.id;
    for (const i of b.items) items[i.code!] = i.id;
  });

  afterAll(async () => {
    const ids = [who.A?.id, who.B?.id].filter(Boolean) as string[];
    if (ids.length) {
      await until(() => prisma.render.count({ where: { workspaceId: { in: ids }, status: { in: ['QUEUED', 'RENDERING'] } } }), (n) => n === 0, 120_000);
      await app.get(JobsService).idle();
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.providerTask.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.render.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.updateMany({ where: { workspaceId: { in: ids } }, data: { zipFileId: null } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `b2auto-${RUN}-` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const piece = async (code: string) => (await pieces()).find((p) => p.code === code)!;
  const fmt = (p: { formats?: { format: string; state: string }[] }, f: string) => p.formats!.find((x) => x.format === f)!;

  it('start: 11 peças → 11 criativos RENDERING e 11 renders (só 9:16; STATIC = IMAGE_GEN); pedido 1:1 passa na frente do lote; 1 falha não para as outras', async () => {
    const svc = app.get(PecasAutoService);
    const db = app.get(PrismaService);
    stub.mode = 'reject'; // §14.7 [mock:static-reject]: 1ª recusa, o reenvio seguro passa
    const launchedPieces = await db.$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt } });
      return svc.createPieces(tx, { batchId, userId: who.A.userId, launchedAt });
    });
    const { creativeIds } = launchedPieces;
    expect(creativeIds).toHaveLength(11);
    expect(launchedPieces.staticRenderIds).toHaveLength(1);
    expect(await prisma.creative.count({ where: { id: { in: creativeIds }, state: 'RENDERING', variationKind: 'AUTO_EDIT' } })).toBe(11);
    const born = await prisma.render.findMany({ where: { creativeId: { in: creativeIds } }, include: { creative: { select: { variationItem: { select: { autoType: true } } } } } });
    expect(born).toHaveLength(11);
    expect(born.every((r) => r.format === 'VERTICAL_9_16' && r.priority === 0 && r.status === 'QUEUED')).toBe(true);
    expect(born.filter((r) => r.engine === 'IMAGE_GEN').map((r) => r.creative.variationItem!.autoType)).toEqual(['STATIC']);
    svc.launched(launchedPieces);

    // assim que a 1ª peça fica pronta, pede o 1:1 dela: roda antes dos 9:16 do lote que ainda estão na fila
    const first = await until(pieces, (ps) => ps.find((p) => p.code === 'CUT-15S')!.status === 'ready', 120_000);
    const queuedLot = await prisma.render.findMany({ where: { creativeId: { in: creativeIds }, status: 'QUEUED', engine: 'REMOTION' }, select: { id: true } });
    const req = await call('POST', `/iterate/pieces/${items['CUT-15S']}/formats`, { format: '1x1' });
    expect(req.status).toBe(202);
    expect(fmt(req.data, '1x1').state).toMatch(/queued|rendering/);
    expect(first.find((p) => p.code === 'CUT-15S')!.status).toBe('ready');

    const done = await until(pieces, (ps) => settled(ps) && ps.every((p) => p.formats!.every((f) => f.state !== 'queued' && f.state !== 'rendering')));
    expect(settled(done)).toBe(true);
    const byCode = Object.fromEntries(done.map((p) => [p.code, p]));
    expect(byCode['LAYOUT-STORY']).toMatchObject({ status: 'failed', errorCode: 'RENDER_ERROR', retryHint: 'retry', retryUsd: 0, formatsReady: 0 });
    expect(fmt(byCode['LAYOUT-STORY'], '9x16')).toMatchObject({ state: 'failed', errorCode: 'RENDER_ERROR', requestUsd: 0 });
    expect(done.filter((p) => p.status === 'ready')).toHaveLength(10);

    // ordem real (startedAt) do Remotion: os 9:16 na ordem do plano; o 1:1 pedido entrou antes de todos os que estavam na fila
    const rs = await prisma.render.findMany({
      where: { creativeId: { in: creativeIds }, engine: 'REMOTION' }, orderBy: { startedAt: 'asc' },
      select: { id: true, format: true, startedAt: true, creative: { select: { variationItem: { select: { index: true } } } } },
    });
    const verticals = rs.filter((r) => r.format === 'VERTICAL_9_16');
    expect(verticals.map((r) => r.creative.variationItem!.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const square = rs.find((r) => r.format === 'SQUARE_1_1')!;
    expect(queuedLot.length).toBeGreaterThan(0);
    const queuedStarts = rs.filter((r) => queuedLot.some((q) => q.id === r.id)).map((r) => r.startedAt!.getTime());
    expect(square.startedAt!.getTime()).toBeLessThan(Math.min(...queuedStarts));
  });

  it('peça pronta: APPROVED sozinha, adName CLIENTE_MMDD_CODIGO (colisão → _2), formats[]/files só com o que ficou pronto; STATIC = imagem nova (reenvio seguro), pôster = a imagem', async () => {
    const ps = await pieces();
    const mmdd = mmddUtc(launchedAt);
    const cut = ps.find((p) => p.code === 'CUT-15S')!;
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: cut.creativeId! }, include: { finalRender: true } });
    expect(c).toMatchObject({ state: 'APPROVED', adName: `TS_${mmdd}_CUT-15S_2`, approvedById: who.A.userId, variationCode: 'CUT-15S' });
    expect(c.finalRender!.format).toBe('VERTICAL_9_16');
    expect(cut.files.map((f) => f.name)).toEqual([`TS_${mmdd}_CUT-15S_2_9x16.mp4`, `TS_${mmdd}_CUT-15S_2_1x1.mp4`]);
    expect(cut).toMatchObject({ previewReady: true, formatsReady: 2, media: 'video', retryUsd: null, folder: '1-stretch', poster: expect.objectContaining({ id: expect.any(String) }) });
    expect(cut.formats!.map((f) => [f.format, f.state, f.requestUsd])).toEqual([['9x16', 'ready', null], ['4x5', 'none', 0], ['1x1', 'ready', null]]);
    const hook = ps.find((p) => p.code === 'HOOK-TEXT-2')!;
    expect(hook.files.map((f) => f.format)).toEqual(['9x16']);

    const st = ps.find((p) => p.code === 'STATIC-F1')!;
    expect(st).toMatchObject({ status: 'ready', media: 'image', formatsReady: 1, folder: '2-new-audience' });
    expect(st.files.map((f) => [f.name, f.mimeType, f.durationSec])).toEqual([[`TS_${mmdd}_STATIC-F1_9x16.png`, 'image/png', null]]);
    expect(st.formats!.map((f) => [f.format, f.state, f.requestUsd])).toEqual([['9x16', 'ready', null], ['4x5', 'none', 0.4], ['1x1', 'none', 0.4]]);
    const sr = await prisma.render.findFirstOrThrow({ where: { creativeId: st.creativeId!, format: 'VERTICAL_9_16' }, include: { providerTasks: { orderBy: { submittedAt: 'asc' } }, creative: true } });
    expect(sr).toMatchObject({ engine: 'IMAGE_GEN', status: 'READY', durationSec: null });
    expect(sr.creative.thumbnailFileId).toBe(sr.fileId);
    expect(sr.providerTasks.map((t) => [t.status, t.errorCode, (t.input as any).safe, !!t.handledAt])).toEqual([['FAILED', 'SAFETY_BLOCK', false, true], ['COMPLETED', null, true, true]]);
    expect((sr.input as any)).toMatchObject({ aspectRatio: '9:16', safe: true, model: 'openai/gpt-image-2/text-to-image', providerTaskIds: sr.providerTasks.map((t) => t.id) });
    const call0 = stub.calls.find((x) => x.renderId === sr.id)!;
    expect(call0).toMatchObject({ aspectRatio: '9:16', safe: false, creativeId: st.creativeId, variationBatchId: batchId, spec: { headline: 'Proof', screenLanguage: 'en', visual: { style: 'everyday_photo', headlinePlacement: 'top' } } });
    expect(call0.notes).toContain('[mock:render-fail:STORY]');

    // download ?format: pronto = arquivo; não pronto = 409 format_not_ready; valor inválido = 400
    const d = await call('GET', `/creatives/${cut.creativeId}/download?format=1x1`);
    expect(d.data).toMatchObject({ fileName: `TS_${mmdd}_CUT-15S_2_1x1.mp4`, frozen: true });
    expect((await call('GET', `/creatives/${st.creativeId}/download`)).data.fileName).toBe(`TS_${mmdd}_STATIC-F1_9x16.png`);
    expect((await call('GET', `/creatives/${cut.creativeId}/download?format=4x5`)).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'format_not_ready' } });
    expect((await call('GET', `/creatives/${cut.creativeId}/download?format=2x3`)).status).toBe(400);
  });

  it('POST /formats: 400 9x16; 403 CLIENT; 404 outro workspace; 409 peça não ready; idempotente (200 na fila/pronto); formato falho não derruba a peça e o pedido de novo passa', async () => {
    const cut = items['CUT-15S'];
    expect((await call('POST', `/iterate/pieces/${cut}/formats`, { format: '9x16' })).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await call('POST', `/iterate/pieces/${cut}/formats`, { format: '4x5' }, 'C')).status).toBe(403);
    expect((await call('POST', `/iterate/pieces/${cut}/formats`, { format: '4x5' }, 'B')).status).toBe(404);
    expect((await call('POST', `/iterate/pieces/${items['LAYOUT-STORY']}/formats`, { format: '4x5' })).error).toMatchObject({ code: 'INVALID_STATE', details: { state: 'failed', allowed: ['ready'] } });
    const n0 = await prisma.render.count({ where: { creative: { variationItemId: cut } } });
    const again = await call('POST', `/iterate/pieces/${cut}/formats`, { format: '1x1' }); // já pronto
    expect(again.status).toBe(200);
    expect(await prisma.render.count({ where: { creative: { variationItemId: cut } } })).toBe(n0);

    // [mock:format-fail:CUT]: a 1ª tentativa do 4:5 falha → só o formato failed; a peça segue ready, sem erro no item
    const a = await call('POST', `/iterate/pieces/${cut}/formats`, { format: '4x5' });
    expect(a.status).toBe(202);
    expect(await prisma.render.count({ where: { creative: { variationItemId: cut } } })).toBe(n0 + 1);
    const failed = await until(() => piece('CUT-15S'), (p) => fmt(p, '4x5').state === 'failed');
    expect(failed).toMatchObject({ status: 'ready', errorCode: null, formatsReady: 2 });
    expect(fmt(failed, '4x5')).toMatchObject({ state: 'failed', errorCode: 'RENDER_ERROR', failReason: expect.any(String), requestUsd: 0 });
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: failed.creativeId! } });
    expect(c.state).toBe('APPROVED');
    const retry = await call('POST', `/iterate/pieces/${cut}/formats`, { format: '4x5' });
    expect(retry.status).toBe(202);
    const ok = await until(() => piece('CUT-15S'), (p) => fmt(p, '4x5').state === 'ready');
    expect(ok.formatsReady).toBe(3);
    expect(await prisma.render.count({ where: { creative: { variationItemId: cut } } })).toBe(n0 + 2);
    expect(await prisma.render.count({ where: { creative: { variationItemId: cut }, stale: true, format: 'PORTRAIT_4_5' } })).toBe(1);
  });

  it('STATIC sob demanda: reject-all → só o formato failed SAFETY_BLOCK (2 tasks); de novo passa e cobra; teto no 1:1; custo em imagesUsd (fora do analysisUsd)', async () => {
    const st = items['STATIC-F1'];
    stub.mode = 'reject-all';
    expect((await call('POST', `/iterate/pieces/${st}/formats`, { format: '4x5' })).status).toBe(202);
    const dup = await call('POST', `/iterate/pieces/${st}/formats`, { format: '4x5' }); // rodando (a imagem leva 300 ms × 2)
    expect(dup.status).toBe(200);
    expect(fmt(dup.data, '4x5')).toMatchObject({ state: 'rendering', progress: 0, requestUsd: null });
    const f = await until(() => piece('STATIC-F1'), (p) => fmt(p, '4x5').state === 'failed');
    expect(f.status).toBe('ready');
    expect(fmt(f, '4x5')).toMatchObject({ errorCode: 'SAFETY_BLOCK', failReason: 'The image model refused this concept. Retry tries again; Leave out removes it.', requestUsd: 0.4 });
    const r45 = await prisma.render.findFirstOrThrow({ where: { creativeId: f.creativeId!, format: 'PORTRAIT_4_5', stale: false }, include: { providerTasks: true } });
    expect(r45).toMatchObject({ engine: 'IMAGE_GEN', priority: 10, errorCode: 'SAFETY_BLOCK' });
    expect(r45.providerTasks).toHaveLength(2);
    stub.mode = 'ok';
    expect((await call('POST', `/iterate/pieces/${st}/formats`, { format: '4x5' })).status).toBe(202);
    const ok = await until(() => piece('STATIC-F1'), (p) => fmt(p, '4x5').state === 'ready');
    expect(ok.files.map((x) => x.format)).toEqual(['9x16', '4x5']);
    expect(stub.calls.filter((x) => x.aspectRatio === '4:5').length).toBe(3);

    // teto: gasto do mês + 1 imagem > teto = 409, nada criado (vídeo não passa pelo teto)
    await prisma.workspace.update({ where: { id: who.A.id }, data: { monthlySpendCapUsd: 0.5 } });
    const n = await prisma.render.count({ where: { creativeId: ok.creativeId! } });
    expect((await call('POST', `/iterate/pieces/${st}/formats`, { format: '1x1' })).error).toMatchObject({ code: 'SPEND_CAP_EXCEEDED' });
    expect(await prisma.render.count({ where: { creativeId: ok.creativeId! } })).toBe(n);
    await prisma.workspace.update({ where: { id: who.A.id }, data: { monthlySpendCapUsd: null } });

    const b = await call('GET', `/iterate/${batchId}`);
    expect(b.data.cost).toMatchObject({ imagesUsd: 0.8, analysisUsd: 0, renderUsd: 0, totalUsd: 0.8, generateEstimateUsd: null });
    expect(b.data.summary.videoCreditsUsd).toBe(0);
    // files = formatos na fila/rodando/prontos das peças não left_out: 10 9:16 + CUT 1:1 + CUT 4:5 + STATIC 4:5
    expect(b.data.summary.files).toBe(13);
    expect(b.data.phase).toBe('download');
    expect(b.data.summary.renderEtaSec).toBe(0);
  });

  it('Library: media, formats (só os prontos), filtros variationCode e media=video; VariationRef com code/axis', async () => {
    const all = await call('GET', `/library?variationKind=AUTO_EDIT&limit=50`);
    expect(all.data).toHaveLength(10);
    const st = all.data.find((i: any) => i.variation?.code === 'STATIC-F1');
    expect(st).toMatchObject({ media: 'image', variation: { kind: 'AUTO_EDIT', code: 'STATIC-F1', axis: 'DIVERSITY' } });
    expect(st.formats.map((f: any) => f.format)).toEqual(['9x16', '4x5']);
    const one = await call('GET', `/library?variationCode=CUT-20S`);
    expect(one.data.map((i: any) => i.variation.code)).toEqual(['CUT-20S']);
    expect(one.data[0].media).toBe('video');
    expect(one.data[0].formats.map((f: any) => f.format)).toEqual(['9x16']);
    const vids = await call('GET', `/library?media=video&limit=50`);
    expect(vids.data.some((i: any) => i.variation?.code === 'STATIC-F1')).toBe(false);
    expect(vids.data.some((i: any) => i.variation?.code === 'CUT-20S')).toBe(true);
  });

  it('travas: peça AUTO recusa edit, render, editor e generate com variation_locked', async () => {
    const ps = await pieces();
    const id = ps.find((p) => p.code === 'LAYOUT-STORY')!.creativeId!;
    for (const [m, path, body] of [
      ['PATCH', `/creatives/${id}/edit`, { headline: 'x' }],
      ['POST', `/creatives/${id}/render`, {}],
      ['GET', `/creatives/${id}/editor`, undefined],
      ['POST', `/creatives/${id}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: 1 }],
    ] as const) {
      const r = await call(m, path, body);
      expect([path, r.error]).toEqual([path, expect.objectContaining({ code: 'INVALID_STATE', details: expect.objectContaining({ reason: 'variation_locked' }) })]);
    }
  });

  it('Home: lote AUTO conta 1 vez (PIECES_READY, readyCount) e as peças não entram no needs_you', async () => {
    const h = await call('GET', `/creatives?filter=needs_you`);
    expect(h.meta.waitingOnYou).toEqual({ creatives: 0, batches: 1, total: 1 });
    expect(h.meta.counts.needs_you).toBe(0);
    expect(h.meta.waitingBatches).toEqual([expect.objectContaining({ id: batchId, status: 'PIECES_READY', mode: 'AUTO', readyCount: 10 })]);
    expect(h.data).toHaveLength(0);
  });

  it('Leave out, Retry (só o 9:16 FAILED, grátis), In zip; outro workspace 404; CLIENT só no In zip', async () => {
    const story = items['LAYOUT-STORY'];
    expect((await call('PATCH', `/iterate/pieces/${story}`, { inZip: false })).error).toMatchObject({ code: 'INVALID_STATE', details: { state: 'failed', allowed: ['ready'] } });
    expect((await call('POST', `/iterate/pieces/${story}/retry`, {}, 'C')).status).toBe(403);
    expect((await call('POST', `/iterate/pieces/${story}/leave-out`, {}, 'B')).status).toBe(404);
    const lo = await call('POST', `/iterate/pieces/${story}/leave-out`, {});
    expect(lo.status).toBe(200);
    expect(lo.data).toMatchObject({ status: 'left_out', inZip: false, retryUsd: 0 });
    expect((await call('POST', `/iterate/pieces/${story}/leave-out`, {})).error.code).toBe('INVALID_STATE');

    const before = await prisma.render.count({ where: { creative: { variationItemId: story } } });
    const rt = await call('POST', `/iterate/pieces/${story}/retry`, {});
    expect(rt.status).toBe(202);
    expect(rt.data.status).toMatch(/queued|rendering/);
    expect(await prisma.render.count({ where: { creative: { variationItemId: story } } })).toBe(before + 1); // só o 9:16
    const ok = await until(pieces, (ps) => ps.find((p) => p.id === story)!.status === 'ready');
    expect(ok.find((p) => p.id === story)).toMatchObject({ status: 'ready', formatsReady: 1, errorCode: null, inZip: false, retryUsd: null });

    // CLIENT pode o In zip
    const cl = await call('PATCH', `/iterate/pieces/${story}`, { inZip: true }, 'C');
    expect(cl.status).toBe(200);
    expect(cl.data.inZip).toBe(true);
    expect((await call('PATCH', `/iterate/pieces/${items['NATIVE-SEARCH']}`, { inZip: false })).data.inZip).toBe(false);
  });

  it('zip: 202 building → ready; 2 pastas + README, só peças ready com inZip, só os formatos prontos; mesmo zipKey = 200; formato novo pronto muda a chave', async () => {
    expect((await call('POST', `/iterate/${batchId}/zip`, {}, 'B')).status).toBe(404);
    const r = await call('POST', `/iterate/${batchId}/zip`, {}, 'C');
    expect(r.status).toBe(202);
    expect(r.data.zip).toMatchObject({ status: 'building', pieces: 10, files: 13, folders: { stretch: '1-stretch-its-life', newAudience: '2-new-audience' } });
    const zipSvc = app.get(ZipService);
    const ready = await until(() => zipSvc.view(who.A.id, batchId), (z) => z.status === 'ready', 120_000);
    expect(ready).toMatchObject({ status: 'ready', fileName: `TS_${mmddUtc(launchedAt)}_CHAMP-PROMO_variations.zip` });
    expect(ready.url).toContain('response-content-disposition');

    const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { zipFile: true } });
    expect(b.downloadedAt).not.toBeNull();
    const buf = await app.get(StorageService).read(b.zipFile!);
    const zpath = join(dir, 'out.zip');
    await writeFile(zpath, buf);
    const { stdout } = await run('unzip', ['-v', zpath]);
    const names = stdout.split('\n').map((l) => l.trim().split(/\s+/).pop()!).filter((n) => n?.includes('/'));
    const mmdd = mmddUtc(launchedAt);
    expect(names.filter((n) => n.startsWith('1-stretch-its-life/'))).toHaveLength(6 + 2 + 1);
    expect(names.filter((n) => n.startsWith('2-new-audience/'))).toHaveLength(4 + 1 + 1);
    expect(names).toContain('1-stretch-its-life/README.txt');
    expect(names).toContain('2-new-audience/README.txt');
    expect(names).toContain(`1-stretch-its-life/TS_${mmdd}_CUT-15S_2_9x16.mp4`);
    expect(names).toContain(`1-stretch-its-life/TS_${mmdd}_CUT-15S_2_4x5.mp4`);
    expect(names).toContain(`1-stretch-its-life/TS_${mmdd}_CUT-15S_2_1x1.mp4`);
    expect(names).toContain(`2-new-audience/TS_${mmdd}_STATIC-F1_9x16.png`);
    expect(names).toContain(`2-new-audience/TS_${mmdd}_STATIC-F1_4x5.png`);
    expect(names).toContain(`2-new-audience/TS_${mmdd}_LAYOUT-STORY_9x16.mp4`);
    expect(names.some((n) => n.includes('CUT-20S_4x5') || n.includes('LAYOUT-STORY_4x5'))).toBe(false); // não pedidos
    expect(names.some((n) => n.includes('NATIVE-SEARCH'))).toBe(false); // fora do zip
    expect(stdout).toMatch(/Stored/); // modo store, sem compressão
    expect(stdout).not.toMatch(/Defl/);
    const { stdout: readme } = await run('unzip', ['-p', zpath, '2-new-audience/README.txt']);
    expect(readme).toContain(`TS_${mmdd}_LAYOUT-REVIEW_9x16.mp4 → changes LAYOUT-REVIEW`);

    const again = await call('POST', `/iterate/${batchId}/zip`, {});
    expect(again.status).toBe(200);
    expect(again.data.zip.status).toBe('ready');
    const h = await call('GET', `/creatives?filter=needs_you`);
    expect(h.meta.waitingOnYou.batches).toBe(0);
    expect(h.meta.waitingBatches).toEqual([]);

    // formato novo pronto = zipKey muda: o zip volta a `none` (refeito no próximo clique) com 1 arquivo a mais
    expect((await call('POST', `/iterate/pieces/${items['CUT-20S']}/formats`, { format: '1x1' })).status).toBe(202);
    await until(() => piece('CUT-20S'), (p) => fmt(p, '1x1').state === 'ready');
    const z2 = await zipSvc.view(who.A.id, batchId);
    expect(z2).toMatchObject({ status: 'none', files: 14 });

    // nada pra zipar = 409 nothing_to_zip
    await prisma.variationItem.updateMany({ where: { batchId }, data: { inZip: false } });
    expect((await call('POST', `/iterate/${batchId}/zip`, {})).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'nothing_to_zip' } });
  });

  it('STATIC no 9:16: reject-all → peça failed SAFETY_BLOCK (retryUsd); Retry checa o teto e cobra; timeout reenvia; retomada do IMAGE_GEN no boot', async () => {
    const svc = app.get(PecasAutoService);
    const db = app.get(PrismaService);
    const at = new Date();
    const b2 = await prisma.variationBatch.create({
      data: {
        workspaceId: who.A.id, championId, offerId, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: who.A.userId,
        items: { create: [{ workspaceId: who.A.id, kind: 'AUTO_EDIT', index: 0, status: 'READY', autoType: 'STATIC', code: 'STATIC-F2', axis: 'DIVERSITY', change: 'new image', rationale: 'r',
          payload: { params: { type: 'STATIC', atSec: 2, headline: 'Legacy plan' } } }] }, // plano antigo: sem visual
      },
      include: { items: true },
    });
    const pid = b2.items[0].id;
    expect((await call('GET', `/iterate/${b2.id}`)).data.cost.generateEstimateUsd).toBe(0.4);
    stub.mode = 'reject-all';
    const lp = await db.$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: b2.id }, data: { status: 'LAUNCHED', launchedAt: at } });
      return svc.createPieces(tx, { batchId: b2.id, userId: who.A.userId, launchedAt: at });
    });
    svc.launched(lp);
    const failed = await until(() => svc.pieceById(pid), (p) => p.status === 'failed');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'SAFETY_BLOCK', retryHint: 'retry', retryUsd: 0.4, media: 'image', formatsReady: 0 });
    expect(failed.failReason).toMatch(/refused this concept/);
    const legacyCall = stub.calls.filter((x) => x.creativeId === failed.creativeId);
    expect(legacyCall.map((x) => x.safe)).toEqual([false, true]);
    expect(legacyCall[0].spec).toEqual({ headline: 'Legacy plan', screenLanguage: 'en', visual: { object: '', scene: '', vibe: '', style: 'ad_graphic', headlinePlacement: 'center' } });

    // Retry do STATIC: teto com 1 imagem
    await prisma.workspace.update({ where: { id: who.A.id }, data: { monthlySpendCapUsd: 0.5 } });
    expect((await call('POST', `/iterate/pieces/${pid}/retry`, {})).error).toMatchObject({ code: 'SPEND_CAP_EXCEEDED' });
    expect((await svc.pieceById(pid)).status).toBe('failed');
    await prisma.workspace.update({ where: { id: who.A.id }, data: { monthlySpendCapUsd: null } });
    stub.mode = 'timeout'; // 1ª tentativa TIMEOUT → reenvio igual (não seguro) passa
    const rt = await call('POST', `/iterate/pieces/${pid}/retry`, {});
    expect(rt.status).toBe(202);
    const ok = await until(() => svc.pieceById(pid), (p) => p.status === 'ready');
    expect(ok).toMatchObject({ status: 'ready', errorCode: null, retryUsd: null, formatsReady: 1 });
    const cur = await prisma.render.findFirstOrThrow({ where: { creativeId: ok.creativeId!, stale: false, format: 'VERTICAL_9_16' }, include: { providerTasks: { orderBy: { submittedAt: 'asc' } } } });
    expect(cur.providerTasks.map((t) => [t.status, (t.input as any).safe])).toEqual([['TIMEOUT', false], ['COMPLETED', false]]);
    const v = await call('GET', `/iterate/${b2.id}`);
    expect(v.data.cost).toMatchObject({ imagesUsd: 0.4, generateEstimateUsd: null });

    // retomada: IMAGE_GEN QUEUED (pedido que a API não chegou a submeter) e RENDERING sem task → submete no boot
    stub.mode = 'ok';
    const q = await prisma.render.create({ data: { workspaceId: who.A.id, creativeId: ok.creativeId!, status: 'QUEUED', format: 'SQUARE_1_1', engine: 'IMAGE_GEN', priority: 10, settings: { templateId: 'auto-edit' }, input: {} } });
    const orphan = await prisma.render.create({ data: { workspaceId: who.A.id, creativeId: ok.creativeId!, status: 'RENDERING', format: 'PORTRAIT_4_5', engine: 'IMAGE_GEN', priority: 10, settings: { templateId: 'auto-edit' }, input: {}, startedAt: new Date() } });
    expect(await app.get(ImagemEstaticaService).recover(who.A.id)).toBe(2);
    const back = await until(() => prisma.render.findMany({ where: { id: { in: [q.id, orphan.id] } } }), (rs) => rs.every((r) => r.status === 'READY'));
    expect(back.map((r) => r.status)).toEqual(['READY', 'READY']);
    expect((await svc.pieceById(pid)).formatsReady).toBe(3);
  });
});
