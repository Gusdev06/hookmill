import { createHmac } from 'node:crypto';
import type { MetaPublishIds, MetaPublishInput } from '../contrato';
import { GraphClient, nextLimit, parseUsageHeaders } from './cliente';
import { MetaError, mapGraphError, scrubToken } from './erros';
import { LiveMetaService } from './live.service';
import { HOOK_FIELD, INSIGHT_FIELDS, INSIGHT_FIELDS_CORE, invalidFieldOf, mapInsight, resultActionTypes } from './leitura';
import { adSetBody, campaignBody, creativeBody } from './publicacao';
import { DEFAULT_RULE } from './vencedor';

type Call = { url: URL; method: string; body: unknown; headers: Record<string, string> };
type Reply = Response | Record<string, unknown> | ((c: Call) => Response | Record<string, unknown> | Promise<Response | Record<string, unknown>>);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const gerr = (status: number, error: Record<string, unknown>, headers?: Record<string, string>) => json(status, { error }, headers);

/** fetch falso roteado por "METHOD /path" (sem versão); registra chamadas; corpo multipart vira FormData. */
function graphFake(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const f = (async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? { blob: v.size } : v]));
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    const c = { url, method, body, headers };
    calls.push(c);
    const key = `${method} ${url.pathname.replace(/^\/v\d+\.\d+/, '')}`;
    const r = routes[key] ?? routes[`${method} *`];
    if (r === undefined) return json(404, { error: { message: `no route ${key}`, code: 803 } });
    const one = Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0]) : r;
    const out = typeof one === 'function' ? await one(c) : one;
    return out instanceof Response ? out : json(200, out);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const CFG = { appId: '1234567890', appSecret: 'shh', configId: 'cfg1', redirectUri: 'https://api.test/api/v1/meta/callback', jwtSecret: 'jwt', rule: DEFAULT_RULE, sleep: async () => undefined };
const NOW = new Date('2026-10-21T12:00:00.000Z');
const live = (routes: Record<string, Reply | Reply[]>, extra: Partial<ConstructorParameters<typeof LiveMetaService>[0]> = {}) => {
  // campanhas-v1: o sync lista campanhas e conjuntos antes dos anúncios; teste que não liga pra eles recebe listas vazias
  const fake = graphFake({ 'GET /act_1/campaigns': { data: [] }, 'GET /act_1/adsets': { data: [] }, ...routes });
  return { svc: new LiveMetaService({ ...CFG, fetchImpl: fake.f, now: () => NOW, ...extra }), calls: fake.calls };
};
const TOKEN = 'EAAlongtoken1234567890abcdefghij';
const auth = { accessToken: TOKEN };
const proof = createHmac('sha256', CFG.appSecret).update(TOKEN).digest('hex');
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e) => (e instanceof MetaError ? e.code : `other:${e}`));

describe('GraphClient', () => {
  it('token no header Authorization: Bearer (nunca na URL) + appsecret_proof na query de toda chamada com token; versão da env', async () => {
    const { f, calls } = graphFake({ 'GET /me': { id: '1' }, 'POST /act_1/campaigns': { id: 'c1' }, 'DELETE /me/permissions': { success: true } });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', version: 'v26.0', fetchImpl: f });
    await g.get('me', { fields: 'id' }, TOKEN);
    expect(calls[0].url.pathname).toBe('/v26.0/me');
    expect(calls[0].url.searchParams.get('access_token')).toBeNull();
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url.searchParams.get('appsecret_proof')).toBe(proof);
    expect(calls[0].url.searchParams.get('fields')).toBe('id');
    await g.post('act_1/campaigns', { name: 'x' }, TOKEN);
    await g.delete('me/permissions', TOKEN);
    for (const c of calls.slice(1)) {
      expect(c.url.toString()).not.toContain(TOKEN);
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.url.searchParams.get('appsecret_proof')).toBe(proof);
    }
    // sem token (ex.: oauth/access_token) não manda Authorization nem proof
    await g.get('me', {}, null);
    expect(calls[3].headers.authorization).toBeUndefined();
    expect(calls[3].url.searchParams.get('appsecret_proof')).toBeNull();
  });
  it('paginate: segue paging.next até o teto, tira o access_token que a Meta põe no next e acrescenta o proof', async () => {
    const { f, calls } = graphFake({
      'GET /act_1/ads': [
        { data: [{ id: '1' }, { id: '2' }], paging: { next: 'https://graph.facebook.com/v25.0/act_1/ads?after=c1&access_token=' + TOKEN } },
        { data: [{ id: '3' }], paging: { next: 'https://graph.facebook.com/v25.0/act_1/ads?after=c2&access_token=' + TOKEN } },
        { data: [{ id: '4' }] },
      ],
    });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f });
    const pages: number[] = [];
    const all = await g.paginate<{ id: string }>('act_1/ads', { limit: 2 }, TOKEN, 3, { onPage: (n) => pages.push(n) });
    expect(all.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(pages).toEqual([2, 3]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url.searchParams.get('after')).toBe('c1');
    expect(calls[1].url.searchParams.get('access_token')).toBeNull();
    expect(calls[1].url.toString()).not.toContain(TOKEN);
    expect(calls[1].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[1].url.searchParams.get('appsecret_proof')).toBe(proof);
  });
  it('rede falha: 1 nova tentativa em GET, depois META_UNAVAILABLE down (mensagem sem token); POST nunca repete', async () => {
    let n = 0;
    const f = (async (url: string) => {
      n++;
      throw new Error(`fetch failed ${url}`);
    }) as unknown as typeof fetch;
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f, sleep: async () => undefined });
    const e = await g.get('me', {}, TOKEN).catch((x: MetaError) => x);
    expect(e).toMatchObject({ code: 'META_UNAVAILABLE', details: { reason: 'down' }, action: 'retry' });
    // a URL que vaza na mensagem de rede não tem mais token (vai no header); se tivesse, o scrub cobre
    expect((e as MetaError).message).not.toContain(TOKEN);
    expect((e as MetaError).message).toContain('fetch failed');
    expect(scrubToken(`fetch failed https://g/me?access_token=${TOKEN}`)).toBe('fetch failed https://g/me?access_token=***');
    expect(n).toBe(2);
    n = 0;
    await expect(g.post('act_1/campaigns', { name: 'x' }, TOKEN)).rejects.toMatchObject({ code: 'META_UNAVAILABLE' });
    expect(n).toBe(1);
  });
  it('5xx cru (sem JSON) em GET: tenta de novo e vira META_UNAVAILABLE', async () => {
    const { f, calls } = graphFake({ 'GET /me': [new Response('<html>502</html>', { status: 502 }), new Response('<html>502</html>', { status: 502 })] });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f, sleep: async () => undefined });
    await expect(g.get('me', {}, TOKEN)).rejects.toMatchObject({ code: 'META_UNAVAILABLE', details: { reason: 'down' } });
    expect(calls).toHaveLength(2);
  });
  it('header X-Business-Use-Case-Usage ≥ 100 % com resposta 200 = META_RATE_LIMITED com retryAfterSec do estimated_time_to_regain_access', async () => {
    const h = { 'x-business-use-case-usage': JSON.stringify({ '123': [{ type: 'ads_insights', call_count: 100, total_cputime: 12, total_time: 30, estimated_time_to_regain_access: 5 }] }) };
    const { f } = graphFake({ 'GET /me': json(200, { id: '1' }, h) });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f });
    await expect(g.get('me', {}, TOKEN)).rejects.toMatchObject({ code: 'META_RATE_LIMITED', retryAfterSec: 300, details: { reason: 'rate_limited', retryAfterSec: 300 } });
    expect(g.lastUsage).toEqual({ pct: 100, regainSec: 300 });
    expect(parseUsageHeaders(new Headers({ 'x-app-usage': JSON.stringify({ call_count: 42, total_cputime: 1, total_time: 3 }) }))).toEqual({ pct: 42, regainSec: null });
    expect(parseUsageHeaders(new Headers({ 'x-app-usage': 'not json' }))).toBeNull();
    expect(parseUsageHeaders(new Headers())).toBeNull();
  });
});

