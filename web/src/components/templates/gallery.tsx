"use client"

import { useDeferredValue, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import type { CreditsSummary, TemplateCard, TemplateCategory, TemplateSourceRef } from "@/lib/api/types"
import { pickedFromParams, sourceFromParams, templateAdHref, templateSelectionHref, templatesHref, CREDITS_HREF } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { Reveal } from "@/components/ui/reveal"
import { SAMPLE_TEMPLATE_CARDS } from "@/lib/skeleton-samples"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NavIcon } from "@/components/shell/nav-icon"
import { PinnedResearchAd } from "@/components/research/pinned-research-ad"
import { useCompetitorAdGuard } from "@/components/research/competitor-ad-warning"
import { IterActionBar } from "@/components/iterate/parts"
import { UnlockDialog } from "@/components/iterate/sample"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useTemplateList } from "@/hooks/use-templates"
import { FitPill, Pill, PricePill, SELECTION_FALLBACK, TemplateVideo, isSelectable, useCreditLabel, useFitText, useNeedText, useUseTemplate } from "./parts"

/*
 * /templates (mockup-templates screen 1-2): search, All / Edit / With AI, category chips, the pack card and the 9:16 cards.
 * Clicking the card opens the detail; the button goes straight to the Ad step. `?metaAdId=` (Home, Campaigns) pins one ad:
 * every card shows if it fits and "Use template" skips the Ad step.
 * templates-multi-v1 §5.1: Edit/Static cards have a checkbox; the checked ones live in `?t=` and a bar at the bottom says
 * "N selected · X credits · Y videos · Continue" (1 = today's flow, 2+ = /templates/selection, or straight to use with a pinned ad).
 */
/** The checkbox of one card: null = the card can't be checked (pack, AI, Soon, Client). */
type Sel = { on: boolean; why: string | null; toggle: () => void } | null
type Tab = "all" | "edit" | "ai"
const EDIT_CATS: TemplateCategory[] = ["frames", "headline", "cuts", "chat", "static"]
const AI_CATS: TemplateCategory[] = ["avatar", "persona", "remix"]

