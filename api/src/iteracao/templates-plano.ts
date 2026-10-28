// Templates grátis CHAT_DM e PERSON_MOTION no plano AUTO (docs/contratos/iterate-v2-quiz-templates-ia.md F1.1-F1.3). PURO.
//  - templateRules(ctx): quando entram (`allowedFor`), atrás da flag ITERATE_TEMPLATES (ctx.templates.enabled);
//  - templateViolations(p, i, ctx, draft): limites, forma, "nada inventado" (número, afirmação, prova fora do Brain),
//    prospect relatando resultado, trecho sem srcSpan, trechos/beats fora do vídeo, legenda queimada na caixa do rosto,
//    duração do chat, marca/URL no texto;
//  - templateSpecOf(p, ctx, media): o `TemplateSpec` salvo no item (textos limpos, trechos encaixados no silêncio, marca).
// Regra do Gusta (28/10): nada de print da landing, nunca imagem do produto, nunca depoimento/número fora do campeão e
// do Brain, só 9:16 na v1. O "pessoa + motion" usa o rosto e a voz do PRÓPRIO campeão (edição, sem IA: grátis).
import type { ProtectedBand } from '@maquina/contratos';
import { chatTimeline, limparTexto, personMotionLayout, type FaceMapLike } from '@maquina/video';
import type {
  AutoChatDmDraft, AutoPersonMotionDraft, AutoPlanDraft, CopySource, PersonBeatSpec, ProofStatDraft, TemplateIconId, TemplateSpec, TemplateText,
} from '../integracoes';
import { resultTermIn } from './afirmacoes';
import type { MediaRulesPort } from './portas';
import {
  type AllowedType, type PlanCtx, type Violation, inventedClaims, inventedNumbers, normalizeText, numbersIn, screenLangOf, sourceFilled,
} from './regras';

export const TEMPLATE_TYPES = ['CHAT_DM', 'PERSON_MOTION'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];
export const isTemplateType = (t: string | null | undefined): t is TemplateType => t === 'CHAT_DM' || t === 'PERSON_MOTION';

/** Limites do F1.2 (caracteres visíveis; CJK 1 = 1). */
export const TEMPLATE_LIMITS = {
  hook: 40, hookHighlight: 16, chrome: 24, message: 90, cardTitle: 24, line: 40, closeLine: 32, ctaButton: 28, ctaNote: 40,
  proofLabel: 24, kinetic: 24, wrong: 32, step: 16, icon: 20, badge: 20,
} as const;
export const PERSON_MIN_VIDEO_SEC = 15;
export const PERSON_FACE_MIN = 0.4;
export const SPANS_MIN_SEC = 18;
export const SPANS_MAX_SEC = 40;
/** Folga da soma dos trechos ANTES do encaixe no silêncio (o snapSpans mexe ~0,1-0,3 s por borda). */
const SPANS_SLACK = 1;
export const CHAT_MIN_SEC = 18;
export const CHAT_MAX_SEC = 40;
const CTA_SOURCES: readonly CopySource[] = ['cta', 'offerAndPrice', 'transcript'];
const ICONS: readonly TemplateIconId[] = ['check', 'x', 'arrow', 'brain', 'globe', 'chat', 'clock', 'star', 'gift', 'lock', 'heart', 'bolt'];
const PRESERVES = ['hook', 'pain', 'proof', 'mechanism', 'objection', 'offer', 'cta', 'promise'];

/** O que as regras dos templates precisam do campeão (contexto.ts preenche). */
export interface TemplateCtx {
  /** ITERATE_TEMPLATES=on (padrão off até o QA passar) */
  enabled: boolean;
  /** fração do vídeo com o rosto principal no faceTrack */
  faceShare: number;
  faceMap: FaceMapLike | null;
  /** tamanho do arquivo do campeão (px) */
  source: { width: number; height: number };
  /** legenda queimada (px do arquivo); vazio = nada protegido (ou versão sem legenda) */
  bands: ProtectedBand[];
}

