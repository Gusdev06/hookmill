"use client"

import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type {
  MetaBidStrategy, MetaBudgetTooLowDetails, MetaCallToAction, MetaConnection, MetaObjective, MetaPixelEvent, MetaPublishTemplate, MetaSpecialAdCategory,
  MetaTemplateAdset, MetaTemplateBody, MetaTemplateImportedFrom,
} from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { minorFactor, useMinorMoney } from "@/hooks/use-meta-publish"
import { blankTemplate, planAdsets, useTemplateActions, useTemplateSummary } from "@/hooks/use-meta-templates"
import { cn } from "@/lib/utils"

/*
 * The template window (meta-templates-v1 §1, mockup design/mockup-meta-templates.html): rail Campaign / Ad set / Ad on the
 * left (tabs on top on the phone), the fields of the level on the right, the batch plan in the footer. Field errors use
 * the API paths ("campaign.dailyBudgetMinor"), so a 400 VALIDATION_ERROR / 422 lands on the same field it was typed in.
 */
type Level = "campaign" | "adset" | "ad"
const LEVELS: Level[] = ["campaign", "adset", "ad"]
const OBJECTIVES: MetaObjective[] = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_APP_PROMOTION"]
const NEEDS_PIXEL: MetaObjective[] = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION"]
const BIDS: MetaBidStrategy[] = ["LOWEST_COST", "COST_CAP", "BID_CAP"]
const SPECIAL: MetaSpecialAdCategory[] = ["HOUSING", "CREDIT", "EMPLOYMENT", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"]
const EVENTS: MetaPixelEvent[] = ["PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "SCHEDULE", "SUBSCRIBE"]
const CTAS: MetaCallToAction[] = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "BOOK_NOW", "CONTACT_US", "DOWNLOAD", "SUBSCRIBE", "APPLY_NOW", "GET_QUOTE", "ORDER_NOW"]
type Platform = "facebook" | "instagram" | "audience_network" | "messenger"
const PLATFORMS: Platform[] = ["facebook", "instagram", "audience_network", "messenger"]
/** `<platform>_<Graph position>` (the format the API validates) */
const POSITIONS: Record<Platform, string[]> = {
  facebook: ["facebook_feed", "facebook_story", "facebook_facebook_reels", "facebook_video_feeds", "facebook_marketplace", "facebook_instream_video"],
  instagram: ["instagram_stream", "instagram_story", "instagram_reels", "instagram_explore"],
  audience_network: ["audience_network_classic", "audience_network_rewarded_video"],
  messenger: ["messenger_messenger_home", "messenger_story"],
}
const VARS = "{offer} {code} {date} {n}"
const COUNTRY_RE = /^[A-Z]{2}$/
const parseCountries = (text: string) => text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)

interface Draft {
  name: string; isDefault: boolean
  destination: MetaTemplateBody["campaign"]["destination"]; objective: MetaObjective; budgetMode: "CBO" | "ABO"; budget: string
  bidStrategy: MetaBidStrategy; bidAmount: string; special: MetaSpecialAdCategory[]; campaignName: string
  pixelId: string | null; pixelEvent: MetaPixelEvent | null; countries: string; ageMin: string; ageMax: string
  genders: MetaTemplateAdset["genders"]; advantage: boolean; placements: "AUTO" | "MANUAL"; platforms: Platform[]; positions: string[]
  min: string; max: string; adsetName: string
  cta: MetaCallToAction; link: string; urlTags: string; primaryText: string; headline: string; description: string; adName: string
}

/** What the window edits: a saved template, a fresh one, or the result of an import (not saved yet). */
export type TemplateSource =
  | { kind: "edit"; template: MetaPublishTemplate }
  | { kind: "new" }
  | { kind: "import"; body: MetaTemplateBody; importedFrom: MetaTemplateImportedFrom; unsupported: { field: string; value: string }[] }

type BodyLike = Omit<MetaTemplateBody, "campaign"> & { campaign: Omit<MetaTemplateBody["campaign"], "dailyBudgetMinor"> & { dailyBudgetMinor: number | null } }

function draftOf(b: BodyLike, currency: string | null, isDefault: boolean): Draft {
  const f = minorFactor(currency)
  const c = b.campaign
  const a = b.adset
  const manual = a.placements !== "AUTO" ? a.placements : null
  return {
    name: b.name, isDefault,
    destination: c.destination, objective: c.objective, budgetMode: c.budgetMode, budget: c.dailyBudgetMinor ? String(c.dailyBudgetMinor / f) : "",
    bidStrategy: c.bidStrategy, bidAmount: c.bidAmountMinor ? String(c.bidAmountMinor / f) : "", special: c.specialAdCategories, campaignName: c.namePattern,
    pixelId: a.pixelId, pixelEvent: a.pixelEvent, countries: a.countries.join(", "), ageMin: String(a.ageMin), ageMax: String(a.ageMax),
    genders: a.genders, advantage: a.advantageAudience, placements: manual ? "MANUAL" : "AUTO",
    platforms: manual ? manual.platforms : ["facebook", "instagram"], positions: manual ? manual.positions : [],
    min: String(a.adsPerAdset.min), max: String(a.adsPerAdset.max), adsetName: a.namePattern,
    cta: b.ad.callToAction, link: b.ad.link, urlTags: b.ad.urlTags ?? "", primaryText: b.ad.primaryText ?? "", headline: b.ad.headline ?? "",
    description: b.ad.description ?? "", adName: b.ad.namePattern,
  }
}

