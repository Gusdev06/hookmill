// Leitura da Marketing API (meta-v1.md §3.1 options/health e §3.2 sync): contas com user_tasks, páginas, pixels com
// last_fired_time, verification_status, anúncios de vídeo (até 500) e as 3 janelas de insights → MetaMetrics.
import type { MetaAdAccountOption, MetaMetrics, MetaOptions } from '@maquina/contratos';
import type { BusinessType, MetaAdAccountInfo, MetaAdSnapshotDraft, MetaAdsetSnapshotDraft, MetaCampaignSnapshotDraft, MetaSyncInput, MetaSyncStage } from '../contrato';
import { Logger } from '@nestjs/common';
import { GraphClient, type Raw } from './cliente';
import { MetaError, accountStatusLabel, isMetaError } from './erros';

const log = new Logger('MetaLeitura');

// Listagem LEVE (bug live 22/10: com `object_story_spec` a Graph devolvia code 1 "reduce the amount of data" em conta grande).
// O `video_id` de criativo que só tem `object_story_spec.video_data` sai de um lookup em lote (fillStoryVideoIds), só pros que faltam.
export const AD_FIELDS = 'id,name,status,effective_status,created_time,campaign{id,name},adset{id,name},creative{id,video_id,thumbnail_url,object_type}';
/** campanhas-v1 §1 (22/10): estrutura + orçamento por nível. Orçamentos vêm em string, em centavos da moeda da conta. */
export const CAMPAIGN_FIELDS = 'id,name,objective,status,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,budget_remaining,special_ad_categories,start_time,stop_time,created_time';
export const ADSET_FIELDS = 'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,budget_remaining,learning_stage_info,start_time,end_time,created_time';
/** Fora da leitura (campanhas-v1 §1): apagados/arquivados não aparecem na tela. */
export const HIDDEN_STATUSES = new Set(['ARCHIVED', 'DELETED']);
/** Lookup do video_id pelo object_story_spec (só criativos de vídeo sem video_id na listagem): teto e paralelismo. */
export const STORY_LOOKUP_MAX = 100;
export const STORY_LOOKUP_PARALLEL = 5;
export const ACCOUNT_FIELDS = 'id,name,currency,timezone_name,account_status,business,user_tasks,funding_source_details,minimum_budgets';
/** Campo da Graph que alimenta `plays2s`/`hookRate`: "2-Second Continuous Video Plays" (≥ 2 s contínuos com ≥ 50 % do vídeo
 *  na tela). `video_3_sec_watched_actions` NÃO existe na Marketing API (v25.0 devolve #100 "is not valid for fields param";
 *  confirmado na conta real em 22/10, ver PORTA.md). O nome `plays2s` no contrato ficou por compatibilidade. */
export const HOOK_FIELD = 'video_continuous_2_sec_watched_actions';
/** Campos de insights (todos aceitos pela Graph v25.0 em 22/10). */
export const INSIGHT_FIELDS = ['ad_id', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'actions', 'cost_per_action_type', 'purchase_roas', 'video_play_actions', 'video_thruplay_watched_actions', HOOK_FIELD];
/** Sem estes o sync não faz sentido: se a Graph recusar um deles (#100), o erro sobe. Qualquer outro recusado é derrubado e a janela é relida. */
export const INSIGHT_FIELDS_CORE = ['ad_id', 'spend', 'impressions', 'clicks', 'actions'];
export const MAX_ADS = 500;
export const MANAGE_TASKS = ['MANAGE', 'ADVERTISE'];

export const canManageOf = (tasks: unknown) => Array.isArray(tasks) && tasks.some((t) => MANAGE_TASKS.includes(String(t)));

