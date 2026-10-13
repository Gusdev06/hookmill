import { Injectable } from '@nestjs/common';
import type { VariationBatchStatus } from '@maquina/contratos';
import type { BatchMode, Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Máquina do lote. Dois modos na mesma tabela, cada evento vale só no seu modo (BATCH_EVENT_MODE, conferido no
 * compare-and-set):
 *  - MANUAL (feature-2-variar-campeao.md §3.2): nasce em PLANNING (POST /champions/:id/batches).
 *  - AUTO (variacao-auto-v1.md §3.1): nasce em ANALYZING (campeão novo/não analisado) ou PLANNING (campeão da Library
 *    já analisado), POST /iterate. ANALYSIS_FAILED volta pelo retry.
 * LAUNCHED é final nos dois; o progresso depois disso é derivado dos criativos.
 */
export const BATCH_TRANSITIONS = {
  /** ≥ 1 item READY e nenhum WRITING → PLAN_READY; todos FAILED → PLAN_FAILED */
  PLAN_SETTLED: { from: ['PLANNING'], to: ['PLAN_READY', 'PLAN_FAILED'] },
  /** POST /variation-batches/:id/replan (itens antigos descartados) */
  REPLAN: { from: ['PLAN_READY', 'PLAN_FAILED'], to: ['PLANNING'] },
  /** POST /variation-batches/:id/launch (cria os criativos) */
  LAUNCH: { from: ['PLAN_READY'], to: ['LAUNCHED'] },
  // ── AUTO (variacao-auto-v1 §3.1) ──
  /** campeão READY: a leitura acabou, começa o job AUTO_PLAN */
  AUTO_READING_DONE: { from: ['ANALYZING'], to: ['PLANNING'] },
  /** campeão FAILED (failStage reading) · Claude falhou 2x, plano inválido depois do reparo, INTERRUPTED (brain/planning) */
  AUTO_FAILED: { from: ['ANALYZING', 'PLANNING'], to: ['ANALYSIS_FAILED'] },
  /** plano válido (§6.3): itens criados na mesma transação */
  AUTO_PLAN_DONE: { from: ['PLANNING'], to: ['PLAN_READY'] },
  /** POST /iterate/:id/retry: ANALYZING se o campeão não está READY, senão PLANNING */
  AUTO_RETRY: { from: ['ANALYSIS_FAILED'], to: ['ANALYZING', 'PLANNING'] },
  /** POST /iterate/:id/start (cria os criativos e os renders na mesma transação) */
  AUTO_START: { from: ['PLAN_READY'], to: ['LAUNCHED'] },
} as const satisfies Record<string, { from: readonly VariationBatchStatus[]; to: readonly VariationBatchStatus[] }>;

export type BatchEvent = keyof typeof BATCH_TRANSITIONS;
export const BATCH_EVENTS = Object.keys(BATCH_TRANSITIONS) as BatchEvent[];

/** Modo em que cada evento vale (o CAS filtra por `mode`: evento AUTO nunca move lote MANUAL e vice-versa). */
export const BATCH_EVENT_MODE: Record<BatchEvent, BatchMode> = {
  PLAN_SETTLED: 'MANUAL', REPLAN: 'MANUAL', LAUNCH: 'MANUAL',
  AUTO_READING_DONE: 'AUTO', AUTO_FAILED: 'AUTO', AUTO_PLAN_DONE: 'AUTO', AUTO_RETRY: 'AUTO', AUTO_START: 'AUTO',
};

/** Estado de nascimento (gravado no create). */
export const BATCH_ENTRY = { MANUAL: 'PLANNING', AUTO_ANALYZE: 'ANALYZING', AUTO_REUSE: 'PLANNING' } as const satisfies Record<string, VariationBatchStatus>;

export function batchAllowedFrom(event: BatchEvent): VariationBatchStatus[] {
  return [...BATCH_TRANSITIONS[event].from];
}

export function batchInvalidState(state: VariationBatchStatus, allowed: VariationBatchStatus[]): AppException {
  return new AppException('INVALID_STATE', { state, allowed: [...new Set(allowed)] });
}

export function assertBatchCan(state: VariationBatchStatus, event: BatchEvent): void {
  if (!(BATCH_TRANSITIONS[event].from as readonly VariationBatchStatus[]).includes(state)) throw batchInvalidState(state, batchAllowedFrom(event));
}

type Db = Pick<PrismaService, 'variationBatch'> | Prisma.TransactionClient;

/** ÚNICO escritor de variation_batches.status (compare-and-set). */
@Injectable()
export class BatchStateMachine {
  constructor(private readonly prisma: PrismaService) {}

  async transition(input: {
    batchId: string; event: BatchEvent; to: VariationBatchStatus; from?: VariationBatchStatus;
    data?: Prisma.VariationBatchUncheckedUpdateManyInput; tx?: Prisma.TransactionClient;
  }): Promise<{ to: VariationBatchStatus }> {
    const def = BATCH_TRANSITIONS[input.event];
    if (!(def.to as readonly VariationBatchStatus[]).includes(input.to)) throw new Error(`transição inválida: ${input.event} → ${input.to}`);
    if (input.from && !(def.from as readonly VariationBatchStatus[]).includes(input.from)) throw new Error(`transição inválida: ${input.event} ${input.from} → ${input.to}`);
    const db: Db = input.tx ?? this.prisma;
    const fromSet = input.from ? [input.from] : batchAllowedFrom(input.event);
    const r = await db.variationBatch.updateMany({
      where: { id: input.batchId, status: { in: fromSet }, mode: BATCH_EVENT_MODE[input.event] },
      data: { ...input.data, status: input.to },
    });
    if (r.count !== 1) {
      const cur = await db.variationBatch.findUnique({ where: { id: input.batchId }, select: { status: true, mode: true } });
      if (!cur || cur.mode !== BATCH_EVENT_MODE[input.event]) throw new AppException('NOT_FOUND');
      throw batchInvalidState(cur.status, batchAllowedFrom(input.event));
    }
    return { to: input.to };
  }
}
