"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { setSession, toClientSession } from "@/lib/session/token"

const SHOW_MOCK_HINT = process.env.NEXT_PUBLIC_API_MOCKING === "enabled" && process.env.NODE_ENV !== "production"

export function LoginForm() {
  const t = useTranslations()
  const router = useRouter()
  const next = useSearchParams().get("next")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const submit = (form: FormData) => {
    setError(null)
    start(async () => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      }).catch(() => null)
      if (!res) return setError(t("errors.NETWORK"))
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const pw = document.getElementById("password") as HTMLInputElement | null
        if (pw) pw.value = ""
        const code = json?.error?.code as string | undefined
        return setError(code && t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t("errors.fallback"))
      }
      setSession(toClientSession(json))
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
      router.replace(dest)
      router.refresh()
    })
  }

  return (
    <form action={submit} className="grid w-full max-w-[360px] grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-1">
        <h1>{t("login.title")}</h1>
        <p className="text-fg-2">{t("login.subtitle")}</p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{error}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("login.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("login.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" variant="default" size="lg" disabled={pending} className="w-full">
        {pending ? t("login.submitting") : t("login.submit")}
      </Button>
      <p className="text-center text-[13px] text-fg-2">
        {t("login.newHere")}{" "}
        <Link href="/signup" className="font-semibold text-fg underline underline-offset-2 hover:text-brand-ink">
          {t("login.createAccount")}
        </Link>
      </p>
      {SHOW_MOCK_HINT ? (
        <p className="rounded-sm border border-dashed border-line-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-3">
          {t("login.mockHint", { email: "gusta@maquina.dev", password: "maquina123" })}
        </p>
      ) : null}
    </form>
  )
}
