"use client"

import { useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { isApiError } from "@/lib/api/errors"
import { signup } from "@/lib/session/token"
import { toUiLocale, toLocale } from "@/i18n/config"
import { onboardingHref } from "@/components/onboarding/shared"

type Field = "name" | "email" | "password" | "agencyName"
const FIELDS: Field[] = ["name", "email", "password", "agencyName"]

export function SignupForm() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "", agencyName: "" })
  const [fieldErr, setFieldErr] = useState<Partial<Record<Field, string>>>({})
  const [emailTaken, setEmailTaken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setValues((s) => ({ ...s, [f]: v }))
    if (fieldErr[f]) setFieldErr((s) => ({ ...s, [f]: undefined }))
    if (f === "email") setEmailTaken(false)
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setFieldErr({})
    setEmailTaken(false)
    // the API is the judge; this only saves a round trip on the obvious one
    if (values.password.length < 10) {
      setFieldErr({ password: t("signup.errors.passwordShort") })
      document.getElementById("password")?.focus()
      return
    }
    start(async () => {
      try {
        await signup({
          name: values.name.trim(),
          email: values.email.trim(),
          password: values.password,
          ...(values.agencyName.trim() ? { agencyName: values.agencyName.trim() } : {}),
          uiLocale: toUiLocale(toLocale(locale)),
        })
        // contract "/onboarding/1" = step 1 of the onboarding, whose route is a slug (/onboarding/business)
        router.replace(onboardingHref(1))
        router.refresh()
      } catch (err) {
        if (!isApiError(err)) return setError(t("errors.fallback"))
        switch (err.code) {
          case "EMAIL_TAKEN":
            setEmailTaken(true)
            document.getElementById("email")?.focus()
            return
          case "VALIDATION_ERROR": {
            const list = (err.details?.fields as { field: string; rule: string }[] | undefined) ?? []
            const next: Partial<Record<Field, string>> = {}
            for (const { field } of list) {
              if ((FIELDS as string[]).includes(field) && !next[field as Field]) next[field as Field] = t(`signup.errors.${field as Field}`)
            }
            if (Object.keys(next).length) {
              setFieldErr(next)
              document.getElementById(FIELDS.find((f) => next[f]) ?? "name")?.focus()
            } else setError(t("errors.VALIDATION_ERROR"))
            return
          }
          case "RATE_LIMITED": {
            const sec = Number(err.details?.retryAfterSec)
            return setError(Number.isFinite(sec) && sec > 0 ? t("signup.errors.rateLimited", { sec: Math.ceil(sec) }) : t("errors.RATE_LIMITED"))
          }
          case "FORBIDDEN":
            return setError(t("signup.errors.closed"))
          default:
            return setError(t.has(`errors.${err.code}` as never) ? t(`errors.${err.code}` as never) : t("errors.fallback"))
        }
      }
    })
  }

  const describe = (f: Field, hint?: boolean) =>
    [fieldErr[f] || (f === "email" && emailTaken) ? `${f}-err` : null, hint ? `${f}-hint` : null].filter(Boolean).join(" ") || undefined

  return (
    <form onSubmit={submit} className="grid w-full max-w-[380px] grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-1">
        <h1>{t("signup.title")}</h1>
        <p className="text-fg-2">{t("signup.subtitle")}</p>
      </div>
      {error ? (
        <Alert variant="destructive" role="alert">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{error}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="name">{t("signup.name")}</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={120} autoFocus value={values.name} onChange={set("name")} aria-invalid={!!fieldErr.name || undefined} aria-describedby={describe("name")} />
        {fieldErr.name ? <FieldError id="name-err">{fieldErr.name}</FieldError> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("signup.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={values.email} onChange={set("email")} aria-invalid={!!fieldErr.email || emailTaken || undefined} aria-describedby={describe("email")} />
        {emailTaken ? (
          <FieldError id="email-err">
            {t("signup.errors.emailTaken")}{" "}
            <Link href="/login" className="font-semibold text-fg underline underline-offset-2 hover:text-brand-ink">
              {t("signup.logIn")}
            </Link>
          </FieldError>
        ) : fieldErr.email ? (
          <FieldError id="email-err">{fieldErr.email}</FieldError>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("signup.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required maxLength={200} value={values.password} onChange={set("password")} aria-invalid={!!fieldErr.password || undefined} aria-describedby={describe("password", true)} />
        {fieldErr.password ? <FieldError id="password-err">{fieldErr.password}</FieldError> : <span id="password-hint" className="text-xs text-fg-3">{t("signup.passwordHint")}</span>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agencyName">
          {t("signup.agencyName")} <span className="font-normal text-fg-3">{t("signup.optional")}</span>
        </Label>
        <Input id="agencyName" name="agencyName" autoComplete="organization" maxLength={80} placeholder={t("signup.agencyPlaceholder")} value={values.agencyName} onChange={set("agencyName")} aria-invalid={!!fieldErr.agencyName || undefined} aria-describedby={describe("agencyName", true)} />
        {fieldErr.agencyName ? <FieldError id="agencyName-err">{fieldErr.agencyName}</FieldError> : <span id="agencyName-hint" className="text-xs text-fg-3">{t("signup.agencyHint")}</span>}
      </div>
      <Button type="submit" variant="default" size="lg" disabled={pending} className="w-full">
        {pending ? t("signup.submitting") : t("signup.submit")}
      </Button>
      <p className="text-center text-[13px] text-fg-2">
        {t("signup.haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-fg underline underline-offset-2 hover:text-brand-ink">
          {t("signup.logIn")}
        </Link>
      </p>
    </form>
  )
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span id={id} className="text-xs font-medium text-status-failed">
      {children}
    </span>
  )
}
