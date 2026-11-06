"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeMetaResponse, MetaBudgetTooLowDetails, MetaConnection, MetaPublishTemplate, MetaTemplateImportedFrom } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Icon } from "@/components/icon"
import { EmptyState } from "@/components/page"
import { useSession } from "@/components/providers/session-provider"
import { MetaLockCard, useMetaGate } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { pk, useMinorMoney } from "@/hooks/use-meta-publish"
import { planAdsets, useMetaTemplates, useTemplateActions } from "@/hooks/use-meta-templates"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { stashBatchSent } from "./batch-send"
import { ImportPicker } from "./import-picker"
import { AdLevel, AdsetLevel, CampaignLevel, type LevelCtx } from "./editor-levels"
import { LevelGlyph } from "./editor-parts"
import {
  GOALS, LEVELS, build, draftOf, errorKeyOf, factoryTemplate, hostOf, int, isGoalObjective, levelOf, parseCountries, resolveSample, scheduleDays,
  type BodyLike, type Draft, type Errors, type Level,
} from "./editor-model"

/*
 * Campaign template editor in the Ads Manager format (spec design/template-campanha-2026-11-02.md, mockup
 * design/mockup-template-campanha.html; contract meta-templates-v2 §8). Full page without the app sidebar:
 * header (crumb, name, Import, Default, ×) · structure tree Campaign › Ad set › Ad (300 px; 3 tabs on the phone) ·
 * the level's section cards in Ads Manager order · sticky footer Back / Next / Save.
 * Routes: /publish/template/:id?return=<send url>&creative=<id>&n=<ads> and /settings/connections/templates/:id
 * (`new` = a fresh template; `?import=1` opens "Import from a campaign" right away).
 */
export const TEMPLATES_LIST = "/settings/connections/templates"
/** Flip when the API publishes with an inline structure (changes for one send only, template untouched). */
const INLINE_SEND = true // 04/11: the API takes { templateId, override } (meta-templates-v2 §14)
export type EditorOrigin = "send" | "settings"

