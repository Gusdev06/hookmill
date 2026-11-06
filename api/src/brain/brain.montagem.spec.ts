import { BrainCache } from './brain.cache';
import {
  BRAIN_MAX_NODES, BRAIN_MAX_SETUP_DETAIL, dividirItens, hookId, itemHash, montarGrafo, normaliza, normalizaUrl,
  type BrainDados, type DadosAnuncio, type DadosBrandAsset, type DadosCriativo, type DadosOferta, type DadosPublicacao,
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

  it('invalidate (brain-preenchido-v1) derruba só o workspace, sem esperar os 10 s do fresh', () => {
    const c = new BrainCache();
    c.set('w1|dados|1', 1);
    c.set('w1|graph|1||0', 2);
    c.set('w10|dados|1', 3);
    c.set('w2|dados|1', 4);
    expect(c.tryFresh('w1')).toBe(true);
    c.set('w1|dados|1', 5);
    c.invalidate('w1');
    c.invalidate('w1');
    expect(c.get('w1|dados|1')).toBeUndefined();
    expect(c.get('w1|graph|1||0')).toBeUndefined();
    expect(c.get('w10|dados|1')).toBe(3);
    expect(c.get('w2|dados|1')).toBe(4);
    // o invalidate não mexe no relógio do fresh
    expect(c.tryFresh('w1')).toBe(false);
  });
});

describe('BrainService: consultas (spy do Prisma)', () => {
  it('≤ 10 consultas por montagem (9 com o kit, brain-preenchido-v1), só 5 com a Meta desligada (lotes: lacunas-home-eddy-v1 §3.2); cache serve a 2ª chamada', async () => {
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
      variationBatch: { findMany: fn([]) },
      brandAsset: { findMany: fn([]) }, // brain-preenchido-v1
    };
    let mode: 'mock' | 'off' = 'mock';
    const svc = new BrainService(prisma as never, { get metaMode() { return mode; } } as never, { signedUrl: async () => 'u' } as never, new BrainCache());
    const auth = { userId: 'u', workspaceId: 'w1', role: 'CLIENT' as const };
    await svc.graph(auth, {});
    expect(calls).toBe(9);
    await svc.graph(auth, {});
    expect(calls).toBe(9);
    mode = 'off';
    calls = 0;
    const g = await svc.graph(auth, {});
    expect(calls).toBe(5);
    expect(g.meta.enabled).toBe(false);
  });
});

// ───────────────────────── brain-preenchido-v1 (04/11) ─────────────────────────
const asset = (id: string, kind: DadosBrandAsset['kind'], over: Partial<DadosBrandAsset> = {}, mime = kind === 'DEMO_VIDEO' ? 'video/mp4' : 'image/png'): DadosBrandAsset => ({
  id, kind, label: null, offerId: null, colors: [], createdAt: new Date(T0.getTime() - 1000 * Number(id.replace(/\D/g, '') || 0)), offerName: null,
  file: { storageKey: `k/${id}`, mimeType: mime, sizeBytes: 10, durationSec: kind === 'DEMO_VIDEO' ? 12 : null }, ...over,
});
const leitura = (pages: [string, string][], readAt = T0.toISOString()) => ({
  pages: pages.map(([url, role]) => ({ url, role: role as never, via: 'rendered' as const, chars: 100 })), fieldOrigins: {}, imagesRead: 1, readAt,
});
const novos = (g: ReturnType<typeof montarGrafo>['graph']) =>
  g.nodes.filter((n) => ['brand_asset', 'brand_color', 'offer_field', 'pain', 'proof_item', 'source'].includes(n.kind));

