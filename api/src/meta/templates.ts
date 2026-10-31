// meta-templates-v1 (docs/contratos/meta-templates-v1.md, aprovado 29/10 com P1 REUSE, P2 orçamento obrigatório, P3 lote):
// funções puras do template de publicação — validação do corpo, padrões de nome, plano do lote (ad sets de até `max`),
// estrutura que vai pra porta e o mapeamento da leitura da Graph (import) pro MetaTemplateBody com o `unsupported`.
import type {
  MetaBidStrategy, MetaCallToAction, MetaObjective, MetaPixelEvent, MetaPublishBatchPlan, MetaSpecialAdCategory, MetaTemplateAd, MetaTemplateAdset,
  MetaTemplateBody, MetaTemplateCampaign, MetaTemplateImportResult, MetaTemplateImportedFrom,
} from '@maquina/contratos';
import type { MetaPublishStructure, MetaTemplateSourceRead } from '../integracoes';
import type { FieldError } from '../common/http/validation';
import { CTAS, OBJECTIVES, SPECIAL_CATEGORIES } from './meta.dto';

export const NEEDS_PIXEL: readonly MetaObjective[] = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION'];
export const PIXEL_EVENTS: readonly MetaPixelEvent[] = ['PURCHASE', 'LEAD', 'COMPLETE_REGISTRATION', 'SCHEDULE', 'SUBSCRIBE'];
export const PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger'] as const;
/** padrão de fábrica do Tordan (§0.4) */
export const DEFAULT_ADS_PER_ADSET = { min: 4, max: 8 };
export const DEFAULT_NAME_PATTERNS = { campaign: 'HookMill — {offer}', adset: '{offer} — {date} — {n}', ad: '{code}' };
const BID_STRATEGIES: readonly MetaBidStrategy[] = ['LOWEST_COST', 'COST_CAP', 'BID_CAP'];
const MAX_BUDGET_MINOR = 100_000_000_00;

// ───────── validação (VALIDATION_ERROR { fields }) ─────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const nullOr = (v: unknown, ok: (v: unknown) => boolean) => v === null || ok(v);
const isUrl = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname.includes('.');
  } catch {
    return false;
  }
};

const CAMPAIGN_KEYS = ['destination', 'objective', 'budgetMode', 'dailyBudgetMinor', 'bidStrategy', 'bidAmountMinor', 'specialAdCategories', 'namePattern'];
const ADSET_KEYS = ['pixelId', 'pixelEvent', 'countries', 'ageMin', 'ageMax', 'genders', 'advantageAudience', 'placements', 'adsPerAdset', 'namePattern'];
const AD_KEYS = ['primaryText', 'headline', 'description', 'callToAction', 'link', 'urlTags', 'namePattern'];

function section(out: FieldError[], name: string, v: unknown, keys: string[], rules: Record<string, [(x: unknown) => boolean, string]>): v is Obj {
  if (!isObj(v)) {
    out.push({ field: name, rule: 'isObject' });
    return false;
  }
  for (const k of Object.keys(v)) if (!keys.includes(k)) out.push({ field: `${name}.${k}`, rule: 'notAllowed' });
  for (const [k, [ok, rule]] of Object.entries(rules)) if (!ok(v[k])) out.push({ field: `${name}.${k}`, rule });
  return true;
}

export function campaignErrors(v: unknown): FieldError[] {
  const out: FieldError[] = [];
  if (!section(out, 'campaign', v, CAMPAIGN_KEYS, {
    destination: [(x) => x === 'NEW_CAMPAIGN' || x === 'REUSE_CAMPAIGN', 'isIn'],
    objective: [(x) => (OBJECTIVES as readonly unknown[]).includes(x), 'isIn'],
    budgetMode: [(x) => x === 'CBO' || x === 'ABO', 'isIn'],
    dailyBudgetMinor: [(x) => isInt(x, 1, MAX_BUDGET_MINOR), 'isInt'], // P2: obrigatório, sem padrão escondido
    bidStrategy: [(x) => (BID_STRATEGIES as readonly unknown[]).includes(x), 'isIn'],
    bidAmountMinor: [(x) => nullOr(x, (y) => isInt(y, 1, MAX_BUDGET_MINOR)), 'isInt'],
    specialAdCategories: [(x) => Array.isArray(x) && x.length <= 5 && x.every((c) => (SPECIAL_CATEGORIES as readonly unknown[]).includes(c)), 'isIn'],
    namePattern: [(x) => isStr(x, 1, 120), 'length'],
  })) return out;
  const c = v as Obj;
  if ((c.bidStrategy === 'COST_CAP' || c.bidStrategy === 'BID_CAP') && c.bidAmountMinor == null) out.push({ field: 'campaign.bidAmountMinor', rule: 'requiredForCap' });
  return out;
}

