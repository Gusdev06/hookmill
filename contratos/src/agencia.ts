// Fase 2 · agência multi-cliente (docs/contratos/fase2-agencia.md, APROVADO 12/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Cliente = Workspace. Papel CLIENT, status derivado, onboarding de 6 passos, "waiting on you" (Home e Clients), download com nome padronizado.
import type { AuthSession, Role } from './index';

// ───────────────────────── cliente (workspace) ─────────────────────────
export type BusinessType = 'ONLINE_STORE' | 'LOCAL_BUSINESS' | 'APP';
/** Derivado de BusinessType: ONLINE_STORE → PURCHASES, LOCAL_BUSINESS → LEADS, APP → INSTALLS. Não é salvo. */
export type DefaultResult = 'PURCHASES' | 'LEADS' | 'INSTALLS';
/** Derivado: pausedAt → PAUSED; senão onboardingCompletedAt → LIVE; senão SETUP. */
export type ClientStatus = 'SETUP' | 'LIVE' | 'PAUSED';
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export interface Onboarding { step: OnboardingStep; totalSteps: 6; completedAt: string | null }

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
  websiteUrl?: string; industry?: string; market?: string; businessType?: BusinessType;
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
