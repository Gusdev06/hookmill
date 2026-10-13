// Nome do arquivo com o banco (fase2-agencia.md §6): provisório (download antes do OK) e congelado (approve).
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { adFileName, withCollisionSuffix } from './ad-name';
import { autoAdName } from '../edicao/pecas';

type Db = Pick<PrismaService, 'creative'> | Prisma.TransactionClient;

const SELECT = {
  id: true, workspaceId: true, origin: true, approvedAt: true, format: true, adName: true,
  workspace: { select: { shortCode: true } },
  selectedScript: { select: { letter: true } },
  selectedFace: { select: { batch: true, position: true } },
  variationItem: { select: { kind: true, index: true, isControl: true } },
  variationKind: true, variationCode: true,
  variationBatch: { select: { launchedAt: true } },
} satisfies Prisma.CreativeSelect;

/**
 * Nome calculado na hora (não salva), já com o sufixo de colisão contra os nomes congelados do workspace.
 * `approvedAt` sobrescreve a data (o approve usa o instante do OK).
 */
export async function computeAdName(db: Db, creativeId: string, opts: { approvedAt?: Date; now?: Date } = {}): Promise<string> {
  const c = await db.creative.findUniqueOrThrow({ where: { id: creativeId }, select: SELECT });
  // variacao-auto-v1 §8: peça AUTO = CLIENTE_MMDD_CODIGO (data UTC do launchedAt do lote; formato vai no nome do arquivo)
  const base = c.variationKind === 'AUTO_EDIT' && c.variationCode
    ? autoAdName({ shortCode: c.workspace.shortCode, launchedAt: c.variationBatch?.launchedAt ?? opts.now ?? new Date(), code: c.variationCode })
    : adFileName({
    shortCode: c.workspace.shortCode,
    origin: c.origin,
    approvedAt: opts.approvedAt ?? c.approvedAt,
    now: opts.now,
    scriptLetter: c.selectedScript?.letter ?? null,
    variation: c.variationItem,
    face: c.selectedFace,
    format: c.format,
  });
  const taken = await db.creative.findMany({
    where: { workspaceId: c.workspaceId, id: { not: c.id }, adName: { startsWith: base } },
    select: { adName: true },
  });
  return withCollisionSuffix(base, taken.map((t) => t.adName!));
}

/** Corrida no unique (workspaceId, adName). */
export function isAdNameConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  const t = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return t.includes('ad_name') || t.includes('adName');
}
