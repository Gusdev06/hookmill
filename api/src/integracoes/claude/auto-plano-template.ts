// Templates grátis do Iterate v2 (iterate-v2-quiz-templates-ia F1.2): roteiro do CHAT_DM e do PERSON_MOTION pelo
// planAutoBatch. O plano (AUTO_PLAN_SCHEMA) só escolhe o tipo; o roteiro sai na 2ª etapa do MESMO planAutoBatch, uma
// chamada por template, em paralelo com as do STATIC/molduras, com o mesmo sistema + contexto (prefixo cacheado). Motivo:
// o limite da gramática da saída estruturada (auto-plano-detalhe.ts, 25/10: ~55 propriedades compila, 105 falha); o
// roteiro do template sozinho tem ~35. Nada de chamada nova fora do planAutoBatch.
// Aqui: regras do prompt, esquemas (planos, sem union) e o parse (só FORMA: limites e "nada inventado" são do backend,
// iteracao/templates-plano.ts, e voltam como `violations` no reparo).
import type {
  AutoChatDmDraft, AutoPersonMotionDraft, ChatMessageKind, CopySource, PersonBeatDraft, ProofStatDraft, TemplateIconId, TemplatePreserve, TemplateText, TranscriptWord,
} from '../contrato';
import { sourceOf } from './auto-plano-estatico';

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const int = (description: string) => ({ type: 'integer', description });
const arr = (items: object, description: string) => ({ type: 'array', items, description });
const en = (values: (string | number)[], description: string) => ({ type: values.every((v) => typeof v === 'number') ? 'integer' : 'string', enum: values, description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const TEMPLATE_PRESERVES: TemplatePreserve[] = ['hook', 'pain', 'proof', 'mechanism', 'objection', 'offer', 'cta', 'promise'];
export const TEMPLATE_ICONS: TemplateIconId[] = ['check', 'x', 'arrow', 'brain', 'globe', 'chat', 'clock', 'star', 'gift', 'lock', 'heart', 'bolt'];
const KINDS: ChatMessageKind[] = ['question', 'objection', 'answer', 'correction', 'offer'];
const BEAT_KINDS = ['kinetic', 'wrong_right', 'steps', 'icon_list', 'badge', 'cta'] as const;
const SOURCES = 'Source of the text: a Brain field (what, audience, pains, promise, proof, offerAndPrice, cta), "transcript" (the champion says it) or "generic" (only interface words with no claim).';

const TEXT = (what: string) => obj({
  text: str(what),
  source: str(SOURCES),
  srcStartSec: num('When source is "transcript": second where the champion says it. -1 otherwise.'),
  srcEndSec: num('When source is "transcript": second where it ends. -1 otherwise.'),
});
const PROOF = arr(obj({
  value: num('A number copied from Brain › proof (e.g. 20000, 4.9, 93).'),
  decimals: en([0, 1, 2], 'Decimals shown (4.9 → 1).'),
  prefix: str('Symbol before the number only if Brain › proof has it next to it ("+", "★"), else empty.'),
  suffix: str('Symbol after the number only if Brain › proof has it ("+", "%"), else empty.'),
  label: str('The words next to that number in Brain › proof, copied, screen language, max 24.'),
}), '0-3 REAL numbers from Brain › proof. Empty when Brain › proof has no number. Never a number from anywhere else.');

export const CHAT_DM_SCHEMA = obj({
  template: obj({
    hook: obj({
      text: str('Fixed headline on top: the champion hook (on-screen text or spoken), screen language, max 40.'),
      highlight: str('Exact words of hook.text in the accent color (max 16), or empty.'),
      source: str(SOURCES), srcStartSec: num('Second of the hook in the champion, or -1.'), srcEndSec: num('End second, or -1.'),
    }),
    chrome: obj({
      typing: str('The app label for "typing…" in the screen language, max 24.'),
      inputPlaceholder: str('Placeholder of the message bar ("Message…") in the screen language, max 24.'),
      profileStatus: str('Status under the profile name ("Active now") in the screen language, max 24, no claim.'),
    }),
    messages: arr(obj({
      from: en(['prospect', 'brand'], 'prospect = someone who wants to buy and has NOT bought yet; brand = the advertiser.'),
      kind: en(KINDS, 'prospect: question or objection only. brand: answer, correction (wrong → right card) or offer (offer card).'),
      text: str('Bubble text (max 90). correction/offer: the card title (max 24).'),
      source: str(SOURCES),
      srcStartSec: num('When source is "transcript": second in the champion. -1 otherwise.'),
      srcEndSec: num('When source is "transcript": end second. -1 otherwise.'),
      wrong: arr(str('max 40'), 'correction only: 0-2 crossed-out wrong lines. Empty otherwise.'),
      right: arr(str('max 40'), 'correction: 1-3 right lines. offer: 1-3 benefits from the Brain or transcript. Empty otherwise.'),
      preserves: arr(en(TEMPLATE_PRESERVES, ''), 'Which parts of the champion this message keeps.'),
    }), '6-12 messages, in order.'),
    close: arr(TEXT('Closing motion scene line, max 32: the promise, then the call.'), '1-3 lines.'),
    ctaButton: TEXT('CTA button, max 28, from Brain cta / offerAndPrice or the spoken CTA.'),
    ctaNote: TEXT('Small line under the button (max 40), only if the Brain says it (e.g. no card needed); empty text otherwise.'),
    proof: PROOF,
  }),
});

export const PERSON_MOTION_SCHEMA = obj({
  template: obj({
    spans: arr(obj({
      startSec: num('Start of the stretch in the champion (seconds, at a pause).'),
      endSec: num('End of the stretch (seconds, at a pause, never inside a word).'),
      preserves: arr(en(TEMPLATE_PRESERVES, ''), 'What this stretch keeps.'),
    }), '2-6 stretches of the champion, in order, not overlapping; they sum 18-40 s; keep the spoken hook and the spoken CTA.'),
    beats: arr(obj({
      spanIndex: int('Index of the stretch (0-based).'),
      atSec: num('Champion second of the word that triggers this scene (inside the stretch).'),
      untilSec: num('Champion second of the last word it covers, or -1 (until the next scene).'),
      kind: en([...BEAT_KINDS], 'kinetic (1-4 key terms, max 24 each), wrong_right (line 1 = wrong max 32, lines 2-4 = right), steps (2-4 steps max 16, arrows between), icon_list (2-4 items max 20, one icon each), badge (one stamp max 20), cta (line 1 = button max 28, line 2 = note or empty).'),
      lines: arr(str('screen language'), 'The texts of the scene, as described for its kind.'),
      icons: arr(en(TEMPLATE_ICONS, ''), 'icon_list only: one icon per line. Empty otherwise.'),
      source: str(SOURCES),
      srcStartSec: num('When source is "transcript": second in the champion. -1 otherwise.'),
      srcEndSec: num('When source is "transcript": end second. -1 otherwise.'),
    }), 'Stage scenes, at least one per stretch, in time order, each tied to what is being said.'),
    endCard: obj({
      show: { type: 'boolean', description: 'true = 3 s closing scene after the last word: proof numbers + CTA.' },
      proof: PROOF,
      ctaButton: TEXT('CTA button, max 28, from Brain cta / offerAndPrice or the spoken CTA.'),
      ctaNote: TEXT('Line under the button (max 40), only if the Brain says it; empty text otherwise.'),
    }),
  }),
});

export const TEMPLATE_RULES = `TEMPLATES (CHAT_DM, PERSON_MOTION):
- Free pieces drawn in code. Never a screenshot of the landing page, never a generated image, never the product image.
- CHAT_DM [DIVERSITY]: the champion becomes a Direct-message conversation. The pain or objection becomes a question from someone who WANTS to buy; proof, mechanism and offer become the brand's answers; it ends on a motion scene (promise + real numbers from Brain › proof + CTA). No person, no video. The prospect never reports a result ("I lost", "it worked", "I finally"): they have not bought yet. The brand only states what the Brain or the transcript says.
- PERSON_MOTION [DIVERSITY]: motion graphics on a stage above, synced to the speech; below, in a round box, the champion's OWN face and voice in 2-6 stretches cut from the champion (an edit, nothing generated). Word-by-word captions are always on. Pick stretches that keep the hook, the proof and the CTA, cut at pauses.
- Every on-screen text is in the screen language and carries its source; a text from the transcript also carries the seconds where the champion says it. No person name, no competitor, no platform, no brand name, no URL. Offer-agnostic: never name the niche.
- Numbers only from the Brain or the transcript. Proof numbers ONLY from Brain › proof, copied with their label.
- Limits are visible characters; a Chinese/Japanese/Korean character counts as 1.`;

/** Pedido da 2ª etapa de um template. */
export function templateDetailMessage(type: 'CHAT_DM' | 'PERSON_MOTION', t: { whyKey: string; change: string; rationale: string }, ctx: { screenLanguage: string; whys: Record<string, string>; violations?: string[] }): string {
  const why = ctx.whys[t.whyKey] ? ` ("${ctx.whys[t.whyKey]}")` : '';
  const lines = [
    type === 'CHAT_DM'
      ? 'Second step of this plan: write the CHAT_DM conversation, following "TEMPLATES". 6-12 messages that last 18-40 s to read; close with the promise and the call.'
      : 'Second step of this plan: write the PERSON_MOTION script, following "TEMPLATES". Choose the stretches from the transcript (seconds at pauses) and the stage scenes, at least one per stretch.',
    `Screen language for every on-screen text: ${ctx.screenLanguage}.`,
    `The piece attacks the ${t.whyKey} line${why}. Change: "${t.change}". Rationale: "${t.rationale}".`,
  ];
  const own = (ctx.violations ?? []).filter((v) => new RegExp(`\\(${type}\\)`).test(v));
  if (own.length) lines.push(`A previous plan broke these rules in this piece; fix every one:\n${own.map((v) => `- ${v}`).join('\n')}`);
  lines.push('Return template.');
  return lines.join('\n\n');
}

// ───────────────────────── parse (só forma) ─────────────────────────

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const n = (v: unknown, d = -1): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const src = (v: unknown): CopySource => sourceOf(v) ?? (s(v) === 'generic' ? 'generic' : 'generic');
const r2 = (x: number) => Math.round(x * 100) / 100;

function texto(raw: Record<string, unknown>, textKey = 'text'): TemplateText | null {
  const text = s(raw[textKey]);
  if (!text) return null;
  const source = src(raw.source);
  const a0 = n(raw.srcStartSec), b0 = n(raw.srcEndSec);
  return { text, source, srcSpan: source === 'transcript' && a0 >= 0 && b0 > a0 ? { startSec: r2(a0), endSec: r2(b0) } : null };
}
const linhaCom = (t: string, base: TemplateText): TemplateText => ({ text: t, source: base.source, srcSpan: base.srcSpan ?? null });
const preserves = (v: unknown) => a(v).map(s).filter((x): x is TemplatePreserve => TEMPLATE_PRESERVES.includes(x as TemplatePreserve));
function provas(v: unknown): ProofStatDraft[] {
  return a(v).map(o).map((p) => ({ value: n(p.value, NaN), decimals: ([0, 1, 2].includes(n(p.decimals, 0)) ? n(p.decimals, 0) : 0) as 0 | 1 | 2, prefix: s(p.prefix), suffix: s(p.suffix), label: s(p.label), source: 'proof' as const }))
    .filter((p) => Number.isFinite(p.value) && p.label).slice(0, 3);
}

export function chatDmOf(raw: Record<string, unknown>): AutoChatDmDraft | null {
  const hookRaw = o(raw.hook);
  const hook = texto(hookRaw);
  if (!hook) return null;
  const chrome = o(raw.chrome);
  const messages = a(raw.messages).map(o).map((m) => {
    const t = texto(m);
    if (!t) return null;
    const from = s(m.from) === 'prospect' ? 'prospect' : 'brand';
    const kind = (KINDS.find((k) => k === s(m.kind)) ?? (from === 'prospect' ? 'question' : 'answer')) as ChatMessageKind;
    return {
      from, kind, text: t,
      wrong: a(m.wrong).map(s).filter(Boolean).map((x) => linhaCom(x, t)),
      right: a(m.right).map(s).filter(Boolean).map((x) => linhaCom(x, t)),
      preserves: preserves(m.preserves),
    } as AutoChatDmDraft['messages'][number];
  }).filter((m): m is AutoChatDmDraft['messages'][number] => !!m);
  const button = texto(o(raw.ctaButton));
  if (!button || !messages.length) return null;
  return {
    type: 'CHAT_DM',
    hook: { ...hook, highlight: s(hookRaw.highlight) || null },
    chrome: { typing: s(chrome.typing), inputPlaceholder: s(chrome.inputPlaceholder), profileStatus: s(chrome.profileStatus) },
    messages,
    close: { lines: a(raw.close).map(o).map((x) => texto(x)).filter((x): x is TemplateText => !!x) },
    cta: { button, note: texto(o(raw.ctaNote)) },
    proof: provas(raw.proof),
  };
}

/** Palavra da transcrição pelo segundo (a 1ª que começa em ≥ t − 0,15 s). -1 = nenhuma. */
export function wordAt(words: TranscriptWord[], t: number): number {
  if (!(t >= 0)) return -1;
  const k = words.findIndex((w) => w.startSec >= t - 0.15);
  return k;
}

export function personMotionOf(raw: Record<string, unknown>, words: TranscriptWord[]): AutoPersonMotionDraft | null {
  const spans = a(raw.spans).map(o).map((x) => ({ startSec: r2(n(x.startSec, 0)), endSec: r2(n(x.endSec, 0)), preserves: preserves(x.preserves) }));
  if (!spans.length) return null;
  const beats: PersonBeatDraft[] = [];
  for (const b of a(raw.beats).map(o)) {
    const base = texto({ text: 'x', source: b.source, srcStartSec: b.srcStartSec, srcEndSec: b.srcEndSec })!;
    const lines = a(b.lines).map(s).filter(Boolean);
    const L = (t: string) => linhaCom(t, base);
    const atWord = wordAt(words, n(b.atSec));
    const u = n(b.untilSec);
    const head = { spanIndex: Math.round(n(b.spanIndex, -1)), atWord, untilWord: u >= 0 ? Math.max(atWord, wordAt(words, u)) : null };
    const kind = BEAT_KINDS.find((k) => k === s(b.kind));
    if (!kind || !lines.length) continue;
    switch (kind) {
      case 'kinetic': beats.push({ ...head, kind, words: lines.slice(0, 4).map(L) }); break;
      case 'wrong_right': beats.push({ ...head, kind, wrong: L(lines[0]), right: lines.slice(1, 4).map(L) }); break;
      case 'steps': beats.push({ ...head, kind, steps: lines.slice(0, 4).map(L) }); break;
      case 'icon_list': {
        const icons = a(b.icons).map(s);
        beats.push({ ...head, kind, items: lines.slice(0, 4).map((t, k) => ({ icon: (TEMPLATE_ICONS.find((x) => x === icons[k]) ?? 'check') as TemplateIconId, text: L(t) })) });
        break;
      }
      case 'badge': beats.push({ ...head, kind, text: L(lines[0]) }); break;
      case 'cta': beats.push({ ...head, kind, button: L(lines[0]), note: lines[1] ? L(lines[1]) : null }); break;
    }
  }
  const end = o(raw.endCard);
  const endButton = texto(o(end.ctaButton));
  return {
    type: 'PERSON_MOTION', spans, beats,
    endCard: end.show === true && endButton ? { proof: provas(end.proof), cta: { button: endButton, note: texto(o(end.ctaNote)) } } : null,
  };
}

/** Params do item a partir do detalhe encaixado em `params.template` (null = a peça sai). */
export function templateParamsOf(type: 'CHAT_DM' | 'PERSON_MOTION', p: Record<string, unknown>, words: TranscriptWord[]): AutoChatDmDraft | AutoPersonMotionDraft | null {
  const raw = o(p.template);
  if (!Object.keys(raw).length) return null;
  return type === 'CHAT_DM' ? chatDmOf(raw) : personMotionOf(raw, words);
}
