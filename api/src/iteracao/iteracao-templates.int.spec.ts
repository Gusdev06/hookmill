// iterate-v2-quiz-templates-ia F1 (templates grátis CHAT_DM e PERSON_MOTION) de ponta a ponta contra a infra LOCAL
// (maquina_test), integrações em mock (custo zero), render fake: upload → análise → plano com ITERATE_TEMPLATES=on →
// CHAT_DM no lote (PERSON_MOTION fora: o vídeo sintético não tem rosto) → rosto no editMap → "Novo lote" do mesmo campeão
// → os dois templates → start → peças prontas com o nome MC_MMDD_CODIGO_9x16.mp4, selo e só 9:16.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.ITERATE_TEMPLATES = 'on';
const PORT = 3198;
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

describe(isLocal ? 'Iterate v2 F1 templates (integração local)' : 'Iterate v2 F1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let token = '';
  let wsId = '';
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

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-tpl-'));
    const fakePage: PageCapturePort = {
      capture: async ({ workspaceId }) => {
        const f = await prisma.file.create({ data: { workspaceId, kind: 'PAGE_CAPTURE', storageKey: `ws/${workspaceId}/page_capture/${RUN}.png`, mimeType: 'image/png', sizeBytes: 10, width: 1080, height: 3240 } });
        return { fileId: f.id, widthPx: 1080, heightPx: 3240, text: 'Sleep better tonight. Try it free.' };
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAGE_CAPTURE).useValue(fakePage).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const email = `it-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { email, name: 'It T', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `Acme Tpl ${RUN}`, shortCode: 'MC', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: user.id, role: 'OWNER' }] } } });
    wsId = w.id;
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    token = (await res.json()).data.accessToken;
    await prisma.offer.create({
      data: {
        workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
        promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: user.id,
      },
    });
  });

  afterAll(async () => {
    if (wsId) {
      await app.get(IteracaoService).recover(wsId).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: wsId, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: wsId, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
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

  let championId = '';

  it('config com a flag ligada traz CHAT_DM e PERSON_MOTION', async () => {
    const r = await call('GET', '/iterate/config');
    expect(r.data.types).toEqual(expect.arrayContaining(['CHAT_DM', 'PERSON_MOTION']));
  });

  it('1º lote: CHAT_DM entra; PERSON_MOTION fica fora (sem rosto no vídeo sintético)', async () => {
    const path = join(dir, 'v30.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${token}` }, body: new Uint8Array(bytes) });
    await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    const cr = await call('POST', '/iterate', { uploadId: c.data.uploadId });
    expect(cr.status).toBe(202);
    const b = await settled(cr.data.id);
    expect(b.data.status).toBe('PLAN_READY');
    championId = b.data.source.championId;
    const types = b.data.pieces.map((p: { type: string }) => p.type);
    expect(types).toContain('CHAT_DM');
    expect(types).not.toContain('PERSON_MOTION');
    const chat = b.data.pieces.find((p: { type: string }) => p.type === 'CHAT_DM');
    expect(chat).toMatchObject({ code: 'CHAT-DM', axis: 'DIVERSITY', folder: '2-new-audience', isNewTemplate: true, template: { id: 'chat-dm', spans: null } });
    const item = await prisma.variationItem.findUniqueOrThrow({ where: { id: chat.id } });
    const params = (item.payload as { params: Record<string, unknown> }).params;
    expect(params).toMatchObject({ type: 'CHAT_DM', templateId: 'chat-dm', brand: { name: 'Sleep app' } });
  });

  it('com rosto no editMap, o "Novo lote" do mesmo campeão traz os 2 templates; start → prontos, nome certo, só 9:16', async () => {
    const td = await prisma.teardown.findUniqueOrThrow({ where: { championId } });
    const em = td.editMap as Record<string, unknown>;
    const fc = Number(em.frameCount) || 750;
    const faceTrack = [{ startFrame: 0, endFrame: fc, role: 'main', region: { x: 0, y: 0, w: Number(em.width) || 720, h: Number(em.height) || 1280 }, faceInRegion: [{ atFrame: 0, box: { x: 0.35, y: 0.2, w: 0.3, h: 0.22 } }] }];
    await prisma.teardown.update({ where: { championId }, data: { editMap: { ...em, faceTrack, layers: [], protectedBands: [] } as unknown as Prisma.InputJsonValue } });
    const cr = await call('POST', '/iterate', { championId });
    expect(cr.status).toBe(202);
    const b = await settled(cr.data.id);
    expect(b.data.status).toBe('PLAN_READY');
    const pm = b.data.pieces.find((p: { type: string }) => p.type === 'PERSON_MOTION');
    expect(pm).toMatchObject({ code: 'PERSON-MOTION', axis: 'DIVERSITY', isNewTemplate: true, template: { id: 'person-motion' } });
    expect(pm.template.spans.length).toBeGreaterThanOrEqual(2);
    expect(b.data.pieces.some((p: { type: string }) => p.type === 'CHAT_DM')).toBe(true);
    const st = await call('POST', `/iterate/${cr.data.id}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: b.data.cost.generateEstimateUsd ?? 0 });
    expect(st.status).toBe(202);
    const done = await until(() => call('GET', `/iterate/${cr.data.id}`), (r) => r.data.pieces.filter((p: { type: string; status: string }) => ['CHAT_DM', 'PERSON_MOTION'].includes(p.type)).every((p: { status: string }) => p.status === 'ready' || p.status === 'failed'));
    for (const t of ['CHAT_DM', 'PERSON_MOTION']) {
      const p = done.data.pieces.find((x: { type: string }) => x.type === t);
      expect(p.status).toBe('ready');
      const code = t === 'CHAT_DM' ? 'CHAT-DM' : 'PERSON-MOTION';
      expect(p.files.map((f: { name: string }) => f.name)).toEqual([expect.stringMatching(new RegExp(`^MC_\\d{4}_${code}_9x16\\.mp4$`))]);
      expect(p.formats.filter((f: { supported?: boolean }) => f.supported === false).map((f: { format: string }) => f.format)).toEqual(['4x5', '1x1']);
      const r = await prisma.render.findFirstOrThrow({ where: { creative: { variationItemId: p.id }, format: 'VERTICAL_9_16' }, orderBy: { createdAt: 'desc' } });
      expect((r.input as { kind: string; templateId: string }).kind).toBe('template');
      expect((r.input as { templateId: string }).templateId).toBe(t === 'CHAT_DM' ? 'chat-dm' : 'person-motion');
    }
  });
});