type Errors = Record<string, string>
const LEVEL_OF = (field: string): Level => (field.startsWith("adset") ? "adset" : field.startsWith("ad.") ? "ad" : "campaign")
const int = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN)

function build(d: Draft, currency: string | null, minMinor: number | null, t: (k: string, v?: Record<string, string | number>) => string, money: (m: number) => string): { errors: Errors; body: MetaTemplateBody | null } {
  const e: Errors = {}
  const f = minorFactor(currency)
  if (!d.name.trim() || d.name.length > 60) e.name = t("err.name")
  const budget = Math.round(Number(d.budget.replace(",", ".")) * f)
  if (!d.budget.trim() || !Number.isFinite(budget) || budget <= 0) e["campaign.dailyBudgetMinor"] = t("err.budget")
  else if (minMinor !== null && budget < minMinor) e["campaign.dailyBudgetMinor"] = t("err.budgetBelow", { min: money(minMinor) })
  const cap = d.bidAmount.trim() ? Math.round(Number(d.bidAmount.replace(",", ".")) * f) : null
  if (d.bidStrategy !== "LOWEST_COST" && (!cap || !Number.isFinite(cap) || cap <= 0)) e["campaign.bidAmountMinor"] = t("err.cap")
  if (!d.campaignName.trim() || d.campaignName.length > 120) e["campaign.namePattern"] = t("err.pattern")
  if (NEEDS_PIXEL.includes(d.objective) && !d.pixelId) e["adset.pixelId"] = t("err.pixel")
  const countries = parseCountries(d.countries)
  if (!countries.length || countries.length > 10 || countries.some((c) => !COUNTRY_RE.test(c))) e["adset.countries"] = t("err.countries")
  const ageMin = int(d.ageMin)
  const ageMax = int(d.ageMax)
  if (!(ageMin >= 18 && ageMin <= 65 && ageMax >= 18 && ageMax <= 65 && ageMin <= ageMax)) e["adset.ageMax"] = t("err.ages")
  const min = int(d.min)
  const max = int(d.max)
  if (!(min >= 1 && max <= 50 && min <= max)) e["adset.adsPerAdset"] = t("err.perAdset")
  if (d.placements === "MANUAL" && !d.platforms.length) e["adset.placements"] = t("err.placements")
  if (!d.adsetName.trim() || d.adsetName.length > 120) e["adset.namePattern"] = t("err.pattern")
  const link = d.link.trim()
  if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(link) || link.length > 2048) e["ad.link"] = t("err.link")
  const urlTags = d.urlTags.trim().replace(/^\?/, "")
  if (urlTags.length > 1024) e["ad.urlTags"] = t("err.utm")
  if (d.primaryText.length > 2000) e["ad.primaryText"] = t("err.length", { max: 2000 })
  if (d.headline.length > 255) e["ad.headline"] = t("err.length", { max: 255 })
  if (d.description.length > 125) e["ad.description"] = t("err.length", { max: 125 })
  if (!d.adName.trim() || d.adName.length > 120) e["ad.namePattern"] = t("err.pattern")
  if (Object.keys(e).length) return { errors: e, body: null }
  const positions = d.positions.filter((p) => d.platforms.some((pl) => p.startsWith(`${pl}_`)))
  return {
    errors: e,
    body: {
      name: d.name.trim(), isDefault: d.isDefault,
      campaign: {
        destination: d.destination, objective: d.objective, budgetMode: d.budgetMode, dailyBudgetMinor: budget, bidStrategy: d.bidStrategy,
        bidAmountMinor: d.bidStrategy === "LOWEST_COST" ? null : cap, specialAdCategories: d.special, namePattern: d.campaignName.trim(),
      },
      adset: {
        pixelId: d.pixelId, pixelEvent: d.pixelId ? d.pixelEvent : null, countries, ageMin, ageMax, genders: d.genders, advantageAudience: d.advantage,
        placements: d.placements === "AUTO" ? "AUTO" : { platforms: d.platforms, positions }, adsPerAdset: { min, max }, namePattern: d.adsetName.trim(),
      },
      ad: {
        primaryText: d.primaryText.trim() || null, headline: d.headline.trim() || null, description: d.description.trim() || null,
        callToAction: d.cta, link, urlTags: urlTags || null, namePattern: d.adName.trim(),
      },
    },
  }
}

