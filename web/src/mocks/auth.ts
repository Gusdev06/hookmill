import type { AuthSession, ClientCard, CreateClientBody, CreateClientResponse, SignupBody, SignupResponse, WorkspaceRef } from "@/lib/api/types"
import { ME, WORKSPACE, WORKSPACES } from "./fixtures"

/** Mock auth used by /api/session in mock mode. Credentials: gusta@maquina.dev / maquina123. */
export const MOCK_LOGIN = { email: "gusta@maquina.dev", password: "maquina123" }

class Failure extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) {
    super(message)
  }
}

/** Tokens carry the workspace id (`mock-at-<wid>.<n>`), so refresh and the MSW handlers know the active client. */
export function mockWorkspaceOf(token: string | null | undefined): WorkspaceRef {
  const wid = /^(?:Bearer )?mock-(?:at|rt)-([^.]+)\./.exec(token ?? "")?.[1]
  // clients created with "New client" (POST /workspaces): ws_new_<code>, OWNER (fase2-agencia §3.2)
  if (wid?.startsWith("ws_new_")) return { id: wid, name: NEW_CLIENT_NAME, role: "OWNER", status: "SETUP", onboarding: { step: 1, percent: 0, completedAt: null } }
  return WORKSPACES.find((w) => w.id === wid) ?? WORKSPACES[0]
}
export const NEW_CLIENT_NAME = "New client"

/** The ClientCard of a client that is still in setup (mock of POST /workspaces and GET /workspaces). */
export function mockSetupCard(ref: WorkspaceRef, b: Partial<CreateClientBody> = {}, step = 1): ClientCard {
  const code = (b.shortCode ?? ref.name.split(/\s+/).map((w) => w[0]).join("")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
  return {
    id: ref.id, name: ref.name, shortCode: code.length >= 2 ? code : "WS", role: ref.role, isActive: true,
    status: "SETUP", onboarding: { step: step as ClientCard["onboarding"]["step"], totalSteps: 6, completedAt: null, percent: 0, steps: [], updatedBy: null, updatedAt: null },
    industry: b.industry ?? null, businessType: b.businessType ?? null, websiteUrl: b.websiteUrl ?? null,
    waitingOnYou: { creatives: 0, batches: 0, total: 0 }, updatedAt: new Date().toISOString(),
  }
}

function session(wid: string = WORKSPACE.id): AuthSession {
  const n = Math.random().toString(36).slice(2)
  const ws = mockWorkspaceOf(`mock-at-${wid}.x`)
  return {
    accessToken: `mock-at-${ws.id}.${n}`,
    refreshToken: `mock-rt-${ws.id}.${n}`,
    expiresIn: 900,
    user: { id: ME.id, name: ME.name, email: MOCK_LOGIN.email, uiLocale: "EN", accountMode: null },
    workspace: { ...ws },
  }
}

export const mockAuth = {
  async login(email: string, password: string) {
    if (email.trim().toLowerCase() !== MOCK_LOGIN.email || password !== MOCK_LOGIN.password) {
      throw new Failure("INVALID_CREDENTIALS", 401, "Wrong email or password.")
    }
    return session()
  },
  async acceptInvite(token: string, name: string, password: string) {
    if (!token.startsWith("inv_")) throw new Failure("INVITE_INVALID", 410, "Invite expired or already used.")
    if (!name.trim() || password.length < 10) throw new Failure("VALIDATION_ERROR", 400, "Name and a 10+ character password are required.")
    const s = session()
    return { ...s, user: { ...s.user, id: `u_${token}`, name: name.trim(), email: `${name.trim().toLowerCase().replace(/\s+/g, ".")}@example.com` }, workspace: { ...s.workspace, role: "MEMBER" as const } }
  },
  /**
   * POST /auth/signup (fase2-cadastro §3): `taken@…` → 409 EMAIL_TAKEN, `closed@…` → 403 FORBIDDEN (SIGNUP_ENABLED=false),
   * `throttle@…` → 429 RATE_LIMITED; otherwise a new account whose first client is in SETUP, onboarding step 1.
   */
  async signup(b: SignupBody): Promise<SignupResponse> {
    const email = (b.email ?? "").trim().toLowerCase()
    const fields: { field: string; rule: string }[] = []
    const name = (b.name ?? "").trim()
    if (!name || name.length > 120) fields.push({ field: "name", rule: name ? "maxLength" : "minLength" })
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) fields.push({ field: "email", rule: "isEmail" })
    if ((b.password ?? "").length < 10 || b.password.length > 200) fields.push({ field: "password", rule: (b.password ?? "").length < 10 ? "minLength" : "maxLength" })
    const agency = b.agencyName?.trim()
    if (b.agencyName !== undefined && (!agency || agency.length > 80)) fields.push({ field: "agencyName", rule: agency ? "maxLength" : "minLength" })
    if (fields.length) throw new Failure("VALIDATION_ERROR", 400, "Invalid request.", { fields })
    if (email.startsWith("taken@")) throw new Failure("EMAIL_TAKEN", 409, "An account with this email already exists. Log in instead.")
    if (email.startsWith("closed@")) throw new Failure("FORBIDDEN", 403, "Sign-ups are closed.")
    if (email.startsWith("throttle@")) throw new Failure("RATE_LIMITED", 429, "Too many attempts.", { retryAfterSec: 42 })
    const s = session(`ws_new_${Math.random().toString(36).slice(2, 8)}`)
    return {
      ...s,
      user: { id: `u_${Math.random().toString(36).slice(2, 8)}`, name, email, uiLocale: b.uiLocale ?? "EN", accountMode: null },
      workspace: { ...s.workspace, name: agency || NEW_CLIENT_NAME, role: "OWNER" },
    }
  },
  async refresh(refreshToken: string) {
    if (!refreshToken.startsWith("mock-rt-")) throw new Failure("REFRESH_INVALID", 401, "Session expired.")
    return session(mockWorkspaceOf(refreshToken).id)
  },
  /** POST /auth/switch-workspace (api.md §2): 404 when the user isn't a member. */
  async switchWorkspace(workspaceId: string) {
    if (!WORKSPACES.some((w) => w.id === workspaceId) && !workspaceId.startsWith("ws_new_")) throw new Failure("NOT_FOUND", 404, "Workspace not found.")
    return session(workspaceId)
  },
  /** POST /workspaces (fase2-agencia §3.2): new SETUP client, creator = OWNER, tokens for it. */
  async createClient(b: CreateClientBody): Promise<CreateClientResponse> {
    if (!b.name?.trim() || b.name.trim().length > 80) throw new Failure("VALIDATION_ERROR", 400, "Name must have 1 to 80 characters.")
    const s = session(`ws_new_${Math.random().toString(36).slice(2, 8)}`)
    return { ...s, client: mockSetupCard(s.workspace, b) }
  },
}
