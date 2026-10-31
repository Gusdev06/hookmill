import type {
  FileRef, LibraryItem, MembersResponse, Offer, ServiceStatus, Spend, UserRef, Workspace, WorkspaceRef,
} from "@/lib/api/types"

/** Example data from the approved mockup (fictional offers). Times are relative to page load. */
export const ME: UserRef & { email: string } = { id: "u_gusta", name: "Gusta", initials: "GU", email: "gusta@maquina.dev" }
const GUSTA: UserRef = { id: "u_gusta", name: "Gusta", initials: "G" }
const TORDAN: UserRef = { id: "u_tordan", name: "Tordan", initials: "T" }

// fase2-agencia.md §2: client = workspace. LIVE (onboarding done), like every workspace after the backfill.
export const WORKSPACE: Workspace = {
  id: "ws_1", name: "Workspace", uiLocale: "EN", monthlySpendCapUsd: 300,
  shortCode: "WS", industry: null, market: null, resultType: null, resultTypeOther: null, businessType: null, defaultResult: null, targetCpa: null, websiteUrl: null,
  status: "LIVE",
  onboarding: { step: 6, totalSteps: 6, completedAt: "2026-10-05T12:00:00.000Z", percent: 100, steps: [], updatedBy: null, updatedAt: null },
}
/** Workspaces the mock user belongs to (client selector in the sidebar; switch-workspace). Example data. */
export const WORKSPACES: WorkspaceRef[] = [
  { id: WORKSPACE.id, name: WORKSPACE.name, role: "OWNER", status: "LIVE", onboarding: { step: 6, percent: 100, completedAt: WORKSPACE.onboarding.completedAt } },
  { id: "ws_mooncloth", name: "Mooncloth", role: "ADMIN", status: "SETUP", onboarding: { step: 3, percent: 33, completedAt: null } },
  { id: "ws_northpeak", name: "Northpeak Dental", role: "CLIENT", status: "SETUP", onboarding: { step: 2, percent: 17, completedAt: null } },
]

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const art = (tone: number, face: number): FileRef => ({
  id: `f_art_${tone}_${face}`, url: `/mock/art-${tone}-${face}.svg`, mimeType: "image/svg+xml", width: 360, height: 640,
})
const video = (id: string, sec: number): FileRef => ({ id: `f_vid_${id}`, url: `/mock/art-0-0.svg`, mimeType: "video/mp4", durationSec: sec })

export const OFFERS: Offer[] = [
  {
    id: "of_orbit", name: "Orbit Budget", language: "en", sourceUrl: "https://orbitbudget.app",
    kind: "Subscription app",
    what: "A budgeting app that connects to your bank and finds recurring charges you forgot about. You cancel them from inside the app.",
    audience: "Adults 25 to 45 with a steady income who feel the money is gone before the month ends. Not spreadsheet people.",
    promise: "Find the money you are already losing to forgotten subscriptions in your first 5 minutes.",
    pains: "Payday feels gone in a week. Too many small subscriptions to track. Tried spreadsheets and gave up.",
    proof: "Average user finds $212/month in recurring charges (sales page). 4.7 rating from 18k reviews.",
    offerAndPrice: "14-day free trial, then $9/month. Cancel anytime.",
    cta: "Start your free trial", notes: null,
    fieldSources: { what: "page", audience: "page", promise: "page", pains: "page", proof: "page" },
    creativesCount: 4, winnersCount: 2, updatedAt: ago(60 * 48),
  },
  {
    id: "of_quiet", name: "Quiet Mind 21", language: "en", sourceUrl: "https://quietmind21.com",
    kind: "Online course",
    what: "A 21-day audio course that trains you to fall asleep without your phone.",
    audience: "Adults who wake at 3am with racing thoughts and have tried sleep apps that didn't stick.",
    promise: "Fall asleep in under 20 minutes by day 21.",
    pains: "Lying awake replaying the day. Tired every morning. Melatonin stopped working.",
    proof: "11,400 students. Featured in two sleep podcasts.",
    offerAndPrice: "$47 one-time, lifetime access.",
    cta: "Start the 21 days", notes: null,
    fieldSources: { what: "page", promise: "page", proof: "page" },
    creativesCount: 2, winnersCount: 1, updatedAt: ago(60 * 24 * 5),
  },
  {
    id: "of_bright", name: "Brightside Kit", language: "en", sourceUrl: "https://brightsidekit.com",
    kind: "Physical product",
    what: "A 5-minute morning skincare kit: cleanser, serum and SPF in one routine.",
    audience: "Busy people 28 to 40 who skip skincare because routines take too long.",
    promise: "Glowing skin with a routine shorter than your coffee.",
    pains: "Ten-step routines nobody keeps. Dull skin. Too many products on the shelf.",
    proof: "4.8 stars from 3,200 reviews. Dermatologist tested.",
    offerAndPrice: "$39 for the kit, free shipping.",
    cta: "Get the kit", notes: null,
    fieldSources: {},
    creativesCount: 1, winnersCount: 0, updatedAt: ago(60 * 24 * 7),
  },
]

