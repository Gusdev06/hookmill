import { http, HttpResponse } from "msw"
import { normalizarDocV3, validarDocHeadline, validarDocMoldura, type MolduraProps, type RemixKeepProps } from "@maquina/video/player"
import { API_URL } from "@/lib/api/client"
import type { EditDocV3, ExportEditorBody, LibraryItem, PutEditorBodyV3 } from "@/lib/api/types"
import { ME } from "./fixtures"
import { db, save as saveDb } from "./db"
import { it, pieceView } from "./iterate"
import { DEMO_PIECES, advance, build, clearFlag, editableType, entryOf, exportView, flag, issuesOf, putEntry, stateOf, type MockPieceRef } from "./editor-universal"

/**
 * MSW of the editor universal v1 for AUTO pieces (editor-universal-v1 §7, F-U1). Registered BEFORE the v1 editor handlers:
 * a creative that is not an AUTO piece falls through (resolver returns nothing) to the scratch editor mock.
 */
const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })
const TORDAN = { ...ME, id: "usr_tordan", name: "Tordan", initials: "TO" }

/** The AUTO piece behind a creative id: the demo pieces or a piece of a mock batch (FRAME/HEADLINE ready). */
function pieceOf(cid: string): (MockPieceRef & { ready: boolean }) | null {
  const d = DEMO_PIECES.find((x) => x.creativeId === cid)
  if (d) return { ...d, ready: true }
  for (const b of it.batches) {
    const p = b.pieces.find((x) => x.creativeId === cid)
    if (p) return { creativeId: cid, type: p.type, frame: p.frame ?? null, batchId: b.id, pieceId: p.id, code: pieceView(b, p).code.replace(/-ED$/, ""), name: p.type, ready: p.inLibrary }
  }
  return null
}
const markLibrary = (cid: string) => {
  const item = (db.library as LibraryItem[]).find((l) => l.id === cid)
  if (item && !item.editedInEditor) {
    item.editedInEditor = true
    saveDb()
  }
}
const notEditable = (type: string) => fail("EDIT_NOT_SUPPORTED", 422, "This kind of piece doesn't open in the editor yet.", { reason: editableType(type) ? "piece_not_ready" : "auto_type_not_editable" })

export const editorUniversalHandlers = [
  http.get(u("/creatives/:id/editor"), ({ params }) => {
    const cid = String(params.id)
    const r = pieceOf(cid)
    if (!r) return
    if (!editableType(r.type)) return notEditable(r.type)
    if (!r.ready) return fail("INVALID_STATE", 409, "The 9:16 is not ready yet.", { reason: "piece_not_ready" })
    const e = advance(cid, () => markLibrary(cid))
    if (e.openedAt === null) {
      e.openedAt = Date.now()
      putEntry(cid, e)
    }
    return ok(stateOf(r, e))
  }),

  http.put(u("/creatives/:id/editor"), async ({ params, request }) => {
    const cid = String(params.id)
    const r = pieceOf(cid)
    if (!r) return
    if (!editableType(r.type) || !r.ready) return notEditable(r.type)
    if (cid === "cr_ed_approved") return fail("INVALID_STATE", 409, "This piece is published: read-only.", { reason: "read_only" })
    const body = (await request.json()) as PutEditorBodyV3
    const e = advance(cid, () => markLibrary(cid))
    if (e.job) return fail("INVALID_STATE", 409, "An export is running.", { reason: "export_running" })
    if (flag("conflict")) {
      clearFlag("conflict")
      const at = new Date(Date.now() - 10_000).toISOString()
      putEntry(cid, { ...e, revision: e.revision + 1, savedAt: at, savedBy: TORDAN })
      return fail("EDIT_CONFLICT", 409, "Someone saved a newer version.", { revision: e.revision + 1, savedBy: TORDAN, savedAt: at })
    }
    if (body.baseRevision !== e.revision) return fail("EDIT_CONFLICT", 409, "Someone saved a newer version.", { revision: e.revision, savedBy: e.savedBy, savedAt: e.savedAt })
    const b = build(r)
    const base = b.bases.find((x) => x.format === b.manifest.formats[0])!.base!
    const errs = b.key === "headline"
      ? validarDocHeadline(body.doc as never, base as RemixKeepProps, { manifest: b.manifest as never })
      : validarDocMoldura(body.doc as never, base as MolduraProps, { manifest: b.manifest as never })
    if (errs.length) return fail("VALIDATION_ERROR", 400, "The edit breaks a rule.", { fields: errs })
    const doc = normalizarDocV3(body.doc as never, base, b.manifest as never) as unknown as EditDocV3 | null
    const savedAt = new Date().toISOString()
    putEntry(cid, { ...e, doc, revision: e.revision + 1, savedAt, savedBy: ME, failed: null })
    return ok({ revision: e.revision + 1, doc, settings: null, issues: issuesOf(b, doc), dirty: true, savedAt })
  }),

  http.post(u("/creatives/:id/editor/export"), async ({ params, request }) => {
    const cid = String(params.id)
    const r = pieceOf(cid)
    if (!r) return
    if (!editableType(r.type) || !r.ready) return notEditable(r.type)
    const { revision } = (await request.json()) as ExportEditorBody
    const e = advance(cid, () => markLibrary(cid))
    if (e.job) return fail("INVALID_STATE", 409, "An export is running.", { reason: "export_running" })
    if (revision !== e.revision) return fail("EDIT_CONFLICT", 409, "Someone saved a newer version.", { revision: e.revision, savedBy: e.savedBy, savedAt: e.savedAt })
    if (e.exported?.revision === revision || (!e.doc && !e.exported)) return fail("INVALID_STATE", 409, "Nothing to export.", { reason: "nothing_to_export" })
    const issues = issuesOf(build(r), e.doc).filter((i) => i.level === "block" || i.level === "confirm")
    if (issues.length) return fail("EDIT_BLOCKED", 422, "Fix the checks first.", { issues })
    const fails = flag("fail")
    if (fails) clearFlag("fail")
    const next = { ...e, failed: null, job: { renderId: `rn_${Date.now().toString(36)}`, revision, startAt: Date.now(), fail: fails, recheck: false } }
    putEntry(cid, next)
    return ok(exportView(next), 202)
  }),

  http.post(u("/creatives/:id/editor/export/recheck"), ({ params }) => {
    const cid = String(params.id)
    const r = pieceOf(cid)
    if (!r) return
    const e = entryOf(cid)
    if (!e.failed?.error?.canRecheck) return fail("INVALID_STATE", 409, "The last export didn't fail a check.", { reason: "cannot_recheck" })
    const next = { ...e, job: { renderId: e.failed.renderId, revision: e.failed.revision, startAt: Date.now(), fail: false, recheck: true }, failed: null }
    putEntry(cid, next)
    return ok(exportView(next), 202)
  }),
]
