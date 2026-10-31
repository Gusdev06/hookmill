// estatico-montado-e-molduras-v1 B1-V: 1 moldura renderizada DE VERDADE pela fila da edicao (integrações em mock, Remotion
// real, banco e storage locais). Caminho completo: peça FRAME → frameSpecOf → buildFrameInput (FRAME_BUILDER) → RenderInput
// `kind 'frame'` → RemotionRenderService (composição `Moldura`) → MP4 no storage. Mídia = take de teste local; nada pago.
// Lento (~1 min): só roda com FRAME_REAL=1 (fora da suíte do QA).
//   FRAME_REAL=1 npx jest src/edicao/frame-real.int.spec.ts   (antes: npm run build -w video, pro dist/bundle)
import 'dotenv/config';
import path from 'node:path';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'remotion';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.REMOTION_BUNDLE_DIR = path.resolve(__dirname, '../../../video/dist/bundle');
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AutoVariationType } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { StorageService } from '../arquivos/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { configureApp } from '../main';
import { PrismaService } from '../prisma/prisma.service';
import { PecasAutoService } from './pecas.service';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const ATIVO = isLocal && process.env.FRAME_REAL === '1';
jest.setTimeout(900_000);
const RUN = Date.now().toString(36);
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const RAIZ = path.resolve(__dirname, '../../..');
const TAKE = join(RAIZ, 'video/public/fixtures/real-take.mp4');
const SAIDA = join(RAIZ, 'video/out/molduras-producao-2026-10-25/api');
const DUR = 8;

