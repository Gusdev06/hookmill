/**
 * MSW handlers for the automatic variation (variacao-auto-v1.md §5). State and clock live in ./iterate.ts.
 */
import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type { CreateIterateBody, LibraryItemV, RetryPieceBody, StartIterateBody, UpdatePieceBody } from "@/lib/api/types"
import { db } from "./db"
import { f2 } from "./variar"
import { listScenario, scenario } from "./scenario"
import { advanceIter, findPiece, iterConfig, iterView, it, launchIter, newIter, pieceView, retryIter, retryPiece, saveIter, startZip } from "./iterate"

const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const notFound = () => fail("NOT_FOUND", 404, "Not found.")
const invalid = (state: string, allowed: string[], reason?: string) =>
  fail("INVALID_STATE", 409, "Not allowed in the current state.", { state, allowed, ...(reason ? { reason } : {}) })
const body = async <T,>(r: Request) => ((await r.json().catch(() => ({}))) as T)

function batch(id: unknown) {
  const b = it.batches.find((x) => x.id === id && !x.archived)
  return b ? advanceIter(b) : null
}

export const iterateHandlers = [
  http.get(u("/iterate/config"), async ({ request }) => {
    const s = await listScenario(request.url)
    return ok(iterConfig(s === "empty"))
  }),

  http.post(u("/iterate"), async ({ request }) => {
    const b = await body<CreateIterateBody>(request)
    if (!!b.uploadId === !!b.creativeId) return fail("VALIDATION_ERROR", 400, "Send exactly one of uploadId / creativeId.", { fields: [{ field: "uploadId", rule: "exactly_one" }] })
    await delay(300)
    if (b.creativeId) {
      const lib = (db.library as LibraryItemV[]).find((l) => l.id === b.creativeId)
      if (!lib) return notFound()
      if (lib.media === "image") return invalid("APPROVED", [], "not_a_video")
      const nb = newIter({ offerId: lib.offer.id, uploadId: null, sourceCreativeId: lib.id, name: lib.name, durationSec: lib.durationSec || 30, width: 1080, height: 1920, filename: "" })
      return ok(iterView(nb), 202)
    }
    const up = f2.uploads.find((x) => x.id === b.uploadId)
    if (!up) return notFound()
    if (up.status !== "READY") return fail("UPLOAD_INCOMPLETE", 409, "The upload isn't complete.", { expectedBytes: up.sizeBytes, actualBytes: null })
    const offers = db.offers
    if (!b.offerId && offers.length !== 1) return fail("OFFER_REQUIRED", 422, "Pick the offer this video is from.", { offers: offers.map((o) => ({ id: o.id, name: o.name })) })
    const offerId = b.offerId ?? offers[0].id
    if (!offers.some((o) => o.id === offerId)) return notFound()
    const nb = newIter({
      offerId, uploadId: up.id, sourceCreativeId: null, name: up.filename.replace(/\.[^.]+$/, ""), durationSec: up.durationSec ?? 30,
      width: up.width ?? 1080, height: up.height ?? 1920, filename: up.filename,
    })
    return ok(iterView(nb), 202)
  }),

  http.get(u("/iterate/:id"), async ({ params }) => {
    if (scenario() === "loading") await delay("infinite")
    const b = batch(params.id)
    if (!b) return notFound()
    return ok(iterView(b))
  }),

  http.post(u("/iterate/:id/retry"), async ({ params }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const v = iterView(b)
    if (v.status !== "ANALYSIS_FAILED") return invalid(v.status, ["ANALYSIS_FAILED"])
    if (v.error?.action === "upload_another") return invalid(v.status, [], "upload_another")
    retryIter(b)
    await delay(200)
    return ok(iterView(b), 202)
  }),

  http.post(u("/iterate/:id/start"), async ({ params, request }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const v = iterView(b)
    if (v.status !== "PLAN_READY") return invalid(v.status, ["PLAN_READY"])
    const { expectedPieces } = await body<StartIterateBody>(request)
    if (expectedPieces !== b.pieces.length) return fail("PLAN_CHANGED", 409, "The plan changed.", { pieces: b.pieces.length })
    launchIter(b)
    await delay(250)
    return ok(iterView(b), 202)
  }),

  http.post(u("/iterate/pieces/:pieceId/retry"), async ({ params, request }) => {
    const f = findPiece(String(params.pieceId))
    if (!f) return notFound()
    const v = pieceView(f.b, f.p)
    if (v.status !== "failed" && v.status !== "left_out") return invalid(v.status, ["failed", "left_out"])
    await body<RetryPieceBody>(request)
    retryPiece(f.b, f.p)
    return ok(pieceView(f.b, f.p), 202)
  }),

  http.post(u("/iterate/pieces/:pieceId/leave-out"), ({ params }) => {
    const f = findPiece(String(params.pieceId))
    if (!f) return notFound()
    const v = pieceView(f.b, f.p)
    if (v.status !== "failed") return invalid(v.status, ["failed"])
    f.p.leftOutAt = Date.now()
    f.p.inZip = false
    saveIter()
    return ok(pieceView(f.b, f.p))
  }),

  http.patch(u("/iterate/pieces/:pieceId"), async ({ params, request }) => {
    const f = findPiece(String(params.pieceId))
    if (!f) return notFound()
    const b = await body<UpdatePieceBody>(request)
    if (typeof b.inZip !== "boolean") return fail("VALIDATION_ERROR", 400, "inZip must be a boolean.", { fields: [{ field: "inZip", rule: "isBoolean" }] })
    const v = pieceView(f.b, f.p)
    if (v.status !== "ready") return invalid(v.status, ["ready"])
    f.p.inZip = b.inZip
    saveIter()
    await delay(120)
    return ok(pieceView(f.b, f.p))
  }),

  http.post(u("/iterate/:id/zip"), async ({ params }) => {
    const b = batch(params.id)
    if (!b) return notFound()
    const v = iterView(b)
    if (v.status !== "LAUNCHED") return invalid(v.status, ["LAUNCHED"])
    if (!v.pieces.some((p) => p.status === "ready" && p.inZip)) return invalid(v.status, [], "nothing_to_zip")
    startZip(b)
    await delay(200)
    const after = iterView(advanceIter(b))
    return ok({ zip: after.zip }, after.zip.status === "ready" ? 200 : 202)
  }),
]
