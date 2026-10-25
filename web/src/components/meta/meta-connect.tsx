"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNow, useTranslations } from "next-intl"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { MetaAdAccountOption, MetaConnectBody, MetaConnection, MetaConnectResponse, MetaHealth, MetaHealthCheck, MetaOAuthErrorCode } from "@/lib/api/types"
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Icon } from "@/components/icon"
import { useErrorMessage } from "@/hooks/use-error-message"
import { ME_KEY } from "@/hooks/use-me"
import { isMetaOff, metaActive, mk, useMetaConnection, useRelativeTime } from "@/hooks/use-meta"
import { cn } from "@/lib/utils"

/*
 * MetaConnect (onboarding-v2 spec §4, decision 6): ONE component in two places, step 2 of the setup and Settings ›
 * Connections. States: idle · connecting · choose · checking · ok · warning · blocked · error (+ expired, off).
 * OAuth (meta-v1 §3.1): POST /meta/connect → the browser goes to Meta in the same tab → the API callback brings it
 * back to `returnTo?meta=connected` or `?meta=error&code=`. The token never reaches the web.
 * "Connect from another browser" (22/10, Gusta's Multilogin/AdsPower case): POST /meta/connect { returnTo: '/meta/done' }
 * → this tab shows the URL with Copy link and a 10-min countdown and polls GET /meta/oauth/status every 3 s; the login
 * happens in the browser where that Facebook is signed in and ends on /meta/done. `connectedAt` → GET /meta/connection
 * and the account picker; `lastError` → the same alert as the normal flow, with "New link".
 */
export type MetaState = "idle" | "connecting" | "choose" | "checking" | "ok" | "warning" | "blocked" | "error" | "expired" | "off"
const OAUTH_CODES: MetaOAuthErrorCode[] = ["META_OAUTH_DENIED", "META_OAUTH_FAILED", "META_STATE_INVALID", "META_SCOPES_MISSING", "META_UNAVAILABLE"]
/** the 4 lines of the design, always shown; the other checks appear only when they are not ok */
const MAIN_CHECKS: MetaHealthCheck["key"][] = ["account", "funding", "pixel", "verified"]
const oauthCode = (c: unknown): MetaOAuthErrorCode => (OAUTH_CODES.includes(c as MetaOAuthErrorCode) ? (c as MetaOAuthErrorCode) : "META_OAUTH_FAILED")
type OauthError = { code: MetaOAuthErrorCode; missing: string[]; remote?: boolean }
/** the link + what GET /meta/oauth/status already held before it (older results are not this attempt's) */
type RemoteLink = MetaConnectResponse & { before: { errorAt: string | null; connectedAt: string | null } }

