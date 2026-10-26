// Molduras (FRAME) no planAutoBatch (estatico-montado-e-molduras-v1 §B2/§B5, aprovado 25/10; B1-I). O Claude escolhe a
// moldura entre as permitidas e escreve os textos de TELA dela, cada um com a fonte; os textos fixos de interface ("POV:",
// "AO VIVO", "Faça uma pergunta", "TOP N", "Convidado"…) são constantes do template no video (FRAME_UI), nunca da IA.
// Aqui só FORMA (limites com o *destaque* fora da conta, contagens, preço literal do Brain); a validação de produto
// (allowedFrames, invented_claim, máx. 2 e templates distintos) é do backend.
// TRANSIÇÃO (§C.0): `FRAME` ainda não está no AutoVariationType; o código usa os aliases `…WithFrame` e o tipo local
// `AutoPlanInputWithFrame` (o `allowedFrames` ainda não existe no AutoPlanInput: pedido ao arquiteto).
import type {
  AutoFrameDraft, AutoPlanInput, AutoVariationTypeWithFrame, CopySource, FrameTemplateId, FrameTexts, FrameTwoSourceId, OfferBriefDraft,
} from '../contrato';
import { sourceOf } from './auto-plano-estatico';
import type { AutoVariationType } from '@maquina/contratos';

/** Os 18 ids do protótipo (= FrameTemplateId). */
export const FRAME_TEMPLATES: FrameTemplateId[] = [
  'question_box', 'gossip_page', 'meme', 'cinema', 'news', 'split_stack', 'split_torn', 'call', 'call_dialog',
  'ranking', 'post_card', 'direct_offer', 'story', 'read_caption', 'pov_testimonial', 'live', 'gossip_white', 'gossip_pink',
];
export const FRAME_TWO_SOURCE: FrameTwoSourceId[] = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'];
/** B1 sem condição (§B2 "sempre"). pov_testimonial, direct_offer, ranking e call dependem do Brain. */
export const FRAME_ALWAYS: FrameTemplateId[] = ['question_box', 'meme', 'cinema', 'news', 'read_caption', 'live', 'post_card', 'story'];

/** Limites (caracteres visíveis, sem os *): o MENOR entre o contrato §B2 e o `TEXT_LIMITS` do video (lib/molduras.ts),
 *  pra o texto nunca estourar no render (FRAME_TEXT_OVERFLOW). */
export const FRAME_LIMITS = {
  question: 70, meme_pov: 70, cta: 28, cinema_question: 60, subtitle: 80, topic: 18, lead: 40, highlight: 30, dek: 80,
  read_headline: 70, primaryText: 600, pov_testimonial: 80, promise: 40, price: 16, ranking_title: 24, ranking_item: 28,
  ranking_min: 3, ranking_max: 5, post_copy: 140, story_question: 70, story_headline: 40, story_support: 70, story_copy: 300,
  call_title: 40, slide_title: 40, slide_step: 30, slide_steps: 3, split_headline: 50, gossip_headline: 80, page_name: 24,
  dialog_name: 14,
} as const;

/** Entrada do plano com moldura (TRANSIÇÃO): `allowed` aceita FRAME; `allowedFrames` = o que o `allowedFrames` do backend
 *  liberou pra este lote. Ausente = padrão conservador (`defaultAllowedFrames`, só B1). */
export type AutoPlanInputWithFrame = Omit<AutoPlanInput, 'allowed'> & {
  allowed: { type: AutoVariationType; max: number }[];
  allowedFrames?: FrameTemplateId[];
};

const filled = (v: string | null | undefined) => (v ?? '').trim().length > 0;
/** Número com moeda (§B5): símbolo/código antes ou depois do número. */
export const PRICE_RE = /(?:R\$|US\$|\$|€|£|¥|\b(?:BRL|USD|EUR|GBP|MXN|ARS|COP|CLP)\b)\s?\d|\d[\d.,]*\s?(?:R\$|€|£|\b(?:BRL|USD|EUR|GBP|MXN|reais|d[óo]lares|euros)\b)/i;

/** Máximo de molduras por lote (decisão do Gusta 25/10: até 8, todas de templates diferentes). */
export const FRAME_MAX_PER_BATCH = 8;

/** Sem `allowedFrames` do backend: as "sempre" + as que dependem do Brain quando o dado existe + as 6 de 2 fontes
 *  (25/10: a 2ª fonte é escolhida pelo backend; aqui só os textos). */
