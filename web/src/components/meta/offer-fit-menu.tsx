"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { MetaAdRow, MetaOfferLinkBody, MetaOfferLinkQuery, MetaOfferLinkResult } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

/*
 * meta-oferta-v1 §5 + §7: the manual correction ("Not from {offer}" / "From {offer}" / "From another offer…" / Undo) and
 * the confirmation before iterating an ad that looks like another product's (never a block: "Use anyway" remembers it).
 * Used by the 3 pickers (Templates · ad step, Iterate · Pick from Meta, Campaigns).
 */
export type OfferRef = { id: string; name: string }

type LinkOp =
  | { kind: "put"; body: MetaOfferLinkBody; quiet?: boolean }
  | { kind: "delete"; query: MetaOfferLinkQuery }

/** PUT / DELETE /meta/offer-links; invalidates every Meta reading (`mk.ads*`, `mk.campaigns*`, the campaign details) */
export function useOfferLink(active: OfferRef | null) {
  const t = useTranslations("metaOffer")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (op: LinkOp): Promise<MetaOfferLinkResult> => (op.kind === "put" ? api.meta.offerLinks.put(op.body) : api.meta.offerLinks.remove(op.query)),
    onSuccess: (r, op) => {
      void qc.invalidateQueries({ queryKey: ["meta", "ads"] })
      void qc.invalidateQueries({ queryKey: ["meta", "campaigns"] })
      void qc.invalidateQueries({ queryKey: ["meta", "campaign"] })
      if (op.kind === "delete") return void toast(t("toast.undone"))
      if (op.quiet) return
      const toActive = op.body.belongs && op.body.offerId === active?.id
      if (!r.affectedAds) return void toast(t("toast.saved"))
      toast(toActive ? t("toast.movedThis", { n: r.affectedAds, offer: active?.name ?? "" }) : t("toast.movedOther", { n: r.affectedAds }))
    },
    onError: (e) => void toast(errorMessage(e)),
  })
}

/**
 * The menu items (inside an existing DropdownMenuContent, e.g. the Campaigns ⋯ menu). AD: by the row's `offer.fit`;
 * CAMPAIGN: "All ads in this campaign are from {offer}" / "This campaign isn't from {offer}".
 */
export function OfferFitItems({
  target, active, offers, separator,
}: {
  target: { level: "AD"; ad: MetaAdRow } | { level: "CAMPAIGN"; id: string }
  active: OfferRef
  offers: OfferRef[]
  /** a separator above the items (when they follow other items) */
  separator?: boolean
}) {
  const t = useTranslations("metaOffer.menu")
  const link = useOfferLink(active)
  const put = (belongs: boolean, offerId = active.id) =>
    link.mutate({ kind: "put", body: { level: target.level, objectId: target.level === "AD" ? target.ad.metaAdId : target.id, offerId, belongs } })
  const sep = separator ? <DropdownMenuSeparator /> : null
  if (target.level === "CAMPAIGN")
    return (
      <>
        {sep}
        <DropdownMenuLabel className="text-xs font-semibold text-fg-3">{t("title")}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => put(true)}>
          <Icon name="check" />
          {t("campaignThis", { offer: active.name })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => put(false)}>
          <Icon name="x" />
          {t("campaignNotThis", { offer: active.name })}
        </DropdownMenuItem>
      </>
    )
  const info = target.ad.offer
  const fit = info?.fit ?? null
  const others = offers.filter((o) => o.id !== active.id)
  const manual = info?.manual ?? null
  return (
    <>
      {sep}
      <DropdownMenuLabel className="text-xs font-semibold text-fg-3">{t("title")}</DropdownMenuLabel>
      {fit !== "this" ? (
        <DropdownMenuItem onSelect={() => put(true)}>
          <Icon name="check" />
          {t("this", { offer: active.name })}
        </DropdownMenuItem>
      ) : null}
      {fit !== "other" ? (
        <DropdownMenuItem onSelect={() => put(false)}>
          <Icon name="x" />
          {t("notThis", { offer: active.name })}
        </DropdownMenuItem>
      ) : null}
      {others.length ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-fg-3">{t("another")}</DropdownMenuLabel>
          {others.map((o) => (
            <DropdownMenuItem key={o.id} disabled={info?.offerId === o.id && fit === "other"} onSelect={() => put(true, o.id)} className="pl-8">
              <span className="min-w-0 truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {manual ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              link.mutate({ kind: "delete", query: { level: manual.level, objectId: manual.level === "AD" ? target.ad.metaAdId : target.ad.campaign.id, offerId: active.id } })
            }
          >
            <Icon name="refresh" />
            {t("undo")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

/** a standalone "offer" button + menu for an ad row of the pickers; nothing without an active offer or without `canEdit` */
export function OfferFitMenu({ ad, active, offers, className }: { ad: MetaAdRow; active: OfferRef | null; offers: OfferRef[]; className?: string }) {
  const t = useTranslations("metaOffer.menu")
  if (!active || !ad.offer?.canEdit) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "flex-none!", className)} aria-label={t("trigger", { name: ad.name })}>
        <Icon name="dots" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[min(320px,calc(100vw-24px))] min-w-[240px]">
        <OfferFitItems target={{ level: "AD", ad }} active={active} offers={offers} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * §7: picking a row with `fit = 'other'` asks first ("This ad looks like it's from {offerName ?? 'another product'}. Use it for
 * {offer} anyway?"). "Use anyway" sends PUT { level: 'AD', belongs: true } (remembering it, silently) and goes on.
 * Usage: `const guard = useOtherOfferGuard(active)` → `guard.check(ad, proceed)` + render `guard.dialog`.
 */
export function useOtherOfferGuard(active: OfferRef | null) {
  const t = useTranslations("metaOffer.confirm")
  const link = useOfferLink(active)
  const [pending, setPending] = useState<{ ad: MetaAdRow; go: () => void } | null>(null)
  const check = (ad: MetaAdRow, go: () => void) => {
    if (active && ad.offer?.fit === "other") setPending({ ad, go })
    else go()
  }
  const confirm = () => {
    if (!pending || !active) return
    if (pending.ad.offer?.canEdit) link.mutate({ kind: "put", quiet: true, body: { level: "AD", objectId: pending.ad.metaAdId, offerId: active.id, belongs: true } })
    pending.go()
    setPending(null)
  }
  const other = pending?.ad.offer?.offerName ?? t("anotherProduct")
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { other })}</AlertDialogTitle>
          <AlertDialogDescription>{t("body", { offer: active?.name ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        {pending ? <p className="m-0 truncate text-[13px] font-semibold">{pending.ad.name}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("pick")}</AlertDialogCancel>
          <button type="button" className={buttonVariants({ variant: "default" })} onClick={confirm}>
            {t("use")}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { check, dialog }
}
