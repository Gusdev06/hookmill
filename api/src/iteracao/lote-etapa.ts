// lacunas-home-eddy-v1 §3.2/§5 (31/10): etapa DERIVADA do lote, numa função só (nó `batch` do Brain e GET /iterate).
// Bate com o WAITING_BATCH_WHERE (workspaces/waiting.ts): needsYou = plan_ready | failed | pieces_ready.
// 04/11 (Gusta): o lote AUTO sai do pieces_ready quando é baixado OU quando todas as peças prontas foram enviadas pra Meta.
import type { IterateBatchStage } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';

export interface LoteEtapaIn {
  status: 'PLANNING' | 'PLAN_READY' | 'PLAN_FAILED' | 'LAUNCHED' | 'ANALYZING' | 'ANALYSIS_FAILED';
  mode: 'MANUAL' | 'AUTO';
  /** criativos do lote não arquivados */
  pieces: number;
  /** algum criativo do lote em RENDERING */
  rendering: boolean;
  downloadedAt: Date | null;
  /** há ≥ 1 peça pronta (APPROVED, não arquivada) e todas têm MetaPublication com status ≠ FAILED */
  published: boolean;
}

/** Publicação que conta como "enviada pra Meta" (qualquer status ≠ FAILED). Mesmo filtro no select e no WAITING_BATCH_WHERE. */
export const SENT_PUBLICATION_WHERE: Prisma.MetaPublicationWhereInput = { status: { not: 'FAILED' } };

/** select dos criativos do lote que alimenta `piecesPublished` (e pieces/ready/rendering). */
export const BATCH_CREATIVES_SELECT = {
  where: { archivedAt: null },
  select: { state: true, metaPublications: { where: SENT_PUBLICATION_WHERE, select: { id: true }, take: 1 } },
} as const;

/** `published` do LoteEtapaIn a partir dos criativos não arquivados do lote. */
export function piecesPublished(creatives: { state: string; metaPublications: unknown[] }[]): boolean {
  const ready = creatives.filter((c) => c.state === 'APPROVED');
  return ready.length > 0 && ready.every((c) => c.metaPublications.length > 0);
}

export function batchStageOf(b: LoteEtapaIn): IterateBatchStage {
  switch (b.status) {
    case 'ANALYZING': return 'analyzing';
    case 'PLANNING': return 'planning';
    case 'PLAN_READY': return 'plan_ready';
    case 'PLAN_FAILED':
    case 'ANALYSIS_FAILED': return 'failed';
    case 'LAUNCHED':
      if (b.rendering) return 'generating';
      return b.mode === 'AUTO' && b.pieces > 0 && !b.downloadedAt && !b.published ? 'pieces_ready' : 'done';
  }
}

export const batchNeedsYou = (stage: IterateBatchStage): boolean => stage === 'plan_ready' || stage === 'failed' || stage === 'pieces_ready';

/** Chave do chip (namespace `status`, como o CreativeRow) + params. */
export function batchStatusOf(stage: IterateBatchStage, ready: number): { key: string; params: Record<string, string | number> } {
  return { key: `status.batch_${stage}`, params: stage === 'pieces_ready' ? { n: ready } : {} };
}
