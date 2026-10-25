// Integração de verdade contra a infra LOCAL (npm run infra:up): Postgres 5433 + S3 9000.
// Sobe a API inteira (INTEGRACOES_MODE=mock), cria 2 workspaces descartáveis e apaga no fim.
// Pula sozinho se o DATABASE_URL não for localhost ou se o banco não responder.
import 'dotenv/config';
// Antes de importar o AppModule: o modo das integrações é lido na carga do módulo (o .env de dev pode estar em live).
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off'; // não retomar trabalho de outro processo de teste no mesmo banco
import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { IngestError, StorageService } from './arquivos/storage.service';
import { hashPassword } from './common/util/crypto';
import { EventosService } from './eventos/eventos.service';
import { mockMediaUrl } from './integracoes/mock/midia';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(60_000);

const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';

describe(isLocal ? 'API (integração local)' : 'API (integração local) [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const ws: Record<'A' | 'B', { id: string; userId: string; token: string }> = {} as never;
  let creativeA: string;
  let jobA: string;

  const call = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    // jest.setup-env força o maquina_test (nunca o maquina do dev/API LIVE); prova com o banco de verdade
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    console.log(`[app.int] banco: ${db} · bucket: ${process.env.STORAGE_BUCKET}`);
    expect(db).toBe('maquina_test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import("node:net").AddressInfo).port}`;

    const hash = await hashPassword(PASSWORD);
    for (const k of ['A', 'B'] as const) {
      const email = `int-${RUN}-${k.toLowerCase()}@teste.local`;
      const user = await prisma.user.create({ data: { email, name: `Int ${k}`, passwordHash: hash } });
      const w = await prisma.workspace.create({
        data: { name: `int-${RUN}-${k}`, shortCode: 'TS', memberships: { create: { userId: user.id, role: 'OWNER' } } },
      });
      const res = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
      expect(res.status).toBe(200);
      ws[k] = { id: w.id, userId: user.id, token: (await res.json()).data.accessToken };
    }
    const offer = await prisma.offer.create({
      data: { workspaceId: ws.A.id, name: 'Oferta A', language: 'en', what: 'x', promise: 'y', createdById: ws.A.userId },
    });
    creativeA = (
      await prisma.creative.create({
        data: { workspaceId: ws.A.id, offerId: offer.id, name: 'Oferta A · 1', language: 'en', createdById: ws.A.userId },
      })
    ).id;
    jobA = (
      await prisma.job.create({
        data: { workspaceId: ws.A.id, type: 'OFFER_EXTRACT', input: { url: 'https://x' }, stage: 'extracting', status: 'RUNNING', createdById: ws.A.userId },
      })
    ).id;
  });

  afterAll(async () => {
    if (ws.A || ws.B) {
      const ids = [ws.A?.id, ws.B?.id].filter(Boolean) as string[];
      const files = await prisma.file.findMany({ where: { workspaceId: { in: ids } } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `int-${RUN}-` } } });
      expect(await prisma.file.count({ where: { id: { in: files.map((f) => f.id) } } })).toBe(0);
    }
    await app?.close();
    await prisma.$disconnect();
  });

  it('health: banco e storage ok', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ ok: true, db: true, storage: true });
  });

  it('isolamento: o workspace B não enxerga job, criativo (SSE) nem arquivo do A — sempre 404', async () => {
    expect((await call('GET', `/jobs/${jobA}`, ws.A.token)).status).toBe(200);
    const jb = await call('GET', `/jobs/${jobA}`, ws.B.token);
    expect(jb.status).toBe(404);
    expect((await jb.json()).error.code).toBe('NOT_FOUND');
    expect((await call('GET', `/creatives/${creativeA}/events`, ws.B.token)).status).toBe(404);

    const file = await app.get(StorageService).put(Buffer.from('oi'), { workspaceId: ws.A.id, kind: 'THUMBNAIL', mimeType: 'image/png' });
    expect((await call('GET', `/files/${file.id}`, ws.B.token)).status).toBe(404);
    expect((await call('GET', `/files/${file.id}`, ws.A.token)).status).toBe(302);
  });

  it('job: checklist derivado da etapa', async () => {
    const body = (await (await call('GET', `/jobs/${jobA}`, ws.A.token)).json()).data;
    // briefing-leitura-v2 §4.3: 6 etapas; na etapa `extracting` as 4 de leitura aparecem feitas
    expect(body.checklist).toEqual([
      { key: 'fetching_page', done: true },
      { key: 'rendering_page', done: true },
      { key: 'reading_subpages', done: true },
      { key: 'reading_images', done: true },
      { key: 'extracting', done: false },
      { key: 'detecting_language', done: false },
    ]);
    expect(body.action).toBeNull();
  });

  it('membro removido perde acesso na hora, mesmo com access token válido', async () => {
    const email = `int-${RUN}-c@teste.local`;
    const u = await prisma.user.create({ data: { email, name: 'C', passwordHash: await hashPassword(PASSWORD) } });
    await prisma.membership.create({ data: { workspaceId: ws.A.id, userId: u.id, role: 'MEMBER' } });
    const tok = (await (await call('POST', '/auth/login', undefined, { email, password: PASSWORD })).json()).data.accessToken;
    expect((await call('GET', '/workspace', tok)).status).toBe(200);
    expect((await call('DELETE', `/workspace/members/${u.id}`, ws.A.token)).status).toBe(200);
    expect((await call('GET', '/workspace', tok)).status).toBe(401);
  });

  it('SSE: headers, snapshot, delta e fecha sozinho em APPROVED', async () => {
    const res = await call('GET', `/creatives/${creativeA}/events`, ws.A.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil('event: snapshot');
    const eventos = app.get(EventosService);
    eventos.publish(creativeA, 'cost.updated', { costUsd: 0.12 });
    eventos.publish(creativeA, 'creative.updated', { id: creativeA, state: 'APPROVED' });
    await readUntil('APPROVED');
    const { done } = await reader.read(); // servidor encerrou o stream
    expect(done).toBe(true);
    expect(text).toContain('event: cost.updated\ndata: {"costUsd":0.12}');
    expect(eventos.listenerCount(creativeA)).toBe(0);
  });

  it('storage: ingestFromUrl baixa da mock-media, valida o arquivo inteiro, sobe e a URL pré-assinada devolve os mesmos bytes', async () => {
    const storage = app.get(StorageService);
    const url = mockMediaUrl(base, { kind: 'video', seed: '0123456789abcdef', format: 'SQUARE_1_1', sec: 2 });
    const file = await storage.ingestFromUrl(url, { workspaceId: ws.A.id, kind: 'SCENE_CLIP', validate: 'video' });
    expect(file).toMatchObject({ mimeType: 'video/mp4', sourceUrl: url });
    expect(file.storageKey).toMatch(new RegExp(`^ws/${ws.A.id}/scene_clip/.+\\.mp4$`));
    expect(Number(file.durationSec)).toBeGreaterThan(1);

    const signed = await storage.signedUrl(file.id);
    expect(signed).toContain('X-Amz-Expires=21600');
    const bytes = Buffer.from(await (await fetch(signed)).arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);

    const redirect = await call('GET', `/files/${file.id}`, ws.A.token);
    expect(redirect.status).toBe(302);
    expect((await fetch(redirect.headers.get('location')!)).status).toBe(200);
  });

  it('storage: URL que não serve mídia válida falha após 3 tentativas com DOWNLOAD_INVALID', async () => {
    const storage = app.get(StorageService);
    storage.retryDelayMs = 0;
    const before = await prisma.file.count({ where: { workspaceId: ws.A.id } });
    const err = await storage
      .ingestFromUrl(`${base}/api/v1/health`, { workspaceId: ws.A.id, kind: 'SCENE_CLIP', validate: 'video' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err).toMatchObject({ code: 'DOWNLOAD_INVALID', attempts: 3 });
    expect(await prisma.file.count({ where: { workspaceId: ws.A.id } })).toBe(before);
  });
});
