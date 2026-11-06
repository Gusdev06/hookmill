// Vídeo do cliente como camada do editor universal (editor-universal-v1 §4, F-U2), comum às molduras e à HEADLINE: caixa,
// enquadramento manual, auto reframe numa caixa nova, aparar e o gesto `comVideoEditado` do web. Puro, sem React.
import type { ProtectedBand } from '../captionsSchema';
import { enquadramentosPreservandoLegenda, unionBand } from '../legendaProtegida';
import { pinturaNaCaixa, reframeNaCaixa, type FrameReframe, type MolduraProps, type Rect } from '../molduras';
import { docV3De, docV3Vazio, finito, rectValido, videoEditVazio } from './comum';
import { LIMITES_DOC_V3, type AnyEditDoc, type EditDocV3, type FormatCode, type RectFracao, type VideoEdit, type VideoFraming, type VideoLayerLimits } from './tipos';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const limita = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const limitesDoVideo = (trimMinSec: number, trimMaxSec: number): VideoLayerLimits => ({
  zoomMin: LIMITES_DOC_V3.zoomMin, zoomMax: LIMITES_DOC_V3.zoomMax, panAbsMax: LIMITES_DOC_V3.panAbsMax, minBoxFrac: LIMITES_DOC_V3.minBoxFrac,
  minTrimSec: LIMITES_DOC_V3.minTrimSec, trimMinSec, trimMaxSec, fits: ['cover', 'contain_blur'],
});

export const framingValido = (f: unknown): f is VideoFraming => {
  const x = f as VideoFraming | null | undefined;
  return !!x && (x.fit === 'cover' || x.fit === 'contain_blur') && finito(x.zoom) && finito(x.panX) && finito(x.panY)
    && x.zoom >= LIMITES_DOC_V3.zoomMin && x.zoom <= LIMITES_DOC_V3.zoomMax && Math.abs(x.panX) <= LIMITES_DOC_V3.panAbsMax && Math.abs(x.panY) <= LIMITES_DOC_V3.panAbsMax;
};
export const boxDeVideoValida = (b: unknown): b is RectFracao =>
  rectValido(b) && b.x >= -1e-4 && b.y >= -1e-4 && b.x + b.w <= 1 + 1e-4 && b.y + b.h <= 1 + 1e-4 && b.w >= LIMITES_DOC_V3.minBoxFrac - 1e-6 && b.h >= LIMITES_DOC_V3.minBoxFrac - 1e-6;

/** Caixa e enquadramento do vídeo no formato pedido: no principal, os de `doc.video`; nos outros, os do `formatOverrides[fmt].video`
 *  (sem override = layout do template naquele formato). Inválido vira ausente (o PUT recusa antes). */
export const videoNoFormato = (doc: EditDocV3, fmt: FormatCode, principal: FormatCode): { box: RectFracao | null; framing: VideoFraming | null } => {
  const g: Pick<VideoEdit, 'box' | 'framing'> | null | undefined = fmt === principal ? doc.video : doc.formatOverrides?.[fmt]?.video;
  return { box: boxDeVideoValida(g?.box) ? g!.box! : null, framing: framingValido(g?.framing) ? g!.framing! : null };
};

/** Corte do doc dentro de [min, max]; null = sem corte (ausente, inválido ou o vídeo inteiro). */
export const trimDoDoc = (doc: EditDocV3 | null, minSec: number, maxSec: number): { inSec: number; outSec: number } | null => {
  const t = doc?.video?.trim;
  if (!t || !finito(t.inSec) || !finito(t.outSec)) return null;
  const a = Math.max(minSec, t.inSec), b = Math.min(maxSec, t.outSec);
  if (b - a < LIMITES_DOC_V3.minTrimSec - 1e-6) return null;
  if (a - minSec < 1e-3 && maxSec - b < 1e-3) return null;
  return { inSec: a, outSec: b };
};

/** O que o enquadramento precisa saber do vídeo (molduras: `MolduraProps.video`; HEADLINE: a grade do campeão). */
export interface FonteDoVideo {
  source: { width: number; height: number; durationSec: number };
  contentBox: Rect | null;
  reframe: FrameReframe;
  /** legenda queimada, px do arquivo. [] quando ela foi recortada (captionMode 'replace') */
  protectedBands: ProtectedBand[];
  faceSafeBand?: Rect | null;
  faceHint?: Rect | null;
}

