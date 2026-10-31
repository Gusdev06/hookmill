// amostra-gratis-v1 de ponta a ponta contra a infra LOCAL (maquina_test), integrações em mock (custo zero), render fake:
// conta SAMPLE/OWN cria a amostra → lança sozinha (≤ 4 peças, sem STATIC) → vista travada (sem files, prévia) → 2ª amostra,
// zip, formato, retry, editor, download, Meta e arquivo = 402 → antiabuso (mesma conta de anúncio) e P4 → admin INTERNAL
// libera (PAID) = as mesmas peças destravadas sem render novo → workspace INTERNAL nunca trava.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.ITERATE_TEMPLATES = 'off'; // a amostra liga os templates grátis sozinha
const PORT = 3197;
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
import { CustosService } from '../custos/custos.service';
import { IteracaoService } from '../iteracao/iteracao.service';
import { PAGE_CAPTURE, type PageCapturePort } from '../iteracao/portas';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = `am${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const AD_ACCOUNT = `act_${RUN}`;

type Who = 'sample' | 'copycat' | 'agency' | 'internal';

describe(isLocal ? 'Amostra grátis (integração local)' : 'Amostra grátis [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let dir = '';
  const users = {} as Record<Who, { id: string; token: string; wsId: string }>;
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const call = async (who: Who, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${users[who].token}` }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
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
  const upload = async (who: Who) => {
    const bytes = await readFile(join(dir, 'v30.mp4'));
    const c = await call(who, 'POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${users[who].token}` }, body: new Uint8Array(bytes) });
    await call(who, 'POST', `/uploads/${c.data.uploadId}/complete`, {});
    return c.data.uploadId as string;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-amostra-'));
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', join(dir, 'v30.mp4')], { timeout: 60_000 });
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
    const hash = await hashPassword(PASSWORD);
    const spec: Record<Who, { access: 'SAMPLE' | 'INTERNAL'; accountMode: 'OWN' | 'AGENCY' }> = {
      sample: { access: 'SAMPLE', accountMode: 'OWN' }, copycat: { access: 'SAMPLE', accountMode: 'OWN' },
      agency: { access: 'SAMPLE', accountMode: 'AGENCY' }, internal: { access: 'INTERNAL', accountMode: 'AGENCY' },
    };
    for (const k of Object.keys(spec) as Who[]) {
      const email = `am-${RUN}-${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Am ${k}`, passwordHash: hash, ...spec[k] } });
      const w = await prisma.workspace.create({ data: { name: `Am ${k} ${RUN}`, shortCode: 'AM', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: u.id, role: 'OWNER' }] } } });
      await prisma.offer.create({
        data: {
          workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
          promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: u.id,
        },
      });
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      users[k] = { id: u.id, wsId: w.id, token: (await res.json()).data.accessToken };
    }
    // §6: a amostra e o "copião" conectam a MESMA conta de anúncio do Meta
    for (const k of ['sample', 'copycat'] as Who[]) {
      await prisma.metaConnection.create({ data: { workspaceId: users[k].wsId, metaUserId: `mu-${k}`, metaUserName: 'Meta', connectedById: users[k].id, adAccountId: AD_ACCOUNT } });
    }
  });

  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.wsId);
    if (ids.length) {
      for (const id of ids) await app.get(IteracaoService).recover(id).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: { in: ids }, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: { in: ids }, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.upload.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.metaConnection.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `am-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  let batchId = '';
  let championId = '';
  let pieces: { id: string; type: string; status: string; locked: boolean; files: unknown[]; preview: unknown; creativeId: string }[] = [];

  it('cria a amostra: settings.sample, sampleUsedAt gravado e /auth/me com access e sampleUsed', async () => {
    const before = await call('sample', 'GET', '/auth/me');
    expect(before.data.user).toMatchObject({ access: 'SAMPLE', sampleUsed: false });
    const cr = await call('sample', 'POST', '/iterate', { uploadId: await upload('sample') });
    expect(cr.status).toBe(202);
    expect(cr.data.sample).toBe(true);
    batchId = cr.data.id;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users.sample.id } })).sampleUsedAt).not.toBeNull();
    expect((await call('sample', 'GET', '/auth/me')).data.user).toMatchObject({ access: 'SAMPLE', sampleUsed: true });
  });

  it('lança sozinha (sem Generate): ≤ 4 peças, sem STATIC; vista travada sem arquivos e com a prévia quando existe', async () => {
    const b = await until(() => call('sample', 'GET', `/iterate/${batchId}`), (r) => r.data?.status === 'LAUNCHED' || r.data?.status === 'ANALYSIS_FAILED');
    expect(b.data.status).toBe('LAUNCHED');
    championId = b.data.source.championId;
    const done = await until(() => call('sample', 'GET', `/iterate/${batchId}`), (r) => r.data.pieces.every((p: { status: string }) => ['ready', 'failed', 'left_out'].includes(p.status)));
    pieces = done.data.pieces;
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length).toBeLessThanOrEqual(4);
    expect(pieces.some((p) => p.type === 'STATIC')).toBe(false);
    const ready = pieces.filter((p) => p.status === 'ready');
    expect(ready.length).toBeGreaterThan(0);
    for (const p of pieces) expect(p).toMatchObject({ locked: true, files: [] });
    expect(done.data.zip.url).toBeNull();
    // custo da amostra fora do teto do cliente: houve custo (análise), mas o gasto do mês do workspace não vê nada dele
    expect(await prisma.costEntry.count({ where: { workspaceId: users.sample.wsId } })).toBeGreaterThan(0);
    expect(await app.get(CustosService).monthSpent(users.sample.wsId)).toBe(0);
    // a prévia é a do render (o render da maquina-video a gera; sem ela, null): nunca o arquivo final
    for (const p of ready) {
      const r = await prisma.render.findFirstOrThrow({ where: { creative: { variationItemId: p.id }, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' } });
      if (r.previewFileId) expect(p.preview).toMatchObject({ id: r.previewFileId, url: expect.any(String) });
      else expect(p.preview).toBeNull();
      expect((p.preview as { id?: string } | null)?.id).not.toBe(r.fileId);
    }
  });

  it('segunda amostra = 402 sample_used; novo lote do campeão = 402 locked', async () => {
    const second = await call('sample', 'POST', '/iterate', { uploadId: await upload('sample') });
    expect(second.status).toBe(402);
    expect(second.error).toMatchObject({ code: 'PAYMENT_REQUIRED', details: { reason: 'sample_used', unlock: { pieces: 0 } } });
    const fromChampion = await call('sample', 'POST', '/iterate', { championId });
    expect(fromChampion.status).toBe(402);
    expect(fromChampion.error.details.reason).toBe('locked');
  });

  it('zip, formato, retry, editor, download, Meta e arquivo = 402 locked', async () => {
    const n = pieces.length;
    const zip = await call('sample', 'POST', `/iterate/${batchId}/zip`, {});
    expect(zip.status).toBe(402);
    expect(zip.error).toMatchObject({ code: 'PAYMENT_REQUIRED', details: { reason: 'locked', unlock: { pieces: n } } });
    const ready = pieces.find((p) => p.status === 'ready')!;
    expect((await call('sample', 'POST', `/iterate/pieces/${ready.id}/formats`, { format: '4x5' })).status).toBe(402);
    expect((await call('sample', 'POST', `/iterate/pieces/${ready.id}/retry`, {})).status).toBe(402);
    expect((await call('sample', 'GET', `/creatives/${ready.creativeId}/editor`)).status).toBe(402);
    expect((await call('sample', 'GET', `/creatives/${ready.creativeId}/download`)).status).toBe(402);
    expect((await call('sample', 'GET', `/creatives/${ready.creativeId}`)).status).toBe(402);
    expect((await call('sample', 'POST', `/creatives/${ready.creativeId}/meta/publish`, {})).status).toBe(402);
    // QA 29/10 F1: o lote no Meta também trava (antes criava os anúncios das peças travadas)
    expect((await call('sample', 'POST', '/meta/publish-batch', { creativeIds: [ready.creativeId], templateId: 'qualquer' })).status).toBe(402);
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: ready.creativeId, status: 'READY', fileId: { not: null } } });
    expect((await call('sample', 'GET', `/files/${r.fileId}`)).status).toBe(402);
    const lib = await call('sample', 'GET', '/library');
    expect(lib.data.map((i: { id: string }) => i.id)).not.toContain(ready.creativeId);
  });

  it('antiabuso §6: outra conta com a mesma conta de anúncio herda sampleUsedAt (402); P4: agência SAMPLE = 402', async () => {
    const copy = await call('copycat', 'POST', '/iterate', { uploadId: await upload('copycat') });
    expect(copy.status).toBe(402);
    expect(copy.error.details.reason).toBe('sample_used');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users.copycat.id } })).sampleUsedAt).not.toBeNull();
    const agency = await call('agency', 'POST', '/iterate', { uploadId: await upload('agency') });
    expect(agency.status).toBe(402);
    expect(await prisma.variationBatch.count({ where: { workspaceId: { in: [users.copycat.wsId, users.agency.wsId] } } })).toBe(0);
  });

  it('admin: só INTERNAL OWNER libera; PAID = as mesmas peças destravadas, sem render novo', async () => {
    expect((await call('sample', 'PATCH', `/admin/users/${users.sample.id}/access`, { access: 'PAID' })).status).toBe(403);
    expect((await call('internal', 'PATCH', `/admin/users/${users.sample.id}/access`, { access: 'GOLD' })).status).toBe(400);
    const renders = await prisma.render.count({ where: { workspaceId: users.sample.wsId } });
    const ok = await call('internal', 'PATCH', `/admin/users/${users.sample.id}/access`, { access: 'PAID' });
    expect(ok.status).toBe(200);
    expect(ok.data).toEqual({ id: users.sample.id, access: 'PAID' });
    const b = await call('sample', 'GET', `/iterate/${batchId}`);
    expect(b.data.sample).toBe(true);
    for (const p of b.data.pieces) {
      expect(p.locked).toBe(false);
      expect(p.preview).toBeNull();
      if (p.status === 'ready') expect(p.files.length).toBeGreaterThan(0);
    }
    expect(await prisma.render.count({ where: { workspaceId: users.sample.wsId } })).toBe(renders);
    expect([200, 202]).toContain((await call('sample', 'POST', `/iterate/${batchId}/zip`, {})).status);
  });

  it('workspace INTERNAL nunca trava: lote normal (sem lançar sozinho) e nem um lote marcado como amostra trava', async () => {
    const cr = await call('internal', 'POST', '/iterate', { uploadId: await upload('internal') });
    expect(cr.status).toBe(202);
    expect(cr.data.sample).toBe(false);
    const b = await until(() => call('internal', 'GET', `/iterate/${cr.data.id}`), (r) => !!r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status));
    expect(b.data.status).toBe('PLAN_READY');
    await prisma.variationBatch.update({ where: { id: cr.data.id }, data: { settings: { quizEnabled: true, sample: true } } });
    const v = await call('internal', 'GET', `/iterate/${cr.data.id}`);
    for (const p of v.data.pieces) expect(p.locked).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users.internal.id } })).sampleUsedAt).toBeNull();
  });
});
