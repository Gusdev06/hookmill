import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { buttonVariants } from "@/components/ui/button"
import { LanguageToggle } from "@/components/shell/language-toggle"
import { LogoMark } from "@/components/shell/logo"
import { cn } from "@/lib/utils"
import { AskQuiz } from "./ask-quiz"
import { Collage } from "./collage"
import { Flow } from "./flow"
import { LandingMotion } from "./landing-motion"
import { Words } from "./words"
import { LANDING_FLAGS, LAUNCH_NUMBERS, PRICING_HREF, SAMPLE_CTA_HREF, type Case, type CompareLink, type Testimonial } from "./config"
import "./landing.css"

export type T = Awaited<ReturnType<typeof getTranslations<"landing">>>
type Item = { t: string; d: string }

/**
 * Public landing v2 (design/landing-v2-2026-10-31.md, mockup-landing-v2.html, approved 31/10).
 * Static Server Component; the only client islands are the motion layer, the workflow tabs and the quiz.
 * Example data carries the dashed "Example" badge. Testimonials, cases, compare and pricing sit behind LANDING_FLAGS.
 */
export async function Landing() {
  const t = await getTranslations("landing")
  const testimonials = (t.raw("testimonials.items") as Testimonial[]) ?? []
  const cases = (t.raw("cases.items") as Case[]) ?? []
  const showTestimonials = LANDING_FLAGS.testimonials && testimonials.length >= 2
  const showCases = LANDING_FLAGS.results && cases.length >= 1
  return (
    <LandingMotion className="lp min-h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-sm focus:bg-card focus:px-3 focus:py-2">
        {t("nav.skip")}
      </a>
      <Header t={t} showResults={showCases} />
      <main id="main">
        <Hero t={t} />
        <Facts t={t} />
        <Vision t={t} />
        <Numbers t={t} />
        <Examples t={t} />
        <Flow />
        <Functions t={t} />
        <Ask t={t} />
        <Agencies t={t} />
        {showTestimonials ? <Testimonials t={t} items={testimonials} /> : null}
        {showCases ? <Cases t={t} items={cases} /> : null}
        <FinalCta t={t} />
      </main>
      <Footer t={t} showCases={showCases} />
    </LandingMotion>
  )
}

function Wordmark({ t }: { t: T }) {
  return (
    <Link href="/" aria-label={t("nav.home")} className="flex items-center gap-2.5 rounded-sm">
      <LogoMark />
      <span className="text-[16px] font-extrabold tracking-[-0.01em] [font-stretch:125%]">HookMill</span>
    </Link>
  )
}

function CtaLink({ children, className, size = "lg", magnetic }: { children: React.ReactNode; className?: string; size?: "lg" | "default" | "sm"; magnetic?: boolean }) {
  return (
    <Link href={SAMPLE_CTA_HREF} className={buttonVariants({ variant: "brand", size, className })} data-magnetic={magnetic || undefined}>
      {children}
    </Link>
  )
}

function Header({ t, showResults }: { t: T; showResults: boolean }) {
  return (
    <header className="lp-hdr">
      <div className="lp-wrap lp-hdr-row">
        <Wordmark t={t} />
        <nav className="lp-nav" aria-label={t("nav.main")}>
          <a href="#how">{t("nav.product")}</a>
          <a href="#agencies">{t("nav.agencies")}</a>
          {showResults ? <a href="#results">{t("nav.results")}</a> : null}
          {LANDING_FLAGS.pricing ? <Link href={PRICING_HREF}>{t("nav.pricing")}</Link> : null}
        </nav>
        <div className="lp-hdr-actions" aria-label={t("nav.account")}>
          <LanguageToggle className="mr-1" />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm", className: "px-2.5 tablet:px-3" })}>
            {t("nav.logIn")}
          </Link>
          <CtaLink size="sm" className="lp-hdr-cta">
            {t("nav.tryFree")}
          </CtaLink>
        </div>
      </div>
    </header>
  )
}

