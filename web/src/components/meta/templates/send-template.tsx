"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { TourTip } from "@/components/tour/tip"
import { isApiError } from "@/lib/api/errors"
import type { MetaPublishTemplate } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useBudgetTooLowText, useTemplateSummary } from "@/hooks/use-meta-templates"
import { LevelGlyph } from "./editor-parts"

export const CUSTOM = "custom"
export const TEMPLATES_HREF = "/settings/connections/templates"

/**
 * Links into the full-page template editor (spec template-campanha §8): `/publish/template/<id|new>?return=<this page>`.
 * Saving goes back to `return` with `?template=<id>`, and the Send screen selects it.
 */
export function useEditorHref() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const back = new URLSearchParams(sp.toString())
  back.delete("template")
  back.delete("batch")
  back.delete("sent")
  /** `back`: params added to the return URL (the batch dialog reopens with `batch=1`) */
  return (id: string, extra: Record<string, string> = {}, backExtra: Record<string, string> = {}) => {
    const ret = new URLSearchParams(back)
    for (const [k, v] of Object.entries(backExtra)) ret.set(k, v)
    const q = new URLSearchParams({ return: `${pathname}${ret.size ? `?${ret}` : ""}`, ...extra })
    return `/publish/template/${encodeURIComponent(id)}?${q}`
  }
}

