"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { api } from "@/lib/api/client"
import type { AccountMode } from "@/lib/api/types"
import { Alert, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { choiceCardClass } from "@/components/ui/choice-card"
import { Icon } from "@/components/icon"
import { NavIcon } from "@/components/shell/nav-icon"
import { MinimalShell } from "@/components/shell/minimal-shell"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { ActionBar } from "@/components/onboarding/action-bar"
import { onboardingHref } from "@/components/onboarding/shared"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ME_KEY, useMe } from "@/hooks/use-me"
import { getSession, setSession } from "@/lib/session/token"
import { cn } from "@/lib/utils"

/*
 * /start · "How will you use HookMill?" (onboarding-v2 §3.1, D8; spec decision 1). Shown once, right after the signup,
 * when `user.accountMode == null` and the person is OWNER of the active workspace (the gate in the shell sends here).
 * Continue = PATCH /auth/me { accountMode }. Then the setup, step 1, where the business / first client gets its name
 * (review 29/10 L3: the name is asked once, in step 1, pre-filled by the site reading).
 */
const MODES: { id: AccountMode; icon: "bld" | "user"; items: 3 }[] = [
  { id: "AGENCY", icon: "bld", items: 3 },
  { id: "OWN", icon: "user", items: 3 },
]

export default function StartPage() {
  const t = useTranslations("welcome")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const qc = useQueryClient()
  const { session, logout } = useSession()
  const me = useMe()
  const [pick, setPick] = useState<AccountMode | null>(null)
  const workspace = me.data?.workspace ?? session.workspace

  const save = useMutation({
    mutationFn: (mode: AccountMode) => api.auth.updateMe({ accountMode: mode }),
    onSuccess: async (user) => {
      const s = getSession()
      if (s) setSession({ ...s, user: { ...s.user, accountMode: user.accountMode ?? pick } })
      await qc.invalidateQueries({ queryKey: ME_KEY })
      router.replace(onboardingHref(workspace.onboarding?.step ?? 1))
    },
  })

  const hint = pick === "AGENCY" ? t("hintAgency") : pick === "OWN" ? t("hintOwn") : t("pick")

  return (
    // L5: whoever came in with the wrong account has a way out (same logout as the setup's "Save and exit")
    <MinimalShell
      right={
        <>
          <LanguageToggle persist />
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {tc("logout")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t("eyebrow", { name: session.user.name.split(" ")[0] })}</span>
        <h1 className="text-pretty">{t("title")}</h1>
        <p className="m-0 max-w-[640px] text-fg-3 text-pretty">{t("sub")}</p>
      </div>
      {save.isError ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{errorMessage(save.error)}</AlertTitle>
          </AlertBody>
        </Alert>
      ) : null}
      <RadioGroupPrimitive.Root value={pick ?? ""} onValueChange={(v) => setPick(v as AccountMode)} aria-label={t("ariaMode")} className="grid grid-cols-[minmax(0,1fr)] gap-3.5 tablet:grid-cols-2">
        {MODES.map((m) => {
          const on = pick === m.id
          const k = m.id === "AGENCY" ? "agency" : "own"
          return (
            <RadioGroupPrimitive.Item
              key={m.id}
              value={m.id}
              className={choiceCardClass(on, "relative flex min-h-11 flex-col gap-3 p-[22px] tablet:min-h-[230px]")}
            >
              <span aria-hidden="true" className={cn("absolute top-4 right-4 inline-grid size-5 place-items-center rounded-full border-[1.5px]", on ? "border-fg" : "border-control")}>
                {on ? <span className="size-2.5 rounded-full bg-fg" /> : null}
              </span>
              <span aria-hidden="true" className={cn("inline-grid size-11 place-items-center rounded-btn", on ? "bg-brand text-[#15171a]" : "bg-card-2 text-fg")}>
                <NavIcon name={m.icon} size={22} />
              </span>
              <span className="wide text-[19px]">{t(`${k}.title`)}</span>
              <span className="text-fg-2">{t(`${k}.sub`)}</span>
              <ul className="m-0 grid gap-1 pl-[18px] text-[13px] text-fg-3">
                <li>{t(`${k}.i1`)}</li>
                <li>{t(`${k}.i2`)}</li>
                <li>{t(`${k}.i3`)}</li>
              </ul>
            </RadioGroupPrimitive.Item>
          )
        })}
      </RadioGroupPrimitive.Root>
      <ActionBar
        hint={hint}
        primary={
          <Button variant="brand" size="lg" disabled={!pick || save.isPending} aria-busy={save.isPending} onClick={() => pick && save.mutate(pick)}>
            {t("continue")}
            <Icon name="arrowr" />
          </Button>
        }
      />
    </MinimalShell>
  )
}
