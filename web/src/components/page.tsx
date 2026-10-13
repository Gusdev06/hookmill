import { cn } from "@/lib/utils"

/** mockup .page / .page-head / .sec */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-[22px] px-[var(--gut)] pt-5 pb-16 tablet:gap-7 tablet:pt-7", className)}>
      {children}
    </div>
  )
}

export function PageHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1>{title}</h1>
        {sub ? <p className="mt-1 text-fg-2">{sub}</p> : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-stretch gap-2 tablet:basis-0 tablet:flex-nowrap tablet:justify-end">{actions}</div>
      ) : null}
    </div>
  )
}

export function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("grid grid-cols-[minmax(0,1fr)] gap-3", className)}>{children}</section>
}

export function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 font-mono text-xs font-normal text-fg-3">{children}</span>
}

/** mockup .empty: dashed box, 12px radius */
export function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-5 rounded-xl border border-dashed border-line-2 px-[clamp(16px,5vw,48px)] py-10", className)}>
      {children}
    </div>
  )
}

/** mockup .panel */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 rounded-lg border border-line bg-surface p-4", className)}>{children}</div>
}

export function PanelHead({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>
}

export function Tag({ children, tone, dashed }: { children: React.ReactNode; tone?: "amber"; dashed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-line px-[7px] py-px text-xs whitespace-nowrap text-fg-2 [&_svg]:size-3.5",
        dashed && "border-dashed",
        tone === "amber" && "border-transparent bg-status-waiting-bg text-status-waiting"
      )}
    >
      {children}
    </span>
  )
}
