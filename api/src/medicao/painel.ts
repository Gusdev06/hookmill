// Painel do avatar principal dentro de uma célula grande (§13.1, bug do Gusta 06/10): no AdLibNote/zap a borda entre
// a câmera de segurança e a tela do app é invisível (escuro contra escuro), então a guilhotina não separa as colunas do
// miolo e a célula vira 720x726 com o rapaz E o casal da câmera. Aqui a caixa é achada em volta do rosto:
//  1. candidatas a borda em cada lado: picos nítidos e persistentes (mínimo entre amostras) do gradiente na faixa do
//     rosto (colunas) e na coluna do rosto (linhas), mais as bordas da própria célula;
//  2. cada retângulo candidato é medido pelo APOIO dos lados: fração do comprimento do lado em que a borda é nítida em
//     todas as amostras (borda de painel atravessa o lado inteiro; contorno de porta/cama no fundo, só um pedaço);
//  3. fica o MENOR retângulo que contém o rosto (e o corpo abaixo dele) com apoio ≥ 0,8 em todos os lados; nenhum = a célula.
import type { Rect } from '@maquina/contratos';
import type { RgbFrame } from './celulas';

const px = (f: RgbFrame, x: number, y: number, c: number) => f.data[(y * f.w + x) * 3 + c];

/** Diferença por pixel atravessando a borda entre a-1 e a (vão de 3: pega transição de 2 px), mínimo entre amostras. */
function crossDiff(frames: RgbFrame[], axis: 'x' | 'y', at: number, along: number): number {
  let mn = Infinity;
  for (const f of frames) {
    const n = axis === 'x' ? f.w : f.h;
    const a = Math.max(0, at - 2), b = Math.min(n - 1, at + 1);
    let t = 0;
    for (let c = 0; c < 3; c++) t += axis === 'x' ? Math.abs(px(f, b, along, c) - px(f, a, along, c)) : Math.abs(px(f, along, b, c) - px(f, along, a, c));
    mn = Math.min(mn, t / 3);
  }
  return mn;
}

/** Linha de nitidez da borda candidata `at` ao longo de [from, to): 1 onde a borda é nítida contra a vizinhança. */
function sharpLine(frames: RgbFrame[], axis: 'x' | 'y', at: number, from: number, to: number): Uint8Array {
  const n = axis === 'x' ? frames[0].w : frames[0].h;
  const out = new Uint8Array(Math.max(0, to - from));
  const raw = new Float64Array(out.length);
  for (let i = from; i < to; i++) {
    const d = crossDiff(frames, axis, at, i);
    const viz: number[] = [];
    for (const k of [-10, -8, -6, 6, 8, 10]) { const p = at + k; if (p >= 2 && p < n - 1) viz.push(crossDiff(frames, axis, p, i)); }
    viz.sort((a, b) => a - b);
    const base = viz.length ? viz[viz.length >> 1] : 0;
    raw[i - from] = d > Math.max(8, 3 * base) ? 1 : 0;
  }
  // maioria em blocos de 9 px: borda com falha de 1-2 px (compressão) continua borda
  for (let i = 0; i < raw.length; i++) {
    let s = 0, m = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(raw.length - 1, i + 4); j++) { s += raw[j]; m++; }
    out[i] = s * 2 >= m ? 1 : 0;
  }
  return out;
}

/** Picos nítidos do perfil (mínimo entre amostras) num eixo, dentro de [lo, hi), na faixa [a0, a1) do outro eixo. */
function peaks(frames: RgbFrame[], axis: 'x' | 'y', lo: number, hi: number, a0: number, a1: number, max = 6): number[] {
  const prof: number[] = [];
  const step = Math.max(1, Math.floor((a1 - a0) / 60));
  for (let p = lo; p < hi; p++) {
    let t = 0, m = 0;
    for (let q = a0; q < a1; q += step) { t += crossDiff(frames, axis, p, q); m++; }
    prof.push(m ? t / m : 0);
  }
  const c: { p: number; v: number }[] = [];
  for (let i = 2; i < prof.length - 2; i++) {
    const v = prof[i];
    if (v < 6) continue;
    if (!(v >= prof[i - 1] && v >= prof[i + 1] && v >= prof[i - 2] && v >= prof[i + 2])) continue;
    const viz = prof.slice(Math.max(0, i - 12), i - 3).concat(prof.slice(i + 4, i + 13)).sort((a, b) => a - b);
    if (v > 2.5 * (viz[viz.length >> 1] ?? 0)) c.push({ p: lo + i, v });
  }
  return c.sort((a, b) => b.v - a.v).slice(0, max).map((x) => x.p);
}

