"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { FieldOrigins, Job, OfferExtractOutput, OfferReadMeta } from "@/lib/api/types"
import { Checklist, checklistStates } from "@/components/fx"
import { Progress } from "@/components/ui/progress"

/*
 * "Read the page" (contract §4): POST /offers/extract → GET /jobs/:id every 1.5 s until terminal.
 * One hook for the wizard Offer step, the Offers page (reread) and the client onboarding (step 1), so the reading
 * logic lives in one place. briefing-leitura-v2 (22/10): 6 stages with progress + etaSec, "Read from" block from
 * `pages`/`imagesRead`/`readMode`, origin per field from `fieldOrigins`.
 */
const TERMINAL: Job["status"][] = ["SUCCEEDED", "PARTIAL", "FAILED"]
const STAGES = ["fetching_page", "rendering_page", "reading_subpages", "reading_images", "extracting", "detecting_language"] as const
const DEFAULT_CHECKLIST = STAGES.map((key) => ({ key, done: false }))

export const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export type ExtractInput = { url: string } | { pageText: string; url?: string }

export function useOfferExtract({ onStart, onError }: { onStart?: () => void; onError?: (e: unknown) => void } = {}) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const extract = useMutation({
    mutationFn: (b: ExtractInput) => api.offers.extract(b),
    onMutate: () => {
      setError(null)
      setJobId(null)
      onStart?.()
    },
    onSuccess: (job) => setJobId(job.id),
    onError: (e) => {
      setError(e)
      onError?.(e)
    },
  })
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 1500),
  })
  const j = jobId ? job.data : undefined
  const terminal = !!j && TERMINAL.includes(j.status)
  return {
    start: (b: ExtractInput) => extract.mutate(b),
    /** the job while reading (checklist) and after (output / failReason / action) */
    job: j ?? null,
    reading: extract.isPending || (!!jobId && !terminal),
    /** the extraction result once the job succeeded (same object until the next read) */
    result: j && terminal && j.status !== "FAILED" ? ((j.output as OfferExtractOutput | null) ?? null) : null,
    failedJob: j?.status === "FAILED" ? j : null,
    /** POST /offers/extract itself failed (network, 4xx) */
    error,
    reset: () => {
      setJobId(null)
      setError(null)
    },
  }
}

/** Origins per field (for the brief form); empty when the reading didn't bring them. */
export const originsOf = (src: { fieldOrigins?: FieldOrigins | null } | null | undefined): FieldOrigins => src?.fieldOrigins ?? {}

/** What "Read from" needs: the job output (v2 fields, or only `relatedUrls` before v2) or the offer's persisted `readMeta`. */
export type ReadSource = Partial<Pick<OfferReadMeta, "readMode" | "pages" | "imagesRead">> & { relatedUrls?: string[] | null }

/**
 * The reading checklist with the 6 stages of v2 (a stage that didn't need to run is marked done by the API), the job's
 * progress + eta, and the honest note: simple pages ~20 s, image-heavy or multi-step pages up to ~2 min.
 */
export function ExtractChecklist({ job, url }: { job: Job | null; url: string }) {
  const t = useTranslations("wizard.offer")
  const tc = useTranslations("offers.checklist")
  const h = hostOf(url || "")
  const checklist = job?.checklist?.length ? job.checklist : DEFAULT_CHECKLIST
  const states = checklistStates(checklist.map((c) => c.done))
  const label = (key: string, done: boolean) =>
    key === "fetching_page" ? (done ? t("fetched", { host: h }) : t("fetching", { host: h })) : tc.has(key as never) ? tc(key as never) : key
  const pct = job ? Math.max(0, Math.min(100, Math.round(job.progress ?? 0))) : 0
  const eta = job?.etaSec ?? null
  return (
    <div role="status" aria-live="polite" className="grid gap-3">
      <Checklist items={checklist.map((c, i) => ({ label: label(c.key, c.done), state: states[i] }))} />
      <div className="grid gap-1.5">
        <Progress value={pct} aria-label={t("progressLabel")} />
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-fg-3">
          <span className="font-mono tabular-nums">{eta !== null && eta > 0 ? t("progressEta", { pct, sec: eta }) : t("progressPct", { pct })}</span>
          <span className="text-pretty">{t("takesUpTo")}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * "Read from: main page, checkout, pricing · 3 images" (v2 §0.3), from `pages`/`imagesRead`/`readMode`.
 * Before v2 the API only sends `relatedUrls`: then "Also read: <hosts>". Nothing when there is nothing to say.
 */
export function ReadFrom({ source, className }: { source: ReadSource | null | undefined; className?: string }) {
  const t = useTranslations("wizard.offer")
  if (!source) return null
  if (source.readMode === "pasted") return <span className={className ?? "row-sub whitespace-normal"}>{t("readFromPasted")}</span>
  const roles = [...new Set((source.pages ?? []).map((p) => p.role))]
  const images = source.imagesRead?.length ?? 0
  if (!roles.length && !images) {
    const hosts = source.relatedUrls ?? []
    return hosts.length ? <span className={className ?? "row-sub whitespace-normal"}>{t("alsoRead", { hosts: hosts.map(hostOf).join(", ") })}</span> : null
  }
  const parts = roles.map((r) => t(`role.${r}`))
  const list = parts.join(", ") + (images ? ` · ${t("imagesCount", { count: images })}` : "")
  return (
    <span className={className ?? "row-sub whitespace-normal"} title={(source.pages ?? []).map((p) => p.url).join("\n") || undefined}>
      {t("readFrom", { list })}
    </span>
  )
}
