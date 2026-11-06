"use client"

import { useState } from "react"
import { useNow, useTranslations } from "next-intl"
import type { Competitor, DismissReason } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { NavIcon } from "@/components/shell/nav-icon"
import { AdjacentPill, PageAvatar, RPill, Spinner, useAgo, useCountryIn } from "./parts"

/*
 * mockup .strip: "All competitors" + one chip per competitor (single choice), scrolls sideways inside itself on the phone.
 * Chip: avatar, name, "38 active" (≥ N while importing, C.3) · syncing = Border Beam + "Syncing…" (the actor gives no
 * progress, C.1) · failed = red "didn't answer". No "+ Add competitor" (G2: the client doesn't add); the "…" menu at the
 * end has "Removed (n)" and "Search again" (C.1).
 */
const running = (c: Competitor) => c.sync?.status === "QUEUED" || c.sync?.status === "RUNNING"

export function CompetitorBar({
  competitors, selected, onSelect, removedCount, onRemoved, again,
}: {
  competitors: Competitor[]
  selected: string | null
  onSelect: (id: string | null) => void
  removedCount: number
  onRemoved: () => void
  again: { label: string; disabled: boolean; pending: boolean; note: string | null; onClick: () => void } | null
}) {
  const t = useTranslations("radar.bar")
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div role="group" aria-label={t("aria")} className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
        <Chip pressed={selected === null} onClick={() => onSelect(null)}>
          <span className="pl-1.5">{t("all")}</span>
        </Chip>
        {competitors.map((c) => (
          <CompetitorChip key={c.id} c={c} pressed={selected === c.id} onClick={() => onSelect(selected === c.id ? null : c.id)} />
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={t("more")} className="flex-none rounded-full">
            <NavIcon name="dots" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem onSelect={onRemoved} className="min-h-10">
            {t("removed", { n: removedCount })}
          </DropdownMenuItem>
          {again ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={again.onClick} disabled={again.disabled || again.pending} className="min-h-10">
                {again.pending ? <Spinner className="size-3.5" /> : <NavIcon name="refresh" size={16} />}
                {again.label}
              </DropdownMenuItem>
              {again.note ? <DropdownMenuLabel className="text-xs font-normal text-fg-3">{again.note}</DropdownMenuLabel> : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Chip({ pressed, onClick, children, className }: { pressed: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "relative flex min-h-10 flex-none cursor-pointer items-center gap-2 rounded-full border border-line bg-card py-1.5 pr-3 pl-1.5 text-[13px] whitespace-nowrap text-fg aria-pressed:border-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--fg)]",
        className
      )}
    >
      {children}
    </button>
  )
}

export function CompetitorChip({ c, pressed, onClick }: { c: Competitor; pressed: boolean; onClick: () => void }) {
  const t = useTranslations("radar.bar")
  const failed = c.sync?.status === "FAILED"
  const syncing = running(c)
  const sub = failed ? t("failed") : syncing ? t("syncing") : c.activeIsLowerBound ? t("atLeast", { n: c.counts.active }) : t("active", { n: c.counts.active })
  return (
    <Chip pressed={pressed} onClick={onClick} className={cn(syncing && "beam")}>
      <PageAvatar name={c.name} url={c.source.avatar?.url} size="sm" />
      <span>{c.name}</span>
      <small className={cn("font-mono text-[11px] tabular-nums", failed ? "text-status-failed" : "text-fg-3")}>{sub}</small>
    </Chip>
  )
}

/** The selected competitor: why this one (the judge's line), counts, last check, Refresh / Remove / Ad Library. */
export function CompetitorPanel({
  c, readOnly, canRefresh, onRemove, onRefresh, refreshing,
}: { c: Competitor; readOnly: boolean; canRefresh: boolean; onRemove: () => void; onRefresh: () => void; refreshing: boolean }) {
  const t = useTranslations("radar.comp")
  const tp = useTranslations("radar.picked")
  const tb = useTranslations("radar.bar")
  const countryIn = useCountryIn()
  const rel = useAgo()
  const now = useNow({ updateInterval: 60_000 })
  const syncing = running(c)
  const wait = !!c.refreshAvailableAt && new Date(c.refreshAvailableAt) > now
  return (
    <section className="grid gap-2.5 rounded-[16px] border border-line bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <PageAvatar name={c.name} url={c.source.avatar?.url} />
        <div className="grid min-w-0 flex-[1_1_240px] gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="m-0 text-base font-bold">{c.name}</h2>
            {c.relation === "ADJACENT" ? <AdjacentPill /> : null}
          </div>
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-fg-3 tabular-nums">
            <span>{t("country", { country: countryIn(c.source.countryCode) })}</span>
            <span>·</span>
            <span>{c.activeIsLowerBound ? tb("atLeast", { n: c.counts.active }) : tb("active", { n: c.counts.active })}</span>
            <span>·</span>
            <span>{t("winners", { n: c.counts.winners })}</span>
            {c.lastValidSyncAt ? (
              <>
                <span>·</span>
                <span>{t("lastSync", { ago: rel(c.lastValidSyncAt) })}</span>
              </>
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {readOnly || !canRefresh ? null : (
            <Button size="sm" variant="outline" disabled={syncing || refreshing || wait} onClick={onRefresh} aria-busy={syncing || refreshing} title={wait ? t("refreshAt", { when: rel(c.refreshAvailableAt) }) : undefined}>
              {syncing || refreshing ? <Spinner /> : <NavIcon name="refresh" size={16} />}
              {syncing ? tb("syncing") : t("refresh")}
            </Button>
          )}
          <a href={c.source.adLibraryUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-md px-3 text-[13px] font-semibold text-info underline underline-offset-2 tablet:h-9">
            {t("openLib")}
          </a>
          {readOnly ? null : (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              {t("remove")}
            </Button>
          )}
        </div>
      </div>
      {c.reason ? (
        <p className="m-0 text-[13px] text-fg-2">
          <span className="text-fg-3">{tp("why")}: </span>
          {c.reason}
        </p>
      ) : null}
      {c.activeIsLowerBound ? <span className="text-xs text-fg-3">{t("importing")}</span> : null}
      {wait && !readOnly ? <span className="text-xs text-fg-3">{t("refreshAt", { when: rel(c.refreshAvailableAt) })}</span> : null}
      {c.autoSyncPausedByCap ? <RPill tone="warn" className="w-fit whitespace-normal">{t("capPaused")}</RPill> : null}
    </section>
  )
}

const REASONS: DismissReason[] = ["not_competitor", "not_relevant", "own_brand", "other"]

/** Remove with a reason (§2.5): the spot goes to the reserve right away; removed never come back in a search. */
export function DismissDialog({
  c, reserve, pending, onCancel, onConfirm,
}: { c: Competitor | null; reserve: number; pending: boolean; onCancel: () => void; onConfirm: (reason: DismissReason) => void }) {
  const t = useTranslations("radar.dismiss")
  const [reason, setReason] = useState<DismissReason>("not_competitor")
  return (
    <AlertDialog open={!!c} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{c ? t("title", { name: c.name }) : ""}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("body")} {reserve > 0 ? t("reserveYes") : t("reserveNo")} {t("savedStay")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <span className="text-[13px] text-fg-3">{t("reasonLabel")}</span>
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as DismissReason)} className="gap-1">
            {REASONS.map((r) => (
              <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm hover:bg-card-2">
                <RadioGroupItem value={r} />
                {t(`reason.${r}`)}
              </label>
            ))}
          </RadioGroup>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} aria-busy={pending} onClick={() => onConfirm(reason)}>
            {pending ? <Spinner className="border-status-failed" /> : null}
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
