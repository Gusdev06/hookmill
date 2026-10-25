// estatico-montado-e-molduras-v1 (25/10) A-B + B1-B contra a infra LOCAL (maquina_test), integrações em mock, render fake:
// STATIC assembled (spec V2 com marca/paleta/referência, checagem de texto: ok, refação por erro crítico, mismatch nas 2 →
// fora do zip (G1), checagem fora → skipped), FRAME (fila `kind 'frame'`, vista `frame`, primaryText da read_caption,
// `[mock:frame-fail:<id>]` + Retry, `format_not_supported`), PATCH /workspace brandColor.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3193;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AutoVariationType, type VariationAxis } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { StorageService } from '../arquivos/storage.service';
import { hashPassword } from '../common/util/crypto';
import { CLAUDE_SERVICE } from '../integracoes';
import type { CheckStaticTextInput } from '../integracoes/contrato';
import { JobsService } from '../jobs/jobs.service';
import { configureApp } from '../main';
import { PrismaService } from '../prisma/prisma.service';
import { FRAME_FORMATS } from './pecas';
import { PecasAutoService } from './pecas.service';
import { installStaticImageStub, type StaticStub } from './imagem-estatica.stub';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const copy = (lead: string) => ({
  brandLine: null, brandLineSource: null, tagline: null,
  headline: { lead, highlight: 'save time' }, headlineSource: 'promise',
  subheadline: null, subheadlineSource: null, handwritten: 'Breathe again.', benefits: [], trust: [],
  cta: { main: 'Download', sub: null, subSource: null }, closing: null,
});
const visualV2 = { hero: null, product: { kind: 'phone_screen', look: 'dark interface', screenTitle: null, screenTitleSource: null }, mood: 'calm evening' };
const brand = { name: 'Oferta molduras', handle: '@molduras', initials: 'OM', color: '#FF8A3D' };
const frame = (template: string, texts: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ template, texts, sources: {}, screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null, ...extra });

// cada STATIC tem uma headline própria: o stub da checagem decide o desfecho pela headline
const PLAN: { type: AutoVariationType; code: string; axis: VariationAxis; params: Record<string, unknown> }[] = [
  { type: 'STATIC', code: 'STATIC-F1', axis: 'DIVERSITY', params: { layout: 'assembled', headline: 'OK save time', refAtSec: 1, copy: copy('OK'), visual: visualV2 } },
  { type: 'STATIC', code: 'STATIC-F2', axis: 'DIVERSITY', params: { layout: 'assembled', headline: 'FIRST save time', refAtSec: 1, copy: copy('FIRST'), visual: visualV2 } },
  { type: 'STATIC', code: 'STATIC-F3', axis: 'DIVERSITY', params: { layout: 'assembled', headline: 'ALL save time', refAtSec: 1, copy: copy('ALL'), visual: visualV2 } },
  { type: 'STATIC', code: 'STATIC-F4', axis: 'DIVERSITY', params: { layout: 'assembled', headline: 'DOWN save time', refAtSec: 1, copy: copy('DOWN'), visual: visualV2 } },
  { type: 'FRAME' as AutoVariationType, code: 'FRAME-NEWS', axis: 'DIVERSITY', params: frame('news', { topic: 'App', headline: { lead: 'People', highlight: 'save time' }, dek: 'A short app', cta: 'Download' }) },
  { type: 'FRAME' as AutoVariationType, code: 'FRAME-READ-CAPTION', axis: 'DIVERSITY', params: frame('read_caption', { headline: 'Read the caption', primaryText: 'The full story here.' }, { suggestedPrimaryText: 'The full story here.' }) },
];