/** Send without any template (spec §2.1, F1): the dashed card + the structure chips; Publish opens the editor. */
export function NoTemplateCard({ publishLabel, n }: { publishLabel: string; n?: number }) {
  const t = useTranslations("metaTemplates.editor")
  const href = useEditorHref()
  const extra = n ? { n: String(n) } : undefined
  return (
    <section className="grid gap-3.5 rounded-lg border border-line bg-card p-4 tablet:p-5">
      <div className="grid gap-2.5 rounded-[12px] border border-dashed border-line-strong bg-card-2 p-4">
        <b>{t("emptyTitle")}</b>
        <span className="text-[13px] text-fg-3">{t("emptyBody")}</span>
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2">
          {(["campaign", "adset", "ad"] as const).map((l, i) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              {i ? <span aria-hidden="true">›</span> : null}
              <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-card px-2 py-[3px]">
                <LevelGlyph level={l} className="text-fg-2" />
                {t(`node.${l}`)}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={href("new", extra)} className={buttonVariants({ variant: "brand", size: "lg", className: "w-full tablet:w-auto" })}>
          <Icon name="upload" />
          {publishLabel}
        </Link>
        <Link href={href("new", { ...extra, import: "1" })} className="text-[13px] font-bold text-fg underline underline-offset-[3px]">{t("introImport")}</Link>
      </div>
    </section>
  )
}

/** Send → "Publish to Meta": which template (the default preselected) or "Custom (fill the form)" (kept, Gusta 03/11). */
export function TemplateChooser({ templates, value, onChange, blocked = false }: { templates: MetaPublishTemplate[]; value: string; onChange: (v: string) => void; blocked?: boolean }) {
  const t = useTranslations("metaTemplates.send")
  const te = useTranslations("metaTemplates.editor")
  const href = useEditorHref()
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
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {value !== CUSTOM ? <Link href={href(value)} className={buttonVariants({ size: "sm" })}>{te("editBtn")}</Link> : null}
        <Link href={href("new")} className={buttonVariants({ size: "sm" })}>{te("newBtn")}</Link>
        {/* importing reads Meta live: not while the connection is expired (F4) */}
        {blocked ? null : <Link href={href("new", { import: "1" })} className={buttonVariants({ size: "sm", variant: "ghost" })}>{te("import")}</Link>}
      </div>
    </section>
  )
}

/** With a template: its three levels in place of the form, and the publish button (POST …/publish { templateId }). */
export function TemplatePublish({
  template, currency, error, pending, onSubmit, onCancel, blocked = false,
}: {
  template: MetaPublishTemplate
  currency: string | null
  error: unknown
  pending: boolean
  onSubmit: () => void
  onCancel?: (() => void) | null
  /** F4: the connection can't publish (expired / unhealthy) → the summary + Edit stay, Publish is disabled */
  blocked?: boolean
}) {
  const t = useTranslations("metaTemplates")
  const tw = useTranslations("metaTemplates.window")
  const tf = useTranslations("publish.form")
  const tp = useTranslations("publish")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const summary = useTemplateSummary(currency)
  const budgetLow = useBudgetTooLowText(currency)
  const levels = summary.levels(template)
  const code = isApiError(error) ? error.code : null
  const a = template.ad
  const te = useTranslations("metaTemplates.editor")
  const editorHref = useEditorHref()
  const editHref = editorHref(template.id)
  const tr = useTranslations("metaTemplates.review")
  const tt = useTranslations("tip.send")

  let alert: React.ReactNode = null
  if (code === "META_PIXEL_REQUIRED" || code === "META_BUDGET_TOO_LOW") {
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{code === "META_PIXEL_REQUIRED" ? tw("err.pixel") : budgetLow(isApiError(error) ? error.details : null)}</AlertTitle>
          <AlertDescription>{t("send.fixTemplate")}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href={editHref} className={buttonVariants({ size: "sm", variant: "default" })}>{t("send.editTemplate")}</Link>
        </AlertActions>
      </Alert>
    )
  } else if (code === "VALIDATION_ERROR" && (error as { details?: { templateId?: string } }).details?.templateId) {
    // contract v2 §3: a date of the template went stale at send time → open the editor on that field
    const f = ((error as { details?: { fields?: { field: string; rule?: string }[] } }).details?.fields ?? [])[0]
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{te("sendFieldTitle")}</AlertTitle>
          <AlertDescription>{te("sendFieldBody")}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Link href={editorHref(template.id, f ? { field: f.field, rule: f.rule ?? "" } : {})} className={buttonVariants({ size: "sm", variant: "default" })}>{t("send.editTemplate")}</Link>
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

  // v2 (contract §8): lifetime budget, schedule, languages, audiences and the Instagram account in the summary
  const camp = summary.campaignOf(template)
  const rows: [string, string][] = [
    [tw("level.campaign"), [camp.destination, camp.objective, camp.budget].join(" · ")],
    [tw("level.adset"), summary.adsetOf(template).join(" · ")],
    [tw("level.ad"), [a.instagramAccount ? `@${a.instagramAccount.username}` : null, levels.ad, a.link, a.primaryText ? null : t("send.textByHookMill")].filter(Boolean).join(" · ")],
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
      <div id="t-send-review" className="flex flex-wrap items-center gap-3">
        {/* 04/11 (Gusta): the main way is "Review and send" (the full editor, changes only for this send); direct send stays */}
        {pending || blocked ? (
          <Button variant="brand" size="lg" disabled className="w-full tablet:w-auto">
            <Icon name="upload" />
            {tr("reviewSend")}
          </Button>
        ) : (
          <Link href={editorHref(template.id, { review: "1" })} className={buttonVariants({ variant: "brand", size: "lg", className: "w-full tablet:w-auto" })}>
            <Icon name="upload" />
            {tr("reviewSend")}
          </Link>
        )}
        <Button variant="outline" size="lg" disabled={pending || blocked} aria-busy={pending} onClick={onSubmit} className="w-full tablet:w-auto">
          {pending ? <span className="spin-ring size-4" aria-hidden="true" /> : null}
          {pending ? tf("submitting") : tr("sendDirect")}
        </Button>
        {onCancel ? <Button variant="ghost" size="lg" onClick={onCancel} disabled={pending}>{tc("cancel")}</Button> : null}
        <span className="text-[13px] text-fg-3">{tf("nothingSpends")}</span>
      </div>
      <TourTip tip="send" when={!blocked} variant="default" target="#t-send-review" title={tt("title")} body={tt("body")} />
    </div>
  )
}
