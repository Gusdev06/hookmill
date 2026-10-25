/*
 * Tour position lives in sessionStorage (spec decision 9): closing the tab and coming back resumes on the same stop.
 * `tour:replay` marks a "Replay tour" (Settings / account menu): skip and Esc allowed, nothing is posted at the end.
 */
export const TOUR_STEP_KEY = "tour:step"
export const TOUR_REPLAY_KEY = "tour:replay"

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
/** Settings → "Replay tour": flags the replay, resets the position and goes to the first stop. */
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
