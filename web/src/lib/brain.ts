import type { BrainCompleteness, BrainItem, BrainSection, Offer, Workspace } from "@/lib/api/types"

/**
 * Brain v0 completeness (fase2-agencia §5, D5). ONE function for Home, Brain and the onboarding step 6, so the
 * number is always the same. 13 items, equal weight; "Soon" items never count.
 * Workspace: businessType, industry, market · offers: ≥ 1 active offer, then each brief field filled in ANY active
 * offer (non-empty text) · goals: monthlySpendCapUsd set.
 */
export const BRAIN_ITEMS: readonly BrainItem[] = [
  "businessType", "industry", "market", "offer", "what", "promise", "offerAndPrice", "cta", "audience", "pains", "proof", "notes", "spendCap",
]

export const BRAIN_SECTIONS: Record<BrainSection, readonly BrainItem[]> = {
  business_offer: ["businessType", "industry", "market", "offer", "what", "promise", "offerAndPrice", "cta"],
  audience: ["audience", "pains"],
  proof: ["proof"],
  custom_instructions: ["notes"],
  goals: ["spendCap"],
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0
type BriefItem = "what" | "promise" | "offerAndPrice" | "cta" | "audience" | "pains" | "proof" | "notes"

export function brainItemDone(item: BrainItem, ws: Pick<Workspace, "businessType" | "industry" | "market" | "monthlySpendCapUsd">, offers: Pick<Offer, BriefItem>[]): boolean {
  switch (item) {
    case "businessType":
      return ws.businessType != null
    case "industry":
      return filled(ws.industry)
    case "market":
      return filled(ws.market)
    case "offer":
      return offers.length > 0
    case "spendCap":
      return ws.monthlySpendCapUsd != null
    default:
      return offers.some((o) => filled(o[item]))
  }
}

export function brainCompleteness(ws: Pick<Workspace, "businessType" | "industry" | "market" | "monthlySpendCapUsd">, offers: Pick<Offer, BriefItem>[]): BrainCompleteness {
  const done = new Set(BRAIN_ITEMS.filter((i) => brainItemDone(i, ws, offers)))
  const sections = Object.fromEntries(
    (Object.entries(BRAIN_SECTIONS) as [BrainSection, readonly BrainItem[]][]).map(([k, items]) => {
      const n = items.filter((i) => done.has(i)).length
      return [k, n === items.length ? "ok" : n === 0 ? "empty" : "partial"]
    })
  ) as BrainCompleteness["sections"]
  return {
    percent: Math.round((done.size / BRAIN_ITEMS.length) * 100),
    missing: BRAIN_ITEMS.filter((i) => !done.has(i)),
    sections,
  }
}
