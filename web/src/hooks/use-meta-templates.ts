"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaConnection, MetaPublishTemplate, MetaTemplateBody, UpdateMetaTemplateBody } from "@/lib/api/types"
import { isMetaOff } from "./use-meta"
import { useMinorMoney } from "./use-meta-publish"

/*
 * Publish templates (meta-templates-v1). One list per selected ad account (GET /meta/templates, default first); the
 * writes replace the list in the cache. The batch plan is computed here too, the same way the API groups (ad sets of up
 * to `max`, the last one flagged when it's under `min`).
 */
export const tk = { list: ["meta", "templates"] as const }

export function useMetaTemplates(enabled = true) {
  return useQuery({
    queryKey: tk.list,
    queryFn: ({ signal }) => api.meta.templates.list({ signal }),
    enabled,
    staleTime: 30_000,
    retry: (n, e) => n < 1 && !isMetaOff(e) && !(isApiError(e) && e.status < 500),
  })
}

export function useTemplateActions() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: tk.list })
  const create = useMutation({ mutationFn: (b: MetaTemplateBody) => api.meta.templates.create(b), onSuccess: refresh })
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdateMetaTemplateBody }) => api.meta.templates.update(id, body), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: string) => api.meta.templates.remove(id), onSuccess: refresh })
  return { create, update, remove }
}

/** Factory values of a new template (P1 REUSE, Tordan's CBO 4–8). The budget is NOT here: P2 asks for it, no hidden value. */
export const DEFAULT_PATTERNS = { campaign: "HookMill — {offer}", adset: "{offer} — {date} — {n}", ad: "{code}" }

export function blankTemplate(conn: MetaConnection | null | undefined): Omit<MetaTemplateBody, "campaign"> & { campaign: Omit<MetaTemplateBody["campaign"], "dailyBudgetMinor"> & { dailyBudgetMinor: number | null } } {
  const pixel = conn?.pixel ?? null
  return {
    name: "",
    isDefault: false,
    campaign: {
      destination: "REUSE_CAMPAIGN", objective: pixel ? "OUTCOME_SALES" : "OUTCOME_TRAFFIC", budgetMode: "CBO", dailyBudgetMinor: null,
      bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: DEFAULT_PATTERNS.campaign,
    },
    adset: {
      pixelId: pixel?.id ?? null, pixelEvent: pixel ? "PURCHASE" : null, countries: [], ageMin: 18, ageMax: 65, genders: "ALL",
      advantageAudience: true, placements: "AUTO", adsPerAdset: { min: 4, max: 8 }, namePattern: DEFAULT_PATTERNS.adset,
    },
    ad: { primaryText: null, headline: null, description: null, callToAction: "SHOP_NOW", link: "", urlTags: null, namePattern: DEFAULT_PATTERNS.ad },
  }
}

/** Ad sets of up to `max` ads, in order; the last one keeps the rest and is `short` when it has fewer than `min`. */
export function planAdsets(n: number, per: { min: number; max: number }): { size: number; short: boolean }[] {
  const max = Math.max(1, Math.floor(per.max) || 1)
  const out: { size: number; short: boolean }[] = []
  for (let left = n; left > 0; left -= max) {
    const size = Math.min(max, left)
    out.push({ size, short: size < per.min })
  }
  return out
}

/** Short labels of a template's three levels (rail summaries + the list line). */
export function useTemplateSummary(currency: string | null | undefined) {
  const t = useTranslations("metaTemplates.summary")
  const tf = useTranslations("publish.form")
  const money = useMinorMoney(currency)
  const ev = useTranslations("metaTemplates.event")
  const levels = (b: Pick<MetaTemplateBody, "campaign" | "adset" | "ad">) => {
    const c = b.campaign
    const a = b.adset
    const budget = c.dailyBudgetMinor ? money(c.dailyBudgetMinor) : "—"
    const campaign = `${c.budgetMode} · ${c.budgetMode === "CBO" ? t("perDay", { amount: budget }) : t("perAdset", { amount: budget })}`
    const adset = `${t("adsRange", { min: a.adsPerAdset.min, max: a.adsPerAdset.max })} · ${a.countries.join(", ") || "—"} ${a.ageMin}–${a.ageMax}`
    const ad = [tf(`ctaLabel.${b.ad.callToAction}`), b.ad.urlTags ? t("utmOn") : null].filter(Boolean).join(" · ")
    return { campaign, adset, ad }
  }
  const line = (b: Pick<MetaTemplateBody, "campaign" | "adset" | "ad">) => {
    const c = b.campaign
    const a = b.adset
    const budget = c.dailyBudgetMinor ? money(c.dailyBudgetMinor) : "—"
    return [
      c.destination === "REUSE_CAMPAIGN" ? t("reuse", { name: c.namePattern }) : t("newEach"),
      `${c.budgetMode} ${c.budgetMode === "CBO" ? t("perDay", { amount: budget }) : t("perAdset", { amount: budget })}`,
      a.pixelEvent ? ev(a.pixelEvent) : t("clicks"),
      `${a.countries.join(", ") || "—"}, ${a.ageMin}–${a.ageMax}`,
      a.advantageAudience ? t("advantage") : null,
      a.placements === "AUTO" ? t("autoPlacements") : t("manualPlacements", { n: a.placements.positions.length || a.placements.platforms.length }),
      t("adsRange", { min: a.adsPerAdset.min, max: a.adsPerAdset.max }),
    ].filter(Boolean).join(" · ")
  }
  return { levels, line }
}

export type TemplateLike = MetaPublishTemplate | MetaTemplateBody
