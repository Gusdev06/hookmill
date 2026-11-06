// Texto novo na headline copiada do criativo (troca-texto-queimado-v1 §14.4, §15.5.6, §16.2 A4 e A6, §16.3; fase V1 do
// F1b). Função PURA, sem DOM e sem Node: a mesma resposta no plano (API), no PATCH …/texts, no build, no Player e no web
// enquanto a pessoa digita. Mede pela tabela gerada no Chrome do render (metricas-fontes.ts), nunca pelo navegador.
//
// Escada (para no primeiro degrau que cabe): same → rewrap → shrink (≥ 90 %) → grow (+1 linha) → não coube.
// Depois de caber, nesta ordem: too_long → over_chin (A6) → too_short (exposição E > EXPOSICAO_MAX, só no solto).
//
// Os tipos abaixo espelham contratos/src/troca-texto.ts (o @maquina/video não depende do @maquina/contratos); o
// test/ajuste-headline.spec.ts prova que são iguais. Se um mudar, o outro muda junto.
import { FONT_CATALOG, type FontId } from './remix';
import { METRIC_CHARS, METRIC_FONTS, METRIC_FONTS_COPY, METRIC_INK, METRIC_UNITS } from './metricas-fontes';

export interface HeadlineFitRect { x: number; y: number; w: number; h: number }

/** = HeadlineFitLook do contrato. Px na grade do campeão. */
export interface HeadlineFitLook {
  kind: 'box' | 'loose';
  canvas: { width: number; height: number };
  fontId: FontId; sizePx: number; letterSpacingEm: number; linePitchPx: number; firstBaselineY: number;
  align: 'left' | 'center' | 'right';
  /** centro único pela mediana dos centros das linhas, emoji incluído (§16.2 A4). null se `align` não for center */
  centerX: number | null;
  caseStyle: 'upper' | 'sentence' | 'title';
  /** contagem e largura de cada linha do original (largura do texto, sem o emoji): alvo da IA */
  originalLines: { chars: number; widthPx: number }[];
  /** retângulos do texto apagado, um por linha, sem o emoji. [] em `box`, que não expõe nada */
  erasedRects: HeadlineFitRect[];
  bottomLimitY: number | null;
  chinY: number | null;
  sideMarginPx: number;
  emoji: { widthPx: number; gapPx: number; lineIndex: number; side: 'start' | 'end' } | null;
  box: HeadlineFitRect | null;
}
export type HeadlineFitStep = 'same' | 'rewrap' | 'shrink' | 'grow';
export type HeadlineFitReject = 'too_long' | 'too_short' | 'over_chin';
/** = HeadlineFitResult do contrato. */
export interface HeadlineFitResult {
  fits: boolean;
  step: HeadlineFitStep | null;
  reject: HeadlineFitReject | null;
  lines: string[];
  sizePx: number;
  boxGrowPx: number;
  firstBaselineY: number;
  exposure: number;
  chinGapPx: number | null;
}

/** Limite provisório de exposição do texto apagado (§16.3): entre a aprovada (0,029) e a curta (0,334), 1 vídeo. */
export const EXPOSICAO_MAX = 0.15;
/** Piso do degrau `shrink` (§14.4): abaixo disso a letra muda de cara. */
export const ENCOLHER_MIN = 0.9;
/** A6: folga mínima entre o queixo e o topo da tinta nova, em fração do corpo, quando a tinta sobe. */
export const QUEIXO_MIN_CORPO = 0.5;
/** Margem lateral do solto (§16.3), em fração da largura, quando o `look` não trouxer outra. */
export const MARGEM_SOLTO = 0.05;
/** Degrau `same`: a linha nova pode passar da maior linha original até a régua de largura `same` da caixa (§16.2). */
const FOLGA_SAME = 0.035;
/** Dilatação da linha nova na conta de E: 3 px a 464 de largura (§16.3), escalada pela largura do quadro. */
const dilatacaoExposicao = (w: number) => (3 * w) / 464;