/** Flag F1.7 (env). */
export const templatesLigados = (env: Record<string, string | undefined> = process.env) => (env.ITERATE_TEMPLATES ?? 'off').trim().toLowerCase() === 'on';

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;
const vis = (s: string | null | undefined) => [...(s ?? '').trim()].length;

/** Material do teardown/Brain pro chat: quantas de {dor ou objeção, prova ou mecanismo, oferta ou CTA}. */
export function chatMaterial(ctx: PlanCtx): number {
  const fn = (f: string) => ctx.blocks.some((b) => b.fn.trim().toLowerCase() === f);
  const b = ctx.brain;
  return [
    fn('problem') || has(b.pains),
    fn('proof') || fn('mechanism') || has(b.proof),
    fn('cta') || has(b.offerAndPrice) || has(b.cta) || has(ctx.spokenCta),
  ].filter(Boolean).length;
}

/** F1.1: CHAT_DM e PERSON_MOTION no `allowedFor` (vazio com a flag desligada). */
export function templateRules(ctx: PlanCtx): AllowedType[] {
  const t = ctx.templates;
  if (!t?.enabled) return [];
  const chat: AllowedType = !ctx.hasSpeech ? { type: 'CHAT_DM', max: 0, blockedReason: 'no_speech' }
    : chatMaterial(ctx) < 2 ? { type: 'CHAT_DM', max: 0, blockedReason: 'no_proof' }
      : { type: 'CHAT_DM', max: 1, blockedReason: null };
  let person: AllowedType;
  if (!ctx.hasSpeech) person = { type: 'PERSON_MOTION', max: 0, blockedReason: 'no_speech' };
  else if (ctx.durationSec < PERSON_MIN_VIDEO_SEC) person = { type: 'PERSON_MOTION', max: 0, blockedReason: 'short_video' };
  else if (t.faceShare < PERSON_FACE_MIN) person = { type: 'PERSON_MOTION', max: 0, blockedReason: 'no_face' };
  else {
    // a caixa do rosto não pode mostrar a legenda queimada: confere nos blocos do vídeo (um trecho por bloco)
    const spans = ctx.blocks.map((b) => ({ startSec: b.startSec, endSec: b.endSec })).filter((s) => s.endSec > s.startSec);
    const lay = personMotionLayout(t.source, t.faceMap, spans.length ? spans : [{ startSec: 0, endSec: ctx.durationSec }], t.bands);
    const livres = lay.mode === 'ok' ? spans.length : spans.length - (lay.reason === 'caption_in_face' ? lay.hits.length : spans.length);
    person = lay.mode === 'ok' || livres >= 2 ? { type: 'PERSON_MOTION', max: 1, blockedReason: null }
      : { type: 'PERSON_MOTION', max: 0, blockedReason: lay.reason === 'no_face' ? 'no_face' : 'burned_captions' };
  }
  return [chat, person];
}

// ───────── textos do template (pra todas as checagens) ─────────

interface Txt { path: string; t: TemplateText | null | undefined; max: number; required?: boolean }
const tt = (x: unknown): TemplateText | null => (x && typeof x === 'object' && typeof (x as TemplateText).text === 'string' ? (x as TemplateText) : null);

function chatTexts(p: AutoChatDmDraft): Txt[] {
  const L = TEMPLATE_LIMITS;
  const out: Txt[] = [{ path: 'hook', t: p.hook, max: L.hook, required: true }];
  (p.messages ?? []).forEach((m, i) => {
    const card = m.kind === 'correction' || m.kind === 'offer';
    out.push({ path: `messages.${i}.text`, t: m.text, max: card ? L.cardTitle : L.message, required: true });
    (m.wrong ?? []).forEach((w, k) => out.push({ path: `messages.${i}.wrong.${k}`, t: w, max: L.line, required: true }));
    (m.right ?? []).forEach((w, k) => out.push({ path: `messages.${i}.right.${k}`, t: w, max: L.line, required: true }));
  });
  (p.close?.lines ?? []).forEach((l, k) => out.push({ path: `close.lines.${k}`, t: l, max: L.closeLine, required: true }));
  out.push({ path: 'cta.button', t: p.cta?.button, max: L.ctaButton, required: true });
  if (p.cta?.note) out.push({ path: 'cta.note', t: p.cta.note, max: L.ctaNote });
  return out;
}

