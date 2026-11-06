// troca-texto-queimado-v1 §15.3, §15.3.1, §15.4 (F1a), contra a infra LOCAL (maquina_test), integrações em mock (custo zero),
// render fake. Prova: lote de template com legenda queimada não grava `captionOverride` nem cobre nada; HEADLINE `replace`
// fica `headline_pending`; force/unforce = 410; o que já existe (plano marcado, peça pronta, editor) cai no estado certo.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.ITERATE_TEMPLATES = 'off';
process.env.TEMPLATES = 'on';
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
import { ChecagemLegendaService, captionTargetOf } from '../edicao/checagem-legenda';
import { configureApp } from '../main';
import type { RenderInput } from '../render/contrato';
import { IteracaoService } from './iteracao.service';
import { PlanoAutoService } from './plano-auto.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(900_000);
const RUN = `ts${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const TERMINAL = ['ready', 'failed', 'left_out'];

type Piece = { id: string; type: string; status: string; code: string; errorCode: string | null; files: unknown[]; creativeId: string; editor?: { available: boolean; reason: string | null } | null };
type FitRow = { slug: string; fit: { level: string; reason: string | null } };

describe(isLocal ? 'F1a: nada cobre a legenda nem a headline (integração local)' : 'F1a [pulado: DATABASE_URL não é localhost]', () => {
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
  let championId = '';
  let baseMap: Record<string, unknown> = {};
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
  const planned = (id: string) => until(() => call('GET', `/iterate/${id}`), (r) => !!r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status));
  const allDone = (id: string) => until(() => call('GET', `/iterate/${id}`), (r) => (r.data?.pieces ?? []).every((p: Piece) => TERMINAL.includes(p.status)));
  const startOf = (b: { id: string; pieces: unknown[]; cost: { generateEstimateUsd: number | null }; template: { quote: number } | null }) =>
    call('POST', `/iterate/${b.id}/start`, { expectedPieces: (b.pieces as unknown[]).length, expectedCostUsd: b.cost.generateEstimateUsd ?? 0, ...(b.template && { expectedCredits: b.template.quote }) });

  const style = { fontId: 'montserrat-800', uppercase: true, fontSizePx: 48, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' };
  const none = { kind: 'none', color: null, box: null };
  /** Legenda queimada o vídeo inteiro (`h` em px de 1280) e, opcional, headline solta ou em caixa. */
  const setLayers = async (o: { captionY: number; captionH: number; headline?: 'loose' | 'box' | null }) => {
    const fc = Number(baseMap.frameCount) || 750;
    const layers: unknown[] = [{ id: 'cap1', kind: 'caption', startFrame: 0, endFrame: fc, box: { x: 80, y: o.captionY, w: 560, h: o.captionH }, background: none, text: null, wordsPerPage: 3, source: 'vision', style }];
    if (o.headline) {
      layers.push({
        id: 'h1', kind: 'headline', startFrame: 0, endFrame: fc, box: { x: 60, y: 70, w: 600, h: 60 }, text: 'Original headline here', wordsPerPage: null, source: 'vision', style,
        background: o.headline === 'box' ? { kind: 'solid', color: '#101010', box: { x: 40, y: 60, w: 640, h: 80 } } : none,
      });
    }
    await prisma.teardown.update({ where: { championId }, data: { editMap: { ...baseMap, layers } as unknown as Prisma.InputJsonValue } });
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-sem-cobrir-'));
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
    const email = `ts-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'Ts', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Sem Cobrir ${RUN}`, shortCode: 'SC', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    wsId = w.id;
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = (await res.json()).data.accessToken;
    const offer = await prisma.offer.create({
      data: {
        workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
        promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: user.id,
      },
    });
    offerId = offer.id;
    const path = join(dir, 'v30.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(bytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const first = await planned((await call('POST', '/iterate', { uploadId: c.data.uploadId })).data.id);
    expect(first.data.status).toBe('PLAN_READY');
    championId = first.data.source.championId;
    const td = await prisma.teardown.findUniqueOrThrow({ where: { championId } });
    baseMap = td.editMap as Record<string, unknown>;
  });

  afterAll(async () => {
    if (wsId) {
      await app.get(IteracaoService).recover(wsId).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: wsId, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: wsId, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.templateRun.deleteMany({ where: { workspaceId: wsId } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: wsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: wsId } });
      await prisma.upload.deleteMany({ where: { workspaceId: wsId } });
      await prisma.job.deleteMany({ where: { workspaceId: wsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `ts-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('force e unforce = 410 CAPTION_FORCE_RETIRED, com ou sem corpo', async () => {
    for (const body of [{ type: 'NATIVE_SEARCH', template: null }, {}, undefined]) {
      for (const method of ['POST', 'DELETE']) {
        const r = await call(method, '/iterate/qualquer/caption-blocked/force', body);
        expect([r.status, r.error?.code]).toEqual([410, 'CAPTION_FORCE_RETIRED']);
      }
    }
  });

  let packBatch = '';
  it('PROVA: lote de template com legenda não grava captionOverride, passa na guarda e HEADLINE replace fica pendente', async () => {
    await setLayers({ captionY: 820, captionH: 120, headline: 'loose' });
    const u = await call('POST', '/ad-templates/let-hookmill-pick/use', { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planned(u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    packBatch = b.data.id;
    expect(b.data.pieces.length).toBeGreaterThan(0);

    const row = await prisma.variationBatch.findUniqueOrThrow({ where: { id: packBatch }, include: { items: true } });
    expect(row.items.length).toBeGreaterThan(0);
    for (const i of row.items) expect((i.payload as { captionOverride?: unknown }).captionOverride).toBeUndefined();
    expect(row.items.some((i) => i.autoType === 'HEADLINE')).toBe(false);
    expect((row.settings as Record<string, unknown>).captionCandidates).toBeUndefined();
    expect((row.insight as Record<string, unknown>).captionNote).toBeUndefined();
    expect((row.insight as Record<string, unknown>).headlineBlocked).toEqual({ reason: 'headline_pending', mode: 'replace' });
    for (const p of b.data.pieces) expect(p.captionOverride).toBeUndefined();

    // a guarda real, com os params reais, passa em toda peça; e a guarda está ligada (o campeão tem a faixa)
    const ctx = await app.get(PlanoAutoService).ctxForChampion(championId, 'en');
    expect(ctx?.caption?.bands.length).toBeGreaterThan(0);
    for (const i of row.items) {
      const params = (i.payload as { params: Record<string, unknown> }).params;
      expect(ctx!.caption!.check({ type: i.autoType as never, params })).toBeNull();
    }

    // o render sai com a faixa protegida no input (não é mais montado "sem legenda")
    const s = await startOf(b.data);
    expect([s.status, s.error]).toEqual([202, undefined]);
    const done = await allDone(packBatch);
    expect(done.data.pieces.filter((p: Piece) => p.status === 'ready').length).toBeGreaterThan(0);
    const { bands } = await app.get(ChecagemLegendaService).championBands(championId);
    expect(bands.length).toBeGreaterThan(0);
    const renders = await prisma.render.findMany({ where: { workspaceId: wsId, creative: { variationBatchId: packBatch }, format: 'VERTICAL_9_16', status: 'READY' } });
    let videos = 0;
    for (const r of renders) {
      const input = r.input as unknown as RenderInput;
      if (input.kind !== 'frame' && input.kind !== 'auto-edit' && input.kind !== 'remix-keep') continue;
      // COLD_OPEN e ENDCARD não desenham por cima do campeão: o vídeo segue inteiro e o card vem depois
      if (input.kind === 'auto-edit' && (input.type === 'COLD_OPEN' || input.type === 'ENDCARD')) continue;
      videos++;
      const t = captionTargetOf(input, bands);
      expect(t).not.toBeNull();
      expect(t!.bands.length).toBeGreaterThan(0);
    }
    expect(videos).toBeGreaterThan(0);
  });

  it('HEADLINE: template não cabe (solta e caixa), hard com headline_pending; use = 422', async () => {
    const h = await prisma.template.findFirst({ where: { internalKey: 'HEADLINE', pack: false } });
    expect(h).not.toBeNull();
    for (const headline of ['loose', 'box'] as const) {
      await setLayers({ captionY: 820, captionH: 120, headline });
      const f = await call('POST', '/ad-templates/fits', { slug: h!.slug, sources: [{ championId }] });
      expect(f.data.items[0].fit).toEqual({ level: 'hard', reason: 'headline_pending' });
      const use = await call('POST', `/ad-templates/${h!.slug}/use`, { championId });
      expect([use.status, use.error.code, use.error.details.reason]).toEqual([422, 'TEMPLATE_DOESNT_FIT', 'headline_pending']);
    }
  });

  it('template único bloqueado: plano vazio, faixa soft, lista só com a chave dele, nada a gerar', async () => {
    await setLayers({ captionY: 100, captionH: 1080 });
    const g = await call('GET', `/ad-templates?championId=${championId}`);
    const soft = (g.data.items as FitRow[]).filter((t) => t.fit?.level === 'soft' && t.slug !== 'let-hookmill-pick');
    expect(soft.length).toBeGreaterThan(0);
    const slug = soft[0].slug;
    const u = await call('POST', `/ad-templates/${slug}/use`, { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planned(u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    expect(b.data.pieces).toEqual([]);
    expect(b.data.template.fit).toEqual({ level: 'soft', reason: 'burned_captions' });
    expect(b.data.insight.captionNote).toBeUndefined();
    expect(b.data.insight.captionBlocked.length).toBe(1);
    expect(b.data.insight.captionBlocked[0].forced).toBeUndefined();
    const st = await call('POST', `/iterate/${b.data.id}/start`, { expectedPieces: 1, expectedCostUsd: 0, expectedCredits: 0 });
    expect(st.status).toBe(409);
  });

  it('§15.3.1: plano feito antes do F1a: item marcado e HEADLINE replace somem, sem contar; insight antigo limpo', async () => {
    await setLayers({ captionY: 820, captionH: 120 });
    const b = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(b.data.status).toBe('PLAN_READY');
    const id = b.data.id;
    const items = await prisma.variationItem.findMany({ where: { batchId: id, included: true }, orderBy: { index: 'asc' } });
    expect(items.length).toBeGreaterThanOrEqual(2);
    const marked = items[0];
    await prisma.variationItem.update({ where: { id: marked.id }, data: { payload: { ...(marked.payload as object), captionOverride: true } as Prisma.InputJsonValue } });
    const oldHeadline = await prisma.variationItem.create({
      data: { workspaceId: wsId, batchId: id, kind: 'AUTO_EDIT', index: 900, priority: 900, status: 'READY', included: true, selection: 'auto', rationale: 'old', code: 'HEADLINE-OLD', axis: 'ITERATION', change: 'old', autoType: 'HEADLINE', inZip: true,
        payload: { params: { type: 'HEADLINE', mode: 'replace', text: 'Old', highlight: null, sources: {}, language: 'en', original: 'Orig', format: 'VERTICAL_9_16' }, whyKey: 'hook' } as Prisma.InputJsonValue },
    });
    const row = await prisma.variationBatch.findUniqueOrThrow({ where: { id } });
    const insight = row.insight as Record<string, unknown>;
    await prisma.variationBatch.update({ where: { id }, data: { insight: { ...insight, captionNote: true, captionBlocked: [{ type: 'REVIEW', template: null, reason: 'burned_captions', forced: true }] } as Prisma.InputJsonValue } });

    const g = await call('GET', `/iterate/${id}`);
    const ids = g.data.pieces.map((p: Piece) => p.id);
    expect(ids).not.toContain(marked.id);
    expect(ids).not.toContain(oldHeadline.id);
    expect(g.data.notSelected.map((p: Piece) => p.id)).not.toContain(marked.id);
    expect(g.data.summary.pieces).toBe(items.length - 1);
    expect(g.data.insight.captionNote).toBeUndefined();
    expect(g.data.insight.captionBlocked).toEqual([{ type: 'REVIEW', template: null, reason: 'burned_captions' }]);
    // não volta pela seleção
    const sel = await call('PATCH', `/iterate/${id}/items/${marked.id}`, { included: true });
    expect(sel.error?.code).toBe('ITEM_NOT_SELECTABLE');
    // Gerar: fora do lote, sem criativo
    const s = await startOf(g.data);
    expect([s.status, s.error]).toEqual([202, undefined]);
    expect(await prisma.creative.count({ where: { variationItemId: { in: [marked.id, oldHeadline.id] } } })).toBe(0);
    expect(s.data.pieces.length).toBe(items.length - 1);
  });

  it('§15.3.1: lote de template só com itens marcados fica vazio, com a faixa soft', async () => {
    const u = await call('POST', '/ad-templates/meme-pov/use', { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planned(u.data.id);
    expect(b.data.status).toBe('PLAN_READY');
    if (!b.data.pieces.length) return; // a moldura não coube com esta faixa: o caso acima já cobre o plano vazio
    await prisma.variationItem.updateMany({ where: { batchId: b.data.id }, data: { payload: { params: {}, captionOverride: true } as Prisma.InputJsonValue } });
    const g = await call('GET', `/iterate/${b.data.id}`);
    expect(g.data.pieces).toEqual([]);
    expect(g.data.template.fit).toEqual({ level: 'soft', reason: 'burned_captions' });
    expect(g.data.summary.pieces).toBe(0);
  });

  it('§15.3.1: peça pronta com a marca continua baixável, sem o campo; HEADLINE replace antigo não abre no editor', async () => {
    const done = await allDone(packBatch);
    const p = done.data.pieces.find((x: Piece) => x.status === 'ready' && x.files.length > 0) as Piece;
    expect(p).toBeDefined();
    const item = await prisma.variationItem.findUniqueOrThrow({ where: { id: p.id } });
    await prisma.variationItem.update({ where: { id: p.id }, data: { payload: { ...(item.payload as object), captionOverride: true } as Prisma.InputJsonValue, autoType: 'HEADLINE' } });
    await prisma.variationItem.update({ where: { id: p.id }, data: { payload: { params: { type: 'HEADLINE', mode: 'replace', text: 'Old', highlight: null, sources: {}, language: 'en', original: 'Orig', format: 'VERTICAL_9_16' }, captionOverride: true } as Prisma.InputJsonValue } });
    const after = (await call('GET', `/iterate/${packBatch}`)).data.pieces.find((x: Piece) => x.id === p.id) as Piece & { captionOverride?: boolean };
    expect(after.status).toBe('ready');
    expect(after.files.length).toBe(p.files.length);
    expect(after.captionOverride).toBeUndefined();
    expect(after.editor).toMatchObject({ available: false, reason: 'headline_plate_retired' });
    const ed = await call('GET', `/creatives/${after.creativeId}/editor`);
    expect([ed.status, ed.error?.code, ed.error?.details?.reason]).toEqual([422, 'EDIT_NOT_SUPPORTED', 'headline_plate_retired']);
  });

  it('checagem por visão: no lote de template a legenda tampada reprova (a isenção de 02/11 acabou)', async () => {
    await prisma.offer.update({ where: { id: offerId }, data: { notes: '[mock:caption-covered]' } });
    const b = await planned((await call('POST', '/ad-templates/let-hookmill-pick/use', { championId })).data.id);
    expect(b.data.status).toBe('PLAN_READY');
    const s = await startOf(b.data);
    expect([s.status, s.error]).toEqual([202, undefined]);
    const done = await allDone(b.data.id);
    expect(done.data.pieces.some((p: Piece) => p.errorCode === 'CAPTION_COVERED')).toBe(true);
    await prisma.offer.update({ where: { id: offerId }, data: { notes: null } });
  });
});