export interface PanelResult { rect: Rect; support: number; fromCell: boolean }

/**
 * Caixa do avatar principal dentro da célula. `face` = caixa mediana do rosto principal (px do quadro).
 * Lado na borda do quadro tem apoio 1 (não há o que separar ali).
 */
export function panelAroundFace(frames: RgbFrame[], cell: Rect, face: Rect, minSupport = 0.8): PanelResult {
  const W = frames[0].w, H = frames[0].h;
  const cx0 = cell.x, cx1 = cell.x + cell.w, cy0 = cell.y, cy1 = cell.y + cell.h;
  const fx0 = Math.max(cx0, Math.floor(face.x)), fx1 = Math.min(cx1, Math.ceil(face.x + face.w));
  const fy0 = Math.max(cy0, Math.floor(face.y)), fy1 = Math.min(cy1, Math.ceil(face.y + face.h));
  const corpo = Math.min(cy1, Math.ceil(face.y + face.h * 1.6));   // a caixa contém o queixo e o começo do ombro
  const margem = Math.round(face.w * 0.15);
  // faixa do rosto (pra achar colunas) e coluna do rosto (pra achar linhas)
  const colsBand = [fy0, Math.min(cy1, Math.ceil(face.y + face.h * 2))] as const;
  const rowsBand = [Math.max(cx0, Math.floor(face.x - face.w * 0.5)), Math.min(cx1, Math.ceil(face.x + face.w * 1.5))] as const;
  const L = [cx0, ...peaks(frames, 'x', cx0 + 3, fx0 - margem, colsBand[0], colsBand[1])];
  const R = [cx1, ...peaks(frames, 'x', fx1 + margem, cx1 - 3, colsBand[0], colsBand[1])];
  const T = [cy0, ...peaks(frames, 'y', cy0 + 3, fy0 - margem, rowsBand[0], rowsBand[1])];
  const B = [cy1, ...peaks(frames, 'y', corpo, cy1 - 3, rowsBand[0], rowsBand[1])];

  const cache = new Map<string, Uint8Array>();
  const linha = (axis: 'x' | 'y', at: number, from: number, to: number) => {
    // linha inteira da célula, recortada depois por soma de prefixo
    const k = `${axis}${at}`;
    let v = cache.get(k);
    if (!v) { v = axis === 'x' ? sharpLine(frames, 'x', at, cy0, cy1) : sharpLine(frames, 'y', at, cx0, cx1); cache.set(k, v); }
    const off = axis === 'x' ? cy0 : cx0;
    let s = 0;
    for (let i = from - off; i < to - off; i++) s += v[i] ?? 0;
    return to > from ? s / (to - from) : 0;
  };
  // lado com folga de ±3 px (a borda da célula ou o pico podem cair 1-3 px fora da borda real): vale a melhor posição
  const encaixe = (axis: 'x' | 'y', at: number, from: number, to: number): { s: number; at: number } => {
    const n = axis === 'x' ? W : H;
    if (at <= 0 || at >= n) return { s: 1, at: Math.min(Math.max(at, 0), n) };
    let best = { s: -1, at };
    for (let d = -3; d <= 3; d++) {
      const p = at + d;
      if (p <= 2 || p >= n - 1) continue;
      const v = linha(axis, p, from, to);
      if (v > best.s + 1e-9) best = { s: v, at: p };
    }
    return best;
  };
  let best: PanelResult | null = null;
  for (const l of L) for (const r of R) for (const t of T) for (const b of B) {
    if (!(l < fx0 && r > fx1 && t < fy0 && b >= corpo)) continue;
    const area = (r - l) * (b - t);
    if (best && area >= best.rect.w * best.rect.h) continue;
    const el = encaixe('x', l, t, b), er = encaixe('x', r, t, b), et = encaixe('y', t, l, r), eb = encaixe('y', b, l, r);
    const s = Math.min(el.s, er.s, et.s, eb.s);
    if (s >= minSupport) best = { rect: { x: el.at, y: et.at, w: er.at - el.at, h: eb.at - et.at }, support: Math.round(s * 100) / 100, fromCell: false };
  }
  return best ?? { rect: { ...cell }, support: 0, fromCell: true };
}
