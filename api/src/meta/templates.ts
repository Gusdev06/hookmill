// meta-templates-v1 (docs/contratos/meta-templates-v1.md, aprovado 29/10 com P1 REUSE, P2 orçamento obrigatório, P3 lote):
// funções puras do template de publicação — validação do corpo, padrões de nome, plano do lote (ad sets de até `max`),
// estrutura que vai pra porta e o mapeamento da leitura da Graph (import) pro MetaTemplateBody com o `unsupported`.
// meta-templates-v2 (docs/contratos/meta-templates-v2.md, aprovado 03/11): 6 objetivos no template, orçamento total,
// agendamento (fuso da conta, fim relativo), idiomas, públicos e conta do Instagram — validação do §3, resolução do
// agendamento no envio (§2.3) e importação do §7. Campo novo ausente = comportamento v1.
import type {
  MetaAudienceRef, MetaBidStrategy, MetaBudgetTooLowDetails, MetaBudgetType, MetaCallToAction, MetaInstagramAccount, MetaLocaleOption, MetaLocaleRef, MetaObjective, MetaPixelEvent,
  MetaPublishBatchPlan, MetaPublishSettings, MetaSpecialAdCategory, MetaTemplateAd, MetaTemplateAdset, MetaTemplateBody, MetaTemplateCampaign,
  MetaTemplateImportResult, MetaTemplateImportedFrom, MetaTemplateOptimizationGoal, MetaTemplateSchedule,
} from '@maquina/contratos';
import type { MetaPublishStructure, MetaTemplateSourceRead } from '../integracoes';
import type { FieldError } from '../common/http/validation';
import { CTAS, SPECIAL_CATEGORIES } from './meta.dto';

export const NEEDS_PIXEL: readonly MetaObjective[] = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION'];
/** v2 §2.1/§3: o template aceita os 6 (o Custom continua com os 4 do `OBJECTIVES` do DTO). */
export const TEMPLATE_OBJECTIVES: readonly MetaObjective[] = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT'];
/** v2 §2.1: metas de desempenho por objetivo (só Awareness/Engagement têm); o 1º é o padrão quando `optimizationGoal` = null. */
export const GOALS_BY_OBJECTIVE: Partial<Record<MetaObjective, readonly MetaTemplateOptimizationGoal[]>> = {
  OUTCOME_AWARENESS: ['REACH', 'IMPRESSIONS', 'AD_RECALL_LIFT', 'THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'],
  OUTCOME_ENGAGEMENT: ['THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', 'POST_ENGAGEMENT'],
};
const ALL_GOALS = new Set(Object.values(GOALS_BY_OBJECTIVE).flat());
/** Awareness/Engagement: sem pixel, com meta de desempenho. */
export const hasGoal = (o: MetaObjective) => !!GOALS_BY_OBJECTIVE[o];
/** null → o padrão do objetivo (REACH / THRUPLAY); objetivos sem meta → null. */
export function goalOf(objective: MetaObjective, goal: MetaTemplateOptimizationGoal | null | undefined): MetaTemplateOptimizationGoal | null {
  const list = GOALS_BY_OBJECTIVE[objective];
  return list ? goal ?? list[0] : null;
}
export const budgetTypeOf = (c: Pick<MetaTemplateCampaign, 'budgetType'>): MetaBudgetType => c.budgetType ?? 'DAILY';
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

