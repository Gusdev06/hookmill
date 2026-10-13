"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { Toaster } from "sonner"
import { isApiError } from "@/lib/api/errors"
import { MockGate } from "./mock-gate"
import { useToastPosition } from "@/lib/toast-position"

export function Providers({ children }: { children: ReactNode }) {
  const toastPos = useToastPosition()
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (n, e) => n < 1 && !(isApiError(e) && (e.status === 401 || e.status === 404 || e.kind === "timeout")),
          },
        },
      })
  )
  return (
    <MockGate>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
      {/* mockup .toast: white pill, dark text, bottom center above the action bar */}
      <Toaster
        position={toastPos === "top" ? "top-center" : "bottom-center"}
        offset={toastPos === "top" ? { top: "calc(var(--hdr-h, 94px) + 12px)" } : { bottom: "calc(var(--toast-bottom, 16px) + env(safe-area-inset-bottom, 0px))" }}
        mobileOffset={toastPos === "top" ? { top: "calc(var(--hdr-h, 94px) + 12px)" } : { bottom: "calc(var(--toast-bottom, 16px) + env(safe-area-inset-bottom, 0px))" }}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "flex w-max max-w-[calc(100vw-32px)] items-center gap-2 rounded-btn bg-ink px-4 py-3 text-[13px] font-semibold text-ink-fg shadow-[0_8px_30px_rgba(0,0,0,.25)]",
            title: "flex items-center gap-2",
          },
        }}
      />
    </MockGate>
  )
}
