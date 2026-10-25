// Variação automática v1 (variacao-auto-v1.md §6-§7.1): prompt, esquema da saída estruturada e validação do
// planAutoBatch. O Claude devolve o porquê (HOOK/PROOF/CTA), o que fica intacto e o plano de peças dentro de `allowed`;
// as regras de lote (contagem, diversidade, nada inventado) são conferidas pelo backend (iteracao/regras.ts), que
// chama de novo com `violations` se precisar. Aqui ficam só as garantias de FORMA e as que não dependem do modelo:
//  - `why` só cita o Brain quando o campo existe (senão source 'video');
//  - parâmetros só do tipo da peça, sentinelas ("" / 0 / 'none') viram null;
//  - textos de interface cortados em fronteira de palavra no limite do contrato; a citação do REVIEW nunca é mexida.
// Rev. 23/10 (§14.3): o STATIC é uma imagem NOVA do GPT Image 2 (conceito `visual` em inglês + headline ≤ 50); os
// frames-chave vão como REFERÊNCIA (pessoa genérica, cenário, paleta), nunca como o frame da peça. Marca, aspas e
// limites do `visual` são validados pelo backend (regras.ts) e voltam como `violations` no reparo.
// 25/10 (estatico-montado-e-molduras-v1): o STATIC vira anúncio montado (`copy` por bloco com fonte + `visualV2`,
// auto-plano-estatico.ts) e entra o FRAME (moldura + textos com fonte, auto-plano-moldura.ts; TRANSIÇÃO com os aliases WithFrame).
// Esquema SEM union (anyOf/null): limite de 16 unions por pedido. Parâmetros num objeto plano, lido por tipo.
import type {
  AutoItemDraft, AutoParamsDraft, AutoParamsDraftWithFrame, AutoPlanDraft, AutoPlanInput, AutoVariationType, AutoVariationTypeWithFrame, BlockFn,
  BrainField, FrameTemplateId, HeadlinePlacement, OfferBriefDraft, StaticStyle, StaticVisualDraft, TeardownSections, WhyDraft,
} from '../contrato';
import { STATIC_V2_RULES, staticCopyOf, staticVisualV2Of } from './auto-plano-estatico';
import { FRAME_RULES, allowedFramesOf, frameAllowed, frameParamsOf, framesRequestLine, type AutoPlanInputWithFrame } from './auto-plano-moldura';
import { IntegracaoError } from '../erros';
import { wordsBlock } from './prompts-campeao';
import { parseJsonObject } from './validacao-campeao';

export const AUTO_TYPES: AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC'];
/** 25/10 (§B2, TRANSIÇÃO): com FRAME. Vira o AUTO_TYPES na fusão do B1. */
export const AUTO_TYPES_WITH_FRAME: AutoVariationTypeWithFrame[] = [...AUTO_TYPES, 'FRAME'];
export type { AutoPlanInputWithFrame } from './auto-plano-moldura';
/** Catálogo dos lotes NOVOS (decisão do Gusta 25/10): saem COLD_OPEN, HOOK_TEXT, ENDCARD, STORY e SPLIT_LP do esquema e
 *  do prompt; o parse dos tipos antigos continua (AUTO_TYPES_WITH_FRAME) pra plano já salvo e pro reparo. */
