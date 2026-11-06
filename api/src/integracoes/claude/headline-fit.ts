// troca-texto-queimado-v1 §16.3 (F1b, I1): a headline copiada do criativo tem que ficar perto do tamanho da original, linha
// a linha. Aqui moram, puros: o alvo por linha (85-115 %), a limpeza de emoji (o emoji é da peça, recortado do quadro; o
// texto gerado nunca traz um) e a chamada `rewriteHeadlineFit` (esquema, prompt e leitura da resposta). O veredito do
// tamanho é sempre de `ajustarHeadlineCopia` (video/src/lib); a IA só recebe a medida e o alvo.
import type { RewriteHeadlineFitInput } from '../contrato';
import { HEADLINE_FIT_MODEL } from '../catalogo/precos';
import { IntegracaoError } from '../erros';
import { parseJsonObject } from './validacao-campeao';

// ---------------------------------------------------------------- emoji

/** Pictograma, bandeira, tom de pele, seletor de variação, ZWJ e keycap. Dígito, #, * e letras ficam (o keycap sai, o
 *  dígito fica, e o "nada inventado" do backend decide). */
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

export function hasEmoji(text: string): boolean {
  EMOJI.lastIndex = 0;
  return EMOJI.test(text);
}

/** Tira emoji e arruma os espaços de cada linha; mantém as quebras `\n` (linhas vazias saem). */
export function stripEmoji(text: string): string {
  return text
    .replace(EMOJI, ' ')
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------- alvo por linha

/** §16.3 item 1: alvo de 85-115 % dos caracteres de cada linha da original (mín. 1). */
export function alvosPorLinha(charsPerLine: number[]): { min: number; max: number }[] {
  const { min, max } = HEADLINE_FIT_MODEL.targetPct;
  return charsPerLine
    .filter((c) => Number.isFinite(c) && c > 0)
    .map((c) => ({ min: Math.max(1, Math.floor(c * min)), max: Math.max(1, Math.ceil(c * max)) }));
}

/** "line 1: 14-19 characters; line 2: 17-23 characters" (+ total). */
export function alvoTexto(t: { min: number; max: number }[]): string {
  if (!t.length) return '';
  const lines = t.map((x, k) => `line ${k + 1}: ${x.min}-${x.max} characters`).join('; ');
  const sum = t.reduce((a, x) => ({ min: a.min + x.min, max: a.max + x.max }), { min: 0, max: 0 });
  return `${lines} (about ${sum.min}-${sum.max} characters in total, spaces included)`;
}

// ---------------------------------------------------------------- rewriteHeadlineFit: esquema e prompt

const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const REWRITE_FIT_SCHEMA = obj({
  lines: {
    type: 'array',
    items: { type: 'string' },
    description: 'The new headline, one entry per line, as many lines as the targets. Each line within its character target.',
  },
  highlight: { type: 'string', description: 'Only when the request says the original has a highlight: the strongest 1-4 consecutive words of the new headline, copied exactly. Empty string otherwise.' },
});

export const REWRITE_FIT_SYSTEM = `You rewrite one short headline that is burned into a video ad. The old headline is erased and the new one is drawn in exactly the same place, font and size, so the new text must have about the same length as the old one, line by line: too short leaves a visible hole where the old text was; too long does not fit or runs into the face.

Rules:
- Keep the meaning, the angle and the language of the current text. Same voice as the original (a question stays a question). Write normally: if the original is shown in capitals, the render does it.
- Hit the character target of every line (spaces count). To make it longer, restate what the text already says with more concrete words; to make it shorter, drop filler words.
- Nothing new: never add a number, price, time span, percentage, name or claim that is not already in the current text or in the original.
- No emojis, no hashtags, no quotation marks, no brand name. If the original has an emoji, it stays in the video on its own; never write one.
- The new headline must differ from the original and from the other headlines listed.`;

const REJECT_TEXT: Record<RewriteHeadlineFitInput['reject'], string> = {
  too_short: 'TOO SHORT: it leaves part of the old text area uncovered. Write it longer, close to the targets.',
  too_long: 'TOO LONG: it does not fit the old text area even slightly smaller with one extra line. Write it shorter, within the targets.',
  over_chin: 'TOO LONG: with this length the text goes down onto the face (the chin). Write it shorter, within the targets.',
  rule: 'BREAKS A RULE (listed below). Fix it and keep the length within the targets.',
};

export function rewriteFitUserMessage(i: RewriteHeadlineFitInput): string {
  const q = (t: string) => `"${t.replace(/\s*\n\s*/g, ' / ').replace(/"/g, '”')}"`;
  const original = stripEmoji(i.original);
  const out = [
    `<headline language="${i.language}" lines="${Math.max(1, i.targetCharsPerLine.length)}" highlight="${i.hasHighlight ? 'yes' : 'no'}">`,
    `Original headline (lines split by " / "): ${q(original || i.original)}${hasEmoji(i.original) ? ' (its emoji stays in the video; write none)' : ''}`,
    `Current new headline: ${q(stripEmoji(i.current))}`,
    `Problem: ${REJECT_TEXT[i.reject]}`,
    i.measure ? `Measure: ${i.measure}.` : '',
    i.targetCharsPerLine.length ? `Targets: ${alvoTexto(i.targetCharsPerLine)}.` : '',
    i.rules.length ? `Rules to respect:\n${i.rules.map((r) => `- ${r}`).join('\n')}` : '',
    i.others?.length ? `Other headlines in this batch (yours must differ from them):\n${i.others.map((o) => `- ${q(o)}`).join('\n')}` : '',
    '</headline>',
  ];
  return out.filter(Boolean).join('\n');
}

const unquote = (t: string) => t.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Linhas → 1 texto (espaço; quem quebra é `ajustarHeadlineCopia`), sem emoji e sem aspas; destaque só se a original tem
 *  e é trecho literal. Vazio = INVALID_SCRIPT (conta como tentativa no laço). */
export function parseRewriteFit(text: string, i: Pick<RewriteHeadlineFitInput, 'hasHighlight'>): { text: string; highlight: string | null } {
  const d = o(parseJsonObject(text));
  const raw = Array.isArray(d.lines) ? d.lines : typeof d.text === 'string' ? [d.text] : [];
  const lines = raw.filter((l): l is string => typeof l === 'string').map((l) => unquote(stripEmoji(l).replace(/\n/g, ' '))).filter(Boolean);
  const out = lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!out) throw new IntegracaoError('INVALID_SCRIPT', 'headline rewrite came back empty');
  const hl = typeof d.highlight === 'string' ? unquote(stripEmoji(d.highlight).replace(/\s+/g, ' ')) : '';
  const highlight = i.hasHighlight && hl && hl !== out && out.includes(hl) ? hl : null;
  return { text: out, highlight };
}
