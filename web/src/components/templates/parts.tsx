"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type {
  AutoVariationType, CreditsSummary, FileRef, IterateBatch, OfferRequiredDetails, TemplateCard, TemplateDoesntFitDetails, TemplateFit, TemplateFitReason,
  TemplateSelectionInvalidDetails, TemplateSelectionLimits, TemplateSourceRef,
} from "@/lib/api/types"
import { CREDITS_HREF, templateRunHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { TypeThumb } from "@/components/iterate/parts"
import { ik } from "@/hooks/use-iterate"
import { tk } from "@/hooks/use-templates"
import { ME_KEY } from "@/hooks/use-me"
import { useErrorMessage } from "@/hooks/use-error-message"

/* Building blocks of the template gallery (design/mockup-templates.html, approved 31/10; templates-creditos-v1). */

// ───────────── example video ─────────────
/** Fallback art when a card has no example yet (admin rows, the plan of an old run): the Iterate type illustration. */
function fallbackType(t: Pick<TemplateCard, "category" | "slug">): AutoVariationType | "orig" {
  if (t.slug === "chat-dm") return "CHAT_DM"
  if (t.slug === "person-motion") return "PERSON_MOTION"
  if (t.slug === "native-search") return "NATIVE_SEARCH"
  if (t.slug === "review") return "REVIEW"
  const m: Record<string, AutoVariationType> = { frames: "FRAME", headline: "HEADLINE", cuts: "CUT", static: "STATIC" }
  return m[t.category] ?? "orig"
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return reduced
}

/**
 * The 9:16 example (spec §7-§8): muted loop that plays only while on screen (`preload="none"`, poster first); reduced
 * motion = the poster, still. `sound` = the detail: controls, plays with sound on demand. No example = the type illustration.
 */
export function TemplateVideo({
  template, sound, label = true, className,
}: { template: Pick<TemplateCard, "example" | "poster" | "category" | "slug" | "name">; sound?: boolean; label?: boolean; className?: string }) {
  const t = useTranslations("adTemplates")
  const ref = useRef<HTMLVideoElement>(null)
  const reduced = useReducedMotion()
  const ex = template.example
  useEffect(() => {
    const v = ref.current
    if (!v || sound || reduced || !ex) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {})
        else v.pause()
      },
      { threshold: 0.35 }
    )
    io.observe(v)
    return () => io.disconnect()
  }, [sound, reduced, ex])
  return (
    <div className={cn("relative isolate aspect-[9/16] w-full overflow-hidden rounded-[10px] bg-ink", className)}>
      {ex ? (
        <video
          ref={ref}
          src={ex.url}
          poster={template.poster?.url}
          muted={!sound}
          loop={!sound}
          playsInline
          controls={sound}
          preload={sound ? "metadata" : "none"}
          aria-label={t("exampleAria", { name: template.name })}
          className="absolute inset-0 size-full object-cover"
        />
      ) : template.poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
        <img src={template.poster.url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <TypeThumb type={fallbackType(template)} className="absolute inset-0 size-full rounded-none" />
      )}
      {label ? (
        <>
          <span className="pointer-events-none absolute top-[7px] left-[7px] z-[5] rounded-[4px] bg-ink/80 px-[5px] py-0.5 font-mono text-[9px] tracking-[0.06em] text-ink-fg">{t("example")}</span>
          <span className="pointer-events-none absolute top-[7px] right-[7px] z-[5] rounded-[4px] bg-white/90 px-[5px] py-0.5 font-mono text-[9px] text-fg">9:16</span>
        </>
      ) : null}
    </div>
  )
}

/** A small still (rows, rails, admin): the poster or the illustration. */
export function TemplateStill({ template, className }: { template: Pick<TemplateCard, "poster" | "category" | "slug">; className?: string }) {
  return template.poster ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
    <img src={template.poster.url} alt="" className={cn("aspect-[9/16] w-full rounded-[5px] object-cover", className)} />
  ) : (
    <TypeThumb type={fallbackType(template)} className={cn("rounded-[5px]", className)} />
  )
}

/** An ad's still (Meta thumbnail URL, a library file). */
export function AdStill({ url, file, className }: { url?: string | null; file?: FileRef | null; className?: string }) {
  const src = url ?? file?.url ?? null
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed / Meta CDN URL
    <img src={src} alt="" loading="lazy" className={cn("aspect-[9/16] w-full rounded-[6px] bg-card-2 object-cover", className)} />
  ) : (
    <TypeThumb type="orig" className={cn("rounded-[6px]", className)} />
  )
}

