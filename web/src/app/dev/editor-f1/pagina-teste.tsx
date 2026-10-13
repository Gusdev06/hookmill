"use client"

import dynamic from "next/dynamic"

// The Player only runs in the browser: reads location.search and window, no SSR.
export const PaginaTeste = dynamic(() => import("./player-teste"), { ssr: false })
