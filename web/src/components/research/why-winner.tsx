"use client"

import { useTranslations } from "next-intl"
import type { ResearchAdCard } from "@/lib/api/types"

/** mockup .why (lime-soft box): why the proxy calls it a likely winner (C.6: active and ≥ winnerDays days OR ≥ winnerVersions versions). */
export function WhyWinner({ ad, winnerDays, winnerVersions }: { ad: Pick<ResearchAdCard, "tier" | "daysRunning" | "collationCount">; winnerDays: number; winnerVersions: number }) {
  const t = useTranslations("radar.why")
  if (ad.tier !== "winner") return null
  const days = ad.daysRunning ?? 0
  const versions = ad.collationCount ?? 0
  const byDays = days >= winnerDays
  const byVersions = versions >= winnerVersions
  const body = byDays && versions > 1 ? t("both", { days, versions }) : byDays ? t("days", { days }) : byVersions ? t("versions", { versions }) : t("days", { days })
  return (
    <div className="grid gap-[3px] rounded-md border border-brand-edge bg-brand-soft px-3 py-2.5 text-[12.5px] text-brand-ink">
      <b className="text-fg">{t("title")}</b>
      <span>{body}</span>
    </div>
  )
}
