// B4a de ponta a ponta contra a infra LOCAL (Postgres 5433 + S3 9000), integrações em mock (custo zero),
// medição de verdade (ffmpeg local). Upload proxy → complete → campeão → análise → teardown → edição → reanálise,
// link da Ad Library (fake com os gatilhos §4.6), falhas e isolamento entre workspaces. Pula se o banco não for localhost.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3198;
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
import { mockMediaUrl } from '../integracoes/mock/midia';
import { configureApp } from '../main';
import { AD_LIBRARY, type AdLibraryService } from './portas';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(180_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);

/** Fake da Ad Library com os gatilhos de mock do contrato (§4.6). */
class FakeAdLibrary implements AdLibraryService {
  available = true;
  async status() {
    return this.available ? { available: true, reason: null, retryAfter: null } : { available: false, reason: 'quota' as const, retryAfter: '2026-10-19' };
  }
  async resolve(i: { url: string }) {
    const err = (code: string, details?: object) => Object.assign(new Error(code), { code, details });
    if (i.url.includes('mock-ad-unavailable')) throw err('AD_LIBRARY_UNAVAILABLE', { reason: 'quota', retryAfter: '2026-10-19' });
    if (i.url.includes('mock-ad-notfound')) throw err('AD_NOT_FOUND');
    if (i.url.includes('mock-ad-novideo')) throw err('AD_HAS_NO_VIDEO');
    return {
      adArchiveId: new URL(i.url).searchParams.get('id'), pageName: 'Page', startDate: '2026-09-01', endDate: null, isActive: true, daysRunning: 35,
      collationCount: 3, euReach: null, primaryText: 'text', headline: 'head', ctaText: 'Learn more', linkUrl: 'https://x.test',
      videoUrl: mockMediaUrl(process.env.PUBLIC_API_URL!, { kind: 'video', seed: '00112233445566aa', format: 'VERTICAL_9_16', sec: 20 }), posterUrl: null, costUsd: 0,
    };
  }
}

