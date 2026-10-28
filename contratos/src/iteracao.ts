// Variação automática de campeão v1 (docs/contratos/variacao-auto-v1.md, APROVADO 13/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Lote AUTO: upload ou Library → análise sozinha → porquê + plano (9 tipos) → Gerar (só 9:16) → 4:5/1:1 sob demanda → "In zip" → zip.
// Revisão 23/10 (§14 do contrato, aprovada pelo Gusta 23/10): campos marcados TRANSIÇÃO são opcionais só até as entregas
// R-B/R-F/R-I; o arquiteto tira o `?` na revisão (mesmo esquema do campanhas-v1).
// 25/10 (estatico-montado-e-molduras-v1.md, APROVADO 25/10): tipo `FRAME` (molduras) e `textCheck` do STATIC. Mesmo esquema:
// campos novos opcionais (TRANSIÇÃO) até as entregas da seção C do contrato.
import type { FileRef, LibraryItem, UserRef } from './index';

// ───────────────────────── catálogo ─────────────────────────
/** 25/10: `FRAME` (molduras, estatico-montado-e-molduras-v1 §B2) fundido na entrega B1. */
export type AutoVariationType = 'CUT' | 'COLD_OPEN' | 'HOOK_TEXT' | 'ENDCARD' | 'SPLIT_LP' | 'STORY' | 'REVIEW' | 'NATIVE_SEARCH' | 'STATIC' | 'FRAME'
  /** 25/10 (headline-e-legenda-v1 §1): headline nova (`replace`) ou acrescentada (`add`), mesma edição do campeão; ITERATION */
  | 'HEADLINE';
/** @deprecated fusão B1 (25/10): igual a `AutoVariationType`. Use `AutoVariationType`; o alias sai quando ninguém mais importar. */
export type AutoVariationTypeWithFrame = AutoVariationType;
/** Fixo por tipo (§6.1): ITERATION → pasta "esticar a vida"; DIVERSITY → "público novo". */
export type VariationAxis = 'ITERATION' | 'DIVERSITY';
export type BatchMode = 'MANUAL' | 'AUTO';
export type FormatCode = '9x16' | '4x5' | '1x1';
export type BlockFn = 'hook' | 'problem' | 'mechanism' | 'proof' | 'cta' | 'other';
export type BrainField = 'what' | 'audience' | 'pains' | 'promise' | 'proof' | 'offerAndPrice' | 'cta' | 'notes' | 'page';
export type EndcardVariant = 'offer' | 'guarantee' | 'price' | 'cta';
export type CodeLanguage = 'EN' | 'PT';

// ───────────────────────── molduras (estatico-montado-e-molduras-v1 §B2, 25/10) ─────────────────────────
/** As 18 molduras, ids IGUAIS aos do protótipo aprovado (`video/src/prototipos/molduras/tipos.ts` MOLDURA_IDS).
 *  1 fonte (B1): o vídeo do campeão (+ rosto recortado dele em question_box/live). 2 fontes (B2): + 2ª mídia (§B3). */
export type FrameTemplateId =
  | 'question_box' | 'gossip_page' | 'meme' | 'cinema' | 'news' | 'split_stack' | 'split_torn' | 'call' | 'call_dialog'
  | 'ranking' | 'post_card' | 'direct_offer' | 'story' | 'read_caption' | 'pov_testimonial' | 'live' | 'gossip_white' | 'gossip_pink';
/** Molduras que precisam da 2ª mídia (§B3). As outras 12 são da fase B1. */
export type FrameTwoSourceId = 'split_stack' | 'split_torn' | 'call_dialog' | 'gossip_page' | 'gossip_white' | 'gossip_pink';
/** Textos de TELA de cada moldura (idioma da fala do campeão). Mesma forma do `TextosMoldura` do protótipo.
 *  Destaque: trecho entre *asteriscos* (no máx. 1 por texto; os asteriscos não contam no limite). Limites no §B2 do contrato. */
