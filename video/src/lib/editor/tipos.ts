// Editor universal v1 (docs/contratos/editor-universal-v1.md, 04/11): ESPELHO dos tipos do bloco "editor universal v1" de
// contratos/src/editor.ts (o @maquina/video não depende do @maquina/contratos). Se um mudar, o outro muda junto.
// Só o que o video usa: doc v3, manifesto, layout resolvido, checagens e guarda. Os da API (EditorStateV3, export…) ficam lá.
import type { CaptionWordFix, EditClip, EditDoc, EditDocLayer, LayerId } from '../editor';
import type { LayerTransform } from '../schema';

export type FormatCode = '9x16' | '4x5' | '1x1';
export type RectFracao = { x: number; y: number; w: number; h: number };

// ── §2 qual template ──
export type EditTemplateKey =
  | 'scratch' | 'remix-keep' | 'headline' | `frame:${string}` | `list:${string}` | 'chat-dm' | 'person-motion' | 'static';
export type EditorComposition = 'Criativo' | 'RemixKeep' | 'Moldura' | 'Template' | 'Estatico';

// ── §3 manifesto ──
export type EditLayerKind = 'video' | 'broll' | 'text' | 'box' | 'list' | 'chat' | 'caption' | 'burned';
export interface LayerEditable {
  move: boolean; resize: boolean; rotate: boolean; text: boolean; style: boolean; fill: boolean;
  timing: boolean; hide: boolean; reframe: boolean; trim: boolean;
}
export type EditorLockReasonV3 =
  | 'burnt_no_background' | 'outside_redrawn_interval' | 'remix_reorder_unsupported' | 'remix_scene_trim_unsupported'
  | 'trim_video_not_enabled' | 'remix_editor_not_enabled' | 'burned_caption_pixels' | 'fullscreen_video' | 'audio_only';
export interface LayerDecl {
  id: LayerId;
  kind: EditLayerKind;
  labelKey: string;
  editable: LayerEditable;
  limits: { maxChars: number | null; maxLines: number | null; minFontPx: number | null } | null;
  optional: boolean;
  lockedReason: EditorLockReasonV3 | null;
  leavesEmptyCover: boolean;
  /** só na camada `video` (F-U2): limites do caixa/enquadramento/aparar */
  video?: VideoLayerLimits;
}
/** Limites da camada de vídeo do cliente que o painel e os sliders usam. */
export interface VideoLayerLimits {
  zoomMin: number; zoomMax: number; panAbsMax: number;
  /** w e h mínimos da caixa (fração do canvas) */
  minBoxFrac: number;
  minTrimSec: number;
  /** segundos do arquivo em que o aparar pode ir */
  trimMinSec: number; trimMaxSec: number;
  fits: VideoFraming['fit'][];
}
export type ControlGroup = 'appearance' | 'position' | 'format' | 'content' | 'guides' | (string & {});
export interface ControlOption { value: string; labelKey: string }
export type ControlDecl =
  | { type: 'segmented'; group: ControlGroup; key: string; labelKey: string; options: ControlOption[]; relayout: boolean }
  | { type: 'toggle'; group: ControlGroup; key: string; labelKey: string; relayout: boolean }
  | { type: 'color'; group: ControlGroup; key: string; labelKey: string; from: 'workspace' | 'template' }
  | { type: 'format'; group: 'format'; formats: FormatCode[] }
  | { type: 'rows'; group: 'content'; layers: LayerId[]; itemsOf: LayerId | null; timed: boolean }
  | { type: 'messages'; group: 'content'; layer: LayerId }
  | { type: 'words'; group: 'content'; layer: LayerId }
  | { type: 'clips'; group: ControlGroup; groupLabelKey: string; layer: LayerId }
  | { type: 'guides'; group: 'guides' };
export type TemplateOptValue = string | boolean;
export type TemplateOpts = Record<string, TemplateOptValue>;
export interface EditManifest {
  manifestVersion: 1;
  templateKey: EditTemplateKey;
  formats: FormatCode[];
  layers: LayerDecl[];
  controls: ControlDecl[];
  defaults: TemplateOpts;
  clientImage: boolean;
}

// ── §4 EditDoc v3 ──
export interface EditDocLayerV3 extends EditDocLayer { rect?: RectFracao | null; fill?: string | null }
export interface VideoFraming { fit: 'cover' | 'contain_blur'; zoom: number; panX: number; panY: number }
export interface VideoEdit { layerId: LayerId; framing?: VideoFraming | null; box?: RectFracao | null; trim?: { inSec: number; outSec: number } | null }
export interface ItemEdit { id: string; text?: string; atSec?: number; side?: 'me' | 'them' }
export interface ClipSwap { clipId: string; fileId: string }
export interface TextConfirmation { path: string; numbers: string[]; byUserId: string; at: string }
export interface FormatGeometry {
  layers: { id: LayerId; transform?: LayerTransform | null; rect?: RectFracao | null }[];
  video?: Pick<VideoEdit, 'framing' | 'box'> | null;
}
export interface EditDocV3 {
  version: 3;
  clips: EditClip[];
  trim: null;
  layers: EditDocLayerV3[];
  captionWords: CaptionWordFix[];
  templateOpts?: TemplateOpts;
  video?: VideoEdit | null;
  items?: Record<LayerId, ItemEdit[]>;
  clipSwaps?: ClipSwap[];
  confirmations?: TextConfirmation[];
  formatOverrides?: Partial<Record<FormatCode, FormatGeometry>>;
}
export type AnyEditDoc = EditDoc | EditDocV3;