describe('mapGraphError (meta-v1 §3.3, uma linha por teste)', () => {
  const row = (error: Record<string, unknown>, httpStatus = 400) => mapGraphError(error, { httpStatus, stage: 'creating_adset' });
  it('190 token → META_TOKEN_INVALID / reconnect_meta', () => {
    const e = row({ message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'Abc' });
    expect(e).toMatchObject({ code: 'META_TOKEN_INVALID', action: 'reconnect_meta', stage: 'creating_adset' });
    expect(e.failDetail).toBe('190/463/Abc Error validating access token: Session has expired');
  });
  it('10 / 200-299 / 100 "does not have permission" → META_PERMISSION / reconnect_meta (com o escopo quando citado)', () => {
    expect(row({ message: '(#10) Application does not have permission for this action', code: 10 })).toMatchObject({ code: 'META_PERMISSION', action: 'reconnect_meta', details: { reason: 'missing_scope' } });
    expect(row({ message: '(#200) Requires ads_management permission', code: 200 })).toMatchObject({ code: 'META_PERMISSION', details: { reason: 'missing_scope', scope: 'ads_management' } });
    expect(row({ message: '(#100) The user does not have permission to access this ad account', code: 100 })).toMatchObject({ code: 'META_PERMISSION' });
  });
  it('conta desativada / em revisão (1487xxx) → META_ACCOUNT_UNUSABLE / choose_account', () => {
    expect(row({ message: 'Invalid parameter', code: 100, error_subcode: 1487390, error_user_title: 'Ad account disabled', error_user_msg: 'Your ad account has been disabled.' })).toMatchObject({ code: 'META_ACCOUNT_UNUSABLE', action: 'choose_account', message: 'Your ad account has been disabled.' });
    expect(row({ message: 'Ad account is under review', code: 100, error_subcode: 999 })).toMatchObject({ code: 'META_ACCOUNT_UNUSABLE' });
  });
  it('pagamento (UNSETTLED / funding) → META_PAYMENT_REQUIRED / fix_payment', () => {
    expect(row({ message: 'Invalid parameter', code: 100, error_subcode: 1487008, error_user_msg: 'Your ad account has an unsettled balance.' })).toMatchObject({ code: 'META_PAYMENT_REQUIRED', action: 'fix_payment' });
    expect(row({ message: 'Please add a payment method / funding source', code: 100 })).toMatchObject({ code: 'META_PAYMENT_REQUIRED' });
  });
  it('política (1815xxx / ad review) → META_POLICY / edit_ad_text', () => {
    expect(row({ message: 'Invalid parameter', code: 100, error_subcode: 1815016, error_user_title: 'Ad Not Approved', error_user_msg: "Your ad wasn't approved because it doesn't follow our Advertising Policies." })).toMatchObject({ code: 'META_POLICY', action: 'edit_ad_text' });
    expect(row({ message: 'This ad contains prohibited content per ad review', code: 100 })).toMatchObject({ code: 'META_POLICY' });
  });
  it('orçamento abaixo do mínimo (1487xxx budget) → META_BUDGET_TOO_LOW / raise_budget (+ minimumMinor quando o texto traz o valor)', () => {
    const e = row({ message: 'Invalid parameter', code: 100, error_subcode: 1487014, error_user_title: 'Budget too low', error_user_msg: 'The minimum daily budget for this ad set is $5.00.' });
    expect(e).toMatchObject({ code: 'META_BUDGET_TOO_LOW', action: 'raise_budget', details: { minimumMinor: 500 } });
    expect(row({ message: 'Daily budget must be at least 100 (minimum budget)', code: 100 })).toMatchObject({ code: 'META_BUDGET_TOO_LOW' });
  });
  it('vídeo recusado no processamento → META_VIDEO_REJECTED / render_again', () => {
    expect(row({ message: 'Unsupported video format', code: 100 })).toMatchObject({ code: 'META_VIDEO_REJECTED', action: 'render_again' });
    expect(row({ message: 'The video could not be processed', code: 352 })).toMatchObject({ code: 'META_VIDEO_REJECTED' });
  });
  it('4 / 17 / 32 / 613 (limite) → META_RATE_LIMITED / retry com retryAfterSec', () => {
    for (const c of [4, 17, 32, 613, 80004]) expect(mapGraphError({ message: 'User request limit reached', code: c }, { retryAfterSec: 120 })).toMatchObject({ code: 'META_RATE_LIMITED', action: 'retry', retryAfterSec: 120, details: { reason: 'rate_limited', retryAfterSec: 120 } });
    expect(mapGraphError({ message: 'limit', code: 4 })).toMatchObject({ retryAfterSec: 60 });
  });
  it('resto / 5xx / is_transient → META_ERROR ou META_UNAVAILABLE / retry', () => {
    expect(row({ message: 'Unknown error', code: 1 })).toMatchObject({ code: 'META_ERROR', action: 'retry' });
    expect(row({ message: 'An unknown error occurred', code: 1, is_transient: true })).toMatchObject({ code: 'META_UNAVAILABLE', action: 'retry', details: { reason: 'down' } });
    expect(mapGraphError(null, { httpStatus: 503 })).toMatchObject({ code: 'META_UNAVAILABLE', failDetail: 'http 503' });
    expect(mapGraphError(undefined, {})).toMatchObject({ code: 'META_ERROR' });
  });
  it('nunca leva o token: mensagem, failDetail e scrubToken', () => {
    const e = row({ message: `Bad URL access_token=${TOKEN}&x=1 ${TOKEN}`, code: 1, error_user_msg: `see fb_exchange_token=${TOKEN}` });
    expect(e.message).not.toContain(TOKEN);
    expect(e.failDetail).not.toContain(TOKEN);
    expect(scrubToken(`input_token=${TOKEN} and ${TOKEN}`)).toBe('input_token=*** and EAA***');
  });
});

