// Peças comuns do editor universal (editor-universal-v1 §4-§6): subir doc v1 pra v3, doc vazio, geometria por formato,
// números ("nada inventado") e validação de estrutura comum a todas as famílias. Puro, sem React.
import type { EditDoc, LayerId } from '../editor';
import type { LayerTransform } from '../schema';
import {
  LIMITES_DOC_V3, type AnyEditDoc, type EditDocErrorV3, type EditDocLayerV3, type EditDocRuleV3, type EditDocV3, type EditManifest,
  type EditorFacts, type FormatCode, type LayerDecl, type LayerEditable, type RectFracao, type TextConfirmation, type VideoEdit,
} from './tipos';

export const FORMAT_CODES: readonly FormatCode[] = ['9x16', '4x5', '1x1'];
export const FORMATO_DO_CODIGO = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' } as const;
export const CODIGO_DO_FORMATO = { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' } as const;

/** Sobe um doc v1 pra v3 sem perda (`version: 3`, `trim: null`, resto igual). v3 passa direto. */
export const docV3De = (doc: AnyEditDoc | null | undefined): EditDocV3 | null => {
  if (!doc) return null;
  if (doc.version === 3) return doc;
  const v1 = doc as EditDoc;
  return { version: 3, clips: v1.clips ?? [], trim: null, layers: v1.layers ?? [], captionWords: v1.captionWords ?? [] };
};

const vazioObj = (o: object | null | undefined) => !o || Object.keys(o).length === 0;
/** `doc.video` sem caixa, enquadramento nem corte: não muda nada. */
export const videoEditVazio = (v: Pick<VideoEdit, 'box' | 'framing'> & { trim?: VideoEdit['trim'] } | null | undefined) => !v || (!v.box && !v.framing && !v.trim);
/** Doc que não muda nada (nulo, ou todas as listas/campos vazios): o resolver devolve a base como veio. */
export const docV3Vazio = (doc: EditDocV3 | null | undefined): boolean =>
  !doc || (!(doc.clips?.length) && !(doc.layers?.length) && !(doc.captionWords?.length) && vazioObj(doc.templateOpts) && videoEditVazio(doc.video)
    && (!doc.items || Object.values(doc.items).every((xs) => !xs?.length)) && !(doc.clipSwaps?.length) && !(doc.confirmations?.length)
    && (!doc.formatOverrides || Object.values(doc.formatOverrides).every((g) => !g || (!(g.layers?.length) && videoEditVazio(g.video)))));

// ── geometria ──
const limita = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const COR_HEX_V3 = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const corHex = (c: unknown): c is string => typeof c === 'string' && COR_HEX_V3.test(c);
export const rectValido = (r: unknown): r is RectFracao =>
  !!r && typeof r === 'object' && ['x', 'y', 'w', 'h'].every((k) => finito((r as Record<string, unknown>)[k])) && (r as RectFracao).w > 0 && (r as RectFracao).h > 0;
/** Caixa de texto/caixa no canvas: -0,25..1,25 (§6.1 `rect_out_of_range`). */
export const rectNaFaixa = (r: RectFracao) => r.x >= -0.25 && r.y >= -0.25 && r.x + r.w <= 1.25 && r.y + r.h <= 1.25 && r.w <= 1.5 && r.h <= 1.5;
export const transformValido = (t: unknown): t is LayerTransform =>
  !!t && typeof t === 'object' && ['x', 'y', 'scale', 'rotationDeg', 'boxWidth'].every((k) => finito((t as Record<string, unknown>)[k]));
export const limitaTransformV3 = (t: LayerTransform): LayerTransform => ({
  x: limita(t.x, -0.25, 1.25), y: limita(t.y, -0.25, 1.25), scale: limita(t.scale, 0.25, 4), rotationDeg: limita(t.rotationDeg, -180, 180), boxWidth: limita(t.boxWidth, 0.1, 1.5),
});
export const pxParaFracao = (r: { x: number; y: number; w: number; h: number }, W: number, H: number): RectFracao => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });
export const fracaoParaPx = (r: RectFracao, W: number, H: number) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });

/** Geometria de uma camada no formato pedido: no principal, a do doc; nos outros, a do `formatOverrides[fmt]` (sem override =
 *  layout do template naquele formato). Visibilidade, texto, estilo e fundo valem em todos os formatos (§4 "Formatos"). */
