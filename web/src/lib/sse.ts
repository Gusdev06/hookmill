"use client"

import type { CreativeEvent } from "@/lib/api/types"
import { api } from "@/lib/api/client"
import { getAccessToken, refreshSession } from "@/lib/session/token"

/**
 * SSE of a creative (eventos.md §1). EventSource can't send the Bearer header, so this reads the
 * stream with fetch. Reconnects with backoff; every (re)connect starts with a `snapshot`, and
 * `onReconnect` lets the caller refetch what may have been missed (there is no replay).
 */
export function openCreativeStream(
  creativeId: string,
  onEvent: (e: CreativeEvent) => void,
  opts: { onStatus?: (s: "open" | "retrying") => void; onReconnect?: () => void } = {}
) {
  const ctrl = new AbortController()
  let attempt = 0

  const run = async () => {
    while (!ctrl.signal.aborted) {
      try {
        const token = await getAccessToken()
        const res = await fetch(api.creatives.eventsUrl(creativeId), {
          headers: { Accept: "text/event-stream", Authorization: `Bearer ${token ?? ""}` },
          signal: ctrl.signal,
          cache: "no-store",
        })
        if (res.status === 401) {
          await refreshSession()
          throw new Error("unauthorized")
        }
        if (res.status === 404) return
        if (!res.ok || !res.body) throw new Error(`sse ${res.status}`)
        if (attempt > 0) opts.onReconnect?.()
        attempt = 0
        opts.onStatus?.("open")
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ""
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let i: number
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i)
            buf = buf.slice(i + 2)
            let event = "message"
            const data: string[] = []
            for (const line of chunk.split("\n")) {
              if (line.startsWith(":")) continue
              if (line.startsWith("event:")) event = line.slice(6).trim()
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
            }
            if (!data.length) continue
            try {
              onEvent({ event, data: JSON.parse(data.join("\n")) } as CreativeEvent)
            } catch {
              /* malformed event: ignore, the next GET fixes the screen */
            }
          }
        }
      } catch {
        if (ctrl.signal.aborted) return
      }
      if (ctrl.signal.aborted) return
      opts.onStatus?.("retrying")
      attempt += 1
      await new Promise((r) => setTimeout(r, Math.min(10_000, 800 * 2 ** Math.min(attempt, 4))))
    }
  }
  void run()
  return () => ctrl.abort()
}