function beatTexts(b: AutoPersonMotionDraft['beats'][number], i: number): Txt[] {
  const L = TEMPLATE_LIMITS;
  const s = (k: string) => `beats.${i}.${k}`;
  switch (b.kind) {
    case 'kinetic': return (b.words ?? []).map((w, k) => ({ path: s(`words.${k}`), t: w, max: L.kinetic, required: true }));
    case 'wrong_right': return [{ path: s('wrong'), t: b.wrong, max: L.wrong, required: true }, ...(b.right ?? []).map((w, k) => ({ path: s(`right.${k}`), t: w, max: L.wrong, required: true }))];
    case 'steps': return (b.steps ?? []).map((w, k) => ({ path: s(`steps.${k}`), t: w, max: L.step, required: true }));
    case 'icon_list': return (b.items ?? []).map((w, k) => ({ path: s(`items.${k}`), t: w?.text, max: L.icon, required: true }));
    case 'badge': return [{ path: s('text'), t: b.text, max: L.badge, required: true }];
    case 'cta': return [{ path: s('button'), t: b.button, max: L.ctaButton, required: true }, ...(b.note ? [{ path: s('note'), t: b.note, max: L.ctaNote }] : [])];
    default: return [];
  }
}

function personTexts(p: AutoPersonMotionDraft): Txt[] {
  const out = (p.beats ?? []).flatMap((b, i) => beatTexts(b, i));
  if (p.endCard) {
    out.push({ path: 'endCard.cta.button', t: p.endCard.cta?.button, max: TEMPLATE_LIMITS.ctaButton, required: true });
    if (p.endCard.cta?.note) out.push({ path: 'endCard.cta.note', t: p.endCard.cta.note, max: TEMPLATE_LIMITS.ctaNote });
  }
  return out;
}

/** Texto do template com a fonte (pra checagem por visão e pro rastreio). */
export function templateTextList(p: AutoChatDmDraft | AutoPersonMotionDraft): { path: string; text: string; source: CopySource }[] {
  return (p.type === 'CHAT_DM' ? chatTexts(p) : personTexts(p)).filter((x) => x.t && has(x.t.text)).map((x) => ({ path: x.path, text: x.t!.text.trim(), source: x.t!.source }));
}

/** Nome da marca (≥ 3 caracteres, fora de palavra latina maior) ou URL no texto. */
function brandHit(text: string, ctx: PlanCtx): string | null {
  if (/https?:|www\.|\.com\b|\.com\.br\b/i.test(text)) return 'url';
  const n = normalizeText(text);
  for (const term of ctx.brandTerms.map(normalizeText).filter((b) => b.length >= 3)) {
    let i = n.indexOf(term);
    while (i >= 0) {
      const antes = n[i - 1], depois = n[i + term.length];
      const letra = (c: string | undefined) => !!c && /[a-z0-9]/i.test(c);
      if (!letra(antes) && !letra(depois)) return term;
      i = n.indexOf(term, i + 1);
    }
  }
  return null;
}

/** Problema da prova (número e rótulo literais no Brain › proof). null = ok. */
export function proofProblem(s: ProofStatDraft, ctx: PlanCtx): string | null {
  const proof = ctx.brain.proof ?? '';
  if (!has(proof)) return 'there is no Brain › proof';
  if (!Number.isFinite(s.value) || s.value < 0) return 'value must be a number';
  const digits = (s.decimals > 0 ? s.value.toFixed(s.decimals) : String(Math.round(s.value))).replace(/[.,]/g, '');
  if (!numbersIn(proof).includes(digits)) return `${s.value} is not in Brain › proof`;
  if (!has(s.label) || !normalizeText(proof).includes(normalizeText(s.label))) return `label "${s.label}" is not in Brain › proof`;
  for (const c of `${s.prefix ?? ''}${s.suffix ?? ''}`.replace(/\s/g, '')) if (!proof.includes(c)) return `"${c}" is not in Brain › proof`;
  if (vis(s.label) > TEMPLATE_LIMITS.proofLabel) return `label over ${TEMPLATE_LIMITS.proofLabel}`;
  return null;
}