export const geometriaDaCamada = (doc: EditDocV3, id: LayerId, fmt: FormatCode, principal: FormatCode): { transform: LayerTransform | null; rect: RectFracao | null } => {
  if (fmt === principal) {
    const l = doc.layers.find((x) => x?.id === id);
    return { transform: l && transformValido(l.transform) ? limitaTransformV3(l.transform) : null, rect: l && rectValido(l.rect) ? l.rect : null };
  }
  const g = doc.formatOverrides?.[fmt]?.layers?.find((x) => x?.id === id);
  return { transform: g && transformValido(g.transform) ? limitaTransformV3(g.transform) : null, rect: g && rectValido(g.rect) ? g.rect : null };
};
/** Última entrada de cada camada do doc (a última vale). */
export const camadaDoDoc = (doc: EditDocV3, id: LayerId): EditDocLayerV3 | undefined => {
  let out: EditDocLayerV3 | undefined;
  for (const l of doc.layers ?? []) if (l?.id === id) out = l;
  return out;
};

// ── números ("nada inventado", §6.2) ──
const NUMERO = /\d+(?:[.,]\d+)*/g;
/** Mesma normalização do `numbersIn` da API (api/src/iteracao/regras.ts): só os dígitos ("1.000" = "1000", "97,90" = "9790"). */
export const numerosDoTexto = (s: string): string[] => (s.match(NUMERO) ?? []).map((t) => t.replace(/[.,]/g, ''));
const digitos = (n: string) => n.replace(/[.,]/g, '');
/** Números do texto que não estão nos fatos (fala + Brain) nem confirmados naquele `path` ("It's true, keep it"). */
export const numerosNaoConfirmados = (texto: string, facts: EditorFacts | null | undefined, confirmations: TextConfirmation[] | null | undefined, path: string): string[] => {
  const ok = new Set((facts?.numbers ?? []).map(digitos));
  for (const c of confirmations ?? []) if (c?.path === path) for (const n of c.numbers ?? []) ok.add(digitos(String(n)));
  return [...new Set(numerosDoTexto(texto))].filter((n) => !ok.has(n));
};

// ── manifesto ──
export const NADA: LayerEditable = { move: false, resize: false, rotate: false, text: false, style: false, fill: false, timing: false, hide: false, reframe: false, trim: false };
export const editavel = (o: Partial<LayerEditable>): LayerEditable => ({ ...NADA, ...o });

// ── estrutura comum (§6.1) ──
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? '').length;

/**
 * Regras de estrutura que valem pra toda peça AUTO (molduras, HEADLINE…): limites, campos que a família não usa no F-U1,
 * camadas × `editable` do manifesto, opções de template, itens, confirmações e formatos. A família soma as dela.
 * `textoAtual(path)` = texto final daquele caminho (pra `bad_confirmation`); null = caminho desconhecido.
 */
