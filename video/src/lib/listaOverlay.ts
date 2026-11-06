// Templates de lista `versus` e `value-stack` (docs/contratos/templates-lista-v1.md §3; spec design/templates-ruimbom-lista-2026-11-04.md,
// protótipo aprovado pelo Gusta em 04/11). Um motor (`ListOverlay`): o vídeo do campeão fica inteiro, com áudio, e a lista
// enche no ritmo da fala no espaço livre entre o queixo e a legenda queimada (`body`); sem espaço, painel no topo e vídeo
// numa caixa embaixo (`top`); no 1:1, vídeo à esquerda e painel à direita (`side`). Sem a nossa legenda (v1).
// PURO (sem React): schema zod das props, `needLista`, `posicionarLista`, `agendaLista`, `medirLista` e a geometria do
// painel (`geometriaLista`), a mesma que a composição desenha.
import { z } from 'zod';
import { protectedBandSchema, type ProtectedBand } from './captionsSchema';
import { FORMATOS, type VideoFormat } from './formatos';
import { enquadramentosPreservandoLegenda } from './legendaProtegida';
import { cjkDe, fitText, frameReframeSchema, pinturaNaCaixa, type FittedText, type FrameReframe, type MolduraProps, type Rect } from './molduras';

export const LIST_TEMPLATE_IDS = ['versus', 'value-stack'] as const;
export type ListTemplateIdV = (typeof LIST_TEMPLATE_IDS)[number];
export type ListMode = 'two-col' | 'one-col' | 'stack';
export type ListLook = 'ink' | 'paper' | 'brand';
export type ListOrder = 'by_speech' | 'alternate';
export type ListSide = 'bad' | 'good';
export type ListKind = 'item' | 'proof' | 'price' | 'cta';
export interface TranscriptWordLike { word: string; startSec: number; endSec: number }

/** Limite de interface do app (topo / base) por formato (§3.1 da spec). */
export const LISTA_UI: Record<VideoFormat, { top: number; bottom: number }> = {
  VERTICAL_9_16: { top: 200, bottom: 340 },
  PORTRAIT_4_5: { top: 60, bottom: 110 },
  SQUARE_1_1: { top: 50, bottom: 50 },
};
/** Piso de fonte (§9 do contrato: abaixo dos 36 px das molduras, como no protótipo). */
export const LISTA_PISO = { versus: 30, stack: 26 } as const;
/** Máximo de caracteres por peça (§2.1). */
export const LISTA_MAX = { head: 14, cell: 24, title: 18, item: 30, proof: 30, price: 34, cta: 22 } as const;
/** Painel: margem lateral e largura no `body`/`top`. */
export const LISTA_PAINEL = { x: 56, w: 968 } as const;
/** Fundo nas sobras (top/side). */
export const LISTA_FUNDO = '#0B0A10';

// ───────────────────────── schema ─────────────────────────

const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export const fittedTextSchema = z.object({
  text: z.string(), size: z.number().positive(), lineHeight: z.number().positive(), lines: z.array(z.string()),
  fits: z.boolean(), overflow: z.enum(['lines', 'word']).nullable(), height: z.number().min(0),
  ranges: z.array(z.tuple([z.number(), z.number()])).optional(),
});
/** Vídeo pintado numa caixa (px da saída): cover da `contentBox` com o `reframe` (= pinturaNaCaixa das molduras). */
const videoNaCaixaSchema = z.object({ box: rectSchema, contentBox: rectSchema.nullable(), reframe: frameReframeSchema });
export type CoverFit = z.infer<typeof videoNaCaixaSchema>;
/** No top/side o vídeo vai numa caixa menor; `frame` = como ele é pintado nela. */
export type MolduraVideo = Omit<CoverFit, 'box'>;
export const listPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('body'), reason: z.enum(['free_below_face', 'below_captions', 'no_captions']), video: videoNaCaixaSchema, panel: rectSchema, maxPairs: z.union([z.literal(3), z.literal(4)]) }),
  z.object({ mode: z.literal('top'), reason: z.literal('small_zone'), video: z.object({ box: rectSchema, frame: videoNaCaixaSchema.omit({ box: true }) }), panel: rectSchema, scale: z.number(), maxPairs: z.literal(3) }),
  z.object({ mode: z.literal('side'), reason: z.literal('square'), video: z.object({ box: rectSchema, frame: videoNaCaixaSchema.omit({ box: true }) }), panel: rectSchema, maxPairs: z.literal(3) }),
  z.object({ mode: z.literal('none'), reason: z.enum(['burned_captions', 'no_room']) }),
]);
export type ListPlacement = z.infer<typeof listPlacementSchema>;
export type ListPlacementComLugar = Exclude<ListPlacement, { mode: 'none' }>;