const CAMPAIGN_KEYS = ['destination', 'objective', 'budgetMode', 'dailyBudgetMinor', 'budgetType', 'lifetimeBudgetMinor', 'bidStrategy', 'bidAmountMinor', 'specialAdCategories', 'namePattern'];
const ADSET_KEYS = [
  'pixelId', 'pixelEvent', 'countries', 'ageMin', 'ageMax', 'genders', 'advantageAudience', 'placements', 'adsPerAdset', 'namePattern',
  'optimizationGoal', 'schedule', 'locales', 'customAudiences', 'excludedCustomAudiences',
];
const AD_KEYS = ['primaryText', 'headline', 'description', 'callToAction', 'link', 'urlTags', 'namePattern', 'instagramAccount'];

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
    objective: [(x) => (TEMPLATE_OBJECTIVES as readonly unknown[]).includes(x), 'isIn'],
    budgetMode: [(x) => x === 'CBO' || x === 'ABO', 'isIn'],
    budgetType: [(x) => x === undefined || x === 'DAILY' || x === 'LIFETIME', 'isIn'],
    bidStrategy: [(x) => (BID_STRATEGIES as readonly unknown[]).includes(x), 'isIn'],
    bidAmountMinor: [(x) => nullOr(x, (y) => isInt(y, 1, MAX_BUDGET_MINOR)), 'isInt'],
    specialAdCategories: [(x) => Array.isArray(x) && x.length <= 5 && x.every((c) => (SPECIAL_CATEGORIES as readonly unknown[]).includes(c)), 'isIn'],
    namePattern: [(x) => isStr(x, 1, 120), 'length'],
  })) return out;
  const c = v as Obj;
  if ((c.bidStrategy === 'COST_CAP' || c.bidStrategy === 'BID_CAP') && c.bidAmountMinor == null) out.push({ field: 'campaign.bidAmountMinor', rule: 'requiredForCap' });
  // v2 §2.2: DAILY = diário ≥ 1 e sem total (P2: obrigatório, sem padrão escondido); LIFETIME = total ≥ 1 e diário 0
  if (c.budgetType === 'LIFETIME') {
    if (c.dailyBudgetMinor !== 0) out.push({ field: 'campaign.dailyBudgetMinor', rule: 'zeroForLifetime' });
    if (!isInt(c.lifetimeBudgetMinor, 1, MAX_BUDGET_MINOR)) out.push({ field: 'campaign.lifetimeBudgetMinor', rule: 'isInt' });
    if (c.budgetMode === 'CBO' && c.destination === 'REUSE_CAMPAIGN') out.push({ field: 'campaign.destination', rule: 'lifetimeCboNeedsNewCampaign' });
  } else {
    if (!isInt(c.dailyBudgetMinor, 1, MAX_BUDGET_MINOR)) out.push({ field: 'campaign.dailyBudgetMinor', rule: 'isInt' });
    if (c.lifetimeBudgetMinor != null) out.push({ field: 'campaign.lifetimeBudgetMinor', rule: 'notAllowed' });
  }
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
    optimizationGoal: [(x) => x == null || ALL_GOALS.has(x as MetaTemplateOptimizationGoal), 'isIn'],
    locales: [(x) => x === undefined || localesOk(x), 'isLocaleList'],
    customAudiences: [(x) => x === undefined || audiencesOk(x), 'isAudienceList'],
    excludedCustomAudiences: [(x) => x === undefined || audiencesOk(x), 'isAudienceList'],
  })) return out;
  const a = v as Obj;
  if (isInt(a.ageMin, 18, 65) && isInt(a.ageMax, 18, 65) && (a.ageMin as number) > (a.ageMax as number)) out.push({ field: 'adset.ageMax', rule: 'gteAgeMin' });
  out.push(...scheduleFormatErrors(a.schedule));
  if (Array.isArray(a.customAudiences) && Array.isArray(a.excludedCustomAudiences)) {
    const inc = new Set(a.customAudiences.map((x) => (isObj(x) ? x.id : null)));
    if (a.excludedCustomAudiences.some((x) => isObj(x) && inc.has(x.id))) out.push({ field: 'adset.excludedCustomAudiences', rule: 'includedAndExcluded' });
  }
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
    instagramAccount: [(x) => x == null || (isObj(x) && Object.keys(x).every((k) => k === 'id' || k === 'username') && isStr(x.id, 1, 64) && typeof x.username === 'string' && x.username.length <= 100), 'isInstagramAccount'],
  });
  return out;
}

// ───────── v2: listas e agendamento ─────────

