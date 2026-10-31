"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { BrainSection, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { SoonBlock } from "@/components/soon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { BRAIN_SECTIONS, brainCompleteness } from "@/lib/brain"
import { ME_KEY } from "@/hooks/use-me"
import { metaReady, mk, useMetaConnection, useMoney } from "@/hooks/use-meta"
import { metaGateOf } from "@/components/meta/meta-gate"
import { TOUR_STEP_KEY } from "@/components/tour/tour-state"
import { cn } from "@/lib/utils"
import { BackLink, BRAIN_ITEM_STEP, Card, OnboardingFrame, onboardingHref, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>

/** Step 5 · Goals & guardrails: only the monthly spend cap is real (PATCH /workspace). The rest is "Soon". */
export function GoalsStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const { move, canEdit } = ctx
  const [cap, setCap] = useState(ws.monthlySpendCapUsd == null ? "" : String(ws.monthlySpendCapUsd))
  const parsed = cap.trim() === "" ? null : Number(cap.replace(",", "."))
  const capOk = parsed === null || (Number.isFinite(parsed) && parsed >= 0)
  const go = (step: number, to: string) =>
    capOk && move.mutate({ body: canEdit && parsed !== ws.monthlySpendCapUsd ? { monthlySpendCapUsd: parsed } : undefined, step, to })

  return (
    <OnboardingFrame
      slug="goals"
      ws={ws}
      title={t("goals.title")}
      sub={t("goals.sub")}
      error={move.error}
      saving={move.isPending}
      onSaveExit={() => go(5, ctx.exitTo)}
      hint={t("savedAsYouGo")}
      back={<BackLink href={onboardingHref(4)}>{t("back")}</BackLink>}
      primary={
        <Button variant="brand" size="lg" disabled={move.isPending || !capOk} onClick={() => go(6, onboardingHref(6))}>
          {t("goals.continue", { name: ws.name })}
          <Icon name="arrowr" />
        </Button>
      }
    >
      <Card title={t("goals.result")}>
        {/* resultado-v1: the result comes from step 1 ("What counts as a result?"); here it is only shown */}
        {ws.defaultResult ? (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fg bg-fg px-3.5 font-semibold text-white">
              <Icon name="check" />
              {ws.resultType === "OTHER" && ws.resultTypeOther ? ws.resultTypeOther : t(`result.${ws.defaultResult}`)}
            </span>
          </div>
        ) : null}
        <span className="text-xs text-fg-3">
          {ws.defaultResult ? t("goals.resultHint") : t("goals.resultMissing")}{" "}
          <Link href={onboardingHref(1)} className="inline-flex min-h-10 items-center font-semibold underline underline-offset-2 tablet:min-h-0">
            {t("goals.resultEdit")}
          </Link>
        </span>
      </Card>

      <Card title={t("goals.capTitle")}>
        <div className="grid max-w-[360px] gap-1.5">
          <Label htmlFor="ob-cap">{t("goals.cap")}</Label>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="font-mono text-fg-3">
              $
            </span>
            <Input id="ob-cap" inputMode="decimal" value={cap} disabled={!canEdit} aria-invalid={!capOk} onChange={(e) => setCap(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="300" className="font-mono" />
          </div>
          <span className={cn("text-xs", capOk ? "text-fg-3" : "text-status-failed")}>{capOk ? t("goals.capHint") : t("goals.capInvalid")}</span>
        </div>
      </Card>

      <SoonBlock what={t.rich("goals.soonTargets", { b: (c) => <b>{c}</b> })} example>
        <div className="grid gap-3 tablet:grid-cols-2">
          {[
            ["Target cost per purchase", "$28"],
            ["Monthly ad budget", "$12,000"],
            ["Budget for each test round", "$600"],
            ["Daily spend ceiling", "$450"],
          ].map(([l, v]) => (
            <div key={l} className="grid gap-1">
              <span className="text-[13px] font-semibold">{l}</span>
              <span className="rounded-md border border-line-strong bg-card px-3 py-2.5 font-mono">{v}</span>
            </div>
          ))}
        </div>
      </SoonBlock>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px] desktop:grid-cols-2">
        <SoonBlock what={t.rich("goals.soonApprovals", { b: (c) => <b>{c}</b> })} />
        <SoonBlock what={t.rich("goals.soonAutonomy", { b: (c) => <b>{c}</b> })} />
      </div>
    </OnboardingFrame>
  )
}

const SECTION_ORDER: BrainSection[] = ["business_offer", "audience", "proof", "custom_instructions", "goals"]

/**
 * Step 6 · Build the Brain: POST /workspace/onboarding/complete once on arrival (idempotent; 422 ONBOARDING_INCOMPLETE
 * lists what's missing), the Brain v0 summary + % from lib/brain, and the two ways to start. The 90-day Meta read is "Soon".
 */
export function BrainStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const tb = useTranslations("onboarding.brain")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const { canEdit, list } = ctx
  const brain = brainCompleteness(ws, list)

  const complete = useMutation({
    mutationFn: () => api.workspace.completeOnboarding(),
    onSuccess: (w) => {
      qc.setQueryData(["workspace"], w)
      qc.invalidateQueries({ queryKey: ["clients"] })
      // the session's tourCompletedAt / status come from GET /auth/me (onboarding-v2 §3.2)
      qc.invalidateQueries({ queryKey: ME_KEY })
    },
  })
  const router = useRouter()
  const tried = useRef(false)
  const completeMutate = complete.mutate
  const live = !!ws.onboarding.completedAt
  useEffect(() => {
    if (!live && canEdit && !tried.current) {
      tried.current = true
      completeMutate()
    }
  }, [live, canEdit, completeMutate])

  const missingGate = isApiError(complete.error) && complete.error.code === "ONBOARDING_INCOMPLETE" ? ((complete.error.details?.missing as string[] | undefined) ?? []) : null

  return (
    <OnboardingFrame
      slug="brain"
      ws={ws}
      title={live ? tb("titleLive", { name: ws.name }) : tb("title", { name: ws.name })}
      sub={tb("sub")}
      saving={complete.isPending}
      onSaveExit={() => ctx.move.mutate({ step: 6, to: ctx.exitTo })}
      error={ctx.move.error}
      hint={live ? tb("liveHint") : null}
      back={<BackLink href={onboardingHref(5)}>{t("back")}</BackLink>}
      primary={
        <Button
          variant="brand"
          size="lg"
          disabled={!live}
          onClick={() => {
            // the tour starts on the Brain (stop 1); a stale position from an earlier visit is cleared
            try { sessionStorage.setItem(TOUR_STEP_KEY, "0") } catch {}
            router.push("/brain")
          }}
        >
          {tb("startTour")}
          <Icon name="arrowr" />
        </Button>
      }
    >
      {complete.isPending ? (
        <Alert>
          <span className="spin-ring m-0.5 size-3.5" aria-hidden="true" />
          <AlertBody>
            <AlertDescription>{tb("completing")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : live ? (
        <Alert variant="success">
          <Icon name="check" />
          <AlertBody>
            <AlertTitle>{tb("liveTitle", { name: ws.name })}</AlertTitle>
            <AlertDescription>{tb("liveBodyTour")}</AlertDescription>
          </AlertBody>
        </Alert>
      ) : missingGate ? (
        <Alert variant="warning">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{tb("incompleteTitle")}</AlertTitle>
            <AlertDescription>{missingGate.map((m) => tb(`gate.${m === "offer" ? "offer" : "resultType"}`)).join(" ")}</AlertDescription>
          </AlertBody>
          <AlertActions>
            {(missingGate.includes("resultType") || missingGate.includes("businessType")) ? (
              <Link href={onboardingHref(1)} className={buttonVariants({ size: "sm" })}>
                {tb("toStep", { n: 1 })}
              </Link>
            ) : null}
            {missingGate.includes("offer") ? (
              <Link href={onboardingHref(3)} className={buttonVariants({ size: "sm" })}>
                {tb("toStep", { n: 3 })}
              </Link>
            ) : null}
            <Button size="sm" variant="default" onClick={() => complete.mutate()}>
              {tb("tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
      ) : complete.isError ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{tb("completeFailed")}</AlertTitle>
            <AlertDescription>{errorMessage(complete.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => complete.mutate()}>
              <Icon name="refresh" />
              {tb("tryAgain")}
            </Button>
          </AlertActions>
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-[18px] desktop:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={tb("knows")}>
          <ul className="m-0 grid list-none gap-0 p-0">
            {SECTION_ORDER.map((s) => {
              const st = brain.sections[s]
              return (
                <li key={s} className="flex items-start gap-3 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-grid size-6 flex-none place-items-center rounded-full",
                      st === "ok" ? "bg-brand text-[#15171a]" : st === "partial" ? "bg-status-waiting-bg text-status-waiting" : "border-[1.5px] border-control text-fg-3"
                    )}
                  >
                    {st === "ok" ? <Icon name="check" /> : st === "partial" ? <Icon name="minus" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{tb(`section.${s}`)}</span>
                    <span className="text-[13px] text-fg-3">
                      {st === "ok"
                        ? tb("sectionOk")
                        : tb("sectionMissing", {
                            items: BRAIN_SECTIONS[s]
                              .filter((i) => brain.missing.includes(i))
                              .map((i) => tb(`item.${i}`))
                              .join(", "),
                          })}
                    </span>
                  </span>
                  {st !== "ok" ? (
                    <Link
                      href={onboardingHref(BRAIN_ITEM_STEP[BRAIN_SECTIONS[s].find((i) => brain.missing.includes(i)) ?? "offer"])}
                      className={buttonVariants({ size: "sm", variant: "ghost" })}
                    >
                      {tb("fill")}
                    </Link>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{tb("brain")}</span>
              <span className="font-mono text-lg font-semibold">{brain.percent}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-line-soft"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={brain.percent}
              aria-label={tb("brain")}
            >
              <div className="h-full rounded-full bg-brand-edge" style={{ width: `${brain.percent}%` }} />
            </div>
            <span className="text-xs text-fg-3">{brain.missing.length ? tb("missingCount", { count: brain.missing.length }) : tb("allIn")}</span>
          </div>
        </Card>

        <FromMeta />
      </div>

      <Card title={tb("start")}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
          <PathCard href="/iterate/new" eyebrow={tb("path1")} title={tb("iterate")} body={tb("iterateBody")} />
          <PathCard href="/creatives/new" eyebrow={tb("path2")} title={tb("concepts")} body={tb("conceptsBody")} />
        </div>
      </Card>
    </OnboardingFrame>
  )
}

function PathCard({ href, eyebrow, title, body }: { href: string; eyebrow: string; title: string; body: string }) {
  return (
    <Link href={href} className="group flex min-h-11 flex-col gap-1.5 rounded-xl border border-line bg-card p-4 no-underline hover:border-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring">
      <span className="eyebrow">{eyebrow}</span>
      <strong className="flex items-center gap-2 text-base">
        {title}
        <Icon name="arrowr" className="transition-transform group-hover:translate-x-0.5" />
      </strong>
      <span className="text-[13px] text-fg-3">{body}</span>
    </Link>
  )
}

/** The dark panel on the right of step 6: what Meta already read (bridge to the tour). Without a ready connection, the Soon block. */
function FromMeta() {
  const tb = useTranslations("onboarding.brain")
  const conn = useMetaConnection()
  // Gusta 25/10: numbers only with the ad account usable (expired / permission missing = the Soon block, no numbers)
  const ready = metaReady(conn.data) && metaGateOf(conn.data) === "ready"
  const summary = useQuery({ queryKey: mk.summary("30d"), queryFn: ({ signal }) => api.meta.summary({ period: "30d" }, { signal }), enabled: ready })
  const winner = useQuery({ queryKey: mk.ads({ verdict: "WINNER", limit: 1 }), queryFn: ({ signal }) => api.meta.ads({ verdict: "WINNER", limit: 1 }, { signal }), enabled: ready })
  const money = useMoney(summary.data?.currency)
  if (!ready) {
    return (
      <SoonBlock what={tb.rich("soonRead", { b: (c) => <b>{c}</b> })} example>
        <div className="flex flex-col gap-2.5 rounded-xl bg-ink p-4 text-ink-fg-2">
          <span className="font-mono text-[11px] tracking-[0.08em] text-brand uppercase">Best ad</span>
          <span className="text-[13px]">&ldquo;I tried 11 sleep masks&rdquo; costs $19.40 per purchase, 31% under the $28 target.</span>
        </div>
      </SoonBlock>
    )
  }
  const s = summary.data
  const w = winner.data?.data[0] ?? null
  const rows: [string, React.ReactNode][] = [
    [tb("meta.adsRead"), s ? tb("meta.adsReadValue", { total: s.adsCount, active: s.activeAds }) : "…"],
    [tb("meta.bestAd"), w?.metrics.cpa != null ? tb("meta.cpa", { v: money(w.metrics.cpa) }) : "—"],
    [tb("meta.accountAvg"), s?.medianCpa != null ? tb("meta.cpa", { v: money(s.medianCpa) }) : "—"],
  ]
  return (
    <div className="on-ink flex min-w-0 flex-col gap-3.5 rounded-xl bg-ink p-[22px] text-ink-body" aria-busy={summary.isPending}>
      <span className="eyebrow text-ink-fg-2">{tb("meta.eyebrow")}</span>
      <span className="font-mono text-[42px] leading-none font-semibold text-brand tabular-nums tablet:text-[54px]">{s ? s.adsCount : <span className="sk inline-block h-10 w-20" />}</span>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2.5 border-b border-ink-line pb-2.5 last:border-b-0 last:pb-0">
            <span className="text-ink-fg-2">{k}</span>
            <span className="text-right font-semibold text-white">{v}</span>
          </li>
        ))}
      </ul>
      <span className="text-[13px] text-ink-fg-2">{w ? tb("meta.tourStartsWinner") : tb("meta.tourStarts")}</span>
    </div>
  )
}