export function TemplatesGallery() {
  const t = useTranslations("adTemplates")
  const errorMessage = useErrorMessage()
  const sp = useSearchParams()
  const source = useMemo(() => sourceFromParams(sp), [sp])
  const q = useTemplateList(source)
  const [tab, setTab] = useState<Tab>(() => sp.get("tab") === "ai" ? "ai" : "all")
  const [chip, setChip] = useState<TemplateCategory | null>(null)
  const [query, setQuery] = useState("")
  const deferred = useDeferredValue(query)
  const [open, setOpen] = useState<TemplateCard | null>(null)
  const use = useUseTemplate()
  const [offerId, setOfferId] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const router = useRouter()

  const credits = q.data?.credits
  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const cats = tab === "all" ? [...EDIT_CATS, ...AI_CATS] : tab === "edit" ? EDIT_CATS : AI_CATS
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) m.set(it.category, (m.get(it.category) ?? 0) + 1)
    return m
  }, [items])
  const visibleCats = cats.filter((c) => counts.get(c))
  const tl = useTranslations("skeleton")
  const showPack = !!q.data?.pack && !deferred && !chip && tab !== "ai"

  // R1 (ads-research-v1 §6.1): a competitor's ad going into a template that reuses its footage asks first
  const r1 = useCompetitorAdGuard()
  const reusesFootage = (cards: Pick<TemplateCard, "tier">[]) => !!source?.researchAdId && cards.some((c) => c.tier !== "AI")
  const pick = (card: TemplateCard) => {
    setOpen(null)
    if (card.autoGenerate) return router.push(templateAdHref(card.slug))
    if (!source) return router.push(templateAdHref(card.slug))
    r1.guard(reusesFootage([card]), () => {
      setPending(card.slug)
      use.mutate({ slugs: [card.slug], source, offerId: offerId ?? undefined }, { onSettled: () => setPending(null) })
    })
  }

  // ── the selection (?t=a,b,c), always kept in gallery order; slugs no longer in the list are dropped silently
  const { session } = useSession()
  const readOnly = session.workspace.role === "CLIENT"
  const limits = q.data?.selection ?? SELECTION_FALLBACK
  const picked = useMemo(() => pickedFromParams(sp), [sp])
  const chosen = useMemo(() => items.filter((c) => picked.includes(c.slug) && isSelectable(c)), [items, picked])
  const sum = chosen.reduce((a, c) => ({ credits: a.credits + (c.credits ?? 0), videos: a.videos + c.outputs, frames: a.frames + (c.category === "frames" ? 1 : 0) }), { credits: 0, videos: 0, frames: 0 })
  const sample = credits?.access === "SAMPLE" ? credits.sample : null
  const setPicked = (slugs: string[]) => {
    const order = items.map((c) => c.slug).filter((x) => slugs.includes(x))
    router.replace(templatesHref(source, order), { scroll: false })
  }
  const selOf = (c: TemplateCard): Sel => {
    if (readOnly || !isSelectable(c)) return null
    const on = chosen.some((x) => x.slug === c.slug)
    const toggle = () => setPicked(on ? chosen.filter((x) => x.slug !== c.slug).map((x) => x.slug) : [...chosen.map((x) => x.slug), c.slug])
    const why = on
      ? null
      : sample && !c.sampleOk
        ? t("paidPlan")
        : c.fit?.level === "hard"
          ? t("fit.doesntFit")
          : chosen.length + 1 > limits.maxTemplates
            ? t("selection.maxTemplates", { n: limits.maxTemplates })
            : c.category === "frames" && sum.frames + 1 > limits.maxFrames
              ? t("selection.maxFrames", { n: limits.maxFrames })
            : sum.videos + c.outputs > limits.maxVideos
              ? t("selection.maxVideos", { n: limits.maxVideos })
              : sample && sum.credits + (c.credits ?? 0) > sample.left
                ? t("selection.usesLeft", { n: sample.left })
                : null
    return { on, why, toggle }
  }
  const go = (slugs: string[]) => {
    if (!slugs.length) return
    if (!source) return router.push(slugs.length === 1 ? templateAdHref(slugs[0]) : templateSelectionHref(slugs))
    r1.guard(reusesFootage(items.filter((c) => slugs.includes(c.slug))), () => {
      setPending("selection")
      use.mutate({ slugs, source, offerId: offerId ?? undefined }, { onSettled: () => setPending(null) })
    })
  }
  const showBar = !readOnly && chosen.length > 0

  return (
    <div className={cn("mx-auto flex w-full max-w-[1240px] flex-col gap-[18px] px-[var(--gut)] pt-5 pb-16 tablet:pt-6", showBar && "max-tablet:pb-[170px]")}>
      {/* tour-v2 §3.3: with the gallery in error / empty, the Templates stop anchors on this header */}
      <div id="t-templates" data-tour-fallback={q.isError || (q.data && !items.length && !q.data.pack) ? "" : undefined} className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="m-0 max-w-[62ch] text-fg-2">{t("lede")}</p>
        </div>
        <BalanceBlock credits={credits} />
      </div>

      {credits?.access === "SAMPLE" && credits.sample ? <SampleBanner left={credits.sample.left} total={credits.sample.total} /> : null}
      {source?.researchAdId ? (
        <PinnedResearchAd id={source.researchAdId} read={q.data?.fitsFor?.read ?? null} />
      ) : source ? (
        <PinnedAd source={source} read={q.data?.fitsFor?.read ?? null} />
      ) : null}
      {use.state.offers ? (
        <OfferPick offers={use.state.offers} value={offerId} onChange={setOfferId} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex min-h-10 max-w-none flex-[1_1_260px] items-center gap-2 rounded-md border border-line-strong bg-field px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-info tablet:max-w-[420px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-fg-3" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4-4" />
          </svg>
          <span className="sr-only">{t("search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
          />
        </label>
        <Segmented
          label={t("tierAria")}
          value={tab}
          onChange={(v) => {
            setTab(v)
            setChip(null)
          }}
          options={[["all", t("tabAll")], ["edit", t("tabEdit")], ["ai", t("tabAi")]]}
          className="w-full tablet:w-auto [&>button]:flex-1 tablet:[&>button]:flex-none"
        />
      </div>
      <div className="no-scrollbar -mx-[var(--gut)] flex gap-1.5 overflow-x-auto px-[var(--gut)] pb-0.5" role="group" aria-label={t("catAria")}>
        <Chip pressed={!chip} onClick={() => setChip(null)}>
          {t("everything")}
        </Chip>
        {visibleCats.map((c) => (
          <Chip key={c} pressed={chip === c} onClick={() => setChip(c)}>
            {t(`cat.${c}`)}
            <small className="ml-1 font-mono text-[10px] text-fg-3">{counts.get(c)}</small>
          </Chip>
        ))}
      </div>

      {/* skullet (04/11): the grid is measured from sample cards while the list loads; filters apply to the sample too */}
      <Reveal
        data={q.isPending ? null : q.data?.items}
        sample={SAMPLE_TEMPLATE_CARDS}
        id="templates.gallery"
        label={tl("templates")}
        error={q.isError ? (
        <Alert variant="destructive">
          <NavIcon name="alert" size={20} />
          <AlertBody>
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription>{errorMessage(q.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => q.refetch()}>
              <NavIcon name="refresh" size={14} />
              {t("tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
        ) : undefined}
      >
        {(cards) => {
          const sampling = cards === SAMPLE_TEMPLATE_CARDS
          const list = filterCards(cards, tab, chip, deferred)
          const edit = list.filter((it) => it.tab === "edit")
          const ai = list.filter((it) => it.tab === "ai")
          const gridId = sampling ? undefined : "t-templates-grid"
          return !cards.length && !q.data?.pack ? (
        <Empty title={t("emptyTitle")} body={t("emptyBody")} />
      ) : !list.length && !showPack ? (
        <Empty title={t("noMatch", { q: deferred })} body={t("noMatchHint")} action={<Button size="sm" onClick={() => setQuery("")}>{t("clearSearch")}</Button>} />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {edit.length || showPack ? (
            <Section id={gridId} title={t("tabEdit")} sub={t("editSub")}>
              {showPack ? <PackCard pack={q.data!.pack!} examples={items.filter((i) => i.example).slice(0, 3)} credits={credits} onUse={() => pick(q.data!.pack!)} busy={pending === q.data!.pack!.slug} /> : null}
              {edit.map((c) => (
                <Card key={c.slug} card={c} credits={credits} sel={sampling ? null : selOf(c)} onOpen={() => setOpen(c)} onUse={() => pick(c)} busy={pending === c.slug} disabled={!!pending} />
              ))}
            </Section>
          ) : null}
          {ai.length ? (
            <Section id={edit.length || showPack ? undefined : gridId} title={t("tabAi")} sub={t("aiSub")}>
              {ai.map((c) => (
                <Card key={c.slug} card={c} credits={credits} sel={sampling ? null : selOf(c)} onOpen={() => setOpen(c)} onUse={() => pick(c)} busy={pending === c.slug} disabled={!!pending} />
              ))}
            </Section>
          ) : null}
        </div>
      )
        }}
      </Reveal>

      {showBar ? (
        <SelectionBar
          count={chosen.length}
          credits={sum.credits}
          videos={sum.videos}
          summary={credits}
          misfit={use.state.misfit}
          names={new Map(items.map((c) => [c.slug, c.name]))}
          busy={pending === "selection"}
          blocked={!!pending || (!!use.state.offers && !offerId)}
          onClear={() => setPicked([])}
          onContinue={() => go(chosen.map((c) => c.slug))}
          onRemoveAndContinue={(out) => {
            const rest = chosen.map((c) => c.slug).filter((x) => !out.includes(x))
            setPicked(rest)
            go(rest)
          }}
        />
      ) : null}

      <DetailDialog card={open} credits={credits} sel={open ? selOf(open) : null} onClose={() => setOpen(null)} onUse={pick} />
      <UnlockDialog open={use.state.unlock} onOpenChange={use.setUnlock} />
      {r1.dialog}
    </div>
  )
}

// ───────────── header ─────────────
function BalanceBlock({ credits }: { credits: CreditsSummary | undefined }) {
  const t = useTranslations("adTemplates")
  const { session } = useSession()
  if (session.workspace.role === "CLIENT") return null
  const value = !credits ? "…" : credits.unlimited ? "∞" : credits.access === "SAMPLE" ? String(credits.sample?.left ?? 0) : String(credits.balance ?? credits.credits)
  return (
    <div className="hidden items-center gap-2 tablet:flex">
      <div className="grid text-right text-xs text-fg-3">
        <span>{credits?.access === "SAMPLE" ? t("freeUses") : credits?.unlimited ? t("teamAccount") : t("balance")}</span>
        <b className="wide text-xl leading-none font-extrabold text-fg tabular-nums">{value}</b>
      </div>
      <Link href={CREDITS_HREF} className={buttonVariants({ size: "sm" })}>
        {t("getCredits")}
      </Link>
    </div>
  )
}

function SampleBanner({ left, total }: { left: number; total: number }) {
  const t = useTranslations("adTemplates.sample")
  return (
    <div className="on-ink flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink px-4 py-3.5 text-ink-fg">
      <div className="grid gap-1">
        <b>{t("banner", { left, total })}</b>
        <p className="m-0 text-[13px] text-ink-fg-2">{t("bannerBody")}</p>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={cn("h-1.5 w-[22px] rounded-[3px]", i < total - left ? "bg-ink-3" : "bg-brand")} />
        ))}
      </div>
    </div>
  )
}

/** `?metaAdId=` & co.: the ad the cards are checked against, with a way out. */
function PinnedAd({ source, read }: { source: TemplateSourceRef; read: boolean | null }) {
  const t = useTranslations("adTemplates")
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-card px-4 py-3 text-[13px]">
      <NavIcon name="info" size={16} className="text-fg-3" />
      <span className="min-w-0 flex-1 text-fg-2">{read === false ? t("pinnedUnread") : t("pinned")}</span>
      <Link href={templatesHref()} className={buttonVariants({ size: "sm", variant: "ghost" })}>
        {t("pinnedClear")}
      </Link>
      <span className="sr-only">{Object.values(source)[0]}</span>
    </div>
  )
}

function OfferPick({ offers, value, onChange }: { offers: { id: string; name: string }[]; value: string | null; onChange: (v: string) => void }) {
  const t = useTranslations("adTemplates")
  return (
    <div className="flex max-w-[480px] flex-col gap-1.5 rounded-lg border border-status-waiting-edge bg-status-waiting-bg p-3.5">
      <label htmlFor="tpl-offer" className="text-[13px] font-semibold">
        {t("offerLabel")}
      </label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger id="tpl-offer" className="w-full min-w-0 bg-field">
          <SelectValue placeholder={t("offerLabel")} />
        </SelectTrigger>
        <SelectContent>
          {offers.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-fg-2">{t("offerHelp")}</span>
    </div>
  )
}

// ───────────── controls ─────────────
export function Segmented<V extends string>({ label, value, onChange, options, className }: { label: string; value: V; onChange: (v: V) => void; options: [V, string][]; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex overflow-hidden rounded-md border border-line-strong bg-card", className)}>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className="min-h-[38px] cursor-pointer border-0 bg-transparent px-3.5 text-[13px] font-semibold text-fg-2 aria-pressed:bg-fg aria-pressed:text-card"
        >
          {l}
        </button>
      ))}
    </div>
  )
}
function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="min-h-[34px] flex-none cursor-pointer rounded-full border border-line bg-card px-3 text-[13px] whitespace-nowrap text-fg-2 aria-pressed:border-fg aria-pressed:font-semibold aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--fg)]"
    >
      {children}
    </button>
  )
}

