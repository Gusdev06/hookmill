// templates-lista-v1 §2.3-§2.4 e §5 (04/11): a lista do LIST_OVERLAY (Versus, Value stack) no plano. PURO, testado em
// lista-plano.spec.ts.
//  - listViolations(p, i, ctx): forma, limites, fonte/âncora, "nada inventado", prova/preço literais, marca, ordem das âncoras;
//  - listSpecOf(p, ctx, brand): o `ListSpec` salvo em `variation_items.payload.params` (âncora → segundo pelo `agendaLista`,
//    citação, ids `l1…`, look 'ink', colunas, placement nos 3 formatos, `fill`);
//  - textos editáveis do Plan (`list.heads.bad|good`, `list.title`, `list.lines.<id>`), opções (look/colunas/"Fill from Brain")
//    e a vista `IteratePiece.list`.
// Regra do Gusta: nada inventado (número só da fala ou de `proof`; preço só de `offerAndPrice`), agnóstico de oferta.
import type {
  FormatCode, ListField, ListLabelView, ListLineKind, ListLineView, ListLook, ListMode, ListOrder, ListPlacementMode, ListSide, ListSource,
  ListTemplateId, PieceList,
} from '@maquina/contratos';
import type { AutoListOverlayDraft, FrameBrand, ListLineDraft, ListTextDraft } from '../integracoes/contrato';
import { agendaLista, needLista, posicionarLista, type ListPlacement, type Rect } from './lista-layout';
import {
  type PlanCtx, type Violation, inventedClaims, inventedNumbers, isListTemplateId, normalizeText, numbersIn, screenLangOf,
} from './regras';

// ───────── limites (§2.1) ─────────

export const LIST_LIMITS = { head: 14, cell: 24, title: 18, item: 30, proof: 30, price: 34, cta: 22 } as const;
export const LIST_MIN_SPEECH_SEC = 12;
export const LIST_MIN_ANCHORED = 2;
export const LIST_FORMATS: readonly FormatCode[] = ['9x16', '4x5', '1x1'];
const VERSUS_PAIRS_MIN = 3;
const STACK_BARS_MAX = 5;
const QUOTE_MAX = 120;

const vis = (s: string | null | undefined) => [...(s ?? '').trim()].length;
const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** Limite de uma linha (Versus = célula; Stack = pelo `kind`). */
export function lineMaxChars(templateId: ListTemplateId, kind: ListLineKind): number {
  if (templateId === 'versus') return LIST_LIMITS.cell;
  return kind === 'price' ? LIST_LIMITS.price : kind === 'cta' ? LIST_LIMITS.cta : kind === 'proof' ? LIST_LIMITS.proof : LIST_LIMITS.item;
}

// ───────── rascunho (o parse da ia já converte ""/-1 em null; aqui de novo, por garantia) ─────────

const SOURCES: readonly ListSource[] = ['transcript', 'brain', 'both', 'generic'];
const FIELDS: readonly ListField[] = ['pains', 'promise', 'what', 'proof', 'offerAndPrice', 'cta', 'name'];

function textOf(t: Partial<ListTextDraft> | null | undefined): ListTextDraft | null {
  if (!t || typeof t !== 'object') return null;
  const field = FIELDS.includes(t.field as ListField) ? (t.field as ListField) : null;
  const a = t.anchorWordIndex;
  return {
    text: typeof t.text === 'string' ? t.text.replace(/\s+/g, ' ').trim() : '',
    source: SOURCES.includes(t.source as ListSource) ? (t.source as ListSource) : ('' as ListSource),
    field, anchorWordIndex: typeof a === 'number' && Number.isInteger(a) && a >= 0 ? a : null,
  };
}