describe(isLocal ? 'Campeões B4a (integração local)' : 'Campeões B4a [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const adlib = new FakeAdLibrary();
  const ws: Record<'A' | 'B', { id: string; userId: string; token: string }> = {} as never;
  let offerId: string;
  let dir: string;
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown, who: 'A' | 'B' = 'A') => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws[who].token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error, meta: j.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 90_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  const champ = (id: string) => call('GET', `/champions/${id}`);
  const settled = (id: string) => until(() => champ(id), (r) => ['READY', 'FAILED'].includes(r.data?.status));

  /** Vídeo sintético com fala simulada (seno) e duas metades de cor diferente (um "corte"). */
  async function makeVideo(name: string, sec: number, opts: { audio?: boolean; w?: number; h?: number } = {}) {
    const out = join(dir, name);
    const w = opts.w ?? 360, h = opts.h ?? 640;
    const args = ['-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=25:duration=${sec}`];
    if (opts.audio !== false) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`);
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast');
    if (opts.audio !== false) args.push('-c:a', 'aac', '-shortest');
    args.push(out);
    await run(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 60_000 });
    return out;
  }

  /** POST /uploads → PUT (proxy, com Bearer) → complete. */
  async function upload(path: string, who: 'A' | 'B' = 'A', mimeType = 'video/mp4') {
    const bytes = await readFile(path);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: path.split('/').pop(), mimeType, sizeBytes: bytes.length }, who);
    expect(c.status).toBe(201);
    expect(c.data.url).toBe(`${base}/uploads/${c.data.uploadId}/content`);
    const put = await fetch(c.data.url, { method: 'PUT', headers: { ...c.data.headers, authorization: `Bearer ${ws[who].token}` }, body: bytes });
    expect(put.status).toBe(200);
    return { id: c.data.uploadId as string, complete: await call('POST', `/uploads/${c.data.uploadId}/complete`, {}, who) };
  }

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    dir = await mkdtemp(join(tmpdir(), 'maquina-b4a-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AD_LIBRARY).useValue(adlib).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const hash = await hashPassword(PASSWORD);
    for (const k of ['A', 'B'] as const) {
      const email = `b4a-${RUN}-${k.toLowerCase()}@teste.local`;
      const user = await prisma.user.create({ data: { email, name: `B4a ${k}`, passwordHash: hash } });
      const w = await prisma.workspace.create({ data: { name: `b4a-${RUN}-${k}`, shortCode: 'TS', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      ws[k] = { id: w.id, userId: user.id, token: (await res.json()).data.accessToken };
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: ws.A.id, name: 'Oferta campeão', language: 'en', what: 'App', promise: 'Save time', createdById: ws.A.userId } })).id;
  });

  afterAll(async () => {
    // espera análises em voo (senão o cleanup apaga o campeão no meio do job)
    await until(() => prisma.champion.count({ where: { workspaceId: { in: [ws.A?.id, ws.B?.id].filter(Boolean) as string[] }, status: { in: ['RESOLVING', 'ANALYZING'] } } }), (n) => n === 0, 60_000);
    const ids = [ws.A?.id, ws.B?.id].filter(Boolean) as string[];
    if (ids.length) {
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.upload.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `b4a-${RUN}-` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('config: limites, Ad Library e tipos no build', async () => {
    const r = await call('GET', '/champions/config');
    expect(r.data).toMatchObject({ maxBytes: 524288000, minSec: 4, maxSec: 180, mimeTypes: ['video/mp4', 'video/quicktime'], adLibrary: { available: true } });
    expect(r.data.analysisUsdPerSec).toBeGreaterThan(0);
    expect(r.data.kinds).toEqual([
      { kind: 'SWAP_AVATAR', enabled: true }, { kind: 'NEW_HOOKS', enabled: true }, { kind: 'COPY_NEW', enabled: false }, { kind: 'REMIX_EDIT', enabled: false },
    ]);
  });

  it('upload: mime e tamanho recusados no POST', async () => {
    const mime = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'x.png', mimeType: 'image/png', sizeBytes: 10 });
    expect(mime.status).toBe(422);
    expect(mime.error).toMatchObject({ code: 'MEDIA_INVALID', details: { reason: 'mime' } });
    const big = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'x.mp4', mimeType: 'video/mp4', sizeBytes: 524288001 });
    expect(big.error).toMatchObject({ code: 'MEDIA_TOO_LARGE', details: { maxBytes: 524288000 } });
  });

  it('upload: complete sem objeto = 409 UPLOAD_INCOMPLETE; PUT acima do declarado = 413; outro workspace = 404', async () => {
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 100 });
    const inc = await call('POST', `/uploads/${c.data.uploadId}/complete`, {});
    expect(inc.status).toBe(409);
    expect(inc.error).toMatchObject({ code: 'UPLOAD_INCOMPLETE', details: { expectedBytes: 100, actualBytes: null } });
    const tooBig = await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${ws.A.token}` }, body: Buffer.alloc(200) });
    expect(tooBig.status).toBe(413);
    const other = await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${ws.B.token}` }, body: Buffer.alloc(100) });
    expect(other.status).toBe(404);
    const noAuth = await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.alloc(100) });
    expect(noAuth.status).toBe(401);
    expect((await call('POST', `/uploads/${c.data.uploadId}/complete`, {}, 'B')).status).toBe(404);
  });

  it('upload: curto demais = 422 MEDIA_TOO_SHORT, e o complete repetido devolve o mesmo 422', async () => {
    const { id, complete } = await upload(await makeVideo('short.mp4', 3));
    expect(complete.status).toBe(422);
    expect(complete.error.code).toBe('MEDIA_TOO_SHORT');
    expect(complete.error.details.minSec).toBe(4);
    const again = await call('POST', `/uploads/${id}/complete`, {});
    expect(again.error).toEqual(complete.error);
  });

  it('upload: expirado = 410 UPLOAD_EXPIRED (cron marca EXPIRED)', async () => {
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'old.mp4', mimeType: 'video/mp4', sizeBytes: 10 });
    await prisma.upload.update({ where: { id: c.data.uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call('POST', `/uploads/${c.data.uploadId}/complete`, {})).error.code).toBe('UPLOAD_EXPIRED');
  });

  let championId: string;

  it('upload → campeão → análise completa (ANALYZING → READY) com teardown de 12 seções e frames-chave', async () => {
    const { id, complete } = await upload(await makeVideo('champ.mp4', 8));
    expect(complete.status).toBe(200);
    expect(complete.data).toMatchObject({ uploadId: id, status: 'READY', warnings: ['low_resolution'] });
    expect(complete.data.file.durationSec).toBeGreaterThan(7);
    expect(complete.data.analysisEstimateUsd).toBeGreaterThan(0);
    // complete idempotente: mesmo file
    expect((await call('POST', `/uploads/${id}/complete`, {})).data.file.id).toBe(complete.data.file.id);

    const cr = await call('POST', '/champions', { offerId, uploadId: id, rights: 'THIRD_PARTY' });
    expect(cr.status).toBe(202);
    expect(cr.data).toMatchObject({ status: 'ANALYZING', rights: 'THIRD_PARTY', sources: ['UPLOAD'], name: 'champ' });
    expect(cr.data.job.type).toBe('CHAMPION_ANALYZE');
    expect(cr.data.job.checklist.map((c: any) => c.key)).toEqual(['reading_video', 'extracting_audio', 'transcribing', 'measuring', 'mapping_edit', 'diagnosing']);
    championId = cr.data.id;
    expect((await call('GET', `/champions/${championId}`, undefined, 'B')).status).toBe(404);

    const done = await settled(championId);
    expect(done.data.status).toBe('READY');
    const t = done.data.teardown;
    expect(Object.keys(t.sections).sort()).toEqual(
      ['audio', 'hook', 'identification', 'layout', 'metaCopy', 'offerProofCta', 'replicationPlan', 'stealVsVary', 'structure', 'transcript', 'visual', 'whySells'],
    );
    expect(t.measurements.durationSec).toBeGreaterThan(7);
    expect(t.measurements.keyframes[0]).toMatchObject({ atSec: 0, reason: 't0' });
    expect(t.measurements.keyframes[0].image.url).toContain('X-Amz-Signature');
    expect(t.editedSections).toEqual([]);
    expect(done.data.thumbnail).not.toBeNull();
    expect(done.data.job.status).toBe('SUCCEEDED');
    expect(done.data.availableKinds.find((k: any) => k.kind === 'COPY_NEW')).toEqual({ kind: 'COPY_NEW', available: false, reason: 'NOT_ENABLED' });
    const swap = done.data.availableKinds.find((k: any) => k.kind === 'SWAP_AVATAR');
    expect(swap).toEqual(t.transcript.words.length >= 5 ? { kind: 'SWAP_AVATAR', available: true, reason: null } : { kind: 'SWAP_AVATAR', available: false, reason: 'NO_SPEECH' });

    const list = await call('GET', `/champions?offerId=${offerId}`);
    expect(list.data.some((r: any) => r.id === championId)).toBe(true);
    expect((await call('GET', '/champions', undefined, 'B')).data).toEqual([]);
  });

  it('teardown: editar seção e palavra; reanalisar exige confirm e reaproveita a transcrição corrigida', async () => {
    const before = (await champ(championId)).data.teardown;
    const hook = { ...before.sections.hook, data: { ...(before.sections.hook.data ?? { endSec: 3, visual: '', onScreenText: null }), spoken: 'edited hook' }, status: 'ok' };
    const p = await call('PATCH', `/champions/${championId}/teardown`, { sections: { hook } });
    expect(p.status).toBe(200);
    expect(p.data.editedSections).toEqual(['hook']);
    expect(p.data.sections.hook.data.spoken).toBe('edited hook');
    expect((await call('PATCH', `/champions/${championId}/teardown`, { sections: { nope: hook } })).status).toBe(400);
    expect((await call('PATCH', `/champions/${championId}/teardown`, { sections: { hook: { status: 'na' } } })).status).toBe(400);
    if (before.transcript.words.length) {
      const w = await call('PATCH', `/champions/${championId}/teardown`, { transcriptWords: [{ index: 0, word: 'Fixed' }] });
      expect(w.data.transcript.words[0]).toMatchObject({ word: 'Fixed', startSec: before.transcript.words[0].startSec });
    }

    const noConfirm = await call('POST', `/champions/${championId}/analyze`, {});
    expect(noConfirm.status).toBe(409);
    expect(noConfirm.error).toMatchObject({ code: 'CONFIRM_DOWNSTREAM_RESET', details: { editedSections: ['hook'] } });
    const ok = await call('POST', `/champions/${championId}/analyze`, { confirm: true });
    expect(ok.status).toBe(202);
    expect(ok.data.job.type).toBe('CHAMPION_ANALYZE');
    expect((await call('POST', `/champions/${championId}/analyze`, { confirm: true })).error.code).toBe('INVALID_STATE');
    expect((await call('PATCH', `/champions/${championId}/teardown`, { sections: { hook } })).error.code).toBe('INVALID_STATE');
    const after = await settled(championId);
    expect(after.data.status).toBe('READY');
    expect(after.data.teardown.editedSections).toEqual([]);
    if (before.transcript.words.length) expect(after.data.teardown.transcript.words[0].word).toBe('Fixed');
  });

  it('PATCH campeão: nome, notas e declaração de dono (só registro)', async () => {
    const r = await call('PATCH', `/champions/${championId}`, { name: 'Renamed', rights: 'OWN', notes: 'n' });
    expect(r.data).toMatchObject({ name: 'Renamed', rights: 'OWN', notes: 'n' });
    const row = await prisma.champion.findUniqueOrThrow({ where: { id: championId } });
    expect(row.rightsDeclaredById).toBe(ws.A.userId);
  });

  it('análise com [mock:analysis-fail] → FAILED PROVIDER_ERROR, action analyze_again, transcrição e medição ficam', async () => {
    const { id } = await upload(await makeVideo('fail.mp4', 6));
    const cr = await call('POST', '/champions', { offerId, uploadId: id, rights: 'OWN', notes: 'x [mock:analysis-fail]' });
    const r = await settled(cr.data.id);
    expect(r.data).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', action: 'analyze_again' });
    expect(r.data.job).toMatchObject({ status: 'FAILED', action: 'analyze_again' });
    const t = await prisma.teardown.findUniqueOrThrow({ where: { championId: cr.data.id } });
    expect((t.measurements as any).durationSec).toBeGreaterThan(5);
    expect((t.transcript as any).words).toBeDefined();
  });

  it('vídeo sem trilha de áudio: análise segue sem transcrição e sem fala', async () => {
    const { id, complete } = await upload(await makeVideo('mute.mp4', 6, { audio: false }));
    expect(complete.data.warnings).toContain('no_audio');
    const cr = await call('POST', '/champions', { offerId, uploadId: id, rights: 'THIRD_PARTY' });
    const r = await settled(cr.data.id);
    expect(r.data.status).toBe('READY');
    expect(r.data.teardown.transcript.words).toEqual([]);
    expect(r.data.availableKinds.find((k: any) => k.kind === 'NEW_HOOKS')).toEqual({ kind: 'NEW_HOOKS', available: false, reason: 'NO_SPEECH' });
  });

  it('link: inválido = 400; indisponível = 503 síncrono sem criar nada; sem campo = 400', async () => {
    const bad = await call('POST', '/champions', { offerId, adLibraryUrl: 'https://www.facebook.com/ads/library/?q=x', rights: 'THIRD_PARTY' });
    expect(bad.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: [{ field: 'adLibraryUrl', rule: 'ad_library_single_ad' }] } });
    expect((await call('POST', '/champions', { offerId, rights: 'THIRD_PARTY' })).status).toBe(400);
    const before = await prisma.champion.count({ where: { workspaceId: ws.A.id } });
    const un = await call('POST', '/champions', { offerId, adLibraryUrl: 'https://www.facebook.com/ads/library/?id=123&mock-ad-unavailable', rights: 'THIRD_PARTY' });
    expect(un.status).toBe(503);
    expect(un.error).toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota', retryAfter: '2026-10-19' } });
    adlib.available = false;
    const quota = await call('POST', '/champions', { offerId, adLibraryUrl: 'https://www.facebook.com/ads/library/?id=124', rights: 'THIRD_PARTY' });
    adlib.available = true;
    expect(quota.error).toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota' } });
    expect(await prisma.champion.count({ where: { workspaceId: ws.A.id } })).toBe(before);
  });

  it('link: não encontrado → FAILED AD_NOT_FOUND (upload_video) → PUT video → ANALYZING → READY', async () => {
    const cr = await call('POST', '/champions', { offerId, adLibraryUrl: 'https://www.facebook.com/ads/library/?id=555&mock-ad-notfound', rights: 'THIRD_PARTY' });
    expect(cr.status).toBe(202);
    const f = await settled(cr.data.id);
    expect(f.data).toMatchObject({ status: 'FAILED', errorCode: 'AD_NOT_FOUND', action: 'upload_video', sources: ['AD_LIBRARY'] });
    expect(f.data.adMeta.status).toBe('not_found');
    expect((await call('POST', `/champions/${cr.data.id}/analyze`, {})).error.code).toBe('INVALID_STATE');
    const { id } = await upload(await makeVideo('attach.mp4', 6));
    const at = await call('PUT', `/champions/${cr.data.id}/video`, { uploadId: id });
    expect(at.status).toBe(202);
    expect(at.data.status).toBe('ANALYZING');
    expect((await call('PUT', `/champions/${cr.data.id}/video`, { uploadId: id })).error.code).toBe('INVALID_STATE');
    expect((await settled(cr.data.id)).data.status).toBe('READY');
  });

  it('link: resolve → baixa o vídeo → análise (RESOLVING → ANALYZING → READY) com metadados', async () => {
    const cr = await call('POST', '/champions', { offerId, adLibraryUrl: 'https://www.facebook.com/ads/library/?id=777', rights: 'THIRD_PARTY' });
    // o fake resolve rápido: a resposta pode já sair em ANALYZING (o POST espera até 1,5 s por recusa síncrona)
    expect(['RESOLVING', 'ANALYZING']).toContain(cr.data.status);
    const rj = await prisma.job.findFirstOrThrow({ where: { championId: cr.data.id, type: 'CHAMPION_RESOLVE' } });
    expect(rj.status).not.toBe('FAILED');
    const r = await settled(cr.data.id);
    expect(r.data.status).toBe('READY');
    expect(r.data.adMeta).toMatchObject({ status: 'resolved', adArchiveId: '777', pageName: 'Page' });
    expect(r.data.sources).toEqual(['AD_LIBRARY']);
    expect(r.data.video.durationSec).toBeGreaterThan(19);
  });

  it('DELETE arquiva: 404 em tudo e some da lista', async () => {
    expect((await call('DELETE', `/champions/${championId}`)).data).toEqual({ ok: true });
    expect((await champ(championId)).status).toBe(404);
    expect((await call('PATCH', `/champions/${championId}`, { name: 'x' })).status).toBe(404);
    expect((await call('GET', '/champions')).data.some((r: any) => r.id === championId)).toBe(false);
  });
});
