// Regras do plano do lote AUTO (variacao-auto-v1.md §6). PURO: sem banco, sem Nest. O backend garante; a IA segue.
//  1. allowedFor(ctx): o que pode entrar (e quantas vezes) antes do Claude; o Claude só escolhe dentro disso.
//  2. validatePlan(draft, ctx): §6.1 + §6.2 → violações (por peça ou do plano).
//  3. repairPlan(draft, ctx): reparo determinístico depois da 2ª chamada (tira peças que violam; diversidade).
//  4. finalizePlan(...): código (codeFor, com sufixo de repetição), eixo, tempos encaixados no silêncio, textos cortados.
// 25/10 (estatico-montado-e-molduras-v1): STATIC V2 "anúncio montado" (§A3: fonte por bloco, invented_claim, reparo que
// apaga o bloco opcional) e FRAME (molduras, §B2/§B5: allowedFrames, textos por template, preço literal, máx. 2 distintas).
// TRANSIÇÃO (§C.0): FRAME ainda fora do AutoVariationType; aqui tudo é escrito contra `AutoVariationType`.
import type {
  AutoInsight, AutoVariationType, BlockFn, BrainField, CodeLanguage, EndcardVariant, FrameTemplateId, FrameTexts,
  SwapReason, TranscriptWord, VariationAxis, WhyLine,
} from '@maquina/contratos';
import type {
  AutoFrameDraft, AutoItemDraft, AutoParamsDraft, AutoPlanDraft, CopySource, FrameBrand, FrameSpec, StaticCopy,
  StaticIcon, StaticVisualDraft, StaticVisualV2, TemplateSpec,
} from '../integracoes';
import { inventedClaimsIn } from './afirmacoes';
import type { HeadlineBlocked, HeadlineInfo } from './headline-plano';
import type { CaptionGuard } from './legenda-protegida';
import { DEFAULT_ACCENT } from './paleta';
import type { MediaRulesPort, Span } from './portas';
import { templateCode, templateRules, templateSpecOf, templateViolations, type TemplateCtx } from './templates-plano';

// ───────── catálogo (§6.1) ─────────

export const AUTO_TYPES: readonly AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC'];

/** Eixo fixo por tipo: ITERATION → pasta "esticar a vida"; DIVERSITY → "público novo". FRAME (§B2) = DIVERSITY. */
export const AXIS_OF: Record<AutoVariationType, VariationAxis> = {
  CUT: 'ITERATION', COLD_OPEN: 'ITERATION', HOOK_TEXT: 'ITERATION', ENDCARD: 'ITERATION',
  SPLIT_LP: 'DIVERSITY', STORY: 'DIVERSITY', REVIEW: 'DIVERSITY', NATIVE_SEARCH: 'DIVERSITY', STATIC: 'DIVERSITY', FRAME: 'DIVERSITY',
  HEADLINE: 'ITERATION', // headline-e-legenda-v1 §1.1
  CHAT_DM: 'DIVERSITY', PERSON_MOTION: 'DIVERSITY', // iterate-v2 F1.1
};

/** Máximo por lote com a repetição da D2 (HOOK-TEXT ≤ 3, STATIC ≤ 2, NATIVE-SEARCH ≤ 2; CUT = um de 15 s e um de 20 s).
 *  25/10 (Gusta, D10 revista): FRAME ≤ 8, todas de templates diferentes. Os tipos que saíram do catálogo mantêm o número
 *  (só leitura de lote antigo). */
export const TYPE_MAX: Record<AutoVariationType, number> = {
  CUT: 2, COLD_OPEN: 1, HOOK_TEXT: 3, ENDCARD: 1, SPLIT_LP: 1, STORY: 1, REVIEW: 1, NATIVE_SEARCH: 2, STATIC: 2, FRAME: 8,
  HEADLINE: 3, // `replace` = 3; `add` = 2 (no allowedFor, H6)
  CHAT_DM: 1, PERSON_MOTION: 1, // iterate-v2 F1.1
};

/**
 * Catálogo dos lotes NOVOS (decisão do Gusta 25/10): CUT, REVIEW, NATIVE_SEARCH, STATIC (≤ 2) e FRAME (≤ 8). COLD_OPEN,
 * HOOK_TEXT, ENDCARD, STORY e SPLIT_LP saíram: nunca entram no `allowed` do plano; lote antigo com eles segue (leitura,
 * retry, formatos, zip), porque o render, a vista e o zip não olham o catálogo.
 */
