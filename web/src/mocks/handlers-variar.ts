/**
 * MSW handlers for feature 2 (api.md §18-20, feature-2-variar-campeao.md §4.1-4.3, mock triggers §4.6).
 * State and clock live in ./variar.ts.
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  AttachChampionVideoBody, BatchSettings, CreateBatchBody, CreateChampionBody, CreateUploadBody, GenerateCastingFacesBody, ReplanBatchBody, TeardownSectionKey,
  UpdateBatchSettingsBody, UpdateChampionBody, UpdateTeardownBody, UpdateVariationItemBody, VariationKind,
} from "@/lib/api/types"
import { db, save as saveDb, toRow, VOICES } from "./db"
import { listScenario } from "./scenario"
import {
  adLibrary, advanceBatch, advanceChampion, batchView, castingView, championDetail, championRow, config, COUNT_RANGE, estimateOf, f2, itemView, keepBlob, keepEditOf,
  FACE_UNIT_USD, launch, LIMITS, missingFor, newBatch, newChampion, newFaceRound, newUpload, probe, regenerateItem, save, startAnalysis, swapSettingsError, uploadFile, uploadTarget,
  type MBatch, type MUpload,
} from "./variar"

const u = (p: string) => API_URL + p
const ok = <D,>(data: D, meta?: unknown, status = 200) => HttpResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const notFound = () => fail("NOT_FOUND", 404, "Not found.")
const invalid = (state: string, allowed: string[]) => fail("INVALID_STATE", 409, "Not allowed in the current state.", { state, allowed })
const validation = (field: string, rule: string) => fail("VALIDATION_ERROR", 400, "Invalid input.", { fields: [{ field, rule }] })
const body = async <T,>(r: Request) => ((await r.json().catch(() => ({}))) as T)

const SECTION_KEYS: TeardownSectionKey[] = ["identification", "metaCopy", "transcript", "hook", "structure", "layout", "visual", "audio", "offerProofCta", "whySells", "stealVsVary", "replicationPlan"]
const AD_URL = /facebook\.com\/ads\/library\/?\?(?:[^#]*&)?id=\d+/

function champion(id: unknown) {
  const c = f2.champions.find((x) => x.id === id && !x.archived)
  return c ? advanceChampion(c) : null
}
function batch(id: unknown) {
  const b = f2.batches.find((x) => x.id === id)
  return b ? advanceBatch(b) : null
}
const capCheck = (usd: number) => {
  const cap = db.workspace.monthlySpendCapUsd
  return cap !== null && db.spentUsd + usd > cap
    ? fail("SPEND_CAP_EXCEEDED", 409, "This would pass the monthly spend cap.", { spentUsd: +db.spentUsd.toFixed(2), capUsd: cap, estimateUsd: +usd.toFixed(2) })
    : null
}
/** §13.7: keepEdit true with a blocker = 422 KEEP_EDIT_UNSUPPORTED { kind, blockers } (first blocked kind). */
function keepBlocked(c: Parameters<typeof keepEditOf>[0], kinds: VariationKind[]) {
  const k = keepEditOf(c)
  for (const kind of kinds) {
    if (kind !== "SWAP_AVATAR" && kind !== "NEW_HOOKS") return fail("KEEP_EDIT_UNSUPPORTED", 422, "This kind can't keep the edit.", { kind, blockers: [] })
    if (!k[kind].available) return fail("KEEP_EDIT_UNSUPPORTED", 422, "This kind can't keep the champion's edit.", { kind, blockers: k[kind].blockers })
  }
  return null
}
function readyUpload(id: string | undefined): MUpload | Response | null {
  if (!id) return null
  const up = f2.uploads.find((x) => x.id === id)
  if (!up) return fail("NOT_FOUND", 404, "Upload not found.")
  if (up.status !== "READY") return fail("UPLOAD_INCOMPLETE", 409, "The upload isn't complete.", { expectedBytes: up.sizeBytes, actualBytes: up.sent ? up.sizeBytes : null })
  return up
}
function validRequests(reqs: { kind: VariationKind; count: number }[] | undefined) {
  if (!Array.isArray(reqs) || !reqs.length) return validation("requests", "arrayNotEmpty")
  let total = 0
  for (const r of reqs) {
    const range = COUNT_RANGE[r.kind]
    if (!range) return validation("requests.kind", "isEnum")
    if (!Number.isInteger(r.count) || r.count < range[0] || r.count > range[1]) return validation("requests.count", `between_${range[0]}_${range[1]}`)
    total += r.count
  }
  if (total > 10) return validation("requests", "max_10_items")
  return null
}

