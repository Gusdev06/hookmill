"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import { validarDoc, type EditDoc as VideoEditDoc } from "@maquina/video/player"
import type { EditConflictDetails, EditDoc, EditResponse, EditSettings, EditorState, EditorUpdatedEvent, PutEditorBody, ScratchSource } from "@/lib/api/types"
import { qk } from "@/hooks/use-creative"
import { docOrEmpty, isEmptyDoc } from "./model"

export interface Work { doc: EditDoc; settings: EditSettings }
interface Entry { label: string; work: Work }
/** error = transient (network/5xx), retried every 4 s · invalid = the doc breaks a rule (validarDoc / 400): never resent as is */
export type SaveStatus = "saved" | "saving" | "error" | "invalid"
export type SessionToast = { key: string; values?: Record<string, string | number>; undo?: boolean; id?: string }

const AUTOSAVE_MS = 800 // editor-v1 §5 / spec §2.14
const REFRESH_BEFORE_MS = 10 * 60_000 // refetch GET /editor 10 min before urlsExpireAt (§5.1)
const SETTINGS_KEYS = ["headline", "ctaText", "endCard", "captionStyle"] as const
const snapOf = (w: Work) => JSON.stringify([isEmptyDoc(w.doc) ? null : w.doc, SETTINGS_KEYS.map((k) => w.settings[k])])

/**
 * One editor session: server state (GET /editor), the local working copy, undo/redo, autosave (800 ms, baseRevision),
 * EDIT_CONFLICT, remote saves (SSE editor.updated), signed-URL refresh and Export (POST /render).
 */
