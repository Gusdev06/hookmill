// Port em TS do .claude/skills/clonar-edicao/scripts/analisar_estrutura.py (estrutura de edição de um criativo).
// Fiel ao .py em tudo, com duas mudanças deliberadas (docs/render.md, "medição"):
//  1. Frames dos cortes saem de UM ffmpeg em stream (select na grade do passo, mesmos frames do -ss do .py), não de um
//     ffmpeg por instante: memória de 1 frame e ~8x mais rápido.
//  2. O refino do corte não usa limiar absoluto (o .py usa "distância < 8" numa busca binária): decodifica todos os
//     frames da janela e marca o primeiro que passa da meia altura do penhasco (halfCliffIndex). Em corte seco dá o
//     mesmo frame; em transição gradual (whip, fade) o .py depende de quanto 8 vale naquele vídeo.
// Faixas: fronteira = pico do perfil de gradiente que sobrevive em todas as amostras (mínimo entre frames), acima de
// mediana + 4 desvios e nítido contra a vizinhança (ambos relativos ao próprio vídeo).
import type { Measurements, Rect } from '@maquina/contratos';
import { run, streamFrames, type Bins } from './ffmpeg';
import { cellsFromFrames, type RgbFrame } from './celulas';

/** measureLayout + células (§13.1): cada segmento ganha `cells` (px, cobrem o quadro). Subtipo do Measurements. */
export type LayoutMeasure = Pick<Measurements, 'cuts'> & {
  /** cells = guilhotina y→x→y; cellsAlt = x→y→x (caixa aninhada). A trilha usa a menor célula que contém o rosto. */
  segments: (Measurements['segments'][number] & { cells: Rect[]; cellsAlt: Rect[] })[];
};

export interface LayoutOptions { stepSec: number; minHeightPx: number; samplesPerSegment: number; cutFloor: number }
export const DEFAULT_LAYOUT: LayoutOptions = { stepSec: 0.5, minHeightPx: 0, samplesPerSegment: 5, cutFloor: 6 };

interface Info { w: number; h: number; fps: number; dur: number }

/** Assinatura por linha: [media(h), desvio(h), vermelho(h)] concatenados. Igual ao assinatura() do .py. */
export function signature(rgb: Uint8Array, w: number, h: number): Float64Array {
  const s = new Float64Array(3 * h);
  for (let y = 0; y < h; y++) {
    let sr = 0, sg = 0, sb = 0, sgray = 0, sgray2 = 0;
    let o = y * w * 3;
    for (let x = 0; x < w; x++, o += 3) {
      const r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
      sr += r; sg += g; sb += b;
      const gray = (r + g + b) / 3;
      sgray += gray; sgray2 += gray * gray;
    }
    const mg = sgray / w;
    s[y] = (sr + sg + sb) / (3 * w);
    s[h + y] = Math.sqrt(Math.max(0, sgray2 / w - mg * mg));
    s[2 * h + y] = sr / w - (sg / w + sb / w) / 2;
  }
  return s;
}

export function sigDistance(a: Float64Array, b: Float64Array): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
  return t / a.length;
}