/** `id`: the first section's grid is the tour's Templates stop (`#t-templates-grid`). */
function Section({ id, title, sub, children }: { id?: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <span className="eyebrow mt-1">
        <b className="text-fg">{title}</b> · {sub}
      </span>
      <div id={id} data-tour-first-row={id ? "" : undefined} className="grid grid-cols-2 gap-2.5 tablet:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] tablet:gap-4">{children}</div>
    </section>
  )
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-9 text-center text-fg-2">
      <b className="text-fg">{title}</b>
      <span>{body}</span>
      {action}
    </div>
  )
}

/** The cards a search, tab and category chip leave (gallery order). */
function filterCards(items: TemplateCard[], tab: Tab, chip: TemplateCategory | null, query: string) {
  const needle = query.trim().toLowerCase()
  return items.filter((it) => {
    if (tab !== "all" && it.tab !== tab) return false
    if (chip && it.category !== chip) return false
    if (needle && !`${it.name} ${it.description}`.toLowerCase().includes(needle)) return false
    return true
  })
}

// ───────────── cards ─────────────
function Card({ card, credits, sel, onOpen, onUse, busy, disabled }: { card: TemplateCard; credits?: CreditsSummary; sel: Sel; onOpen: () => void; onUse: () => void; busy: boolean; disabled: boolean }) {
  const t = useTranslations("adTemplates")
  const { session } = useSession()
  // O backend informa quais formatos já produzem o vídeo completo em background.
  const off = !card.available || (!card.autoGenerate && (card.beta || card.credits == null || card.tier === "AI"))
  const locked = credits?.access === "SAMPLE" && !card.sampleOk
  const hard = card.fit?.level === "hard"
  const readOnly = session.workspace.role === "CLIENT"
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-card p-1.5 text-left tablet:gap-2.5 tablet:p-2",
        !off && "cursor-pointer hover:border-line-strong",
        sel?.on && "border-fg shadow-[inset_0_0_0_1px_var(--fg)] hover:border-fg"
      )}
      aria-label={card.name}
      onClick={off ? undefined : onOpen}
    >
      <div className="relative">
        <div skullet-block="" className={cn((off || hard) && "opacity-70 saturate-[.3]")}>
          <TemplateVideo template={card} />
        </div>
        {sel ? <SelectBox card={card} sel={sel} /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 px-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          {off ? (
            <b className="truncate text-sm">{card.name}</b>
          ) : (
            <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-bold">
              {card.name}
            </button>
          )}
          <PricePill card={card} credits={credits} />
        </div>
        <p className="m-0 line-clamp-2 min-h-[2.6em] text-xs text-fg-2 tablet:line-clamp-3 tablet:min-h-[3.9em] tablet:text-[12.5px]">{card.description}</p>
        {card.fit ? <FitPill fit={card.fit} className="max-w-full self-start whitespace-normal" /> : null}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 px-1 pb-1">
        <span className="hidden font-mono text-[11px] text-fg-3 tabular-nums tablet:inline">{off ? t("beta") : t("usedN", { out: card.out, n: card.uses })}</span>
        {off ? (
          <Button size="sm" disabled className="flex-1 tablet:flex-none">
            {t("soon")}
          </Button>
        ) : locked ? (
          <Link href={CREDITS_HREF} onClick={(e) => e.stopPropagation()} className={buttonVariants({ size: "sm", className: "flex-1 tablet:flex-none" })}>
            {t("paidPlan")}
          </Link>
        ) : (
          <Button
            size="sm"
            className="flex-1 tablet:flex-none"
            disabled={hard || readOnly || disabled}
            aria-busy={busy}
            title={readOnly ? t("readOnly") : undefined}
            onClick={(e) => {
              e.stopPropagation()
              onUse()
            }}
          >
            {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
            {t("useTemplate")}
          </Button>
        )}
      </div>
    </article>
  )
}

