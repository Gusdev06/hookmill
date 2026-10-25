"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { api } from "@/lib/api/client"
import type { MetaChangeRow, MetaLevel } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { mk } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"
import { Chip, useFormat } from "./cells"

/*
 * History (spec §2.13): drawer on the right (460 px), bottom sheet of 88 % on the phone. Opens for one object (row menu)
 * or the whole account (header button), with "This item / Whole account". GET /meta/changes with a cursor + "Load more".
 */
export type HistoryScope = { level: MetaLevel; id: string; name: string } | "all"

export function HistorySheet({ scope, account, currency, onScope, onClose }: { scope: HistoryScope | null; account: string; currency: string | null; onScope: (s: HistoryScope) => void; onClose: () => void }) {
  const t = useTranslations("campaigns")
  const obj = scope && scope !== "all" ? scope : null
  return (
    <DialogPrimitive.Root open={!!scope} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-0 right-0 bottom-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line bg-card shadow-[-20px_0_50px_rgba(21,23,26,.18)] outline-none",
            "pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in-0",
            "max-tablet:top-auto max-tablet:h-[88dvh] max-tablet:w-full max-tablet:rounded-t-[20px] max-tablet:border-t max-tablet:border-l-0 max-tablet:data-[state=open]:slide-in-from-bottom-6"
          )}
        >
          <div className="flex items-start gap-2.5 border-b border-line-soft px-[18px] pt-[18px] pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">{obj ? t(`level.${obj.level}`) : account}</span>
              <DialogPrimitive.Title className="m-0 text-lg font-bold text-balance">{obj ? t("hist.titleOf", { name: obj.name }) : t("hist.title")}</DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("hist.close")}>
                <Icon name="x" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-[18px] pt-3 pb-6">
            {obj ? (
              <ToggleGroup type="single" value="obj" onValueChange={(v) => v === "all" && onScope("all")} aria-label={t("hist.title")} className="self-start">
                <ToggleGroupItem value="obj">{t("hist.scopeObj")}</ToggleGroupItem>
                <ToggleGroupItem value="all">{t("hist.scopeAll")}</ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <span className="text-[13px] text-fg-3">{t("hist.note")}</span>
            {scope ? <HistoryList key={obj ? obj.id : "all"} obj={obj} currency={currency} /> : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

function HistoryList({ obj, currency }: { obj: { level: MetaLevel; id: string } | null; currency: string | null }) {
  const t = useTranslations("campaigns")
  const scope = obj ? { level: obj.level, objectId: obj.id } : {}
  const q = useInfiniteQuery({
    queryKey: mk.changes(scope),
    queryFn: ({ pageParam, signal }) => api.meta.changes({ ...scope, limit: 20, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
  })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="sk block h-14 rounded-md" />
        ))}
      </div>
    )
  if (q.isError)
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg bg-card-2 p-4">
        <b>{t("hist.loadFailed")}</b>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          <Icon name="refresh" />
          {t("retry")}
        </Button>
      </div>
    )
  const rows = q.data.pages.flatMap((p) => p.data)
  if (!rows.length)
    return (
      <div className="flex flex-col gap-1 rounded-lg bg-card-2 p-4">
        <b>{t("hist.emptyTitle")}</b>
        <span className="text-[13px] text-fg-3">{t("hist.emptyBody")}</span>
      </div>
    )
  return (
    <>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <ChangeItem key={r.id} r={r} currency={currency} />
        ))}
      </ul>
      {q.hasNextPage ? (
        <Button variant="outline" size="sm" className="self-start" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} aria-busy={q.isFetchingNextPage}>
          {t("hist.loadMore")}
        </Button>
      ) : null}
    </>
  )
}

function ChangeItem({ r, currency }: { r: MetaChangeRow; currency: string | null }) {
  const t = useTranslations("campaigns")
  const tErr = useTranslations("errors")
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const f = useFormat(currency)
  const val = (v: string | null) => (v === null ? "—" : r.field === "DAILY_BUDGET" ? f.minor(Number(v)) : v === "ACTIVE" ? t("state.on") : v === "PAUSED" ? t("state.off") : v)
  const verb = r.field === "STATUS" ? (r.to === "ACTIVE" ? t("hist.turnedOn") : t("hist.paused")) : t("hist.budget")
  const also = r.alsoChangedRefs?.length ? r.alsoChangedRefs.map((p) => p.name).join(", ") : r.alsoChanged.length ? r.alsoChanged.join(", ") : null
  const when = now.getTime() - Date.parse(r.at) < 7 * 864e5 ? format.relativeTime(new Date(r.at), now) : format.dateTime(new Date(r.at), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  // FAILED (Meta refused the write) and BLOCKED (HookMill stopped it before writing, e.g. META_POLICY) read the same:
  // "Failed" chip in the bad tone + the reason. History-specific wording first, then the generic error text, then the code.
  const failed = r.result !== "APPLIED"
  const histErr = `hist.err.${r.errorCode}`
  const failText = r.errorCode ? (t.has(histErr as never) ? t(histErr as never) : tErr.has(r.errorCode as never) ? tErr(r.errorCode as never) : r.errorCode) : null
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-2.5 border-t border-line-soft py-3 first:border-t-0">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full border border-line bg-card-2 text-xs font-bold">
        {r.by.initials || r.by.name.charAt(0)}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] text-pretty">
          <b>{r.by.name}</b> {verb} {t(`level.${r.level}`)} <b>{r.objectName}</b>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <s className="text-fg-3">{val(r.from)}</s>
          <Icon name="chev" className="size-3" />
          <span>{val(r.to)}</span>
          {also ? <Chip tone="neutral">{t("hist.also", { names: also })}</Chip> : null}
        </span>
        {failed && failText ? (
          <span className="flex items-start gap-1.5 text-[13px] text-bad">
            <Icon name="alert" className="mt-0.5 size-3.5" />
            {failText}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <Chip tone={failed ? "bad" : "ok"}>{failed ? t("hist.failed") : t("hist.applied")}</Chip>
          <span>{when}</span>
          <span aria-hidden="true">·</span>
          <span>{r.source === "PUBLISH" ? t("hist.fromSend") : t("hist.fromCampaigns")}</span>
        </span>
      </div>
    </li>
  )
}