export function mapAccount(a: Raw): MetaAdAccountInfo {
  const status = Number(a.account_status ?? 0);
  // a Graph v25.0 devolve `minimum_budgets` como `{ data: [...] }` (visto na conta real em 22/10); aceita também o array direto
  const mbs: Raw[] | null = Array.isArray(a.minimum_budgets) ? a.minimum_budgets : Array.isArray(a.minimum_budgets?.data) ? a.minimum_budgets.data : null;
  const mb = mbs ? mbs.find((m: Raw) => !a.currency || m.currency === a.currency) ?? mbs[0] : null;
  const min = mb ? Number(mb.min_daily_budget_imp ?? mb.min_daily_budget_high_freq ?? mb.min_daily_budget_low_freq) : NaN;
  return {
    id: String(a.id ?? ''), name: String(a.name ?? ''), currency: String(a.currency ?? ''), timezoneName: String(a.timezone_name ?? ''),
    accountStatus: status, accountStatusLabel: accountStatusLabel(status),
    business: a.business && a.business.id ? { id: String(a.business.id), name: String(a.business.name ?? '') } : null,
    canManage: canManageOf(a.user_tasks),
    hasFunding: !!(a.funding_source_details && (a.funding_source_details.id || a.funding_source_details.display_string || a.funding_source_details.type != null)),
    minimumDailyBudgetMinor: Number.isFinite(min) && min > 0 ? min : null,
  };
}

export async function listOptions(g: GraphClient, token: string, q: { adAccountId?: string | null }): Promise<MetaOptions> {
  const accounts = await g.paginate<Raw>('me/adaccounts', { fields: 'id,name,currency,account_status,business,user_tasks', limit: 100 }, token, 500, { stage: 'options' });
  const pages = await g.paginate<Raw>('me/accounts', { fields: 'id,name', limit: 100 }, token, 500, { stage: 'options' });
  const adAccounts: MetaAdAccountOption[] = accounts.map((a) => {
    const status = Number(a.account_status ?? 0);
    const canManage = canManageOf(a.user_tasks);
    return {
      id: String(a.id), name: String(a.name ?? ''), currency: String(a.currency ?? ''), accountStatus: status,
      business: a.business && a.business.id ? { id: String(a.business.id), name: String(a.business.name ?? '') } : null,
      canManage: canManage && status !== 2 && status !== 101 && status !== 100,
      permissionReason: !canManage ? 'no_advertise_task' : status === 2 || status === 100 || status === 101 ? 'account_disabled' : null,
    };
  });
  const pixels: MetaOptions['pixels'] = [];
  if (q.adAccountId) {
    const px = await g.paginate<Raw>(`${q.adAccountId}/adspixels`, { fields: 'id,name,last_fired_time', limit: 100 }, token, 100, { stage: 'options' });
    for (const p of px) pixels.push({ id: String(p.id), name: String(p.name ?? ''), adAccountId: q.adAccountId, lastFiredAt: isoOf(p.last_fired_time) });
  }
  return { adAccounts, pages: pages.map((p) => ({ id: String(p.id), name: String(p.name ?? '') })), pixels };
}

export async function readAdAccount(g: GraphClient, token: string, adAccountId: string): Promise<MetaAdAccountInfo> {
  try {
    return mapAccount(await g.get<Raw>(adAccountId, { fields: ACCOUNT_FIELDS }, token, { stage: 'account' }));
  } catch (e) {
    // conta fora do alcance do usuário (100 "Unsupported get request" / 803 / 200): é permissão, não "fora do ar"
    if (isMetaError(e) && (e.code === 'META_ERROR' || e.code === 'META_PERMISSION')) throw new MetaError('META_PERMISSION', e.message, { ...e.options, details: { adAccountId, reason: 'no_advertise_task' } });
    throw e;
  }
}

