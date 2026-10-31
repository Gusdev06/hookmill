// amostra-gratis-v1 (docs/contratos/amostra-gratis-v1.md, aprovado pelo Gusta em 29/10 com as recomendações):
// P1 = plano da CONTA (User.access); P2 = sem gateway ainda ("talk to us" + admin libera); P3 = 0-3 s nítidos; P4 = só modo OWN.

/** SAMPLE = conta nova sem plano (1 amostra, travada); PAID = plano; INTERNAL = equipe/legado, nunca trava. */
export type AccountAccess = 'SAMPLE' | 'PAID' | 'INTERNAL';

/** 402 PAYMENT_REQUIRED: `locked` = peça/lote da amostra sem plano; `sample_used` = a conta já gastou a amostra. */
export interface PaymentRequiredDetails { reason: 'locked' | 'sample_used'; unlock: { pieces: number } }

/** Limites fixos da amostra (§0, §2, §6). */
export const SAMPLE_MAX_PIECES = 4;
export const SAMPLE_CAP_USD = 1;
export const SAMPLE_SHARP_SEC = 3;

/** PATCH /admin/users/:id/access (só INTERNAL OWNER, §5: liberação manual até existir checkout). */
export interface UpdateAccessBody { access: AccountAccess }
