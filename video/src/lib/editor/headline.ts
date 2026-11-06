// Família HEADLINE do editor universal (editor-universal-v1 §3.2-§5, F-U1): a peça AUTO HEADLINE é um `RemixKeep` montado
// pelo buildHeadlineInput (camada de texto 'headline-nova' com faixa/placa). Manifesto, resolver e validação. Puro.
// Camadas do editor: `headline` (texto: conteúdo, estilo, posição/escala por `transform`) e `headline:box` (faixa/placa:
// `rect` e `fill`). Mover/redimensionar a caixa leva o texto junto (proporcional) enquanto o texto não tiver `transform`.
// F-U2: vídeo do cliente (caixa, enquadramento, aparar), ver video.ts: `edicao.video` na composição; camadas, karaokê e faixas deslocados.
// Doc nulo/vazio = a base como veio (mesmo objeto).
import type { LayerId } from '../editor';
import { FRAME_MIN_FONT_PX, medirTexto, pinturaNaCaixa, type FrameFontKey, type FrameReframe, type Rect } from '../molduras';
import { FONT_CATALOG, tokensDoTexto, type RemixKeepProps, type RemixTextLayer } from '../remix';
import { camadaDoDoc, corHex, docV3De, docV3Vazio, editavel, fracaoParaPx, geometriaDaCamada, pxParaFracao, validarEstruturaAuto, NADA } from './comum';
import { enquadrarVideo, limitesDoVideo, mesmaCaixa, trimDoDoc, videoNoFormato, visivelNoCanvas, type FonteDoVideo } from './video';
import type { AnyEditDoc, ControlDecl, CtxResolver, EditDocErrorV3, EditDocV3, EditLayout, EditLayoutLayer, EditManifest, FormatCode, LayerDecl, ResolvidoEditor, TextoEditor, VideoFraming } from './tipos';

/** id da camada de texto que o buildHeadlineInput cria (api/src/render/headline.ts) e da legenda automática. */
export const HEADLINE_TEXT_LAYER_ID = 'headline-nova';
export const HEADLINE_CAPTION_LAYER_ID = 'legenda-auto';
/** id da camada no editor ← id da camada de texto do RemixKeep (vira `data-layer` na composição). */
export const ID_EDITOR_DA_CAMADA_REMIX: Record<string, LayerId> = { [HEADLINE_TEXT_LAYER_ID]: 'headline', [HEADLINE_CAPTION_LAYER_ID]: 'caption' };

/** Formato do quadro do campeão (o RemixKeep renderiza na grade dele): o mais perto de 9:16, 4:5 ou 1:1. */
export const formatoDoQuadro = (w: number, h: number): FormatCode => {
  const a = w / h;
  const alvos: [FormatCode, number][] = [['9x16', 9 / 16], ['4x5', 4 / 5], ['1x1', 1]];
  return alvos.reduce((m, x) => (Math.abs(x[1] - a) < Math.abs(m[1] - a) ? x : m))[0];
};
const camadaHeadline = (p: RemixKeepProps) => p.textLayers.find((l) => l.id === HEADLINE_TEXT_LAYER_ID) ?? null;
const textoDe = (l: RemixTextLayer | null) => (l && l.content.kind === 'static' ? l.content.text : '');

/** Fonte do catálogo → tabela de medida (a mesma do buildHeadlineInput). */
const MEDIDA: Record<string, FrameFontKey> = {
  'inter-800': 'inter-800', 'montserrat-800': 'montserrat-800', 'montserrat-900': 'montserrat-900', 'anton-400': 'anton-400',
  'archivo-black-400': 'archivo-black-400', 'oswald-700': 'anton-400', 'bebas-neue-400': 'anton-400', 'poppins-800': 'montserrat-800', 'roboto-condensed-700': 'inter-800',
};
/** Tamanho que cabe na caixa (mesma regra do `ajustarTexto` da composição: passos de 4 %, fichas por palavra/ideograma),
 *  medido pela tabela do video (Node e navegador dão a mesma resposta). */
