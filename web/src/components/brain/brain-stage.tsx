"use client"

import { useRef, useState, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { Expand, LayoutGrid, Network, Pause, Play } from "lucide-react"
import type { BrainGraph } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { MiniRing } from "@/components/brain/brain-bits"
import { BrainGallery } from "@/components/brain/brain-gallery"
import type { BrainGlobeProps } from "@/components/brain/brain-globe"
import { CAT_COLOR, CATS, LIME, searchNodes, type BrainIndex, type Cat } from "@/lib/brain-graph"
import { cn } from "@/lib/utils"

/*
 * The stage (spec §2.1/§2.7, mockup .stage): dark 660 px panel inside the light page, `#t-brain` (tour stop 1).
 * Overlays: % card + search (top left), tools (top right: List · Creatives G · Grow D · Cinema C · Pause motion),
 * category ruler (bottom left), counts (bottom right), hover label, new-client card, gallery and the drawer card.
 */
export interface StageProps {
  Globe: ComponentType<BrainGlobeProps>
  status: "loading" | "error" | "ready"
  errorText?: string
  onRetry: () => void
  graph: BrainGraph | undefined
  ix: BrainIndex | null
  visibleIds: ReadonlySet<string>
  clientName: string
  percent: number | null
  missing: number
  cats: ReadonlySet<Cat>
  winners: boolean
  onCat: (c: Cat, solo: boolean) => void
  onWinners: () => void
  ghost: (c: Cat) => string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onKnows: () => void
  gallery: boolean
  onGallery: (open: boolean) => void
  cinema: boolean
  onCinema: (on: boolean) => void
  motion: boolean
  onMotion: () => void
  reduced: boolean
  lite: boolean
  growToken: number
  growMs: number
  onGrow: () => void
  onGrowEnd: () => void
  onList: () => void
  onGLFail: () => void
  canWrite: boolean
  tourBrain: boolean
  /** phone full-screen 3D */
  phone: boolean
  /** the drawer card (desktop) */
  drawer: ReactNode
}

const glass = "rounded-xl border border-[#2E3238] bg-[rgba(22,25,28,.82)] backdrop-blur-[8px]"
const tool = "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] border-0 bg-transparent px-2.5 text-[13px] font-semibold whitespace-nowrap text-[#C5CAD0] hover:bg-[#2A2E33] hover:text-[#F2F3EE] aria-pressed:bg-[#2A2E33] aria-pressed:text-[#F2F3EE]"
const Kbd = ({ k }: { k: string }) => <kbd className="hidden rounded border border-[#2E3238] px-1 font-mono text-[10px] text-[#9AA1A9] tablet:inline">{k}</kbd>

export function BrainStage(p: StageProps) {
  const t = useTranslations("brain.g")
  const fmt = useFormatter()
  const [hover, setHover] = useState<string | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState("")
  const [qi, setQi] = useState(0)
  const ix = p.ix
  const results = ix ? searchNodes(ix, q) : []
  const pick = (id: string) => {
    setQ("")
    p.onSelect(id)
  }

  const stageCls = cn(
    "on-ink relative isolate overflow-hidden bg-[#0E1012] text-[#E8EAE4]",
    p.phone ? "h-full" : "h-[660px] rounded-[var(--r-panel)]",
    p.cinema && "fixed inset-0 z-[80] h-auto rounded-none"
  )

  if (p.status === "error")
    return (
      <div id="t-brain" className={cn(stageCls, "grid place-items-center p-4")}>
        <Alert variant="destructive" className="on-light max-w-[520px]" role="alert">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("errT")}</AlertTitle>
            <AlertDescription>{p.errorText}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={p.onRetry}>
              <Icon name="refresh" />
              {t("retry")}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )

  if (p.status === "loading" || !ix || !p.graph)
    return (
      <div id="t-brain" className={stageCls} aria-busy="true">
        <div className="absolute inset-0 grid place-items-center">
          <span className="relative block size-[260px]" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(200,240,60,.22),rgba(120,200,230,.06)_40%,transparent_70%)]" />
            <span className="absolute inset-[-40px] rotate-[-25deg] rounded-full border border-[rgba(145,170,255,.14)] motion-safe:animate-[spin_40s_linear_infinite]" />
            <span className="absolute inset-[-70px] rotate-[50deg] rounded-full border border-[rgba(103,232,249,.10)] motion-safe:animate-[spin_60s_linear_infinite_reverse]" />
            <span className="absolute top-1/2 left-1/2 size-5 -translate-1/2 rounded-full bg-brand shadow-[0_0_24px_#C8F03C]" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-[22%] text-center text-[13px] text-[#C5CAD0]">{t("loading", { client: p.clientName })}</div>
      </div>
    )

  const nodesShown = ix.nodes.filter((n) => p.visibleIds.has(n.id)).length
  const linksShown = ix.links.filter((l) => p.visibleIds.has(typeof l.source === "string" ? l.source : l.source.id) && p.visibleIds.has(typeof l.target === "string" ? l.target : l.target.id)).length
  const countByCat = (c: Cat) => ix.byCat.get(c)?.length ?? 0
  const anyWinner = ix.nodes.some((n) => n.winner)
  const anyMedia = ix.nodes.some((n) => n.kind === "creative" || n.kind === "meta_ad")
  const isNew = !["hooks", "scripts", "creatives", "meta_ads"].some((c) => countByCat(c as Cat) > 0)
  const truncated = p.graph.truncated
  const totals = Object.values(p.graph.counts).reduce((a, c) => ({ total: a.total + c.total, shown: a.shown + c.shown }), { total: 0, shown: 0 })
  const meta = p.graph.meta
  const hn = hover ? ix.byId.get(hover) : null

  return (
    <div
      id="t-brain"
      className={stageCls}
      role="application"
      aria-roledescription={t("roledesc")}
      aria-label={t("stageLabel", { count: nodesShown })}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (tip.current) tip.current.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`
      }}
    >
      <p.Globe
        ix={ix}
        visibleIds={p.visibleIds}
        selectedId={p.selectedId}
        motion={p.motion}
        reduced={p.reduced}
        lite={p.lite}
        growToken={p.growToken}
        growMs={p.growMs}
        onSelect={(id) => p.onSelect(id)}
        onHover={setHover}
        onFail={p.onGLFail}
        onGrowEnd={p.onGrowEnd}
      />

      {/* hover label */}
      <div ref={tip} className={cn(glass, "pointer-events-none absolute top-0 left-0 z-[4] flex max-w-[280px] flex-col gap-0.5 px-2.5 py-2 text-xs", (!hn || hn.id === p.selectedId || p.phone) && "hidden")}>
        {hn ? (
          <>
            <b className="text-[13px] text-[#F2F3EE]">{hn.label}</b>
            <span className="text-[#9AA1A9]">
              {hn.category === "center" ? t("drawer.knowsT") : t(`cat.${hn.category}`)}
              {hn.meta.kind === "meta_ad" ? ` · ${fmt.number(hn.meta.spend30d, { style: "currency", currency: hn.meta.currency ?? "USD", maximumFractionDigits: 0 })} · CPA ${hn.meta.cpa == null ? "—" : fmt.number(hn.meta.cpa, { style: "currency", currency: hn.meta.currency ?? "USD" })}` : ""}
              {hn.winner ? ` · ${t("winnerLower")}` : ""}
            </span>
          </>
        ) : null}
      </div>

      {p.cinema ? (
        <button type="button" onClick={() => p.onCinema(false)} className={cn(glass, "absolute top-3.5 left-1/2 z-[5] -translate-x-1/2 cursor-pointer px-3 py-1.5 text-xs text-[#9AA1A9]")}>
          {t("exitCinema")}
        </button>
      ) : (
        <>
          {/* top left: % card + search */}
          <div className={cn("pointer-events-none absolute left-3.5 z-[3] flex max-w-[min(520px,calc(100%-28px))] flex-col items-start gap-2 [&>*]:pointer-events-auto", p.phone ? "top-[62px]" : "top-3.5")}>
            <button type="button" onClick={p.onKnows} className={cn(glass, "flex cursor-pointer items-center gap-2.5 py-2 pr-3 pl-2 text-left text-[#F2F3EE] hover:border-[#454a52]")} aria-label={t("drawer.knowsT")}>
              {p.percent == null ? (
                <>
                  <span className="size-10 rounded-full border-[5px] border-[#2E3238]" />
                  <b>…</b>
                </>
              ) : (
                <MiniRing
                  key={p.tourBrain ? "tour" : "static"}
                  percent={p.percent}
                  animate={p.tourBrain}
                  ms={p.growMs}
                  label={(v) => (
                    <span className="flex flex-col">
                      <b>{t("known", { pct: v })}</b>
                      <small className="text-xs text-[#9AA1A9]">{t("missing", { count: p.missing })}</small>
                    </span>
                  )}
                />
              )}
            </button>
            <div className={cn(glass, "relative flex min-h-[38px] w-[300px] max-w-full items-center gap-2 px-2.5 text-[#C5CAD0]")}>
              <Icon name="search" />
              <label htmlFor="brain-q" className="sr-only">
                {t("search")}
              </label>
              <input
                id="brain-q"
                role="combobox"
                aria-expanded={!!q.trim()}
                aria-controls="brain-q-list"
                aria-activedescendant={results[qi] ? `brain-q-${qi}` : undefined}
                autoComplete="off"
                value={q}
                placeholder={t("search")}
                onChange={(e) => {
                  setQ(e.target.value)
                  setQi(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setQi((i) => Math.min(results.length - 1, i + 1))
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setQi((i) => Math.max(0, i - 1))
                  } else if (e.key === "Enter" && results[qi]) pick(results[qi].id)
                  else if (e.key === "Escape") {
                    e.stopPropagation()
                    setQ("")
                    e.currentTarget.blur()
                  }
                }}
                className="min-h-9 min-w-0 flex-1 border-0 bg-transparent text-[#F2F3EE] outline-0 placeholder:text-[#9AA1A9]"
              />
              <Kbd k="/" />
              {q.trim() ? (
                <div id="brain-q-list" role="listbox" className={cn(glass, "absolute top-[calc(100%+6px)] right-0 left-0 z-[6] flex max-h-80 flex-col overflow-auto p-1.5")}>
                  {results.length ? (
                    results.map((n, i) => (
                      <button
                        key={n.id}
                        id={`brain-q-${i}`}
                        role="option"
                        aria-selected={i === qi}
                        type="button"
                        onClick={() => pick(n.id)}
                        className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-[#F2F3EE] hover:bg-[#2A2E33]", i === qi && "bg-[#2A2E33]")}
                      >
                        <span className="size-2 flex-none rounded-full" style={{ background: n.category === "center" ? LIME : CAT_COLOR[n.category] }} />
                        <span className="min-w-0 flex-1 truncate">{n.label}</span>
                        <small className="font-mono text-[11px] text-[#9AA1A9]">{t(`cat.${n.category}`)}</small>
                      </button>
                    ))
                  ) : (
                    <span className="px-2.5 py-1.5 font-mono text-[11px] text-[#9AA1A9]">{t("searchEmpty")}</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* top right: tools */}
          <div className="absolute top-3.5 right-3.5 z-[3] flex items-center">
            <div className={cn(glass, "flex gap-0.5 p-[3px]")} role="toolbar" aria-label={t("tools.toolbar")}>
              {!p.phone ? (
                <button type="button" className={tool} onClick={p.onList}>
                  {t("tools.list")}
                </button>
              ) : null}
              {anyMedia ? (
                <button type="button" className={tool} aria-pressed={p.gallery} onClick={() => p.onGallery(!p.gallery)} title={t("tools.gallery")}>
                  <LayoutGrid className="size-3.5" aria-hidden="true" />
                  <span className={cn(p.phone && "sr-only")}>{t("tools.gallery")}</span> <Kbd k="G" />
                </button>
              ) : null}
              <button type="button" className={tool} onClick={p.onGrow} title={t("tools.grow")}>
                <Network className="size-3.5" aria-hidden="true" />
                <span className={cn(p.phone && "sr-only")}>{t("tools.grow")}</span> <Kbd k="D" />
              </button>
              {!p.phone ? (
                <button type="button" className={tool} onClick={() => p.onCinema(true)} title={t("tools.cinema")}>
                  <Expand className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">{t("tools.cinema")}</span>
                  <Kbd k="C" />
                </button>
              ) : null}
              <button type="button" className={tool} aria-pressed={!p.motion} onClick={p.onMotion} title={p.motion ? t("tools.pause") : t("tools.play")}>
                {p.motion ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                <span className="sr-only">{p.motion ? t("tools.pause") : t("tools.play")}</span>
              </button>
            </div>
          </div>

          {/* bottom left: category ruler */}
          <div className={cn("absolute bottom-3.5 left-3.5 z-[3] flex max-w-[calc(100%-28px)] items-center desktop:max-w-[calc(100%-340px)]", p.drawer && "desktop:max-w-[calc(100%-440px)]", p.phone && "right-3.5")}>
            <div className={cn(glass, "flex gap-1 p-1", p.phone ? "flex-nowrap overflow-x-auto" : "flex-wrap")} role="group" aria-label={t("catsLabel")}>
              {CATS.map((c) => {
                const n = countByCat(c)
                const dot = <i className="size-[9px] flex-none rounded-full" style={{ ["--c" as string]: CAT_COLOR[c] }} />
                if (!n)
                  return (
                    <span key={c} tabIndex={0} title={p.ghost(c)} aria-label={`${t(`cat.${c}`)}: ${p.ghost(c)}`} className="inline-flex min-h-8 cursor-help items-center gap-1.5 rounded-full border border-dashed border-[#2E3238] px-2.5 text-xs font-semibold whitespace-nowrap text-[#9AA1A9] [&>i]:border-[1.5px] [&>i]:border-dashed [&>i]:border-[var(--c)]">
                      {dot}
                      {t(`cat.${c}`)}
                      <span className="font-mono text-[11px]">0</span>
                    </span>
                  )
                const on = p.cats.has(c)
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    title={t("catHint")}
                    onClick={(e) => p.onCat(c, e.shiftKey || e.altKey)}
                    className={cn(
                      "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-transparent px-2.5 text-xs font-semibold whitespace-nowrap hover:bg-[#2A2E33]",
                      on ? "text-[#F2F3EE] [&>i]:bg-[var(--c)] [&>i]:shadow-[0_0_8px_var(--c)]" : "text-[#9AA1A9] [&>i]:border-[1.5px] [&>i]:border-[var(--c)]"
                    )}
                  >
                    {dot}
                    {t(`cat.${c}`)}
                    <span className="font-mono text-[11px] text-[#9AA1A9]">{n}</span>
                  </button>
                )
              })}
              {anyWinner ? (
                <button type="button" aria-pressed={p.winners} title={t("winnersHint")} onClick={p.onWinners} className={cn("inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-semibold whitespace-nowrap hover:bg-[#2A2E33]", p.winners ? "bg-[#2A2E33] text-[#F2F3EE]" : "text-[#F2F3EE]")}>
                  <i className="size-[9px] rounded-full bg-brand shadow-[0_0_8px_#C8F03C]" />
                  {t("winners")}
                  <span className="font-mono text-[11px] text-[#9AA1A9]">{ix.nodes.filter((n) => n.winner).length}</span>
                </button>
              ) : null}
              <span tabIndex={0} title={t("learningsHint")} className="inline-flex min-h-8 cursor-help items-center gap-1.5 rounded-full border border-dashed border-[#2E3238] px-2.5 text-xs font-semibold whitespace-nowrap text-[#9AA1A9]">
                <i className="size-[9px] rounded-full border-[1.5px] border-dashed border-[#9AA1A9]" />
                {t("learnings")}
                <span className="font-mono text-[11px]">{t("soon")}</span>
              </span>
            </div>
          </div>

          {/* bottom right: counts */}
          {!p.phone ? (
            <div className="absolute right-3.5 bottom-3.5 z-[3] hidden desktop:block">
              <span className={cn(glass, "block px-2.5 py-1.5 font-mono text-[11px] text-[#9AA1A9]")}>
                {t("stats", { nodes: nodesShown, links: linksShown })}
                {truncated ? ` · ${t("truncated", { shown: totals.shown, total: totals.total })}` : ""}
                {meta.connected && meta.lastSyncAt ? ` · ${t("synced", { ago: fmt.relativeTime(new Date(meta.lastSyncAt), new Date()) })}` : ""}
              </span>
            </div>
          ) : null}
        </>
      )}

      {isNew && !p.selectedId && !p.tourBrain && !p.cinema && !p.gallery ? (
        <div className={cn(glass, "absolute bottom-[108px] left-1/2 z-[3] flex w-[min(460px,calc(100%-28px))] -translate-x-1/2 flex-col gap-2 px-4 py-3.5 text-[#C5CAD0]", p.phone && "bottom-[72px]")}>
          <b className="text-[#F2F3EE]">{t("newT")}</b>
          <span>{t("newB")}</span>
          {p.canWrite ? (
            <div>
              <Link href="/creatives/new" className={buttonVariants({ variant: "brand", size: "sm" })}>
                {t("newCta")}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {p.gallery && !p.cinema ? <BrainGallery ix={ix} selectedId={p.selectedId} onPick={(id) => p.onSelect(id)} onClose={() => p.onGallery(false)} /> : null}

      {p.drawer ? (
        <aside role="dialog" aria-labelledby="brain-drawer-title" className="on-light absolute top-3 right-3 bottom-3 z-[7] flex w-[400px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-line bg-card text-fg shadow-[0_20px_50px_rgba(0,0,0,.35)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3">
          {p.drawer}
        </aside>
      ) : null}
    </div>
  )
}
