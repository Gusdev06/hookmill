"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { BrandKit, MetaConnection, Offer, Workspace } from "@/lib/api/types"
import { BRAIN_ITEMS, brainCompleteness } from "@/lib/brain"
import { metaReady } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"
import type { EddyConfirm } from "./eddy-store"
import { DEFAULT_NAMES } from "./eddy-moments"
import { MiniBrain } from "./eddy-mini-brain"

/*
 * "{name}'s Brain" (ink panel, 380 px, right of the conversation): fills as each card is confirmed. Lime = confirmed,
 * amber = read but not confirmed yet ("read, waiting for you"), hollow = unknown. The % is brainCompleteness() (13 items);
 * Meta and the brand kit show but don't count. Below 901 px it becomes a strip under the top bar that opens as a bottom sheet.
 */

type ItemState = "on" | "part" | "reading" | "none"
interface Item { key: string; label: string; value: string | null; state: ItemState }

export interface PanelInput {
  ws: Workspace
  offers: Offer[]
  confirmed: Set<EddyConfirm>
  reading: boolean
  kit: BrandKit | undefined
  conn: MetaConnection | null | undefined
  /** lacunas-home-eddy-v1 §2: logo and 2nd color the site reading found (null/absent = nothing found) */
  site?: { logoUrl: string | null; secondaryColor: string | null } | null
}

function useSections({ ws, offers, confirmed, reading, kit, conn, site }: PanelInput) {
  const t = useTranslations("eddyOnboarding.panel")
  const to = useTranslations("onboarding")
  const offer = offers[0] ?? null
  const st = (value: string | null | undefined, group: EddyConfirm | "always", readable = false): ItemState => {
    const has = !!value && value.trim().length > 0
    if (has) return group === "always" || confirmed.has(group) ? "on" : "part"
    return reading && readable ? "reading" : "none"
  }
  const it = (key: string, label: string, value: string | null | undefined, group: EddyConfirm | "always", readable = false): Item => ({ key, label, value: value?.trim() || null, state: st(value, group, readable) })
  const result = ws.resultType ? (ws.resultType === "OTHER" && ws.resultTypeOther ? ws.resultTypeOther : to(`resultType.${ws.resultType}.label`)) : null
  const cpa = ws.targetCpa ? `${ws.targetCpa.min}–${ws.targetCpa.max} ${ws.targetCpa.currency}` : null
  const cap = ws.monthlySpendCapUsd != null ? t("capValue", { v: ws.monthlySpendCapUsd }) : null
  const colors = [ws.brandColor, site?.secondaryColor, ...(kit?.logo?.colors ?? [])].filter((c): c is string => !!c)
  const sections: { key: string; title: string; items: Item[] }[] = [
    {
      key: "business", title: t("business"),
      items: [it("industry", t("industry"), ws.industry, "business", true), it("market", t("market"), ws.market, "business", true), it("result", t("result"), result, "business", true)],
    },
    {
      key: "offer", title: t("offer"),
      items: [
        it("offer", t("offerName"), offer?.name, "offer", true), it("what", t("what"), offer?.what, "offer", true), it("promise", t("promise"), offer?.promise, "offer", true),
        it("price", t("price"), offer?.offerAndPrice, "offer", true), it("cta", t("cta"), offer?.cta, "offer", true),
      ],
    },
    { key: "audience", title: t("audience"), items: [it("aud", t("aud"), offer?.audience, "offer", true), it("pains", t("pains"), offer?.pains, "offer", true), it("notes", t("notes"), offer?.notes, "offer")] },
    { key: "proof", title: t("proof"), items: [it("proof", t("proof"), offer?.proof, "offer", true)] },
    { key: "goals", title: t("goals"), items: [it("cap", t("cap"), cap, "goals"), it("cpa", t("cpa"), cpa, "goals")] },
    { key: "meta", title: t("meta"), items: [it("meta", t("account"), metaReady(conn) && conn.adAccount ? `${conn.adAccount.name} · ${conn.adAccount.id}` : null, "always")] },
    {
      key: "kit", title: t("kit"),
      items: [
        kit?.logo
          ? it("logo", t("logo"), kit.logo.label ?? t("logoSet"), "always")
          : it("logo", t("logo"), site?.logoUrl ? t("logoFromSite") : null, "kit"),
        it("colors", t("colors"), colors.length ? [...new Set(colors)].slice(0, 3).join(" · ") : null, "always"),
        it("files", t("files"), kit?.files.length ? t("filesCount", { count: kit.files.length }) : null, "always"),
        it("demo", t("demo"), kit?.demoVideos.length ? t("videosCount", { count: kit.demoVideos.length }) : null, "always"),
      ],
    },
  ]
  const brain = brainCompleteness(ws, offers)
  const known = BRAIN_ITEMS.length - brain.missing.length
  return { sections, percent: brain.percent, known }
}