export function useEditorSession(id: string, onToast: (msg: SessionToast) => void) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.editor(id), queryFn: () => api.editor.get(id), retry: false, refetchOnWindowFocus: false, staleTime: 60_000 })
  const edit = useQuery({ queryKey: qk.edit(id), queryFn: () => api.edit.get(id), retry: false })
  const remote = useQuery<EditorUpdatedEvent["data"] | null>({ queryKey: qk.editorRemote(id), queryFn: () => null, enabled: false, staleTime: Infinity })

  const [work, setWork] = useState<Work | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [savedSnap, setSavedSnap] = useState<string>("")
  const [seenData, setSeenData] = useState<EditorState | null>(null)
  const [hist, setHist] = useState<{ past: Entry[]; future: Entry[] }>({ past: [], future: [] })
  const [status, setStatus] = useState<SaveStatus>("saved")
  const [conflict, setConflict] = useState<EditConflictDetails | null>(null)
  const [changes, setChanges] = useState(0)
  const [reload, setReload] = useState<null | "conflict" | "remote">(null)
  // the snap that broke a rule + the rule: autosave skips exactly that snap; any other change (or Undo) saves again
  const [invalid, setInvalid] = useState<{ snap: string; rule: string } | null>(null)

  // adopt server data (first load, refetch after conflict/remote save/URL refresh) during render, not in an effect
  if (q.data && q.data !== seenData) {
    setSeenData(q.data)
    const clean = !work || snapOf(work) === savedSnap
    if (!work || reload || (clean && q.data.revision !== revision)) {
      const w = { doc: docOrEmpty(q.data.doc), settings: q.data.settings }
      setWork(w)
      setRevision(q.data.revision)
      setSavedSnap(snapOf(w))
      if (reload) {
        setReload(null)
        setHist({ past: [], future: [] })
      }
    }
  }

  // refs for timers/handlers (written after render)
  const workRef = useRef<Work | null>(null)
  const revRef = useRef<number | null>(null)
  const savedRef = useRef("")
  const inflight = useRef<Promise<void> | null>(null)
  const typingField = useRef<string | null>(null)
  const histRef = useRef(hist)
  const sourceRef = useRef<ScratchSource | null>(null)
  useEffect(() => {
    workRef.current = work
    revRef.current = revision
    savedRef.current = savedSnap
    histRef.current = hist
    const src = q.data?.source
    sourceRef.current = src && "scenes" in src ? src : null
  })
  const setHistory = useCallback((h: { past: Entry[]; future: Entry[] }) => {
    histRef.current = h
    setHist(h)
  }, [])

  const saveRef = useRef<() => Promise<void>>(async () => {})
  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      await inflight.current
      return saveRef.current()
    }
    const w = workRef.current
    if (!w || revRef.current === null) return
    const snap = snapOf(w)
    if (snap === savedRef.current) return
    const body: PutEditorBody = {
      baseRevision: revRef.current,
      doc: isEmptyDoc(w.doc) ? null : w.doc,
      settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, w.settings[k]])) as Partial<EditSettings>,
    }
    // §5.4: the same validarDoc the API runs; a doc that breaks a rule is not sent (it would only come back 400)
    const broken = (fields: { rule?: string }[]) => {
      const rule = fields[0]?.rule ?? "invalid"
      setInvalid({ snap, rule })
      setStatus("invalid")
      onToast({ key: "toast.invalid", values: { rule }, undo: true, id: "ed-invalid" })
    }
    const src = sourceRef.current
    const errs = src ? validarDoc(body.doc as VideoEditDoc | null, src) : []
    if (errs.length) return broken(errs)
    setStatus("saving")
    const run = (async () => {
      try {
        const r = await api.editor.save(id, body)
        revRef.current = r.revision
        setRevision(r.revision)
        const now = workRef.current
        if (now && snapOf(now) === snap) {
          // nothing changed while saving: take the normalized doc the server returned (§5.4)
          const n = { doc: docOrEmpty(r.doc), settings: r.settings }
          workRef.current = n
          savedRef.current = snapOf(n)
          setWork(n)
          setSavedSnap(savedRef.current)
        } else {
          savedRef.current = snap
          setSavedSnap(snap)
        }
        setStatus("saved")
        setInvalid(null)
        qc.setQueryData<EditResponse>(qk.edit(id), (p) => (p ? { ...p, settings: r.settings, dirty: true, hasEditorChanges: !!r.doc } : p))
        qc.invalidateQueries({ queryKey: qk.creative(id) })
      } catch (e) {
        if (isApiError(e) && e.code === "EDIT_CONFLICT") {
          setConflict((e.details ?? null) as EditConflictDetails | null)
          setReload("conflict")
          setStatus("saved")
        } else if (isApiError(e) && e.code === "EDIT_NOT_SUPPORTED") {
          // the UI already locks this; if it still happens, drop the gesture (spec §8)
          setStatus("saved")
          onToast({ key: "toast.notSupported" })
          const h = histRef.current
          const last = h.past[h.past.length - 1]
          if (last) {
            workRef.current = last.work
            setWork(last.work)
            setHistory({ past: h.past.slice(0, -1), future: h.future })
          }
        } else if (isApiError(e) && e.code === "VALIDATION_ERROR") {
          // not transient: resending the same doc gets the same 400. Show the rule, offer Undo, wait for a change
          broken(((e.details as { fields?: { rule?: string }[] } | undefined)?.fields ?? []))
        } else {
          setStatus("error")
        }
      } finally {
        inflight.current = null
      }
    })()
    inflight.current = run
    await run
  }, [id, qc, onToast, setHistory])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  // autosave: 800 ms after the last change (never the exact doc that broke a rule)
  const snapNow = work ? snapOf(work) : ""
  const dirtyLocal = !!work && snapNow !== savedSnap
  const blocked = !!invalid && invalid.snap === snapNow
  useEffect(() => {
    if (!dirtyLocal || status === "error" || blocked) return
    const tm = setTimeout(() => void save(), AUTOSAVE_MS)
    return () => clearTimeout(tm)
  }, [work, dirtyLocal, status, blocked, save])
  // error: retry every 4 s
  useEffect(() => {
    if (status !== "error") return
    const tm = setTimeout(() => {
      setStatus("saving")
      void save()
    }, 4000)
    return () => clearTimeout(tm)
  }, [status, save])

  // signed URLs: refresh 10 min before they expire (only `source` changes; the doc stays local)
  const expiresAt = q.data?.urlsExpireAt
  const refetch = q.refetch
  useEffect(() => {
    if (!expiresAt) return
    const ms = Math.max(5_000, new Date(expiresAt).getTime() - Date.now() - REFRESH_BEFORE_MS)
    const tm = setTimeout(() => void refetch(), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(tm)
  }, [expiresAt, refetch])

  // another tab/person saved (SSE editor.updated): clean copy = reload quietly; local changes = the next PUT gets EDIT_CONFLICT
  const r = remote.data
  const [seenRemote, setSeenRemote] = useState<typeof r>(null)
  if (r && r !== seenRemote) {
    setSeenRemote(r)
    // own saves: the event arrives while saving (skipped) or after the response (revision already caught up)
    if (revision !== null && r.revision > revision && !dirtyLocal && status !== "saving") setReload("remote")
  }
  useEffect(() => {
    if (!reload) return
    if (reload === "remote" && r) onToast({ key: "toast.remoteLoaded", values: { name: r.savedBy.name } })
    void qc.invalidateQueries({ queryKey: qk.editor(id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  // ── history
  const begin = useCallback((label: string) => {
    const w = workRef.current
    if (!w) return
    typingField.current = null
    setHistory({ past: [...histRef.current.past.slice(-99), { label, work: w }], future: [] })
    setChanges((n) => n + 1)
  }, [setHistory])
  const live = useCallback((fn: (w: Work) => Work) => {
    setWork((w) => {
      if (!w) return w
      const n = fn(w)
      workRef.current = n
      return n
    })
  }, [])
  const commit = useCallback((label: string, fn: (w: Work) => Work) => {
    begin(label)
    live(fn)
  }, [begin, live])
  /** Text fields: one history step per field focus, not per keystroke. */
  const typing = useCallback((field: string, label: string, fn: (w: Work) => Work) => {
    if (typingField.current !== field) {
      begin(label)
      typingField.current = field
    }
    live(fn)
  }, [begin, live])
  const endTyping = useCallback(() => {
    typingField.current = null
  }, [])
  const undo = useCallback((): string | null => {
    const w = workRef.current
    const h = histRef.current
    const last = h.past[h.past.length - 1]
    typingField.current = null
    if (!last || !w) return null
    workRef.current = last.work
    setWork(last.work)
    setHistory({ past: h.past.slice(0, -1), future: [...h.future, { label: last.label, work: w }] })
    return last.label
  }, [setHistory])
  const redo = useCallback((): string | null => {
    const w = workRef.current
    const h = histRef.current
    const next = h.future[h.future.length - 1]
    typingField.current = null
    if (!next || !w) return null
    workRef.current = next.work
    setWork(next.work)
    setHistory({ past: [...h.past, { label: next.label, work: w }], future: h.future.slice(0, -1) })
    return next.label
  }, [setHistory])

  // ── export = POST /render (save first)
  const exportMut = useMutation({
    mutationFn: async () => {
      await save()
      return api.edit.render(id)
    },
    onSuccess: (rd) => {
      setChanges(0)
      qc.setQueryData<EditResponse>(qk.edit(id), (p) => (p ? { ...p, dirty: false, latestRender: rd } : p))
      qc.invalidateQueries({ queryKey: qk.creative(id) })
    },
  })

  const latest = edit.data?.latestRender ?? null
  const rendering = latest?.status === "QUEUED" || latest?.status === "RENDERING"
  const exportFailed = latest?.status === "FAILED"
  const notExported = dirtyLocal || changes > 0 || !!edit.data?.dirty

  return useMemo(
    () => ({
      q, edit, state: q.data ?? null, work, revision, status: (blocked ? "invalid" : status === "invalid" ? "saving" : status) as SaveStatus,
      invalidRule: blocked ? invalid!.rule : null, dirtyLocal, conflict, clearConflict: () => setConflict(null),
      canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, undoLabel: hist.past[hist.past.length - 1]?.label ?? null,
      redoLabel: hist.future[hist.future.length - 1]?.label ?? null,
      begin, live, commit, typing, endTyping, undo, redo, save,
      exportMut, latest, rendering, exportFailed, changes, notExported,
    }),
    [q, edit, work, revision, status, blocked, invalid, dirtyLocal, conflict, hist, begin, live, commit, typing, endTyping, undo, redo, save, exportMut, latest, rendering, exportFailed, changes, notExported]
  )
}
export type EditorSession = ReturnType<typeof useEditorSession>

const mq = "(max-width: 760px)"
/** Phone layout (spec §7: ≤ 760 px): no handles, no timeline drags (D4). */
export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(mq)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(mq).matches,
    () => false
  )
}
