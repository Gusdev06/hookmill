"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { HeadlineFitLook, HeadlineFitResult } from "@/lib/api/types"

/*
 * Live measure of a copied headline while the person types (troca-texto-queimado-v1 §14.4 "the web runs the same function when
 * typing and shows the step", §16.3). The function and its font tables load on demand (measure.ts); nothing here is in the initial
 * bundle besides these few lines.
 */

type Fit = (fit: HeadlineFitLook, text: string) => HeadlineFitResult
let loading: Promise<Fit> | null = null

/** Loads the measure once per tab (its own chunk). A failed load is retried on the next call. */
export function loadHeadlineFit(): Promise<Fit> {
  loading ??= import("./measure").then(
    (m) => m.ajustarHeadlineCopia as unknown as Fit,
    (e) => {
      loading = null
      throw e
    }
  )
  return loading
}

export type HeadlineFitState =
  | { status: "off" } // no `fit` (piece from before F1b, `add`, or not PLAN_READY): nothing to measure
  | { status: "loading" }
  | { status: "error" } // the chunk didn't load: the server still validates on save (422 TEXT_INVALID)
  | { status: "ready"; result: HeadlineFitResult }

/**
 * `ajustarHeadlineCopia(fit, text)` for the text being typed. The text is deferred, so typing never waits on the measure.
 * A text the function itself can't take (unknown font id, etc.) counts as `error`: the save path still has the API's verdict.
 */
export function useHeadlineFit(fit: HeadlineFitLook | null | undefined, text: string): HeadlineFitState {
  const [fn, setFn] = useState<{ f: Fit } | "error" | null>(null)
  const want = !!fit
  useEffect(() => {
    if (!want) return
    let alive = true
    loadHeadlineFit().then(
      (f) => alive && setFn({ f }),
      () => alive && setFn("error")
    )
    return () => {
      alive = false
    }
  }, [want])
  const deferred = useDeferredValue(text)
  return useMemo((): HeadlineFitState => {
    if (!fit) return { status: "off" }
    if (fn === "error") return { status: "error" }
    if (!fn) return { status: "loading" }
    try {
      return { status: "ready", result: fn.f(fit, deferred) }
    } catch {
      return { status: "error" }
    }
  }, [fit, fn, deferred])
}
