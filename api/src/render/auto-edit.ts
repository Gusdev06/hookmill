/**
 * variacao-auto-v1 §7.3: buildAutoEditInput(ctx, format) → AutoEditRenderInput. Função PURA do maquina-video (como o
 * remix-real): o backend (edicao, dono da fila) monta o ctx com dados planos (URLs assinadas, item.payload.params,
 * teardown, editMap, medidas, Brain) e chama ao tirar o render da fila. Mesmo ctx + mesmo formato = mesmo input.
 */
import type { AutoVariationType, EditMap, EndcardVariant, Rect, TranscriptWord } from '@maquina/contratos';
import { FORMATOS, SAFE_AREA, centroDoRosto, contentBoxDe, corDeDestaque, corEscura, decidirLegendaAutoEdit, faixasProtegidasDe, faixasProtegidasNaSaidaAutoEdit, mapearCaixa, reframeFor, reframeNaCaixa, unionBand, type AutoEditProps } from '@maquina/video';
import { CaptionProtectedError, legendaNoEstiloDaOriginal, type OpcoesDeBuild } from './frame';
import { snapSpans, snapSpansEmOrdem, writtenHookLayer, type Span } from '../medicao/auto-edit';
import type { AutoEditParams, AutoEditRenderInput } from './contrato';
import { TEASER_MIN_SEC } from './emendas';

export type AutoEditFormat = AutoEditRenderInput['format'];

/** = AutoParamsDraft do §7.1 (o que fica em VariationItem.payload.params; tempos podem já vir encaixados). */
export type AutoItemParams =
  | { type: 'CUT'; targetSec: 15 | 20; blockIndexes: number[] }
  | { type: 'COLD_OPEN'; teaserStartSec: number; teaserEndSec: number }
  | { type: 'HOOK_TEXT'; text: string }
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string | null; ctaText: string }
  | { type: 'SPLIT_LP' } | { type: 'STORY' }
  | { type: 'REVIEW'; quote: string; author: string | null; stars: 1 | 2 | 3 | 4 | 5 | null }
  | { type: 'NATIVE_SEARCH'; query: string }
  /** rev. 23/10 (§14.3): o STATIC é imagem do GPT Image 2 (edicao/ImagemEstaticaService), não passa por aqui. Fica no
   *  tipo só porque o payload do item ainda pode ter um; `buildAutoEditInput` recusa. */
  | { type: 'STATIC'; [k: string]: unknown };

export interface AutoEditContext {
  renderId: string;
  type: AutoVariationType;
  params: AutoItemParams;
  /** BCP 47 da fala do campeão (textos de tela e rótulos do STORY/NATIVE-SEARCH) */
  language: string;
  source: AutoEditRenderInput['source'];
  /** teardown.editMap (rosto e camadas queimadas); null = sem mapa (reenquadra no centro, sem tapar gancho) */
  editMap: EditMap | null;
  /** teardown.transcript.words e measurements.silences (encaixe das emendas) */
  words: TranscriptWord[];
  silences: Span[];
  /** teardown.sections.structure.data.blocks, com index = posição */
  blocks: { index: number; startSec: number; endSec: number }[];
  /** teardown.sections.hook.data.endSec */
  hookEndSec: number | null;
  /** measurements.palette */
  palette: string[];
  /** workspace.name */
  brandName: string;
  /** SPLIT-LP: captura da página (análise) ou foto do produto (D4), URL assinada */
  page: { imageUrl: string; kind: 'page' | 'product_photo' } | null;
}

type Fmt = { width: number; height: number };

const RODAPE: Record<string, { reply: string; search: string; ago: string }> = {
  en: { reply: 'Send message', search: 'Search', ago: '2h' },
  pt: { reply: 'Enviar mensagem', search: 'Pesquisar', ago: '2 h' },
  es: { reply: 'Enviar mensaje', search: 'Buscar', ago: '2 h' },
  fr: { reply: 'Envoyer un message', search: 'Rechercher', ago: '2 h' },
  de: { reply: 'Nachricht senden', search: 'Suchen', ago: '2 Std.' },
  it: { reply: 'Invia messaggio', search: 'Cerca', ago: '2 h' },
};
const rotulos = (lang: string) => RODAPE[lang.slice(0, 2).toLowerCase()] ?? RODAPE.en;

