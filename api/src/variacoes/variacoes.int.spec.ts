// B4b de ponta a ponta contra a infra LOCAL, integrações em mock (custo zero), medição e render fake de verdade (ffmpeg).
// Campeão analisado → lote (1 Trocar avatar com áudio original + 2 ganchos + controle) → plano → elencos e rostos →
// estimativa → launch → criativos renderizados, com REUSE do corpo, AUDIO_LIPSYNC sem TRANSCRIBE, travas e filtros.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
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
import { CATALOG_SERVICE, CLAUDE_SERVICE, type CatalogService, type ClaudeService } from '../integracoes';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(480_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);

describe(isLocal ? 'Lotes de variação B4b (integração local)' : 'Lotes B4b [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const ws: Record<'A' | 'B', { id: string; userId: string; token: string }> = {} as never;
  let dir: string;
  let offerId: string;
  let championId: string;
  let voiceId: string;
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown, who: 'A' | 'B' = 'A') => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws[who].token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error, meta: j.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  const batchOf = (id: string) => call('GET', `/variation-batches/${id}`);
  const planned = (id: string) => until(() => batchOf(id), (r) => r.data && r.data.status !== 'PLANNING' && !r.data.items.some((i: any) => i.status === 'WRITING'));

  /** Campeão analisado de verdade (upload + análise mock) e transcrição/estrutura fixadas pra o teste ser determinístico. */
  async function readyChampion(name: string, speech = true): Promise<string> {
    const path = join(dir, `${name}.mp4`);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path,
    ], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: `${name}.mp4`, mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${ws.A.token}` }, body: bytes });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const cr = await call('POST', '/champions', { offerId, uploadId: c.data.uploadId, rights: 'THIRD_PARTY' });
    const done = await until(() => call('GET', `/champions/${cr.data.id}`), (r) => ['READY', 'FAILED'].includes(r.data?.status), 300_000); // análise com mapping_edit (YuNet) é mais lenta
    expect(done.data.status).toBe('READY');
    const t = await prisma.teardown.findUniqueOrThrow({ where: { championId: cr.data.id } });
    const words = speech ? Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 })) : [];
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
    await prisma.teardown.update({ where: { id: t.id }, data: { sections, transcript: { language: 'en', text: words.map((w) => w.word).join(' '), words, wpm: 120, wordsSource: 'whisper' } } });
    await prisma.champion.update({ where: { id: cr.data.id }, data: { hasSpeech: speech, language: 'en' } });
    return cr.data.id;
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-b4b-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    voiceId = app.get<CatalogService>(CATALOG_SERVICE).voices('en')[0].id;
    const hash = await hashPassword(PASSWORD);
    for (const k of ['A', 'B'] as const) {
      const email = `b4b-${RUN}-${k.toLowerCase()}@teste.local`;
      const user = await prisma.user.create({ data: { email, name: `B4b ${k}`, passwordHash: hash } });
      const w = await prisma.workspace.create({ data: { name: `b4b-${RUN}-${k}`, shortCode: 'TS', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      ws[k] = { id: w.id, userId: user.id, token: (await res.json()).data.accessToken };
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: ws.A.id, name: 'Oferta lote', language: 'en', what: 'App', promise: 'Save time', cta: 'Download', createdById: ws.A.userId } })).id;
    championId = await readyChampion('champ');
  });

  afterAll(async () => {
    const ids = [ws.A?.id, ws.B?.id].filter(Boolean) as string[];
    if (ids.length) {
      // espera trabalho em voo (cenas, render) antes de apagar
      await until(() => prisma.creative.count({ where: { workspaceId: { in: ids }, state: { in: ['SCENES_GENERATING', 'RENDERING'] } } }), (n) => n === 0, 90_000);
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { selectedFaceId: null, selectedScriptId: null, finalRenderId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.upload.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `b4b-${RUN}-` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('pedido inválido: contagem fora do limite = 400; tipo fora do build = 422 KIND_NOT_ENABLED; outro workspace = 404', async () => {
    expect((await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 1 }] })).status).toBe(400);
    expect((await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 5 }] })).status).toBe(400);
    const off = await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'COPY_NEW', count: 1 }] });
    expect(off.error).toMatchObject({ code: 'KIND_NOT_ENABLED', details: { kind: 'COPY_NEW' } });
    expect((await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] }, 'B')).status).toBe(404);
  });

  it('campeão sem fala = 422 NO_SPEECH (nada recusado por rights)', async () => {
    await prisma.champion.update({ where: { id: championId }, data: { hasSpeech: false } });
    const r = await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] });
    await prisma.champion.update({ where: { id: championId }, data: { hasSpeech: true } });
    expect(r.error).toMatchObject({ code: 'NO_SPEECH', details: { kind: 'SWAP_AVATAR' } });
  });

  it('[mock:fail-all] → PLAN_FAILED; replan → PLANNING → PLAN_READY; regerar em PLAN_FAILED = 409', async () => {
    const cr = await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], notes: '[mock:fail-all]' });
    expect(cr.status).toBe(202);
    const f = await planned(cr.data.id);
    expect(f.data.status).toBe('PLAN_FAILED');
    expect(f.data.items[0]).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', action: 'regenerate' });
    expect((await call('POST', `/variation-batches/${cr.data.id}/items/${f.data.items[0].id}/regenerate`, {})).error.code).toBe('INVALID_STATE');
    expect(cr.data.castingStyle).toBe('DIVERSE'); // §13.13: padrão
    expect((await call('POST', `/variation-batches/${cr.data.id}/replan`, { castingStyle: 'LOOKALIKE' })).status).toBe(400);
    const rp = await call('POST', `/variation-batches/${cr.data.id}/replan`, { notes: '', castingStyle: 'MATCH_ORIGINAL' });
    expect(rp.status).toBe(202);
    expect(rp.data.status).toBe('PLANNING');
    expect(rp.data.castingStyle).toBe('MATCH_ORIGINAL');
    const ok = await planned(cr.data.id);
    expect(ok.data.status).toBe('PLAN_READY');
    // omitido no replan = mantém
    const rp2 = await call('POST', `/variation-batches/${cr.data.id}/replan`, { notes: '' });
    expect(rp2.data.castingStyle).toBe('MATCH_ORIGINAL');
    await planned(cr.data.id);
  });

  let batchId: string;

  it('lote SWAP + NEW_HOOKS: plano com controle automático, elencos SHARED e ITEM', async () => {
    const claude = app.get<ClaudeService>(CLAUDE_SERVICE);
    const spy = jest.spyOn(claude, 'planVariations');
    // §13.2: perfil do original diz homem; SWAP_AVATAR com voz original trava o gênero (castingGender)
    const t = await prisma.teardown.findUniqueOrThrow({ where: { championId } });
    const editMap = t.editMap as any;
    if (editMap) await prisma.teardown.update({ where: { id: t.id }, data: { editMap: { ...editMap, profile: { ...(editMap.profile ?? {}), gender: 'male' } } } });
    const cr = await call('POST', `/champions/${championId}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }, { kind: 'NEW_HOOKS', count: 2 }] });
    expect(cr.status).toBe(202);
    expect(cr.data).toMatchObject({ castingStyle: 'DIVERSE' });
    expect(cr.data.faceUnitPriceUsd).toBeGreaterThan(0);
    await until(async () => spy.mock.calls.length, (n) => n > 0, 20_000);
    expect(spy.mock.calls[0][0]).toMatchObject({ castingStyle: 'DIVERSE' });
    if (editMap) expect(spy.mock.calls[0][0]).toMatchObject({ castingGender: 'male' });
    if (editMap) await prisma.teardown.update({ where: { id: t.id }, data: { editMap } });
    spy.mockRestore();
    expect(cr.data.status).toBe('PLANNING');
    expect(cr.data.job.type).toBe('VARIATIONS_PLAN');
    const control = cr.data.items.find((i: any) => i.isControl);
    expect(control).toMatchObject({ kind: 'NEW_HOOKS', index: -1, status: 'READY', hook: { speech: 'w0 w1 w2 w3', onScreenText: 'Original headline' } });
    expect(cr.data.settings).toMatchObject({ format: 'VERTICAL_9_16', voiceSource: 'CHAMPION_AUDIO', voiceId: null });
    batchId = cr.data.id;
    expect((await batchOf(batchId)).status).toBe(200);
    expect((await call('GET', `/variation-batches/${batchId}`, undefined, 'B')).status).toBe(404);

    const b = await planned(batchId);
    expect(b.data.status).toBe('PLAN_READY');
    expect(b.data.items).toHaveLength(4);
    expect(b.data.items.every((i: any) => i.status === 'READY' && i.lever)).toBe(true);
    const hooks = b.data.items.filter((i: any) => i.kind === 'NEW_HOOKS');
    expect(new Set(hooks.map((h: any) => h.castingId)).size).toBe(1);
    expect(b.data.castings.map((c: any) => c.scope).sort()).toEqual(['ITEM', 'SHARED']);
    expect(b.data.castings.every((c: any) => c.description.length > 0)).toBe(true);
    const swap = b.data.items.find((i: any) => i.kind === 'SWAP_AVATAR');
    expect(swap.blocks.map((x: any) => x.speech).join(' ')).toBe(Array.from({ length: 16 }, (_, i) => `w${i}`).join(' '));
    expect((await call('GET', `/champions/${championId}/batches`)).data.some((x: any) => x.id === batchId)).toBe(true);
  });

  it('revisão do plano: alavanca por tipo; regerar item deixa o lote PLAN_READY e o launch espera (422)', async () => {
    const b = (await batchOf(batchId)).data;
    const swap = b.items.find((i: any) => i.kind === 'SWAP_AVATAR');
    const hook0 = b.items.find((i: any) => i.kind === 'NEW_HOOKS' && i.index === 0);
    const control = b.items.find((i: any) => i.isControl);
    expect((await call('PATCH', `/variation-batches/${batchId}/items/${swap.id}`, { hook: { speech: 'x' } })).status).toBe(400);
    expect((await call('PATCH', `/variation-batches/${batchId}/items/${control.id}`, { hook: { speech: 'x' } })).status).toBe(400);
    const ed = await call('PATCH', `/variation-batches/${batchId}/items/${hook0.id}`, { hook: { speech: 'Brand new hook here', onScreenText: 'New headline' } });
    expect(ed.data.hook).toEqual({ speech: 'Brand new hook here', onScreenText: 'New headline' });
    expect(ed.data.blocks[0].speech).toBe('Brand new hook here');

    const rg = await call('POST', `/variation-batches/${batchId}/items/${swap.id}/regenerate`, { note: 'older' });
    expect(rg.status).toBe(202);
    expect(rg.data.status).toBe('WRITING');
    expect((await batchOf(batchId)).data.status).toBe('PLAN_READY');
    const early = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: 100 });
    if (early.status === 422) expect(early.error.code).toBe('BATCH_INCOMPLETE');
    await planned(batchId);
  });

  it('estimativa: reuso do corpo economiza; launch sem rosto/voz = 422 BATCH_INCOMPLETE com o que falta', async () => {
    const est = await call('GET', `/variation-batches/${batchId}/estimate`);
    expect(est.status).toBe(200);
    expect(est.data.items).toHaveLength(4);
    expect(est.data.costUsd).toBeGreaterThan(0);
    expect(est.data.savedByReuseUsd).toBe(0); // §13.5: take contínuo, sem reuso de corpo
    const miss = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.data.costUsd });
    expect(miss.status).toBe(422);
    expect(miss.error.code).toBe('BATCH_INCOMPLETE');
    const m = miss.error.details.missing;
    expect(m.filter((x: any) => x.reason === 'face_not_selected')).toHaveLength(2);
    expect(m).toContainEqual({ field: 'voiceId' });
  });

  it('elenco: 1-4 rostos Soul (mock) por elenco (padrão 1), escolha; voz do lote', async () => {
    const b = (await batchOf(batchId)).data;
    for (const c of b.castings) {
      expect((await call('PATCH', `/variation-batches/${batchId}/castings/${c.id}`, { description: 'short' })).status).toBe(400);
      expect((await call('POST', `/variation-batches/${batchId}/castings/${c.id}/faces/generate`, { description: 'Woman in her 30s, kitchen, casual', count: 5 })).status).toBe(400);
      // §13.13: padrão 1 no elenco; o segundo elenco pede 3
      const count = c.scope === 'SHARED' ? 3 : undefined;
      const g = await call('POST', `/variation-batches/${batchId}/castings/${c.id}/faces/generate`, { description: 'Woman in her 30s, kitchen, casual', ...(count && { count }) });
      expect(g.status).toBe(202);
      expect(g.data.faces).toHaveLength(count ?? 1);
      expect(g.data.faces.map((f: any) => f.position)).toEqual(Array.from({ length: count ?? 1 }, (_, i) => i));
      const ready = await until(() => batchOf(batchId), (r) => r.data.castings.find((x: any) => x.id === c.id).batches[0].faces.every((f: any) => f.status !== 'QUEUED' && f.status !== 'GENERATING'));
      const face = ready.data.castings.find((x: any) => x.id === c.id).batches[0].faces.find((f: any) => f.status === 'READY');
      const sel = await call('POST', `/variation-batches/${batchId}/castings/${c.id}/faces/${face.id}/select`, {});
      expect(sel.data.selectedFaceId).toBe(face.id);
    }
    const st = await call('PATCH', `/variation-batches/${batchId}/settings`, { voiceId });
    expect(st.data.settings.voiceId).toBe(voiceId);
    expect((await call('PATCH', `/variation-batches/${batchId}/settings`, { voiceId: 'nope' })).status).toBe(400);
  });

  let creatives: any[];

  it('launch: ESTIMATE_CHANGED; depois 4 criativos em SCENES_GENERATING com variation, travas e filtros', async () => {
    const est = (await call('GET', `/variation-batches/${batchId}/estimate`)).data;
    expect((await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.costUsd / 3 })).error.code).toBe('ESTIMATE_CHANGED');
    const l = await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.costUsd });
    expect(l.status).toBe(202);
    expect(l.data.batch.status).toBe('LAUNCHED');
    creatives = l.data.creatives;
    expect(creatives).toHaveLength(4);
    expect(creatives.every((c: any) => c.variation?.batchId === batchId && c.variation.championId === championId)).toBe(true);
    expect(creatives.map((c: any) => c.name).sort()).toEqual([
      'champ · New hook 1', 'champ · New hook 2', 'champ · New hook · Control', 'champ · Swap avatar 1',
    ].sort());
    expect((await call('POST', `/variation-batches/${batchId}/launch`, { expectedCostUsd: est.costUsd })).error.code).toBe('INVALID_STATE');

    const anyId = creatives[0].id;
    for (const [m, p, body] of [
      ['POST', `/creatives/${anyId}/scripts/generate`, { count: 3, replace: true }],
      ['PATCH', `/creatives/${anyId}/engine`, { format: 'SQUARE_1_1' }],
      ['POST', `/creatives/${anyId}/generate`, { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', voiceId, format: 'SQUARE_1_1', expectedCostUsd: 9 }],
    ] as const) {
      const r = await call(m, p, body);
      expect(r.status).toBe(409);
      expect(r.error.details.reason).toBe('variation_locked');
    }

    const f = await call('GET', `/creatives?championId=${championId}&origin=variation`);
    expect(f.data).toHaveLength(4);
    expect((await call('GET', '/creatives?origin=scratch')).data.some((c: any) => c.variation)).toBe(false);
  });

  it('cenas: SWAP com take AUDIO_LIPSYNC sem TRANSCRIBE; ganchos reaproveitam o corpo do controle sem custo; tudo renderiza', async () => {
    const ids = creatives.map((c: any) => c.id);
    await until(() => prisma.creative.findMany({ where: { id: { in: ids } }, select: { state: true } }), (r) => r.every((c) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'].includes(c.state)), 180_000);
    const rows = await prisma.creative.findMany({ where: { id: { in: ids } }, include: { variationItem: true } });
    expect(rows.map((r) => r.state)).toEqual(rows.map(() => 'RENDER_READY'));

    const swap = rows.find((r) => r.variationKind === 'SWAP_AVATAR')!;
    expect(swap.voiceSource).toBe('CHAMPION_AUDIO');
    const swapScenes = await prisma.scene.findMany({ where: { creativeId: swap.id, stale: false } });
    // §13.5: take único AUDIO_LIPSYNC (1 LIPSYNC, sem TTS nem TRANSCRIBE); as cenas são fatias dele
    const swapTakes = await prisma.take.findMany({ where: { creativeId: swap.id, stale: false } });
    expect(swapTakes).toHaveLength(1);
    expect(swapTakes[0]).toMatchObject({ kind: 'AUDIO_LIPSYNC', status: 'READY', seed: 7 });
    expect(swapScenes.every((s) => s.pipeline === 'TAKE_SLICE' && s.takeId === swapTakes[0].id && s.clipFileId === swapTakes[0].clipFileId)).toBe(true);
    expect(swapScenes.some((s) => Array.isArray(s.words) && (s.words as unknown[]).length > 0)).toBe(true);
    expect(await prisma.providerTask.count({ where: { takeId: swapTakes[0].id, kind: 'LIPSYNC' } })).toBe(1);
    expect(await prisma.providerTask.count({ where: { OR: [{ takeId: swapTakes[0].id }, { sceneId: { in: swapScenes.map((s) => s.id) } }], kind: { in: ['TRANSCRIBE', 'TTS'] } } })).toBe(0);

    // ganchos falados (keepEdit:false): 1 take TTS_LIPSYNC por item (gancho + corpo), cenas = fatias, sem REUSE
    for (const h of rows.filter((r) => r.variationKind === 'NEW_HOOKS')) {
      const sc = await prisma.scene.findMany({ where: { creativeId: h.id, stale: false }, orderBy: { index: 'asc' } });
      const tk = await prisma.take.findMany({ where: { creativeId: h.id, stale: false } });
      expect(tk).toHaveLength(1);
      expect(tk[0]).toMatchObject({ kind: 'TTS_LIPSYNC', status: 'READY' });
      expect(sc.length).toBeGreaterThan(1);
      expect(sc.every((s) => s.pipeline === 'TAKE_SLICE' && s.takeId === tk[0].id)).toBe(true);
      expect(await prisma.providerTask.count({ where: { takeId: tk[0].id, kind: 'LIPSYNC' } })).toBe(1);
      expect((h.editSettings as any).headline).toBeTruthy();
    }
    const hook0 = rows.find((r) => r.variationItem?.index === 0 && r.variationKind === 'NEW_HOOKS')!;
    expect((hook0.editSettings as any).headline).toBe('New headline');

    const b = (await batchOf(batchId)).data;
    expect(b.progress).toMatchObject({ total: 4 });
    expect(b.items.every((i: any) => i.creative?.id)).toBe(true);
  });

  it('revisão: changeOptions por tipo e change fora da lista = 409 change_not_available', async () => {
    const swap = creatives.find((c: any) => c.variation.kind === 'SWAP_AVATAR');
    const hook = creatives.find((c: any) => c.variation.kind === 'NEW_HOOKS' && !c.variation.isControl);
    const rs = await call('GET', `/creatives/${swap.id}/review`);
    expect(rs.data.changeOptions.map((o: any) => o.type)).toEqual(['SCENE', 'TEXT', 'FACE']);
    expect(rs.data.facts.engineLabel).toBe('Swap avatar');
    const rh = await call('GET', `/creatives/${hook.id}/review`);
    expect(rh.data.changeOptions.map((o: any) => o.type)).toEqual(['SCENE', 'LINE', 'TEXT']);
    const bad = await call('POST', `/creatives/${swap.id}/changes`, { type: 'LINE', sceneIndex: 0, newSpeech: 'x' });
    expect(bad.status).toBe(409);
    expect(bad.error.details.reason).toBe('change_not_available');
    expect((await call('POST', `/creatives/${hook.id}/changes`, { type: 'FACE' })).error.details.reason).toBe('change_not_available');

    // aprova um gancho e filtra a Biblioteca por tipo
    expect((await call('POST', `/creatives/${hook.id}/approve`, {})).data.state).toBe('APPROVED');
    const lib = await call('GET', `/library?variationKind=NEW_HOOKS&championId=${championId}`);
    expect(lib.data.map((x: any) => x.id)).toEqual([hook.id]);
    expect(lib.data[0].variation).toMatchObject({ kind: 'NEW_HOOKS', championName: 'champ', isControl: false });
    expect((await call('GET', '/library?variationKind=SWAP_AVATAR')).data).toEqual([]);
  });

  // Pedido FACE no Trocar avatar (esclarecimento 5): uma transição por teste; nada recomeça sozinho.
  let swapId: string;

  it('FACE no SWAP_AVATAR: RENDER_READY → FACES_READY', async () => {
    swapId = creatives.find((c: any) => c.variation.kind === 'SWAP_AVATAR').id;
    const r = await call('POST', `/creatives/${swapId}/changes`, { type: 'FACE' });
    expect(r.status).toBe(200);
    expect(r.data.creative.state).toBe('FACES_READY');
  });

  it('rosto novo: FACES_READY → FACES_GENERATING → FACES_READY', async () => {
    const g = await call('POST', `/creatives/${swapId}/faces/generate`, { description: 'Man in his 40s, office, casual shirt' });
    expect(g.status).toBe(202);
    const st = await until(async () => (await call('GET', `/creatives/${swapId}`)).data.state, (s) => s !== 'FACES_GENERATING');
    expect(st).toBe('FACES_READY');
  });

  it('escolher rosto: FACES_READY → ENGINE_PENDING e fica (sem reinício automático)', async () => {
    const faces = await call('GET', `/creatives/${swapId}/faces`);
    const face = faces.data.batches[0].faces.find((f: any) => f.status === 'READY');
    expect((await call('POST', `/creatives/${swapId}/faces/${face.id}/select`, {})).data.state).toBe('ENGINE_PENDING');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await call('GET', `/creatives/${swapId}`)).data.state).toBe('ENGINE_PENDING');
  });

  it('generate com formato diferente do criativo = 409 variation_locked (estado não muda)', async () => {
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: swapId } });
    const r = await call('POST', `/creatives/${swapId}/generate`, { engine: c.engine, engineModel: c.engineModel, format: 'SQUARE_1_1', expectedCostUsd: 99 });
    expect(r.status).toBe(409);
    expect(r.error.details.reason).toBe('variation_locked');
    expect((await call('GET', `/creatives/${swapId}`)).data.state).toBe('ENGINE_PENDING');
  });

  it('generate com os mesmos parâmetros: ENGINE_PENDING → SCENES_GENERATING, mesmo take (AUDIO_LIPSYNC)', async () => {
    const c = await prisma.creative.findUniqueOrThrow({ where: { id: swapId } });
    const est = await call('GET', `/creatives/${swapId}/estimate?engine=LIPSYNC&model=${c.engineModel}&format=${c.format}`);
    expect(est.status).toBe(200);
    expect(est.data.costUsd).toBeGreaterThan(0);
    const r = await call('POST', `/creatives/${swapId}/generate`, { engine: c.engine, engineModel: c.engineModel, format: c.format, expectedCostUsd: est.data.costUsd });
    expect(r.status).toBe(202);
    expect(r.data.creative.state).toBe('SCENES_GENERATING');
    const sc = await prisma.scene.findMany({ where: { creativeId: swapId, stale: false } });
    expect(sc.length).toBe(est.data.sceneCount);
    const tk = await prisma.take.findFirstOrThrow({ where: { creativeId: swapId, stale: false } });
    expect(tk).toMatchObject({ kind: 'AUDIO_LIPSYNC', generation: 2 });
    expect(sc.every((s) => s.pipeline === 'TAKE_SLICE' && s.generation === 2 && s.takeId === tk.id)).toBe(true);
    const done = await until(async () => (await call('GET', `/creatives/${swapId}`)).data.state, (s) => s !== 'SCENES_GENERATING' && s !== 'RENDERING', 120_000);
    expect(done).toBe('RENDER_READY');
  });
});
