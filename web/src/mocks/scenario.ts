import { delay } from "msw"
/**
 * Mock-only screen states, so every empty / loading / error state can be checked in the browser.
 * Open any page with ?mock=empty | loading | error (remembered for the tab); ?mock=off clears it.
 */
export type Scenario = "empty" | "loading" | "error" | null
const KEY = "mock:scenario"

export function captureScenarioFromUrl() {
  const v = new URLSearchParams(window.location.search).get("mock")
  if (v === "off") sessionStorage.removeItem(KEY)
  else if (v === "empty" || v === "loading" || v === "error") sessionStorage.setItem(KEY, v)
  // feature 2: ?adlib=off simulates the Ad Library reader at its limit (GET /champions/config); ?adlib=on clears it
  const a = new URLSearchParams(window.location.search).get("adlib")
  if (a === "off") sessionStorage.setItem("mock:adlib", "off")
  else if (a === "on") sessionStorage.removeItem("mock:adlib")
}

export function scenario(): Scenario {
  if (typeof window === "undefined") return null
  const v = sessionStorage.getItem(KEY)
  return v === "empty" || v === "loading" || v === "error" ? v : null
}

/** List scenarios (?mock=empty|loading|error). `error`: first answer works, later ones time out (> 10 s). */
const calls = new Map<string, number>()
export async function listScenario(key: string) {
  const s = scenario()
  const n = (calls.get(key) ?? 0) + 1
  calls.set(key, n)
  if (s === "loading") await delay("infinite")
  if (s === "error" && n > 1) await delay(11_000)
  await delay(200)
  return s
}
