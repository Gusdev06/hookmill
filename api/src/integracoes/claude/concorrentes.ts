// ads-research-v1 (Ad Radar), C.3: prompts, esquemas (json_schema estrito) e validação do D1 (propor concorrentes, Sonnet)
// e do D4 (julgar Páginas, Haiku). Agnóstico de oferta: o nicho vem só do Brain. Origem: sondas R1 (run3.mjs), com a
// regra final da C.3 (marcas "que anunciam no país", 6 termos tipados, juiz direto × vizinho × none).
import type { BrainDigest, JudgeCompetitorsInput, JudgeCompetitorsResult, ProposeCompetitorsInput, ProposeCompetitorsResult, ProposedTermKind } from '../contrato';
import { IntegracaoError } from '../erros';
import { parseJsonObject } from './validacao-campeao';

export const RESEARCH_MODELS = { propose: 'claude-sonnet-5-5', judge: 'claude-haiku-4-5' } as const;
export const RESEARCH_MAX_BRANDS = 6;
export const RESEARCH_MAX_JUDGE_PAGES = 25;
/** Tokens de saída: D1 é curto; D4 cresce ~60 tokens por Página. */
export const RESEARCH_MAX_TOKENS = { propose: 8000, judge: 8000 } as const;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

// ---------------------------------------------------------------- D1

export const PROPOSE_SYSTEM = `You find the competitors of a business that advertises on Meta (Facebook/Instagram), so its team can study their ads in the Meta Ad Library.
You receive the business profile (its "Brain"): industry, target market, website and its offers (what it is, who it is for, promise, pains, price, pages read).
Return:
1. countryCode: the ISO 3166-1 alpha-2 country where this business mainly sells. Use the stated market; if it is missing or vague ("Global", a niche instead of a place), infer it from the website (country domain, currency, language) and the offer language; if nothing points anywhere, use US. countryReason: one short line saying why.
2. brands: up to the requested number of brands that sell the same kind of product to the same audience AND that you know advertise on Facebook/Instagram IN THAT COUNTRY (a famous brand that does not advertise there is useless here). Prefer advertisers that compete for the same customer with a similar offer and price point over famous adjacent brands. For each: brand name, the domain its ads most likely link to (bare domain: no protocol, no "www.", no path) and one short reason. Never the business itself (same name or domain) and never a brand or domain on the "do not suggest" list. Never marketplaces, retailers, media or generic platforms. If you know fewer real advertisers, return fewer, even zero: do not invent brands.
3. terms: exactly 6 search phrases of 2 or 3 words, in the main language of that country, that ads of this niche literally say in their text. They are searched as an EXACT phrase, so use the wording these ads really use, including the niche's own jargon, not a description of the niche. Two about the promise or result (kind "promise"), two naming the kind of product or method (kind "product"), two about the pain or situation of the buyer (kind "pain"). No brand names. Each phrase must be specific to this niche: a phrase that also fits ads of unrelated niches (finance, dating, health, entertainment) is wrong. Never repeat a phrase from the "already searched" list.
Only use what the profile says plus your own knowledge of the market.`;

export const PROPOSE_SCHEMA = obj({
  countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2, uppercase.' },
  countryReason: { type: 'string' },
  brands: { type: 'array', items: obj({ brand: { type: 'string' }, domain: { type: 'string' }, why: { type: 'string' } }) },
  terms: { type: 'array', items: obj({ term: { type: 'string' }, kind: { type: 'string', enum: ['promise', 'product', 'pain'] } }) },
});

/** Brain em JSON estável (chaves fixas, sem data/id): bloco cacheável. */
export function brainContext(b: BrainDigest): string {
  const offers = (b.offers ?? []).slice(0, 3).map((o) => ({
    name: o.name, kind: o.kind, what: o.what, audience: o.audience, promise: o.promise, pains: o.pains,
    offerAndPrice: o.offerAndPrice, cta: o.cta, sourceUrl: o.sourceUrl, pagesRead: (o.pagesRead ?? []).slice(0, 5),
  }));
  return `Business profile (JSON):\n${JSON.stringify({ name: b.name, industry: b.industry, market: b.market, website: b.websiteUrl, language: b.language, offers }, null, 1)}`;
}