export const tamanhoQueCabeHeadline = (l: RemixTextLayer): { size: number; fits: boolean } => {
  const st = l.style;
  const f = MEDIDA[st.fontId] ?? 'montserrat-800';
  const toks = tokensDoTexto(textoDe(l));
  const larg = (t: string, s: number) => medirTexto(f, st.uppercase ? t.toUpperCase() : t, s);
  const contorno = st.strokeColor ? st.strokeWidthPx * 2 : 0;
  let size = st.fontSizePx;
  for (let tent = 0; tent < 60; tent++) {
    const esp = larg(' ', size);
    let linhas = 1, w = 0, estoura = false, primeira = true;
    for (const t of toks) {
      const pw = larg(t.t, size);
      if (pw + contorno > l.box.w) estoura = true;
      const sp = t.espaco ? esp : 0;
      if (!primeira && w + sp + pw + contorno > l.box.w) { linhas++; w = pw; } else { w += (primeira ? 0 : sp) + pw; }
      primeira = false;
    }
    if (!estoura && linhas * size * st.lineHeight <= l.box.h + 0.5) return { size, fits: true };
    size *= 0.96;
  }
  return { size, fits: false };
};

// ───────────────────────── manifesto ─────────────────────────
export const manifestoHeadline = (base: RemixKeepProps, o: { maxChars?: number | null } = {}): EditManifest => {
  const fmt = formatoDoQuadro(base.canvas.width, base.canvas.height);
  const tem = !!camadaHeadline(base);
  const layers: LayerDecl[] = [];
  if (tem) {
    layers.push({
      id: 'headline', kind: 'text', labelKey: 'editor.layer.headline.headline',
      editable: editavel({ move: true, resize: true, text: true, style: true }),
      limits: { maxChars: o.maxChars ?? null, maxLines: null, minFontPx: FRAME_MIN_FONT_PX }, optional: false, lockedReason: null, leavesEmptyCover: false,
    });
    layers.push({ id: 'headline:box', kind: 'box', labelKey: 'editor.layer.headline.headline:box', editable: editavel({ move: true, resize: true, fill: true }), limits: null, optional: false, lockedReason: null, leavesEmptyCover: false });
  }
  if (base.outputProtectedBands?.some((b) => b.kind === 'original')) {
    layers.push({ id: 'burned', kind: 'burned', labelKey: 'editor.layer.burned', editable: { ...NADA }, limits: null, optional: false, lockedReason: 'burned_caption_pixels', leavesEmptyCover: false });
  }
  layers.push({
    id: 'video', kind: 'video', labelKey: 'editor.layer.video', editable: editavel({ move: true, resize: true, reframe: true, trim: true }), limits: null, optional: false, lockedReason: null, leavesEmptyCover: false,
    video: limitesDoVideo(0, base.canvas.frameCount / base.canvas.fps),
  });
  const controls: ControlDecl[] = [];
  if (tem) controls.push({ type: 'rows', group: 'content', layers: ['headline'], itemsOf: null, timed: false });
  controls.push({ type: 'guides', group: 'guides' });
  return { manifestVersion: 1, templateKey: 'headline', formats: [fmt], layers, controls, defaults: {}, clientImage: true };
};

// ───────────────────────── vídeo ─────────────────────────
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const REFRAME_BASE: FrameReframe = { mode: 'cover', focus: { x: 0.5, y: 0.5 } };

/** A grade do campeão como fonte do enquadramento: canvas = arquivo; as faixas originais da saída estão em px do arquivo. */
const fonteDaHeadline = (p: RemixKeepProps): FonteDoVideo => {
  const prot = (p.outputProtectedBands ?? []).filter((b) => b.kind === 'original').map(({ x, y, w, h, startSec, endSec }) => ({ x, y, w, h, startSec, endSec }));
  return {
    source: { width: p.canvas.width, height: p.canvas.height, durationSec: p.canvas.frameCount / p.canvas.fps },
    contentBox: null, reframe: REFRAME_BASE, protectedBands: prot, faceSafeBand: prot.length && p.faceHint ? p.faceHint : null, faceHint: p.faceHint ?? null,
  };
};

