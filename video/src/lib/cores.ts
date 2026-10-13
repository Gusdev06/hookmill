// Cores a partir da paleta medida do campeão (hex). Puro: serve pro template e pro buildAutoEditInput da API.

const hexRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = ([r, g, b]: [number, number, number]) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const sat = ([r, g, b]: [number, number, number]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const razao = (a: [number, number, number], b: [number, number, number]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Texto legível sobre `fundo`: branco ou quase preto. */
export const contraste = (fundo: string) => { const c = hexRgb(fundo); return c && lum(c) > 0.4 ? '#111111' : '#ffffff'; };

/** Cor mais saturada da paleta que contrasta com o fundo (≥ 2,2:1); sem nenhuma, um azul neutro. */
export const corDeDestaque = (palette: string[], fundo: string): string => {
  const f = hexRgb(fundo) ?? [0, 0, 0];
  const ok = palette.map((h) => ({ h, c: hexRgb(h) })).filter((x): x is { h: string; c: [number, number, number] } => !!x.c && sat(x.c) > 0.35 && razao(x.c, f) >= 2.2);
  ok.sort((a, b) => sat(b.c) - sat(a.c));
  return ok[0]?.h ?? (lum(f) > 0.4 ? '#1a56db' : '#ffd400');
};

/** A cor mais escura da paleta (fundo do end card), escurecida se ainda for clara demais pro texto branco. */
export const corEscura = (palette: string[]): string => {
  const cs = palette.map((h) => ({ h, c: hexRgb(h) })).filter((x): x is { h: string; c: [number, number, number] } => !!x.c);
  cs.sort((a, b) => lum(a.c) - lum(b.c));
  const e = cs[0];
  if (!e) return '#111111';
  if (lum(e.c) <= 0.06) return e.h;
  const k = Math.sqrt(0.06 / lum(e.c));
  return '#' + e.c.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('');
};

/** Fundo claro levemente tingido pela paleta (cartão do REVIEW, fundo da foto do produto). */
export const corClara = (palette: string[]): string => {
  const d = hexRgb(corDeDestaque(palette, '#ffffff')) ?? [200, 200, 200];
  return '#' + d.map((v) => Math.round(v * 0.1 + 255 * 0.9).toString(16).padStart(2, '0')).join('');
};
