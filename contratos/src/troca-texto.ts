// troca-texto-queimado-v1 §15.8 e §16 (F0b, 06/11): headline copiada do criativo, solta ou em caixa. SÓ TIPOS, aditivos.
// Dono: maquina-arquiteto. O FontId do index.ts não muda aqui: api e video indexam FONT_CATALOG por ele, e a união só cresce
// junto do catálogo (fase V1). Até lá, `CopyFontId` é o catálogo da cópia.
import type { FontId, Rect } from './index';

export type CopyFontId = FontId
  | 'montserrat-500' | 'montserrat-600' | 'montserrat-700'
  | 'inter-400' | 'inter-500' | 'inter-600' | 'inter-700'
  | 'poppins-500' | 'poppins-600'
  | 'arimo-400' | 'arimo-500' | 'arimo-600' | 'arimo-700'
  | 'tiktok-sans-400' | 'tiktok-sans-500' | 'tiktok-sans-600' | 'tiktok-sans-700'
  | 'albert-sans-500';

/** O pixel decide (§15.5.2): `box` = molde cp108, imagem 2D parada; `loose` = molde followcatch, placa em vídeo. */
export type HeadlineCopyKind = 'box' | 'loose';

export type HeadlineLookReason = 'no_box' | 'not_measured' | 'box_moves' | 'fades' | 'text_changes' | 'low_contrast'
  | 'font_far' | 'text_not_light' | 'emoji_unsupported' | 'near_caption' | 'over_face' | 'plate_rejected' | 'plate_failed';

export type HeadlineEmphasis =
  | { kind: 'underline'; thicknessPx: number; offsetPx: number; color: string }
  | { kind: 'color'; color: string }
  | { kind: 'box'; color: string };

export type HeadlineFontTier = 'same' | 'close' | 'far';

/** Medida do texto antigo: entra no `editMap`, e a parte `fit` vai ao web. Px na grade do campeão. Frames: [startFrame, endFrame). */
export interface HeadlineLook {
  version: 2;
  kind: HeadlineCopyKind;
  layerId: string;
  startFrame: number; endFrame: number;
  /** só em `box`: a caixa e a imagem parada (§14.2, §16.4). `temporalP99` = desvio temporal no anel, até 25 é aceito */
  box: Rect | null;
  radiusPx: number;
  plate: { color: string; image: string /* data:image/png;base64, ≤ 4 KB */; temporalP99: number; translucent: boolean } | null;
  /** só em `loose`: referência à linha de `champion_plates` */
  plateRef: { kind: 'HEADLINE'; layerKey: string; version: number } | null;
  /** o emoji do original, recortado do próprio quadro (§16.2 A1) */
  emoji: {
    char: string; image: string /* data:image/png;base64 */; x: number; y: number; w: number; h: number;
    lineIndex: number; side: 'start' | 'end'; gapPx: number; marginLeftPx: number; solidity: number;
  } | null;
  text: {
    lines: string[]; textBox: Rect; firstBaselineY: number; linePitchPx: number; sizePx: number; letterSpacingEm: number;
    align: 'left' | 'center' | 'right'; caseStyle: 'upper' | 'sentence' | 'title'; color: string;
    stroke: { color: string; px: number } | null;
    shadow: { dx: number; dy: number; blurPx: number; color: string } | null;
    stemPx: number;
  };
  emphasis: HeadlineEmphasis | null;
  /** `corr` no Chrome e traço ANTES dela (§16.2 A3). `stemErr`, `widthErr` em fração. `measuredIn` nunca é Pillow */
  font: { fontId: CopyFontId; corr: number; stemErr: number; widthErr: number; tier: HeadlineFontTier; measuredIn: 'chrome-linux' | 'chrome-mac' };
  fit: HeadlineFitLook;
  verdict: { ok: boolean; reason: HeadlineLookReason | null; gates: Record<string, number> };
}

/** O que a função pura `ajustarHeadlineCopia` precisa. Vai ao web, sem imagem. */
export interface HeadlineFitLook {
  kind: HeadlineCopyKind;
  canvas: { width: number; height: number };
  fontId: CopyFontId; sizePx: number; letterSpacingEm: number; linePitchPx: number; firstBaselineY: number;
  align: 'left' | 'center' | 'right';
  /** centro único pela mediana dos centros das linhas, emoji incluído (§16.2 A4). null se `align` não for center */
  centerX: number | null;
  caseStyle: 'upper' | 'sentence' | 'title';
  /** contagem e largura de cada linha do original: alvo da IA */
  originalLines: { chars: number; widthPx: number }[];
  /** retângulos do texto apagado, um por linha, sem o emoji. [] em `box`, que não expõe nada */
  erasedRects: Rect[];
  /** último y permitido embaixo (a legenda, com folga); null = sem limite */
  bottomLimitY: number | null;
  /** p95 do queixo no intervalo; null = sem rosto no intervalo (§16.2 A6) */
  chinY: number | null;
  /** margem lateral mínima em px */
  sideMarginPx: number;
  emoji: { widthPx: number; gapPx: number; lineIndex: number; side: 'start' | 'end' } | null;
  box: Rect | null;
}

export type HeadlineFitStep = 'same' | 'rewrap' | 'shrink' | 'grow';
export type HeadlineFitReject = 'too_long' | 'too_short' | 'over_chin';
/** Saída de `ajustarHeadlineCopia(fit, texto)` (video/src/lib), igual em plano, PATCH, build, Player e web. */
export interface HeadlineFitResult {
  fits: boolean;
  step: HeadlineFitStep | null;
  reject: HeadlineFitReject | null;
  lines: string[];
  sizePx: number;
  /** px acrescentados à caixa, só em `box` e `grow` */
  boxGrowPx: number;
  /** y da 1ª linha de base resolvida */
  firstBaselineY: number;
  /** 0-1: fração de `erasedRects` fora do texto novo. 0 em `box` */
  exposure: number;
  /** px do queixo ao topo da tinta nova; null sem rosto */
  chinGapPx: number | null;
}

/** Motivos de `insight.headlineBlocked` e do fit do template, além dos que já existem. */
export type HeadlineBlockedNew = 'headline_near_caption' | 'headline_font_far' | 'headline_plate_rejected' | 'headline_no_fit';

/** Só a lista de razões da legenda entra agora; `CaptionTrack` e o resto da legenda ficam para o F2 (§16.8). */
export type CaptionSwapReason = 'not_detected' | 'no_outline' | 'font_mismatch' | 'style_unstable' | 'no_person' | 'busy_background'
  | 'multi_line' | 'animated' | 'script_unsupported' | 'caption_emoji' | 'too_long' | 'plate_rejected' | 'plate_failed' | 'color_shift';
