// templates-ia-previas-v1 (07/11, aprovado): 4 prévias em imagem antes do vídeo, nos templates With AI F04/F09/F10.
// Contrato: docs/contratos/templates-ia-previas-v1.md §5.6. SÓ TIPOS. Dono: maquina-arquiteto.
import type { SemanticAxis, SemanticBeat, SemanticFact, SemanticVariation } from './variacao-ia';
import type { TemplateSourceRef } from './templates';

export type AiFormat = 'F04' | 'F09' | 'F10';
export type AiPhase = 'planning' | 'previews_ready' | 'producing' | 'done' | 'failed';
export type AiPreviewStatus = 'planned' | 'imaging' | 'ready' | 'failed' | 'approved';
export type AiSpeaker = 'host' | 'presenter';
export type AiGender = 'female' | 'male';

/** Tetos fixos (§5.4/§5.5): 3 novos ângulos por prévia, 6 por lote, 2 retries por prévia. As constantes moram na api (pacote só de tipos). */

// ───────── corpos (§5.1, §5.3–§5.5) ─────────

/** `POST /ad-templates/:slug/use` de template AI_VIDEO com `AI_PREVIEWS=on`. Exatamente 1 fonte; `generation` é recusado. */
export interface UseAiTemplateBody extends TemplateSourceRef {
  offerId?: string; cleanUploadId?: string;
  /** requestId UUIDv4; prévias são grátis: sem expectedCredits */
  previews: { requestId: string };
}
/** `POST /iterate/:id/ai-previews/approve`. previewIds 1..4, únicos, todos `ready`. expectedCredits = (credits ?? 0) × N. */
export interface ApproveAiPreviewsBody { requestId: string; previewIds: string[]; expectedCredits: number }
/** `POST /iterate/:id/ai-previews/:previewId/regenerate` ("Novo ângulo"): só prévia `ready`; conta no teto 3/6. */
export interface RegenerateAiPreviewBody { requestId: string }
/** `POST /iterate/:id/ai-previews/:previewId/retry` ("Try again"): só prévia `failed`; fora do teto, máx. 2. */
export interface RetryAiPreviewBody { requestId: string }

// ───────── vista (GET /iterate/:id → IterateBatch.ai) ─────────

export interface AiPreviewCastMember {
  speaker: AiSpeaker;
  /** nome de exibição fictício ("Maya") */
  name: string;
  gender: AiGender;
  voiceId: string;
  voiceName: string;
  /** imagem-chave = o Face que o lipsync anima (§6); null até ficar pronta */
  image: { fileId: string; url: string; width: number; height: number } | null;
  status: 'queued' | 'generating' | 'ready' | 'failed';
}

export interface AiPreview {
  id: string;
  index: number;
  letter: 'A' | 'B' | 'C' | 'D';
  status: AiPreviewStatus;
  /** null enquanto `planned` sem variação (novo ângulo/retry aguardando o planejador) */
  title: string | null;
  angle: string | null;
  hook: string | null;
  summary: string | null;
  beats: { speaker: AiSpeaker; role: string; text: string }[];
  /** a tela mostra no máximo 3 */
  changes: { axis: SemanticAxis; before: string; after: string }[];
  preserved: string[];
  /** F04/F09: 1 · F10: 2 (host, presenter) */
  cast: AiPreviewCastMember[];
  estimate: { durationSec: number; credits: number | null };
  regenerations: { used: number; max: 3 };
  retries: { used: number; max: 2 };
  errorCode: string | null;
  failReason: string | null;
  failStage: 'planning' | 'imaging' | null;
  /** código estável pro web traduzir (QA 07/11 MÉDIO-1); `failReason` é só log, em inglês */
  failureCode: AiPreviewFailureCode | null;
  /** 'retry' em `failed` com retries sobrando */
  action: 'retry' | null;
  approvedAt: string | null;
  /** após `approved`: o IteratePiece do vídeo (player, MP4, retry de peça) */
  pieceId: string | null;
}

export interface AiApproval { requestId: string; previewIds: string[]; credits: number; at: string }

export interface AiPreviewsView {
  phase: AiPhase;
  format: AiFormat;
  /** ordem por index; vazio durante o planejador inicial, 2 a 4 depois */
  previews: AiPreview[];
  /** prévias em planned/imaging */
  generating: number;
  /** prévias ready (Home "Waiting for you" = approvable > 0 e nenhuma aprovação) */
  approvable: number;
  /** créditos por vídeo; null = sem preço (só equipe). Prévias: sempre grátis */
  prices: { videoEach: number | null };
  approvals: AiApproval[];
  limits: { regenPerPreview: 3; regenPerBatch: 6; regenUsed: number; retryPerPreview: 2 };
  /** só em phase 'failed' por PLAN_FAILED */
  errorCode: string | null;
  failReason: string | null;
  failureCode: AiBatchFailureCode | null;
}

/** QA 07/11 MÉDIO-1: códigos estáveis de falha (web traduz; fallback genérico pra valor desconhecido) */
export type AiPreviewFailureCode = 'planning_failed' | 'planning_interrupted' | 'image_failed' | 'image_blocked' | 'image_timeout';
export type AiBatchFailureCode = 'too_few_previews' | 'planning_failed' | 'planning_interrupted';

// ───────── erros novos ─────────

/** 429 REGEN_LIMIT */
export interface RegenLimitDetails { scope: 'preview' | 'batch' | 'retry'; used: number; max: number }

// ───────── planejador semantic-v2 (porta da maquina-ia; não sai na API) ─────────

/** Um falante da prévia: pessoa + cenário próprios, gerados a partir da oferta (sem nicho no código). */
export interface SemanticCastMember {
  speaker: AiSpeaker;
  name: string;
  gender: AiGender;
  /** descrição da pessoa e do cenário para o facePromptV2 (inglês); F10: olhares opostos entre os 2 */
  description: string;
}
export interface SemanticVariationV2 extends Omit<SemanticVariation, 'formatId' | 'beats'> {
  formatId: AiFormat;
  /** ≤ 240, 2 frases, idioma da interface */
  summary: string;
  /** sempre false na v1 (P1: 4 ideias novas) */
  faithful: false;
  beats: (Omit<SemanticBeat, 'speaker'> & { speaker: AiSpeaker })[];
  cast: SemanticCastMember[];
}
export interface SemanticPlanV2 {
  version: 'semantic-v2';
  language: string;
  uiLocale: string /* 'en' | 'pt-BR' (o backend converte User.uiLocale EN/PT_BR) */;
  facts: SemanticFact[];
  /** candidatas na ordem do modelo; o backend filtra pelo producibleVariation v2 */
  variations: SemanticVariationV2[];
  generationMode: 'mock' | 'live';
  costUsd: number;
}
/** planPreviews: count = 5 candidatas. planOne: exclude = variações vivas do lote (ready/approved/imaging). */
export interface PlanPreviewsRequest { format: AiFormat; count: number; uiLocale: string /* 'en' | 'pt-BR' (o backend converte User.uiLocale EN/PT_BR) */ }
export interface PlanOneRequest { format: AiFormat; uiLocale: string /* 'en' | 'pt-BR' (o backend converte User.uiLocale EN/PT_BR) */; exclude: Pick<SemanticVariationV2, 'title' | 'angle' | 'cast'>[] }
