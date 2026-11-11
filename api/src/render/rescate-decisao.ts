/**
 * F2 (12/11): a decisão real de resgate por formato × campeão, SEM render e sem custo. Roda `captionGuardOf` (o mesmo do plano) com e sem a troca de
 * legenda e imprime, por formato, se o `avoid` já passava, se a troca resgata ou se continua bloqueado.
 * Uso (de api/): npx ts-node --transpile-only src/render/rescate-decisao.ts <dir-dos-captionTrack> <faces.json> <saida.json> [id ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { faixasProtegidasDe, FRAME_IDS } from '@maquina/video';
import { amostrasDoTemplate, captionGuardOf } from '../iteracao/legenda-protegida';
import { buildFrameInput } from './frame';

const [dirs, facesJson, saida, ...ids] = process.argv.slice(2);
const faces = JSON.parse(readFileSync(facesJson, 'utf8'));
const brand = { name: 'Coluna', handle: '@c', initials: 'C', color: '#5B4BF5' };
const FORMATOS = ['question_box', 'gossip_page', 'split_stack', 'split_torn', 'ranking', 'post_card', 'story', 'read_caption', 'live', 'gossip_white'] as const;
const out: Record<string, Record<string, string>> = {};

for (const id of ids.length ? ids : Object.keys(faces)) {
  const f = faces[id];
  const trilha = dirs.split(',').map((d) => { try { return JSON.parse(readFileSync(`${d}/${id}-captionTrack.json`, 'utf8')); } catch { return null; } }).find(Boolean);
  const bx = trilha.trechos.filter((t: { texto: string }) => t.texto).map((t: { box: { x: number; y: number; w: number; h: number } }) => t.box);
  const x0 = Math.min(...bx.map((b: { x: number }) => b.x)), y0 = Math.min(...bx.map((b: { y: number }) => b.y));
  const x1 = Math.max(...bx.map((b: { x: number; w: number }) => b.x + b.w)), y1 = Math.max(...bx.map((b: { y: number; h: number }) => b.y + b.h));
  const editMap = {
    version: 1, width: f.W, height: f.H, fps: 30, frameCount: f.N, cells: [], overlaysOverFace: [], profile: null, keepEdit: {}, protectedBands: undefined,
    faceTrack: [{ startFrame: 0, endFrame: f.N, region: { x: 0, y: 0, w: f.W, h: f.H }, fullFrame: true, facesMax: 1, minScore: 0.9, faceInRegion: [{ atFrame: 0, box: { x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] } }] }],
    layers: [{ id: 'cap', kind: 'caption', startFrame: 0, endFrame: f.N, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, background: { kind: 'none', color: null, box: null }, style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: trilha.estilo.tamPx, lineHeight: 1.1, color: trilha.estilo.corTexto, highlightColor: trilha.estilo.corDestaque, strokeColor: trilha.estilo.corTraco, strokeWidthPx: trilha.estilo.strokePx, shadow: true, align: 'center' }, text: null, wordsPerPage: trilha.estilo.palavrasPorPagina, source: 'vision' }],
  };
  const source = { width: f.W, height: f.H, fps: 30, durationSec: f.N / 30, hasAudio: true };
  const bands = faixasProtegidasDe(editMap as never, source as never);
  const s = { editMap: editMap as never, source, words: [{ word: 'a', startSec: 0.1, endSec: 0.4 }], silences: [], blocks: [{ index: 0, startSec: 0, endSec: f.N / 30 }], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', language: 'en', brandColor: null };
  const base = { templates: FORMATOS as never, frame: { brand, screenLanguage: 'en', faceAtSec: null }, headline: null };
  const sem = captionGuardOf(s, bands, base);
  const com = captionGuardOf(s, bands, { ...base, swap: { track: trilha } });
  const chave = (b: { type: string; template: string | null }) => `${b.type}${b.template ? ':' + b.template : ''}`;
  const semB = new Map(sem.blocked.map((b) => [chave(b), b.reason])), comB = new Map(com.blocked.map((b) => [chave(b), b.reason]));
  const linha: Record<string, string> = {};
  for (const t of FORMATOS) {
    const k = `FRAME:${t}`;
    if (!semB.has(k)) { linha[t] = 'avoid (já passava)'; continue; }
    if (comB.has(k)) { linha[t] = `bloqueado (${semB.get(k)})`; continue; }
    // resgatado: como a faixa antiga ficou escondida (recorte = contentBox menor que o arquivo; senão enquadramento sem o recorte)
    const ctx: any = { renderId: 'x', type: 'FRAME', params: { type: 'FRAME' }, language: 'en', source: { videoUrl: 'u', ...source }, editMap, words: [{ word: 'a', startSec: 0.1, endSec: 0.4 }], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'A', page: null, swap: { swap: true, plateReady: true, plateUrl: 'p' } };
    const spec = { template: t, texts: amostrasDoTemplate(t as never, 'en')[0], screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as never;
    const cb = (buildFrameInput(spec, ctx, 'VERTICAL_9_16') as any).video.contentBox;
    linha[t] = cb && (cb.y + cb.h < f.H - 4 || cb.x > 4 || cb.x + cb.w < f.W - 4) ? `RESGATADO (recorte ${Math.round((cb.h / f.H) * 100)}% da altura)` : 'RESGATADO (enquadramento/cartão)';
  }
  for (const t of ['NATIVE_SEARCH', 'CUT', 'REVIEW']) linha[t] = !semB.has(t) ? 'avoid (já passava)' : comB.has(t) ? `bloqueado (${semB.get(t)})` : 'RESGATADO (swap)';
  out[id] = linha;
  console.log(id, 'faixa', JSON.stringify(bands.map((b) => [Math.round(b.y), Math.round(b.h)])), JSON.stringify(linha));
}
writeFileSync(saida, JSON.stringify(out, null, 1));
void FRAME_IDS;
