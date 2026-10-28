// Fase 2 · agência multi-cliente (docs/contratos/fase2-agencia.md, APROVADO 12/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Cliente = Workspace. Papel CLIENT, status derivado, onboarding de 6 passos, "waiting on you" (Home e Clients), download com nome padronizado.
import type { AuthSession, Role, UserRef } from './index';
import type { OnboardingStepInfo } from './onboarding-v2';

// ───────────────────────── cliente (workspace) ─────────────────────────
/**
 * @deprecated resultado-v1 (28/10): substituído por `ResultType`. Continua na resposta (derivado do `resultType`, pra quem ainda lê)
 * e na entrada (`businessType` sem `resultType` migra: ONLINE_STORE → PURCHASE, LOCAL_BUSINESS → LEAD, APP → APP_INSTALL).
 */
export type BusinessType = 'ONLINE_STORE' | 'LOCAL_BUSINESS' | 'APP';
/**
 * resultado-v1 (28/10, teste manual A3): "What counts as a result?". Fonte da verdade do resultado do cliente; decide o
 * objetivo e o evento de otimização da Meta na publicação e o que o sync conta como resultado (tabela em fase2-agencia.md §1.1).
 * OTHER exige `resultTypeOther` (texto livre ≤ 80).
 */
export type ResultType = 'PURCHASE' | 'LEAD' | 'MESSAGE' | 'APPOINTMENT' | 'SIGNUP' | 'SUBSCRIPTION' | 'APP_INSTALL' | 'OTHER';
/** Derivado de ResultType (não é salvo): PURCHASE → PURCHASES, LEAD → LEADS, MESSAGE → MESSAGES, APPOINTMENT → APPOINTMENTS,
 *  SIGNUP → SIGNUPS, SUBSCRIPTION → SUBSCRIPTIONS, APP_INSTALL → INSTALLS, OTHER → RESULTS. */
export type DefaultResult = 'PURCHASES' | 'LEADS' | 'INSTALLS' | 'MESSAGES' | 'APPOINTMENTS' | 'SIGNUPS' | 'SUBSCRIPTIONS' | 'RESULTS';
/**
 * resultado-v1 (28/10, A2): o que a leitura do site sugere pro passo 1 (OfferExtractOutput.business). Tudo sugestão: o web
 * pré-preenche só campo VAZIO e o usuário edita. null = a leitura não achou.
 */
export interface BusinessSuggestion {
  /** ramo curto, 1-4 palavras, no idioma da página (ex.: "Skincare", "Clínica odontológica") */
  industry: string | null;
  /** país/região principal (ex.: "United States", "Brasil"); só quando a página deixa claro */
  market: string | null;
  /** cor de destaque `#RRGGBB` lida do DOM renderizado (fundo dos CTAs) ou do `<meta name=theme-color>`; nunca chutada */
  brandColor: string | null;
  /** de onde saiu a cor: 'cta' (computed style dos botões) | 'theme_color' (meta) | null */
  brandColorSource: 'cta' | 'theme_color' | null;
  /** resultado sugerido pela leitura */
  resultType: ResultType | null;
  /** 2-6 [A-Z0-9] a partir do nome, sem repetir o shortCode de outro cliente dos membros deste workspace */
  shortCode: string | null;
}
/** Derivado: pausedAt → PAUSED; senão onboardingCompletedAt → LIVE; senão SETUP. */
export type ClientStatus = 'SETUP' | 'LIVE' | 'PAUSED';
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export interface Onboarding {
  step: OnboardingStep; totalSteps: 6; completedAt: string | null;
  // onboarding-v2 (21/10)
  /** §2 + D10: 0-100; passo conta se `state = done` E já foi alcançado (`step < onboardingStep`); 100 = concluído */
  percent: number;
  /** §2: 6 itens (5 com META_MODE=off, sem o meta) */
  steps: OnboardingStepInfo[];
  /** §3.2: quem mexeu por último no setup (tela "Setup in progress"); null = ninguém ainda */
  updatedBy: UserRef | null;
  updatedAt: string | null;
}

