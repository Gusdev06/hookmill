"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeFilter, CreativeRow } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Count, EmptyState } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { creativeHref, iterateHref, templatesHref } from "@/lib/routes"
import { NavIcon } from "@/components/shell/nav-icon"
import { useStatusLabel } from "@/hooks/use-status-label"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge } from "@/components/editor/entry"
import { TEMPLATES } from "@/lib/flags"
import { Reveal } from "@/components/ui/reveal"
import { SAMPLE_CREATIVE_ROWS } from "@/lib/skeleton-samples"

/*
 * All creatives (Home v2, design/home-v2-2026-10-31.md §2.8): the full list with search and filters left the Home (which now
 * keeps a 5-card strip) and lives here. Review in the sidebar opens ?filter=needs_you. Same list, filters and states as
 * the old Home "Recent creatives".
 */
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

export default function CreativesPage() {
  return (
    <Suspense>
      <CreativesList />
    </Suspense>
  )
}

function CreativesList() {
  const t = useTranslations()
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
  const counts = list.data?.meta.counts
  const rows = list.data?.data ?? []

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4 px-[var(--gut)] pt-5 pb-16 tablet:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2">
          {t("home.allCreatives")}
          {counts ? <Count>{counts.all}</Count> : null}
        </h1>
        <Link href="/creatives/new" className={buttonVariants({ variant: "outline" })}>
          <NavIcon name="bulb" size={16} />
          {t("shell.nav.concepts")}
        </Link>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-full tablet:max-w-72 tablet:basis-0">
          <Icon name="search" className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("home.search")} aria-label={t("home.search")} className="h-9 pl-8" />
        </label>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as CreativeFilter)} aria-label={t("home.allCreatives")}>
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {t(`home.${f.key}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {list.isError ? <ListError error={list.error} cachedAt={list.data ? list.dataUpdatedAt : null} onRetry={() => list.refetch()} /> : null}
      {/* tour-v2 §3.2: the CLIENT's Review stop (every state: loading, empty, list) */}
      <div id="t-review-list" className="flex min-w-0 flex-col">
        {/* skullet (04/11): the grid is measured from sample cards on the first load */}
        <Reveal data={list.isPending ? null : rows} sample={SAMPLE_CREATIVE_ROWS} id="creatives.list" label={t("skeleton.creatives")}>
          {(rows) => counts && counts.all === 0 && !q ? (
          <EmptyState>
            <div className="grid gap-1.5">
              <h2>{t("home.emptyTitle")}</h2>
              <p className="max-w-[60ch] text-fg-2">{t("home.next.uploadB")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={TEMPLATES ? templatesHref() : "/iterate/new"} className={buttonVariants({ variant: "default" })}>
                {t("home.next.uploadCta")}
              </Link>
              <Link href="/creatives/new" className={buttonVariants()}>
                {t("shell.nav.concepts")}
              </Link>
            </div>
          </EmptyState>
        ) : rows.length ? (
          <div className={GRID} aria-busy={list.isFetching}>
            {rows.map((c) => (
              <CreativeCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <p className="m-0 text-fg-2">{q ? t("home.noSearch", { q }) : t("home.noMatch")}</p>
        )}
        </Reveal>
      </div>
    </div>
  )
}

function useRelative() {
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  return (iso: string) => format.relativeTime(new Date(iso), now)
}
function ListError({ error, cachedAt, onRetry }: { error: unknown; cachedAt: number | null; onRetry: () => void }) {
  const t = useTranslations("home")
  const tc = useTranslations("common")
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const timeout = isApiError(error) && error.kind === "timeout"
  const ago = cachedAt ? format.relativeTime(cachedAt, now) : ""
  const body = cachedAt ? t(timeout ? "errorTimeoutCached" : "errorOtherCached", { ago }) : t(timeout ? "errorTimeout" : "errorOther")
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

const GRID = "grid grid-cols-2 gap-3 tablet:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] tablet:gap-4"

/** A batch piece whose render failed (04/11): its "Retry" lives on the batch's Generate step (piece-actions), so the card goes there. */
const failedPieceOf = (c: CreativeRow) => (c.status === "failed" && c.variation?.kind === "AUTO_EDIT" ? c.variation.batchId : null)

function CreativeCard({ c }: { c: CreativeRow }) {
  const label = useStatusLabel()
  const rel = useRelative()
  const tc = useTranslations("common")
  const thumb = c.thumbnail
  const batchId = failedPieceOf(c)
  return (
    <Link href={batchId ? iterateHref(batchId, "generate") : creativeHref(c)} className="group grid min-w-0 content-start gap-2 no-underline">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-line bg-surface-2 transition-shadow group-hover:shadow-md">
        {thumb?.mimeType.startsWith("video/") ? (
          <video src={`${thumb.url}#t=0.5`} muted playsInline preload="metadata" className="block size-full object-cover" />
        ) : thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb.url} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="grid size-full place-items-center text-fg-3">
            <NavIcon name="play" size={22} />
          </div>
        )}
        <div skullet-block="" className="absolute top-2 left-2">
          <StatusChip status={c.status} className="max-w-[calc(100%-1rem)] rounded-full border border-white/15 bg-black/70 px-2 py-0.5 text-xs text-white shadow-sm backdrop-blur-sm">{label(c)}</StatusChip>
        </div>
        {c.status === "progress" && c.progress !== null ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30" role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100}>
            <b className="block h-full bg-status-progress transition-[width] duration-500" style={{ width: `${c.progress}%` }} />
          </div>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{c.name}</span>{c.editedInEditor ? <EditedBadge variation={!!c.variation} /> : null}</span>
        {c.variation ? <VariationLine v={c.variation} /> : <span className="row-sub truncate">{c.offer.name}</span>}
        <span className="row-sub num">{rel(c.updatedAt)}</span>
        {batchId ? (
          <span className="flex items-center gap-1 text-sm font-medium text-status-failed">
            <Icon name="refresh" />
            {tc("retry")}
          </span>
        ) : null}
      </div>
    </Link>
  )
}
