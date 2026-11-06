"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { ApiResult } from "@/lib/api/client"
import type { Job, Offer, OfferBrief, PageMeta, ResultType, TargetCpa, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/icon"
import { ExtractStatus, hostOf, ReadFrom } from "@/components/offer-extract"
import { MetaConnect, useMetaConnect } from "@/components/meta/meta-connect"
import { metaGateOf } from "@/components/meta/meta-gate"
import { BrandKit, BRAND_KIT_KEY } from "@/components/brand/brand-kit"
import { TOUR_STEP_KEY } from "@/components/tour/tour-state"
import { ME_KEY } from "@/hooks/use-me"
import { metaReady, mk, useMetaConnection, useMoney } from "@/hooks/use-meta"
import { useErrorMessage } from "@/hooks/use-error-message"
import { BRAIN_ITEMS, brainCompleteness } from "@/lib/brain"
import { cn } from "@/lib/utils"
import { CardFoot, CardHead, ChatCard, Confirmed, EddyMsg, EditRow, MeBubble, Say, SysLine } from "./eddy-ui"
import type { EddyConfirm, EddyLocal } from "./eddy-store"

/** What every moment needs: the server state, the local "confirmed" memory and the writes. */
export interface EddyCtx {
  ws: Workspace
  offers: Offer[]
  offer: Offer | null
  canEdit: boolean
  local: EddyLocal
  confirm: (c: EddyConfirm, extra?: Partial<EddyLocal>) => void
  update: (fn: (s: EddyLocal) => EddyLocal) => void
  /** PATCH /workspace and put the answer in the cache */
  saveWs: (b: UpdateWorkspaceBody) => Promise<Workspace>
}

export const DEFAULT_NAMES = new Set(["", "New client", "Workspace"])
const MAIN_RESULT_TYPES: ResultType[] = ["PURCHASE", "LEAD", "MESSAGE", "APPOINTMENT", "SIGNUP"]
const MORE_RESULT_TYPES: ResultType[] = ["SUBSCRIPTION", "APP_INSTALL", "OTHER"]

const b = (c: React.ReactNode) => <b className="font-bold">{c}</b>

// ───────────── site ─────────────

export function SiteMoment({ ctx, active, onRead, onDescribe, pending, error }: {
  ctx: EddyCtx; active: boolean; onRead: (url: string) => void; onDescribe: () => void; pending: boolean; error: unknown
}) {
  const t = useTranslations("eddyOnboarding.site")
  const errorMessage = useErrorMessage()
  const [site, setSite] = useState(ctx.ws.websiteUrl ?? "")
  const named = !DEFAULT_NAMES.has(ctx.ws.name.trim())
  return (
    <EddyMsg>
      <Say>{named ? t("hiNamed", { name: ctx.ws.name }) : t("hi")}</Say>
      <Say>{t.rich("ask", { b })}</Say>
      {active ? (
        <>
          <ChatCard>
            <form
              className="flex flex-wrap items-center gap-2 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (site.trim()) onRead(site)
              }}
            >
              <Input
                aria-label={t("label")}
                inputMode="url"
                autoComplete="url"
                placeholder="example.com"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                disabled={!ctx.canEdit || pending}
                className="min-w-0 flex-[1_1_200px] font-mono"
              />
              <Button type="submit" variant="brand" disabled={!ctx.canEdit || pending || !site.trim()} aria-busy={pending} className="max-tablet:flex-[1_1_auto]">
                {pending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : null}
                {t("read")}
              </Button>
            </form>
          </ChatCard>
          {error ? (
            <Alert variant="destructive">
              <Icon name="alert" />
              <AlertBody>
                <AlertTitle>{t("startFailed")}</AlertTitle>
                <AlertDescription>{errorMessage(error)}</AlertDescription>
              </AlertBody>
            </Alert>
          ) : null}
          <Button variant="ghost" size="sm" className="self-start" onClick={onDescribe} disabled={!ctx.canEdit}>
            {t("noSite")}
          </Button>
        </>
      ) : null}
    </EddyMsg>
  )
}

// ───────────── reading ─────────────

