"use client"

import { useCallback, useRef, useState } from "react"
import { api } from "@/lib/api/client"
import { ApiError, isApiError } from "@/lib/api/errors"
import type { ChampionConfig, CompleteUploadResponse } from "@/lib/api/types"

export type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; file: File; loaded: number; total: number; startedAt: number; etaSec: number | null }
  | { phase: "checking"; file: File }
  | { phase: "ready"; file: File; result: CompleteUploadResponse }
  | { phase: "error"; file: File | null; error: unknown }

/**
 * Champion upload (api.md §18): POST /uploads → PUT the bytes exactly as answered (XHR with progress) → complete.
 * Size and type are checked here first so the user gets the answer before sending 200 MB; the API stays the authority.
 */
export function useChampionUpload(config: Pick<ChampionConfig, "mimeTypes" | "maxBytes"> | undefined) {
  const [state, setState] = useState<UploadState>({ phase: "idle" })
  const abort = useRef<AbortController | null>(null)

  const start = useCallback(
    async (file: File) => {
      abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      // some browsers leave .mov without a type
      const mimeType = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : /\.mp4$/i.test(file.name) ? "video/mp4" : "")
      try {
        if (config && !config.mimeTypes.includes(mimeType)) throw new ApiError("http", "MEDIA_INVALID", 422, "mime", { reason: "mime" })
        if (config && file.size > config.maxBytes) throw new ApiError("http", "MEDIA_TOO_LARGE", 422, "size", { maxBytes: config.maxBytes })
        setState({ phase: "uploading", file, loaded: 0, total: file.size, startedAt: Date.now(), etaSec: null })
        const target = await api.uploads.create({ purpose: "CHAMPION_VIDEO", filename: file.name, mimeType, sizeBytes: file.size })
        await api.uploads.send(target, file, {
          signal: ctl.signal,
          onProgress: (loaded, total) =>
            setState((s) => {
              if (s.phase !== "uploading" || s.file !== file) return s
              const elapsed = (Date.now() - s.startedAt) / 1000
              return { ...s, loaded, total, etaSec: loaded > 0 && loaded < total ? Math.max(1, Math.round((elapsed * (total - loaded)) / loaded)) : null }
            }),
        })
        setState({ phase: "checking", file })
        const result = await api.uploads.complete(target.uploadId)
        if (!ctl.signal.aborted) setState({ phase: "ready", file, result })
      } catch (e) {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return
        setState({ phase: "error", file, error: e })
      }
    },
    [config]
  )

  const cancel = useCallback(() => {
    abort.current?.abort()
    setState({ phase: "idle" })
  }, [])

  return { state, start, cancel }
}

export function uploadErrorDetails(e: unknown) {
  return isApiError(e) ? (e.details ?? {}) : {}
}

export const mb = (bytes: number) => (bytes / 1024 / 1024 < 10 ? (bytes / 1024 / 1024).toFixed(1) : String(Math.round(bytes / 1024 / 1024)))

export function aspect(w?: number, h?: number) {
  if (!w || !h) return null
  const r = h / w
  return r > 1.6 ? "9:16" : r > 1.15 ? "4:5" : r > 0.9 ? "1:1" : "16:9"
}
