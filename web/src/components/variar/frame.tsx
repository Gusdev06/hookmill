"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useFormatter, useNow, useTranslations } from "next-intl"
import type { ChampionDetail, VariationBatch } from "@/lib/api/types"
import { setCrumb } from "@/lib/crumb"
import { VARIAR_STEPS, variarHref, type VariarStep } from "@/lib/routes"
import { Icon } from "@/components/icon"
import { StepIcon } from "@/components/wizard/shell"
import { useLanguageName } from "@/hooks/use-language-name"
import { cn } from "@/lib/utils"

export type VStepState = "done" | "current" | "progress" | "failed" | "todo" | "skipped"
type VStep = { step: VariarStep; state: VStepState; href: string | null }

/** Rail state of the 6 steps (design spec §2.2), derived only from the champion and the batch the API returns. */
export function variarSteps(c: ChampionDetail | null, b: VariationBatch | null): VStep[] {
  const ready = c?.status === "READY"
  const hooksWanted = b ? b.requests.some((r) => r.kind === "NEW_HOOKS") : null
  const state: Record<VariarStep, VStepState> = {
    winner: !c ? "current" : c.status === "FAILED" && c.action === "upload_video" ? "failed" : "done",
    teardown: !c || (c.status === "FAILED" && c.action === "upload_video") ? "todo"
      : c.status === "RESOLVING" || c.status === "ANALYZING" ? "progress" : c.status === "FAILED" ? "failed" : b ? "done" : "current",
    variations: !ready ? "todo" : b ? "done" : "current",
    hooks: hooksWanted === false ? "skipped" : !b ? "todo"
      : b.status === "PLANNING" ? "progress" : b.status === "PLAN_FAILED" ? "failed" : b.status === "LAUNCHED" ? "done" : "current",
    estimate: !b || b.status === "PLANNING" || b.status === "PLAN_FAILED" ? "todo" : b.status === "LAUNCHED" ? "done" : "current",
    batch: b?.status !== "LAUNCHED" ? "todo" : b.progress?.failed ? "failed" : b.progress?.generating ? "progress" : "current",
  }
  return VARIAR_STEPS.map((step) => {
    const open = state[step] !== "todo" && state[step] !== "skipped"
    const scoped = step === "hooks" || step === "estimate" || step === "batch"
    return { step, state: state[step], href: open && (c || step === "winner") ? variarHref(c?.id ?? null, step, scoped ? b?.id : null) : null }
  })
}

