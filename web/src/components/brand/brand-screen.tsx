"use client"

import { useId, useState, type ReactNode } from "react"
import Link from "next/link"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { BrainItem, Offer, ResultType, TargetCpa, UiLocale, UpdateOfferBody, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Icon } from "@/components/icon"
import { BrandColorField, normalizeBrandColor } from "@/components/brand-color-field"
import { BrandKit, BRAND_KIT_KEY } from "@/components/brand/brand-kit"
import { useSession } from "@/components/providers/session-provider"
import { useMetaGate } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useRelativeTime } from "@/hooks/use-meta"
import { BRAIN_ITEMS, brainCompleteness, brainItemDone } from "@/lib/brain"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { Reveal } from "@/components/ui/reveal"

/*
 * Brand (design/brand-2026-10-31.md + mockup-brand.html v2, approved 31/10): the default tab of the Brain. Everything the
 * client told us, in label/value rows edited in place; each Save sends a PATCH with only that field (PATCH /workspace or
 * PATCH /offers/:id). Brand kit = the ready component (thumbnail grid). Meta and publish templates read-only, with links.
 * Right rail (sticky): Brain %, what's missing, the section index, "Fill the gaps with Eddy" (Soon). No lime on this screen.
 */
const MAIN_RESULTS: ResultType[] = ["PURCHASE", "LEAD", "MESSAGE", "APPOINTMENT", "SIGNUP"]
const MORE_RESULTS: ResultType[] = ["SUBSCRIPTION", "APP_INSTALL", "OTHER"]
const CURRENCIES = ["USD", "BRL", "EUR"]
const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i
type SectionKey = "business" | "offer" | "audience" | "kit" | "meta"
type Dot = "ok" | "part" | "none"

const ITEM_ROW: Record<BrainItem, string> = {
  businessType: "f-result", industry: "f-industry", market: "f-market", spendCap: "f-cap", offer: "s-offer",
  what: "f-what", promise: "f-promise", offerAndPrice: "f-offerAndPrice", cta: "f-cta", proof: "f-proof",
  audience: "f-audience", pains: "f-pains", notes: "f-notes",
}
const ITEM_SECTION: Record<BrainItem, SectionKey> = {
  businessType: "business", industry: "business", market: "business", spendCap: "business",
  offer: "offer", what: "offer", promise: "offer", offerAndPrice: "offer", cta: "offer", proof: "offer",
  audience: "audience", pains: "audience", notes: "audience",
}

const card = "min-w-0 scroll-mt-20 rounded-[var(--r-card)] border border-line bg-card"
const cardHd = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3.5 tablet:px-[18px]"

