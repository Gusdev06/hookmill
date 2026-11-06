// Entrada única do manifesto e da normalização (editor-universal-v1 §3.1, §5). `manifestoDe` é puro: a API chama e entrega
// no GET; o web usa o que veio. F-U1: `frame:<id>` e `headline`. As outras famílias entram nas fases delas (F-U2…F-U4).
import type { MolduraProps } from '../molduras';
import type { RemixKeepProps } from '../remix';
import { corHex, docV3De, docV3Vazio, limitaTransformV3, rectNaFaixa, rectValido, transformValido } from './comum';
import { HEADLINE_TEXT_LAYER_ID, manifestoHeadline, resolverPropsHeadline } from './headline';
import { manifestoMoldura, resolverPropsMoldura, textosDaMoldura } from './moldura';
import { framingAposCaixa, mesmaCaixa, trimDoDoc } from './video';
import type { AnyEditDoc, EditDocLayerV3, EditDocV3, EditManifest, EditTemplateKey, FormatCode, FormatGeometry, ItemEdit, TextConfirmation, VideoFraming } from './tipos';

export interface OpcoesManifesto {
  /** formatos que a peça aceita (o 1º é o principal). Molduras: padrão os 3 */
  formats?: FormatCode[];
  /** HEADLINE: limite de caracteres do plano (headline.maxChars); null = sem limite no editor */
  headlineMaxChars?: number | null;
}

/** Famílias com manifesto e resolver prontos (F-U1). As outras respondem `editor.available: false`. */
export const templateKeyEditavel = (k: string): boolean => k === 'headline' || k.startsWith('frame:');

/**
 * Manifesto da peça (§3): o do template, refinado pela base (ex.: `video:2` só onde há 2ª fonte, `burned` só com legenda
 * queimada, `brand` só onde a moldura desenha a marca solta). Lança com família ainda não ligada.
 */
export function manifestoDe(templateKey: EditTemplateKey, base: MolduraProps | RemixKeepProps, o: OpcoesManifesto = {}): EditManifest {
  if (templateKey.startsWith('frame:')) {
    const b = base as MolduraProps;
    if (`frame:${b.frame?.id}` !== templateKey) throw new Error(`manifestoDe: base da moldura ${b.frame?.id} não é ${templateKey}`);
    return manifestoMoldura(b, o.formats);
  }
  if (templateKey === 'headline') return manifestoHeadline(base as RemixKeepProps, { maxChars: o.headlineMaxChars ?? null });
  throw new Error(`manifestoDe: ${templateKey} ainda não tem manifesto (fase posterior ao F-U1)`);
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const rect4 = (r: { x: number; y: number; w: number; h: number }) => ({ x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h) });
const framing4 = (f: VideoFraming): VideoFraming => ({ fit: f.fit, zoom: r4(f.zoom), panX: r4(f.panX), panY: r4(f.panY) });

/** Textos da base por caminho (`layer:<id>`, `item:<layerId>/<itemId>`). */
const textosDaBase = (manifest: EditManifest, base: MolduraProps | RemixKeepProps): Map<string, string> => {
  if (manifest.templateKey.startsWith('frame:')) return textosDaMoldura(base as MolduraProps);
  const l = (base as RemixKeepProps).textLayers?.find((x) => x.id === HEADLINE_TEXT_LAYER_ID);
  return new Map(l && l.content.kind === 'static' ? [['layer:headline', l.content.text]] : []);
};

/**
 * Forma canônica que o PUT grava e devolve (§5): tira camada/campo/opção/item igual ao padrão, descarta o que o manifesto
 * não conhece, a última entrada de cada camada vale, confirmação: a última por caminho. `anterior` (o doc salvo, no PUT): mudar
 * `video.box` mantendo o `framing` de antes zera o `framing`. Doc que sobra vazio = null (= render de hoje). Assume doc já
 * validado (`validarDoc<Família>`).
 */
