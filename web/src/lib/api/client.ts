"use client"

import { ApiError } from "./errors"
import type * as T from "./types"
import { getAccessToken, refreshSession } from "@/lib/session/token"

/**
 * Typed HTTP client for the HookMill API (docs/contratos/api.md).
 * This is the ONLY place that builds API URLs. Screens call `api.<area>.<action>()`.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1").replace(/\/$/, "")
const DEFAULT_TIMEOUT_MS = 10_000 // spec §5 Home error: "didn't answer in 10 seconds"

type Query = { [k: string]: string | number | boolean | null | undefined } | object

interface RequestOptions {
  query?: Query
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  auth?: boolean
}

export interface ApiResult<D, M = undefined> {
  data: D
  meta: M
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(API_URL + path)
  if (query) {
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

const seg = (v: string | number) => encodeURIComponent(String(v))

async function send<D, M = undefined>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<ApiResult<D, M>> {
  const { query, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, auth = true } = opts
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (auth) {
    const token = await getAccessToken()
    if (!token) throw new ApiError("http", "UNAUTHORIZED", 401, "Not signed in.")
    headers.Authorization = `Bearer ${token}`
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let res: Response
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
      cache: "no-store",
    })
  } catch (e) {
    if (timeout.aborted) throw new ApiError("timeout", "TIMEOUT", 0, `No answer in ${timeoutMs / 1000} s.`)
    if (signal?.aborted) throw e
    throw new ApiError("network", "NETWORK", 0, "Network error.")
  }

  if (res.status === 401 && auth && !retried) {
    const s = await refreshSession()
    if (s) return send<D, M>(method, path, opts, true)
  }

  let json: T.SuccessEnvelope<D, M> | T.ErrorEnvelope | null = null
  try {
    json = (await res.json()) as T.SuccessEnvelope<D, M> | T.ErrorEnvelope
  } catch {
    json = null
  }

  if (!res.ok || !json || json.success === false) {
    const err = json && json.success === false ? json.error : null
    throw new ApiError("http", err?.code ?? "INTERNAL_ERROR", res.status, err?.message ?? res.statusText, err?.details as Record<string, unknown> | undefined)
  }
  return { data: json.data, meta: json.meta as M }
}

const get = <D, M = undefined>(p: string, o?: RequestOptions) => send<D, M>("GET", p, o)
const post = <D, M = undefined>(p: string, body?: unknown, o?: RequestOptions) => send<D, M>("POST", p, { ...o, body: body ?? {} })
const patch = <D>(p: string, body: unknown, o?: RequestOptions) => send<D>("PATCH", p, { ...o, body })
const put = <D>(p: string, body: unknown, o?: RequestOptions) => send<D>("PUT", p, { ...o, body })
const del = <D>(p: string, o?: RequestOptions) => send<D>("DELETE", p, o)
const data = <D, M>(r: Promise<ApiResult<D, M>>) => r.then((x) => x.data)

/**
 * Feature 2 upload (api.md §18): PUT the raw file exactly as `POST /uploads` said (method/url/headers), with progress.
 * XHR, not fetch, because fetch has no upload progress. No timeout (200 MB on a phone can take minutes); cancel with `signal`.
 * The Bearer token goes only when the URL is our own API (`UPLOAD_MODE=proxy`); a pre-signed storage URL must not get it.
 */
function sendUpload(target: T.CreateUploadResponse, file: Blob, opts: UploadOptions = {}, retried = false): Promise<void> {
  const { onProgress, signal } = opts
  const ownApi = target.url.startsWith(API_URL)
  return (async () => {
    const token = ownApi ? await getAccessToken() : null
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Upload cancelled.", "AbortError"))
      const xhr = new XMLHttpRequest()
      xhr.open(target.method, target.url)
      for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v)
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size)
      const onAbort = () => xhr.abort()
      signal?.addEventListener("abort", onAbort, { once: true })
      const done = () => signal?.removeEventListener("abort", onAbort)
      xhr.onabort = () => { done(); reject(new DOMException("Upload cancelled.", "AbortError")) }
      xhr.onerror = () => { done(); reject(new ApiError("network", "NETWORK", 0, "Network error.")) }
      xhr.onload = () => {
        done()
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(file.size, file.size)
          return resolve()
        }
        let err: T.ErrorEnvelope["error"] | null = null
        try {
          const j = JSON.parse(xhr.responseText) as T.ErrorEnvelope
          if (j && j.success === false) err = j.error
        } catch {}
        const fallback = xhr.status === 410 ? "UPLOAD_EXPIRED" : xhr.status === 413 ? "UPLOAD_INCOMPLETE" : xhr.status === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR"
        reject(new ApiError("http", err?.code ?? fallback, xhr.status, err?.message ?? xhr.statusText, err?.details as Record<string, unknown> | undefined))
      }
      xhr.send(file)
    })
  })().catch(async (e) => {
    if (ownApi && !retried && e instanceof ApiError && e.status === 401 && (await refreshSession())) return sendUpload(target, file, opts, true)
    throw e
  })
}