const offerRef = (id: string) => {
  const o = OFFERS.find((x) => x.id === id)!
  return { id: o.id, name: o.name }
}

const day = (iso: string) => new Date(iso).toISOString()
export const LIBRARY: LibraryItem[] = [
  { id: "cr_6", name: "Quiet Mind — commute", offer: offerRef("of_quiet"), engineLabel: "Lipsync", durationSec: 26, video: video("6", 26), thumbnail: art(2, 0), isWinner: false, approvedAt: day("2026-10-04T15:00:00Z"), approvedBy: TORDAN, variation: null, editedInEditor: false, adName: "WS_NEW_1004_A_F1_9x16" },
  { id: "cr_8", name: "Orbit — the $9 question", offer: offerRef("of_orbit"), engineLabel: "Kling 3.0", durationSec: 29, video: video("8", 29), thumbnail: art(0, 1), isWinner: true, approvedAt: day("2026-10-02T15:00:00Z"), approvedBy: GUSTA, variation: null, editedInEditor: false, adName: "WS_NEW_1002_B_F2_9x16" },
  { id: "cr_9", name: "Orbit — bank alert", offer: offerRef("of_orbit"), engineLabel: "Seedance", durationSec: 22, video: video("9", 22), thumbnail: art(3, 2), isWinner: true, approvedAt: day("2026-09-30T15:00:00Z"), approvedBy: GUSTA, variation: null, editedInEditor: false, adName: "WS_NEW_0930_A_F3_9x16" },
  { id: "cr_10", name: "Quiet Mind — sunday dread", offer: offerRef("of_quiet"), engineLabel: "Kling 3.0", durationSec: 31, video: video("10", 31), thumbnail: art(1, 3), isWinner: true, approvedAt: day("2026-09-28T15:00:00Z"), approvedBy: TORDAN, variation: null, editedInEditor: false, adName: "WS_NEW_0928_C_F4_9x16" },
  { id: "cr_11", name: "Brightside — 5 minute glow", offer: offerRef("of_bright"), engineLabel: "Lipsync", durationSec: 24, video: video("11", 24), thumbnail: art(2, 2), isWinner: false, approvedAt: day("2026-09-27T15:00:00Z"), approvedBy: TORDAN, variation: null, editedInEditor: false, adName: "WS_NEW_0927_A_F3_9x16" },
]

export const MEMBERS: MembersResponse = {
  members: [
    { userId: "u_gusta", name: "Gusta", email: "gusta@maquina.dev", role: "OWNER", initials: "G" },
    { userId: "u_tordan", name: "Tordan", email: "tordan@maquina.dev", role: "MEMBER", initials: "T" },
  ],
  invites: [],
}

export const SERVICES: ServiceStatus[] = [
  { provider: "ANTHROPIC", connected: true, keyMasked: "sk-ant…4f2a" },
  { provider: "WAVESPEED", connected: true, keyMasked: "ws…91c0" },
  { provider: "HIGGSFIELD", connected: true, keyMasked: "hf…7d21" },
  { provider: "APIFY", connected: true, keyMasked: "apify…3e8b" },
]

export const SPEND: Spend = {
  month: "2026-10", spentUsd: 48.2, capUsd: 300,
  byProvider: [{ provider: "WAVESPEED", amountUsd: 46.9 }, { provider: "ANTHROPIC", amountUsd: 1.3 }],
  byKind: [{ kind: "VIDEO", amountUsd: 41.1 }, { kind: "IMAGE", amountUsd: 5.8 }, { kind: "LLM", amountUsd: 1.3 }],
}

export const ENGINES = {
  engines: [
    { id: "SCENES" as const, models: [{ id: "kling-3.0", label: "Kling 3.0", maxSceneSec: 15 }, { id: "seedance-1.0", label: "Seedance", maxSceneSec: 10 }], tradeoffKey: "engine.scenes.tradeoff" },
    { id: "LIPSYNC" as const, models: [{ id: "pruna-lipsync", label: "Lipsync", maxSceneSec: 60 }], tradeoffKey: "engine.lipsync.tradeoff" },
  ],
  formats: ["VERTICAL_9_16", "PORTRAIT_4_5", "SQUARE_1_1"] as ("VERTICAL_9_16" | "PORTRAIT_4_5" | "SQUARE_1_1")[],
}
