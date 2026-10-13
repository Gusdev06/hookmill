// Variação automática v1 (variacao-auto-v1.md §6-§7.1): prompt, esquema da saída estruturada e validação do
// planAutoBatch. O Claude devolve o porquê (HOOK/PROOF/CTA), o que fica intacto e o plano de peças dentro de `allowed`;
// as regras de lote (contagem, diversidade, nada inventado) são conferidas pelo backend (iteracao/regras.ts), que
// chama de novo com `violations` se precisar. Aqui ficam só as garantias de FORMA e as que não dependem do modelo:
//  - `why` só cita o Brain quando o campo existe (senão source 'video');
//  - parâmetros só do tipo da peça, sentinelas ("" / 0 / 'none') viram null;
//  - textos de interface cortados em fronteira de palavra no limite do contrato; a citação do REVIEW nunca é mexida.
// Esquema SEM union (anyOf/null): limite de 16 unions por pedido. Parâmetros num objeto plano, lido por tipo.
import type {
  AutoItemDraft, AutoParamsDraft, AutoPlanDraft, AutoPlanInput, AutoVariationType, BlockFn, BrainField, OfferBriefDraft,
  TeardownSections, WhyDraft,
} from '../contrato';
import { IntegracaoError } from '../erros';
import { wordsBlock } from './prompts-campeao';
import { parseJsonObject } from './validacao-campeao';

export const AUTO_TYPES: AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC'];
export const BLOCK_FNS: BlockFn[] = ['hook', 'problem', 'mechanism', 'proof', 'cta', 'other'];
/** Campos do Brain que o porquê pode citar ('page' = texto capturado da LP). */
export const BRAIN_FIELDS: BrainField[] = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes', 'page'];
const OFFER_FIELDS = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes'] as const;