// ───────────────────────── medida ─────────────────────────

type Tabela = { adv: Map<string, number>; kern: Map<string, number>; top: Map<string, number>; bot: Map<string, number> };
const tabelas = new Map<FontId, Tabela>();
const tabela = (f: FontId): Tabela => {
  let t = tabelas.get(f);
  if (!t) {
    const m = (METRIC_FONTS_COPY as Record<string, { adv: readonly number[]; kern: string }>)[f]
      ?? (METRIC_FONTS as Record<string, { adv: readonly number[]; kern: string }>)[f];
    const ink = (METRIC_INK as Record<string, { top: readonly number[]; bot: readonly number[] }>)[f];
    if (!m || !ink) throw new Error(`fonte sem tabela de métrica: ${f} (rode video/scripts/metricas-fontes.mjs)`);
    const adv = new Map<string, number>(), top = new Map<string, number>(), bot = new Map<string, number>();
    [...METRIC_CHARS].forEach((c, i) => { adv.set(c, m.adv[i]); top.set(c, ink.top[i]); bot.set(c, ink.bot[i]); });
    const kern = new Map<string, number>();
    for (const e of m.kern.split('\u0001')) if (e.length > 2) kern.set(e.slice(0, 2), Number(e.slice(2)));
    t = { adv, kern, top, bot };
    tabelas.set(f, t);
  }
  return t;
};
const base = (c: string) => c.normalize('NFD')[0] ?? c;
const doMapa = (m: Map<string, number>, c: string, reserva: string) => m.get(c) ?? m.get(base(c)) ?? m.get(reserva)!;

/** Largura de layout em px (o span com white-space: pre; letter-spacing somado depois de cada caractere). Modelo linear,
 *  o mesmo do fitText das molduras. Erro contra o Chrome Linux do render: cabeçalho de metricas-fontes.ts. */
export const larguraCopia = (fontId: FontId, texto: string, sizePx: number, letterSpacingEm = 0): number => {
  const t = tabela(fontId);
  const cs = [...texto];
  let w = 0;
  for (let i = 0; i < cs.length; i++) {
    w += doMapa(t.adv, cs[i], 'M');
    if (i) w += t.kern.get(cs[i - 1] + cs[i]) ?? t.kern.get(base(cs[i - 1]) + base(cs[i])) ?? 0;
  }
  return (w * sizePx) / METRIC_UNITS + cs.length * letterSpacingEm * sizePx;
};

/** Tinta da linha: px acima (`top`) e abaixo (`bot`) da linha de base. Linha sem tinta = 0, 0. */
export const tintaCopia = (fontId: FontId, texto: string, sizePx: number): { top: number; bot: number } => {
  const t = tabela(fontId);
  let top = 0, bot = 0;
  for (const c of texto) {
    if (/\s/.test(c)) continue;
    top = Math.max(top, doMapa(t.top, c, 'H'));
    bot = Math.max(bot, doMapa(t.bot, c, 'H'));
  }
  return { top: (top * sizePx) / METRIC_UNITS, bot: (bot * sizePx) / METRIC_UNITS };
};

// ───────────────────────── geometria ─────────────────────────

const areaUniao = (rs: HeadlineFitRect[]): number => {
  const v = rs.filter((r) => r.w > 0 && r.h > 0);
  if (!v.length) return 0;
  const xs = [...new Set(v.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const faixas = v.filter((r) => r.x <= x0 && r.x + r.w >= x1).map((r) => [r.y, r.y + r.h] as const).sort((a, b) => a[0] - b[0]);
    let alt = 0, ini = -Infinity, fim = -Infinity;
    for (const [a, b] of faixas) {
      if (a > fim) { alt += fim - ini > 0 ? fim - ini : 0; ini = a; fim = b; } else fim = Math.max(fim, b);
    }
    alt += fim - ini > 0 ? fim - ini : 0;
    area += alt * (x1 - x0);
  }
  return area;
};
const intersecao = (a: HeadlineFitRect, b: HeadlineFitRect): HeadlineFitRect | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};

