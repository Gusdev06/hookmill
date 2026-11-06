import type { ErrorDetails } from '@maquina/contratos';
import { AppException } from './app-exception';

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * 409 SPEND_CAP_EXCEEDED. Sem `scope` = teto mensal geral (monthlySpendCapUsd, como sempre); `scope: 'research'` = teto
 * mensal da pesquisa do Ad Radar (ads-research-v1 §9/C.7), separado e que não trava o Gerar.
 */
export function spendCapExceeded(d: ErrorDetails['SPEND_CAP_EXCEEDED']): AppException {
  const details: ErrorDetails['SPEND_CAP_EXCEEDED'] = { spentUsd: round4(d.spentUsd), capUsd: round4(d.capUsd), estimateUsd: round4(d.estimateUsd), ...(d.scope && { scope: d.scope }) };
  return new AppException('SPEND_CAP_EXCEEDED', details as unknown as Record<string, unknown>, d.scope === 'research' ? 'Monthly research budget reached.' : undefined);
}
