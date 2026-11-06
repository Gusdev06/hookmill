import { delay, http, HttpResponse } from "msw"
import { API_URL } from "@/lib/api/client"
import type { BrandAsset, BrandAssetKind, BrandKit, CreateBrandAssetBody, CreateUploadBody, FileRef, UpdateBrandAssetBody } from "@/lib/api/types"
import { mockWorkspaceOf } from "./auth"
import { db, MOCK_VIDEO, mockArt, mockId } from "./db"
import { listScenario } from "./scenario"
import { blobUrl, f2, newUpload, save as saveF2, uploadTarget, type MUpload } from "./variar"

/*
 * Kit da marca v1 mock (docs/contratos/kit-marca-v1.md): GET /brand-kit, POST/PATCH/DELETE /brand-kit/assets and the
 * BRAND_LOGO | BRAND_FILE | BRAND_VIDEO purposes of the upload flow (called from handlers-variar). Stored in localStorage per
 * workspace; uploaded bytes live as object URLs until a reload (then a placeholder). CLIENT = 403 on writes
 * (also with ?mockrole=client). States: ?mock=empty | loading | error. File names with "mock-invalid" fail the check.
 */
const u = (p: string) => API_URL + p
const ok = <D,>(data: D, status = 200) => HttpResponse.json({ success: true, data }, { status })
const fail = (code: string, statusCode: number, message: string, details?: unknown) =>
  HttpResponse.json({ success: false, error: { code, message, statusCode, ...(details ? { details } : {}) } }, { status: statusCode })

const MB = 1024 * 1024
const RULES: Record<string, { kind: BrandAssetKind; mimes: string[]; maxBytes: number; max: number }> = {
  BRAND_LOGO: { kind: "LOGO", mimes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], maxBytes: 5 * MB, max: 1 },
  BRAND_FILE: { kind: "FILE", mimes: ["image/png", "image/jpeg", "image/webp", "application/pdf"], maxBytes: 25 * MB, max: 30 },
  BRAND_VIDEO: { kind: "DEMO_VIDEO", mimes: ["video/mp4", "video/quicktime"], maxBytes: 524_288_000, max: 5 },
}
const PURPOSE_OF: Record<BrandAssetKind, string> = { LOGO: "BRAND_LOGO", FILE: "BRAND_FILE", DEMO_VIDEO: "BRAND_VIDEO" }
export const isBrandPurpose = (p: unknown): p is "BRAND_LOGO" | "BRAND_FILE" | "BRAND_VIDEO" => typeof p === "string" && p in RULES

const roleOf = (req: Request) => {
  const forced = typeof window !== "undefined" ? sessionStorage.getItem("mock:role") : null
  return forced ?? mockWorkspaceOf(req.headers.get("Authorization")).role
}
const wsOf = (req: Request) => mockWorkspaceOf(req.headers.get("Authorization")).id

// ───────────── store ─────────────
interface MAsset extends Omit<BrandAsset, "file"> { file: FileRef; uploadId: string | null }
const KEY = "mock:brand-kit:v1"
let store: Record<string, MAsset[]> | null = null
function all(): Record<string, MAsset[]> {
  if (store) return store
  try {
    store = typeof window !== "undefined" ? (JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, MAsset[]> | null) : null
  } catch {
    store = null
  }
  return (store ??= {})
}
const persist = () => typeof window !== "undefined" && localStorage.setItem(KEY, JSON.stringify(all()))

