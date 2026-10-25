"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { useLocale, useNow, useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import type {
  MetaBudgetTooLowDetails, MetaCallToAction, MetaObjective, MetaPublishBody, MetaPublishDefaults, MetaPublishSettings, MetaSpecialAdCategory, MetaUnavailableDetails,
} from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { minorFactor, useMinorMoney } from "@/hooks/use-meta-publish"
import { cn } from "@/lib/utils"

/*
 * The form of Send → "Publish to Meta" (meta-v1 §3.3.1 step 2). Prefilled from `MetaPublishDefaults` (or from the settings
 * of a previous attempt when the user edits and publishes again). Validation mirrors MetaPublishBody; the synchronous
 * errors of POST /publish come back here with a one-click fix (switch to Traffic, raise to the minimum, reconnect…).
 */
const OBJECTIVES: MetaObjective[] = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION", "OUTCOME_TRAFFIC"]
const CTAS: MetaCallToAction[] = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "BOOK_NOW", "CONTACT_US", "DOWNLOAD", "SUBSCRIBE", "APPLY_NOW", "GET_QUOTE", "ORDER_NOW"]
const SPECIAL: MetaSpecialAdCategory[] = ["HOUSING", "CREDIT", "EMPLOYMENT", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"]
const NEEDS_PIXEL: MetaObjective[] = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION"]
const COUNTRY_RE = /^[A-Z]{2}$/
const CONNECTIONS = "/settings/connections"

export interface FormValues {
  objective: MetaObjective
  /** what the user typed; parsed into ISO codes on submit */
  countriesText: string
  budget: string
  ageMin: string
  ageMax: string
  primaryText: string
  headline: string
  description: string
  callToAction: MetaCallToAction
  link: string
  special: MetaSpecialAdCategory[]
}

export function valuesFromDefaults(d: MetaPublishDefaults, prev?: MetaPublishSettings | null): FormValues {
  const factor = minorFactor(d.currency)
  const minor = prev?.dailyBudgetMinor ?? d.dailyBudgetMinor
  return {
    objective: prev?.objective ?? d.objective,
    countriesText: (prev?.countries ?? d.countries).join(", "),
    budget: minor === null ? "" : String(minor / factor),
    ageMin: String(prev?.ageMin ?? d.ageMin),
    ageMax: String(prev?.ageMax ?? d.ageMax),
    primaryText: prev?.primaryText ?? d.primaryText,
    headline: prev?.headline ?? d.headline ?? "",
    description: prev?.description ?? d.description ?? "",
    callToAction: prev?.callToAction ?? d.callToAction,
    link: prev?.link ?? d.link ?? "",
    special: prev?.specialAdCategories ?? [],
  }
}

export const parseCountries = (text: string) => text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)

type FieldErrors = Partial<Record<"countries" | "budget" | "ages" | "primaryText" | "description" | "link", string>>

function validate(v: FormValues, minMinor: number | null, factor: number, t: ReturnType<typeof useTranslations<"publish.form">>, money: (m: number) => string): { errors: FieldErrors; body: MetaPublishBody | null } {
  const errors: FieldErrors = {}
  const countries = parseCountries(v.countriesText)
  if (!countries.length || countries.length > 10 || countries.some((c) => !COUNTRY_RE.test(c))) errors.countries = t("countriesInvalid")
  const budgetNum = Number(v.budget.replace(",", "."))
  const budgetMinor = Math.round(budgetNum * factor)
  if (!v.budget.trim() || !Number.isFinite(budgetNum) || budgetMinor <= 0) errors.budget = t("budgetInvalid")
  else if (minMinor !== null && budgetMinor < minMinor) errors.budget = t("budgetBelow", { min: money(minMinor) })
  const ageMin = Number(v.ageMin)
  const ageMax = Number(v.ageMax)
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) errors.ages = t("agesInvalid")
  const primaryText = v.primaryText.trim()
  if (!primaryText || primaryText.length > 2000) errors.primaryText = t("primaryInvalid")
  if (v.description.trim().length > 125) errors.description = t("descriptionInvalid")
  const link = v.link.trim()
  if (!/^https?:\/\/\S+$/i.test(link) || link.length > 2048) errors.link = t("linkInvalid")
  if (Object.keys(errors).length) return { errors, body: null }
  const headline = v.headline.trim()
  const description = v.description.trim()
  return {
    errors,
    body: {
      dailyBudgetMinor: budgetMinor, countries, objective: v.objective, primaryText,
      ...(headline ? { headline } : {}), ...(description ? { description } : {}),
      callToAction: v.callToAction, link, specialAdCategories: v.special, ageMin, ageMax,
    },
  }
}

