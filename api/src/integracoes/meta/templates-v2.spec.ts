// meta-templates-v2 (I2, 03/11): corpos da Graph do §6, leituras do §4 (listas.ts) e campos do §7. Só fetch falso:
// NENHUMA chamada real à Graph (P3 adiada pelo Gusta em 03/11).
import type { MetaPublishInput, MetaPublishStructure } from '../contrato';
import { MetaError } from './erros';
import { LiveMetaService } from './live.service';
import { AUDIENCES_TTL_MS, LOCALES_TTL_MS, audienceOf } from './listas';
import { adSetBody, budgetTooLowDetails, campaignBody, creativeBody, graphTime, lifetimeDays } from './publicacao';
import { TEMPLATE_FIELDS, adOf, adsetOf, campaignOf } from './templates';
import { DEFAULT_RULE } from './vencedor';

// ---------- fetch falso (mesmo molde do live.spec) ----------
type Call = { url: URL; method: string; body: unknown; headers: Record<string, string> };
type Reply = Response | Record<string, unknown> | ((c: Call) => Response | Record<string, unknown>);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gerr = (status: number, error: Record<string, unknown>) => json(status, { error });
function graphFake(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const f = (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const c = { url, method, body, headers };
    calls.push(c);
    const key = `${method} ${url.pathname.replace(/^\/v\d+\.\d+/, '')}`;
    const r = routes[key];
    if (r === undefined) return json(404, { error: { message: `no route ${key}`, code: 803 } });
    const one = Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0]) : r;
    const out = typeof one === 'function' ? one(c) : one;
    return out instanceof Response ? out : json(200, out);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const NOW = new Date('2026-11-03T12:00:00.000Z');
let clock = NOW.getTime();
const live = (routes: Record<string, Reply | Reply[]>) => {
  const g = graphFake(routes);
  const svc = new LiveMetaService({ appId: '1234567890', appSecret: 'shh', configId: 'cfg', redirectUri: 'https://api.test/cb', jwtSecret: 'jwt', rule: DEFAULT_RULE, sleep: async () => undefined, fetchImpl: g.f, now: () => new Date(clock) });
  return { svc, calls: g.calls };
};
const auth = { accessToken: 'EAAuser' };

// ---------- entrada de publicação ----------
const SETTINGS = { objective: 'OUTCOME_SALES', dailyBudgetMinor: 2000, countries: ['US'], ageMin: 18, ageMax: 65, primaryText: 'Found $300/month', headline: 'Orbit', description: 'desc', callToAction: 'SHOP_NOW', link: 'https://example.com', specialAdCategories: [], objectiveReason: null, pixelEvent: 'PURCHASE' } as unknown as MetaPublishInput['settings'];
const CBO: MetaPublishStructure = { campaignName: 'C', adsetName: 'S', budgetMode: 'CBO', bidStrategy: 'COST_CAP', bidAmountMinor: 900, genders: 'FEMALE', advantageAudience: false, placements: { platforms: ['facebook', 'instagram'], positions: ['facebook_feed', 'instagram_story'] }, urlTags: 'utm_source=fb' };
const ABO: MetaPublishStructure = { ...CBO, budgetMode: 'ABO', bidStrategy: 'LOWEST_COST', bidAmountMinor: null, genders: 'ALL', advantageAudience: true, placements: 'AUTO', urlTags: null };
const input = (structure: MetaPublishStructure | null, settings: Partial<MetaPublishInput['settings']> = {}): MetaPublishInput => ({
  adAccountId: 'act_1', pageId: 'p1', pixelId: 'px1', adName: 'HM — Hook A',
  settings: { ...SETTINGS, ...settings } as MetaPublishInput['settings'],
  video: { fileUrl: 'https://cdn/v.mp4', sizeBytes: null, read: null }, thumbnailUrl: 'https://cdn/thumb.jpg', structure,
});
const thrown = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return e instanceof MetaError ? `${e.code}: ${e.message}` : String(e); } };

