import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type {
  ChangeRequestBody, ChangeType, CreativeEvent, CreativeFilter, CreativeRow, EditSettings, Engine, GenerateBody, Offer, RegenerateSceneBody, RegenerateTakeBody, Step,
  UpdateEngineBody, UpdateScriptBody, VideoFormat, OfferReadMeta } from "@/lib/api/types"
import { ENGINES, ME, SERVICES, SPEND, WORKSPACES } from "./fixtures"
import { mockSetupCard, mockWorkspaceOf } from "./auth"
import { patchResult } from "./resultado"
import { f2 } from "./variar"
import {
  advance, advanceAll, advanceJob, db, duration, ENGINE_LABEL, estimateFor, FACE_UNIT_USD, latestRender, newCreative, newExtractJob, offerOf, regenerateScene, regenerateTake, takeView,
  regenerateScript, save, scenesSummary, setState, startFaces, startGeneration, startRender, startScripts, strip, subscribe, toDetail, toRow, touch, VOICES,
  type MCreative,
} from "./db"
import { listScenario } from "./scenario"
import { variarHandlers } from "./handlers-variar"
import { iterateHandlers } from "./handlers-iterate"
import { autoWaiting, touchAllIter } from "./iterate"
import { editorAvailable, editorEntry, editorHandlers, reposition } from "./handlers-editor"
import { metaHandlers } from "./handlers-meta"
import { campaignHandlers } from "./campaigns"
import { brainHandlers } from "./handlers-brain"
import { metaFlag, newWs, onboardingPercent, onboardingSteps, type WsState } from "./v2"
import { NEW_CLIENT_NAME } from "./auth"
import { FACE_DESCRIPTION } from "./content"