describe('LiveMetaService OAuth (meta-v1 §3.1/§3.4)', () => {
  const okRoutes = () => ({
    'GET /oauth/access_token': [{ access_token: 'SHORT' }, { access_token: 'LONG', expires_in: 5184000 }],
    'GET /debug_token': { data: { is_valid: true, scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'public_profile'], expires_at: 1766318400, user_id: '42' } },
    'GET /me': { id: '42', name: 'Tordan' },
  });
  it('troca code → short → long-lived → debug_token (app token) → /me (com proof); grant completo', async () => {
    const { svc, calls } = live(okRoutes());
    const g = await svc.exchangeCode({ code: 'abc' });
    expect(g).toEqual({ accessToken: 'LONG', tokenType: 'USER_LONG_LIVED', expiresAt: '2025-12-21T12:00:00.000Z', scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'public_profile'], user: { id: '42', name: 'Tordan' } });
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ client_id: CFG.appId, client_secret: CFG.appSecret, redirect_uri: CFG.redirectUri, code: 'abc' });
    expect(Object.fromEntries(calls[1].url.searchParams)).toEqual({ grant_type: 'fb_exchange_token', client_id: CFG.appId, client_secret: CFG.appSecret, fb_exchange_token: 'SHORT' });
    expect(Object.fromEntries(calls[2].url.searchParams)).toEqual({ input_token: 'LONG', access_token: `${CFG.appId}|${CFG.appSecret}` });
    expect(calls[3].url.searchParams.get('access_token')).toBeNull();
    expect(calls[3].headers.authorization).toBe('Bearer LONG');
    expect(calls[3].url.searchParams.get('appsecret_proof')).toBe(createHmac('sha256', CFG.appSecret).update('LONG').digest('hex'));
  });
  it('failDetail do OAuth sai higienizado: sem code, token, client_secret ou Bearer', async () => {
    const leak = `Bad URL https://graph/oauth/access_token?client_id=1&client_secret=shh&code=AQDsecretcode&fb_exchange_token=${TOKEN} Bearer ${TOKEN}`;
    const { svc } = live({ 'GET /oauth/access_token': gerr(400, { message: leak, type: 'OAuthException', code: 100 }) });
    const e = (await svc.exchangeCode({ code: 'AQDsecretcode' }).catch((x: MetaError) => x)) as MetaError;
    expect(e.code).toBe('META_OAUTH_FAILED');
    for (const s of [e.failDetail ?? '', e.message]) {
      expect(s).not.toContain('AQDsecretcode');
      expect(s).not.toContain('shh');
      expect(s).not.toContain(TOKEN);
    }
    expect(e.failDetail).toContain('code_exchange');
    expect(e.failDetail).toContain('code=***');
    const { svc: s2 } = live({});
    const e2 = (await s2.exchangeCode({ error: 'server_error', errorDescription: `redirect https://x/cb?code=AQD123&access_token=${TOKEN}` }).catch((x: MetaError) => x)) as MetaError;
    expect(e2.failDetail).toBe('server_error: redirect https://x/cb?code=***&access_token=***');
    // o construtor do MetaError também scrubba qualquer failDetail que chegue cru
    expect(new MetaError('META_ERROR', null, { failDetail: `x access_token=${TOKEN}` }).failDetail).toBe('x access_token=***');
  });
  it('error=access_denied → META_OAUTH_DENIED sem chamar a Meta', async () => {
    const { svc, calls } = live(okRoutes());
    await expect(svc.exchangeCode({ error: 'access_denied', errorReason: 'user_denied', errorDescription: 'Permissions error' })).rejects.toMatchObject({ code: 'META_OAUTH_DENIED', action: null });
    expect(calls).toHaveLength(0);
  });
  it('escopo desmarcado → META_SCOPES_MISSING { missing } (a conexão não é gravada)', async () => {
    const { svc } = live({ ...okRoutes(), 'GET /debug_token': { data: { is_valid: true, scopes: ['ads_read', 'pages_show_list'], expires_at: 1766318400 } } });
    await expect(svc.exchangeCode({ code: 'abc' })).rejects.toMatchObject({ code: 'META_SCOPES_MISSING', details: { missing: ['ads_management', 'business_management'] } });
  });
  it('code usado/expirado (OAuthException 100) ou debug_token is_valid=false → META_OAUTH_FAILED; Graph fora → META_UNAVAILABLE', async () => {
    const { svc } = live({ 'GET /oauth/access_token': gerr(400, { message: 'This authorization code has been used.', type: 'OAuthException', code: 100, error_subcode: 36009 }) });
    const e = await svc.exchangeCode({ code: 'used' }).catch((x: MetaError) => x);
    expect(e).toMatchObject({ code: 'META_OAUTH_FAILED', action: null });
    expect((e as MetaError).failDetail).toContain('code_exchange');
    const { svc: s2 } = live({ ...okRoutes(), 'GET /debug_token': { data: { is_valid: false, error: { code: 190, message: 'Invalid OAuth access token.' } } } });
    await expect(code(s2.exchangeCode({ code: 'abc' }))).resolves.toBe('META_OAUTH_FAILED');
    const { svc: s3 } = live({ 'GET /oauth/access_token': new Response('bad gateway', { status: 502 }) });
    await expect(code(s3.exchangeCode({ code: 'abc' }))).resolves.toBe('META_UNAVAILABLE');
  });
  it('inspectToken: debug_token inválido não lança (isValid false); health com ele = META_TOKEN_INVALID', async () => {
    const { svc } = live({ 'GET /debug_token': { data: { is_valid: false, scopes: [] } } });
    expect(await svc.inspectToken(auth)).toEqual({ isValid: false, expiresAt: null, scopes: [], missingScopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list'] });
    await expect(code(svc.health(auth, { adAccountId: 'act_1', pageId: 'p', pixelId: null, businessId: null, tokenExpiresAt: null, scopes: [], counts: { adsCount: 0, activeCount: 0 } }))).resolves.toBe('META_TOKEN_INVALID');
  });
  it('revoke: DELETE /me/permissions, nunca lança', async () => {
    const { svc, calls } = live({ 'DELETE /me/permissions': gerr(400, { message: 'x', code: 190 }) });
    await expect(svc.revoke(auth)).resolves.toBeUndefined();
    expect(calls[0].method).toBe('DELETE');
  });
});