export const AUTO_TYPES_NOVOS: readonly AutoVariationType[] = ['HEADLINE', 'CUT', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME'];
export const AUTO_TYPES_FORA: readonly AutoVariationType[] = ['COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'STORY', 'SPLIT_LP'];

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
export const LIMITS = {
  change: 90, rationale: 160, whyText: 120, whyRef: 60, hookText: 60, endHeadline: 40, endSubline: 60, endCta: 24, query: 60, staticHeadline: 50,
  // rev. 23/10 §14.3: conceito visual do STATIC (em inglês, vai pro prompt do GPT Image 2)
  staticObject: 220, staticScene: 220, staticVibe: 140,
} as const;
const STATIC_STYLES: readonly StaticVisualDraft['style'][] = ['everyday_photo', 'cinematic', 'ad_graphic'];
const STATIC_PLACEMENTS: readonly StaticVisualDraft['headlinePlacement'][] = ['top', 'center', 'bottom'];
/** Aspas no `visual` = texto escrito na imagem além da headline (§14.3: static_visual_has_text). */
const QUOTE_RE = /["“”]/;

/** Troca do §6.2.4: tipo que depende do Brain/da mídia sem o dado → um que não depende (STORY, STATIC, HOOK-TEXT). */
const SWAP_TO: Record<AutoVariationType, AutoVariationType> = {
  // 25/10: o que não entra vira moldura (o tipo que sobra pra qualquer campeão)
  CUT: 'FRAME', COLD_OPEN: 'FRAME', HOOK_TEXT: 'FRAME', ENDCARD: 'FRAME',
  SPLIT_LP: 'FRAME', STORY: 'FRAME', REVIEW: 'FRAME', NATIVE_SEARCH: 'STATIC', STATIC: 'FRAME', FRAME: 'STATIC', HEADLINE: 'FRAME',
  CHAT_DM: 'FRAME', PERSON_MOTION: 'FRAME',
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
 * Códigos das molduras (§B2: `FRAME-<ID>` / `MOLDURA-<ID-PT>`, ex. FRAME-NEWS / MOLDURA-NOTICIA). EN = id em caixa alta com
 * hífen; PT = o nome da interface (Caixinha, Notícia, Tweet, Oferta direta, Leia a legenda, Choquei, Fofoca…) em ASCII.
 * Templates distintos por lote (D10) = código único sem sufixo de repetição.
 */
export const FRAME_CODE: Record<CodeLanguage, Record<FrameTemplateId, string>> = {
  EN: {
    question_box: 'FRAME-QUESTION-BOX', gossip_page: 'FRAME-GOSSIP-PAGE', meme: 'FRAME-MEME', cinema: 'FRAME-CINEMA', news: 'FRAME-NEWS',
    split_stack: 'FRAME-SPLIT-STACK', split_torn: 'FRAME-SPLIT-TORN', call: 'FRAME-CALL', call_dialog: 'FRAME-CALL-DIALOG',
    ranking: 'FRAME-RANKING', post_card: 'FRAME-POST-CARD', direct_offer: 'FRAME-DIRECT-OFFER', story: 'FRAME-STORY',
    read_caption: 'FRAME-READ-CAPTION', pov_testimonial: 'FRAME-POV-TESTIMONIAL', live: 'FRAME-LIVE', gossip_white: 'FRAME-GOSSIP-WHITE',
    gossip_pink: 'FRAME-GOSSIP-PINK',
  },
  PT: {
    question_box: 'MOLDURA-CAIXINHA', gossip_page: 'MOLDURA-CHOQUEI', meme: 'MOLDURA-MEME', cinema: 'MOLDURA-CINEMA', news: 'MOLDURA-NOTICIA',
    split_stack: 'MOLDURA-TELA-DIVIDIDA', split_torn: 'MOLDURA-TELA-DIVIDIDA-2', call: 'MOLDURA-MEET', call_dialog: 'MOLDURA-MEET-DIALOGO',
    ranking: 'MOLDURA-RANKING', post_card: 'MOLDURA-TWEET', direct_offer: 'MOLDURA-OFERTA-DIRETA', story: 'MOLDURA-STORY',
    read_caption: 'MOLDURA-LEIA-A-LEGENDA', pov_testimonial: 'MOLDURA-POV-DEPOIMENTO', live: 'MOLDURA-AO-VIVO', gossip_white: 'MOLDURA-FOFOCA-1',
    gossip_pink: 'MOLDURA-FOFOCA-2',
  },
};

/**
 * A ÚNICA tabela EN/PT dos códigos (§6.1). `variant`: CUT = 15|20, ENDCARD = a variante; `n` = ocorrência do tipo no
 * lote (1, 2, 3): HOOK-TEXT começa no 2 (o "1" é o gancho do original), NATIVE-SEARCH ganha "-2" na 2ª, STATIC é F<n>.
 */
export function codeFor(type: AutoVariationType, variant: string | number | null, n: number, lang: CodeLanguage): string {
  const pt = lang === 'PT';
  switch (type) {
    case 'HEADLINE':
      return `HEADLINE-${n}`; // headline-e-legenda-v1 §1.2: igual em EN e PT
    case 'FRAME':
      return FRAME_CODE[lang][(variant as FrameTemplateId) ?? 'question_box'] ?? `${pt ? 'MOLDURA' : 'FRAME'}-${String(variant ?? n).toUpperCase().replace(/_/g, '-')}`;
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
    case 'CHAT_DM':
    case 'PERSON_MOTION':
      return templateCode(type, lang); // iterate-v2 F1.1 (máx. 1 por lote)
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
  /** 25/10: BCP 47 da FALA do campeão (idioma dos textos de tela; léxico do invented_claim). Ausente = pelo `lang` */
  screenLanguage?: string;
  /** 25/10: `offer.name` e `offer.kind` (fontes 'name'/'kind' do CopySource). Ausente = name existe, kind não */
  offerName?: string | null;
  offerKind?: string | null;
  /** 25/10 (§B2): marca e rosto das molduras (backend preenche; a IA não escreve) */
  frame?: { brand: FrameBrand; faceAtSec: number | null };
  /** headline-e-legenda-v1: headline do campeão (modo, limites, bloqueio); ausente = sem HEADLINE */
  headline?: HeadlineInfo | null;
  /** §2.1: o campeão não tem legenda queimada → todas as peças de vídeo ganham legenda */
  captionsAuto?: boolean;
  /** legenda-protegida-v1 §2.3: o que tamparia a legenda queimada (backend preenche; ausente = nada protegido) */
  caption?: CaptionGuard | null;
  /** iterate-v2 F1.1: rosto e legenda queimada pros templates grátis; ausente ou `enabled: false` = sem templates */
  templates?: TemplateCtx | null;
}

/** `burned_captions` (legenda-protegida-v1 §2.3): o tipo/template tamparia ou cortaria a legenda queimada do campeão. */
export type BlockedReason = SwapReason | 'has_end_card' | HeadlineBlocked | 'burned_captions'
  /** iterate-v2 F1.1: PERSON_MOTION sem rosto em ≥ 40 % do vídeo */
  | 'no_face';
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

/** legenda-protegida-v1 §2.3: o tipo (template null) ou a moldura tamparia a legenda queimada (conta do `ctx.caption`). */
export function captionBlocks(ctx: PlanCtx, type: AutoVariationType, template: FrameTemplateId | null = null): boolean {
  return !!ctx.caption?.blocked.some((b) => b.type === type && b.template === template);
}

/** headline-e-legenda-v1 §1.1/§1.4: `replace` até 3, `add` até 2; bloqueio com motivo. Sem info do campeão = fora da lista. */
function headlineRule(ctx: PlanCtx): AllowedType[] {
  const h = ctx.headline;
  if (!h) return [];
  if (h.blockedReason) return [{ type: 'HEADLINE', max: 0, blockedReason: h.blockedReason }];
  if (captionBlocks(ctx, 'HEADLINE')) return [{ type: 'HEADLINE', max: 0, blockedReason: 'burned_captions' }];
  return [{ type: 'HEADLINE', max: h.mode === 'replace' ? 3 : 2, blockedReason: null }];
}

/** §6.3.1: o que pode entrar, com o máximo por tipo e o motivo do bloqueio (max 0). */
export function allowedFor(ctx: PlanCtx): AllowedType[] {
  const short = ctx.durationSec < CUT_MIN_SEC || ctx.blocks.length < CUT_MIN_BLOCKS;
  // legenda-protegida-v1 §2.3: o que já passou nas outras regras e tamparia a legenda queimada sai com `burned_captions`
  const rule = (type: AutoVariationType, ok: boolean, reason: BlockedReason): AllowedType => {
    const r: BlockedReason | null = !ok ? reason : captionBlocks(ctx, type) ? 'burned_captions' : null;
    return { type, max: r ? 0 : TYPE_MAX[type], blockedReason: r };
  };
  // 25/10: FRAME até 8, mas nunca mais que os templates liberados (todas diferentes)
  const frames = allowedFrameIds(ctx).length;
  return [
    ...headlineRule(ctx),
    rule('CUT', !short, 'short_video'),
    rule('REVIEW', hasQuotableProof(ctx), 'no_proof'),
    rule('NATIVE_SEARCH', ctx.hasSpeech, 'no_speech'),
    rule('STATIC', true, 'no_page'),
    // sem moldura liberada porque todas as que sobravam tampam a legenda = o motivo é a legenda
    { ...rule('FRAME', frames > 0, allowedFrames(ctx).some((f) => f.blockedReason === 'burned_captions') ? 'burned_captions' : 'no_page'), max: Math.min(TYPE_MAX.FRAME, frames) },
    // iterate-v2 F1.1: templates grátis (só com ITERATE_TEMPLATES=on)
    ...templateRules(ctx),
  ];
}

// ───────── molduras: o que pode entrar (§B2, §B5) ─────────

export const FRAME_TEMPLATE_IDS: readonly FrameTemplateId[] = [
  'question_box', 'gossip_page', 'meme', 'cinema', 'news', 'split_stack', 'split_torn', 'call', 'call_dialog',
  'ranking', 'post_card', 'direct_offer', 'story', 'read_caption', 'pov_testimonial', 'live', 'gossip_white', 'gossip_pink',
];
/** Fase B2 (2ª mídia, §B3): fora do lote até a entrega B2. */
export const FRAME_TWO_SOURCE_IDS: readonly FrameTemplateId[] = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'];
/** Usam o rosto recortado do campeão (`faceAtSec`, §B2/§B3). */
export const FRAME_WITH_FACE: readonly FrameTemplateId[] = ['question_box', 'live', 'gossip_page', 'gossip_white', 'gossip_pink'];

/** `two_sources` = B2 bloqueado (antes de 25/10; não sai mais); `no_face` = campeão sem rosto no faceTrack (§B3.2 caso 3). */
export type FrameBlockedReason = 'no_price' | 'no_proof' | 'no_data' | 'two_sources' | 'no_face' | 'burned_captions';
export interface AllowedFrame { template: FrameTemplateId; allowed: boolean; blockedReason: FrameBlockedReason | null }

const RANKING_SOURCES: readonly CopySource[] = ['pains', 'what', 'promise', 'proof'];
const CALL_STEP_SOURCES: readonly CopySource[] = ['what', 'promise'];

/** Rosto do campeão no faceTrack (o mesmo dado do `faceAtSec`; sem `ctx.frame` = sem informação = sem rosto). */
export function hasFace(ctx: PlanCtx): boolean {
  return ctx.frame?.faceAtSec != null;
}

/** Bloco de prova no teardown (função "proof"). */
export function hasProofBlock(ctx: PlanCtx): boolean {
  return ctx.blocks.some((b) => b.fn.trim().toLowerCase() === 'proof');
}

/** §B2 "permitido quando" (backend). 25/10: as 6 de 2 fontes entram (fora só sem rosto no campeão). */
export function allowedFrames(ctx: PlanCtx): AllowedFrame[] {
  const b = ctx.brain;
  const some = (fs: readonly CopySource[]) => fs.some((f) => has(b[f as keyof Brain]));
  // legenda-protegida-v1 §2.3: liberada pelas outras regras e tampa a legenda queimada = `burned_captions`
  const ok = (template: FrameTemplateId, cond: boolean, reason: FrameBlockedReason): AllowedFrame => {
    const r: FrameBlockedReason | null = !cond ? reason : captionBlocks(ctx, 'FRAME', template) ? 'burned_captions' : null;
    return { template, allowed: !r, blockedReason: r };
  };
  return FRAME_TEMPLATE_IDS.map((t) => {
    // 25/10: B2 liberado; a 2ª fonte é resolvida no render (edicao/segunda-fonte.ts). Sem rosto no campeão = fora
    if (FRAME_TWO_SOURCE_IDS.includes(t)) return ok(t, hasFace(ctx), 'no_face');
    switch (t) {
      case 'pov_testimonial': return ok(t, hasProofBlock(ctx) || has(b.proof), 'no_proof');
      case 'direct_offer': return ok(t, pricesIn(b.offerAndPrice).length > 0, 'no_price');
      // "a IA decide" (≥ 3 itens/passos possíveis); o backend só exige que exista ao menos uma fonte aceita
      case 'ranking': return ok(t, some(RANKING_SOURCES), 'no_data');
      case 'call': return ok(t, some(CALL_STEP_SOURCES), 'no_data');
      default: return ok(t, true, 'no_data');
    }
  });
}

/** Os ids liberados (vai pro Claude em `allowedFrames`). */
export function allowedFrameIds(ctx: PlanCtx): FrameTemplateId[] {
  return allowedFrames(ctx).filter((f) => f.allowed).map((f) => f.template);
}

// ───────── preço literal (§B5) ─────────

/** Símbolo/código → moeda (comparação do preço com o Brain). "$" sozinho = USD (MXN/ARS etc. usam código). */
const CURRENCY_OF: Record<string, string> = {
  'r$': 'BRL', 'us$': 'USD', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  brl: 'BRL', usd: 'USD', eur: 'EUR', gbp: 'GBP', mxn: 'MXN', ars: 'ARS', cop: 'COP', clp: 'CLP', reais: 'BRL', real: 'BRL', dolares: 'USD', dólares: 'USD', euros: 'EUR',
};
const CUR = String.raw`R\$|US\$|\$|€|£|¥|\b(?:BRL|USD|EUR|GBP|MXN|ARS|COP|CLP)\b`;
const CUR_AFTER = String.raw`R\$|€|£|\b(?:BRL|USD|EUR|GBP|MXN|ARS|COP|CLP|reais|d[óo]lares|euros)\b`;
const NUM = String.raw`\d+(?:[.,]\d+)*`;
const PRICE_RE = new RegExp(String.raw`(?:(${CUR})\s?(${NUM}))|(?:(${NUM})\s?(${CUR_AFTER}))`, 'gi');

/** Preços (número com moeda) de um texto: dígitos (como `numbersIn`) + moeda normalizada. */
export function pricesIn(s: string | null | undefined): { digits: string; currency: string }[] {
  const out: { digits: string; currency: string }[] = [];
  for (const m of (s ?? '').matchAll(PRICE_RE)) {
    const cur = (m[1] ?? m[4] ?? '').toLowerCase();
    const num = m[2] ?? m[3] ?? '';
    out.push({ digits: digitsOf(num), currency: CURRENCY_OF[cur] ?? cur.toUpperCase() });
  }
  return out;
}

const samePrice = (a: { digits: string; currency: string }, b: { digits: string; currency: string }) => a.digits === b.digits && a.currency === b.currency;

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
    .filter((a): a is AllowedType & { type: AutoVariationType } => a.type !== 'HEADLINE') // TRANSIÇÃO: AutoInsight.swaps sem HEADLINE até a fusão
    .filter((a) => a.max === 0 && a.blockedReason && a.blockedReason !== 'has_end_card' && a.blockedReason !== 'burned_captions') // burned_captions vai em insight.captionBlocked
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

/** Fontes do "nada inventado" por afirmação: Brain + nome/tipo da oferta + CTA falado + fala do campeão. */
function claimSources(ctx: PlanCtx): (string | null | undefined)[] {
  return [...Object.values(ctx.brain), ctx.offerName, ctx.offerKind, ctx.spokenCta, ctx.words.map((w) => w.word).join(' ')];
}

/** Idioma da tela pro léxico de afirmações (§A3.2): a fala do campeão; sem ela, o idioma do código. */
export function screenLangOf(ctx: PlanCtx): string {
  return ctx.screenLanguage || (ctx.lang === 'PT' ? 'pt' : 'en');
}

/** §A3.2 item 2: afirmações do texto (grátis, garantia, desconto, plataforma, autoridade, nº 1, sem risco) sem fonte. */
export function inventedClaims(text: string, ctx: PlanCtx): string[] {
  return inventedClaimsIn(text, claimSources(ctx), screenLangOf(ctx)).map((c) => c.term);
}

// ───────── validação (§6.3.2) ─────────

/** `block` (25/10, STATIC V2): o bloco do `copy` que violou ("subheadline", "benefits.1", "cta.sub"…); o reparo apaga o
 *  opcional (§A3.2). Ausente = a violação é da peça inteira. */
export interface Violation { item: number | null; rule: string; detail: string; block?: string }

/** Item do plano com FRAME (TRANSIÇÃO §C.0: o AutoItemDraft ainda não tem FRAME). */
export type PlanItem = Omit<AutoItemDraft, 'type' | 'params'> & { type: AutoVariationType; params: AutoParamsDraft };
const itemsOf = (d: Pick<AutoPlanDraft, 'items'>): PlanItem[] => (d.items ?? []) as unknown as PlanItem[];

/** Texto da violação mandado ao Claude na 2ª chamada. */
export function violationText(v: Violation, items: AutoItemDraft[]): string {
  const where = v.block ? ` [${v.block}]` : '';
  return v.item === null ? `plan: ${v.rule}: ${v.detail}` : `item ${v.item} (${items[v.item]?.type})${where}: ${v.rule}: ${v.detail}`;
}

const lenOver = (s: string | null | undefined, max: number) => !!s && s.trim().length > max;

function screenTexts(p: AutoParamsDraft): string[] {
  switch (p.type) {
    case 'HOOK_TEXT': return [p.text];
    case 'ENDCARD': return [p.headline, p.subline ?? '', p.ctaText];
    case 'NATIVE_SEARCH': return [p.query];
    case 'STATIC': return staticV2Of(p) ? [] : [p.headline]; // V2: por bloco, no staticV2Violations
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

function itemViolations(it: PlanItem, i: number, draft: AutoPlanDraft, ctx: PlanCtx, allowed: Map<AutoVariationType, AllowedType>): Violation[] {
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
    case 'STATIC': {
      // rev. 23/10 §14.3: imagem nova no GPT Image 2. `refAtSec` = frame de referência (null = nenhum); `atSec` legado (TRANSIÇÃO)
      const ref = p.refAtSec !== undefined ? p.refAtSec : typeof p.atSec === 'number' ? p.atSec : null;
      if (ref !== null && !(ref >= 0 && ref <= ctx.durationSec)) v('static_out_of_range', 'refAtSec outside the video');
      const v2 = staticV2Of(p);
      if (v2) {
        out.push(...staticV2Violations(v2, i, ctx));
        break;
      }
      if (!has(p.headline)) v('text_empty', 'headline is empty');
      if (lenOver(p.headline, LIMITS.staticHeadline)) v('text_too_long', `headline over ${LIMITS.staticHeadline} chars`);
      const vis = p.visual;
      if (!vis || !has(vis.object) || !has(vis.scene) || !has(vis.vibe)) {
        v('static_visual_missing', 'visual needs object, scene and vibe (in English)');
        break;
      }
      if (!STATIC_STYLES.includes(vis.style) || !STATIC_PLACEMENTS.includes(vis.headlinePlacement)) {
        v('static_visual_missing', `visual.style must be ${STATIC_STYLES.join('|')} and headlinePlacement ${STATIC_PLACEMENTS.join('|')}`);
      }
      if (lenOver(vis.object, LIMITS.staticObject) || lenOver(vis.scene, LIMITS.staticScene) || lenOver(vis.vibe, LIMITS.staticVibe)) {
        v('text_too_long', `visual: object ≤ ${LIMITS.staticObject}, scene ≤ ${LIMITS.staticScene}, vibe ≤ ${LIMITS.staticVibe}`);
      }
      const texts = [vis.object, vis.scene, vis.vibe];
      if (texts.some((t) => QUOTE_RE.test(t))) v('static_visual_has_text', 'no quoted text in visual: the only text on the image is the headline');
      const brand = brandIn(texts, ctx);
      if (brand) v('static_visual_has_brand', `visual must not name the brand ("${brand}"): describe it by how it looks`);
      break;
    }
    case 'FRAME':
      out.push(...frameViolations(p, i, ctx));
      break;
    case 'HEADLINE':
      out.push(...headlineViolations(p, i, ctx));
      break;
    case 'CHAT_DM':
    case 'PERSON_MOTION':
      out.push(...templateViolations(p, i, ctx, draft));
      break;
    default:
      break;
  }
  return out;
}

/** Nome da marca (palavra inteira, ≥ 3 letras) num conjunto de textos. */
function brandIn(texts: (string | null | undefined)[], ctx: PlanCtx): string | null {
  const words = ` ${normalizeText(texts.filter(has).join(' '))} `;
  return ctx.brandTerms.map(normalizeText).find((b) => b.length >= 3 && words.includes(` ${b} `)) ?? null;
}

// ───────── STATIC V2 "anúncio montado" (estatico-montado-e-molduras-v1 §A2, §A3) ─────────

/** Limites do §A2 (caracteres; `*Words` = palavras). */
export const STATIC_V2_LIMITS = {
  brandLine: 32, tagline: 32, lead: 45, highlight: 22, headline: 60, subheadline: 90, handwritten: 28, handwrittenWords: 5,
  benefitTitle: 24, benefitLine: 40, trustText: 24, ctaMain: 18, ctaSub: 22, closing: 50, closingWords: 9, screenTitle: 24,
  copyTotal: 420, person: 200, setting: 160, light: 80, look: 200, mood: 100,
} as const;
const STATIC_ICONS: readonly StaticIcon[] = [
  'moon', 'sun', 'clock', 'calendar', 'check', 'shield', 'lock', 'heart', 'star', 'lightning', 'home', 'phone', 'chat', 'chart', 'money',
  'gift', 'person', 'people', 'play', 'leaf', 'target', 'book', 'spark', 'route',
];
const STATIC_EMOTIONS: readonly string[] = ['pain', 'relief', 'desire', 'curiosity', 'pride'];
const PRODUCT_KINDS: readonly string[] = ['phone_screen', 'laptop_screen', 'physical_product', 'none'];

/** Bloco do `copy` (+ `screenTitle` do visual) e a fonte que ele aceita (tabela §A3.1). `generic` = pode vir sem dado. */
type StaticBlock = 'brandLine' | 'tagline' | 'headline' | 'subheadline' | 'handwritten' | 'benefits' | 'trust' | 'cta.main' | 'cta.sub' | 'closing' | 'screenTitle';
const STATIC_SOURCES: Record<StaticBlock, { accept: readonly CopySource[] | 'any'; generic: boolean }> = {
  brandLine: { accept: ['what', 'kind', 'promise'], generic: false },
  tagline: { accept: ['promise', 'pains', 'transcript'], generic: true },
  headline: { accept: ['promise', 'pains', 'transcript'], generic: false },
  subheadline: { accept: ['what', 'promise', 'proof', 'offerAndPrice', 'transcript'], generic: false },
  handwritten: { accept: 'any', generic: true },
  benefits: { accept: ['what', 'promise', 'pains', 'proof', 'offerAndPrice'], generic: false },
  trust: { accept: ['proof', 'offerAndPrice', 'what', 'notes'], generic: false },
  'cta.main': { accept: ['cta', 'transcript'], generic: true },
  'cta.sub': { accept: ['offerAndPrice', 'cta'], generic: false },
  closing: { accept: 'any', generic: true },
  screenTitle: { accept: ['what', 'name', 'kind'], generic: false },
};
/** Blocos que NÃO podem sumir: violação aqui tira a peça (§A3.2: "só tira a peça se a violação for na headline"; o CTA
 *  sempre existe, então violação nele também tira). */
const STATIC_REQUIRED_BLOCKS = new Set(['headline', 'cta.main']);

export interface StaticV2 { copy: StaticCopy; visual: StaticVisualV2 }

/** STATIC de plano novo (layout assembled): `copy` + visual V2 (`visualV2` na TRANSIÇÃO; `visual` com `mood` depois da fusão). */
export function staticV2Of(p: AutoParamsDraft | Record<string, unknown> | null | undefined): StaticV2 | null {
  const q = p as { layout?: unknown; copy?: unknown; visualV2?: unknown; visual?: unknown } | null | undefined;
  if (!q || !q.copy || typeof q.copy !== 'object') return null;
  if (q.layout !== undefined && q.layout !== 'assembled') return null;
  const vis = (q.visualV2 ?? q.visual) as Partial<StaticVisualV2> | undefined;
  const visual: StaticVisualV2 = vis && typeof vis === 'object' && 'mood' in vis
    ? { hero: vis.hero ?? null, product: vis.product ?? { kind: 'none', look: null, screenTitle: null, screenTitleSource: null }, mood: vis.mood ?? '' }
    : { hero: null, product: { kind: 'none', look: null, screenTitle: null, screenTitleSource: null }, mood: '' };
  return { copy: q.copy as StaticCopy, visual };
}

/** Todos os textos de tela do `copy` (pra soma ≤ 420 e "nada inventado"), com o bloco de cada um. */
function staticTexts(c: StaticCopy): { block: string; text: string }[] {
  const out: { block: string; text: string }[] = [];
  const add = (block: string, t: string | null | undefined) => { if (has(t)) out.push({ block, text: t!.trim() }); };
  add('brandLine', c.brandLine);
  add('tagline', c.tagline);
  add('headline', c.headline?.lead);
  add('headline', c.headline?.highlight);
  add('subheadline', c.subheadline);
  add('handwritten', c.handwritten);
  (c.benefits ?? []).forEach((b, k) => { add(`benefits.${k}`, b?.title); add(`benefits.${k}`, b?.line); });
  (c.trust ?? []).forEach((t, k) => add(`trust.${k}`, t?.text));
  add('cta.main', c.cta?.main);
  add('cta.sub', c.cta?.sub);
  add('closing', c.closing);
  return out;
}

export function staticCopyLength(c: StaticCopy): number {
  return staticTexts(c).reduce((n, t) => n + t.text.length, 0);
}

/** A fonte existe no Brain? 'transcript' = há fala; 'name' sempre; 'generic' = sem fonte (a tabela decide se pode). */
export function sourceFilled(src: CopySource, ctx: PlanCtx): boolean {
  if (src === 'generic') return true;
  if (src === 'transcript') return ctx.words.length > 0;
  if (src === 'name') return ctx.offerName === undefined ? true : has(ctx.offerName);
  if (src === 'kind') return has(ctx.offerKind);
  return has(ctx.brain[src as keyof Brain]);
}

/** §A3.2 item 3: fonte que não existe no Brain, fora da tabela, ou 'generic' onde não pode. null = ok. */
function sourceProblem(field: StaticBlock, src: CopySource | null | undefined): string | null {
  const rule = STATIC_SOURCES[field];
  if (!src) return `${field} needs a source`;
  if (src === 'generic') return rule.generic ? null : `${field} cannot be generic: it needs a Brain field or the transcript`;
  if (rule.accept !== 'any' && !rule.accept.includes(src)) return `${field} must come from ${rule.accept.join('|')}, not ${src}`;
  return null;
}

function staticV2Violations({ copy: c, visual: vis }: StaticV2, i: number, ctx: PlanCtx): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string, block?: string) => out.push({ item: i, rule, detail, ...(block ? { block } : {}) });
  const L = STATIC_V2_LIMITS;
  const over = (s: string | null | undefined, max: number) => lenOver(s, max);
  const wordsOver = (s: string | null | undefined, max: number) => has(s) && words(s!) > max;
  const source = (field: StaticBlock, src: CopySource | null | undefined, block: string = field) => {
    const why = sourceProblem(field, src);
    if (why) return v('unsupported_source', why, block);
    if (src && !sourceFilled(src, ctx)) v('unsupported_source', `${field} cites ${src}, which is empty in the Brain`, block);
  };

  // headline (obrigatória; nunca generic)
  if (!has(c.headline?.lead) || !has(c.headline?.highlight)) v('text_empty', 'headline.lead and headline.highlight are required', 'headline');
  if (over(c.headline?.lead, L.lead) || over(c.headline?.highlight, L.highlight) || (c.headline?.lead ?? '').trim().length + (c.headline?.highlight ?? '').trim().length > L.headline) {
    v('text_too_long', `headline: lead ≤ ${L.lead}, highlight ≤ ${L.highlight}, together ≤ ${L.headline}`, 'headline');
  }
  const hs = sourceProblem('headline', c.headlineSource);
  if (hs) v('static_headline_unsupported', hs, 'headline');
  else if (!sourceFilled(c.headlineSource, ctx)) v('static_headline_unsupported', `headline cites ${c.headlineSource}, which is empty in the Brain`, 'headline');

  // blocos opcionais com fonte
  if (has(c.brandLine)) {
    if (over(c.brandLine, L.brandLine)) v('text_too_long', `brandLine ≤ ${L.brandLine}`, 'brandLine');
    source('brandLine', c.brandLineSource);
  }
  if (over(c.tagline, L.tagline)) v('text_too_long', `tagline ≤ ${L.tagline}`, 'tagline');
  if (has(c.subheadline)) {
    if (over(c.subheadline, L.subheadline)) v('text_too_long', `subheadline ≤ ${L.subheadline}`, 'subheadline');
    source('subheadline', c.subheadlineSource);
  }
  if (over(c.handwritten, L.handwritten) || wordsOver(c.handwritten, L.handwrittenWords)) v('text_too_long', `handwritten ≤ ${L.handwritten} chars and ${L.handwrittenWords} words`, 'handwritten');
  if (over(c.closing, L.closing) || wordsOver(c.closing, L.closingWords)) v('text_too_long', `closing ≤ ${L.closing} chars and ${L.closingWords} words`, 'closing');

  // cards e faixa de confiança: 0 ou 3-5 / 0 ou 3, cada item com fonte do Brain e sem a marca
  const benefits = Array.isArray(c.benefits) ? c.benefits : [];
  if (benefits.length && (benefits.length < 3 || benefits.length > 5)) v('static_count', `benefits must be 0 or 3-5, got ${benefits.length}`, 'benefits');
  benefits.forEach((b, k) => {
    const block = `benefits.${k}`;
    if (!has(b?.title) || !has(b?.line)) v('text_empty', 'each benefit needs title and line', block);
    if (over(b?.title, L.benefitTitle) || over(b?.line, L.benefitLine)) v('text_too_long', `benefit: title ≤ ${L.benefitTitle}, line ≤ ${L.benefitLine}`, block);
    if (!STATIC_ICONS.includes(b?.icon)) v('static_icon_invalid', `icon must be one of ${STATIC_ICONS.join('|')}`, block);
    source('benefits', b?.source, block);
    const brand = brandIn([b?.title, b?.line], ctx);
    if (brand) v('static_copy_has_brand', `the brand ("${brand}") only goes in the brand block`, block);
  });
  const trust = Array.isArray(c.trust) ? c.trust : [];
  if (trust.length && trust.length !== 3) v('static_count', `trust must be 0 or 3, got ${trust.length}`, 'trust');
  trust.forEach((t, k) => {
    const block = `trust.${k}`;
    if (!has(t?.text)) v('text_empty', 'each trust item needs text', block);
    if (over(t?.text, L.trustText)) v('text_too_long', `trust text ≤ ${L.trustText}`, block);
    if (!STATIC_ICONS.includes(t?.icon)) v('static_icon_invalid', `icon must be one of ${STATIC_ICONS.join('|')}`, block);
    source('trust', t?.source, block);
    const brand = brandIn([t?.text], ctx);
    if (brand) v('static_copy_has_brand', `the brand ("${brand}") only goes in the brand block`, block);
  });

  // CTA (main sempre existe; sub só com dado)
  if (!has(c.cta?.main)) v('text_empty', 'cta.main is required', 'cta.main');
  if (over(c.cta?.main, L.ctaMain)) v('text_too_long', `cta.main ≤ ${L.ctaMain}`, 'cta.main');
  if (has(c.cta?.sub)) {
    if (over(c.cta?.sub, L.ctaSub)) v('text_too_long', `cta.sub ≤ ${L.ctaSub}`, 'cta.sub');
    source('cta.sub', c.cta?.subSource, 'cta.sub');
  }

  // "nada inventado" (§A3.2 itens 1-2) em todo texto do copy + screenTitle
  const texts = [...staticTexts(c), ...(has(vis.product?.screenTitle) ? [{ block: 'screenTitle', text: vis.product.screenTitle!.trim() }] : [])];
  for (const t of texts) {
    const n = inventedNumbers(t.text, ctx);
    if (n.length) v('invented_number', `"${t.text}" has ${n.join(', ')}, not in the Brain nor the transcript`, t.block);
    const cl = inventedClaims(t.text, ctx);
    if (cl.length) v('invented_claim', `"${t.text}" claims "${cl.join('", "')}" with nothing in the Brain or the transcript to back it`, t.block);
  }
  const total = staticCopyLength(c);
  if (total > L.copyTotal) v('static_copy_too_long', `all copy texts sum ${total} chars, max ${L.copyTotal}`, '*total');

  // visual V2 (inglês, sem texto entre aspas, sem marca)
  if (!has(vis.mood)) v('static_visual_missing', 'visual.mood is required (in English)');
  if (over(vis.mood, L.mood)) v('text_too_long', `visual.mood ≤ ${L.mood}`);
  if (vis.hero) {
    if (!has(vis.hero.person) || !has(vis.hero.setting) || !has(vis.hero.light) || !STATIC_EMOTIONS.includes(vis.hero.emotion)) {
      v('static_visual_missing', `hero needs person, setting, light and emotion ${STATIC_EMOTIONS.join('|')} (or hero: null)`);
    }
    if (over(vis.hero.person, L.person) || over(vis.hero.setting, L.setting) || over(vis.hero.light, L.light)) {
      v('text_too_long', `hero: person ≤ ${L.person}, setting ≤ ${L.setting}, light ≤ ${L.light}`);
    }
  }
  if (!vis.product || !PRODUCT_KINDS.includes(vis.product.kind)) v('static_visual_missing', `product.kind must be ${PRODUCT_KINDS.join('|')}`);
  if (over(vis.product?.look, L.look)) v('text_too_long', `product.look ≤ ${L.look}`);
  if (has(vis.product?.screenTitle)) {
    if (over(vis.product.screenTitle, L.screenTitle)) v('text_too_long', `screenTitle ≤ ${L.screenTitle}`, 'screenTitle');
    source('screenTitle', vis.product.screenTitleSource, 'screenTitle');
  }
  const visTexts = [vis.hero?.person, vis.hero?.setting, vis.hero?.light, vis.product?.look, vis.mood];
  if (visTexts.some((t) => !!t && QUOTE_RE.test(t))) v('static_visual_has_text', 'no quoted text in visual: the texts on the image are only the copy blocks');
  const brand = brandIn(visTexts, ctx);
  if (brand) v('static_visual_has_brand', `visual must not name the brand ("${brand}"): describe it by how it looks`);
  return out;
}

/** Ordem em que o reparo corta blocos opcionais quando a soma passa de 420 (do menos pro mais importante). */
const TRIM_ORDER = ['closing', 'handwritten', 'tagline', 'brandLine', 'subheadline', 'trust', 'benefits', 'cta.sub'] as const;

/** Apaga um bloco opcional do copy (null/[]); `benefits.N`/`trust.N` tiram o item (se o que sobra não fecha, o bloco todo). */
function dropBlock(c: StaticCopy, vis: StaticVisualV2, block: string): { copy: StaticCopy; visual: StaticVisualV2 } {
  const copy: StaticCopy = { ...c, headline: { ...c.headline }, cta: { ...c.cta }, benefits: [...(c.benefits ?? [])], trust: [...(c.trust ?? [])] };
  let visual = vis;
  const [head, idx] = block.split('.');
  switch (head) {
    case 'brandLine': copy.brandLine = null; copy.brandLineSource = null; break;
    case 'tagline': copy.tagline = null; break;
    case 'subheadline': copy.subheadline = null; copy.subheadlineSource = null; break;
    case 'handwritten': copy.handwritten = null; break;
    case 'closing': copy.closing = null; break;
    case 'cta': if (idx === 'sub') { copy.cta.sub = null; copy.cta.subSource = null; } break;
    case 'screenTitle': visual = { ...vis, product: { ...vis.product, screenTitle: null, screenTitleSource: null } }; break;
    case 'benefits':
      if (idx === undefined) copy.benefits = [];
      else {
        copy.benefits = copy.benefits.filter((_, k) => k !== Number(idx));
        if (copy.benefits.length < 3) copy.benefits = [];
      }
      break;
    case 'trust': copy.trust = []; break; // 0 ou 3: sem um item, a faixa inteira some
  }
  return { copy, visual };
}

/**
 * §A3.2 (reparo determinístico do STATIC V2): apaga os blocos OPCIONAIS que violaram (vira null/[]) em vez de tirar a peça;
 * soma > 420 corta blocos opcionais na ordem do TRIM_ORDER. Violação na headline, no CTA principal, no visual ou da peça
 * inteira fica (o reparo do plano tira a peça). Puro: devolve itens novos, mesma ordem.
 */
export function repairStaticBlocks(items: PlanItem[], violations: Violation[]): PlanItem[] {
  return items.map((it, i) => {
    if (it.type !== 'STATIC' || it.params?.type !== 'STATIC') return it;
    const v2 = staticV2Of(it.params);
    if (!v2) return it;
    const mine = violations.filter((v) => v.item === i);
    if (!mine.length || mine.some((v) => !v.block || STATIC_REQUIRED_BLOCKS.has(v.block))) return it;
    let { copy, visual } = v2;
    // índices de item em ordem decrescente: tirar o benefits.3 antes do benefits.1 não desloca os outros
    const blocks = [...new Set(mine.map((v) => v.block!).filter((b) => b !== '*total'))].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const b of blocks) ({ copy, visual } = dropBlock(copy, visual, b));
    for (const b of TRIM_ORDER) {
      if (staticCopyLength(copy) <= STATIC_V2_LIMITS.copyTotal) break;
      ({ copy, visual } = dropBlock(copy, visual, b));
    }
    const params = { ...it.params, copy, ...('visualV2' in it.params && it.params.visualV2 ? { visualV2: visual } : { visual }) } as AutoParamsDraft;
    return { ...it, params };
  });
}

// ───────── FRAME (molduras, §B2/§B5) ─────────

/** Limites do §B2 por template (caracteres visíveis: os *asteriscos* do destaque não contam). `list` = [mín, máx] itens. */
interface FrameField { path: string; max: number; nullable?: boolean; list?: [number, number] }
export const FRAME_FIELDS: Record<FrameTemplateId, FrameField[]> = {
  question_box: [{ path: 'question', max: 70 }],
  meme: [{ path: 'pov', max: 70 }, { path: 'cta', max: 28 }],
  cinema: [{ path: 'question', max: 60 }, { path: 'subtitle', max: 80 }],
  news: [{ path: 'topic', max: 18 }, { path: 'headline.lead', max: 40 }, { path: 'headline.highlight', max: 30 }, { path: 'dek', max: 80 }, { path: 'cta', max: 28 }],
  read_caption: [{ path: 'headline', max: 70 }, { path: 'primaryText', max: 600 }],
  pov_testimonial: [{ path: 'pov', max: 80 }, { path: 'cta', max: 28 }],
  direct_offer: [{ path: 'promise', max: 40 }, { path: 'price.from', max: 24, nullable: true }, { path: 'price.to', max: 24 }, { path: 'cta', max: 28 }],
  live: [],
  ranking: [{ path: 'title', max: 24 }, { path: 'items', max: 28, list: [3, 5] }],
  post_card: [{ path: 'copy', max: 140 }],
  story: [{ path: 'question', max: 70 }, { path: 'headline', max: 40 }, { path: 'support', max: 80 }, { path: 'copy', max: 320 }],
  call: [{ path: 'title', max: 40 }, { path: 'slideTitle', max: 50 }, { path: 'slideSteps', max: 32, list: [3, 3] }],
  // B2 (§B3): forma já validada pra quando entrar
  split_stack: [{ path: 'headline', max: 50 }],
  split_torn: [{ path: 'headline', max: 50 }],
  gossip_page: [{ path: 'headline', max: 80 }, { path: 'pageName', max: 24 }],
  gossip_white: [{ path: 'headline', max: 80 }],
  gossip_pink: [{ path: 'headline', max: 80 }],
  call_dialog: [{ path: 'title', max: 40 }, { path: 'names', max: 14, list: [2, 2] }],
};
/** Textos cuja fonte a validação COBRA (§B2: "validação cobra a fonte"), com as fontes aceitas. */
const FRAME_REQUIRED_SOURCES: Partial<Record<FrameTemplateId, { list: string; accept: readonly CopySource[] }>> = {
  ranking: { list: 'items', accept: RANKING_SOURCES },
  call: { list: 'slideSteps', accept: CALL_STEP_SOURCES },
};

const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
/** Comprimento visível (sem os asteriscos do destaque). */
export const visibleLength = (s: string) => s.replace(/\*/g, '').trim().length;
/** Destaque: no máximo 1 trecho `*assim*` por texto (0 ou 2 asteriscos, trecho não vazio). */
export const highlightOk = (s: string) => {
  const n = (s.match(/\*/g) ?? []).length;
  return n === 0 || (n === 2 && /\*[^*]*\S[^*]*\*/.test(s));
};

/** Todos os textos de tela da moldura com o caminho ("headline.lead", "items.0", "price.to"). */
export function frameTexts(template: FrameTemplateId, texts: unknown): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const f of FRAME_FIELDS[template] ?? []) {
    const val = getPath(texts, f.path);
    if (f.list) (Array.isArray(val) ? val : []).forEach((x, k) => { if (typeof x === 'string' && x.trim()) out.push({ path: `${f.path}.${k}`, text: x }); });
    else if (typeof val === 'string' && val.trim()) out.push({ path: f.path, text: val });
  }
  return out;
}

function frameViolations(p: AutoFrameDraft, i: number, ctx: PlanCtx): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ item: i, rule, detail });
  const allowed = allowedFrames(ctx).find((f) => f.template === p.template);
  if (!allowed) {
    v('frame_unknown', `template must be one of ${FRAME_TEMPLATE_IDS.join('|')}`);
    return out;
  }
  if (!allowed.allowed) {
    v('frame_not_allowed', `the ${p.template} frame is not allowed here (${allowed.blockedReason})`);
    return out;
  }
  return frameContentViolations(p, i, ctx);
}

