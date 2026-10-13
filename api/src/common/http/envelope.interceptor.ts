import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

/** Lista com meta: o envelope vira { success, data: items, meta }. Paginada = meta com nextCursor; GET /workspaces = ClientsMeta (sem cursor). */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: object,
  ) {}
}

export const RAW_RESPONSE_KEY = 'rawResponse';
/** Sai do envelope (ex.: webhook que precisa responder { received: true } cru). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (raw) return next.handle();
    return next.handle().pipe(
      map((value) => {
        if (value instanceof Paginated) return { success: true, data: value.items, meta: value.meta };
        return { success: true, data: value ?? null };
      }),
    );
  }
}
