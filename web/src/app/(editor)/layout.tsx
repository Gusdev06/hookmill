"use client"

import { SessionProvider } from "@/components/providers/session-provider"

/**
 * Full-page editors without the app sidebar (spec design/template-campanha-2026-11-02.md §2.2, "like Ads Manager when
 * creating"): only the session gate, no shell. Today: the campaign template editor.
 */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider fallback={<div className="min-h-dvh bg-bg" />}>{children}</SessionProvider>
}