/** `return` only points inside the app (no protocol-relative or absolute URLs). */
const safeReturn = (v: string | null) => (v && v.startsWith("/") && !v.startsWith("//") ? v : null)
const withParam = (url: string, k: string, v: string) => {
  const [path, hash = ""] = url.split("#")
  const u = new URL(path, "http://x")
  u.searchParams.set(k, v)
  return `${u.pathname}${u.search}${hash ? `#${hash}` : ""}`
}
const creativeOfReturn = (r: string | null) => r?.match(/^\/creatives\/([^/?#]+)\/send/)?.[1] ?? null

export function TemplateEditorPage({ templateId, origin }: { templateId: string; origin: EditorOrigin }) {
  const t = useTranslations("metaTemplates.editor")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const sp = useSearchParams()
  const returnTo = safeReturn(sp.get("return"))
  const creativeId = sp.get("creative") ?? creativeOfReturn(returnTo)
  const nParam = int(sp.get("n") ?? "")
  const sampleCount = nParam >= 1 && nParam <= 50 ? nParam : creativeId ? 1 : 10
  const importNow = sp.get("import") === "1"
  // 04/11 (Gusta): "Review and send" = this editor prefilled with the chosen template, sending instead of saving.
  // `creatives=<id,id,…>` (batch) or the single `creative`; the template itself only changes with "Also save to the template".
  const reviewIds = sp.get("review") === "1" ? (sp.get("creatives")?.split(",").filter(Boolean) ?? (creativeId ? [creativeId] : [])).slice(0, 50) : null
  // a send-time 400 with `templateId` opens the editor on that field (contract v2 §3/§8)
  const field = sp.get("field")
  const focus = field ? { field, rule: sp.get("rule") ?? "" } : null
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const readOnly = role === "CLIENT"
  const gate = useMetaGate()
  const conn = gate.conn.data ?? null
  // the expired/broken connection still opens the editor (F4: look, keep the draft, Save disabled)
  const usable = gate.ready || gate.state === "expired" || gate.state === "broken"
  const list = useMetaTemplates(usable)
  // F4 on an API that still answers the list with 422 META_TOKEN_INVALID: not fatal, the editor opens in the amber state
  const listExpired = list.isError && isApiError(list.error) && list.error.code === "META_TOKEN_INVALID"
  const expired = !gate.ready || listExpired
  const isNew = templateId === "new"
  // the approved video + offer link for the factory values and the ad preview
  const creative = useQuery({ queryKey: ["meta", "editor", "creative", creativeId], queryFn: ({ signal }) => api.meta.creative(creativeId!, { signal }), enabled: !!creativeId && usable && !readOnly, staleTime: 60_000, retry: false })
  const card = useQuery({ queryKey: ["creative", creativeId], queryFn: () => api.creatives.get(creativeId!), enabled: !!creativeId, staleTime: 60_000, retry: false })
  const leaveHref = returnTo ?? (origin === "settings" ? TEMPLATES_LIST : "/")

  const shell = (body: React.ReactNode) => (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <div className="grid w-full max-w-[560px] gap-4">
        <Link href={leaveHref} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] text-fg-2 hover:text-fg">
          <Icon name="left" />
          {t("back")}
        </Link>
        {body}
      </div>
    </main>
  )

  if (gate.state === "loading" || (usable && list.isPending) || (isNew && creativeId && creative.isPending && creative.fetchStatus !== "idle")) return <EditorSkeleton />
  if (gate.state === "off")
    return shell(
      <EmptyState className="max-w-none">
        <h2>{t("offTitle")}</h2>
        <p className="text-fg-2">{t("offBody")}</p>
      </EmptyState>
    )
  if (gate.state === "failed" || (list.isError && !listExpired)) {
    const e = gate.state === "failed" ? gate.conn.error : list.error
    return shell(
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(e)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => (gate.state === "failed" ? gate.conn.refetch() : list.refetch())}>
            <Icon name="refresh" />
            {tc("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  }
  if (!usable) return shell(<MetaLockCard state={gate.state} />)
  const templates = list.data ?? []
  const template = isNew ? null : (templates.find((x) => x.id === templateId) ?? null)
  // the list couldn't be read and this template isn't cached: reconnecting is the way to see it
  if (!isNew && !template && listExpired)
    return shell(
      <Alert variant="warning">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("expiredTitle")}</AlertTitle>
          <AlertDescription>{errorMessage(list.error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href="/settings/connections" className={buttonVariants({ size: "sm", variant: "meta" })}>{t("reconnect")}</Link>
        </AlertActions>
      </Alert>
    )
  if (!isNew && !template)
    return shell(
      <EmptyState className="max-w-none">
        <h2>{t("notFoundTitle")}</h2>
        <p className="text-fg-2">{t("notFoundBody")}</p>
      </EmptyState>
    )
  const c = card.data ?? null
  const review = reviewIds && template && !readOnly ? { creativeIds: reviewIds, batch: sp.has("creatives") } : null
  return (
    <Editor
      key={`${templateId}${review ? ":review" : ""}`}
      template={template}
      review={review}
      first={!templates.length && !listExpired}
      origin={origin}
      returnTo={returnTo}
      leaveHref={leaveHref}
      conn={conn}
      expired={expired}
      readOnly={readOnly}
      importNow={importNow && !readOnly && isNew}
      focus={focus}
      sampleCount={review ? Math.max(1, review.creativeIds.length) : sampleCount}
      offerLink={creative.data?.defaults?.link ?? null}
      sample={{ thumb: c?.thumbnail ?? null, code: c?.adName ?? null, offer: c?.offer.name ?? null }}
    />
  )
}

function EditorSkeleton() {
  const tc = useTranslations("common")
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-bg" role="status" aria-label={tc("loading")}>
      <div className="flex items-center gap-3 border-b border-line bg-card px-4 py-3">
        <span className="grid flex-1 gap-1.5">
          <span className="sk h-3 w-48" />
          <span className="sk h-6 w-72 max-w-full" />
        </span>
        <span className="sk size-9 rounded-[10px]" />
      </div>
      <div className="grid min-h-0 tablet:grid-cols-[300px_minmax(0,1fr)]">
        <div className="hidden gap-2 border-r border-line bg-card-2 p-3 tablet:grid tablet:content-start">
          <span className="sk h-14" />
          <span className="sk ml-4 h-14" />
          <span className="sk ml-8 h-14" />
        </div>
        <div className="grid max-w-[760px] content-start gap-3 p-4 tablet:p-5">
          <span className="sk h-6 w-40" />
          <span className="sk h-40 rounded-[14px]" />
          <span className="sk h-56 rounded-[14px]" />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-card px-4 py-3">
        <span className="sk h-11 w-24" />
        <span className="sk h-11 w-36" />
      </div>
    </div>
  )
}

type Review = { creativeIds: string[]; batch: boolean }
type Imported = { importedFrom: MetaTemplateImportedFrom; unsupported: { field: string; value: string }[]; adjusted: { field: string; value: string }[] }

function Editor({
  template, review, first, origin, returnTo, leaveHref, conn, expired, readOnly, importNow, focus, sampleCount, offerLink, sample,
}: {
  review: Review | null
  focus: { field: string; rule: string } | null
  template: MetaPublishTemplate | null
  first: boolean
  origin: EditorOrigin
  returnTo: string | null
  leaveHref: string
  conn: MetaConnection | null
  expired: boolean
  readOnly: boolean
  importNow: boolean
  sampleCount: number
  offerLink: string | null
  sample: LevelCtx["sample"]
}) {
  const t = useTranslations("metaTemplates.editor")
  const tf = useTranslations("publish.form")
  const ev = useTranslations("metaTemplates.event")
  const errorMessage = useErrorMessage()
  const router = useRouter()
  const uid = useId()
  const currency = conn?.adAccount?.currency ?? null
  const tz = conn?.adAccount?.timezoneName ?? null
  const account = conn?.adAccount?.name ?? "Meta"
  const money = useMinorMoney(currency)
  const actions = useTemplateActions()
  const isEdit = !!template
  // review drafts live apart: changes for one send never leak into the template's own draft
  const draftKey = `hm:tpl-${review ? "review" : "draft"}:${conn?.adAccount?.id ?? "-"}:${template?.id ?? "new"}`
  const tr = useTranslations("metaTemplates.review")
  const qc = useQueryClient()
  const [saveToo, setSaveToo] = useState(false)
  const [sending, setSending] = useState(false)

  const initial = useMemo<Draft>(() => {
    if (template) return draftOf(template, currency, template.isDefault)
    const body = factoryTemplate(conn, { name: first ? t("firstName") : t("newName"), campaignName: `{offer} — ${t("campaignNameDefault")}`, link: offerLink })
    return draftOf(body, currency, first)
  }, [template, currency, conn, first, offerLink, t])
  // spec §8: the draft survives a reconnect (sessionStorage per ad account while the page is open)
  const [d, setD] = useState<Draft>(() => {
    if (typeof window === "undefined" || readOnly) return initial
    try {
      const raw = sessionStorage.getItem(draftKey)
      return raw ? { ...initial, ...(JSON.parse(raw) as Partial<Draft>) } : initial
    } catch {
      return initial
    }
  })
  const [level, setLevel] = useState<Level>(() => (focus ? (levelOf(focus.field, template?.campaign.budgetMode ?? "CBO") ?? "campaign") : "campaign"))
  const [errors, setErrors] = useState<Errors>(() => (focus ? { [errorKeyOf(focus.field)]: ruleMessage(focus.rule, (k, v) => t(k as Parameters<typeof t>[0], v as never)) } : {}))
  const [tried, setTried] = useState(false)
  const [apiMin, setApiMin] = useState<number | null>(null)
  const [imported, setImported] = useState<Imported | null>(null)
  const [importing, setImporting] = useState(importNow && !expired)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(focus ? 1 : 0)
  const paneRef = useRef<HTMLDivElement>(null)
  const minDaily = apiMin ?? conn?.adAccount?.minDailyBudgetMinor ?? null
  const tt = (k: string, v?: Record<string, string | number>) => t(k as Parameters<typeof t>[0], v as never)
  const opts = { currency, minDaily, tz, t: tt, money }
  const dirty = JSON.stringify(d) !== JSON.stringify(initial) || !!imported

  useEffect(() => {
    if (readOnly) return
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(d))
      else sessionStorage.removeItem(draftKey)
    } catch {
      /* private mode: the draft just doesn't survive a reload */
    }
  }, [d, dirty, draftKey, readOnly])

  // Save with errors: jump to the level of the first one and focus it (spec §2.4)
  useEffect(() => {
    if (!focusTick) return
    const el = (paneRef.current?.querySelector('[aria-invalid="true"], [data-invalid="true"]') ?? (errors.name ? document.getElementById(`${uid}-name`) : null)) as HTMLElement | null
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: "center" })
  }, [focusTick, errors.name, uid])

  // the Brain's target CPA under Campaign › Budget (Loom do Tordan 29/10)
  const format = useFormatter()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get, staleTime: 60_000 })
  const cpa = ws.data?.targetCpa ?? null
  const cpaMoney = (v: number) => {
    try {
      return format.number(v, { style: "currency", currency: cpa!.currency, maximumFractionDigits: Number.isInteger(v) ? 0 : 2 })
    } catch {
      return `${v} ${cpa!.currency}`
    }
  }
  const cpaLine = cpa ? (
    <p className="m-0 rounded-[12px] border border-brand-edge bg-brand-soft px-3 py-2.5 text-[13px] text-brand-ink">
      {t.rich("cpa", { range: cpa.min === cpa.max ? cpaMoney(cpa.min) : `${cpaMoney(cpa.min)}–${cpaMoney(cpa.max)}`, b: (x) => <b>{x}</b> })}
    </p>
  ) : null

  // pixels: GET /meta/options (OWNER/ADMIN, live) + the connection's + the saved one
  const options = useQuery({
    queryKey: ["meta", "options", conn?.adAccount?.id ?? null],
    queryFn: ({ signal }) => api.meta.options({ adAccountId: conn!.adAccount!.id }, { signal }),
    enabled: !readOnly && !expired && !!conn?.adAccount,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const pixels = [
    ...(options.data?.pixels ?? []).map((p) => ({ id: p.id, name: p.name })),
    ...(conn?.pixel ? [conn.pixel] : []),
    ...(d.pixelId ? [{ id: d.pixelId, name: d.pixelId }] : []),
  ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)

  const update = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch }
    setD(next)
    if (tried) setErrors(build(next, opts).errors)
  }

  const busy = actions.create.isPending || actions.update.isPending || actions.remove.isPending || sending
  const errorLevel = (k: string) => levelOf(k, d.budgetMode)
  const showErrors = (map: Errors) => {
    setErrors(map)
    const firstKey = Object.keys(map).find((k) => errorLevel(k)) ?? null
    if (firstKey) setLevel(errorLevel(firstKey)!)
    setFocusTick((n) => n + 1)
  }
  const leave = (href: string) => {
    try {
      sessionStorage.removeItem(draftKey)
    } catch {
      /* ignore */
    }
    router.push(href)
  }
  const askLeave = (href: string) => (dirty && !readOnly ? setLeaving(href) : leave(href))

  const onError = (e: unknown) => {
    if (!isApiError(e)) return toast(errorMessage(e))
    if (e.code === "META_BUDGET_TOO_LOW") {
      const det = (e.details as Partial<MetaBudgetTooLowDetails> | undefined) ?? {}
      const m = det.minimumMinor ?? null
      if (det.budgetType === "LIFETIME") {
        if (m !== null && det.days) setApiMin(Math.ceil(m / det.days))
        showErrors({ "campaign.lifetimeBudgetMinor": t("err.lifetimeBelow", { min: m === null ? "—" : money(m), days: det.days ?? "—" }) })
      } else {
        setApiMin(m)
        showErrors({ "campaign.dailyBudgetMinor": t("err.budgetBelow", { min: m === null ? "—" : money(m) }) })
      }
    } else if (e.code === "META_PIXEL_REQUIRED") {
      showErrors({ "adset.pixelId": t("err.pixel") })
    } else if (e.code === "VALIDATION_ERROR") {
      const fields = (e.details as { fields?: { field: string; rule?: string }[] } | undefined)?.fields ?? []
      const map: Errors = {}
      for (const f of fields) map[errorKeyOf(f.field)] = ruleMessage(f.rule, tt, listOf(d, f.field))
      if (!fields.length) toast(errorMessage(e))
      else showErrors(map)
    } else toast(errorMessage(e))
  }
  const save = () => {
    if (readOnly || expired) return
    setTried(true)
    const r = build(d, opts)
    if (!r.body) return showErrors(r.errors)
    setErrors({})
    const body = { ...r.body, ...(imported ? { importedFrom: imported.importedFrom } : {}) }
    const done = (tpl: MetaPublishTemplate) => {
      toast(returnTo ? t("savedSelected", { name: tpl.name }) : t("saved", { name: tpl.name }))
      leave(returnTo ? withParam(returnTo, "template", tpl.id) : TEMPLATES_LIST)
    }
    if (template) actions.update.mutate({ id: template.id, body }, { onSuccess: done, onError })
    else actions.create.mutate(body, { onSuccess: done, onError })
  }
  /*
   * Review and send (04/11). The API publishes from a saved template only (POST …/publish { templateId } and
   * POST /meta/publish-batch { creativeIds, templateId }; the job reads the template row at run time), so:
   * unchanged → send with the template; "Also save to the template" → PATCH, then send; changes for this send only →
   * waits for the API to take the structure inline (INLINE_SEND).
   */
  const onlyThis = !!review && dirty && !saveToo && !INLINE_SEND
  const send = async () => {
    if (!review || !template || readOnly || expired || sending) return
    setTried(true)
    const r = build(d, opts)
    if (!r.body) return showErrors(r.errors)
    setErrors({})
    if (onlyThis || !review.creativeIds.length) return
    setSending(true)
    try {
      if (saveToo && dirty) await actions.update.mutateAsync({ id: template.id, body: { ...r.body, ...(imported ? { importedFrom: imported.importedFrom } : {}) } })
      const ids = review.creativeIds
      // changed for this send only → the three levels go as `override`; the template row stays as it is
      const override = dirty && !saveToo ? { campaign: r.body.campaign, adset: r.body.adset, ad: r.body.ad } : undefined
      if (review.batch) {
        const res = await api.meta.publishBatch({ creativeIds: ids, templateId: template.id, ...(override ? { override } : {}) })
        for (const p of res.publications) qc.setQueryData<CreativeMetaResponse>(pk.creative(p.creativeId), (prev) => (prev ? { ...prev, publication: p } : prev))
        stashBatchSent(res)
      } else {
        const p = await api.meta.publish(ids[0], { templateId: template.id, ...(override ? { override } : {}) })
        qc.setQueryData<CreativeMetaResponse>(pk.creative(ids[0]), (prev) => (prev ? { ...prev, publication: p } : prev))
        void qc.invalidateQueries({ queryKey: pk.creative(ids[0]) })
      }
      void qc.invalidateQueries({ queryKey: ["meta", "publications"] })
      toast(saveToo && dirty ? tr("savedSent", { name: r.body.name }) : tr("sentOne"))
      const back = returnTo ?? (review.batch ? "/" : `/creatives/${encodeURIComponent(ids[0])}/send`)
      leave(review.batch ? withParam(withParam(back, "batch", "1"), "sent", "1") : back)
    } catch (e) {
      setSending(false)
      onError(e)
    }
  }
  const archive = () => {
    if (!template) return
    actions.remove.mutate(template.id, {
      onSuccess: () => {
        toast(t("archived", { name: template.name }))
        leave(TEMPLATES_LIST)
      },
      onError: (e) => toast(isApiError(e) && e.status === 409 ? t("archiveBusy") : errorMessage(e)),
    })
  }

  // ── summaries of the tree (contract §8: "Awareness · CBO · US$ 300 total" / "Reach · 7 days · US · EN · +2 −1" / "@account")
  const plan = planAdsets(sampleCount, { min: int(d.min) || 1, max: int(d.max) || 1 })
  const amountOf = (s: string) => {
    const v = Number(s.replace(",", "."))
    return s.trim() && Number.isFinite(v) && v > 0 ? v : null
  }
  const moneyOf = (v: number | null) => (v === null ? null : format.number(v, { style: "currency", currency: currency ?? "USD" }))
  const budgetText = (() => {
    const lifetime = d.budgetType === "LIFETIME"
    const v = moneyOf(amountOf(lifetime ? d.lifetimeBudget : d.budget))
    if (!v) return t("sum.budgetMissing")
    return lifetime ? t("sum.total", { amount: v }) : t("sum.perDay", { amount: v })
  })()
  const days = scheduleDays(d, tz)
  const sumCampaign = [tf(`objective.${d.objective}`), d.budgetMode === "CBO" ? `CBO ${budgetText}` : "ABO"].join(" · ")
  const audiencesText = [d.customAudiences.length ? `+${d.customAudiences.length}` : null, d.excludedCustomAudiences.length ? `−${d.excludedCustomAudiences.length}` : null].filter(Boolean).join(" ")
  const sumAdset = [
    isGoalObjective(d.objective) ? t(`goal.${d.optimizationGoal ?? GOALS[d.objective]![0]}`) : d.pixelId ? ev(d.pixelEvent ?? "PURCHASE") : t("linkClicks"),
    days ? t("sum.days", { n: days }) : null,
    parseCountries(d.countries).join(", ") || "—",
    `${d.ageMin}–${d.ageMax}`,
    d.locales.length ? d.locales.map((l) => l.name.slice(0, 2).toUpperCase()).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).join(" ") : null,
    audiencesText ? t("sum.audiences", { list: audiencesText }) : null,
    d.budgetMode === "ABO" ? budgetText : null,
  ].filter(Boolean).join(" · ")
  const sumAd = d.instagramAccount ? `@${d.instagramAccount.username} · ${tf(`ctaLabel.${d.cta}`)}` : [tf(`ctaLabel.${d.cta}`), hostOf(d.link) || t("sum.noLink")].join(" · ")
  const errCount = (l: Level) => Object.keys(errors).filter((k) => errorLevel(k) === l).length
  const errTotal = Object.keys(errors).length
  // import strip: the field's label on screen instead of its API path ("adset.schedule" → "Schedule"); unknown paths stay as they are
  const fieldLabel = (field: string) => {
    const k = IMPORT_FIELD_LABEL.find(([prefix]) => field === prefix || field.startsWith(`${prefix}.`))?.[1]
    return k ? t(k as Parameters<typeof t>[0]) : field
  }

  const ctx: LevelCtx = {
    d, update, errors, uid, readOnly, expired, currency, money, minDaily, conn, pixels, pixelsLoading: options.isFetching, cpaLine, sampleCount, plan, sample,
  }
  const idx = LEVELS.indexOf(level)
  const next = LEVELS[idx + 1] ?? null
  const go = (l: Level) => {
    setLevel(l)
    paneRef.current?.scrollTo(0, 0)
  }
  const crumbFirst = origin === "send" ? t("crumbSend") : t("crumbTemplates")
  const title = review ? tr("crumb") : readOnly ? t("titleView") : isEdit ? t("titleEdit") : t("titleNew")
  const defaultLocked = readOnly || first || !!template?.isDefault

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-bg">
      {/* header: crumb + name · Import · Default · × */}
      <header className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-card px-3 py-2.5 tablet:px-4 tablet:py-3">
        <div className="grid min-w-0 flex-[1_1_280px] gap-0.5 max-tablet:pr-12">
          <nav aria-label={t("crumbAria")} className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-3">
            {origin === "settings" ? (
              <>
                <button type="button" onClick={() => askLeave("/settings")} className="inline-flex min-h-8 items-center font-semibold text-fg-2 underline underline-offset-[3px] hover:text-fg tablet:min-h-0">{t("crumbSettings")}</button>
                <span aria-hidden="true">›</span>
              </>
            ) : null}
            <button type="button" onClick={() => askLeave(leaveHref)} className="inline-flex min-h-8 items-center font-semibold text-fg-2 underline underline-offset-[3px] hover:text-fg tablet:min-h-0">{crumbFirst}</button>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{title}</span>
          </nav>
          <input
            id={`${uid}-name`}
            value={d.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={t("namePlaceholder")}
            aria-label={t("nameAria")}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? `${uid}-name-msg` : undefined}
            // review: the name is the template's; it only changes when saving to it
            disabled={readOnly || busy || (!!review && !saveToo)}
            maxLength={60}
            className="-ml-1.5 w-full max-w-[420px] min-w-0 rounded-[8px] border border-transparent bg-transparent px-1.5 py-[3px] text-base font-extrabold [font-stretch:115%] text-fg outline-none hover:border-line focus-visible:border-line-strong focus-visible:bg-card aria-[invalid=true]:border-status-failed tablet:text-lg"
          />
          {errors.name ? <span id={`${uid}-name-msg`} className="text-xs text-status-failed" role="alert">{errors.name}</span> : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 tablet:w-auto">
          {!isEdit && !readOnly ? (
            <Button size="sm" onClick={() => setImporting(true)} disabled={busy || expired}>{t("import")}</Button>
          ) : null}
          {review ? null : (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox checked={d.isDefault} disabled={defaultLocked || busy} onCheckedChange={(v) => update({ isDefault: v === true })} />
            {t("defaultFor", { account })}
          </label>
          )}
          <Button size="icon-sm" onClick={() => askLeave(leaveHref)} aria-label={t("close")} className="max-tablet:absolute max-tablet:top-2.5 max-tablet:right-3">
            <Icon name="x" />
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] tablet:grid-cols-[300px_minmax(0,1fr)] tablet:grid-rows-1">
        {/* structure tree (desktop) */}
        <nav aria-label={t("structure")} className="hidden min-h-0 flex-col gap-3.5 overflow-y-auto border-r border-line bg-card-2 px-2.5 py-3.5 tablet:flex">
          <span className="eyebrow px-2">{t("structureEyebrow")}</span>
          <div className="relative grid gap-0.5 before:absolute before:top-[34px] before:bottom-[22px] before:left-[18px] before:w-px before:bg-line-strong">
            <TreeNode level="campaign" depth={0} on={level === "campaign"} onClick={() => go("campaign")} kind={t("node.campaign")} title={resolveSample(d.campaignName, undefined, sample.offer ?? undefined) || t("newCampaign")} sub={sumCampaign} errors={errCount("campaign")} />
            <TreeNode level="adset" depth={1} on={level === "adset"} onClick={() => go("adset")} kind={t("node.adset")} title={plan.length > 1 ? t("adsetTitleMany", { sets: plan.length, min: d.min, max: d.max }) : t("adsetTitle", { min: d.min, max: d.max })} sub={sumAdset} errors={errCount("adset")} />
            <TreeNode level="ad" depth={2} on={level === "ad"} onClick={() => go("ad")} kind={t("node.ad")} title={t("adTitle")} sub={sumAd} errors={errCount("ad")} />
          </div>
          <div className="grid gap-2 border-t border-line px-2 pt-3">
            <span className="eyebrow">{t("planEyebrow", { n: sampleCount })}</span>
            <div className="grid gap-1 text-[12.5px] text-fg-2">
              <div className="flex justify-between gap-2">
                <span>{t("planCampaign")}</span>
                <span className="font-mono">{d.destination === "REUSE_CAMPAIGN" && !(d.budgetMode === "CBO" && d.budgetType === "LIFETIME") ? t("planReused") : t("planNew")}</span>
              </div>
              {plan.map((p, i) => (
                <div key={i} className={cn("flex justify-between gap-2", p.short && "text-status-waiting")}>
                  <span>{t("planAdset", { i: i + 1 })}</span>
                  <span className="font-mono">{p.short ? t("planAdsBelow", { n: p.size, min: d.min }) : t("planAds", { n: p.size })}</span>
                </div>
              ))}
            </div>
            <span className="text-xs text-fg-3">{t("paused")}</span>
          </div>
          {!isEdit && !readOnly ? (
            <div className="mt-auto grid gap-2 border-t border-line px-2 pt-3">
              <span className="text-xs text-fg-3">{t("importLead")}</span>
              <Button size="sm" onClick={() => setImporting(true)} disabled={busy || expired}>{t("importSettings")}</Button>
            </div>
          ) : null}
        </nav>

        {/* steps (phone) */}
        <div role="tablist" aria-label={t("levelsAria")} className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line bg-card-2 px-3 py-2 tablet:hidden">
          {LEVELS.map((l, i) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={level === l}
              onClick={() => go(l)}
              className={cn("flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-transparent px-2 text-[13px] font-semibold whitespace-nowrap text-fg-2", level === l && "border-line-strong bg-card text-fg")}
            >
              <span className="font-mono text-[11px] text-fg-3">{i + 1}</span>
              {t(`node.${l}`)}
              {errCount(l) ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-status-failed px-1 text-[10px] text-white" aria-label={t("errorsAria", { n: errCount(l) })}>{errCount(l)}</span> : null}
            </button>
          ))}
        </div>

        <main ref={paneRef} className="grid min-h-0 content-start gap-3 overflow-y-auto px-3 pt-3 pb-6 tablet:px-5 tablet:pt-[18px] tablet:pb-7">
          <div className={cn("grid w-full min-w-0 gap-3", level === "ad" ? "max-w-[1060px]" : "max-w-[760px]")}>
            {first && !isEdit && !imported && !readOnly ? (
              <Alert variant="info">
                <Icon name="info" />
                <AlertBody>
                  <AlertTitle>{t("introTitle")}</AlertTitle>
                  <AlertDescription>{t("introBody", { account })}</AlertDescription>
                </AlertBody>
                {expired ? null : (
                  <AlertActions>
                    <button type="button" onClick={() => setImporting(true)} className="text-[13px] font-bold underline underline-offset-[3px]">{t("introImport")}</button>
                  </AlertActions>
                )}
              </Alert>
            ) : null}
            {imported ? (
              <div className="flex gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-fg-2" role="status">
                <span className="mt-1.5 size-2 flex-none rounded-full bg-fg-3" aria-hidden="true" />
                <span className="grid gap-0.5">
                  <b className="text-[13.5px] text-fg">{t("copiedTitle", { name: imported.importedFrom.name })}</b>
                  {imported.unsupported.length ? <span>{t("notCopied", { list: imported.unsupported.map((u) => `${fieldLabel(u.field)}${u.value ? ` “${u.value}”` : ""}`).join(" · ") })}</span> : null}
                  {imported.adjusted.length ? <span>{t("adjusted", { list: imported.adjusted.map((u) => `${fieldLabel(u.field)}${u.value ? `: ${u.value}` : ""}`).join(" · ") })}</span> : null}
                </span>
              </div>
            ) : null}
            {review && template && level === "campaign" && !onlyThis ? <p className="m-0 text-[13px] text-fg-2">{tr("lead", { name: template.name })}</p> : null}
            {review && !review.creativeIds.length ? (
              <Alert variant="destructive">
                <Icon name="alert" />
                <AlertBody><AlertTitle>{tr("noCreatives")}</AlertTitle></AlertBody>
              </Alert>
            ) : null}
            {onlyThis ? (
              <Alert variant="info">
                <Icon name="info" />
                <AlertBody>
                  <AlertTitle>{tr("onlyThisTitle")}</AlertTitle>
                  <AlertDescription>{tr("onlyThisBody")}</AlertDescription>
                </AlertBody>
                <AlertActions>
                  <Button size="sm" onClick={() => { setD(initial); setImported(null); setErrors({}); setTried(false) }}>{tr("undo")}</Button>
                </AlertActions>
              </Alert>
            ) : null}
            {expired && !readOnly ? (
              <Alert variant="warning">
                <Icon name="alert" />
                <AlertBody>
                  <AlertTitle>{t("expiredTitle")}</AlertTitle>
                  <AlertDescription>{t("expiredBody")}</AlertDescription>
                </AlertBody>
                <AlertActions>
                  <Link href="/settings/connections" className={buttonVariants({ size: "sm", variant: "meta" })}>{t("reconnect")}</Link>
                </AlertActions>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2.5">
              <LevelGlyph level={level} className="size-[18px] text-fg" />
              <h2 className="m-0 text-[15px] font-bold">{t(`node.${level}`)}</h2>
              {level === "ad" ? <span className="text-xs text-fg-3">{t("adApplies")}</span> : null}
            </div>
            <fieldset disabled={busy} className="m-0 grid min-w-0 gap-3 border-0 p-0">
              {level === "campaign" ? <CampaignLevel c={ctx} /> : level === "adset" ? <AdsetLevel c={ctx} /> : <AdLevel c={ctx} />}
            </fieldset>
          </div>
        </main>
      </div>

      {/* footer: (Archive) Back · status · Next · Save */}
      <footer className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line bg-card px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] tablet:px-4 tablet:py-3">
        <div className="flex items-center gap-1">
          {isEdit && origin === "settings" && !readOnly && !review ? (
            <Button variant="ghost" onClick={archive} disabled={busy} className="text-status-failed max-tablet:px-2.5">
              <Icon name="trash" />
              <span className="max-tablet:sr-only">{t("archive")}</span>
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => (idx > 0 ? go(LEVELS[idx - 1]) : askLeave(leaveHref))} disabled={busy}>{t("back")}</Button>
        </div>
        <div className="hidden min-w-0 flex-1 justify-center tablet:flex">
          <span className={cn("text-xs", errTotal ? "text-status-failed" : "text-fg-3")} role={errTotal ? "alert" : undefined}>
            {errTotal ? t("footErrors", { n: errTotal }) : review && template ? (saveToo ? tr("footSave", { name: template.name }) : tr("foot")) : readOnly ? t("footReadOnly") : d.isDefault ? t("footDefault", { account }) : t("footSaves", { account })}
          </span>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 tablet:flex-none">
          {next ? (
            <Button onClick={() => go(next)} disabled={busy}>
              <span>
                {t("next")}
                <span className="max-tablet:hidden">: {t(`node.${next}`)}</span>
              </span>
            </Button>
          ) : null}
          {review && template ? (
            <>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] max-tablet:basis-full max-tablet:order-first" title={tr("saveTooHint", { name: template.name })}>
                <Checkbox checked={saveToo} disabled={busy} onCheckedChange={(v) => setSaveToo(v === true)} />
                {tr("saveToo")}
              </label>
              <Button variant="brand" onClick={send} disabled={busy || expired || onlyThis || !review.creativeIds.length} aria-busy={sending}>
                {sending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : <Icon name="upload" />}
                {sending ? tr("sending") : tr("send", { n: review.creativeIds.length })}
              </Button>
            </>
          ) : readOnly ? null : (
            <Button variant="brand" onClick={save} disabled={busy || expired} aria-busy={busy}>
              {actions.create.isPending || actions.update.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
              {actions.create.isPending || actions.update.isPending ? t("saving") : t("save")}
            </Button>
          )}
        </div>
      </footer>

      <ImportPicker
        open={importing}
        onClose={() => setImporting(false)}
        onPicked={(p) => {
          setImporting(false)
          const name = p.result.template.importedFrom?.name && p.result.template.importedFrom.name !== p.id ? p.result.template.importedFrom.name : p.name
          const body: BodyLike = { ...p.result.template, name: t("copyOf", { name }) }
          setD(draftOf(body, currency, first))
          setImported({ importedFrom: { level: p.level, id: p.id, name }, unsupported: p.result.unsupported, adjusted: p.result.adjusted ?? [] })
          setErrors({})
          setTried(false)
          setApiMin(null)
          go("campaign")
        }}
      />

      <AlertDialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("discardBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => leaving && leave(leaving)}>{t("discard")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TreeNode({ level, depth, on, onClick, kind, title, sub, errors }: { level: Level; depth: number; on: boolean; onClick: () => void; kind: string; title: string; sub: string; errors: number }) {
  const t = useTranslations("metaTemplates.editor")
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? "step" : undefined}
      style={{ marginLeft: depth * 16 }}
      className={cn(
        "relative flex min-w-0 items-start gap-2.5 rounded-[10px] border border-transparent px-2.5 py-[9px] text-left hover:bg-card focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
        on && "border-line-strong bg-card"
      )}
    >
      <LevelGlyph level={level} className="mt-0.5 bg-card-2 text-fg-2" />
      <span className="grid min-w-0 flex-1 gap-px">
        <span className="font-mono text-[10px] tracking-[.08em] text-fg-3 uppercase">{kind}</span>
        <b className="truncate text-[13px]">{title}</b>
        <small className="truncate text-[11.5px] text-fg-3" title={sub}>{sub}</small>
      </span>
      {errors ? <span className="mt-px grid h-[18px] min-w-[18px] flex-none place-items-center rounded-full bg-status-failed px-[5px] text-[10.5px] font-bold text-white" aria-label={t("errorsAria", { n: errors })}>{errors}</span> : null}
    </button>
  )
}

