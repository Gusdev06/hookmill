import type {
  MetaAudienceRef, MetaBidStrategy, MetaBudgetType, MetaCallToAction, MetaConnection, MetaInstagramAccountRef, MetaLocaleRef, MetaObjective,
  MetaPixelEvent, MetaSpecialAdCategory, MetaTemplateAdset, MetaTemplateBody, MetaTemplateOptimizationGoal, MetaTemplateSchedule,
} from "@/lib/api/types"
import { minorFactor } from "@/hooks/use-meta-publish"

/*
 * The template editor's model (was template-dialog.tsx; meta-templates-v1 + v2 §2/§3/§8). `draftOf` turns a template
 * (saved, imported or factory) into strings the fields edit; `build` validates like the API (templates.ts) and returns
 * the body. The v2 keys are only sent when they carry something (absent = v1 behaviour), so a v1-shaped template still
 * saves on an API that doesn't know them yet (contract §11: the real API answers `notAllowed` to new keys until B1).
 */
export type Level = "campaign" | "adset" | "ad"
export const LEVELS: Level[] = ["campaign", "adset", "ad"]
/** Ads Manager order of the objective grid (2 columns) */
export const OBJECTIVES: MetaObjective[] = ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION", "OUTCOME_SALES"]
export const NEEDS_PIXEL: MetaObjective[] = ["OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION"]
/** §2.1: goals per objective; the first is the default when `optimizationGoal` is null */
export const GOALS: Partial<Record<MetaObjective, MetaTemplateOptimizationGoal[]>> = {
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS"],
  OUTCOME_ENGAGEMENT: ["THRUPLAY", "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS", "POST_ENGAGEMENT"],
}
export const isGoalObjective = (o: MetaObjective) => !!GOALS[o]
export const BIDS: MetaBidStrategy[] = ["LOWEST_COST", "COST_CAP", "BID_CAP"]
export const SPECIAL: MetaSpecialAdCategory[] = ["FINANCIAL_PRODUCTS_SERVICES", "EMPLOYMENT", "HOUSING", "ISSUES_ELECTIONS_POLITICS", "CREDIT"]
export const EVENTS: MetaPixelEvent[] = ["PURCHASE", "LEAD", "COMPLETE_REGISTRATION", "SCHEDULE", "SUBSCRIBE"]
export const CTAS: MetaCallToAction[] = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "BOOK_NOW", "CONTACT_US", "DOWNLOAD", "SUBSCRIBE", "APPLY_NOW", "GET_QUOTE", "ORDER_NOW"]
export type Platform = "facebook" | "instagram" | "audience_network" | "messenger"
export const PLATFORMS: Platform[] = ["facebook", "instagram", "audience_network", "messenger"]
/** `<platform>_<Graph position>` (the format the API validates) */
export const POSITIONS: Record<Platform, string[]> = {
  facebook: ["facebook_feed", "facebook_story", "facebook_facebook_reels", "facebook_video_feeds", "facebook_marketplace", "facebook_instream_video"],
  instagram: ["instagram_stream", "instagram_story", "instagram_reels", "instagram_explore"],
  audience_network: ["audience_network_classic", "audience_network_rewarded_video"],
  messenger: ["messenger_messenger_home", "messenger_story"],
}
const COUNTRY_RE = /^[A-Z]{2}$/
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
export const parseCountries = (text: string) => text.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)
export const int = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN)
const amount = (s: string, f: number) => (s.trim() ? Math.round(Number(s.replace(",", ".")) * f) : NaN)

export interface Draft {
  name: string; isDefault: boolean
  destination: MetaTemplateBody["campaign"]["destination"]; objective: MetaObjective; budgetMode: "CBO" | "ABO"
  budgetType: MetaBudgetType; budget: string; lifetimeBudget: string
  bidStrategy: MetaBidStrategy; bidAmount: string; special: MetaSpecialAdCategory[]; campaignName: string
  pixelId: string | null; pixelEvent: MetaPixelEvent | null; optimizationGoal: MetaTemplateOptimizationGoal | null
  startMode: "PUBLISH" | "AT"; startAt: string; endMode: "NONE" | "AFTER_DAYS" | "AT"; endDays: string; endAt: string
  countries: string; ageMin: string; ageMax: string; locales: MetaLocaleRef[]
  customAudiences: MetaAudienceRef[]; excludedCustomAudiences: MetaAudienceRef[]
  genders: MetaTemplateAdset["genders"]; advantage: boolean; placements: "AUTO" | "MANUAL"; platforms: Platform[]; positions: string[]
  min: string; max: string; adsetName: string
  instagramAccount: MetaInstagramAccountRef | null
  cta: MetaCallToAction; link: string; urlTags: string; primaryText: string; headline: string; description: string; adName: string
}

