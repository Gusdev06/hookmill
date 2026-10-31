// Brain 3D v1 (docs/contratos/brain-3d-v1.md §1-2, revisão 22/10 pelo mockup): montagem PURA do grafo a partir das
// linhas já lidas do banco. Sem Prisma, sem I/O: o BrainService lê e chama montarGrafo(); os testes chamam direto.
import { createHash } from 'node:crypto';
import type {
  BrainCategory, BrainCounts, BrainCreativeOrigin, BrainCreativeStatus, BrainEdge, BrainEdgeKind, BrainGraph, BrainNode, BrainNodeKind,
  BrainNodeMeta, BrainPublicationEdgeMeta, ResultType, CreativeState, DefaultResult, Engine, MetaAdTrend, MetaAdVerdict, MetaPublicationStatus,
} from '@maquina/contratos';

// contratos/src/brain.ts (o pacote é só tipos; os valores ficam espelhados aqui)
export const BRAIN_MAX_NODES = 800;
export const BRAIN_MAX_EDGES = 2500;
export const BRAIN_MAX_META_ADS = 200;
export const BRAIN_CACHE_TTL_SEC = 60;
export const BRAIN_NODE_KINDS: readonly BrainNodeKind[] = [
  'workspace', 'business', 'offer', 'audience', 'proof', 'instructions', 'goal', 'hook', 'script', 'creative', 'meta_ad',
];
export const BRAIN_CATEGORY_OF: Readonly<Record<BrainNodeKind, BrainCategory>> = {
  workspace: 'center', business: 'business', proof: 'business', instructions: 'business',
  offer: 'offers', audience: 'audience', goal: 'goals', hook: 'hooks', script: 'scripts', creative: 'creatives', meta_ad: 'meta_ads',
};
/** Limite de ofertas (§1.1: até 30, recentes). */
export const BRAIN_MAX_OFFERS = 30;
/** §2.3: passo do onboarding de cada nó do setup (= BRAIN_ITEM_STEP do web: business 1, offer/proof 3, audience/instructions 4, goal 5). */
export const SETUP_STEP = { business: 1, offer: 3, proof: 3, audience: 4, instructions: 4, goal: 5 } as const;

// ───────────────────────── entrada (linhas já lidas) ─────────────────────────
export interface DadosWorkspace {
  id: string; name: string; /** resultado-v1: o ResultType do cliente */ resultType: ResultType | null; industry: string | null; market: string | null;
  websiteUrl: string | null; monthlySpendCapUsd: number | null; defaultResult: DefaultResult | null;
  /** 29/10 (Loom do Tordan): "100–150 USD"; null = não informado */
  targetCpa?: string | null;
}
export interface DadosOferta {
  id: string; name: string; kind: string | null; language: string;
  what: string | null; promise: string | null; offerAndPrice: string | null; cta: string | null;
  audience: string | null; pains: string | null; proof: string | null; notes: string | null;
  /** criativos não arquivados (qualquer estado) */
  creatives: number;
}
export interface DadosRoteiro {
  id: string; letter: string; angle: string | null; durationSec: number | null; editedByUser: boolean;
  /** blocks[0].speech */
  hook: string | null;
}
export interface DadosCriativo {
  id: string; offerId: string; name: string; adName: string | null; state: CreativeState; isWinner: boolean;
  origin: BrainCreativeOrigin; variationCode: string | null; engine: Engine | null; durationSec: number | null;
  thumbKey: string | null;
  /** ordenação "mais recentes" dentro do grupo */
  recency: Date;
  script: DadosRoteiro | null;
  /** via Creative.championId → Champion */
  sourceMetaAdId: string | null;
  sourceCreativeId: string | null;
}
/** Campeão importado de um anúncio da Meta (Champion.metaAdId != null). */
export interface DadosCampeaoMeta {
  id: string; offerId: string; metaAdId: string;
  /** Teardown.sections.hook.data.spoken */
  hookSpoken: string | null;
}
export interface DadosConexao {
  id: string; status: 'ACTIVE' | 'TOKEN_INVALID' | 'DISCONNECTED'; adAccountId: string | null; currency: string | null; lastSyncAt: Date | null;
}
export interface DadosAnuncio {
  metaAdId: string; name: string; campaignName: string; adsetName: string; effectiveStatus: string; verdict: MetaAdVerdict; trend: MetaAdTrend | null;
  spend: number; results: number | null; cpa: number | null; ctr: number | null; hookRate: number | null;
  thumbnailUrl: string | null; videoId: string | null; adCreatedTime: Date | null;
}
export interface DadosPublicacao {
  id: string; creativeId: string; status: MetaPublicationStatus; metaAdId: string | null; publishedAt: Date | null; activatedAt: Date | null;
  byName: string; renderFileId: string;
}
export interface BrainDados {
  workspace: DadosWorkspace;
  /** ofertas ATIVAS (não arquivadas), mais recentes primeiro */
  offers: DadosOferta[];
  /** criativos não arquivados */
  creatives: DadosCriativo[];
  /** campeões não arquivados vindos da Meta (só com Meta ligada) */
  metaChampions: DadosCampeaoMeta[];
  /** null = sem conexão (ou META_MODE=off: o service nem lê) */
  connection: DadosConexao | null;
  /** snapshots da conta escolhida */
  ads: DadosAnuncio[];
  /** PAUSED/ACTIVE da conexão, mais recentes primeiro */
  publications: DadosPublicacao[];
  loadedAt: Date;
}

