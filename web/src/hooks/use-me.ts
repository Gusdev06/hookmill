"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { AccountMode, MeResponse } from "@/lib/api/types"
import { useSession } from "@/components/providers/session-provider"

/*
 * GET /auth/me is the one source for the entry rules of onboarding-v2 (§3.1, §3.2, §3.4, §3.5): `user.accountMode`,
 * `workspace.status` + `onboarding` (gate, "Setup 33 %" in the selector) and `workspace.tourCompletedAt` (tour).
 * Shared cache key ["me"]; invalidate it after PATCH /auth/me, PATCH /workspace, onboarding/complete and tour/complete.
 */
export const ME_KEY = ["me"] as const

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api.auth.me(), staleTime: 60_000 })
}

/** null (not answered) is treated as AGENCY everywhere but on /start (contract §3.1). */
export function accountModeOf(me: MeResponse | undefined, fallback: AccountMode | null | undefined): AccountMode {
  const v = me?.user.accountMode ?? fallback ?? null
  return v === "OWN" ? "OWN" : "AGENCY"
}

/** The effective account mode for the shell: OWN hides the client selector, Clients and New client. */
export function useAccountMode(): AccountMode {
  const { session } = useSession()
  const me = useMe()
  return accountModeOf(me.data, session.user.accountMode)
}

export function useInvalidateMe() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ME_KEY })
}