// ───────────── pills ─────────────
type PillTone = "plain" | "cr" | "ai" | "ok" | "warn" | "bad" | "beta"
const PILL: Record<PillTone, string> = {
  plain: "border-line bg-card-2 text-fg-2",
  cr: "border-line-strong bg-card text-fg",
  ai: "border-ink bg-ink text-ink-fg",
  ok: "border-transparent bg-status-approved-bg text-status-approved",
  warn: "border-status-waiting-edge bg-status-waiting-bg text-status-waiting",
  bad: "border-status-failed-edge bg-status-failed-bg text-status-failed",
  beta: "border-dashed border-line-strong bg-card-2 text-fg-2",
}
/** mockup .pill: mono 11 px; price in credits (light for Edit, ink for AI), fit by color. */
export function Pill({ tone = "plain", children, className }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-fit items-center gap-[5px] rounded-[6px] border px-[7px] py-0.5 font-mono text-[11px] whitespace-nowrap", PILL[tone], className)}>{children}</span>
}

export function useCreditLabel() {
  const t = useTranslations("adTemplates")
  return (n: number | null | undefined) => (n == null ? t("soon") : t("credits", { n }))
}

/** Price of a card: Free sample · N credits (ink for AI) · Soon. */
export function PricePill({ card, credits }: { card: Pick<TemplateCard, "credits" | "tier" | "beta" | "sampleOk" | "autoGenerate">; credits?: CreditsSummary }) {
  const t = useTranslations("adTemplates")
  const label = useCreditLabel()
  if (card.autoGenerate && card.credits == null) return <Pill tone="ai">{t("unlimited")}</Pill>
  if (card.beta || card.credits == null) return <Pill tone="beta">{t("soon")}</Pill>
  if (credits?.access === "SAMPLE" && card.sampleOk) return <Pill tone="ok">{t("freeSample")}</Pill>
  return <Pill tone={card.tier === "AI" ? "ai" : "cr"}>{label(card.credits)}</Pill>
}

/** Fit reason in words (§6). Unknown reasons fall back to a generic line. */
/** troca-texto-queimado-v1 §16.5 (F1b): hard fits of a copied headline, besides `headline_pending`. */
const HEADLINE_FIT_REASONS = new Set(["headline_near_caption", "headline_font_far", "headline_plate_rejected", "headline_no_fit"])

export function useFitText() {
  const t = useTranslations("adTemplates.fit")
  return (fit: TemplateFit | null | undefined) => {
    if (!fit) return null
    if (fit.level === "ok") return t("ok")
    if (fit.level === "unknown") return t("unknown")
    const r = fit.reason ?? ""
    return t.has(`reason.${r}` as never) ? t(`reason.${r}` as never) : fit.level === "soft" ? t("reason.burned_captions") : t("doesntFit")
  }
}
export function FitPill({ fit, className }: { fit: TemplateFit | null | undefined; className?: string }) {
  const text = useFitText()(fit)
  if (!fit || !text) return null
  const tone: PillTone = fit.level === "ok" ? "ok" : fit.level === "unknown" ? "plain" : "warn"
  return <Pill tone={tone} className={className}>{text}</Pill>
}

/** "Your ad needs" keys (§8, TemplateNeed) in words. */
export function useNeedText() {
  const t = useTranslations("adTemplates.needs")
  return (k: string) => (t.has(k as never) ? t(k as never) : k)
}

// ───────────── using a template ─────────────
export type UseState = {
  unlock: boolean
  offers: { id: string; name: string }[] | null
  /** templates-multi-v1: 422 TEMPLATE_DOESNT_FIT `items` (the checked ones that don't fit an ad already read) */
  misfit: { slug: string; reason: TemplateFitReason }[] | null
}
export type UseVars = { slugs: string[]; source: TemplateSourceRef; offerId?: string; cleanUploadId?: string; expectedCredits?: number }

/**
 * POST /ad-templates/:slug/use (1 slug) or /ad-templates/use (2+, templates-multi-v1) → the batch → /templates/run/:id. Nothing
 * is charged here. 402 = the unlock dialog ("Talk to us"); 422 OFFER_REQUIRED = the caller shows the offer picker (offers in
 * `state.offers`) and calls again with `offerId`; 422 TEMPLATE_DOESNT_FIT with `items` = `state.misfit` ("Remove X and continue");
 * 422 TEMPLATE_SELECTION_INVALID = toast + `onInvalid` (the Ad step goes back to the gallery).
 */