/** Aparar: camadas, karaokê e overlays pro tempo da saída; o que cai todo fora do corte sai das props (fica no doc). */
const aparar = (p: RemixKeepProps, inF: number, outF: number): RemixKeepProps => {
  const n = outF - inF;
  const faixa = <T extends { startFrame: number; endFrame: number }>(x: T): T | null => {
    const a = Math.max(0, x.startFrame - inF), b = Math.min(n, x.endFrame - inF);
    return b > a ? { ...x, startFrame: a, endFrame: b } : null;
  };
  const textLayers = p.textLayers.flatMap((l) => {
    const f = faixa(l);
    if (!f) return [];
    if (f.content.kind === 'karaoke') {
      const words = f.content.words.flatMap((w) => { const q = faixa(w); return q ? [q] : []; });
      return [{ ...f, content: { ...f.content, words } }];
    }
    return [f];
  });
  const fps = p.canvas.fps;
  const overlays = p.overlays.flatMap((o) => {
    const f = faixa(o);
    return f ? [{ ...f, clipOffsetSec: o.clipOffsetSec + Math.max(0, inF - o.startFrame) / fps }] : [];
  });
  return { ...p, canvas: { ...p.canvas, frameCount: n }, textLayers, overlays };
};

/** Faixas de legenda da saída depois da caixa/enquadramento e do aparar (a checagem por visão confere onde elas foram parar). */
const faixasDepois = (bands: NonNullable<RemixKeepProps['outputProtectedBands']>, box: Rect | null, pt: ReturnType<typeof pinturaNaCaixa> | null, inSec: number, durSec: number, W: number, H: number) =>
  bands.flatMap((b) => {
    const a = Math.max(0, b.startSec - inSec), z = Math.min(durSec, b.endSec - inSec);
    if (z <= a) return [];
    if (!box || !pt) return [{ ...b, startSec: r3(a), endSec: r3(z) }];
    const x = box.x + pt.area.left + b.x * pt.s, y = box.y + pt.area.top + b.y * pt.s;
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + b.w * pt.s), y1 = Math.min(H, y + b.h * pt.s);
    return x1 - x0 > 1 && y1 - y0 > 1 ? [{ ...b, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), startSec: r3(a), endSec: r3(z) }] : [];
  });

// ───────────────────────── resolver ─────────────────────────

/**
 * `base` (RemixKeep do buildHeadlineInput, SEM doc) + doc → props + layout + textos. Ordem: caixa (rect/fill) → texto e
 * estilo → posição/escala do texto (`transform`). O RemixKeep re-ajusta o texto na caixa (ajustarTexto) no render.
 */
