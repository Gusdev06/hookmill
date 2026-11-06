"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useFormatter, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import type { Competitor, ListResearchAdsQuery, ResearchAdCard } from "@/lib/api/types"
import { effectiveRole } from "@/lib/dev-role"
import { radarHref, templatesHref } from "@/lib/routes"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { NavIcon } from "@/components/shell/nav-icon"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import {
  useCompetitors, useDiscoverAgain, useDiscovery, useDismissCompetitor, useRefreshCompetitor, useResearchAds, useResearchStatus, useRestoreCompetitor, useSaveAd,
} from "@/hooks/use-research"
import { AdGrid } from "./ad-grid"
import { AdDetailSheet } from "./ad-detail-sheet"
import { CompetitorBar, CompetitorPanel, DismissDialog } from "./competitor-bar"
import { DiscoveryEmpty, DiscoveryFailed, DiscoveryProgress, PickedCard } from "./discovery-state"
import { DEFAULT_FILTERS, FiltersBar, filtersQuery, type RadarFilters } from "./filters"
import { RemovedSheet } from "./removed-sheet"
import { sortCompetitors, useCountryIn, useResearchErrorToast, useAgo } from "./parts"

/*
 * /radar (ads-research-v1 "Construção 04/11" + mockup-ads-research.html, spec 2026-11-04). The HookMill finds the
 * competitors by itself (G2): first visit = "Finding your competitors" with the real stage, then who was picked and why
 * (direct × adjacent). Feed: competitor strip, All / Saved, filters, "126 ads · 41 likely winners", the grid sorted by
 * running longest, the detail as a Sheet on `?ad=`. No lime on the feed; lime = Use as champion inside the detail.
 */
const PICKED_KEY = "radar:picked-seen"
const running = (s: string | null | undefined) => s === "QUEUED" || s === "RUNNING"

