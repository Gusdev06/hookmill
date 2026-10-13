// Contrato do módulo render (maquina-video). docs/contratos/estrutura.md §2.2 + feature-2-variar-campeao.md §13.6.
// Só o maquina-arquiteto muda o contrato; o backend importa os tipos daqui.
import type { AutoVariationType, EndcardVariant, Rect, TextStyle } from '@maquina/contratos';
import type { ResolvedLayer } from '@maquina/video';

/** Criativo do zero (templates clean/bold/headline). `kind` opcional: ausente = scratch (compatível com o v1). */
export interface ScratchRenderInput {
  kind?: 'scratch';
  renderId: string;
  templateId: string;                                       // registro em @maquina/video
  format: 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';      // 1080x1920 | 1080x1350 | 1080x1080
  fps: 30;
  language: string;
  /** clipStartSec: instante do clipe onde a cena começa (fatia de take, §13.5); padrão 0 */
  scenes: { clipUrl: string; durationSec: number; clipStartSec?: number; words: { word: string; startSec: number; endSec: number }[] }[];
  captionStyle: 'word'|'line'|'off';
  captionPosition: 'top'|'middle'|'bottom';
  headline: string|null;                                    // primeiros 3 s, se o template aceitar
  ctaText: string;
  endCard: boolean;
  /** Editor (editor-v1 §7.1): só as camadas mexidas, já resolvidas pelo `resolverProps` do @maquina/video (posição, tempo
   *  em frames, texto, estilo). Ausente = render de antes do editor. O corte, a ordem e a correção de palavra já vêm
   *  aplicados em `scenes`. */
  layers?: { hook?: ResolvedLayer; caption?: ResolvedLayer; cta?: ResolvedLayer };
}

/** §13.6: edição do campeão mantida. Frames na grade do campeão, [start, end). */
export interface RemixKeepRenderInput {
  renderId: string; templateId: 'remix-keep'; kind: 'remix-keep';
  canvas: { width: number; height: number; fps: number; frameCount: number };  // = campeão (sem reescalar pra 1080)
  baseVideoUrl: string;                                // vídeo do campeão (fundo de tudo)
  audioPassthroughUrl: string;                         // render sai mudo; remux com -c:a copy deste arquivo
  /** §13.15.4 (B) ENGINE_VOICE: áudio = campeão com cada span [start, end) trocado pela voz do arquivo `url` (do instante 0
   *  dele, cortada no tamanho do span), crossfade de `fadeMs` (10) nas bordas, AAC 192 kbps. Ausente = -c:a copy. */
  audioSplice?: { spans: { startFrame: number; endFrame: number; url: string }[]; fadeMs: number };
  overlays: { startFrame: number; endFrame: number; region: Rect;          // [start, end) na grade do campeão
              clipUrl: string; clipOffsetSec: number;                      // instante do clipe no startFrame
              crop: Rect }[];                                              // px do clipe (fitCrop), escalado pra region
  textLayers: { id: string; startFrame: number; endFrame: number; box: Rect;
                /** solid/pill: pinta a caixa inteira antes do texto. color = hex, ou `linear-gradient(...)` CSS quando a
                 *  faixa medida é um degradê (MediaAnalysisService.solidBackground) */
                background: { kind: 'solid' | 'pill' | 'none'; color: string | null; box: Rect | null };
                /** highlightBackground (opcional, §13.15): caixa atrás da palavra atual do karaokê (estilo "palavra na
                 *  pílula roxa"). Ainda não existe no TextStyle do @maquina/contratos: o arquiteto decide se sobe pra lá. */
                style: TextStyle & { highlightBackground?: string | null };
                content: { kind: 'static'; text: string }
                       | { kind: 'karaoke'; words: { word: string; startFrame: number; endFrame: number }[]; wordsPerPage: number } }[];
}