/** Bloco do gancho (função hook do plano, senão o 1º) e o de CTA (se o plano marcou). */
function hookAndCta(draft: Pick<AutoPlanDraft, 'blocks'>, ctx: PlanCtx) {
  const fnOf = new Map((draft.blocks ?? []).map((b) => [b.index, b.fn]));
  const fn = (b: PlanCtx['blocks'][number]) => fnOf.get(b.index) ?? b.fn.trim().toLowerCase();
  return { hook: ctx.blocks.find((b) => fn(b) === 'hook') ?? ctx.blocks[0] ?? null, cta: ctx.blocks.find((b) => fn(b) === 'cta') ?? null };
}

const wordIdxIn = (ctx: PlanCtx, k: number, s: { startSec: number; endSec: number }) => {
  const w = ctx.words[k];
  return !!w && w.startSec >= s.startSec - 0.05 && w.startSec < s.endSec;
};

/** Monta o que o video precisa pro chatTimeline (textos limpos). */
function chatIn(p: AutoChatDmDraft) {
  const c = (x: TemplateText | null | undefined) => limparTexto(x?.text ?? '');
  return {
    hook: { text: c(p.hook), highlight: p.hook?.highlight ? limparTexto(p.hook.highlight) : null },
    chrome: { typing: limparTexto(p.chrome?.typing ?? ''), inputPlaceholder: limparTexto(p.chrome?.inputPlaceholder ?? ''), profileStatus: limparTexto(p.chrome?.profileStatus ?? '') },
    messages: (p.messages ?? []).map((m) => ({ from: m.from, kind: m.kind, text: c(m.text), wrong: (m.wrong ?? []).map(c), right: (m.right ?? []).map(c) })),
    close: { lines: (p.close?.lines ?? []).map(c) },
    cta: { button: c(p.cta?.button), note: p.cta?.note ? c(p.cta.note) : null },
    proof: (p.proof ?? []).map(({ source: _s, ...x }) => x),
  };
}

