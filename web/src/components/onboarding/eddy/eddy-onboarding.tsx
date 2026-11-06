"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { Job, Offer, OfferBrief, OfferExtractOutput, UpdateOfferBody, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertBody, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { NavIcon } from "@/components/shell/nav-icon"
import { LogoMark } from "@/components/shell/logo"
import { hostOf } from "@/components/offer-extract"
import { BRAND_KIT_KEY } from "@/components/brand/brand-kit"
import { ME_KEY, useAccountMode } from "@/hooks/use-me"
import { useMetaConnection } from "@/hooks/use-meta"
import { isMetaEnabled, OnboardingError, OnboardingLoading, useOnboarding } from "../shared"
import { BrainPanel, BrainStrip } from "./eddy-panel"
import { useEddyLocal, type EddyConfirm, type EddyLocal } from "./eddy-store"
import {
  BusinessMoment, DEFAULT_NAMES, DoneMoment, GoalsMoment, KitMoment, MetaMomentActive, MetaMomentPast, OfferMoment, ReadingMoment, SiteMoment, type EddyCtx,
} from "./eddy-moments"

/*
 * Onboarding with Eddy (design/onboarding-eddy-2026-10-31.md + mockup-onboarding-eddy.html), behind
 * NEXT_PUBLIC_ONBOARDING_EDDY. A guided conversation, not a free chat: each Eddy message holds the one action of that
 * moment. The transcript is DERIVED from the workspace, the offer, the Meta connection, `onboardingStep` and
 * `ws.onboarding.confirmed` (lacunas-home-eddy-v1 §1; written with PATCH /workspace { confirm }) — reload, the Meta
 * redirect, "Save and exit" or another device land on the same point. The localStorage (eddy-store) is only a fallback
 * (an older API without the field, or a PATCH that failed) plus the reading job still running.
 * Order: site → reading → business → offer/audience/proof → Meta → winner + target CPA + cap → brand kit → done.
 * `onboardingStep` written on the way (the 6 wizard steps): business 3 · offer 4 · Meta 5 · kit 6, then complete.
 */
type Moment = "site" | "reading" | "business" | "offer" | "meta" | "goals" | "kit" | "done"

