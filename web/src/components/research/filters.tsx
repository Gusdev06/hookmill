"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { ListResearchAdsQuery, ResearchSort, ResearchStatusFilter } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/*
 * mockup .filters: Status Active | All | Inactive (Active by default) · Format · Running for · Language · Sort on the right
 * (Running longest by default). The country is the competitor's (no per-ad country in the Ad Library, §5.2), so no
 * country select. 390: "Filters · n" opens a bottom sheet; Sort stays next to it.
 */
export type RadarFilters = {
  status: ResearchStatusFilter
  fmt: "all" | "video" | "image"
  minDays: "any" | "7" | "30" | "90"
  lang: "any" | "en" | "pt" | "es"
  sort: Exclude<ResearchSort, "eu_reach">
}
export const DEFAULT_FILTERS: RadarFilters = { status: "active", fmt: "all", minDays: "any", lang: "any", sort: "longest_running" }

export function filtersQuery(f: RadarFilters): ListResearchAdsQuery {
  return {
    status: f.status,
    sort: f.sort,
    ...(f.fmt === "video" ? { hasVideo: true } : f.fmt === "image" ? { format: ["IMAGE"] } : {}),
    ...(f.minDays !== "any" ? { minDays: Number(f.minDays) } : {}),
    ...(f.lang !== "any" ? { language: [f.lang] } : {}),
  }
}
export const activeCount = (f: RadarFilters) => [f.status !== "active", f.fmt !== "all", f.minDays !== "any", f.lang !== "any"].filter(Boolean).length

function Seg<V extends string>({ label, value, onChange, options, block }: { label: string; value: V; onChange: (v: V) => void; options: [V, string][]; block?: boolean }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex overflow-hidden rounded-md border border-line-strong bg-card", block && "flex w-full")}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn("min-h-9 cursor-pointer border-0 bg-transparent px-3 text-[13px] font-semibold text-fg-2 aria-pressed:bg-fg aria-pressed:text-card", block && "flex-1")}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function Pick<V extends string>({ label, value, onChange, options, className }: { label: string; value: V; onChange: (v: V) => void; options: [V, string][]; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger aria-label={label} className={cn("min-h-[38px]", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FiltersBar({ value, onChange, total }: { value: RadarFilters; onChange: (f: RadarFilters) => void; total: number | null }) {
  const t = useTranslations("radar.filters")
  const [open, setOpen] = useState(false)
  const set = <K extends keyof RadarFilters>(k: K) => (v: RadarFilters[K]) => onChange({ ...value, [k]: v })
  const status: [ResearchStatusFilter, string][] = [["active", t("active")], ["all", t("all")], ["inactive", t("inactive")]]
  const langs: [RadarFilters["lang"], string][] = [["any", t("anyLanguage")], ["en", t("en")], ["pt", t("pt")], ["es", t("es")]]
  const sort = (
    <Pick label={t("sort")} value={value.sort} onChange={set("sort")} options={[["longest_running", t("longest")], ["newest", t("newest")], ["most_variations", t("versions")]]} />
  )
  const n = activeCount(value)
  return (
    <>
      {/* desktop */}
      <div className="flex flex-wrap items-center gap-2 max-tablet:hidden">
        <Seg label={t("status")} value={value.status} onChange={set("status")} options={status} />
        <Seg label={t("format")} value={value.fmt} onChange={set("fmt")} options={[["all", t("allFormats")], ["video", t("video")], ["image", t("image")]]} />
        <Pick label={t("running")} value={value.minDays} onChange={set("minDays")} options={[["any", t("anyTime")], ["7", t("d7")], ["30", t("d30")], ["90", t("d90")]]} />
        <Pick label={t("language")} value={value.lang} onChange={set("lang")} options={langs} />
        <span className="flex-1" />
        {sort}
      </div>
      {/* 390 */}
      <div className="flex items-center gap-2 tablet:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {n ? t("buttonN", { n }) : t("button")}
        </Button>
        <span className="flex-1" />
        {sort}
      </div>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-2 bottom-2 z-50 grid max-h-[calc(100dvh-16px)] gap-3.5 overflow-y-auto rounded-[18px] bg-card p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_18px_50px_rgba(21,23,26,.28)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-6"
          >
            <DialogPrimitive.Title className="m-0 text-base font-bold">{t("sheetTitle")}</DialogPrimitive.Title>
            <div className="grid gap-3 [&>div]:grid [&>div]:gap-1.5 [&>div]:text-xs [&>div]:text-fg-3">
              <div>
                {t("status")}
                <Seg block label={t("status")} value={value.status} onChange={set("status")} options={status} />
              </div>
              <div>
                {t("format")}
                <Seg block label={t("format")} value={value.fmt} onChange={set("fmt")} options={[["all", t("all")], ["video", t("video")], ["image", t("image")]]} />
              </div>
              <div>
                {t("running")}
                <Seg block label={t("running")} value={value.minDays} onChange={set("minDays")} options={[["any", t("any")], ["7", t("d7s")], ["30", t("d30s")], ["90", t("d90s")]]} />
              </div>
              <div>
                {t("language")}
                <Pick label={t("language")} value={value.lang} onChange={set("lang")} options={langs} className="w-full" />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3 [&>*]:flex-[1_1_100%]">
              <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: value.sort })}>
                {t("clear")}
              </Button>
              <Button variant="default" onClick={() => setOpen(false)}>
                {total != null ? `${t("show")} · ${total}` : t("show")}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </DialogPrimitive.Root>
    </>
  )
}
