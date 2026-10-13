"use client"

import { useCallback, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled"
const MockStarter = MOCKING ? dynamic(() => import("./mock-starter"), { ssr: false }) : null

/** Starts the MSW worker before anything calls the API (mock mode only, F1/F2). */
export function MockGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!MOCKING)
  const onReady = useCallback(() => setReady(true), [])
  return (
    <>
      {MockStarter && !ready ? <MockStarter onReady={onReady} /> : null}
      {ready ? children : null}
    </>
  )
}
