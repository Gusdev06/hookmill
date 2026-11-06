// Leitura da Marketing API (meta-v1.md §3.1 options/health e §3.2 sync): contas com user_tasks, páginas, pixels com
// last_fired_time, verification_status, anúncios de vídeo (até 500) e as 3 janelas de insights → MetaMetrics.
import type { MetaAdAccountOption, MetaDestinationSource, MetaMetrics, MetaOptions } from '@maquina/contratos';
import type { BusinessType, ResultType, MetaAdAccountInfo, MetaAdSnapshotDraft, MetaAdsetSnapshotDraft, MetaCampaignSnapshotDraft, MetaSyncInput, MetaSyncStage } from '../contrato';
import { Logger } from '@nestjs/common';
import { GraphClient, type Raw } from './cliente';
import { MetaError, accountStatusLabel, isMetaError } from './erros';

const log = new Logger('MetaLeitura');

// Listagem LEVE (bug live 22/10: com `object_story_spec` a Graph devolvia code 1 "reduce the amount of data" em conta grande).
// O `video_id` de criativo que só tem `object_story_spec.video_data` e o link de destino (meta-oferta-v1 §2) saem do lookup
// por criativo (readCreativeLinks), depois dos insights, por gasto.
export const AD_FIELDS = 'id,name,status,effective_status,created_time,campaign{id,name},adset{id,name},creative{id,video_id,thumbnail_url,object_type}';
/** campanhas-v1 §1 (22/10): estrutura + orçamento por nível. Orçamentos vêm em string, em centavos da moeda da conta. */
export const CAMPAIGN_FIELDS = 'id,name,objective,status,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,budget_remaining,special_ad_categories,start_time,stop_time,created_time';
export const ADSET_FIELDS = 'id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,budget_remaining,learning_stage_info,start_time,end_time,created_time';
/** Fora da leitura (campanhas-v1 §1): apagados/arquivados não aparecem na tela. */
export const HIDDEN_STATUSES = new Set(['ARCHIVED', 'DELETED']);
/** meta-oferta-v1 §2.2: lookup por criativo (link + video_id numa chamada só): teto por sync e paralelismo. */
export const LINK_LOOKUP_MAX = 250;
export const LINK_LOOKUP_PARALLEL = 5;
/** §2.1: campos do lookup por criativo (sonda S1 pendente: ver PORTA.md). */
export const LINK_FIELDS = 'object_story_spec{link_data{link},video_data{video_id,call_to_action{type,value{link,lead_gen_form_id,app_link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},url_tags,object_type';
/** §2.3: encurtadores seguidos no sync (lista fechada: nunca chama host fora dela). */
export const SHORTENERS = new Set(['bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'cutt.ly', 'ow.ly', 'rebrand.ly', 'is.gd', 'shorturl.at', 'rb.gy', 't.ly', 'tiny.cc', 'buff.ly', 'lnkd.in', 'encurtador.com.br']);
export const SHORTENER_MAX = 50;
export const SHORTENER_HOPS = 3;
export const SHORTENER_TIMEOUT_MS = 3_000;
/** §2.1: destino de conversa, não de site (fica `messaging`, sem URL). */
const MESSAGING_HOSTS = new Set(['wa.me', 'api.whatsapp.com', 'm.me', 'messenger.com', 'ig.me']);
const MESSAGING_CTAS = new Set(['MESSAGE_PAGE', 'WHATSAPP_MESSAGE']);
const MAX_URLS = 5;
const MAX_URL_LEN = 2048;
const MAX_TAGS_LEN = 1024;
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
/**
 * resultado-v1 (28/10): action_type por ResultType. `pixel: false` = conta mesmo sem pixel (conversa é métrica da Meta).
 * SCHEDULE/SUBSCRIBE/COMPLETE_REGISTRATION e messaging: nomes da Marketing API ainda NÃO conferidos numa conta live
 * (sem anúncio desses tipos no ar); o fallback cobre a variante por canal. Purchase/lead/install = os de antes.
 */
export const RESULT_ACTIONS: Record<ResultType, { primary: string; fallback: string | null; pixel: boolean }> = {
  PURCHASE: { primary: 'omni_purchase', fallback: 'purchase', pixel: true },
  SUBSCRIPTION: { primary: 'subscribe_total', fallback: 'subscribe_website', pixel: true },
  LEAD: { primary: 'lead', fallback: 'onsite_conversion.lead_grouped', pixel: true },
  APPOINTMENT: { primary: 'schedule_total', fallback: 'schedule_website', pixel: true },
  SIGNUP: { primary: 'omni_complete_registration', fallback: 'complete_registration', pixel: true },
  MESSAGE: { primary: 'onsite_conversion.messaging_conversation_started_7d', fallback: 'onsite_conversion.total_messaging_connection', pixel: false },
  APP_INSTALL: { primary: 'omni_app_install', fallback: 'mobile_app_install', pixel: true },
  OTHER: { primary: 'link_click', fallback: null, pixel: false },
};

export function resultActionTypes(businessType: BusinessType | null, hasPixel: boolean, resultType?: ResultType | null): { primary: string; fallback: string | null } {
  if (resultType) {
    const r = RESULT_ACTIONS[resultType];
    return !r.pixel || hasPixel ? { primary: r.primary, fallback: r.fallback } : { primary: 'link_click', fallback: null };
  }
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

/** Link do criativo (§2.1) + o `video_id` da `object_story_spec.video_data` (que antes vinha do fillStoryVideoIds). */
export interface CreativeLinks { destinationUrls: string[]; destinationSource: MetaDestinationSource; urlTags: string | null; videoId: string | null }

const bareHost = (u: string): string | null => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return null;
  }
};
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^https?:\/\//i.test(t) || t.length > MAX_URL_LEN) return null;
  return bareHost(t) ? t : null;
};
const isMessaging = (u: string) => MESSAGING_HOSTS.has(bareHost(u) ?? '');

