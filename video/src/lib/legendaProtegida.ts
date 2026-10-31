import type { EditMapLike } from './autoEdit';
import type { ProtectedBand } from './captionsSchema';
import { caixaLegendaAutoEdit, caixaLegendaMoldura } from './legendaAuto';
import { FORMATOS } from './formatos';
import type { AutoEditProps } from './autoEdit';
import { layoutDaPeca, pinturaNaCaixa, reframeNaCaixa, textosQueNaoCouberam, type Focus, type FrameLayout, type MolduraProps, type Rect } from './molduras';

// Legenda queimada protegida (docs/contratos/legenda-protegida-v1.md, aprovado 26/10): nenhum template tampa a legenda
// queimada do campeão. Por peça: (1) desviar; (2) recortar o vídeo sem ela (contentBox − faixa, sem cortar o rosto) e
// pôr a nossa legenda no estilo da original; (3) não oferecer (`burned_captions`). Funções puras: plano, build e editor.

export type { ProtectedBand };
/** D-LP1: folga de 4 % da altura do quadro em cima e embaixo, 2 % da largura nos lados. */
export const FOLGA_V = 0.04, FOLGA_H = 0.02;

type Camada = { box: Rect; startFrame: number; endFrame: number; kind?: string; style?: { fontSizePx?: number; lineHeight?: number } };
type MapaComCamadas = EditMapLike & { fps?: number };

/**
 * Faixas protegidas (px do arquivo): cada camada `caption` do editMap, no intervalo dela (D-LP6: legenda parcial também),
 * com folga; página de 2 linhas medida como 1 (caixa < 1,5 linha) ganha 1 linha em cima e embaixo. Faixas da mesma
 * posição que se tocam no tempo viram uma.
 */
export const faixasProtegidasDe = (m: MapaComCamadas | null, source: { width: number; height: number }): ProtectedBand[] => {
  if (!m) return [];
  const ex = source.width / m.width, ey = source.height / m.height, fps = m.fps ?? 30;
  const out: ProtectedBand[] = [];
  for (const l of (m.layers as Camada[]).filter((x) => x.kind === 'caption' && x.endFrame > x.startFrame)) {
    let y = l.box.y, h = l.box.h;
    const linha = l.style?.fontSizePx ? l.style.fontSizePx * (l.style.lineHeight ?? 1.15) : h / 2;
    if (h < 1.5 * linha) { y -= linha; h += 2 * linha; }
    const fy = FOLGA_V * source.height, fx = FOLGA_H * source.width;
    const b = {
      x: Math.max(0, Math.round(l.box.x * ex - fx)), y: Math.max(0, Math.round(y * ey - fy)),
      w: 0, h: 0, startSec: Math.round((l.startFrame / fps) * 1000) / 1000, endSec: Math.round((l.endFrame / fps) * 1000) / 1000,
    };
    b.w = Math.min(source.width, Math.round((l.box.x + l.box.w) * ex + fx)) - b.x;
    b.h = Math.min(source.height, Math.round((y + h) * ey + fy)) - b.y;
    const igual = out.find((o) => Math.abs(o.x - b.x) < 8 && Math.abs(o.y - b.y) < 8 && Math.abs(o.h - b.h) < 8 && b.startSec <= o.endSec + 0.1 && o.startSec <= b.endSec + 0.1);
    if (igual) { igual.startSec = Math.min(igual.startSec, b.startSec); igual.endSec = Math.max(igual.endSec, b.endSec); } else out.push(b);
  }
  return out;
};

