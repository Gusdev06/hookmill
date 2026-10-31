/**
 * Web-mock of the free sample (docs/contratos/amostra-gratis-v1.md). The mock user's plan lives in sessionStorage so each
 * state can be checked in the browser: ?mockaccess=sample (new account, sample not used) · used (sample already spent) ·
 * paid · internal · off (clears = INTERNAL, as before the contract). PATCH /admin/users/:id/access on the mock user changes it.
 */
import type { AccountAccess, PaymentRequiredDetails } from "@/lib/api/types"

const K_ACCESS = "mock:access"
const K_USED = "mock:sampleUsed"

export function captureAccessFromUrl() {
  const v = new URLSearchParams(window.location.search).get("mockaccess")
  if (!v) return
  if (v === "off") {
    sessionStorage.removeItem(K_ACCESS)
    sessionStorage.removeItem(K_USED)
  } else if (v === "sample") {
    sessionStorage.setItem(K_ACCESS, "SAMPLE")
    sessionStorage.removeItem(K_USED)
  } else if (v === "used") {
    sessionStorage.setItem(K_ACCESS, "SAMPLE")
    sessionStorage.setItem(K_USED, "1")
  } else if (v === "paid" || v === "internal") sessionStorage.setItem(K_ACCESS, v.toUpperCase())
}

export function mockAccess(): AccountAccess {
  if (typeof window === "undefined") return "INTERNAL"
  const v = sessionStorage.getItem(K_ACCESS)
  return v === "SAMPLE" || v === "PAID" ? v : "INTERNAL"
}
export const setMockAccess = (a: AccountAccess) => sessionStorage.setItem(K_ACCESS, a)
export const mockSampleUsed = () => typeof window !== "undefined" && sessionStorage.getItem(K_USED) === "1"
export const markSampleUsed = () => sessionStorage.setItem(K_USED, "1")

/** §1: a sample batch is locked while the account is on SAMPLE (PAID / INTERNAL never lock). */
export const sampleLocked = (b: { sample?: boolean }) => !!b.sample && mockAccess() === "SAMPLE"

export const paymentDetails = (reason: PaymentRequiredDetails["reason"], pieces: number): PaymentRequiredDetails => ({ reason, unlock: { pieces } })
