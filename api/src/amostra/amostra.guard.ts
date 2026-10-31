// amostra-gratis-v1 §4: rotas de criativo (`/creatives/:id/...`) e de arquivo (`/files/:id`) que entregam o arquivo ou o
// usam (editor, publicar no Meta, download, detalhe) = 402 PAYMENT_REQUIRED `locked` se o criativo é de um lote da amostra
// sem plano. Roda depois do AuthGuard global (o workspace vem do token).
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthContext } from '../common/auth/auth-context';
import { AmostraService } from './amostra.service';

@Injectable()
export class SampleCreativeGuard implements CanActivate {
  constructor(private readonly amostra: AmostraService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext; params: Record<string, string> }>();
    if (req.auth && req.params.id) await this.amostra.assertCreativeUnlocked(req.auth.workspaceId, req.params.id);
    return true;
  }
}

@Injectable()
export class SampleFileGuard implements CanActivate {
  constructor(private readonly amostra: AmostraService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext; params: Record<string, string> }>();
    if (req.auth && req.params.id) await this.amostra.assertFileUnlocked(req.auth.workspaceId, req.params.id);
    return true;
  }
}