export interface FrameTexts {
  question_box: { question: string };
  gossip_page: { headline: string; pageName: string };
  meme: { pov: string; cta: string };
  cinema: { question: string; subtitle: string };
  news: { topic: string; headline: { lead: string; highlight: string }; dek: string; cta: string };
  split_stack: { headline: string };
  split_torn: { headline: string };
  call: { title: string; slideTitle: string; slideSteps: string[] };
  call_dialog: { title: string; names: [string, string] };
  ranking: { title: string; items: string[] };
  post_card: { copy: string };
  direct_offer: { promise: string; price: { from: string | null; to: string }; cta: string };
  story: { question: string; headline: string; support: string; copy: string };
  read_caption: { headline: string; primaryText: string };
  pov_testimonial: { pov: string; cta: string };
  live: Record<string, never>;
  gossip_white: { headline: string };
  gossip_pink: { headline: string };
}
/** Origem da 2ª mídia (B2, §B3/§B3.1). `stock_broll` = clipe de terceiro buscado pelo pipeline do get-brolls. */
/** 25/10 (D Gusta): ordem da 2ª fonte = Pexels (`stock_broll`) → imagem gerada (`generated_image`, reserva) → trecho do campeão. */
export type FrameSecondKind = 'champion_segment' | 'page_capture' | 'product_photo' | 'stock_broll' | 'generated_image'
  /** 25/10 (Gusta): vários clipes que trocam conforme a fala (§B3.1 item 9). `stock_broll` fica pra compatibilidade. */
  | 'broll_track';
export type BrollProvider = 'youtube' | 'instagram' | 'tiktok' | 'pexels' | 'pixabay' | 'wikimedia' | 'nasa';
/** Proveniência gravada por peça (§B3.1): mostrada na peça e no README do zip. `license` = texto da fonte, nunca inventado. */
export interface BrollProvenance {
  provider: BrollProvider; sourceUrl: string; creator: string | null;
  /** ex.: "Pexels License", "CC BY-SA 4.0", "Standard YouTube License"; null = desconhecida (nunca vira domínio público) */
  license: string | null;
  /** true só em Pexels/Pixabay/Commons-livre/NASA-PD; YouTube/Instagram/TikTok = false */
  licenseCommercialOk: boolean;
  startSec: number; endSec: number;
}
/** 25/10: proveniência de um trecho de `broll_track` que virou imagem de reserva (GPT Image 2; nossa, sem licença de terceiro). */
export interface GeneratedProvenance { provider: 'generated'; model: string; prompt: string; subject: string; licenseCommercialOk: true }
/** Um clipe da trilha de b-roll (§B3.1 item 9), na linha do tempo da peça. */
export interface BrollTrackClipView { fromSec: number; toSec: number; segmentText: string; provenance: BrollProvenance | GeneratedProvenance }
/** O que a peça FRAME mostra na vista (rótulo, 2ª fonte e troca de clipe). */
export interface PieceFrame {
  template: FrameTemplateId;
  /** `provenance` só em `stock_broll`; `generated_image` = null (imagem nossa, GPT Image 2; o prompt fica em renders.input) */
  second: { kind: FrameSecondKind; provenance: BrollProvenance | null; /** 25/10, só `broll_track` (TRANSIÇÃO opcional) */ track?: BrollTrackClipView[] } | null;
  /** B2 com stock_broll: o usuário pode trocar o clipe (§B3.1). false nos outros */
  canSwapBroll: boolean;
}
/** Checagem de texto do STATIC por visão (§A6). */
export interface StaticTextCheck {
  status: 'ok' | 'mismatch' | 'skipped';
  /** TODOS os textos conferidos no aspecto (não só os errados), §A10. `key` (TRANSIÇÃO): bloco do copy (`headline`,
   *  `cta.main`, `handwritten`, `benefits.1.title`…). `match` (TRANSIÇÃO): bateu com o esperado; erros = !match */
  items: { expected: string; seen: string | null; critical: boolean; key?: string; match?: boolean }[];
  /** §A10 (TRANSIÇÃO): texto que a imagem escreveu e não estava no copy. Se conta como crítico = G3 (pendente do Gusta) */
  extraText?: string[];
}
/** §A10: etapa do STATIC em render (`retake` = 2ª imagem por texto crítico ou recusa) */
export type StaticRenderStage = 'image' | 'text_check' | 'retake';

// ───────────────────────── estados (§3) ─────────────────────────
export type IterateStatus = 'ANALYZING' | 'PLANNING' | 'PLAN_READY' | 'ANALYSIS_FAILED' | 'LAUNCHED';
export type IteratePhase = 'analyze' | 'generate' | 'download';
/** Derivado (§3.2), nunca salvo. */
export type PieceStatus = 'planned' | 'queued' | 'rendering' | 'ready' | 'failed' | 'left_out';
export type AnalysisStage = 'reading' | 'brain' | 'planning';

