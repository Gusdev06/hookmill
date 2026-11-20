// Legenda móvel (20/11, spec design/spec-legenda-movel-2026-11-20.md): a NOSSA legenda (captionMode 'replace') das molduras vira a
// camada `caption` do editor. Move só na vertical, 3 tamanhos, 2 cores. Puro (sem React); o resolver, as checagens, a validação e o
// web leem daqui, pra prévia e render baterem.
// Guarda no doc, sem tipo novo: `layers[caption].transform.y` = centro da caixa (fração da altura; x = 0,5, scale 1, boxWidth 1 são
// marcadores fixos); `style.size` | `style.color` | `style.highlightColor`. Posição por formato mora em formatOverrides[fmt].
// Decisão do Gusta (20/11): SEM limite duro de posição. Fora da faixa segura do Reels/TikTok só avisa (caption_off_safe).
import { camadaDoDoc, corHex, finito, geometriaDaCamada } from './comum';
import type { EditDocErrorV3, EditDocV3, FormatCode } from './tipos';

export const CAPTION_LAYER_ID = 'caption';
export type TamanhoLegenda = 'sm' | 'md' | 'lg';
/** Fatores sobre o tamanho padrão da legenda (Pequena / Média / Grande). */
export const LEGENDA_TAMANHOS: Record<TamanhoLegenda, number> = { sm: 0.8, md: 1, lg: 1.23 };
export const LEGENDA_CORES_TEXTO = ['#ffffff', '#ffe14a', '#c8f03c', '#111111'] as const;
export const LEGENDA_CORES_PALAVRA = ['#ffe14a', '#3ddc84', '#ff5fa2', '#4aa8ff', '#ffffff'] as const;
/** Faixa que o app (Reels/TikTok) deixa livre, em fração da altura. Fora dela só avisa. */
export const LEGENDA_FAIXA_SEGURA: Record<FormatCode, { top: number; bottom: number }> = {
  '9x16': { top: 0.1, bottom: 0.82 }, '4x5': { top: 0.06, bottom: 0.94 }, '1x1': { top: 0.06, bottom: 0.94 },
};
/** Marcadores fixos do `transform` da legenda (só o `y` anda). */
export const LEGENDA_TRANSFORM_FIXO = { x: 0.5, scale: 1, rotationDeg: 0, boxWidth: 1 } as const;

const mesmaCor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const naLista = (lista: readonly string[], c: unknown): c is string => typeof c === 'string' && lista.some((x) => mesmaCor(x, c));

/** Contorno que muda sozinho: texto escuro (luminância < 90/255) leva contorno branco, o resto leva preto. */
export const contornoDaCor = (hex: string): '#ffffff' | '#000000' => {
  const m = /^#([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l < 90 ? '#ffffff' : '#000000';
};

/** O que a composição lê (= `captions.edicao`). */
export interface EdicaoLegenda { cy?: number; scale?: number; color?: string; highlight?: string; stroke?: string }

/** Edição da legenda no formato `fmt`: posição do formato, tamanho e cores (valem em todos os formatos). null = nada mexido. */
export const edicaoDaLegenda = (d: EditDocV3 | null | undefined, fmt: FormatCode, principal: FormatCode): EdicaoLegenda | null => {
  if (!d) return null;
  const l = camadaDoDoc(d, CAPTION_LAYER_ID);
  const g = geometriaDaCamada(d, CAPTION_LAYER_ID, fmt, principal).transform;
  const out: EdicaoLegenda = {};
  if (g && finito(g.y)) out.cy = g.y;
  const sz = l?.style?.size;
  if (sz && sz !== 'md' && sz in LEGENDA_TAMANHOS) out.scale = LEGENDA_TAMANHOS[sz];
  const cor = l?.style?.color;
  if (corHex(cor) && naLista(LEGENDA_CORES_TEXTO, cor)) { out.color = cor; out.stroke = contornoDaCor(cor); }
  const hl = l?.style?.highlightColor;
  if (corHex(hl) && naLista(LEGENDA_CORES_PALAVRA, hl)) out.highlight = hl;
  return Object.keys(out).length ? out : null;
};

/** A pessoa mexeu na legenda (posição em algum formato, tamanho ou cor): as checagens novas rodam só aí, o padrão não acusa nada. */
export const legendaEditada = (d: EditDocV3 | null | undefined): boolean =>
  !!d && ((d.layers ?? []).some((l) => l?.id === CAPTION_LAYER_ID && (l.transform || (l.style && Object.keys(l.style).length)))
    || Object.values(d.formatOverrides ?? {}).some((g) => (g?.layers ?? []).some((l) => l?.id === CAPTION_LAYER_ID && l.transform)));

/** Regras do doc pra camada `caption` (o resto — camada conhecida, cor hex, rotação — vem do `validarEstruturaAuto`). `efetivas` = as
 *  cores que a legenda teria com o doc (padrão da peça quando o doc não escolhe). */
export const validarLegendaDoc = (d: EditDocV3 | null | undefined, efetivas?: { color: string; highlight: string }): EditDocErrorV3[] => {
  const erros: EditDocErrorV3[] = [];
  if (!d) return erros;
  const err = (field: string, rule: EditDocErrorV3['rule']) => erros.push({ field, rule });
  const transform = (f: string, t: unknown) => {
    if (t == null) return;
    const q = t as { x: number; y: number; scale: number; boxWidth: number };
    // só o eixo vertical é editável: x, escala e largura são os marcadores fixos
    if (!finito(q.x) || !finito(q.scale) || !finito(q.boxWidth) || Math.abs(q.x - LEGENDA_TRANSFORM_FIXO.x) > 1e-3 || Math.abs(q.scale - 1) > 1e-3 || Math.abs(q.boxWidth - 1) > 1e-3) err(`${f}.transform`, 'not_editable');
    else if (!finito(q.y) || q.y < 0 || q.y > 1) err(`${f}.transform.y`, 'rect_out_of_range');
  };
  (d.layers ?? []).forEach((l, i) => {
    if (l?.id !== CAPTION_LAYER_ID) return;
    const f = `layers[${i}]`;
    transform(f, l.transform);
    if (l.rect != null) err(`${f}.rect`, 'not_editable');
    if (l.style) {
      for (const k of Object.keys(l.style)) if (!['color', 'highlightColor', 'size'].includes(k)) err(`${f}.style.${k}`, 'not_editable');
      if (l.style.size !== undefined && !(l.style.size in LEGENDA_TAMANHOS)) err(`${f}.style.size`, 'bad_template_opt_value');
      if (l.style.color !== undefined && !naLista(LEGENDA_CORES_TEXTO, l.style.color)) err(`${f}.style.color`, 'bad_color');
      if (l.style.highlightColor != null && !naLista(LEGENDA_CORES_PALAVRA, l.style.highlightColor)) err(`${f}.style.highlightColor`, 'bad_color');
      const c = l.style.color ?? efetivas?.color, h = l.style.highlightColor ?? efetivas?.highlight;
      if (c && h && mesmaCor(c, h)) err(`${f}.style.highlightColor`, 'bad_color');
    }
  });
  for (const [fmt, g] of Object.entries(d.formatOverrides ?? {})) {
    (g?.layers ?? []).forEach((l, i) => {
      if (l?.id !== CAPTION_LAYER_ID) return;
      transform(`formatOverrides.${fmt}.layers[${i}]`, l.transform);
      if (l.rect != null) err(`formatOverrides.${fmt}.layers[${i}].rect`, 'not_editable');
    });
  }
  return erros;
};
