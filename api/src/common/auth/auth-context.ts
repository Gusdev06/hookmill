import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';

/** Quem está chamando. O workspace vem SEMPRE do token (nunca do corpo/URL). */
export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: MemberRole;
}

export interface AccessTokenPayload {
  sub: string;
  wid: string;
  role: MemberRole;
}

export const IS_PUBLIC_KEY = 'isPublic';
/** Rota sem login. Se vier Bearer válido, o contexto é preenchido mesmo assim (ex.: aceitar convite logado). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restringe por papel no workspace ativo. Papel fora da lista = 403 FORBIDDEN. */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);

export const CLIENT_ALLOWED_KEY = 'clientAllowed';
/**
 * fase2-agencia.md §4: o papel CLIENT só lê (GET/HEAD). Rota que muda algo e que o CLIENT pode usar precisa deste
 * decorator; o padrão é negar (403 FORBIDDEN no AuthGuard).
 */
export const ClientAllowed = () => SetMetadata(CLIENT_ALLOWED_KEY, true);

/** Injeta o AuthContext (rota autenticada). Em rota pública pode ser undefined. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  return ctx.switchToHttp().getRequest().auth;
});