export function proposeUserMessage(i: ProposeCompetitorsInput): string {
  const max = clampInt(i.maxBrands, 0, RESEARCH_MAX_BRANDS);
  const blocked = [...i.blocked.pageNames, ...i.blocked.domains].map((x) => x.trim()).filter(Boolean);
  const reuse = i.reuseTerms.map((x) => x.trim()).filter(Boolean);
  return [
    `Return up to ${max} brands.`,
    `Do not suggest (removed by the client): ${blocked.length ? blocked.join(', ') : 'none'}.`,
    `Already searched (do not repeat these phrases): ${reuse.length ? reuse.map((t) => `"${t}"`).join(', ') : 'none'}.`,
  ].join('\n');
}

/** Domínio "nu" e minúsculo; null se não parecer domínio. */
export function bareDomain(v: string): string | null {
  const d = v.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const sameHost = (a: string, b: string) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a);

/** Hosts do próprio cliente (site e páginas das ofertas). */
export function ownHostsOf(b: BrainDigest): string[] {
  const urls = [b.websiteUrl, ...(b.offers ?? []).flatMap((o) => [o.sourceUrl, ...(o.pagesRead ?? [])])].filter((u): u is string => !!u);
  return [...new Set(urls.map((u) => bareDomain(u)).filter((d): d is string => !!d))];
}

const KIND_ORDER: ProposedTermKind[] = ['promise', 'product', 'pain'];

export function parseProposal(text: string, i: ProposeCompetitorsInput): Omit<ProposeCompetitorsResult, 'costUsd' | 'model' | 'inputKtok' | 'outputKtok' | 'inputUsd' | 'outputUsd'> {
  const root = parseJsonObject(text);
  const cc = String(root.countryCode ?? '').trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(cc) ? cc : 'US';
  const countryReason = String(root.countryReason ?? '').trim().slice(0, 300);

  const own = ownHostsOf(i.brain);
  const ownName = norm(i.brain.name ?? '');
  const blockedDomains = i.blocked.domains.map((d) => bareDomain(d)).filter((d): d is string => !!d);
  const blockedNames = i.blocked.pageNames.map(norm).filter((n) => n.length > 2);
  const max = clampInt(i.maxBrands, 0, RESEARCH_MAX_BRANDS);
  const brands: ProposeCompetitorsResult['brands'] = [];
  for (const raw of Array.isArray(root.brands) ? root.brands : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const brand = String(r.brand ?? '').trim().slice(0, 120);
    const domain = bareDomain(String(r.domain ?? ''));
    if (!brand || !domain) continue;
    if (own.some((h) => sameHost(h, domain)) || blockedDomains.some((h) => sameHost(h, domain))) continue;
    const n = norm(brand);
    if ((ownName.length > 3 && n === ownName) || blockedNames.some((b) => b === n)) continue;
    if (brands.some((x) => x.domain === domain || norm(x.brand) === n)) continue;
    brands.push({ brand, domain, why: String(r.why ?? '').trim().slice(0, 300) });
    if (brands.length >= max) break;
  }

  const reuse = new Set(i.reuseTerms.map((t) => t.trim().toLowerCase()));
  const byKind: Record<ProposedTermKind, string[]> = { promise: [], product: [], pain: [] };
  const seen = new Set<string>();
  for (const raw of Array.isArray(root.terms) ? root.terms : []) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = String(r.kind ?? '') as ProposedTermKind;
    if (!KIND_ORDER.includes(kind)) continue;
    const term = String(r.term ?? '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
    const words = term.split(' ').length;
    const key = term.toLowerCase();
    if (!term || words > 4 || term.length > 60 || reuse.has(key) || seen.has(key)) continue;
    seen.add(key);
    byKind[kind].push(term);
  }
  // promessa, promessa, produto, produto, dor, dor (até 2 de cada)
  const terms = KIND_ORDER.flatMap((kind) => byKind[kind].slice(0, 2).map((term) => ({ term, kind })));
  if (terms.length < 3) throw new IntegracaoError('PROVIDER_ERROR', `propose competitors: only ${terms.length} usable term(s)`);
  return { countryCode, countryReason, brands, terms };
}

