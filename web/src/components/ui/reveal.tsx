"use client"

import { useTranslations } from "next-intl"
import { Skeleton, SkulletProvider, type SkeletonProps } from "skullet/react"

/**
 * skullet (04/11): a skeleton measured from the real content, rendered with a `sample` while `data` is null.
 * Colors, radius and reduced motion come from the --skullet-* tokens in globals.css (they follow .on-ink / .on-light).
 * `id` remembers the shape across visits; `label` (default "Loading…") is what a screen reader hears.
 * Client-only: skullet ships "use client", and every caller here is a client component.
 */
export function Reveal<T>(props: SkeletonProps<T>) {
  const t = useTranslations("common")
  return <Skeleton<T> {...props} label={props.label ?? t("loading")} />
}

/** Once per tree: the server-render measuring script is sent once instead of per skeleton. */
export function RevealProvider({ children }: { children: React.ReactNode }) {
  return <SkulletProvider>{children}</SkulletProvider>
}