export function normalizeListDraft(p: AutoListOverlayDraft): AutoListOverlayDraft {
  const heads = p.heads && typeof p.heads === 'object' ? { bad: textOf(p.heads.bad), good: textOf(p.heads.good) } : null;
  const title = textOf(p.title);
  return {
    type: 'LIST_OVERLAY', templateId: p.templateId,
    order: p.templateId === 'value-stack' ? 'by_speech' : p.order === 'alternate' ? 'alternate' : 'by_speech',
    heads: heads?.bad && heads.good && (heads.bad.text || heads.good.text) ? { bad: heads.bad, good: heads.good } : null,
    title: title && title.text ? title : null,
    lines: (Array.isArray(p.lines) ? p.lines : []).map((l): ListLineDraft => ({
      ...(textOf(l) as ListTextDraft),
      side: l?.side === 'bad' || l?.side === 'good' ? l.side : null,
      kind: l?.kind === 'proof' || l?.kind === 'price' || l?.kind === 'cta' ? l.kind : 'item',
    })),
  };
}

/** Os textos da peça com o caminho do rascunho (`heads.bad`, `title`, `lines.<k>`), o limite e o que cada um aceita. */
interface Slot { path: string; t: ListTextDraft; max: number; generic: boolean; fields: readonly ListField[]; transcript: boolean; kind: ListLineKind | 'head' | 'title'; side: ListSide | null }
function slotsOf(p: AutoListOverlayDraft): Slot[] {
  const out: Slot[] = [];
  if (p.templateId === 'versus') {
    if (p.heads) {
      out.push({ path: 'heads.bad', t: p.heads.bad, max: LIST_LIMITS.head, generic: true, fields: ['pains'], transcript: true, kind: 'head', side: 'bad' });
      out.push({ path: 'heads.good', t: p.heads.good, max: LIST_LIMITS.head, generic: false, fields: ['name'], transcript: false, kind: 'head', side: 'good' });
    }
  } else if (p.title) out.push({ path: 'title', t: p.title, max: LIST_LIMITS.title, generic: true, fields: [], transcript: true, kind: 'title', side: null });
  p.lines.forEach((l, k) => {
    const fields: readonly ListField[] = p.templateId === 'versus'
      ? (l.side === 'bad' ? ['pains'] : ['promise', 'what', 'proof'])
      : l.kind === 'price' ? ['offerAndPrice'] : l.kind === 'cta' ? ['cta'] : l.kind === 'proof' ? ['proof'] : ['promise', 'what', 'proof'];
    out.push({ path: `lines.${k}`, t: l, max: lineMaxChars(p.templateId, l.kind), generic: false, fields, transcript: l.kind !== 'price', kind: l.kind, side: l.side });
  });
  return out;
}

const fieldFilled = (f: ListField, ctx: PlanCtx) => (f === 'name' ? (ctx.offerName === undefined ? true : has(ctx.offerName)) : has(ctx.brain[f]));

/** Nome da marca (palavra inteira, ≥ 3) ou URL. */
function brandOrUrl(text: string, ctx: PlanCtx): string | null {
  if (/https?:|www\.|\.com\b|\.com\.br\b/i.test(text)) return 'url';
  const w = ` ${normalizeText(text)} `;
  return ctx.brandTerms.map(normalizeText).find((b) => b.length >= 3 && w.includes(` ${b} `)) ?? null;
}

/** Peças do Versus por lado e do Stack por tipo. */
const count = <T>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;

/**
 * §2.3: violações de UMA peça LIST_OVERLAY. `block` = caminho do rascunho (`heads.bad`, `title`, `lines.<k>`; ausente = a
 * peça). `maxPairs` (Versus) vem do `posicionarLista` (4º par só com zona ≥ 480 px).
 */
