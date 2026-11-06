// meta-oferta-v1 §3 (04/11): casamento anúncio da Meta → oferta do HookMill. Função PURA, calculada na leitura (D2):
// nada aqui fala com banco nem com rede. Ordem (D4): manual → manual da campanha → HookMill → campeão → link exato/prefixo
// → nome → irmão → só domínio. Empate entre ofertas não decide nada.
import type { MetaAdOfferInfo, MetaOfferDecision, MetaOfferFit, MetaOfferLinkLevel, MetaOfferMatch, MetaOfferNoneReason } from '@maquina/contratos';
import { getDomain } from 'tldts';
import { PLATFORM_DOMAINS } from '../integracoes/claude/subdominios';

// ───────── §3.1 normalizar URL ─────────

export interface UrlKey { host: string; site: string; path: string; platform: string | null; product: string | null }

/** Variações de domínio da mesma plataforma (mesmo id de produto): viram o nome canônico da tabela do §3.2. */
const PLATFORM_ALIASES: Record<string, string> = { 'ticto.app': 'ticto.com.br', 'checkout-ds24.com': 'digistore24.com', 'kiwify.app': 'kiwify.com.br' };
const GENERIC_SEGMENTS = new Set(['checkout', 'pay', 'ref']);

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Redirecionadores conhecidos (sem rede): host → params que guardam o destino. */
function unwrapTarget(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const pick = (...keys: string[]) => keys.map((k) => u.searchParams.get(k)).find((v) => !!v) ?? null;
  if ((host === 'l.facebook.com' || host === 'lm.facebook.com') && u.pathname === '/l.php') return pick('u');
  if (host === 'l.instagram.com') return pick('u');
  if ((host === 'www.google.com' || host === 'google.com') && u.pathname === '/url') return pick('q', 'url');
  if (host === 'out.reddit.com') return pick('url');
  return null;
}

function parse(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** §3.2: id do produto numa plataforma de terceiros (null = a URL não diz qual produto, e não casa por link). */
function productOf(platform: string, host: string, segs: string[], u: URL): string | null {
  const after = (key: string) => {
    const i = segs.indexOf(key);
    return i >= 0 && segs[i + 1] ? segs[i + 1] : null;
  };
  const sub = host.slice(0, -(platform.length + 1)).split('.').filter(Boolean);
  switch (platform) {
    case 'hotmart.com': case 'kiwify.com.br': case 'cakto.com.br': case 'ticto.com.br':
      return segs[0] ?? null;
    case 'eduzz.com':
      return segs.find((s) => /^\d+$/.test(s)) ?? null;
    case 'monetizze.com.br':
      return after('checkout');
    case 'perfectpay.com.br':
      return after('pay');
    case 'kirvano.com': case 'braip.com': case 'greenn.com.br':
      return [...segs].reverse().find((s) => !GENERIC_SEGMENTS.has(s)) ?? null;
    case 'clickbank.net': {
      const vendor = u.searchParams.get('vendor');
      if (vendor) return vendor.toLowerCase();
      return sub.length >= 2 ? sub[0] : null; // abc.hop.clickbank.net, abc.pay.clickbank.net
    }
    case 'digistore24.com':
      return after('product') ?? after('redir');
    case 'stripe.com':
      return sub[0] === 'buy' ? segs[0] ?? null : null;
    case 'mycartpanda.com': {
      const n = /\d+/.exec(segs.join('/'));
      return sub[0] && n ? `${sub[0]}/${n[0]}` : null;
    }
    default:
      return null;
  }
}

/** §3.1: URL → chave comparável (host sem www./m., site pelo PSL privado, path normalizado, identidade de plataforma). */
export function normalizeUrl(raw: string | null | undefined): UrlKey | null {
  if (!raw) return null;
  let u = parse(raw);
  for (let i = 0; u && i < 2; i++) {
    const target = unwrapTarget(u);
    if (!target) break;
    u = parse(target);
  }
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^(?:www|m)\./, '');
  if (!host) return null;
  const site = getDomain(host, { allowPrivateDomains: true }) ?? host;
  let path = safeDecode(u.pathname).toLowerCase().replace(/\/{2,}/g, '/');
  path = path.replace(/\/index\.(?:html?|php)$/, '').replace(/\/+$/, '');
  if (!path) path = '/';
  const canonical = PLATFORM_ALIASES[site] ?? site;
  const platform = PLATFORM_DOMAINS.has(canonical) || PLATFORM_ALIASES[site] ? canonical : null;
  const segs = path.split('/').filter(Boolean);
  return { host, site, path, platform, product: platform ? productOf(canonical, PLATFORM_ALIASES[site] ? host.replace(site, canonical) : host, segs, u) : null };
}

// ───────── §3.3 força do link ─────────