/** A template body whose daily budget may still be empty (factory / import without budget). */
export type BodyLike = Omit<MetaTemplateBody, "campaign"> & { campaign: Omit<MetaTemplateBody["campaign"], "dailyBudgetMinor"> & { dailyBudgetMinor: number | null } }

export const FACTORY_UTM = "utm_source=meta&utm_medium=paid"

/** Spec §6 "New (factory values)": CBO, Highest volume, 4–8, US 18–65, Advantage+ on, the connection's pixel, the
 * offer's link, UTM ready, destination REUSE (P1); the budget stays EMPTY (Gusta 03/11: decide it on the first template). */
export function factoryTemplate(conn: MetaConnection | null | undefined, o: { name: string; campaignName: string; link: string | null }): BodyLike {
  const pixel = conn?.pixel ?? null
  return {
    name: o.name,
    isDefault: false,
    campaign: {
      destination: "REUSE_CAMPAIGN", objective: pixel ? "OUTCOME_SALES" : "OUTCOME_TRAFFIC", budgetMode: "CBO", dailyBudgetMinor: null,
      bidStrategy: "LOWEST_COST", bidAmountMinor: null, specialAdCategories: [], namePattern: o.campaignName,
    },
    adset: {
      pixelId: pixel?.id ?? null, pixelEvent: pixel ? "PURCHASE" : null, countries: ["US"], ageMin: 18, ageMax: 65, genders: "ALL",
      advantageAudience: true, placements: "AUTO", adsPerAdset: { min: 4, max: 8 }, namePattern: "{offer} · {date} · {n}",
    },
    ad: { primaryText: null, headline: null, description: null, callToAction: "SHOP_NOW", link: o.link ?? "", urlTags: FACTORY_UTM, namePattern: "{code}" },
  }
}

export function draftOf(b: BodyLike, currency: string | null, isDefault: boolean): Draft {
  const f = minorFactor(currency)
  const c = b.campaign
  const a = b.adset
  const manual = a.placements !== "AUTO" ? a.placements : null
  const lifetime = c.budgetType === "LIFETIME"
  const sch = a.schedule ?? null
  const end = sch?.end ?? null
  return {
    name: b.name, isDefault,
    destination: c.destination, objective: c.objective, budgetMode: c.budgetMode,
    budgetType: lifetime ? "LIFETIME" : "DAILY",
    budget: !lifetime && c.dailyBudgetMinor ? String(c.dailyBudgetMinor / f) : "",
    lifetimeBudget: lifetime && c.lifetimeBudgetMinor ? String(c.lifetimeBudgetMinor / f) : "",
    bidStrategy: c.bidStrategy, bidAmount: c.bidAmountMinor ? String(c.bidAmountMinor / f) : "", special: c.specialAdCategories, campaignName: c.namePattern,
    pixelId: a.pixelId, pixelEvent: a.pixelEvent, optimizationGoal: a.optimizationGoal ?? null,
    startMode: sch?.start ? "AT" : "PUBLISH", startAt: sch?.start ?? "",
    endMode: !end ? "NONE" : end.kind, endDays: end?.kind === "AFTER_DAYS" ? String(end.days) : "7", endAt: end?.kind === "AT" ? end.at : "",
    countries: a.countries.join(", "), ageMin: String(a.ageMin), ageMax: String(a.ageMax), locales: a.locales ?? [],
    customAudiences: a.customAudiences ?? [], excludedCustomAudiences: a.excludedCustomAudiences ?? [],
    genders: a.genders, advantage: a.advantageAudience, placements: manual ? "MANUAL" : "AUTO",
    platforms: manual ? manual.platforms : ["facebook", "instagram"], positions: manual ? manual.positions : [],
    min: String(a.adsPerAdset.min), max: String(a.adsPerAdset.max), adsetName: a.namePattern,
    instagramAccount: b.ad.instagramAccount ?? null,
    cta: b.ad.callToAction, link: b.ad.link, urlTags: b.ad.urlTags ?? "", primaryText: b.ad.primaryText ?? "", headline: b.ad.headline ?? "",
    description: b.ad.description ?? "", adName: b.ad.namePattern,
  }
}

