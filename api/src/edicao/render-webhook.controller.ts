// POST /api/v1/webhooks/render (render-lambda-v1 §2.3, §6.4): fim do render no Remotion Lambda. Público, corpo CRU,
// assinatura HMAC-SHA512 do Remotion (`X-Remotion-Signature`) validada pelo adaptador lambda. Inválida = 401 e nada
// gravado. Válida = 200 na hora; o settle roda fora da requisição (o poller cobre webhook perdido).
import { Controller, HttpCode, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/auth/auth-context';
import { EdicaoService } from './edicao.service';

export const RENDER_WEBHOOK_ROUTE = 'webhooks/render';

@Public()
@Controller(RENDER_WEBHOOK_ROUTE)
export class RenderWebhookController {
  constructor(private readonly edicao: EdicaoService) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    const ok = await this.edicao.renderWebhook(req.rawBody ?? Buffer.alloc(0), req.headers);
    if (!ok) throw new UnauthorizedException('invalid render webhook signature');
    return { received: true };
  }
}
