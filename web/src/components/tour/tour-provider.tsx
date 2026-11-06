"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { TourStopV2 } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ME_KEY } from "@/hooks/use-me"
import { getSession, setSession } from "@/lib/session/token"
import { useSession } from "@/components/providers/session-provider"
import { brainCompleteness } from "@/lib/brain"
import { effectiveRole } from "@/lib/dev-role"
import { templatesHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { NARROW_PX, useTourState, useTourVariant, useTrack } from "./events"
import { clearTourStep, endReplay, isReplay, readTourStep, TOUR_REPLAY_KEY, writeTourStep } from "./tour-state"

/*
 * Tour v2 (design/tour-v2-2026-11-04.md §3, approved 04/11): a short linear tour that ends inside the Templates gallery,
 * unlocked. OWNER/ADMIN/MEMBER: Brain → Templates (pinned on the winner when there is one) → Credits (dropped for an
 * unlimited account). CLIENT: Brain → Review. The provider navigates to the stop's route, waits for the target (3 s →
 * next stop + `tour_stop_missing`), scrolls it ~90 px from the top and draws the spotlight + the coachmark (focus trapped).
 * "Skip tour" on every stop (counts as done); Esc only on a replay, which posts nothing. Finish = POST /workspace/tour/complete
 * and, for the makers, focus on the first checkbox of the gallery. Every stop fires the §6 events.
 */
const ORDER_MAKER: TourStopV2[] = ["brain", "templates", "credits"]
const ORDER_CLIENT: TourStopV2[] = ["brain", "review"]
const V2 = new Set<string>(ORDER_MAKER.concat(ORDER_CLIENT))
/** the pathname the overlay waits for; credits stays on the gallery (no navigation) */
const PATH: Record<TourStopV2, string> = { brain: "/brain", templates: "/templates", credits: "/templates", review: "/creatives" }
const PAD = 8
const COACH_W = 360
const LOAD_MS = 3000

type Target = { sel: string; fallback?: string }
function targetOf(stop: TourStopV2, narrow: boolean): Target {
  switch (stop) {
    case "brain":
      return { sel: narrow ? "#t-brain-summary" : "#t-brain" }
    case "templates":
      // gallery error / empty: the header (it carries data-tour-fallback then)
      return { sel: "#t-templates-grid", fallback: "#t-templates[data-tour-fallback]" }
    case "credits":
      return { sel: narrow ? "#t-credits-pill" : "#t-credits" }
    case "review":
      return { sel: "#t-review-list" }
  }
}
const find = (t: Target) => document.querySelector(t.sel) ?? (t.fallback ? document.querySelector(t.fallback) : null)

function subscribeNarrow(f: () => void) {
  const m = window.matchMedia(`(max-width: ${NARROW_PX}px)`)
  m.addEventListener("change", f)
  return () => m.removeEventListener("change", f)
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(`(max-width: ${NARROW_PX}px)`).matches, () => false)

interface TourCtx {
  active: boolean
  stop: TourStopV2 | null
  replay: boolean
}
const Ctx = createContext<TourCtx>({ active: false, stop: null, replay: false })
export const useTour = () => useContext(Ctx)

export function TourProvider({ children, enabled, clientName }: { children: ReactNode; enabled: boolean; clientName: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const client = role === "CLIENT"
  const narrow = useNarrow()
  const [replay, setReplay] = useState(false)
  const [done, setDone] = useState(false)
  const [index, setIndex] = useState(() => readTourStep())
  // "Replay tour" (Settings / account menu) flags sessionStorage and emits this event
  useEffect(() => {
    const read = () => {
      const r = isReplay()
      setReplay(r)
      if (r) {
        setDone(false)
        setIndex(0)
      }
    }
    read()
    window.addEventListener(TOUR_REPLAY_KEY, read)
    return () => window.removeEventListener(TOUR_REPLAY_KEY, read)
  }, [])
  const wanted = (enabled || replay) && !done
  // the tips read the same query, so it runs even after the tour (CLIENT has no tips: only while the tour is wanted)
  const tour = useTourState(!client || wanted)
  const variant = useTourVariant()
  const track = useTrack()

  // §3.3: nothing until the stops arrive; after 3 s go on with the role's fallback
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!wanted || (tour.data && (client || variant.metaKnown))) return
    const id = window.setTimeout(() => setLate(true), LOAD_MS)
    return () => clearTimeout(id)
  }, [wanted, tour.data, client, variant.metaKnown])

  const winner = tour.data?.winnerMetaAdId ?? null
  const winnerName = tour.data?.winnerName ?? null
  const stops = useMemo(() => {
    const order = client ? ORDER_CLIENT : ORDER_MAKER
    const got = tour.data?.stops as string[] | undefined
    // v2 answer: its stops (order fixed here). A legacy answer (iterate/concepts/eddy/home): the role's order.
    const isV2 = !!got?.some((s) => V2.has(s) && s !== "brain")
    const set = new Set(isV2 ? got : order)
    return order.filter((s) => set.has(s) && !(s === "credits" && variant.credits?.unlimited))
  }, [tour.data, client, variant.credits?.unlimited])
  // also waits for the Meta connection (usually cached) so the events carry the right variant; 3 s cap like the stops
  const ready = (!!tour.data || tour.isError || late) && (client || variant.metaKnown || late)
  const active = wanted && ready && stops.length > 0
  const i = Math.min(index, Math.max(0, stops.length - 1))
  const stop = active ? stops[i] : null

  // ── events
  const t0 = useRef(0)
  const stopAt = useRef(0)
  const started = useRef(false)
  const startSource = useRef<"onboarding" | "replay" | "resume">(readTourStep() > 0 ? "resume" : "onboarding")
  const onViewed = useCallback(
    (s: TourStopV2, n: number, total: number) => {
      stopAt.current = Date.now()
      if (!started.current) {
        started.current = true
        t0.current = Date.now()
        track("tour_started", { source: replay ? "replay" : startSource.current }, replay)
      }
      track("tour_stop_viewed", { stop: s, n, total }, replay)
    },
    [track, replay]
  )

  const complete = useMutation({
    mutationFn: () => api.workspace.completeTour(),
    onSuccess: (r) => {
      const s = getSession()
      if (s) setSession({ ...s, workspace: { ...s.workspace, tourCompletedAt: r.tourCompletedAt } })
      void qc.invalidateQueries({ queryKey: ME_KEY })
    },
  })
  const close = useCallback(() => {
    setDone(true)
    clearTourStep()
    started.current = false
    startSource.current = "onboarding"
    if (replay) {
      endReplay()
      setReplay(false)
    } else complete.mutate()
  }, [replay, complete])
  const finish = useCallback(() => {
    track("tour_completed", { msTotal: Date.now() - t0.current }, replay)
    close()
    // the tour ends on the action: the first checkbox of the gallery (makers)
    if (!client) window.setTimeout(() => document.querySelector<HTMLElement>("#t-templates-grid [role=checkbox]:not([disabled])")?.focus(), 60)
  }, [track, replay, close, client])
  const skip = useCallback(() => {
    if (stop) track("tour_skipped", { stop, n: i + 1 }, replay)
    close()
  }, [track, stop, i, replay, close])
  const go = useCallback(
    (n: number) => {
      if (n >= stops.length) return finish()
      const v = Math.max(0, n)
      writeTourStep(v)
      setIndex(v)
    },
    [stops.length, finish]
  )
  const next = useCallback(() => {
    if (stop) track("tour_stop_next", { stop, msOnStop: Date.now() - stopAt.current }, replay)
    go(i + 1)
  }, [stop, track, replay, go, i])
  const back = useCallback(() => {
    if (stop) track("tour_stop_back", { stop, msOnStop: Date.now() - stopAt.current }, replay)
    go(i - 1)
  }, [stop, track, replay, go, i])
  const missing = useCallback(
    (target: string) => {
      if (stop) track("tour_stop_missing", { stop, target }, replay)
      go(i + 1)
    },
    [stop, track, replay, go, i]
  )

  // route of the stop (credits: only when it isn't already on the gallery, e.g. resuming from elsewhere)
  const href = stop === "brain" ? "/brain" : stop === "review" ? "/creatives?filter=needs_you" : stop ? templatesHref(winner ? { metaAdId: winner } : null) : null
  useEffect(() => {
    if (!stop || !href) return
    if (pathname !== PATH[stop]) router.push(href)
  }, [stop, href, pathname, router])

  return (
    <Ctx.Provider value={{ active: !!stop, stop, replay }}>
      {children}
      {stop && pathname === PATH[stop] ? (
        <Overlay
          key={`${stop}:${narrow}`}
          stop={stop}
          target={targetOf(stop, narrow)}
          n={i + 1}
          total={stops.length}
          replay={replay}
          client={client}
          clientName={clientName}
          winnerName={winnerName}
          onBack={i > 0 ? back : null}
          onNext={next}
          onSkip={skip}
          onMissing={missing}
          onViewed={onViewed}
          last={i === stops.length - 1}
        />
      ) : null}
    </Ctx.Provider>
  )
}

