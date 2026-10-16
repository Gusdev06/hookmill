// Prompts e esquemas do Claude. Regra do produto: AGNÓSTICO DE OFERTA. Nenhum nicho, produto ou promessa
// mora aqui; tudo vem do briefing. Os prompts estão em inglês (instrução), a saída sai no idioma da oferta.
// Lições da operação embutidas (clonador/system.md, memória do Gusta): uma pessoa só em quadro, pose descrita
// em positivo, nada de objeto proibido citado, fala no ritmo de ~2,5 palavras/s, nunca inventar prova.
import type { OfferBriefDraft, WinnerExample } from '../contrato';
import { WORDS_PER_SECOND, countWords } from '../catalogo/precos';

// ---------------------------------------------------------------- briefing

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

export const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'language', 'kind', 'what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'],
  properties: {
    name: { type: 'string', description: 'Product or offer name as the page presents it.' },
    language: { type: 'string', description: 'BCP 47 tag of the page language, e.g. en, pt-BR, es, fr, de.' },
    kind: { ...nullableString, description: 'Short category, 1-4 words (e.g. "Mobile app", "Online course", "Skincare product").' },
    what: { ...nullableString, description: 'What it is and how it works, 1-3 sentences.' },
    audience: { ...nullableString, description: 'Who it is for, as specific as the page allows.' },
    promise: { ...nullableString, description: 'The main promise or outcome, in the page own words where possible.' },
    pains: { ...nullableString, description: 'Problems and frustrations the page says the audience has. Short list, one per line.' },
    proof: { ...nullableString, description: 'Proof shown on the page: numbers, testimonials, guarantees, authority. Only what is literally there.' },
    offerAndPrice: { ...nullableString, description: 'Price, plans, discounts, bonuses, trial, guarantee terms.' },
    cta: { ...nullableString, description: 'The call to action the page uses (button text or equivalent).' },
    notes: { ...nullableString, description: 'Tone of voice, claims to avoid, compliance-sensitive points. null if nothing stands out.' },
  },
} as const;

export const BRIEF_SYSTEM = `You read a sales or landing page and fill a creative brief that a video ad team will use to write short ads for this offer.

Rules:
- Use only what the page says. If a field is not on the page, return null for it. Never invent numbers, testimonials, guarantees, prices or results.
- Write every field in the page's own language (the same language you report in "language").
- Keep fields short and concrete: an ad writer should be able to scan the whole brief in 20 seconds.
- "language" is a BCP 47 tag. Use region subtags only when the page makes the region clear (Brazilian Portuguese = pt-BR).
- The page text was extracted automatically and may include navigation, cookie banners or repeated footer text: ignore those.
- Related pages, when present, are other subdomains of the same offer (checkout, members area, app, upsell). The main page leads: use related pages to fill gaps or add specifics (price, plans, guarantee, bonuses, what the buyer gets). If they contradict the main page, keep the main page. Ignore related pages that are clearly about something else (a blog post, a login wall, a different product). "language" comes from the main page.`;

export function briefUserMessage(page: {
  url?: string; title?: string | null; description?: string | null; text: string; truncated?: boolean;
  related?: { url: string; title: string | null; text: string; truncated: boolean }[];
}): string {
  const head = [
    page.url ? `URL: ${page.url}` : 'Source: text pasted by the user',
    page.title ? `Title: ${page.title}` : null,
    page.description ? `Meta description: ${page.description}` : null,
    page.truncated ? 'Note: the page was long and the text below was cut at the end.' : null,
  ].filter(Boolean);
  const related = (page.related ?? []).map((r) =>
    `<related_page url="${r.url}"${r.title ? ` title="${r.title.replace(/"/g, "'")}"` : ''}${r.truncated ? ' cut="true"' : ''}>\n${r.text}\n</related_page>`);
  return `${head.join('\n')}\n\n<page_text>\n${page.text}\n</page_text>${related.length ? `\n\n${related.join('\n\n')}` : ''}\n\nFill the brief.`;
}

// ---------------------------------------------------------------- roteiros

