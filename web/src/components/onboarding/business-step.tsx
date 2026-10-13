"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BusinessType, Offer, OfferBrief, OfferExtractOutput, UiLocale, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { ExtractChecklist, hostOf, useOfferExtract } from "@/components/offer-extract"
import { SoonBlock } from "@/components/soon"
import { InviteForm } from "@/components/team"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"
import { Card, OnboardingFrame, onboardingHref, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>
const BUSINESS_TYPES: BusinessType[] = ["ONLINE_STORE", "LOCAL_BUSINESS", "APP"]
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
    })
  }
  const patch: Partial<OfferBrief> & { sourceUrl?: string } = {}
  for (const k of BRIEF_KEYS) if (!current[k]?.trim() && brief[k]) patch[k] = brief[k]
  if (!current.sourceUrl) patch.sourceUrl = url
  return Object.keys(patch).length ? api.offers.update(current.id, patch) : current
}

export function BusinessStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const tf = useTranslations("offers.fields")
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  const qc = useQueryClient()
  const { canEdit, offer, move } = ctx

  const [site, setSite] = useState(ws.websiteUrl ?? "")
  const [name, setName] = useState(ws.name)
  const [industry, setIndustry] = useState(ws.industry ?? "")
  const [market, setMarket] = useState(ws.market ?? "")
  const [type, setType] = useState<BusinessType | null>(ws.businessType)
  const [code, setCode] = useState(ws.shortCode)
  const [locale, setLocale] = useState<UiLocale>(ws.uiLocale)
  const [found, setFound] = useState<string[] | null>(null)

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
  // apply each finished reading once
  const applied = useRef<unknown>(null)
  const { result } = ex
  const applyMutate = apply.mutate
  useEffect(() => {
    if (result && applied.current !== result) {
      applied.current = result
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
  const nameOk = name.trim().length > 0 && name.trim().length <= 80
  const body = (): UpdateWorkspaceBody => ({
    name: name.trim(),
    websiteUrl: normalizeUrl(site) || null,
    industry: industry.trim() || null,
    market: market.trim() || null,
    businessType: type,
    shortCode: code,
    uiLocale: locale,
  })
  const valid = nameOk && codeOk
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
      onSaveExit={() => go(1, "/clients")}
      hintWarn={!valid}
      hint={!valid ? t("business.fixFirst") : t("savedAsYouGo")}
      back={null}
      primary={
        <Button variant="brand" size="lg" disabled={move.isPending || (canEdit && !valid) || reading} onClick={() => go(2, onboardingHref(2))}>
          {t("business.continue")}
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

      <Card title={t("business.details")}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 tablet:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ob-name">{t("business.name")}</Label>
            <Input id="ob-name" value={name} maxLength={80} disabled={!canEdit} aria-invalid={!nameOk} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ob-industry">{t("business.industry")}</Label>
            <Input id="ob-industry" value={industry} maxLength={80} disabled={!canEdit} onChange={(e) => setIndustry(e.target.value)} placeholder={t("business.industryPh")} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="ob-market">{t("business.market")}</Label>
            <Input id="ob-market" value={market} maxLength={80} disabled={!canEdit} onChange={(e) => setMarket(e.target.value)} placeholder={t("business.marketPh")} />
          </div>
          <div className="grid min-w-0 gap-1.5">
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
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold">{t("business.typeLegend")}</legend>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_TYPES.map((bt) => (
              <button
                key={bt}
                type="button"
                aria-pressed={type === bt}
                disabled={!canEdit}
                onClick={() => setType(bt)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45",
                  type === bt ? "border-fg bg-fg text-white" : "border-line-strong bg-card text-fg hover:border-fg"
                )}
              >
                {t(`businessType.${bt}`)}
              </button>
            ))}
          </div>
          <span className="text-xs text-fg-3">{t("business.typeHint")}</span>
        </fieldset>

        <div className="grid gap-1.5 border-t border-line-soft pt-3.5">
          <Label htmlFor="ob-code">{t("business.code")}</Label>
          <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center">
            <Input
              id="ob-code"
              value={code}
              maxLength={6}
              disabled={!canEdit}
              aria-invalid={!codeOk}
              aria-describedby="ob-code-hint"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className="w-full font-mono tablet:w-32"
            />
            <span className="min-w-0 truncate font-mono text-xs text-fg-2">
              {codeOk ? `${code}_NEW_${mmdd}_A_F1_9x16.mp4` : null}
            </span>
          </div>
          <span id="ob-code-hint" className={cn("text-xs", codeOk ? "text-fg-3" : "text-status-failed")}>
            {codeOk ? t("business.codeHint") : t("business.codeInvalid")}
          </span>
        </div>

        <SoonBlock what={t.rich("business.soonCurrency", { b: (c) => <b>{c}</b> })} />
      </Card>

      <TeamCard canEdit={canEdit} />
    </OnboardingFrame>
  )
}

function TeamCard({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations()
  const format = useFormatter()
  const members = useQuery({ queryKey: ["workspace", "members"], queryFn: api.workspace.members })
  return (
    <Card title={t("onboarding.business.team")}>
      <p className="m-0 -mt-2 text-[13px] text-fg-3">{t("onboarding.business.teamSub")}</p>
      {members.data ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {members.data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 border-t border-line-soft py-3">
              <span aria-hidden="true" className="inline-grid size-[34px] flex-none place-items-center rounded-full bg-ink-line font-bold text-ink-fg">
                {m.initials.slice(0, 1)}
              </span>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                <strong className="truncate">{m.name}</strong>
                <span className="truncate text-[13px] text-fg-3">{m.email}</span>
              </span>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", m.role === "CLIENT" ? "bg-status-progress-bg text-status-progress" : "bg-card-2 text-fg-2")}>
                {t(`shell.roleLabel.${m.role}`)}
              </span>
            </li>
          ))}
          {members.data.invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 border-t border-line-soft py-3">
              <span aria-hidden="true" className="inline-grid size-[34px] flex-none place-items-center rounded-full border border-dashed border-control text-fg-3">
                <Icon name="clock" />
              </span>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                <strong className="truncate font-medium">{i.email}</strong>
                <span className="text-[13px] text-fg-3">
                  {t("settings.pendingInvite", { date: format.dateTime(new Date(i.expiresAt), { month: "short", day: "numeric" }) })}
                </span>
              </span>
              <span className="rounded-full bg-card-2 px-2.5 py-1 text-xs font-semibold text-fg-2">{t(`shell.roleLabel.${i.role}`)}</span>
            </li>
          ))}
        </ul>
      ) : members.isError ? (
        <p className="m-0 text-[13px] text-status-failed">{t("onboarding.business.teamFailed")}</p>
      ) : (
        <div className="grid gap-2" aria-hidden="true">
          <span className="sk h-11" />
          <span className="sk h-11" />
        </div>
      )}
      {canEdit ? (
        <div className="border-t border-line-soft pt-3.5">
          <InviteForm inline defaultRole="CLIENT" idPrefix="ob-invite" />
        </div>
      ) : null}
    </Card>
  )
}
