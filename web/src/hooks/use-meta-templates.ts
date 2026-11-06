"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaBudgetTooLowDetails, MetaConnection, MetaPublishTemplate, MetaTemplateBody, UpdateMetaTemplateBody } from "@/lib/api/types"
import { isMetaOff } from "./use-meta"
import { useMinorMoney } from "./use-meta-publish"
import { GOALS } from "@/components/meta/templates/editor-model"

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

type Summarized = Pick<MetaTemplateBody, "campaign" | "adset" | "ad">

/** Short labels of a template's three levels (rail summaries + the list line), v1 and v2 (contract v2 §8). */
export function useTemplateSummary(currency: string | null | undefined) {
  const t = useTranslations("metaTemplates.summary")
  const te = useTranslations("metaTemplates.editor")
  const tf = useTranslations("publish.form")
  const money = useMinorMoney(currency)
  const ev = useTranslations("metaTemplates.event")
  const locale = useLocale()
  const day = (local: string) => {
    // "YYYY-MM-DDTHH:mm" in the ad account's zone: shown as-is (month + day), no zone conversion
    const [y, m, dd] = local.slice(0, 10).split("-").map(Number)
    if (!y || !m || !dd) return local
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, dd))
  }
  /** "Awareness", "CBO $300.00 total" (or "/day", "/ad set") and whether the campaign is new each batch */
  const campaignOf = (b: Summarized) => {
    const c = b.campaign
    const lifetime = c.budgetType === "LIFETIME"
    const minor = lifetime ? c.lifetimeBudgetMinor : c.dailyBudgetMinor
    const amount = minor ? money(minor) : "—"
    const budget = lifetime
      ? c.budgetMode === "CBO" ? te("sum.total", { amount }) : t("perAdset", { amount: te("sum.total", { amount }) })
      : c.budgetMode === "CBO" ? t("perDay", { amount }) : t("perAdset", { amount })
    // Lifetime + CBO always publishes into a new campaign (§2.2)
    const fresh = c.destination !== "REUSE_CAMPAIGN" || (lifetime && c.budgetMode === "CBO")
    return { destination: fresh ? t("newEach") : t("reuse", { name: c.namePattern }), objective: tf(`objective.${c.objective}`), budget: `${c.budgetMode} ${budget}` }
  }
  /** goal, schedule, geo/age, languages, audiences, audience/placements, ads per set */
  const adsetOf = (b: Summarized) => {
    const a = b.adset
    const goals = GOALS[b.campaign.objective]
    const goal = goals ? te(`goal.${a.optimizationGoal ?? goals[0]}`) : a.pixelEvent ? ev(a.pixelEvent) : t("clicks")
    const s = a.schedule ?? null
    const end = s?.end ?? null
    let schedule: string | null = null
    if (end?.kind === "AFTER_DAYS") schedule = te("sum.days", { n: end.days })
    else if (end?.kind === "AT") {
      const mins = s?.start ? (Date.parse(`${end.at}:00Z`) - Date.parse(`${s.start}:00Z`)) / 60_000 : NaN
      schedule = mins > 0 ? te("sum.days", { n: Math.ceil(mins / 1440) }) : t("until", { date: day(end.at) })
    }
    if (s?.start) schedule = [t("from", { date: day(s.start) }), schedule].filter(Boolean).join(" ")
    const langs = (a.locales ?? []).map((l) => l.name.slice(0, 2).toUpperCase()).filter((x, i, all) => all.indexOf(x) === i)
    const inc = a.customAudiences?.length ?? 0
    const exc = a.excludedCustomAudiences?.length ?? 0
    return [
      goal,
      schedule,
      `${a.countries.join(", ") || "—"} ${a.ageMin}–${a.ageMax}`,
      langs.length ? langs.slice(0, 3).join(" ") + (langs.length > 3 ? ` +${langs.length - 3}` : "") : null,
      inc || exc ? te("sum.audiences", { list: [inc ? `+${inc}` : null, exc ? `−${exc}` : null].filter(Boolean).join(" ") }) : null,
      a.advantageAudience ? t("advantage") : null,
      a.placements === "AUTO" ? t("autoPlacements") : t("manualPlacements", { n: a.placements.positions.length || a.placements.platforms.length }),
      t("adsRange", { min: a.adsPerAdset.min, max: a.adsPerAdset.max }),
    ].filter((x): x is string => !!x)
  }
  const levels = (b: Summarized) => {
    const c = campaignOf(b)
    const a = b.adset
    const campaign = `${c.objective} · ${c.budget}`
    const adset = `${t("adsRange", { min: a.adsPerAdset.min, max: a.adsPerAdset.max })} · ${a.countries.join(", ") || "—"} ${a.ageMin}–${a.ageMax}`
    const ad = [tf(`ctaLabel.${b.ad.callToAction}`), b.ad.urlTags ? t("utmOn") : null].filter(Boolean).join(" · ")
    return { campaign, adset, ad }
  }
  /** one line for the Settings list and the batch dialog: "New campaign each batch · Awareness · CBO $300.00 total · Maximize reach · 7 days · US 18–65 · EN · … · @account" */
  const line = (b: Summarized) => {
    const c = campaignOf(b)
    const ig = b.ad.instagramAccount ? `@${b.ad.instagramAccount.username}` : null
    return [c.destination, c.objective, c.budget, ...adsetOf(b), ig].filter(Boolean).join(" · ")
  }
  return { levels, line, campaignOf, adsetOf }
}

/** 422 META_BUDGET_TOO_LOW → the right sentence: daily minimum, or the lifetime total for N days (contract v2 §5.2). */
export function useBudgetTooLowText(currency: string | null | undefined) {
  const t = useTranslations("metaTemplates.window.err")
  const money = useMinorMoney(currency)
  return (details: unknown) => {
    const d = (details ?? {}) as Partial<MetaBudgetTooLowDetails>
    const min = d.minimumMinor ?? null
    if (d.budgetType === "LIFETIME" && d.days) return t("lifetimeBelow", { min: money(min), days: d.days })
    return t("budgetBelow", { min: money(min) })
  }
}

export type TemplateLike = MetaPublishTemplate | MetaTemplateBody
