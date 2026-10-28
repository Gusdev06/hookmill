/**
 * Prova local (nada pago) do legenda-protegida-v1 com o campeão Amnayalife (lote cmvot8qxv000b22xlz0yrm60t, zh-TW,
 * legenda queimada de 2 linhas no meio): as 18 molduras + HEADLINE em 9:16 pelo buildFrameInput/buildHeadlineInput,
 * com a decisão de cada uma (avoid = passo 1, replace = passo 2, blocked = passo 3) e um still no meio da legenda.
 * Remotion na porta 3020 (nunca 3001). Pré: o campeão baixado em video/out/molduras-producao-2026-10-25/lote2-faixas/.
 * Uso (de api/): npx ts-node --transpile-only src/render/legenda-protegida-real.ts
 */
import 'dotenv/config';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PrismaClient } from '@prisma/client';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EditMap, TranscriptWord } from '@maquina/contratos';
import { FRAME_COMPOSITION_ID, FRAME_IDS, REMIX_COMPOSITION_ID, checarLegendaProtegida } from '@maquina/video';
import { frameSpecOf } from '../edicao/frame-input';
import type { AutoEditContext } from './auto-edit';
import { buildFrameInput } from './frame';
import { buildHeadlineInput } from './headline';

const PORTA = Number(process.env.CAPTION_PROOF_PORT ?? 3020);
const LOTE = 'cmvot8qxv000b22xlz0yrm60t';
const raizVideo = path.resolve(__dirname, '../../../video');
const saida = process.env.CAPTION_PROOF_DIR ?? path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'legenda-protegida');
let CAMPEAO = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'lote2-faixas', '_campeao.mp4');

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
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: LOTE }, include: { items: true, champion: { include: { teardown: true, videoFile: true } } } });
  const ch = b.champion!;
  const em = ch.teardown!.editMap as unknown as EditMap;
  if (process.env.CAPTION_PROOF_AUTO_SOURCE === '1') {
    const candidates = ['campeao-real', 'lote2-faixas'].map((folder) => path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', folder, '_campeao.mp4'));
    const source = candidates.find((file) => {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
      const video = probe.streams.find((s: { width?: number }) => s.width);
      return video.width === ch.videoFile!.width && video.height === ch.videoFile!.height && Math.abs(Number(probe.format.duration) - Number(ch.durationSec)) < 1;
    });
    if (!source) throw new Error('Nenhum arquivo local corresponde às dimensões e duração do campeão deste lote');
    CAMPEAO = source;
    console.log(`Fonte local conferida: ${path.relative(raizVideo, source)}`);
  }
  const words = ((ch.teardown!.transcript as unknown as { words: TranscriptWord[] }).words);
  const ctx: AutoEditContext = {
    renderId: 'prova-lp', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: b.language,
    source: { videoUrl: url, width: ch.videoFile!.width ?? 1080, height: ch.videoFile!.height ?? 1920, fps: em.fps, durationSec: Number(ch.durationSec), hasAudio: true },
    editMap: em, words, silences: [], blocks: [], hookEndSec: null, palette: [], brandName: 'Amnayalife', page: null,
  };
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  const still = async (id: string, props: Record<string, unknown>, frame: number, nome: string) => {
    const composition = await selectComposition({ serveUrl, id, inputProps: props, port: PORTA });
    await renderStill({ composition, serveUrl, inputProps: props, frame: Math.min(frame, composition.durationInFrames - 1), output: path.join(saida, `${nome}.png`), imageFormat: 'png', port: PORTA });
  };
  const semKind = <T extends object>(i: T) => { const { kind: _k, renderId: _r, templateId: _t, audioPassthroughUrl: _a, ...p } = i as T & Record<string, unknown>; return p; };
  const brand = { name: 'Amnayalife', handle: '@amnaylife', initials: 'AM', color: '#0008FF' };
  const resultado: Record<string, string> = {};
  const frame = Math.round(Number(process.env.CAPTION_PROOF_SECONDS ?? 5) * 30); // instant with burned-in captions
  for (const id of FRAME_IDS) {
    if (process.env.CAPTION_PROOF_TEMPLATES && !process.env.CAPTION_PROOF_TEMPLATES.split(',').includes(id)) continue;
    const it = b.items.find((i) => (i.payload as { params?: { template?: string } }).params?.template === id);
    const params = it ? (it.payload as { params: Record<string, unknown> }).params
      : { template: id, texts: { promise: '讓你的英文*開口不卡*', price: { from: 'NT$ 990', to: 'NT$ 490' }, cta: '點擊下方按鈕立即報名' }, screenLanguage: 'zh', brand, faceAtSec: null, second: null };
    try {
      const i = buildFrameInput(frameSpecOf(params), ctx, 'VERTICAL_9_16');
      const chk = checarLegendaProtegida(semKind(i) as never);
      resultado[id] = `${i.captionMode ?? 'sem faixa'}${chk.ok ? '' : ' (checagem falhou!)'}`;
      await still(FRAME_COMPOSITION_ID, semKind(i), frame, id);
    } catch (e) {
      resultado[id] = (e as { code?: string; reason?: string }).code === 'CAPTION_PROTECTED' ? `blocked (${(e as { reason: string }).reason})` : `ERRO ${(e as Error).message.slice(0, 80)}`;
    }
    console.log(id, resultado[id]);
  }
  try {
    const h = buildHeadlineInput({ mode: 'replace', text: '補習花了幾萬塊，英文還是卡？*問題不在文法*', highlight: '問題不在文法', language: 'zh-TW', brandColor: '#0008FF', plateColor: '#000000' }, ctx);
    resultado.HEADLINE = 'avoid';
    await still(REMIX_COMPOSITION_ID, semKind(h), frame, 'HEADLINE');
  } catch (e) { resultado.HEADLINE = `blocked (${(e as { code?: string }).code})`; }
  console.log('HEADLINE', resultado.HEADLINE);
  writeFileSync(path.join(saida, 'resultado.json'), JSON.stringify(resultado, null, 2));
  srv.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
