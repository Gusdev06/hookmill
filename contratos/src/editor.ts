// Editor no vídeo v1 (docs/contratos/editor-v1.md, APROVADO 09/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Espelhos em video/src/lib/editor.ts e video/src/lib/schema.ts (zod): se um mudar, o outro muda junto (o arquiteto confere).
import type { EditLayer, EditSettings, FaceTrackSegment, FileRef, FontId, ProtectedBand, Rect, Render, TranscriptWord, UserRef, VideoFormat } from './index';
import type { BrainField, FormatCode, FrameTemplateId } from './iteracao';
import type { ListTemplateId } from './lista';

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

// ═════════════════════════ editor universal v1 (docs/contratos/editor-universal-v1.md, 04/11) ═════════════════════════
// TRANSIÇÃO (F-U0): tipos novos ao lado dos da v1, sem trocar nenhum tipo que api/web/video já usam. No F-U1 o video troca o
// espelho (video/src/lib/editor.ts) pra `EditDocV3` e o backend passa a responder `EditorStateV3`; aí `EditDoc`/`EditorState`
// da v1 viram aliases (lista do que quebra no §12 do contrato). A v2 do E1 (`rect`/`fill`) nunca foi construída: a v3 absorve.

// ───────────────────────── §2 qual template / qual composição ─────────────────────────
/** Chave de edição: 1 por "família que tem o mesmo manifesto e o mesmo resolver". Estável (vai no doc e nos testes). */
export type EditTemplateKey =
  | 'scratch'                       // criativo do zero (`Criativo`)
  | 'remix-keep'                    // variação que mantém a edição do campeão (`RemixKeep`), F-U4
  | 'headline'                      // peça AUTO HEADLINE (`RemixKeep` montado pelo buildHeadlineInput)
  | `frame:${FrameTemplateId}`      // peça AUTO FRAME (`Moldura`), 18 molduras
  | `list:${ListTemplateId}`        // peça AUTO LIST_OVERLAY (`Template` → ListOverlay), F-U3
  | 'chat-dm'                       // peça AUTO CHAT_DM (`Template`), F-U3
  | 'person-motion'                 // peça AUTO PERSON_MOTION (`Template`), F-U4
  | 'static';                       // STATIC montado (imagem), F-U4 (E3)
/** Id da composição registrada no bundle e exportada em `@maquina/video/player`. */
export type EditorComposition = 'Criativo' | 'RemixKeep' | 'Moldura' | 'Template' | 'Estatico';
export type EditorBase = 'scratch' | 'remix-keep' | 'auto-piece';