/** The variant texts of a stop (§3.1): sample → winner → default. */
function useCopy(stop: TourStopV2, clientName: string, winnerName: string | null) {
  const t = useTranslations("tour")
  const v = useTourVariant()
  const [ws, offers] = useQueries({
    queries: [
      { queryKey: ["workspace"], queryFn: api.workspace.get, enabled: stop === "brain" },
      { queryKey: ["offers"], queryFn: () => api.offers.list(), enabled: stop === "brain" },
    ],
  })
  const sample = v.credits?.access === "SAMPLE" ? v.credits.sample : null
  const left = sample?.left ?? 0
  const total = sample?.total ?? 0
  switch (stop) {
    case "brain": {
      const missing = ws.data && offers.data ? brainCompleteness(ws.data, offers.data.data).missing.length : null
      return { title: t("brain.title", { name: clientName }), body: missing === null ? t("brain.bodyLoading") : t("brain.body", { missing }) }
    }
    case "templates":
      return {
        title: t("templates.title"),
        body: sample ? t("templates.bodySample", { left }) : winnerName ? t("templates.bodyWinner", { ad: winnerName }) : t("templates.body"),
      }
    case "credits":
      return sample ? { title: t("credits.titleSample"), body: t("credits.bodySample", { left, total }) } : { title: t("credits.title"), body: t("credits.body") }
    case "review":
      return { title: t("review.title"), body: t("review.body", { name: clientName }) }
  }
}