export function placementsOk(p: unknown): boolean {
  if (p === 'AUTO') return true;
  if (!isObj(p) || Object.keys(p).some((k) => k !== 'platforms' && k !== 'positions')) return false;
  const { platforms, positions } = p as { platforms: unknown; positions: unknown };
  if (!Array.isArray(platforms) || !platforms.length || new Set(platforms).size !== platforms.length) return false;
  if (!platforms.every((x) => (PLATFORMS as readonly unknown[]).includes(x))) return false;
  if (!Array.isArray(positions) || positions.length > 40) return false;
  // posição = `<plataforma>_<posição da Graph>` de uma plataforma escolhida (ex. instagram_story, facebook_feed)
  return positions.every((pos) => typeof pos === 'string' && /^[a-z_]{3,60}$/.test(pos)
    && platforms.some((pl) => pos.startsWith(`${pl}_`) && pos.length > String(pl).length + 1));
}

export function adsetErrors(v: unknown): FieldError[] {
  const out: FieldError[] = [];
  if (!section(out, 'adset', v, ADSET_KEYS, {
    pixelId: [(x) => nullOr(x, (y) => isStr(y, 1, 64)), 'isString'],
    pixelEvent: [(x) => nullOr(x, (y) => (PIXEL_EVENTS as readonly unknown[]).includes(y)), 'isIn'],
    countries: [(x) => Array.isArray(x) && x.length >= 1 && x.length <= 10 && x.every((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)), 'isCountryList'],
    ageMin: [(x) => isInt(x, 18, 65), 'isInt'],
    ageMax: [(x) => isInt(x, 18, 65), 'isInt'],
    genders: [(x) => x === 'ALL' || x === 'MALE' || x === 'FEMALE', 'isIn'],
    advantageAudience: [(x) => typeof x === 'boolean', 'isBoolean'],
    placements: [placementsOk, 'isPlacements'],
    adsPerAdset: [(x) => isObj(x) && Object.keys(x).every((k) => k === 'min' || k === 'max') && isInt(x.min, 1, 50) && isInt(x.max, 1, 50) && (x.min as number) <= (x.max as number), 'minMax1to50'],
    namePattern: [(x) => isStr(x, 1, 120), 'length'],
  })) return out;
  const a = v as Obj;
  if (isInt(a.ageMin, 18, 65) && isInt(a.ageMax, 18, 65) && (a.ageMin as number) > (a.ageMax as number)) out.push({ field: 'adset.ageMax', rule: 'gteAgeMin' });
  return out;
}

export function adErrors(v: unknown): FieldError[] {
  const out: FieldError[] = [];
  section(out, 'ad', v, AD_KEYS, {
    primaryText: [(x) => nullOr(x, (y) => isStr(y, 1, 2000)), 'length'],
    headline: [(x) => nullOr(x, (y) => isStr(y, 1, 255)), 'length'],
    description: [(x) => nullOr(x, (y) => isStr(y, 1, 125)), 'length'],
    callToAction: [(x) => (CTAS as readonly unknown[]).includes(x), 'isIn'],
    link: [isUrl, 'isUrl'],
    urlTags: [(x) => nullOr(x, (y) => typeof y === 'string' && y.length <= 1024 && !y.startsWith('?')), 'isQueryString'],
    namePattern: [(x) => isStr(x, 1, 120), 'length'],
  });
  return out;
}

export function importedFromOk(v: unknown): boolean {
  return v == null || (isObj(v) && ['campaign', 'adset', 'ad'].includes(v.level as string) && isStr(v.id, 1, 64) && typeof v.name === 'string' && v.name.length <= 400);
}