const brand = { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' };
const params = {
  type: 'FRAME', template: 'question_box', texts: { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' },
  sources: {}, screenLanguage: 'pt', brand, faceAtSec: 2, second: null, suggestedPrimaryText: null,
};

describe(ATIVO ? 'moldura real pela edicao (Remotion)' : 'moldura real pela edicao [pulado: FRAME_REAL=1 e banco local]', () => {
  if (!ATIVO) {
    it.skip('precisa de FRAME_REAL=1 e banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let wsId = '';
  let userId = '';
  let dir = '';
  let batchId = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-frame-real-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error', 'warn'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email: `frame-real-${RUN}@teste.local`, name: 'Frame', passwordHash: 'x' } });
    userId = user.id;
    const w = await prisma.workspace.create({ data: { name: `frame-real-${RUN}`, shortCode: 'FR', memberships: { create: { userId, role: 'OWNER' } } } });
    wsId = w.id;
    const offer = await prisma.offer.create({ data: { workspaceId: wsId, name: brand.name, language: 'pt', what: 'App', promise: 'Coluna leve', cta: 'Baixe', createdById: userId } });
    // campeão = 8 s do take quadrado de teste (960x960, 24 fps, com fala)
    const champ = join(dir, 'champ.mp4');
    await run(FFMPEG, ['-hide_banner', '-y', '-i', TAKE, '-t', String(DUR), '-c', 'copy', champ], { timeout: 60_000 });
    const video = await app.get(StorageService).put(champ, { workspaceId: wsId, kind: 'CHAMPION_VIDEO', mimeType: 'video/mp4', meta: { durationSec: DUR, width: 960, height: 960 } });
    const championId = (await prisma.champion.create({
      data: { workspaceId: wsId, offerId: offer.id, name: 'Champ frame', status: 'READY', rights: 'OWN', videoFileId: video.id, durationSec: DUR, hasSpeech: true, language: 'pt', createdById: userId },
    })).id;
    const editMap = {
      version: 1, width: 960, height: 960, fps: 24, frameCount: DUR * 24, layers: [], overlaysOverFace: [], cells: [], profile: null,
      faceTrack: [{ startFrame: 0, endFrame: DUR * 24, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
    };
    await prisma.teardown.create({ data: { workspaceId: wsId, championId, editMap, measurements: { palette: ['#202020'] }, sections: {} } });
    const b = await prisma.variationBatch.create({
      data: {
        workspaceId: wsId, championId, offerId: offer.id, status: 'PLAN_READY', mode: 'AUTO', language: 'pt', requests: [], createdById: userId,
        items: { create: [{ workspaceId: wsId, kind: 'AUTO_EDIT', index: 0, status: 'READY', autoType: 'FRAME' as AutoVariationType, code: 'FRAME-QUESTION-BOX', axis: 'DIVERSITY', change: 'moldura', rationale: 'r', inZip: true, payload: { params } }] },
      },
    });
    batchId = b.id;
  });

  afterAll(async () => {
    if (wsId) {
      await app.get(JobsService).idle();
      await prisma.creative.updateMany({ where: { workspaceId: wsId }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: wsId } });
      await prisma.render.deleteMany({ where: { workspaceId: wsId } });
      await prisma.creative.deleteMany({ where: { workspaceId: wsId } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: wsId } });
      await prisma.teardown.deleteMany({ where: { workspaceId: wsId } });
      await prisma.champion.deleteMany({ where: { workspaceId: wsId } });
      await prisma.job.deleteMany({ where: { workspaceId: wsId } });
      await prisma.offer.deleteMany({ where: { workspaceId: wsId } });
      await prisma.workspace.deleteMany({ where: { id: wsId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('peça FRAME (Caixinha, 9:16) sai da fila como MP4 H.264 1080x1920 30 fps com o áudio do campeão', async () => {
    const svc = app.get(PecasAutoService);
    const launched = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt: new Date() } });
      return svc.createPieces(tx, { batchId, userId, launchedAt: new Date() });
    });
    const t0 = Date.now();
    svc.launched(launched);
    let r = await prisma.render.findFirst({ where: { workspaceId: wsId } });
    while (!r || !['READY', 'FAILED'].includes(r.status)) {
      if (Date.now() - t0 > 600_000) throw new Error('render não terminou em 10 min');
      await new Promise((ok) => setTimeout(ok, 1000));
      r = await prisma.render.findFirst({ where: { workspaceId: wsId } });
    }
    const seg = (Date.now() - t0) / 1000;
    expect({ status: r.status, errorCode: r.errorCode, failReason: r.failReason }).toEqual({ status: 'READY', errorCode: null, failReason: null });
    expect(r.input).toMatchObject({ kind: 'frame', templateId: 'frame', format: 'VERTICAL_9_16', frame: { id: 'question_box', brand }, face: { kind: 'face_crop', atSec: 2 } });

    const file = await prisma.file.findUniqueOrThrow({ where: { id: r.fileId! } });
    const url = await app.get(StorageService).signedUrl(file);
    const mp4 = Buffer.from(await (await fetch(url)).arrayBuffer());
    mkdirSync(SAIDA, { recursive: true });
    const saida = join(SAIDA, 'frame-question_box-9x16.mp4');
    writeFileSync(saida, mp4);
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames', '-show_entries', 'format=duration', '-of', 'json', saida]);
    const info = JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate: string; nb_frames?: string }[]; format: { duration: string } };
    const v = info.streams.find((s) => s.codec_type === 'video')!;
    expect(v).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1', nb_frames: String(DUR * 30) });
    expect(info.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac')).toBe(true);
    expect(Number(info.format.duration)).toBeCloseTo(DUR, 0);
    // folha de frames (1 por segundo) pra conferir a olho
    await run(FFMPEG, ['-v', 'error', '-y', '-i', saida, '-vf', 'fps=1,scale=270:-1,tile=8x1', '-frames:v', '1', join(SAIDA, 'frame-question_box-9x16-folha.png')]);
    writeFileSync(join(SAIDA, 'frame-question_box-9x16.json'), JSON.stringify({ segundos: seg, bytes: mp4.length, ffprobe: info, input: r.input }, null, 2));
  });
});
