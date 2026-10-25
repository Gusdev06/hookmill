"use client"

import { useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BrainCategory, BrainNeighbor, BrainNodeDetail, Offer, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { BrainKnows, BrainRing } from "@/components/brain/brain-knows"
import { onboardingHref } from "@/components/onboarding/shared"
import { useErrorMessage } from "@/hooks/use-error-message"
import { brainCompleteness } from "@/lib/brain"
import { CAT_COLOR, CATS, hookOfNode, nodeLabel, type BrainIndex, type GNode } from "@/lib/brain-graph"
import { cn } from "@/lib/utils"

/*
 * Drawer by node type (spec §2.8, contract §2.3): header with the category dot + name, body, connections grouped by
 * category (clickable, with the edge label) and the action bar. The same content goes in the stage card (desktop) and in
 * the Sheet (List / phone). CLIENT sees everything but the edit actions (spec §2.13).
 */
export function Tag({ tone, children }: { tone: "win" | "ok" | "warn" | "info" | "neutral" | "hm"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap",
        tone === "win" && "bg-fg text-brand",
        tone === "ok" && "bg-ok-bg text-ok",
        tone === "warn" && "bg-warn-bg text-warn",
        tone === "info" && "bg-info-bg text-info",
        tone === "neutral" && "border border-line-soft bg-card-2 text-fg-2",
        tone === "hm" && "border border-brand-edge bg-brand-soft font-mono text-[10px] text-brand-ink"
      )}
    >
      {children}
    </span>
  )
}

export function CatDot({ cat, className }: { cat: BrainCategory; className?: string }) {
  return <i aria-hidden="true" className={cn("inline-block size-[9px] flex-none rounded-full border border-black/15", className)} style={{ background: CAT_COLOR[cat] }} />
}

function DrawerFrame({ cat, eyebrow, title, onClose, children, footer }: { cat: BrainCategory; eyebrow: string; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useTranslations("brain.g.drawer")
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    h.current?.focus({ preventScroll: true })
  }, [title])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2.5 border-b border-line-soft py-3.5 pr-3.5 pl-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[.06em] text-fg-3 uppercase">
            <CatDot cat={cat} />
            {eyebrow}
          </span>
          <h2 id="brain-drawer-title" ref={h} tabIndex={-1} className="m-0 text-lg font-extrabold tracking-[-.01em] text-balance outline-none [font-stretch:112%]">
            {title}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("close")}>
          <Icon name="x" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-3.5 pb-[18px]">{children}</div>
      {footer ? <div className="flex flex-wrap gap-2 border-t border-line-soft bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] [&>*]:flex-[1_1_auto]">{footer}</div> : null}
    </div>
  )
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="flex flex-col">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2.5 border-t border-line-soft py-[7px] text-[13px] first:border-t-0">
          <span className="text-fg-3">{k}</span>
          <span className="text-right font-semibold">{v}</span>
        </div>
      ))}
    </div>
  )
}