function PanelBody({ input, onClose }: { input: PanelInput; onClose?: () => void }) {
  const t = useTranslations("eddyOnboarding.panel")
  const { sections, percent, known } = useSections(input)
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-ink-fg-3">{DEFAULT_NAMES.has(input.ws.name.trim()) ? t("eyebrowNew") : t("eyebrow", { name: input.ws.name })}</span>
        {onClose ? (
          <DialogPrimitive.Close className="inline-flex h-10 items-center rounded-md border border-ink-line bg-ink-2 px-3 text-[13px] font-bold text-ink-fg">{t("close")}</DialogPrimitive.Close>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2.5">
        <b className="font-mono text-[34px] leading-none font-semibold text-ink-fg tabular-nums">{percent}%</b>
        <span className="text-ink-fg-2">{known ? t("known", { n: known, total: BRAIN_ITEMS.length }) : t("nothing")}</span>
      </div>
      <Bar percent={percent} label={t("eyebrow", { name: input.ws.name })} />
      <MiniBrain sections={sections} label={t("aria")} />
      <div className="flex flex-col gap-3">
        {sections.map((s) => (
          <div key={s.key} className="overflow-hidden rounded-[14px] border border-ink-line bg-ink-2">
            <div className="flex items-center justify-between px-3.5 py-2.5 text-[12.5px] font-bold text-ink-fg">
              {s.title}
              <span className="font-mono text-[11px] font-medium text-ink-fg-3">
                {s.items.filter((i) => i.state === "on").length} / {s.items.length}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {s.items.map((i) => (
                <li key={i.key} className="grid grid-cols-[10px_92px_minmax(0,1fr)] items-start gap-2.5 border-t border-ink-line px-3.5 py-[7px] text-[12.5px]">
                  <i
                    aria-hidden="true"
                    className={cn(
                      "mt-[5px] size-2 rounded-full border-[1.5px] border-ink-fg-3",
                      i.state === "on" && "border-brand bg-brand",
                      i.state === "part" && "border-warn-dot bg-warn-dot"
                    )}
                  />
                  <span className="text-ink-fg-3">{i.label}</span>
                  <span className={cn("truncate", i.state === "on" ? "text-ink-fg" : "text-ink-fg-3")} title={i.value ?? undefined}>
                    {i.state === "on" ? i.value : i.state === "part" ? t("waiting") : i.state === "reading" ? t("reading") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <span className="text-xs text-ink-fg-3">{t("foot")}</span>
    </>
  )
}

function Bar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label} className={cn("h-1.5 overflow-hidden rounded-full bg-ink-line", className)}>
      <i className="block h-full bg-brand transition-[width] duration-500 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Desktop: the aside. */
export function BrainPanel({ input }: { input: PanelInput }) {
  const t = useTranslations("eddyOnboarding.panel")
  return (
    <aside aria-label={t("aria")} className="on-ink hidden min-h-0 flex-col gap-4 overflow-y-auto rounded-[var(--r-panel)] bg-ink p-5 text-ink-fg-2 [scrollbar-width:none] desktop:my-3 desktop:mr-3 desktop:flex">
      <PanelBody input={input} />
    </aside>
  )
}

/** Phone / narrow: "Brain ▬▬ 23 %" strip that opens the panel as a bottom sheet. */
export function BrainStrip({ input }: { input: PanelInput }) {
  const t = useTranslations("eddyOnboarding.panel")
  const [open, setOpen] = useState(false)
  const percent = brainCompleteness(input.ws, input.offers).percent
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger className="flex min-h-12 w-full flex-none items-center gap-2.5 bg-ink px-4 py-2 text-left text-ink-fg desktop:hidden">
        <span className="text-[13px] font-semibold">{t("strip")}</span>
        <Bar percent={percent} label={t("aria")} className="flex-1" />
        <b className="font-mono text-[13px] tabular-nums">{percent}%</b>
        <span aria-hidden="true">▴</span>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="on-ink fixed inset-x-0 bottom-0 z-50 flex h-[78dvh] flex-col gap-4 overflow-y-auto rounded-t-[18px] bg-ink p-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] text-ink-fg-2 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{t("aria")}</DialogPrimitive.Title>
          <PanelBody input={input} onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
