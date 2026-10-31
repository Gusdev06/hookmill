"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { Workspace } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Icon } from "@/components/icon"
import { Page, PageHead, Panel, PanelHead } from "@/components/page"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { StatusChip } from "@/components/status-chip"
import { InviteDialog } from "@/components/team"
import { useErrorMessage } from "@/hooks/use-error-message"
import { isMetaOff, metaReady, useMetaConnection, useRelativeTime } from "@/hooks/use-meta"
import { AccountModeCard } from "@/components/settings/account-mode-card"
import { UnlockAccountCard } from "@/components/settings/unlock-account-card"
import { BrandColorField } from "@/components/brand-color-field"
import { percentOf } from "@/components/onboarding/shared"
import { startReplay } from "@/components/tour/tour-state"

/** mockup .set-row */
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line py-2.5 first:border-t-0">
      <span>{label}</span>
      <span className="text-fg-2">{children}</span>
    </div>
  )
}

function Who({ initials, name }: { initials: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="grid size-[18px] place-items-center rounded-full border border-line-2 bg-surface-2 text-[10px] text-fg-2 not-italic">{initials}</i>
      {name}
    </span>
  )
}

export default function SettingsPage() {
  const t = useTranslations()
  const errorMessage = useErrorMessage()
  const format = useFormatter()
  const [ws, members, services, spend] = useQueries({
    queries: [
      { queryKey: ["workspace"], queryFn: api.workspace.get },
      { queryKey: ["workspace", "members"], queryFn: api.workspace.members },
      { queryKey: ["workspace", "services"], queryFn: api.workspace.services },
      { queryKey: ["workspace", "spend"], queryFn: () => api.workspace.spend() },
    ],
  })
  const usd = (v: number) => format.number(v, { style: "currency", currency: "USD" })
  const router = useRouter()
  // the Meta callback returns to /settings (meta-v1 §3.1 returnTo); the card that reads ?meta= lives in Connections
  const sp = useSearchParams()
  const metaBack = sp.get("meta")
  useEffect(() => {
    if (metaBack) router.replace(`/settings/connections?${sp.toString()}`)
  }, [metaBack, sp, router])
  const conn = useMetaConnection()
  const rel = useRelativeTime()
  const metaOff = conn.isError && isMetaOff(conn.error)
  const metaIsReady = metaReady(conn.data)
  const metaStatus = conn.data?.status ?? null
  const metaSyncedAt = conn.data?.lastSyncAt ?? null
  const failed = [ws, members, services, spend].find((q) => q.isError && !q.data)

  return (
    <Page>
      <PageHead title={t("settings.title")} sub={t("settings.subtitle")} />
      {failed ? (
        <Alert variant="destructive">
          <Icon name="alert" />
          <AlertBody>
            <AlertTitle>{t("settings.errorTitle")}</AlertTitle>
            <AlertDescription>{errorMessage(failed.error)}</AlertDescription>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={() => [ws, members, services, spend].forEach((q) => q.refetch())}>
              <Icon name="refresh" />
              {t("common.retry")}
            </Button>
          </AlertActions>
        </Alert>
      ) : null}
      <div className="grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-4">
        <Panel>
          <h2>{t("settings.workspace")}</h2>
          {ws.data ? <WorkspaceName ws={ws.data} /> : <PanelSkeleton rows={1} />}
          {ws.data ? <BrandColor ws={ws.data} /> : <PanelSkeleton rows={1} />}
          <div className="grid gap-1.5">
            <Label>{t("common.interfaceLanguage")}</Label>
            <div>
              <LanguageToggle long persist />
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHead>
            <h2>{t("settings.clientSetup")}</h2>
            <Link href="/onboarding" className={buttonVariants({ size: "sm" })}>
              {t("settings.editSetup")}
            </Link>
          </PanelHead>
          {ws.data ? (
            <div>
              <Row label={t("settings.setupProgress")}>
                <span className="font-mono num">{t("onboarding.setupPct", { pct: percentOf(ws.data) })}</span>
              </Row>
              <Row label={t("settings.tour")}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    startReplay()
                    router.push("/brain")
                  }}
                >
                  {t("tour.replay")}
                </Button>
              </Row>
            </div>
          ) : (
            <PanelSkeleton rows={2} />
          )}
        </Panel>

        {metaOff ? null : (
          <Panel>
            <PanelHead>
              <h2>{t("settings.connections")}</h2>
              <Link href="/settings/connections" className={buttonVariants({ size: "sm" })}>
                {t("settings.manage")}
              </Link>
            </PanelHead>
            {conn.isPending ? (
              <PanelSkeleton rows={1} />
            ) : (
              <Row label={t("settings.service.META")}>
                <StatusChip status={metaIsReady ? "approved" : metaStatus === "TOKEN_INVALID" ? "failed" : "draft"}>
                  {metaIsReady
                    ? `${t("settings.connected")}${metaSyncedAt ? ` · ${t("meta.settings.synced", { ago: rel(metaSyncedAt) })}` : ""}`
                    : metaStatus === "TOKEN_INVALID"
                      ? t("meta.expiredTitle")
                      : t("settings.notConnected")}
                </StatusChip>
              </Row>
            )}
          </Panel>
        )}

        <AccountModeCard />

        {/* amostra-gratis-v1 §5: renders only for an INTERNAL OWNER */}
        <UnlockAccountCard />

        <Panel>
          <PanelHead>
            <h2>{t("settings.members")}</h2>
            {ws.data ? <InviteDialog workspace={ws.data.name} /> : null}
          </PanelHead>
          {members.data ? (
            <div>
              {members.data.members.map((m) => (
                <Row key={m.userId} label={<Who initials={m.initials} name={m.name} />}>
                  {t(`settings.roles.${m.role}`)}
                </Row>
              ))}
              {members.data.invites.map((i) => (
                <Row key={i.id} label={<span className="text-fg-2">{i.email}</span>}>
                  {t("settings.pendingInvite", { date: format.dateTime(new Date(i.expiresAt), { month: "short", day: "numeric" }) })}
                </Row>
              ))}
            </div>
          ) : (
            <PanelSkeleton rows={2} />
          )}
        </Panel>

        <Panel>
          <h2>{t("settings.services")}</h2>
          {services.data ? (
            <div>
              {services.data.map((s) => (
                <Row key={s.provider} label={t(`settings.service.${s.provider}`)}>
                  <StatusChip status={s.connected ? "approved" : "draft"}>
                    {s.connected ? t("settings.connected") : t("settings.notConnected")}
                    {s.keyMasked ? ` · ${s.keyMasked}` : ""}
                  </StatusChip>
                </Row>
              ))}
            </div>
          ) : (
            <PanelSkeleton rows={2} />
          )}
        </Panel>

        <Panel>
          <h2>{t("settings.spend")}</h2>
          {spend.data ? (
            <div>
              <Row label={t("settings.thisMonth")}>
                <span className="font-mono num">{usd(spend.data.spentUsd)}</span>
              </Row>
              <Row label={t("settings.monthlyCap")}>
                <span className="font-mono num">{spend.data.capUsd === null ? t("settings.noCap") : usd(spend.data.capUsd)}</span>
              </Row>
            </div>
          ) : (
            <PanelSkeleton rows={2} />
          )}
        </Panel>
      </div>
    </Page>
  )
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="sk h-[34px]" />
      ))}
    </div>
  )
}