// ───────────────────────── §5.1 GET /iterate/config ─────────────────────────
export interface IterateConfig {
  maxBytes: number; minSec: number; maxSec: number; mimeTypes: string[];
  /** linha "custa cerca de US$ X" antes de subir (vídeo de 30 s) */
  analysisUsdPerSec: number; analysisTypicalUsd: number;
  /** tipos no build (v1: os 9) */
  types: AutoVariationType[];
  /** SEMPRE `false` aqui (campo legado da v1). O estado real da conexão o web lê em `GET /meta/connection` (`metaReady`: ACTIVE + conta + página), meta-v1 §3.1; 21/10 */
  metaConnected: false;
  /** ofertas ativas; > 1 = o web mostra o seletor (D3) */
  offers: { id: string; name: string; language: string }[];
  /** única oferta, ou a última usada num lote AUTO */
  defaultOfferId: string | null;
  /** até 3 vencedores em vídeo ("Or pick from your Library") */
  recentWinners: LibraryItem[];
  /** rev. 23/10 (TRANSIÇÃO): preço de 1 imagem do STATIC (GPT Image 2 high 1k), pra "~US$ X" no botão do formato e no retry */
  staticImageUsd?: number;
}

// ───────────────────────── insight (porquê + blocos) ─────────────────────────
export interface WhyLine {
  key: 'hook' | 'proof' | 'cta';
  /** idioma da interface, ≤ 120 */
  text: string;
  refSource: 'brain' | 'video';
  /** refSource brain: o web monta "Brain › <campo>" */
  brainField: BrainField | null;
  /** ≤ 60 ("tried and gave up") */
  ref: string;
}
export type SwapReason = 'no_page' | 'no_proof' | 'no_offer' | 'short_video' | 'no_speech';
export interface AutoInsight {
  blocks: { index: number; label: string; fn: BlockFn | null; startSec: number; endSec: number; kept: boolean }[];
  /** sempre 3, na ordem hook, proof, cta */
  why: WhyLine[];
  /** 2-4 pílulas "Kept in every piece" */
  kept: string[];
  flags: { brainEmpty: boolean; shortVideo: boolean; metaConnected: false; pageCaptured: boolean; smallBatch: boolean };
  swaps: { from: AutoVariationType; to: AutoVariationType; reason: SwapReason }[];
  /** 25/10 (headline-e-legenda-v1 §2.1): o campeão não tem legenda queimada → toda peça de vídeo do lote ganha legenda
   *  palavra a palavra. Ausente = false (lotes antigos). */
  captionsAuto?: boolean;
  /** legenda-protegida-v1 §2.3 (26/10): templates/tipos que o plano não ofereceu porque tampariam a legenda queimada.
   *  O web mostra "Este formato precisa do vídeo sem legenda" + "Enviar versão sem legenda". Ausente = nenhum. */
  captionBlocked?: { type: AutoVariationType; template: FrameTemplateId | null; reason: 'burned_captions' }[];
  /** 26/10: resultado do `cleanUploadId` do `POST /iterate` (conferido antes do plano). `applied` = o plano já usou a versão
   *  sem legenda; `mismatch` = não é o mesmo vídeo (`reason` igual ao 422 CLEAN_VERSION_MISMATCH). Ausente = não mandou. */
  cleanVersion?: { status: 'applied' | 'mismatch'; reason: 'duration' | 'resolution' | 'fps' | 'content' | null };
}
/** legenda-protegida-v1 §4.2: veredito da checagem por visão (em `renders.input.captionCheck`). */
export interface CaptionCheck {
  status: 'ok' | 'covered' | 'skipped';
  /** F10 (28/10): `problem` e `reason` = o veredito do quadro e o motivo dado pelo modelo (null = ok / não disse).
   *  Opcionais: renders gravados antes de 28/10 não têm. */
  frames: {
    atSec: number; ok: boolean; seen: string | null;
    problem?: 'covered' | 'cut' | 'missing' | 'illegible' | 'duplicated' | 'wrong_text' | null;
    reason?: string | null;
  }[];
  attempt: number;
}
/** 25/10 (headline-e-legenda-v1 §1): "original → nova" na peça HEADLINE. `original` = texto da headline do campeão (null no `add`). */
export interface PieceHeadline { mode: 'replace' | 'add'; original: string | null; text: string; highlight: string | null }

