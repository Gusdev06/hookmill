"use client"

import { useTranslations } from "next-intl"
import type { Workspace } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { MetaConnect, useMetaConnect, WhyConnect } from "@/components/meta/meta-connect"
import { BackLink, OnboardingFrame, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>

/**
 * Step 2 · Connect Meta (onboarding-v2 §3.6, spec decision 7): the real MetaConnect. "Skip for now" (outline) stays until
 * it is connected; the lime Continue only opens when the health check passes (warning = can continue; blocked = no).
 * Continue / Skip = PATCH onboardingStep 3. Hidden by the API with META_MODE=off (the step isn't in `onboarding.steps`).
 */
export function MetaStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("meta")
  const to = useTranslations("onboarding")
  const { move, canEdit } = ctx
  const m = useMetaConnect("/onboarding/meta")
  const { state } = m
  const go = () => move.mutate({ step: ctx.nextStep(2), to: ctx.next(2) })
  const connected = state === "ok" || state === "warning"
  const busy = state === "connecting" || state === "checking"

  const hint =
    state === "connecting" ? t("hint.connecting")
    : state === "choose" ? (m.chosenOption && !m.chosenOption.canManage ? t("hint.noPerm") : t("hint.next4"))
    : state === "ok" ? t("hint.ok")
    : state === "warning" ? t("hint.warn")
    : state === "blocked" ? t("hint.blocked")
    : t("hint.optional")
  const hintWarn = state === "blocked" || (state === "choose" && !!m.chosenOption && !m.chosenOption.canManage)

  const primary =
    state === "choose" ? (
      <Button variant="brand" size="lg" onClick={m.use} disabled={!m.canUse || !canEdit}>
        {t("useAccount")}
        <Icon name="arrowr" />
      </Button>
    ) : (
      <Button variant="brand" size="lg" onClick={go} disabled={!connected || move.isPending || busy}>
        {to("continue")}
        <Icon name="arrowr" />
      </Button>
    )

  return (
    <OnboardingFrame
      slug="meta"
      ws={ws}
      title={t("title")}
      sub={t("sub")}
      error={move.error}
      saving={move.isPending}
      onSaveExit={() => move.mutate({ step: 2, to: ctx.exitTo })}
      hint={hint}
      hintWarn={hintWarn}
      back={<BackLink href={ctx.prev(2)}>{to("back")}</BackLink>}
      secondary={
        connected ? null : (
          <Button variant="outline" size="lg" onClick={go} disabled={move.isPending || busy}>
            {t("skip")}
          </Button>
        )
      }
      primary={primary}
    >
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
          <MetaConnect m={m} mode="onboarding" clientName={ws.name} />
        </div>
        <aside className="flex max-w-full min-w-0 flex-[1_1_280px] flex-col gap-4">
          <WhyConnect />
        </aside>
      </div>
    </OnboardingFrame>
  )
}
