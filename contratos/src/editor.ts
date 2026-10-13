// Editor no vídeo v1 (docs/contratos/editor-v1.md, APROVADO 09/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Espelhos em video/src/lib/editor.ts e video/src/lib/schema.ts (zod): se um mudar, o outro muda junto (o arquiteto confere).
import type { EditLayer, EditSettings, FileRef, FontId, Render, TranscriptWord, UserRef, VideoFormat } from './index';

// ───────────────────────── §2 documento de edição ─────────────────────────
/** Coordenadas normalizadas ao canvas; tempo em segundos na linha do tempo de SAÍDA (depois dos cortes). */
export interface EditDoc {
  version: 1;
  /** Do zero: ordem e corte das cenas (todas as cenas vigentes, uma vez cada). [] = ordem e duração originais. remix-keep: sempre []. */
  clips: EditClip[];
  /** remix-keep (F4): começo e fim do vídeo inteiro, em frames da grade do campeão. null = vídeo inteiro. Do zero: sempre null. */
  trim: { inFrame: number; outFrame: number } | null;
  /** Só as camadas mexidas. Ausente = como o template (ou o campeão) desenha. ≤ 50. */
  layers: EditDocLayer[];
  /** Correções de palavra da legenda. ≤ 2000. */
  captionWords: CaptionWordFix[];
}

export interface EditClip {
  sceneId: string;          // Scene.id da geração vigente
  /** D3: false = cena apagada (fica no doc pra poder voltar). ≥ 1 enabled. */
  enabled: boolean;
  /** Scene.attempt quando o corte foi feito; cena regerada = o corte volta pro clipe inteiro. */
  attempt: number;
  /** Relativo ao início da cena (em TAKE_SLICE, à fatia). */
  inSec: number;
  /** > inSec + 0,3 e ≤ duração da cena; o resolver arredonda pra frame. */
  outSec: number;
}

/** Do zero: os 3 fixos. remix-keep: EditLayer.id do editMap. */
export type LayerId = 'hook' | 'caption' | 'cta' | (string & {});

export interface EditDocLayer {
  id: LayerId;
  /** false = some (remix: só onde dá pra cobrir o original, §6.2). */
  visible?: boolean;
  /** null/ausente = posição padrão. */
  transform?: LayerTransform | null;
  /** null/ausente = tempo automático (§3.3). Na legenda é janela de visibilidade. */
  timing?: { fromSec: number; durationSec: number } | null;
  /** Gancho, CTA e texto estático do remix (≤ 300). A legenda não tem: vem das palavras. */
  text?: string;
  /** Por cima do estilo padrão da camada. */
  style?: Partial<LayerStyle>;
}

export interface LayerTransform {
  x: number;            // centro, fração da largura. -0,25..1,25
  y: number;            // centro, fração da altura. -0,25..1,25
  scale: number;        // 0,25..4; 1 = tamanho padrão
  rotationDeg: number;  // -180..180
  boxWidth: number;     // largura da quebra de linha, fração da largura. 0,1..1,5
}

export type LayerBackgroundKind = 'none' | 'box' | 'pill' | 'word';   // word = caixa só atrás da palavra da vez
export interface LayerStyle {
  fontId: FontId;
  color: string;                    // #RRGGBB ou #RRGGBBAA
  highlightColor: string | null;    // legenda: cor da palavra da vez
  background: { kind: LayerBackgroundKind; color: string | null };
  strokeColor: string | null;
  strokeWidthPx: number;            // px na fonte de tamanho 1×
  uppercase: boolean;
  shadow: boolean;
  align: 'left' | 'center' | 'right';
}

export interface CaptionWordFix {
  /** Do zero: `${sceneId}@${attempt}:${wordIndex}`. remix-keep: `t:${wordIndex}`. */
  key: string;
  /** '' = a palavra sai da lista; o destaque fica na anterior durante o tempo dela. */
  text: string;
}

/** Limites do §2 como tipo (o pacote é só tipos; o DTO e o validarDoc repetem os números):
 *  layers ≤ 50 · captionWords ≤ 2000 · text ≤ 300 · doc ≤ 64 KB · clipe ≥ 0,3 s · vídeo ≥ 1 s · cor ^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$ */
export interface EditDocLimits {
  layers: 50; captionWords: 2000; textChars: 300; docBytes: 65536; minClipSec: 0.3; minVideoSec: 1;
}

// ───────────────────────── §5 API ─────────────────────────
/** GET /creatives/:id/editor */
export interface EditorState {
  revision: number;
  base: 'scratch' | 'remix-keep';
  composition: 'Criativo' | 'RemixKeep';
  settings: EditSettings;
  doc: EditDoc | null;
  /** Ingredientes com URL assinada; o web chama resolverProps(source, settings, doc) local. */
  source: ScratchSource | RemixSource;
  /** ISO. O web refaz o GET 10 min antes. */
  urlsExpireAt: string;
  layers: EditorLayerInfo[];
  capabilities: EditorCapabilities;
  fonts: { id: FontId; label: string }[];
  dirty: boolean;
  latestRender: Render | null;
  previewRender: Render | null;
  /** D1: selo "editado". */
  editedInEditor: boolean;
}