export const variarHandlers = [
  // ───── §18 uploads
  http.post(u("/uploads"), async ({ request }) => {
    const b = await body<CreateUploadBody>(request)
    if (b.purpose !== "CHAMPION_VIDEO" || !b.filename || !Number.isFinite(b.sizeBytes)) return validation("purpose", "isEnum")
    if (!LIMITS.mimeTypes.includes(b.mimeType)) return fail("MEDIA_INVALID", 422, "Only MP4 or MOV.", { reason: "mime" })
    if (b.sizeBytes > LIMITS.maxBytes) return fail("MEDIA_TOO_LARGE", 422, "The file is larger than 200 MB.", { maxBytes: LIMITS.maxBytes })
    await delay(150)
    return ok(uploadTarget(newUpload(b)), undefined, 201)
  }),
  http.put(u("/uploads/:id/content"), async ({ params, request }) => {
    const up = f2.uploads.find((x) => x.id === params.id)
    if (!up) return notFound()
    if (Date.now() > up.expiresAt || up.filename.includes("mock-expired")) return fail("UPLOAD_EXPIRED", 410, "The upload link expired. Start the upload again.")
    const blob = await request.blob()
    if (blob.size > up.sizeBytes) return fail("UPLOAD_INCOMPLETE", 413, "The file is larger than declared.", { expectedBytes: up.sizeBytes, actualBytes: blob.size })
    keepBlob(up.id, blob)
    up.sent = true
    save()
    return ok({ ok: true })
  }),
  http.post(u("/uploads/:id/complete"), async ({ params }) => {
    const up = f2.uploads.find((x) => x.id === params.id)
    if (!up) return notFound()
    if (Date.now() > up.expiresAt || up.filename.includes("mock-expired")) { up.status = "EXPIRED"; save(); return fail("UPLOAD_EXPIRED", 410, "The upload link expired. Start the upload again.") }
    if (!up.sent) return fail("UPLOAD_INCOMPLETE", 409, "The file hasn't arrived.", { expectedBytes: up.sizeBytes, actualBytes: null })
    const name = up.filename
    const probed = await probe(up.id)
    await delay(400)
    const durationSec = name.includes("mock-short") ? 3 : name.includes("mock-long") ? 184 : probed?.durationSec ?? 29
    if (name.includes("mock-invalid")) { up.status = "FAILED"; save(); return fail("MEDIA_INVALID", 422, "The video can't be decoded.", { reason: "undecodable" }) }
    if (durationSec < LIMITS.minSec) { up.status = "FAILED"; save(); return fail("MEDIA_TOO_SHORT", 422, "The video is too short.", { durationSec, minSec: LIMITS.minSec }) }
    if (durationSec > LIMITS.maxSec) { up.status = "FAILED"; save(); return fail("MEDIA_TOO_LONG", 422, "The video is too long.", { durationSec, maxSec: LIMITS.maxSec }) }
    const width = name.includes("mock-lowres") ? 360 : probed?.width || 1080
    const height = name.includes("mock-lowres") ? 640 : probed?.height || 1920
    if (Math.min(width, height) < 240) { up.status = "FAILED"; save(); return fail("MEDIA_INVALID", 422, "The video is too small.", { reason: "too_small" }) }
    Object.assign(up, {
      status: "READY", durationSec, width, height,
      warnings: [...(name.includes("mock-noaudio") ? ["no_audio"] : []), ...(Math.min(width, height) < 720 ? ["low_resolution"] : [])],
    })
    save()
    return ok({ uploadId: up.id, status: "READY", file: uploadFile(up), warnings: up.warnings, analysisEstimateUsd: Math.round(durationSec * config().analysisUsdPerSec * 100) / 100 })
  }),

  // ───── §19 champions
  http.get(u("/champions/config"), () => ok(config())),
  http.get(u("/champions"), async ({ request }) => {
    const s = await listScenario(request.url)
    const p = new URL(request.url).searchParams
    const offerId = p.get("offerId")
    const rows = s === "empty" ? [] : f2.champions.filter((c) => !c.archived && (!offerId || c.offerId === offerId)).map(championRow)
    return ok(rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Number(p.get("limit") ?? 30)), { nextCursor: null })
  }),
  http.post(u("/champions"), async ({ request }) => {
    const b = await body<CreateChampionBody>(request)
    if (!db.offers.some((o) => o.id === b.offerId)) return fail("NOT_FOUND", 404, "Offer not found.")
    if (!b.uploadId && !b.adLibraryUrl) return validation("uploadId", "uploadId_or_adLibraryUrl")
    if (b.rights !== "OWN" && b.rights !== "THIRD_PARTY") return validation("rights", "isEnum")
    const url = b.adLibraryUrl?.trim() || null
    if (url && !url.includes("mock-ad-") && !AD_URL.test(url)) return validation("adLibraryUrl", "ad_library_single_ad")
    const up = readyUpload(b.uploadId)
    if (up instanceof Response) return up
    if (!up && (url?.includes("mock-ad-unavailable") || !adLibrary().available)) {
      const a = adLibrary()
      return fail("AD_LIBRARY_UNAVAILABLE", 503, "The Ad Library reader is unavailable.", { reason: a.reason ?? "quota", retryAfter: a.retryAfter ?? "2026-10-19" })
    }
    const cap = capCheck(((up?.durationSec ?? 20) * config().analysisUsdPerSec))
    if (cap) return cap
    await delay(250)
    return ok(championDetail(newChampion({ offerId: b.offerId, name: b.name, upload: up, adLibraryUrl: url, rights: b.rights, notes: b.notes ?? null })), undefined, 202)
  }),
  http.get(u("/champions/:id"), ({ params }) => {
    const c = champion(params.id)
    return c ? ok(championDetail(c)) : notFound()
  }),
  http.patch(u("/champions/:id"), async ({ params, request }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    const b = await body<UpdateChampionBody>(request)
    if (b.name !== undefined) {
      if (!b.name.trim()) return validation("name", "isNotEmpty")
      c.name = b.name.trim()
    }
    if (b.rights !== undefined) c.rights = b.rights
    if (b.notes !== undefined) c.notes = b.notes
    c.updatedAt = Date.now()
    save()
    return ok(championDetail(c))
  }),
  http.put(u("/champions/:id/video"), async ({ params, request }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    if (c.status !== "FAILED") return invalid(c.status, ["FAILED"])
    const up = readyUpload((await body<AttachChampionVideoBody>(request)).uploadId)
    if (!up) return validation("uploadId", "isNotEmpty")
    if (up instanceof Response) return up
    Object.assign(c, { uploadId: up.id, durationSec: up.durationSec, width: up.width ?? 1080, height: up.height ?? 1920, hasAudio: !up.warnings.includes("no_audio"), lowRes: up.warnings.includes("low_resolution"), reached: 0 })
    startAnalysis(c)
    save()
    return ok(championDetail(c), undefined, 202)
  }),
  http.post(u("/champions/:id/analyze"), async ({ params, request }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    if (c.status === "ANALYZING" || c.status === "RESOLVING") return invalid(c.status, ["READY", "FAILED"])
    if (!c.durationSec) return invalid(c.status, ["READY"])
    const b = await body<{ confirm?: boolean }>(request)
    if (c.editedSections.length && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "Analyzing again replaces your edits.", { editedSections: c.editedSections })
    const cap = capCheck(c.durationSec * config().analysisUsdPerSec)
    if (cap) return cap
    const retry = c.status === "FAILED"
    if (!retry) Object.assign(c, { overrides: {}, wordFixes: {}, editedSections: [], reached: 0 })
    startAnalysis(c, retry)
    save()
    return ok({ job: championDetail(c).job }, undefined, 202)
  }),
  http.patch(u("/champions/:id/teardown"), async ({ params, request }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    if (c.status === "ANALYZING") return invalid(c.status, ["READY", "FAILED"])
    if (!c.analyzedAt) return notFound()
    const b = await body<UpdateTeardownBody>(request)
    for (const [k, v] of Object.entries(b.sections ?? {})) {
      if (!SECTION_KEYS.includes(k as TeardownSectionKey)) return validation(`sections.${k}`, "isEnum")
      ;(c.overrides as Record<string, unknown>)[k] = v
      if (!c.editedSections.includes(k as TeardownSectionKey)) c.editedSections.push(k as TeardownSectionKey)
    }
    for (const w of b.transcriptWords ?? []) {
      if (!Number.isInteger(w.index) || !w.word?.trim()) return validation("transcriptWords", "index_and_word")
      c.wordFixes[w.index] = w.word.trim()
      if (!c.editedSections.includes("transcript")) c.editedSections.push("transcript")
    }
    c.updatedAt = Date.now()
    save()
    await delay(120)
    return ok(championDetail(c).teardown)
  }),
  http.delete(u("/champions/:id"), ({ params }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    c.archived = true
    save()
    return ok({ ok: true })
  }),
  http.get(u("/champions/:id/batches"), ({ params }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    return ok(f2.batches.filter((b) => b.championId === c.id).map(batchView))
  }),

  // ───── §20 batches
  http.post(u("/champions/:id/batches"), async ({ params, request }) => {
    const c = champion(params.id)
    if (!c) return notFound()
    if (c.status !== "READY") return invalid(c.status, ["READY"])
    const b = await body<CreateBatchBody>(request)
    const bad = validRequests(b.requests)
    if (bad) return bad
    for (const r of b.requests) {
      if (!config().kinds.find((k) => k.kind === r.kind)?.enabled) return fail("KIND_NOT_ENABLED", 422, "This variation type isn't available yet.", { kind: r.kind })
      if (!c.hasSpeech) return fail("NO_SPEECH", 422, "This variation needs speech in the winner.", { kind: r.kind })
    }
    if (b.settings?.keepEdit) {
      const blocked = keepBlocked(c, b.requests.map((r) => r.kind))
      if (blocked) return blocked
    }
    const cap = capCheck(0.05 * b.requests.reduce((a, r) => a + r.count, 0))
    if (cap) return cap
    await delay(200)
    if (b.castingStyle !== undefined && b.castingStyle !== "DIVERSE" && b.castingStyle !== "MATCH_ORIGINAL") return validation("castingStyle", "enum")
    return ok(batchView(newBatch(c, b.requests, b.settings, b.notes ?? null, b.castingStyle ?? "DIVERSE")), undefined, 202)
  }),
  http.get(u("/variation-batches/:id"), ({ params }) => {
    const b = batch(params.id)
    return b ? ok(batchView(b)) : notFound()
  }),
  http.post(u("/variation-batches/:id/replan"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    if (b.status !== "PLAN_READY" && b.status !== "PLAN_FAILED") return invalid(b.status, ["PLAN_READY", "PLAN_FAILED"])
    const x = await body<ReplanBatchBody>(request)
    if (x.requests) {
      const bad = validRequests(x.requests)
      if (bad) return bad
      b.requests = x.requests
    }
    if (x.notes !== undefined) b.notes = x.notes
    if (x.castingStyle !== undefined) {
      if (x.castingStyle !== "DIVERSE" && x.castingStyle !== "MATCH_ORIGINAL") return validation("castingStyle", "enum")
      b.castingStyle = x.castingStyle
    }
    const c = f2.champions.find((y) => y.id === b.championId)!
    const fresh = newBatch(c, b.requests, b.settings, b.notes, b.castingStyle) // same plan logic; keep the id
    f2.batches = f2.batches.filter((y) => y !== fresh)
    Object.assign(b, { ...fresh, id: b.id, createdAt: b.createdAt, costUsd: b.costUsd })
    save()
    return ok(batchView(b), undefined, 202)
  }),
  http.patch(u("/variation-batches/:id/items/:itemId"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const it = b.items.find((x) => x.id === params.itemId)
    if (!it) return notFound()
    if (b.status !== "PLAN_READY") return invalid(b.status, ["PLAN_READY"])
    const x = await body<UpdateVariationItemBody>(request)
    if (x.blocks !== undefined) return validation("blocks", `not_allowed_for_${it.kind}`)
    if (x.hook !== undefined) {
      if (it.kind !== "NEW_HOOKS") return validation("hook", `not_allowed_for_${it.kind}`)
      if (b.settings.keepEdit && b.settings.hookMode === "TEXT" && x.hook.speech !== undefined) return validation("hook.speech", "not_allowed_for_hookMode_TEXT")
      if (x.hook.speech !== undefined && !x.hook.speech.trim()) return validation("hook.speech", "isNotEmpty")
      it.hook = { speech: x.hook.speech ?? it.hook?.speech ?? "", onScreenText: x.hook.onScreenText !== undefined ? x.hook.onScreenText : it.hook?.onScreenText ?? null }
    }
    if (x.included !== undefined) it.included = x.included
    save()
    return ok(itemView(b, it))
  }),
  http.post(u("/variation-batches/:id/items/:itemId/regenerate"), ({ params }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const it = b.items.find((x) => x.id === params.itemId)
    if (!it) return notFound()
    if (b.status !== "PLAN_READY" && b.status !== "PLAN_FAILED") return invalid(b.status, ["PLAN_READY", "PLAN_FAILED"])
    if (b.status === "PLAN_FAILED") b.status = "PLANNING"
    regenerateItem(b, it)
    return ok(itemView(b, it), undefined, 202)
  }),
  http.patch(u("/variation-batches/:id/settings"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    if (b.status !== "PLAN_READY") return invalid(b.status, ["PLAN_READY"])
    const x = await body<UpdateBatchSettingsBody>(request)
    const next: BatchSettings = { ...b.settings, ...x, edit: { ...b.settings.edit, ...(x.edit ?? {}) } }
    if (x.voiceId && !VOICES.some((v) => v.id === x.voiceId)) return validation("voiceId", "isIn")
    if (x.voiceSource && x.voiceSource !== "CATALOG" && x.voiceSource !== "CHAMPION_AUDIO" && x.voiceSource !== "ENGINE_VOICE") return validation("voiceSource", "isEnum")
    if (x.swapEngine && !["LIPSYNC", "KLING", "SEEDANCE"].includes(x.swapEngine)) return validation("swapEngine", "isEnum")
    if (x.swapEngine !== undefined || x.voiceSource !== undefined) {
      // §13.15.1: the engine × audio table
      const c = f2.champions.find((y) => y.id === b.championId)!
      const e = swapSettingsError(c, next)
      if (e && "blockers" in e) return fail("KEEP_EDIT_UNSUPPORTED", 422, "Engine voice can't keep this winner's edit.", { kind: "SWAP_AVATAR", blockers: e.blockers })
      if (e) return validation(e.field, e.rule)
    }
    if (x.hookMode && x.hookMode !== "TEXT") return validation("hookMode", "isIn_TEXT")
    if (x.keepEdit !== undefined && x.keepEdit !== b.settings.keepEdit) {
      // the plan depends on it (control, castings, hook speech): the mock asks for a new batch instead of re-planning in place
      if (x.keepEdit) {
        const c = f2.champions.find((y) => y.id === b.championId)!
        const blocked = keepBlocked(c, b.requests.map((r) => r.kind))
        if (blocked) return blocked
      }
      return validation("keepEdit", "start_a_new_batch")
    }
    b.settings = next
    save()
    return ok(batchView(b))
  }),
  http.patch(u("/variation-batches/:id/castings/:castingId"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const cast = b.castings.find((x) => x.id === params.castingId)
    if (!cast) return notFound()
    const d = ((await body<{ description?: string }>(request)).description ?? "").trim()
    if (d.length < 10 || d.length > 600) return validation("description", "length_10_600")
    cast.description = d
    save()
    return ok(castingView(cast))
  }),
  http.post(u("/variation-batches/:id/castings/:castingId/faces/generate"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const cast = b.castings.find((x) => x.id === params.castingId)
    if (!cast) return notFound()
    if (b.status === "LAUNCHED") return invalid(b.status, ["PLANNING", "PLAN_READY"])
    const x = await body<GenerateCastingFacesBody>(request)
    const d = (x.description ?? "").trim()
    if (d.length < 10 || d.length > 600) return validation("description", "length_10_600")
    const count = x.count ?? 1 // §13.13: casting default 1
    if (![1, 2, 3, 4].includes(count)) return validation("count", "range_1_4")
    const cap = capCheck(count * FACE_UNIT_USD)
    if (cap) return cap
    const round = newFaceRound(b, cast, d, count)
    return ok({ batch: round.batch, faces: castingView(cast).batches[0].faces }, undefined, 202)
  }),
  http.post(u("/variation-batches/:id/castings/:castingId/faces/:faceId/select"), ({ params }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const cast = b.castings.find((x) => x.id === params.castingId)
    const face = cast?.rounds.flatMap((r) => r.faces).find((f) => f.id === params.faceId)
    if (!cast || !face) return notFound()
    if (face.status !== "READY") return invalid(face.status, ["READY"])
    cast.selectedFaceId = face.id
    save()
    return ok(castingView(cast))
  }),
  http.get(u("/variation-batches/:id/estimate"), ({ params }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    // estimate covers included READY items only; with none of them there is nothing to price
    if (!batchView(b).items.some((i) => i.included && i.status === "READY")) {
      return fail("BATCH_INCOMPLETE", 422, "The plan isn't ready yet.", { missing: missingFor(b).filter((m) => "itemId" in m) })
    }
    return ok(estimateOf(b))
  }),
  http.post(u("/variation-batches/:id/launch"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    if (b.status !== "PLAN_READY") return invalid(b.status, ["PLAN_READY"])
    if (!b.items.some((i) => i.included)) return validation("items", "at_least_one_included")
    const missing = missingFor(b)
    if (missing.length) return fail("BATCH_INCOMPLETE", 422, "Something is missing before the batch can run.", { missing })
    const est = estimateOf(b)
    const x = await body<{ expectedCostUsd?: number }>(request)
    if (typeof x.expectedCostUsd !== "number" || Math.abs(est.costUsd - x.expectedCostUsd) > Math.max(0.01, x.expectedCostUsd * 0.1)) {
      return fail("ESTIMATE_CHANGED", 409, "The estimate changed.", { estimateUsd: est.costUsd })
    }
    const cap = capCheck(est.costUsd)
    if (cap) return cap
    await delay(300)
    launch(b as MBatch)
    saveDb()
    const view = batchView(b)
    const creatives = b.items.map((i) => db.creatives.find((c) => c.id === i.creativeId)).filter((c) => !!c).map((c) => toRow(c!))
    return ok({ batch: view, creatives }, undefined, 202)
  }),
]