/** Envoltória legenda ∪ rosto: é ela que o auto reframe preserva e que precisa existir na área pintada. */
const envoltoria = (v: FonteDoVideo) => unionBand([...v.protectedBands, ...(v.faceSafeBand ? [{ ...v.faceSafeBand, startSec: 0, endSec: v.source.durationSec }] : [])]);

/** Auto reframe numa caixa NOVA: maior escala que mantém rosto + legenda queimada inteiros (o de hoje), sem o editMap. */
export const autoNaCaixa = (v: FonteDoVideo, box: { w: number; h: number }): { reframe: FrameReframe; contentBox: Rect | null } => {
  if (v.protectedBands.length) {
    const [c] = enquadramentosPreservandoLegenda({ ...v, timeline: [], joinFadeMs: 0 } as unknown as MolduraProps['video'], box);
    if (c) return { reframe: c.reframe, contentBox: c.contentBox ?? null };
  }
  const f = v.faceHint;
  const { width: W, height: H } = v.source;
  const mapa = f ? { width: W, height: H, faceTrack: [{ startFrame: 0, endFrame: 1, role: 'main', region: { x: 0, y: 0, w: W, h: H }, faceInRegion: [{ atFrame: 0, box: { x: f.x / W, y: f.y / H, w: f.w / W, h: f.h / H } }] }] } : null;
  return { reframe: reframeNaCaixa(box, v.source, mapa as never, 1080, v.contentBox), contentBox: v.contentBox };
};

/** Área de referência do enquadramento manual: a do auto, crescida pra incluir legenda e rosto (reenquadrar sempre consegue mostrá-los). */
const areaManual = (v: FonteDoVideo, contentBox: Rect | null): Rect | null => {
  const band = envoltoria(v);
  if (!band) return contentBox;
  const c = contentBox ?? { x: 0, y: 0, w: v.source.width, h: v.source.height };
  const x = Math.max(0, Math.min(c.x, band.x)), y = Math.max(0, Math.min(c.y, band.y));
  const r = { x, y, w: Math.min(v.source.width, Math.max(c.x + c.w, band.x + band.w)) - x, h: Math.min(v.source.height, Math.max(c.y + c.h, band.y + band.h)) - y };
  return contentBox || r.x > 0 || r.y > 0 || r.w < v.source.width || r.h < v.source.height ? r : null;
};

/** Enquadramento final do vídeo numa caixa: `framing` manual, ou o auto (o da base se a caixa não mudou). `ref` = a área que dá o
 *  sentido de zoom/pan; `framing` = os valores atuais, mesmo no auto (sliders e ponto de partida do arrasto). */
export const enquadrarVideo = (
  v: FonteDoVideo, box: { w: number; h: number }, caixaMudou: boolean, framing: VideoFraming | null, canvas: { width: number; height: number },
): { reframe: FrameReframe; contentBox: Rect | null; framing: VideoFraming } => {
  const auto = caixaMudou ? autoNaCaixa(v, box) : { reframe: v.reframe, contentBox: v.contentBox };
  const ref = areaManual(v, auto.contentBox);
  if (framing) {
    return { reframe: { mode: 'manual', fit: framing.fit, zoom: framing.zoom, dx: framing.panX * canvas.width, dy: framing.panY * canvas.height }, contentBox: ref, framing };
  }
  const pt = pinturaNaCaixa(box, v.source, auto.reframe, auto.contentBox);
  const C = auto.contentBox ?? { x: 0, y: 0, w: v.source.width, h: v.source.height };
  const R = ref ?? { x: 0, y: 0, w: v.source.width, h: v.source.height };
  const fit = auto.reframe.mode === 'contain_blur' ? 'contain_blur' : 'cover';
  const base = fit === 'cover' ? Math.max(box.w / R.w, box.h / R.h) : Math.min(box.w / R.w, box.h / R.h);
  const cx = pt.area.left + (R.x - C.x) * pt.s + (R.w * pt.s) / 2, cy = pt.area.top + (R.y - C.y) * pt.s + (R.h * pt.s) / 2;
  return {
    ...auto,
    framing: {
      fit, zoom: r4(limita(pt.s / base, LIMITES_DOC_V3.zoomMin, LIMITES_DOC_V3.zoomMax)),
      panX: r4(limita((cx - box.w / 2) / canvas.width, -LIMITES_DOC_V3.panAbsMax, LIMITES_DOC_V3.panAbsMax)),
      panY: r4(limita((cy - box.h / 2) / canvas.height, -LIMITES_DOC_V3.panAbsMax, LIMITES_DOC_V3.panAbsMax)),
    },
  };
};