export function BrandScreen() {
  const t = useTranslations("brand")
  const tb = useTranslations("onboarding.brain")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const canWs = role === "OWNER" || role === "ADMIN"
  const canOffer = role !== "CLIENT"
  const [ws, offersQ, kit] = useQueries({
    queries: [
      { queryKey: ["workspace"], queryFn: api.workspace.get },
      { queryKey: ["offers"], queryFn: () => api.offers.list() },
      { queryKey: BRAND_KIT_KEY, queryFn: ({ signal }: { signal: AbortSignal }) => api.brandKit.get({ signal }) },
    ],
  })
  const offers = offersQ.data?.data
  const [offerId, setOfferId] = useState<string | null>(null)
  const offer = offers?.find((o) => o.id === offerId) ?? offers?.[0] ?? null
  const gate = useMetaGate()
  const brain = ws.data && offers ? brainCompleteness(ws.data, offers) : null

  const sectionDot = (s: SectionKey): Dot => {
    if (s === "kit") return kit.data ? (kit.data.logo && (kit.data.files.length || kit.data.demoVideos.length) ? "ok" : kit.data.logo || kit.data.files.length || kit.data.demoVideos.length ? "part" : "none") : "none"
    if (s === "meta") return gate.state === "ready" ? "ok" : gate.state === "expired" || gate.state === "broken" || gate.state === "choose" ? "part" : "none"
    if (!ws.data || !offers) return "none"
    const items = BRAIN_ITEMS.filter((i) => ITEM_SECTION[i] === s)
    const done = items.filter((i) => brainItemDone(i, ws.data!, offers)).length
    return done === items.length ? "ok" : done ? "part" : "none"
  }
  const sections: SectionKey[] = ["business", "offer", "audience", "kit", "meta"]
  const anchor = (s: SectionKey) => `s-${s}`

  if ((ws.isError && !ws.data) || (offersQ.isError && !offersQ.data))
    return (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(ws.error ?? offersQ.error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => (ws.refetch(), offersQ.refetch())}>
            <Icon name="refresh" />
            {tc("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )

  const firstOffer = offers?.[0]
  const missingLinks = brain?.missing.map((i) => ({
    key: i,
    href: `#${ITEM_ROW[i]}`,
    label: ITEM_SECTION[i] !== "business" && i !== "offer" && firstOffer && (offers?.length ?? 0) > 1 ? t("rail.forOffer", { item: tb(`item.${i}`), offer: firstOffer.name }) : tb(`item.${i}`),
    onClick: () => {
      if (ITEM_SECTION[i] !== "business" && firstOffer) setOfferId(firstOffer.id)
    },
  }))

  const railReady = !!brain && !!kit.data && gate.state !== "loading"
  const rail = !railReady ? (
    <aside className="flex min-w-0 flex-col gap-3 @min-[761px]:sticky @min-[761px]:top-4" aria-label={t("rail.status")} aria-busy="true">
      <section className={cn(card, "flex flex-col gap-3 p-4")}>
        <span className="flex items-center gap-3.5">
          <span className="sk size-16 rounded-full" />
          <span className="sk h-4 w-32" />
        </span>
        <span className="sk h-[260px] rounded-lg" />
      </section>
    </aside>
  ) : (
    <aside className="flex min-w-0 flex-col gap-3 @min-[761px]:sticky @min-[761px]:top-4" aria-label={t("rail.status")}>
      <section className={card}>
        <div className="flex items-center gap-3.5 px-4 py-4 tablet:px-[18px]">
          <Ring pct={brain?.percent ?? null} />
          <span className="min-w-0">
            <b>{brain ? t("rail.full", { pct: brain.percent }) : <span className="sk inline-block h-4 w-32" />}</b>
            <br />
            <span className="text-[13px] text-fg-3">{brain ? (brain.missing.length ? t("rail.known", { done: BRAIN_ITEMS.length - brain.missing.length, total: BRAIN_ITEMS.length }) : t("rail.allIn")) : " "}</span>
          </span>
        </div>
        {missingLinks?.length || (kit.data && !kit.data.logo) ? (
          <div className="flex flex-col border-t border-line-soft">
            {missingLinks?.map((m) => (
              <a key={m.key} href={m.href} onClick={m.onClick} className="flex min-h-11 items-center justify-between gap-2 border-b border-line-soft px-4 text-[13px] text-inherit no-underline last:border-b-0 hover:bg-card-2 tablet:px-[18px]">
                <span className="first-letter:uppercase">{m.label}</span>
                <b className="text-xs">{t("add")} →</b>
              </a>
            ))}
            {kit.data && !kit.data.logo ? (
              <a href="#s-kit" className="flex min-h-11 items-center justify-between gap-2 border-b border-line-soft px-4 text-[13px] text-fg-3 no-underline last:border-b-0 hover:bg-card-2 tablet:px-[18px]">
                <span>{t("rail.kitEmpty")}</span>
                <b className="text-xs text-fg">{t("rail.see")} →</b>
              </a>
            ) : null}
          </div>
        ) : null}
        <nav className="hidden flex-col border-t border-line-soft p-2 @min-[761px]:flex" aria-label={t("rail.sections")}>
          {sections.map((s) => (
            <a key={s} href={`#${anchor(s)}`} className="flex min-h-9 items-center justify-between gap-2 rounded-[10px] px-2.5 text-[13px] font-semibold text-fg-2 no-underline hover:bg-card-2 hover:text-fg">
              <span>{t(`sections.${s}`)}</span>
              <StDot s={sectionDot(s)} />
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-line-soft px-4 py-3.5 tablet:px-[18px]">
          <span className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-ink font-mono text-xs font-semibold text-brand" aria-hidden="true">Ed</span>
          <span className="min-w-0 flex-1">
            <b className="text-[13px]">{t("rail.eddyT")}</b>
            <br />
            <span className="text-xs text-fg-3">{t("rail.eddyB")}</span>
          </span>
          <Button size="sm" disabled aria-disabled="true">
            {t("rail.soon")}
          </Button>
        </div>
      </section>
    </aside>
  )

  return (
    <div className="@container">
      {/* phone: the index becomes a sticky chip row */}
      <nav className="sticky top-14 z-[2] -my-2 mb-2 flex gap-1.5 tablet:top-0 overflow-x-auto bg-bg py-2 @min-[761px]:hidden" aria-label={t("rail.sections")}>
        {sections.map((s) => (
          <a key={s} href={`#${anchor(s)}`} className="inline-flex min-h-9 flex-none items-center gap-1.5 rounded-full border border-line-strong bg-card px-3 text-[12.5px] font-semibold text-fg no-underline">
            <StDot s={sectionDot(s)} />
            {t(`sections.${s}`)}
          </a>
        ))}
      </nav>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @min-[761px]:grid-cols-12 @min-[761px]:items-start">
        {/* 04/11: the wrapper stretches to the row height, or the sticky rail has no room to stick (it scrolled away) */}
        <div className="@min-[761px]:order-2 @min-[761px]:col-span-4 @min-[761px]:self-stretch">{rail}</div>
        <div className="flex min-w-0 flex-col gap-4 @min-[761px]:order-1 @min-[761px]:col-span-8">
          <BusinessCard ws={ws.data} canEdit={canWs} />
          <OfferCards offers={offers} offer={offer} onPick={setOfferId} canEdit={canOffer} canAdd={canOffer} />
          <div id="s-kit" className="scroll-mt-20">
            <BrandKit title={t("sections.kit")} />
          </div>
          <MetaCard />
        </div>
      </div>
    </div>
  )
}

// ───────────── pieces ─────────────

function StDot({ s }: { s: Dot }) {
  return <i className={cn("size-2 flex-none rounded-full", s === "ok" ? "bg-ok-dot" : s === "part" ? "bg-warn-dot" : "border-[1.5px] border-control")} aria-hidden="true" />
}

function Ring({ pct }: { pct: number | null }) {
  return (
    <span className="grid size-16 flex-none place-items-center rounded-full" style={{ background: `conic-gradient(var(--brand-edge) ${(pct ?? 0) * 3.6}deg, var(--line-soft) 0)` }} aria-hidden="true">
      <span className="grid size-[50px] place-items-center rounded-full bg-card font-mono text-[15px] font-semibold tabular-nums">{pct == null ? "" : `${pct}%`}</span>
    </span>
  )
}

function CardHead({ id, title, aside, saved }: { id: string; title: ReactNode; aside?: ReactNode; saved?: ReactNode }) {
  return (
    <div className={cardHd}>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 id={id} className="text-base font-bold">{title}</h2>
        {aside}
      </span>
      {saved ? <span className="text-xs text-fg-3">{saved}</span> : null}
    </div>
  )
}

/**
 * Label / value row edited in place (spec §2.3): Edit swaps the value for the editor + Save/Cancel; Enter saves (in inputs),
 * Esc cancels; the error stays under the field and the row stays open. `save` resolves = done.
 */
function FieldRow<T>({
  id, label, sub, display, empty, emptyText, canEdit, initial, editor, save, hint, validate,
}: {
  id: string
  label: ReactNode
  sub?: ReactNode
  display: ReactNode
  empty: boolean
  emptyText?: string
  canEdit: boolean
  initial: T
  editor: (v: T, set: (v: T) => void, a: { id: string; describedBy: string; onEnter: () => void }) => ReactNode
  save: (v: T) => Promise<unknown>
  hint?: ReactNode
  validate?: (v: T) => string | null
}) {
  const t = useTranslations("brand")
  const errorMessage = useErrorMessage()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<T>(initial)
  const [err, setErr] = useState<string | null>(null)
  const errId = useId()
  const m = useMutation({ mutationFn: save })
  const start = () => {
    setDraft(initial)
    setErr(null)
    setEditing(true)
  }
  const submit = () => {
    const v = validate?.(draft) ?? null
    if (v) return setErr(v)
    setErr(null)
    m.mutate(draft, {
      onSuccess: () => {
        setEditing(false)
        toast(t("saved"))
      },
      // rule errors mapped by the caller come as a plain Error with the row text
      onError: (e) => setErr(!isApiError(e) && e instanceof Error && e.message ? e.message : isApiError(e) ? errorMessage(e) : t("saveFailed")),
    })
  }
  return (
    <div
      id={id}
      className="grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-t border-line-soft px-4 py-3 first:border-t-0 tablet:px-[18px] @min-[600px]:grid-cols-[180px_minmax(0,1fr)_auto]"
      onKeyDown={(e) => {
        if (editing && e.key === "Escape") {
          e.stopPropagation()
          setEditing(false)
        }
      }}
    >
      <span className="col-span-2 pt-0.5 text-[13px] font-semibold text-fg-3 @min-[600px]:col-span-1">
        {label}
        {sub ? <small className="block text-xs font-normal">{sub}</small> : null}
      </span>
      {editing ? (
        <div className="col-span-2 flex min-w-0 flex-col gap-2">
          {editor(draft, setDraft, { id: `${id}-in`, describedBy: errId, onEnter: submit })}
          {err ? (
            <span id={errId} className="text-xs text-status-failed" role="alert">
              {err}
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="default" onClick={submit} disabled={m.isPending}>
              {m.isPending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={m.isPending}>
              {t("cancel")}
            </Button>
            {hint ? <span className="text-xs text-fg-3 tablet:ml-auto">{hint}</span> : null}
          </div>
        </div>
      ) : (
        <>
          <span className={cn("min-w-0 whitespace-pre-line [overflow-wrap:anywhere]", empty && "font-semibold text-warn")}>{empty ? (emptyText ?? t("missing")) : display}</span>
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={start} className="-my-1 self-start opacity-80 hover:opacity-100">
              {empty ? t("add") : t("edit")}
            </Button>
          ) : (
            <span />
          )}
        </>
      )}
    </div>
  )
}

/** Text / textarea editor of a FieldRow */
function textEditor(multi?: boolean, opts: { mono?: boolean; placeholder?: string; maxLength?: number; inputMode?: "numeric" | "url" } = {}) {
  return function TextEditor(v: string, set: (v: string) => void, a: { id: string; describedBy: string; onEnter: () => void }) {
    return multi ? (
      <Textarea id={a.id} autoFocus value={v} onChange={(e) => set(e.target.value)} aria-describedby={a.describedBy} placeholder={opts.placeholder} className="min-h-[84px]" />
    ) : (
      <Input
        id={a.id}
        autoFocus
        value={v}
        maxLength={opts.maxLength}
        inputMode={opts.inputMode}
        placeholder={opts.placeholder}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), a.onEnter())}
        aria-describedby={a.describedBy}
        className={cn(opts.mono && "font-mono")}
      />
    )
  }
}

function useSaveWorkspace() {
  const qc = useQueryClient()
  return async (b: UpdateWorkspaceBody) => {
    const w = await api.workspace.update(b)
    qc.setQueryData(["workspace"], w)
    void qc.invalidateQueries({ queryKey: ["brain"] })
    void qc.invalidateQueries({ queryKey: ["me"] })
    return w
  }
}

function BusinessCard({ ws, canEdit }: { ws: Workspace | undefined; canEdit: boolean }) {
  const t = useTranslations("brand")
  const tr = useTranslations("onboarding.resultType")
  const th = useTranslations("home")
  const fmt = useFormatter()
  const saveWs = useSaveWorkspace()
  const [savedNow, setSavedNow] = useState(false)
  const save = async (b: UpdateWorkspaceBody) => {
    try {
      const r = await saveWs(b)
      setSavedNow(true)
      return r
    } catch (e) {
      // map the known rule errors to the row message
      if (isApiError(e) && e.status === 409) throw new Error(t("f.codeTaken", { code: b.shortCode ?? "" }))
      if (isApiError(e) && JSON.stringify(e.details ?? {}).includes("min_lte_max")) throw new Error(t("f.minMax"))
      throw e
    }
  }
  if (!ws)
    return (
      <section id="s-business" className={card} aria-labelledby="h-business">
        <CardHead id="h-business" title={t("sections.business")} />
        <RowsSkeleton n={10} />
      </section>
    )
  const money = (v: number, cur: string) => fmt.number(v, { style: "currency", currency: cur, maximumFractionDigits: 2 })
  const resultNoun = th(`resultNoun.${ws.resultType ?? "PURCHASE"}`)
  const tg = ws.targetCpa
  return (
    <section id="s-business" className={card} aria-labelledby="h-business">
      <CardHead id="h-business" title={t("sections.business")} aside={!canEdit ? <ViewOnly /> : null} saved={savedNow ? t("savedNow") : null} />
      <div>
        <FieldRow
          id="f-website" label={t("f.website")} display={<span className="font-mono">{ws.websiteUrl?.replace(/^https?:\/\//, "")}</span>} empty={!ws.websiteUrl} canEdit={canEdit}
          initial={ws.websiteUrl ?? ""} editor={textEditor(false, { mono: true, inputMode: "url", placeholder: "https://" })} hint={t("f.websiteHint")}
          validate={(v) => {
            const s = v.trim()
            if (!s) return null
            return URL_RE.test(s.startsWith("http") ? s : `https://${s}`) ? null : t("f.invalidUrl")
          }}
          save={(v) => {
            const s = v.trim()
            return save({ websiteUrl: s ? (s.startsWith("http") ? s : `https://${s}`) : null })
          }}
        />
        <FieldRow id="f-name" label={t("f.name")} display={ws.name} empty={false} canEdit={canEdit} initial={ws.name} editor={textEditor()} validate={(v) => (v.trim() ? null : t("f.required"))} save={(v) => save({ name: v.trim() })} />
        <FieldRow
          id="f-code" label={t("f.code")} sub={t("f.codeSub")} display={<span className="font-mono">{ws.shortCode}</span>} empty={!ws.shortCode} canEdit={canEdit}
          initial={ws.shortCode} editor={textEditor(false, { mono: true, maxLength: 4 })}
          validate={(v) => (/^[A-Za-z0-9]{2,4}$/.test(v.trim()) ? null : t("f.codeInvalid"))}
          save={(v) => save({ shortCode: v.trim().toUpperCase() })}
        />
        <FieldRow id="f-industry" label={t("f.industry")} display={ws.industry} empty={!ws.industry?.trim()} canEdit={canEdit} initial={ws.industry ?? ""} editor={textEditor()} save={(v) => save({ industry: v.trim() || null })} />
        <FieldRow id="f-market" label={t("f.market")} display={ws.market} empty={!ws.market?.trim()} canEdit={canEdit} initial={ws.market ?? ""} editor={textEditor()} save={(v) => save({ market: v.trim() || null })} />
        <FieldRow<UiLocale>
          id="f-language" label={t("f.language")} sub={t("f.languageSub")} display={t(`lang.${ws.uiLocale}`)} empty={false} canEdit={canEdit} initial={ws.uiLocale}
          editor={(v, set, a) => (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={a.id}>
              {(["EN", "PT_BR"] as UiLocale[]).map((l) => (
                <Chip key={l} on={v === l} onClick={() => set(l)}>
                  {t(`lang.${l}`)}
                </Chip>
              ))}
            </div>
          )}
          save={(v) => save({ uiLocale: v })}
        />
        <FieldRow
          id="f-color" label={t("f.color")}
          display={ws.brandColor ? <span className="font-mono"><i className="mr-1.5 inline-block size-4 rounded-[4px] border border-line-strong align-[-3px]" style={{ background: ws.brandColor }} />{ws.brandColor}</span> : null}
          empty={!ws.brandColor} canEdit={canEdit} initial={ws.brandColor ?? ""}
          editor={(v, set, a) => <BrandColorField id={a.id} value={v} onChange={set} className="[&>div:first-child]:sr-only" />}
          validate={(v) => (normalizeBrandColor(v) === null ? "#RGB / #RRGGBB" : null)}
          save={(v) => save({ brandColor: normalizeBrandColor(v) || null })}
        />
        <FieldRow<{ r: ResultType | null; other: string }>
          id="f-result" label={t("f.result")}
          display={ws.resultType ? (ws.resultType === "OTHER" && ws.resultTypeOther ? ws.resultTypeOther : tr(`${ws.resultType}.label`)) : null}
          empty={!ws.resultType} canEdit={canEdit} initial={{ r: ws.resultType, other: ws.resultTypeOther ?? "" }} hint={t("f.resultHint")}
          editor={(v, set, a) => <ResultEditor v={v} set={set} id={a.id} />}
          validate={(v) => (v.r === "OTHER" && !v.other.trim() ? t("f.required") : null)}
          save={(v) => save({ resultType: v.r, resultTypeOther: v.r === "OTHER" ? v.other.trim() : null })}
        />
        <FieldRow<{ cur: string; min: string; max: string }>
          id="f-target" label={t("f.target", { result: resultNoun })}
          display={
            tg ? (
              <span className="flex flex-col gap-1">
                <span className="font-mono">{money(tg.min, tg.currency)} – {money(tg.max, tg.currency)}</span>
                <span className="relative block h-4 max-w-[280px]" aria-hidden="true">
                  <span className="absolute inset-x-0 top-[7px] h-0.5 bg-line" />
                  <span className="absolute top-0.5 h-3 rounded-[3px] border border-ok-dot bg-ok-bg" style={{ left: `${(tg.min / (tg.max * 2)) * 100}%`, width: `${((tg.max - tg.min) / (tg.max * 2)) * 100}%` }} />
                </span>
                <span className="text-xs text-fg-3">{t("f.targetHint")}</span>
              </span>
            ) : null
          }
          empty={!tg} canEdit={canEdit} initial={{ cur: tg?.currency ?? "USD", min: tg ? String(tg.min) : "", max: tg ? String(tg.max) : "" }}
          editor={(v, set, a) => (
            <div className="flex flex-wrap gap-2">
              <select id={a.id} aria-label={t("f.currency")} value={v.cur} onChange={(e) => set({ ...v, cur: e.target.value })} className="h-11 w-24 rounded-[var(--r-ctl)] border border-line-strong bg-field px-2.5">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <Input aria-label={t("f.min")} placeholder={t("f.min")} inputMode="decimal" value={v.min} onChange={(e) => set({ ...v, min: e.target.value })} onKeyDown={(e) => e.key === "Enter" && a.onEnter()} className="w-28 font-mono" />
              <Input aria-label={t("f.max")} placeholder={t("f.max")} inputMode="decimal" value={v.max} onChange={(e) => set({ ...v, max: e.target.value })} onKeyDown={(e) => e.key === "Enter" && a.onEnter()} className="w-28 font-mono" />
            </div>
          )}
          validate={(v) => {
            if (!v.min.trim() && !v.max.trim()) return null
            const min = Number(v.min.replace(",", "."))
            const max = Number(v.max.replace(",", "."))
            if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0) return t("f.number")
            return min <= max ? null : t("f.minMax")
          }}
          save={(v) => {
            const target: TargetCpa | null = !v.min.trim() && !v.max.trim() ? null : { min: Number(v.min.replace(",", ".")), max: Number(v.max.replace(",", ".")), currency: v.cur }
            return save({ targetCpa: target })
          }}
        />
        <FieldRow
          id="f-cap" label={t("f.cap")} display={ws.monthlySpendCapUsd != null ? <span className="font-mono">{t("f.capValue", { amount: money(ws.monthlySpendCapUsd, "USD") })}</span> : null}
          empty={ws.monthlySpendCapUsd == null} canEdit={canEdit} initial={ws.monthlySpendCapUsd != null ? String(ws.monthlySpendCapUsd) : ""}
          editor={textEditor(false, { mono: true, inputMode: "numeric" })} hint={t("f.capHint")}
          validate={(v) => (!v.trim() || (Number.isFinite(Number(v)) && Number(v) >= 0) ? null : t("f.number"))}
          save={(v) => save({ monthlySpendCapUsd: v.trim() ? Number(v) : null })}
        />
      </div>
    </section>
  )
}

function ResultEditor({ v, set, id }: { v: { r: ResultType | null; other: string }; set: (v: { r: ResultType | null; other: string }) => void; id: string }) {
  const t = useTranslations("brand")
  const tr = useTranslations("onboarding.resultType")
  const [more, setMore] = useState(() => !!v.r && MORE_RESULTS.includes(v.r))
  return (
    <div className="flex flex-col gap-2">
      <div id={id} className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("f.result")}>
        {(more ? [...MAIN_RESULTS, ...MORE_RESULTS] : MAIN_RESULTS).map((r) => (
          <Chip key={r} on={v.r === r} onClick={() => set({ ...v, r })}>
            {tr(`${r}.label`)}
          </Chip>
        ))}
        {more ? null : (
          <Chip on={false} onClick={() => setMore(true)}>
            {t("f.more")}
          </Chip>
        )}
      </div>
      {v.r === "OTHER" ? <Input aria-label={t("f.resultOther")} placeholder={t("f.resultOther")} value={v.other} onChange={(e) => set({ ...v, other: e.target.value })} /> : null}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn("min-h-9 cursor-pointer rounded-full border border-line-strong bg-card px-3 text-[12.5px] font-semibold", on && "border-fg shadow-[0_0_0_1px_var(--fg)]")}
    >
      {children}
    </button>
  )
}

function ViewOnly() {
  const t = useTranslations("brand")
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-line-soft bg-card-2 px-2 text-[11.5px] font-bold text-fg-2">
      <Icon name="lock" className="size-3" />
      {t("viewOnly")}
    </span>
  )
}

/** skullet (04/11): rows with the FieldRow grid and sample text (label · value · action), drawn as measured bars. */
function RowsSkeleton({ n }: { n: number }) {
  const tl = useTranslations("skeleton")
  return (
    <Reveal loading id={`brand.rows.${n}`} label={tl("brand")}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="grid min-h-[53px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-line-soft px-4 py-3.5 first:border-t-0 tablet:px-[18px] @min-[600px]:grid-cols-[180px_minmax(0,1fr)_auto]">
          <span className="text-[13px]">Field label</span>
          <span className="max-w-[66%] truncate text-sm">A sample value for this field</span>
          <span className="text-[13px]">Edit</span>
        </div>
      ))}
    </Reveal>
  )
}

