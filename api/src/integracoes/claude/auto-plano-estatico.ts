// STATIC "anúncio montado" no planAutoBatch (estatico-montado-e-molduras-v1 §A2/§A3, aprovado 25/10): pedaço do esquema,
// regras do prompt e leitura da saída. Cada texto de tela vem separado e com a FONTE no Brain; bloco sem dado vem vazio e
// some do layout. Aqui só FORMA (limites, enums, contagens 0/3-5 e 0/3, sentinelas → null); a regra "nada inventado"
// (invented_number, invented_claim, unsupported_source) é do backend (iteracao/regras.ts) e volta como `violations`.
import type { BriefField, CopySource, StaticCopy, StaticEmotion, StaticIcon, StaticVisualV2 } from '../contrato';

export const STATIC_ICONS: StaticIcon[] = [
  'moon', 'sun', 'clock', 'calendar', 'check', 'shield', 'lock', 'heart', 'star', 'lightning',
  'home', 'phone', 'chat', 'chart', 'money', 'gift', 'person', 'people', 'play', 'leaf',
  'target', 'book', 'spark', 'route',
];
export const STATIC_EMOTIONS: StaticEmotion[] = ['pain', 'relief', 'desire', 'curiosity', 'pride'];
export const BRIEF_FIELDS: BriefField[] = ['name', 'kind', 'what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'];
export const COPY_SOURCES: CopySource[] = [...BRIEF_FIELDS, 'transcript', 'generic'];
export const PRODUCT_KINDS: StaticVisualV2['product']['kind'][] = ['phone_screen', 'laptop_screen', 'physical_product', 'none'];

/** Limites do §A2 (caracteres; `*Words` = palavras). */
export const STATIC_V2_LIMITS = {
  brandLine: 32, tagline: 32, lead: 45, highlight: 22, headlineSum: 60, subheadline: 90,
  handwritten: 28, handwrittenWords: 5, benefitTitle: 24, benefitLine: 40, trust: 24, ctaMain: 18, ctaSub: 22,
  closing: 50, closingWords: 9, person: 200, setting: 160, light: 80, look: 200, screenTitle: 24, mood: 100,
  benefitsMin: 3, benefitsMax: 5, trustCount: 3, copyTotal: 420,
} as const;

const str = (description: string) => ({ type: 'string', description });
const arr = (items: object, description: string) => ({ type: 'array', items, description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});
// Bug live 25/10 ("compiled grammar is too large"): enums dentro do item multiplicam a gramática. Fonte, ícone, emoção e
// tipo de produto vão como string com os valores na descrição; o parser já aceita só os valores válidos (sourceOf/iconOf…).
const one = (values: readonly string[]) => `One of: ${values.join(', ')}.`;
const SRC = (what: string) => str(`Source of ${what}: the Brain field it rests on, "transcript" (the champion's speech) or "generic" (only where the rules allow it); "none" when the text is empty. ${one(COPY_SOURCES)}`);

/** `copy` do STATIC (§A2), no idioma da tela. */
export const STATIC_COPY_SCHEMA = obj({
  brandLine: str('STATIC only, max 32: small line under the brand name saying what the offer is. Empty if there is no data.'),
  brandLineSource: SRC('brandLine'),
  tagline: str('STATIC only, max 32: top-right line, at most two very short sentences. Empty to leave the corner empty.'),
  headline: obj({
    lead: str('STATIC only, max 45: the first part of the headline, talking to the viewer in second person.'),
    highlight: str('STATIC only, max 22: the strongest end of the same sentence (shown in the accent color). Lead + highlight max 60.'),
  }, 'STATIC only: the headline split in two. Empty strings for other types.'),
  headlineSource: str('STATIC only: promise, pains or transcript. Never generic. "none" for other types.'),
  subheadline: str('STATIC only, max 90: 2-3 short sentences. Empty if there is no data.'),
  subheadlineSource: SRC('subheadline'),
  handwritten: str('STATIC only, max 28 characters and 5 words: an emotional handwritten line. Empty to drop it.'),
  benefits: arr(obj({
    icon: str(`A neutral icon that fits the card. ${one(STATIC_ICONS)}`),
    title: str('Max 24.'),
    line: str('Max 40, one line.'),
    source: str('Brain field it summarizes: what, promise, pains, proof or offerAndPrice.'),
  }), 'STATIC only: 0 or 3-5 benefit cards that summarize the Brain. Empty list when there is no data for 3.'),
  trust: arr(obj({
    icon: str('A neutral icon, same list as the benefit cards.'),
    text: str('Max 24, shown in caps.'),
    source: str('Brain field: proof, offerAndPrice, what or notes.'),
  }), 'STATIC only: 0 or exactly 3 trust items. Empty list when there is no data for 3.'),
  cta: obj({
    main: str('STATIC only, max 18: button text. From the Brain CTA when it exists, else a plain action verb with no promise.'),
    sub: str('STATIC only, max 22: smaller second line of the button, only from offerAndPrice or cta. Empty otherwise.'),
    subSource: SRC('cta.sub'),
  }, 'STATIC only: the CTA button. Empty strings for other types.'),
  closing: str('STATIC only, max 50 characters and 9 words: handwritten closing line in two parts. Empty to drop it.'),
}, 'STATIC only: every on-screen text of the assembled ad, in the screen language. Empty values for other types.');