export const PLAN_TYPES: AutoVariationTypeWithFrame[] = ['CUT', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME'];
/** TRANSIÇÃO (§C.0): item/plano com FRAME. Na fusão do B1 viram o AutoItemDraft/AutoPlanDraft do contrato. */
export type AutoItemDraftWithFrame = Omit<AutoItemDraft, 'type' | 'params'> & { type: AutoVariationTypeWithFrame; params: AutoParamsDraftWithFrame };
export type AutoPlanDraftWithFrame = Omit<AutoPlanDraft, 'items'> & { items: AutoItemDraftWithFrame[] };
export const BLOCK_FNS: BlockFn[] = ['hook', 'problem', 'mechanism', 'proof', 'cta', 'other'];
/** Campos do Brain que o porquê pode citar ('page' = texto capturado da LP). */
export const BRAIN_FIELDS: BrainField[] = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes', 'page'];
const OFFER_FIELDS = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes'] as const;

/** Limites de texto do contrato (§4 e §7.1). */
export const AUTO_LIMITS = {
  whyText: 120, whyRef: 60, keptLabel: 40, change: 90, rationale: 160,
  hookText: 60, endHeadline: 40, endSubline: 60, endCta: 24, query: 60, staticHeadline: 50, author: 60,
  pageChars: 4000,
  /** §14.3: conceito visual do STATIC (inglês) */
  visualObject: 220, visualScene: 220, visualVibe: 140,
} as const;

export const STATIC_STYLES: StaticStyle[] = ['everyday_photo', 'cinematic', 'ad_graphic'];
export const HEADLINE_PLACEMENTS: HeadlinePlacement[] = ['top', 'center', 'bottom'];
/** Frames-chave mandados como imagem quando STATIC está em `allowed` (o resto vai só como horário + motivo). */
export const STATIC_REF_IMAGES = 4;

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
  quote: str('REVIEW only: a testimonial copied LITERALLY from the Brain proof field (character for character). Empty otherwise.'),
  author: str('REVIEW only: the author exactly as written next to the quote in the Brain. Empty if not written there.'),
  stars: en([0, 1, 2, 3, 4, 5], 'REVIEW only: star rating only if the Brain states it. 0 when not stated or other types.'),
  query: str('NATIVE_SEARCH only: what a viewer would type into a search bar about the problem the hook names, screen language, max 60, no brand. Empty otherwise.'),
  refAtSec: num('STATIC only: second of the key frame you used as visual REFERENCE (generic person, setting, palette), or -1 when none. -1 for other types.'),
  // bug live 25/10: os textos do STATIC e da moldura saem numa 2ª etapa (auto-plano-detalhe.ts); aqui só a escolha
  emotion: str('STATIC only: the hero emotion, one of pain, relief, desire, curiosity, pride (hook → pain or curiosity, proof → relief or pride, cta → desire). "none" for other types.'),
  concept: str('STATIC only, in English, max 160 characters: the concept of the assembled ad (who is in the hero photo, where, what the product shows, which pain or desire the headline names). No quotation marks, no brand. Empty otherwise.'),
  template: str('FRAME only: the frame template id, one of those listed in <frames> of the request. "none" for other types.'),
}, 'Parameters of this piece. Fill only the fields of its type; the rest get the empty value (empty string, 0, empty list, "none").');

export const AUTO_PLAN_SCHEMA = obj({
  blocks: arr(obj({ index: int('Block index from <structure>.'), fn: en(BLOCK_FNS, 'Function of the block.') }), 'One entry per block of <structure>, same indexes.'),
  why: obj({ hook: WHY, proof: WHY, cta: WHY }, 'Why the champion sells: one line for its hook, one for its proof, one for its CTA.'),
  kept: arr(obj({ label: str('Short pill, interface language, max 40 characters: something that stays identical in every piece.'), blockIndex: int('Block it refers to, or -1 when it is not one block (voice, pace, framing).') }), '2 to 4 things kept intact in every piece.'),
  items: arr(obj({
    type: en(PLAN_TYPES, 'Piece type; only types listed in <allowed>.'),
    change: str('The ONE thing that changes in this piece, interface language, max 90 characters.'),
    rationale: str('Which why line it attacks and how, interface language, max 160 characters. A hypothesis.'),
    whyKey: en(['hook', 'proof', 'cta'], 'The why line this piece attacks.'),
    params: PARAMS,
  }), 'The pieces, in plan order.'),
});

