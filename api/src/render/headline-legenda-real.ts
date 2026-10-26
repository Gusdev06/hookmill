/**
 * Prova local (sem Lambda, nada pago) da linha video do headline-e-legenda-v1: headline nova (remix-keep) na faixa do
 * campeão zh-TW real (lote cmvnlm4yd000l22emdoob1j5a) e sobre o vídeo (fixture), faixa adicionada, e legenda automática
 * em zh-TW (transcrição real) e pt nos 3 formatos, na Moldura e no AutoEdit. Remotion na porta 3020 (nunca 3001).
 * Pré: o campeão baixado por molduras-campeao-real.ts em video/out/molduras-producao-2026-10-25/campeao-real/_campeao.mp4.
 * Uso (de api/): npx ts-node --transpile-only src/render/headline-legenda-real.ts
 */
import 'dotenv/config';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { EditMap, TranscriptWord } from '@maquina/contratos';
import { AUTO_EDIT_COMPOSITION_ID, FRAME_COMPOSITION_ID, REMIX_COMPOSITION_ID } from '@maquina/video';
import { frameSpecOf } from '../edicao/frame-input';
import { buildAutoEditInput, type AutoEditContext } from './auto-edit';
import { buildFrameInput } from './frame';
import { buildHeadlineInput } from './headline';

const PORTA = 3020;
const raizVideo = path.resolve(__dirname, '../../../video');
const saida = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'headline-legenda');
const CAMPEAO = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'campeao-real', '_campeao.mp4');
const TAKE = path.join(raizVideo, 'public', 'fixtures', 'real-take.mp4');
const FORMATOS = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const;
const curto = (f: string) => (f === 'VERTICAL_9_16' ? '9x16' : f === 'PORTRAIT_4_5' ? '4x5' : '1x1');