function localesOk(x: unknown): boolean {
  if (!Array.isArray(x) || x.length > 50) return false;
  const keys = new Set<number>();
  for (const l of x) {
    if (!isObj(l) || Object.keys(l).some((k) => k !== 'key' && k !== 'name') || !isInt(l.key, 1, 100_000) || typeof l.name !== 'string' || l.name.length > 100) return false;
    if (keys.has(l.key as number)) return false;
    keys.add(l.key as number);
  }
  return true;
}
function audiencesOk(x: unknown): boolean {
  if (!Array.isArray(x) || x.length > 20) return false;
  const ids = new Set<string>();
  for (const l of x) {
    if (!isObj(l) || Object.keys(l).some((k) => k !== 'id' && k !== 'name') || !isStr(l.id, 1, 64) || typeof l.name !== 'string' || l.name.length > 200) return false;
    if (ids.has(l.id as string)) return false;
    ids.add(l.id as string);
  }
  return true;
}

/** `YYYY-MM-DDTHH:mm` com data e hora reais (sem offset: é a hora no fuso da conta). */
export function isLocalDateTime(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60;
}

/** Formato do `adset.schedule` (sem relógio): start/end e o `AFTER_DAYS` 1–365. Ausente ou null = sem agendamento. */
function scheduleFormatErrors(s: unknown): FieldError[] {
  if (s == null) return [];
  if (!isObj(s) || Object.keys(s).some((k) => k !== 'start' && k !== 'end')) return [{ field: 'adset.schedule', rule: 'isObject' }];
  const out: FieldError[] = [];
  if (s.start !== null && !isLocalDateTime(s.start)) out.push({ field: 'adset.schedule.start', rule: 'isLocalDateTime' });
  const e = s.end;
  if (e === null) return out;
  if (isObj(e) && e.kind === 'AT' && Object.keys(e).every((k) => k === 'kind' || k === 'at')) {
    if (!isLocalDateTime(e.at)) out.push({ field: 'adset.schedule.end', rule: 'isLocalDateTime' });
  } else if (isObj(e) && e.kind === 'AFTER_DAYS' && Object.keys(e).every((k) => k === 'kind' || k === 'days')) {
    if (!isInt(e.days, 1, 365)) out.push({ field: 'adset.schedule.end', rule: 'isInt' });
  } else out.push({ field: 'adset.schedule.end', rule: 'isObject' });
  return out;
}

/** Diferença (ms) entre a hora de parede de `tz` e UTC num instante. Fuso inválido = UTC. */
function tzOffsetMs(at: number, tz: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  } catch {
    return 0;
  }
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second')) - Math.floor(at / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` no fuso da conta → instante UTC (horário de verão incluso; hora que "não existe" anda pra frente). */
export function localToUtc(local: string, tz: string): Date {
  const [d, t] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  let at = wall - tzOffsetMs(wall, tz);
  const again = wall - tzOffsetMs(at, tz);
  if (again !== at) at = Math.max(at, again);
  return new Date(at);
}

const DAY_MS = 86_400_000;
const PAST_TOLERANCE_MS = 5 * 60_000;
export interface ResolvedSchedule {
  /** null = começa ao publicar (início ausente ou já passou: `start_time` não vai) */
  startTime: string | null;
  endTime: string | null;
  /** dias do orçamento total = teto((fim − início efetivo) / 24 h); null sem fim */
  days: number | null;
}

/**
 * v2 §2.3/§3: resolve o agendamento contra o relógio no fuso da conta. `save` (POST/PATCH): início > 5 min no passado
 * = `inPast`. `send` (publicação): início passado vira agora. Nos dois: fim `AT` no passado = `inPast`; fim `AT` a menos
 * de 24 h do início efetivo = `minDuration24h`. Formato já validado antes (`scheduleFormatErrors`).
 */
export function resolveSchedule(s: MetaTemplateSchedule | null | undefined, tz: string, now: Date, mode: 'save' | 'send'): { value: ResolvedSchedule; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (!s) return { value: { startTime: null, endTime: null, days: null }, errors };
  const nowMs = now.getTime();
  let start = s.start ? localToUtc(s.start, tz).getTime() : null;
  if (start != null && start < nowMs - (mode === 'save' ? PAST_TOLERANCE_MS : 0)) {
    if (mode === 'save') errors.push({ field: 'adset.schedule.start', rule: 'inPast' });
    start = null;
  }
  if (start != null && start <= nowMs) start = null;
  const effStart = start ?? nowMs;
  let end: number | null = null;
  if (s.end?.kind === 'AT') {
    end = localToUtc(s.end.at, tz).getTime();
    if (end <= nowMs) errors.push({ field: 'adset.schedule.end', rule: 'inPast' });
    else if (end - effStart < DAY_MS) errors.push({ field: 'adset.schedule.end', rule: 'minDuration24h' });
  } else if (s.end?.kind === 'AFTER_DAYS') end = effStart + s.end.days * DAY_MS;
  return {
    value: {
      startTime: start != null ? new Date(start).toISOString() : null,
      endTime: end != null ? new Date(end).toISOString() : null,
      days: end != null && end > effStart ? Math.ceil((end - effStart) / DAY_MS) : null,
    },
    errors,
  };
}

