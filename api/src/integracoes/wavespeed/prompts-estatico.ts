// STATIC "anúncio montado" (estatico-montado-e-molduras-v1 §A4, aprovado 25/10). Função pura que monta o prompt do
// GPT Image 2 a partir do spec V2 (textos por bloco já validados pelo backend + conceito visual em inglês + paleta).
// Ordem e linguagem dos blocos = experimento aprovado (sondas/out/estatico-layout-2026-10-25/gerar.ts, 2k aprovado),
// com uma diferença de propósito: NADA aqui é inventado. Cada bloco só entra se o dado veio no spec; a tela do produto
// é a referência (D4, `gpt-image-2/edit`) ou uma interface abstrata sem palavras, nunca uma lista de conteúdo.
// Mitigação do "vólta" (§A6): manuscrito com letras separadas e TEXT CHECKLIST com cada texto exato numa linha.
import type { StaticAspect, StaticEmotion, StaticIcon, StaticImageSpecV2, SubmitStaticImageInput } from '../contrato';
import { buildStaticImagePrompt, languageName, scrubSlop, withoutPeople } from './prompts-midia';

/** O que entra em cada aspecto (§A4, tabela "Por aspecto"). O `copy` salvo é o mesmo; o corte é daqui. */
export interface StaticBlocks {
  brandLine: boolean;
  tagline: boolean;
  subheadline: boolean;
  handwritten: boolean;
  /** pessoa (sem `safe`) */
  hero: boolean;
  device: boolean;
  /** índices de `copy.benefits` que entram */
  benefits: number;
  /** 1:1 = só o título do card */
  compactBenefits: boolean;
  trust: boolean;
  ctaSub: boolean;
  closing: boolean;
}

export function blocosPorAspecto(aspect: StaticAspect, spec: Pick<StaticImageSpecV2, 'copy' | 'visual'>): StaticBlocks {
  const c = spec.copy;
  const has = (t: string | null | undefined) => !!t && t.trim().length > 0;
  const square = aspect === '1:1';
  return {
    brandLine: has(c.brandLine),
    tagline: has(c.tagline) && !square,
    subheadline: has(c.subheadline) && (!square || (c.subheadline ?? '').trim().length <= 45),
    handwritten: has(c.handwritten) && !square,
    hero: spec.visual.hero != null,
    device: spec.visual.product.kind !== 'none',
    benefits: c.benefits.length >= 3 ? Math.min(c.benefits.length, aspect === '9:16' ? 5 : 3) : 0,
    compactBenefits: square,
    trust: c.trust.length === 3 && !square,
    ctaSub: has(c.cta.sub),
    closing: has(c.closing) && aspect === '9:16',
  };
}

/** Desenho de cada ícone em palavras (conjunto fechado; nunca logo). */
export const ICON_WORDS: Record<StaticIcon, string> = {
  moon: 'a crescent moon', sun: 'a simple sun with short rays', clock: 'a round clock face', calendar: 'a small calendar page',
  check: 'a check mark', shield: 'a shield', lock: 'a padlock', heart: 'a heart', star: 'a five-point star', lightning: 'a lightning bolt',
  home: 'a simple house', phone: 'a smartphone outline', chat: 'a speech bubble', chart: 'a small rising bar chart', money: 'a coin',
  gift: 'a gift box', person: 'a single person silhouette', people: 'two person silhouettes', play: 'a play triangle', leaf: 'a leaf',
  target: 'a target with a center dot', book: 'an open book', spark: 'a four-point sparkle', route: 'a winding path ending in a pin',
};

/** Emoção → comportamento físico (regra d dos prompts V2: nunca o adjetivo solto). */
export const EMOTION_EXPRESSION: Record<StaticEmotion, string> = {
  pain: 'a tired but hopeful expression, eyes closed or looking down, brows drawn slightly together, shoulders a little tense',
  relief: 'shoulders dropped and relaxed, eyes softly closed, a slow exhale, a small easy smile',
  desire: 'looking slightly off-frame toward the light, lips softly parted, a quiet hopeful half smile',
  curiosity: 'one eyebrow raised, head tilted slightly, eyes on the device',
  pride: 'chin level, steady eye contact with the camera, a confident closed-mouth smile',
};