/** `visualV2` do STATIC (§A2), em inglês. */
export const STATIC_VISUAL_V2_SCHEMA = obj({
  hero: obj({
    person: str('STATIC only, English, max 200: one generic person (approximate age, manner, plain clothes). Empty when no person fits.'),
    setting: str('STATIC only, English, max 160: where they are and what they do, concrete and physical, no text or signs.'),
    emotion: str(`STATIC only: the one emotion of the hero, "none" when there is no person. ${one(STATIC_EMOTIONS)}`),
    light: str('STATIC only, English, max 80: one named light source (for example "warm bedside lamp light from the left").'),
  }, 'STATIC only: the hero photo. Empty strings and "none" when there is no person or for other types.'),
  product: obj({
    kind: str('STATIC only: phone_screen or laptop_screen (app, course, digital product), physical_product, or none.'),
    look: str('STATIC only, English, max 200: how the device or product looks, with no readable text, no brand and no list of content. Empty for none.'),
    screenTitle: str('STATIC only, screen language, max 24: the only words inside the screen, from what, name or kind. Empty otherwise.'),
    screenTitleSource: SRC('screenTitle'),
  }, 'STATIC only: the product shown. kind "none" for other types.'),
  mood: str('STATIC only, English, max 100: the overall mood (for example "intimate, hopeful, late evening"). Empty for other types.'),
}, 'STATIC only: visual concept of the assembled ad, in English. Empty values for other types.');

export const STATIC_V2_RULES = `STATIC assembled ads:
- A STATIC is a NEW single-image ad, created from scratch by an image model (never a frame of the video), laid out as an assembled direct-response poster: the brand wordmark, an optional brand line and tagline, a big headline whose last part is highlighted, an optional subheadline, an optional handwritten accent, a hero photo with one emotion, the product (phone or laptop screen, or a physical product), 3-5 benefit cards, a 3-item trust strip, a CTA button and an optional handwritten closing. You write every on-screen text separately, each with its source; the image writes exactly these texts and nothing else.
- Nothing invented, block by block: each text rests on a Brain field (its source names that field) or on the transcript ("transcript"). "generic" is allowed only for tagline, handwritten, CTA main and closing, and only for a line with no claim at all: no number, price, time span, percentage, free/trial, guarantee/refund, discount, platform or app store, expert/doctor/study/certified, "#1"/best, risk-free. No data for a block = leave it empty (empty string, empty list, "none") and the layout drops it. Never fill a block with a generic promise.
- Never write the brand name in any text: the system adds the wordmark. No other brand, logo or company name anywhere.
- headline: talks to the viewer in second person in the screen language ("Você…", "You…", "Tú…") and names a pain or a desire from the Brain. lead max 45, highlight max 22, together max 60; the highlight is the end of the same sentence, its strongest part. Source promise, pains or transcript, never generic.
- brandLine max 32: what the offer is (source what, kind or promise). tagline max 32: at most two very short sentences. subheadline max 90: 2-3 short sentences (what, promise, proof, offerAndPrice or transcript). handwritten max 28 characters and 5 words. closing max 50 characters and 9 words.
- benefits: 0 or 3-5 cards (title max 24, line max 40) that summarize the Brain (what, promise, pains, proof, offerAndPrice), never a feature you imagine. Not enough data for 3 = empty list.
- trust: 0 or exactly 3 items (max 24 each) from proof, offerAndPrice, what or notes. Not enough data for 3 = empty list.
- cta.main max 18: the Brain CTA when it exists, otherwise a plain action verb with no promise ("Comece hoje", "Learn more"). cta.sub max 22 only from offerAndPrice or cta (for example a trial written there), else empty.
- All on-screen texts of one STATIC together: max 420 characters.
- visualV2, in English, with no text, quotation marks, brand, logo, app or product name and no named niche. hero: one generic person (approximate age, manner, plain clothes; never a celebrity, a name, a uniform with a name, or the person from the video), the setting, one named light source and one emotion. The emotion follows the why line the piece attacks: hook → pain or curiosity, proof → relief or pride, cta → desire. Leave person empty when a person does not fit the offer.
- product: phone_screen or laptop_screen for an app, course or digital product; physical_product for a physical item; none otherwise. look describes the device or the product without readable text and never as a list of content (the screen is either a capture of the real page or an abstract interface). screenTitle only from what, name or kind, else empty.
- The key frames attached to the request are REFERENCE only: borrow the kind of person (generic), the setting, the palette and the proof moment. Never copy a frame, never describe the real person from the video.
- Two STATIC pieces in the same batch need different emotions and different headlines.
- The "change" line describes the concept in the interface language, for example "Assembled ad: relief, a person on the edge of the bed".`;