/** §2.1: lê o criativo na ordem video_cta → story_link → template → asset_feed; o 1º link http(s) define a origem. */
export function linksOfCreative(c: Raw | null | undefined): CreativeLinks {
  const oss = c?.object_story_spec as Raw | undefined;
  const afs = c?.asset_feed_spec as Raw | undefined;
  const cta = oss?.video_data?.call_to_action as Raw | undefined;
  const urlTags = typeof c?.url_tags === 'string' && c.url_tags.trim() ? String(c.url_tags).trim().slice(0, MAX_TAGS_LEN) : null;
  const videoId = oss?.video_data?.video_id ? String(oss.video_data.video_id) : null;
  const feed: unknown[] = Array.isArray(afs?.link_urls) ? (afs!.link_urls as Raw[]).map((l) => l?.website_url) : [];
  const order: [MetaDestinationSource, unknown[]][] = [
    ['video_cta', [cta?.value?.link]], ['story_link', [oss?.link_data?.link]], ['template', [oss?.template_data?.link]], ['asset_feed', feed],
  ];
  for (const [source, raw] of order) {
    const urls = raw.map(httpUrl).filter((u): u is string => !!u);
    if (!urls.length) continue;
    if (isMessaging(urls[0])) return { destinationUrls: [], destinationSource: 'messaging', urlTags, videoId };
    const sites = [...new Set(urls.filter((u) => !isMessaging(u)))].slice(0, MAX_URLS);
    return { destinationUrls: sites, destinationSource: source, urlTags, videoId };
  }
  if (cta?.value?.lead_gen_form_id) return { destinationUrls: [], destinationSource: 'lead_form', urlTags, videoId };
  if (MESSAGING_CTAS.has(String(cta?.type ?? '').toUpperCase())) return { destinationUrls: [], destinationSource: 'messaging', urlTags, videoId };
  if (!oss && !afs) return { destinationUrls: [], destinationSource: 'existing_post', urlTags, videoId };
  return { destinationUrls: [], destinationSource: 'none', urlTags, videoId };
}

export const isShortener = (u: string) => SHORTENERS.has(bareHost(u) ?? '');

