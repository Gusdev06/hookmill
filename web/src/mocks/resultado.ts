// MSW mirror of api/src/workspaces/resultado.ts (resultado-v1, 28/10): ResultType is the source of truth;
// businessType/defaultResult are derived; legacy businessType in a PATCH migrates.
import type { BusinessType, DefaultResult, ResultType } from "@/lib/api/types"

const PROFILE: Record<ResultType, { legacy: BusinessType | null; result: DefaultResult }> = {
  PURCHASE: { legacy: "ONLINE_STORE", result: "PURCHASES" },
  SUBSCRIPTION: { legacy: "ONLINE_STORE", result: "SUBSCRIPTIONS" },
  LEAD: { legacy: "LOCAL_BUSINESS", result: "LEADS" },
  APPOINTMENT: { legacy: "LOCAL_BUSINESS", result: "APPOINTMENTS" },
  SIGNUP: { legacy: "LOCAL_BUSINESS", result: "SIGNUPS" },
  MESSAGE: { legacy: "LOCAL_BUSINESS", result: "MESSAGES" },
  APP_INSTALL: { legacy: "APP", result: "INSTALLS" },
  OTHER: { legacy: null, result: "RESULTS" },
}
const FROM_LEGACY: Record<BusinessType, ResultType> = { ONLINE_STORE: "PURCHASE", LOCAL_BUSINESS: "LEAD", APP: "APP_INSTALL" }

export interface ResultFields {
  resultType: ResultType | null
  resultTypeOther: string | null
  businessType: BusinessType | null
  defaultResult: DefaultResult | null
}

export const resultFieldsOf = (t: ResultType | null, other: string | null = null): ResultFields => ({
  resultType: t,
  resultTypeOther: t === "OTHER" ? other : null,
  businessType: t ? PROFILE[t].legacy : null,
  defaultResult: t ? PROFILE[t].result : null,
})

/** PATCH body → the new result fields; undefined = body doesn't touch the result; string = 400 message. */
export function patchResult(cur: ResultFields, b: { resultType?: unknown; resultTypeOther?: unknown; businessType?: unknown }): ResultFields | undefined | string {
  let t: ResultType | null | undefined
  if (b.resultType !== undefined) t = (b.resultType as ResultType | null) ?? null
  else if (b.businessType !== undefined) t = b.businessType ? FROM_LEGACY[b.businessType as BusinessType] : null
  if (t === undefined && b.resultTypeOther === undefined) return undefined
  const final = t === undefined ? cur.resultType : t
  const other = b.resultTypeOther !== undefined ? (String(b.resultTypeOther ?? "").trim() || null) : cur.resultTypeOther
  if (final === "OTHER" && !other) return "resultTypeOther is required when resultType is OTHER"
  return resultFieldsOf(final, other)
}
