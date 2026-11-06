"use client"

import { useTranslations } from "next-intl"
import type { MetaConnection, MetaObjective, MetaPixelEvent, MetaTemplateOptimizationGoal, MetaBidStrategy, MetaCallToAction } from "@/lib/api/types"
import { useCustomAudiences, useInstagramAccounts, useMetaLocales } from "@/lib/api/meta-template-lists"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RadioGroup } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { minorFactor } from "@/hooks/use-meta-publish"
import { cn } from "@/lib/utils"
import {
  BIDS, CTAS, EVENTS, GOALS, OBJECTIVES, PLATFORMS, POSITIONS, SPECIAL, hostOf, int, isGoalObjective, lockedNewCampaign, nowLocal, resolveSample,
  scheduleDays, withObjective, type Draft, type Errors,
} from "./editor-model"
import { AdPreview, F, HookMillTag, INVALID, Money, MultiPick, RadioCard, Ro, Sec, Soon, SoonRow, Tog, Two, VarsHint, aria } from "./editor-parts"
import type { FileRef } from "@/lib/api/types"

/** What every level needs from the editor. */
export interface LevelCtx {
  d: Draft
  update: (p: Partial<Draft>) => void
  errors: Errors
  uid: string
  readOnly: boolean
  /** F4: the Meta connection is expired → the live lists (IG, audiences, languages) aren't read; the saved values show */
  expired: boolean
  currency: string | null
  money: (m: number) => string
  /** the account's daily minimum: from the 422, or GET /meta/connection (`minDailyBudgetMinor`) */
  minDaily: number | null
  conn: MetaConnection | null
  pixels: { id: string; name: string }[]
  pixelsLoading: boolean
  cpaLine: React.ReactNode
  sampleCount: number
  plan: { size: number; short: boolean }[]
  /** an approved video for the ad preview, when the editor was opened from one */
  sample: { thumb: FileRef | null; code: string | null; offer: string | null }
}

