"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaBudgetStepTooLargeDetails, MetaObjectChangedDetails, MetaObjectRef, MetaParentPausedDetails, MetaToggleStatus, MetaWriteResult } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { AdThumbSmall, Chip, useFormat } from "./cells"
import { learningOf, nodeId, pathOf, spendBudget, statusOf, pausedParents, type Node } from "./model"

/*
 * Every write goes through a dialog (spec §2.10-§2.12; Gusta 22/10: pause AND turn on always confirm). Desktop: centered
 * dialog; ≤760 px: bottom sheet. Errors stay inside the dialog, above the buttons; "changed in Ads Manager" swaps the
 * content for the conflict view with "Update row" (never re-sends by itself).
 */
export type WriteTarget = { kind: "toggle" | "budget"; n: Node }
export type Current = MetaObjectChangedDetails["current"]

/** shared bottom-sheet-on-phone classes for Dialog and the History sheet */
export const sheetOnPhone =
  "max-tablet:top-auto max-tablet:bottom-0 max-tablet:left-0 max-tablet:w-full max-tablet:max-w-full max-tablet:translate-x-0 max-tablet:translate-y-0 max-tablet:rounded-b-none max-tablet:rounded-t-[20px] max-tablet:border-x-0 max-tablet:border-b-0 max-tablet:pb-[calc(20px+env(safe-area-inset-bottom,0px))]"

export function ObjectLine({ n }: { n: Node }) {
  const t = useTranslations("campaigns")
  const path = pathOf(n)
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md border border-line-soft bg-card-2 px-3 py-2.5">
      <AdThumbSmall n={n} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] tracking-[0.06em] text-fg-3 uppercase">{t(`level.${n.level}`)}</span>
        <b className="font-bold text-pretty">{n.row.name}</b>
        {path ? <span className="text-xs text-pretty text-fg-3">{path}</span> : null}
      </span>
    </div>
  )
}
function Kv({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2.5 border-t border-line-soft py-[7px] text-[13px] first:border-t-0">
      <span className="text-fg-3">{k}</span>
      <span className="text-right font-mono font-semibold">{v}</span>
    </div>
  )
}
function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-1 max-tablet:grid max-tablet:grid-cols-2 max-tablet:[&>*]:w-full">{children}</div>
}

type WriteError =
  | { kind: "rate" }
  | { kind: "token" | "permission" | "policy" | "unusable" | "generic"; message?: string }
  | null

/** seconds left of a "Meta asked us to wait"; counts down once a second */
function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(id)
  }, [left])
  return [left, setLeft] as const
}

function ErrorBox({ err, left }: { err: WriteError; left: number }) {
  const t = useTranslations("campaigns.err")
  if (!err) return null
  if (err.kind === "rate")
    return left > 0 ? (
      <Alert variant="warning" role="alert">
        <Icon name="clock" />
        <AlertBody>
          <AlertTitle>{t("rateTitle")}</AlertTitle>
          <AlertDescription>{t("rateBody", { s: left })}</AlertDescription>
        </AlertBody>
      </Alert>
    ) : null
  if (err.kind === "token" || err.kind === "permission")
    return (
      <Alert variant="destructive" role="alert">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{err.kind === "token" ? t("tokenTitle") : t("permissionTitle")}</AlertTitle>
          <AlertDescription>{err.kind === "token" ? t("tokenBody") : err.message}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href="/settings/connections" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("reconnect")}
          </Link>
        </AlertActions>
      </Alert>
    )
  return (
    <Alert variant="destructive" role="alert">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{err.kind === "policy" ? t("policyTitle") : err.kind === "unusable" ? t("unusableTitle") : t("failedTitle")}</AlertTitle>
        <AlertDescription>{err.kind === "policy" ? t("policyBody") : err.message}</AlertDescription>
      </AlertBody>
    </Alert>
  )
}

