"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { TipKey, TourState, TourStateV2 } from "@/lib/api/types"
import { Button, buttonVariants } from "@/components/ui/button"
import { useSession } from "@/components/providers/session-provider"
import { cn } from "@/lib/utils"
import { NARROW_PX, TOUR_KEY, useTourState, useTrack } from "./events"
import { useTour } from "./tour-provider"
import { addLocalTip, readLocalTips, resetTips as resetLocalTips, TIPS_RESET_EVENT } from "./tour-state"

/*
 * tour-v2 §4: contextual tips, once, the first time each step of the path shows up. A dark card anchored on the target with
 * a lime beacon pulsing on it; no overlay, no focus trap. "Got it" (or a click outside, or leaving the screen once it was
 * shown) marks it seen: POST /workspace/tour/tips (+ this device, so a failing API doesn't bring it back). Never during the
 * linear tour, never for CLIENT, one per screen (send > adSource > plan > result > library). Phone (≤760 px): a sheet
 * fixed at the bottom, above the fixed action bar (`[data-action-bar]`). `inline` (inside a modal dialog, where a portal
 * would be inert): the same card in the flow.
 */
const PRIORITY: Record<TipKey, number> = { send: 0, adSource: 1, plan: 2, result: 3, library: 4 }

// ── one tip per screen: the eligible tips claim, the highest priority wins
const claims = new Set<TipKey>()
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}
const leaving = new Map<TipKey, number>()
const topClaim = () => [...claims].sort((a, b) => PRIORITY[a] - PRIORITY[b])[0] ?? null

function useLocalTips() {
  const [local, setLocal] = useState<string[]>([])
  useEffect(() => {
    const read = () => setLocal(readLocalTips())
    read()
    window.addEventListener(TIPS_RESET_EVENT, read)
    return () => window.removeEventListener(TIPS_RESET_EVENT, read)
  }, [])
  return [local, setLocal] as const
}

const tipsOf = (d: TourStateV2 | TourState | undefined) => d?.tipsSeen ?? []

export function useTip(key: TipKey, { when, variant }: { when: boolean; variant: string }) {
  const { session } = useSession()
  const client = session.workspace.role === "CLIENT"
  const tour = useTour()
  const q = useTourState(!client)
  const qc = useQueryClient()
  const track = useTrack()
  const [local, setLocal] = useLocalTips()
  const known = !!q.data || q.isError
  const seen = tipsOf(q.data).includes(key) || local.includes(key)
  const eligible = !client && !tour.active && when && known && !seen
  useEffect(() => {
    if (!eligible) return
    claims.add(key)
    emit()
    return () => {
      claims.delete(key)
      emit()
    }
  }, [eligible, key])
  const top = useSyncExternalStore(subscribe, topClaim, () => null)
  const open = eligible && top === key

  const markSeen = useCallback(() => {
    addLocalTip(key)
    setLocal((l) => (l.includes(key) ? l : [...l, key]))
    qc.setQueryData<TourStateV2 | TourState>(TOUR_KEY, (d) => (d ? { ...d, tipsSeen: [...tipsOf(d).filter((x) => x !== key), key] } : d))
    // fire-and-forget (also runs after the screen unmounted); the local copy keeps it hidden if it fails
    api.workspace.seeTip(key).catch(() => {})
  }, [key, qc, setLocal])

  // events: shown once per opening; leaving the screen while open = dismissed (route_change) and seen
  const shown = useRef(false)
  const state = useRef({ open, track, markSeen, variant })
  useEffect(() => {
    state.current = { open, track, markSeen, variant }
  })
  useEffect(() => {
    if (!open) return
    shown.current = true
    track("tip_shown", { tip: key, tipVariant: variant })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, key])
  useEffect(() => {
    // a remount right after the cleanup (Strict Mode, a re-keyed parent) cancels the pending "left the screen"
    clearTimeout(leaving.get(key))
    leaving.delete(key)
    return () => {
      const s = state.current
      if (!s.open || !shown.current) return
      leaving.set(
        key,
        window.setTimeout(() => {
          leaving.delete(key)
          s.track("tip_dismissed", { tip: key, how: "route_change" })
          s.markSeen()
        }, 0)
      )
    }
  }, [key])

  const dismiss = useCallback(
    (how: "got_it" | "outside") => {
      shown.current = false
      track("tip_dismissed", { tip: key, how })
      markSeen()
    },
    [key, track, markSeen]
  )
  const act = useCallback(
    (action: string) => {
      shown.current = false
      track("tip_action", { tip: key, action })
      markSeen()
    },
    [key, track, markSeen]
  )
  return { open, dismiss, act }
}

/** "Show tips again" (account menu / Settings): DELETE /workspace/tour/tips + this device. */
export function useResetTips() {
  const qc = useQueryClient()
  return useCallback(() => {
    resetLocalTips()
    qc.setQueryData<TourStateV2 | TourState>(TOUR_KEY, (d) => (d ? { ...d, tipsSeen: [] } : d))
    api.workspace
      .resetTips()
      .catch(() => {})
      .finally(() => void qc.invalidateQueries({ queryKey: TOUR_KEY }))
  }, [qc])
}

type TipAction = { label: string; href: string; name: "plans" | "connect_meta" }

