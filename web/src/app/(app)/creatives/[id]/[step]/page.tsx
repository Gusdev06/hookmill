"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import { STEPS, type Step } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { EmptyState, Page } from "@/components/page"
import { useCreative, useCreativeEvents } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { Banner } from "@/components/wizard/common"
import { stepHref, WizardFrame } from "@/components/wizard/shell"
import { OfferStep } from "@/components/wizard/offer-step"
import { ScriptsStep } from "@/components/wizard/scripts-step"
import { AvatarStep } from "@/components/wizard/avatar-step"
import { EngineStep } from "@/components/wizard/engine-step"
import { GenerationStep } from "@/components/wizard/generation-step"
import { EditStep } from "@/components/wizard/edit-step"
import { ReviewStep } from "@/components/wizard/review-step"

/** Wizard route /creatives/:id/:step (spec §5). Opens on any done/current step; a "todo" step redirects to the current one. */
export default function CreativeStepPage() {
  const { id, step } = useParams<{ id: string; step: string }>()
  const t = useTranslations("wizard")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const q = useCreative(id)
  const live = useCreativeEvents(q.data ? id : null)
  const viewing = (STEPS as readonly string[]).includes(step) ? (step as Step) : null
  const c = q.data

  useEffect(() => {
    if (!c) return
    if (c.step === "library" && viewing !== "review") return router.replace(`/library?new=${encodeURIComponent(c.id)}`)
    const info = c.steps.find((s) => s.step === viewing)
    if (!viewing || info?.state === "todo") router.replace(stepHref(c.id, c.step === "library" ? "review" : c.step))
  }, [c, viewing, router])

  if (q.isError) {
    const nf = isApiError(q.error) && q.error.status === 404
    return (
      <Page>
        {nf ? (
          <EmptyState>
            <h2>{t("notFoundTitle")}</h2>
            <p className="text-fg-2">{t("notFoundBody")}</p>
            <div>
              <Link href="/" className={buttonVariants()}>
                <Icon name="left" />
                {t("backHome")}
              </Link>
            </div>
          </EmptyState>
        ) : (
          <Banner kind="error" title={t("loadErrorTitle")} body={errorMessage(q.error)} actions={<Button size="sm" onClick={() => q.refetch()}><Icon name="refresh" />{tc("retry")}</Button>} />
        )}
      </Page>
    )
  }

  if (!c || !viewing) {
    return (
      <WizardFrame creative={null} viewing={viewing ?? "offer"}>
        <div className="grid gap-4" role="status" aria-label="…">
          <span className="sk h-7 w-48" />
          <span className="sk h-4 w-96 max-w-full" />
          <span className="sk h-64 rounded-lg" />
        </div>
      </WizardFrame>
    )
  }

  const props = { creative: c, live }
  return (
    <Suspense>
      {viewing === "offer" ? <OfferStep creative={c} />
        : viewing === "scripts" ? <ScriptsStep {...props} />
        : viewing === "avatar" ? <AvatarStep {...props} />
        : viewing === "engine" ? <EngineStep {...props} />
        : viewing === "generation" ? <GenerationStep {...props} />
        : viewing === "edit" ? <EditStep {...props} />
        : <ReviewStep {...props} />}
    </Suspense>
  )
}
