/**
 * skullet samples (04/11): realistic stand-ins for each list type, so the very first skeleton (before any visit is
 * remembered under its `id`) already has the right shape. Text is never shown: skullet draws bars over it.
 * Media URLs are a 1x1 transparent GIF, so nothing is fetched while measuring.
 */
import type { ApiResult } from "@/lib/api/client"
import type { BrainGraph, BrainNode, CreativeRow, FileRef, LibraryItem, LibraryMeta, MetaAdRow, MetaMetrics, TemplateCard, UserRef } from "@/lib/api/types"
import type { NextStep, RecentItem } from "@/components/home/home-side"

export const BLANK_IMG = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
export const sampleFile: FileRef = { id: "sample-file", url: BLANK_IMG, mimeType: "image/gif", width: 1, height: 1 }
const user: UserRef = { id: "sample-user", name: "Sample User", initials: "SU" }
const offer = { id: "sample-offer", name: "Sample offer name" }
const SOME_DATE = "2026-11-01T12:00:00.000Z"

/** n copies of a row with distinct ids (React keys). */
export const rows = <T extends { id: string }>(n: number, row: T): T[] => Array.from({ length: n }, (_, i) => ({ ...row, id: `${row.id}-${i}` }))

export const SAMPLE_LIBRARY: ApiResult<LibraryItem[], LibraryMeta> = {
  data: rows(5, {
    id: "sample-creative",
    name: "Sample creative name here",
    offer,
    engineLabel: "Kling 3.0",
    durationSec: 24,
    video: sampleFile,
    thumbnail: sampleFile,
    isWinner: false,
    approvedAt: SOME_DATE,
    approvedBy: user,
    variation: null,
    editedInEditor: false,
    adName: null,
  }),
  meta: { nextCursor: null, offers: [offer] },
}

export const SAMPLE_CREATIVE_ROW: CreativeRow = {
  id: "sample-row",
  name: "Sample creative name",
  offer,
  state: "SCRIPTS_READY",
  step: "offer",
  status: "draft",
  statusKey: "status.draft",
  statusParams: {},
  progress: null,
  engine: null,
  engineModel: null,
  thumbnail: null,
  createdBy: user,
  updatedAt: SOME_DATE,
  variation: null,
  editedInEditor: false,
}

export const SAMPLE_STEPS: NextStep[] = [0, 1, 2].map((i) => ({
  key: `sample-step-${i}`,
  icon: null,
  tone: "neutral",
  title: "Sample next step title",
  body: "A sentence that explains what this step does for you.",
  cta: { label: "Open step", href: "#" },
}))

export const SAMPLE_RECENT: RecentItem[] = rows(5, SAMPLE_CREATIVE_ROW).map((c) => ({ kind: "creative", c, at: SOME_DATE }))

export const SAMPLE_TEMPLATE_CARDS: TemplateCard[] = Array.from({ length: 10 }, (_, i) => ({
  slug: `sample-template-${i}`,
  name: "Template name",
  description: "Two short lines that say what this template does to your ad.",
  out: "3 videos",
  tier: "EDIT",
  tab: "edit",
  category: "headline",
  credits: 1,
  outputs: 3,
  pack: false,
  beta: false,
  needs: [],
  example: null,
  poster: null,
  uses: 12,
  available: true,
  sampleOk: true,
  fit: null,
}))

const metrics: MetaMetrics = {
  spend: 1240.5, impressions: 98000, clicks: 1520, ctr: 1.55, results: 86, resultType: "purchase", cpa: 14.42, roas: 2.4,
  plays2s: 31000, hookRate: 31.6, thruplays: 9000, frequency: 1.8, reach: 54000,
}

export const SAMPLE_CREATIVE_ROWS: CreativeRow[] = rows(8, SAMPLE_CREATIVE_ROW)

const brainNode = (id: string, kind: "offer" | "hook", label: string): BrainNode => ({
  id: `${kind}:${id}`,
  kind,
  category: kind === "offer" ? "offers" : "hooks",
  refId: id,
  label,
  summary: "A short line about this node",
  weight: 0.5,
  winner: false,
  meta: kind === "offer" ? { kind, setupStep: 3, creatives: 4, winners: 1 } : { kind, angle: "Sample angle", scripts: 2, ads: 1, bestCpa: null, currency: null },
})
/** Offers and hooks open by default in the list (brain-list.tsx), so the sample fills those two; the rest stay closed. */
export const SAMPLE_BRAIN_GRAPH: BrainGraph = {
  generatedAt: SOME_DATE,
  nodes: [brainNode("o1", "offer", "Sample offer name"), brainNode("o2", "offer", "Another offer"), ...[1, 2, 3].map((i) => brainNode(`h${i}`, "hook", "A sample hook that opens the ad"))],
  edges: [],
  counts: {} as BrainGraph["counts"], // not read by the list
  meta: { enabled: false, connected: false, lastSyncAt: null },
  truncated: false,
}

export const SAMPLE_META_ADS: MetaAdRow[] = Array.from({ length: 3 }, (_, i) => ({
  metaAdId: `sample-ad-${i}`,
  name: "Sample ad name · Video 9:16",
  effectiveStatus: "ACTIVE",
  campaign: { id: "sample-campaign", name: "Sample campaign" },
  adset: { id: "sample-adset", name: "Sample ad set" },
  thumbnailUrl: null,
  videoId: "sample-video",
  metrics,
  metrics7d: metrics,
  metricsPrev7d: metrics,
  verdict: "OK",
  trend: null,
  daysRunning: 12,
  creative: null,
  championId: null,
  adCreatedTime: null,
  syncedAt: SOME_DATE,
}))
