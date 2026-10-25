// Paleta do STATIC "anúncio montado" (estatico-montado-e-molduras-v1 §A3.3). PURO, testado em paleta.spec.ts.
// A IA não escolhe hex: accent = Workspace.brandColor › cor saturada dominante da captura da página › cor mais saturada do
// measurements.palette do campeão › #FF8A3D. background = o accent escurecido no mesmo matiz (L ≈ 8-12 %), com contraste do
// texto branco ≥ 7:1 garantido (escurece mais se precisar).

export const DEFAULT_ACCENT = '#FF8A3D';
/** Cor "saturada" o bastante pra ser acento: S ≥ 0,35 e L entre 0,2 e 0,85 (nem preto, nem branco, nem cinza). */
export const MIN_ACCENT_SATURATION = 0.35;
export const MIN_WHITE_CONTRAST = 7;
const BG_LIGHTNESS = 0.1;

export type PaletteSource = 'brand' | 'page' | 'champion' | 'default';
export interface StaticPalette { background: string; accent: string; source: PaletteSource }

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#RGB`/`#RRGGBB` (com ou sem #) → `#RRGGBB` maiúsculo; inválido = null. */
export function normalizeHex(s: string | null | undefined): string | null {
  const m = (s ?? '').trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

function rgbOf(hex: string): [number, number, number] {
  const h = normalizeHex(hex)!.slice(1);
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function hslOf(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hexOfHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** Luminância relativa (WCAG 2.x). */
export function luminance(hex: string): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgbOf(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const isAccent = (hex: string) => {
  const { s, l } = hslOf(hex);
  return s >= MIN_ACCENT_SATURATION && l >= 0.2 && l <= 0.85;
};

/** A dominante saturada: a 1ª da lista (ordem de dominância) que serve de acento. */
export function dominantSaturated(colors: (string | null | undefined)[] | null | undefined): string | null {
  for (const c of colors ?? []) {
    const h = normalizeHex(c);
    if (h && isAccent(h)) return h;
  }
  return null;
}

/** A mais saturada da lista (que serve de acento). */
export function mostSaturated(colors: (string | null | undefined)[] | null | undefined): string | null {
  let best: string | null = null;
  let bestS = -1;
  for (const c of colors ?? []) {
    const h = normalizeHex(c);
    if (!h || !isAccent(h)) continue;
    const { s } = hslOf(h);
    if (s > bestS) [best, bestS] = [h, s];
  }
  return best;
}

/** Fundo = acento no mesmo matiz com L ≈ 10 % (saturação contida); escurece até o branco dar ≥ 7:1. */
export function darkBackgroundOf(accent: string): string {
  const { h, s } = hslOf(accent);
  const sat = Math.min(s, 0.6);
  for (let l = BG_LIGHTNESS; l >= 0; l -= 0.01) {
    const bg = hexOfHsl(h, sat, Math.max(0, l));
    if (contrastRatio('#FFFFFF', bg) >= MIN_WHITE_CONTRAST) return bg;
  }
  return '#000000';
}

/**
 * §A3.3: `brandColor` (o do cadastro vale mesmo pouco saturado: é a marca), senão a dominante saturada da página, senão a
 * mais saturada do campeão, senão o padrão.
 */
export function paletaDoEstatico(i: {
  brandColor?: string | null;
  pageColors?: (string | null | undefined)[] | null;
  championPalette?: (string | null | undefined)[] | null;
}): StaticPalette {
  const brand = normalizeHex(i.brandColor);
  const page = brand ? null : dominantSaturated(i.pageColors);
  const champ = brand || page ? null : mostSaturated(i.championPalette);
  const accent = brand ?? page ?? champ ?? DEFAULT_ACCENT;
  const source: PaletteSource = brand ? 'brand' : page ? 'page' : champ ? 'champion' : 'default';
  return { accent, background: darkBackgroundOf(accent), source };
}
