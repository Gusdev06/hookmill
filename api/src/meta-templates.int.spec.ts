// meta-templates-v1 (docs/contratos/meta-templates-v1.md, aprovado 29/10: P1 REUSE, P2 orçamento obrigatório, P3 lote)
// contra o maquina_test, porta MetaService em mock (stepMs 0, custo zero): CRUD + regra do padrão → validações (400/422)
// → import (não salva, `unsupported`) → publicar 1 com template (REUSE grava a campanha) → publish-batch 10 com max 8
// (2 ad sets, o 2º belowMin, 1 campanha só, reaproveitada) → ABO/COST_CAP/posicionamentos no payload do fake → retry.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.META_CRON = 'off';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.PUBLIC_MEDIA = 'on';
process.env.THROTTLE_EXPENSIVE_PER_MIN = '100';
const PORT = 3194;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { META_SERVICE, ruleFromEnv } from './integracoes';
import { FakeMetaService } from './integracoes/meta/mock.service';
import { PAGE_CAPTURE, type PageCapturePort } from './iteracao/portas';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);

const RUN = Date.now().toString(36);
const PREFIX = `mtpl-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'member' | 'client';

describe(isLocal ? 'Meta templates v1 (integração local)' : 'Meta templates v1 [pulado: DATABASE_URL não é localhost]', () => {
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
  let fake: FakeMetaService;
  const creatives: string[] = [];
  let tplA: any; // CBO, REUSE, 4–8 (o padrão do Tordan)

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = r.status === 204 || r.status === 302 ? null : await r.json().catch(() => null);
    return { status: r.status, data: json?.data, error: json?.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const settled = (ids: string[]) => until(() => prisma.metaPublication.findMany({ where: { id: { in: ids } } }), (rows) => rows.every((r) => r.status !== 'PUBLISHING'));
  const mkCreative = async (n: number, state: 'APPROVED' | 'EDIT_PENDING' = 'APPROVED') => {
    const c = await prisma.creative.create({ data: { workspaceId: w1, offerId, name: `Hook ${n}`, language: 'en', state, ...(state === 'APPROVED' && { approvedAt: new Date(), approvedById: users.owner.id }), adName: `MC_TPL_${n}_${RUN}`, variationCode: `HEADLINE-${String(n).padStart(2, '0')}`, createdById: users.owner.id } });
    const file = await prisma.file.create({ data: { workspaceId: w1, kind: 'RENDER_VIDEO', storageKey: `ws/${w1}/render_video/${RUN}-${n}.mp4`, mimeType: 'video/mp4', sizeBytes: 1_000_000, durationSec: 20, width: 1080, height: 1920 } });
    const render = await prisma.render.create({ data: { workspaceId: w1, creativeId: c.id, status: 'READY', settings: {}, input: {}, fileId: file.id, durationSec: 20 } });
    await prisma.creative.update({ where: { id: c.id }, data: { finalRenderId: render.id } });
    return c.id;
  };
  const body = (over: { name?: string; isDefault?: boolean; campaign?: object; adset?: object; ad?: object } = {}) => ({
    name: over.name ?? 'Tordan CBO',
    ...(over.isDefault !== undefined && { isDefault: over.isDefault }),
    campaign: { destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 2000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null, specialAdCategories: [], namePattern: 'HookMill — {offer}', ...over.campaign },
    adset: { pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US'], ageMin: 18, ageMax: 65, genders: 'ALL', advantageAudience: true, placements: 'AUTO', adsPerAdset: { min: 4, max: 8 }, namePattern: '{offer} — {date} — {n}', ...over.adset },
    ad: { primaryText: null, headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com/sheets', urlTags: null, namePattern: '{code}', ...over.ad },
  });

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

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'member', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Tpl ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}loja`, shortCode: 'MC', businessType: 'ONLINE_STORE', resultType: 'PURCHASE', market: 'United States', websiteUrl: 'https://example.com', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: (['owner', 'member', 'client'] as Who[]).map((k) => ({ userId: users[k].id, role: k === 'owner' ? 'OWNER' : k === 'member' ? 'MEMBER' : 'CLIENT', tourCompletedAt: new Date() })) },
      },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.data.accessToken;
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Sheets', language: 'en', what: 'Bamboo sheets', promise: 'Sleep cooler', sourceUrl: 'https://example.com/sheets', createdById: users.owner.id } })).id;
    for (let n = 1; n <= 16; n++) creatives.push(await mkCreative(n));

    // conexão mock de verdade: connect → callback → selection (health com mínimo 500 e 1º sync)
    const c = await call('POST', '/meta/connect', users.owner.token, { returnTo: '/settings' });
    expect(c.status).toBe(201);
    const back = await fetch(c.data.url, { redirect: 'manual' });
    expect(new URL(back.headers.get('location')!).searchParams.get('meta')).toBe('connected');
    const sel = await call('PUT', '/meta/selection', users.owner.token, { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(sel.status).toBe(200);
    expect(sel.data.health.canPublish).toBe(true);
    const conn = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    await until(() => prisma.job.findUnique({ where: { id: conn.lastSyncJobId! } }), (j) => !!j && ['SUCCEEDED', 'FAILED'].includes(j.status));
  });

  afterAll(async () => {
    await prisma.creative.updateMany({ where: { workspaceId: w1 }, data: { finalRenderId: null, selectedFaceId: null, selectedScriptId: null, thumbnailFileId: null } });
    await prisma.workspace.deleteMany({ where: { id: w1 } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('CRUD + padrão: o 1º vira padrão, isDefault troca, lista com padrão primeiro, arquivar o padrão promove o mais antigo; CLIENT só lê', async () => {
    expect((await call('GET', '/meta/templates', users.client.token)).data).toEqual([]);
    const a = await call('POST', '/meta/templates', users.member.token, body());
    expect(a.status).toBe(201);
    expect(a.data).toMatchObject({ name: 'Tordan CBO', isDefault: true, source: 'MANUAL', importedFrom: null, adAccountId: 'act_mock_1', reuseCampaignId: null, campaign: { budgetMode: 'CBO', dailyBudgetMinor: 2000 }, adset: { adsPerAdset: { min: 4, max: 8 } } });
    tplA = a.data;
    const b = await call('POST', '/meta/templates', users.owner.token, body({ name: 'B' }));
    expect(b.data.isDefault).toBe(false);
    const c = await call('POST', '/meta/templates', users.owner.token, body({ name: 'C', isDefault: true }));
    expect(c.data.isDefault).toBe(true);
    let list = await call('GET', '/meta/templates', users.client.token);
    expect(list.data.map((t: any) => [t.name, t.isDefault])).toEqual([['C', true], ['Tordan CBO', false], ['B', false]]);

    const pb = await call('PATCH', `/meta/templates/${b.data.id}`, users.member.token, { isDefault: true, name: 'B2' });
    expect(pb.status).toBe(200);
    expect(pb.data).toMatchObject({ name: 'B2', isDefault: true });
    expect((await prisma.metaPublishTemplate.count({ where: { workspaceId: w1, isDefault: true, archivedAt: null } }))).toBe(1);

    expect((await call('POST', '/meta/templates', users.client.token, body())).status).toBe(403);
    expect((await call('PATCH', `/meta/templates/${b.data.id}`, users.client.token, { name: 'x' })).status).toBe(403);
    expect((await call('DELETE', `/meta/templates/${b.data.id}`, users.client.token)).status).toBe(403);

    const del = await call('DELETE', `/meta/templates/${b.data.id}`, users.member.token);
    expect(del.status).toBe(200);
    expect(del.data.isDefault).toBe(false);
    list = await call('GET', '/meta/templates', users.member.token);
    expect(list.data.map((t: any) => [t.name, t.isDefault])).toEqual([['Tordan CBO', true], ['C', false]]); // promoveu o mais antigo
    expect((await call('PATCH', `/meta/templates/${b.data.id}`, users.member.token, { name: 'zumbi' })).status).toBe(404);
    expect((await call('DELETE', `/meta/templates/${c.data.id}`, users.member.token)).status).toBe(200);
    tplA = list.data[0];
  });

  it('validações: adsPerAdset 1 ≤ min ≤ max ≤ 50, cap exige bidAmountMinor, orçamento obrigatório, chave estranha, pixel 422, mínimo 422', async () => {
    const field = async (b: unknown) => {
      const r = await call('POST', '/meta/templates', users.member.token, b);
      expect(r.status).toBe(400);
      return r.error.details.fields.map((f: any) => `${f.field}:${f.rule}`);
    };
    expect(await field(body({ adset: { adsPerAdset: { min: 5, max: 4 } } }))).toEqual(['adset.adsPerAdset:minMax1to50']);
    expect(await field(body({ adset: { adsPerAdset: { min: 0, max: 8 } } }))).toEqual(['adset.adsPerAdset:minMax1to50']);
    expect(await field(body({ adset: { adsPerAdset: { min: 4, max: 51 } } }))).toEqual(['adset.adsPerAdset:minMax1to50']);
    expect(await field(body({ campaign: { bidStrategy: 'COST_CAP' } }))).toEqual(['campaign.bidAmountMinor:requiredForCap']);
    expect(await field(body({ campaign: { bidStrategy: 'BID_CAP', bidAmountMinor: null } }))).toEqual(['campaign.bidAmountMinor:requiredForCap']);
    const noBudget = body();
    delete (noBudget.campaign as any).dailyBudgetMinor;
    expect(await field(noBudget)).toEqual(['campaign.dailyBudgetMinor:isInt']);
    expect(await field(body({ campaign: { foo: 1 } }))).toEqual(['campaign.foo:notAllowed']);
    expect(await field(body({ adset: { placements: { platforms: ['instagram'], positions: ['facebook_feed'] } } }))).toEqual(['adset.placements:isPlacements']);
    expect(await field(body({ adset: { ageMin: 40, ageMax: 30 } }))).toEqual(['adset.ageMax:gteAgeMin']);

    const px = await call('POST', '/meta/templates', users.member.token, body({ campaign: { objective: 'OUTCOME_TRAFFIC' }, adset: { pixelId: null, pixelEvent: 'LEAD' } }));
    expect(px.status).toBe(422);
    expect(px.error).toMatchObject({ code: 'META_PIXEL_REQUIRED' });
    const nopx = await call('POST', '/meta/templates', users.member.token, body({ adset: { pixelId: null, pixelEvent: null } }));
    expect(nopx.error).toMatchObject({ code: 'META_PIXEL_REQUIRED', details: { objective: 'OUTCOME_SALES' } });
    const low = await call('POST', '/meta/templates', users.member.token, body({ campaign: { dailyBudgetMinor: 100 } }));
    expect(low.status).toBe(422);
    expect(low.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500, currency: 'USD' } });
    const lowPatch = await call('PATCH', `/meta/templates/${tplA.id}`, users.member.token, { campaign: { ...tplA.campaign, dailyBudgetMinor: 100 } });
    expect(lowPatch.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW' });
    expect(await prisma.metaPublishTemplate.count({ where: { workspaceId: w1, archivedAt: null } })).toBe(1);
  });

  it('import: campanha CBO do mock vira corpo (CBO 5000, pixel PURCHASE, mulheres, posicionamentos) com unsupported; ad de ABO; nada salvo; 404 GONE', async () => {
    const before = await prisma.metaPublishTemplate.count({ where: { workspaceId: w1 } });
    expect((await call('POST', '/meta/templates/import', users.client.token, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe(403);
    const r = await call('POST', '/meta/templates/import', users.member.token, { level: 'campaign', id: 'mock_cmp_cbo' });
    expect(r.status).toBe(200);
    expect(r.data.template).toMatchObject({
      name: 'Mock — Prospecting (CBO)', importedFrom: { level: 'campaign', id: 'mock_cmp_cbo', name: 'Mock — Prospecting (CBO)' },
      campaign: { destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 5000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null },
      adset: { pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US', 'CA'], ageMin: 25, ageMax: 54, genders: 'FEMALE', advantageAudience: false, adsPerAdset: { min: 4, max: 8 }, placements: { platforms: ['facebook', 'instagram'], positions: ['facebook_feed', 'instagram_stream', 'instagram_story'] } },
      ad: { primaryText: null, callToAction: 'SHOP_NOW', link: 'https://example.com/sheets', urlTags: 'utm_source=facebook&utm_medium=paid' },
    });
    // meta-templates-v2 §7: público, exclusão, idioma e agendamento agora copiam; cidade e interesse continuam unsupported
    const fields = r.data.unsupported.map((u: any) => u.field);
    expect(fields).toEqual(expect.arrayContaining(['adset.targeting.geo_locations.cities', 'adset.targeting.flexible_spec']));
    expect(fields).not.toEqual(expect.arrayContaining(['adset.targeting.custom_audiences']));
    expect(r.data.template.adset).toMatchObject({
      customAudiences: [{ id: 'ca_mock_lal_1' }], excludedCustomAudiences: [{ id: 'ca_mock_buyers' }], locales: [{ key: 6, name: 'English (US)' }],
      schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } },
    });
    expect(r.data.adjusted.map((u: any) => u.field)).toEqual(['adset.schedule']);

    const ad = await call('POST', '/meta/templates/import', users.member.token, { level: 'ad', id: 'mock_ad_4' });
    expect(ad.data.template).toMatchObject({ importedFrom: { level: 'ad', id: 'mock_ad_4' }, campaign: { budgetMode: 'ABO', dailyBudgetMinor: 2000 }, adset: { genders: 'ALL', placements: 'AUTO' } });
    expect(ad.data.unsupported).toEqual([]);
    // o corpo importado salva como está (source IMPORTED) — aqui só conferimos que o import em si não gravou nada
    expect(await prisma.metaPublishTemplate.count({ where: { workspaceId: w1 } })).toBe(before);

    const gone = await call('POST', '/meta/templates/import', users.member.token, { level: 'campaign', id: 'mock_cmp_nope' });
    expect(gone.status).toBe(404);
    expect(gone.error.code).toBe('META_OBJECT_GONE');
    expect((await call('POST', '/meta/templates/import', users.member.token, { level: 'folder', id: 'x' })).status).toBe(400);
  });

  it('v2 §4: listas da conta (MEMBER sim, CLIENT 403) e minDailyBudgetMinor na conexão', async () => {
    const ig = await call('GET', '/meta/instagram-accounts', users.member.token);
    expect(ig.status).toBe(200);
    expect(ig.data.pageLookup).toBe('ok');
    expect(ig.data.accounts.map((a: any) => a.id)).toEqual(expect.arrayContaining(['ig_mock_1', 'ig_mock_page']));
    const au = await call('GET', '/meta/custom-audiences', users.member.token);
    expect(au.status).toBe(200);
    expect(au.data.truncated).toBe(false);
    expect(au.data.audiences.map((a: any) => a.id)).toEqual(expect.arrayContaining(['ca_mock_buyers', 'ca_mock_small']));
    const lo = await call('GET', '/meta/locales', users.member.token);
    expect(lo.status).toBe(200);
    expect(lo.data.locales).toEqual(expect.arrayContaining([{ key: 6, name: 'English (US)' }]));
    for (const path of ['/meta/instagram-accounts', '/meta/custom-audiences', '/meta/locales']) expect((await call('GET', path, users.client.token)).status).toBe(403);
    const conn = await call('GET', '/meta/connection', users.client.token);
    expect(conn.data.adAccount.minDailyBudgetMinor).toBe(500);
  });

  it('v2 §3/§7: import lifetime e awareness; salvar com campos novos; notAvailable; mínimo do total; PATCH revalida o mesclado (só nome não)', async () => {
    const life = await call('POST', '/meta/templates/import', users.member.token, { level: 'campaign', id: 'mock_cmp_life' });
    expect(life.data.template.campaign).toMatchObject({ budgetMode: 'CBO', budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, dailyBudgetMinor: 0, destination: 'NEW_CAMPAIGN' });
    const aw = await call('POST', '/meta/templates/import', users.member.token, { level: 'campaign', id: 'mock_cmp_awareness' });
    expect(aw.data.template).toMatchObject({ campaign: { objective: 'OUTCOME_AWARENESS' }, adset: { optimizationGoal: 'REACH', pixelId: null }, ad: { instagramAccount: { id: 'ig_mock_1', username: 'hookmill.demo' } } });

    const v2 = body({
      name: 'v2 lifetime', campaign: { destination: 'NEW_CAMPAIGN', objective: 'OUTCOME_AWARENESS', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 3500 },
      adset: { pixelId: null, pixelEvent: null, optimizationGoal: null, schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }, locales: [{ key: 6, name: 'English (US)' }], customAudiences: [{ id: 'ca_mock_lal_1', name: 'LAL' }], excludedCustomAudiences: [{ id: 'ca_mock_buyers', name: 'Buyers' }] },
      ad: { callToAction: 'LEARN_MORE', instagramAccount: { id: 'ig_mock_1', username: 'hookmill.demo' } },
    });
    const low = await call('POST', '/meta/templates', users.member.token, { ...v2, campaign: { ...v2.campaign, lifetimeBudgetMinor: 3000 } });
    expect(low.status).toBe(422);
    expect(low.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 3500, budgetType: 'LIFETIME', days: 7 } });
    const gone = await call('POST', '/meta/templates', users.member.token, { ...v2, ad: { ...v2.ad, instagramAccount: { id: 'ig_mock_gone', username: 'x' } } });
    expect(gone.status).toBe(400);
    expect(gone.error.details.fields).toEqual([{ field: 'ad.instagramAccount', rule: 'notAvailable' }]);
    const reuse = await call('POST', '/meta/templates', users.member.token, { ...v2, campaign: { ...v2.campaign, destination: 'REUSE_CAMPAIGN' } });
    expect(reuse.error.details.fields).toEqual([{ field: 'campaign.destination', rule: 'lifetimeCboNeedsNewCampaign' }]);
    const past = await call('POST', '/meta/templates', users.member.token, { ...v2, adset: { ...v2.adset, schedule: { start: '2020-01-01T10:00', end: { kind: 'AFTER_DAYS', days: 7 } } } });
    expect(past.error.details.fields).toEqual([{ field: 'adset.schedule.start', rule: 'inPast' }]);
    const ok = await call('POST', '/meta/templates', users.member.token, v2);
    expect(ok.status).toBe(201);
    expect(ok.data.adset.schedule).toEqual({ start: null, end: { kind: 'AFTER_DAYS', days: 7 } });
    // mudou o ig gravado direto no banco pra um que sumiu: PATCH só de nome/padrão passa, PATCH de outra seção revalida
    // o template mesclado inteiro (B2 do QA, 03/11), publicar barra
    await prisma.metaPublishTemplate.update({ where: { id: ok.data.id }, data: { ad: { ...ok.data.ad, instagramAccount: { id: 'ig_mock_gone', username: 'x' } } } });
    expect((await call('PATCH', `/meta/templates/${ok.data.id}`, users.member.token, { name: 'v2 renamed' })).status).toBe(200);
    expect((await call('PATCH', `/meta/templates/${ok.data.id}`, users.member.token, { name: 'v2 renamed', isDefault: false })).status).toBe(200);
    const camp = await call('PATCH', `/meta/templates/${ok.data.id}`, users.member.token, { campaign: { ...v2.campaign, lifetimeBudgetMinor: 4000 } });
    expect(camp.status).toBe(400);
    expect(camp.error.details.fields).toEqual([{ field: 'ad.instagramAccount', rule: 'notAvailable' }]);
    const pub = await call('POST', `/creatives/${await mkCreative(101)}/meta/publish`, users.member.token, { templateId: ok.data.id });
    expect(pub.status).toBe(400);
    expect(pub.error.details).toMatchObject({ fields: [{ field: 'ad.instagramAccount', rule: 'notAvailable' }], templateId: ok.data.id });
    // fim AT vencido gravado + PATCH que troca o total: relógio do mesclado barra (antes passava e pulava o mínimo)
    await prisma.metaPublishTemplate.update({
      where: { id: ok.data.id },
      data: { ad: ok.data.ad, adset: { ...ok.data.adset, schedule: { start: null, end: { kind: 'AT', at: '2020-01-01T10:00' } } } },
    });
    const late = await call('PATCH', `/meta/templates/${ok.data.id}`, users.member.token, { campaign: { ...v2.campaign, lifetimeBudgetMinor: 100 } });
    expect(late.status).toBe(400);
    expect(late.error.details.fields).toEqual([{ field: 'adset.schedule.end', rule: 'inPast' }]);
    expect((await call('PATCH', `/meta/templates/${ok.data.id}`, users.member.token, { name: 'v2 vencido' })).status).toBe(200);
    await prisma.metaPublishTemplate.update({ where: { id: ok.data.id }, data: { archivedAt: new Date(), isDefault: false } });
  });

  it('v2 F4 (B1 do QA, 03/11): com a conexão TOKEN_INVALID a lista abre (leitura do banco); salvar, renomear e importar dão 422', async () => {
    const t = await call('POST', '/meta/templates', users.member.token, body({ name: 'F4 expirado' }));
    expect(t.status).toBe(201);
    await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { status: 'TOKEN_INVALID' } });
    try {
      for (const who of ['member', 'client'] as Who[]) {
        const l = await call('GET', '/meta/templates', users[who].token);
        expect(l.status).toBe(200);
        expect(l.data.map((x: { id: string }) => x.id)).toContain(t.data.id);
      }
      for (const r of [
        await call('PATCH', `/meta/templates/${t.data.id}`, users.member.token, { name: 'x' }),
        await call('POST', '/meta/templates', users.member.token, body({ name: 'F4 novo' })),
        await call('POST', '/meta/templates/import', users.member.token, { level: 'campaign', id: 'mock_cmp_life' }),
      ]) {
        expect(r.status).toBe(422);
        expect(r.error.code).toBe('META_TOKEN_INVALID');
      }
    } finally {
      await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { status: 'ACTIVE' } });
    }
    await prisma.metaPublishTemplate.update({ where: { id: t.data.id }, data: { archivedAt: new Date(), isDefault: false } });
  });

  it('v2 §6: publicar com LIFETIME + AFTER_DAYS grava os resolvidos nos settings; fim AT a menos de 24 h barra com templateId', async () => {
    const v2 = body({
      name: 'v2 pub', campaign: { destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 5000 },
      adset: { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 3 } }, locales: [{ key: 6, name: 'English (US)' }] },
    });
    const t = await call('POST', '/meta/templates', users.member.token, v2);
    expect(t.status).toBe(201);
    const cid = await mkCreative(102);
    fake.sent.campaigns.length = 0;
    fake.sent.adsets.length = 0;
    const before = Date.now();
    const r = await call('POST', `/creatives/${cid}/meta/publish`, users.member.token, { templateId: t.data.id });
    expect(r.status).toBe(202);
    expect(r.data.settings).toMatchObject({ budgetType: 'LIFETIME', lifetimeBudgetMinor: 5000, dailyBudgetMinor: 0, startTime: null, locales: [6] });
    const end = Date.parse(r.data.settings.endTime);
    expect(end - before).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);
    expect(end - before).toBeLessThan(3 * 86_400_000 + 60_000);
    await settled([r.data.id]);
    // a estrutura leva os resolvidos até a porta: total na campanha (CBO), end_time e idioma no conjunto
    expect(fake.sent.campaigns[0]).toMatchObject({ lifetime_budget: 5000 });
    expect(fake.sent.campaigns[0]).not.toHaveProperty('daily_budget');
    expect(fake.sent.adsets[0]).toMatchObject({ end_time: expect.any(String), targeting: expect.objectContaining({ locales: [6] }) });
    expect(fake.sent.adsets[0]).not.toHaveProperty('start_time');
    // fim AT gravado direto no banco a menos de 24 h: 400 no envio com templateId
    const soon = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16);
    await prisma.metaPublishTemplate.update({ where: { id: t.data.id }, data: { adset: { ...t.data.adset, schedule: { start: null, end: { kind: 'AT', at: soon } } } } });
    const bad = await call('POST', `/creatives/${cid}/meta/publish`, users.member.token, { templateId: t.data.id });
    expect(bad.status).toBe(400);
    expect(bad.error.details).toMatchObject({ fields: [{ field: 'adset.schedule.end', rule: 'minDuration24h' }], templateId: t.data.id });
    await prisma.metaPublishTemplate.update({ where: { id: t.data.id }, data: { archivedAt: new Date(), isDefault: false } });
  });

  it('publicar 1 com template: settings resolvidos (texto herdado da oferta, sem o template dentro), CBO na campanha, REUSE grava o id', async () => {
    const id = creatives[0];
    const mixed = await call('POST', `/creatives/${id}/meta/publish`, users.member.token, { templateId: tplA.id, primaryText: 'x' });
    expect(mixed.status).toBe(400);
    expect(mixed.error.details.fields).toEqual([{ field: 'primaryText', rule: 'exclusiveWithTemplateId' }]);
    expect((await call('POST', `/creatives/${id}/meta/publish`, users.member.token, { templateId: 'nope' })).status).toBe(404);
    fake.sent.campaigns.length = 0;
    fake.sent.adsets.length = 0;
    const r = await call('POST', `/creatives/${id}/meta/publish`, users.member.token, { templateId: tplA.id });
    expect(r.status).toBe(202);
    expect(r.data).toMatchObject({ status: 'PUBLISHING', settings: { dailyBudgetMinor: 2000, countries: ['US'], objective: 'OUTCOME_SALES', primaryText: 'Sleep cooler', headline: 'Bamboo sheets', callToAction: 'SHOP_NOW', link: 'https://example.com/sheets', pixelEvent: 'PURCHASE' } });
    expect(r.data.settings).not.toHaveProperty('campaign');
    const [row] = await settled([r.data.id]);
    expect(row).toMatchObject({ status: 'PAUSED', templateId: tplA.id, groupKey: null, pixelId: 'pix_mock' });
    expect((await prisma.metaPublishTemplate.findUniqueOrThrow({ where: { id: tplA.id } })).reuseCampaignId).toBe(row.campaignId);
    expect(fake.sent.campaigns).toHaveLength(1);
    expect(fake.sent.campaigns[0]).toMatchObject({ name: 'HookMill — Sheets', daily_budget: 2000, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', status: 'PAUSED' });
    expect(fake.sent.adsets[0]).not.toHaveProperty('daily_budget');
    expect(fake.sent.adsets[0]).toMatchObject({ status: 'PAUSED', optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'pix_mock', custom_event_type: 'PURCHASE' } });
    expect(fake.sent.adsets[0].name).toMatch(/^Sheets — \d{4}-\d{2}-\d{2} — 1$/);
  });

  it('publish-batch: 10 criativos com max 8 → 2 ad sets (8 + 2, o 2º belowMin), 1 campanha só (a do REUSE), tudo PAUSED; 409 com os não aprovados', async () => {
    const draft = await mkCreative(99, 'EDIT_PENDING');
    const na = await call('POST', '/meta/publish-batch', users.member.token, { creativeIds: [creatives[1], draft], templateId: tplA.id });
    expect(na.status).toBe(409);
    expect(na.error.details).toMatchObject({ reason: 'not_approved', creativeIds: [draft] });
    expect((await call('POST', '/meta/publish-batch', users.client.token, { creativeIds: [creatives[1]], templateId: tplA.id })).status).toBe(403);
    expect((await call('POST', '/meta/publish-batch', users.member.token, { creativeIds: [], templateId: tplA.id })).status).toBe(400);

    const reuseId = (await prisma.metaPublishTemplate.findUniqueOrThrow({ where: { id: tplA.id } })).reuseCampaignId!;
    fake.sent.campaigns.length = 0;
    fake.sent.adsets.length = 0;
    const readObject = jest.spyOn(fake, 'readObject');
    const ids = creatives.slice(1, 11);
    const r = await call('POST', '/meta/publish-batch', users.member.token, { creativeIds: ids, templateId: tplA.id });
    expect(r.status).toBe(202);
    expect(r.data.plan.adsets.map((g: any) => [g.creativeIds.length, g.belowMin])).toEqual([[8, false], [2, true]]);
    expect(r.data.plan.adsets[0].creativeIds).toEqual(ids.slice(0, 8));
    expect(r.data.plan.adsets[1].name).toMatch(/ — 2$/);
    expect(r.data.publications.map((p: any) => p.creativeId)).toEqual(ids);
    const rows = await settled(r.data.publications.map((p: any) => p.id));
    expect(rows.every((x) => x.status === 'PAUSED')).toBe(true);
    expect(new Set(rows.map((x) => x.campaignId))).toEqual(new Set([reuseId])); // REUSE: entrou na campanha guardada
    expect(fake.sent.campaigns).toHaveLength(0);
    expect(readObject).toHaveBeenCalledWith(expect.anything(), { level: 'campaign', id: reuseId });
    expect(new Set(rows.map((x) => x.adsetId)).size).toBe(2);
    expect(new Set(rows.map((x) => x.groupKey)).size).toBe(2);
    expect(fake.sent.adsets).toHaveLength(2); // ad set 1× por grupo, não por anúncio
    for (const a of fake.sent.adsets) expect(a).not.toHaveProperty('daily_budget'); // CBO
    expect(fake.sent.adsets.map((a) => a.name).sort()).toEqual([r.data.plan.adsets[0].name, r.data.plan.adsets[1].name].sort());
    const byGroup = rows.filter((x) => x.groupKey === rows[0].groupKey);
    expect(byGroup).toHaveLength(8);
    readObject.mockRestore();
  });

  it('ABO + COST_CAP + posicionamentos + UTM no payload; NEW_CAMPAIGN = 1 campanha nova por lote; REUSE apagada = cria e grava outra', async () => {
    const abo = await call('POST', '/meta/templates', users.member.token, body({
      name: 'ABO cap',
      campaign: { destination: 'NEW_CAMPAIGN', budgetMode: 'ABO', dailyBudgetMinor: 700, bidStrategy: 'COST_CAP', bidAmountMinor: 150, namePattern: 'Test {date}' },
      adset: { adsPerAdset: { min: 1, max: 3 }, genders: 'MALE', advantageAudience: false, placements: { platforms: ['instagram'], positions: ['instagram_story', 'instagram_reels'] } },
      ad: { primaryText: 'Cooler nights', urlTags: 'utm_source=hookmill&utm_campaign={offer}', namePattern: '{code} #{n}' },
    }));
    expect(abo.status).toBe(201);
    expect(abo.data.isDefault).toBe(false);
    fake.sent.campaigns.length = 0;
    fake.sent.adsets.length = 0;
    fake.sent.creatives.length = 0;
    const ids = creatives.slice(11, 15);
    const r = await call('POST', '/meta/publish-batch', users.owner.token, { creativeIds: ids, templateId: abo.data.id });
    expect(r.status).toBe(202);
    expect(r.data.plan.adsets.map((g: any) => [g.creativeIds.length, g.belowMin])).toEqual([[3, false], [1, false]]);
    const rows = await settled(r.data.publications.map((p: any) => p.id));
    expect(rows.every((x) => x.status === 'PAUSED')).toBe(true);
    expect(fake.sent.campaigns).toHaveLength(1);
    expect(fake.sent.campaigns[0]).not.toHaveProperty('daily_budget'); // ABO: nada de orçamento na campanha
    expect(fake.sent.campaigns[0]).not.toHaveProperty('bid_strategy');
    expect(new Set(rows.map((x) => x.campaignId)).size).toBe(1);
    expect(fake.sent.adsets).toHaveLength(2);
    for (const a of fake.sent.adsets) {
      expect(a).toMatchObject({ daily_budget: 700, bid_strategy: 'COST_CAP', bid_amount: 150, targeting: { genders: [1], publisher_platforms: ['instagram'], instagram_positions: ['story', 'reels'], targeting_automation: { advantage_audience: 0 } } });
    }
    expect(fake.sent.creatives).toHaveLength(4);
    expect(fake.sent.creatives[0]).toMatchObject({ url_tags: 'utm_source=hookmill&utm_campaign={offer}', object_story_spec: { video_data: { message: 'Cooler nights' } } });
    const names = (await prisma.metaAdSnapshot.findMany({ where: { metaAdId: { in: rows.map((x) => x.metaAdId!) } }, select: { name: true } })).map((s) => s.name).sort();
    expect(names).toEqual(['HEADLINE-12 #1', 'HEADLINE-13 #2', 'HEADLINE-14 #3', 'HEADLINE-15 #1']);
    expect((await prisma.metaPublishTemplate.findUniqueOrThrow({ where: { id: abo.data.id } })).reuseCampaignId).toBeNull();

    // REUSE com a campanha guardada apagada na Meta: cria outra e troca o id no template
    await prisma.metaPublishTemplate.update({ where: { id: tplA.id }, data: { reuseCampaignId: 'mock_campaign_gone' } });
    fake.sent.campaigns.length = 0;
    const one = await call('POST', `/creatives/${creatives[15]}/meta/publish`, users.member.token, { templateId: tplA.id });
    const [row] = await settled([one.data.id]);
    expect(row.status).toBe('PAUSED');
    expect(fake.sent.campaigns).toHaveLength(1);
    expect((await prisma.metaPublishTemplate.findUniqueOrThrow({ where: { id: tplA.id } })).reuseCampaignId).toBe(row.campaignId);
  });

  it('retry de uma publicação do lote retoma dos ids (campanha e ad set do grupo não duplicam); arquivar template em uso = 409', async () => {
    const tpl = await call('POST', '/meta/templates', users.member.token, body({ name: 'Policy', campaign: { destination: 'NEW_CAMPAIGN' }, adset: { adsPerAdset: { min: 1, max: 2 } }, ad: { primaryText: 'x [mock:meta-policy]' } }));
    const ids = [creatives[0], creatives[1]];
    const r = await call('POST', '/meta/publish-batch', users.member.token, { creativeIds: ids, templateId: tpl.data.id });
    expect(r.status).toBe(202);
    const rows = await settled(r.data.publications.map((p: any) => p.id));
    expect(rows.map((x) => [x.status, x.failedStage])).toEqual([['FAILED', 'creating_creative'], ['FAILED', 'creating_creative']]);
    expect(new Set(rows.map((x) => x.adsetId)).size).toBe(1);
    for (const x of rows) await prisma.metaPublication.update({ where: { id: x.id }, data: { settings: { ...(x.settings as object), primaryText: 'fixed' } } });
    const campaign = jest.spyOn(fake, 'createCampaign');
    const adset = jest.spyOn(fake, 'createAdSet');
    for (const c of ids) expect((await call('POST', `/creatives/${c}/meta/retry`, users.member.token, {})).status).toBe(202);
    const done = await settled(rows.map((x) => x.id));
    expect(done.every((x) => x.status === 'PAUSED')).toBe(true);
    expect(done.map((x) => x.adsetId)).toEqual(rows.map((x) => x.adsetId));
    expect(campaign).not.toHaveBeenCalled();
    expect(adset).not.toHaveBeenCalled();
    campaign.mockRestore();
    adset.mockRestore();

    await prisma.metaPublication.update({ where: { id: done[0].id }, data: { status: 'PUBLISHING' } });
    const busy = await call('DELETE', `/meta/templates/${tpl.data.id}`, users.member.token);
    expect(busy.status).toBe(409);
    expect(busy.error.details).toMatchObject({ reason: 'publish_in_progress' });
    await prisma.metaPublication.update({ where: { id: done[0].id }, data: { status: 'PAUSED' } });
    expect((await call('DELETE', `/meta/templates/${tpl.data.id}`, users.member.token)).status).toBe(200);
  });
});