export type LinkStrength = 0 | 1 | 2 | 3;
const segPrefix = (short: string, long: string) => short !== '/' && long.startsWith(`${short}/`);

/** 3 exact (mesmo host+path, ou mesma plataforma+produto) · 2 prefix (fronteira de segmento, ref ≠ /) · 1 domain · 0. */
export function linkStrength(ad: UrlKey, ref: UrlKey): LinkStrength {
  if (ad.platform || ref.platform) return ad.platform && ad.platform === ref.platform && ad.product && ad.product === ref.product ? 3 : 0;
  if (ad.host === ref.host && ad.path === ref.path) return 3;
  if (ad.host === ref.host && ref.path !== '/' && ad.path !== '/' && (segPrefix(ref.path, ad.path) || segPrefix(ad.path, ref.path))) return 2;
  if (ad.site === ref.site) return 1;
  return 0;
}

// ───────── §3.4 nome ─────────

export const GENERIC_NAMES = new Set(['oferta', 'offer', 'produto', 'product', 'curso', 'course', 'teste', 'test', 'app', 'ebook', 'mentoria', 'promo', 'black', 'vsl', 'quiz']);
export const slug = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Agulha da oferta: ≥ 4 caracteres e fora de GENERIC_NAMES; senão a oferta não casa por nome. */
export function needleOf(name: string): string | null {
  const n = slug(name);
  return n.length >= 4 && !GENERIC_NAMES.has(n) ? n : null;
}

// ───────── entradas ─────────

export interface MatchOffer { id: string; name: string; archived: boolean; refs: UrlKey[] }
export interface MatchAd {
  metaAdId: string; name: string; campaignId: string; campaignName: string; adsetId: string; adsetName: string;
  destinationUrls: string[]; destinationSource: string | null; urlTags: string | null;
}
export interface ManualLink { level: MetaOfferLinkLevel; objectId: string; offerId: string; decision: MetaOfferDecision }
export interface MatchInput {
  offers: MatchOffer[];
  manual: ManualLink[];
  /** regra 3: MetaPublication.metaAdId → creative.offerId */
  hookmill: Map<string, string>;
  /** regra 4: Champion.metaAdId (não arquivado, o mais recente) → offerId */
  champion: Map<string, string>;
}