export function listViolations(raw: AutoListOverlayDraft, i: number, ctx: PlanCtx, maxPairs: 3 | 4 = 3): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string, block?: string) => out.push({ item: i, rule, detail, ...(block && { block }) });
  if (!isListTemplateId(raw?.templateId)) return [{ item: i, rule: 'template_shape', detail: 'templateId must be versus or value-stack' }];
  const p = normalizeListDraft(raw);
  const lines = p.lines;
  // forma e quantidades
  if (p.templateId === 'versus') {
    if (!p.heads) v('template_shape', 'Versus needs heads.bad and heads.good');
    if (lines.some((l) => l.side === null || l.kind !== 'item')) v('template_shape', 'every Versus line has side bad|good and kind item');
    const bad = count(lines, (l) => l.side === 'bad'), good = count(lines, (l) => l.side === 'good');
    if (bad !== good) v('template_shape', `Versus needs as many bad as good lines (bad ${bad}, good ${good})`);
    const pairs = Math.max(bad, good);
    if (pairs < VERSUS_PAIRS_MIN || pairs > maxPairs) v('template_shape', `Versus needs ${VERSUS_PAIRS_MIN}${maxPairs > VERSUS_PAIRS_MIN ? `-${maxPairs}` : ''} pairs, got ${pairs}`);
  } else {
    if (!p.title) v('template_shape', 'Value stack needs a title');
    if (lines.some((l) => l.side !== null)) v('template_shape', 'Value stack lines have side null');
    const items = count(lines, (l) => l.kind === 'item'), proofs = count(lines, (l) => l.kind === 'proof');
    const prices = count(lines, (l) => l.kind === 'price'), ctas = count(lines, (l) => l.kind === 'cta');
    if (lines.length > STACK_BARS_MAX) v('template_shape', `Value stack has at most ${STACK_BARS_MAX} bars, got ${lines.length}`);
    if (items < 2 || items > 4) v('template_shape', `Value stack needs 2-4 item bars, got ${items}`);
    if (proofs > 1 || prices > 1) v('template_shape', 'Value stack has at most 1 proof bar and 1 price bar');
    if (ctas !== 1 || lines[lines.length - 1]?.kind !== 'cta') v('template_shape', 'Value stack ends with exactly 1 cta bar');
    if (items + proofs < 3) v('template_shape', 'Value stack needs item + proof bars ≥ 3');
    if (prices && !has(ctx.brain.offerAndPrice)) v('price_not_in_brain', 'there is no price in Brain › Offer and price: no price bar (write 1 more item)');
  }
  // cada texto
  const spoken = ctx.words.map((w) => w.word).join(' ');
  for (const s of slotsOf(p)) {
    const t = s.t;
    if (!t.text) { v('template_shape', `${s.path} is empty`, s.path); continue; }
    if (vis(t.text) > s.max) v('text_too_long', `${s.path} "${t.text}" over ${s.max} characters`, s.path);
    if (!SOURCES.includes(t.source)) { v('source_invalid', `${s.path} needs a source transcript|brain|both${s.generic ? '|generic' : ''}`, s.path); continue; }
    if (t.source === 'generic' && !s.generic) v('source_invalid', `${s.path} cannot be generic: only heads.bad and title are template labels`, s.path);
    if ((t.source === 'transcript' || t.source === 'both') && !s.transcript) v('source_invalid', `${s.path} cannot come from the transcript (${s.kind === 'price' ? 'price only from Brain › Offer and price' : 'Brain only'})`, s.path);
    if (t.source === 'transcript' || t.source === 'both') {
      if (t.anchorWordIndex === null || t.anchorWordIndex >= ctx.words.length) v('source_span_missing', `${s.path} comes from the transcript: anchorWordIndex must be a word index of the transcript (0-${Math.max(0, ctx.words.length - 1)})`, s.path);
    }
    if (t.source === 'brain' || t.source === 'both') {
      if (!t.field) v('source_invalid', `${s.path} comes from the Brain: field is required`, s.path);
      else if (!s.fields.includes(t.field)) v('source_invalid', `${s.path} must cite ${s.fields.join('|') || 'the transcript'}, not ${t.field}`, s.path);
      else if (!fieldFilled(t.field, ctx)) v('source_invalid', `${s.path} cites ${t.field}, which is empty in the Brain`, s.path);
    }
    const n = inventedNumbers(t.text, ctx);
    if (n.length) v('invented_number', `${s.path} "${t.text}" has ${n.join(', ')}, not in the Brain nor the transcript`, s.path);
    const cl = inventedClaims(t.text, ctx);
    if (cl.length) v('invented_claim', `${s.path} "${t.text}" claims "${cl.join('", "')}" with nothing in the Brain or the transcript to back it`, s.path);
    if (s.kind === 'proof') {
      const hay = new Set([...numbersIn(spoken), ...numbersIn(ctx.brain.proof ?? '')]);
      const out2 = numbersIn(t.text).filter((x) => !hay.has(x));
      if (out2.length) v('proof_not_in_brain', `${s.path}: ${out2.join(', ')} is not in the speech nor in Brain › Proof`, s.path);
    }
    if (s.kind === 'price') {
      const brain = ctx.brain.offerAndPrice ?? '';
      const nums = numbersIn(t.text);
      if (t.field !== 'offerAndPrice' || !has(brain) || !nums.length || nums.some((x) => !numbersIn(brain).includes(x))) {
        v('price_not_in_brain', `${s.path} "${t.text}": the price must be written as in Brain › Offer and price`, s.path);
      }
    }
    // o cabeçalho do lado bom É o nome da oferta (§2.1); o resto nunca nomeia marca nem URL
    if (s.path !== 'heads.good') {
      const b = brandOrUrl(t.text, ctx);
      if (b) v('template_has_brand', `${s.path} must not name the brand or a URL ("${b}")`, s.path);
    }
  }
  // ordem das âncoras (by_speech): Stack na ordem das barras; Versus dentro de cada coluna
  if (p.order === 'by_speech') {
    const cols: ListLineDraft[][] = p.templateId === 'versus' ? [lines.filter((l) => l.side === 'bad'), lines.filter((l) => l.side === 'good')] : [lines];
    for (const col of cols) {
      const a = col.map((l) => l.anchorWordIndex).filter((x): x is number => x !== null);
      if (a.some((x, k) => k > 0 && x <= a[k - 1])) v('anchor_order', 'by_speech: the anchors must grow in the order of the lines (each column in Versus)');
    }
  }
  return out;
}

