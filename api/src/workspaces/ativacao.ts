import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * tour-v2 §6 (docs/contratos/tour-v2.md §4): marcos de ativação do workspace. Gravados SÓ na 1ª vez (CAS `campo IS NULL`),
 * onde a ação já acontece, de preferência na mesma transação dela:
 *   firstBatchAt    = lote AUTO criado (IteracaoService.create: POST /iterate, /ad-templates/use e /:slug/use)
 *   firstGenerateAt = Gerar (IteracaoService.start: POST /iterate/:id/start)
 *   firstReadyAt    = 1ª peça pronta (EdicaoService.settleAuto: AUTO_APPROVE)
 *   firstSendAt     = 1º anúncio criado na Meta (MetaPublicacaoService: publicação assentada com publishedAt)
 */
export type ActivationMilestone = 'firstBatchAt' | 'firstGenerateAt' | 'firstReadyAt' | 'firstSendAt';
export const ACTIVATION_MILESTONES: readonly ActivationMilestone[] = ['firstBatchAt', 'firstGenerateAt', 'firstReadyAt', 'firstSendAt'];

type Db = Pick<PrismaClient, 'workspace'> | Pick<Prisma.TransactionClient, 'workspace'>;

/** 1 UPDATE pela PK com `campo IS NULL`: idempotente e barato. Devolve true se gravou agora (era a 1ª vez). */
export async function markActivation(db: Db, workspaceId: string, milestone: ActivationMilestone, at: Date = new Date()): Promise<boolean> {
  const r = await db.workspace.updateMany({ where: { id: workspaceId, [milestone]: null }, data: { [milestone]: at } });
  return r.count > 0;
}
