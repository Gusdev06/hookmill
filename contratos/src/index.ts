/**
 * @maquina/contratos: a API HTTP e os eventos SSE da HookMill em tipos TypeScript.
 * Fonte: docs/contratos/api.md e eventos.md (v1, aprovados 05/10) + feature-2-variar-campeao.md (aprovado 06/10). Dono: maquina-arquiteto.
 *
 * SÓ TIPOS (nenhum valor em runtime): importe sempre com `import type { … } from '@maquina/contratos'`.
 *   - web: tipa o cliente HTTP e o SSE.
 *   - api: DTO de entrada `implements <Body>`; service devolve `Promise<<Resposta>>`.
 *   - testes: confere respostas contra os mesmos tipos.
 * Mudou algo aqui = mudou o contrato: só o arquiteto, junto com o api.md.
 */

// ───────────────────────── §1 compartilhados ─────────────────────────
export type CreativeState =
  | 'SCRIPTS_WRITING' | 'SCRIPTS_READY' | 'SCRIPTS_FAILED'
  | 'AVATAR_PENDING' | 'FACES_GENERATING' | 'FACES_READY' | 'FACES_FAILED'
  | 'ENGINE_PENDING' | 'SCENES_GENERATING' | 'SCENES_FAILED'
  | 'EDIT_PENDING' | 'RENDERING' | 'RENDER_FAILED' | 'RENDER_READY' | 'APPROVED';
export type Step = 'offer' | 'scripts' | 'avatar' | 'engine' | 'generation' | 'edit' | 'review';
export type ChipStatus = 'progress' | 'waiting' | 'failed' | 'approved' | 'draft';
export type Engine = 'SCENES' | 'LIPSYNC';
export type VideoFormat = 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';
export type AssetStatus = 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED';
export type Action =
  | 'retry' | 'regenerate' | 'paste_page_text' | 'fill_manually' | 'change_description' | 'render_again' | 'contact_support'
  | 'upload_video' | 'analyze_again'   // feature 2
  | 'reconnect_meta' | 'choose_account' | 'fix_payment' | 'edit_ad_text' | 'raise_budget'   // meta-v1 (21/10)
  | 'refresh';   // campanhas-v1 (22/10): recarregar o objeto depois de META_OBJECT_CHANGED
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'CLIENT';   // CLIENT: fase2-agencia.md §4
export type UiLocale = 'EN' | 'PT_BR';
export type VoiceGender = 'female' | 'male' | 'neutral';

export interface FileRef { id: string; url: string; mimeType: string; width?: number; height?: number; durationSec?: number }
export interface UserRef { id: string; name: string; initials: string }
export interface Progress { stage: string | null; progress: number; etaSec: number | null }

/**
 * Texto do chip (Home e wizard): a API devolve `statusKey` + `statusParams`; o web traduz pela chave.
 * Regra: `status.draft` quando o chip é draft; senão `status.<state em minúsculas>`. Esta interface É a lista
 * oficial das 16 chaves e dos parâmetros de cada uma (vazio = sem parâmetro).
 */
export interface StatusParamsByKey {
  'status.scripts_writing': { ready: number; total: number };
  'status.scripts_ready': Record<string, never>;
  'status.scripts_failed': Record<string, never>;
  'status.avatar_pending': Record<string, never>;
  'status.faces_generating': { ready: number; total: number };
  'status.faces_ready': Record<string, never>;
  'status.faces_failed': Record<string, never>;
  'status.engine_pending': Record<string, never>;
  'status.scenes_generating': { ready: number; total: number };
  'status.scenes_failed': { failed: number; total: number };
  'status.edit_pending': Record<string, never>;
  'status.rendering': { progress: number };
  'status.render_failed': Record<string, never>;
  'status.render_ready': Record<string, never>;
  'status.approved': Record<string, never>;
  'status.draft': Record<string, never>;
}
export type StatusKey = keyof StatusParamsByKey;

export interface CreativeRow {
  id: string; name: string;
  offer: { id: string; name: string };
  state: CreativeState; step: Step | 'library'; status: ChipStatus;
  /** Um dos `StatusKey` (lista oficial em `StatusParamsByKey`). Tipado como string por enquanto pra não quebrar a onda 2; aperta depois. */
  statusKey: StatusKey | (string & {});
  /** Parâmetros da chave, conforme `StatusParamsByKey[statusKey]`. */
  statusParams: Record<string, string | number>;
  progress: number | null;
  engine: Engine | null; engineModel: string | null;
  thumbnail: FileRef | null;
  createdBy: UserRef; updatedAt: string;
  /** Feature 2: preenchido quando o criativo é variação de um campeão; null no criativo do zero. */
  variation: VariationRef | null;
  /** editor-v1 §5.1 (D1): selo "editado" = o render final (ou o vigente, antes de aprovar) saiu com doc não vazio. */
  editedInEditor: boolean;
}

export interface OfferBrief {
  kind: string | null; what: string | null; audience: string | null; promise: string | null;
  pains: string | null; proof: string | null; offerAndPrice: string | null; cta: string | null; notes: string | null;
}
export type OfferBriefField = keyof OfferBrief;
export type FieldSources = Partial<Record<OfferBriefField | 'name' | 'language', 'page' | 'user'>>;
export interface Offer extends OfferBrief {
  id: string; name: string; language: string; sourceUrl: string | null;
  fieldSources: FieldSources;
  creativesCount: number; winnersCount: number; updatedAt: string;
  /** variacao-auto-v1 D4: foto opcional do produto (reserva do SPLIT-LP). Opcional até o backend preencher (ausente = null). */
  productImage?: FileRef | null;
  /** briefing-leitura-v2 D5 (22/10): "lido de" persistido (`offers.read_meta`); null = oferta criada à mão ou antes da v2. Opcional no pacote até o web mandar/ler; o backend devolve sempre. */
  readMeta?: OfferReadMeta | null;
}

// ───────── briefing-leitura-v2 (22/10, §4): leitura em camadas ─────────
/** O mais "fundo" que precisou rodar: texto colado, HTTP puro, render headless, subpáginas, imagens com visão. */
export type ReadMode = 'pasted' | 'http' | 'rendered' | 'crawled' | 'vision';
/** 28/10 (A1, caminhante de funil): `quiz_step` = tela de quiz percorrida; `offer` = tela final de oferta do funil. */
export type PageRole = 'main' | 'checkout' | 'pricing' | 'about' | 'faq' | 'testimonials' | 'terms' | 'thankyou' | 'other' | 'quiz_step' | 'offer';
/** Imagem que entrou na chamada do briefing (sem base64: só referência + o que o modelo leu). */
export interface PageImageRef {
  index: number; src: string; alt: string | null; kind: 'screenshot' | 'img' | 'poster'; widthPx: number; heightPx: number;
  /** o que o Claude viu (imageNotes, ≤ 40 palavras); ausente = não leu */
  read?: string;
}
export interface ReadPageRef { url: string; role: PageRole; via: 'http' | 'rendered'; chars: number }
/** De onde saiu um campo do briefing; `imageIndex` presente = veio de imagem. */
export interface FieldOrigin { role: PageRole; url: string; imageIndex?: number }
export type FieldOrigins = Partial<Record<OfferBriefField | 'name', FieldOrigin[]>>;
/** D5: `offers.read_meta` = o "lido de" que sobrevive ao wizard. */
export interface OfferReadMeta {
  readMode: ReadMode; pages: ReadPageRef[]; imagesRead: PageImageRef[]; fieldOrigins: FieldOrigins;
  /** custo real da chamada (texto + visão), US$ */
  costUsd: number;
  readAt: string;
}

