"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { isApiError } from "@/lib/api/errors"
import type { EditBlockedDetails, EditConflictDetails, EditDocV3, EditIssue, EditorExportView, EditorStateV3 } from "@/lib/api/types"
import { qk } from "@/hooks/use-creative"
import { ik } from "@/hooks/use-iterate"
import { openCreativeStream } from "@/lib/sse"
import { docOrEmpty, isEmpty } from "./model"

/** error = transient (network/5xx), retried every 4 s · invalid = 400 (the doc breaks a structure rule): not resent as is */
export type SaveStatus = "saved" | "saving" | "error" | "invalid"
interface Entry { label: string; doc: EditDocV3 }

const AUTOSAVE_MS = 800 // editor-universal-v1 §6 / spec §6
const HISTORY = 100
const REFRESH_BEFORE_MS = 10 * 60_000
const snapOf = (d: EditDocV3 | null) => (isEmpty(d) ? "null" : JSON.stringify(d))
const isV3 = (x: unknown): x is EditorStateV3 => !!x && (x as { version?: number }).version === 3

/**
 * One session of the universal editor (§6, §7, §9, §10): GET state, the local doc, undo/redo (100 steps, one per gesture),
 * autosave 800 ms with baseRevision (saves even with red pills; the Export is what blocks), EDIT_CONFLICT without merge,
 * proxy "building" re-GET, signed-URL refresh, Export (POST …/editor/export) + Retry check, SSE editor.export + polling.
 */