export function useMetaConnect(returnTo: MetaConnectBody["returnTo"]) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const qc = useQueryClient()
  const connection = useMetaConnection()
  const conn = connection.data ?? null
  const active = metaActive(conn)
  const selected = active && !!conn.adAccount && !!conn.page
  const [changing, setChanging] = useState(false)
  // the callback's query (?meta=connected | ?meta=error&code=…) is read at mount, then removed from the URL
  const flag = sp.get("meta")
  const [oauthError, setOauthError] = useState<OauthError | null>(() => {
    const code = sp.get("code")
    if (sp.get("meta") !== "error" || !code) return null
    return { code: oauthCode(code), missing: sp.get("missing")?.split(",").filter(Boolean) ?? [] }
  })
  // also set when the login finished elsewhere (other browser / popup): keeps "Reading…" while the connection is refetched
  const [returned, setReturned] = useState(() => sp.get("meta") === "connected")
  const [accountPick, setAccountPick] = useState<string | null>(null)
  const [pagePick, setPagePick] = useState<string | null>(null)
  // undefined = the account's first pixel (default) · null = "No pixel" chosen
  const [pixelPick, setPixelPick] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!flag) return
    if (flag === "connected") void qc.invalidateQueries({ queryKey: mk.connection })
    router.replace(pathname, { scroll: false })
  }, [flag, pathname, router, qc])

  const picking = active && (!selected || changing)
  const base = useQuery({
    queryKey: mk.options(null),
    queryFn: ({ signal }) => api.meta.options({}, { signal }),
    enabled: picking,
    staleTime: 60_000,
  })
  // defaults: the first manageable account and the first Page (derived, no effect)
  const account = accountPick ?? base.data?.adAccounts.find((a) => a.canManage)?.id ?? null
  const page = pagePick ?? base.data?.pages[0]?.id ?? null
  // pixels of the chosen account (contract: empty until `?adAccountId=`)
  const pixels = useQuery({
    queryKey: mk.options(account),
    queryFn: ({ signal }) => api.meta.options({ adAccountId: account! }, { signal }),
    enabled: picking && !!account,
    staleTime: 60_000,
  })
  const options = { ...base, data: base.data ? { ...base.data, pixels: pixels.data?.pixels ?? [] } : base.data }
  const pixel = pixelPick === undefined ? (pixels.data?.pixels[0]?.id ?? null) : pixelPick
  const setPixel = (v: string | null | undefined) => setPixelPick(v)
  const setAccount = (v: string | null) => setAccountPick(v)
  const setPage = (v: string | null) => setPagePick(v)

  const connect = useMutation({
    mutationFn: () => api.meta.connect({ returnTo }),
    onSuccess: ({ url }) => {
      // external navigation to Meta's dialog (not an internal route)
      window.location.href = url
    },
  })
  const select = useMutation({
    mutationFn: (b: { adAccountId: string; pageId: string; pixelId: string | null }) => api.meta.select(b),
    onSuccess: (c) => {
      qc.setQueryData(mk.connection, c)
      setChanging(false)
      void qc.invalidateQueries({ queryKey: ["meta"] })
      void qc.invalidateQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ["workspace"] })
    },
  })
  const health = useMutation({
    mutationFn: () => api.meta.health(),
    onSuccess: (h) => qc.setQueryData<MetaConnection | null>(mk.connection, (c) => (c ? { ...c, health: h } : c)),
  })
  // ── "Connect from another browser": the link + polling of GET /meta/oauth/status (meta-v1 §3.1, 22/10)
  const [remote, setRemote] = useState<RemoteLink | null>(null)
  const remoteLink = useMutation({
    mutationFn: async (): Promise<RemoteLink> => {
      // what the status held before this attempt (a result left by an earlier login is not ours); 404 while B1 lands = nothing
      const prev = await api.meta.oauthStatus().catch(() => null)
      const r = await api.meta.connect({ returnTo: "/meta/done" })
      return { ...r, before: { errorAt: prev?.lastError?.at ?? null, connectedAt: prev?.connectedAt ?? null } }
    },
    onMutate: () => {
      // QA 22/10 (bug 13): drop the previous attempt entirely (its `pending: false` must not settle the new link)
      setOauthError(null)
      setRemote(null)
      qc.removeQueries({ queryKey: mk.oauthStatus })
    },
    onSuccess: (r) => setRemote(r),
  })
  const remoteStatus = useQuery({
    // one query per link: only statuses read after this link's POST /meta/connect count
    queryKey: [...mk.oauthStatus, remote?.url ?? ""],
    queryFn: ({ signal }) => api.meta.oauthStatus({ signal }),
    enabled: !!remote,
    staleTime: 0,
    retry: false,
    // every 3 s while pending (or while the route can't be read); stops when the API says the attempt is over
    refetchInterval: (q) => (q.state.data && !q.state.data.pending ? false : 3000),
  })
  const st = remote ? remoteStatus.data : undefined
  const settled = !!remote && !!st && !st.pending
  // derived, no state: the panel closes itself when the attempt is over (the hook's answer flips, the view follows)
  const remoteConnected = settled && !!st.connectedAt && st.connectedAt !== remote.before.connectedAt
  const remoteFailed = settled && !remoteConnected && st.lastError && st.lastError.at !== remote.before.errorAt ? st.lastError : null
  const remoteExpired = settled && !remoteConnected && !remoteFailed
  const remoteOpen = !!remote && !remoteConnected && !remoteFailed
  const shownOauthError: OauthError | null = oauthError ?? (remoteFailed ? { code: oauthCode(remoteFailed.code), missing: remoteFailed.missing ?? [], remote: true } : null)
  useEffect(() => {
    if (remoteConnected) void qc.invalidateQueries({ queryKey: mk.connection })
  }, [remoteConnected, qc])
  const cameBack = returned || remoteConnected
  // popup flow (/meta/done posts `meta:done` to its opener): same outcome as coming back with `?meta=`
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; meta?: unknown; code?: unknown; missing?: unknown } | null
      if (e.origin !== window.location.origin || !d || d.type !== "meta:done") return
      if (d.meta === "connected") {
        setReturned(true)
        void qc.invalidateQueries({ queryKey: mk.connection })
      } else if (d.meta === "error") {
        setOauthError({ code: oauthCode(d.code), missing: Array.isArray(d.missing) ? d.missing.filter((x): x is string => typeof x === "string") : [] })
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [qc])

  const disconnect = useMutation({
    mutationFn: () => api.meta.disconnect(),
    onSuccess: () => {
      qc.setQueryData(mk.connection, null)
      setChanging(false)
      setAccountPick(null)
      setPagePick(null)
      setPixelPick(undefined)
      void qc.invalidateQueries({ queryKey: ["meta"] })
      void qc.invalidateQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ["workspace"] })
    },
  })
  // a selection without a health result (older connection): run the check once
  const checked = useRef(false)
  useEffect(() => {
    if (selected && !conn.health && !health.isPending && !checked.current) {
      checked.current = true
      health.mutate()
    }
  }, [selected, conn, health])
  // QA 21/10 (bug 4): the health card said "Ads found 0 · 0 active" until "Check again". While the sync runs the
  // connection is polled; when `syncing` flips to false the health is read again, so the counts arrive by themselves.
  const syncing = !!conn?.syncing
  const wasSyncing = useRef(false)
  useEffect(() => {
    if (syncing) {
      wasSyncing.current = true
      const t = setInterval(() => void qc.invalidateQueries({ queryKey: mk.connection }), 3000)
      return () => clearInterval(t)
    }
    if (wasSyncing.current && selected) {
      wasSyncing.current = false
      health.mutate()
      void qc.invalidateQueries({ queryKey: ["meta", "summary"] })
      void qc.invalidateQueries({ queryKey: ["meta", "ads"] })
    }
  }, [syncing, selected, qc, health])

  let state: MetaState
  if (connection.isError && isMetaOff(connection.error)) state = "off"
  else if (shownOauthError) state = "error"
  else if (connect.isPending || connect.isSuccess || (cameBack && (connection.isPending || connection.isFetching) && !active) || (picking && base.isPending)) state = "connecting"
  else if (connection.isError) state = "error"
  else if (!conn || conn.status === "DISCONNECTED") state = "idle"
  else if (conn.status === "TOKEN_INVALID") state = "expired"
  else if (picking) state = "choose"
  else if (select.isPending || health.isPending || !conn.health) state = "checking"
  else if (conn.health.level === "bad" && !conn.health.canPublish) state = "blocked"
  else if (conn.health.level === "warn" || conn.health.level === "bad") state = "warning"
  else state = "ok"

  const chosenOption = options.data?.adAccounts.find((a) => a.id === account) ?? null
  const canUse = !!account && !!page && !!chosenOption?.canManage && !select.isPending
  return {
    state, conn, connection, options, account, setAccount, page, setPage, pixel, setPixel, chosenOption, canUse,
    oauthError: shownOauthError, clearOauthError: () => { setOauthError(null); setRemote(null) },
    start: () => { setOauthError(null); setRemote(null); connect.mutate() }, connectError: connect.error,
    remote: remoteOpen ? remote : null, remoteStart: () => remoteLink.mutate(), remotePending: remoteLink.isPending, remoteError: remoteLink.error, remoteExpired,
    remoteCancel: () => { setRemote(null); qc.removeQueries({ queryKey: mk.oauthStatus }) },
    use: () => account && page && select.mutate({ adAccountId: account, pageId: page, pixelId: pixel }),
    selectError: select.error, recheck: () => health.mutate(), rechecking: health.isPending, healthError: health.error,
    change: () => { setChanging(true); setAccountPick(conn?.adAccount?.id ?? null); setPagePick(conn?.page?.id ?? null); setPixelPick(conn?.pixel?.id ?? null) },
    cancelChange: () => setChanging(false), changing,
    disconnect: () => disconnect.mutate(), disconnecting: disconnect.isPending,
  }
}
export type MetaConnectModel = ReturnType<typeof useMetaConnect>