/** Envoltória de todas as faixas (a que o desvio e o recorte usam). */
export const unionBand = (bs: ProtectedBand[]): Rect | null => {
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const cruza = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Faixa (px do arquivo) no espaço da saída, pela pintura do vídeo na videoBox. */
const faixaNaSaida = (b: Rect, p: Pick<MolduraProps, 'video'>, vb: Rect): Rect => {
  const cb = p.video.contentBox ?? null;
  const C = cb ?? { x: 0, y: 0, w: p.video.source.width, h: p.video.source.height };
  const pt = pinturaNaCaixa(vb, p.video.source, p.video.reframe, cb);
  return { x: vb.x + pt.area.left + (b.x - C.x) * pt.s, y: vb.y + pt.area.top + (b.y - C.y) * pt.s, w: b.w * pt.s, h: b.h * pt.s };
};
/** Parte do vídeo visível na saída (videoBox ∩ área pintada da contentBox). */
const visivel = (p: Pick<MolduraProps, 'video'>, vb: Rect): Rect => {
  const pt = pinturaNaCaixa(vb, p.video.source, p.video.reframe, p.video.contentBox ?? null);
  const x0 = Math.max(vb.x, vb.x + pt.area.left), y0 = Math.max(vb.y, vb.y + pt.area.top);
  const x1 = Math.min(vb.x + vb.w, vb.x + pt.area.left + pt.area.w), y1 = Math.min(vb.y + vb.h, vb.y + pt.area.top + pt.area.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

/** Instante da peça (timeline) em que a faixa aparece pela 1ª vez; null = fora da peça. */
const naPeca = (b: ProtectedBand, timeline: { startSec: number; endSec: number }[]): number | null => {
  let at = 0;
  for (const t of timeline) {
    const a = Math.max(t.startSec, b.startSec), z = Math.min(t.endSec, b.endSec);
    if (z > a) return Math.round((at + (a - t.startSec)) * 10) / 10;
    at += t.endSec - t.startSec;
  }
  return null;
};

export interface ChecagemLegenda { ok: boolean; hits: { element: string; atSec: number; overlapPx: number }[] }

/**
 * §4.1: cruza cada faixa protegida (no espaço da saída, pela mesma pintura do vídeo) com tudo o que a moldura desenha
 * por cima: slots de texto, rosto redondo, 2ª fonte e a legenda nossa. `avoid`: a faixa tem que estar inteira dentro do
 * vídeo visível (`clipped` se cortada) e sem nada por cima. `replace`: a faixa original não pode aparecer (`leak`).
 */
export const checarLegendaProtegida = (p: MolduraProps, L: FrameLayout = layoutDaPeca(p)): ChecagemLegenda => {
  const hits: ChecagemLegenda['hits'] = [];
  const vb = L.videoBox;
  const vis = visivel(p, vb);
  if (p.video.faceSafeBand) {
    const face = faixaNaSaida(p.video.faceSafeBand, p, vb);
    const faceArea = face.w * face.h;
    if (area(face, vis) < faceArea * .92) hits.push({ element: 'face_clipped', atSec: 0, overlapPx: Math.round(faceArea - area(face, vis)) });
    for (const [name, slot] of Object.entries(L.slots)) {
      if (name !== 'column' && area(face, slot) > faceArea * .15) hits.push({ element: `face_covered:${name}`, atSec: 0, overlapPx: Math.round(area(face, slot)) });
    }
  }
  for (const b of p.video.protectedBands ?? []) {
    const at = naPeca(b, p.video.timeline);
    if (at === null) continue;
    const r = faixaNaSaida(b, p, vb);
    const dentro = area(r, vis);
    if (p.captionMode === 'replace') {
      if (dentro > 0) hits.push({ element: 'leak', atSec: at, overlapPx: Math.round(dentro) });
      continue;
    }
    if (dentro < r.w * r.h * 0.99) hits.push({ element: 'clipped', atSec: at, overlapPx: Math.round(r.w * r.h - dentro) });
    const elementos: [string, Rect][] = [
      ...Object.entries(L.slots).filter(([k]) => k !== 'column').map(([k, v]) => [`slot:${k}`, v] as [string, Rect]),
      ...(L.faceBox ? [['face', L.faceBox] as [string, Rect]] : []),
      ...(L.secondBox && cruza(L.secondBox, vb) ? [['second', L.secondBox] as [string, Rect]] : []),
    ];
    if (p.captions?.words.length) {
      const c = caixaLegendaMoldura(p, L);
      if (c) elementos.push(['captions', c.box]);
    }
    for (const [nome, e] of elementos) {
      const ov = area(r, e);
      if (ov > 0 && cruza(r, vis)) hits.push({ element: nome, atSec: at, overlapPx: Math.round(ov) });
    }
  }
  return { ok: hits.length === 0, hits };
};

export type DecisaoLegenda =
  | { mode: 'avoid'; input: MolduraProps; check: ChecagemLegenda }
  | { mode: 'replace'; input: MolduraProps; check: ChecagemLegenda; contentBox: Rect }
  | { mode: 'blocked'; reason: 'face_cut' | 'no_room'; check: ChecagemLegenda };

/** Recorte (§2.2): a parte da contentBox do lado do rosto, sem a faixa. null = o rosto (com folga de 8 %) não fica inteiro
 *  dentro dela em ≥ 95 % dos frames. */
export const recorteSemLegenda = (p: Pick<MolduraProps, 'video'>, m: EditMapLike | null): Rect | null => {
  const U = unionBand(p.video.protectedBands ?? []);
  if (!U) return null;
  const src = p.video.source;
  const C = p.video.contentBox ?? { x: 0, y: 0, w: src.width, h: src.height };
  const ex = m ? src.width / m.width : 1, ey = m ? src.height / m.height : 1;
  const segs = (m?.faceTrack ?? []).filter((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length);
  const cimaSR = { x: C.x, y: C.y, w: C.w, h: Math.max(0, U.y - C.y) };
  const baixoSR = { x: C.x, y: U.y + U.h, w: C.w, h: Math.max(0, C.y + C.h - (U.y + U.h)) };
  if (!segs.length) {
    // campeão sem rosto (b-roll com narração, 26/10): a única trava era o rosto; recorta pro maior lado sem a faixa
    const maior = [cimaSR, baixoSR].sort((a, b) => b.h - a.h)[0];
    return maior.h >= 0.25 * C.h ? { x: Math.round(maior.x), y: Math.round(maior.y), w: Math.round(maior.w), h: Math.round(maior.h) } : null;
  }
  const rostos = segs.map((s) => {
    const f = s.faceInRegion[0].box;
    const r = { x: (s.region.x + f.x * s.region.w) * ex, y: (s.region.y + f.y * s.region.h) * ey, w: f.w * s.region.w * ex, h: f.h * s.region.h * ey };
    const fg = 0.08 * r.h;
    return { r: { x: r.x - fg, y: r.y - fg, w: r.w + 2 * fg, h: r.h + 2 * fg }, peso: Math.max(1, s.endFrame - s.startFrame) };
  });
  const total = rostos.reduce((n, x) => n + x.peso, 0);
  for (const parte of [cimaSR, baixoSR]) {
    if (parte.h < 0.25 * C.h) continue;
    const ok = rostos.filter((x) => x.r.y >= parte.y - 1 && x.r.y + x.r.h <= parte.y + parte.h + 1).reduce((n, x) => n + x.peso, 0);
    if (ok / total >= 0.95) return { x: Math.round(parte.x), y: Math.round(parte.y), w: Math.round(parte.w), h: Math.round(parte.h) };
  }
  return null;
};

/**
 * §3: desviar → recortar e legendar → não oferecer. `p` = o input montado (com protectedBands); `m` = o editMap (rosto);
 * `legenda` = a nossa legenda no estilo da original (palavras do campeão), usada no passo 2.
 */
export const decidirLegenda = (p: MolduraProps, m: EditMapLike | null, legenda: MolduraProps['captions'] | null, forcar?: 'replace'): DecisaoLegenda => {
  if (!p.video.protectedBands?.length) return { mode: 'avoid', input: p, check: { ok: true, hits: [] } };
  const base = { ...p, captionMode: 'avoid' as const, captions: undefined };
  // Revisão 29/10: o vídeo PREENCHE a caixa (cover). Os candidatos vêm em ordem: cover com o foco deslizando no eixo
  // cortado até a legenda e o rosto ficarem dentro → o menor afastamento que faz caber → (último recurso) mais afastado,
  // pra abrir espaço pro texto. O primeiro que passa na checagem E cujo texto cabe vence; sem texto que caiba, o primeiro
  // que passa na checagem (o build acusa FRAME_TEXT_OVERFLOW, como antes).
  const candidatos = enquadramentosPreservandoLegenda(p.video, layoutDaPeca(base).videoBox).map((video): MolduraProps => ({ ...base, video }));
  const a: MolduraProps = candidatos[0] ?? base;
  // forcar 'replace' (Retry antigo depois de CAPTION_COVERED): pula o desvio e vai direto pro recorte
  const ca = forcar === 'replace' ? { ok: false, hits: [{ element: 'forced_replace', atSec: 0, overlapPx: 0 }] } : checarLegendaProtegida(a);
  if (forcar !== 'replace') {
    let passa: { input: MolduraProps; check: ChecagemLegenda } | null = null;
    for (const c of candidatos.length ? candidatos : [a]) {
      const check = c === a ? ca : checarLegendaProtegida(c);
      if (!check.ok) continue;
      if (!textosQueNaoCouberam(layoutDaPeca(c)).length) return { mode: 'avoid', input: c, check };
      passa ??= { input: c, check };
    }
    if (passa) return { mode: 'avoid', ...passa };
    return { mode: 'blocked', reason: 'no_room', check: ca };
  }
  const cb = recorteSemLegenda(p, m);
  if (!cb) return { mode: 'blocked', reason: 'face_cut', check: ca };
  const L0 = layoutDaPeca(a);
  const src = p.video.source;
  const second = p.second?.kind === 'champion_segment' && L0.secondBox ? { ...p.second, reframe: reframeNaCaixa(L0.secondBox, src, m, 1080, cb) } : p.second;
  const r: MolduraProps = {
    ...p, captionMode: 'replace', second,
    video: { ...p.video, contentBox: cb, reframe: reframeNaCaixa(L0.videoBox, src, m, 1080, cb) },
    ...(legenda?.words.length ? { captions: legenda } : {}),
  };
  const cr = checarLegendaProtegida(r);
  if (!cr.ok) return { mode: 'blocked', reason: 'no_room', check: cr };
  return { mode: 'replace', input: r, check: cr, contentBox: cb };
};

/**
 * Candidatos de enquadramento que mantêm a legenda queimada e o rosto inteiros (revisão 29/10, vale por cima da de 28/10).
 * Nunca muda o arquivo nem a legenda dele. Ordem:
 *  1. cover (scale 1), com o foco deslizando no eixo cortado: o mais perto do foco original e as duas pontas do intervalo
 *     em que a envoltória (legenda ∪ rosto) fica dentro da janela;
 *  2. se ela não cabe no cover: o MENOR afastamento que a faz caber (faixa de cor só do tamanho necessário), idem foco;
 *  3. último recurso (o texto da moldura não achou lugar): afastamentos maiores, até o contain.
 * A `contentBox` cresce pra incluir a envoltória (a legenda pode estar fora da área de vídeo medida).
 */
export function enquadramentosPreservandoLegenda(video: MolduraProps['video'], box: { w: number; h: number }): MolduraProps['video'][] {
  const source = video.source;
  const crop = video.contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  const band = unionBand([...(video.protectedBands ?? []), ...(video.faceSafeBand ? [{ ...video.faceSafeBand, startSec: 0, endSec: source.durationSec }] : [])]);
  if (!band) return [];
  const x = Math.max(0, Math.min(crop.x, band.x)), y = Math.max(0, Math.min(crop.y, band.y));
  const C = { x, y, w: Math.min(source.width, Math.max(crop.x + crop.w, band.x + band.w)) - x, h: Math.min(source.height, Math.max(crop.y + crop.h, band.y + band.h)) - y };
  const U = { x: Math.max(0, band.x - C.x), y: Math.max(0, band.y - C.y), w: Math.min(band.w, C.w), h: Math.min(band.h, C.h) };
  const cover = Math.max(box.w / C.w, box.h / C.h);
  const contain = Math.min(box.w / C.w, box.h / C.h) / cover;
  const M = 3; // px da fonte de folga contra arredondamento do foco (r3)
  const cabe = Math.min(1, Math.min(box.w / Math.min(C.w, U.w + 2 * M), box.h / Math.min(C.h, U.h + 2 * M)) / cover);
  const f0 = video.reframe.mode === 'cover' ? video.reframe.focus : { x: 0.5, y: 0.5 };
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  // centros possíveis num eixo (fração da contentBox): janela dentro da contentBox e a envoltória dentro da janela
  const focos = (f: number, total: number, janela: number, u0: number, u1: number, eixo: 'x' | 'y'): number[] => {
    if (janela <= total + 0.5 && janela >= total - 0.5) return [f]; // eixo justo: o foco não muda nada
    // sobra (faixa de cor, caso extremo): inteira de um lado só, nunca um filete em cada ponta. Vertical: em cima
    // (encosta no texto do topo das molduras) e depois embaixo; horizontal: dividida (simétrica)
    if (janela > total) return eixo === 'y' ? [0, 1] : [0.5];
    const lo = Math.max(janela / 2, u1 + M - janela / 2), hi = Math.min(total - janela / 2, u0 - M + janela / 2);
    if (lo > hi) return [];
    const perto = Math.min(hi, Math.max(lo, f * total));
    return [...new Set([perto, lo, hi].map((c) => r3(c / total)))];
  };
  const piso = (v: number) => Math.floor(v * 1000) / 1000; // arredonda pra baixo: a janela nunca fica menor que a envoltória
  const escalas = [...new Set([cabe, ...[0.95, 0.9, 0.85, 0.75, 0.65].map((k) => k * cabe), contain].map((s) => (s >= 0.999 ? 1 : piso(Math.max(contain, Math.min(cabe, s))))))]
    .sort((a, b) => b - a);
  const out: MolduraProps['video'][] = [];
  for (const scale of escalas) {
    const s = cover * scale, ww = box.w / s, wh = box.h / s;
    const fx = focos(f0.x, C.w, ww, U.x, U.x + U.w, 'x'), fy = focos(f0.y, C.h, wh, U.y, U.y + U.h, 'y');
    // ordem: o mais perto do foco original no eixo cortado (no eixo com sobra, a ordem de `focos`; sort é estável)
    const k = (p: Focus) => (ww < C.w - 0.5 ? Math.abs(p.x - f0.x) : 0) + (wh < C.h - 0.5 ? Math.abs(p.y - f0.y) : 0);
    const pares = fx.flatMap((a) => fy.map((b) => ({ x: a, y: b }))).sort((p, q) => k(p) - k(q));
    for (const focus of pares) out.push({ ...video, contentBox: C, reframe: { mode: 'cover' as const, focus, ...(scale < 0.999 && { scale }) } });
  }
  return out;
}

// ───────────────────────── AutoEdit (CUT, NATIVE_SEARCH, REVIEW) ─────────────────────────

/** Área do vídeo na saída do AutoEdit (REVIEW/SPLIT_LP: a parte de baixo; o resto: a tela). */
export const areaVideoAutoEdit = (p: Pick<AutoEditProps, 'format' | 'params'>): Rect => {
  const { width: W, height: H } = FORMATOS[p.format];
  const r = p.params.type === 'REVIEW' || p.params.type === 'SPLIT_LP' ? Math.round(H * p.params.ratio) : 0;
  return { x: 0, y: r, w: W, h: H - r };
};

/** §4.1 no AutoEdit: a faixa inteira dentro do vídeo visível e nada por cima (a tela de busca do NATIVE_SEARCH cobre o
 *  vídeo nos primeiros segundos). 'replace': a original não pode aparecer. */
export const checarLegendaAutoEdit = (p: AutoEditProps): ChecagemLegenda => {
  const vb = areaVideoAutoEdit(p);
  const como = { video: { source: p.source, reframe: p.reframe as never, contentBox: p.contentBox ?? null, timeline: p.timeline } } as unknown as Pick<MolduraProps, 'video'>;
  const hits: ChecagemLegenda['hits'] = [];
  const vis = visivel(como, vb);
  for (const b of p.protectedBands ?? []) {
    const at = naPeca(b, p.timeline);
    if (at === null) continue;
    const r = faixaNaSaida(b, como, vb);
    const dentro = area(r, vis);
    if (p.captionMode === 'replace') { if (dentro > 0) hits.push({ element: 'leak', atSec: at, overlapPx: Math.round(dentro) }); continue; }
    if (dentro < r.w * r.h * 0.99) hits.push({ element: 'clipped', atSec: at, overlapPx: Math.round(r.w * r.h - dentro) });
    if (p.params.type === 'NATIVE_SEARCH' && at < p.params.introSec) hits.push({ element: 'search_intro', atSec: at, overlapPx: Math.round(r.w * r.h) });
  }
  return { ok: hits.length === 0, hits };
};

export type DecisaoLegendaAutoEdit =
  | { mode: 'avoid' | 'replace'; input: AutoEditProps; check: ChecagemLegenda }
  | { mode: 'blocked'; reason: 'face_cut' | 'no_room'; check: ChecagemLegenda };

/** §3 no AutoEdit: desviar (o reenquadramento já leva a faixa) → recortar e legendar no estilo da original → bloquear. */
export const decidirLegendaAutoEdit = (p: AutoEditProps, m: EditMapLike | null, legenda: AutoEditProps['captions'] | null, forcar?: 'replace'): DecisaoLegendaAutoEdit => {
  if (!p.protectedBands?.length) return { mode: 'avoid', input: p, check: { ok: true, hits: [] } };
  // revisão 29/10: mesmos candidatos da moldura (cover com o foco deslizando primeiro; afastar só o necessário)
  const candidatos = enquadramentosPreservandoLegenda({ source: p.source, contentBox: p.contentBox, protectedBands: p.protectedBands, reframe: p.reframe, timeline: p.timeline } as MolduraProps['video'], areaVideoAutoEdit(p))
    .map((video): AutoEditProps => ({ ...p, captionMode: 'avoid', captions: undefined, contentBox: video.contentBox, reframe: video.reframe as AutoEditProps['reframe'] }));
  const a: AutoEditProps = candidatos[0] ?? { ...p, captionMode: 'avoid', captions: undefined };
  const ca = forcar === 'replace' ? { ok: false, hits: [{ element: 'forced_replace', atSec: 0, overlapPx: 0 }] } : checarLegendaAutoEdit(a);
  if (forcar !== 'replace') {
    for (const c of candidatos.length ? candidatos : [a]) {
      const check = c === a ? ca : checarLegendaAutoEdit(c);
      if (check.ok) return { mode: 'avoid', input: c, check };
    }
    return { mode: 'blocked', reason: 'no_room', check: ca };
  }
  const cb = recorteSemLegenda({ video: { source: p.source, protectedBands: p.protectedBands, contentBox: p.contentBox ?? null } } as never, m);
  if (!cb) return { mode: 'blocked', reason: 'face_cut', check: ca };
  const vb = areaVideoAutoEdit(p);
  const r: AutoEditProps = { ...p, captionMode: 'replace', contentBox: cb, reframe: reframeNaCaixa(vb, p.source, m, 1080, cb) as AutoEditProps['reframe'], ...(legenda?.words.length ? { captions: legenda } : {}) };
  const cr = checarLegendaAutoEdit(r);
  if (!cr.ok) return { mode: 'blocked', reason: 'no_room', check: cr };
  return { mode: 'replace', input: r, check: cr };
};

// ───────────────────────── faixa no espaço da saída (pra checagem por visão, §4.2) ─────────────────────────

/** Região da legenda no vídeo RENDERIZADO (px da saída, tempo da peça). `original` = a legenda queimada do campeão
 *  (modo avoid: tem que estar inteira e sem nada por cima); `replaced` = onde a NOSSA legenda entra (modo replace). */
export interface FaixaNaSaida { kind: 'original' | 'replaced'; x: number; y: number; w: number; h: number; startSec: number; endSec: number }

const recortarNoCanvas = (r: Rect, W: number, H: number): Rect | null => {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return x1 - x0 > 1 && y1 - y0 > 1 ? { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : null;
};
/** Intervalos [início, fim) da faixa no tempo da peça (timeline). */
const intervalosNaPeca = (b: { startSec: number; endSec: number }, timeline: { startSec: number; endSec: number }[]) => {
  const out: { startSec: number; endSec: number }[] = [];
  let at = 0;
  for (const t of timeline) {
    const a = Math.max(t.startSec, b.startSec), z = Math.min(t.endSec, b.endSec);
    if (z > a) out.push({ startSec: Math.round((at + a - t.startSec) * 1000) / 1000, endSec: Math.round((at + z - t.startSec) * 1000) / 1000 });
    at += t.endSec - t.startSec;
  }
  return out;
};

/** Moldura: faixas protegidas na saída (pela pintura do vídeo na videoBox); no 'replace', a caixa da nossa legenda. */
export const faixasProtegidasNaSaida = (p: MolduraProps): FaixaNaSaida[] => {
  const { width: W, height: H } = FORMATOS[p.format];
  const L = layoutDaPeca(p);
  const dur = p.video.timeline.reduce((n, t) => n + t.endSec - t.startSec, 0);
  if (p.captionMode === 'replace') {
    const c = p.captions?.words.length ? caixaLegendaMoldura(p, L) : null;
    return c ? [{ kind: 'replaced', ...c.box, startSec: 0, endSec: Math.round(dur * 1000) / 1000 }] : [];
  }
  const out: FaixaNaSaida[] = [];
  for (const b of p.video.protectedBands ?? []) {
    const r = recortarNoCanvas(faixaNaSaida(b, p, L.videoBox), W, H);
    if (!r) continue;
    for (const iv of intervalosNaPeca(b, p.video.timeline)) out.push({ kind: 'original', ...r, ...iv });
  }
  return out;
};

/** AutoEdit: idem, na área do vídeo (tela, ou a parte de baixo no REVIEW/SPLIT_LP). */
export const faixasProtegidasNaSaidaAutoEdit = (p: AutoEditProps): FaixaNaSaida[] => {
  const { width: W, height: H } = FORMATOS[p.format];
  const vb = areaVideoAutoEdit(p);
  const dur = p.timeline.reduce((n, t) => n + t.endSec - t.startSec, 0);
  if (p.captionMode === 'replace') {
    const c = p.captions?.words.length ? caixaDaLegendaAutoEditPublica(p, vb) : null;
    return c ? [{ kind: 'replaced', ...c, startSec: 0, endSec: Math.round(dur * 1000) / 1000 }] : [];
  }
  const como = { video: { source: p.source, reframe: p.reframe as never, contentBox: p.contentBox ?? null, timeline: p.timeline } } as unknown as Pick<MolduraProps, 'video'>;
  const out: FaixaNaSaida[] = [];
  for (const b of p.protectedBands ?? []) {
    const r = recortarNoCanvas(faixaNaSaida(b, como, vb), W, H);
    if (!r) continue;
    for (const iv of intervalosNaPeca(b, p.timeline)) out.push({ kind: 'original', ...r, ...iv });
  }
  return out;
};
const caixaDaLegendaAutoEditPublica = (p: AutoEditProps, vb: Rect): Rect | null => {
  const t = p.captions?.style ? Math.round(p.captions.style.sizeRel * p.source.height * pinturaNaCaixa(vb, p.source, p.reframe as never, p.contentBox ?? null).s) : undefined;
  return caixaLegendaAutoEdit(p.format, p.safeArea, vb, t)?.box ?? null;
};

/** remix-keep (HEADLINE): o quadro é o do campeão, então a faixa na saída = a faixa no arquivo (sem recorte). */
export const faixasProtegidasNaSaidaRemix = (bands: ProtectedBand[], canvas: { width: number; height: number; fps: number; frameCount: number }): FaixaNaSaida[] => {
  const out: FaixaNaSaida[] = [];
  for (const b of bands) {
    const r = recortarNoCanvas(b, canvas.width, canvas.height);
    if (r) out.push({ kind: 'original', ...r, startSec: b.startSec, endSec: Math.min(b.endSec, canvas.frameCount / canvas.fps) });
  }
  return out;
};