export function WriteDialog({
  target, currency, onClose, onDone, onUpdateRow, onGone, onUnusable, onFailedWrite,
}: {
  target: WriteTarget | null
  currency: string | null
  onClose: () => void
  onDone: (r: MetaWriteResult, n: Node) => void
  onUpdateRow: (n: Node, current: Current) => void
  onGone: (n: Node) => void
  onUnusable: () => void
  /** a failed write is logged in History (MetaChange FAILED): refresh the drawer's data */
  onFailedWrite: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target ? (
        <DialogContent showCloseButton={false} className={cn("w-[460px] max-h-[calc(100dvh-48px)] gap-3.5 overflow-auto rounded-lg p-5 sm:max-w-[460px] max-tablet:max-h-[88dvh]", sheetOnPhone)}>
          {/* keyed by the object, so each open starts clean */}
          <DialogBody key={`${target.kind}:${nodeId(target.n)}`} target={target} currency={currency} onClose={onClose} onDone={onDone} onUpdateRow={onUpdateRow} onGone={onGone} onUnusable={onUnusable} onFailedWrite={onFailedWrite} />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function DialogBody({
  target, currency, onClose, onDone, onUpdateRow, onGone, onUnusable, onFailedWrite,
}: { target: WriteTarget } & Omit<Parameters<typeof WriteDialog>[0], "target">) {
  const t = useTranslations("campaigns")
  const errorMessage = useErrorMessage()
  const locale = useLocale()
  const f = useFormat(currency)
  const { n, kind } = target
  const lvl = t(`level.${n.level}`)
  const status = statusOf(n)
  const turningOn = status !== "ACTIVE"
  const [serverParents, setServerParents] = useState<MetaObjectRef[] | null>(null)
  const parents = turningOn ? (serverParents ?? pausedParents(n)) : []
  const [changed, setChanged] = useState<Current | null>(null)
  const [err, setErr] = useState<WriteError>(null)
  const [left, setLeft] = useCountdown()

  // budget state (major units in the field; minor in the API)
  const b = n.level === "ad" ? null : n.row.budget
  const nowMinor = b?.amountMinor ?? 0
  const [value, setValue] = useState(() => (nowMinor / 100).toFixed(2))
  const [serverField, setServerField] = useState<string | null>(null)
  const parsed = Number(value.replace(",", "."))
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0
  const minor = valid ? Math.round(parsed * 100) : null
  const minMinor = b?.minimumMinor ?? null
  const maxMinor = nowMinor * 2

  const classify = (e: unknown) => {
    if (!isApiError(e)) return setErr({ kind: "generic", message: errorMessage(e) })
    const d = (e.details ?? {}) as Record<string, unknown>
    switch (e.code) {
      case "META_OBJECT_CHANGED":
        return setChanged((d as unknown as MetaObjectChangedDetails).current)
      case "META_PARENT_PAUSED":
        return setServerParents((d as unknown as MetaParentPausedDetails).parents)
      case "META_OBJECT_GONE":
        return onGone(n)
      case "META_UNAVAILABLE":
      case "RATE_LIMITED":
      case "META_RATE_LIMITED":
        setLeft(Number(d.retryAfterSec) || 60)
        return setErr({ kind: "rate" })
      case "META_TOKEN_INVALID":
        return setErr({ kind: "token" })
      case "META_PERMISSION":
        return setErr({ kind: "permission", message: errorMessage(e) })
      case "META_POLICY":
        return setErr({ kind: "policy" })
      case "META_ACCOUNT_UNUSABLE":
        onUnusable()
        return setErr({ kind: "unusable", message: t("banner.unusableBody") })
      case "META_BUDGET_TOO_LOW":
        return setServerField(t("budget.min", { value: f.minor(Number(d.minimumMinor) || minMinor) }))
      case "META_BUDGET_STEP_TOO_LARGE":
        return setServerField(t("budget.max", { value: f.minor((d as unknown as MetaBudgetStepTooLargeDetails).maxMinor) }))
      case "META_BUDGET_NOT_EDITABLE":
        return setServerField(d.kind === "lifetime" ? t("budget.notEditableLifetime") : d.budgetLevel === "campaign" ? t("budget.notEditableCampaign") : t("budget.notEditableAdset"))
      default:
        return setErr({ kind: "generic", message: errorMessage(e) })
    }
  }
  const write = useMutation({
    mutationFn: (): Promise<MetaWriteResult> => {
      const next: MetaToggleStatus = turningOn ? "ACTIVE" : "PAUSED"
      if (kind === "toggle")
        return api.meta.setStatus(n.level, nodeId(n), { status: next, expected: status, confirm: true, ...(parents.length ? { includeParents: true } : {}) })
      return api.meta.setBudget(n.level as "campaign" | "adset", nodeId(n), { dailyBudgetMinor: minor!, expectedDailyBudgetMinor: nowMinor, confirm: true })
    },
    onMutate: () => {
      setErr(null)
      setServerField(null)
    },
    onSuccess: (r) => onDone(r, n),
    onError: (e) => {
      classify(e)
      onFailedWrite()
    },
  })
  const busy = write.isPending
  const waiting = err?.kind === "rate" && left > 0

  // ── conflict: "This changed in Ads Manager after our last sync"
  if (changed) {
    const show = (s: MetaToggleStatus, m: number | null) => [s === "ACTIVE" ? t("state.on") : t("state.off"), m !== null && n.level !== "ad" ? `${f.minor(m)}${t("budget.perDay")}` : null].filter(Boolean).join(" · ")
    const nowText = show(changed.status, changed.dailyBudgetMinor)
    return (
      <>
        <DialogTitle className="text-lg font-extrabold text-balance [font-stretch:115%]">{t("err.changedTitle")}</DialogTitle>
        <ObjectLine n={n} />
        <DialogDescription className="m-0 text-fg-2">{t.rich("err.changedBody", { now: nowText, b: (c) => <b>{c}</b> })}</DialogDescription>
        <div>
          <Kv k={t("err.lastSync")} v={show(status, b?.amountMinor ?? null)} />
          <Kv k={t("err.metaNow")} v={nowText} />
        </div>
        <Buttons>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="default" autoFocus onClick={() => onUpdateRow(n, changed)}>
            <Icon name="refresh" />
            {t("err.updateRow")}
          </Button>
        </Buttons>
      </>
    )
  }

  if (kind === "toggle") {
    const sb = spendBudget(n)
    const budgetText = sb
      ? sb.budget.kind === "lifetime"
        ? `${f.minor(sb.budget.amountMinor)} ${t("budget.lifetime")}`
        : `${f.minor(sb.budget.amountMinor)}${t("budget.perDay")}`
      : "—"
    const m30 = n.row.metrics
    return (
      <>
        <DialogTitle className="text-lg font-extrabold text-balance [font-stretch:115%]">{turningOn ? t("on.title", { level: lvl }) : t("pause.title", { level: lvl })}</DialogTitle>
        <ObjectLine n={n} />
        {turningOn ? (
          <>
            <DialogDescription className="m-0 font-bold text-fg">{t("on.body")}</DialogDescription>
            <div>
              <Kv k={t("on.budget")} v={sb ? (sb.where === "campaign" ? t("on.budgetCampaign", { value: budgetText }) : t("on.budgetAdset", { value: budgetText })) : budgetText} />
              <Kv k={t("on.last30")} v={t("on.last30Value", { spend: f.money0(m30.spend), cpa: f.money2(m30.cpa) })} />
            </div>
          </>
        ) : (
          <DialogDescription className="m-0 text-fg-2">{t("pause.body")}</DialogDescription>
        )}
        {parents.length ? (
          <div className="flex flex-col gap-2">
            <b>{t("on.parents")}</b>
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-md border border-line p-0">
              {parents.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center gap-2.5 border-t border-line-soft px-3 py-2.5 first:border-t-0">
                  <i className="size-[7px] flex-none rounded-full bg-control" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-[10px] tracking-[0.06em] text-fg-3 uppercase">{t(`level.${p.level}`)}</span>
                    <span className="font-semibold text-pretty">{p.name}</span>
                  </span>
                  <Chip tone="neutral">{t("on.offToOn")}</Chip>
                </li>
              ))}
            </ul>
            <span className="text-[13px] text-fg-3">{t("on.parentsBody", { level: lvl })}</span>
          </div>
        ) : null}
        <ErrorBox err={err} left={left} />
        <Buttons>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant={turningOn ? "brand" : "default"} autoFocus onClick={() => write.mutate()} disabled={busy || waiting} aria-busy={busy}>
            {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
            {busy ? (turningOn ? t("on.busy") : t("pause.busy")) : turningOn ? (parents.length ? t("on.ctaN", { count: parents.length + 1 }) : t("on.cta")) : t("pause.cta")}
          </Button>
        </Buttons>
      </>
    )
  }

  // ── daily budget
  const tooLow = minor !== null && minMinor !== null && minor < minMinor
  const tooHigh = minor !== null && minor > maxMinor
  const fieldErr = !valid ? t("budget.enter") : tooLow ? t("budget.min", { value: f.minor(minMinor) }) : tooHigh ? t("budget.max", { value: f.minor(maxMinor) }) : serverField
  const same = minor === nowMinor
  const warn = !fieldErr && !same && (minor! > nowMinor * 1.2 || learningOf(n))
  const symbol = (() => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "$"
    } catch {
      return "$"
    }
  })()
  const setPct = (p: number) => {
    setValue(((nowMinor * (1 + p / 100)) / 100).toFixed(2))
    setServerField(null)
  }
  const diff = minor !== null ? minor - nowMinor : 0
  const help = !same && valid && !fieldErr
    ? t("budget.diff", { sign: diff > 0 ? "+" : "−", value: f.minor(Math.abs(diff)), pct: nowMinor ? Math.abs(Math.round((diff / nowMinor) * 100)) : 0, min: f.minor(minMinor), max: f.minor(maxMinor) })
    : minMinor !== null ? t("budget.hint", { min: f.minor(minMinor), max: f.minor(maxMinor) }) : t("budget.hintNoMin", { max: f.minor(maxMinor) })
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        if (!fieldErr && !same && !busy && !waiting) write.mutate()
      }}
    >
      <DialogTitle className="text-lg font-extrabold text-balance [font-stretch:115%]">{t("budget.title")}</DialogTitle>
      <ObjectLine n={n} />
      <DialogDescription asChild>
        <div>
          <Kv k={t("budget.now", { where: n.level === "campaign" ? t("budget.cbo") : t("budget.abo") })} v={`${f.minor(nowMinor)}${t("budget.perDay")}`} />
        </div>
      </DialogDescription>
      <div className="flex flex-col gap-2">
        <label htmlFor="budget-in" className="text-[13px] font-bold">
          {t("budget.new")}
        </label>
        <div className={cn("flex min-h-[52px] items-center gap-1.5 rounded-lg border border-line-strong bg-field px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-info", fieldErr && valid && "border-bad")}>
          <span className="font-mono text-lg text-fg-3">{symbol}</span>
          <input
            id="budget-in"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValue(e.target.value)
              setServerField(null)
            }}
            aria-invalid={!!fieldErr}
            aria-describedby="budget-msg"
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[22px] font-semibold tabular-nums outline-none"
          />
          <span className="font-mono text-[13px] text-fg-3">{t("budget.perDay")}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[-20, 20, 50, 100].map((p) => (
            <button key={p} type="button" onClick={() => setPct(p)} className="min-h-[34px] rounded-full border border-line-strong bg-card px-2.5 font-mono text-xs font-semibold hover:border-fg">
              {p > 0 ? "+" : ""}
              {p}%
            </button>
          ))}
        </div>
        <span id="budget-msg" role={fieldErr ? "alert" : undefined} className={cn("flex items-start gap-1.5 text-[13px]", fieldErr ? "text-bad" : "text-fg-3")}>
          {fieldErr ? <Icon name="alert" className="mt-0.5 size-3.5" /> : null}
          {fieldErr ?? help}
        </span>
      </div>
      {warn ? (
        <Alert variant="warning">
          <Icon name="alert" />
          <AlertBody>
            <AlertDescription>{t("budget.learning")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      <ErrorBox err={err} left={left} />
      <span className="text-[13px] text-fg-3">{t("budget.note")}</span>
      <Buttons>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" variant="default" disabled={!!fieldErr || same || busy || waiting} aria-busy={busy}>
          {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
          {busy ? t("budget.saving") : t("budget.save")}
        </Button>
      </Buttons>
    </form>
  )
}
