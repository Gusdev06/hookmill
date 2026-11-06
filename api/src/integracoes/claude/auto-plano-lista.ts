// Templates de lista (templates-lista-v1 §2, 04/11; Versus e Value stack aprovados pelo Gusta): as linhas do
// LIST_OVERLAY saem na 2ª etapa do MESMO planAutoBatch, 1 chamada por template (como o CHAT_DM), com o mesmo sistema +
// contexto (prefixo cacheado). As regras vão no PEDIDO (o AUTO_PLAN_SYSTEM fica igual em todo lote: cache).
// O plano (etapa 1) só escolhe o tipo e o template (`listTemplate`); o modo vem do template, nunca da IA.
// Âncora: o modelo devolve o segundo + a palavra (como o PERSON_MOTION, que manda segundos); o parse converte pro índice
// GLOBAL da transcrição. Aqui só FORMA: limites, quantidades e "nada inventado" (número só da fala ou de `proof`; preço
// só de `offerAndPrice`) são do backend (iteracao/lista-plano.ts) e voltam como `violations` no reparo.
import type { AutoListOverlayDraft, AutoPlanInput, ListLineDraft, ListTemplateId, ListTextDraft, TranscriptWord } from '../contrato';

export const LIST_TEMPLATES: readonly ListTemplateId[] = ['versus', 'value-stack'];
export const isListTemplate = (v: unknown): v is ListTemplateId => typeof v === 'string' && (LIST_TEMPLATES as readonly string[]).includes(v);

/** §2.1 (caracteres visíveis; CJK 1 = 1). Repetidos no prompt; o backend confere. */
export const LIST_LIMITS = {
  head: 14, versusCell: 24, stackTitle: 18, stackItem: 30, stackProof: 30, stackPrice: 34, stackCta: 22,
  versusPairsMin: 3, versusPairsMax: 4, stackBarsMax: 5, stackItemsMin: 2, stackItemsMax: 4, stackBodyMin: 3,
} as const;

const SOURCES = ['transcript', 'brain', 'both', 'generic'] as const;
const FIELDS = ['pains', 'promise', 'what', 'proof', 'offerAndPrice', 'cta', 'name'] as const;
const KINDS = ['item', 'proof', 'price', 'cta'] as const;

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const arr = (items: object, description: string) => ({ type: 'array', items, description });
const en = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

const TRACE = {
  source: en(SOURCES, 'transcript = the champion says it; brain = a Brain field; both = said AND in a Brain field; generic = a translated template label (only heads.bad / title).'),
  field: en([...FIELDS, 'none'], 'The Brain field it comes from (required for brain/both; name = the offer name, only heads.good). "none" for transcript/generic.'),
  anchorSec: num('transcript/both: start second (from <transcript>) of the word where the champion starts saying it. -1 otherwise.'),
  anchorWord: str('transcript/both: that word exactly as written in <transcript>. Empty otherwise.'),
};
const TEXT = (what: string) => obj({ text: str(what), ...TRACE });

/** Versus: 2 colunas (erro × acerto). `order` é a única escolha de forma da IA. */
export const VERSUS_SCHEMA = obj({
  list: obj({
    order: en(['by_speech', 'alternate'], 'by_speech = each column fills when the speech treats that side; alternate = pair by pair, only when the speech does not separate the sides.'),
    heads: obj({
      bad: TEXT(`Left header, max ${LIST_LIMITS.head}: an alternative the champion names (transcript) or a translated generic label like "Other ways" (generic).`),
      good: TEXT(`Right header, max ${LIST_LIMITS.head}: the offer name shortened (brain, field name).`),
    }),
    lines: arr(obj({
      side: en(['bad', 'good'], 'bad = what people put up with today; good = what the offer does instead.'),
      text: str(`Cell text, max ${LIST_LIMITS.versusCell}, screen language.`),
      ...TRACE,
    }), 'The cells: the same number of bad and good, each column in the order it is said.'),
  }),
});