/** The card's checkbox (§5.1), in the corner of the video; a disabled one says why (limit, sample, misfit). */
function SelectBox({ card, sel }: { card: TemplateCard; sel: NonNullable<Sel> }) {
  const t = useTranslations("adTemplates.selection")
  const id = `sel-${card.slug}`
  const off = !sel.on && !!sel.why
  return (
    <span
      className={cn("absolute right-1.5 bottom-1.5 z-[6] grid size-9 place-items-center rounded-md bg-ink/75 backdrop-blur-sm", off && "bg-ink/50")}
      title={sel.why ?? undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox
        id={id}
        checked={sel.on}
        disabled={off}
        onCheckedChange={sel.toggle}
        aria-label={t("select", { name: card.name })}
        aria-describedby={off ? `${id}-why` : undefined}
        className="border-ink-fg-2 bg-transparent"
      />
      {off ? (
        <span id={`${id}-why`} className="sr-only">
          {sel.why}
        </span>
      ) : null}
    </span>
  )
}

/** The fixed bar of the selection: "N selected · X credits · Y videos" + Clear + Continue (§5.1). */
function SelectionBar({
  count, credits, videos, summary, misfit, names, busy, blocked, onClear, onContinue, onRemoveAndContinue,
}: {
  count: number; credits: number; videos: number; summary: CreditsSummary | undefined; misfit: { slug: string; reason: string }[] | null
  names: Map<string, string>; busy: boolean; blocked: boolean; onClear: () => void; onContinue: () => void; onRemoveAndContinue: (slugs: string[]) => void
}) {
  const t = useTranslations("adTemplates")
  const tp = useTranslations("adTemplates.plan")
  const fitText = useFitText()
  const sample = summary?.access === "SAMPLE" ? summary.sample : null
  const balance = summary && !summary.unlimited && !sample ? (summary.balance ?? summary.credits) : null
  const bad = misfit?.filter((m) => names.has(m.slug)) ?? []
  const hint = bad.length ? (
    <b className="text-status-waiting">
      {bad.length === 1
        ? t("selection.doesntFitOne", { name: names.get(bad[0].slug)!, reason: fitText({ level: "hard", reason: bad[0].reason }) ?? "" })
        : t("selection.doesntFitMany", { names: bad.map((m) => names.get(m.slug)).join(", ") })}
    </b>
  ) : (
    <>
      <b className="text-fg">{t("selection.selectedN", { n: count })}</b>
      {" · "}
      {sample ? t("selection.usesOf", { n: credits, left: sample.left }) : summary?.unlimited ? null : t("credits", { n: credits })}
      {sample || !summary?.unlimited ? " · " : null}
      {tp("videosN", { n: videos })}
      {balance !== null && credits > balance ? <span className="text-status-waiting"> · {t("selection.balanceIs", { n: balance })}</span> : null}
    </>
  )
  return (
    <div role="region" aria-label={t("selection.barAria")} className="contents">
      <IterActionBar hint={<span aria-live="polite">{hint}</span>}>
        <Button variant="ghost" onClick={onClear} disabled={busy}>
          {t("selection.clear")}
        </Button>
        {bad.length && bad.length < count ? (
          <Button variant="brand" disabled={busy || blocked} aria-busy={busy} onClick={() => onRemoveAndContinue(bad.map((m) => m.slug))}>
            {busy ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
            {bad.length === 1 ? t("selection.removeOne", { name: names.get(bad[0].slug)! }) : t("selection.removeMany", { n: bad.length })}
          </Button>
        ) : (
          <Button variant="brand" disabled={busy || blocked || bad.length > 0} aria-busy={busy} onClick={onContinue}>
            {busy ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
            {t("selection.continue")}
            <NavIcon name="right" size={16} />
          </Button>
        )}
      </IterActionBar>
    </div>
  )
}

/** The pack card (mockup .pack): ink, spans 2 columns, three stacked examples. */
function PackCard({ pack, examples: real, credits, onUse, busy }: { pack: TemplateCard; examples: TemplateCard[]; credits?: CreditsSummary; onUse: () => void; busy: boolean }) {
  const t = useTranslations("adTemplates.pack")
  const { session } = useSession()
  const sample = credits?.access === "SAMPLE"
  // three examples of what the pack makes: the real ones when they exist, else the type illustrations
  const fallback: Pick<TemplateCard, "example" | "poster" | "category" | "slug" | "name">[] = [
    { ...pack, category: "headline", slug: "new-headline", example: null, poster: null },
    { ...pack, category: "chat", slug: "chat-dm", example: null, poster: null },
    { ...pack, category: "frames", slug: "breaking-news", example: null, poster: null },
  ]
  const examples = real.length >= 3 ? real : fallback
  return (
    <div className="on-ink col-span-2 grid gap-3.5 rounded-lg border border-ink bg-ink p-3.5 text-ink-fg tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="grid grid-cols-3 content-start gap-1.5">
        {examples.map((e, i) => (
          <TemplateVideo key={i} template={e} label={false} className="rounded-lg" />
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <Pill className="self-start border-ink-line bg-ink-3 text-ink-fg">{t("pill", { n: 12 })}</Pill>
        <h2 className="wide m-0 text-lg font-extrabold text-ink-fg">{pack.name}</h2>
        <p className="m-0 text-[13px] text-ink-fg-2">{pack.description}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0 text-[12.5px] text-ink-fg-2">
          {[t("li1"), t("li2"), sample ? t("li3Sample") : t("li3", { cap: pack.credits ?? 10 })].map((l) => (
            <li key={l} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 size-1.5 flex-none rounded-[2px] bg-brand" />
              {l}
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="mt-auto self-start border-ink-line bg-ink-2 text-ink-fg hover:border-ink-fg hover:bg-ink-2"
          onClick={onUse}
          disabled={session.workspace.role === "CLIENT" || pack.fit?.level === "hard"}
          aria-busy={busy}
        >
          {busy ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
          {t("use")}
        </Button>
      </div>
    </div>
  )
}

// ───────────── detail ─────────────
function DetailDialog({ card, credits, sel, onClose, onUse }: { card: TemplateCard | null; credits?: CreditsSummary; sel: Sel; onClose: () => void; onUse: (c: TemplateCard) => void }) {
  const t = useTranslations("adTemplates")
  const label = useCreditLabel()
  const need = useNeedText()
  const { session } = useSession()
  const ai = card?.tier === "AI"
  const nine = card?.autoGenerate || card?.slug === "chat-dm" || card?.slug === "person-motion" || card?.slug === "new-headline"
  const sample = credits?.access === "SAMPLE"
  const locked = sample && !card?.sampleOk
  return (
    <Dialog open={!!card} onOpenChange={(v) => (v ? null : onClose())}>
      {card ? (
        <DialogContent className="no-scrollbar max-h-[calc(100dvh-16px)] w-[min(860px,calc(100%-16px))] max-w-none gap-[22px] overflow-y-auto p-4 sm:max-w-none max-tablet:top-auto max-tablet:bottom-2 max-tablet:flex max-tablet:translate-y-0 max-tablet:flex-col tablet:grid-cols-[minmax(0,300px)_minmax(0,1fr)] tablet:p-5">
          <TemplateVideo template={card} sound className="mx-auto max-w-[230px] flex-none tablet:max-w-none" />
          <div className="flex min-w-0 flex-col gap-3.5 pt-1.5">
            <span className="eyebrow">{ai ? t("detail.aiTemplate") : t("detail.editTemplate")}</span>
            <DialogTitle className="m-0 pr-10 text-[26px]">{card.name}</DialogTitle>
            <DialogDescription className="m-0 max-w-[52ch] text-fg-2">{card.description}</DialogDescription>
            <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-fg-3">{t("detail.youGet")}</dt>
              <dd className="m-0">{nine ? t("detail.getOnly", { out: card.out.replace(/\s*·\s*9:16/, "") }) : t("detail.getAll", { out: card.out })}</dd>
              <dt className="text-fg-3">{t("detail.cost")}</dt>
              <dd className="m-0">
                <b>{sample && card.sampleOk ? t("freeSample") : card.autoGenerate && card.credits == null ? t("unlimited") : label(card.credits)}</b> · {card.autoGenerate ? t("detail.costEdit") : ai ? t("detail.costAi") : t("detail.costEdit")}
              </dd>
              <dt className="text-fg-3">{t("detail.time")}</dt>
              <dd className="m-0">{ai ? t("detail.timeAi") : t("detail.timeEdit")}</dd>
              <dt className="text-fg-3">{t("detail.language")}</dt>
              <dd className="m-0">{t("detail.languageValue")}</dd>
            </dl>
            {card.fit ? <FitPill fit={card.fit} className="max-w-full self-start whitespace-normal" /> : null}
            {card.needs.length ? (
              <div className="grid gap-1.5">
                <span className="eyebrow">{t("detail.needs")}</span>
                <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
                  {card.needs.map((n) => (
                    <li key={n} className="flex items-center gap-2">
                      <span aria-hidden="true" className="size-3.5 flex-none rounded-[4px] border-[1.5px] border-fg-3" />
                      {need(n)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-fg-3">{t("detail.anyAd")}</p>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="min-w-[200px] flex-1 text-xs text-fg-3">{t("detail.exampleNote")}</span>
              {sel ? (
                <Button variant="outline" onClick={sel.toggle} disabled={!sel.on && !!sel.why} title={sel.why ?? undefined}>
                  {sel.on ? t("selection.remove") : t("selection.add")}
                </Button>
              ) : null}
              {locked ? (
                <Link href={CREDITS_HREF} className={buttonVariants({ variant: "brand" })}>
                  {t("paidPlan")}
                </Link>
              ) : (
                <Button variant="brand" onClick={() => onUse(card)} disabled={!card.available || session.workspace.role === "CLIENT" || card.fit?.level === "hard"}>
                  {t("detail.use")}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