export function useUniversalSession(id: string) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.editor(id), queryFn: () => api.editor.open(id), retry: false, refetchOnWindowFocus: false, staleTime: 60_000 })
  const st = isV3(q.data) ? q.data : null

  const [doc, setDoc] = useState<EditDocV3 | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [savedSnap, setSavedSnap] = useState("")
  const [seen, setSeen] = useState<EditorStateV3 | null>(null)
  const [hist, setHist] = useState<{ past: Entry[]; future: Entry[] }>({ past: [], future: [] })
  const [status, setStatus] = useState<SaveStatus>("saved")
  const [invalid, setInvalid] = useState<{ snap: string; rule: string } | null>(null)
  const [conflict, setConflict] = useState<EditConflictDetails | null>(null)
  const [reload, setReload] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [justExported, setJustExported] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<EditIssue[] | null>(null)

  // adopt server data during render (first load, "Load his version", quiet reload of a clean copy)
  if (st && st !== seen) {
    setSeen(st)
    const clean = !doc || snapOf(doc) === savedSnap
    if (!doc || reload || (clean && (revision === null || st.revision > revision))) {
      const d = docOrEmpty(st.doc)
      setDoc(d)
      setRevision(st.revision)
      setSavedSnap(snapOf(d))
      if (reload) {
        setReload(false)
        setConflict(null)
        setHist({ past: [], future: [] })
      }
    }
  }

  // refs for timers and handlers
  const docRef = useRef<EditDocV3 | null>(null)
  const revRef = useRef<number | null>(null)
  const savedRef = useRef("")
  const histRef = useRef(hist)
  const inflight = useRef<Promise<void> | null>(null)
  const typingField = useRef<string | null>(null)
  const conflictRef = useRef(false)
  useEffect(() => {
    docRef.current = doc
    revRef.current = revision
    savedRef.current = savedSnap
    histRef.current = hist
    conflictRef.current = !!conflict
  })

  const saveRef = useRef<() => Promise<void>>(async () => {})
  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      await inflight.current
      return saveRef.current()
    }
    const d = docRef.current
    if (!d || revRef.current === null || conflictRef.current) return
    const snap = snapOf(d)
    if (snap === savedRef.current) return
    setStatus("saving")
    const run = (async () => {
      try {
        const r = await api.editor.saveV3(id, { baseRevision: revRef.current!, doc: isEmpty(d) ? null : d })
        revRef.current = r.revision
        setRevision(r.revision)
        setSavedAt(r.savedAt)
        const now = docRef.current
        if (now && snapOf(now) === snap) {
          // nothing changed while saving: take the normalized doc (§5 normalizarDocV3)
          const n = docOrEmpty(r.doc)
          docRef.current = n
          savedRef.current = snapOf(n)
          setDoc(n)
          setSavedSnap(savedRef.current)
        } else {
          savedRef.current = snap
          setSavedSnap(snap)
        }
        setStatus("saved")
        setInvalid(null)
        // the card (pendingExport, Download off) and the Library follow the saved state
        qc.setQueryData<EditorStateV3>(qk.editor(id), (p) => (isV3(p) ? { ...p, revision: r.revision, doc: r.doc, issues: r.issues, dirty: true } : p))
      } catch (e) {
        if (isApiError(e) && e.code === "EDIT_CONFLICT") {
          setConflict((e.details ?? null) as EditConflictDetails | null)
          setStatus("saved")
        } else if (isApiError(e) && e.kind === "http" && e.status < 500 && (e.details as { reason?: string } | undefined)?.reason !== "export_running") {
          // not transient (400 rule, 402 locked, 403 role, 409 read_only): resending the same doc gets the same answer
          const d = e.details as { fields?: { rule?: string }[]; reason?: string } | undefined
          setInvalid({ snap, rule: d?.fields?.[0]?.rule ?? d?.reason ?? e.code })
          setStatus("invalid")
          if (d?.reason === "read_only") void qc.invalidateQueries({ queryKey: qk.editor(id) })
        } else {
          // network/5xx, or an export running: retry in 4 s
          setStatus("error")
        }
      } finally {
        inflight.current = null
      }
    })()
    inflight.current = run
    await run
  }, [id, qc])
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const snapNow = doc ? snapOf(doc) : ""
  const dirtyLocal = !!doc && snapNow !== savedSnap
  const isBlocked = !!invalid && invalid.snap === snapNow
  const readOnly = !!st?.readOnly
  useEffect(() => {
    if (!dirtyLocal || status === "error" || isBlocked || conflict || readOnly) return
    const tm = setTimeout(() => void save(), AUTOSAVE_MS)
    return () => clearTimeout(tm)
  }, [doc, dirtyLocal, status, isBlocked, conflict, readOnly, save])
  useEffect(() => {
    if (status !== "error") return
    const tm = setTimeout(() => void save(), 4000)
    return () => clearTimeout(tm)
  }, [status, save])

  // proxy 540p still building: GET again after etaSec, at most 3 times (§7.2)
  const proxyTries = useRef(0)
  const building = st?.proxy.status === "building"
  const eta = st?.proxy.etaSec ?? 3
  const refetch = q.refetch
  useEffect(() => {
    if (!building || proxyTries.current >= 3) return
    const tm = setTimeout(() => {
      proxyTries.current++
      void refetch()
    }, Math.max(1, eta) * 1000)
    return () => clearTimeout(tm)
  }, [building, eta, refetch, st])
  // signed URLs: refetch 10 min before they expire
  const expiresAt = st?.urlsExpireAt
  useEffect(() => {
    if (!expiresAt) return
    const ms = Math.max(5_000, new Date(expiresAt).getTime() - Date.now() - REFRESH_BEFORE_MS)
    const tm = setTimeout(() => void refetch(), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(tm)
  }, [expiresAt, refetch])

  // ── export: stage from the SSE (editor.export) and, as a fallback, the GET every 1.5 s while it runs
  const exp: EditorExportView | null = st?.export ?? null
  const running = !!exp && exp.stage !== "failed" && exp.stage !== "done"
  useEffect(() => {
    if (!running) return
    const tm = setInterval(() => void refetch(), 1500)
    return () => clearInterval(tm)
  }, [running, refetch])
  useEffect(() => {
    const close = openCreativeStream(id, (e) => {
      if (e.event === "editor.export") qc.setQueryData<EditorStateV3>(qk.editor(id), (p) => (isV3(p) ? { ...p, export: e.data } : p))
      if (e.event === "editor.export" && (e.data.stage === "done" || e.data.stage === "failed")) void refetch()
      // own saves: the event can arrive before the PUT answers (inflight); afterwards the revision already caught up
      if (e.event === "editor.updated" && !inflight.current && revRef.current !== null && e.data.revision > revRef.current) {
        if (snapOf(docRef.current) === savedRef.current) void refetch()
        else setConflict({ revision: e.data.revision, savedBy: e.data.savedBy, savedAt: e.data.savedAt })
      }
    })
    return close
  }, [id, qc, refetch])
  // export finished (export gone, exported = the revision we sent): success banner, batch/Library follow
  const sentRev = useRef<number | null>(null)
  const exportedRev = st?.exported?.revision ?? null
  useEffect(() => {
    if (sentRev.current !== null && !running && exportedRev === sentRev.current) {
      setJustExported(sentRev.current)
      sentRev.current = null
      void qc.invalidateQueries({ queryKey: ["library"] })
      if (st?.piece) void qc.invalidateQueries({ queryKey: ik.batch(st.piece.batchId) })
    }
  }, [running, exportedRev, qc, st?.piece])

  const exportMut = useMutation({
    mutationFn: async () => {
      await save()
      const rev = revRef.current
      // the save failed or conflicted: exporting now would render a revision that isn't the one on screen
      if (rev === null || snapOf(docRef.current) !== savedRef.current || conflictRef.current) throw new Error("not_saved")
      sentRev.current = rev
      setBlocked(null)
      setJustExported(null)
      return api.editor.export(id, { revision: rev })
    },
    onSuccess: (v) => qc.setQueryData<EditorStateV3>(qk.editor(id), (p) => (isV3(p) ? { ...p, export: v } : p)),
    onError: (e) => {
      sentRev.current = null
      if (isApiError(e) && e.code === "EDIT_BLOCKED") setBlocked(((e.details as unknown as EditBlockedDetails | undefined)?.issues ?? []))
      if (isApiError(e) && e.code === "EDIT_CONFLICT") setConflict((e.details ?? null) as EditConflictDetails | null)
      // the saved doc went back to the exported one (`dirty` is only known by the server): take the fresh state
      if (isApiError(e) && (e.details as { reason?: string } | undefined)?.reason === "nothing_to_export") void refetch()
    },
  })
  const recheckMut = useMutation({
    mutationFn: () => {
      sentRev.current = st?.export?.revision ?? null
      return api.editor.recheck(id)
    },
    onSuccess: (v) => qc.setQueryData<EditorStateV3>(qk.editor(id), (p) => (isV3(p) ? { ...p, export: v } : p)),
    onError: () => {
      sentRev.current = null
      void refetch()
    },
  })

  // ── history: one step per finished gesture
  const begin = useCallback((label: string) => {
    const d = docRef.current
    if (!d) return
    typingField.current = null
    const h = { past: [...histRef.current.past.slice(-(HISTORY - 1)), { label, doc: d }], future: [] }
    histRef.current = h
    setHist(h)
  }, [])
  const live = useCallback((fn: (d: EditDocV3) => EditDocV3) => {
    const d = docRef.current
    if (!d) return
    const n = fn(d)
    docRef.current = n
    setDoc(n)
  }, [])
  const commit = useCallback((label: string, fn: (d: EditDocV3) => EditDocV3) => {
    begin(label)
    live(fn)
  }, [begin, live])
  const typing = useCallback((field: string, label: string, fn: (d: EditDocV3) => EditDocV3) => {
    if (typingField.current !== field) {
      begin(label)
      typingField.current = field
    }
    live(fn)
  }, [begin, live])
  const endTyping = useCallback(() => {
    typingField.current = null
  }, [])
  const step = useCallback((from: "past" | "future") => {
    const d = docRef.current
    const h = histRef.current
    const src = h[from]
    const e = src[src.length - 1]
    typingField.current = null
    if (!e || !d) return null
    docRef.current = e.doc
    setDoc(e.doc)
    const back = { label: e.label, doc: d }
    const nh = from === "past" ? { past: h.past.slice(0, -1), future: [...h.future, back] } : { past: [...h.past, back], future: h.future.slice(0, -1) }
    histRef.current = nh
    setHist(nh)
    return e.label
  }, [])
  const undo = useCallback(() => step("past"), [step])
  const redo = useCallback(() => step("future"), [step])

  /** "Load his version": GET again and drop the local copy (no merge, editor-v1). */
  const loadTheirs = useCallback(() => {
    setReload(true)
    setInvalid(null)
    setStatus("saved")
    void qc.invalidateQueries({ queryKey: qk.editor(id) })
  }, [qc, id])

  return useMemo(
    () => ({
      q, st, doc, revision, status: (isBlocked ? "invalid" : status === "invalid" ? "saving" : status) as SaveStatus, invalidRule: isBlocked ? invalid!.rule : null,
      dirtyLocal, savedAt, conflict, readOnly, building,
      canUndo: hist.past.length > 0, canRedo: hist.future.length > 0,
      begin, live, commit, typing, endTyping, undo, redo, save, loadTheirs,
      exp, running, exportMut, recheckMut, justExported, clearJustExported: () => setJustExported(null), blocked,
    }),
    [q, st, doc, revision, status, isBlocked, invalid, dirtyLocal, savedAt, conflict, readOnly, building, hist, begin, live, commit, typing, endTyping, undo, redo, save, loadTheirs, exp, running, exportMut, recheckMut, justExported, blocked]
  )
}
export type UniversalSession = ReturnType<typeof useUniversalSession>
