/**
 * F2 (12/11): props do Remotion de uma peça RESGATADA (formato × campeão), a partir da placa. Custo zero.
 * Uso (de api/): npx ts-node --transpile-only src/render/rescate-props.ts <id> <template> <faces.json> <dirs-captionTrack> <words.json> <placaUrl> <saida.json>
 * Imprime o `via` do enquadramento (builder | rosto | recorte, inferido) e grava as props (sem kind/renderId/templateId/audioPassthroughUrl).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { legendaDoCaptionTrack } from '@maquina/video';
import { amostrasDoTemplate } from '../iteracao/legenda-protegida';
import { buildFrameInput } from './frame';
import type { AutoEditContext } from './auto-edit';

const [id, template, facesJson, dirs, wordsJson, placaUrl, saida] = process.argv.slice(2);
const f = JSON.parse(readFileSync(facesJson, 'utf8'))[id];
const tr = dirs.split(',').map((d) => { try { return JSON.parse(readFileSync(`${d}/${id}-captionTrack.json`, 'utf8')); } catch { return null; } }).find(Boolean);
const w = JSON.parse(readFileSync(wordsJson, 'utf8')); const words = (w.words ?? w).map((x: any) => ({ word: x.word, startSec: x.startSec ?? x.start, endSec: x.endSec ?? x.end }));
const bx = tr.trechos.filter((t: any) => t.texto).map((t: any) => t.box);
const x0 = Math.min(...bx.map((b: any) => b.x)), y0 = Math.min(...bx.map((b: any) => b.y)), x1 = Math.max(...bx.map((b: any) => b.x + b.w)), y1 = Math.max(...bx.map((b: any) => b.y + b.h));
const e = tr.estilo;
const em: any = { version: 1, width: f.W, height: f.H, fps: 30, frameCount: f.N, cells: [], overlaysOverFace: [], profile: null, keepEdit: {},
  faceTrack: [{ startFrame: 0, endFrame: f.N, region: { x: 0, y: 0, w: f.W, h: f.H }, fullFrame: true, facesMax: 1, minScore: 0.9, faceInRegion: [{ atFrame: 0, box: { x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] } }] }],
  layers: [{ id: 'cap', kind: 'caption', startFrame: 0, endFrame: f.N, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, background: { kind: 'none', color: null, box: null }, style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: e.tamPx, lineHeight: 1.1, color: e.corTexto, highlightColor: e.corDestaque, strokeColor: e.corTraco, strokeWidthPx: e.strokePx, shadow: true, align: 'center' }, text: null, wordsPerPage: e.palavrasPorPagina, source: 'vision' }] };
const ctx: AutoEditContext = { renderId: 'resgate', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: 'en', source: { videoUrl: 'ORIGINAL', width: f.W, height: f.H, fps: 30, durationSec: f.N / 30, hasAudio: true },
  editMap: em, words, silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null, swap: { swap: true, plateReady: true, plateUrl: placaUrl, legenda: legendaDoCaptionTrack(tr, words, 'en', f.H) as never } };
const brand = { name: 'Coluna', handle: '@coluna', initials: 'C', color: '#5B4BF5' };
const spec = { template, texts: amostrasDoTemplate(template as never, 'en')[0], screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as never;
const inp: any = buildFrameInput(spec, ctx, 'VERTICAL_9_16');
const { kind: _k, renderId: _r, templateId: _t, audioPassthroughUrl: _a, ...props } = inp;
const cb = props.video.contentBox;
const via = cb && (cb.y + cb.h < f.H - 4 || cb.x > 4 || cb.x + cb.w < f.W - 4) ? 'recorte' : 'builder/rosto';
console.log(JSON.stringify({ id, template, videoUrl: props.video.source.videoUrl, contentBox: cb ?? null, reframe: props.video.reframe, via, captions: props.captions?.words?.length ?? 0, protectedBands: props.video.protectedBands ?? null }));
writeFileSync(saida, JSON.stringify(props));
