// POST /api/v1/webhooks/wavespeed (público, assinado). eventos.md §3: verifica a assinatura sobre o corpo CRU,
// responde 200 rápido e processa fora da requisição (idempotente; o reconciliador cobre o que falhar aqui).
import { Body, Controller, HttpCode, Inject, Logger, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/auth-context';
import { verifyWebhook } from './assinatura';
import type { WaveSpeedGenerationService } from './generation.service';

export const WAVESPEED_WEBHOOK_ROUTE = 'webhooks/wavespeed';
export const WAVESPEED_LIVE = Symbol('WAVESPEED_LIVE');
export const WAVESPEED_WEBHOOK_SECRET = Symbol('WAVESPEED_WEBHOOK_SECRET');

@Public()
@SkipThrottle()
@Controller(WAVESPEED_WEBHOOK_ROUTE)
export class WaveSpeedWebhookController {
  private readonly log = new Logger('WaveSpeedWebhook');

  constructor(
    @Inject(WAVESPEED_LIVE) private readonly gen: WaveSpeedGenerationService | null,
    @Inject(WAVESPEED_WEBHOOK_SECRET) private readonly secret: string | null,
  ) {}

  @Post()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Body() body: unknown) {
    const v = verifyWebhook(req.headers, req.rawBody, this.secret);
    if (!v.ok) {
      this.log.warn(`rejected webhook: ${v.reason}`);
      throw new UnauthorizedException(v.reason); // sem tocar no banco
    }
    if (this.gen) {
      void this.gen.handleWebhook(body).catch((e) => this.log.error(`webhook processing failed (reconciler will retry): ${(e as Error).message}`));
    }
    return { received: true };
  }
}
