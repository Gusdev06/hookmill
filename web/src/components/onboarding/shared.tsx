"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BrainItem, ClientStatus, Offer, OnboardingStep, OnboardingStepInfo, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { NavIcon } from "@/components/shell/nav-icon"
import { MinimalShell } from "@/components/shell/minimal-shell"
import { useSession } from "@/components/providers/session-provider"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ME_KEY, useAccountMode } from "@/hooks/use-me"
import { cn } from "@/lib/utils"
import { ActionBar } from "./action-bar"
import { SetupProgress } from "./setup-progress"

/*
 * Client onboarding (fase2-agencia §3.3 + onboarding-v2 §3.2-3.3): 6 steps on the ACTIVE workspace (the token), in the
 * minimal shell (no sidebar). `onboardingStep` only says where to resume; it moves both ways and is saved on every
 * Continue / Save and exit. After the onboarding is done the steps stay editable ("Edit setup"), but the step is no longer
 * sent (409 onboarding_completed). The % and the state of each step come from the API (`onboarding.percent` / `steps`);
 * without them (older API) the web derives both from the position.
 */
export const ONBOARDING_SLUGS = ["business", "meta", "offer", "audience", "goals", "brain"] as const
export type OnboardingSlug = (typeof ONBOARDING_SLUGS)[number]

export const stepOf = (slug: OnboardingSlug) => (ONBOARDING_SLUGS.indexOf(slug) + 1) as OnboardingStep
export const onboardingHref = (step: number) => `/onboarding/${ONBOARDING_SLUGS[Math.min(6, Math.max(1, step)) - 1]}`
/** Resume screen after "Save and exit" (spec D4) and the "Setup in progress" screen of MEMBER/CLIENT. */
export const SAVED_HREF = "/onboarding/saved"
export const WAITING_HREF = "/onboarding/waiting"

/** Where a client card leads: setup → the step it stopped at; done (live or paused) → Home. */
export function clientHref(c: { status: ClientStatus; onboarding: { step: number; completedAt: string | null } }) {
  return c.onboarding.completedAt ? "/" : onboardingHref(c.onboarding.step)
}

/** Which step fills each Brain item (step 6 "what's missing" links, Brain "Fill"). */
export const BRAIN_ITEM_STEP: Record<BrainItem, number> = {
  businessType: 1, industry: 1, market: 1,
  offer: 3, what: 3, promise: 3, offerAndPrice: 3, cta: 3, proof: 3,
  audience: 4, pains: 4, notes: 4,
  spendCap: 5,
}

type Ob = Pick<Workspace, "onboarding">
/** The enabled steps (5 with META_MODE=off). Falls back to the 6 positional steps when the API doesn't send `steps`. */
export function stepsOf(ws: Ob): OnboardingStepInfo[] {
  const api = ws.onboarding.steps?.filter((s) => s.enabled)
  if (api?.length) return api
  const cur = ws.onboarding.completedAt ? 7 : ws.onboarding.step
  return ONBOARDING_SLUGS.map((key, i) => ({
    step: (i + 1) as OnboardingStep, key, enabled: true, state: i + 1 < cur ? "done" : i + 1 === cur ? "current" : "todo",
  }))
}
export function percentOf(ws: Ob): number {
  if (typeof ws.onboarding.percent === "number") return ws.onboarding.percent
  if (ws.onboarding.completedAt) return 100
  return Math.round(((ws.onboarding.step - 1) / 6) * 100)
}
/** Next / previous ENABLED step number (skips Connect Meta when it is off). */
export function nextStepOf(ws: Ob, from: number): number {
  const s = stepsOf(ws).map((x) => x.step).find((n) => n > from)
  return s ?? 6
}
export function prevStepOf(ws: Ob, from: number): number {
  const s = [...stepsOf(ws).map((x) => x.step)].reverse().find((n) => n < from)
  return s ?? 1
}
export const isMetaEnabled = (ws: Ob) => stepsOf(ws).some((s) => s.key === "meta")

