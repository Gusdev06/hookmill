// Regras do plano do lote AUTO (variacao-auto-v1.md §6). PURO: sem banco, sem Nest. O backend garante; a IA segue.
//  1. allowedFor(ctx): o que pode entrar (e quantas vezes) antes do Claude; o Claude só escolhe dentro disso.
//  2. validatePlan(draft, ctx): §6.1 + §6.2 → violações (por peça ou do plano).
//  3. repairPlan(draft, ctx): reparo determinístico depois da 2ª chamada (tira peças que violam; diversidade).
//  4. finalizePlan(...): código (codeFor, com sufixo de repetição), eixo, tempos encaixados no silêncio, textos cortados.
import type {
  AutoInsight, AutoVariationType, BlockFn, BrainField, CodeLanguage, EndcardVariant, SwapReason, TranscriptWord, VariationAxis, WhyLine,
} from '@maquina/contratos';
import type { AutoItemDraft, AutoParamsDraft, AutoPlanDraft } from '../integracoes';
import type { MediaRulesPort, Span } from './portas';

// ───────── catálogo (§6.1) ─────────

export const AUTO_TYPES: readonly AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC'];

/** Eixo fixo por tipo: ITERATION → pasta "esticar a vida"; DIVERSITY → "público novo". */
export const AXIS_OF: Record<AutoVariationType, VariationAxis> = {
  CUT: 'ITERATION', COLD_OPEN: 'ITERATION', HOOK_TEXT: 'ITERATION', ENDCARD: 'ITERATION',
  SPLIT_LP: 'DIVERSITY', STORY: 'DIVERSITY', REVIEW: 'DIVERSITY', NATIVE_SEARCH: 'DIVERSITY', STATIC: 'DIVERSITY',
};

/** Máximo por lote com a repetição da D2 (HOOK-TEXT ≤ 3, STATIC ≤ 2, NATIVE-SEARCH ≤ 2; CUT = um de 15 s e um de 20 s). */
export const TYPE_MAX: Record<AutoVariationType, number> = {
  CUT: 2, COLD_OPEN: 1, HOOK_TEXT: 3, ENDCARD: 1, SPLIT_LP: 1, STORY: 1, REVIEW: 1, NATIVE_SEARCH: 2, STATIC: 2,
};

/** Lote (§6.2 + D2): 8 a 12; sem tipos que fechem 8, sai menor até o piso 4 (com aviso smallBatch). */
export const BATCH_MAX = 12;
export const BATCH_TARGET_MIN = 8;
export const BATCH_FLOOR = 4;
export const MIN_DIVERSITY_PCT = 40;

/** Vídeo curto (§6.1 CUT): < 25 s ou < 4 blocos. */
export const CUT_MIN_SEC = 25;
export const CUT_MIN_BLOCKS = 4;
/** COLD-OPEN: teaser de 1,5 a 3,5 s depois de 0:05 (precisa de vídeo que tenha isso). */
export const COLD_OPEN_MIN_SEC = 10;
export const TEASER_MIN = 1.5;
export const TEASER_MAX = 3.5;
export const TEASER_FROM = 5;
/** Folga do CUT sobre o alvo (blocos inteiros raramente fecham no segundo exato). */
export const CUT_SLACK_SEC = 1.5;

/** Limites de texto (§7.1). change/rationale são cortados; texto de TELA acima do limite é violação. */
export const LIMITS = { change: 90, rationale: 160, whyText: 120, whyRef: 60, hookText: 60, endHeadline: 40, endSubline: 60, endCta: 24, query: 60, staticHeadline: 50 } as const;

/** Troca do §6.2.4: tipo que depende do Brain/da mídia sem o dado → um que não depende (STORY, STATIC, HOOK-TEXT). */
const SWAP_TO: Record<AutoVariationType, AutoVariationType> = {
  CUT: 'HOOK_TEXT', COLD_OPEN: 'HOOK_TEXT', HOOK_TEXT: 'HOOK_TEXT', ENDCARD: 'HOOK_TEXT',
  SPLIT_LP: 'STORY', STORY: 'STORY', REVIEW: 'STATIC', NATIVE_SEARCH: 'STATIC', STATIC: 'STATIC',
};

