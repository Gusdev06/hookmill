"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import type { MetaAdOfferInfo, MetaAdRow, MetaOfferFit, MetaOfferListMeta } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"
import type { OfferRef } from "./offer-fit-menu"

/*
 * meta-oferta-v1 §6 + §8: the Meta ads of the active offer first ("{offer}"), then "Not sure", then "Other products"
 * (collapsed, with its count). Nothing is hidden. The §6 notices go above the list.
 */

/** the offer selector of the pickers (shown with 2+ offers) */
export function OfferPicker({
  id, offers, value, onChange, allLabel, className, help = true,
}: {
  id: string
  offers: OfferRef[]
  value: string | null
  onChange: (id: string | null) => void
  /** "All offers" option (Campaigns): value null */
  allLabel?: string
  className?: string
  help?: boolean
}) {
  const t = useTranslations("metaOffer")
  const ALL = "__all__"
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold">
        {t("selectorLabel")}
      </label>
      <Select value={value ?? (allLabel ? ALL : "")} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className="w-full min-w-0 bg-field">
          <SelectValue placeholder={t("selectorLabel")} />
        </SelectTrigger>
        <SelectContent>
          {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
          {offers.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? <span className="text-xs text-fg-3">{t("selectorHelp")}</span> : null}
    </div>
  )
}

export function NotSureChip({ className }: { className?: string }) {
  const t = useTranslations("metaOffer")
  return (
    <span className={cn("inline-flex h-fit flex-none items-center rounded-full border border-status-waiting-edge bg-status-waiting-bg px-2 py-[3px] text-[11px] font-bold whitespace-nowrap text-status-waiting", className)}>
      {t("notSure")}
    </span>
  )
}

/** "why" of the attribution, for a title/tooltip */
export function useOfferWhy() {
  const t = useTranslations("metaOffer")
  return (o: MetaAdOfferInfo | undefined) => {
    if (!o) return ""
    if (!o.offerId && o.noneReason) return t(`none.${o.noneReason}`)
    return [t(`match.${o.match}`), o.destinationHost].filter(Boolean).join(" · ")
  }
}

/** the assigned offer as a small chip (Campaigns), with the rule in the title */
export function OfferChip({ info, className }: { info: MetaAdOfferInfo | undefined; className?: string }) {
  const t = useTranslations("metaOffer")
  const why = useOfferWhy()
  if (!info) return null
  const tone =
    info.fit === "this" ? "border-status-approved-edge bg-status-approved-bg text-status-approved"
    : info.fit === "unknown" ? "border-status-waiting-edge bg-status-waiting-bg text-status-waiting"
    : "border-line-soft bg-card-2 text-fg-3"
  const label = info.offerName ?? (info.fit === "unknown" ? t("notSure") : t("noOffer"))
  return (
    <span title={why(info)} className={cn("inline-flex max-w-[160px] min-w-0 flex-none items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-semibold", tone, className)}>
      {info.confidence === "low" ? <span aria-hidden="true">~</span> : null}
      <span className="truncate">{label}</span>
    </span>
  )
}

/** §6: no readable link · links still being read · the offer has no URL */
export function OfferNotices({ offer, meta, className }: { offer: OfferRef; meta: MetaOfferListMeta | undefined; className?: string }) {
  const t = useTranslations("metaOffer.warn")
  if (!meta) return null
  const c = meta.counts
  const noLink = (meta.links.read === 0 && meta.links.unreadable > 0) || (c.this === 0 && c.unknown > 0)
  if (!noLink && !meta.links.pending && meta.offerHasUrl) return null
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {!meta.offerHasUrl ? (
        <Alert variant="warning">
          <Icon name="link" />
          <AlertBody>
            <AlertTitle>{t("noUrlTitle", { offer: offer.name })}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Link href="/offers" className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("noUrlCta")}
            </Link>
          </AlertActions>
        </Alert>
      ) : null}
      {noLink ? (
        <Alert variant="info">
          <Icon name="info" />
          <AlertBody>
            <AlertTitle>{t("noLinkTitle")}</AlertTitle>
            <AlertDescription>{t("noLinkBody", { offer: offer.name })}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      {meta.links.pending ? (
        <span className="flex items-center gap-1.5 text-xs text-fg-3" role="status">
          <Icon name="clock" className="size-3.5" />
          {t("pending", { n: meta.links.pending })}
        </span>
      ) : null}
    </div>
  )
}

