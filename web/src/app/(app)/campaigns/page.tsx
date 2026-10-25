import { Suspense } from "react"
import { CampaignsScreen } from "@/components/campaigns/campaigns-screen"

/** Campaigns v1 (campanhas-v1.md): the real screen; META_MODE=off keeps the "Soon" page (decided inside the screen). */
export default function Page() {
  return (
    <Suspense>
      <CampaignsScreen />
    </Suspense>
  )
}