/** A rule of 400 VALIDATION_ERROR → the line under the field (contract v2 §3). */
/** API field path (prefix) → editor label key, for the "Copied from…" strip */
const IMPORT_FIELD_LABEL: [string, string][] = [
  ["adset.schedule", "sec.schedule"], ["campaign.schedule", "sec.schedule"], ["adset_schedule", "sec.schedule"],
  ["campaign.lifetimeBudget", "lifetimeBudget"], ["adset.lifetimeBudget", "lifetimeBudget"], ["campaign.lifetimeBudgetMinor", "lifetimeBudget"],
  ["campaign.dailyBudgetMinor", "dailyBudget"], ["campaign.budgetType", "budgetType"], ["campaign.destination", "publishInto"],
  ["campaign.objective", "objective"], ["campaign.buyingType", "buyingType"], ["campaign.bidStrategy", "bid"], ["campaign.bidAmountMinor", "bid"],
  ["adset.optimizationGoal", "performanceGoal"], ["adset.destinationType", "conversionLocation"], ["adset.pixelId", "pixel"], ["adset.pixelEvent", "event"],
  ["adset.locales", "languages"], ["adset.customAudiences", "audiences"], ["adset.excludedCustomAudiences", "audiences"],
  ["adset.targeting.flexible_spec", "detailedSoon"], ["adset.targeting.exclusions", "detailedSoon"], ["adset.targeting.interests", "detailedSoon"], ["adset.targeting.behaviors", "detailedSoon"],
  ["adset.targeting.geo_locations", "locations"], ["adset.targeting.excluded_geo_locations", "locations"],
  ["campaign.specialAdCategories", "sec.special"], ["adset.placements", "sec.placements"], ["ad.callToAction", "cta"],
  ["ad.instagramAccount", "instagram"], ["ad.format", "format"], ["ad.creative.format", "format"],
  // anything else: the level it belongs to
  ["campaign", "node.campaign"], ["adset", "node.adset"], ["ad", "node.ad"],
]