const lineSchema = z.object({
  id: z.string().min(1),
  side: z.enum(['bad', 'good']).nullable(),
  kind: z.enum(['item', 'proof', 'price', 'cta']),
  text: z.string().min(1),
  atSec: z.number().min(0),
  fit: fittedTextSchema,
});
export const listOverlayPropsSchema = z.object({
  mode: z.enum(['two-col', 'one-col', 'stack']),
  look: z.enum(['ink', 'paper', 'brand']),
  /** FrameBrand.color, já legível no escuro (coresDaMarca) */
  brandColor: z.string().min(4),
  /** vídeo inteiro, com áudio, sem corte */
  source: z.object({ videoUrl: z.string().min(1), width: z.number().positive(), height: z.number().positive(), fps: z.number().positive(), durationSec: z.number().positive() }),
  /** px da fonte (o que entrou no posicionarLista) */
  guard: z.object({ faceSafeBand: rectSchema.nullable(), protectedBands: z.array(protectedBandSchema) }),
  placement: listPlacementSchema,
  heads: z.object({ bad: z.string().min(1), good: z.string().min(1) }).nullable(),
  title: z.string().min(1).nullable(),
  lines: z.array(lineSchema).min(1).max(8),
  sfx: z.object({ pop: z.string(), ding: z.string() }).nullable(),
});
export type ListOverlayProps = z.infer<typeof listOverlayPropsSchema>;
export type ListLineProps = ListOverlayProps['lines'][number];

/** Confere a coerência (o zod não pega): modo × template, lados/tipos, posição, tempos dentro do vídeo. */
export const validarListOverlay = (templateId: ListTemplateIdV, p: ListOverlayProps): string[] => {
  const v: string[] = [];
  if (templateId === 'versus' && p.mode === 'stack') v.push('versus_mode');
  if (templateId === 'value-stack' && p.mode !== 'stack') v.push('stack_mode');
  if (p.placement.mode === 'none') v.push('placement_none');
  if (p.mode === 'stack') {
    if (p.lines.some((l) => l.side !== null)) v.push('stack_side');
    if (p.lines.length > 5) v.push('stack_bars');
  } else {
    if (p.lines.some((l) => l.side === null || l.kind !== 'item')) v.push('versus_shape');
    if (p.mode === 'two-col' && !p.heads) v.push('versus_heads');
  }
  if (p.lines.some((l) => l.atSec > p.source.durationSec + 0.05)) v.push('line_after_end');
  return v;
};

// ───────────────────────── need ─────────────────────────

/** Altura mínima do conteúdo (px da saída, §3.1): 2 col = cabeçalho 60 + 12 + linhas × 64 + gaps 10 (3 linhas = 284);
 *  1 col = células × 54 + gaps 8 (6 = 364); stack = título 48 + 12 + barras × 56 + gaps 8 (5 = 372). */
export function needLista(mode: ListMode, rows: number): number {
  const n = Math.max(1, rows);
  if (mode === 'two-col') return 60 + 12 + n * 64 + (n - 1) * 10;
  if (mode === 'one-col') return n * 54 + (n - 1) * 8;
  return 48 + 12 + n * 56 + (n - 1) * 8;
}
/** Linhas que entram no `need` (pares no 2 col; células no 1 col; barras no stack). */
export const linhasDoNeed = (mode: ListMode, lines: { side: ListSide | null }[]): number =>
  mode === 'two-col' ? Math.max(3, ...(['bad', 'good'] as const).map((s) => lines.filter((l) => l.side === s).length)) : mode === 'one-col' ? Math.max(6, lines.length) : Math.max(5, lines.length);