export const validarEstruturaAuto = (doc: AnyEditDoc | null | undefined, manifest: EditManifest, textoAtual: (path: string) => string | null): EditDocErrorV3[] => {
  const d = docV3De(doc);
  if (!d) return [];
  const erros: EditDocErrorV3[] = [];
  const err = (field: string, rule: EditDocRuleV3) => erros.push({ field, rule });
  if (bytes(d) > LIMITES_DOC_V3.docBytes) err('doc', 'doc_too_large');
  if ((d.layers?.length ?? 0) > LIMITES_DOC_V3.layers) err('layers', 'doc_too_large');
  if ((d.captionWords?.length ?? 0) > LIMITES_DOC_V3.captionWords) err('captionWords', 'doc_too_large');
  if (d.clips?.length) err('clips', 'not_editable');
  if ((doc as EditDoc).trim) err('trim', 'trim_out_of_range');
  // F-U2: troca de b-roll e nossa legenda ainda não entram nas peças AUTO
  if (d.captionWords?.length) err('captionWords', 'not_editable');
  if ((d.clipSwaps?.length ?? 0) > LIMITES_DOC_V3.clipSwaps) err('clipSwaps', 'doc_too_large');
  (d.clipSwaps ?? []).forEach((_c, i) => err(`clipSwaps[${i}].clipId`, 'unknown_clip'));

  const decl = new Map(manifest.layers.map((l) => [l.id, l]));
  const validarGeometria = (f: string, l: LayerDecl, g: { transform?: unknown; rect?: unknown }) => {
    if (g.transform != null) {
      if (!l.editable.move && !l.editable.resize) err(`${f}.transform`, 'not_editable');
      else if (!transformValido(g.transform)) err(`${f}.transform`, 'rect_out_of_range');
      else if (!l.editable.rotate && Math.abs((g.transform as LayerTransform).rotationDeg) > 1e-6) err(`${f}.transform.rotationDeg`, 'not_editable');
    }
    if (g.rect != null) {
      if (!l.editable.move && !l.editable.resize) err(`${f}.rect`, 'not_editable');
      else if (!rectValido(g.rect) || !rectNaFaixa(g.rect)) err(`${f}.rect`, 'rect_out_of_range');
    }
  };
  (d.layers ?? []).forEach((l, i) => {
    const f = `layers[${i}]`;
    const dl = l && decl.get(l.id);
    if (!dl) { err(`${f}.id`, 'unknown_layer'); return; }
    if (dl.lockedReason && (l.visible === false || l.transform || l.rect || l.text !== undefined || l.style || l.fill != null || l.timing)) { err(f, 'not_editable'); return; }
    if (l.visible === false && !(dl.optional && dl.editable.hide)) err(`${f}.visible`, 'not_editable');
    // a geometria do vídeo do cliente mora em `doc.video` (§4), não em layers[]
    if (dl.kind === 'video' && (l.rect != null || l.transform != null)) err(`${f}.${l.rect != null ? 'rect' : 'transform'}`, 'not_editable');
    else validarGeometria(f, dl, l);
    if (l.timing && !dl.editable.timing) err(`${f}.timing`, 'not_editable');
    if (l.text !== undefined) {
      if (!dl.editable.text) err(`${f}.text`, 'not_editable');
      else if (typeof l.text !== 'string' || l.text.length > LIMITES_DOC_V3.textChars) err(`${f}.text`, 'doc_too_large');
    }
    if (l.fill != null) {
      if (!dl.editable.fill) err(`${f}.fill`, 'not_editable');
      else if (!corHex(l.fill)) err(`${f}.fill`, 'bad_color');
    }
    if (l.style && Object.keys(l.style).length) {
      if (!dl.editable.style) err(`${f}.style`, 'not_editable');
      else {
        const s = l.style;
        if (s.color !== undefined && !corHex(s.color)) err(`${f}.style.color`, 'bad_color');
        if (s.highlightColor != null && !corHex(s.highlightColor)) err(`${f}.style.highlightColor`, 'bad_color');
        if (s.strokeColor != null && !corHex(s.strokeColor)) err(`${f}.style.strokeColor`, 'bad_color');
        if (s.background?.color != null && !corHex(s.background.color)) err(`${f}.style.background.color`, 'bad_color');
      }
    }
  });

  // vídeo do cliente (F-U2): caixa, enquadramento e aparar
  const dv = decl.get('video');
  const lim = dv?.video;
  const validarGeoVideo = (f: string, g: Pick<VideoEdit, 'box' | 'framing'>) => {
    if (g.box != null) {
      if (!dv?.editable.move && !dv?.editable.resize) err(`${f}.box`, 'not_editable');
      else if (!rectValido(g.box) || g.box.x < -1e-4 || g.box.y < -1e-4 || g.box.x + g.box.w > 1 + 1e-4 || g.box.y + g.box.h > 1 + 1e-4 || g.box.w < LIMITES_DOC_V3.minBoxFrac - 1e-6 || g.box.h < LIMITES_DOC_V3.minBoxFrac - 1e-6) err(`${f}.box`, 'video_box_out_of_canvas');
    }
    if (g.framing != null) {
      const q = g.framing;
      if (!dv?.editable.reframe) { err(`${f}.framing`, 'not_editable'); return; }
      if (q.fit !== 'cover' && q.fit !== 'contain_blur') err(`${f}.framing.fit`, 'bad_template_opt_value');
      if (!finito(q.zoom) || q.zoom < LIMITES_DOC_V3.zoomMin || q.zoom > LIMITES_DOC_V3.zoomMax) err(`${f}.framing.zoom`, 'video_zoom_out_of_range');
      if (!finito(q.panX) || Math.abs(q.panX) > LIMITES_DOC_V3.panAbsMax) err(`${f}.framing.panX`, 'video_pan_out_of_range');
      if (!finito(q.panY) || Math.abs(q.panY) > LIMITES_DOC_V3.panAbsMax) err(`${f}.framing.panY`, 'video_pan_out_of_range');
    }
  };
  if (d.video) {
    if (d.video.layerId !== 'video') err('video.layerId', 'unknown_layer');
    validarGeoVideo('video', d.video);
    const t = d.video.trim;
    if (t != null) {
      if (!dv?.editable.trim || !lim) err('video.trim', 'not_editable');
      else if (!finito(t.inSec) || !finito(t.outSec) || t.inSec >= t.outSec || t.inSec < lim.trimMinSec - 1e-3 || t.outSec > lim.trimMaxSec + 1e-3) err('video.trim', 'trim_out_of_range');
      else if (t.outSec - t.inSec < lim.minTrimSec - 1e-6) err('video.trim', 'trim_too_short');
    }
  }

  // opções de template
  const controles = new Map<string, EditManifest['controls'][number]>();
  for (const c of manifest.controls) if ('key' in c) controles.set(c.key, c);
  for (const [k, v] of Object.entries(d.templateOpts ?? {})) {
    const c = controles.get(k);
    if (!c) { err(`templateOpts.${k}`, 'unknown_template_opt'); continue; }
    if (c.type === 'color' && !corHex(v)) err(`templateOpts.${k}`, 'bad_template_opt_value');
    if (c.type === 'toggle' && typeof v !== 'boolean') err(`templateOpts.${k}`, 'bad_template_opt_value');
    if (c.type === 'segmented' && !c.options.some((o) => o.value === v)) err(`templateOpts.${k}`, 'bad_template_opt_value');
  }

  // itens: só nas camadas que uma tabela `rows` lista como itemsOf
  const rowsDe = new Map<string, Extract<EditManifest['controls'][number], { type: 'rows' }>>();
  for (const c of manifest.controls) if (c.type === 'rows' && c.itemsOf) rowsDe.set(c.itemsOf, c);
  for (const [layerId, xs] of Object.entries(d.items ?? {})) {
    const r = rowsDe.get(layerId);
    if (!r) { err(`items.${layerId}`, 'unknown_layer'); continue; }
    if ((xs?.length ?? 0) > LIMITES_DOC_V3.itemsPerLayer) err(`items.${layerId}`, 'too_many_items');
    (xs ?? []).forEach((it, i) => {
      const f = `items.${layerId}[${i}]`;
      if (!it || textoAtual(`item:${layerId}/${it.id}`) === null) { err(`${f}.id`, 'unknown_item'); return; }
      if (it.text !== undefined && (typeof it.text !== 'string' || it.text.length > LIMITES_DOC_V3.textChars)) err(`${f}.text`, 'doc_too_large');
      if (it.atSec !== undefined && !r.timed) err(`${f}.atSec`, 'not_editable');
      if (it.side !== undefined) err(`${f}.side`, 'not_editable');
    });
  }

  // confirmações: o número confirmado tem que estar no texto atual daquele caminho
  if ((d.confirmations?.length ?? 0) > LIMITES_DOC_V3.confirmations) err('confirmations', 'doc_too_large');
  (d.confirmations ?? []).forEach((c, i) => {
    const t = c && typeof c.path === 'string' ? textoAtual(c.path) : null;
    const nums = t === null ? null : new Set(numerosDoTexto(t));
    if (!nums || !Array.isArray(c.numbers) || c.numbers.some((n) => !nums.has(digitos(String(n))))) err(`confirmations[${i}]`, 'bad_confirmation');
  });

  // formatos
  const principal = manifest.formats[0];
  for (const [fmt, g] of Object.entries(d.formatOverrides ?? {})) {
    if (!g) continue;
    if (!manifest.formats.includes(fmt as FormatCode) || fmt === principal) { err(`formatOverrides.${fmt}`, 'format_not_supported'); continue; }
    if (g.video) validarGeoVideo(`formatOverrides.${fmt}.video`, g.video);
    (g.layers ?? []).forEach((l, i) => {
      const dl = l && decl.get(l.id);
      if (!dl) { err(`formatOverrides.${fmt}.layers[${i}].id`, 'unknown_layer'); return; }
      if (dl.lockedReason) { err(`formatOverrides.${fmt}.layers[${i}]`, 'not_editable'); return; }
      validarGeometria(`formatOverrides.${fmt}.layers[${i}]`, dl, l);
    });
  }
  return erros;
};
