"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { ClientStatus } from "@/lib/api/types"
import { switchWorkspace } from "@/lib/session/token"
import { clientHref } from "@/components/onboarding/shared"

/** Opening a client = switching the session to it (PUT /api/session) and going to its setup step or Home; the gate takes over from there. */
export function useOpenClient() {
  const t = useTranslations("clients")
  const router = useRouter()
  const qc = useQueryClient()
  const [pending, start] = useTransition()
  const [opening, setOpening] = useState<string | null>(null)
  const open = (c: { id: string; isActive?: boolean; status: ClientStatus; onboarding: { step: number; completedAt: string | null } }) => {
    setOpening(c.id)
    start(async () => {
      try {
        if (!c.isActive) {
          await switchWorkspace(c.id)
          qc.clear()
        }
        router.push(clientHref(c))
      } catch {
        setOpening(null)
        toast.error(t("openFailed"))
      }
    })
  }
  return { open, pending, opening }
}
