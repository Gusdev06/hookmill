"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"

/*
 * R1 (ads-research-v1 §6.1, proposal the build follows): a competitor's ad CAN go into an Edit template, which republishes
 * their footage, but only after this warning. Nothing is blocked (D1, rights = THIRD_PARTY). Templates calls
 * `guard(needed, go)`: with `needed` false it just runs `go`.
 */
export function useCompetitorAdGuard() {
  const t = useTranslations("radar.r1")
  const [pending, setPending] = useState<(() => void) | null>(null)
  const guard = (needed: boolean, go: () => void) => (needed ? setPending(() => go) : go())
  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <NavIcon name="alert" size={18} className="text-status-waiting" />
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button
            variant="default"
            onClick={() => {
              const go = pending
              setPending(null)
              go?.()
            }}
          >
            {t("ack")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { guard, dialog }
}
