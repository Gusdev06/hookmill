// Família "moldura" do editor universal (editor-universal-v1 §3.2-§5, F-U1): manifesto, resolver e validação das 18
// molduras. Puro (sem React). O resolver aplica no `MolduraProps`: cor da marca (templateOpts.brand), textos dos `slot:*`,
// itens das listas e, pras caixas mexidas/escondidas, `edicao.camadas` (px do canvas) que a composição lê pela <Camada>.
// Doc nulo/vazio = a base como veio (mesmo objeto): render idêntico ao de hoje.
// F-U2: vídeo do cliente (caixa, enquadramento, auto reframe, aparar), ver video.ts. Mexer no vídeo não reposiciona os textos.
// Limitação do F-U1 (anotada no relatório): caixa redimensionada ESCALA o conteúdo por igual (não refaz o fitText na caixa
// nova); a escala entra no `fontPx` e o piso de 36 px vira `text_overflow`.
import { FORMATOS, FPS } from '../formatos';
import { corDaMarca, duracaoMoldura, FRAME_MIN_FONT_PX, layoutDaPeca, pinturaNaCaixa, TEXT_LIMITS, type FrameLayout, type FrameTemplateId, type MolduraProps, type Rect } from '../molduras';
import { faixasProtegidasNaSaida } from '../legendaProtegida';
import { enquadrarVideo, limitesDoVideo, mesmaCaixa, timelineAparada, trimDoDoc, videoNoFormato, visivelNoCanvas, type FonteDoVideo } from './video';
import type { LayerId } from '../editor';
import { CODIGO_DO_FORMATO, FORMATO_DO_CODIGO, FORMAT_CODES, camadaDoDoc, corHex, docV3De, docV3Vazio, editavel, fracaoParaPx, geometriaDaCamada, pxParaFracao, validarEstruturaAuto, NADA } from './comum';
import type { AnyEditDoc, ControlDecl, CtxResolver, EditDocErrorV3, EditDocV3, EditLayout, EditLayoutLayer, EditManifest, FormatCode, LayerDecl, RectFracao, ResolvidoEditor, TextoEditor, VideoFraming } from './tipos';

// ───────────────────────── campos de texto por moldura ─────────────────────────
/** Um texto da moldura: `path` no `frame.texts` (aninhado com ponto), slot do layout que dá a geometria, chave do texto
 *  ajustado (`FrameLayout.text`; null = rótulo de 1 linha que encolhe) e limite em caracteres visíveis. `lista` = array
 *  (vira UMA camada com itens i1…; `textKey` com `{i}` = índice). */
