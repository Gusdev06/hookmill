"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { STEPS, type CreativeFilter, type CreativeRow, type WaitingBatchRefV } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Count, EmptyState, Page, PageHead, Section } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { Thumb } from "@/components/thumb"
import { useEngineLabel } from "@/hooks/use-engine-label"
import { creativeHref, iterateHref, variarHref } from "@/lib/routes"
import { NavIcon } from "@/components/shell/nav-icon"
import { useStatusLabel } from "@/hooks/use-status-label"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge } from "@/components/editor/entry"

const FILTERS: { value: CreativeFilter; key: "filterAll" | "filterProgress" | "filterNeedsYou" | "filterApproved" }[] = [
  { value: "all", key: "filterAll" },
  { value: "progress", key: "filterProgress" },
  { value: "needs_you", key: "filterNeedsYou" },
  { value: "approved", key: "filterApproved" },
]

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export default function HomePage() {
  const t = useTranslations()
  // the filter lives in the URL so the sidebar's Review (/?filter=needs_you) opens Home on "Needs you"
  const router = useRouter()
  const pathname = usePathname()
  const param = useSearchParams().get("filter")
  const filter: CreativeFilter = FILTERS.some((f) => f.value === param) ? (param as CreativeFilter) : "all"
  const setFilter = (v: CreativeFilter) => router.replace(v === "all" ? pathname : `${pathname}?filter=${v}`, { scroll: false })
  const [search, setSearch] = useState("")
  const q = useDebounced(search.trim(), 250)

  const list = useQuery({
    queryKey: ["creatives", { filter, q }],
    queryFn: ({ signal }) => api.creatives.list({ filter, q: q || undefined }, { signal }),
    placeholderData: keepPreviousData,
    // eventos.md §2: 5 s while something is running, else 30 s
    refetchInterval: (query) => (query.state.data?.data.some((c) => c.status === "progress") ? 5_000 : 30_000),
  })
  const waiting = useQuery({
    queryKey: ["creatives", { filter: "needs_you", limit: 6 }],
    queryFn: ({ signal }) => api.creatives.list({ filter: "needs_you", limit: 6 }, { signal }),
    refetchInterval: 30_000,
  })
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })

  const counts = list.data?.meta.counts
  const isEmpty = !!counts && counts.all === 0 && !q
  const newButton = (
    <>
      <Link href="/iterate/new" className={buttonVariants()}>
        <Icon name="branch" />
        {t("variar.title")}
      </Link>
      <Link href="/creatives/new" className={buttonVariants({ variant: "default" })}>
        <Icon name="plus" />
        {t("common.newCreative")}
      </Link>
    </>
  )

  if (list.isPending) return <HomeSkeleton />

  if (isEmpty && !list.isError) {
    return (
      <Page>
        <PageHead title={t("home.title")} sub={t("home.subtitleEmpty")} actions={newButton} />
        <EmptyState>
          <div className="grid gap-1.5">
            <h2>{t("home.emptyTitle")}</h2>
            <p className="max-w-[60ch] text-fg-2">{t("home.emptyBody")}</p>
          </div>
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 p-0">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-2 rounded-sm border border-line bg-surface px-2.5 py-2 text-[13px] text-fg-2">
                <span className="font-mono text-fg-3">{i + 1}</span>
                {t(`steps.${s}`)}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {newButton}
            <Link href="/offers" className={buttonVariants()}>
              {t("home.addOfferFirst")}
            </Link>
          </div>
        </EmptyState>
      </Page>
    )
  }

  const rows = list.data?.data ?? []
  // if "Waiting on you" fails, fall back to what the main list already knows instead of claiming "nothing"
  const waitingRows =
    waiting.data?.data ?? (filter === "all" && !q ? rows.filter((c) => c.status === "waiting" || c.status === "failed").slice(0, 6) : [])
  // batches waiting on the person (fase2-agencia §3.6 + variacao-auto-v1 §5.4: Plan ready · Analysis failed · N pieces ready)
  const waitingBatches = (waiting.data?.meta.waitingBatches ?? []) as WaitingBatchRefV[]
  const waitingCount = waiting.data ? (waiting.data.meta.waitingOnYou?.total ?? waiting.data.meta.counts.needs_you) : null

  return (
    <Page>
      <PageHead
        title={t("home.title")}
        sub={counts ? t("home.subtitle", { creatives: counts.all, offers: offers.data?.data.length ?? 0 }) : null}
        actions={
          <>
            <label className="relative max-w-none min-w-0 flex-1 basis-full tablet:max-w-80 tablet:basis-0">
              <Icon name="search" className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("home.search")}
                aria-label={t("home.search")}
                className="h-8 pl-8"
              />
            </label>
            {newButton}
          </>
        }
      />

      {list.isError ? <LoadError error={list.error} cachedAt={list.data ? list.dataUpdatedAt : null} onRetry={() => list.refetch()} /> : null}

      <Section>
        <h2>
          {t("home.waitingOnYou")}
          <Count>{waitingCount ?? (waiting.isError ? waitingRows.length : "")}</Count>
        </h2>
        {waiting.isPending ? (
          <WaitingSkeleton />
        ) : waiting.isError && !waitingRows.length ? null : waitingRows.length || waitingBatches.length ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 desktop:grid-cols-3">
            {waitingBatches.map((b) => (
              <WaitingBatchCard key={b.id} b={b} />
            ))}
            {waitingRows.map((c) => (
              <WaitingCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-fg-2">{t("home.waitingEmpty")}</p>
        )}
      </Section>

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2>{t("home.allCreatives")}</h2>
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as CreativeFilter)} aria-label={t("home.allCreatives")}>
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f.value} value={f.value}>
                {t(`home.${f.key}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {rows.length ? (
          <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-busy={list.isFetching}>
            {rows.map((c) => (
              <CreativeListRow key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <p className="text-fg-2">{q ? t("home.noSearch", { q }) : t("home.noMatch")}</p>
        )}
      </Section>
    </Page>
  )
}

function LoadError({ error, cachedAt, onRetry }: { error: unknown; cachedAt: number | null; onRetry: () => void }) {
  const t = useTranslations("home")
  const tc = useTranslations("common")
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const timeout = isApiError(error) && error.kind === "timeout"
  const ago = cachedAt ? format.relativeTime(cachedAt, now) : ""
  const body = cachedAt
    ? t(timeout ? "errorTimeoutCached" : "errorOtherCached", { ago })
    : t(timeout ? "errorTimeout" : "errorOther")
  return (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{t("errorTitle")}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </AlertBody>
      <AlertActions>
        <Button size="sm" onClick={onRetry}>
          <Icon name="refresh" />
          {tc("retry")}
        </Button>
      </AlertActions>
    </Alert>
  )
}

function useRelative() {
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  return (iso: string) => format.relativeTime(new Date(iso), now)
}

function WaitingCard({ c }: { c: CreativeRow }) {
  const t = useTranslations("home.cta")
  const label = useStatusLabel()
  const rel = useRelative()
  const cta =
    c.step === "generation" && c.status === "failed"
      ? t("generationFailed", { failed: Number(c.statusParams.failed ?? 1) })
      : t(c.step === "library" ? "library" : c.step)
  return (
    <Link
      href={creativeHref(c)}
      className="flex w-full min-w-0 items-stretch gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-2"
    >
      <Thumb file={c.thumbnail} play={c.step === "review"} className="w-[54px] flex-none" />
      <div className="grid min-w-0 flex-1 content-start gap-1">
        <span className="truncate font-medium">{c.name}</span>
        {c.variation ? <VariationLine v={c.variation} /> : null}
        {c.editedInEditor ? <span><EditedBadge variation={!!c.variation} /></span> : null}
        <span className="row-sub">
          {c.offer.name} · {rel(c.updatedAt)}
        </span>
        <StatusChip status={c.status}>{label(c)}</StatusChip>
        <span className="mt-auto pt-1.5">
          <span className={buttonVariants({ size: "sm" })}>
            {cta}
            <Icon name="arrowr" />
          </span>
        </span>
      </div>
    </Link>
  )
}

/** A batch waiting on the person: AUTO opens /iterate/:id, the old manual batch opens its plan. */
function WaitingBatchCard({ b }: { b: WaitingBatchRefV }) {
  const t = useTranslations("iterate.waiting")
  const rel = useRelative()
  const auto = b.mode === "AUTO"
  const href = auto ? iterateHref(b.id) : variarHref(b.championId, "hooks", b.id)
  const status = b.status === "PIECES_READY" ? "approved" : b.status === "PLAN_READY" ? "waiting" : "failed"
  const label = b.status === "PIECES_READY" ? t("PIECES_READY", { n: b.readyCount ?? 0 }) : t(b.status)
  const cta = b.status === "PIECES_READY" ? t("download") : b.status === "PLAN_READY" ? t("openPlan") : auto ? t("fix") : t("open")
  return (
    <Link href={href} className="flex w-full min-w-0 items-stretch gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-2">
      <span className="grid aspect-[9/16] w-[54px] flex-none place-items-center rounded-sm border border-line bg-card-2 text-fg-3" aria-hidden="true">
        <NavIcon name="iter" size={20} />
      </span>
      <div className="grid min-w-0 flex-1 content-start gap-1">
        <span className="truncate font-medium">{b.championName}</span>
        <span className="row-sub">
          {auto ? t("kindAuto") : t("kindManual")} · {b.offer.name} · {rel(b.updatedAt)}
        </span>
        <StatusChip status={status}>{label}</StatusChip>
        <span className="mt-auto pt-1.5">
          <span className={buttonVariants({ size: "sm" })}>
            {cta}
            <Icon name="arrowr" />
          </span>
        </span>
      </div>
    </Link>
  )
}

function CreativeListRow({ c }: { c: CreativeRow }) {
  const t = useTranslations()
  const label = useStatusLabel()
  const engine = useEngineLabel()
  const rel = useRelative()
  return (
    <Link href={creativeHref(c)} className="crow hover:bg-hover">
      <div className="c-col grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{c.name}</span>{c.editedInEditor ? <EditedBadge variation={!!c.variation} /> : null}</span>
        {c.variation ? <VariationLine v={c.variation} /> : <span className="row-sub">{c.offer.name}</span>}
      </div>
      <div className="c-col grid min-w-0 gap-0.5">
        <span className="step-lbl">{t(`steps.${c.step}`)}</span>
        <StatusChip status={c.status}>{label(c)}</StatusChip>
        {c.status === "progress" && c.progress !== null ? (
          <div className="h-[3px] w-[120px] max-w-full overflow-hidden rounded-[2px] bg-line" role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100}>
            <b className="block h-full bg-status-progress transition-[width] duration-500" style={{ width: `${c.progress}%` }} />
          </div>
        ) : null}
      </div>
      <div className="c-col c-engine min-w-0 gap-0.5">
        <span className="row-sub">{engine(c.engineModel)}</span>
      </div>
      <div className="c-col c-time min-w-0">
        <span className="row-sub num">{rel(c.updatedAt)}</span>
        <span className="row-sub inline-flex items-center gap-1.5">
          <i className="grid size-[18px] flex-none place-items-center rounded-full border border-line-2 bg-surface-2 text-[10px] text-fg-2 not-italic">
            {c.createdBy.initials}
          </i>
          {c.createdBy.name}
        </span>
      </div>
      <Icon name="chev" className="c-chev" />
    </Link>
  )
}

function WaitingSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 desktop:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-line bg-surface p-3">
          <span className="sk aspect-[9/16] w-[54px] flex-none" />
          <div className="grid flex-1 content-start gap-1">
            <span className="sk h-3 w-4/5" />
            <span className="sk h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

function HomeSkeleton() {
  const t = useTranslations()
  return (
    <Page>
      <PageHead
        title={t("home.title")}
        sub={<span className="sk mt-1.5 inline-block h-3 w-44" />}
        actions={
          <span className={buttonVariants({ variant: "default" })} aria-hidden="true">
            <Icon name="plus" />
            {t("common.newCreative")}
          </span>
        }
      />
      <Section>
        <h2>{t("home.waitingOnYou")}</h2>
        <WaitingSkeleton />
      </Section>
      <Section>
        <h2>{t("home.allCreatives")}</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-surface" role="status" aria-label={t("common.loading")}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="crow">
              <div className="c-col grid gap-1.5">
                <span className="sk h-3 w-[70%]" />
                <span className="sk h-2.5 w-[40%]" />
              </div>
              <div className="c-col grid gap-1.5">
                <span className="sk h-2.5 w-1/2" />
                <span className="sk h-3 w-[70%]" />
              </div>
              <div className="c-col c-engine">
                <span className="sk h-2.5 w-3/5" />
              </div>
              <div className="c-col c-time">
                <span className="sk h-2.5 w-1/2" />
              </div>
              <span />
            </div>
          ))}
        </div>
      </Section>
    </Page>
  )
}