export type JobType = 'OFFER_EXTRACT' | 'SCRIPTS_GENERATE' | 'SCRIPT_REGENERATE'
  | 'CHAMPION_RESOLVE' | 'CHAMPION_ANALYZE' | 'VARIATIONS_PLAN' | 'VARIATION_ITEM_REGENERATE'   // feature 2
  | 'AUTO_PLAN' | 'ZIP_BUILD'   // variacao-auto-v1
  | 'META_SYNC' | 'META_IMPORT' | 'META_PUBLISH';   // meta-v1 (21/10)
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export interface Job extends Progress {
  id: string; type: JobType; status: JobStatus;
  checklist: { key: string; done: boolean }[];
  errorCode: AsyncErrorCode | null; failReason: string | null; action: Action | null;
  output: unknown | null;
}
export interface OfferExtractOutput {
  name: string; language: string; sourceUrl: string | null; brief: OfferBrief; fieldSources: FieldSources;
  // briefing-leitura-v2 §4.2 (22/10): o backend preenche SEMPRE; opcionais no pacote até o web ler (convenção dos aditivos)
  /** camada mais funda que rodou (`pasted` com texto colado) */
  readMode?: ReadMode;
  /** páginas lidas na ordem de prioridade; pages[0].role === 'main' */
  pages?: ReadPageRef[];
  /** só as imagens que entraram na chamada, com `read` */
  imagesRead?: PageImageRef[];
  /** detalhe por campo pro tooltip "lido de"; `fieldSources` continua `page|user` (é o que a Offer persiste) */
  fieldOrigins?: FieldOrigins;
  /** custo real da chamada (texto + visão), US$ */
  costUsd?: number;
  /** D5/D6: o mesmo `readMode/pages/imagesRead/fieldOrigins/costUsd` + `readAt`, pronto pra gravar. O web repassa
   *  no "apply": `CreateOfferBody.readMeta` (oferta nova) ou `UpdateOfferBody.readMeta` (reread/onboarding). */
  readMeta?: OfferReadMeta;
  /** @deprecated = pages.filter(p => p.role !== 'main').map(p => p.url); mantido 1 versão pro web atual */
  relatedUrls?: string[];
  /** resultado-v1 (28/10, A2): sugestões pro passo 1 (ramo, mercado, cor, resultado, prefixo). O backend preenche sempre. */
  business?: BusinessSuggestion;
}

export interface ScriptBlock { label: string; startSec: number; endSec: number; speech: string; visualPrompt: string }
export interface Script {
  id: string; letter: string; status: 'WRITING' | 'READY' | 'FAILED';
  angle: string | null; rationale: string | null; durationSec: number | null;
  blocks: ScriptBlock[];
  editedByUser: boolean; selected: boolean;
  failReason: string | null;
}

export interface Face {
  id: string; batch: number; position: number; status: AssetStatus; image: FileRef | null;
  failReason: string | null; errorCode: AsyncErrorCode | null; action: Action | null; selected: boolean;
}

export interface Scene {
  id: string; index: number; label: string; startSec: number; endSec: number;
  speech: string; visualPrompt: string;
  status: AssetStatus; progress: number; attempt: number;
  failReason: string | null; errorCode: AsyncErrorCode | null; action: Action | null;
  clip: FileRef | null; thumbnail: FileRef | null;
  /** Como a cena nasce (§13.5): o web usa pra rótulo e ação ("Refazer o clipe" em TAKE_SLICE; sem refazer em SOURCE_CUT/REUSE).
   *  Valor literal do enum do banco (scenes.pipeline), sem tradução. */
  pipeline: ScenePipeline;
  /** §13.5: fatia de um take contínuo (pipeline TAKE_SLICE). null em SCENE_VIDEO/SOURCE_CUT e em criativos antigos. */
  take: { id: string; startSec: number; endSec: number } | null;
  /** §13.15: trecho main do Trocar avatar no Kling/Seedance (pipeline SWAP_VIDEO). null nas outras. */
  swap: SceneSwap | null;
}

export interface EditSettings {
  templateId: string; captionStyle: 'word' | 'line' | 'off'; captionPosition: 'top' | 'middle' | 'bottom';
  headline: string | null; ctaText: string; endCard: boolean;
}

export interface Render {
  id: string; status: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED';
  stage: string | null; progress: number; frame: number | null; totalFrames: number | null;
  failReason: string | null; failedFrame: number | null; action: Action | null;
  video: FileRef | null; durationSec: number | null; settings: EditSettings; createdAt: string;
  /** editor-v1 §3.4: cópia do EditDoc usado (null = só o template) e a revisão do criativo renderizada (null = render antigo). */
  doc: EditDoc | null; editRevision: number | null;
}

export interface StepInfo { step: Step; state: 'done' | 'current' | 'progress' | 'failed' | 'todo' }

export interface CreativeDetail extends CreativeRow {
  language: string; format: VideoFormat; voiceId: string | null;
  steps: StepInfo[];
  summary: { scriptLetter: string | null; scriptDurationSec: number | null; face: FileRef | null; engineLabel: string | null };
  faceDescription: string | null;
  editSettings: EditSettings | null; editDirty: boolean;
  estimatedCostUsd: number | null; costUsd: number;
  finalRender: Render | null; approvedAt: string | null; isWinner: boolean;
  /** §13.5: o clipe contínuo de lipsync da geração vigente (null em SCENES/Kling-Seedance e em NEW_HOOKS TEXT). */
  take: Take | null;
  /** fase2-agencia.md §6: nome padronizado sem ".mp4", congelado no OK final; null antes */
  adName: string | null;
  savedAt: string;
}