/** @handle a partir do nome do workspace: minúsculo, sem acento, sem espaço. */
export const handleDe = (nome: string) => '@' + (nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._]+/g, '').slice(0, 24) || 'brand');

const r1 = (b: Rect): Rect => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
const prender = (b: Rect, f: Fmt): Rect => {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.min(f.width, b.x + b.w) - x, h: Math.min(f.height, b.y + b.h) - y };
};

/** Rosto principal em px da saída (tela cheia), ou null sem mapa. */
function rostoNaSaida(ctx: AutoEditContext, reframe: AutoEditRenderInput['reframe'], f: Fmt): Rect | null {
  const m = ctx.editMap;
  const seg = m?.faceTrack.find((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length);
  if (!m || !seg) return null;
  const fb = seg.faceInRegion[0].box;
  const ex = ctx.source.width / m.width, ey = ctx.source.height / m.height;
  const r = { x: (seg.region.x + fb.x * seg.region.w) * ex, y: (seg.region.y + fb.y * seg.region.h) * ey, w: fb.w * seg.region.w * ex, h: fb.h * seg.region.h * ey };
  return mapearCaixa(r, ctx.source, reframe, { x: 0, y: 0, w: f.width, h: f.height });
}

/**
 * Caixa de texto (gancho novo): faixa acima ou abaixo do rosto, a que tiver mais espaço, dentro
 * da safeArea; altura até 20 % da tela. Sem rosto medido: logo abaixo da safeArea de cima.
 */
function caixaDeTexto(ctx: AutoEditContext, reframe: AutoEditRenderInput['reframe'], f: Fmt, safe: { top: number; bottom: number }): Rect {
  const margem = Math.round(f.width * 0.06);
  const w = f.width - 2 * margem;
  const hMax = Math.round(f.height * 0.2);
  const topo = safe.top + 10, base = f.height - safe.bottom - 10;
  const rosto = rostoNaSaida(ctx, reframe, f);
  if (rosto) {
    const cima = { y0: topo, y1: Math.min(base, rosto.y - 16) };
    const baixo = { y0: Math.max(topo, rosto.y + rosto.h + 16), y1: base };
    const hc = cima.y1 - cima.y0, hb = baixo.y1 - baixo.y0;
    if (Math.max(hc, hb) >= 140) {
      if (hc >= hb || hc >= hMax) return { x: margem, y: cima.y0, w, h: Math.min(hMax, hc) };
      return { x: margem, y: baixo.y0, w, h: Math.min(hMax, hb) };
    }
  }
  return { x: margem, y: topo, w, h: Math.min(hMax, base - topo) };
}

const corSolida = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);

/** Trechos dos blocos, em ordem, fundindo os contíguos, encaixados nas pausas. */
function trechosDosBlocos(ctx: AutoEditContext, idx: number[]): Span[] {
  const bs = [...new Set(idx)].map((i) => ctx.blocks.find((b) => b.index === i)).filter((b): b is AutoEditContext['blocks'][number] => !!b);
  if (!bs.length) throw new Error(`CUT sem blocos válidos (${idx.join(',')})`);
  bs.sort((a, b) => a.startSec - b.startSec);
  return snapSpans(bs.map((b) => ({ startSec: b.startSec, endSec: Math.min(b.endSec, ctx.source.durationSec) })), ctx.words, ctx.silences);
}