export function ReadingMoment({ ctx, active, job, applying, failed, onRetry, onManual }: {
  ctx: EddyCtx; active: boolean; job: Job | null; applying: boolean; failed: unknown; onRetry: () => void; onManual: () => void
}) {
  const t = useTranslations("eddyOnboarding.reading")
  const errorMessage = useErrorMessage()
  const r = ctx.local.read
  if (!r) return null
  const what = r.url ? hostOf(r.url) : t("yourText")
  return (
    <>
      <MeBubble>{r.url ? hostOf(r.url) : r.said}</MeBubble>
      <EddyMsg busy={active && !failed}>
        {active ? (
          failed ? (
            <>
              <Say>{t("failedSay", { what })}</Say>
              <Alert variant="destructive">
                <Icon name="alert" />
                <AlertBody>
                  <AlertTitle>{t("failed")}</AlertTitle>
                  <AlertDescription>{isApiError(failed) || failed instanceof Error ? errorMessage(failed) : String(failed)}</AlertDescription>
                </AlertBody>
                <AlertActions>
                  <Button size="sm" onClick={onRetry}>
                    <Icon name="refresh" />
                    {t("retry")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={onManual}>
                    {t("manual")}
                  </Button>
                </AlertActions>
              </Alert>
            </>
          ) : (
            <>
              <Say>{t("say", { what })}</Say>
              <ChatCard beam className="px-4 py-3.5">
                <ExtractStatus job={job} label={applying ? t("saving") : t("status", { what })} />
              </ChatCard>
            </>
          )
        ) : (
          <>
            <Say>{t("done", { what })}</Say>
            {ctx.offer?.readMeta ? <ReadFrom source={ctx.offer.readMeta} className="text-[13px] text-fg-3" /> : null}
          </>
        )}
      </EddyMsg>
    </>
  )
}

// ───────────── business ─────────────

export function BusinessMoment({ ctx, active }: { ctx: EddyCtx; active: boolean }) {
  const t = useTranslations("eddyOnboarding.business")
  const to = useTranslations("onboarding")
  const errorMessage = useErrorMessage()
  const { ws, canEdit, saveWs, confirm } = ctx
  const editable = active && canEdit
  const [more, setMore] = useState(() => !!ws.resultType && !MAIN_RESULT_TYPES.includes(ws.resultType))
  const [other, setOther] = useState<string | null>(null)
  const pick = useMutation({ mutationFn: (rt: ResultType) => saveWs({ resultType: rt }) })
  const done = useMutation({
    mutationFn: async () => {
      if (!ws.onboarding.completedAt) await saveWs({ onboardingStep: 3 })
    },
    onSuccess: () => confirm("business"),
  })
  const name = DEFAULT_NAMES.has(ws.name.trim()) ? "" : ws.name
  const choosingOther = other !== null
  const ready = !!name && !!ws.resultType && (ws.resultType !== "OTHER" || !!ws.resultTypeOther?.trim())
  const result = ws.resultType ? (ws.resultType === "OTHER" && ws.resultTypeOther ? ws.resultTypeOther : to(`resultType.${ws.resultType}.label`)) : null
  const src = ws.websiteUrl ? hostOf(ws.websiteUrl) : null

  return (
    <>
      <EddyMsg>
        <Say>{t("say")}</Say>
        <ChatCard>
          <CardHead title={t("title")} tag={src ? t("from", { src }) : null} />
          <div>
            <EditRow label={t("name")} value={name} emptyText={t("missing")} emptyWarn editable={editable} maxLength={80} onSave={(v) => saveWs({ name: v })} />
            <EditRow label={t("industry")} value={ws.industry} emptyText={t("missing")} emptyWarn editable={editable} maxLength={80} onSave={(v) => saveWs({ industry: v || null })} />
            <EditRow label={t("market")} value={ws.market} placeholder={t("marketPh")} emptyText={t("missing")} emptyWarn editable={editable} maxLength={80} onSave={(v) => saveWs({ market: v || null })} />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line-soft px-3.5 py-2.5 tablet:grid-cols-[130px_minmax(0,1fr)] tablet:px-4">
              <span id="eddy-result" className="pt-px text-[12.5px] font-semibold text-fg-3">
                {t("result")}
              </span>
              {editable ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <div role="radiogroup" aria-labelledby="eddy-result" className="flex flex-wrap gap-1.5">
                    {(more ? [...MAIN_RESULT_TYPES, ...MORE_RESULT_TYPES] : MAIN_RESULT_TYPES).map((rt) => {
                      const on = choosingOther ? rt === "OTHER" : ws.resultType === rt
                      return (
                        <button
                          key={rt}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={pick.isPending}
                          onClick={() => {
                            if (rt === "OTHER") return setOther(ws.resultTypeOther ?? "")
                            setOther(null)
                            pick.mutate(rt)
                          }}
                          className={cn(
                            "min-h-10 rounded-full border border-line-strong bg-card px-3 text-[12.5px] font-semibold tablet:min-h-8",
                            on && "border-[1.5px] border-fg shadow-[0_0_0_1px_var(--fg)]"
                          )}
                        >
                          {to(`resultType.${rt}.label`)}
                        </button>
                      )
                    })}
                    {more ? null : (
                      <button type="button" onClick={() => setMore(true)} className="min-h-10 rounded-full border border-dashed border-line-strong bg-card px-3 text-[12.5px] font-semibold text-fg-2 tablet:min-h-8">
                        {t("more")}
                      </button>
                    )}
                  </div>
                  {choosingOther ? (
                    <form
                      className="flex flex-wrap gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!other.trim()) return
                        saveWs({ resultType: "OTHER", resultTypeOther: other.trim() }).then(() => setOther(null), () => undefined)
                      }}
                    >
                      <Input aria-label={to("business.resultOtherLabel")} value={other} maxLength={80} onChange={(e) => setOther(e.target.value)} placeholder={to("business.resultOtherPh")} className="min-w-0 flex-[1_1_180px]" autoFocus />
                      <Button size="sm" variant="default" type="submit" disabled={!other.trim()}>
                        {t("save")}
                      </Button>
                    </form>
                  ) : null}
                  {pick.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(pick.error)}</span> : null}
                  {ws.resultType ? <span className="text-xs text-fg-3">{to(`resultType.${ws.resultType}.hint`)}</span> : null}
                </div>
              ) : (
                <span className={cn(!result && "font-semibold text-warn")}>{result ?? t("missing")}</span>
              )}
            </div>
          </div>
          <CardFoot hint={active ? (ready ? t("hint") : t("needs")) : null}>
            {active ? (
              <Button variant="brand" onClick={() => done.mutate()} disabled={!canEdit || !ready || done.isPending} aria-busy={done.isPending}>
                {t("confirm")}
              </Button>
            ) : (
              <Confirmed>{t("confirmed")}</Confirmed>
            )}
          </CardFoot>
        </ChatCard>
        {done.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(done.error)}</span> : null}
      </EddyMsg>
    </>
  )
}