// ---------------------------------------------------------------- leitura

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Corta em fronteira de palavra (mesma regra do `clip` do auto-plano; repetido pra não criar ciclo de import). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const c = text.slice(0, max + 1);
  const sp = c.lastIndexOf(' ');
  return (sp > max * 0.5 ? c.slice(0, sp) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}
const orNull = (v: unknown, max: number): string | null => {
  const t = cut(s(v), max);
  return t ? t : null;
};
export function sourceOf(v: unknown): CopySource | null {
  const x = s(v) as CopySource;
  return COPY_SOURCES.includes(x) ? x : null;
}
const iconOf = (v: unknown): StaticIcon => STATIC_ICONS.find((x) => x === s(v)) ?? 'check';

/** `copy` do STATIC (só forma). Texto vazio = null e a fonte também; fonte inválida num texto que existe = 'generic'
 *  (o backend cobra `unsupported_source` onde 'generic' não pode). Contagens fora de 0/3-5 e 0/3 = bloco vazio. */
export function staticCopyOf(raw: unknown): StaticCopy {
  const c = o(raw);
  const L = STATIC_V2_LIMITS;
  const withSource = (text: string | null, src: unknown) => (text ? sourceOf(src) ?? 'generic' : null);
  const brandLine = orNull(c.brandLine, L.brandLine);
  const subheadline = orNull(c.subheadline, L.subheadline);
  const hw = orNull(c.handwritten, L.handwritten);
  const closing = orNull(c.closing, L.closing);
  const h = o(c.headline);
  const cta = o(c.cta);
  const ctaSub = orNull(cta.sub, L.ctaSub);

  const benefits = a(c.benefits).map(o)
    .map((b) => ({ icon: iconOf(b.icon), title: cut(s(b.title), L.benefitTitle), line: cut(s(b.line), L.benefitLine), source: sourceOf(b.source) }))
    .filter((b): b is StaticCopy['benefits'][number] => !!b.title && !!b.line && b.source !== null)
    .slice(0, L.benefitsMax);
  const trust = a(c.trust).map(o)
    .map((t) => ({ icon: iconOf(t.icon), text: cut(s(t.text), L.trust), source: sourceOf(t.source) }))
    .filter((t): t is StaticCopy['trust'][number] => !!t.text && t.source !== null)
    .slice(0, L.trustCount);

  return {
    brandLine, brandLineSource: withSource(brandLine, c.brandLineSource),
    tagline: orNull(c.tagline, L.tagline),
    headline: { lead: cut(s(h.lead), L.lead), highlight: cut(s(h.highlight), L.highlight) },
    headlineSource: sourceOf(c.headlineSource) ?? 'generic',
    subheadline, subheadlineSource: withSource(subheadline, c.subheadlineSource),
    handwritten: hw && words(hw) <= L.handwrittenWords ? hw : null,
    benefits: benefits.length >= L.benefitsMin ? benefits : [],
    trust: trust.length === L.trustCount ? trust : [],
    cta: { main: cut(s(cta.main), L.ctaMain), sub: ctaSub, subSource: withSource(ctaSub, cta.subSource) },
    closing: closing && words(closing) <= L.closingWords ? closing : null,
  };
}

/** `visualV2` do STATIC (só forma). Pessoa vazia ou emoção 'none' = sem herói. */
export function staticVisualV2Of(raw: unknown): StaticVisualV2 {
  const v = o(raw);
  const L = STATIC_V2_LIMITS;
  const h = o(v.hero);
  const p = o(v.product);
  const person = cut(s(h.person), L.person);
  const emotion = STATIC_EMOTIONS.find((x) => x === s(h.emotion));
  const kind = PRODUCT_KINDS.find((x) => x === s(p.kind)) ?? 'none';
  const screenTitle = kind === 'phone_screen' || kind === 'laptop_screen' ? orNull(p.screenTitle, L.screenTitle) : null;
  return {
    hero: person && emotion ? { person, setting: cut(s(h.setting), L.setting), emotion, light: cut(s(h.light), L.light) } : null,
    product: {
      kind,
      look: kind === 'none' ? null : orNull(p.look, L.look),
      screenTitle,
      screenTitleSource: screenTitle ? sourceOf(p.screenTitleSource) ?? 'generic' : null,
    },
    mood: cut(s(v.mood), L.mood),
  };
}

/** Soma dos textos de tela (o limite de 420 é cobrado pelo backend; aqui serve ao fake e aos testes). */
export function staticCopyLength(c: StaticCopy): number {
  const parts = [c.brandLine, c.tagline, c.headline.lead, c.headline.highlight, c.subheadline, c.handwritten, c.cta.main, c.cta.sub, c.closing,
    ...c.benefits.flatMap((b) => [b.title, b.line]), ...c.trust.map((t) => t.text)];
  return parts.reduce((n, t) => n + (t ?? '').length, 0);
}