// ───────────────────────── peça ─────────────────────────
/** rev. 23/10: estado de um formato da peça (o render vigente daquele formato; sem render = `none`). */
export type PieceFormatState = 'none' | 'queued' | 'rendering' | 'ready' | 'failed';
export interface PieceFormat {
  format: FormatCode;
  state: PieceFormatState;
  /** 0-100 em `rendering` (STATIC: 0 até a imagem chegar); null nos outros */
  progress: number | null;
  /** só em `failed` (RENDER_ERROR, SAFETY_BLOCK, PROVIDER_TIMEOUT, PROVIDER_ERROR, DOWNLOAD_INVALID, SOURCE_UNAVAILABLE) */
  errorCode: string | null;
  failReason: string | null;
  /** custo de pedir (`none`) ou refazer (`failed`) agora: STATIC = staticImageUsd; vídeo = 0; null nos outros estados */
  requestUsd: number | null;
  /** 25/10 (TRANSIÇÃO): false = o template da moldura não tem este formato (§B4); o web esconde o botão. Ausente = true */
  supported?: boolean;
  /** 25/10 (§A10, TRANSIÇÃO): checagem de texto da imagem deste formato (STATIC assembled); null = vídeo/legado/não pronto */
  textCheck?: StaticTextCheck | null;
}
export interface PieceFile {
  format: FormatCode; name: string; url: string; mimeType: 'video/mp4' | 'image/png'; sizeBytes: number; durationSec: number | null;
}
export interface IteratePiece {
  /** = VariationItem.id (estável do plano ao download) */
  id: string;
  index: number; type: AutoVariationType; code: string; axis: VariationAxis;
  /** 25/10 (headline-e-legenda-v1 §1): só na peça HEADLINE; null/ausente nas outras */
  headline?: PieceHeadline | null;
  /** legenda-protegida-v1 §2.2 (26/10): 'replaced' = a legenda queimada foi recortada e refeita no estilo do original */
  captionNote?: 'replaced' | null;
  /** "a única coisa que muda" (idioma da interface) */
  change: string;
  status: PieceStatus;
  /** 9:16 pronto: libera o preview (rev. 23/10: = `ready`, o 9:16 é o único formato do lote) */
  previewReady: boolean;
  /** rev. 23/10 (TRANSIÇÃO): STATIC = 'image' (PNG do GPT Image 2); resto = 'video' */
  media?: 'video' | 'image';
  /** `stage`/`attempt` (25/10, §A10, TRANSIÇÃO): só STATIC; attempt 1 ou 2 */
  render: { format: FormatCode; progress: number; frame: number | null; frames: number | null; stage?: StaticRenderStage; attempt?: 1 | 2 } | null;
  formatsReady: 0 | 1 | 2 | 3;
  /** rev. 23/10 (TRANSIÇÃO): sempre os 3, na ordem 9x16, 4x5, 1x1. 9x16 nasce no Gerar; 4x5/1x1 = `none` até o pedido */
  formats?: PieceFormat[];
  errorCode: string | null; failReason: string | null;
  /** 25/10: 'leave_out' = FRAME_TEXT_OVERFLOW (o texto não coube; refazer não adianta) */
  retryHint: 'retry' | 'use_product_photo' | 'leave_out' | null;
  /** rev. 23/10 (TRANSIÇÃO): custo do Retry da peça (STATIC = staticImageUsd; resto 0); null se não há retry */
  retryUsd?: number | null;
  inZip: boolean;
  creativeId: string | null;
  poster: FileRef | null;
  /** só formatos READY (rev. 23/10: 9:16 + os sob demanda que ficaram prontos) */
  files: PieceFile[];
  folder: '1-stretch' | '2-new-audience';
  /** 25/10 (TRANSIÇÃO): só FRAME (template, 2ª fonte, proveniência); null nos outros */
  frame?: PieceFrame | null;
  /** 25/10 (TRANSIÇÃO): só STATIC `layout: 'assembled'` com imagem pronta; null = vídeo ou legado */
  textCheck?: StaticTextCheck | null;
  /** 25/10 (D14, TRANSIÇÃO): FRAME read_caption = texto do anúncio sugerido (padrão do Meta publish e README do zip); null nos outros */
  suggestedPrimaryText?: string | null;
}