// ───────────── offer, audience and proof ─────────────

type OfferField = "name" | keyof Omit<OfferBrief, "kind">
const OFFER_ROWS: { k: Exclude<OfferField, "name">; multiline: boolean; optional?: boolean }[] = [
  { k: "what", multiline: true }, { k: "promise", multiline: true }, { k: "offerAndPrice", multiline: false }, { k: "cta", multiline: false },
  { k: "audience", multiline: true }, { k: "pains", multiline: true }, { k: "proof", multiline: true }, { k: "notes", multiline: true, optional: true },
]

export function OfferMoment({ ctx, active }: { ctx: EddyCtx; active: boolean }) {
  const t = useTranslations("eddyOnboarding.offer")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const { ws, offer, canEdit, saveWs, confirm } = ctx
  const editable = active && canEdit

  const put = (o: Offer) => {
    qc.setQueryData(["offer", o.id], o)
    qc.setQueryData<ApiResult<Offer[], PageMeta>>(["offers"], (r) => (r ? { ...r, data: r.data.some((x) => x.id === o.id) ? r.data.map((x) => (x.id === o.id ? o : x)) : [o, ...r.data] } : r))
    void qc.invalidateQueries({ queryKey: ["offers"] })
  }
  const saveField = async (k: OfferField, v: string) => {
    if (offer) return put(await api.offers.update(offer.id, k === "name" ? { name: v || offer.name } : { [k]: v || null }))
    // no offer yet (no site, or the reading found none): the first saved field creates it
    const created = await api.offers.create({
      name: k === "name" && v ? v : ws.name, language: ws.uiLocale === "PT_BR" ? "pt-BR" : "en", ...(k === "name" ? {} : { [k]: v || null }),
    })
    return put(created)
  }
  const done = useMutation({
    mutationFn: async () => {
      if (!ws.onboarding.completedAt) await saveWs({ onboardingStep: 4 })
    },
    onSuccess: () => confirm("offer"),
  })
  const noProof = !offer?.proof?.trim()
  const src = offer?.sourceUrl ? hostOf(offer.sourceUrl) : null

  return (
    <>
      {ctx.local.confirmed.includes("business") || ws.onboarding.step >= 2 ? <MeBubble>{t("meLooksRight")}</MeBubble> : null}
      <EddyMsg>
        <Say>{offer ? t("say") : t("sayEmpty")}</Say>
        <ChatCard>
          <CardHead title={offer?.name ?? t("newTitle")} tag={src ? t("from", { src }) : null} />
          <div>
            {!offer || editable ? <EditRow label={t("name")} value={offer?.name} emptyText={t("missing")} emptyWarn editable={editable} maxLength={120} onSave={(v) => saveField("name", v)} /> : null}
            {OFFER_ROWS.map((r) => (
              <EditRow
                key={r.k}
                label={t(`f.${r.k}`)}
                value={offer?.[r.k]}
                emptyText={r.k === "proof" ? t("noProof") : r.optional ? t("optional") : t("missing")}
                emptyWarn={!r.optional}
                multiline={r.multiline}
                editable={editable}
                maxLength={2000}
                onSave={(v) => saveField(r.k, v)}
              />
            ))}
          </div>
          <CardFoot hint={active ? (!offer ? t("needsOffer") : noProof ? t("proofLater") : null) : null}>
            {active ? (
              <Button variant="brand" onClick={() => done.mutate()} disabled={!canEdit || !offer || done.isPending} aria-busy={done.isPending}>
                {t("confirm")}
              </Button>
            ) : (
              <Confirmed>{noProof ? t("confirmedNoProof") : t("confirmed")}</Confirmed>
            )}
          </CardFoot>
        </ChatCard>
        {done.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(done.error)}</span> : null}
      </EddyMsg>
    </>
  )
}

