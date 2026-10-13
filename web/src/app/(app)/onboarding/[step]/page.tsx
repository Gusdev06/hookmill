"use client"

import { useParams } from "next/navigation"
import { notFound } from "next/navigation"
import { ONBOARDING_SLUGS, OnboardingError, OnboardingLoading, useOnboarding, type OnboardingSlug } from "@/components/onboarding/shared"
import { BusinessStep } from "@/components/onboarding/business-step"
import { MetaStep } from "@/components/onboarding/meta-step"
import { AudienceStep, ProductStep } from "@/components/onboarding/offer-steps"
import { BrainStep, GoalsStep } from "@/components/onboarding/goals-brain-steps"

/** Client onboarding /onboarding/:step (fase2-agencia §3.3) on the active workspace. */
export default function OnboardingPage() {
  const { step } = useParams<{ step: string }>()
  const ctx = useOnboarding()
  if (!ONBOARDING_SLUGS.includes(step as OnboardingSlug)) notFound()
  const slug = step as OnboardingSlug

  const failed = [ctx.ws, ctx.offers].find((q) => q.isError && !q.data)
  if (failed) return <OnboardingError error={failed.error} retry={() => [ctx.ws, ctx.offers].forEach((q) => q.refetch())} />
  const ws = ctx.ws.data
  if (!ws || !ctx.offers.data) return <OnboardingLoading />

  // keyed by workspace (+ offer for the brief steps): drafts start from the saved data
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
    case "goals":
      return <GoalsStep key={ws.id} ws={ws} ctx={ctx} />
    case "brain":
      return <BrainStep key={ws.id} ws={ws} ctx={ctx} />
  }
}
