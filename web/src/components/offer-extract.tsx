"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { Job, OfferExtractOutput } from "@/lib/api/types"
import { Checklist, checklistStates } from "@/components/fx"

/*
 * "Read the page" (contract §4): POST /offers/extract → GET /jobs/:id every 1.5 s until terminal.
 * One hook for the wizard Offer step and the client onboarding (step 1), so the reading logic lives in one place.
 */
const TERMINAL: Job["status"][] = ["SUCCEEDED", "PARTIAL", "FAILED"]
const DEFAULT_CHECKLIST = [
  { key: "fetching_page", done: false },
  { key: "extracting", done: false },
  { key: "detecting_language", done: false },
]

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

/** The reading checklist ("Reading example.com…", "Pulling the brief…", "Detecting the language…"). */
export function ExtractChecklist({ job, url }: { job: Job | null; url: string }) {
  const t = useTranslations("wizard.offer")
  const h = hostOf(url || "")
  const checklist = job?.checklist?.length ? job.checklist : DEFAULT_CHECKLIST
  const states = checklistStates(checklist.map((c) => c.done))
  const labels: Record<string, string> = {
    fetching_page: checklist[0]?.done ? t("fetched", { host: h }) : t("fetching", { host: h }),
    extracting: t("extracting"),
    detecting_language: t("detecting"),
  }
  return (
    <div role="status">
      <Checklist items={checklist.map((c, i) => ({ label: labels[c.key] ?? c.key, state: states[i] }))} />
    </div>
  )
}
