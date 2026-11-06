"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLocale } from "next-intl"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { SemanticFocus, SemanticFormat, SemanticPlan, SemanticPlanRequest, SemanticVariation } from "@maquina/contratos"
import { api } from "@/lib/api/client"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { Page, PageHead } from "@/components/page"
import { Button } from "@/components/ui/button"
import { fieldClass } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { scrollAppTop } from "@/lib/scroll"
import { semanticCopy, type SemanticCopy } from "./copy"

const FORMAT_IDS: SemanticFormat[] = ["F02", "F04", "F08", "F09", "F10", "F11"]
const FOCUSES: SemanticFocus[] = ["AUTO", "FORMAT", "AUDIENCE", "ANGLE"]
const card = "rounded-lg border border-line bg-card p-4 tablet:p-5"
const isRunning = (status?: string) => status === "QUEUED" || status === "RUNNING"

export function SemanticScreen() {
  const { session } = useSession()
  // Remontar o formulário ao trocar workspace impede reutilizar pedido/seleção da conta anterior.
  return <WorkspaceScreen key={session.workspace.id} workspaceId={session.workspace.id} readOnly={session.workspace.role === "CLIENT"} />
}

function WorkspaceScreen({ workspaceId, readOnly }: { workspaceId: string; readOnly: boolean }) {
  const t = semanticCopy(useLocale())
  const errorMessage = useErrorMessage()
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const [championId, setChampion] = useState(params.get("championId") ?? "")
  const [jobId, setJobId] = useState(params.get("plan") ?? "")
  const [focus, setFocus] = useState<SemanticFocus>("AUTO")
  const [instructions, setInstructions] = useState("")
  const [formats, setFormats] = useState<SemanticFormat[]>(["F02", "F04", "F10"])
  const pendingRequest = useRef<{ signature: string; body: SemanticPlanRequest } | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const config = useQuery({ queryKey: ["ai-variations", workspaceId, "config"], queryFn: api.aiVariations.config })
  const originals = useInfiniteQuery({
    queryKey: ["ai-variation-originals", workspaceId], initialPageParam: null as string | null,
    enabled: config.isSuccess,
    queryFn: ({ pageParam, signal }) => api.champions.list({ limit: 60, cursor: pageParam }, { signal }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
  const ready = originals.data?.pages.flatMap((p) => p.data).filter((c) => c.status === "READY") ?? []
  const history = useQuery({
    queryKey: ["ai-variations", workspaceId, "history", championId],
    enabled: config.isSuccess,
    queryFn: ({ signal }) => api.aiVariations.list(championId || undefined, { signal }),
    refetchInterval: (q) => q.state.data?.some((j) => isRunning(j.status)) ? 2000 : false,
  })
  const selected = useQuery({
    queryKey: ["ai-variations", workspaceId, "plan", jobId],
    queryFn: ({ signal }) => api.aiVariations.get(jobId, { signal }), enabled: config.isSuccess && !!jobId,
    refetchInterval: (q) => isRunning(q.state.data?.status) ? 2000 : false,
  })
  const openPlan = (id: string, source: string) => {
    setJobId(id); setChampion(source)
    router.replace(`/ai-variations?${new URLSearchParams({ plan: id, championId: source })}`, { scroll: false })
    requestAnimationFrame(() => {
      if (window.matchMedia('(min-width: 761px)').matches) scrollAppTop()
      else resultRef.current?.scrollIntoView({ block: 'start' })
    })
  }
  const create = useMutation({
    mutationFn: api.aiVariations.create,
    onSuccess: (job) => {
      pendingRequest.current = null
      qc.setQueryData(["ai-variations", workspaceId, "plan", job.id], job)
      openPlan(job.id, job.championId)
      void qc.invalidateQueries({ queryKey: ["ai-variations", workspaceId, "history"] })
    },
  })
  const busy = create.isPending || isRunning(selected.data?.status) || !!history.data?.some((j) => isRunning(j.status))
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!championId || busy || !config.data?.available || readOnly) return
    const direction = { championId, focus, instructions: instructions.trim(), formatIds: formats }
    const signature = JSON.stringify(direction)
    // Timeout de rede não é autorização para cobrar de novo: retry mantém a chave do mesmo pedido.
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, body: { ...direction, requestId: crypto.randomUUID() } }
    create.mutate(pendingRequest.current!.body)
  }
  const plan = selected.data?.plan
  const unavailable = config.data?.reason === "access_required" ? t.accessRequired : config.data?.reason === "not_configured" ? t.notConfigured : t.disabled
  const errors = [originals.error, history.error, selected.error, create.error].filter(Boolean)

  // Configuração é pré-requisito: uma rota indisponível não significa que o anúncio foi apagado.
  if (config.isError) return <Page>
    <PageHead title={t.title} sub={t.subtitle} />
    <div role="alert" className={card}>
      <p className="text-sm">{t.loadError}</p>
      <Button className="mt-3" variant="outline" disabled={config.isFetching} onClick={() => config.refetch()}>{config.isFetching ? t.loading : t.retry}</Button>
    </div>
  </Page>

  return <Page>
    <PageHead title={t.title} sub={t.subtitle} />
    {errors.map((e, i) => <div key={i} role="alert" className="rounded-md border border-status-failed p-3 text-sm">{errorMessage(e)}</div>)}
    {config.data && !config.data.available && <p className={card}>{unavailable}</p>}
    {readOnly && <p className="text-sm text-fg-2">{t.readOnly}</p>}
    <div className="grid items-start gap-5 tablet:grid-cols-[minmax(270px,340px)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-5">
        <form onSubmit={submit} className={card}>
          <h2 className="font-semibold">{t.stage}</h2>
          <p className="mt-1 mb-5 text-sm text-fg-2">{t.stageNote}</p>
          <fieldset disabled={busy || readOnly || !config.data?.available} className="grid min-w-0 gap-5 disabled:opacity-60">
            <div className="grid gap-2">
              <label htmlFor="semantic-source" className="text-sm font-medium">{t.original}</label>
              <select id="semantic-source" className={fieldClass} required value={championId} onChange={(e) => setChampion(e.target.value)}>
                <option value="">{originals.isPending ? t.loading : t.choose}</option>
                {!!championId && !ready.some((c) => c.id === championId) && <option value={championId}>{plan?.source.championName ?? t.selected}</option>}
                {ready.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.offer.name}</option>)}
              </select>
              {originals.hasNextPage && <Button type="button" variant="ghost" size="sm" onClick={() => originals.fetchNextPage()} disabled={originals.isFetchingNextPage}>{t.loadMore}</Button>}
              {!originals.isPending && !ready.length && <p className="text-sm text-fg-2">{t.empty} <Link className="underline" href="/templates">{t.add}</Link></p>}
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t.focus}</legend>
              {FOCUSES.map((f) => <label key={f} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"><input type="radio" name="semantic-focus" value={f} checked={focus === f} onChange={() => setFocus(f)} className="accent-[var(--brand)]" />{t.focusOptions[f]}</label>)}
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t.formats}</legend>
              <p className="mb-1 text-xs text-fg-2">{t.formatsHint}</p>
              {FORMAT_IDS.map((id) => <label key={id} className={cn("flex cursor-pointer gap-2 rounded-md border p-2.5 text-sm", formats.includes(id) ? "border-brand bg-brand/5" : "border-line")}>
                <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={formats.includes(id)} disabled={!formats.includes(id) && formats.length >= 3 || formats.includes(id) && formats.length === 1} onChange={(e) => setFormats(e.target.checked ? [...formats, id] : formats.filter((f) => f !== id))} />
                <span><span className="font-medium">{t.formatNames[id]}</span><span className="mt-0.5 block text-xs text-fg-2">{t.formatDescriptions[id]}</span></span>
              </label>)}
            </fieldset>
            <div className="grid gap-2">
              <label htmlFor="semantic-instructions" className="text-sm font-medium">{t.instructions} <span className="font-normal text-fg-3">· {t.optional}</span></label>
              <Textarea id="semantic-instructions" rows={4} maxLength={1200} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t.placeholder} />
            </div>
            <Button type="submit" variant="brand" disabled={!championId} aria-busy={busy}>{busy ? t.writing : t.generate}</Button>
          </fieldset>
        </form>
        <section className={card} aria-label={t.history}>
          <h2 className="mb-3 font-semibold">{t.history}</h2>
          {history.isPending ? <p className="text-sm text-fg-2">{t.loading}</p> : !history.data?.length ? <p className="text-sm text-fg-2">{t.noHistory}</p> : <ul className="grid gap-2">{history.data.map((j) => <li key={j.id}>
            <button type="button" aria-label={`${t.open} · ${new Date(j.createdAt).toLocaleString()}`} aria-pressed={jobId === j.id} className="w-full rounded-md border border-line p-2 text-left text-sm hover:border-brand aria-pressed:border-brand" onClick={() => openPlan(j.id, j.championId)}>
              <span className="font-medium">{j.plan?.source.championName ?? t.status[j.status]}</span><span className="mt-1 block text-xs text-fg-2">{new Date(j.createdAt).toLocaleString()} · {t.status[j.status]}</span>
            </button>
          </li>)}</ul>}
        </section>
      </div>
      <div ref={resultRef} className="grid min-w-0 scroll-mt-20 gap-4">
        {selected.isFetching && !selected.data && <p role="status" className={card}>{t.loading}</p>}
        {isRunning(selected.data?.status) && <p role="status" className={card}>{t.pending}</p>}
        {selected.data?.status === "FAILED" && <div role="alert" className={card}><p>{t.failed}</p><p className="mt-2 text-sm text-fg-2">{t.failedCode}: {selected.data.errorCode}</p></div>}
        {plan ? <PlanView plan={plan} t={t} /> : !jobId && <div className={cn(card, "grid min-h-64 content-center gap-3")}><span className="font-mono text-xs text-fg-3">01 → 02 → 03</span><h2 className="text-xl font-semibold">{t.stage}</h2><p className="max-w-md text-fg-2">{t.stageNote}</p><p className="text-sm text-fg-2">{formats.map((id) => t.formatNames[id]).join(' · ')}</p></div>}
      </div>
    </div>
  </Page>
}