interface Campo { path: string; slot: string | null; textKey: string | null; max: number; lista?: boolean }
const Lm = TEXT_LIMITS;
export const CAMPOS_MOLDURA: Record<FrameTemplateId, Campo[]> = {
  question_box: [{ path: 'question', slot: 'card', textKey: 'question', max: Lm.question_box.question }],
  meme: [{ path: 'pov', slot: 'pov', textKey: 'pov', max: Lm.meme.pov }, { path: 'cta', slot: 'cta', textKey: null, max: Lm.meme.cta }],
  cinema: [{ path: 'question', slot: 'text', textKey: 'question', max: Lm.cinema.question }, { path: 'subtitle', slot: 'text', textKey: 'subtitle', max: Lm.cinema.subtitle }],
  news: [
    { path: 'topic', slot: 'header', textKey: null, max: Lm.news.topic },
    { path: 'headline.lead', slot: 'header', textKey: 'headline', max: Lm.news.lead },
    { path: 'headline.highlight', slot: 'header', textKey: 'headline', max: Lm.news.highlight },
    { path: 'dek', slot: 'header', textKey: 'dek', max: Lm.news.dek },
    { path: 'cta', slot: 'cta', textKey: null, max: Lm.news.cta },
  ],
  read_caption: [{ path: 'headline', slot: 'headline', textKey: 'headline', max: Lm.read_caption.headline }],
  pov_testimonial: [{ path: 'pov', slot: 'pov', textKey: 'pov', max: Lm.pov_testimonial.pov }, { path: 'cta', slot: 'cta', textKey: null, max: Lm.pov_testimonial.cta }],
  direct_offer: [
    { path: 'promise', slot: 'promise', textKey: 'promise', max: Lm.direct_offer.promise },
    { path: 'price.from', slot: 'price', textKey: null, max: Lm.direct_offer.price },
    { path: 'price.to', slot: 'price', textKey: null, max: Lm.direct_offer.price },
    { path: 'cta', slot: 'cta', textKey: null, max: Lm.direct_offer.cta },
  ],
  live: [],
  ranking: [{ path: 'title', slot: 'card', textKey: null, max: Lm.ranking.title }, { path: 'items', slot: 'list', textKey: 'item{i}', max: Lm.ranking.item, lista: true }],
  post_card: [{ path: 'copy', slot: 'card', textKey: 'copy', max: Lm.post_card.copy }],
  split_stack: [{ path: 'headline', slot: 'band', textKey: 'headline', max: Lm.split_stack.headline }],
  split_torn: [{ path: 'headline', slot: 'strip', textKey: 'headline', max: Lm.split_torn.headline }],
  gossip_page: [{ path: 'pageName', slot: 'header', textKey: null, max: Lm.gossip_page.pageName }, { path: 'headline', slot: 'header', textKey: 'headline', max: Lm.gossip_page.headline }],
  gossip_white: [{ path: 'headline', slot: 'header', textKey: 'headline', max: Lm.gossip_white.headline }],
  gossip_pink: [{ path: 'headline', slot: 'card', textKey: 'headline', max: Lm.gossip_pink.headline }],
  call: [
    { path: 'title', slot: 'bar', textKey: null, max: Lm.call.title },
    { path: 'slideTitle', slot: 'slide', textKey: 'title', max: Lm.call.slideTitle },
    { path: 'slideSteps', slot: 'slide', textKey: 'step{i}', max: Lm.call.step, lista: true },
  ],
  call_dialog: [{ path: 'title', slot: 'bar', textKey: null, max: Lm.call_dialog.title }, { path: 'names', slot: null, textKey: null, max: Lm.call_dialog.name, lista: true }],
  story: [
    { path: 'question', slot: 'cartao', textKey: 'question', max: Lm.story.question },
    { path: 'headline', slot: 'grupo', textKey: 'headline', max: Lm.story.headline },
    { path: 'support', slot: 'grupo', textKey: 'support', max: Lm.story.support },
    { path: 'copy', slot: 'grupo', textKey: 'copy', max: Lm.story.copy },
  ],
};
/** Slots do layout que não viram camada: `column` (só a coluna do story), `slideImage` (a 2ª fonte dentro do slide), `brand` (camada própria). */
const SLOTS_FORA = new Set(['column', 'slideImage', 'brand']);
/** Caixas que levam o vídeo do cliente dentro (mover a caixa moveria o vídeo): travadas no F-U1. */
const CAIXAS_COM_VIDEO: Partial<Record<FrameTemplateId, string[]>> = { post_card: ['card'] };
/** Slot "dono" de um texto: a chave do slot é o próprio campo (o texto é a caixa). Os outros slots viram `box:<slot>`. */
const donoDoSlot = (c: Campo) => !c.lista && c.slot !== null && c.slot === c.path;
const idCampo = (c: Campo): LayerId => `slot:${c.path}`;
const idItem = (i: number) => `i${i + 1}`;

const lerPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
const gravarPath = (o: Record<string, unknown>, path: string, v: unknown) => {
  const ks = path.split('.');
  let a = o;
  for (const k of ks.slice(0, -1)) { a[k] = { ...(a[k] as Record<string, unknown>) }; a = a[k] as Record<string, unknown>; }
  a[ks[ks.length - 1]] = v;
};

/** Ids dos slots de caixa (box:*) de uma moldura, na união dos 3 formatos (estável por template). */
const slotsDeCaixa = (id: FrameTemplateId, base: MolduraProps): string[] => {
  const donos = new Set(CAMPOS_MOLDURA[id].filter(donoDoSlot).map((c) => c.slot!));
  const vistos: string[] = [];
  for (const f of FORMAT_CODES) {
    const L = layoutDaPeca({ ...base, format: FORMATO_DO_CODIGO[f] });
    for (const k of Object.keys(L.slots)) if (!SLOTS_FORA.has(k) && !donos.has(k) && !vistos.includes(k)) vistos.push(k);
  }
  return vistos;
};
const temBrand = (base: MolduraProps) => FORMAT_CODES.some((f) => !!layoutDaPeca({ ...base, format: FORMATO_DO_CODIGO[f] }).slots.brand);
const temSegunda = (base: MolduraProps) => FORMAT_CODES.some((f) => !!layoutDaPeca({ ...base, format: FORMATO_DO_CODIGO[f] }).secondBox);
const temQueimada = (base: MolduraProps) => base.captionMode !== 'replace' && (base.video.protectedBands?.length ?? 0) > 0;