// ───────── finalização (§2.4) ─────────

export interface ListTextSpec { text: string; source: ListSource; field: ListField | null; anchorWordIndex: number | null }
export interface ListLineSpec extends ListTextSpec {
  id: string; side: ListSide | null; kind: ListLineKind;
  /** segundos do campeão (= da peça: o vídeo vai inteiro) */
  atSec: number;
  quote: string | null;
  fromFill: boolean;
}
export interface ListPlacementSpec { format: FormatCode; mode: ListPlacementMode | 'none'; reason: string; supported: boolean }
/** `variation_items.payload.params` da peça LIST_OVERLAY (= draft validado + look, colunas, fill, tempos, placement). */
export interface ListSpec {
  type: 'LIST_OVERLAY';
  templateId: ListTemplateId;
  screenLanguage: string;
  order: ListOrder;
  heads: { bad: ListTextSpec; good: ListTextSpec } | null;
  title: ListTextSpec | null;
  lines: ListLineSpec[];
  look: ListLook;
  /** Versus: 2 (padrão) ou 1; Stack: null. O 1:1 é sempre 1 coluna (side). */
  columns: 1 | 2 | null;
  /** `pending` = < 2 linhas com âncora: fora do lote/quote até "Fill from Brain" · `accepted` · null = não precisou */
  fill: 'pending' | 'accepted' | null;
  brand: FrameBrand;
  placement: ListPlacementSpec[];
  maxPairs: 3 | 4;
}

const spec = (t: ListTextDraft): ListTextSpec => ({ text: t.text, source: t.source, field: t.field, anchorWordIndex: t.anchorWordIndex });

