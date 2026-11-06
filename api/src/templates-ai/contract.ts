import type { SemanticFormat, SemanticPlan, SemanticVariation } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';

export const TEMPLATE_AI_RUNNER = Symbol('TEMPLATE_AI_RUNNER');
export const AI_KEYS: Record<string, SemanticFormat> = { 'AI_VIDEO:F04': 'F04', 'AI_VIDEO:F09': 'F09', 'AI_VIDEO:F10': 'F10' };
export interface AiAuthorization { requestId: string; expectedCredits: number; format: SemanticFormat; fingerprint: string }
export interface TemplateAiRunner {
  initialize(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, authorization: AiAuthorization): Promise<void>;
  run(jobId: string, batchId: string): Promise<void>;
  retry(auth: AuthContext, pieceId: string): Promise<void>;
}
export const aiSettings = (settings: unknown): AiAuthorization | null => {
  const a = (settings as { aiGeneration?: AiAuthorization } | null)?.aiGeneration;
  return a && Object.values(AI_KEYS).includes(a.format) ? a : null;
};

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