export async function pageReachable(g: GraphClient, token: string, pageId: string): Promise<boolean | null> {
  try {
    await g.get<Raw>(pageId, { fields: 'id' }, token, { stage: 'health' });
    return true;
  } catch (e) {
    if (isMetaError(e) && (e.code === 'META_UNAVAILABLE' || e.code === 'META_RATE_LIMITED')) return null;
    if (isMetaError(e) && e.code === 'META_TOKEN_INVALID') throw e;
    return false;
  }
}
export async function pixelLastFired(g: GraphClient, token: string, pixelId: string): Promise<{ lastFiredAt: string | null; readFailed: boolean }> {
  try {
    const p = await g.get<Raw>(pixelId, { fields: 'id,last_fired_time' }, token, { stage: 'health' });
    return { lastFiredAt: isoOf(p.last_fired_time), readFailed: false };
  } catch (e) {
    if (isMetaError(e) && e.code === 'META_TOKEN_INVALID') throw e;
    return { lastFiredAt: null, readFailed: true };
  }
}
export async function businessVerification(g: GraphClient, token: string, businessId: string): Promise<string | null> {
  try {
    const b = await g.get<Raw>(businessId, { fields: 'id,verification_status' }, token, { stage: 'health' });
    return b.verification_status ? String(b.verification_status) : null;
  } catch (e) {
    if (isMetaError(e) && e.code === 'META_TOKEN_INVALID') throw e;
    return null;
  }
}

// ---------- sync ----------
/** action_type do "resultado" (§3.2) com fallback. */
export function resultActionTypes(businessType: BusinessType | null, hasPixel: boolean): { primary: string; fallback: string | null } {
  if (!hasPixel) return { primary: 'link_click', fallback: null };
  if (businessType === 'ONLINE_STORE') return { primary: 'omni_purchase', fallback: 'purchase' };
  if (businessType === 'LOCAL_BUSINESS') return { primary: 'lead', fallback: 'onsite_conversion.lead_grouped' };
  if (businessType === 'APP') return { primary: 'omni_app_install', fallback: 'mobile_app_install' };
  return { primary: 'link_click', fallback: null };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const actionValue = (list: unknown, type: string): number | null => {
  if (!Array.isArray(list)) return null;
  const hit = list.find((a: Raw) => a && a.action_type === type);
  return hit ? num(hit.value) : null;
};
const firstAction = (list: unknown): number | null => (Array.isArray(list) && list.length ? num((list[0] as Raw).value) : null);

/** Uma linha de insights da Graph → MetaMetrics. `withFrequency` só nas janelas de 7 d. */
export function mapInsight(row: Raw | null, result: { primary: string; fallback: string | null }, withFrequency: boolean): MetaMetrics & { resultTypeUsed: string | null } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r: Raw = row ?? {};
  const spend = num(r.spend);
  const impressions = num(r.impressions);
  const clicks = num(r.clicks);
  const reach = num(r.reach);
  let results = actionValue(r.actions, result.primary);
  let resultTypeUsed: string | null = results != null ? result.primary : null;
  if (results == null && result.fallback) {
    results = actionValue(r.actions, result.fallback);
    resultTypeUsed = results != null ? result.fallback : null;
  }
  if (results == null) results = 0;
  const plays2s = firstAction(r[HOOK_FIELD]);
  const thruplays = firstAction(r.video_thruplay_watched_actions);
  const roas = actionValue(r.purchase_roas, 'omni_purchase') ?? firstAction(r.purchase_roas);
  return {
    spend: r2(spend), impressions, clicks,
    ctr: impressions ? r2((clicks / impressions) * 100) : 0,
    results, resultType: resultTypeUsed ?? result.primary,
    cpa: results > 0 ? r2(spend / results) : null,
    roas: result.primary.includes('purchase') && roas != null ? r2(roas) : null,
    plays2s, hookRate: plays2s != null && impressions ? r2((plays2s / impressions) * 100) : null,
    thruplays,
    frequency: withFrequency && reach > 0 ? r2(impressions / reach) : null,
    resultTypeUsed,
  };
}

export const isVideoAd = (ad: Raw): boolean => !!(ad.creative && (ad.creative.video_id || ad.creative.object_story_spec?.video_data));

/**
 * Criativos sem `video_id` na listagem leve e com cara de vídeo (`object_type` VIDEO ou ausente): pergunta
 * `object_story_spec{video_data{video_id}}` um a um (o `?ids=` em lote foi recusado pela Graph: "deprecated in v26.0+",
 * sonda 22/10), até STORY_LOOKUP_MAX por sync, STORY_LOOKUP_PARALLEL por vez. Falha de um não derruba o sync.
 */
