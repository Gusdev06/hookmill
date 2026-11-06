// meta-oferta-v1 (04/11) de ponta a ponta contra o maquina_test, porta Meta em mock (links fake do MOCK_AD_LINKS):
// sync grava o link → GET /meta/ads?offerId agrupa this → unknown → other com meta.offer (counts, veredito da oferta,
// cobertura de link) → offerScope → erros (requires_offer, 404 de outro workspace) → PUT/DELETE /meta/offer-links
// (affectedAds, Desfazer, CLIENT 403, ADSET 400) → GET /meta/campaigns?offerId (offerMix) e detalhe → cache do sync.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
const PORT = 3186;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { META_SERVICE, ruleFromEnv } from '../integracoes';
import { FakeMetaService } from '../integracoes/meta/mock.service';
import { configureApp } from '../main';
import { MetaSyncService } from './sync.service';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(300_000);

const RUN = Date.now().toString(36);
const PREFIX = `metaoferta-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'client';

describe(isLocal ? 'meta-oferta-v1 (integração local)' : 'meta-oferta-v1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string;
  let w2: string;
  let X: string;
  let Y: string;
  let foreignOffer: string;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, data: json?.data, error: json?.error, meta: json?.meta };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const owner = () => users.owner.token;
  type Row = { metaAdId: string; verdict: string; offer: { fit: string | null; offerId: string | null; match: string; noneReason: string | null; manual: unknown; canEdit: boolean; linkPending: boolean; destinationHost: string | null } };
  const ads = async (q: string, token = owner()) => call('GET', `/meta/ads?${/(^|&)limit=/.test(q) ? '' : 'limit=100&'}${q}`, token);
  const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.metaAdId, r]));

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    const fake = new FakeMetaService({ publicApiUrl: process.env.PUBLIC_API_URL!, jwtSecret: process.env.JWT_ACCESS_SECRET || 'mock-secret', rule: ruleFromEnv(), stepMs: 0 });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(META_SERVICE).useValue(fake).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT);

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'client'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { access: 'INTERNAL', email, name: `MO ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    const ws = (name: string) => prisma.workspace.create({
      data: {
        name: `${PREFIX}${name}`, shortCode: 'MO', resultType: 'PURCHASE', market: 'United States', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: [{ userId: users.owner.id, role: 'OWNER', tourCompletedAt: new Date() }, { userId: users.client.id, role: 'CLIENT', tourCompletedAt: new Date() }] },
      },
    });
    w1 = (await ws('spy')).id;
    w2 = (await ws('outro')).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.data.accessToken;
    }
    // o token vale pro workspace padrão do login; garante que é o w1 (o primeiro criado)
    const me = await call('GET', '/workspace', owner());
    expect(me.data.id).toBe(w1);
    // §3.7: X = Spy Gram (quiz + checkout Kiwify Ab12 lido na página), Y = Zap Spy
    X = (await prisma.offer.create({
      data: {
        workspaceId: w1, name: 'Spy Gram', language: 'en', sourceUrl: 'https://spygram.app/quiz', createdById: users.owner.id,
        readMeta: { pages: [{ url: 'https://spygram.app/quiz', role: 'main' }, { url: 'https://pay.kiwify.com.br/Ab12', role: 'checkout' }, { url: 'https://outroproduto.com/vsl', role: 'terms' }] },
      },
    })).id;
    Y = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Zap Spy', language: 'en', sourceUrl: 'https://zapspy.com.br', createdById: users.owner.id } })).id;
    foreignOffer = (await prisma.offer.create({ data: { workspaceId: w2, name: 'Alheia', language: 'en', createdById: users.owner.id } })).id;

    // conexão mock de verdade: connect → callback → selection (1º sync)
    const c = await call('POST', '/meta/connect', owner(), { returnTo: '/settings' });
    expect(c.status).toBe(201);
    await fetch(c.data.url, { redirect: 'manual' });
    const sel = await call('PUT', '/meta/selection', owner(), { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(sel.status).toBe(200);
    const conn = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    const job = await until(() => prisma.job.findUnique({ where: { id: conn.lastSyncJobId! } }), (j) => !!j && ['SUCCEEDED', 'FAILED'].includes(j.status));
    expect(job?.status).toBe('SUCCEEDED');
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('sync grava o link de destino no snapshot (§2)', async () => {
    const s = await prisma.metaAdSnapshot.findFirstOrThrow({ where: { workspaceId: w1, metaAdId: 'mock_ad_1' } });
    expect(s).toMatchObject({ destinationSource: 'video_cta', destinationUrls: ['https://spygram.app/quiz?utm_source=fb&utm_campaign=cbo01'], urlTags: 'utm_source=facebook&utm_medium=paid' });
    const post = await prisma.metaAdSnapshot.findFirstOrThrow({ where: { workspaceId: w1, metaAdId: 'mock_ad_5' } });
    expect(post).toMatchObject({ destinationSource: 'existing_post', destinationUrls: [] });
  });

  it('sem offerId: comportamento de hoje, linha com offer (fit null) e sem meta.offer', async () => {
    const r = await ads('format=all');
    expect(r.status).toBe(200);
    expect(r.meta.offer).toBeUndefined();
    const m = byId(r.data);
    expect(m.mock_ad_1.offer).toMatchObject({ fit: null, offerId: X, match: 'link', manual: null, canEdit: true, destinationHost: 'spygram.app' });
    expect(m.mock_ad_img_1.offer).toMatchObject({ fit: null, offerId: Y, match: 'domain' });
  });

  it('?offerId=X: agrupa this → unknown → other, counts, veredito dentro da oferta (≥ 3 elegíveis), cobertura de link', async () => {
    const r = await ads(`format=all&offerId=${X}`);
    expect(r.status).toBe(200);
    const rows = r.data as Row[];
    expect(rows).toHaveLength(10);
    const fits = rows.map((x) => x.offer.fit);
    expect(fits).toEqual([...fits].sort((a, b) => ['this', 'unknown', 'other'].indexOf(a!) - ['this', 'unknown', 'other'].indexOf(b!)));
    const m = byId(rows);
    expect(m.mock_ad_1.offer).toMatchObject({ fit: 'this', match: 'link' });
    expect(m.mock_ad_2.offer).toMatchObject({ fit: 'this', match: 'link' });
    expect(m.mock_ad_3.offer).toMatchObject({ fit: 'this', match: 'link' });
    expect(m.mock_ad_novideo.offer).toMatchObject({ fit: 'this', match: 'domain' });
    expect(m.mock_ad_4.offer).toMatchObject({ fit: 'other', offerId: null, noneReason: 'foreign_link' });
    expect(m.mock_ad_7.offer).toMatchObject({ fit: 'other', noneReason: 'foreign_link' }); // Kiwify de outro produto
    expect(m.mock_ad_img_1.offer).toMatchObject({ fit: 'other', offerId: Y });
    expect(m.mock_ad_5.offer).toMatchObject({ fit: 'unknown', noneReason: 'no_link' });
    expect(m.mock_ad_6.offer).toMatchObject({ fit: 'unknown', noneReason: 'no_link' });
    expect(m.mock_ad_img_2.offer).toMatchObject({ fit: 'unknown', noneReason: 'no_link' });
    expect(r.meta.offer).toEqual({
      offerId: X, counts: { this: 4, unknown: 3, other: 3 }, verdictScope: 'offer', medianCpa: 23.75,
      links: { read: 7, pending: 0, unreadable: 3 }, offerHasUrl: true,
    });
    expect([m.mock_ad_1.verdict, m.mock_ad_2.verdict, m.mock_ad_3.verdict]).toEqual(['WINNER', 'WINNER', 'OK']);
    expect(r.meta.totals.count).toBe(10);
    expect(r.meta.summary.adsCount).toBe(8); // summary continua da conta inteira (vídeo)
  });

  it('offerScope filtra depois dos counts; padrão video; Y com < 3 elegíveis usa o veredito da conta', async () => {
    const other = await ads(`format=all&offerId=${X}&offerScope=other`);
    expect(other.data.map((x: Row) => x.metaAdId).sort()).toEqual(['mock_ad_4', 'mock_ad_7', 'mock_ad_img_1']);
    expect(other.meta.offer.counts).toEqual({ this: 4, unknown: 3, other: 3 });
    expect(other.meta.totals.count).toBe(3);
    const video = await ads(`offerId=${X}`);
    expect(video.meta.offer.counts).toEqual({ this: 4, unknown: 2, other: 2 });
    const y = await ads(`format=all&offerId=${Y}`);
    expect(y.meta.offer).toMatchObject({ verdictScope: 'account', medianCpa: null, counts: { this: 1 } });
    const winners = await ads(`offerId=${X}&verdict=WINNER&limit=1`);
    expect(winners.data[0]).toMatchObject({ metaAdId: 'mock_ad_1', offer: { fit: 'this' } });
  });

  it('erros: offerScope sem offerId = 400 requires_offer; oferta de outro workspace = 404 offer', async () => {
    const a = await ads('offerScope=this');
    expect(a.status).toBe(400);
    expect(a.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: [{ field: 'offerScope', rule: 'requires_offer' }] } });
    const b = await ads(`offerId=${foreignOffer}`);
    expect(b.status).toBe(404);
    expect(b.error).toMatchObject({ code: 'NOT_FOUND', details: { resource: 'offer' } });
    expect((await ads('offerId=nope&offerScope=bogus')).status).toBe(400);
    expect((await call('GET', `/meta/campaigns?offerScope=this`, owner())).status).toBe(400);
  });

  it('PUT/DELETE /meta/offer-links: BELONGS move o anúncio (affectedAds), Desfazer volta ao automático; NOT_BELONGS por campanha', async () => {
    const put = await call('PUT', '/meta/offer-links', owner(), { level: 'AD', objectId: 'mock_ad_4', offerId: X, belongs: true });
    expect(put.status).toBe(200);
    // ad4 vira this e leva junto, pela regra 7 (irmão na campanha), os posts sem link mock_ad_5 e mock_ad_6
    expect(put.data).toEqual({ level: 'AD', objectId: 'mock_ad_4', offerId: X, decision: 'BELONGS', affectedAds: 3 });
    let m = byId((await ads(`format=all&offerId=${X}`)).data);
    expect(m.mock_ad_4.offer).toMatchObject({ fit: 'this', match: 'manual', manual: { level: 'AD', decision: 'BELONGS' } });
    expect(m.mock_ad_5.offer).toMatchObject({ fit: 'this', match: 'sibling' });
    // BELONGS é exclusivo: "é da Y" apaga o BELONGS de X
    expect((await call('PUT', '/meta/offer-links', owner(), { level: 'AD', objectId: 'mock_ad_4', offerId: Y, belongs: true })).data.decision).toBe('BELONGS');
    expect(await prisma.metaOfferLink.count({ where: { workspaceId: w1, objectId: 'mock_ad_4' } })).toBe(1);
    const del = await call('DELETE', `/meta/offer-links?level=AD&objectId=mock_ad_4&offerId=${Y}`, owner());
    expect(del.status).toBe(200);
    expect(del.data).toMatchObject({ decision: null, affectedAds: 3 });
    expect((await call('DELETE', `/meta/offer-links?level=AD&objectId=mock_ad_4&offerId=${Y}`, owner())).data).toMatchObject({ decision: null, affectedAds: 0 });
    // campanha inteira "não é da X": os 3 anúncios dela que eram this viram other
    const camp = await call('PUT', '/meta/offer-links', owner(), { level: 'CAMPAIGN', objectId: 'mock_cmp_cbo', offerId: X, belongs: false });
    expect(camp.data).toMatchObject({ decision: 'NOT_BELONGS', affectedAds: 3 }); // ad1, ad2, ad3 (img_1 já era other)
    m = byId((await ads(`format=all&offerId=${X}`)).data);
    expect(m.mock_ad_1.offer).toMatchObject({ fit: 'other', noneReason: 'excluded', manual: { level: 'CAMPAIGN', decision: 'NOT_BELONGS' } });
    await call('DELETE', `/meta/offer-links?level=CAMPAIGN&objectId=mock_cmp_cbo&offerId=${X}`, owner());
    m = byId((await ads(`format=all&offerId=${X}`)).data);
    expect(m.mock_ad_1.offer).toMatchObject({ fit: 'this', manual: null });
  });

  it('offer-links: CLIENT 403, ADSET 400, objeto fora do snapshot 404, oferta alheia 404; CLIENT vê canEdit false', async () => {
    expect((await call('PUT', '/meta/offer-links', users.client.token, { level: 'AD', objectId: 'mock_ad_4', offerId: X, belongs: true })).status).toBe(403);
    expect((await call('PUT', '/meta/offer-links', owner(), { level: 'ADSET', objectId: 'mock_adset_cbo_1', offerId: X, belongs: true })).status).toBe(400);
    const gone = await call('PUT', '/meta/offer-links', owner(), { level: 'AD', objectId: 'nao_existe', offerId: X, belongs: true });
    expect(gone.status).toBe(404);
    expect(gone.error.details).toEqual({ resource: 'ad' });
    expect((await call('PUT', '/meta/offer-links', owner(), { level: 'CAMPAIGN', objectId: 'nao_existe', offerId: X, belongs: true })).error.details).toEqual({ resource: 'campaign' });
    expect((await call('PUT', '/meta/offer-links', owner(), { level: 'AD', objectId: 'mock_ad_4', offerId: foreignOffer, belongs: true })).error.details).toEqual({ resource: 'offer' });
    const r = await ads(`offerId=${X}&limit=1`, users.client.token);
    expect(r.data[0].offer.canEdit).toBe(false);
  });

  it('GET /meta/campaigns?offerId: grupo pela mistura dos anúncios (offerMix) e detalhe com offer', async () => {
    const r = await call('GET', `/meta/campaigns?offerId=${X}`, owner());
    expect(r.status).toBe(200);
    const k = Object.fromEntries((r.data as { id: string; offerMix: unknown }[]).map((x) => [x.id, x]));
    expect(k.mock_cmp_cbo.offerMix).toEqual({ this: 3, unknown: 0, other: 1 });
    expect(k.mock_cmp_abo.offerMix).toEqual({ this: 0, unknown: 2, other: 2 });
    expect(k.mock_cmp_life.offerMix).toEqual({ this: 1, unknown: 1, other: 0 });
    expect(r.meta.offer).toMatchObject({ offerId: X, counts: { this: 2, unknown: 1, other: 0 }, offerHasUrl: true });
    expect(r.data.map((x: { id: string }) => x.id).slice(-1)).toEqual(['mock_cmp_abo']); // unknown depois dos this
    const unk = await call('GET', `/meta/campaigns?offerId=${X}&offerScope=unknown`, owner());
    expect(unk.data.map((x: { id: string }) => x.id)).toEqual(['mock_cmp_abo']);
    const d = await call('GET', `/meta/campaigns/mock_cmp_cbo?offerId=${X}`, owner());
    expect(d.status).toBe(200);
    expect(d.data.campaign.offerMix).toEqual({ this: 3, unknown: 0, other: 1 });
    const set1 = d.data.adsets.find((a: { id: string }) => a.id === 'mock_adset_cbo_1');
    expect(set1.ads.map((a: Row) => a.offer.fit)).toEqual(['this', 'this', 'other']);
    expect((await call('GET', `/meta/campaigns/mock_cmp_cbo?offerId=${foreignOffer}`, owner())).status).toBe(404);
  });

  it('cache por criativo (§2.2): o próximo sync recebe os links já lidos', async () => {
    const c = await prisma.metaConnection.findUniqueOrThrow({ where: { workspaceId: w1 } });
    const known = await app.get(MetaSyncService).knownCreativeLinks(c);
    expect(known['mock_creative_mock_ad_1']).toEqual({ destinationUrls: ['https://spygram.app/quiz?utm_source=fb&utm_campaign=cbo01'], destinationSource: 'video_cta', urlTags: 'utm_source=facebook&utm_medium=paid' });
    expect(Object.keys(known)).toHaveLength(10);
  });
});