/**
 * §2.3: segue o encurtador com HEAD + redirect manual, lendo só o `Location`; para no 1º host fora da lista, até 3 saltos,
 * 3 s cada. Nunca baixa corpo nem chama host fora da lista (sem SSRF). Falhou = devolve o próprio link encurtado.
 */
export async function resolveShortener(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let cur = url;
  for (let hop = 0; hop < SHORTENER_HOPS && isShortener(cur); hop++) {
    try {
      const res = await fetchImpl(cur, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(SHORTENER_TIMEOUT_MS) });
      const loc = res.headers.get('location');
      if (!loc) return url;
      const next = httpUrl(new URL(loc, cur).toString());
      if (!next) return url;
      cur = next;
    } catch {
      return url;
    }
  }
  return isShortener(cur) ? url : cur;
}

/**
 * §2.2: um lookup por criativo traz o link e o `video_id` juntos (substitui o fillStoryVideoIds). Roda depois dos insights,
 * em ordem de gasto 30 d decrescente, até LINK_LOOKUP_MAX por sync, LINK_LOOKUP_PARALLEL por vez, sem retry.
 * Entra quem não está no cache (`known`) e, mesmo no cache, quem ainda precisa do `video_id` (vídeo sem `video_id` na
 * listagem leve): o cache do contrato não guarda o `video_id`, e sem isso o anúncio deixaria de ser vídeo.
 * Falha de um criativo = sem entrada (destinationSource null no snapshot, relido no próximo sync). Não derruba o sync.
 */
