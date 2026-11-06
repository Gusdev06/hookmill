"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import type { MetaPublishTemplate } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { EmptyState, Page } from "@/components/page"
import { useSession } from "@/components/providers/session-provider"
import { MetaLockCard, useMetaGate } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useMetaTemplates, useTemplateSummary } from "@/hooks/use-meta-templates"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { TEMPLATES_LIST } from "./template-editor"

/**
 * Settings › Meta › Publish templates (/settings/connections/templates; meta-templates-v1, mockup approved 29/10):
 * list with the default first, Default / Imported pills and one summary line; New template and Import from a campaign.
 * Without a usable Meta connection: the lock card. CLIENT only reads. Opening a template goes to the full-page editor
 * (/settings/connections/templates/:id; spec template-campanha §3 F3); "New" and "Import" open it as `new`.
 */
export function TemplatesScreen() {
  const t = useTranslations("metaTemplates")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const [role] = useState(() => effectiveRole(session.workspace.role))
  const readOnly = role === "CLIENT"
  const gate = useMetaGate()
  const list = useMetaTemplates(gate.ready)
  const conn = gate.conn.data ?? null
  const summary = useTemplateSummary(conn?.adAccount?.currency)
  const router = useRouter()
  // ?edit=<id> (old links from Send → "Edit template"): the editor is a page now
  const editId = useSearchParams().get("edit")
  useEffect(() => {
    if (editId) router.replace(`${TEMPLATES_LIST}/${encodeURIComponent(editId)}`)
  }, [editId, router])

  const account = conn?.adAccount ? `${conn.adAccount.name} (${conn.adAccount.id.replace(/^(act_)?.*(\d{4})$/, "act_••••$2")})` : null
  const actions = readOnly || !gate.ready ? null : (
    <div className="flex flex-wrap gap-2.5">
      <Link href={`${TEMPLATES_LIST}/new?import=1`} className={buttonVariants()}>{t("importCta")}</Link>
      <Link href={`${TEMPLATES_LIST}/new`} className={buttonVariants({ variant: "brand" })}>
        <Icon name="plus" />
        {t("newCta")}
      </Link>
    </div>
  )

  let body: React.ReactNode
  if (gate.state === "loading" || (gate.ready && list.isPending)) {
    body = (
      <div className="grid gap-2.5" role="status" aria-label={tc("loading")}>
        <span className="sk h-[74px] rounded-lg" />
        <span className="sk h-[74px] rounded-lg" />
      </div>
    )
  } else if (gate.state === "off") {
    body = (
      <EmptyState className="max-w-none">
        <h2>{t("offTitle")}</h2>
        <p className="text-fg-2">{t("offBody")}</p>
      </EmptyState>
    )
  } else if (gate.state === "failed" || list.isError) {
    const e = gate.state === "failed" ? gate.conn.error : list.error
    body = (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loadFailed")}</AlertTitle>
          <AlertDescription>{errorMessage(e)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          <Button size="sm" onClick={() => (gate.state === "failed" ? gate.conn.refetch() : list.refetch())}>
            <Icon name="refresh" />
            {tc("retry")}
          </Button>
        </AlertActions>
      </Alert>
    )
  } else if (!gate.ready) {
    body = <MetaLockCard state={gate.state} />
  } else if (!list.data?.length) {
    body = (
      <EmptyState className="max-w-none">
        <h2>{t("emptyTitle")}</h2>
        <p className="text-fg-2">{readOnly ? t("emptyBodyClient") : t("emptyBody")}</p>
      </EmptyState>
    )
  } else {
    body = (
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {list.data.map((tpl) => (
          <Row key={tpl.id} tpl={tpl} line={summary.line(tpl)} readOnly={readOnly} />
        ))}
      </ul>
    )
  }

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid min-w-0 gap-1.5">
          {/* review 29/10 L6: shadcn Breadcrumb, 44 px touch targets on the phone; the account goes on its own line under the title */}
          <Breadcrumb>
            <BreadcrumbList className="gap-x-1.5 gap-y-0 font-mono text-xs text-fg-3 sm:gap-x-1.5">
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="inline-flex min-h-11 items-center hover:text-fg tablet:min-h-0">
                  <Link href="/settings">{t("crumbSettings")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator>›</BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="inline-flex min-h-11 items-center hover:text-fg tablet:min-h-0">
                  <Link href="/settings/connections">Meta</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator>›</BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage className="text-fg-3">{t("title")}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="m-0">{t("title")}</h1>
          {account ? <span className="font-mono text-xs text-fg-3 [overflow-wrap:anywhere]">{account}</span> : null}
        </div>
        {actions}
      </div>
      <p className="m-0 max-w-[64ch] text-fg-2">{t("lede")}</p>
      <div className="grid max-w-[1120px] grid-cols-[minmax(0,1fr)] gap-2.5">{body}</div>

    </Page>
  )
}

function Row({ tpl, line, readOnly }: { tpl: MetaPublishTemplate; line: string; readOnly: boolean }) {
  const t = useTranslations("metaTemplates")
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 rounded-lg border border-line bg-card p-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <b className="text-[15px] [overflow-wrap:anywhere]">{tpl.name}</b>
        {tpl.isDefault ? <Pill tone="def">{t("pillDefault")}</Pill> : null}
        {tpl.source === "IMPORTED" ? <Pill tone="imp">{t("pillImported")}</Pill> : null}
      </div>
      <Link href={`${TEMPLATES_LIST}/${encodeURIComponent(tpl.id)}`} className={buttonVariants({ size: "sm" })} aria-label={`${readOnly ? t("view") : t("edit")} ${tpl.name}`}>
        {readOnly ? t("view") : t("edit")}
      </Link>
      <span className="col-span-2 text-[13px] text-fg-2 tablet:col-span-1">{line}</span>
    </li>
  )
}

function Pill({ tone, children }: { tone: "def" | "imp"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border px-[7px] py-0.5 font-mono text-[10.5px] whitespace-nowrap",
        tone === "def" ? "border-brand-edge bg-brand-soft text-brand-ink" : "border-status-progress-edge bg-status-progress-bg text-status-progress"
      )}
    >
      {children}
    </span>
  )
}
