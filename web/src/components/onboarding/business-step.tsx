"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BusinessSuggestion, Offer, OfferBrief, OfferExtractOutput, ResultType, TargetCpa, UiLocale, UpdateOfferBody, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { BrandColorField, normalizeBrandColor } from "@/components/brand-color-field"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { ExtractChecklist, hostOf, ReadFrom, useOfferExtract } from "@/components/offer-extract"
import { choiceCardClass } from "@/components/ui/choice-card"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { Card, isMetaEnabled, OnboardingFrame, onboardingHref, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>
/** resultado-v1 (A3): "What counts as a result?" — each maps to the Meta optimization (fase2-agencia §1.1). */
const RESULT_TYPES: ResultType[] = ["PURCHASE", "LEAD", "MESSAGE", "APPOINTMENT", "SIGNUP", "SUBSCRIPTION", "APP_INSTALL", "OTHER"]
/** review 29/10 L2: the five common ones as chips; "More…" opens the rest (and Other). */
const MAIN_RESULT_TYPES = RESULT_TYPES.slice(0, 5)
/** Fields the site reading can pre-fill (A2); the "from your site" tag shows while the value is still the suggested one. */
type SiteKey = "name" | "industry" | "market" | "brandColor" | "result" | "code"
const DEFAULT_NAMES = new Set(["", "New client", "Workspace"])
const BRIEF_KEYS: (keyof OfferBrief)[] = ["what", "promise", "offerAndPrice", "proof", "cta", "audience", "pains"]
const CODE_RE = /^[A-Z0-9]{2,6}$/

export const normalizeUrl = (u: string) => {
  const v = u.trim()
  if (!v) return ""
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/**
 * "Read the site" fills the client's offer (fase2-agencia §3.3): no offer yet → POST /offers with the reading;
 * an offer already there → PATCH only its EMPTY fields (never overwrites what someone typed). Checked in steps 3 and 4.
 */
async function applyReading(out: OfferExtractOutput, url: string, current: Offer | null): Promise<Offer> {
  const brief = Object.fromEntries(BRIEF_KEYS.map((k) => [k, out.brief[k] || null])) as Partial<OfferBrief>
  if (!current) {
    return api.offers.create({
      name: out.name || hostOf(url), language: out.language, sourceUrl: url, kind: out.brief.kind ?? null, notes: null, ...brief,
      fieldSources: out.fieldSources,
      // briefing-leitura-v2 D5: a new offer keeps the "read from" of the reading (absent before v2)
      readMeta: out.readMeta,
    })
  }
  // existing offer: only the empty fields, plus the reading's `readMeta` (D6: whoever applies sends it); step 3 reads
  // the origins back from the offer
  const patch: UpdateOfferBody = {}
  for (const k of BRIEF_KEYS) if (!current[k]?.trim() && brief[k]) patch[k] = brief[k]
  // QA bug 14 (BR-04): what the reading filled stays "from page" (step 3 shows the "From …" tags); without it, every sent field becomes `user`
  const filled = BRIEF_KEYS.filter((k) => patch[k] !== undefined)
  if (filled.length) patch.fieldSources = Object.fromEntries(filled.map((k) => [k, "page" as const]))
  if (!current.sourceUrl) patch.sourceUrl = url
  if (out.readMeta) patch.readMeta = out.readMeta
  return Object.keys(patch).length ? api.offers.update(current.id, patch) : current
}

export function BusinessStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const tf = useTranslations("offers.fields")
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  const qc = useQueryClient()
  const { canEdit, offer, move } = ctx
  const metaOn = isMetaEnabled(ws)

  const [site, setSite] = useState(ws.websiteUrl ?? "")
  // L3: the name is asked only here (no longer in the signup nor in /start); the signup's placeholder name starts empty
  const [name, setName] = useState(!ws.onboarding.completedAt && DEFAULT_NAMES.has(ws.name) ? "" : ws.name)
  const [industry, setIndustry] = useState(ws.industry ?? "")
  const [market, setMarket] = useState(ws.market ?? "")
  const [goal, setGoal] = useState<ResultType | null>(ws.resultType ?? null)
  const [resultOther, setResultOther] = useState(ws.resultTypeOther ?? "")
  const [code, setCode] = useState(ws.shortCode)
  // A2: what the last reading filled (key → suggested value); the tag goes away once the person edits the field
  const [fromSite, setFromSite] = useState<Partial<Record<SiteKey, string>>>({})
  const [codeTouched, setCodeTouched] = useState(false)
  const [locale, setLocale] = useState<UiLocale>(ws.uiLocale)
  const [brandColor, setBrandColor] = useState(ws.brandColor ?? "")
  // 29/10 (Tordan's Loom): target cost per result, a range ("100 to 150"); optional, both or neither
  const [cpaMin, setCpaMin] = useState(ws.targetCpa ? String(ws.targetCpa.min) : "")
  const [cpaMax, setCpaMax] = useState(ws.targetCpa ? String(ws.targetCpa.max) : "")
  const [cpaCurrency, setCpaCurrency] = useState(ws.targetCpa?.currency ?? "USD")
  const [found, setFound] = useState<string[] | null>(null)
  // L2: "More…" result types and the optional "More details" open by themselves when they already hold a value
  const [moreTypes, setMoreTypes] = useState(() => !!ws.resultType && !MAIN_RESULT_TYPES.includes(ws.resultType))
  const [moreOpen, setMoreOpen] = useState(() => !!ws.brandColor || !!ws.targetCpa)

  const ex = useOfferExtract({ onStart: () => setFound(null) })
  const apply = useMutation({
    mutationFn: ({ out, url }: { out: OfferExtractOutput; url: string }) => applyReading(out, url, offer),
    onSuccess: (o, { out }) => {
      qc.invalidateQueries({ queryKey: ["offers"] })
      qc.setQueryData(["offer", o.id], o)
      setFound(BRIEF_KEYS.filter((k) => !!out.brief[k]?.trim()).map((k) => tf(k as never)))
      // the site goes with the client too, without waiting for Continue
      if (canEdit && ws.websiteUrl !== normalizeUrl(site)) {
        api.workspace.update({ websiteUrl: normalizeUrl(site) }).then((w) => qc.setQueryData(["workspace"], w)).catch(() => undefined)
      }
    },
  })
  /** A2: the reading pre-fills only EMPTY fields (the code only while nobody typed it), all still editable. */
  const prefill = (out: OfferExtractOutput) => {
    if (!canEdit) return
    const b: BusinessSuggestion | undefined = out.business
    const filled: Partial<Record<SiteKey, string>> = {}
    const take = (key: SiteKey, empty: boolean, value: string | null | undefined, set: (v: string) => void) => {
      if (!empty || !value) return
      set(value)
      filled[key] = value
    }
    take("name", DEFAULT_NAMES.has(name.trim()), out.name?.slice(0, 80), setName)
    take("industry", !industry.trim(), b?.industry, setIndustry)
    take("market", !market.trim(), b?.market, setMarket)
    take("brandColor", !brandColor.trim(), b?.brandColor, setBrandColor)
    take("result", goal === null, b?.resultType, (v) => {
      setGoal(v as ResultType)
      if (!MAIN_RESULT_TYPES.includes(v as ResultType)) setMoreTypes(true)
    })
    take("code", !codeTouched && (!ws.onboarding.completedAt || !CODE_RE.test(code)), b?.shortCode, setCode)
    setFromSite(filled)
  }
  const prefillRef = useRef(prefill)
  useEffect(() => {
    prefillRef.current = prefill
  })
  const siteTag = (key: SiteKey, current: string | null) =>
    fromSite[key] !== undefined && fromSite[key] === current ? (
      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">{t("business.fromSite")}</span>
    ) : null

  // apply each finished reading once
  const applied = useRef<unknown>(null)
  const { result } = ex
  const applyMutate = apply.mutate
  useEffect(() => {
    if (result && applied.current !== result) {
      applied.current = result
      prefillRef.current(result)
      applyMutate({ out: result, url: normalizeUrl(site) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per reading, not per keystroke in the URL field
  }, [result, applyMutate])

  const read = () => {
    const url = normalizeUrl(site)
    if (!url) return
    setSite(url)
    ex.start({ url })
  }

  const codeOk = CODE_RE.test(code)
  const brandColorNorm = normalizeBrandColor(brandColor)
  const nameOk = name.trim().length > 0 && name.trim().length <= 80
  const otherOk = goal !== "OTHER" || (resultOther.trim().length > 0 && resultOther.trim().length <= 80)
  const cpa = targetCpaOf(cpaMin, cpaMax, cpaCurrency)
  const body = (): UpdateWorkspaceBody => ({
    name: name.trim(),
    websiteUrl: normalizeUrl(site) || null,
    industry: industry.trim() || null,
    market: market.trim() || null,
    resultType: goal,
    resultTypeOther: goal === "OTHER" ? resultOther.trim() : null,
    // 29/10: like brandColor, sent only when it changed
    ...(cpa !== "invalid" && JSON.stringify(cpa) !== JSON.stringify(ws.targetCpa ?? null) ? { targetCpa: cpa } : {}),
    shortCode: code,
    uiLocale: locale,
    // estatico-montado D3: sent only when it changed (an API without the field ignores nothing it didn't get)
    ...((brandColorNorm || null) !== (ws.brandColor ?? null) ? { brandColor: brandColorNorm || null } : {}),
  })
  const valid = nameOk && codeOk && brandColorNorm !== null && otherOk && cpa !== "invalid"
  const go = (step: number, to: string) => (valid || !canEdit ? move.mutate({ body: canEdit ? body() : undefined, step, to }) : undefined)

  const mmdd = format.dateTime(new Date(), { month: "2-digit", day: "2-digit", timeZone: "UTC" }).replace(/\D/g, "").slice(0, 4)
  const reading = ex.reading || apply.isPending
  const readFailed = ex.failedJob ?? ex.error ?? apply.error

  return (
    <OnboardingFrame
      slug="business"
      ws={ws}
      title={t("business.title")}
      sub={t("business.sub")}
      error={move.error}
      saving={move.isPending}
      onSaveExit={() => go(1, ctx.exitTo)}
      hintWarn={!valid}
      hint={!valid ? t(!otherOk ? "business.fixOther" : cpa === "invalid" ? "business.fixCpa" : "business.fixFirst") : t("savedAsYouGo")}
      back={null}
      primary={
        <Button variant="brand" size="lg" disabled={move.isPending || (canEdit && !valid) || reading} onClick={() => go(ctx.nextStep(1), ctx.next(1))}>
          {metaOn ? t("business.continue") : t("business.continueOffer")}
          <Icon name="arrowr" />
        </Button>
      }
    >
      <Card title={t("business.website")}>
        <form
          className="flex flex-col gap-2.5 tablet:flex-row tablet:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            read()
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Label htmlFor="ob-site">{t("business.siteLabel")}</Label>
            <Input id="ob-site" type="text" inputMode="url" autoComplete="url" value={site} disabled={!canEdit} onChange={(e) => setSite(e.target.value)} placeholder="example.com" />
          </div>
          <Button type="submit" disabled={!canEdit || !site.trim() || reading}>
            <Icon name="refresh" />
            {found || offer?.sourceUrl ? t("business.readAgain") : t("business.read")}
          </Button>
        </form>
        {!reading && !found && !readFailed ? <p className="m-0 text-[13px] text-fg-3">{t("business.readHint")}</p> : null}
        {reading ? (
          <div className="flex flex-col gap-2 rounded-lg bg-card-2 p-3.5">
            <ExtractChecklist job={ex.job} url={site} />
            {apply.isPending ? <span className="text-[13px] text-fg-2">{t("business.saving")}</span> : null}
          </div>
        ) : null}
        {found && !reading ? (
          <div role="status" className="flex flex-col gap-2.5 rounded-lg border border-brand-edge bg-brand-soft p-3.5">
            <div className="flex items-center gap-2.5 font-semibold">
              <Icon name="check" className="text-brand-ink" />
              {found.length ? t("business.readDone") : t("business.readEmpty")}
            </div>
            {found.length ? (
              <div className="flex flex-wrap gap-1.5">
                {found.map((f) => (
                  <span key={f} className="rounded-full border border-brand-edge bg-card px-2.5 py-1 text-xs font-semibold">
                    {f}
                  </span>
                ))}
              </div>
            ) : null}
            <ReadFrom source={ex.result?.readMeta ?? ex.result} className="text-[13px] text-fg-2" />
          </div>
        ) : null}
        {readFailed && !reading ? (
          <Alert variant="destructive">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("business.readFailed")}</AlertTitle>
              <AlertDescription>{ex.failedJob?.failReason ?? errorMessage(ex.failedJob ? { code: ex.failedJob.errorCode } : readFailed)}</AlertDescription>
            </AlertBody>
            <AlertActions>
              <Button size="sm" onClick={() => go(1, onboardingHref(3))}>
                {t("business.fillByHand")}
              </Button>
            </AlertActions>
          </Alert>
        ) : null}
      </Card>

      {/* review 29/10 L2: one focus per screen (onboarding-v2 §2.2), back to the approved shape — name, code, industry, market and
          the result as chips; language, brand color and target cost go into "More details", the team leaves step 1 */}
      <Card title={t("business.details")}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 tablet:grid-cols-2">
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="ob-name">{t("business.name")}</Label>
              {siteTag("name", name)}
            </div>
            <Input id="ob-name" value={name} maxLength={80} disabled={!canEdit} aria-invalid={!nameOk && name !== ""} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="ob-code">{t("business.code")}</Label>
              {siteTag("code", code)}
            </div>
            <Input
              id="ob-code"
              value={code}
              maxLength={6}
              disabled={!canEdit}
              aria-invalid={!codeOk}
              aria-describedby="ob-code-hint"
              onChange={(e) => {
                setCodeTouched(true)
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }}
              className="font-mono"
            />
            <span id="ob-code-hint" className={cn("text-xs", codeOk ? "text-fg-3" : "text-status-failed")}>
              {codeOk ? (
                <>
                  <span className="font-mono text-fg-2 [overflow-wrap:anywhere]">{`${code}_NEW_${mmdd}_A_F1_9x16.mp4`}</span> · {t("business.codeHint")}
                </>
              ) : (
                t("business.codeInvalid")
              )}
            </span>
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="ob-industry">{t("business.industry")}</Label>
              {siteTag("industry", industry)}
            </div>
            <Input id="ob-industry" value={industry} maxLength={80} disabled={!canEdit} onChange={(e) => setIndustry(e.target.value)} placeholder={t("business.industryPh")} />
          </div>
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="ob-market">{t("business.market")}</Label>
              {siteTag("market", market)}
            </div>
            <Input id="ob-market" value={market} maxLength={80} disabled={!canEdit} onChange={(e) => setMarket(e.target.value)} placeholder={t("business.marketPh")} />
          </div>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 flex items-center gap-2 p-0 text-[13px] font-semibold">
            {t("business.resultLegend")}
            {siteTag("result", goal)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {(moreTypes ? RESULT_TYPES : MAIN_RESULT_TYPES).map((rt) => (
              <button
                key={rt}
                type="button"
                aria-pressed={goal === rt}
                disabled={!canEdit}
                onClick={() => setGoal(rt)}
                className={choiceCardClass(goal === rt, "min-h-11 rounded-full px-3.5 py-0 text-[13px] font-semibold text-fg disabled:opacity-45")}
              >
                {t(`resultType.${rt}.label`)}
              </button>
            ))}
            {moreTypes ? null : (
              <button
                type="button"
                aria-expanded={false}
                disabled={!canEdit}
                onClick={() => setMoreTypes(true)}
                className={choiceCardClass(false, "min-h-11 rounded-full border-dashed px-3.5 py-0 text-[13px] font-semibold text-fg-2 disabled:opacity-45")}
              >
                {t("business.moreTypes")}
              </button>
            )}
          </div>
          {goal === "OTHER" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ob-result-other">{t("business.resultOtherLabel")}</Label>
              <Input
                id="ob-result-other"
                value={resultOther}
                maxLength={80}
                disabled={!canEdit}
                aria-invalid={!otherOk}
                onChange={(e) => setResultOther(e.target.value)}
                placeholder={t("business.resultOtherPh")}
              />
            </div>
          ) : null}
          <span className="text-xs text-fg-3">
            {goal ? <b className="font-semibold text-fg-2">{t(`resultType.${goal}.hint`)} </b> : null}
            {t("business.resultHint")}
          </span>
        </fieldset>

        <Accordion type="single" collapsible value={moreOpen ? "more" : ""} onValueChange={(v) => setMoreOpen(v === "more")}>
          <AccordionItem value="more" className="border-t border-line-soft first:border-t">
            <AccordionTrigger className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 pt-3 pb-1 hover:bg-transparent">
              <Icon name="chev" className="text-fg-3 transition-transform group-data-[state=open]:rotate-90" />
              <b className="text-[13px] font-semibold">{t("business.more")}</b>
              <span className="text-[13px] text-fg-3">{t("business.moreSub")}</span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-3.5 px-0 pt-2.5 pb-0">
              <div className="grid min-w-0 gap-1.5 tablet:max-w-[calc(50%-7px)]">
                <Label htmlFor="ob-locale">{t("business.language")}</Label>
                <Select value={locale} onValueChange={(v) => setLocale(v as UiLocale)} disabled={!canEdit}>
                  <SelectTrigger id="ob-locale" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EN">English</SelectItem>
                    <SelectItem value="PT_BR">Português (Brasil)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <BrandColorField id="ob-brand-color" value={brandColor} onChange={setBrandColor} disabled={!canEdit} badge={siteTag("brandColor", brandColor)} />

              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-2 p-0 text-[13px] font-semibold">{t("business.cpaLegend")}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="ob-cpa-min"
                    aria-label={t("business.cpaMin")}
                    inputMode="decimal"
                    className="w-28"
                    value={cpaMin}
                    disabled={!canEdit}
                    aria-invalid={cpa === "invalid"}
                    onChange={(e) => setCpaMin(e.target.value)}
                    placeholder="100"
                  />
                  <span className="text-fg-3">{t("business.cpaTo")}</span>
                  <Input
                    id="ob-cpa-max"
                    aria-label={t("business.cpaMax")}
                    inputMode="decimal"
                    className="w-28"
                    value={cpaMax}
                    disabled={!canEdit}
                    aria-invalid={cpa === "invalid"}
                    onChange={(e) => setCpaMax(e.target.value)}
                    placeholder="150"
                  />
                  <Select value={cpaCurrency} onValueChange={setCpaCurrency} disabled={!canEdit}>
                    <SelectTrigger className="w-24" aria-label={t("business.cpaCurrency")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CPA_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <span className={cn("text-xs", cpa === "invalid" ? "text-status-failed" : "text-fg-3")}>{t(cpa === "invalid" ? "business.fixCpa" : "business.cpaHint")}</span>
              </fieldset>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
      <p className="m-0 text-xs text-fg-3">
        {t("business.inviteLater")} {t.rich("business.soonCurrency", { b: (c) => <b className="font-semibold text-fg-2">{c}</b> })}
      </p>
    </OnboardingFrame>
  )
}

const CPA_CURRENCIES = ["USD", "BRL", "EUR", "GBP", "MXN"]

/** Both empty = not given (null); both filled, > 0 and min ≤ max = the range; anything else = "invalid". "1.234,50" and "1,234.50" read as 1234.5. */
function targetCpaOf(minText: string, maxText: string, currency: string): TargetCpa | null | "invalid" {
  if (!minText.trim() && !maxText.trim()) return null
  const min = money(minText), max = money(maxText)
  if (min === null || max === null || min <= 0 || max > 1_000_000 || min > max) return "invalid"
  return { min, max, currency }
}

function money(text: string): number | null {
  const t = text.trim().replace(/[^\d.,]/g, "")
  if (!t) return null
  const lastSep = Math.max(t.lastIndexOf(","), t.lastIndexOf("."))
  const decimals = lastSep >= 0 && t.length - lastSep - 1 <= 2 ? t.slice(lastSep + 1) : ""
  const int = (decimals ? t.slice(0, lastSep) : t).replace(/[.,]/g, "")
  const n = Number(`${int || "0"}.${decimals || "0"}`)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
