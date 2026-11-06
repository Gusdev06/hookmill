"use client"

import { useEffect } from "react"
import { notFound, useParams, useRouter } from "next/navigation"
import { HIDDEN_STEPS, nextStepOf, onboardingHref, ONBOARDING_SLUGS, OnboardingError, OnboardingLoading, stepOf, useOnboarding, type OnboardingSlug } from "@/components/onboarding/shared"
import { BusinessStep } from "@/components/onboarding/business-step"
import { MetaStep } from "@/components/onboarding/meta-step"
import { AudienceStep, ProductStep } from "@/components/onboarding/offer-steps"
import { BrainStep, GoalsStep } from "@/components/onboarding/goals-brain-steps"
import { EddyOrWizard } from "@/components/onboarding/eddy/eddy-switch"

/** Client onboarding /onboarding/:step (fase2-agencia §3.3) on the active workspace; Eddy's conversation behind the flag. */
export default function OnboardingPage() {
  return <EddyOrWizard wizard={<WizardStepPage />} />
}

function WizardStepPage() {
  const { step } = useParams<{ step: string }>()
  const ctx = useOnboarding()
  if (!ONBOARDING_SLUGS.includes(step as OnboardingSlug)) notFound()
  const slug = step as OnboardingSlug
  const hidden = HIDDEN_STEPS.has(slug)
  const router = useRouter()
  const wsData = ctx.ws.data
  // a hidden step (goals, 31/10) is skipped: an old link or a saved resume point lands on the next visible step
  useEffect(() => {
    if (hidden && wsData) router.replace(onboardingHref(nextStepOf(wsData, stepOf(slug))))
  }, [hidden, wsData, slug, router])

  const failed = [ctx.ws, ctx.offers].find((q) => q.isError && !q.data)
  if (failed) return <OnboardingError error={failed.error} retry={() => [ctx.ws, ctx.offers].forEach((q) => q.refetch())} />
  const ws = ctx.ws.data
  if (!ws || !ctx.offers.data) return <OnboardingLoading />

  // keyed by workspace (+ offer for the brief steps): drafts start from the saved data
  if (hidden) return <OnboardingLoading />
  const key = `${ws.id}:${ctx.offer?.id ?? "none"}`
  switch (slug) {
    case "business":
      return <BusinessStep key={ws.id} ws={ws} ctx={ctx} />
    case "meta":
      return <MetaStep ws={ws} ctx={ctx} />
    case "offer":
      return <ProductStep key={key} ws={ws} ctx={ctx} />
    case "audience":
      return <AudienceStep key={key} ws={ws} ctx={ctx} />
    case "goals": // hidden (HIDDEN_STEPS); kept to come back
      return <GoalsStep key={ws.id} ws={ws} ctx={ctx} />
    case "brain":
      return <BrainStep key={ws.id} ws={ws} ctx={ctx} />
  }
}
