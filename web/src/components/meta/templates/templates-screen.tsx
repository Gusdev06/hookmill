"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import type { MetaPublishTemplate } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { EmptyState, Page } from "@/components/page"
import { useSession } from "@/components/providers/session-provider"
import { MetaLockCard, useMetaGate } from "@/components/meta/meta-gate"
import { useErrorMessage } from "@/hooks/use-error-message"
import { useMetaTemplates, useTemplateSummary } from "@/hooks/use-meta-templates"
import { effectiveRole } from "@/lib/dev-role"
import { cn } from "@/lib/utils"
import { ImportPicker } from "./import-picker"
import { TemplateDialog, type TemplateSource } from "./template-dialog"

/**
 * Settings › Meta › Publish templates (/settings/connections/templates; meta-templates-v1, mockup approved 29/10):
 * list with the default first, Default / Imported pills and one summary line; New template and Import from a campaign.
 * Without a usable Meta connection: the lock card. CLIENT only reads.
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
  const [source, setSource] = useState<TemplateSource | null>(null)
  const [importing, setImporting] = useState(false)
  // ?edit=<id> (from Send → "Edit template"): opens that template once the list arrives
  const editId = useSearchParams().get("edit")
  const [opened, setOpened] = useState<string | null>(null)
  if (editId && opened !== editId && list.data) {
    const tpl = list.data.find((x) => x.id === editId)
    setOpened(editId)
    if (tpl) setSource({ kind: "edit", template: tpl })
  }

  const account = conn?.adAccount ? `${conn.adAccount.name} (${conn.adAccount.id.replace(/^(act_)?.*(\d{4})$/, "act_••••$2")})` : null
  const actions = readOnly || !gate.ready ? null : (
    <div className="flex flex-wrap gap-2.5">
      <Button onClick={() => setImporting(true)}>{t("importCta")}</Button>
      <Button variant="brand" onClick={() => setSource({ kind: "new" })}>
        <Icon name="plus" />
        {t("newCta")}
      </Button>
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
          <Row key={tpl.id} tpl={tpl} line={summary.line(tpl)} readOnly={readOnly} onOpen={() => setSource({ kind: "edit", template: tpl })} />
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

      <TemplateDialog source={source} onClose={() => setSource(null)} connection={conn} readOnly={readOnly} onImport={() => setImporting(true)} />
      <ImportPicker
        open={importing}
        onClose={() => setImporting(false)}
        onPicked={(p) => {
          setImporting(false)
          setSource({
            kind: "import",
            body: p.result.template,
            importedFrom: { level: p.level, id: p.id, name: p.result.template.importedFrom?.name && p.result.template.importedFrom.name !== p.id ? p.result.template.importedFrom.name : p.name },
            unsupported: p.result.unsupported,
          })
        }}
      />
    </Page>
  )
}

function Row({ tpl, line, readOnly, onOpen }: { tpl: MetaPublishTemplate; line: string; readOnly: boolean; onOpen: () => void }) {
  const t = useTranslations("metaTemplates")
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 rounded-lg border border-line bg-card p-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <b className="text-[15px] [overflow-wrap:anywhere]">{tpl.name}</b>
        {tpl.isDefault ? <Pill tone="def">{t("pillDefault")}</Pill> : null}
        {tpl.source === "IMPORTED" ? <Pill tone="imp">{t("pillImported")}</Pill> : null}
      </div>
      <Button size="sm" onClick={onOpen} aria-label={`${readOnly ? t("view") : t("edit")} ${tpl.name}`}>
        {readOnly ? t("view") : t("edit")}
      </Button>
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
