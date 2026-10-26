"use client"

import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from "react"
import Link from "next/link"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { BrainSheet, MiniRing } from "@/components/brain/brain-bits"
import { BrainKnowsPanel, BrainNodePanel, Tag } from "@/components/brain/brain-drawer"
import type { BrainGlobeProps } from "@/components/brain/brain-globe"
import { BrainList, Open3DCard } from "@/components/brain/brain-list"
import { BrainStage } from "@/components/brain/brain-stage"
import { onboardingHref } from "@/components/onboarding/shared"
import { useSession } from "@/components/providers/session-provider"
import { useTour } from "@/components/tour/tour-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { brainCompleteness } from "@/lib/brain"
import { canDraw3D, CATS, indexGraph, isVisible, type Cat } from "@/lib/brain-graph"
import type { BrainGraph } from "@/lib/api/types"
import { MetaLockCard, isLocked, useMetaGate } from "@/components/meta/meta-gate"

/** The graph without the Meta ads (and their edges); `meta.connected` false so the empty slot says "connect". */
function withoutMetaAds(g: BrainGraph): BrainGraph {
  const gone = new Set(g.nodes.filter((n) => n.kind === "meta_ad").map((n) => n.id))
  return {
    ...g,
    nodes: g.nodes.filter((n) => !gone.has(n.id)),
    edges: g.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
    counts: { ...g.counts, meta_ad: { total: 0, shown: 0 } },
    meta: { ...g.meta, connected: false },
  }
}
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"

/*
 * Brain 3D v1 (brain-3d-v1.md §3-4, spec design/brain-3d-2026-10-22.md, mockup approved 22/10).
 * One globe per workspace on a dark stage; List view as the accessible twin (default on phones and without WebGL);
 * drawer per node type; tour stop 1 replays Grow (~7 s) while the % counts up. The 3D engine arrives as `Globe`
 * (next/dynamic in app/(app)/brain/page.tsx), so three.js is only fetched by this route.
 */
const GROW_MS = 9000
const TOUR_GROW_MS = 7000

// client-only media queries (server snapshot = "unknown" → skeleton, so the phone never mounts the globe by mistake)
function useMedia(q: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(q).matches,
    () => null
  )
}
const noop = () => () => {}

