import { EncryptJWT, jwtDecrypt } from "jose"

/** Refresh token cookie: httpOnly, encrypted (A256GCM) with SESSION_COOKIE_SECRET. Contract §2. */
export const SESSION_COOKIE = "maq_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // REFRESH_TTL_DAYS=30

async function key() {
  const secret = process.env.SESSION_COOKIE_SECRET
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_COOKIE_SECRET must have at least 32 chars")
  }
  const raw = new TextEncoder().encode(secret ?? "dev-only-session-secret-change-me-please")
  return new Uint8Array(await crypto.subtle.digest("SHA-256", raw))
}

export async function sealRefreshToken(refreshToken: string) {
  return new EncryptJWT({ rt: refreshToken })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .encrypt(await key())
}

export async function openRefreshToken(sealed: string | undefined): Promise<string | null> {
  if (!sealed) return null
  try {
    const { payload } = await jwtDecrypt(sealed, await key())
    return typeof payload.rt === "string" ? payload.rt : null
  } catch {
    return null
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
}