// ---------------------------------------------------------------- D4

export const JUDGE_SYSTEM = `You check whether advertisers found in the Meta Ad Library compete with a business.
You receive the business profile and a list of Facebook Pages, each with its name, likes, the hosts its ads link to, a few ad texts, adsSeen (ads found in our sample), oldestDays (days the oldest of them has been running) and suspectDisposable.
For each Page decide:
- relation:
  "direct" = sells the same kind of product or service to the same kind of audience (a customer of one could buy from the other instead).
  "adjacent" = the same audience with a neighbouring product (it competes for the same buyer and its ads are worth studying, but it is not the same product).
  "none" = another audience, a marketplace or general retailer, a media/news Page, a personal Page that does not sell, the business itself, or a Page that looks disposable or like a scam (meaningless or random name, a random person's name selling an app, letters from mixed alphabets, no active ads, or flagged suspectDisposable).
- score 0 to 100: how strong a competitor it is to study (same offer and audience, clearly selling, scale of advertising: more adsSeen and older ads mean more scale).
- reason: one short line in Portuguese (Brazil) saying what the Page sells and why it is direct, adjacent or not a competitor. For "adjacent", name the bridge (what they have in common).
Judge only from what is given. Return exactly one item per Page, with the same pageId.`;

export const JUDGE_SCHEMA = obj({
  items: {
    type: 'array',
    items: obj({ pageId: { type: 'string' }, relation: { type: 'string', enum: ['direct', 'adjacent', 'none'] }, score: { type: 'integer' }, reason: { type: 'string' } }),
  },
});

export function judgeUserMessage(i: JudgeCompetitorsInput): string {
  const pages = i.pages.slice(0, RESEARCH_MAX_JUDGE_PAGES).map((p) => ({
    pageId: p.pageId, pageName: p.pageName, likeCount: p.likeCount, hosts: p.hosts.slice(0, 5),
    texts: p.texts.slice(0, 3).map((t) => t.replace(/\s+/g, ' ').slice(0, 300)),
    adsSeen: p.adsSeen, oldestDays: p.oldestDays, suspectDisposable: p.suspectDisposable,
  }));
  return `Pages (JSON):\n${JSON.stringify(pages, null, 1)}`;
}

const RELATIONS = new Set(['direct', 'adjacent', 'none']);
const NO_VERDICT = '(sem veredito do juiz)';

export function parseJudgement(text: string, i: JudgeCompetitorsInput): JudgeCompetitorsResult['items'] {
  const root = parseJsonObject(text);
  const list = Array.isArray(root.items) ? root.items : null;
  if (!list) throw new IntegracaoError('PROVIDER_ERROR', 'judge competitors: no items');
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of list) if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).pageId === 'string') byId.set(String((raw as Record<string, unknown>).pageId), raw as Record<string, unknown>);
  const asked = i.pages.slice(0, RESEARCH_MAX_JUDGE_PAGES);
  // resposta que não cobre nem metade das Páginas não serve (nova tentativa); o resto que faltar vira none/0
  const hits = asked.filter((p) => byId.has(p.pageId)).length;
  if (asked.length && hits < Math.ceil(asked.length / 2)) throw new IntegracaoError('PROVIDER_ERROR', `judge competitors: answered ${hits} of ${asked.length} pages`);
  return asked.map((p) => {
    const r = byId.get(p.pageId);
    if (!r) return { pageId: p.pageId, relation: 'none' as const, score: 0, reason: NO_VERDICT };
    let relation = (RELATIONS.has(String(r.relation)) ? String(r.relation) : 'none') as 'direct' | 'adjacent' | 'none';
    let score = clampInt(Number(r.score), 0, 100);
    // regra determinística (C.3): Página descartável nunca é aprovada
    if (p.suspectDisposable && relation !== 'none') {
      relation = 'none';
      score = Math.min(score, 40);
    }
    return { pageId: p.pageId, relation, score, reason: String(r.reason ?? '').trim().slice(0, 300) || NO_VERDICT };
  });
}

function clampInt(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
}
