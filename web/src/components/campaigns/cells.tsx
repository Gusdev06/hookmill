"use client"

import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { Switch as SwitchPrimitive } from "radix-ui"
import type { MetaBudget, MetaMetrics, MetaPeriod } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/icon"
import { useMoney } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"
import { deltaOf, hmOf, isVideoAd, nodeId, statusInfo, statusOf, type MetricKey, type Node } from "./model"

/* The small pieces of the Campaigns table and cards (spec §2-§4): chips, status, budget, deltas, row menu. */

export type ChipTone = "win" | "neutral" | "dash" | "ok" | "warn" | "info" | "hm" | "bad"
const CHIP: Record<ChipTone, string> = {
  win: "bg-fg text-brand",
  neutral: "border border-line-soft bg-card-2 text-fg-2",
  dash: "border border-dashed border-control bg-transparent text-fg-3",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  info: "bg-info-bg text-info",
  bad: "bg-bad-bg text-bad",
  hm: "border border-brand-edge bg-brand-soft font-mono text-[10px] tracking-[0.04em] text-brand-ink",
}
export function Chip({ tone, children, title, className }: { tone: ChipTone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-fit items-center gap-[5px] rounded-full px-2 py-0.5 text-[11px] leading-[1.5] font-bold whitespace-nowrap", CHIP[tone], className)}>
      {children}
    </span>
  )
}
export function HmChip({ n }: { n: Node }) {
  const t = useTranslations("campaigns")
  return hmOf(n) ? <Chip tone="hm" title={t("hmTip")}>{t("hm")}</Chip> : null
}
export function LearnChip({ n }: { n: Node }) {
  const t = useTranslations("campaigns")
  if (n.level !== "adset") return null
  return n.row.learningStage === "LEARNING" ? <Chip tone="info">{t("learning")}</Chip> : n.row.learningStage === "FAIL" ? <Chip tone="warn">{t("learningLimited")}</Chip> : null
}
/** ad: verdict + trend (Steady only next to a winner) · campaign/ad set: "1 winner · 1 tiring" */
export function VerdictChips({ n, className }: { n: Node; className?: string }) {
  const t = useTranslations("campaigns")
  if (n.level === "ad") {
    const v = n.row.verdict
    const tr = n.row.trend
    return (
      <span className={cn("inline-flex flex-nowrap gap-1.5", className)}>
        {v === "WINNER" ? <Chip tone="win">{t("verdict.winner")}</Chip> : v === "LOW_DATA" ? <Chip tone="dash">{t("verdict.lowData")}</Chip> : <Chip tone="neutral">{t("verdict.ok")}</Chip>}
        {tr === "WORKING" ? <Chip tone="ok">{t("trend.working")}</Chip> : tr === "TIRING" ? <Chip tone="warn">{t("trend.tiring")}</Chip> : tr === "STEADY" && v === "WINNER" ? <Chip tone="neutral">{t("trend.steady")}</Chip> : null}
      </span>
    )
  }
  const w = n.row.counts.winners
  const tiring = n.level === "campaign" ? n.row.counts.tiring : 0
  if (!w && !tiring) return <span className="text-xs text-fg-3">—</span>
  return (
    <span className={cn("inline-flex flex-nowrap gap-1.5", className)}>
      {w ? <Chip tone="win">{t("verdict.winners", { count: w })}</Chip> : null}
      {tiring ? <Chip tone="warn">{t("verdict.tiring", { count: tiring })}</Chip> : null}
    </span>
  )
}

const DOT: Record<string, string> = { on: "text-ok-dot", off: "text-control", held: "text-warn-dot", bad: "text-bad" }
export function StatusText({ n, className }: { n: Node; className?: string }) {
  const t = useTranslations("campaigns.state")
  const s = statusInfo(n)
  const label = s.key === "campOff" || s.key === "setOff" ? t("notDelivering", { why: t(s.key) }) : t(s.key)
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs leading-[1.3] font-semibold text-fg-2", s.tone === "bad" && "text-bad", className)}>
      <i className={cn("size-[7px] flex-none rounded-full bg-current", DOT[s.tone])} aria-hidden="true" />
      {label}
    </span>
  )
}

