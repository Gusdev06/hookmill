/**
 * Example content for the feature 2 mock (variar campeão): the "Orbit — the $9 question" winner of
 * design/mockup-variar-campeao.html, as the API would return it (TeardownSections, feature-2 §4).
 * Fictional. Times are written for a 29 s video and scaled to the uploaded video's real duration.
 */
import type { AdLibraryMeta, FileRef, Measurements, ScriptBlock, TeardownSections, TranscriptWord, VariationKind } from "@/lib/api/types"

export const BASE_SEC = 29

/** [label, function, startSec, endSec, speech, onScreen, shows] at 29 s. */
const BLOCKS: [string, string, number, number, string, string, string][] = [
  ["Hook", "hook", 0, 3, "I pay $9 a month for an app that gives me back $212.", "$9 → $212", "Close-up, phone held toward the camera"],
  ["Problem", "problem", 3, 11, "I thought I spent very little. Then I saw the full statement: 11 subscriptions I forgot about.", "11 subscriptions", "Talking head in a kitchen, two jump cuts"],
  ["Mechanism", "mechanism", 11, 19, "Orbit reads your bank feed and puts every recurring charge in one list.", "—", "Phone insert: list of charges"],
  ["Proof", "proof", 19, 24, "I cancelled 6 on the same screen. 18,000 people rate it 4.7.", "4.7 ★ · 18k", "Talking head + rating card"],
  ["CTA", "cta", 24, 29, "Try it free for 14 days. Link below.", "Free for 14 days", "Talking head, points down"],
]
const CUTS = [2.1, 3, 6.4, 11, 15.2, 19, 24]
const r2 = (n: number) => Math.round(n * 100) / 100

export function structure(durationSec: number) {
  const k = durationSec / BASE_SEC
  return BLOCKS.map(([label, fn, s, e, speech, onScreen, shows]) => ({ label, function: fn, startSec: r2(s * k), endSec: r2(e * k), speech, onScreen, shows }))
}

/** Script blocks a launched variation carries (literal body; `hook` replaces block 0 speech in NEW_HOOKS). */
export function scriptBlocks(durationSec: number, visualPrompt: string, hook?: string): ScriptBlock[] {
  return structure(durationSec).map((b, i) => ({ label: b.label, startSec: b.startSec, endSec: b.endSec, speech: i === 0 && hook ? hook : b.speech, visualPrompt }))
}

export function words(durationSec: number, hasSpeech: boolean): TranscriptWord[] {
  if (!hasSpeech) return []
  const out: TranscriptWord[] = []
  for (const b of structure(durationSec)) {
    const ws = b.speech.split(/\s+/)
    const span = (b.endSec - b.startSec - 0.3) / ws.length
    ws.forEach((word, i) => out.push({ word, startSec: r2(b.startSec + 0.1 + i * span), endSec: r2(b.startSec + 0.1 + (i + 0.85) * span) }))
  }
  return out
}

export function measurements(p: { durationSec: number; width: number; height: number; hasAudio: boolean; frame: (i: number) => FileRef }): Measurements {
  const k = p.durationSec / BASE_SEC
  const blocks = structure(p.durationSec)
  const cuts = CUTS.map((c) => ({ atSec: r2(c * k), kind: (c === 11 || c === 19 ? "layout" : "content") as "layout" | "content" }))
  return {
    durationSec: p.durationSec, width: p.width, height: p.height, fps: 30, hasAudio: p.hasAudio, cuts,
    segments: [
      { startSec: 0, endSec: r2(11 * k), bands: [{ y0: 0, y1: p.height, pct: 100, role: "face" }] },
      { startSec: r2(11 * k), endSec: r2(19 * k), bands: [{ y0: 0, y1: Math.round(p.height * 0.58), pct: 58, role: "face" }, { y0: Math.round(p.height * 0.58), y1: p.height, pct: 42, role: "panel" }] },
      { startSec: r2(19 * k), endSec: p.durationSec, bands: [{ y0: 0, y1: p.height, pct: 100, role: "face" }] },
    ],
    palette: ["#F5F5F0", "#FFD84A", "#3B3631", "#16130F"],
    silences: p.hasAudio ? blocks.slice(0, -1).map((b) => ({ startSec: r2(b.endSec - 0.18), endSec: r2(b.endSec + 0.06) })) : [{ startSec: 0, endSec: p.durationSec }],
    keyframes: [
      { atSec: 0, reason: "t0" as const, image: p.frame(0) },
      ...blocks.slice(1).map((b, i) => ({ atSec: b.startSec, reason: "block" as const, image: p.frame(i + 1) })),
      { atSec: r2(6.4 * k), reason: "cut" as const, image: p.frame(5) },
      { atSec: r2(p.durationSec - 0.5), reason: "end" as const, image: p.frame(6) },
    ].sort((a, b) => a.atSec - b.atSec),
  }
}

