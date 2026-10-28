import { BrainCache } from './brain.cache';
import {
  BRAIN_MAX_NODES, hookId, montarGrafo, normaliza,
  type BrainDados, type DadosAnuncio, type DadosCriativo, type DadosOferta, type DadosPublicacao,
} from './brain.montagem';
import { BrainService } from './brain.service';

const T0 = new Date('2026-10-22T12:00:00Z');
const ws = (over: Partial<BrainDados['workspace']> = {}): BrainDados['workspace'] => ({
  id: 'w1', name: 'Loja', resultType: null, industry: null, market: null, websiteUrl: null, monthlySpendCapUsd: null, defaultResult: null, ...over,
});
const offer = (id: string, over: Partial<DadosOferta> = {}): DadosOferta => ({
  id, name: `Offer ${id}`, kind: null, language: 'en', what: null, promise: null, offerAndPrice: null, cta: null,
  audience: null, pains: null, proof: null, notes: null, creatives: 0, ...over,
});
let seq = 0;
const creative = (over: Partial<DadosCriativo> & { hook?: string | null; angle?: string | null } = {}): DadosCriativo => {
  const id = `c${++seq}`;
  const { hook, angle, ...rest } = over;
  return {
    id, offerId: 'o1', name: `Creative ${seq}`, adName: null, state: 'RENDER_READY', isWinner: false, origin: 'SCRATCH', variationCode: null,
    engine: null, durationSec: null, thumbKey: null, recency: new Date(T0.getTime() - seq * 1000),
    script: hook === undefined && angle === undefined ? null : { id: `s${seq}`, letter: 'A', angle: angle ?? null, durationSec: 20, editedByUser: false, hook: hook ?? null },
    sourceMetaAdId: null, sourceCreativeId: null, ...rest,
  };
};
const ad = (id: string, over: Partial<DadosAnuncio> = {}): DadosAnuncio => ({
  metaAdId: id, name: `Ad ${id}`, campaignName: 'Camp', adsetName: 'Set', effectiveStatus: 'ACTIVE', verdict: 'OK', trend: null, spend: 10,
  results: 1, cpa: 10, ctr: 1, hookRate: 20, thumbnailUrl: null, videoId: 'v', adCreatedTime: new Date(T0.getTime() - 3 * 86_400_000), ...over,
});
const pub = (id: string, creativeId: string, metaAdId: string, over: Partial<DadosPublicacao> = {}): DadosPublicacao => ({
  id, creativeId, status: 'ACTIVE', metaAdId, publishedAt: T0, activatedAt: T0, byName: 'Gusta', renderFileId: 'f1', ...over,
});
const dados = (over: Partial<BrainDados> = {}): BrainDados => ({
  workspace: ws(), offers: [], creatives: [], metaChampions: [], connection: null, ads: [], publications: [], loadedAt: T0, ...over,
});
const conn = { id: 'mc1', status: 'ACTIVE' as const, adAccountId: 'act_1', currency: 'USD', lastSyncAt: T0 };

const noDangling = (g: ReturnType<typeof montarGrafo>['graph']) => {
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    expect(ids.has(e.from)).toBe(true);
    expect(ids.has(e.to)).toBe(true);
  }
};

