"use client"

import { useTranslations } from "next-intl"
import type { Workspace } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { ExampleBadge, SoonBadge, SoonBody } from "@/components/soon"
import { BackLink, OnboardingFrame, onboardingHref, type useOnboarding } from "./shared"

type Ctx = ReturnType<typeof useOnboarding>

/**
 * Step 2 · Connect Meta: whole section "Soon" (fase2-agencia §8, F0 §2.12). One sentence of what it will do and
 * what's missing, "Skip for now" (= PATCH onboardingStep 3), and the faded mockup preview with example data.
 */
export function MetaStep({ ws, ctx }: { ws: Workspace; ctx: Ctx }) {
  const t = useTranslations("onboarding")
  const ts = useTranslations("soon")
  const { move } = ctx
  const skip = () => move.mutate({ step: 3, to: onboardingHref(3) })
  return (
    <OnboardingFrame
      slug="meta"
      ws={ws}
      title={
        <span className="inline-flex flex-wrap items-center gap-2.5">
          {t("meta.title", { name: ws.name })}
          <SoonBadge />
        </span>
      }
      sub={t("meta.sub")}
      error={move.error}
      saving={move.isPending}
      onSaveExit={() => move.mutate({ step: 2, to: "/clients" })}
      hint={t("meta.hint")}
      back={<BackLink href={onboardingHref(1)}>{t("back")}</BackLink>}
      primary={
        <Button variant="brand" size="lg" onClick={skip} disabled={move.isPending}>
          {t("meta.skip")}
          <Icon name="arrowr" />
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-card p-4 tablet:p-[22px]">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5">
          <h2 className="wide text-xl">{t("meta.heading")}</h2>
          <p className="m-0 text-fg-3 text-pretty">{t("meta.promise")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 rounded-xl border border-dashed border-control bg-card-2 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow">{ts("previewOf")}</span>
          <ExampleBadge>{ts("exampleData")}</ExampleBadge>
        </div>
        <SoonBody className="grid grid-cols-[minmax(0,1fr)] gap-3.5 desktop:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
            <h3 className="text-base font-bold">{t("meta.preview.login")}</h3>
            <p className="m-0 text-[13px] text-fg-3">{t("meta.preview.loginSub")}</p>
            <span className="inline-flex min-h-11 w-fit items-center rounded-btn bg-[#1877F2] px-4 font-bold text-white">{t("meta.preview.continue")}</span>
            <ul className="m-0 grid list-none gap-2 border-t border-line-soft p-0 pt-3 text-[13px]">
              {(["account", "payment", "pixel", "verified"] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Icon name="check" className="text-status-approved" />
                  {t(`meta.preview.health.${k}`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2.5 rounded-xl bg-ink p-5 text-ink-fg-2">
            <h3 className="text-base font-bold text-ink-fg">{t("meta.preview.can")}</h3>
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-[13px]">
              <li>{t("meta.preview.can1")}</li>
              <li>{t("meta.preview.can2")}</li>
              <li>{t("meta.preview.can3")}</li>
            </ul>
            <h4 className="mt-1 text-sm font-bold text-ink-fg">{t("meta.preview.cant")}</h4>
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-[13px]">
              <li>{t("meta.preview.cant1")}</li>
              <li>{t("meta.preview.cant2")}</li>
            </ul>
          </div>
        </SoonBody>
      </div>
    </OnboardingFrame>
  )
}
