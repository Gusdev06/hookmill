// Células do layout (§13.1 item 1): o quadro é partido em guilhotina, linhas → colunas → linhas, cada corte achado
// pela mesma ideia do analisar_estrutura.py (perfil de gradiente por linha/coluna, mínimo entre as amostras do
// segmento, pico relativo ao próprio vídeo), agora restrito ao retângulo que está sendo partido. Assim a caixa do rosto
// (x 0-336, y 119-443 no zap-working-late) sai como célula própria, mesmo que nenhuma fronteira dela atravesse o quadro.
// Diferença do bandsFromSignatures (que segue o .py e fica como está): picos escolhidos por FORÇA (NMS), não "o
// primeiro que aparece"; o .py descartava a borda forte em y=119 porque uma borda de texto em y=87 vinha antes dela.
import type { Rect } from '@maquina/contratos';
import { median } from './layout';

/** Frame rgb24 cru (w*h*3). */
export interface RgbFrame { data: Uint8Array; w: number; h: number }

export interface CellOptions {
  /** profundidade da guilhotina: 1 = só faixas, 2 = + colunas, 3 = + linhas dentro das colunas */
  depth: number;
  /** menor lado de célula, fração da dimensão do quadro naquele eixo */
  minFrac: number;
  /** nos níveis de dentro, força mínima de borda = innerFrac × a borda mais forte do 1º nível */
  innerFrac: number;
}
export const DEFAULT_CELLS: CellOptions = { depth: 3, minFrac: 0.02, innerFrac: 0.2 };

function std(v: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length || 1;
  let q = 0;
  for (let i = 0; i < v.length; i++) q += (v[i] - m) ** 2;
  return Math.sqrt(q / (v.length || 1));
}

/**
 * Fronteiras dentro de [0, n): posição p = primeira linha/coluna do pedaço novo. `grads` = gradiente cru de cada
 * amostra; a borda de layout é a que sobrevive em TODAS (mínimo), acima de mediana + 4 desvios e nítida contra a
 * vizinhança. Escolha por força com distância mínima `gap` (e longe das pontas), posição refinada no gradiente cru.
 */
export function boundaries(grads: Float64Array[], n: number, gap: number, minStrength = 0): number[] {
  return strongBoundaries(grads, n, gap, minStrength).map((b) => b.p);
}

/** Igual a `boundaries`, com a força de cada fronteira (pra comparar entre níveis da guilhotina). */
export function strongBoundaries(grads: Float64Array[], n: number, gap: number, minStrength = 0): { p: number; v: number }[] {
  if (!grads.length || n < 3) return [];
  const L = n - 1;
  const est = new Float64Array(L);
  for (let i = 0; i < L; i++) { let mn = Infinity; for (const g of grads) mn = Math.min(mn, g[i]); est[i] = mn; }
  // suavização curta só pra achar pico (borda de 1-2 px de antialias/compressão); posição vem do cru
  const sm = new Float64Array(L);
  for (let i = 0; i < L; i++) sm[i] = Math.max(est[i], i > 0 ? (est[i - 1] + est[i]) / 2 : 0, i < L - 1 ? (est[i] + est[i + 1]) / 2 : 0);
  // piso de 3 níveis só pra não cortar faixa lisa em ruído de compressão (a decisão continua relativa ao próprio vídeo)
  const lim = Math.max(3, median(sm) + 4 * std(sm));
  const jan = Math.max(6, Math.floor(n / 80));
  const cand: { p: number; v: number }[] = [];
  for (let i = 0; i < L; i++) {
    if (!(sm[i] > lim)) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(L - 1, i + 2); j++) if (sm[j] > sm[i] || (sm[j] === sm[i] && j < i)) { isMax = false; break; }
    if (!isMax) continue;
    const viz = sm.subarray(Math.max(0, i - jan), Math.min(L, i + jan + 1));
    if (!(sm[i] > 2.5 * median(viz))) continue;
    // refino: maior gradiente cru (mínimo entre amostras) na vizinhança de ±2
    let best = i;
    for (let j = Math.max(0, i - 2); j <= Math.min(L - 1, i + 2); j++) if (est[j] > est[best]) best = j;
    cand.push({ p: best + 1, v: sm[i] });
  }
  cand.sort((a, b) => b.v - a.v);
  const keep: { p: number; v: number }[] = [];
  for (const c of cand) {
    if (c.v < minStrength) break;
    if (c.p < gap || n - c.p < gap) continue;
    if (keep.some((k) => Math.abs(k.p - c.p) < gap)) continue;
    keep.push(c);
  }
  return keep.sort((a, b) => a.p - b.p);
}

