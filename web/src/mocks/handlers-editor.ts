import { http, HttpResponse } from "msw"
import { FONT_CATALOG, normalizarDoc, resolverProps, layoutPadrao, framesDasCenas, validarDoc, type EditDoc as VideoEditDoc, type FontId } from "@maquina/video/player"
import fixtures from "@maquina/video/scripts/editor-f1/player-fixtures.json"
import { API_URL } from "@/lib/api/client"
import type { EditDoc, EditorState, EditSettings, PutEditorBody, ScratchSource, UserRef } from "@/lib/api/types"
import { ME } from "./fixtures"
import { advance, db, emit, latestRender, setState, strip, touch, type MCreative } from "./db"

/**
 * Mock of the editor API (docs/contratos/editor-v1.md §5) until F2a answers on :3001.
 * Source = the F1 fixtures (video/public/fixtures/cena-N.mp4, served by /fixtures in dev) with their real word timings.
 * The doc/revision live in localStorage (shared by tabs) so two tabs really conflict (EDIT_CONFLICT).
 */
const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })

type Store = Record<string, { doc: EditDoc | null; revision: number; savedAt: string; savedBy: UserRef }>
const KEY = "mock:editor"
const read = (): Store => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store
  } catch {
    return {}
  }
}
const write = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s))
export function editorEntry(cid: string) {
  return read()[cid] ?? { doc: null, revision: 0, savedAt: new Date(0).toISOString(), savedBy: ME }
}

/** contract §3.2: PATCH templateId drops every transform (repositions); captionPosition drops the caption's. */
export function reposition(cid: string, what: { template: boolean; caption: boolean }) {
  if (!what.template && !what.caption) return
  const store = read()
  const e = store[cid]
  if (!e?.doc) return
  const layers = e.doc.layers
    .map((l) => (what.template || l.id === "caption" ? (({ transform, ...rest }) => (void transform, rest))(l) : l))
    .filter((l) => Object.keys(l).length > 1)
  store[cid] = { ...e, doc: { ...e.doc, layers }, revision: e.revision + 1, savedAt: new Date().toISOString() }
  write(store)
}

const FX = (fixtures as unknown as { base: { scenes: { clipUrl: string; durationSec: number; words: { word: string; startSec: number; endSec: number }[] }[] } }).base.scenes
// = api/src/edicao/editor-doc.ts EDITABLE; GET also needs every current scene READY (else 409)
const EDITABLE = ["SCENES_GENERATING", "SCENES_FAILED", "EDIT_PENDING", "RENDERING", "RENDER_FAILED", "RENDER_READY"]
const REMIX = "remix-keep"
const remixLocked = () => fail("EDIT_NOT_SUPPORTED", 422, "Editing this variation on the video comes in F3.", { reason: "remix_editor_not_enabled" })
/** = EditResponse.editorAvailable of the API (edicao.service.ts). */
export function editorAvailable(c: MCreative) {
  return !!c.editSettings && c.editSettings.templateId !== REMIX && EDITABLE.includes(c.state) && c.scenes.length > 0 && c.scenes.every((s) => s.status === "READY")
}

function sourceOf(c: MCreative): ScratchSource {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const ready = c.scenes.filter((s) => s.status === "READY").sort((a, b) => a.index - b.index)
  return {
    format: c.format, fps: 30, language: "en",
    scenes: ready.map((s, i) => {
      const f = FX[i % FX.length]
      return {
        sceneId: s.id, index: s.index, label: s.label, attempt: s.attempt, durationSec: f.durationSec, clipStartSec: 0,
        clip: { id: `fx_${i}`, url: `${origin}/${f.clipUrl}`, mimeType: "video/mp4" }, thumbnail: s.thumbnail, words: f.words,
      }
    }),
  }
}

function stateOf(c: MCreative): EditorState {
  const e = editorEntry(c.id)
  const src = sourceOf(c)
  const settings = c.editSettings as EditSettings
  const tpl = settings.templateId as "clean" | "bold" | "headline"
  const cenasSec = framesDasCenas(resolverProps(src, settings, e.doc).scenes, 30) / 30
  const def = layoutPadrao(tpl, src.format, settings, cenasSec)
  const latest = latestRender(c)
  const preview = [...c.renders].reverse().find((r) => r.status === "READY" && !r.stale) ?? null
  return {
    revision: e.revision, base: "scratch", composition: "Criativo", settings, doc: e.doc, source: src,
    urlsExpireAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
    layers: (["hook", "caption", "cta"] as const).map((id) => ({
      id, role: id, labelKey: `editor.layer.${id}`,
      defaults: { transform: def[id].transform, timing: def[id].timing, style: def[id].style, text: def[id].text },
      editable: { move: true, text: id !== "caption", style: true, timing: true, hide: true }, lockedReason: null, leavesEmptyCover: false,
    })),
    capabilities: { trimScenes: true, reorderScenes: true, trimVideo: false, fixCaptionWords: true, locked: [] },
    fonts: (Object.keys(FONT_CATALOG) as FontId[]).map((id) => ({ id, label: FONT_CATALOG[id].label })),
    dirty: c.editDirty, latestRender: latest && !latest.stale ? strip(latest) : null, previewRender: preview ? strip(preview) : null,
    editedInEditor: !!preview?.doc,
  }
}

export const editorHandlers = [
  http.get(u("/creatives/:id/editor"), ({ params }) => {
    const c = db.creatives.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Not found.")
    advance(c)
    if (c.editSettings?.templateId === REMIX) return remixLocked()
    if (!c.editSettings || !editorAvailable(c)) return fail("INVALID_STATE", 409, "No ready scenes to edit.", { state: c.state, allowed: ["EDIT_PENDING", "RENDER_FAILED", "RENDER_READY"] })
    return ok(stateOf(c))
  }),
  http.put(u("/creatives/:id/editor"), async ({ params, request }) => {
    const c = db.creatives.find((x) => x.id === params.id)
    if (!c) return fail("NOT_FOUND", 404, "Not found.")
    if (c.editSettings?.templateId === REMIX) return remixLocked()
    if (!c.editSettings || !editorAvailable(c)) return fail("INVALID_STATE", 409, "Not allowed in the current state.", { state: c.state, allowed: EDITABLE })
    const b = (await request.json()) as PutEditorBody
    const store = read()
    const e = store[c.id] ?? editorEntry(c.id)
    if (b.baseRevision !== e.revision) return fail("EDIT_CONFLICT", 409, "Someone saved a newer version.", { revision: e.revision, savedBy: e.savedBy, savedAt: e.savedAt })
    // = API: semantic rules of §5.4 (validarDoc) answer 400 VALIDATION_ERROR { fields: [{ field, rule }] }, nothing saved
    const src = sourceOf(c)
    const erros = validarDoc(b.doc as VideoEditDoc | null, src)
    if (erros.length) return fail("VALIDATION_ERROR", 400, "The edit breaks a rule.", { fields: erros })
    if (b.settings) Object.assign(c.editSettings, b.settings)
    const doc = normalizarDoc(b.doc, src, c.editSettings) as EditDoc | null
    const next = { doc, revision: e.revision + 1, savedAt: new Date().toISOString(), savedBy: ME }
    store[c.id] = next
    write(store)
    c.editDirty = true
    if (c.state === "RENDER_READY") setState(c, "EDIT_PENDING")
    touch(c)
    emit(c.id, { event: "editor.updated", data: { revision: next.revision, savedBy: next.savedBy, savedAt: next.savedAt } })
    return ok({ revision: next.revision, doc, settings: c.editSettings, dirty: true as const })
  }),
]
