// B5 (§13) de ponta a ponta contra a infra LOCAL, integrações em mock (custo zero), render fake (ffmpeg).
// Take contínuo: criativo do zero com LIPSYNC = 1 take (TTS → LIPSYNC → TRANSCRIBE) fatiado em cenas TAKE_SLICE;
// "Refazer cena" numa fatia = 409 regenerate_take sem confirm, take inteiro com confirm; take/regenerate; LINE.
// Manter a edição: keepEdit no campeão, 422 KEEP_EDIT_UNSUPPORTED, lote com Trocar avatar (take AUDIO_LIPSYNC na janela
// do rosto) e gancho escrito (SOURCE_CUT, US$ 0, edição travada). Pula se o banco não for localhost.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3196;
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
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(480_000);
const RUN = `b5-${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const DONE = ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'];

/** EditMap escrito à mão: 720x1280 a 25 fps, 8 s; rosto numa caixa de 1 s a 7 s. */
function editMapFixture(over: Partial<EditMap['keepEdit']> = {}): EditMap {
  const ok = { available: true, blockers: [] };
  return {
    version: 1, width: 720, height: 1280, fps: 25, frameCount: 200,
    cells: [{ startFrame: 0, endFrame: 200, cells: [{ x: 0, y: 0, w: 720, h: 640 }, { x: 0, y: 640, w: 720, h: 640 }] }],
    faceTrack: [{ startFrame: 25, endFrame: 175, region: { x: 0, y: 0, w: 720, h: 640 }, fullFrame: false, faceInRegion: [{ atFrame: 25, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.92 }],
    layers: [],
    overlaysOverFace: [],
    profile: null,
    keepEdit: { SWAP_AVATAR: ok, NEW_HOOKS: ok, ...over },
  };
}

describe(isLocal ? 'B5 take contínuo + manter a edição (integração local)' : 'B5 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let token: string;
  let wsId: string;
  let userId: string;
  let voiceId: string;
  let dir: string;
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
      v = await fn();
    }
    return v;
  };
  const stateOf = async (id: string) => (await call('GET', `/creatives/${id}`)).data?.state as string;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-b5-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    voiceId = app.get<CatalogService>(CATALOG_SERVICE).voices('en')[0].id;
    const email = `${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { email, name: 'B5', passwordHash: await hashPassword(PASSWORD) } });
    userId = user.id;
    const w = await prisma.workspace.create({ data: { name: RUN, shortCode: 'TS', monthlySpendCapUsd: 500, memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    wsId = w.id;
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = ((await r.json()) as any).data.accessToken;
  });

  afterAll(async () => {
    if (wsId) {
      await until(() => prisma.creative.count({ where: { workspaceId: wsId, state: { in: ['SCENES_GENERATING', 'RENDERING'] } } }), (n) => n === 0, 90_000);
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

  // ───────── take contínuo no criativo do zero ─────────

  let id: string;

  it('criativo do zero com LIPSYNC: 1 take (TTS → LIPSYNC → TRANSCRIBE), cenas = fatias contíguas, render com o clipe inteiro', async () => {
    const offer = await call('POST', '/offers', { name: 'Take Offer', language: 'en', what: 'An app', promise: 'Save time', cta: 'Get it' });
    id = (await call('POST', '/creatives', { offerId: offer.data.id })).data.id;
    await until(() => stateOf(id), (s) => s !== 'SCRIPTS_WRITING');
    const scripts = await call('GET', `/creatives/${id}/scripts`);
    await call('POST', `/creatives/${id}/scripts/${scripts.data.scripts.find((s: any) => s.status === 'READY').id}/select`, {});
    await call('POST', `/creatives/${id}/faces/generate`, { description: 'woman in her 30s, kitchen, natural light' });
    await until(() => stateOf(id), (s) => s !== 'FACES_GENERATING');
    const face = (await call('GET', `/creatives/${id}/faces`)).data.batches[0].faces.find((f: any) => f.status === 'READY');
    expect((await call('POST', `/creatives/${id}/faces/${face.id}/select`, {})).data.state).toBe('ENGINE_PENDING');

    const q = `engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${voiceId}`;
    const est = await call('GET', `/creatives/${id}/estimate?${q}`);
    expect(est.status).toBe(200);
    // um take só: uma linha de LIPSYNC (um arredondamento)
    expect(est.data.lines.filter((l: any) => l.kind === 'LIPSYNC')).toHaveLength(1);
    const gen = await call('POST', `/creatives/${id}/generate`, { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', voiceId, format: 'VERTICAL_9_16', expectedCostUsd: est.data.costUsd });
    expect(gen.status).toBe(202);
    expect(gen.data.creative.take).toMatchObject({ kind: 'TTS_LIPSYNC', attempt: 1 });
    expect(gen.data.scenes.every((s: any) => s.take?.id === gen.data.creative.take.id)).toBe(true);

    await until(() => stateOf(id), (s) => DONE.includes(s), 120_000);
    expect(await stateOf(id)).toBe('RENDER_READY');
    const take = await prisma.take.findFirstOrThrow({ where: { creativeId: id, stale: false } });
    expect(take).toMatchObject({ kind: 'TTS_LIPSYNC', status: 'READY', seed: 7, generation: 1 });
    const tasks = await prisma.providerTask.findMany({ where: { takeId: take.id } });
    expect(tasks.map((t) => t.kind).sort()).toEqual(['LIPSYNC', 'TRANSCRIBE', 'TTS']);
    const slices = await prisma.scene.findMany({ where: { creativeId: id, stale: false }, orderBy: { index: 'asc' } });
    expect(await prisma.providerTask.count({ where: { sceneId: { in: slices.map((s) => s.id) } } })).toBe(0);
    expect(slices.every((s) => s.pipeline === 'TAKE_SLICE' && s.status === 'READY' && s.clipFileId === take.clipFileId)).toBe(true);
    expect(Number(slices[0].takeStartSec)).toBe(0);
    for (let i = 1; i < slices.length; i++) expect(Number(slices[i].takeStartSec)).toBeCloseTo(Number(slices[i - 1].takeEndSec), 3);
    const clip = await prisma.file.findUniqueOrThrow({ where: { id: take.clipFileId! } });
    expect(Number(slices[slices.length - 1].takeEndSec)).toBeCloseTo(Number(clip.durationSec), 2);
    // render: as fatias do mesmo take viram UMA cena (o clipe contínuo), com as palavras no tempo do take
    const render = await prisma.render.findFirstOrThrow({ where: { creativeId: id }, orderBy: { createdAt: 'desc' } });
    const input = render.input as any;
    expect(input.scenes).toHaveLength(1);
    const ws = input.scenes[0].words as { startSec: number }[];
    expect(ws.length).toBeGreaterThan(0);
    for (let i = 1; i < ws.length; i++) expect(ws[i].startSec).toBeGreaterThanOrEqual(ws[i - 1].startSec);

    const detail = await call('GET', `/creatives/${id}`);
    expect(detail.data.take).toMatchObject({ id: take.id, status: 'READY', progress: 100 });
    expect(detail.data.take.clip.url).toContain('X-Amz-Signature');
    expect(detail.data.take.regenerateEstimateUsd).toBeGreaterThanOrEqual(0);
    const scenes = await call('GET', `/creatives/${id}/scenes`);
    expect(scenes.data.scenes[0].take).toMatchObject({ id: take.id, startSec: 0 });
  });

  it('"Refazer cena" numa fatia: sem confirm = 409 regenerate_take; com confirm = take inteiro (attempt 2, seed 8)', async () => {
    const no = await call('POST', `/creatives/${id}/scenes/0/regenerate`, {});
    expect(no.status).toBe(409);
    expect(no.error.details).toMatchObject({ reason: 'regenerate_take' });
    const take = await prisma.take.findFirstOrThrow({ where: { creativeId: id, stale: false } });
    expect(no.error.details.takeId).toBe(take.id);
    expect(typeof no.error.details.estimateUsd).toBe('number');
    expect(await stateOf(id)).toBe('RENDER_READY');

    const ok = await call('POST', `/creatives/${id}/scenes/0/regenerate`, { confirm: true, expectedCostUsd: no.error.details.estimateUsd });
    expect(ok.status).toBe(202);
    const t2 = await prisma.take.findUniqueOrThrow({ where: { id: take.id } });
    expect(t2).toMatchObject({ attempt: 2, seed: 8 });
    await until(() => stateOf(id), (s) => DONE.includes(s), 120_000);
    expect(await stateOf(id)).toBe('RENDER_READY');
    expect(await prisma.providerTask.count({ where: { takeId: take.id, kind: 'LIPSYNC' } })).toBe(2);
    const sl = await prisma.scene.findMany({ where: { creativeId: id, stale: false } });
    expect(sl.every((s) => s.status === 'READY' && s.attempt === 2)).toBe(true);
  });

  it('POST /take/regenerate: preço que mudou = ESTIMATE_CHANGED; com o preço = 202 Take', async () => {
    const t = (await call('GET', `/creatives/${id}`)).data.take;
    const est = t.regenerateEstimateUsd as number;
    if (est > 0) expect((await call('POST', `/creatives/${id}/take/regenerate`, { expectedCostUsd: Math.round((est / 3) * 10_000) / 10_000 })).error.code).toBe('ESTIMATE_CHANGED');
    const r = await call('POST', `/creatives/${id}/take/regenerate`, { expectedCostUsd: est });
    expect(r.status).toBe(202);
    expect(r.data).toMatchObject({ id: t.id, attempt: 3, kind: 'TTS_LIPSYNC' });
    expect((await call('POST', `/creatives/${id}/take/regenerate`, { expectedCostUsd: est })).status).toBe(409); // take pendente
    await until(() => stateOf(id), (s) => DONE.includes(s), 120_000);
    expect(await stateOf(id)).toBe('RENDER_READY');
  });

  it('LINE com falha forçada: TTS do texto inteiro de novo; take FAILED derruba todas as fatias → SCENES_FAILED', async () => {
    const review = await call('GET', `/creatives/${id}/review`);
    const opt = review.data.changeOptions.find((o: any) => o.type === 'LINE');
    expect(opt.estimateUsd).toBe(review.data.changeOptions.find((o: any) => o.type === 'SCENE').estimateUsd);
    const line = await call('POST', `/creatives/${id}/changes`, { type: 'LINE', sceneIndex: 0, newSpeech: 'New line [mock:PROVIDER_ERROR]' });
    expect(line.status).toBe(200);
    await until(() => stateOf(id), (s) => s !== 'SCENES_GENERATING', 60_000);
    expect(await stateOf(id)).toBe('SCENES_FAILED');
    const take = await prisma.take.findFirstOrThrow({ where: { creativeId: id, stale: false } });
    expect(take).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
    expect(take.speech).toContain('New line');
    const sc = (await call('GET', `/creatives/${id}/scenes`)).data.scenes;
    expect(sc.every((s: any) => s.status === 'FAILED' && s.errorCode === 'PROVIDER_ERROR')).toBe(true);
    // conserta a fala pela fatia (com confirm) e volta
    const fix = await call('POST', `/creatives/${id}/scenes/0/regenerate`, { speech: 'A clean new line.', confirm: true, expectedCostUsd: 100 });
    expect(fix.status).toBe(202);
    await until(() => stateOf(id), (s) => DONE.includes(s), 120_000);
    expect(await stateOf(id)).toBe('RENDER_READY');
  });

  // ───────── manter a edição (variação) ─────────

  let offerId: string;

  async function readyChampion(name: string, editMap: EditMap | null, notes?: string): Promise<string> {
    const path = join(dir, `${name}.mp4`);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path,
    ], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: `${name}.mp4`, mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: bytes });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const cr = await call('POST', '/champions', { offerId, uploadId: c.data.uploadId, rights: 'OWN', ...(notes && { notes }) });
    const done = await until(() => call('GET', `/champions/${cr.data.id}`), (r) => ['READY', 'FAILED'].includes(r.data?.status), 300_000);
    expect(done.data.status).toBe('READY');
    const t = await prisma.teardown.findUniqueOrThrow({ where: { championId: cr.data.id } });
    // etapa mapping_edit da análise (mock): mapa com a headline sólida e o karaokê da visão; [mock:not-mapped] = sem mapa
    if (notes?.includes('[mock:not-mapped]')) expect(t.editMap).toBeNull();
    else expect(t.editMap).toMatchObject({ version: 1, width: 720, height: 1280, layers: expect.arrayContaining([expect.objectContaining({ kind: 'headline' })]) });
    const words = Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
    const sections = { ...(t.sections as any) };
    sections.hook = { status: 'ok', naReason: null, data: { endSec: 2, visual: 'v', onScreenText: 'Original headline', spoken: 'w0 w1 w2 w3' } };
    sections.structure = {
      status: 'ok', naReason: null,
      data: { blocks: [
        { label: 'hook', function: 'hook', startSec: 0, endSec: 2, onScreen: '', speech: '' },
        { label: 'body', function: 'body', startSec: 2, endSec: 6, onScreen: '', speech: '' },
        { label: 'cta', function: 'cta', startSec: 6, endSec: 8, onScreen: '', speech: '' },
      ] },
    };
    await prisma.teardown.update({
      where: { id: t.id },
      data: { sections, transcript: { language: 'en', text: words.map((w) => w.word).join(' '), words, wpm: 120, wordsSource: 'whisper' }, editMap: (editMap ?? Prisma.DbNull) as any },
    });
    await prisma.champion.update({ where: { id: cr.data.id }, data: { hasSpeech: true, language: 'en' } });
    return cr.data.id;
  }

  let champ: string;

  it('campeão: keepEdit vem do EditMap; sem mapa = not_mapped; keepEdit com bloqueio = 422; hookMode fora de TEXT = 400', async () => {
    offerId = (await prisma.offer.create({ data: { workspaceId: wsId, name: 'Keep offer', language: 'en', what: 'App', promise: 'Save', cta: 'Download', createdById: userId } })).id;
    champ = await readyChampion('keep', editMapFixture());
    const d = await call('GET', `/champions/${champ}`);
    expect(d.data.keepEdit.SWAP_AVATAR).toEqual({ available: true, blockers: [] });
    expect(d.data.teardown.editMap.faceTrack).toHaveLength(1);

    const old = await readyChampion('old', null, '[mock:not-mapped]');
    const o = await call('GET', `/champions/${old}`);
    expect(o.data.keepEdit.SWAP_AVATAR.blockers[0].reason).toBe('not_mapped');
    expect(o.data.teardown.editMap).toBeNull();
    const dflt = await call('POST', `/champions/${old}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] });
    expect(dflt.data.settings).toMatchObject({ keepEdit: false, hookMode: 'TEXT' });
    const no = await call('POST', `/champions/${old}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { keepEdit: true } });
    expect(no.status).toBe(422);
    expect(no.error).toMatchObject({ code: 'KEEP_EDIT_UNSUPPORTED', details: { kind: 'SWAP_AVATAR', blockers: [{ reason: 'not_mapped' }] } });

    const blocked = await readyChampion('two-faces', editMapFixture({ SWAP_AVATAR: { available: false, blockers: [{ reason: 'multiple_faces', startSec: 1, endSec: 3 }] } }));
    const b = await call('POST', `/champions/${blocked}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { keepEdit: true } });
    expect(b.error).toMatchObject({ code: 'KEEP_EDIT_UNSUPPORTED', details: { kind: 'SWAP_AVATAR', blockers: [{ reason: 'multiple_faces', startSec: 1, endSec: 3 }] } });
    expect((await call('POST', `/champions/${champ}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { hookMode: 'VOICE_CLONE' } })).status).toBe(400);
  });

  let batchId: string;

  it('lote keepEdit: padrão true, áudio do campeão; ganchos escritos sem controle, fala do original travada', async () => {
    const cr = await call('POST', `/champions/${champ}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }, { kind: 'NEW_HOOKS', count: 2 }] });
    expect(cr.status).toBe(202);
    expect(cr.data.settings).toMatchObject({ keepEdit: true, hookMode: 'TEXT', voiceSource: 'CHAMPION_AUDIO', format: 'VERTICAL_9_16' });
    expect(cr.data.items.some((i: any) => i.isControl)).toBe(false);
    batchId = cr.data.id;
    const b = await until(() => call('GET', `/variation-batches/${batchId}`), (r) => r.data && r.data.status !== 'PLANNING');
    expect(b.data.status).toBe('PLAN_READY');
    const hooks = b.data.items.filter((i: any) => i.kind === 'NEW_HOOKS');
    expect(hooks).toHaveLength(2);
    expect(hooks.every((h: any) => h.hook.speech === 'w0 w1 w2 w3' && h.castingId === null)).toBe(true);
    expect((await call('PATCH', `/variation-batches/${batchId}/items/${hooks[0].id}`, { hook: { speech: 'nope' } })).status).toBe(400);
    const ed = await call('PATCH', `/variation-batches/${batchId}/items/${hooks[0].id}`, { hook: { onScreenText: 'Brand new headline' } });
    expect(ed.data.hook).toEqual({ speech: 'w0 w1 w2 w3', onScreenText: 'Brand new headline' });
    // trocar pra voz do catálogo em keepEdit volta pro áudio do campeão
    expect((await call('PATCH', `/variation-batches/${batchId}/settings`, { voiceSource: 'CATALOG' })).data.settings.voiceSource).toBe('CHAMPION_AUDIO');
  });

  it('estimativa: gancho escrito = US$ 0; Trocar avatar = 1 take AUDIO_LIPSYNC da janela do rosto', async () => {
    const est = await call('GET', `/variation-batches/${batchId}/estimate`);
    expect(est.status).toBe(200);
    const hooks = est.data.items.filter((i: any) => i.kind === 'NEW_HOOKS');
    expect(hooks.every((h: any) => h.costUsd === 0)).toBe(true);
    const swap = est.data.items.find((i: any) => i.kind === 'SWAP_AVATAR');
    expect(swap.lines.filter((l: any) => l.kind === 'LIPSYNC')).toHaveLength(1);
    expect(swap.lines.some((l: any) => l.kind === 'TTS' || l.kind === 'TRANSCRIBE')).toBe(false);
    expect(est.data.savedByReuseUsd).toBe(0);
    // launch só pede o rosto do Trocar avatar (sem voz, sem elenco dos ganchos)
    const miss = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.data.costUsd });
    expect(miss.error.code).toBe('BATCH_INCOMPLETE');
    expect(miss.error.details.missing).toHaveLength(1);
    expect(miss.error.details.missing[0].reason).toBe('face_not_selected');
  });

  it('launch: Trocar avatar = take AUDIO_LIPSYNC 1-7 s; gancho escrito = 1 SOURCE_CUT do campeão, sem provedor; edição travada', async () => {
    const b = (await call('GET', `/variation-batches/${batchId}`)).data;
    const c = b.castings[0];
    await call('POST', `/variation-batches/${batchId}/castings/${c.id}/faces/generate`, { description: 'Woman in her 30s, kitchen, casual' });
    const ready = await until(() => call('GET', `/variation-batches/${batchId}`), (r) => r.data.castings[0].batches[0].faces.every((f: any) => f.status !== 'QUEUED' && f.status !== 'GENERATING'));
    const face = ready.data.castings[0].batches[0].faces.find((f: any) => f.status === 'READY');
    await call('POST', `/variation-batches/${batchId}/castings/${c.id}/faces/${face.id}/select`, {});
    const est = (await call('GET', `/variation-batches/${batchId}/estimate`)).data;
    const l = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.costUsd });
    expect(l.status).toBe(202);
    expect(l.data.creatives).toHaveLength(3);

    const rows = await prisma.creative.findMany({ where: { variationBatchId: batchId } });
    const swap = rows.find((r) => r.variationKind === 'SWAP_AVATAR')!;
    const take = await prisma.take.findFirstOrThrow({ where: { creativeId: swap.id } });
    expect(take).toMatchObject({ kind: 'AUDIO_LIPSYNC', generation: 1 });
    expect(Number(take.sourceStartSec)).toBe(1);
    expect(Number(take.sourceEndSec)).toBe(7);
    expect((take.words as any[])[0].startSec).toBeGreaterThanOrEqual(0);
    expect((swap.editSettings as any).templateId).toBe('remix-keep');

    for (const h of rows.filter((r) => r.variationKind === 'NEW_HOOKS')) {
      const sc = await prisma.scene.findMany({ where: { creativeId: h.id } });
      expect(sc).toHaveLength(1);
      expect(sc[0]).toMatchObject({ pipeline: 'SOURCE_CUT', status: 'READY' });
      expect(Number(sc[0].sourceEndSec)).toBe(8);
      expect(await prisma.providerTask.count({ where: { sceneId: sc[0].id } })).toBe(0);
      expect(await prisma.take.count({ where: { creativeId: h.id } })).toBe(0);
      expect(h.engine).toBeNull();
      expect((h.editSettings as any).templateId).toBe('remix-keep');
      const patch = await call('PATCH', `/creatives/${h.id}/edit`, { captionStyle: 'line' });
      expect(patch.status).toBe(409);
      expect(patch.error.details.reason).toBe('variation_locked');
      expect((await call('GET', `/creatives/${h.id}/edit`)).data.settings.templateId).toBe('remix-keep');
    }
    const hook0 = rows.find((r) => r.variationKind === 'NEW_HOOKS' && (r.editSettings as any).headline === 'Brand new headline');
    expect(hook0).toBeTruthy();

    await until(() => prisma.creative.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { state: true } }), (r) => r.every((c) => DONE.includes(c.state)), 180_000);
    const swapTasks = await prisma.providerTask.findMany({ where: { takeId: take.id } });
    expect(swapTasks.map((t) => t.kind)).toEqual(['LIPSYNC']);
    expect(await prisma.take.findUniqueOrThrow({ where: { id: take.id } })).toMatchObject({ status: 'READY' });
  });

  it('lote só de ganchos escritos: launch 202 sem nenhuma chamada a provedor (SOURCE_CUT não conta como submissão)', async () => {
    const cr = await call('POST', `/champions/${champ}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 2 }] });
    expect(cr.data.settings.keepEdit).toBe(true);
    const id2 = cr.data.id;
    await until(() => call('GET', `/variation-batches/${id2}`), (r) => r.data && r.data.status !== 'PLANNING');
    const est = (await call('GET', `/variation-batches/${id2}/estimate`)).data;
    expect(est.costUsd).toBe(0);
    const l = await call('POST', `/variation-batches/${id2}/launch`, { expectedCostUsd: 0 });
    expect(l.status).toBe(202);
    expect(l.data.creatives).toHaveLength(2);
    const ids = l.data.creatives.map((c: any) => c.id);
    expect(await prisma.providerTask.count({ where: { OR: [{ scene: { creativeId: { in: ids } } }, { take: { creativeId: { in: ids } } }] } })).toBe(0);
    await until(() => prisma.creative.findMany({ where: { id: { in: ids } }, select: { state: true } }), (r) => r.every((c) => DONE.includes(c.state)), 120_000);
  });
});