describe(isLocal ? 'STATIC montado + molduras (integração local)' : 'STATIC montado + molduras [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let ws: { id: string; userId: string; token: string };
  let dir: string;
  let batchId: string;
  let stub: StaticStub;
  const checks: CheckStaticTextInput[] = [];
  const items: Record<string, string> = {};
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws.token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 240_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  const pieces = () => app.get(PecasAutoService).pieces({ id: batchId, workspaceId: ws.id, status: 'LAUNCHED' });
  const piece = async (code: string) => (await pieces()).find((p) => p.code === code)!;
  const settled = (ps: { status: string }[]) => ps.every((p) => ['ready', 'failed', 'left_out'].includes(p.status));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-molduras-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    stub = installStaticImageStub(app, { publicApiUrl: process.env.PUBLIC_API_URL!, usd: 0.4, delayMs: 200 });
    // stub da checagem (porta da ia): OK = tudo certo; FIRST = 1ª imagem com o CTA errado, 2ª certa; ALL = as 2 erradas
    // (+ texto inventado, G3); DOWN = Claude fora
    const claude = app.get(CLAUDE_SERVICE) as unknown as { checkStaticText: (i: CheckStaticTextInput) => Promise<unknown> };
    claude.checkStaticText = async (i) => {
      checks.push(i);
      const head = i.expected.find((e) => e.key === 'headline')?.text ?? '';
      const nth = checks.filter((c) => c.renderId === i.renderId).length;
      if (head.startsWith('DOWN')) throw new Error('claude down');
      const wrongCta = (head.startsWith('FIRST') && nth === 1) || head.startsWith('ALL');
      return {
        items: i.expected.map((e) => ({ key: e.key, found: true, seen: wrongCta && e.key === 'cta.main' ? 'DOWNLÓAD' : e.text })),
        extraText: head.startsWith('ALL') ? ['Plan of 21 days'] : [], costUsd: 0.004,
      };
    };
    const hash = await hashPassword(PASSWORD);
    const email = `molduras-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { email, name: 'Molduras', passwordHash: hash } });
    const w = await prisma.workspace.create({ data: { name: `molduras-${RUN}`, shortCode: 'MD', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    ws = { id: w.id, userId: user.id, token: (await res.json()).data.accessToken };

    const offer = await prisma.offer.create({
      data: { workspaceId: ws.id, name: 'Oferta molduras', language: 'en', what: 'App', promise: 'Save time', cta: 'Download', notes: 'teste [mock:frame-fail:news]', createdById: ws.userId },
    });
    const path = join(dir, 'champ.mp4');
    await run(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const video = await app.get(StorageService).put(path, { workspaceId: ws.id, kind: 'CHAMPION_VIDEO', mimeType: 'video/mp4', meta: { durationSec: 4, width: 360, height: 640 } });
    const championId = (await prisma.champion.create({
      data: { workspaceId: ws.id, offerId: offer.id, name: 'Champ molduras', status: 'READY', rights: 'OWN', videoFileId: video.id, durationSec: 4, hasSpeech: true, language: 'en', createdById: ws.userId },
    })).id;
    await prisma.teardown.create({ data: { workspaceId: ws.id, championId, measurements: { palette: ['#808080', '#C04040'] }, sections: {} } });
    const b = await prisma.variationBatch.create({
      data: {
        workspaceId: ws.id, championId, offerId: offer.id, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: ws.userId,
        items: {
          create: PLAN.map((p, index) => ({
            workspaceId: ws.id, kind: 'AUTO_EDIT' as const, index, status: 'READY' as const, autoType: p.type, code: p.code, axis: p.axis,
            change: `changes ${p.code}`, rationale: 'r', inZip: true, payload: { params: { type: p.type, ...p.params } },
          })),
        },
      },
      include: { items: true },
    });
    batchId = b.id;
    for (const i of b.items) items[i.code!] = i.id;
  });

  afterAll(async () => {
    if (ws?.id) {
      await until(() => prisma.render.count({ where: { workspaceId: ws.id, status: { in: ['QUEUED', 'RENDERING'] } } }), (n) => n === 0, 120_000);
      await app.get(JobsService).idle();
      await prisma.creative.updateMany({ where: { workspaceId: ws.id }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.providerTask.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.render.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.creative.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.champion.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.job.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.offer.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.deleteMany({ where: { id: ws.id } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `molduras-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('PATCH /workspace brandColor: #RGB normaliza pra #RRGGBB maiúsculo; inválido = 400; null limpa', async () => {
    const ok = await call('PATCH', '/workspace', { brandColor: '#0a7' });
    expect(ok.status).toBe(200);
    expect(ok.data.brandColor).toBe('#00AA77');
    expect((await call('GET', '/workspace')).data.brandColor).toBe('#00AA77');
    expect((await call('PATCH', '/workspace', { brandColor: 'red' })).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await call('PATCH', '/workspace', { brandColor: null })).data.brandColor).toBeNull();
    await call('PATCH', '/workspace', { brandColor: '#2E7DFF' });
  });

  it('start: STATIC assembled com checagem (ok / refação / mismatch → fora do zip / skipped) e FRAME na fila do Remotion', async () => {
    const svc = app.get(PecasAutoService);
    const launchedAt = new Date();
    const launched = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt } });
      return svc.createPieces(tx, { batchId, userId: ws.userId, launchedAt });
    });
    expect(launched.staticRenderIds).toHaveLength(4);
    svc.launched(launched);
    const done = await until(pieces, settled);
    const by = Object.fromEntries(done.map((p) => [p.code, p]));

    // spec V2 no render e na porta: marca = oferta, paleta pela cor da marca, sem referência (sem captura/foto)
    const call1 = stub.calls.find((c) => c.creativeId === by['STATIC-F1'].creativeId)!;
    expect(call1.specV2).toMatchObject({ layout: 'assembled', brandName: 'Oferta molduras', palette: { accent: '#2E7DFF' }, screenRefUrl: null });
    expect(call1.spec.headline).toBe('OK save time');
    expect(checks.every((c) => c.notes === 'teste [mock:frame-fail:news]')).toBe(true); // notes repassadas (gatilhos do mock da ia)

    expect(by['STATIC-F1']).toMatchObject({ status: 'ready', inZip: true, media: 'image', textCheck: { status: 'ok' } });
    expect(by['STATIC-F1'].textCheck!.items.every((i) => i.match)).toBe(true);
    // FIRST: 1ª com CTA errado (crítico) → refaz (2 tasks) → a 2ª, certa, é entregue
    expect(by['STATIC-F2']).toMatchObject({ status: 'ready', inZip: true, textCheck: { status: 'ok' } });
    expect(stub.calls.filter((c) => c.creativeId === by['STATIC-F2'].creativeId)).toHaveLength(2);
    // ALL: as 2 erradas (+ texto inventado, G3) → mismatch com os itens, e fora do zip (G1)
    expect(by['STATIC-F3']).toMatchObject({ status: 'ready', inZip: false, textCheck: { status: 'mismatch', extraText: ['Plan of 21 days'] } });
    expect(by['STATIC-F3'].textCheck!.items.filter((i) => !i.match)).toEqual([{ key: 'cta.main', expected: 'DOWNLOAD', seen: 'DOWNLÓAD', critical: true, match: false }]);
    expect(stub.calls.filter((c) => c.creativeId === by['STATIC-F3'].creativeId)).toHaveLength(2);
    // DOWN: checagem fora → skipped, não segura nem refaz
    expect(by['STATIC-F4']).toMatchObject({ status: 'ready', inZip: true, textCheck: { status: 'skipped' } });
    expect(stub.calls.filter((c) => c.creativeId === by['STATIC-F4'].creativeId)).toHaveLength(1);
    expect(by['STATIC-F1'].formats![0]).toMatchObject({ format: '9x16', state: 'ready', textCheck: { status: 'ok' } });

    // FRAME: vídeo do Remotion (fake), input kind 'frame', vista com frame/primaryText/supported
    expect(by['FRAME-READ-CAPTION']).toMatchObject({
      status: 'ready', media: 'video', type: 'FRAME', frame: { template: 'read_caption', second: null, canSwapBroll: false },
      suggestedPrimaryText: 'The full story here.', textCheck: null,
    });
    expect(by['FRAME-READ-CAPTION'].formats!.map((f) => f.supported)).toEqual([true, true, true]);
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: by['FRAME-READ-CAPTION'].creativeId!, format: 'VERTICAL_9_16' } });
    expect(r.input).toMatchObject({ kind: 'frame', templateId: 'frame', frame: { id: 'read_caption', brand } });
    // [mock:frame-fail:news]: 1ª do 9:16 falha (RENDER_ERROR) → Retry passa
    expect(by['FRAME-NEWS']).toMatchObject({ status: 'failed', errorCode: 'RENDER_ERROR', retryHint: 'retry', retryUsd: 0 });
    expect((await call('POST', `/iterate/pieces/${items['FRAME-NEWS']}/retry`, {})).status).toBe(202);
    expect((await until(() => piece('FRAME-NEWS'), (p) => p.status === 'ready')).status).toBe('ready');
  });

  it('§A10.1/1b: Retry de STATIC pronto com texto errado refaz (prioridade 10, cobra, lote segue em download); fica a melhor', async () => {
    const before = await call('GET', `/iterate/${batchId}`);
    expect(before.data.phase).toBe('download');
    const pid = items['STATIC-F3'];
    const prev = await piece('STATIC-F3');
    const rt = await call('POST', `/iterate/pieces/${pid}/retry`, {});
    expect(rt.status).toBe(202);
    expect(rt.data.status).toBe('rendering');
    expect(rt.data.files.map((f: { url: string; format: string }) => f.format)).toEqual(['9x16']); // a anterior continua até a nova assentar
    const mid = await call('GET', `/iterate/${batchId}`);
    expect(mid.data.phase).toBe('download'); // não volta pra Generate
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: prev.creativeId!, format: 'VERTICAL_9_16', stale: false }, orderBy: { createdAt: 'desc' } });
    expect(r.priority).toBe(10);
    const done = await until(() => piece('STATIC-F3'), (p) => p.status === 'ready');
    // ALL continua errado: empate de erros críticos = a nova; segue fora do zip (G1)
    expect(done).toMatchObject({ status: 'ready', inZip: false, textCheck: { status: 'mismatch' } });
    expect(await prisma.render.count({ where: { creativeId: prev.creativeId!, format: 'VERTICAL_9_16', stale: false } })).toBe(1);
    // ready sem mismatch = 409
    expect((await call('POST', `/iterate/pieces/${items['STATIC-F1']}/retry`, {})).error).toMatchObject({ code: 'INVALID_STATE' });
    // teto mensal: 409 SPEND_CAP_EXCEEDED { spentUsd, capUsd, estimateUsd }
    await prisma.workspace.update({ where: { id: ws.id }, data: { monthlySpendCapUsd: 0.1 } });
    const cap = await call('POST', `/iterate/pieces/${pid}/retry`, {});
    expect(cap.error).toMatchObject({ code: 'SPEND_CAP_EXCEEDED', details: { capUsd: 0.1, estimateUsd: 0.4 } });
    await prisma.workspace.update({ where: { id: ws.id }, data: { monthlySpendCapUsd: null } });
  });

  it('§B4: formato que a moldura não tem = 409 format_not_supported e supported false; com ele = 202', async () => {
    const saved = FRAME_FORMATS.read_caption;
    (FRAME_FORMATS as Record<string, readonly string[]>).read_caption = ['9x16', '4x5'];
    try {
      const p = await piece('FRAME-READ-CAPTION');
      expect(p.formats!.map((f) => [f.format, f.supported])).toEqual([['9x16', true], ['4x5', true], ['1x1', false]]);
      const no = await call('POST', `/iterate/pieces/${items['FRAME-READ-CAPTION']}/formats`, { format: '1x1' });
      expect(no.status).toBe(409);
      expect(no.error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'format_not_supported' } });
      expect((await call('POST', `/iterate/pieces/${items['FRAME-READ-CAPTION']}/formats`, { format: '4x5' })).status).toBe(202);
      await until(() => piece('FRAME-READ-CAPTION'), (x) => x.formats!.find((f) => f.format === '4x5')!.state === 'ready');
    } finally {
      (FRAME_FORMATS as Record<string, readonly string[]>).read_caption = saved;
    }
  });
});