describe('Brain preenchido v1: divisão de itens e URL (§2, §4)', () => {
  it('exemplos do contrato', () => {
    expect(dividirItens('Falta de tempo\nCansaço\n- Dinheiro curto', 8)).toEqual(['Falta de tempo', 'Cansaço', 'Dinheiro curto']);
    expect(dividirItens('Sem tempo; sem dinheiro; sem foco', 8)).toEqual(['Sem tempo', 'sem dinheiro', 'sem foco']);
    expect(dividirItens('Já tentou de tudo. Nada funcionou! E o tempo passa.', 8)).toEqual(['Já tentou de tudo.', 'Nada funcionou!', 'E o tempo passa.']);
    expect(dividirItens('Mais de 10.000 alunas', 8)).toEqual(['Mais de 10.000 alunas']);
  });

  it('bullets inline, marcador numérado, deduplicação, teto, curtos e vazio', () => {
    expect(dividirItens('• Sem tempo • Sem dinheiro • sem   TEMPO', 8)).toEqual(['Sem tempo', 'Sem dinheiro']);
    expect(dividirItens('Dor A - Dor B – Dor C', 8)).toEqual(['Dor A', 'Dor B', 'Dor C']);
    expect(dividirItens('1. Primeira,\r\n2) Segunda;\n\n', 8)).toEqual(['Primeira', 'Segunda']);
    expect(dividirItens(Array.from({ length: 12 }, (_, i) => `Item ${i}`).join('\n'), 8)).toHaveLength(8);
    expect(dividirItens('ok', 8)).toEqual(['ok']);
    expect(dividirItens('  ', 8)).toEqual([]);
    expect(dividirItens(null, 8)).toEqual([]);
  });

  it('normalizaUrl: sem protocolo, www, / final, hash e porta padrão; query fica; inválida = null', () => {
    expect(normalizaUrl('https://x.com')!.key).toBe('x.com');
    expect(normalizaUrl('https://www.X.com/')!.hash).toBe(normalizaUrl('http://x.com:80')!.hash);
    expect(normalizaUrl('https://heirloomjar.com/quiz/3/?a=1#top')!.key).toBe('heirloomjar.com/quiz/3?a=1');
    expect(normalizaUrl('https://x.com:8443/a')!.key).toBe('x.com:8443/a');
    expect(normalizaUrl('nada')).toBeNull();
    expect(normalizaUrl('ftp://x.com')).toBeNull();
  });
});