// ───────────────────────── posicionarLista ─────────────────────────

type Fonte = { width: number; height: number; durationSec: number };
const videoFake = (source: Fonte, faceSafeBand: Rect | null, protectedBands: ProtectedBand[]): MolduraProps['video'] => ({
  source: { videoUrl: 'x', width: source.width, height: source.height, fps: 30, durationSec: source.durationSec, hasAudio: true },
  timeline: [{ startSec: 0, endSec: source.durationSec }], joinFadeMs: 40,
  reframe: { mode: 'cover', focus: { x: 0.5, y: faceSafeBand ? (faceSafeBand.y + faceSafeBand.h / 2) / source.height : 0.4 } },
  contentBox: null, protectedBands, ...(faceSafeBand ? { faceSafeBand } : {}),
} as MolduraProps['video']);

/** Enquadramento do vídeo numa caixa: cover com o foco deslizando até rosto + legenda caberem (o mesmo das molduras). */
const enquadrar = (source: Fonte, faceSafeBand: Rect | null, protectedBands: ProtectedBand[], box: { w: number; h: number }): { contentBox: Rect | null; reframe: FrameReframe } => {
  const [c] = enquadramentosPreservandoLegenda(videoFake(source, faceSafeBand, protectedBands), box);
  if (c) return { contentBox: c.contentBox ?? null, reframe: c.reframe };
  return { contentBox: null, reframe: { mode: 'cover', focus: { x: 0.5, y: 0.4 } } };
};

/** Retângulo da fonte (px) na saída, pela pintura do vídeo na caixa. */
export const fonteNaSaida = (r: Rect, source: { width: number; height: number }, v: CoverFit): Rect => {
  const C = v.contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  const pt = pinturaNaCaixa(v.box, source, v.reframe, v.contentBox);
  return { x: v.box.x + pt.area.left + (r.x - C.x) * pt.s, y: v.box.y + pt.area.top + (r.y - C.y) * pt.s, w: r.w * pt.s, h: r.h * pt.s };
};
/** Caixa do vídeo (CoverFit) de qualquer posição. */
export const videoDaLista = (p: ListPlacementComLugar): CoverFit => (p.mode === 'body' ? p.video : { box: p.video.box, ...p.video.frame });

const unir = (bs: { x: number; y: number; w: number; h: number }[]): Rect | null => {
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
};
const r1 = (v: number) => Math.round(v);
const rr = (r: Rect): Rect => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) });

/**
 * Onde o painel fica (§3.1). Faixa protegida = união no vídeo inteiro (o painel é estático). Ordem: `body` (cover, zona
 * livre entre o queixo + 30 e a legenda − 20; legenda no meio = abaixo dela + 20; sem legenda = até o limite de UI) →
 * `top` (painel no topo, vídeo encolhido numa caixa embaixo; escala < 0,6 = sem lugar) → `none`. 1:1 = `side`.
 */