/** Caixa ∩ canvas ∩ área pintada, px do canvas. */
export const visivelNoCanvas = (box: Rect, pt: ReturnType<typeof pinturaNaCaixa>, W: number, H: number): Rect => {
  const x0 = Math.max(0, box.x, box.x + pt.area.left), y0 = Math.max(0, box.y, box.y + pt.area.top);
  const x1 = Math.min(W, box.x + box.w, box.x + pt.area.left + pt.area.w), y1 = Math.min(H, box.y + box.h, box.y + pt.area.top + pt.area.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

export const mesmaCaixa = (a: RectFracao | null | undefined, b: RectFracao | null | undefined) =>
  (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4);
const mesmoFraming = (a: VideoFraming | null | undefined, b: VideoFraming | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.fit === b.fit && Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.panX - b.panX) < 1e-4 && Math.abs(a.panY - b.panY) < 1e-4);

/** §4: mudou a caixa e o `framing` veio igual ao anterior = framing velho, zera (auto reframe). Framing diferente é decisão do cliente. */
export const framingAposCaixa = (
  atual: Pick<VideoEdit, 'box' | 'framing'> | null | undefined, anterior: Pick<VideoEdit, 'box' | 'framing'> | null | undefined,
): VideoFraming | null => {
  const f = atual?.framing ?? null;
  if (!f || !anterior) return f;
  return !mesmaCaixa(atual?.box, anterior.box) && mesmoFraming(f, anterior.framing) ? null : f;
};

/** Gesto do web na camada de vídeo → doc novo (imutável). Patch com `box` e sem `framing` volta ao auto reframe; `null` limpa o campo. */
export const comVideoEditado = (
  doc: AnyEditDoc | null | undefined,
  patch: { box?: RectFracao | null; framing?: VideoFraming | null; trim?: { inSec: number; outSec: number } | null },
  ctx?: { format: FormatCode; principal: FormatCode },
): EditDocV3 | null => {
  const d: EditDocV3 = docV3De(doc) ?? { version: 3, clips: [], trim: null, layers: [], captionWords: [] };
  const noPrincipal = !ctx || ctx.format === ctx.principal;
  const geo = (g: Pick<VideoEdit, 'box' | 'framing'> | null | undefined) => {
    const box = 'box' in patch ? patch.box ?? null : g?.box ?? null;
    const framing = 'framing' in patch ? patch.framing ?? null : 'box' in patch ? null : g?.framing ?? null;
    return { ...(box && { box }), ...(framing && { framing }) };
  };
  const out: EditDocV3 = { ...d };
  const trim = 'trim' in patch ? patch.trim ?? null : d.video?.trim ?? null;
  const principal = noPrincipal ? geo(d.video) : { ...(d.video?.box && { box: d.video.box }), ...(d.video?.framing && { framing: d.video.framing }) };
  const video: VideoEdit = { layerId: 'video', ...principal, ...(trim && { trim }) };
  if (videoEditVazio(video)) delete out.video; else out.video = video;
  if (!noPrincipal) {
    const fmt = ctx!.format;
    const atual = d.formatOverrides?.[fmt];
    const g = geo(atual?.video);
    const prox = { layers: atual?.layers ?? [], ...(Object.keys(g).length && { video: g }) };
    const overrides = { ...d.formatOverrides };
    if (prox.layers.length || Object.keys(g).length) overrides[fmt] = prox; else delete overrides[fmt];
    if (Object.keys(overrides).length) out.formatOverrides = overrides; else delete out.formatOverrides;
  }
  return docV3Vazio(out) ? null : out;
};

/** Trechos da timeline dentro do corte (segundos do arquivo). */
export const timelineAparada = <T extends { startSec: number; endSec: number }>(tl: T[], inSec: number, outSec: number): T[] => {
  const r = tl.flatMap((t) => {
    const a = Math.max(t.startSec, inSec), b = Math.min(t.endSec, outSec);
    return b > a ? [{ ...t, startSec: a, endSec: b }] : [];
  });
  return r.length ? r : tl;
};
