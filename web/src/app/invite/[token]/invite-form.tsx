"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { setSession, toClientSession } from "@/lib/session/token"

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations()
  const router = useRouter()
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api.auth.invite(token), retry: false })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (info.isPending) {
    return (
      <div className="grid w-full max-w-[360px] gap-4" role="status">
        <span className="sk h-7 w-2/3" />
        <span className="sk h-4" />
        <span className="sk h-[34px]" />
        <span className="sk h-[34px]" />
      </div>
    )
  }
  if (info.isError) {
    const invalid = isApiError(info.error) && info.error.code === "INVITE_INVALID"
    return (
      <div className="grid w-full max-w-[360px] gap-4">
        <h1>{invalid ? t("invite.invalidTitle") : t("errors.fallback")}</h1>
        <p className="text-fg-2">{invalid ? t("invite.invalidBody") : null}</p>
        <div>
          <Link href="/login" className={buttonVariants()}>
            {t("invite.goLogin")}
          </Link>
        </div>
      </div>
    )
  }
  const inv = info.data

  const submit = (form: FormData) => {
    setError(null)
    start(async () => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken: token, name: form.get("name"), password: form.get("password") }),
      }).catch(() => null)
      if (!res) return setError(t("errors.NETWORK"))
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const code = json?.error?.code as string | undefined
        return setError(code && t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t("errors.fallback"))
      }
      setSession(toClientSession(json))
      router.replace("/")
      router.refresh()
    })
  }

  return (
    <form action={submit} className="grid w-full max-w-[360px] grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-1">
        <h1>{t("invite.title", { workspace: inv.workspaceName })}</h1>
        <p className="text-fg-2">{t("invite.sub", { role: t(`settings.roles.${inv.role}`), email: inv.email })}</p>
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
        <Label htmlFor="name">{t("invite.name")}</Label>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("invite.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <span className="text-xs text-fg-3">{t("invite.passwordHint")}</span>
      </div>
      <Button type="submit" variant="default" size="lg" disabled={pending} className="w-full">
        {pending ? t("invite.submitting") : t("invite.submit")}
      </Button>
    </form>
  )
}