/** Corpos gerados pelo código ANTES da v2 (03/11, saída real de campaignBody/adSetBody/creativeBody), sem e com template. */
const V1 = JSON.parse('{"none":{"campaign":{"name":"HM — Hook A","objective":"OUTCOME_SALES","status":"PAUSED","special_ad_categories":[],"buying_type":"AUCTION","is_adset_budget_sharing_enabled":false},"adset":{"name":"HM — Hook A","campaign_id":"c1","daily_budget":2000,"bid_strategy":"LOWEST_COST_WITHOUT_CAP","billing_event":"IMPRESSIONS","status":"PAUSED","targeting":{"geo_locations":{"countries":["US"]},"age_min":18,"age_max":65,"targeting_automation":{"advantage_audience":1}},"optimization_goal":"OFFSITE_CONVERSIONS","promoted_object":{"pixel_id":"px1","custom_event_type":"PURCHASE"}},"creative":{"name":"HM — Hook A","object_story_spec":{"page_id":"p1","video_data":{"video_id":"v1","image_url":"https://cdn/thumb.jpg","message":"Found $300/month","title":"Orbit","link_description":"desc","call_to_action":{"type":"SHOP_NOW","value":{"link":"https://example.com"}}}}}},"cbo":{"campaign":{"name":"C","objective":"OUTCOME_SALES","status":"PAUSED","special_ad_categories":[],"buying_type":"AUCTION","daily_budget":2000,"bid_strategy":"COST_CAP"},"adset":{"name":"S","campaign_id":"c1","bid_amount":900,"billing_event":"IMPRESSIONS","status":"PAUSED","targeting":{"geo_locations":{"countries":["US"]},"age_min":18,"age_max":65,"targeting_automation":{"advantage_audience":0},"genders":[2],"publisher_platforms":["facebook","instagram"],"facebook_positions":["feed"],"instagram_positions":["story"]},"optimization_goal":"OFFSITE_CONVERSIONS","promoted_object":{"pixel_id":"px1","custom_event_type":"PURCHASE"}},"creative":{"name":"HM — Hook A","object_story_spec":{"page_id":"p1","video_data":{"video_id":"v1","image_url":"https://cdn/thumb.jpg","message":"Found $300/month","title":"Orbit","link_description":"desc","call_to_action":{"type":"SHOP_NOW","value":{"link":"https://example.com"}}}},"url_tags":"utm_source=fb"}},"abo":{"campaign":{"name":"C","objective":"OUTCOME_SALES","status":"PAUSED","special_ad_categories":[],"buying_type":"AUCTION","is_adset_budget_sharing_enabled":false},"adset":{"name":"S","campaign_id":"c1","daily_budget":2000,"bid_strategy":"LOWEST_COST_WITHOUT_CAP","billing_event":"IMPRESSIONS","status":"PAUSED","targeting":{"geo_locations":{"countries":["US"]},"age_min":18,"age_max":65,"targeting_automation":{"advantage_audience":1}},"optimization_goal":"OFFSITE_CONVERSIONS","promoted_object":{"pixel_id":"px1","custom_event_type":"PURCHASE"}},"creative":{"name":"HM — Hook A","object_story_spec":{"page_id":"p1","video_data":{"video_id":"v1","image_url":"https://cdn/thumb.jpg","message":"Found $300/month","title":"Orbit","link_description":"desc","call_to_action":{"type":"SHOP_NOW","value":{"link":"https://example.com"}}}}}}}');

