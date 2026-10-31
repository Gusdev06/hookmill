"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { STEPS, type CreativeDetail, type Step, type StepInfo } from "@/lib/api/types"
import { setCrumb } from "@/lib/crumb"
import { qk } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"
import { VariationLine } from "@/components/variar/variation-line"

type Kind = StepInfo["state"]

/** Step icon (spec §5): done = white check, current = outline, running = blue ring, failed = red "!". */
export function StepIcon({ kind, n }: { kind: Kind | "skipped"; n: number }) {
  if (kind === "skipped")
    return <span className="grid size-[18px] flex-none place-items-center rounded-full border border-dashed border-line-2 font-mono text-[10px] text-fg-3">–</span>
  if (kind === "done")
    return (
      <span className="grid size-[18px] flex-none place-items-center rounded-full border border-fg bg-fg text-bg">
        <Icon name="check" className="size-3" />
      </span>
    )
  if (kind === "progress") return <span className="spin-ring size-[18px] flex-none" aria-hidden="true" />
  if (kind === "failed")
    return <span className="grid size-[18px] flex-none place-items-center rounded-full border border-status-failed font-mono text-[10px] text-status-failed">!</span>
  return (
    <span className={cn("grid size-[18px] flex-none place-items-center rounded-full border font-mono text-[10px]", kind === "current" ? "border-fg text-fg" : "border-line-2 text-fg-3")}>{n}</span>
  )
}

export function stepHref(id: string | null, step: Step) {
  return id ? `/creatives/${encodeURIComponent(id)}/${step}` : "/creatives/new"
}

