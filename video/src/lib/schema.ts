import { z } from 'zod';
import { FONT_IDS } from './remix';

// Props da composição = RenderInput (contrato §2.2) sem renderId/fps.
// O RenderService converte com propsDeRenderInput().
export const palavraSchema = z.object({
  word: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
});

export const cenaSchema = z.object({
  /** URL http(s) assinada do storage; em dev/fixture, caminho relativo a public/ (ex.: "fixtures/cena-1.mp4"). */
  clipUrl: z.string().min(1),
  durationSec: z.number().positive(),
  /** Instante do clipe onde a cena começa (fatia de um take contínuo, §13.5). Padrão 0. */
  clipStartSec: z.number().min(0).optional(),
  /** Tempos relativos ao início da cena (não do clipe). */
  words: z.array(palavraSchema),
});

/** Editor (editor-v1 §2): posição da camada. Centro em fração do canvas; boxWidth = largura da quebra de linha antes do scale. */
export const layerTransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
  rotationDeg: z.number(),
  boxWidth: z.number().positive(),
});

export const layerStyleSchema = z.object({
  fontId: z.enum(FONT_IDS),
  color: z.string(),
  highlightColor: z.string().nullable(),
  background: z.object({ kind: z.enum(['none', 'box', 'pill', 'word']), color: z.string().nullable() }),
  strokeColor: z.string().nullable(),
  strokeWidthPx: z.number().min(0),
  uppercase: z.boolean(),
  shadow: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
});

/** Camada já resolvida pelo aplicarDoc/resolverProps (editor-v1 §7.1): a composição não sabe o que é doc.
 *  transform null = posição automática de hoje. style: aplicado nos componentes no F2b (hoje ignorado). */
export const resolvedLayerSchema = z.object({
  visible: z.boolean(),
  transform: layerTransformSchema.nullable(),
  fromFrame: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),
  text: z.string().optional(),
  style: layerStyleSchema.optional(),
  fontScalePx: z.number().positive().optional(),
});

export const criativoSchema = z.object({
  templateId: z.enum(['clean', 'bold', 'headline']),
  format: z.enum(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1']),
  language: z.string(),
  scenes: z.array(cenaSchema).min(1),
  captionStyle: z.enum(['word', 'line', 'off']),
  captionPosition: z.enum(['top', 'middle', 'bottom']),
  headline: z.string().nullable(),
  ctaText: z.string(),
  endCard: z.boolean(),
  /** Editor: só as camadas mexidas. Ausente = caminho de hoje (render idêntico ao de antes do editor). */
  layers: z.object({ hook: resolvedLayerSchema.optional(), caption: resolvedLayerSchema.optional(), cta: resolvedLayerSchema.optional() }).optional(),
});

export type CriativoProps = z.infer<typeof criativoSchema>;
export type Palavra = z.infer<typeof palavraSchema>;
export type TemplateId = CriativoProps['templateId'];
export type LayerTransform = z.infer<typeof layerTransformSchema>;
export type LayerStyle = z.infer<typeof layerStyleSchema>;
export type ResolvedLayer = z.infer<typeof resolvedLayerSchema>;
