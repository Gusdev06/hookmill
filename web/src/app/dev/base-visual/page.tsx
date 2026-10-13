import { notFound } from "next/navigation"
import { Vitrine } from "./vitrine"

// F2 base visual: FlowBar, WizardRail, AdFrame and the Soon pattern side by side (fase2-telas-novas §4). Dev only.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound()
  return <Vitrine />
}
