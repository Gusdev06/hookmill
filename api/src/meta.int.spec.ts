// Meta v1 (docs/contratos/meta-v1.md, B1) de ponta a ponta contra a infra LOCAL (maquina_test), porta MetaService em
// mock (stepMs 0, custo zero): connect → callback (os 5 códigos de redirect, token cifrado e nunca devolvido) → options
// (canManage) → selection (META_PERMISSION, conta desativada) → health → sync (2 WINNER, trends, sync.state) → summary
// 7d/30d → Pick from Meta (POST /iterate { metaAdId } cria campeão OWN, reaproveita, falha novideo, 404) → publish
// (pausado, erros 422, retry sem duplicar, activate OWNER/ADMIN, pause) → disconnect → META_MODE=off → papéis.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.PUBLIC_MEDIA = 'on';
const PORT = 3198; // fixa: a mídia do mock (vídeo do anúncio) é baixada de PUBLIC_API_URL
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { AppConfig } from './config/app-config';
import { META_SERVICE, decifrar, ruleFromEnv } from './integracoes';
import { FakeMetaService } from './integracoes/meta/mock.service';
import { PAGE_CAPTURE, type PageCapturePort } from './iteracao/portas';
import { configureApp } from './main';
import { tokenKeyOf } from './meta/comum';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);