// ───────────────────────── §3 manifesto (o template declara, o painel se monta) ─────────────────────────
export type EditLayerKind = 'video' | 'broll' | 'text' | 'box' | 'list' | 'chat' | 'caption' | 'burned';
/** O que dá pra mexer na camada. Ausente no manifesto = false (o JSON vem sempre completo). */
export interface LayerEditable {
  move: boolean; resize: boolean; rotate: boolean; text: boolean; style: boolean; fill: boolean;
  timing: boolean; hide: boolean; reframe: boolean; trim: boolean;
}
/** Limites da camada `video` que o painel e os sliders usam (F-U2). */
export interface VideoLayerLimits {
  zoomMin: number; zoomMax: number; panAbsMax: number;
  /** w e h mínimos da caixa (fração do canvas) */
  minBoxFrac: number;
  minTrimSec: number;
  /** segundos do arquivo em que o aparar pode ir */
  trimMinSec: number; trimMaxSec: number;
  fits: VideoFraming['fit'][];
}
export interface LayerDecl {
  /** só na camada `video` (F-U2) */
  video?: VideoLayerLimits;
  /** estável por template: 'video', 'video:2', 'broll', 'slot:<nome>', 'box:<nome>', 'headline', 'headline:box', 'list',
   *  'box:panel', 'thread', 'header', 'caption', 'burned', 'hook', 'cta'… (§3.2 do contrato) */
  id: LayerId;
  kind: EditLayerKind;
  /** chave i18n (`editor.layer.<templateKey>.<id>` ou `editor.layer.<id>`); o web traduz */
  labelKey: string;
  editable: LayerEditable;
  limits: { maxChars: number | null; maxLines: number | null; minFontPx: number | null } | null;
  /** pode esconder (Hide) */
  optional: boolean;
  /** travada inteira (ex.: 'burned_caption_pixels'); o web mostra o motivo e nenhum campo */
  lockedReason: EditorLockReasonV3 | null;
  /** D2 do editor-v1 (remix-keep): mover/esconder deixa a barra original vazia */
  leavesEmptyCover: boolean;
}
/** Grupos fixos, nessa ordem: appearance → position → format → [do template] → content → guides. */
export type ControlGroup = 'appearance' | 'position' | 'format' | 'content' | 'guides' | (string & {});
export interface ControlOption { value: string; labelKey: string }
/** Catálogo FECHADO de 9 tipos. O web implementa cada tipo uma vez; template novo só combina. */
export type ControlDecl =
  /** grava em templateOpts[key]. relayout = refaz o layout do template (mantém texto, estilo, tempos e correções). */
  | { type: 'segmented'; group: ControlGroup; key: string; labelKey: string; options: ControlOption[]; relayout: boolean }
  | { type: 'toggle'; group: ControlGroup; key: string; labelKey: string; relayout: boolean }
  /** grava hex em templateOpts[key]; `from` = atalho da cor da marca do workspace ou da cor original do template */
  | { type: 'color'; group: ControlGroup; key: string; labelKey: string; from: 'workspace' | 'template' }
  /** troca o formato que está sendo editado (não grava em templateOpts). Só aparece com formats.length > 1 */
  | { type: 'format'; group: 'format'; formats: FormatCode[] }
  /** tabela de textos: uma linha por camada de texto (`layers`) e/ou uma por item da camada `itemsOf` (lista, faixa que troca) */
  | { type: 'rows'; group: 'content'; layers: LayerId[]; itemsOf: LayerId | null; timed: boolean }
  /** chat: remetente (me/them) + texto + tempo, em items[layer] */
  | { type: 'messages'; group: 'content'; layer: LayerId }
  /** corrigir palavra da NOSSA legenda (captionWords) */
  | { type: 'words'; group: 'content'; layer: LayerId }
  /** trechos de b-roll com "Swap clip" (clipSwaps). group = grupo próprio do template (ex. 'broll') */
  | { type: 'clips'; group: ControlGroup; groupLabelKey: string; layer: LayerId }
  | { type: 'guides'; group: 'guides' };
export type ControlType = ControlDecl['type'];
export type TemplateOptValue = string | boolean;
export type TemplateOpts = Record<string, TemplateOptValue>;
/** GET /creatives/:id/editor → manifest. Puro: `manifestoDe(templateKey, base)` em @maquina/video/lib (o mesmo no web e na API). */
export interface EditManifest {
  manifestVersion: 1;
  templateKey: EditTemplateKey;
  /** formatos que a peça aceita (CHAT_DM/PERSON_MOTION: só '9x16'); o 1º é o principal (o que o Export renderiza) */
  formats: FormatCode[];
  layers: LayerDecl[];
  controls: ControlDecl[];
  /** valores com que a base foi montada (o que o painel mostra com templateOpts vazio) */
  defaults: TemplateOpts;
  /** a peça tem imagem do cliente? false = Chat DM com o vídeo escondido: regras de rosto/legenda viram 'info' */
  clientImage: boolean;
}

