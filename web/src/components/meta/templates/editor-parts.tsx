"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"
import { Popover as PopoverPrimitive } from "radix-ui"
import type { FileRef } from "@/lib/api/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"
import type { Level } from "./editor-model"

/* Building blocks of the template editor (mockup design/mockup-template-campanha.html: .sec, .f, .rad, .tog, .soonrow, .ro). */

/** Ads Manager level glyph (mockup .lv): square / square in square / tall card. */
export function LevelGlyph({ level, className }: { level: Level; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={cn("size-4 flex-none", className)}>
      {level === "ad" ? <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /> : <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />}
      {level === "adset" ? <rect x="5" y="5" width="6" height="6" rx="1" /> : null}
    </svg>
  )
}

/** "Soon" (Meta has it, the template doesn't yet) and "HookMill" (ours, not a Meta setting) badges. */
export function Soon({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("metaTemplates.editor")
  return <span className="rounded-[6px] border border-line-strong px-1.5 py-px font-mono text-[10px] font-medium tracking-[.06em] whitespace-nowrap text-fg-3 uppercase">{children ?? t("soon")}</span>
}
export function HookMillTag() {
  return <span className="rounded-[6px] border border-brand-edge bg-brand-soft px-1.5 py-px font-mono text-[10px] font-medium tracking-[.06em] whitespace-nowrap text-brand-ink uppercase">HookMill</span>
}

/** Section card in Ads Manager order (shadcn Card shape: radius 14, no shadow; "off" = only Soon rows). */
export function Sec({ title, tag, lead, off, children }: { title: string; tag?: React.ReactNode; lead?: React.ReactNode; off?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("grid min-w-0 gap-3.5 rounded-[14px] border border-line p-4", off ? "bg-card-2" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-bold">{title}</h3>
        {tag}
      </div>
      {lead ? <p className="-mt-1.5 mb-0 max-w-[62ch] text-[12.5px] text-fg-3">{lead}</p> : null}
      {children}
    </section>
  )
}

/** Label + control + hint or error (aria-describedby; the error replaces the hint, red edge comes from aria-invalid). */
export function F({
  id, label, hint, error, optional, tag, fix, children,
}: {
  id?: string; label: React.ReactNode; hint?: React.ReactNode; error?: string; optional?: boolean; tag?: React.ReactNode; fix?: React.ReactNode; children: React.ReactNode
}) {
  const t = useTranslations("metaTemplates.editor")
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <Label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[13px] font-bold">
        {label}
        {optional ? <span className="font-normal text-fg-3">{t("optional")}</span> : null}
        {tag}
      </Label>
      {children}
      {error ? (
        <span id={id ? `${id}-msg` : undefined} className="text-xs text-status-failed" role="alert">{error}</span>
      ) : hint ? (
        <span id={id ? `${id}-msg` : undefined} className="text-xs text-fg-3">{hint}</span>
      ) : null}
      {error && fix ? <div className="justify-self-start">{fix}</div> : null}
    </div>
  )
}
/** aria props of a field control: invalid + describedby the message under it */
export const aria = (id: string, error?: string) => ({ id, "aria-invalid": !!error || undefined, "aria-describedby": `${id}-msg` })
/** red edge + soft ring on invalid controls (mockup .f.err) */
export const INVALID = "aria-[invalid=true]:border-status-failed aria-[invalid=true]:shadow-[0_0_0_3px_var(--bad-bg)]"

export function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">{children}</div>
}
export function Money({ currency, children }: { currency: string | null; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center font-mono text-xs text-fg-3">{currency ?? "USD"}</span>
      {children}
    </div>
  )
}

/** Read-only row (mockup .ro): value · spacer · note or Soon. */
export function Ro({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[13px] font-bold">{label}</span>
      <div className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[12px] border border-line bg-card-2 px-3 text-[13.5px]">
        <span className="min-w-0 truncate">{children}</span>
        <span className="flex-1" />
        {typeof note === "string" ? <span className="text-xs text-fg-3">{note}</span> : note}
      </div>
    </div>
  )
}
/** Dashed row of something Meta has and the template doesn't yet. */
export function SoonRow({ name, note }: { name: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-[12px] border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-fg-3">
      <span>
        <b className="font-semibold text-fg-2">{name}</b>
        {note ? ` · ${note}` : null}
      </span>
      <Soon />
    </div>
  )
}

