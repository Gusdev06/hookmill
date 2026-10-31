// B6 (§13.15) de ponta a ponta contra a infra LOCAL: Trocar avatar com Kling/Seedance mantendo a edição, variante (A)
// áudio original. Integrações em mock (custo zero, ia I6), medição real (ffmpeg, video V5), render fake.
// Podcast de 20 s: main 0-16 s (2 janelas encadeadas), convidada 16-17 s, main 17-20 s. Pula se o banco não for localhost.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { EditMap } from '@maquina/contratos';
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
import { OrquestradorService } from '../geracao/orquestrador.service';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = `b6-${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const FPS = 25;
const SEC = 20;

const seg = (startFrame: number, endFrame: number, role: 'main' | 'other_person', region: { x: number; y: number; w: number; h: number }) => ({
  startFrame, endFrame, region, fullFrame: false, faceInRegion: [{ atFrame: startFrame, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.92, role,
});
function podcastMap(): EditMap {
  const ok = { available: true, blockers: [] };
  const top = { x: 0, y: 0, w: 720, h: 640 };
  return {
    version: 1, width: 720, height: 1280, fps: FPS, frameCount: SEC * FPS,
    cells: [{ startFrame: 0, endFrame: SEC * FPS, cells: [top, { x: 0, y: 640, w: 720, h: 640 }] }],
    faceTrack: [seg(0, 400, 'main', top), seg(400, 425, 'other_person', top), seg(425, 500, 'main', top)],
    timeline: [{ startFrame: 0, endFrame: 400, kind: 'main' }, { startFrame: 400, endFrame: 425, kind: 'other_person' }, { startFrame: 425, endFrame: 500, kind: 'main' }],
    layers: [{
      id: 'cap', kind: 'caption', startFrame: 0, endFrame: SEC * FPS, box: { x: 40, y: 960, w: 640, h: 80 },
      background: { kind: 'solid', color: '#000000', box: { x: 20, y: 950, w: 680, h: 100 } },
      style: { fontId: 'montserrat-800', uppercase: false, fontSizePx: 48, lineHeight: 1.15, color: '#FFFFFF', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 4, shadow: true, align: 'center' },
      text: null, wordsPerPage: 3, source: 'vision',
    }],
    overlaysOverFace: [], profile: null, keepEdit: { SWAP_AVATAR: ok, NEW_HOOKS: ok },
  };
}

describe(isLocal ? 'B6 Trocar avatar com Kling/Seedance (A) (integração local)' : 'B6 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let token: string;
  let wsId: string;
  let userId: string;
  let dir: string;
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = Number(process.env.B6_WAIT_MS ?? 240_000)): Promise<T> => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 400));
      v = await fn();
    }
    return v;
  };
  const settled = (id: string) =>
    until(() => prisma.creative.findUniqueOrThrow({ where: { id } }), (c) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED', 'EDIT_PENDING'].includes(c.state));

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-b6-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: process.env.B6_LOG ? ['error', 'warn'] : ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const email = `${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'B6', passwordHash: await hashPassword(PASSWORD) } });
    userId = user.id;
    const w = await prisma.workspace.create({ data: { name: RUN, shortCode: 'TS', monthlySpendCapUsd: 500, memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    wsId = w.id;
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = ((await r.json()) as any).data.accessToken;
  });

  afterAll(async () => {
    if (wsId && !process.env.B6_KEEP) {
      await until(() => prisma.creative.count({ where: { workspaceId: wsId, state: { in: ['SCENES_GENERATING', 'RENDERING'] } } }), (n) => n === 0, 120_000);
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { selectedFaceId: null, selectedScriptId: null, finalRenderId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: wsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: wsId } });
      await prisma.upload.deleteMany({ where: { workspaceId: wsId } });
      await prisma.job.deleteMany({ where: { workspaceId: wsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { email: `${RUN}@teste.local` } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  let champ: string;

  it('campeão podcast READY com mapa de 2 trechos main; engineVoice no detalhe', async () => {
    const offerId = (await prisma.offer.create({ data: { workspaceId: wsId, name: 'Swap offer', language: 'en', what: 'App', promise: 'Save', cta: 'Download', createdById: userId } })).id;
    const path = join(dir, 'podcast.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=${FPS}:duration=${SEC}`, '-f', 'lavfi', '-i', `sine=frequency=300:duration=${SEC}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path,
    ], { timeout: 60_000 });
    const bytes = await readFile(path);
    const up = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'podcast.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(up.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: bytes });
    await call('POST', `/uploads/${up.data.uploadId}/complete`, {});
    const cr = await call('POST', '/champions', { offerId, uploadId: up.data.uploadId, rights: 'OWN' });
    const done = await until(() => call('GET', `/champions/${cr.data.id}`), (r) => ['READY', 'FAILED'].includes(r.data?.status), 300_000);
    expect(done.data.status).toBe('READY');
    champ = cr.data.id;
    const t = await prisma.teardown.findUniqueOrThrow({ where: { championId: champ } });
    // 2,6 palavras/s, o ritmo da fala do mock da ia (a voz do motor (B) sai no mesmo ritmo)
    const step = 1 / 2.6;
    const words = Array.from({ length: Math.floor(SEC * 2.6) }, (_, i) => ({ word: `w${i}`, startSec: Math.round(i * step * 1000) / 1000, endSec: Math.round((i * step + step * 0.85) * 1000) / 1000 }));
    const sections = { ...(t.sections as any) };
    sections.hook = { status: 'ok', naReason: null, data: { endSec: 2, visual: 'v', onScreenText: 'Hook', spoken: 'w0 w1 w2 w3' } };
    sections.structure = { status: 'ok', naReason: null, data: { blocks: [{ label: 'body', function: 'body', startSec: 0, endSec: SEC, onScreen: '', speech: '' }] } };
    await prisma.teardown.update({
      where: { id: t.id },
      data: { sections, transcript: { language: 'en', text: words.map((w) => w.word).join(' '), words, wpm: 120, wordsSource: 'whisper' }, editMap: podcastMap() as unknown as Prisma.InputJsonValue },
    });
    await prisma.champion.update({ where: { id: champ }, data: { hasSpeech: true, language: 'en' } });
    const d = await call('GET', `/champions/${champ}`);
    expect(d.data.keepEdit.SWAP_AVATAR).toEqual({ available: true, blockers: [] });
    expect(d.data.engineVoice).toEqual({ available: true, blockers: [] });
  });

  it('lote: tabela da §13.15.1 (400), voz do motor só no Seedance; KLING com áudio do campeão', async () => {
    const req = { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] };
    const rule = async (settings: object) => (await call('POST', `/champions/${champ}/batches`, { ...req, settings })).error?.details?.fields?.[0];
    expect(await rule({ swapEngine: 'KLING', keepEdit: false })).toEqual({ field: 'settings.swapEngine', rule: 'video_engine_needs_keep_edit' });
    expect(await rule({ voiceSource: 'ENGINE_VOICE' })).toEqual({ field: 'settings.voiceSource', rule: 'engine_voice_needs_video_engine' });
    expect(await rule({ swapEngine: 'SEEDANCE', voiceSource: 'CATALOG' })).toEqual({ field: 'settings.voiceSource', rule: 'catalog_voice_not_in_keep_edit' });
    expect(await rule({ swapEngine: 'KLING', voiceSource: 'ENGINE_VOICE' })).toEqual({ field: 'settings.voiceSource', rule: 'engine_voice_seedance_only' });
    expect((await call('POST', `/champions/${champ}/batches`, { ...req, settings: { swapEngine: 'VEO' } })).status).toBe(400);
    const cr = await call('POST', `/champions/${champ}/batches`, { ...req, settings: { swapEngine: 'KLING' } });
    expect(cr.status).toBe(202);
    expect(cr.data.settings).toMatchObject({ swapEngine: 'KLING', voiceSource: 'CHAMPION_AUDIO', keepEdit: true });
  });

  async function readyBatch(swapEngine: 'KLING' | 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' | 'ENGINE_VOICE' = 'CHAMPION_AUDIO'): Promise<string> {
    const cr = await call('POST', `/champions/${champ}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { swapEngine, voiceSource } });
    const id = cr.data.id;
    const b = await until(() => call('GET', `/variation-batches/${id}`), (r) => r.data && r.data.status !== 'PLANNING');
    expect(b.data.status).toBe('PLAN_READY');
    const c = b.data.castings[0];
    await call('POST', `/variation-batches/${id}/castings/${c.id}/faces/generate`, { description: 'Woman in her 30s, studio, podcast mic' });
    const ready = await until(() => call('GET', `/variation-batches/${id}`), (r) => r.data.castings[0].batches[0]?.faces.every((f: any) => f.status !== 'QUEUED' && f.status !== 'GENERATING'));
    const face = ready.data.castings[0].batches[0].faces.find((f: any) => f.status === 'READY');
    await call('POST', `/variation-batches/${id}/castings/${c.id}/faces/${face.id}/select`, {});
    return id;
  }

  let batchId: string;
  let creativeId: string;

  it('estimativa: 3 motores lado a lado (5 linhas), seleção do lote, (B) notEnabled; PATCH troca o motor sem replan', async () => {
    batchId = await readyBatch('KLING');
    const est = (await call('GET', `/variation-batches/${batchId}/estimate`)).data;
    expect(est.swapQuotes.map((q: any) => [q.engine, q.voiceSource, q.selected, q.available, q.notEnabled])).toEqual([
      ['LIPSYNC', 'CHAMPION_AUDIO', false, true, false],
      ['KLING', 'CHAMPION_AUDIO', true, true, false],
      ['KLING', 'ENGINE_VOICE', false, false, true],
      ['SEEDANCE', 'CHAMPION_AUDIO', false, true, false],
      ['SEEDANCE', 'ENGINE_VOICE', false, true, false],
    ]);
    const kling = est.swapQuotes[1];
    expect(kling.resolution).toBe('1080p');
    expect(est.items[0].costUsd).toBeCloseTo(kling.perItemUsd, 4);
    expect(est.costUsd).toBeCloseTo(kling.costUsd, 4);
    const p = await call('PATCH', `/variation-batches/${batchId}/settings`, { swapEngine: 'SEEDANCE' });
    expect(p.data.settings.swapEngine).toBe('SEEDANCE');
    expect(p.data.items[0].status).toBe('READY');
    const est2 = (await call('GET', `/variation-batches/${batchId}/estimate`)).data;
    expect(est2.swapQuotes.find((q: any) => q.selected).engine).toBe('SEEDANCE');
    await call('PATCH', `/variation-batches/${batchId}/settings`, { swapEngine: 'KLING' });
  });

  it('launch (A) Kling: 1 cena SWAP_VIDEO por trecho, sem take; janelas em sequência → emenda → v2v → READY → render', async () => {
    const est = (await call('GET', `/variation-batches/${batchId}/estimate`)).data;
    const l = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.costUsd });
    expect(l.status).toBe(202);
    creativeId = l.data.creatives[0].id;
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: creativeId } });
    expect(c).toMatchObject({ engine: 'SCENES', engineModel: 'kling-3.0', voiceSource: 'CHAMPION_AUDIO' });
    expect(await prisma.take.count({ where: { creativeId } })).toBe(0);
    const scenes = await prisma.scene.findMany({ where: { creativeId }, orderBy: { index: 'asc' } });
    expect(scenes.map((s) => [s.pipeline, s.label, s.startFrame, s.endFrame])).toEqual([['SWAP_VIDEO', 'Trecho 1', 0, 400], ['SWAP_VIDEO', 'Trecho 2', 425, 500]]);

    const end = await settled(creativeId);
    expect(end.state).toBe('RENDER_READY');
    const s = await call('GET', `/creatives/${creativeId}/scenes`);
    const [t1, t2] = s.data.scenes;
    expect(t1.swap).toMatchObject({ engine: 'KLING', voiceSource: 'CHAMPION_AUDIO', startFrame: 0, endFrame: 400, stage: 'done' });
    expect(t1.swap.windows.length).toBeGreaterThanOrEqual(2); // 16 s > 14,5 s
    expect(t1.swap.windows.map((w: any) => [w.startImage, w.status, w.resolution])).toEqual(
      t1.swap.windows.map((_: any, i: number) => [i ? 'PREVIOUS_LAST_FRAME' : 'FACE', 'READY', '1080p']),
    );
    expect(t1.swap.windows.every((w: any) => w.clip?.url)).toBe(true);
    expect(t2.swap.windows).toHaveLength(1);
    expect(t1.swap.regenerateEstimateUsd).toBeGreaterThan(0);
    // janela k+1 só foi submetida depois da k (sequência) e partiu de outra imagem
    const tasks = await prisma.providerTask.findMany({ where: { sceneId: t1.id, kind: 'SCENE_VIDEO' }, orderBy: { submittedAt: 'asc' } });
    expect(tasks.map((x) => x.windowIndex)).toEqual(t1.swap.windows.map((_: any, i: number) => i));
    expect(tasks[1].submittedAt.getTime()).toBeGreaterThanOrEqual(tasks[0].completedAt!.getTime());
    expect((tasks[1].input as any).faceImageUrl).not.toBe((tasks[0].input as any).faceImageUrl);
    // clipe cru no nº exato de frames do trecho; áudio = fatia do campeão; v2v com esse par
    const rows = await prisma.scene.findMany({ where: { creativeId }, orderBy: { index: 'asc' }, include: { rawClipFile: true, audioFile: true, clipFile: true } });
    expect(Number(rows[0].rawClipFile!.durationSec)).toBeCloseTo(16, 2);
    expect(Number(rows[0].clipFile!.durationSec)).toBeCloseTo(16, 2); // v2v reposto no nº exato de frames
    expect(Number(rows[1].audioFile!.durationSec)).toBeCloseTo(3, 2);
    const lip = await prisma.providerTask.findFirstOrThrow({ where: { sceneId: t1.id, kind: 'LIPSYNC_VIDEO' } });
    expect(lip.status).toBe('COMPLETED');
    // render: overlays dos trechos main apontam pro clipe da cena dona; o trecho da convidada fica como o original
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId, stale: false }, orderBy: { createdAt: 'desc' } });
    const ov = (r.input as any).overlays as { startFrame: number; endFrame: number; clipOffsetSec: number; clipUrl: string }[];
    expect(ov.map((o) => [o.startFrame, o.endFrame, o.clipOffsetSec])).toEqual([[0, 400, 0], [425, 500, 0]]);
    expect(new URL(ov[0].clipUrl).pathname).not.toBe(new URL(ov[1].clipUrl).pathname);
  });

  it('webhook repetido e fora de ordem não mexe na cena pronta', async () => {
    const orq = app.get(OrquestradorService);
    const scene = await prisma.scene.findFirstOrThrow({ where: { creativeId, index: 0 } });
    const win0 = await prisma.providerTask.findFirstOrThrow({ where: { sceneId: scene.id, kind: 'SCENE_VIDEO', windowIndex: 0 } });
    await prisma.providerTask.update({ where: { id: win0.id }, data: { handledAt: null } });
    await orq.handle(win0.id);
    const ghost = await prisma.providerTask.create({
      data: { workspaceId: wsId, provider: 'WAVESPEED', kind: 'LIPSYNC_VIDEO', model: 'x', externalId: `ghost-${RUN}`, status: 'COMPLETED', input: {}, outputUrls: ['http://127.0.0.1:1/nope.mp4'], sceneId: scene.id, completedAt: new Date() },
    });
    await orq.handle(ghost.id);
    const after = await prisma.scene.findUniqueOrThrow({ where: { id: scene.id } });
    expect(after).toMatchObject({ status: 'READY', clipFileId: scene.clipFileId, rawClipFileId: scene.rawClipFileId, windows: scene.windows, attempt: 1 });
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: creativeId } })).state).toBe('RENDER_READY');
  });

  it('Refazer trecho: sem confirm = 409 com o preço; falha na janela = FAILED com motivo e só aquele trecho; refazer de novo = READY', async () => {
    const no = await call('POST', `/creatives/${creativeId}/scenes/1/regenerate`, {});
    expect(no.status).toBe(409);
    expect(no.error.details).toMatchObject({ reason: 'regenerate_swap_scene' });
    const price = no.error.details.estimateUsd;
    expect(price).toBeGreaterThan(0);
    const before = await prisma.scene.findMany({ where: { creativeId }, orderBy: { index: 'asc' } });
    const r = await call('POST', `/creatives/${creativeId}/scenes/1/regenerate`, { confirm: true, expectedCostUsd: price, visualPrompt: '[mock:PROVIDER_ERROR]' });
    expect(r.status).toBe(202);
    expect((await settled(creativeId)).state).toBe('SCENES_FAILED');
    const failed = await prisma.scene.findMany({ where: { creativeId }, orderBy: { index: 'asc' } });
    expect(failed[1]).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', attempt: 2, rawClipFileId: null });
    expect(failed[0]).toMatchObject({ status: 'READY', attempt: 1, clipFileId: before[0].clipFileId });
    const v = await call('GET', `/creatives/${creativeId}/scenes`);
    expect(v.data.scenes[1]).toMatchObject({ status: 'FAILED', action: 'regenerate', swap: { stage: 'windows' } });
    expect(v.data.scenes[1].swap.windows[0]).toMatchObject({ attempt: 2, seed: 8 });

    const ok = await call('POST', `/creatives/${creativeId}/scenes/1/regenerate`, { confirm: true, expectedCostUsd: price, visualPrompt: 'podcast studio' });
    expect(ok.status).toBe(202);
    expect((await settled(creativeId)).state).toBe('RENDER_READY');
    const s1 = await prisma.scene.findFirstOrThrow({ where: { creativeId, index: 1 } });
    expect(s1).toMatchObject({ status: 'READY', attempt: 3 });
    // a task da tentativa 2 chegando de novo é ignorada
    const old = await prisma.providerTask.findFirstOrThrow({ where: { sceneId: s1.id, kind: 'SCENE_VIDEO', status: 'FAILED' } });
    await prisma.providerTask.update({ where: { id: old.id }, data: { handledAt: null } });
    await app.get(OrquestradorService).handle(old.id);
    expect((await prisma.scene.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe('READY');
  });

  it('revisão: SCENE com o preço do trecho mais caro, FACE, TEXT; sem LINE', async () => {
    const rv = await call('GET', `/creatives/${creativeId}/review`);
    expect(rv.status).toBe(200);
    expect(rv.data.changeOptions.map((o: any) => o.type)).toEqual(['SCENE', 'TEXT', 'FACE']);
    const scene = rv.data.changeOptions[0];
    const s = await call('GET', `/creatives/${creativeId}/scenes`);
    expect(scene.estimateUsd).toBeCloseTo(Math.max(...s.data.scenes.map((x: any) => x.swap.regenerateEstimateUsd)), 4);
  });

  it('identidade: o rosto virou outra pessoa = FAILED IDENTITY_DRIFT com a nota medida', async () => {
    await prisma.champion.update({ where: { id: champ }, data: { notes: '[mock:identity-drift]' } });
    const no = await call('POST', `/creatives/${creativeId}/scenes/1/regenerate`, {});
    const r = await call('POST', `/creatives/${creativeId}/scenes/1/regenerate`, { confirm: true, expectedCostUsd: no.error.details.estimateUsd });
    expect(r.status).toBe(202);
    expect((await settled(creativeId)).state).toBe('SCENES_FAILED');
    const s1 = await prisma.scene.findFirstOrThrow({ where: { creativeId, index: 1 } });
    expect(s1).toMatchObject({ status: 'FAILED', errorCode: 'IDENTITY_DRIFT' });
    expect(Number(s1.identityScore)).toBeLessThan(0.363);
    await prisma.champion.update({ where: { id: champ }, data: { notes: null } });
  });

  it('launch (A) Seedance: mesmo caminho, resolução pela região', async () => {
    const id = await readyBatch('SEEDANCE');
    const est = (await call('GET', `/variation-batches/${id}/estimate`)).data;
    const q = est.swapQuotes.find((x: any) => x.selected);
    expect(q.engine).toBe('SEEDANCE');
    expect(['480p', '720p']).toContain(q.resolution);
    const l = await call('POST', `/variation-batches/${id}/launch`, { expectedCostUsd: est.costUsd });
    const cid = l.data.creatives[0].id;
    expect((await prisma.creative.findUniqueOrThrow({ where: { id: cid } })).engineModel).toBe('seedance-2.0');
    expect((await settled(cid)).state).toBe('RENDER_READY');
    const s = await call('GET', `/creatives/${cid}/scenes`);
    expect(s.data.scenes.every((x: any) => x.swap.stage === 'done' && x.swap.windows.every((w: any) => w.resolution === q.resolution))).toBe(true);
  });

  // ───────── (B) voz do motor (só Seedance) ─────────

  let bId: string;

  it('(B) Seedance: janelas com a fala → emenda → transcrição → reencaixe → clipe no nº exato de frames; áudio montado e legenda mesclada', async () => {
    const id = await readyBatch('SEEDANCE', 'ENGINE_VOICE');
    const est = (await call('GET', `/variation-batches/${id}/estimate`)).data;
    expect(est.swapQuotes.find((q: any) => q.selected)).toMatchObject({ engine: 'SEEDANCE', voiceSource: 'ENGINE_VOICE', available: true });
    const l = await call('POST', `/variation-batches/${id}/launch`, { expectedCostUsd: est.costUsd });
    expect(l.status).toBe(202);
    bId = l.data.creatives[0].id;
    expect(await prisma.creative.findUniqueOrThrow({ where: { id: bId } })).toMatchObject({ engineModel: 'seedance-2.0', voiceSource: 'ENGINE_VOICE' });
    expect((await settled(bId)).state).toBe('RENDER_READY');
    const rows = await prisma.scene.findMany({ where: { creativeId: bId }, orderBy: { index: 'asc' }, include: { clipFile: true, audioFile: true } });
    for (const r of rows) {
      expect(r.status).toBe('READY');
      expect(['EXACT', 'STRETCH']).toContain((r.fit as any).mode);
      expect(Math.abs((r.fit as any).ratio - 1)).toBeLessThanOrEqual(0.08);
      expect(Number(r.clipFile!.durationSec)).toBeCloseTo((r.endFrame! - r.startFrame!) / FPS, 2);
      expect(r.audioFile).not.toBeNull();
      const ws = r.words as any[];
      expect(ws.length).toBeGreaterThan(0);
      expect(ws.every((w) => w.startSec >= 0 && w.endSec <= (r.endFrame! - r.startFrame!) / FPS + 1e-6)).toBe(true);
    }
    // a 1ª janela da 1ª cena falou as palavras dela, com som
    const w0 = await prisma.providerTask.findFirstOrThrow({ where: { sceneId: rows[0].id, kind: 'SCENE_VIDEO', windowIndex: 0 } });
    expect(w0.input as any).toMatchObject({ sound: true });
    expect(String((w0.input as any).speech)).toMatch(/^w0 w1/);
    const v = await call('GET', `/creatives/${bId}/scenes`);
    expect(v.data.scenes[0].swap).toMatchObject({ voiceSource: 'ENGINE_VOICE', stage: 'done', fit: { mode: expect.any(String) } });
    // render: áudio montado nos 2 trechos (o clipe de cada cena) e o karaokê da legenda inteira redesenhado
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: bId, stale: false }, orderBy: { createdAt: 'desc' } });
    const input = r.input as any;
    expect(input.audioSplice.fadeMs).toBe(10);
    expect(input.audioSplice.spans.map((s: any) => [s.startFrame, s.endFrame])).toEqual([[0, 400], [425, 500]]);
    const cap = input.textLayers.find((t: any) => t.content.kind === 'karaoke');
    expect(cap).toMatchObject({ startFrame: 0, endFrame: 500 });
    expect(cap.content.words.length).toBeGreaterThan(40);
  });

  it('(B) falhas com motivo, sem regerar sozinho: fala lenta = VOICE_FIT_OUT_OF_RANGE; fala trocada = SPEECH_MISMATCH', async () => {
    const redo = async () => {
      const no = await call('POST', `/creatives/${bId}/scenes/1/regenerate`, {});
      expect(no.error.details.reason).toBe('regenerate_swap_scene');
      expect((await call('POST', `/creatives/${bId}/scenes/1/regenerate`, { confirm: true, expectedCostUsd: no.error.details.estimateUsd })).status).toBe(202);
      expect((await settled(bId)).state).toBe('SCENES_FAILED');
      return prisma.scene.findFirstOrThrow({ where: { creativeId: bId, index: 1 } });
    };
    await prisma.champion.update({ where: { id: champ }, data: { notes: '[mock:voice-fit-out]' } });
    expect(await redo()).toMatchObject({ status: 'FAILED', errorCode: 'VOICE_FIT_OUT_OF_RANGE', fit: null });
    await prisma.champion.update({ where: { id: champ }, data: { notes: '[mock:speech-mismatch]' } });
    expect(await redo()).toMatchObject({ status: 'FAILED', errorCode: 'SPEECH_MISMATCH' });
    expect(await prisma.providerTask.count({ where: { sceneId: (await prisma.scene.findFirstOrThrow({ where: { creativeId: bId, index: 1 } })).id, kind: 'TRANSCRIBE' } })).toBe(3);
    await prisma.champion.update({ where: { id: champ }, data: { notes: null } });
  });
});