/**
 * Forma, limites, "nada inventado", fontes e preço literal dos textos de UMA moldura, sem o "permitido quando" (o
 * `allowedFrames`). Usado pelo validatePlan (depois do allowedFrames) e pelo script de teste das 18 molduras
 * (`dev/molduras-todas.ts`), que valida as 6 de 2 fontes antes de o B2 liberá-las no produto.
 */
export function frameContentViolations(p: AutoFrameDraft, i: number, ctx: PlanCtx): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ item: i, rule, detail });
  if (!FRAME_FIELDS[p.template]) {
    v('frame_unknown', `template must be one of ${FRAME_TEMPLATE_IDS.join('|')}`);
    return out;
  }
  const texts = (p.texts ?? {}) as unknown;
  const sources = (p.sources ?? {}) as Record<string, CopySource>;
  // forma e limites
  for (const f of FRAME_FIELDS[p.template]) {
    const val = getPath(texts, f.path);
    if (f.list) {
      const list = Array.isArray(val) ? val : [];
      if (list.length < f.list[0] || list.length > f.list[1]) v('frame_count', `${f.path} needs ${f.list[0] === f.list[1] ? f.list[0] : `${f.list[0]}-${f.list[1]}`} entries, got ${list.length}`);
      list.forEach((x, k) => {
        if (typeof x !== 'string' || !x.trim()) v('text_empty', `${f.path}.${k} is empty`);
        else if (visibleLength(x) > f.max) v('text_too_long', `${f.path}.${k} over ${f.max} chars`);
      });
      continue;
    }
    if (val === null && f.nullable) continue;
    if (typeof val !== 'string' || !val.trim()) {
      v('text_empty', `${f.path} is required`);
      continue;
    }
    if (visibleLength(val) > f.max) v('text_too_long', `${f.path} over ${f.max} chars`);
  }
  const all = frameTexts(p.template, texts);
  for (const t of all) {
    if (!highlightOk(t.text)) v('frame_highlight_invalid', `${t.path}: at most one *highlight* per text`);
    const plain = t.text.replace(/\*/g, '');
    const n = inventedNumbers(plain, ctx);
    if (n.length) v('invented_number', `"${plain}" has ${n.join(', ')}, not in the Brain nor the transcript`);
    const cl = inventedClaims(plain, ctx);
    if (cl.length) v('invented_claim', `"${plain}" claims "${cl.join('", "')}" with nothing in the Brain or the transcript to back it`);
  }
  // fontes: toda fonte citada tem que existir no Brain; ranking/call cobram a fonte de cada item
  const flagged = new Set<string>();
  for (const [path, src] of Object.entries(sources)) {
    if (src && src !== 'generic' && !sourceFilled(src, ctx)) {
      v('unsupported_source', `${path} cites ${src}, which is empty in the Brain`);
      flagged.add(path);
    }
  }
  const req = FRAME_REQUIRED_SOURCES[p.template];
  if (req) {
    const list = getPath(texts, req.list);
    (Array.isArray(list) ? list : []).forEach((_, k) => {
      const path = `${req.list}.${k}`;
      const src = sources[path];
      if (!flagged.has(path) && (!src || !req.accept.includes(src))) v('unsupported_source', `${path} needs a source from ${req.accept.join('|')}`);
    });
  }
  // §B5: preço literal do offerAndPrice (nunca da fala nem da página)
  if (p.template === 'direct_offer') {
    const brainPrices = pricesIn(ctx.brain.offerAndPrice);
    const price = (p.texts as FrameTexts['direct_offer']).price ?? { from: null, to: '' };
    const to = pricesIn(price.to);
    if (!to.length || !to.some((x) => brainPrices.some((y) => samePrice(x, y)))) {
      v('price_not_in_brain', `price.to ("${price.to}") must be written exactly as a price in Brain › Offer and price`);
    }
    if (price.from !== null && price.from !== undefined) {
      const distinct = new Set(brainPrices.map((x) => `${x.currency}:${x.digits}`));
      const from = pricesIn(price.from);
      if (distinct.size < 2) v('price_from_invalid', 'price.from only when Brain › Offer and price has two prices; otherwise null');
      else if (!from.length || !from.some((x) => brainPrices.some((y) => samePrice(x, y))) || from.some((x) => to.some((y) => samePrice(x, y)))) {
        v('price_from_invalid', `price.from ("${price.from}") must be the other price written in Brain › Offer and price`);
      }
    }
  }
  return out;
}