export const AD_META = (adArchiveId: string): AdLibraryMeta => ({
  status: "resolved", adArchiveId, pageName: "Orbit Budget", startDate: "2026-08-26", endDate: null, isActive: true, daysRunning: 41,
  collationCount: 3, euReach: null, primaryText: "I pay $9 and got $212 back. Here is how.", headline: "Find your forgotten charges.",
  ctaText: "Learn more", linkUrl: "https://orbitbudget.app", fetchedAt: new Date().toISOString(),
})

export function sections(p: { durationSec: number; width: number; height: number; hasSpeech: boolean; adMeta: AdLibraryMeta | null }): TeardownSections {
  const k = p.durationSec / BASE_SEC
  const b = structure(p.durationSec)
  const aspect = p.height > p.width ? (p.height / p.width > 1.6 ? "9:16" : "4:5") : p.height === p.width ? "1:1" : "16:9"
  const na = (naReason: string) => ({ status: "na" as const, naReason, data: null })
  const ok = <T,>(data: T) => ({ status: "ok" as const, naReason: null, data })
  const meta = p.adMeta?.status === "resolved" ? p.adMeta : null
  return {
    identification: ok({
      summary: `${Math.round(p.durationSec)} s ${aspect} talking head (${p.width}×${p.height}), English, one speaker, 5 blocks.`,
      signals: [
        ...(meta ? [`Running ${meta.daysRunning} days, ${meta.collationCount} versions live (Ad Library: a proxy, not performance)`] : []),
        `${(CUTS.length / p.durationSec * 10).toFixed(1)} cuts per 10 s`,
        p.hasSpeech ? "Speech fills 93% of the runtime" : "No speech detected",
      ],
    }),
    metaCopy: meta
      ? ok({ primaryText: meta.primaryText, headline: meta.headline, description: null, button: meta.ctaText, link: meta.linkUrl })
      : na("No Ad Library link, so there is no ad copy to read. Paste it here if you have it."),
    transcript: p.hasSpeech
      ? ok({ keywords: [{ sentence: b[0].speech, keyword: "$212" }, { sentence: b[1].speech, keyword: "11 subscriptions" }, { sentence: b[3].speech, keyword: "4.7" }] })
      : na("The video has no speech."),
    hook: ok({ endSec: b[0].endSec, visual: b[0].shows, onScreenText: `${b[0].onScreen} · white band, top`, spoken: p.hasSpeech ? b[0].speech : "" }),
    structure: ok({ blocks: b.map((x) => ({ label: x.label, function: x.function, startSec: x.startSec, endSec: x.endSec, onScreen: x.onScreen, speech: p.hasSpeech ? x.speech : "" })) }),
    layout: ok({
      summary: "Full-frame head + word-by-word captions at 68% height + a phone insert over the lower 42% in block 3.",
      segments: [
        { startSec: 0, endSec: r2(11 * k), description: "Head fills the frame, captions at 68%." },
        { startSec: r2(11 * k), endSec: r2(19 * k), description: "Head on the top 58%, phone insert on the lower 42%." },
        { startSec: r2(19 * k), endSec: p.durationSec, description: "Head fills the frame, rating card in block 4." },
      ],
    }),
    visual: ok({
      palette: [{ hex: "#F5F5F0", role: "hook band" }, { hex: "#FFD84A", role: "keyword in captions" }, { hex: "#3B3631", role: "kitchen, background" }, { hex: "#16130F", role: "shadows" }],
      typography: "Closest family: Montserrat ExtraBold. All caps, black outline, about 8% of the frame width.",
      captions: "Word by word, 3 words at a time, keyword in #FFD84A.",
      uiElements: "Phone insert with a list of charges; rating card 4.7 ★.",
      person: "Woman, 30s, casual sweater, home kitchen, chest-up framing, natural window light.",
      broll: "Phone screen recording in block 3.",
      motion: "Jump cuts, no zooms, no transitions.",
    }),
    audio: p.hasSpeech ? ok({ voice: "Recorded human female voice, not TTS, conversational.", music: "None.", sfx: "None." }) : na("The video has no audio track."),
    offerProofCta: ok({
      promise: "Find the money you already lose.", mechanism: "One list of every recurring charge, read from the bank feed.",
      proof: "The list on screen + 4.7 from 18k reviews.", ctaSpoken: p.hasSpeech ? b[4].speech : "", ctaOnScreen: b[4].onScreen,
    }),
    whySells: ok({
      avatar: "Adults 25 to 45 with a steady income who feel the money is gone before the month ends.",
      awarenessLevel: "Problem-aware: they know money leaks, not where. Moved to solution-aware in 11 s.",
      painDesire: "Money leaking without a name / control without a spreadsheet.",
      bigIdea: "Paying a little finds a lot.",
      beliefObjection: "\"I don't spend much\": broken by the full statement.",
      retentionEngine: "An open loop in the numbers, then a cut every 4 seconds.",
      verdict: [
        "The hook is a sum that does not add up: paying $9 to get $212 back opens a loop the viewer must close.",
        "The proof is on screen, not claimed: the list of charges in block 3 shows the mechanism working.",
        "It names an invisible pain: \"subscriptions I forgot about\" turns a vague feeling into a thing you can fix.",
        "A cut every 4 seconds: nothing on screen lasts long enough to scroll away from.",
      ],
    }),
    stealVsVary: ok({
      steal: ["Numeric hook", "Problem → mechanism → proof → CTA order", "Phone insert in block 3"],
      vary: [
        { lever: "hook", idea: "The first 3 seconds, keeping the body: strongest lever." },
        { lever: "avatar", idea: "The face, same words: tests whether the messenger carried the ad." },
        { lever: "layout", idea: "Head + screen split for the whole video." },
      ],
    }),
    replicationPlan: ok({
      suggestions: [
        { kind: "NEW_HOOKS" as VariationKind, lever: "curiosity", idea: "Authority swap: \"My bank never showed me this. A $9 app did.\"" },
        { kind: "NEW_HOOKS" as VariationKind, lever: "pain", idea: "Direct question about money paid for nothing." },
        { kind: "SWAP_AVATAR" as VariationKind, lever: "avatar", idea: "Man in his 40s, office, same script." },
      ],
    }),
  }
}