// ───────────────────────── envelopes e erros ─────────────────────────
export interface PageMeta { nextCursor: string | null }
export interface SuccessEnvelope<T, M = undefined> { success: true; data: T; meta?: M }
export interface ErrorEnvelope {
  success: false;
  error: { code: ApiErrorCode; message: string; statusCode: number; details?: ErrorDetails | Record<string, unknown> };
}
export type ApiErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'INVALID_CREDENTIALS' | 'REFRESH_INVALID' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'INVALID_STATE' | 'CONFIRM_DOWNSTREAM_RESET' | 'OFFER_INCOMPLETE' | 'SPEND_CAP_EXCEEDED' | 'ESTIMATE_CHANGED'
  | 'INVITE_INVALID' | 'EMAIL_TAKEN' | 'LAST_OWNER' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR'
  // feature 2
  | 'AD_LIBRARY_UNAVAILABLE' | 'MEDIA_TOO_LARGE' | 'MEDIA_TOO_SHORT' | 'MEDIA_TOO_LONG' | 'MEDIA_INVALID'
  | 'UPLOAD_EXPIRED' | 'UPLOAD_INCOMPLETE' | 'NO_SPEECH' | 'KIND_NOT_ENABLED' | 'BATCH_INCOMPLETE'
  // §13 (manter a edição + take contínuo)
  | 'KEEP_EDIT_UNSUPPORTED' | 'LIPSYNC_AUDIO_TOO_LONG'
  // editor-v1 §5.4
  | 'EDIT_CONFLICT' | 'EDIT_NOT_SUPPORTED'
  // fase2-agencia.md §7
  | 'ONBOARDING_INCOMPLETE'
  // meta-v1.md §3.4 (21/10): síncronos da Meta (os de OAuth voltam na query do redirect, não aqui)
  | 'META_NOT_CONFIGURED' | 'META_NOT_CONNECTED' | 'META_SELECTION_MISSING' | 'META_TOKEN_INVALID' | 'META_PERMISSION'
  | 'META_PIXEL_REQUIRED' | 'META_ACCOUNT_UNUSABLE' | 'META_BUDGET_TOO_LOW' | 'META_UNAVAILABLE'
  // campanhas-v1.md §4.1 (22/10): escritas na tela Campaigns
  | 'META_OBJECT_CHANGED' | 'META_OBJECT_GONE' | 'META_PARENT_PAUSED' | 'META_BUDGET_NOT_EDITABLE' | 'META_BUDGET_STEP_TOO_LARGE'
  // molduras §B3.1 (25/10): URL colada na troca de b-roll de fonte desligada/fora da v1 (D15)
  | 'BROLL_SOURCE_NOT_SUPPORTED'
  // legenda-protegida-v1 §2.3 (26/10): a versão sem legenda não é o mesmo vídeo (duração, resolução, fps ou conteúdo)
  | 'CLEAN_VERSION_MISMATCH'
  // campanhas-v1 §4.1 (22/10): 422 síncrono ao ativar anúncio DISAPPROVED/WITH_ISSUES (homônimo do assíncrono do publish)
  | 'META_POLICY'
  // variacao-auto-v1 §5.3
  | 'OFFER_REQUIRED' | 'PLAN_CHANGED' | 'NO_PRODUCT_PHOTO';
export interface ErrorDetails {
  /** rule: livre nos DTOs; no PUT /editor também os `EditDocRule` (editor-v1 §5.4). */
  VALIDATION_ERROR: { fields: { field: string; rule: EditDocRule | (string & {}) }[] };
  /** `state`/`allowed` são do recurso da rota (criativo, campeão ou lote). `reason` (feature 2): 'variation_locked' | 'change_not_available'. */
  INVALID_STATE: { state: string; allowed: string[]; reason?: 'variation_locked' | 'change_not_available' | 'regenerate_take' | 'regenerate_swap_scene' | 'onboarding_completed';
    /** só com reason 'regenerate_take' (§13.5): a fatia é de um take; refazer = o take inteiro, com confirm + expectedCostUsd */
    takeId?: string; estimateUsd?: number };
  CONFIRM_DOWNSTREAM_RESET: { scenesLost: number; rendersLost: number; spentUsd: number };
  OFFER_INCOMPLETE: { missing: OfferBriefField[] };
  SPEND_CAP_EXCEEDED: { spentUsd: number; capUsd: number; estimateUsd: number };
  ESTIMATE_CHANGED: { estimateUsd: number };
  RATE_LIMITED: { retryAfterSec: number };
  PROVIDER_UNAVAILABLE: { provider: 'ANTHROPIC' | 'WAVESPEED' | 'HIGGSFIELD' };
  // feature 2
  AD_LIBRARY_UNAVAILABLE: { reason: 'quota' | 'not_configured' | 'provider_error'; retryAfter: string | null };
  MEDIA_TOO_LARGE: { maxBytes: number };
  MEDIA_TOO_SHORT: { durationSec: number; minSec: number };
  MEDIA_TOO_LONG: { durationSec: number; maxSec: number };
  MEDIA_INVALID: { reason: 'mime' | 'no_video' | 'undecodable' | 'too_small' };
  UPLOAD_INCOMPLETE: { expectedBytes: number; actualBytes: number | null };
  NO_SPEECH: { kind: VariationKind };
  KIND_NOT_ENABLED: { kind: VariationKind };
  KEEP_EDIT_UNSUPPORTED: { kind: VariationKind; blockers: KeepEditBlockerHit[] };
  LIPSYNC_AUDIO_TOO_LONG: { durationSec: number; maxSec: 600 };
  EDIT_CONFLICT: EditConflictDetails;
  EDIT_NOT_SUPPORTED: EditNotSupportedDetails;
  ONBOARDING_INCOMPLETE: { missing: ('resultType' | 'offer')[] };   // fase2-agencia.md §7 (resultado-v1 28/10: era 'businessType')
  BATCH_INCOMPLETE: { missing: ({ castingId: string; reason: 'face_not_selected' } | { itemId: string; reason: 'not_ready' } | { field: 'voiceId' })[] };
}
/** Falha dentro de trabalho assíncrono (job, rosto, cena, render). Não é erro HTTP. */
export type AsyncErrorCode =
  | 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'RATE_LIMITED' | 'SAFETY_BLOCK' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR'
  | 'CANCELLED' | 'DOWNLOAD_INVALID' | 'INTERRUPTED' | 'RENDER_ERROR'
  | 'AD_LIBRARY_UNAVAILABLE' | 'AD_NOT_FOUND' | 'AD_HAS_NO_VIDEO' | 'MEDIA_INVALID'   // feature 2
  | 'LIPSYNC_AUDIO_TOO_LONG'
  | SwapAsyncErrorCode
  | MetaAsyncErrorCode;   // meta-v1 (21/10)                                                             // §13.15                                                       // §13.5: TTS real passou de 600 s

// ───────────────────────── §2 auth ─────────────────────────
export interface LoginBody { email: string; password: string }
export interface RefreshBody { refreshToken: string }
export interface LogoutBody { refreshToken: string }
export interface SwitchWorkspaceBody { workspaceId: string }
export interface AcceptInviteBody { name?: string; password?: string }
export interface UpdateMeBody {
  name?: string; uiLocale?: UiLocale; password?: { current: string; next: string };
  /** onboarding-v2 §3.1: AGENCY | OWN. AGENCY → OWN nunca dá 409 (D9) */
  accountMode?: AccountMode;
}
export interface AuthUser {
  id: string; name: string; email: string; uiLocale: UiLocale;
  /** onboarding-v2: null = ainda não respondeu (o shell trata como AGENCY) */
  accountMode: AccountMode | null;
}
export interface WorkspaceRef {
  id: string; name: string; role: Role;
  /** onboarding-v2 §3.5: no workspace ativo e em cada item de MeResponse.workspaces[] (seletor "Setup 33 %") */
  status: ClientStatus;
  onboarding: OnboardingSummary;
  /** onboarding-v2 §3.4: só no workspace ATIVO (membership do usuário nele); ausente nos itens de workspaces[] */
  tourCompletedAt?: string | null;
}
export interface AuthSession { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser; workspace: WorkspaceRef }
export interface MeResponse { user: AuthUser; workspace: WorkspaceRef; workspaces: WorkspaceRef[] }
export interface InviteInfo { workspaceName: string; email: string; role: Role }

