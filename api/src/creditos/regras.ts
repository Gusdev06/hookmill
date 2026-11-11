// templates-creditos-v1 §4 (31/10): conta dos créditos de um lote de template. PURO (sem banco), testado em regras.spec.ts.
import type { PieceStatus, TemplateTier } from '@maquina/contratos';

/** Usos grátis da amostra (§5). O teto do pack mora no catálogo (`credits` do pack). */
export const sampleTemplateUses = (env: Record<string, string | undefined> = process.env) => Math.max(0, Number(env.SAMPLE_TEMPLATE_USES ?? 4) || 0);
/** §10: `TEMPLATES=on` liga a amostra por usos e o 402 `sample_templates` no POST /iterate. */
export const templatesOn = (env: Record<string, string | undefined> = process.env) => (env.TEMPLATES ?? 'off').trim().toLowerCase() === 'on';

/** Estado da linha: held = reservada (ainda rodando ou Retry); charged = entregou; refunded = não entregou (voltou). */
export type LineState = 'held' | 'charged' | 'refunded';

/** Uma linha do lote = um template (no pack, as peças agrupadas pelo template de onde vêm). */
export interface RunLine {
  key: string;
  templateId: string;
  slug: string;
  tier: TemplateTier;
  credits: number;
  itemIds: string[];
  state: LineState;
  delivered: number | null;
}

/** "FRAME:news" | "LIST_OVERLAY:versus" | "HEADLINE" | … (a chave do catálogo, `Template.internalKey`).
 *  `subId` = a moldura (FRAME) ou o `templateId` (LIST_OVERLAY, templates-lista-v1 §1). */
export function lineKeyOf(type: string | null | undefined, subId?: string | null): string {
  if ((type === 'FRAME' || type === 'LIST_OVERLAY') && subId) return `${type}:${subId}`;
  return String(type ?? '');
}
/** O `subId` do `lineKeyOf` a partir do `variation_items.payload` (FRAME: `params.template`; LIST_OVERLAY: `params.templateId`). */
export function lineSubIdOf(payload: unknown): string | null {
  const p = (payload as { params?: { template?: unknown; templateId?: unknown } } | null)?.params;
  const v = p?.template ?? p?.templateId;
  return typeof v === 'string' && v ? v : null;
}

/** §4.3 quote = min(teto, Σ créditos das linhas). */
export function quoteOf(lines: readonly Pick<RunLine, 'credits'>[], cap: number | null): number {
  const sum = lines.reduce((n, l) => n + Math.max(0, l.credits), 0);
  return cap == null ? sum : Math.min(cap, sum);
}

export const isTerminal = (s: PieceStatus): boolean => s === 'ready' || s === 'failed' || s === 'left_out';

/**
 * A3: créditos entregues pela linha. Edição/Estático: tudo se ≥ 1 peça pronta, nada se nenhuma. IA: a parte das prontas,
 * arredondada pra baixo (o cliente nunca paga peça que falhou).
 */
export function deliveredOf(line: Pick<RunLine, 'tier' | 'credits'>, statuses: readonly PieceStatus[]): number {
  const ready = statuses.filter((s) => s === 'ready').length;
  if (!statuses.length || !ready) return 0;
  if (line.tier !== 'AI') return line.credits;
  return Math.floor((line.credits * ready) / statuses.length);
}

export interface Settlement { target: number; charge: number; refund: number; lines: RunLine[] }

/**
 * §4.3 assentar: null enquanto alguma peça de linha `held` não terminou. alvo = min(teto, Σ entregue); cobrar = alvo − já
 * cobrado (nunca negativo, nunca mais que o reservado); devolver = reservado − cobrar.
 * templates-ia-previas-v1 §7 (07/11): linhas mistas. Só as `held` são (re)avaliadas; as já assentadas (`charged`/`refunded`,
 * de uma aprovação anterior) ficam como estão e entram no alvo pelo `delivered` gravado. Sem linha já assentada = igual a antes.
 */
export function settle(run: { cap: number | null; held: number; charged: number; lines: readonly RunLine[] }, statusOf: (itemId: string) => PieceStatus): Settlement | null {
  const per = run.lines.map((l) => (l.state === 'held' ? l.itemIds.map(statusOf) : []));
  if (per.some((ss) => ss.some((s) => !isTerminal(s)))) return null;
  const lines = run.lines.map((l, k) => {
    if (l.state !== 'held') return { ...l };
    const delivered = deliveredOf(l, per[k]);
    return { ...l, delivered, state: (delivered > 0 ? 'charged' : 'refunded') as LineState };
  });
  const sum = lines.reduce((n, l) => n + (l.delivered ?? 0), 0);
  const target = run.cap == null ? sum : Math.min(run.cap, sum);
  const charge = Math.min(run.held, Math.max(0, target - run.charged));
  return { target, charge, refund: run.held - charge, lines };
}

/**
 * A4: Retry de peça cuja linha não entregou (estornada). Reserva o que falta pro alvo projetado se a linha entregar:
 * min(teto, Σ (entregue | reservado das outras) + créditos da linha) − cobrado − reservado. 0 = já coberto (pack no teto).
 */
export function retryNeed(run: { cap: number | null; held: number; charged: number; lines: readonly RunLine[] }, lineKey: string): number {
  const sum = run.lines.reduce((n, l) => n + (l.key === lineKey || l.state === 'held' ? l.credits : l.delivered ?? 0), 0);
  const projected = run.cap == null ? sum : Math.min(run.cap, sum);
  return Math.max(0, projected - run.charged - run.held);
}

/** Idempotência do livro (§4.2). */
export const ledgerKey = {
  reserve: (runId: string, attempt: number) => `run:${runId}:reserve:${attempt}`,
  charge: (runId: string, attempt: number) => `run:${runId}:charge:${attempt}`,
  refund: (runId: string, attempt: number) => `run:${runId}:refund:${attempt}`,
  sampleGrant: (userId: string) => `sample-grant:${userId}`,
  manual: (key: string) => `manual:${key}`,
};