/** §3.3: refs de uma oferta (URLs cruas, normalizadas aqui; inválidas somem). */
export function refsOf(urls: (string | null | undefined)[]): UrlKey[] {
  const out: UrlKey[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const k = normalizeUrl(u);
    if (!k) continue;
    const id = `${k.host}|${k.path}|${k.platform}|${k.product}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(k);
    }
  }
  return out;
}

// ───────── §3.5 atribuição ─────────

export interface AdAttribution {
  offerId: string | null;
  match: MetaOfferMatch;
  confidence: 'high' | 'low' | null;
  /** força máxima do link por oferta (todas, inclusive excluídas) */
  strengths: Map<string, LinkStrength>;
  /** ofertas com NOT_BELONGS pro anúncio ou pra campanha dele */
  excluded: Set<string>;
  /** alguma regra empatou entre ofertas */
  tie: boolean;
  /** alguma regra apontou uma oferta excluída */
  hitExcluded: boolean;
  /** tem link legível (destinationUrls não vazio) */
  hasLink: boolean;
}

const HIGH: MetaOfferMatch[] = ['manual', 'manual_campaign', 'hookmill', 'champion', 'link'];

function haystackOf(ad: MatchAd): string {
  const utm: string[] = [];
  for (const raw of ad.destinationUrls) {
    try {
      const u = new URL(raw);
      for (const k of ['utm_campaign', 'utm_content']) {
        const v = u.searchParams.get(k);
        if (v) utm.push(v);
      }
    } catch {
      /* link inválido não reforça nome */
    }
  }
  return slug([ad.campaignName, ad.adsetName, ad.name, ad.urlTags ?? '', ...utm].join(' '));
}

/** Uma oferta só no topo (ou empate). `ids` já sem duplicata. */
const single = (ids: string[]) => (ids.length === 1 ? ids[0] : null);

/**
 * Atribui cada anúncio a no máximo uma oferta. Duas passadas: as regras 1-5 (fortes) de todos primeiro, porque a regra 7
 * (irmão) olha os vizinhos do mesmo conjunto/campanha atribuídos por elas.
 */
export function attributeAds(ads: MatchAd[], input: MatchInput): Map<string, AdAttribution> {
  const offers = input.offers;
  const needles = offers.map((o) => ({ id: o.id, needle: needleOf(o.name) })).filter((x): x is { id: string; needle: string } => !!x.needle);
  const manualOf = (level: MetaOfferLinkLevel, objectId: string, decision: MetaOfferDecision) =>
    input.manual.filter((m) => m.level === level && m.objectId === objectId && m.decision === decision).map((m) => m.offerId);
  const known = new Set(offers.map((o) => o.id));

  const base = new Map<string, AdAttribution>();
  for (const ad of ads) {
    const excluded = new Set([...manualOf('AD', ad.metaAdId, 'NOT_BELONGS'), ...manualOf('CAMPAIGN', ad.campaignId, 'NOT_BELONGS')]);
    const keys = refsOf(ad.destinationUrls);
    const strengths = new Map<string, LinkStrength>();
    for (const o of offers) {
      let best: LinkStrength = 0;
      for (const k of keys) for (const r of o.refs) best = Math.max(best, linkStrength(k, r)) as LinkStrength;
      strengths.set(o.id, best);
    }
    const att: AdAttribution = { offerId: null, match: 'none', confidence: null, strengths, excluded, tie: false, hitExcluded: false, hasLink: ad.destinationUrls.length > 0 };
    const take = (offerId: string | null | undefined, match: MetaOfferMatch): boolean => {
      if (!offerId || !known.has(offerId)) return false;
      if (excluded.has(offerId)) {
        att.hitExcluded = true; // NOT_BELONGS manda: a regra é pulada
        return false;
      }
      att.offerId = offerId;
      att.match = match;
      att.confidence = HIGH.includes(match) ? 'high' : 'low';
      return true;
    };
    const many = (ids: string[], match: MetaOfferMatch): boolean => {
      const uniq = [...new Set(ids)];
      if (uniq.some((id) => excluded.has(id))) att.hitExcluded = true;
      const ok = uniq.filter((id) => known.has(id) && !excluded.has(id));
      if (ok.length > 1) att.tie = true;
      return take(single(ok), match);
    };
    // 1-4
    if (many(manualOf('AD', ad.metaAdId, 'BELONGS'), 'manual')) { base.set(ad.metaAdId, att); continue; }
    if (many(manualOf('CAMPAIGN', ad.campaignId, 'BELONGS'), 'manual_campaign')) { base.set(ad.metaAdId, att); continue; }
    if (take(input.hookmill.get(ad.metaAdId), 'hookmill')) { base.set(ad.metaAdId, att); continue; }
    if (take(input.champion.get(ad.metaAdId), 'champion')) { base.set(ad.metaAdId, att); continue; }
    // 5: força 3 ou 2, só a força máxima entre as ofertas não excluídas
    const open = offers.filter((o) => !excluded.has(o.id));
    const top = Math.max(0, ...open.map((o) => strengths.get(o.id)!));
    if ([...excluded].some((id) => (strengths.get(id) ?? 0) >= 2)) att.hitExcluded = true;
    if (top >= 2) many(open.filter((o) => strengths.get(o.id) === top).map((o) => o.id), 'link');
    base.set(ad.metaAdId, att);
  }

  // 6-8 pra quem ficou sem oferta
  const strong = (id: string) => {
    const a = base.get(id);
    return a && a.offerId && HIGH.includes(a.match) ? a.offerId : null;
  };
  const byAdset = groupBy(ads, (a) => a.adsetId);
  const byCampaign = groupBy(ads, (a) => a.campaignId);
  for (const ad of ads) {
    const att = base.get(ad.metaAdId)!;
    if (att.offerId) continue;
    const { excluded } = att;
    const take = (offerId: string, match: MetaOfferMatch) => {
      att.offerId = offerId;
      att.match = match;
      att.confidence = HIGH.includes(match) ? 'high' : 'low';
    };
    // 6: nome
    const hay = haystackOf(ad);
    const hits = needles.filter((n) => hay.includes(n.needle));
    if (hits.some((h) => excluded.has(h.id))) att.hitExcluded = true;
    const open = hits.filter((h) => !excluded.has(h.id));
    // agulha contida numa mais longa ("spy" em "spygram") perde pra mais longa
    const longest = open.filter((h) => !open.some((o) => o.id !== h.id && o.needle.length > h.needle.length && o.needle.includes(h.needle)));
    const ids = [...new Set(longest.map((h) => h.id))];
    if (ids.length === 1 && !open.some((o) => o.id !== ids[0] && o.needle === longest[0].needle)) {
      take(ids[0], 'name');
      continue;
    }
    if (ids.length > 1) att.tie = true;
    // 7: irmão (sem link legível): conjunto, depois campanha
    if (!att.hasLink) {
      const sib = siblingOffer(ad, byAdset.get(ad.adsetId) ?? [], strong) ?? siblingOffer(ad, byCampaign.get(ad.campaignId) ?? [], strong);
      if (sib && excluded.has(sib)) att.hitExcluded = true;
      else if (sib) {
        take(sib, 'sibling');
        continue;
      }
    }
    // 8: força 1 numa oferta só
    const weak = input.offers.filter((o) => !excluded.has(o.id) && (att.strengths.get(o.id) ?? 0) >= 1).map((o) => o.id);
    if ([...excluded].some((id) => (att.strengths.get(id) ?? 0) >= 1)) att.hitExcluded = true;
    if (weak.length === 1) take(weak[0], 'domain');
    else if (weak.length > 1) att.tie = true;
  }
  return base;
}

/** Regra 7: os outros do grupo atribuídos pelas regras 1-5 apontam todos pra mesma oferta (≥ 1). */
function siblingOffer(ad: MatchAd, group: MatchAd[], strong: (id: string) => string | null): string | null {
  const ids = new Set(group.filter((g) => g.metaAdId !== ad.metaAdId).map((g) => strong(g.metaAdId)).filter((x): x is string => !!x));
  return ids.size === 1 ? [...ids][0] : null;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

// ───────── §3.6 fit relativo à oferta pedida ─────────

/** Correção que vale pra oferta pedida: AD antes de CAMPAIGN (pro "Desfazer"). */
export function manualFor(ad: Pick<MatchAd, 'metaAdId' | 'campaignId'>, offerId: string, manual: ManualLink[]): { level: MetaOfferLinkLevel; decision: MetaOfferDecision } | null {
  const hit = manual.find((m) => m.level === 'AD' && m.objectId === ad.metaAdId && m.offerId === offerId)
    ?? manual.find((m) => m.level === 'CAMPAIGN' && m.objectId === ad.campaignId && m.offerId === offerId);
  return hit ? { level: hit.level, decision: hit.decision } : null;
}

export function fitOf(att: AdAttribution, offerId: string, offers: MatchOffer[]): MetaOfferFit {
  if (att.offerId === offerId) return 'this';
  if (att.offerId) return 'other';
  if (att.excluded.has(offerId)) return 'other';
  const x = offers.find((o) => o.id === offerId);
  if (att.hasLink && x && x.refs.length > 0 && [...att.strengths.values()].every((s) => s === 0)) return 'other'; // foreign_link (D5)
  return 'unknown';
}

/** Só com `offerId` da linha null. Sem oferta pedida, "a oferta tem URL" = alguma oferta do workspace tem. */
export function noneReasonOf(att: AdAttribution, ad: Pick<MatchAd, 'destinationSource'>, offers: MatchOffer[], requested: string | null): MetaOfferNoneReason | null {
  if (att.offerId) return null;
  if (att.hitExcluded || (requested && att.excluded.has(requested))) return 'excluded';
  if (ad.destinationSource == null) return 'link_pending';
  if (att.tie) return 'ambiguous';
  if (!att.hasLink) return 'no_link';
  const hasUrl = requested ? (offers.find((o) => o.id === requested)?.refs.length ?? 0) > 0 : offers.some((o) => o.refs.length > 0);
  if (!hasUrl) return 'offer_has_no_url';
  if ([...att.strengths.values()].every((s) => s === 0)) return 'foreign_link';
  return 'ambiguous';
}

const hostOf = (u: string | undefined): string | null => {
  if (!u) return null;
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

/** §4.5: `MetaAdRow.offer` de uma linha. `requested` = `?offerId` (null = sem grupos, fit null). */
export function offerInfoOf(
  ad: MatchAd, att: AdAttribution, input: Pick<MatchInput, 'offers' | 'manual'>, requested: string | null, canEdit: boolean,
): MetaAdOfferInfo {
  const offer = att.offerId ? input.offers.find((o) => o.id === att.offerId) ?? null : null;
  return {
    fit: requested ? fitOf(att, requested, input.offers) : null,
    offerId: offer?.id ?? null, offerName: offer?.name ?? null,
    match: att.match, confidence: att.confidence,
    noneReason: noneReasonOf(att, ad, input.offers, requested),
    destinationUrl: ad.destinationUrls[0] ?? null,
    destinationHost: hostOf(ad.destinationUrls[0]),
    linkPending: ad.destinationSource == null,
    manual: requested ? manualFor(ad, requested, input.manual) : null,
    canEdit,
  };
}

export const FIT_RANK: Record<MetaOfferFit, number> = { this: 0, unknown: 1, other: 2 };
/** §4.4: cobertura de link. */
export function linkCoverage(ads: Pick<MatchAd, 'destinationUrls' | 'destinationSource'>[]): { read: number; pending: number; unreadable: number } {
  let read = 0;
  let pending = 0;
  let unreadable = 0;
  for (const a of ads) {
    if (a.destinationUrls.length) read++;
    else if (a.destinationSource == null) pending++;
    else unreadable++;
  }
  return { read, pending, unreadable };
}
