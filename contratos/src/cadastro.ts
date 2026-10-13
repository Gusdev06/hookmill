// Fase 2 · cadastro self-serve (docs/contratos/fase2-cadastro.md, APROVADO 12/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Só aditivo: nenhum tipo existente muda, então o tsc do api e do web não quebra.
import type { AuthSession, UiLocale } from './index';

/** POST /auth/signup (pública, throttle do login). Conta nova = "agência" com 1 cliente vazio, OWNER, em SETUP. */
export interface SignupBody {
  /** 1-120, sem espaço nas pontas */
  name: string;
  /** e-mail válido ≤ 254; normalizado como no login (trim + minúsculas) */
  email: string;
  /** 10-200 (mesma regra do convite e da troca de senha) */
  password: string;
  /** opcional, 1-80: vira o nome do 1º cliente (workspace). Sem = "New client". Não existe entidade agência (fase2-agencia D3) */
  agencyName?: string;
  /** opcional: idioma do usuário e do 1º cliente. Sem = EN */
  uiLocale?: UiLocale;
}
/** 201: igual ao login (tokens + user + workspace com role OWNER). O web manda pra /onboarding/1. */
export type SignupResponse = AuthSession;
