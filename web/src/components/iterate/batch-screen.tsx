"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import type { IterateBatch } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useIterate } from "@/hooks/use-iterate"
import { AnalyzeScreen } from "./analyze-screen"
import { DownloadScreen } from "./download-screen"
import { GenerateScreen } from "./generate-screen"
import { Card, Cols, IterFlow, IterWrap } from "./parts"

/**
 * /iterate/:batchId — Analyze → Generate → Download on one route; the FlowBar follows the batch phase (spec §4).
 * `?view=` only shows a step the phase already reached (Generate after the end, Download with a failed piece).
 */
export function BatchScreen({ id }: { id: string }) {
  const q = useIterate(id)
  const view = useSearchParams().get("view")
  if (q.isPending) return <BatchSkeleton />
  if (q.isError && !q.data) return <BatchError error={q.error} onRetry={() => q.refetch()} />
  const b = q.data
  return pick(b, view)
}

function pick(b: IterateBatch, view: string | null) {
  if (b.status !== "LAUNCHED") return <AnalyzeScreen batch={b} />
  const failed = b.pieces.some((p) => p.status === "failed")
  if (view === "download" && (b.phase === "download" || failed)) return <DownloadScreen batch={b} />
  if (view === "generate" || b.phase === "generate") return <GenerateScreen batch={b} />
  return <DownloadScreen batch={b} />
}

/** Loading: Skeleton in the same layout (spec §4.1 "Carregando a tela"). */
function BatchSkeleton() {
  return (
    <IterWrap>
      <IterFlow current="analyze" />
      <div className="flex flex-col gap-2" role="status" aria-label="…">
        <span className="sk h-3 w-40" />
        <span className="sk h-8 w-80 max-w-full" />
      </div>
      <Cols
        main={
          <>
            <Card>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-4 tablet:grid-cols-[120px_minmax(0,1fr)]">
                <span className="sk aspect-[9/16] rounded-[10px]" />
                <div className="flex flex-col gap-2.5">
                  <span className="sk h-4 w-1/2" />
                  <span className="sk h-3 w-3/4" />
                  <span className="sk h-7 w-full" />
                </div>
              </div>
            </Card>
            <span className="sk h-48 rounded-lg" />
          </>
        }
        side={
          <div className="on-ink flex flex-col gap-4 rounded-xl bg-ink p-[22px]">
            <span className="sk h-3 w-24 opacity-30" />
            <span className="sk h-12 w-28 opacity-30" />
            <span className="sk h-3 w-full opacity-30" />
            <span className="sk h-3 w-2/3 opacity-30" />
          </div>
        }
      />
    </IterWrap>
  )
}

function BatchError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations("iterate")
  const errorMessage = useErrorMessage()
  const notFound = isApiError(error) && error.status === 404
  return (
    <IterWrap>
      <IterFlow current="analyze" />
      <Alert variant="destructive">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{notFound ? errorMessage("NOT_FOUND") : t("new.loadError")}</AlertTitle>
          {notFound ? null : <AlertDescription>{errorMessage(error)}</AlertDescription>}
        </AlertBody>
        <AlertActions>
          {notFound ? null : (
            <Button size="sm" onClick={onRetry}>
              <NavIcon name="refresh" size={14} />
              {t("analyze.tryAgain")}
            </Button>
          )}
          <Link href="/iterate/new" className={buttonVariants({ size: "sm", variant: "default" })}>
            {t("analyze.uploadAnother")}
          </Link>
        </AlertActions>
      </Alert>
    </IterWrap>
  )
}
