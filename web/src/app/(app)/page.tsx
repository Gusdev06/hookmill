"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { STEPS, type CreativeFilter, type CreativeRow, type MetaPeriod, type MetaSummary, type Offer, type WaitingBatchRef, type Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Count, EmptyState } from "@/components/page"
import { StatusChip } from "@/components/status-chip"
import { Thumb } from "@/components/thumb"
import { AdRow } from "@/components/meta/ad-row"
import { FacebookButton } from "@/components/meta/meta-connect"
import { useEngineLabel } from "@/hooks/use-engine-label"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useAccountMode } from "@/hooks/use-me"
import { isMetaOff, metaReady, mk, useMetaConnection, useMoney, useRelativeTime } from "@/hooks/use-meta"
import { MetaLockCard, metaGateOf } from "@/components/meta/meta-gate"
import { creativeHref, iterateHref, variarHref } from "@/lib/routes"
import { NavIcon } from "@/components/shell/nav-icon"
import { useStatusLabel } from "@/hooks/use-status-label"
import { VariationLine } from "@/components/variar/variation-line"
import { EditedBadge } from "@/components/editor/entry"
import { brainCompleteness } from "@/lib/brain"
import { cn } from "@/lib/utils"

/*
 * Home = the scoreboard (onboarding-v2 spec decision 12). With Meta: chip "Synced with Meta 4 min ago", 7 / 30 days,
 * 4 KPIs (`#t-kpis`, tour stop 5), Top 3 ads with the winner marked and the trend, Waiting on you + the Brain card on the
 * right, Recent creatives below (the list of before, filters kept; Review in the sidebar still opens ?filter=needs_you).
 * Without Meta: the "No results here yet" card with "Connect Meta" (→ Settings › Connections). First sync: beam card
 * with progress. Token expired / stale: amber alert + Reconnect. Never a full-page skeleton: only the 4 tiles and 3 rows.
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

export default function HomePage() {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const param = useSearchParams().get("filter")
  const filter: CreativeFilter = FILTERS.some((f) => f.value === param) ? (param as CreativeFilter) : "all"
  const setFilter = (v: CreativeFilter) => router.replace(v === "all" ? pathname : `${pathname}?filter=${v}`, { scroll: false })
  const [search, setSearch] = useState("")
  const q = useDebounced(search.trim(), 250)
  const mode = useAccountMode()
  const rel = useRelativeTime()

  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
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

  // ── Meta
  const conn = useMetaConnection()
  const off = conn.isError && isMetaOff(conn.error)
  const ready = metaReady(conn.data)
  const expired = conn.data?.status === "TOKEN_INVALID"
  // Gusta 25/10 (replaces QA 21/10 bug 8): numbers only with the ad account usable; expired / permission missing = the lock
  const gate = metaGateOf(conn.data)
  const usable = ready && gate === "ready"
  const [period, setPeriod] = useState<MetaPeriod>("30d")
  const summary = useQuery({
    queryKey: mk.summary(period),
    queryFn: ({ signal }) => api.meta.summary({ period }, { signal }),
    enabled: usable,
    // eventos.md: 30 s; 5 s only while the first sync runs
    refetchInterval: (query) => {
      const s = query.state.data?.sync.state
      return s === "first_sync" || s === "syncing" ? 5_000 : 30_000
    },
  })
  const sync = summary.data?.sync.state
  const top = useQuery({
    queryKey: mk.ads({ limit: 3 }),
    queryFn: ({ signal }) => api.meta.ads({ limit: 3 }, { signal }),
    enabled: usable && !!sync && sync !== "first_sync" && sync !== "never",
    refetchInterval: 30_000,
  })

  const name = ws.data?.name ?? ""
  const chip = (() => {
    if (off) return null
    if (expired || sync === "failed" || sync === "stale") return <Tag tone="warn">{t("home.metaAttention")}</Tag>
    if (usable && (sync === "first_sync" || sync === "syncing")) return <Tag tone="info" pulse>{t("home.readingMeta")}</Tag>
    if (usable && summary.data?.sync.syncedAt) return <Tag tone="ok">{t("home.synced", { ago: rel(summary.data.sync.syncedAt) })}</Tag>
    if (usable && !summary.data) return <span className="sk inline-block h-5 w-40 rounded-full" />
    if (conn.isPending) return <span className="sk inline-block h-5 w-40 rounded-full" />
    return <Tag tone="neutral">{t("home.notConnected")}</Tag>
  })()

  const counts = list.data?.meta.counts
  const rows = list.data?.data ?? []
  const waitingRows = waiting.data?.data ?? (filter === "all" && !q ? rows.filter((c) => c.status === "waiting" || c.status === "failed").slice(0, 6) : [])
  const waitingBatches = (waiting.data?.meta.waitingBatches ?? []) as WaitingBatchRef[]
  const waitingCount = waiting.data ? (waiting.data.meta.waitingOnYou?.total ?? waiting.data.meta.counts.needs_you) : null
  const waitingCard = <WaitingOnYou rows={waitingRows} batches={waitingBatches} count={waitingCount} pending={waiting.isPending} />
  const brainCard = <BrainCard ws={ws.data} offers={offers.data?.data} />

  // ── the results block, by state
  let results: React.ReactNode
  if (off) {
    results = <Cols main={waitingCard} side={brainCard} />
  } else if (conn.isPending || (usable && summary.isPending)) {
    results = (
      <>
        <KpiSkeleton />
        <Cols main={<TopAdsSkeleton />} side={<>{waitingCard}{brainCard}</>} />
      </>
    )
  } else if (conn.isError) {
    results = (
      <>
        <div id="t-kpis">
          <LoadError title={t("home.metaLoadFailed")} error={conn.error} onRetry={() => conn.refetch()} />
        </div>
        <Cols main={waitingCard} side={brainCard} />
      </>
    )
  } else if (!usable) {
    results = (
      <>
        <MetaLockCard state={gate} />
        <Cols main={waitingCard} side={brainCard} />
      </>
    )
  } else if (sync === "never") {
    results = (
      <>
        <NoMeta name={name} chooseAccount={!!conn.data && conn.data.status === "ACTIVE"} />
        <Cols main={waitingCard} side={brainCard} />
      </>
    )
  } else if (summary.isError || !summary.data) {
    results = (
      <>
        <div id="t-kpis">
          <LoadError title={t("home.metaLoadFailed")} error={summary.error} onRetry={() => summary.refetch()} />
        </div>
        <Cols main={waitingCard} side={brainCard} />
      </>
    )
  } else if (sync === "first_sync") {
    results = (
      <>
        <FirstSync s={summary.data} account={conn.data?.adAccount?.name ?? name} />
        <Cols main={waitingCard} side={brainCard} />
      </>
    )
  } else {
    const s = summary.data
    results = (
      <>
        {expired || sync === "failed" || sync === "stale" ? <MetaAttention s={s} expired={expired} /> : null}
        <div className="flex flex-wrap items-baseline justify-between gap-2.5">
          <h2 className="text-base font-bold">{t("home.results")}</h2>
          <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as MetaPeriod)} aria-label={t("home.results")}>
            <ToggleGroupItem value="7d">{t("home.days7")}</ToggleGroupItem>
            <ToggleGroupItem value="30d">{t("home.days30")}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Kpis s={s} ws={ws.data ?? null} />
        <Cols
          main={
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                <h2 className="flex items-center gap-2 text-base font-bold">
                  {t("home.topAds")}
                  <Count>{period}</Count>
                </h2>
                <Link href={`/campaigns?view=ads&period=${period}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  {t("home.allAds")}
                  <Icon name="arrowr" />
                </Link>
              </div>
              {top.isPending ? (
                <TopAdsSkeleton bare />
              ) : top.isError ? (
                <LoadError title={t("home.metaLoadFailed")} error={top.error} onRetry={() => top.refetch()} />
              ) : top.data.data.length ? (
                <div className="flex flex-col gap-2">
                  {top.data.data.map((ad, i) => (
                    <AdRow
                      key={ad.metaAdId}
                      ad={ad}
                      currency={s.currency}
                      winner={i === 0 && ad.verdict === "WINNER"}
                      action={
                        <Link href={`/iterate/new?metaAdId=${encodeURIComponent(ad.metaAdId)}`} className={buttonVariants({ variant: i === 0 && ad.verdict === "WINNER" ? "brand" : "outline", size: "sm" })}>
                          {t("home.iterate")}
                        </Link>
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="m-0 text-[13px] text-fg-3">{t("home.noAds")}</p>
              )}
            </section>
          }
          side={
            <>
              {waitingCard}
              {brainCard}
            </>
          }
        />
      </>
    )
  }

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-5 px-[var(--gut)] pt-5 pb-16 tablet:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="eyebrow">{name ? t(mode === "OWN" ? "home.eyebrowOwn" : "home.eyebrowClient", { name }) : <span className="sk inline-block h-3 w-32" />}</span>
          <h1>{t("home.title")}</h1>
          <div className="min-h-6">{chip}</div>
        </div>
        <div className="flex flex-wrap gap-2 [&>a]:flex-1 tablet:[&>a]:flex-none">
          <Link href="/iterate/new" className={buttonVariants({ variant: "outline" })}>
            <NavIcon name="iter" size={16} />
            {t("shell.nav.iterate")}
          </Link>
          <Link href="/creatives/new" className={buttonVariants({ variant: "default" })}>
            <Icon name="plus" />
            {t("shell.nav.concepts")}
          </Link>
        </div>
      </div>

      {results}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            {t("home.recent")}
            {counts ? <Count>{counts.all}</Count> : null}
          </h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-full tablet:max-w-60 tablet:basis-0">
              <Icon name="search" className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("home.search")} aria-label={t("home.search")} className="h-9 pl-8" />
            </label>
            <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as CreativeFilter)} aria-label={t("home.recent")}>
              {FILTERS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value}>
                  {t(`home.${f.key}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        {list.isError ? <ListError error={list.error} cachedAt={list.data ? list.dataUpdatedAt : null} onRetry={() => list.refetch()} /> : null}
        {list.isPending ? (
          <ListSkeleton />
        ) : counts && counts.all === 0 && !q ? (
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
              <Link href="/creatives/new" className={buttonVariants({ variant: "default" })}>
                <Icon name="plus" />
                {t("common.newCreative")}
              </Link>
              <Link href="/offers" className={buttonVariants()}>
                {t("home.addOfferFirst")}
              </Link>
            </div>
          </EmptyState>
        ) : rows.length ? (
          <div className="overflow-hidden rounded-lg border border-line bg-surface" aria-busy={list.isFetching}>
            {rows.map((c) => (
              <CreativeListRow key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <p className="m-0 text-fg-2">{q ? t("home.noSearch", { q }) : t("home.noMatch")}</p>
        )}
      </section>
    </div>
  )
}

// ───────────────────────── pieces ─────────────────────────
function Tag({ tone, pulse, children }: { tone: "ok" | "warn" | "info" | "neutral"; pulse?: boolean; children: React.ReactNode }) {
  const cls = { ok: "bg-status-approved-bg text-status-approved", warn: "bg-status-waiting-bg text-status-waiting", info: "bg-status-progress-bg text-status-progress", neutral: "border border-line-soft bg-card-2 text-fg-2" }[tone]
  return (
    <span className={cn("inline-flex h-fit items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", cls)}>
      <i className={cn("size-2 rounded-full bg-current", pulse && "animate-pulse")} aria-hidden="true" />
      {children}
    </span>
  )
}

function Cols({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">{main}</div>
      <aside className="flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-4">{side}</aside>
    </div>
  )
}

const card = "flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 tablet:p-[18px]"

/** Relative change vs the previous period: negative is good for costs (`invert`). */
function Delta({ cur, prev, invert, format }: { cur: number | null; prev: number | null | undefined; invert?: boolean; format: (v: number) => string }) {
  const t = useTranslations("home")
  if (cur === null || prev === null || prev === undefined || prev === 0) return <span className="text-xs text-fg-3">{t("noPrevious")}</span>
  const pct = Math.round(((cur - prev) / prev) * 100)
  const good = invert ? pct <= 0 : pct >= 0
  const flat = pct === 0
  return (
    <span className={cn("inline-flex h-fit items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", flat ? "border border-line-soft bg-card-2 text-fg-2" : good ? "bg-status-approved-bg text-status-approved" : "bg-status-waiting-bg text-status-waiting")}>
      {flat ? null : <NavIcon name={pct > 0 ? "trend" : "down"} size={12} />}
      {t("vsPrevious", { pct: `${pct > 0 ? "+" : ""}${pct}%`, prev: format(prev) })}
    </span>
  )
}

