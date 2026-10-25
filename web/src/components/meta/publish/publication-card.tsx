"use client"

import { useState } from "react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import type { MetaAction, MetaPublication, Role } from "@/lib/api/types"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Checklist, checklistStates } from "@/components/fx"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useMoney, useRelativeTime } from "@/hooks/use-meta"
import { PUBLISH_STAGES, useMinorMoney, type PublishStage } from "@/hooks/use-meta-publish"
import { cn } from "@/lib/utils"

const CONNECTIONS = "/settings/connections"

/** Status pill of a publication (PUBLISHING · PAUSED · ACTIVE · FAILED · DELETED). */
export function PublicationTag({ status, className }: { status: MetaPublication["status"]; className?: string }) {
  const t = useTranslations("publish.status")
  const cls =
    status === "ACTIVE" ? "bg-status-approved-bg text-status-approved"
    : status === "PAUSED" ? "bg-status-waiting-bg text-status-waiting"
    : status === "FAILED" ? "bg-status-failed-bg text-status-failed"
    : status === "PUBLISHING" ? "bg-status-progress-bg text-status-progress"
    : "border border-line-soft bg-card-2 text-fg-2"
  return <span className={cn("inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", cls, className)}>{t(status)}</span>
}

function SettingsLine({ p, currency }: { p: MetaPublication; currency: string | null }) {
  const t = useTranslations("publish")
  const tf = useTranslations("publish.form")
  const money = useMinorMoney(currency)
  return <span className="text-[13px] text-fg-2">{t("result.settingsSummary", { budget: money(p.settings.dailyBudgetMinor), countries: p.settings.countries.join(", "), objective: tf(`objective.${p.settings.objective}`) })}</span>
}

/** §3.3.1 step 3: the six stages of the META_PUBLISH job from `job.checklist` + the progress bar. */
export function PublishProgress({ p }: { p: MetaPublication }) {
  const t = useTranslations("publish.progress")
  const job = p.job
  const list = job?.checklist?.length ? job.checklist : PUBLISH_STAGES.map((key) => ({ key, done: false }))
  const states = checklistStates(list.map((c) => c.done))
  const label = (key: string) => (PUBLISH_STAGES.includes(key as PublishStage) ? t(`stage.${key as PublishStage}`) : key)
  const progress = job?.progress ?? Math.round((list.filter((c) => c.done).length / list.length) * 100)
  return (
    <section className="beam relative grid gap-4 rounded-xl border border-line bg-card p-4 tablet:p-5" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-3">
        <span className="spin-ring size-4" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <b>{t("title")}</b>
          <span className="text-[13px] text-fg-3">{t("sub")}</span>
        </span>
        <span className="ml-auto font-mono text-[13px] text-fg-2">{progress}%</span>
      </div>
      <Progress value={progress} aria-label={t("title")} />
      <Checklist items={list.map((c, i) => ({ label: label(c.key), state: states[i] }))} />
      {job?.etaSec ? <span className="text-xs text-fg-3">{t("eta", { sec: job.etaSec })}</span> : null}
    </section>
  )
}

function IdsList({ p }: { p: MetaPublication }) {
  const t = useTranslations("publish.result")
  const rows = (["campaignId", "adsetId", "adId", "videoId", "creativeId"] as const).filter((k) => p.ids[k])
  if (!rows.length) return null
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
      {rows.map((k) => (
        <div key={k} className="contents">
          <dt className="text-fg-3">{t(`id.${k}`)}</dt>
          <dd className="m-0 truncate font-mono text-fg-2">{p.ids[k]}</dd>
        </div>
      ))}
    </dl>
  )
}

function Metrics({ p, currency }: { p: MetaPublication; currency: string | null }) {
  const t = useTranslations("publish.result")
  const money = useMoney(currency)
  const m = p.metrics
  if (!m) return <p className="m-0 text-[13px] text-fg-3">{t("noMetrics")}</p>
  const cells: [string, string][] = [
    [t("spend"), money(m.spend)],
    [t("results"), m.results ? String(m.results) : "0"],
    [t("cpa"), money(m.cpa)],
    [t("ctr"), `${m.ctr.toFixed(2)}%`],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
      {cells.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="text-xs text-fg-3">{k}</span>
          <span className="font-mono text-[17px] font-semibold">{v}</span>
        </div>
      ))}
    </div>
  )
}

