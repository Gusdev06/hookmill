"use client"

import { useMemo, useRef, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"
import { Expand } from "lucide-react"
import type { BrainGraph } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { MiniRing } from "@/components/brain/brain-bits"
import type { BrainGlobeProps } from "@/components/brain/brain-globe"
import { CAT_COLOR, CATS, type BrainIndex, type Cat } from "@/lib/brain-graph"
import { cn } from "@/lib/utils"

/*
 * Home v2 stage (design/home-v2-2026-10-31.md §2.2-2.4, mockup .brain): the existing Brain globe in "home" mode — no tools,
 * no search, the camera sways around the live nodes — on a dark 600 px stage (300 px card under 761 px of content).
 * Live nodes become callouts pinned to the node by the engine (winner = lime edge, waiting = amber dot); clicking opens
 * the drawer the page passes in. Without WebGL: the callouts as a list + "Open Brain".
 */
export interface HomePin {
  /** node id in the graph */
  nodeId: string
  tone: "win" | "wait"
  title: string
  sub: string
  thumb: string | null
}

const glass = "rounded-xl border border-[#2E3238] bg-[rgba(22,25,28,.86)] backdrop-blur-[8px]"

export function HomeStage({
  Globe, graph, ix, status, errorText, onRetry, clientName, percent, missing, pins, waitIds, selectedId, onSelect, onPin, drawer, narrow, reduced, gl, onGLFail,
}: {
  Globe: ComponentType<BrainGlobeProps>
  graph: BrainGraph | undefined
  ix: BrainIndex | null
  status: "loading" | "error" | "ready"
  errorText?: string
  onRetry: () => void
  clientName: string
  percent: number | null
  missing: number
  pins: HomePin[]
  waitIds: ReadonlySet<string>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onPin: (p: HomePin) => void
  /** the drawer card (desktop only; the phone uses a sheet) */
  drawer: ReactNode
  narrow: boolean
  reduced: boolean
  gl: boolean
  onGLFail: () => void
}) {
  const t = useTranslations("home.stage")
  const tg = useTranslations("brain.g")
  const fmt = useFormatter()
  const pinHost = useRef<HTMLDivElement>(null)
  const all = useMemo(() => new Set(ix?.nodes.map((n) => n.id) ?? []), [ix])

  const stageCls = cn("on-ink relative isolate overflow-hidden rounded-[var(--r-panel)] bg-[#0E1012] text-[#E8EAE4]", narrow ? "h-[300px]" : "h-[600px]")
  const openBrain = (
    <Link href="/brain?view=map" className={cn(glass, "inline-flex min-h-10 items-center gap-1.5 px-3 text-[13px] font-semibold text-[#F2F3EE] hover:border-[#454a52]")} aria-label={narrow ? t("open") : undefined}>
      {narrow ? null : t("open")}
      <Expand className="size-3.5" aria-hidden="true" />
    </Link>
  )

  if (status === "error")
    return (
      <section key="error" id="t-home-brain" className={cn(stageCls, "grid place-items-center p-4")}>
        <Alert variant="destructive" className="on-light max-w-[520px]" role="alert">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{tg("errT")}</AlertTitle>
            <AlertDescription>{errorText}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={onRetry}>
              <Icon name="refresh" />
              {tg("retry")}
            </Button>
          </AlertActions>
        </Alert>
      </section>
    )

  if (status === "loading" || !ix || !graph)
    return (
      <section key="loading" id="t-home-brain" className={stageCls} aria-busy="true">
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn("relative block", narrow ? "size-[150px]" : "size-[240px]")} aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(200,240,60,.22),rgba(120,200,230,.06)_40%,transparent_70%)]" />
            <span className="absolute inset-[-30px] rotate-[-25deg] rounded-full border border-[rgba(145,170,255,.14)] motion-safe:animate-[spin_40s_linear_infinite]" />
            <span className="absolute top-1/2 left-1/2 size-5 -translate-1/2 rounded-full bg-brand shadow-[0_0_24px_#C8F03C]" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-[18%] text-center text-[13px] text-[#C5CAD0]">{tg("loading", { client: clientName })}</div>
      </section>
    )

  const countByCat = (c: Cat) => ix.byCat.get(c)?.length ?? 0
  const isNew = !["hooks", "scripts", "creatives", "meta_ads"].some((c) => countByCat(c as Cat) > 0)
  const meta = graph.meta
  const shown = narrow ? pins.slice(0, 2) : pins

  const known = (
    <Link href="/brain" className={cn(glass, "flex items-center gap-2.5 py-1.5 pr-3 pl-1.5 text-left text-[12.5px] text-[#C5CAD0] no-underline hover:border-[#454a52]")}>
      {percent == null ? <span className="size-10 rounded-full border-[5px] border-[#2E3238]" /> : <MiniRing percent={percent} />}
      <span>
        <b className="text-[#F2F3EE]">{percent == null ? "…" : tg("known", { pct: percent })}</b>
        {narrow ? null : <> · {tg("missing", { count: missing })}</>}
      </span>
    </Link>
  )

  return (
    <section key="ready" id="t-home-brain" className={stageCls} aria-label={t("label", { name: clientName })}>
      {gl ? (
        <Globe
          ix={ix}
          visibleIds={all}
          selectedId={selectedId}
          motion={!reduced}
          reduced={reduced}
          lite={narrow}
          growToken={0}
          growMs={0}
          onSelect={onSelect}
          onHover={() => {}}
          onFail={onGLFail}
          home
          waitIds={waitIds}
          pinHost={pinHost}
        />
      ) : (
        <div className="absolute inset-x-3.5 top-[68px] bottom-3.5 flex flex-col gap-2 overflow-auto">
          <p className="m-0 text-[13px] text-[#C5CAD0]">{t("nogl")}</p>
          {pins.length ? (
            pins.map((p) => <PinButton key={p.nodeId} p={p} onClick={() => onPin(p)} className="relative w-full max-w-[420px]" />)
          ) : (
            <p className="m-0 text-[13px] text-[#9AA1A9]">{t("nothing")}</p>
          )}
        </div>
      )}

      {/* callouts: the engine sets left/top (and data-side) every frame */}
      {gl ? (
        <div ref={pinHost} className="pointer-events-none absolute inset-0 z-[3]">
          {shown.map((p) => (
            <PinButton
              key={p.nodeId}
              p={p}
              onClick={() => onPin(p)}
              data-pin={p.nodeId}
              className={cn(
                "pointer-events-auto invisible absolute top-0 left-0",
                narrow ? "max-w-[190px] py-1.5 pr-2.5 pl-1.5" : "max-w-[250px]"
              )}
            />
          ))}
        </div>
      ) : null}

      <div className="absolute top-3.5 left-3.5 z-[4]">{known}</div>
      <div className="absolute top-3.5 right-3.5 z-[4]">{openBrain}</div>

      {narrow ? null : (
        <>
          <div className={cn("absolute bottom-3.5 left-3.5 z-[4] flex flex-wrap gap-1.5", drawer ? "max-w-[calc(100%-420px)]" : "max-w-[calc(100%-340px)]")} aria-label={tg("catsLabel")}>
            {CATS.map((c) => {
              const n = countByCat(c)
              return (
                <span key={c} className={cn(glass, "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] text-[#C5CAD0]", !n && "border-dashed text-[#9AA1A9]")}>
                  <i className={cn("size-2 rounded-full", !n && "border-[1.5px] border-dashed")} style={n ? { background: CAT_COLOR[c] } : { borderColor: CAT_COLOR[c] }} />
                  {tg(`cat.${c}`)}
                  {n ? ` ${n}` : ""}
                </span>
              )
            })}
          </div>
          {drawer ? null : (
            <span className="absolute right-3.5 bottom-3.5 z-[4] font-mono text-[11px] text-[#9AA1A9]">
              {tg("stats", { nodes: ix.nodes.length, links: ix.links.length })}
              {meta.connected && meta.lastSyncAt ? ` · ${tg("synced", { ago: fmt.relativeTime(new Date(meta.lastSyncAt), new Date()) })}` : ""}
            </span>
          )}
        </>
      )}

      {isNew && !drawer && !narrow ? (
        <div className={cn(glass, "absolute bottom-16 left-1/2 z-[4] w-[min(420px,calc(100%-28px))] -translate-x-1/2 px-4 py-3.5 text-[13px] text-[#C5CAD0]")}>
          <b className="mb-1 block text-sm text-[#F2F3EE]">{tg("newT")}</b>
          {tg("newB")}
        </div>
      ) : null}

      {drawer ? (
        <aside role="dialog" aria-labelledby="brain-drawer-title" className="on-light absolute top-3 right-3 bottom-3 z-[7] flex w-[380px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-line bg-card text-fg shadow-[0_20px_50px_rgba(0,0,0,.35)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3">
          {drawer}
        </aside>
      ) : null}
    </section>
  )
}

function PinButton({ p, onClick, className, ...rest }: { p: HomePin; onClick: () => void; className?: string; "data-pin"?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={cn(glass, "flex cursor-pointer items-center gap-2.5 py-2 pr-3 pl-2 text-left text-[#F2F3EE] transition-colors hover:border-[#9AA1A9]", p.tone === "win" && "border-brand-edge", className)}
    >
      <span className="aspect-[9/16] w-[26px] flex-none overflow-hidden rounded-[5px] bg-[linear-gradient(165deg,#4c5a6e,#15171a)]">
        {p.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumb} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
        ) : null}
      </span>
      <span className="min-w-0">
        <b className="block truncate text-[12.5px]">{p.title}</b>
        <small className="flex items-center gap-1.5 text-[11.5px] text-[#C5CAD0]">
          <i className={cn("size-[7px] flex-none rounded-full", p.tone === "win" ? "bg-brand" : "bg-warn-dot")} />
          <span className="truncate">{p.sub}</span>
        </small>
      </span>
    </button>
  )
}