const u = (p: string) => API_URL + p
const ok = <D, M>(data: D, meta?: M, status = 200) => HttpResponse.json({ success: true, data, ...(meta ? { meta } : {}) }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const notFound = () => fail("NOT_FOUND", 404, "Not found.")
const invalid = (c: MCreative, allowed: string[]) => fail("INVALID_STATE", 409, "Not allowed in the current state.", { state: c.state, allowed })

function authed(req: Request) {
  return (req.headers.get("Authorization") ?? "").startsWith("Bearer mock-at-")
}

const NEEDS_YOU = (c: CreativeRow) => c.status === "waiting" || c.status === "failed"
const matches = (f: CreativeFilter, c: CreativeRow) =>
  f === "all" || (f === "progress" && c.status === "progress") || (f === "needs_you" && NEEDS_YOU(c)) || (f === "approved" && c.status === "approved")

function creative(cid: unknown) {
  const c = db.creatives.find((x) => x.id === cid)
  if (c) advance(c)
  return c
}
const hasDownstream = (c: MCreative) => c.scenes.length > 0
const resetDetails = (c: MCreative) => ({ scenesLost: c.scenes.length, rendersLost: c.renders.filter((r) => !r.stale).length, spentUsd: Math.round(c.costUsd * 100) / 100 })
/** Review paths by creative (api.md §12 + §13): a lipsync slice redoes the whole take; the champion's edit can't be re-edited here. */
function changeOptions(c: MCreative, per: number): { type: ChangeType; returnsTo: Step; estimateUsd: number; etaSec: number }[] {
  const take = c.take ? c.take.regenUsd : null
  if (c.keep === "HOOK_TEXT") return []
  const swaps = c.scenes.filter((x) => x.swap)
  if (swaps.length) {
    // §13.15.6: SCENE = the priciest stretch, FACE = every stretch, TEXT; no LINE (the copy is the winner's)
    const max = Math.max(...swaps.map((x) => x.swap!.regenerateEstimateUsd))
    const all = swaps.reduce((a, x) => a + x.swap!.regenerateEstimateUsd, 0)
    return [
      { type: "SCENE", returnsTo: "generation", estimateUsd: +max.toFixed(2), etaSec: 420 },
      { type: "TEXT", returnsTo: "edit", estimateUsd: 0, etaSec: 60 },
      { type: "FACE", returnsTo: "avatar", estimateUsd: +all.toFixed(2), etaSec: 600 },
    ]
  }
  const out: { type: ChangeType; returnsTo: Step; estimateUsd: number; etaSec: number }[] = [
    { type: "SCENE", returnsTo: "generation", estimateUsd: take ?? +per.toFixed(2), etaSec: take !== null ? 240 : 150 },
  ]
  if (!c.keep) out.push({ type: "TEXT", returnsTo: "edit", estimateUsd: 0, etaSec: 60 })
  if (!c.keep && !(c.take?.kind === "AUDIO_LIPSYNC")) out.push({ type: "LINE", returnsTo: "generation", estimateUsd: take ?? +per.toFixed(2), etaSec: take !== null ? 240 : 150 })
  out.push({ type: "FACE", returnsTo: "avatar", estimateUsd: c.estimatedCostUsd ?? 3, etaSec: 540 })
  return out
}
const body = async <T,>(r: Request) => ((await r.json().catch(() => ({}))) as T)

function scriptsView(c: MCreative) {
  return { scripts: c.scripts.map(strip), job: c.scriptJob ? strip(c.scriptJob) : null, winnersUsed: c.winnersUsed }
}
function facesView(c: MCreative) {
  return {
    description: c.faceDescription,
    batches: c.batches.map((b) => ({ batch: b.batch, description: b.description, faces: b.faces.map((f) => ({ ...strip(f), selected: f.id === c.selectedFaceId })) })),
    selectedFaceId: c.selectedFaceId,
    faceUnitPriceUsd: FACE_UNIT_USD,
  }
}
function editView(c: MCreative) {
  const latest = latestRender(c)
  const preview = [...c.renders].reverse().find((r) => r.status === "READY" && !r.stale) ?? null
  const e = editorEntry(c.id)
  return {
    settings: c.editSettings!, dirty: c.editDirty, latestRender: latest && !latest.stale ? strip(latest) : null, previewRender: preview ? strip(preview) : null,
    hasEditorChanges: !!e.doc, editorAvailable: editorAvailable(c),
  }
}

/** Resets everything downstream of a changed upstream choice (CONFIRM_DOWNSTREAM_RESET + confirm). */
function dropDownstream(c: MCreative) {
  c.scenes = []
  c.renders.forEach((r) => (r.stale = true))
  c.editSettings = null
  c.editDirty = false
}

// ───── onboarding-v2: the workspace of the token (ws_1 = db.workspace; the others live in db.v2.ws)
const GUSTA_REF = { id: ME.id, name: ME.name, initials: "G" }
function wsStateOf(token: string | null) {
  const ref = mockWorkspaceOf(token)
  if (ref.id === db.workspace.id) return null
  db.v2.ws[ref.id] ??= newWs(ref.id, ref.id.startsWith("ws_new_") ? NEW_CLIENT_NAME : ref.name)
  return db.v2.ws[ref.id]
}
/** Workspace + onboarding.percent/steps/updatedBy (contract §2) for the token's workspace. */
function workspaceView(token: string | null) {
  const ref = mockWorkspaceOf(token)
  const st = wsStateOf(token)
  const base = st ?? db.workspace
  const meta = db.v2.meta[ref.id] ?? null
  const steps = onboardingSteps(base, db.offers, meta, metaFlag() === "off")
  const onboarding = { ...base.onboarding, percent: onboardingPercent(steps, base.onboarding.completedAt), steps, updatedBy: st ? st.updatedBy : null, updatedAt: st ? st.updatedAt : null }
  if (st) {
    const { updatedBy: _u, updatedAt: _a, ...rest } = st
    void _u; void _a
    return { ...rest, onboarding }
  }
  return { ...db.workspace, onboarding }
}
function onboardingSummaryOf(id: string) {
  const st = id === db.workspace.id ? null : (db.v2.ws[id] ?? null)
  const base = st ?? (id === db.workspace.id ? db.workspace : newWs(id, NEW_CLIENT_NAME))
  const steps = onboardingSteps(base, db.offers, db.v2.meta[id] ?? null, metaFlag() === "off")
  return { status: base.status, onboarding: { step: base.onboarding.step, percent: onboardingPercent(steps, base.onboarding.completedAt), completedAt: base.onboarding.completedAt } }
}
const accountModeOf = (id: string) => (id.startsWith("ws_new_") ? db.v2.newAccountMode : db.v2.accountMode)
function touchSetup(st: WsState | null) {
  if (st) {
    st.updatedBy = GUSTA_REF
    st.updatedAt = new Date().toISOString()
  }
}

export const handlers = [
  http.all(u("/*"), ({ request }) => {
    const path = new URL(request.url).pathname
    if (path.includes("/auth/invites/")) return undefined
    if (!authed(request)) return fail("UNAUTHORIZED", 401, "Missing or expired token.")
    return undefined
  }),

  // ───── §2 auth
  http.get(u("/auth/me"), ({ request }) => {
    const token = request.headers.get("Authorization")
    const active = mockWorkspaceOf(token)
    wsStateOf(token)
    const refs = WORKSPACES.some((w) => w.id === active.id) ? WORKSPACES : [...WORKSPACES, active]
    return ok({
      user: { id: ME.id, name: ME.name, email: ME.email, uiLocale: db.uiLocale, accountMode: accountModeOf(active.id) },
      workspace: { ...active, name: workspaceView(token).name, ...onboardingSummaryOf(active.id), tourCompletedAt: db.v2.tour[active.id] ?? null },
      workspaces: refs.map((w) => ({ ...w, name: w.id === db.workspace.id ? db.workspace.name : (db.v2.ws[w.id]?.name ?? w.name), ...onboardingSummaryOf(w.id) })),
    })
  }),
  http.patch(u("/auth/me"), async ({ request }) => {
    const b = await body<{ uiLocale?: "EN" | "PT_BR"; accountMode?: "AGENCY" | "OWN" }>(request)
    if (b.uiLocale) db.uiLocale = b.uiLocale
    if (b.accountMode !== undefined) {
      if (b.accountMode !== "AGENCY" && b.accountMode !== "OWN") return fail("VALIDATION_ERROR", 400, "accountMode must be AGENCY or OWN.", { fields: [{ field: "accountMode", rule: "isEnum" }] })
      const id = mockWorkspaceOf(request.headers.get("Authorization")).id
      if (id.startsWith("ws_new_")) db.v2.newAccountMode = b.accountMode
      else db.v2.accountMode = b.accountMode
    }
    save()
    await delay(200)
    return ok({ id: ME.id, name: ME.name, email: ME.email, uiLocale: db.uiLocale, accountMode: accountModeOf(mockWorkspaceOf(request.headers.get("Authorization")).id) })
  }),
  http.get(u("/auth/invites/:token"), ({ params }) => {
    const inv = db.members.invites.find((i) => i.id === params.token)
    if (!inv || Date.parse(inv.expiresAt) < Date.now()) return fail("INVITE_INVALID", 410, "Invite expired or already used.")
    return ok({ workspaceName: db.workspace.name, email: inv.email, role: inv.role })
  }),

  // ───── §3 home
  http.get(u("/creatives"), async ({ request }) => {
    const s = await listScenario(request.url)
    advanceAll()
    const p = new URL(request.url).searchParams
    const filter = (p.get("filter") ?? "all") as CreativeFilter
    const q = (p.get("q") ?? "").trim().toLowerCase()
    const limit = Number(p.get("limit") ?? 30)
    const championId = p.get("championId")
    const origin = p.get("origin")
    const all = (s === "empty" ? [] : db.creatives.map(toRow)).filter((c) =>
      (!championId || c.variation?.championId === championId) && (!origin || (origin === "variation") === !!c.variation))
    const searched = all.filter((c) => !q || c.name.toLowerCase().includes(q))
    const rows = searched.filter((c) => matches(filter, c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit)
    const counts = {
      all: searched.length, progress: searched.filter((c) => matches("progress", c)).length,
      needs_you: searched.filter((c) => matches("needs_you", c)).length, approved: searched.filter((c) => matches("approved", c)).length,
    }
    // fase2-agencia.md §3.6: waitingOnYou ignores filter and search; batches waiting = PLAN_READY / PLAN_FAILED of a live champion
    const waitingBatches = s === "empty" ? [] : f2.batches
      .filter((b) => (b.status === "PLAN_READY" || b.status === "PLAN_FAILED") && !f2.champions.find((c) => c.id === b.championId)?.archived)
      .map((b) => {
        const ch = f2.champions.find((c) => c.id === b.championId)
        const of = db.offers.find((o) => o.id === b.offerId)
        return {
          id: b.id, championId: b.championId, championName: ch?.name ?? "—", offer: { id: b.offerId, name: of?.name ?? "—" },
          status: b.status as "PLAN_READY" | "PLAN_FAILED", updatedAt: new Date(b.t0 || b.createdAt).toISOString(),
        }
      })
      .map((b) => ({ ...b, mode: "MANUAL" as const, readyCount: null }))
    // variacao-auto-v1 §5.4: AUTO batches in PLAN_READY · ANALYSIS_FAILED · all pieces settled and not downloaded
    const allWaiting = s === "empty" ? waitingBatches : [...waitingBatches, ...autoWaiting()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const creativesWaiting = all.filter((c) => matches("needs_you", c)).length
    return ok(rows, {
      nextCursor: null, counts,
      waitingOnYou: { creatives: creativesWaiting, batches: allWaiting.length, total: creativesWaiting + allWaiting.length },
      waitingBatches: filter === "needs_you" ? (allWaiting.slice(0, 6) as typeof waitingBatches) : [],
    })
  }),

  // ───── §4 offers
  http.get(u("/offers"), async ({ request }) => {
    const s = await listScenario(request.url)
    return ok(s === "empty" ? [] : db.offers, { nextCursor: null })
  }),
  http.get(u("/offers/:id"), ({ params }) => {
    const o = db.offers.find((x) => x.id === params.id)
    return o ? ok(o) : notFound()
  }),
  http.post(u("/offers/extract"), async ({ request }) => {
    const b = await body<{ url?: string; pageText?: string }>(request)
    if (!b.url && !b.pageText) return fail("VALIDATION_ERROR", 400, "url or pageText is required.", { fields: [{ field: "url", rule: "isUrl" }] })
    return ok(strip(newExtractJob(b)), undefined, 202)
  }),
  http.post(u("/offers"), async ({ request }) => {
    const b = await body<Partial<Offer> & { readMeta?: OfferReadMeta }>(request)
    if (!b.name || !b.language) return fail("VALIDATION_ERROR", 400, "name and language are required.", { fields: [{ field: "name", rule: "isNotEmpty" }] })
    const o: Offer = {
      // briefing-leitura-v2 D5: a new offer keeps `output.readMeta` as sent; returned by GET /offers and /offers/:id
      readMeta: b.readMeta ?? null,
      id: `of_${Math.random().toString(36).slice(2, 8)}`, name: b.name, language: b.language, sourceUrl: b.sourceUrl ?? null,
      kind: b.kind ?? null, what: b.what ?? null, audience: b.audience ?? null, promise: b.promise ?? null, pains: b.pains ?? null, proof: b.proof ?? null,
      offerAndPrice: b.offerAndPrice ?? null, cta: b.cta ?? null, notes: b.notes ?? null, fieldSources: b.fieldSources ?? {},
      creativesCount: 0, winnersCount: 0, updatedAt: new Date().toISOString(),
    }
    db.offers.unshift(o)
    save()
    await delay(200)
    return ok(o, undefined, 201)
  }),
  http.patch(u("/offers/:id"), async ({ params, request }) => {
    const o = db.offers.find((x) => x.id === params.id)
    if (!o) return notFound()
    const b = await body<Partial<Offer>>(request)
    for (const [k, v] of Object.entries(b)) {
      if (k === "fieldSources") continue // applied after: what the web sends wins over the automatic "user" (QA bug 14)
      ;(o as unknown as Record<string, unknown>)[k] = v
      // D6: `readMeta` rides along with the apply of a reread; it is not a brief field
      if (k !== "sourceUrl" && k !== "notes" && k !== "readMeta") o.fieldSources[k as keyof Offer["fieldSources"]] = "user"
    }
    if (b.fieldSources) Object.assign(o.fieldSources, b.fieldSources)
    o.updatedAt = new Date().toISOString()
    save()
    await delay(200)
    return ok(o)
  }),
  http.post(u("/offers/:id/reread"), async ({ params, request }) => {
    const o = db.offers.find((x) => x.id === params.id)
    if (!o) return notFound()
    const b = await body<{ pageText?: string }>(request)
    if (!o.sourceUrl && !b.pageText) return fail("INVALID_STATE", 409, "No source URL.")
    return ok(strip(newExtractJob({ url: o.sourceUrl ?? undefined, pageText: b.pageText, offerId: o.id })), undefined, 202)
  }),
  http.get(u("/jobs/:id"), ({ params }) => {
    const j = db.jobs.find((x) => x.id === params.id) ?? db.creatives.map((c) => c.scriptJob).find((x) => x?.id === params.id)
    return j ? ok(strip(advanceJob(j))) : notFound()
  }),

  // ───── §6 creative
  http.post(u("/creatives"), async ({ request }) => {
    const b = await body<{ offerId: string; name?: string; scriptCount?: number }>(request)
    const o = db.offers.find((x) => x.id === b.offerId)
    if (!o) return notFound()
    const missing = (["what", "promise"] as const).filter((k) => !o[k]?.trim())
    if (missing.length) return fail("OFFER_INCOMPLETE", 422, "The offer brief is incomplete.", { missing })
    const c = newCreative(o, { id: ME.id, name: ME.name, initials: "G" }, b.scriptCount ?? 4)
    if (b.name) c.name = b.name
    o.creativesCount += 1
    save()
    return ok(toDetail(c), undefined, 201)
  }),
  http.get(u("/creatives/:id"), ({ params }) => {
    const c = creative(params.id)
    return c ? ok(toDetail(c)) : notFound()
  }),
  http.patch(u("/creatives/:id"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<Record<string, unknown>>(request)
    const extra = Object.keys(b).filter((k) => k !== "name")
    if (extra.length || typeof b.name !== "string" || !b.name.trim()) return fail("VALIDATION_ERROR", 400, "Only name can change.", { fields: (extra.length ? extra : ["name"]).map((field) => ({ field, rule: "whitelist" })) })
    c.name = b.name.trim()
    touch(c)
    return ok(toDetail(c))
  }),
  http.get(u("/creatives/:id/events"), ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const enc = new TextEncoder()
    let off: (() => void) | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const send = (e: CreativeEvent) => {
          try {
            ctrl.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`))
          } catch {
            off?.()
          }
        }
        send({ event: "snapshot", data: toDetail(c) })
        off = subscribe(c.id, send)
        ping = setInterval(() => {
          try { ctrl.enqueue(enc.encode(": ping\n\n")) } catch {}
        }, 20_000)
        request.signal.addEventListener("abort", () => {
          off?.()
          if (ping) clearInterval(ping)
          try { ctrl.close() } catch {}
        })
      },
      cancel() {
        off?.()
        if (ping) clearInterval(ping)
      },
    })
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } })
  }),

  // ───── §7 scripts
  http.get(u("/creatives/:id/scripts"), ({ params }) => {
    const c = creative(params.id)
    return c ? ok(scriptsView(c)) : notFound()
  }),
  http.post(u("/creatives/:id/scripts/generate"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<{ count: number; replace: boolean; confirm?: boolean }>(request)
    if (c.state === "SCRIPTS_WRITING") return invalid(c, ["SCRIPTS_READY", "SCRIPTS_FAILED"])
    if (c.state === "APPROVED") return invalid(c, ["SCRIPTS_READY", "SCRIPTS_FAILED"])
    if (b.replace && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    const active = c.scripts.filter((s) => s.status !== "FAILED").length
    if (!b.replace && active + b.count > 5) return fail("VALIDATION_ERROR", 400, "At most 5 scripts.", { fields: [{ field: "count", rule: "max" }] })
    if (b.replace) {
      dropDownstream(c)
      c.selectedScriptId = null
    }
    const fresh = startScripts(c, b.count, b.replace)
    return ok({ job: strip(c.scriptJob!), scripts: fresh.map(strip) }, undefined, 202)
  }),
  http.post(u("/creatives/:id/scripts/:sid/regenerate"), async ({ params, request }) => {
    const c = creative(params.id)
    const s = c?.scripts.find((x) => x.id === params.sid)
    if (!c || !s) return notFound()
    const b = await body<{ confirm?: boolean }>(request)
    if (s.status === "WRITING" || c.state === "APPROVED") return invalid(c, ["SCRIPTS_READY"])
    if (c.selectedScriptId === s.id && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    if (c.selectedScriptId === s.id) dropDownstream(c)
    regenerateScript(c, s)
    return ok({ job: strip(c.scriptJob!), script: strip(s) }, undefined, 202)
  }),
  http.patch(u("/creatives/:id/scripts/:sid"), async ({ params, request }) => {
    const c = creative(params.id)
    const s = c?.scripts.find((x) => x.id === params.sid)
    if (!c || !s) return notFound()
    const b = await body<UpdateScriptBody>(request)
    if (s.status !== "READY") return invalid(c, ["SCRIPTS_READY"])
    if (c.selectedScriptId === s.id && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    if (b.angle) s.angle = b.angle
    for (const blk of b.blocks ?? []) {
      const t = s.blocks[blk.index]
      if (!t) continue
      if (blk.speech !== undefined) t.speech = blk.speech
      if (blk.visualPrompt !== undefined) t.visualPrompt = blk.visualPrompt
    }
    s.full = s.blocks
    s.editedByUser = true
    if (c.selectedScriptId === s.id && hasDownstream(c)) {
      dropDownstream(c)
      setState(c, c.selectedFaceId ? "ENGINE_PENDING" : c.batches.length ? "FACES_READY" : "AVATAR_PENDING")
    }
    touch(c)
    return ok(strip(s))
  }),
  http.post(u("/creatives/:id/scripts/:sid/select"), async ({ params, request }) => {
    const c = creative(params.id)
    const s = c?.scripts.find((x) => x.id === params.sid)
    if (!c || !s) return notFound()
    const b = await body<{ confirm?: boolean }>(request)
    if (s.status !== "READY" || c.state === "APPROVED" || c.state === "SCRIPTS_WRITING") return invalid(c, ["SCRIPTS_READY"])
    if (c.selectedScriptId !== s.id && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    if (c.selectedScriptId !== s.id) dropDownstream(c)
    c.scripts.forEach((x) => (x.selected = x.id === s.id))
    c.selectedScriptId = s.id
    c.faceDescription ??= FACE_DESCRIPTION[c.offerId] ?? null
    setState(c, c.selectedFaceId ? "ENGINE_PENDING" : c.batches.some((x) => x.faces.some((f) => f.status === "READY")) ? "FACES_READY" : "AVATAR_PENDING")
    return ok(toDetail(c))
  }),

  // ───── §8 avatar
  http.get(u("/creatives/:id/faces"), ({ params }) => {
    const c = creative(params.id)
    return c ? ok(facesView(c)) : notFound()
  }),
  http.post(u("/creatives/:id/faces/generate"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<{ description?: string; count?: number }>(request)
    const d = (b.description ?? "").trim()
    if (d.length < 10 || d.length > 600) return fail("VALIDATION_ERROR", 400, "Description must have 10-600 characters.", { fields: [{ field: "description", rule: "length" }] })
    const count = b.count ?? 4 // §13.13: creative default 4
    if (![1, 2, 3, 4].includes(count)) return fail("VALIDATION_ERROR", 400, "count must be 1-4.", { fields: [{ field: "count", rule: "range_1_4" }] })
    if (!["AVATAR_PENDING", "FACES_READY", "FACES_FAILED", "ENGINE_PENDING"].includes(c.state)) return invalid(c, ["AVATAR_PENDING", "FACES_READY", "FACES_FAILED"])
    const batch = startFaces(c, d, count)
    return ok({ batch: batch.batch, faces: batch.faces.map(strip) }, undefined, 202)
  }),
  http.post(u("/creatives/:id/faces/:fid/select"), async ({ params, request }) => {
    const c = creative(params.id)
    const f = c?.batches.flatMap((x) => x.faces).find((x) => x.id === params.fid)
    if (!c || !f) return notFound()
    const b = await body<{ confirm?: boolean }>(request)
    if (f.status !== "READY" || c.state === "FACES_GENERATING" || c.state === "APPROVED") return invalid(c, ["FACES_READY"])
    if (c.selectedFaceId !== f.id && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    if (c.selectedFaceId !== f.id) dropDownstream(c)
    c.selectedFaceId = f.id
    setState(c, "ENGINE_PENDING")
    return ok(toDetail(c))
  }),
  http.patch(u("/creatives/:id/faces/description"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<{ description: string }>(request)
    c.faceDescription = b.description
    touch(c)
    return ok({ description: c.faceDescription })
  }),

  // ───── §9 engine
  http.get(u("/engines"), () => ok(ENGINES)),
  http.get(u("/voices"), ({ request }) => {
    const lang = new URL(request.url).searchParams.get("language")
    return ok(VOICES.filter((v) => !lang || v.language === lang).map((v) => ({ ...v, sample: { url: "/mock/voice.mp3" } })))
  }),
  http.get(u("/creatives/:id/estimate"), ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (!c.selectedScriptId || !c.selectedFaceId) return invalid(c, ["ENGINE_PENDING"])
    const p = new URL(request.url).searchParams
    return ok(estimateFor(c, (p.get("engine") ?? "SCENES") as Engine, p.get("model") ?? "kling-3.0", p.get("voiceId") ?? undefined))
  }),
  http.patch(u("/creatives/:id/engine"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<UpdateEngineBody>(request)
    if (c.state !== "ENGINE_PENDING") return invalid(c, ["ENGINE_PENDING"])
    if (b.engine) c.engine = b.engine
    if (b.engineModel) c.engineModel = b.engineModel
    if (b.voiceId !== undefined) c.voiceId = b.voiceId
    if (b.format) c.format = b.format as VideoFormat
    touch(c)
    return ok(toDetail(c))
  }),
  http.post(u("/creatives/:id/generate"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    const b = await body<GenerateBody>(request)
    if (b.engine === "LIPSYNC" && !b.voiceId) return fail("VALIDATION_ERROR", 400, "voiceId is required for lipsync.", { fields: [{ field: "voiceId", rule: "isNotEmpty" }] })
    const okStates = ["ENGINE_PENDING", "SCENES_FAILED", "EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"]
    if (!okStates.includes(c.state) || !c.selectedFaceId) return invalid(c, ["ENGINE_PENDING"])
    if (c.state !== "ENGINE_PENDING" && hasDownstream(c) && !b.confirm) return fail("CONFIRM_DOWNSTREAM_RESET", 409, "This discards generated scenes.", resetDetails(c))
    const est = estimateFor(c, b.engine, b.engineModel, b.voiceId)
    if (est.costUsd > b.expectedCostUsd * 1.1) return fail("ESTIMATE_CHANGED", 409, "The estimate changed.", { estimateUsd: est.costUsd })
    const cap = db.workspace.monthlySpendCapUsd
    if (cap !== null && db.spentUsd + est.costUsd > cap) return fail("SPEND_CAP_EXCEEDED", 409, "Monthly spend cap reached.", { spentUsd: +db.spentUsd.toFixed(2), capUsd: cap, estimateUsd: est.costUsd })
    Object.assign(c, { engine: b.engine, engineModel: b.engineModel, voiceId: b.voiceId ?? null, format: b.format, estimatedCostUsd: est.costUsd })
    startGeneration(c)
    await delay(250)
    return ok({ creative: toDetail(c), scenes: c.scenes.map(strip) }, undefined, 202)
  }),

  // ───── §10 generation
  http.get(u("/creatives/:id/scenes"), ({ params }) => {
    const c = creative(params.id)
    return c ? ok({ summary: scenesSummary(c), scenes: c.scenes.map(strip) }) : notFound()
  }),
  http.post(u("/creatives/:id/scenes/:index/regenerate"), async ({ params, request }) => {
    const c = creative(params.id)
    const sc = c?.scenes.find((x) => x.index === Number(params.index))
    if (!c || !sc) return notFound()
    if (sc.status !== "READY" && sc.status !== "FAILED") return invalid(c, ["SCENES_GENERATING", "SCENES_FAILED", "EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"])
    if (!["SCENES_GENERATING", "SCENES_FAILED", "EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"].includes(c.state)) return invalid(c, ["SCENES_FAILED"])
    const b = await body<RegenerateSceneBody>(request)
    if (sc.swap) {
      // §13.15: redoing a stretch costs money again; only with confirm + the price the screen showed
      if (!b.confirm || typeof b.expectedCostUsd !== "number") {
        return fail("INVALID_STATE", 409, "Redoing this stretch costs money: confirm it with the price.", { state: c.state, allowed: [c.state], reason: "regenerate_swap_scene", estimateUsd: sc.swap.regenerateEstimateUsd })
      }
      if (Math.abs(b.expectedCostUsd - sc.swap.regenerateEstimateUsd) > 0.01) return fail("ESTIMATE_CHANGED", 409, "The estimate changed.", { estimateUsd: sc.swap.regenerateEstimateUsd })
      const cap = db.workspace.monthlySpendCapUsd
      if (cap !== null && db.spentUsd + sc.swap.regenerateEstimateUsd > cap) return fail("SPEND_CAP_EXCEEDED", 409, "Monthly spend cap reached.", { spentUsd: +db.spentUsd.toFixed(2), capUsd: cap, estimateUsd: sc.swap.regenerateEstimateUsd })
      regenerateScene(c, sc, {})
      return ok(strip(sc), undefined, 202)
    }
    if (sc.take && c.take) {
      // §13.5: a slice can't be redone alone; the whole take is, with confirm + the price the screen showed
      const tv = takeView(c)!
      if (tv.status === "QUEUED" || tv.status === "GENERATING") return invalid(c, ["SCENES_FAILED", "EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"])
      if (!b.confirm || typeof b.expectedCostUsd !== "number") {
        return fail("INVALID_STATE", 409, "This scene is a slice of one take: redoing it redoes the whole take.", { state: c.state, allowed: [c.state], reason: "regenerate_take", takeId: c.take.id, estimateUsd: c.take.regenUsd })
      }
      if (Math.abs(b.expectedCostUsd - c.take.regenUsd) > 0.01) return fail("ESTIMATE_CHANGED", 409, "The estimate changed.", { estimateUsd: c.take.regenUsd })
      regenerateTake(c, b.speech !== undefined ? { index: sc.index, text: b.speech } : undefined)
      return ok(strip(sc), undefined, 202)
    }
    regenerateScene(c, sc, b)
    return ok(strip(sc), undefined, 202)
  }),
  http.post(u("/creatives/:id/take/regenerate"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c || !c.take) return notFound()
    const tv = takeView(c)!
    if (tv.status === "QUEUED" || tv.status === "GENERATING") return invalid(c, ["SCENES_FAILED", "EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"])
    const b = await body<RegenerateTakeBody>(request)
    if (typeof b.expectedCostUsd !== "number") return fail("VALIDATION_ERROR", 400, "expectedCostUsd is required.", { fields: [{ field: "expectedCostUsd", rule: "isNumber" }] })
    if (Math.abs(b.expectedCostUsd - c.take.regenUsd) > 0.01) return fail("ESTIMATE_CHANGED", 409, "The estimate changed.", { estimateUsd: c.take.regenUsd })
    const cap = db.workspace.monthlySpendCapUsd
    if (cap !== null && db.spentUsd + c.take.regenUsd > cap) return fail("SPEND_CAP_EXCEEDED", 409, "Monthly spend cap reached.", { spentUsd: +db.spentUsd.toFixed(2), capUsd: cap, estimateUsd: c.take.regenUsd })
    regenerateTake(c)
    return ok(takeView(c), undefined, 202)
  }),

  // ───── §11 edit
  http.get(u("/templates"), () =>
    ok([
      { id: "clean", kind: "scratch", labelKey: "template.clean", thumbnail: { url: "/mock/poster.png" }, supportsHeadline: false },
      { id: "bold", kind: "scratch", labelKey: "template.bold", thumbnail: { url: "/mock/poster.png" }, supportsHeadline: false },
      { id: "headline", kind: "scratch", labelKey: "template.headline", thumbnail: { url: "/mock/poster.png" }, supportsHeadline: true },
      { id: "remix-keep", kind: "remix", labelKey: "template.remixKeep", thumbnail: { url: "/mock/poster.png" }, supportsHeadline: false },
    ])
  ),
  http.get(u("/creatives/:id/edit"), ({ params }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (!c.editSettings) return invalid(c, ["EDIT_PENDING", "RENDERING", "RENDER_FAILED", "RENDER_READY"])
    return ok(editView(c))
  }),
  http.patch(u("/creatives/:id/edit"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c || !c.editSettings) return notFound()
    if (c.editSettings.templateId === "remix-keep") return fail("INVALID_STATE", 409, "This variation keeps the champion's edit.", { state: c.state, allowed: [], reason: "variation_locked" })
    if (c.state === "APPROVED") return invalid(c, ["EDIT_PENDING", "RENDER_READY"])
    const b = await body<Partial<EditSettings>>(request)
    reposition(c.id, { template: b.templateId !== undefined && b.templateId !== c.editSettings.templateId, caption: b.captionPosition !== undefined && b.captionPosition !== c.editSettings.captionPosition })
    Object.assign(c.editSettings, b)
    if (b.headline === undefined && c.editSettings.templateId !== "headline") c.editSettings.headline = c.editSettings.headline ?? null
    c.editDirty = true
    if (c.state === "RENDER_READY") setState(c, "EDIT_PENDING")
    touch(c)
    return ok({ settings: c.editSettings, dirty: true })
  }),
  http.post(u("/creatives/:id/render"), ({ params }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (!["EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"].includes(c.state)) return invalid(c, ["EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"])
    const r = startRender(c)
    // editor-v1 §3.4: the render keeps a copy of the doc and the revision it rendered
    const e = editorEntry(c.id)
    r.doc = e.doc
    r.editRevision = e.revision
    return ok(strip(r), undefined, 202)
  }),
  http.get(u("/creatives/:id/renders/:rid"), ({ params }) => {
    const c = creative(params.id)
    const r = c?.renders.find((x) => x.id === params.rid)
    return r ? ok(strip(r)) : notFound()
  }),

  // ───── §12 review
  http.get(u("/creatives/:id/review"), ({ params }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (c.state !== "RENDER_READY" && c.state !== "APPROVED") return invalid(c, ["RENDER_READY", "APPROVED"])
    const d = toDetail(c)
    const s = c.scripts.find((x) => x.id === c.selectedScriptId)!
    const per = (c.estimatedCostUsd ?? 3) / Math.max(1, c.scenes.length)
    return ok({
      creative: d, video: latestRender(c)!.video!,
      facts: { offerName: offerOf(c).name, scriptLetter: s.letter, angle: s.angle, face: d.summary.face!, engineLabel: ENGINE_LABEL[c.engineModel!], durationSec: duration(c), format: c.format, costUsd: d.costUsd },
      changeOptions: changeOptions(c, per),
    })
  }),
  http.post(u("/creatives/:id/approve"), ({ params }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (c.state !== "RENDER_READY" || c.editDirty) return invalid(c, ["RENDER_READY"])
    c.approvedAt = Date.now()
    setState(c, "APPROVED")
    const d = toDetail(c)
    db.library.unshift({
      id: c.id, name: c.name, offer: { id: c.offerId, name: offerOf(c).name }, engineLabel: ENGINE_LABEL[c.engineModel!] ?? "—", durationSec: duration(c),
      video: latestRender(c)!.video!, thumbnail: d.thumbnail!, isWinner: false, approvedAt: new Date(c.approvedAt).toISOString(), approvedBy: { id: ME.id, name: ME.name, initials: "G" },
      variation: c.variation ?? null,
      // D1: the approved video went out with editor changes (derived from the render's doc, like the API)
      editedInEditor: d.editedInEditor, adName: d.adName,
    })
    save()
    return ok(d)
  }),
  http.post(u("/creatives/:id/changes"), async ({ params, request }) => {
    const c = creative(params.id)
    if (!c) return notFound()
    if (c.state !== "RENDER_READY") return invalid(c, ["RENDER_READY"])
    const b = await body<ChangeRequestBody>(request)
    if (!changeOptions(c, 0).some((o) => o.type === b.type)) return fail("INVALID_STATE", 409, "Not available for this creative.", { state: c.state, allowed: [c.state], reason: "change_not_available" })
    let returnTo: Step = "edit"
    if ((b.type === "SCENE" || b.type === "LINE") && c.take) {
      regenerateTake(c, b.type === "LINE" ? { index: b.sceneIndex, text: b.newSpeech } : undefined)
      returnTo = "generation"
    } else if (b.type === "SCENE" || b.type === "LINE") {
      const sc = c.scenes.find((x) => x.index === b.sceneIndex)
      if (!sc) return fail("VALIDATION_ERROR", 400, "Unknown scene.", { fields: [{ field: "sceneIndex", rule: "exists" }] })
      regenerateScene(c, sc, b.type === "LINE" ? { speech: b.newSpeech } : {})
      returnTo = "generation"
    } else if (b.type === "TEXT") {
      c.editDirty = true
      setState(c, "EDIT_PENDING")
    } else {
      c.selectedFaceId = null
      dropDownstream(c)
      setState(c, "FACES_READY")
      returnTo = "avatar"
    }
    return ok({ creative: toDetail(c), returnTo })
  }),

  // ───── §13 library
  http.get(u("/library"), async ({ request }) => {
    const s = await listScenario(request.url)
    touchAllIter() // ready AUTO pieces enter the Library by themselves
    const p = new URL(request.url).searchParams
    const offerId = p.get("offerId")
    const winners = p.get("winners") === "true"
    const base = s === "empty" ? [] : db.library
    const championId = p.get("championId")
    const variationKind = p.get("variationKind")
    const variationCode = p.get("variationCode")
    const media = p.get("media")
    const items = base.filter((i) => (!offerId || i.offer.id === offerId) && (!winners || i.isWinner)
      && (!championId || i.variation?.championId === championId) && (!variationKind || i.variation?.kind === variationKind)
      && (!variationCode || (i.variation as { code?: string } | null)?.code === variationCode) && (!media || ((i as { media?: string }).media ?? "video") === media))
    const offers = [...new Map(base.map((i) => [i.offer.id, i.offer])).values()]
    return ok(items, { nextCursor: null, offers })
  }),
  http.put(u("/library/:id/winner"), async ({ params, request }) => {
    const item = db.library.find((x) => x.id === params.id)
    if (!item) return notFound()
    const b = await body<{ isWinner: boolean }>(request)
    item.isWinner = b.isWinner
    const c = db.creatives.find((x) => x.id === item.id)
    if (c) c.isWinner = b.isWinner
    save()
    await delay(150)
    return ok({ id: item.id, isWinner: item.isWinner })
  }),

  // ───── §14 settings
  http.get(u("/workspace"), async ({ request }) => {
    await listScenario(request.url)
    return ok(workspaceView(request.headers.get("Authorization")))
  }),
  http.patch(u("/workspace"), async ({ request }) => {
    const token = request.headers.get("Authorization")
    const st = wsStateOf(token)
    const target = st ?? db.workspace
    const b = await body<Record<string, unknown>>(request)
    const { onboardingStep, paused, ...rest } = b as { onboardingStep?: number; paused?: boolean; businessType?: unknown; brandColor?: unknown }
    // estatico-montado D3: `#RGB` / `#RRGGBB` → 6 uppercase digits; null clears; anything else = 400
    if ("brandColor" in rest && rest.brandColor !== null) {
      const m = typeof rest.brandColor === "string" ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(rest.brandColor.trim()) : null
      if (!m) return fail("VALIDATION_ERROR", 400, "brandColor must be #RGB or #RRGGBB.", { fields: [{ field: "brandColor", rule: "isHexColor" }] })
      const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
      rest.brandColor = `#${h.toUpperCase()}`
    }
    if (onboardingStep && target.onboarding.completedAt) return fail("INVALID_STATE", 409, "Onboarding already completed.", { reason: "onboarding_completed" })
    // resultado-v1: resultType is the source of truth; legacy businessType migrates; OTHER needs the free text
    const result = patchResult({ resultType: target.resultType ?? null, resultTypeOther: target.resultTypeOther ?? null, businessType: target.businessType, defaultResult: target.defaultResult }, rest)
    if (typeof result === "string") return fail("VALIDATION_ERROR", 400, result, { fields: [{ field: "resultTypeOther", rule: result }] })
    const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "resultType" && k !== "resultTypeOther" && k !== "businessType"))
    Object.assign(target, plain, result ?? {})
    if (onboardingStep) target.onboarding = { ...target.onboarding, step: onboardingStep as 1 }
    if (typeof paused === "boolean") target.status = paused ? "PAUSED" : target.onboarding.completedAt ? "LIVE" : "SETUP"
    if (target.status === "SETUP") touchSetup(st)
    save()
    return ok(workspaceView(token))
  }),
  // fase2-agencia §3.3: idempotent; 422 without business type or an offer
  http.post(u("/workspace/onboarding/complete"), ({ request }) => {
    const token = request.headers.get("Authorization")
    const st = wsStateOf(token)
    const target = st ?? db.workspace
    if (!target.onboarding.completedAt) {
      const missing = [target.resultType ? null : "resultType", db.offers.length ? null : "offer"].filter(Boolean)
      if (missing.length) return fail("ONBOARDING_INCOMPLETE", 422, "Onboarding incomplete.", { missing })
      target.onboarding = { step: 6, totalSteps: 6, completedAt: new Date().toISOString() }
      if (target.status === "SETUP") target.status = "LIVE"
      touchSetup(st)
      save()
    }
    return ok(workspaceView(token))
  }),
  // fase2-agencia §3.1: every workspace of the user (example data); the active one carries the live db state
  http.get(u("/workspaces"), async ({ request }) => {
    await delay(200)
    const active = mockWorkspaceOf(request.headers.get("Authorization"))
    const refs = WORKSPACES.some((w) => w.id === active.id) ? WORKSPACES : [...WORKSPACES, active]
    const cards = refs.map((w) => {
      if (w.id === db.workspace.id) {
        const needs = db.creatives.map(toRow).filter(NEEDS_YOU).length
        return {
          id: w.id, name: db.workspace.name, shortCode: db.workspace.shortCode, role: w.role, isActive: w.id === active.id,
          status: db.workspace.status, onboarding: { ...db.workspace.onboarding, percent: onboardingSummaryOf(w.id).onboarding.percent }, industry: db.workspace.industry, businessType: db.workspace.businessType, resultType: db.workspace.resultType ?? null,
          websiteUrl: db.workspace.websiteUrl, waitingOnYou: { creatives: needs, batches: 0, total: needs }, updatedAt: new Date().toISOString(),
        }
      }
      const st = db.v2.ws[w.id] ?? newWs(w.id, w.name)
      const sum = onboardingSummaryOf(w.id)
      return {
        ...mockSetupCard({ ...w, name: st.name }, { businessType: st.businessType ?? undefined, resultType: st.resultType ?? undefined, industry: st.industry ?? undefined, websiteUrl: st.websiteUrl ?? undefined, shortCode: st.shortCode }, st.onboarding.step),
        status: st.status, onboarding: { ...st.onboarding, percent: sum.onboarding.percent }, isActive: w.id === active.id,
      }
    })
    const summary = {
      live: cards.filter((c) => c.status === "LIVE").length, setup: cards.filter((c) => c.status === "SETUP").length,
      paused: cards.filter((c) => c.status === "PAUSED").length, waitingTotal: cards.reduce((n, c) => n + c.waitingOnYou.total, 0),
    }
    return ok(cards, { summary, canCreate: active.role === "OWNER" || active.role === "ADMIN" })
  }),
  http.get(u("/workspace/members"), () => ok(db.members)),
  http.post(u("/workspace/invites"), async ({ request }) => {
    const b = await body<{ email: string; role: "ADMIN" | "MEMBER" }>(request)
    if (!/^\S+@\S+\.\S+$/.test(b.email ?? "")) return fail("VALIDATION_ERROR", 400, "Invalid email.", { fields: [{ field: "email", rule: "isEmail" }] })
    if (db.members.members.some((m) => m.email === b.email)) return fail("EMAIL_TAKEN", 409, "Already a member.")
    const id = `inv_${Math.random().toString(36).slice(2, 10)}`
    const expiresAt = new Date(Date.now() + 7 * 864e5).toISOString()
    db.members.invites.push({ id, email: b.email, role: b.role, expiresAt })
    save()
    return ok({ id, inviteUrl: `${location.origin}/invite/${id}`, expiresAt }, undefined, 201)
  }),
  http.delete(u("/workspace/invites/:id"), ({ params }) => {
    db.members.invites = db.members.invites.filter((i) => i.id !== params.id)
    save()
    return ok({ ok: true })
  }),
  http.patch(u("/workspace/members/:userId"), async ({ params, request }) => {
    const m = db.members.members.find((x) => x.userId === params.userId)
    if (!m) return notFound()
    const b = await body<{ role: "OWNER" | "ADMIN" | "MEMBER" }>(request)
    if (m.role === "OWNER" && b.role !== "OWNER" && db.members.members.filter((x) => x.role === "OWNER").length === 1) return fail("LAST_OWNER", 409, "The workspace needs an owner.")
    m.role = b.role
    save()
    return ok(m)
  }),
  http.get(u("/workspace/services"), () => ok(SERVICES)),
  http.get(u("/workspace/spend"), () => ok({ ...SPEND, spentUsd: +db.spentUsd.toFixed(2), capUsd: db.workspace.monthlySpendCapUsd })),

  // ───── feature 2 (api.md §18-20)
  ...variarHandlers,
  ...editorHandlers,
  // ───── variação automática (variacao-auto-v1 §5)
  ...iterateHandlers,
  // ───── meta-v1 + tour (onboarding-v2 §3.4)
  ...campaignHandlers,
  ...metaHandlers,
  ...brainHandlers, // brain-3d-v1
]