/** Uma linha posta no quadro. `textX` = borda esquerda do texto (sem o emoji). */
interface LinhaPosta { text: string; baseline: number; textX: number; textW: number; totalX: number; totalW: number; top: number; bot: number }
interface Disposicao { linhas: LinhaPosta[]; sizePx: number; firstBaselineY: number; inkTop: number; inkBottom: number; boxGrowPx: number; boxTop: number | null; boxBottom: number | null }
type Vertical = 'center' | 'up' | 'down';

const linhaDoEmoji = (fit: HeadlineFitLook, k: number): number | null => {
  if (!fit.emoji) return null;
  const n0 = fit.originalLines.length;
  // última linha do original → última da nova; primeira → primeira; senão a mesma posição, limitada
  if (fit.emoji.lineIndex >= n0 - 1) return k - 1;
  if (fit.emoji.lineIndex <= 0) return 0;
  return Math.min(fit.emoji.lineIndex, k - 1);
};

const limitesX = (fit: HeadlineFitLook) => {
  const side = fit.sideMarginPx;
  return fit.box ? { L: fit.box.x + side, R: fit.box.x + fit.box.w - side } : { L: side, R: fit.canvas.width - side };
};
const ancoraX = (fit: HeadlineFitLook) => {
  const { L, R } = limitesX(fit);
  if (fit.align === 'center') return fit.centerX ?? (fit.box ? fit.box.x + fit.box.w / 2 : fit.canvas.width / 2);
  const er = fit.erasedRects;
  if (fit.align === 'left') return !fit.box && er.length ? Math.min(...er.map((r) => r.x)) : L;
  return !fit.box && er.length ? Math.max(...er.map((r) => r.x + r.w)) : R;
};

/** Larguras de cada linha com o emoji (o centro único da A4 inclui o emoji na linha dele). */
const extraEmoji = (fit: HeadlineFitLook, i: number, k: number) => (fit.emoji && linhaDoEmoji(fit, k) === i ? fit.emoji.gapPx + fit.emoji.widthPx : 0);

const dispor = (fit: HeadlineFitLook, linhas: string[], sizePx: number, vertical: Vertical): Disposicao => {
  const k = linhas.length, n0 = fit.originalLines.length;
  const escala = sizePx / fit.sizePx;
  const pitch0 = fit.linePitchPx, pitch = pitch0 * escala;
  const meio0 = fit.firstBaselineY + ((n0 - 1) * pitch0) / 2;
  const ultima0 = fit.firstBaselineY + (n0 - 1) * pitch0;
  const first = vertical === 'up' ? ultima0 - (k - 1) * pitch : vertical === 'down' ? fit.firstBaselineY : meio0 - ((k - 1) * pitch) / 2;
  const ax = ancoraX(fit);
  const postas = linhas.map((text, i): LinhaPosta => {
    const textW = larguraCopia(fit.fontId, text, sizePx, fit.letterSpacingEm);
    const extra = extraEmoji(fit, i, k);
    const totalW = textW + extra;
    const totalX = fit.align === 'center' ? ax - totalW / 2 : fit.align === 'left' ? ax : ax - totalW;
    const textX = extra && fit.emoji!.side === 'start' ? totalX + extra : totalX;
    const { top, bot } = tintaCopia(fit.fontId, text, sizePx);
    return { text, baseline: first + i * pitch, textX, textW, totalX, totalW, top, bot };
  });
  const inkTop = Math.min(...postas.map((l) => l.baseline - l.top));
  const inkBottom = Math.max(...postas.map((l) => l.baseline + l.bot));
  // caixa: cresce 1 entrelinha por linha a mais, na direção da `vertical`
  let boxGrowPx = 0, boxTop: number | null = null, boxBottom: number | null = null;
  if (fit.box) {
    boxGrowPx = k > n0 ? Math.round((k - n0) * pitch - (n0 * (pitch0 - pitch))) : 0;
    if (boxGrowPx < 0) boxGrowPx = 0;
    const cima = vertical === 'up' ? boxGrowPx : vertical === 'down' ? 0 : boxGrowPx / 2;
    boxTop = fit.box.y - cima;
    boxBottom = fit.box.y + fit.box.h + (boxGrowPx - cima);
  }
  return { linhas: postas, sizePx, firstBaselineY: first, inkTop, inkBottom, boxGrowPx, boxTop, boxBottom };
};