function ActivateButton({ budget, account, onActivate, pending }: { budget: string; account: string; onActivate: () => void; pending: boolean }) {
  const t = useTranslations("publish.result")
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button variant="brand" size="lg" onClick={() => setOpen(true)} disabled={pending} aria-busy={pending}>
        {pending ? <span className="spin-ring size-4" aria-hidden="true" /> : <Icon name="play" />}
        {t("activate")}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("activateTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("activateBody", { budget, account })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onActivate}>{t("activateConfirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * §3.3.1 step 4: the result card. PAUSED = created (Ads Manager link, ids, Activate for OWNER/ADMIN with confirmation);
 * ACTIVE = Pause; FAILED = errorCode + failReason + the action; DELETED = publish again. CLIENT sees everything, no buttons.
 */
export function PublicationCard({
  p, role, currency, account, creativeId, actions,
}: {
  p: MetaPublication
  role: Role
  currency: string | null
  account: string
  creativeId: string
  actions: {
    activate: () => void; pause: () => void; retry: () => void
    /** open the form prefilled with this publication's settings (edit_ad_text / raise_budget / publish again) */
    edit: () => void
    pending: { activate: boolean; pause: boolean; retry: boolean }
    error: unknown
  }
}) {
  const t = useTranslations("publish.result")
  const tp = useTranslations("publish")
  const errorMessage = useErrorMessage()
  const rel = useRelativeTime()
  const money = useMinorMoney(currency)
  const canSpend = role === "OWNER" || role === "ADMIN"
  const canWrite = canSpend || role === "MEMBER"
  const cardCls = "grid gap-4 rounded-xl border border-line bg-card p-4 tablet:p-5"

  if (p.status === "PUBLISHING") return <PublishProgress p={p} />

  const external = p.adsManagerUrl ? (
    <a href={p.adsManagerUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "lg" })}>
      <Icon name="link" />
      {t("adsManager")}
    </a>
  ) : null
  const preview = p.previewUrl ? (
    <a href={p.previewUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "lg", variant: "ghost" })}>
      <Icon name="play" />
      {t("preview")}
    </a>
  ) : null
  const actionError = actions.error ? (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{errorMessage(actions.error)}</AlertTitle>
      </AlertBody>
    </Alert>
  ) : null
  const stamp = (
    <span className="text-[13px] text-fg-3">
      {p.activatedAt && p.status === "ACTIVE" ? t("activatedAt", { ago: rel(p.activatedAt) }) : p.publishedAt ? t("publishedAt", { ago: rel(p.publishedAt) }) : t("startedAt", { ago: rel(p.createdAt) })}
      {" · "}
      {t("by", { name: p.createdBy.name })}
    </span>
  )

  if (p.status === "PAUSED" || p.status === "ACTIVE") {
    const active = p.status === "ACTIVE"
    return (
      <section className={cardCls}>
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden="true" className={cn("inline-grid size-9 flex-none place-items-center rounded-full", active ? "bg-status-approved-bg text-status-approved" : "bg-status-waiting-bg text-status-waiting")}>
            {active ? <Icon name="play" /> : <Icon name="pause" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{active ? t("active") : t("paused")}</h2>
              <PublicationTag status={p.status} />
            </div>
            <p className="m-0 text-[13px] text-fg-2 text-pretty">{active ? t("activeBody", { account }) : t("pausedBody", { account })}</p>
            {stamp}
          </div>
        </div>
        <SettingsLine p={p} currency={currency} />
        <IdsList p={p} />
        <div className="border-t border-line-soft" />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">{t("metrics")}</span>
          <Metrics p={p} currency={currency} />
        </div>
        {actionError}
        <div className="flex flex-wrap gap-2 [&>*]:w-full tablet:[&>*]:w-auto">
          {canSpend ? (
            active ? (
              <Button variant="default" size="lg" onClick={actions.pause} disabled={actions.pending.pause} aria-busy={actions.pending.pause}>
                {actions.pending.pause ? <span className="spin-ring size-4" aria-hidden="true" /> : <Icon name="pause" />}
                {t("pause")}
              </Button>
            ) : (
              <ActivateButton budget={money(p.settings.dailyBudgetMinor)} account={account} onActivate={actions.activate} pending={actions.pending.activate} />
            )
          ) : null}
          {external}
          {preview}
        </div>
        {!canSpend ? <span className="text-xs text-fg-3">{t("onlyAdmins")}</span> : null}
      </section>
    )
  }

  if (p.status === "FAILED") {
    const a: MetaAction | null = p.action
    const stage = p.job?.stage ?? p.job?.checklist?.find((c) => !c.done)?.key ?? null
    const stageLabel = stage && PUBLISH_STAGES.includes(stage as PublishStage) ? tp(`progress.stage.${stage as PublishStage}`) : stage
    const retryBtn = (
      <Button variant="brand" size="lg" onClick={actions.retry} disabled={actions.pending.retry} aria-busy={actions.pending.retry}>
        {actions.pending.retry ? <span className="spin-ring size-4" aria-hidden="true" /> : <Icon name="refresh" />}
        {t("retry")}
      </Button>
    )
    const editBtn = (label: string) => (
      <Button variant="default" size="lg" onClick={actions.edit}>
        <Icon name="pencil" />
        {label}
      </Button>
    )
    const link = (href: string, label: string) => (
      <Link href={href} className={buttonVariants({ size: "lg", variant: "default" })}>
        {label}
        <Icon name="arrowr" />
      </Link>
    )
    let buttons: React.ReactNode = null
    if (canWrite) {
      buttons =
        a === "edit_ad_text" ? editBtn(t("editText"))
        : a === "raise_budget" ? <>{editBtn(t("editSettings"))}{retryBtn}</>
        : a === "reconnect_meta" ? link(CONNECTIONS, tp("sync.reconnect"))
        : a === "choose_account" ? link(CONNECTIONS, tp("sync.chooseAccount"))
        : a === "fix_payment" ? <>{link(CONNECTIONS, t("checkAccount"))}{retryBtn}</>
        : a === "render_again" ? link(`/creatives/${encodeURIComponent(creativeId)}/edit`, t("renderAgain"))
        : a === "contact_support" ? <span className="text-[13px] text-fg-2">{t("support")}</span>
        : retryBtn
    }
    return (
      <section className={cardCls}>
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("failed")}</AlertTitle>
            <AlertDescription>
              {p.errorCode ? errorMessage(p.errorCode) : null}
              {p.failReason ? (
                <>
                  <br />
                  <span className="text-fg-3">{p.failReason}</span>
                </>
              ) : null}
              {stageLabel ? (
                <>
                  <br />
                  <span className="font-mono text-xs">{t("failedAt", { stage: stageLabel })}</span>
                </>
              ) : null}
            </AlertDescription>
          </AlertBody>
        </Alert>
        {stamp}
        <SettingsLine p={p} currency={currency} />
        <IdsList p={p} />
        {actionError}
        <div className="flex flex-wrap gap-2 [&>*]:w-full tablet:[&>*]:w-auto">
          {buttons}
          {external}
        </div>
        {canWrite && (a === "retry" || a === "raise_budget" || a === "fix_payment" || a === null) ? <span className="text-xs text-fg-3">{t("retryHint")}</span> : null}
        {canWrite ? (
          <button type="button" onClick={actions.edit} className="justify-self-start text-[13px] font-semibold text-fg-2 underline-offset-2 hover:text-fg hover:underline">
            {t("publishAgain")}
          </button>
        ) : null}
      </section>
    )
  }

  // DELETED
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden="true" className="inline-grid size-9 flex-none place-items-center rounded-full border border-line-soft bg-card-2 text-fg-2">
          <Icon name="trash" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">{t("deleted")}</h2>
            <PublicationTag status={p.status} />
          </div>
          <p className="m-0 text-[13px] text-fg-2 text-pretty">{t("deletedBody")}</p>
          {stamp}
        </div>
      </div>
      <SettingsLine p={p} currency={currency} />
      {actionError}
      {canWrite ? (
        <div className="flex flex-wrap gap-2 [&>*]:w-full tablet:[&>*]:w-auto">
          <Button variant="brand" size="lg" onClick={actions.edit}>
            <Icon name="upload" />
            {t("publishAgain")}
          </Button>
          {external}
        </div>
      ) : null}
    </section>
  )
}