// ───────────────────────── manifesto ─────────────────────────
/** Manifesto de `frame:<id>` (§3.2-§3.3): camadas na ordem da frente pra trás, cor da marca, formato, tabela de textos e guias.
 *  Sem looks novos (decisão 7 do arquiteto): só o que a composição já desenha. */
export const manifestoMoldura = (base: MolduraProps, formats: FormatCode[] = [...FORMAT_CODES]): EditManifest => {
  const id = base.frame.id;
  const k = `frame:${id}` as const;
  const lbl = (lid: string) => `editor.layer.${k}.${lid}`;
  const campos = CAMPOS_MOLDURA[id];
  const layers: LayerDecl[] = [];
  const limites = (c: Campo) => ({ maxChars: c.max, maxLines: null, minFontPx: c.textKey ? FRAME_MIN_FONT_PX : null });
  // textos (os "donos" de slot movem; os de dentro de uma caixa só mudam o texto e andam com a caixa)
  for (const c of campos) {
    layers.push({
      id: idCampo(c), kind: 'text', labelKey: lbl(idCampo(c)),
      editable: donoDoSlot(c) ? editavel({ move: true, resize: true, text: true, hide: true }) : editavel({ text: true }),
      limits: limites(c), optional: donoDoSlot(c), lockedReason: null, leavesEmptyCover: false,
    });
  }
  if (temBrand(base)) layers.push({ id: 'brand', kind: 'box', labelKey: lbl('brand'), editable: editavel({ move: true, hide: true }), limits: null, optional: true, lockedReason: null, leavesEmptyCover: false });
  for (const s of slotsDeCaixa(id, base)) {
    // caixa que tem o vídeo do cliente dentro (cartão do post_card): no F-U1 não mexe (o vídeo é camada própria no F-U2)
    const comVideo = CAIXAS_COM_VIDEO[id]?.includes(s);
    layers.push({ id: `box:${s}`, kind: 'box', labelKey: lbl(`box:${s}`), editable: comVideo ? { ...NADA } : editavel({ move: true, resize: true, hide: true }), limits: null, optional: !comVideo, lockedReason: null, leavesEmptyCover: false });
  }
  if (temQueimada(base)) layers.push({ id: 'burned', kind: 'burned', labelKey: 'editor.layer.burned', editable: { ...NADA }, limits: null, optional: false, lockedReason: 'burned_caption_pixels', leavesEmptyCover: false });
  // vídeo do cliente: caixa, enquadramento e aparar (F-U2; não gira). 2ª fonte: travada até o F-U3
  const tl = base.video.timeline;
  layers.push({ id: 'video', kind: 'video', labelKey: 'editor.layer.video', editable: editavel({ move: true, resize: true, reframe: true, trim: true }), limits: null, optional: false, lockedReason: null, leavesEmptyCover: false, video: limitesDoVideo(tl[0].startSec, tl[tl.length - 1].endSec) });
  if (temSegunda(base)) layers.push({ id: 'video:2', kind: 'broll', labelKey: lbl('video:2'), editable: { ...NADA }, limits: null, optional: false, lockedReason: null, leavesEmptyCover: false });

  const controls: ControlDecl[] = [{ type: 'color', group: 'appearance', key: 'brand', labelKey: 'editor.control.brandColor', from: 'workspace' }];
  if (formats.length > 1) controls.push({ type: 'format', group: 'format', formats });
  const linhas = campos.filter((c) => !c.lista).map(idCampo);
  const lista = campos.find((c) => c.lista);
  if (linhas.length || lista) controls.push({ type: 'rows', group: 'content', layers: linhas, itemsOf: lista ? idCampo(lista) : null, timed: false });
  controls.push({ type: 'guides', group: 'guides' });
  return { manifestVersion: 1, templateKey: k, formats, layers, controls, defaults: { brand: corDaMarca(base.frame.brand.color) }, clientImage: true };
};