describe('Brain 3D: montagem do grafo (brain-3d-v1 §1-2, revisão 22/10)', () => {
  it('workspace novo = só o centro (sem nó fantasma de seção vazia)', () => {
    const { graph } = montarGrafo(dados(), { metaEnabled: true });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: 'workspace:w1', kind: 'workspace', category: 'center', refId: 'w1', weight: 1, winner: false });
    expect(graph.edges).toEqual([]);
    expect(graph.truncated).toBe(false);
    expect(graph.meta).toEqual({ enabled: true, connected: false, lastSyncAt: null });
  });

  it('setup preenchido: negócio, meta, oferta com público/prova/instruções e as arestas part_of/targets/uses_proof/instructed_by', () => {
    const d = dados({
      workspace: ws({ resultType: 'PURCHASE', defaultResult: 'PURCHASES', industry: 'Bedding', monthlySpendCapUsd: 50 }),
      offers: [offer('o1', { audience: 'Moms', pains: 'No time', proof: '10k sold', notes: 'No slang' }), offer('o2')],
    });
    const { graph } = montarGrafo(d, { metaEnabled: true });
    const node = (id: string) => graph.nodes.find((n) => n.id === id)!;
    expect(node('business:w1')).toMatchObject({ category: 'business', meta: { kind: 'business', setupStep: 1 } });
    expect(node('goal:w1')).toMatchObject({ category: 'goals', meta: { spendCapUsd: 50, defaultResult: 'PURCHASES', setupStep: 5 } });
    expect(node('audience:o1')).toMatchObject({ category: 'audience', refId: 'o1', summary: 'Moms · No time', meta: { setupStep: 4 } });
    expect(node('proof:o1').category).toBe('business');
    expect(node('instructions:o1')).toMatchObject({ category: 'business', meta: { setupStep: 4 } });
    expect(graph.nodes.some((n) => n.id === 'audience:o2' || n.id === 'proof:o2')).toBe(false);
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'workspace:w1', to: 'business:w1', kind: 'part_of' },
      { from: 'workspace:w1', to: 'goal:w1', kind: 'part_of' },
      { from: 'workspace:w1', to: 'offer:o1', kind: 'part_of' },
      { from: 'offer:o1', to: 'audience:o1', kind: 'targets' },
      { from: 'offer:o1', to: 'proof:o1', kind: 'uses_proof' },
      { from: 'offer:o1', to: 'instructions:o1', kind: 'instructed_by' },
    ]));
  });

  it('2 criativos com o mesmo gancho (texto normalizado) = 1 nó hook com scripts 2; ângulo vira atributo; roteiro é nó', () => {
    expect(normaliza(' Found   MONEY ')).toBe('found money');
    expect(hookId('You are losing money')).toBe(hookId('  you are  LOSING money'));
    expect(hookId('x')).toMatch(/^hook:[0-9a-f]{12}$/);
    const c1 = creative({ isWinner: true, state: 'APPROVED', hook: 'You are losing money', angle: 'Found money' });
    const c2 = creative({ state: 'RENDER_READY', hook: '  you are  LOSING money', angle: 'Found money', origin: 'VARIATION' });
    const c3 = creative({ state: 'SCRIPTS_READY', hook: 'Stop.', angle: 'Contrarian' });
    const { graph } = montarGrafo(dados({ offers: [offer('o1', { creatives: 3, audience: 'Moms' })], creatives: [c1, c2, c3] }), { metaEnabled: true });
    const hooks = graph.nodes.filter((n) => n.kind === 'hook');
    expect(hooks).toHaveLength(2);
    const h = graph.nodes.find((n) => n.id === hookId('you are losing money'))!;
    expect(h.meta).toEqual({ kind: 'hook', angle: 'Found money', scripts: 2, ads: 0, bestCpa: null, currency: null });
    expect(h.weight).toBe(1);
    expect(graph.counts.hook).toEqual({ total: 2, shown: 2 });
    expect(graph.counts.script).toEqual({ total: 3, shown: 3 });
    expect(graph.nodes.find((n) => n.id === 's1' || n.id === 'script:s1')).toMatchObject({ label: 'Script A', category: 'scripts', meta: { creativeId: c1.id } });
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: `creative:${c1.id}`, to: 'script:s1', kind: 'made_from' },
      { from: 'script:s1', to: h.id, kind: 'opens_with' },
      { from: 'script:s1', to: 'offer:o1', kind: 'for_offer' },
      { from: 'script:s1', to: 'audience:o1', kind: 'speaks_to' },
      { from: h.id, to: 'offer:o1', kind: 'for_offer' },
    ]));
    const cn = (c: DadosCriativo) => graph.nodes.find((n) => n.id === `creative:${c.id}`)!;
    expect(cn(c1)).toMatchObject({ winner: true, weight: 1, meta: { status: 'approved', isWinner: true } });
    expect(cn(c2)).toMatchObject({ winner: false, weight: 0.4, meta: { status: 'in_review' } });
    expect(cn(c3)).toMatchObject({ weight: 0.25, meta: { status: 'draft' } });
    noDangling(graph);
  });

  it('nó creative: label = nome dado pela pessoa (adName só se o nome estiver vazio); meta leva name e adName', () => {
    const comAd = creative({ name: 'Mãe que achou dinheiro', adName: 'BR_ADS_017' });
    const semAd = creative({ name: 'Rascunho 2', adName: null });
    const semNome = creative({ name: '   ', adName: 'BR_ADS_018' });
    const vazio = creative({ name: '', adName: null });
    const { graph } = montarGrafo(dados({ offers: [offer('o1', { creatives: 4 })], creatives: [comAd, semAd, semNome, vazio] }), { metaEnabled: false });
    const no = (id: string) => graph.nodes.find((n) => n.id === `creative:${id}`)!;
    expect(no(comAd.id)).toMatchObject({ label: 'Mãe que achou dinheiro', meta: { kind: 'creative', name: 'Mãe que achou dinheiro', adName: 'BR_ADS_017' } });
    expect(no(semAd.id)).toMatchObject({ label: 'Rascunho 2', meta: { name: 'Rascunho 2', adName: null } });
    expect(no(semNome.id)).toMatchObject({ label: 'BR_ADS_018', meta: { name: '   ', adName: 'BR_ADS_018' } });
    expect(no(vazio.id).label).toBe(vazio.id);
  });

  it('Meta: publicação vira aresta published_as (nunca nó); iterated_from; uses_hook; anúncio sem elo liga part_of ao centro', () => {
    const c = creative({ state: 'APPROVED', hook: 'Hook A', angle: 'Ang' });
    const iter = creative({ state: 'RENDER_READY', origin: 'VARIATION', sourceMetaAdId: 'a1' });
    const fromLib = creative({ state: 'RENDER_READY', origin: 'VARIATION', sourceCreativeId: c.id });
    const d = dados({
      offers: [offer('o1')], creatives: [c, iter, fromLib], connection: conn,
      ads: [ad('a1', { verdict: 'WINNER', spend: 5, cpa: 4 }), ad('a2', { spend: 50, cpa: 9 }), ad('a3', { spend: 1, videoId: null })],
      publications: [pub('p1', c.id, 'a2'), pub('p2', c.id, 'a404')],
      metaChampions: [{ id: 'ch1', offerId: 'o1', metaAdId: 'a1', hookSpoken: 'hook a' }],
    });
    const { graph } = montarGrafo(d, { metaEnabled: true });
    expect(graph.meta).toEqual({ enabled: true, connected: true, lastSyncAt: T0.toISOString() });
    expect(graph.nodes.some((n) => (n.kind as string) === 'publication')).toBe(false);
    const pubEdge = graph.edges.find((e) => e.kind === 'published_as')!;
    expect(pubEdge).toEqual({
      from: `creative:${c.id}`, to: 'meta_ad:a2', kind: 'published_as',
      publication: { publicationId: 'p1', status: 'ACTIVE', publishedAt: T0.toISOString(), activatedAt: T0.toISOString(), byName: 'Gusta' },
    });
    // publicação cujo anúncio não está no snapshot: sem aresta
    expect(graph.edges.filter((e) => e.kind === 'published_as')).toHaveLength(1);
    const h = hookId('Hook A');
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: `creative:${iter.id}`, to: 'meta_ad:a1', kind: 'iterated_from' },
      { from: `creative:${fromLib.id}`, to: `creative:${c.id}`, kind: 'iterated_from' },
      { from: 'meta_ad:a1', to: h, kind: 'uses_hook' },
      { from: 'meta_ad:a1', to: 'offer:o1', kind: 'for_offer' },
      { from: 'meta_ad:a2', to: 'offer:o1', kind: 'for_offer' },
      { from: 'workspace:w1', to: 'meta_ad:a3', kind: 'part_of' },
    ]));
    expect(graph.edges.some((e) => e.to === 'meta_ad:a1' && e.kind === 'part_of')).toBe(false);
    // gancho do roteiro e do teardown = o mesmo nó; anúncios ligados: a2 (publicado) e a1 (uses_hook)
    expect(graph.nodes.filter((n) => n.kind === 'hook')).toHaveLength(1);
    expect(graph.nodes.find((n) => n.id === h)!.meta).toEqual({ kind: 'hook', angle: 'Ang', scripts: 1, ads: 2, bestCpa: 4, currency: 'USD' });
    const a = (id: string) => graph.nodes.find((n) => n.id === `meta_ad:${id}`)!;
    expect(a('a1')).toMatchObject({ winner: true, weight: 0.7, meta: { championId: 'ch1', fromHookMill: false, daysRunning: 3, isVideo: true } });
    expect(a('a2')).toMatchObject({ weight: 1, meta: { fromHookMill: true, currency: 'USD', ctr: 1 } });
    expect(a('a3').meta).toMatchObject({ isVideo: false });
    expect(graph.nodes.find((n) => n.id === `creative:${c.id}`)!.meta).toMatchObject({ published: true });
    expect(graph.nodes.find((n) => n.id === `creative:${iter.id}`)!.meta).toMatchObject({ sourceMetaAdId: 'a1', published: false });
    noDangling(graph);
  });

  it('META_MODE=off (ou desconectado): sem meta_ad nem arestas da Meta; meta.enabled/connected', () => {
    const c = creative({ state: 'APPROVED', sourceMetaAdId: 'a1' });
    const d = dados({ offers: [offer('o1')], creatives: [c], connection: conn, ads: [ad('a1', { verdict: 'WINNER' })], publications: [pub('p1', c.id, 'a1')] });
    const { graph } = montarGrafo(d, { metaEnabled: false });
    expect(graph.nodes.some((n) => n.kind === 'meta_ad')).toBe(false);
    expect(graph.edges.some((e) => ['published_as', 'uses_hook', 'iterated_from'].includes(e.kind))).toBe(false);
    expect(graph.meta).toEqual({ enabled: false, connected: false, lastSyncAt: null });
    expect(graph.counts.meta_ad).toEqual({ total: 0, shown: 0 });
    expect(graph.nodes.find((n) => n.kind === 'creative')!.meta).toMatchObject({ published: false });
    const g2 = montarGrafo({ ...d, connection: { ...conn, status: 'DISCONNECTED' } }, { metaEnabled: true }).graph;
    expect(g2.nodes.some((n) => n.kind === 'meta_ad')).toBe(false);
    expect(g2.meta).toEqual({ enabled: true, connected: false, lastSyncAt: null });
  });

  it('1 000 criativos → 800 nós, truncated, counts.total real, todo vencedor presente, unidade inteira, sem aresta pendurada', () => {
    const creatives: DadosCriativo[] = [];
    for (let i = 0; i < 1000; i++) {
      creatives.push(creative({ isWinner: i % 50 === 0, state: i % 3 === 0 ? 'APPROVED' : i % 3 === 1 ? 'RENDER_READY' : 'EDIT_PENDING', hook: `Hook ${i % 400}`, angle: `A${i % 7}` }));
    }
    const ads = Array.from({ length: 300 }, (_, i) => ad(`a${i}`, { spend: i, verdict: i % 100 === 7 ? 'WINNER' : 'OK' }));
    const { graph } = montarGrafo(dados({ offers: [offer('o1', { creatives: 1000 })], creatives, connection: conn, ads }), { metaEnabled: true });
    expect(graph.nodes.length).toBeLessThanOrEqual(BRAIN_MAX_NODES);
    expect(graph.nodes.length).toBeGreaterThan(BRAIN_MAX_NODES - 3);
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
    expect(graph.truncated).toBe(true);
    expect(graph.counts.creative.total).toBe(1000);
    expect(graph.counts.script.total).toBe(1000);
    expect(graph.counts.hook.total).toBe(400);
    expect(graph.counts.meta_ad.total).toBe(300);
    const shown = Object.values(graph.counts).reduce((s, v) => s + v.shown, 0);
    expect(shown).toBe(graph.nodes.length);
    for (const c of creatives.filter((c) => c.isWinner)) expect(graph.nodes.some((n) => n.id === `creative:${c.id}`)).toBe(true);
    for (const a of ads.filter((a) => a.verdict === 'WINNER')) expect(graph.nodes.some((n) => n.id === `meta_ad:${a.metaAdId}`)).toBe(true);
    expect(graph.counts.meta_ad.shown).toBeLessThanOrEqual(200);
    // unidade inteira: todo criativo incluído tem o roteiro e o gancho
    for (const n of graph.nodes.filter((n) => n.kind === 'creative')) {
      const c = creatives.find((x) => `creative:${x.id}` === n.id)!;
      expect(graph.nodes.some((x) => x.id === `script:${c.script!.id}`)).toBe(true);
      expect(graph.nodes.some((x) => x.id === hookId(c.script!.hook!))).toBe(true);
    }
    expect(graph.edges.length).toBeLessThanOrEqual(2500);
    noDangling(graph);
  });

  it('ofertas até 30 com total real; sem limites (drawer) = tudo', () => {
    const offers = Array.from({ length: 40 }, (_, i) => offer(`o${i}`));
    const g = montarGrafo(dados({ offers }), { metaEnabled: true }).graph;
    expect(g.counts.offer).toEqual({ total: 40, shown: 30 });
    expect(g.truncated).toBe(true);
    expect(montarGrafo(dados({ offers }), { metaEnabled: true, limitar: false }).graph.counts.offer.shown).toBe(40);
  });

  it('?offerId recorta pros nós ligados àquela oferta + centro/negócio/metas', () => {
    const a = creative({ offerId: 'o1', state: 'APPROVED' });
    const b = creative({ offerId: 'o2', state: 'APPROVED' });
    const d = dados({
      workspace: ws({ industry: 'Bedding' }),
      offers: [offer('o1'), offer('o2', { proof: 'x' })], creatives: [a, b], connection: conn, ads: [ad('a1'), ad('a2'), ad('a3')],
      publications: [pub('p1', a.id, 'a1')], metaChampions: [{ id: 'ch', offerId: 'o2', metaAdId: 'a3', hookSpoken: null }],
    });
    const ids = montarGrafo(d, { metaEnabled: true, offerId: 'o1' }).graph.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['workspace:w1', 'business:w1', 'offer:o1', `creative:${a.id}`, 'meta_ad:a1']));
    expect(ids.some((i) => ['offer:o2', 'proof:o2', `creative:${b.id}`, 'meta_ad:a2', 'meta_ad:a3'].includes(i))).toBe(false);
  });
});