// ───────────────────────── §3 home ─────────────────────────
export type CreativeFilter = 'all' | 'progress' | 'needs_you' | 'approved';
export interface ListCreativesQuery {
  filter?: CreativeFilter; q?: string; offerId?: string; limit?: number; cursor?: string;
  championId?: string; origin?: 'scratch' | 'variation';   // feature 2
}
export interface CreativesMeta extends PageMeta {
  counts: Record<CreativeFilter, number>;
  /** fase2-agencia.md §3.6: sempre presente, independe do filtro; total = o número do "Waiting for you" (igual ao cartão do Clients) */
  waitingOnYou: WaitingOnYou;
  /** lotes esperando a pessoa (até 6, updatedAt desc); só com filter=needs_you, senão [] */
  waitingBatches: WaitingBatchRef[];
}

// ───────────────────────── §4 ofertas ─────────────────────────
export type ExtractOfferBody = { url: string } | { pageText: string; url?: string };
export interface CreateOfferBody extends Partial<OfferBrief> {
  name: string; language: string; sourceUrl?: string; fieldSources?: FieldSources;
  /** briefing-leitura-v2 D5: oferta nova — o web repassa `output.readMeta` do OFFER_EXTRACT. */
  readMeta?: OfferReadMeta;
}
/** D6: no apply do reread (wizard ou onboarding com oferta existente) o web manda `output.readMeta` junto com os campos; `null` limpa. */
/** `fieldSources` (QA bug 14, 22/10): origem que o apply manda por campo (`page` ao aplicar leitura); sem ele, todo campo enviado vira `user`. */
export type UpdateOfferBody = Partial<OfferBrief & { name: string; language: string; sourceUrl: string | null; readMeta: OfferReadMeta | null; fieldSources: FieldSources }>;
export type RereadOfferBody = Record<string, never> | { pageText: string };

// ───────────────────────── §6 criativo ─────────────────────────
export interface CreateCreativeBody { offerId: string; name?: string; scriptCount?: number }
export interface UpdateCreativeBody { name: string }

// ───────────────────────── §7 scripts ─────────────────────────
export interface GenerateScriptsBody { count: number; replace: boolean; confirm?: boolean }
export interface RegenerateScriptBody { confirm?: boolean }
export interface UpdateScriptBody { angle?: string; blocks?: { index: number; speech?: string; visualPrompt?: string }[]; confirm?: boolean }
export interface SelectBody { confirm?: boolean }
export interface WinnerUsed { creativeId: string; name: string; offerName: string; sameOffer: boolean }
export interface ScriptsResponse { scripts: Script[]; job: Job | null; winnersUsed: WinnerUsed[] }
export interface GenerateScriptsResponse { job: Job; scripts: Script[] }
export interface RegenerateScriptResponse { job: Job; script: Script }

// ───────────────────────── §8 avatar ─────────────────────────
/** §13.13 (07/10): quantos rostos gerar (1-4). Rosto do zero: padrão 4. Elenco de variação: padrão 1. "Mais N rostos" manda o mesmo count. */
export type FaceCount = 1 | 2 | 3 | 4;
export interface GenerateFacesBody { description: string; count?: FaceCount }
export interface FaceDescriptionBody { description: string }
export interface FacesResponse {
  description: string | null;
  batches: { batch: number; description: string; faces: Face[] }[];
  /** §13.13: preço do Soul por rosto (CatalogService.estimateFaces(1)); a tela mostra count × faceUnitPriceUsd. */
  faceUnitPriceUsd: number;
  selectedFaceId: string | null;
}
export interface GenerateFacesResponse { batch: number; faces: Face[] }   // faces.length = count

// ───────────────────────── §9 engine ─────────────────────────
export interface EngineCatalog {
  engines: { id: Engine; models: { id: string; label: string; maxSceneSec: number }[]; tradeoffKey: string }[];
  formats: VideoFormat[];
}
export interface Voice { id: string; name: string; language: string; gender: VoiceGender; sample: FileRef | { url: string } }
export interface EstimateQuery { engine: Engine; model: string; format: VideoFormat; voiceId?: string }
export type EstimateWarning = 'voice_gender_mismatch';
export interface Estimate {
  costUsd: number; etaSec: number; sceneCount: number;
  lines: { kind: 'VIDEO' | 'TTS' | 'LIPSYNC' | 'TRANSCRIBE'; units: number; unit: string; unitPriceUsd: number; amountUsd: number }[];
  spend: { monthUsd: number; capUsd: number | null; afterUsd: number };
  warnings: EstimateWarning[];
}
export interface UpdateEngineBody { engine?: Engine; engineModel?: string; voiceId?: string | null; format?: VideoFormat }
export interface GenerateBody { engine: Engine; engineModel: string; voiceId?: string; format: VideoFormat; expectedCostUsd: number; confirm?: boolean }
export interface GenerateResponse { creative: CreativeDetail; scenes: Scene[] }

// ───────────────────────── §10 generation ─────────────────────────
export interface ScenesSummary { ready: number; total: number; failed: number; progress: number; etaSec: number | null }
export interface ScenesResponse { summary: ScenesSummary; scenes: Scene[] }
/** §13.5: cena TAKE_SLICE regera o TAKE inteiro → exige confirm + expectedCostUsd (sem eles: 409 INVALID_STATE reason 'regenerate_take'). */
export interface RegenerateSceneBody { visualPrompt?: string; speech?: string; confirm?: boolean; expectedCostUsd?: number }

// ───────────────────────── §11 edit ─────────────────────────
/** `kind: 'remix'` (templates que reaproveitam o vídeo do campeão) só existe depois do REMIX_EDIT (pós-10/10). */
export interface Template { id: string; kind: 'scratch' | 'remix'; labelKey: string; thumbnail: { url: string }; supportsHeadline: boolean }
export interface EditResponse { settings: EditSettings; dirty: boolean; latestRender: Render | null; previewRender: Render | null;
  /** editor-v1 §5: há doc não vazio salvo / o botão "Editar no vídeo" pode abrir (remix-keep: false até o F3). */
  hasEditorChanges: boolean; editorAvailable: boolean }
export type UpdateEditBody = Partial<EditSettings>;

// ───────────────────────── §12 review ─────────────────────────
export type ChangeType = 'SCENE' | 'TEXT' | 'LINE' | 'FACE';
export interface ReviewResponse {
  creative: CreativeDetail; video: FileRef;
  facts: { offerName: string; scriptLetter: string; angle: string; face: FileRef; engineLabel: string; durationSec: number; format: VideoFormat; costUsd: number };
  changeOptions: { type: ChangeType; returnsTo: Step; estimateUsd: number; etaSec: number;
    /** §13.15: SCENE em criativo SWAP_VIDEO = rótulo do trecho mais caro, cujo preço vai em estimateUsd ("Trecho 3"). Ausente nos outros. */
    sceneLabel?: string }[];
}
export type ChangeRequestBody =
  | { type: 'SCENE'; sceneIndex: number; note?: string }
  | { type: 'LINE'; sceneIndex: number; newSpeech: string; note?: string }
  | { type: 'TEXT'; note?: string }
  | { type: 'FACE'; note?: string };