export function defaultAllowedFrames(offer: OfferBriefDraft, hasProofBlock: boolean): FrameTemplateId[] {
  const out = [...FRAME_ALWAYS];
  if (hasProofBlock || filled(offer.proof)) out.push('pov_testimonial');
  if (PRICE_RE.test(offer.offerAndPrice ?? '')) out.push('direct_offer');
  out.push('ranking', 'call', ...FRAME_TWO_SOURCE);
  return out;
}

export function frameAllowed(i: Pick<AutoPlanInputWithFrame, 'allowed'>): boolean {
  return i.allowed.some((x) => x.type === 'FRAME' && x.max > 0);
}

export function allowedFramesOf(i: AutoPlanInputWithFrame): FrameTemplateId[] {
  if (!frameAllowed(i)) return [];
  if (i.allowedFrames) return FRAME_TEMPLATES.filter((t) => i.allowedFrames!.includes(t));
  const proof = i.teardown.structure.status === 'ok' && !!i.teardown.structure.data?.blocks.some((b) => b.function.toLowerCase() === 'proof');
  return defaultAllowedFrames(i.offer, proof);
}

// ---------------------------------------------------------------- esquema e prompt

const str = (description: string) => ({ type: 'string', description });
const arr = (items: object, description: string) => ({ type: 'array', items, description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

/** Campos planos (sem union): cada moldura lê os seus (tabela no prompt). */
export const FRAME_SCHEMA = obj({
  question: str('question_box / cinema / story: the question.'),
  subtitle: str('cinema: subtitle.'),
  pov: str('meme / pov_testimonial: the POV line WITHOUT the "POV:" prefix.'),
  cta: str('meme / news / pov_testimonial / direct_offer: short call to action.'),
  topic: str('news: topic tag.'),
  headlineLead: str('news: first part of the headline.'),
  headlineHighlight: str('news: highlighted end of the headline.'),
  dek: str('news: one-sentence dek under the headline.'),
  headline: str('read_caption / story / split_stack / split_torn / gossip_page / gossip_white / gossip_pink: the headline.'),
  pageName: str('gossip_page: a generic page name, never a real outlet.'),
  title: str('ranking / call / call_dialog: the title.'),
  slideTitle: str('call: title of the presented slide.'),
  slideSteps: arr({ type: 'string' }, 'call: exactly 3 steps of the product, from the Brain.'),
  names: arr({ type: 'string' }, 'call_dialog: exactly 2 role labels, never a person name.'),
  items: arr({ type: 'string' }, 'ranking: 3-5 items from the Brain.'),
  copy: str('post_card / story: body copy.'),
  promise: str('direct_offer: the promise.'),
  priceFrom: str('direct_offer: crossed-out price, literal from offerAndPrice, only if it states two prices. Empty otherwise.'),
  priceTo: str('direct_offer: the price, literal from offerAndPrice (digits and currency as written).'),
  support: str('story: support line.'),
  primaryText: str('read_caption: the ad primary text that pays off the curiosity of the headline.'),
  sources: arr(obj({
    path: str('Path of the text: "question", "headline", "headline.lead", "headline.highlight", "items.0", "slideSteps.2", "price.to", "names.1"…'),
    source: str('Brain field (name, kind, what, audience, promise, pains, proof, offerAndPrice, cta, notes), "transcript" or "generic" (only for a line with no claim).'),
  }), 'One entry per text you wrote, with its source.'),
}, 'FRAME only: the on-screen texts of the chosen frame, in the screen language. Fill only the fields of that template; empty strings and empty lists for the rest and for other types.');

export const FRAME_RULES = `FRAME (video frames):
- The champion video, whole and with its own audio, is placed inside a social-format frame. Pick the template among the ones listed in <frames> of the request; one variable per piece = the frame. At most 8 FRAME pieces per batch, every one with a different template.
- You write only the on-screen texts of the frame, in the screen language, each with its source in "sources". Interface words belong to the template and are never written by you: "POV:", "LIVE"/"AO VIVO", "Ask me a question", "Read the caption", "Tap the button", "TOP N", "Guest", the time stamp, the brand name and handle.
- To highlight a part of a text, wrap it in *asterisks* (at most once per text; the asterisks do not count in the limits).
- Limits are in visible width: a full-width character (Chinese, Japanese, Korean, full-width punctuation) counts as 2, so "max 70" holds at most 35 Chinese characters.
- Same "nothing invented" rule as everywhere: every number, price, time span, free/trial, guarantee, discount, platform, expert/doctor/study and "#1"/best must be in the Brain or the transcript. "generic" only for a line with no claim.
- Fields per template (limits in visible characters):
  question_box: question (max 70) from the spoken hook or pains.
  meme: pov (max 70) from pains or the transcript; cta (max 28) = the Brain CTA or a plain action verb.
  cinema: question (max 60) from the hook; subtitle (max 80) from promise.
  news: topic (max 18) from the offer kind or industry; headlineLead (max 40) + headlineHighlight (max 30) from promise or proof; dek (max 80); cta (max 28). Words like expert, study or doctor only if proof says so.
  read_caption: headline (max 70) from promise, proof or transcript; primaryText (max 600): the ad text that pays off the curiosity.
  pov_testimonial: pov (max 80) from proof or the transcript; cta (max 28).
  direct_offer: promise (max 40); priceTo (max 16) copied literally from offerAndPrice; priceFrom only when offerAndPrice states two prices, else empty; cta (max 28). Never a price from the transcript or the page.
  live: no text.
  ranking: title (max 24); items: 3-5 (max 28 each). EVERY item needs its own entry in sources ("items.0", "items.1"…) with pains, what, promise or proof; an item without a source breaks the plan.
  post_card: copy (max 140) from the hook or promise.
  story: question (max 70) from the hook or pains; headline (max 40) and support (max 70) from promise; copy (max 300) from what, promise or proof.
  call: title (max 40) from the offer name or what; slideTitle (max 40); slideSteps: exactly 3 parts or steps of the product (max 30 each), each with its source (what or promise).
  split_stack, split_torn: headline (max 50) at the seam between the two videos.
  gossip_page: headline (max 80); pageName (max 24) a generic page name, never a real outlet. gossip_white, gossip_pink: headline (max 80).
  call_dialog: title (max 40); names: 2 role labels (max 14 each), the first the word for "You" in the screen language, the second a role only if proof or what states it, otherwise the word for "Guest". Never a person name.
- The "change" line names the frame in the interface language, for example "Inside a news frame: headline from the proof".`;

/** Linha do pedido com as molduras permitidas neste lote (só quando FRAME está em `allowed`). */
export function framesRequestLine(templates: FrameTemplateId[]): string {
  return templates.length
    ? `<frames>\nFRAME templates allowed in this batch: ${templates.join(', ')}.\n</frames>`
    : '<frames>\nNo FRAME template is possible in this batch: plan no FRAME piece.\n</frames>';
}

// ---------------------------------------------------------------- leitura

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const sa = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const c = text.slice(0, max + 1);
  const sp = c.lastIndexOf(' ');
  return (sp > max * 0.5 ? c.slice(0, sp) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}

/** Largura cheia (CJK, hangul, kana, pontuação de largura cheia) conta 2 nos limites das molduras (25/10: em zh-TW 20
 *  de 54 peças estouravam no render com o limite contado por caractere). */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3FFFD}]/u;
