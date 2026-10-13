// "Waiting for you" (fase2-agencia.md §3.6): UMA função pra Home (GET /creatives meta) e pro cartão do Clients
// (GET /workspaces). Pro workspace ativo os dois números são iguais por construção.
import type { WaitingOnYou } from '@maquina/contratos';
import type { WaitingBatchRefAuto } from '../criativos/contrato-auto';
import type { Prisma } from '@prisma/client';
import { filterWhere } from '../criativos/derivacao';
import type { PrismaService } from '../prisma/prisma.service';

type Db = Pick<PrismaService, 'creative' | 'variationBatch'>;

/**
 * Lote esperando a pessoa, de campeão não arquivado (PLANNING/ANALYZING e lote gerando não contam):
 * - MANUAL: plano pronto (launch) ou falhou (replan);
 * - AUTO (variacao-auto-v1 §5.4): PLAN_READY, ANALYSIS_FAILED, ou LAUNCHED com todas as peças assentadas (nenhum criativo
 *   RENDERING) e zip ainda não baixado. Conta 1 vez por lote; as peças não entram no counts.needs_you (derivacao.ts).
 */
export const WAITING_BATCH_WHERE: Prisma.VariationBatchWhereInput = {
  champion: { archivedAt: null },
  OR: [
    { status: { in: ['PLAN_READY', 'PLAN_FAILED'] } },
    { mode: 'AUTO', status: 'ANALYSIS_FAILED' },
    { mode: 'AUTO', status: 'LAUNCHED', downloadedAt: null, creatives: { some: {}, none: { state: 'RENDERING' } } },
  ],
};

/** Criativo esperando a pessoa: o mesmo where do `counts.needs_you` da Home, SEM filtros de busca. */
export function waitingCreativesWhere(now = Date.now()): Prisma.CreativeWhereInput {
  return { AND: [{ archivedAt: null }, filterWhere('needs_you', now)] };
}

export const ZERO_WAITING: WaitingOnYou = { creatives: 0, batches: 0, total: 0 };

/** 2 groupBy(workspaceId), sem N+1. Workspace sem nada esperando vem com zeros. */
export async function waitingOnYou(db: Db, workspaceIds: string[], now = Date.now()): Promise<Map<string, WaitingOnYou>> {
  const out = new Map<string, WaitingOnYou>(workspaceIds.map((id) => [id, { ...ZERO_WAITING }]));
  if (!workspaceIds.length) return out;
  const [creatives, batches] = await Promise.all([
    db.creative.groupBy({ by: ['workspaceId'], where: { AND: [{ workspaceId: { in: workspaceIds } }, waitingCreativesWhere(now)] }, _count: { _all: true } }),
    db.variationBatch.groupBy({ by: ['workspaceId'], where: { AND: [{ workspaceId: { in: workspaceIds } }, WAITING_BATCH_WHERE] }, _count: { _all: true } }),
  ]);
  for (const r of creatives) out.get(r.workspaceId)!.creatives = r._count._all;
  for (const r of batches) out.get(r.workspaceId)!.batches = r._count._all;
  for (const w of out.values()) w.total = w.creatives + w.batches;
  return out;
}

export const WAITING_BATCHES_LIMIT = 6;

/** Lotes listados no "Waiting for you" da Home (até 6, updatedAt desc). Link do lote AUTO no web: /iterate/:id. */
export async function waitingBatches(db: Db, workspaceId: string): Promise<WaitingBatchRefAuto[]> {
  const rows = await db.variationBatch.findMany({
    where: { AND: [{ workspaceId }, WAITING_BATCH_WHERE] },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: WAITING_BATCHES_LIMIT,
    select: {
      id: true, championId: true, status: true, mode: true, updatedAt: true,
      champion: { select: { name: true } }, offer: { select: { id: true, name: true } },
      _count: { select: { creatives: { where: { state: 'APPROVED', archivedAt: null } } } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    championId: b.championId,
    championName: b.champion.name,
    offer: b.offer,
    status: (b.mode === 'AUTO' && b.status === 'LAUNCHED' ? 'PIECES_READY' : b.status) as WaitingBatchRefAuto['status'],
    mode: b.mode,
    readyCount: b.mode === 'AUTO' && b.status === 'LAUNCHED' ? b._count.creatives : null,
    updatedAt: b.updatedAt.toISOString(),
  }));
}
