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
export interface OnboardingSummary {
  step: OnboardingStep; percent: number; completedAt: string | null;
  /** lacunas-home-eddy-v1 §1 (31/10): o que a pessoa confirmou na conversa do Eddy. Opcional só no tipo (mocks antigos); a API manda sempre. */
  confirmed?: OnboardingConfirmItem[];
}

/** lacunas-home-eddy-v1 §1 (31/10): cartão confirmado pela pessoa no onboarding com o Eddy ("lido" ≠ "confirmado"). */
export type OnboardingConfirmItem = 'business' | 'offer' | 'meta' | 'goals' | 'kit';
export const ONBOARDING_CONFIRM_ITEMS: readonly OnboardingConfirmItem[] = ['business', 'offer', 'meta', 'goals', 'kit'];

/** v1 (LEGADO): o que `GET /workspace/tour` devolve SEM `?v=2`, até o web trocar pro tour v2. */
export type TourStop = 'brain' | 'iterate' | 'concepts' | 'eddy' | 'home';
/**
 * GET /workspace/tour (sem `?v=2`, legado): `iterate` só entra com conexão Meta ativa e ≥ 1 anúncio WINNER.
 * Desde tour-v2 (04/11) também traz, aditivos, `winnerMetaAdId`, `winnerName` e `tipsSeen` (mesmo valor do v2).
 */
export interface TourState {
  completedAt: string | null; stops: TourStop[];
  winnerMetaAdId?: string | null; winnerName?: string | null; tipsSeen?: TipKey[];
}

// ───────── tour-v2 (docs/contratos/tour-v2.md, spec design/tour-v2-2026-11-04.md, APROVADO 04/11) ─────────

/** Paradas do tour linear v2. OWNER/ADMIN/MEMBER: brain, templates (+ credits se a conta não é unlimited). CLIENT: brain, review. */
export type TourStopV2 = 'brain' | 'templates' | 'credits' | 'review';
/** Dicas contextuais de 1ª vez (§4 + 5ª dica `library`, decisão do Gusta 04/11). CLIENT não tem dica. */
export type TipKey = 'adSource' | 'plan' | 'result' | 'send' | 'library';
export const TIP_KEYS: readonly TipKey[] = ['adSource', 'plan', 'result', 'send', 'library'];

/** GET /workspace/tour?v=2 */
export interface TourStateV2 {
  /** do membership do usuário NESTE workspace; Skip também conclui */
  completedAt: string | null;
  stops: TourStopV2[];
  /** anúncio de VÍDEO com verdict WINNER e menor CPA (30 d) da conexão Meta ativa; null sem Meta ou sem vencedor */
  winnerMetaAdId: string | null;
  winnerName: string | null;
  /** dicas já dispensadas por este usuário neste workspace (ordem em que foram vistas) */
  tipsSeen: TipKey[];
}

/** POST /workspace/tour/tips (idempotente) */
export interface SeeTipBody { tip: TipKey }
/** resposta de POST e DELETE /workspace/tour/tips */
export interface TipsSeenResponse { tipsSeen: TipKey[] }

/** Nomes aceitos em POST /events (spec §6). Outro nome = 400. */
export type TourEventName =
  | 'tour_started' | 'tour_stop_viewed' | 'tour_stop_next' | 'tour_stop_back' | 'tour_stop_missing'
  | 'tour_skipped' | 'tour_completed' | 'tip_shown' | 'tip_dismissed' | 'tip_action';
export const TOUR_EVENT_NAMES: readonly TourEventName[] = [
  'tour_started', 'tour_stop_viewed', 'tour_stop_next', 'tour_stop_back', 'tour_stop_missing',
  'tour_skipped', 'tour_completed', 'tip_shown', 'tip_dismissed', 'tip_action',
];
/** Teto por requisição de POST /events. */
export const EVENTS_MAX_PER_REQUEST = 50;
/** Teto do `props` de cada evento (JSON serializado, em caracteres). */
export const EVENT_PROPS_MAX_CHARS = 2048;
export interface ProductEventInput {
  name: TourEventName;
  /** ISO 8601 do cliente; ausente/inválido = hora do servidor */
  at?: string;
  /** resto do evento (locale, viewport, variant, replay, stop, n, total, msOnStop, tip, how, action…). workspaceId, userId e
   *  role NÃO vão aqui: o servidor tira da sessão. */
  props?: Record<string, unknown>;
}
/** POST /events → 204 sem corpo */
export interface ProductEventsBody { events: ProductEventInput[] }
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
