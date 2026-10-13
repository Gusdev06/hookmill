"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"

/** Engine model ids are opaque (contract §9); the label comes from GET /engines. */
export function useEngineLabel() {
  const { data } = useQuery({ queryKey: ["engines"], queryFn: api.engine.catalog, staleTime: Infinity })
  return (model: string | null) => {
    if (!model) return "—"
    for (const e of data?.engines ?? []) {
      const m = e.models.find((x) => x.id === model)
      if (m) return m.label
    }
    return model
  }
}
