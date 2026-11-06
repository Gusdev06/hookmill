"use client"

import { useEffect, useState } from "react"
import { CAT_COLOR, LIME } from "@/lib/brain-graph"

/*
 * Mini Brain of the Eddy panel (02/11, Gusta: "um mini cérebro pra ele ver as informações sendo inseridas em tempo real").
 * Same language as the Home stage (dark stage, lime client orb, orbits, category colors), but driven by the panel items,
 * not by the graph: every item is a satellite of its section hub. Hollow = unknown, pulsing = being read, amber = read and
 * waiting for you, lime = confirmed. When an item turns lime it "lands" with a ring. Plain SVG, no WebGL; the globe sways
 * slowly (still under prefers-reduced-motion).
 */

export type MiniState = "on" | "part" | "reading" | "none"
export interface MiniSection { key: string; items: { key: string; state: MiniState }[] }

const HUB_COLOR: Record<string, string> = {
  business: CAT_COLOR.business, offer: CAT_COLOR.offers, audience: CAT_COLOR.audience, proof: CAT_COLOR.business,
  goals: CAT_COLOR.goals, meta: CAT_COLOR.meta_ads, kit: CAT_COLOR.scripts,
}
const AMBER = "#F2B33D"
const W = 340
const H = 190
const CX = W / 2
const CY = H / 2

function useRotation() {
  const [rot, setRot] = useState(0)
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      acc += now - last
      last = now
      // ~30 fps is plenty for a slow sway; one full turn ≈ 60 s
      if (acc > 33) {
        setRot((r) => (r + (acc / 60_000) * Math.PI * 2) % (Math.PI * 2))
        acc = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return rot
}

const statesOf = (sections: MiniSection[]) => Object.fromEntries(sections.flatMap((s) => s.items.map((i) => [i.key, i.state] as const)))

/** 3D point on a tilted orbit → screen x/y + depth (0 back … 1 front) */
function project(angle: number, radius: number, lift: number) {
  const x = Math.cos(angle) * radius
  const z = Math.sin(angle) * radius
  const depth = (z / radius + 1) / 2
  return { x: CX + x, y: CY + z * 0.38 + lift, depth }
}

export function MiniBrain({ sections, label }: { sections: MiniSection[]; label: string }) {
  const rot = useRotation()
  // items that just turned lime get a landing ring (keyed by a counter so the CSS animation replays)
  // (state adjusted during render when the items change, React's "storing information from previous renders" pattern)
  const sig = sections.map((s) => s.items.map((i) => `${i.key}:${i.state}`).join(",")).join("|")
  const [seen, setSeen] = useState<{ sig: string; states: Record<string, MiniState> }>(() => ({ sig, states: statesOf(sections) }))
  const [landed, setLanded] = useState<Record<string, number>>({})
  if (seen.sig !== sig) {
    const states = statesOf(sections)
    const next: Record<string, number> = {}
    for (const [k, st] of Object.entries(states)) if (st === "on" && seen.states[k] !== undefined && seen.states[k] !== "on") next[k] = (landed[k] ?? 0) + 1 // counter = replay key of the ring
    setSeen({ sig, states })
    if (Object.keys(next).length) setLanded((l) => ({ ...l, ...next }))
  }

  const n = sections.length
  const hubs = sections.map((s, si) => {
    const a = rot + (si / n) * Math.PI * 2
    const hub = project(a, 118, -6)
    const items = s.items.map((it, ii) => {
      const spread = s.items.length > 1 ? (ii / (s.items.length - 1) - 0.5) * 0.9 : 0
      const p = project(a + spread * 0.55, 118 + 30 + (ii % 2) * 8, -6 + spread * 26)
      return { ...it, ...p }
    })
    const on = s.items.filter((i) => i.state === "on").length
    return { key: s.key, color: HUB_COLOR[s.key] ?? CAT_COLOR.business, hub, items, on, total: s.items.length }
  })
  // painter's order: back first
  const order = [...hubs].sort((a, b) => a.hub.depth - b.hub.depth)
  const anyOn = hubs.some((h) => h.on > 0)

  return (
    <div className="relative overflow-hidden rounded-[14px] border border-ink-line bg-[#0E1012]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        <defs>
          <radialGradient id="mb-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={LIME} stopOpacity="0.95" />
            <stop offset="45%" stopColor={LIME} stopOpacity="0.35" />
            <stop offset="100%" stopColor={LIME} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* orbits */}
        <ellipse cx={CX} cy={CY - 6} rx={118} ry={118 * 0.38} fill="none" stroke="#2A2E33" strokeWidth={1} />
        <ellipse cx={CX} cy={CY - 6} rx={150} ry={150 * 0.38} fill="none" stroke="#1F2327" strokeWidth={1} strokeDasharray="2 4" />

        {order.map((h) => {
          const o = 0.35 + h.hub.depth * 0.65
          return (
            <g key={h.key} opacity={o}>
              <line x1={CX} y1={CY} x2={h.hub.x} y2={h.hub.y} stroke={h.on ? h.color : "#3A3F45"} strokeOpacity={h.on ? 0.55 : 0.5} strokeWidth={h.on ? 1.2 : 0.8} />
              {h.items.map((i) => (
                <line key={`l-${i.key}`} x1={h.hub.x} y1={h.hub.y} x2={i.x} y2={i.y} stroke={i.state === "on" ? LIME : "#33383E"} strokeOpacity={i.state === "on" ? 0.6 : 0.45} strokeWidth={0.8} />
              ))}
              <circle cx={h.hub.x} cy={h.hub.y} r={4 + h.hub.depth * 2} fill={h.color} fillOpacity={h.on ? 1 : 0.35} />
              {h.items.map((i) => {
                const r = 2 + i.depth * 1.6
                const at = landed[i.key]
                return (
                  <g key={i.key}>
                    {i.state === "on" ? (
                      <circle cx={i.x} cy={i.y} r={r} fill={LIME} />
                    ) : i.state === "part" ? (
                      <circle cx={i.x} cy={i.y} r={r} fill={AMBER} />
                    ) : i.state === "reading" ? (
                      <circle cx={i.x} cy={i.y} r={r} fill="none" stroke={LIME} strokeWidth={1} className="animate-pulse motion-reduce:animate-none" />
                    ) : (
                      <circle cx={i.x} cy={i.y} r={r} fill="none" stroke="#5A6068" strokeWidth={1} />
                    )}
                    {at !== undefined ? (
                      <circle key={at} cx={i.x} cy={i.y} r={r} fill="none" stroke={LIME} strokeWidth={1.5} className="mb-land" />
                    ) : null}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* client orb */}
        <circle cx={CX} cy={CY} r={26} fill="url(#mb-core)" opacity={anyOn ? 1 : 0.6} />
        <circle cx={CX} cy={CY} r={6} fill={LIME} />
      </svg>
      <style>{`
        .mb-land { transform-box: fill-box; transform-origin: center; animation: mb-land 1.2s cubic-bezier(.2,.7,.2,1) forwards; }
        @keyframes mb-land { from { transform: scale(1); opacity: 1 } to { transform: scale(5); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { .mb-land { animation: none; opacity: 0 } }
      `}</style>
    </div>
  )
}