export const AUTO_PLAN_SYSTEM = `You plan a batch of edit-only variations of a winning short video ad (the "champion") for a performance team. Every video piece reuses the champion's own footage and audio; nothing is filmed or generated (the one exception is STATIC, a new image ad). Each piece changes exactly ONE thing so the test reads clean.

Piece types (axis in brackets; ITERATION keeps the first frame, DIVERSITY changes it):
- CUT [ITERATION]: a 15 s (or 20 s) cut made of whole blocks, in order. The hook block (index 0) and every kept block always stay. Use 20 s only when hook + proof + CTA do not fit in 15 s.
- REVIEW [DIVERSITY]: a customer review card above the video. The quote is copied character for character from the Brain proof field.
- NATIVE_SEARCH [DIVERSITY]: opens on a generic search screen typing the problem the hook names, then the video. No brand in the query.
- STATIC [DIVERSITY]: a NEW single-image ad, created from scratch by an image model (never a frame of the video), laid out as an assembled direct-response poster. Details in "STATIC assembled ads" below.
- FRAME [DIVERSITY]: the whole champion video inside a social-format frame (news, meme, story, live, review caption, split screen, gossip page, video call…). Up to 8 per batch, each with a different template. Only when FRAME is in <allowed>. Details in "FRAME" below.

Batch rules:
- Use only the types in <allowed>, never more of a type than its max. Stay within the requested piece count and keep at least the requested share of DIVERSITY pieces. Within diversity, prefer FRAME and STATIC, then REVIEW and NATIVE_SEARCH.
- One variable per piece. Never two types in the same piece.
- What is listed in "kept" never changes in any piece: kept blocks never leave a CUT and the spoken hook is always in a CUT.
- Nothing invented on screen: every number, price, time span or percentage in STATIC, FRAME or NATIVE_SEARCH text must already appear in the Brain or in the transcript. When unsure, write the text without numbers.
- The why line cites the Brain only when that field is filled; otherwise its source is the video.
- Offer-agnostic: describe mechanics (hook, proof, CTA), never label the niche. Describe any person only generically; never a name, handle or distinctive trait.
- Times come from the transcript and the silences; never place a boundary inside a word.
- On-screen texts (headlines, CTA, query, quote) are in the screen language given in the request, as people really write: short, concrete, no emojis, no hashtags. Interface texts (why, kept, change, rationale) are in the interface language given in the request.
- Metrics are unknown: never claim results; reasons are hypotheses.

Two steps: in the plan, a STATIC piece only gets refAtSec, emotion and a one-line concept, and a FRAME piece only its template; their on-screen texts are written right after (each STATIC on its own, all FRAME pieces together), with the rules below.

${STATIC_V2_RULES}

${FRAME_RULES}`;

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

/** STATIC em `allowed` (com max > 0): só aí os frames-chave vão como imagem. */
export function staticAllowed(i: Pick<AutoPlanInputWithFrame, 'allowed'>): boolean {
  return i.allowed.some((a) => a.type === 'STATIC' && a.max > 0);
}

/** Pedido desta chamada: idiomas, tipos permitidos, regras numéricas e (no reparo) as violações. */
/** `refImages` = quantos frames-chave foram anexados como referência do STATIC (0 = nenhum). */
export function autoPlanUserMessage(i: AutoPlanInputWithFrame, refImages = 0): string {
  // catálogo novo (25/10): tipo antigo que ainda venha no `allowed` não é oferecido ao modelo
  const allowed = i.allowed.filter((a) => a.max > 0 && PLAN_TYPES.includes(a.type));
  const lines = [
    `Interface language (why, kept, change, rationale): ${LOCALE_NAME[i.uiLocale]}.`,
    `Screen language (texts that appear in the video): ${languageName(i.screenLanguage)}.`,
    `<allowed>\n${allowed.map((a) => `${a.type}: up to ${a.max}`).join('\n') || '(none)'}\n</allowed>`,
    `Plan between ${i.rules.min} and ${i.rules.max} pieces, at least ${i.rules.minDiversityPct}% of them DIVERSITY (rounded up). If the allowed types cannot honestly reach ${i.rules.min}, return fewer good pieces rather than filler.`,
  ];
  if (i.violations?.length) {
    lines.push(`A previous plan for this batch broke these rules. Write a new plan that fixes every one of them:\n${i.violations.map((v) => `- ${v}`).join('\n')}`);
  }
  if (staticAllowed(i)) {
    lines.push(refImages > 0
      ? `STATIC is allowed: the ${refImages} images attached right before this request are key frames of the champion, as REFERENCE for the STATIC concepts only (generic person, setting, palette, proof moment). Set refAtSec to the one you leaned on, or -1.`
      : 'STATIC is allowed: no key frame image could be attached, so lean on the hook, layout and why-it-sells descriptions for the STATIC concepts. refAtSec may still name a key frame time you leaned on, or -1.');
  }
  if (frameAllowed(i)) lines.push(framesRequestLine(allowedFramesOf(i)));
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
  /** FRAME (TRANSIÇÃO): moldura só entra se o template estiver aqui. Ausente/vazio = nenhuma FRAME passa. */
  allowedFrames?: FrameTemplateId[];
}