export function useUseTemplate({ onInvalid }: { onInvalid?: (d: TemplateSelectionInvalidDetails | null) => void } = {}) {
  const t = useTranslations("adTemplates.selection")
  const tr = useTranslations("radar")
  const router = useRouter()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const fitText = useFitText()
  const [state, setState] = useState<UseState>({ unlock: false, offers: null, misfit: null })
  const requestIds = useRef(new Map<string, string>())
  const m = useMutation({
    mutationFn: ({ slugs, source, offerId, cleanUploadId, expectedCredits }: UseVars) => {
      const key = JSON.stringify([slugs, source, offerId, cleanUploadId, expectedCredits])
      let generation: { requestId: string; expectedCredits: number } | undefined
      if (expectedCredits !== undefined) {
        const requestId = requestIds.current.get(key) ?? crypto.randomUUID()
        requestIds.current.set(key, requestId)
        generation = { requestId, expectedCredits }
      }
      const b = { ...source, ...(offerId ? { offerId } : {}), ...(cleanUploadId ? { cleanUploadId } : {}), ...(generation && { generation }) }
      return slugs.length === 1 ? api.adTemplates.use(slugs[0], b) : api.adTemplates.useMany({ ...b, slugs })
    },
    onMutate: () => setState((s) => ({ ...s, misfit: null })),
    onSuccess: (b: IterateBatch) => {
      requestIds.current.clear()
      qc.setQueryData(ik.batch(b.id), b)
      void qc.invalidateQueries({ queryKey: tk.credits })
      void qc.invalidateQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ["creatives"] })
      router.push(templateRunHref(b.id))
    },
    onError: (e) => {
      if (isApiError(e) && (e.code === "PAYMENT_REQUIRED" || e.code === "INSUFFICIENT_CREDITS")) return setState((s) => ({ ...s, unlock: true }))
      if (isApiError(e) && e.code === "OFFER_REQUIRED") {
        const d = e.details as unknown as OfferRequiredDetails | undefined
        return setState((s) => ({ ...s, offers: d?.offers?.map((o) => ({ id: o.id, name: o.name })) ?? [] }))
      }
      // ads-research-v1 §6.1: a competitor ad that needs a new collection, or has no video
      if (isApiError(e) && e.code === "SPEND_CAP_EXCEEDED" && (e.details as { scope?: string } | undefined)?.scope === "research") return void toast(tr("toast.cap"))
      if (isApiError(e) && e.code === "INVALID_STATE" && (e.details as { reason?: string } | undefined)?.reason === "ad_has_no_video") return void toast(tr("card.noVideo"))
      if (isApiError(e) && e.code === "TEMPLATE_DOESNT_FIT") {
        const d = e.details as unknown as TemplateDoesntFitDetails | undefined
        if (d?.items?.length) return setState((s) => ({ ...s, misfit: d.items! }))
        // troca-texto-queimado-v1 §15.4: says what's unavailable instead of the generic "doesn't fit"
        if (d?.reason === "headline_pending") return void toast(errorMessage("HEADLINE_PENDING"))
        // §16.5 (F1b): the 4 new headline reasons say which one, through the fit line ("Headline too close to the captions"…)
        if (d?.reason && HEADLINE_FIT_REASONS.has(d.reason)) return void toast(fitText({ level: "hard", reason: d.reason }))
      }
      if (isApiError(e) && e.code === "TEMPLATE_SELECTION_INVALID") {
        const d = (e.details ?? null) as unknown as TemplateSelectionInvalidDetails | null
        const r = d?.reason
        toast(r === "too_many_videos" ? t("invalid.too_many_videos", { n: d?.maxVideos ?? 12 }) : r === "too_many_frames" ? t("invalid.too_many_frames", { n: d?.max ?? 8 }) : r === "not_found" || r === "pack" || r === "ai_tier" ? t(`invalid.${r}`) : errorMessage(e))
        return onInvalid?.(d)
      }
      toast(errorMessage(e))
    },
  })
  return { ...m, state, setUnlock: (v: boolean) => setState((s) => ({ ...s, unlock: v })) }
}

// ───────────── the selection (templates-multi-v1) ─────────────
/** Used only if an older API leaves `TemplateList.selection` out; the numbers come from the API (§3.3). */
export const SELECTION_FALLBACK: TemplateSelectionLimits = { minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: 8 }

/** Edit and Static templates can be checked; the pack, AI, "Soon" and Client can't (§5.1). */
export function isSelectable(card: TemplateCard) {
  return !card.pack && card.tier !== "AI" && card.available && !card.beta && card.credits != null
}

/** "Get credits" as a link (the lime only when it is the screen's one action). */
export function GetCreditsLink({ brand, className, children }: { brand?: boolean; className?: string; children?: React.ReactNode }) {
  const t = useTranslations("adTemplates")
  return (
    <Link
      href={CREDITS_HREF}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-btn border px-4 text-sm font-bold whitespace-nowrap",
        brand ? "border-transparent bg-brand text-[#15171a] hover:bg-brand-hover" : "border-line-strong bg-card text-fg hover:border-fg",
        className
      )}
    >
      {children ?? t("getCredits")}
    </Link>
  )
}

/** The balance in words: "42 credits" · "3 free left" · "Unlimited". */
export function useBalanceText() {
  const t = useTranslations("adTemplates")
  return (c: CreditsSummary | undefined) => {
    if (!c) return "…"
    if (c.unlimited) return t("unlimited")
    if (c.access === "SAMPLE" && c.sample) return t("freeLeft", { n: c.sample.left })
    return t("credits", { n: c.balance ?? c.credits })
  }
}
