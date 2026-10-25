// Brain 3D v1 (docs/contratos/brain-3d-v1.md, B5) contra o banco LOCAL de teste (maquina_test): GET /brain/graph e
// GET /brain/node/:id com dados Meta gravados direto no banco (sem chamar a Meta): gancho deduplicado, publicação como
// aresta, iterated_from/uses_hook/part_of, mídia do drawer, papéis (CLIENT 200), isolamento de workspace, META_MODE=off.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.META_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { BrainGraph, BrainNodeDetail } from '@maquina/contratos';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { AppConfig } from '../config/app-config';
import { configureApp } from '../main';
import { hookId } from './brain.montagem';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PREFIX = `brain-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'client' | 'other';
const METRICS = (spend: number, cpa: number | null) => ({ spend, impressions: 1000, clicks: 10, ctr: 1, results: cpa ? Math.round(spend / cpa) : 0, resultType: 'omni_purchase', cpa, roas: null, plays2s: 300, hookRate: 30, thruplays: 50, frequency: null });

describe(isLocal ? 'Brain 3D v1 (integração local)' : 'Brain 3D v1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base = '';
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string;
  let w2: string;
  let offerId: string;
  let otherOfferId: string;
  let c1: string;
  let c2: string;
  const HOOK = 'You are wasting money on sheets';

  const call = async <T = unknown>(path: string, token: string) => {
    const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    const json = await r.json().catch(() => null);
    return { status: r.status, data: json?.data as T, error: json?.error };
  };
  const graph = (token: string, qs = '') => call<BrainGraph>(`/brain/graph${qs}`, token);
  const node = (token: string, id: string) => call<BrainNodeDetail>(`/brain/node/${encodeURIComponent(id)}`, token);

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`;

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'client', 'other'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Brain ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}loja`, shortCode: 'BR', businessType: 'ONLINE_STORE', industry: 'Bedding', market: 'United States', monthlySpendCapUsd: 500,
        onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: [{ userId: users.owner.id, role: 'OWNER', tourCompletedAt: new Date() }, { userId: users.client.id, role: 'CLIENT', tourCompletedAt: new Date() }] },
      },
    })).id;
    w2 = (await prisma.workspace.create({
      data: { name: `${PREFIX}vazio`, shortCode: 'VZ', memberships: { create: [{ userId: users.other.id, role: 'OWNER', tourCompletedAt: new Date() }] } },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[k].email, password: PASSWORD }) });
      expect(r.status).toBe(200);
      users[k].token = (await r.json()).data.accessToken;
    }
    const owner = users.owner.id;
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Sheets', language: 'en', what: 'Bamboo sheets', promise: 'Sleep cooler', audience: 'Hot sleepers', proof: '4.8 stars', notes: 'No slang', createdById: owner } })).id;
    otherOfferId = (await prisma.offer.create({ data: { workspaceId: w2, name: 'Other', language: 'en', createdById: users.other.id } })).id;

    const file = (kind: 'RENDER_VIDEO' | 'CHAMPION_VIDEO' | 'THUMBNAIL', ext: string) =>
      prisma.file.create({ data: { workspaceId: w1, kind, storageKey: `ws/${w1}/${kind.toLowerCase()}/${RUN}-${Math.random().toString(36).slice(2)}.${ext}`, mimeType: ext === 'mp4' ? 'video/mp4' : 'image/jpeg', sizeBytes: 1000 } });

    // conexão Meta + 3 anúncios: a1 WINNER (importado como campeão, com teardown), a2 publicado pelo HookMill, a3 sem elo
    const conn = await prisma.metaConnection.create({ data: { workspaceId: w1, status: 'ACTIVE', metaUserId: 'mu', metaUserName: 'Meta User', adAccountId: 'act_1', adAccountName: 'Conta', currency: 'USD', lastSyncAt: new Date(), connectedById: owner } });
    const snap = (metaAdId: string, verdict: 'WINNER' | 'OK', spend: number, cpa: number | null) => prisma.metaAdSnapshot.create({
      data: {
        workspaceId: w1, connectionId: conn.id, adAccountId: 'act_1', metaAdId, name: `Ad ${metaAdId}`, effectiveStatus: 'ACTIVE', campaignId: 'cmp', campaignName: 'Camp',
        adsetId: 'as', adsetName: 'Set', videoId: `v-${metaAdId}`, thumbnailUrl: `https://meta.example/${metaAdId}.jpg`, metrics: METRICS(spend, cpa), metrics7d: METRICS(spend / 4, cpa), metricsPrev7d: METRICS(spend / 4, cpa),
        verdict, adCreatedTime: new Date(Date.now() - 5 * 86_400_000), syncedAt: new Date(),
      },
    });
    await snap(`${RUN}a1`, 'WINNER', 100, 5);
    await snap(`${RUN}a2`, 'OK', 40, 8);
    await snap(`${RUN}a3`, 'OK', 1, null);
    const champVideo = await file('CHAMPION_VIDEO', 'mp4');
    const ch = await prisma.champion.create({ data: { workspaceId: w1, offerId, name: 'From Meta', status: 'READY', rights: 'OWN', metaAdId: `${RUN}a1`, metaAdAccountId: 'act_1', videoFileId: champVideo.id, createdById: owner } });
    await prisma.teardown.create({ data: { workspaceId: w1, championId: ch.id, sections: { hook: { status: 'ok', naReason: null, data: { endSec: 2, visual: 'x', onScreenText: null, spoken: `  ${HOOK.toUpperCase()} ` } } } } });

    // c1: vencedor APPROVED com roteiro (gancho HOOK) e render final, publicado como a2
    const mkCreative = async (name: string, data: Record<string, unknown>) => {
      const c = await prisma.creative.create({ data: { workspaceId: w1, offerId, name, language: 'en', createdById: owner, ...data } });
      const s = await prisma.script.create({ data: { workspaceId: w1, creativeId: c.id, letter: 'A', status: 'READY', angle: 'Found money', durationSec: 20, blocks: [{ label: 'hook', startSec: 0, endSec: 2, speech: HOOK, visualPrompt: '' }] } });
      await prisma.creative.update({ where: { id: c.id }, data: { selectedScriptId: s.id } });
      return c.id;
    };
    c1 = await mkCreative('Winner', { state: 'APPROVED', isWinner: true, winnerMarkedAt: new Date(), approvedAt: new Date(), approvedById: owner, adName: `BR_${RUN}_A` });
    const renderFile = await file('RENDER_VIDEO', 'mp4');
    const render = await prisma.render.create({ data: { workspaceId: w1, creativeId: c1, status: 'READY', settings: {}, input: {}, fileId: renderFile.id, durationSec: 20 } });
    await prisma.creative.update({ where: { id: c1 }, data: { finalRenderId: render.id } });
    await prisma.costEntry.create({ data: { workspaceId: w1, creativeId: c1, provider: 'ANTHROPIC', kind: 'LLM', model: 'm', units: 1, unit: 'call', amountUsd: 1.25 } });
    await prisma.metaPublication.create({
      data: { workspaceId: w1, connectionId: conn.id, creativeId: c1, status: 'ACTIVE', adAccountId: 'act_1', pageId: 'pg', settings: {}, renderFileId: renderFile.id, metaAdId: `${RUN}a2`, publishedAt: new Date(), activatedAt: new Date(), createdById: owner },
    });
    // c2: variação do campeão importado de a1 (POST /iterate { metaAdId }), mesmo gancho (SWAP_AVATAR)
    c2 = await mkCreative('Swap', { state: 'RENDER_READY', origin: 'VARIATION', championId: ch.id, variationKind: 'SWAP_AVATAR' });
  });

  afterAll(async () => {
    await prisma.creative.updateMany({ where: { workspaceId: { in: [w1, w2] } }, data: { finalRenderId: null, selectedScriptId: null, thumbnailFileId: null } });
    await prisma.metaPublication.deleteMany({ where: { workspaceId: w1 } });
    await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2] } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('workspace novo (só uma oferta vazia) = centro + oferta, sem nó de setup vazio', async () => {
    const r = await graph(users.other.token);
    expect(r.status).toBe(200);
    expect(r.data.nodes.map((n) => n.id)).toEqual([`workspace:${w2}`, `offer:${otherOfferId}`]);
    expect(r.data.edges).toEqual([{ from: `workspace:${w2}`, to: `offer:${otherOfferId}`, kind: 'part_of' }]);
    expect(r.data.meta).toEqual({ enabled: true, connected: false, lastSyncAt: null });
  });

  it('grafo cheio: gancho deduplicado (roteiro + teardown), publicação = aresta, iterated_from, uses_hook, part_of', async () => {
    const r = await graph(users.owner.token);
    expect(r.status).toBe(200);
    const g = r.data;
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      `workspace:${w1}`, `business:${w1}`, `goal:${w1}`, `offer:${offerId}`, `audience:${offerId}`, `proof:${offerId}`, `instructions:${offerId}`,
      `creative:${c1}`, `creative:${c2}`, `meta_ad:${RUN}a1`, `meta_ad:${RUN}a2`, `meta_ad:${RUN}a3`,
    ]));
    expect(g.nodes.every((n) => n.category && n.refId && typeof n.winner === 'boolean')).toBe(true);
    const hooks = g.nodes.filter((n) => n.kind === 'hook');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe(hookId(HOOK));
    expect(hooks[0].meta).toMatchObject({ angle: 'Found money', scripts: 2, ads: 2, bestCpa: 5, currency: 'USD' });
    const pubEdges = g.edges.filter((e) => e.kind === 'published_as');
    expect(pubEdges).toEqual([expect.objectContaining({ from: `creative:${c1}`, to: `meta_ad:${RUN}a2`, publication: expect.objectContaining({ status: 'ACTIVE', byName: 'Brain owner' }) })]);
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: `creative:${c2}`, to: `meta_ad:${RUN}a1`, kind: 'iterated_from' },
      { from: `meta_ad:${RUN}a1`, to: hookId(HOOK), kind: 'uses_hook' },
      { from: `workspace:${w1}`, to: `meta_ad:${RUN}a3`, kind: 'part_of' },
    ]));
    const cr = (id: string) => g.nodes.find((n) => n.id === `creative:${id}`)!;
    expect(cr(c1)).toMatchObject({ winner: true, meta: { status: 'approved', published: true, durationSec: 20 } });
    expect(cr(c2).meta).toMatchObject({ status: 'in_review', sourceMetaAdId: `${RUN}a1`, published: false });
    expect(g.nodes.find((n) => n.id === `meta_ad:${RUN}a1`)).toMatchObject({ winner: true, meta: { fromHookMill: false, isVideo: true, daysRunning: 5 } });
    expect(g.meta).toMatchObject({ enabled: true, connected: true });
    expect(g.meta.lastSyncAt).toEqual(expect.any(String));
    expect(g.truncated).toBe(false);
    const nodeIds = new Set(ids);
    for (const e of g.edges) expect(nodeIds.has(e.from) && nodeIds.has(e.to)).toBe(true);
  });

  it('CLIENT: 200 no grafo e no drawer', async () => {
    expect((await graph(users.client.token)).status).toBe(200);
    expect((await node(users.client.token, `creative:${c1}`)).status).toBe(200);
  });

  it('?offerId: 200 na própria, 404 em oferta de outro workspace, 400 malformado', async () => {
    const r = await graph(users.owner.token, `?offerId=${offerId}`);
    expect(r.status).toBe(200);
    expect(r.data.nodes.some((n) => n.id === `meta_ad:${RUN}a3`)).toBe(false);
    expect((await graph(users.owner.token, `?offerId=${otherOfferId}`)).status).toBe(404);
    const bad = await graph(users.owner.token, '?offerId=bad%20id!');
    expect(bad.status).toBe(400);
    expect(bad.error.code).toBe('VALIDATION_ERROR');
    expect((await graph(users.owner.token, '?fresh=2')).status).toBe(400);
  });

  it('drawer: mídia do criativo e dos anúncios (render publicado, vídeo do campeão, terceiros sem vídeo), custo, vizinhos, open', async () => {
    const c = await node(users.owner.token, `creative:${c1}`);
    expect(c.status).toBe(200);
    expect(c.data.media?.videoUrl).toEqual(expect.any(String));
    expect(c.data.fields).toEqual(expect.arrayContaining([{ key: 'creative.costUsd', value: 1.25 }]));
    expect(c.data.open).toEqual({ route: 'creative', id: c1 });
    expect(c.data.neighbors.some((x) => x.edge === 'published_as' && x.id === `meta_ad:${RUN}a2`)).toBe(true);

    const a2 = await node(users.owner.token, `meta_ad:${RUN}a2`);
    expect(a2.data.media?.videoUrl).toContain(`${w1}/render_video/`);
    const a1 = await node(users.owner.token, `meta_ad:${RUN}a1`);
    expect(a1.data.media?.videoUrl).toContain(`${w1}/champion_video/`);
    expect(a1.data.open).toEqual({ route: 'campaigns', id: `${RUN}a1` });
    const a3 = await node(users.owner.token, `meta_ad:${RUN}a3`);
    expect(a3.data.media).toEqual({ videoUrl: null, posterUrl: `https://meta.example/${RUN}a3.jpg` });

    const s = await node(users.owner.token, `audience:${offerId}`);
    expect(s.data.open).toEqual({ route: 'setup', step: 4 });
    const h = await node(users.owner.token, hookId(HOOK));
    expect(h.data.open).toBeNull();
    const scriptId = (await prisma.creative.findUnique({ where: { id: c1 } }))!.selectedScriptId!;
    const sc = await node(users.owner.token, `script:${scriptId}`);
    expect(sc.data.open).toEqual({ route: 'creative', id: c1, step: 'scripts' });
    expect(JSON.parse(String(sc.data.fields.find((f) => f.key === 'script.blocks')!.value))[0].speech).toBe(HOOK);
  });

  it('drawer: 400 em kind/formato inválido; 404 em nó de outro workspace ou inexistente', async () => {
    expect((await node(users.owner.token, 'champion:x')).status).toBe(400);
    expect((await node(users.owner.token, 'semformato')).status).toBe(400);
    expect((await node(users.other.token, `creative:${c1}`)).status).toBe(404);
    expect((await node(users.other.token, `workspace:${w1}`)).status).toBe(404);
    expect((await node(users.owner.token, 'creative:nao-existe')).status).toBe(404);
  });

  it('?fresh=1 relê (criativo novo aparece); sem fresh serve o cache', async () => {
    const before = (await graph(users.owner.token)).data.counts.creative.total;
    await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Draft', language: 'en', createdById: users.owner.id } });
    expect((await graph(users.owner.token)).data.counts.creative.total).toBe(before);
    expect((await graph(users.owner.token, '?fresh=1')).data.counts.creative.total).toBe(before + 1);
  });

  it('META_MODE=off: 200 sem meta_ad; drawer de anúncio 404', async () => {
    const config = app.get(AppConfig);
    Object.defineProperty(config, 'metaMode', { get: () => 'off', configurable: true });
    try {
      const r = await graph(users.owner.token);
      expect(r.status).toBe(200);
      expect(r.data.nodes.some((n) => n.kind === 'meta_ad')).toBe(false);
      expect(r.data.edges.some((e) => ['published_as', 'uses_hook'].includes(e.kind))).toBe(false);
      expect(r.data.meta).toEqual({ enabled: false, connected: false, lastSyncAt: null });
      expect((await node(users.owner.token, `meta_ad:${RUN}a1`)).status).toBe(404);
    } finally {
      delete (config as unknown as Record<string, unknown>).metaMode;
    }
  });
});
