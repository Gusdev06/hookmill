"use client"

import { useDeferredValue, useState, type ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Icon } from "@/components/icon"
import { CatDot, Tag } from "@/components/brain/brain-drawer"
import { CAT_COLOR, CATS, rank, searchText, type BrainIndex, type Cat, type GNode } from "@/lib/brain-graph"
import { cn } from "@/lib/utils"

/*
 * List view (spec §2.11): the accessible twin of the globe. Sections per category with the real count, rows with a
 * thumbnail/value and chips, a search on top and the same drawer (Sheet). Default on the phone and without WebGL.
 */
const PAGE = 12

export function BrainList({
  ix,
  ghost,
  onSelect,
  query,
  onQuery,
  leading,
  trailing,
}: {
  ix: BrainIndex
  ghost: (c: Cat) => string
  onSelect: (id: string) => void
  query: string
  onQuery: (q: string) => void
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const t = useTranslations("brain.g")
  const fmt = useFormatter()
  const dq = useDeferredValue(query.trim().toLowerCase())
  const [expanded, setExpanded] = useState<Set<Cat>>(new Set())
  const money = (v: number | null, cur: string | null) => (v == null ? "—" : fmt.number(v, { style: "currency", currency: cur ?? "USD", maximumFractionDigits: 2 }))
  const sub = (n: GNode) => {
    const m = n.meta
    if (m.kind === "meta_ad") return `${money(m.spend30d, m.currency)} · CPA ${money(m.cpa, m.currency)}`
    if (m.kind === "creative") return [t(`status.${m.status}`), m.engine ? t(`engine.${m.engine}`) : null].filter(Boolean).join(" · ")
    if (m.kind === "hook" && m.angle) return m.angle
    return n.summary ?? t("list.connections", { count: n.deg })
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <label className="flex min-h-11 min-w-0 flex-[1_1_240px] items-center gap-2 rounded-[10px] border border-line-strong bg-field px-2.5">
          <Icon name="search" className="text-fg-3" />
          <span className="sr-only">{t("search")}</span>
          <input
            id="brain-list-q"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onQuery("")}
            placeholder={t("search")}
            autoComplete="off"
            className="min-h-10 min-w-0 flex-1 border-0 bg-transparent outline-0"
          />
        </label>
        {trailing}
      </div>
      {CATS.map((c) => {
        const all = (ix.byCat.get(c) ?? []).toSorted(rank)
        const items = dq ? all.filter((n) => searchText(n).includes(dq)) : all
        const open = (dq && items.length > 0) || (!dq && (c === "offers" || c === "hooks" || c === "meta_ads") && all.length > 0)
        const show = expanded.has(c) ? items : items.slice(0, PAGE)
        return (
          <details key={c + (dq ? ":q" : "")} open={open} className="group overflow-hidden rounded-[var(--r-card)] border border-line bg-card">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2.5 px-4 font-bold [&::-webkit-details-marker]:hidden">
              <CatDot cat={c} className="size-2.5" />
              {t(`cat.${c}`)}
              <span className="font-mono text-xs font-medium text-fg-3">{all.length}</span>
              <span className="flex-1" />
              <Icon name="chev" className="text-fg-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            </summary>
            {items.length ? (
              <>
                {show.map((n) => {
                  const m = n.meta
                  const thumb = m.kind === "creative" || m.kind === "meta_ad" ? m.thumbnailUrl : null
                  const media = m.kind === "creative" || m.kind === "meta_ad"
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onSelect(n.id)}
                      className="flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 border-0 border-t border-line-soft bg-transparent px-4 py-2 text-left hover:bg-card-2"
                    >
                      {media ? (
                        <span
                          className={cn("w-6 flex-none rounded bg-cover bg-center", m.kind === "meta_ad" && !m.isVideo ? "aspect-square" : "aspect-[9/16]")}
                          style={{ backgroundColor: "#1E2550", backgroundImage: thumb ? `url("${thumb}")` : undefined }}
                        />
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="truncate font-semibold">{n.label}</b>
                        <small className="truncate text-xs text-fg-3">{sub(n)}</small>
                      </span>
                      {n.winner ? <Tag tone="win">{t("winner")}</Tag> : null}
                      {m.kind === "meta_ad" && m.fromHookMill ? <Tag tone="hm">HM</Tag> : null}
                      <Icon name="chev" className="text-fg-3" />
                    </button>
                  )
                })}
                {items.length > show.length ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => new Set(s).add(c))}
                    className="block min-h-11 w-full cursor-pointer border-0 border-t border-line-soft bg-transparent px-4 text-left text-[13px] font-semibold text-fg-btn hover:bg-card-2"
                  >
                    {t("list.more", { count: items.length - show.length })}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="border-t border-line-soft px-4 py-3 text-[13px] text-fg-3">{all.length ? t("list.nothing") : ghost(c)}</div>
            )}
          </details>
        )
      })}
    </div>
  )
}

/** Phone card "Open the 3D view" (spec §2.12). */
export function Open3DCard({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("brain.g")
  return (
    <button type="button" onClick={onOpen} className="flex w-full cursor-pointer items-center gap-3 rounded-[var(--r-card)] border-0 bg-[#0E1012] p-3 text-left text-[#F2F3EE]">
      <span className="relative size-16 flex-none overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_50%,rgba(120,220,255,.35),transparent_60%),#16191C]" aria-hidden="true">
        {CATS.map((c, i) => (
          <i key={c} className="absolute size-[5px] rounded-full" style={{ background: CAT_COLOR[c], left: 32 + Math.cos(i) * 20, top: 28 + Math.sin(i * 1.7) * 18 }} />
        ))}
      </span>
      <span className="flex flex-1 flex-col">
        <b>{t("open3d")}</b>
        <small className="text-xs text-[#9AA1A9]">{t("open3dSub")}</small>
      </span>
      <Icon name="chev" />
    </button>
  )
}