function Hero({ t }: { t: T }) {
  return (
    <section id="top" className="lp-hero lp-wrap" aria-labelledby="hero-t">
      <div className="lp-hero-grid">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">{t("hero.eyebrow")}</p>
          <h1 id="hero-t" className="lp-display lp-h1" data-hero-title>
            <Words text={t("hero.titleA")} />{" "}
            <span className="lp-hi">
              <Words text={t("hero.titleB")} />{" "}
              <mark data-hero-mark>
                <Words text={t("hero.titleMark")} />
              </mark>
            </span>
          </h1>
          <p className="lp-lede" data-hero-after>
            {t("hero.sub")}
          </p>
          <div className="lp-hero-ctas" data-hero-after>
            <CtaLink className="lp-btn-lg" magnetic>{t("hero.cta")}</CtaLink>
            <a className="lp-link-arrow" href="#agencies">
              {t("hero.agencies")} <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="lp-hero-note" data-hero-after>
            {t.rich("hero.note", { b: (c) => <b>{c}</b> })}
          </p>
        </div>
        <Collage t={t} />
      </div>
    </section>
  )
}

function Facts({ t }: { t: T }) {
  const items = t.raw("facts.items") as Item[]
  return (
    <section className="lp-facts" aria-label={t("facts.label")}>
      <ul data-cascade>
        {items.map((f) => (
          <li key={f.t}>
            <b>{f.t}</b>
            <span>{f.d}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Vision({ t }: { t: T }) {
  const you = t.raw("vision.youItems") as string[]
  const hm = t.raw("vision.hmItems") as string[]
  return (
    <section className="lp-band lp-wrap" aria-labelledby="vision-t">
      <div className="lp-vision">
        <div>
          <p className="lp-eyebrow">{t("vision.eyebrow")}</p>
          <h2 id="vision-t" className="lp-display lp-h2 mt-3.5 max-w-[15em]" data-reveal>
            <Words text={t("vision.title")} />
          </h2>
          <p className="lp-lede mt-5">{t("vision.lede")}</p>
        </div>
        <div className="lp-split" aria-label={t("vision.label")} role="group" data-cascade>
          <div>
            <p className="lp-eyebrow">{t("vision.you")}</p>
            <ul>
              {you.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="lp-eyebrow">{t("vision.hm")}</p>
            <ul>
              {hm.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 04/11: the 12 cards around the winner are real template outputs (public/landing/ex, made from one avatar ad) */
const MULTIPLY: { code: string; slug: string; t1: string; t2: string }[] = [
  { code: "BREAKING-NEWS", slug: "breaking-news", t1: "#4b5059", t2: "#2f343b" },
  { code: "HEADLINE", slug: "new-headline", t1: "#5b5348", t2: "#33302c" },
  { code: "CHAT-DM", slug: "chat-dm", t1: "#424b5e", t2: "#2a303b" },
  { code: "LIVE", slug: "live", t1: "#4b5059", t2: "#2f343b" },
  { code: "CALL", slug: "call", t1: "#535a49", t2: "#2e3328" },
  { code: "CINEMA", slug: "cinema", t1: "#3f4652", t2: "#262a31" },
  { code: "SPLIT", slug: "split-screen", t1: "#5b5348", t2: "#33302c" },
  { code: "GOSSIP", slug: "gossip-pink", t1: "#424b5e", t2: "#2a303b" },
  { code: "QUESTION", slug: "question-box", t1: "#4b5059", t2: "#2f343b" },
  { code: "MOTION", slug: "person-motion", t1: "#535a49", t2: "#2e3328" },
  { code: "SEARCH", slug: "native-search", t1: "#3f4652", t2: "#262a31" },
  { code: "STORY", slug: "story", t1: "#5b5348", t2: "#33302c" },
]

/** All the visible templates with an example, in gallery order (the "Cuts" ones are hidden, 04/11) */
const EXAMPLES = [
  "breaking-news", "meme-pov", "post-card", "question-box", "top-5", "live", "call", "cinema", "story", "read-the-caption",
  "pov-testimonial", "direct-offer", "split-screen", "split-torn", "meet-dialog", "gossip-page", "gossip-white", "gossip-pink",
  "new-headline", "native-search", "chat-dm", "person-motion",
] as const

/** A muted looping example; LandingMotion plays it only while it's on screen (preload none until then). */
function ExVideo({ slug }: { slug: string }) {
  return (
    <video
      className="lp-exv"
      data-lp-video
      src={`/landing/ex/${slug}.mp4`}
      poster={`/landing/ex/${slug}.jpg`}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
    />
  )
}

function Numbers({ t }: { t: T }) {
  const items = t.raw("numbers.items") as { d: string }[]
  const formats = t.raw("numbers.formats") as string[]
  return (
    <section className="lp-ink lp-band" aria-labelledby="count-t">
      <div className="lp-wrap">
        <div className="lp-num-head">
          <div>
            <p className="lp-eyebrow">{t("numbers.eyebrow")}</p>
            <h2 id="count-t" className="lp-display lp-h2 mt-3.5 max-w-[14em]" data-reveal>
              <Words text={t("numbers.title")} />
            </h2>
            <div className="lp-stats" style={{ "--cols": LAUNCH_NUMBERS.length } as React.CSSProperties} data-cascade>
              {LAUNCH_NUMBERS.map((n, i) => (
                <div className="lp-stat" key={n}>
                  <span className="lp-big" data-count={n}>
                    {n}
                  </span>
                  <p>{items[i]?.d}</p>
                </div>
              ))}
            </div>
          </div>
          {/* the multiplication: 12 variation cards are born from the winner in the middle (GSAP, on scroll) */}
          <figure className="lp-multiply" role="img" aria-label={t("numbers.multiplyLabel")} data-multiply>
            {MULTIPLY.slice(0, 5).map((v) => (
              <span key={v.code} className="lp-vcard has-v" data-vcard style={{ "--t1": v.t1, "--t2": v.t2 } as React.CSSProperties}>
                <ExVideo slug={v.slug} />
                <b>{v.code}</b>
              </span>
            ))}
            <span className="lp-vcard champ has-v" data-champ>
              <ExVideo slug="champion" />
              <b>{t("numbers.champion")}</b>
            </span>
            {MULTIPLY.slice(5).map((v) => (
              <span key={v.code} className="lp-vcard has-v" data-vcard style={{ "--t1": v.t1, "--t2": v.t2 } as React.CSSProperties}>
                <ExVideo slug={v.slug} />
                <b>{v.code}</b>
              </span>
            ))}
          </figure>
        </div>
        <div className="lp-marquee" role="group" aria-label={t("numbers.formatsLabel")}>
          <div className="lp-marquee-track">
            <ul>
              {formats.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <ul aria-hidden="true">
              {formats.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 04/11 (Gusta): every template, with the real piece it made from the same winner ad */
function Examples({ t }: { t: T }) {
  const names = Object.fromEntries((t.raw("examples.items") as { slug: string; name: string }[]).map((x) => [x.slug, x.name]))
  return (
    <section id="examples" className="lp-band" aria-labelledby="ex-t">
      <div className="lp-wrap">
        <span className="lp-eyebrow">{t("examples.eyebrow")}</span>
        <h2 id="ex-t" className="lp-display lp-h2 mt-3.5 max-w-[15em]" data-reveal>
          <Words text={t("examples.title")} />
        </h2>
        <p className="lp-lede mt-3 max-w-[60ch]">{t("examples.lede")}</p>
      </div>
      <div className="lp-ex-strip" role="list" aria-label={t("examples.label")}>
        <figure className="lp-ex lp-ex-champ" role="listitem">
          <ExVideo slug="champion" />
          <figcaption>{t("examples.champion")}</figcaption>
        </figure>
        {EXAMPLES.map((slug) => (
          <figure key={slug} className="lp-ex" role="listitem">
            <ExVideo slug={slug} />
            <figcaption>{names[slug] ?? slug}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

function Functions({ t }: { t: T }) {
  const items = t.raw("fn.items") as { t: string; d: string; io: string }[]
  return (
    <section className="lp-ink lp-band" aria-labelledby="fn-t">
      <div className="lp-wrap">
        <p className="lp-eyebrow">{t("fn.eyebrow")}</p>
        <h2 id="fn-t" className="lp-display lp-h2 mt-3.5 max-w-[15em]" data-reveal>
          <Words text={t("fn.title")} />
        </h2>
        <ul className="lp-fn-grid" data-cascade>
          {items.map((f) => (
            <li className="lp-fn" key={f.t} data-tilt>
              <b>{f.t}</b>
              <p>{f.d}</p>
              <span className="lp-io">{f.io}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Ask({ t }: { t: T }) {
  return (
    <section id="sample" className="lp-band lp-wrap" aria-labelledby="ask-t">
      <div className="lp-ask">
        <div>
          <p className="lp-eyebrow">{t("ask.eyebrow")}</p>
          <h2 id="ask-t" className="lp-display lp-h2 mt-3.5 max-w-[12em]" data-reveal>
            <Words text={t("ask.title")} />
          </h2>
          <p className="lp-lede mt-5">{t("ask.lede")}</p>
        </div>
        <AskQuiz ctaHref={SAMPLE_CTA_HREF} />
      </div>
    </section>
  )
}

const CLIENTS = [
  { name: "Mooncloth", code: "MC", bg: "#1e2550", live: true, waiting: 3 },
  { name: "Northbay Dental", code: "ND", bg: "#3b2a20", live: true, waiting: 0 },
  { name: "Kettle & Pine", code: "KP", bg: "#22352a", live: false, step: 3 },
]

function Agencies({ t }: { t: T }) {
  const points = t.raw("agency.points") as Item[]
  return (
    <section id="agencies" className="lp-ink lp-band" aria-labelledby="ag-t">
      <div className="lp-wrap lp-ag">
        <div>
          <p className="lp-eyebrow">{t("agency.eyebrow")}</p>
          <h2 id="ag-t" className="lp-display lp-h2 mt-3.5 max-w-[14em]" data-reveal>
            <Words text={t("agency.title")} />
          </h2>
          <dl data-cascade>
            {points.map((p) => (
              <div key={p.t}>
                <dt>{p.t}</dt>
                <dd>{p.d}</dd>
              </div>
            ))}
          </dl>
          {/* spec §Agências: until P4 of the sample is decided, agency access starts with a conversation (the signup) */}
          <p className="mt-8">
            <Link className="lp-link-arrow" href={SAMPLE_CTA_HREF}>
              {t("agency.cta")} <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
        <figure className="lp-clients m-0" aria-label={`${t("agency.list.title")} (${t("agency.list.example")})`} data-cascade>
          <div className="lp-panel-head">
            <b className="text-ink-fg">{t("agency.list.title")}</b>
            <span className="lp-chip example">{t("agency.list.example")}</span>
          </div>
          {CLIENTS.map((c) => (
            <div className="lp-cl" key={c.code}>
              <span className="lp-av" style={{ background: c.bg }} aria-hidden="true">
                {c.code}
              </span>
              <span className="lp-nm">
                <b>{c.name}</b>
                <span>{c.live ? (c.waiting ? t("agency.list.waiting", { n: c.waiting }) : t("agency.list.clientRole")) : t("agency.list.step", { n: c.step ?? 1 })}</span>
              </span>
              <span className={cn("lp-chip", c.live ? "ok" : "setup")}>{c.live ? t("agency.list.live") : t("agency.list.setup")}</span>
            </div>
          ))}
        </figure>
      </div>
    </section>
  )
}

/* §8 — only with ≥ 2 real quotes (name, role, photo, written OK) and LANDING_TESTIMONIALS */
function Testimonials({ t, items }: { t: T; items: Testimonial[] }) {
  return (
    <section className="lp-band lp-wrap" aria-labelledby="tst-t">
      <p className="lp-eyebrow">{t("testimonials.eyebrow")}</p>
      <h2 id="tst-t" className="lp-display lp-h2 mt-3.5 max-w-[14em]" data-reveal>
        <Words text={t("testimonials.title")} />
      </h2>
      <div className="lp-res-grid">
        {items.map((q) => (
          <figure className="lp-proof" key={q.name}>
            <blockquote className="m-0 text-[15px] text-fg-2">“{q.quote}”</blockquote>
            <figcaption className="flex items-center gap-2.5">
              {q.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- content file path, small avatar
                <img src={q.photo} alt="" width={34} height={34} loading="lazy" className="size-[34px] rounded-full object-cover" />
              ) : null}
              <span className="grid">
                <b className="text-[14px]">{q.name}</b>
                <span className="text-[12.5px] text-fg-3">{q.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

/* §9 — only with a real case (offer · period · spend · source, same metric before and after) and LANDING_RESULTS */
function Cases({ t, items }: { t: T; items: Case[] }) {
  return (
    <section id="results" className="lp-band lp-wrap" aria-labelledby="res-t">
      <p className="lp-eyebrow">{t("cases.eyebrow")}</p>
      <h2 id="res-t" className="lp-display lp-h2 mt-3.5 max-w-[14em]" data-reveal>
        <Words text={t("cases.title")} />
      </h2>
      <div className="lp-res-grid">
        {items.map((c) => (
          <article className="lp-proof" key={`${c.offer}-${c.period}`}>
            <span className="lp-metric">{c.metric}</span>
            <p className="text-[13px] text-fg-2">{[c.offer, c.period, c.spend].join(" · ")}</p>
            <span className="lp-mono text-[11px] text-fg-3">{c.source}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function FinalCta({ t }: { t: T }) {
  return (
    <section className="lp-wrap pt-14 pb-[72px] tablet:pt-[88px]" aria-labelledby="fin-t">
      <div className="lp-final" data-final>
        <span className="lp-glow" data-glow aria-hidden="true" />
        <div>
          <h2 id="fin-t" className="lp-display lp-final-h" data-reveal>
            <Words text={t("final.title")} />
          </h2>
          <p className="lp-lede">{t("final.sub")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <CtaLink className="lp-btn-lg" magnetic>{t("final.cta")}</CtaLink>
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "lg", className: "lp-btn-lg text-ink-fg-2 hover:bg-ink-3 hover:text-ink-fg" })}>
            {t("final.secondary")}
          </Link>
        </div>
      </div>
    </section>
  )
}

function Footer({ t, showCases }: { t: T; showCases: boolean }) {
  const compare = (t.raw("footer.compareItems") as CompareLink[]) ?? []
  const showCompare = LANDING_FLAGS.compare && compare.length > 0
  const cols = 2 + (showCompare ? 1 : 0) + (showCases ? 1 : 0)
  return (
    <footer className="lp-ftr">
      <div className="lp-wrap">
        <div className="lp-fcols" style={{ "--fcols": cols } as React.CSSProperties}>
          <div className="lp-brandcol">
            <Wordmark t={t} />
            <p className="max-w-[22em] text-[14px] text-fg-3">{t("footer.tagline")}</p>
            <LanguageToggle />
          </div>
          <nav aria-labelledby="f-product">
            <h2 id="f-product">{t("footer.product")}</h2>
            <ul>
              <li>
                <a href="#how">{t("footer.iterate")}</a>
              </li>
              <li>
                <a href="#how">{t("footer.concepts")}</a>
              </li>
              <li>
                <a href="#how">{t("footer.brain")}</a>
              </li>
              <li>
                <a href="#how">{t("footer.publish")}</a>
              </li>
              <li>
                <a href="#agencies">{t("footer.agencies")}</a>
              </li>
            </ul>
          </nav>
          {showCompare ? (
            <nav aria-labelledby="f-compare">
              <h2 id="f-compare">{t("footer.compare")}</h2>
              <ul>
                {compare.map((c) => (
                  <li key={c.href}>
                    <Link href={c.href}>{c.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {showCases ? (
            <nav aria-labelledby="f-cases">
              <h2 id="f-cases">{t("footer.cases")}</h2>
              <ul>
                <li>
                  <a href="#results">{t("footer.allCases")}</a>
                </li>
              </ul>
            </nav>
          ) : null}
          <nav aria-labelledby="f-company">
            <h2 id="f-company">{t("footer.company")}</h2>
            <ul>
              <li>
                <Link href="/login">{t("nav.logIn")}</Link>
              </li>
              <li>
                <Link href="/signup">{t("nav.createAccount")}</Link>
              </li>
              {LANDING_FLAGS.pricing ? (
                <li>
                  <Link href={PRICING_HREF}>{t("footer.pricing")}</Link>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
        <div className="lp-fbottom">
          <span>{t("footer.rights")}</span>
        </div>
      </div>
    </footer>
  )
}