export function textWidth(t: string): number {
  let w = 0;
  for (const ch of t) w += WIDE.test(ch) ? 2 : 1;
  return w;
}
/** Corta pela largura: em fronteira de palavra quando há espaço (latino); senão no caractere (CJK, sem espaço). */
export function cutWidth(text: string, max: number): string {
  if (textWidth(text) <= max) return text;
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  const sp = out.lastIndexOf(' ');
  return (sp > out.length * 0.5 && !WIDE.test(out) ? out.slice(0, sp) : out).replace(/[\s,;:–—\-，、。；：]+$/u, '');
}

/** Visível = sem os asteriscos. No máx. 1 destaque: o 1º par fica, os outros asteriscos saem. Acima do limite visível, o
 *  texto é cortado sem destaque (cortar no meio do *trecho* quebraria a marcação). */
export function frameText(raw: unknown, max: number): string {
  let t = s(raw);
  const first = t.indexOf('*');
  const second = first >= 0 ? t.indexOf('*', first + 1) : -1;
  if (second > first + 1) t = t.slice(0, second + 1) + t.slice(second + 1).replace(/\*/g, '');
  else t = t.replace(/\*/g, '');
  if (textWidth(t.replace(/\*/g, '')) <= max) return t;
  return cutWidth(t.replace(/\*/g, ''), max);
}

