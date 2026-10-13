"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import type { BrainItem, ClientStatus, Offer, OnboardingStep, UpdateWorkspaceBody, Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ClientAvatar } from "@/components/shell/logo"
import { useSession } from "@/components/providers/session-provider"
import { WizardRail } from "@/components/wizard-rail"
import { useErrorMessage } from "@/hooks/use-error-message"
import { cn } from "@/lib/utils"

/*
 * Client onboarding (fase2-agencia §3.3, plano fase 2 "Onboarding"): 6 steps on the ACTIVE workspace (the token).
 * `onboardingStep` only says where to resume; it moves both ways and is saved on every Continue / Save and exit.
 * After the onboarding is done the steps stay editable, but the step is no longer sent (409 onboarding_completed).
 */
export const ONBOARDING_SLUGS = ["business", "meta", "offer", "audience", "goals", "brain"] as const
export type OnboardingSlug = (typeof ONBOARDING_SLUGS)[number]

export const stepOf = (slug: OnboardingSlug) => (ONBOARDING_SLUGS.indexOf(slug) + 1) as OnboardingStep
export const onboardingHref = (step: number) => `/onboarding/${ONBOARDING_SLUGS[Math.min(6, Math.max(1, step)) - 1]}`

/** Where a client card leads: setup → the step it stopped at; done (live or paused) → Home. */
export function clientHref(c: { status: ClientStatus; onboarding: { step: number; completedAt: string | null } }) {
  return c.onboarding.completedAt ? "/" : onboardingHref(c.onboarding.step)
}

/** Which step fills each Brain item (step 6 "what's missing" links). */
export const BRAIN_ITEM_STEP: Record<BrainItem, number> = {
  businessType: 1, industry: 1, market: 1,
  offer: 3, what: 3, promise: 3, offerAndPrice: 3, cta: 3, proof: 3,
  audience: 4, pains: 4, notes: 4,
  spendCap: 5,
}

/** Workspace + offers of the active client, the edit right, and the "save + move" action. */
export function useOnboarding() {
  const { session } = useSession()
  const qc = useQueryClient()
  const router = useRouter()
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace.get })
  const offers = useQuery({ queryKey: ["offers"], queryFn: () => api.offers.list() })
  const canEdit = session.workspace.role === "OWNER" || session.workspace.role === "ADMIN"
  const done = !!ws.data?.onboarding.completedAt

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
      router.push(v.to)
    },
  })

  const list: Offer[] = offers.data?.data ?? []
  return { ws, offers, list, offer: list[0] ?? null, canEdit, done, move }
}

type RailKey = "business" | "meta" | "offer" | "audience" | "goals" | "brain"

/** Rail (desktop) / compact progress (phone) + the step's header, body and the Back / Continue bar. */
export function OnboardingFrame({
  slug, ws, title, sub, children, back, primary, hint, hintWarn, onSaveExit, saving, error,
}: {
  slug: OnboardingSlug
  ws: Workspace
  title: React.ReactNode
  sub?: React.ReactNode
  children: React.ReactNode
  back?: React.ReactNode
  primary: React.ReactNode
  hint?: React.ReactNode
  /** a validation hint: also shown on the phone (the plain "saved" hint is desktop only) */
  hintWarn?: boolean
  /** saves the step and goes back to Clients */
  onSaveExit: () => void
  saving?: boolean
  error?: unknown
}) {
  const t = useTranslations("onboarding")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const canEdit = session.workspace.role === "OWNER" || session.workspace.role === "ADMIN"
  const step = stepOf(slug)
  const reached = ws.onboarding.completedAt ? 6 : Math.max(ws.onboarding.step, step)
  const steps = ONBOARDING_SLUGS.map((k, i) => ({
    title: t(`rail.${k as RailKey}.title`),
    desc: t(`rail.${k as RailKey}.desc`),
    href: i + 1 <= reached ? onboardingHref(i + 1) : undefined,
  }))
  const pct = Math.round(((step - 1) / 6) * 100)
  const eyebrow = ws.onboarding.completedAt ? t("eyebrowEdit") : t("eyebrow")
  const saveExit = (
    <Button variant="outline" size="sm" onClick={onSaveExit} disabled={saving} className="w-full tablet:w-auto">
      {t("saveExit")}
    </Button>
  )

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-[var(--gut)] pt-5 pb-16 tablet:flex-row tablet:items-start tablet:gap-6 tablet:pt-7">
      <WizardRail
        aria-label={t("railLabel")}
        eyebrow={eyebrow}
        name={ws.name}
        steps={steps}
        current={step}
        className="hidden flex-none tablet:sticky tablet:top-7 tablet:flex tablet:w-[280px]"
        footer={
          <>
            <span className="text-[13px] text-fg-3">{t("railFooter")}</span>
            {saveExit}
          </>
        }
      />
      {/* phone: compact progress instead of the 640 px rail */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-card p-4 tablet:hidden">
        <div className="flex items-center gap-2.5">
          <ClientAvatar name={ws.name} className="size-7 text-xs" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="eyebrow">{eyebrow}</span>
            <strong className="truncate">{ws.name}</strong>
          </span>
          <span className="font-mono text-xs text-fg-3">{t("pctDone", { pct })}</span>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {ONBOARDING_SLUGS.map((k, i) => (
            <span key={k} className={cn("h-1.5 flex-1 rounded-full", i + 1 < step ? "bg-brand-edge" : i + 1 === step ? "bg-fg" : "bg-line")} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-[13px] text-fg-2">{t("stepOfNamed", { n: step, title: steps[step - 1].title })}</span>
          <Button variant="ghost" size="sm" onClick={onSaveExit} disabled={saving} className="-mr-2">
            {t("saveExit")}
          </Button>
        </div>
      </div>

      <section aria-labelledby="ob-title" className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t("stepOf", { n: step })}</span>
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
        <div className="sticky bottom-0 z-10 -mx-[var(--gut)] flex flex-col gap-2.5 border-t border-line bg-card px-[var(--gut)] pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] tablet:static tablet:mx-0 tablet:flex-row tablet:flex-wrap tablet:items-center tablet:justify-between tablet:rounded-xl tablet:border tablet:p-3">
          {hint ? <span className={cn("text-[13px] tablet:block tablet:min-w-0 tablet:flex-1", hintWarn ? "text-status-waiting" : "hidden text-fg-3")}>{hint}</span> : null}
          <div className="flex gap-2 tablet:ml-auto [&>*:last-child]:min-w-0 [&>*:last-child]:flex-1 tablet:[&>*:last-child]:flex-none">
            {back}
            {primary}
          </div>
        </div>
      </section>
    </div>
  )
}

/** Light card with an h2 (mockup cards: 16 px radius, 20 px padding). */
export function Card({ title, aside, children, className }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5", className)}>
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
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-[var(--gut)] pt-5 pb-16 tablet:flex-row tablet:gap-6 tablet:pt-7" role="status" aria-busy="true">
      <span className="sk hidden h-[560px] w-[280px] flex-none rounded-xl tablet:block" />
      <span className="sk h-[110px] rounded-xl tablet:hidden" />
      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <span className="sk h-3 w-24" />
        <span className="sk h-8 w-3/5" />
        <span className="sk h-4 w-4/5" />
        <span className="sk h-[180px] rounded-xl" />
        <span className="sk h-[240px] rounded-xl" />
      </div>
    </div>
  )
}

export function OnboardingError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  return (
    <div className="mx-auto max-w-[760px] px-[var(--gut)] pt-7">
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
    </div>
  )
}
