// templates-ia-previas-v1 §3/§5.6: regras PURAS das prévias (máquina de estados, fase pública, vista). Testadas em previews.spec.ts.
import type {
  AiFormat, AiGender, AiPhase, AiPreview, AiPreviewCastMember, AiPreviewStatus, AiSpeaker, PieceStatus, SemanticVariationV2,
} from '@maquina/contratos';
import { AI_PREVIEW_MIN, AI_PREVIEW_REGEN_PER_PREVIEW, AI_PREVIEW_RETRY_PER_PREVIEW } from './contract';

export type DbPreviewStatus = 'PLANNED' | 'IMAGING' | 'READY' | 'FAILED' | 'APPROVED';
export type DbBatchStatus = 'PLANNING' | 'PLAN_READY' | 'PLAN_FAILED' | 'LAUNCHED' | 'ANALYZING' | 'ANALYSIS_FAILED';

// ───────── máquina de estados (§3.1/§3.2): transições explícitas; o service só escreve status por aqui ─────────

export type PreviewEvent = 'IMAGES_SUBMITTED' | 'IMAGES_READY' | 'FAIL' | 'APPROVE' | 'REGENERATE' | 'RETRY_PLANNING' | 'RETRY_IMAGING';
export const PREVIEW_TRANSITIONS: Record<PreviewEvent, { from: DbPreviewStatus[]; to: DbPreviewStatus }> = {
  IMAGES_SUBMITTED: { from: ['PLANNED'], to: 'IMAGING' },
  IMAGES_READY: { from: ['IMAGING'], to: 'READY' },
  FAIL: { from: ['PLANNED', 'IMAGING'], to: 'FAILED' },
  APPROVE: { from: ['READY'], to: 'APPROVED' },
  REGENERATE: { from: ['READY'], to: 'PLANNED' },
  RETRY_PLANNING: { from: ['FAILED'], to: 'PLANNED' },
  RETRY_IMAGING: { from: ['FAILED'], to: 'IMAGING' },
};

export type BatchEvent = 'PREVIEWS_READY' | 'PLAN_FAILED' | 'FIRST_APPROVAL';
export const BATCH_TRANSITIONS: Record<BatchEvent, { from: DbBatchStatus[]; to: DbBatchStatus }> = {
  PREVIEWS_READY: { from: ['PLANNING'], to: 'PLAN_READY' },
  PLAN_FAILED: { from: ['PLANNING'], to: 'PLAN_FAILED' },
  FIRST_APPROVAL: { from: ['PLANNING', 'PLAN_READY'], to: 'LAUNCHED' },
};
/** Lote aceita approve/regenerate (§5.3/§5.4). retry: qualquer um ≠ PLAN_FAILED (§5.5), na prática os mesmos 3. */
export const AI_BATCH_WRITABLE: DbBatchStatus[] = ['PLANNING', 'PLAN_READY', 'LAUNCHED'];

/**
 * §3.1: fim do planning. Só avalia lote `PLANNING`, sem aprovação, com o planejador inicial já respondido (há itens) e
 * nenhuma prévia em PLANNED/IMAGING. ≥ 2 READY = PLAN_READY; senão PLAN_FAILED. null = nada a fazer ainda.
 */
export function planningOutcome(b: { status: string; approvals: number }, previews: readonly DbPreviewStatus[]): BatchEvent | null {
  if (b.status !== 'PLANNING' || b.approvals > 0 || !previews.length) return null;
  if (previews.some((s) => s === 'PLANNED' || s === 'IMAGING')) return null;
  return previews.filter((s) => s === 'READY').length >= AI_PREVIEW_MIN ? 'PREVIEWS_READY' : 'PLAN_FAILED';
}

// ───────── fase pública (§3.1, avaliada nesta ordem) ─────────

const finished = (s: PieceStatus) => s === 'ready' || s === 'failed' || s === 'left_out';

/** `pieces` = status das peças das prévias APROVADAS. */
export function aiPhaseOf(batchStatus: string, pieces: readonly PieceStatus[]): AiPhase {
  if (batchStatus === 'PLAN_FAILED' || batchStatus === 'ANALYSIS_FAILED') return 'failed';
  if (pieces.length) {
    if (pieces.some((s) => !finished(s))) return 'producing';
    if (pieces.every((s) => s !== 'ready')) return 'failed';
    return 'done';
  }
  if (batchStatus === 'PLAN_READY' || batchStatus === 'LAUNCHED') return 'previews_ready';
  return 'planning';
}

// ───────── persistência da prévia (§5.7) ─────────

export interface PreviewCast { speaker: AiSpeaker; name: string; gender: AiGender; description: string; voiceId: string; voiceName: string; castingId: string; faceId: string }
export interface PreviewPayload {
  version: 'semantic-v2';
  variation: SemanticVariationV2 | null;
  summary: string | null;
  cast: PreviewCast[];
  failStage: 'planning' | 'imaging' | null;
  /** quando as imagens foram submetidas (timeout de 10 min) */
  imagingAt?: string | null;
  history: { variation: SemanticVariationV2 | null; cast: PreviewCast[]; at: string }[];
  regens: { requestId: string; at: string }[];
  retries: { requestId: string; at: string }[];
}
export const previewOf = (payload: unknown): PreviewPayload | null => ((payload as { preview?: PreviewPayload } | null)?.preview ?? null);
export const emptyPreview = (): PreviewPayload => ({ version: 'semantic-v2', variation: null, summary: null, cast: [], failStage: null, imagingAt: null, history: [], regens: [], retries: [] });