const LOGO_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><circle cx="40" cy="40" r="22" fill="#7c5cff"/><circle cx="48" cy="34" r="14" fill="#f4f1ff"/><text x="74" y="50" font-family="Arial" font-weight="800" font-size="30" fill="#7c5cff">orbit</text></svg>`
  )
const PDF_URL = "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK"

/** The sample client starts with a kit; a new client (ws_new_*) and the other fixtures start empty. */
function assetsOf(ws: string): MAsset[] {
  const s = all()
  if (!s[ws]) {
    const t = Date.now() - 86_400_000
    const at = (i: number) => new Date(t + i * 60_000).toISOString()
    const offer = db.offers[0]?.id ?? null
    s[ws] =
      ws === "ws_1"
        ? [
            { id: "ba_logo", kind: "LOGO", label: null, file: { id: "f_ba_logo", url: LOGO_SVG, mimeType: "image/svg+xml", width: 240, height: 80 }, offerId: null, colors: ["#7C5CFF", "#F4F1FF"], createdAt: at(0), uploadId: null },
            { id: "ba_f1", kind: "FILE", label: "Product shot, front", file: mockArt(0, 1), offerId: null, colors: [], createdAt: at(1), uploadId: null },
            { id: "ba_f2", kind: "FILE", label: "App home screen", file: mockArt(2, 3), offerId: null, colors: [], createdAt: at(2), uploadId: null },
            { id: "ba_f3", kind: "FILE", label: "Brand guide 2026", file: { id: "f_ba_f3", url: PDF_URL, mimeType: "application/pdf" }, offerId: null, colors: [], createdAt: at(3), uploadId: null },
            { id: "ba_v1", kind: "DEMO_VIDEO", label: "App walkthrough", file: MOCK_VIDEO, offerId: offer, colors: [], createdAt: at(4), uploadId: null },
          ]
        : []
    persist()
  }
  return s[ws]
}

/** Fresh object URL while the page lives; after a reload the bytes are gone, so a placeholder of the same type. */
function view(a: MAsset): BrandAsset {
  const live = a.file.url.startsWith("data:") ? a.file.url : blobUrl(a.uploadId)
  const fallback = a.uploadId ? (a.file.mimeType.startsWith("video/") ? MOCK_VIDEO.url : a.file.mimeType === "application/pdf" ? PDF_URL : a.kind === "LOGO" ? LOGO_SVG : mockArt(1, 2).url) : a.file.url
  return { id: a.id, kind: a.kind, label: a.label, offerId: a.offerId, colors: a.colors, createdAt: a.createdAt, file: { ...a.file, url: live ?? fallback } }
}
export function kitOf(ws: string): BrandKit {
  const list = assetsOf(ws).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const logo = list.find((a) => a.kind === "LOGO")
  return { logo: logo ? view(logo) : null, files: list.filter((a) => a.kind === "FILE").map(view), demoVideos: list.filter((a) => a.kind === "DEMO_VIDEO").map(view) }
}

// ───────────── upload flow (called from handlers-variar) ─────────────
export async function brandUploadCreate(req: Request, b: CreateUploadBody) {
  if (roleOf(req) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't upload.")
  const r = RULES[b.purpose]
  if (!b.filename || !Number.isFinite(b.sizeBytes)) return fail("VALIDATION_ERROR", 400, "Invalid input.", { fields: [{ field: "filename", rule: "isNotEmpty" }] })
  if (!r.mimes.includes(b.mimeType)) return fail("MEDIA_INVALID", 422, "This file type isn't accepted.", { reason: "mime" })
  if (b.sizeBytes > r.maxBytes) return fail("MEDIA_TOO_LARGE", 422, "The file is too large.", { maxBytes: r.maxBytes })
  await delay(150)
  return ok(uploadTarget(newUpload(b)), 201)
}

/** Image size and up to 5 dominant colors (#RRGGBB) from the bytes, the stand-in for the API's palette measurement. */
function measureImage(url: string | null): Promise<{ width: number; height: number; colors: string[] } | null> {
  if (!url || typeof document === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const t = setTimeout(() => resolve(null), 3000)
    img.onload = () => {
      clearTimeout(t)
      const width = img.naturalWidth || 240
      const height = img.naturalHeight || 240
      const colors: string[] = []
      try {
        const c = document.createElement("canvas")
        c.width = c.height = 32
        const ctx = c.getContext("2d")!
        ctx.drawImage(img, 0, 0, 32, 32)
        const px = ctx.getImageData(0, 0, 32, 32).data
        const count = new Map<string, number>()
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue
          const q = (v: number) => Math.min(255, Math.round(v / 32) * 32)
          const hex = "#" + [q(px[i]), q(px[i + 1]), q(px[i + 2])].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
          count.set(hex, (count.get(hex) ?? 0) + 1)
        }
        const bw = (h: string) => h === "#FFFFFF" || h === "#000000"
        colors.push(...[...count.entries()].sort((a, b) => Number(bw(a[0])) - Number(bw(b[0])) || b[1] - a[1]).slice(0, 5).map(([h]) => h))
      } catch {}
      resolve({ width, height, colors })
    }
    img.onerror = () => {
      clearTimeout(t)
      resolve(null)
    }
    img.src = url
  })
}
function measureVideo(url: string | null): Promise<{ durationSec: number; width: number; height: number } | null> {
  if (!url || typeof document === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const v = document.createElement("video")
    const t = setTimeout(() => resolve(null), 3000)
    v.preload = "metadata"
    v.muted = true
    v.onloadedmetadata = () => {
      clearTimeout(t)
      resolve(Number.isFinite(v.duration) ? { durationSec: Math.round(v.duration * 100) / 100, width: v.videoWidth, height: v.videoHeight } : null)
    }
    v.onerror = () => {
      clearTimeout(t)
      resolve(null)
    }
    v.src = url
  })
}

const colorsByUpload = new Map<string, string[]>()
const dataUrls = new Map<string, string | null>()
const toDataUrl = (url: string) =>
  fetch(url)
    .then((r) => r.blob())
    .then((b) => new Promise<string | null>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(b) }))
    .catch(() => null)

export async function brandUploadComplete(up: MUpload) {
  const failed = (code: string, msg: string, details: unknown) => {
    up.status = "FAILED"
    saveF2()
    return fail(code, 422, msg, details)
  }
  await delay(400)
  if (up.filename.includes("mock-invalid")) return failed("MEDIA_INVALID", "The file can't be read.", { reason: "undecodable" })
  const url = blobUrl(up.id)
  if (up.mimeType.startsWith("video/")) {
    const m = await measureVideo(url)
    const durationSec = up.filename.includes("mock-short") ? 0.5 : up.filename.includes("mock-long") ? 720 : m?.durationSec ?? 24
    if (durationSec < 1) return failed("MEDIA_TOO_SHORT", "The video is too short.", { durationSec, minSec: 1 })
    if (durationSec > 600) return failed("MEDIA_TOO_LONG", "The video is too long.", { durationSec, maxSec: 600 })
    const width = m?.width || 1080
    const height = m?.height || 1920
    if (Math.min(width, height) < 240) return failed("MEDIA_INVALID", "The video is too small.", { reason: "too_small" })
    Object.assign(up, { durationSec, width, height })
  } else if (up.mimeType.startsWith("image/")) {
    const m = await measureImage(url)
    Object.assign(up, { width: m?.width ?? null, height: m?.height ?? null })
    if (up.purpose === "BRAND_LOGO") colorsByUpload.set(up.id, m?.colors ?? [])
    // small images survive a reload as a data URL (bigger ones fall back to a placeholder)
    if (url && up.sizeBytes <= 400_000) dataUrls.set(up.id, await toDataUrl(url))
  }
  up.status = "READY"
  saveF2()
  return ok({ uploadId: up.id, status: "READY", file: fileOf(up), warnings: [], analysisEstimateUsd: 0 })
}

function fileOf(up: MUpload): FileRef {
  return {
    id: `f_${up.id}`, url: dataUrls.get(up.id) ?? blobUrl(up.id) ?? "", mimeType: up.mimeType,
    ...(up.width ? { width: up.width } : {}), ...(up.height ? { height: up.height } : {}), ...(up.durationSec ? { durationSec: up.durationSec } : {}),
  }
}

// ───────────── routes ─────────────
export const brandKitHandlers = [
  http.get(u("/brand-kit"), async ({ request }) => {
    const s = await listScenario(request.url)
    if (s === "error") return fail("INTERNAL_ERROR", 500, "Something went wrong.")
    if (s === "empty") return ok<BrandKit>({ logo: null, files: [], demoVideos: [] })
    return ok(kitOf(wsOf(request)))
  }),

  http.post(u("/brand-kit/assets"), async ({ request }) => {
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't edit the brand kit.")
    const b = (await request.json().catch(() => ({}))) as CreateBrandAssetBody
    if (!(b.kind in PURPOSE_OF)) return fail("VALIDATION_ERROR", 400, "Invalid input.", { fields: [{ field: "kind", rule: "isEnum" }] })
    const up = f2.uploads.find((x) => x.id === b.uploadId)
    if (!up) return fail("NOT_FOUND", 404, "Upload not found.")
    if ((up.purpose ?? "CHAMPION_VIDEO") !== PURPOSE_OF[b.kind]) return fail("MEDIA_INVALID", 422, "This upload is for something else.", { reason: "purpose" })
    if (up.status !== "READY") return fail("UPLOAD_INCOMPLETE", 409, "The upload isn't complete.", { expectedBytes: up.sizeBytes, actualBytes: null })
    if (b.offerId && !db.offers.some((o) => o.id === b.offerId)) return fail("NOT_FOUND", 404, "Offer not found.")
    const ws = wsOf(request)
    const list = assetsOf(ws)
    const same = list.find((a) => a.uploadId === up.id)
    if (same) return ok(view(same), 201)
    const max = RULES[PURPOSE_OF[b.kind]].max
    if (b.kind !== "LOGO" && list.filter((a) => a.kind === b.kind).length >= max) return fail("INVALID_STATE", 409, "The brand kit is full.", { reason: "brand_kit_full", kind: b.kind, max })
    await delay(200)
    const asset: MAsset = {
      id: mockId("ba"), kind: b.kind, label: b.label?.trim().slice(0, 80) || null, file: fileOf(up), offerId: b.offerId ?? null,
      colors: b.kind === "LOGO" ? colorsByUpload.get(up.id) ?? [] : [], createdAt: new Date().toISOString(), uploadId: up.id,
    }
    all()[ws] = [...list.filter((a) => b.kind !== "LOGO" || a.kind !== "LOGO"), asset]
    persist()
    return ok(view(asset), 201)
  }),

  http.patch(u("/brand-kit/assets/:id"), async ({ request, params }) => {
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't edit the brand kit.")
    const a = assetsOf(wsOf(request)).find((x) => x.id === params.id)
    if (!a) return fail("NOT_FOUND", 404, "Not found.")
    const b = (await request.json().catch(() => ({}))) as UpdateBrandAssetBody
    if (typeof b.label === "string" && b.label.trim().length > 80) return fail("VALIDATION_ERROR", 400, "Invalid input.", { fields: [{ field: "label", rule: "maxLength" }] })
    if (b.offerId && !db.offers.some((o) => o.id === b.offerId)) return fail("NOT_FOUND", 404, "Offer not found.")
    if (b.label !== undefined) a.label = b.label?.trim() || null
    if (b.offerId !== undefined) a.offerId = b.offerId
    persist()
    await delay(150)
    return ok(view(a))
  }),

  http.delete(u("/brand-kit/assets/:id"), async ({ request, params }) => {
    if (roleOf(request) === "CLIENT") return fail("FORBIDDEN", 403, "Clients can't edit the brand kit.")
    const ws = wsOf(request)
    const list = assetsOf(ws)
    if (!list.some((x) => x.id === params.id)) return fail("NOT_FOUND", 404, "Not found.")
    all()[ws] = list.filter((x) => x.id !== params.id)
    persist()
    await delay(150)
    return ok({ ok: true as const })
  }),
]
