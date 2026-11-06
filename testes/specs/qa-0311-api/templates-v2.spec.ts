// QA 03/11 (Q1 do meta-templates-v2): contrato da API real em mock (META_MODE=mock, maquina_test, META_CRON=off), por HTTP.
// Os corpos que chegariam na Graph saem do espião do processo de teste (harness/api-qa-espiao.cjs, rota /__qa/meta-sent).
// Rodar (de testes/): npx playwright test -c playwright.qa0311.config.ts --project=qa0311-api
// Dono: maquina-qa.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, tokenOf } from '../../harness/api.ts';
import { q, resetDb } from '../../harness/db.ts';
import { ENV, TESTES_DIR } from '../../harness/env.ts';
import { oferta } from '../../harness/iterate.ts';

test.describe.configure({ mode: 'serial' });
const OUT = join(TESTES_DIR, 'test-results', 'qa-0311-api');
mkdirSync(OUT, { recursive: true });
const SPY = ENV.apiUrl.replace(/\/api\/v1$/, '') + '/__qa/meta-sent';
const evid: Record<string, unknown> = {};
const guarda = (k: string, v: unknown) => { evid[k] = v; writeFileSync(join(OUT, 'evidencias.json'), JSON.stringify(evid, null, 2)); };

let A = '', B = '', CLI = '', MEM = '';
let TZ = 'UTC';
const creativesA: string[] = [];
let creativeB = '';

