import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventosService } from '../eventos/eventos.service';
import { PrismaService } from '../prisma/prisma.service';
import { CREATIVE_CHANGED } from './state-machine';
import { CreativeViews } from './views';

/**
 * Ponte estado → SSE: registra o snapshot (CreativeDetail) e, a cada `creative.changed`, publica `creative.updated`
 * e `cost.updated` pra quem está ouvindo aquele criativo. Sem ouvinte, não consulta nada.
 */
@Injectable()
export class CreativeNotifier implements OnModuleInit {
  private readonly log = new Logger('CreativeNotifier');

  constructor(
    private readonly eventos: EventosService,
    private readonly views: CreativeViews,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.eventos.registerSnapshotProvider((creativeId, auth) => this.views.detailById(auth.workspaceId, creativeId));
  }

  @OnEvent(CREATIVE_CHANGED, { async: true })
  async onChanged(e: { creativeId: string }) {
    if (!this.eventos.listenerCount(e.creativeId)) return;
    try {
      const c = await this.views.loadFull(await this.workspaceOf(e.creativeId), e.creativeId);
      if (!c) return;
      const d = await this.views.detail(c);
      this.eventos.publish(e.creativeId, 'creative.updated', {
        id: d.id, state: d.state, step: d.step, status: d.status, statusKey: d.statusKey,
        statusParams: d.statusParams, progress: d.progress, savedAt: d.savedAt,
      });
      this.eventos.publish(e.creativeId, 'cost.updated', { costUsd: d.costUsd });
    } catch (err) {
      this.log.warn(`creative.updated de ${e.creativeId} falhou: ${(err as Error).message}`);
    }
  }

  private async workspaceOf(creativeId: string): Promise<string> {
    const c = await this.prisma.creative.findUnique({ where: { id: creativeId }, select: { workspaceId: true } });
    return c?.workspaceId ?? '';
  }
}
