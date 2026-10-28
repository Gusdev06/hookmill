// Contrato do módulo render (maquina-video). docs/contratos/estrutura.md §2.2 + feature-2-variar-campeao.md §13.6.
// Só o maquina-arquiteto muda o contrato; o backend importa os tipos daqui.
import type { AutoVariationType, EndcardVariant, Rect, TextStyle } from '@maquina/contratos';
import type { CaptionsAuto, FaixaNaSaida, MolduraProps, ProtectedBand, ResolvedLayer, TemplateProps } from '@maquina/video';

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
  /** 25/10 (headline-e-legenda-v1): idioma dos textos novos (headline/legenda): Noto CJK e o "sem espaço" do zh/ja */
  language?: string;
  /** 26/10: faixa da legenda queimada no vídeo renderizado (px da saída, tempo da peça), pra checagem por visão */
  outputProtectedBands?: FaixaNaSaida[];
  /** §13.15.4 (B) ENGINE_VOICE: áudio = campeão com cada span [start, end) trocado pela voz do arquivo `url` (do instante 0
   *  dele, cortada no tamanho do span), crossfade de `fadeMs` (10) nas bordas, AAC 192 kbps. Ausente = -c:a copy. */
  audioSplice?: { spans: { startFrame: number; endFrame: number; url: string }[]; fadeMs: number };
  overlays: { startFrame: number; endFrame: number; region: Rect;          // [start, end) na grade do campeão
              clipUrl: string; clipOffsetSec: number;                      // instante do clipe no startFrame
              crop: Rect }[];                                              // px do clipe (fitCrop), escalado pra region
  textLayers: { id: string; startFrame: number; endFrame: number; box: Rect;
                /** solid/pill: pinta a caixa inteira antes do texto. color = hex, ou `linear-gradient(...)` CSS quando a
                 *  faixa medida é um degradê (MediaAnalysisService.solidBackground) */
                /** radius (25/10, headline-e-legenda-v1 §1.3): cantos do `solid` em px (placa sobre o vídeo); ausente = 0 */
                background: { kind: 'solid' | 'pill' | 'none'; color: string | null; box: Rect | null; radius?: number };
                /** highlightBackground (opcional, §13.15): caixa atrás da palavra atual do karaokê (estilo "palavra na
                 *  pílula roxa"). Ainda não existe no TextStyle do @maquina/contratos: o arquiteto decide se sobe pra lá. */
                style: TextStyle & { highlightBackground?: string | null };
                content: { kind: 'static'; text: string }
                       | { kind: 'karaoke'; words: { word: string; startFrame: number; endFrame: number }[]; wordsPerPage: number } }[];
}

/** variacao-auto-v1 §7.2: peça de VÍDEO da variação automática (template `auto-edit`), composição AutoEdit do
 *  @maquina/video. Montado por `buildAutoEditInput` (./auto-edit.ts). Rev. 23/10 (§14.6): o STATIC saiu do Remotion
 *  (imagem do GPT Image 2, engine IMAGE_GEN); `type` 'STATIC' aqui = RENDER_ERROR. */
export interface AutoEditRenderInput {
  kind: 'auto-edit'; renderId: string; templateId: 'auto-edit';
  /** @deprecated rev. 23/10 (§14.6): o builder não manda mais; 'still' = RENDER_ERROR. Sai no fechamento do §14.5. */
  output?: 'video' | 'still';
  format: 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';     // 1080x1920 | 1080x1350 | 1080x1080, 30 fps
  language: string;                                            // dos textos de tela
  source: { videoUrl: string; width: number; height: number; fps: number; durationSec: number; hasAudio: boolean };
  reframe: { mode: 'cover'; focus: { x: number; y: number }; scale?: number }  // corta centrado no rosto (0-1 do quadro)
         | { mode: 'contain_blur' };                           // cabe inteiro, fundo = o próprio vídeo desfocado
  timeline: { startSec: number; endSec: number }[];            // trechos do campeão, em ordem
  joinFadeMs: 40;                                              // rampa de volume em cada emenda (sem clique)
  safeArea: { top: number; bottom: number };                   // px da saída livres da UI do Reels/Stories
  palette: string[];
  brandName: string;
  type: AutoVariationType;
  params: AutoEditParams;
  /** 26/10 (legenda-protegida-v1, headline-e-legenda-v1 §2): legenda nossa (automática ou refeita no estilo da original),
   *  legenda queimada protegida, modo e área recortada do campeão. Opcionais: ausentes = como antes. */
  captions?: CaptionsAuto;
  captionMode?: 'avoid' | 'replace';
  protectedBands?: ProtectedBand[];
  contentBox?: Rect | null;
  /** 26/10: faixa da legenda no vídeo renderizado (px da saída, tempo da peça), pra checagem por visão */
  outputProtectedBands?: FaixaNaSaida[];
}
export type AutoEditParams =
  | { type: 'CUT'; targetSec: 15 | 20 }
  | { type: 'COLD_OPEN'; teaserSec: number }
  | { type: 'HOOK_TEXT'; text: string; endSec: number; box: Rect; cover: { box: Rect; color: string } | null }
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string | null; ctaText: string; durationSec: 2; background: string }
  | { type: 'SPLIT_LP'; top: { imageUrl: string; kind: 'page' | 'product_photo'; scroll: boolean }; ratio: 0.5 }
  | { type: 'STORY'; handle: string; timeAgo: string; replyLabel: string; bars: 1 | 2 | 3 }
  | { type: 'REVIEW'; quote: string; author: string | null; stars: 1 | 2 | 3 | 4 | 5 | null; ratio: 0.42 }
  | { type: 'NATIVE_SEARCH'; query: string; introSec: number; typingCps: 14; placeholder: string };