/** F1.3: violações de uma peça de template. */
export function templateViolations(p: AutoChatDmDraft | AutoPersonMotionDraft, i: number, ctx: PlanCtx, draft: Pick<AutoPlanDraft, 'blocks'>): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ item: i, rule, detail });
  const lang = screenLangOf(ctx);
  const texts = p.type === 'CHAT_DM' ? chatTexts(p) : personTexts(p);
  for (const x of texts) {
    const t = tt(x.t);
    if (!t || !has(t.text)) { if (x.required) v('template_shape', `${x.path} is empty`); continue; }
    if (vis(t.text) > x.max) v('text_too_long', `${x.path} over ${x.max} characters`);
    const inv = inventedNumbers(t.text, ctx);
    if (inv.length) v('invented_number', `${x.path} "${t.text}" has ${inv.join(', ')}, not in the Brain nor the transcript`);
    const cl = inventedClaims(t.text, ctx);
    if (cl.length) v('invented_claim', `${x.path} claims "${cl.join('", "')}" with no source in the Brain or the transcript`);
    if (!t.source) v('template_shape', `${x.path} needs a source`);
    else if (!sourceFilled(t.source, ctx)) v('invented_claim', `${x.path} cites ${t.source}, which is empty`);
    if (t.source === 'transcript') {
      const s = t.srcSpan;
      if (!s || !(s.startSec >= 0 && s.endSec > s.startSec && s.endSec <= ctx.durationSec + 0.5)) v('source_span_missing', `${x.path} comes from the transcript: srcSpan inside the video is required`);
    }
    const b = brandHit(t.text, ctx);
    if (b) v('template_has_brand', `${x.path} must not name the brand or a URL ("${b}")`);
  }
  if (p.type === 'CHAT_DM') {
    const n = p.messages?.length ?? 0;
    if (n < 6 || n > 12) v('template_shape', `6-12 messages, got ${n}`);
    for (const k of ['typing', 'inputPlaceholder', 'profileStatus'] as const) {
      const s = p.chrome?.[k];
      if (!has(s)) v('template_shape', `chrome.${k} is empty`);
      else if (vis(s) > TEMPLATE_LIMITS.chrome) v('text_too_long', `chrome.${k} over ${TEMPLATE_LIMITS.chrome}`);
    }
    if (p.hook?.highlight && (!p.hook.text?.includes(p.hook.highlight) || vis(p.hook.highlight) > TEMPLATE_LIMITS.hookHighlight)) v('template_shape', 'hook.highlight must be a part of hook.text (≤ 16)');
    (p.messages ?? []).forEach((m, k) => {
      if (m.from === 'prospect') {
        if (m.kind !== 'question' && m.kind !== 'objection') v('prospect_testimonial', `message ${k}: the prospect only asks or objects (kind question|objection)`);
        const term = resultTermIn(m.text?.text ?? '', lang);
        if (term) v('prospect_testimonial', `message ${k}: the prospect reports a result ("${term}"); they have not bought yet`);
      } else if (!['answer', 'correction', 'offer'].includes(m.kind)) v('template_shape', `message ${k}: the brand answers, corrects or offers`);
      if (m.kind === 'correction' && (!(m.right?.length) || (m.wrong?.length ?? 0) > 2 || (m.right?.length ?? 0) > 3)) v('template_shape', `message ${k}: correction needs 0-2 wrong and 1-3 right lines`);
      if (m.kind === 'offer' && (m.right?.length ?? 0) > 3) v('template_shape', `message ${k}: offer has at most 3 benefits`);
      if (m.kind !== 'correction' && (m.wrong?.length ?? 0) > 0) v('template_shape', `message ${k}: only a correction has wrong lines`);
      for (const pr of m.preserves ?? []) if (!PRESERVES.includes(pr)) v('template_shape', `message ${k}: unknown preserve "${pr}"`);
    });
    if (!(p.close?.lines?.length) || p.close.lines.length > 3) v('template_shape', 'close needs 1-3 lines');
    if (p.cta?.button && !CTA_SOURCES.includes(p.cta.button.source)) v('invented_claim', `cta.button must come from ${CTA_SOURCES.join('|')}`);
    if ((p.proof?.length ?? 0) > 3) v('template_shape', 'proof has at most 3 numbers');
    (p.proof ?? []).forEach((s, k) => { const e = proofProblem(s, ctx); if (e) v('proof_not_in_brain', `proof.${k}: ${e}`); });
    if (!out.length) {
      const ag = chatTimeline(chatIn(p), lang);
      if (ag.endSec > CHAT_MAX_SEC) v('chat_too_long', `the chat lasts ${ag.endSec.toFixed(1)} s, max ${CHAT_MAX_SEC}: fewer or shorter messages`);
      if (ag.endSec < CHAT_MIN_SEC) v('chat_too_short', `the chat lasts ${ag.endSec.toFixed(1)} s, min ${CHAT_MIN_SEC}: more messages`);
    }
    return out;
  }
  // PERSON_MOTION
  const spans = p.spans ?? [];
  if (spans.length < 2 || spans.length > 6) v('spans_invalid', `2-6 spans, got ${spans.length}`);
  let ok = true;
  spans.forEach((s, k) => {
    if (!(s.startSec >= 0 && s.endSec > s.startSec && s.endSec <= ctx.durationSec + 0.05)) ok = false;
    if (k > 0 && s.startSec < spans[k - 1].endSec - 0.01) ok = false;
  });
  if (!ok) v('spans_invalid', 'spans must be inside the video, in order, without overlapping');
  const total = spans.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);
  if (total < SPANS_MIN_SEC - SPANS_SLACK || total > SPANS_MAX_SEC + SPANS_SLACK) v('spans_invalid', `spans sum ${total.toFixed(1)} s, must be ${SPANS_MIN_SEC}-${SPANS_MAX_SEC} s`);
  const { hook, cta } = hookAndCta(draft, ctx);
  const cobre = (b: { startSec: number; endSec: number }, ate = b.endSec) => spans.some((s) => s.startSec < ate && s.endSec > b.startSec);
  if (hook && !cobre(hook, Math.min(hook.endSec, hook.startSec + 3))) v('kept_missing', 'the spans must keep the spoken hook (first seconds of the hook block)');
  if (cta && !cobre(cta)) v('kept_missing', 'the spans must keep the spoken CTA block');
  const beats = p.beats ?? [];
  spans.forEach((_, k) => { if (!beats.some((b) => b.spanIndex === k)) v('template_shape', `span ${k} needs at least one beat`); });
  beats.forEach((b, k) => {
    const s = spans[b.spanIndex];
    if (!s) { v('beat_out_of_span', `beat ${k}: spanIndex ${b.spanIndex} does not exist`); return; }
    if (!wordIdxIn(ctx, b.atWord, s) || (b.untilWord !== null && b.untilWord !== undefined && (b.untilWord < b.atWord || !wordIdxIn(ctx, b.untilWord, s)))) {
      v('beat_out_of_span', `beat ${k}: atWord/untilWord must be transcript words inside span ${b.spanIndex}`);
    }
    if (b.kind === 'kinetic' && !((b.words?.length ?? 0) >= 1 && b.words.length <= 4)) v('template_shape', `beat ${k}: kinetic has 1-4 words`);
    if (b.kind === 'wrong_right' && !((b.right?.length ?? 0) >= 1 && b.right.length <= 3)) v('template_shape', `beat ${k}: wrong_right has 1-3 right lines`);
    if (b.kind === 'steps' && !((b.steps?.length ?? 0) >= 2 && b.steps.length <= 4)) v('template_shape', `beat ${k}: steps has 2-4 steps`);
    if (b.kind === 'icon_list') {
      if (!((b.items?.length ?? 0) >= 2 && b.items.length <= 4)) v('template_shape', `beat ${k}: icon_list has 2-4 items`);
      for (const it of b.items ?? []) if (!ICONS.includes(it.icon)) v('template_shape', `beat ${k}: icon must be one of ${ICONS.join('|')}`);
    }
    if (b.kind === 'cta' && b.button && !CTA_SOURCES.includes(b.button.source)) v('invented_claim', `beat ${k}: the CTA button must come from ${CTA_SOURCES.join('|')}`);
  });
  if (p.endCard) {
    if ((p.endCard.proof?.length ?? 0) > 3) v('template_shape', 'endCard.proof has at most 3 numbers');
    (p.endCard.proof ?? []).forEach((s, k) => { const e = proofProblem(s, ctx); if (e) v('proof_not_in_brain', `endCard.proof.${k}: ${e}`); });
    if (p.endCard.cta?.button && !CTA_SOURCES.includes(p.endCard.cta.button.source)) v('invented_claim', `endCard.cta.button must come from ${CTA_SOURCES.join('|')}`);
  }
  // legenda queimada dentro da caixa do rosto (mesma conta do build)
  const t = ctx.templates;
  if (t && ok && spans.length) {
    const lay = personMotionLayout(t.source, t.faceMap, spans, t.bands);
    if (lay.mode === 'blocked') v(lay.reason === 'no_face' ? 'no_face' : 'burned_captions', lay.reason === 'no_face' ? 'no face in these spans' : `the champion's burned-in captions would show inside the face box (spans ${lay.hits.map((h) => h.spanIndex).join(', ')}): pick other spans`);
  }
  return out;
}