export interface UploadOptions {
  /** bytes sent / total bytes */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

type Ok = { ok: true }
type Signal = { signal?: AbortSignal }
type PageQuery = { limit?: number; cursor?: string | null }

export const api = {
  auth: {
    me: () => data(get<T.MeResponse>("/auth/me")),
    updateMe: (b: { name?: string; uiLocale?: T.UiLocale; password?: { current: string; next: string } }) =>
      data(patch<T.AuthUser>("/auth/me", b)),
    switchWorkspace: (workspaceId: string) => data(post<T.AuthSession>("/auth/switch-workspace", { workspaceId })),
    invite: (token: string) => data(get<T.InviteInfo>(`/auth/invites/${seg(token)}`, { auth: false })),
    acceptInvite: (token: string, b: { name?: string; password?: string }) =>
      data(post<T.AuthSession>(`/auth/invites/${seg(token)}/accept`, b, { auth: false })),
  },

  creatives: {
    list: (q: Omit<T.ListCreativesQuery, "cursor"> & PageQuery = {}, o: Signal = {}) =>
      get<T.CreativeRow[], T.CreativesMeta>("/creatives", { query: q, ...o }),
    get: (id: string) => data(get<T.CreativeDetail>(`/creatives/${seg(id)}`)),
    create: (b: { offerId: string; name?: string; scriptCount?: number }) => data(post<T.CreativeDetail>("/creatives", b)),
    rename: (id: string, name: string) => data(patch<T.CreativeDetail>(`/creatives/${seg(id)}`, { name })),
    remove: (id: string) => data(del<Ok>(`/creatives/${seg(id)}`)),
    /** SSE endpoint URL; opened with fetch + Bearer (eventos.md §1), not EventSource. */
    eventsUrl: (id: string) => buildUrl(`/creatives/${seg(id)}/events`),
  },

  offers: {
    list: (q: PageQuery = {}) => get<T.Offer[], T.PageMeta>("/offers", { query: q }),
    get: (id: string) => data(get<T.Offer>(`/offers/${seg(id)}`)),
    extract: (b: { url: string } | { pageText: string; url?: string }) => data(post<T.Job>("/offers/extract", b)),
    create: (b: { name: string; language: string; sourceUrl?: string | null; fieldSources?: T.Offer["fieldSources"] } & Partial<T.OfferBrief>) =>
      data(post<T.Offer>("/offers", b)),
    update: (id: string, b: Partial<Pick<T.Offer, "name" | "language" | "sourceUrl"> & T.OfferBrief>) =>
      data(patch<T.Offer>(`/offers/${seg(id)}`, b)),
    reread: (id: string, b: { pageText?: string } = {}) => data(post<T.Job>(`/offers/${seg(id)}/reread`, b)),
    archive: (id: string) => data(del<Ok>(`/offers/${seg(id)}`)),
  },

  jobs: {
    get: (id: string) => data(get<T.Job>(`/jobs/${seg(id)}`)),
  },

  scripts: {
    list: (cid: string) => data(get<T.ScriptsResponse>(`/creatives/${seg(cid)}/scripts`)),
    generate: (cid: string, b: { count: number; replace: boolean; confirm?: boolean }) =>
      data(post<{ job: T.Job; scripts: T.Script[] }>(`/creatives/${seg(cid)}/scripts/generate`, b)),
    regenerate: (cid: string, sid: string, b: { confirm?: boolean } = {}) =>
      data(post<{ job: T.Job; script: T.Script }>(`/creatives/${seg(cid)}/scripts/${seg(sid)}/regenerate`, b)),
    update: (cid: string, sid: string, b: { angle?: string; blocks?: { index: number; speech?: string; visualPrompt?: string }[]; confirm?: boolean }) =>
      data(patch<T.Script>(`/creatives/${seg(cid)}/scripts/${seg(sid)}`, b)),
    select: (cid: string, sid: string, b: { confirm?: boolean } = {}) =>
      data(post<T.CreativeDetail>(`/creatives/${seg(cid)}/scripts/${seg(sid)}/select`, b)),
  },

  faces: {
    list: (cid: string) => data(get<T.FacesResponse>(`/creatives/${seg(cid)}/faces`)),
    /** §13.13: count 1-4, API default 4. */
    generate: (cid: string, b: T.GenerateFacesBody) =>
      data(post<{ batch: number; faces: T.Face[] }>(`/creatives/${seg(cid)}/faces/generate`, b)),
    select: (cid: string, fid: string, b: { confirm?: boolean } = {}) =>
      data(post<T.CreativeDetail>(`/creatives/${seg(cid)}/faces/${seg(fid)}/select`, b)),
    saveDescription: (cid: string, description: string) =>
      data(patch<{ description: string }>(`/creatives/${seg(cid)}/faces/description`, { description })),
  },

  engine: {
    catalog: () => data(get<T.EngineCatalog>("/engines")),
    voices: (language?: string) => data(get<T.Voice[]>("/voices", { query: { language } })),
    estimate: (cid: string, q: T.EstimateQuery) =>
      data(get<T.Estimate>(`/creatives/${seg(cid)}/estimate`, { query: q })),
    save: (cid: string, b: T.UpdateEngineBody) =>
      data(patch<T.CreativeDetail>(`/creatives/${seg(cid)}/engine`, b)),
    generate: (cid: string, b: T.GenerateBody) =>
      data(post<T.GenerateResponse>(`/creatives/${seg(cid)}/generate`, b)),
  },

  scenes: {
    list: (cid: string) => data(get<T.ScenesResponse>(`/creatives/${seg(cid)}/scenes`)),
    /** A TAKE_SLICE scene redoes the whole take: without `confirm` + `expectedCostUsd` → 409 INVALID_STATE reason 'regenerate_take' { takeId, estimateUsd }. */
    regenerate: (cid: string, index: number, b: T.RegenerateSceneBody = {}) =>
      data(post<T.Scene>(`/creatives/${seg(cid)}/scenes/${seg(index)}/regenerate`, b)),
    /** §13.5 "Redo the clip": new attempt of the whole lipsync take. 409 ESTIMATE_CHANGED / SPEND_CAP_EXCEEDED. */
    regenerateTake: (cid: string, b: T.RegenerateTakeBody) => data(post<T.Take>(`/creatives/${seg(cid)}/take/regenerate`, b)),
  },

  edit: {
    templates: () => data(get<T.Template[]>("/templates")),
    get: (cid: string) => data(get<T.EditResponse>(`/creatives/${seg(cid)}/edit`)),
    update: (cid: string, b: Partial<T.EditSettings>) =>
      data(patch<{ settings: T.EditSettings; dirty: true }>(`/creatives/${seg(cid)}/edit`, b)),
    render: (cid: string) => data(post<T.Render>(`/creatives/${seg(cid)}/render`)),
    getRender: (cid: string, rid: string) => data(get<T.Render>(`/creatives/${seg(cid)}/renders/${seg(rid)}`)),
  },

  /** Editor no vídeo (editor-v1 §5). Export = `edit.render` (same POST /render). */
  editor: {
    /** 409 INVALID_STATE without ready scenes / APPROVED. URLs in `source` expire at `urlsExpireAt`. */
    get: (cid: string) => data(get<T.EditorState>(`/creatives/${seg(cid)}/editor`)),
    /** 409 EDIT_CONFLICT { revision, savedBy, savedAt }; 400 VALIDATION_ERROR (EditDocRule); 422 EDIT_NOT_SUPPORTED. */
    save: (cid: string, b: T.PutEditorBody) => data(put<T.PutEditorResponse>(`/creatives/${seg(cid)}/editor`, b)),
  },

  review: {
    get: (cid: string) => data(get<T.ReviewResponse>(`/creatives/${seg(cid)}/review`)),
    approve: (cid: string) => data(post<T.CreativeDetail>(`/creatives/${seg(cid)}/approve`)),
    requestChanges: (cid: string, b: T.ChangeRequestBody) =>
      data(post<T.ChangeRequestResponse>(`/creatives/${seg(cid)}/changes`, b)),
  },

  library: {
    list: (q: Omit<T.LibraryQueryV, "cursor"> & PageQuery = {}) =>
      get<T.LibraryItemV[], T.LibraryMeta>("/library", { query: { ...q, winners: q.winners ? true : undefined } }),
    setWinner: (creativeId: string, isWinner: boolean) =>
      data(put<{ id: string; isWinner: boolean }>(`/library/${seg(creativeId)}/winner`, { isWinner })),
  },

  // ───── feature 2: variar campeão (api.md §18-20, feature-2-variar-campeao.md §4)
  uploads: {
    /** Step 1: reserve. 422 MEDIA_TOO_LARGE / MEDIA_INVALID (mime) come back here, before any byte is sent. */
    create: (b: T.CreateUploadBody) => data(post<T.CreateUploadResponse>("/uploads", b)),
    /** Step 2: send the bytes to `target.url` with progress (proxy or pre-signed, the web doesn't care). */
    send: (target: T.CreateUploadResponse, file: Blob, o: UploadOptions = {}) => sendUpload(target, file, o),
    /** Step 3: the API checks size + ffprobe. 422 MEDIA_TOO_SHORT / MEDIA_TOO_LONG / MEDIA_INVALID, 409 UPLOAD_INCOMPLETE, 410 UPLOAD_EXPIRED. */
    complete: (uploadId: string) => data(post<T.CompleteUploadResponse>(`/uploads/${seg(uploadId)}/complete`, {}, { timeoutMs: 60_000 })),
  },

  champions: {
    config: () => data(get<T.ChampionConfig>("/champions/config")),
    list: (q: Omit<T.ListChampionsQuery, "cursor"> & PageQuery = {}, o: Signal = {}) =>
      get<T.ChampionRow[], T.PageMeta>("/champions", { query: q, ...o }),
    /** 202 in ANALYZING (upload) or RESOLVING (link only). 503 AD_LIBRARY_UNAVAILABLE when link-only and the reader refused. */
    create: (b: T.CreateChampionBody) => data(post<T.ChampionDetail>("/champions", b)),
    /** Poll every 2 s while status is RESOLVING / ANALYZING (eventos.md, feature 2 §8). */
    get: (id: string, o: Signal = {}) => data(get<T.ChampionDetail>(`/champions/${seg(id)}`, o)),
    update: (id: string, b: T.UpdateChampionBody) => data(patch<T.ChampionDetail>(`/champions/${seg(id)}`, b)),
    /** `action: upload_video` on a FAILED champion. */
    attachVideo: (id: string, b: T.AttachChampionVideoBody) => data(put<T.ChampionDetail>(`/champions/${seg(id)}/video`, b)),
    /** 409 CONFIRM_DOWNSTREAM_RESET `{ editedSections }` when sections were edited: ask, then send `confirm: true`. */
    analyze: (id: string, b: T.AnalyzeChampionBody = {}) => data(post<{ job: T.Job }>(`/champions/${seg(id)}/analyze`, b)),
    /** Autosave of the teardown sections and word fixes (times never change). */
    updateTeardown: (id: string, b: T.UpdateTeardownBody) => data(patch<T.Teardown>(`/champions/${seg(id)}/teardown`, b)),
    remove: (id: string) => data(del<Ok>(`/champions/${seg(id)}`)),
    batches: (id: string) => data(get<T.VariationBatch[]>(`/champions/${seg(id)}/batches`)),
    /** 202 PLANNING. 422 NO_SPEECH / KIND_NOT_ENABLED `{ kind }`, 409 champion not READY. */
    createBatch: (id: string, b: T.CreateBatchBody) => data(post<T.VariationBatch>(`/champions/${seg(id)}/batches`, b)),
  },

  batches: {
    /** Poll: 1.5 s while PLANNING; 5 s after LAUNCHED while any creative is in progress (then 30 s). */
    get: (id: string, o: Signal = {}) => data(get<T.VariationBatch>(`/variation-batches/${seg(id)}`, o)),
    replan: (id: string, b: T.ReplanBatchBody = {}) => data(post<T.VariationBatch>(`/variation-batches/${seg(id)}/replan`, b)),
    /** Only what the kind's lever allows: NEW_HOOKS → hook; COPY_NEW → blocks; SWAP_AVATAR → included. */
    updateItem: (id: string, itemId: string, b: T.UpdateVariationItemBody) =>
      data(patch<T.VariationItem>(`/variation-batches/${seg(id)}/items/${seg(itemId)}`, b)),
    regenerateItem: (id: string, itemId: string, b: T.RegenerateVariationItemBody = {}) =>
      data(post<T.VariationItem>(`/variation-batches/${seg(id)}/items/${seg(itemId)}/regenerate`, b)),
    updateSettings: (id: string, b: T.UpdateBatchSettingsBody) => data(patch<T.VariationBatch>(`/variation-batches/${seg(id)}/settings`, b)),
    updateCasting: (id: string, castingId: string, b: T.UpdateCastingBody) =>
      data(patch<T.VariationCasting>(`/variation-batches/${seg(id)}/castings/${seg(castingId)}`, b)),
    /** §13.13: count 1-4, API default 1. */
    generateFaces: (id: string, castingId: string, b: T.GenerateCastingFacesBody) =>
      data(post<T.GenerateFacesResponse>(`/variation-batches/${seg(id)}/castings/${seg(castingId)}/faces/generate`, b)),
    selectFace: (id: string, castingId: string, faceId: string) =>
      data(post<T.VariationCasting>(`/variation-batches/${seg(id)}/castings/${seg(castingId)}/faces/${seg(faceId)}/select`, {})),
    /** 422 BATCH_INCOMPLETE `{ missing }` while a face, an item or the voice is missing. */
    estimate: (id: string) => data(get<T.BatchEstimate>(`/variation-batches/${seg(id)}/estimate`)),
    /** 409 ESTIMATE_CHANGED / SPEND_CAP_EXCEEDED, 422 BATCH_INCOMPLETE. */
    launch: (id: string, b: T.LaunchBatchBody) => data(post<T.LaunchBatchResponse>(`/variation-batches/${seg(id)}/launch`, b)),
  },

  // ───── variação automática de campeão (variacao-auto-v1.md §5). Status by polling GET /iterate/:id every 1.5 s (§10).
  iterate: {
    config: (o: Signal = {}) => data(get<T.IterateConfig>("/iterate/config", o)),
    /** Starts the analysis by itself (§5.1 note 1). 202 ANALYZING/PLANNING. 422 OFFER_REQUIRED `{ offers }`, 409 INVALID_STATE `not_a_video`, 409 SPEND_CAP_EXCEEDED. */
    create: (b: T.CreateIterateBody) => data(post<T.IterateBatch>("/iterate", b, { timeoutMs: 30_000 })),
    get: (id: string, o: Signal = {}) => data(get<T.IterateBatch>(`/iterate/${seg(id)}`, o)),
    /** Only from ANALYSIS_FAILED with action try_again. */
    retry: (id: string) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/retry`)),
    /** 409 PLAN_CHANGED `{ pieces }` when the plan differs from the number on the button. */
    start: (id: string, b: T.StartIterateBody) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/start`, b)),
    retryPiece: (pieceId: string, b: T.RetryPieceBody = {}) => data(post<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}/retry`, b)),
    leaveOut: (pieceId: string) => data(post<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}/leave-out`)),
    /** "In zip": the only adjustment after generating. */
    updatePiece: (pieceId: string, b: T.UpdatePieceBody) => data(patch<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}`, b)),
    /** 202 building or 200 ready (same zipKey). 409 INVALID_STATE `nothing_to_zip`. */
    zip: (id: string) => data(post<T.IterateZipResponse>(`/iterate/${seg(id)}/zip`)),
  },

  /** fase2-agencia §3.1. "New client" (POST /workspaces) returns tokens, so it goes through the BFF: `createClient` in lib/session/token. */
  clients: {
    list: (o: Signal = {}) => get<T.ClientCard[], T.ClientsMeta>("/workspaces", o),
  },

  workspace: {
    get: () => data(get<T.Workspace>("/workspace")),
    /** §3.3: idempotent. 422 ONBOARDING_INCOMPLETE `{ missing: ('businessType'|'offer')[] }`. */
    completeOnboarding: () => data(post<T.Workspace>("/workspace/onboarding/complete")),
    update: (b: T.UpdateWorkspaceBody) => data(patch<T.Workspace>("/workspace", b)),
    members: () => data(get<T.MembersResponse>("/workspace/members")),
    invite: (b: T.CreateInviteBody) =>
      data(post<T.CreateInviteResponse>("/workspace/invites", b)),
    revokeInvite: (id: string) => data(del<Ok>(`/workspace/invites/${seg(id)}`)),
    updateMember: (userId: string, role: T.Role) => data(patch<T.Member>(`/workspace/members/${seg(userId)}`, { role })),
    removeMember: (userId: string) => data(del<Ok>(`/workspace/members/${seg(userId)}`)),
    services: () => data(get<T.ServiceStatus[]>("/workspace/services")),
    spend: (month?: string) => data(get<T.Spend>("/workspace/spend", { query: { month } })),
  },
}

export type Api = typeof api