// ───────────────────────── textos atuais ─────────────────────────
/** Textos da peça (com o doc) pros caminhos `layer:slot:*` e `item:slot:<lista>/iN`. */
const textosAtuais = (p: MolduraProps): Map<string, string> => {
  const out = new Map<string, string>();
  for (const c of CAMPOS_MOLDURA[p.frame.id]) {
    const v = lerPath(p.frame.texts, c.path);
    if (c.lista) (Array.isArray(v) ? v : []).forEach((t, i) => out.set(`item:${idCampo(c)}/${idItem(i)}`, String(t)));
    else out.set(`layer:${idCampo(c)}`, v == null ? '' : String(v));
  }
  return out;
};

// ───────────────────────── vídeo ─────────────────────────
/** Trilha de b-roll aparada: `fromSec` é tempo da peça, e cada clipe vale até o próximo começar (trilhaEmFrames). */
const segundaAparada = (second: MolduraProps['second'], inSec: number, outSec: number): MolduraProps['second'] => {
  if (second?.kind !== 'broll_track') return second;
  const cs = [...second.clips].sort((a, b) => a.fromSec - b.fromSec);
  const clips = cs.flatMap((c, i) => {
    const fim = i + 1 < cs.length ? cs[i + 1].fromSec : Infinity;
    if (fim <= inSec || c.fromSec >= outSec) return [];
    const corte = Math.max(0, inSec - c.fromSec);
    return [{ ...c, fromSec: Math.max(0, c.fromSec - inSec), toSec: Math.max(0.01, Math.min(c.toSec, outSec) - inSec), srcStartSec: c.srcStartSec + corte }];
  });
  return clips.length ? { ...second, clips } : second;
};

/** Aplica `video.box`, `video.framing` e `video.trim` nas props (§4). Sem nada a mexer, devolve as mesmas props. */
const comVideo = (props: MolduraProps, d: EditDocV3, fmt: FormatCode, principal: FormatCode, W: number, H: number): { props: MolduraProps; editado: boolean; framing: VideoFraming | null } => {
  const { box, framing } = videoNoFormato(d, fmt, principal);
  const tl0 = props.video.timeline;
  const trim = trimDoDoc(d, tl0[0].startSec, tl0[tl0.length - 1].endSec);
  const padrao = layoutDaPeca(props).videoBox;
  const caixaMudou = !!box && !mesmaCaixa(box, pxParaFracao(padrao, W, H));
  if (!caixaMudou && !framing && !trim) return { props, editado: false, framing: null };
  let out = props;
  const editado = caixaMudou || !!framing;
  let enq: VideoFraming | null = null;
  if (editado) {
    const novaPx = caixaMudou ? (() => { const q = fracaoParaPx(box!, W, H); return { x: r2(q.x), y: r2(q.y), w: r2(q.w), h: r2(q.h) }; })() : null;
    const v = props.video;
    const fonte: FonteDoVideo = {
      source: v.source, contentBox: v.contentBox ?? null, reframe: v.reframe, protectedBands: props.captionMode === 'replace' ? [] : v.protectedBands ?? [],
      faceSafeBand: v.faceSafeBand ?? null, faceHint: v.faceHint ?? null,
    };
    const e = enquadrarVideo(fonte, novaPx ?? padrao, caixaMudou, framing, { width: W, height: H });
    enq = e.framing;
    const { contentBox: _c, ...semContent } = v;
    out = {
      ...props,
      video: { ...semContent, reframe: e.reframe, ...(e.contentBox && { contentBox: e.contentBox }) },
      edicao: { camadas: props.edicao?.camadas ?? [], video: { box: novaPx, boxBase: padrao, layoutReframe: v.reframe, layoutContentBox: v.contentBox ?? null } },
    };
  }
  if (trim) {
    const second = segundaAparada(out.second, trim.inSec, trim.outSec);
    out = { ...out, video: { ...out.video, timeline: timelineAparada(out.video.timeline, trim.inSec, trim.outSec) }, ...(second && { second }) };
  }
  // a checagem por visão confere a faixa onde ela foi parar
  if (out.outputProtectedBands) out = { ...out, outputProtectedBands: faixasProtegidasNaSaida(out) };
  return { props: out, editado, framing: enq };
};

// ───────────────────────── resolver ─────────────────────────
type CamadaEdicao = NonNullable<MolduraProps['edicao']>['camadas'][number];
const R = (r: Rect) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Retângulo final de uma caixa mexida (px): `rect` = caixa nova (o conteúdo escala por igual, encostado no canto de cima
 *  à esquerda dela); `transform` = centro + escala. Sem nada = a do layout. */
