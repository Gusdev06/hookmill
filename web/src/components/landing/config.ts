/**
 * Landing v2 switches (spec landing-v2-2026-10-31 §2/§6). All off at launch (Gusta, 31/10): the sections stay
 * built but don't render. Turn one on with its env var ("1") on the web server; a section with no real content
 * still won't render (testimonials need ≥ 2 real quotes, cases ≥ 1 real case, both from `landing.*` in messages).
 */
const on = (v: string | undefined) => v === "1" || v === "true"

export const LANDING_FLAGS = {
  /** §8 testimonials */
  testimonials: on(process.env.LANDING_TESTIMONIALS),
  /** §9 cases + "Results" in the header + "Cases" column in the footer */
  results: on(process.env.LANDING_RESULTS),
  /** footer "Compare" column (only with written, fair pages) */
  compare: on(process.env.LANDING_COMPARE),
  /** "Pricing" in the header and footer (depends on the sample price, P2) */
  pricing: on(process.env.LANDING_PRICING),
} as const

/** where the pricing link goes once LANDING_PRICING is on */
export const PRICING_HREF = "/pricing"

/**
 * Main CTA. amostra-gratis-v1: the free sample lives in /iterate/new for a SAMPLE account; the way in is the
 * signup (which then runs /start → setup, onboarding-v2 D8). Single constant so the public sample route can
 * replace it in one place when it exists.
 */
export const SAMPLE_CTA_HREF = "/signup"

/** Launch counters (no database). Sources, for review only, never rendered:
 *  4 = amostra-gratis-v1 §0 (SAMPLE_MAX_PIECES) · 12 = iterate-v2 BATCH_MAX. "~2 min" is out until measured. */
export const LAUNCH_NUMBERS = [4, 12] as const

export type Testimonial = { quote: string; name: string; role: string; photo?: string }
export type Case = { metric: string; offer: string; period: string; spend: string; source: string }
export type CompareLink = { label: string; href: string }