/** Rótulos que o web traduz (os outros aparecem como vieram). O primeiro bloco é sempre "hook". */
export const BLOCK_LABELS = ['hook', 'problem', 'story', 'product', 'demo', 'proof', 'objection', 'offer', 'cta'] as const;

export const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['angle', 'rationale', 'blocks'],
  properties: {
    angle: { type: 'string', description: 'Name of the angle, 2-6 words, in the offer language.' },
    rationale: { type: 'string', description: 'Why this ad should work for this audience, 1-2 sentences, in the offer language.' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'durationSec', 'speech', 'visualPrompt'],
        properties: {
          label: { type: 'string', enum: [...BLOCK_LABELS] },
          durationSec: { type: 'integer', description: 'Whole seconds this block lasts on screen.' },
          speech: { type: 'string', description: 'Exactly what the person says, in the offer language.' },
          visualPrompt: { type: 'string', description: 'English shot description for the video model.' },
        },
      },
    },
  },
} as const;

export const SCRIPTS_SYSTEM = `You are a direct-response video ad scriptwriter. You write short vertical ads (TikTok, Reels, Shorts, Meta) for any kind of offer, spoken to camera by one person.

What you deliver for each script:
- "angle": the idea that makes this ad different from the other options.
- "rationale": why it should work for this audience.
- "blocks": the ad in order. The first block is always the hook ("label": "hook", 2-4 seconds), and the ad ends with a call to action ("label": "cta"). Total length 20-40 seconds unless the brief asks otherwise. Each block lasts 2-15 seconds.

The speech:
- Written in the offer language, as people actually talk in that language: short sentences, no jargon, no emojis, no stage directions, no hashtags.
- Fits its block: about ${WORDS_PER_SECOND.toFixed(1)} spoken words per second of block duration (a 4-second block holds about 10 words). Do not cram.
- The hook has to stop the scroll in the first second: a specific claim, question or situation, never a greeting or the brand name.
- Honest: use only facts, numbers, results, testimonials and guarantees that are in the brief. If the brief has no proof, do not invent any; build the ad on the problem and the mechanism instead. Respect anything listed in the brief notes as something to avoid.
- The call to action uses the brief's CTA when there is one.

The visual prompt (always in English, one per block) feeds two kinds of video engines: an image-to-video model that animates a photo of the person, and a talking-avatar lipsync model. So:
- Start with "SOLO SHOT," and describe exactly one person, the same person in every block, speaking to the camera. Never add a second person.
- Describe what you want to see, in positive terms: framing (close-up, medium close-up), expression, head movement, posture, setting, light, camera move. Example: "SOLO SHOT, medium close-up, she leans slightly toward the camera with a knowing half smile, cozy living room, soft window light, slow push-in."
- Keep both arms relaxed and low or out of frame; keep the person's appearance unchanged (do not describe hair, clothes or face changes).
- Do not ask for on-screen text, captions, logos, phone screens or interfaces: captions are added later.
- Never write a brand, product, app or company name in the visual prompt (not even the offer's own): image and video models cannot render brands. Describe anything branded by its look instead (for example "a small white bottle with a green cap", not the product name).

Winning ads from the same offer show what already works for this audience: you may reuse their angle family and rhythm, but write new lines. Winning ads from other offers are given as structure only (block types, timing, word counts): borrow the structure, never their promise or wording.`;

/** Famílias de ângulo pra os N roteiros saírem diferentes mesmo escritos em paralelo (cada slot recebe uma). */
export const ANGLE_FAMILIES = [
  'Pain first: open on a specific, everyday frustration of this audience, then reveal the way out.',
  'Curiosity: open with the most surprising or counterintuitive fact in the brief, then explain it.',
  'Proof first: open with the strongest result, number or testimonial in the brief (if the brief has no proof, use a concrete before/after situation instead).',
  'Contrarian: challenge a common belief or habit this audience has, then show the better way.',
  'Demonstration: show how it works in a few fast, concrete steps.',
  'Objection: open with the main doubt this audience has about this kind of offer and dismantle it.',
  'Mini story: a first-person story in three beats, before, turning point, after.',
];