/** spec §2.4: the switch reflects the configured status; clicking opens the dialog, it never flips by itself */
export function StatusSwitch({ n, disabledReason, onToggle, size = "sm" }: { n: Node; disabledReason: string | null; onToggle: () => void; size?: "sm" | "lg" }) {
  const t = useTranslations("campaigns")
  const on = statusOf(n) === "ACTIVE"
  const held = statusInfo(n).tone === "held" && on
  return (
    <SwitchPrimitive.Root
      checked={on}
      onCheckedChange={() => onToggle()}
      disabled={!!disabledReason}
      title={disabledReason ?? undefined}
      aria-label={on ? t("switchOff", { name: n.row.name }) : t("switchOn", { name: n.row.name })}
      className={cn(
        "relative inline-flex flex-none cursor-pointer items-center rounded-full bg-control p-0 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info disabled:cursor-not-allowed disabled:opacity-45",
        "data-[state=checked]:bg-ok-dot",
        held && "data-[state=checked]:bg-[#8fc9a9]",
        size === "sm" ? "h-5 w-9" : "h-[26px] w-11"
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-transform duration-150",
          size === "sm" ? "size-4 data-[state=checked]:translate-x-[18px]" : "size-[22px] data-[state=checked]:translate-x-5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

/** 7 d delta under the number (mono 11 px), colored by the good direction; nothing in 30 d */
export function Delta({ n, k, period }: { n: Node; k: MetricKey; period: MetaPeriod }) {
  const t = useTranslations("campaigns")
  if (period !== "7d") return null
  const d = deltaOf(n, k)
  if (!d) return null
  if (d === "none") return <span className="block font-mono text-[11px] text-fg-3">—</span>
  return (
    <span title={t("vs7")} className={cn("mt-px block font-mono text-[11px] font-medium", d.tone === "good" ? "text-ok" : d.tone === "bad" ? "text-bad" : "text-fg-3")}>
      {d.pct === 0 ? "→ 0%" : `${d.up ? "↑" : "↓"} ${d.pct}%`}
    </span>
  )
}

export function useFormat(currency: string | null | undefined) {
  const money = useMoney(currency)
  const format = useFormatter()
  return {
    money0: (v: number | null | undefined) => money(v, 0),
    money2: (v: number | null | undefined) => money(v, 2),
    minor: (v: number | null | undefined) => (v === null || v === undefined ? "—" : money(v / 100, 2)),
    pct: (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : format.number(v / 100, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d })),
  }
}
export const resultsText = (m: MetaMetrics) => (m.spend || m.results ? String(m.results || "—") : "—")

/** spec §2.5: the budget lives where it lives. CBO campaign / ABO ad set editable (pencil); the rest is gray text. */
export function BudgetCell({ n, canEdit, onEdit, currency, card }: { n: Node; canEdit: boolean; onEdit: () => void; currency: string | null; card?: boolean }) {
  const t = useTranslations("campaigns.budget")
  const f = useFormat(currency)
  if (n.level === "ad") return null
  const b: MetaBudget = n.row.budget
  const where = n.level === "campaign" ? t("cbo") : t("abo")
  if (n.level === "campaign" && (!n.row.isCbo || b.level === "adset")) return <span className="text-xs text-fg-3">{card ? t("perAdsetCard") : t("perAdset")}</span>
  if (n.level === "adset" && b.level === "campaign")
    return (
      <span className="text-xs text-fg-3" title={t("sharedTip")}>
        {t("shared")}
        {card ? " (CBO)" : null}
      </span>
    )
  if (b.amountMinor === null) return <span className="text-xs text-fg-3">—</span>
  const k = <span className="font-mono text-[11px] text-fg-3">{where}</span>
  if (b.kind === "lifetime")
    return (
      <span className="inline-flex max-w-[150px] flex-wrap items-center justify-end gap-x-1.5 whitespace-normal" title={t("lifetimeTip")}>
        {k}
        <span className="font-mono font-medium tabular-nums">{f.minor(b.amountMinor)}</span>
        <span className="text-xs text-fg-3">{t("lifetime")}</span>
        <Icon name="lock" className="size-3 text-fg-3" />
      </span>
    )
  const body = (
    <>
      {k}
      <span className="font-mono font-semibold tabular-nums">{f.minor(b.amountMinor)}</span>
      <span className="text-xs font-medium text-fg-3">{t("perDay")}</span>
    </>
  )
  return canEdit && b.editable ? (
    <button
      type="button"
      onClick={onEdit}
      aria-label={t("edit", { name: n.row.name, value: f.minor(b.amountMinor) })}
      className="inline-flex min-h-[30px] items-center gap-1.5 rounded-sm border border-transparent bg-transparent px-1.5 hover:border-line-strong hover:bg-card focus-visible:outline-2 focus-visible:outline-info"
    >
      {body}
      <Icon name="pencil" className="size-[13px] text-fg-3" />
    </button>
  ) : (
    <span className="inline-flex items-center justify-end gap-1.5">{body}</span>
  )
}

export function AdThumbSmall({ n, big }: { n: Node; big?: boolean }) {
  if (n.level !== "ad") return null
  const img = !n.row.videoId
  const cls = cn("flex-none rounded-[4px] bg-[#1e2550] object-cover", img ? "aspect-square" : "aspect-[9/16]", big ? (img ? "w-12" : "w-10") : img ? "w-7" : "w-[22px]")
  return n.row.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail, expires
    <img src={n.row.thumbnailUrl} alt="" loading="lazy" decoding="async" className={cls} />
  ) : (
    <span aria-hidden="true" className={cls} />
  )
}

/** ⋯ menu (spec §2.9): Iterate this ad · Open the HookMill creative · History of this item · Open in Ads Manager */
export function RowMenu({ n, canIterate, onHistory, outline }: { n: Node; canIterate: boolean; onHistory: () => void; outline?: boolean }) {
  const t = useTranslations("campaigns")
  const creative = n.level === "ad" ? n.row.creative : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: outline ? "outline" : "ghost", size: "icon-sm" }))} aria-label={t("more", { name: n.row.name })}>
        <Icon name="dots" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {n.level === "ad" && isVideoAd(n) && canIterate ? (
          <DropdownMenuItem asChild>
            <Link href={`/iterate/new?metaAdId=${encodeURIComponent(nodeId(n))}`}>
              <Icon name="iter" />
              {t("iterateFull")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        {creative ? (
          <DropdownMenuItem asChild>
            <Link href={`/creatives/${encodeURIComponent(creative.id)}`}>
              <Icon name="film" />
              {t("openCreative")}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onHistory}>
          <Icon name="clock" />
          {t("histOf")}
        </DropdownMenuItem>
        {n.row.adsManagerUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={n.row.adsManagerUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="ext" />
                {t("openAM")}
              </a>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** the visible "Iterate" button of an ad row (lime on a Winner, outline otherwise; disabled on images) */
export function IterateButton({ n, full, className }: { n: Node; full?: boolean; className?: string }) {
  const t = useTranslations("campaigns")
  if (n.level !== "ad") return null
  const label = full ? t("iterateFull") : t("iterate")
  if (!isVideoAd(n))
    return full ? (
      <span className={cn("text-xs text-fg-3", className)}>{t("imageOnly")}</span>
    ) : (
      <span title={t("imageOnly")} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-auto h-[30px] cursor-not-allowed rounded-[9px] px-2.5 text-xs opacity-45", className)} aria-disabled="true">
        <Icon name="iter" className="size-[13px]" />
        {label}
      </span>
    )
  return (
    <Link
      href={`/iterate/new?metaAdId=${encodeURIComponent(nodeId(n))}`}
      className={cn(buttonVariants({ variant: n.row.verdict === "WINNER" ? "brand" : "outline", size: "sm" }), !full && "h-[30px] rounded-[9px] px-2.5 text-xs", className)}
    >
      <Icon name="iter" className={full ? undefined : "size-[13px]"} />
      {label}
    </Link>
  )
}