/** estatico-montado D3: Workspace.brandColor, autosaved like the name (PATCH /workspace { brandColor }). */
function BrandColor({ ws }: { ws: Workspace }) {
  const t = useTranslations("brandColor")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [value, setValue] = useState(ws.brandColor ?? "")
  const save = useMutation({
    mutationFn: (v: string | null) => api.workspace.update({ brandColor: v }),
    onSuccess: (w, v) => {
      qc.setQueryData(["workspace"], w)
      setValue(w.brandColor ?? "")
      toast(
        <>
          <Icon name="check" />
          {v ? t("saved") : t("cleared")}
        </>
      )
    },
    onError: (e) => {
      setValue(ws.brandColor ?? "")
      toast(errorMessage(e))
    },
  })
  return (
    <BrandColorField
      id="ws-brand-color"
      value={value}
      onChange={setValue}
      disabled={save.isPending}
      onCommit={(v) => v !== (ws.brandColor ?? null) && save.mutate(v)}
    />
  )
}

function WorkspaceName({ ws }: { ws: Workspace }) {
  const t = useTranslations("settings")
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [name, setName] = useState(ws.name)
  const save = useMutation({
    mutationFn: (n: string) => api.workspace.update({ name: n }),
    onSuccess: (w) => {
      qc.setQueryData(["workspace"], w)
      toast(
        <>
          <Icon name="check" />
          {t("nameSaved")}
        </>
      )
    },
    onError: (e) => {
      setName(ws.name)
      toast(errorMessage(e))
    },
  })
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="ws">{t("name")}</Label>
      {/* autosave on blur */}
      <Input
        id="ws"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== ws.name && save.mutate(name.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  )
}
