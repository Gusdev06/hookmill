// Onboarding v2 (docs/contratos/onboarding-v2.md, APROVADO pelo Gusta em 21/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Exportado no index.ts; os campos aditivos nos tipos existentes (lista no fim) já estão aplicados lá.
import type { OnboardingStep } from './agencia';

/** User.accountMode: AGENCY = vários clientes (seletor, Clients); OWN = anúncios próprios (shell sem seletor). null = não respondeu. */
export type AccountMode = 'AGENCY' | 'OWN';

/** Derivado por conteúdo no backend (onboardingSteps()); o mesmo pra GET /workspace, cartão do Clients e Home. */
export interface OnboardingStepInfo {
  step: OnboardingStep;
  key: 'business' | 'meta' | 'offer' | 'audience' | 'goals' | 'brain';
  /** skipped: só o meta (pulado com "Skip for now") */
  state: 'done' | 'current' | 'todo' | 'skipped';
  /** meta = false com META_MODE=off (o web não mostra o passo; o wizard vira 5) */
  enabled: boolean;
}

/** Versão curta pro seletor de cliente (§3.5): "Setup 33 %". Vai em WorkspaceRef.onboarding (sessão e GET /auth/me). */
export interface OnboardingSummary { step: OnboardingStep; percent: number; completedAt: string | null }

export type TourStop = 'brain' | 'iterate' | 'concepts' | 'eddy' | 'home';
/** GET /workspace/tour: `iterate` só entra com conexão Meta ativa e ≥ 1 anúncio WINNER. */
export interface TourState { completedAt: string | null; stops: TourStop[] }
/** POST /workspace/tour/complete (idempotente) */
export interface TourCompleteResponse { tourCompletedAt: string }

/*
 * Aditivos em tipos EXISTENTES (APLICADOS em 21/10; obrigatórios desde o fim do QA, 21/10 noite):
 *   AuthUser.accountMode: AccountMode | null       (login, refresh, me, signup)
 *   WorkspaceRef.tourCompletedAt?: string | null    (só o workspace ATIVO da sessão/me; não entra em MeResponse.workspaces[])
 *   WorkspaceRef.status: ClientStatus              (ativo E cada item de MeResponse.workspaces[])
 *   WorkspaceRef.onboarding: OnboardingSummary     (idem)
 *   Onboarding.percent: number                     (0-100; 100 = concluído; = done / passos habilitados)
 *   Onboarding.steps: OnboardingStepInfo[]
 *   Onboarding.updatedBy: UserRef | null           (quem mexeu por último no setup; tela "Setup in progress")
 *   Onboarding.updatedAt: string | null
 *   UpdateMeBody.accountMode?: AccountMode          (PATCH /auth/me; AGENCY → OWN nunca dá 409, D9)
 *   SignupBody.accountMode?: AccountMode            (só se o design juntar a pergunta ao cadastro; D8 recomenda tela própria /start)
 */
