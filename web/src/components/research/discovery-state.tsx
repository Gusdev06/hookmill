"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { Competitor, CompetitorDiscoveryView, DiscoveryStage } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { AdjacentPill, PageAvatar, RPill, Spinner } from "./parts"

/*
 * "Finding your competitors" (G2: the client pastes nothing). Same shape as the mockup's "First sync" card (.sync / .syncrow):
 * one row per real stage of the pipeline (C.3), done / now / next, a bar and "you can leave this page". The stage comes
 * from GET /research/discovery (polling 3 s); leaving and coming back resumes from the API.
 * The card wears the Border Beam (.beam, the screen's one effect, only while waiting).
 */
const STAGES: DiscoveryStage[] = ["propose", "confirm", "scan", "judge", "import"]

export function DiscoveryProgress({ view, country, again }: { view: CompetitorDiscoveryView; country: string; again?: boolean }) {
  const t = useTranslations("radar.discovery")
  const last = view.last
  const queued = last?.status === "QUEUED"
  const at = queued || !last?.stage ? -1 : STAGES.indexOf(last.stage)
  const pct = queued ? 4 : Math.round(((Math.max(0, at) + 0.5) / STAGES.length) * 100)
  return (
    <section className="beam relative grid gap-3 rounded-[16px] border border-line bg-card p-4" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="m-0 text-base font-bold">{t("title")}</h2>
        <RPill tone="info">{t("leave")}</RPill>
      </div>
      <p className="m-0 max-w-[70ch] text-[13px] text-fg-2">{again ? t("again", { country }) : t("body", { country })}</p>
      <div className="h-1.5 overflow-hidden rounded-[4px] bg-line-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("title")}>
        <i className="block h-full bg-status-progress transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ol className="m-0 grid list-none gap-2 p-0">
        {STAGES.map((s, i) => {
          const state = queued ? "next" : i < at ? "done" : i === at ? "now" : "next"
          return (
            <li key={s} className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]">
              {state === "done" ? (
                <RPill tone="ok" className="justify-center px-1">
                  <NavIcon name="check" size={12} strokeWidth={2.4} />
                </RPill>
              ) : state === "now" ? (
                <RPill tone="info" className="justify-center px-1.5 tabular-nums">{i + 1}</RPill>
              ) : (
                <RPill className="justify-center px-1.5 tabular-nums">{i + 1}</RPill>
              )}
              <span className={cn(state === "next" ? "text-fg-3" : "text-fg", state === "now" && "font-semibold")}>{t(`stage.${s}`)}</span>
              <span className="font-mono text-xs text-fg-3">{state === "now" ? <Spinner className="size-3.5 border-status-progress" /> : t(state)}</span>
            </li>
          )
        })}
      </ol>
      {queued ? <span className="text-xs text-fg-3">{t("queued")}</span> : null}
    </section>
  )
}

export function DiscoveryEmpty({ country, onAgain, canAgain, againLabel, pending }: { country: string; onAgain: () => void; canAgain: boolean; againLabel: string; pending: boolean }) {
  const t = useTranslations("radar.discovery")
  return (
    <div className="grid justify-items-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-line-strong bg-card px-[18px] py-8 text-center text-fg-2">
      <NavIcon name="radar" size={28} className="text-fg-3" />
      <h2 className="m-0 text-base font-bold text-fg">{t("emptyTitle", { country })}</h2>
      <p className="m-0 max-w-[52ch]">{t("emptyBody")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" disabled={!canAgain || pending} onClick={onAgain} aria-busy={pending}>
          {pending ? <Spinner /> : null}
          {againLabel}
        </Button>
        <Link href="/brain" className={buttonVariants({ size: "sm", variant: "ghost" })}>
          {t("openBrain")}
        </Link>
      </div>
    </div>
  )
}

export function DiscoveryFailed({ onAgain, canAgain, againLabel, pending }: { onAgain: () => void; canAgain: boolean; againLabel: string; pending: boolean }) {
  const t = useTranslations("radar.discovery")
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-md border border-status-failed-edge bg-status-failed-bg px-3.5 py-3 text-[13px] text-status-failed" role="alert">
      <div className="grid min-w-0 flex-[1_1_260px] gap-0.5">
        <b className="text-fg">{t("failedTitle")}</b>
        <span>{t("failedBody")}</span>
      </div>
      <Button size="sm" disabled={!canAgain || pending} onClick={onAgain} aria-busy={pending}>
        {pending ? <Spinner /> : null}
        {againLabel}
      </Button>
    </div>
  )
}

/** After a discovery: who we picked, why (the judge's line), and direct × adjacent. Closed with "Got it" (remembered per discovery). */
export function PickedCard({ competitors, onClose, onRemove, readOnly }: { competitors: Competitor[]; onClose: () => void; onRemove: (c: Competitor) => void; readOnly: boolean }) {
  const t = useTranslations("radar.picked")
  const tc = useTranslations("radar.comp")
  const tb = useTranslations("radar.bar")
  return (
    <section className="grid gap-3 rounded-[16px] border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="grid min-w-0 flex-[1_1_320px] gap-1">
          <h2 className="m-0 text-base font-bold">{t("title", { n: competitors.length })}</h2>
          <p className="m-0 max-w-[72ch] text-[13px] text-fg-2">{t("body")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          {t("gotIt")}
        </Button>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {competitors.map((c) => (
          <li key={c.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5">
            <PageAvatar name={c.name} url={c.source.avatar?.url} />
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <b className="truncate">{c.name}</b>
                {c.relation === "ADJACENT" ? <AdjacentPill /> : null}
                <span className="font-mono text-[11px] text-fg-3 tabular-nums">
                  {c.activeIsLowerBound ? tb("atLeast", { n: c.counts.active }) : tb("active", { n: c.counts.active })}
                </span>
              </div>
              {c.reason ? (
                <span className="text-xs text-fg-2">
                  <span className="text-fg-3">{t("why")}: </span>
                  {c.reason}
                </span>
              ) : null}
            </div>
            {readOnly ? null : (
              <Button size="sm" variant="ghost" onClick={() => onRemove(c)}>
                {tc("remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