function StepList({ id, steps, viewing, onNavigate, mobile }: { id: string | null; steps: StepInfo[]; viewing: Step; onNavigate?: () => void; mobile?: boolean }) {
  const t = useTranslations("steps")
  return (
    <ol className={cn("m-0 grid list-none gap-0.5 p-0", mobile && "pt-1")}>
      {steps.map((s, i) => {
        const open = s.state !== "todo" || (s.step === "offer" && !id)
        const cls = cn(
          "flex w-full items-center gap-2.5 rounded-sm px-2 text-left text-sm",
          mobile ? "py-[9px] px-1.5" : "py-[7px]",
          s.step === viewing ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-2",
          open ? "hover:bg-hover hover:text-fg" : "cursor-default opacity-60"
        )
        const inner = (
          <>
            <StepIcon kind={s.step === viewing && s.state === "todo" ? "current" : s.state} n={i + 1} />
            {t(s.step)}
          </>
        )
        return (
          <li key={s.step}>
            {open ? (
              <Link href={stepHref(id, s.step)} aria-current={s.step === viewing ? "step" : undefined} className={cls} onClick={onNavigate}>
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

function NameInput({ creative }: { creative: CreativeDetail | null }) {
  const t = useTranslations("wizard")
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [name, setName] = useState(creative?.name ?? "")
  const [shownName, setShownName] = useState(creative?.name)
  if (shownName !== creative?.name) {
    setShownName(creative?.name)
    setName(creative?.name ?? "")
  }
  useEffect(() => {
    setCrumb(name || t("untitled"))
  }, [name, t])
  useEffect(() => () => setCrumb(null), [])
  const rename = useMutation({
    mutationFn: (n: string) => api.creatives.rename(creative!.id, n),
    onSuccess: (d) => qc.setQueryData(qk.creative(d.id), d),
    onError: (e) => {
      setName(creative?.name ?? "")
      toast(errorMessage(e))
    },
  })
  return (
    <input
      value={name}
      placeholder={t("untitled")}
      disabled={!creative}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => creative && name.trim() && name.trim() !== creative.name && rename.mutate(name.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label={t("creativeName")}
      className="-mx-1.5 -my-1 w-[calc(100%+12px)] rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold text-fg outline-none hover:border-line focus-visible:border-fg-3 disabled:opacity-100"
    />
  )
}

export function useFaceNumber(creative: CreativeDetail | null) {
  const faces = useQuery({ queryKey: qk.faces(creative?.id ?? ""), queryFn: () => api.faces.list(creative!.id), enabled: !!creative?.summary.face })
  const id = faces.data?.selectedFaceId
  for (const b of faces.data?.batches ?? []) {
    const f = b.faces.find((x) => x.id === id)
    if (f) return f.position + 1
  }
  return null
}

const NEW_STEPS: StepInfo[] = STEPS.map((step, i) => ({ step, state: i === 0 ? "current" : "todo" }))

/**
 * Wizard frame (spec §2.3): left rail on desktop, "Step N of 7" bar + 7 segments on mobile,
 * body, and the sticky action bar (fixed at the bottom on mobile).
 */
export function WizardFrame({
  creative, offer, viewing, children, actionbar, live,
}: {
  creative: CreativeDetail | null
  offer?: { name: string; language: string } | null
  viewing: Step
  children: React.ReactNode
  actionbar?: React.ReactNode
  live?: "connecting" | "open" | "retrying"
}) {
  const t = useTranslations()
  const format = useFormatter()
  const now = useNow({ updateInterval: 15_000 })
  const lang = useLanguageName()
  const [open, setOpen] = useState(false)
  const steps = creative?.steps ?? NEW_STEPS
  const idx = STEPS.indexOf(viewing)
  const id = creative?.id ?? null
  const faceN = useFaceNumber(creative)
  const viewKind: Kind = steps[idx]?.state === "todo" ? "current" : (steps[idx]?.state ?? "current")
  const savedAgo = creative ? (now.getTime() - Date.parse(creative.savedAt) < 60_000 ? t("wizard.justNow") : format.relativeTime(new Date(creative.savedAt), now)) : null
  const offerName = offer?.name ?? creative?.offer.name

  return (
    <div className="grid min-h-[calc(100dvh-var(--hdr-h,94px))] grid-cols-[minmax(0,1fr)] min-[1100px]:grid-cols-[240px_minmax(0,1fr)]">
      <aside
        aria-label={t("wizard.railLabel")}
        className="hidden border-r border-line min-[1100px]:block"
      >
        {/* QA layout 29/10 #2/#17: rail only from 1100 px; the aside stretches (border to the bottom), its content is sticky */}
        <div className="sticky top-[calc(var(--hdr-h,94px)+2px)] grid content-start gap-[18px] px-4 py-5">
        <div className="grid gap-1">
          <NameInput creative={creative} />
          {offerName ? (
            <span className="row-sub">
              {offerName}
              {creative || offer ? ` · ${lang(offer?.language ?? creative!.language)}` : ""}
            </span>
          ) : null}
        </div>
        <StepList id={id} steps={steps} viewing={viewing} />
        <div className="grid gap-1.5 border-t border-line pt-3.5 text-[13px] text-fg-2 empty:hidden">
          {creative?.variation ? (
            <div className="grid gap-1 pb-1">
              <VariationLine v={creative.variation} className="whitespace-normal" />
              <Link href={`/variations/${encodeURIComponent(creative.variation.championId)}/batch?batch=${encodeURIComponent(creative.variation.batchId)}`} className="text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                {t("variar.openBatch")}
              </Link>
            </div>
          ) : null}
          {creative?.summary.scriptLetter ? (
            <div className="flex justify-between gap-2">
              <span>{t("wizard.script")}</span>
              <span>{creative.summary.scriptLetter}</span>
            </div>
          ) : null}
          {creative?.summary.face ? (
            <div className="flex justify-between gap-2">
              <span>{t("wizard.face")}</span>
              <span>{faceN ?? "—"}</span>
            </div>
          ) : null}
          {creative?.summary.engineLabel ? (
            <div className="flex justify-between gap-2">
              <span>{t("wizard.engineLabel")}</span>
              <span>{creative.summary.engineLabel}</span>
            </div>
          ) : null}
          {savedAgo ? (
            <div className="flex justify-between gap-2 text-fg-3">
              <span>{t("wizard.saved")}</span>
              <span>{savedAgo}</span>
            </div>
          ) : null}
        </div>
              </div>
      </aside>

      <div className="flex min-w-0 flex-col pb-[72px] tablet:pb-0">
        {/* mobile step bar */}
        <div className="sticky top-[var(--hdr-h,94px)] z-[9] grid gap-2 border-b border-line bg-bg px-[var(--gut)] py-2.5 min-[1100px]:hidden">
          <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <StepIcon kind={viewKind} n={idx + 1} />
            <span className="min-w-0">
              <span className="step-lbl">{t("wizard.stepOf", { n: idx + 1 })}</span>
              <br />
              <b className="font-semibold">{t(`steps.${viewing}`)}</b>
            </span>
            <Icon name={open ? "x" : "chevd"} className="ml-auto text-fg-3" />
          </button>
          <div className="grid grid-cols-7 gap-[3px]" aria-hidden="true">
            {steps.map((s, i) => (
              <i
                key={s.step}
                className={cn(
                  "h-[3px] rounded-[2px]",
                  s.state === "done" ? "bg-fg" : s.state === "progress" ? "bg-status-progress" : i === idx || s.state === "current" || s.state === "failed" ? "bg-fg-2" : "bg-line"
                )}
              />
            ))}
          </div>
          {open ? (
            <StepList id={id} steps={steps} viewing={viewing} mobile onNavigate={() => setOpen(false)} />
          ) : null}
        </div>

        {live === "retrying" ? (
          <p className="mx-[var(--gut)] mt-3 flex items-center gap-2 text-[13px] text-fg-3" role="status">
            <span className="spin-ring size-3" aria-hidden="true" />
            {t("wizard.reconnecting")}
          </p>
        ) : null}

        <div className="grid w-full max-w-[1120px] flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 px-[var(--gut)] pt-[18px] pb-8 tablet:pt-6">{children}</div>
        {actionbar}
      </div>
    </div>
  )
}

/** Sticky action bar (spec §2.4): hint on the left (desktop only), Back + primary. Fixed at the bottom on mobile. */
export function ActionBar({ hint, back, primary }: { hint?: React.ReactNode; back?: { href: string } | null; primary: React.ReactNode }) {
  const t = useTranslations("wizard")
  // toasts sit just above the action bar while it exists (QA bug 05/10: toast covering content)
  useEffect(() => {
    document.documentElement.style.setProperty("--toast-bottom", "76px")
    return () => {
      document.documentElement.style.removeProperty("--toast-bottom")
    }
  }, [])
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t border-line bg-bg px-[var(--gut)] pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] tablet:sticky tablet:gap-3 [&>[data-primary]]:min-w-0 [&>[data-primary]]:flex-1 tablet:[&>[data-primary]]:flex-none">
      <span className="mr-auto hidden min-w-0 truncate text-[13px] text-fg-3 tablet:block">{hint}</span>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm font-medium hover:border-line-2 hover:bg-hover"
        >
          <Icon name="left" />
          {t("back")}
        </Link>
      ) : null}
      {primary}
    </div>
  )
}

/** Page head inside the wizard body (mockup .wz-head). */
export function WzHead({ title, sub, aside }: { title: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub ? <p className="mt-1 max-w-[65ch] text-fg-2">{sub}</p> : null}
      </div>
      {aside}
    </div>
  )
}