export interface ChangeRequestResponse { creative: CreativeDetail; returnTo: Step }

// ───────────────────────── §13 library ─────────────────────────
export interface LibraryQuery {
  offerId?: string; winners?: boolean; limit?: number; cursor?: string;
  championId?: string; variationKind?: VariationKind;   // feature 2
  variationCode?: string; media?: 'video';               // variacao-auto-v1 §5.1
}
export interface LibraryItem {
  id: string; name: string; offer: { id: string; name: string }; engineLabel: string; durationSec: number;
  video: FileRef; thumbnail: FileRef; isWinner: boolean; approvedAt: string; approvedBy: UserRef;
  variation: VariationRef | null;   // feature 2
  editedInEditor: boolean;           // editor-v1 §5.1 (D1)
  adName: string | null;             // fase2-agencia.md §6
  /** variacao-auto-v1 §4: 'image' = peça STATIC (o campo `video` carrega o PNG). Opcional até B2 preencher (ausente = 'video'). */
  media?: 'video' | 'image';
  /** variacao-auto-v1 §4: arquivos por formato (peça AUTO). Opcional até B2 preencher. */
  formats?: { format: FormatCode; file: FileRef }[];
}
export interface LibraryMeta extends PageMeta { offers: { id: string; name: string }[] }
export interface WinnerBody { isWinner: boolean }

// ───────────────────────── §14 settings ─────────────────────────
/** fase2-agencia.md §2: cliente = workspace. */
export interface Workspace {
  id: string; name: string; uiLocale: UiLocale; monthlySpendCapUsd: number | null;
  shortCode: string; industry: string | null; market: string | null;
  /** resultado-v1 (28/10): o que conta como resultado. Fonte da verdade (o `businessType` abaixo é derivado dele). */
  resultType: ResultType | null;
  /** texto livre quando `resultType = OTHER`; null nos outros */
  resultTypeOther: string | null;
  /** @deprecated derivado do resultType (PURCHASE/SUBSCRIPTION → ONLINE_STORE; LEAD/MESSAGE/APPOINTMENT/SIGNUP → LOCAL_BUSINESS; APP_INSTALL → APP; OTHER → null) */
  businessType: BusinessType | null; defaultResult: DefaultResult | null;
  websiteUrl: string | null;
  /** 25/10 (estatico-montado-e-molduras-v1 D3, TRANSIÇÃO): cor da marca `#RRGGBB` (maiúsculas); null = derivada (§A3.3) */
  brandColor?: string | null;
  status: ClientStatus; onboarding: Onboarding;
}
/** OWNER/ADMIN. `onboardingStep` com onboarding concluído = 409 INVALID_STATE reason 'onboarding_completed'. */
export type UpdateWorkspaceBody = Partial<{
  name: string; uiLocale: UiLocale; monthlySpendCapUsd: number | null;
  shortCode: string; industry: string | null; market: string | null;
  /** resultado-v1: OTHER exige `resultTypeOther` não vazio (no estado final) = 400 VALIDATION_ERROR; trocar pra outro limpa o texto */
  resultType: ResultType | null; resultTypeOther: string | null;
  /** @deprecated use `resultType`; sem `resultType` no mesmo corpo, migra (ONLINE_STORE → PURCHASE, LOCAL_BUSINESS → LEAD, APP → APP_INSTALL) */
  businessType: BusinessType | null; websiteUrl: string | null;
  /** 25/10 (D3): `#RRGGBB` ou `#RGB` (o backend normaliza pra 6 dígitos maiúsculos); null limpa. Inválido = 400 VALIDATION_ERROR */
  brandColor: string | null;
  onboardingStep: OnboardingStep;
  paused: boolean;
}>;
export interface Member { userId: string; name: string; email: string; role: Role; initials: string }
export interface Invite { id: string; email: string; role: Role; expiresAt: string }
export interface MembersResponse { members: Member[]; invites: Invite[] }
export interface CreateInviteBody { email: string; role: 'ADMIN' | 'MEMBER' | 'CLIENT' }
/** inviteUrl = `<primeira origem de WEB_ORIGIN>/invite/<token>`; o web tem a rota `/invite/[token]`. */
export interface CreateInviteResponse { id: string; inviteUrl: string; expiresAt: string }
export interface UpdateMemberBody { role: Role }
/** HIGGSFIELD = rosto (Soul V2, desde 06/10); APIFY = link da Ad Library (feature 2). */
/** META (meta-v1): connected = META_APP_ID + META_APP_SECRET + META_TOKEN_KEY no .env (META_MODE=live) ou mock; keyMasked = app id mascarado. */
export interface ServiceStatus { provider: 'ANTHROPIC' | 'WAVESPEED' | 'HIGGSFIELD' | 'APIFY' | 'STORAGE' | 'META'; connected: boolean; keyMasked: string | null }
export type SpendProvider = 'ANTHROPIC' | 'WAVESPEED' | 'HIGGSFIELD' | 'APIFY';
export type SpendKind = 'LLM' | 'IMAGE' | 'VIDEO' | 'TTS' | 'LIPSYNC' | 'TRANSCRIBE' | 'SCRAPE';
export interface Spend {
  month: string; spentUsd: number; capUsd: number | null;
  byProvider: { provider: SpendProvider; amountUsd: number }[]; byKind: { kind: SpendKind; amountUsd: number }[];
}
export interface Health { ok: boolean; db: boolean; storage: boolean; version: string }

// ───────────────────────── SSE (eventos.md §1) ─────────────────────────
export type CreativeEvent =
  | { event: 'snapshot'; data: CreativeDetail }
  | { event: 'creative.updated'; data: Pick<CreativeDetail, 'id' | 'state' | 'step' | 'status' | 'statusKey' | 'statusParams' | 'progress' | 'savedAt'> }
  | { event: 'job.updated'; data: Job }
  | { event: 'script.delta'; data: { scriptId: string; letter: string; blockIndex: number; field: 'speech' | 'angle' | 'rationale'; text: string } }
  | { event: 'script.updated'; data: Script }
  | { event: 'face.updated'; data: Face }
  | { event: 'scene.updated'; data: Scene & { summary: ScenesSummary } }
  | { event: 'take.updated'; data: Take & { summary: ScenesSummary } }   // §13.5
  | { event: 'render.updated'; data: Render }
  | { event: 'cost.updated'; data: { costUsd: number } }
  | EditorUpdatedEvent;   // editor-v1 §9