// ───────────────────────── §5.1 GET /iterate/:id ─────────────────────────
export interface IterateAnalysis {
  stage: AnalysisStage | null; step: 1 | 2 | 3; progress: number; etaSec: number | null;
  /** chaves do §5.2: decode, transcribe, cuts, edit_map, blocks · audience, offer, proof, page · planning */
  checklist: { key: string; status: 'done' | 'running' | 'pending' | 'failed' }[];
}
export interface IterateError {
  code: string;
  /** frase humana (fallback EN; o web traduz pelo code) */
  reason: string;
  /** detalhe técnico (mono) */
  detail: string | null;
  params: Record<string, string | number>;
  stage: AnalysisStage;
  /** soma real das cost_entries desta tentativa; "Nothing was charged" só quando 0 */
  chargedUsd: number;
  action: 'upload_another' | 'try_again';
}
export interface IterateZip {
  status: 'none' | 'building' | 'ready' | 'failed';
  fileName: string | null; url: string | null; sizeBytes: number | null;
  pieces: number; files: number;
  /** nomes das pastas no idioma da interface */
  folders: { stretch: string; newAudience: string };
}
export interface IterateBatch {
  id: string; status: IterateStatus; phase: IteratePhase;
  offer: { id: string; name: string; language: string };
  codeLanguage: CodeLanguage;
  source: {
    championId: string; name: string; fromLibrary: boolean;
    /** meta-v1 D13: veio de POST /iterate { metaAdId } */
    fromMeta: boolean;
    durationSec: number | null;
    width: number | null; height: number | null; ratioLabel: string | null; cuts: number | null;
    thumbnail: FileRef | null; video: FileRef | null;
  };
  analysis: IterateAnalysis;
  /** blocks parciais (fn null) já em PLANNING; completo em PLAN_READY */
  insight: AutoInsight | null;
  error: IterateError | null;
  pieces: IteratePiece[];
  summary: {
    pieces: number; stretch: number; newAudience: number; files: number; ready: number; failed: number; leftOut: number;
    /** rev. 23/10: só renders na fila/renderizando (9:16 do lote + formatos pedidos); STATIC conta ~60 s fixos */
    renderEtaSec: number | null;
    /** continua 0: nenhum crédito de VÍDEO pago (o STATIC é imagem, vai em cost.imagesUsd) */
    videoCreditsUsd: 0;
  };
  cost: {
    analysisEstimateUsd: number; analysisUsd: number;
    /** rev. 23/10 (TRANSIÇÃO): estimativa do "Generate N pieces" (nº de STATIC × staticImageUsd); só em PLAN_READY, senão null. Vai no `expectedCostUsd` do start */
    generateEstimateUsd?: number | null;
    /** rev. 23/10 (TRANSIÇÃO): soma real das cost_entries IMAGE do lote (STATIC no Gerar, retries e formatos sob demanda) */
    imagesUsd?: number;
    /** Remotion na VPS: sempre 0 */
    renderUsd: 0;
    /** analysisUsd + imagesUsd */
    totalUsd: number;
  };
  zip: IterateZip;
  downloadedAt: string | null; createdBy: UserRef; createdAt: string; launchedAt: string | null;
}

// ───────────────────────── corpos ─────────────────────────
/** Exatamente um de uploadId/creativeId/metaAdId. offerId: obrigatório só com > 1 oferta ativa (422 OFFER_REQUIRED). metaAdId: meta-v1 D13 (anúncio do snapshot; 404 se não estiver lá, 422 META_NOT_CONNECTED sem conexão). */
/** 26/10 (legenda-protegida-v1 D-LP5): `cleanUploadId` = upload (purpose CHAMPION_VIDEO) da versão sem legenda, preso já na
 *  criação; conferido quando a análise acaba (antes do plano). Não bateu = o lote segue com a original e o
 *  `insight.cleanVersion` diz por quê. */
/** 26/10 "Novo lote": `championId` = campeão JÁ analisado (READY) do workspace; reaproveita a análise (nasce PLANNING).
 *  Exatamente um de uploadId/creativeId/metaAdId/championId. */
export interface CreateIterateBody { uploadId?: string; creativeId?: string; metaAdId?: string; championId?: string; offerId?: string; cleanUploadId?: string }
/** O nº mostrado no botão; diferente do plano = 409 PLAN_CHANGED. rev. 23/10: `expectedCostUsd` = `cost.generateEstimateUsd`
 *  mostrado no botão (TRANSIÇÃO: vira obrigatório); estimativa > expected × 1,10 = 409 ESTIMATE_CHANGED; teto = 409 SPEND_CAP_EXCEEDED. */