// ───────────── Meta ─────────────

/** The active moment mounts the real MetaConnect (OAuth comes back to /onboarding/meta, which renders this conversation). */
export function MetaMomentActive({ ctx }: { ctx: EddyCtx }) {
  const t = useTranslations("eddyOnboarding.meta")
  const tm = useTranslations("meta")
  const errorMessage = useErrorMessage()
  const m = useMetaConnect("/onboarding/meta")
  const { state } = m
  const finish = useMutation({
    mutationFn: async (skipped: boolean) => {
      if (!ctx.ws.onboarding.completedAt) await ctx.saveWs({ onboardingStep: 5 })
      return skipped
    },
    onSuccess: (skipped) => ctx.confirm("meta", { metaSkipped: skipped }),
  })
  const connected = state === "ok" || state === "warning"
  return (
    <>
      <MeBubble>{t("meOffer")}</MeBubble>
      <EddyMsg>
        <Say>{t("say")}</Say>
        {state === "off" ? <Say>{t("off")}</Say> : <MetaConnect m={m} mode="onboarding" clientName={ctx.ws.name} />}
        <div className="flex flex-wrap items-center gap-2">
          {state === "choose" ? (
            <Button variant="brand" onClick={m.use} disabled={!m.canUse || !ctx.canEdit}>
              {tm("useAccount")}
              <Icon name="arrowr" />
            </Button>
          ) : null}
          {connected || state === "off" ? (
            <Button variant="brand" onClick={() => finish.mutate(state === "off")} disabled={finish.isPending}>
              {t("continue")}
              <Icon name="arrowr" />
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => finish.mutate(true)} disabled={finish.isPending || state === "connecting" || state === "checking"}>
              {t("skip")}
            </Button>
          )}
          {state === "choose" && m.selectError ? <span role="alert" className="text-xs text-status-failed">{errorMessage(m.selectError)}</span> : null}
        </div>
        {finish.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(finish.error)}</span> : null}
      </EddyMsg>
    </>
  )
}

