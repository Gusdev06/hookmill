// Campaigns v1 (docs/contratos/campanhas-v1.md, B4) de ponta a ponta contra a infra LOCAL (maquina_test). A porta MetaService
// é um fake DESTE spec (estende o FakeMetaService com o mundo do §6: 3 campanhas CBO/ABO/vitalícia, 7 conjuntos, 8 vídeos + 2
// imagens; readObject/setStatus/setDailyBudget em memória; gatilhos [mock:stale]/[mock:meta-rate]/[mock:meta-token]).
// NENHUMA escrita real na Meta. Cobre: sync das 3 tabelas, Home/Pick from Meta só vídeo com os mesmos WINNER, GET
// /meta/campaigns (filtros/busca/ordem/período/totais), detalhe, as escritas com todas as travas do §4.1, MetaChange
// em sucesso e falha, History, papéis (CLIENT/MEMBER leem, só OWNER/ADMIN escrevem).
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { hashPassword } from './common/util/crypto';
import { META_SERVICE, MetaError, ruleFromEnv } from './integracoes';
import type { MetaAuth, MetaLiveObject, MetaMetrics, MetaSyncInput, MetaSyncResult, MetaUsage } from './integracoes/contrato';
import { FakeMetaService } from './integracoes/meta/mock.service';
import { PAGE_CAPTURE, type PageCapturePort } from './iteracao/portas';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);

