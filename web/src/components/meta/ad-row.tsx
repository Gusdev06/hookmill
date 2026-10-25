"use client"

import { useTranslations } from "next-intl"
import type { MetaAdRow, MetaAdTrend } from "@/lib/api/types"
import { useMoney } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"

/*
 * AdRow (spec §4, mockup .ad): thumbnail · name + "Video · running N days" · Spend / CPA / ROAS · trend chip · action.
 * The winner (verdict WINNER) sits on lime-soft with the lime action. ≤760 px: thumb + name, the 3 numbers in a row
 * below, the action full width. `trend` null = "—" (not enough data, meta-v1 §5.2).
 */
export function TrendTag({ trend, className }: { trend: MetaAdTrend | null; className?: string }) {
  const t = useTranslations("home.tag")
  const cls = trend === "WORKING" ? "bg-status-approved-bg text-status-approved" : trend === "TIRING" ? "bg-status-waiting-bg text-status-waiting" : "border border-line-soft bg-card-2 text-fg-2"
  return <span className={cn("inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap uppercase", cls, className)}>{trend ? t(trend.toLowerCase() as "working" | "steady" | "tiring") : "—"}</span>
}

export function AdThumb({ ad, className }: { ad: Pick<MetaAdRow, "thumbnailUrl" | "name">; className?: string }) {
  return ad.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail, expires
    <img src={ad.thumbnailUrl} alt="" loading="lazy" decoding="async" className={cn("aspect-[9/16] w-10 flex-none rounded-[6px] object-cover", className)} />
  ) : (
    <span aria-hidden="true" className={cn("aspect-[9/16] w-10 flex-none rounded-[6px] bg-[#1e2550]", className)} />
  )
}

export function AdRow({
  ad, currency, action, selected, stats = "spend", winner, className,
}: {
  ad: MetaAdRow
  currency: string | null | undefined
  action: React.ReactNode
  selected?: boolean
  /** lime-soft row; default = the ad's verdict is WINNER (Home marks only the first one) */
  winner?: boolean
  /** "spend" = Spend · CPA · ROAS (Home) · "account" = CPA · account median · ROAS (Pick a winner) */
  stats?: "spend" | "account"
  className?: string
}) {
  const t = useTranslations("home")
  const money = useMoney(currency)
  const win = winner ?? ad.verdict === "WINNER"
  const m = ad.metrics
  const cells: [string, string][] =
    stats === "spend"
      ? [[t("spend"), money(m.spend, 0)], [t("cpa"), money(m.cpa)], [t("roas"), m.roas === null ? "—" : `${m.roas.toFixed(1)}x`]]
      : [[t("cpa"), money(m.cpa)], [t("roas"), m.roas === null ? "—" : `${m.roas.toFixed(1)}x`], [t("spend"), money(m.spend, 0)]]
  return (
    <div
      className={cn(
        "grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-md border bg-card px-3 py-2.5 tablet:grid-cols-[40px_minmax(0,1fr)_repeat(3,76px)_auto]",
        win ? "border-brand-edge bg-brand-soft" : "border-line",
        selected && "shadow-[0_0_0_1.5px_var(--fg)]",
        className
      )}
    >
      <AdThumb ad={ad} />
      <span className="flex min-w-0 flex-col">
        <b className="truncate">{ad.name}</b>
        <small className="text-xs text-fg-3">{ad.daysRunning === null ? t("video") : t("videoRunning", { days: ad.daysRunning })}</small>
      </span>
      <span className="col-span-2 flex flex-wrap gap-3.5 tablet:contents">
        {cells.map(([k, v]) => (
          <span key={k} className="flex min-w-0 items-baseline gap-1.5 tablet:flex-col tablet:gap-0">
            <small className="text-[11px] text-fg-3">{k}</small>
            <span className="font-mono font-semibold tabular-nums">{v}</span>
          </span>
        ))}
      </span>
      <span className="col-span-2 flex items-center justify-end gap-2 tablet:col-span-1 [&>a]:flex-1 [&>button]:flex-1 tablet:[&>a]:flex-none tablet:[&>button]:flex-none">
        <TrendTag trend={ad.trend} />
        {action}
      </span>
    </div>
  )
}
