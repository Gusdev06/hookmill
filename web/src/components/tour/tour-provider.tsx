"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { TourStop } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ME_KEY } from "@/hooks/use-me"
import { getSession, setSession } from "@/lib/session/token"
import { cn } from "@/lib/utils"
import { clearTourStep, endReplay, isReplay, readTourStep, TOUR_REPLAY_KEY, writeTourStep } from "./tour-state"

/*
 * First-run tour (onboarding-v2 §3.4, spec decision 9 + "padrão do coachmark"): 5 stops over the real screens,
 * Brain → Iterate a winner (only when `stops` has `iterate`) → New concepts → Eddy → Home. The provider navigates to the
 * stop's route, waits for the target id (MutationObserver, 3 s timeout → next stop), scrolls it ~90 px from the top and
 * draws the spotlight (box-shadow 9999 px) + the coachmark (dialog, focus trapped). No skip, no X, no Esc the first
 * time; "Replay tour" allows Esc and posts nothing. Finish = POST /workspace/tour/complete.
 */
const ORDER: TourStop[] = ["brain", "iterate", "concepts", "eddy", "home"]
const ROUTE: Record<TourStop, string> = { brain: "/brain", iterate: "/iterate/new", concepts: "/creatives/new", eddy: "/eddy", home: "/" }
const TARGET: Record<TourStop, string> = { brain: "#t-brain", iterate: "#t-winner", concepts: "#t-concepts", eddy: "#t-eddy", home: "#t-kpis" }
const PAD = 8
const COACH_W = 360
const NARROW = 760

interface TourCtx {
  active: boolean
  stop: TourStop | null
  replay: boolean
}
const Ctx = createContext<TourCtx>({ active: false, stop: null, replay: false })
export const useTour = () => useContext(Ctx)