export function familyFor(slot: number, avoidCount: number): string {
  return ANGLE_FAMILIES[(slot + avoidCount) % ANGLE_FAMILIES.length];
}

function field(label: string, v: string | null): string | null {
  return v?.trim() ? `${label}: ${v.trim()}` : null;
}

export function briefBlock(o: OfferBriefDraft): string {
  return [
    field('Offer name', o.name),
    field('Content language (write speech in this language)', o.language),
    field('Kind', o.kind),
    field('What it is', o.what),
    field('Who it is for', o.audience),
    field('Main promise', o.promise),
    field('Pains', o.pains),
    field('Proof', o.proof),
    field('Offer and price', o.offerAndPrice),
    field('Call to action', o.cta),
    field('Notes (tone, what to avoid)', o.notes),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Vencedores como contexto. Da MESMA oferta: ângulo + falas. De OUTRA oferta: só estrutura (tipo de bloco,
 * duração, contagem de palavras). A fala e o ângulo de outra oferta nem chegam ao prompt: a regra
 * "estrutura, nunca a promessa" é garantida aqui, não pedida ao modelo.
 */
export function winnersBlock(winners: WinnerExample[]): string | null {
  if (!winners.length) return null;
  const same = winners.filter((w) => w.sameOffer);
  const other = winners.filter((w) => !w.sameOffer);
  const parts: string[] = [];
  same.forEach((w, i) => {
    const lines = w.blocks.map((b) => `  - ${b.label} (${dur(b)}s): "${b.speech.trim()}"`);
    parts.push(`Winner ${i + 1} from THIS offer${w.angle ? `, angle "${w.angle}"` : ''}:\n${lines.join('\n')}`);
  });
  other.forEach((w, i) => {
    const total = w.blocks.reduce((a, b) => a + dur(b), 0);
    const lines = w.blocks.map((b) => `  - ${b.label}: ${dur(b)}s, ${countWords(b.speech)} words`);
    parts.push(`Winner structure ${i + 1} from ANOTHER offer (${total}s total, structure only):\n${lines.join('\n')}`);
  });
  return parts.join('\n\n');
}

function dur(b: { startSec: number; endSec: number }): number {
  return Math.round((b.endSec - b.startSec) * 10) / 10;
}

export function scriptsContext(o: OfferBriefDraft, winners: WinnerExample[]): string {
  const w = winnersBlock(winners);
  return `<brief>\n${briefBlock(o)}\n</brief>${w ? `\n\n<winners>\n${w}\n</winners>` : ''}`;
}

export function scriptUserMessage(i: { slot: number; count: number; family: string; avoidAngles: string[] }): string {
  const avoid = i.avoidAngles.length ? `\nAngles already used for this ad (do not repeat them or anything close): ${i.avoidAngles.map((a) => `"${a}"`).join(', ')}.` : '';
  return `Write option ${i.slot + 1} of ${i.count}. The other options are being written at the same time with different approaches, so commit fully to this one:\n${i.family}${avoid}`;
}

// ---------------------------------------------------------------- rosto

export const FACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['description'],
  properties: { description: { type: 'string' } },
} as const;

export const FACE_SYSTEM = `You cast the on-camera person for a short vertical video ad, given the offer brief and the chosen script. Describe that one person so an image model can create a realistic photo of them.

Write one or two sentences, 150-400 characters, in the offer language, covering:
- gender, stated plainly (woman / man, in the offer language), and approximate age;
- a look that the target audience would trust and relate to, matching who the script says is speaking;
- simple everyday clothing and a setting that fits the script;
- that they look straight into the camera, framed from the chest up.

Describe only one person. Do not mention objects in their hands, phones, text, logos or brand names.`;

export function faceUserMessage(o: OfferBriefDraft, script: { angle: string; blocks: { label: string; speech: string; visualPrompt: string }[] }): string {
  const lines = script.blocks.map((b) => `- ${b.label}: "${b.speech}" | visual: ${b.visualPrompt}`);
  return `<brief>\n${briefBlock(o)}\n</brief>\n\n<script angle="${script.angle}">\n${lines.join('\n')}\n</script>\n\nDescribe the person.`;
}