/** Código no idioma da oferta: `offer.language` começando com `pt` = PT; qualquer outro = EN. */
export function codeLanguageOf(offerLanguage: string): CodeLanguage {
  return /^pt\b/i.test(offerLanguage.trim()) ? 'PT' : 'EN';
}

const ENDCARD_CODE: Record<CodeLanguage, Record<EndcardVariant, string>> = {
  EN: { offer: 'ENDCARD-OFFER', guarantee: 'ENDCARD-GUARANTEE', price: 'ENDCARD-PRICE', cta: 'ENDCARD-CTA' },
  PT: { offer: 'ENDCARD-OFERTA', guarantee: 'ENDCARD-GARANTIA', price: 'ENDCARD-PRECO', cta: 'ENDCARD-CTA' },
};

/**
 * A ÚNICA tabela EN/PT dos códigos (§6.1). `variant`: CUT = 15|20, ENDCARD = a variante; `n` = ocorrência do tipo no
 * lote (1, 2, 3): HOOK-TEXT começa no 2 (o "1" é o gancho do original), NATIVE-SEARCH ganha "-2" na 2ª, STATIC é F<n>.
 */
export function codeFor(type: AutoVariationType, variant: string | number | null, n: number, lang: CodeLanguage): string {
  const pt = lang === 'PT';
  switch (type) {
    case 'CUT':
      return `${pt ? 'CORTE' : 'CUT'}-${variant ?? 15}S`;
    case 'COLD_OPEN':
      return 'COLD-OPEN';
    case 'HOOK_TEXT':
      return `${pt ? 'GANCHO-TEXTO' : 'HOOK-TEXT'}-${n + 1}`;
    case 'ENDCARD':
      return ENDCARD_CODE[lang][(variant as EndcardVariant) ?? 'cta'] ?? ENDCARD_CODE[lang].cta;
    case 'SPLIT_LP':
      return 'LAYOUT-SPLIT-LP';
    case 'STORY':
      return 'LAYOUT-STORY';
    case 'REVIEW':
      return 'LAYOUT-REVIEW';
    case 'NATIVE_SEARCH':
      return `${pt ? 'NATIVO-BUSCA' : 'NATIVE-SEARCH'}${n > 1 ? `-${n}` : ''}`;
    case 'STATIC':
      return `${pt ? 'ESTATICO' : 'STATIC'}-F${n}`;
  }
}

// ───────── contexto ─────────

export interface PlanBlock { index: number; label: string; fn: string; startSec: number; endSec: number }
export interface Brain {
  what: string | null; audience: string | null; pains: string | null; promise: string | null; proof: string | null;
  offerAndPrice: string | null; cta: string | null; notes: string | null;
}
export interface PlanCtx {
  lang: CodeLanguage;
  durationSec: number;
  /** blocos do teardown.structure, na ordem */
  blocks: PlanBlock[];
  hasSpeech: boolean;
  words: TranscriptWord[];
  silences: Span[];
  hasWrittenHook: boolean;
  hasEndCard: boolean;
  brain: Brain;
  /** CTA falado no vídeo (teardown.offerProofCta.ctaSpoken) */
  spokenCta: string | null;
  pageCaptured: boolean;
  productPhoto: boolean;
  /** nomes que não podem aparecer numa busca nativa (workspace, oferta) */
  brandTerms: string[];
}

export type BlockedReason = SwapReason | 'has_end_card';
export interface AllowedType { type: AutoVariationType; max: number; blockedReason: BlockedReason | null }

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Variantes de end card que o Brain (ou o CTA falado) sustenta. */
export function endcardVariants(ctx: PlanCtx): EndcardVariant[] {
  const b = ctx.brain;
  const out: EndcardVariant[] = [];
  if (has(b.offerAndPrice)) out.push('offer');
  const all = [b.what, b.promise, b.proof, b.offerAndPrice, b.notes].filter(has).join(' ');
  if (/guarant|garant|reembols|refund|money.?back/i.test(all)) out.push('guarantee');
  if (has(b.offerAndPrice) && /\d/.test(b.offerAndPrice!)) out.push('price');
  if (has(b.cta) || has(ctx.spokenCta)) out.push('cta');
  return out;
}

