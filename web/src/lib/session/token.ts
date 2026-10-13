"use client"

import type { AuthUser, ClientCard, CreateClientBody, ErrorEnvelope, SignupBody, WorkspaceRef } from "@/lib/api/types"
import { ApiError } from "@/lib/api/errors"

/**
 * Access token lives only in memory. The refresh token is in an httpOnly cookie
 * owned by the Next route /api/session (contract §2); the browser never sees it.
 */
export interface ClientSession {
  accessToken: string
  expiresAt: number
  user: AuthUser
  workspace: WorkspaceRef
}

let current: ClientSession | null = null
let inflight: Promise<ClientSession | null> | null = null
const listeners = new Set<(s: ClientSession | null) => void>()

export function getSession() {
  return current
}

export function setSession(s: ClientSession | null) {
  current = s
  listeners.forEach((l) => l(s))
}

export function subscribeSession(l: (s: ClientSession | null) => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

type SessionPayload = { accessToken: string; expiresIn: number; user: AuthUser; workspace: WorkspaceRef }

export function toClientSession(p: SessionPayload): ClientSession {
  return { accessToken: p.accessToken, expiresAt: Date.now() + p.expiresIn * 1000, user: p.user, workspace: p.workspace }
}

/** Rotates the refresh cookie and gets a fresh access token. Deduped: concurrent callers share one request. */
export function refreshSession(): Promise<ClientSession | null> {
  if (!inflight) {
    inflight = fetch("/api/session", { method: "GET", cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null
        return toClientSession((await r.json()) as SessionPayload)
      })
      .catch(() => null)
      .then((s) => {
        setSession(s)
        return s
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Client selector: swaps the session (and the refresh cookie) to another workspace via the BFF. Throws on failure. */
export async function switchWorkspace(workspaceId: string): Promise<ClientSession> {
  const token = await getAccessToken()
  const r = await fetch("/api/session", {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ workspaceId }),
  })
  if (!r.ok) throw new Error(`switch-workspace ${r.status}`)
  const s = toClientSession((await r.json()) as SessionPayload)
  setSession(s)
  return s
}

/**
 * New client (fase2-agencia §3.2): POST /workspaces through the BFF, which keeps the new refresh cookie.
 * The session moves to the new client. Throws ApiError (VALIDATION_ERROR, FORBIDDEN…).
 */
export async function createClient(body: CreateClientBody): Promise<{ session: ClientSession; client: ClientCard }> {
  const token = await getAccessToken()
  const r = await fetch("/api/session/client", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const json = (await r.json().catch(() => null)) as (SessionPayload & { client: ClientCard }) | ErrorEnvelope | null
  if (!r.ok || !json || "success" in json) {
    const err = json && "success" in json ? json.error : null
    throw new ApiError("http", err?.code ?? "INTERNAL_ERROR", r.status, err?.message ?? r.statusText, err?.details as Record<string, unknown> | undefined)
  }
  const s = toClientSession(json)
  setSession(s)
  return { session: s, client: json.client }
}

/**
 * Sign-up (fase2-cadastro §4.3): POST /auth/signup through the BFF, which keeps the refresh cookie like the login.
 * The session starts in the account's first client. Throws ApiError (VALIDATION_ERROR, EMAIL_TAKEN, FORBIDDEN, RATE_LIMITED…).
 */
export async function signup(body: SignupBody): Promise<ClientSession> {
  let r: Response
  try {
    r = await fetch("/api/session/signup", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError("network", "NETWORK", 0, "Network error")
  }
  const json = (await r.json().catch(() => null)) as SessionPayload | ErrorEnvelope | null
  if (!r.ok || !json || "success" in json) {
    const err = json && "success" in json ? json.error : null
    throw new ApiError("http", err?.code ?? "INTERNAL_ERROR", r.status, err?.message ?? r.statusText, err?.details as Record<string, unknown> | undefined)
  }
  const s = toClientSession(json)
  setSession(s)
  return s
}

/** Token for the next request; refreshes 30 s before expiry. */
export async function getAccessToken(): Promise<string | null> {
  if (current && current.expiresAt - Date.now() > 30_000) return current.accessToken
  const s = await refreshSession()
  return s?.accessToken ?? null
}
