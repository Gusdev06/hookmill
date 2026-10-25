import type { Role } from "@/lib/api/types"

/**
 * Mock mode only (NEXT_PUBLIC_API_MOCKING=enabled): `?mockrole=member|client` lets QA see the Campaigns screen as that
 * role (set by mocks/scenario.ts in sessionStorage). Always the real role outside mock mode.
 */
export function effectiveRole(real: Role): Role {
  if (process.env.NEXT_PUBLIC_API_MOCKING !== "enabled" || typeof window === "undefined") return real
  const v = sessionStorage.getItem("mock:role")
  return v === "MEMBER" || v === "CLIENT" ? v : real
}