/** Hooks the plan writes for NEW_HOOKS (lever + rationale tied to whySells). */
export const HOOKS: { lever: string; rationale: string; speech: string; onScreenText: string }[] = [
  { lever: "curiosity: authority swap", rationale: "Keeps the open loop of cause 1, swaps the number for an authority the viewer trusts less than they think.", speech: "My bank never showed me this. A $9 app did.", onScreenText: "My bank never showed me this" },
  { lever: "pain: direct question", rationale: "Attacks cause 3 head-on: makes the viewer name their own invisible leak.", speech: "How much do you pay every month for things you never use? I found $212.", onScreenText: "How much do you pay for nothing?" },
  { lever: "demonstration: speed", rationale: "Pulls the proof of cause 2 into the first second.", speech: "I cancelled 6 subscriptions in 2 minutes without calling anyone.", onScreenText: "6 cancelled · 2 min" },
  { lever: "story: confession", rationale: "A specific, slightly embarrassing leak makes cause 3 personal.", speech: "I was paying for a gym I quit in March.", onScreenText: "Still paying since March" },
  { lever: "contrarian", rationale: "Flips the belief objection (\"I don't spend much\") into the hook.", speech: "Budgeting apps are useless. This one isn't a budgeting app.", onScreenText: "Not a budgeting app" },
]

/** Castings for SWAP_AVATAR items: generic, never the champion's person (feature-2 §1.1). DIVERSE (§13.13): no axis repeats across the batch. */
export const SWAP_CASTINGS = [
  "Black man, early 40s, short beard, shaved head, brown eyes, plain navy t-shirt, small home office, chest-up, warm desk lamp light",
  "East Asian woman, late 20s, long straight black hair dyed purple at the ends, nose piercing, oversized hoodie, bedroom with fairy lights, selfie framing",
  "Latina woman, 50s, curly grey shoulder-length hair, green eyes, linen shirt, bright living room, chest-up, soft daylight",
  "Middle Eastern man, mid 20s, clean-shaven, wavy dark hair, forearm tattoo, denim jacket, parked car, selfie framing",
]
/** MATCH_ORIGINAL (§13.3 item 1): same profile as the winner's person, another person. */
export const MATCH_CASTINGS = [
  "Woman, early 30s, shoulder-length brown hair, casual knit sweater, home kitchen, chest-up, soft window light",
  "Woman, early 30s, brown hair in a low ponytail, plain white tee, home kitchen, chest-up, soft window light",
  "Woman, mid 30s, wavy brown hair, light cardigan, home kitchen, chest-up, soft window light",
  "Woman, late 20s, straight brown hair, grey sweatshirt, home kitchen, chest-up, soft window light",
]
export const SWAP_RATIONALE = [
  "Same words, different messenger: tests whether the face was carrying the ad (cause 1 stays intact).",
  "Younger, more casual messenger for the same open loop.",
  "Older messenger: the \"forgotten charges\" pain reads as lived experience.",
  "Male, on-the-go framing: same copy, new context.",
]
export const SHARED_CASTING = "South Asian man, 30s, short black hair, trimmed beard, grey crewneck, bright apartment kitchen, chest-up, natural window light"
export const SHARED_CASTING_MATCH = "Woman, early 30s, shoulder-length brown hair, denim shirt, home kitchen, chest-up, soft window light"