/**
 * Diferença média POR PIXEL entre a linha i e a i+1 (comprimento n-1). Borda de caixa: todo pixel muda, então o valor
 * é alto mesmo quando as médias dos dois lados empatam (a assinatura por média cancela isso).
 */
export function pixelGradient(f: RgbFrame, r: Rect, axis: 'x' | 'y'): Float64Array {
  const n = axis === 'y' ? r.h : r.w;
  const m = axis === 'y' ? r.w : r.h;
  const g = new Float64Array(Math.max(0, n - 1));
  const step = axis === 'y' ? f.w * 3 : 3;          // da linha i pra i+1
  for (let i = 0; i < n - 1; i++) {
    let t = 0;
    for (let j = 0; j < m; j++) {
      const x = axis === 'y' ? r.x + j : r.x + i;
      const y = axis === 'y' ? r.y + i : r.y + j;
      const o = (y * f.w + x) * 3;
      t += Math.abs(f.data[o + step] - f.data[o]) + Math.abs(f.data[o + step + 1] - f.data[o + 1]) + Math.abs(f.data[o + step + 2] - f.data[o + 2]);
    }
    g[i] = t / (3 * m);
  }
  return g;
}

/** Diferença média por pixel entre a linha/coluna `a` e a `b` do retângulo, num frame. */
function lineDiff(f: RgbFrame, r: Rect, axis: 'x' | 'y', a: number, b: number): number {
  const m = axis === 'y' ? r.w : r.h;
  let t = 0;
  for (let j = 0; j < m; j++) {
    const oa = axis === 'y' ? ((r.y + a) * f.w + r.x + j) * 3 : ((r.y + j) * f.w + r.x + a) * 3;
    const ob = axis === 'y' ? ((r.y + b) * f.w + r.x + j) * 3 : ((r.y + j) * f.w + r.x + b) * 3;
    t += Math.abs(f.data[oa] - f.data[ob]) + Math.abs(f.data[oa + 1] - f.data[ob + 1]) + Math.abs(f.data[oa + 2] - f.data[ob + 2]);
  }
  return t / (3 * m);
}

/**
 * Faixa fina (legenda, linha) por cima de um conteúdo só: o que está logo acima dela continua logo abaixo. Mede a
 * distância entre a linha antes e a linha depois da faixa e compara com a distância típica entre linhas à MESMA
 * separação dentro dos vizinhos (relativo ao próprio conteúdo, sem limiar fixo). Mediana entre as amostras.
 */
function sameAcross(frames: RgbFrame[], r: Rect, axis: 'x' | 'y', before: number, after: number, lo: number, hi: number): boolean {
  const sep = after - before;
  const per = frames.map((f) => {
    const d = lineDiff(f, r, axis, before, after);
    const typ: number[] = [];
    const stepv = Math.max(1, Math.floor((hi - lo - sep) / 24));
    for (let i = lo; i + sep < hi; i += stepv) if (i + sep <= before || i >= after) typ.push(lineDiff(f, r, axis, i, i + sep));
    return typ.length ? d / Math.max(1, median(typ)) : Infinity;
  });
  return median(per) <= 1.5;
}