export function median(v: ArrayLike<number>): number {
  const a = Array.from(v).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function std(v: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length;
  let q = 0;
  for (let i = 0; i < v.length; i++) q += (v[i] - m) ** 2;
  return Math.sqrt(q / v.length);
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface Band { y0: number; y1: number; altura: number; fracao: number; media: number; desvioHorizontal: number; vermelhidao: number }

/** descrever() do .py, a partir da assinatura do frame de referência (média de linhas = média do bloco). */
export function describeBand(sig: Float64Array, h: number, y0: number, y1: number): Band {
  let m = 0, d = 0, v = 0;
  for (let y = y0; y < y1; y++) { m += sig[y]; d += sig[h + y]; v += sig[2 * h + y]; }
  const n = y1 - y0;
  return { y0, y1, altura: n, fracao: r4(n / h), media: r1(m / n), desvioHorizontal: r1(d / n), vermelhidao: r1(v / n) };
}

/** Perfil de gradiente vertical suavizado de uma assinatura (comprimento h-1). np.convolve(mode='same'). */
export function gradientProfile(sig: Float64Array, h: number): Float64Array {
  const g = new Float64Array(h - 1);
  for (let y = 0; y < h - 1; y++) {
    g[y] = (Math.abs(sig[y + 1] - sig[y]) + Math.abs(sig[h + y + 1] - sig[h + y]) + Math.abs(sig[2 * h + y + 1] - sig[2 * h + y])) / 3;
  }
  const k = Math.max(3, Math.floor(h / 200));
  const off = Math.floor((k - 1) / 2);
  const out = new Float64Array(g.length);
  for (let i = 0; i < g.length; i++) {
    let t = 0;
    // full[n] = sum_{m=n-k+1..n} g[m]/k ; same[i] = full[i+off]
    const n = i + off;
    for (let m = n - k + 1; m <= n; m++) if (m >= 0 && m < g.length) t += g[m];
    out[i] = t / k;
  }
  return out;
}

/** achar_faixas() do .py a partir das assinaturas das amostras (ref = amostra do meio). */
export function bandsFromSignatures(sigs: Float64Array[], h: number, minH: number): Band[] {
  if (!sigs.length) return [];
  const perfis = sigs.map((s) => gradientProfile(s, h));
  const L = h - 1;
  const est = new Float64Array(L);
  for (let y = 0; y < L; y++) { let mn = Infinity; for (const p of perfis) mn = Math.min(mn, p[y]); est[y] = mn; }
  const lim = median(est) + 4 * std(est);
  const jan = Math.max(6, Math.floor(h / 80));
  const picos: number[] = [];
  let y = 1;
  while (y < h - 1) {
    const viz = est.subarray(Math.max(0, y - jan), y + jan + 1);
    const nitido = est[y] > 2.5 * median(viz);
    let locMax = -Infinity;
    for (let j = Math.max(0, y - 2); j < Math.min(L, y + 3); j++) locMax = Math.max(locMax, est[j]);
    if (est[y] > lim && nitido && est[y] >= locMax) {
      if (!picos.length || y - picos[picos.length - 1] >= minH) picos.push(y);
      y += Math.floor(minH / 2);
    } else y += 1;
  }
  const ref = sigs[Math.floor(sigs.length / 2)];
  const lims = [0, ...picos, h];
  const faixas: Band[] = [];
  for (let i = 0; i < lims.length - 1; i++) {
    if (lims[i + 1] - lims[i] < minH) continue;
    faixas.push(describeBand(ref, h, lims[i], lims[i + 1]));
  }
  const fund: Band[] = faixas.length ? [faixas[0]] : [];
  for (const f of faixas.slice(1)) {
    const a = fund[fund.length - 1];
    if (Math.abs(a.media - f.media) < 18 && Math.abs(a.vermelhidao - f.vermelhidao) < 20 && Math.abs(a.desvioHorizontal - f.desvioHorizontal) < 12) {
      fund[fund.length - 1] = describeBand(ref, h, a.y0, f.y1);
    } else fund.push(f);
  }
  return fund;
}

/** mesma_estrutura() do .py: as fronteiras das faixas grandes (>= 15%) coincidem. */
export function sameStructure(a: Band[], b: Band[], tol: number, minFrac = 0.15): boolean {
  const main = (fs: Band[]) => fs.filter((f) => f.fracao >= minFrac && f.y0 > 0).map((f) => f.y0);
  const pa = main(a), pb = main(b);
  if (pa.length !== pb.length) return false;
  return pa.every((x, i) => Math.abs(x - pb[i]) <= tol);
}

/** rotular() do .py mapeado pro contrato. O .py não distingue rosto de painel: 'face' fica pra quem olha o frame. */
export function bandRole(f: Band): 'face' | 'panel' | 'caption' | 'unknown' {
  if (f.vermelhidao > 25 && f.fracao < 0.25) return 'caption';
  if (f.desvioHorizontal < 12) return 'unknown';
  return 'panel';
}

/**
 * Instante do corte dentro de uma janela de frames consecutivos: o PRIMEIRO frame cuja distância ao layout antigo
 * passa da meia altura do penhasco (metade da maior distância ao layout antigo vista na janela, incluindo o layout novo).
 * Relativo ao próprio salto, nunca a um número fixo: vale pra corte seco, whip/borrão e flash preto (que volta ou não
 * pro mesmo layout). Devolve o índice do frame (n = nenhum saiu do layout antigo).
 */
export function halfCliffIndex(sigs: Float64Array[], before: Float64Array, after: Float64Array): number {
  const da = sigs.map((s) => sigDistance(s, before));
  const height = Math.max(sigDistance(after, before), ...da);
  if (!(height > 0)) return sigs.length;
  const i = da.findIndex((d) => d >= height / 2);
  return i < 0 ? sigs.length : i;
}

// ---------- leitura de frames ----------
/**
 * Vários frames numa decodificação só (select por índice), entregues um por vez em ordem: substitui um ffmpeg com -ss
 * por amostra (cada seek decodifica do keyframe anterior; no podcast de 49 s eram ~90 seeks). `atSec` → o 1º frame com
 * pts ≥ instante (o mesmo do -ss). O buffer do frame só vale durante o callback.
 */
async function grabMany(bins: Bins, path: string, info: Info, atSec: number[], onFrame: (k: number, f: RgbFrame) => void): Promise<void> {
  if (!atSec.length) return;
  const idx = atSec.map((t) => Math.max(0, Math.ceil(t * info.fps - 1e-6)));
  const uniq = [...new Set(idx)].sort((a, b) => a - b);
  const quem = new Map<number, number[]>();
  idx.forEach((n, k) => quem.set(n, [...(quem.get(n) ?? []), k]));
  const expr = uniq.map((n) => `eq(n\\,${n})`).join('+');
  let i = 0;
  await streamFrames(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-an', '-vf',
    `select='${expr}',scale=${info.w}:${info.h}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  info.w * info.h * 3, (buf) => {
    const n = uniq[i++];
    for (const k of quem.get(n) ?? []) onFrame(k, { data: buf, w: info.w, h: info.h });
  });
}

/** `everySec`: 1 frame por instante da grade (0, passo, 2·passo...), o PRIMEIRO com pts >= instante, igual ao `-ss` do
 *  .py. O filtro fps= escolhe outro frame (conferido por md5), por isso o select com estado. */
function gridSelect(step: number): string {
  return `select='if(gte(t,ld(0)-1e-6),st(0,(floor(t/${step}+1e-6)+1)*${step})*0+1,0)'`;
}

async function scanSigs(bins: Bins, path: string, info: Info, extraArgs: { ss?: number; t?: number; everySec?: number }) {
  const vf = [extraArgs.everySec ? gridSelect(extraArgs.everySec) : null, `scale=${info.w}:${info.h}`].filter(Boolean).join(',');
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (extraArgs.ss !== undefined) args.push('-ss', extraArgs.ss.toFixed(3));
  args.push('-i', path);
  if (extraArgs.t !== undefined) args.push('-t', extraArgs.t.toFixed(3));
  args.push('-an', '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const sigs: Float64Array[] = [];
  await streamFrames(bins.ffmpeg, args, info.w * info.h * 3, (buf) => sigs.push(signature(buf, info.w, info.h)));
  return sigs;
}

export async function measureLayout(bins: Bins, path: string, info: Info, opt: LayoutOptions = DEFAULT_LAYOUT):
  Promise<LayoutMeasure> {
  const { h, dur, fps } = info;
  const minH = opt.minHeightPx || Math.max(8, Math.floor(h * 0.04));

  // 1. cortes candidatos: assinatura a cada passo (stream), salto > max(piso, 4x mediana dos saltos)
  const all = await scanSigs(bins, path, info, { everySec: opt.stepSec });
  const ts: number[] = [];
  const sigs: Float64Array[] = [];
  all.forEach((s, i) => { const t = r3(i * opt.stepSec); if (t < dur - 0.05) { ts.push(t); sigs.push(s); } });
  const dists: number[] = [];
  for (let i = 1; i < sigs.length; i++) dists.push(sigDistance(sigs[i], sigs[i - 1]));
  const base = dists.length ? median(dists) : 0;
  const brutos: [number, number, number][] = [];
  dists.forEach((d, i) => { if (d > Math.max(opt.cutFloor, base * 4)) brutos.push([ts[i], ts[i + 1], i]); });

  // 2. refino: todos os frames da janela, meia altura do penhasco
  const cortes: number[] = [];
  for (const [t0, t1, i] of brutos) {
    const win = await scanSigs(bins, path, info, { ss: t0, t: t1 - t0 + 1 / fps });
    if (win.length < 2) { cortes.push(t1); continue; }
    const k = halfCliffIndex(win, sigs[i], sigs[i + 1]);
    const first = Math.ceil(t0 * fps - 1e-6) / fps; // -ss preciso: o 1º frame é o de pts >= t0
    cortes.push(r3(Math.min(t1, Math.max(t0, first + k / fps))));
  }

  // 3. faixas por segmento bruto
  const marcos = [0, ...cortes, dur];
  type Seg = { inicio: number; fim: number; faixas: Band[] };
  const brutosSeg: Seg[] = [];
  const janelas: [number, number][] = [];
  for (let i = 0; i < marcos.length - 1; i++) if (marcos[i + 1] - marcos[i] >= 0.3) janelas.push([marcos[i], marcos[i + 1]]);
  const instantes = janelas.flatMap(([ini, fim]) => Array.from({ length: opt.samplesPerSegment }, (_, j) => ini + ((fim - ini) * (j + 0.5)) / opt.samplesPerSegment));
  const sigs3: (Float64Array | null)[] = new Array(instantes.length).fill(null);
  await grabMany(bins, path, info, instantes, (k, f) => { sigs3[k] = signature(f.data, info.w, info.h); });
  janelas.forEach(([ini, fim], i) => {
    const ss = sigs3.slice(i * opt.samplesPerSegment, (i + 1) * opt.samplesPerSegment).filter((x): x is Float64Array => !!x);
    brutosSeg.push({ inicio: r3(ini), fim: r3(fim), faixas: bandsFromSignatures(ss, h, minH) });
  });

  // 4. funde vizinhos com a mesma estrutura: o que sobra é corte de LAYOUT; o resto foi troca de conteúdo
  const tol = Math.max(4, Math.floor(h * 0.02));
  const segs: Seg[] = [];
  for (const s of brutosSeg) {
    const last = segs[segs.length - 1];
    if (last && sameStructure(last.faixas, s.faixas, tol)) last.fim = s.fim;
    else segs.push({ ...s });
  }
  const layoutCuts = segs.slice(1).map((s) => s.inicio);
  // Diferença deliberada do .py: segmentos contíguos de 0 ao fim (o .py deixa buraco onde descartou trecho < 0,3 s).
  segs.forEach((s, i) => { s.inicio = i === 0 ? 0 : s.inicio; s.fim = i < segs.length - 1 ? segs[i + 1].inicio : r3(dur); });
  const cuts = [
    ...layoutCuts.map((atSec) => ({ atSec, kind: 'layout' as const })),
    ...cortes.filter((c) => !layoutCuts.includes(r3(c))).map((atSec) => ({ atSec, kind: 'content' as const })),
  ].sort((a, b) => a.atSec - b.atSec);

  // 5. células por segmento final (amostras no miolo do segmento, longe das bordas de corte)
  const segments: LayoutMeasure['segments'] = [];
  // uma decodificação pra todos os segmentos; as células de cada um saem assim que os 5 quadros dele chegam (memória:
  // os quadros de um segmento por vez)
  const inst5 = segs.flatMap((s) => Array.from({ length: opt.samplesPerSegment }, (_, j) => s.inicio + ((s.fim - s.inicio) * (j + 0.5)) / opt.samplesPerSegment));
  const porSeg: RgbFrame[][] = segs.map(() => []);
  const celulas: { cells: Rect[]; cellsAlt: Rect[] }[] = segs.map(() => ({ cells: [{ x: 0, y: 0, w: info.w, h: info.h }], cellsAlt: [{ x: 0, y: 0, w: info.w, h: info.h }] }));
  await grabMany(bins, path, info, inst5, (k, f) => {
    const si = Math.floor(k / opt.samplesPerSegment);
    porSeg[si].push({ data: Uint8Array.from(f.data), w: f.w, h: f.h });
    if (porSeg[si].length === opt.samplesPerSegment) {
      celulas[si] = { cells: cellsFromFrames(porSeg[si]), cellsAlt: cellsFromFrames(porSeg[si], undefined, 'x') };
      porSeg[si] = [];
    }
  });
  porSeg.forEach((fs, si) => { if (fs.length) celulas[si] = { cells: cellsFromFrames(fs), cellsAlt: cellsFromFrames(fs, undefined, 'x') }; });
  for (const [si, s] of segs.entries()) {
    segments.push({
      startSec: s.inicio,
      endSec: s.fim,
      bands: s.faixas.map((f) => ({ y0: f.y0, y1: f.y1, pct: Math.round(f.fracao * 10000) / 100, role: bandRole(f) })),
      cells: celulas[si].cells,
      cellsAlt: celulas[si].cellsAlt,
    });
  }
  return { cuts, segments };
}