async function conectarMeta(token: string) {
  const u = await call('POST', '/meta/connect', { body: { returnTo: '/settings' }, token });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  const cb = await fetch(u.data.url, { redirect: 'manual' });
  expect(cb.status).toBe(302);
  const s = await call('PUT', '/meta/selection', { body: { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' }, token });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  await expect.poll(async () => (await call('GET', '/meta/summary', { token })).data?.sync?.state, { timeout: 90_000 }).toBe('ok');
}
async function criativoAprovado(ws: 'A' | 'B', i: number): Promise<string> {
  const off = await oferta(ws);
  const wsId = ws === 'A' ? 'qa_ws_alfa' : 'qa_ws_beta';
  const owner = ws === 'A' ? 'qa_user_dono_a' : 'qa_user_dono_b';
  const id = `qa0311c${ws}${i}${Date.now().toString(36)}`;
  await q(`insert into creatives (id, workspace_id, offer_id, name, language, state, approved_at, approved_by_id, ad_name, variation_code, created_by_id, updated_at)
           values ($1,$2,$3,$4,'en','APPROVED',now(),$5,$6,$7,$5,now())`, [id, wsId, off.id, `Hook ${i}`, owner, `QA_0311_${ws}${i}`, `HEADLINE-${String(i).padStart(2, '0')}`]);
  await q(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height) values ($1,$2,'RENDER_VIDEO',$3,'video/mp4',1000000,20,1080,1920)`, [`${id}f`, wsId, `ws/${wsId}/render_video/${id}.mp4`]);
  await q(`insert into renders (id, workspace_id, creative_id, status, settings, input, file_id, duration_sec) values ($1,$2,$3,'READY','{}'::jsonb,'{}'::jsonb,$4,20)`, [`${id}r`, wsId, id, `${id}f`]);
  await q(`update creatives set final_render_id = $2 where id = $1`, [id, `${id}r`]);
  return id;
}
/** `YYYY-MM-DDTHH:mm` no fuso da conta, deslocado `ms` de agora. */
function local(ms: number, tz = TZ): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(Date.now() + ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
const H = 3600_000, D = 24 * H;

const v1 = () => ({
  name: 'QA v1', isDefault: false,
  campaign: { destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 2000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null, specialAdCategories: [], namePattern: 'HookMill — {offer}' },
  adset: { pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US'], ageMin: 18, ageMax: 65, genders: 'ALL', advantageAudience: true, placements: 'AUTO', adsPerAdset: { min: 4, max: 8 }, namePattern: '{offer} — {date} — {n}' },
  ad: { primaryText: null, headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com/', urlTags: null, namePattern: '{code}' },
});
type Over = { name?: string; isDefault?: boolean; campaign?: Record<string, unknown>; adset?: Record<string, unknown>; ad?: Record<string, unknown> };
const tpl = (o: Over = {}) => {
  const b = v1();
  return { ...b, ...(o.name ? { name: o.name } : {}), ...(o.isDefault !== undefined ? { isDefault: o.isDefault } : {}), campaign: { ...b.campaign, ...o.campaign }, adset: { ...b.adset, ...o.adset }, ad: { ...b.ad, ...o.ad } };
};
const awareness = (o: Over = {}) => tpl({ ...o, campaign: { objective: 'OUTCOME_AWARENESS', ...o.campaign }, adset: { pixelId: null, pixelEvent: null, optimizationGoal: 'REACH', ...o.adset }, ad: { callToAction: 'LEARN_MORE', ...o.ad } });
const v2Cheio = (o: Over = {}) => awareness({
  name: 'QA v2 cheio', ...o,
  campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000, ...o.campaign },
  adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }, locales: [{ key: 6, name: 'English (US)' }, { key: 24, name: 'English (UK)' }],
    customAudiences: [{ id: 'ca_mock_lal_1', name: 'Lookalike (US, 1%) - Website buyers 180d' }], excludedCustomAudiences: [{ id: 'ca_mock_buyers', name: 'Website buyers 180d' }], ...o.adset },
  ad: { instagramAccount: { id: 'ig_mock_1', username: 'hookmill.demo' }, ...o.ad },
});
const post = (token: string, body: unknown) => call('POST', '/meta/templates', { body, token });
const fieldsOf = (r: { body: any }) => (r.body?.error?.details?.fields ?? []) as { field: string; rule: string }[];
async function spyReset() { await fetch(SPY + '/reset', { method: 'POST' }); }
async function spy(): Promise<{ campaigns: any[]; adsets: any[]; creatives: any[] }> { return (await fetch(SPY)).json(); }
async function assentar(ids: string[]) {
  await expect.poll(async () => (await q<{ n: number }>(`select count(*)::int n from meta_publications where creative_id = any($1) and status = 'PUBLISHING'`, [ids]))[0].n, { timeout: 120_000 }).toBe(0);
  return q(`select creative_id, status, campaign_id, adset_id, error_code, fail_reason, settings from meta_publications where creative_id = any($1) order by created_at`, [ids]);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await resetDb();
  await q(`update users set account_mode = 'OWN'`);
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  A = await tokenOf('donoA'); B = await tokenOf('donoB'); CLI = await tokenOf('clienteA'); MEM = await tokenOf('membroA');
  await conectarMeta(A);
  await conectarMeta(B);
  for (let i = 1; i <= 14; i++) creativesA.push(await criativoAprovado('A', i));
  creativeB = await criativoAprovado('B', 1);
});

test('1. GET /meta/connection traz minDailyBudgetMinor e o fuso; as 3 listas do §4', async () => {
  const c = await call('GET', '/meta/connection', { token: A });
  expect(c.status).toBe(200);
  TZ = c.data.adAccount.timezoneName;
  guarda('connection.adAccount', c.data.adAccount);
  expect(c.data.adAccount.minDailyBudgetMinor).toBe(500);

  const ig = await call('GET', '/meta/instagram-accounts', { token: A });
  guarda('instagram-accounts', ig.body);
  expect(ig.status).toBe(200);
  expect(ig.data.pageLookup).toBe('ok');
  expect(ig.data.accounts.map((a: any) => [a.id, a.username, a.source])).toEqual([['ig_mock_page', 'mock.page', 'PAGE'], ['ig_mock_1', 'hookmill.demo', 'AD_ACCOUNT']]);

  const ca = await call('GET', '/meta/custom-audiences', { token: A });
  guarda('custom-audiences', ca.body);
  expect(ca.status).toBe(200);
  expect(ca.data.truncated).toBe(false);
  expect(ca.data.audiences.map((a: any) => [a.id, a.usable])).toEqual([['ca_mock_buyers', true], ['ca_mock_lal_1', true], ['ca_mock_small', false], ['ca_mock_flagged', false]]);

  const lo = await call('GET', '/meta/locales', { token: A });
  guarda('locales', lo.body);
  expect(lo.status).toBe(200);
  expect(lo.data.locales).toHaveLength(8);
  expect(lo.data.locales).toEqual(expect.arrayContaining([{ key: 6, name: 'English (US)' }, { key: 24, name: 'English (UK)' }]));
  const nomes = lo.data.locales.map((l: any) => l.name);
  expect(nomes).toEqual([...nomes].sort((a: string, b: string) => a.localeCompare(b)));

  // papéis: MEMBER pode, CLIENT não
  for (const p of ['instagram-accounts', 'custom-audiences', 'locales']) {
    expect((await call('GET', `/meta/${p}`, { token: MEM })).status, `MEMBER ${p}`).toBe(200);
    const r = await call('GET', `/meta/${p}`, { token: CLI });
    expect(r.status, `CLIENT ${p}`).toBe(403);
  }
  // sem token
  expect((await call('GET', '/meta/locales')).status).toBe(401);
});

test('2. CRUD com os 6 campos novos (Awareness + Engagement, total, agendamento, idiomas, Instagram, públicos)', async () => {
  const cheio = v2Cheio();
  const r = await post(A, cheio);
  guarda('POST v2 cheio', r.body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.data.campaign).toMatchObject({ objective: 'OUTCOME_AWARENESS', budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, dailyBudgetMinor: 0, destination: 'NEW_CAMPAIGN' });
  expect(r.data.adset).toMatchObject({ optimizationGoal: 'REACH', pixelId: null, schedule: cheio.adset.schedule, locales: cheio.adset.locales, customAudiences: cheio.adset.customAudiences, excludedCustomAudiences: cheio.adset.excludedCustomAudiences });
  expect(r.data.ad.instagramAccount).toEqual({ id: 'ig_mock_1', username: 'hookmill.demo' });
  const got = (await call('GET', '/meta/templates', { token: A })).data.find((t: any) => t.id === r.data.id);
  expect(got.adset.schedule).toEqual(cheio.adset.schedule);

  // Engagement: THRUPLAY, POST_ENGAGEMENT; null = padrão; agendamento com início futuro e fim AT
  for (const goal of ['THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', 'POST_ENGAGEMENT', null]) {
    const e = await post(A, tpl({ name: `QA eng ${goal}`, campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { pixelId: null, pixelEvent: null, optimizationGoal: goal, schedule: { start: local(2 * D), end: { kind: 'AT', at: local(5 * D) } } }, ad: { callToAction: 'LEARN_MORE' } }));
    expect(e.status, `${goal} ${JSON.stringify(e.body)}`).toBe(201);
  }
  // PATCH: Awareness → ABO + LIFETIME + REUSE (pode: cada conjunto tem o seu total)
  const p = await call('PATCH', `/meta/templates/${r.data.id}`, { token: A, body: { campaign: { ...r.data.campaign, budgetMode: 'ABO', destination: 'REUSE_CAMPAIGN' } } });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  expect(p.data.campaign).toMatchObject({ budgetMode: 'ABO', destination: 'REUSE_CAMPAIGN', budgetType: 'LIFETIME' });
  // template v1 continua salvando e lendo sem campos novos (present não preenche)
  const old = await post(A, tpl({ name: 'QA v1 puro' }));
  expect(old.status).toBe(201);
  for (const k of ['budgetType', 'lifetimeBudgetMinor']) expect(old.data.campaign).not.toHaveProperty(k);
  for (const k of ['schedule', 'locales', 'customAudiences', 'excludedCustomAudiences', 'optimizationGoal']) expect(old.data.adset).not.toHaveProperty(k);
  expect(old.data.ad).not.toHaveProperty('instagramAccount');
  // arquiva tudo pra não poluir as próximas
  for (const t of (await call('GET', '/meta/templates', { token: A })).data) await call('DELETE', `/meta/templates/${t.id}`, { token: A });
});

test('3. validações do §3 (400 field/rule) e 422 de mínimo', async () => {
  const casos: [string, unknown, string, string][] = [
    ['objetivo fora dos 6', tpl({ campaign: { objective: 'OUTCOME_FOO' } }), 'campaign.objective', 'isIn'],
    ['budgetType inválido', tpl({ campaign: { budgetType: 'WEEKLY' } }), 'campaign.budgetType', 'isIn'],
    ['DAILY diário 0', tpl({ campaign: { budgetType: 'DAILY', dailyBudgetMinor: 0 } }), 'campaign.dailyBudgetMinor', 'isInt'],
    ['LIFETIME diário ≠ 0', tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 100, lifetimeBudgetMinor: 30000 }, adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } }), 'campaign.dailyBudgetMinor', 'zeroForLifetime'],
    ['LIFETIME total 0', tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 0 }, adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } }), 'campaign.lifetimeBudgetMinor', 'isInt'],
    ['LIFETIME total decimal', tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 100.5 }, adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } }), 'campaign.lifetimeBudgetMinor', 'isInt'],
    ['DAILY com total', tpl({ campaign: { budgetType: 'DAILY', lifetimeBudgetMinor: 5000 } }), 'campaign.lifetimeBudgetMinor', 'notAllowed'],
    ['CBO + LIFETIME + REUSE', tpl({ campaign: { destination: 'REUSE_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } }), 'campaign.destination', 'lifetimeCboNeedsNewCampaign'],
    ['meta fora da tabela (Awareness + POST_ENGAGEMENT)', awareness({ adset: { optimizationGoal: 'POST_ENGAGEMENT' } }), 'adset.optimizationGoal', 'isIn'],
    ['meta desconhecida', awareness({ adset: { optimizationGoal: 'LINK_CLICKS' } }), 'adset.optimizationGoal', 'isIn'],
    ['meta com Sales', tpl({ adset: { optimizationGoal: 'REACH' } }), 'adset.optimizationGoal', 'notForObjective'],
    ['pixel em Awareness', awareness({ adset: { pixelId: 'pix_mock', pixelEvent: null } }), 'adset.pixelId', 'notForObjective'],
    ['só evento em Engagement', tpl({ campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { pixelId: null, pixelEvent: 'PURCHASE' } }), 'adset.pixelId', 'notForObjective'],
    ['início formato', awareness({ adset: { schedule: { start: '2026-13-01T10:00', end: null } } }), 'adset.schedule.start', 'isLocalDateTime'],
    ['início com offset', awareness({ adset: { schedule: { start: '2026-12-01T10:00:00Z', end: null } } }), 'adset.schedule.start', 'isLocalDateTime'],
    ['início no passado', awareness({ adset: { schedule: { start: local(-D), end: null } } }), 'adset.schedule.start', 'inPast'],
    ['fim AT no passado', awareness({ adset: { schedule: { start: null, end: { kind: 'AT', at: local(-2 * H) } } } }), 'adset.schedule.end', 'inPast'],
    ['fim AT < 24 h (início null)', awareness({ adset: { schedule: { start: null, end: { kind: 'AT', at: local(20 * H) } } } }), 'adset.schedule.end', 'minDuration24h'],
    ['fim ≤ início', awareness({ adset: { schedule: { start: local(3 * D), end: { kind: 'AT', at: local(2 * D) } } } }), 'adset.schedule.end', 'minDuration24h'],
    ['AFTER_DAYS 0', awareness({ adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 0 } } } }), 'adset.schedule.end', 'isInt'],
    ['AFTER_DAYS 366', awareness({ adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 366 } } } }), 'adset.schedule.end', 'isInt'],
    ['LIFETIME sem fim', tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { schedule: null } }), 'adset.schedule.end', 'requiredForLifetime'],
    ['LIFETIME só início', tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { schedule: { start: local(D), end: null } } }), 'adset.schedule.end', 'requiredForLifetime'],
    ['idiomas > 50', awareness({ adset: { locales: Array.from({ length: 51 }, (_, i) => ({ key: i + 1, name: `L${i}` })) } }), 'adset.locales', 'isLocaleList'],
    ['idioma repetido', awareness({ adset: { locales: [{ key: 6, name: 'a' }, { key: 6, name: 'b' }] } }), 'adset.locales', 'isLocaleList'],
    ['idioma chave 0', awareness({ adset: { locales: [{ key: 0, name: 'a' }] } }), 'adset.locales', 'isLocaleList'],
    ['públicos > 20', awareness({ adset: { customAudiences: Array.from({ length: 21 }, (_, i) => ({ id: `ca_${i}`, name: 'x' })) } }), 'adset.customAudiences', 'isAudienceList'],
    ['público repetido', awareness({ adset: { excludedCustomAudiences: [{ id: 'ca_mock_buyers', name: 'a' }, { id: 'ca_mock_buyers', name: 'a' }] } }), 'adset.excludedCustomAudiences', 'isAudienceList'],
    ['incluir e excluir o mesmo', awareness({ adset: { customAudiences: [{ id: 'ca_mock_buyers', name: 'a' }], excludedCustomAudiences: [{ id: 'ca_mock_buyers', name: 'a' }] } }), 'adset.excludedCustomAudiences', 'includedAndExcluded'],
    ['Instagram sem id', awareness({ ad: { instagramAccount: { id: '', username: 'x' } } }), 'ad.instagramAccount', 'isInstagramAccount'],
    ['Instagram com chave extra', awareness({ ad: { instagramAccount: { id: 'ig_mock_1', username: 'x', pic: 'y' } } }), 'ad.instagramAccount', 'isInstagramAccount'],
    ['Instagram que sumiu (ig_mock_gone)', awareness({ ad: { instagramAccount: { id: 'ig_mock_gone', username: 'gone' } } }), 'ad.instagramAccount', 'notAvailable'],
    ['público incluído que sumiu (ca_mock_gone)', awareness({ adset: { customAudiences: [{ id: 'ca_mock_gone', name: 'gone' }] } }), 'adset.customAudiences', 'notAvailable'],
    ['público excluído que sumiu (ca_mock_gone)', awareness({ adset: { excludedCustomAudiences: [{ id: 'ca_mock_gone', name: 'gone' }] } }), 'adset.excludedCustomAudiences', 'notAvailable'],
  ];
  const tabela: unknown[] = [];
  for (const [nome, body, field, rule] of casos) {
    const r = await post(A, body);
    tabela.push({ nome, status: r.status, code: r.body?.error?.code, fields: fieldsOf(r) });
    expect.soft(r.status, `${nome}: ${JSON.stringify(r.body)}`).toBe(400);
    expect.soft(fieldsOf(r), nome).toContainEqual({ field, rule });
  }
  guarda('validacoes', tabela);

  // 422 do mínimo
  const d = await post(A, tpl({ campaign: { dailyBudgetMinor: 100 } }));
  expect(d.status).toBe(422);
  expect(d.body.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500, currency: 'USD' } });
  expect(d.body.error.details).not.toHaveProperty('budgetType');
  const life = (lifetime: number, schedule: unknown) => tpl({ campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: lifetime }, adset: { schedule } });
  const l7 = await post(A, life(3499, { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }));
  guarda('422 LIFETIME 7 dias', l7.body);
  expect(l7.status).toBe(422);
  expect(l7.body.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 3500, currency: 'USD', budgetType: 'LIFETIME', days: 7 } });
  expect((await post(A, life(3500, { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }))).status).toBe(201);
  // AT → AT: 3 dias e 1 h = teto 4 dias
  const at = await post(A, life(1999, { start: local(D), end: { kind: 'AT', at: local(4 * D + H) } }));
  expect(at.status).toBe(422);
  expect(at.body.error.details).toMatchObject({ minimumMinor: 2000, budgetType: 'LIFETIME', days: 4 });
  // início null + AT contra agora (~2,5 dias = 3)
  const nAt = await post(A, life(1000, { start: null, end: { kind: 'AT', at: local(2.5 * D) } }));
  expect(nAt.status).toBe(422);
  expect(nAt.body.error.details).toMatchObject({ minimumMinor: 1500, days: 3 });
  // ordem: 400 antes do 422 (pixel em Awareness + orçamento baixo = 400)
  expect((await post(A, awareness({ campaign: { dailyBudgetMinor: 100 }, adset: { pixelId: 'pix_mock' } }))).status).toBe(400);
  // pixel obrigatório (v1) continua 422
  const px = await post(A, tpl({ adset: { pixelId: null, pixelEvent: null } }));
  expect(px.body?.error?.code).toBe('META_PIXEL_REQUIRED');
  // ABO + LIFETIME + REUSE pode
  const abo = await post(A, tpl({ name: 'QA ABO total REUSE', campaign: { budgetMode: 'ABO', destination: 'REUSE_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } }));
  expect(abo.status, JSON.stringify(abo.body)).toBe(201);

  // Custom (POST /creatives/:id/meta/publish sem templateId) não aceita os objetivos novos (P4)
  const custom = await call('POST', `/creatives/${creativesA[13]}/meta/publish`, { token: A, body: { objective: 'OUTCOME_AWARENESS', dailyBudgetMinor: 2000, countries: ['US'], primaryText: 'x', callToAction: 'LEARN_MORE', link: 'https://example.com/' } });
  guarda('Custom com Awareness', { status: custom.status, body: custom.body });
  expect(custom.status).toBe(400);
  expect(JSON.stringify(custom.body)).toContain('objective');
  for (const t of (await call('GET', '/meta/templates', { token: A })).data) await call('DELETE', `/meta/templates/${t.id}`, { token: A });
});

test('4. PATCH: regras no corpo mesclado, relógio/notAvailable só nas seções enviadas, troca de tipo de orçamento esquece a campanha', async () => {
  const t = (await post(A, tpl({ name: 'QA patch' }))).data;
  // trocar só a campanha pra LIFETIME com o conjunto salvo sem fim → requiredForLifetime (cruzada roda no merge)
  const p1 = await call('PATCH', `/meta/templates/${t.id}`, { token: A, body: { campaign: { ...t.campaign, destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 } } });
  expect(p1.status).toBe(400);
  expect(fieldsOf(p1)).toContainEqual({ field: 'adset.schedule.end', rule: 'requiredForLifetime' });
  // trocar só o objetivo pra Awareness com o pixel salvo → notForObjective
  const p2 = await call('PATCH', `/meta/templates/${t.id}`, { token: A, body: { campaign: { ...t.campaign, objective: 'OUTCOME_AWARENESS' } } });
  expect(fieldsOf(p2)).toContainEqual({ field: 'adset.pixelId', rule: 'notForObjective' });
  // seção enviada com ig_mock_gone → notAvailable
  const p3 = await call('PATCH', `/meta/templates/${t.id}`, { token: A, body: { ad: { ...t.ad, instagramAccount: { id: 'ig_mock_gone', username: 'g' } } } });
  expect(fieldsOf(p3)).toContainEqual({ field: 'ad.instagramAccount', rule: 'notAvailable' });
  // gravado direto no banco: ig sumido + fim AT no passado; PATCH só do nome passa (pendência conhecida: seções não enviadas não são rechecadas)
  await q(`update meta_publish_templates set ad = ad || '{"instagramAccount":{"id":"ig_mock_gone","username":"g"}}'::jsonb, adset = adset || $2::jsonb where id = $1`,
    [t.id, JSON.stringify({ schedule: { start: null, end: { kind: 'AT', at: local(-D) } } })]);
  const p4 = await call('PATCH', `/meta/templates/${t.id}`, { token: A, body: { name: 'QA patch renomeado' } });
  guarda('PATCH só nome com ig sumido + fim vencido', { status: p4.status, body: p4.body?.error ?? 'ok' });
  expect(p4.status).toBe(200);
  // ... e a campanha também: mudar o orçamento diário não rechecou o fim vencido do conjunto
  const p5 = await call('PATCH', `/meta/templates/${t.id}`, { token: A, body: { campaign: { ...t.campaign, dailyBudgetMinor: 2500 } } });
  guarda('PATCH só campanha com fim vencido salvo', { status: p5.status, body: p5.body?.error ?? 'ok' });
  expect(p5.status).toBe(200);
  // publicar barra (o gate do envio pega)
  const pub = await call('POST', `/creatives/${creativesA[13]}/meta/publish`, { token: A, body: { templateId: t.id } });
  guarda('publicar template vencido', pub.body);
  expect(pub.status).toBe(400);
  expect(pub.body.error.details.templateId).toBe(t.id);
  // reuseCampaignId é esquecido quando troca DAILY ↔ LIFETIME
  const t2 = (await post(A, tpl({ name: 'QA reuse', campaign: { budgetMode: 'ABO' } }))).data;
  await q(`update meta_publish_templates set reuse_campaign_id = 'mock_campaign_x' where id = $1`, [t2.id]);
  const keep = await call('PATCH', `/meta/templates/${t2.id}`, { token: A, body: { campaign: { ...t2.campaign, dailyBudgetMinor: 3000 } } });
  expect(keep.data.reuseCampaignId).toBe('mock_campaign_x');
  const sw = await call('PATCH', `/meta/templates/${t2.id}`, { token: A, body: { campaign: { ...t2.campaign, budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { ...t2.adset, schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } } } });
  expect(sw.status, JSON.stringify(sw.body)).toBe(200);
  expect(sw.data.reuseCampaignId).toBeNull();
  for (const x of (await call('GET', '/meta/templates', { token: A })).data) await call('DELETE', `/meta/templates/${x.id}`, { token: A });
});

test('5. importação (§7): mock_cmp_awareness, mock_cmp_life, mock_adset_cbo_1; lista de campanhas', async () => {
  const aw = await call('POST', '/meta/templates/import', { token: A, body: { level: 'campaign', id: 'mock_cmp_awareness' } });
  guarda('import mock_cmp_awareness', aw.body);
  expect(aw.status, JSON.stringify(aw.body)).toBe(200);
  const awT = aw.data.template;
  expect(awT.campaign).toMatchObject({ objective: 'OUTCOME_AWARENESS', budgetMode: 'CBO', dailyBudgetMinor: 3000 });
  expect(awT.adset).toMatchObject({ optimizationGoal: 'REACH', pixelId: null, pixelEvent: null });
  expect(awT.ad.instagramAccount).toEqual({ id: 'ig_mock_1', username: 'hookmill.demo' });
  expect(awT.ad.callToAction).toBe('LEARN_MORE');
  const awSave = await post(A, { ...awT, name: 'QA importado awareness' });
  guarda('salvar import awareness', { status: awSave.status, err: awSave.body?.error });
  expect(awSave.status, JSON.stringify(awSave.body)).toBe(201);

  const life = await call('POST', '/meta/templates/import', { token: A, body: { level: 'campaign', id: 'mock_cmp_life' } });
  guarda('import mock_cmp_life', life.body);
  expect(life.status).toBe(200);
  const lt = life.data.template;
  expect(lt.campaign).toMatchObject({ objective: 'OUTCOME_TRAFFIC', budgetMode: 'CBO', budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, dailyBudgetMinor: 0, destination: 'NEW_CAMPAIGN' });
  expect(lt.adset.schedule).toEqual({ start: null, end: { kind: 'AFTER_DAYS', days: 30 } });
  expect(JSON.stringify(life.data.adjusted ?? [])).toMatch(/schedule/i);
  const ltSave = await post(A, { ...lt, name: 'QA importado life' });
  guarda('salvar import life', { status: ltSave.status, err: ltSave.body?.error });
  expect(ltSave.status, JSON.stringify(ltSave.body)).toBe(201);

  const cbo1 = await call('POST', '/meta/templates/import', { token: A, body: { level: 'adset', id: 'mock_adset_cbo_1' } });
  guarda('import mock_adset_cbo_1', cbo1.body);
  expect(cbo1.status).toBe(200);
  const ct = cbo1.data.template;
  expect(ct.adset.locales).toEqual([{ key: 6, name: 'English (US)' }]);
  expect(ct.adset.customAudiences).toEqual([{ id: 'ca_mock_lal_1', name: 'Lookalike (US, 1%) - Website buyers 180d' }]);
  expect(ct.adset.excludedCustomAudiences).toEqual([{ id: 'ca_mock_buyers', name: 'Website buyers 180d' }]);
  expect(ct.adset.schedule).toEqual({ start: null, end: { kind: 'AFTER_DAYS', days: 7 } });
  const uns = JSON.stringify(cbo1.data.unsupported);
  expect(uns).toMatch(/flexible_spec/);
  expect(uns).toMatch(/cities|geo/);
  for (const sai of ['lifetimeBudget', 'adset.schedule', 'custom_audiences', 'locales']) expect(uns, `não devia estar em unsupported: ${sai}`).not.toContain(sai);

  // 404 no objeto que não existe; outro workspace (B) importa a mesma campanha fixa do mock (é da conta mock, não do workspace)
  const gone = await call('POST', '/meta/templates/import', { token: A, body: { level: 'campaign', id: 'mock_cmp_nao_existe' } });
  expect(gone.status).toBe(404);
  // lista de campanhas que o seletor de importação usa: a de Awareness aparece?
  const camps = await call('GET', '/meta/campaigns', { token: A });
  const ids = JSON.stringify(camps.body);
  guarda('GET /meta/campaigns (seletor do import)', { status: camps.status, temAwareness: ids.includes('mock_cmp_awareness'), temLife: ids.includes('mock_cmp_life') });
  // pendência conhecida (MOCK_IMPORT_ONLY): registrada na evidência, não bloqueia o resto da série
  test.info().annotations.push({ type: 'seletor do import tem mock_cmp_awareness', description: String(ids.includes('mock_cmp_awareness')) });
  for (const x of (await call('GET', '/meta/templates', { token: A })).data) await call('DELETE', `/meta/templates/${x.id}`, { token: A });
});

test('6. publicar: v2 LIFETIME + AFTER_DAYS no lote (corpo da porta), Awareness/Engagement, ABO total, v1 igual a antes', async () => {
  test.setTimeout(600_000);
  // a) CBO + LIFETIME + AFTER_DAYS + idiomas + públicos + Instagram, lote de 3
  const t = (await post(A, v2Cheio({ name: 'QA lote v2', isDefault: true }))).data;
  await spyReset();
  const before = Date.now();
  const lote = await call('POST', '/meta/publish-batch', { token: A, body: { creativeIds: creativesA.slice(0, 3), templateId: t.id } });
  expect(lote.status, JSON.stringify(lote.body)).toBe(202);
  const pubs = await assentar(creativesA.slice(0, 3));
  const sent = await spy();
  guarda('lote v2 (pubs)', pubs);
  guarda('lote v2 (corpos Graph)', sent);
  expect(pubs.every((p: any) => p.status === 'PAUSED'), JSON.stringify(pubs)).toBe(true);
  const s0 = pubs[0].settings;
  expect(s0).toMatchObject({ budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, startTime: null, optimizationGoal: 'REACH', locales: [6, 24], customAudienceIds: ['ca_mock_lal_1'], excludedCustomAudienceIds: ['ca_mock_buyers'], instagramUserId: 'ig_mock_1' });
  expect(Math.abs(Date.parse(s0.endTime) - (before + 7 * D))).toBeLessThan(5 * 60_000);
  expect(new Set(pubs.map((p: any) => p.settings.endTime)).size, 'mesmo endTime no lote').toBe(1);
  expect(sent.campaigns).toHaveLength(1);
  expect(sent.campaigns[0]).toMatchObject({ objective: 'OUTCOME_AWARENESS', lifetime_budget: 30000, status: 'PAUSED' });
  expect(sent.campaigns[0]).not.toHaveProperty('daily_budget');
  expect(sent.adsets).toHaveLength(1);
  const as0 = sent.adsets[0];
  expect(as0).toMatchObject({ optimization_goal: 'REACH', billing_event: 'IMPRESSIONS', end_time: expect.any(String) });
  expect(as0).not.toHaveProperty('start_time');
  expect(as0).not.toHaveProperty('lifetime_budget');
  expect(as0).not.toHaveProperty('destination_type');
  expect(JSON.stringify(as0.promoted_object)).toContain('page_mock');
  const tg = typeof as0.targeting === 'string' ? JSON.parse(as0.targeting) : as0.targeting;
  expect(tg).toMatchObject({ locales: [6, 24], custom_audiences: [{ id: 'ca_mock_lal_1' }], excluded_custom_audiences: [{ id: 'ca_mock_buyers' }] });
  expect(sent.creatives).toHaveLength(3);
  for (const c of sent.creatives) {
    const oss = typeof c.object_story_spec === 'string' ? JSON.parse(c.object_story_spec) : c.object_story_spec;
    expect(oss.instagram_user_id).toBe('ig_mock_1');
    expect(oss).not.toHaveProperty('instagram_actor_id');
    expect(JSON.stringify(oss)).toContain('LEARN_MORE');
  }

  // b) ABO + LIFETIME + início futuro + fim AT, Engagement ON_VIDEO
  const startL = local(2 * D), endL = local(6 * D);
  const tb = (await post(A, tpl({ name: 'QA ABO eng', campaign: { objective: 'OUTCOME_ENGAGEMENT', budgetMode: 'ABO', destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 }, adset: { pixelId: null, pixelEvent: null, optimizationGoal: null, schedule: { start: startL, end: { kind: 'AT', at: endL } } }, ad: { callToAction: 'LEARN_MORE' } })));
  expect(tb.status, JSON.stringify(tb.body)).toBe(201);
  await spyReset();
  const pb = await call('POST', `/creatives/${creativesA[3]}/meta/publish`, { token: A, body: { templateId: tb.data.id } });
  expect(pb.status, JSON.stringify(pb.body)).toBe(202);
  const [rb] = await assentar([creativesA[3]]);
  const sb = await spy();
  guarda('ABO eng (pub + corpos)', { rb, sb });
  expect(rb.status).toBe('PAUSED');
  expect(sb.campaigns[0]).not.toHaveProperty('lifetime_budget');
  expect(sb.campaigns[0]).not.toHaveProperty('daily_budget');
  expect(sb.adsets[0]).toMatchObject({ lifetime_budget: 30000, optimization_goal: 'THRUPLAY', destination_type: 'ON_VIDEO', billing_event: 'IMPRESSIONS', start_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/), end_time: expect.any(String) });
  expect(sb.adsets[0]).not.toHaveProperty('promoted_object');
  expect(Date.parse(sb.adsets[0].end_time) - Date.parse(sb.adsets[0].start_time)).toBe(4 * D);

  // c) Engagement POST_ENGAGEMENT → ON_POST (DAILY, sem agendamento)
  const tc = await post(A, tpl({ name: 'QA eng post', campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { pixelId: null, pixelEvent: null, optimizationGoal: 'POST_ENGAGEMENT' }, ad: { callToAction: 'LEARN_MORE' } }));
  await spyReset();
  expect((await call('POST', `/creatives/${creativesA[4]}/meta/publish`, { token: A, body: { templateId: tc.data.id } })).status).toBe(202);
  await assentar([creativesA[4]]);
  const sc = await spy();
  expect(sc.adsets[0]).toMatchObject({ optimization_goal: 'POST_ENGAGEMENT', destination_type: 'ON_POST' });
  expect(sc.adsets[0]).not.toHaveProperty('end_time');

  // d) template v1 publica igual a antes
  const tv1 = await post(A, tpl({ name: 'QA v1 pub' }));
  await spyReset();
  expect((await call('POST', `/creatives/${creativesA[5]}/meta/publish`, { token: A, body: { templateId: tv1.data.id } })).status).toBe(202);
  const [rv1] = await assentar([creativesA[5]]);
  const sv1 = await spy();
  guarda('v1 (pub + corpos)', { rv1, sv1 });
  expect(rv1.status).toBe('PAUSED');
  for (const k of ['budgetType', 'lifetimeBudgetMinor', 'startTime', 'endTime', 'optimizationGoal', 'locales', 'customAudienceIds', 'excludedCustomAudienceIds', 'instagramUserId']) expect(rv1.settings, `settings v1 sem ${k}`).not.toHaveProperty(k);
  expect(sv1.campaigns[0]).toMatchObject({ objective: 'OUTCOME_SALES', daily_budget: 2000 });
  expect(sv1.campaigns[0]).not.toHaveProperty('lifetime_budget');
  expect(sv1.adsets[0]).toMatchObject({ optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'pix_mock', custom_event_type: 'PURCHASE' } });
  for (const k of ['start_time', 'end_time', 'destination_type', 'lifetime_budget']) expect(sv1.adsets[0]).not.toHaveProperty(k);
  const tgv1 = typeof sv1.adsets[0].targeting === 'string' ? JSON.parse(sv1.adsets[0].targeting) : sv1.adsets[0].targeting;
  for (const k of ['locales', 'custom_audiences', 'excluded_custom_audiences']) expect(tgv1).not.toHaveProperty(k);
  const ossv1 = typeof sv1.creatives[0].object_story_spec === 'string' ? JSON.parse(sv1.creatives[0].object_story_spec) : sv1.creatives[0].object_story_spec;
  expect(ossv1).not.toHaveProperty('instagram_user_id');

  // e) gate do envio: ig/público que sumiu, fim < 24 h, fim no passado, total abaixo do mínimo, beta do destination
  const te = (await post(A, v2Cheio({ name: 'QA gate' }))).data;
  const gate: Record<string, unknown> = {};
  const pubE = (i: number) => call('POST', `/creatives/${creativesA[i]}/meta/publish`, { token: A, body: { templateId: te.id } });
  const setJ = (col: 'ad' | 'adset' | 'campaign', patch: unknown) => q(`update meta_publish_templates set ${col} = ${col} || $2::jsonb where id = $1`, [te.id, JSON.stringify(patch)]);
  await setJ('ad', { instagramAccount: { id: 'ig_mock_gone', username: 'g' } });
  let r = await pubE(6); gate.igGone = r.body;
  expect(r.status).toBe(400);
  expect(r.body.error.details).toMatchObject({ fields: [{ field: 'ad.instagramAccount', rule: 'notAvailable' }], templateId: te.id });
  await setJ('ad', { instagramAccount: null });
  await setJ('adset', { customAudiences: [{ id: 'ca_mock_gone', name: 'g' }] });
  r = await pubE(6); gate.caGone = r.body;
  expect(r.status).toBe(400);
  expect(r.body.error.details.fields).toContainEqual({ field: 'adset.customAudiences', rule: 'notAvailable' });
  await setJ('adset', { customAudiences: [], schedule: { start: null, end: { kind: 'AT', at: local(3 * H) } } });
  r = await pubE(6); gate.min24 = r.body;
  expect(r.status).toBe(400);
  expect(r.body.error.details).toMatchObject({ fields: [{ field: 'adset.schedule.end', rule: 'minDuration24h' }], templateId: te.id });
  await setJ('adset', { schedule: { start: null, end: { kind: 'AT', at: local(-3 * H) } } });
  r = await pubE(6); gate.inPast = r.body;
  expect(r.body.error.details).toMatchObject({ fields: [{ field: 'adset.schedule.end', rule: 'inPast' }], templateId: te.id });
  // início salvo que já passou vira "agora" no envio (sem start_time)
  await setJ('adset', { schedule: { start: local(-2 * D), end: { kind: 'AFTER_DAYS', days: 7 } } });
  await spyReset();
  r = await pubE(6); gate.startPassado = { status: r.status, settings: r.data?.settings };
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  await assentar([creativesA[6]]);
  expect((await spy()).adsets[0]).not.toHaveProperty('start_time');
  await setJ('campaign', { lifetimeBudgetMinor: 1000 });
  await setJ('adset', { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } } });
  r = await pubE(7); gate.totalBaixo = r.body;
  expect(r.status).toBe(422);
  expect(r.body.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 3500, budgetType: 'LIFETIME', days: 7 } });
  // lote com o mesmo gate (publish-batch) também barra
  r = await call('POST', '/meta/publish-batch', { token: A, body: { creativeIds: creativesA.slice(7, 9), templateId: te.id } }); gate.loteTotalBaixo = r.body;
  expect(r.status).toBe(422);
  // [mock:meta-destination] → falha da Meta com a mensagem dela
  const td = (await post(A, tpl({ name: 'QA beta destination', campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { pixelId: null, pixelEvent: null, optimizationGoal: 'THRUPLAY' }, ad: { callToAction: 'LEARN_MORE', primaryText: 'Test [mock:meta-destination]' } }))).data;
  expect((await call('POST', `/creatives/${creativesA[9]}/meta/publish`, { token: A, body: { templateId: td.id } })).status).toBe(202);
  const [rd] = await assentar([creativesA[9]]);
  gate.destination = rd;
  guarda('gate do envio', gate);
  expect(rd.status).toBe('FAILED');
  expect(String(`${rd.error_code} ${rd.fail_reason}`)).toMatch(/destination_type|META_ERROR/);
});

test('7. permissões: CLIENT e outro workspace', async () => {
  const t = (await post(A, tpl({ name: 'QA do A' }))).data;
  // CLIENT: lê (editor só leitura), não cria/edita/arquiva/importa/publica
  const lst = await call('GET', '/meta/templates', { token: CLI });
  const perm: Record<string, number> = { 'CLIENT GET': lst.status };
  perm['CLIENT POST'] = (await post(CLI, tpl({ name: 'x' }))).status;
  perm['CLIENT PATCH'] = (await call('PATCH', `/meta/templates/${t.id}`, { token: CLI, body: { name: 'x' } })).status;
  perm['CLIENT DELETE'] = (await call('DELETE', `/meta/templates/${t.id}`, { token: CLI })).status;
  perm['CLIENT import'] = (await call('POST', '/meta/templates/import', { token: CLI, body: { level: 'campaign', id: 'mock_cmp_awareness' } })).status;
  perm['CLIENT publish'] = (await call('POST', `/creatives/${creativesA[10]}/meta/publish`, { token: CLI, body: { templateId: t.id } })).status;
  perm['CLIENT publish-batch'] = (await call('POST', '/meta/publish-batch', { token: CLI, body: { creativeIds: [creativesA[10]], templateId: t.id } })).status;
  // MEMBER pode criar
  perm['MEMBER POST'] = (await post(MEM, tpl({ name: 'QA membro' }))).status;
  // outro workspace (B)
  const listB = await call('GET', '/meta/templates', { token: B });
  perm['B lista contém o do A'] = JSON.stringify(listB.body).includes(t.id) ? 1 : 0;
  perm['B PATCH do A'] = (await call('PATCH', `/meta/templates/${t.id}`, { token: B, body: { name: 'hack' } })).status;
  perm['B DELETE do A'] = (await call('DELETE', `/meta/templates/${t.id}`, { token: B })).status;
  perm['B publica criativo B com template do A'] = (await call('POST', `/creatives/${creativeB}/meta/publish`, { token: B, body: { templateId: t.id } })).status;
  perm['B publish-batch criativo A'] = (await call('POST', '/meta/publish-batch', { token: B, body: { creativeIds: [creativesA[11]], templateId: t.id } })).status;
  perm['A publica criativo do B'] = (await call('POST', `/creatives/${creativeB}/meta/publish`, { token: A, body: { templateId: t.id } })).status;
  guarda('permissoes', perm);
  expect(perm['CLIENT GET']).toBe(200);
  for (const k of ['CLIENT POST', 'CLIENT PATCH', 'CLIENT DELETE', 'CLIENT import', 'CLIENT publish', 'CLIENT publish-batch']) expect.soft(perm[k], k).toBe(403);
  expect(perm['MEMBER POST']).toBe(201);
  expect(perm['B lista contém o do A']).toBe(0);
  for (const k of ['B PATCH do A', 'B DELETE do A', 'B publica criativo B com template do A', 'A publica criativo do B']) expect.soft(perm[k], k).toBe(404);
  expect.soft([404, 409]).toContain(perm['B publish-batch criativo A']);
  // template do A continua intacto
  const still = (await call('GET', '/meta/templates', { token: A })).data.find((x: any) => x.id === t.id);
  expect(still?.name).toBe('QA do A');
  // nenhuma publicação no B com o template do A
  expect((await q(`select count(*)::int n from meta_publications where workspace_id = 'qa_ws_beta'`))[0].n).toBe(0);
});