export function posicionarLista(i: { format: VideoFormat; source: Fonte; faceSafeBand: Rect | null; protectedBands: ProtectedBand[]; need: number }): ListPlacement {
  const { width: W, height: H } = FORMATOS[i.format];
  const ui = LISTA_UI[i.format];
  const semLugar: ListPlacement = { mode: 'none', reason: i.protectedBands.length ? 'burned_captions' : 'no_room' };
  const U = unir(i.protectedBands);
  const coverCanvas = Math.max(W / i.source.width, H / i.source.height);
  const escalaDe = (v: CoverFit) => pinturaNaCaixa(v.box, i.source, v.reframe, v.contentBox).s / coverCanvas;

  if (i.format === 'SQUARE_1_1') {
    const box = { x: 0, y: 0, w: 600, h: H };
    const frame = enquadrar(i.source, i.faceSafeBand, i.protectedBands, box);
    // escala em relação ao cover da própria caixa (afastou demais pra caber rosto + legenda = sem lugar)
    if (pinturaNaCaixa(box, i.source, frame.reframe, frame.contentBox).s < Math.max(box.w / i.source.width, box.h / i.source.height) * 0.6) return semLugar;
    const panel = { x: 630, y: 70, w: 410, h: H - 140 };
    if (panel.h < i.need) return semLugar;
    return { mode: 'side', reason: 'square', video: { box, frame }, panel, maxPairs: 3 };
  }

  // body: vídeo em cover no quadro inteiro
  const canvas = { x: 0, y: 0, w: W, h: H };
  const fb = { box: canvas, ...enquadrar(i.source, i.faceSafeBand, i.protectedBands, canvas) };
  const rosto = i.faceSafeBand ? fonteNaSaida(i.faceSafeBand, i.source, fb) : null;
  const queixo = rosto ? rosto.y + rosto.h : 0.45 * H - 30;
  const topoRosto = rosto ? rosto.y : 0.45 * H - 30;
  const faixa = U ? fonteNaSaida(U, i.source, fb) : null;
  // intervalos proibidos (y da saída): UI de cima/baixo, rosto (até o queixo + 30), faixa (± 20)
  const proibido: [number, number][] = [[0, ui.top], [Math.min(topoRosto, queixo), queixo + 30], [H - ui.bottom, H]];
  if (faixa) proibido.push([faixa.y - 20, faixa.y + faixa.h + 20]);
  proibido.sort((a, b) => a[0] - b[0]);
  const livres: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of proibido) { if (a > cur) livres.push([cur, a]); cur = Math.max(cur, b); }
  if (cur < H) livres.push([cur, H]);
  // só abaixo do rosto (a zona livre do UGC é o peito/fundo), de cima pra baixo: a primeira que cabe
  const zona = livres.filter(([a]) => a >= queixo + 30 - 0.5).find(([a, b]) => b - a >= i.need);
  if (zona) {
    const [a, b] = zona;
    const zh = b - a;
    const h = Math.min(zh, Math.round(i.need * 1.45));
    const reason = !faixa ? 'no_captions' : faixa.y + faixa.h + 20 <= a + 0.5 ? 'below_captions' : 'free_below_face';
    return { mode: 'body', reason, video: { ...fb, box: canvas }, panel: rr({ x: LISTA_PAINEL.x, y: a + (zh - h) / 2, w: LISTA_PAINEL.w, h }), maxPairs: zh >= 480 ? 4 : 3 };
  }

  // top: painel no topo, vídeo numa caixa embaixo, encolhido até rosto + legenda caberem inteiros
  const pt = i.format === 'VERTICAL_9_16' ? 170 : 50;
  const ph = Math.round(i.need * (i.format === 'VERTICAL_9_16' ? 1.3 : 1.05)); // 4:5: 1,05 como no protótipo aprovado (sem isso o vídeo não cabe)
  const vt = pt + ph + 28;
  if (vt >= H - 100) return semLugar;
  const box = { x: 0, y: vt, w: W, h: H - vt };
  const frame = enquadrar(i.source, i.faceSafeBand, i.protectedBands, box);
  const scale = escalaDe({ box, ...frame });
  if (scale < 0.6) return semLugar;
  return { mode: 'top', reason: 'small_zone', video: { box, frame }, panel: { x: LISTA_PAINEL.x, y: pt, w: LISTA_PAINEL.w, h: ph }, scale: Math.round(scale * 1000) / 1000, maxPairs: 3 };
}

// ───────────────────────── agendaLista ─────────────────────────

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/**
 * Instante de entrada de cada linha (s). Com âncora: início da palavra − 0,10 s. Sem âncora: na maior pausa ≥ 0,4 s
 * entre as vizinhas com âncora (na ordem da lista; Versus by_speech: na mesma coluna, e na falta dela, na lista), logo
 * depois do fim da palavra (+0,15 s, no máximo o meio da pausa); sem pausa, no meio do intervalo.
 * `alternate` (Versus): par a par nos primeiros 70 % do vídeo, a direita 45 % do passo depois da esquerda.
 */
