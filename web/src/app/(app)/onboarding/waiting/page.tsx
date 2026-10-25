"use client"

import { SetupInProgress } from "@/components/onboarding/setup-in-progress"

/** /onboarding/waiting: the "Setup in progress" screen (MEMBER / CLIENT while the client is in SETUP). The gate also renders it on any route. */
export default function WaitingPage() {
  return <SetupInProgress />
}