/**
 * headline-e-legenda-v1 §1.1: o modo é o do campeão; texto ≤ limite (replace = original × 1,2, mín. 20, máx. 90; add = 60);
 * destaque só se a original tem e é trecho do texto; "nada inventado" (número/afirmação só do Brain ou da fala); diferente
 * da original (comparação normalizada). As do lote diferentes entre si = `duplicateKey`.
 */
function headlineViolations(p: Extract<AutoParamsDraft, { type: 'HEADLINE' }>, i: number, ctx: PlanCtx): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ item: i, rule, detail });
  const h = ctx.headline;
  if (!h) return [{ item: i, rule: 'type_not_allowed', detail: 'HEADLINE needs the champion headline info' }];
  const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
  if (p.mode !== h.mode) v('headline_mode', `mode must be ${h.mode}`);
  if (!text) v('text_empty', 'text is empty');
  if (text.length > h.maxChars) v('headline_too_long', `text over ${h.maxChars} chars`);
  if (p.highlight) {
    if (!h.hasHighlight) v('headline_highlight', 'the original headline has no highlight: highlight must be null');
    else if (!text.includes(p.highlight.trim())) v('headline_highlight', 'highlight must be a stretch of the text');
  }
  if (h.original && normalizeText(text) === normalizeText(h.original)) v('headline_same_as_original', 'write a new headline, not the original');
  const n = inventedNumbers(text, ctx);
  if (n.length) v('invented_number', `"${text}" has ${n.join(', ')}, not in the Brain nor the transcript`);
  const cl = inventedClaims(text, ctx);
  if (cl.length) v('invented_claim', `"${text}" claims "${cl.join('", "')}" with nothing in the Brain or the transcript to back it`);
  for (const [path, src] of Object.entries(p.sources ?? {})) {
    if (src && src !== 'generic' && !sourceFilled(src, ctx)) v('unsupported_source', `${path} cites ${src}, which is empty in the Brain`);
  }
  return out;
}

