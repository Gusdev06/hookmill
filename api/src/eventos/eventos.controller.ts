import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Auth, AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { EventosService, formatSse, HEARTBEAT_MS } from './eventos.service';

@ApiTags('creatives')
@ApiBearerAuth()
@Controller('creatives')
export class EventosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
  ) {}

  /** SSE do criativo: snapshot ao conectar, deltas depois, ": ping" a cada 20 s, fecha em APPROVED. */
  @Get(':id/events')
  async events(@Param('id') id: string, @Auth() auth: AuthContext, @Req() req: Request, @Res() res: Response) {
    const creative = await this.prisma.creative.findFirst({
      where: { id, workspaceId: auth.workspaceId, archivedAt: null },
      select: { id: true, state: true, name: true, updatedAt: true },
    });
    if (!creative) throw new AppException('NOT_FOUND');

    const provider = this.eventos.getSnapshotProvider();
    // Até o B2 registrar o CreativeDetail completo, o snapshot é o mínimo do banco.
    const snapshot = provider
      ? await provider(id, auth)
      : { id: creative.id, name: creative.name, state: creative.state, savedAt: creative.updatedAt.toISOString() };
    if (!snapshot) throw new AppException('NOT_FOUND');

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(formatSse({ event: 'snapshot', data: snapshot }));

    let closed = false;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const sub = this.eventos.stream(id).subscribe((msg) => {
      res.write(formatSse(msg));
      const state = (msg.data as { state?: string } | null)?.state;
      if (msg.event === 'creative.updated' && state === 'APPROVED') close();
    });
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      sub.unsubscribe();
      res.end();
    }
    req.on('close', close);
    if ((snapshot as { state?: string }).state === 'APPROVED') close();
  }
}
