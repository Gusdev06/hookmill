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
  // ads-research-v1 §5.2: arrays go as a repeated parameter, so callers with arrays pass a URLSearchParams
  if (query instanceof URLSearchParams) query.forEach((v, k) => url.searchParams.append(k, v))
  else if (query) {
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

  // 204 No Content (POST /events): nothing to parse
  if (res.status === 204) return { data: undefined as D, meta: undefined as M }

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
/** The verbs, for the area modules that live in their own file (lib/api/research.ts); URLs are still built only here. */
export const http = { get, post, patch, put, del, data, seg }

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
const LEVEL_PATH: Record<T.MetaLevel, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" }

export const api = {
  aiVariations: {
    config: () => data(get<T.SemanticPlannerConfig>("/ai-variations/config")),
    list: (championId?: string, o: Signal = {}) => data(get<T.SemanticPlanJob[]>("/ai-variations", { query: { championId }, ...o })),
    get: (id: string, o: Signal = {}) => data(get<T.SemanticPlanJob>(`/ai-variations/${seg(id)}`, o)),
    create: (body: T.SemanticPlanRequest) => data(post<T.SemanticPlanJob>("/ai-variations", body)),
  },
  auth: {
    me: () => data(get<T.MeResponse>("/auth/me")),
    /** onboarding-v2 §3.1: `accountMode` (AGENCY | OWN) is answered once on /start and editable in Settings. */
    updateMe: (b: { name?: string; uiLocale?: T.UiLocale; password?: { current: string; next: string }; accountMode?: T.AccountMode }) =>
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
    /** fase2-agencia §3.5: signed URL with Content-Disposition: attachment (the `url` of a FileRef has none, so it only plays). */
    download: (id: string, format?: T.FormatCode) => data(get<T.CreativeDownload>(`/creatives/${seg(id)}/download`, { query: { format } })),
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
    /** `readMeta` (briefing-leitura-v2 D5): a new offer carries `output.readMeta` of the OFFER_EXTRACT job. */
    create: (b: T.CreateOfferBody) => data(post<T.Offer>("/offers", b)),
    /** D6: the apply of a reread sends `readMeta` with the fields. */
    update: (id: string, b: T.UpdateOfferBody) => data(patch<T.Offer>(`/offers/${seg(id)}`, b)),
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
    // ───── editor universal v1 (docs/contratos/editor-universal-v1.md §7, F-U1): same GET/PUT, v3 for the AUTO piece
    /** Same GET as `get`: scratch answers `EditorState` (v1) until F-U2, the AUTO piece answers `EditorStateV3` (`version: 3`).
     *  422 EDIT_NOT_SUPPORTED { reason }; 402 sample locked; 409 INVALID_STATE { reason: piece_not_ready | source_unavailable }. */
    open: (cid: string) => data(get<T.EditorState | T.EditorStateV3>(`/creatives/${seg(cid)}/editor`)),
    /** autosave 800 ms. 409 EDIT_CONFLICT { revision, savedBy, savedAt }; 409 INVALID_STATE { reason: read_only | export_running }; 400 VALIDATION_ERROR (EditDocRuleV3). */
    saveV3: (cid: string, b: T.PutEditorBodyV3) => data(put<T.PutEditorResponseV3>(`/creatives/${seg(cid)}/editor`, b)),
    /** 202. 409 EDIT_CONFLICT; 409 INVALID_STATE { reason: nothing_to_export | export_running | render_running | read_only }; 422 EDIT_BLOCKED { issues }; 409 SPEND_CAP_EXCEEDED; 429 RATE_LIMITED { limit, resetAt }. */
    export: (cid: string, b: T.ExportEditorBody) => data(post<T.EditorExportView>(`/creatives/${seg(cid)}/editor/export`, b)),
    /** "Retry check" after a check failure (canRecheck). 409 INVALID_STATE { reason: cannot_recheck } otherwise. */
    recheck: (cid: string) => data(post<T.EditorExportView>(`/creatives/${seg(cid)}/editor/export/recheck`)),
  },

  review: {
    get: (cid: string) => data(get<T.ReviewResponse>(`/creatives/${seg(cid)}/review`)),
    approve: (cid: string) => data(post<T.CreativeDetail>(`/creatives/${seg(cid)}/approve`)),
    requestChanges: (cid: string, b: T.ChangeRequestBody) =>
      data(post<T.ChangeRequestResponse>(`/creatives/${seg(cid)}/changes`, b)),
  },

  library: {
    list: (q: Omit<T.LibraryQuery, "cursor"> & PageQuery = {}) =>
      get<T.LibraryItem[], T.LibraryMeta>("/library", { query: { ...q, winners: q.winners ? true : undefined } }),
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
    /** legenda-protegida-v1 §2.3: the same video without the burned-in captions (422 CLEAN_VERSION_MISMATCH { reason }) */
    setCleanVersion: (id: string, b: T.SetCleanVersionBody) => data(post<Pick<T.ChampionDetail, "id" | "cleanVideo">>(`/champions/${seg(id)}/clean-version`, b)),
    removeCleanVersion: (id: string) => data(del<Pick<T.ChampionDetail, "id" | "cleanVideo">>(`/champions/${seg(id)}/clean-version`)),
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
    answers: (id: string, b: T.UpdateIterateAnswersBody) => data(put<T.IterateBatch>(`/iterate/${seg(id)}/answers`, b)),
    select: (id: string, itemId: string, included: boolean) => data(patch<T.IterateBatch>(`/iterate/${seg(id)}/items/${seg(itemId)}`, { included })),
    preferences: () => data(get<T.IteratePreferences | null>(`/iterate/preferences`)),
    forgetPreferences: () => data(del<void>(`/iterate/preferences`)),
    config: (o: Signal = {}) => data(get<T.IterateConfig>("/iterate/config", o)),
    /** lacunas-home-eddy-v1 §5: batches, updatedAt desc (Home Recent merges them with the creatives) */
    list: (q: Omit<T.ListIterateQuery, "cursor"> & PageQuery = {}, o: Signal = {}) =>
      get<T.IterateBatchRow[], { nextCursor: string | null }>("/iterate", { query: q, ...o }),
    /** Starts the analysis by itself (§5.1 note 1). 202 ANALYZING/PLANNING. 422 OFFER_REQUIRED `{ offers }`, 409 INVALID_STATE `not_a_video`, 409 SPEND_CAP_EXCEEDED. */
    create: (b: T.CreateIterateBody) => data(post<T.IterateBatch>("/iterate", b, { timeoutMs: 30_000 })),
    get: (id: string, o: Signal = {}) => data(get<T.IterateBatch>(`/iterate/${seg(id)}`, o)),
    /** Only from ANALYSIS_FAILED with action try_again. */
    retry: (id: string) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/retry`)),
    /** 26/10 (legenda-protegida D-LP5): plan again over the finished analysis; only PLAN_READY (409 INVALID_STATE reason 'launched') */
    replan: (id: string) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/replan`, {})),
    /** 409 PLAN_CHANGED `{ pieces }` when the plan differs from the number on the button. Rev. 23/10 (§14.4): `expectedCostUsd` =
     *  `cost.generateEstimateUsd` on the button; 409 ESTIMATE_CHANGED `{ estimateUsd }`, 409 SPEND_CAP_EXCEEDED. */
    start: (id: string, b: T.StartIterateBody) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/start`, b)),
    retryPiece: (pieceId: string, b: T.RetryPieceBody = {}) => data(post<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}/retry`, b)),
    /** Rev. 23/10 (§14.2): 4:5 / 1:1 on demand, also the retry of a failed format. 202 queued · 200 already there. Only `ready` pieces;
     *  409 INVALID_STATE, 409 SPEND_CAP_EXCEEDED (STATIC), 403 FORBIDDEN (CLIENT). */
    requestFormat: (pieceId: string, b: T.RequestPieceFormatBody) => data(post<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}/formats`, b)),
    leaveOut: (pieceId: string) => data(post<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}/leave-out`)),
    /** "In zip": the only adjustment after generating. */
    updatePiece: (pieceId: string, b: T.UpdatePieceBody) => data(patch<T.IteratePiece>(`/iterate/pieces/${seg(pieceId)}`, b)),
    /** 202 building or 200 ready (same zipKey). 409 INVALID_STATE `nothing_to_zip`. */
    zip: (id: string) => data(post<T.IterateZipResponse>(`/iterate/${seg(id)}/zip`)),
    /** templates-creditos-v1 §7: edit the texts of a template piece in PLAN_READY (free). 409 INVALID_STATE; 422 TEXT_INVALID
     *  `{ violations }` / EDIT_NOT_SUPPORTED. `itemId` = the piece id. */
    updateTexts: (id: string, itemId: string, b: T.UpdateItemTextsBody) => data(patch<T.IterateBatch>(`/iterate/${seg(id)}/items/${seg(itemId)}/texts`, b)),
    /** templates-ia-previas-v1 §5.3–§5.5: the 4 image previews of a With AI batch (status by polling GET /iterate/:id, `ai`). */
    aiPreviews: {
      /** 202 IterateBatch (LAUNCHED, `pieceId` on the approved ones). 409 INVALID_STATE `preview_not_ready`/`request_conflict` `{ previewIds }`,
       *  409 CREDITS_CHANGED `{ credits }`, 402 INSUFFICIENT_CREDITS / PAYMENT_REQUIRED, 409 SPEND_CAP_EXCEEDED, 422 OFFER_INCOMPLETE. */
      approve: (id: string, b: T.ApproveAiPreviewsBody) => data(post<T.IterateBatch>(`/iterate/${seg(id)}/ai-previews/approve`, b)),
      /** "New angle": 202 AiPreview (`planned`). 429 REGEN_LIMIT `{ scope: 'preview' | 'batch', used, max }`, 409 INVALID_STATE, 409 SPEND_CAP_EXCEEDED. */
      regenerate: (id: string, previewId: string, b: T.RegenerateAiPreviewBody) =>
        data(post<T.AiPreview>(`/iterate/${seg(id)}/ai-previews/${seg(previewId)}/regenerate`, b)),
      /** "Try again" on a failed preview (outside the regeneration limit): 202 AiPreview. 429 REGEN_LIMIT `{ scope: 'retry' }`, 409 INVALID_STATE. */
      retry: (id: string, previewId: string, b: T.RetryAiPreviewBody) => data(post<T.AiPreview>(`/iterate/${seg(id)}/ai-previews/${seg(previewId)}/retry`, b)),
    },
  },

  // ───── templates-creditos-v1 §7: the template gallery (`/ad-templates`; `/templates` is the wizard's Remotion registry)
  adTemplates: {
    /** at most 1 source in the query (400 otherwise); with a source every card carries `fit` */
    list: (q: T.TemplateSourceRef = {}, o: Signal = {}) => data(get<T.TemplateList>("/ad-templates", { query: q, ...o })),
    /** 404 unknown or not visible */
    get: (slug: string, q: T.TemplateSourceRef = {}, o: Signal = {}) => data(get<T.TemplateCard>(`/ad-templates/${seg(slug)}`, { query: q, ...o })),
    /** fit of one template on 1-50 ads (no paid call) */
    fits: (b: T.TemplateFitsBody, o: Signal = {}) => data(post<T.TemplateFitsResponse>("/ad-templates/fits", b, { ...o, timeoutMs: 30_000 })),
    /** 202 IterateBatch (with `template`). 422 TEMPLATE_UNAVAILABLE / TEMPLATE_DOESNT_FIT { reason } / OFFER_REQUIRED { offers };
     *  402 PAYMENT_REQUIRED { reason: 'sample_tier' | 'sample_used' }. Nothing is charged here (reading + plan are free). */
    use: (slug: string, b: T.UseTemplateBody) => data(post<T.IterateBatch>(`/ad-templates/${seg(slug)}/use`, b, { timeoutMs: 30_000 })),
    /** templates-multi-v1 §3.1: 2-12 templates on one ad, one batch (price = sum, no cap). 202 IterateBatch with `template.selection`.
     *  422 TEMPLATE_SELECTION_INVALID { reason, slugs } / TEMPLATE_DOESNT_FIT { items } / TEMPLATE_UNAVAILABLE { slug } / OFFER_REQUIRED;
     *  402 PAYMENT_REQUIRED (sample) / INSUFFICIENT_CREDITS (sample uses). */
    useMany: (b: T.UseTemplatesBody) => data(post<T.IterateBatch>("/ad-templates/use", b, { timeoutMs: 30_000 })),
    /** history of template uses (cursor) */
    runs: (q: PageQuery = {}, o: Signal = {}) => data(get<{ items: T.TemplateRunRef[]; nextCursor: string | null }>("/ad-templates/runs", { query: q, ...o })),
  },

  /** templates-creditos-v1 §4: balance of the paying account (INTERNAL = unlimited) and the append-only ledger */
  credits: {
    summary: (o: Signal = {}) => data(get<T.CreditsSummary>("/credits", o)),
    ledger: (q: PageQuery = {}, o: Signal = {}) => data(get<{ items: T.CreditEntryView[]; nextCursor: string | null }>("/credits/ledger", { query: q, ...o })),
  },

  /** amostra-gratis-v1 §5 (P2, no gateway yet): manual unlock. Only an INTERNAL OWNER (else 403 FORBIDDEN); 404 unknown user. */
  admin: {
    updateAccess: (userId: string, access: T.AccountAccess) =>
      data(patch<{ id: string; access: T.AccountAccess }>(`/admin/users/${seg(userId)}/access`, { access } satisfies T.UpdateAccessBody)),
    // templates-creditos-v1 §7 (INTERNAL OWNER only, else 403): the catalog with DRAFT/HIDDEN, price/status, example video, manual credit
    templates: () => data(get<{ items: T.AdminTemplate[] }>("/admin/ad-templates")),
    /** 422 TEMPLATE_UNPRICED (LIVE without a price) */
    updateTemplate: (slug: string, b: T.UpdateTemplateBody) => data(patch<T.AdminTemplate>(`/admin/ad-templates/${seg(slug)}`, b)),
    /** pre-signed PUT, 15 min; MP4 ≤ 60 MB */
    exampleUpload: (slug: string, b: T.TemplateExampleUploadBody) => data(post<T.TemplateExampleUpload>(`/admin/ad-templates/${seg(slug)}/example`, b)),
    /** sends the bytes to the pre-signed URL (with progress) */
    sendExample: (target: T.TemplateExampleUpload, file: Blob, o: UploadOptions = {}) =>
      sendUpload({ uploadId: target.key, method: "PUT", url: target.uploadUrl, headers: { "Content-Type": "video/mp4" }, expiresAt: target.expiresAt }, file, o),
    /** poster by ffmpeg; 409 UPLOAD_INCOMPLETE, 422 MEDIA_INVALID / MEDIA_TOO_LONG */
    exampleComplete: (slug: string, b: T.TemplateExampleCompleteBody) => data(post<T.AdminTemplate>(`/admin/ad-templates/${seg(slug)}/example/complete`, b, { timeoutMs: 60_000 })),
    /** 404; 409 INVALID_STATE { state: 'insufficient_balance' }; the same idempotencyKey never credits twice */
    grantCredits: (b: T.GrantCreditsBody) => data(post<T.GrantCreditsResponse>("/admin/credits/grant", b)),
  },

  /** fase2-agencia §3.1. "New client" (POST /workspaces) returns tokens, so it goes through the BFF: `createClient` in lib/session/token. */
  clients: {
    list: (o: Signal = {}) => get<T.ClientCard[], T.ClientsMeta>("/workspaces", o),
  },

  workspace: {
    get: () => data(get<T.Workspace>("/workspace")),
    /** §3.3: idempotent. 422 ONBOARDING_INCOMPLETE `{ missing: ('resultType'|'offer')[] }` (resultado-v1: was 'businessType'). */
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
    /** tour-v2 (04/11): `?v=2` = stops by role (brain, templates, credits | brain, review), the winner and the tips seen.
     *  An API before v2 answers the legacy `TourState`; the provider maps it (iterate → templates, drops the rest). */
    tour: (o: Signal = {}) => data(get<T.TourStateV2 | T.TourState>("/workspace/tour", { query: { v: "2" }, ...o })),
    /** tour-v2 §4: idempotent; the tip never shows again for this user in this workspace. */
    seeTip: (tip: T.TipKey) => data(post<T.TipsSeenResponse>("/workspace/tour/tips", { tip } satisfies T.SeeTipBody)),
    /** "Show tips again": clears `tipsSeen`. */
    resetTips: () => data(del<T.TipsSeenResponse>("/workspace/tour/tips")),
    /** Idempotent: an already completed tour answers the saved date. */
    completeTour: () => data(post<T.TourCompleteResponse>("/workspace/tour/complete", {})),
  },

  // ───── tour-v2 §6: product events, fire-and-forget (204). workspaceId/userId/role come from the session on the server.
  events: {
    send: (b: T.ProductEventsBody) => post<undefined>("/events", b).then(() => undefined),
  },

  // ───── Brain 3D v1 (brain-3d-v1.md §1): read-only, every role (CLIENT too). Cache 60 s on the API; `fresh: "1"` skips it.
  brain: {
    /** 404 when `offerId` is from another workspace or archived */
    graph: (q: T.BrainGraphQuery = {}, o: Signal = {}) => data(get<T.BrainGraph>("/brain/graph", { query: q, ...o })),
    /** `id` = "<kind>:<key>" (§2.1). 404 when it doesn't exist (or a meta_ad with Meta off) */
    node: (id: string, o: Signal = {}) => data(get<T.BrainNodeDetail>(`/brain/node/${seg(id)}`, o)),
  },

  // ───── Kit da marca v1 (kit-marca-v1.md §3): GET for every role; writes are 403 for CLIENT. Upload first (purpose BRAND_*).
  brandKit: {
    get: (o: Signal = {}) => data(get<T.BrandKit>("/brand-kit", o)),
    /** 201. LOGO replaces the previous one. 409 INVALID_STATE { reason: 'brand_kit_full', kind, max } · 409 UPLOAD_INCOMPLETE · 422 MEDIA_INVALID */
    addAsset: (b: T.CreateBrandAssetBody) => data(post<T.BrandAsset>("/brand-kit/assets", b)),
    /** label ≤ 80 (null clears) · offerId (null = whole brand) */
    updateAsset: (id: string, b: T.UpdateBrandAssetBody) => data(patch<T.BrandAsset>(`/brand-kit/assets/${seg(id)}`, b)),
    removeAsset: (id: string) => data(del<Ok>(`/brand-kit/assets/${seg(id)}`)),
  },

  // ───── Meta v1 (meta-v1.md §3). The token never reaches the web; the callback is a redirect handled by the API.
  meta: {
    /** 201 { url }: open it in the same tab; the API sends the browser back to `returnTo?meta=connected|error&code=`. 503 META_NOT_CONFIGURED. */
    connect: (b: T.MetaConnectBody = {}) => data(post<T.MetaConnectResponse>("/meta/connect", b)),
    /** null when the workspace never connected. */
    connection: (o: Signal = {}) => data(get<T.MetaConnection | null>("/meta/connection", o)),
    /** "Connect from another browser" (§3.1, 22/10): the origin tab polls this every 3 s while `pending`. */
    oauthStatus: (o: Signal = {}) => data(get<T.MetaOAuthStatus>("/meta/oauth/status", o)),
    /** Live from Meta: ad accounts (`canManage`), Pages and the pixels of `adAccountId`. 422 META_NOT_CONNECTED / META_TOKEN_INVALID, 503 META_UNAVAILABLE. */
    options: (q: T.MetaOptionsQuery = {}, o: Signal = {}) => data(get<T.MetaOptions>("/meta/options", { query: q, ...o, timeoutMs: 30_000 })),
    /** Runs the health check right away and starts the first sync. 422 META_PERMISSION `{ adAccountId, reason }` on an account without the advertise task. */
    select: (b: T.MetaSelectionBody) => data(put<T.MetaConnection>("/meta/selection", b, { timeoutMs: 30_000 })),
    health: () => data(post<T.MetaHealth>("/meta/health", {}, { timeoutMs: 30_000 })),
    disconnect: () => data(del<Ok>("/meta/connection")),
    /** 202 { job } (or 200 with the running one). 429 RATE_LIMITED `{ retryAfterSec }` under 5 min between manual syncs. */
    sync: () => data(post<T.MetaSyncResponse>("/meta/sync", {})),
    /** Video ads with 30-day numbers; default order WINNER first, then spend. The tour takes the first of `?verdict=WINNER&limit=1`. */
    ads: (q: Omit<T.MetaAdsQuery, "cursor"> & PageQuery = {}, o: Signal = {}) => get<T.MetaAdRow[], T.MetaAdsMeta>("/meta/ads", { query: q, ...o }),
    /** KPIs of the chosen account for 7d | 30d (+ `prev`), counts and `sync` (Home scoreboard). */
    summary: (q: T.MetaSummaryQuery = {}, o: Signal = {}) => data(get<T.MetaSummary>("/meta/summary", { query: q, ...o })),
    // ───── Campaigns v1 (campanhas-v1.md §4): snapshots per level; writes are OWNER/ADMIN, confirmed and audited
    /** GET /meta/campaigns: campaign rows + totals/counts/sync of the filtered set (snapshot only, never live) */
    campaigns: (q: Omit<T.MetaCampaignsQuery, "cursor"> & PageQuery = {}, o: Signal = {}) => get<T.MetaCampaignRow[], T.MetaCampaignsMeta>("/meta/campaigns", { query: q, ...o }),
    /** GET /meta/campaigns/:id: its ad sets with their ads (every format), ordered like the list */
    campaign: (id: string, q: T.MetaCampaignDetailQuery = {}, o: Signal = {}) => data(get<T.MetaCampaignDetail>(`/meta/campaigns/${seg(id)}`, { query: q, ...o })),
    // ───── meta-oferta-v1 §5: manual "this ad / campaign is (not) from this offer". Survives the sync. CLIENT 403.
    offerLinks: {
      /** PUT /meta/offer-links: `belongs: true` is exclusive (drops BELONGS to other offers). 404 { resource }, 409 META_SELECTION_MISSING */
      put: (b: T.MetaOfferLinkBody) => data(put<T.MetaOfferLinkResult>("/meta/offer-links", b)),
      /** DELETE /meta/offer-links?level=&objectId=&offerId=: back to automatic (`decision: null`); idempotent */
      remove: (q: T.MetaOfferLinkQuery) => data(del<T.MetaOfferLinkResult>("/meta/offer-links", { query: q })),
    },
    /** POST /meta/{campaigns|adsets|ads}/:id/status (409 META_OBJECT_CHANGED / META_PARENT_PAUSED, 422 META_POLICY…) */
    setStatus: (level: T.MetaLevel, id: string, b: T.MetaStatusBody) => data(post<T.MetaWriteResult>(`/meta/${LEVEL_PATH[level]}/${seg(id)}/status`, b, { timeoutMs: 30_000 })),
    /** PATCH /meta/{campaigns|adsets}/:id/budget (422 META_BUDGET_TOO_LOW / _STEP_TOO_LARGE / _NOT_EDITABLE) */
    setBudget: (level: "campaign" | "adset", id: string, b: T.MetaBudgetBody) => data(patch<T.MetaWriteResult>(`/meta/${LEVEL_PATH[level]}/${seg(id)}/budget`, b, { timeoutMs: 30_000 })),
    /** GET /meta/changes: the History drawer (newest first, cursor) */
    changes: (q: Omit<T.MetaChangesQuery, "cursor"> & PageQuery = {}, o: Signal = {}) => get<T.MetaChangeRow[], T.PageMeta>("/meta/changes", { query: q, ...o }),
    publications: (q: Omit<T.MetaPublicationsQuery, "cursor"> & PageQuery = {}) => get<T.MetaPublication[], T.PageMeta>("/meta/publications", { query: q }),

    // ───── §3.3 Send → "Publish to Meta" (per creative). Poll `creative` every 2 s while publication.status = PUBLISHING (§3.3.1).
    /** Current publication, history, prefilled defaults (null without a connection) and the connection state. 404. */
    creative: (cid: string, o: Signal = {}) => data(get<T.CreativeMetaResponse>(`/creatives/${seg(cid)}/meta`, o)),
    /** 202 PUBLISHING. 409 INVALID_STATE `not_approved` | `publish_in_progress`; 422 META_PIXEL_REQUIRED `{ objective }` / META_BUDGET_TOO_LOW `{ minimumMinor, currency }` / META_ACCOUNT_UNUSABLE / META_TOKEN_INVALID; 503 META_UNAVAILABLE `{ retryAfterSec }`. */
    publish: (cid: string, b: T.MetaPublishBody | T.MetaPublishWithTemplateBody) => data(post<T.MetaPublication>(`/creatives/${seg(cid)}/meta/publish`, b, { timeoutMs: 30_000 })),
    /** Reopens a FAILED job from the ids already created (no duplicate campaign). 409 when not FAILED. */
    retry: (cid: string) => data(post<T.MetaPublication>(`/creatives/${seg(cid)}/meta/retry`, {})),
    /** OWNER/ADMIN only (D11: activating is what spends). 409 when not PAUSED. */
    activate: (cid: string) => data(post<T.MetaPublication>(`/creatives/${seg(cid)}/meta/activate`, { confirm: true } satisfies T.MetaActivateBody, { timeoutMs: 30_000 })),
    /** OWNER/ADMIN only. Pauses just the ad. 409 when not ACTIVE. */
    pause: (cid: string) => data(post<T.MetaPublication>(`/creatives/${seg(cid)}/meta/pause`, {}, { timeoutMs: 30_000 })),
    /** meta-templates-v1 §2: 202 { publications, plan }. 409 INVALID_STATE `not_approved` | `publish_in_progress` { creativeIds }; 422 like publish. */
    publishBatch: (b: T.MetaPublishBatchBody) => data(post<T.MetaPublishBatchResponse>("/meta/publish-batch", b, { timeoutMs: 60_000 })),
    // ───── meta-templates-v2 §4: lists of the selected account/Page for the template editor (OWNER/ADMIN/MEMBER)
    /** Instagram accounts of the ad account + of the Page (PAGE first); `pageLookup` says if the Page side was read */
    instagramAccounts: (o: Signal = {}) => data(get<T.MetaInstagramAccountsResponse>("/meta/instagram-accounts", { ...o, timeoutMs: 30_000 })),
    /** custom audiences + lookalikes, newest first, up to 500 (`truncated`); the web filters locally */
    customAudiences: (o: Signal = {}) => data(get<T.MetaCustomAudiencesResponse>("/meta/custom-audiences", { ...o, timeoutMs: 30_000 })),
    /** the whole adlocale list (name asc, English); the web filters locally */
    locales: (o: Signal = {}) => data(get<T.MetaLocalesResponse>("/meta/locales", { ...o, timeoutMs: 30_000 })),

    // ───── meta-templates-v1 §2: publish templates of the selected ad account (CLIENT only reads).
    templates: {
      /** default first. 422 META_SELECTION_MISSING */
      list: (o: Signal = {}) => data(get<T.MetaPublishTemplate[]>("/meta/templates", o)),
      /** 201. 400 VALIDATION_ERROR { fields }; 422 META_PIXEL_REQUIRED / META_BUDGET_TOO_LOW { minimumMinor, currency } */
      create: (b: T.MetaTemplateBody) => data(post<T.MetaPublishTemplate>("/meta/templates", b)),
      update: (id: string, b: T.UpdateMetaTemplateBody) => data(patch<T.MetaPublishTemplate>(`/meta/templates/${seg(id)}`, b)),
      /** archives. 409 while a publication with it is running */
      remove: (id: string) => data(del<T.MetaPublishTemplate>(`/meta/templates/${seg(id)}`)),
      /** reads a campaign / ad set / ad of the account and maps it; does NOT save. 404 META_OBJECT_GONE; 422 META_PERMISSION */
      import: (b: T.MetaTemplateImportBody) => data(post<T.MetaTemplateImportResult>("/meta/templates/import", b, { timeoutMs: 30_000 })),
    },
  },
}

export type Api = typeof api
