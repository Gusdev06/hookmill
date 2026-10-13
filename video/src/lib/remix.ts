import { z } from 'zod';

// Template `remix-keep` (§13.6 da feature 2): o vídeo do campeão de fundo, o clipe novo colado nas regiões do rosto
// nos frames exatos e as camadas de texto redesenhadas por cima. Tudo na grade do campeão (mesma largura, altura, fps e
// nº de frames; nada reescalado pra 1080). Props = RemixKeepRenderInput sem renderId/kind/templateId/audioPassthroughUrl
// (o áudio é remuxado depois, com -c:a copy, pelo RenderService).

/** Catálogo fechado de fontes (ids estáveis, = FontId do @maquina/contratos). Arquivos empacotados no bundle (src/fontes.ts). */
export const FONT_CATALOG = {
  'montserrat-800': { family: 'MaquinaMontserrat', weight: 800, label: 'Montserrat ExtraBold' },
  'montserrat-900': { family: 'MaquinaMontserrat', weight: 900, label: 'Montserrat Black' },
  'inter-800': { family: 'MaquinaInter', weight: 800, label: 'Inter ExtraBold' },
  'anton-400': { family: 'MaquinaAnton', weight: 400, label: 'Anton' },
  'oswald-700': { family: 'MaquinaOswald', weight: 700, label: 'Oswald Bold' },
  'bebas-neue-400': { family: 'MaquinaBebasNeue', weight: 400, label: 'Bebas Neue' },
  'archivo-black-400': { family: 'MaquinaArchivoBlack', weight: 400, label: 'Archivo Black' },
  'poppins-800': { family: 'MaquinaPoppins', weight: 800, label: 'Poppins ExtraBold' },
  'roboto-condensed-700': { family: 'MaquinaRobotoCondensed', weight: 700, label: 'Roboto Condensed Bold' },
} as const;
export type FontId = keyof typeof FONT_CATALOG;
export const FONT_IDS = Object.keys(FONT_CATALOG) as [FontId, ...FontId[]];

export const REMIX_COMPOSITION_ID = 'RemixKeep';

export const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });

export const textStyleSchema = z.object({
  fontId: z.enum(FONT_IDS),
  uppercase: z.boolean(),
  fontSizePx: z.number().positive(),
  lineHeight: z.number().positive(),
  color: z.string(),
  highlightColor: z.string().nullable(),
  /** caixa atrás da palavra atual do karaokê (opcional; §13.15, legenda redesenhada com a voz do motor) */
  highlightBackground: z.string().nullable().optional(),
  strokeColor: z.string().nullable(),
  strokeWidthPx: z.number().min(0),
  shadow: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
});

const frameRange = { startFrame: z.number().int().min(0), endFrame: z.number().int().positive() };

export const overlaySchema = z.object({
  ...frameRange,
  region: rectSchema,
  /** URL http(s) assinada; em dev, caminho relativo a public/ */
  clipUrl: z.string().min(1),
  /** instante do clipe que cai no startFrame */
  clipOffsetSec: z.number().min(0),
  /** px do clipe (fitCrop), escalado pra region (mesmo aspecto) */
  crop: rectSchema,
});

export const textLayerSchema = z.object({
  id: z.string(),
  ...frameRange,
  box: rectSchema,
  /** solid/pill: pinta `box` (ou a caixa da camada) antes do texto. `color` = hex ou linear-gradient(...) medido. */
  background: z.object({ kind: z.enum(['solid', 'pill', 'none']), color: z.string().nullable(), box: rectSchema.nullable() }),
  style: textStyleSchema,
  content: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('static'), text: z.string() }),
    z.object({
      kind: z.literal('karaoke'),
      words: z.array(z.object({ word: z.string(), ...frameRange })),
      wordsPerPage: z.number().int().positive(),
    }),
  ]),
});

export const remixKeepSchema = z.object({
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), frameCount: z.number().int().positive() }),
  baseVideoUrl: z.string().min(1),
  overlays: z.array(overlaySchema),
  textLayers: z.array(textLayerSchema),
});

export type RemixKeepProps = z.infer<typeof remixKeepSchema>;
export type RemixOverlay = z.infer<typeof overlaySchema>;
export type RemixTextLayer = z.infer<typeof textLayerSchema>;
export type RemixTextStyle = z.infer<typeof textStyleSchema>;

/** Valida e confere as faixas de frame (end > start, dentro do quadro). */
export const propsDeRemixInput = (input: RemixKeepProps): RemixKeepProps => {
  const p = remixKeepSchema.parse({ canvas: input.canvas, baseVideoUrl: input.baseVideoUrl, overlays: input.overlays, textLayers: input.textLayers });
  const n = p.canvas.frameCount;
  for (const [i, o] of p.overlays.entries()) {
    if (!(o.endFrame > o.startFrame) || o.endFrame > n) throw new Error(`overlay ${i}: frames ${o.startFrame}-${o.endFrame} fora de 0-${n}`);
    const a = o.region.w / o.region.h, b = o.crop.w / o.crop.h;
    if (Math.abs(a - b) / a > 0.02) throw new Error(`overlay ${i}: aspecto do crop (${b.toFixed(3)}) != da região (${a.toFixed(3)})`);
  }
  for (const l of p.textLayers) {
    if (!(l.endFrame > l.startFrame) || l.endFrame > n) throw new Error(`camada ${l.id}: frames ${l.startFrame}-${l.endFrame} fora de 0-${n}`);
  }
  return p;
};

/** Páginas do karaokê: blocos de `wordsPerPage` palavras; cada página fica até a próxima começar (ou até a última palavra acabar). */
export const paginasKaraoke = (words: { word: string; startFrame: number; endFrame: number }[], porPagina: number) => {
  const pags: { startFrame: number; endFrame: number; words: typeof words }[] = [];
  for (let i = 0; i < words.length; i += porPagina) {
    const ws = words.slice(i, i + porPagina);
    pags.push({ startFrame: ws[0].startFrame, endFrame: ws[ws.length - 1].endFrame, words: ws });
  }
  return pags.map((p, i) => ({ ...p, endFrame: pags[i + 1] ? pags[i + 1].startFrame : p.endFrame }));
};