/** Textos da moldura por template; null = faltou texto obrigatório (a peça sai). */
export function frameTextsOf(template: FrameTemplateId, p: Record<string, unknown>, offer: OfferBriefDraft): FrameTexts[FrameTemplateId] | null {
  const L = FRAME_LIMITS;
  const t = (k: string, max: number) => frameText(p[k], max);
  const all = (...xs: string[]) => xs.every((x) => x.length > 0);
  switch (template) {
    case 'question_box': { const question = t('question', L.question); return all(question) ? { question } : null; }
    case 'meme': { const pov = t('pov', L.meme_pov).replace(/^pov:\s*/i, ''); const cta = t('cta', L.cta); return all(pov, cta) ? { pov, cta } : null; }
    case 'cinema': { const question = t('question', L.cinema_question); const subtitle = t('subtitle', L.subtitle); return all(question, subtitle) ? { question, subtitle } : null; }
    case 'news': {
      const r = { topic: t('topic', L.topic), headline: { lead: t('headlineLead', L.lead), highlight: t('headlineHighlight', L.highlight) }, dek: t('dek', L.dek), cta: t('cta', L.cta) };
      return all(r.topic, r.headline.lead, r.headline.highlight, r.dek, r.cta) ? r : null;
    }
    case 'read_caption': { const headline = t('headline', L.read_headline); const primaryText = t('primaryText', L.primaryText); return all(headline, primaryText) ? { headline, primaryText } : null; }
    case 'pov_testimonial': { const pov = t('pov', L.pov_testimonial).replace(/^pov:\s*/i, ''); const cta = t('cta', L.cta); return all(pov, cta) ? { pov, cta } : null; }
    case 'direct_offer': {
      // §B5: preço literal do offerAndPrice (comparação exata é do backend); `from` só com dois valores no Brain
      const to = cutWidth(s(p.priceTo), L.price);
      const fromRaw = cutWidth(s(p.priceFrom), L.price);
      const prices = (offer.offerAndPrice ?? '').match(new RegExp(PRICE_RE.source, 'gi')) ?? [];
      const r = { promise: t('promise', L.promise), price: { from: fromRaw && prices.length >= 2 ? fromRaw : null, to }, cta: t('cta', L.cta) };
      return all(r.promise, to, r.cta) ? r : null;
    }
    case 'live': return {};
    case 'ranking': {
      const items = sa(p.items).map((x) => frameText(x, L.ranking_item)).filter(Boolean).slice(0, L.ranking_max);
      const title = t('title', L.ranking_title);
      return title && items.length >= L.ranking_min ? { title, items } : null;
    }
    case 'post_card': { const copy = t('copy', L.post_copy); return all(copy) ? { copy } : null; }
    case 'story': {
      const r = { question: t('question', L.story_question), headline: t('headline', L.story_headline), support: t('support', L.story_support), copy: t('copy', L.story_copy) };
      return all(r.question, r.headline, r.support, r.copy) ? r : null;
    }
    case 'call': {
      const slideSteps = sa(p.slideSteps).map((x) => frameText(x, L.slide_step)).filter(Boolean).slice(0, L.slide_steps);
      const r = { title: t('title', L.call_title), slideTitle: t('slideTitle', L.slide_title), slideSteps };
      return all(r.title, r.slideTitle) && slideSteps.length === L.slide_steps ? r : null;
    }
    case 'split_stack': case 'split_torn': { const headline = t('headline', L.split_headline); return all(headline) ? { headline } : null; }
    case 'gossip_page': { const headline = t('headline', L.gossip_headline); const pageName = t('pageName', L.page_name); return all(headline, pageName) ? { headline, pageName } : null; }
    case 'gossip_white': case 'gossip_pink': { const headline = t('headline', L.gossip_headline); return all(headline) ? { headline } : null; }
    case 'call_dialog': {
      const names = sa(p.names).map((x) => frameText(x, L.dialog_name).replace(/\*/g, '')).filter(Boolean);
      const title = t('title', L.call_title);
      return title && names.length >= 2 ? { title, names: [names[0], names[1]] } : null;
    }
  }
}

/** Caminhos de texto que existem nos `texts` (pra filtrar `sources`). */
export function frameTextPaths(texts: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(texts)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(path);
    else if (Array.isArray(v)) v.forEach((x, n) => typeof x === 'string' && out.push(`${path}.${n}`));
    else if (v && typeof v === 'object') out.push(...frameTextPaths(v as Record<string, unknown>, path));
  }
  return out;
}

/** Params FRAME (só forma). Template fora do enum, fora dos permitidos ou sem texto obrigatório = null (a peça sai). */
export function frameParamsOf(p: Record<string, unknown>, allowed: FrameTemplateId[], offer: OfferBriefDraft): AutoFrameDraft | null {
  const template = FRAME_TEMPLATES.find((x) => x === s(p.template));
  if (!template || !allowed.includes(template)) return null;
  const f = o(p.frame);
  const texts = frameTextsOf(template, f, offer);
  if (!texts) return null;
  const paths = new Set(frameTextPaths(texts as Record<string, unknown>));
  const sources: Record<string, CopySource> = {};
  for (const e of (Array.isArray(f.sources) ? f.sources : []).map(o)) {
    const path = s(e.path);
    const src = sourceOf(e.source);
    if (paths.has(path) && src && !(path in sources)) sources[path] = src;
  }
  return { type: 'FRAME', template, texts, sources } as AutoFrameDraft;
}