/** Choice card with a Radix radio inside (objective, destination, placements). Must sit inside a RadioGroup. */
export function RadioCard({ value, title, body, on, disabled, badge }: { value: string; title: string; body?: string; on: boolean; disabled?: boolean; badge?: React.ReactNode }) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-[var(--field,var(--card))] px-3 py-2.5",
        on && "border-fg shadow-[inset_0_0_0_1px_var(--fg)]",
        disabled && "cursor-not-allowed bg-card-2 opacity-55"
      )}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5 border-line-strong text-fg [&_svg]:fill-fg" />
      <span className="grid min-w-0 flex-1 gap-px">
        <b className="flex flex-wrap items-center gap-2 text-[13.5px]">
          {title}
          {badge}
        </b>
        {body ? <span className="text-[12.5px] text-fg-3">{body}</span> : null}
      </span>
    </label>
  )
}

/** Switch row (mockup .tog): title + line on the left, the switch on the right. */
export function Tog({ title, body, checked, onChange, disabled }: { title: string; body?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="grid min-w-0 cursor-pointer gap-0.5">
        <b className="text-[13.5px]">{title}</b>
        {body ? <span className="text-[12.5px] text-fg-3">{body}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

/** Variables + the resolved example next to every name field. */
export function VarsHint({ sample, extra }: { sample?: string; extra?: string }) {
  const t = useTranslations("metaTemplates.editor")
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {extra ? <span>{extra}</span> : null}
      <span className="font-mono text-[11.5px] text-fg-3">
        {t("vars")}{" "}
        {["{offer}", "{code}", "{date}", "{n}"].map((v) => (
          <code key={v} className="mr-1 rounded-[5px] border border-line-soft bg-card-2 px-1 text-fg-2">{v}</code>
        ))}
      </span>
      {sample ? <span className="font-mono text-xs text-fg-2">→ {sample}</span> : null}
    </span>
  )
}

/**
 * Multi-select with local filter (contract §2.4/§2.6: Combobox multi over a list fetched once): the chosen ones as chips
 * with ×, "Add" opens a popover with a search box and the options. Loading / error / empty states inside the popover.
 */
export function MultiPick<T extends { key: string; label: string }>({
  id, value, options, onChange, addLabel, searchLabel, render, renderChip, loading, error, onRetry, emptyText, disabled, invalid, describedBy, footer,
}: {
  id: string
  value: T[]
  options: T[]
  onChange: (v: T[]) => void
  addLabel: string
  searchLabel: string
  render: (o: T) => React.ReactNode
  renderChip?: (o: T) => React.ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyText?: string
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  footer?: React.ReactNode
}) {
  const t = useTranslations("metaTemplates.editor")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const has = (k: string) => value.some((v) => v.key === k)
  const needle = q.trim().toLowerCase()
  const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle)).slice(0, 200)
  const toggle = (o: T) => onChange(has(o.key) ? value.filter((v) => v.key !== o.key) : [...value, o])
  return (
    <div className="grid gap-2">
      {value.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={addLabel}>
          {value.map((v) => (
            <li key={v.key} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-[8px] border border-line bg-card-2 py-0.5 pr-0.5 pl-2 text-[12.5px]">
              <span className="min-w-0 truncate">{renderChip ? renderChip(v) : render(v)}</span>
              {disabled ? null : (
                <button type="button" onClick={() => toggle(v)} className="grid size-7 flex-none place-items-center rounded-md text-fg-3 hover:bg-card hover:text-fg tablet:size-6" aria-label={t("remove", { name: v.label })}>
                  <Icon name="x" className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ("") }}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            data-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn("inline-flex min-h-11 items-center gap-2 justify-self-start rounded-[12px] border border-line-strong bg-card px-3 text-[13px] font-semibold text-fg-2 hover:border-fg hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 tablet:min-h-10", invalid && "border-status-failed shadow-[0_0_0_3px_var(--bad-bg)]")}
          >
            <Icon name="plus" className="size-3.5" />
            {addLabel}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 grid max-h-[min(380px,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-24px))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[12px] border border-line bg-card shadow-[0_12px_30px_rgba(0,0,0,.14)]"
          >
            <div className="border-b border-line-soft p-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} autoFocus className="h-10" />
            </div>
            <div className="min-h-0 overflow-y-auto p-1" role="listbox" aria-multiselectable="true" aria-label={addLabel}>
              {loading ? (
                <div className="grid gap-1.5 p-1.5" role="status" aria-label={t("loading")}>
                  <span className="sk h-9" />
                  <span className="sk h-9" />
                  <span className="sk h-9" />
                </div>
              ) : error ? (
                <div className="grid gap-2 p-2.5 text-[13px]">
                  <span className="text-status-failed">{error}</span>
                  {onRetry ? (
                    <button type="button" onClick={onRetry} className="justify-self-start text-[13px] font-bold underline underline-offset-2">{t("retry")}</button>
                  ) : null}
                </div>
              ) : !shown.length ? (
                <p className="m-0 p-3 text-[13px] text-fg-3">{needle ? t("noMatch") : emptyText}</p>
              ) : (
                shown.map((o) => {
                  const on = has(o.key)
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(o)}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none tablet:min-h-9"
                    >
                      <span className={cn("grid size-4 flex-none place-items-center rounded-[4px] border", on ? "border-fg bg-fg text-card" : "border-line-strong")}>
                        {on ? <Icon name="check" className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">{render(o)}</span>
                    </button>
                  )
                })
              )}
            </div>
            {footer ? <div className="border-t border-line-soft px-3 py-2 text-xs text-fg-3">{footer}</div> : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  )
}

/** Facebook feed card (spec §2.8): Page, text, the approved video, host + headline + CTA. Live while typing. */
export function AdPreview({
  page, instagram, text, headline, host, cta, thumb, code,
}: {
  page: string; instagram: string | null; text: string; headline: string; host: string; cta: string; thumb: FileRef | null; code: string | null
}) {
  const t = useTranslations("metaTemplates.editor")
  return (
    <aside aria-label={t("previewAria")} className="order-first grid min-w-0 content-start gap-2 min-[1180px]:sticky min-[1180px]:top-0 min-[1180px]:order-none">
      <span className="eyebrow">{instagram ? t("previewIg") : t("preview")}</span>
      <div className="overflow-hidden rounded-[14px] border border-line bg-white text-[#1c1e21]">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="size-7 flex-none rounded-full bg-[#2f3a5c]" aria-hidden="true" />
          <span className="grid min-w-0">
            <b className="truncate text-[12.5px]">{instagram ? `@${instagram}` : page}</b>
            <small className="text-[11px] text-[#65676b]">{t("sponsored")}</small>
          </span>
        </div>
        <p className={cn("m-0 px-3 pb-2.5 text-[12.5px] leading-[1.4] [overflow-wrap:anywhere]", !text.trim() && "text-[#65676b] italic")}>{text.trim() || t("autoText")}</p>
        <div className="relative aspect-[16/10] max-w-full overflow-hidden bg-[linear-gradient(165deg,#6b6450,#1d1f1a)] min-[1180px]:aspect-[4/5]">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb.url} alt="" className="block size-full object-cover" loading="lazy" decoding="async" />
          ) : null}
          <span className="absolute inset-0 grid place-items-center text-white/85" aria-hidden="true">
            <Icon name="play" className="size-6" />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2.5 bg-[#f0f2f5] px-3 py-2.5">
          <span className="grid min-w-0">
            <small className="truncate text-[10.5px] text-[#65676b] uppercase">{host || "yoursite.com"}</small>
            <b className="truncate text-[12.5px]">{headline.trim() || t("headlineFallback")}</b>
          </span>
          <span className="flex-none rounded-md bg-[#e4e6eb] px-2.5 py-[7px] text-xs font-bold whitespace-nowrap">{cta}</span>
        </div>
      </div>
      <span className="text-xs text-fg-3">{code ? t("previewNoteCode", { code }) : t("previewNote")}</span>
    </aside>
  )
}
