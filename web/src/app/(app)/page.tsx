"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BrainNode, CreativeRow, ResultType, WaitingBatchRef } from "@/lib/api/types"
import { buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { NavIcon } from "@/components/shell/nav-icon"
import { BrainSheet } from "@/components/brain/brain-bits"
import { BrainNodePanel, Tag as BrainTag } from "@/components/brain/brain-drawer"
import { HomeStage, type HomePin } from "@/components/home/home-stage"
import { BrandSummary, Connections, EddyBar, Hello, NextSteps, RecentStrip, type GoalState, type NextStep, type RecentItem } from "@/components/home/home-side"
import { BRAND_KIT_KEY } from "@/components/brand/brand-kit"
import { useSession } from "@/components/providers/session-provider"
import { useMetaGate } from "@/components/meta/meta-gate"
import { useAccountMode, useMe } from "@/hooks/use-me"
import { mk, useMoney, useRelativeTime } from "@/hooks/use-meta"
import { useStatusLabel } from "@/hooks/use-status-label"
import { brainCompleteness } from "@/lib/brain"
import { useActiveOffer } from "@/lib/active-offer"
import { canDraw3D, indexGraph, nodeLabel } from "@/lib/brain-graph"
import { effectiveRole } from "@/lib/dev-role"
import { creativeHref, iterateHref, templatesHref, variarHref } from "@/lib/routes"
import { TEMPLATES } from "@/lib/flags"
import { cn } from "@/lib/utils"

/*
 * Home v2 (design/home-v2-2026-10-31.md + mockup-home-v2.html, approved 31/10): the Brain opens the Home.
 * Center = the globe in "home" mode with the live nodes called out + the Eddy bar (Soon) + a 5-card Recent strip.
 * Right (360 px) = greeting, brand summary with the CPA goal, Next steps (one lime), Connections.
 * Under 761 px of content: one column in the order greeting → brand → Next steps → Brain (300 px) → Eddy → Recent → Connections.
 * The full list with search and filters moved to /creatives (Review = ?filter=needs_you).
 */
const BrainGlobe = dynamic(() => import("@/components/brain/brain-globe"), { ssr: false })

const noop = () => () => {}
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
const hourNow = () => new Date().getHours()

type Drawer = { kind: "node"; id: string } | { kind: "wait"; pin: HomePin; w: WaitItem }
type WaitItem =
  | { kind: "batch"; b: WaitingBatchRef; at: string }
  | { kind: "creative"; c: CreativeRow; at: string }

export default function HomePage() {
  const t = useTranslations("home")
  const tb = useTranslations("onboarding.brain")
  const tw = useTranslations("iterate.waiting")
  const tc = useTranslations("home.cta")
  const statusLabel = useStatusLabel()
  const fmt = useFormatter()
  const rel = useRelativeTime()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const canWrite = role !== "CLIENT"
  const mode = useAccountMode()
  const me = useMe()

  // the content column is under 761 px when the viewport is under 761 + the 248 px sidebar + the shell gaps (36)
  const narrow = useMedia("(max-width: 1044px)")
  const reduced = useMedia("(prefers-reduced-motion: reduce)") ?? false
  const gl0 = useSyncExternalStore(noop, canDraw3D, () => null)
  const [glFailed, setGlFailed] = useState(false)
  const hour = useSyncExternalStore(noop, hourNow, () => null)
  // reference "now" for the 14-day rule (fixed per visit: render stays pure)
  const [openedAt] = useState(() => Date.now())

  const [ws, offers, kit] = useQueries({
    queries: [
      { queryKey: ["workspace"], queryFn: api.workspace.get },
      { queryKey: ["offers"], queryFn: () => api.offers.list() },
      { queryKey: BRAND_KIT_KEY, queryFn: ({ signal }: { signal: AbortSignal }) => api.brandKit.get({ signal }) },
    ],
  })
  const graphQ = useQuery({ queryKey: ["brain", "graph"], queryFn: ({ signal }) => api.brain.graph({}, { signal }), staleTime: 60_000 })
  // same key as the sidebar Review badge (shared cache)
  const waiting = useQuery({
    queryKey: ["creatives", { filter: "needs_you", limit: 6 }],
    queryFn: ({ signal }) => api.creatives.list({ filter: "needs_you", limit: 6 }, { signal }),
    refetchInterval: 30_000,
  })
  const recent = useQuery({
    queryKey: ["creatives", { limit: 5 }],
    queryFn: ({ signal }) => api.creatives.list({ limit: 5 }, { signal }),
    refetchInterval: (q) => (q.state.data?.data.some((c) => c.status === "progress") ? 5_000 : 30_000),
  })
  // lacunas-home-eddy-v1 §5: Iterate batches in Recent come from their own route, merged with the creatives by updatedAt
  const recentBatches = useQuery({
    queryKey: ["iterate", "list", { limit: 5 }],
    queryFn: ({ signal }) => api.iterate.list({ limit: 5 }, { signal }),
    refetchInterval: (q) => (q.state.data?.data.some((b) => ["analyzing", "planning", "generating"].includes(b.stage)) ? 5_000 : 30_000),
  })
  const recentItems: RecentItem[] = useMemo(
    () =>
      [
        ...(recent.data?.data ?? []).map((c) => ({ kind: "creative" as const, c, at: c.updatedAt })),
        ...(recentBatches.data?.data ?? []).map((b) => ({ kind: "batch" as const, b, at: b.updatedAt })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 5),
    [recent.data, recentBatches.data]
  )

  // ── Meta
  const gate = useMetaGate()
  const conn = gate.conn.data
  const usable = gate.state === "ready"
  const summary = useQuery({
    queryKey: mk.summary("30d"),
    queryFn: ({ signal }) => api.meta.summary({ period: "30d" }, { signal }),
    enabled: usable,
    refetchInterval: (q) => {
      const s = q.state.data?.sync.state
      return s === "first_sync" || s === "syncing" ? 5_000 : 30_000
    },
  })
  const sync = summary.data?.sync.state
  // meta-oferta-v1 §8: the winner of the active offer (stored → only one; none = the account's, as before)
  const active = useActiveOffer(session.workspace.id, offers.data?.data)
  const winnerArgs = { verdict: "WINNER" as const, limit: 1, offerId: active.offerId ?? undefined }
  const winnerQ = useQuery({
    queryKey: mk.ads(winnerArgs),
    queryFn: ({ signal }) => api.meta.ads(winnerArgs, { signal }),
    enabled: usable && !!sync && sync !== "first_sync" && sync !== "never" && !offers.isPending,
    refetchInterval: 30_000,
  })
  const top = winnerQ.data?.data[0]
  // an ad of another product is never suggested to iterate (the card falls back as if there were no winner)
  const winnerAd = top?.verdict === "WINNER" && top.offer?.fit !== "other" ? top : null

  // ── waiting items (batches + creatives), oldest first
  const batches = useMemo(() => (waiting.data?.meta.waitingBatches ?? []) as WaitingBatchRef[], [waiting.data])
  const waitRows = useMemo(() => (waiting.data?.data ?? []).filter((c) => c.status === "waiting" || c.status === "failed"), [waiting.data])
  const waits: WaitItem[] = useMemo(
    () =>
      [...batches.map((b) => ({ kind: "batch" as const, b, at: b.updatedAt })), ...waitRows.map((c) => ({ kind: "creative" as const, c, at: c.updatedAt }))].sort((a, b) =>
        a.at.localeCompare(b.at)
      ),
    [batches, waitRows]
  )
  // lacunas-home-eddy-v1 §3: a waiting batch is its own `batch:<id>` node in the graph (linked to the winner it came from)

  const ix = useMemo(() => (graphQ.data ? indexGraph(graphQ.data) : null), [graphQ.data])
  const brain = ws.data && offers.data ? brainCompleteness(ws.data, offers.data.data) : null
  const clientName = ws.data?.name ?? session.workspace.name
  const money = useMoney(winnerAd ? summary.data?.currency : null)

  // ── pins on the globe: 1 winner + the 2 oldest waits (home-v2 §2.3)
  const waitLabel = (w: WaitItem) =>
    w.kind === "batch"
      ? { title: w.b.championName, what: w.b.status === "PIECES_READY" ? tw("PIECES_READY", { n: w.b.readyCount ?? 0 }) : tw(w.b.status) }
      : { title: w.c.name, what: statusLabel(w.c) }
  const pins: HomePin[] = []
  const pinWait = new Map<string, WaitItem>()
  if (ix) {
    const thumbOf = (n: BrainNode) => (n.meta.kind === "creative" || n.meta.kind === "meta_ad" || n.meta.kind === "batch" ? n.meta.thumbnailUrl : null)
    let win = winnerAd ? ix.byId.get(`meta_ad:${winnerAd.metaAdId}`) : undefined
    if (!win) win = ix.nodes.filter((n) => n.winner && n.category !== "center").sort((a, b) => Number(b.kind === "meta_ad") - Number(a.kind === "meta_ad") || b.deg - a.deg)[0]
    if (win) {
      const cpa = win.meta.kind === "meta_ad" ? win.meta.cpa : null
      const cur = win.meta.kind === "meta_ad" ? win.meta.currency : null
      pins.push({ nodeId: win.id, tone: "win", title: nodeLabel(win), sub: cpa != null ? t("stage.winner", { cpa: fmt.number(cpa, { style: "currency", currency: cur ?? "USD" }) }) : t("stage.winnerNoCpa"), thumb: thumbOf(win) })
    }
    const used = new Set(pins.map((p) => p.nodeId))
    for (const w of waits) {
      if (pins.length >= 3) break
      const node: BrainNode | undefined = ix.byId.get(w.kind === "creative" ? `creative:${w.c.id}` : `batch:${w.b.id}`)
      if (!node || used.has(node.id)) continue
      used.add(node.id)
      const l = waitLabel(w)
      pins.push({ nodeId: node.id, tone: "wait", title: l.title, sub: t("stage.waitingWith", { what: l.what }), thumb: thumbOf(node) })
      pinWait.set(node.id, w)
    }
  }
  // amber dot on every node that needs the person (BrainNode.needsYou), plus the pinned waits
  const waitKey = [...new Set([...pins.filter((p) => p.tone === "wait").map((p) => p.nodeId), ...(ix?.nodes.filter((n) => n.needsYou).map((n) => n.id) ?? [])])].join("|")
  const waitIds = useMemo(() => new Set(waitKey ? waitKey.split("|") : []), [waitKey])

  // ── drawer
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  const openPin = (p: HomePin) => {
    const w = pinWait.get(p.nodeId)
    setDrawer(w ? { kind: "wait", pin: p, w } : { kind: "node", id: p.nodeId })
  }
  const waitHref = (w: WaitItem) =>
    w.kind === "batch" ? (w.b.mode === "AUTO" ? iterateHref(w.b.id) : variarHref(w.b.championId, "hooks", w.b.id)) : creativeHref(w.c)
  const waitCta = (w: WaitItem) =>
    w.kind === "batch"
      ? w.b.status === "PIECES_READY" ? tw("download") : w.b.status === "PLAN_READY" ? tw("openPlan") : w.b.mode === "AUTO" ? tw("fix") : tw("open")
      : w.c.step === "generation" && w.c.status === "failed" ? tc("generationFailed", { failed: Number(w.c.statusParams.failed ?? 1) }) : tc(w.c.step === "library" ? "library" : w.c.step)
  const drawerBody =
    drawer && ix ? (
      drawer.kind === "node" ? (
        <BrainNodePanel key={drawer.id} id={drawer.id} ix={ix} canWrite={canWrite} onSelect={(id) => setDrawer({ kind: "node", id })} onClose={() => setDrawer(null)} />
      ) : (
        <WaitPanel pin={drawer.pin} body={drawer.w.kind === "batch" ? `${drawer.w.b.mode === "AUTO" ? tw("kindAuto") : tw("kindManual")} · ${drawer.w.b.offer.name} · ${rel(drawer.w.at)}` : `${drawer.w.c.offer.name} · ${rel(drawer.w.at)}`} cta={{ label: waitCta(drawer.w), href: waitHref(drawer.w) }} onClose={() => setDrawer(null)} />
      )
    ) : null

  // ── goal
  const metaStale = gate.state === "expired" || gate.state === "broken" || sync === "failed" || sync === "stale"
  const goal: GoalState =
    gate.state === "loading" ? { kind: "loading", numbers: false }
    : usable && summary.isPending ? { kind: "loading", numbers: true }
    : gate.state === "off" ? { kind: "off" }
    : !usable || !summary.data || sync === "never" ? { kind: "noMeta" }
    : sync === "first_sync" ? { kind: "reading" }
    : { kind: "data", s: summary.data, stale: metaStale ? summary.data.sync.syncedAt : null }
  const resultNoun = t(`resultNoun.${(ws.data?.resultType ?? "PURCHASE") as ResultType}`)

  // ── next steps (home-v2 §2.6)
  const steps: NextStep[] = []
  const reconnect = canWrite && (gate.state === "expired" || gate.state === "broken" || (usable && (sync === "failed" || sync === "stale")))
  if (reconnect) {
    const at = conn?.lastSyncAt ?? summary.data?.sync.syncedAt ?? null
    steps.push({ key: "reconnect", icon: "!", tone: "warn", title: t("next.reconnectT"), body: at ? t("next.reconnectB", { ago: rel(at) }) : t("next.reconnectB0"), cta: { label: t("next.reconnectCta"), href: "/settings/connections" } })
  }
  let first = false
  // "no iteration batch in the last 14 days" (lacunas-home-eddy-v1 §4: MetaAdRow.lastIteratedAt; an older API without it falls back to championId == null)
  const iteratedRecently = !winnerAd ? false : winnerAd.lastIteratedAt === undefined ? !!winnerAd.championId : !!winnerAd.lastIteratedAt && openedAt - Date.parse(winnerAd.lastIteratedAt) < 14 * 86_400_000
  if (winnerAd && (winnerAd.canIterate ?? !!winnerAd.videoId) && !iteratedRecently) {
    const tg = ws.data?.targetCpa
    const cpa = winnerAd.metrics.cpa
    const inT = tg && cpa != null && cpa >= tg.min && cpa <= tg.max
    steps.push({ key: "iterate", icon: "W", tone: "win", title: active.offer && winnerAd.offer?.fit === "this" ? t("next.iterateOfferT", { offer: active.offer.name }) : t("next.iterateT"), body: cpa == null ? winnerAd.name : t(inT ? "next.iterateIn" : "next.iterateBest", { name: winnerAd.name, cpa: money(cpa) }), cta: canWrite ? { label: t("next.iterateCta"), href: TEMPLATES ? templatesHref({ metaAdId: winnerAd.metaAdId }) : `/iterate/new?metaAdId=${encodeURIComponent(winnerAd.metaAdId)}` } : null })
    first = true
  } else if (canWrite && !usable && recent.data && recent.data.meta.counts.all === 0 && !batches.length) {
    steps.push({ key: "upload", icon: "↑", tone: "win", title: t("next.uploadT"), body: t("next.uploadB"), cta: { label: t("next.uploadCta"), href: TEMPLATES ? templatesHref() : "/iterate/new" } })
    first = true
  }
  for (const w of waits) {
    const l = waitLabel(w)
    steps.push({ key: `${w.kind}:${w.kind === "batch" ? w.b.id : w.c.id}`, icon: w.kind === "batch" ? <NavIcon name="iter" size={14} /> : "S", tone: "wait", title: l.title, body: w.kind === "batch" ? `${l.what} · ${w.b.offer.name}` : `${l.what} · ${w.c.offer.name}`, cta: { label: waitCta(w), href: waitHref(w) } })
  }
  if (usable && sync === "first_sync") {
    const p = summary.data?.sync.progress
    steps.push({ key: "reading", icon: <span className="spin-ring size-3" />, tone: "info", title: t("next.readingT"), body: p ? t("next.readingB", { done: p.done, total: p.total }) : t("next.readingB0"), cta: null })
  }
  if (canWrite && gate.state === "none") steps.push({ key: "connect", icon: "f", tone: "neutral", title: t("next.connectT"), body: t("next.connectB"), cta: { label: t("next.connectCta"), href: "/settings/connections" } })
  if (canWrite && gate.state === "choose") steps.push({ key: "choose", icon: "f", tone: "neutral", title: t("next.chooseT"), body: t("next.chooseB"), cta: { label: t("next.chooseCta"), href: "/settings/connections" } })
  if (canWrite && brain && brain.missing.length) {
    const one = brain.missing.length === 1
    steps.push({
      key: "brain", icon: "B", tone: "neutral",
      title: one ? t("next.brainOneT", { item: tb(`item.${brain.missing[0]}`) }) : t("next.brainT"),
      body: one ? t("next.brainOneB") : t("next.brainB", { count: brain.missing.length, items: brain.missing.slice(0, 3).map((i) => tb(`item.${i}`)).join(", ") }),
      cta: { label: t("next.fill"), href: "/brain" },
    })
  }
  void first // the lime goes to the first step either way (if there's no step 1, to the first item of the list)
  const stepsPending = waiting.isPending || ws.isPending || offers.isPending || gate.state === "loading" || (usable && summary.isPending)
  // BrainNodePanel shows a lime "Iterate this winner" only on a winning video Meta ad (canWrite)
  const openNode = drawer?.kind === "node" ? ix?.byId.get(drawer.id) : undefined
  const drawerHasLime = canWrite && !!openNode?.winner && openNode.meta.kind === "meta_ad" && openNode.meta.isVideo
  const lime = canWrite && !reconnect && !drawerHasLime

  const name = me.data?.user.name?.split(" ")[0] ?? session.user.name?.split(" ")[0] ?? ""
  const hello = hour == null ? t("hello.plain", { name }) : hour < 12 ? t("hello.morning", { name }) : hour < 18 ? t("hello.afternoon", { name }) : t("hello.evening", { name })
  const known = narrow !== null && gl0 !== null
  const gl = !!gl0 && !glFailed

  const stage = known ? (
    <HomeStage
      Globe={BrainGlobe}
      graph={graphQ.data}
      ix={ix}
      status={graphQ.isError && !graphQ.data ? "error" : graphQ.data ? "ready" : "loading"}
      errorText={graphQ.error instanceof Error ? graphQ.error.message : undefined}
      onRetry={() => graphQ.refetch()}
      clientName={clientName}
      percent={brain?.percent ?? null}
      missing={brain?.missing.length ?? 0}
      pins={pins}
      waitIds={waitIds}
      selectedId={drawer?.kind === "node" ? drawer.id : drawer?.kind === "wait" ? drawer.pin.nodeId : null}
      onSelect={(id) => setDrawer(id ? (pinWait.has(id) ? { kind: "wait", pin: pins.find((p) => p.nodeId === id)!, w: pinWait.get(id)! } : { kind: "node", id }) : null)}
      onPin={openPin}
      drawer={narrow ? null : drawerBody}
      narrow={!!narrow}
      reduced={reduced}
      gl={gl}
      onGLFail={() => setGlFailed(true)}
    />
  ) : (
    <span className="sk block h-[300px] rounded-[var(--r-panel)] min-[1045px]:h-[600px]" />
  )

  return (
    <div className="mx-auto max-w-[1240px] px-[var(--gut)] pt-5 pb-16 @container">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @min-[761px]:grid-cols-[minmax(0,1fr)_360px] @min-[761px]:items-start @min-[761px]:gap-4">
        <div className="contents @min-[761px]:flex @min-[761px]:min-w-0 @min-[761px]:flex-col @min-[761px]:gap-3">
          <div className="order-4 @min-[761px]:order-none">{stage}</div>
          <div className="order-5 @min-[761px]:order-none">
            <EddyBar />
          </div>
          <div className="order-6 min-w-0 @min-[761px]:order-none">
            <RecentStrip items={recentItems} total={recent.data?.meta.counts.all ?? null} pending={recent.isPending} error={recent.isError} />
          </div>
        </div>
        <div className="contents @min-[761px]:flex @min-[761px]:min-w-0 @min-[761px]:flex-col @min-[761px]:gap-3">
          <div className="order-1 @min-[761px]:order-none">
            <Hello eyebrow={t(mode === "OWN" ? "eyebrowOwn" : "eyebrowClient", { name: clientName })} title={hello} />
          </div>
          <div className="order-2 @min-[761px]:order-none">
            <BrandSummary ws={ws.data} kit={kit.data} percent={brain?.percent ?? null} goal={goal} resultNoun={resultNoun} />
          </div>
          <div className="order-3 @min-[761px]:order-none">
            <NextSteps steps={steps} pending={stepsPending} lime={lime} count={steps.length} />
          </div>
          <div className="order-7 @min-[761px]:order-none">
            <Connections state={gate.state} conn={conn} canWrite={canWrite} />
          </div>
        </div>
      </div>

      {/* phone: the node drawer as a bottom sheet */}
      <BrainSheet open={!!narrow && !!drawerBody} onClose={() => setDrawer(null)}>
        {narrow ? drawerBody : null}
      </BrainSheet>
    </div>
  )
}

/** Drawer of a "waiting for you" callout: what it is and the one action (mockup D.w1 / D.w2). */
function WaitPanel({ pin, body, cta, onClose }: { pin: HomePin; body: string; cta: { label: string; href: string }; onClose: () => void }) {
  const t = useTranslations("home.stage")
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <BrainTag tone="warn">{t("waiting")}</BrainTag>
          <b id="brain-drawer-title" className="truncate text-[13px]">{pin.title}</b>
        </span>
        <button type="button" onClick={onClose} aria-label={t("close")} className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}>
          <Icon name="x" />
        </button>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {pin.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pin.thumb} alt="" className="aspect-[9/16] w-[110px] rounded-[10px] object-cover" />
        ) : null}
        <span className="text-[13px] text-fg-2">{pin.sub}</span>
        <span className="text-[13px] text-fg-3">{body}</span>
        <Link href={cta.href} className={buttonVariants({ variant: "outline" })}>
          {cta.label}
          <Icon name="arrowr" />
        </Link>
      </div>
    </div>
  )
}
