/**
 * Prova (26/10) do AutoEdit sem borrado: CUT/NATIVE_SEARCH/REVIEW com o reframeNaCaixa (cover no rosto, contentBox,
 * legenda protegida), no take quadrado de fixture e no campeão Amnayalife (lote cmvot8qxv000b22xlz0yrm60t, letterbox +
 * legenda queimada). Remotion na porta 3020. Pré: o campeão em video/out/molduras-producao-2026-10-25/lote2-faixas/.
 * Uso (de api/): npx ts-node --transpile-only src/render/autoedit-sem-borrado.ts
 */
import 'dotenv/config';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PrismaClient } from '@prisma/client';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { EditMap, TranscriptWord } from '@maquina/contratos';
import { AUTO_EDIT_COMPOSITION_ID } from '@maquina/video';
import { buildAutoEditInput, type AutoEditContext } from './auto-edit';

const PORTA = 3020;
const raizVideo = path.resolve(__dirname, '../../../video');
const saida = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'autoedit-sem-borrado');
const CAMPEAO = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'lote2-faixas', '_campeao.mp4');

async function main() {
  mkdirSync(saida, { recursive: true });
  const srv = http.createServer((req, res) => {
    const { size } = statSync(CAMPEAO);
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (r) { const a = +r[1], z = r[2] ? +r[2] : size - 1; res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 }); return void createReadStream(CAMPEAO, { start: a, end: z }).pipe(res); }
    res.writeHead(200, { ...h, 'Content-Length': size }); createReadStream(CAMPEAO).pipe(res);
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/campeao.mp4`;
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  const still = async (input: object, frame: number, nome: string) => {
    const { kind: _k, renderId: _r, templateId: _t, ...props } = input as Record<string, unknown>;
    const composition = await selectComposition({ serveUrl, id: AUTO_EDIT_COMPOSITION_ID, inputProps: props, port: PORTA });
    await renderStill({ composition, serveUrl, inputProps: props, frame: Math.min(frame, composition.durationInFrames - 1), output: path.join(saida, `${nome}.png`), imageFormat: 'png', port: PORTA });
    console.log(nome, JSON.stringify({ reframe: (props as { reframe: unknown }).reframe, captionMode: (props as { captionMode?: string }).captionMode }));
  };
  const tenta = async (nome: string, f: () => object, frame: number) => { try { await still(f(), frame, nome); } catch (e) { console.log(nome, 'ERRO', (e as Error).message.slice(0, 100)); } };

  // take quadrado (sem legenda)
  const take: AutoEditContext = {
    renderId: 't', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: 'en',
    source: { videoUrl: 'fixtures/real-take.mp4', width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
    editMap: { version: 1, width: 960, height: 960, fps: 24, frameCount: 745, cells: [], layers: [], overlaysOverFace: [], profile: null, keepEdit: {} as never,
      faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }] } as never,
    words: [], silences: [], blocks: [{ index: 0, startSec: 0, endSec: 8 }], hookEndSec: null, palette: ['#5B4BF5'], brandName: 'A', page: null,
  };
  await tenta('take-cut-9x16', () => buildAutoEditInput(take, 'VERTICAL_9_16'), 60);

  // Amnayalife
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: 'cmvot8qxv000b22xlz0yrm60t' }, include: { champion: { include: { teardown: true, videoFile: true } } } });
  const ch = b.champion!;
  const em = ch.teardown!.editMap as unknown as EditMap;
  const ctx: AutoEditContext = {
    renderId: 'a', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: b.language,
    source: { videoUrl: url, width: ch.videoFile!.width ?? 1080, height: ch.videoFile!.height ?? 1920, fps: em.fps, durationSec: Number(ch.durationSec), hasAudio: true },
    editMap: em, words: (ch.teardown!.transcript as unknown as { words: TranscriptWord[] }).words, silences: [], blocks: [{ index: 0, startSec: 0, endSec: 15 }],
    hookEndSec: null, palette: ['#0008FF'], brandName: 'Amnayalife', page: null,
  };
  await tenta('amnayalife-cut-9x16', () => buildAutoEditInput(ctx, 'VERTICAL_9_16'), 150);
  await tenta('amnayalife-native-9x16', () => buildAutoEditInput({ ...ctx, type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: '英文開口卡住怎麼辦' } }, 'VERTICAL_9_16'), 150);
  await tenta('amnayalife-review-9x16', () => buildAutoEditInput({ ...ctx, type: 'REVIEW', params: { type: 'REVIEW', quote: '第三週開始，我開會終於敢直接用英文回話了。', author: 'Jessica', stars: 5 } }, 'VERTICAL_9_16'), 150);
  srv.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