function Kpis({ s, ws }: { s: MetaSummary; ws: Workspace | null }) {
  const t = useTranslations("home")
  const money = useMoney(s.currency)
  const result = ws?.defaultResult === "LEADS" ? "cpl" : ws?.defaultResult === "INSTALLS" ? "cpi" : "cpa"
  const tile = "flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-card px-4 py-4 tablet:px-[18px]"
  const value = "font-mono text-2xl leading-[1.1] font-semibold tabular-nums tablet:text-[28px]"
  const label = "text-[13px] font-semibold text-fg-3"
  return (
    <div id="t-kpis" className="grid grid-cols-2 gap-3 desktop:grid-cols-4">
      <div className={tile}>
        <span className={label}>{t("kpi.spend")}</span>
        <span className={value}>{money(s.spend, 0)}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <Delta cur={s.spend} prev={s.prev?.spend} format={(v) => money(v, 0)} />
        </span>
      </div>
      <div className={tile}>
        <span className={label}>{t(`kpi.${result}`)}</span>
        <span className={value}>{money(s.cpa)}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          {s.cpa === null && s.resultType === "link_click" ? t("noPixelResults") : <Delta cur={s.cpa} prev={s.prev?.cpa} invert format={(v) => money(v)} />}
        </span>
      </div>
      <div className={tile}>
        <span className={label}>{t("kpi.roas")}</span>
        <span className={value}>{s.roas === null ? "—" : `${s.roas.toFixed(1)}x`}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          <Delta cur={s.roas} prev={s.prev?.roas} format={(v) => `${v.toFixed(1)}x`} />
        </span>
      </div>
      <div className={tile}>
        <span className={label}>{t("kpi.active")}</span>
        <span className={value}>{s.activeAds}</span>
        <span className="text-xs text-fg-3">{t("kpi.activeSub", { fresh: s.newThisWeek, tiring: s.tiringCount })}</span>
      </div>
    </div>
  )
}