export function RadarScreen() {
  const t = useTranslations("radar")
  const tt = useTranslations("radar.toast")
  const td = useTranslations("radar.dismiss")
  const errorMessage = useErrorMessage()
  const errToast = useResearchErrorToast()
  const countryIn = useCountryIn()
  const rel = useAgo()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { session } = useSession()
  const readOnly = effectiveRole(session.workspace.role) === "CLIENT"

  const status = useResearchStatus()
  const off = status.data?.mode === "off"
  const disc = useDiscovery()
  const comps = useCompetitors("active", { enabled: !!status.data && !off })
  const removedQ = useCompetitors("dismissed", { enabled: !!status.data && !off })
  const competitors = useMemo(() => sortCompetitors(comps.data?.items ?? []), [comps.data])

  const [selected, setSelected] = useState<string | null>(null)
  const sel = competitors.find((c) => c.id === selected) ?? null
  const [tab, setTab] = useState<"all" | "saved">("all")
  const [filters, setFilters] = useState<RadarFilters>(DEFAULT_FILTERS)
  const query: ListResearchAdsQuery = useMemo(
    () => ({ ...filtersQuery(filters), ...(sel ? { competitorId: [sel.id] } : {}), ...(tab === "saved" ? { saved: true } : {}) }),
    [filters, sel, tab]
  )
  const hasComps = competitors.length > 0
  const ads = useResearchAds(query, { enabled: !off && !!status.data })
  const savedQ = useResearchAds({ saved: true, status: "all", limit: 1 }, { enabled: !off && !!status.data })
  const list = ads.data ? ads.data.pages.flatMap((p) => p.items) : null
  const first = ads.data?.pages[0]

  const save = useSaveAd()
  const dismiss = useDismissCompetitor()
  const restore = useRestoreCompetitor()
  const refresh = useRefreshCompetitor()
  const again = useDiscoverAgain()
  const [dismissing, setDismissing] = useState<Competitor | null>(null)
  const [removedOpen, setRemovedOpen] = useState(false)
  const [pickedSeen, setPickedSeen] = useState<string | null>(() => (typeof window === "undefined" ? null : localStorage.getItem(PICKED_KEY)))

  const adId = sp.get("ad")
  const openAd = (a: Pick<ResearchAdCard, "id">) => router.push(radarHref(a.id), { scroll: false })
  const closeAd = () => router.replace(pathname, { scroll: false })
  const use = (a: Pick<ResearchAdCard, "id">) => router.push(templatesHref({ researchAdId: a.id }))
  const toggleSave = (a: ResearchAdCard) =>
    save.mutate({ ad: a, saved: !a.saved }, { onSuccess: () => toast(!a.saved ? tt("saved") : tt("unsaved")), onError: errToast })

  const st = status.data
  const dv = disc.data
  // the status says a search is running but the discovery read came before it started: read it again (then it polls itself)
  const stRunning = running(st?.discovery.status)
  const dvRunning = running(dv?.last?.status)
  const refetchDisc = disc.refetch
  useEffect(() => {
    if (stRunning && !dvRunning) void refetchDisc()
  }, [stRunning, dvRunning, refetchDisc])
  const last = dv?.last ?? null
  const discRunning = running(last?.status)
  const ctry = countryIn(st?.countryCode ?? last?.countryCode ?? "US")
  const manualAt = dv?.manualAvailableAt && new Date(dv.manualAvailableAt) > now ? dv.manualAvailableAt : null
  const againProps = dv
    ? {
        label: manualAt ? t("bar.searchAgainAt", { date: format.dateTime(new Date(manualAt), { month: "short", day: "numeric" }) }) : t("bar.searchAgain"),
        disabled: readOnly || !dv.manualAllowed || !!manualAt || discRunning || st?.available === false || (!!st && st.spend.monthUsd >= st.spend.capUsd),
        pending: again.isPending,
        note: st?.limits.access === "INTERNAL" ? t("bar.estimate", { usd: dv.estimateUsd.toFixed(2) }) : null,
        onClick: () => again.mutate(undefined, { onSuccess: () => toast(tt("searching")), onError: errToast }),
      }
    : null

  const doDismiss = (reason: Parameters<typeof dismiss.mutate>[0]["reason"]) => {
    const c = dismissing
    if (!c) return
    dismiss.mutate(
      { id: c.id, reason },
      {
        onSuccess: (r) => {
          setDismissing(null)
          if (selected === c.id) setSelected(null)
          if (r.replacement) toast(td("replaced", { name: c.name, next: r.replacement.name }))
          // undo only makes sense while the spot is still free (nobody from the reserve took it)
          else toast(td("done", { name: c.name }), { action: { label: td("undo"), onClick: () => restore.mutate(c.id, { onError: errToast }) } })
        },
        onError: errToast,
      }
    )
  }

  // "Updated 2 h ago · next check Mon 06:00": the freshest good check and the next weekly one
  const lastCheck = competitors.map((c) => c.lastValidSyncAt).filter(Boolean).sort().at(-1) ?? null
  const nextCheck = competitors.map((c) => c.nextSyncAt).filter(Boolean).sort()[0] ?? null
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="m-0 max-w-[62ch] text-fg-2">{t("lede")}</p>
      </div>
      {lastCheck && nextCheck ? (
        <span className="text-xs text-fg-3 max-tablet:hidden">
          {t("updated", { ago: rel(lastCheck), when: format.dateTime(new Date(nextCheck), { weekday: "short", hour: "2-digit", minute: "2-digit" }) })}
        </span>
      ) : null}
    </div>
  )
  const wrap = (children: React.ReactNode) => <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-[var(--gut)] pt-5 pb-16 tablet:pt-6">{children}</div>

  // ── whole-screen states
  if (status.isError)
    return wrap(
      <>
        {header}
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{errorMessage(status.error)}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => status.refetch()}>
              {t("error.retry")}
            </Button>
          </AlertActions>
        </Alert>
      </>
    )
  if (off)
    return wrap(
      <>
        {header}
        <div className="grid justify-items-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-line-strong bg-card px-[18px] py-10 text-center text-fg-2">
          <NavIcon name="radar" size={28} className="text-fg-3" />
          <h2 className="m-0 text-base font-bold text-fg">{t("off.title")}</h2>
          <p className="m-0 max-w-[52ch]">{t("off.body")}</p>
        </div>
      </>
    )

  const firstRun = !!st && (!last || discRunning) && !hasComps && !comps.isPending
  const showPicked = !!last && last.status === "SUCCEEDED" && hasComps && pickedSeen !== last.id && !!last.finishedAt && now.getTime() - new Date(last.finishedAt).getTime() < 3 * 86_400_000
  const capHit = !!st && st.spend.monthUsd >= st.spend.capUsd
  const failedComps = competitors.filter((c) => c.sync?.status === "FAILED")
  const importing = competitors.some((c) => c.activeIsLowerBound && (!sel || sel.id === c.id))

  return wrap(
    <>
      {header}
      {readOnly ? <p className="m-0 text-[13px] text-fg-3">{t("readOnly")}</p> : null}

      {/* the search, first time or "Search again" */}
      {dv && (discRunning || (!last && !hasComps)) ? (
        <DiscoveryProgress view={dv} country={ctry} again={hasComps} />
      ) : null}
      {dv && last?.status === "EMPTY" && !hasComps ? (
        <DiscoveryEmpty country={ctry} onAgain={againProps!.onClick} canAgain={!againProps!.disabled} againLabel={againProps!.label} pending={again.isPending} />
      ) : null}
      {dv && last?.status === "FAILED" ? (
        <DiscoveryFailed onAgain={againProps!.onClick} canAgain={!againProps!.disabled} againLabel={againProps!.label} pending={again.isPending} />
      ) : null}

      {/* budget, quota, a competitor that didn't answer */}
      {capHit ? (
        <Alert variant="warning">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("cap.title")}</AlertTitle>
            <AlertDescription>{t("cap.body")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : st && !st.available && st.reason === "quota" ? (
        <Alert variant="warning">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("quota.title")}</AlertTitle>
            <AlertDescription>{t("quota.body", { date: st.retryAfter ? format.dateTime(new Date(`${st.retryAfter.slice(0, 10)}T12:00:00`), { month: "short", day: "numeric" }) : "—" })}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : null}
      {failedComps.map((c) => (
        <Alert key={c.id} variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("error.compFail", { name: c.name })}</AlertTitle>
            <AlertDescription>{t("error.compFailBody", { ago: c.lastValidSyncAt ? rel(c.lastValidSyncAt) : "—" })}</AlertDescription>
          </AlertBody>
          {readOnly ? null : (
            <AlertActions>
              <Button size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(c.id, { onSuccess: () => toast(tt("refreshing", { name: c.name })), onError: errToast })}>
                {t("error.retry")}
              </Button>
            </AlertActions>
          )}
        </Alert>
      ))}

      {showPicked ? (
        <PickedCard
          competitors={competitors}
          readOnly={readOnly}
          onRemove={setDismissing}
          onClose={() => {
            localStorage.setItem(PICKED_KEY, last!.id)
            setPickedSeen(last!.id)
          }}
        />
      ) : null}

      {firstRun ? null : (
        <>
          {!st || comps.isPending ? (
            <>
              <div className="flex gap-2 overflow-hidden" aria-hidden="true">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className="sk h-10 w-36 flex-none rounded-full" />
                ))}
              </div>
              <AdGrid ads={null} readOnly onOpen={use} onUse={use} onSave={toggleSave} />
            </>
          ) : hasComps || removedQ.data?.items.length ? (
            <CompetitorBar
              competitors={competitors}
              selected={sel?.id ?? null}
              onSelect={setSelected}
              removedCount={removedQ.data?.items.length ?? 0}
              onRemoved={() => setRemovedOpen(true)}
              again={readOnly || !dv?.manualAllowed ? null : againProps}
            />
          ) : null}
          {sel ? (
            <CompetitorPanel
              c={sel}
              readOnly={readOnly}
              canRefresh={st?.limits.refreshEveryHours != null}
              onRemove={() => setDismissing(sel)}
              refreshing={refresh.isPending}
              onRefresh={() => refresh.mutate(sel.id, { onSuccess: () => toast(tt("refreshing", { name: sel.name })), onError: errToast })}
            />
          ) : null}

          {hasComps || (savedQ.data?.pages[0]?.total ?? 0) > 0 ? (
            <>
              <div role="tablist" aria-label={t("tabs.aria")} className="flex gap-0.5 overflow-x-auto border-b border-line [scrollbar-width:none]">
                {(["all", "saved"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className="min-h-11 cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3 py-2.5 font-semibold whitespace-nowrap text-fg-3 aria-selected:border-fg aria-selected:text-fg"
                  >
                    {k === "all" ? t("tabs.all") : t("tabs.saved", { n: savedQ.data?.pages[0]?.total ?? 0 })}
                  </button>
                ))}
              </div>
              <FiltersBar value={filters} onChange={setFilters} total={first?.total ?? null} />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-fg-3">
                <span className="tabular-nums">{first ? t("summary", { total: first.total ?? list?.length ?? 0, winners: first.winners ?? 0 }) : t("loadingAds")}</span>
                {st ? <span>{t("rule", { days: st.winnerDays, versions: st.winnerVersions })}</span> : null}
              </div>
              <Feed
                ads={ads}
                list={list}
                tab={tab}
                sel={sel}
                importing={importing}
                filtersChanged={JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)}
                onClear={() => setFilters(DEFAULT_FILTERS)}
                onPast={() => setFilters({ ...filters, status: "inactive" })}
                onRemoveSel={() => sel && setDismissing(sel)}
                readOnly={readOnly}
                ctry={ctry}
                onOpen={openAd}
                onUse={use}
                onSave={toggleSave}
              />
            </>
          ) : null}
        </>
      )}

      <AdDetailSheet adId={adId} onClose={closeAd} onUse={use} readOnly={readOnly} winnerDays={st?.winnerDays ?? 30} winnerVersions={st?.winnerVersions ?? 5} />
      <DismissDialog key={dismissing?.id ?? "none"} c={dismissing} reserve={st?.limits.reserveCount ?? 0} pending={dismiss.isPending} onCancel={() => setDismissing(null)} onConfirm={doDismiss} />
      <RemovedSheet open={removedOpen} onClose={() => setRemovedOpen(false)} readOnly={readOnly} max={st?.limits.maxCompetitors ?? 5} />
    </>
  )
}