/** estatico-montado-e-molduras-v1 §B2: moldura de vídeo (composição `Moldura` do @maquina/video), montada pelo
 *  `buildFrameInput` (./frame.ts). Corpo = MolduraProps do video (formato, idioma, frame {id, texts, brand}, vídeo do
 *  campeão com reenquadramento na caixa, 2ª fonte, rosto, safeArea). */
export type FrameRenderInput = { kind: 'frame'; renderId: string; templateId: 'frame' } & MolduraProps;

/** iterate-v2-quiz-templates-ia F1.4 (28/10): template grátis (composição `Template` do @maquina/video), montado pelo
 *  `buildTemplateInput` (./template.ts). Corpo = TemplateProps do video: `templateId` 'chat-dm' | 'person-motion', só 9:16,
 *  marca (monograma, nunca logo), paleta, safeArea, SFX do bundle, duração calculada e os `checkpoints` da checagem por visão.
 *  `chat-dm` não baixa mídia nenhuma; `person-motion` usa a URL assinada do campeão (rosto e voz dele). */
export type TemplateRenderInput = { kind: 'template'; renderId: string } & TemplateProps;

export type RenderInput = ScratchRenderInput | RemixKeepRenderInput | AutoEditRenderInput | FrameRenderInput | TemplateRenderInput;
export const isRemixKeep = (i: RenderInput): i is RemixKeepRenderInput => i.kind === 'remix-keep';
export const isAutoEdit = (i: RenderInput): i is AutoEditRenderInput => i.kind === 'auto-edit';
export const isFrame = (i: RenderInput): i is FrameRenderInput => i.kind === 'frame';
export const isTemplate = (i: RenderInput): i is TemplateRenderInput => i.kind === 'template';

export interface RenderProgress { stage: 'bundling'|'rendering'|'encoding'; progress: number; frame: number; totalFrames: number }
/** mimeType ausente = 'video/mp4'. 'image/png' fica pro contrato (o Remotion não gera mais PNG desde a rev. 23/10). */
export interface RenderResult { outputPath: string; posterPath: string; durationSec: number; width: number; height: number; sizeBytes: number; mimeType?: 'video/mp4' | 'image/png' }
export class RenderError extends Error { constructor(public code: 'RENDER_ERROR', public failedFrame: number|null, message: string) { super(message) } }
/** F8 (27/10): saída que nunca vai passar (nº de quadros ≠ campeão/calculado). Refazer o finalize daria o mesmo resultado:
 *  o backend falha na 1ª, sem gastar as outras tentativas. É um RenderError (quem só conhece o pai continua igual). */
export class RenderValidationError extends RenderError {}

