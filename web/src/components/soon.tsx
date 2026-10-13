"use client"

import { useTranslations } from "next-intl"
import { NavIcon } from "@/components/shell/nav-icon"
import { cn } from "@/lib/utils"

/*
 * "Em breve" pattern (fase2-telas-novas §2.12). The badge is NEUTRAL (dashed, no status color):
 * Soon is not an error nor a warning. Faded content is `inert` + `aria-hidden` and never enters
 * counts, cost or validation.
 */

/** SOON badge. `mini` = the sidebar micro-tag (on ink). */
export function SoonBadge({ mini, className }: { mini?: boolean; className?: string }) {
  const t = useTranslations("soon")
  if (mini) {
    return (
      <span className={cn("ml-auto rounded-full border border-dashed border-ink-fg-3 px-1.5 font-mono text-[10px] tracking-[0.06em] text-ink-fg-3 uppercase", className)}>
        {t("badge")}
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex h-fit items-center gap-[5px] rounded-full border border-dashed border-control bg-card px-[9px] py-[3px] font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-fg-2 uppercase",
        className
      )}
    >
      <NavIcon name="clock" size={12} strokeWidth={2} />
      {t("badge")}
    </span>
  )
}

/** Striped EXAMPLE badge: marks numbers and names that are not the client's. */
export function ExampleBadge({ children, className }: { children?: React.ReactNode; className?: string }) {
  const t = useTranslations("soon")
  return (
    <span
      className={cn(
        "example-stripes rounded-full border border-line-strong px-[7px] py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-fg-2 uppercase",
        className
      )}
    >
      {children ?? t("example")}
    </span>
  )
}

/** Faded, non-interactive preview content. */
export function SoonBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("soon-body", className)} inert aria-hidden="true">
      {children}
    </div>
  )
}

/**
 * Block inside a working screen: dashed frame, SOON + one line of what it will do (+ EXAMPLE when it shows
 * numbers), then the faded content.
 */
export function SoonBlock({
  what,
  example,
  children,
  className,
}: {
  /** one line: what it does and what's missing. Bold the name with <b>. */
  what: React.ReactNode
  /** shows the EXAMPLE badge (true = default label) */
  example?: boolean | React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("relative flex min-w-0 flex-col gap-3 rounded-lg border border-dashed border-control bg-card-2 p-3.5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SoonBadge />
        <span className="min-w-0 flex-[1_1_260px] text-[13px] text-fg-2 [&_b]:text-fg">{what}</span>
        {example ? <ExampleBadge>{example === true ? undefined : example}</ExampleBadge> : null}
      </div>
      {children ? <SoonBody>{children}</SoonBody> : null}
    </section>
  )
}

/**
 * Whole section (Campaigns, Eddy, Connect Meta…): page title + SOON, a light card with one sentence of what
 * it will do and what's missing + the ways out that work today, and below the faded preview with the
 * "preview of what comes · example data" strip.
 */
export function SoonSection({
  title,
  eyebrow,
  heading,
  promise,
  actions,
  preview,
  exampleLabel,
}: {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  heading: React.ReactNode
  promise: React.ReactNode
  /** two exits to what works today (first one = brand button) */
  actions: React.ReactNode
  preview?: React.ReactNode
  /** strip label, e.g. "Example data · not Mooncloth's" */
  exampleLabel?: React.ReactNode
}) {
  const t = useTranslations("soon")
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-2">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1>{title}</h1>
          <SoonBadge />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-card p-4 tablet:p-[22px]">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5">
          <h2 className="wide text-xl">{heading}</h2>
          <p className="m-0 text-fg-3 text-pretty">{promise}</p>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {preview ? (
        <div className="flex flex-col gap-3.5 rounded-xl border border-dashed border-control bg-card-2 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="eyebrow">{t("previewOf")}</span>
            <ExampleBadge>{exampleLabel ?? t("exampleData")}</ExampleBadge>
          </div>
          <SoonBody className="flex flex-col gap-3.5">{preview}</SoonBody>
        </div>
      ) : null}
    </div>
  )
}

/** One entry point for both sizes: `section` (whole page) or `block` (inside a working screen). */
export function ComingSoon(
  props: ({ variant: "section" } & React.ComponentProps<typeof SoonSection>) | ({ variant: "block" } & React.ComponentProps<typeof SoonBlock>)
) {
  if (props.variant === "section") {
    const { variant: _v, ...rest } = props
    void _v
    return <SoonSection {...rest} />
  }
  const { variant: _v, ...rest } = props
  void _v
  return <SoonBlock {...rest} />
}
