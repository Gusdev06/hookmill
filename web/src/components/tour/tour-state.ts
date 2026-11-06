/*
 * Tour position lives in sessionStorage (spec decision 9): closing the tab and coming back resumes on the same stop.
 * `tour:replay` marks a "Replay tour" (Settings / account menu): Esc allowed, nothing is posted at the end.
 * tour-v2 (04/11): the replay no longer pushes a fixed route; the provider navigates to its first stop. "Show tips again"
 * clears the tips seen (server + this device) and emits TIPS_RESET_EVENT so the open screens re-read them.
 */
export const TOUR_STEP_KEY = "tour:step"
export const TOUR_REPLAY_KEY = "tour:replay"
/** Tips dismissed on this device: a fallback while the API has no `tipsSeen` (and so a failed POST doesn't re-show it). */
export const TIPS_LOCAL_KEY = "tour:tips"
export const TIPS_RESET_EVENT = "tour:tips-reset"

export function readTourStep(): number {
  try {
    const v = Number(sessionStorage.getItem(TOUR_STEP_KEY))
    return Number.isFinite(v) && v >= 0 ? v : 0
  } catch {
    return 0
  }
}
export function writeTourStep(i: number) {
  try {
    sessionStorage.setItem(TOUR_STEP_KEY, String(i))
  } catch {}
}
export function clearTourStep() {
  try {
    sessionStorage.removeItem(TOUR_STEP_KEY)
  } catch {}
}
export function isReplay(): boolean {
  try {
    return sessionStorage.getItem(TOUR_REPLAY_KEY) === "1"
  } catch {
    return false
  }
}
/** "Replay tour": flags the replay and resets the position; the provider takes it to the first stop. */
export function startReplay() {
  try {
    sessionStorage.setItem(TOUR_REPLAY_KEY, "1")
    sessionStorage.setItem(TOUR_STEP_KEY, "0")
  } catch {}
  window.dispatchEvent(new Event(TOUR_REPLAY_KEY))
}
export function endReplay() {
  try {
    sessionStorage.removeItem(TOUR_REPLAY_KEY)
    sessionStorage.removeItem(TOUR_STEP_KEY)
  } catch {}
}

export function readLocalTips(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TIPS_LOCAL_KEY) ?? "[]")
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}
export function addLocalTip(tip: string) {
  try {
    const cur = readLocalTips()
    if (!cur.includes(tip)) localStorage.setItem(TIPS_LOCAL_KEY, JSON.stringify([...cur, tip]))
  } catch {}
}
/** "Show tips again" (local half; `useResetTips` also calls DELETE /workspace/tour/tips). */
export function resetTips() {
  try {
    localStorage.removeItem(TIPS_LOCAL_KEY)
  } catch {}
  window.dispatchEvent(new Event(TIPS_RESET_EVENT))
}