export interface RenderService {
  /** kind 'remix' (remix-keep) não aparece na escolha de template do criativo do zero. */
  templates(): { id: string; kind: 'scratch' | 'remix'; labelKey: string; thumbnailPath: string; supportsHeadline: boolean }[];
  /** Renderiza um por vez (fila interna com concorrência RENDER_CONCURRENCY). Arquivos em RENDER_TMP_DIR; o backend sobe e apaga.
   *  remix-keep: saída com a largura/altura/fps/nº de frames do campeão e o áudio de audioPassthroughUrl copiado (-c:a copy);
   *  nb_frames conferido (diferente = RENDER_ERROR). */
  render(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult>;
}

// ───────── render-lambda-v1 §6.1: porta assíncrona (submit → snapshot/webhook → finalize) ─────────
// Substitui o RenderService.render() pra quem migrar: um render de minutos não vive numa promessa que morre no restart.
// O RenderService acima continua (é o que o adaptador `local` embrulha) até o backend trocar a fila pelo despachante.

export type RenderImpl = 'fake' | 'local' | 'lambda';
/** `kind` de roteamento (RENDER_LAMBDA_KINDS). `frame` = Moldura (estatico-montado-e-molduras-v1), quando entrar no RenderInput. */
export type RenderKind = 'scratch' | 'auto-edit' | 'remix-keep' | 'frame' | 'template';
export const kindDe = (i: RenderInput | { kind?: string }): RenderKind => ((i as { kind?: string }).kind ?? 'scratch') as RenderKind;

/** O que o backend grava no `Render` depois do submit (§6.2: impl, external_id, external_bucket, serve_url, attempt). */
export interface RenderSubmission {
  impl: RenderImpl;
  externalId: string;            // local/fake = renderId; lambda = renderId do Remotion
  bucket: string | null;         // lambda
  serveUrl: string | null;       // site usado (reprodução)
  attempt: number;
}

export interface RenderSnapshot {
  state: 'running' | 'done' | 'failed' | 'timeout';
  progress: RenderProgress;
  costUsd: number | null;        // lambda: costs.accruedSoFar
  /** retryable = vale submeter de novo (attempt+1): timeout, pedaço morto por throttling, render perdido no restart (local). */
  error: { message: string; failedFrame: number | null; retryable: boolean } | null;
}

export interface RenderWebhookEvent {
  externalId: string; renderId: string; attempt: number;
  status: 'success' | 'error' | 'timeout';
  costUsd: number | null;
}

export interface RenderPort {
  readonly impl: RenderImpl;
  templates(): ReturnType<RenderService['templates']>;
  /** Monta props (+ emendas no silêncio), submete e devolve rápido. Não espera o render.
   *  Lança RenderError (entrada inválida, mídia que o Lambda não alcança: FAILED sem retentativa) ou
   *  RenderThrottledError (cota da AWS: volta pra QUEUED com o MESMO attempt e notBefore = agora + retryAfterMs). */
  submit(input: RenderInput, o: { attempt: number; webhookUrl: string | null }): Promise<RenderSubmission>;
  /** Estado atual. local/fake: memória do processo; lambda: getRenderProgress. Lança RenderThrottledError ou erro de
   *  rede = "sem notícia neste ciclo" (o poller tenta no próximo; não é falha do render). */
  snapshot(sub: RenderSubmission): Promise<RenderSnapshot>;
  /** Saída pronta → arquivos locais em RENDER_TMP_DIR/<renderId>/ (baixa, compõe o remix, confere nb_frames, tira o pôster).
   *  Devolve o MESMO RenderResult de hoje (+ costUsd final no lambda); o backend sobe e apaga como hoje. Lança RenderError.
   *  Idempotente: chamar de novo refaz do zero (a saída no S3 só some no `release`). */
  finalize(input: RenderInput, sub: RenderSubmission): Promise<RenderResult & { costUsd?: number | null }>;
  /** Depois do storage.put dar certo: apaga a saída remota (lambda) / esquece o render (local/fake). Nunca lança. */
  release(input: RenderInput, sub: RenderSubmission): Promise<void>;
  /** Só lambda. Corpo cru + cabeçalhos → evento, ou null se a assinatura for inválida (responder 401, nada gravado). */
  parseWebhook?(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): RenderWebhookEvent | null;
  /** Só local/fake: aviso imediato (dispensa polling). O despachante assina uma vez. */
  onEvent?(fn: (renderId: string, snap: RenderSnapshot) => void): void;
}

/** Cota da AWS (TooManyRequestsException / Rate Exceeded / ConcurrentInvocationLimitExceeded): não é falha do render. */
/** reason 'transient' = rede/5xx da AWS ao invocar: mesma regra (volta pra QUEUED, mesmo attempt, espera retryAfterMs). */
export class RenderThrottledError extends Error {
  readonly code = 'RENDER_THROTTLED' as const;
  constructor(public retryAfterMs: number, message: string, public reason: 'throttled' | 'transient' = 'throttled') { super(message) }
}