describe('publicação v2 §6: corpos da Graph', () => {
  it('template v1 (sem campo novo) e Custom: corpo idêntico ao de antes da v2', () => {
    for (const [k, st] of [['none', null], ['cbo', CBO], ['abo', ABO]] as const) {
      const i = input(st);
      expect(campaignBody(i)).toEqual(V1[k].campaign);
      expect(adSetBody(i, 'c1', NOW)).toEqual(V1[k].adset);
      expect(creativeBody(i, 'v1')).toEqual(V1[k].creative);
    }
    // valores neutros que o editor v2 manda (DAILY, sem agendamento, listas vazias, IG null) também não mudam nada
    const neutral: Partial<MetaPublishStructure> = { budgetType: 'DAILY', lifetimeBudgetMinor: null, startTime: null, endTime: null, optimizationGoal: null, locales: [], customAudienceIds: [], excludedCustomAudienceIds: [], instagramUserId: null };
    const i = input({ ...CBO, ...neutral });
    expect([campaignBody(i), adSetBody(i, 'c1', NOW), creativeBody(i, 'v1')]).toEqual([V1.cbo.campaign, V1.cbo.adset, V1.cbo.creative]);
  });

  it('§2.1 Awareness: cada meta da tabela, padrão REACH, promoted_object { page_id }, sem destination_type e sem pixel', () => {
    const aw = (goal: MetaPublishStructure['optimizationGoal']) => adSetBody(input({ ...ABO, optimizationGoal: goal }, { objective: 'OUTCOME_AWARENESS', pixelEvent: null }), 'c1', NOW);
    const d = aw(null);
    expect(d).toMatchObject({ optimization_goal: 'REACH', billing_event: 'IMPRESSIONS', promoted_object: { page_id: 'p1' } });
    expect(d).not.toHaveProperty('destination_type');
    expect(JSON.stringify(d)).not.toContain('px1'); // pixel nunca vai, mesmo com pixelId na conexão
    for (const g of ['REACH', 'IMPRESSIONS', 'AD_RECALL_LIFT', 'THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'] as const) {
      expect(aw(g)).toMatchObject({ optimization_goal: g, billing_event: 'IMPRESSIONS', promoted_object: { page_id: 'p1' } });
    }
    expect(thrown(() => aw('POST_ENGAGEMENT'))).toBe('META_ERROR: optimization goal POST_ENGAGEMENT is not valid for OUTCOME_AWARENESS');
    expect(campaignBody(input(CBO, { objective: 'OUTCOME_AWARENESS' }))).toMatchObject({ objective: 'OUTCOME_AWARENESS', buying_type: 'AUCTION', status: 'PAUSED' });
  });

  it('§2.1 Engagement: ThruPlay/2 s = ON_VIDEO, POST_ENGAGEMENT = ON_POST, padrão THRUPLAY, sem promoted_object', () => {
    const en = (goal: MetaPublishStructure['optimizationGoal']) => adSetBody(input({ ...ABO, optimizationGoal: goal }, { objective: 'OUTCOME_ENGAGEMENT' }), 'c1', NOW);
    expect(en(null)).toMatchObject({ optimization_goal: 'THRUPLAY', destination_type: 'ON_VIDEO', billing_event: 'IMPRESSIONS' });
    expect(en('THRUPLAY')).toMatchObject({ optimization_goal: 'THRUPLAY', destination_type: 'ON_VIDEO' });
    expect(en('TWO_SECOND_CONTINUOUS_VIDEO_VIEWS')).toMatchObject({ optimization_goal: 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', destination_type: 'ON_VIDEO' });
    expect(en('POST_ENGAGEMENT')).toMatchObject({ optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST' });
    for (const g of [null, 'THRUPLAY', 'POST_ENGAGEMENT'] as const) expect(en(g)).not.toHaveProperty('promoted_object');
    expect(thrown(() => en('REACH'))).toContain('META_ERROR');
  });

  it('§2.1 Sales/Leads/App/Traffic: optimizationGoal ignorado, otimização da v1 (pixel / LINK_CLICKS)', () => {
    expect(adSetBody(input({ ...ABO, optimizationGoal: 'REACH' }), 'c1', NOW)).toMatchObject({ optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'px1', custom_event_type: 'PURCHASE' } });
    const tr = adSetBody(input({ ...ABO, optimizationGoal: null }, { objective: 'OUTCOME_TRAFFIC' }), 'c1', NOW);
    expect(tr.optimization_goal).toBe('LINK_CLICKS');
    expect(tr).not.toHaveProperty('destination_type');
  });

  it('§2.2 orçamento: CBO/ABO × DAILY/LIFETIME no nível certo; LIFETIME sem total ou sem fim = META_ERROR antes da Graph', () => {
    const end = '2026-11-10T15:00:00.000Z';
    // CBO + DAILY
    expect(campaignBody(input({ ...CBO, budgetType: 'DAILY' }))).toMatchObject({ daily_budget: 2000, bid_strategy: 'COST_CAP' });
    // CBO + LIFETIME: total na campanha, conjunto sem orçamento (só bid_amount do cap) e com end_time
    const cboL = input({ ...CBO, budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, endTime: end }, { dailyBudgetMinor: 0 });
    const c = campaignBody(cboL);
    expect(c).toMatchObject({ lifetime_budget: 30000, bid_strategy: 'COST_CAP' });
    expect(c).not.toHaveProperty('daily_budget');
    const s = adSetBody(cboL, 'c1', NOW);
    expect(s).toMatchObject({ bid_amount: 900, end_time: '2026-11-10T15:00:00+0000' });
    expect(s).not.toHaveProperty('daily_budget');
    expect(s).not.toHaveProperty('lifetime_budget');
    expect(s).not.toHaveProperty('bid_strategy');
    // ABO + DAILY
    expect(adSetBody(input({ ...ABO, budgetType: 'DAILY' }), 'c1', NOW)).toMatchObject({ daily_budget: 2000, bid_strategy: 'LOWEST_COST_WITHOUT_CAP' });
    // ABO + LIFETIME: total em cada conjunto + bid_strategy; campanha sem orçamento
    const aboL = input({ ...ABO, budgetType: 'LIFETIME', lifetimeBudgetMinor: 7000, endTime: end }, { dailyBudgetMinor: 0 });
    const a = adSetBody(aboL, 'c1', NOW);
    expect(a).toMatchObject({ lifetime_budget: 7000, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', end_time: '2026-11-10T15:00:00+0000' });
    expect(a).not.toHaveProperty('daily_budget');
    expect(campaignBody(aboL)).toEqual({ ...V1.abo.campaign });
    // travas
    expect(thrown(() => adSetBody(input({ ...ABO, budgetType: 'LIFETIME', lifetimeBudgetMinor: 7000, endTime: null }), 'c1', NOW))).toBe('META_ERROR: lifetime budget needs an end time');
    expect(thrown(() => campaignBody(input({ ...CBO, budgetType: 'LIFETIME', lifetimeBudgetMinor: null, endTime: end })))).toBe('META_ERROR: lifetime budget without an amount');
  });

  it('§2.3 agendamento: start_time só se futuro, end_time quando há fim, formato +0000', () => {
    const at = (startTime: string | null, endTime: string | null) => adSetBody(input({ ...ABO, startTime, endTime }), 'c1', NOW);
    expect(at('2026-11-05T13:30:00.000Z', '2026-11-12T13:30:00.000Z')).toMatchObject({ start_time: '2026-11-05T13:30:00+0000', end_time: '2026-11-12T13:30:00+0000' });
    const past = at('2026-11-01T00:00:00.000Z', null);
    expect(past).not.toHaveProperty('start_time');
    expect(past).not.toHaveProperty('end_time');
    expect(at(null, '2026-11-12T13:30:00.000Z')).toMatchObject({ end_time: '2026-11-12T13:30:00+0000' });
    expect(at(null, '2026-11-12T13:30:00.000Z')).not.toHaveProperty('start_time');
    expect(graphTime('2026-11-10T14:00:00Z')).toBe('2026-11-10T14:00:00+0000');
    expect(thrown(() => graphTime('ontem'))).toContain('META_ERROR');
  });

  it('§2.4/§2.6 targeting: locales e públicos (incluir/excluir) só quando não vazios', () => {
    const t = adSetBody(input({ ...ABO, locales: [6, 24], customAudienceIds: ['ca1', 'ca2'], excludedCustomAudienceIds: ['ca3'] }), 'c1', NOW).targeting;
    expect(t).toMatchObject({ locales: [6, 24], custom_audiences: [{ id: 'ca1' }, { id: 'ca2' }], excluded_custom_audiences: [{ id: 'ca3' }], geo_locations: { countries: ['US'] } });
    const only = adSetBody(input({ ...ABO, locales: [], customAudienceIds: [], excludedCustomAudienceIds: ['ca3'] }), 'c1', NOW).targeting;
    expect(only).not.toHaveProperty('locales');
    expect(only).not.toHaveProperty('custom_audiences');
    expect(only.excluded_custom_audiences).toEqual([{ id: 'ca3' }]);
  });

  it('§2.5 criativo: instagram_user_id na object_story_spec (nunca instagram_actor_id), page_id da conexão', () => {
    const c = creativeBody(input({ ...ABO, instagramUserId: 'ig_1' }), 'v1');
    expect(c.object_story_spec).toMatchObject({ page_id: 'p1', instagram_user_id: 'ig_1', video_data: { video_id: 'v1' } });
    expect(JSON.stringify(c)).not.toContain('instagram_actor_id');
    expect(creativeBody(input({ ...ABO, instagramUserId: null }), 'v1').object_story_spec).not.toHaveProperty('instagram_user_id');
  });

  it('campo só no settings (MetaPublication.settings) também vale; o da structure ganha quando os dois vêm', () => {
    const i = input(ABO, { locales: [6], instagramUserId: 'ig_s', budgetType: 'LIFETIME', lifetimeBudgetMinor: 5000, endTime: '2026-11-10T00:00:00.000Z' } as Partial<MetaPublishInput['settings']>);
    expect(adSetBody(i, 'c1', NOW)).toMatchObject({ lifetime_budget: 5000, targeting: { locales: [6] } });
    expect(creativeBody(i, 'v1').object_story_spec.instagram_user_id).toBe('ig_s');
    const both = input({ ...ABO, locales: [24] }, { locales: [6] } as Partial<MetaPublishInput['settings']>);
    expect(adSetBody(both, 'c1', NOW).targeting.locales).toEqual([24]);
  });

  it('META_BUDGET_TOO_LOW: DAILY igual v1; LIFETIME = mínimo diário × dias (início efetivo = agora se passou)', () => {
    expect(budgetTooLowDetails(input(ABO), 500, 'USD', NOW)).toEqual({ minimumMinor: 500, currency: 'USD' });
    const l = input({ ...ABO, budgetType: 'LIFETIME', lifetimeBudgetMinor: 1000, startTime: null, endTime: '2026-11-10T12:00:00.000Z' });
    expect(budgetTooLowDetails(l, 500, 'USD', NOW)).toEqual({ minimumMinor: 3500, currency: 'USD', budgetType: 'LIFETIME', days: 7 });
    expect(lifetimeDays({ startTime: '2026-11-05T12:00:00.000Z', endTime: '2026-11-06T13:00:00.000Z' }, NOW)).toBe(2); // 25 h → teto = 2
    expect(lifetimeDays({ startTime: '2026-10-01T00:00:00.000Z', endTime: '2026-11-04T12:00:00.000Z' }, NOW)).toBe(1); // início passado = agora
    expect(lifetimeDays({ startTime: null, endTime: null }, NOW)).toBeNull();
  });

  it('live createAdSet LIFETIME: a Graph recusa o mínimo → 422 com o total e budgetType/days (lê a conta se o texto não traz o valor)', async () => {
    clock = NOW.getTime();
    const { svc, calls } = live({
      'POST /act_1/adsets': gerr(400, { message: 'Invalid parameter', code: 100, error_subcode: 1487005, error_user_msg: 'Your budget is too low.' }),
      'GET /act_1': { id: 'act_1', currency: 'BRL', account_status: 1, minimum_budgets: [{ currency: 'BRL', min_daily_budget_imp: 2500 }] },
    });
    const i = input({ ...ABO, budgetType: 'LIFETIME', lifetimeBudgetMinor: 1000, endTime: '2026-11-06T12:00:00.000Z' }, { dailyBudgetMinor: 0 });
    await expect(svc.createAdSet(auth, i, { videoId: 'v', creativeId: null, campaignId: 'c1', adsetId: null, adId: null })).rejects.toMatchObject({
      code: 'META_BUDGET_TOO_LOW', stage: 'creating_adset', details: { minimumMinor: 7500, currency: 'BRL', budgetType: 'LIFETIME', days: 3 },
    });
    const sent = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ lifetime_budget: 1000, end_time: '2026-11-06T12:00:00+0000' });
  });
});

describe('importação v2 §7: campos lidos', () => {
  it('TEMPLATE_FIELDS pede buying_type, destination_type e instagram_user_id', () => {
    expect(TEMPLATE_FIELDS.campaign.split(',')).toContain('buying_type');
    expect(TEMPLATE_FIELDS.adset.split(',')).toContain('destination_type');
    expect(TEMPLATE_FIELDS.ad).toContain('creative{id,url_tags,instagram_user_id,object_story_spec,asset_feed_spec}');
  });
  it('campaignOf/adsetOf/adOf: buyingType, destinationType, instagramUserId (do criativo ou da object_story_spec) e formato', () => {
    expect(campaignOf({ id: 'c', name: 'C', objective: 'OUTCOME_AWARENESS', buying_type: 'RESERVED' }).buyingType).toBe('RESERVED');
    expect(campaignOf({ id: 'c' }).buyingType).toBeNull();
    expect(adsetOf({ id: 's', destination_type: 'ON_VIDEO' }).destinationType).toBe('ON_VIDEO');
    expect(adsetOf({ id: 's' }).destinationType).toBeNull();
    const video = adOf({ id: 'a', creative: { id: 'cr', instagram_user_id: '178', object_story_spec: { page_id: 'p', video_data: { message: 'm' } } } }).creative!;
    expect(video).toMatchObject({ instagramUserId: '178', format: 'VIDEO', message: 'm' });
    expect(adOf({ id: 'a', creative: { id: 'cr', object_story_spec: { instagram_user_id: '179', video_data: {} } } }).creative!.instagramUserId).toBe('179');
    expect(adOf({ id: 'a', creative: { id: 'cr', object_story_spec: { instagram_actor_id: '999', video_data: {} } } }).creative!.instagramUserId).toBeNull();
    expect(adOf({ id: 'a', creative: { id: 'cr', asset_feed_spec: { videos: [] }, object_story_spec: {} } }).creative!.format).toBe('ASSET_FEED');
    expect(adOf({ id: 'a', creative: { id: 'cr', object_story_spec: { link_data: { child_attachments: [{}, {}] } } } }).creative!.format).toBe('CAROUSEL');
    expect(adOf({ id: 'a', creative: { id: 'cr', object_story_spec: { link_data: { link: 'https://x' } } } }).creative!.format).toBe('LINK');
  });
});

describe('listas v2 §4 (live, fetch falso)', () => {
  const IG_ACT = { data: [{ id: 'ig2', username: 'zeta', profile_pic: 'https://pic/2' }, { id: 'ig1', username: 'alpha' }] };
  const IG_PAGE = { data: [{ id: 'ig3', username: 'page.brand', profile_pic: 'https://pic/3' }, { id: 'ig2', username: 'zeta' }] };

  it('Instagram: junta conta + Página (token da Página), PAGE primeiro, sem repetir id, depois username', async () => {
    const { svc, calls } = live({ 'GET /act_1/instagram_accounts': IG_ACT, 'GET /p1': { id: 'p1', access_token: 'EAApage' }, 'GET /p1/instagram_accounts': IG_PAGE });
    const r = await svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' });
    expect(r).toEqual({
      pageLookup: 'ok',
      accounts: [
        { id: 'ig3', username: 'page.brand', profilePicUrl: 'https://pic/3', source: 'PAGE' },
        { id: 'ig2', username: 'zeta', profilePicUrl: null, source: 'PAGE' },
        { id: 'ig1', username: 'alpha', profilePicUrl: null, source: 'AD_ACCOUNT' },
      ],
    });
    const byPath = (p: string) => calls.find((c) => c.url.pathname.endsWith(p))!;
    expect(byPath('/act_1/instagram_accounts').url.searchParams.get('fields')).toBe('id,username,profile_pic');
    expect(byPath('/act_1/instagram_accounts').headers.authorization).toBe('Bearer EAAuser');
    expect(byPath('/p1').url.searchParams.get('fields')).toBe('access_token');
    expect(byPath('/p1/instagram_accounts').headers.authorization).toBe('Bearer EAApage'); // a lista da Página vai com o token DELA
    expect(calls.every((c) => !c.url.search.includes('access_token=EAA'))).toBe(true);
  });
  it('Instagram: sem Página = no_page (sem chamar a Página); Meta nega a Página = unavailable; 190 do usuário sobe', async () => {
    const a = live({ 'GET /act_1/instagram_accounts': IG_ACT });
    expect(await a.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: null })).toMatchObject({ pageLookup: 'no_page', accounts: [{ id: 'ig1' }, { id: 'ig2' }] });
    expect(a.calls).toHaveLength(1);
    const denied = live({ 'GET /act_1/instagram_accounts': IG_ACT, 'GET /p1': gerr(403, { message: '(#10) Requires pages_read_engagement permission', code: 10 }) });
    expect(await denied.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' })).toMatchObject({ pageLookup: 'unavailable', accounts: [{ source: 'AD_ACCOUNT' }, { source: 'AD_ACCOUNT' }] });
    const noToken = live({ 'GET /act_1/instagram_accounts': IG_ACT, 'GET /p1': { id: 'p1' } });
    expect((await noToken.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' })).pageLookup).toBe('unavailable');
    // 190 com o token DA PÁGINA não derruba a conexão do usuário
    const pageTok = live({ 'GET /act_1/instagram_accounts': IG_ACT, 'GET /p1': { access_token: 'EAApage' }, 'GET /p1/instagram_accounts': gerr(400, { message: 'Error validating access token', code: 190 }) });
    expect((await pageTok.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' })).pageLookup).toBe('unavailable');
    const userTok = live({ 'GET /act_1/instagram_accounts': gerr(400, { message: 'Error validating access token', code: 190 }) });
    await expect(userTok.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' })).rejects.toMatchObject({ code: 'META_TOKEN_INVALID' });
    const userTokOnPage = live({ 'GET /act_1/instagram_accounts': IG_ACT, 'GET /p1': gerr(400, { message: 'Error validating access token', code: 190 }) });
    await expect(userTokOnPage.svc.listInstagramAccounts(auth, { adAccountId: 'act_1', pageId: 'p1' })).rejects.toMatchObject({ code: 'META_TOKEN_INVALID' });
  });

  it('públicos: campos, usable (delivery < 300 e operation ≠ 471), tamanho -1 = null, mais recentes primeiro, cache de 5 min por conta', async () => {
    clock = NOW.getTime();
    const rows = [
      { id: 'old', name: 'Old', subtype: 'CUSTOM', approximate_count_lower_bound: 1000, approximate_count_upper_bound: 1200, delivery_status: { code: 200 }, operation_status: { code: 200 }, time_updated: 1700000000 },
      { id: 'new', name: 'New LAL', subtype: 'LOOKALIKE', approximate_count_lower_bound: '1200000', approximate_count_upper_bound: '1400000', delivery_status: { code: 200 }, operation_status: { code: 200 }, time_updated: 1790000000 },
      { id: 'small', name: 'Small', subtype: 'CUSTOM', approximate_count_lower_bound: -1, approximate_count_upper_bound: -1, delivery_status: { code: 300, description: 'Audience too small' }, operation_status: { code: 200 }, time_updated: 1780000000 },
      { id: 'flag', name: 'Flag', subtype: 'CUSTOM', delivery_status: { code: 200 }, operation_status: { code: 471, description: 'Flagged' } },
    ];
    const { svc, calls } = live({ 'GET /act_1/customaudiences': { data: rows } });
    const r = await svc.listCustomAudiences(auth, { adAccountId: 'act_1' });
    expect(r.truncated).toBe(false);
    expect(r.audiences.map((a) => a.id)).toEqual(['new', 'small', 'old', 'flag']);
    expect(r.audiences[0]).toEqual({ id: 'new', name: 'New LAL', subtype: 'LOOKALIKE', sizeLower: 1200000, sizeUpper: 1400000, usable: true, unusableReason: null, updatedAt: new Date(1790000000 * 1000).toISOString() });
    expect(r.audiences.find((a) => a.id === 'small')).toMatchObject({ usable: false, unusableReason: 'Audience too small', sizeLower: null, sizeUpper: null });
    expect(r.audiences.find((a) => a.id === 'flag')).toMatchObject({ usable: false, unusableReason: 'Flagged', updatedAt: null });
    expect(calls[0].url.searchParams.get('fields')).toBe('id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated');
    // cache: mesma conta dentro de 5 min não chama a Graph; depois chama; outra conta chama
    await svc.listCustomAudiences(auth, { adAccountId: 'act_1' });
    expect(calls).toHaveLength(1);
    clock += AUDIENCES_TTL_MS + 1;
    await svc.listCustomAudiences(auth, { adAccountId: 'act_1' });
    expect(calls).toHaveLength(2);
    clock = NOW.getTime();
  });
  it('públicos: mais de 500 = truncated (devolve 500)', async () => {
    const rows = Array.from({ length: 501 }, (_, n) => ({ id: `a${n}`, name: `A${n}`, delivery_status: { code: 200 }, operation_status: { code: 200 }, time_updated: 1700000000 + n }));
    const { svc } = live({ 'GET /act_9/customaudiences': { data: rows } });
    const r = await svc.listCustomAudiences(auth, { adAccountId: 'act_9' });
    expect(r).toMatchObject({ truncated: true });
    expect(r.audiences).toHaveLength(500);
    expect(r.audiences[0].id).toBe('a500');
    expect(audienceOf({})).toBeNull();
  });

  it('idiomas: search?type=adlocale&q=&limit=1000&locale=en_US, name asc, sem chave repetida/ inválida, cache de 24 h', async () => {
    clock = NOW.getTime();
    const { svc, calls } = live({ 'GET /search': { data: [{ key: 24, name: 'English (UK)' }, { key: 6, name: 'English (US)' }, { key: 6, name: 'dup' }, { key: 'x', name: 'bad' }, { key: 5, name: 'German' }, { key: 1001, name: 'English (All)' }] } });
    const r = await svc.listLocales(auth);
    expect(r.locales).toEqual([{ key: 1001, name: 'English (All)' }, { key: 24, name: 'English (UK)' }, { key: 6, name: 'English (US)' }, { key: 5, name: 'German' }]);
    const q = calls[0].url.searchParams;
    expect([q.get('type'), q.get('q'), q.get('limit'), q.get('locale')]).toEqual(['adlocale', '', '1000', 'en_US']);
    await svc.listLocales(auth);
    expect(calls).toHaveLength(1);
    clock += LOCALES_TTL_MS + 1;
    await svc.listLocales(auth);
    expect(calls).toHaveLength(2);
    clock = NOW.getTime();
    // lista vazia não fica em cache
    const empty = live({ 'GET /search': [{ data: [] }, { data: [{ key: 6, name: 'English (US)' }] }] });
    expect((await empty.svc.listLocales(auth)).locales).toEqual([]);
    expect((await empty.svc.listLocales(auth)).locales).toHaveLength(1);
  });
});