// ═════════════════════════ Feature 2: variar campeão (feature-2-variar-campeao.md) ═════════════════════════
export type ChampionStatus = 'RESOLVING' | 'ANALYZING' | 'READY' | 'FAILED';
/** Declaração do usuário (checkbox). Só registro: não trava nenhum tipo de variação (Gusta, 06/10). */
export type ChampionRights = 'OWN' | 'THIRD_PARTY';
export type VariationKind = 'SWAP_AVATAR' | 'NEW_HOOKS' | 'COPY_NEW' | 'REMIX_EDIT' | 'AUTO_EDIT';   // AUTO_EDIT: variacao-auto-v1
export type VoiceSource = 'CATALOG' | 'CHAMPION_AUDIO' | 'ENGINE_VOICE';   // ENGINE_VOICE: §13.15
/** TTS_LIPSYNC, AUDIO_LIPSYNC e REUSE como pipeline de CENA ficam só pra criativos antigos (§13.5): lipsync novo = TAKE_SLICE. */
export type ScenePipeline = 'SCENE_VIDEO' | 'TTS_LIPSYNC' | 'AUDIO_LIPSYNC' | 'SOURCE_CUT' | 'REUSE' | 'TAKE_SLICE' | 'SWAP_VIDEO';

export interface VariationRef {
  kind: VariationKind; championId: string; championName: string; batchId: string;
  lever: string | null; isControl: boolean;
  /** variacao-auto-v1 §4: código da variável (só AUTO_EDIT; senão null). Opcional até B2 preencher. */
  code?: string | null;
  /** variacao-auto-v1 §4: eixo da peça AUTO (senão null). Opcional até B2 preencher. */
  axis?: VariationAxis | null;
}

// ── uploads ──
/** PRODUCT_IMAGE: variacao-auto-v1 D4 (image/jpeg|png|webp, ≤ 10 MB). */
export interface CreateUploadBody { purpose: 'CHAMPION_VIDEO' | 'PRODUCT_IMAGE'; filename: string; mimeType: string; sizeBytes: number }
/** O web faz exatamente isto (XHR com progresso): `method url` com `headers` e o arquivo no corpo. */
export interface CreateUploadResponse { uploadId: string; method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string }
export type UploadWarning = 'no_audio' | 'low_resolution';
export interface CompleteUploadResponse {
  uploadId: string; status: 'READY'; file: FileRef; warnings: UploadWarning[]; analysisEstimateUsd: number;
}

// ── campeões ──
export interface ChampionConfig {
  maxBytes: number; minSec: number; maxSec: number; mimeTypes: string[];
  adLibrary: { available: boolean; reason: 'quota' | 'not_configured' | null; retryAfter: string | null };
  analysisUsdPerSec: number;
  kinds: { kind: VariationKind; enabled: boolean }[];
}
export interface AdLibraryMeta {
  status: 'resolved' | 'unavailable' | 'not_found' | 'no_video';
  adArchiveId: string | null; pageName: string | null; startDate: string | null; endDate: string | null;
  isActive: boolean | null; daysRunning: number | null; collationCount: number | null; euReach: number | null;
  primaryText: string | null; headline: string | null; ctaText: string | null; linkUrl: string | null;
  fetchedAt: string | null;
}
export interface ChampionRow {
  id: string; name: string; offer: { id: string; name: string };
  status: ChampionStatus; rights: ChampionRights; sources: ('UPLOAD' | 'AD_LIBRARY' | 'META')[];   // META: meta-v1 D13 (Pick from Meta)
  thumbnail: FileRef | null; durationSec: number | null; language: string | null;
  batchesCount: number; variationsCount: number; winnersCount: number;
  createdBy: UserRef; updatedAt: string;
}
export interface ChampionDetail extends ChampionRow {
  video: FileRef | null; adLibraryUrl: string | null; adMeta: AdLibraryMeta | null; notes: string | null;
  job: Job | null;
  errorCode: AsyncErrorCode | null; failReason: string | null; action: Action | null;
  teardown: Teardown | null;
  availableKinds: { kind: VariationKind; available: boolean; reason: 'NO_SPEECH' | 'NOT_ENABLED' | null }[];
  /** §13: manter a edição do campeão, por tipo (só SWAP_AVATAR e NEW_HOOKS). */
  keepEdit: { SWAP_AVATAR: KeepEditAvailability; NEW_HOOKS: KeepEditAvailability };
  /** §13.15: Trocar avatar com a voz do motor (ENGINE_VOICE). Calculado do editMap. */
  engineVoice: KeepEditAvailability;
  costUsd: number;
  /** meta-v1 D13: campeão criado a partir de um anúncio da Meta (POST /iterate { metaAdId }); null nos outros */
  metaAd: { adId: string; adAccountId: string } | null;
  /** legenda-protegida-v1 §2.3 (26/10): versão sem legenda queimada; com ela, todas as peças usam este vídeo. TRANSIÇÃO opcional. */
  cleanVideo?: FileRef | null;
}
/** legenda-protegida-v1 §2.3: `POST /champions/:id/clean-version` (mesmo vídeo, sem a legenda; 422 CLEAN_VERSION_MISMATCH). */
export interface SetCleanVersionBody { uploadId: string }
export interface ListChampionsQuery { offerId?: string; limit?: number; cursor?: string }
export interface CreateChampionBody {
  offerId: string; name?: string; uploadId?: string; adLibraryUrl?: string; rights: ChampionRights; notes?: string;
  /** legenda-protegida-v1 §2.3 (26/10): upload opcional do mesmo vídeo sem a legenda queimada */
  cleanUploadId?: string;
}
export interface UpdateChampionBody { name?: string; rights?: ChampionRights; notes?: string | null }
export interface AttachChampionVideoBody { uploadId: string }
export interface AnalyzeChampionBody { confirm?: boolean }

export interface TranscriptWord { word: string; startSec: number; endSec: number }
export interface Measurements {
  durationSec: number; width: number; height: number; fps: number; hasAudio: boolean;
  cuts: { atSec: number; kind: 'layout' | 'content' }[];
  segments: { startSec: number; endSec: number; bands: { y0: number; y1: number; pct: number; role: 'face' | 'panel' | 'caption' | 'unknown' }[] }[];
  palette: string[];
  silences: { startSec: number; endSec: number }[];
  keyframes: { atSec: number; reason: 't0' | 'block' | 'cut' | 'end'; image: FileRef }[];
}
export type TeardownSectionKey =
  | 'identification' | 'metaCopy' | 'transcript' | 'hook' | 'structure' | 'layout'
  | 'visual' | 'audio' | 'offerProofCta' | 'whySells' | 'stealVsVary' | 'replicationPlan';
