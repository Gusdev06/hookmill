// templates-creditos-v1 (docs/contratos/templates-creditos-v1.md, aprovado pelo Gusta em 31/10): biblioteca de templates com
// créditos. Um template = o lote AUTO com o tipo travado; crédito por CONTA, reservado no Gerar e devolvido se a peça falhar.
import type { FileRef } from './index';

export type TemplateTier = 'EDIT' | 'STATIC' | 'AI';
export type TemplateStatus = 'DRAFT' | 'LIVE' | 'HIDDEN';
export type CreditPool = 'CREDITS' | 'SAMPLE';
export type CreditEntryKind = 'GRANT' | 'RESERVE' | 'CHARGE' | 'REFUND' | 'MANUAL';
export type TemplateRunStatus = 'DRAFT' | 'RESERVED' | 'SETTLED';
/** Aba da galeria: STATIC fica em Edit. */
export type TemplateTab = 'edit' | 'ai';
export type TemplateCategory = 'frames' | 'headline' | 'cuts' | 'chat' | 'static' | 'avatar' | 'persona' | 'remix' | 'pack';

/** §6: ok = Fits · soft = só a legenda queimada tira (saídas: versão sem legenda, outro template; nada cobre) · hard = não cabe · unknown = anúncio nunca lido. */
export type TemplateFitLevel = 'ok' | 'soft' | 'hard' | 'unknown';
/** Motivos: os mesmos do plano (`allowedFor`/`allowedFrames`) + os da galeria. */
export type TemplateFitReason =
  | 'burned_captions' | 'no_face' | 'no_speech' | 'short_video' | 'no_proof' | 'no_price' | 'no_data' | 'no_page'
  | 'has_end_card' | 'no_offer' | 'no_written_hook' | 'no_audience' | 'no_promise'
  | 'not_read' | 'coming_soon'
  /** templates-multi-v1 (04/11): o template marcado cabia, mas o plano não fez peça dele (fica fora do quote) */
  | 'not_planned'
  /** templates-lista-v1 (04/11): menos de 2 momentos de lista na fala E Brain sem pontos pra completar (hard) /
   *  sem lugar pro painel nem com o vídeo encolhido, num anúncio SEM legenda queimada (o rosto ocupa o quadro; hard).
   *  Com legenda queimada o motivo é `burned_captions` (soft). */
  | 'no_list' | 'no_room'
  /** troca-texto-queimado-v1 §15.4: a headline deste vídeo ainda não pode ser refeita (hard, até o F1b) */
  | 'headline_pending'
  /** troca-texto-queimado-v1 §16.5 (F1b): hard. Rewrite em §16.3 sem caber = `headline_no_fit` */
  | 'headline_near_caption' | 'headline_font_far' | 'headline_plate_rejected' | 'headline_no_fit'
  | (string & {});
export interface TemplateFit { level: TemplateFitLevel; reason: TemplateFitReason | null }

/** Chaves de "Your ad needs" (o web traduz). */
export type TemplateNeed = 'face' | 'speech' | 'min_25s' | 'min_15s' | 'clean_face' | 'proof' | 'price' | 'brain_points' | 'audience' | 'promise_or_proof'
  /** templates-lista-v1 (04/11): fala ≥ 12 s */
  | 'min_12s'
  | (string & {});

export interface TemplateCard {
  slug: string;
  name: string;                 // no idioma da interface (uiLocale do usuário)
  description: string;
  out: string;                  // "3 videos" / "1 vídeo · 9:16"
  tier: TemplateTier;
  tab: TemplateTab;
  category: TemplateCategory;
  credits: number | null;       // pack: o teto (10)
  outputs: number;
  pack: boolean;
  beta: boolean;
  needs: TemplateNeed[];
  example: FileRef | null;      // MP4 9:16 (URL assinada); null = card com a ilustração do tipo (02/11: aparece pro cliente mesmo assim)
  poster: FileRef | null;
  uses: number;
  /** false = o tipo ainda não roda (IA antes do F3 etc.); o card não vem pro cliente. Só admin vê false. */
  available: boolean;
  /** O Gerar autoriza o fluxo completo em background, sem Plan intermediário. */
  autoGenerate?: boolean;
  /** templates-ia-previas-v1 (07/11): formato do template With AI (só AI_VIDEO). A tela não mapeia mais por slug */
  aiFormat?: import('./templates-ai').AiFormat;
  /** amostra: true = Edit (gasta 1 uso); false = "Paid plan" */
  sampleOk: boolean;
  /** só com a fonte na query (championId/metaAdId/creativeId/uploadId); null sem fonte */
  fit: TemplateFit | null;
}