function KpiSkeleton() {
  const t = useTranslations("home")
  return (
    <>
      <h2 className="text-base font-bold">{t("results")}</h2>
      <div id="t-kpis" className="grid grid-cols-2 gap-3 desktop:grid-cols-4" role="status" aria-label={t("loadingResults")}>
        {[t("kpi.spend"), t("kpi.cpa"), t("kpi.roas"), t("kpi.active")].map((k) => (
          <div key={k} className="flex flex-col gap-2 rounded-xl border border-line bg-card px-4 py-4">
            <span className="text-[13px] font-semibold text-fg-3">{k}</span>
            <span className="sk h-7 w-24" />
            <span className="sk h-3 w-32" />
          </div>
        ))}
      </div>
    </>
  )
}

function TopAdsSkeleton({ bare }: { bare?: boolean }) {
  const t = useTranslations("home")
  return (
    <section className="flex flex-col gap-2" aria-busy="true">
      {bare ? null : <h2 className="text-base font-bold">{t("topAds")}</h2>}
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5">
          <span className="sk aspect-[9/16] w-10 rounded-[6px]" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="sk h-3 w-1/2" />
            <span className="sk h-2.5 w-1/3" />
          </span>
          <span className="sk h-8 w-20 rounded-md" />
        </div>
      ))}
    </section>
  )
}