export function agendaLista(lines: { anchorWordIndex: number | null; side: ListSide | null }[], words: TranscriptWordLike[], durationSec: number, order: ListOrder): number[] {
  const fim = Math.max(0, durationSec - 0.5);
  if (order === 'alternate' && lines.some((l) => l.side)) {
    const nPares = Math.max(1, ...(['bad', 'good'] as const).map((s) => lines.filter((l) => l.side === s).length));
    const passo = (0.7 * durationSec) / nPares;
    const idx = { bad: 0, good: 0 };
    return lines.map((l) => {
      const k = l.side ? idx[l.side]++ : 0;
      return r3(Math.min(fim, 0.3 + k * passo + (l.side === 'good' ? passo * 0.45 : 0)));
    });
  }
  const ancora = (l: { anchorWordIndex: number | null }) => (l.anchorWordIndex !== null && l.anchorWordIndex >= 0 && words[l.anchorWordIndex] ? Math.max(0, words[l.anchorWordIndex].startSec - 0.1) : null);
  const base = lines.map(ancora);
  return lines.map((l, k) => {
    if (base[k] !== null) return r3(Math.min(fim, base[k]!));
    const mesmaColuna = (j: number) => !l.side || lines[j].side === l.side;
    const busca = (dir: -1 | 1, filtro: (j: number) => boolean): number | null => {
      for (let j = k + dir; j >= 0 && j < lines.length; j += dir) if (base[j] !== null && filtro(j)) return base[j];
      return null;
    };
    const a = busca(-1, mesmaColuna) ?? busca(-1, () => true) ?? 0;
    let b = busca(1, mesmaColuna) ?? busca(1, () => true) ?? durationSec;
    if (b <= a) b = durationSec;
    let melhor: { ini: number; fim: number } | null = null;
    for (let w = 0; w + 1 < words.length; w++) {
      const ini = words[w].endSec, f2 = words[w + 1].startSec;
      // `b` = âncora − 0,10: a pausa pode ir até o início da palavra da vizinha
      if (ini < a - 1e-6 || f2 > b + 0.1 + 1e-6 || f2 - ini < 0.4) continue;
      if (!melhor || f2 - ini > melhor.fim - melhor.ini) melhor = { ini, fim: f2 };
    }
    const at = melhor ? Math.min(melhor.ini + 0.15, (melhor.ini + melhor.fim) / 2) : (a + b) / 2;
    return r3(Math.min(fim, Math.max(0, at)));
  });
}

// ───────────────────────── geometria e medida ─────────────────────────

export interface GeoCelula { id: string; x: number; y: number; w: number; h: number; textW: number; max: number; icone: number }
export interface GeometriaLista {
  panel: Rect;
  /** Versus 2 col: cabeçalhos */
  heads: { h: number; fonte: number; bad: Rect; good: Rect; textW: number } | null;
  /** Stack: título */
  title: { h: number; fonte: number; y: number; textW: number } | null;
  cells: GeoCelula[];
  piso: number;
  maxLines: Record<string, number>;
}

/** Ordem de desenho/tempo no 1 col: pela entrada (atSec). */
const porTempo = <T extends { atSec: number }>(ls: T[]) => [...ls].sort((a, b) => a.atSec - b.atSec);

/**
 * Geometria do painel (§3.2-3.3 da spec, igual ao protótipo): retângulos (relativos ao painel) de cabeçalho/título e de
 * cada célula/barra, com a largura útil de texto e o tamanho máximo de fonte. A composição desenha com ela; o `medirLista`
 * mede com ela.
 */