// ───────── finalização (F1.3: finalizePlan) ─────────

const limpo = (x: TemplateText | null | undefined) => limparTexto(x?.text ?? '');
const fontes = (p: AutoChatDmDraft | AutoPersonMotionDraft) => Object.fromEntries(templateTextList(p).map((x) => [x.path, x.source])) as Record<string, CopySource>;
const proofOut = (xs: ProofStatDraft[] | undefined) => (xs ?? []).map((s) => ({ value: s.value, decimals: s.decimals, prefix: limparTexto(s.prefix ?? ''), suffix: limparTexto(s.suffix ?? ''), label: limparTexto(s.label) }));

/** `TemplateSpec` da peça (o que o buildTemplateInput do video lê). Marca do backend; trechos encaixados no silêncio. */
export function templateSpecOf(p: AutoChatDmDraft | AutoPersonMotionDraft, ctx: PlanCtx, media: Pick<MediaRulesPort, 'snapSpans'>, brand: NonNullable<PlanCtx['frame']>['brand']): TemplateSpec {
  const screenLanguage = screenLangOf(ctx);
  if (p.type === 'CHAT_DM') {
    const c = chatIn(p);
    return {
      type: 'CHAT_DM', templateId: 'chat-dm', screenLanguage, brand,
      hook: { text: c.hook.text, highlight: c.hook.highlight && c.hook.text.includes(c.hook.highlight) ? c.hook.highlight : null },
      chrome: c.chrome,
      messages: (p.messages ?? []).map((m, k) => ({ ...c.messages[k], preserves: [...(m.preserves ?? [])] })),
      close: c.close, cta: c.cta, proof: proofOut(p.proof), sources: fontes(p),
    };
  }
  const spans = (p.spans ?? []).map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
  // um trecho por vez: o snapSpans da medição junta trechos encostados, e os beats apontam pelo índice do trecho
  const timeline: { startSec: number; endSec: number }[] = [];
  for (const s of spans) {
    const [sn] = media.snapSpans([s], ctx.words, ctx.silences);
    const a = Math.max(Math.round((sn ?? s).startSec * 1000) / 1000, timeline[timeline.length - 1]?.endSec ?? 0);
    timeline.push({ startSec: a, endSec: Math.max(a + 0.04, Math.round((sn ?? s).endSec * 1000) / 1000) });
  }
  const beats: PersonBeatSpec[] = (p.beats ?? []).map((b) => {
    const base = { spanIndex: b.spanIndex, atWord: b.atWord, untilWord: b.untilWord ?? null };
    switch (b.kind) {
      case 'kinetic': return { ...base, kind: 'kinetic', words: b.words.map(limpo) };
      case 'wrong_right': return { ...base, kind: 'wrong_right', wrong: limpo(b.wrong), right: b.right.map(limpo) };
      case 'steps': return { ...base, kind: 'steps', steps: b.steps.map(limpo) };
      case 'icon_list': return { ...base, kind: 'icon_list', items: b.items.map((it) => ({ icon: it.icon, text: limpo(it.text) })) };
      case 'badge': return { ...base, kind: 'badge', text: limpo(b.text) };
      case 'cta': return { ...base, kind: 'cta', button: limpo(b.button), note: b.note ? limpo(b.note) : null };
    }
  });
  return {
    type: 'PERSON_MOTION', templateId: 'person-motion', screenLanguage, brand, timeline, beats,
    endCard: p.endCard ? { proof: proofOut(p.endCard.proof), cta: { button: limpo(p.endCard.cta.button), note: p.endCard.cta.note ? limpo(p.endCard.cta.note) : null } } : null,
    sources: fontes(p),
  };
}

/** Código do template (F1.1): CHAT-DM em EN e PT; PERSON-MOTION / PESSOA-MOTION. */
export function templateCode(type: TemplateType, lang: 'EN' | 'PT'): string {
  return type === 'CHAT_DM' ? 'CHAT-DM' : lang === 'PT' ? 'PESSOA-MOTION' : 'PERSON-MOTION';
}