function PlanView({ plan, t }: { plan: SemanticPlan; t: SemanticCopy }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }))
    const a = document.createElement("a"); a.href = url; a.download = "variation-plan.json"; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    {plan.generationMode === "mock" && <p className="rounded-md border border-line bg-card-2 p-3 text-sm">{t.mock}</p>}
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t.diagnosis}</h2><Button variant="outline" size="sm" onClick={download}>{t.download}</Button></div>
      <p className="mt-3 text-sm leading-relaxed">{plan.diagnosis.summary}</p>
      <p className="mt-3 text-xs text-fg-2">{t.review}</p>
      {!!plan.diagnosis.gaps.length && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{t.gaps}</summary><ul className="mt-2 list-disc space-y-1 pl-5">{plan.diagnosis.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>}
    </section>
    {plan.variations.map((v, i) => <VariationCard key={v.id} variation={v} index={i} plan={plan} t={t} />)}
    <details className={card}><summary className="cursor-pointer font-semibold">{t.facts}</summary><p className="mt-2 text-sm text-fg-2">{t.sourceNote}</p><ul className="mt-3 grid gap-3">{plan.facts.map((f) => <li key={f.id} className="border-l-2 border-line pl-3 text-sm whitespace-pre-wrap">{f.text}</li>)}</ul></details>
  </>
}