/** Depoimento citável (§6.1 REVIEW): Brain › Proof com pelo menos uma frase de 4+ palavras. */
export function hasQuotableProof(ctx: PlanCtx): boolean {
  return has(ctx.brain.proof) && ctx.brain.proof!.split(/[\n.!?]+/).some((s) => words(s) >= 4);
}

/** §6.3.1: o que pode entrar, com o máximo por tipo e o motivo do bloqueio (max 0). */
export function allowedFor(ctx: PlanCtx): AllowedType[] {
  const short = ctx.durationSec < CUT_MIN_SEC || ctx.blocks.length < CUT_MIN_BLOCKS;
  const rule = (type: AutoVariationType, ok: boolean, reason: BlockedReason): AllowedType =>
    ({ type, max: ok ? TYPE_MAX[type] : 0, blockedReason: ok ? null : reason });
  return [
    rule('CUT', !short, 'short_video'),
    rule('COLD_OPEN', ctx.durationSec >= COLD_OPEN_MIN_SEC && ctx.blocks.length >= 2, 'short_video'),
    rule('HOOK_TEXT', true, 'no_speech'),
    ctx.hasEndCard ? rule('ENDCARD', false, 'has_end_card') : rule('ENDCARD', endcardVariants(ctx).length > 0, 'no_offer'),
    rule('SPLIT_LP', ctx.pageCaptured || ctx.productPhoto, 'no_page'),
    rule('STORY', true, 'no_page'),
    rule('REVIEW', hasQuotableProof(ctx), 'no_proof'),
    rule('NATIVE_SEARCH', ctx.hasSpeech, 'no_speech'),
    rule('STATIC', true, 'no_page'),
  ];
}

/** Regras do lote mandadas ao Claude: `min` = 8, ou menos (até o piso 4) quando os tipos permitidos não fecham 8 (D2). */
export function rulesFor(allowed: AllowedType[]): { min: number; max: number; minDiversityPct: 40 } {
  const capacity = allowed.reduce((a, t) => a + t.max, 0);
  return { min: Math.max(BATCH_FLOOR, Math.min(BATCH_TARGET_MIN, capacity)), max: BATCH_MAX, minDiversityPct: MIN_DIVERSITY_PCT };
}

/** Diversidade mínima: 40 % arredondado pra cima (8 → 4, 11 → 5). */
export const minDiversity = (n: number) => Math.ceil((n * MIN_DIVERSITY_PCT) / 100);

/** §6.2.4: trocas registradas em insight.swaps (o alerta "no Brain" diz o que trocou). `has_end_card` não é troca. */
export function swapsFor(allowed: AllowedType[]): AutoInsight['swaps'] {
  return allowed
    .filter((a) => a.max === 0 && a.blockedReason && a.blockedReason !== 'has_end_card')
    .map((a) => ({ from: a.type, to: SWAP_TO[a.type], reason: a.blockedReason as SwapReason }));
}

// ───────── "nada inventado" (§6.2.5) ─────────

/** Caixa, espaços e pontuação (comparação da citação do REVIEW). */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\p{P}+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const digitsOf = (tok: string) => tok.replace(/[.,]/g, '');

/** Números de um texto (só os dígitos: "1.000" = "1000", "97,90" = "9790"). */
export function numbersIn(s: string): string[] {
  return (s.match(NUMBER_RE) ?? []).map(digitsOf);
}

/** Números do texto que NÃO aparecem no Brain nem na transcrição. */
export function inventedNumbers(text: string, ctx: PlanCtx): string[] {
  const hay = new Set<string>();
  const sources = [...Object.values(ctx.brain), ctx.spokenCta, ctx.words.map((w) => w.word).join(' ')].filter(has) as string[];
  for (const s of sources) for (const n of numbersIn(s)) hay.add(n);
  return [...new Set(numbersIn(text))].filter((n) => !hay.has(n));
}

// ───────── validação (§6.3.2) ─────────

export interface Violation { item: number | null; rule: string; detail: string }

/** Texto da violação mandado ao Claude na 2ª chamada. */
export function violationText(v: Violation, items: AutoItemDraft[]): string {
  return v.item === null ? `plan: ${v.rule}: ${v.detail}` : `item ${v.item} (${items[v.item]?.type}): ${v.rule}: ${v.detail}`;
}

