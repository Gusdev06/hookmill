"use client"

import { useDeferredValue, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaCampaignAdRow, MetaCampaignsTotals, MetaPeriod, MetaStatusCounts, MetaSyncState, MetaWriteResult } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { Page } from "@/components/page"
import { useSession } from "@/components/providers/session-provider"
import { SoonPage } from "@/components/soon-pages"
import { useErrorMessage } from "@/hooks/use-error-message"
import { metaReady, mk, useMetaConnection } from "@/hooks/use-meta"
import { MetaLockScreen, isLocked, useMetaGate } from "@/components/meta/meta-gate"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { CardsSkeleton, PhoneList, type Drill } from "./cards"
import { Chip, useFormat } from "./cells"
import { WriteDialog, type Current, type WriteTarget } from "./dialogs"
import { HistorySheet, type HistoryScope } from "./history-sheet"
import { nodeId, patchObject, resultKey, type Filters, type Node, type ResultKey, type SortKey } from "./model"
import { TableSkeleton, TreeTable, type TableCtx } from "./tree-table"

/*
 * Campaigns v1 (docs/contratos/campanhas-v1.md; spec design/campanhas-v1-2026-10-22.md; mockup approved 22/10).
 * META_MODE=off → the SoonPage of before. Reads are snapshots (GET /meta/campaigns, /:id, /meta/ads?format=all) on open
 * and on window focus; 5 s while a sync runs. Writes (OWNER/ADMIN) always through a dialog; after one, the row is
 * swapped by the returned object and blinks; History (GET /meta/changes) in a drawer for everyone.
 */
export function CampaignsScreen() {
  const t = useTranslations("campaigns")
  const { state, conn } = useMetaGate()
  if (state === "off") return <SoonPage section="campaigns" />
  // Gusta 25/10: no ad account usable (never connected, account not chosen, expired, permission missing) = the lock, no data
  if (isLocked(state)) return <MetaLockScreen state={state} section={t("title")} />
  return <Campaigns conn={conn} />
}

/** the API's max page (`@Max(100)` on limit) */
const PAGE = 100
const DEFAULT_DIR = (k: SortKey): "asc" | "desc" => (k === "cpa" || k === "name" ? "asc" : "desc")
const RUNNING: MetaSyncState["state"][] = ["first_sync", "syncing"]