export interface OpcoesMontagem {
  metaEnabled: boolean;
  offerId?: string | null;
  /** false = sem teto nem limites por tipo (drawer: todo nó que existe tem detalhe) */
  limitar?: boolean;
  maxNodes?: number;
  maxEdges?: number;
}
export interface Montado {
  graph: BrainGraph;
  /** nó → storageKey da miniatura (o service assina e preenche meta.thumbnailUrl) */
  thumbKeys: Map<string, string>;
}

// ───────────────────────── utilidades ─────────────────────────
export const filled = (v: string | null | undefined): v is string => !!v && v.trim().length > 0;
/** Texto plano numa linha, cortado em `max` caracteres (com reticências). */
export function corta(v: string | null | undefined, max: number): string | null {
  if (!filled(v)) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
/** §1.1 gancho: trim + minúsculas + espaços colapsados. */
export function normaliza(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase();
}
/** §2.1 `hook:<sha1(texto normalizado) 12 hex>` */
export function hookId(v: string): string {
  return `hook:${createHash('sha1').update(normaliza(v)).digest('hex').slice(0, 12)}`;
}
const peso = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
/** nome que a pessoa deu ao criativo; adName só se o nome estiver vazio */
export const creativeLabel = (c: Pick<DadosCriativo, 'id' | 'adName' | 'name'>) =>
  corta(filled(c.name) ? c.name : c.adName, 80) ?? c.id;
export const creativeStatus = (s: CreativeState): BrainCreativeStatus => (s === 'APPROVED' ? 'approved' : s === 'RENDER_READY' ? 'in_review' : 'draft');
const DAY = 86_400_000;

function contagemVazia(): BrainCounts {
  return Object.fromEntries(BRAIN_NODE_KINDS.map((k) => [k, { total: 0, shown: 0 }])) as unknown as BrainCounts;
}

// ───────────────────────── montagem (§1.1-1.3, §2.2) ─────────────────────────
export function montarGrafo(d: BrainDados, opts: OpcoesMontagem): Montado {
  const limitar = opts.limitar !== false;
  const maxNodes = limitar ? opts.maxNodes ?? BRAIN_MAX_NODES : Infinity;
  const maxEdges = limitar ? opts.maxEdges ?? BRAIN_MAX_EDGES : Infinity;
  const counts = contagemVazia();
  const nodes: BrainNode[] = [];
  const byId = new Map<string, BrainNode>();
  const thumbKeys = new Map<string, string>();

  const mk = (kind: BrainNodeKind, key: string, refId: string, label: string, summary: string | null, weight: number, meta: BrainNodeMeta, winner = false): BrainNode => ({
    id: `${kind}:${key}`, kind, category: BRAIN_CATEGORY_OF[kind], refId, label, summary, weight: peso(weight), winner, meta,
  });
  /** Entra a unidade inteira (nós ainda não incluídos) ou nada. false = não coube: a amostragem para. */
  const addUnit = (unit: (BrainNode | null)[], thumb?: [string, string | null]): boolean => {
    const novos = unit.filter((n): n is BrainNode => !!n && !byId.has(n.id));
    const unicos = new Map(novos.map((n) => [n.id, n]));
    if (nodes.length + unicos.size > maxNodes) return false;
    for (const n of unicos.values()) {
      nodes.push(n);
      byId.set(n.id, n);
      counts[n.kind].shown++;
    }
    if (thumb?.[1]) thumbKeys.set(thumb[0], thumb[1]);
    return true;
  };

  // ── escopo (?offerId recorta pros nós ligados àquela oferta + centro/negócio/metas)
  const ws = d.workspace;
  const offerId = opts.offerId ?? null;
  const offers = offerId ? d.offers.filter((o) => o.id === offerId) : d.offers;
  const creatives = offerId ? d.creatives.filter((c) => c.offerId === offerId) : d.creatives;
  const conn = opts.metaEnabled && d.connection?.status === 'ACTIVE' && d.connection.adAccountId ? d.connection : null;
  const currency = conn?.currency ?? null;
  const creativeById = new Map(d.creatives.map((c) => [c.id, c]));
  // publicações com anúncio no snapshot (§1.2 published_as)
  const adIds = new Set(conn ? d.ads.map((a) => a.metaAdId) : []);
  const pubs = conn ? d.publications.filter((p) => p.metaAdId && adIds.has(p.metaAdId)) : [];
  const champsByAd = new Map<string, DadosCampeaoMeta[]>();
  for (const c of conn ? d.metaChampions : []) champsByAd.set(c.metaAdId, [...(champsByAd.get(c.metaAdId) ?? []), c]);
  /** ofertas de um anúncio: a do criativo publicado e a do campeão importado dele */
  const adOffers = new Map<string, Set<string>>();
  const ligaOferta = (adId: string, oid: string | undefined) => {
    if (!oid) return;
    adOffers.set(adId, (adOffers.get(adId) ?? new Set()).add(oid));
  };
  for (const p of pubs) ligaOferta(p.metaAdId!, creativeById.get(p.creativeId)?.offerId);
  for (const [adId, cs] of champsByAd) for (const c of cs) ligaOferta(adId, c.offerId);
  let ads = conn ? d.ads : [];
  if (offerId) ads = ads.filter((a) => adOffers.get(a.metaAdId)?.has(offerId));
  const pubsByAd = new Map<string, DadosPublicacao[]>();
  for (const p of pubs) pubsByAd.set(p.metaAdId!, [...(pubsByAd.get(p.metaAdId!) ?? []), p]);
  const publishedCreatives = new Set(pubs.map((p) => p.creativeId));
  const teardownHooks = (adId: string) => (champsByAd.get(adId) ?? []).map((c) => c.hookSpoken).filter(filled);

  // ── totais reais
  const businessOn = ws.resultType != null || filled(ws.industry) || filled(ws.market) || filled(ws.websiteUrl);
  const goalOn = ws.monthlySpendCapUsd != null || ws.resultType != null || !!ws.targetCpa;
  counts.workspace.total = 1;
  counts.business.total = businessOn ? 1 : 0;
  counts.goal.total = goalOn ? 1 : 0;
  counts.offer.total = offers.length;
  counts.audience.total = offers.filter((o) => filled(o.audience) || filled(o.pains)).length;
  counts.proof.total = offers.filter((o) => filled(o.proof)).length;
  counts.instructions.total = offers.filter((o) => filled(o.notes)).length;
  counts.creative.total = creatives.length;
  counts.script.total = creatives.filter((c) => c.script).length;
  counts.meta_ad.total = ads.length;
  counts.hook.total = new Set([
    ...creatives.map((c) => c.script?.hook).filter(filled).map(normaliza),
    ...ads.flatMap((a) => teardownHooks(a.metaAdId)).map(normaliza),
  ]).size;

  // ── pesos relativos
  const maxCreatives = Math.max(1, ...offers.map((o) => o.creatives));
  const maxSpend = Math.max(0, ...ads.map((a) => a.spend));
  const winnersByOffer = new Map<string, number>();
  for (const c of d.creatives) if (c.isWinner) winnersByOffer.set(c.offerId, (winnersByOffer.get(c.offerId) ?? 0) + 1);
  const offerName = new Map(d.offers.map((o) => [o.id, o.name]));

  // hook: metas finais são calculadas depois (usos, ângulo, anúncios); aqui só o nó-semente
  const hookNode = (text: string): BrainNode => {
    const id = hookId(text);
    return mk('hook', id.slice(5), id.slice(5), corta(text, 80)!, corta(text, 200), 0.2, { kind: 'hook', angle: null, scripts: 0, ads: 0, bestCpa: null, currency });
  };
  const creativeUnit = (c: DadosCriativo): BrainNode[] => {
    const unit: BrainNode[] = [mk('creative', c.id, c.id, creativeLabel(c), corta(offerName.get(c.offerId), 200),
      c.isWinner ? 1 : c.state === 'APPROVED' ? 0.6 : c.state === 'RENDER_READY' ? 0.4 : 0.25,
      {
        kind: 'creative', name: c.name, adName: c.adName, state: c.state, status: creativeStatus(c.state), isWinner: c.isWinner, origin: c.origin, variationCode: c.variationCode,
        offerId: c.offerId, engine: c.engine, durationSec: c.durationSec, thumbnailUrl: null, published: publishedCreatives.has(c.id),
        sourceMetaAdId: c.sourceMetaAdId, sourceCreativeId: c.sourceCreativeId,
      }, c.isWinner)];
    if (c.script) {
      const s = c.script;
      unit.push(mk('script', s.id, s.id, `Script ${s.letter}`, corta(s.hook ?? s.angle, 200), 0.3,
        { kind: 'script', creativeId: c.id, letter: s.letter, angle: s.angle, durationSec: s.durationSec, editedByUser: s.editedByUser }));
      if (filled(s.hook)) unit.push(hookNode(s.hook));
    }
    return unit;
  };
  const adUnit = (a: DadosAnuncio): BrainNode[] => [
    mk('meta_ad', a.metaAdId, a.metaAdId, corta(a.name, 80) ?? a.metaAdId, corta(a.campaignName, 200),
      Math.max(a.verdict === 'WINNER' ? 0.7 : 0, maxSpend > 0 ? a.spend / maxSpend : 0),
      {
        kind: 'meta_ad', verdict: a.verdict, trend: a.trend, effectiveStatus: a.effectiveStatus, spend30d: a.spend, cpa: a.cpa, ctr: a.ctr,
        hookRate: a.hookRate, currency, daysRunning: a.adCreatedTime ? Math.max(0, Math.floor((d.loadedAt.getTime() - a.adCreatedTime.getTime()) / DAY)) : null,
        thumbnailUrl: a.thumbnailUrl, isVideo: a.videoId != null, fromHookMill: pubsByAd.has(a.metaAdId),
        championId: champsByAd.get(a.metaAdId)?.[0]?.id ?? null,
      }, a.verdict === 'WINNER'),
    ...teardownHooks(a.metaAdId).map(hookNode),
  ];

  // ── amostragem por prioridade (§1.3)
  let cheio = false;
  const tenta = (unit: BrainNode[], thumb?: [string, string | null]) => {
    if (cheio) return;
    if (!addUnit(unit, thumb)) cheio = true;
  };
  const desc = <T extends { recency: Date }>(xs: T[]) => [...xs].sort((a, b) => b.recency.getTime() - a.recency.getTime());
  const bySpend = [...ads].sort((a, b) => b.spend - a.spend);
  let adsShown = 0;
  const tentaAd = (a: DadosAnuncio, cap: boolean) => {
    if (cheio || byId.has(`meta_ad:${a.metaAdId}`)) return;
    if (cap && limitar && adsShown >= BRAIN_MAX_META_ADS) return;
    tenta(adUnit(a));
    if (!cheio) adsShown++;
  };
  const tentaCriativo = (c: DadosCriativo) => {
    if (!byId.has(`creative:${c.id}`)) tenta(creativeUnit(c), [`creative:${c.id}`, c.thumbKey]);
  };

  // 1. centro, negócio, metas
  tenta([mk('workspace', ws.id, ws.id, corta(ws.name, 80) ?? ws.id, null, 1, { kind: 'workspace' })]);
  if (businessOn) {
    tenta([mk('business', ws.id, ws.id, corta(ws.industry ?? ws.resultType ?? ws.market ?? ws.websiteUrl, 80)!,
      corta([ws.resultType, ws.industry, ws.market, ws.websiteUrl].filter(filled).join(' · '), 200), 0.5, { kind: 'business', setupStep: SETUP_STEP.business })]);
  }
  if (goalOn) {
    const label = [ws.defaultResult, ws.targetCpa ? `CPA ${ws.targetCpa}` : null, ws.monthlySpendCapUsd != null ? `US$ ${ws.monthlySpendCapUsd}` : null].filter(filled).join(' · ');
    tenta([mk('goal', ws.id, ws.id, label, null, 0.5, { kind: 'goal', setupStep: SETUP_STEP.goal, spendCapUsd: ws.monthlySpendCapUsd, defaultResult: ws.defaultResult })]);
  }
  // 2. ofertas (+ público, provas, instruções)
  for (const o of limitar ? offers.slice(0, BRAIN_MAX_OFFERS) : offers) {
    tenta([
      mk('offer', o.id, o.id, corta(o.name, 80) ?? o.id, corta(o.promise ?? o.what, 200), Math.max(0.4, o.creatives / maxCreatives),
        { kind: 'offer', setupStep: SETUP_STEP.offer, creatives: o.creatives, winners: winnersByOffer.get(o.id) ?? 0 }),
      filled(o.audience) || filled(o.pains)
        ? mk('audience', o.id, o.id, corta(o.audience ?? o.pains, 80)!, corta([o.audience, o.pains].filter(filled).join(' · '), 200), 0.5, { kind: 'audience', setupStep: SETUP_STEP.audience })
        : null,
      filled(o.proof) ? mk('proof', o.id, o.id, corta(o.proof, 80)!, corta(o.proof, 200), 0.5, { kind: 'proof', setupStep: SETUP_STEP.proof }) : null,
      filled(o.notes) ? mk('instructions', o.id, o.id, corta(o.notes, 80)!, corta(o.notes, 200), 0.5, { kind: 'instructions', setupStep: SETUP_STEP.instructions }) : null,
    ].filter((n): n is BrainNode => !!n));
  }
  // 3. criativos vencedores · 4. anúncios WINNER · 5. publicados pelo HookMill · 6. APPROVED · 7. por gasto (até 200)
  // 8. RENDER_READY · 9. demais criativos
  for (const c of desc(creatives.filter((c) => c.isWinner))) tentaCriativo(c);
  for (const a of bySpend.filter((a) => a.verdict === 'WINNER')) tentaAd(a, false);
  for (const a of bySpend.filter((a) => pubsByAd.has(a.metaAdId))) tentaAd(a, false);
  for (const c of desc(creatives.filter((c) => c.state === 'APPROVED'))) tentaCriativo(c);
  for (const a of bySpend) tentaAd(a, true);
  for (const c of desc(creatives.filter((c) => c.state === 'RENDER_READY'))) tentaCriativo(c);
  for (const c of desc(creatives)) tentaCriativo(c);

  // ── arestas (§1.2): só entre nós incluídos, sem repetição, teto 2 500
  const edges: BrainEdge[] = [];
  const seen = new Set<string>();
  const linked = new Set<string>();
  const edge = (from: string, to: string, kind: BrainEdgeKind, publication?: BrainPublicationEdgeMeta) => {
    if (edges.length >= maxEdges || !byId.has(from) || !byId.has(to)) return;
    const k = `${from}|${to}|${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    linked.add(from).add(to);
    edges.push(publication ? { from, to, kind, publication } : { from, to, kind });
  };
  const w = `workspace:${ws.id}`;
  edge(w, `business:${ws.id}`, 'part_of');
  edge(w, `goal:${ws.id}`, 'part_of');
  for (const o of offers) {
    edge(w, `offer:${o.id}`, 'part_of');
    edge(`offer:${o.id}`, `audience:${o.id}`, 'targets');
    edge(`offer:${o.id}`, `proof:${o.id}`, 'uses_proof');
    edge(`offer:${o.id}`, `instructions:${o.id}`, 'instructed_by');
  }
  // gancho: usos, ângulo mais frequente, anúncios e melhor CPA (§2 meta.hook)
  const hookStats = new Map<string, { scripts: number; angles: Map<string, number>; ads: Set<string> }>();
  const stat = (id: string) => hookStats.get(id) ?? hookStats.set(id, { scripts: 0, angles: new Map(), ads: new Set() }).get(id)!;
  for (const c of creatives) {
    const cid = `creative:${c.id}`;
    if (!byId.has(cid)) continue;
    const s = c.script;
    if (s) {
      const sid = `script:${s.id}`;
      edge(cid, sid, 'made_from');
      edge(sid, `offer:${c.offerId}`, 'for_offer');
      edge(sid, `audience:${c.offerId}`, 'speaks_to');
      if (filled(s.hook)) {
        const hid = hookId(s.hook);
        edge(sid, hid, 'opens_with');
        edge(hid, `offer:${c.offerId}`, 'for_offer');
        const st = stat(hid);
        st.scripts++;
        if (filled(s.angle)) st.angles.set(s.angle.trim(), (st.angles.get(s.angle.trim()) ?? 0) + 1);
        for (const p of pubs) if (p.creativeId === c.id && byId.has(`meta_ad:${p.metaAdId}`)) st.ads.add(p.metaAdId!);
      }
    }
    if (c.sourceMetaAdId) edge(cid, `meta_ad:${c.sourceMetaAdId}`, 'iterated_from');
    if (c.sourceCreativeId) edge(cid, `creative:${c.sourceCreativeId}`, 'iterated_from');
  }
  for (const p of pubs) {
    edge(`creative:${p.creativeId}`, `meta_ad:${p.metaAdId}`, 'published_as', {
      publicationId: p.id, status: p.status, publishedAt: p.publishedAt?.toISOString() ?? null, activatedAt: p.activatedAt?.toISOString() ?? null, byName: p.byName,
    });
  }
  for (const a of ads) {
    const aid = `meta_ad:${a.metaAdId}`;
    if (!byId.has(aid)) continue;
    for (const oid of adOffers.get(a.metaAdId) ?? []) edge(aid, `offer:${oid}`, 'for_offer');
    for (const h of teardownHooks(a.metaAdId)) {
      edge(aid, hookId(h), 'uses_hook');
      stat(hookId(h)).ads.add(a.metaAdId);
    }
  }
  // anúncio sem nenhum outro elo → part_of ao centro (nada inventado)
  for (const a of ads) if (byId.has(`meta_ad:${a.metaAdId}`) && !linked.has(`meta_ad:${a.metaAdId}`)) edge(w, `meta_ad:${a.metaAdId}`, 'part_of');

  // ── metas e pesos dos ganchos
  const adByMetaId = new Map(ads.map((a) => [a.metaAdId, a]));
  const usos = (id: string) => (hookStats.get(id)?.scripts ?? 0) + (hookStats.get(id)?.ads.size ?? 0);
  const maxUsos = Math.max(1, ...nodes.filter((n) => n.kind === 'hook').map((n) => usos(n.id)));
  for (const n of nodes) {
    if (n.kind !== 'hook' || n.meta.kind !== 'hook') continue;
    const st = hookStats.get(n.id);
    const cpas = [...(st?.ads ?? [])].map((x) => adByMetaId.get(x)?.cpa).filter((x): x is number => x != null);
    const angle = st ? [...st.angles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null : null;
    n.meta = { kind: 'hook', angle, scripts: st?.scripts ?? 0, ads: st?.ads.size ?? 0, bestCpa: cpas.length ? Math.min(...cpas) : null, currency };
    n.weight = peso(Math.max(0.2, usos(n.id) / maxUsos));
  }

  const truncated = BRAIN_NODE_KINDS.some((k) => counts[k].total > counts[k].shown);
  return {
    graph: {
      generatedAt: d.loadedAt.toISOString(), nodes, edges, counts, truncated,
      meta: { enabled: opts.metaEnabled, connected: !!conn, lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null },
    },
    thumbKeys,
  };
}