export function geometriaLista(p: { mode: ListMode; placement: ListPlacementComLugar; lines: { id: string; side: ListSide | null; kind: ListKind; atSec: number }[] }, square = p.placement.mode === 'side'): GeometriaLista {
  const P = p.placement.panel;
  const maxLines: Record<string, number> = {};
  const cells: GeoCelula[] = [];
  if (p.mode === 'two-col') {
    const rows = Math.max(1, ...(['bad', 'good'] as const).map((s) => p.lines.filter((l) => l.side === s).length));
    const hh = Math.min(84, Math.round(P.h * 0.19));
    const gap = Math.max(10, Math.round(P.h * 0.025));
    const rh = Math.min(140, Math.floor((P.h - hh - 12 - gap * (rows - 1)) / rows));
    const fs = Math.max(LISTA_PISO.versus, Math.min(52, Math.round(rh * 0.36)));
    const colW = (P.w - 18) / 2;
    const icone = Math.round(fs * 1.05);
    const textW = Math.floor(colW - 2 * 22 - 6 - icone - 16);
    for (const side of ['bad', 'good'] as const) {
      p.lines.filter((l) => l.side === side).forEach((l, r) => {
        cells.push({ id: l.id, x: side === 'bad' ? 0 : colW + 18, y: hh + 12 + r * (rh + gap), w: colW, h: rh, textW, max: fs, icone });
        maxLines[l.id] = 2;
      });
    }
    const hIcone = Math.round(hh * 0.5);
    return {
      panel: P, title: null, cells, piso: LISTA_PISO.versus, maxLines,
      heads: { h: hh, fonte: Math.round(hh * 0.46), bad: { x: 0, y: 0, w: colW, h: hh }, good: { x: colW + 18, y: 0, w: colW, h: hh }, textW: Math.floor(colW - 40 - hIcone - 12) },
    };
  }
  if (p.mode === 'one-col') {
    const seq = porTempo(p.lines);
    const n = Math.max(1, seq.length);
    const gp = 8;
    const rh = Math.min(square ? 132 : 104, Math.floor((P.h - gp * (n - 1)) / n));
    const fs = Math.max(LISTA_PISO.versus, Math.min(46, Math.round(rh * (square ? 0.3 : 0.42))));
    const icone = Math.round(fs * 1.05);
    const total = n * rh + (n - 1) * gp;
    const y0 = Math.max(0, (P.h - total) / 2);
    seq.forEach((l, k) => {
      cells.push({ id: l.id, x: 0, y: y0 + k * (rh + gp), w: P.w, h: rh, textW: Math.floor(P.w - 2 * 22 - 6 - icone - 16), max: fs, icone });
      maxLines[l.id] = 2;
    });
    return { panel: P, heads: null, title: null, cells, piso: LISTA_PISO.versus, maxLines };
  }
  // stack
  const n = Math.max(1, p.lines.length);
  const th = Math.min(72, Math.round(P.h * 0.13));
  const g2 = Math.max(8, Math.round(P.h * 0.02));
  const bh = Math.min(square ? 140 : 118, Math.floor((P.h - th - 12 - g2 * (n - 1)) / n));
  const bfs = Math.max(LISTA_PISO.stack, Math.min(48, Math.round(bh * (square ? 0.27 : 0.4))));
  const num = Math.round(bh * 0.66);
  const total = th + 12 + n * bh + (n - 1) * g2;
  const y0 = Math.max(0, (P.h - total) / 2);
  p.lines.forEach((l, k) => {
    cells.push({ id: l.id, x: 0, y: y0 + th + 12 + k * (bh + g2), w: P.w, h: bh, textW: Math.floor(P.w - 14 - 26 - num - 18), max: Math.round(bfs * (l.kind === 'price' ? 1.04 : 1)), icone: num });
    maxLines[l.id] = l.kind === 'cta' ? 1 : 2;
  });
  return { panel: P, heads: null, cells, piso: LISTA_PISO.stack, maxLines, title: { h: th, fonte: Math.round(th * 0.72), y: y0, textW: P.w } };
}

const LH_CELULA = 1.08;
/** Ajuste de um texto da lista (fitText com o piso do template). */
export const fitLista = (text: string, o: { width: number; max: number; piso: number; maxLines: number; font?: 'inter-800' | 'montserrat-900'; language?: string; uppercase?: boolean; lineHeight?: number }): FittedText =>
  fitText(text, { font: o.font ?? 'inter-800', width: o.width, maxLines: o.maxLines, max: o.max, min: o.piso, piso: o.piso, lineHeight: o.lineHeight ?? LH_CELULA, uppercase: o.uppercase, cjk: cjkDe(o.language ?? 'en') });

type ListaParaMedir = Omit<ListOverlayProps, 'lines'> & { lines: Omit<ListLineProps, 'fit'>[]; language?: string };