// ───────────────────────── §4 EditDoc v3 ─────────────────────────
/** Camada v3 = a da v1 + caixa e fundo (o que o E1 chamava de v2). Texto usa `transform`; caixa/lista/chat/b-roll usam `rect`. */
export interface EditDocLayerV3 extends EditDocLayer {
  /** caixa em fração do canvas (sobrescreve o retângulo do layout calculado). Sem girar (D-E1-2). */
  rect?: Rect | null;
  /** fundo da caixa (hex). null = o do template/medido */
  fill?: string | null;
}
/** Enquadramento do vídeo do cliente dentro da caixa. null/ausente = auto reframe (o de hoje: rosto + legenda queimada inteiros). */
export interface VideoFraming {
  fit: 'cover' | 'contain_blur';
  /** 0,5..3; 1 = base (cover = cobre a caixa; contain_blur = cabe inteiro, laterais desfocadas) */
  zoom: number;
  /** deslocamento do centro, em fração da largura/altura do CANVAS. -1..1 */
  panX: number; panY: number;
}
export interface VideoEdit {
  /** camada do vídeo do cliente; hoje sempre 'video' (a 2ª fonte é 'video:2'/'broll' e usa EditDocLayerV3.rect) */
  layerId: LayerId;
  framing?: VideoFraming | null;
  /** caixa do vídeo (fração do canvas). null/ausente = a do template. Revoga a D-E1-1. Mudar a caixa zera `framing` (auto reframe) */
  box?: Rect | null;
  /** aparar começo/fim, segundos do vídeo do cliente. null/ausente = inteiro. ≥ 1 s. Não corta no meio. */
  trim?: { inSec: number; outSec: number } | null;
}
/** Item de uma camada com itens (linha da lista, mensagem do chat, texto da faixa que troca no tempo). Só os mexidos. */
export interface ItemEdit {
  /** id estável do plano ('l1', 'm2', 'h3'…). Sem adicionar/apagar item na v1 */
  id: string;
  text?: string;
  /** auto-piece: segundos na linha do tempo do vídeo do cliente (antes do aparar) */
  atSec?: number;
  side?: 'me' | 'them';
}
export interface ClipSwap {
  /** trecho da trilha de b-roll ('c1'…) */
  clipId: string;
  /** uma das alternativas JÁ baixadas (GET …/broll-alternatives). Sem custo */
  fileId: string;
}
/** D-E1-3 estendida: "It's true, keep it". Vale pros números listados naquele texto; texto mudou e apareceu número novo = pede de novo. */
export interface TextConfirmation {
  /** 'layer:<id>' ou 'item:<layerId>/<itemId>' */
  path: string;
  /** números normalizados confirmados (ex. '400', '4.99') */
  numbers: string[];
  byUserId: string;
  at: string;
}
/** Geometria de um formato que não é o principal. Formato sem override = layout do template naquele formato + texto/estilo/tempos do doc. */
export interface FormatGeometry {
  layers: { id: LayerId; transform?: LayerTransform | null; rect?: Rect | null }[];
  video?: Pick<VideoEdit, 'framing' | 'box'> | null;
}
export interface EditDocV3 {
  version: 3;
  /** só scratch (igual à v1). auto-piece: sempre [] */
  clips: EditClip[];
  /** OBSOLETO (o F4 do editor-v1 nunca foi construído): sempre null. Aparar = video.trim */
  trim: null;
  /** só as camadas mexidas; a geometria aqui vale pro formato PRINCIPAL (manifest.formats[0]; scratch = creative.format). ≤ 50 */
  layers: EditDocLayerV3[];
  /** correções de palavra da NOSSA legenda. ≤ 2000 */
  captionWords: CaptionWordFix[];
  /** valores dos controles do manifesto (key → valor). Ausente = manifest.defaults */
  templateOpts?: TemplateOpts;
  /** vídeo do cliente no formato principal */
  video?: VideoEdit | null;
  /** itens mexidos por camada (≤ 40 por camada) */
  items?: Record<LayerId, ItemEdit[]>;
  /** ≤ 20 */
  clipSwaps?: ClipSwap[];
  /** ≤ 50 */
  confirmations?: TextConfirmation[];
  /** geometria dos formatos não principais */
  formatOverrides?: Partial<Record<FormatCode, FormatGeometry>>;
}
/** O que o resolver aceita: v1 (docs salvos do criativo do zero) sobe pra v3 sem perda (`docV3De`). */
export type AnyEditDoc = EditDoc | EditDocV3;

export interface EditDocLimitsV3 extends EditDocLimits {
  itemsPerLayer: 40; clipSwaps: 20; confirmations: 50; zoomMin: 0.5; zoomMax: 3; panAbsMax: 1; minTrimSec: 1;
}

// ───────────────────────── §5 layout resolvido e checagens ─────────────────────────
/** Saída do resolver além das props: a geometria final, em fração do canvas. O web desenha alças/guias com isto e as
 *  checagens (web e API) leem isto. Nunca vem da API: o web calcula com o mesmo resolver. */