/** Value stack: até 5 barras (itens, prova, preço, CTA), na ordem da fala. */
export const STACK_SCHEMA = obj({
  list: obj({
    title: TEXT(`Title, max ${LIST_LIMITS.stackTitle}: a translated generic label like "What you get" (generic) or the speech's own framing (transcript).`),
    lines: arr(obj({
      kind: en(KINDS, `item (benefit, max ${LIST_LIMITS.stackItem}) · proof (a real number, max ${LIST_LIMITS.stackProof}) · price (only from offerAndPrice, max ${LIST_LIMITS.stackPrice}) · cta (max ${LIST_LIMITS.stackCta}, last).`),
      text: str('Bar text, screen language.'),
      ...TRACE,
    }), `Up to ${LIST_LIMITS.stackBarsMax} bars, in the order they are said.`),
  }),
});

export const LIST_SCHEMAS: Record<ListTemplateId, Record<string, unknown>> = { versus: VERSUS_SCHEMA, 'value-stack': STACK_SCHEMA };

/** Os templates de lista liberados neste pedido, na ordem do catálogo: entradas LIST_OVERLAY de `allowed` com
 *  `templateId` e max > 0; sem `templateId` nas entradas, as chaves `LIST_OVERLAY:<id>` de `picked`; sem nada, os 2. */
export function listTemplatesOf(i: { allowed: readonly AutoPlanInput['allowed'][number][]; picked?: readonly string[] }): ListTemplateId[] {
  const entries = i.allowed.filter((a) => a.type === 'LIST_OVERLAY');
  if (!entries.some((a) => a.max > 0)) return [];
  const withId = entries.filter((a) => a.templateId);
  const ids = withId.length
    ? withId.filter((a) => a.max > 0).map((a) => a.templateId!)
    : (i.picked ?? []).filter((k) => k.startsWith('LIST_OVERLAY:')).map((k) => k.slice('LIST_OVERLAY:'.length));
  const out = LIST_TEMPLATES.filter((t) => ids.includes(t));
  return withId.length || out.length ? out : [...LIST_TEMPLATES];
}

/** Bloco do pedido do PLANO (dentro do <edit_templates>): o que é, quais templates, e que as linhas vêm depois. */
export function listPlanRequest(ids: ListTemplateId[], uiLocale: 'EN' | 'PT_BR' = 'EN'): string {
  const what: Record<ListTemplateId, string> = {
    versus: 'versus (two columns that fill line by line: what people put up with today × what the offer does instead)',
    'value-stack': 'value-stack (each benefit becomes a bar when it is said and stays; ends on the price and the call)',
  };
  const change = uiLocale === 'PT_BR'
    ? { versus: 'A fala vira uma tabela de antes × depois', 'value-stack': 'Cada benefício vira uma barra que fica' }
    : { versus: 'The speech becomes a before × after table', 'value-stack': 'Each benefit becomes a bar that stays' };
  return [
    `LIST_OVERLAY [DIVERSITY]: a list drawn over the untouched champion video (same footage and audio, no cut) that fills in sync with the speech and stays on screen. Templates allowed here: ${ids.map((t) => what[t]).join('; ')}.`,
    `Write exactly 1 LIST_OVERLAY piece per template listed, with listTemplate = its id (never the same template twice). In the plan a LIST_OVERLAY piece only gets its type, listTemplate, change and rationale; its lines are written right after, in a second step. change in the interface language, like ${ids.map((t) => `"${change[t]}" (${t})`).join(' or ')}. whyKey is usually "proof".`,
  ].join('\n');
}

const whyLine = (whys: Record<string, string>, key: string) => (whys[key] ? ` ("${whys[key]}")` : '');

export interface ListDetailCtx {
  screenLanguage: string;
  whys: Record<string, string>;
  /** Versus: 4 só quando o painel cabe (ctx.list.versus.maxPairs) */
  maxPairs: 3 | 4;
  /** offerAndPrice preenchido: só então existe barra de preço */
  hasPrice: boolean;
  violations?: string[];
}