const lenOver = (s: string | null | undefined, max: number) => !!s && s.trim().length > max;

function screenTexts(p: AutoParamsDraft): string[] {
  switch (p.type) {
    case 'HOOK_TEXT': return [p.text];
    case 'ENDCARD': return [p.headline, p.subline ?? '', p.ctaText];
    case 'NATIVE_SEARCH': return [p.query];
    case 'STATIC': return [p.headline];
    default: return [];
  }
}

/** Blocos que o CUT nunca pode tirar: o gancho (função hook, senão o 1º bloco) e os `kept` do plano. */
export function mustKeepBlocks(draft: Pick<AutoPlanDraft, 'blocks' | 'kept'>, ctx: PlanCtx): number[] {
  const fnOf = new Map(draft.blocks?.map((b) => [b.index, b.fn]) ?? []);
  const hook = ctx.blocks.find((b) => fnOf.get(b.index) === 'hook' || /hook|gancho/i.test(b.fn))?.index ?? ctx.blocks[0]?.index;
  const kept = (draft.kept ?? []).map((k) => k.blockIndex).filter((i): i is number => i !== null && ctx.blocks.some((b) => b.index === i));
  return [...new Set([...(hook !== undefined ? [hook] : []), ...kept])].sort((a, b) => a - b);
}

function itemViolations(it: AutoItemDraft, i: number, draft: AutoPlanDraft, ctx: PlanCtx, allowed: Map<AutoVariationType, AllowedType>): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ item: i, rule, detail });
  const a = allowed.get(it.type);
  if (!a || a.max === 0) {
    v('type_not_allowed', `${it.type} is not allowed here (${a?.blockedReason ?? 'unknown type'})`);
    return out;
  }
  const p = it.params;
  if (!p || p.type !== it.type) {
    v('params_mismatch', `params.type must be ${it.type}`);
    return out;
  }
  if (!has(it.change)) v('change_empty', 'say the one thing that changes');
  for (const t of screenTexts(p)) {
    const inv = inventedNumbers(t, ctx);
    if (inv.length) v('invented_number', `"${t}" has ${inv.join(', ')}, not in the Brain nor the transcript`);
  }
  switch (p.type) {
    case 'CUT': {
      if (p.targetSec !== 15 && p.targetSec !== 20) v('cut_target', 'targetSec must be 15 or 20');
      const idx = p.blockIndexes ?? [];
      const known = new Set(ctx.blocks.map((b) => b.index));
      const sorted = idx.every((x, k) => k === 0 || x > idx[k - 1]);
      if (!idx.length || !sorted || idx.some((x) => !known.has(x))) {
        v('cut_blocks_invalid', 'blockIndexes must be existing block indexes, ascending, no repeats');
        break;
      }
      const missing = mustKeepBlocks(draft, ctx).filter((k) => !idx.includes(k));
      if (missing.length) v('cut_drops_kept', `the cut must keep blocks ${missing.join(', ')} (hook and kept)`);
      const sec = ctx.blocks.filter((b) => idx.includes(b.index)).reduce((s, b) => s + (b.endSec - b.startSec), 0);
      if (sec > p.targetSec + CUT_SLACK_SEC) v('cut_too_long', `the blocks sum ${sec.toFixed(1)} s, over ${p.targetSec} s`);
      if (sec >= ctx.durationSec - 1) v('cut_not_shorter', 'the cut must remove at least one block');
      break;
    }
    case 'COLD_OPEN': {
      const len = p.teaserEndSec - p.teaserStartSec;
      if (!(p.teaserStartSec >= TEASER_FROM && len >= TEASER_MIN - 0.01 && len <= TEASER_MAX + 0.01 && p.teaserEndSec <= ctx.durationSec)) {
        v('cold_open_window', `teaser must be ${TEASER_MIN}-${TEASER_MAX} s, starting after 0:0${TEASER_FROM}, inside the video`);
      }
      break;
    }
    case 'HOOK_TEXT':
      if (!has(p.text)) v('text_empty', 'text is empty');
      if (lenOver(p.text, LIMITS.hookText)) v('text_too_long', `text over ${LIMITS.hookText} chars`);
      break;
    case 'ENDCARD':
      if (!endcardVariants(ctx).includes(p.variant)) v('endcard_variant_unavailable', `the Brain has nothing for the "${p.variant}" end card`);
      if (!has(p.headline) || !has(p.ctaText)) v('text_empty', 'headline and ctaText are required');
      if (lenOver(p.headline, LIMITS.endHeadline) || lenOver(p.subline, LIMITS.endSubline) || lenOver(p.ctaText, LIMITS.endCta)) {
        v('text_too_long', `headline ≤ ${LIMITS.endHeadline}, subline ≤ ${LIMITS.endSubline}, ctaText ≤ ${LIMITS.endCta}`);
      }
      break;
    case 'REVIEW': {
      const proof = normalizeText(ctx.brain.proof ?? '');
      const quote = normalizeText(p.quote ?? '');
      if (!quote || !proof.includes(quote)) v('review_not_literal', 'the quote must be literal from Brain › Proof');
      if (has(p.author) && !proof.includes(normalizeText(p.author!))) v('review_author_invented', 'the author must be in Brain › Proof');
      if (p.stars !== null && p.stars !== undefined && !(new RegExp(`${p.stars}\\s*(★|\\*|stars?|estrelas?)`, 'i').test(ctx.brain.proof ?? '') || (ctx.brain.proof ?? '').includes('★'.repeat(p.stars)))) {
        v('review_stars_invented', 'stars only if the rating is in Brain › Proof');
      }
      break;
    }
    case 'NATIVE_SEARCH': {
      if (!has(p.query)) v('text_empty', 'query is empty');
      if (lenOver(p.query, LIMITS.query)) v('text_too_long', `query over ${LIMITS.query} chars`);
      const q = normalizeText(p.query ?? '');
      const brand = ctx.brandTerms.map(normalizeText).find((b) => b.length >= 3 && q.includes(b));
      if (brand) v('search_has_brand', `the search must not name the brand ("${brand}")`);
      break;
    }
    case 'STATIC':
      if (!(p.atSec >= 0 && p.atSec <= ctx.durationSec)) v('static_out_of_range', 'atSec outside the video');
      if (!has(p.headline)) v('text_empty', 'headline is empty');
      if (lenOver(p.headline, LIMITS.staticHeadline)) v('text_too_long', `headline over ${LIMITS.staticHeadline} chars`);
      break;
    default:
      break;
  }
  return out;
}

