/**
 * Build-time feature flags (NEXT_PUBLIC_*, inlined by Next). Off unless the env says "on".
 * ONBOARDING_EDDY (31/10, design/onboarding-eddy-2026-10-31.md): the client setup as a guided conversation with Eddy,
 * beside the 6-step wizard (which stays the default and keeps the "Edit setup" mode after the setup is done).
 */
export const ONBOARDING_EDDY = process.env.NEXT_PUBLIC_ONBOARDING_EDDY === "on"

/**
 * TEMPLATES (31/10, templates-creditos-v1, approved): the Templates gallery replaces "Iterate a winner" as the door to make
 * variations (sidebar + Home shortcuts) and the credit balance shows in the shell. On unless the env says "off" (rollback:
 * the API's TEMPLATES flag must be on where this ships, or SAMPLE accounts get 402 on the gallery). /iterate stays reachable.
 */
export const TEMPLATES = process.env.NEXT_PUBLIC_TEMPLATES !== "off"
