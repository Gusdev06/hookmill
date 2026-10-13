// Formatos de saída (contrato §2.2): 1080x1920 | 1080x1350 | 1080x1080, 30 fps.
export type VideoFormat = 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';

export const FPS = 30 as const;

export const FORMATOS: Record<VideoFormat, { width: number; height: number }> = {
  VERTICAL_9_16: { width: 1080, height: 1920 },
  PORTRAIT_4_5: { width: 1080, height: 1350 },
  SQUARE_1_1: { width: 1080, height: 1080 },
};

/** Duração do end card, em segundos (só quando endCard = true). */
export const END_CARD_SEC = 2.5;
/** Janela do gancho escrito (headline) no começo do vídeo. */
export const GANCHO_SEC = 3;
/** Janela do CTA sobre a fala, contada a partir do fim das cenas. */
export const CTA_SEC = 3;

/** Opções de render medidas em docs/render.md (o RenderService usa estas; o CLI usa remotion.config.ts). */
export const RENDER_PADRAO = {
  codec: 'h264',
  imageFormat: 'jpeg',
  pixelFormat: 'yuv420p',
  concurrency: 1,
  offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
} as const;

/**
 * remix-keep: fora da região a peça tem que ser o campeão (QA: PSNR RGB ≥ 40 dB em todo frame). Pelo navegador inteiro
 * não chega (35,8 dB RGB no zap mesmo com png/crf 12): fora da máscara a peça é o campeão decodificado. docs/render.md.
 */
export const RENDER_REMIX = { imageFormat: 'png', crf: 10, colorSpace: 'bt709', crfFinal: 12 } as const;
// crf = o vídeo intermediário do Remotion (só a região/caixas saem dele); crfFinal = a peça, composta sobre o campeão
// decodificado com máscara (RenderService.comporSobreOCampeao).
