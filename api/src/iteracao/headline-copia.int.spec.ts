// troca-texto-queimado-v1 §16.3, §16.5, §16.6 B1 (F1b), contra a infra LOCAL (maquina_test), integrações em mock (custo zero),
// porta da troca = FakeTrocaTexto (sem Python, sem Chrome, sem AWS). Prova: medida sob demanda no campeão, alvo = 1ª camada no
// tempo, placa CHAMPION_PLATE com trava e espera, laço de no máximo 4 medidas (3 reescritas), peça que não cabe sai sem
// crédito, PATCH …/texts pela mesma função, isenção da legenda, PieceHeadline, e PLATE_IMPL=off igual ao F1a.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.ITERATE_TEMPLATES = 'off';
process.env.TEMPLATES = 'on';
process.env.PLATE_IMPL = 'local'; // a porta é trocada pelo fake abaixo; nada de Python/Chrome sobe
process.env.PLATE_WORKSPACE_IDS = '';
process.env.PLATE_WAIT_SEC = '20';
const PORT = 3193;
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
import { PlacasService } from '../campeoes/placas.service';
import { hashPassword } from '../common/util/crypto';
import { CLAUDE_SERVICE } from '../integracoes';
import { CreditosService } from '../creditos/creditos.service';
import { configureApp } from '../main';
import { FakeTrocaTexto, TROCA_TEXTO, type FakeTrocaOpcoes, type TrocaTextoPort } from '../medicao/troca';
import { IteracaoService } from './iteracao.service';
import { PlanoAutoService } from './plano-auto.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(900_000);
const RUN = `hc${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);

/** A porta do teste: delega ao fake da vez (cada caso troca as opções). */
class PortaTrocavel implements TrocaTextoPort {
  atual = new FakeTrocaTexto();
  chamadas: Array<{ op: string; championId: string }> = [];
  usar(o: FakeTrocaOpcoes) { this.atual = new FakeTrocaTexto(o); }
  async medirHeadline(i: Parameters<TrocaTextoPort['medirHeadline']>[0]) { this.chamadas.push({ op: 'medir', championId: i.championId }); return this.atual.medirHeadline(i); }
  async placaHeadline(i: Parameters<TrocaTextoPort['placaHeadline']>[0]) { this.chamadas.push({ op: 'placa', championId: i.championId }); return this.atual.placaHeadline(i); }
}

type Piece = { id: string; type: string; status: string; headline?: { mode: string; copy?: string; fontTier?: string | null; fitStep?: string | null; fit?: unknown } | null };

describe(isLocal ? 'F1b B1: headline copiada do criativo (integração local, porta fake)' : 'F1b B1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const porta = new PortaTrocavel();
  let token = '';
  let wsId = '';
  let dir = '';
  let championId = '';
  let baseMap: Record<string, unknown> = {};
  let offerId = '';
  let videoBytes: Buffer = Buffer.alloc(0);
  let claude: { headlineFitCalls: number; opts: { headlineFit?: 'fit' | 'same' | 'error' } };
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
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  const planned = (id: string) => until(() => call('GET', `/iterate/${id}`), (r) => !!r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status));

  const style = { fontId: 'montserrat-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' };
  const none = { kind: 'none', color: null, box: null };
  /** Gancho solto (0-4 s) com o texto dado + CTA maior no fim (a regra antiga pegava o CTA) + legenda queimada embaixo. */
  const setLayers = async (gancho: string) => {
    const fc = Number(baseMap.frameCount) || 750;
    const linhas = gancho.split('\n').length;
    const layers = [
      { id: 'cta', kind: 'headline', startFrame: fc - 100, endFrame: fc, box: { x: 40, y: 300, w: 640, h: 300 }, text: 'Download the app now and sleep better tonight', wordsPerPage: null, source: 'vision', style, background: none },
      { id: 'gancho', kind: 'headline', startFrame: 0, endFrame: 100, box: { x: 60, y: 120, w: 600, h: 52 * linhas }, text: gancho, wordsPerPage: null, source: 'vision', style, background: none },
      { id: 'cap1', kind: 'caption', startFrame: 0, endFrame: fc, box: { x: 80, y: 1000, w: 560, h: 90 }, background: none, text: null, wordsPerPage: 3, source: 'vision', style },
    ];
    const { headlineLook: _l, ...rest } = baseMap;
    await prisma.teardown.update({ where: { championId }, data: { editMap: { ...rest, layers } as unknown as Prisma.InputJsonValue } });
    await prisma.championPlate.deleteMany({ where: { championId } });
  };
  const editMap = async () => (await prisma.teardown.findUniqueOrThrow({ where: { championId } })).editMap as Record<string, unknown> & { headlineLook?: { layerId: string; kind: string } | null };
  const headlineItems = (batchId: string) => prisma.variationItem.findMany({ where: { batchId, autoType: 'HEADLINE' } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-headline-copia-'));
    const fakePage: PageCapturePort = {
      capture: async ({ workspaceId }) => {
        const f = await prisma.file.create({ data: { workspaceId, kind: 'PAGE_CAPTURE', storageKey: `ws/${workspaceId}/page_capture/${RUN}-${Date.now()}.png`, mimeType: 'image/png', sizeBytes: 10, width: 1080, height: 3240 } });
        return { fileId: f.id, widthPx: 1080, heightPx: 3240, text: 'Sleep better tonight. Try it free.' };
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAGE_CAPTURE).useValue(fakePage)
      .overrideProvider(TROCA_TEXTO).useValue(porta)
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    app.get(PlacasService).pollMs = 100;
    claude = app.get(CLAUDE_SERVICE) as unknown as typeof claude;
    const email = `hc-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'Hc', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Headline Copia ${RUN}`, shortCode: 'HC', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    wsId = w.id;
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = (await res.json()).data.accessToken;
    offerId = (await prisma.offer.create({
      data: {
        workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
        promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: user.id,
      },
    })).id;
    const path = join(dir, 'v30.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const bytes = await readFile(path);
    videoBytes = bytes;
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(bytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const first = await planned((await call('POST', '/iterate', { uploadId: c.data.uploadId })).data.id);
    expect(first.data.status).toBe('PLAN_READY');
    championId = first.data.source.championId;
    baseMap = (await prisma.teardown.findUniqueOrThrow({ where: { championId } })).editMap as Record<string, unknown>;
  });

  afterAll(async () => {
    if (wsId) {
      await app.get(IteracaoService).recover(wsId).catch(() => undefined);
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creditEntry.deleteMany({ where: { workspaceId: wsId } }).catch(() => undefined);
      await prisma.templateRun.deleteMany({ where: { workspaceId: wsId } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: wsId } });
      await prisma.championPlate.deleteMany({ where: { workspaceId: wsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: wsId } });
      await prisma.upload.deleteMany({ where: { workspaceId: wsId } });
      await prisma.job.deleteMany({ where: { workspaceId: wsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `hc-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('caminho feliz: mede sob demanda o gancho (não o CTA), faz a placa, o laço passa e a peça leva copy/fit', async () => {
    porta.usar({});
    claude.opts.headlineFit = 'fit';
    await setLayers('Tired every single morning\nno matter what you try?');
    porta.chamadas = [];
    const b = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    const em = await editMap();
    expect(em.headlineLook).toMatchObject({ layerId: 'gancho', kind: 'loose' });
    expect(porta.chamadas.map((x) => x.op)).toEqual(['medir', 'placa']);
    const plate = await prisma.championPlate.findFirstOrThrow({ where: { championId } });
    expect(plate).toMatchObject({ kind: 'HEADLINE', layerKey: 'gancho', version: 1, status: 'READY' });
    expect(plate.fileId).not.toBeNull();
    expect((await prisma.file.findUniqueOrThrow({ where: { id: plate.fileId! } })).kind).toBe('CHAMPION_PLATE');
    expect(await prisma.job.count({ where: { workspaceId: wsId, type: 'CHAMPION_PLATE', status: 'SUCCEEDED' } })).toBe(1);
    expect(b.data.analysis.checklist).toEqual(expect.arrayContaining([{ key: 'preparing_plate', status: 'done' }]));
    expect(b.data.insight.headlineBlocked).toBeNull();
    const items = await headlineItems(b.data.id);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect((i.payload as { params: { copy?: string; original?: string } }).params).toMatchObject({ copy: 'loose', original: 'Tired every single morning no matter what you try?' });
    const p = (b.data.pieces as Piece[]).find((x) => x.type === 'HEADLINE');
    expect(p?.headline).toMatchObject({ mode: 'replace', copy: 'loose', fontTier: 'same' });
    expect(p?.headline?.fit).toBeTruthy();

    // 2º lote: placa já READY = sem job novo, sem medir de novo (a trava e o "não reprocessa")
    porta.chamadas = [];
    const b2 = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(b2.data.status).toBe('PLAN_READY');
    expect(porta.chamadas).toEqual([]);
    expect(await prisma.job.count({ where: { workspaceId: wsId, type: 'CHAMPION_PLATE' } })).toBe(1);

    // PATCH …/texts: a mesma função, sem IA. Curto demais = 422 headline_too_short com a medida; ok = grava o fitStep
    const id = (b2.data.pieces as Piece[]).find((x) => x.type === 'HEADLINE')!.id;
    const calls = claude.headlineFitCalls;
    const curto = await call('PATCH', `/iterate/${b2.data.id}/items/${id}/texts`, { texts: [{ path: 'text', value: 'Tired?' }] });
    expect([curto.status, curto.error?.code]).toEqual([422, 'TEXT_INVALID']);
    expect(curto.error.details.violations).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'headline_too_short', detail: expect.stringContaining('exposure') })]));
    const ok = await call('PATCH', `/iterate/${b2.data.id}/items/${id}/texts`, { texts: [{ path: 'text', value: 'Waking up tired every day\nno matter what you try?' }] });
    expect([ok.status, ok.error]).toEqual([200, undefined]);
    expect(claude.headlineFitCalls).toBe(calls);
    const it2 = await prisma.variationItem.findUniqueOrThrow({ where: { id } });
    expect((it2.payload as { params: { fitStep?: string } }).params.fitStep).toBeTruthy();

    // §15.5.4 item 7: o `replace` copiado fica isento da guarda da legenda (a guarda está ligada: há faixa)
    const ctx = await app.get(PlanoAutoService).ctxForChampion(championId, 'en');
    expect(ctx?.caption?.bands.length).toBeGreaterThan(0);
    expect(ctx?.caption?.check({ type: 'HEADLINE' as never, params: { type: 'HEADLINE', mode: 'replace', text: 'x', highlight: null } })).toBeNull();
    expect(ctx?.caption?.blocked.some((x) => x.type === ('HEADLINE' as never))).toBe(false);

    // Gerar: a peça copiada entra no lote (não é aposentada como no F1a). O editor dela fica indisponível até o F3
    const g = await call('GET', `/iterate/${b2.data.id}`);
    expect((g.data.pieces as Piece[]).some((x) => x.type === 'HEADLINE')).toBe(true);
  });

  it('laço: no máximo 3 reescritas (4 medidas) por headline; sem caber a peça sai, headline_no_fit, sem crédito', async () => {
    porta.usar({});
    claude.opts.headlineFit = 'same';
    // original longo: o texto do plano (≈ 25 caracteres) deixa buraco = too_short; a reescrita devolve o mesmo texto
    await setLayers('Every single morning I woke up exhausted\nand angry at myself, no matter how early\nI went to bed the night before');
    const calls0 = claude.headlineFitCalls;
    const b = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    const reescritas = claude.headlineFitCalls - calls0;
    expect(reescritas).toBeGreaterThan(0);
    expect(reescritas % 3).toBe(0); // 3 por headline, nunca mais (4 medidas)
    expect(reescritas).toBeLessThanOrEqual(9);
    expect(await headlineItems(b.data.id)).toEqual([]);
    expect(b.data.insight.headlineBlocked).toEqual({ reason: 'headline_no_fit', mode: 'replace' });
    // custo das reescritas no lote (LLM); nenhuma peça HEADLINE pra cobrar
    expect(await prisma.costEntry.count({ where: { variationBatchId: b.data.id, kind: 'LLM' } })).toBeGreaterThanOrEqual(reescritas);

    // lote de template só com o HEADLINE: plano vazio, fit hard headline_no_fit, nada a gerar, nenhum crédito
    const h = await prisma.template.findFirst({ where: { internalKey: 'HEADLINE', pack: false } });
    expect(h).not.toBeNull();
    const creditos0 = await prisma.creditEntry.count({ where: { workspaceId: wsId } });
    const u = await call('POST', `/ad-templates/${h!.slug}/use`, { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const t = await planned(u.data.id);
    expect([t.data.status, t.data.error]).toEqual(['PLAN_READY', null]);
    expect(t.data.pieces).toEqual([]);
    expect(t.data.template.fit).toEqual({ level: 'hard', reason: 'headline_no_fit' });
    const st = await call('POST', `/iterate/${t.data.id}/start`, { expectedPieces: 1, expectedCostUsd: 0, expectedCredits: 0 });
    expect(st.status).toBe(409);
    expect(await prisma.creditEntry.count({ where: { workspaceId: wsId } })).toBe(creditos0);
    expect(await prisma.creative.count({ where: { variationBatchId: { in: [b.data.id, t.data.id] }, variationItem: { autoType: 'HEADLINE' } } })).toBe(0);
    claude.opts.headlineFit = 'fit';
  });

  it('reprovações da porta: placa REJECTED = headline_plate_rejected e não reprocessa; medida reprovada = motivo da tabela', async () => {
    porta.usar({ placa: 'REJECTED' });
    await setLayers('Tired every single morning\nno matter what you try?');
    const b = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(b.data.insight.headlineBlocked).toEqual({ reason: 'headline_plate_rejected', mode: 'replace' });
    expect(await headlineItems(b.data.id)).toEqual([]);
    expect((await prisma.championPlate.findFirstOrThrow({ where: { championId } })).status).toBe('REJECTED');
    porta.chamadas = [];
    await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(porta.chamadas).toEqual([]); // REJECTED guardada: nem mede nem refaz

    porta.usar({ motivo: 'near_caption' });
    await setLayers('Tired every single morning\nno matter what you try?');
    const c = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(c.data.insight.headlineBlocked).toEqual({ reason: 'headline_near_caption', mode: 'replace' });
    expect(await prisma.championPlate.count({ where: { championId } })).toBe(0);
  });

  it('placa que não fica pronta na espera = headline_pending neste lote; o job termina e serve ao próximo', async () => {
    process.env.PLATE_WAIT_SEC = '1';
    porta.usar({ atrasoMs: 3000 });
    await setLayers('Tired every single morning\nno matter what you try?');
    const b = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(b.data.insight.headlineBlocked).toEqual({ reason: 'headline_pending', mode: 'replace' });
    expect(await headlineItems(b.data.id)).toEqual([]);
    await until(() => prisma.championPlate.findFirstOrThrow({ where: { championId } }), (r) => r.status === 'READY', 20_000);
    process.env.PLATE_WAIT_SEC = '20';
    porta.usar({});
    const b2 = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect(b2.data.insight.headlineBlocked).toBeNull();
    expect((await headlineItems(b2.data.id)).length).toBeGreaterThan(0);
  });

  it('PLATE_IMPL=off: igual ao F1a (headline_pending, sem medir, sem placa, sem laço; HEADLINE copiado antigo sai no Gerar)', async () => {
    const placas = app.get(PlacasService) as unknown as { cfg: { impl: string } };
    porta.usar({});
    claude.opts.headlineFit = 'fit';
    await setLayers('Tired every single morning\nno matter what you try?');
    const ligado = await planned((await call('POST', '/iterate', { championId })).data.id);
    expect((await headlineItems(ligado.data.id)).length).toBeGreaterThan(0);
    placas.cfg.impl = 'off';
    try {
      await setLayers('Tired every single morning\nno matter what you try?');
      porta.chamadas = [];
      const calls0 = claude.headlineFitCalls;
      const b = await planned((await call('POST', '/iterate', { championId })).data.id);
      expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
      expect(b.data.insight.headlineBlocked).toEqual({ reason: 'headline_pending', mode: 'replace' });
      expect(await headlineItems(b.data.id)).toEqual([]);
      expect(porta.chamadas).toEqual([]);
      expect(claude.headlineFitCalls).toBe(calls0);
      expect((await editMap()).headlineLook).toBeUndefined();
      expect(b.data.analysis.checklist.map((x: { key: string }) => x.key)).not.toContain('preparing_plate');
      // o lote planejado com a troca ligada: o HEADLINE copiado não vai pro Gerar com ela desligada
      const g = await call('GET', `/iterate/${ligado.data.id}`);
      expect((g.data.pieces as Piece[]).some((x) => x.type === 'HEADLINE')).toBe(false);
    } finally {
      placas.cfg.impl = 'local';
    }
  });
  /** Campeão novo só pela análise (POST /champions), sem lote nenhum. */
  const campeaoSoAnalisado = async (): Promise<string> => {
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ2.mp4', mimeType: 'video/mp4', sizeBytes: videoBytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(videoBytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const cr = await call('POST', '/champions', { offerId, uploadId: c.data.uploadId, rights: 'OWN' });
    expect(cr.status).toBe(202);
    const pronto = await until(() => call('GET', `/champions/${cr.data.id}`), (r) => r.data?.status === 'READY' || r.data?.status === 'FAILED');
    expect(pronto.data.status).toBe('READY');
    return cr.data.id;
  };
  const fitDaHeadline = async (id: string) => {
    const h = await prisma.template.findFirstOrThrow({ where: { internalKey: 'HEADLINE', pack: false } });
    return (await call('POST', '/ad-templates/fits', { slug: h.slug, sources: [{ championId: id }] })).data.items[0].fit;
  };

  it('decisão 06/11: com o motor ligado, a análise já mede a headline e a galeria mostra o estado certo, sem lote', async () => {
    porta.usar({});
    porta.chamadas = [];
    const id = await campeaoSoAnalisado();
    const td = await until(() => prisma.teardown.findUniqueOrThrow({ where: { championId: id } }), (t) => (t.editMap as { headlineLook?: unknown } | null)?.headlineLook !== undefined, 30_000);
    expect((td.editMap as { headlineLook?: { kind: string } }).headlineLook).toMatchObject({ kind: 'box' }); // o mock lê headline com fundo chapado
    expect(porta.chamadas).toEqual([{ op: 'medir', championId: id }]);
    expect(await prisma.variationBatch.count({ where: { championId: id } })).toBe(0);
    expect(await fitDaHeadline(id)).toEqual({ level: 'ok', reason: null });
    // reprovada na medida: a galeria já mostra o motivo
    porta.usar({ motivo: 'font_far' });
    const id2 = await campeaoSoAnalisado();
    await until(() => prisma.teardown.findUniqueOrThrow({ where: { championId: id2 } }), (t) => (t.editMap as { headlineLook?: unknown } | null)?.headlineLook !== undefined, 30_000);
    expect(await fitDaHeadline(id2)).toEqual({ level: 'hard', reason: 'headline_font_far' });
    porta.usar({});
  });

  it('decisão 06/11: com PLATE_IMPL=off a análise não mede nada e a galeria segue headline_pending (igual hoje)', async () => {
    const placas = app.get(PlacasService) as unknown as { cfg: { impl: string } };
    placas.cfg.impl = 'off';
    try {
      porta.chamadas = [];
      const id = await campeaoSoAnalisado();
      await new Promise((r) => setTimeout(r, 1500));
      expect(porta.chamadas).toEqual([]);
      expect((await prisma.teardown.findUniqueOrThrow({ where: { championId: id } }).then((t) => t.editMap as { headlineLook?: unknown })).headlineLook).toBeUndefined();
      expect(await fitDaHeadline(id)).toEqual({ level: 'hard', reason: 'headline_pending' });
    } finally {
      placas.cfg.impl = 'local';
    }
  });
  it('QA F1b Q1-B5: campeão antigo (sem medida) — galeria e use disparam a medida em segundo plano, 1 vez; depois ok', async () => {
    const placas = app.get(PlacasService) as unknown as { cfg: { impl: string } };
    const h = await prisma.template.findFirstOrThrow({ where: { internalKey: 'HEADLINE', pack: false } });
    const semMedida = (id: string) => prisma.teardown.findUniqueOrThrow({ where: { championId: id } }).then((t) => (t.editMap as { headlineLook?: unknown }).headlineLook);
    // 2 campeões "antigos": analisados com o motor desligado (sem medida)
    placas.cfg.impl = 'off';
    let a = '';
    let b = '';
    try {
      porta.usar({});
      a = await campeaoSoAnalisado();
      b = await campeaoSoAnalisado();
      await new Promise((r) => setTimeout(r, 500));
      // desligado: galeria e use não medem (nada muda)
      porta.chamadas = [];
      expect(await fitDaHeadline(a)).toEqual({ level: 'hard', reason: 'headline_pending' });
      const off = await call('POST', `/ad-templates/${h.slug}/use`, { championId: b });
      expect([off.status, off.error?.code, off.error?.details?.reason]).toEqual([422, 'TEMPLATE_DOESNT_FIT', 'headline_pending']);
      await new Promise((r) => setTimeout(r, 500));
      expect(porta.chamadas).toEqual([]);
      expect(await semMedida(a)).toBeUndefined();
    } finally {
      placas.cfg.impl = 'local';
    }
    // ligado, galeria: responde headline_pending na hora e mede 1 vez (leituras repetidas não duplicam)
    porta.chamadas = [];
    const [f1, f2] = await Promise.all([fitDaHeadline(a), fitDaHeadline(a)]);
    expect([f1, f2]).toEqual([{ level: 'hard', reason: 'headline_pending' }, { level: 'hard', reason: 'headline_pending' }]);
    await until(() => semMedida(a), (l) => l !== undefined, 30_000);
    expect(await fitDaHeadline(a)).toEqual({ level: 'ok', reason: null });
    expect(porta.chamadas).toEqual([{ op: 'medir', championId: a }]);
    // ligado, use: 422 headline_pending, dispara a medida; depois a galeria vê ok e o use passa
    porta.chamadas = [];
    const u1 = await call('POST', `/ad-templates/${h.slug}/use`, { championId: b });
    expect([u1.status, u1.error?.details?.reason]).toEqual([422, 'headline_pending']);
    await until(() => semMedida(b), (l) => l !== undefined, 30_000);
    expect(porta.chamadas).toEqual([{ op: 'medir', championId: b }]);
    expect(await fitDaHeadline(b)).toEqual({ level: 'ok', reason: null });
    const u2 = await call('POST', `/ad-templates/${h.slug}/use`, { championId: b });
    expect([u2.status, u2.error]).toEqual([202, undefined]);
    await planned(u2.data.id);
    expect(porta.chamadas).toEqual([{ op: 'medir', championId: b }]); // o lote não mede de novo
  });
  const startOf = (b: { id: string; pieces: unknown[]; cost: { generateEstimateUsd: number | null }; template: { quote: number } | null }) =>
    call('POST', `/iterate/${b.id}/start`, { expectedPieces: (b.pieces as unknown[]).length, expectedCostUsd: b.cost.generateEstimateUsd ?? 0, ...(b.template && { expectedCredits: b.template.quote }) });
  const terminou = (id: string) => until(() => call('GET', `/iterate/${id}`), (r) => (r.data?.pieces ?? []).length > 0 && (r.data.pieces as Piece[]).every((p) => ['ready', 'failed', 'left_out'].includes(p.status)));
  /** Lote do template HEADLINE (crédito por peça), com o solto medido e a placa READY. */
  const loteHeadline = async () => {
    porta.usar({});
    claude.opts.headlineFit = 'fit';
    await setLayers('Tired every single morning\nno matter what you try?');
    // setLayers zera a medida (campeão "antigo"): 1 lote normal mede e faz a placa
    await planned((await call('POST', '/iterate', { championId })).data.id);
    const h = await prisma.template.findFirstOrThrow({ where: { internalKey: 'HEADLINE', pack: false } });
    const u = await call('POST', `/ad-templates/${h.slug}/use`, { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planned(u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    expect((b.data.pieces as Piece[]).length).toBeGreaterThan(0);
    return b;
  };

  it('render: peça loose com placa READY chega ao render com a placa como base (plateUrl)', async () => {
    const b = await loteHeadline();
    const plate = await prisma.championPlate.findFirstOrThrow({ where: { championId, status: 'READY' }, include: { file: true } });
    expect([(await startOf(b.data)).status]).toEqual([202]);
    await terminou(b.data.id);
    const renders = await prisma.render.findMany({ where: { creative: { variationBatchId: b.data.id } } });
    expect(renders.length).toBeGreaterThan(0);
    for (const r of renders) {
      const input = r.input as { kind?: string; baseVideoUrl?: string };
      expect(input.kind).toBe('remix-keep');
      expect(input.baseVideoUrl).toContain(plate.file!.storageKey);
    }
  });

  it('render: placa some depois do plano = HEADLINE_PENDING, leave out, sem crédito cobrado', async () => {
    const b = await loteHeadline();
    await prisma.championPlate.deleteMany({ where: { championId } });
    expect([(await startOf(b.data)).status]).toEqual([202]);
    const done = await terminou(b.data.id);
    for (const p of done.data.pieces as (Piece & { errorCode: string | null; retryHint: string | null })[]) expect([p.status, p.errorCode, p.retryHint]).toEqual(['failed', 'HEADLINE_PENDING', 'leave_out']);
    await app.get(CreditosService).settleAll(wsId); // o assentamento roda por intervalo; aqui na hora
    const run = await prisma.templateRun.findUniqueOrThrow({ where: { batchId: b.data.id } });
    expect([run.status, run.charged, run.refunded > 0]).toEqual(['SETTLED', 0, true]);
  });

  it('render: HEADLINE_NO_FIT (texto curto com placa READY) = leave out, sem crédito', async () => {
    const b = await loteHeadline();
    for (const it of await headlineItems(b.data.id)) {
      await prisma.variationItem.update({ where: { id: it.id }, data: { payload: { ...(it.payload as object), params: { ...(it.payload as { params: object }).params, text: 'Tired?' } } as Prisma.InputJsonValue } });
    }
    expect([(await startOf(b.data)).status]).toEqual([202]);
    const done = await terminou(b.data.id);
    for (const p of done.data.pieces as (Piece & { errorCode: string | null; retryHint: string | null })[]) expect([p.status, p.errorCode, p.retryHint]).toEqual(['failed', 'HEADLINE_NO_FIT', 'leave_out']);
    await app.get(CreditosService).settleAll(wsId); // o assentamento roda por intervalo; aqui na hora
    const run = await prisma.templateRun.findUniqueOrThrow({ where: { batchId: b.data.id } });
    expect([run.status, run.charged, run.refunded > 0]).toEqual(['SETTLED', 0, true]);
  });
});
