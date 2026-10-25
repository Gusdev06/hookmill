/**
 * Prova local (sem Lambda, nada pago) das decisões do Gusta de 25/10 com o campeão REAL do teste live (lote
 * cmvnlm4yd000l22emdoob1j5a, zh-TW, letterbox com headline e legenda queimadas): os FRAME do lote → frameSpecOf →
 * buildFrameInput (contentBox, burnedTextBands, cover sem borrado, rótulos zh) → still da composição `Moldura`.
 * Vídeo baixado do storage (STORAGE_*, hookmill-dev) e servido por HTTP local; Remotion na porta 3020 (nunca 3001).
 *
 * Uso (de api/): npx ts-node --transpile-only src/render/molduras-campeao-real.ts [saida-dir] [formato]
 */
import 'dotenv/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PrismaClient } from '@prisma/client';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { EditMap } from '@maquina/contratos';
import { frameSpecOf } from '../edicao/frame-input';
import type { AutoEditContext } from './auto-edit';
import { buildFrameInput } from './frame';

const LOTE = 'cmvnlm4yd000l22emdoob1j5a';
const PORTA_REMOTION = 3020;
const raizVideo = path.resolve(__dirname, '../../../video');

async function main() {
  const saida = path.resolve(process.argv[2] ?? path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'campeao-real'));
  const formato = (process.argv[3] ?? 'VERTICAL_9_16') as 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';
  mkdirSync(saida, { recursive: true });
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: LOTE }, include: { champion: { include: { videoFile: true, teardown: true } }, items: true } });
  const ch = b.champion!;
  const arquivo = path.join(saida, '_campeao.mp4');
  if (!existsSync(arquivo)) {
    const s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT, region: process.env.STORAGE_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! },
    });
    const o = await s3.send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET!, Key: ch.videoFile!.storageKey }));
    await pipeline(o.Body as Readable, createWriteStream(arquivo));
  }
  const servidor = http.createServer((req, res) => {
    const { size } = statSync(arquivo);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const a = Number(range[1]), z = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 });
      return void createReadStream(arquivo, { start: a, end: z }).pipe(res);
    }
    res.writeHead(200, { ...h, 'Content-Length': size });
    createReadStream(arquivo).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/campeao.mp4`;

  const editMap = ch.teardown!.editMap as unknown as EditMap;
  const ctx: AutoEditContext = {
    renderId: 'prova-campeao', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: b.language,
    source: { videoUrl: url, width: ch.videoFile!.width ?? 720, height: ch.videoFile!.height ?? 1280, fps: editMap.fps, durationSec: Number(ch.durationSec), hasAudio: true },
    editMap, words: [], silences: [], blocks: [], hookEndSec: null, palette: [], brandName: '', page: null,
  };
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  const feitos = new Set<string>();
  for (const it of b.items.filter((i) => (i.autoType as string) === 'FRAME')) {
    const params = (it.payload as { params: Record<string, unknown> }).params;
    const tpl = String(params.template);
    if (feitos.has(tpl)) continue;
    feitos.add(tpl);
    try {
      const input = buildFrameInput(frameSpecOf(params), ctx, formato);
      const { kind: _k, renderId: _r, templateId: _t, ...props } = input;
      const composition = await selectComposition({ serveUrl, id: 'Moldura', inputProps: props, port: PORTA_REMOTION });
      await renderStill({ composition, serveUrl, inputProps: props, frame: 90, output: path.join(saida, `${tpl}.png`), imageFormat: 'png', port: PORTA_REMOTION });
      console.log(`${tpl} ok`, JSON.stringify({ reframe: input.video.reframe, contentBox: input.video.contentBox, bands: input.video.burnedTextBands?.length }));
    } catch (e) {
      console.log(`${tpl} ERRO ${(e as Error).message}`);
    }
  }
  servidor.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