/** `folga`: px a mais nos dois lados (só no degrau `same`), sem passar da borda da caixa ou do quadro. A margem do look é
 *  medida na TINTA da linha mais larga, e a largura da tabela é de avanço (com o respiro lateral das letras): sem isso, as
 *  mesmas palavras no mesmo tamanho estouravam a margem por 2-10 px e caíam no `shrink` (V3, fixtures da S4: 98-99 %). */
const cabeNaLargura = (fit: HeadlineFitLook, d: Disposicao, limiteTotal: number | null, folga = 0): boolean => {
  const { L, R } = limitesX(fit);
  const borda = fit.box ? { L: fit.box.x, R: fit.box.x + fit.box.w } : { L: 0, R: fit.canvas.width };
  const l0 = Math.max(borda.L, L - folga), r0 = Math.min(borda.R, R + folga);
  const eps = 0.5;
  return d.linhas.every((l) => l.totalX >= l0 - eps && l.totalX + l.totalW <= r0 + eps && (limiteTotal === null || l.totalW <= limiteTotal + eps));
};
const cabeNaAltura = (fit: HeadlineFitLook, d: Disposicao): boolean => {
  const topo = d.boxTop ?? d.inkTop, fundo = d.boxBottom ?? d.inkBottom;
  if (topo < 0 || fundo > fit.canvas.height) return false;
  // texto nunca desce em direção à legenda (§16.2 A6): a parte de baixo respeita `bottomLimitY`
  if (fit.bottomLimitY !== null && fundo > fit.bottomLimitY) return false;
  return true;
};

// ───────────────────────── quebra ─────────────────────────

/** Quebra balanceada em exatamente k linhas: menor linha mais larga; empate = linhas mais parecidas. */
const quebrar = (fit: HeadlineFitLook, palavras: string[], k: number, sizePx: number): string[] | null => {
  const n = palavras.length;
  if (k < 1 || k > n) return null;
  const larg = (i: number, j: number, linha: number) =>
    larguraCopia(fit.fontId, palavras.slice(i, j).join(' '), sizePx, fit.letterSpacingEm) + extraEmoji(fit, linha, k);
  // melhor[l][j] = [max, somaQuadrados, corte] usando l+1 linhas para as primeiras j palavras
  const melhor: ([number, number, number] | null)[][] = Array.from({ length: k }, () => Array<[number, number, number] | null>(n + 1).fill(null));
  for (let j = 1; j <= n - (k - 1); j++) { const w = larg(0, j, 0); melhor[0][j] = [w, w * w, 0]; }
  for (let l = 1; l < k; l++) {
    for (let j = l + 1; j <= n - (k - 1 - l); j++) {
      let bom: [number, number, number] | null = null;
      for (let i = l; i < j; i++) {
        const ant = melhor[l - 1][i];
        if (!ant) continue;
        const w = larg(i, j, l);
        const c: [number, number, number] = [Math.max(ant[0], w), ant[1] + w * w, i];
        if (!bom || c[0] < bom[0] - 1e-6 || (Math.abs(c[0] - bom[0]) <= 1e-6 && c[1] > bom[1])) bom = c;
      }
      melhor[l][j] = bom;
    }
  }
  if (!melhor[k - 1][n]) return null;
  const linhas: string[] = [];
  let j = n;
  for (let l = k - 1; l >= 0; l--) {
    const i = l === 0 ? 0 : melhor[l][j]![2];
    linhas.unshift(palavras.slice(i, j).join(' '));
    j = i;
  }
  return linhas;
};