describe('LiveMetaService leitura (meta-v1 §3.1 options/health, §3.2 sync)', () => {
  it('listOptions: canManage por user_tasks, permissionReason, páginas, pixels só com adAccountId', async () => {
    const { svc, calls } = live({
      'GET /me/adaccounts': { data: [
        { id: 'act_1', name: 'A', currency: 'USD', account_status: 1, business: { id: 'b1', name: 'Biz' }, user_tasks: ['DRAFT', 'ANALYZE', 'ADVERTISE', 'MANAGE'] },
        { id: 'act_2', name: 'B', currency: 'BRL', account_status: 1, user_tasks: ['ANALYZE'] },
        { id: 'act_3', name: 'C', currency: 'USD', account_status: 2, user_tasks: ['MANAGE'] },
      ] },
      'GET /me/accounts': { data: [{ id: 'p1', name: 'Page' }] },
      'GET /act_1/adspixels': { data: [{ id: 'px1', name: 'Pixel', last_fired_time: '2026-10-20T10:00:00+0000' }] },
    });
    const o = await svc.listOptions(auth, {});
    expect(o.adAccounts).toEqual([
      { id: 'act_1', name: 'A', currency: 'USD', accountStatus: 1, business: { id: 'b1', name: 'Biz' }, canManage: true, permissionReason: null },
      { id: 'act_2', name: 'B', currency: 'BRL', accountStatus: 1, business: null, canManage: false, permissionReason: 'no_advertise_task' },
      { id: 'act_3', name: 'C', currency: 'USD', accountStatus: 2, business: null, canManage: false, permissionReason: 'account_disabled' },
    ]);
    expect(o.pages).toEqual([{ id: 'p1', name: 'Page' }]);
    expect(o.pixels).toEqual([]);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/v25.0/me/adaccounts', '/v25.0/me/accounts']);
    const o2 = await svc.listOptions(auth, { adAccountId: 'act_1' });
    expect(o2.pixels).toEqual([{ id: 'px1', name: 'Pixel', adAccountId: 'act_1', lastFiredAt: '2026-10-20T10:00:00.000Z' }]);
  });
  it('readAdAccount: campos, funding, minimum_budgets; conta fora do alcance = META_PERMISSION', async () => {
    const { svc } = live({
      'GET /act_1': { id: 'act_1', name: 'A', currency: 'USD', timezone_name: 'America/New_York', account_status: 1, business: { id: 'b1', name: 'Biz' }, user_tasks: ['ADVERTISE'], funding_source_details: { id: '9', display_string: 'Visa *1234', type: 1 }, minimum_budgets: [{ currency: 'USD', min_daily_budget_imp: 100, min_daily_budget_high_freq: 500, min_daily_budget_low_freq: 100, min_daily_budget_video_views: 100 }] },
      'GET /act_9': gerr(400, { message: 'Unsupported get request. Object with ID act_9 does not exist', code: 100, error_subcode: 33 }),
    });
    expect(await svc.readAdAccount(auth, 'act_1')).toEqual({ id: 'act_1', name: 'A', currency: 'USD', timezoneName: 'America/New_York', accountStatus: 1, accountStatusLabel: 'active', business: { id: 'b1', name: 'Biz' }, canManage: true, hasFunding: true, minimumDailyBudgetMinor: 100 });
    // forma real da Graph v25.0 (conta do Gusta, 22/10): `minimum_budgets: { data: [...] }` com várias moedas; pega a da conta
    const { svc: svcReal } = live({ 'GET /act_2': { id: 'act_2', name: 'R', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1, business: { id: 'b1', name: 'Biz' }, user_tasks: ['DRAFT', 'ANALYZE', 'ADVERTISE', 'MANAGE'], funding_source_details: { id: '25', display_string: 'Saldo disponível (R$0,00 BRL)', type: 20 }, minimum_budgets: { data: [{ currency: 'AED', min_daily_budget_imp: 369 }, { currency: 'BRL', min_daily_budget_imp: 500, min_daily_budget_high_freq: 2500 }] } } });
    expect(await svcReal.readAdAccount(auth, 'act_2')).toMatchObject({ currency: 'BRL', canManage: true, hasFunding: true, minimumDailyBudgetMinor: 500 });
    await expect(svc.readAdAccount(auth, 'act_9')).rejects.toMatchObject({ code: 'META_PERMISSION', details: { adAccountId: 'act_9', reason: 'no_advertise_task' } });
  });
  it('health: 8 checks a partir da Graph (sem funding = bad, página perdida = bad, pixel sem disparo = warn, business não verificado = warn)', async () => {
    const { svc } = live({
      'GET /debug_token': { data: { is_valid: true, scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list'], expires_at: Math.floor(NOW.getTime() / 1000) + 50 * 86400 } },
      'GET /act_1': { id: 'act_1', name: 'A', currency: 'USD', timezone_name: 'UTC', account_status: 1, business: { id: 'b1', name: 'Biz' }, user_tasks: ['ADVERTISE'], minimum_budgets: [{ currency: 'USD', min_daily_budget_imp: 100 }] },
      'GET /p1': gerr(400, { message: 'Unsupported get request', code: 100 }),
      'GET /px1': { id: 'px1', last_fired_time: '2026-09-01T00:00:00+0000' },
      'GET /b1': { id: 'b1', verification_status: 'not_verified' },
    });
    const r = await svc.health(auth, { adAccountId: 'act_1', pageId: 'p1', pixelId: 'px1', businessId: null, tokenExpiresAt: null, scopes: [], counts: { adsCount: 3, activeCount: 2 } });
    expect(r.health.checks.map((c) => `${c.key}:${c.level}`)).toEqual(['token:ok', 'scopes:ok', 'account:ok', 'funding:bad', 'page:bad', 'pixel:warn', 'budget:ok', 'verified:warn']);
    expect(r.health).toMatchObject({ level: 'bad', canPublish: false, adsCount: 3, activeCount: 2 });
    expect(r.account?.id).toBe('act_1');
    expect(r.token.isValid).toBe(true);
  });
  it('health: conta UNSETTLED (3) = account bad "Unpaid balance"; 7 = warn; verified ok', async () => {
    const mk = (status: number) => live({
      'GET /debug_token': { data: { is_valid: true, scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list'] } },
      'GET /act_1': { id: 'act_1', currency: 'USD', account_status: status, business: { id: 'b1' }, funding_source_details: { id: '1' }, minimum_budgets: [{ currency: 'USD', min_daily_budget_imp: 100 }] },
      'GET /p1': { id: 'p1' }, 'GET /b1': { id: 'b1', verification_status: 'verified' },
    }).svc;
    const i = { adAccountId: 'act_1', pageId: 'p1', pixelId: null, businessId: null, tokenExpiresAt: null, scopes: [], counts: { adsCount: 0, activeCount: 0 } };
    const h3 = (await mk(3).health(auth, i)).health;
    expect(h3.checks.find((c) => c.key === 'account')).toEqual({ key: 'account', level: 'bad', detail: 'Unpaid balance' });
    expect(h3.canPublish).toBe(false);
    const h7 = (await mk(7).health(auth, i)).health;
    expect(h7.checks.find((c) => c.key === 'account')).toMatchObject({ level: 'warn' });
    expect(h7.checks.find((c) => c.key === 'verified')).toMatchObject({ level: 'ok' });
    expect(h7.canPublish).toBe(true);
  });
  const ADS = {
    data: [
      { id: 'a1', name: 'Video 1', effective_status: 'ACTIVE', created_time: '2026-09-01T00:00:00+0000', campaign: { id: 'c', name: 'C' }, adset: { id: 's', name: 'S' }, creative: { id: 'cr1', video_id: 'v1', thumbnail_url: 'https://t/1.jpg' } },
      { id: 'a2', name: 'Image', effective_status: 'ACTIVE', created_time: '2026-09-01T00:00:00+0000', campaign: { id: 'c', name: 'C' }, adset: { id: 's', name: 'S' }, creative: { id: 'cr2', image_url: 'x' } },
      { id: 'a3', name: 'Video 3 (story spec)', effective_status: 'PAUSED', created_time: '2026-10-19T00:00:00+0000', campaign: { id: 'c', name: 'C' }, adset: { id: 's', name: 'S' }, creative: { id: 'cr3', object_type: 'VIDEO' } },
    ],
  };
  const insightRow = (ad_id: string, spend: number, purchases: number, extra: Record<string, unknown> = {}) => ({
    ad_id, spend: String(spend), impressions: '10000', reach: '4000', clicks: '250',
    actions: [{ action_type: 'link_click', value: '250' }, { action_type: 'omni_purchase', value: String(purchases) }, { action_type: 'purchase', value: String(purchases) }],
    purchase_roas: [{ action_type: 'omni_purchase', value: '2.5' }],
    video_play_actions: [{ action_type: 'video_view', value: '6000' }], video_thruplay_watched_actions: [{ action_type: 'video_view', value: '1500' }],
    video_continuous_2_sec_watched_actions: [{ action_type: 'video_view', value: '4000' }], ...extra,
  });
  it('syncAds: todos os formatos (imagem com videoId null), 3 janelas (last_30d, last_7d, time_range hoje−14..−8) × 3 níveis, métricas derivadas, frequência só nos 7 d no anúncio, verdict/trend', async () => {
    const { svc, calls } = live({
      'GET /act_1/ads': ADS,
      'GET /cr3': { id: 'cr3', object_story_spec: { video_data: { video_id: 'v3' } } },
      'GET /cr2': { id: 'cr2' },
      'GET /act_1/insights': (c) => {
        const w = c.url.searchParams.get('date_preset') ?? c.url.searchParams.get('time_range')!;
        if (w === 'last_30d') return { data: [insightRow('a1', 400, 20), insightRow('a2', 50, 1), insightRow('a3', 30, 1)] };
        if (w === 'last_7d') return { data: [insightRow('a1', 100, 8)] };
        return { data: [insightRow('a1', 100, 4)] };
      },
    });
    const steps: string[] = [];
    const r = await svc.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true, now: NOW }, (p) => steps.push(`${p.stage}:${p.done}/${p.total}`));
    expect(r.listed).toBe(3);
    expect(r.ads.map((a) => a.metaAdId)).toEqual(['a1', 'a2', 'a3']); // a2 = imagem (D2), LOW_DATA, gasto maior que a3
    expect(r.ads.find((a) => a.metaAdId === 'a2')).toMatchObject({ videoId: null, verdict: 'LOW_DATA', status: 'ACTIVE' });
    expect(steps[0]).toBe('listing_campaigns:0/0');
    expect(steps).toContain('listing_ads:0/0');
    expect(steps).toContain('reading_insights:3/3');
    expect(steps[steps.length - 1]).toBe('scoring:3/3');
    expect(r).toMatchObject({ campaigns: [], adsets: [], truncated: false });
    const a1 = r.ads[0];
    expect(a1).toMatchObject({ verdict: 'WINNER', trend: 'WORKING', videoId: 'v1', thumbnailUrl: 'https://t/1.jpg', metaCreativeId: 'cr1', resultType: 'omni_purchase', adCreatedTime: '2026-09-01T00:00:00.000Z' });
    expect(a1.metrics).toEqual({ spend: 400, impressions: 10000, clicks: 250, ctr: 2.5, results: 20, resultType: 'omni_purchase', cpa: 20, roas: 2.5, plays2s: 4000, hookRate: 40, thruplays: 1500, frequency: null });
    expect(a1.metrics7d).toMatchObject({ spend: 100, results: 8, cpa: 12.5, frequency: 2.5 });
    expect(a1.metricsPrev7d).toMatchObject({ spend: 100, results: 4, cpa: 25 });
    expect(r.ads[2]).toMatchObject({ metaAdId: 'a3', verdict: 'LOW_DATA', trend: null, videoId: 'v3' });
    expect(r.ads[2].metrics7d).toMatchObject({ spend: 0, results: 0, cpa: null, frequency: null });
    expect(r.medianCpa).toBe(20);
    const ins = calls.filter((c) => c.url.pathname.endsWith('/insights'));
    expect(ins).toHaveLength(9);
    expect(ins.map((c) => c.url.searchParams.get('level'))).toEqual(['ad', 'ad', 'ad', 'adset', 'adset', 'adset', 'campaign', 'campaign', 'campaign']);
    expect(ins[3].url.searchParams.get('fields')).toContain('adset_id');
    expect(ins[3].url.searchParams.get('fields')).not.toContain('ad_id,');
    expect(ins[0].url.searchParams.get('fields')).toBe(INSIGHT_FIELDS.join(','));
    expect(ins[0].url.searchParams.get('fields')).toContain('video_continuous_2_sec_watched_actions');
    expect(ins[0].url.searchParams.get('fields')).not.toContain('video_3_sec'); // não existe na Graph (v25.0 → #100)
    expect(ins[0].url.searchParams.get('level')).toBe('ad');
    expect(ins[2].url.searchParams.get('time_range')).toBe(JSON.stringify({ since: '2026-10-07', until: '2026-10-13' }));
    const adsCall = calls.find((c) => c.url.pathname.endsWith('/act_1/ads'))!;
    expect(adsCall.url.searchParams.get('fields')).toContain('creative{id,video_id,thumbnail_url,object_type}');
    expect(adsCall.url.searchParams.get('fields')).toContain(',status,');
    expect(adsCall.url.searchParams.get('fields')).not.toContain('object_story_spec'); // listagem leve (bug live 22/10)
    const lookups = calls.filter((c) => c.url.searchParams.get('fields') === 'object_story_spec{video_data{video_id}}');
    expect(lookups.map((c) => c.url.pathname.replace(/^\/v\d+\.\d+/, ''))).toEqual(['/cr2', '/cr3']); // sem ?ids= (deprecated na Graph)
  });
  const tooMuch = () => gerr(500, { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1, fbtrace_id: 'F' });
  it('code 1 "reduce the amount of data": repete a MESMA página com limit menor (100 → 50 → 25) mantendo o cursor', async () => {
    const { f, calls } = graphFake({
      'GET /act_1/ads': (c) => {
        const limit = Number(c.url.searchParams.get('limit'));
        const after = c.url.searchParams.get('after');
        if (limit > 25) return tooMuch();
        if (!after) return { data: [{ id: '1' }], paging: { next: `https://graph.facebook.com/v25.0/act_1/ads?after=c1&limit=${limit}` } };
        return { data: [{ id: '2' }] };
      },
    });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f, sleep: async () => undefined });
    const all = await g.paginate<{ id: string }>('act_1/ads', { limit: 100 }, TOKEN, 500);
    expect(all.map((x) => x.id)).toEqual(['1', '2']);
    expect(calls.map((c) => [c.url.searchParams.get('limit'), c.url.searchParams.get('after')])).toEqual([['100', null], ['50', null], ['25', null], ['25', 'c1']]);
  });
  it('code 1 até no limit 10: desiste com META_UNAVAILABLE too_much_data e frase legível; insights (500) também encolhe', async () => {
    const { f, calls } = graphFake({ 'GET /act_1/insights': tooMuch });
    const g = new GraphClient({ appId: 'a', appSecret: 'shh', fetchImpl: f, sleep: async () => undefined });
    const err = await g.paginate('act_1/insights', { limit: 500 }, TOKEN, 1000).catch((e) => e);
    expect(err).toBeInstanceOf(MetaError);
    expect(err).toMatchObject({ code: 'META_UNAVAILABLE', options: { details: { reason: 'too_much_data' }, action: 'retry' } });
    expect(err.message).toMatch(/too much data/);
    expect(calls.map((c) => c.url.searchParams.get('limit'))).toEqual(['500', '250', '125', '62', '31', '15', '10']);
    expect([nextLimit(100), nextLimit(50), nextLimit(25), nextLimit(10)]).toEqual([50, 25, 10, null]);
  });
  const notValid = (field: string) => gerr(400, { message: `(#100) ${field} is not valid for fields param. please check https://developers.facebook.com/docs/marketing-api/reference/ads-insights/`, code: 100 });
  it('syncAds: Graph recusa um campo não essencial (#100, ex.: o do hook) → relê a janela sem ele e não pede mais; plays2s/hookRate null, o resto segue', async () => {
    const { svc, calls } = live({
      'GET /act_1/ads': ADS,
      'GET /cr3': { id: 'cr3', object_story_spec: { video_data: { video_id: 'v3' } } },
      'GET /cr2': { id: 'cr2' },
      'GET /act_1/insights': (c) => (c.url.searchParams.get('fields')!.includes(HOOK_FIELD) ? notValid(HOOK_FIELD) : { data: [insightRow('a1', 400, 20)] }),
    });
    const r = await svc.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true, now: NOW });
    expect(r.ads[0].metrics).toMatchObject({ spend: 400, results: 20, plays2s: null, hookRate: null, thruplays: 1500 });
    const ins = calls.filter((c) => c.url.pathname.endsWith('/insights'));
    expect(ins).toHaveLength(10); // 1 recusada + 3 janelas × 3 níveis sem o campo
    expect(ins.slice(1).every((c) => !c.url.searchParams.get('fields')!.includes(HOOK_FIELD))).toBe(true);
  });
  it('syncAds: dois campos recusados em sequência caem um a um; campo essencial (spend) recusado = META_ERROR legível com o nome do campo', async () => {
    const { svc, calls } = live({
      'GET /act_1/ads': ADS,
      'GET /cr3': { id: 'cr3', object_story_spec: { video_data: { video_id: 'v3' } } },
      'GET /cr2': { id: 'cr2' },
      'GET /act_1/insights': (c) => {
        const f = c.url.searchParams.get('fields')!.split(',');
        if (f.includes('purchase_roas')) return notValid('purchase_roas');
        if (f.includes('video_thruplay_watched_actions')) return notValid('video_thruplay_watched_actions');
        // como a Graph: só devolve o que foi pedido
        return { data: [Object.fromEntries(Object.entries(insightRow('a1', 400, 20)).filter(([k]) => f.includes(k)))] };
      },
    });
    const r = await svc.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true, now: NOW });
    expect(r.ads[0].metrics).toMatchObject({ roas: null, thruplays: null, plays2s: 4000, hookRate: 40 });
    expect(calls.filter((c) => c.url.pathname.endsWith('/insights'))).toHaveLength(11); // 2 recusas + 3 janelas × 3 níveis
    const { svc: svc2 } = live({ 'GET /act_1/ads': ADS, 'GET /cr3': { id: 'cr3', object_story_spec: { video_data: { video_id: 'v3' } } }, 'GET /cr2': { id: 'cr2' }, 'GET /act_1/insights': notValid('spend') });
    const err = await svc2.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaError);
    expect(err.code).toBe('META_ERROR');
    expect(err.failDetail).toContain('spend is not valid for fields param');
    expect(INSIGHT_FIELDS_CORE).toContain('spend');
    // só campos pedidos contam; outro erro #100 não vira "campo recusado"
    expect(invalidFieldOf(new MetaError('META_ERROR', null, { failDetail: '100/-/x (#100) video_3_sec_watched_actions is not valid for fields param.' }), INSIGHT_FIELDS)).toBeNull();
    expect(invalidFieldOf(new MetaError('META_ERROR', null, { failDetail: '100/-/x Unsupported get request.' }), INSIGHT_FIELDS)).toBeNull();
    expect(invalidFieldOf(new MetaError('META_PERMISSION', null, { failDetail: `100/-/x (#100) ${HOOK_FIELD} is not valid for fields param.` }), INSIGHT_FIELDS)).toBeNull();
  });
  it('resultado por businessType com fallback; sem pixel = link_click; mapInsight com linha ausente = zeros', () => {
    expect(resultActionTypes('ONLINE_STORE', true)).toEqual({ primary: 'omni_purchase', fallback: 'purchase' });
    expect(resultActionTypes('LOCAL_BUSINESS', true)).toEqual({ primary: 'lead', fallback: 'onsite_conversion.lead_grouped' });
    expect(resultActionTypes('APP', true).primary).toBe('omni_app_install');
    expect(resultActionTypes('ONLINE_STORE', false)).toEqual({ primary: 'link_click', fallback: null });
    const m = mapInsight({ ad_id: 'x', spend: '10', impressions: '100', clicks: '5', actions: [{ action_type: 'purchase', value: '2' }] }, resultActionTypes('ONLINE_STORE', true), false);
    expect(m).toMatchObject({ results: 2, resultType: 'purchase', resultTypeUsed: 'purchase', cpa: 5, roas: null, plays2s: null, hookRate: null });
    expect(mapInsight(null, resultActionTypes('ONLINE_STORE', false), true)).toMatchObject({ spend: 0, results: 0, cpa: null, ctr: 0, frequency: null, resultType: 'link_click' });
  });
  it('videoSource: source da CDN; sem source ou sem permissão = META_VIDEO_UNAVAILABLE', async () => {
    const { svc } = live({ 'GET /v1': { id: 'v1', source: 'https://video.xx.fbcdn.net/a.mp4', permalink_url: '/x/videos/1', length: 21.4 }, 'GET /v2': { id: 'v2' }, 'GET /v3': gerr(400, { message: 'Unsupported get request', code: 100 }) });
    expect(await svc.videoSource(auth, 'v1')).toEqual({ sourceUrl: 'https://video.xx.fbcdn.net/a.mp4', permalinkUrl: '/x/videos/1', lengthSec: 21.4 });
    await expect(svc.videoSource(auth, 'v2')).rejects.toMatchObject({ code: 'META_VIDEO_UNAVAILABLE', action: 'upload_video' });
    await expect(code(svc.videoSource(auth, 'v3'))).resolves.toBe('META_VIDEO_UNAVAILABLE');
  });
});