function NoMeta({ name, chooseAccount }: { name: string; chooseAccount: boolean }) {
  const t = useTranslations("home.noMeta")
  const router = useRouter()
  const [why, setWhy] = useState(false)
  return (
    <div id="t-kpis" className={cn(card, "gap-5")}>
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-5 desktop:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5">
          <h2 className="wide text-[19px]">{t("title")}</h2>
          <p className="m-0 text-fg-3 text-pretty">{t("body", { name })}</p>
          <div className="flex flex-wrap gap-2">
            {chooseAccount ? (
              <Link href="/settings/connections" className={buttonVariants({ variant: "default" })}>
                {t("chooseAccount")}
              </Link>
            ) : (
              <FacebookButton size="default" onClick={() => router.push("/settings/connections")}>
                {t("cta")}
              </FacebookButton>
            )}
            <Button variant="ghost" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
              {t("whatWeRead")}
            </Button>
          </div>
          {why ? <p className="m-0 text-[13px] text-fg-3">{t("whatWeReadBody")}</p> : null}
        </div>
        <div className="on-ink flex min-w-0 flex-col gap-3 rounded-xl bg-ink p-[18px] text-ink-body">
          <span className="eyebrow text-ink-fg-2">{t("once")}</span>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {([["k1", "v1"], ["k2", "v2"], ["k3", "v3"]] as const).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2.5 border-b border-ink-line pb-2.5 last:border-b-0 last:pb-0">
                <span className="text-ink-fg-2">{t(k)}</span>
                <span className="text-right font-semibold text-white">{t(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function FirstSync({ s, account }: { s: MetaSummary; account: string }) {
  const t = useTranslations("home")
  const p = s.sync.progress
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null
  return (
    <div id="t-kpis" className={cn(card, "beam relative")} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="spin-ring size-4" aria-hidden="true" />
        <span className="flex flex-col">
          <b>{t("firstSync", { account })}</b>
          <span className="text-[13px] text-fg-3">{p ? t("firstSyncProgress", { done: p.done, total: p.total }) : t("firstSyncStarting")}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
        <i className={cn("block h-full rounded-full bg-brand-edge transition-[width] duration-500", pct === null && "w-1/5 animate-pulse")} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MetaAttention({ s, expired }: { s: MetaSummary; expired: boolean }) {
  const t = useTranslations("home")
  const rel = useRelativeTime()
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const syncNow = useMutation({
    mutationFn: () => api.meta.sync(),
    onSuccess: () => toast(t("syncStarted")),
    onError: (e) => toast(errorMessage(e)),
  })
  const since = s.sync.syncedAt ? format.dateTime(new Date(s.sync.syncedAt), { month: "short", day: "numeric" }) : null
  return (
    <Alert variant="warning">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{expired ? t("metaStale.expired") : t("metaStale.title", { ago: s.sync.syncedAt ? rel(s.sync.syncedAt) : "—" })}</AlertTitle>
        <AlertDescription>{since ? t("metaStale.body", { date: since }) : t("metaStale.bodyNoDate")}</AlertDescription>
      </AlertBody>
      <AlertActions>
        {expired ? (
          <Link href="/settings/connections" className={buttonVariants({ size: "sm", variant: "default" })}>
            {t("reconnect")}
          </Link>
        ) : (
          <Button size="sm" variant="default" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <Icon name="refresh" />
            {t("syncNow")}
          </Button>
        )}
      </AlertActions>
    </Alert>
  )
}

function LoadError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  return (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{errorMessage(error)}</AlertDescription>
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

function WaitingOnYou({ rows, batches, count, pending }: { rows: CreativeRow[]; batches: WaitingBatchRef[]; count: number | null; pending: boolean }) {
  const t = useTranslations("home")
  return (
    <section id="t-wait" className={card}>
      <h2 className="flex items-center gap-2 text-base font-bold">
        {t("waitingOnYou")}
        {count !== null ? <Count>{count}</Count> : null}
      </h2>
      {pending ? (
        <div className="grid gap-2" aria-busy="true">
          <span className="sk h-[72px] rounded-md" />
          <span className="sk h-[72px] rounded-md" />
        </div>
      ) : rows.length || batches.length ? (
        <div className="grid gap-2">
          {batches.slice(0, 2).map((b) => (
            <WaitingBatchCard key={b.id} b={b} />
          ))}
          {rows.slice(0, Math.max(1, 4 - Math.min(2, batches.length))).map((c) => (
            <WaitingCard key={c.id} c={c} />
          ))}
          {(count ?? rows.length + batches.length) > 4 ? (
            <Link href="/?filter=needs_you" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("seeAllWaiting", { count: count ?? rows.length + batches.length })}
              <Icon name="arrowr" />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-fg-3">{t("waitingEmpty")}</p>
      )}
    </section>
  )
}

function BrainCard({ ws, offers }: { ws: Workspace | undefined; offers: Offer[] | undefined }) {
  const t = useTranslations("home.brain")
  const tb = useTranslations("onboarding.brain")
  const brain = ws && offers ? brainCompleteness(ws, offers) : null
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="text-base font-bold">{t("title")}</h2>
        {brain ? <span className="font-mono font-semibold tabular-nums">{brain.percent}%</span> : <span className="sk h-4 w-10" />}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={brain?.percent ?? 0} aria-label={t("title")}>
        <i className="block h-full rounded-full bg-brand-edge transition-[width]" style={{ width: `${brain?.percent ?? 0}%` }} />
      </div>
      <span className="text-[13px] text-fg-3">
        {brain ? (brain.missing.length ? t("missing", { items: brain.missing.slice(0, 3).map((i) => tb(`item.${i}`)).join(", ") }) : t("allIn")) : <span className="sk inline-block h-3 w-40" />}{" "}
        <Link href="/brain" className="font-semibold text-fg underline underline-offset-2 hover:text-brand-ink">
          {t("fill")}
        </Link>
      </span>
    </section>
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
  const cta = c.step === "generation" && c.status === "failed" ? t("generationFailed", { failed: Number(c.statusParams.failed ?? 1) }) : t(c.step === "library" ? "library" : c.step)
  return (
    <Link href={creativeHref(c)} className="flex w-full min-w-0 items-stretch gap-3 rounded-md border border-line bg-card p-3 text-left transition-colors hover:border-fg">
      <Thumb file={c.thumbnail} play={c.step === "review"} className="w-12 flex-none" />
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
function WaitingBatchCard({ b }: { b: WaitingBatchRef }) {
  const t = useTranslations("iterate.waiting")
  const rel = useRelative()
  const auto = b.mode === "AUTO"
  const href = auto ? iterateHref(b.id) : variarHref(b.championId, "hooks", b.id)
  const status = b.status === "PIECES_READY" ? "approved" : b.status === "PLAN_READY" ? "waiting" : "failed"
  const label = b.status === "PIECES_READY" ? t("PIECES_READY", { n: b.readyCount ?? 0 }) : t(b.status)
  const cta = b.status === "PIECES_READY" ? t("download") : b.status === "PLAN_READY" ? t("openPlan") : auto ? t("fix") : t("open")
  return (
    <Link href={href} className="flex w-full min-w-0 items-stretch gap-3 rounded-md border border-line bg-card p-3 text-left transition-colors hover:border-fg">
      <span className="grid aspect-[9/16] w-12 flex-none place-items-center rounded-sm border border-line bg-card-2 text-fg-3" aria-hidden="true">
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

function ListSkeleton() {
  const t = useTranslations("common")
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface" role="status" aria-label={t("loading")}>
      {Array.from({ length: 4 }, (_, i) => (
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
  )
}