const fitOf = (r: MetaAdRow): MetaOfferFit | null => r.offer?.fit ?? null

/**
 * The 3 groups. Without an active offer (or before the API sends `offer`) the rows go flat, as before.
 * `renderGroup(rows, group)` draws one group's list (a radiogroup in Templates, a column of AdRows elsewhere).
 * "Other products" starts collapsed; opening it calls `onOpenOther` (the screen may load the rest of them).
 */
export function OfferSections({
  offer, rows, meta, renderGroup, onOpenOther, moreOther, emptyThis,
}: {
  offer: OfferRef | null
  rows: MetaAdRow[]
  meta: MetaOfferListMeta | undefined
  renderGroup: (rows: MetaAdRow[], group: MetaOfferFit | "flat") => React.ReactNode
  onOpenOther?: () => void
  /** shown under the open "Other products" when some are not loaded yet (e.g. "Show all 12") */
  moreOther?: React.ReactNode
  /** replaces the default "No ads matched {offer} yet." */
  emptyThis?: React.ReactNode
}) {
  const t = useTranslations("metaOffer")
  const [openOther, setOpenOther] = useState(false)
  const grouped = !!offer && rows.some((r) => fitOf(r) !== null)
  if (!grouped) return <>{renderGroup(rows, "flat")}</>
  const by = (f: MetaOfferFit) => rows.filter((r) => fitOf(r) === f)
  const mine = by("this")
  const unsure = by("unknown")
  const other = by("other")
  const count = (f: MetaOfferFit, loaded: number) => meta?.counts[f] ?? loaded
  const head = (label: string, n: number, extra?: React.ReactNode) => (
    <div className="flex min-w-0 items-center gap-2">
      <h3 className="m-0 min-w-0 truncate text-[13px] font-bold">{label}</h3>
      <span className="font-mono text-xs text-fg-3 tabular-nums">{n}</span>
      {extra}
    </div>
  )
  const nOther = count("other", other.length)
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <section className="flex min-w-0 flex-col gap-2" aria-label={offer.name}>
        {head(offer.name, count("this", mine.length))}
        {mine.length ? renderGroup(mine, "this") : !unsure.length ? (emptyThis ?? <p className="m-0 text-[13px] text-fg-3">{t("emptyThis", { offer: offer.name })}</p>) : null}
      </section>
      {unsure.length ? (
        <section className="flex min-w-0 flex-col gap-2" aria-label={t("sectionUnknown")}>
          {head(t("sectionUnknown"), count("unknown", unsure.length))}
          {renderGroup(unsure, "unknown")}
        </section>
      ) : null}
      {nOther > 0 || other.length ? (
        <section className="flex min-w-0 flex-col gap-2" aria-label={t("sectionOther")}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={openOther}
            className="-ml-2 self-start"
            onClick={() => {
              const next = !openOther
              setOpenOther(next)
              if (next) onOpenOther?.()
            }}
          >
            <Icon name="chev" className={cn("transition-transform duration-150", openOther && "rotate-90")} />
            <span className="font-bold">{t("sectionOther")}</span>
            <span className="font-mono text-xs text-fg-3 tabular-nums">{nOther}</span>
          </Button>
          {openOther ? (
            <>
              <p className="m-0 text-xs text-fg-3">{t("otherHint", { offer: offer.name })}</p>
              {other.length ? renderGroup(other, "other") : null}
              {other.length < nOther ? moreOther : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
