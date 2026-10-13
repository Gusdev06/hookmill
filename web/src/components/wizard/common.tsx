"use client"

import { useCallback, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Icon, type IconName } from "@/components/icon"
import { cn } from "@/lib/utils"

/** mockup .banner via shadcn Alert */
export function Banner({
  kind = "info", icon, title, body, actions, className,
}: { kind?: "info" | "error"; icon?: IconName; title: React.ReactNode; body?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <Alert variant={kind === "error" ? "destructive" : "default"} className={className}>
      <Icon name={icon ?? (kind === "error" ? "alert" : "info")} />
      <AlertBody>
        <AlertTitle>{title}</AlertTitle>
        {body ? <AlertDescription>{body}</AlertDescription> : null}
      </AlertBody>
      {actions ? <AlertActions>{actions}</AlertActions> : null}
    </Alert>
  )
}

/** The radio dot used by the card-style radios (mockup .radio). */
export function RadioDot({ on }: { on: boolean }) {
  return (
    <span className={cn("mt-0.5 grid size-4 flex-none place-items-center rounded-full border", on ? "border-fg" : "border-line-2")} aria-hidden="true">
      {on ? <span className="size-2 rounded-full bg-fg" /> : null}
    </span>
  )
}

/** mockup .memo: icon + small explanatory line */
export function Memo({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[13px] text-fg-2 [&_b]:font-medium [&_b]:text-fg">
      <Icon name={icon} className="mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

type Details = { scenesLost: number; rendersLost: number; spentUsd: number }

/**
 * CONFIRM_DOWNSTREAM_RESET (contract §1): run an action; if the API says it discards generated work,
 * ask, then resend with confirm: true.
 */
export function useConfirmReset() {
  const t = useTranslations("wizard")
  const format = useFormatter()
  const [pending, setPending] = useState<{ details: Details; resolve: (ok: boolean) => void } | null>(null)
  const busy = useRef(false)

  const run = useCallback(async <T,>(action: (confirm: boolean) => Promise<T>): Promise<T | null> => {
    try {
      return await action(false)
    } catch (e) {
      if (!isApiError(e) || e.code !== "CONFIRM_DOWNSTREAM_RESET" || busy.current) throw e
      busy.current = true
      const ok = await new Promise<boolean>((resolve) => setPending({ details: (e.details ?? {}) as Details, resolve }))
      busy.current = false
      setPending(null)
      return ok ? action(true) : null
    }
  }, [])

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && pending?.resolve(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? t("confirmBody", {
                  scenes: pending.details.scenesLost ?? 0,
                  renders: pending.details.rendersLost ?? 0,
                  spent: format.number(pending.details.spentUsd ?? 0, { style: "currency", currency: "USD" }),
                })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Radix focuses Cancel first; destructive stays below on mobile */}
          <AlertDialogCancel onClick={() => pending?.resolve(false)}>{t("keepAsIs")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => pending?.resolve(true)}>{t("discardRedo")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { run, dialog }
}

export function useMoney() {
  const format = useFormatter()
  return (v: number) => format.number(v, { style: "currency", currency: "USD" })
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