/** Erros de formato de um corpo inteiro (POST) ou parcial (PATCH: só as seções que vieram, cada uma inteira). */
export function templateBodyErrors(b: Partial<MetaTemplateBody>, partial: boolean): FieldError[] {
  const out: FieldError[] = [];
  if (!partial || b.name !== undefined) if (!isStr(b.name, 1, 60)) out.push({ field: 'name', rule: 'length' });
  if (b.isDefault !== undefined && typeof b.isDefault !== 'boolean') out.push({ field: 'isDefault', rule: 'isBoolean' });
  if (!partial || b.campaign !== undefined) out.push(...campaignErrors(b.campaign));
  if (!partial || b.adset !== undefined) out.push(...adsetErrors(b.adset));
  if (!partial || b.ad !== undefined) out.push(...adErrors(b.ad));
  if (b.importedFrom !== undefined && !importedFromOk(b.importedFrom)) out.push({ field: 'importedFrom', rule: 'isImportedFrom' });
  return out;
}

/** 422 META_PIXEL_REQUIRED: evento de pixel sem pixel, ou objetivo que exige pixel sem pixel (como na publicação de hoje). */
export function pixelMissing(campaign: MetaTemplateCampaign, adset: MetaTemplateAdset): boolean {
  if (adset.pixelId) return false;
  return !!adset.pixelEvent || NEEDS_PIXEL.includes(campaign.objective);
}

/** O que muda a campanha reaproveitada (objetivo/CBO-ABO/lance/categorias/destino): trocar = esquece a campanha guardada. */
export function campaignShapeChanged(a: MetaTemplateCampaign, b: MetaTemplateCampaign): boolean {
  return a.destination !== b.destination || a.objective !== b.objective || a.budgetMode !== b.budgetMode || a.bidStrategy !== b.bidStrategy
    || a.bidAmountMinor !== b.bidAmountMinor || [...a.specialAdCategories].sort().join() !== [...b.specialAdCategories].sort().join();
}

// ───────── nomes e lote ─────────

export interface NameVars { offer: string; code: string; date: string; n: number }
/** `{offer}` `{code}` `{date}` (AAAA-MM-DD) `{n}`; espaços colapsados; teto de 400 (limite de nome da Meta). */
export function resolveName(pattern: string, v: NameVars): string {
  const out = pattern
    .replace(/\{offer\}/g, v.offer).replace(/\{code\}/g, v.code).replace(/\{date\}/g, v.date).replace(/\{n\}/g, String(v.n))
    .replace(/\s+/g, ' ').trim();
  return (out || v.code).slice(0, 400);
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Ad sets de até `max`, na ordem pedida; o último fica com o resto e é marcado `belowMin` se tiver menos que `min`. */
export function planGroups<T>(items: T[], per: { min: number; max: number }): { items: T[]; belowMin: boolean }[] {
  const groups: { items: T[]; belowMin: boolean }[] = [];
  for (let i = 0; i < items.length; i += per.max) {
    const chunk = items.slice(i, i + per.max);
    groups.push({ items: chunk, belowMin: chunk.length < per.min });
  }
  return groups;
}
export function planOf(groups: { name: string; creativeIds: string[]; belowMin: boolean }[]): MetaPublishBatchPlan {
  return { adsets: groups.map((g) => ({ name: g.name, creativeIds: g.creativeIds, belowMin: g.belowMin })) };
}

/** groupKey = `<lote>:<n>` (n = 1, 2…): mesmo ad set = mesma chave; o prefixo junta o lote (NEW_CAMPAIGN = 1 campanha por lote). */
export const groupKeyOf = (batchId: string, n: number) => `${batchId}:${n}`;
export function parseGroupKey(k: string | null | undefined): { batchId: string; n: number } | null {
  const m = k ? /^(.+):(\d+)$/.exec(k) : null;
  return m ? { batchId: m[1], n: Number(m[2]) } : null;
}

/** Estrutura que a porta usa (contrato.ts MetaPublishStructure). */
export function structureOf(t: { campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd }, names: { campaign: string; adset: string }): MetaPublishStructure {
  return {
    campaignName: names.campaign, adsetName: names.adset,
    budgetMode: t.campaign.budgetMode, bidStrategy: t.campaign.bidStrategy,
    bidAmountMinor: t.campaign.bidStrategy === 'LOWEST_COST' ? null : t.campaign.bidAmountMinor,
    genders: t.adset.genders, advantageAudience: t.adset.advantageAudience,
    placements: t.adset.placements === 'AUTO' ? 'AUTO' : { platforms: [...t.adset.placements.platforms], positions: [...t.adset.placements.positions] },
    urlTags: t.ad.urlTags,
  };
}

// ───────── import (§3): leitura da Graph → MetaTemplateBody + unsupported ─────────

const GRAPH_BID: Record<string, MetaBidStrategy> = { LOWEST_COST_WITHOUT_CAP: 'LOWEST_COST', COST_CAP: 'COST_CAP', LOWEST_COST_WITH_BID_CAP: 'BID_CAP' };
/** chaves de targeting que o template entende; o resto (público personalizado, exclusões, interesses, idiomas…) vai pro unsupported */
const TARGETING_KNOWN = new Set([
  'geo_locations', 'age_min', 'age_max', 'genders', 'targeting_automation', 'publisher_platforms',
  'facebook_positions', 'instagram_positions', 'audience_network_positions', 'messenger_positions',
  'age_range', 'brand_safety_content_filter_levels', 'targeting_relaxation_types', 'device_platforms',
]);
const GEO_KNOWN = new Set(['countries', 'location_types']);

const short = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 200);
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? String(x.name ?? x.id ?? JSON.stringify(x)) : String(x))).join(', ').slice(0, 200);
  return JSON.stringify(v).slice(0, 200);
};