export function parseAutoPlan(text: string, ctx: AutoPlanParseCtx): AutoPlanDraftWithFrame {
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

  const items: AutoItemDraftWithFrame[] = [];
  for (const it of a(root.items).map(o)) {
    const type = s(it.type) as AutoVariationTypeWithFrame;
    if (!AUTO_TYPES_WITH_FRAME.includes(type)) continue;
    const whyKey = (['hook', 'proof', 'cta'] as const).find((k) => k === s(it.whyKey)) ?? 'hook';
    const change = clip(s(it.change), AUTO_LIMITS.change);
    if (!change) continue;
    const rationale = clip(s(it.rationale), AUTO_LIMITS.rationale);
    if (type === 'FRAME') {
      // moldura fora das permitidas ou sem texto obrigatório: a peça sai (o backend completa o lote no reparo)
      const params = frameParamsOf(o(it.params), ctx.allowedFrames ?? [], ctx.offer);
      if (params) items.push({ type, change, rationale, whyKey, params });
      continue;
    }
    items.push({ type, change, rationale, whyKey, params: paramsOf(type, o(it.params), inVideo, ctx.blockCount) });
  }
  if (!items.length) throw new IntegracaoError('PROVIDER_ERROR', 'auto plan: no usable item');

  return { blocks, why: { hook: why('hook'), proof: why('proof'), cta: why('cta') }, kept, items };
}

/** Conceito visual do STATIC: só forma (limites, enums). Aspas e marca ficam pra validação do backend (viram reparo). */
export function visualOf(v: Record<string, unknown>): StaticVisualDraft {
  const style = STATIC_STYLES.find((x) => x === s(v.style)) ?? 'everyday_photo';
  const headlinePlacement = HEADLINE_PLACEMENTS.find((x) => x === s(v.headlinePlacement)) ?? 'top';
  return {
    object: clip(s(v.object), AUTO_LIMITS.visualObject),
    scene: clip(s(v.scene), AUTO_LIMITS.visualScene),
    vibe: clip(s(v.vibe), AUTO_LIMITS.visualVibe),
    style,
    headlinePlacement,
  };
}

function paramsOf(type: Exclude<AutoVariationType, 'FRAME'>, p: Record<string, unknown>, inVideo: (x: number) => number, blockCount: number): AutoParamsDraft {
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
    case 'STATIC': {
      // refAtSec: -1/negativo/ausente = nenhum; senão dentro do vídeo. `atSec` = legado até o fechamento do §14.5
      const raw = typeof p.refAtSec === 'number' && Number.isFinite(p.refAtSec) ? p.refAtSec : typeof p.atSec === 'number' ? p.atSec : -1;
      const refAtSec = raw < 0 ? null : inVideo(raw);
      const copyRaw = o(p.copy);
      if (s(o(copyRaw.headline).lead) || s(o(copyRaw.headline).highlight)) {
        // 25/10 §A2 (assembled). TRANSIÇÃO: `headline` (lead + highlight) e `atSec` legados enquanto o regras.ts lê os dois
        const copy = staticCopyOf(copyRaw);
        return { type, atSec: refAtSec ?? 0, headline: `${copy.headline.lead} ${copy.headline.highlight}`.trim(), refAtSec, layout: 'assembled', copy, visualV2: staticVisualV2Of(p.visualV2) };
      }
      // plano de 23-25/10 (photo_headline) lido como veio
      return { type, atSec: refAtSec ?? 0, headline: clip(s(p.headline), AUTO_LIMITS.staticHeadline), refAtSec, visual: visualOf(o(p.visual)) };
    }
    case 'SPLIT_LP':
      return { type: 'SPLIT_LP' };
    case 'STORY':
      return { type: 'STORY' };
  }
}