const rectFinal = (de: Rect, geo: { transform: { x: number; y: number; scale: number } | null; rect: RectFracao | null }, W: number, H: number): { r: Rect; s: number } | null => {
  if (geo.rect) {
    const q = fracaoParaPx(geo.rect, W, H);
    const s = Math.min(q.w / de.w, q.h / de.h);
    return { r: { x: r2(q.x), y: r2(q.y), w: r2(de.w * s), h: r2(de.h * s) }, s };
  }
  if (geo.transform) {
    const s = geo.transform.scale;
    return { r: { x: r2(geo.transform.x * W - (de.w * s) / 2), y: r2(geo.transform.y * H - (de.h * s) / 2), w: r2(de.w * s), h: r2(de.h * s) }, s };
  }
  return null;
};

/** Caixa (px) de cada camada no layout de hoje (antes do doc): `slot:<campo>` (texto dono do slot), `box:<slot>`, `brand`. */
export const caixasDaMoldura = (p: MolduraProps, L: FrameLayout): Map<LayerId, Rect> => {
  const m = new Map<LayerId, Rect>();
  const id = p.frame.id;
  for (const [k, r] of Object.entries(L.slots)) {
    if (k === 'brand') m.set('brand', R(r));
    else if (!SLOTS_FORA.has(k)) {
      const dono = CAMPOS_MOLDURA[id].find((c) => donoDoSlot(c) && c.slot === k);
      m.set(dono ? idCampo(dono) : `box:${k}`, R(r));
    }
  }
  return m;
};

/**
 * `base` (props do buildFrameInput de hoje, SEM doc) + doc → props da `Moldura` + layout (fração do canvas) + textos.
 * Ordem (§4): templateOpts (cor da marca) → textos e itens → layout do template (fitText) → caixas mexidas/escondidas.
 * Tolerante: o que é inválido vira padrão (o `validarDocMoldura` recusa antes, no PUT).
 */
