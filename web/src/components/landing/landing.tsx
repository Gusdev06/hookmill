import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { buttonVariants } from "@/components/ui/button"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"
import { cn } from "@/lib/utils"
import "./landing.css"

type T = Awaited<ReturnType<typeof getTranslations<"landing">>>
type Step = { t: string; d: string }

/**
 * Public landing (fase2-cadastro §4.4). Only what the product does today; anything not built
 * is in "Coming soon" (neutral dashed badge, F0 §2.12). Example data is labeled as such.
 * No prices, results, testimonials or client logos.
 */
export async function Landing() {
  const t = await getTranslations("landing")
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-card focus:px-3 focus:py-2">
        {t("nav.skip")}
      </a>
      <Header t={t} />
      <main id="main">
        <Hero t={t} />
        <Paths t={t} />
        <Bento t={t} />
        <Agencies t={t} />
        <Soon t={t} />
        <FinalCta t={t} />
      </main>
      <Footer t={t} />
    </div>
  )
}

const wrap = "mx-auto w-full max-w-[1376px] px-[var(--gut)]"

function Wordmark({ t }: { t: T }) {
  return (
    <Link href="/" aria-label={t("nav.home")} className="flex items-center gap-2.5 rounded-sm">
      <LogoMark />
      <span className="text-[15px] font-extrabold tracking-[-0.01em] [font-stretch:125%]">HookMill</span>
    </Link>
  )
}

function Header({ t }: { t: T }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-bg/85 backdrop-blur-md">
      <div className={cn(wrap, "flex h-14 items-center justify-between gap-3 tablet:h-16")}>
        <Wordmark t={t} />
        <nav className="flex items-center gap-1.5 tablet:gap-2" aria-label="Account">
          <LanguageToggle className="mr-1 tablet:mr-2" />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm", className: "px-2.5 tablet:px-3" })}>
            {t("nav.logIn")}
          </Link>
          <Link href="/signup" className={cn(buttonVariants({ variant: "default", size: "sm" }), "max-tablet:hidden")}>
            {t("nav.createAccount")}
          </Link>
        </nav>
      </div>
    </header>
  )
}

/* ───────── hero: the thesis + the batch panel (signature) */
function Hero({ t }: { t: T }) {
  return (
    <section className={cn(wrap, "pt-10 pb-16 tablet:pt-20 tablet:pb-24")}>
      <p className="lp-eyebrow">{t("hero.eyebrow")}</p>
      <h1 className="lp-display lp-h1 mt-4 max-w-[15.5em]">
        {t("hero.titleA")} <span className="text-fg-3">{t("hero.titleB")}</span>
      </h1>
      <div className="mt-8 grid gap-10 desktop:mt-12 desktop:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] desktop:gap-14">
        <div className="flex flex-col gap-6 desktop:pt-2">
          <p className="max-w-[34em] text-[16px] leading-relaxed text-fg-2 tablet:text-[17px]">{t("hero.sub")}</p>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/signup" className={buttonVariants({ variant: "brand", size: "lg", className: "px-6" })}>
              {t("hero.ctaPrimary")}
            </Link>
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg", className: "px-6" })}>
              {t("hero.ctaSecondary")}
            </Link>
          </div>
          <p className="font-mono text-[11px] tracking-[0.04em] text-fg-3">{t("hero.note")}</p>
        </div>
        <BatchPanel t={t} />
      </div>
    </section>
  )
}

type RowState = "ready" | "generating" | "waiting"
const BATCH: { kind: "control" | "newFace" | "newHook"; file: string; state: RowState; tone: [string, string, string] }[] = [
  { kind: "control", file: "MC_ITER_1012_CTRL_ORIG_9x16", state: "ready", tone: ["#4b5059", "#2f343b", "#1f2227"] },
  { kind: "newFace", file: "MC_ITER_1012_AV01_F1_9x16", state: "ready", tone: ["#5b5348", "#33302c", "#201f1d"] },
  { kind: "newFace", file: "MC_ITER_1012_AV02_F2_9x16", state: "generating", tone: ["#424b5e", "#2a303b", "#1d2027"] },
  { kind: "newHook", file: "MC_ITER_1012_H01_ORIG_9x16", state: "waiting", tone: ["#4b5059", "#2f343b", "#1f2227"] },
  { kind: "newHook", file: "MC_ITER_1012_H02_ORIG_9x16", state: "generating", tone: ["#4b5059", "#2f343b", "#1f2227"] },
]