/** the list a list rule (isAudienceList / isLocaleList) is about, to tell "too many" from "repeated" from "bad item" */
function listOf(d: Draft, field: string): { ids: string[]; max: number; kind: "audiences" | "locales" } | null {
  if (field.startsWith("adset.customAudiences")) return { ids: d.customAudiences.map((x) => x.id), max: 20, kind: "audiences" }
  if (field.startsWith("adset.excludedCustomAudiences")) return { ids: d.excludedCustomAudiences.map((x) => x.id), max: 20, kind: "audiences" }
  if (field.startsWith("adset.locales")) return { ids: d.locales.map((x) => String(x.key)), max: 50, kind: "locales" }
  return null
}

function ruleMessage(rule: string | undefined, tt: (k: string, v?: Record<string, string | number>) => string, list: ReturnType<typeof listOf> = null) {
  const map: Record<string, string> = {
    lifetimeCboNeedsNewCampaign: "err.lifetimeCbo", notForObjective: "err.pixelNotFor", inPast: "err.inPast", minDuration24h: "err.minDuration",
    requiredForLifetime: "err.endForLifetime", includedAndExcluded: "err.bothLists", notAvailable: "err.notAvailable", isLocalDateTime: "err.date",
    zeroForLifetime: "err.invalid",
  }
  // contract v2 §3: one rule covers > max, a repeated id and a bad item (id/name length): say which one it is
  if (rule === "isAudienceList" || rule === "isLocaleList") {
    const max = rule === "isAudienceList" ? 20 : 50
    if (!list) return tt("err.invalid")
    if (list.ids.length > max) return tt("err.tooMany", { max })
    if (new Set(list.ids).size < list.ids.length) return tt("err.duplicate")
    return tt(list.kind === "audiences" ? "err.audiencesBad" : "err.localesBad")
  }
  const k = rule ? map[rule] : undefined
  return tt(k ?? "err.invalid")
}