/** Repetição do mesmo tipo tem que mudar o conteúdo (D2): mesmo alvo de CUT, mesmo texto, mesma busca, mesmo frame. */
function duplicateKey(p: AutoParamsDraft): string | null {
  switch (p.type) {
    case 'CUT': return `CUT:${p.targetSec}`;
    case 'HOOK_TEXT': return `HOOK_TEXT:${normalizeText(p.text ?? '')}`;
    case 'NATIVE_SEARCH': return `NATIVE_SEARCH:${normalizeText(p.query ?? '')}`;
    case 'STATIC': return `STATIC:${Math.round(p.atSec ?? 0)}`;
    default: return null;
  }
}

/** §6.1 + §6.2 sobre o rascunho. Violação com `item` = a peça sai no reparo; `item: null` = do plano. */
export function validatePlan(draft: AutoPlanDraft, ctx: PlanCtx, allowed: AllowedType[]): Violation[] {
  const byType = new Map(allowed.map((a) => [a.type, a]));
  const items = draft.items ?? [];
  const out: Violation[] = [];
  const count = new Map<AutoVariationType, number>();
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const own = itemViolations(it, i, draft, ctx, byType);
    out.push(...own);
    if (own.some((v) => v.rule === 'type_not_allowed' || v.rule === 'params_mismatch')) return;
    const n = (count.get(it.type) ?? 0) + 1;
    count.set(it.type, n);
    const max = byType.get(it.type)?.max ?? 0;
    if (n > max) out.push({ item: i, rule: 'over_max', detail: `at most ${max} ${it.type} per batch` });
    const key = duplicateKey(it.params);
    if (key) {
      if (seen.has(key)) out.push({ item: i, rule: 'duplicate', detail: 'a repeated type must change its content (other text, frame or length)' });
      seen.add(key);
    }
  });
  const rules = rulesFor(allowed);
  const n = items.length;
  if (n < rules.min) out.push({ item: null, rule: 'count_low', detail: `${n} pieces, minimum ${rules.min}` });
  if (n > rules.max) out.push({ item: null, rule: 'count_high', detail: `${n} pieces, maximum ${rules.max}` });
  const div = items.filter((it) => AXIS_OF[it.type] === 'DIVERSITY').length;
  if (n && div < minDiversity(n)) out.push({ item: null, rule: 'diversity', detail: `${div} new-audience pieces, need ${minDiversity(n)} of ${n} (≥ ${MIN_DIVERSITY_PCT} %)` });
  const why = draft.why;
  if (!why || !has(why.hook?.text) || !has(why.proof?.text) || !has(why.cta?.text)) out.push({ item: null, rule: 'why_incomplete', detail: 'why needs hook, proof and cta' });
  const kept = draft.kept?.length ?? 0;
  if (kept < 2 || kept > 4) out.push({ item: null, rule: 'kept_count', detail: `kept needs 2-4 entries, got ${kept}` });
  return out;
}

