import type { UserRef } from '@maquina/contratos';
import { initials } from '../common/util/format';
import { EventosService } from '../eventos/eventos.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quem salvou a edição por último (EDIT_CONFLICT.details e editor.updated). editor-universal-v1 §10: virou coluna
 * (`creatives.edit_saved_by_id/at`, gravadas no mesmo update da revisão); o `EditorSaves` em memória saiu. Linha antiga
 * (sem as colunas preenchidas) = o autor do criativo e o updatedAt, como antes.
 */
export async function lastSave(
  prisma: PrismaService,
  c: { createdById: string; updatedAt: Date; editSavedById?: string | null; editSavedAt?: Date | null },
): Promise<{ savedBy: UserRef; savedAt: string }> {
  const id = c.editSavedById ?? c.createdById;
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return { savedBy: { id, name: u?.name ?? '', initials: initials(u?.name ?? '') }, savedAt: (c.editSavedAt ?? c.updatedAt).toISOString() };
}

/** Avisa as outras abas (editor-v1 §9). Usado pelo PUT /editor e pelo PATCH /edit, depois de gravar as colunas. */
export async function anunciarEdicao(
  deps: { prisma: PrismaService; eventos: EventosService },
  creativeId: string, userId: string, revision: number, at: Date,
) {
  const u = await deps.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  const savedBy: UserRef = { id: userId, name: u?.name ?? '', initials: initials(u?.name ?? '') };
  deps.eventos.publish(creativeId, 'editor.updated', { revision, savedBy, savedAt: at.toISOString() });
}