// ───────────────────────── pieces ─────────────────────────
function FbSquare({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-grid size-10 flex-none place-items-center rounded-md bg-meta text-xl font-extrabold text-white", className)}>
      f
    </span>
  )
}

/** mockup .conn: who is logged in / which account is chosen, with one action on the right */
function ConnBar({ title, sub, action }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line-soft bg-card-2 p-3.5">
      <FbSquare />
      <span className="flex min-w-0 flex-[1_1_200px] flex-col">
        <b className="truncate">{title}</b>
        {sub ? <small className="text-[13px] text-fg-3">{sub}</small> : null}
      </span>
      {action}
    </div>
  )
}

export function FacebookButton({ onClick, pending, size = "lg", className, children }: { onClick: () => void; pending?: boolean; size?: "lg" | "default"; className?: string; children: React.ReactNode }) {
  return (
    <Button variant="meta" size={size} onClick={onClick} disabled={pending} aria-busy={pending} className={cn("self-start", className)}>
      {pending ? <span className="spin-ring size-4 border-white/60 border-t-transparent" aria-hidden="true" /> : <span aria-hidden="true" className="text-lg leading-none font-extrabold">f</span>}
      {children}
    </Button>
  )
}

function HealthList({ rows }: { rows: { key: string; level: "ok" | "warn" | "bad" | "wait"; title: React.ReactNode; detail?: React.ReactNode }[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((r) => (
        <li key={r.key} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "mt-px inline-grid size-[22px] flex-none place-items-center rounded-full",
              r.level === "ok" && "bg-status-approved-bg text-status-approved",
              r.level === "warn" && "bg-status-waiting-bg text-status-waiting",
              r.level === "bad" && "bg-status-failed-bg text-status-failed",
              r.level === "wait" && "border-[1.5px] border-control"
            )}
          >
            {r.level === "ok" ? <Icon name="check" /> : r.level === "bad" ? <Icon name="x" /> : r.level === "warn" ? <Icon name="minus" /> : null}
          </span>
          <span className="flex min-w-0 flex-col">
            <b>{r.title}</b>
            {r.detail ? <small className="text-[13px] text-fg-3">{r.detail}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

function useHealthRows() {
  const t = useTranslations("meta")
  return (h: MetaHealth | null): Parameters<typeof HealthList>[0]["rows"] => {
    if (!h) return MAIN_CHECKS.map((k) => ({ key: k, level: "wait", title: t(`check.${k}`) }))
    const byKey = new Map(h.checks.map((c) => [c.key, c]))
    const rows = MAIN_CHECKS.map((k) => {
      const c = byKey.get(k)
      return { key: k, level: c?.level ?? ("wait" as const), title: t(`check.${k}`), detail: c?.detail ?? undefined }
    })
    for (const c of h.checks) if (!MAIN_CHECKS.includes(c.key) && c.level !== "ok") rows.unshift({ key: c.key, level: c.level, title: t(`check.${c.key}`), detail: c.detail ?? undefined })
    return rows
  }
}

function HealthTag({ h }: { h: MetaHealth | null }) {
  const t = useTranslations("meta.health")
  if (!h) return null
  const warns = h.checks.filter((c) => c.level !== "ok").length
  const cls = h.level === "ok" ? "bg-status-approved-bg text-status-approved" : h.level === "bad" && !h.canPublish ? "bg-status-failed-bg text-status-failed" : "bg-status-waiting-bg text-status-waiting"
  return <span className={cn("inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", cls)}>{h.level === "ok" ? t("ok") : h.level === "bad" && !h.canPublish ? t("blocked") : t("warn", { count: warns })}</span>
}

function AccountRow({ a, checked }: { a: MetaAdAccountOption; checked: boolean }) {
  const t = useTranslations("meta")
  const ok = a.canManage
  return (
    <RadioGroupPrimitive.Item
      value={a.id}
      disabled={!ok}
      aria-describedby={ok ? undefined : "meta-noperm"}
      className={cn(
        "flex w-full min-h-11 items-center gap-3 rounded-md border bg-card px-3.5 py-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "border-fg shadow-[0_0_0_1px_var(--fg)]" : "border-line hover:border-fg",
        !ok && "cursor-not-allowed hover:border-line"
      )}
    >
      <span aria-hidden="true" className={cn("inline-grid size-5 flex-none place-items-center rounded-full border-[1.5px]", checked ? "border-fg" : "border-control")}>
        {checked ? <span className="size-2.5 rounded-full bg-fg" /> : null}
      </span>
      <span className={cn("flex min-w-0 flex-1 flex-col", !ok && "opacity-55")}>
        <b className="truncate">{a.name}</b>
        <small className="font-mono text-xs text-fg-3">
          {a.id} · {a.currency}
        </small>
      </span>
      <span className={cn("inline-flex h-fit items-center rounded-full px-2 py-[3px] text-[11px] font-bold whitespace-nowrap", ok ? "bg-status-approved-bg text-status-approved" : "bg-status-failed-bg text-status-failed")}>
        {ok ? t("active") : t("noPermission")}
      </span>
    </RadioGroupPrimitive.Item>
  )
}

/** The dark "Why connect" panel (onboarding only, mockup .ink). */
export function WhyConnect() {
  const t = useTranslations("meta.why")
  const rows: [string, string][] = [
    [t("k1"), t("v1")],
    [t("k2"), t("v2")],
    [t("k3"), t("v3")],
  ]
  return (
    <div className="on-ink flex min-w-0 flex-col gap-3.5 rounded-xl bg-ink p-[22px] text-ink-body">
      <span className="eyebrow text-ink-fg-2">{t("title")}</span>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2.5 border-b border-ink-line pb-2.5 last:border-b-0 last:pb-0">
            <span className="text-ink-fg-2">{k}</span>
            <span className="text-right font-semibold text-white">{v}</span>
          </li>
        ))}
      </ul>
      <span className="border-t border-ink-line pt-3 text-[13px] text-ink-fg-2">{t("note")}</span>
    </div>
  )
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

/**
 * The link for the other browser: read-only URL + Copy link, "expires in m:ss" from `expiresAt`, "New link" when it
 * expired (by the clock here or by the API saying the attempt is over). The polling lives in the hook.
 */
function RemotePanel({ m }: { m: MetaConnectModel }) {
  const t = useTranslations("meta.remote")
  const tc = useTranslations("common")
  const now = useNow({ updateInterval: 1000 })
  const link = m.remote!
  const left = Math.max(0, Math.ceil((Date.parse(link.expiresAt) - now.getTime()) / 1000))
  const expired = left <= 0 || m.remoteExpired
  const copy = () =>
    navigator.clipboard.writeText(link.url).then(() =>
      toast(
        <>
          <Icon name="check" />
          {tc("copied")}
        </>
      )
    )
  return (
    <div id="meta-remote" className="flex flex-col gap-3 rounded-md border border-line-soft bg-card-2 p-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="text-sm">{t("title")}</b>
          <span className="text-[13px] text-fg-3 text-pretty">{t("body")}</span>
        </span>
        <Button variant="ghost" size="icon-sm" onClick={m.remoteCancel} aria-label={tc("close")} className="-mt-1 -mr-1 flex-none">
          <Icon name="x" />
        </Button>
      </div>
      {expired ? (
        <Alert variant="warning">
          <Icon name="clock" />
          <AlertBody>
            <AlertTitle>{t("expired")}</AlertTitle>
          </AlertBody>
          <AlertActions>
            <Button size="sm" onClick={m.remoteStart} disabled={m.remotePending} aria-busy={m.remotePending}>
              <Icon name="link" />
              {t("newLink")}
            </Button>
          </AlertActions>
        </Alert>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="meta-remote-url">{t("label")}</Label>
            <div className="flex flex-col gap-2 tablet:flex-row">
              <Input id="meta-remote-url" readOnly value={link.url} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={copy} className="tablet:flex-none">
                <Icon name="copy" />
                {t("copy")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3" role="status" aria-live="polite">
            <span className="spin-ring size-3.5 flex-none" aria-hidden="true" />
            <span className="min-w-0 flex-[1_1_200px]">{t("waiting")}</span>
            <span className="font-mono tabular-nums">{t("expiresIn", { time: mmss(left) })}</span>
          </div>
        </>
      )}
    </div>
  )
}

function OauthAlert({ m }: { m: MetaConnectModel }) {
  const t = useTranslations("meta")
  const errorMessage = useErrorMessage()
  if (m.oauthError) {
    const { code, missing } = m.oauthError
    return (
      <Alert variant="destructive">
        <Icon name="alert" />
        <AlertBody>
          <AlertTitle>{t("loginFailed")}</AlertTitle>
          <AlertDescription>{code === "META_SCOPES_MISSING" ? t("oauth.META_SCOPES_MISSING", { list: missing.join(", ") || "—" }) : t(`oauth.${code}`)}</AlertDescription>
        </AlertBody>
        <AlertActions>
          {m.oauthError.remote ? (
            <Button size="sm" variant="default" onClick={m.remoteStart} disabled={m.remotePending} aria-busy={m.remotePending}>
              <Icon name="link" />
              {t("remote.newLink")}
            </Button>
          ) : null}
          <Button size="sm" variant={m.oauthError.remote ? "outline" : "default"} onClick={m.start}>
            <Icon name="refresh" />
            {t("tryAgain")}
          </Button>
        </AlertActions>
      </Alert>
    )
  }
  const e = m.connectError ?? m.remoteError ?? (m.connection.isError && !isMetaOff(m.connection.error) ? m.connection.error : null) ?? m.selectError ?? m.healthError
  if (!e) return null
  const permission = isApiError(e) && e.code === "META_PERMISSION"
  return (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{permission ? t("blockedTitle") : t("loadFailed")}</AlertTitle>
        <AlertDescription>{permission ? t("blockedBody") : errorMessage(e)}</AlertDescription>
      </AlertBody>
      {m.connection.isError ? (
        <AlertActions>
          <Button size="sm" onClick={() => m.connection.refetch()}>
            <Icon name="refresh" />
            {t("tryAgain")}
          </Button>
        </AlertActions>
      ) : null}
    </Alert>
  )
}

// ───────────────────────── the component ─────────────────────────
/**
 * `mode="onboarding"`: the cards of step 2 (the action bar belongs to the step). `mode="settings"`: one card "Meta" with the
 * connected state, Check again, Change account and Disconnect.
 */
export function MetaConnect({ m, mode, clientName }: { m: MetaConnectModel; mode: "onboarding" | "settings"; clientName: string }) {
  const t = useTranslations("meta")
  const rel = useRelativeTime()
  const rowsOf = useHealthRows()
  const { state, conn } = m
  const cardCls = "flex min-w-0 flex-col gap-3.5 rounded-xl border border-line bg-card p-4 tablet:p-5"

  if (state === "off") return null

  const permList = (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
      <li className="flex items-start gap-2">
        <Icon name="check" className="mt-0.5 text-status-approved" />
        {t("perm1")}
      </li>
      <li className="flex items-start gap-2">
        <Icon name="check" className="mt-0.5 text-status-approved" />
        {t("perm2")}
      </li>
      <li className="flex items-start gap-2 text-fg-3">
        <Icon name="x" className="mt-0.5" />
        {t("perm3")}
      </li>
    </ul>
  )

  // ── idle / error / expired: the Facebook button
  if (state === "idle" || state === "error" || state === "expired") {
    return (
      <>
        {state === "expired" ? (
          <Alert variant="warning">
            <Icon name="alert" />
            <AlertBody>
              <AlertTitle>{t("expiredTitle")}</AlertTitle>
              <AlertDescription>{t("expiredBody")}</AlertDescription>
            </AlertBody>
          </Alert>
        ) : null}
        <OauthAlert m={m} />
        <div className={cardCls}>
          {mode === "onboarding" ? (
            <>
              <h2 className="text-base font-bold">{t("connectCardTitle", { name: clientName })}</h2>
              <p className="m-0 -mt-2 text-[13px] text-fg-3 text-pretty">{t("connectCardSub", { name: clientName })}</p>
            </>
          ) : (
            <p className="m-0 text-[13px] text-fg-3 text-pretty">{t("settings.lede")}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FacebookButton onClick={m.start} pending={m.connection.isPending && !m.connection.isError}>
              {state === "expired" ? t("reconnect") : t("cta")}
            </FacebookButton>
            <button
              type="button"
              onClick={m.remoteStart}
              disabled={m.remotePending}
              aria-busy={m.remotePending}
              aria-expanded={!!m.remote}
              aria-controls="meta-remote"
              className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-fg-2 underline underline-offset-2 hover:text-fg disabled:opacity-50"
            >
              {m.remotePending ? <span className="spin-ring size-3.5" aria-hidden="true" /> : <Icon name="link" />}
              {t("remote.cta")}
            </button>
          </div>
          {m.remote ? <RemotePanel m={m} /> : null}
          {mode === "onboarding" ? (
            <>
              <div className="border-t border-line-soft" />
              <h3 className="text-sm font-bold">{t("askFor")}</h3>
              {permList}
            </>
          ) : null}
        </div>
      </>
    )
  }

  // ── connecting: redirecting to Meta / reading what came back
  if (state === "connecting") {
    const loggedIn = !!conn && conn.status === "ACTIVE"
    const rows = [
      { key: "login", level: loggedIn ? ("ok" as const) : ("wait" as const), title: t("step.login") },
      { key: "accounts", level: "wait" as const, title: t("step.accounts") },
      { key: "pages", level: "wait" as const, title: t("step.pages") },
    ]
    return (
      <div className={cn(cardCls, "beam relative")} role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="spin-ring size-4" aria-hidden="true" />
          <span className="flex flex-col">
            <b>{t("reading")}</b>
            <span className="text-[13px] text-fg-3">{loggedIn ? t("readingAs", { name: conn.user.name }) : t("readingSub")}</span>
          </span>
        </div>
        <HealthList rows={rows} />
        <span className="text-xs text-fg-3">{t("readingLeave")}</span>
      </div>
    )
  }

  // ── choose: ad account + Page (+ pixel)
  if (state === "choose" && conn) {
    const o = m.options.data
    const accounts = o?.adAccounts ?? []
    const pages = o?.pages ?? []
    const pixels = (o?.pixels ?? []).filter((p) => !p.adAccountId || p.adAccountId === m.account)
    return (
      <>
        <OauthAlert m={m} />
        <ConnBar
          title={conn.user.name}
          sub={t("loggedIn", { accounts: accounts.length, pages: pages.length })}
          action={
            m.changing ? (
              <Button variant="ghost" size="sm" onClick={m.cancelChange}>
                {t("cancel")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={m.start}>
                {t("useAnotherLogin")}
              </Button>
            )
          }
        />
        <div className={cardCls}>
          <h2 className="text-base font-bold">{t("chooseAccount", { name: clientName })}</h2>
          {m.options.isError ? (
            <Alert variant="destructive">
              <Icon name="alert" />
              <AlertBody>
                <AlertTitle>{t("loadFailed")}</AlertTitle>
              </AlertBody>
              <AlertActions>
                <Button size="sm" onClick={() => m.options.refetch()}>
                  <Icon name="refresh" />
                  {t("tryAgain")}
                </Button>
              </AlertActions>
            </Alert>
          ) : accounts.length ? (
            <RadioGroupPrimitive.Root value={m.account ?? ""} onValueChange={(v) => { m.setAccount(v); m.setPixel(undefined) }} aria-label={t("chooseAccount", { name: clientName })} className="flex flex-col gap-2">
              {accounts.map((a) => (
                <AccountRow key={a.id} a={a} checked={m.account === a.id} />
              ))}
            </RadioGroupPrimitive.Root>
          ) : (
            <p className="m-0 text-[13px] text-fg-3">{t("noAccounts")}</p>
          )}
          <span id="meta-noperm" className="text-xs text-fg-3">
            {t("notHere")}{" "}
            <button type="button" onClick={() => m.options.refetch()} className="font-semibold text-fg underline underline-offset-2 hover:text-brand-ink">
              {t("refresh")}
            </button>
          </span>
        </div>
        <div className={cardCls}>
          <h2 className="text-base font-bold">{t("choosePage")}</h2>
          <div className="grid gap-1.5">
            <Label htmlFor="meta-page">{t("pageLabel")}</Label>
            <Select value={m.page ?? ""} onValueChange={m.setPage}>
              <SelectTrigger id="meta-page" className="w-full">
                <SelectValue placeholder={t("pageLabel")} />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-fg-3">{t("pageHint")}</span>
          </div>
          {pixels.length ? (
            <div className="grid gap-1.5">
              <Label htmlFor="meta-pixel">
                {t("pixelLabel")} <span className="font-normal text-fg-3">{t("optional")}</span>
              </Label>
              <Select value={m.pixel ?? "none"} onValueChange={(v) => m.setPixel(v === "none" ? null : v)}>
                <SelectTrigger id="meta-pixel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noPixel")}</SelectItem>
                  {pixels.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {mode === "settings" ? (
            <div>
              <Button variant="brand" onClick={m.use} disabled={!m.canUse} aria-busy={m.selectError ? undefined : undefined}>
                {t("useAccount")}
                <Icon name="arrowr" />
              </Button>
            </div>
          ) : null}
        </div>
      </>
    )
  }

  // ── checking / ok / warning / blocked: the health card
  const h = conn?.health ?? null
  const rows = state === "checking" ? rowsOf(null) : rowsOf(h)
  const blocked = state === "blocked"
  return (
    <>
      <OauthAlert m={m} />
      {conn ? (
        <ConnBar
          title={conn.adAccount ? `${conn.adAccount.name} · ${conn.adAccount.id}` : conn.user.name}
          sub={[conn.page ? t("pageIs", { page: conn.page.name }) : null, t("loggedAs", { name: conn.user.name }), mode === "settings" && conn.lastSyncAt ? t("settings.synced", { ago: rel(conn.lastSyncAt) }) : null].filter(Boolean).join(" · ")}
          action={
            mode === "onboarding" ? (
              <Button variant="ghost" size="sm" onClick={m.change} disabled={state === "checking"}>
                {t("change")}
              </Button>
            ) : null
          }
        />
      ) : null}
      <div className={cardCls} aria-busy={state === "checking"}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2 className="text-base font-bold">{t("health.title")}</h2>
          {state === "checking" ? <span className="spin-ring size-4" aria-hidden="true" /> : <HealthTag h={h} />}
        </div>
        {blocked ? <BlockedAlert h={h} /> : null}
        <HealthList rows={rows} />
        {h ? (
          <>
            <div className="border-t border-line-soft" />
            <div className="flex justify-between gap-2.5 text-[13px]">
              <span className="text-fg-3">{t("adsFound")}</span>
              <span className="font-mono">{t("adsFoundValue", { total: h.adsCount, active: h.activeCount })}</span>
            </div>
            <div className="flex justify-between gap-2.5 border-t border-line-soft pt-2 text-[13px]">
              <span className="text-fg-3">{t("resultsRead")}</span>
              <span className="font-mono">{t("last30")}</span>
            </div>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={blocked ? "default" : "outline"} onClick={m.recheck} disabled={m.rechecking || state === "checking"} aria-busy={m.rechecking}>
            <Icon name="refresh" />
            {t("checkAgain")}
          </Button>
          <Button size="sm" variant="outline" onClick={m.change} disabled={state === "checking"}>
            {blocked ? t("chooseAnother") : t("changeAccount")}
          </Button>
          {mode === "settings" ? <DisconnectButton m={m} /> : null}
        </div>
      </div>
    </>
  )
}

/**
 * QA 21/10 (bug 3): the red alert names the real cause, from the first `bad` check that blocks publishing:
 * account disabled → choose another; unpaid balance → fix the payment; otherwise the permission text.
 */
function BlockedAlert({ h }: { h: MetaHealth | null }) {
  const t = useTranslations("meta")
  const bad = h?.checks.find((c) => c.level === "bad" && c.key !== "pixel" && c.key !== "verified") ?? null
  const kind = bad?.key === "account" && !/permission|access|advertiser/i.test(bad.detail ?? "") ? "account" : bad?.key === "funding" ? "funding" : bad?.key === "token" ? "token" : "permission"
  const title = kind === "account" ? t("blockedAccountTitle") : kind === "funding" ? t("blockedFundingTitle") : kind === "token" ? t("expiredTitle") : t("blockedTitle")
  const body = kind === "account" ? t("blockedAccountBody") : kind === "funding" ? t("blockedFundingBody") : kind === "token" ? t("expiredBody") : t("blockedBody")
  return (
    <Alert variant="destructive">
      <Icon name="alert" />
      <AlertBody>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {body}
          {bad?.detail && kind !== "permission" ? <span className="block text-fg-3">{bad.detail}</span> : null}
        </AlertDescription>
      </AlertBody>
    </Alert>
  )
}

function DisconnectButton({ m }: { m: MetaConnectModel }) {
  const t = useTranslations("meta")
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)} disabled={m.disconnecting} aria-busy={m.disconnecting}>
        {t("disconnect")}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("disconnectBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              m.disconnect()
              toast(t("disconnected"))
            }}
          >
            {t("disconnect")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