const aplicarCaixa = (texto: string, c: HeadlineFitLook['caseStyle']) => (c === 'upper' ? texto.toUpperCase() : texto);

// ───────────────────────── exposição e queixo ─────────────────────────

/** E = 1 − área(apagado ∩ linhas novas dilatadas) ÷ área(apagado) (§16.3). Só no solto; caixa = 0. */
const exposicaoDe = (fit: HeadlineFitLook, d: Disposicao): number => {
  if (fit.kind === 'box' || !fit.erasedRects.length) return 0;
  const total = areaUniao(fit.erasedRects);
  if (total <= 0) return 0;
  const dil = dilatacaoExposicao(fit.canvas.width);
  const novas = d.linhas.filter((l) => l.textW > 0 && l.top + l.bot > 0)
    .map((l) => ({ x: l.textX - dil, y: l.baseline - l.top - dil, w: l.textW + 2 * dil, h: l.top + l.bot + 2 * dil }));
  const cobertas = fit.erasedRects.flatMap((e) => novas.map((n) => intersecao(e, n)).filter((r): r is HeadlineFitRect => !!r));
  return Math.max(0, Math.min(1, 1 - areaUniao(cobertas) / total));
};

/** Topo do bloco original: o texto apagado (solto) ou a caixa. */
const topoOriginal = (fit: HeadlineFitLook): number => {
  if (fit.box) return fit.box.y;
  if (fit.erasedRects.length) return Math.min(...fit.erasedRects.map((r) => r.y));
  return fit.firstBaselineY - tintaCopia(fit.fontId, 'H', fit.sizePx).top;
};

/**
 * A6 (§16.2): quando a tinta nova (ou a caixa que cresce) passa acima do topo do bloco original, o topo precisa ficar a
 * ≥ 0,5 × corpo do queixo. `gap` = topo − chinY (px); null sem rosto.
 */
const queixo = (fit: HeadlineFitLook, d: Disposicao): { gap: number | null; violou: boolean } => {
  if (fit.chinY === null) return { gap: null, violou: false };
  const topo = d.boxTop ?? d.inkTop;
  const gap = topo - fit.chinY;
  const subiu = topo < topoOriginal(fit) - 0.5;
  return { gap: Math.round(gap * 100) / 100, violou: subiu && gap < QUEIXO_MIN_CORPO * d.sizePx };
};

// ───────────────────────── a função ─────────────────────────

const direcaoDaCaixa = (fit: HeadlineFitLook): Vertical => {
  // §14.4 degrau 3: pra baixo se encosta no topo, pra cima se encosta embaixo, senão pros dois lados
  const b = fit.box!, H = fit.canvas.height, encosta = 0.02 * H;
  if (b.y <= encosta) return 'down';
  if (b.y + b.h >= H - encosta) return 'up';
  return 'center';
};

const resultado = (fit: HeadlineFitLook, d: Disposicao, step: HeadlineFitStep | null, reject: HeadlineFitReject | null, exposure: number, chinGapPx: number | null): HeadlineFitResult => ({
  fits: reject === null && step !== null,
  step: reject === null ? step : null,
  reject,
  lines: d.linhas.map((l) => l.text),
  sizePx: Math.round(d.sizePx * 100) / 100,
  boxGrowPx: d.boxGrowPx,
  firstBaselineY: Math.round(d.firstBaselineY * 100) / 100,
  exposure: Math.round(exposure * 1000) / 1000,
  chinGapPx,
});

/**
 * Ajusta `texto` (sem emoji: o emoji é da peça) ao `look` medido do original. `\n` no texto = quebras escolhidas (a
 * escada só muda o tamanho); sem `\n`, a quebra é balanceada com o nº de linhas do original. Nunca aumenta a letra.
 * Com menos linhas, o bloco fica centrado na altura do original; no `grow` do solto, a linha a mais sobe.
 */
