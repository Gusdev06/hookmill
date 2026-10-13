import type { AuthSession, CreateClientBody, CreateClientResponse, SignupBody, SignupResponse } from "@/lib/api/types"
import { mockAuth } from "@/mocks/auth"

/**
 * Server-side calls to the API auth routes (used only by /api/session).
 * With NEXT_PUBLIC_API_MOCKING=enabled the browser MSW worker can't reach this
 * server code, so the same fixtures answer here.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1").replace(/\/$/, "")
export const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled"

export class AuthFailure extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) {
    super(message)
  }
}

async function call<T>(path: string, body: unknown, bearer?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new AuthFailure("NETWORK", 503, "API unreachable")
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) {
    throw new AuthFailure(json?.error?.code ?? "INTERNAL_ERROR", res.status, json?.error?.message ?? res.statusText, json?.error?.details)
  }
  return json.data as T
}

export const authServer = {
  login: (email: string, password: string) =>
    MOCKING ? mockAuth.login(email, password) : call<AuthSession>("/auth/login", { email, password }),
  acceptInvite: (token: string, name: string, password: string) =>
    MOCKING ? mockAuth.acceptInvite(token, name, password) : call<AuthSession>(`/auth/invites/${encodeURIComponent(token)}/accept`, { name, password }),
  /** fase2-cadastro §3 POST /auth/signup (public): new account + its first client (OWNER, SETUP), same session as login. */
  signup: (body: SignupBody) =>
    MOCKING ? mockAuth.signup(body) : call<SignupResponse>("/auth/signup", body),
  refresh: (refreshToken: string) =>
    MOCKING ? mockAuth.refresh(refreshToken) : call<AuthSession>("/auth/refresh", { refreshToken }),
  /** contract §2 POST /auth/switch-workspace (Bearer = current access token): tokens for the other workspace. */
  switchWorkspace: (workspaceId: string, accessToken: string) =>
    MOCKING ? mockAuth.switchWorkspace(workspaceId) : call<AuthSession>("/auth/switch-workspace", { workspaceId }, accessToken),
  /** fase2-agencia §3.2 POST /workspaces (Bearer = current access token): creates the client and answers tokens for it. */
  createClient: (body: CreateClientBody, accessToken: string) =>
    MOCKING ? mockAuth.createClient(body) : call<CreateClientResponse>("/workspaces", body, accessToken),
  logout: async (refreshToken: string, accessToken?: string) => {
    if (MOCKING) return
    await call("/auth/logout", { refreshToken }, accessToken).catch(() => undefined)
  },
}
