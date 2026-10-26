/**
 * Prova do passo 2 do legenda-protegida-v1 (recorte + legenda refeita no estilo da original) com fixture local: o take
 * com uma legenda queimada BEM abaixo do rosto (video/public/fixtures/real-take-legenda.mp4, drawtext em y 800). AutoEdit
 * CUT e NATIVE_SEARCH e as molduras live/meme em 9:16, pelos builders de verdade. Remotion na porta 3020 (nunca 3001).
 * Uso (de api/): npx ts-node --transpile-only src/render/legenda-refeita-real.ts
 */
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AUTO_EDIT_COMPOSITION_ID, FRAME_COMPOSITION_ID } from '@maquina/video';
import { buildAutoEditInput, type AutoEditContext } from './auto-edit';
import { buildFrameInput } from './frame';

const PORTA = 3020;
const raizVideo = path.resolve(__dirname, '../../../video');
const saida = path.join(raizVideo, 'out', 'molduras-producao-2026-10-25', 'legenda-refeita');

async function main() {
  mkdirSync(saida, { recursive: true });
  const words = (JSON.parse(readFileSync(path.join(raizVideo, 'scripts/editor-f1/real-take.json'), 'utf8')) as { scenes: { words: { word: string; startSec: number; endSec: number }[] }[] }).scenes[0].words;
  const em = {
    version: 1, width: 960, height: 960, fps: 24, frameCount: 288, cells: [], overlaysOverFace: [], profile: null, keepEdit: {},
    faceTrack: [{ startFrame: 0, endFrame: 288, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
    layers: [{ id: 'caption-1', kind: 'caption', box: { x: 130, y: 795, w: 700, h: 60 }, startFrame: 0, endFrame: 288, text: null, wordsPerPage: 3, source: 'vision',
      background: { kind: 'none', color: null, box: null },
      style: { fontId: 'montserrat-900', uppercase: true, fontSizePx: 46, lineHeight: 1.1, color: '#FFFFFF', highlightColor: '#FFD43B', strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' } }],
  };
  const base: AutoEditContext = {
    renderId: 'prova-replace', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: 'en',
    source: { videoUrl: 'fixtures/real-take-legenda.mp4', width: 960, height: 960, fps: 24, durationSec: 12, hasAudio: true },
    editMap: em as never, words, silences: [], blocks: [{ index: 0, startSec: 0, endSec: 7.5 }], hookEndSec: null, palette: ['#5B4BF5'], brandName: 'Coluna Leve', page: null,
  };
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  const still = async (id: string, props: Record<string, unknown>, nome: string, frame = 60) => {
    const composition = await selectComposition({ serveUrl, id, inputProps: props, port: PORTA });
    await renderStill({ composition, serveUrl, inputProps: props, frame, output: path.join(saida, `${nome}.png`), imageFormat: 'png', port: PORTA });
    console.log(nome, (props as { captionMode?: string }).captionMode);
  };
  const semKind = <T extends object>(i: T) => { const { kind: _k, renderId: _r, templateId: _t, ...p } = i as T & Record<string, unknown>; return p; };
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '2.5', '-i', path.join(raizVideo, 'public/fixtures/real-take-legenda.mp4'), '-frames:v', '1', path.join(saida, 'antes.png')]);
  await still(AUTO_EDIT_COMPOSITION_ID, semKind(buildAutoEditInput(base, 'VERTICAL_9_16')), 'cut-9x16');
  await still(AUTO_EDIT_COMPOSITION_ID, semKind(buildAutoEditInput({ ...base, type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: 'back pain at night' } }, 'VERTICAL_9_16')), 'native-search-9x16', 120);
  const brand = { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' };
  for (const [id, texts] of [['live', {}], ['meme', { pov: 'you wake up and your back already hurts', cta: 'Tap the button' }]] as const) {
    const i = buildFrameInput({ template: id, texts: texts as never, screenLanguage: 'en', brand, faceAtSec: 1, second: null, suggestedPrimaryText: null }, base, 'VERTICAL_9_16');
    await still(FRAME_COMPOSITION_ID, semKind(i), `${id}-9x16`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