const BRIEF_KEYS: (keyof OfferBrief)[] = ["what", "promise", "offerAndPrice", "proof", "cta", "audience", "pains"]
const TERMINAL: Job["status"][] = ["SUCCEEDED", "PARTIAL", "FAILED"]
const looksLikeUrl = (s: string) => !/\s/.test(s.trim()) && /\.[a-z]{2,}/i.test(s.trim())
const normalizeUrl = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`)

export function EddyOnboarding() {
  const ctx = useOnboarding()
  const failed = [ctx.ws, ctx.offers].find((q) => q.isError && !q.data)
  if (failed) return <OnboardingError error={failed.error} retry={() => [ctx.ws, ctx.offers].forEach((q) => q.refetch())} />
  if (!ctx.ws.data || !ctx.offers.data) return <OnboardingLoading />
  return <EddyChat key={ctx.ws.data.id} ws={ctx.ws.data} offers={ctx.list} canEdit={ctx.canEdit} onSaveExit={() => ctx.move.mutate({ step: ctx.ws.data!.onboarding.step, to: ctx.exitTo })} saving={ctx.move.isPending} saveError={ctx.move.error} done={ctx.done} />
}

/**
 * Applies a finished reading: the offer (new → POST with the reading; existing → only its EMPTY fields, like the wizard's
 * step 1) and the workspace's empty business fields (name, industry, market, color, result, short code, site).
 */
async function applyReading(out: OfferExtractOutput, url: string | null, ws: Workspace, current: Offer | null) {
  const brief = Object.fromEntries(BRIEF_KEYS.map((k) => [k, out.brief[k] || null])) as Partial<OfferBrief>
  let offer: Offer
  if (!current) {
    offer = await api.offers.create({
      name: out.name || (url ? hostOf(url) : ws.name), language: out.language, ...(url ? { sourceUrl: url } : {}), kind: out.brief.kind ?? null, notes: null, ...brief,
      fieldSources: out.fieldSources, readMeta: out.readMeta,
    })
  } else {
    const patch: UpdateOfferBody = {}
    for (const k of BRIEF_KEYS) if (!current[k]?.trim() && brief[k]) patch[k] = brief[k]
    const filled = BRIEF_KEYS.filter((k) => patch[k] !== undefined)
    if (filled.length) patch.fieldSources = Object.fromEntries(filled.map((k) => [k, "page" as const]))
    if (url && !current.sourceUrl) patch.sourceUrl = url
    if (out.readMeta) patch.readMeta = out.readMeta
    offer = Object.keys(patch).length ? await api.offers.update(current.id, patch) : current
  }
  const s = out.business
  const body: UpdateWorkspaceBody = {}
  if (url && !ws.websiteUrl) body.websiteUrl = url
  if (DEFAULT_NAMES.has(ws.name.trim()) && out.name) body.name = out.name.slice(0, 80)
  if (!ws.industry && s?.industry) body.industry = s.industry
  if (!ws.market && s?.market) body.market = s.market
  if (!ws.brandColor && s?.brandColor) body.brandColor = s.brandColor
  if (!ws.resultType && s?.resultType && s.resultType !== "OTHER") body.resultType = s.resultType
  if (!ws.onboarding.completedAt && s?.shortCode && /^[A-Z0-9]{2,6}$/.test(s.shortCode)) body.shortCode = s.shortCode
  const w = Object.keys(body).length ? await api.workspace.update(body) : null
  return { offer, ws: w }
}

function EddyChat({ ws, offers, canEdit, onSaveExit, saving, saveError, done }: {
  ws: Workspace; offers: Offer[]; canEdit: boolean; onSaveExit: () => void; saving: boolean; saveError: unknown; done: boolean
}) {
  const t = useTranslations("eddyOnboarding")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const mode = useAccountMode()
  const { local: stored, update, confirm: confirmLocal } = useEddyLocal(ws.id)
  const offer = offers[0] ?? null
  const metaOn = isMetaEnabled(ws)
  const conn = useMetaConnection(metaOn)
  const kit = useQuery({ queryKey: BRAND_KIT_KEY, queryFn: ({ signal }) => api.brandKit.get({ signal }) })

  // ── what the person confirmed: the API is the source (any device); the local memory only fills in (fallback)
  const fromApi = ws.onboarding.confirmed
  const mergedConfirmed: EddyConfirm[] = [...(fromApi ?? []), ...stored.confirmed.filter((c) => !fromApi?.includes(c))]
  const metaStep = ws.onboarding.steps.find((x) => x.key === "meta")
  const kitEmpty = !!kit.data && !kit.data.logo && !kit.data.files.length && !kit.data.demoVideos.length
  const local: EddyLocal = {
    ...stored,
    confirmed: mergedConfirmed,
    // "Meta skipped" / "kit skipped" are derived from the API (confirmed + not connected / empty kit); local wins on this device
    metaSkipped: stored.metaSkipped ?? (mergedConfirmed.includes("meta") && metaStep?.state !== "done"),
    kitSkipped: stored.kitSkipped ?? (mergedConfirmed.includes("kit") && kitEmpty),
  }
  const confirm = (c: EddyConfirm, extra: Partial<EddyLocal> = {}) => {
    confirmLocal(c, extra)
    if (!canEdit || fromApi?.includes(c)) return
    api.workspace
      .update({ confirm: c })
      .then((w) => qc.setQueryData(["workspace"], w))
      .catch(() => {}) // the local memory keeps the answer on this device; the next confirm retries
  }

  const saveWs = async (b: UpdateWorkspaceBody) => {
    const w = await api.workspace.update(b)
    qc.setQueryData(["workspace"], w)
    void qc.invalidateQueries({ queryKey: ME_KEY })
    void qc.invalidateQueries({ queryKey: ["clients"] })
    return w
  }

  // ── the reading: job id kept in localStorage, so leaving and coming back keeps polling the same job
  const [lastInput, setLastInput] = useState<{ url: string | null; text: string | null; said: string } | null>(null)
  const start = useMutation({
    mutationFn: (i: { url: string | null; text: string | null; said: string }) => api.offers.extract(i.url ? { url: i.url } : { pageText: i.text ?? "" }),
    onMutate: (i) => setLastInput(i),
    onSuccess: (job, i) => update((s): EddyLocal => ({ ...s, manual: false, read: { jobId: job.id, url: i.url, said: i.said } })),
  })
  const pendingJob = local.read && !local.read.applied ? local.read.jobId : null
  const job = useQuery({
    queryKey: ["job", pendingJob],
    queryFn: () => api.jobs.get(pendingJob!),
    enabled: !!pendingJob,
    retry: 1,
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 1500),
  })
  const apply = useMutation({
    mutationFn: ({ out, url }: { out: OfferExtractOutput; url: string | null }) => applyReading(out, url, ws, offer),
    onSuccess: (r) => {
      if (r.ws) qc.setQueryData(["workspace"], r.ws)
      qc.setQueryData(["offer", r.offer.id], r.offer)
      void qc.invalidateQueries({ queryKey: ["offers"] })
      void qc.invalidateQueries({ queryKey: ME_KEY })
      update((s) => (s.read ? { ...s, read: { ...s.read, applied: true } } : s))
    },
  })
  const applied = useRef<string | null>(null)
  const j = job.data
  const applyMutate = apply.mutate
  useEffect(() => {
    if (!pendingJob || !j || j.id !== pendingJob || applied.current === pendingJob) return
    if (j.status !== "SUCCEEDED" && j.status !== "PARTIAL") return
    applied.current = pendingJob
    if (!canEdit) return update((s) => (s.read ? { ...s, read: { ...s.read, applied: true } } : s))
    applyMutate({ out: j.output as OfferExtractOutput, url: local.read?.url ?? null })
  }, [pendingJob, j, canEdit, applyMutate, update, local.read?.url])
  // lacunas-home-eddy-v1 §2: logo + 2nd color from the finished reading (same job, read once more after it's applied)
  const readJobId = local.read?.jobId ?? null
  const readDone = useQuery({ queryKey: ["job", readJobId], queryFn: () => api.jobs.get(readJobId!), enabled: !!readJobId && !pendingJob, staleTime: Infinity, retry: 1 })
  const siteBrand = ((readDone.data ?? j)?.output as OfferExtractOutput | undefined)?.business
  const site = siteBrand ? { logoUrl: siteBrand.logoUrl ?? null, secondaryColor: siteBrand.secondaryColor ?? null } : null
  const readFailed = j?.status === "FAILED" ? (j.failReason ?? t("reading.failed")) : (job.error ?? apply.error ?? null)

  const read = (raw: string, asText = false) => {
    const v = raw.trim()
    if (!v) return
    if (!asText && looksLikeUrl(v)) start.mutate({ url: normalizeUrl(v), text: null, said: v })
    else start.mutate({ url: null, text: v, said: v })
  }
  const retryRead = () => {
    applied.current = null
    const r = local.read
    const i = lastInput ?? (r ? { url: r.url, text: r.url ? null : r.said, said: r.said } : null)
    if (i) start.mutate(i)
  }

  // ── where the conversation is (derived)
  const confirmed = new Set<EddyConfirm>(local.confirmed)
  const step = ws.onboarding.step
  const businessDone = confirmed.has("business") || step >= 2
  const offerDone = confirmed.has("offer") || step >= 4
  const metaDone = !metaOn || confirmed.has("meta") || step >= 5
  const goalsDone = confirmed.has("goals") || step >= 6
  const kitDone = confirmed.has("kit") || !!ws.onboarding.completedAt
  const reading = !!local.read && !local.read.applied
  const siteDone = !!local.read?.applied || !!local.manual || offers.length > 0 || businessDone
  const order: Moment[] = ["site", "reading", "business", "offer", "meta", "goals", "kit", "done"]
  const active: Moment = reading
    ? "reading"
    : !siteDone ? "site" : !businessDone ? "business" : !offerDone ? "offer" : !metaDone ? "meta" : !goalsDone ? "goals" : !kitDone ? "kit" : "done"
  const shown = order.slice(0, order.indexOf(active) + 1).filter((m) => (m === "reading" ? !!local.read : m === "meta" ? metaOn : true))
  // the panel marks the reading's fields "read, waiting for you" until each card is confirmed
  if (businessDone) confirmed.add("business")
  if (offerDone) confirmed.add("offer")
  if (goalsDone) confirmed.add("goals")

  const ectx: EddyCtx = { ws, offers, offer, canEdit, local, confirm, update, saveWs }
  const panelInput = { ws, offers, confirmed, reading: reading && !readFailed, kit: kit.data, conn: conn.data, site }

  // ── composer: answers only the current question (the site, or a description of the business)
  const [say, setSay] = useState("")
  const [describe, setDescribe] = useState(false)
  const sayRef = useRef<HTMLInputElement>(null)
  const composerOn = active === "site" && canEdit
  const tooShort = describe && !looksLikeUrl(say) && say.trim().length > 0 && say.trim().length < 20

  // keep the newest message in view: on each new moment, and while content grows (reading done, finishing) as long as
  // the person hasn't scrolled up to read something
  const thread = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
  }, [active, shown.length])
  useEffect(() => {
    const el = thread.current, box = inner.current
    if (!el || !box) return
    let last = box.offsetHeight
    const ro = new ResizeObserver(() => {
      const grew = box.offsetHeight - last
      last = box.offsetHeight
      if (grew > 0 && el.scrollHeight - el.scrollTop - el.clientHeight - grew < 160) el.scrollTop = el.scrollHeight
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const exitLabel = !done && mode === "OWN" ? tc("logout") : t("saveExit")
  const named = !DEFAULT_NAMES.has(ws.name.trim())

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex min-h-14 flex-none items-center gap-2.5 border-b border-line bg-card px-4 py-2 pt-[calc(8px+env(safe-area-inset-top,0px))]">
        <LogoMark className="size-7" />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate text-[13.5px]">{named ? t("top.title", { name: ws.name }) : t("top.titleNew")}</b>
          <span className="truncate text-xs text-fg-3">{t("top.sub")}</span>
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onSaveExit} disabled={saving} aria-label={exitLabel}>
          <span className="hidden tablet:inline">{exitLabel}</span>
          <NavIcon name="out" size={16} />
        </Button>
      </header>
      <BrainStrip input={panelInput} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] desktop:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div ref={thread} className="relative flex-1 overflow-y-auto px-4 pt-4 pb-2 tablet:px-6 tablet:pt-6 tablet:pb-3" aria-live="polite">
            <div ref={inner} className="mx-auto flex max-w-[680px] flex-col gap-[18px]">
              {!canEdit ? (
                <Alert>
                  <Icon name="lock" />
                  <AlertBody>
                    <AlertDescription>{t("readOnly")}</AlertDescription>
                  </AlertBody>
                </Alert>
              ) : null}
              {saveError ? (
                <Alert variant="destructive">
                  <Icon name="alert" />
                  <AlertBody>
                    <AlertDescription>{t("exitFailed")}</AlertDescription>
                  </AlertBody>
                </Alert>
              ) : null}
              {shown.map((m) => {
                const a = m === active
                switch (m) {
                  case "site":
                    return (
                      <SiteMoment
                        key={m}
                        ctx={ectx}
                        active={a}
                        onRead={(v) => read(v)}
                        onDescribe={() => {
                          setDescribe(true)
                          sayRef.current?.focus()
                        }}
                        pending={start.isPending}
                        error={a ? start.error : null}
                      />
                    )
                  case "reading":
                    return (
                      <ReadingMoment
                        key={m}
                        ctx={ectx}
                        active={a}
                        job={j ?? null}
                        applying={apply.isPending}
                        failed={a ? readFailed : null}
                        onRetry={retryRead}
                        onManual={() => update((s) => ({ ...s, read: null, manual: true }))}
                      />
                    )
                  case "business":
                    return <BusinessMoment key={m} ctx={ectx} active={a} />
                  case "offer":
                    return <OfferMoment key={m} ctx={ectx} active={a} />
                  case "meta":
                    return a ? <MetaMomentActive key={m} ctx={ectx} /> : <MetaMomentPast key={m} ctx={ectx} />
                  case "goals":
                    return <GoalsMoment key={m} ctx={ectx} active={a} />
                  case "kit":
                    return <KitMoment key={m} ctx={ectx} active={a} />
                  case "done":
                    return <DoneMoment key={m} ctx={ectx} />
                }
              })}
            </div>
          </div>
          <div className="flex-none border-t border-line bg-bg px-3 pt-2 pb-[calc(12px+env(safe-area-inset-bottom,0px))] tablet:px-6 tablet:pt-2.5 tablet:pb-4">
            <form
              className="mx-auto flex max-w-[680px] items-center gap-2 rounded-[14px] border border-line-strong bg-card p-1.5 focus-within:border-fg"
              onSubmit={(e) => {
                e.preventDefault()
                if (!composerOn || tooShort || !say.trim()) return
                read(say, describe && !looksLikeUrl(say))
                setSay("")
              }}
            >
              <input
                ref={sayRef}
                value={say}
                onChange={(e) => setSay(e.target.value)}
                disabled={!composerOn || start.isPending}
                placeholder={composerOn ? (describe ? t("composer.describe") : t("composer.site")) : t("composer.off")}
                aria-label={t("composer.label")}
                autoComplete="off"
                className="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-2 outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                aria-label={t("composer.send")}
                disabled={!composerOn || !say.trim() || tooShort || start.isPending}
                className="grid size-10 flex-none place-items-center rounded-md bg-fg text-white disabled:opacity-40"
              >
                <span aria-hidden="true">↑</span>
              </button>
            </form>
            <p className="mx-auto mt-1.5 mb-0 max-w-[680px] text-[11.5px] text-fg-3">{tooShort ? t("composer.tooShort") : t("composer.note")}</p>
          </div>
        </div>
        <BrainPanel input={panelInput} />
      </div>
    </div>
  )
}