function Player({ media, title, square }: { media: BrainNodeDetail["media"]; title: string; square?: boolean }) {
  const t = useTranslations("brain.g.drawer")
  if (!media || (!media.videoUrl && !media.posterUrl)) return null
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return (
    <div className={cn("relative w-full max-w-[240px] flex-none self-center overflow-hidden rounded-xl bg-[#1E2550]", square ? "aspect-square" : "aspect-[9/16]")}>
      {media.videoUrl ? (
        <video className="size-full object-cover" src={media.videoUrl} poster={media.posterUrl ?? undefined} playsInline controls preload="metadata" autoPlay={false} aria-label={t("play", { name: title })} data-reduced={reduced || undefined} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="size-full object-cover" src={media.posterUrl!} alt="" />
      )}
      {!media.videoUrl ? <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-2 py-1 text-[11px] text-white">{square ? t("imageAd") : t("noVideo")}</span> : null}
    </div>
  )
}

const SETUP_KINDS = new Set(["business", "proof", "instructions", "offer", "audience", "goal"])

export function BrainNodePanel({ id, ix, canWrite, onSelect, onClose }: { id: string; ix: BrainIndex; canWrite: boolean; onSelect: (id: string) => void; onClose: () => void }) {
  const t = useTranslations("brain.g")
  const td = useTranslations("brain.g.drawer")
  const fmt = useFormatter()
  const errorMessage = useErrorMessage()
  const local = ix.byId.get(id)
  const q = useQuery({ queryKey: ["brain", "node", id], queryFn: ({ signal }) => api.brain.node(id, { signal }), staleTime: 60_000 })
  const node: GNode | BrainNodeDetail["node"] | undefined = q.data?.node ?? local
  if (!node) return null
  const label = nodeLabel(node)
  const cat = node.category
  const field = (k: string) => q.data?.fields.find((f) => f.key === k)?.value ?? null
  const money = (v: number | null | undefined, cur?: string | null) => (v == null ? "—" : fmt.number(v, { style: "currency", currency: cur ?? "USD", maximumFractionDigits: 2 }))
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${fmt.number(v, { maximumFractionDigits: 2 })}%`)
  const dur = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`)
  const m = node.meta
  const eyebrow = [t(`cat.${cat}`), m.kind === "hook" && m.angle ? m.angle : null].filter(Boolean).join(" · ")

  let body: ReactNode = null
  const acts: ReactNode[] = []
  const loading = q.isPending
  const sk = <span className="sk h-24 flex-none rounded-lg" />

  if (SETUP_KINDS.has(m.kind) && "setupStep" in m) {
    const rows: [string, string | number | null][] = (q.data?.fields ?? [])
      .filter((f) => !["offer.name", "offer.creatives", "offer.winners", "offer.language"].includes(f.key))
      .map((f) => [td(`field.${f.key.split(".")[1]}` as "field.what"), f.value])
    body = (
      <>
        {loading ? sk : (
          <div className="flex flex-col gap-3">
            {rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-fg-3">{k}</span>
                <span className="whitespace-pre-line text-fg-2">{m.kind === "goal" && typeof v === "number" ? money(v) : humanize(v)}</span>
              </div>
            ))}
            {m.kind === "offer" ? <KV rows={[[td("creatives"), m.creatives], [td("winners"), m.winners]]} /> : null}
          </div>
        )}
        <span className="text-[13px] text-fg-3">{td("fromSetup", { step: m.setupStep })}</span>
      </>
    )
    if (canWrite)
      acts.push(
        <Link key="edit" href={onboardingHref(m.setupStep)} className={buttonVariants({ variant: "default" })}>
          {td("editSetup")}
        </Link>
      )
  } else if (m.kind === "hook") {
    body = (
      <>
        <div className="border-l-[3px] border-line-strong pl-3 text-[17px] leading-[1.3] font-bold text-balance">{node.summary ?? node.label}</div>
        <KV rows={[[td("angle"), m.angle ?? "—"], [td("scripts"), m.scripts], [td("adsUsing"), m.ads], ...(m.bestCpa != null ? [[td("bestCpa"), money(m.bestCpa, m.currency)] as [string, ReactNode]] : [])]} />
      </>
    )
    if (canWrite)
      acts.push(
        <Link key="nc" href="/creatives/new" className={buttonVariants({ variant: "default" })}>
          {td("newConcept")}
        </Link>
      )
  } else if (m.kind === "script") {
    let blocks: { label: string | null; speech: string | null; startSec: number | null; endSec: number | null }[] = []
    try {
      blocks = JSON.parse(String(field("script.blocks") ?? "[]"))
    } catch {}
    body = loading ? sk : (
      <>
        <KV rows={[[td("angle"), m.angle ?? "—"], [td("length"), dur(m.durationSec)]]} />
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {blocks.map((b, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] tracking-[.06em] text-fg-3 uppercase">
                {b.label ?? `#${i + 1}`}
                {b.startSec != null && b.endSec != null ? ` · ${b.startSec}–${b.endSec} s` : ""}
              </span>
              <span className="text-fg-2">{b.speech}</span>
            </li>
          ))}
        </ol>
        {field("script.rationale") ? <p className="m-0 text-[13px] text-fg-3">{String(field("script.rationale"))}</p> : null}
      </>
    )
    if (canWrite)
      acts.push(
        <Link key="os" href={`/creatives/${encodeURIComponent(m.creativeId)}/scripts`} className={buttonVariants({ variant: "outline" })}>
          {td("openScript")}
        </Link>
      )
  } else if (m.kind === "creative") {
    const from = m.sourceMetaAdId ? ix.byId.get(`meta_ad:${m.sourceMetaAdId}`) : m.sourceCreativeId ? ix.byId.get(`creative:${m.sourceCreativeId}`) : null
    body = (
      <>
        <div className="flex flex-wrap gap-1.5">
          {node.winner ? <Tag tone="win">{t("winner")}</Tag> : null}
          <Tag tone={m.status === "approved" ? "ok" : m.status === "in_review" ? "info" : "neutral"}>{t(`status.${m.status}`)}</Tag>
          {m.published ? <Tag tone="hm">{t("onMeta")}</Tag> : null}
        </div>
        {loading ? <span className="sk aspect-[9/16] w-full max-w-[240px] flex-none self-center rounded-xl" /> : <Player media={q.data?.media ?? null} title={label} />}
        <KV
          rows={[
            [td("engine"), m.engine ? t(`engine.${m.engine}`) : "—"],
            [td("length"), dur(m.durationSec)],
            [td("cost"), loading ? "…" : money(Number(field("creative.costUsd") ?? 0))],
            ...(from || m.sourceMetaAdId ? [[td("iteratedFrom"), from ? from.label : m.sourceMetaAdId] as [string, ReactNode]] : []),
          ]}
        />
      </>
    )
    acts.push(
      <Link key="oc" href={`/creatives/${encodeURIComponent(node.refId)}`} className={buttonVariants({ variant: "default" })}>
        {td("openCreative")}
      </Link>
    )
    if (canWrite && m.status === "approved" && !m.published)
      acts.push(
        <Link key="send" href={`/creatives/${encodeURIComponent(node.refId)}/send`} className={buttonVariants({ variant: "outline" })}>
          {td("sendMeta")}
        </Link>
      )
  } else if (m.kind === "meta_ad") {
    const hook = local ? hookOfNode(ix, local) : null
    const pub = ix.adj.get(node.id)?.find((e) => e.kind === "published_as")?.link.publication
    body = (
      <>
        <div className="flex flex-wrap gap-1.5">
          {node.winner ? <Tag tone="win">{t("winner")}</Tag> : null}
          {m.trend ? <Tag tone={m.trend === "WORKING" ? "ok" : m.trend === "TIRING" ? "warn" : "neutral"}>{t(`trend.${m.trend}`)}</Tag> : null}
          {m.fromHookMill ? <Tag tone="hm">HOOKMILL</Tag> : null}
        </div>
        {loading ? <span className={cn("sk w-full max-w-[240px] flex-none self-center rounded-xl", m.isVideo ? "aspect-[9/16]" : "aspect-square")} /> : <Player media={q.data?.media ?? { videoUrl: null, posterUrl: m.thumbnailUrl }} title={label} square={!m.isVideo} />}
        <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
          {[
            [td("spend"), money(m.spend30d, m.currency)],
            [td("cpa"), money(m.cpa, m.currency)],
            [td("ctr"), pct(m.ctr)],
            [td("hookRate"), pct(m.hookRate)],
          ].map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col rounded-[10px] border border-line-soft bg-card-2 p-2">
              <small className="text-[11px] text-fg-3">{k}</small>
              <span className="font-mono text-sm font-semibold tabular-nums">{v}</span>
            </div>
          ))}
        </div>
        <KV
          rows={[
            [td("running"), m.daysRunning == null ? "—" : td("days", { count: m.daysRunning })],
            [td("hook"), hook ? hook.label : "—"],
            ...(field("meta_ad.campaignName") ? [[td("campaign"), String(field("meta_ad.campaignName"))] as [string, ReactNode]] : []),
            ...(field("meta_ad.adsetName") ? [[td("adset"), String(field("meta_ad.adsetName"))] as [string, ReactNode]] : []),
            ...(pub ? [[td("published"), td("publishedBy", { date: pub.publishedAt ? fmt.dateTime(new Date(pub.publishedAt), { dateStyle: "medium" }) : "—", name: pub.byName })] as [string, ReactNode]] : []),
          ]}
        />
      </>
    )
    if (canWrite && m.isVideo)
      acts.push(
        <Link key="it" href={`/iterate/new?metaAdId=${encodeURIComponent(node.refId)}`} className={buttonVariants({ variant: node.winner ? "brand" : "outline" })}>
          <Icon name="iter" />
          {node.winner ? td("iterateW") : td("iterate")}
        </Link>
      )
    acts.push(
      <Link key="camp" href="/campaigns?view=ads" className={buttonVariants({ variant: "outline" })}>
        {td("campaigns")}
      </Link>
    )
  }

  // connections grouped by category (the API sends up to 50; the local index is used while it loads)
  // labels come from the local index when it has the node (creative's own name, see creativeNames)
  const neighbors: BrainNeighbor[] =
    q.data?.neighbors.map((x) => ({ ...x, label: ix.byId.get(x.id)?.label ?? x.label })) ??
    (ix.adj.get(id) ?? []).map((e) => {
      const o = ix.byId.get(e.id)!
      return { id: o.id, kind: o.kind, category: o.category, label: o.label, edge: e.kind, winner: o.winner }
    })
  const groups = new Map<BrainCategory, BrainNeighbor[]>()
  for (const n of neighbors) groups.set(n.category, [...(groups.get(n.category) ?? []), n])
  const order: BrainCategory[] = ["center", ...CATS]
  const total = local?.deg ?? neighbors.length

  return (
    <DrawerFrame cat={cat} eyebrow={eyebrow} title={label} onClose={onClose} footer={acts.length ? acts : null}>
      {q.isError && !q.data ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{td("loadFailed")}</AlertTitle>
            <span className="text-[13px]">{errorMessage(q.error)}</span>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => q.refetch()}>
              <Icon name="refresh" />
              {td("retry")}
            </Button>
          </AlertActions>
        </Alert>
      ) : null}
      {body}
      {neighbors.length ? (
        <section className="flex flex-col gap-1" aria-label={td("connections")}>
          <div className="flex items-baseline justify-between text-[13px] font-bold">
            {td("connections")} <span className="font-mono text-xs font-normal text-fg-3">{total}</span>
          </div>
          {order
            .filter((c) => groups.has(c))
            .map((c) => {
              const list = groups.get(c)!
              return (
                <div key={c} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 py-1 text-xs font-bold text-fg-3">
                    <CatDot cat={c} className="size-2" />
                    {t(`cat.${c}`)} ({list.length})
                  </span>
                  {list.slice(0, 8).map((x, i) => (
                    <button key={`${x.id}:${x.edge}:${i}`} type="button" onClick={() => onSelect(x.id)} className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1 text-left hover:bg-card-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">{x.label}</span>
                      {x.winner ? <Tag tone="win">{t("winner")}</Tag> : null}
                      <span className="font-mono text-[10px] whitespace-nowrap text-fg-3">{t(`edge.${x.edge}`)}</span>
                    </button>
                  ))}
                  {list.length > 8 ? <span className="px-2 py-1 text-xs text-fg-3">{td("more", { count: list.length - 8 })}</span> : null}
                </div>
              )
            })}
        </section>
      ) : null}
    </DrawerFrame>
  )
}