/** Frase da transcrição com a palavra-âncora (de pontuação a pontuação), ≤ 120 com "…". */
export function quoteOf(words: PlanCtx['words'], k: number | null): string | null {
  if (k === null || !words[k]) return null;
  const end = (w: { word: string }) => /[.!?…]["”']?$/.test(w.word.trim());
  let a = k;
  while (a > 0 && !end(words[a - 1])) a--;
  let b = k;
  while (b < words.length - 1 && !end(words[b])) b++;
  const s = words.slice(a, b + 1).map((w) => w.word.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  return s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1).trimEnd()}…` : s;
}

/** Modo do painel no formato (1:1 = Versus em 1 coluna). */
export function listModeOf(templateId: ListTemplateId, columns: 1 | 2 | null, format: FormatCode): ListMode {
  if (templateId === 'value-stack') return 'stack';
  return format === '1x1' || columns === 1 ? 'one-col' : 'two-col';
}
/** Linhas pro `needLista`: 2 col = pares; 1 col = todas; stack = barras. */
export function listRowsOf(templateId: ListTemplateId, mode: ListMode, lines: readonly { side: ListSide | null }[]): number {
  if (mode === 'two-col') return Math.max(3, count(lines, (l) => l.side === 'bad'), count(lines, (l) => l.side === 'good'));
  return Math.max(templateId === 'versus' ? 6 : 5, lines.length);
}

/** Geometria do campeão pro `posicionarLista` (px do arquivo). */
export interface ListGeom {
  source: { width: number; height: number; durationSec: number }; faceSafeBand: Rect | null; bands: import('@maquina/contratos').ProtectedBand[];
  /** gatilho de QA `[mock:list-no-room]` (só INTEGRACOES_MODE=mock): `posicionarLista` = none */
  mockNoRoom?: boolean;
}

/**
 * §1 regra 4 / §2.4: onde o painel fica no formato. O painel nunca cobre a legenda queimada (`ctx.caption`, a guarda do
 * plano, troca-texto-queimado-v1 §15.3) nem o rosto. `caption: null` só serve pra perguntar se a causa foi a legenda.
 */
export function listPlacementOf(ctx: Pick<PlanCtx, 'listGeom' | 'caption' | 'durationSec'>, templateId: ListTemplateId, format: FormatCode = '9x16', columns: 1 | 2 | null = templateId === 'versus' ? 2 : null, lines?: readonly { side: ListSide | null }[]): ListPlacement {
  const g = ctx.listGeom ?? { source: { width: 1080, height: 1920, durationSec: ctx.durationSec }, faceSafeBand: null, bands: [] };
  if (g.mockNoRoom) return { mode: 'none', reason: 'no_room' };
  const mode = listModeOf(templateId, columns, format);
  const rows = lines ? listRowsOf(templateId, mode, lines) : mode === 'two-col' ? 3 : mode === 'one-col' ? 6 : 5;
  return posicionarLista({ format, source: g.source, faceSafeBand: g.faceSafeBand, protectedBands: ctx.caption ? g.bands : [], need: needLista(mode, rows) });
}

const placementSpecs = (ctx: Pick<PlanCtx, 'listGeom' | 'caption' | 'durationSec'>, s: Pick<ListSpec, 'templateId' | 'columns' | 'lines'>): ListPlacementSpec[] =>
  LIST_FORMATS.map((format) => {
    const pl = listPlacementOf(ctx, s.templateId, format, s.columns, s.lines);
    return { format, mode: pl.mode, reason: pl.reason, supported: pl.mode !== 'none' };
  });

/** §2.4: o `ListSpec` da peça. Ids estáveis `l1…` na ordem das linhas; `fill` pelas âncoras. */
export function listSpecOf(raw: AutoListOverlayDraft, ctx: PlanCtx, brand: FrameBrand): ListSpec {
  const p = normalizeListDraft(raw);
  const anchored = count(p.lines, (l) => l.anchorWordIndex !== null);
  const pending = anchored < LIST_MIN_ANCHORED;
  const at = agendaLista(p.lines.map((l) => ({ anchorWordIndex: l.anchorWordIndex, side: l.side })), ctx.words, ctx.durationSec, p.order);
  const lines: ListLineSpec[] = p.lines.map((l, k) => ({
    ...spec(l), id: `l${k + 1}`, side: l.side, kind: l.kind, atSec: at[k], quote: quoteOf(ctx.words, l.anchorWordIndex), fromFill: pending && l.anchorWordIndex === null,
  }));
  const columns = p.templateId === 'versus' ? 2 : null;
  const base = { templateId: p.templateId, columns, lines } as const;
  const pl9 = listPlacementOf(ctx, p.templateId, '9x16', columns, lines);
  return {
    type: 'LIST_OVERLAY', templateId: p.templateId, screenLanguage: screenLangOf(ctx), order: p.order,
    heads: p.templateId === 'versus' && p.heads ? { bad: spec(p.heads.bad), good: spec(p.heads.good) } : null,
    title: p.templateId === 'value-stack' && p.title ? spec(p.title) : null,
    lines, look: 'ink', columns, fill: pending ? 'pending' : null, brand: { ...brand },
    placement: placementSpecs(ctx, base), maxPairs: pl9.mode === 'body' ? pl9.maxPairs : 3,
  };
}

/** O spec salvo de volta em rascunho (pra revalidar depois de editar texto). */
export function draftOfSpec(s: ListSpec): AutoListOverlayDraft {
  return {
    type: 'LIST_OVERLAY', templateId: s.templateId, order: s.order,
    heads: s.heads ? { bad: { ...s.heads.bad }, good: { ...s.heads.good } } : null,
    title: s.title ? { ...s.title } : null,
    lines: s.lines.map((l) => ({ text: l.text, source: l.source, field: l.field, anchorWordIndex: l.anchorWordIndex, side: l.side, kind: l.kind })),
  };
}

export const isListSpec = (p: unknown): p is ListSpec =>
  !!p && typeof p === 'object' && (p as ListSpec).type === 'LIST_OVERLAY' && isListTemplateId((p as ListSpec).templateId) && Array.isArray((p as ListSpec).lines);

// ───────── textos editáveis do Plan (§5) ─────────

export interface ListEditableText { path: string; label: string; value: string; maxChars: number; source: string | null }

/** `IterateTemplateRun.texts` da peça: `list.heads.bad|good` (Versus), `list.title` (Stack), `list.lines.<id>`. */
export function listEditableTexts(s: ListSpec): ListEditableText[] {
  const out: ListEditableText[] = [];
  const src = (t: ListTextSpec) => t.field ?? t.source;
  if (s.heads) {
    out.push({ path: 'list.heads.bad', label: 'heads.bad', value: s.heads.bad.text, maxChars: LIST_LIMITS.head, source: src(s.heads.bad) });
    out.push({ path: 'list.heads.good', label: 'heads.good', value: s.heads.good.text, maxChars: LIST_LIMITS.head, source: src(s.heads.good) });
  }
  if (s.title) out.push({ path: 'list.title', label: 'title', value: s.title.text, maxChars: LIST_LIMITS.title, source: src(s.title) });
  for (const l of s.lines) out.push({ path: `list.lines.${l.id}`, label: `${l.side ?? l.kind} ${l.id}`, value: l.text, maxChars: lineMaxChars(s.templateId, l.kind), source: src(l) });
  return out;
}

/** Aplica as edições num clone (texto aparado; fonte/âncora/tempo ficam). */
export function applyListTexts(s: ListSpec, edits: readonly { path: string; value: string }[]): { params: ListSpec; unknownPaths: string[] } {
  const allowed = new Set(listEditableTexts(s).map((t) => t.path));
  const unknownPaths = edits.filter((e) => !allowed.has(e.path)).map((e) => e.path);
  const next = JSON.parse(JSON.stringify(s)) as ListSpec;
  if (unknownPaths.length) return { params: next, unknownPaths };
  for (const e of edits) {
    const value = e.value.replace(/\s+/g, ' ').trim();
    if (e.path === 'list.heads.bad' && next.heads) next.heads.bad.text = value;
    else if (e.path === 'list.heads.good' && next.heads) next.heads.good.text = value;
    else if (e.path === 'list.title' && next.title) next.title.text = value;
    else {
      const line = next.lines.find((l) => `list.lines.${l.id}` === e.path);
      if (line) line.text = value;
    }
  }
  return { params: next, unknownPaths };
}

/** As regras do §2.3 sobre o spec editado, com o caminho da vista (`list.lines.<id>`). */
export function listSpecViolations(s: ListSpec, ctx: PlanCtx): { path: string; rule: string; detail: string }[] {
  const pathOf = (block?: string) => {
    if (!block) return '*';
    const m = /^lines\.(\d+)$/.exec(block);
    return m ? `list.lines.${s.lines[Number(m[1])]?.id ?? m[1]}` : `list.${block}`;
  };
  return listViolations(draftOfSpec(s), 0, ctx, s.maxPairs).map((v) => ({ path: pathOf(v.block), rule: v.rule, detail: v.detail }));
}

// ───────── opções (PATCH …/list, §5) ─────────

export type ListOptionsError = { code: 'EDIT_NOT_SUPPORTED'; reason: string } | null;

/** look / colunas (só Versus) / "Fill from Brain" (pending → accepted). Recalcula o placement (colunas mudam o `need`). */
export function applyListOptions(s: ListSpec, body: { look?: ListLook; columns?: 1 | 2; acceptFill?: true }, ctx: Pick<PlanCtx, 'listGeom' | 'caption' | 'durationSec'>): { params: ListSpec; error: ListOptionsError } {
  if (body.columns !== undefined && s.templateId !== 'versus') return { params: s, error: { code: 'EDIT_NOT_SUPPORTED', reason: 'columns_versus_only' } };
  const next = JSON.parse(JSON.stringify(s)) as ListSpec;
  if (body.look) next.look = body.look;
  if (body.columns) next.columns = body.columns;
  if (body.acceptFill && next.fill === 'pending') next.fill = 'accepted';
  if (body.columns) next.placement = placementSpecs(ctx, next);
  return { params: next, error: null };
}

// ───────── vista (IteratePiece.list, §5) ─────────

const label = (t: ListTextSpec, max: number): ListLabelView => ({ text: t.text, maxChars: max, source: t.source, field: t.field });

/** `IteratePiece.list` sem a prévia (a vista do lote põe `preview` com as URLs assinadas). */
export function pieceListOf(params: Record<string, unknown> | null | undefined): PieceList | null {
  if (!isListSpec(params)) return null;
  const s = params;
  const lines: ListLineView[] = s.lines.map((l) => ({
    id: l.id, side: l.side, kind: l.kind, text: l.text, maxChars: lineMaxChars(s.templateId, l.kind), atSec: l.atSec,
    source: l.source === 'generic' ? 'brain' : l.source, field: l.field, quote: l.quote, fromFill: l.fromFill,
  }));
  return {
    templateId: s.templateId, mode: listModeOf(s.templateId, s.columns, '9x16'), look: s.look, order: s.order,
    heads: s.heads ? { bad: label(s.heads.bad, LIST_LIMITS.head), good: label(s.heads.good, LIST_LIMITS.head) } : null,
    title: s.title ? label(s.title, LIST_LIMITS.title) : null,
    lines,
    placement: (s.placement ?? []).filter((x) => x.supported && x.mode !== 'none').map((x) => ({ format: x.format, mode: x.mode as ListPlacementMode, reason: x.reason as PieceList['placement'][number]['reason'] })),
    fill: s.fill, preview: null,
  };
}

/** Formatos da peça (§2.4: `supported: false` onde o `posicionarLista` dá `none`). */
export function listSupportedFormats(params: Record<string, unknown> | null | undefined): FormatCode[] {
  if (!isListSpec(params)) return ['9x16'];
  const ok = (params.placement ?? []).filter((x) => x.supported).map((x) => x.format);
  return ok.length ? ok : ['9x16'];
}