export function MetaMomentPast({ ctx }: { ctx: EddyCtx }) {
  const t = useTranslations("eddyOnboarding.meta")
  const conn = useMetaConnection()
  const ready = metaReady(conn.data)
  return (
    <>
      <MeBubble>{t("meOffer")}</MeBubble>
      <EddyMsg>
        <Say>{t("say")}</Say>
      </EddyMsg>
      {ready ? (
        <>
          <SysLine>{t("loginDone")}</SysLine>
          <EddyMsg>
            <Confirmed>{t("connected", { account: conn.data?.adAccount?.name ?? "" })}</Confirmed>
          </EddyMsg>
        </>
      ) : (
        <>
          <MeBubble>{t("skip")}</MeBubble>
          <EddyMsg>
            <Confirmed>{ctx.local.metaSkipped || !conn.data ? t("skipped") : t("notReady")}</Confirmed>
          </EddyMsg>
        </>
      )}
    </>
  )
}

// ───────────── winner + goals ─────────────

function useWinner() {
  const conn = useMetaConnection()
  const ready = metaReady(conn.data) && metaGateOf(conn.data) === "ready"
  const summary = useQuery({ queryKey: mk.summary("30d"), queryFn: ({ signal }) => api.meta.summary({ period: "30d" }, { signal }), enabled: ready })
  const winner = useQuery({ queryKey: mk.ads({ verdict: "WINNER", limit: 1 }), queryFn: ({ signal }) => api.meta.ads({ verdict: "WINNER", limit: 1 }, { signal }), enabled: ready })
  return { ready, summary, winner: winner.data?.data[0] ?? null, winnerPending: ready && winner.isPending }
}