export async function readCreativeLinks(
  g: GraphClient, token: string, ads: Raw[], spendOf: (adId: string) => number,
  known: MetaSyncInput['knownCreativeLinks'] = {}, opts: { fetchImpl?: typeof fetch } = {},
): Promise<Map<string, CreativeLinks>> {
  const needsVideo = (a: Raw) => !a.creative.video_id && (!a.creative.object_type || String(a.creative.object_type).toUpperCase() === 'VIDEO');
  const spendBy = new Map<string, number>();
  const want = new Set<string>();
  for (const a of ads) {
    if (!a.creative?.id) continue;
    const id = String(a.creative.id);
    spendBy.set(id, Math.max(spendBy.get(id) ?? 0, spendOf(String(a.id))));
    if (!known?.[id] || needsVideo(a)) want.add(id);
  }
  const queue = [...want].sort((x, y) => (spendBy.get(y) ?? 0) - (spendBy.get(x) ?? 0)).slice(0, LINK_LOOKUP_MAX);
  const found = new Map<string, CreativeLinks>();
  let k = 0;
  const worker = async () => {
    while (k < queue.length) {
      const id = queue[k++];
      try {
        const c = await g.get<Raw>(id, { fields: LINK_FIELDS }, token, { stage: 'reading_insights', retries: 0 });
        found.set(id, linksOfCreative(c));
      } catch (e) {
        log.warn(`link do criativo ${id} falhou: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: LINK_LOOKUP_PARALLEL }, worker));
  // cache: o que já estava lido continua valendo (criativo é imutável); o lookup novo só completa o video_id
  for (const [id, v] of found) {
    const cached = known?.[id];
    if (cached) found.set(id, { ...cached, videoId: v.videoId });
  }
  // §2.3: encurtadores (só dos links novos), teto SHORTENER_MAX por sync
  let budget = SHORTENER_MAX;
  for (const [id, v] of found) {
    if (known?.[id] || !v.destinationUrls.some(isShortener)) continue;
    const out: string[] = [];
    for (const u of v.destinationUrls) out.push(isShortener(u) && budget-- > 0 ? await resolveShortener(u, opts.fetchImpl) : u);
    found.set(id, { ...v, destinationUrls: [...new Set(out)] });
  }
  for (const a of ads) {
    const v = a.creative?.id ? found.get(String(a.creative.id)) : undefined;
    if (v?.videoId && !a.creative.video_id) a.creative.object_story_spec = { ...(a.creative.object_story_spec ?? {}), video_data: { video_id: v.videoId } };
  }
  return found;
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
export async function syncAds(g: GraphClient, token: string, i: MetaSyncInput, onProgress?: (p: { stage: MetaSyncStage; done: number; total: number }) => void, opts: { fetchImpl?: typeof fetch } = {}): Promise<SyncAdsRaw> {
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
  const total = all.length;
  onProgress?.({ stage: 'reading_insights', done: 0, total });

  const result = resultActionTypes(i.businessType, i.hasPixel, i.resultType);
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

  // meta-oferta-v1 §2.2: link + video_id por criativo, depois dos insights (conta em reading_insights), por gasto 30 d
  const known = i.knownCreativeLinks ?? {};
  const links = await readCreativeLinks(g, token, all, (id) => num(read.ad[0].get(id)?.spend), known, opts);
  const linkOf = (ad: Raw): Pick<MetaAdSnapshotDraft, 'destinationUrls' | 'destinationSource' | 'urlTags'> => {
    const id = ad.creative?.id ? String(ad.creative.id) : null;
    const v = (id && links.get(id)) || (id && known[id]) || null;
    return v ? { destinationUrls: v.destinationUrls, destinationSource: v.destinationSource, urlTags: v.urlTags } : { destinationUrls: [], destinationSource: null, urlTags: null };
  };

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
      ...linkOf(ad),
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
 * (o dono é a página ou a biblioteca da conta), então cai pra: 1) o upload original no criativo do anúncio
 * (`object_story_spec.video_data.video_id`: `creative.video_id` pode ser a cópia publicada numa página que o token não
 * gerencia); 2) token da página conectada (e das outras do usuário); 3) biblioteca de vídeos da conta (`act_/advideos`);
 * 4) a mídia do anúncio no Instagram. Cada tentativa que falha vira uma linha no failDetail.
 */
export async function videoSource(g: GraphClient, token: string, videoId: string, ctx: { adAccountId?: string | null; pageId?: string | null; metaAdId?: string | null } = {}): Promise<VideoSource> {
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
  const alt = { videoId: null as string | null, igMediaId: null as string | null };
  if (ctx.metaAdId) {
    const metaAdId = ctx.metaAdId;
    const original = await attempt('creative', async () => {
      const r = await g.get<Raw>(metaAdId, { fields: 'creative{object_story_spec{video_data{video_id}},effective_instagram_media_id}' }, token, { stage: 'fetching_video' });
      const id = r.creative?.object_story_spec?.video_data?.video_id;
      alt.videoId = id && String(id) !== videoId ? String(id) : null;
      alt.igMediaId = r.creative?.effective_instagram_media_id ? String(r.creative.effective_instagram_media_id) : null;
      return alt.videoId ? toSource(await g.get<Raw>(alt.videoId, { fields: VIDEO_FIELDS }, token, { stage: 'fetching_video' })) : null;
    });
    if (original) return original;
  }
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
        const hit = (Array.isArray(r.data) ? (r.data as Raw[]) : []).find((v) => String(v.id) === videoId || String(v.id) === alt.videoId);
        if (hit) return toSource(hit);
        after = (r.paging as Raw | undefined)?.cursors ? String(((r.paging as Raw).cursors as Raw).after ?? '') || null : null;
        if (!after || !(r.paging as Raw).next) break;
      }
      return null;
    });
    if (lib) return lib;
  }
  if (alt.igMediaId) {
    const igMediaId = alt.igMediaId;
    const ig = await attempt('instagram', async () => {
      const r = await g.get<Raw>(igMediaId, { fields: 'media_type,media_url,permalink' }, token, { stage: 'fetching_video' });
      return r.media_type === 'VIDEO' && r.media_url ? { sourceUrl: String(r.media_url), permalinkUrl: r.permalink ? String(r.permalink) : null, lengthSec: null } : null;
    });
    if (ig) return ig;
  }
  throw new MetaError('META_VIDEO_UNAVAILABLE', null, { failDetail: tried.join(' | ').slice(0, 900) });
}

export function isoOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