export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export const letterOf = (index: number) => LETTERS[Math.max(0, Math.min(3, index))];
export const previewCode = (format: AiFormat, index: number) => `AI-${format}-${letterOf(index)}`;

// ───────── vista (§5.6) ─────────

/**
 * MÉDIO-1 (QA 07/11): código estável da falha pro web traduzir (o `failReason` fica em inglês, só pra log).
 * Prévia: deriva de failStage + errorCode. Lote PLAN_FAILED: interrompido, planejador falhou ou poucas prévias.
 */
export type { AiPreviewFailureCode, AiBatchFailureCode } from '@maquina/contratos';
import type { AiPreviewFailureCode, AiBatchFailureCode } from '@maquina/contratos';
export function previewFailureCode(stage: 'planning' | 'imaging' | null, errorCode: string | null): AiPreviewFailureCode {
  if (stage === 'imaging') return errorCode === 'SAFETY_BLOCK' ? 'image_blocked' : errorCode === 'PROVIDER_TIMEOUT' ? 'image_timeout' : 'image_failed';
  return errorCode === 'INTERRUPTED' ? 'planning_interrupted' : 'planning_failed';
}
/** `plannerAnswered` = o planejador inicial respondeu (houve candidatas filtradas ou itens): falha = poucas prévias produzíveis/prontas. */
export function batchFailureCode(errorCode: string | null, plannerAnswered: boolean): AiBatchFailureCode {
  if (errorCode === 'INTERRUPTED') return 'planning_interrupted';
  return plannerAnswered ? 'too_few_previews' : 'planning_failed';
}
/** A vista pública (o `failureCode` já está no `AiPreview` do contrato). */
export type AiPreviewOut = AiPreview;

export interface PreviewRow {
  id: string; index: number; previewStatus: DbPreviewStatus; previewRegens: number; previewRetries: number; approvedAt: Date | null;
  errorCode: string | null; failReason: string | null; payload: unknown;
}
export interface FaceInfo { status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'; image: { fileId: string; url: string; width: number; height: number } | null }

const castStatus: Record<FaceInfo['status'], AiPreviewCastMember['status']> = { QUEUED: 'queued', GENERATING: 'generating', READY: 'ready', FAILED: 'failed' };
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** §4.1: duração = palavras / 2,6 (1 casa). */
export const durationOf = (v: Pick<SemanticVariationV2, 'beats'>) => Math.round((v.beats.reduce((n, b) => n + words(b.text), 0) / 2.6) * 10) / 10;

export function previewView(i: PreviewRow, faces: ReadonlyMap<string, FaceInfo>, videoEach: number | null): AiPreviewOut {
  const p = previewOf(i.payload) ?? emptyPreview();
  const v = p.variation;
  const status = i.previewStatus.toLowerCase() as AiPreviewStatus;
  return {
    id: i.id, index: i.index, letter: letterOf(i.index), status,
    title: v?.title ?? null, angle: v?.angle ?? null, hook: v?.beats[0]?.text ?? null, summary: v ? (p.summary ?? v.summary ?? null) : null,
    beats: v ? v.beats.map((b) => ({ speaker: b.speaker, role: b.role, text: b.text })) : [],
    changes: v ? v.changes.map((c) => ({ axis: c.axis, before: c.before, after: c.after })) : [],
    preserved: v ? [...v.preserved] : [],
    cast: v ? p.cast.map((c) => {
      const f = faces.get(c.faceId);
      return { speaker: c.speaker, name: c.name, gender: c.gender, voiceId: c.voiceId, voiceName: c.voiceName, image: f?.status === 'READY' ? f.image : null, status: f ? castStatus[f.status] : 'queued' };
    }) : [],
    estimate: { durationSec: v ? durationOf(v) : 0, credits: videoEach },
    regenerations: { used: i.previewRegens, max: AI_PREVIEW_REGEN_PER_PREVIEW },
    retries: { used: i.previewRetries, max: AI_PREVIEW_RETRY_PER_PREVIEW },
    errorCode: status === 'failed' ? i.errorCode : null,
    failReason: status === 'failed' ? i.failReason : null,
    failStage: status === 'failed' ? p.failStage : null,
    failureCode: status === 'failed' ? previewFailureCode(p.failStage, i.errorCode) : null,
    action: status === 'failed' && i.previewRetries < AI_PREVIEW_RETRY_PER_PREVIEW ? 'retry' : null,
    approvedAt: i.approvedAt?.toISOString() ?? null,
    pieceId: status === 'approved' ? i.id : null,
  };
}

/** Idempotência do approve (§5.3): mesma chave = mesmo conjunto de prévias e mesmo expectedCredits. */
export const sameApproval = (a: { previewIds: string[]; credits: number }, b: { previewIds: string[]; credits: number }) =>
  a.credits === b.credits && [...a.previewIds].sort().join(',') === [...b.previewIds].sort().join(',');
