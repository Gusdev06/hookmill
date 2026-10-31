// Amostra grátis (docs/contratos/amostra-gratis-v1.md, aprovado 29/10: P1 conta, P2 sem gateway, P3 0-3 s nítidos, P4 só OWN).
// PURO: acesso efetivo do workspace, decisão do POST /iterate, corte das peças da amostra e o que conta como lote da amostra.
import type { AccountAccess, AccountMode, PaymentRequiredDetails } from '@maquina/contratos';

/** Espelho dos limites de `contratos/src/amostra.ts` (o pacote de contratos é só tipos; não dá pra importar valor). */
export const SAMPLE_MAX_PIECES = 4;
export const SAMPLE_CAP_USD = 1;
export const SAMPLE_SHARP_SEC = 3;

/** Tipos que a amostra NUNCA usa (§2: sem STATIC; IA nem entra no `allowedFor`). */
export const SAMPLE_BLOCKED_TYPES: readonly string[] = ['STATIC'];

/** P1: PAID se algum OWNER for PAID; INTERNAL se algum OWNER for INTERNAL; senão SAMPLE (inclui workspace sem OWNER). */
export function effectiveAccess(owners: readonly AccountAccess[]): AccountAccess {
  if (owners.includes('PAID')) return 'PAID';
  if (owners.includes('INTERNAL')) return 'INTERNAL';
  return 'SAMPLE';
}

/** Plano pago ou equipe: nada trava. */
export const isUnlocked = (a: AccountAccess): boolean => a === 'PAID' || a === 'INTERNAL';

/** `VariationBatch.settings.sample === true` (§2). */
export function isSampleSettings(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && (settings as Record<string, unknown>).sample === true;
}

/** Lote da amostra com o workspace sem plano = travado (§1). */
export const isLocked = (settings: unknown, access: AccountAccess): boolean => isSampleSettings(settings) && !isUnlocked(access);

export type IterateAdmission = { kind: 'normal' } | { kind: 'sample' } | { kind: 'blocked'; details: PaymentRequiredDetails };

/**
 * `POST /iterate` (§2, P4): workspace PAID/INTERNAL = lote normal; SAMPLE + conta OWN sem amostra gasta = lote da amostra;
 * SAMPLE com amostra gasta ou fora do modo OWN = 402 `sample_used`.
 */
export function admitIterate(input: { access: AccountAccess; sampleUsed: boolean; accountMode: AccountMode | null }): IterateAdmission {
  if (isUnlocked(input.access)) return { kind: 'normal' };
  if (!input.sampleUsed && input.accountMode === 'OWN') return { kind: 'sample' };
  return { kind: 'blocked', details: { reason: 'sample_used', unlock: { pieces: 0 } } };
}

/**
 * §2: no máximo `max` peças incluídas na amostra, na ordem da seleção (a mesma do `selectPieces`). As que passam do teto
 * saem como `goal_cut` (não selecionáveis). Não muta a entrada.
 */
export function capSampleSelection<T extends { included: boolean; selection: string }>(selected: readonly T[], max = SAMPLE_MAX_PIECES): T[] {
  let n = 0;
  return selected.map((s) => {
    if (!s.included) return s;
    n++;
    return n <= max ? s : ({ ...s, included: false, selection: 'goal_cut' } as T);
  });
}