/**
 * v2 §3: regras que cruzam campanha × conjunto (objetivo × meta/pixel, total × fim). Só com as duas seções em formato
 * válido; no PATCH rodam sobre o corpo mesclado (o `check` do service valida o merge inteiro).
 */
export function crossErrors(c: MetaTemplateCampaign, a: MetaTemplateAdset): FieldError[] {
  const out: FieldError[] = [];
  const goals = GOALS_BY_OBJECTIVE[c.objective];
  if (goals) {
    if (a.optimizationGoal != null && !goals.includes(a.optimizationGoal)) out.push({ field: 'adset.optimizationGoal', rule: 'isIn' });
    if (a.pixelId != null || a.pixelEvent != null) out.push({ field: 'adset.pixelId', rule: 'notForObjective' });
  } else if (a.optimizationGoal != null) out.push({ field: 'adset.optimizationGoal', rule: 'notForObjective' });
  if (budgetTypeOf(c) === 'LIFETIME' && !a.schedule?.end) out.push({ field: 'adset.schedule.end', rule: 'requiredForLifetime' });
  return out;
}

/**
 * 422 META_BUDGET_TOO_LOW (details) ou null. DAILY = igual v1. LIFETIME (§2.2) = mínimo diário × dias; sem dias
 * calculáveis (sem fim) não checa aqui — a Graph continua mandando na publicação.
 */
export function budgetTooLow(c: MetaTemplateCampaign, minDaily: number | null, days: number | null, currency: string): MetaBudgetTooLowDetails | null {
  if (minDaily == null) return null;
  if (budgetTypeOf(c) === 'LIFETIME') {
    if (days == null) return null;
    const min = minDaily * days;
    return (c.lifetimeBudgetMinor ?? 0) < min ? { minimumMinor: min, currency, budgetType: 'LIFETIME', days } : null;
  }
  return c.dailyBudgetMinor < minDaily ? { minimumMinor: minDaily, currency } : null;
}

/** Ids gravados no template que a conta precisa ainda ter (§3 `notAvailable`). */
export function referencedIds(t: { adset: MetaTemplateAdset; ad: MetaTemplateAd }) {
  return {
    instagram: t.ad.instagramAccount?.id ?? null,
    audiences: [...(t.adset.customAudiences ?? []), ...(t.adset.excludedCustomAudiences ?? [])].map((x) => x.id),
  };
}

/** `notAvailable` por campo: o id não aparece mais nas listas da conta. `null` numa lista = não foi lida (pula). */
export function availabilityErrors(t: { adset: MetaTemplateAdset; ad: MetaTemplateAd }, lists: { instagram: Set<string> | null; audiences: Set<string> | null }): FieldError[] {
  const out: FieldError[] = [];
  const ig = t.ad.instagramAccount?.id;
  if (ig && lists.instagram && !lists.instagram.has(ig)) out.push({ field: 'ad.instagramAccount', rule: 'notAvailable' });
  if (lists.audiences) {
    if ((t.adset.customAudiences ?? []).some((x) => !lists.audiences!.has(x.id))) out.push({ field: 'adset.customAudiences', rule: 'notAvailable' });
    if ((t.adset.excludedCustomAudiences ?? []).some((x) => !lists.audiences!.has(x.id))) out.push({ field: 'adset.excludedCustomAudiences', rule: 'notAvailable' });
  }
  return out;
}

