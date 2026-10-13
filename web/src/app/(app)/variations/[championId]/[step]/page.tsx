"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import { VARIAR_STEPS, variarHref, type VariarStep } from "@/lib/routes"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { EmptyState, Page } from "@/components/page"
import { Banner } from "@/components/wizard/common"
import { VariarFrameSkeleton } from "@/components/variar/frame"
import { WinnerStep } from "@/components/variar/winner-step"
import { TeardownStep } from "@/components/variar/teardown-step"
import { TypesStep } from "@/components/variar/types-step"
import { HooksStep } from "@/components/variar/hooks-step"
import { EstimateStep } from "@/components/variar/estimate-step"
import { BatchStep } from "@/components/variar/batch-step"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useBatch, useChampion, useChampionBatches } from "@/hooks/use-variar"

const BATCH_STEPS: VariarStep[] = ["hooks", "estimate", "batch"]

export default function VariarStepPage() {
  return (
    <Suspense fallback={<VariarFrameSkeleton viewing="winner" />}>
      <VariarStepRoute />
    </Suspense>
  )
}

/** /variations/:championId/:step[?batch=] (spec §5). Batch steps without ?batch fall back to the latest batch. */
function VariarStepRoute() {
  const { championId, step } = useParams<{ championId: string; step: string }>()
  const batchParam = useSearchParams().get("batch")
  const router = useRouter()
  const t = useTranslations("variar")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const viewing = (VARIAR_STEPS as readonly string[]).includes(step) ? (step as VariarStep) : null
  const needsBatch = !!viewing && BATCH_STEPS.includes(viewing)
  const c = useChampion(championId)
  const list = useChampionBatches(needsBatch && !batchParam ? championId : null)
  const b = useBatch(batchParam)

  useEffect(() => {
    if (!viewing) router.replace(variarHref(championId, "teardown"))
    else if (needsBatch && !batchParam && list.data) {
      const latest = list.data[0]
      router.replace(latest ? variarHref(championId, viewing, latest.id) : variarHref(championId, "variations"))
    }
  }, [viewing, needsBatch, batchParam, list.data, championId, router])

  const err = c.error ?? b.error
  if (err) {
    const nf = isApiError(err) && err.status === 404
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
          <Banner kind="error" title={errorMessage(err)} actions={<Button size="sm" onClick={() => (c.error ? c.refetch() : b.refetch())}><Icon name="refresh" />{tc("retry")}</Button>} />
        )}
      </Page>
    )
  }
  if (!viewing || !c.data || (needsBatch && !b.data)) return <VariarFrameSkeleton viewing={viewing ?? "winner"} />

  const champion = c.data
  switch (viewing) {
    case "winner":
      return <WinnerStep champion={champion} />
    case "teardown":
      return <TeardownStep champion={champion} />
    case "variations":
      return <TypesStep champion={champion} />
    case "hooks":
      return <HooksStep champion={champion} batch={b.data!} />
    case "estimate":
      return <EstimateStep champion={champion} batch={b.data!} />
    case "batch":
      return <BatchStep champion={champion} batch={b.data!} />
  }
}
