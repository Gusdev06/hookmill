"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { isApiError } from "@/lib/api/errors"
import type { CreativeDetail, CreativeMetaResponse, MetaHealth, MetaPublication, Role } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { EmptyState, Page } from "@/components/page"
import { Thumb } from "@/components/thumb"
import { useSession } from "@/components/providers/session-provider"
import { useCreative } from "@/hooks/use-creative"
import { useErrorMessage } from "@/hooks/use-error-message"
import { isMetaOff, useMetaConnection } from "@/hooks/use-meta"
import { useCreativeMeta, usePublishActions } from "@/hooks/use-meta-publish"
import { setCrumb } from "@/lib/crumb"
import { mmss } from "@/components/wizard/common"
import { stepHref } from "@/components/wizard/shell"
import { PublicationCard, PublicationHistory } from "./publication-card"
import { PublishForm, valuesFromDefaults } from "./publish-form"

const CONNECTIONS = "/settings/connections"
const FORMAT_SHORT = { VERTICAL_9_16: "9:16", PORTRAIT_4_5: "4:5", SQUARE_1_1: "1:1" } as const

/**
 * Send → "Publish to Meta" (/creatives/:id/send; meta-v1 §3.3, sequence §3.3.1). Left: the current publication (form,
 * progress, result) + history. Right (top on the phone): the approved video and the account it goes to.
 * Blocks, in order: Meta off on the server · not approved · never connected · the account can't publish.
 */
export function PublishScreen({ id }: { id: string }) {
  const t = useTranslations("publish")
  const tc = useTranslations("common")
  const errorMessage = useErrorMessage()
  const { session } = useSession()
  const role = session.workspace.role
  const creative = useCreative(id)
  const c = creative.data ?? null
  const approved = c?.state === "APPROVED" && !!c.finalRender
  const meta = useCreativeMeta(id, !!c)
  const connection = useMetaConnection()
  const act = usePublishActions(id)
  // "Publish again" / "Edit ad text": the form opens prefilled with that publication's settings
  const [editing, setEditing] = useState<MetaPublication | null>(null)
  // when the last POST /publish failed (for the META_UNAVAILABLE countdown)
  const [errorAt, setErrorAt] = useState<number | null>(null)

  useEffect(() => {
    if (c) setCrumb(c.name)
    return () => setCrumb(null)
  }, [c])

  // a FAILED/DELETED → new PUBLISHING transition closes the form
  const current = meta.data?.publication ?? null
  if (editing && current && current.status === "PUBLISHING") setEditing(null)

  const off = isMetaOff(meta.error) || isMetaOff(connection.error)

  const errorBlock = (e: unknown, retry: () => void) => (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{t("loadFailed")}</AlertTitle>
        <AlertDescription>{errorMessage(e)}</AlertDescription>
      </AlertBody>
      <AlertActions>
        <Button size="sm" onClick={retry}>
          <Icon name="refresh" />
          {tc("retry")}
        </Button>
      </AlertActions>
    </Alert>
  )

  if (creative.isError) {
    const nf = isApiError(creative.error) && creative.error.status === 404
    return (
      <Page>
        {nf ? (
          <EmptyState>
            <h2>{t("notFoundTitle")}</h2>
            <p className="text-fg-2">{t("notFoundBody")}</p>
            <div>
              <Link href="/library" className={buttonVariants()}>
                <Icon name="left" />
                {t("backLibrary")}
              </Link>
            </div>
          </EmptyState>
        ) : (
          errorBlock(creative.error, () => creative.refetch())
        )}
      </Page>
    )
  }

  let main: React.ReactNode
  if (!c || (meta.isPending && !off && approved)) {
    main = (
      <div className="grid gap-4" role="status" aria-label={tc("loading")}>
        <span className="sk h-7 w-56" />
        <span className="sk h-4 w-80 max-w-full" />
        <span className="sk h-64 rounded-xl" />
      </div>
    )
  } else if (off) {
    main = (
      <EmptyState className="max-w-none">
        <h2>{t("off.title")}</h2>
        <p className="text-fg-2">{t("off.body")}</p>
      </EmptyState>
    )
  } else if (!approved) {
    main = (
      <EmptyState className="max-w-none">
        <h2>{t("notApproved.title")}</h2>
        <p className="text-fg-2">{t("notApproved.body")}</p>
        <div>
          <Link href={stepHref(c.id, c.step === "library" ? "review" : c.step)} className={buttonVariants({ variant: "default" })}>
            {t("notApproved.cta")}
            <Icon name="arrowr" />
          </Link>
        </div>
      </EmptyState>
    )
  } else if (meta.isError) {
    main = errorBlock(meta.error, () => meta.refetch())
  } else if (meta.data) {
    main = <Body id={id} data={meta.data} role={role} editing={editing} setEditing={setEditing} act={act} health={connection.data?.health ?? null} errorAt={errorAt} setErrorAt={setErrorAt} />
  }

  const account = meta.data?.defaults ? (connection.data?.adAccount?.name ?? null) : null
  return (
    <Page>
      <div className="grid gap-1.5">
        <Link href={c ? stepHref(c.id, "review") : "/library"} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] text-fg-2 hover:text-fg">
          <Icon name="left" />
          {t("back")}
        </Link>
        <div className="min-w-0">
          <h1>{t("title")}</h1>
          <p className="mt-1 max-w-[65ch] text-fg-2">{account ? t("subAccount", { account }) : t("sub")}</p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 tablet:grid-cols-[minmax(0,1fr)_300px] tablet:gap-6">
        <div className="grid min-w-0 gap-4">{main}</div>
        {c ? <CreativeAside c={c} data={meta.data ?? null} /> : null}
      </div>
    </Page>
  )
}