/** v2 §6: campos novos do `MetaPublishSettings`, resolvidos no envio. Template v1 = objeto vazio (settings iguais aos de hoje). */
export function v2Settings(t: { campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd }, sched: ResolvedSchedule): Partial<MetaPublishSettings> {
  const out: Partial<MetaPublishSettings> = {};
  const lifetime = budgetTypeOf(t.campaign) === 'LIFETIME';
  if (t.campaign.budgetType !== undefined) out.budgetType = budgetTypeOf(t.campaign);
  if (lifetime) out.lifetimeBudgetMinor = t.campaign.lifetimeBudgetMinor ?? null;
  if (t.adset.schedule) {
    out.startTime = sched.startTime;
    out.endTime = sched.endTime;
  }
  if (hasGoal(t.campaign.objective)) out.optimizationGoal = goalOf(t.campaign.objective, t.adset.optimizationGoal);
  if (t.adset.locales?.length) out.locales = t.adset.locales.map((l) => l.key);
  if (t.adset.customAudiences?.length) out.customAudienceIds = t.adset.customAudiences.map((x) => x.id);
  if (t.adset.excludedCustomAudiences?.length) out.excludedCustomAudienceIds = t.adset.excludedCustomAudiences.map((x) => x.id);
  if (t.ad.instagramAccount) out.instagramUserId = t.ad.instagramAccount.id;
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
  if (!out.length && b.campaign && b.adset) out.push(...crossErrors(b.campaign, b.adset));
  return out;
}

// ───────── v2 §14 (04/11): override do envio + snapshot gravado na publicação ─────────

type Sections = { campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd };
export type TemplateLevel = 'campaign' | 'adset' | 'ad';
const LEVEL_KEYS: readonly TemplateLevel[] = ['campaign', 'adset', 'ad'];

/** Estrutura resolvida (template + override) gravada em `MetaPublication.templateSnapshot`; `overridden` = níveis trocados no envio. */
export interface MetaTemplateSnapshot extends Sections { overridden: TemplateLevel[] }

/**
 * Formato do `override` (sem relógio nem conta): objeto só com `campaign`/`adset`/`ad`, cada nível presente INTEIRO e com a
 * validação do `MetaTemplateBody` (mesmos caminhos `campaign.*`…). Chave desconhecida = `override.<k>` notAllowed.
 */
