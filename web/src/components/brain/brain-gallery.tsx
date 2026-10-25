"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Icon } from "@/components/icon"
import { hookOfNode, isMediaNode, offerOfNode, rank, type BrainIndex, type GNode } from "@/lib/brain-graph"
import { cn } from "@/lib/utils"

/*
 * Creatives gallery (`G`, spec §2.9): covers the stage like the skill. Creatives with a render and video Meta ads, winners
 * first, filters by offer and by state with counts; 9:16 cards. Clicking opens the drawer with the player.
 */
type St = "all" | "win" | "running" | "approved" | "review"
const STS: St[] = ["all", "win", "running", "approved", "review"]
const okSt = (n: GNode, s: St) =>
  s === "all" || (s === "win" && n.winner) || (s === "running" && n.kind === "meta_ad") || (s === "approved" && n.meta.kind === "creative" && n.meta.status === "approved") || (s === "review" && n.meta.kind === "creative" && n.meta.status === "in_review")

export function BrainGallery({ ix, selectedId, onPick, onClose }: { ix: BrainIndex; selectedId: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTranslations("brain.g")
  const tg = useTranslations("brain.g.gallery")
  const fmt = useFormatter()
  const [offer, setOffer] = useState("all")
  const [st, setSt] = useState<St>("all")
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => head.current?.focus({ preventScroll: true }), [])
  const items = useMemo(() => ix.nodes.filter(isMediaNode).sort(rank), [ix])
  const offers = useMemo(() => (ix.byCat.get("offers") ?? []).filter((o) => items.some((n) => offerOfNode(ix, n) === o.id)), [ix, items])
  const byOffer = items.filter((n) => offer === "all" || offerOfNode(ix, n) === offer)
  const list = byOffer.filter((n) => okSt(n, st))
  const chip = (on: boolean) => cn("inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", on ? "border-[#F2F3EE] bg-[#F2F3EE] text-[#15171A]" : "border-[#2E3238] bg-transparent text-[#C5CAD0]")
  return (
    <div role="dialog" aria-labelledby="brain-gal-title" className="absolute inset-0 z-[6] flex flex-col gap-3 overflow-hidden bg-[rgba(14,16,18,.96)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="brain-gal-title" ref={head} tabIndex={-1} className="m-0 text-lg font-extrabold text-[#F2F3EE] outline-none [font-stretch:112%]">
          {tg("title")}
        </h2>
        <span className="font-mono text-[11px] text-[#9AA1A9]">{tg("count", { count: list.length })}</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] border-0 bg-transparent px-2.5 text-[13px] font-semibold text-[#C5CAD0] hover:bg-[#2A2E33] hover:text-[#F2F3EE]">
          <Icon name="x" />
          {t("drawer.close")}
        </button>
      </div>
      {offers.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={tg("offers")}>
          <button type="button" className={chip(offer === "all")} aria-pressed={offer === "all"} onClick={() => setOffer("all")}>
            {tg("allOffers")}
          </button>
          {offers.map((o) => (
            <button key={o.id} type="button" className={chip(offer === o.id)} aria-pressed={offer === o.id} onClick={() => setOffer(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1" role="group" aria-label={tg("states")}>
        {STS.map((s) => (
          <button key={s} type="button" className={chip(st === s)} aria-pressed={st === s} onClick={() => setSt(s)}>
            {tg(s)}
            <span className="font-mono text-[11px] opacity-70">{byOffer.filter((n) => okSt(n, s)).length}</span>
          </button>
        ))}
      </div>
      {/* min-h-0: a flex child defaults to min-height:auto, so without it the grid grows past the stage and the 2nd row is clipped instead of scrolling */}
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(132px,1fr))] content-start gap-3 overflow-auto overscroll-contain pb-2">
        {list.length ? (
          list.map((n) => {
            const m = n.meta
            const thumb = m.kind === "creative" || m.kind === "meta_ad" ? m.thumbnailUrl : null
            const hook = hookOfNode(ix, n)
            return (
              <button key={n.id} type="button" onClick={() => onPick(n.id)} className="flex min-w-0 cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left text-[#F2F3EE]" aria-label={n.label}>
                <span
                  className={cn("relative block aspect-[9/16] max-w-full overflow-hidden rounded-[10px] border border-[#2E3238] bg-[#1E2550] bg-cover bg-center", n.winner && "outline-2 outline-offset-2 outline-brand", selectedId === n.id && "ring-2 ring-white")}
                  style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined}
                >
                  <span className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                    {n.winner ? <span className="rounded-full bg-fg px-2 py-0.5 text-[11px] font-bold text-brand">{t("winner")}</span> : null}
                    {m.kind === "meta_ad" && m.fromHookMill ? <span className="rounded-full border border-brand-edge bg-brand-soft px-1.5 font-mono text-[10px] font-bold text-brand-ink">HM</span> : null}
                    {m.kind === "creative" ? <span className="rounded-full border border-line-soft bg-card-2 px-2 py-0.5 text-[11px] font-bold text-fg-2">{t(`status.${m.status}`)}</span> : null}
                  </span>
                  {hook ? <span className="absolute inset-x-2 bottom-[22px] line-clamp-3 text-xs leading-[1.2] font-extrabold [text-shadow:0_1px_3px_rgba(0,0,0,.6)]">{hook.label}</span> : null}
                  <span className="absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/55 px-1.5 font-mono text-[10px]">
                    {m.kind === "meta_ad" ? fmt.number(m.spend30d, { style: "currency", currency: m.currency ?? "USD", maximumFractionDigits: 0 }) : m.kind === "creative" && m.durationSec ? `0:${String(Math.round(m.durationSec)).padStart(2, "0")}` : ""}
                  </span>
                </span>
                <b className="truncate text-xs">{n.label}</b>
                <small className="font-mono text-[11px] text-[#9AA1A9]">
                  {m.kind === "meta_ad" ? `CPA ${m.cpa == null ? "—" : fmt.number(m.cpa, { style: "currency", currency: m.currency ?? "USD" })}` : m.kind === "creative" && m.engine ? t(`engine.${m.engine}`) : ""}
                </small>
              </button>
            )
          })
        ) : (
          <span className="font-mono text-[11px] text-[#9AA1A9]">{tg("empty")}</span>
        )}
      </div>
    </div>
  )
}