export function templateFromSource(src: MetaTemplateSourceRead, ctx: { level: 'campaign' | 'adset' | 'ad'; id: string; defaultCountries: string[]; fallbackLink: string | null }): MetaTemplateImportResult {
  const unsupported: { field: string; value: string }[] = [];
  const miss = (field: string, value: unknown) => unsupported.push({ field, value: short(value) });
  const c = src.campaign;
  const a = src.adset;

  // campanha
  let objective: MetaObjective = 'OUTCOME_TRAFFIC';
  if ((OBJECTIVES as readonly string[]).includes(c.objective)) objective = c.objective as MetaObjective;
  else miss('campaign.objective', c.objective);
  const cbo = c.dailyBudgetMinor != null || c.lifetimeBudgetMinor != null;
  if (c.lifetimeBudgetMinor != null) miss('campaign.lifetimeBudget', c.lifetimeBudgetMinor);
  if (a?.lifetimeBudgetMinor != null) miss('adset.lifetimeBudget', a.lifetimeBudgetMinor);
  const daily = cbo ? c.dailyBudgetMinor : a?.dailyBudgetMinor ?? null;
  // P2: sem orçamento diário na origem = 0 (a janela obriga a pessoa a preencher; nada de padrão escondido)
  if (daily == null && c.lifetimeBudgetMinor == null && a?.lifetimeBudgetMinor == null) miss('campaign.dailyBudgetMinor', 'no daily budget');
  const graphBid = (cbo ? c.bidStrategy : a?.bidStrategy) ?? c.bidStrategy ?? a?.bidStrategy ?? null;
  let bidStrategy: MetaBidStrategy = 'LOWEST_COST';
  if (graphBid && GRAPH_BID[graphBid]) bidStrategy = GRAPH_BID[graphBid];
  else if (graphBid) miss('campaign.bidStrategy', graphBid);
  const bidAmountMinor = bidStrategy === 'LOWEST_COST' ? null : a?.bidAmountMinor ?? null;
  const special: MetaSpecialAdCategory[] = [];
  for (const s of c.specialAdCategories) {
    if ((SPECIAL_CATEGORIES as readonly string[]).includes(s)) special.push(s as MetaSpecialAdCategory);
    else miss('campaign.specialAdCategories', s);
  }
  if (c.stopTime) miss('campaign.schedule', c.stopTime);

  // conjunto
  const t = (a?.targeting ?? {}) as Obj;
  const geo = (isObj(t.geo_locations) ? t.geo_locations : {}) as Obj;
  let countries = Array.isArray(geo.countries) ? geo.countries.map(String).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 10) : [];
  for (const [k, v] of Object.entries(geo)) if (!GEO_KNOWN.has(k)) miss(`adset.targeting.geo_locations.${k}`, v);
  if (!countries.length) countries = ctx.defaultCountries.slice(0, 10);
  for (const [k, v] of Object.entries(t)) if (!TARGETING_KNOWN.has(k) && v !== undefined) miss(`adset.targeting.${k}`, v);
  const clampAge = (n: unknown, d: number) => (typeof n === 'number' ? Math.min(65, Math.max(18, Math.round(n))) : d);
  const ageMin = clampAge(t.age_min, 18);
  const ageMax = Math.max(ageMin, clampAge(t.age_max, 65));
  const g = Array.isArray(t.genders) ? t.genders.map(Number) : [];
  const genders = g.length === 1 && g[0] === 1 ? 'MALE' : g.length === 1 && g[0] === 2 ? 'FEMALE' : 'ALL';
  const auto = isObj(t.targeting_automation) ? t.targeting_automation.advantage_audience : undefined;
  const advantageAudience = auto === undefined ? true : Number(auto) === 1;
  let placements: MetaTemplateAdset['placements'] = 'AUTO';
  if (Array.isArray(t.publisher_platforms) && t.publisher_platforms.length) {
    const platforms = t.publisher_platforms.map(String).filter((p): p is (typeof PLATFORMS)[number] => (PLATFORMS as readonly string[]).includes(p));
    for (const p of t.publisher_platforms.map(String)) if (!(PLATFORMS as readonly string[]).includes(p)) miss('adset.placements', p);
    const positions: string[] = [];
    for (const p of platforms) {
      const list = t[`${p}_positions`];
      if (Array.isArray(list)) for (const pos of list) positions.push(`${p}_${String(pos)}`);
    }
    if (platforms.length) placements = { platforms, positions: positions.filter((pos) => /^[a-z_]{3,60}$/.test(pos)) };
  }
  const po = a?.promotedObject ?? null;
  const pixelId: string | null = po?.pixelId ?? null;
  let pixelEvent: MetaPixelEvent | null = null;
  if (po?.customEventType) {
    if ((PIXEL_EVENTS as readonly string[]).includes(po.customEventType)) pixelEvent = po.customEventType as MetaPixelEvent;
    else miss('adset.pixelEvent', po.customEventType);
  }
  if (po?.applicationId) miss('adset.promotedObject.application', po.applicationId);
  const goal = a?.optimizationGoal ?? null;
  if (goal && goal !== 'OFFSITE_CONVERSIONS' && goal !== 'LINK_CLICKS') miss('adset.optimizationGoal', goal);
  if (!pixelId) pixelEvent = null;
  if (a?.endTime) miss('adset.schedule', a.endTime);
  if (!a) miss('adset', 'no ad set in this campaign');

  // anúncio: CTA, link e UTM copiados; o texto fica null (herda do criativo e da oferta de cada peça, como hoje)
  const cr = src.ad?.creative ?? null;
  let callToAction: MetaCallToAction = objective === 'OUTCOME_SALES' ? 'SHOP_NOW' : objective === 'OUTCOME_LEADS' ? 'SIGN_UP' : objective === 'OUTCOME_APP_PROMOTION' ? 'DOWNLOAD' : 'LEARN_MORE';
  if (cr?.callToAction) {
    if ((CTAS as readonly string[]).includes(cr.callToAction)) callToAction = cr.callToAction as MetaCallToAction;
    else miss('ad.callToAction', cr.callToAction);
  }
  if (!src.ad) miss('ad', 'no ad in this ad set');
  const link = cr?.link ?? ctx.fallbackLink ?? '';

  const name = ctx.level === 'campaign' ? c.name : ctx.level === 'adset' ? a?.name ?? '' : src.ad?.name ?? '';
  const importedFrom: MetaTemplateImportedFrom = { level: ctx.level, id: ctx.id, name };
  const template: MetaTemplateBody = {
    name: name.slice(0, 60) || 'Imported template',
    campaign: {
      destination: 'REUSE_CAMPAIGN', objective, budgetMode: cbo ? 'CBO' : 'ABO', dailyBudgetMinor: daily ?? 0,
      bidStrategy, bidAmountMinor, specialAdCategories: special, namePattern: DEFAULT_NAME_PATTERNS.campaign,
    },
    adset: {
      pixelId, pixelEvent, countries, ageMin, ageMax, genders, advantageAudience, placements,
      adsPerAdset: { ...DEFAULT_ADS_PER_ADSET }, namePattern: DEFAULT_NAME_PATTERNS.adset,
    },
    ad: { primaryText: null, headline: null, description: null, callToAction, link, urlTags: cr?.urlTags ?? null, namePattern: DEFAULT_NAME_PATTERNS.ad },
    importedFrom,
  };
  return { template, unsupported };
}