// ───────── reparo determinístico (§6.3.2) ─────────

export interface RepairResult { draft: AutoPlanDraft; removed: { index: number; type: AutoVariationType; rules: string[] }[]; ok: boolean; violations: Violation[] }

/**
 * Tira as peças que violam; acima de 12, tira ITERATION do fim; diversidade < 40 %: tira ITERATION da última pra primeira.
 * `why`/`kept` incompletos são completados a partir do vídeo (não derrubam o lote). ok = piso (4) e diversidade fecham.
 */
export function repairPlan(draft: AutoPlanDraft, ctx: PlanCtx, allowed: AllowedType[], fallback: { why: AutoPlanDraft['why']; kept: AutoPlanDraft['kept'] }): RepairResult {
  const violations = validatePlan(draft, ctx, allowed);
  const bad = new Map<number, string[]>();
  for (const v of violations) if (v.item !== null) bad.set(v.item, [...(bad.get(v.item) ?? []), v.rule]);
  const removed: RepairResult['removed'] = [];
  let items = (draft.items ?? []).filter((it, i) => {
    if (!bad.has(i)) return true;
    removed.push({ index: i, type: it.type, rules: bad.get(i)! });
    return false;
  });
  const dropLastIteration = (): boolean => {
    for (let k = items.length - 1; k >= 0; k--) {
      if (AXIS_OF[items[k].type] === 'ITERATION') {
        removed.push({ index: (draft.items ?? []).indexOf(items[k]), type: items[k].type, rules: ['repair'] });
        items = items.filter((_, j) => j !== k);
        return true;
      }
    }
    return false;
  };
  while (items.length > BATCH_MAX) if (!dropLastIteration()) items = items.slice(0, BATCH_MAX);
  const divOf = () => items.filter((it) => AXIS_OF[it.type] === 'DIVERSITY').length;
  while (items.length && divOf() < minDiversity(items.length) && dropLastIteration());
  const why = completeWhy(draft.why, fallback.why);
  const own = (draft.kept ?? []).filter((k) => has(k?.label));
  const kept = own.length >= 2
    ? own.slice(0, 4)
    : [...own, ...fallback.kept.filter((f) => !own.some((k) => normalizeText(k.label) === normalizeText(f.label)))].slice(0, 4);
  const repaired: AutoPlanDraft = { ...draft, why, kept, items };
  const ok = items.length >= BATCH_FLOOR && divOf() >= minDiversity(items.length);
  return { draft: repaired, removed, ok, violations };
}

function completeWhy(why: AutoPlanDraft['why'] | undefined, fb: AutoPlanDraft['why']): AutoPlanDraft['why'] {
  const pick = (k: 'hook' | 'proof' | 'cta') => (why?.[k] && has(why[k].text) ? why[k] : fb[k]);
  return { hook: pick('hook'), proof: pick('proof'), cta: pick('cta') };
}

