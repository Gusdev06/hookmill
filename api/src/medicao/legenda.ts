// Caixa real de uma legenda SEM fundo (karaokê direto sobre o vídeo ou sobre faixa preta), medida por pixel nos instantes
// das palavras. A visão acerta o tipo da camada mas chuta a posição (podcast: y589, a legenda está em y≈955-1041).
// Sem limiar absoluto de posição: a legenda é a faixa de linhas com mais "pixel de letra" (claro colado em escuro) que
// MUDA entre os instantes (o gancho/rodapé fixo não muda; o rosto muda mas tem pouco pixel de letra).
import type { Rect } from '@maquina/contratos';
import { run, type Bins } from './ffmpeg';

/** Letra = claro (L > 190) com escuro (L < 110: contorno, faixa preta, destaque roxo) a até 4 px na horizontal. */
function mascaraDeLetra(rgb: Buffer, w: number, h: number): Uint8Array {
  const L = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < w * h; i++, o += 3) L[i] = (299 * rgb[o] + 587 * rgb[o + 1] + 114 * rgb[o + 2]) / 1000;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      if (L[r + x] <= 190) continue;
      for (let d = 1; d <= 4; d++) {
        if ((x - d >= 0 && L[r + x - d] < 110) || (x + d < w && L[r + x + d] < 110)) { m[r + x] = 1; break; }
      }
    }
  }
  return m;
}

export interface CaptionBoxOptions { minScore?: number; maxSamples?: number }

/**
 * Faixa da legenda: score(linha) = min(fração de pixels de letra, fração de pixels que mudam entre instantes); faixa
 * contígua em volta do pico (buracos ≤ 4 linhas) acima de 40 % do pico. Pico < 0,06 = sem legenda (null). Com
 * `approxBox`, entre picos parecidos (≥ 80 % do maior) fica o mais perto dela. Caixa = extensão das letras (p1-p99 em x)
 * + folga de 0,65 × altura das letras (a caixa da camada comporta a entrelinha e o destaque da palavra).
 */
export async function captionBox(bins: Bins, file: string, info: { w: number; h: number }, atSec: number[], approxBox: Rect | null,
  opt: CaptionBoxOptions = {}): Promise<Rect | null> {
  const { w, h } = info;
  const ts = [...new Set(atSec.filter((t) => Number.isFinite(t) && t >= 0).map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
  const passo = Math.max(1, Math.ceil(ts.length / (opt.maxSamples ?? 24)));
  const instantes = ts.filter((_, i) => i % passo === 0);
  if (instantes.length < 2) return null;
  const dens = new Float64Array(h);
  let base: Uint8Array | null = null;
  const mudou = new Uint8Array(w * h);
  const letra = new Uint8Array(w * h);   // pixel que foi letra em algum instante
  let n = 0;
  for (const t of instantes) {
    const r = await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { allowFail: true });
    if (r.stdout.length < w * h * 3) continue;
    const m = mascaraDeLetra(r.stdout, w, h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) s += m[y * w + x]; dens[y] += s / w; }
    if (!base) base = m; else for (let i = 0; i < m.length; i++) if (m[i] !== base[i]) mudou[i] = 1;
    for (let i = 0; i < m.length; i++) letra[i] |= m[i];
    n++;
  }
  if (n < 2) return null;
  const score = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let c = 0; for (let x = 0; x < w; x++) c += mudou[y * w + x];
    score[y] = Math.min(dens[y] / n, c / w);
  }
  // suaviza 3 linhas
  const s3 = score.map((_, y) => (score[Math.max(0, y - 1)] + score[y] + score[Math.min(h - 1, y + 1)]) / 3);
  const minScore = opt.minScore ?? 0.06;
  // picos locais (um por faixa) acima do mínimo
  const faixas: { a: number; b: number; pico: number }[] = [];
  for (let y = 0; y < h;) {
    if (s3[y] < minScore) { y++; continue; }
    let a = y, b = y, pico = 0, buraco = 0;
    for (let k = y; k < h; k++) {
      if (s3[k] >= minScore * 0.5) { b = k; buraco = 0; pico = Math.max(pico, s3[k]); } else if (++buraco > 4) break;
    }
    faixas.push({ a, b, pico });
    y = b + 5;
  }
  if (!faixas.length) return null;
  const maior = Math.max(...faixas.map((f) => f.pico));
  const fortes = faixas.filter((f) => f.pico >= 0.8 * maior);
  const centro = approxBox ? approxBox.y + approxBox.h / 2 : null;
  const f = centro === null ? fortes.sort((x, y) => y.pico - x.pico)[0]
    : fortes.sort((x, y) => Math.abs((x.a + x.b) / 2 - centro) - Math.abs((y.a + y.b) / 2 - centro))[0];
  // borda da faixa: linhas em volta do pico acima de 40 % do pico dela
  const corte = 0.4 * f.pico;
  let topo = f.a, fundo = f.b;
  while (topo < fundo && s3[topo] < corte) topo++;
  while (fundo > topo && s3[fundo] < corte) fundo--;
  // extensão em x: pixels de letra que mudaram dentro da faixa (letra de alguma página), p1-p99
  const xs: number[] = [];
  for (let y = topo; y <= fundo; y++) for (let x = 0; x < w; x++) if (mudou[y * w + x] && letra[y * w + x]) xs.push(x);
  if (!xs.length) return null;
  xs.sort((p, q) => p - q);
  const x0 = xs[Math.floor(xs.length * 0.01)], x1 = xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.99))];
  const alt = fundo - topo + 1;
  const pad = Math.round(0.65 * alt);
  const x = Math.max(0, x0 - pad), y = Math.max(0, topo - pad);
  return { x, y, w: Math.min(w, x1 + pad + 1) - x, h: Math.min(h, fundo + pad + 1) - y };
}
