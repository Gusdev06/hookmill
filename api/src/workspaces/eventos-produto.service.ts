import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { ProductEventDto } from './dto/workspaces.dto';
import { EVENT_PROPS_MAX_CHARS } from './tour';

/** Hora do cliente aceita até 1 dia no futuro e 30 dias no passado; fora disso (ou inválida) = hora do servidor. */
const SKEW_FUTURE_MS = 86_400_000;
const SKEW_PAST_MS = 30 * 86_400_000;

/**
 * tour-v2 §6 (docs/contratos/tour-v2.md §3): POST /events. Um INSERT em lote (createMany) por requisição, teto de 50 eventos
 * e 2 KB de props por evento (o DTO já barrou nome desconhecido). workspaceId/userId/role vêm da sessão, nunca do corpo.
 */
@Injectable()
export class ProductEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(auth: AuthContext, events: ProductEventDto[], now = new Date()): Promise<number> {
    const rows: Prisma.ProductEventCreateManyInput[] = events.map((e, i) => {
      const props = e.props ?? {};
      if (JSON.stringify(props).length > EVENT_PROPS_MAX_CHARS) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: `events.${i}.props`, rule: 'max_chars' }] });
      }
      return { workspaceId: auth.workspaceId, userId: auth.userId, role: auth.role, name: e.name, props: props as Prisma.InputJsonValue, at: clientTime(e.at, now) };
    });
    const r = await this.prisma.productEvent.createMany({ data: rows });
    return r.count;
  }
}

export function clientTime(at: string | undefined, now: Date): Date {
  if (!at) return now;
  const t = Date.parse(at);
  if (Number.isNaN(t) || t > now.getTime() + SKEW_FUTURE_MS || t < now.getTime() - SKEW_PAST_MS) return now;
  return new Date(t);
}