/** "Porquê" a partir do próprio vídeo (teardown), usado só quando o Claude não devolve a linha. */
export function fallbackWhy(t: { hookSpoken: string | null; proof: string | null; cta: string | null }, fromVideo: string): AutoPlanDraft['why'] {
  const line = (text: string | null, dflt: string) => ({ text: cut(text?.trim() || dflt, LIMITS.whyText), source: 'video' as const, brainField: null, ref: fromVideo });
  return { hook: line(t.hookSpoken, 'The opening line'), proof: line(t.proof, 'The proof shown in the video'), cta: line(t.cta, 'The closing call to action') };
}

// ───────── finalização (§6.3.3) ─────────

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Params salvos no item (`VariationItem.payload.params`): o rascunho depois do backend (tempos encaixados etc.). */
export type FinalParams =
  | { type: 'CUT'; targetSec: 15 | 20; blockIndexes: number[]; timeline: Span[] }
  | { type: 'COLD_OPEN'; teaserStartSec: number; teaserEndSec: number; teaserSec: number }
  | { type: 'HOOK_TEXT'; text: string; endSec: number }
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string | null; ctaText: string }
  | { type: 'SPLIT_LP'; source: 'page' | 'product_photo' }
  | { type: 'STORY' }
  | { type: 'REVIEW'; quote: string; author: string | null; stars: 1 | 2 | 3 | 4 | 5 | null }
  | { type: 'NATIVE_SEARCH'; query: string }
  | { type: 'STATIC'; atSec: number; headline: string };

export interface FinalItem {
  index: number; type: AutoVariationType; code: string; axis: VariationAxis;
  change: string; rationale: string; whyKey: 'hook' | 'proof' | 'cta'; params: FinalParams;
}

/** Fim do gancho falado: o bloco do gancho (senão o 1º), no máximo 3 s (HOOK_TEXT endSec = min(3, fim do bloco)). */
export function hookTextEndSec(draft: Pick<AutoPlanDraft, 'blocks' | 'kept'>, ctx: PlanCtx): number {
  const hookIdx = mustKeepBlocks({ blocks: draft.blocks, kept: [] }, ctx)[0];
  const b = ctx.blocks.find((x) => x.index === hookIdx);
  return Math.round(Math.min(3, b ? b.endSec : 3, ctx.durationSec) * 1000) / 1000;
}

/** Junta trechos contíguos (blocos vizinhos viram 1 trecho; menos emendas no render). */
function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.startSec - last.endSec < 0.05) last.endSec = s.endSec;
    else out.push({ ...s });
  }
  return out;
}

export function finalizePlan(draft: AutoPlanDraft, ctx: PlanCtx, media: Pick<MediaRulesPort, 'snapSpans'>): FinalItem[] {
  const nth = new Map<AutoVariationType, number>();
  const hookEnd = hookTextEndSec(draft, ctx);
  return draft.items.map((it, index) => {
    const n = (nth.get(it.type) ?? 0) + 1;
    nth.set(it.type, n);
    const p = it.params;
    let params: FinalParams;
    let variant: string | number | null = null;
    switch (p.type) {
      case 'CUT': {
        variant = p.targetSec;
        const spans = ctx.blocks.filter((b) => p.blockIndexes.includes(b.index)).map((b) => ({ startSec: b.startSec, endSec: b.endSec }));
        params = { type: 'CUT', targetSec: p.targetSec, blockIndexes: [...p.blockIndexes], timeline: media.snapSpans(mergeSpans(spans), ctx.words, ctx.silences) };
        break;
      }
      case 'COLD_OPEN': {
        const [s] = media.snapSpans([{ startSec: p.teaserStartSec, endSec: p.teaserEndSec }], ctx.words, ctx.silences);
        params = { type: 'COLD_OPEN', teaserStartSec: s.startSec, teaserEndSec: s.endSec, teaserSec: Math.round((s.endSec - s.startSec) * 1000) / 1000 };
        break;
      }
      case 'HOOK_TEXT':
        params = { type: 'HOOK_TEXT', text: p.text.trim(), endSec: hookEnd };
        break;
      case 'ENDCARD':
        variant = p.variant;
        params = { type: 'ENDCARD', variant: p.variant, headline: p.headline.trim(), subline: p.subline?.trim() || null, ctaText: p.ctaText.trim() };
        break;
      case 'SPLIT_LP':
        params = { type: 'SPLIT_LP', source: ctx.pageCaptured ? 'page' : 'product_photo' };
        break;
      case 'STORY':
        params = { type: 'STORY' };
        break;
      case 'REVIEW':
        params = { type: 'REVIEW', quote: p.quote.trim(), author: p.author?.trim() || null, stars: p.stars ?? null };
        break;
      case 'NATIVE_SEARCH':
        params = { type: 'NATIVE_SEARCH', query: p.query.trim() };
        break;
      case 'STATIC':
        params = { type: 'STATIC', atSec: Math.round(p.atSec * 1000) / 1000, headline: p.headline.trim() };
        break;
    }
    return {
      index, type: it.type, code: codeFor(it.type, variant, n, ctx.lang), axis: AXIS_OF[it.type],
      change: cut((it.change ?? '').trim(), LIMITS.change), rationale: cut((it.rationale ?? '').trim(), LIMITS.rationale),
      whyKey: it.whyKey === 'proof' || it.whyKey === 'cta' ? it.whyKey : 'hook', params,
    };
  });
}

