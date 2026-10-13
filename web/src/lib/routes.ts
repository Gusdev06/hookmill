import type { CreativeRow } from "@/lib/api/types"

/** A creative opens the wizard on its current step (spec §5 Home); approved ones open in the Library. */
export function creativeHref(c: Pick<CreativeRow, "id" | "step">) {
  return c.step === "library" ? `/library?new=${encodeURIComponent(c.id)}` : `/creatives/${encodeURIComponent(c.id)}/${c.step}`
}

/** Variar campeão (feature 2). The 6 steps; batch-scoped steps carry ?batch=<id>. */
export type VariarStep = "winner" | "teardown" | "variations" | "hooks" | "estimate" | "batch"
export const VARIAR_STEPS: readonly VariarStep[] = ["winner", "teardown", "variations", "hooks", "estimate", "batch"]
export function variarHref(championId: string | null, step: VariarStep, batchId?: string | null) {
  if (!championId) return "/variations/new"
  const base = `/variations/${encodeURIComponent(championId)}/${step}`
  return batchId ? `${base}?batch=${encodeURIComponent(batchId)}` : base
}

/** Variação automática (variacao-auto-v1): /iterate/new, then one route per batch; `view` only to look at a step the phase already passed. */
export type IterateView = "analyze" | "generate" | "download"
export function iterateHref(batchId: string | null, view?: IterateView | null) {
  if (!batchId) return "/iterate/new"
  const base = `/iterate/${encodeURIComponent(batchId)}`
  return view ? `${base}?view=${view}` : base
}