function Body({
  id, data, role, editing, setEditing, act, health, errorAt, setErrorAt,
}: {
  id: string
  data: CreativeMetaResponse
  role: Role
  editing: MetaPublication | null
  setEditing: (p: MetaPublication | null) => void
  act: ReturnType<typeof usePublishActions>
  health: MetaHealth | null
  errorAt: number | null
  setErrorAt: (t: number | null) => void
}) {
  const t = useTranslations("publish")
  const tm = useTranslations("meta")
  const connection = useMetaConnection()
  const canWrite = role !== "CLIENT"
  const p = data.publication
  // the API may list the current publication in `history` too: the card shows it once
  const history = data.history.filter((h) => h.id !== p?.id)
  const currency = data.defaults?.currency ?? null
  const account = connection.data?.adAccount?.name ?? connection.data?.adAccount?.id ?? "—"

  // 1. never connected / disconnected
  if (!data.connection || data.connection.status === "DISCONNECTED" || !data.defaults) {
    return (
      <>
        <EmptyState className="max-w-none">
          <h2>{t("noConnection.title")}</h2>
          <p className="text-fg-2">{t("noConnection.body")}</p>
          {canWrite ? (
            <div>
              <Link href={CONNECTIONS} className={buttonVariants({ variant: "meta" })}>
                <span aria-hidden="true" className="text-lg leading-none font-extrabold">f</span>
                {t("noConnection.cta")}
              </Link>
            </div>
          ) : null}
        </EmptyState>
        <PublicationHistory items={[...(p ? [p] : []), ...history]} currency={currency} />
      </>
    )
  }

  const showForm = canWrite && (editing || !p || p.status === "DELETED") && !(p && p.status === "PUBLISHING")
  const blocked = data.connection.status === "TOKEN_INVALID" || !data.connection.canPublish

  // 2. the account can't publish (token expired, health bad)
  if (showForm && blocked) {
    const bad = (health?.checks ?? []).filter((x) => x.level === "bad")
    const expired = data.connection.status === "TOKEN_INVALID"
    return (
      <>
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{expired ? tm("expiredTitle") : t("cannotPublish.title")}</AlertTitle>
            <AlertDescription>
              {expired ? tm("expiredBody") : t("cannotPublish.body")}
              {bad.length ? (
                <ul className="m-0 mt-2 grid list-none gap-1 p-0">
                  {bad.map((x) => (
                    <li key={x.key} className="flex items-start gap-2">
                      <Icon name="x" className="mt-0.5 text-status-failed" />
                      <span>
                        <b>{tm(`check.${x.key}`)}</b>
                        {x.detail ? <span className="text-fg-3"> · {x.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </AlertBody>
          <AlertActions>
            <Link href={CONNECTIONS} className={buttonVariants({ size: "sm", variant: "default" })}>
              {expired ? tm("reconnect") : t("cannotPublish.cta")}
              <Icon name="arrowr" />
            </Link>
          </AlertActions>
        </Alert>
        <PublicationHistory items={[...(p && p.status !== "DELETED" ? [] : p ? [p] : []), ...history]} currency={currency} />
      </>
    )
  }

  const actions = {
    activate: () => act.activate.mutate(undefined, { onSuccess: () => toast(t("result.activated")) }),
    pause: () => act.pause.mutate(undefined, { onSuccess: () => toast(t("result.pausedToast")) }),
    retry: () => act.retry.mutate(),
    edit: () => setEditing(p),
    pending: { activate: act.activate.isPending, pause: act.pause.isPending, retry: act.retry.isPending },
    error: act.activate.error ?? act.pause.error ?? act.retry.error,
  }

  return (
    <>
      {showForm ? (
        <PublishForm
          key={editing?.id ?? "new"}
          defaults={data.defaults}
          initial={valuesFromDefaults(data.defaults, editing?.settings ?? (p?.status === "DELETED" ? p.settings : null))}
          error={act.publish.error}
          errorAt={errorAt}
          pending={act.publish.isPending}
          onSubmit={(body) => act.publish.mutate(body, { onSuccess: () => setEditing(null), onError: () => setErrorAt(Date.now()) })}
          onCancel={editing && p && p.status !== "DELETED" ? () => setEditing(null) : null}
        />
      ) : p ? (
        <PublicationCard p={p} role={role} currency={currency} account={account} creativeId={id} actions={actions} />
      ) : (
        <EmptyState className="max-w-none">
          <h2>{t("readOnly.title")}</h2>
          <p className="text-fg-2">{t("readOnly.body")}</p>
        </EmptyState>
      )}
      <PublicationHistory items={showForm && p && p.status !== "DELETED" ? [p, ...history] : history} currency={currency} />
    </>
  )
}

/** The approved video and where it goes (mockup "Ready today"): thumb, name, standardized file name, facts, account. */
function CreativeAside({ c, data }: { c: CreativeDetail; data: CreativeMetaResponse | null }) {
  const t = useTranslations("publish.ready")
  const tw = useTranslations("wizard")
  const connection = useMetaConnection()
  const conn = connection.data ?? null
  const video = c.finalRender?.video ?? null
  return (
    <aside className="order-first grid min-w-0 gap-3 tablet:order-none">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border border-line bg-card p-3.5">
        <Thumb file={c.thumbnail} play={!!video} className="rounded-md" />
        <div className="flex min-w-0 flex-col gap-1">
          <b className="truncate" title={c.name}>{c.name}</b>
          {c.adName ? <span className="truncate font-mono text-xs text-fg-3" title={`${c.adName}.mp4`}>{c.adName}.mp4</span> : null}
          <span className="text-[13px] text-fg-2">
            {c.offer.name}
            {c.summary.engineLabel ? ` · ${c.summary.engineLabel}` : ""}
          </span>
          <span className="font-mono text-[13px] text-fg-2">
            {c.finalRender?.durationSec != null ? mmss(c.finalRender.durationSec) : "—"} · {FORMAT_SHORT[c.format]}
          </span>
          <span className="text-xs text-fg-3">{c.state === "APPROVED" ? t("approved") : tw("review.notReady")}</span>
        </div>
      </div>
      {video ? (
        <a href={video.url} download={c.adName ? `${c.adName}.mp4` : undefined} rel="noopener" className={buttonVariants({ size: "default", className: "w-full" })}>
          <Icon name="upload" className="rotate-180" />
          {t("download")}
        </a>
      ) : null}
      {data?.connection && conn ? (
        <div className="grid gap-1.5 rounded-xl border border-line bg-card p-3.5 text-[13px]">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-grid size-6 flex-none place-items-center rounded-[5px] bg-meta text-sm font-extrabold text-white">f</span>
            <b className="truncate">{conn.adAccount?.name ?? conn.user.name}</b>
          </div>
          {conn.adAccount ? <span className="truncate font-mono text-xs text-fg-3">{conn.adAccount.id} · {conn.adAccount.currency}</span> : null}
          {conn.page ? <span className="truncate text-fg-2">{t("page", { page: conn.page.name })}</span> : null}
          <span className="truncate text-fg-2">{conn.pixel ? t("pixel", { pixel: conn.pixel.name }) : t("noPixel")}</span>
          <Link href={CONNECTIONS} className="justify-self-start text-xs font-semibold text-fg underline-offset-2 hover:underline">
            {t("manage")}
          </Link>
        </div>
      ) : null}
    </aside>
  )
}
