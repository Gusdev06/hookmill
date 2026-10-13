import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { MemberRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../errors/app-exception';
import { AccessTokenPayload, AuthContext, CLIENT_ALLOWED_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './auth-context';

/**
 * Guard global: JWT de acesso + workspace.
 * 1. valida o Bearer (assinatura e validade);
 * 2. confere no banco que o usuário está ativo e AINDA é membro do workspace do token
 *    (membro removido perde acesso na hora, sem esperar o token vencer);
 * 3. o papel vem do banco (não do token), e @Roles barra com 403;
 * 4. fase2-agencia.md §4: papel CLIENT + método diferente de GET/HEAD = 403, a menos que a rota tenha @ClientAllowed().
 * Resultado em req.auth = { userId, workspaceId, role }. Todo service filtra por esse workspaceId.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      if (isPublic) return true;
      throw new AppException('UNAUTHORIZED');
    }

    const auth = await this.resolve(token);
    if (!auth) {
      if (isPublic) return true;
      throw new AppException('UNAUTHORIZED');
    }
    req.auth = auth;

    if (!isPublic && auth.role === 'CLIENT' && !READ_METHODS.has(String(req.method).toUpperCase())) {
      if (!this.reflector.getAllAndOverride<boolean>(CLIENT_ALLOWED_KEY, targets)) throw new AppException('FORBIDDEN');
    }

    const roles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(auth.role)) throw new AppException('FORBIDDEN');
    return true;
  }

  private async resolve(token: string): Promise<AuthContext | null> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      return null;
    }
    if (!payload?.sub || !payload?.wid) return null;
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: payload.wid, userId: payload.sub } },
      select: { role: true, user: { select: { isActive: true } } },
    });
    if (!membership || !membership.user.isActive) return null;
    return { userId: payload.sub, workspaceId: payload.wid, role: membership.role };
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

export function extractBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
