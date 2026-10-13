// Variação automática de campeão v1 (docs/contratos/variacao-auto-v1.md, APROVADO 13/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Lote AUTO: upload ou Library → análise sozinha → porquê + plano (9 tipos) → Gerar → 3 formatos por peça → "In zip" → zip.
import type { FileRef, LibraryItem, UserRef } from './index';

// ───────────────────────── catálogo ─────────────────────────
export type AutoVariationType = 'CUT' | 'COLD_OPEN' | 'HOOK_TEXT' | 'ENDCARD' | 'SPLIT_LP' | 'STORY' | 'REVIEW' | 'NATIVE_SEARCH' | 'STATIC';
/** Fixo por tipo (§6.1): ITERATION → pasta "esticar a vida"; DIVERSITY → "público novo". */
export type VariationAxis = 'ITERATION' | 'DIVERSITY';
export type BatchMode = 'MANUAL' | 'AUTO';
export type FormatCode = '9x16' | '4x5' | '1x1';
export type BlockFn = 'hook' | 'problem' | 'mechanism' | 'proof' | 'cta' | 'other';
export type BrainField = 'what' | 'audience' | 'pains' | 'promise' | 'proof' | 'offerAndPrice' | 'cta' | 'notes' | 'page';
export type EndcardVariant = 'offer' | 'guarantee' | 'price' | 'cta';
export type CodeLanguage = 'EN' | 'PT';

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
  metaConnected: false;
  /** ofertas ativas; > 1 = o web mostra o seletor (D3) */
  offers: { id: string; name: string; language: string }[];
  /** única oferta, ou a última usada num lote AUTO */
  defaultOfferId: string | null;
  /** até 3 vencedores em vídeo ("Or pick from your Library") */
  recentWinners: LibraryItem[];
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
}

// ───────────────────────── peça ─────────────────────────
export interface PieceFile {
  format: FormatCode; name: string; url: string; mimeType: 'video/mp4' | 'image/png'; sizeBytes: number; durationSec: number | null;
}
export interface IteratePiece {
  /** = VariationItem.id (estável do plano ao download) */
  id: string;
  index: number; type: AutoVariationType; code: string; axis: VariationAxis;
  /** "a única coisa que muda" (idioma da interface) */
  change: string;
  status: PieceStatus;
  /** 9:16 pronto: libera o preview antes dos outros formatos */
  previewReady: boolean;
  render: { format: FormatCode; progress: number; frame: number | null; frames: number | null } | null;
  formatsReady: 0 | 1 | 2 | 3;
  errorCode: string | null; failReason: string | null;
  retryHint: 'retry' | 'use_product_photo' | null;
  inZip: boolean;
  creativeId: string | null;
  poster: FileRef | null;
  /** só formatos READY */
  files: PieceFile[];
  folder: '1-stretch' | '2-new-audience';
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
    championId: string; name: string; fromLibrary: boolean; durationSec: number | null;
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
    renderEtaSec: number | null; videoCreditsUsd: 0;
  };
  cost: { analysisEstimateUsd: number; analysisUsd: number; renderUsd: 0; totalUsd: number };
  zip: IterateZip;
  downloadedAt: string | null; createdBy: UserRef; createdAt: string; launchedAt: string | null;
}

// ───────────────────────── corpos ─────────────────────────
/** Exatamente um de uploadId/creativeId. offerId: obrigatório só por upload com > 1 oferta ativa (422 OFFER_REQUIRED). */
export interface CreateIterateBody { uploadId?: string; creativeId?: string; offerId?: string }
/** O nº mostrado no botão; diferente do plano = 409 PLAN_CHANGED. */
export interface StartIterateBody { expectedPieces: number }
/** useProductPhoto: SPLIT-LP com a foto do produto da oferta (D4); sem foto = 422 NO_PRODUCT_PHOTO. */
export interface RetryPieceBody { useProductPhoto?: boolean }
export interface UpdatePieceBody { inZip: boolean }
export interface IterateZipResponse { zip: IterateZip }

// ───────────────────────── erros (§5.3) ─────────────────────────
export interface OfferRequiredDetails { offers: { id: string; name: string }[] }
export interface PlanChangedDetails { pieces: number }
export type IterateInvalidStateReason = 'not_a_video' | 'upload_another' | 'nothing_to_zip' | 'variation_locked';
export type IterateAsyncErrorCode =
  | 'MEDIA_INVALID' | 'MEDIA_TOO_SHORT' | 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'RATE_LIMITED' | 'INTERRUPTED'
  | 'PLAN_INVALID' | 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT' | 'RENDER_ERROR' | 'SOURCE_UNAVAILABLE';

// ───────────────────────── D4: foto do produto na oferta ─────────────────────────
/** Upload purpose 'PRODUCT_IMAGE' (image/jpeg|png|webp, ≤ 10 MB). PUT /offers/:id/product-image { uploadId }; DELETE remove. */
export interface SetProductImageBody { uploadId: string }