export interface CreditsSummary {
  /** true = conta da equipe (INTERNAL): sem saldo, sem lançamento */
  unlimited: boolean;
  access: 'SAMPLE' | 'PAID' | 'INTERNAL';
  /** pool que o Gerar usa neste workspace (null = ilimitado) */
  pool: CreditPool | null;
  /** saldo do pool em uso (créditos pagos ou usos da amostra); null = ilimitado */
  balance: number | null;
  credits: number;              // saldo pago da conta que paga
  sample: { left: number; total: number } | null;   // só conta SAMPLE
  /** reservado em lotes ainda rodando (já saiu do saldo) */
  held: number;
  /** sem gateway (T8): sempre null por enquanto; a tela mostra "Talk to us" */
  checkoutUrl: null;
  contactEmail: string | null;
}

export interface CreditEntryView {
  id: string; kind: CreditEntryKind; pool: CreditPool;
  delta: number; amount: number; balanceAfter: number;
  note: string | null; createdAt: string;
  run: { id: string; batchId: string; templateSlug: string; templateName: string } | null;
  by: { id: string; name: string } | null;
}

export interface RunLineView {
  key: string;                  // "FRAME:news" | "HEADLINE" | …
  slug: string; name: string; tier: TemplateTier;
  credits: number;
  pieces: number;               // peças marcadas desta linha
  state: 'planned' | 'held' | 'charged' | 'refunded';
  delivered: number | null;     // créditos entregues depois de assentar
}

/** Texto editável no Plan (A7: FRAME e HEADLINE na v1). `path` volta no PATCH. */
export interface EditableText { path: string; label: string; value: string; maxChars: number; source: string | null }

/** `IterateBatch.template` (lote nascido de template). */
export interface IterateTemplateRun {
  autoGenerate?: boolean;
  productionStage?: 'reading' | 'writing' | 'presenters' | 'video' | 'render' | 'done' | 'failed';
  runId: string;
  slug: string; name: string; pack: boolean; tier: TemplateTier;
  status: TemplateRunStatus;
  fit: TemplateFit;
  cap: number | null;
  lines: RunLineView[];
  /** o que o Gerar vai reservar agora (= expectedCredits) */
  quote: number;
  /** templates-multi-v1 (04/11): lote de vários templates escolhidos pela pessoa (slug 'selection', pack false, cap null). null nos outros. */
  selection: TemplateSelectionView | null;
  balance: number | null;       // null = ilimitado
  after: number | null;         // balance − quote
  enough: boolean;
  pool: CreditPool | null;
  held: number; charged: number; refunded: number;
  /** textos por peça (pieceId = IteratePiece.id); [] = sem edição na v1 */
  texts: { pieceId: string; items: EditableText[] }[];
}

export interface TemplateList {
  items: TemplateCard[]; pack: TemplateCard | null; credits: CreditsSummary; fitsFor: { championId: string | null; read: boolean } | null;
  /** templates-multi-v1 (04/11): limites da seleção múltipla (o web não fixa número) */
  selection: TemplateSelectionLimits;
}

/** ads-research-v1 §6.1 (04/11, PROPOSTA): `researchAdId` = anúncio do Research (vira campeão THIRD_PARTY do workspace). */
export interface TemplateSourceRef { championId?: string; metaAdId?: string; creativeId?: string; uploadId?: string; researchAdId?: string }
/** Exatamente 1 de `slug` (1 template) ou `slugs` (seleção, templates-multi-v1: 2..maxTemplates, distintos). */
export interface TemplateFitsBody { slug?: string; slugs?: string[]; sources: TemplateSourceRef[] }
export interface TemplateFitsResponse {
  items: {
    source: TemplateSourceRef; read: boolean; championId: string | null;
    /** com `slug`: o fit dele. Com `slugs`: o da seleção (unknown se não lido · hard se algum é hard · soft se algum é soft · ok) */
    fit: TemplateFit;
    /** só com `slugs`: o fit de cada um, na ordem pedida */
    bySlug?: { slug: string; fit: TemplateFit }[];
  }[];
}
/** Exatamente 1 fonte. */
export interface UseTemplateBody extends TemplateSourceRef {
  offerId?: string; cleanUploadId?: string;
  generation?: { requestId: string; expectedCredits: number };
  /** templates-ia-previas-v1 §5.1: com `AI_PREVIEWS=on` o template AI_VIDEO exige `previews` e recusa `generation` */
  previews?: { requestId: string };
}
/** templates-multi-v1 (04/11): `POST /ad-templates/use`. Exatamente 1 fonte; `slugs` 2..maxTemplates, distintos, na ordem da galeria. */
export interface UseTemplatesBody extends UseTemplateBody { slugs: string[] }
export interface UpdateItemTextsBody { texts: { path: string; value: string }[] }