export interface EditLayoutLayer {
  id: LayerId; kind: EditLayerKind;
  rect: Rect; rotationDeg: number;
  fromSec: number; toSec: number; visible: boolean;
  /** texto final (com correções) e o tamanho de fonte que coube (px a 1080 de largura) */
  text: string | null; fontPx: number | null;
}
export interface EditLayout {
  format: FormatCode;
  canvas: { width: number; height: number };
  durationSec: number;
  layers: EditLayoutLayer[];
  /** onde o vídeo do cliente cai: caixa e retângulo do quadro inteiro da fonte (pode passar da caixa), fração do canvas */
  video: {
    layerId: LayerId; box: Rect; sourceRect: Rect; fit: VideoFraming['fit']; auto: boolean; trim: { inSec: number; outSec: number };
    /** caixa ∩ canvas ∩ área útil do vídeo: o que de fato aparece (F-U2) */
    visibleRect: Rect;
    /** valores atuais, mesmo no auto: sliders e ponto de partida do arrasto (F-U2) */
    framing: VideoFraming;
    /** o doc mexeu na caixa ou no enquadramento: só aí rodam caption_cut e face_cut (F-U2) */
    edited: boolean;
    /** false = legenda queimada recortada, a nossa no lugar: regras de legenda não valem (F-U2) */
    checksCaption: boolean;
  } | null;
}
/** Regras do §5 do contrato. As 3 primeiras do grupo "estrutura" saem como 400; estas aqui são salvas e viram pílula. */
export type EditIssueRule =
  | 'caption_covered' | 'face_covered' | 'caption_cut' | 'face_cut' | 'text_overflow' | 'too_long'   // block
  | 'invented_number'                                                                               // confirm
  | 'low_contrast'                                                                                  // warn
  | 'item_out_of_range' | 'no_client_image';                                                        // info
export type EditIssueLevel = 'block' | 'confirm' | 'warn' | 'info';
export interface EditIssue {
  rule: EditIssueRule;
  level: EditIssueLevel;
  /** camada culpada (clicar na pílula seleciona) */
  layerId: LayerId | null;
  itemId: string | null;
  format: FormatCode;
  /** 1º instante em que falha (botão "Jump to") */
  atSec: number | null;
  detail: { numbers?: string[]; coveredPct?: number; visiblePct?: number; chars?: number; maxChars?: number; fontPx?: number; minFontPx?: number } | null;
}
/** Erros de ESTRUTURA do doc v3 (400 VALIDATION_ERROR, nunca salvos). Somam-se aos EditDocRule da v1. */
export type EditDocRuleV3 = EditDocRule
  | 'unknown_template_opt' | 'bad_template_opt_value' | 'unknown_item' | 'item_time_out_of_range' | 'too_many_items'
  | 'unknown_clip' | 'unknown_clip_alternative' | 'rect_out_of_range' | 'video_box_out_of_canvas' | 'video_zoom_out_of_range'
  | 'video_pan_out_of_range' | 'trim_too_short' | 'format_not_supported' | 'not_editable' | 'bad_confirmation';

// ───────────────────────── §6 API ─────────────────────────
/** Ingredientes da peça AUTO. `base` = props da composição montadas pelo builder de hoje SEM doc, com URLs do proxy 540p
 *  (ou do original enquanto o proxy não existe) e as dimensões ORIGINAIS da mídia (o proxy é troca de URL, não de layout). */