function Feed({
  ads, list, tab, sel, importing, filtersChanged, onClear, onPast, onRemoveSel, readOnly, ctry, onOpen, onUse, onSave,
}: {
  ads: ReturnType<typeof useResearchAds>
  list: ResearchAdCard[] | null
  tab: "all" | "saved"
  sel: Competitor | null
  importing: boolean
  filtersChanged: boolean
  onClear: () => void
  onPast: () => void
  onRemoveSel: () => void
  readOnly: boolean
  ctry: string
  onOpen: (a: ResearchAdCard) => void
  onUse: (a: ResearchAdCard) => void
  onSave: (a: ResearchAdCard) => void
}) {
  const t = useTranslations("radar")
  const errorMessage = useErrorMessage()
  if (ads.isError)
    return (
      <Alert variant="destructive">
        <NavIcon name="alert" size={20} />
        <AlertBody>
          <AlertTitle>{t("error.ads")}</AlertTitle>
          <AlertDescription>{errorMessage(ads.error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => ads.refetch()}>
            {t("error.retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  if (list && !list.length && !importing) {
    const box = (title: string, body: string, actions?: React.ReactNode) => (
      <div className="grid justify-items-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-line-strong bg-card px-[18px] py-8 text-center text-fg-2">
        <h2 className="m-0 text-base font-bold text-fg">{title}</h2>
        <p className="m-0 max-w-[52ch]">{body}</p>
        {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    )
    if (tab === "saved" && !filtersChanged) return box(t("empty.savedTitle"), t("empty.savedBody"))
    if (sel && sel.counts.active === 0 && !filtersChanged)
      return box(
        t("empty.noAdsTitle", { name: sel.name, country: ctry }),
        t("empty.noAdsBody"),
        <>
          {sel.counts.stopped30d > 0 ? (
            <Button size="sm" onClick={onPast}>
              {t("empty.showPast")}
            </Button>
          ) : null}
          {readOnly ? null : (
            <Button size="sm" variant="ghost" onClick={onRemoveSel}>
              {t("comp.remove")}
            </Button>
          )}
        </>
      )
    return box(
      t("empty.nomatchTitle"),
      t("empty.nomatchBody"),
      <Button size="sm" onClick={onClear}>
        {t("empty.clear")}
      </Button>
    )
  }
  return (
    <AdGrid
      ads={list}
      extraSkeletons={importing && tab === "all" ? 4 : 0}
      readOnly={readOnly}
      onOpen={onOpen}
      onUse={onUse}
      onSave={onSave}
      hasMore={ads.hasNextPage}
      loadingMore={ads.isFetchingNextPage}
      onMore={() => ads.fetchNextPage()}
    />
  )
}
