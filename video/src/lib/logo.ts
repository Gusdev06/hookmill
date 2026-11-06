// kit-marca-v1 §5 (31/10): logo do kit da marca no lugar das iniciais. Puro (sem React): o schema entra nas props das
// composições (molduras, templates, auto-edit) e a regra da placa é testável sem render.
import { z } from 'zod';

/** Logo da marca já resolvido pela API: URL assinada (ou caminho de public/ no dev) + até 5 cores dominantes do kit
 *  (`brand_assets.colors`; vazio = não deu pra medir). Ausente/null = a composição desenha as iniciais. */
export const brandLogoSchema = z.object({
  url: z.string().min(1),
  colors: z.array(z.string()).max(8).default([]),
});
export type BrandLogo = z.infer<typeof brandLogoSchema>;

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = ([r, g, b]: [number, number, number]) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const razao = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export const PLACA_CLARA = '#FFFFFF';
export const PLACA_ESCURA = '#121214';

/**
 * Placa atrás do logo (o logo pode ser SVG/PNG transparente, desenhado pra fundo claro OU escuro).
 * "Tinta" = a 1ª cor dominante que não é quase branca (o kit põe branco e preto no fim das cores do SVG; um PNG opaco
 * de fundo branco tem o branco como dominante, e a tinta é a cor seguinte). Só branco = logo pra fundo escuro.
 * Placa clara se a tinta contrasta ≥ 2,5:1 com o branco; senão, placa escura. Sem cores medidas = clara (o comum).
 */
export const placaDoLogo = (colors: readonly string[]): string => {
  const cs = colors.map(rgb).filter((c): c is [number, number, number] => !!c);
  if (!cs.length) return PLACA_CLARA;
  const tinta = cs.find((c) => lum(c) < 0.85) ?? cs[0];
  return razao(lum(tinta), 1) >= 2.5 ? PLACA_CLARA : PLACA_ESCURA;
};

/** Respiro do logo dentro da placa (fração do lado). No círculo, o quadrado inscrito é lado/√2: ~15 % de cada lado. */
export const respiroDoLogo = (forma: 'circulo' | 'quadrado') => (forma === 'circulo' ? 0.17 : 0.12);