export function overrideErrors(o: unknown): FieldError[] {
  if (o === undefined) return [];
  if (!isObj(o)) return [{ field: 'override', rule: 'isObject' }];
  const out: FieldError[] = [];
  for (const k of Object.keys(o)) if (!(LEVEL_KEYS as readonly string[]).includes(k)) out.push({ field: `override.${k}`, rule: 'notAllowed' });
  const parts = Object.fromEntries(LEVEL_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as Partial<MetaTemplateBody>;
  out.push(...templateBodyErrors(parts, true));
  return out;
}

/** Níveis do override substituem os do template (o resto fica do template). Sem override = o template, `overridden` vazio. */
export function applyOverride(t: Sections, o?: Partial<Sections> | null): MetaTemplateSnapshot {
  const overridden = LEVEL_KEYS.filter((k) => o?.[k] !== undefined);
  return {
    campaign: o?.campaign ?? t.campaign, adset: o?.adset ?? t.adset, ad: o?.ad ?? t.ad,
    overridden,
  };
}

/** Regras cruzadas no resultado mesclado (ex.: objetivo trocado × pixel do conjunto do template). Só com override. */
export function mergedErrors(s: MetaTemplateSnapshot): FieldError[] {
  return s.overridden.length ? crossErrors(s.campaign, s.adset) : [];
}

/** Lê o Json da coluna; formato inesperado/ausente = null (o run cai no template ao vivo, como antes de 04/11). */
export function snapshotOf(v: unknown): MetaTemplateSnapshot | null {
  if (!isObj(v) || !isObj(v.campaign) || !isObj(v.adset) || !isObj(v.ad)) return null;
  const overridden = Array.isArray(v.overridden) ? v.overridden.filter((k): k is TemplateLevel => (LEVEL_KEYS as readonly unknown[]).includes(k)) : [];
  return { campaign: v.campaign as unknown as MetaTemplateCampaign, adset: v.adset as unknown as MetaTemplateAdset, ad: v.ad as unknown as MetaTemplateAd, overridden };
}

/**
 * REUSE só quando a campanha do envio tem a MESMA forma da do template (`campaignShapeChanged`): override que troca
 * objetivo/CBO-ABO/lance/categorias/tipo de orçamento não pode cair na campanha guardada nem gravar outra no template —
 * cria campanha nova só pra esse envio. Comparado com o template ao vivo no run (template editado depois = idem).
 */
export function reusesTemplateCampaign(sent: MetaTemplateCampaign, template: MetaTemplateCampaign): boolean {
  return sent.destination === 'REUSE_CAMPAIGN' && template.destination === 'REUSE_CAMPAIGN' && !campaignShapeChanged(sent, template);
}

/**
 * v2 §3 (B2 do QA, 03/11): PATCH revalida o template MESCLADO inteiro (relógio, `notAvailable`, pixel, mínimo) igual ao
 * POST, exceto quando o corpo só traz `name` e/ou `isDefault` (renomear/trocar o padrão não pode falhar).
 */
export function patchNeedsRecheck(patch: object): boolean {
  return Object.entries(patch).some(([k, v]) => v !== undefined && k !== 'name' && k !== 'isDefault');
}

/** 422 META_PIXEL_REQUIRED: evento de pixel sem pixel, ou objetivo que exige pixel sem pixel (como na publicação de hoje). */
export function pixelMissing(campaign: MetaTemplateCampaign, adset: MetaTemplateAdset): boolean {
  if (adset.pixelId || hasGoal(campaign.objective)) return false; // v2: Awareness/Engagement proíbem pixel (400 antes)
  return !!adset.pixelEvent || NEEDS_PIXEL.includes(campaign.objective);
}

/** O que muda a campanha reaproveitada (objetivo/CBO-ABO/lance/categorias/destino; v2: tipo de orçamento): trocar = esquece a campanha guardada. */
export function campaignShapeChanged(a: MetaTemplateCampaign, b: MetaTemplateCampaign): boolean {
  return a.destination !== b.destination || a.objective !== b.objective || a.budgetMode !== b.budgetMode || a.bidStrategy !== b.bidStrategy
    || budgetTypeOf(a) !== budgetTypeOf(b)
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

/** Estrutura que a porta usa (contrato.ts MetaPublishStructure). v2 §6: os campos novos saem dos `settings` resolvidos no envio. */
export function structureOf(t: { campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd }, names: { campaign: string; adset: string }, settings?: MetaPublishSettings | null): MetaPublishStructure {
  const v2: Partial<MetaPublishStructure> = {};
  if (settings) {
    for (const k of ['budgetType', 'lifetimeBudgetMinor', 'startTime', 'endTime', 'optimizationGoal', 'locales', 'customAudienceIds', 'excludedCustomAudienceIds', 'instagramUserId'] as const) {
      if (settings[k] !== undefined) (v2 as Record<string, unknown>)[k] = settings[k];
    }
  }
  return {
    ...v2,
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
/** chaves de targeting que o template entende; o resto (interesses, exclusões detalhadas, conexões…) vai pro unsupported */
const TARGETING_KNOWN = new Set([
  'geo_locations', 'age_min', 'age_max', 'genders', 'targeting_automation', 'publisher_platforms',
  'locales', 'custom_audiences', 'excluded_custom_audiences', // v2 §7
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

/** Contexto do import: `locales`/`instagramAccounts` = listas da conta (§4) pra pôr nome; null = não deu pra ler. */
export interface ImportContext {
  level: 'campaign' | 'adset' | 'ad'; id: string; defaultCountries: string[]; fallbackLink: string | null;
  now?: Date;
  locales?: MetaLocaleOption[] | null;
  instagramAccounts?: MetaInstagramAccount[] | null;
}

const refsOf = (v: unknown, max: number): MetaAudienceRef[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: MetaAudienceRef[] = [];
  for (const x of v) {
    const id = isObj(x) ? String(x.id ?? '') : String(x ?? '');
    if (!id || id.length > 64 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: (isObj(x) && typeof x.name === 'string' && x.name ? x.name : id).slice(0, 200) });
  }
  return out.slice(0, max);
};
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function templateFromSource(src: MetaTemplateSourceRead, ctx: ImportContext): MetaTemplateImportResult {
  const unsupported: { field: string; value: string }[] = [];
  const adjusted: { field: string; value: string }[] = [];
  const miss = (field: string, value: unknown) => unsupported.push({ field, value: short(value) });
  const c = src.campaign;
  const a = src.adset;
  const now = (ctx.now ?? new Date()).getTime();

  // campanha
  let objective: MetaObjective = 'OUTCOME_TRAFFIC';
  if ((TEMPLATE_OBJECTIVES as readonly string[]).includes(c.objective)) objective = c.objective as MetaObjective;
  else miss('campaign.objective', c.objective);
  if (c.buyingType && c.buyingType !== 'AUCTION') miss('campaign.buyingType', c.buyingType);
  const cbo = c.dailyBudgetMinor != null || c.lifetimeBudgetMinor != null;
  // v2 §7: orçamento total copiado (CBO = da campanha, e aí NEW_CAMPAIGN pela regra do §2.2; ABO = do conjunto)
  const lifetime = cbo ? c.dailyBudgetMinor == null ? c.lifetimeBudgetMinor : null : a?.dailyBudgetMinor == null ? a?.lifetimeBudgetMinor ?? null : null;
  const daily = lifetime != null ? null : cbo ? c.dailyBudgetMinor : a?.dailyBudgetMinor ?? null;
  // P2: sem orçamento na origem = 0 (a janela obriga a pessoa a preencher; nada de padrão escondido)
  if (daily == null && lifetime == null) miss('campaign.dailyBudgetMinor', 'no daily budget');
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
  let optimizationGoal: MetaTemplateOptimizationGoal | null | undefined;
  let finalPixelId = pixelId;
  const goals = GOALS_BY_OBJECTIVE[objective];
  if (goals) {
    // v2 §2.1/§7: Awareness/Engagement sem pixel; meta aceita copiada, senão o padrão do objetivo + unsupported
    if (pixelId || pixelEvent) miss('adset.pixelId', pixelId ?? pixelEvent);
    finalPixelId = null;
    pixelEvent = null;
    const dest = a?.destinationType ?? null;
    let copied: MetaTemplateOptimizationGoal | null = null;
    if (objective === 'OUTCOME_ENGAGEMENT' && dest && dest !== 'ON_VIDEO' && dest !== 'ON_POST') miss('adset.destinationType', dest);
    else if (goal) {
      // Engagement: ON_POST ↔ POST_ENGAGEMENT, ON_VIDEO ↔ ThruPlay/2 s (§2.1)
      const fits = goals.includes(goal as MetaTemplateOptimizationGoal) && (objective !== 'OUTCOME_ENGAGEMENT' || !dest || (dest === 'ON_POST') === (goal === 'POST_ENGAGEMENT'));
      if (fits) copied = goal as MetaTemplateOptimizationGoal;
      else miss('adset.optimizationGoal', goal);
    }
    optimizationGoal = copied ?? goals[0];
  } else if (goal && goal !== 'OFFSITE_CONVERSIONS' && goal !== 'LINK_CLICKS') miss('adset.optimizationGoal', goal);
  if (!finalPixelId) pixelEvent = null;
  if (!a) miss('adset', 'no ad set in this campaign');

  // v2 §7: agendamento fixo vira "N dias a partir da publicação" (o template é reaproveitado; data fixa venceria)
  let schedule: MetaTemplateSchedule | null | undefined;
  const st = a?.startTime ? Date.parse(a.startTime) : NaN;
  const en = a?.endTime ? Date.parse(a.endTime) : NaN;
  if (Number.isFinite(en)) {
    const from = Number.isFinite(st) ? st : now;
    if (Number.isFinite(st) || en > now) {
      const days = Math.min(365, Math.max(1, Math.round((en - from) / DAY_MS)));
      schedule = { start: null, end: { kind: 'AFTER_DAYS', days } };
      adjusted.push({ field: 'adset.schedule', value: Number.isFinite(st) ? `Ran ${fmtDay(st)} – ${fmtDay(en)} → runs ${days} days from publish` : `Ends ${fmtDay(en)} → runs ${days} days from publish` });
    } else {
      schedule = null;
      adjusted.push({ field: 'adset.schedule', value: `Ended ${fmtDay(en)} → no end date` });
    }
  }

  // v2 §7: idiomas e públicos personalizados
  const localeNames = new Map((ctx.locales ?? []).map((l) => [l.key, l.name]));
  const locales: MetaLocaleRef[] = [];
  if (Array.isArray(t.locales)) {
    for (const k of t.locales.map(Number)) {
      if (Number.isInteger(k) && k >= 1 && k <= 100_000 && !locales.some((l) => l.key === k)) locales.push({ key: k, name: (localeNames.get(k) ?? `Locale ${k}`).slice(0, 100) });
    }
  }
  const excludedCustomAudiences = refsOf(t.excluded_custom_audiences, 20);
  const excludedIds = new Set(excludedCustomAudiences.map((x) => x.id));
  const customAudiences = refsOf(t.custom_audiences, 20).filter((x) => !excludedIds.has(x.id));

  // anúncio: CTA, link e UTM copiados; o texto fica null (herda do criativo e da oferta de cada peça, como hoje)
  const cr = src.ad?.creative ?? null;
  let callToAction: MetaCallToAction = objective === 'OUTCOME_SALES' ? 'SHOP_NOW' : objective === 'OUTCOME_LEADS' ? 'SIGN_UP' : objective === 'OUTCOME_APP_PROMOTION' ? 'DOWNLOAD' : 'LEARN_MORE';
  if (cr?.callToAction) {
    if ((CTAS as readonly string[]).includes(cr.callToAction)) callToAction = cr.callToAction as MetaCallToAction;
    else miss('ad.callToAction', cr.callToAction);
  }
  if (!src.ad) miss('ad', 'no ad in this ad set');
  if (cr?.format === 'ASSET_FEED' || cr?.format === 'CAROUSEL') miss('ad.creative.format', cr.format);
  const link = cr?.link ?? ctx.fallbackLink ?? '';
  const igId = cr?.instagramUserId ?? null;
  const instagramAccount = igId
    ? { id: igId.slice(0, 64), username: (ctx.instagramAccounts?.find((x) => x.id === igId)?.username ?? igId).slice(0, 100) }
    : null;

  const name = ctx.level === 'campaign' ? c.name : ctx.level === 'adset' ? a?.name ?? '' : src.ad?.name ?? '';
  const importedFrom: MetaTemplateImportedFrom = { level: ctx.level, id: ctx.id, name };
  const template: MetaTemplateBody = {
    name: name.slice(0, 60) || 'Imported template',
    campaign: {
      destination: cbo && lifetime != null ? 'NEW_CAMPAIGN' : 'REUSE_CAMPAIGN', objective, budgetMode: cbo ? 'CBO' : 'ABO', dailyBudgetMinor: lifetime != null ? 0 : daily ?? 0,
      ...(lifetime != null && { budgetType: 'LIFETIME' as const, lifetimeBudgetMinor: lifetime }),
      bidStrategy, bidAmountMinor, specialAdCategories: special, namePattern: DEFAULT_NAME_PATTERNS.campaign,
    },
    adset: {
      pixelId: finalPixelId, pixelEvent, countries, ageMin, ageMax, genders, advantageAudience, placements,
      adsPerAdset: { ...DEFAULT_ADS_PER_ADSET }, namePattern: DEFAULT_NAME_PATTERNS.adset,
      ...(optimizationGoal !== undefined && { optimizationGoal }),
      ...(schedule !== undefined && { schedule }),
      ...(locales.length && { locales }),
      ...(customAudiences.length && { customAudiences }),
      ...(excludedCustomAudiences.length && { excludedCustomAudiences }),
    },
    ad: {
      primaryText: null, headline: null, description: null, callToAction, link, urlTags: cr?.urlTags ?? null, namePattern: DEFAULT_NAME_PATTERNS.ad,
      ...(instagramAccount && { instagramAccount }),
    },
    importedFrom,
  };
  return adjusted.length ? { template, unsupported, adjusted } : { template, unsupported };
}