async function main() {
  mkdirSync(saida, { recursive: true });
  const arquivos: Record<string, string> = { 'campeao.mp4': CAMPEAO, 'take.mp4': TAKE };
  const srv = http.createServer((req, res) => {
    const f = arquivos[path.basename((req.url ?? '').split('?')[0])];
    if (!f) return void res.writeHead(404).end();
    const { size } = statSync(f);
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (r) { const a = +r[1], z = r[2] ? +r[2] : size - 1; res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 }); return void createReadStream(f, { start: a, end: z }).pipe(res); }
    res.writeHead(200, { ...h, 'Content-Length': size }); createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  const still = async (id: string, props: Record<string, unknown>, frame: number, nome: string) => {
    const composition = await selectComposition({ serveUrl, id, inputProps: props, port: PORTA });
    await renderStill({ composition, serveUrl, inputProps: props, frame: Math.min(frame, composition.durationInFrames - 1), output: path.join(saida, `${nome}.png`), imageFormat: 'png', port: PORTA });
    console.log(nome);
  };
  const semKind = <T extends object>(i: T) => { const { kind: _k, renderId: _r, templateId: _t, audioPassthroughUrl: _a, ...p } = i as T & Record<string, unknown>; return p; };

  // ── campeão zh-TW real ──
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: 'cmvnlm4yd000l22emdoob1j5a' }, include: { champion: { include: { teardown: true, videoFile: true } }, items: true } });
  const ch = b.champion!;
  const em = ch.teardown!.editMap as unknown as EditMap;
  const palavrasZh = ((ch.teardown!.transcript as unknown as { words: TranscriptWord[] }).words).map((w) => ({ word: w.word, startSec: w.startSec, endSec: w.endSec }));
  const ctxZh: AutoEditContext = {
    renderId: 'prova-zh', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: 'zh-TW',
    source: { videoUrl: `${base}/campeao.mp4`, width: 720, height: 1280, fps: em.fps, durationSec: Number(ch.durationSec), hasAudio: true },
    editMap: em, words: [], silences: [], blocks: [{ index: 0, startSec: 0, endSec: 15 }], hookEndSec: null, palette: ['#0008FF'], brandName: 'Amnayalife', page: null,
  };
  const capZh = { words: palavrasZh, highlightColor: '#3D7BFF', language: 'zh-TW' };
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', CAMPEAO, '-frames:v', '1', path.join(saida, 'zh-antes.png')]);
  // A) headline nova na faixa (letterbox preto: a mediana medida do fundo é preta)
  const hz = buildHeadlineInput({ mode: 'replace', text: '想說「我不方便」？母語人士會說 I\'m a bit tied up！', highlight: 'I\'m a bit tied up', language: 'zh-TW', brandColor: '#0008FF', plateColor: '#000000' }, ctxZh);
  await still(REMIX_COMPOSITION_ID, semKind(hz), 90, 'zh-headline-faixa');

  // ── fixture (take quadrado) com uma headline "sobre o vídeo" no editMap ──
  const ctxTake: AutoEditContext = {
    renderId: 'prova-pt', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: 'pt',
    source: { videoUrl: `${base}/take.mp4`, width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
    editMap: {
      version: 1, width: 960, height: 960, fps: 24, frameCount: 745, cells: [], overlaysOverFace: [], profile: null, keepEdit: {} as never,
      faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
      layers: [{ id: 'headline-1', kind: 'headline', box: { x: 90, y: 600, w: 780, h: 120 }, startFrame: 0, endFrame: 745, text: 'Antiga', background: { kind: 'none', color: null, box: null },
        style: { fontId: 'montserrat-900', uppercase: true, fontSizePx: 52, lineHeight: 1.1, color: '#FFFFFF', highlightColor: '#FFD43B', strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center' }, source: 'vision', wordsPerPage: null }],
    } as never,
    words: [], silences: [], blocks: [{ index: 0, startSec: 0, endSec: 12 }], hookEndSec: null, palette: ['#5B4BF5'], brandName: 'Coluna Leve', page: null,
  };
  const frasePt = 'Você acorda travado toda manhã e acha que é a idade mas não é a sua noite que decide como você acorda'.split(' ');
  const capPt = { words: frasePt.map((w, i) => ({ word: w, startSec: i * 0.42, endSec: i * 0.42 + 0.36 })), highlightColor: '#FFD43B', language: 'pt' };
  // B) headline sobre o vídeo (placa da cor mediana) + legenda automática no karaokê do remix
  const hp = buildHeadlineInput({ mode: 'replace', text: 'Sua lombar trava toda manhã?', highlight: 'toda manhã', language: 'pt', brandColor: '#5B4BF5', plateColor: '#6F6359', captions: capPt }, ctxTake);
  await still(REMIX_COMPOSITION_ID, semKind(hp), 72, 'pt-headline-sobre-video');
  // C) headline adicionada (campeão sem headline): faixa na cor da marca
  const ha = buildHeadlineInput({ mode: 'add', text: 'Acorda travado todo dia?', highlight: 'travado', language: 'pt', brandColor: '#5B4BF5' }, { ...ctxTake, editMap: { ...(ctxTake.editMap as EditMap), layers: [] } });
  await still(REMIX_COMPOSITION_ID, semKind(ha), 72, 'pt-headline-adicionada');

  // ── legenda automática: Moldura (zh real e pt fixture) e AutoEdit CUT, nos 3 formatos ──
  const itens = b.items.filter((i) => (i.autoType as string) === 'FRAME');
  const paramsDe = (t: string) => (itens.find((i) => (i.payload as { params: { template: string } }).params.template === t)!.payload as { params: Record<string, unknown> }).params;
  for (const f of FORMATOS) {
    for (const t of ['meme', 'split_stack', 'pov_testimonial']) {
      const iz = buildFrameInput(frameSpecOf(paramsDe(t)), ctxZh, f);
      await still(FRAME_COMPOSITION_ID, { ...semKind(iz), captions: capZh }, 75, `zh-legenda-${t}-${curto(f)}`);
      const sp = frameSpecOf({ ...paramsDe(t), screenLanguage: 'pt', texts: t === 'meme' ? { pov: 'você acorda e a lombar já reclama', cta: 'Toque no botão' } : t === 'split_stack' ? { headline: 'Você não nasceu pra *acordar com dor*' } : { pov: 'você fez a rotina e acordou leve', cta: 'Teste agora' }, second: null });
      const ip = buildFrameInput(sp, ctxTake, f);
      await still(FRAME_COMPOSITION_ID, { ...semKind(ip), captions: capPt }, 75, `pt-legenda-${t}-${curto(f)}`);
    }
    const az = buildAutoEditInput(ctxZh, f);
    await still(AUTO_EDIT_COMPOSITION_ID, { ...semKind(az), captions: capZh }, 75, `zh-legenda-autoedit-cut-${curto(f)}`);
    const ap = buildAutoEditInput(ctxTake, f);
    await still(AUTO_EDIT_COMPOSITION_ID, { ...semKind(ap), captions: capPt }, 75, `pt-legenda-autoedit-cut-${curto(f)}`);
    // zh-TW sobre o take sem legenda queimada (o caso real do captionsAuto): palavras do Whisper em zh, 1-2 caracteres
    const fraseZh = ['你', '每天', '早上', '起床', '都', '腰痛', '嗎？', '其實', '不是', '年紀', '的', '問題', '是', '睡前', '的', '習慣'];
    const capZh2 = { words: fraseZh.map((w, k) => ({ word: w, startSec: k * 0.3, endSec: k * 0.3 + 0.26 })), highlightColor: '#FFD43B', language: 'zh-TW' };
    for (const t of ['meme', 'split_stack', 'pov_testimonial']) {
      const sp = frameSpecOf({ ...paramsDe(t), screenLanguage: 'zh-TW', second: null });
      await still(FRAME_COMPOSITION_ID, { ...semKind(buildFrameInput(sp, ctxTake, f)), captions: capZh2 }, 60, `zhtake-legenda-${t}-${curto(f)}`);
    }
    await still(AUTO_EDIT_COMPOSITION_ID, { ...semKind(ap), language: 'zh-TW', captions: capZh2 }, 60, `zhtake-legenda-autoedit-cut-${curto(f)}`);
  }
  srv.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