/* ───────────────────────── Campaign ───────────────────────── */
export function CampaignLevel({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  const tf = useTranslations("publish.form")
  const { d, update, errors, uid, readOnly } = c
  const locked = lockedNewCampaign(d)
  return (
    <>
      <Sec title={t("sec.campaignName")}>
        <F id={`${uid}-cname`} label={t("campaignName")} error={errors["campaign.namePattern"]} hint={<VarsHint sample={resolveSample(d.campaignName, undefined, c.sample.offer ?? undefined)} />}>
          <Input {...aria(`${uid}-cname`, errors["campaign.namePattern"])} value={d.campaignName} maxLength={120} onChange={(e) => update({ campaignName: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
        </F>
        <F id={`${uid}-dest`} label={t("publishInto")} tag={<HookMillTag />} error={errors["campaign.destination"]} hint={locked ? t("lockedNew") : undefined}>
          <RadioGroup id={`${uid}-dest`} value={locked ? "NEW_CAMPAIGN" : d.destination} onValueChange={(v) => update({ destination: v as Draft["destination"] })} className="gap-1.5" disabled={readOnly} aria-label={t("publishInto")}>
            <RadioCard value="REUSE_CAMPAIGN" title={t("reuse")} body={t("reuseBody")} on={!locked && d.destination === "REUSE_CAMPAIGN"} disabled={locked || readOnly} />
            <RadioCard value="NEW_CAMPAIGN" title={t("newEach")} body={t("newEachBody")} on={locked || d.destination === "NEW_CAMPAIGN"} disabled={readOnly} />
          </RadioGroup>
        </F>
      </Sec>

      <Sec title={t("sec.special")} lead={t("specialLead")}>
        <details className="group" open={d.special.length > 0 || undefined}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chev" className="transition-transform group-open:rotate-90" />
            {t("specialSummary")} {d.special.length ? <span className="font-mono text-fg-3">({d.special.length})</span> : null}
          </summary>
          <div className="grid gap-1.5 pt-2.5">
            {SPECIAL.map((s) => (
              <label key={s} className="flex min-h-9 items-center gap-2 text-[13px]">
                <Checkbox checked={d.special.includes(s)} disabled={readOnly} onCheckedChange={(v) => update({ special: v ? [...d.special, s] : d.special.filter((x) => x !== s) })} />
                {tf(`specialCat.${s}`)}
              </label>
            ))}
          </div>
        </details>
      </Sec>

      <Sec title={t("sec.details")}>
        <Ro label={t("buyingType")} note={<Soon>{t("reservationSoon")}</Soon>}>{t("auction")}</Ro>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-bold" id={`${uid}-obj-l`}>{t("objective")}</span>
          <RadioGroup
            value={d.objective}
            onValueChange={(v) => update(withObjective(d, v as MetaObjective, c.conn?.pixel ?? null))}
            className="grid grid-cols-[minmax(0,1fr)] gap-1.5 tablet:grid-cols-2"
            disabled={readOnly}
            aria-labelledby={`${uid}-obj-l`}
          >
            {OBJECTIVES.map((o) => (
              <RadioCard key={o} value={o} title={tf(`objective.${o}`)} body={t(`objDesc.${o}`)} on={d.objective === o} disabled={readOnly} />
            ))}
          </RadioGroup>
        </div>
      </Sec>

      <Sec title={t("sec.budget")}>
        <Tog title={t("cbo")} body={d.budgetMode === "CBO" ? t("cboOn") : t("cboOff")} checked={d.budgetMode === "CBO"} onChange={(v) => update({ budgetMode: v ? "CBO" : "ABO" })} disabled={readOnly} />
        {d.budgetMode === "CBO" ? <BudgetBlock c={c} where="campaign" /> : null}
        {c.cpaLine}
      </Sec>

      <Sec title={t("sec.ab")} off>
        <SoonRow name={t("abSoon")} note={t("abNote")} />
      </Sec>
    </>
  )
}

/** Budget type + amount + bid strategy + cap: on the Campaign with CBO, on the Ad set with ABO (spec §2.5). */
function BudgetBlock({ c, where }: { c: LevelCtx; where: "campaign" | "adset" }) {
  const t = useTranslations("metaTemplates.editor")
  const { d, update, errors, uid, readOnly, money, minDaily } = c
  const f = minorFactor(c.currency)
  const lifetime = d.budgetType === "LIFETIME"
  const days = scheduleDays(d, c.conn?.adAccount?.timezoneName)
  const key = lifetime ? "campaign.lifetimeBudgetMinor" : "campaign.dailyBudgetMinor"
  const minTotal = lifetime && minDaily !== null && days ? minDaily * days : null
  const fixMin = lifetime ? minTotal : minDaily
  const fix =
    fixMin !== null && !readOnly ? (
      <Button size="sm" onClick={() => update(lifetime ? { lifetimeBudget: String(fixMin / f) } : { budget: String(fixMin / f) })}>{t("useMin", { min: money(fixMin) })}</Button>
    ) : null
  const hint = lifetime
    ? minTotal !== null
      ? t("lifetimeMinHint", { min: money(minTotal), days: days!, daily: money(minDaily!) })
      : t("lifetimeHint")
    : minDaily !== null
      ? t("minHint", { min: money(minDaily) })
      : t("minUnknown")
  const bidId = `${uid}-bid-${where}`
  return (
    <>
      <Two>
        <F id={`${uid}-btype-${where}`} label={t("budgetType")}>
          <Select value={d.budgetType} onValueChange={(v) => update({ budgetType: v as Draft["budgetType"] })} disabled={readOnly}>
            <SelectTrigger id={`${uid}-btype-${where}`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DAILY">{t("daily")}</SelectItem>
              <SelectItem value="LIFETIME">{t("lifetime")}</SelectItem>
            </SelectContent>
          </Select>
        </F>
        <F
          id={`${uid}-budget-${where}`}
          label={lifetime ? (where === "adset" ? t("lifetimePerAdset") : t("lifetimeBudget")) : where === "adset" ? t("dailyPerAdset") : t("dailyBudget")}
          error={errors[key]}
          hint={hint}
          fix={fix}
        >
          <Money currency={c.currency}>
            <Input
              {...aria(`${uid}-budget-${where}`, errors[key])}
              inputMode="decimal"
              placeholder="0.00"
              value={lifetime ? d.lifetimeBudget : d.budget}
              onChange={(e) => update(lifetime ? { lifetimeBudget: e.target.value } : { budget: e.target.value })}
              className={cn("pl-12 font-mono", INVALID)}
            />
          </Money>
        </F>
      </Two>
      <Two>
        <F id={bidId} label={where === "adset" ? t("bid") : t("bidCampaign")} hint={t(`bidHint.${d.bidStrategy}`)}>
          <Select value={d.bidStrategy} onValueChange={(v) => update({ bidStrategy: v as MetaBidStrategy })} disabled={readOnly}>
            <SelectTrigger id={bidId} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{BIDS.map((b) => <SelectItem key={b} value={b}>{t(`bidLabel.${b}`)}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        {d.bidStrategy !== "LOWEST_COST" ? (
          <F id={`${uid}-cap-${where}`} label={d.bidStrategy === "COST_CAP" ? t("bidLabel.COST_CAP") : t("bidLabel.BID_CAP")} error={errors["campaign.bidAmountMinor"]}>
            <Money currency={c.currency}>
              <Input {...aria(`${uid}-cap-${where}`, errors["campaign.bidAmountMinor"])} inputMode="decimal" placeholder="0.00" value={d.bidAmount} onChange={(e) => update({ bidAmount: e.target.value })} className={cn("pl-12 font-mono", INVALID)} />
            </Money>
          </F>
        ) : (
          <div className="max-tablet:hidden" />
        )}
      </Two>
    </>
  )
}

/* ───────────────────────── Ad set ───────────────────────── */
export function AdsetLevel({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  const tw = useTranslations("metaTemplates.window")
  const ev = useTranslations("metaTemplates.event")
  const { d, update, errors, uid, readOnly } = c
  const goalObj = isGoalObjective(d.objective)
  const tz = c.conn?.adAccount?.timezoneName ?? null
  return (
    <>
      <Sec title={t("sec.adsetName")}>
        <F id={`${uid}-aname`} label={t("adsetName")} error={errors["adset.namePattern"]} hint={<VarsHint sample={resolveSample(d.adsetName, undefined, c.sample.offer ?? undefined)} />}>
          <Input {...aria(`${uid}-aname`, errors["adset.namePattern"])} value={d.adsetName} maxLength={120} onChange={(e) => update({ adsetName: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
        </F>
      </Sec>

      {goalObj ? (
        // v2 §2.1: Awareness / Engagement pick the goal; no pixel
        <Sec title={t("sec.performance")}>
          <F id={`${uid}-goal`} label={t("performanceGoal")} error={errors["adset.optimizationGoal"] ?? errors["adset.pixelId"]} hint={t("goalHint")}>
            <Select value={d.optimizationGoal ?? GOALS[d.objective]![0]} onValueChange={(v) => update({ optimizationGoal: v as MetaTemplateOptimizationGoal })} disabled={readOnly}>
              <SelectTrigger {...aria(`${uid}-goal`, errors["adset.optimizationGoal"])} className={cn("w-full", INVALID)}><SelectValue /></SelectTrigger>
              <SelectContent>{GOALS[d.objective]!.map((g) => <SelectItem key={g} value={g}>{t(`goal.${g}`)}</SelectItem>)}</SelectContent>
            </Select>
          </F>
        </Sec>
      ) : (
        <Sec title={t("sec.conversion")}>
          <Ro label={t("conversionLocation")} note={<Soon>{t("appSoon")}</Soon>}>{t("website")}</Ro>
          <Ro label={t("performanceGoal")} note={t("goalByPixel")}>{d.pixelId ? t("goalConv") : t("goalClicks")}</Ro>
          <Two>
            <F
              id={`${uid}-pixel`}
              label={t("pixel")}
              error={errors["adset.pixelId"]}
              hint={c.pixelsLoading ? t("loadingPixels") : undefined}
              fix={readOnly ? null : <Button size="sm" onClick={() => update(withObjective(d, "OUTCOME_TRAFFIC", null))}>{t("switchTraffic")}</Button>}
            >
              <Select value={d.pixelId ?? "none"} onValueChange={(v) => update(v === "none" ? { pixelId: null, pixelEvent: null } : { pixelId: v, pixelEvent: d.pixelEvent ?? "PURCHASE" })} disabled={readOnly}>
                <SelectTrigger {...aria(`${uid}-pixel`, errors["adset.pixelId"])} className={cn("w-full", INVALID)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noPixel")}</SelectItem>
                  {c.pixels.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F id={`${uid}-event`} label={t("event")}>
              <Select value={d.pixelId ? (d.pixelEvent ?? "PURCHASE") : "clicks"} onValueChange={(v) => update({ pixelEvent: v as MetaPixelEvent })} disabled={readOnly || !d.pixelId}>
                <SelectTrigger id={`${uid}-event`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {d.pixelId ? EVENTS.map((x) => <SelectItem key={x} value={x}>{ev(x)}</SelectItem>) : <SelectItem value="clicks">{t("linkClicks")}</SelectItem>}
                </SelectContent>
              </Select>
            </F>
          </Two>
        </Sec>
      )}

      {d.budgetMode === "ABO" ? (
        <Sec title={t("sec.budgetSchedule")}>
          <BudgetBlock c={c} where="adset" />
        </Sec>
      ) : null}

      <Sec title={t("sec.schedule")} lead={t("tzNote", { tz: tz ?? "UTC" })}>
        <Two>
          <F id={`${uid}-start`} label={t("start")} error={errors["adset.schedule.start"]}>
            <div className="grid gap-2">
              <ToggleGroup type="single" value={d.startMode} onValueChange={(v) => v && update({ startMode: v as Draft["startMode"], ...(v === "AT" && !d.startAt ? { startAt: nowLocal(tz, 60).slice(0, 14) + "00" } : {}) })} disabled={readOnly} aria-label={t("start")} className="justify-self-start">
                <ToggleGroupItem value="PUBLISH">{t("startPublish")}</ToggleGroupItem>
                <ToggleGroupItem value="AT">{t("startAt")}</ToggleGroupItem>
              </ToggleGroup>
              {d.startMode === "AT" ? (
                <Input {...aria(`${uid}-start`, errors["adset.schedule.start"])} type="datetime-local" value={d.startAt} onChange={(e) => update({ startAt: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
              ) : null}
            </div>
          </F>
          <F id={`${uid}-end`} label={t("end")} error={errors["adset.schedule.end"]} hint={d.endMode === "AFTER_DAYS" && int(d.endDays) >= 1 ? t("afterHint", { n: int(d.endDays) }) : undefined}>
            <div className="grid gap-2">
              <ToggleGroup type="single" value={d.endMode} onValueChange={(v) => v && update({ endMode: v as Draft["endMode"], ...(v === "AT" && !d.endAt ? { endAt: nowLocal(tz, 8 * 24 * 60).slice(0, 14) + "00" } : {}) })} disabled={readOnly} aria-label={t("end")} className="justify-self-start">
                <ToggleGroupItem value="NONE">{t("endNone")}</ToggleGroupItem>
                <ToggleGroupItem value="AFTER_DAYS">{t("endAfter")}</ToggleGroupItem>
                <ToggleGroupItem value="AT">{t("endAt")}</ToggleGroupItem>
              </ToggleGroup>
              {d.endMode === "AFTER_DAYS" ? (
                <div className="flex items-center gap-2">
                  <Input {...aria(`${uid}-end`, errors["adset.schedule.end"])} inputMode="numeric" value={d.endDays} onChange={(e) => update({ endDays: e.target.value })} className={cn("w-24 font-mono", INVALID)} />
                  <span className="text-[13px] text-fg-3">{t("days")}</span>
                </div>
              ) : d.endMode === "AT" ? (
                <Input {...aria(`${uid}-end`, errors["adset.schedule.end"])} type="datetime-local" value={d.endAt} onChange={(e) => update({ endAt: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
              ) : (
                // keeps the error focusable when "No end date" is what's wrong (Lifetime)
                <span id={`${uid}-end`} tabIndex={-1} aria-invalid={!!errors["adset.schedule.end"] || undefined} className="sr-only">{t("endNone")}</span>
              )}
            </div>
          </F>
        </Two>
      </Sec>

      <Sec title={t("sec.audience")}>
        <Audiences c={c} />
        <Two>
          <F id={`${uid}-geo`} label={t("locations")} error={errors["adset.countries"]} hint={t("locationsHint")}>
            <Input {...aria(`${uid}-geo`, errors["adset.countries"])} value={d.countries} onChange={(e) => update({ countries: e.target.value })} placeholder="US, CA" autoCapitalize="characters" className={cn("font-mono uppercase", INVALID)} />
          </F>
          <F id={`${uid}-agemin`} label={t("age")} error={errors["adset.ageMax"]} hint={t("ageHint")}>
            <div className="flex items-center gap-2">
              <Input {...aria(`${uid}-agemin`, errors["adset.ageMax"])} inputMode="numeric" value={d.ageMin} onChange={(e) => update({ ageMin: e.target.value })} aria-label={t("ageMin")} className={cn("w-[84px] font-mono", INVALID)} />
              <span className="text-[13px] text-fg-3">{t("to")}</span>
              <Input inputMode="numeric" value={d.ageMax} onChange={(e) => update({ ageMax: e.target.value })} aria-label={t("ageMax")} aria-invalid={!!errors["adset.ageMax"] || undefined} className={cn("w-[84px] font-mono", INVALID)} />
            </div>
          </F>
        </Two>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-bold">{t("gender")}</span>
          <ToggleGroup type="single" value={d.genders} onValueChange={(v) => v && update({ genders: v as Draft["genders"] })} disabled={readOnly} aria-label={t("gender")} className="justify-self-start">
            {(["ALL", "MALE", "FEMALE"] as const).map((g) => <ToggleGroupItem key={g} value={g}>{tw(`genders.${g}`)}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <Tog title={t("advantage")} body={t("advantageBody")} checked={d.advantage} onChange={(v) => update({ advantage: v })} disabled={readOnly} />
        <Languages c={c} />
        <SoonRow name={t("detailedSoon")} />
      </Sec>

      <Sec title={t("sec.placements")}>
        <RadioGroup value={d.placements} onValueChange={(v) => update({ placements: v as Draft["placements"] })} className="gap-1.5" disabled={readOnly} aria-label={t("sec.placements")}>
          <RadioCard value="AUTO" title={t("advPlacements")} body={t("advPlacementsBody")} on={d.placements === "AUTO"} disabled={readOnly} />
          <RadioCard value="MANUAL" title={t("manual")} body={t("manualBody")} on={d.placements === "MANUAL"} disabled={readOnly} />
        </RadioGroup>
        {d.placements === "MANUAL" ? (
          <div className="grid gap-1.5">
            <div id={`${uid}-plc`} tabIndex={-1} aria-invalid={!!errors["adset.placements"] || undefined} className={cn("grid gap-2.5 rounded-[12px] border border-line p-3", errors["adset.placements"] && "border-status-failed")}>
              {PLATFORMS.map((pl) => {
                const on = d.platforms.includes(pl)
                return (
                  <div key={pl} className="grid gap-1">
                    <label className="flex min-h-9 items-center gap-2 text-[13px] font-bold">
                      <Checkbox checked={on} disabled={readOnly} onCheckedChange={(v) => update({ platforms: v ? [...d.platforms, pl] : d.platforms.filter((x) => x !== pl), positions: v ? d.positions : d.positions.filter((p) => !p.startsWith(`${pl}_`)) })} />
                      {tw(`platform.${pl}`)}
                    </label>
                    {on ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-6">
                        {POSITIONS[pl].map((pos) => (
                          <label key={pos} className="flex min-h-9 items-center gap-1.5 text-[13px] text-fg-2">
                            <Checkbox checked={d.positions.includes(pos)} disabled={readOnly} onCheckedChange={(v) => update({ positions: v ? [...d.positions, pos] : d.positions.filter((x) => x !== pos) })} />
                            {tw(`position.${pos}` as "position.facebook_feed")}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <span className="text-xs text-fg-3">{tw("positionsHint")}</span>
            </div>
            {errors["adset.placements"] ? <span className="text-xs text-status-failed" role="alert">{errors["adset.placements"]}</span> : null}
          </div>
        ) : null}
      </Sec>

      <Sec title={t("sec.perAdset")} tag={<HookMillTag />} lead={t("perAdsetLead")}>
        <Two>
          <F id={`${uid}-min`} label={t("atLeast")} error={errors["adset.adsPerAdset"]}>
            <Input {...aria(`${uid}-min`, errors["adset.adsPerAdset"])} inputMode="numeric" value={d.min} onChange={(e) => update({ min: e.target.value })} className={cn("font-mono", INVALID)} />
          </F>
          <F id={`${uid}-max`} label={t("atMost")}>
            <Input id={`${uid}-max`} inputMode="numeric" value={d.max} onChange={(e) => update({ max: e.target.value })} aria-invalid={!!errors["adset.adsPerAdset"] || undefined} className={cn("font-mono", INVALID)} />
          </F>
        </Two>
        <PlanChips c={c} />
      </Sec>
    </>
  )
}

export function PlanChips({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2" aria-label={t("planAria")}>
      <span>{t("planInline", { n: c.sampleCount })}</span>
      {c.plan.map((p, i) => (
        <span key={i} className={cn("rounded-md border px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap", p.short ? "border-warn-dot bg-status-waiting-bg text-status-waiting" : "border-line bg-card-2")}>
          {p.short ? t("planChipShort", { i: i + 1, n: p.size, min: c.d.min }) : t("planChip", { i: i + 1, n: p.size })}
        </span>
      ))}
    </div>
  )
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)

/** v2 §2.6: Include / Exclude from GET /meta/custom-audiences; "Not usable" badge with the reason; Advantage+ note. */
function Audiences({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  const errorMessage = useErrorMessage()
  const { d, update, errors, uid, readOnly } = c
  const q = useCustomAudiences(c.conn?.adAccount?.id ?? null, !readOnly && !c.expired)
  const list = q.data?.audiences ?? []
  type Opt = { key: string; label: string; size: string | null; usable: boolean; reason: string | null; subtype: string | null }
  const opts: Opt[] = list.map((a) => ({
    key: a.id, label: a.name, subtype: a.subtype, usable: a.usable, reason: a.unusableReason,
    size: a.sizeLower !== null && a.sizeUpper !== null ? t("size", { lo: compact(a.sizeLower), hi: compact(a.sizeUpper) }) : null,
  }))
  const toOpt = (r: { id: string; name: string }): Opt => opts.find((o) => o.key === r.id) ?? { key: r.id, label: r.name, size: null, usable: true, reason: null, subtype: null }
  const render = (o: Opt) => (
    <span className="grid gap-px">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="[overflow-wrap:anywhere]">{o.label}</span>
        {!o.usable ? <span className="rounded-full bg-status-waiting-bg px-1.5 text-[10.5px] font-bold text-status-waiting">{t("notUsable")}</span> : null}
      </span>
      <span className="text-[11.5px] text-fg-3">{[o.subtype, o.size, !o.usable ? o.reason : null].filter(Boolean).join(" · ")}</span>
    </span>
  )
  const chip = (o: Opt) => (
    <span className="inline-flex items-center gap-1.5">
      {o.label}
      {!o.usable ? <Icon name="alert" className="size-3.5 text-status-waiting" aria-label={t("notUsable")} /> : null}
    </span>
  )
  const err = q.isError ? errorMessage(q.error) : null
  const common = { options: opts, render, renderChip: chip, loading: q.isPending && q.fetchStatus !== "idle", error: err, onRetry: () => q.refetch(), emptyText: t("audiencesEmpty"), disabled: readOnly, searchLabel: t("searchAudiences"), footer: q.data?.truncated ? t("audiencesTruncated") : undefined }
  const picked = [...d.customAudiences, ...d.excludedCustomAudiences].map(toOpt).filter((o) => !o.usable)
  return (
    <div className="grid gap-3">
      <Two>
        <F id={`${uid}-inc`} label={`${t("audiences")} · ${t("include")}`} error={errors["adset.customAudiences"]} hint={d.advantage && d.customAudiences.length ? t("audiencesSuggestion") : undefined}>
          <MultiPick
            id={`${uid}-inc`}
            invalid={!!errors["adset.customAudiences"]}
            describedBy={`${uid}-inc-msg`}
            value={d.customAudiences.map(toOpt)}
            onChange={(v) => update({ customAudiences: v.map((o) => ({ id: o.key, name: o.label })) })}
            addLabel={t("addInclude")}
            {...common}
          />
        </F>
        <F id={`${uid}-exc`} label={`${t("audiences")} · ${t("exclude")}`} error={errors["adset.excludedCustomAudiences"]}>
          <MultiPick
            id={`${uid}-exc`}
            invalid={!!errors["adset.excludedCustomAudiences"]}
            describedBy={`${uid}-exc-msg`}
            value={d.excludedCustomAudiences.map(toOpt)}
            onChange={(v) => update({ excludedCustomAudiences: v.map((o) => ({ id: o.key, name: o.label })) })}
            addLabel={t("addExclude")}
            {...common}
          />
        </F>
      </Two>
      {picked.length ? <p className="m-0 text-xs text-status-waiting">{t("notUsableWarn", { list: picked.map((o) => o.label).join(", ") })}</p> : null}
    </div>
  )
}

/** v2 §2.4: Languages from GET /meta/locales (filtered locally). Empty = all languages. */
function Languages({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  const errorMessage = useErrorMessage()
  const { d, update, errors, uid, readOnly } = c
  const q = useMetaLocales(!readOnly && !c.expired)
  const opts = (q.data?.locales ?? []).map((l) => ({ key: String(l.key), label: l.name }))
  return (
    <F id={`${uid}-lang`} label={t("languages")} error={errors["adset.locales"]} hint={d.locales.length ? undefined : t("languagesHint")}>
      <MultiPick
        id={`${uid}-lang`}
        invalid={!!errors["adset.locales"]}
        describedBy={`${uid}-lang-msg`}
        value={d.locales.map((l) => ({ key: String(l.key), label: l.name }))}
        onChange={(v) => update({ locales: v.map((o) => ({ key: Number(o.key), name: o.label })) })}
        options={opts}
        render={(o) => o.label}
        loading={q.isPending && q.fetchStatus !== "idle"}
        error={q.isError ? errorMessage(q.error) : null}
        onRetry={() => q.refetch()}
        emptyText={t("noMatch")}
        disabled={readOnly}
        addLabel={t("addLanguage")}
        searchLabel={t("searchLanguages")}
      />
    </F>
  )
}

/* ───────────────────────── Ad ───────────────────────── */
export function AdLevel({ c }: { c: LevelCtx }) {
  const t = useTranslations("metaTemplates.editor")
  const tf = useTranslations("publish.form")
  const errorMessage = useErrorMessage()
  const { d, update, errors, uid, readOnly } = c
  const ig = useInstagramAccounts(c.conn?.adAccount?.id ?? null, !readOnly && !c.expired)
  const accounts = ig.data?.accounts ?? []
  const pageName = c.conn?.page?.name ?? "—"
  const goalObj = isGoalObjective(d.objective)
  const pixelName = d.pixelId ? (c.pixels.find((p) => p.id === d.pixelId)?.name ?? d.pixelId) : null
  // a saved account that's no longer listed still shows (the API answers notAvailable on save)
  const igOptions = [...accounts.map((a) => ({ id: a.id, username: a.username, pic: a.profilePicUrl })), ...(d.instagramAccount && !accounts.some((a) => a.id === d.instagramAccount!.id) ? [{ id: d.instagramAccount.id, username: d.instagramAccount.username, pic: null }] : [])]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 min-[1180px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-3">
        <Sec title={t("sec.adName")}>
          <F id={`${uid}-dname`} label={t("adName")} error={errors["ad.namePattern"]} hint={<VarsHint sample={resolveSample(d.adName, c.sample.code ?? undefined, c.sample.offer ?? undefined)} />}>
            <Input {...aria(`${uid}-dname`, errors["ad.namePattern"])} value={d.adName} maxLength={120} onChange={(e) => update({ adName: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
          </F>
        </Sec>
        <Sec title={t("sec.identity")}>
          <Ro label={t("facebookPage")} note={t("fromConnection")}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="inline-grid size-[22px] place-items-center rounded-[6px] bg-meta text-[11px] font-extrabold text-white">f</span>
              {pageName}
            </span>
          </Ro>
          <F
            id={`${uid}-ig`}
            label={t("instagram")}
            error={errors["ad.instagramAccount"] ?? (ig.isError ? errorMessage(ig.error) : undefined)}
            hint={ig.isPending && ig.fetchStatus !== "idle" ? t("loadingIg") : ig.data && ig.data.pageLookup !== "ok" ? t("igHint") : undefined}
            fix={ig.isError ? <Button size="sm" onClick={() => ig.refetch()}>{t("retry")}</Button> : null}
          >
            <Select value={d.instagramAccount?.id ?? "page"} onValueChange={(v) => update({ instagramAccount: v === "page" ? null : (({ id, username }) => ({ id, username }))(igOptions.find((a) => a.id === v)!) })} disabled={readOnly}>
              <SelectTrigger {...aria(`${uid}-ig`, errors["ad.instagramAccount"])} className={cn("w-full", INVALID)}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="page">{t("usePage", { page: pageName })}</SelectItem>
                {igOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="inline-flex items-center gap-2">
                      {a.pic ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.pic} alt="" className="size-5 rounded-full object-cover" />
                      ) : (
                        <span aria-hidden="true" className="size-5 rounded-full bg-card-2" />
                      )}
                      @{a.username}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
        </Sec>
        <Sec title={t("sec.setup")}>
          <Ro label={t("format")} note={t("onePerVideo")}>{t("singleVideo")}</Ro>
          <SoonRow name={t("carouselSoon")} />
        </Sec>
        <Sec title={t("sec.creative")}>
          <F id={`${uid}-text`} label={t("primaryText")} optional error={errors["ad.primaryText"]} hint={t("primaryHint")}>
            <Textarea {...aria(`${uid}-text`, errors["ad.primaryText"])} rows={4} value={d.primaryText} placeholder={t("primaryPlaceholder")} onChange={(e) => update({ primaryText: e.target.value })} className={INVALID} />
          </F>
          <Two>
            <F id={`${uid}-head`} label={t("headline")} optional error={errors["ad.headline"]}>
              <Input {...aria(`${uid}-head`, errors["ad.headline"])} value={d.headline} maxLength={255} placeholder={t("headlinePh")} onChange={(e) => update({ headline: e.target.value })} className={INVALID} />
            </F>
            <F id={`${uid}-desc`} label={t("description")} optional error={errors["ad.description"]}>
              <Input {...aria(`${uid}-desc`, errors["ad.description"])} value={d.description} maxLength={125} placeholder={t("descriptionPh")} onChange={(e) => update({ description: e.target.value })} className={INVALID} />
            </F>
          </Two>
          <F id={`${uid}-cta`} label={t("cta")}>
            <Select value={d.cta} onValueChange={(v) => update({ cta: v as MetaCallToAction })} disabled={readOnly}>
              <SelectTrigger id={`${uid}-cta`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{CTAS.map((x) => <SelectItem key={x} value={x}>{tf(`ctaLabel.${x}`)}</SelectItem>)}</SelectContent>
            </Select>
          </F>
        </Sec>
        <Sec title={t("sec.destination")}>
          <F id={`${uid}-link`} label={t("websiteUrl")} error={errors["ad.link"]}>
            <Input {...aria(`${uid}-link`, errors["ad.link"])} type="url" inputMode="url" value={d.link} placeholder="https://" onChange={(e) => update({ link: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
          </F>
        </Sec>
        <Sec title={t("sec.tracking")}>
          <F id={`${uid}-utm`} label={t("urlParams")} optional error={errors["ad.urlTags"]} hint={t("urlParamsHint")}>
            <Input {...aria(`${uid}-utm`, errors["ad.urlTags"])} value={d.urlTags} placeholder="utm_source=meta&utm_medium=paid" onChange={(e) => update({ urlTags: e.target.value })} className={cn("font-mono text-[13px]", INVALID)} />
          </F>
          <Ro label={t("websiteEvents")} note={t("fromAdset")}>{goalObj ? "—" : (pixelName ?? t("noPixelShort"))}</Ro>
        </Sec>
      </div>
      <AdPreview
        page={pageName}
        instagram={d.instagramAccount?.username ?? null}
        text={d.primaryText}
        headline={d.headline}
        host={hostOf(d.link)}
        cta={tf(`ctaLabel.${d.cta}`)}
        thumb={c.sample.thumb}
        code={c.sample.code}
      />
    </div>
  )
}

