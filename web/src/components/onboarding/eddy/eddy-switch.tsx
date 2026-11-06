"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { ONBOARDING_EDDY } from "@/lib/flags"
import { OnboardingError, OnboardingLoading } from "../shared"
import { EddyOnboarding } from "./eddy-onboarding"

/**
 * Flag NEXT_PUBLIC_ONBOARDING_EDDY=on: a client still in setup talks to Eddy on every /onboarding/:step (the Meta OAuth
 * comes back to /onboarding/meta and lands in the same conversation). A finished setup keeps the wizard ("Edit setup").
 * The choice is made once per visit, so finishing with Eddy doesn't swap the screen under the "Done" message.
 */
export function EddyOrWizard({ wizard }: { wizard: React.ReactNode }) {
  if (!ONBOARDING_EDDY) return wizard
  return <Switch wizard={wizard} />
}

function Switch({ wizard }: { wizard: React.ReactNode }) {
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const [eddy, setEddy] = useState<boolean | null>(null)
  if (eddy === null && ws.data) setEddy(!ws.data.onboarding.completedAt)
  if (eddy === null) return ws.isError ? <OnboardingError error={ws.error} retry={() => ws.refetch()} /> : <OnboardingLoading />
  return eddy ? <EddyOnboarding /> : wizard
}