function VariationCard({ variation: v, index, plan, t }: { variation: SemanticVariation; index: number; plan: SemanticPlan; t: SemanticCopy }) {
  return <article className={card}>
    <div className="mb-3 flex items-center gap-3"><span className="font-mono text-xl text-fg-3">0{index + 1}</span><div><span className="text-xs font-medium text-fg-2">{t.formatNames[v.formatId]}</span><h2 className="text-lg font-semibold">{v.title}</h2></div></div>
    <dl className="grid gap-3 text-sm">
      {[[t.audience, v.audience], [t.angle, v.angle], [t.hypothesis, v.hypothesis]].map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="mt-0.5 leading-relaxed text-fg-2">{value}</dd></div>)}
    </dl>
    {v.audienceFit === "needs_review" && <p className="mt-3 text-sm text-fg-2">{t.fit}</p>}
    <details className="mt-4 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium">{t.changes}</summary><dl className="mt-3 grid gap-3">{v.changes.map((c) => <div key={c.axis}><dt className="font-medium">{t.axes[c.axis]}</dt><dd className="mt-1 text-fg-2">{t.before}: {c.before}<br />{t.after}: {c.after}</dd></div>)}</dl><p className="mt-3 font-medium">{t.preserved}</p><ul className="mt-1 list-disc space-y-1 pl-4 text-fg-2">{v.preserved.map((p, i) => <li key={i}>{p}</li>)}</ul></details>
    <details className="mt-3 border-t border-line pt-3 text-sm" open={index === 0}><summary className="cursor-pointer font-medium">{t.script}</summary><ol className="mt-3 grid gap-3">{v.beats.map((b, i) => <li key={i} className="rounded-md bg-card-2 p-3">
      <span className="text-xs font-semibold text-fg-2">{i + 1} · {t[b.speaker]}</span><p className="mt-1 leading-relaxed whitespace-pre-wrap">{b.text}</p><p className="mt-2 text-xs leading-relaxed text-fg-2">{b.visual}</p>
      {!!b.factRefs.length && <details className="mt-2 text-xs text-fg-2"><summary className="cursor-pointer">{t.factsLabel}</summary>{b.factRefs.map((id) => <p key={id} className="mt-1 border-l border-line pl-2">{plan.facts.find((f) => f.id === id)?.text}</p>)}</details>}
    </li>)}</ol></details>
    {!!v.requirements.length && <details className="mt-3 border-t border-line pt-3 text-sm"><summary className="cursor-pointer font-medium">{t.requirements}</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-fg-2">{v.requirements.map((r, i) => <li key={i}>{r.description}</li>)}</ul></details>}
  </article>
}
