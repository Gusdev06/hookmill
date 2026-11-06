import { delay } from "msw"
import { captureAccessFromUrl } from "./amostra"
/**
 * Mock-only screen states, so every empty / loading / error state can be checked in the browser.
 * Open any page with ?mock=empty | loading | error (remembered for the tab); ?mock=off clears it.
 */
export type Scenario = "empty" | "loading" | "error" | null
const KEY = "mock:scenario"

export function captureScenarioFromUrl() {
  captureAccessFromUrl()
  const v = new URLSearchParams(window.location.search).get("mock")
  if (v === "off") sessionStorage.removeItem(KEY)
  else if (v === "empty" || v === "loading" || v === "error") sessionStorage.setItem(KEY, v)
  // feature 2: ?adlib=off simulates the Ad Library reader at its limit (GET /champions/config); ?adlib=on clears it
  // meta-v1 mock states: ?metamock=stale|failed|expired|off|none (never connected)|perm (permission missing) (sessionStorage mock:meta); ?metamock=on clears it
  const mm = new URLSearchParams(window.location.search).get("metamock")
  if (mm === "on") sessionStorage.removeItem("mock:meta")
  // campanhas-v1: + unusable (account disabled) · trunc (500+ per level) · nocamp (no campaigns in the account) · meta-oferta-v1: posts (no readable link)
  else if (mm && ["stale", "failed", "expired", "off", "unusable", "trunc", "nocamp", "none", "perm", "connected", "posts"].includes(mm)) sessionStorage.setItem("mock:meta", mm)
  // template-campanha F4 (QA 03/11): ?mocktpl=list422 → GET /meta/templates answers 422 META_TOKEN_INVALID while expired; =off clears
  const mtp = new URLSearchParams(window.location.search).get("mocktpl")
  if (mtp === "off") sessionStorage.removeItem("mock:tpl")
  else if (mtp === "list422") sessionStorage.setItem("mock:tpl", mtp)
  // campanhas-v1 QA: ?mockrole=member|client shows the Campaigns screen (and the write handlers) as that role; =off clears
  const mp = new URLSearchParams(window.location.search).get("mockpage")
  if (mp === "off") sessionStorage.removeItem("mock:page")
  else if (mp && Number(mp) > 0) sessionStorage.setItem("mock:page", mp)
  const mr = new URLSearchParams(window.location.search).get("mockrole")
  if (mr === "off") sessionStorage.removeItem("mock:role")
  else if (mr === "member" || mr === "client") sessionStorage.setItem("mock:role", mr.toUpperCase())
  // estatico-montado-e-molduras-v1 (web-mock only): ?mocktext=ok|minor|critical|extra|retake|skipped|cap forces the STATIC text check of
  // the batch's 9:16 (cap = minor + Retry answers SPEND_CAP_EXCEEDED); ?mocktext=off clears. ?mockframes=all plans all 18 frames; =off clears
  const mt = new URLSearchParams(window.location.search).get("mocktext")
  if (mt === "off") sessionStorage.removeItem("mock:text")
  else if (mt && ["ok", "minor", "critical", "extra", "retake", "skipped", "cap"].includes(mt)) sessionStorage.setItem("mock:text", mt)
  const mf = new URLSearchParams(window.location.search).get("mockframes")
  if (mf === "off") sessionStorage.removeItem("mock:frames")
  else if (mf === "all") sessionStorage.setItem("mock:frames", "all")
  // legenda-protegida-v1 (web-mock): ?mockcaptions=burned|covered|legacy (champion with burned-in captions; covered = the 1st FRAME's 1st render fails CAPTION_COVERED; legacy = pieces made before F1a, with the retired fields); =off clears
  const mc = new URLSearchParams(window.location.search).get("mockcaptions")
  if (mc === "off") sessionStorage.removeItem("mock:captions")
  else if (mc === "burned" || mc === "covered" || mc === "legacy") sessionStorage.setItem("mock:captions", mc)
  // troca-texto-queimado-v1 §16 (F1b, web-mock): ?mockheadline=box|loose|close (the champion's headline is copied: box, erased +
  // redrawn with the `preparing_plate` wait, or loose with "Closest font") or a blocked reason: pending|near_caption|font_far|
  // plate_rejected|no_fit|over_face|moves|low_confidence; =off clears (the F1a default: headline_pending)
  const mh = new URLSearchParams(window.location.search).get("mockheadline")
  if (mh === "off") sessionStorage.removeItem("mock:headline")
  else if (mh && ["box", "loose", "close", "pending", "near_caption", "font_far", "plate_rejected", "no_fit", "over_face", "moves", "low_confidence"].includes(mh)) sessionStorage.setItem("mock:headline", mh)
  const ms = new URLSearchParams(window.location.search).get("mockslow")
  if (ms === "off") sessionStorage.removeItem("mock:slow")
  else if (ms && Number(ms) > 0) sessionStorage.setItem("mock:slow", ms)
  const a = new URLSearchParams(window.location.search).get("adlib")
  // ?adlib=hidden: AD_LIBRARY_MODE=off in production (R11, not_configured): the champion step hides the link field
  if (a === "off" || a === "hidden") sessionStorage.setItem("mock:adlib", a)
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