export const resolverPropsHeadline = (base: RemixKeepProps, doc: AnyEditDoc | null | undefined, ctx: CtxResolver): ResolvidoEditor<RemixKeepProps> => {
  const fmt = formatoDoQuadro(base.canvas.width, base.canvas.height);
  const principal = ctx.principal ?? fmt;
  const { width: W, height: H, fps } = base.canvas;
  const d = docV3De(doc);
  const orig = camadaHeadline(base);
  let props = base;
  let editado = false;
  if (!docV3Vazio(d) && orig) {
    const l: RemixTextLayer = { ...orig, box: { ...orig.box }, style: { ...orig.style }, background: { ...orig.background, box: orig.background.box ? { ...orig.background.box } : null }, content: { ...orig.content } as RemixTextLayer['content'] };
    const cTexto = camadaDoDoc(d!, 'headline');
    const cCaixa = camadaDoDoc(d!, 'headline:box');
    // caixa (faixa/placa): rect move/redimensiona; o texto acompanha proporcionalmente
    const gCaixa = geometriaDaCamada(d!, 'headline:box', fmt, principal);
    const bg0 = orig.background.box ?? orig.box;
    if (gCaixa.rect) {
      const nb = { x: r2(gCaixa.rect.x * W), y: r2(gCaixa.rect.y * H), w: r2(gCaixa.rect.w * W), h: r2(gCaixa.rect.h * H) };
      const sx = nb.w / bg0.w, sy = nb.h / bg0.h;
      l.background.box = nb;
      l.box = { x: r2(nb.x + (orig.box.x - bg0.x) * sx), y: r2(nb.y + (orig.box.y - bg0.y) * sy), w: r2(orig.box.w * sx), h: r2(orig.box.h * sy) };
    }
    if (corHex(cCaixa?.fill) && l.background.kind !== 'none') l.background.color = cCaixa!.fill!;
    // texto e estilo
    if (typeof cTexto?.text === 'string' && cTexto.text.trim() && l.content.kind === 'static') l.content = { kind: 'static', text: cTexto.text };
    const s = cTexto?.style;
    if (s) {
      if (s.fontId && Object.prototype.hasOwnProperty.call(FONT_CATALOG, s.fontId)) l.style.fontId = s.fontId as RemixTextLayer['style']['fontId'];
      if (corHex(s.color)) l.style.color = s.color;
      if (s.highlightColor === null || corHex(s.highlightColor)) l.style.highlightColor = s.highlightColor ?? null;
      if (s.strokeColor === null || corHex(s.strokeColor)) l.style.strokeColor = s.strokeColor ?? null;
      if (typeof s.strokeWidthPx === 'number' && Number.isFinite(s.strokeWidthPx)) l.style.strokeWidthPx = Math.min(60, Math.max(0, s.strokeWidthPx));
      if (typeof s.uppercase === 'boolean') l.style.uppercase = s.uppercase;
      if (typeof s.shadow === 'boolean') l.style.shadow = s.shadow;
      if (s.align === 'left' || s.align === 'center' || s.align === 'right') l.style.align = s.align;
    }
    // posição/escala do texto: centro (fração do canvas), largura de quebra e escala da fonte
    const gTexto = geometriaDaCamada(d!, 'headline', fmt, principal);
    if (gTexto.transform) {
      const t = gTexto.transform;
      const w = t.boxWidth * W, h = orig.box.h * t.scale;
      l.box = { x: r2(t.x * W - w / 2), y: r2(t.y * H - h / 2), w: r2(w), h: r2(h) };
      l.style.fontSizePx = r2(orig.style.fontSizePx * t.scale);
    }
    editado = textoDe(l) !== textoDe(orig);
    props = { ...base, textLayers: base.textLayers.map((x) => (x.id === HEADLINE_TEXT_LAYER_ID ? l : x)) };
  }

  // vídeo do cliente (§4): caixa/enquadramento → aparar. Na HEADLINE o vídeo é a tela cheia da grade do campeão
  const tela = { x: 0, y: 0, w: 1, h: 1 };
  const telaPx = { x: 0, y: 0, w: W, h: H };
  const durBase = base.canvas.frameCount / fps;
  const fonte = fonteDaHeadline(base);
  let caixaPx: Rect = telaPx;
  let enq = enquadrarVideo(fonte, telaPx, false, null, { width: W, height: H });
  let videoEditado = false;
  if (!docV3Vazio(d)) {
    const dd = d as EditDocV3;
    const { box, framing } = videoNoFormato(dd, fmt, principal);
    const caixaMudou = !!box && !mesmaCaixa(box, tela);
    videoEditado = caixaMudou || !!framing;
    if (videoEditado) {
      if (caixaMudou) { const q = fracaoParaPx(box!, W, H); caixaPx = { x: r2(q.x), y: r2(q.y), w: r2(q.w), h: r2(q.h) }; }
      enq = enquadrarVideo(fonte, caixaPx, caixaMudou, framing, { width: W, height: H });
    }
    const trim = trimDoDoc(dd, 0, durBase);
    const inF = trim ? Math.round(trim.inSec * fps) : 0;
    const outF = trim ? Math.min(base.canvas.frameCount, Math.round(trim.outSec * fps)) : base.canvas.frameCount;
    if (trim) props = aparar(props, inF, outF);
    if (videoEditado || trim) {
      const pt = videoEditado ? pinturaNaCaixa(caixaPx, fonte.source, enq.reframe, enq.contentBox) : null;
      props = {
        ...props,
        edicao: { video: { inFrame: inF, pintura: videoEditado ? { box: caixaPx, reframe: enq.reframe, contentBox: enq.contentBox } : null } },
        ...(base.outputProtectedBands && { outputProtectedBands: faixasDepois(base.outputProtectedBands, videoEditado ? caixaPx : null, pt, inF / fps, (outF - inF) / fps, W, H) }),
      };
    }
  }
  const inSec = (props.edicao?.video.inFrame ?? 0) / fps;

  // layout
  const fr = (r: { x: number; y: number; w: number; h: number }) => pxParaFracao(r, W, H);
  const durSec = props.canvas.frameCount / fps;
  const u = 1080 / W; // fontPx do layout = px a 1080 de largura
  const layers: EditLayoutLayer[] = [];
  const textos: TextoEditor[] = [];
  const h = camadaHeadline(props);
  if (h) {
    const fit = tamanhoQueCabeHeadline(h);
    const de = h.startFrame / fps, ate = h.endFrame / fps;
    layers.push({ id: 'headline', kind: 'text', rect: fr(h.box), rotationDeg: 0, fromSec: de, toSec: ate, visible: true, text: textoDe(h), fontPx: r2(fit.size * u) });
    layers.push({ id: 'headline:box', kind: 'box', rect: fr(h.background.box ?? h.box), rotationDeg: 0, fromSec: de, toSec: ate, visible: h.background.kind !== 'none', text: null, fontPx: null });
    const fundo = h.background.kind !== 'none' && corHex(h.background.color) ? h.background.color : null;
    textos.push({ path: 'layer:headline', layerId: 'headline', itemId: null, text: textoDe(h), edited: editado, maxChars: null, minFontPx: FRAME_MIN_FONT_PX, fontPx: r2(fit.size * u), fits: fit.fits, contrast: fundo ? { color: h.style.color, background: fundo } : null });
  }
  const queimadas = (props.outputProtectedBands ?? []).filter((b) => b.kind === 'original');
  if (base.outputProtectedBands?.some((b) => b.kind === 'original') && !queimadas.length) {
    // o manifesto declara `burned`: a camada continua na lista, invisível (saiu do corte ou do quadro)
    layers.push({ id: 'burned', kind: 'burned', rect: { x: 0, y: 0, w: 0, h: 0 }, rotationDeg: 0, fromSec: 0, toSec: durSec, visible: false, text: null, fontPx: null });
  }
  if (queimadas.length) {
    const x0 = Math.min(...queimadas.map((b) => b.x)), y0 = Math.min(...queimadas.map((b) => b.y));
    const x1 = Math.max(...queimadas.map((b) => b.x + b.w)), y1 = Math.max(...queimadas.map((b) => b.y + b.h));
    layers.push({ id: 'burned', kind: 'burned', rect: fr({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), rotationDeg: 0, fromSec: Math.min(...queimadas.map((b) => b.startSec)), toSec: Math.max(...queimadas.map((b) => b.endSec)), visible: true, text: null, fontPx: null });
  }
  const pinta = pinturaNaCaixa(caixaPx, fonte.source, enq.reframe, enq.contentBox);
  const boxFr = fr(caixaPx);
  layers.push({ id: 'video', kind: 'video', rect: boxFr, rotationDeg: 0, fromSec: 0, toSec: durSec, visible: true, text: null, fontPx: null });
  const framing: VideoFraming = enq.framing;
  const layout: EditLayout = {
    format: fmt, canvas: { width: W, height: H }, durationSec: durSec, layers,
    video: {
      layerId: 'video', box: boxFr,
      sourceRect: fr({ x: caixaPx.x + pinta.area.left + pinta.video.left, y: caixaPx.y + pinta.area.top + pinta.video.top, w: pinta.video.w, h: pinta.video.h }),
      fit: framing.fit, auto: enq.reframe.mode !== 'manual', trim: { inSec, outSec: inSec + durSec },
      visibleRect: fr(visivelNoCanvas(caixaPx, pinta, W, H)), framing, edited: videoEditado, checksCaption: true,
    },
  };
  return { props, layout, textos };
};

// ───────────────────────── validação (estrutura → 400) ─────────────────────────
export const validarDocHeadline = (doc: AnyEditDoc | null | undefined, base: RemixKeepProps, ctx?: { manifest?: EditManifest }): EditDocErrorV3[] => {
  const manifest = ctx?.manifest ?? manifestoHeadline(base);
  const r = resolverPropsHeadline(base, doc, { format: manifest.formats[0] });
  const atual = textoDe(camadaHeadline(r.props));
  const erros = validarEstruturaAuto(doc, manifest, (path) => (path === 'layer:headline' && camadaHeadline(base) ? atual : null));
  const d = docV3De(doc);
  (d?.layers ?? []).forEach((l, i) => {
    if (l?.id === 'headline' && l.style?.fontId !== undefined && !Object.prototype.hasOwnProperty.call(FONT_CATALOG, l.style.fontId)) erros.push({ field: `layers[${i}].style.fontId`, rule: 'unknown_font' });
  });
  return erros;
};