export interface AutoPieceSource {
  kind: 'auto-piece';
  fps: number;
  /** duração do vídeo do cliente (s), antes do aparar */
  durationSec: number;
  language: string;
  formats: { format: FormatCode; supported: boolean; base: EditorPropsJson | null }[];
  guard: EditorGuard;
  /** palavras da fala com tempo (tempo clicável, âncora, "Start here") */
  words: TranscriptWord[];
}
/** Props da composição (Moldura, RemixKeep, Template…), opacas aqui; o web faz cast pro tipo do @maquina/video. */
export type EditorPropsJson = Record<string, unknown>;
/** O que as regras de rosto/legenda precisam, no espaço do arquivo do cliente (px). */
export interface EditorGuard {
  source: { width: number; height: number; fps: number };
  /** legenda-protegida-v1 §1; [] = sem legenda queimada */
  protectedBands: ProtectedBand[];
  /** só os trechos role 'main' importam pra face_*; [] = sem rosto (regras de rosto viram 'info') */
  faceTrack: FaceTrackSegment[];
}
/** De onde veio cada texto (Conteúdo). Chave = 'layer:<id>' ou 'item:<layerId>/<itemId>'. */
export interface TextProvenance {
  source: 'transcript' | 'brain' | 'both' | 'template' | 'generic';
  field: BrainField | 'name' | null;
  /** frase da fala que contém a âncora (≤ 120) ou o trecho do Brain */
  quote: string | null;
  anchorWordIndex: number | null;
  /** texto que a IA escreveu (o web mostra "You edited · was …" quando o doc muda) */
  original: string;
}
/** Números que podem aparecer sem confirmação (transcrição + Brain, normalizados pela mesma função do validatePlan). */
export interface EditorFacts { numbers: string[] }
export type EditorProxyStatus = 'ready' | 'building' | 'none';
export type EditorReadOnlyReason = 'approved' | 'published';
export type EditorExportStage = 'saving' | 'rendering' | 'caption_check' | 'text_check' | 'done' | 'failed';
export interface EditorExportView {
  renderId: string;
  revision: number;
  stage: EditorExportStage;
  progress: number;
  /** só em 'failed' */
  error: { code: 'RENDER_ERROR' | 'CAPTION_COVERED' | 'TEXT_MISMATCH' | (string & {}); atSec: number | null; layerId: LayerId | null; canRecheck: boolean } | null;
  startedAt: string;
}
/** GET /creatives/:id/editor (v3). Scratch continua com `source: ScratchSource` e `settings`. */
export interface EditorStateV3 {
  version: 3;
  revision: number;
  base: EditorBase;
  composition: EditorComposition;
  templateKey: EditTemplateKey;
  manifest: EditManifest;
  doc: EditDocV3 | null;
  source: ScratchSource | RemixSource | AutoPieceSource;
  /** só scratch (EditSettings de hoje); null nas outras */
  settings: EditSettings | null;
  facts: EditorFacts;
  provenance: Record<string, TextProvenance>;
  /** checagens do doc salvo (as mesmas que o web recalcula) */
  issues: EditIssue[];
  proxy: { status: EditorProxyStatus; etaSec: number | null };
  urlsExpireAt: string;
  fonts: { id: FontId; label: string }[];
  /** cor da marca do workspace (atalho dos controles color.from = 'workspace'); null = sem kit */
  brandColor: string | null;
  readOnly: { reason: EditorReadOnlyReason } | null;
  /** revision ≠ revisão do último export que passou */
  dirty: boolean;
  exported: { revision: number; at: string } | null;
  /** export em curso ou o último que falhou (null = nada pendente) */
  export: EditorExportView | null;
  editedInEditor: boolean;
  /** código mostrado (com -ED quando editedInEditor) e o original */
  code: string | null; baseCode: string | null;
  /** peça AUTO: ids pro "voltar ao lote"; null em scratch/remix */
  piece: { id: string; batchId: string } | null;
}
export interface PutEditorBodyV3 { baseRevision: number; doc: EditDocV3 | null; settings?: Partial<EditSettings> }
export interface PutEditorResponseV3 { revision: number; doc: EditDocV3 | null; settings: EditSettings | null; issues: EditIssue[]; dirty: true; savedAt: string }
/** POST /creatives/:id/editor/export */
export interface ExportEditorBody { revision: number }
/** details do 422 EDIT_BLOCKED (TRANSIÇÃO: entra no ApiErrorCode junto com o ErrorCode da API no F-U1) */
export interface EditBlockedDetails { issues: EditIssue[] }
/** GET /creatives/:id/broll-alternatives?clipId= (F-U3) */
export interface BrollAlternative { fileId: string; poster: FileRef | null; clip: FileRef; label: string; durationSec: number; provenance: Record<string, unknown> }
export interface BrollAlternativesResponse { clipId: string; current: string; alternatives: BrollAlternative[] }

/** Motivos novos de trava (somam-se ao EditorLockReason da v1). */
export type EditorLockReasonV3 = EditorLockReason
  | 'burned_caption_pixels'   // legenda queimada do original: é pixel; pra mudar, subir sem legenda e ligar a nossa
  | 'fullscreen_video'        // vídeo em tela cheia no template: só reenquadra, a caixa não move
  | 'audio_only';             // Chat DM com o vídeo escondido: só a voz
/** Por que a peça não abre no editor (card do lote/Biblioteca). */
export type EditorUnavailableReason =
  | 'auto_type_not_editable'  // tipo ainda fora das fases ligadas (§11 do contrato)
  | 'piece_not_ready'         // 9:16 não está pronto
  | 'sample_locked'           // amostra grátis travada (402 no GET)
  | 'remix_editor_not_enabled'
  | 'headline_plate_retired'; // troca-texto-queimado-v1 §15.3.1: HEADLINE `replace` antigo não tem build até o F1b
/** IteratePiece.editor (TRANSIÇÃO opcional). */
export interface PieceEditorView {
  available: boolean;
  reason: EditorUnavailableReason | null;
  edited: boolean;
  /** há edição salva não exportada: Download fica desligado no card */
  pendingExport: boolean;
  export: EditorExportView | null;
}
/** SSE do criativo: avanço do export (o render.updated de hoje continua; este traz a etapa das checagens e o "Jump to"). */
export interface EditorExportEvent { event: 'editor.export'; data: EditorExportView }