function split(frames: RgbFrame[], r: Rect, axis: 'x' | 'y', gap: number, minStrength: number, thinMax: number):
  { parts: Rect[]; strengths: number[] } {
  const n = axis === 'y' ? r.h : r.w;
  // borda de layout atravessa o retângulo: o gradiente vale onde a borda é NÍTIDA em cada quarto do comprimento
  // (> 2,5x a mediana da vizinhança no próprio quarto, com folga de ±2 px porque a borda anda 1-2 px entre painéis).
  // Nítida, não forte: a borda fraca de verdade (câmera de segurança escura contra painel escuro) passa; listra que só
  // existe embaixo não corta a caixa do rosto em cima; contorno de letra não atravessa a faixa. Mínimo entre amostras.
  const m = axis === 'y' ? r.w : r.h;
  const nq = m >= 64 ? 4 : 1;
  const jan = Math.max(6, Math.floor(n / 80));
  const grads: Float64Array[] = [];
  for (const f of frames) {
    const ok = new Uint8Array(Math.max(0, n - 1)).fill(1);
    // o gradiente do retângulo inteiro é a média ponderada dos quartos (exato): 1 passada pelos pixels, não 2
    const full = new Float64Array(Math.max(0, n - 1));
    for (let k = 0; k < nq; k++) {
      const a0 = Math.floor((m * k) / nq), a1 = Math.floor((m * (k + 1)) / nq);
      const sub = axis === 'y' ? { x: r.x + a0, y: r.y, w: a1 - a0, h: r.h } : { x: r.x, y: r.y + a0, w: r.w, h: a1 - a0 };
      const g = pixelGradient(f, sub, axis);
      const peso = (a1 - a0) / m;
      for (let i = 0; i < g.length; i++) full[i] += g[i] * peso;
      if (nq === 1) continue;
      const nitido = new Uint8Array(g.length);
      for (let i = 0; i < g.length; i++) {
        if (g[i] <= 3) continue;   // abaixo do piso nem precisa da mediana (a maioria das posições)
        const viz = g.subarray(Math.max(0, i - jan), Math.min(g.length, i + jan + 1));
        nitido[i] = g[i] > 2.5 * median(viz) ? 1 : 0;
      }
      for (let i = 0; i < g.length; i++) {
        let any = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(g.length - 1, i + 2); j++) any |= nitido[j];
        if (!any) ok[i] = 0;
      }
    }
    grads.push(full.map((v, i) => (ok[i] ? v : 0)));
  }
  const bs = strongBoundaries(grads, n, gap, minStrength);
  let cuts = [0, ...bs.map((b) => b.p), n];
  // faixa fina entre dois pedaços do MESMO conteúdo (legenda queimada sobre o rosto em tela cheia) não é layout: funde
  for (let i = 1; i < cuts.length - 2; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a > thinMax) continue;
    if (sameAcross(frames, r, axis, a - 1, b, cuts[i - 1], cuts[i + 2])) { cuts = [...cuts.slice(0, i), ...cuts.slice(i + 2)]; i--; }
  }
  const out: Rect[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    out.push(axis === 'y'
      ? { x: r.x, y: r.y + cuts[i], w: r.w, h: cuts[i + 1] - cuts[i] }
      : { x: r.x + cuts[i], y: r.y, w: cuts[i + 1] - cuts[i], h: r.h });
  }
  return { parts: out, strengths: bs.filter((b) => cuts.includes(b.p)).map((b) => b.v) };
}

/**
 * Células (retângulos em px que cobrem o quadro inteiro, sem sobreposição) de um segmento de layout, a partir de
 * amostras do segmento. Guilhotina y → x → y (ou x → y → x com first='x': caixa aninhada cuja borda de baixo não
 * atravessa o quadro, ex. rosto em cima e câmera de segurança embaixo na mesma coluna). Ordem: de cima pra baixo, da
 * esquerda pra direita.
 */
export function cellsFromFrames(frames: RgbFrame[], opt: CellOptions = DEFAULT_CELLS, first: 'x' | 'y' = 'y'): Rect[] {
  if (!frames.length) return [];
  const { w, h } = frames[0];
  const gapY = Math.max(8, Math.round(h * opt.minFrac));
  const gapX = Math.max(8, Math.round(w * opt.minFrac));
  // força de referência = a borda mais forte do 1º nível; nos níveis de dentro só vale borda com ≥ 1/5 dela (contorno
  // de coisa dentro de uma caixa, ex. foto borrada ou porta no fundo, não vira célula)
  let ref = 0;
  const rec = (r: Rect, axis: 'x' | 'y', depth: number, top: boolean): Rect[] => {
    const thin = Math.round((axis === 'y' ? h : w) * 0.05);
    const { parts, strengths } = split(frames, r, axis, axis === 'y' ? gapY : gapX, top ? 0 : ref * opt.innerFrac, thin);
    if (top) ref = Math.max(0, ...strengths);
    if (depth <= 1 || parts.length === 0) return parts;
    return parts.flatMap((p) => rec(p, axis === 'y' ? 'x' : 'y', depth - 1, false));
  };
  const cells = rec({ x: 0, y: 0, w, h }, first, opt.depth, true);
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Menor célula (de qualquer das partições) que contém a caixa `b` (≥ 90 % da área dela); senão a que contém o centro. */
export function tightestCell(partitions: Rect[][], b: Rect): Rect | null {
  let best: Rect | null = null;
  for (const cells of partitions) for (const c of cells) {
    const ix = Math.max(0, Math.min(c.x + c.w, b.x + b.w) - Math.max(c.x, b.x));
    const iy = Math.max(0, Math.min(c.y + c.h, b.y + b.h) - Math.max(c.y, b.y));
    if (ix * iy >= 0.9 * b.w * b.h && (!best || c.w * c.h < best.w * best.h)) best = c;
  }
  return best ?? cellAt(partitions[0] ?? [], b.x + b.w / 2, b.y + b.h / 2);
}

/** Célula que contém o ponto (px). */
export function cellAt(cells: Rect[], px: number, py: number): Rect | null {
  return cells.find((c) => px >= c.x && px < c.x + c.w && py >= c.y && py < c.y + c.h) ?? null;
}