function Overlay({
  stop, target, n, total, replay, client, clientName, winnerName, onBack, onNext, onSkip, onMissing, onViewed, last,
}: {
  stop: TourStopV2; target: Target; n: number; total: number; replay: boolean; client: boolean; clientName: string; winnerName: string | null
  onBack: (() => void) | null; onNext: () => void; onSkip: () => void; onMissing: (target: string) => void
  onViewed: (stop: TourStopV2, n: number, total: number) => void; last: boolean
}) {
  const t = useTranslations("tour")
  const copy = useCopy(stop, clientName, winnerName)
  const elRef = useRef<Element | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [vw, setVw] = useState(0)
  const [vh, setVh] = useState(0)
  const coach = useRef<HTMLDivElement>(null)
  const [coachH, setCoachH] = useState(220)
  const cb = useRef({ onMissing, onViewed })
  useEffect(() => {
    cb.current = { onMissing, onViewed }
  })

  // wait for the target (3 s → skip the stop), scroll it ~90 px from the top and keep its rect current. A target that is
  // replaced (loading → ready, fallback → grid) is picked up again by the observer.
  useEffect(() => {
    let ro: ResizeObserver | null = null
    let raf = 0
    const measure = () => {
      const e = elRef.current
      if (!e) return
      const r = e.getBoundingClientRect()
      // `data-tour-first-row` (the gallery grid): the spotlight stops at the first row of cards
      const first = e.hasAttribute("data-tour-first-row") ? e.firstElementChild?.getBoundingClientRect() : null
      setRect(first && first.bottom > r.top ? new DOMRect(r.left, r.top, r.width, first.bottom - r.top) : r)
      setVw(window.innerWidth)
      setVh(window.innerHeight)
    }
    const attach = (e: Element) => {
      const first = !elRef.current
      ro?.disconnect()
      elRef.current = e
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
      if (first) {
        ;(e as HTMLElement).style.scrollMarginTop = "90px"
        e.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })
      }
      raf = requestAnimationFrame(measure)
      ro = new ResizeObserver(measure)
      ro.observe(e)
    }
    const check = () => {
      const e = find(target)
      if (e && e !== elRef.current) attach(e)
    }
    check()
    const mo = new MutationObserver(check)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["id", "data-tour-fallback"] })
    // capture: the panel shell scrolls #app-scroll, not the window (31/10)
    document.addEventListener("scroll", measure, { passive: true, capture: true })
    window.addEventListener("resize", measure)
    const timer = window.setTimeout(() => {
      if (!elRef.current) {
        mo.disconnect()
        cb.current.onMissing(target.sel)
      }
    }, 3000)
    return () => {
      mo.disconnect()
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      ro?.disconnect()
      document.removeEventListener("scroll", measure, { capture: true })
      window.removeEventListener("resize", measure)
      elRef.current = null
    }
  }, [target])

  useLayoutEffect(() => {
    if (coach.current) setCoachH(coach.current.offsetHeight)
  }, [rect, stop])

  const placed = rect !== null
  useEffect(() => {
    if (!placed) return
    coach.current?.querySelector<HTMLElement>("[data-next]")?.focus()
    cb.current.onViewed(stop, n, total)
  }, [stop, placed, n, total])
  // focus trap + keys: Tab cycles inside, Enter = Next, Esc only on replay
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (replay) onSkip()
      e.preventDefault()
      return
    }
    if (e.key === "Enter" && !(e.target as HTMLElement).matches("[data-back],[data-skip]")) {
      e.preventDefault()
      onNext()
      return
    }
    if (e.key === "Tab") {
      const items = Array.from(coach.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])
      if (!items.length) return
      const idx = items.indexOf(document.activeElement as HTMLElement)
      const nx = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx === items.length - 1 ? 0 : idx + 1
      items[nx].focus()
      e.preventDefault()
    }
  }

  const narrow = vw <= NARROW_PX
  let spot: { top: number; left: number; width: number; height: number } | null = null
  let coachStyle: React.CSSProperties = { visibility: "hidden" }
  if (rect) {
    const maxH = Math.max(120, vh - (narrow ? 300 : 160))
    spot = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: Math.min(rect.height + PAD * 2, maxH) }
    if (narrow) {
      const top = spot.top + spot.height + 14
      coachStyle = top + coachH <= vh - 16 ? { top, left: 16, right: 16, width: "auto" } : { bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: 16, right: 16, width: "auto" }
    } else if (spot.left + spot.width + 16 + COACH_W <= vw - 16) {
      coachStyle = { top: Math.max(16, Math.min(spot.top, vh - coachH - 16)), left: spot.left + spot.width + 16, width: COACH_W }
    } else {
      const top = spot.top + spot.height + 14
      coachStyle = { top: top + coachH <= vh - 16 ? top : Math.max(16, vh - coachH - 16), left: Math.min(Math.max(16, spot.left), vw - COACH_W - 16), width: COACH_W }
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[59]" aria-hidden="true" />
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] rounded-[14px] shadow-[0_0_0_9999px_rgba(22,24,27,0.62),0_0_0_2px_var(--brand)] transition-[top,left,width,height] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
          style={spot}
        />
      ) : null}
      <div
        ref={coach}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        onKeyDown={onKey}
        style={coachStyle}
        className="fixed z-[61] flex max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-[14px] border border-line bg-card p-4 shadow-[0_18px_50px_rgba(21,23,26,0.28)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between gap-2.5">
          <span className="eyebrow">{t("counter", { n, total })}</span>
          <span className="flex gap-1" aria-hidden="true">
            {Array.from({ length: total }, (_, k) => (
              <i key={k} className={cn("size-1.5 rounded-full", k < n ? "bg-fg" : "bg-line-strong")} />
            ))}
          </span>
        </div>
        <h3 id="tour-title" className="wide text-[17px]">{copy.title}</h3>
        <p className="m-0 text-[13.5px] text-fg-2">{copy.body}</p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            data-skip
            onClick={onSkip}
            className="mr-auto min-h-9 cursor-pointer border-0 bg-transparent px-0.5 py-1.5 text-[12.5px] text-fg-3 underline underline-offset-2 hover:text-fg max-tablet:min-h-7 max-tablet:basis-full max-tablet:py-0 max-tablet:text-left"
          >
            {t("skip")}
          </button>
          {onBack ? (
            <Button variant="ghost" size="sm" data-back onClick={onBack} className="max-tablet:flex-1">
              {t("back")}
            </Button>
          ) : null}
          {last ? (
            <Button variant="brand" size="sm" data-next onClick={onNext} className="max-tablet:flex-1">
              {client ? t("finishClient") : t("finish")}
              {client ? <Icon name="check" /> : null}
            </Button>
          ) : (
            <Button variant="default" size="sm" data-next onClick={onNext} className="max-tablet:flex-1">
              {t("next")}
              <Icon name="arrowr" />
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