export function TourProvider({ children, enabled, clientName }: { children: ReactNode; enabled: boolean; clientName: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const [replay, setReplay] = useState(false)
  const [done, setDone] = useState(false)
  // "Replay tour" (Settings / account menu) flags sessionStorage and emits this event
  useEffect(() => {
    const read = () => setReplay(isReplay())
    read()
    window.addEventListener(TOUR_REPLAY_KEY, read)
    return () => window.removeEventListener(TOUR_REPLAY_KEY, read)
  }, [])
  const wanted = (enabled || replay) && !done
  const tour = useQuery({ queryKey: ["workspace", "tour"], queryFn: ({ signal }) => api.workspace.tour({ signal }), enabled: wanted, staleTime: 60_000 })
  const stops = useMemo(() => {
    const got = tour.data?.stops
    const set = new Set(got ?? [])
    return ORDER.filter((s) => (got ? set.has(s) : s !== "iterate"))
  }, [tour.data])
  const active = wanted && (!!tour.data || tour.isError) && stops.length > 0
  const [index, setIndex] = useState(() => readTourStep())
  const i = Math.min(index, Math.max(0, stops.length - 1))
  const stop = active ? stops[i] : null

  const complete = useMutation({
    mutationFn: () => api.workspace.completeTour(),
    onSuccess: (r) => {
      const s = getSession()
      if (s) setSession({ ...s, workspace: { ...s.workspace, tourCompletedAt: r.tourCompletedAt } })
      void qc.invalidateQueries({ queryKey: ME_KEY })
    },
  })
  const finish = useCallback(() => {
    setDone(true)
    clearTourStep()
    if (replay) {
      endReplay()
      setReplay(false)
    } else complete.mutate()
  }, [replay, complete])
  const go = useCallback(
    (n: number) => {
      if (n >= stops.length) return finish()
      const v = Math.max(0, n)
      writeTourStep(v)
      setIndex(v)
    },
    [stops.length, finish]
  )

  const skipMissing = useCallback(() => go(i + 1), [go, i])

  // route of the stop
  useEffect(() => {
    if (!stop) return
    if (pathname !== ROUTE[stop]) router.push(ROUTE[stop])
  }, [stop, pathname, router])

  return (
    <Ctx.Provider value={{ active: !!stop, stop, replay }}>
      {children}
      {stop && pathname === ROUTE[stop] ? (
        <Overlay key={stop} stop={stop} n={i + 1} total={stops.length} replay={replay} clientName={clientName} onBack={i > 0 ? () => go(i - 1) : null} onNext={() => go(i + 1)} onSkipMissing={skipMissing} last={i === stops.length - 1} />
      ) : null}
    </Ctx.Provider>
  )
}

function Overlay({
  stop, n, total, replay, clientName, onBack, onNext, onSkipMissing, last,
}: {
  stop: TourStop; n: number; total: number; replay: boolean; clientName: string
  onBack: (() => void) | null; onNext: () => void; onSkipMissing: () => void; last: boolean
}) {
  const t = useTranslations("tour")
  const elRef = useRef<Element | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [vw, setVw] = useState(0)
  const [vh, setVh] = useState(0)
  const coach = useRef<HTMLDivElement>(null)
  const [coachH, setCoachH] = useState(220)

  // wait for the target (MutationObserver, 3 s → skip the stop), scroll it ~90 px from the top and keep its rect current
  useEffect(() => {
    const sel = TARGET[stop]
    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null
    let raf = 0
    let timer = 0
    const measure = () => {
      const e = elRef.current
      if (!e) return
      setRect(e.getBoundingClientRect())
      setVw(window.innerWidth)
      setVh(window.innerHeight)
    }
    const attach = (e: Element) => {
      elRef.current = e
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
      ;(e as HTMLElement).style.scrollMarginTop = "90px"
      e.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })
      raf = requestAnimationFrame(measure)
      ro = new ResizeObserver(measure)
      ro.observe(e)
      window.addEventListener("scroll", measure, { passive: true })
      window.addEventListener("resize", measure)
    }
    const now = document.querySelector(sel)
    if (now) attach(now)
    else {
      mo = new MutationObserver(() => {
        const e = document.querySelector(sel)
        if (e) {
          mo?.disconnect()
          attach(e)
        }
      })
      mo.observe(document.body, { childList: true, subtree: true })
      timer = window.setTimeout(() => {
        mo?.disconnect()
        if (!elRef.current) {
          console.warn(`[tour] target ${sel} not found in 3 s; skipping stop "${stop}"`)
          onSkipMissing()
        }
      }, 3000)
    }
    return () => {
      mo?.disconnect()
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener("scroll", measure)
      window.removeEventListener("resize", measure)
      elRef.current = null
    }
  }, [stop, onSkipMissing])

  useLayoutEffect(() => {
    if (coach.current) setCoachH(coach.current.offsetHeight)
  }, [rect, stop])

  // focus trap + keys: Tab cycles inside, Enter = Next, Esc only on replay
  const placed = rect !== null
  useEffect(() => {
    if (placed) coach.current?.querySelector<HTMLElement>("[data-next]")?.focus()
  }, [stop, placed])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (replay) onNext()
      e.preventDefault()
      return
    }
    if (e.key === "Enter" && !(e.target as HTMLElement).matches("[data-back]")) {
      e.preventDefault()
      onNext()
      return
    }
    if (e.key === "Tab") {
      const items = Array.from(coach.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])
      if (!items.length) return
      const idx = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx === items.length - 1 ? 0 : idx + 1
      items[next].focus()
      e.preventDefault()
    }
  }

  const narrow = vw <= NARROW
  let spot: { top: number; left: number; width: number; height: number } | null = null
  let coachStyle: React.CSSProperties = { visibility: "hidden" }
  if (rect) {
    const maxH = Math.max(120, vh - 160)
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
  const title = t(`${stop}.title`, { name: clientName })
  const body = t(`${stop}.body`, { name: clientName })

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
        className="fixed z-[61] flex max-w-[calc(100vw-32px)] flex-col gap-2.5 rounded-xl border border-line bg-card p-[18px] shadow-[0_18px_50px_rgba(21,23,26,0.28)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between gap-2.5">
          <span className="eyebrow">{t("counter", { n, total })}</span>
          <span className="flex gap-1" aria-hidden="true">
            {Array.from({ length: total }, (_, k) => (
              <i key={k} className={cn("size-1.5 rounded-full", k < n ? "bg-fg" : "bg-line-strong")} />
            ))}
          </span>
        </div>
        <h3 id="tour-title" className="wide text-[17px]">{title}</h3>
        <p className="m-0 text-fg-2">{body}</p>
        <div className="flex flex-wrap justify-end gap-2 pt-1 [&>*]:flex-1 tablet:[&>*]:flex-none">
          {onBack ? (
            <Button variant="ghost" size="sm" data-back onClick={onBack} className="tablet:mr-auto">
              {t("back")}
            </Button>
          ) : null}
          {last ? (
            <Button variant="brand" data-next onClick={onNext}>
              {t("finish")}
              <Icon name="check" />
            </Button>
          ) : (
            <Button variant="default" data-next onClick={onNext}>
              {t("next")}
              <Icon name="arrowr" />
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