export function TourTip({
  tip, when, variant, target, beacon, title, body, action, inline,
}: {
  tip: TipKey
  when: boolean
  /** for the events (default, noMeta, sample, paid, paidNoMeta…) */
  variant: string
  /** CSS selector of the anchor */
  target: string
  /** where the beacon sits (default: the target) */
  beacon?: string
  title: string
  body: string
  action?: TipAction
  inline?: boolean
}) {
  const { open, dismiss, act } = useTip(tip, { when, variant })
  if (!open) return null
  const card = <TipCard title={title} body={body} action={action} onGotIt={() => dismiss("got_it")} onAction={() => act(action!.name)} inline={inline} />
  if (inline) return card
  return <Floating target={target} beacon={beacon ?? target} onOutside={() => dismiss("outside")}>{card}</Floating>
}

function TipCard({ title, body, action, onGotIt, onAction, inline }: { title: string; body: string; action?: TipAction; onGotIt: () => void; onAction: () => void; inline?: boolean }) {
  const t = useTranslations("tip")
  return (
    <div
      role={inline ? "note" : "dialog"}
      aria-labelledby="tour-tip-title"
      className={cn(
        "on-ink grid gap-2 rounded-[14px] border border-ink-line bg-ink p-3.5 text-ink-fg shadow-[0_16px_40px_rgba(21,23,26,0.3)]",
        !inline && "animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
      )}
    >
      <span className="eyebrow flex items-center gap-2 text-ink-fg-3">
        {inline ? <i className="tour-beacon inline-block size-2.5 rounded-full bg-brand" aria-hidden="true" /> : null}
        {t("eyebrow")}
      </span>
      <h3 id="tour-tip-title" className="m-0 text-[15px] font-extrabold">{title}</h3>
      <p className="m-0 text-[13px] text-ink-fg-2">{body}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onGotIt}>
          {t("gotIt")}
        </Button>
        {action ? (
          <Link href={action.href} onClick={onAction} className={buttonVariants({ variant: "brand", size: "sm" })}>
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

const TIP_W = 320

/** Fixed card next to the target (desktop) or a bottom sheet (phone) + the beacon; follows scroll / resize / re-renders. */
function Floating({ target, beacon, onOutside, children }: { target: string; beacon: string; onOutside: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ tip: React.CSSProperties; dot: React.CSSProperties | null } | null>(null)
  const last = useRef("")

  useEffect(() => {
    let raf = 0
    const put = (p: { tip: React.CSSProperties; dot: React.CSSProperties | null } | null) => {
      const k = JSON.stringify(p)
      if (k === last.current) return
      last.current = k
      setPos(p)
    }
    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = document.querySelector(target)
        if (!el) return put(null)
        const r = el.getBoundingClientRect()
        const b = (document.querySelector(beacon) ?? el).getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const th = box.current?.offsetHeight ?? 180
        const dot = b.width || b.height ? { top: b.top - 5, left: b.left + b.width - 7 } : null
        if (vw <= NARROW_PX) {
          const bar = document.querySelector("[data-action-bar]")
          const barH = bar && getComputedStyle(bar).position === "fixed" ? bar.getBoundingClientRect().height + 12 : 0
          put({ tip: { left: 12, right: 12, bottom: barH ? barH : "calc(16px + env(safe-area-inset-bottom, 0px))" }, dot })
          return
        }
        let top = r.top + 12
        let left = r.right + 14
        if (left + TIP_W > vw - 12) {
          left = Math.min(Math.max(12, r.right - TIP_W), vw - TIP_W - 12)
          // below, else above, else over the target's top-right corner (a tall target)
          top = r.bottom + 12 + th <= vh - 12 ? r.bottom + 12 : r.top - th - 12 >= 12 ? r.top - th - 12 : r.top + 12
        }
        top = Math.max(12, Math.min(top, vh - th - 12))
        put({ tip: { top, left, width: TIP_W }, dot })
      })
    }
    measure()
    const mo = new MutationObserver(measure)
    mo.observe(document.body, { childList: true, subtree: true })
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    document.addEventListener("scroll", measure, { passive: true, capture: true })
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(raf)
      mo.disconnect()
      ro.disconnect()
      document.removeEventListener("scroll", measure, { capture: true })
      window.removeEventListener("resize", measure)
    }
  }, [target, beacon])

  // a click outside the card dismisses it (the target included: using it means they got it)
  const outside = useRef(onOutside)
  useEffect(() => {
    outside.current = onOutside
  })
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) outside.current()
    }
    // next tick: the click that made the tip eligible doesn't close it
    const id = window.setTimeout(() => document.addEventListener("pointerdown", down, true), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener("pointerdown", down, true)
    }
  }, [])

  return createPortal(
    <>
      {pos?.dot ? <span aria-hidden="true" className="tour-beacon pointer-events-none fixed z-[44] size-3 rounded-full bg-brand" style={pos.dot} /> : null}
      <div ref={box} className="fixed z-[45] max-w-[calc(100vw-24px)]" style={pos?.tip ?? { visibility: "hidden", top: 0, left: 0, width: TIP_W }}>
        {children}
      </div>
    </>,
    document.body
  )
}