/** §3.3.1 step 1: previous attempts, collapsed. */
export function PublicationHistory({ items, currency }: { items: MetaPublication[]; currency: string | null }) {
  const t = useTranslations("publish.history")
  const tr = useTranslations("publish.result")
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  const money = useMinorMoney(currency)
  if (!items.length) return null
  return (
    <Accordion type="single" collapsible className="rounded-xl border border-line bg-card">
      <AccordionItem value="history" className="border-0">
        <AccordionTrigger className="gap-2 rounded-xl px-4 py-3 text-sm font-semibold">
          <Icon name="chev" className="transition-transform group-data-[state=open]:rotate-90" />
          {t("title")}
          <span className="ml-auto font-mono text-xs font-normal text-fg-3">{t("count", { count: items.length })}</span>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <ul className="m-0 grid list-none gap-2 p-0">
            {items.map((h) => (
              <li key={h.id} className="grid gap-1 rounded-md border border-line-soft bg-card-2 px-3 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <PublicationTag status={h.status} />
                  <span className="text-fg-2">{format.dateTime(new Date(h.createdAt), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-fg-3">{tr("by", { name: h.createdBy.name })}</span>
                  {h.adsManagerUrl ? (
                    <a href={h.adsManagerUrl} target="_blank" rel="noopener noreferrer" className="ml-auto font-semibold text-fg underline-offset-2 hover:underline">
                      {tr("adsManager")}
                    </a>
                  ) : null}
                </div>
                <span className="text-fg-2">
                  {money(h.settings.dailyBudgetMinor)}/d · {h.settings.countries.join(", ")} · {h.settings.objective.replace("OUTCOME_", "").toLowerCase()}
                </span>
                {h.status === "FAILED" && h.errorCode ? <span className="text-status-failed">{errorMessage(h.errorCode)}</span> : null}
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
