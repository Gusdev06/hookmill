// Fase 2 (fase2-agencia.md §1-§2): cliente = workspace. Funções puras: status derivado, resultado padrão, código curto
// e a forma `Workspace` do contrato. Nenhuma outra parte do backend decide status do cliente por conta própria.
import type { ClientStatus, Onboarding, OnboardingStep, Workspace as WorkspaceView } from '@maquina/contratos';
import type { Workspace } from '@prisma/client';
import { num } from '../common/util/format';
import { defaultResultOf, legacyBusinessTypeOf } from './resultado';

export const ONBOARDING_STEPS = 6 as const;

/** pausedAt → PAUSED; senão onboardingCompletedAt → LIVE; senão SETUP. */
export function clientStatusOf(ws: Pick<Workspace, 'pausedAt' | 'onboardingCompletedAt'>): ClientStatus {
  if (ws.pausedAt) return 'PAUSED';
  return ws.onboardingCompletedAt ? 'LIVE' : 'SETUP';
}

// resultado-v1 (28/10): o resultado padrão sai do ResultType (resultado.ts); reexportado pra quem já importava daqui
export { defaultResultOf } from './resultado';

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

/**
 * resultado-v1 (A2): prefixo sugerido pela leitura. `shortCodeFromName` e, se outro cliente já usa, variações do próprio
 * nome (mais letras da 1ª palavra, iniciais + letra), por fim sufixo 2..99. null só se o nome não tiver letra/dígito.
 */
export function suggestShortCode(name: string, taken: ReadonlySet<string>): string | null {
  const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = plain.split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.join('')) return null;
  const base = shortCodeFromName(name);
  const joined = words.join('');
  const initials = words.map((w) => w[0]).join('');
  const candidates = [base];
  for (let n = 3; n <= 6; n++) candidates.push(joined.slice(0, n));
  if (words.length > 1) for (const w of words.slice(1)) for (let n = 2; n <= Math.min(4, w.length); n++) candidates.push((initials.slice(0, 1) + w.slice(0, n)).slice(0, 6));
  for (const c of candidates) if (SHORT_CODE_RE.test(c) && !taken.has(c)) return c;
  const stem = base.slice(0, 4);
  for (let i = 2; i < 100; i++) { const c = `${stem}${i}`; if (!taken.has(c)) return c; }
  return null;
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
    resultType: ws.resultType,
    resultTypeOther: ws.resultType === 'OTHER' ? ws.resultTypeOther : null,
    businessType: legacyBusinessTypeOf(ws.resultType), // @deprecated
    defaultResult: defaultResultOf(ws.resultType),
    websiteUrl: ws.websiteUrl,
    brandColor: ws.brandColor ?? null, // 25/10 D3
    status: clientStatusOf(ws),
    onboarding: onboardingOf(ws),
  };
}