/** Limites do §4 (= EditDocLimitsV3 do contrato). */
export const LIMITES_DOC_V3 = {
  layers: 50, captionWords: 2000, textChars: 300, docBytes: 65536, minClipSec: 0.3, minVideoSec: 1,
  itemsPerLayer: 40, clipSwaps: 20, confirmations: 50, zoomMin: 0.5, zoomMax: 3, panAbsMax: 1, minTrimSec: 1, minBoxFrac: 0.1,
} as const;

// ── §5 layout resolvido e checagens ──
export interface EditLayoutLayer {
  id: LayerId; kind: EditLayerKind;
  rect: RectFracao; rotationDeg: number;
  fromSec: number; toSec: number; visible: boolean;
  text: string | null; fontPx: number | null;
}
export interface EditLayout {
  format: FormatCode;
  canvas: { width: number; height: number };
  durationSec: number;
  layers: EditLayoutLayer[];
  video: {
    layerId: LayerId; box: RectFracao; sourceRect: RectFracao; fit: VideoFraming['fit']; auto: boolean; trim: { inSec: number; outSec: number };
    /** caixa ∩ canvas ∩ área útil do vídeo: o que de fato aparece */
    visibleRect: RectFracao;
    /** valores atuais, mesmo no auto (sliders e ponto de partida do arrasto) */
    framing: VideoFraming;
    /** o doc mexeu na caixa ou no enquadramento: só aí rodam caption_cut e face_cut */
    edited: boolean;
    /** false = legenda queimada recortada, a nossa no lugar (captionMode 'replace'): regras de legenda não valem */
    checksCaption: boolean;
  } | null;
}
export type EditIssueRule =
  | 'caption_covered' | 'face_covered' | 'caption_cut' | 'face_cut' | 'text_overflow' | 'too_long'
  | 'invented_number' | 'low_contrast' | 'item_out_of_range' | 'no_client_image';
export type EditIssueLevel = 'block' | 'confirm' | 'warn' | 'info';
export interface EditIssue {
  rule: EditIssueRule;
  level: EditIssueLevel;
  layerId: LayerId | null;
  itemId: string | null;
  format: FormatCode;
  atSec: number | null;
  detail: { numbers?: string[]; coveredPct?: number; visiblePct?: number; chars?: number; maxChars?: number; fontPx?: number; minFontPx?: number } | null;
}
export type EditDocRuleV3 =
  | 'unknown_scene' | 'clips_must_cover_scenes' | 'no_enabled_clip' | 'trim_out_of_range' | 'clip_too_short'
  | 'video_too_short' | 'unknown_layer' | 'bad_color' | 'unknown_font' | 'doc_too_large' | 'unknown_word'
  | 'unknown_template_opt' | 'bad_template_opt_value' | 'unknown_item' | 'item_time_out_of_range' | 'too_many_items'
  | 'unknown_clip' | 'unknown_clip_alternative' | 'rect_out_of_range' | 'video_box_out_of_canvas' | 'video_zoom_out_of_range'
  | 'video_pan_out_of_range' | 'trim_too_short' | 'format_not_supported' | 'not_editable' | 'bad_confirmation';
export interface EditDocErrorV3 { field: string; rule: EditDocRuleV3 }

/** O que as regras de rosto/legenda precisam, no espaço do arquivo do cliente (px). */
export interface EditorGuard {
  source: { width: number; height: number; fps: number };
  protectedBands: { x: number; y: number; w: number; h: number; startSec: number; endSec: number }[];
  /** só `role` 'main' (ou ausente) conta */
  faceTrack: { startFrame: number; endFrame: number; region: RectFracao; faceInRegion: { atFrame: number; box: RectFracao }[]; role?: string }[];
}
export interface EditorFacts { numbers: string[] }

/** Texto checável de uma peça (o resolver devolve junto do layout): caminho da confirmação, limites e o que coube. */
export interface TextoEditor {
  /** 'layer:<id>' ou 'item:<layerId>/<itemId>' (= TextConfirmation.path) */
  path: string;
  layerId: LayerId;
  itemId: string | null;
  /** texto final (com a marcação *destaque*) */
  text: string;
  /** o doc mudou este texto (só texto editado passa pela regra de número) */
  edited: boolean;
  maxChars: number | null;
  minFontPx: number | null;
  /** tamanho que coube (px do canvas) já com a escala da camada; null = sem medida */
  fontPx: number | null;
  /** fitText coube no piso */
  fits: boolean;
  /** cor do texto × cor do fundo (só onde a peça deixa mudar as duas; ex. HEADLINE) */
  contrast: { color: string; background: string } | null;
}

/** Saída de todo resolver do editor universal (§5): props da composição + geometria final (+ textos pras checagens). */
export interface ResolvidoEditor<P> { props: P; layout: EditLayout; textos: TextoEditor[] }
export interface CtxResolver {
  /** formato que está sendo resolvido */
  format: FormatCode;
  /** formato principal da peça (manifest.formats[0]); padrão '9x16' */
  principal?: FormatCode;
}
