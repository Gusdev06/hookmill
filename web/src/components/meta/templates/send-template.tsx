"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { isApiError } from "@/lib/api/errors"
import type { MetaBudgetTooLowDetails, MetaPublishTemplate } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useMinorMoney } from "@/hooks/use-meta-publish"
import { useTemplateSummary } from "@/hooks/use-meta-templates"

export const CUSTOM = "custom"
export const TEMPLATES_HREF = "/settings/connections/templates"

/** Send → "Publish to Meta": which template (the default preselected) or "Custom (fill the form)". */
export function TemplateChooser({ templates, value, onChange }: { templates: MetaPublishTemplate[]; value: string; onChange: (v: string) => void }) {
  const t = useTranslations("metaTemplates.send")
  return (
    <section className="grid gap-1.5 rounded-lg border border-line bg-card p-4 tablet:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="send-template">{t("label")}</Label>
        <Link href={TEMPLATES_HREF} className="text-xs font-semibold text-fg underline-offset-2 hover:underline">{t("manage")}</Link>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="send-template" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {templates.map((tpl) => (
            <SelectItem key={tpl.id} value={tpl.id}>
              {tpl.isDefault ? t("defaultOption", { name: tpl.name }) : tpl.name}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{t("custom")}</SelectItem>
        </SelectContent>
      </Select>
    </section>
  )
}

/** With a template: its three levels in place of the form, and the publish button (POST …/publish { templateId }). */
export function TemplatePublish({
  template, currency, error, pending, onSubmit, onCancel,
}: {
  template: MetaPublishTemplate
  currency: string | null
  error: unknown
  pending: boolean
  onSubmit: () => void
  onCancel?: (() => void) | null
}) {
  const t = useTranslations("metaTemplates")
  const tw = useTranslations("metaTemplates.window")
  const tf = useTranslations("publish.form")
  const tp = useTranslations("publish")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const summary = useTemplateSummary(currency)
  const money = useMinorMoney(currency)
  const levels = summary.levels(template)
  const code = isApiError(error) ? error.code : null
  const a = template.ad
  const editHref = `${TEMPLATES_HREF}?edit=${encodeURIComponent(template.id)}`

  let alert: React.ReactNode = null
  if (code === "META_PIXEL_REQUIRED" || code === "META_BUDGET_TOO_LOW") {
    const min = code === "META_BUDGET_TOO_LOW" ? ((isApiError(error) ? error.details : null) as Partial<MetaBudgetTooLowDetails> | null)?.minimumMinor ?? null : null
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{code === "META_PIXEL_REQUIRED" ? tw("err.pixel") : tw("err.budgetBelow", { min: min === null ? "—" : money(min) })}</AlertTitle>
          <AlertDescription>{t("send.fixTemplate")}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href={editHref} className={buttonVariants({ size: "sm", variant: "default" })}>{t("send.editTemplate")}</Link>
        </AlertActions>
      </Alert>
    )
  } else if (code === "INVALID_STATE" && (error as { details?: { reason?: string } }).details?.reason === "publish_in_progress") {
    alert = (
      <Alert variant="info">
        <Icon name="info" />
        <AlertBody><AlertTitle>{tp("sync.inProgress")}</AlertTitle></AlertBody>
      </Alert>
    )
  } else if (error) {
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody><AlertTitle>{errorMessage(error)}</AlertTitle></AlertBody>
      </Alert>
    )
  }

  const rows: [string, string][] = [
    [tw("level.campaign"), `${template.campaign.destination === "REUSE_CAMPAIGN" ? t("summary.reuse", { name: template.campaign.namePattern }) : t("summary.newEach")} · ${tf(`objective.${template.campaign.objective}`)} · ${levels.campaign}`],
    [tw("level.adset"), summary.line(template).split(" · ").slice(2).join(" · ")],
    [tw("level.ad"), [levels.ad, a.link, a.primaryText ? null : t("send.textByHookMill")].filter(Boolean).join(" · ")],
  ]
  return (
    <div className="grid min-w-0 gap-5">
      {alert}
      <section className="grid gap-3 rounded-lg border border-line bg-card p-4 tablet:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold [overflow-wrap:anywhere]">{template.name}</h2>
          <Link href={editHref} className="text-xs font-semibold text-fg underline-offset-2 hover:underline">{t("send.editTemplate")}</Link>
        </div>
        <dl className="m-0 grid gap-2">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-0.5 border-t border-line-soft pt-2 first:border-t-0 first:pt-0 tablet:grid-cols-[110px_minmax(0,1fr)] tablet:gap-3">
              <dt className="text-[13px] font-semibold">{k}</dt>
              <dd className="m-0 text-[13px] text-fg-2 [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="brand" size="lg" disabled={pending} aria-busy={pending} onClick={onSubmit} className="w-full tablet:w-auto">
          {pending ? <span className="spin-ring size-4" aria-hidden="true" /> : <Icon name="upload" />}
          {pending ? tf("submitting") : tf("submit")}
        </Button>
        {onCancel ? <Button variant="ghost" size="lg" onClick={onCancel} disabled={pending}>{tc("cancel")}</Button> : null}
        <span className="text-[13px] text-fg-3">{tf("nothingSpends")}</span>
      </div>
    </div>
  )
}