/** Repetição do mesmo tipo tem que mudar o conteúdo (D2): mesmo alvo de CUT, mesmo texto, mesma busca, mesmo frame. */
function duplicateKey(p: AutoParamsDraft): string | null {
  switch (p.type) {
    case 'CUT': return `CUT:${p.targetSec}`;
    case 'HOOK_TEXT': return `HOOK_TEXT:${normalizeText(p.text ?? '')}`;
    case 'NATIVE_SEARCH': return `NATIVE_SEARCH:${normalizeText(p.query ?? '')}`;
    case 'STATIC': {
      const v2 = staticV2Of(p); // §A3.2 item 6: conceito = headline (lead + highlight)
      return `STATIC:${normalizeText(v2 ? `${v2.copy.headline?.lead ?? ''} ${v2.copy.headline?.highlight ?? ''}` : p.headline ?? '')}`;
    }
    case 'FRAME': return `FRAME:${p.template}`; // D10: templates diferentes
    case 'HEADLINE': return `HEADLINE:${normalizeText(p.text ?? '')}`; // §1.1: as do lote diferentes entre si
    case 'CHAT_DM': case 'PERSON_MOTION': return p.type; // iterate-v2: 1 por lote
    default: return null;
  }
}

/** legenda-protegida-v1 §3: params do item como o build vai ver (FRAME = FrameSpec; CUT = spans dos blocos). */
function captionParamsOf(it: PlanItem, ctx: PlanCtx): Record<string, unknown> | null {
  const p = it.params;
  switch (p.type) {
    case 'FRAME': return frameSpecOf(p as AutoFrameDraft, ctx) as unknown as Record<string, unknown>;
    case 'HEADLINE': return { type: 'HEADLINE', mode: p.mode, text: (p.text ?? '').trim(), highlight: p.highlight ?? null, language: ctx.headline?.language ?? screenLangOf(ctx) };
    case 'CUT': {
      const spans = ctx.blocks.filter((b) => (p.blockIndexes ?? []).includes(b.index)).map((b) => ({ startSec: b.startSec, endSec: b.endSec }));
      return { type: 'CUT', targetSec: p.targetSec, blockIndexes: [...(p.blockIndexes ?? [])], timeline: mergeSpans(spans) };
    }
    case 'REVIEW': case 'NATIVE_SEARCH': return { ...p };
    default: return null;
  }
}