export const resolverPropsMoldura = (base: MolduraProps, doc: AnyEditDoc | null | undefined, ctx: CtxResolver): ResolvidoEditor<MolduraProps> => {
  const principal = ctx.principal ?? '9x16';
  // a base já vem montada no formato (AutoPieceSource.formats[].base): o formato é o dela; ctx.format só confere
  const fmt = CODIGO_DO_FORMATO[base.format];
  const d = docV3De(doc);
  const textosBase = textosAtuais(base);
  let props: MolduraProps;
  let editados = new Set<string>();
  let videoEditado = false;
  let framingFinal: VideoFraming | null = null;
  const { width: W, height: H } = FORMATOS[base.format];
  if (docV3Vazio(d)) props = base;
  else {
    const dd = d as EditDocV3;
    const texts = JSON.parse(JSON.stringify(base.frame.texts)) as Record<string, unknown>;
    const brand = { ...base.frame.brand };
    const cor = dd.templateOpts?.brand;
    if (corHex(cor)) brand.color = cor.slice(0, 7);
    for (const c of CAMPOS_MOLDURA[base.frame.id]) {
      if (c.lista) {
        const atual = lerPath(texts, c.path);
        if (!Array.isArray(atual)) continue;
        const novo = [...atual];
        for (const it of dd.items?.[idCampo(c)] ?? []) {
          const i = Number(/^i(\d+)$/.exec(it?.id ?? '')?.[1]) - 1;
          if (i >= 0 && i < novo.length && typeof it.text === 'string' && it.text.trim()) novo[i] = it.text;
        }
        gravarPath(texts, c.path, novo);
        continue;
      }
      const l = camadaDoDoc(dd, idCampo(c));
      if (typeof l?.text !== 'string') continue;
      // texto vazio: some no campo que aceita nulo ("De" do preço); nos outros, fica o da base
      if (!l.text.trim()) { if (c.path === 'price.from') gravarPath(texts, c.path, null); continue; }
      gravarPath(texts, c.path, l.text);
    }
    props = { ...base, frame: { ...base.frame, texts, brand } as MolduraProps['frame'] };
    const atuais = textosAtuais(props);
    editados = new Set([...atuais].filter(([k, v]) => textosBase.get(k) !== v).map(([k]) => k));
    const rv = comVideo(props, dd, fmt, principal, W, H);
    props = rv.props; videoEditado = rv.editado; framingFinal = rv.framing;
  }

  // layout de hoje com os textos novos; depois as caixas mexidas/escondidas
  const L = layoutDaPeca(props);
  const caixas = caixasDaMoldura(props, L);
  const camadas: CamadaEdicao[] = [];
  const escala = new Map<LayerId, number>();
  const finais = new Map<LayerId, Rect>(caixas);
  if (d && !docV3Vazio(d)) {
    for (const [lid, de] of caixas) {
      const l = camadaDoDoc(d, lid);
      const geo = geometriaDaCamada(d, lid, fmt, principal);
      const fim = rectFinal(de, geo, W, H);
      const visivel = l?.visible !== false;
      if (!fim && visivel) continue;
      if (fim) { finais.set(lid, fim.r); escala.set(lid, fim.s); }
      camadas.push({ id: lid, visible: visivel, de, para: fim ? fim.r : null });
    }
    if (camadas.length) props = { ...props, edicao: { ...props.edicao, camadas } };
  }
  const escondidas = new Set(camadas.filter((c) => !c.visible).map((c) => c.id));

  // layout do editor (fração do canvas)
  const durSec = duracaoMoldura(props, FPS) / FPS;
  const fr = (r: Rect) => pxParaFracao(r, W, H);
  const camadaLayout = (lid: LayerId, kind: EditLayoutLayer['kind'], r: Rect | null, extra: Partial<EditLayoutLayer> = {}): EditLayoutLayer => ({
    id: lid, kind, rect: r ? fr(r) : { x: 0, y: 0, w: 0, h: 0 }, rotationDeg: 0, fromSec: 0, toSec: durSec, visible: !!r && !escondidas.has(lid), text: null, fontPx: null, ...extra,
  });
  const layers: EditLayoutLayer[] = [];
  const textos: TextoEditor[] = [];
  const atuais = textosAtuais(props);
  const nomes = (L.videoBox && L.secondBox) ? { x: Math.min(L.videoBox.x, L.secondBox.x), y: Math.min(L.videoBox.y, L.secondBox.y), w: 0, h: 0 } : null;
  if (nomes && L.secondBox) { nomes.w = Math.max(L.videoBox.x + L.videoBox.w, L.secondBox.x + L.secondBox.w) - nomes.x; nomes.h = Math.max(L.videoBox.y + L.videoBox.h, L.secondBox.y + L.secondBox.h) - nomes.y; }
  for (const c of CAMPOS_MOLDURA[props.frame.id]) {
    const lid = idCampo(c);
    // geometria: a do próprio slot (dono) ou a da caixa que contém o texto
    const contem = c.slot === null ? null : donoDoSlot(c) ? lid : c.slot === 'brand' ? 'brand' : `box:${c.slot}`;
    const r = contem ? finais.get(contem) ?? null : nomes;
    const s = contem ? escala.get(contem) ?? 1 : 1;
    const escondida = contem ? escondidas.has(contem) : false;
    if (c.lista) {
      const xs = (lerPath(props.frame.texts, c.path) as unknown[] | undefined) ?? [];
      const vis = c.path === 'items' ? (L.items ?? xs) : xs;
      layers.push(camadaLayout(lid, 'text', r, { visible: !!r && !escondida, text: vis.map(String).join('\n') }));
      xs.forEach((t, i) => {
        const fit = c.textKey ? L.text[c.textKey.replace('{i}', String(i))] : undefined;
        const path = `item:${lid}/${idItem(i)}`;
        textos.push({ path, layerId: lid, itemId: idItem(i), text: String(t), edited: editados.has(path), maxChars: c.max, minFontPx: c.textKey ? FRAME_MIN_FONT_PX : null, fontPx: fit ? r2(fit.size * s) : null, fits: fit ? fit.fits : true, contrast: null });
      });
      continue;
    }
    const fit = c.textKey ? L.text[c.textKey] : undefined;
    const t = atuais.get(`layer:${lid}`) ?? '';
    // campo que o formato não desenha (subtítulo do cinema no 1:1, linha fina da notícia no 1:1): camada invisível
    const desenha = c.textKey ? !!fit : !!r;
    layers.push(camadaLayout(lid, 'text', r, { visible: !!r && desenha && !escondida, text: t, fontPx: fit ? r2(fit.size * s) : null }));
    if (desenha) textos.push({ path: `layer:${lid}`, layerId: lid, itemId: null, text: t, edited: editados.has(`layer:${lid}`), maxChars: c.max, minFontPx: c.textKey ? FRAME_MIN_FONT_PX : null, fontPx: fit ? r2(fit.size * s) : null, fits: fit ? fit.fits : true, contrast: null });
  }
  if (caixas.has('brand') || temBrand(base)) layers.push(camadaLayout('brand', 'box', finais.get('brand') ?? null, { text: props.frame.brand.name }));
  for (const [lid, r] of finais) if (lid.startsWith('box:')) layers.push(camadaLayout(lid, 'box', r));
  // caixas que existem em outro formato e não neste: camada invisível (a lista de camadas é a mesma nos 3 formatos)
  for (const s of slotsDeCaixa(props.frame.id, base)) if (!finais.has(`box:${s}`)) layers.push(camadaLayout(`box:${s}`, 'box', null));
  if (temQueimada(base)) {
    const fs = faixasProtegidasNaSaida(props).filter((f) => f.kind === 'original');
    if (fs.length) {
      const x0 = Math.min(...fs.map((f) => f.x)), y0 = Math.min(...fs.map((f) => f.y));
      const x1 = Math.max(...fs.map((f) => f.x + f.w)), y1 = Math.max(...fs.map((f) => f.y + f.h));
      layers.push(camadaLayout('burned', 'burned', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { fromSec: Math.min(...fs.map((f) => f.startSec)), toSec: Math.max(...fs.map((f) => f.endSec)) }));
    } else layers.push(camadaLayout('burned', 'burned', null));
  }
  const vb = L.videoBox;
  layers.push(camadaLayout('video', 'video', vb));
  if (temSegunda(base)) layers.push(camadaLayout('video:2', 'broll', L.secondBox ?? null));

  const cb = props.video.contentBox ?? null;
  const pt = pinturaNaCaixa(vb, props.video.source, props.video.reframe, cb);
  const tl = props.video.timeline;
  const framingAtual: VideoFraming = framingFinal ?? framingDaBase(props, vb, W, H);
  const layout: EditLayout = {
    format: CODIGO_DO_FORMATO[props.format], canvas: { width: W, height: H }, durationSec: durSec, layers,
    video: {
      layerId: 'video', box: fr(vb),
      sourceRect: fr({ x: vb.x + pt.area.left + pt.video.left, y: vb.y + pt.area.top + pt.video.top, w: pt.video.w, h: pt.video.h }),
      fit: props.video.reframe.mode === 'manual' ? props.video.reframe.fit : props.video.reframe.mode === 'contain_blur' ? 'contain_blur' : 'cover',
      auto: props.video.reframe.mode !== 'manual',
      trim: { inSec: tl[0].startSec, outSec: tl[tl.length - 1].endSec },
      visibleRect: fr(visivelNoCanvas(vb, pt, W, H)), framing: framingAtual, edited: videoEditado, checksCaption: props.captionMode !== 'replace',
    },
  };
  return { props, layout, textos };
};