describe('BrainCache (TTL 60 s, fresh 1 por 10 s)', () => {
  it('expira em 60 s e o fresh só derruba a cada 10 s', () => {
    const c = new BrainCache();
    let t = 0;
    c.now = () => t;
    c.set('w1|x', 1);
    t = 59_999;
    expect(c.get('w1|x')).toBe(1);
    t = 60_000;
    expect(c.get('w1|x')).toBeUndefined();
    c.set('w1|x', 3);
    c.set('w2|x', 2);
    expect(c.tryFresh('w1')).toBe(true);
    expect(c.get('w1|x')).toBeUndefined();
    expect(c.get('w2|x')).toBe(2);
    c.set('w1|x', 4);
    t += 9_999;
    expect(c.tryFresh('w1')).toBe(false);
    expect(c.get('w1|x')).toBe(4);
    t += 1;
    expect(c.tryFresh('w1')).toBe(true);
  });
});

describe('BrainService: consultas (spy do Prisma)', () => {
  it('≤ 10 consultas por montagem, só 3 com a Meta desligada; cache serve a 2ª chamada', async () => {
    let calls = 0;
    const fn = <T>(v: T) => jest.fn(async () => { calls++; return v; });
    const prisma = {
      workspace: { findUnique: fn({ id: 'w1', name: 'Loja', resultType: null, industry: null, market: null, websiteUrl: null, monthlySpendCapUsd: null }) },
      offer: { findMany: fn([]) },
      creative: { findMany: fn([]) },
      metaConnection: { findUnique: fn({ id: 'mc1', status: 'ACTIVE', adAccountId: 'act_1', currency: 'USD', lastSyncAt: null }) },
      metaAdSnapshot: { findMany: fn([]) },
      metaPublication: { findMany: fn([]) },
      champion: { findMany: fn([]) },
    };
    let mode: 'mock' | 'off' = 'mock';
    const svc = new BrainService(prisma as never, { get metaMode() { return mode; } } as never, { signedUrl: async () => 'u' } as never, new BrainCache());
    const auth = { userId: 'u', workspaceId: 'w1', role: 'CLIENT' as const };
    await svc.graph(auth, {});
    expect(calls).toBe(7);
    await svc.graph(auth, {});
    expect(calls).toBe(7);
    mode = 'off';
    calls = 0;
    const g = await svc.graph(auth, {});
    expect(calls).toBe(3);
    expect(g.meta.enabled).toBe(false);
  });
});