export interface TemplateRunRef {
  id: string; batchId: string; templateSlug: string; templateName: string; pack: boolean;
  status: TemplateRunStatus; held: number; charged: number; refunded: number; pool: CreditPool | null;
  championName: string; createdAt: string; settledAt: string | null;
  /** templates-multi-v1: os templates marcados (templateSlug = 'selection'); null nos outros */
  selection: { slugs: string[] } | null;
}

// ── admin (só usuário INTERNAL OWNER do workspace ativo) ──
export interface AdminTemplate extends Omit<TemplateCard, 'name' | 'description' | 'out' | 'fit'> {
  id: string; internalKey: string; autoType: string | null; frameId: string | null; status: TemplateStatus; order: number;
  nameEn: string; namePt: string; descEn: string; descPt: string; outEn: string; outPt: string;
  exampleDurationSec: number | null;
  /** LIVE sem vídeo de exemplo = "Needs example" */
  needsExample: boolean;
}
export interface UpdateTemplateBody { credits?: number | null; status?: TemplateStatus; order?: number; nameEn?: string; namePt?: string; descEn?: string; descPt?: string; beta?: boolean }
export interface TemplateExampleUploadBody { mimeType: 'video/mp4'; sizeBytes: number }
export interface TemplateExampleUpload { uploadUrl: string; key: string; expiresAt: string }
export interface TemplateExampleCompleteBody { key: string }
/** credits > 0 credita; < 0 debita (nunca abaixo de 0). idempotencyKey: repetir não lança 2 vezes. */
export interface GrantCreditsBody { email?: string; userId?: string; credits: number; note?: string; idempotencyKey: string }
export interface GrantCreditsResponse { entry: CreditEntryView; balance: number }

/** 402 INSUFFICIENT_CREDITS */
export interface InsufficientCreditsDetails { need: number; balance: number; pool: CreditPool }

// ── templates-multi-v1 (docs/contratos/templates-multi-v1.md, 04/11): vários templates marcados, 1 lote, soma sem teto ──

/** Limites da seleção (vêm no `TemplateList.selection`). maxVideos = Σ `outputs` dos marcados (o BATCH_MAX do lote auto). */
/** `maxFrames` (04/11): molduras (autoType FRAME) por seleção, o FRAME ≤ 8 do plano. */
export interface TemplateSelectionLimits { minTemplates: number; maxTemplates: number; maxVideos: number; maxFrames: number }

/** Motivo de um template marcado ficar fora do lote: o fit `hard` (anúncio lido só no Reading) ou `not_planned`. */
export type TemplateSkipReason = TemplateFitReason;

/** `IterateTemplateRun.selection`. */
export interface TemplateSelectionView {
  /** os marcados, na ordem do pedido */
  slugs: string[];
  /** marcados que não viraram linha (não entram no quote nem no `uses`) */
  skipped: { slug: string; name: string; reason: TemplateSkipReason }[];
}

/** 422 TEMPLATE_SELECTION_INVALID */
export type TemplateSelectionInvalidReason = 'not_found' | 'pack' | 'ai_tier' | 'too_many_videos' | 'too_many_frames';
export interface TemplateSelectionInvalidDetails {
  reason: TemplateSelectionInvalidReason;
  /** os slugs que causaram (vazio em too_many_videos; as molduras marcadas em too_many_frames) */
  slugs: string[];
  /** só em too_many_videos */
  videos?: number; maxVideos?: number;
  /** só em too_many_frames (04/11): molduras marcadas e o teto (8) */
  frames?: number; max?: number;
}

/** 422 TEMPLATE_DOESNT_FIT. `slug`/`items` só no `POST /ad-templates/use` (todos os marcados que não cabem). */
export interface TemplateDoesntFitDetails { reason: TemplateFitReason; slug?: string; items?: { slug: string; reason: TemplateFitReason }[] }
/** 422 TEMPLATE_UNAVAILABLE. `slug` só no `POST /ad-templates/use`. */
export interface TemplateUnavailableDetails { reason: 'coming_soon' | 'retired' | 'disabled'; slug?: string }
