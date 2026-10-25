"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { OnboardingError, OnboardingLoading, onboardingHref } from "@/components/onboarding/shared"

/** /onboarding without a step (onboarding-v2 §3.3): in setup → the saved step; done → step 1 in edit mode. */
export default function OnboardingIndexPage() {
  const router = useRouter()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  useEffect(() => {
    if (ws.data) router.replace(ws.data.onboarding.completedAt ? onboardingHref(1) : onboardingHref(ws.data.onboarding.step))
  }, [ws.data, router])
  if (ws.isError && !ws.data) return <OnboardingError error={ws.error} retry={() => ws.refetch()} />
  return <OnboardingLoading />
}
