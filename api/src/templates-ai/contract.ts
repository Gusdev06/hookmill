import type { AiFormat, SemanticFormat, SemanticPlan, SemanticPlanV2, SemanticVariation, SemanticVariationV2 } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { producibleProblemsV2 } from '../integracoes/claude/semantic-v2';

export const TEMPLATE_AI_RUNNER = Symbol('TEMPLATE_AI_RUNNER');
export const AI_KEYS: Record<string, SemanticFormat> = { 'AI_VIDEO:F04': 'F04', 'AI_VIDEO:F09': 'F09', 'AI_VIDEO:F10': 'F10' };
/**
 * Autorização do /use. Fluxo de 04/11 (`settings.aiGeneration`): requestId + expectedCredits (reserva no /use).
 * templates-ia-previas-v1 §5.1 (`settings.aiPreviews`, `previews: true`): requestId, sem crédito (prévias grátis).
 */
export interface AiAuthorization { requestId: string; expectedCredits?: number; format: SemanticFormat; fingerprint: string; previews?: true }
export interface TemplateAiRunner {
  initialize(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, authorization: AiAuthorization): Promise<void>;
  run(jobId: string, batchId: string): Promise<void>;
  retry(auth: AuthContext, pieceId: string): Promise<void>;
}
const isAi = (a: AiAuthorization | undefined): a is AiAuthorization => !!a && Object.values(AI_KEYS).includes(a.format);
/** Lote IA de qualquer fluxo (04/11 ou prévias). */
export const aiSettings = (settings: unknown): AiAuthorization | null => {
  const s = settings as { aiGeneration?: AiAuthorization; aiPreviews?: AiAuthorization } | null;
  if (isAi(s?.aiPreviews)) return { ...s!.aiPreviews!, previews: true };
  return isAi(s?.aiGeneration) ? s!.aiGeneration! : null;
};
/** Só lote de prévias (§5.7). */
export const aiPreviewsOf = (settings: unknown): (AiAuthorization & { format: AiFormat }) | null => {
  const a = aiSettings(settings);
  return a?.previews ? (a as AiAuthorization & { format: AiFormat }) : null;
};
/** Chave do settings onde mora a autorização (idempotência do /use). */
export const aiSettingsKey = (a: Pick<AiAuthorization, 'previews'>) => (a.previews ? 'aiPreviews' : 'aiGeneration');

/** `AI_PREVIEWS=on|off` (§1.8): com off, o fluxo de 04/11 roda igual e as rotas novas dão 404. */
export const aiPreviewsOn = (env: Record<string, string | undefined> = process.env) => (env.AI_PREVIEWS ?? 'off').trim().toLowerCase() === 'on';

/** §5.4/§5.5: tetos fixos das prévias. */
export const AI_PREVIEW_REGEN_PER_PREVIEW = 3;
export const AI_PREVIEW_REGEN_PER_BATCH = 6;
export const AI_PREVIEW_RETRY_PER_PREVIEW = 2;
/** §4.2: o planejador pede 5 candidatas; o lote guarda até 4; menos de 2 = PLAN_FAILED. */
export const AI_PREVIEW_CANDIDATES = 5;
export const AI_PREVIEW_MAX = 4;
export const AI_PREVIEW_MIN = 2;
/** §3.3: imagem que não termina em 10 min = prévia FAILED (imaging). */
export const AI_PREVIEW_IMAGING_TIMEOUT_MS = 10 * 60_000;

/** Escolha interna: somente o formato pedido e sem material/validação pendente. */
export function producibleVariation(plan: SemanticPlan, format: SemanticFormat): SemanticVariation {
  const v = plan.variations.find((v) => v.formatId === format && !v.requirements.length &&
    v.beats.length >= 3 && v.beats.length <= 6 &&
    v.beats.every((b) => b.text.trim().split(/\s+/).length >= 5) &&
    v.beats.reduce((n, b) => n + b.text.trim().split(/\s+/).length, 0) <= 120);
  if (!v) throw new Error('AI_PLAN_NOT_PRODUCIBLE: missing evidence or script outside production limits');
  if (format === 'F10' && !v.beats.every((b, i) => b.speaker === (i % 2 ? 'presenter' : 'host'))) throw new Error('AI_DIALOGUE_INVALID');
  return v;
}

/**
 * `producibleVariation` v2 (§4.2): as primeiras `max` candidatas do plano que passam no critério da maquina-ia
 * (`producibleProblemsV2`: formato, sem requirements, 3–6 falas, ≥ 5 palavras, ≤ 120, F10 alternando, cast certo, número
 * só da evidência) e com título/ângulo distintos das já aceitas (`accepted` = as vivas do lote, no novo ângulo).
 */
export function producibleVariationsV2(plan: Pick<SemanticPlanV2, 'variations'>, o: { format: AiFormat; evidence: string; max: number; accepted?: (Pick<SemanticVariationV2, 'title' | 'angle'> & { cast?: { name: string }[] })[] }): SemanticVariationV2[] {
  const picked: SemanticVariationV2[] = [];
  for (const v of plan.variations) {
    if (picked.length >= o.max) break;
    if (!producibleProblemsV2(v, { format: o.format, accepted: [...(o.accepted ?? []), ...picked], evidence: o.evidence }).length) picked.push(v);
  }
  return picked;
}