/** Workspace + offers of the active client, the edit right, where "Save and exit" goes, and the "save + move" action. */
export function useOnboarding() {
  const { session, logout } = useSession()
  const qc = useQueryClient()
  const router = useRouter()
  const mode = useAccountMode()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const canEdit = session.workspace.role === "OWNER" || session.workspace.role === "ADMIN"
  const done = !!ws.data?.onboarding.completedAt
  /** edit mode → Brain · agency in setup → resume screen · own business in setup → log out (there is nowhere else to go) */
  const exitTo: string = done ? "/brain" : mode === "OWN" ? "logout" : SAVED_HREF

  /** PATCH /workspace with the step's fields + where to resume, then go. */
  const move = useMutation({
    mutationFn: async ({ body, step }: { body?: UpdateWorkspaceBody; step: number; to: string }) => {
      const b: UpdateWorkspaceBody = { ...body }
      if (!done && canEdit) b.onboardingStep = Math.min(6, Math.max(1, step)) as OnboardingStep
      if (!canEdit || !Object.keys(b).length) return ws.data ?? null
      return api.workspace.update(b)
    },
    onSuccess: (w, v) => {
      if (w) qc.setQueryData(["workspace"], w)
      qc.invalidateQueries({ queryKey: ["clients"] })
      qc.invalidateQueries({ queryKey: ME_KEY })
      if (v.to === "logout") void logout()
      else router.push(v.to)
    },
  })

  const list: Offer[] = offers.data?.data ?? []
  const next = (from: number) => (ws.data ? onboardingHref(nextStepOf(ws.data, from)) : onboardingHref(from + 1))
  const prev = (from: number) => (ws.data ? onboardingHref(prevStepOf(ws.data, from)) : onboardingHref(from - 1))
  return { ws, offers, list, offer: list[0] ?? null, canEdit, done, move, exitTo, next, prev, nextStep: (from: number) => (ws.data ? nextStepOf(ws.data, from) : from + 1) }
}

/** Minimal shell + progress card + the step's header, body and the Back / (Skip) / Continue bar. */
export function OnboardingFrame({
  slug, ws, title, sub, children, back, secondary, primary, hint, hintWarn, onSaveExit, saving, error,
}: {
  slug: OnboardingSlug
  ws: Workspace
  title: React.ReactNode
  sub?: React.ReactNode
  children: React.ReactNode
  back?: React.ReactNode
  /** e.g. "Skip for now" (outline) */
  secondary?: React.ReactNode
  primary: React.ReactNode
  hint?: React.ReactNode
  /** a validation hint: amber */
  hintWarn?: boolean
  /** saves the step and leaves (resume screen · log out · Brain) */
  onSaveExit: () => void
  saving?: boolean
  error?: unknown
}) {
  const t = useTranslations("onboarding")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const mode = useAccountMode()
  const canEdit = session.workspace.role === "OWNER" || session.workspace.role === "ADMIN"
  const step = stepOf(slug)
  const done = !!ws.onboarding.completedAt
  const steps = stepsOf(ws)
  const pos = Math.max(0, steps.findIndex((s) => s.step === step))
  const exitLabel = done ? t("saveExit") : mode === "OWN" ? tc("logout") : t("saveExit")

  return (
    <MinimalShell
      client={ws.name}
      eyebrow={done ? t("eyebrowEdit") : t("eyebrowShort")}
      right={
        <Button variant="outline" size="sm" onClick={onSaveExit} disabled={saving}>
          <NavIcon name="out" size={16} />
          {exitLabel}
        </Button>
      }
    >
      <SetupProgress steps={steps} current={step} percent={percentOf(ws)} hrefFor={onboardingHref} allClickable={done} />

      <section aria-labelledby="ob-title" className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t("stepOf", { n: pos + 1, total: steps.length })}</span>
          <h1 id="ob-title" className="text-pretty">{title}</h1>
          {sub ? <p className="m-0 max-w-[640px] text-fg-3 text-pretty">{sub}</p> : null}
        </div>
        {!canEdit ? (
          <Alert>
            <Icon name="lock" />
            <AlertBody>
              <AlertDescription>{t("readOnly")}</AlertDescription>
            </AlertBody>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("saveFailed")}</AlertTitle>
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </AlertBody>
          </Alert>
        ) : null}
        {children}
        <ActionBar hint={hint} hintWarn={hintWarn} back={back} secondary={secondary} primary={primary} />
      </section>
    </MinimalShell>
  )
}

/** Light card with an h2 (mockup cards: 16 px radius, 20 px padding). */
export function Card({ title, aside, children, className, id }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("flex min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5", className)}>
      {title || aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-base font-bold">{title}</h2> : null}
          {aside ? <span className="text-[13px] text-fg-3">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonVariants({ variant: "outline" })}>
      <Icon name="left" />
      {children}
    </Link>
  )
}

/** Loading (skeleton in the same footprint) and error states of the whole step. */
export function OnboardingLoading() {
  return (
    <MinimalShell right={null}>
      <div role="status" aria-busy="true" className="flex flex-col gap-5">
        <span className="sk h-[92px] rounded-xl" />
        <span className="sk h-3 w-24" />
        <span className="sk h-8 w-3/5" />
        <span className="sk h-4 w-4/5" />
        <span className="sk h-[180px] rounded-xl" />
        <span className="sk h-[240px] rounded-xl" />
      </div>
    </MinimalShell>
  )
}

export function OnboardingError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  return (
    <MinimalShell>
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("onboarding.loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={retry}>
            <Icon name="refresh" />
            {t("common.retry")}
          </Button>
        </AlertActions>
      </Alert>
    </MinimalShell>
  )
}