export function TemplateDialog({
  source, onClose, connection, minBudgetMinor = null, readOnly = false, sampleCount = 10, onImport, onSaved,
}: {
  source: TemplateSource | null
  onClose: () => void
  connection: MetaConnection | null | undefined
  /** the account minimum when the caller knows it (Send screen defaults); the API answers 422 with it otherwise */
  minBudgetMinor?: number | null
  readOnly?: boolean
  /** how many approved ads the footer plan shows (a batch passes its own count; Settings shows an example) */
  sampleCount?: number
  /** opens the import picker from the rail (Settings) */
  onImport?: () => void
  onSaved?: (t: MetaPublishTemplate) => void
}) {
  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        // QA layout 29/10 #12: focus the window itself on open, not the first tab (which showed a focus ring nobody asked for)
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement | null)?.focus()
        }}
        className="grid max-h-[calc(100dvh-2rem)] w-[min(980px,calc(100%-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-none max-tablet:h-[100dvh] max-tablet:max-h-[100dvh] max-tablet:w-full max-tablet:rounded-none max-tablet:border-0"
      >
        {source ? (
          <Editor
            key={source.kind === "edit" ? source.template.id : source.kind === "import" ? `imp-${source.importedFrom.id}` : "new"}
            source={source} onClose={onClose} connection={connection} minBudgetMinor={minBudgetMinor} readOnly={readOnly} sampleCount={sampleCount} onImport={onImport} onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Editor({
  source, onClose, connection, minBudgetMinor, readOnly, sampleCount, onImport, onSaved,
}: {
  source: TemplateSource
  onClose: () => void
  connection: MetaConnection | null | undefined
  minBudgetMinor: number | null
  readOnly: boolean
  sampleCount: number
  onImport?: () => void
  onSaved?: (t: MetaPublishTemplate) => void
}) {
  const t = useTranslations("metaTemplates")
  const tw = useTranslations("metaTemplates.window")
  const tf = useTranslations("publish.form")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const uid = useId()
  const currency = connection?.adAccount?.currency ?? null
  const money = useMinorMoney(currency)
  const summary = useTemplateSummary(currency)
  const actions = useTemplateActions()
  const [level, setLevel] = useState<Level>("campaign")
  const [d, setD] = useState<Draft>(() => {
    if (source.kind === "edit") return draftOf(source.template, currency, source.template.isDefault)
    if (source.kind === "import") return draftOf({ ...source.body, name: source.body.name || t("copyOf", { name: source.importedFrom.name }) }, currency, false)
    return draftOf(blankTemplate(connection), currency, false)
  })
  const [errors, setErrors] = useState<Errors>({})
  const [tried, setTried] = useState(false)
  const [apiMin, setApiMin] = useState<number | null>(null)
  const minMinor = apiMin ?? minBudgetMinor
  const tt = (k: string, v?: Record<string, string | number>) => tw(k as Parameters<typeof tw>[0], v as never)
  // 29/10 (Loom do Tordan): the target cost per result from the Brain (Workspace.targetCpa), shown under Campaign when set
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

  // pixels of the account: GET /meta/options is OWNER/ADMIN (live from Meta); others see the connection's pixel
  const options = useQuery({
    queryKey: ["meta", "options", connection?.adAccount?.id ?? null],
    queryFn: ({ signal }) => api.meta.options({ adAccountId: connection!.adAccount!.id }, { signal }),
    enabled: !readOnly && !!connection?.adAccount,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const pixels = [
    ...(options.data?.pixels ?? []).map((p) => ({ id: p.id, name: p.name })),
    ...(connection?.pixel ? [connection.pixel] : []),
    ...(d.pixelId ? [{ id: d.pixelId, name: d.pixelId }] : []),
  ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)

  const update = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch }
    setD(next)
    if (tried) setErrors(build(next, currency, minMinor, tt, money).errors)
  }

  const busy = actions.create.isPending || actions.update.isPending || actions.remove.isPending
  const save = () => {
    setTried(true)
    const r = build(d, currency, minMinor, tt, money)
    setErrors(r.errors)
    const first = Object.keys(r.errors)[0]
    if (!r.body) {
      if (first && first !== "name") setLevel(LEVEL_OF(first))
      return
    }
    const importedFrom = source.kind === "import" ? source.importedFrom : undefined
    const onError = (e: unknown) => {
      if (!isApiError(e)) return toast(errorMessage(e))
      if (e.code === "META_BUDGET_TOO_LOW") {
        const m = (e.details as Partial<MetaBudgetTooLowDetails> | undefined)?.minimumMinor ?? null
        setApiMin(m)
        setErrors({ "campaign.dailyBudgetMinor": tw("err.budgetBelow", { min: m === null ? "—" : money(m) }) })
        setLevel("campaign")
      } else if (e.code === "META_PIXEL_REQUIRED") {
        setErrors({ "adset.pixelId": tw("err.pixel") })
        setLevel("adset")
      } else if (e.code === "VALIDATION_ERROR") {
        const fields = ((e.details as { fields?: { field: string }[] } | undefined)?.fields ?? []).map((f) => f.field)
        const map: Errors = {}
        for (const f of fields) {
          // "adset.ageMin" and "adset.ageMax" share one row; "campaign.x.y" → "campaign.x"
          const key = f === "adset.ageMin" ? "adset.ageMax" : f.split(".").slice(0, 2).join(".")
          map[key] = tw("err.invalid")
        }
        setErrors(map)
        if (fields[0] && fields[0] !== "name") setLevel(LEVEL_OF(fields[0]))
        if (!fields.length) toast(errorMessage(e))
      } else toast(errorMessage(e))
    }
    const done = (tpl: MetaPublishTemplate) => {
      toast(tw("saved", { name: tpl.name }))
      onSaved?.(tpl)
      onClose()
    }
    if (source.kind === "edit") actions.update.mutate({ id: source.template.id, body: r.body }, { onSuccess: done, onError })
    else actions.create.mutate({ ...r.body, ...(importedFrom ? { importedFrom } : {}) }, { onSuccess: done, onError })
  }
  const archive = () => {
    if (source.kind !== "edit") return
    actions.remove.mutate(source.template.id, {
      onSuccess: () => {
        toast(tw("archived", { name: source.template.name }))
        onClose()
      },
      onError: (e) => toast(isApiError(e) && e.status === 409 ? tw("archiveBusy") : errorMessage(e)),
    })
  }

  // rail summaries from what's typed (the parsed values; "—" while invalid)
  const preview = build({ ...d, name: d.name || "x" }, currency, null, tt, money).body
  const f = minorFactor(currency)
  const typedBudget = Math.round(Number(d.budget.replace(",", ".")) * f)
  const levels = summary.levels({
    campaign: { ...(preview?.campaign ?? blankTemplate(connection).campaign), budgetMode: d.budgetMode, dailyBudgetMinor: Number.isFinite(typedBudget) && typedBudget > 0 ? typedBudget : 0 },
    adset: { ...blankTemplate(connection).adset, countries: parseCountries(d.countries), ageMin: int(d.ageMin) || 18, ageMax: int(d.ageMax) || 65, adsPerAdset: { min: int(d.min) || 0, max: int(d.max) || 0 } },
    ad: { ...blankTemplate(connection).ad, callToAction: d.cta, urlTags: d.urlTags.trim() || null },
  })
  const plan = planAdsets(sampleCount, { min: int(d.min) || 1, max: int(d.max) || 1 })
  const err = (k: string) => errors[k]
  const errCount = (l: Level) => Object.keys(errors).filter((k) => k !== "name" && LEVEL_OF(k) === l).length

  const unsupported = source.kind === "import" ? source.unsupported : []
  const LEVEL_ICON: Record<Level, React.ReactNode> = {
    campaign: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-[15px] flex-none"><rect x="2" y="2" width="12" height="12" rx="2" /></svg>,
    adset: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-[15px] flex-none"><rect x="2" y="2" width="12" height="12" rx="2" /><rect x="5" y="5" width="6" height="6" rx="1" /></svg>,
    ad: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-[15px] flex-none"><rect x="5" y="2" width="6" height="12" rx="1.5" /></svg>,
  }

  return (
    <>
      {/* header: editable name + default */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 tablet:px-[18px] tablet:py-3.5">
        <DialogDescription className="sr-only">{tw("description")}</DialogDescription>
        <div className="grid min-w-0 flex-[1_1_240px] gap-1">
          {/* QA layout 29/10 #12: the window's title is visible (it was screen-reader only, so the phone showed no title) */}
          <DialogTitle className="eyebrow px-1.5 text-[11px] leading-normal font-normal">{source.kind === "edit" ? tw("titleEdit") : tw("titleNew")}</DialogTitle>
          <input
            id={`${uid}-name`}
            value={d.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={tw("namePlaceholder")}
            aria-label={tw("name")}
            aria-invalid={!!err("name")}
            disabled={readOnly}
            maxLength={60}
            className="w-full max-w-[360px] min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-bold text-fg outline-none hover:border-line focus-visible:border-line-strong aria-[invalid=true]:border-status-failed-edge"
          />
          {err("name") ? <span className="px-1.5 text-xs text-status-failed" role="alert">{err("name")}</span> : null}
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={d.isDefault} disabled={readOnly || (source.kind === "edit" && source.template.isDefault)} onCheckedChange={(v) => update({ isDefault: v === true })} />
          {tw("default")}
        </label>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label={tc("close")} className="-mr-1">
          <Icon name="x" />
        </Button>
      </div>

      {/* body: rail + pane */}
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] tablet:grid-cols-[200px_minmax(0,1fr)] tablet:grid-rows-1">
        <nav role="tablist" aria-label={tw("levels")} className="no-scrollbar flex gap-0.5 overflow-x-auto border-b border-line bg-card-2 px-2 py-2 tablet:flex-col tablet:overflow-y-auto tablet:border-r tablet:border-b-0 tablet:py-3">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              id={`${uid}-tab-${l}`}
              aria-selected={level === l}
              aria-controls={`${uid}-pane`}
              onClick={() => setLevel(l)}
              className={cn(
                "grid flex-none gap-px rounded-lg px-2.5 py-2 text-left text-fg-2 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring",
                level === l && "bg-card text-fg shadow-[inset_3px_0_0_var(--color-meta)]"
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                {LEVEL_ICON[l]}
                {tw(`level.${l}`)}
                {errCount(l) ? <span className="grid size-4 place-items-center rounded-full bg-status-failed text-[10px] text-white">{errCount(l)}</span> : null}
              </span>
              <small className="max-w-[170px] truncate text-[11.5px] text-fg-3">{levels[l]}</small>
            </button>
          ))}
          {onImport && !readOnly && source.kind !== "edit" ? (
            <div className="mt-auto hidden gap-1.5 border-t border-line pt-2.5 tablet:grid">
              <p className="m-0 px-1 text-xs text-fg-3">{tw("importLead")}</p>
              <Button size="sm" onClick={onImport}>{tw("importButton")}</Button>
            </div>
          ) : null}
        </nav>

        <fieldset id={`${uid}-pane`} role="tabpanel" aria-labelledby={`${uid}-tab-${level}`} disabled={readOnly} className="m-0 grid min-w-0 content-start gap-4 overflow-y-auto border-0 p-4 tablet:p-[18px]">
          {unsupported.length && source.kind === "import" ? (
            <div className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[12.5px] text-fg-2">
              {t("notCopied", { name: source.importedFrom.name, list: unsupported.map((u) => `${u.field}${u.value ? ` "${u.value}"` : ""}`).join(", ") })}
            </div>
          ) : null}

          {level === "campaign" ? (
            <>
              <Sec title={tw("sec.destination")}>
                <ToggleGroup type="single" value={d.destination} onValueChange={(v) => v && update({ destination: v as Draft["destination"] })} aria-label={tw("sec.destination")} className="flex-wrap">
                  <ToggleGroupItem value="REUSE_CAMPAIGN">{tw("reuse")}</ToggleGroupItem>
                  <ToggleGroupItem value="NEW_CAMPAIGN">{tw("newEach")}</ToggleGroupItem>
                </ToggleGroup>
                <F id={`${uid}-cname`} label={tw("campaignName")} error={err("campaign.namePattern")} hint={d.destination === "REUSE_CAMPAIGN" ? tw("reuseHint") : tw("vars", { vars: VARS })}>
                  <Input id={`${uid}-cname`} value={d.campaignName} onChange={(e) => update({ campaignName: e.target.value })} aria-invalid={!!err("campaign.namePattern")} />
                </F>
              </Sec>
              <Sec title={tw("sec.campaign")}>
                <Two>
                  <F id={`${uid}-obj`} label={tf("objectiveLabel")}>
                    <Select value={d.objective} onValueChange={(v) => update({ objective: v as MetaObjective })} disabled={readOnly}>
                      <SelectTrigger id={`${uid}-obj`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{OBJECTIVES.map((o) => <SelectItem key={o} value={o}>{tf(`objective.${o}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  </F>
                  <F id={`${uid}-bid`} label={tw("bid")}>
                    <Select value={d.bidStrategy} onValueChange={(v) => update({ bidStrategy: v as MetaBidStrategy })} disabled={readOnly}>
                      <SelectTrigger id={`${uid}-bid`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{BIDS.map((b) => <SelectItem key={b} value={b}>{tw(`bidLabel.${b}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  </F>
                </Two>
                <div className="grid gap-1.5">
                  <Label>{tw("budget")}</Label>
                  <ToggleGroup type="single" value={d.budgetMode} onValueChange={(v) => v && update({ budgetMode: v as Draft["budgetMode"] })} aria-label={tw("budget")} className="flex-wrap">
                    <ToggleGroupItem value="CBO">{tw("cbo")}</ToggleGroupItem>
                    <ToggleGroupItem value="ABO">{tw("abo")}</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <Two>
                  <F id={`${uid}-budget`} label={d.budgetMode === "CBO" ? tw("dailyBudget") : tw("dailyBudgetAdset")} error={err("campaign.dailyBudgetMinor")} hint={minMinor !== null ? tw("budgetMin", { min: money(minMinor) }) : tw("budgetRequired")}>
                    <Money currency={currency}>
                      <Input id={`${uid}-budget`} inputMode="decimal" value={d.budget} placeholder="0.00" onChange={(e) => update({ budget: e.target.value })} aria-invalid={!!err("campaign.dailyBudgetMinor")} className="pl-14 font-mono" />
                    </Money>
                    {apiMin !== null && err("campaign.dailyBudgetMinor") && !readOnly ? (
                      <Button size="sm" className="justify-self-start" onClick={() => update({ budget: String(apiMin / f) })}>{tf("budgetMin", { min: money(apiMin) })}</Button>
                    ) : null}
                  </F>
                  {d.bidStrategy !== "LOWEST_COST" ? (
                    <F id={`${uid}-cap`} label={d.bidStrategy === "COST_CAP" ? tw("costCap") : tw("bidCap")} error={err("campaign.bidAmountMinor")}>
                      <Money currency={currency}>
                        <Input id={`${uid}-cap`} inputMode="decimal" value={d.bidAmount} placeholder="0.00" onChange={(e) => update({ bidAmount: e.target.value })} aria-invalid={!!err("campaign.bidAmountMinor")} className="pl-14 font-mono" />
                      </Money>
                    </F>
                  ) : null}
                </Two>
                <details className="group grid gap-2">
                  <summary className="cursor-pointer list-none text-[13px] font-semibold text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
                    <Icon name="chev" className="mr-1 inline transition-transform group-open:rotate-90" />
                    {tf("special")} {d.special.length ? <span className="font-mono text-fg-3">({d.special.length})</span> : null}
                  </summary>
                  <div className="grid gap-2 pt-2 pl-5">
                    <span className="text-xs text-fg-3">{tf("specialHint")}</span>
                    {SPECIAL.map((s) => (
                      <label key={s} className="flex items-center gap-2 text-[13px]">
                        <Checkbox checked={d.special.includes(s)} onCheckedChange={(c) => update({ special: c ? [...d.special, s] : d.special.filter((x) => x !== s) })} />
                        {tf(`specialCat.${s}`)}
                      </label>
                    ))}
                  </div>
                </details>
                {cpa ? (
                  <p className="m-0 rounded-[10px] border border-brand-edge bg-brand-soft px-3 py-2.5 text-[13px] text-brand-ink">
                    {tw.rich("targetCpa", { range: cpa.min === cpa.max ? cpaMoney(cpa.min) : `${cpaMoney(cpa.min)}–${cpaMoney(cpa.max)}`, b: (c) => <b>{c}</b> })}
                  </p>
                ) : null}
              </Sec>
            </>
          ) : null}

          {level === "adset" ? (
            <>
              <Sec title={tw("sec.perAdset")}>
                <Two>
                  <F id={`${uid}-min`} label={tw("atLeast")} error={err("adset.adsPerAdset")}>
                    <Input id={`${uid}-min`} type="number" min={1} max={50} value={d.min} onChange={(e) => update({ min: e.target.value })} aria-invalid={!!err("adset.adsPerAdset")} className="font-mono" />
                  </F>
                  <F id={`${uid}-max`} label={tw("atMost")}>
                    <Input id={`${uid}-max`} type="number" min={1} max={50} value={d.max} onChange={(e) => update({ max: e.target.value })} aria-invalid={!!err("adset.adsPerAdset")} className="font-mono" />
                  </F>
                </Two>
                <span className="text-xs text-fg-3">{tw("perAdsetHint")}</span>
              </Sec>
              <Sec title={tw("sec.conversion")}>
                <Two>
                  <F id={`${uid}-pixel`} label={tf("pixel")} error={err("adset.pixelId")} hint={options.isFetching ? tc("loading") : undefined}>
                    <Select value={d.pixelId ?? "none"} onValueChange={(v) => update(v === "none" ? { pixelId: null, pixelEvent: null } : { pixelId: v, pixelEvent: d.pixelEvent ?? "PURCHASE" })} disabled={readOnly}>
                      <SelectTrigger id={`${uid}-pixel`} className="w-full" aria-invalid={!!err("adset.pixelId")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{tw("noPixel")}</SelectItem>
                        {pixels.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {err("adset.pixelId") && !readOnly ? (
                      <Button size="sm" className="justify-self-start" onClick={() => update({ objective: "OUTCOME_TRAFFIC" })}>{tf("switchTraffic")}</Button>
                    ) : null}
                  </F>
                  <F id={`${uid}-event`} label={tw("event")}>
                    <Select value={d.pixelId ? (d.pixelEvent ?? "PURCHASE") : "clicks"} onValueChange={(v) => update({ pixelEvent: v as MetaPixelEvent })} disabled={readOnly || !d.pixelId}>
                      <SelectTrigger id={`${uid}-event`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {d.pixelId ? EVENTS.map((x) => <SelectItem key={x} value={x}>{t(`event.${x}`)}</SelectItem>) : <SelectItem value="clicks">{t("summary.clicks")}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </F>
                </Two>
              </Sec>
              <Sec title={tw("sec.audience")}>
                <Two>
                  <F id={`${uid}-geo`} label={tw("locations")} error={err("adset.countries")} hint={tf("countriesHint")}>
                    <Input id={`${uid}-geo`} value={d.countries} onChange={(e) => update({ countries: e.target.value })} placeholder="US, CA" autoCapitalize="characters" aria-invalid={!!err("adset.countries")} className="font-mono uppercase" />
                  </F>
                  <F id={`${uid}-agemin`} label={tf("ages")} error={err("adset.ageMax")} hint={tf("agesHint")}>
                    <div className="flex items-center gap-2">
                      <Input id={`${uid}-agemin`} inputMode="numeric" value={d.ageMin} onChange={(e) => update({ ageMin: e.target.value })} aria-label={tf("ageMin")} aria-invalid={!!err("adset.ageMax")} className="w-20 font-mono" />
                      <span className="text-[13px] text-fg-3">{tf("ageTo")}</span>
                      <Input inputMode="numeric" value={d.ageMax} onChange={(e) => update({ ageMax: e.target.value })} aria-label={tf("ageMax")} aria-invalid={!!err("adset.ageMax")} className="w-20 font-mono" />
                    </div>
                  </F>
                </Two>
                <div className="grid gap-1.5">
                  <Label>{tw("gender")}</Label>
                  <ToggleGroup type="single" value={d.genders} onValueChange={(v) => v && update({ genders: v as Draft["genders"] })} aria-label={tw("gender")} className="flex-wrap">
                    {(["ALL", "MALE", "FEMALE"] as const).map((g) => <ToggleGroupItem key={g} value={g}>{tw(`genders.${g}`)}</ToggleGroupItem>)}
                  </ToggleGroup>
                </div>
                <label className="flex items-center gap-2 text-[13px]">
                  <Switch checked={d.advantage} onCheckedChange={(v) => update({ advantage: v })} />
                  {tw("advantage")}
                </label>
                <div className="grid gap-1.5">
                  <Label>{tw("placements")}</Label>
                  <ToggleGroup type="single" value={d.placements} onValueChange={(v) => v && update({ placements: v as Draft["placements"] })} aria-label={tw("placements")} className="flex-wrap">
                    <ToggleGroupItem value="AUTO">{tw("autoPlacements")}</ToggleGroupItem>
                    <ToggleGroupItem value="MANUAL">{tw("manual")}</ToggleGroupItem>
                  </ToggleGroup>
                  {err("adset.placements") ? <span className="text-xs text-status-failed" role="alert">{err("adset.placements")}</span> : null}
                </div>
                {d.placements === "MANUAL" ? (
                  <div className="grid gap-3 rounded-lg border border-line p-3">
                    {PLATFORMS.map((pl) => {
                      const on = d.platforms.includes(pl)
                      return (
                        <div key={pl} className="grid gap-1.5">
                          <label className="flex items-center gap-2 text-[13px] font-semibold">
                            <Checkbox checked={on} onCheckedChange={(c) => update({ platforms: c ? [...d.platforms, pl] : d.platforms.filter((x) => x !== pl), positions: c ? d.positions : d.positions.filter((p) => !p.startsWith(`${pl}_`)) })} />
                            {tw(`platform.${pl}`)}
                          </label>
                          {on ? (
                            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-6">
                              {POSITIONS[pl].map((pos) => (
                                <label key={pos} className="flex items-center gap-1.5 text-[13px] text-fg-2">
                                  <Checkbox checked={d.positions.includes(pos)} onCheckedChange={(c) => update({ positions: c ? [...d.positions, pos] : d.positions.filter((x) => x !== pos) })} />
                                  {tt(`position.${pos}`)}
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                    <span className="text-xs text-fg-3">{tw("positionsHint")}</span>
                  </div>
                ) : null}
                <F id={`${uid}-aname`} label={tw("adsetName")} error={err("adset.namePattern")} hint={tw("vars", { vars: VARS })}>
                  <Input id={`${uid}-aname`} value={d.adsetName} onChange={(e) => update({ adsetName: e.target.value })} aria-invalid={!!err("adset.namePattern")} className="font-mono" />
                </F>
              </Sec>
            </>
          ) : null}

          {level === "ad" ? (
            <Sec title={tw("sec.ad")}>
              <F id={`${uid}-dname`} label={tw("adName")} error={err("ad.namePattern")} hint={tw("adNameHint", { vars: VARS, example: resolveSample(d.adName) })}>
                <Input id={`${uid}-dname`} value={d.adName} onChange={(e) => update({ adName: e.target.value })} aria-invalid={!!err("ad.namePattern")} className="font-mono" />
              </F>
              <Two>
                <F id={`${uid}-cta`} label={tf("cta")}>
                  <Select value={d.cta} onValueChange={(v) => update({ cta: v as MetaCallToAction })} disabled={readOnly}>
                    <SelectTrigger id={`${uid}-cta`} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{CTAS.map((c) => <SelectItem key={c} value={c}>{tf(`ctaLabel.${c}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </F>
                <F id={`${uid}-link`} label={tw("link")} error={err("ad.link")}>
                  <Input id={`${uid}-link`} type="url" inputMode="url" value={d.link} placeholder="https://" onChange={(e) => update({ link: e.target.value })} aria-invalid={!!err("ad.link")} className="font-mono" />
                </F>
              </Two>
              <F id={`${uid}-utm`} label={tw("utm")} error={err("ad.urlTags")} hint={tw("utmHint")}>
                <Input id={`${uid}-utm`} value={d.urlTags} placeholder="utm_source=meta&utm_medium=paid" onChange={(e) => update({ urlTags: e.target.value })} aria-invalid={!!err("ad.urlTags")} className="font-mono" />
              </F>
              <F id={`${uid}-text`} label={tf("primaryText")} error={err("ad.primaryText")} hint={tw("emptyWrites")}>
                <Textarea id={`${uid}-text`} rows={3} value={d.primaryText} placeholder={tw("emptyWritesPlaceholder")} onChange={(e) => update({ primaryText: e.target.value })} aria-invalid={!!err("ad.primaryText")} />
              </F>
              <Two>
                <F id={`${uid}-head`} label={tf("headline")} error={err("ad.headline")} optional>
                  <Input id={`${uid}-head`} value={d.headline} placeholder={tw("emptyInherits")} onChange={(e) => update({ headline: e.target.value })} aria-invalid={!!err("ad.headline")} />
                </F>
                <F id={`${uid}-desc`} label={tf("description")} error={err("ad.description")} optional>
                  <Input id={`${uid}-desc`} value={d.description} placeholder={tw("emptyInherits")} onChange={(e) => update({ description: e.target.value })} aria-invalid={!!err("ad.description")} />
                </F>
              </Two>
            </Sec>
          ) : null}
        </fieldset>
      </div>

      {/* footer: batch plan + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line px-4 py-3 tablet:px-[18px]">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2" aria-label={tw("planAria")}>
          <span>{tw("plan", { n: sampleCount })}</span>
          {plan.map((p, i) => (
            <span key={i} className={cn("rounded-md border px-[7px] py-[3px] font-mono text-[11px] num", p.short ? "border-status-waiting bg-status-waiting-bg text-status-waiting" : "border-line bg-card-2")}>
              {p.short ? tw("adsetShort", { i: i + 1, n: p.size, min: int(d.min) || 1 }) : tw("adset", { i: i + 1, n: p.size })}
            </span>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {source.kind === "edit" && !readOnly ? (
            <Button variant="ghost" size="sm" onClick={archive} disabled={busy} className="text-status-failed">
              <Icon name="trash" />
              {tw("archive")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{readOnly ? tc("close") : tc("cancel")}</Button>
          {readOnly ? null : (
            <Button variant="brand" onClick={save} disabled={busy} aria-busy={busy}>
              {actions.create.isPending || actions.update.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : null}
              {tw("save")}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

const resolveSample = (pattern: string) =>
  pattern.replace(/\{offer\}/g, "Sleepwell").replace(/\{code\}/g, "HEADLINE-02").replace(/\{date\}/g, new Date().toISOString().slice(0, 10)).replace(/\{n\}/g, "1").replace(/\s+/g, " ").trim()

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="m-0 font-mono text-[13px] font-medium tracking-[.06em] text-fg-3 uppercase">{title}</h3>
      {children}
    </section>
  )
}
function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">{children}</div>
}
function Money({ currency, children }: { currency: string | null; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center font-mono text-[13px] text-fg-3">{currency ?? "USD"}</span>
      {children}
    </div>
  )
}
function F({ id, label, hint, error, optional, children }: { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: string; optional?: boolean; children: React.ReactNode }) {
  const tf = useTranslations("publish.form")
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>
        {label} {optional ? <span className="font-normal text-fg-3">{tf("optional")}</span> : null}
      </Label>
      {children}
      {error ? <span className="text-xs text-status-failed" role="alert">{error}</span> : hint ? <span className="text-xs text-fg-3">{hint}</span> : null}
    </div>
  )
}
