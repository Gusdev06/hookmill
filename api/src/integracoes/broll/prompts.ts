// Prompts do b-roll (§B3.1), no método da skill get-brolls: buscas "entidade + ação" a partir da fala; escolher OLHANDO
// as folhas de quadros e citando as células vistas no motivo; recusar o que não serve. Saída estruturada e pequena
// (strict; esquemas bem abaixo do teto de gramática medido em 25/10).
import { parseJsonObject } from '../claude/validacao-campeao';

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const QUERY_SCHEMA = obj({
  queries: { type: 'array', items: str('2-5 English words: a visible entity + an action ("woman stretching in bed").'), description: '2 or 3 stock video searches, best first.' },
  fallbackSubject: str('English, max 160 characters: one concrete everyday photo that shows what the speech is about, with no text, brand, logo or famous person. Used only if no clip fits.'),
});

export const QUERY_SYSTEM = `You find stock B-roll for a short vertical video ad. The B-roll plays muted in a second panel while the person in the main video speaks. From the speech of this stretch, write 2 or 3 searches for a stock video library (Pexels), in English, each "visible entity + action": what a camera would actually film while those words are said (for example "woman holding lower back in bed", "hands typing on laptop at night"). Literal first: the thing, place or action the speech names; if the speech is abstract, the everyday moment it implies. Never a brand, logo, app name, product name, famous person or text on screen. Match the tone of the offer. Generic people only.`;

export function queryUserMessage(i: { speech: string; language: string; offer?: { name?: string | null; kind?: string | null; what?: string | null; audience?: string | null } | null }): string {
  const o = i.offer;
  const brief = o ? [o.kind && `Kind: ${o.kind}`, o.what && `What it is: ${o.what}`, o.audience && `Audience: ${o.audience}`].filter(Boolean).join('\n') : '';
  return [`Speech of this stretch (${i.language}):\n"${i.speech.replace(/"/g, '”')}"`, brief ? `<offer>\n${brief}\n</offer>` : '', 'Write the searches.'].filter(Boolean).join('\n\n');
}

export function parseQueries(text: string): { queries: string[]; fallbackSubject: string } {
  const r = parseJsonObject(text);
  const queries = (Array.isArray(r.queries) ? r.queries : [])
    .map((q) => (typeof q === 'string' ? q.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim() : ''))
    .filter((q) => q.length >= 3 && q.split(' ').length <= 8)
    .slice(0, 3);
  return { queries: [...new Set(queries.map((q) => q.toLowerCase()))], fallbackSubject: typeof r.fallbackSubject === 'string' ? r.fallbackSubject.replace(/["“”]/g, '').trim().slice(0, 160) : '' };
}

export const PICK_SCHEMA = obj({
  choice: int('Number of the chosen candidate (1-based), or 0 when none fits.'),
  firstCell: int('First cell of the chosen stretch (1-12). 0 when none fits.'),
  lastCell: int('Last cell of the chosen stretch (1-12, >= firstCell). 0 when none fits.'),
  reason: str('One sentence citing the cells you saw, e.g. "cells 2-6 show a woman sitting up in bed holding her lower back, matching the pain line". Interface language: English.'),
  rejected: {
    type: 'array',
    description: 'Every other candidate you looked at and why it does not fit.',
    items: obj({ candidate: int('Candidate number (1-based).'), reason: str('Short reason: watermark, text, logo, famous face, does not match the speech, etc.') }),
  },
});

export const PICK_SYSTEM = `You choose stock B-roll by LOOKING at contact sheets. Each candidate comes as one sheet of 12 numbered cells read left to right, top to bottom, evenly spaced in time (the caption gives the seconds of each cell). Pick the candidate and the stretch of cells whose motion best shows what the speech says, and cite the cells you saw. Only describe what is visible in the sheets. Reject any clip with a watermark, burned-in text or subtitles, a logo or brand, a recognizable famous person, or content that does not match the speech; reject clips that look like a different topic. If none fits, choice is 0 and say why. Prefer a continuous stretch without a cut, steady framing, and generic people.`;

export function pickUserMessage(i: { speech: string; language: string; minSec: number; candidates: { n: number; durationSec: number; cellTimes: number[] }[] }): string {
  return [
    `Speech of this stretch (${i.language}): "${i.speech.replace(/"/g, '”')}"`,
    `The stretch should last about ${i.minSec.toFixed(1)} s or more when the clip allows it.`,
    ...i.candidates.map((c) => `Candidate ${c.n}: ${c.durationSec} s long; cells at ${c.cellTimes.map((t, k) => `${k + 1}=${t}s`).join(', ')}.`),
    'Choose.',
  ].join('\n');
}

export interface Pick { choice: number; firstCell: number; lastCell: number; reason: string; rejected: { candidate: number; reason: string }[] }

export function parsePick(text: string, count: number): Pick {
  const r = parseJsonObject(text);
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
  const choice = n(r.choice) >= 1 && n(r.choice) <= count ? n(r.choice) : 0;
  const first = Math.min(12, Math.max(1, n(r.firstCell) || 1));
  const last = Math.min(12, Math.max(first, n(r.lastCell) || first));
  const rejected = (Array.isArray(r.rejected) ? r.rejected : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ candidate: n(x.candidate), reason: typeof x.reason === 'string' ? x.reason.trim().slice(0, 200) : '' }))
    .filter((x) => x.candidate >= 1 && x.candidate <= count && x.candidate !== choice);
  return { choice, firstCell: choice ? first : 0, lastCell: choice ? last : 0, reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 300) : '', rejected };
}

/** Imagem de reserva (GPT Image 2, 1k): foto do dia a dia do assunto do trecho, sem texto (painel pequeno da moldura). */
export function fallbackImagePrompt(subject: string): string {
  const s = subject.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return [
    `object: ${s || 'an ordinary everyday moment that fits the speech'}`,
    'scene: a real everyday place, one clear subject, simple background',
    'vibe: honest, calm, soft light from a window on one side',
    'photo quality and vibe: non-studio lighting, no oversharpening, iphone photo vibe, raw quality, random realistic photo taken during a random moment of the day',
    'no text, no letters, no watermarks, no logos, no borders, no frames, no famous people.',
    'aspect ratio: 9:16',
  ].join('\n');
}
