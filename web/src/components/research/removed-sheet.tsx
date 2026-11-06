"use client"

import { useFormatter, useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import { toast } from "sonner"
import type { Competitor } from "@/lib/api/types"
import { isApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { Reveal } from "@/components/ui/reveal"
import { NavIcon } from "@/components/shell/nav-icon"
import { useCompetitors, useRestoreCompetitor } from "@/hooks/use-research"
import { useErrorMessage } from "@/hooks/use-error-message"
import { PageAvatar } from "./parts"

/*
 * "Removed (n)" inside the Ad Radar (C.1: where the person removed, not in Settings). Drawer on the right (460 px), bottom
 * sheet on the phone, like the Campaigns history. Undo = POST …/restore; with no free spot, 409 competitor_limit says why.
 */
const SAMPLE: Competitor[] = [0, 1].map((i) => ({
  id: `sample-${i}`, name: "Sample brand", status: "DISMISSED", origin: "DISCOVERED", relation: "DIRECT", nicheScore: null, reason: null,
  source: { pageId: "", countryCode: "US", displayName: "", avatar: null, likeCount: null, adLibraryUrl: "" }, domain: null,
  counts: { active: 0, winners: 0, new7d: 0, stopped30d: 0 }, activeIsLowerBound: false, sync: null, lastValidSyncAt: null, nextSyncAt: null,
  refreshAvailableAt: null, lastSyncSuspect: false, autoSyncPausedByCap: false, dismissedAt: "2026-11-01T12:00:00.000Z", dismissReason: "not_competitor", createdAt: "2026-11-01T12:00:00.000Z",
}))

export function RemovedSheet({ open, onClose, readOnly, max }: { open: boolean; onClose: () => void; readOnly: boolean; max: number }) {
  const t = useTranslations("radar.removed")
  const tc = useTranslations("radar.detail")
  const tl = useTranslations("skeleton")
  const errorMessage = useErrorMessage()
  const q = useCompetitors("dismissed", { enabled: open })
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-0 right-0 bottom-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line bg-card shadow-[-20px_0_50px_rgba(21,23,26,.18)] outline-none",
            "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-6",
            "max-tablet:top-auto max-tablet:h-[80dvh] max-tablet:w-full max-tablet:rounded-t-[20px] max-tablet:border-t max-tablet:border-l-0 max-tablet:data-[state=open]:slide-in-from-bottom-6"
          )}
        >
          <div className="flex items-start gap-2.5 border-b border-line-soft px-[18px] pt-[18px] pb-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <DialogPrimitive.Title className="m-0 text-lg font-bold">{t("title")}</DialogPrimitive.Title>
              <span className="text-[13px] text-fg-2">{t("body")}</span>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tc("close")}>
                <NavIcon name="x" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-auto px-[18px] pt-3 pb-6">
            <Reveal data={q.data?.items} sample={SAMPLE} id="radar.removed" label={tl("ads")} error={q.isError ? <span className="text-sm text-status-failed">{errorMessage(q.error)}</span> : undefined}>
              {(items) =>
                items.length ? (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {items.map((c) => (
                      <RemovedRow key={c.id} c={c} readOnly={readOnly} max={max} />
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-fg-2">{t("empty")}</p>
                )
              }
            </Reveal>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

function RemovedRow({ c, readOnly, max }: { c: Competitor; readOnly: boolean; max: number }) {
  const t = useTranslations("radar.removed")
  const td = useTranslations("radar.dismiss")
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const restore = useRestoreCompetitor()
  return (
    <li className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5">
      <PageAvatar name={c.name} url={c.source.avatar?.url} />
      <div className="grid min-w-0 gap-0.5">
        <b className="truncate">{c.name}</b>
        <small className="text-xs text-fg-3">
          {t("line", {
            date: c.dismissedAt ? format.dateTime(new Date(c.dismissedAt), { month: "short", day: "numeric" }) : "—",
            reason: c.dismissReason ? td(`reason.${c.dismissReason}`) : "—",
          })}
        </small>
      </div>
      {readOnly ? null : (
        <Button
          size="sm"
          variant="outline"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(c.id, {
              onSuccess: () => toast(t("restored", { name: c.name })),
              onError: (e) => {
                const reason = isApiError(e) ? (e.details as { reason?: string } | undefined)?.reason : null
                toast(reason === "competitor_limit" ? t("limit", { max, name: c.name }) : errorMessage(e))
              },
            })
          }
        >
          {t("undo")}
        </Button>
      )}
    </li>
  )
}
