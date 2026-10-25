// Fase 2 (fase2-agencia.md §1-§2): cliente = workspace. Funções puras: status derivado, resultado padrão, código curto
// e a forma `Workspace` do contrato. Nenhuma outra parte do backend decide status do cliente por conta própria.
import type { BusinessType, ClientStatus, DefaultResult, Onboarding, OnboardingStep, Workspace as WorkspaceView } from '@maquina/contratos';
import type { Workspace } from '@prisma/client';
import { num } from '../common/util/format';

export const ONBOARDING_STEPS = 6 as const;

/** pausedAt → PAUSED; senão onboardingCompletedAt → LIVE; senão SETUP. */
export function clientStatusOf(ws: Pick<Workspace, 'pausedAt' | 'onboardingCompletedAt'>): ClientStatus {
  if (ws.pausedAt) return 'PAUSED';
  return ws.onboardingCompletedAt ? 'LIVE' : 'SETUP';
}

const DEFAULT_RESULT: Record<BusinessType, DefaultResult> = { ONLINE_STORE: 'PURCHASES', LOCAL_BUSINESS: 'LEADS', APP: 'INSTALLS' };
export function defaultResultOf(t: BusinessType | null): DefaultResult | null {
  return t ? DEFAULT_RESULT[t] : null;
}

/** Só a parte posicional do `Onboarding`; percent/steps/updatedBy vêm do `onboarding.ts` (onboardingFull). */
export function onboardingOf(ws: Pick<Workspace, 'onboardingStep' | 'onboardingCompletedAt'>): Pick<Onboarding, 'step' | 'totalSteps' | 'completedAt'> {
  const step = Math.min(ONBOARDING_STEPS, Math.max(1, ws.onboardingStep)) as OnboardingStep;
  return { step, totalSteps: ONBOARDING_STEPS, completedAt: ws.onboardingCompletedAt?.toISOString() ?? null };
}

export const SHORT_CODE_RE = /^[A-Z0-9]{2,6}$/;

/** Sem shortCode no New client: iniciais das palavras (até 6), senão 2 primeiras letras/dígitos, senão "WS". */
export function shortCodeFromName(name: string): string {
  const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = plain.split(/[^A-Z0-9]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join('').slice(0, 6);
  if (initials.length >= 2) return initials;
  const chars = words.join('');
  return chars.length >= 2 ? chars.slice(0, 2) : 'WS';
}

/** `Workspace` do contrato menos o `onboarding` completo (percent/steps/updatedBy): quem chama junta o `onboardingFull`. */
export type WorkspaceBase = Omit<WorkspaceView, 'onboarding'> & { onboarding: ReturnType<typeof onboardingOf> };

export function presentWorkspace(ws: Workspace): WorkspaceBase {
  return {
    id: ws.id,
    name: ws.name,
    uiLocale: ws.uiLocale,
    monthlySpendCapUsd: num(ws.monthlySpendCapUsd),
    shortCode: ws.shortCode,
    industry: ws.industry,
    market: ws.market,
    businessType: ws.businessType,
    defaultResult: defaultResultOf(ws.businessType),
    websiteUrl: ws.websiteUrl,
    brandColor: ws.brandColor ?? null, // 25/10 D3
    status: clientStatusOf(ws),
    onboarding: onboardingOf(ws),
  };
}
