// meta-templates-v2 §14 (04/11, decisão do Gusta): publicar com `override` (ajustes revisados no editor, SÓ pra esse envio)
// contra o maquina_test com a porta MetaService em mock (stepMs 0): validação com caminhos campaign.*/adset.*/ad.*, settings e
// payload com o mesclado, template intacto, snapshot gravado, REUSE grava no template original (e NÃO quando o override muda
// a forma da campanha), lote com o override, e o retry lendo o snapshot mesmo depois de editar o template.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.META_CRON = 'off';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.PUBLIC_MEDIA = 'on';
process.env.THROTTLE_EXPENSIVE_PER_MIN = '100';
const PORT = 3195;
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
const PREFIX = `movr-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'member' | 'client';

describe(isLocal ? 'Meta templates v2 §14 override (integração local)' : 'Meta templates v2 §14 override [pulado: DATABASE_URL não é localhost]', () => {
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


  const field = (r: { status: number; error: any }) => (r.error?.details?.fields ?? []).map((f: any) => `${f.field}:${f.rule}`);
  const tplRow = () => prisma.metaPublishTemplate.findUniqueOrThrow({ where: { id: tplA.id } });

  it('validação: nível inteiro com a regra do template (campaign.*/adset.*/ad.*), chave estranha, cruzada no mesclado, sem templateId; 422 de orçamento no mesclado', async () => {
    const a = await call('POST', '/meta/templates', users.member.token, body());
    expect(a.status).toBe(201);
    tplA = a.data;
    const id = creatives[0];
    const pub = (b: unknown) => call('POST', `/creatives/${id}/meta/publish`, users.member.token, b);

    const partial = await pub({ templateId: tplA.id, override: { campaign: { dailyBudgetMinor: 5000 } } });
    expect(partial.status).toBe(400);
    expect(field(partial)).toEqual(expect.arrayContaining(['campaign.destination:isIn', 'campaign.objective:isIn']));
    expect(field(await pub({ templateId: tplA.id, override: { adset: { ...tplA.adset, ageMin: 40, ageMax: 30 }, ad: { ...tplA.ad, link: 'nope' } } })))
      .toEqual(['adset.ageMax:gteAgeMin', 'ad.link:isUrl']);
    expect(field(await pub({ templateId: tplA.id, override: { name: 'x' } }))).toEqual(['override.name:notAllowed']);
    const cross = await pub({ templateId: tplA.id, override: { campaign: { ...tplA.campaign, objective: 'OUTCOME_AWARENESS' } } });
    expect(cross.status).toBe(400);
    expect(cross.error.details).toMatchObject({ fields: [{ field: 'adset.pixelId', rule: 'notForObjective' }], templateId: tplA.id });
    expect(field(await pub({ override: { ad: tplA.ad }, dailyBudgetMinor: 2000, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com' })))
      .toEqual(['override:requiresTemplateId']);
    const low = await pub({ templateId: tplA.id, override: { campaign: { ...tplA.campaign, dailyBudgetMinor: 100 } } });
    expect(low.status).toBe(422);
    expect(low.error).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500 } });
    const batch = await call('POST', '/meta/publish-batch', users.member.token, { creativeIds: [id], templateId: tplA.id, override: { ad: { ...tplA.ad, callToAction: 'NOPE' } } });
    expect(field(batch)).toEqual(['ad.callToAction:isIn']);
    expect(await prisma.metaPublication.count({ where: { workspaceId: w1 } })).toBe(0);
  });

  it('publicar 1 com override (conjunto + anúncio): settings e payload do mesclado, template intacto, snapshot gravado, REUSE grava no template original', async () => {
    const before = await tplRow();
    fake.sent.campaigns.length = 0;
    fake.sent.adsets.length = 0;
    fake.sent.creatives.length = 0;
    const override = {
      adset: { ...tplA.adset, countries: ['BR', 'PT'], ageMin: 25, namePattern: 'Override {n}' },
      ad: { ...tplA.ad, primaryText: 'Only this send', urlTags: 'utm_source=override' },
    };
    const r = await call('POST', `/creatives/${creatives[0]}/meta/publish`, users.member.token, { templateId: tplA.id, override });
    expect(r.status).toBe(202);
    expect(r.data.settings).toMatchObject({ countries: ['BR', 'PT'], ageMin: 25, primaryText: 'Only this send', dailyBudgetMinor: 2000 });
    const [row] = await settled([r.data.id]);
    expect(row).toMatchObject({ status: 'PAUSED', templateId: tplA.id });
    expect(row.templateSnapshot).toMatchObject({ overridden: ['adset', 'ad'], campaign: tplA.campaign, adset: { countries: ['BR', 'PT'] }, ad: { primaryText: 'Only this send' } });
    expect(fake.sent.campaigns).toHaveLength(1);
    expect(fake.sent.adsets[0]).toMatchObject({ name: 'Override 1', targeting: { geo_locations: { countries: ['BR', 'PT'] }, age_min: 25 } });
    expect(fake.sent.creatives[0]).toMatchObject({ url_tags: 'utm_source=override', object_story_spec: { video_data: { message: 'Only this send' } } });
    const after = await tplRow();
    expect({ campaign: after.campaign, adset: after.adset, ad: after.ad, name: after.name }).toEqual({ campaign: before.campaign, adset: before.adset, ad: before.ad, name: before.name });
    expect(after.reuseCampaignId).toBe(row.campaignId); // REUSE: a campanha criada é a do template original
  });

  it('override que muda a forma da campanha (objetivo) = campanha nova SÓ nesse envio; o reuseCampaignId do template fica', async () => {
    const reuseId = (await tplRow()).reuseCampaignId;
    expect(reuseId).toBeTruthy();
    fake.sent.campaigns.length = 0;
    const r = await call('POST', `/creatives/${creatives[1]}/meta/publish`, users.member.token, {
      templateId: tplA.id,
      override: { campaign: { ...tplA.campaign, objective: 'OUTCOME_TRAFFIC', dailyBudgetMinor: 3000 }, adset: { ...tplA.adset, pixelId: null, pixelEvent: null } },
    });
    expect(r.status).toBe(202);
    const [row] = await settled([r.data.id]);
    expect(row.status).toBe('PAUSED');
    expect(fake.sent.campaigns).toHaveLength(1);
    expect(fake.sent.campaigns[0]).toMatchObject({ objective: 'OUTCOME_TRAFFIC', daily_budget: 3000 });
    expect(row.campaignId).not.toBe(reuseId);
    expect((await tplRow()).reuseCampaignId).toBe(reuseId);

    // só orçamento mudou (mesma forma): continua na campanha guardada
    fake.sent.campaigns.length = 0;
    const same = await call('POST', `/creatives/${creatives[2]}/meta/publish`, users.member.token, { templateId: tplA.id, override: { campaign: { ...tplA.campaign, dailyBudgetMinor: 9000 } } });
    const [row2] = await settled([same.data.id]);
    expect(row2).toMatchObject({ status: 'PAUSED', campaignId: reuseId });
    expect(fake.sent.campaigns).toHaveLength(0);
  });

  it('publish-batch com override: plano pelo adsPerAdset do envio, snapshot em todas, template intacto', async () => {
    const ids = creatives.slice(3, 8);
    const r = await call('POST', '/meta/publish-batch', users.member.token, {
      creativeIds: ids, templateId: tplA.id, override: { adset: { ...tplA.adset, adsPerAdset: { min: 1, max: 2 } } },
    });
    expect(r.status).toBe(202);
    expect(r.data.plan.adsets.map((g: any) => g.creativeIds.length)).toEqual([2, 2, 1]);
    const rows = await settled(r.data.publications.map((p: any) => p.id));
    expect(rows.every((x) => x.status === 'PAUSED')).toBe(true);
    expect(rows.every((x) => (x.templateSnapshot as any)?.overridden?.join() === 'adset')).toBe(true);
    expect(new Set(rows.map((x) => x.adsetId)).size).toBe(3);
    expect(((await tplRow()).adset as any).adsPerAdset).toEqual({ min: 4, max: 8 });
  });

  it('sem override também grava o snapshot; retry lê o snapshot (editar o template depois não muda o que vai)', async () => {
    const plain = await call('POST', `/creatives/${creatives[8]}/meta/publish`, users.member.token, { templateId: tplA.id });
    const [p0] = await settled([plain.data.id]);
    expect(p0.templateSnapshot).toMatchObject({ overridden: [], ad: tplA.ad });

    const r = await call('POST', `/creatives/${creatives[9]}/meta/publish`, users.member.token, {
      templateId: tplA.id, override: { ad: { ...tplA.ad, primaryText: 'x [mock:meta-policy]', urlTags: 'utm_source=snapshot' } },
    });
    const [failed] = await settled([r.data.id]);
    expect(failed).toMatchObject({ status: 'FAILED', failedStage: 'creating_creative' });
    const patch = await call('PATCH', `/meta/templates/${tplA.id}`, users.member.token, { ad: { ...tplA.ad, urlTags: 'utm_source=edited' } });
    expect(patch.status).toBe(200);
    await prisma.metaPublication.update({ where: { id: failed.id }, data: { settings: { ...(failed.settings as object), primaryText: 'fixed' } } });
    fake.sent.creatives.length = 0;
    expect((await call('POST', `/creatives/${creatives[9]}/meta/retry`, users.member.token, {})).status).toBe(202);
    const [done] = await settled([failed.id]);
    expect(done.status).toBe('PAUSED');
    expect(fake.sent.creatives[0]).toMatchObject({ url_tags: 'utm_source=snapshot' });
  });
});