/** Enquadramento atual da peça sem edição de vídeo, nos termos de `video.framing`. */
const framingDaBase = (p: MolduraProps, vb: Rect, W: number, H: number): VideoFraming => enquadrarVideo(
  { source: p.video.source, contentBox: p.video.contentBox ?? null, reframe: p.video.reframe, protectedBands: p.captionMode === 'replace' ? [] : p.video.protectedBands ?? [], faceSafeBand: p.video.faceSafeBand ?? null },
  vb, false, null, { width: W, height: H },
).framing;

// ───────────────────────── validação (estrutura → 400) ─────────────────────────
/** Regras de estrutura do §6.1 pra uma peça de moldura. Lista vazia = doc aceito. */
export const validarDocMoldura = (doc: AnyEditDoc | null | undefined, base: MolduraProps, ctx?: { manifest?: EditManifest }): EditDocErrorV3[] => {
  const manifest = ctx?.manifest ?? manifestoMoldura(base);
  const r = resolverPropsMoldura(base, doc, { format: manifest.formats[0], principal: manifest.formats[0] });
  const atuais = textosAtuais(r.props);
  return validarEstruturaAuto(doc, manifest, (path) => atuais.get(path) ?? null);
};

/** Textos da base (sem doc) por caminho: o `normalizarDocV3` tira do doc o que voltou a ser igual. */
export const textosDaMoldura = (p: MolduraProps) => textosAtuais(p);
