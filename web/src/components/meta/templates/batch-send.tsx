"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { CreativeMetaResponse, MetaPublishBatchResponse } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { useSession } from "@/components/providers/session-provider"
import { useMetaGate } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { pk } from "@/hooks/use-meta-publish"
import { planAdsets, useMetaTemplates, useTemplateSummary } from "@/hooks/use-meta-templates"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { TEMPLATES_HREF } from "./send-template"

export interface BatchItem { creativeId: string; code: string }

/**
 * "Send to Meta" for a set of approved pieces (meta-templates-v1 §2 P3): confirm with the template and the ad-set plan,
 * POST /meta/publish-batch, then the progress of every publication with the same 2 s polling as the Send screen
 * (GET /creatives/:id/meta while PUBLISHING). Hidden for CLIENT and without a usable Meta connection.
 */
export function BatchSendButton({ items, className }: { items: BatchItem[]; className?: string }) {
  const t = useTranslations("metaTemplates.batch")
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const gate = useMetaGate()
  const [open, setOpen] = useState(false)
  if (role === "CLIENT" || !gate.ready) return null
  return (
    <>
      <Button className={cn("max-tablet:px-2.5", className)} disabled={!items.length} onClick={() => setOpen(true)} title={!items.length ? t("nothing") : undefined}>
        <span aria-hidden="true" className="hidden size-[18px] place-items-center rounded-[4px] bg-meta tablet:inline-grid text-xs font-extrabold text-white">f</span>
        {t("button", { n: items.length })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          {open ? <Batch items={items} currency={gate.conn.data?.adAccount?.currency ?? null} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function Batch({ items, currency, onClose }: { items: BatchItem[]; currency: string | null; onClose: () => void }) {
  const t = useTranslations("metaTemplates.batch")
  const tw = useTranslations("metaTemplates.window")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const templates = useMetaTemplates()
  const summary = useTemplateSummary(currency)
  const [choice, setChoice] = useState<string | null>(null)
  const list = templates.data ?? []
  const tpl = list.find((x) => x.id === choice) ?? list.find((x) => x.isDefault) ?? list[0] ?? null
  const [sent, setSent] = useState<MetaPublishBatchResponse | null>(null)

  const send = useMutation({
    mutationFn: () => api.meta.publishBatch({ creativeIds: items.map((i) => i.creativeId), templateId: tpl!.id }),
    onSuccess: (r) => {
      // seeds the per-creative cache the Send screen polls; the queries below take it from here
      for (const p of r.publications) qc.setQueryData<CreativeMetaResponse>(pk.creative(p.creativeId), (prev) => (prev ? { ...prev, publication: p } : prev))
      void qc.invalidateQueries({ queryKey: ["meta", "publications"] })
      setSent(r)
    },
  })

  const pubs = useQueries({
    queries: (sent?.publications ?? []).map((p) => ({
      queryKey: pk.creative(p.creativeId),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.meta.creative(p.creativeId, { signal }),
      refetchInterval: (q: { state: { data?: CreativeMetaResponse } }) => (q.state.data?.publication?.status === "PUBLISHING" || !q.state.data ? 2_000 : false),
    })),
  })
  const code = (id: string) => items.find((i) => i.creativeId === id)?.code ?? id

  if (sent) {
    const states = sent.publications.map((p, i) => pubs[i]?.data?.publication ?? p)
    const done = states.filter((p) => p.status !== "PUBLISHING").length
    const failed = states.filter((p) => p.status === "FAILED").length
    const pct = Math.round(states.reduce((a, p) => a + (p.status === "PUBLISHING" ? (p.job?.progress ?? 0) : 100), 0) / Math.max(1, states.length))
    return (
      <>
        <div className="grid gap-1.5 border-b border-line px-4 py-3.5 tablet:px-5">
          <DialogTitle className="pr-8 text-base font-bold">{done < states.length ? t("sendingTitle", { done, n: states.length }) : t("doneTitle", { n: states.length - failed })}</DialogTitle>
          <DialogDescription className="text-[13px] text-fg-2">{t("sendingLead")}</DialogDescription>
          <Progress value={pct} aria-label={t("progressAria")} />
        </div>
        <div className="grid min-h-0 content-start gap-3 overflow-y-auto px-4 py-3 tablet:px-5">
          {sent.plan.adsets.map((g, gi) => (
            <section key={gi} className="grid gap-1.5">
              <h3 className={cn("m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold", g.belowMin && "text-status-waiting")}>
                <span className="[overflow-wrap:anywhere]">{g.name}</span>
                {g.belowMin ? <span className="font-mono text-[11px] font-normal">{t("belowMin")}</span> : null}
              </h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {g.creativeIds.map((cid) => {
                  const p = states.find((x) => x.creativeId === cid)
                  const st = p?.status ?? "PUBLISHING"
                  return (
                    <li key={cid} className="flex items-center justify-between gap-2 rounded-md border border-line-soft px-2.5 py-1.5 text-[13px]">
                      <span className="truncate font-mono text-xs">{code(cid)}</span>
                      <span className={cn("inline-flex flex-none items-center gap-1.5 text-xs font-semibold", st === "FAILED" ? "text-status-failed" : st === "PUBLISHING" ? "text-status-progress" : "text-status-approved")}>
                        {st === "PUBLISHING" ? <span className="spin-ring size-3 border-current" aria-hidden="true" /> : <Icon name={st === "FAILED" ? "x" : "check"} />}
                        {st === "PUBLISHING" && p?.job?.stage ? t(`stage.${p.job.stage}` as "stage.uploading_video") : t(`status.${st}`)}
                      </span>
                      {st === "FAILED" ? (
                        <Link href={`/creatives/${encodeURIComponent(cid)}/send`} className="text-xs font-semibold underline-offset-2 hover:underline">{t("openOne")}</Link>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 tablet:px-5">
          <span className="text-xs text-fg-3">{t("canLeave")}</span>
          <Button variant="brand" onClick={onClose}>{tc("close")}</Button>
        </div>
      </>
    )
  }

  const plan = tpl ? planAdsets(items.length, tpl.adset.adsPerAdset) : []
  const err = send.error
  const reason = isApiError(err) ? (err.details as { reason?: string; creativeIds?: string[] } | undefined) : undefined
  let alert: React.ReactNode = null
  if (isApiError(err) && (err.code === "META_PIXEL_REQUIRED" || err.code === "META_BUDGET_TOO_LOW")) {
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{errorMessage(err)}</AlertTitle>
          <AlertDescription>{t("fixTemplate")}</AlertDescription>
        </AlertBody>
        {tpl ? (
          <AlertActions>
            <Link href={`${TEMPLATES_HREF}?edit=${encodeURIComponent(tpl.id)}`} className={buttonVariants({ size: "sm", variant: "default" })}>{t("editTemplate")}</Link>
          </AlertActions>
        ) : null}
      </Alert>
    )
  } else if (isApiError(err) && err.code === "INVALID_STATE") {
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{reason?.reason === "publish_in_progress" ? t("busy") : t("notApproved")}</AlertTitle>
          {reason?.creativeIds?.length ? <AlertDescription className="font-mono text-xs">{reason.creativeIds.map(code).join(", ")}</AlertDescription> : null}
        </AlertBody>
      </Alert>
    )
  } else if (err) {
    alert = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody><AlertTitle>{errorMessage(err)}</AlertTitle></AlertBody>
      </Alert>
    )
  }

  let body: React.ReactNode
  if (templates.isPending) {
    body = (
      <div className="grid gap-2" role="status" aria-label={tc("loading")}>
        <span className="sk h-11" />
        <span className="sk h-16" />
      </div>
    )
  } else if (templates.isError) {
    body = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody><AlertTitle>{errorMessage(templates.error)}</AlertTitle></AlertBody>
        <AlertActions><Button size="sm" onClick={() => templates.refetch()}>{tc("retry")}</Button></AlertActions>
      </Alert>
    )
  } else if (!tpl) {
    body = (
      <div className="grid gap-2 py-2">
        <b>{t("noTemplateTitle")}</b>
        <span className="text-[13px] text-fg-2">{t("noTemplateBody")}</span>
        <Link href={TEMPLATES_HREF} className={buttonVariants({ size: "sm", className: "justify-self-start" })}>{t("createTemplate")}</Link>
      </div>
    )
  } else {
    body = (
      <>
        {alert}
        <div className="grid gap-1.5">
          <Label htmlFor="batch-template">{t("template")}</Label>
          <Select value={tpl.id} onValueChange={setChoice}>
            <SelectTrigger id="batch-template" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {list.map((x) => <SelectItem key={x.id} value={x.id}>{x.isDefault ? t("defaultOption", { name: x.name }) : x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-fg-2">{summary.line(tpl)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2" aria-label={tw("planAria")}>
          <span>{t("plan", { n: items.length })}</span>
          {plan.map((p, i) => (
            <span key={i} className={cn("rounded-md border px-[7px] py-[3px] font-mono text-[11px] num", p.short ? "border-status-waiting bg-status-waiting-bg text-status-waiting" : "border-line bg-card-2")}>
              {p.short ? tw("adsetShort", { i: i + 1, n: p.size, min: tpl.adset.adsPerAdset.min }) : tw("adset", { i: i + 1, n: p.size })}
            </span>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="grid gap-1.5 border-b border-line px-4 py-3.5 tablet:px-5">
        <DialogTitle className="pr-8 text-base font-bold">{t("title", { n: items.length })}</DialogTitle>
        <DialogDescription className="text-[13px] text-fg-2">{t("lead")}</DialogDescription>
      </div>
      <div className="grid min-h-0 content-start gap-4 overflow-y-auto px-4 py-3.5 tablet:px-5">{body}</div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 tablet:px-5">
        <Button variant="ghost" onClick={onClose} disabled={send.isPending}>{tc("cancel")}</Button>
        <Button variant="brand" disabled={!tpl || send.isPending || items.length > 50} onClick={() => send.mutate()} aria-busy={send.isPending}>
          {send.isPending ? <span className="spin-ring size-4 border-fg" aria-hidden="true" /> : <Icon name="upload" />}
          {t("confirm", { n: items.length })}
        </Button>
      </div>
    </>
  )
}