function StepList({ steps, viewing, onNavigate, mobile }: { steps: VStep[]; viewing: VariarStep; onNavigate?: () => void; mobile?: boolean }) {
  const t = useTranslations("variar")
  return (
    <ol className={cn("m-0 grid list-none gap-0.5 p-0", mobile && "pt-1")}>
      {steps.map((s, i) => {
        const cls = cn(
          "flex w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm",
          mobile ? "py-[9px] px-1.5" : "py-[7px]",
          s.step === viewing ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-2",
          s.href ? "hover:bg-hover hover:text-fg" : "cursor-default opacity-60"
        )
        const kind = s.step === viewing && (s.state === "todo" || s.state === "done") ? "current" : s.state
        const inner = (
          <>
            <StepIcon kind={kind} n={i + 1} />
            {t(`steps.${s.step}`)}
            {s.state === "skipped" ? <span className="ml-auto text-xs text-fg-3">{t("skipped")}</span> : null}
          </>
        )
        return (
          <li key={s.step}>
            {s.href ? (
              <Link href={s.href} aria-current={s.step === viewing ? "step" : undefined} className={cls} onClick={onNavigate}>
                {inner}
              </Link>
            ) : (
              <span className={cls} aria-disabled="true">
                {inner}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Same frame as the v1 wizard (spec §2.2): rail with 6 steps on desktop, "Step N of 6" + segments on mobile,
 * body and the action bar slot. Reuses ActionBar / WzHead from the v1 shell.
 */
export function VariarFrame({
  champion, batch, viewing, offer, children, actionbar,
}: {
  champion: ChampionDetail | null
  batch?: VariationBatch | null
  viewing: VariarStep
  offer?: { name: string; language: string } | null
  children: React.ReactNode
  actionbar?: React.ReactNode
}) {
  const t = useTranslations("variar")
  const format = useFormatter()
  const now = useNow({ updateInterval: 15_000 })
  const lang = useLanguageName()
  const [open, setOpen] = useState(false)
  const steps = variarSteps(champion, batch ?? null)
  const idx = VARIAR_STEPS.indexOf(viewing)
  const viewState = steps[idx]?.state
  const viewKind = viewState === "todo" || viewState === "done" ? "current" : (viewState ?? "current")
  const name = champion?.name ?? t("newBatch")
  const variations = batch ? batch.items.filter((i) => i.included && !i.isControl).length : null
  const savedAt = batch?.createdAt ?? champion?.updatedAt ?? null
  const savedAgo = savedAt ? (now.getTime() - Date.parse(savedAt) < 60_000 ? t("justNow") : format.relativeTime(new Date(savedAt), now)) : null
  const offerLine = offer ?? (champion ? { name: champion.offer.name, language: champion.language ?? "" } : null)

  useEffect(() => {
    setCrumb(t("title"))
    return () => setCrumb(null)
  }, [t])

  return (
    <div className="grid min-h-[calc(100dvh-var(--hdr-h,94px))] grid-cols-[minmax(0,1fr)] min-[1100px]:grid-cols-[240px_minmax(0,1fr)]">
      <aside
        aria-label={t("railLabel")}
        className="hidden border-r border-line min-[1100px]:block"
      >
        {/* QA layout 29/10 #2/#17: rail only from 1100 px; the aside stretches (border to the bottom), its content is sticky */}
        <div className="sticky top-[calc(var(--hdr-h,94px)+2px)] grid content-start gap-[18px] px-4 py-5">
        <div className="grid gap-1">
          <span className="step-lbl">{t("title")}</span>
          <b className="truncate text-[15px] font-semibold">{name}</b>
          {offerLine ? (
            <span className="row-sub">
              {offerLine.name}
              {offerLine.language ? ` · ${lang(offerLine.language)}` : ""}
            </span>
          ) : null}
        </div>
        <StepList steps={steps} viewing={viewing} />
        <div className="grid gap-1.5 border-t border-line pt-3.5 text-[13px] text-fg-2">
          {champion ? (
            <>
              <div className="flex justify-between gap-2">
                <span>{t("rail.source")}</span>
                <span>{champion.sources.includes("UPLOAD") ? t("rail.upload") : t("rail.adLibrary")}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{t("rail.owner")}</span>
                <span>{champion.rights === "OWN" ? t("rail.you") : t("rail.someoneElse")}</span>
              </div>
            </>
          ) : null}
          {variations !== null ? (
            <div className="flex justify-between gap-2">
              <span>{t("rail.variations")}</span>
              <span className="font-mono">{variations}</span>
            </div>
          ) : null}
          {savedAgo ? (
            <div className="flex justify-between gap-2 text-fg-3">
              <span>{t("rail.saved")}</span>
              <span>{savedAgo}</span>
            </div>
          ) : null}
        </div>
              </div>
      </aside>

      <div className="flex min-w-0 flex-col pb-[72px] tablet:pb-0">
        <div className="sticky top-[var(--hdr-h,94px)] z-[9] grid gap-2 border-b border-line bg-bg px-[var(--gut)] py-2.5 min-[1100px]:hidden">
          <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <StepIcon kind={viewKind} n={idx + 1} />
            <span className="min-w-0">
              <span className="step-lbl">{t("stepOf", { n: idx + 1 })}</span>
              <br />
              <b className="font-semibold">{t(`steps.${viewing}`)}</b>
            </span>
            <Icon name={open ? "x" : "chevd"} className="ml-auto text-fg-3" />
          </button>
          <div className="grid grid-cols-6 gap-[3px]" aria-hidden="true">
            {steps.map((s, i) => (
              <i
                key={s.step}
                className={cn(
                  "h-[3px] rounded-[2px]",
                  s.state === "done" ? "bg-fg" : s.state === "progress" ? "bg-status-progress"
                    : s.state === "skipped" ? "bg-[repeating-linear-gradient(90deg,var(--line)_0_3px,transparent_3px_6px)]"
                    : i === idx || s.state === "current" || s.state === "failed" ? "bg-fg-2" : "bg-line"
                )}
              />
            ))}
          </div>
          {open ? <StepList steps={steps} viewing={viewing} mobile onNavigate={() => setOpen(false)} /> : null}
        </div>
        <div className="grid w-full max-w-[1180px] flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 px-[var(--gut)] pt-[18px] pb-8 tablet:pt-6">{children}</div>
        {actionbar}
      </div>
    </div>
  )
}

/** Loading frame while the champion / batch query is pending. */
export function VariarFrameSkeleton({ viewing }: { viewing: VariarStep }) {
  return (
    <VariarFrame champion={null} viewing={viewing}>
      <div className="grid gap-4" role="status" aria-label="…">
        <span className="sk h-7 w-48" />
        <span className="sk h-4 w-96 max-w-full" />
        <span className="sk h-64 rounded-lg" />
      </div>
    </VariarFrame>
  )
}