describe('Brain preenchido v1: nós e arestas novos (§1, §3, §5)', () => {
  it('site e página iguais = 1 nó source (isWebsite + roles main); página da oferta liga read_from na oferta e no negócio', () => {
    const o = offer('o1', { readMeta: leitura([['https://x.com/quiz/1', 'quiz_step'], ['https://www.x.com/', 'main']]) });
    const { graph } = montarGrafo(dados({ workspace: ws({ websiteUrl: 'https://x.com' }), offers: [o] }), { metaEnabled: false });
    const fontes = graph.nodes.filter((n) => n.kind === 'source');
    expect(fontes).toHaveLength(2);
    const site = fontes.find((n) => n.meta.kind === 'source' && n.meta.isWebsite)!;
    expect(site).toMatchObject({ label: 'x.com', summary: 'https://x.com', weight: 0.45, category: 'business', needsYou: false, statusLabel: null,
      meta: { kind: 'source', url: 'https://x.com', host: 'x.com', roles: ['main'], offers: 1, readAt: T0.toISOString() } });
    // main entra primeiro mesmo gravado depois
    expect(graph.nodes.findIndex((n) => n.id === site.id)).toBeLessThan(graph.nodes.findIndex((n) => n.label === 'x.com/quiz/1'));
    const quiz = fontes.find((n) => n.label === 'x.com/quiz/1')!;
    expect(quiz).toMatchObject({ weight: 0.3, refId: normalizaUrl('https://x.com/quiz/1')!.hash, meta: { isWebsite: false, roles: ['quiz_step'] } });
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'business:w1', to: site.id, kind: 'read_from' },
      { from: 'business:w1', to: quiz.id, kind: 'read_from' },
      { from: 'offer:o1', to: site.id, kind: 'read_from' },
      { from: 'offer:o1', to: quiz.id, kind: 'read_from' },
    ]));
    expect(graph.counts.source).toEqual({ total: 2, shown: 2 });
    noDangling(graph);
  });

  it('negócio entra só com kit ou fonte (rótulo: host da 1ª fonte, senão nome do cliente)', () => {
    const soKit = montarGrafo(dados({ brandAssets: [asset('a1', 'FILE')] }), { metaEnabled: false }).graph;
    expect(soKit.nodes.find((n) => n.kind === 'business')).toMatchObject({ label: 'Loja' });
    const soFonte = montarGrafo(dados({ offers: [offer('o1', { readMeta: leitura([['https://www.lp.com/a', 'main']]) })] }), { metaEnabled: false }).graph;
    expect(soFonte.nodes.find((n) => n.kind === 'business')).toMatchObject({ label: 'lp.com' });
    noDangling(soKit);
    noDangling(soFonte);
  });

  it('kit: LOGO → cores (has_color) e has_brand; asset de oferta → for_offer; sem oferta ou de oferta arquivada → has_brand; rótulos e teto de 8 arquivos', () => {
    const files = Array.from({ length: 10 }, (_, i) => asset(`f${i + 10}`, 'FILE', i === 0 ? { label: 'Banner' } : {}, i === 1 ? 'application/pdf' : 'image/webp'));
    const kit = [
      asset('l1', 'LOGO', { colors: ['#AA0000', '#aa0000', '#00BB00', 'xx'], offerId: 'o1', offerName: 'Offer o1' }),
      asset('v2', 'DEMO_VIDEO', { offerId: 'o1', offerName: 'Offer o1' }),
      asset('v3', 'DEMO_VIDEO', { offerId: 'arquivada', offerName: 'Old' }),
      ...files,
    ];
    const { graph, thumbKeys } = montarGrafo(dados({ offers: [offer('o1')], brandAssets: kit }), { metaEnabled: false });
    const no = (id: string) => graph.nodes.find((n) => n.id === id)!;
    expect(no('brand_asset:l1')).toMatchObject({ label: 'Logo', weight: 0.5, summary: 'Offer o1', meta: { kind: 'brand_asset', assetKind: 'LOGO', customLabel: null, mimeType: 'image/png', durationSec: null } });
    expect(no('brand_color:aa0000')).toMatchObject({ label: '#AA0000', refId: 'aa0000', weight: 0.2, category: 'business', meta: { kind: 'brand_color', hex: '#AA0000' } });
    expect(graph.counts.brand_color).toEqual({ total: 2, shown: 2 });
    expect(no('brand_asset:v2')).toMatchObject({ label: 'Demo video 2', weight: 0.4, meta: { durationSec: 12 } }); // v3 é o mais antigo (n = 1)
    expect(no('brand_asset:f10')).toMatchObject({ label: 'Banner', meta: { customLabel: 'Banner' } });
    expect(graph.counts.brand_asset).toEqual({ total: 13, shown: 11 }); // 1 logo + 2 demos + 8 dos 10 arquivos
    expect(graph.truncated).toBe(true);
    // mais recentes primeiro: os 2 mais antigos (f18, f19) ficam de fora
    expect(graph.nodes.some((n) => n.id === 'brand_asset:f19' || n.id === 'brand_asset:f18')).toBe(false);
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'business:w1', to: 'brand_asset:l1', kind: 'has_brand' }, // logo é da marca toda, mesmo com offerId
      { from: 'brand_asset:l1', to: 'brand_color:aa0000', kind: 'has_color' },
      { from: 'brand_asset:l1', to: 'brand_color:00bb00', kind: 'has_color' },
      { from: 'brand_asset:v2', to: 'offer:o1', kind: 'for_offer' },
      { from: 'business:w1', to: 'brand_asset:v3', kind: 'has_brand' },
      { from: 'business:w1', to: 'brand_asset:f10', kind: 'has_brand' },
    ]));
    expect(graph.edges.some((e) => e.from === 'business:w1' && e.to === 'brand_asset:v2')).toBe(false);
    // miniatura só de imagem (o service assina)
    expect(thumbKeys.get('brand_asset:l1')).toBe('k/l1');
    expect(thumbKeys.has('brand_asset:f11')).toBe(false); // PDF
    expect(thumbKeys.has('brand_asset:v2')).toBe(false);
    // sem teto no drawer
    expect(montarGrafo(dados({ offers: [offer('o1')], brandAssets: kit }), { metaEnabled: false, limitar: false }).graph.counts.brand_asset.shown).toBe(13);
    noDangling(graph);
  });

  it('campos, dores e provas: offer_field por campo preenchido, pain sob audience, proof_item só com ≥ 2 itens', () => {
    const o1 = offer('o1', {
      what: 'Lençol', promise: 'Dorme fresco', cta: '  ', offerAndPrice: 'R$ 99', audience: null, pains: 'Calor\nSuor', proof: 'Mais de 10.000 alunas',
      fieldSources: { what: 'page', promise: 'user' },
    });
    const o2 = offer('o2', { audience: 'Mães', proof: 'Nota 4,8. Mais de 2 mil vendas.' });
    const { graph } = montarGrafo(dados({ offers: [o1, o2] }), { metaEnabled: false });
    const no = (id: string) => graph.nodes.find((n) => n.id === id);
    expect(no('offer_field:o1:what')).toMatchObject({ label: 'Lençol', summary: 'Lençol', weight: 0.35, category: 'offers', refId: 'o1:what',
      meta: { kind: 'offer_field', setupStep: 3, offerId: 'o1', field: 'what', from: 'page' } });
    expect(no('offer_field:o1:promise')!.meta).toMatchObject({ from: 'user' });
    expect(no('offer_field:o1:offerAndPrice')!.meta).toMatchObject({ from: null });
    expect(no('offer_field:o1:cta')).toBeUndefined();
    expect(graph.counts.offer_field).toEqual({ total: 3, shown: 3 });
    // audience sem texto de público: rótulo = nome da oferta (não a 1ª dor)
    expect(no('audience:o1')).toMatchObject({ label: 'Offer o1' });
    const dor = no(`pain:o1:${itemHash('Suor')}`)!;
    expect(dor).toMatchObject({ label: 'Suor', category: 'audience', weight: 0.3, meta: { kind: 'pain', setupStep: 4, offerId: 'o1', index: 1, of: 2 } });
    // 1 prova: o nó proof já é o item
    expect(graph.nodes.some((n) => n.kind === 'proof_item' && n.id.includes('o1'))).toBe(false);
    expect(no('proof:o1')!.label).toBe('Mais de 10.000 alunas');
    // 2 provas: rótulo do pai = 1º item, filhos proof_item
    expect(no('proof:o2')).toMatchObject({ label: 'Nota 4,8.', summary: 'Nota 4,8. Mais de 2 mil vendas.' });
    expect(no(`proof_item:o2:${itemHash('Mais de 2 mil vendas.')}`)).toMatchObject({ category: 'business', meta: { kind: 'proof_item', setupStep: 3, index: 1, of: 2 } });
    expect(graph.counts.pain).toEqual({ total: 2, shown: 2 });
    expect(graph.counts.proof_item).toEqual({ total: 2, shown: 2 });
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'offer:o1', to: 'offer_field:o1:what', kind: 'has_field' },
      { from: 'audience:o1', to: dor.id, kind: 'has_pain' },
      { from: 'proof:o2', to: `proof_item:o2:${itemHash('Nota 4,8.')}`, kind: 'has_proof' },
    ]));
    // mesma dor em 2 ofertas = 2 nós
    const g2 = montarGrafo(dados({ offers: [offer('a', { pains: 'Calor' }), offer('b', { pains: 'calor' })] }), { metaEnabled: false }).graph;
    expect(g2.nodes.filter((n) => n.kind === 'pain')).toHaveLength(2);
    noDangling(graph);
  });

  it('30 ofertas cheias: ≤ 160 nós novos, criativos ainda entram, ordem centro → kit → site → núcleo → detalhe, sem aresta pendurada', () => {
    const offers = Array.from({ length: 30 }, (_, i) => offer(`o${i}`, {
      what: 'W', promise: 'P', offerAndPrice: 'O', cta: 'C', audience: 'A', proof: Array.from({ length: 8 }, (_, j) => `Prova ${j}`).join('\n'),
      pains: Array.from({ length: 10 }, (_, j) => `Dor ${i}-${j}`).join('\n'),
      readMeta: leitura(Array.from({ length: 8 }, (_, j) => [`https://o${i}.com/p${j}`, j === 0 ? 'main' : 'quiz_step'] as [string, string])),
    }));
    const kit = [asset('l1', 'LOGO', { colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] }), ...Array.from({ length: 5 }, (_, i) => asset(`v${i + 2}`, 'DEMO_VIDEO')),
      ...Array.from({ length: 20 }, (_, i) => asset(`f${i + 10}`, 'FILE'))];
    const creatives = Array.from({ length: 900 }, (_, i) => creative({ offerId: `o${i % 30}`, state: i % 2 ? 'APPROVED' : 'RENDER_READY', isWinner: i % 100 === 0 }));
    const { graph } = montarGrafo(dados({ workspace: ws({ websiteUrl: 'https://site.com' }), offers, brandAssets: kit, creatives }), { metaEnabled: false });
    expect(novos(graph).length).toBeLessThanOrEqual(BRAIN_MAX_SETUP_DETAIL);
    expect(novos(graph).length).toBeGreaterThan(BRAIN_MAX_SETUP_DETAIL - 10);
    expect(graph.nodes.length).toBe(BRAIN_MAX_NODES);
    expect(graph.counts.creative.shown).toBeGreaterThanOrEqual(500);
    for (const c of creatives.filter((c) => c.isWinner)) expect(graph.nodes.some((n) => n.id === `creative:${c.id}`)).toBe(true);
    expect(graph.counts.source.shown).toBeLessThanOrEqual(12);
    expect(graph.counts.pain.total).toBe(30 * 8); // teto de 8 por oferta é regra da divisão
    const idx = (pred: (k: string) => boolean) => graph.nodes.findIndex((n) => pred(n.kind));
    expect(idx((k) => k === 'brand_asset')).toBeLessThan(idx((k) => k === 'offer'));
    expect(graph.nodes.findIndex((n) => n.id === 'source:' + normalizaUrl('https://site.com')!.hash)).toBeLessThan(idx((k) => k === 'offer'));
    expect(graph.nodes.findIndex((n) => n.id === 'offer:o29')).toBeLessThan(idx((k) => k === 'offer_field'));
    expect(graph.truncated).toBe(true);
    const shown = Object.values(graph.counts).reduce((s, v) => s + v.shown, 0);
    expect(shown).toBe(graph.nodes.length);
    noDangling(graph);
  });

  it('?offerId recorta kit, páginas, campos, dores e provas pra oferta (o site fica)', () => {
    const d = dados({
      workspace: ws({ websiteUrl: 'https://site.com' }),
      offers: [
        offer('o1', { what: 'W1', pains: 'Dor 1\nDor 2', readMeta: leitura([['https://lp1.com', 'main']]) }),
        offer('o2', { what: 'W2', pains: 'Ela 1\nEla 2', proof: 'Prova 1; Prova 2', readMeta: leitura([['https://lp2.com', 'main']]) }),
      ],
      brandAssets: [asset('a1', 'FILE'), asset('a2', 'FILE', { offerId: 'o1', offerName: 'Offer o1' }), asset('a3', 'FILE', { offerId: 'o2', offerName: 'Offer o2' })],
    });
    const g = montarGrafo(d, { metaEnabled: false, offerId: 'o1' }).graph;
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['brand_asset:a1', 'brand_asset:a2', 'offer_field:o1:what', `source:${normalizaUrl('https://site.com')!.hash}`, `source:${normalizaUrl('https://lp1.com')!.hash}`]));
    expect(ids.some((i) => i.includes('o2') || i === 'brand_asset:a3' || i === `source:${normalizaUrl('https://lp2.com')!.hash}`)).toBe(false);
    expect(g.counts.pain.total).toBe(2);
    expect(g.counts.brand_asset.total).toBe(2);
    expect(g.edges).toEqual(expect.arrayContaining([{ from: 'brand_asset:a2', to: 'offer:o1', kind: 'for_offer' }]));
    noDangling(g);
  });
});