/** Pedido da 2ª etapa de UM template de lista. Todas as regras aqui (o sistema não muda). */
export function listDetailMessage(id: ListTemplateId, t: { whyKey: string; change: string; rationale: string }, ctx: ListDetailCtx): string {
  const L = LIST_LIMITS;
  const head = id === 'versus'
    ? [
      'Second step of this plan: write the lines of ONE LIST_OVERLAY piece, template "versus": a two-column table drawn over the champion video that fills line by line while the champion speaks. Left column = what people put up with today (the wrong way); right column = what this offer does instead. The template decides the layout; you only write the texts.',
      [
        `- heads.bad: max ${L.head} characters, one line. An alternative the champion names in the speech (source "transcript", anchored) or a translated generic label like "Other ways" (source "generic", field "none").`,
        `- heads.good: max ${L.head}, one line: the offer name shortened (source "brain", field "name"). The only place a name may appear.`,
        `- lines: exactly ${ctx.maxPairs === 4 ? '3 or 4' : '3'} pairs: as many side "bad" cells as side "good" cells. Each cell max ${L.versusCell} characters (2 lines on screen).`,
        '- bad cells come from Brain › pains and the transcript; good cells from Brain › promise, what or proof and the transcript. Pair them wrong → right: each good cell answers a bad cell.',
        '- order: "by_speech" when the speech treats each side at its own moment (each column fills when it is said); "alternate" only when the speech does not separate the sides. Inside each column, list the cells in the order they are said.',
      ].join('\n'),
    ]
    : [
      'Second step of this plan: write the bars of ONE LIST_OVERLAY piece, template "value-stack": each benefit lands as a bar over the champion video when it is said and stays; it ends on the price and the call. The template decides the layout; you only write the texts.',
      [
        `- title: max ${L.stackTitle} characters, one line: a translated generic label like "What you get" (source "generic", field "none") or the speech's own framing, like "3 reasons…" (source "transcript", anchored).`,
        `- lines: at most ${L.stackBarsMax} bars, in the order they are said: ${L.stackItemsMin}-${L.stackItemsMax} "item", 0-1 "proof", ${ctx.hasPrice ? '0-1 "price", ' : ''}exactly 1 "cta" (the last bar); items + proof at least ${L.stackBodyMin}.`,
        `- item (max ${L.stackItem}, 2 lines): a benefit the champion says; complete with Brain › promise or what when the speech has too few.`,
        `- proof (max ${L.stackProof}, 2 lines): a number only if the champion says it or it is written in Brain › proof, copied the same way.`,
        ctx.hasPrice
          ? `- price (max ${L.stackPrice}, 2 lines): ONLY from Brain › offerAndPrice (source "brain", field "offerAndPrice"), the price copied exactly as written there; never a price from the speech or the page.`
          : '- Brain › offerAndPrice is empty: no "price" bar. Add one more item instead.',
        `- cta (max ${L.stackCta}, one line): from Brain › cta or the call the champion says.`,
      ].join('\n'),
    ];
  const lines = [
    head[0],
    `Screen language for every on-screen text: ${ctx.screenLanguage}.`,
    `The piece attacks the ${t.whyKey} line${whyLine(ctx.whys, t.whyKey)}. Change: "${t.change}". Rationale: "${t.rationale}".`,
    head[1],
    [
      '- Prefer the phrase the champion actually says (source "transcript") over Brain text; when the speech and a Brain field say the same thing, source "both" with the field.',
      '- Every text carries source, field and anchor: for transcript/both, anchorSec = the start second of the word where the champion starts saying it and anchorWord = that word exactly as in <transcript>; for brain/generic, anchorSec -1 and anchorWord empty. field is required for brain/both and "none" for transcript/generic. "generic" only in heads.bad or title.',
      '- Nothing invented: every number, price, time span or percentage must already be in the transcript or in Brain › proof (price: only Brain › offerAndPrice), written the same way. When unsure, write the line without numbers. No result or claim that the Brain or the transcript does not make.',
      '- Offer-agnostic: never name the niche, a competitor, a platform or a person; no brand name or URL (except the offer name in heads.good). No emojis, no hashtags, no quotation marks.',
      '- Limits are visible characters; a Chinese/Japanese/Korean character counts as 1. Short and concrete, as people write on a video.',
    ].join('\n'),
  ];
  const own = (ctx.violations ?? []).filter((v) => /LIST_OVERLAY|versus|value-stack/i.test(v));
  if (own.length) lines.push(`A previous plan broke these rules in this piece; fix every one:\n${own.map((v) => `- ${v}`).join('\n')}`);
  lines.push('Return list.');
  return lines.join('\n\n');
}

