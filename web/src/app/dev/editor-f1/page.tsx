import { notFound } from "next/navigation"
import { PaginaTeste } from "./pagina-teste"

// Editor F1 gate (b): Player × renderStill (docs/contratos/editor-v1.md §10). Dev only.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound()
  return <PaginaTeste />
}