const RUN = Date.now().toString(36);
const PREFIX = `cmp-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'admin' | 'member' | 'client';

interface Obj {
  level: 'campaign' | 'adset' | 'ad'; id: string; name: string; status: 'ACTIVE' | 'PAUSED'; effectiveStatus: string;
  daily: number | null; lifetime: number | null; campaignId: string | null; adsetId: string | null;
}
const M = (spend: number, results: number, extra: Partial<MetaMetrics> = {}): MetaMetrics => ({
  spend, impressions: spend * 100, clicks: spend * 2, ctr: 2, results, resultType: 'omni_purchase', cpa: results ? spend / results : null,
  roas: null, plays2s: spend * 30, hookRate: 30, thruplays: null, frequency: null, reach: spend * 60, ...extra,
});
const AD_HOME: Record<string, string> = {
  mock_ad_1: 'cbo_a', mock_ad_2: 'cbo_a', mock_ad_3: 'cbo_b', mock_ad_4: 'cbo_b', mock_ad_5: 'abo_live', mock_ad_6: 'abo_paused', mock_ad_7: 'abo_live', mock_ad_novideo: 'life_a',
};

/** §6 do contrato, em memória. `world` muda com as escritas (o QA vê o toggle mudar). */
class CampaignsFake extends FakeMetaService {
  world = new Map<string, Obj>();
  usageNow: MetaUsage | null = null;
  calls: { kind: 'status' | 'budget'; ids: string[]; value: string }[] = [];

  private put(o: Obj) { this.world.set(o.id, o); }

  async syncAds(auth: MetaAuth, i: MetaSyncInput, onProgress?: Parameters<FakeMetaService['syncAds']>[2]): Promise<MetaSyncResult> {
    const base = await super.syncAds(auth, i, onProgress);
    this.world.clear();
    const cmp = (id: string, name: string, daily: number | null, lifetime: number | null) => this.put({ level: 'campaign', id, name, status: 'ACTIVE', effectiveStatus: 'ACTIVE', daily, lifetime, campaignId: id, adsetId: null });
    const set = (id: string, campaignId: string, name: string, daily: number | null, status: 'ACTIVE' | 'PAUSED' = 'ACTIVE') =>
      this.put({ level: 'adset', id, name, status, effectiveStatus: status, daily, lifetime: null, campaignId, adsetId: id });
    cmp('mock_cmp_cbo', 'CBO Prospecting', 5000, null);
    cmp('mock_cmp_abo', 'ABO Testing', null, null);
    cmp('mock_cmp_life', 'Lifetime Launch', null, 100000);
    set('cbo_a', 'mock_cmp_cbo', 'Broad US', null);
    set('cbo_b', 'mock_cmp_cbo', 'Lookalike 1%', null);
    set('abo_live', 'mock_cmp_abo', 'Interest Sleep', 2000);
    set('abo_paused', 'mock_cmp_abo', 'Interest Moms', 1500, 'PAUSED');
    set('abo_stale', 'mock_cmp_abo', '[mock:stale] Retargeting', 1000);
    set('abo_spare', 'mock_cmp_abo', 'Spare set', 1200);
    set('life_a', 'mock_cmp_life', 'Launch set', null);
    // só os vídeos do mock da ia; as 2 imagens deste mundo entram abaixo (posições fixas pros asserts)
    const ads = base.ads.filter((a) => !!a.videoId).map((a) => {
      const adsetId = AD_HOME[a.metaAdId] ?? 'cbo_b';
      const parent = this.world.get(adsetId)!;
      const effective = a.effectiveStatus === 'DISAPPROVED' ? 'DISAPPROVED' : parent.status === 'PAUSED' ? 'ADSET_PAUSED' : 'ACTIVE';
      this.put({ level: 'ad', id: a.metaAdId, name: a.name, status: 'ACTIVE', effectiveStatus: effective, daily: null, lifetime: null, campaignId: parent.campaignId, adsetId });
      return { ...a, status: 'ACTIVE' as const, effectiveStatus: effective, campaign: { id: parent.campaignId!, name: this.world.get(parent.campaignId!)!.name }, adset: { id: adsetId, name: parent.name } };
    });
    for (const [n, adsetId] of [[1, 'abo_live'], [2, 'life_a']] as const) {
      const parent = this.world.get(adsetId)!;
      this.put({ level: 'ad', id: `mock_img_${n}`, name: `Static banner ${n}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE', daily: null, lifetime: null, campaignId: parent.campaignId, adsetId });
      ads.push({
        ...ads[0], metaAdId: `mock_img_${n}`, name: `Static banner ${n}`, videoId: null, thumbnailUrl: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE',
        campaign: { id: parent.campaignId!, name: this.world.get(parent.campaignId!)!.name }, adset: { id: adsetId, name: parent.name },
        metrics: M(40, 1), metrics7d: M(10, 0), metricsPrev7d: M(10, 0), verdict: 'LOW_DATA', trend: null,
      });
    }
    const objs = [...this.world.values()];
    const sum = (level: 'campaign' | 'adset', id: string, w: 'metrics' | 'metrics7d' | 'metricsPrev7d') => {
      const mine = ads.filter((a) => (level === 'campaign' ? a.campaign.id : a.adset.id) === id);
      return M(Math.round(mine.reduce((s, a) => s + a[w].spend, 0)), mine.reduce((s, a) => s + a[w].results, 0));
    };
    return {
      ...base, ads,
      campaigns: objs.filter((o) => o.level === 'campaign').map((o) => ({
        campaignId: o.id, name: o.name, objective: 'OUTCOME_SALES', status: o.status, effectiveStatus: o.effectiveStatus, buyingType: 'AUCTION', bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
        dailyBudgetMinor: o.daily, lifetimeBudgetMinor: o.lifetime, budgetRemainingMinor: o.lifetime ? 60000 : null, specialAdCategories: [],
        startTime: '2026-09-01T00:00:00.000Z', stopTime: o.lifetime ? '2026-12-01T00:00:00.000Z' : null, createdTime: '2026-09-01T00:00:00.000Z',
        metrics: sum('campaign', o.id, 'metrics'), metrics7d: sum('campaign', o.id, 'metrics7d'), metricsPrev7d: sum('campaign', o.id, 'metricsPrev7d'),
      })),
      adsets: objs.filter((o) => o.level === 'adset').map((o) => ({
        adsetId: o.id, campaignId: o.campaignId!, name: o.name, status: o.status, effectiveStatus: o.effectiveStatus, optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS',
        bidStrategy: null, dailyBudgetMinor: o.daily, lifetimeBudgetMinor: null, budgetRemainingMinor: null, learningStage: o.id === 'cbo_a' ? 'LEARNING' as const : 'SUCCESS' as const,
        startTime: '2026-09-01T00:00:00.000Z', endTime: null, createdTime: '2026-09-01T00:00:00.000Z',
        metrics: sum('adset', o.id, 'metrics'), metrics7d: sum('adset', o.id, 'metrics7d'), metricsPrev7d: sum('adset', o.id, 'metricsPrev7d'),
      })),
      truncated: false,
    };
  }

  private trigger(o: Obj) {
    if (o.name.includes('[mock:meta-rate]')) throw new MetaError('META_RATE_LIMITED', 'Meta asked us to wait', { retryAfterSec: 60, failDetail: '17/2446079/mock' });
    if (o.name.includes('[mock:meta-token]')) throw new MetaError('META_TOKEN_INVALID', 'token expired', { failDetail: '190/463/mock' });
  }

  async readObject(_auth: MetaAuth, i: { level: 'campaign' | 'adset' | 'ad'; id: string }): Promise<MetaLiveObject> {
    const o = this.world.get(i.id);
    if (!o || o.level !== i.level) throw new MetaError('META_OBJECT_GONE', 'gone');
    this.trigger(o);
    const stale = o.name.includes('[mock:stale]');
    const parent = (id: string | null) => {
      const p = id ? this.world.get(id) : null;
      return p ? { id: p.id, name: p.name, status: p.status, dailyBudgetMinor: p.daily, lifetimeBudgetMinor: p.lifetime } : null;
    };
    return {
      level: o.level, id: o.id, name: o.name,
      status: stale ? (o.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE') : o.status, effectiveStatus: o.effectiveStatus,
      dailyBudgetMinor: stale && o.daily != null ? o.daily + 100 : o.daily, lifetimeBudgetMinor: o.lifetime,
      campaign: o.level === 'campaign' ? null : parent(o.campaignId), adset: o.level === 'ad' ? parent(o.adsetId) : null,
    };
  }

  async setStatus(auth: MetaAuth, i: { objectIds: string[]; status: 'ACTIVE' | 'PAUSED' }) {
    await super.setStatus(auth, i);
    for (const id of i.objectIds) {
      const o = this.world.get(id);
      if (o) { this.trigger(o); o.status = i.status; }
    }
    this.calls.push({ kind: 'status', ids: i.objectIds, value: i.status });
  }

  async setDailyBudget(_auth: MetaAuth, i: { level: 'campaign' | 'adset'; id: string; dailyBudgetMinor: number }) {
    const o = this.world.get(i.id);
    if (!o) throw new MetaError('META_OBJECT_GONE', 'gone');
    this.trigger(o);
    o.daily = i.dailyBudgetMinor;
    this.calls.push({ kind: 'budget', ids: [i.id], value: String(i.dailyBudgetMinor) });
  }

  objectUrl(adAccountId: string, level: 'campaign' | 'adset' | 'ad', id: string) { return `#${adAccountId}/${level}/${id}`; }
  usage() { return this.usageNow; }
}