/** variacao-auto-v1 §7.2: peça da variação automática (template `auto-edit`). Composições AutoEdit (vídeo) e
 *  AutoEditStill (PNG, frame 0) do @maquina/video. Montado por `buildAutoEditInput` (./auto-edit.ts). */
export interface AutoEditRenderInput {
  kind: 'auto-edit'; renderId: string; templateId: 'auto-edit';
  output: 'video' | 'still';                                   // still só no STATIC
  format: 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';     // 1080x1920 | 1080x1350 | 1080x1080, 30 fps
  language: string;                                            // dos textos de tela
  source: { videoUrl: string; width: number; height: number; fps: number; durationSec: number; hasAudio: boolean };
  reframe: { mode: 'cover'; focus: { x: number; y: number } }  // corta centrado no rosto (0-1 do quadro)
         | { mode: 'contain_blur' };                           // cabe inteiro, fundo = o próprio vídeo desfocado
  timeline: { startSec: number; endSec: number }[];            // trechos do campeão, em ordem
  joinFadeMs: 40;                                              // rampa de volume em cada emenda (sem clique)
  safeArea: { top: number; bottom: number };                   // px da saída livres da UI do Reels/Stories
  palette: string[];
  brandName: string;
  type: AutoVariationType;
  params: AutoEditParams;
}
export type AutoEditParams =
  | { type: 'CUT'; targetSec: 15 | 20 }
  | { type: 'COLD_OPEN'; teaserSec: number }
  | { type: 'HOOK_TEXT'; text: string; endSec: number; box: Rect; cover: { box: Rect; color: string } | null }
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string | null; ctaText: string; durationSec: 2; background: string }
  | { type: 'SPLIT_LP'; top: { imageUrl: string; kind: 'page' | 'product_photo'; scroll: boolean }; ratio: 0.5 }
  | { type: 'STORY'; handle: string; timeAgo: string; replyLabel: string; bars: 1 | 2 | 3 }
  | { type: 'REVIEW'; quote: string; author: string | null; stars: 1 | 2 | 3 | 4 | 5 | null; ratio: 0.42 }
  | { type: 'NATIVE_SEARCH'; query: string; introSec: number; typingCps: 14; placeholder: string }
  | { type: 'STATIC'; atSec: number; headline: string; box: Rect };

export type RenderInput = ScratchRenderInput | RemixKeepRenderInput | AutoEditRenderInput;
export const isRemixKeep = (i: RenderInput): i is RemixKeepRenderInput => i.kind === 'remix-keep';
export const isAutoEdit = (i: RenderInput): i is AutoEditRenderInput => i.kind === 'auto-edit';

export interface RenderProgress { stage: 'bundling'|'rendering'|'encoding'; progress: number; frame: number; totalFrames: number }
/** auto-edit `output: 'still'`: outputPath = PNG, posterPath = o mesmo PNG, durationSec = 0, mimeType 'image/png'.
 *  mimeType ausente = 'video/mp4' (renders de antes do variacao-auto-v1). */
export interface RenderResult { outputPath: string; posterPath: string; durationSec: number; width: number; height: number; sizeBytes: number; mimeType?: 'video/mp4' | 'image/png' }
export class RenderError extends Error { constructor(public code: 'RENDER_ERROR', public failedFrame: number|null, message: string) { super(message) } }

export interface RenderService {
  /** kind 'remix' (remix-keep) não aparece na escolha de template do criativo do zero. */
  templates(): { id: string; kind: 'scratch' | 'remix'; labelKey: string; thumbnailPath: string; supportsHeadline: boolean }[];
  /** Renderiza um por vez (fila interna com concorrência RENDER_CONCURRENCY). Arquivos em RENDER_TMP_DIR; o backend sobe e apaga.
   *  remix-keep: saída com a largura/altura/fps/nº de frames do campeão e o áudio de audioPassthroughUrl copiado (-c:a copy);
   *  nb_frames conferido (diferente = RENDER_ERROR). */
  render(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult>;
}