/** §8: switching objective cleans what the new one forbids (pixel with Awareness/Engagement, the goal with the others). */
export function withObjective(d: Draft, objective: MetaObjective, connPixel: { id: string } | null): Partial<Draft> {
  if (isGoalObjective(objective)) return { objective, pixelId: null, pixelEvent: null, optimizationGoal: GOALS[objective]![0] }
  const back = isGoalObjective(d.objective) && !d.pixelId && connPixel && NEEDS_PIXEL.includes(objective)
  return { objective, optimizationGoal: null, ...(back ? { pixelId: connPixel.id, pixelEvent: "PURCHASE" as const } : {}) }
}
/** §2.2: Lifetime + CBO only goes into a new campaign each publish. */
export const lockedNewCampaign = (d: Pick<Draft, "budgetMode" | "budgetType">) => d.budgetMode === "CBO" && d.budgetType === "LIFETIME"

export type Errors = Record<string, string>

/** Spec §6 + v2 §8: budget/bid fields live on the Campaign with CBO and on the Ad set with ABO; `name` = header (null). */
export function levelOf(field: string, budgetMode: "CBO" | "ABO"): Level | null {
  if (field === "name") return null
  if (/^campaign\.(dailyBudgetMinor|bidAmountMinor|lifetimeBudgetMinor|budgetType)$/.test(field)) return budgetMode === "CBO" ? "campaign" : "adset"
  if (field.startsWith("adset.")) return "adset"
  if (field.startsWith("ad.")) return "ad"
  return "campaign"
}
/** An API field path → the key the editor shows it under ("adset.ageMin" shares the age row; "campaign.x.y" → "campaign.x"). */
export function errorKeyOf(field: string) {
  if (field === "adset.ageMin") return "adset.ageMax"
  if (field.startsWith("adset.schedule.")) return field.split(".").slice(0, 3).join(".")
  if (field === "adset.schedule") return "adset.schedule.end"
  return field.split(".").slice(0, 2).join(".")
}

/** "YYYY-MM-DDTHH:mm" of now in the ad account's time zone (the schedule is local to it, §2.3). */
export function nowLocal(tz: string | null | undefined, plusMin = 0) {
  const d = new Date(Date.now() + plusMin * 60_000)
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
  } catch {
    return d.toISOString().slice(0, 16)
  }
}
/** minutes between two local date-times of the same zone (DST shifts ignored: an estimate, the API decides) */
const minutesBetween = (a: string, b: string) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000

/** Days the schedule runs, when it can be told before publishing (§3 lifetime minimum). */
export function scheduleDays(d: Pick<Draft, "startMode" | "startAt" | "endMode" | "endDays" | "endAt">, tz: string | null | undefined): number | null {
  if (d.endMode === "AFTER_DAYS") return int(d.endDays) >= 1 ? int(d.endDays) : null
  if (d.endMode !== "AT" || !LOCAL_RE.test(d.endAt)) return null
  const start = d.startMode === "AT" ? d.startAt : nowLocal(tz)
  if (!LOCAL_RE.test(start)) return null
  const m = minutesBetween(start, d.endAt)
  return m > 0 ? Math.ceil(m / 1440) : null
}

type Tr = (k: string, v?: Record<string, string | number>) => string

