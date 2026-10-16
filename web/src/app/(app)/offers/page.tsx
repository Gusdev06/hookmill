"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { Job, Offer, OfferBrief, OfferExtractOutput } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/icon"
import { EmptyState, Page, PageHead, Panel, PanelHead, Tag } from "@/components/page"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useLanguageName } from "@/hooks/use-language-name"
import { BriefFields, FIELDS, toDraft, type Draft, type DraftKey } from "@/components/brief-form"
import { AlsoRead } from "@/components/offer-extract"
import { cn } from "@/lib/utils"

const TERMINAL: Job["status"][] = ["SUCCEEDED", "PARTIAL", "FAILED"]

const host = (url: string | null) => {
  if (!url) return ""
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export default function OffersPage() {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const [selected, setSelected] = useState<string | null>(null)

  const list = offers.data?.data ?? []
  const current = list.find((o) => o.id === selected) ?? list[0]

  const head = (
    <PageHead
      title={t("offers.title")}
      sub={t("offers.subtitle")}
      actions={
        <Link href="/creatives/new?offer=new" className={buttonVariants({ variant: "default" })}>
          <Icon name="plus" />
          {t("offers.newOffer")}
        </Link>
      }
    />
  )

  if (offers.isPending) {
    return (
      <Page>
        {head}
        <OffersSkeleton />
      </Page>
    )
  }

  if (offers.isError && !offers.data) {
    return (
      <Page>
        {head}
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("offers.errorTitle")}</AlertTitle>
            <AlertDescription>{errorMessage(offers.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => offers.refetch()}>
              <Icon name="refresh" />
              {t("common.retry")}
            </Button>
          </AlertActions>
        </Alert>
      </Page>
    )
  }

  if (!current) {
    return (
      <Page>
        {head}
        <EmptyOffers />
      </Page>
    )
  }

  return (
    <Page>
      {head}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <OfferList offers={list} value={current.id} onChange={setSelected} />
        <BriefPanel key={current.id} offer={current} />
      </div>
    </Page>
  )
}

function OfferList({ offers, value, onChange }: { offers: Offer[]; value: string; onChange: (id: string) => void }) {
  const t = useTranslations()
  const lang = useLanguageName()
  return (
    <RadioGroupPrimitive.Root value={value} onValueChange={onChange} aria-label={t("offers.listLabel")} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {offers.map((o) => (
        <RadioGroupPrimitive.Item
          key={o.id}
          value={o.id}
          className="group flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left hover:border-line-2 data-[state=checked]:border-fg"
        >
          <span className="mt-0.5 grid size-4 flex-none place-items-center rounded-full border border-line-2 group-data-[state=checked]:border-fg">
            <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-fg" />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <b className="font-semibold">{o.name}</b>
            <span className="row-sub">
              {[o.kind, o.offerAndPrice].filter(Boolean).join(" · ")}
            </span>
            <span className="mt-1 flex flex-wrap gap-1.5">
              <Tag>
                <Icon name="globe" />
                {lang(o.language)}
              </Tag>
              <Tag>{t("common.creatives", { count: o.creativesCount })}</Tag>
              {o.winnersCount ? <Tag tone="amber">{t("common.winners", { count: o.winnersCount })}</Tag> : null}
            </span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}

function BriefPanel({ offer }: { offer: Offer }) {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => toDraft(offer))
  const [fromPage, setFromPage] = useState<Set<DraftKey>>(new Set())
  const [jobId, setJobId] = useState<string | null>(null)
  const [rereadNote, setRereadNote] = useState<"done" | null>(null)
  const [alsoRead, setAlsoRead] = useState<string[]>([])

  const save = useMutation({
    mutationFn: () => {
      const base = toDraft(offer)
      const changed = Object.fromEntries(
        (Object.keys(draft) as DraftKey[]).filter((k) => draft[k] !== base[k]).map((k) => [k, k === "name" || k === "language" ? draft[k] : draft[k] || null])
      )
      return api.offers.update(offer.id, changed)
    },
    onSuccess: (o) => {
      qc.setQueryData<{ data: Offer[] }>(["offers"], (prev) => (prev ? { ...prev, data: prev.data.map((x) => (x.id === o.id ? o : x)) } : prev))
      setFromPage(new Set())
      setRereadNote(null)
      toast(
        <>
          <Icon name="check" />
          {t("offers.saved")}
        </>
      )
    },
    onError: (e) => toast(errorMessage(e)),
  })

  const reread = useMutation({
    mutationFn: () => api.offers.reread(offer.id),
    onSuccess: (job) => {
      setRereadNote(null)
      setJobId(job.id)
    },
    onError: (e) => toast(errorMessage(e)),
  })

  // contract §4: poll GET /jobs/:id every 1.5 s until terminal
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 1500),
  })
  const running = !!jobId && (!job.data || !TERMINAL.includes(job.data.status))

  // Applied once per job result, during render (no effect): adjust state when the query data changes.
  const [seenJob, setSeenJob] = useState<unknown>(null)
  {
    const j = job.data
    const out = j && TERMINAL.includes(j.status) && j.status !== "FAILED" ? (j.output as OfferExtractOutput | null) : null
    if (j && j !== seenJob && out) {
      setSeenJob(j)
      // The API never overwrites: apply into the form, the user checks and saves (contract §4 reread).
      const next: Partial<Draft> = { name: out.name, language: out.language }
      for (const k of Object.keys(out.brief) as (keyof OfferBrief)[]) {
        if (k in draft) next[k as DraftKey] = out.brief[k] ?? ""
      }
      setDraft((d) => ({ ...d, ...next }))
      setFromPage(new Set(Object.entries(out.fieldSources).filter(([, v]) => v === "page").map(([k]) => k as DraftKey)))
      setRereadNote("done")
      setAlsoRead(out.relatedUrls ?? [])
      setJobId(null)
    }
  }

  const failed = job.data?.status === "FAILED" ? job.data : null
  const set = (k: DraftKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setFromPage((s) => {
      if (!s.has(k)) return s
      const n = new Set(s)
      n.delete(k)
      return n
    })
  }

  return (
    <Panel>
      <PanelHead>
        <h2>
          {t("offers.brief")} · {offer.name}
        </h2>
        <span className="row-sub">{host(offer.sourceUrl)}</span>
      </PanelHead>

      {running ? (
        <ul className="m-0 grid list-none gap-2 p-0 text-[13px]" role="status">
          {(job.data?.checklist ?? [{ key: "fetching_page", done: false }, { key: "extracting", done: false }, { key: "detecting_language", done: false }]).map((c, i, all) => {
            const now = !c.done && all.slice(0, i).every((x) => x.done)
            return (
              <li key={c.key} className={cn("flex items-center gap-2", c.done || now ? "text-fg" : "text-fg-2")}>
                {c.done ? (
                  <Icon name="check" className="text-status-approved" />
                ) : now ? (
                  <span className="m-px size-3.5 flex-none animate-spin rounded-full border-[1.5px] border-status-progress border-t-transparent" />
                ) : (
                  <span className="m-px size-3.5 flex-none rounded-full border-[1.5px] border-line-2" />
                )}
                {t.has(`offers.checklist.${c.key}` as never) ? t(`offers.checklist.${c.key}` as never) : c.key}
              </li>
            )
          })}
        </ul>
      ) : null}

      {failed ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("offers.rereadFailed")}</AlertTitle>
            <AlertDescription>{failed.failReason ?? t("errors.fallback")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}

      {rereadNote === "done" ? (
        <Alert>
          <Icon name="info" />
          <AlertBody>
            <AlertDescription>{t("offers.rereadDone")}</AlertDescription>
            <AlsoRead urls={alsoRead} />
          </AlertBody>
        </Alert>
      ) : null}

      <BriefFields draft={draft} onChange={set} fromPage={fromPage} loading={running} />

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => reread.mutate()} disabled={running || reread.isPending || !offer.sourceUrl}>
          {t("offers.reread")}
        </Button>
        <Button variant="default" onClick={() => save.mutate()} disabled={running || save.isPending || !draft.name.trim()}>
          {t("offers.saveBrief")}
        </Button>
      </div>
    </Panel>
  )
}

function EmptyOffers() {
  const t = useTranslations("offers")
  const router = useRouter()
  const [url, setUrl] = useState("")
  return (
    <EmptyState>
      <h2>{t("emptyTitle")}</h2>
      <p className="text-fg-2">{t("emptyBody")}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) router.push(`/creatives/new?offer=new&url=${encodeURIComponent(url.trim())}`)
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder={t("urlPlaceholder")} aria-label={t("urlPlaceholder")} className="flex-1" />
        <Button type="submit" variant="default" disabled={!url.trim()}>
          {t("readPage")}
        </Button>
      </form>
    </EmptyState>
  )
}

function OffersSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desktop:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" role="status">
      <div className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 rounded-lg border border-line bg-surface px-3.5 py-3">
            <span className="sk mt-0.5 size-4 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <span className="sk h-3 w-2/5" />
              <span className="sk h-2.5 w-3/4" />
              <span className="sk h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <Panel>
        <span className="sk h-4 w-1/3" />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 tablet:grid-cols-2">
          {FIELDS.map((f) => (
            <span key={f.key} className={cn("sk", f.long ? "h-16 tablet:col-span-2" : "h-[34px]")} />
          ))}
        </div>
      </Panel>
    </div>
  )
}