/** legenda-protegida-v1 §2.3/§3: a validação repete a conta do `allowed` com o texto real (função do build). */
function captionViolation(it: PlanItem, i: number, ctx: PlanCtx): Violation | null {
  if (!ctx.caption?.bands.length) return null;
  const params = captionParamsOf(it, ctx);
  if (!params) return null;
  if (!ctx.caption.check({ type: it.type, params })) return null;
  const what = it.params.type === 'FRAME' ? `the ${(it.params as AutoFrameDraft).template} frame` : `this ${it.type}`;
  return { item: i, rule: 'burned_captions', detail: `${what} would cover or cut the champion's burned-in captions: leave it out` };
}

/** §6.1 + §6.2 sobre o rascunho. Violação com `item` = a peça sai no reparo; `item: null` = do plano. */
export function validatePlan(draft: AutoPlanDraft, ctx: PlanCtx, allowed: AllowedType[]): Violation[] {
  const byType = new Map(allowed.map((a) => [a.type, a]));
  const items = itemsOf(draft);
  const out: Violation[] = [];
  const count = new Map<AutoVariationType, number>();
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const own = itemViolations(it, i, draft, ctx, byType);
    out.push(...own);
    if (!own.length) {
      const cv = captionViolation(it, i, ctx);
      if (cv) out.push(cv);
    }
    if (own.some((v) => v.rule === 'type_not_allowed' || v.rule === 'params_mismatch')) return;
    const n = (count.get(it.type) ?? 0) + 1;
    count.set(it.type, n);
    const max = byType.get(it.type)?.max ?? 0;
    if (n > max) out.push({ item: i, rule: 'over_max', detail: `at most ${max} ${it.type} per batch` });
    const key = duplicateKey(it.params);
    if (key) {
      if (seen.has(key)) out.push({ item: i, rule: 'duplicate', detail: it.type === 'FRAME' ? 'two frames in a batch must use different templates' : 'a repeated type must change its content (other text, frame or length)' });
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
 * STATIC V2 primeiro apaga os blocos opcionais que violaram (§A3.2); depois tira as peças que ainda violam; acima de 12,
 * tira ITERATION do fim; diversidade < 40 %: tira ITERATION da última pra primeira. `why`/`kept` incompletos são
 * completados a partir do vídeo (não derrubam o lote). ok = piso (4) e diversidade fecham. `violations` = as que sobraram
 * depois do reparo de blocos (as que tiraram peças).
 */
export function repairPlan(draft: AutoPlanDraft, ctx: PlanCtx, allowed: AllowedType[], fallback: { why: AutoPlanDraft['why']; kept: AutoPlanDraft['kept'] }): RepairResult {
  const patched: AutoPlanDraft = { ...draft, items: repairStaticBlocks(itemsOf(draft), validatePlan(draft, ctx, allowed)) as unknown as AutoItemDraft[] };
  const violations = validatePlan(patched, ctx, allowed);
  const bad = new Map<number, string[]>();
  for (const v of violations) if (v.item !== null) bad.set(v.item, [...(bad.get(v.item) ?? []), v.rule]);
  const removed: RepairResult['removed'] = [];
  const all = itemsOf(patched);
  let items = all.filter((it, i) => {
    if (!bad.has(i)) return true;
    removed.push({ index: i, type: it.type, rules: bad.get(i)! });
    return false;
  });
  // headline-e-legenda-v1 §3.2: o reparo tira CUT (do fim) antes de HEADLINE; HEADLINE só se não sobrar outro ITERATION
  const dropLastIteration = (): boolean => {
    for (const poupar of [true, false]) {
      for (let k = items.length - 1; k >= 0; k--) {
        if (AXIS_OF[items[k].type] === 'ITERATION' && !(poupar && items[k].type === 'HEADLINE')) {
          removed.push({ index: all.indexOf(items[k]), type: items[k].type, rules: ['repair'] });
          items = items.filter((_, j) => j !== k);
          return true;
        }
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
  const repaired: AutoPlanDraft = { ...draft, why, kept, items: items as unknown as AutoItemDraft[] };
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
  | { type: 'STATIC'; headline: string; refAtSec: number | null; visual: StaticVisualDraft } // rev. 23/10 §14.3 (sem atSec)
  /** 25/10 §A2/§A5: plano novo. `headline` = lead + highlight (rótulo/duplicado/legado); `visual` = V2 */
  | { type: 'STATIC'; layout: 'assembled'; headline: string; refAtSec: number | null; copy: StaticCopy; visual: StaticVisualV2 }
  /** headline-e-legenda-v1: o que o `HeadlineSpec` do render precisa (+ a original, pra vista "original → nova") */
  | { type: 'HEADLINE'; mode: 'replace' | 'add'; text: string; highlight: string | null; sources: Record<string, CopySource>; language: string; original: string | null; format: string | null }
  /** 25/10 §B2: = FrameSpec (lido pelo buildFrameInput do video) + as fontes de cada texto (rastreio) */
  | ({ type: 'FRAME'; sources: Record<string, CopySource> } & FrameSpec)
  /** iterate-v2 F1.3: = TemplateSpec (lido pelo buildTemplateInput do video) */
  | TemplateSpec;

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

const t = (s: string | null | undefined) => (s ?? '').trim();
const tn = (s: string | null | undefined) => (has(s) ? s!.trim() : null);

/** Copy salvo (§A2): textos aparados, vazios viram null, fonte de bloco apagado vira null. */
function trimCopy(c: StaticCopy): StaticCopy {
  const brandLine = tn(c.brandLine);
  const subheadline = tn(c.subheadline);
  const sub = tn(c.cta?.sub);
  return {
    brandLine, brandLineSource: brandLine ? c.brandLineSource ?? null : null,
    tagline: tn(c.tagline),
    headline: { lead: t(c.headline?.lead), highlight: t(c.headline?.highlight) }, headlineSource: c.headlineSource,
    subheadline, subheadlineSource: subheadline ? c.subheadlineSource ?? null : null,
    handwritten: tn(c.handwritten),
    benefits: (c.benefits ?? []).map((b) => ({ icon: b.icon, title: t(b.title), line: t(b.line), source: b.source })),
    trust: (c.trust ?? []).map((x) => ({ icon: x.icon, text: t(x.text), source: x.source })),
    cta: { main: t(c.cta?.main), sub, subSource: sub ? c.cta?.subSource ?? null : null },
    closing: tn(c.closing),
  };
}

function trimVisual(v: StaticVisualV2): StaticVisualV2 {
  const screenTitle = tn(v.product?.screenTitle);
  return {
    hero: v.hero ? { person: t(v.hero.person), setting: t(v.hero.setting), emotion: v.hero.emotion, light: t(v.hero.light) } : null,
    product: { kind: v.product?.kind ?? 'none', look: tn(v.product?.look), screenTitle, screenTitleSource: screenTitle ? v.product?.screenTitleSource ?? null : null },
    mood: t(v.mood),
  };
}

/** Textos da moldura aparados (strings no caminho; listas item a item; `price.from` vazio = null). */
function trimFrameTexts(template: FrameTemplateId, texts: unknown): FrameTexts[FrameTemplateId] {
  const trimDeep = (x: unknown): unknown =>
    typeof x === 'string' ? x.trim() : Array.isArray(x) ? x.map(trimDeep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, trimDeep(v)])) : x;
  const out = (trimDeep(texts ?? {}) ?? {}) as Record<string, unknown>;
  if (template === 'direct_offer') {
    const price = (out.price ?? {}) as { from?: string | null; to?: string };
    out.price = { from: has(price.from) ? price.from : null, to: price.to ?? '' };
  }
  return out as unknown as FrameTexts[FrameTemplateId];
}

/** Marca da moldura sem o ctx.frame (testes/legado): nome = 2º brandTerm (oferta), handle = 1º (workspace). */
function fallbackBrand(ctx: PlanCtx): FrameBrand {
  const name = ctx.offerName || ctx.brandTerms[1] || ctx.brandTerms[0] || 'Brand';
  const ws = ctx.brandTerms[0] || name;
  const handle = '@' + (ws.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._]+/g, '').slice(0, 24) || 'brand');
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'B';
  return { name, handle, initials, color: DEFAULT_ACCENT };
}

/** §B2: FrameSpec da peça (o que o buildFrameInput do video lê). Marca e rosto do backend; B1 = sem 2ª fonte. */
export function frameSpecOf(p: AutoFrameDraft, ctx: PlanCtx): Extract<FinalParams, { type: 'FRAME' }> {
  const texts = trimFrameTexts(p.template, p.texts);
  const face = FRAME_WITH_FACE.includes(p.template) ? ctx.frame?.faceAtSec ?? null : null;
  return {
    type: 'FRAME', template: p.template, texts, sources: { ...(p.sources ?? {}) }, screenLanguage: screenLangOf(ctx),
    brand: ctx.frame?.brand ?? fallbackBrand(ctx), faceAtSec: face, second: null,
    suggestedPrimaryText: p.template === 'read_caption' ? (texts as FrameTexts['read_caption']).primaryText ?? null : null,
  };
}

export function finalizePlan(draft: AutoPlanDraft, ctx: PlanCtx, media: Pick<MediaRulesPort, 'snapSpans'>): FinalItem[] {
  const nth = new Map<AutoVariationType, number>();
  const hookEnd = hookTextEndSec(draft, ctx);
  return itemsOf(draft).map((it, index) => {
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
      case 'STATIC': {
        const ref = p.refAtSec !== undefined ? p.refAtSec : typeof p.atSec === 'number' ? p.atSec : null;
        const refAtSec = ref === null ? null : Math.round(ref * 1000) / 1000;
        const v2 = staticV2Of(p);
        if (v2) {
          const copy = trimCopy(v2.copy);
          params = { type: 'STATIC', layout: 'assembled', headline: `${copy.headline.lead} ${copy.headline.highlight}`.trim(), refAtSec, copy, visual: trimVisual(v2.visual) };
          break;
        }
        const vis = p.visual ?? { object: '', scene: '', vibe: '', style: 'ad_graphic' as const, headlinePlacement: 'center' as const }; // validatePlan garante o visual
        params = {
          type: 'STATIC', headline: p.headline.trim(), refAtSec,
          visual: { object: vis.object.trim(), scene: vis.scene.trim(), vibe: vis.vibe.trim(), style: vis.style, headlinePlacement: vis.headlinePlacement },
        };
        break;
      }
      case 'FRAME':
        variant = p.template;
        params = frameSpecOf(p, ctx);
        break;
      case 'HEADLINE':
        params = {
          type: 'HEADLINE', mode: p.mode, text: p.text.replace(/\s+/g, ' ').trim(), highlight: p.highlight?.trim() || null, sources: { ...(p.sources ?? {}) },
          language: ctx.headline?.language ?? screenLangOf(ctx), original: ctx.headline?.original ?? null,
          format: ctx.headline?.format ?? null, // §1.5: a peça só existe no aspecto do campeão
        };
        break;
      case 'CHAT_DM':
      case 'PERSON_MOTION':
        params = templateSpecOf(p, ctx, media, ctx.frame?.brand ?? fallbackBrand(ctx));
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
