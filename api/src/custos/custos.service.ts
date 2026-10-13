import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Estimativa da escrita de roteiros/extração (Claude). Preço real fica em cost_entries (gravado pela ia);
 * aqui é só o valor usado pra checar o teto ANTES de chamar (estrutura.md: US$ 0,10-0,30 por rodada de 4).
 */
export const SCRIPT_ESTIMATE_USD = 0.075;
export const EXTRACT_ESTIMATE_USD = 0.05;

/** Início do mês UTC de `at` e do seguinte. */
export function monthRange(at = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    to: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
  };
}

/** externalId das tasks do modo mock (integracoes/mock: MOCK_EXTERNAL_PREFIX); custo zero. */
export const MOCK_TASK_PREFIX = 'mock_';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Teto de gasto e custo real. Só LÊ cost_entries e provider_tasks (quem grava é a integracoes).
 * Toda ação paga chama assertWithinCap(estimativa) antes de falar com o provedor.
 */
@Injectable()
export class CustosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gasto do mês = custo real gravado (cost_entries) + estimativa das tasks pagas ainda abertas no provedor.
   * O custo real só entra quando a task fecha (webhook/reconciliador); até lá a WaveSpeed já cobrou. Sem a parcela
   * aberta, o teto deixa passar o que está em voo (06/10: 15 lipsyncs, US$ 1,625, ficaram SUBMITTED quando a API
   * reiniciou em mock, que não reconcilia task live, e o gasto do mês não via nada). Task mock não custa: fica fora.
   */
  async monthSpent(workspaceId: string, at = new Date()): Promise<number> {
    const { from, to } = monthRange(at);
    const [recorded, open] = await Promise.all([
      this.prisma.costEntry.aggregate({
        where: { workspaceId, createdAt: { gte: from, lt: to } },
        _sum: { amountUsd: true },
      }),
      this.prisma.providerTask.aggregate({
        where: {
          workspaceId, status: 'SUBMITTED', costEntry: null, submittedAt: { gte: from, lt: to },
          NOT: { externalId: { startsWith: MOCK_TASK_PREFIX } },
        },
        _sum: { estimatedUsd: true },
      }),
    ]);
    return round4((num(recorded._sum.amountUsd) ?? 0) + (num(open._sum.estimatedUsd) ?? 0));
  }

  async cap(workspaceId: string): Promise<number | null> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { monthlySpendCapUsd: true } });
    return num(ws?.monthlySpendCapUsd);
  }

  /** { monthUsd, capUsd, afterUsd } do bloco spend do estimate. */
  async spendWith(workspaceId: string, estimateUsd: number) {
    const [monthUsd, capUsd] = await Promise.all([this.monthSpent(workspaceId), this.cap(workspaceId)]);
    return { monthUsd, capUsd, afterUsd: round4(monthUsd + estimateUsd) };
  }

  /** gasto do mês + estimativa ≤ teto, senão 409 SPEND_CAP_EXCEEDED { spentUsd, capUsd, estimateUsd }. */
  async assertWithinCap(workspaceId: string, estimateUsd: number): Promise<void> {
    const { monthUsd, capUsd } = await this.spendWith(workspaceId, estimateUsd);
    if (capUsd != null && monthUsd + estimateUsd > capUsd) {
      throw new AppException('SPEND_CAP_EXCEEDED', { spentUsd: monthUsd, capUsd, estimateUsd: round4(estimateUsd) });
    }
  }

  /** Custo real do criativo = soma das cost_entries dele. */
  async creativeCost(creativeId: string): Promise<number> {
    const r = await this.prisma.costEntry.aggregate({ where: { creativeId }, _sum: { amountUsd: true } });
    return round4(num(r._sum.amountUsd) ?? 0);
  }

  async creativeCosts(creativeIds: string[]): Promise<Map<string, number>> {
    if (!creativeIds.length) return new Map();
    const rows = await this.prisma.costEntry.groupBy({ by: ['creativeId'], where: { creativeId: { in: creativeIds } }, _sum: { amountUsd: true } });
    return new Map(rows.map((r) => [r.creativeId as string, round4(num(r._sum.amountUsd) ?? 0)]));
  }
}