const clean = (t: string | null | undefined) => scrubSlop((t ?? '').replace(/\s+/g, ' ').replace(/["“”]/g, '').trim()).replace(/\.$/, '');
/** Texto de tela entre aspas: só troca aspas retas (quebrariam o prompt) e espaços. */
const q = (t: string) => `"${t.replace(/\s+/g, ' ').trim().replace(/"/g, '”')}"`;
const upper = (t: string, lang: string) => {
  try {
    return t.toLocaleUpperCase(lang);
  } catch {
    return t.toUpperCase();
  }
};

/** Tagline em 2 linhas: na fronteira de frase se houver duas; senão na palavra do meio. */
export function twoLines(t: string): [string, string] | [string] {
  const s = t.replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?[.!?])\s+(.+)$/);
  if (m) return [m[1], m[2]];
  const w = s.split(' ');
  if (w.length < 2) return [s];
  const k = Math.ceil(w.length / 2);
  return [w.slice(0, k).join(' '), w.slice(k).join(' ')];
}

export interface StaticPromptOpts {
  /** reenvio depois de SAFETY_BLOCK: sem pessoa; natureza-morta do cenário com a mesma luz */
  safe: boolean;
  /** D4: a 1ª imagem do `edit` é a captura/foto da tela do produto */
  hasScreenRef: boolean;
}

/** Textos que aparecem na imagem neste aspecto (TEXT CHECKLIST e checagem do §A6). Críticos: marca, headline, CTA e
 *  todo texto com número; termos de afirmação o backend acrescenta (léxico dele, `afirmacoes.ts`). */
export function staticTextsFor(spec: StaticImageSpecV2, aspect: StaticAspect): { key: string; text: string; critical: boolean }[] {
  const b = blocosPorAspecto(aspect, spec);
  const c = spec.copy;
  const L = spec.screenLanguage;
  const out: { key: string; text: string; critical: boolean }[] = [];
  const add = (key: string, text: string | null | undefined, critical = false) => {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    if (t) out.push({ key, text: t, critical: critical || /\d/.test(t) });
  };
  add('brand', spec.brandName, true);
  if (b.brandLine) add('brandLine', upper(c.brandLine!, L));
  if (b.tagline) add('tagline', upper(c.tagline!, L));
  add('headline', `${c.headline.lead} ${c.headline.highlight}`, true);
  if (b.subheadline) add('subheadline', c.subheadline);
  if (b.handwritten) add('handwritten', c.handwritten);
  if (b.device && !spec.screenRefUrl && spec.visual.product.screenTitle) add('screenTitle', spec.visual.product.screenTitle);
  c.benefits.slice(0, b.benefits).forEach((x, k) => {
    add(`benefits.${k}.title`, x.title);
    if (!b.compactBenefits) add(`benefits.${k}.line`, x.line);
  });
  if (b.trust) c.trust.forEach((x, k) => add(`trust.${k}`, upper(x.text, L)));
  add('cta.main', upper(c.cta.main, L), true);
  if (b.ctaSub) add('cta.sub', upper(c.cta.sub!, L), true);
  if (b.closing) add('closing', c.closing);
  return out;
}

/**
 * Prompt do STATIC montado (função pura, §A4). Blocos na ordem do experimento aprovado, cada um só se o dado existir
 * (e se couber no aspecto, `blocosPorAspecto`). `safe` tira a pessoa (natureza-morta do cenário, mesma luz).
 */
export function buildStaticImagePromptV2(spec: StaticImageSpecV2, aspect: StaticAspect, opts: StaticPromptOpts): string {
  const b = blocosPorAspecto(aspect, spec);
  const c = spec.copy;
  const v = spec.visual;
  const L = spec.screenLanguage;
  const lang = languageName(L);
  const accent = spec.palette.accent;
  const square = aspect === '1:1';
  const hero = b.hero && !opts.safe ? v.hero : null;
  const cards = c.benefits.slice(0, b.benefits);
  const out: string[] = [];

  // 1. abertura
  out.push(
    `A polished, high-converting ${square ? 'square' : 'vertical'} direct-response ad poster, designed like a premium agency Instagram/Facebook ad. Dense but organized layout, strong visual hierarchy, every text element crisp, legible and spelled exactly as written below in ${lang} with correct accents. Nothing else written anywhere.`,
  );

  // 2. paleta e clima
  // no `safe` a luz também perde trecho com pessoa ("on her face")
  const rawLight = clean(v.hero?.light);
  const light = (opts.safe ? withoutPeople(rawLight) : rawLight) || 'soft warm light glowing from the left';
  const glow = hero || (b.hero && opts.safe) ? 'a soft glow of the same light as the photo' : 'soft warm light glowing from the left';
  out.push(`PALETTE AND MOOD: very dark background in a deep shade of the accent hue (${spec.palette.background}), ${glow}, accents in ${accent}. ${clean(v.mood) || 'intimate and hopeful'}. Subtle film grain.`);

  // 3-4. marca e tagline
  out.push(
    `TOP LEFT: the brand name ${q(spec.brandName)} as a bold white wordmark in typography only, with no symbol, icon or logo next to it${b.brandLine ? `, and below it in small spaced caps ${q(upper(c.brandLine!, L))}` : ''}.`,
  );
  if (b.tagline) {
    const lines = twoLines(upper(c.tagline!, L));
    out.push(`TOP RIGHT: small spaced caps white text ${lines.length === 2 ? `on two lines ${q(lines[0])} / ${q(lines[1])}` : q(lines[0])} with a short ${accent} underline.`);
  }

  // 5-6. headline e sub
  out.push(
    `HEADLINE (huge, bold geometric sans-serif, left aligned, two to three lines): ${q(c.headline.lead)} in white, continuing straight into ${q(c.headline.highlight)} in ${accent}, read as one sentence.`,
  );
  if (b.subheadline) out.push(`SUBHEADLINE below it, medium size, light grey with the last sentence in white: ${q(c.subheadline!)}.`);

  // 7. faixa manuscrita
  if (b.handwritten) {
    out.push(`HANDWRITTEN ACCENT: a ${accent} brush-stroke banner, slightly tilted, with white handwritten script text ${q(c.handwritten!)} written with clearly separated letters, the same letters and accents as written, no extra accent marks, and a small curved underline.`);
  }

  // 8. herói (ou natureza-morta no safe / sem pessoa)
  if (hero) {
    out.push(
      `HERO EMOTION (${cards.length ? 'left edge, partly cropped by the frame' : 'large, partly cropped by the frame edge'}, real and intimate): ${clean(hero.person)}, ${clean(hero.setting)}, ${EMOTION_EXPRESSION[hero.emotion]}, lit by ${clean(hero.light) || light}. Realistic photo, real skin texture, not stock-looking.`,
    );
  } else if (b.hero && opts.safe) {
    const place = withoutPeople(clean(v.hero!.setting));
    out.push(`STILL LIFE (${cards.length ? 'left side' : 'large'}): ${place || 'an everyday setting that fits the mood'}, a few ordinary objects that fit the scene, nobody in the frame, lit by ${light}. Realistic photo, not stock-looking.`);
  }

  // 9. device / produto
  if (b.device) out.push(deviceBlock(spec, opts.hasScreenRef, !!hero || (b.hero && opts.safe), square, opts.safe));

  // 10. cards
  if (cards.length) {
    const where = square ? 'BOTTOM ROW' : 'RIGHT COLUMN';
    const shape = square ? `${cards.length} compact dark rounded cards side by side` : `${cards.length} stacked dark rounded cards with a soft glow border`;
    const desc = square
      ? `each with a ${accent} rounded-square icon and a bold white title`
      : `each with a ${accent} rounded-square icon on the left, a bold white title and a grey one-line description`;
    const rows = cards.map((x, k) => `${k + 1}. icon ${ICON_WORDS[x.icon]}: ${q(x.title)}${square ? '' : ` / ${q(x.line)}`}`);
    out.push(`${where}: ${shape}, ${desc}:\n${rows.join('\n')}`);
  } else if (b.device || hero || b.hero) {
    out.push('No cards: the hero image and the device fill the full width of the middle of the poster.');
  }

  // 11. faixa de confiança
  if (b.trust) {
    const items = c.trust.map((x) => `${ICON_WORDS[x.icon]} icon ${q(upper(x.text, L))}`);
    out.push(`TRUST STRIP above the bottom, three items separated by thin vertical lines, white icons and spaced caps text: ${items.join(', ')}.`);
  }

  // 12. CTA
  out.push(
    `BOTTOM LEFT: a big glossy ${accent} pill-shaped CTA button with a white circle arrow icon on the left and ${b.ctaSub ? `text in two lines ${q(upper(c.cta.main, L))} (large, bold, white) and ${q(upper(c.cta.sub!, L))} (smaller, spaced caps)` : `the text ${q(upper(c.cta.main, L))} (large, bold, white)`}.`,
  );

  // 13. fechamento manuscrito
  if (b.closing) {
    const lines = twoLines(c.closing!);
    out.push(`BOTTOM RIGHT: white handwritten script with clearly separated letters, tilted, ${lines.length === 2 ? `on two lines ${q(lines[0])} / ${q(lines[1])}` : q(lines[0])}, with a ${accent} brush underline.`);
  }

  // 14. margens, proibições, checklist e aspecto
  const margins = aspect === '9:16'
    ? 'Keep the top 5% and the bottom 10% of the frame free of text and buttons, 4% margins on the sides'
    : 'Keep 4% margins on all sides';
  out.push(
    `${margins}; no element cut off except the ${hero ? 'person' : 'photo'} on the edge. No watermarks, no logos other than the wordmark, no extra words, no lorem ipsum, no misspellings.`,
  );
  out.push(`TEXT CHECKLIST (every text on the poster, spelled exactly like this, accents included; nothing else is written anywhere):\n${staticTextsFor(spec, aspect).map((t) => q(t.text)).join('\n')}`);
  out.push(`aspect ratio: ${aspect}`);
  return out.join('\n\n');
}

function deviceBlock(spec: StaticImageSpecV2, hasRef: boolean, withHero: boolean, square: boolean, safe: boolean): string {
  const p = spec.visual.product;
  const where = square ? (withHero ? 'RIGHT HALF, side by side with the photo' : 'CENTER') : withHero ? 'CENTER, overlapping the photo' : 'CENTER, large';
  const look = safe ? withoutPeople(clean(p.look)) : clean(p.look);
  if (p.kind === 'physical_product') {
    return hasRef
      ? `${where}: the product exactly as in the reference image, same shape, colors and label, standing on a soft surface with a gentle shadow.`
      : `${where}: the product${look ? `, ${look}` : ''}, standing on a soft surface with a gentle shadow, no readable label.`;
  }
  const device = p.kind === 'laptop_screen' ? 'a modern laptop mockup, angled slightly' : 'a modern smartphone mockup, tilted slightly';
  if (hasRef) return `${where}: ${device}, its screen showing exactly the screen from the reference image, kept as it is.`;
  const title = p.screenTitle?.trim();
  return `${where}: ${device}, showing an abstract interface in dark mode${look ? ` (${look})` : ''} with shapes, rings and simple icons and no readable words${title ? `; the only words on the screen are the title ${q(title)}` : ''}.`;
}

/** O prompt que vai pro provedor (live e mock usam o mesmo): `specV2` = anúncio montado; sem ele, o builder de 23/10
 *  (photo_headline, ou pôster quando o `visual` veio vazio), intacto (§A5). */
export function staticImagePrompt(i: Pick<SubmitStaticImageInput, 'spec' | 'specV2' | 'aspectRatio' | 'safe'>, hasScreenRef: boolean): string {
  return i.specV2
    ? buildStaticImagePromptV2(i.specV2, i.aspectRatio, { safe: i.safe, hasScreenRef })
    : buildStaticImagePrompt(i.spec, i.aspectRatio, { safe: i.safe });
}
