// leitura-lambda-v1 §6: análise do campeão com ANALYZE_IMPL=lambda e a Lambda MOCKADA (o invocador chama o handler da
// função dentro do processo: mesmo evento, GET/PUT pré-assinados de verdade no MinIO local, mesmo JSON de volta).
// Compara com a mesma análise caindo no local (throttling → fallback): medições e editMap iguais. Integrações em mock.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.META_CRON = 'off';
process.env.ANALYZE_IMPL = 'lambda';
process.env.ANALYZE_LAMBDA_FALLBACK = 'on'; // 02/11: o padrão virou off; este spec compara a Lambda com o fallback local
process.env.REMOTION_AWS_ACCESS_KEY_ID = '';
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = '';
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { StorageService } from '../arquivos/storage.service';
import { hashPassword } from '../common/util/crypto';
import { configureApp } from '../main';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { ErroInvocacao, LEITURA_MIDIA, criarLeitura, leituraConfig, type EventoLeitura, type InvocadorLambda } from '../medicao/leitura';
import { handler } from '../medicao/leitura/handler';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(240_000);
const RUN = Date.now().toString(36);
const run = promisify(execFile);

/** Lambda falsa: 'handler' roda a função de verdade no processo; 'throttle' recusa como a AWS sem cota. */
class LambdaFalsa implements InvocadorLambda {
  modo: 'handler' | 'throttle' = 'handler';
  eventos: EventoLeitura[] = [];
  async invocar(e: EventoLeitura) {
    this.eventos.push(e);
    if (this.modo === 'throttle') throw new ErroInvocacao('throttle', 'TooManyRequestsException: Rate exceeded');
    // a resposta passa por JSON como na AWS (nada de objeto compartilhado)
    return JSON.parse(JSON.stringify(await handler(JSON.parse(JSON.stringify(e)))));
  }
}

describe(isLocal ? 'Leitura na Lambda (mock da função)' : 'Leitura na Lambda [pulado: banco não é local]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const lambda = new LambdaFalsa();
  const ws = { id: '', userId: '', token: '' };
  let offerId = '';
  let dir = '';
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws.token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const settled = async (id: string) => {
    const end = Date.now() + 180_000;
    for (;;) {
      const r = await call('GET', `/champions/${id}`);
      if (['READY', 'FAILED'].includes(r.data?.status) || Date.now() > end) return r;
      await new Promise((ok) => setTimeout(ok, 500));
    }
  };

  async function campeao(nome: string, video: string) {
    const bytes = await readFile(video);
    const c = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: nome, mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { ...c.data.headers, authorization: `Bearer ${ws.token}` }, body: bytes });
    expect((await call('POST', `/uploads/${c.data.uploadId}/complete`, {})).status).toBe(200);
    const cr = await call('POST', '/champions', { offerId, uploadId: c.data.uploadId, rights: 'OWN' });
    expect(cr.status).toBe(202);
    return settled(cr.data.id);
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-leitura-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LEITURA_MIDIA)
      .useFactory({
        inject: [StorageService, MEDIA_ANALYSIS_SERVICE],
        factory: (storage: StorageService, media: MediaAnalysisService) => criarLeitura(leituraConfig((k) => process.env[k]), {
          storage: { downloadTo: (f, p) => storage.downloadTo(f, p), signedUrl: (f) => storage.signedUrl(f), newKey: (w, k, m) => storage.newKey(w, k, m), presignPut: (k, o) => storage.presignPut(k, o) },
          media, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', log: new Logger('Leitura'), invocador: lambda,
        }),
      })
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const email = `leitura-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'Leitura', passwordHash: await hashPassword('senha-teste-1234') } });
    const w = await prisma.workspace.create({ data: { name: `leitura-${RUN}`, shortCode: 'LT', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'senha-teste-1234' }) });
    Object.assign(ws, { id: w.id, userId: user.id, token: (await res.json()).data.accessToken });
    offerId = (await prisma.offer.create({ data: { workspaceId: w.id, name: 'Oferta', language: 'en', what: 'App', promise: 'Save time', createdById: user.id } })).id;
  });

  afterAll(async () => {
    if (ws.id) {
      await prisma.champion.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.upload.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.job.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.offer.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.deleteMany({ where: { id: ws.id } });
      await prisma.user.deleteMany({ where: { email: `leitura-${RUN}@teste.local` } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('Lambda (handler) e local (fallback por throttling) dão as mesmas medições e o mesmo editMap', async () => {
    // 2 metades de cor diferente (1 corte) + faixa de texto chapada embaixo + áudio com pausa
    const video = join(dir, 'champ.mp4');
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=4', '-f', 'lavfi', '-i', 'smptebars=size=360x640:rate=25:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v0];[v0]drawbox=y=520:h=60:w=iw:color=red@1:t=fill[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-t', '8', video], { timeout: 60_000 });

    lambda.modo = 'handler';
    const L = await campeao('lambda.mp4', video);
    expect(L.data.status).toBe('READY');
    expect(lambda.eventos.map((e) => e.op)).toEqual(['ler', 'medir', 'refinar']);

    lambda.eventos = [];
    lambda.modo = 'throttle';
    const R = await campeao('local.mp4', video);
    expect(R.data.status).toBe('READY');
    expect(lambda.eventos.map((e) => e.op)).toEqual(['ler']); // 1 recusa e o resto da sessão no local

    const [tL, tR] = await Promise.all([L, R].map((x) => prisma.teardown.findUniqueOrThrow({ where: { championId: x.data.id } })));
    const semArquivo = (m: any) => ({ ...m, keyframes: m.keyframes.map(({ fileId: _f, ...k }: any) => k) });
    expect(semArquivo(tL.measurements)).toEqual(semArquivo(tR.measurements));
    expect((tL.measurements as any).keyframes.length).toBeGreaterThan(1);
    expect(tL.editMap).not.toBeNull();
    expect(tL.editMap).toEqual(tR.editMap);

    // os frames e o áudio que a função subiu por PUT pré-assinado viraram linhas em files e estão no storage
    const cL = await prisma.champion.findUniqueOrThrow({ where: { id: L.data.id }, include: { audioFile: true } });
    expect(cL.audioFile).toMatchObject({ kind: 'CHAMPION_AUDIO', mimeType: 'audio/mp4' });
    expect(Number(cL.audioFile!.sizeBytes)).toBeGreaterThan(1000);
    const kf = (tL.measurements as any).keyframes[0];
    const f = await prisma.file.findUniqueOrThrow({ where: { id: kf.fileId } });
    const got = await fetch(await app.get(StorageService).signedUrl(f));
    expect(got.status).toBe(200);
    expect(Number(got.headers.get('content-length'))).toBe(Number(f.sizeBytes));
  });
});