function Campaigns({ conn }: { conn: ReturnType<typeof useMetaConnection> }) {
  const t = useTranslations("campaigns")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const params = useSearchParams()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const isClient = role === "CLIENT"
  const canWrite = role === "OWNER" || role === "ADMIN"

  // ── filters (the Home "All ads" opens ?view=ads)
  const [view, setView] = useState<"tree" | "ads">(() => (params.get("view") === "ads" ? "ads" : "tree"))
  const [period, setPeriod] = useState<MetaPeriod>(() => (params.get("period") === "7d" ? "7d" : "30d"))
  const [status, setStatus] = useState<Filters["status"]>("all")
  const [origin, setOrigin] = useState<Filters["origin"]>("all")
  const [q, setQ] = useState("")
  const dq = useDeferredValue(q.trim())
  const [sort, setSort] = useState<SortKey>("spend")
  const [dir, setDir] = useState<"asc" | "desc">("desc")
  const filters: Filters = { status, origin, q: dq }
  const onSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSort(k)
      setDir(DEFAULT_DIR(k))
    }
  }
  const clear = () => {
    setQ("")
    setStatus("all")
    setOrigin("all")
  }
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggleOpen = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const [drill, setDrill] = useState<Drill>({ c: null, a: null })

  // ── connection
  const c = conn.data ?? null
  const expired = c?.status === "TOKEN_INVALID"
  const ready = metaReady(conn.data)
  const usable = ready || (expired && !!c?.adAccount && !!c?.page)
  const [unusableLocal, setUnusableLocal] = useState(false)
  const unusable = unusableLocal || !!c?.health?.checks.some((x) => x.key === "account" && x.level === "bad")

  // ── data
  // both modes page with nextCursor (the API caps `limit` at 100, default 30) and "Load more"
  const listQ = { period, status, origin, q: dq || undefined, sort, dir, limit: PAGE }
  const list = useInfiniteQuery({
    queryKey: mk.campaigns(listQ),
    queryFn: ({ pageParam, signal }) => api.meta.campaigns({ ...listQ, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
    enabled: usable && view === "tree",
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (RUNNING.includes(query.state.data?.pages[0]?.meta.sync.state as MetaSyncState["state"]) ? 5_000 : false),
  })
  // the server sorts (sort + dir); ads have no budget, so "budget" falls back to spend
  const adsQ = { format: "all" as const, period, status, origin, q: dq || undefined, sort: sort === "budget" ? ("spend" as const) : sort, dir, limit: PAGE }
  const ads = useInfiniteQuery({
    queryKey: mk.ads(adsQ),
    queryFn: ({ pageParam, signal }) => api.meta.ads({ ...adsQ, cursor: pageParam }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
    enabled: usable && view === "ads",
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (RUNNING.includes(query.state.data?.pages[0]?.meta.summary.sync.state as MetaSyncState["state"]) ? 5_000 : false),
  })
  const active = view === "tree" ? list : ads
  const listMeta = list.data?.pages[0]?.meta
  const adsMeta = ads.data?.pages[0]?.meta
  const sync: MetaSyncState | null = view === "tree" ? (listMeta?.sync ?? null) : (adsMeta?.summary.sync ?? null)
  const currency = (view === "tree" ? listMeta?.currency : adsMeta?.summary.currency) ?? c?.adAccount?.currency ?? null
  const counts: MetaStatusCounts | undefined = view === "tree" ? listMeta?.counts : adsMeta?.counts
  const campaigns = list.data?.pages.flatMap((p) => p.data) ?? []
  const adNodes = (ads.data?.pages.flatMap((p) => p.data) ?? []).map((row) => ({ level: "ad", row: row as MetaCampaignAdRow, campaign: null, adset: null }) as Extract<Node, { level: "ad" }>)
  const more = active.hasNextPage ? (
    <Button variant="outline" size="sm" className="self-center max-tablet:w-full" onClick={() => active.fetchNextPage()} disabled={active.isFetchingNextPage} aria-busy={active.isFetchingNextPage}>
      {active.isFetchingNextPage ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
      {t("loadMore")}
    </Button>
  ) : null
  // Total row (QA 23/10, Achado D): both views read the server totals of the whole filtered set (campanhas-v1 §11), never
  // a sum of the loaded pages. Zeroes only while the first page loads (the table is not shown then).
  const emptyTotals: MetaCampaignsTotals = { count: 0, spend: 0, results: 0, resultType: null, cpa: null, ctr: null, hookRate: null }
  const totals = (view === "tree" ? listMeta?.totals : adsMeta?.totals) ?? emptyTotals
  const rk = resultKey(totals.resultType ?? (view === "tree" ? null : adsMeta?.summary.resultType))

  // a sync that just ended: toast + fresh details
  const prevSync = useRef<string | null>(null)
  useEffect(() => {
    const s = sync?.state ?? null
    if (prevSync.current && RUNNING.includes(prevSync.current as MetaSyncState["state"]) && s && !RUNNING.includes(s)) {
      if (s === "ok") toast(t("syncDone"))
      void qc.invalidateQueries({ queryKey: ["meta", "campaign"] })
    }
    prevSync.current = s
  }, [sync?.state, qc, t])

  const syncNow = useMutation({
    mutationFn: () => api.meta.sync(),
    onSuccess: () => {
      toast(t("syncStarted"))
      void qc.invalidateQueries({ queryKey: ["meta", "campaigns"] })
      void qc.invalidateQueries({ queryKey: ["meta", "ads"] })
    },
    onError: (e) => toast(errorMessage(e)),
  })

  // ── writes
  const [dlg, setDlg] = useState<WriteTarget | null>(null)
  const [hist, setHist] = useState<HistoryScope | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blink = (id: string) => {
    setFlash(id)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1700)
  }
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["meta", "campaigns"] })
    void qc.invalidateQueries({ queryKey: ["meta", "campaign"] })
    void qc.invalidateQueries({ queryKey: ["meta", "ads"] })
    void qc.invalidateQueries({ queryKey: ["meta", "changes"] })
  }
  const onDone = (r: MetaWriteResult, n: Node) => {
    patchObject(qc, r.level, nodeId(n), { object: r.object })
    for (const p of r.alsoActivated) patchObject(qc, p.level, p.id, { status: "ACTIVE" })
    setDlg(null)
    blink(nodeId(n))
    const name = n.row.name
    const logged = t("toast.logged")
    if (r.change.field === "DAILY_BUDGET") toast(t("toast.budget", { value: fmtMinor(Number(r.change.to)), name }) + logged)
    else if (r.change.to === "ACTIVE") toast((r.alsoActivated.length ? t("toast.onN", { name, count: r.alsoActivated.length }) : t("toast.on", { name })) + logged)
    else toast(t("toast.paused", { name }) + logged)
    refreshAll()
  }
  const f = useFormat(currency)
  const fmtMinor = f.minor
  const onUpdateRow = (n: Node, cur: Current) => {
    patchObject(qc, n.level, nodeId(n), { status: cur.status, dailyBudgetMinor: n.level === "ad" ? undefined : cur.dailyBudgetMinor })
    setDlg(null)
    blink(nodeId(n))
    toast(t("toast.rowUpdated"))
  }
  const onGone = (n: Node) => {
    setDlg(null)
    toast(t("err.gone"))
    void n
    refreshAll()
  }

  const lockedReason = unusable ? t("err.unusableTitle") : expired ? t("err.tokenTitle") : null
  const ctx: TableCtx = {
    canWrite, isClient, lockedReason, period, filters, currency, resultKey: rk, flash,
    onToggle: (n) => setDlg({ kind: "toggle", n }),
    onBudget: (n) => setDlg({ kind: "budget", n }),
    onHistory: (n) => setHist({ level: n.level, id: nodeId(n), name: n.row.name }),
  }

  const account = c?.adAccount?.name ?? session.workspace.name
  const noMatch = (
    <div className="flex flex-col items-start gap-3 p-[18px]">
      <b>{t("noMatch")}</b>
      <Button size="sm" variant="outline" onClick={clear}>
        {t("clear")}
      </Button>
    </div>
  )

  // ── page body by state
  const notConnected = !conn.isPending && (!usable || (active.isError && isApiError(active.error) && (active.error.code === "META_NOT_CONNECTED" || active.error.code === "META_SELECTION_MISSING")))
  const anyFilter = status !== "all" || origin !== "all" || !!dq
  const rowsCount = view === "tree" ? campaigns.length : adNodes.length
  const toolbar = (
    <ToolbarView
      view={view} setView={(v) => { setView(v); setDrill({ c: null, a: null }) }}
      period={period} setPeriod={setPeriod} status={status} setStatus={setStatus} origin={origin} setOrigin={setOrigin}
      q={q} setQ={setQ} sort={sort} setSort={(k) => { setSort(k); setDir(DEFAULT_DIR(k)) }} counts={counts} resultKey={rk}
    />
  )
  let body: React.ReactNode
  if (conn.isPending || (usable && active.isPending)) {
    body = (
      <>
        {/* QA layout 29/10 (3rd round): same toolbar while loading, so the list doesn't jump when it arrives */}
        {toolbar}
        <TableSkeleton />
        <CardsSkeleton />
      </>
    )
  } else if (notConnected) {
    body = <NoMeta canConnect={canWrite} />
  } else if (active.isError) {
    body = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(active.error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => active.refetch()}>
            <Icon name="refresh" />
            {t("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  } else if (sync?.state === "first_sync") {
    body = (
      <>
        <FirstSync sync={sync} account={account} />
        <TableSkeleton />
        <CardsSkeleton />
      </>
    )
  } else if (!rowsCount && !anyFilter && view === "tree") {
    body = <NoCampaigns account={account} canSend={!isClient} />
  } else {
    body = (
      <>
        {toolbar}
        <TreeTable mode={view} campaigns={campaigns} ads={adNodes} totals={totals} ctx={ctx} sort={sort} dir={dir} onSort={onSort} open={open} toggle={toggleOpen} empty={noMatch} />
        <PhoneList mode={view} campaigns={campaigns} ads={adNodes} totals={totals} ctx={ctx} sort={sort} dir={dir} drill={drill} setDrill={setDrill} empty={<div className="rounded-[14px] border border-line bg-card">{noMatch}</div>} />
        {view === "tree" && drill.c ? null : more}
      </>
    )
  }

  return (
    <Page className="max-w-[1304px]">
      <div className="flex w-full min-w-0 flex-col gap-4">
        <Header
          account={c?.adAccount ?? null}
          sync={notConnected ? null : sync}
          isClient={isClient}
          showActions={!notConnected}
          syncing={syncNow.isPending}
          onSync={() => syncNow.mutate()}
          onHistory={() => setHist("all")}
        />
        {notConnected || conn.isPending ? null : (
          <Banners sync={sync} expired={expired} unusable={unusable} truncated={view === "tree" && !!listMeta?.truncated} member={role === "MEMBER"} onSync={() => syncNow.mutate()} syncing={syncNow.isPending} canSync={!isClient} />
        )}
        {body}
      </div>
      <WriteDialog
        target={dlg}
        currency={currency}
        onClose={() => setDlg(null)}
        onDone={onDone}
        onUpdateRow={onUpdateRow}
        onGone={onGone}
        onUnusable={() => setUnusableLocal(true)}
        onFailedWrite={() => void qc.invalidateQueries({ queryKey: ["meta", "changes"] })}
      />
      <HistorySheet scope={hist} account={account} currency={currency} onScope={setHist} onClose={() => setHist(null)} />
    </Page>
  )
}

// ───────────────────────── header / banners / toolbar ─────────────────────────
/** "4 min ago", never "in 18 seconds" (the snapshot time can be a little ahead of this tab's clock) */
function useAgo() {
  const format = useFormatter()
  const now = useNow({ updateInterval: 15_000 })
  return (iso: string | null | undefined) => (iso ? format.relativeTime(new Date(Math.min(Date.parse(iso), now.getTime())), now) : "")
}

function SyncChip({ sync }: { sync: MetaSyncState | null }) {
  const t = useTranslations("campaigns")
  const rel = useAgo()
  if (!sync) return null
  const chip = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-card px-2.5 py-1 text-xs font-semibold text-fg-2"
  const dot = (cls: string, pulse?: boolean) => <i className={cn("size-[7px] rounded-full bg-current", cls, pulse && "animate-pulse")} aria-hidden="true" />
  if (RUNNING.includes(sync.state)) {
    const p = sync.progress
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null
    return (
      <span className={chip} role="status">
        {dot("text-info", true)}
        {pct === null ? t("syncing") : t("syncingPct", { pct })}
      </span>
    )
  }
  if (sync.state === "failed")
    return (
      <span className={chip}>
        {dot("text-bad")}
        {t("syncFailedChip", { ago: rel(sync.syncedAt) })}
      </span>
    )
  if (sync.state === "stale")
    return (
      <span className={chip}>
        {dot("text-warn-dot")}
        {t("syncStaleChip", { ago: rel(sync.syncedAt) })}
      </span>
    )
  if (!sync.syncedAt) return null
  return (
    <span className={chip}>
      {dot("text-ok-dot")}
      {t("synced", { ago: rel(sync.syncedAt) })}
    </span>
  )
}

function Header({
  account, sync, isClient, showActions, syncing, onSync, onHistory,
}: {
  account: { id: string; name: string; currency: string } | null
  sync: MetaSyncState | null
  isClient: boolean
  showActions: boolean
  syncing: boolean
  onSync: () => void
  onHistory: () => void
}) {
  const t = useTranslations("campaigns")
  const { session } = useSession()
  const running = !!sync && RUNNING.includes(sync.state)
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 max-tablet:items-stretch">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="eyebrow">{t("eyebrow", { workspace: session.workspace.name })}</span>
        <h1 className="m-0 flex flex-wrap items-center gap-2.5 text-[30px] leading-[1.1] font-extrabold tracking-[-0.015em] text-balance [font-stretch:125%] max-tablet:text-2xl">
          {t("title")}
          {isClient ? (
            <Chip tone="neutral">
              <Icon name="lock" className="size-3" />
              {t("viewOnly")}
            </Chip>
          ) : null}
        </h1>
        {account ? (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-fg-3">
            <span>{account.name}</span>
            <span className="font-mono text-xs">{account.id}</span>
            <span>{account.currency}</span>
          </span>
        ) : null}
      </div>
      {showActions ? (
        <div className="flex flex-wrap items-center gap-2 max-tablet:grid max-tablet:w-full max-tablet:grid-cols-2">
          <span className="max-tablet:col-span-2">
            <SyncChip sync={sync} />
          </span>
          <Button variant="outline" size="sm" onClick={onHistory} className={isClient ? "max-tablet:col-span-2" : undefined}>
            <Icon name="clock" />
            {t("history")}
          </Button>
          {isClient ? null : (
            <Button variant="outline" size="sm" onClick={onSync} disabled={syncing || running} aria-busy={syncing}>
              {syncing ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <Icon name="refresh" />}
              {t("syncNow")}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Banners({ sync, expired, unusable, truncated, member, onSync, syncing, canSync }: { sync: MetaSyncState | null; expired: boolean; unusable: boolean; truncated: boolean; member: boolean; onSync: () => void; syncing: boolean; canSync: boolean }) {
  const t = useTranslations("campaigns")
  const rel = useAgo()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const time = (iso: string | null | undefined) => (iso ? format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", ...(now.getTime() - Date.parse(iso) > 864e5 ? { month: "short", day: "numeric" } : {}) }) : "—")
  const syncBtn = (label: string) =>
    canSync ? (
      <AlertActions>
        <Button size="sm" variant="outline" onClick={onSync} disabled={syncing} aria-busy={syncing}>
          {label}
        </Button>
      </AlertActions>
    ) : null
  return (
    <>
      {expired ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("banner.expiredTitle")}</AlertTitle>
            <AlertDescription>{t("banner.expiredBody")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Link href="/settings/connections" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("err.reconnect")}
            </Link>
          </AlertActions>
        </Alert>
      ) : null}
      {sync?.state === "stale" && !expired ? (
        <Alert variant="warning" role="status">
          <Icon name="clock" />
          <AlertBody>
            <AlertTitle>{t("banner.staleTitle", { ago: rel(sync.syncedAt) })}</AlertTitle>
            <AlertDescription>{t("banner.staleBody", { time: time(sync.syncedAt) })}</AlertDescription>
          </AlertBody>
          {syncBtn(t("syncNow"))}
        </Alert>
      ) : null}
      {sync?.state === "failed" ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("banner.failedTitle")}</AlertTitle>
            <AlertDescription>
              {sync.job?.failReason ? <span className="block">{sync.job.failReason}</span> : null}
              {t("banner.failedBody", { time: time(sync.syncedAt) })}
            </AlertDescription>
          </AlertBody>
          {syncBtn(t("banner.failedRetry"))}
        </Alert>
      ) : null}
      {unusable ? (
        <Alert variant="destructive">
          <Icon name="lock" />
          <AlertBody>
            <AlertTitle>{t("err.unusableTitle")}</AlertTitle>
            <AlertDescription>{t("banner.unusableBody")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <a href="https://adsmanager.facebook.com/" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("banner.unusableCta")}
              <Icon name="ext" />
            </a>
          </AlertActions>
        </Alert>
      ) : null}
      {truncated ? (
        <Alert variant="info" role="status">
          <Icon name="info" />
          <AlertBody>
            <AlertTitle>{t("banner.truncTitle")}</AlertTitle>
            <AlertDescription>{t("banner.truncBody")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <a href="https://adsmanager.facebook.com/adsmanager/manage/campaigns" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("openAM")}
              <Icon name="ext" />
            </a>
          </AlertActions>
        </Alert>
      ) : null}
      {member ? (
        <Alert variant="info" role="status">
          <Icon name="lock" />
          <AlertBody>
            <AlertDescription>{t("banner.member")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
    </>
  )
}

function ToolbarView({
  view, setView, period, setPeriod, status, setStatus, origin, setOrigin, q, setQ, sort, setSort, counts, resultKey: rk,
}: {
  view: "tree" | "ads"; setView: (v: "tree" | "ads") => void
  period: MetaPeriod; setPeriod: (p: MetaPeriod) => void
  status: Filters["status"]; setStatus: (s: Filters["status"]) => void
  origin: Filters["origin"]; setOrigin: (o: Filters["origin"]) => void
  q: string; setQ: (v: string) => void
  sort: SortKey; setSort: (k: SortKey) => void
  counts: MetaStatusCounts | undefined
  resultKey: ResultKey
}) {
  const t = useTranslations("campaigns")
  const sorts: [SortKey, string][] = [["spend", t("col.spend")], ["cpa", t(`cost.${rk}`)], ["results", t(`result.${rk}`)], ["ctr", t("col.ctr")], ["hookRate", t("col.hook")], ["budget", t("col.budget")], ["name", t("col.name")]]
  const count = (n: number | undefined) => (n === undefined ? null : <span className="ml-1.5 font-mono text-[11px] text-fg-3">{n}</span>)
  const [sheet, setSheet] = useState(false)
  // QA layout 29/10 (3rd round): on the phone the 4 filter groups took ~300 px before the numbers; there they go in a sheet
  const changed = [view !== "tree", period !== "30d", status !== "all", origin !== "all"].filter(Boolean).length
  const groups = (stacked: boolean) => {
    const label = (k: string) => (stacked ? <span className="text-[13px] font-semibold">{t(`${k}.label` as never)}</span> : null)
    const wrap = (k: string, el: React.ReactNode) => (stacked ? <div key={k} className="grid gap-1.5">{label(k)}{el}</div> : el)
    return (
      <>
        {wrap("view",
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "tree" | "ads")} aria-label={t("view.label")} className="flex-none">
            <ToggleGroupItem value="tree">{t("view.tree")}</ToggleGroupItem>
            <ToggleGroupItem value="ads">{t("view.ads")}</ToggleGroupItem>
          </ToggleGroup>
        )}
        {wrap("period",
          <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as MetaPeriod)} aria-label={t("period.label")} className="flex-none">
            <ToggleGroupItem value="30d">{t("period.30d")}</ToggleGroupItem>
            <ToggleGroupItem value="7d">{t("period.7d")}</ToggleGroupItem>
          </ToggleGroup>
        )}
        {wrap("status",
          <ToggleGroup type="single" value={status} onValueChange={(v) => v && setStatus(v as Filters["status"])} aria-label={t("status.label")} className="flex-none">
            <ToggleGroupItem value="all">{t("status.all")}</ToggleGroupItem>
            <ToggleGroupItem value="active">{t("status.active")}</ToggleGroupItem>
            <ToggleGroupItem value="paused">{t("status.paused")}</ToggleGroupItem>
            <ToggleGroupItem value="issues" className="gap-1.5">
              {t("status.issues")}
              {count(counts?.issues)}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {wrap("origin",
          <ToggleGroup type="single" value={origin} onValueChange={(v) => v && setOrigin(v as Filters["origin"])} aria-label={t("origin.label")} className="flex-none">
            <ToggleGroupItem value="all">{t("origin.all")}</ToggleGroupItem>
            <ToggleGroupItem value="hookmill" className="gap-1.5">
              <Chip tone="hm" className="px-1.5 py-0">
                HM
              </Chip>
              {t("origin.hookmill")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </>
    )
  }
  const sortSelect = (
    <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
      <SelectTrigger aria-label={t("sortBy")} className="h-10 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sorts.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {t("sortOption", { col: l })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <div className="hidden tablet:contents">{groups(false)}</div>
      {/* phone: Filters (sheet) + sort on one line, the search below */}
      <div className="flex w-full min-w-0 gap-2 tablet:hidden">
        <Button variant="outline" onClick={() => setSheet(true)} aria-haspopup="dialog" className="flex-none">
          {t("filters")}
          {changed ? <span className="rounded-full bg-fg px-1.5 font-mono text-[11px] text-white">{changed}</span> : null}
        </Button>
        <div className="min-w-0 flex-1">{sortSelect}</div>
      </div>
      <label className="relative flex min-w-0 flex-[1_1_220px] items-center tablet:max-w-[340px] max-tablet:flex-[1_1_100%]">
        <Icon name="search" className="pointer-events-none absolute left-3 text-fg-3" />
        <span className="sr-only">{t("search")}</span>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} autoComplete="off" className="h-10 pl-9" />
      </label>
      <div className="hidden flex-[1_1_auto] tablet:block min-[1100px]:hidden">{sortSelect}</div>
      <Dialog open={sheet} onOpenChange={setSheet}>
        <DialogContent className="top-auto bottom-0 left-0 max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-b-none border-x-0 border-b-0 bg-card p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] sm:max-w-none">
          <DialogTitle className="text-base font-bold">{t("filtersTitle")}</DialogTitle>
          <div className="grid gap-3.5">{groups(true)}</div>
          <Button variant="default" onClick={() => setSheet(false)} className="w-full">
            {t("filtersApply")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ───────────────────────── special states ─────────────────────────
const STEP_KEYS = ["listing_campaigns", "listing_adsets", "listing_ads", "reading_insights", "scoring"] as const
function FirstSync({ sync, account }: { sync: MetaSyncState; account: string }) {
  const t = useTranslations("campaigns.first")
  const p = sync.progress
  const pct = p && p.total ? Math.min(99, Math.round((p.done / p.total) * 100)) : 0
  const cl = sync.job?.checklist ?? []
  const done = (k: string, i: number) => {
    const c = cl.find((x) => x.key === k)
    return c ? c.done : i < Math.floor((pct / 100) * STEP_KEYS.length)
  }
  const nowIdx = STEP_KEYS.findIndex((k, i) => !done(k, i))
  return (
    <div className="on-ink beam relative flex min-w-0 flex-col gap-3.5 rounded-xl bg-ink p-[22px] text-ink-body" role="status" aria-live="polite">
      <span className="eyebrow text-ink-fg-2">{t("eyebrow", { account })}</span>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[520px] flex-col gap-1.5">
          <h2 className="m-0 text-xl font-bold text-ink-fg">{t("title")}</h2>
          <span className="text-ink-fg-2">{t("body")}</span>
        </div>
        <span className="font-mono text-[44px] leading-none font-semibold text-brand tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {STEP_KEYS.map((k, i) => {
          const d = done(k, i)
          const now = i === nowIdx
          return (
            <li key={k} className={cn("flex items-center gap-2.5", !d && !now && "text-ink-fg-3")}>
              <span className={cn("inline-grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-ink-line", d && "border-brand bg-brand text-fg", now && "border-brand")}>
                {d ? <Icon name="check" className="size-3" /> : now ? <span className="spin-ring size-2.5 border-ink-line border-t-brand" aria-hidden="true" /> : null}
              </span>
              <span className="flex-1">{t(`steps.${k}`)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Ghost() {
  return (
    <div className="flex flex-col gap-2 opacity-55" aria-hidden="true">
      <div className="h-[34px] rounded-md border border-dashed border-control bg-card-2" />
      <div className="ml-[22px] h-[34px] rounded-md border border-dashed border-control bg-card-2" />
      <div className="ml-11 h-[34px] rounded-md border border-dashed border-control bg-card-2" />
      <div className="h-[34px] rounded-md border border-dashed border-control bg-card-2" />
    </div>
  )
}

function NoMeta({ canConnect }: { canConnect: boolean }) {
  const t = useTranslations("campaigns.empty")
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-5 rounded-lg border border-line bg-card p-[18px] max-desktop:grid-cols-[minmax(0,1fr)]">
      <div className="flex flex-col items-start gap-2.5">
        <span className="eyebrow">{t("noMetaEyebrow")}</span>
        <h2 className="m-0 text-xl font-bold text-balance">{t("noMetaTitle")}</h2>
        <p className="m-0 max-w-[640px] text-pretty text-fg-3">{t("noMetaBody")}</p>
        {canConnect ? (
          <Link href="/settings/connections" className={buttonVariants({ variant: "brand" })}>
            {t("connect")}
          </Link>
        ) : (
          <span className="text-[13px] text-fg-3">{t("askAdmin")}</span>
        )}
      </div>
      <Ghost />
    </div>
  )
}

function NoCampaigns({ account, canSend }: { account: string; canSend: boolean }) {
  const t = useTranslations("campaigns")
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-5 rounded-lg border border-line bg-card p-[18px] max-desktop:grid-cols-[minmax(0,1fr)]">
      <div className="flex flex-col items-start gap-2.5">
        <span className="eyebrow">{t("empty.noCampEyebrow", { account })}</span>
        <h2 className="m-0 text-xl font-bold text-balance">{t("empty.noCampTitle", { account })}</h2>
        <p className="m-0 max-w-[640px] text-pretty text-fg-3">{t("empty.noCampBody")}</p>
        <div className="flex flex-wrap gap-2">
          {canSend ? (
            <Link href="/library" className={buttonVariants({ variant: "brand" })}>
              {t("empty.send")}
            </Link>
          ) : null}
          <a href="https://adsmanager.facebook.com/adsmanager/manage/campaigns" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            {t("openAM")}
            <Icon name="ext" />
          </a>
        </div>
      </div>
      <Ghost />
    </div>
  )
}