// ───────── insight (§4) ─────────

const BLOCK_FNS: readonly BlockFn[] = ['hook', 'problem', 'mechanism', 'proof', 'cta', 'other'];
const BRAIN_FIELDS: readonly BrainField[] = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes', 'page'];

export interface InsightFlags { brainEmpty: boolean; shortVideo: boolean; pageCaptured: boolean }

export function brainEmpty(b: Brain): boolean {
  return ![b.what, b.audience, b.pains, b.promise, b.proof, b.offerAndPrice, b.cta].some(has);
}

/** Blocos sem função (PLANNING: o web já mostra a régua antes do plano). */
export function partialInsight(ctx: PlanCtx, flags: InsightFlags, swaps: AutoInsight['swaps']): AutoInsight {
  return {
    blocks: ctx.blocks.map((b) => ({ index: b.index, label: b.label, fn: null, startSec: b.startSec, endSec: b.endSec, kept: false })),
    why: [], kept: [], flags: { ...flags, metaConnected: false, smallBatch: false }, swaps,
  };
}

/** Insight completo (PLAN_READY). O porquê só cita o Brain quando o campo existe (senão vira "do vídeo"). */
export function buildInsight(draft: AutoPlanDraft, ctx: PlanCtx, flags: InsightFlags, swaps: AutoInsight['swaps'], fromVideo: string, pieces: number): AutoInsight {
  const fnOf = new Map((draft.blocks ?? []).map((b) => [b.index, BLOCK_FNS.includes(b.fn) ? b.fn : 'other']));
  const keptIdx = new Set([...(draft.kept ?? []).map((k) => k.blockIndex).filter((x): x is number => x !== null)]);
  const brainHas = (f: BrainField | null) => f === 'page' ? flags.pageCaptured : !!f && f in ctx.brain && has(ctx.brain[f as keyof Brain]);
  const line = (key: WhyLine['key']): WhyLine => {
    const w = draft.why[key];
    const brain = w.source === 'brain' && !!w.brainField && BRAIN_FIELDS.includes(w.brainField) && brainHas(w.brainField);
    return {
      key, text: cut(w.text.trim(), LIMITS.whyText), refSource: brain ? 'brain' : 'video', brainField: brain ? w.brainField : null,
      ref: cut((brain ? w.ref : w.ref && w.source === 'video' ? w.ref : fromVideo).trim() || fromVideo, LIMITS.whyRef),
    };
  };
  return {
    blocks: ctx.blocks.map((b) => ({ index: b.index, label: b.label, fn: fnOf.get(b.index) ?? 'other', startSec: b.startSec, endSec: b.endSec, kept: keptIdx.has(b.index) })),
    why: [line('hook'), line('proof'), line('cta')],
    kept: (draft.kept ?? []).map((k) => cut(k.label.trim(), 40)).filter(Boolean).slice(0, 4),
    flags: { ...flags, metaConnected: false, smallBatch: pieces < BATCH_TARGET_MIN },
    swaps,
  };
}