/** Seção sem dado = status 'na' + naReason; nunca some. */
export interface Section<T> { status: 'ok' | 'na'; naReason: string | null; data: T | null }
export interface TeardownSections {
  identification: Section<{ summary: string; signals: string[] }>;
  metaCopy: Section<{ primaryText: string | null; headline: string | null; description: string | null; button: string | null; link: string | null }>;
  transcript: Section<{ keywords: { sentence: string; keyword: string }[] }>;
  hook: Section<{ endSec: number; visual: string; onScreenText: string | null; spoken: string }>;
  structure: Section<{ blocks: { label: string; function: string; startSec: number; endSec: number; onScreen: string; speech: string }[] }>;
  layout: Section<{ summary: string; segments: { startSec: number; endSec: number; description: string }[] }>;
  visual: Section<{ palette: { hex: string; role: string }[]; typography: string; captions: string; uiElements: string; person: string; broll: string; motion: string }>;
  audio: Section<{ voice: string; music: string; sfx: string }>;
  offerProofCta: Section<{ promise: string; mechanism: string; proof: string; ctaSpoken: string; ctaOnScreen: string }>;
  whySells: Section<{ avatar: string; awarenessLevel: string; painDesire: string; bigIdea: string; beliefObjection: string; retentionEngine: string; verdict: string[] }>;
  stealVsVary: Section<{ steal: string[]; vary: { lever: string; idea: string }[] }>;
  replicationPlan: Section<{ suggestions: { kind: VariationKind; lever: string; idea: string }[] }>;
}
export interface Teardown {
  id: string; language: string; analyzedAt: string; editedSections: TeardownSectionKey[];
  transcript: { text: string; words: TranscriptWord[]; wpm: number };
  measurements: Measurements; sections: TeardownSections;
  /** §13.1-13.2. null = analisado antes da etapa mapping_edit → keepEdit indisponível ('not_mapped'). */
  editMap: EditMap | null;
}
export interface UpdateTeardownBody {
  sections?: Partial<{ [K in TeardownSectionKey]: TeardownSections[K] }>;
  transcriptWords?: { index: number; word: string }[];   // corrige o texto; tempos não mudam
}

// ── lotes ──
/** §13.13 (07/10): DIVERSE (padrão) = cada elenco marcadamente diferente dos outros e do original;
 *  MATCH_ORIGINAL = perfil do original (comportamento de 06/10). Nos dois, SWAP_AVATAR com voz original segue o gênero da voz. */
export type CastingStyle = 'DIVERSE' | 'MATCH_ORIGINAL';
export type VariationBatchStatus = 'PLANNING' | 'PLAN_READY' | 'PLAN_FAILED' | 'LAUNCHED'
  | 'ANALYZING' | 'ANALYSIS_FAILED';   // só lotes AUTO (variacao-auto-v1 §3.1)
export interface BatchSettings {
  format: VideoFormat;
  voiceId: string | null;
  voiceSource: VoiceSource;               // só SWAP_AVATAR
  engine: Engine | null; engineModel: string | null;   // só COPY_NEW; NEW_HOOKS e SWAP_AVATAR = LIPSYNC (Pruna)
  edit: EditSettings;
  /** §13: padrão true quando keepEdit[kind].available. true com bloqueio = 422 KEEP_EDIT_UNSUPPORTED.
   *  Em keepEdit: SWAP_AVATAR força voiceSource CHAMPION_AUDIO e o formato do campeão; `edit` é ignorado (template remix-keep). */
  keepEdit: boolean;
  /** §13.4: só 'TEXT' até a decisão D6 do Gusta. */
  hookMode: HookMode;
  /** §13.15: motor do Trocar avatar (padrão LIPSYNC). KLING/SEEDANCE exigem keepEdit. */
  swapEngine: SwapEngine;
}
export interface VariationCasting {
  id: string; scope: 'SHARED' | 'ITEM'; description: string;
  batches: { batch: number; faces: Face[] }[]; selectedFaceId: string | null;
}
export interface VariationItem {
  id: string; kind: VariationKind; index: number; isControl: boolean; included: boolean;
  status: 'WRITING' | 'READY' | 'FAILED'; lever: string | null; rationale: string | null;
  hook: { speech: string; onScreenText: string | null } | null;
  blocks: ScriptBlock[] | null;
  layoutTemplateId: string | null;
  castingId: string | null;
  errorCode: AsyncErrorCode | null; failReason: string | null; action: Action | null;
  creative: CreativeRow | null;
}
export interface VariationBatch {
  id: string; champion: { id: string; name: string }; offer: { id: string; name: string };
  status: VariationBatchStatus; language: string;
  requests: { kind: VariationKind; count: number }[]; settings: BatchSettings; notes: string | null;
  castingStyle: CastingStyle;
  /** §13.13: preço do Soul por rosto; rostos do elenco custam count × faceUnitPriceUsd. */
  faceUnitPriceUsd: number;
  job: Job | null; items: VariationItem[]; castings: VariationCasting[];
  estimatedCostUsd: number | null; costUsd: number; launchedAt: string | null;
  progress: { total: number; generating: number; waiting: number; failed: number; approved: number } | null;
  createdBy: UserRef; createdAt: string;
}
export interface CreateBatchBody { requests: { kind: VariationKind; count: number }[]; settings?: Partial<BatchSettings>; notes?: string; castingStyle?: CastingStyle /* padrão DIVERSE */ }
export interface ReplanBatchBody { requests?: { kind: VariationKind; count: number }[]; notes?: string; castingStyle?: CastingStyle /* omitido = mantém o do lote */ }
export interface UpdateVariationItemBody {
  included?: boolean;
  hook?: { speech?: string; onScreenText?: string | null };   // só NEW_HOOKS
  blocks?: { index: number; speech?: string }[];              // só COPY_NEW
}
export interface RegenerateVariationItemBody { note?: string }
export type UpdateBatchSettingsBody = Partial<BatchSettings>;
export interface UpdateCastingBody { description: string }
/** POST /variation-batches/:id/castings/:castingId/faces/generate. count padrão 1 (§13.13). */
export interface GenerateCastingFacesBody { description: string; count?: FaceCount }
export interface EstimateLine { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }
export type BatchEstimateWarning = 'voice_gender_mismatch' | 'low_resolution';
export interface BatchEstimate {
  costUsd: number; etaSec: number; savedByReuseUsd: number;
  items: { itemId: string; kind: VariationKind; costUsd: number; lines: EstimateLine[] }[];
  spend: { monthUsd: number; capUsd: number | null; afterUsd: number };
  warnings: BatchEstimateWarning[];
  /** §13.15: os motores do Trocar avatar lado a lado. null sem item SWAP_AVATAR incluído. */
  swapQuotes: SwapQuote[] | null;
}
export interface LaunchBatchBody { expectedCostUsd: number }
export interface LaunchBatchResponse { batch: VariationBatch; creatives: CreativeRow[] }

// ═════════════════════════ §13: manter a edição + take contínuo (06/10 noite) ═════════════════════════
/** Retângulo em px na grade do campeão (ou do clipe, quando dito). */
export interface Rect { x: number; y: number; w: number; h: number }
/** Catálogo fechado de fontes empacotadas no video/ (FONT_CATALOG). */
export type FontId = 'montserrat-800' | 'montserrat-900' | 'inter-800' | 'anton-400' | 'oswald-700'
  | 'bebas-neue-400' | 'archivo-black-400' | 'poppins-800' | 'roboto-condensed-700';
