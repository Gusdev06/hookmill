// Onde está o vídeo DE VERDADE dentro do quadro do campeão (feedback do Gusta 25/10, 16 molduras do lote
// cmvnlm4yd000l22emdoob1j5a): campeão 720×1280 com faixa de headline em cima (0-187 px) e campo preto embaixo
// (1120-1280); a moldura não pode pôr essas faixas dentro da caixa dela. PURO, testado em conteudo-campeao.spec.ts.
//  - contentBox: o retângulo do vídeo sem letterbox. Fonte, em ordem: a região do faceTrack que mais tempo tem rosto
//    (é a célula do vídeo), senão a maior célula do editMap.cells no maior trecho de tempo, senão o quadro inteiro.
//  - burnedTextBands: legenda/texto queimado DENTRO da contentBox (faixa da largura toda), com o tempo de cada um, pra a
//    moldura não empilhar texto dela em cima.
import type { EditMap, Rect } from '@maquina/contratos';

export interface BurnedTextBand { kind: 'caption' | 'text' | 'headline'; box: Rect; startSec: number; endSec: number }
export interface ChampionContent {
  /** px do campeão (mesmo espaço do editMap) */
  contentBox: Rect;
  /** de onde saiu (rastreio no render.input) */
  contentBoxSource: 'face_track' | 'cells' | 'full_frame';
  burnedTextBands: BurnedTextBand[];
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
const inter = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
};
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Caixa menor que isto do quadro não é "o vídeo" (célula de faixa/legenda). */
const MIN_FRACAO = 0.25;

export function contentBoxOf(editMap: EditMap | null, size: { width: number; height: number }): Pick<ChampionContent, 'contentBox' | 'contentBoxSource'> {
  const W = editMap?.width || size.width;
  const H = editMap?.height || size.height;
  const full: Rect = { x: 0, y: 0, w: W, h: H };
  if (!editMap) return { contentBox: full, contentBoxSource: 'full_frame' };
  const ok = (r: Rect) => area(inter(r, full)) >= MIN_FRACAO * area(full);
  // 1. região do faceTrack (fora de tela cheia) com mais frames de rosto
  const porRegiao: { r: Rect; frames: number }[] = [];
  for (const f of editMap.faceTrack ?? []) {
    if (f.fullFrame || !f.region || f.endFrame <= f.startFrame) continue;
    const hit = porRegiao.find((x) => same(x.r, f.region));
    if (hit) hit.frames += f.endFrame - f.startFrame;
    else porRegiao.push({ r: f.region, frames: f.endFrame - f.startFrame });
  }
  const rosto = porRegiao.filter((x) => ok(x.r)).sort((a, b) => b.frames - a.frames)[0];
  if (rosto) return { contentBox: inter(rosto.r, full), contentBoxSource: 'face_track' };
  // 2. maior célula do trecho mais longo do editMap.cells
  const trecho = [...(editMap.cells ?? [])].sort((a, b) => b.endFrame - b.startFrame - (a.endFrame - a.startFrame))[0];
  const cel = [...(trecho?.cells ?? [])].filter(ok).sort((a, b) => area(b) - area(a))[0];
  if (cel && !same(cel, full)) return { contentBox: inter(cel, full), contentBoxSource: 'cells' };
  return { contentBox: full, contentBoxSource: 'full_frame' };
}

/** Legenda/texto queimado que cai DENTRO da contentBox (≥ 50 % da altura do texto lá dentro), como faixa da largura dela. */
export function burnedTextBandsOf(editMap: EditMap | null, contentBox: Rect): BurnedTextBand[] {
  if (!editMap?.layers?.length || !editMap.fps) return [];
  const out: BurnedTextBand[] = [];
  for (const l of editMap.layers) {
    if (!l.box || l.endFrame <= l.startFrame) continue;
    const i = inter(l.box, contentBox);
    if (i.h < 0.5 * l.box.h || i.w <= 0) continue;
    out.push({
      kind: l.kind, box: { x: contentBox.x, y: i.y, w: contentBox.w, h: i.h },
      startSec: r3(l.startFrame / editMap.fps), endSec: r3(l.endFrame / editMap.fps),
    });
  }
  return out.sort((a, b) => a.box.y - b.box.y);
}

export function championContentOf(editMap: EditMap | null, size: { width: number; height: number }): ChampionContent {
  const b = contentBoxOf(editMap, size);
  return { ...b, burnedTextBands: burnedTextBandsOf(editMap, b.contentBox) };
}