const num = (s: string): number | null => {
  const v = s.trim().replace(/[^\d.,]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "")
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export function GoalsMoment({ ctx, active }: { ctx: EddyCtx; active: boolean }) {
  const t = useTranslations("eddyOnboarding.goals")
  const errorMessage = useErrorMessage()
  const { ws, canEdit, saveWs, confirm } = ctx
  const { ready, summary, winner, winnerPending } = useWinner()
  const s = summary.data
  const currency = ws.targetCpa?.currency ?? s?.currency ?? "USD"
  const money = useMoney(currency)
  const wCpa = winner?.metrics.cpa ?? null
  const med = s?.medianCpa ?? null
  const base = [wCpa, med].filter((v): v is number => v != null)
  const suggested = base.length ? { min: Math.floor(Math.min(...base) * 0.9), max: Math.ceil(Math.max(...base) * 1.07) } : null
  // null = untouched: shows what's saved, else Eddy's suggestion
  const [minS, setMin] = useState<string | null>(null)
  const [maxS, setMax] = useState<string | null>(null)
  const [capS, setCap] = useState<string | null>(null)
  const minV = minS ?? (ws.targetCpa ? String(ws.targetCpa.min) : suggested ? String(suggested.min) : "")
  const maxV = maxS ?? (ws.targetCpa ? String(ws.targetCpa.max) : suggested ? String(suggested.max) : "")
  const capV = capS ?? (ws.monthlySpendCapUsd != null ? String(ws.monthlySpendCapUsd) : "")
  const lo = num(minV), hi = num(maxV), cap = num(capV)
  const cpa: TargetCpa | null | "invalid" =
    lo === null && hi === null ? null : lo === null || hi === null || Number.isNaN(lo) || Number.isNaN(hi) || lo <= 0 || lo > hi ? "invalid" : { min: lo, max: hi, currency }
  const capOk = cap === null || (!Number.isNaN(cap) && cap >= 0)
  const valid = cpa !== "invalid" && capOk

  const save = useMutation({
    mutationFn: async () => {
      if (cpa === "invalid") return
      const body: UpdateWorkspaceBody = {}
      if (JSON.stringify(cpa) !== JSON.stringify(ws.targetCpa ?? null)) body.targetCpa = cpa
      if (cap !== ws.monthlySpendCapUsd) body.monthlySpendCapUsd = cap
      if (Object.keys(body).length) await saveWs(body)
    },
    onSuccess: () => confirm("goals"),
  })

  const summaryText = ws.targetCpa || ws.monthlySpendCapUsd != null
    ? [ws.targetCpa ? t("doneCpa", { min: money(ws.targetCpa.min, 0), max: money(ws.targetCpa.max, 0) }) : null, ws.monthlySpendCapUsd != null ? t("doneCap", { cap: money(ws.monthlySpendCapUsd, 0) }) : null].filter(Boolean).join(" · ")
    : t("skipped")
  const field = "w-20 font-mono tablet:w-24"

  return (
    <EddyMsg busy={winnerPending}>
      {ready ? (
        winnerPending ? (
          <span className="sk h-[72px] rounded-lg" />
        ) : winner ? (
          <>
            <Say>{t("winnerSay", { n: s?.adsCount ?? 0 })}</Say>
            <ChatCard className="flex items-center gap-3 px-4 py-3">
              {winner.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Meta CDN thumbnail
                <img src={winner.thumbnailUrl} alt="" className="aspect-[9/16] w-9 flex-none rounded-[7px] object-cover" />
              ) : (
                <span aria-hidden="true" className="aspect-[9/16] w-9 flex-none rounded-[7px] bg-[linear-gradient(165deg,#6b6450,#1d1f1a)]" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate">{winner.name}</b>
                <span className="text-xs text-fg-3">
                  {[wCpa != null ? t("perResult", { v: money(wCpa) }) : null, med != null ? t("median", { v: money(med) }) : null, winner.daysRunning != null ? t("days", { n: winner.daysRunning }) : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="inline-flex h-[22px] flex-none items-center gap-1.5 rounded-full bg-ok-bg px-2 text-[11.5px] font-bold text-ok">
                <i aria-hidden="true" className="size-[7px] rounded-full bg-current" />
                {t("winner")}
              </span>
            </ChatCard>
          </>
        ) : (
          <Say>{t("noWinner", { n: s?.adsCount ?? 0 })}</Say>
        )
      ) : null}
      <Say>
        {t.rich("ask", { b })} {suggested ? t("suggest", { min: money(suggested.min, 0), max: money(suggested.max, 0) }) : null} {t("askCap")}
      </Say>
      <ChatCard>
        <fieldset disabled={!active || !canEdit} className="m-0 flex flex-wrap items-center gap-2 border-0 px-4 py-3">
          <legend className="sr-only">{t("legend")}</legend>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-fg-3">{t("target", { currency })}</span>
            <Input aria-label={t("min")} inputMode="decimal" className={field} value={minV} onChange={(e) => setMin(e.target.value)} aria-invalid={cpa === "invalid"} placeholder="10" />
            <span>{t("to")}</span>
            <Input aria-label={t("max")} inputMode="decimal" className={field} value={maxV} onChange={(e) => setMax(e.target.value)} aria-invalid={cpa === "invalid"} placeholder="14" />
          </span>
          <span className="flex flex-wrap items-center gap-2 tablet:ml-2">
            <span className="text-[13px] text-fg-3">{t("cap")}</span>
            <Input aria-label={t("capLabel")} inputMode="decimal" className="w-[110px] font-mono" value={capV} onChange={(e) => setCap(e.target.value)} aria-invalid={!capOk} placeholder="9000" />
          </span>
        </fieldset>
        <CardFoot hint={active ? (cpa === "invalid" ? t("fixCpa") : !capOk ? t("fixCap") : t("hint")) : null}>
          {active ? (
            <>
              <Button variant="brand" onClick={() => save.mutate()} disabled={!canEdit || !valid || save.isPending} aria-busy={save.isPending}>
                {t("save")}
              </Button>
              <Button variant="ghost" onClick={() => confirm("goals")} disabled={save.isPending}>
                {t("skip")}
              </Button>
            </>
          ) : (
            <Confirmed>{summaryText}</Confirmed>
          )}
        </CardFoot>
      </ChatCard>
      {save.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(save.error)}</span> : null}
    </EddyMsg>
  )
}

// ───────────── brand kit ─────────────

export function KitMoment({ ctx, active }: { ctx: EddyCtx; active: boolean }) {
  const t = useTranslations("eddyOnboarding.kit")
  const errorMessage = useErrorMessage()
  const kit = useQuery({ queryKey: BRAND_KIT_KEY, queryFn: ({ signal }) => api.brandKit.get({ signal }) })
  const finish = useMutation({
    mutationFn: async (skipped: boolean) => {
      if (!ctx.ws.onboarding.completedAt) await ctx.saveWs({ onboardingStep: 6 })
      return skipped
    },
    onSuccess: (skipped) => ctx.confirm("kit", { kitSkipped: skipped }),
  })
  const k = kit.data
  const parts = k ? [k.logo ? t("logo") : null, k.files.length ? t("files", { count: k.files.length }) : null, k.demoVideos.length ? t("videos", { count: k.demoVideos.length }) : null].filter(Boolean) : []
  return (
    <EddyMsg>
      <Say>{t("say")}</Say>
      {/* stays mounted after Done: uploads keep running in the background while the conversation moves on */}
      <BrandKit title={t("title")} aside={t("aside")} className="rounded-lg" />
      {active ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" onClick={() => finish.mutate(false)} disabled={finish.isPending || !ctx.canEdit}>
            {t("done")}
          </Button>
          <Button variant="ghost" onClick={() => finish.mutate(true)} disabled={finish.isPending || !ctx.canEdit}>
            {t("skip")}
          </Button>
          <span className="basis-full text-xs text-fg-3 tablet:basis-auto">{t("background")}</span>
        </div>
      ) : (
        <Confirmed>{parts.length ? parts.join(", ") : t("nothing")}</Confirmed>
      )}
      {finish.error ? <span role="alert" className="text-xs text-status-failed">{errorMessage(finish.error)}</span> : null}
    </EddyMsg>
  )
}

// ───────────── done ─────────────

export function DoneMoment({ ctx }: { ctx: EddyCtx }) {
  const t = useTranslations("eddyOnboarding.done")
  const tb = useTranslations("onboarding.brain")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const router = useRouter()
  const { ws, offers, canEdit } = ctx
  const live = !!ws.onboarding.completedAt
  const { winner } = useWinner()
  const complete = useMutation({
    mutationFn: async () => {
      const w = await api.workspace.completeOnboarding()
      qc.setQueryData(["workspace"], w)
      // the gate reads LIVE from GET /auth/me: refresh it before leaving, or "/" bounces back to the setup
      await qc.refetchQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ["clients"] })
      return w
    },
  })
  const tried = useRef(false)
  const completeMutate = complete.mutate
  useEffect(() => {
    if (!live && canEdit && !tried.current) {
      tried.current = true
      completeMutate()
    }
  }, [live, canEdit, completeMutate])

  const brain = brainCompleteness(ws, offers)
  const known = BRAIN_ITEMS.length - brain.missing.length
  const missing = brain.missing.map((i) => tb(`item.${i}`)).join(", ")
  const gate = isApiError(complete.error) && complete.error.code === "ONBOARDING_INCOMPLETE" ? ((complete.error.details?.missing as string[] | undefined) ?? []) : null
  const start = () => {
    try {
      sessionStorage.setItem(TOUR_STEP_KEY, "0")
    } catch {}
    router.push("/brain")
  }

  return (
    <>
      <MeBubble>{ctx.local.kitSkipped ? t("meSkip") : t("meDone")}</MeBubble>
      <EddyMsg busy={complete.isPending}>
        {complete.isPending || (!live && !complete.isError) ? (
          <ChatCard beam className="flex items-center gap-2.5 px-4 py-3.5" role="status">
            <span className="spin-ring size-3.5" aria-hidden="true" />
            {t("finishing")}
          </ChatCard>
        ) : gate ? (
          <Alert variant="warning">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("incomplete")}</AlertTitle>
              <AlertDescription>{gate.map((m) => tb(`gate.${m === "offer" ? "offer" : "resultType"}`)).join(" ")}</AlertDescription>
            </AlertBody>
            <AlertActions>
              <Button size="sm" onClick={() => complete.mutate()}>
                {t("retry")}
              </Button>
            </AlertActions>
          </Alert>
        ) : complete.isError ? (
          <Alert variant="destructive">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("failed")}</AlertTitle>
              <AlertDescription>{errorMessage(complete.error)}</AlertDescription>
            </AlertBody>
            <AlertActions>
              <Button size="sm" onClick={() => complete.mutate()}>
                <Icon name="refresh" />
                {t("retry")}
              </Button>
            </AlertActions>
          </Alert>
        ) : (
          <>
            <Say>
              {t.rich("ready", { b, name: ws.name })} {t("known", { n: known, total: BRAIN_ITEMS.length })}{" "}
              {brain.missing.length ? t("missing", { items: missing }) : t("allIn")}
            </Say>
            {winner ? <Say>{t("startWinner", { name: winner.name })}</Say> : null}
            <div className="flex flex-wrap gap-2">
              {/* tour-v2 §5: one button; the tour starts on the Brain and its 2nd stop opens Templates pinned on the winner */}
              <Button variant="brand" onClick={start}>
                {t("start")}
                <Icon name="arrowr" />
              </Button>
            </div>
          </>
        )}
      </EddyMsg>
    </>
  )
}
