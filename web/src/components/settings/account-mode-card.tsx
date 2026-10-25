"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { AccountMode } from "@/lib/api/types"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useAccountMode, useInvalidateMe, useMe } from "@/hooks/use-me"
import { getSession, setSession } from "@/lib/session/token"

/*
 * Settings › Account mode (onboarding-v2 §3.1, D9): PATCH /auth/me { accountMode }. OWN → AGENCY never fails and creates
 * nothing (the workspace becomes the first client). AGENCY → OWN is allowed even with several workspaces: the shell hides
 * the selector and the person stays in the active one; the card warns about the N other clients.
 */
export function AccountModeCard() {
  const t = useTranslations("settings.accountMode")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const mode = useAccountMode()
  const me = useMe()
  const invalidateMe = useInvalidateMe()
  const [open, setOpen] = useState(false)
  const target: AccountMode = mode === "OWN" ? "AGENCY" : "OWN"
  const others = Math.max(0, (me.data?.workspaces.length ?? 1) - 1)
  const change = useMutation({
    mutationFn: () => api.auth.updateMe({ accountMode: target }),
    onSuccess: (user) => {
      const s = getSession()
      if (s) setSession({ ...s, user: { ...s.user, accountMode: user.accountMode ?? target } })
      invalidateMe()
      toast(t("changed", { mode: t(target === "OWN" ? "own" : "agency") }))
      router.refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 tablet:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-base font-bold">{t("title")}</h2>
        <span className="inline-flex h-fit items-center rounded-full border border-line-soft bg-card-2 px-2 py-[3px] text-[11px] font-bold whitespace-nowrap text-fg-2">{t(mode === "OWN" ? "own" : "agency")}</span>
      </div>
      <p className="m-0 text-[13px] text-fg-3 text-pretty">{mode === "OWN" ? t("bodyOwn") : others ? t("bodyAgencyMany", { count: others }) : t("bodyAgency")}</p>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)} disabled={change.isPending} aria-busy={change.isPending}>
          {t(target === "OWN" ? "switchOwn" : "switchAgency")}
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(target === "OWN" ? "switchOwn" : "switchAgency")}</AlertDialogTitle>
            <AlertDialogDescription>{target === "OWN" ? (others ? t("confirmOwnMany", { count: others }) : t("confirmOwn")) : t("confirmAgency")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => change.mutate()}>{t("confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