export function ajustarHeadlineCopia(fit: HeadlineFitLook, texto: string): HeadlineFitResult {
  if (!Object.prototype.hasOwnProperty.call(FONT_CATALOG, fit.fontId)) throw new Error(`fontId fora do catálogo: ${fit.fontId}`);
  const n0 = Math.max(1, fit.originalLines.length);
  const limpo = aplicarCaixa(texto.replace(/\r/g, '').trim(), fit.caseStyle);
  const explicitas = limpo.includes('\n') ? limpo.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean) : null;
  const palavras = limpo.split(/\s+/).filter(Boolean);
  const vazio = (): HeadlineFitResult => resultado(fit, dispor(fit, [''], fit.sizePx, 'center'), null, 'too_short', 1, null);
  if (!palavras.length) return vazio();

  const k0 = explicitas ? explicitas.length : Math.min(n0, palavras.length);
  const linhasCom = (k: number, s: number) => explicitas ?? quebrar(fit, palavras, k, s);
  const extraOriginal = (i: number) => (fit.emoji && fit.emoji.lineIndex === i ? fit.emoji.gapPx + fit.emoji.widthPx : 0);
  const maisLarga = Math.max(...fit.originalLines.map((l, i) => l.widthPx + extraOriginal(i)));
  const limiteSame = maisLarga * (1 + FOLGA_SAME);

  let achou: { d: Disposicao; step: HeadlineFitStep } | null = null;
  let ultima: Disposicao | null = null;
  const tentar = (k: number, s: number, vertical: Vertical, limiteTotal: number | null, folga = 0): Disposicao | null => {
    const linhas = linhasCom(k, s);
    if (!linhas) return null;
    const d = dispor(fit, linhas, s, vertical);
    ultima = d;
    return cabeNaLargura(fit, d, limiteTotal, folga) && cabeNaAltura(fit, d) ? d : null;
  };

  // 0 same (a mesma folga da régua de largura, metade de cada lado), 1 rewrap
  const s0 = fit.sizePx;
  let d = tentar(k0, s0, 'center', limiteSame, (limiteSame - maisLarga) / 2);
  if (d) achou = { d, step: 'same' };
  if (!achou && (d = tentar(k0, s0, 'center', null))) achou = { d, step: 'rewrap' };
  // 2 shrink, de 1 % em 1 % até 90 %
  for (let p = 99; !achou && p >= ENCOLHER_MIN * 100; p--) {
    if ((d = tentar(k0, (s0 * p) / 100, 'center', null))) achou = { d, step: 'shrink' };
  }
  // 3 grow: +1 linha (só com quebra automática), tamanho de 100 % a 90 %
  if (!achou && !explicitas && palavras.length > k0) {
    const vertical: Vertical = fit.box ? direcaoDaCaixa(fit) : 'up';
    for (let p = 100; !achou && p >= ENCOLHER_MIN * 100; p--) {
      if ((d = tentar(k0 + 1, (s0 * p) / 100, vertical, null))) achou = { d, step: 'grow' };
    }
  }
  if (!achou) {
    const dd = (ultima as Disposicao | null) ?? dispor(fit, explicitas ?? [palavras.join(' ')], s0, 'center');
    return resultado(fit, dd, null, 'too_long', exposicaoDe(fit, dd), queixo(fit, dd).gap);
  }
  const q = queixo(fit, achou.d);
  const e = exposicaoDe(fit, achou.d);
  if (q.violou) return resultado(fit, achou.d, achou.step, 'over_chin', e, q.gap);
  if (e > EXPOSICAO_MAX) return resultado(fit, achou.d, achou.step, 'too_short', e, q.gap);
  return resultado(fit, achou.d, achou.step, null, e, q.gap);
}

/** E de linhas já quebradas, no tamanho do original e centradas na altura dele (prova e calibração do G1). */
export const exposicaoDeLinhas = (fit: HeadlineFitLook, linhas: string[]): number =>
  exposicaoDe(fit, dispor(fit, linhas.map((l) => aplicarCaixa(l, fit.caseStyle)), fit.sizePx, linhas.length > fit.originalLines.length ? 'up' : 'center'));