function Field({ label, hint, error, htmlFor, children, optional }: { label: React.ReactNode; hint?: React.ReactNode; error?: string; htmlFor: string; children: React.ReactNode; optional?: boolean }) {
  const t = useTranslations("publish.form")
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>
        {label} {optional ? <span className="font-normal text-fg-3">{t("optional")}</span> : null}
      </Label>
      {children}
      {error ? (
        <span className="text-xs text-status-failed" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-fg-3">{hint}</span>
      ) : null}
    </div>
  )
}

/** The names of the typed country codes, in the UI language ("US" → "United States"). */
function useRegionName() {
  const locale = useLocale()
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([locale], { type: "region" })
  } catch {}
  return (code: string) => {
    if (!COUNTRY_RE.test(code)) return code
    try {
      return names?.of(code) ?? code
    } catch {
      return code
    }
  }
}

export function PublishForm({
  defaults, initial, error, errorAt, pending, onSubmit, onCancel,
}: {
  defaults: MetaPublishDefaults
  initial: FormValues
  /** the error of the last POST /publish (synchronous codes of §3.3) and when it arrived (ms) */
  error: unknown
  errorAt: number | null
  pending: boolean
  onSubmit: (body: MetaPublishBody) => void
  onCancel?: (() => void) | null
}) {
  const t = useTranslations("publish.form")
  const tp = useTranslations("publish")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const money = useMinorMoney(defaults.currency)
  const region = useRegionName()
  const uid = useId()
  const [v, setV] = useState<FormValues>(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [tried, setTried] = useState(false)
  const factor = minorFactor(defaults.currency)

  // synchronous errors of POST /publish (meta-v1 §3.3.1 step 2): each one with its fix
  const apiErr = isApiError(error) ? error : null
  const code = apiErr?.code
  const budgetLow = code === "META_BUDGET_TOO_LOW" ? ((apiErr?.details ?? {}) as Partial<MetaBudgetTooLowDetails>) : null
  const minMinor = budgetLow?.minimumMinor ?? defaults.dailyBudgetMinor
  const unavailable = code === "META_UNAVAILABLE" ? ((apiErr?.details ?? {}) as Partial<MetaUnavailableDetails>) : null
  // `errorAt` is stamped by the caller when the error arrived (an event, not a render): the countdown derives from it
  const now = useNow({ updateInterval: 1000 })
  const waitSec = unavailable && errorAt ? Math.max(0, Math.ceil((errorAt + (unavailable.retryAfterSec ?? 30) * 1000 - now.getTime()) / 1000)) : 0
  const validation = code === "VALIDATION_ERROR" ? ((apiErr?.details ?? {}) as { fields?: { field: string; rule: string }[] }) : null

  const pixelMissing = !defaults.pixel && NEEDS_PIXEL.includes(v.objective)
  const countries = parseCountries(v.countriesText)
  const headlineLong = v.headline.trim().length > 40

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    const r = validate(v, minMinor, factor, t, money)
    setErrors(r.errors)
    if (r.body) onSubmit(r.body)
  }
  const revalidate = (next: FormValues) => {
    if (tried) setErrors(validate(next, minMinor, factor, t, money).errors)
  }
  const update = <K extends keyof FormValues>(k: K, val: FormValues[K]) => {
    const next = { ...v, [k]: val }
    setV(next)
    revalidate(next)
  }

  let apiAlert: React.ReactNode = null
  if (code === "META_PIXEL_REQUIRED") {
    apiAlert = (
      <Alert variant="warning">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("pixelWarnTitle", { objective: t(`objective.${v.objective}`) })}</AlertTitle>
          <AlertDescription>{t("pixelWarnBody")}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" variant="default" onClick={() => update("objective", "OUTCOME_TRAFFIC")}>{t("switchTraffic")}</Button>
          <Link href={CONNECTIONS} className={buttonVariants({ size: "sm" })}>{t("changeInSettings")}</Link>
        </AlertActions>
      </Alert>
    )
  } else if (code === "META_BUDGET_TOO_LOW") {
    apiAlert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("budgetBelow", { min: minMinor === null ? "—" : money(minMinor) })}</AlertTitle>
        </AlertBody>
        {minMinor !== null ? (
          <AlertActions>
            <Button size="sm" variant="default" onClick={() => update("budget", String(minMinor / factor))}>{t("budgetMin", { min: money(minMinor) })}</Button>
          </AlertActions>
        ) : null}
      </Alert>
    )
  } else if (code === "META_TOKEN_INVALID" || code === "META_NOT_CONNECTED" || code === "META_SELECTION_MISSING") {
    apiAlert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{errorMessage(error)}</AlertTitle>
        </AlertBody>
        <AlertActions>
          <Link href={CONNECTIONS} className={buttonVariants({ size: "sm", variant: "default" })}>{tp("sync.reconnect")}</Link>
        </AlertActions>
      </Alert>
    )
  } else if (code === "META_ACCOUNT_UNUSABLE" || code === "META_PERMISSION") {
    const label = (apiErr?.details as { label?: string } | undefined)?.label
    apiAlert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{errorMessage(error)}</AlertTitle>
          {label ? <AlertDescription>{label}</AlertDescription> : null}
        </AlertBody>
        <AlertActions>
          <Link href={CONNECTIONS} className={buttonVariants({ size: "sm", variant: "default" })}>{tp("sync.chooseAccount")}</Link>
        </AlertActions>
      </Alert>
    )
  } else if (code === "META_UNAVAILABLE") {
    apiAlert = (
      <Alert variant="warning">
        <Icon name="clock" />
        <AlertBody>
          <AlertTitle>{waitSec > 0 ? tp("sync.unavailable", { sec: waitSec }) : errorMessage(error)}</AlertTitle>
        </AlertBody>
      </Alert>
    )
  } else if (code === "INVALID_STATE" && (apiErr?.details as { reason?: string } | undefined)?.reason === "publish_in_progress") {
    apiAlert = (
      <Alert variant="info">
        <Icon name="info" />
        <AlertBody>
          <AlertTitle>{tp("sync.inProgress")}</AlertTitle>
        </AlertBody>
      </Alert>
    )
  } else if (error) {
    apiAlert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{errorMessage(error)}</AlertTitle>
          {validation?.fields?.length ? <AlertDescription>{validation.fields.map((f) => f.field).join(", ")}</AlertDescription> : null}
        </AlertBody>
      </Alert>
    )
  }

  const disabled = pending || waitSec > 0
  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5" aria-busy={pending}>
      {apiAlert}

      <section className="grid gap-4 rounded-xl border border-line bg-card p-4 tablet:p-5">
        <h2 className="text-base font-bold">{t("campaign")}</h2>
        <Field htmlFor={`${uid}-obj`} label={t("objectiveLabel")} hint={t(`objectiveReason.${defaults.objectiveReason}`)}>
          <Select value={v.objective} onValueChange={(x) => update("objective", x as MetaObjective)}>
            <SelectTrigger id={`${uid}-obj`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBJECTIVES.map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`objective.${o}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {pixelMissing && code !== "META_PIXEL_REQUIRED" ? (
          <Alert variant="warning">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("pixelWarnTitle", { objective: t(`objective.${v.objective}`) })}</AlertTitle>
              <AlertDescription>{t("pixelWarnBody")}</AlertDescription>
            </AlertBody>
            <AlertActions>
              <Button size="sm" variant="default" onClick={() => update("objective", "OUTCOME_TRAFFIC")}>{t("switchTraffic")}</Button>
            </AlertActions>
          </Alert>
        ) : null}
        <div className="grid gap-4 tablet:grid-cols-2">
          <Field htmlFor={`${uid}-budget`} label={t("budget")} error={errors.budget} hint={minMinor !== null ? t("budgetHint", { min: money(minMinor) }) : t("budgetHintNoMin")}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center font-mono text-[13px] text-fg-3">{defaults.currency ?? "USD"}</span>
              <Input id={`${uid}-budget`} inputMode="decimal" value={v.budget} onChange={(e) => update("budget", e.target.value)} aria-invalid={!!errors.budget} className="pl-14 font-mono" />
            </div>
          </Field>
          <Field htmlFor={`${uid}-agemin`} label={t("ages")} error={errors.ages} hint={t("agesHint")}>
            <div className="flex items-center gap-2">
              <Input id={`${uid}-agemin`} inputMode="numeric" value={v.ageMin} onChange={(e) => update("ageMin", e.target.value)} aria-invalid={!!errors.ages} className="w-20 font-mono" aria-label={t("ageMin")} />
              <span className="text-[13px] text-fg-3">{t("ageTo")}</span>
              <Input inputMode="numeric" value={v.ageMax} onChange={(e) => update("ageMax", e.target.value)} aria-invalid={!!errors.ages} className="w-20 font-mono" aria-label={t("ageMax")} />
            </div>
          </Field>
        </div>
        <Field htmlFor={`${uid}-countries`} label={t("countries")} error={errors.countries} hint={t("countriesHint")}>
          <Input id={`${uid}-countries`} value={v.countriesText} onChange={(e) => update("countriesText", e.target.value)} placeholder="US, BR" aria-invalid={!!errors.countries} className="font-mono uppercase" autoCapitalize="characters" />
          {countries.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("countries")}>
              {countries.map((c, i) => (
                <li key={`${c}-${i}`} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs", COUNTRY_RE.test(c) ? "border-line text-fg-2" : "border-status-failed-edge text-status-failed")}>
                  <span className="font-mono">{c}</span>
                  <span className="text-fg-3">{region(c)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
        <details className="group grid gap-3">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chev" className="mr-1 inline transition-transform group-open:rotate-90" />
            {t("special")}
          </summary>
          <div className="grid gap-2 pl-5">
            <span className="text-xs text-fg-3">{t("specialHint")}</span>
            {SPECIAL.map((s) => {
              const id = `${uid}-sp-${s}`
              const on = v.special.includes(s)
              return (
                <div key={s} className="flex items-center gap-2">
                  <Checkbox id={id} checked={on} onCheckedChange={(c) => update("special", c ? [...v.special, s] : v.special.filter((x) => x !== s))} />
                  <Label htmlFor={id} className="font-normal">{t(`specialCat.${s}`)}</Label>
                </div>
              )
            })}
          </div>
        </details>
      </section>

      <section className="grid gap-4 rounded-xl border border-line bg-card p-4 tablet:p-5">
        <h2 className="text-base font-bold">{t("adText")}</h2>
        <Field htmlFor={`${uid}-primary`} label={t("primaryText")} error={errors.primaryText} hint={t("counter", { n: v.primaryText.length, max: 2000 })}>
          <Textarea id={`${uid}-primary`} rows={4} value={v.primaryText} onChange={(e) => update("primaryText", e.target.value)} aria-invalid={!!errors.primaryText} />
        </Field>
        <div className="grid gap-4 tablet:grid-cols-2">
          <Field htmlFor={`${uid}-headline`} label={t("headline")} optional hint={<span className={cn(headlineLong && "text-status-waiting")}>{headlineLong ? t("headlineLong", { n: v.headline.trim().length }) : t("counter", { n: v.headline.length, max: 40 })}</span>}>
            <Input id={`${uid}-headline`} value={v.headline} onChange={(e) => update("headline", e.target.value)} />
          </Field>
          <Field htmlFor={`${uid}-cta`} label={t("cta")}>
            <Select value={v.callToAction} onValueChange={(x) => update("callToAction", x as MetaCallToAction)}>
              <SelectTrigger id={`${uid}-cta`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CTAS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`ctaLabel.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field htmlFor={`${uid}-desc`} label={t("description")} optional error={errors.description} hint={t("counter", { n: v.description.length, max: 125 })}>
          <Input id={`${uid}-desc`} value={v.description} onChange={(e) => update("description", e.target.value)} aria-invalid={!!errors.description} />
        </Field>
        <Field htmlFor={`${uid}-link`} label={t("link")} error={errors.link} hint={t("linkHint")}>
          <Input id={`${uid}-link`} type="url" inputMode="url" value={v.link} onChange={(e) => update("link", e.target.value)} placeholder="https://" aria-invalid={!!errors.link} className="font-mono" />
        </Field>
        <div className="grid gap-1 border-t border-line-soft pt-3 text-[13px] text-fg-2">
          <div className="flex justify-between gap-3">
            <span className="text-fg-3">{t("page")}</span>
            <span className="truncate">{defaults.page?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-fg-3">{t("pixel")}</span>
            <span className="truncate">{defaults.pixel?.name ?? t("noPixel")}</span>
          </div>
          <Link href={CONNECTIONS} className="justify-self-start text-xs font-semibold text-fg underline-offset-2 hover:underline">{t("changeInSettings")}</Link>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="brand" size="lg" disabled={disabled} aria-busy={pending} className="w-full tablet:w-auto">
          {pending ? <span className="spin-ring size-4" aria-hidden="true" /> : <Icon name="upload" />}
          {pending ? t("submitting") : t("submit")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
            {tc("cancel")}
          </Button>
        ) : null}
        <span className="text-[13px] text-fg-3">{t("nothingSpends")}</span>
      </div>
    </form>
  )
}