// ───────────────────────── "waiting on you" (mesma regra na Home e no Clients) ─────────────────────────
export interface WaitingOnYou {
  /** = meta.counts.needs_you da Home (waiting + failed, sem rascunho parado há 7+ dias) */
  creatives: number;
  /** lotes PLAN_READY ou PLAN_FAILED de campeão não arquivado (esperando launch ou replan) */
  batches: number;
  /** creatives + batches: o número que a Home e o cartão do Clients mostram */
  total: number;
}
/** Lote esperando a pessoa, listado no "Waiting for you" da Home (GET /creatives?filter=needs_you). */
export interface WaitingBatchRef {
  id: string; championId: string; championName: string;
  offer: { id: string; name: string };
  /** variacao-auto-v1 §5.4: lotes AUTO somam ANALYSIS_FAILED e PIECES_READY (LAUNCHED, tudo assentado, sem download) */
  status: 'PLAN_READY' | 'PLAN_FAILED' | 'ANALYSIS_FAILED' | 'PIECES_READY';
  /** variacao-auto-v1 §4. Opcional até B2 preencher (ausente = 'MANUAL'). */
  mode?: 'MANUAL' | 'AUTO';
  /** PIECES_READY: nº de peças prontas; senão null. Opcional até B2 preencher. */
  readyCount?: number | null;
  updatedAt: string;
}

// ───────────────────────── §3.1 tela Clients ─────────────────────────
export interface ClientCard {
  id: string; name: string; shortCode: string;
  /** papel do usuário NESTE workspace */
  role: Role;
  /** é o workspace da sessão */
  isActive: boolean;
  status: ClientStatus; onboarding: Onboarding;
  industry: string | null; businessType: BusinessType | null; websiteUrl: string | null;
  /** resultado-v1 (28/10) */
  resultType: ResultType | null;
  waitingOnYou: WaitingOnYou;
  updatedAt: string;
}
export interface ClientsMeta {
  summary: { live: number; setup: number; paused: number; waitingTotal: number };
  /** papel OWNER/ADMIN no workspace ativo (mostra "New client") */
  canCreate: boolean;
}

// ───────────────────────── §3.2 New client ─────────────────────────
export interface CreateClientBody {
  /** 1-80 */
  name: string;
  /** 2-6 [A-Z0-9]; sem = derivado do nome */
  shortCode?: string;
  uiLocale?: 'EN' | 'PT_BR';
  websiteUrl?: string; industry?: string; market?: string;
  /** resultado-v1: OTHER exige `resultTypeOther` */
  resultType?: ResultType; resultTypeOther?: string;
  /** @deprecated use `resultType` (migra pelo mapa do BusinessType; ignorado se vier `resultType`) */
  businessType?: BusinessType;
  brandColor?: string;
  /** padrão true: OWNER/ADMIN do workspace ativo entram com o mesmo papel (D3) */
  copyTeam?: boolean;
}
/** Tokens novos com o `wid` do cliente criado (igual ao switch-workspace) + o cartão. */
export type CreateClientResponse = AuthSession & { client: ClientCard };

// ───────────────────────── §3.5 Send ─────────────────────────
export interface CreativeDownload {
  /** URL assinada (6 h) com Content-Disposition: attachment; filename="<fileName>" */
  url: string;
  /** "MC_NEW_1012_A_F2_9x16.mp4" (fase2-agencia.md §6) */
  fileName: string;
  /** true = congelado no OK final (Creative.adName); false = provisório */
  frozen: boolean;
  sizeBytes: number; durationSec: number | null; expiresAt: string;
}

// ───────────────────────── §5 Brain v0 (sem rota; cálculo em web/src/lib/brain.ts) ─────────────────────────
/** `businessType` = o resultado do cliente (`resultType != null`); a chave ficou pelo mapa do Brain no web. */
export type BrainItem =
  | 'businessType' | 'industry' | 'market' | 'offer'
  | 'what' | 'promise' | 'offerAndPrice' | 'cta' | 'audience' | 'pains' | 'proof' | 'notes'
  | 'spendCap';
export type BrainSection = 'business_offer' | 'audience' | 'proof' | 'custom_instructions' | 'goals';
/** Saída de brainCompleteness(workspace, offers): 13 itens de peso igual; itens Em breve nunca contam. */
export interface BrainCompleteness {
  percent: number;
  /** na ordem do BrainItem */
  missing: BrainItem[];
  sections: Record<BrainSection, 'ok' | 'partial' | 'empty'>;
}