export async function fillStoryVideoIds(g: GraphClient, token: string, ads: Raw[]): Promise<void> {
  const want = (a: Raw) => a.creative?.id && !a.creative.video_id && !a.creative.object_story_spec && (!a.creative.object_type || String(a.creative.object_type).toUpperCase() === 'VIDEO');
  const missing = [...new Set(ads.filter(want).map((a) => String(a.creative.id)))].slice(0, STORY_LOOKUP_MAX);
  const found = new Map<string, string>();
  let k = 0;
  const worker = async () => {
    while (k < missing.length) {
      const id = missing[k++];
      try {
        const c = await g.get<Raw>(id, { fields: 'object_story_spec{video_data{video_id}}' }, token, { stage: 'listing_ads', retries: 0 });
        const v = c?.object_story_spec?.video_data?.video_id;
        if (v) found.set(id, String(v));
      } catch (e) {
        log.warn(`video_id pelo object_story_spec falhou no criativo ${id}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: STORY_LOOKUP_PARALLEL }, worker));
  for (const a of ads) {
    const v = a.creative?.id ? found.get(String(a.creative.id)) : undefined;
    if (v) a.creative.object_story_spec = { video_data: { video_id: v } };
  }
}
export const videoIdOf = (ad: Raw): string | null => (ad.creative?.video_id ? String(ad.creative.video_id) : ad.creative?.object_story_spec?.video_data?.video_id ? String(ad.creative.object_story_spec.video_data.video_id) : null);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Estado compartilhado pelas 3 janelas do sync: campos que a Graph recusou com #100 (não são pedidos de novo). */
export interface InsightState { rejected: Set<string> }
export const newInsightState = (): InsightState => ({ rejected: new Set() });

const INVALID_FIELD_RE = /\(#100\) ([a-z0-9_]+) is not valid for fields param/i;
/** Nome do campo que a Graph recusou (#100 "X is not valid for fields param"), se X estava entre os pedidos; senão null. */
export function invalidFieldOf(e: unknown, requested: string[]): string | null {
  if (!isMetaError(e) || e.code !== 'META_ERROR') return null;
  const m = INVALID_FIELD_RE.exec(e.failDetail ?? '');
  return m && requested.includes(m[1]) ? m[1] : null;
}

export type InsightLevel = 'campaign' | 'adset' | 'ad';
const keyOf = (level: InsightLevel) => `${level}_id`;

/**
 * Lê os insights de uma janela num nível (campanhas-v1 D3: campanha e conjunto lidos por nível, não somados).
 * Se a Graph recusar um campo não essencial (#100), tira o campo e relê (vale pras janelas e níveis seguintes).
 * O `paginate` já repete a página com `limit` menor se a Graph pedir menos dados (code 1).
 */
export async function readInsights(g: GraphClient, token: string, adAccountId: string, window: { date_preset?: string; time_range?: string }, state: InsightState, onPage?: (n: number) => void, level: InsightLevel = 'ad'): Promise<Map<string, Raw>> {
  const key = keyOf(level);
  const fields = INSIGHT_FIELDS.map((f) => (f === 'ad_id' ? key : f)).filter((f) => !state.rejected.has(f));
  try {
    const rows = await g.paginate<Raw>(`${adAccountId}/insights`, { level, fields: fields.join(','), limit: 500, ...window }, token, MAX_ADS * 2, { stage: 'reading_insights', onPage });
    return new Map(rows.map((r) => [String(r[key]), r]));
  } catch (e) {
    const bad = invalidFieldOf(e, fields);
    if (bad && !INSIGHT_FIELDS_CORE.includes(bad) && bad !== key) {
      state.rejected.add(bad);
      log.warn(`insights: Graph recusou o campo ${bad} (#100); relendo sem ele`);
      return readInsights(g, token, adAccountId, window, state, onPage, level);
    }
    throw e;
  }
}

const minorOf = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const toggleOf = (s: unknown): 'ACTIVE' | 'PAUSED' => (String(s ?? '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED');
const learningOf = (v: unknown): 'LEARNING' | 'SUCCESS' | 'FAIL' | null => {
  const s = String((v as Raw)?.status ?? '').toUpperCase();
  return s === 'LEARNING' || s === 'SUCCESS' || s === 'FAIL' ? s : null;
};
const visible = (o: Raw) => !HIDDEN_STATUSES.has(String(o.effective_status ?? o.status ?? '').toUpperCase());

export function mapCampaign(c: Raw): Omit<MetaCampaignSnapshotDraft, 'metrics' | 'metrics7d' | 'metricsPrev7d'> {
  return {
    campaignId: String(c.id), name: String(c.name ?? ''), objective: String(c.objective ?? ''),
    status: toggleOf(c.status), effectiveStatus: String(c.effective_status ?? 'UNKNOWN'),
    buyingType: c.buying_type ? String(c.buying_type) : null, bidStrategy: c.bid_strategy ? String(c.bid_strategy) : null,
    dailyBudgetMinor: minorOf(c.daily_budget), lifetimeBudgetMinor: minorOf(c.lifetime_budget), budgetRemainingMinor: minorOf(c.budget_remaining),
    specialAdCategories: Array.isArray(c.special_ad_categories) ? c.special_ad_categories.map(String) : [],
    startTime: isoOf(c.start_time), stopTime: isoOf(c.stop_time), createdTime: isoOf(c.created_time),
  };
}
export function mapAdset(a: Raw): Omit<MetaAdsetSnapshotDraft, 'metrics' | 'metrics7d' | 'metricsPrev7d'> {
  return {
    adsetId: String(a.id), campaignId: String(a.campaign_id ?? a.campaign?.id ?? ''), name: String(a.name ?? ''),
    status: toggleOf(a.status), effectiveStatus: String(a.effective_status ?? 'UNKNOWN'),
    optimizationGoal: a.optimization_goal ? String(a.optimization_goal) : null, billingEvent: a.billing_event ? String(a.billing_event) : null,
    bidStrategy: a.bid_strategy ? String(a.bid_strategy) : null,
    dailyBudgetMinor: minorOf(a.daily_budget), lifetimeBudgetMinor: minorOf(a.lifetime_budget), budgetRemainingMinor: minorOf(a.budget_remaining),
    learningStage: learningOf(a.learning_stage_info),
    startTime: isoOf(a.start_time), endTime: isoOf(a.end_time), createdTime: isoOf(a.created_time),
  };
}

export interface SyncAdsRaw {
  ads: Omit<MetaAdSnapshotDraft, 'verdict' | 'trend'>[];
  campaigns: MetaCampaignSnapshotDraft[];
  adsets: MetaAdsetSnapshotDraft[];
  listed: number;
  truncated: boolean;
  hookPlaysAvailable: boolean;
  rejectedFields: string[];
}

/**
 * Sync (meta-v1 §3.2 + campanhas-v1 §1): campanhas → conjuntos → anúncios (TODOS os formatos, D2) → insights nas
 * 3 janelas × 3 níveis (9 leituras) → snapshots. Teto MAX_ADS por nível; passou, `truncated`. Arquivados/apagados fora.
 */
export async function syncAds(g: GraphClient, token: string, i: MetaSyncInput, onProgress?: (p: { stage: MetaSyncStage; done: number; total: number }) => void): Promise<SyncAdsRaw> {
  const max = i.maxAds ?? MAX_ADS;
  const now = i.now ?? new Date();
  let truncated = false;
  const list = async (edge: string, fields: string, stage: MetaSyncStage) => {
    onProgress?.({ stage, done: 0, total: 0 });
    // max + 1 pra saber se passou do teto
    const rows = (await g.paginate<Raw>(`${i.adAccountId}/${edge}`, { fields, limit: 100 }, token, max + 1, { stage, onPage: (n) => onProgress?.({ stage, done: 0, total: Math.min(n, max) }) })).filter(visible);
    if (rows.length > max) truncated = true;
    return rows.slice(0, max);
  };
  const rawCampaigns = await list('campaigns', CAMPAIGN_FIELDS, 'listing_campaigns');
  const rawAdsets = await list('adsets', ADSET_FIELDS, 'listing_adsets');
  const all = await list('ads', AD_FIELDS, 'listing_ads');
  await fillStoryVideoIds(g, token, all);
  const total = all.length;
  onProgress?.({ stage: 'reading_insights', done: 0, total });

  const result = resultActionTypes(i.businessType, i.hasPixel);
  const state = newInsightState();
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const until = new Date(now.getTime() - 8 * 86_400_000);
  const windows = [{ date_preset: 'last_30d' }, { date_preset: 'last_7d' }, { time_range: JSON.stringify({ since: isoDay(since), until: isoDay(until) }) }];
  const levels: InsightLevel[] = ['ad', 'adset', 'campaign'];
  const reads = levels.length * windows.length;
  const read: Record<InsightLevel, Map<string, Raw>[]> = { ad: [], adset: [], campaign: [] };
  let n = 0;
  for (const level of levels) {
    for (const w of windows) {
      read[level].push(await readInsights(g, token, i.adAccountId, w, state, undefined, level));
      n++;
      onProgress?.({ stage: 'reading_insights', done: Math.min(total, Math.floor((total * n) / reads)), total });
    }
  }

  const strip = (m: MetaMetrics & { resultTypeUsed: string | null }, resultType: string): MetaMetrics => {
    const { resultTypeUsed: _u, ...rest } = m;
    // campo do hook recusado pela Graph: plays2s/hookRate ficam null mesmo que a resposta traga algo parecido
    return { ...rest, resultType, ...(state.rejected.has(HOOK_FIELD) ? { plays2s: null, hookRate: null } : {}) };
  };
  /** 3 janelas de um objeto. `freqAll`: campanha/conjunto têm frequência em todas (reach não soma, vem da Graph). */
  const metricsFor = (level: InsightLevel, id: string, freqAll: boolean) => {
    const [w30, w7, wp] = read[level];
    const m30 = mapInsight(w30.get(id) ?? null, result, freqAll);
    const m7 = mapInsight(w7.get(id) ?? null, result, true);
    const mp = mapInsight(wp.get(id) ?? null, result, true);
    const resultType = m30.resultTypeUsed ?? m7.resultTypeUsed ?? result.primary;
    return { resultType, metrics: strip(m30, resultType), metrics7d: strip(m7, resultType), metricsPrev7d: strip(mp, resultType) };
  };

  const ads = all.map((ad) => {
    const id = String(ad.id);
    const m = metricsFor('ad', id, false);
    return {
      metaAdId: id, name: String(ad.name ?? ''), effectiveStatus: String(ad.effective_status ?? 'UNKNOWN'), status: toggleOf(ad.status ?? 'ACTIVE'),
      campaign: { id: String(ad.campaign?.id ?? ''), name: String(ad.campaign?.name ?? '') },
      adset: { id: String(ad.adset?.id ?? ''), name: String(ad.adset?.name ?? '') },
      metaCreativeId: ad.creative?.id ? String(ad.creative.id) : null,
      videoId: isVideoAd(ad) ? videoIdOf(ad) : null,
      thumbnailUrl: ad.creative?.thumbnail_url ? String(ad.creative.thumbnail_url) : null,
      resultType: m.resultType,
      metrics: m.metrics, metrics7d: m.metrics7d, metricsPrev7d: m.metricsPrev7d,
      adCreatedTime: isoOf(ad.created_time),
    };
  });
  const campaigns = rawCampaigns.map((c) => {
    const { resultType: _r, ...m } = metricsFor('campaign', String(c.id), true);
    return { ...mapCampaign(c), ...m };
  });
  const adsets = rawAdsets.map((a) => {
    const { resultType: _r, ...m } = metricsFor('adset', String(a.id), true);
    return { ...mapAdset(a), ...m };
  });
  onProgress?.({ stage: 'reading_insights', done: total, total });
  return { ads, campaigns, adsets, listed: total, truncated, hookPlaysAvailable: !state.rejected.has(HOOK_FIELD), rejectedFields: [...state.rejected] };
}

type VideoSource = { sourceUrl: string; permalinkUrl: string | null; lengthSec: number | null };
const VIDEO_FIELDS = 'id,source,permalink_url,length';

function toSource(v: Raw): VideoSource | null {
  if (!v?.source) return null;
  const len = Number(v.length);
  return { sourceUrl: String(v.source), permalinkUrl: v.permalink_url ? String(v.permalink_url) : null, lengthSec: Number.isFinite(len) ? len : null };
}

/**
 * URL temporária do vídeo de um anúncio. O GET direto com o token do usuário costuma dar (#10) pra vídeo de anúncio
 * (o dono é a página ou a biblioteca da conta), então cai pra: 1) token da página conectada (e das outras do usuário);
 * 2) biblioteca de vídeos da conta (`act_/advideos`). Cada tentativa que falha vira uma linha no failDetail.
 */
export async function videoSource(g: GraphClient, token: string, videoId: string, ctx: { adAccountId?: string | null; pageId?: string | null } = {}): Promise<VideoSource> {
  const tried: string[] = [];
  const attempt = async (label: string, fn: () => Promise<VideoSource | null>): Promise<VideoSource | null> => {
    try {
      const r = await fn();
      if (!r) tried.push(`${label}: no source`);
      return r;
    } catch (e) {
      if (isMetaError(e) && e.code === 'META_TOKEN_INVALID') throw e;
      tried.push(`${label}: ${isMetaError(e) ? e.failDetail ?? e.code : (e as Error).message}`);
      return null;
    }
  };
  const direct = await attempt('user', async () => toSource(await g.get<Raw>(videoId, { fields: VIDEO_FIELDS }, token, { stage: 'fetching_video' })));
  if (direct) return direct;
  const pages = await attempt('pages', async () => {
    const r = await g.get<Raw>('me/accounts', { fields: 'id,access_token', limit: 100 }, token, { stage: 'fetching_video' });
    const list = (Array.isArray(r.data) ? (r.data as Raw[]) : []).filter((p) => p.access_token);
    list.sort((a, b) => Number(String(b.id) === ctx.pageId) - Number(String(a.id) === ctx.pageId)); // a página conectada primeiro
    for (const p of list.slice(0, 10)) {
      try {
        const v = toSource(await g.get<Raw>(videoId, { fields: VIDEO_FIELDS }, String(p.access_token), { stage: 'fetching_video', retries: 0 }));
        if (v) return v;
      } catch (e) {
        tried.push(`page ${String(p.id)}: ${isMetaError(e) ? e.failDetail ?? e.code : (e as Error).message}`);
      }
    }
    return null;
  });
  if (pages) return pages;
  if (ctx.adAccountId) {
    const act = ctx.adAccountId.startsWith('act_') ? ctx.adAccountId : `act_${ctx.adAccountId}`;
    const lib = await attempt('advideos', async () => {
      let after: string | null = null;
      for (let i = 0; i < 5; i++) {
        const r: Raw = await g.get<Raw>(`${act}/advideos`, { fields: VIDEO_FIELDS, limit: 100, ...(after && { after }) }, token, { stage: 'fetching_video' });
        const hit = (Array.isArray(r.data) ? (r.data as Raw[]) : []).find((v) => String(v.id) === videoId);
        if (hit) return toSource(hit);
        after = (r.paging as Raw | undefined)?.cursors ? String(((r.paging as Raw).cursors as Raw).after ?? '') || null : null;
        if (!after || !(r.paging as Raw).next) break;
      }
      return null;
    });
    if (lib) return lib;
  }
  throw new MetaError('META_VIDEO_UNAVAILABLE', null, { failDetail: tried.join(' | ').slice(0, 900) });
}

export function isoOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
