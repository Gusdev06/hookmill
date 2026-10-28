// resultado-v1 (28/10, teste manual A3): "What counts as a result?". ÚNICO lugar que traduz o ResultType do cliente em
// objetivo/evento da Meta, no que o sync conta como resultado, no resultado padrão e no BusinessType antigo (compat).
// Tabela espelhada em docs/contratos/fase2-agencia.md §1.1.
import type { BusinessType, DefaultResult, MetaObjective, MetaPixelEvent, ResultType } from '@maquina/contratos';

export const RESULT_TYPES: readonly ResultType[] = ['PURCHASE', 'LEAD', 'MESSAGE', 'APPOINTMENT', 'SIGNUP', 'SUBSCRIPTION', 'APP_INSTALL', 'OTHER'];
export const RESULT_OTHER_MAX = 80;

export interface ResultProfile {
  /** objetivo da campanha na publicação v1 (só destino site; sem pixel o backend cai pra TRAFFIC) */
  objective: MetaObjective;
  /** promoted_object.custom_event_type do conjunto (com pixel); null = sem evento de pixel */
  pixelEvent: MetaPixelEvent | null;
  /** o resultado conta mesmo sem pixel (conversa iniciada é métrica da própria Meta) */
  countsWithoutPixel: boolean;
  defaultResult: DefaultResult;
  /** compat: o que a coluna business_type recebe (API anterior / integrações que ainda leem) */
  legacy: BusinessType | null;
}

export const RESULT_PROFILE: Record<ResultType, ResultProfile> = {
  PURCHASE: { objective: 'OUTCOME_SALES', pixelEvent: 'PURCHASE', countsWithoutPixel: false, defaultResult: 'PURCHASES', legacy: 'ONLINE_STORE' },
  SUBSCRIPTION: { objective: 'OUTCOME_SALES', pixelEvent: 'SUBSCRIBE', countsWithoutPixel: false, defaultResult: 'SUBSCRIPTIONS', legacy: 'ONLINE_STORE' },
  LEAD: { objective: 'OUTCOME_LEADS', pixelEvent: 'LEAD', countsWithoutPixel: false, defaultResult: 'LEADS', legacy: 'LOCAL_BUSINESS' },
  APPOINTMENT: { objective: 'OUTCOME_LEADS', pixelEvent: 'SCHEDULE', countsWithoutPixel: false, defaultResult: 'APPOINTMENTS', legacy: 'LOCAL_BUSINESS' },
  SIGNUP: { objective: 'OUTCOME_LEADS', pixelEvent: 'COMPLETE_REGISTRATION', countsWithoutPixel: false, defaultResult: 'SIGNUPS', legacy: 'LOCAL_BUSINESS' },
  // v1 publica só com destino site: conversa (CTWA/Direct/Messenger, OUTCOME_ENGAGEMENT + CONVERSATIONS) fica pra depois; publica por clique
  MESSAGE: { objective: 'OUTCOME_TRAFFIC', pixelEvent: null, countsWithoutPixel: true, defaultResult: 'MESSAGES', legacy: 'LOCAL_BUSINESS' },
  APP_INSTALL: { objective: 'OUTCOME_APP_PROMOTION', pixelEvent: null, countsWithoutPixel: false, defaultResult: 'INSTALLS', legacy: 'APP' },
  OTHER: { objective: 'OUTCOME_TRAFFIC', pixelEvent: null, countsWithoutPixel: false, defaultResult: 'RESULTS', legacy: null },
};

/** Valores antigos migram (mesma regra do backfill da migração 20261028000100_result_type). */
export const RESULT_FROM_LEGACY: Record<BusinessType, ResultType> = { ONLINE_STORE: 'PURCHASE', LOCAL_BUSINESS: 'LEAD', APP: 'APP_INSTALL' };

export function legacyBusinessTypeOf(t: ResultType | null): BusinessType | null {
  return t ? RESULT_PROFILE[t].legacy : null;
}
export function defaultResultOf(t: ResultType | null): DefaultResult | null {
  return t ? RESULT_PROFILE[t].defaultResult : null;
}

/** Evento padrão de cada objetivo quando o usuário troca o objetivo na publicação (ou publicação antiga sem pixelEvent). */
const OBJECTIVE_EVENT: Partial<Record<MetaObjective, MetaPixelEvent>> = { OUTCOME_SALES: 'PURCHASE', OUTCOME_LEADS: 'LEAD' };

/** Evento do pixel pra este objetivo: o do resultType quando o objetivo é o dele; senão o padrão do objetivo. */
export function pixelEventFor(objective: MetaObjective, t: ResultType | null): MetaPixelEvent | null {
  const p = t ? RESULT_PROFILE[t] : null;
  if (p && p.objective === objective && p.pixelEvent) return p.pixelEvent;
  return OBJECTIVE_EVENT[objective] ?? null;
}

/**
 * Corpo do PATCH/POST → colunas. `resultType` manda; sem ele, `businessType` antigo migra. Devolve undefined quando o corpo
 * não fala de resultado. Trocar pra um tipo ≠ OTHER limpa o texto livre.
 */
export function resultPatchOf(dto: { resultType?: ResultType | null; resultTypeOther?: string | null; businessType?: BusinessType | null }):
  { resultType?: ResultType | null; resultTypeOther?: string | null } {
  const out: { resultType?: ResultType | null; resultTypeOther?: string | null } = {};
  if (dto.resultType !== undefined) out.resultType = dto.resultType;
  else if (dto.businessType !== undefined) out.resultType = dto.businessType ? RESULT_FROM_LEGACY[dto.businessType] : null;
  if (dto.resultTypeOther !== undefined) out.resultTypeOther = dto.resultTypeOther?.trim() || null;
  if (out.resultType !== undefined && out.resultType !== 'OTHER') out.resultTypeOther = null;
  return out;
}

/** Estado final válido: OTHER exige texto. Devolve a mensagem do 400 ou null. */
export function resultStateError(t: ResultType | null, other: string | null): string | null {
  if (t === 'OTHER' && !other?.trim()) return 'resultTypeOther is required when resultType is OTHER';
  if (other && other.length > RESULT_OTHER_MAX) return `resultTypeOther must be at most ${RESULT_OTHER_MAX} characters`;
  return null;
}