export interface ScratchSource {
  format: VideoFormat; fps: 30; language: string;
  scenes: {
    sceneId: string; index: number; label: string; attempt: number; durationSec: number; clipStartSec: number;
    clip: FileRef; thumbnail: FileRef | null; words: TranscriptWord[];
  }[];
  // TAKE_SLICE: o resolverProps emenda fatias contíguas do mesmo clipe; a última fatia vai até o fim do arquivo.
}

/** Props do remix-keep de hoje (= RemixKeepProps de `@maquina/video/player`, com URLs assinadas), sem o doc aplicado.
 *  Opaco aqui porque o @maquina/contratos não depende do video: o web faz o cast pro tipo do video. */
export type RemixKeepPropsJson = Record<string, unknown>;

export interface RemixSource {
  canvas: { width: number; height: number; fps: number; frameCount: number };
  base: RemixKeepPropsJson;
  champion: { layers: EditLayer[]; words: TranscriptWord[] };
}

export type EditorLayerRole = 'hook' | 'caption' | 'cta' | 'text';
/** Chave i18n do nome da camada. Do zero: `editor.layer.hook` | `editor.layer.caption` | `editor.layer.cta` (= `editor.layer.${id}`).
 *  remix-keep: definida no F3. */
export type EditorLayerLabelKey = 'editor.layer.hook' | 'editor.layer.caption' | 'editor.layer.cta' | (string & {});
export interface EditorLayerInfo {
  id: LayerId; role: EditorLayerRole; labelKey: EditorLayerLabelKey;
  defaults: { transform: LayerTransform; timing: { fromSec: number; durationSec: number }; style: LayerStyle; text: string | null };
  editable: { move: boolean; text: boolean; style: boolean; timing: boolean; hide: boolean };
  lockedReason: EditorLockReason | null;
  /** D2 (remix): mover/esconder deixa a barra do fundo original vazia. O web avisa na tela. */
  leavesEmptyCover: boolean;
}

export type EditorLockReason =
  | 'burnt_no_background'
  | 'outside_redrawn_interval'
  | 'remix_reorder_unsupported'
  | 'remix_scene_trim_unsupported'
  | 'trim_video_not_enabled'
  /** remix-keep antes do F3: o editor inteiro está fechado pra variação. Sai no 422 EDIT_NOT_SUPPORTED do GET e do PUT /editor
   *  (details só com `reason`, sem layerId/what); `EditResponse.editorAvailable` = false. Some quando o F3 entrar. */
  | 'remix_editor_not_enabled';

export type EditorLockedWhat = 'reorder' | 'trim_scenes' | 'trim_video' | 'caption_words';
export interface EditorCapabilities {
  trimScenes: boolean; reorderScenes: boolean; trimVideo: boolean; fixCaptionWords: boolean;
  locked: { what: EditorLockedWhat; reason: EditorLockReason }[];
}

/** PUT /creatives/:id/editor. doc null = voltar tudo ao padrão. */
export interface PutEditorBody { baseRevision: number; doc: EditDoc | null; settings?: Partial<EditSettings> }
export interface PutEditorResponse { revision: number; doc: EditDoc | null; settings: EditSettings; dirty: true }

/** §5.4: `details.fields[].rule` do 400 VALIDATION_ERROR do PUT /editor (semântica, via validarDoc). */
export type EditDocRule =
  | 'unknown_scene' | 'clips_must_cover_scenes' | 'no_enabled_clip' | 'trim_out_of_range' | 'clip_too_short'
  | 'video_too_short' | 'unknown_layer' | 'bad_color' | 'unknown_font' | 'doc_too_large' | 'unknown_word';

/** details do 409 EDIT_CONFLICT (baseRevision ≠ edit_revision). v1: savedBy/savedAt vêm da memória da API; depois de reiniciar,
 *  caem no autor do criativo e no updatedAt (pendência pós-v1 no editor-v1.md: colunas edit_saved_by_id/edit_saved_at). */
export interface EditConflictDetails { revision: number; savedBy: UserRef; savedAt: string }
/** details do 422 EDIT_NOT_SUPPORTED (o doc mexe no que está travado; ou remix-keep antes do F3, com reason 'remix_editor_not_enabled'). */
export interface EditNotSupportedDetails { layerId?: string; what?: EditorLockedWhat; reason: EditorLockReason }

// ───────────────────────── §9 SSE ─────────────────────────
/** Emitido a cada PUT /editor e PATCH /edit. Entra no CreativeEvent (index.ts). */
export interface EditorUpdatedEvent { event: 'editor.updated'; data: { revision: number; savedBy: UserRef; savedAt: string } }
