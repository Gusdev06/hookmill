"use client"

import { useEffect } from "react"
import { worker } from "@/mocks/browser"
import { captureScenarioFromUrl } from "@/mocks/scenario"

// StrictMode runs effects twice in dev; msw 3 throws if start() runs on an already started worker
let started: Promise<unknown> | null = null

/** Browser-only (loaded with ssr:false): msw/browser has no server build. */
export default function MockStarter({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    captureScenarioFromUrl()
    started ??= worker.start({ onUnhandledFrame: "bypass", quiet: true })
    started.then(onReady)
  }, [onReady])
  return null
}