function humanize(v: string | number | null) {
  if (v == null) return "—"
  const s = String(v)
  return /^[A-Z_]+$/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : s
}

/** "What the Brain knows" (the center orb, the % card): the BrainKnows of fase2 D5 in a drawer. */
export function BrainKnowsPanel({ ws, offers, clientName, canWrite, onClose }: { ws: Workspace | undefined; offers: Offer[] | undefined; clientName: string; canWrite: boolean; onClose: () => void }) {
  const t = useTranslations("brain")
  const td = useTranslations("brain.g.drawer")
  const pctv = ws && offers ? brainCompleteness(ws, offers).percent : null
  return (
    <DrawerFrame
      cat="center"
      eyebrow={clientName}
      title={td("knowsT")}
      onClose={onClose}
      footer={
        canWrite ? (
          <Link href={onboardingHref(1)} className={buttonVariants({ variant: "outline" })}>
            <Icon name="refresh" />
            {t("revisit")}
          </Link>
        ) : null
      }
    >
      {ws && offers ? (
        <>
          <div className="flex items-center gap-3">
            <BrainRing percent={pctv ?? 0} size={56} />
            <span className="text-[13px] text-fg-3">{td("knowsBody")}</span>
          </div>
          <BrainKnows ws={ws} offers={offers} fillLinks={canWrite} className="[&>div:first-child]:hidden" />
        </>
      ) : (
        <span className="sk h-48 rounded-lg" />
      )}
    </DrawerFrame>
  )
}
