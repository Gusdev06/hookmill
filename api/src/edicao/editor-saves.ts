import { Injectable } from '@nestjs/common';
import type { UserRef } from '@maquina/contratos';
import { initials } from '../common/util/format';
import { EventosService } from '../eventos/eventos.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quem salvou a edição por último (EDIT_CONFLICT.details e editor.updated). Em memória: a API roda numa instância só
 * (eventos.md). Depois de reiniciar, cai no autor do criativo e no updatedAt (não há coluna pra isso no §4).
 */
@Injectable()
export class EditorSaves {
  private readonly last = new Map<string, { savedBy: UserRef; savedAt: string }>();
  set(creativeId: string, savedBy: UserRef, savedAt: Date) {
    this.last.set(creativeId, { savedBy, savedAt: savedAt.toISOString() });
  }
  get(creativeId: string): { savedBy: UserRef; savedAt: string } | undefined {
    return this.last.get(creativeId);
  }
}

/** Registra a gravação e avisa as outras abas (editor-v1 §9). Usado pelo PUT /editor e pelo PATCH /edit. */
export async function anunciarEdicao(
  deps: { prisma: PrismaService; eventos: EventosService; saves: EditorSaves },
  creativeId: string, userId: string, revision: number, at: Date,
) {
  const u = await deps.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  const savedBy: UserRef = { id: userId, name: u?.name ?? '', initials: initials(u?.name ?? '') };
  deps.saves.set(creativeId, savedBy, at);
  deps.eventos.publish(creativeId, 'editor.updated', { revision, savedBy, savedAt: at.toISOString() });
}