describe('LiveMetaService publicação (meta-v1 §3.3)', () => {
  const ids = (p: Partial<MetaPublishIds> = {}): MetaPublishIds => ({ videoId: null, creativeId: null, campaignId: null, adsetId: null, adId: null, ...p });
  const input = (over: Partial<MetaPublishInput> = {}, settings: Partial<MetaPublishInput['settings']> = {}): MetaPublishInput => ({
    adAccountId: 'act_1', pageId: 'p1', pixelId: 'px1', adName: 'HM — Hook A',
    settings: { dailyBudgetMinor: 2000, countries: ['US', 'CA'], objective: 'OUTCOME_SALES', primaryText: 'Found $300/month', headline: 'Orbit', description: 'desc', callToAction: 'SHOP_NOW', link: 'https://example.com', specialAdCategories: [], ageMin: 18, ageMax: 65, objectiveReason: 'business_type', ...settings },
    video: { fileUrl: 'https://cdn/render.mp4', sizeBytes: null, read: null }, thumbnailUrl: 'https://cdn/thumb.jpg', ...over,
  });
  it('corpos das chamadas: campanha PAUSED/AUCTION, ad set com optimization por objetivo, creative video_data', () => {
    const i = input();
    expect(campaignBody(i)).toEqual({ name: 'HM — Hook A', objective: 'OUTCOME_SALES', status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION' });
    expect(adSetBody(i, 'c1')).toEqual({
      name: 'HM — Hook A', campaign_id: 'c1', daily_budget: 2000, billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', status: 'PAUSED',
      targeting: { geo_locations: { countries: ['US', 'CA'] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 } },
      optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'px1', custom_event_type: 'PURCHASE' },
    });
    expect(adSetBody(input({}, { objective: 'OUTCOME_LEADS' }), 'c1')).toMatchObject({ optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { custom_event_type: 'LEAD' } });
    const traffic = adSetBody(input({ pixelId: null }, { objective: 'OUTCOME_TRAFFIC' }), 'c1');
    expect(traffic.optimization_goal).toBe('LINK_CLICKS');
    expect(traffic.promoted_object).toBeUndefined();
    expect(creativeBody(i, 'v1')).toEqual({ name: 'HM — Hook A', object_story_spec: { page_id: 'p1', video_data: { video_id: 'v1', image_url: 'https://cdn/thumb.jpg', message: 'Found $300/month', title: 'Orbit', link_description: 'desc', call_to_action: { type: 'SHOP_NOW', value: { link: 'https://example.com' } } } } });
    expect(creativeBody(input({}, { headline: null, description: null }), 'v1').object_story_spec.video_data).not.toHaveProperty('title');
    // sem thumbnail JPEG (null) o creative vai sem image_url: a Meta gera o thumb do vídeo (nunca mandar a URL do .mp4)
    const semThumb = creativeBody(input({ thumbnailUrl: null }), 'v1').object_story_spec.video_data;
    expect(semThumb).not.toHaveProperty('image_url');
    expect(semThumb.video_id).toBe('v1');
    expect(JSON.stringify(semThumb)).not.toContain('render.mp4');
  });
  it('fluxo feliz por file_url: 6 etapas, ids, preview, PAUSED em tudo; activate/pause; adsManagerUrl', async () => {
    const { svc, calls } = live({
      'POST /act_1/advideos': { id: 'v1' },
      'GET /v1': [{ status: { video_status: 'processing' } }, { status: { video_status: 'ready' } }],
      'POST /act_1/campaigns': { id: 'c1' }, 'POST /act_1/adsets': { id: 's1' }, 'POST /act_1/adcreatives': { id: 'cr1' }, 'POST /act_1/ads': { id: 'ad1' },
      'GET /ad1/previews': { data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=abc&amp;t=1"></iframe>' }] },
      'POST /ad1': { success: true }, 'POST /s1': { success: true }, 'POST /c1': { success: true },
    });
    const i = input();
    expect(await svc.uploadVideo(auth, i)).toEqual({ videoId: 'v1' });
    expect(calls[0].body).toEqual({ file_url: 'https://cdn/render.mp4', name: 'HM — Hook A' });
    const polls: string[] = [];
    await svc.waitVideoReady(auth, i, ids({ videoId: 'v1' }), { onPoll: (s) => polls.push(s) });
    expect(polls).toEqual(['processing', 'ready']);
    expect(await svc.createCampaign(auth, i)).toEqual({ campaignId: 'c1' });
    expect(await svc.createAdSet(auth, i, ids({ campaignId: 'c1' }))).toEqual({ adsetId: 's1' });
    expect(await svc.createAdCreative(auth, i, ids({ videoId: 'v1' }))).toEqual({ creativeId: 'cr1' });
    expect(await svc.createAd(auth, i, ids({ adsetId: 's1', creativeId: 'cr1' }))).toEqual({ adId: 'ad1', previewUrl: 'https://www.facebook.com/ads/api/preview_iframe.php?d=abc&t=1' });
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body as Record<string, unknown>);
    expect([posts[1], posts[2], posts[4]].every((b) => b.status === 'PAUSED')).toBe(true); // creative não tem status
    expect(posts[4]).toEqual({ name: 'HM — Hook A', adset_id: 's1', creative: { creative_id: 'cr1' }, status: 'PAUSED' });
    await svc.setStatus(auth, { objectIds: ['ad1', 's1', 'c1'], status: 'ACTIVE' });
    expect(calls.slice(-3).map((c) => [c.url.pathname, c.body])).toEqual([['/v25.0/ad1', { status: 'ACTIVE' }], ['/v25.0/s1', { status: 'ACTIVE' }], ['/v25.0/c1', { status: 'ACTIVE' }]]);
    expect(svc.adsManagerUrl('act_1', 'ad1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/ads?act=1&selected_ad_ids=ad1');
    // POST com token no header e proof na query; URL e corpo JSON nunca levam o token
    expect(calls[0].url.searchParams.get('appsecret_proof')).toBe(proof);
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].url.toString()).not.toContain(TOKEN);
    expect(JSON.stringify(calls[0].body)).not.toContain(TOKEN);
  });
  it('upload resumable: start → transfer em pedaços de 8 MB (multipart) → finish; usa o video_id do start', async () => {
    const size = 20 * 1024 * 1024 + 5;
    const reads: [number, number][] = [];
    const { svc, calls } = live({
      'POST /act_1/advideos': (c) => {
        const b = c.body as Record<string, string>;
        if (b.upload_phase === 'start') return { upload_session_id: 'sess', video_id: 'v9', start_offset: '0', end_offset: String(8 * 1024 * 1024) };
        if (b.upload_phase === 'transfer') {
          const start = Number(b.start_offset) + 8 * 1024 * 1024;
          return { start_offset: String(Math.min(start, size)), end_offset: String(Math.min(start + 8 * 1024 * 1024, size)) };
        }
        return { success: true };
      },
    });
    const r = await svc.uploadVideo(auth, input({ video: { fileUrl: null, sizeBytes: size, read: async (o, l) => { reads.push([o, l]); return Buffer.alloc(l); } } }));
    expect(r).toEqual({ videoId: 'v9' });
    expect(reads).toEqual([[0, 8388608], [8388608, 8388608], [16777216, 4194309]]);
    const phases = calls.map((c) => (c.body as Record<string, unknown>).upload_phase);
    expect(phases).toEqual(['start', 'transfer', 'transfer', 'transfer', 'finish']);
    expect(calls[1].body).toMatchObject({ upload_session_id: 'sess', start_offset: '0', video_file_chunk: { blob: 8388608 } });
    expect(calls[4].body).toEqual({ upload_phase: 'finish', upload_session_id: 'sess', title: 'HM — Hook A' });
  });
  it('waitVideoReady: error = META_VIDEO_REJECTED; teto = META_ERROR action retry', async () => {
    const { svc } = live({ 'GET /v1': { status: { video_status: 'error', processing_phase: { errors: [{ message: 'Unsupported codec' }] } } } });
    await expect(svc.waitVideoReady(auth, input(), ids({ videoId: 'v1' }))).rejects.toMatchObject({ code: 'META_VIDEO_REJECTED', action: 'render_again', message: 'Unsupported codec' });
    let t = NOW.getTime();
    const { svc: s2 } = live({ 'GET /v1': { status: { video_status: 'processing' } } }, { now: () => new Date((t += 4 * 60_000)) });
    await expect(s2.waitVideoReady(auth, input(), ids({ videoId: 'v1' }), { timeoutMs: 10 * 60_000 })).rejects.toMatchObject({ code: 'META_ERROR', action: 'retry', stage: 'processing_video' });
  });
  it('erros da Meta nas etapas levam `stage`: orçamento baixo completa minimumMinor/currency lendo a conta; política no creative; token na campanha', async () => {
    const { svc } = live({
      'POST /act_1/campaigns': gerr(400, { message: 'Error validating access token', type: 'OAuthException', code: 190 }),
      'POST /act_1/adsets': gerr(400, { message: 'Invalid parameter', code: 100, error_subcode: 1487014, error_user_title: 'Budget too low', error_user_msg: 'Your daily budget is below the minimum.' }),
      'GET /act_1': { id: 'act_1', currency: 'BRL', account_status: 1, minimum_budgets: [{ currency: 'BRL', min_daily_budget_imp: 2500 }] },
      'POST /act_1/adcreatives': gerr(400, { message: 'Invalid parameter', code: 100, error_subcode: 1815016, error_user_msg: "Your ad doesn't follow our Advertising Policies." }),
    });
    await expect(svc.createCampaign(auth, input())).rejects.toMatchObject({ code: 'META_TOKEN_INVALID', stage: 'creating_campaign', action: 'reconnect_meta' });
    await expect(svc.createAdSet(auth, input(), ids({ campaignId: 'c1' }))).rejects.toMatchObject({ code: 'META_BUDGET_TOO_LOW', stage: 'creating_adset', action: 'raise_budget', details: { minimumMinor: 2500, currency: 'BRL' }, message: 'Your daily budget is below the minimum.' });
    await expect(svc.createAdCreative(auth, input(), ids({ videoId: 'v1' }))).rejects.toMatchObject({ code: 'META_POLICY', stage: 'creating_creative', action: 'edit_ad_text' });
  });
});

