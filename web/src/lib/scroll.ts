/**
 * Panel shell (31/10): from 761 px the page doesn't scroll; the central card (`#app-scroll`) does. Below that the window
 * scrolls as before. Use these instead of window.scrollTo / window "scroll" listeners.
 */
export const APP_SCROLL_ID = "app-scroll"

/** The element that scrolls the app content: the central card when it scrolls, else the window. */
export function appScroller(): HTMLElement | Window {
  if (typeof document === "undefined") return window
  const el = document.getElementById(APP_SCROLL_ID)
  return el && el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible" ? el : window
}

export function scrollAppTop() {
  const el = document.getElementById(APP_SCROLL_ID)
  if (el) el.scrollTo(0, 0)
  window.scrollTo(0, 0)
}