/** Cabeçalhos/título ajustados (a composição desenha com estes; overflow entra no `medirLista`). */
export const ajustesDosRotulos = (p: ListaParaMedir, g: GeometriaLista): { heads: { bad: FittedText; good: FittedText } | null; title: FittedText | null } => ({
  heads: p.heads && g.heads ? {
    bad: fitLista(p.heads.bad, { width: g.heads.textW, max: g.heads.fonte, piso: Math.min(g.heads.fonte, g.piso), maxLines: 1, font: 'montserrat-900', uppercase: true, language: p.language, lineHeight: 1.1 }),
    good: fitLista(p.heads.good, { width: g.heads.textW, max: g.heads.fonte, piso: Math.min(g.heads.fonte, g.piso), maxLines: 1, font: 'montserrat-900', uppercase: true, language: p.language, lineHeight: 1.1 }),
  } : null,
  title: p.title && g.title ? fitLista(p.title, { width: g.title.textW, max: g.title.fonte, piso: Math.min(g.title.fonte, g.piso), maxLines: 1, font: 'montserrat-900', uppercase: true, language: p.language, lineHeight: 1.1 }) : null,
});

/**
 * Mede cada linha (fitText com os máximos da geometria e o piso do template: Versus 30 px, Stack 26 px). `overflow` = ids
 * que nem no piso couberam (inclui `heads.bad`/`heads.good`/`title`) → TEMPLATE_TEXT_OVERFLOW no build.
 */
export function medirLista(props: ListaParaMedir): { lines: FittedText[]; overflow: string[] } {
  if (props.placement.mode === 'none') throw new Error('medirLista: placement none');
  const g = geometriaLista({ ...props, placement: props.placement });
  const por = new Map(g.cells.map((c) => [c.id, c]));
  const lines = props.lines.map((l) => {
    const c = por.get(l.id)!;
    return fitLista(l.text, { width: c.textW, max: c.max, piso: g.piso, maxLines: g.maxLines[l.id] ?? 2, language: props.language, lineHeight: props.mode === 'stack' ? 1.05 : LH_CELULA });
  });
  const overflow = props.lines.filter((_, k) => !lines[k].fits).map((l) => l.id);
  const r = ajustesDosRotulos(props, g);
  if (r.heads && !r.heads.bad.fits) overflow.push('heads.bad');
  if (r.heads && !r.heads.good.fits) overflow.push('heads.good');
  if (r.title && !r.title.fits) overflow.push('title');
  return { lines, overflow };
}

/** Instante de entrada de cada cabeçalho / do título: junto da 1ª linha do lado (−0,05 s). */
export const entradaDosRotulos = (lines: { side: ListSide | null; atSec: number }[]) => {
  const de = (f: (l: { side: ListSide | null }) => boolean) => {
    const ts = lines.filter(f).map((l) => l.atSec);
    return ts.length ? Math.max(0, Math.min(...ts) - 0.05) : 0;
  };
  return { bad: de((l) => l.side === 'bad'), good: de((l) => l.side === 'good'), title: de(() => true) };
};

/** Os 3 instantes da checagem por visão (§3.1): depois da 1ª linha, no meio e no último quadro com a tabela inteira. */
export const checkpointsLista = (p: Pick<ListOverlayProps, 'lines' | 'heads' | 'title' | 'source'>): { atSec: number; texts: string[] }[] => {
  const seq = porTempo(p.lines);
  const fim = r3(Math.max(0, p.source.durationSec - 0.1));
  const ate = (t: number) => seq.filter((l) => l.atSec + 0.6 <= t).map((l) => l.text);
  const rot = [...(p.heads ? [p.heads.bad, p.heads.good] : []), ...(p.title ? [p.title] : [])];
  const t1 = r3(Math.min(fim, seq[0].atSec + 0.8));
  const meio = r3(Math.min(fim, Math.max(t1, seq[Math.floor((seq.length - 1) / 2)].atSec + 0.8)));
  return [t1, meio, fim].map((atSec, k) => ({ atSec, texts: k === 2 ? [...rot, ...seq.map((l) => l.text)] : ate(atSec) }));
};