export interface TextStyle {
  fontId: FontId; uppercase: boolean; fontSizePx: number; lineHeight: number;
  color: string; highlightColor: string | null;          // karaokê: cor da palavra atual
  /** karaokê: caixa atrás da palavra atual (hex, ex. '#6C22D6' do podcast). Ausente = sem caixa. */
  highlightBackground?: string;
  strokeColor: string | null; strokeWidthPx: number; shadow: boolean;
  align: 'left' | 'center' | 'right';
}
/** Trecho contínuo em que o rosto ocupa a mesma célula do layout. Frames: [startFrame, endFrame). */
export interface FaceTrackSegment {
  startFrame: number; endFrame: number;
  region: Rect;                                          // a célula inteira (o rosto novo ocupa ela toda)
  fullFrame: boolean;
  /** caixa do rosto relativa à região (0-1), por passo de escala; 1 item = escala fixa no trecho */
  faceInRegion: { atFrame: number; box: { x: number; y: number; w: number; h: number } }[];
  facesMax: number; minScore: number;
  /** §13.14 (07/10, formato podcast): de quem é o trecho. Ausente = 'main' (mapas antigos).
   *  Só 'main' é trocado; 'other_person' (outro participante) e 'broll' ficam como o original. */
  role?: FaceTimelineKind;
}
export interface EditLayer {
  id: string; kind: 'headline' | 'caption' | 'text';
  startFrame: number; endFrame: number; box: Rect;
  /** color: hex ('#d21f1f') OU CSS 'linear-gradient(...)' (ex.: a barra degradê do zap); null em kind 'none'. */
  background: { kind: 'solid' | 'pill' | 'none'; color: string | null; box: Rect | null };
  style: TextStyle;
  text: string | null;                                   // headline/text: literal da tela; caption: null (vem da transcrição)
  wordsPerPage: number | null;                           // só caption
  source: 'vision' | 'vision+pixel';
}
/** Perfil genérico da pessoa (pro elenco parecido). Nunca nome, @, tatuagem, cicatriz, marca única. */
export interface PersonProfile {
  gender: 'male' | 'female' | null; ageBand: string; ethnicity: string; hair: string;
  clothing: string; setting: string; lighting: string; framing: string; pose: string;
}
export type KeepEditBlocker = 'not_mapped' | 'no_face' | 'multiple_faces' | 'low_confidence'
  | 'caption_straddles_face' | 'overlay_over_face' | 'hook_text_over_video' | SwapKeepEditBlocker;
export interface KeepEditBlockerHit { reason: KeepEditBlocker; startSec: number | null; endSec: number | null }
export interface KeepEditAvailability { available: boolean; blockers: KeepEditBlockerHit[] }
/** §13.14: o vídeo inteiro no tempo, contíguo de 0 a frameCount. main = trechos de troca (= faceTrack com role main);
 *  other_person e broll ficam como o original e nunca bloqueiam. Mesmo formato do FaceTrackResult.timeline da medição. */
export type FaceTimelineKind = 'main' | 'other_person' | 'broll';
export interface FaceTimelineSpan { startFrame: number; endFrame: number; kind: FaceTimelineKind }
export interface EditMap {
  version: 1;
  width: number; height: number; fps: number; frameCount: number;
  cells: { startFrame: number; endFrame: number; cells: Rect[] }[];
  faceTrack: FaceTrackSegment[];
  layers: EditLayer[];
  overlaysOverFace: { startFrame: number; endFrame: number; description: string }[];
  profile: PersonProfile | null;
  /** §13.12: quem fala pra câmera (dica da visão, caixa em px do campeão). Ausente em mapas antigos. */
  mainSpeaker?: { box: Rect; description: string } | null;
  /** §13.12: rostos que NÃO são o avatar (b-roll, CCTV, telas, painel vizinho). Informativo: nunca bloqueia. */
  otherFaces?: { startFrame: number; endFrame: number; box: Rect | null; where: string }[];
  /** §13.14: = FaceTrackResult.timeline. Ausente em mapas antigos (aí tudo que está em faceTrack é main). */
  timeline?: FaceTimelineSpan[];
  keepEdit: { SWAP_AVATAR: KeepEditAvailability; NEW_HOOKS: KeepEditAvailability };
  /** legenda-protegida-v1 §1 (26/10): faixas da legenda queimada que nenhum template pode tampar (px do arquivo, com folga).
   *  Ausente em mapas antigos (o backend recalcula das `layers`); [] = campeão sem legenda queimada. */
  protectedBands?: ProtectedBand[];
}
/** legenda-protegida-v1 §1: uma posição da legenda queimada num intervalo. Folga: 4 % da altura em cima/embaixo, 2 % nos lados (D-LP1). */
export interface ProtectedBand { x: number; y: number; w: number; h: number; startSec: number; endSec: number }
export type HookMode = 'TEXT' | 'VOICE_CLONE' | 'NEW_AVATAR';   // só 'TEXT' aceito até D6
export type TakeKind = 'TTS_LIPSYNC' | 'AUDIO_LIPSYNC';
/** O clipe contínuo de lipsync do criativo: 1 por geração, 1 chamada Pruna com o áudio inteiro (≤ 600 s). */
export interface Take {
  id: string; kind: TakeKind; status: AssetStatus; progress: number; attempt: number;
  durationSec: number | null;
  sourceStartSec: number | null; sourceEndSec: number | null;   // AUDIO_LIPSYNC: janela do campeão
  clip: FileRef | null; thumbnail: FileRef | null;
  failReason: string | null; errorCode: AsyncErrorCode | null; action: Action | null;
  /** custo de refazer o take inteiro (o que a tela mostra no "Refazer o clipe") */
  regenerateEstimateUsd: number;
}
export interface RegenerateTakeBody { expectedCostUsd: number; note?: string }

// §13.15 (08/10): Trocar avatar com motor Kling/Seedance
export * from './troca-motor';
import type { SceneSwap, SwapEngine, SwapKeepEditBlocker, SwapAsyncErrorCode, SwapQuote } from './troca-motor';

// editor-v1 (09/10): editor no vídeo
export * from './editor';
import type { EditConflictDetails, EditDoc, EditDocRule, EditNotSupportedDetails, EditorUpdatedEvent } from './editor';

// fase2-agencia.md (12/10): agência multi-cliente
export * from './agencia';
// fase2-cadastro.md (12/10): cadastro self-serve
export * from './cadastro';

// Variação automática de campeão v1 (contrato docs/contratos/variacao-auto-v1.md)
export * from './iteracao';
import type { FormatCode, VariationAxis } from './iteracao';
import type { BusinessSuggestion, BusinessType, ClientStatus, DefaultResult, Onboarding, ResultType, OnboardingStep, WaitingBatchRef, WaitingOnYou } from './agencia';

// meta-v1 (docs/contratos/meta-v1.md, aprovado 21/10): conexão, leitura de anúncios/vencedor, publicação
export * from './meta';
import type { MetaAsyncErrorCode } from './meta';
// onboarding-v2 (docs/contratos/onboarding-v2.md, aprovado 21/10): accountMode, percent/steps/updatedBy, tour
export * from './onboarding-v2';
// campanhas-v1 (docs/contratos/campanhas-v1.md, aprovado 22/10): tela Campaigns (snapshots por nível, escritas, MetaChange)
export * from './campanhas';
// brain-3d-v1 (docs/contratos/brain-3d-v1.md, aprovado 22/10): GET /brain/graph e /brain/node/:id
export * from './brain';
import type { AccountMode, OnboardingSummary } from './onboarding-v2';