export function buildAutoEditInput(ctx: AutoEditContext, format: AutoEditFormat, opts: OpcoesDeBuild = {}): AutoEditRenderInput {
  const f = FORMATOS[format];
  const safe = SAFE_AREA[format];
  const dur = ctx.source.durationSec;
  const p = ctx.params;
  if (p.type !== ctx.type) throw new Error(`params.type ${p.type} != ${ctx.type}`);
  let reframe: AutoEditRenderInput['reframe'] = reframeFor(format, ctx.source, ctx.editMap);
  let timeline: Span[] = [{ startSec: 0, endSec: dur }];
  let params: AutoEditParams;
  const L = rotulos(ctx.language);

  // layouts com o vídeo numa faixa: sempre cover no rosto (§7.2 "vídeo embaixo, cover no rosto")
  if (p.type === 'SPLIT_LP' || p.type === 'REVIEW') {
    const c = centroDoRosto(ctx.editMap);
    const ex = ctx.editMap ? ctx.source.width / ctx.editMap.width : 1, ey = ctx.editMap ? ctx.source.height / ctx.editMap.height : 1;
    reframe = { mode: 'cover', focus: c ? { x: Math.round(((c.x * ex) / ctx.source.width) * 1000) / 1000, y: Math.round(((c.y * ey) / ctx.source.height) * 1000) / 1000 } : { x: 0.5, y: 0.4 } };
  }
  // 26/10 (Gusta reprovou o contain_blur em 25/10, vale pra tudo): CUT, NATIVE_SEARCH e REVIEW usam o mesmo
  // reframeNaCaixa das molduras: cover com zoom no rosto, só a contentBox (sem letterbox), a legenda protegida inteira na
  // janela; faixa na cor da marca só no caso extremo. Nunca borrado.
  let contentBox: Rect | null = null;
  if (p.type === 'CUT' || p.type === 'NATIVE_SEARCH' || p.type === 'REVIEW') {
    const em = ctx.editMap as unknown as Parameters<typeof contentBoxDe>[1];
    contentBox = contentBoxDe(ctx.source, em);
    const r = p.type === 'REVIEW' ? Math.round(f.height * 0.42) : 0;
    reframe = reframeNaCaixa({ w: f.width, h: f.height - r }, ctx.source, ctx.editMap, 1080, contentBox, unionBand(faixasProtegidasDe(em as never, ctx.source))) as AutoEditRenderInput['reframe'];
  }

  switch (p.type) {
    case 'CUT':
      timeline = trechosDosBlocos(ctx, p.blockIndexes);
      params = { type: 'CUT', targetSec: p.targetSec };
      break;
    case 'COLD_OPEN': {
      // teaser ≥ 1,5 s (§7.1): se o encaixe encolher abaixo disso, estica o fim até a próxima pausa que respeite o mínimo;
      // sem nenhuma, fica com os tempos da regra (o RenderService ainda leva as bordas pro silêncio sem encolher)
      let [teaser] = snapSpansEmOrdem([{ startSec: p.teaserStartSec, endSec: p.teaserEndSec }], ctx.words, ctx.silences) as (Span | undefined)[];
      if (!teaser || teaser.endSec - teaser.startSec < TEASER_MIN_SEC - 1e-6) {
        const ini = teaser?.startSec ?? p.teaserStartSec;
        let achado: Span | undefined;
        for (let alvo = ini + TEASER_MIN_SEC; alvo <= Math.min(dur, ini + 3.5) + 1e-6 && !achado; alvo += 0.1) {
          const [t] = snapSpansEmOrdem([{ startSec: ini, endSec: alvo }], ctx.words, ctx.silences);
          if (t && t.endSec - t.startSec >= TEASER_MIN_SEC - 1e-6 && t.endSec - t.startSec <= 3.5 + 1e-6) achado = t;
        }
        teaser = achado;
      }
      teaser ??= { startSec: p.teaserStartSec, endSec: Math.min(dur, Math.max(p.teaserEndSec, p.teaserStartSec + TEASER_MIN_SEC)) };
      timeline = [teaser, { startSec: 0, endSec: dur }];
      params = { type: 'COLD_OPEN', teaserSec: Math.round((teaser.endSec - teaser.startSec) * 1000) / 1000 };
      break;
    }
    case 'HOOK_TEXT': {
      const endSec = Math.min(3, Math.max(1.5, ctx.hookEndSec ?? 3));
      const camada = writtenHookLayer(ctx.editMap, 3);
      let box: Rect;
      let cover: { box: Rect; color: string } | null = null;
      if (camada && ctx.editMap) {
        const ex = ctx.source.width / ctx.editMap.width, ey = ctx.source.height / ctx.editMap.height;
        const alvo = camada.background.kind !== 'none' && camada.background.box ? camada.background.box : camada.box;
        const pad = 6;
        const orig = { x: alvo.x * ex - pad, y: alvo.y * ey - pad, w: alvo.w * ex + 2 * pad, h: alvo.h * ey + 2 * pad };
        const naSaida = prender(mapearCaixa(orig, ctx.source, reframe, { x: 0, y: 0, w: f.width, h: f.height }), f);
        const cor = corSolida(camada.background.color) ?? corEscura(ctx.palette);
        cover = { box: r1(naSaida), color: cor };
        // o texto novo ocupa o lugar do antigo (mínimo de 150 px de altura, crescendo pra baixo)
        box = r1({ x: naSaida.x + 12, y: naSaida.y + 6, w: naSaida.w - 24, h: Math.max(150, naSaida.h - 12) });
        if (box.h > cover.box.h) cover = { ...cover, box: r1({ ...cover.box, h: box.h + 12 }) };
      } else {
        box = r1(caixaDeTexto(ctx, reframe, f, safe));
      }
      params = { type: 'HOOK_TEXT', text: p.text, endSec, box, cover };
      break;
    }
    case 'ENDCARD':
      params = { type: 'ENDCARD', variant: p.variant, headline: p.headline, subline: p.subline, ctaText: p.ctaText, durationSec: 2, background: corEscura(ctx.palette) };
      break;
    case 'SPLIT_LP':
      if (!ctx.page) throw new Error('SPLIT_LP sem página nem foto do produto');
      params = { type: 'SPLIT_LP', top: { imageUrl: ctx.page.imageUrl, kind: ctx.page.kind, scroll: ctx.page.kind === 'page' }, ratio: 0.5 };
      break;
    case 'STORY':
      params = { type: 'STORY', handle: handleDe(ctx.brandName), timeAgo: L.ago, replyLabel: L.reply, bars: 3 };
      break;
    case 'REVIEW':
      params = { type: 'REVIEW', quote: p.quote, author: p.author, stars: p.stars, ratio: 0.42 };
      break;
    case 'NATIVE_SEARCH': {
      // 0,25 s parado + digitação a 14 car/s + 0,6 s lendo, entre 1,5 e 2,5 s (o template acelera se não couber)
      const introSec = Math.round(Math.min(2.5, Math.max(1.5, 0.25 + p.query.length / 14 + 0.6)) * 100) / 100;
      params = { type: 'NATIVE_SEARCH', query: p.query, introSec, typingCps: 14, placeholder: L.search };
      break;
    }
    case 'STATIC':
      throw new Error('STATIC não renderiza no Remotion (variacao-auto-v1 §14.3: imagem do GPT Image 2, engine IMAGE_GEN)');
  }

  const input: AutoEditRenderInput = {
    kind: 'auto-edit', renderId: ctx.renderId, templateId: 'auto-edit',
    format, language: ctx.language, source: ctx.source, reframe,
    timeline: timeline.map((t) => ({ startSec: t.startSec, endSec: Math.min(t.endSec, dur) })),
    joinFadeMs: 40, safeArea: safe, palette: ctx.palette, brandName: ctx.brandName,
    type: ctx.type, params, ...(contentBox && { contentBox }),
  };
  // legenda-protegida-v1 (26/10): CUT, NATIVE_SEARCH e REVIEW nunca tampam nem cortam a legenda queimada do campeão.
  // Desviar → recortar (sem cortar o rosto) e legendar no estilo da original → não oferecer (CAPTION_PROTECTED)
  if (p.type === 'CUT' || p.type === 'NATIVE_SEARCH' || p.type === 'REVIEW') {
    const protectedBands = faixasProtegidasDe(ctx.editMap as never, ctx.source);
    if (protectedBands.length) {
      const { kind: _k, renderId: _r, templateId: _t, ...props } = { ...input, protectedBands };
      const d = decidirLegendaAutoEdit(props as AutoEditProps, ctx.editMap, legendaNoEstiloDaOriginal(ctx, corDeDestaque(ctx.palette, '#000000')) as AutoEditProps['captions'], opts.captionMode === 'replace' ? 'replace' : undefined);
      if (d.mode === 'blocked') throw new CaptionProtectedError(d.reason, d.check.hits);
      return { kind: 'auto-edit', renderId: ctx.renderId, templateId: 'auto-edit', ...d.input, outputProtectedBands: faixasProtegidasNaSaidaAutoEdit(d.input) } as AutoEditRenderInput;
    }
  }
  return input;
}