const RUN = Date.now().toString(36);
const PREFIX = `meta-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'admin' | 'member' | 'client';
const WEB = 'http://localhost:3000';

describe(isLocal ? 'Meta v1 (integração local)' : 'Meta v1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string;
  let offerId: string;
  let creativeId: string;
  let fake: FakeMetaService;
  let tokenKey: string;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = r.status === 204 || r.status === 302 ? null : await r.json().catch(() => null);
    return { status: r.status, location: r.headers.get('location'), data: json?.data, error: json?.error, meta: json?.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const jobDone = (id: string, token: string) => until(() => call('GET', `/jobs/${id}`, token), (r) => ['SUCCEEDED', 'FAILED', 'PARTIAL'].includes(r.data?.status));
  const conn = () => prisma.metaConnection.findUnique({ where: { workspaceId: w1 } });
  /** Volta do Facebook Login com um `code` do mock e um state recém-assinado (a URL do connect traz os dois). */
  const callbackWith = async (code: string) => {
    const c = await call('POST', '/meta/connect', users.owner.token, { returnTo: '/settings' });
    expect(c.status).toBe(201);
    const url = new URL(c.data.url);
    url.searchParams.set('code', code);
    const r = await fetch(url, { redirect: 'manual' });
    return { status: r.status, location: new URL(r.headers.get('location')!) };
  };

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    fake = new FakeMetaService({ publicApiUrl: process.env.PUBLIC_API_URL!, jwtSecret: process.env.JWT_ACCESS_SECRET || 'mock-secret', rule: ruleFromEnv(), stepMs: 0 });
    const fakePage: PageCapturePort = { capture: async () => ({ error: 'PAGE_UNREADABLE', status: null }) };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(META_SERVICE).useValue(fake)
      .overrideProvider(PAGE_CAPTURE).useValue(fakePage)
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT);
    tokenKey = tokenKeyOf(app.get(AppConfig));

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'admin', 'member', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Meta ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    const role = (k: Who): 'OWNER' | 'ADMIN' | 'MEMBER' | 'CLIENT' => (k === 'owner' ? 'OWNER' : k === 'admin' ? 'ADMIN' : k === 'member' ? 'MEMBER' : 'CLIENT');
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}loja`, shortCode: 'MC', businessType: 'ONLINE_STORE', market: 'United States', websiteUrl: 'https://example.com', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: (['owner', 'admin', 'member', 'client'] as Who[]).map((k) => ({ userId: users[k].id, role: role(k), tourCompletedAt: new Date() })) },
      },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.data.accessToken;
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Sheets', language: 'en', what: 'Bamboo sheets', promise: 'Sleep cooler', sourceUrl: 'https://example.com/sheets', createdById: users.owner.id } })).id;
    // criativo APPROVED com render final (o arquivo só precisa existir na tabela: o mock não baixa o vídeo)
    const c = await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Hook A', language: 'en', state: 'APPROVED', approvedAt: new Date(), approvedById: users.owner.id, adName: `MC_NEW_1021_A_${RUN}`, createdById: users.owner.id } });
    const file = await prisma.file.create({ data: { workspaceId: w1, kind: 'RENDER_VIDEO', storageKey: `ws/${w1}/render_video/${RUN}.mp4`, mimeType: 'video/mp4', sizeBytes: 1_000_000, durationSec: 20, width: 1080, height: 1920 } });
    const render = await prisma.render.create({ data: { workspaceId: w1, creativeId: c.id, status: 'READY', settings: {}, input: {}, fileId: file.id, durationSec: 20 } });
    await prisma.creative.update({ where: { id: c.id }, data: { finalRenderId: render.id } });
    creativeId = c.id;
  });

  afterAll(async () => {
    await prisma.creative.updateMany({ where: { workspaceId: w1 }, data: { finalRenderId: null, selectedFaceId: null, selectedScriptId: null, thumbnailFileId: null } });
    await prisma.workspace.deleteMany({ where: { id: w1 } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  // ───────── §3.1 conexão ─────────

  it('connect: CLIENT e MEMBER 403; OWNER 201 com a URL do callback (mock) e expiresAt', async () => {
    expect((await call('POST', '/meta/connect', users.client.token, {})).status).toBe(403);
    expect((await call('POST', '/meta/connect', users.member.token, {})).status).toBe(403);
    const r = await call('POST', '/meta/connect', users.owner.token, { returnTo: '/onboarding/meta' });
    expect(r.status).toBe(201);
    expect(r.data.url).toContain(`/api/v1/meta/callback?code=mock&state=`);
    expect(r.data.expiresAt).toEqual(expect.any(String));
    expect((await call('POST', '/meta/connect', users.owner.token, { returnTo: '/x' })).status).toBe(400);
    // QA rodada 2 item 6: Settings › Connections manda returnTo '/settings/connections' (§3.1, ajuste 21/10); '/settings' segue como alias
    const sc = await call('POST', '/meta/connect', users.owner.token, { returnTo: '/settings/connections' });
    expect(sc.status).toBe(201);
    // §3.1 (22/10) "Connect from another browser": status pending até o callback; todos os papéis leem (CLIENT inclusive)
    const st = await call('GET', '/meta/oauth/status', users.client.token);
    expect(st.status).toBe(200);
    expect(st.data).toEqual({ pending: true, expiresAt: sc.data.expiresAt, lastError: null, connectedAt: null });
    expect((await call('POST', '/meta/connect', users.owner.token, { returnTo: '/settings' })).status).toBe(201);
    const back = await fetch(sc.data.url.replace('code=mock', 'code=mock-denied'), { redirect: 'manual' });
    const loc = new URL(back.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(`${WEB}/settings/connections`);
    expect(loc.searchParams.get('code')).toBe('META_OAUTH_DENIED');
    expect((await call('GET', '/meta/oauth/status', users.member.token)).data).toMatchObject({ pending: false, lastError: { code: 'META_OAUTH_DENIED', missing: [], at: expect.any(String) }, connectedAt: null });
    expect((await call('GET', '/meta/connection', users.client.token)).data).toBeNull();
  });

  it('callback: os códigos de redirect do §3.4 (denied, scopes+missing, failed, state inválido); nada gravado', async () => {
    expect((await callbackWith('mock-denied')).location.searchParams.get('code')).toBe('META_OAUTH_DENIED');
    const scopes = (await callbackWith('mock-scopes')).location;
    expect(scopes.searchParams.get('code')).toBe('META_SCOPES_MISSING');
    expect(scopes.searchParams.get('missing')).toBe('ads_management');
    expect(scopes.pathname).toBe('/settings');
    expect((await call('GET', '/meta/oauth/status', users.owner.token)).data.lastError).toMatchObject({ code: 'META_SCOPES_MISSING', missing: ['ads_management'] });
    expect((await callbackWith('mock-failed')).location.searchParams.get('code')).toBe('META_OAUTH_FAILED');
    const bad = await fetch(`${base}/meta/callback?code=mock&state=abc.def.ghi`, { redirect: 'manual' });
    expect(bad.status).toBe(302);
    const badUrl = new URL(bad.headers.get('location')!);
    expect(badUrl.searchParams.get('code')).toBe('META_STATE_INVALID');
    expect(badUrl.pathname).toBe('/onboarding/meta');
    expect(await conn()).toBeNull();
    // state inválido não tem workspace: o status do último connect válido (mock-failed) fica como está
    expect((await call('GET', '/meta/oauth/status', users.owner.token)).data).toMatchObject({ pending: false, lastError: { code: 'META_OAUTH_FAILED' } });
  });

  it('callback ok: 302 ?meta=connected; token cifrado no banco (decifra = "mock") e nunca na resposta', async () => {
    const r = await callbackWith('mock');
    expect(r.status).toBe(302);
    expect(r.location.origin + r.location.pathname).toBe(`${WEB}/settings`);
    expect(r.location.searchParams.get('meta')).toBe('connected');
    const c = (await conn())!;
    expect((await call('GET', '/meta/oauth/status', users.client.token)).data).toEqual({ pending: false, expiresAt: expect.any(String), lastError: null, connectedAt: c.connectedAt.toISOString() });
    expect(c.status).toBe('ACTIVE');
    expect(c.tokenCiphertext).not.toBe('mock');
    expect(decifrar(c.tokenCiphertext!, tokenKey)).toMatch(/^mock\.[0-9a-f]{12}$/); // um token mock por conexão (escopo das escritas mock)
    expect(c.connectedById).toBe(users.owner.id);
    const view = await call('GET', '/meta/connection', users.client.token);
    expect(view.status).toBe(200);
    expect(view.data).toMatchObject({ status: 'ACTIVE', user: { id: 'mock_user' }, adAccount: null, page: null, health: null, syncing: false, connectedBy: { id: users.owner.id } });
    expect(JSON.stringify(view.data)).not.toMatch(/accessToken|ciphertext|:"mock(\.[0-9a-f]+)?"/); // o token em claro é "mock.<hex>" no mock
    expect(view.data.scopes).toContain('ads_management');
  });

  it('options: 3 contas (act_mock_3 sem permissão), 1 página, pixels só com a conta; ADMIN pode, MEMBER não', async () => {
    const r = await call('GET', '/meta/options', users.admin.token);
    expect(r.status).toBe(200);
    expect(r.data.adAccounts.map((a: any) => [a.id, a.canManage, a.permissionReason])).toEqual([['act_mock_1', true, null], ['act_mock_2', true, null], ['act_mock_3', false, 'no_advertise_task']]);
    expect(r.data.pages).toEqual([{ id: 'page_mock', name: 'Mock Page' }]);
    expect(r.data.pixels).toEqual([]);
    const withPixels = await call('GET', '/meta/options?adAccountId=act_mock_1', users.admin.token);
    expect(withPixels.data.pixels).toHaveLength(1);
    expect((await call('GET', '/meta/options', users.member.token)).status).toBe(403);
  });

  it('selection: conta sem canManage = 422 META_PERMISSION; conta fora das opções = 404; conta desativada = health account bad', async () => {
    const perm = await call('PUT', '/meta/selection', users.owner.token, { adAccountId: 'act_mock_3', pageId: 'page_mock' });
    expect(perm.status).toBe(422);
    expect(perm.error).toMatchObject({ code: 'META_PERMISSION', details: { adAccountId: 'act_mock_3', reason: 'no_advertise_task' } });
    expect((await call('PUT', '/meta/selection', users.owner.token, { adAccountId: 'act_nope', pageId: 'page_mock' })).status).toBe(404);
    expect((await call('PUT', '/meta/selection', users.owner.token, { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_nope' })).status).toBe(404);

    const disabled = await call('PUT', '/meta/selection', users.admin.token, { adAccountId: 'act_mock_2', pageId: 'page_mock' });
    expect(disabled.status).toBe(200);
    expect(disabled.data.adAccount).toMatchObject({ id: 'act_mock_2', currency: 'BRL', accountStatus: 2 });
    expect(disabled.data.health.canPublish).toBe(false);
    expect(disabled.data.health.checks.find((c: any) => c.key === 'account')).toMatchObject({ level: 'bad' });
    // publicar com a conta desativada = 422 META_ACCOUNT_UNUSABLE
    const pub = await call('POST', `/creatives/${creativeId}/meta/publish`, users.owner.token, { dailyBudgetMinor: 1000, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com' });
    expect(pub.status).toBe(422);
    expect(pub.error).toMatchObject({ code: 'META_ACCOUNT_UNUSABLE', details: { accountStatus: 2 } });
    // CLIENT lê a conexão, mas não escolhe
    expect((await call('PUT', '/meta/selection', users.client.token, { adAccountId: 'act_mock_1', pageId: 'page_mock' })).status).toBe(403);
  });

  it('selection boa: health ok (pixel ok, verified warn, canPublish), 1º sync disparado, snapshots com 2 WINNER e os trends do mock', async () => {
    const r = await call('PUT', '/meta/selection', users.owner.token, { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ adAccount: { id: 'act_mock_1', currency: 'USD', accountStatus: 1 }, page: { id: 'page_mock' }, pixel: { id: 'pix_mock' } });
    expect(r.data.health.checks.filter((c: any) => c.level === 'bad').map((c: any) => `${c.key}: ${c.detail ?? c.message ?? ''}`)).toEqual([]);
    expect(r.data.health).toMatchObject({ level: 'warn', canPublish: true });
    expect(r.data.health.checks.find((c: any) => c.key === 'verified').level).toBe('warn');
    expect(r.data.health.checks.find((c: any) => c.key === 'pixel').level).toBe('ok');
    expect(r.data.health).not.toHaveProperty('_account');
    // onboarding-v2: a seleção conta como "mexeu no setup" só em SETUP; aqui o workspace já é LIVE
    expect((await call('GET', '/workspace', users.owner.token)).data.onboarding.steps.find((s: any) => s.key === 'meta').state).toBe('done');

    const c = (await conn())!;
    expect(c.lastSyncJobId).toEqual(expect.any(String));
    const job = await jobDone(c.lastSyncJobId!, users.owner.token);
    expect(job.data).toMatchObject({ type: 'META_SYNC', status: 'SUCCEEDED' });
    expect(job.data.checklist.map((s: any) => s.key)).toEqual(['listing_campaigns', 'listing_adsets', 'listing_ads', 'reading_insights', 'scoring']); // campanhas-v1 §4
    // QA rodada 2 item 9: "Sync now" logo depois de um sync concluído (aqui o 1º, automático) = 429 com o tempo que falta pros 5 min
    // (há 2 jobs META_SYNC no workspace: o da conta desativada do teste anterior e este; o 429 não pode criar um 3º)
    const jobsBefore = await prisma.job.count({ where: { workspaceId: w1, type: 'META_SYNC' } });
    expect(jobsBefore).toBeGreaterThanOrEqual(2); // 3 se o sync da conta velha ainda rodava na troca (guard account_changed dispara o da nova)
    const tooSoon = await call('POST', '/meta/sync', users.owner.token, {});
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.error).toMatchObject({ code: 'RATE_LIMITED' });
    expect(tooSoon.error.details.retryAfterSec).toBeGreaterThan(0);
    expect(tooSoon.error.details.retryAfterSec).toBeLessThanOrEqual(300);
    expect(await prisma.job.count({ where: { workspaceId: w1, type: 'META_SYNC' } })).toBe(jobsBefore); // o 429 não cria nem enfileira job
    expect((await conn())!.adAccountId).toBe('act_mock_1');
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1, adAccountId: 'act_mock_2' } })).toBe(0); // nada da conta velha sobrou

    const ads = await call('GET', '/meta/ads', users.client.token);
    expect(ads.status).toBe(200);
    expect(ads.data).toHaveLength(8);
    // QA ME-01: o cartão de saúde reflete o sync sem "Check again" (lastHealth.adsCount/activeCount gravados pelo META_SYNC)
    const activeN = ads.data.filter((a: any) => a.effectiveStatus === 'ACTIVE').length;
    expect(activeN).toBeGreaterThan(0);
    expect((await call('GET', '/meta/connection', users.client.token)).data.health).toMatchObject({ adsCount: 8, activeCount: activeN });
    // §3.1 health = todos os papéis, inclusive CLIENT (@ClientAllowed)
    const clientHealth = await call('POST', '/meta/health', users.client.token, {});
    expect(clientHealth.status).toBe(200);
    expect(clientHealth.data).toMatchObject({ canPublish: true, adsCount: 8, activeCount: activeN });
    expect(ads.data.slice(0, 2).map((a: any) => [a.metaAdId, a.verdict, a.trend])).toEqual([['mock_ad_1', 'WINNER', 'WORKING'], ['mock_ad_2', 'WINNER', 'STEADY']]);
    const by = Object.fromEntries(ads.data.map((a: any) => [a.metaAdId, a]));
    expect(by.mock_ad_3).toMatchObject({ verdict: 'OK', trend: 'TIRING' });
    expect(by.mock_ad_5.trend).toBeNull();
    expect(by.mock_ad_6.trend).toBeNull();
    expect(by.mock_ad_7.effectiveStatus).toBe('DISAPPROVED');
    expect(by.mock_ad_1.daysRunning).toBe(40);
    expect(by.mock_ad_1).toMatchObject({ creative: null, championId: null });
    expect(ads.meta.summary).toMatchObject({ period: '30d', currency: 'USD', adsCount: 8, winnersCount: 2, tiringCount: 1, eligibleCount: 4, medianCpa: 27.375, rule: { minSpendUsd: 50, minResults: 3 }, sync: { state: 'ok', progress: null } });
    expect(ads.meta.summary.newThisWeek).toBe(2);

    const winners = await call('GET', '/meta/ads?verdict=WINNER&limit=1', users.owner.token);
    expect(winners.data).toHaveLength(1);
    expect(winners.data[0].metaAdId).toBe('mock_ad_1');
    expect(winners.meta.nextCursor).toEqual(expect.any(String));
    const page2 = await call('GET', `/meta/ads?verdict=WINNER&limit=1&cursor=${encodeURIComponent(winners.meta.nextCursor)}`, users.owner.token);
    expect(page2.data[0].metaAdId).toBe('mock_ad_2');
    expect(page2.meta.nextCursor).toBeNull();
    expect((await call('GET', '/meta/ads?sort=cpa', users.owner.token)).data[0].metaAdId).toBe('mock_ad_novideo'); // cpa 5 (menor primeiro)
    expect((await call('GET', '/meta/ads?q=demo', users.owner.token)).data.map((a: any) => a.metaAdId)).toEqual(['mock_ad_3']);
    // o tour ganha a parada iterate (onboarding-v2 D6)
    expect((await call('GET', '/workspace/tour', users.owner.token)).data.stops).toContain('iterate');
  });

  it('summary: 7d com prev; 30d sem prev; stale com relógio 13 h atrás; sync manual 2x = 429; CLIENT não sincroniza', async () => {
    const d30 = await call('GET', '/meta/summary', users.member.token);
    expect(d30.status).toBe(200);
    expect(d30.data).toMatchObject({ period: '30d', prev: null, spend: 1510, results: 67 });
    expect(d30.data.cpa).toBeCloseTo(22.54, 2);
    const d7 = await call('GET', '/meta/summary?period=7d', users.member.token);
    expect(d7.data).toMatchObject({ period: '7d', spend: 498, results: 24 });
    expect(d7.data.prev).toMatchObject({ spend: 390 });
    expect(d7.data.prev.cpa).toBeCloseTo(390 / 21, 2);
    expect((await call('GET', '/meta/summary?period=1d', users.member.token)).status).toBe(400);

    await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { lastSyncAt: new Date(Date.now() - 13 * 3_600_000) } });
    expect((await call('GET', '/meta/summary', users.owner.token)).data.sync.state).toBe('stale');

    expect((await call('POST', '/meta/sync', users.client.token, {})).status).toBe(403);
    const s1 = await call('POST', '/meta/sync', users.member.token, {});
    expect([200, 202]).toContain(s1.status);
    await jobDone(s1.data.job.id, users.member.token);
    const s2 = await call('POST', '/meta/sync', users.member.token, {});
    expect(s2.status).toBe(429);
    expect(s2.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: expect.any(Number) } });
    expect((await call('GET', '/meta/summary', users.owner.token)).data.sync.state).toBe('ok');
    // substituído inteiro, não acumulado; campanhas-v1 D2: o snapshot guarda as 2 imagens do mock, a Home segue com os 8 vídeos
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1 } })).toBe(10);
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1, videoId: { not: null } } })).toBe(8);
    expect((await call('GET', '/meta/summary', users.owner.token)).data.adsCount).toBe(8);
  });

  // ───────── §3.2 Pick from Meta (D13) ─────────

  it('POST /iterate { metaAdId }: campeão OWN com metaAdId/sources META, vídeo baixado, lote avança; repetir reaproveita; 404 fora do snapshot; CLIENT 403', async () => {
    expect((await call('POST', '/iterate', users.client.token, { metaAdId: 'mock_ad_1' })).status).toBe(403);
    expect((await call('POST', '/iterate', users.member.token, { metaAdId: 'mock_ad_999' })).status).toBe(404);
    const both = await call('POST', '/iterate', users.member.token, { metaAdId: 'mock_ad_1', creativeId: creativeId });
    expect(both.status).toBe(400);
    expect(both.error.details.fields[0].rule).toBe('exactlyOneOf:uploadId,creativeId,metaAdId,championId');

    const r = await call('POST', '/iterate', users.member.token, { metaAdId: 'mock_ad_1' });
    expect(r.status).toBe(202);
    expect(r.data).toMatchObject({ status: 'ANALYZING', source: { fromMeta: true, fromLibrary: false, name: 'Hook A — the pain' } });
    const championId = r.data.source.championId as string;
    const row0 = await prisma.champion.findUniqueOrThrow({ where: { id: championId } });
    expect(row0).toMatchObject({ rights: 'OWN', metaAdId: 'mock_ad_1', metaAdAccountId: 'act_mock_1', status: 'RESOLVING' });
    const importJob = await prisma.job.findFirstOrThrow({ where: { championId, type: 'META_IMPORT' } });
    const done = await jobDone(importJob.id, users.member.token);
    expect(done.data).toMatchObject({ status: 'SUCCEEDED', checklist: [{ key: 'fetching_video', done: true }, { key: 'downloading_video', done: true }] });
    const champ = await until(() => call('GET', `/champions/${championId}`, users.member.token), (x) => ['READY', 'FAILED'].includes(x.data?.status), 300_000);
    expect(champ.data.status).toBe('READY');
    expect(champ.data.sources).toEqual(['META']);
    expect(champ.data.metaAd).toEqual({ adId: 'mock_ad_1', adAccountId: 'act_mock_1' });
    expect(champ.data.video?.mimeType).toBe('video/mp4');
    expect(champ.data.thumbnail).not.toBeNull();
    const batch = await until(() => call('GET', `/iterate/${r.data.id}`, users.member.token), (x) => !!x.data && !['ANALYZING', 'PLANNING'].includes(x.data.status), 300_000);
    expect(['PLAN_READY', 'ANALYSIS_FAILED']).toContain(batch.data.status);
    // a lista marca o anúncio como já importado
    const ads = await call('GET', '/meta/ads?verdict=WINNER&limit=1', users.owner.token);
    expect(ads.data[0].championId).toBe(championId);

    const again = await call('POST', '/iterate', users.member.token, { metaAdId: 'mock_ad_1' });
    expect(again.status).toBe(202);
    expect(again.data.source.championId).toBe(championId);
    expect(await prisma.champion.count({ where: { workspaceId: w1, metaAdId: 'mock_ad_1' } })).toBe(1);
    await until(() => call('GET', `/iterate/${again.data.id}`, users.member.token), (x) => !!x.data && !['ANALYZING', 'PLANNING'].includes(x.data.status), 300_000);
  });

  it('POST /iterate { metaAdId: mock_ad_novideo }: campeão FAILED META_VIDEO_UNAVAILABLE (action upload_video), lote ANALYSIS_FAILED', async () => {
    const r = await call('POST', '/iterate', users.owner.token, { metaAdId: 'mock_ad_novideo' });
    expect(r.status).toBe(202);
    const championId = r.data.source.championId as string;
    const champ = await until(() => call('GET', `/champions/${championId}`, users.owner.token), (x) => ['READY', 'FAILED'].includes(x.data?.status));
    expect(champ.data).toMatchObject({ status: 'FAILED', errorCode: 'META_VIDEO_UNAVAILABLE', action: 'upload_video', sources: ['META'] });
    const batch = await until(() => call('GET', `/iterate/${r.data.id}`, users.owner.token), (x) => !!x.data && x.data.status !== 'ANALYZING');
    expect(batch.data.status).toBe('ANALYSIS_FAILED');
    expect(batch.data.error).toMatchObject({ code: 'META_VIDEO_UNAVAILABLE', stage: 'reading' });
  });

  // ───────── §3.3 publicação ─────────

  it('GET /creatives/:id/meta: defaults (objetivo pelo businessType, país do market, nome = adName, link da oferta) e conexão', async () => {
    const r = await call('GET', `/creatives/${creativeId}/meta`, users.client.token);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      publication: null, history: [], connection: { status: 'ACTIVE', canPublish: true },
      defaults: { objective: 'OUTCOME_SALES', objectiveReason: 'business_type', countries: ['US'], ageMin: 18, ageMax: 65, dailyBudgetMinor: 500, currency: 'USD', page: { id: 'page_mock' }, pixel: { id: 'pix_mock' }, name: `MC_NEW_1021_A_${RUN}`, callToAction: 'SHOP_NOW', link: 'https://example.com/sheets', primaryText: 'Sleep cooler', headline: 'Bamboo sheets' },
    });
  });

  it('publish: 422 META_BUDGET_TOO_LOW / META_PIXEL_REQUIRED, 403 CLIENT, 409 not_approved; job falha em creating_creative com META_POLICY (ids anteriores gravados)', async () => {
    const body = { dailyBudgetMinor: 1000, countries: ['US'], primaryText: 'Sleep cooler tonight', headline: 'Bamboo', callToAction: 'SHOP_NOW', link: 'https://example.com/sheets' };
    expect((await call('POST', `/creatives/${creativeId}/meta/publish`, users.client.token, body)).status).toBe(403);
    const low = await call('POST', `/creatives/${creativeId}/meta/publish`, users.member.token, { ...body, dailyBudgetMinor: 100 });
    expect(low.status).toBe(422);
    expect(low.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500, currency: 'USD' } });
    // sem pixel escolhido, objetivo SALES pedido = 422 META_PIXEL_REQUIRED (D8; sem objetivo no corpo o default já é TRAFFIC)
    await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { pixelId: null, pixelName: null } });
    const nopix = await call('POST', `/creatives/${creativeId}/meta/publish`, users.member.token, { ...body, objective: 'OUTCOME_SALES' });
    expect(nopix.status).toBe(422);
    expect(nopix.error).toMatchObject({ code: 'META_PIXEL_REQUIRED', details: { objective: 'OUTCOME_SALES' } });
    expect((await call('GET', `/creatives/${creativeId}/meta`, users.member.token)).data.defaults).toMatchObject({ objective: 'OUTCOME_TRAFFIC', objectiveReason: 'no_pixel', callToAction: 'LEARN_MORE' });
    await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { pixelId: 'pix_mock', pixelName: 'Mock Pixel' } });
    // criativo que não está APPROVED
    const draft = await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Draft', language: 'en', state: 'EDIT_PENDING', createdById: users.owner.id } });
    const na = await call('POST', `/creatives/${draft.id}/meta/publish`, users.member.token, body);
    expect(na.status).toBe(409);
    expect(na.error.details).toMatchObject({ reason: 'not_approved' });

    const r = await call('POST', `/creatives/${creativeId}/meta/publish`, users.member.token, { ...body, primaryText: 'Sleep cooler [mock:meta-policy]' });
    expect(r.status).toBe(202);
    expect(r.data).toMatchObject({ status: 'PUBLISHING', creativeId, adAccountId: 'act_mock_1', job: { type: 'META_PUBLISH' }, settings: { objective: 'OUTCOME_SALES', dailyBudgetMinor: 1000, specialAdCategories: [], ageMin: 18, ageMax: 65 } });
    expect((await call('POST', `/creatives/${creativeId}/meta/publish`, users.member.token, body)).error?.details).toMatchObject({ reason: 'publish_in_progress' });
    const failed = await until(() => call('GET', `/creatives/${creativeId}/meta`, users.member.token), (x) => x.data?.publication?.status !== 'PUBLISHING');
    expect(failed.data.publication).toMatchObject({ status: 'FAILED', errorCode: 'META_POLICY', action: 'edit_ad_text', ids: { videoId: expect.any(String), campaignId: expect.any(String), adsetId: expect.any(String), creativeId: null, adId: null } });
    expect(failed.data.publication.failReason).toContain('Advertising Policies');
    expect(failed.data.publication.job).toMatchObject({ status: 'FAILED', errorCode: 'META_POLICY', action: 'edit_ad_text' });
    const row = await prisma.metaPublication.findUniqueOrThrow({ where: { id: failed.data.publication.id } });
    expect(row.failedStage).toBe('creating_creative');
    expect(row.failDetail).toContain('1815');
  });

  it('retry retoma dos ids gravados sem duplicar (vídeo e campanha não sobem de novo) → PAUSED com snapshot zerado', async () => {
    const before = await prisma.metaPublication.findFirstOrThrow({ where: { creativeId }, orderBy: { createdAt: 'desc' } });
    // o usuário corrige o texto (no app: PATCH do criativo + publicar de novo; aqui só tiramos o gatilho do mock)
    await prisma.metaPublication.update({ where: { id: before.id }, data: { settings: { ...(before.settings as object), primaryText: 'Sleep cooler tonight' } } });
    const upload = jest.spyOn(fake, 'uploadVideo');
    const campaign = jest.spyOn(fake, 'createCampaign');
    const adset = jest.spyOn(fake, 'createAdSet');
    expect((await call('POST', `/creatives/${creativeId}/meta/retry`, users.client.token, {})).status).toBe(403);
    const r = await call('POST', `/creatives/${creativeId}/meta/retry`, users.member.token, {});
    expect(r.status).toBe(202);
    expect(r.data.id).toBe(before.id);
    const done = await until(() => call('GET', `/creatives/${creativeId}/meta`, users.member.token), (x) => x.data?.publication?.status !== 'PUBLISHING');
    expect(done.data.publication).toMatchObject({ status: 'PAUSED', errorCode: null, action: null, adsManagerUrl: '#', ids: { videoId: before.videoId, campaignId: before.campaignId, adsetId: before.adsetId, creativeId: expect.any(String), adId: expect.any(String) } });
    expect(done.data.publication.publishedAt).toEqual(expect.any(String));
    expect(upload).not.toHaveBeenCalled();
    expect(campaign).not.toHaveBeenCalled();
    expect(adset).not.toHaveBeenCalled();
    expect(done.data.publication.job.checklist.every((s: any) => s.done)).toBe(true);
    expect(done.data.history).toEqual([]); // §3.3 (21/10 pós-QA): history = só as anteriores; na 1ª publicação é vazio
    expect((await call('POST', `/creatives/${creativeId}/meta/retry`, users.member.token, {})).status).toBe(409);
    // o anúncio novo já aparece na lista (métricas zeradas, ligado ao criativo)
    const ads = await call('GET', '/meta/ads', users.owner.token);
    const mine = ads.data.find((a: any) => a.metaAdId === done.data.publication.ids.adId);
    expect(mine).toMatchObject({ effectiveStatus: 'PAUSED', verdict: 'LOW_DATA', metrics: { spend: 0 }, creative: { id: creativeId, adName: `MC_NEW_1021_A_${RUN}` } });
    expect(done.data.publication.metrics).toMatchObject({ spend: 0 });
    expect(await prisma.metaPublication.count({ where: { creativeId } })).toBe(1); // retry não cria outra linha
  });

  it('activate só OWNER/ADMIN (ACTIVE + activatedAt); pause; lista de publicações', async () => {
    expect((await call('POST', `/creatives/${creativeId}/meta/activate`, users.member.token, { confirm: true })).status).toBe(403);
    expect((await call('POST', `/creatives/${creativeId}/meta/activate`, users.admin.token, { confirm: false })).status).toBe(400);
    // campanhas-v1 §10.1: anúncio reprovado (DISAPPROVED/WITH_ISSUES) não ativa pela tela Send
    const pubAd = (await prisma.metaPublication.findFirstOrThrow({ where: { creativeId }, orderBy: { createdAt: 'desc' } })).metaAdId!;
    await prisma.metaAdSnapshot.updateMany({ where: { workspaceId: w1, metaAdId: pubAd }, data: { effectiveStatus: 'DISAPPROVED' } });
    const pol = await call('POST', `/creatives/${creativeId}/meta/activate`, users.admin.token, { confirm: true });
    expect(pol.status).toBe(422);
    expect(pol.error).toMatchObject({ code: 'META_POLICY', details: { effectiveStatus: 'DISAPPROVED' } });
    // campanhas-v1 §11: a trava entra no History como BLOCKED (source PUBLISH), sem escrita na Meta
    expect(await prisma.metaChange.findFirst({ where: { workspaceId: w1, objectId: pubAd }, orderBy: { createdAt: 'desc' } }))
      .toMatchObject({ result: 'BLOCKED', errorCode: 'META_POLICY', source: 'PUBLISH', fromValue: 'PAUSED', toValue: 'ACTIVE' });
    await prisma.metaAdSnapshot.updateMany({ where: { workspaceId: w1, metaAdId: pubAd }, data: { effectiveStatus: 'PAUSED' } });
    const on = await call('POST', `/creatives/${creativeId}/meta/activate`, users.admin.token, { confirm: true });
    expect(on.status).toBe(200);
    expect(on.data).toMatchObject({ status: 'ACTIVE', activatedAt: expect.any(String) });
    expect((await call('POST', `/creatives/${creativeId}/meta/activate`, users.admin.token, { confirm: true })).status).toBe(409);
    const off = await call('POST', `/creatives/${creativeId}/meta/pause`, users.owner.token, {});
    expect(off.data.status).toBe('PAUSED');
    // campanhas-v1 §4: activate/pause da tela Send deixam rastro (MetaChange source PUBLISH; ativar registra os pais ligados junto)
    const adId = on.data.ids.adId;
    const trail = await prisma.metaChange.findMany({ where: { workspaceId: w1, objectId: adId }, orderBy: { createdAt: 'asc' } });
    expect(trail.map((c) => [c.source, c.fromValue, c.toValue, c.result, c.alsoChanged.length])).toEqual([['PUBLISH', 'PAUSED', 'ACTIVE', 'BLOCKED', 0], ['PUBLISH', 'PAUSED', 'ACTIVE', 'APPLIED', 2], ['PUBLISH', 'ACTIVE', 'PAUSED', 'APPLIED', 0]]);
    const list = await call('GET', '/meta/publications?limit=6', users.client.token);
    expect(list.status).toBe(200);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ creativeId, status: 'PAUSED' });
    expect(list.meta).toEqual({ nextCursor: null });
    expect((await call('GET', '/meta/publications?status=ACTIVE', users.client.token)).data).toHaveLength(0);
  });

  it('gatilho [mock:meta-token] na publicação: FAILED META_TOKEN_INVALID (reconnect_meta) e a conexão vira TOKEN_INVALID → 422 nas rotas', async () => {
    const c2 = await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Hook B', language: 'en', state: 'APPROVED', approvedAt: new Date(), adName: `MC_NEW_1021_B_${RUN}`, createdById: users.owner.id } });
    const file = await prisma.file.create({ data: { workspaceId: w1, kind: 'RENDER_VIDEO', storageKey: `ws/${w1}/render_video/${RUN}-b.mp4`, mimeType: 'video/mp4', sizeBytes: 1000, durationSec: 15 } });
    const render = await prisma.render.create({ data: { workspaceId: w1, creativeId: c2.id, status: 'READY', settings: {}, input: {}, fileId: file.id } });
    await prisma.creative.update({ where: { id: c2.id }, data: { finalRenderId: render.id } });
    const r = await call('POST', `/creatives/${c2.id}/meta/publish`, users.owner.token, { dailyBudgetMinor: 1000, countries: ['US'], primaryText: 'x [mock:meta-token]', callToAction: 'SHOP_NOW', link: 'https://example.com' });
    expect(r.status).toBe(202);
    const failed = await until(() => call('GET', `/creatives/${c2.id}/meta`, users.owner.token), (x) => x.data?.publication?.status !== 'PUBLISHING');
    expect(failed.data.publication).toMatchObject({ status: 'FAILED', errorCode: 'META_TOKEN_INVALID', action: 'reconnect_meta' });
    expect((await conn())!.status).toBe('TOKEN_INVALID');
    expect((await call('GET', '/meta/options', users.owner.token)).error?.code).toBe('META_TOKEN_INVALID');
    expect((await call('POST', `/creatives/${c2.id}/meta/retry`, users.owner.token, {})).error?.code).toBe('META_TOKEN_INVALID');
    // leitura dos snapshots continua
    // Gusta 25/10: dado de anúncio só com a conexão saudável: login vencido = 422 também na leitura
    expect((await call('GET', '/meta/ads', users.owner.token)).error).toMatchObject({ code: 'META_TOKEN_INVALID' });
    // reconectar pelo callback volta a ACTIVE e mantém a seleção (mesmo usuário da Meta)
    expect((await callbackWith('mock')).location.searchParams.get('meta')).toBe('connected');
    expect((await conn())!).toMatchObject({ status: 'ACTIVE', adAccountId: 'act_mock_1', pageId: 'page_mock' });
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1 } })).toBeGreaterThan(0);
  });

  it('disconnect: token apagado, snapshots apagados, publicações ficam; depois 422 META_NOT_CONNECTED; MEMBER 403', async () => {
    expect((await call('DELETE', '/meta/connection', users.member.token)).status).toBe(403);
    const r = await call('DELETE', '/meta/connection', users.owner.token);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true });
    const c = (await conn())!;
    expect(c).toMatchObject({ status: 'DISCONNECTED', tokenCiphertext: null });
    expect(c.disconnectedAt).not.toBeNull();
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1 } })).toBe(0);
    expect(await prisma.metaPublication.count({ where: { workspaceId: w1 } })).toBe(2);
    expect((await call('GET', '/meta/ads', users.owner.token)).error?.code).toBe('META_NOT_CONNECTED');
    expect((await call('GET', '/meta/summary', users.owner.token)).error?.code).toBe('META_NOT_CONNECTED');
    expect((await call('POST', '/meta/health', users.owner.token, {})).error?.code).toBe('META_NOT_CONNECTED');
    expect((await call('POST', '/iterate', users.owner.token, { metaAdId: 'mock_ad_1' })).error?.code).toBe('META_NOT_CONNECTED');
    expect((await call('DELETE', '/meta/connection', users.owner.token)).status).toBe(404);
    expect((await call('GET', `/creatives/${creativeId}/meta`, users.owner.token)).data).toMatchObject({ connection: null, defaults: null });
    expect((await call('GET', '/meta/connection', users.owner.token)).data.status).toBe('DISCONNECTED');
    expect((await call('GET', '/workspace/tour', users.owner.token)).data.stops).not.toContain('iterate');
  });

  it('META_MODE=off: TODA rota /meta/* e /creatives/:id/meta* = 503 META_NOT_CONFIGURED { reason: off } (QA OFF-01), serviço META desligado, onboarding com 5 passos', async () => {
    const config = app.get(AppConfig);
    Object.defineProperty(config, 'metaMode', { get: () => 'off', configurable: true });
    try {
      const routes: [string, string, unknown][] = [
        ['POST', '/meta/connect', {}], ['GET', '/meta/connection', undefined], ['GET', '/meta/options', undefined],
        ['PUT', '/meta/selection', { adAccountId: 'act_mock_1', pageId: 'page_mock' }], ['POST', '/meta/health', {}], ['DELETE', '/meta/connection', undefined],
        ['POST', '/meta/sync', {}], ['GET', '/meta/ads', undefined], ['GET', '/meta/summary', undefined], ['GET', '/meta/publications', undefined],
        ['GET', `/creatives/${creativeId}/meta`, undefined], ['POST', `/creatives/${creativeId}/meta/publish`, { dailyBudgetMinor: 1000, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com' }],
        ['POST', `/creatives/${creativeId}/meta/retry`, {}], ['POST', `/creatives/${creativeId}/meta/activate`, { confirm: true }], ['POST', `/creatives/${creativeId}/meta/pause`, {}],
        // campanhas-v1 §4.1: as rotas da Campaigns também
        ['GET', '/meta/campaigns', undefined], ['GET', '/meta/campaigns/x', undefined], ['GET', '/meta/changes', undefined],
        ['POST', '/meta/campaigns/x/status', { status: 'PAUSED', expected: 'ACTIVE', confirm: true }], ['POST', '/meta/ads/x/status', { status: 'PAUSED', expected: 'ACTIVE', confirm: true }],
        ['PATCH', '/meta/adsets/x/budget', { dailyBudgetMinor: 1000, expectedDailyBudgetMinor: 900, confirm: true }],
      ];
      for (const [method, path, body] of routes) {
        const r = await call(method, path, users.owner.token, body);
        expect([method, path, r.status]).toEqual([method, path, 503]);
        expect(r.error).toMatchObject({ code: 'META_NOT_CONFIGURED', details: { reason: 'off' } });
      }
      // CLIENT também vê o 503 (é o que o web usa pra esconder a Meta), e anônimo continua 401 (AuthGuard antes do MetaModeGuard)
      expect((await call('GET', '/meta/connection', users.client.token)).status).toBe(503);
      expect((await call('GET', '/meta/connection')).status).toBe(401);
      const services = await call('GET', '/workspace/services', users.owner.token);
      expect(services.data.find((s: any) => s.provider === 'META')).toEqual({ provider: 'META', connected: false, keyMasked: null });
      const ws = await call('GET', '/workspace', users.owner.token);
      expect(ws.data.onboarding.steps.find((s: any) => s.key === 'meta').enabled).toBe(false);
      expect(ws.data.onboarding.steps.filter((s: any) => s.enabled)).toHaveLength(5);
    } finally {
      delete (config as any).metaMode;
    }
    expect((await call('GET', '/workspace/services', users.owner.token)).data.find((s: any) => s.provider === 'META')).toEqual({ provider: 'META', connected: true, keyMasked: 'mock' });
  });
});