function Thumb({ tone, className }: { tone: [string, string, string]; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("lp-thumb block aspect-[9/16] flex-none rounded-[6px] border border-ink-line", className)}
      style={{ "--t1": tone[0], "--t2": tone[1], "--t3": tone[2] } as React.CSSProperties}
    />
  )
}

function StateChip({ state, t }: { state: RowState; t: T }) {
  const cls =
    state === "ready"
      ? "text-[#7fd6a5] before:bg-ok-dot"
      : state === "generating"
        ? "text-info-on-ink before:bg-info-on-ink before:animate-[pulse_1.6s_ease-in-out_infinite]"
        : "text-[#f3d27a] before:bg-[#d39b12]"
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10.5px] whitespace-nowrap uppercase tracking-[0.06em] before:size-1.5 before:rounded-full before:content-['']", cls)}>
      {t(`panel.${state}`)}
    </span>
  )
}

function BatchPanel({ t }: { t: T }) {
  return (
    <figure className="on-ink relative m-0 overflow-hidden rounded-xl border border-ink-line bg-ink p-4 shadow-[0_30px_80px_-30px_rgba(22,24,27,.55)] tablet:p-6" aria-label={`${t("panel.label")} (${t("panel.example")})`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-fg-3 uppercase">{t("panel.label")}</span>
        <span className="rounded-full border border-dashed border-ink-fg-3/60 px-2 py-px font-mono text-[10px] tracking-[0.08em] text-ink-fg-3 uppercase">{t("panel.example")}</span>
      </div>

      {/* the winner going in */}
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-ink-line bg-ink-2 p-3">
        <Thumb tone={["#6b6f3a", "#3b3f22", "#22251a"]} className="w-9 tablet:w-11" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <b className="text-[13px] text-ink-fg">{t("panel.winner")}</b>
            <span className="truncate font-mono text-[11px] text-ink-fg-3">MC_NEW_0930_A_F1_9x16.mp4</span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-ink-fg-2">{t("panel.winnerNote")}</p>
        </div>
      </div>

      <div aria-hidden="true" className="ml-[26px] h-4 w-px bg-ink-line tablet:ml-[30px]" />

      <ul className="grid gap-1.5">
        {BATCH.map((r, i) => (
          <li key={r.file} className="lp-row flex items-center gap-3 rounded-lg border border-ink-line bg-ink-2/60 px-3 py-2.5" style={{ "--i": i } as React.CSSProperties}>
            <Thumb tone={r.tone} className="w-7 tablet:w-8" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <b className="flex-none text-[13px] text-ink-fg">{t(`panel.${r.kind}`)}</b>
                {r.kind === "control" ? <span className="truncate text-[12px] text-ink-fg-3">{t("panel.controlNote")}</span> : null}
              </div>
              <span className="truncate font-mono text-[11px] text-ink-fg-3">{r.file}.mp4</span>
              {r.state === "generating" ? (
                <span className="lp-bar mt-1 block h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-ink-3" style={{ "--i": i } as React.CSSProperties}>
                  <span />
                </span>
              ) : null}
            </div>
            <StateChip state={r.state} t={t} />
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-[12.5px] leading-snug text-ink-fg-3">{t("panel.foot")}</figcaption>
    </figure>
  )
}

/* ───────── how it works: the two real flows (order matters, so the steps are numbered) */
function Paths({ t }: { t: T }) {
  return (
    <section className="border-t border-line bg-card" aria-labelledby="paths-title">
      <div className={cn(wrap, "py-16 tablet:py-24")}>
        <p className="lp-eyebrow">{t("paths.eyebrow")}</p>
        <h2 id="paths-title" className="lp-display lp-h2 mt-3 max-w-[18em]">
          {t("paths.title")}
        </h2>
        <div className="mt-10 grid gap-4 desktop:mt-14 desktop:grid-cols-2 desktop:gap-6">
          <PathCard t={t} id="iterate" />
          <PathCard t={t} id="scratch" />
        </div>
      </div>
    </section>
  )
}

function PathCard({ t, id }: { t: T; id: "iterate" | "scratch" }) {
  const steps = t.raw(`paths.${id}.steps`) as Step[]
  return (
    <article className="flex flex-col rounded-xl border border-line bg-bg p-5 tablet:p-8">
      <span className="font-mono text-[11px] tracking-[0.1em] text-fg-3 uppercase">{t(`paths.${id}.tag`)}</span>
      <h3 className="mt-2 text-[24px] leading-tight font-extrabold tracking-[-0.02em] [font-stretch:125%] tablet:text-[30px]">{t(`paths.${id}.title`)}</h3>
      <p className="mt-2 max-w-[36em] text-[15px] text-fg-2">{t(`paths.${id}.sub`)}</p>
      <ol className="mt-6 grid gap-0 border-t border-line">
        {steps.map((s, i) => (
          <li key={s.t} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 border-b border-line-soft py-3 tablet:grid-cols-[34px_minmax(0,9rem)_minmax(0,1fr)] tablet:items-baseline">
            <span className="num font-mono text-[12px] text-fg-3">{String(i + 1).padStart(2, "0")}</span>
            <b className="text-[14.5px] font-bold">{s.t}</b>
            <span className="col-start-2 text-[14px] text-fg-2 tablet:col-start-3">{s.d}</span>
          </li>
        ))}
      </ol>
    </article>
  )
}

/* ───────── bento */
function Bento({ t }: { t: T }) {
  const brainRows = t.raw("bento.brain.rows") as string[]
  const parts = t.raw("bento.names.parts") as string[]
  const file = ["MC", "NEW", "1012", "A", "F2", "9x16"]
  return (
    <section aria-labelledby="bento-title">
      <div className={cn(wrap, "py-16 tablet:py-24")}>
        <p className="lp-eyebrow">{t("bento.eyebrow")}</p>
        <h2 id="bento-title" className="lp-display lp-h2 mt-3 max-w-[16em]">
          {t("bento.title")}
        </h2>
        <div className="mt-10 grid gap-3 desktop:mt-14 desktop:grid-cols-12 desktop:gap-4">
          {/* Brain: the big ink tile */}
          <article className="on-ink flex flex-col justify-between gap-8 rounded-xl bg-ink p-6 desktop:col-span-7 desktop:row-span-2 desktop:p-8">
            <div>
              <h3 className="text-[22px] leading-tight font-extrabold tracking-[-0.015em] text-ink-fg [font-stretch:125%] tablet:text-[26px]">{t("bento.brain.title")}</h3>
              <p className="mt-3 max-w-[34em] text-[15px] text-ink-fg-2">{t("bento.brain.body")}</p>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-ink-line bg-ink-line" aria-hidden="true">
              {brainRows.map((r, i) => {
                const ok = i !== 2
                return (
                  <li key={r} className="flex items-center justify-between gap-3 bg-ink-2 px-4 py-3">
                    <span className="text-[14px] text-ink-fg">{r}</span>
                    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] uppercase before:size-1.5 before:rounded-full before:content-['']", ok ? "text-[#7fd6a5] before:bg-ok-dot" : "text-[#f3d27a] before:bg-[#d39b12]")}>
                      {ok ? t("bento.brain.ok") : t("bento.brain.partial")}
                    </span>
                  </li>
                )
              })}
            </ul>
          </article>

          {/* standardized file name */}
          <article className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6 desktop:col-span-5">
            <div>
              <h3 className="text-[18px] font-extrabold tracking-[-0.01em] [font-stretch:115%]">{t("bento.names.title")}</h3>
              <p className="mt-2 text-[14px] text-fg-2">{t("bento.names.body")}</p>
            </div>
            <div className="flex flex-wrap items-end gap-x-1 gap-y-3 font-mono" aria-hidden="true">
              {file.map((p, i) => (
                <span key={p} className="flex items-end gap-1">
                  <span className="grid gap-1">
                    <span className="text-[9.5px] tracking-[0.08em] text-fg-3 uppercase">{parts[i]}</span>
                    <span className={cn("rounded-[6px] border px-2 py-1 text-[14px] font-medium", i === 1 ? "border-brand-edge bg-brand-soft text-fg" : "border-line-strong bg-field")}>{p}</span>
                  </span>
                  {i < file.length - 1 ? <span className="pb-1.5 text-fg-3">_</span> : <span className="pb-1.5 text-fg-3">.mp4</span>}
                </span>
              ))}
            </div>
          </article>

          {/* honest waiting */}
          <article className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6 desktop:col-span-5">
            <div>
              <h3 className="text-[18px] font-extrabold tracking-[-0.01em] [font-stretch:115%]">{t("bento.wait.title")}</h3>
              <p className="mt-2 text-[14px] text-fg-2">{t("bento.wait.body")}</p>
            </div>
            <div className="grid gap-2 rounded-lg border border-status-progress-edge bg-status-progress-bg p-3.5" aria-hidden="true">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-status-progress">
                <span className="dot" data-status="progress" />
                {t("bento.wait.status")}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {[1, 1, 0.5, 0, 0].map((v, i) => (
                  <span key={i} className="h-1.5 overflow-hidden rounded-full bg-card">
                    <span className="block h-full rounded-full bg-status-progress" style={{ width: `${v * 100}%` }} />
                  </span>
                ))}
              </div>
              <span className="font-mono text-[11px] text-fg-3">{t("bento.wait.step")}</span>
            </div>
          </article>

          {/* editor */}
          <article className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6 desktop:col-span-7">
            <div>
              <h3 className="text-[18px] font-extrabold tracking-[-0.01em] [font-stretch:115%]">{t("bento.editor.title")}</h3>
              <p className="mt-2 max-w-[38em] text-[14px] text-fg-2">{t("bento.editor.body")}</p>
            </div>
            <EditorStrip />
          </article>

          {/* cost */}
          <article className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6 desktop:col-span-5">
            <div>
              <h3 className="text-[18px] font-extrabold tracking-[-0.01em] [font-stretch:115%]">{t("bento.cost.title")}</h3>
              <p className="mt-2 text-[14px] text-fg-2">{t("bento.cost.body")}</p>
            </div>
            <div className="grid gap-3 rounded-lg border border-line bg-bg p-3.5" aria-hidden="true">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-fg-2">{t("bento.cost.estimate")}</span>
                <span className="sk h-3 w-14" style={{ animation: "none" }} />
              </div>
              <div className="grid gap-1.5">
                <span className="text-[12px] text-fg-3">{t("bento.cost.cap")}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line">
                  <span className="block h-full w-[38%] rounded-full bg-fg" />
                </span>
              </div>
              <span className={buttonVariants({ variant: "default", size: "sm", className: "pointer-events-none w-full" })}>{t("bento.cost.approve")}</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}

/** a tiny timeline: tracks on ink, the selected clip in lime (editor v1: selection = lime) */
function EditorStrip() {
  const tracks: { w: number[]; sel?: number }[] = [
    { w: [22, 30, 18, 30], sel: 1 },
    { w: [12, 14, 10, 16, 12, 14, 12] },
    { w: [100] },
  ]
  return (
    <div className="on-ink grid gap-1.5 rounded-lg bg-ink p-3" aria-hidden="true">
      <div className="relative mb-1 flex justify-between font-mono text-[9.5px] text-ink-fg-3">
        <span>00:00</span>
        <span>00:05</span>
        <span>00:10</span>
        <span>00:15</span>
      </div>
      {tracks.map((tr, ti) => (
        <div key={ti} className="flex h-6 gap-1">
          {tr.w.map((w, i) => (
            <span
              key={i}
              style={{ width: `${w}%` }}
              className={cn(
                "rounded-[4px] border",
                tr.sel === i ? "border-brand bg-brand/25 shadow-[0_0_0_1px_var(--brand)]" : ti === 2 ? "border-ink-line bg-[repeating-linear-gradient(90deg,var(--ink-3)_0_2px,transparent_2px_5px)]" : "border-ink-line bg-ink-3"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ───────── for agencies: full-bleed ink */
function Agencies({ t }: { t: T }) {
  const points = t.raw("agency.points") as Step[]
  const clients = [
    { name: "Mooncloth", code: "MC", live: true, waiting: 3 },
    { name: "Northbay Dental", code: "ND", live: true, waiting: 0 },
    { name: "Kettle & Pine", code: "KP", live: false, step: 3 },
  ]
  return (
    <section className="on-ink bg-ink" aria-labelledby="agency-title">
      <div className={cn(wrap, "grid gap-12 py-16 tablet:py-24 desktop:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] desktop:gap-16")}>
        <div>
          <p className="lp-eyebrow text-ink-fg-3">{t("agency.eyebrow")}</p>
          <h2 id="agency-title" className="lp-display lp-h2 mt-3 max-w-[15em] text-ink-fg">
            {t("agency.title")}
          </h2>
          <dl className="mt-10 grid gap-x-8 gap-y-6 tablet:grid-cols-2">
            {points.map((p) => (
              <div key={p.t} className="border-t border-ink-line pt-4">
                <dt className="text-[15px] font-bold text-ink-fg">{p.t}</dt>
                <dd className="m-0 mt-1.5 text-[14px] text-ink-fg-2">{p.d}</dd>
              </div>
            ))}
          </dl>
        </div>
        <figure className="m-0 self-center rounded-xl border border-ink-line bg-ink-2 p-4 tablet:p-5" aria-label={`${t("agency.list.title")} (${t("agency.list.example")})`}>
          <div className="flex items-center justify-between">
            <b className="text-[15px] text-ink-fg">{t("agency.list.title")}</b>
            <span className="rounded-full border border-dashed border-ink-fg-3/60 px-2 py-px font-mono text-[10px] tracking-[0.08em] text-ink-fg-3 uppercase">{t("agency.list.example")}</span>
          </div>
          <ul className="mt-4 grid gap-2">
            {clients.map((c) => (
              <li key={c.code} className="flex items-center gap-3 rounded-lg border border-ink-line bg-ink px-3 py-3">
                <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-[#1e2550] text-[11px] font-extrabold text-[#e9dfc9] [font-stretch:125%]">{c.code}</span>
                <div className="grid min-w-0 flex-1">
                  <b className="truncate text-[14px] text-ink-fg">{c.name}</b>
                  <span className="truncate text-[12.5px] text-ink-fg-3">
                    {c.live ? (c.waiting ? t("agency.list.waiting", { n: c.waiting }) : t("agency.list.clientRole")) : t("agency.list.step", { n: c.step ?? 1 })}
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em] uppercase before:size-1.5 before:rounded-full before:content-['']",
                    c.live ? "bg-ok-bg text-ok before:bg-ok-dot" : "bg-card-2 text-ink-fg-2 before:bg-ink-fg-3"
                  )}
                >
                  {c.live ? t("agency.list.live") : t("agency.list.setup")}
                </span>
              </li>
            ))}
          </ul>
        </figure>
      </div>
    </section>
  )
}

/* ───────── coming soon: neutral dashed, never dressed as ready */
function Soon({ t }: { t: T }) {
  const items = t.raw("soon.items") as Step[]
  return (
    <section aria-labelledby="soon-title">
      <div className={cn(wrap, "py-16 tablet:py-24")}>
        <div className="grid gap-4 desktop:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] desktop:gap-14">
          <div>
            <p className="lp-eyebrow">{t("soon.eyebrow")}</p>
            <h2 id="soon-title" className="lp-display lp-h2 mt-3 max-w-[12em]">
              {t("soon.title")}
            </h2>
            <p className="mt-4 max-w-[30em] text-[15px] text-fg-2">{t("soon.sub")}</p>
          </div>
          <ul className="grid gap-3 tablet:grid-cols-2">
            {items.map((it) => (
              <li key={it.t} className="rounded-lg border border-dashed border-control bg-card-2/60 p-5">
                <div className="flex items-center justify-between gap-3">
                  <b className="text-[15px] text-fg-2">{it.t}</b>
                  <span className="flex-none rounded-full border border-dashed border-control px-2 py-px font-mono text-[10px] tracking-[0.08em] text-fg-3 uppercase">{t("soon.badge")}</span>
                </div>
                <p className="mt-2 text-[13.5px] text-fg-3">{it.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function FinalCta({ t }: { t: T }) {
  return (
    <section className={cn(wrap, "pb-16 tablet:pb-24")}>
      <div className="on-ink flex flex-col gap-8 rounded-xl bg-ink px-6 py-12 tablet:px-12 tablet:py-16 desktop:flex-row desktop:items-end desktop:justify-between">
        <div>
          <h2 className="lp-display text-[clamp(32px,5vw,68px)] text-ink-fg">{t("final.title")}</h2>
          <p className="mt-4 max-w-[34em] text-[15px] text-ink-fg-2 tablet:text-[16px]">{t("final.sub")}</p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-3">
          <Link href="/signup" className={buttonVariants({ variant: "brand", size: "lg", className: "px-7" })}>
            {t("final.cta")}
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "lg", className: "text-ink-fg-2 hover:bg-ink-3 hover:text-ink-fg" })}>
            {t("final.secondary")}
          </Link>
        </div>
      </div>
    </section>
  )
}

function Footer({ t }: { t: T }) {
  return (
    <footer className="border-t border-line">
      <div className={cn(wrap, "flex flex-col gap-6 py-8 tablet:flex-row tablet:items-center tablet:justify-between")}>
        <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center tablet:gap-4">
          <Wordmark t={t} />
          <span className="text-[13px] text-fg-3">{t("footer.tagline")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[13px]">
          <Link href="/login" className="font-semibold text-fg-2 hover:text-fg">
            {t("nav.logIn")}
          </Link>
          <Link href="/signup" className="font-semibold text-fg-2 hover:text-fg">
            {t("nav.createAccount")}
          </Link>
          <LanguageToggle />
          <span className="font-mono text-[11px] text-fg-3">{t("footer.rights")}</span>
        </div>
      </div>
    </footer>
  )
}