export function build(d: Draft, o: { currency: string | null; minDaily: number | null; tz: string | null | undefined; t: Tr; money: (m: number) => string }): { errors: Errors; body: MetaTemplateBody | null } {
  const { t, money } = o
  const e: Errors = {}
  const f = minorFactor(o.currency)
  const lifetime = d.budgetType === "LIFETIME"
  if (!d.name.trim() || d.name.length > 60) e.name = t("err.name")
  if (!d.campaignName.trim() || d.campaignName.length > 120) e["campaign.namePattern"] = t("err.pattern")
  const daily = amount(d.budget, f)
  const total = amount(d.lifetimeBudget, f)
  const days = scheduleDays(d, o.tz)
  if (!lifetime) {
    if (!Number.isFinite(daily) || daily <= 0) e["campaign.dailyBudgetMinor"] = t("err.budget")
    else if (o.minDaily !== null && daily < o.minDaily) e["campaign.dailyBudgetMinor"] = t("err.budgetBelow", { min: money(o.minDaily) })
  } else {
    if (!Number.isFinite(total) || total <= 0) e["campaign.lifetimeBudgetMinor"] = t("err.lifetime")
    else if (o.minDaily !== null && days && total < o.minDaily * days) e["campaign.lifetimeBudgetMinor"] = t("err.lifetimeBelow", { min: money(o.minDaily * days), days })
  }
  // CBO + LIFETIME + REUSE can't happen here: the radio shows it locked on NEW and the body sends NEW (§2.2)
  const cap = d.bidAmount.trim() ? amount(d.bidAmount, f) : null
  if (d.bidStrategy !== "LOWEST_COST" && (!cap || !Number.isFinite(cap) || cap <= 0)) e["campaign.bidAmountMinor"] = t("err.cap")
  const goalObj = isGoalObjective(d.objective)
  if (NEEDS_PIXEL.includes(d.objective) && !d.pixelId) e["adset.pixelId"] = t("err.pixel")
  if (goalObj && (d.pixelId || d.pixelEvent)) e["adset.pixelId"] = t("err.pixelNotFor")
  if (goalObj && d.optimizationGoal && !GOALS[d.objective]!.includes(d.optimizationGoal)) e["adset.optimizationGoal"] = t("err.invalid")
  // schedule (§3): start not in the past, end ≥ 24 h after the start, AFTER_DAYS 1–365, an end with Lifetime
  const now = nowLocal(o.tz)
  if (d.startMode === "AT") {
    if (!LOCAL_RE.test(d.startAt)) e["adset.schedule.start"] = t("err.date")
    else if (minutesBetween(d.startAt, now) > 5) e["adset.schedule.start"] = t("err.inPast")
  }
  if (d.endMode === "AFTER_DAYS" && !(int(d.endDays) >= 1 && int(d.endDays) <= 365)) e["adset.schedule.end"] = t("err.days")
  if (d.endMode === "AT") {
    const start = d.startMode === "AT" && LOCAL_RE.test(d.startAt) ? d.startAt : now
    if (!LOCAL_RE.test(d.endAt)) e["adset.schedule.end"] = t("err.date")
    else if (minutesBetween(d.endAt, now) > 0) e["adset.schedule.end"] = t("err.inPast")
    else if (minutesBetween(start, d.endAt) < 24 * 60) e["adset.schedule.end"] = t("err.minDuration")
  }
  if (lifetime && d.endMode === "NONE") e["adset.schedule.end"] = t("err.endForLifetime")
  const countries = parseCountries(d.countries)
  if (!countries.length || countries.length > 10 || countries.some((c) => !COUNTRY_RE.test(c))) e["adset.countries"] = t("err.countries")
  const ageMin = int(d.ageMin)
  const ageMax = int(d.ageMax)
  if (!(ageMin >= 18 && ageMin <= 65 && ageMax >= 18 && ageMax <= 65 && ageMin <= ageMax)) e["adset.ageMax"] = t("err.ages")
  if (d.locales.length > 50) e["adset.locales"] = t("err.tooMany", { max: 50 })
  if (d.customAudiences.length > 20) e["adset.customAudiences"] = t("err.tooMany", { max: 20 })
  if (d.excludedCustomAudiences.length > 20) e["adset.excludedCustomAudiences"] = t("err.tooMany", { max: 20 })
  else if (d.excludedCustomAudiences.some((x) => d.customAudiences.some((y) => y.id === x.id))) e["adset.excludedCustomAudiences"] = t("err.bothLists")
  const min = int(d.min)
  const max = int(d.max)
  if (!(min >= 1 && max <= 50 && min <= max)) e["adset.adsPerAdset"] = t("err.perAdset")
  if (d.placements === "MANUAL" && !d.platforms.length) e["adset.placements"] = t("err.placements")
  if (!d.adsetName.trim() || d.adsetName.length > 120) e["adset.namePattern"] = t("err.pattern")
  const link = d.link.trim()
  if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(link) || link.length > 2048) e["ad.link"] = t("err.link")
  const urlTags = d.urlTags.trim().replace(/^\?/, "")
  if (urlTags.length > 1024) e["ad.urlTags"] = t("err.utm")
  if (d.primaryText.length > 2000) e["ad.primaryText"] = t("err.length", { max: 2000 })
  if (d.headline.length > 255) e["ad.headline"] = t("err.length", { max: 255 })
  if (d.description.length > 125) e["ad.description"] = t("err.length", { max: 125 })
  if (!d.adName.trim() || d.adName.length > 120) e["ad.namePattern"] = t("err.pattern")
  if (Object.keys(e).length) return { errors: e, body: null }

  const positions = d.positions.filter((p) => d.platforms.some((pl) => p.startsWith(`${pl}_`)))
  const schedule: MetaTemplateSchedule | null =
    d.startMode === "PUBLISH" && d.endMode === "NONE"
      ? null
      : {
          start: d.startMode === "AT" ? d.startAt : null,
          end: d.endMode === "NONE" ? null : d.endMode === "AFTER_DAYS" ? { kind: "AFTER_DAYS", days: int(d.endDays) } : { kind: "AT", at: d.endAt },
        }
  // v2 keys only when they carry something (absent = v1, §5)
  const adset: MetaTemplateAdset = {
    pixelId: goalObj ? null : d.pixelId, pixelEvent: goalObj || !d.pixelId ? null : d.pixelEvent, countries, ageMin, ageMax, genders: d.genders, advantageAudience: d.advantage,
    placements: d.placements === "AUTO" ? "AUTO" : { platforms: d.platforms, positions }, adsPerAdset: { min, max }, namePattern: d.adsetName.trim(),
    ...(goalObj ? { optimizationGoal: d.optimizationGoal ?? GOALS[d.objective]![0] } : {}),
    ...(schedule ? { schedule } : {}),
    ...(d.locales.length ? { locales: d.locales } : {}),
    ...(d.customAudiences.length ? { customAudiences: d.customAudiences } : {}),
    ...(d.excludedCustomAudiences.length ? { excludedCustomAudiences: d.excludedCustomAudiences } : {}),
  }
  return {
    errors: e,
    body: {
      name: d.name.trim(), isDefault: d.isDefault,
      campaign: {
        destination: lockedNewCampaign(d) ? "NEW_CAMPAIGN" : d.destination, objective: d.objective, budgetMode: d.budgetMode,
        dailyBudgetMinor: lifetime ? 0 : daily,
        ...(lifetime ? { budgetType: "LIFETIME" as const, lifetimeBudgetMinor: total } : {}),
        bidStrategy: d.bidStrategy, bidAmountMinor: d.bidStrategy === "LOWEST_COST" ? null : cap, specialAdCategories: d.special, namePattern: d.campaignName.trim(),
      },
      adset,
      ad: {
        primaryText: d.primaryText.trim() || null, headline: d.headline.trim() || null, description: d.description.trim() || null,
        callToAction: d.cta, link, urlTags: urlTags || null, namePattern: d.adName.trim(),
        ...(d.instagramAccount ? { instagramAccount: d.instagramAccount } : {}),
      },
    },
  }
}

/** A name pattern with example values, shown next to each name field. */
export const resolveSample = (pattern: string, code = "HEADLINE-02", offer = "Sleepwell") =>
  pattern.replace(/\{offer\}/g, offer).replace(/\{code\}/g, code).replace(/\{date\}/g, new Date().toISOString().slice(0, 10)).replace(/\{n\}/g, "1").replace(/\s+/g, " ").trim()

export const hostOf = (link: string) => link.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || ""