export function BrainScreen({ Globe }: { Globe: ComponentType<BrainGlobeProps> }) {
  const t = useTranslations("brain")
  const tg = useTranslations("brain.g")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const tour = useTour()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const canWrite = role !== "CLIENT"

  const narrow = useMedia("(max-width: 760px)")
  const reduced = useMedia("(prefers-reduced-motion: reduce)") ?? false
  const gl0 = useSyncExternalStore(noop, canDraw3D, () => null)
  const [glFailed, setGlFailed] = useState(false)
  const gl = gl0 !== null && gl0 && !glFailed
  const known = narrow !== null && gl0 !== null

  const graphQ = useQuery({ queryKey: ["brain", "graph"], queryFn: ({ signal }) => api.brain.graph({}, { signal }), staleTime: 60_000 })
  // Gusta 25/10: the Meta ads (spend, CPA) only with the ad account usable. Locked = no meta_ad node at all and the lock card
  const metaGate = useMetaGate()
  const locked = isLocked(metaGate.state)
  const graphData = useMemo(() => (graphQ.data && locked ? withoutMetaAds(graphQ.data) : graphQ.data), [graphQ.data, locked])
  const graph = { ...graphQ, data: graphData } as typeof graphQ
  const [ws, offers] = useQueries({
    queries: [
      { queryKey: ["workspace"], queryFn: api.workspace.get },
      { queryKey: ["offers"], queryFn: () => api.offers.list() },
    ],
  })
  const ix = useMemo(() => (graph.data ? indexGraph(graph.data) : null), [graph.data])
  const brain = ws.data && offers.data ? brainCompleteness(ws.data, offers.data.data) : null
  const clientName = ws.data?.name ?? session.workspace.name

  // ───── view state
  const [view, setView] = useState<"3d" | "list">("3d")
  const [m3d, setM3d] = useState(false)
  const [cats, setCats] = useState<ReadonlySet<Cat>>(() => new Set(CATS))
  const [winners, setWinners] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [knows, setKnows] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [cinema, setCinema] = useState(false)
  const [motionPref, setMotion] = useState<boolean | null>(null)
  const motion = motionPref ?? !reduced
  const [growToken, setGrowToken] = useState(0)
  const [growMs, setGrowMs] = useState(GROW_MS)
  const [listQ, setListQ] = useState("")

  // tour stop 1: 3D view (full screen on the phone), panels closed, Grow ~7 s (adjusted during render, not in an effect)
  const tourBrain = tour.active && tour.stop === "brain"
  const [tourSeen, setTourSeen] = useState(false)
  if (tourBrain !== tourSeen) {
    setTourSeen(tourBrain)
    if (tourBrain) {
      setView("3d")
      setSelectedId(null)
      setKnows(false)
      setGallery(false)
      setCinema(false)
      if (narrow) setM3d(true)
      setGrowMs(TOUR_GROW_MS)
      setGrowToken((x) => x + 1)
    } else if (narrow) setM3d(false)
  }

  const visibleIds = useMemo(() => new Set(ix ? ix.nodes.filter((n) => isVisible(n, { cats, winners }, ix)).map((n) => n.id) : []), [ix, cats, winners])

  const select = (id: string | null) => {
      setKnows(false)
      setGallery(false)
      if (!id || !ix) return setSelectedId(null)
      const n = ix.byId.get(id)
      if (!n) return
      if (n.category === "center") {
        setSelectedId(null)
        setKnows(true)
        return
      }
      // a hidden category comes back; a node outside Winners turns the filter off (mockup select())
      if (!cats.has(n.category as Cat)) setCats((s) => new Set(s).add(n.category as Cat))
      if (winners && !ix.winnerSet.has(id)) setWinners(false)
      setSelectedId(id)
  }
  const onCat = (c: Cat, solo: boolean) => {
    const next = solo ? new Set([c]) : cats.has(c) && cats.size === 1 ? new Set(CATS) : new Set(cats)
    if (!solo && !(cats.has(c) && cats.size === 1)) {
      if (next.has(c)) next.delete(c)
      else next.add(c)
    }
    setCats(next)
    const sel = selectedId && ix?.byId.get(selectedId)
    if (sel && sel.category !== "center" && !next.has(sel.category as Cat)) setSelectedId(null)
  }
  const grow = () => {
    setSelectedId(null)
    setKnows(false)
    setGallery(false)
    setGrowMs(GROW_MS)
    setGrowToken((x) => x + 1)
  }
  const closeDrawer = () => {
    setSelectedId(null)
    setKnows(false)
  }

  const meta = graph.data?.meta
  const ghost = (c: Cat) => {
    if (c === "meta_ads") return !meta?.enabled ? tg("ghost.metaOff") : !meta.connected ? tg("ghost.metaConnect") : tg("ghost.metaEmpty")
    return tg(`ghost.${c}`)
  }

  const listMode = known && (!gl || (narrow ? !m3d : view === "list"))
  const threeD = known && !listMode

  // ───── keyboard: / search · G gallery · D grow · C cinema · Esc closes drawer → gallery → cinema → phone 3D
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      if (e.key === "Escape") {
        if (document.querySelector("[role=dialog][aria-modal=true]")) return
        if (selectedId || knows) closeDrawer()
        else if (gallery) setGallery(false)
        else if (cinema) setCinema(false)
        else return
        e.preventDefault()
        return
      }
      if (typing || tour.active) return
      if (e.key === "/") {
        const q = document.getElementById(threeD ? "brain-q" : "brain-list-q")
        if (q) {
          e.preventDefault()
          q.focus()
        }
        return
      }
      if (!threeD) return
      const k = e.key.toLowerCase()
      if (k === "g" && ix?.nodes.some((n) => n.kind === "creative" || n.kind === "meta_ad")) {
        setSelectedId(null)
        setKnows(false)
        setGallery((g) => !g)
      } else if (k === "d") grow()
      else if (k === "c" && !narrow) setCinema((c) => !c)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  // ───── drawer content (one component, stage card or Sheet)
  const drawerOpen = !!selectedId || knows
  const drawer = drawerOpen ? (
    knows || !selectedId ? (
      <BrainKnowsPanel ws={ws.data} offers={offers.data?.data} clientName={clientName} canWrite={canWrite} onClose={closeDrawer} />
    ) : ix ? (
      <BrainNodePanel key={selectedId} id={selectedId} ix={ix} canWrite={canWrite} onSelect={select} onClose={closeDrawer} />
    ) : null
  ) : null
  const cardDrawer = threeD && !narrow && !cinema && !gallery
  const sheetDrawer = drawerOpen && !cardDrawer && !cinema

  const graphErr = graph.isError && !graph.data
  const stage = (phone: boolean) => (
    <BrainStage
      Globe={Globe}
      status={graphErr ? "error" : graph.data ? "ready" : "loading"}
      errorText={graphErr ? errorMessage(graph.error) : undefined}
      onRetry={() => graph.refetch()}
      graph={graph.data}
      ix={ix}
      visibleIds={visibleIds}
      clientName={clientName}
      percent={brain?.percent ?? null}
      missing={brain?.missing.length ?? 0}
      cats={cats}
      winners={winners}
      onCat={onCat}
      onWinners={() => {
        setWinners((w) => !w)
        if (selectedId && !winners && ix && !ix.winnerSet.has(selectedId)) setSelectedId(null)
      }}
      ghost={ghost}
      selectedId={selectedId}
      onSelect={select}
      onKnows={() => {
        setSelectedId(null)
        setGallery(false)
        setKnows(true)
      }}
      gallery={gallery}
      onGallery={(g) => {
        setSelectedId(null)
        setKnows(false)
        setGallery(g)
      }}
      cinema={cinema}
      onCinema={(c) => {
        setSelectedId(null)
        setGallery(false)
        setCinema(c)
      }}
      motion={motion}
      onMotion={() => setMotion(!motion)}
      reduced={reduced}
      lite={phone}
      growToken={growToken}
      growMs={growMs}
      onGrow={grow}
      onGrowEnd={() => {}}
      onList={() => {
        closeDrawer()
        setGallery(false)
        setView("list")
      }}
      onGLFail={() => setGlFailed(true)}
      canWrite={canWrite}
      tourBrain={tourBrain}
      phone={phone}
      drawer={cardDrawer ? drawer : null}
    />
  )

  const listErr = graphErr ? (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{tg("errT")}</AlertTitle>
        <AlertDescription>{errorMessage(graph.error)}</AlertDescription>
      </AlertBody>
      <AlertActions>
        <Button size="sm" onClick={() => graph.refetch()}>
          <Icon name="refresh" />
          {tg("retry")}
        </Button>
      </AlertActions>
    </Alert>
  ) : null

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-[var(--gut)] pt-5 pb-16 tablet:pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="eyebrow">{clientName}</span>
          <h1 className="flex flex-wrap items-center gap-2">
            {t("title")}
            {!canWrite ? (
              <Tag tone="neutral">
                <Icon name="lock" className="size-3" />
                {tg("viewOnly")}
              </Tag>
            ) : null}
          </h1>
          <p className="m-0 max-w-[640px] text-fg-3 text-pretty">{tg("lede", { client: clientName })}</p>
        </div>
        {canWrite ? (
          <div className="grid w-full grid-cols-2 gap-2 tablet:flex tablet:w-auto tablet:flex-wrap">
            <Link href={onboardingHref(1)} className={buttonVariants({ variant: "outline" })}>
              <Icon name="refresh" />
              {t("revisit")}
            </Link>
            <Link href="/offers" className={buttonVariants({ variant: "default" })}>
              {t("editOffer")}
            </Link>
          </div>
        ) : null}
      </div>

      {locked ? <MetaLockCard state={metaGate.state} compact /> : null}

      {!known ? (
        <span className="sk h-[660px] rounded-[var(--r-panel)] max-tablet:h-64" />
      ) : threeD && !narrow ? (
        stage(false)
      ) : (
        <div id={threeD ? undefined : "t-brain"} className="flex flex-col gap-3">
          {!gl ? (
            <Alert variant="info">
              <Icon name="info" />
              <AlertBody>
                <AlertDescription>{tg("nogl")}</AlertDescription>
              </AlertBody>
            </Alert>
          ) : null}
          {narrow && gl && graph.data ? <Open3DCard onOpen={() => setM3d(true)} /> : null}
          {listErr ??
            (ix ? (
              <BrainList
                ix={ix}
                ghost={ghost}
                onSelect={select}
                query={listQ}
                onQuery={setListQ}
                leading={
                  <button type="button" onClick={() => setKnows(true)} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[#2E3238] bg-[#0E1012] py-2 pr-3 pl-2 text-left text-[#F2F3EE]">
                    {brain ? <MiniRing percent={brain.percent} /> : <span className="size-10 rounded-full border-[5px] border-[#2E3238]" />}
                    <span className="flex flex-col">
                      <b>{brain ? tg("known", { pct: brain.percent }) : "…"}</b>
                      <small className="text-xs text-[#9AA1A9]">{tg("missing", { count: brain?.missing.length ?? 0 })}</small>
                    </span>
                  </button>
                }
                trailing={
                  !narrow && gl ? (
                    <div className="inline-flex flex-none gap-0.5 rounded-[11px] border border-line bg-card-2 p-0.5" role="group" aria-label={tg("tools.toolbar")}>
                      <button type="button" aria-pressed={false} onClick={() => setView("3d")} className="min-h-8 cursor-pointer rounded-[9px] border-0 bg-transparent px-2.5 text-[13px] font-semibold text-fg-btn">
                        {tg("tools.view3d")}
                      </button>
                      <button type="button" aria-pressed={true} className="min-h-8 rounded-[9px] border-0 bg-card px-2.5 text-[13px] font-semibold text-fg shadow-[0_0_0_1px_var(--line-strong)]">
                        {tg("tools.list")}
                      </button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <div className="flex flex-col gap-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="sk h-[52px] rounded-[var(--r-card)]" />
                ))}
              </div>
            ))}
        </div>
      )}

      {/* phone: the 3D in full screen, "← List" to go back (spec §2.12) */}
      {known && narrow && threeD ? (
        <div className="fixed inset-0 z-[58] bg-[#0E1012]">
          {stage(true)}
          <button
            type="button"
            onClick={() => {
              closeDrawer()
              setGallery(false)
              setM3d(false)
            }}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "absolute top-[calc(14px+env(safe-area-inset-top,0px))] left-3.5 z-[9]")}
          >
            <Icon name="left" />
            {tg("tools.list")}
          </button>
        </div>
      ) : null}

      <BrainSheet open={sheetDrawer} onClose={closeDrawer}>
        {sheetDrawer ? drawer : null}
      </BrainSheet>
    </div>
  )
}
