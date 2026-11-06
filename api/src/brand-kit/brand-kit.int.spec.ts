// kit-marca-v1 contra a infra LOCAL (maquina_test + S3 local), integrações em mock: upload BRAND_* (tipo e assinatura
// conferidos), CRUD de /brand-kit, logo único (troca o anterior), cores do logo (PNG pela medição, SVG pelo texto),
// vínculo com oferta, limites, papéis (CLIENT só lê), isolamento de workspace, logo no FrameBrand e kit no Brain.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'off';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3188;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { BrainNodeDetail, BrandAsset, BrandKit } from '@maquina/contratos';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { frameBrandOf } from '../iteracao/contexto';
import { configureApp } from '../main';
import { BRAND_LOGO_INCLUDE } from './logo';
import { svgColors } from './brand-kit.service';

const run = promisify(execFile);
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(180_000);

const RUN = Date.now().toString(36);
const PREFIX = `kit-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'member' | 'client' | 'other';

describe(isLocal ? 'Kit da marca v1 (integração local)' : 'Kit da marca v1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base = '';
  let dir = '';
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1 = '';
  let offerId = '';
  let otherOfferId = '';

  const call = async <T = unknown>(method: string, path: string, body?: unknown, who: Who = 'owner') => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${users[who].token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data as T, error: j.error };
  };
  async function upload(bytes: Buffer, name: string, mimeType: string, purpose: string, who: Who = 'owner') {
    const c = await call<{ uploadId: string; url: string }>('POST', '/uploads', { purpose, filename: name, mimeType, sizeBytes: bytes.length }, who);
    expect(c.status).toBe(201);
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': mimeType, authorization: `Bearer ${users[who].token}` }, body: new Uint8Array(bytes) });
    const done = await call('POST', `/uploads/${c.data.uploadId}/complete`, {}, who);
    return { id: c.data.uploadId, complete: done };
  }
  const ffmpeg = (args: string[]) => run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60_000 });
  async function solidPng(name: string, color: string): Promise<Buffer> {
    const p = join(dir, name);
    await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', p]);
    return readFile(p);
  }
  async function demoVideo(sec: number): Promise<Buffer> {
    const p = join(dir, `demo-${sec}.mp4`);
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=25:duration=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', p]);
    return readFile(p);
  }
  const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="#ffffff" width="10" height="10"/><circle fill="#1E88E5" r="3"/><circle fill="#1e88e5" r="2"/><path stroke="#F2C14E"/></svg>');
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    dir = await mkdtemp(join(tmpdir(), 'kit-marca-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    base = `http://127.0.0.1:${PORT}/api/v1`;

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'member', 'client', 'other'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { access: 'INTERNAL', email, name: `Kit ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}Acme Sleep`, shortCode: 'KT', industry: 'Bedding', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: [
          { userId: users.owner.id, role: 'OWNER', tourCompletedAt: new Date() },
          { userId: users.member.id, role: 'MEMBER', tourCompletedAt: new Date() },
          { userId: users.client.id, role: 'CLIENT', tourCompletedAt: new Date() },
        ] },
      },
    })).id;
    const w2 = (await prisma.workspace.create({
      data: { name: `${PREFIX}outro`, shortCode: 'OT', onboardingStep: 6, onboardingCompletedAt: new Date(), memberships: { create: [{ userId: users.other.id, role: 'OWNER', tourCompletedAt: new Date() }] } },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[k].email, password: PASSWORD }) });
      expect(r.status).toBe(200);
      users[k].token = (await r.json()).data.accessToken;
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Cool Sheets', language: 'en', createdById: users.owner.id } })).id;
    otherOfferId = (await prisma.offer.create({ data: { workspaceId: w2, name: 'Other', language: 'en', createdById: users.other.id } })).id;
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('upload BRAND_*: tipo e teto conferidos no POST; assinatura conferida no complete', async () => {
    const bad = (purpose: string, mimeType: string, sizeBytes = 10) => call('POST', '/uploads', { purpose, filename: 'x', mimeType, sizeBytes });
    expect((await bad('BRAND_LOGO', 'application/pdf')).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await bad('BRAND_LOGO', 'image/png', 6 * 1024 * 1024)).error).toMatchObject({ code: 'MEDIA_TOO_LARGE', details: { maxBytes: 5 * 1024 * 1024 } });
    expect((await bad('BRAND_FILE', 'image/svg+xml')).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await bad('BRAND_VIDEO', 'image/png')).error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    expect((await bad('BRAND_NOPE', 'image/png')).status).toBe(400);
    // PDF declarado mas é lixo = 422 no complete
    const fake = await upload(Buffer.alloc(64, 7), 'deck.pdf', 'application/pdf', 'BRAND_FILE');
    expect(fake.complete.error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    const pdf = await upload(PDF, 'deck.pdf', 'application/pdf', 'BRAND_FILE');
    expect(pdf.complete).toMatchObject({ status: 200, data: { status: 'READY', warnings: [], analysisEstimateUsd: 0, file: { mimeType: 'application/pdf' } } });
    expect(await prisma.file.count({ where: { workspaceId: w1, kind: 'BRAND_FILE' } })).toBe(1);
  });

  it('CRUD: logo PNG (cores medidas), troca de logo, arquivo com oferta, vídeo demo; GET agrupa', async () => {
    const red = await upload(await solidPng('red.png', '0xE53935'), 'logo.png', 'image/png', 'BRAND_LOGO');
    expect(red.complete.status).toBe(200);
    const l1 = await call<BrandAsset>('POST', '/brand-kit/assets', { kind: 'LOGO', uploadId: red.id, label: '  Logo vermelho ' });
    expect(l1.status).toBe(201);
    expect(l1.data).toMatchObject({ kind: 'LOGO', label: 'Logo vermelho', offerId: null, file: { mimeType: 'image/png' } });
    expect(l1.data.colors.length).toBeGreaterThan(0);
    expect(l1.data.colors[0]).toMatch(/^#[0-9A-F]{6}$/);
    // o mesmo upload de novo = o mesmo asset
    expect((await call<BrandAsset>('POST', '/brand-kit/assets', { kind: 'LOGO', uploadId: red.id })).data.id).toBe(l1.data.id);
    // kind errado pro upload (logo como arquivo) = 422
    expect((await call('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: red.id })).error).toMatchObject({ code: 'MEDIA_INVALID' });

    // logo SVG troca o PNG (1 por cliente); cores pelo texto, neutras no fim
    const svg = await upload(SVG, 'logo.svg', 'image/svg+xml', 'BRAND_LOGO');
    expect(svg.complete.status).toBe(200);
    const l2 = await call<BrandAsset>('POST', '/brand-kit/assets', { kind: 'LOGO', uploadId: svg.id });
    expect(l2.data.colors).toEqual(['#1E88E5', '#F2C14E', '#FFFFFF']);
    expect(await prisma.brandAsset.count({ where: { workspaceId: w1, kind: 'LOGO' } })).toBe(1);

    const shot = await upload(await solidPng('shot.png', 'white'), 'print.png', 'image/png', 'BRAND_FILE');
    const f1 = await call<BrandAsset>('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: shot.id, label: 'Print do app', offerId });
    expect(f1.data).toMatchObject({ kind: 'FILE', offerId, colors: [] });
    // oferta de outro workspace = 404
    const pdf = await upload(PDF, 'deck2.pdf', 'application/pdf', 'BRAND_FILE');
    expect((await call('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: pdf.id, offerId: otherOfferId })).status).toBe(404);
    await call('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: pdf.id });

    // vídeo demo: curto demais = 422; ok = DEMO_VIDEO
    const tooShort = await upload(await demoVideo(0.4), 'short.mp4', 'video/mp4', 'BRAND_VIDEO');
    expect(tooShort.complete.error).toMatchObject({ code: 'MEDIA_TOO_SHORT', details: { minSec: 1 } });
    const vid = await upload(await demoVideo(2), 'demo.mp4', 'video/mp4', 'BRAND_VIDEO');
    expect(vid.complete).toMatchObject({ status: 200, data: { warnings: [], analysisEstimateUsd: 0 } });
    const d1 = await call<BrandAsset>('POST', '/brand-kit/assets', { kind: 'DEMO_VIDEO', uploadId: vid.id, label: 'Demo', offerId });
    expect(d1.data.file).toMatchObject({ mimeType: 'video/mp4', width: 720, height: 1280 });

    const kit = await call<BrandKit>('GET', '/brand-kit');
    expect(kit.status).toBe(200);
    expect(kit.data.logo).toMatchObject({ id: l2.data.id, file: { mimeType: 'image/svg+xml' } });
    expect(kit.data.files.map((f) => f.label)).toEqual(['Print do app', null]);
    expect(kit.data.demoVideos).toHaveLength(1);
    expect(kit.data.logo!.file.url).toMatch(/^https?:\/\//);

    // PATCH: rótulo e vínculo; null limpa
    const p = await call<BrandAsset>('PATCH', `/brand-kit/assets/${f1.data.id}`, { label: null, offerId: null });
    expect(p.data).toMatchObject({ label: null, offerId: null });
    expect((await call('PATCH', `/brand-kit/assets/${f1.data.id}`, { label: 'x'.repeat(81) })).status).toBe(400);

    // DELETE (o File fica)
    expect((await call('DELETE', `/brand-kit/assets/${f1.data.id}`)).data).toEqual({ ok: true });
    expect((await call('DELETE', `/brand-kit/assets/${f1.data.id}`)).status).toBe(404);
    expect(await prisma.file.count({ where: { id: f1.data.file.id } })).toBe(1);
  });

  it('papéis: MEMBER escreve; CLIENT só lê; outro workspace não vê nem mexe', async () => {
    const kit = (await call<BrandKit>('GET', '/brand-kit')).data;
    const fileId = kit.files[0]!.id;
    expect((await call('PATCH', `/brand-kit/assets/${fileId}`, { label: 'pelo member' }, 'member')).status).toBe(200);
    expect((await call<BrandKit>('GET', '/brand-kit', undefined, 'client')).data.logo?.id).toBe(kit.logo!.id);
    expect((await call('PATCH', `/brand-kit/assets/${fileId}`, { label: 'x' }, 'client')).error).toMatchObject({ code: 'FORBIDDEN' });
    expect((await call('DELETE', `/brand-kit/assets/${fileId}`, undefined, 'client')).status).toBe(403);
    expect((await call('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: 'x' }, 'client')).status).toBe(403);
    expect((await call('POST', '/uploads', { purpose: 'BRAND_FILE', filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 10 }, 'client')).status).toBe(403);
    // outro workspace
    expect((await call<BrandKit>('GET', '/brand-kit', undefined, 'other')).data).toEqual({ logo: null, files: [], demoVideos: [] });
    expect((await call('PATCH', `/brand-kit/assets/${fileId}`, { label: 'x' }, 'other')).status).toBe(404);
    expect((await call('DELETE', `/brand-kit/assets/${fileId}`, undefined, 'other')).status).toBe(404);
    const up = await prisma.upload.findFirst({ where: { workspaceId: w1, purpose: 'BRAND_FILE', status: 'READY' } });
    expect((await call('POST', '/brand-kit/assets', { kind: 'FILE', uploadId: up!.id }, 'other')).status).toBe(404);
  });

  it('logo chega no FrameBrand (logoFileId + cor do logo na cadeia); sem logo = só iniciais', async () => {
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: w1 }, include: { brandAssets: BRAND_LOGO_INCLUDE } });
    const logo = await prisma.brandAsset.findFirstOrThrow({ where: { workspaceId: w1, kind: 'LOGO' } });
    const b = frameBrandOf({ offer, workspace: ws }, ['#22AA44']);
    expect(b).toMatchObject({ name: 'Cool Sheets', initials: 'CS', logoFileId: logo.fileId, color: '#1E88E5' });
    // a cor do cadastro ainda manda
    expect(frameBrandOf({ offer, workspace: { ...ws, brandColor: '#112233' } }, null).color).toBe('#112233');
    // sem logo no kit: como antes
    const semLogo = frameBrandOf({ offer, workspace: { ...ws, brandAssets: [] } }, ['#22AA44']);
    expect(semLogo.logoFileId).toBeUndefined();
  });

  it('Brain: o nó do negócio mostra o kit (logo de pôster, vídeo demo)', async () => {
    const r = await call<BrainNodeDetail>('GET', `/brain/node/${encodeURIComponent(`business:${w1}`)}`);
    expect(r.status).toBe(200);
    const field = (k: string) => r.data.fields.find((f) => f.key === k)?.value;
    expect(field('brand.logo')).toBe('logo');
    expect(field('brand.colors')).toBe('#1E88E5, #F2C14E, #FFFFFF');
    expect(field('brand.files')).toBe(1);
    expect(field('brand.demoVideos')).toBe(1);
    expect(r.data.media?.posterUrl).toMatch(/^https?:\/\//);
    expect(r.data.media?.videoUrl).toMatch(/^https?:\/\//);
  });

  it('limite: 5 vídeos demo por cliente', async () => {
    await prisma.brandAsset.createMany({
      data: await Promise.all([1, 2, 3, 4].map(async (i) => ({
        workspaceId: w1, kind: 'DEMO_VIDEO' as const, createdById: users.owner.id,
        fileId: (await prisma.file.create({ data: { workspaceId: w1, kind: 'BRAND_VIDEO', storageKey: `ws/${w1}/brand_video/${RUN}-${i}.mp4`, mimeType: 'video/mp4', sizeBytes: 1 } })).id,
      }))),
    });
    const vid = await upload(await demoVideo(1.5), 'demo6.mp4', 'video/mp4', 'BRAND_VIDEO');
    expect((await call('POST', '/brand-kit/assets', { kind: 'DEMO_VIDEO', uploadId: vid.id })).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'brand_kit_full', max: 5 } });
  });
});

describe('svgColors', () => {
  it('conta #rgb/#rrggbb, ordena por uso e deixa branco/preto no fim', () => {
    expect(svgColors('<svg><g fill="#000"/><g fill="#abc"/><g stroke="#AABBCC"/><g fill="#123456"/></svg>')).toEqual(['#AABBCC', '#123456', '#000000']);
    expect(svgColors('<svg/>')).toEqual([]);
  });
});
