// troca-texto-queimado-v1 §15.4, §15.6.5 (F2 backend): captionTrack na leitura, placa CAPTION, formatos resgatados. Contra a infra LOCAL (maquina_test), integrações em mock (custo zero),
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
process.env.CAPTION_SWAP = 'on';
const PORT = 3194;
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
import { FakeTrocaTexto, TROCA_TEXTO, type FakeTrocaOpcoes, type TrocaPorta } from '../medicao/troca';
import { swapDecisao } from './legenda-protegida';
import { IteracaoService } from './iteracao.service';
import { PlanoAutoService } from './plano-auto.service';
import { PAGE_CAPTURE, type PageCapturePort } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(900_000);
const RUN = `lg${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);

/** A porta do teste: delega ao fake da vez (cada caso troca as opções). */
class PortaTrocavel implements TrocaPorta {
  atual = new FakeTrocaTexto();
  chamadas: Array<{ op: string; championId: string }> = [];
  usar(o: FakeTrocaOpcoes) { this.atual = new FakeTrocaTexto(o); }
  async medirHeadline(i: Parameters<TrocaPorta['medirHeadline']>[0]) { this.chamadas.push({ op: 'medir', championId: i.championId }); return this.atual.medirHeadline(i); }
  async placaHeadline(i: Parameters<TrocaPorta['placaHeadline']>[0]) { this.chamadas.push({ op: 'placa', championId: i.championId }); return this.atual.placaHeadline(i); }
  async detectarLegenda(i: Parameters<TrocaPorta['detectarLegenda']>[0]) { this.chamadas.push({ op: 'detectar_legenda', championId: i.championId }); return this.atual.detectarLegenda(i); }
  async placaLegenda(i: Parameters<TrocaPorta['placaLegenda']>[0]) { this.chamadas.push({ op: 'placa_legenda', championId: i.championId }); return this.atual.placaLegenda(i); }
}

type Piece = { id: string; type: string; status: string; headline?: { mode: string; copy?: string; fontTier?: string | null; fitStep?: string | null; fit?: unknown } | null };

describe(isLocal ? 'F2 backend: troca de legenda (integração local, porta fake)' : 'F2 backend [pulado: DATABASE_URL não é localhost]', () => {
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
  /** Legenda queimada grande no meio (tapa moldura e tipos) ou nenhuma. Apaga captionTrack, placas e jobs. */
  const setLayers = async (legenda: boolean) => {
    const fc = Number(baseMap.frameCount) || 750;
    const layers = legenda ? [{ id: 'cap1', kind: 'caption', startFrame: 0, endFrame: fc, box: { x: 80, y: 100, w: 560, h: 1080 }, background: none, text: null, wordsPerPage: 3, source: 'vision', style }] : [];
    const { headlineLook: _l, captionTrack: _c, ...rest } = baseMap;
    await prisma.teardown.update({ where: { championId }, data: { editMap: { ...rest, layers } as unknown as Prisma.InputJsonValue } });
    await prisma.championPlate.deleteMany({ where: { championId } });
  };
  const editMap = async () => (await prisma.teardown.findUniqueOrThrow({ where: { championId } })).editMap as Record<string, unknown> & { captionTrack?: { veredito: { swap: boolean; reason: string | null } } | null };
  const plano = async () => planned((await call('POST', '/iterate', { championId })).data.id);
  type Blocked = { type: string; reason: string; swapReason?: string };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-legenda-swap-'));
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
    const email = `lg-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'Lg', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Legenda Swap ${RUN}`, shortCode: 'LG', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
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
      await prisma.user.deleteMany({ where: { email: { startsWith: `lg-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it('swap aprovado: detecta na leitura (captionTrack), faz a placa CAPTION antes do plano e resgata os formatos', async () => {
    porta.usar({});
    await setLayers(true);
    // sem a troca de legenda: o que a faixa grande tampa (referência do que o F2 resgata)
    process.env.CAPTION_SWAP = 'off'; // baseline: só a legenda desligada (a headline segue ligada)
    const antes = await plano();
    process.env.CAPTION_SWAP = 'on';
    const bloqueadosAntes = (antes.data.insight.captionBlocked ?? []) as Blocked[];
    expect(bloqueadosAntes.length).toBeGreaterThan(0);
    expect((await editMap()).captionTrack).toBeUndefined();
    expect(porta.chamadas).toEqual(expect.not.arrayContaining([{ op: 'detectar_legenda', championId }]));

    porta.chamadas = [];
    const b = await plano();
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    const em = await editMap();
    expect(em.captionTrack?.veredito).toMatchObject({ swap: true, reason: null });
    expect(porta.chamadas.map((x) => x.op)).toEqual(expect.arrayContaining(['detectar_legenda', 'placa_legenda']));
    const plate = await prisma.championPlate.findFirstOrThrow({ where: { championId, kind: 'CAPTION' } });
    expect(plate).toMatchObject({ layerKey: 'caption', version: 1, status: 'READY' });
    expect((await prisma.file.findUniqueOrThrow({ where: { id: plate.fileId! } })).kind).toBe('CHAMPION_PLATE');
    expect(b.data.analysis.checklist).toEqual(expect.arrayContaining([{ key: 'preparing_plate', status: 'done' }]));
    // F2 (12/11): a decisão real do vídeo está ligada no seam: com a placa pronta, parte dos formatos bloqueados é resgatada (aqui 8 → 7: question_box); o resto segue fora
    expect(((b.data.insight.captionBlocked ?? []) as Blocked[]).length).toBeLessThan(bloqueadosAntes.length);
    expect(await prisma.job.count({ where: { workspaceId: wsId, type: 'CHAMPION_PLATE', status: 'SUCCEEDED' } })).toBe(1);

    // 2º lote: captionTrack e placa guardadas = a porta não é chamada
    porta.chamadas = [];
    const b2 = await plano();
    expect(b2.data.status).toBe('PLAN_READY');
    expect(porta.chamadas).toEqual([]);
    expect(await prisma.job.count({ where: { workspaceId: wsId, type: 'CHAMPION_PLATE' } })).toBe(1);

    // a decisão do vídeo injetada (`swap`): os formatos são resgatados
    const orig = swapDecisao.decidir;
    swapDecisao.decidir = () => 'swap';
    try {
      const b3 = await plano();
      expect(((b3.data.insight.captionBlocked ?? []) as Blocked[]).length).toBeLessThan(bloqueadosAntes.length);
    } finally {
      swapDecisao.decidir = orig;
    }
  });

  it.each(['busy_background', 'font_mismatch', 'too_long'] as const)('vídeo reprovou (%s): sem placa, formatos seguem fora, com swapReason', async (motivo) => {
    porta.usar({ motivoLegenda: motivo });
    await setLayers(true);
    porta.chamadas = [];
    const b = await plano();
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    expect((await editMap()).captionTrack?.veredito).toMatchObject({ swap: false, reason: motivo });
    expect(porta.chamadas.map((x) => x.op)).toEqual(['detectar_legenda']);
    expect(await prisma.championPlate.count({ where: { championId } })).toBe(0);
    const bl = b.data.insight.captionBlocked as Blocked[];
    expect(bl.length).toBeGreaterThan(0);
    for (const x of bl) expect(x).toMatchObject({ reason: 'burned_captions', swapReason: motivo });
  });

  it.each([['REJECTED', 'plate_rejected'], ['FAILED', 'plate_failed']] as const)('placa %s: formatos seguem fora (%s) e não reprocessa', async (status, motivo) => {
    porta.usar({ placaLegenda: status });
    await setLayers(true);
    const b = await plano();
    expect(b.data.status).toBe('PLAN_READY');
    expect((await prisma.championPlate.findFirstOrThrow({ where: { championId, kind: 'CAPTION' } })).status).toBe(status);
    for (const x of b.data.insight.captionBlocked as Blocked[]) expect(x.swapReason).toBe(motivo);
    expect((b.data.insight.captionBlocked as Blocked[]).length).toBeGreaterThan(0);
    porta.chamadas = [];
    await plano();
    expect(porta.chamadas).toEqual([]);
  });

  it('placa que não fica pronta na espera: formatos fora neste lote; o job termina e serve ao próximo', async () => {
    process.env.PLATE_WAIT_SEC = '1';
    porta.usar({ atrasoMs: 3000 });
    await setLayers(true);
    const b = await plano();
    expect(((b.data.insight.captionBlocked ?? []) as Blocked[]).length).toBeGreaterThan(0);
    await until(() => prisma.championPlate.findFirstOrThrow({ where: { championId, kind: 'CAPTION' } }), (r) => r.status === 'READY', 20_000);
    process.env.PLATE_WAIT_SEC = '20';
    porta.usar({});
    const orig = swapDecisao.decidir;
    swapDecisao.decidir = () => 'swap';
    try {
      const b2 = await plano();
      expect(((b2.data.insight.captionBlocked ?? []) as Blocked[]).length).toBeLessThan(((b.data.insight.captionBlocked ?? []) as Blocked[]).length);
    } finally {
      swapDecisao.decidir = orig;
    }
  });

  it('campeão sem legenda queimada: captionTrack null, a função não é chamada, nada de placa', async () => {
    porta.usar({});
    await setLayers(false);
    porta.chamadas = [];
    const b = await plano();
    expect(b.data.status).toBe('PLAN_READY');
    expect((await editMap()).captionTrack).toBeNull();
    expect(porta.chamadas.map((x) => x.op)).not.toContain('detectar_legenda');
    expect(await prisma.championPlate.count({ where: { championId, kind: 'CAPTION' } })).toBe(0);
    expect(b.data.insight.captionBlocked ?? []).toEqual([]);
  });

  it('PLATE_IMPL=off: igual ao F1b (sem detectar, sem placa, formatos fora, sem swapReason)', async () => {
    const placas = app.get(PlacasService) as unknown as { cfg: { impl: string } };
    porta.usar({});
    await setLayers(true);
    placas.cfg.impl = 'off';
    try {
      porta.chamadas = [];
      const b = await plano();
      expect(b.data.status).toBe('PLAN_READY');
      expect(porta.chamadas).toEqual([]);
      expect((await editMap()).captionTrack).toBeUndefined();
      const bl = b.data.insight.captionBlocked as Blocked[];
      expect(bl.length).toBeGreaterThan(0);
      for (const x of bl) expect(x.swapReason).toBeUndefined();
      expect(b.data.analysis.checklist.map((x: { key: string }) => x.key)).not.toContain('preparing_plate');
    } finally {
      placas.cfg.impl = 'local';
    }
  });

  it.each(['busy_background'] as const)('lote de template: fit soft burned_captions leva swapReason (%s)', async (motivo) => {
    porta.usar({ motivoLegenda: motivo });
    await setLayers(true);
    const g = await call('GET', `/ad-templates?championId=${championId}`);
    const soft = (g.data.items as { slug: string; fit: { level: string } }[]).find((t) => t.fit?.level === 'soft' && t.slug !== 'let-hookmill-pick');
    expect(soft).toBeDefined();
    const u = await call('POST', `/ad-templates/${soft!.slug}/use`, { championId });
    expect(u.status).toBe(202);
    const t = await planned(u.data.id);
    expect(t.data.template.fit).toEqual({ level: 'soft', reason: 'burned_captions', swapReason: motivo });
  });

  it('CAPTION_SWAP=off (padrão): igual ao main na legenda (sem detectar, sem placa, sem swapReason), com a headline ligada', async () => {
    porta.usar({});
    await setLayers(true);
    process.env.CAPTION_SWAP = 'off';
    try {
      porta.chamadas = [];
      const b = await plano();
      expect(b.data.status).toBe('PLAN_READY');
      expect(porta.chamadas.map((x) => x.op)).not.toContain('detectar_legenda');
      expect(porta.chamadas.map((x) => x.op)).not.toContain('placa_legenda');
      expect((await editMap()).captionTrack).toBeUndefined();
      expect(await prisma.championPlate.count({ where: { championId, kind: 'CAPTION' } })).toBe(0);
      const bl = b.data.insight.captionBlocked as Blocked[];
      expect(bl.length).toBeGreaterThan(0);
      for (const x of bl) expect(x.swapReason).toBeUndefined();
      expect(b.data.analysis.checklist.map((x: { key: string }) => x.key)).not.toContain('preparing_plate');
    } finally {
      process.env.CAPTION_SWAP = 'on';
    }
  });
});
