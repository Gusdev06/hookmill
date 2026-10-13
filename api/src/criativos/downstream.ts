import type { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import type { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface DownstreamLoss { scenesLost: number; rendersLost: number; spentUsd: number }

/** O que se perde (fica stale) se a escolha a montante mudar: cenas e renders vigentes + o que já custaram. */
export async function downstreamLoss(db: Db, creativeId: string): Promise<DownstreamLoss> {
  const [scenes, renders, takes] = await Promise.all([
    db.scene.findMany({ where: { creativeId, stale: false }, select: { id: true } }),
    db.render.count({ where: { creativeId, stale: false } }),
    db.take.findMany({ where: { creativeId, stale: false }, select: { id: true } }),
  ]);
  let spentUsd = 0;
  if (scenes.length || takes.length) {
    const r = await db.costEntry.aggregate({
      // §13.5: o custo do lipsync é do take (provider_tasks.take_id), não da fatia
      where: { providerTask: { OR: [{ sceneId: { in: scenes.map((s) => s.id) } }, { takeId: { in: takes.map((t) => t.id) } }] } },
      _sum: { amountUsd: true },
    });
    spentUsd = Math.round((num(r._sum.amountUsd) ?? 0) * 10_000) / 10_000;
  }
  return { scenesLost: scenes.length, rendersLost: renders, spentUsd };
}

export function hasLoss(l: DownstreamLoss): boolean {
  return l.scenesLost > 0 || l.rendersLost > 0;
}

/** Mudança a montante com cenas/renders vigentes: sem confirm = 409 CONFIRM_DOWNSTREAM_RESET { scenesLost, rendersLost, spentUsd }. */
export async function requireConfirm(db: Db, creativeId: string, confirm: boolean | undefined): Promise<DownstreamLoss> {
  const loss = await downstreamLoss(db, creativeId);
  if (hasLoss(loss) && !confirm) throw new AppException('CONFIRM_DOWNSTREAM_RESET', { ...loss });
  return loss;
}

/** Nada se apaga: cenas e renders vigentes viram stale (histórico e custo ficam). */
export async function markStale(db: Db, creativeId: string, what: { scenes?: boolean; renders?: boolean } = { scenes: true, renders: true }) {
  if (what.scenes !== false) {
    await db.scene.updateMany({ where: { creativeId, stale: false }, data: { stale: true } });
    await db.take.updateMany({ where: { creativeId, stale: false }, data: { stale: true } }); // §13.5: o take vai junto com as fatias
  }
  if (what.renders !== false) await db.render.updateMany({ where: { creativeId, stale: false }, data: { stale: true } });
}
