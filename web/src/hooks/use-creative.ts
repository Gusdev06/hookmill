"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import type { CreativeDetail, CreativeEvent, EditResponse, FacesResponse, ScenesResponse, ScriptsResponse } from "@/lib/api/types"
import { openCreativeStream } from "@/lib/sse"

export const qk = {
  creative: (id: string) => ["creative", id] as const,
  scripts: (id: string) => ["scripts", id] as const,
  faces: (id: string) => ["faces", id] as const,
  scenes: (id: string) => ["scenes", id] as const,
  edit: (id: string) => ["edit", id] as const,
  review: (id: string) => ["review", id] as const,
  editor: (id: string) => ["editor", id] as const,
  /** last `editor.updated` seen on the SSE (editor-v1 §9); the editor compares it with its own revision */
  editorRemote: (id: string) => ["editor-remote", id] as const,
}

export function useCreative(id: string) {
  return useQuery({ queryKey: qk.creative(id), queryFn: () => api.creatives.get(id) })
}

function stepResources(id: string) {
  return [qk.scripts(id), qk.faces(id), qk.scenes(id), qk.edit(id), qk.review(id)]
}

/** Applies one SSE event to the React Query cache (eventos.md §1). */
export function applyEvent(qc: QueryClient, id: string, e: CreativeEvent) {
  switch (e.event) {
    case "snapshot":
      qc.setQueryData(qk.creative(id), e.data)
      return
    case "creative.updated": {
      const prev = qc.getQueryData<CreativeDetail>(qk.creative(id))
      if (!prev) return void qc.invalidateQueries({ queryKey: qk.creative(id) })
      qc.setQueryData<CreativeDetail>(qk.creative(id), { ...prev, ...e.data })
      if (prev.state !== e.data.state) {
        // state changed: steps/summary/thumbnail are derived server-side, refetch them
        qc.invalidateQueries({ queryKey: qk.creative(id) })
        for (const k of stepResources(id)) qc.invalidateQueries({ queryKey: k })
      }
      return
    }
    case "cost.updated":
      qc.setQueryData<CreativeDetail>(qk.creative(id), (p) => (p ? { ...p, costUsd: e.data.costUsd } : p))
      return
    case "job.updated":
      qc.setQueryData<ScriptsResponse>(qk.scripts(id), (p) => (p ? { ...p, job: e.data } : p))
      return
    case "script.delta":
      qc.setQueryData<ScriptsResponse>(qk.scripts(id), (p) => {
        if (!p) return p
        const s = p.scripts.find((x) => x.id === e.data.scriptId)
        if (!s) {
          qc.invalidateQueries({ queryKey: qk.scripts(id) })
          return p
        }
        const d = e.data
        return {
          ...p,
          scripts: p.scripts.map((x) => {
            if (x.id !== d.scriptId) return x
            if (d.field === "speech") {
              const blocks = [...x.blocks]
              const b = blocks[d.blockIndex] ?? { label: "Hook", startSec: 0, endSec: 0, speech: "", visualPrompt: "" }
              blocks[d.blockIndex] = { ...b, speech: b.speech + d.text }
              return { ...x, blocks }
            }
            return { ...x, [d.field]: (x[d.field] ?? "") + d.text }
          }),
        }
      })
      return
    case "script.updated":
      qc.setQueryData<ScriptsResponse>(qk.scripts(id), (p) =>
        p ? { ...p, scripts: p.scripts.some((x) => x.id === e.data.id) ? p.scripts.map((x) => (x.id === e.data.id ? e.data : x)) : [...p.scripts, e.data] } : p
      )
      return
    case "face.updated":
      qc.setQueryData<FacesResponse>(qk.faces(id), (p) =>
        p ? { ...p, batches: p.batches.map((b) => ({ ...b, faces: b.faces.map((f) => (f.id === e.data.id ? { ...e.data, selected: f.selected } : f)) })) } : p
      )
      return
    case "scene.updated": {
      const { summary, ...scene } = e.data
      qc.setQueryData<ScenesResponse>(qk.scenes(id), (p) => (p ? { summary, scenes: p.scenes.map((s) => (s.id === scene.id ? scene : s)) } : p))
      qc.setQueryData<CreativeDetail>(qk.creative(id), (p) =>
        p && p.state === "SCENES_GENERATING" ? { ...p, progress: summary.progress, statusParams: { ready: summary.ready, total: summary.total } } : p
      )
      // editor-v1 §9: a regenerated scene changes the editor source (the server normalizes the cuts)
      if (scene.status === "READY") qc.invalidateQueries({ queryKey: qk.editor(id) })
      return
    }
    case "take.updated": {
      const { summary, ...take } = e.data
      qc.setQueryData<CreativeDetail>(qk.creative(id), (p) => (p ? { ...p, take } : p))
      qc.setQueryData<ScenesResponse>(qk.scenes(id), (p) => (p ? { ...p, summary } : p))
      qc.invalidateQueries({ queryKey: qk.editor(id) })
      return
    }
    case "render.updated":
      qc.setQueryData<EditResponse>(qk.edit(id), (p) =>
        p ? { ...p, latestRender: e.data, previewRender: e.data.status === "READY" ? e.data : p.previewRender } : p
      )
      if (e.data.status === "READY") qc.invalidateQueries({ queryKey: qk.edit(id) })
      return
    case "editor.updated":
      qc.setQueryData(qk.editorRemote(id), e.data)
      qc.invalidateQueries({ queryKey: qk.edit(id) })
      return
  }
}

/** Keeps the wizard live: one SSE per open creative. Returns the connection status. */
export function useCreativeEvents(id: string | null) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<"connecting" | "open" | "retrying">("connecting")
  useEffect(() => {
    if (!id) return
    return openCreativeStream(id, (e) => applyEvent(qc, id, e), {
      onStatus: setStatus,
      onReconnect: () => {
        qc.invalidateQueries({ queryKey: qk.creative(id) })
        for (const k of stepResources(id)) qc.invalidateQueries({ queryKey: k })
      },
    })
  }, [id, qc])
  return status
}