export interface StartIterateBody { expectedPieces: number; expectedCostUsd?: number }
/** useProductPhoto: SPLIT-LP com a foto do produto da oferta (D4); sem foto = 422 NO_PRODUCT_PHOTO.
 *  25/10 (§A10): também vale pra STATIC `ready` com `textCheck.status = 'mismatch'` (corpo {}; cobra staticImageUsd; teto). */
export interface RetryPieceBody { useProductPhoto?: boolean }
export interface UpdatePieceBody { inZip: boolean }
/** 25/10 (§B3.1): `POST /iterate/pieces/:pieceId/broll` troca o clipe da 2ª fonte (só FRAME de 2 fontes com stock_broll).
 *  Corpo vazio = próximo candidato da busca; `candidateId` = o escolhido em `GET /iterate/pieces/:pieceId/broll/candidates`;
 *  `url` = clipe colado. Re-render grátis (202). URL de fonte fora da v1 = 422 BROLL_SOURCE_NOT_SUPPORTED. */
export interface SwapBrollBody {
  candidateId?: string;
  /** URL colada pelo usuário (YouTube ou TikTok na v1; Instagram depois, §B3.1) + intervalo opcional. Exclusivo com candidateId */
  url?: string; startSec?: number; endSec?: number;
}
export interface BrollCandidate {
  id: string; provenance: BrollProvenance; poster: FileRef; preview: FileRef | null; durationSec: number;
  /** a fala do roteiro que motivou a busca */
  query: string;
}
export interface BrollCandidatesResponse { candidates: BrollCandidate[]; current: string | null }
/** rev. 23/10: `POST /iterate/pieces/:pieceId/formats` (202 enfileirou · 200 já existia na fila/renderizando/pronto). Só peça `ready`.
 *  Mesmo corpo serve de Retry do formato `failed`. STATIC: nova imagem no aspecto (custa staticImageUsd; teto). */
export interface RequestPieceFormatBody { format: Exclude<FormatCode, '9x16'> }
export interface IterateZipResponse { zip: IterateZip }

// ───────────────────────── erros (§5.3) ─────────────────────────
export interface OfferRequiredDetails { offers: { id: string; name: string }[] }
export interface PlanChangedDetails { pieces: number }
/** rev. 23/10: 'format_not_ready' = GET /creatives/:id/download?format= de um formato que não está READY */
export type IterateInvalidStateReason = 'not_a_video' | 'upload_another' | 'nothing_to_zip' | 'variation_locked' | 'format_not_ready'
  /** 25/10: formato que o template da moldura não tem (§B4) */
  | 'format_not_supported';
export type IterateAsyncErrorCode =
  | 'MEDIA_INVALID' | 'MEDIA_TOO_SHORT' | 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'RATE_LIMITED' | 'INTERRUPTED'
  | 'PLAN_INVALID' | 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT' | 'RENDER_ERROR' | 'SOURCE_UNAVAILABLE'
  /** rev. 23/10: imagem do STATIC (peça ou formato) */
  | 'SAFETY_BLOCK' | 'DOWNLOAD_INVALID'
  /** 25/10: texto da moldura não coube no mínimo de 36 px (§B2); `BROLL_UNAVAILABLE`: 2ª fonte de b-roll sumiu/falhou (§B3.1) */
  | 'FRAME_TEXT_OVERFLOW' | 'BROLL_UNAVAILABLE'
  /** legenda-protegida-v1 §3/§4.2 (26/10): a checagem por visão viu a legenda queimada tampada (`retryHint: 'retry'`, sai do zip)
   *  / o build caiu em `blocked` (o plano errou; `leave_out`) */
  | 'CAPTION_COVERED' | 'CAPTION_PROTECTED'
  /** 25/10 (headline-e-legenda-v1 §1.3-§1.4): a headline não coube na caixa e nas linhas (80-100 % do tamanho), a faixa/placa
   *  cobriria o rosto, não há lugar fora do rosto e do texto queimado (`add`, só no render), ou estilo/caixa não medidos.
   *  Todos com `retryHint: 'leave_out'` (refazer não adianta). */
  | 'HEADLINE_TOO_LONG' | 'HEADLINE_OVER_FACE' | 'HEADLINE_NO_ROOM' | 'HEADLINE_LOW_CONFIDENCE';

// ───────────────────────── D4: foto do produto na oferta ─────────────────────────
/** Upload purpose 'PRODUCT_IMAGE' (image/jpeg|png|webp, ≤ 10 MB). PUT /offers/:id/product-image { uploadId }; DELETE remove. */
export interface SetProductImageBody { uploadId: string }