export const normalizarDocV3 = (doc: AnyEditDoc | null | undefined, base: MolduraProps | RemixKeepProps, manifest: EditManifest, anterior?: AnyEditDoc | null): EditDocV3 | null => {
  const d = docV3De(doc);
  if (!d) return null;
  const decl = new Map(manifest.layers.map((l) => [l.id, l]));
  const textos = textosDaBase(manifest, base);

  const porCamada = new Map<string, EditDocLayerV3>();
  for (const l of d.layers ?? []) {
    const dl = l && decl.get(l.id);
    if (!dl || dl.lockedReason || dl.kind === 'video') continue;
    const n: EditDocLayerV3 = { id: l.id };
    if (l.visible === false && dl.optional) n.visible = false;
    if (transformValido(l.transform) && (dl.editable.move || dl.editable.resize)) n.transform = limitaTransformV3(l.transform);
    if (rectValido(l.rect) && rectNaFaixa(l.rect) && (dl.editable.move || dl.editable.resize)) n.rect = rect4(l.rect);
    if (typeof l.text === 'string' && dl.editable.text && l.text !== textos.get(`layer:${l.id}`)) n.text = l.text.slice(0, 300);
    if (corHex(l.fill) && dl.editable.fill) n.fill = l.fill;
    if (l.style && dl.editable.style && Object.keys(l.style).length) n.style = { ...l.style };
    if (l.timing && dl.editable.timing) n.timing = l.timing;
    porCamada.set(l.id, n);
  }
  const layers = [...porCamada.values()].filter((l) => Object.keys(l).length > 1);

  const opcoes = new Set(manifest.controls.flatMap((c) => ('key' in c ? [c.key] : [])));
  const templateOpts: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(d.templateOpts ?? {})) {
    if (!opcoes.has(k)) continue;
    const pad = manifest.defaults[k];
    const igual = typeof v === 'string' && typeof pad === 'string' ? v.toLowerCase() === pad.toLowerCase() : v === pad;
    if (!igual) templateOpts[k] = v;
  }

  const items: Record<string, ItemEdit[]> = {};
  for (const [lid, xs] of Object.entries(d.items ?? {})) {
    const por = new Map<string, ItemEdit>();
    for (const it of xs ?? []) {
      if (!it?.id || !textos.has(`item:${lid}/${it.id}`)) continue;
      const n: ItemEdit = { id: it.id };
      if (typeof it.text === 'string' && it.text !== textos.get(`item:${lid}/${it.id}`)) n.text = it.text.slice(0, 300);
      if (typeof it.atSec === 'number') n.atSec = it.atSec;
      if (it.side) n.side = it.side;
      if (Object.keys(n).length > 1) por.set(it.id, n); else por.delete(it.id);
    }
    if (por.size) items[lid] = [...por.values()];
  }

  const conf = new Map<string, TextConfirmation>();
  for (const c of d.confirmations ?? []) if (c?.path && Array.isArray(c.numbers) && c.numbers.length) conf.set(c.path, c);

  const formatOverrides: Partial<Record<FormatCode, FormatGeometry>> = {};
  for (const [fmt, g] of Object.entries(d.formatOverrides ?? {})) {
    if (!g || !manifest.formats.includes(fmt as FormatCode) || fmt === manifest.formats[0]) continue;
    const ls = (g.layers ?? []).filter((l) => decl.has(l.id) && !decl.get(l.id)!.lockedReason)
      .map((l) => ({ id: l.id, ...(transformValido(l.transform) && { transform: limitaTransformV3(l.transform) }), ...(rectValido(l.rect) && { rect: rect4(l.rect) }) }))
      .filter((l) => Object.keys(l).length > 1);
    const antes = docV3De(anterior)?.formatOverrides?.[fmt as FormatCode]?.video;
    const gf = g.video ? framingAposCaixa(g.video, antes) : null;
    const gv = { ...(g.video?.box && { box: rect4(g.video.box) }), ...(gf && { framing: framing4(gf) }) };
    const temV = Object.keys(gv).length > 0;
    if (ls.length || temV) formatOverrides[fmt as FormatCode] = { layers: ls, ...(temV && { video: gv }) };
  }

  // vídeo: caixa igual à do template some (a comparação é com o layout do doc SEM vídeo: o texto pode mexer na caixa do template);
  // aparar o vídeo inteiro some; sem nada, o campo inteiro some
  let video: EditDocV3['video'] = null;
  if (d.video) {
    const semVideo: EditDocV3 = { ...d, video: null };
    const principal = manifest.formats[0];
    const padrao = manifest.templateKey.startsWith('frame:')
      ? resolverPropsMoldura(base as MolduraProps, semVideo, { format: principal, principal }).layout.video?.box
      : resolverPropsHeadline(base as RemixKeepProps, semVideo, { format: principal, principal }).layout.video?.box;
    const lim = decl.get('video')?.video;
    const box = d.video.box && !mesmaCaixa(d.video.box, padrao) ? rect4(d.video.box) : null;
    const framing = framingAposCaixa({ box, framing: d.video.framing ?? null }, docV3De(anterior)?.video);
    const t = lim ? trimDoDoc(d, lim.trimMinSec, lim.trimMaxSec) : null;
    if (box || framing || t) {
      video = { layerId: 'video', ...(box && { box }), ...(framing && { framing: framing4(framing) }), ...(t && { trim: { inSec: Math.round(t.inSec * 1000) / 1000, outSec: Math.round(t.outSec * 1000) / 1000 } }) };
    }
  }

  const out: EditDocV3 = {
    version: 3, clips: d.clips ?? [], trim: null, layers, captionWords: d.captionWords ?? [],
    ...(Object.keys(templateOpts).length && { templateOpts }),
    ...(video && { video }),
    ...(Object.keys(items).length && { items }),
    ...(d.clipSwaps?.length && { clipSwaps: d.clipSwaps }),
    ...(conf.size && { confirmations: [...conf.values()] }),
    ...(Object.keys(formatOverrides).length && { formatOverrides }),
  };
  return docV3Vazio(out) ? null : out;
};