/** Limites de texto do contrato (§4 e §7.1). */
export const AUTO_LIMITS = {
  whyText: 120, whyRef: 60, keptLabel: 40, change: 90, rationale: 160,
  hookText: 60, endHeadline: 40, endSubline: 60, endCta: 24, query: 60, staticHeadline: 50, author: 60,
  pageChars: 4000,
} as const;

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const int = (description: string) => ({ type: 'integer', description });
const arr = (items: object, description: string) => ({ type: 'array', items, description });
const en = (values: (string | number)[], description: string) => ({ type: values.every((v) => typeof v === 'number') ? 'integer' : 'string', enum: values, description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

const WHY = obj({
  text: str('One sentence, interface language, max 120 characters: why this part of the ad works, as a hypothesis.'),
  source: en(['brain', 'video'], '"brain" only when the reason rests on a NON-EMPTY Brain field (or the captured page); otherwise "video".'),
  brainField: en([...BRAIN_FIELDS, 'none'], 'The Brain field it rests on; "none" when source is "video".'),
  ref: str('Brain: a short literal excerpt of that field (max 60 characters). Video: empty string.'),
});

const PARAMS = obj({
  targetSec: en([0, 15, 20], 'CUT only: 15 or 20. 0 for other types.'),
  blockIndexes: arr({ type: 'integer' }, 'CUT only: whole blocks kept, in order (always the hook block 0 and every kept block). Empty for other types.'),
  teaserStartSec: num('COLD_OPEN only: start of the teaser lifted from later in the video (at or after 5 s, in a silence between words). 0 otherwise.'),
  teaserEndSec: num('COLD_OPEN only: end of the teaser, 1.5 to 3.5 s after its start, in a silence. 0 otherwise.'),
  text: str('HOOK_TEXT only: the new written hook for the first seconds, screen language, max 60 characters. Empty otherwise.'),
  variant: en(['offer', 'guarantee', 'price', 'cta', 'none'], 'ENDCARD only: what the end card shows, by what the Brain really has. "none" for other types.'),
  headline: str('ENDCARD (max 40) or STATIC (max 50): headline in the screen language. Empty otherwise.'),
  subline: str('ENDCARD only: optional second line, max 60, screen language. Empty when not needed.'),
  ctaText: str('ENDCARD only: button text, max 24, screen language. Empty otherwise.'),
  quote: str('REVIEW only: a testimonial copied LITERALLY from the Brain proof field (character for character). Empty otherwise.'),
  author: str('REVIEW only: the author exactly as written next to the quote in the Brain. Empty if not written there.'),
  stars: en([0, 1, 2, 3, 4, 5], 'REVIEW only: star rating only if the Brain states it. 0 when not stated or other types.'),
  query: str('NATIVE_SEARCH only: what a viewer would type into a search bar about the problem the hook names, screen language, max 60, no brand. Empty otherwise.'),
  atSec: num('STATIC only: second of the frame used for the still (the proof moment if there is one). 0 for other types.'),
}, 'Parameters of this piece. Fill only the fields of its type; the rest get the empty value (empty string, 0, empty list, "none").');

export const AUTO_PLAN_SCHEMA = obj({
  blocks: arr(obj({ index: int('Block index from <structure>.'), fn: en(BLOCK_FNS, 'Function of the block.') }), 'One entry per block of <structure>, same indexes.'),
  why: obj({ hook: WHY, proof: WHY, cta: WHY }, 'Why the champion sells: one line for its hook, one for its proof, one for its CTA.'),
  kept: arr(obj({ label: str('Short pill, interface language, max 40 characters: something that stays identical in every piece.'), blockIndex: int('Block it refers to, or -1 when it is not one block (voice, pace, framing).') }), '2 to 4 things kept intact in every piece.'),
  items: arr(obj({
    type: en(AUTO_TYPES, 'Piece type; only types listed in <allowed>.'),
    change: str('The ONE thing that changes in this piece, interface language, max 90 characters.'),
    rationale: str('Which why line it attacks and how, interface language, max 160 characters. A hypothesis.'),
    whyKey: en(['hook', 'proof', 'cta'], 'The why line this piece attacks.'),
    params: PARAMS,
  }), 'The pieces, in plan order.'),
});

export const AUTO_PLAN_SYSTEM = `You plan a batch of edit-only variations of a winning short video ad (the "champion") for a performance team. Every piece reuses the champion's own footage and audio; nothing is filmed or generated. Each piece changes exactly ONE thing so the test reads clean.

Piece types (axis in brackets; ITERATION keeps the first frame, DIVERSITY changes it):
- CUT [ITERATION]: a 15 s (or 20 s) cut made of whole blocks, in order. The hook block (index 0) and every kept block always stay. Use 20 s only when hook + proof + CTA do not fit in 15 s.
- COLD_OPEN [ITERATION]: a 1.5-3.5 s teaser lifted from later in the video (at or after 0:05: a proof or reaction stronger than the opening frame) is placed before the untouched original.
- HOOK_TEXT [ITERATION]: a new written hook over the first seconds; speech untouched. Repeats must take clearly different angles.
- ENDCARD [ITERATION]: a 2 s end card appended. Variant by what the Brain really has: offer (offer and price field), guarantee (a guarantee written in the Brain), price (a price written in the Brain), cta (fallback: the spoken CTA).
- SPLIT_LP [DIVERSITY]: the offer's landing page on top, the video below. No parameters.
- STORY [DIVERSITY]: the video framed as a social story with a generic brand handle. No parameters.
- REVIEW [DIVERSITY]: a customer review card above the video. The quote is copied character for character from the Brain proof field.
- NATIVE_SEARCH [DIVERSITY]: opens on a generic search screen typing the problem the hook names, then the video. No brand in the query.
- STATIC [DIVERSITY]: one still frame of the video with a headline (an image ad). Pick the proof moment if there is one.

Batch rules:
- Use only the types in <allowed>, never more of a type than its max. Stay within the requested piece count and keep at least the requested share of DIVERSITY pieces. Within diversity, prefer layouts and STATIC, then NATIVE_SEARCH.
- One variable per piece. Never two types in the same piece.
- What is listed in "kept" never changes in any piece: kept blocks never leave a CUT, the spoken hook is always in a CUT, a COLD_OPEN cuts nothing.
- Nothing invented on screen: every number, price, time span or percentage in HOOK_TEXT, ENDCARD, STATIC or NATIVE_SEARCH text must already appear in the Brain or in the transcript. When unsure, write the text without numbers.
- The why line cites the Brain only when that field is filled; otherwise its source is the video.
- Offer-agnostic: describe mechanics (hook, proof, CTA), never label the niche. Describe any person only generically; never a name, handle or distinctive trait.
- Times come from the transcript and the silences; never place a boundary inside a word.
- On-screen texts (hook text, headlines, CTA, query, quote) are in the screen language given in the request, as people really write: short, concrete, no emojis, no hashtags. Interface texts (why, kept, change, rationale) are in the interface language given in the request.
- Metrics are unknown: never claim results; reasons are hypotheses.`;

const r2 = (n: number) => Math.round(n * 100) / 100;
const LOCALE_NAME = { EN: 'English', PT_BR: 'Brazilian Portuguese' } as const;
const LANG_NAME: Record<string, string> = { pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian' };

export function languageName(bcp47: string): string {
  const base = bcp47.toLowerCase().split(/[-_]/)[0];
  return `${LANG_NAME[base] ?? bcp47} (${bcp47})`;
}

const filled = (v: string | null | undefined) => (v ?? '').trim().length > 0;

/** Campos do Brain disponíveis pra citar (mesma regra que a validação aplica). */
export function brainFieldsFilled(offer: OfferBriefDraft, pageCaptured: boolean): Set<BrainField> {
  const s = new Set<BrainField>(OFFER_FIELDS.filter((k) => filled(offer[k])));
  if (pageCaptured) s.add('page');
  return s;
}

function sec<T>(x: { status: string; data: T | null }, f: (d: T) => string): string {
  return x.status === 'ok' && x.data ? f(x.data) : 'n/a';
}

/** Contexto estável do lote (vai cacheado: a 2ª chamada, de reparo, lê do cache). Sem `visual.person`. */
export function autoPlanContext(i: AutoPlanInput): string {
  const t: TeardownSections = i.teardown;
  const brain = OFFER_FIELDS.map((k) => `[${k}] ${filled(i.offer[k]) ? i.offer[k]!.trim() : '(empty)'}`).join('\n');
  const pageText = i.page.captured && filled(i.page.text) ? i.page.text!.trim().slice(0, AUTO_LIMITS.pageChars) : null;
  const silences = i.media.silences.map((s) => `${r2(s.startSec)}-${r2(s.endSec)}`).join(', ') || 'none';
  return [
    `<brain offer="${i.offer.name}" language="${i.offer.language}">\n${brain}\n</brain>`,
    `<workspace>\nBrand name: ${i.workspace.name}\nIndustry: ${i.workspace.industry ?? 'n/a'}\nMarket: ${i.workspace.market ?? 'n/a'}\n</workspace>`,
    pageText ? `<page captured="true">\n${pageText}\n</page>` : '<page captured="false">No landing page capture: SPLIT_LP is not possible and the why cannot cite "page".</page>',
    `<media>\nDuration ${r2(i.media.durationSec)} s, ${i.media.cuts} cuts.\nWritten hook on screen in 0-3 s: ${i.media.hasWrittenHook ? 'yes' : 'no'}.\nEnd card in the original: ${i.media.hasEndCard ? 'yes' : 'no'}.\nSilences: ${silences}.\n</media>`,
    `<hook seconds="${sec(t.hook, (d) => String(r2(d.endSec)))}">\nSpoken: ${sec(t.hook, (d) => d.spoken)}\nOn screen: ${sec(t.hook, (d) => d.onScreenText ?? '(none)')}\nFirst frame: ${sec(t.hook, (d) => d.visual)}\n</hook>`,
    `<structure>\n${sec(t.structure, (d) => d.blocks.map((b, k) => `${k}. ${b.label} (${b.function}) ${r2(b.startSec)}-${r2(b.endSec)} s: ${b.speech}`).join('\n'))}\n</structure>`,
    `<offer_proof_cta>\n${sec(t.offerProofCta, (d) => [`Promise: ${d.promise}`, `Mechanism: ${d.mechanism}`, `Proof: ${d.proof}`, `CTA spoken: ${d.ctaSpoken}`, `CTA on screen: ${d.ctaOnScreen || '(none)'}`].join('\n'))}\n</offer_proof_cta>`,
    `<why_it_sells>\n${sec(t.whySells, (d) => [`Avatar: ${d.avatar}`, `Pain/desire: ${d.painDesire}`, `Big idea: ${d.bigIdea}`, `Retention: ${d.retentionEngine}`, `Verdict:\n${d.verdict.map((v, k) => `  ${k + 1}. ${v}`).join('\n')}`].join('\n'))}\n</why_it_sells>`,
    `<layout>\n${sec(t.layout, (d) => d.summary)}\n</layout>`,
    `<transcript>\nOne line per stretch of speech between silences: [start-end] then each word@start (seconds).\n${wordsBlock(i.transcript)}\n</transcript>`,
    `<keyframes>\n${i.keyframes.slice(0, 8).map((k) => `${r2(k.atSec)} s (${k.reason})`).join('\n') || 'none'}\n</keyframes>`,
  ].join('\n\n');
}

/** Pedido desta chamada: idiomas, tipos permitidos, regras numéricas e (no reparo) as violações. */
export function autoPlanUserMessage(i: AutoPlanInput): string {
  const allowed = i.allowed.filter((a) => a.max > 0);
  const lines = [
    `Interface language (why, kept, change, rationale): ${LOCALE_NAME[i.uiLocale]}.`,
    `Screen language (texts that appear in the video): ${languageName(i.screenLanguage)}.`,
    `<allowed>\n${allowed.map((a) => `${a.type}: up to ${a.max}`).join('\n') || '(none)'}\n</allowed>`,
    `Plan between ${i.rules.min} and ${i.rules.max} pieces, at least ${i.rules.minDiversityPct}% of them DIVERSITY (rounded up). If the allowed types cannot honestly reach ${i.rules.min}, return fewer good pieces rather than filler.`,
  ];
  if (i.violations?.length) {
    lines.push(`A previous plan for this batch broke these rules. Write a new plan that fixes every one of them:\n${i.violations.map((v) => `- ${v}`).join('\n')}`);
  }
  lines.push('Write the plan.');
  return lines.join('\n\n');
}

// ---------------------------------------------------------------- validação

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Corta em fronteira de palavra (sem reticências); palavra única maior que o limite é cortada no limite. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}

const FROM_VIDEO = { EN: 'From the video', PT_BR: 'Do vídeo' } as const;

export interface AutoPlanParseCtx {
  uiLocale: 'EN' | 'PT_BR';
  durationSec: number;
  blockCount: number;
  offer: OfferBriefDraft;
  pageCaptured: boolean;
}

export function parseAutoPlan(text: string, ctx: AutoPlanParseCtx): AutoPlanDraft {
  const root = parseJsonObject(text);
  const dur = ctx.durationSec > 0 ? ctx.durationSec : Infinity;
  const inVideo = (x: number) => r2(Math.min(Math.max(0, x), Number.isFinite(dur) ? dur : x));
  const brain = brainFieldsFilled(ctx.offer, ctx.pageCaptured);

  // blocos: um por índice do teardown; o que faltar vira 'other' (o 0 é sempre o gancho)
  const fnOf = new Map<number, BlockFn>();
  for (const b of a(root.blocks).map(o)) {
    const idx = n(b.index);
    const fn = s(b.fn) as BlockFn;
    if (Number.isInteger(idx) && idx >= 0 && idx < ctx.blockCount && BLOCK_FNS.includes(fn) && !fnOf.has(idx)) fnOf.set(idx, fn);
  }
  const blocks = Array.from({ length: ctx.blockCount }, (_, index) => ({ index, fn: fnOf.get(index) ?? (index === 0 ? 'hook' : 'other') as BlockFn }));

  const whyRoot = o(root.why);
  const why = (key: 'hook' | 'proof' | 'cta'): WhyDraft => {
    const w = o(whyRoot[key]);
    const field = s(w.brainField) as BrainField;
    const cites = s(w.source) === 'brain' && BRAIN_FIELDS.includes(field) && brain.has(field);
    const textOut = clip(s(w.text), AUTO_LIMITS.whyText);
    if (!textOut) throw new IntegracaoError('PROVIDER_ERROR', `auto plan: empty why.${key}`);
    return cites
      ? { text: textOut, source: 'brain', brainField: field, ref: clip(s(w.ref), AUTO_LIMITS.whyRef) }
      : { text: textOut, source: 'video', brainField: null, ref: FROM_VIDEO[ctx.uiLocale] };
  };

  const seen = new Set<string>();
  const kept: AutoPlanDraft['kept'] = [];
  for (const k of a(root.kept).map(o)) {
    const label = clip(s(k.label), AUTO_LIMITS.keptLabel);
    const bi = n(k.blockIndex);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    kept.push({ label, blockIndex: Number.isInteger(bi) && bi >= 0 && bi < ctx.blockCount ? bi : null });
    if (kept.length === 4) break;
  }

  const items: AutoItemDraft[] = [];
  for (const it of a(root.items).map(o)) {
    const type = s(it.type) as AutoVariationType;
    if (!AUTO_TYPES.includes(type)) continue;
    const whyKey = (['hook', 'proof', 'cta'] as const).find((k) => k === s(it.whyKey)) ?? 'hook';
    const change = clip(s(it.change), AUTO_LIMITS.change);
    if (!change) continue;
    items.push({ type, change, rationale: clip(s(it.rationale), AUTO_LIMITS.rationale), whyKey, params: paramsOf(type, o(it.params), inVideo, ctx.blockCount) });
  }
  if (!items.length) throw new IntegracaoError('PROVIDER_ERROR', 'auto plan: no usable item');

  return { blocks, why: { hook: why('hook'), proof: why('proof'), cta: why('cta') }, kept, items };
}

function paramsOf(type: AutoVariationType, p: Record<string, unknown>, inVideo: (x: number) => number, blockCount: number): AutoParamsDraft {
  const orNull = (v: string) => (v ? v : null);
  switch (type) {
    case 'CUT': {
      const idx = [...new Set(a(p.blockIndexes).map(n).filter((x) => Number.isInteger(x) && x >= 0 && x < blockCount))].sort((x, y) => x - y);
      return { type, targetSec: n(p.targetSec) === 20 ? 20 : 15, blockIndexes: idx };
    }
    case 'COLD_OPEN': {
      const start = inVideo(n(p.teaserStartSec));
      return { type, teaserStartSec: start, teaserEndSec: Math.max(start, inVideo(n(p.teaserEndSec))) };
    }
    case 'HOOK_TEXT':
      return { type, text: clip(s(p.text), AUTO_LIMITS.hookText) };
    case 'ENDCARD': {
      const v = s(p.variant);
      return {
        type,
        variant: v === 'offer' || v === 'guarantee' || v === 'price' ? v : 'cta',
        headline: clip(s(p.headline), AUTO_LIMITS.endHeadline),
        subline: orNull(clip(s(p.subline), AUTO_LIMITS.endSubline)),
        ctaText: clip(s(p.ctaText), AUTO_LIMITS.endCta),
      };
    }
    case 'REVIEW': {
      const st = n(p.stars);
      // a citação fica como veio (só apara as pontas): o backend compara literal com offer.proof
      const quote = typeof p.quote === 'string' ? p.quote.trim() : '';
      return { type, quote, author: orNull(clip(s(p.author), AUTO_LIMITS.author)), stars: st >= 1 && st <= 5 && Number.isInteger(st) ? (st as 1 | 2 | 3 | 4 | 5) : null };
    }
    case 'NATIVE_SEARCH':
      return { type, query: clip(s(p.query), AUTO_LIMITS.query) };
    case 'STATIC':
      return { type, atSec: inVideo(n(p.atSec)), headline: clip(s(p.headline), AUTO_LIMITS.staticHeadline) };
    case 'SPLIT_LP':
      return { type: 'SPLIT_LP' };
    case 'STORY':
      return { type: 'STORY' };
  }
}
