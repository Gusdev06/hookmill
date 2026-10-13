"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** ThinkingOrbs stand-in (Scripts wait). */
export function ThinkingOrb() {
  return (
    <div className="orb" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}

/** ImageGeneration stand-in: pixel blocks resolving into a silhouette (Avatar tiles, scene thumb). Ported from the mockup. */
export function GenCanvas({ seed, width = 160, height = 200, className }: { seed: number; width?: number; height?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const x = c?.getContext("2d")
    if (!c || !x) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const t0 = performance.now()
    let raf = 0
    const draw = (now: number) => {
      const tt = (now - t0) / 1000
      const w = c.width
      const h = c.height
      const phase = (tt * 0.35 + seed * 0.21) % 1
      const bs = Math.max(3, Math.round(22 - phase * 19))
      for (let yy = 0; yy < h; yy += bs) {
        for (let xx = 0; xx < w; xx += bs) {
          const dx = (xx - w / 2) / (w * 0.28)
          const dy = (yy - h * 0.45) / (h * 0.24)
          const face = Math.max(0, 1 - (dx * dx + dy * dy))
          const body = yy > h * 0.68 ? Math.max(0, 1 - Math.abs(xx - w / 2) / (w * 0.42)) : 0
          let n = Math.sin(xx * 12.9898 + yy * 78.233 + seed * 37 + Math.floor(tt * 6)) * 43758.5453
          n -= Math.floor(n)
          const v = Math.round(18 + n * 28 * (1 - phase) + face * 120 * phase + body * 60 * phase)
          x.fillStyle = `rgb(${v},${v},${Math.min(255, v + 6)})`
          x.fillRect(xx, yy, bs, bs)
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [seed])
  return <canvas ref={ref} width={width} height={height} className={cn("block size-full", className)} aria-hidden="true" />
}

/** Checklist of a real stage (spec §2.5). done = green check, now = spinner, todo = empty ring. */
export function Checklist({ items, className }: { items: { label: React.ReactNode; state: "done" | "now" | "todo" }[]; className?: string }) {
  return (
    <ul className={cn("m-0 grid list-none gap-2 p-0 text-[13px]", className)}>
      {items.map((it, i) => (
        <li key={i} className={cn("flex items-center gap-2", it.state === "todo" ? "text-fg-2" : "text-fg")}>
          {it.state === "done" ? (
            <svg viewBox="0 0 16 16" className="size-4 flex-none text-status-approved" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          ) : it.state === "now" ? (
            <span className="spin-ring m-px size-3.5 flex-none" aria-hidden="true" />
          ) : (
            <span className="m-px size-3.5 flex-none rounded-full border-[1.5px] border-line-2" aria-hidden="true" />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  )
}

export function checklistStates(done: boolean[]): ("done" | "now" | "todo")[] {
  const firstOpen = done.indexOf(false)
  return done.map((d, i) => (d ? "done" : i === firstOpen ? "now" : "todo"))
}
