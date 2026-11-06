"use client"

import { useMemo } from "react"
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl"
import { toast } from "sonner"
import type { Competitor, LibraryAdPlatform } from "@/lib/api/types"
import { isApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useRelativeTime } from "@/hooks/use-meta"

/* Small pieces shared by the Ad Radar screens (mockup-ads-research.html: .av, .media, .pill, .savebtn). */

/** ISO-2 → country name in the interface language */
export function useCountryName() {
  const locale = useLocale()
  const names = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale])
  return (code: string | null | undefined) => {
    if (!code) return ""
    try {
      return names.of(code.toUpperCase()) ?? code
    } catch {
      return code
    }
  }
}

/** "in the United States" / "nos Estados Unidos": the country with its preposition, for sentences (Intl only gives the bare name). */
const IN_EN: Record<string, string> = { US: "the ", GB: "the ", NL: "the ", PH: "the ", AE: "the " }
const IN_PT: Record<string, string> = { US: "nos", BR: "no", GB: "no", CA: "no", MX: "no", CL: "no", PE: "no", UY: "no", PY: "no", JP: "no", AR: "na", ES: "na", FR: "na", DE: "na", IT: "na", AU: "na", CO: "na", IN: "na", NL: "nos", PH: "nas", AE: "nos" }
export function useCountryIn() {
  const locale = useLocale()
  const name = useCountryName()
  return (code: string | null | undefined) => {
    const c = (code ?? "").toUpperCase()
    const n = name(c)
    return locale.startsWith("pt") ? `${IN_PT[c] ?? "em"} ${n}` : `in ${IN_EN[c] ?? ""}${n}`
  }
}

export const mmss = (s: number | null | undefined) => {
  if (s == null) return ""
  const v = Math.round(s)
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`
}

/** a stable tone per name, from the mockup's thumbnail palette */
const TONES = ["#6f6a8f", "#c08a6a", "#9fb89a", "#7d8a96", "#c99aa4", "#8fb3c9", "#d8c3a0"]
export function toneOf(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0
  return TONES[Math.abs(h) % TONES.length]
}

/** mockup .av: the Page photo, or its initial on a tone */
export function PageAvatar({ name, url, size = "md", className }: { name: string; url?: string | null; size?: "sm" | "md"; className?: string }) {
  const cls = cn("grid flex-none place-items-center overflow-hidden rounded-full font-extrabold text-white", size === "sm" ? "size-[22px] text-[10px]" : "size-9 text-sm", className)
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Meta CDN / signed storage URL
    <img src={url} alt="" className={cn(cls, "object-cover")} />
  ) : (
    <span className={cls} style={{ background: toneOf(name) }} aria-hidden="true">
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  )
}

/** mockup .pill (mono 11 px) */
export function RPill({ tone = "plain", className, children }: { tone?: "plain" | "ok" | "lime" | "info" | "warn" | "bad"; className?: string; children: React.ReactNode }) {
  const T = {
    plain: "border-line bg-card-2 text-fg-2",
    ok: "border-transparent bg-status-approved-bg text-status-approved",
    lime: "border-brand-edge bg-brand-soft text-brand-ink",
    info: "border-status-progress-edge bg-status-progress-bg text-status-progress",
    warn: "border-status-waiting-edge bg-status-waiting-bg text-status-waiting",
    bad: "border-status-failed-edge bg-status-failed-bg text-status-failed",
  }
  return <span className={cn("inline-flex h-fit items-center gap-[5px] rounded-[6px] border px-[7px] py-0.5 font-mono text-[11px] whitespace-nowrap", T[tone], className)}>{children}</span>
}

export function AdjacentPill() {
  const t = useTranslations("radar")
  return <RPill tone="info">{t("adjacent")}</RPill>
}

export function usePlatformsLine() {
  const t = useTranslations("radar")
  return (p: LibraryAdPlatform[], long = false) => p.map((x) => t(`${long ? "platform" : "platformShort"}.${x}`)).join(long ? ", " : " · ")
}

/** competitors: direct first, then by active ads (C.2) */
export function sortCompetitors(list: Competitor[]) {
  return [...list].sort((a, b) => (a.relation === b.relation ? b.counts.active - a.counts.active : a.relation === "DIRECT" ? -1 : 1))
}

/** Toasts for the research errors that need words of their own (429 retryAfter, the research budget, a running search). */
export function useResearchErrorToast() {
  const t = useTranslations("radar.toast")
  const errorMessage = useErrorMessage()
  const rel = useRelativeTime()
  return (e: unknown) => {
    if (isApiError(e)) {
      const d = (e.details ?? {}) as { retryAfter?: string; scope?: string; reason?: string }
      if (e.code === "RATE_LIMITED" && d.retryAfter) return toast(t("rateLimited", { when: rel(d.retryAfter) }))
      if (e.code === "SPEND_CAP_EXCEEDED" && d.scope === "research") return toast(t("cap"))
      if (e.code === "INVALID_STATE" && d.reason === "discovery_running") return toast(t("busy"))
    }
    toast(errorMessage(e))
  }
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("spin-ring size-4 border-fg", className)} aria-hidden="true" />
}

/** "2 hours ago" for past moments; a moment a few seconds ahead of the (minute-old) clock reads as "now", never "in 20 seconds" */
export function useAgo() {
  const format = useFormatter()
  const now = useNow({ updateInterval: 15_000 })
  return (iso: string | null | undefined) => {
    if (!iso) return ""
    const d = new Date(iso)
    return format.relativeTime(d > now ? now : d, now)
  }
}