function OfferCards({ offers, offer, onPick, canEdit, canAdd }: { offers: Offer[] | undefined; offer: Offer | null; onPick: (id: string) => void; canEdit: boolean; canAdd: boolean }) {
  const t = useTranslations("brand")
  const rel = useRelativeTime()
  const qc = useQueryClient()
  const save = async (b: UpdateOfferBody) => {
    if (!offer) return
    const o = await api.offers.update(offer.id, b)
    qc.setQueryData<{ data: Offer[] }>(["offers"], (prev) => (prev ? { ...prev, data: prev.data.map((x) => (x.id === o.id ? o : x)) } : prev))
    void qc.invalidateQueries({ queryKey: ["offers"] })
    void qc.invalidateQueries({ queryKey: ["brain"] })
    return o
  }
  const saved = offer ? `${t("saved")} ${rel(offer.updatedAt)}` : null
  const addBtn = canAdd ? (
    <Link href="/offers" className="inline-flex min-h-9 items-center rounded-[10px] border border-dashed border-line-strong bg-card px-3 text-[13px] font-semibold text-fg-3 no-underline hover:border-fg hover:text-fg">
      + {t("offers.add")}
    </Link>
  ) : null
  const brief = (k: "what" | "promise" | "offerAndPrice" | "cta" | "proof" | "audience" | "pains" | "notes", multi: boolean, extra: { sub?: string; placeholder?: string } = {}) =>
    offer ? (
      <FieldRow
        key={`${offer.id}:${k}`} id={`f-${k}`} label={t(`f.${k}`)} sub={extra.sub} display={offer[k]} empty={!offer[k]?.trim()} canEdit={canEdit}
        initial={offer[k] ?? ""} editor={textEditor(multi, { placeholder: extra.placeholder })} save={(v) => save({ [k]: v.trim() || null })}
      />
    ) : null

  if (!offers)
    return (
      <>
        <section id="s-offer" className={card} aria-labelledby="h-offer">
          <CardHead id="h-offer" title={t("sections.offer")} />
          <div className="h-[61px] border-b border-line-soft bg-card-2" />
          <RowsSkeleton n={7} />
        </section>
        <section id="s-audience" className={card} aria-labelledby="h-audience">
          <CardHead id="h-audience" title={t("sections.audience")} />
          <RowsSkeleton n={3} />
        </section>
      </>
    )

  const none = (
    <div className="flex flex-col items-start gap-2 px-4 py-4 tablet:px-[18px]">
      <b>{t("offers.none")}</b>
      <span className="text-[13px] text-fg-3">{t("offers.noneBody")}</span>
      {addBtn}
    </div>
  )

  return (
    <>
      <section id="s-offer" className={card} aria-labelledby="h-offer">
        <CardHead
          id="h-offer" title={t("sections.offer")}
          aside={offers.length ? <span className="inline-flex h-[22px] items-center rounded-full border border-line-soft bg-card-2 px-2 text-[11.5px] font-bold text-fg-2">{t("offers.count", { n: offers.length })}</span> : null}
          saved={saved}
        />
        {offers.length && offer ? (
          <>
            <div className="flex flex-wrap gap-1.5 border-b border-line-soft bg-card-2 px-4 py-3 tablet:px-[18px]" role="group" aria-label={t("offers.label")}>
              {offers.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={o.id === offer.id}
                  onClick={() => onPick(o.id)}
                  className={cn("min-h-9 max-w-full cursor-pointer truncate rounded-[10px] border border-line-strong bg-card px-3 text-[13px] font-semibold", o.id === offer.id && "border-fg shadow-[0_0_0_1px_var(--fg)]")}
                >
                  {o.name}
                </button>
              ))}
              {addBtn}
            </div>
            <div>
              <FieldRow key={`${offer.id}:name`} id="f-offerName" label={t("f.name")} display={offer.name} empty={false} canEdit={canEdit} initial={offer.name} editor={textEditor()} validate={(v) => (v.trim() ? null : t("f.required"))} save={(v) => save({ name: v.trim() })} />
              {brief("what", true)}
              {brief("promise", true)}
              {brief("offerAndPrice", false)}
              {brief("cta", false)}
              <FieldRow
                key={`${offer.id}:lp`} id="f-landing" label={t("f.landing")} display={<span className="font-mono">{offer.sourceUrl?.replace(/^https?:\/\//, "")}</span>} empty={!offer.sourceUrl} canEdit={canEdit}
                initial={offer.sourceUrl ?? ""} editor={textEditor(false, { mono: true, inputMode: "url", placeholder: "https://" })}
                validate={(v) => (!v.trim() || URL_RE.test(v.trim().startsWith("http") ? v.trim() : `https://${v.trim()}`) ? null : t("f.invalidUrl"))}
                save={(v) => {
                  const s = v.trim()
                  return save({ sourceUrl: s ? (s.startsWith("http") ? s : `https://${s}`) : null })
                }}
              />
              {brief("proof", true, { placeholder: t("f.proofPh") })}
            </div>
          </>
        ) : (
          none
        )}
      </section>

      <section id="s-audience" className={card} aria-labelledby="h-audience">
        <CardHead id="h-audience" title={t("sections.audience")} aside={offer && offers.length > 1 ? <span className="text-xs text-fg-3">{t("offers.forOffer", { name: offer.name })}</span> : null} saved={offer ? saved : null} />
        {offer ? (
          <div>
            {brief("audience", true)}
            {brief("pains", true)}
            {brief("notes", true, { sub: t("f.notesSub") })}
          </div>
        ) : (
          none
        )}
      </section>
    </>
  )
}

function MetaCard() {
  const t = useTranslations("brand.meta")
  const tb = useTranslations("brand")
  const gate = useMetaGate()
  const c = gate.conn.data
  const ready = gate.state === "ready"
  const tpl = useQuery({ queryKey: ["meta", "templates"], queryFn: ({ signal }) => api.meta.templates.list({ signal }), enabled: ready })
  const def = tpl.data?.find((x) => x.isDefault)
  const tag =
    gate.state === "ready" ? <Tag tone="ok">{t("connected")}</Tag>
    : gate.state === "expired" || gate.state === "broken" ? <Tag tone="warn">{t("attention")}</Tag>
    : gate.state === "loading" ? null
    : <Tag tone="neutral">{gate.state === "off" ? "—" : t("notConnected")}</Tag>
  const row = (k: string, v: ReactNode, action?: ReactNode) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-t border-line-soft px-4 py-3 first:border-t-0 tablet:px-[18px] @min-[600px]:grid-cols-[180px_minmax(0,1fr)_auto]">
      <span className="col-span-2 text-[13px] font-semibold text-fg-3 @min-[600px]:col-span-1">{k}</span>
      <span className="min-w-0">{v}</span>
      {action ?? <span />}
    </div>
  )
  return (
    <section id="s-meta" className={card} aria-labelledby="h-meta">
      <div className={cardHd}>
        <span className="flex items-center gap-2">
          <h2 id="h-meta" className="text-base font-bold">{tb("sections.meta")}</h2>
          {tag}
        </span>
        {gate.state !== "off" ? (
          <Link href="/settings/connections" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {gate.state === "none" ? t("connect") : t("manage")}
            <Icon name="arrowr" />
          </Link>
        ) : null}
      </div>
      {gate.state === "loading" ? (
        <RowsSkeleton n={3} />
      ) : gate.state === "off" ? (
        <p className="m-0 px-4 py-3.5 text-[13px] text-fg-3 tablet:px-[18px]">{t("off")}</p>
      ) : !c || gate.state === "none" || gate.state === "failed" ? (
        <p className="m-0 px-4 py-3.5 text-[13px] text-fg-3 tablet:px-[18px]">{t("notConnected")}</p>
      ) : (
        <div>
          {row(
            t("account"),
            c.adAccount ? (
              <span className="flex items-center gap-2.5">
                <span className="grid size-7 flex-none place-items-center rounded-[7px] bg-meta font-extrabold text-white" aria-hidden="true">f</span>
                <span className="min-w-0">
                  <b className="block truncate">{c.adAccount.name}</b>
                  <span className="font-mono text-xs text-fg-3">act_••{c.adAccount.id.replace(/^act_/, "").slice(-4)} · {c.adAccount.currency}</span>
                </span>
              </span>
            ) : (
              <span className="text-fg-3">{t("choose")}</span>
            )
          )}
          {row(t("page"), c.page?.name ?? "—")}
          {row(
            t("templates"),
            ready ? (tpl.isPending ? <span className="sk inline-block h-3.5 w-48" /> : [t("templatesN", { n: tpl.data?.length ?? 0 }), def ? t("defaultTpl", { name: def.name }) : null].filter(Boolean).join(" · ")) : "—",
            ready ? (
              <Link href="/settings/connections/templates" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-my-1")}>
                {t("open")}
                <Icon name="arrowr" />
              </Link>
            ) : undefined
          )}
        </div>
      )}
    </section>
  )
}

function Tag({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-bold", tone === "ok" ? "bg-ok-bg text-ok" : tone === "warn" ? "bg-warn-bg text-warn" : "border border-line-soft bg-card-2 text-fg-2")}>
      <i className="size-[7px] rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}