describe(isLocal ? 'Campaigns v1 (integração local)' : 'Campaigns v1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string;
  let fake: CampaignsFake;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = r.status === 204 || r.status === 302 ? null : await r.json().catch(() => null);
    return { status: r.status, data: json?.data, error: json?.error, meta: json?.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 120_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const owner = () => users.owner.token;
  const changes = (objectId: string) => prisma.metaChange.findMany({ where: { workspaceId: w1, objectId }, orderBy: { createdAt: 'desc' } });
  const adSnap = (metaAdId: string) => prisma.metaAdSnapshot.findFirstOrThrow({ where: { workspaceId: w1, metaAdId } });
  const status = (level: string, id: string, body: Record<string, unknown>, token = owner()) => call('POST', `/meta/${level}/${id}/status`, token, { confirm: true, ...body });
  const budget = (level: string, id: string, body: Record<string, unknown>, token = owner()) => call('PATCH', `/meta/${level}/${id}/budget`, token, { confirm: true, ...body });

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    fake = new CampaignsFake({ publicApiUrl: process.env.PUBLIC_API_URL!, jwtSecret: process.env.JWT_ACCESS_SECRET || 'mock-secret', rule: ruleFromEnv(), stepMs: 0 });
    const fakePage: PageCapturePort = { capture: async () => ({ error: 'PAGE_UNREADABLE', status: null }) };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(META_SERVICE).useValue(fake)
      .overrideProvider(PAGE_CAPTURE).useValue(fakePage)
      .compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT);

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'admin', 'member', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Cmp ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    const role = { owner: 'OWNER', admin: 'ADMIN', member: 'MEMBER', client: 'CLIENT' } as const;
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}loja`, shortCode: 'CP', businessType: 'ONLINE_STORE', market: 'United States', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: (['owner', 'admin', 'member', 'client'] as Who[]).map((k) => ({ userId: users[k].id, role: role[k], tourCompletedAt: new Date() })) },
      },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.data.accessToken;
    }
    await prisma.offer.create({ data: { workspaceId: w1, name: 'Sheets', language: 'en', what: 'Bamboo sheets', promise: 'Sleep cooler', createdById: users.owner.id } });
    // conectar (mock) + escolher conta: dispara o 1º sync
    const c = await call('POST', '/meta/connect', owner(), { returnTo: '/settings/connections' });
    expect((await fetch(c.data.url, { redirect: 'manual' })).status).toBe(302);
    const sel = await call('PUT', '/meta/selection', owner(), { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(sel.status).toBe(200);
    const conn = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    await until(() => call('GET', `/jobs/${conn.lastSyncJobId}`, owner()), (r) => ['SUCCEEDED', 'FAILED'].includes(r.data?.status));
  });

  afterAll(async () => {
    if (w1) await prisma.workspace.delete({ where: { id: w1 } }).catch(() => undefined);
    await prisma.metaChange.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  // ───────── sync e leitura ─────────

  it('sync grava campanhas, conjuntos e TODOS os anúncios (imagem também), 5 etapas; Home/Pick from Meta seguem só vídeo com os mesmos WINNER', async () => {
    const conn = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    const job = await call('GET', `/jobs/${conn.lastSyncJobId}`, owner());
    expect(job.data).toMatchObject({ status: 'SUCCEEDED', output: { ads: 10, campaigns: 3, adsets: 7, truncated: false } });
    expect(job.data.checklist.map((s: any) => s.key)).toEqual(['listing_campaigns', 'listing_adsets', 'listing_ads', 'reading_insights', 'scoring']);
    expect(await prisma.metaCampaignSnapshot.count({ where: { workspaceId: w1 } })).toBe(3);
    expect(await prisma.metaAdsetSnapshot.count({ where: { workspaceId: w1 } })).toBe(7);
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1 } })).toBe(10);
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1, videoId: null } })).toBe(2);

    const pick = await call('GET', '/meta/ads', users.member.token);
    expect(pick.data).toHaveLength(8); // format padrão = video
    expect(pick.data.filter((a: any) => a.verdict === 'WINNER').map((a: any) => a.metaAdId)).toEqual(['mock_ad_1', 'mock_ad_2']);
    expect(pick.meta.summary).toMatchObject({ adsCount: 8, winnersCount: 2, medianCpa: 27.375 });
    expect(pick.data[0]).toMatchObject({ status: 'ACTIVE', fromHookMill: false, canIterate: true, canToggle: false, adsManagerUrl: '#act_mock_1/ad/mock_ad_1' }); // MEMBER não escreve
    const all = await call('GET', '/meta/ads?format=all&sort=name', owner());
    expect(all.data).toHaveLength(10);
    expect(all.data.find((a: any) => a.metaAdId === 'mock_img_1')).toMatchObject({ videoId: null, canIterate: false, canToggle: true });
    expect((await call('GET', '/meta/ads?format=all&status=paused', owner())).data.map((a: any) => a.metaAdId)).toEqual(['mock_ad_6']); // ADSET_PAUSED
    expect((await call('GET', '/meta/ads?format=all&adsetId=abo_live', owner())).data.map((a: any) => a.metaAdId).sort()).toEqual(['mock_ad_5', 'mock_ad_7', 'mock_img_1']);
    expect((await call('GET', '/meta/ads?format=all&status=issues', owner())).data.map((a: any) => a.metaAdId)).toEqual(['mock_ad_7']);
    // §10: counts do modo "Ads only" ignora status e respeita format
    const adsCounts = (await call('GET', '/meta/ads?format=all&status=issues', owner())).meta.counts;
    expect(adsCounts).toEqual({ all: 10, active: 8, paused: 1, issues: 1 });
    expect((await call('GET', '/meta/ads', owner())).meta.counts.all).toBe(8);
    expect(all.data.find((a: any) => a.metaAdId === 'mock_ad_6')).toMatchObject({ campaign: { name: 'ABO Testing' }, adset: { name: 'Interest Moms' } });
    expect((await call('GET', '/meta/ads?origin=hookmill', owner())).data).toEqual([]);
    // dir aplicado no servidor (com e sem sort)
    const asc = (await call('GET', '/meta/ads?format=all&sort=spend&dir=asc&limit=100', owner())).data.map((a: any) => a.metrics.spend);
    expect([...asc].sort((x: number, y: number) => x - y)).toEqual(asc);
    const dirOnly = (await call('GET', '/meta/ads?format=all&dir=asc&limit=100', owner())).data.map((a: any) => a.metrics.spend);
    expect(dirOnly).toEqual(asc);
    // §11 (Achado D do QA 23/10): meta.totals = conjunto FILTRADO inteiro (todos os filtros), não a página
    const full = (await call('GET', '/meta/ads?format=all&limit=100', owner())).data;
    const sum = (xs: any[], k: string, w = 'metrics') => xs.reduce((a: number, x: any) => a + x[w][k], 0);
    const pg1 = await call('GET', '/meta/ads?format=all&limit=3', owner());
    expect(pg1.data).toHaveLength(3);
    expect(pg1.meta.nextCursor).not.toBeNull();
    expect(pg1.meta.totals).toMatchObject({ count: 10, results: sum(full, 'results'), resultType: 'omni_purchase' });
    expect(pg1.meta.totals.spend).toBeCloseTo(sum(full, 'spend'), 2);
    expect(pg1.meta.totals.ctr).toBeCloseTo((sum(full, 'clicks') / sum(full, 'impressions')) * 100, 1);
    expect(pg1.meta.totals.cpa).toBeCloseTo(sum(full, 'spend') / sum(full, 'results'), 1);
    const pg2 = await call('GET', `/meta/ads?format=all&limit=3&cursor=${encodeURIComponent(pg1.meta.nextCursor)}`, owner());
    expect(pg2.meta.totals).toEqual(pg1.meta.totals); // igual em toda página
    expect((await call('GET', '/meta/ads?format=all&status=issues', owner())).meta.totals).toMatchObject({ count: 1 }); // status entra (≠ counts)
    expect((await call('GET', '/meta/ads', owner())).meta.totals.count).toBe(8); // format padrão video
    const p7 = await call('GET', '/meta/ads?format=all&period=7d&limit=2', owner());
    const full7 = (await call('GET', '/meta/ads?format=all&period=7d&limit=100', owner())).data;
    expect(p7.meta.totals.spend).toBeCloseTo(sum(full7, 'spend', 'metrics7d'), 2); // janela do period
    expect((await call('GET', '/meta/ads?origin=hookmill', owner())).meta.totals).toMatchObject({ count: 0, spend: 0, results: 0, cpa: null, ctr: null });
    expect((await call('GET', '/meta/ads?dir=up', owner())).status).toBe(400);
    expect((await call('GET', '/meta/ads?format=bogus', owner())).status).toBe(400);
    // Pick from Meta num anúncio de imagem = 409 not_a_video
    const iter = await call('POST', '/iterate', owner(), { metaAdId: 'mock_img_1' });
    expect(iter.status).toBe(409);
    expect(iter.error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'not_a_video' } });
    // cartão de saúde conta só vídeo
    expect((await call('GET', '/meta/connection', owner())).data.health).toMatchObject({ adsCount: 8 });
  });

  it('GET /meta/campaigns: CLIENT lê; hierarquia com orçamento por nível, contagens, totais, filtros, busca, ordem, período, cursor', async () => {
    const r = await call('GET', '/meta/campaigns', users.client.token);
    expect(r.status).toBe(200);
    expect(r.data).toHaveLength(3);
    const by = Object.fromEntries(r.data.map((c: any) => [c.id, c]));
    expect(by.mock_cmp_cbo).toMatchObject({ isCbo: true, status: 'ACTIVE', budget: { level: 'campaign', kind: 'daily', amountMinor: 5000, editable: false, minimumMinor: 500, currency: 'USD' }, canToggle: false, adsManagerUrl: '#act_mock_1/campaign/mock_cmp_cbo' });
    expect(by.mock_cmp_abo).toMatchObject({ isCbo: false, budget: { level: null, kind: null }, counts: { adsets: 4, ads: 4 } });
    expect(by.mock_cmp_life).toMatchObject({ isCbo: true, budget: { level: 'campaign', kind: 'lifetime', amountMinor: 100000, remainingMinor: 60000, editable: false } });
    expect(by.mock_cmp_cbo.metrics.reach).toEqual(expect.any(Number));
    const spend = r.data.reduce((s: number, c: any) => s + c.metrics.spend, 0);
    expect(r.meta).toMatchObject({ period: '30d', currency: 'USD', truncated: false, sync: { state: 'ok' }, nextCursor: null });
    expect(r.meta.totals.spend).toBeCloseTo(spend, 2);
    // §11: totais do conjunto filtrado inteiro, não da página
    expect(r.meta.totals.count).toBe(3);
    const p1c = await call('GET', '/meta/campaigns?limit=1', owner());
    expect(p1c.data).toHaveLength(1);
    expect(p1c.meta.totals).toMatchObject({ count: 3 });
    expect(p1c.meta.totals.spend).toBeCloseTo(spend, 2);
    // spend desc (padrão)
    const spends = r.data.map((c: any) => c.metrics.spend);
    expect([...spends].sort((a: number, b: number) => b - a)).toEqual(spends);
    // OWNER vê editável
    expect((await call('GET', '/meta/campaigns', owner())).data.find((c: any) => c.id === 'mock_cmp_cbo')).toMatchObject({ canToggle: true, budget: { editable: true } });
    // filtros: paused = campanha com filho pausado; q bate em conjunto → a campanha aparece; issues = campanha com anúncio reprovado
    expect((await call('GET', '/meta/campaigns?status=paused', owner())).data.map((c: any) => c.id)).toEqual(['mock_cmp_abo']);
    expect((await call('GET', '/meta/campaigns?status=issues', owner())).data.map((c: any) => c.id)).toEqual(['mock_cmp_abo']);
    expect((await call('GET', '/meta/campaigns?q=lookalike', owner())).data.map((c: any) => c.id)).toEqual(['mock_cmp_cbo']);
    // §10: matchedIn só com q (nível onde o nome bateu); anyAdsetLearning; counts ignora o filtro de status
    expect((await call('GET', '/meta/campaigns?q=lookalike', owner())).data[0].matchedIn).toEqual(['adset']);
    expect((await call('GET', '/meta/campaigns?q=static%20banner%201', owner())).data.map((c: any) => [c.id, c.matchedIn])).toEqual([['mock_cmp_abo', ['ad']]]);
    expect((await call('GET', '/meta/campaigns?q=cbo', owner())).data[0].matchedIn).toEqual([]);
    expect(by.mock_cmp_cbo).not.toHaveProperty('matchedIn');
    expect(by.mock_cmp_cbo.anyAdsetLearning).toBe(true);
    expect(by.mock_cmp_abo.anyAdsetLearning).toBe(false);
    const allCounts = r.meta.counts;
    expect(allCounts).toEqual({ all: 3, active: 3, paused: 1, issues: 1 });
    expect((await call('GET', '/meta/campaigns?status=issues', owner())).meta.counts).toEqual(allCounts);
    expect((await call('GET', '/meta/campaigns?q=lookalike&status=paused', owner())).meta.counts).toEqual({ all: 1, active: 1, paused: 0, issues: 0 });
    expect((await call('GET', '/meta/campaigns?origin=hookmill', owner())).data).toEqual([]);
    expect((await call('GET', '/meta/campaigns?sort=name', owner())).data.map((c: any) => c.name)).toEqual(['ABO Testing', 'CBO Prospecting', 'Lifetime Launch']);
    expect((await call('GET', '/meta/campaigns?sort=budget&dir=desc', owner())).data[0].id).toBe('mock_cmp_life');
    const d7 = await call('GET', '/meta/campaigns?period=7d', owner());
    expect(d7.meta.period).toBe('7d');
    expect(d7.meta.totals.spend).toBeCloseTo(d7.data.reduce((s: number, c: any) => s + c.metrics7d.spend, 0), 2);
    const p1 = await call('GET', '/meta/campaigns?limit=1&sort=name', owner());
    expect(p1.data.map((c: any) => c.id)).toEqual(['mock_cmp_abo']);
    const p2 = await call('GET', `/meta/campaigns?limit=1&sort=name&cursor=${encodeURIComponent(p1.meta.nextCursor)}`, owner());
    expect(p2.data.map((c: any) => c.id)).toEqual(['mock_cmp_cbo']);
    expect((await call('GET', '/meta/campaigns?sort=roas', owner())).status).toBe(400);
  });

  it('GET /meta/campaigns/:id: conjuntos com anúncios (todos os formatos), aprendizado, orçamento CBO/ABO; 404 fora do snapshot', async () => {
    const cbo = await call('GET', '/meta/campaigns/mock_cmp_cbo', users.member.token);
    expect(cbo.status).toBe(200);
    expect(cbo.data.campaign.id).toBe('mock_cmp_cbo');
    const a = cbo.data.adsets.find((s: any) => s.id === 'cbo_a');
    expect(a).toMatchObject({ learningStage: 'LEARNING', budget: { level: 'campaign', kind: 'daily', amountMinor: 5000, editable: false }, counts: { ads: 2 } });
    expect(a.ads.map((x: any) => x.metaAdId).sort()).toEqual(['mock_ad_1', 'mock_ad_2']);
    const abo = await call('GET', '/meta/campaigns/mock_cmp_abo?period=7d', owner());
    const paused = abo.data.adsets.find((s: any) => s.id === 'abo_paused');
    expect(paused).toMatchObject({ status: 'PAUSED', budget: { level: 'adset', kind: 'daily', amountMinor: 1500, editable: true } });
    expect(paused.ads[0]).toMatchObject({ metaAdId: 'mock_ad_6', status: 'ACTIVE', effectiveStatus: 'ADSET_PAUSED' });
    expect(abo.data.adsets.find((s: any) => s.id === 'abo_live').ads.map((x: any) => x.metaAdId)).toContain('mock_img_1');
    expect((await call('GET', '/meta/campaigns/nope', owner())).status).toBe(404);
  });

  // ───────── escritas ─────────

  it('papéis: MEMBER e CLIENT 403 nas escritas; confirm ausente = 400; objeto fora do snapshot = 404', async () => {
    expect((await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' }, users.member.token)).status).toBe(403);
    expect((await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' }, users.client.token)).status).toBe(403);
    expect((await budget('adsets', 'abo_live', { dailyBudgetMinor: 2100, expectedDailyBudgetMinor: 2000 }, users.member.token)).status).toBe(403);
    const noConfirm = await call('POST', '/meta/campaigns/mock_cmp_cbo/status', owner(), { status: 'PAUSED', expected: 'ACTIVE' });
    expect(noConfirm.status).toBe(400);
    expect((await call('POST', '/meta/campaigns/mock_cmp_cbo/status', owner(), { status: 'PAUSED', expected: 'ACTIVE', confirm: false })).status).toBe(400);
    expect((await status('campaigns', 'nope', { status: 'PAUSED', expected: 'ACTIVE' })).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it('pausar campanha (ADMIN): snapshot e entrega dos filhos atualizados, MetaChange APPLIED; reativar volta', async () => {
    const off = await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' }, users.admin.token);
    expect(off.status).toBe(200);
    expect(off.data).toMatchObject({ level: 'campaign', object: { id: 'mock_cmp_cbo', status: 'PAUSED', effectiveStatus: 'PAUSED' }, alsoActivated: [] });
    expect(off.data.change).toMatchObject({ level: 'campaign', objectId: 'mock_cmp_cbo', field: 'STATUS', from: 'ACTIVE', to: 'PAUSED', result: 'APPLIED', source: 'CAMPAIGNS', by: { id: users.admin.id, initials: 'CA' } });
    expect(fake.calls.at(-1)).toEqual({ kind: 'status', ids: ['mock_cmp_cbo'], value: 'PAUSED' });
    expect((await adSnap('mock_ad_1')).effectiveStatus).toBe('CAMPAIGN_PAUSED');
    expect((await prisma.metaAdsetSnapshot.findFirstOrThrow({ where: { workspaceId: w1, adsetId: 'cbo_a' } })).effectiveStatus).toBe('CAMPAIGN_PAUSED');
    const on = await status('campaigns', 'mock_cmp_cbo', { status: 'ACTIVE', expected: 'PAUSED' });
    expect(on.data.object).toMatchObject({ status: 'ACTIVE', effectiveStatus: 'ACTIVE' });
    expect((await adSnap('mock_ad_1')).effectiveStatus).toBe('ACTIVE');
    expect((await changes('mock_cmp_cbo')).map((c) => [c.fromValue, c.toValue, c.result])).toEqual([['PAUSED', 'ACTIVE', 'APPLIED'], ['ACTIVE', 'PAUSED', 'APPLIED']]);
  });

  it('D6: ativar anúncio com conjunto pausado sem includeParents = 409 META_PARENT_PAUSED (nada escrito); com includeParents liga os dois e registra alsoChanged', async () => {
    const before = fake.calls.length;
    const r = await status('ads', 'mock_ad_6', { status: 'ACTIVE', expected: 'ACTIVE' });
    expect(r.status).toBe(409);
    expect(r.error).toMatchObject({ code: 'META_PARENT_PAUSED', details: { parents: [{ level: 'adset', id: 'abo_paused', name: 'Interest Moms' }] } });
    expect(fake.calls.length).toBe(before);
    const ok = await status('ads', 'mock_ad_6', { status: 'ACTIVE', expected: 'ACTIVE', includeParents: true });
    expect(ok.status).toBe(200);
    expect(ok.data.alsoActivated).toEqual([{ level: 'adset', id: 'abo_paused', name: 'Interest Moms' }]);
    expect(ok.data.change).toMatchObject({ alsoChanged: ['abo_paused'], alsoChangedRefs: [{ level: 'adset', id: 'abo_paused', name: 'Interest Moms' }], result: 'APPLIED' });
    const hist = await call('GET', '/meta/changes?objectId=mock_ad_6', users.client.token);
    expect(hist.data[0].alsoChangedRefs).toEqual([{ level: 'adset', id: 'abo_paused', name: 'Interest Moms' }]);
    expect(ok.data.object).toMatchObject({ metaAdId: 'mock_ad_6', effectiveStatus: 'ACTIVE' });
    expect(fake.calls.at(-1)).toEqual({ kind: 'status', ids: ['abo_paused', 'mock_ad_6'], value: 'ACTIVE' });
    expect((await prisma.metaAdsetSnapshot.findFirstOrThrow({ where: { workspaceId: w1, adsetId: 'abo_paused' } })).status).toBe('ACTIVE');
    // pausar nunca cascateia
    const p = await status('ads', 'mock_ad_6', { status: 'PAUSED', expected: 'ACTIVE', includeParents: true });
    expect(p.data).toMatchObject({ alsoActivated: [], object: { status: 'PAUSED', effectiveStatus: 'PAUSED' } });
    expect(fake.calls.at(-1)!.ids).toEqual(['mock_ad_6']);
  });

  it('D8: mudou no Ads Manager depois do sync ([mock:stale]) = 409 META_OBJECT_CHANGED { current } e o snapshot reflete a Meta; reprovado = 422 META_POLICY', async () => {
    const r = await status('adsets', 'abo_stale', { status: 'PAUSED', expected: 'ACTIVE' });
    expect(r.status).toBe(409);
    expect(r.error).toMatchObject({ code: 'META_OBJECT_CHANGED', details: { current: { status: 'PAUSED', dailyBudgetMinor: 1100 } } });
    expect((await prisma.metaAdsetSnapshot.findFirstOrThrow({ where: { workspaceId: w1, adsetId: 'abo_stale' } }))).toMatchObject({ status: 'PAUSED', dailyBudgetMinor: 1100 });
    const b = await budget('adsets', 'abo_stale', { dailyBudgetMinor: 1500, expectedDailyBudgetMinor: 1000 });
    expect(b.error).toMatchObject({ code: 'META_OBJECT_CHANGED' });
    const writesBefore = fake.calls.length;
    const pol = await status('ads', 'mock_ad_7', { status: 'ACTIVE', expected: 'ACTIVE' });
    expect(pol.status).toBe(422);
    expect(pol.error.code).toBe('META_POLICY');
    expect(await changes('abo_stale')).toHaveLength(0); // META_OBJECT_CHANGED é conversa (o web recarrega e pede de novo): fora do History
    // §11: a trava META_POLICY entra no History como BLOCKED, sem escrita na Meta
    expect(fake.calls.length).toBe(writesBefore);
    const blocked = await changes('mock_ad_7');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ result: 'BLOCKED', errorCode: 'META_POLICY', field: 'STATUS', toValue: 'ACTIVE', source: 'CAMPAIGNS', alsoChanged: [] });
    const hist = await call('GET', '/meta/changes?objectId=mock_ad_7', users.client.token);
    expect(hist.data[0]).toMatchObject({ result: 'BLOCKED', errorCode: 'META_POLICY', level: 'ad', objectName: expect.any(String) });
  });

  it('orçamento: onde mora (NOT_EDITABLE), mínimo da conta, teto 2× por ação, diminuir livre; MetaChange com de→para em centavos', async () => {
    expect((await budget('adsets', 'cbo_a', { dailyBudgetMinor: 6000, expectedDailyBudgetMinor: 5000 })).error).toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE', details: { budgetLevel: 'campaign', kind: 'daily' } });
    expect((await budget('campaigns', 'mock_cmp_life', { dailyBudgetMinor: 6000, expectedDailyBudgetMinor: 100000 })).error).toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE', details: { budgetLevel: 'campaign', kind: 'lifetime' } });
    expect((await budget('campaigns', 'mock_cmp_abo', { dailyBudgetMinor: 6000, expectedDailyBudgetMinor: 0 })).error).toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE', details: { budgetLevel: 'adset' } });
    expect((await budget('campaigns', 'mock_cmp_cbo', { dailyBudgetMinor: 6000, expectedDailyBudgetMinor: 4000 })).error).toMatchObject({ code: 'META_OBJECT_CHANGED', details: { current: { dailyBudgetMinor: 5000 } } });
    const low = await budget('campaigns', 'mock_cmp_cbo', { dailyBudgetMinor: 400, expectedDailyBudgetMinor: 5000 });
    expect(low.status).toBe(422);
    expect(low.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500, currency: 'USD' } });
    const big = await budget('campaigns', 'mock_cmp_cbo', { dailyBudgetMinor: 10001, expectedDailyBudgetMinor: 5000 });
    expect(big.error).toMatchObject({ code: 'META_BUDGET_STEP_TOO_LARGE', details: { maxMinor: 10000, currency: 'USD' } });
    expect((await budget('adsets', 'cbo_a', { dailyBudgetMinor: 6000, expectedDailyBudgetMinor: 5000 }, users.client.token)).status).toBe(403);
    const up = await budget('campaigns', 'mock_cmp_cbo', { dailyBudgetMinor: 10000, expectedDailyBudgetMinor: 5000 });
    expect(up.status).toBe(200);
    expect(up.data).toMatchObject({ level: 'campaign', object: { budget: { amountMinor: 10000, editable: true } }, change: { field: 'DAILY_BUDGET', from: '5000', to: '10000', result: 'APPLIED' } });
    expect(fake.calls.at(-1)).toEqual({ kind: 'budget', ids: ['mock_cmp_cbo'], value: '10000' });
    const down = await budget('adsets', 'abo_live', { dailyBudgetMinor: 600, expectedDailyBudgetMinor: 2000 });
    expect(down.data).toMatchObject({ object: { budget: { level: 'adset', amountMinor: 600 } }, change: { from: '2000', to: '600' } });
  });

  it('erro da Meta na escrita: MetaChange FAILED com errorCode/failDetail; [mock:meta-rate] = 503 rate_limited; [mock:meta-token] = 422 e conexão TOKEN_INVALID; cota ≥ 90 % = 503 sem chamar', async () => {
    fake.world.get('abo_spare')!.name = '[mock:meta-rate] Spare set';
    const rate = await status('adsets', 'abo_spare', { status: 'PAUSED', expected: 'ACTIVE' });
    expect(rate.status).toBe(503);
    expect(rate.error).toMatchObject({ code: 'META_UNAVAILABLE', details: { reason: 'rate_limited', retryAfterSec: 60 } });
    expect((await changes('abo_spare'))[0]).toMatchObject({ result: 'FAILED', errorCode: 'META_RATE_LIMITED', failDetail: '17/2446079/mock', toValue: 'PAUSED', source: 'CAMPAIGNS' });

    fake.usageNow = { pct: 95, regainSec: 120, at: new Date().toISOString() };
    const writes = fake.calls.length;
    const busy = await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' });
    expect(busy.error).toMatchObject({ code: 'META_UNAVAILABLE', details: { reason: 'rate_limited', retryAfterSec: 120 } });
    expect(fake.calls.length).toBe(writes);
    fake.usageNow = { pct: 80, regainSec: null, at: new Date().toISOString() };

    fake.world.get('abo_spare')!.name = '[mock:meta-token] Spare set';
    const tok = await status('adsets', 'abo_spare', { status: 'PAUSED', expected: 'ACTIVE' });
    expect(tok.status).toBe(422);
    expect(tok.error.code).toBe('META_TOKEN_INVALID');
    expect((await changes('abo_spare'))[0]).toMatchObject({ result: 'FAILED', errorCode: 'META_TOKEN_INVALID' });
    expect((await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } })).status).toBe('TOKEN_INVALID');
    // Gusta 25/10: com o login vencido, nem a leitura sai (dado só com a conexão saudável); escrita = 422 até reconectar
    expect((await call('GET', '/meta/campaigns', owner())).error).toMatchObject({ code: 'META_TOKEN_INVALID' });
    expect((await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' })).error.code).toBe('META_TOKEN_INVALID');
    await prisma.metaConnection.update({ where: { workspaceId: w1 }, data: { status: 'ACTIVE' } });
    fake.world.get('abo_spare')!.name = 'Spare set';
    fake.usageNow = null;
  });

  it('objeto apagado na Meta = 404 META_OBJECT_GONE, sai do snapshot (com os filhos), MetaChange FAILED', async () => {
    fake.world.delete('mock_img_2');
    const r = await status('ads', 'mock_img_2', { status: 'PAUSED', expected: 'ACTIVE' });
    expect({ status: r.status, code: r.error?.code, details: r.error?.details }).toMatchObject({ status: 404 });
    expect(r.error.code).toBe('META_OBJECT_GONE');
    expect(await prisma.metaAdSnapshot.count({ where: { workspaceId: w1, metaAdId: 'mock_img_2' } })).toBe(0);
    expect((await changes('mock_img_2'))[0]).toMatchObject({ result: 'FAILED', errorCode: 'META_OBJECT_GONE' });
  });

  it('GET /meta/changes (History): todos leem, mais recente primeiro, filtro por objeto e nível, cursor', async () => {
    const all = await call('GET', '/meta/changes', users.client.token);
    expect(all.status).toBe(200);
    expect(all.data.length).toBeGreaterThanOrEqual(8);
    const ats = all.data.map((c: any) => c.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(all.data.some((c: any) => c.result === 'FAILED')).toBe(true);
    const one = await call('GET', '/meta/changes?objectId=mock_cmp_cbo', users.member.token);
    expect(one.data.every((c: any) => c.objectId === 'mock_cmp_cbo')).toBe(true);
    expect(one.data[0]).toMatchObject({ field: 'DAILY_BUDGET', from: '5000', to: '10000', by: { name: 'Cmp owner' } });
    expect((await call('GET', '/meta/changes?level=adset', owner())).data.every((c: any) => c.level === 'adset')).toBe(true);
    const p1 = await call('GET', '/meta/changes?limit=2', owner());
    expect(p1.data).toHaveLength(2);
    const p2 = await call('GET', `/meta/changes?limit=2&cursor=${encodeURIComponent(p1.meta.nextCursor)}`, owner());
    expect(p2.data[0].id).not.toBe(p1.data[1].id);
    expect((await call('GET', '/meta/changes?level=nope', owner())).status).toBe(400);
  });

  it('D11: 21ª escrita no minuto = 429 RATE_LIMITED { retryAfterSec } sem chamar a Meta', async () => {
    const conn = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    const recent = await prisma.metaChange.count({ where: { workspaceId: w1, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    const fill = Math.max(0, 20 - recent);
    await prisma.metaChange.createMany({
      data: Array.from({ length: fill }, () => ({
        workspaceId: w1, connectionId: conn.id, adAccountId: 'act_mock_1', level: 'AD' as const, objectId: 'filler', objectName: 'filler', field: 'STATUS' as const,
        fromValue: 'ACTIVE', toValue: 'PAUSED', result: 'APPLIED' as const, source: 'CAMPAIGNS' as const, userId: users.owner.id,
      })),
    });
    const writes = fake.calls.length;
    const r = await status('campaigns', 'mock_cmp_cbo', { status: 'PAUSED', expected: 'ACTIVE' });
    expect(r.status).toBe(429);
    expect(r.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSec: expect.any(Number) } });
    expect(r.error.details.retryAfterSec).toBeLessThanOrEqual(60);
    expect(fake.calls.length).toBe(writes);
  });
});
