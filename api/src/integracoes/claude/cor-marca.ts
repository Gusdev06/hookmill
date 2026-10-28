// Cor da marca pela leitura (resultado-v1, 28/10, teste manual A2): a cor de DESTAQUE da página, tirada do que o navegador
// pintou (computed style do fundo dos CTAs) — nunca chutada pelo modelo. Fallback: `<meta name="theme-color">` do HTML.
// Sem cor saturada nos CTAs e sem theme-color = null (o web deixa o campo vazio e a paleta segue derivada).

/** Fundo de um CTA visível como o navegador calculou (`rgb(...)`/`rgba(...)`, ou a 1ª cor de um gradiente). */
export interface CtaColorSample { color: string; area: number }
export interface BrandColorPick { hex: string; source: 'cta' | 'theme_color' }

/** Teto de amostras que o DOM devolve (botões repetidos no rodapé não precisam de mais). */
export const MAX_CTA_SAMPLES = 40;

/** `rgb()/rgba()/#hex` → [r,g,b,a]; null se não entender. */
export function parseCssColor(s: string | null | undefined): [number, number, number, number] | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(v);
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  const rgb = [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))));
  if (rgb.some((x) => !Number.isFinite(x)) || !Number.isFinite(a)) return null;
  return [rgb[0], rgb[1], rgb[2], a];
}

export function toHex([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Saturação e luminosidade HSL (0-1). */
function sl([r, g, b]: readonly number[]): { s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** Cor que serve de destaque: opaca, com cor de verdade (não branco, preto nem cinza). */
export function isAccent(c: readonly number[]): boolean {
  if (c[3] < 0.6) return false;
  const { s, l } = sl(c);
  return s >= 0.25 && l >= 0.12 && l <= 0.88;
}

/**
 * A cor de destaque dos CTAs: agrupa as amostras pela cor (quantizada em passos de 16 pra juntar hover/sombra), soma a
 * área e devolve a média do grupo mais pesado. null quando nenhum CTA tem cor de destaque.
 */
export function pickCtaColor(samples: readonly CtaColorSample[]): string | null {
  const groups = new Map<string, { area: number; sum: [number, number, number] }>();
  for (const s of samples) {
    const c = parseCssColor(s.color);
    if (!c || !isAccent(c) || !(s.area > 0)) continue;
    const key = c.slice(0, 3).map((x) => x >> 4).join(',');
    const g = groups.get(key) ?? { area: 0, sum: [0, 0, 0] };
    g.area += s.area;
    for (let i = 0; i < 3; i++) g.sum[i] += c[i] * s.area;
    groups.set(key, g);
  }
  let best: { area: number; sum: [number, number, number] } | null = null;
  for (const g of groups.values()) if (!best || g.area > best.area) best = g;
  return best ? toHex(best.sum.map((x) => Math.round(x / best!.area))) : null;
}

/** `<meta name="theme-color" content="...">` do HTML (sem `media=` escuro), se for cor de destaque. */
export function themeColorOf(html: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bname\s*=\s*["']?theme-color\b/i.test(tag)) continue;
    if (/\bmedia\s*=\s*["'][^"']*dark/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*([^\s>]+)/i.exec(tag)?.[1];
    const c = parseCssColor(content);
    if (c && isAccent(c)) return toHex(c);
  }
  return null;
}

/** CTA primeiro (o que a página pintou), theme-color depois. */
export function brandColorOf(ctaHex: string | null | undefined, themeHex: string | null | undefined): BrandColorPick | null {
  if (ctaHex) return { hex: ctaHex, source: 'cta' };
  if (themeHex) return { hex: themeHex, source: 'theme_color' };
  return null;
}
