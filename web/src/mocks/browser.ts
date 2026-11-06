import { delay, http } from "msw"
import { setupWorker } from "msw/browser"
import { handlers } from "./handlers"
import { API_URL } from "@/lib/api/client"

/**
 * ?mockslow=<ms> (skullet QA 04/11): every mocked API answer waits that much longer, so skeletons and reveals can be
 * seen on a "slow network" (DevTools throttling doesn't slow answers the service worker makes up). ?mockslow=off clears.
 * Returns nothing, so the request falls through to the real handler after the wait.
 */
const slow = http.all(`${API_URL}/*`, async () => {
  const ms = Number(sessionStorage.getItem("mock:slow"))
  if (ms > 0) await delay(ms)
})

export const worker = setupWorker(slow, ...handlers)