// ───────────────────────── parse (só forma) ─────────────────────────

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const n = (v: unknown, d = -1): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const norm = (x: string) => x.toLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '');
/** Teto de sanidade (o limite real é do backend: passou = text_too_long → reparo, sem mutilar a frase aqui). */
const SANITY = 90;

/**
 * Índice GLOBAL da palavra-âncora. 1º: a palavra com o mesmo texto mais perto do segundo (até 1 s); 2º: sem texto que
 * bata, a palavra que começa mais perto do segundo (até 0,4 s). null = sem âncora (o backend acusa source_span_missing).
 */
export function anchorOf(words: TranscriptWord[], sec: number, word: string): number | null {
  if (!(sec >= 0) || !words.length) return null;
  const w = norm(word);
  let best = -1, bestD = Infinity;
  if (w) {
    words.forEach((x, k) => {
      const d = Math.abs(x.startSec - sec);
      const t = norm(x.word);
      if (d <= 1 && t && (t === w || (w.length >= 3 && (t.startsWith(w) || w.startsWith(t)))) && d < bestD) [best, bestD] = [k, d];
    });
    if (best >= 0) return best;
  }
  words.forEach((x, k) => {
    const d = Math.abs(x.startSec - sec);
    if (d <= 0.4 && d < bestD) [best, bestD] = [k, d];
  });
  return best >= 0 ? best : null;
}

function texto(raw: Record<string, unknown>, words: TranscriptWord[]): ListTextDraft | null {
  const text = s(raw.text).replace(/^["“”']+|["“”']+$/g, '').trim().slice(0, SANITY);
  if (!text) return null;
  const source = SOURCES.find((x) => x === s(raw.source)) ?? 'brain';
  const field = FIELDS.find((x) => x === s(raw.field)) ?? null;
  const anchorWordIndex = source === 'transcript' || source === 'both' ? anchorOf(words, n(raw.anchorSec), s(raw.anchorWord)) : null;
  return { text, source, field: source === 'transcript' || source === 'generic' ? null : field, anchorWordIndex };
}

/** `{ list }` da 2ª etapa → rascunho do template. null = a peça sai (sem cabeçalho bom no Versus, sem linha). */
export function listOverlayOf(id: ListTemplateId, raw: Record<string, unknown>, words: TranscriptWord[]): AutoListOverlayDraft | null {
  const lines: ListLineDraft[] = [];
  for (const l of a(raw.lines).map(o)) {
    const t = texto(l, words);
    if (!t) continue;
    if (id === 'versus') {
      const side = s(l.side) === 'bad' ? 'bad' : s(l.side) === 'good' ? 'good' : null;
      if (side) lines.push({ ...t, side, kind: 'item' });
    } else {
      lines.push({ ...t, side: null, kind: KINDS.find((k) => k === s(l.kind)) ?? 'item' });
    }
  }
  if (!lines.length) return null;
  if (id === 'versus') {
    const h = o(raw.heads);
    const bad = texto(o(h.bad), words);
    const good = texto(o(h.good), words);
    if (!bad || !good) return null;
    return { type: 'LIST_OVERLAY', templateId: id, order: s(raw.order) === 'alternate' ? 'alternate' : 'by_speech', heads: { bad, good }, title: null, lines };
  }
  const title = texto(o(raw.title), words);
  if (!title) return null;
  return { type: 'LIST_OVERLAY', templateId: id, order: 'by_speech', heads: null, title, lines };
}

/** Params do item a partir do detalhe encaixado (`params.listTemplate` + `params.list`). null = a peça sai. */
export function listParamsOf(p: Record<string, unknown>, words: TranscriptWord[], allowed?: readonly ListTemplateId[]): AutoListOverlayDraft | null {
  const id = s(p.listTemplate);
  if (!isListTemplate(id) || (allowed && !allowed.includes(id))) return null;
  const raw = o(p.list);
  return Object.keys(raw).length ? listOverlayOf(id, raw, words) : null;
}