describe('LiveMetaService Campaigns (campanhas-v1 §1/§4, fetch falso; nenhuma escrita real)', () => {
  const insightRow = (key: string, id: string, spend: number, results: number) => ({
    [key]: id, spend: String(spend), impressions: '10000', reach: '5000', clicks: '200',
    actions: [{ action_type: 'omni_purchase', value: String(results) }],
  });
  const CAMPAIGNS = { data: [
    { id: 'c1', name: 'CBO', objective: 'OUTCOME_SALES', status: 'ACTIVE', effective_status: 'ACTIVE', buying_type: 'AUCTION', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', daily_budget: '5000', budget_remaining: '3100', special_ad_categories: [], start_time: '2026-09-01T00:00:00+0000', created_time: '2026-09-01T00:00:00+0000' },
    { id: 'c2', name: 'ABO', objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', effective_status: 'PAUSED' },
    { id: 'c3', name: 'Old', objective: 'OUTCOME_SALES', status: 'ARCHIVED', effective_status: 'ARCHIVED' },
  ] };
  const ADSETS = { data: [
    { id: 's1', name: 'Broad', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS', learning_stage_info: { status: 'LEARNING' } },
    { id: 's2', name: 'ABO set', campaign_id: 'c2', status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED', daily_budget: '2000', lifetime_budget: '0' },
  ] };
  it('sync lê campanhas e conjuntos (orçamento, CBO/ABO, aprendizado), insights por nível, tira arquivados', async () => {
    const { svc } = live({
      'GET /act_1/campaigns': CAMPAIGNS,
      'GET /act_1/adsets': ADSETS,
      'GET /act_1/ads': { data: [{ id: 'a1', name: 'Img', status: 'PAUSED', effective_status: 'PAUSED', campaign: { id: 'c1', name: 'CBO' }, adset: { id: 's1', name: 'Broad' }, creative: { id: 'cr1', object_type: 'PHOTO' } }] },
      'GET /act_1/insights': (c) => {
        const level = c.url.searchParams.get('level')!;
        const w = c.url.searchParams.get('date_preset');
        if (level === 'campaign') return { data: [insightRow('campaign_id', 'c1', w === 'last_30d' ? 300 : 100, 10)] };
        if (level === 'adset') return { data: [insightRow('adset_id', 's1', 250, 8)] };
        return { data: [] };
      },
    });
    const r = await svc.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true, now: NOW });
    expect(r.campaigns!.map((c) => c.campaignId)).toEqual(['c1', 'c2']); // c3 arquivada fica fora
    expect(r.campaigns![0]).toMatchObject({ status: 'ACTIVE', dailyBudgetMinor: 5000, lifetimeBudgetMinor: null, budgetRemainingMinor: 3100, buyingType: 'AUCTION', startTime: '2026-09-01T00:00:00.000Z' });
    expect(r.campaigns![0].metrics).toMatchObject({ spend: 300, results: 10, cpa: 30, frequency: 2 }); // frequência também nos 30 d por nível
    expect(r.campaigns![0].metrics7d).toMatchObject({ spend: 100 });
    expect(r.campaigns![1]).toMatchObject({ status: 'PAUSED', dailyBudgetMinor: null, metrics: { spend: 0 } });
    expect(r.adsets![0]).toMatchObject({ adsetId: 's1', campaignId: 'c1', learningStage: 'LEARNING', dailyBudgetMinor: null, metrics: { spend: 250, results: 8 } });
    expect(r.adsets![1]).toMatchObject({ dailyBudgetMinor: 2000, lifetimeBudgetMinor: null, effectiveStatus: 'CAMPAIGN_PAUSED' }); // "0" = sem orçamento
    expect(r.ads[0]).toMatchObject({ status: 'PAUSED', videoId: null });
    expect(r.truncated).toBe(false);
  });
  it('sync com mais que maxAds num nível = truncated', async () => {
    const many = { data: Array.from({ length: 3 }, (_, k) => ({ id: `c${k}`, name: `C${k}`, status: 'ACTIVE', effective_status: 'ACTIVE' })) };
    const { svc } = live({ 'GET /act_1/campaigns': many, 'GET /act_1/ads': { data: [] }, 'GET /act_1/insights': { data: [] } });
    const r = await svc.syncAds(auth, { adAccountId: 'act_1', currency: 'USD', businessType: null, hasPixel: false, maxAds: 2, now: NOW });
    expect(r.campaigns).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });
  it('readObject: anúncio com campanha e conjunto (status e orçamento dos pais); campos por nível', async () => {
    const { svc, calls } = live({
      'GET /a1': { id: 'a1', name: 'Ad', status: 'ACTIVE', effective_status: 'ADSET_PAUSED', campaign: { id: 'c1', name: 'C', status: 'ACTIVE', daily_budget: '5000' }, adset: { id: 's1', name: 'S', status: 'PAUSED' } },
      'GET /s2': { id: 's2', name: 'S2', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '2000', campaign: { id: 'c2', name: 'ABO', status: 'ACTIVE' } },
    });
    expect(await svc.readObject(auth, { level: 'ad', id: 'a1' })).toEqual({
      level: 'ad', id: 'a1', name: 'Ad', status: 'ACTIVE', effectiveStatus: 'ADSET_PAUSED', dailyBudgetMinor: null, lifetimeBudgetMinor: null,
      campaign: { id: 'c1', name: 'C', status: 'ACTIVE', dailyBudgetMinor: 5000, lifetimeBudgetMinor: null },
      adset: { id: 's1', name: 'S', status: 'PAUSED', dailyBudgetMinor: null, lifetimeBudgetMinor: null },
    });
    expect(calls[0].url.searchParams.get('fields')).toBe('id,name,status,effective_status,campaign{id,name,status,daily_budget,lifetime_budget},adset{id,name,status,daily_budget,lifetime_budget}');
    const s2 = await svc.readObject(auth, { level: 'adset', id: 's2' });
    expect(s2).toMatchObject({ dailyBudgetMinor: 2000, campaign: { id: 'c2', dailyBudgetMinor: null }, adset: null });
  });
  it('readObject: objeto apagado (100/33 ou effective_status DELETED) = META_OBJECT_GONE; falta de permissão continua META_PERMISSION', async () => {
    const { svc } = live({
      'GET /gone': gerr(400, { message: "Unsupported get request. Object with ID 'gone' does not exist, cannot be loaded due to missing permissions, or does not support this operation.", code: 100, error_subcode: 33, fbtrace_id: 'T' }),
      'GET /del': { id: 'del', name: 'X', status: 'DELETED', effective_status: 'DELETED' },
      'GET /noperm': gerr(403, { message: '(#200) Requires ads_management permission', code: 200 }),
    });
    await expect(svc.readObject(auth, { level: 'campaign', id: 'gone' })).rejects.toMatchObject({ code: 'META_OBJECT_GONE', options: { action: 'refresh', details: { level: 'campaign', id: 'gone' } } });
    await expect(svc.readObject(auth, { level: 'campaign', id: 'del' })).rejects.toMatchObject({ code: 'META_OBJECT_GONE' });
    await expect(svc.readObject(auth, { level: 'campaign', id: 'noperm' })).rejects.toMatchObject({ code: 'META_PERMISSION' });
  });
  it('setDailyBudget: POST /{id} daily_budget em centavos; orçamento no outro nível = META_BUDGET_NOT_EDITABLE; mínimo = META_BUDGET_TOO_LOW', async () => {
    const { svc, calls } = live({
      'POST /s1': { success: true },
      'POST /s_cbo': gerr(400, { message: 'Invalid parameter', error_user_msg: "You can't set an ad set budget because this campaign uses Advantage campaign budget.", code: 100, error_subcode: 1885621 }),
      'POST /s_low': gerr(400, { message: 'Invalid parameter', error_user_msg: 'Your budget is too low. The minimum daily budget is $5.00.', code: 100, error_subcode: 1487005 }),
    });
    await svc.setDailyBudget(auth, { level: 'adset', id: 's1', dailyBudgetMinor: 3000 });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { daily_budget: '3000' } });
    await expect(svc.setDailyBudget(auth, { level: 'adset', id: 's_cbo', dailyBudgetMinor: 3000 })).rejects.toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE' });
    await expect(svc.setDailyBudget(auth, { level: 'adset', id: 's_low', dailyBudgetMinor: 100 })).rejects.toMatchObject({ code: 'META_BUDGET_TOO_LOW', options: { details: { minimumMinor: 500 } } });
    await expect(svc.setDailyBudget(auth, { level: 'adset', id: 's1', dailyBudgetMinor: 12.5 })).rejects.toMatchObject({ code: 'META_ERROR' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3); // o inválido nem sai
  });
  it('objectUrl por nível e usage() a partir dos headers de cota', async () => {
    const { svc } = live({ 'GET /a1': json(200, { id: 'a1', name: 'A', status: 'ACTIVE', effective_status: 'ACTIVE' }, { 'x-business-use-case-usage': JSON.stringify({ '1': [{ type: 'ads_management', call_count: 91, total_cputime: 5, total_time: 5, estimated_time_to_regain_access: 2 }] }) }) });
    expect(svc.objectUrl('act_123', 'campaign', 'c1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=c1');
    expect(svc.objectUrl('act_123', 'adset', 's1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/adsets?act=123&selected_adset_ids=s1');
    expect(svc.objectUrl('act_123', 'ad', 'a1')).toBe(svc.adsManagerUrl('act_123', 'a1'));
    expect(svc.usage()).toBeNull();
    await svc.readObject(auth, { level: 'ad', id: 'a1' });
    expect(svc.usage()).toMatchObject({ pct: 91, regainSec: 120 });
    expect(typeof svc.usage()!.at).toBe('string');
  });
});
