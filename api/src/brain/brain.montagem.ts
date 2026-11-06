// Brain 3D v1 (docs/contratos/brain-3d-v1.md §1-2, revisão 22/10 pelo mockup): montagem PURA do grafo a partir das
// linhas já lidas do banco. Sem Prisma, sem I/O: o BrainService lê e chama montarGrafo(); os testes chamam direto.
import { createHash } from 'node:crypto';
import { statusKeyOf, statusOf } from '../criativos/derivacao';
import { batchNeedsYou, batchStageOf, batchStatusOf, type LoteEtapaIn } from '../iteracao/lote-etapa';
import type {
  BrainCategory, BrainCounts, BrainCreativeOrigin, BrainCreativeStatus, BrainEdge, BrainEdgeKind, BrainGraph, BrainNode, BrainNodeKind,
  BrainNodeMeta, BrainOfferFieldKey, BrainPublicationEdgeMeta, BrainStatusLabel, BrandAssetKind, FieldOrigin, PageRole, ResultType, CreativeState,
  DefaultResult, Engine, MetaAdTrend, MetaAdVerdict, MetaPublicationStatus,
} from '@maquina/contratos';

// contratos/src/brain.ts (o pacote é só tipos; os valores ficam espelhados aqui)
export const BRAIN_MAX_NODES = 800;
export const BRAIN_MAX_EDGES = 2500;
export const BRAIN_MAX_META_ADS = 200;
export const BRAIN_CACHE_TTL_SEC = 60;
/** lacunas-home-eddy-v1 §3.2 */
export const BRAIN_MAX_BATCHES = 20;
/** brain-preenchido-v1 §3: teto somado dos kinds novos (brand_asset, brand_color, offer_field, pain, proof_item, source) */
export const BRAIN_MAX_SETUP_DETAIL = 160;
export const BRAIN_MAX_BRAND_FILES = 8;
export const BRAIN_MAX_SOURCES = 12;
export const BRAIN_MAX_SOURCES_PER_OFFER = 6;
export const BRAIN_MAX_PAINS_PER_OFFER = 8;
export const BRAIN_MAX_PROOFS_PER_OFFER = 8;
export const BRAIN_OFFER_FIELDS: readonly BrainOfferFieldKey[] = ['what', 'promise', 'offerAndPrice', 'cta'];
export const BRAIN_NODE_KINDS: readonly BrainNodeKind[] = [
  'workspace', 'business', 'offer', 'audience', 'proof', 'instructions', 'goal', 'hook', 'script', 'creative', 'meta_ad', 'batch',
  'brand_asset', 'brand_color', 'offer_field', 'pain', 'proof_item', 'source',
];
export const BRAIN_CATEGORY_OF: Readonly<Record<BrainNodeKind, BrainCategory>> = {
  workspace: 'center', business: 'business', proof: 'business', instructions: 'business',
  offer: 'offers', audience: 'audience', goal: 'goals', hook: 'hooks', script: 'scripts', creative: 'creatives', meta_ad: 'meta_ads',
  batch: 'creatives',
  // brain-preenchido-v1: sem categoria nova
  brand_asset: 'business', brand_color: 'business', proof_item: 'business', source: 'business',
  offer_field: 'offers', pain: 'audience',
};
/** kinds do brain-preenchido-v1 que dividem o orçamento BRAIN_MAX_SETUP_DETAIL */
const SETUP_DETAIL_KINDS: ReadonlySet<BrainNodeKind> = new Set(['brand_asset', 'brand_color', 'offer_field', 'pain', 'proof_item', 'source']);
/** Limite de ofertas (§1.1: até 30, recentes). */
export const BRAIN_MAX_OFFERS = 30;
/** §2.3: passo do onboarding de cada nó do setup (= BRAIN_ITEM_STEP do web: business 1, offer/proof 3, audience/instructions 4, goal 5). */
export const SETUP_STEP = { business: 1, offer: 3, proof: 3, audience: 4, instructions: 4, goal: 5, offer_field: 3, pain: 4, proof_item: 3 } as const;

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
  /** brain-preenchido-v1: Offer.fieldSources (page|user por campo); ausente = {} */
  fieldSources?: Partial<Record<string, 'page' | 'user'>>;
  /** brain-preenchido-v1: o recorte de Offer.readMeta que o Brain usa; null/ausente = oferta sem leitura gravada */
  readMeta?: DadosLeitura | null;
}
/** brain-preenchido-v1 §4: recorte de `offers.read_meta` (OfferReadMeta). */
export interface DadosLeitura {
  pages: { url: string; role: PageRole; via: 'http' | 'rendered'; chars: number }[];
  fieldOrigins: Partial<Record<string, FieldOrigin[]>>;
  /** readMeta.imagesRead.length */
  imagesRead: number;
  readAt: string | null;
}
/** brain-preenchido-v1: linha de `brand_assets` + File. */
export interface DadosBrandAsset {
  id: string; kind: BrandAssetKind; label: string | null; offerId: string | null; colors: string[]; createdAt: Date;
  /** nome da oferta do vínculo (mesmo arquivada); null sem vínculo */
  offerName: string | null;
  file: { storageKey: string; mimeType: string; sizeBytes: number; durationSec: number | null };
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
  // lacunas-home-eddy-v1 §3.1 (opcionais pros testes antigos: sem eles = needsYou pelo estado, sem peça AUTO, sem lote)
  updatedAt?: Date;
  variationKind?: string | null;
  /** Creative.variationBatchId */
  batchId?: string | null;
}
/** lacunas-home-eddy-v1 §3.2: lote do Iterate (campeão não arquivado), já filtrado pelo service. */
export interface DadosLote extends LoteEtapaIn {
  id: string; championId: string; championName: string; offerId: string;
  sourceMetaAdId: string | null; sourceCreativeId: string | null;
  /** criativos do lote em APPROVED */
  ready: number;
  thumbKey: string | null;
  createdAt: Date; updatedAt: Date;
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
  /** lacunas-home-eddy-v1 §3.2: lotes (esperando, trabalhando ou dos últimos 14 dias), mais recentes primeiro; ausente = nenhum */
  batches?: DadosLote[];
  /** brain-preenchido-v1: kit da marca (createdAt asc); ausente = nenhum */
  brandAssets?: DadosBrandAsset[];
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
/** §3.1: estados cujo texto leva número ao vivo; no grafo (cache 60 s) vão na variante curta, sem params. */
const SHORT_KEY: Partial<Record<CreativeState, string>> = {
  SCENES_GENERATING: 'status.scenes_generating_short', SCENES_FAILED: 'status.scenes_failed_short', RENDERING: 'status.rendering_short',
};
/** §3.1: needsYou e chip do criativo (a mesma regra do needs_you da Home: waiting/failed, sem rascunho parado, sem peça AUTO). */
export function creativeLive(c: Pick<DadosCriativo, 'state' | 'updatedAt' | 'recency' | 'variationKind'>, now: Date): { needsYou: boolean; statusLabel: BrainStatusLabel } {
  const status = statusOf(c.state, c.updatedAt ?? c.recency, now.getTime());
  const needsYou = (status === 'waiting' || status === 'failed') && c.variationKind !== 'AUTO_EDIT';
  return { needsYou, statusLabel: { key: (status !== 'draft' && SHORT_KEY[c.state]) || statusKeyOf(c.state, status), params: {} } };
}
const DAY = 86_400_000;
const h12 = (v: string) => createHash('sha1').update(v).digest('hex').slice(0, 12);

/**
 * brain-preenchido-v1 §2: divide `pains`/`proof` em itens (regra determinística; o mock do web replica).
 * Linhas (≥ 2) → `;` → bullets inline (≥ 2) → frases. Sem marcador, sem `;`/`,` final, ≥ 3 caracteres, sem repetição, até `max`.
 */
export function dividirItens(texto: string | null | undefined, max: number): string[] {
  if (!filled(texto)) return [];
  const t = texto.replace(/\r\n/g, '\n');
  const linhas = t.split('\n').filter((l) => l.trim().length > 0);
  const BULLET = /\s*•\s*|\s+[-–—]\s+/g;
  let cands: string[];
  if (linhas.length >= 2) cands = linhas;
  else if (t.includes(';')) cands = t.split(';');
  else if ((t.match(BULLET) ?? []).length >= 2) cands = t.split(BULLET);
  else cands = t.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“'¿¡])/u);
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const c of cands) {
    const item = c.replace(/^\s*(?:[-*•·–—]|\d{1,2}[.)])\s+/, '').trim().replace(/[;,]+$/, '').trim();
    if (item.length < 3) continue;
    const k = normaliza(item);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(item);
    if (out.length >= max) break;
  }
  return out.length ? out : [corta(texto, 200)!];
}
/** id estável de um item de dor/prova: sha1 12 hex do texto normalizado. */
export const itemHash = (item: string) => h12(normaliza(item));

/**
 * brain-preenchido-v1 §4: chave da fonte. host minúsculo sem `www.`, path sem `/` final (raiz = vazio), query mantida;
 * hash, protocolo e porta padrão fora. null = URL inválida ou não http(s).
 */
export function normalizaUrl(raw: string | null | undefined): { key: string; hash: string; host: string } | null {
  if (!filled(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.host.toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  const key = `${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  return { key, hash: h12(key), host };
}

/** Uma fonte (site e/ou página lida), já deduplicada pela URL normalizada. */
export interface Fonte {
  hash: string; key: string; host: string; url: string; isWebsite: boolean; roles: PageRole[];
  /** ofertas (do recorte) cuja leitura usou a página, na ordem das ofertas */
  offerIds: string[];
  readAt: string | null;
  /** do 1º ReadPageRef visto; null = só o site do cadastro */
  via: 'http' | 'rendered' | null; chars: number | null;
}
/** Páginas da leitura com `main` primeiro (ordem gravada no resto). */
const paginasDe = (o: DadosOferta) => {
  const ps = o.readMeta?.pages ?? [];
  return [...ps.filter((p) => p.role === 'main'), ...ps.filter((p) => p.role !== 'main')];
};
/** brain-preenchido-v1 §4: fontes do site + páginas lidas das ofertas (ordem: site, depois oferta por oferta). */
export function fontesDe(ws: Pick<DadosWorkspace, 'websiteUrl'>, offers: DadosOferta[]): Map<string, Fonte> {
  const out = new Map<string, Fonte>();
  const site = normalizaUrl(ws.websiteUrl);
  if (site) out.set(site.hash, { ...site, url: ws.websiteUrl!.trim(), isWebsite: true, roles: [], offerIds: [], readAt: null, via: null, chars: null });
  for (const o of offers) {
    for (const p of paginasDe(o)) {
      const n = normalizaUrl(p.url);
      if (!n) continue;
      const f = out.get(n.hash) ?? out.set(n.hash, { ...n, url: p.url, isWebsite: false, roles: [], offerIds: [], readAt: null, via: null, chars: null }).get(n.hash)!;
      if (!f.roles.includes(p.role)) f.roles.push(p.role);
      if (!f.offerIds.includes(o.id)) {
        f.offerIds.push(o.id);
        const at = o.readMeta?.readAt ?? null;
        if (at && (!f.readAt || at > f.readAt)) f.readAt = at;
      }
      if (f.via == null) {
        f.via = p.via;
        f.chars = p.chars;
      }
    }
  }
  return out;
}
/** Hashes das páginas (distintas) que a leitura daquela oferta usou, na ordem (main primeiro). */
export function paginasDaOferta(o: DadosOferta): string[] {
  const out: string[] = [];
  for (const p of paginasDe(o)) {
    const n = normalizaUrl(p.url);
    if (n && !out.includes(n.hash)) out.push(n.hash);
  }
  return out;
}
/** Rótulo do asset do kit: o dado pela pessoa, senão `Logo` / `Brand file <n>` / `Demo video <n>` (n por createdAt asc no kind). */
export function brandAssetLabel(a: DadosBrandAsset, all: DadosBrandAsset[]): string {
  const custom = corta(a.label, 80);
  if (custom) return custom;
  if (a.kind === 'LOGO') return 'Logo';
  const n = [...all].filter((x) => x.kind === a.kind).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).findIndex((x) => x.id === a.id) + 1;
  return a.kind === 'FILE' ? `Brand file ${n}` : `Demo video ${n}`;
}
/** Até 5 cores distintas do logo, `rrggbb` minúsculo. */
export function coresDoLogo(colors: string[]): string[] {
  const out: string[] = [];
  for (const c of colors) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c?.trim() ?? '');
    const h = m?.[1].toLowerCase();
    if (h && !out.includes(h)) out.push(h);
    if (out.length === 5) break;
  }
  return out;
}
const ehImagem = (mime: string) => mime.startsWith('image/');

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
    needsYou: false, statusLabel: null,
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
  const allBatches = d.batches ?? [];
  const batches = offerId ? allBatches.filter((b) => b.offerId === offerId) : allBatches;
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
  // brain-preenchido-v1: kit (recorte: da marca toda ou da oferta do filtro), fontes, itens de dor/prova
  const allAssets = d.brandAssets ?? [];
  const assets = offerId ? allAssets.filter((a) => a.offerId == null || a.offerId === offerId) : allAssets;
  const recentes = (xs: DadosBrandAsset[]) => [...xs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const logo = recentes(assets.filter((a) => a.kind === 'LOGO'))[0] ?? null;
  const logoColors = logo ? coresDoLogo(logo.colors) : [];
  const fontes = fontesDe(ws, offers);
  const painsOf = new Map(offers.map((o) => [o.id, dividirItens(o.pains, BRAIN_MAX_PAINS_PER_OFFER)]));
  const proofsOf = new Map(offers.map((o) => [o.id, dividirItens(o.proof, BRAIN_MAX_PROOFS_PER_OFFER)]));

  // ── totais reais
  const businessOn = ws.resultType != null || filled(ws.industry) || filled(ws.market) || filled(ws.websiteUrl) || assets.length > 0 || fontes.size > 0;
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
  counts.batch.total = batches.length;
  counts.brand_asset.total = assets.filter((a) => a.kind !== 'LOGO').length + (logo ? 1 : 0);
  counts.brand_color.total = logoColors.length;
  counts.offer_field.total = offers.reduce((s, o) => s + BRAIN_OFFER_FIELDS.filter((k) => filled(o[k])).length, 0);
  counts.pain.total = offers.reduce((s, o) => s + painsOf.get(o.id)!.length, 0);
  counts.proof_item.total = offers.reduce((s, o) => s + (proofsOf.get(o.id)!.length >= 2 ? proofsOf.get(o.id)!.length : 0), 0);
  counts.source.total = fontes.size;
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
    Object.assign(unit[0], creativeLive(c, d.loadedAt));
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

  // lacunas-home-eddy-v1 §3.2: nó do lote
  const batchNode = (b: DadosLote): BrainNode => {
    const stage = batchStageOf(b);
    const n = mk('batch', b.id, b.id, corta(b.championName, 80) ?? b.id, corta(offerName.get(b.offerId), 200), batchNeedsYou(stage) ? 0.6 : 0.4, {
      kind: 'batch', mode: b.mode, stage, championId: b.championId, championName: b.championName, offerId: b.offerId,
      sourceMetaAdId: b.sourceMetaAdId, sourceCreativeId: b.sourceCreativeId, pieces: b.pieces, ready: b.ready, thumbnailUrl: null,
      createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    });
    n.needsYou = batchNeedsYou(stage);
    n.statusLabel = batchStatusOf(stage, b.ready);
    return n;
  };

  // ── amostragem por prioridade (§1.3)
  let cheio = false;
  const tenta = (unit: BrainNode[], thumb?: [string, string | null]) => {
    if (cheio) return;
    if (!addUnit(unit, thumb)) cheio = true;
  };
  // brain-preenchido-v1 §3: os kinds novos dividem BRAIN_MAX_SETUP_DETAIL; o que passa é pulado sem marcar `cheio`
  let detalheUsado = 0;
  const tentaDetalhe = (unit: BrainNode[], thumb?: [string, string | null]) => {
    if (cheio) return;
    const novos = new Set(unit.filter((n) => !byId.has(n.id)).map((n) => n.id)).size;
    if (!novos) return;
    if (limitar && detalheUsado + novos > BRAIN_MAX_SETUP_DETAIL) return;
    const antes = nodes.length;
    tenta(unit, thumb);
    detalheUsado += nodes.length - antes;
  };
  const assetNode = (a: DadosBrandAsset): BrainNode => mk('brand_asset', a.id, a.id, brandAssetLabel(a, allAssets), a.offerId ? corta(a.offerName, 200) : null,
    a.kind === 'LOGO' ? 0.5 : 0.4, {
      kind: 'brand_asset', assetKind: a.kind, customLabel: corta(a.label, 80), mimeType: a.file.mimeType, offerId: a.offerId, thumbnailUrl: null,
      durationSec: a.kind === 'DEMO_VIDEO' ? a.file.durationSec : null, createdAt: a.createdAt.toISOString(),
    });
  const assetThumb = (a: DadosBrandAsset): [string, string | null] => [`brand_asset:${a.id}`, ehImagem(a.file.mimeType) ? a.file.storageKey : null];
  const fonteNode = (f: Fonte): BrainNode => mk('source', f.hash, f.hash, corta(f.key, 80) ?? f.host, corta(f.url, 200), f.isWebsite ? 0.45 : 0.3, {
    kind: 'source', url: f.url, host: f.host, isWebsite: f.isWebsite, roles: f.roles, offers: f.offerIds.length, readAt: f.readAt,
  });
  const itemNode = (kind: 'pain' | 'proof_item', o: DadosOferta, item: string, index: number, of: number): BrainNode => {
    const k = `${o.id}:${itemHash(item)}`;
    return mk(kind, k, k, corta(item, 80)!, corta(item, 200), 0.3, { kind, setupStep: SETUP_STEP[kind], offerId: o.id, index, of });
  };
  const fontesNoGrafo = () => counts.source.shown;
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
    // brain-preenchido-v1 §1: sem tipo/setor/mercado/site, o rótulo cai pro host da 1ª fonte e, sem fonte, pro nome do cliente
    const rotulo = [ws.industry, ws.resultType, ws.market, ws.websiteUrl].find(filled) ?? fontes.values().next().value?.host ?? ws.name;
    tenta([mk('business', ws.id, ws.id, corta(rotulo, 80) ?? ws.id,
      corta([ws.resultType, ws.industry, ws.market, ws.websiteUrl].filter(filled).join(' · '), 200), 0.5, { kind: 'business', setupStep: SETUP_STEP.business })]);
  }
  if (goalOn) {
    const label = [ws.defaultResult, ws.targetCpa ? `CPA ${ws.targetCpa}` : null, ws.monthlySpendCapUsd != null ? `US$ ${ws.monthlySpendCapUsd}` : null].filter(filled).join(' · ');
    tenta([mk('goal', ws.id, ws.id, label, null, 0.5, { kind: 'goal', setupStep: SETUP_STEP.goal, spendCapUsd: ws.monthlySpendCapUsd, defaultResult: ws.defaultResult })]);
  }
  // 2. kit da marca: o LOGO com as cores (uma unidade), os DEMO_VIDEO e os FILE (8 mais recentes), mais recentes primeiro
  if (logo) tentaDetalhe([assetNode(logo), ...logoColors.map((h) => mk('brand_color', h, h, `#${h.toUpperCase()}`, null, 0.2, { kind: 'brand_color', hex: `#${h.toUpperCase()}` }))], assetThumb(logo));
  for (const a of recentes(assets.filter((a) => a.kind === 'DEMO_VIDEO'))) tentaDetalhe([assetNode(a)], assetThumb(a));
  {
    const files = recentes(assets.filter((a) => a.kind === 'FILE'));
    for (const a of limitar ? files.slice(0, BRAIN_MAX_BRAND_FILES) : files) tentaDetalhe([assetNode(a)], assetThumb(a));
  }
  // 3. site do cadastro
  for (const f of fontes.values()) if (f.isWebsite) tentaDetalhe([fonteNode(f)]);
  // 4. ofertas (+ público, provas, instruções)
  const ofertasNoGrafo = limitar ? offers.slice(0, BRAIN_MAX_OFFERS) : offers;
  for (const o of ofertasNoGrafo) {
    const provas = proofsOf.get(o.id)!;
    tenta([
      mk('offer', o.id, o.id, corta(o.name, 80) ?? o.id, corta(o.promise ?? o.what, 200), Math.max(0.4, o.creatives / maxCreatives),
        { kind: 'offer', setupStep: SETUP_STEP.offer, creatives: o.creatives, winners: winnersByOffer.get(o.id) ?? 0 }),
      filled(o.audience) || filled(o.pains)
        ? mk('audience', o.id, o.id, corta(o.audience, 80) ?? corta(o.name, 80) ?? o.id, corta([o.audience, o.pains].filter(filled).join(' · '), 200), 0.5, { kind: 'audience', setupStep: SETUP_STEP.audience })
        : null,
      filled(o.proof)
        ? mk('proof', o.id, o.id, corta(provas.length >= 2 ? provas[0] : o.proof, 80)!, corta(o.proof, 200), 0.5, { kind: 'proof', setupStep: SETUP_STEP.proof })
        : null,
      filled(o.notes) ? mk('instructions', o.id, o.id, corta(o.notes, 80)!, corta(o.notes, 200), 0.5, { kind: 'instructions', setupStep: SETUP_STEP.instructions }) : null,
    ].filter((n): n is BrainNode => !!n));
  }
  // 5. detalhe das ofertas incluídas, oferta por oferta: campos, dores, provas (≥ 2) e páginas lidas (6 por oferta, 12 no total)
  for (const o of ofertasNoGrafo) {
    if (!byId.has(`offer:${o.id}`)) continue;
    for (const k of BRAIN_OFFER_FIELDS) {
      const v = o[k];
      if (!filled(v)) continue;
      const from = o.fieldSources?.[k];
      tentaDetalhe([mk('offer_field', `${o.id}:${k}`, `${o.id}:${k}`, corta(v, 80)!, corta(v, 200), 0.35,
        { kind: 'offer_field', setupStep: SETUP_STEP.offer_field, offerId: o.id, field: k, from: from === 'page' || from === 'user' ? from : null })]);
    }
    const dores = painsOf.get(o.id)!;
    if (byId.has(`audience:${o.id}`)) dores.forEach((it, i) => tentaDetalhe([itemNode('pain', o, it, i, dores.length)]));
    const provas = proofsOf.get(o.id)!;
    if (provas.length >= 2 && byId.has(`proof:${o.id}`)) provas.forEach((it, i) => tentaDetalhe([itemNode('proof_item', o, it, i, provas.length)]));
    const paginas = paginasDaOferta(o);
    for (const h of limitar ? paginas.slice(0, BRAIN_MAX_SOURCES_PER_OFFER) : paginas) {
      if (limitar && !byId.has(`source:${h}`) && fontesNoGrafo() >= BRAIN_MAX_SOURCES) break;
      tentaDetalhe([fonteNode(fontes.get(h)!)]);
    }
  }
  // 6. daqui pra frente, como antes
  // 3. criativos vencedores · 4. anúncios WINNER · 5. publicados pelo HookMill · 6. APPROVED · 7. por gasto (até 200)
  // 8. RENDER_READY · 9. demais criativos
  for (const c of desc(creatives.filter((c) => c.isWinner))) tentaCriativo(c);
  // lacunas-home-eddy-v1 §3.2: lotes logo depois dos vencedores (os que esperam a pessoa primeiro), até 20
  {
    const lotes = [...batches].sort((a, b) => Number(batchNeedsYou(batchStageOf(b))) - Number(batchNeedsYou(batchStageOf(a))) || b.updatedAt.getTime() - a.updatedAt.getTime());
    for (const b of limitar ? lotes.slice(0, BRAIN_MAX_BATCHES) : lotes) tenta([batchNode(b)], [`batch:${b.id}`, b.thumbKey]);
  }
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
  // brain-preenchido-v1 §5: kit, cores, campos, dores, provas e fontes
  const biz = `business:${ws.id}`;
  for (const a of assets) {
    const aid = `brand_asset:${a.id}`;
    if (!byId.has(aid)) continue;
    if (a.kind !== 'LOGO' && a.offerId && byId.has(`offer:${a.offerId}`)) edge(aid, `offer:${a.offerId}`, 'for_offer');
    else edge(biz, aid, 'has_brand');
  }
  if (logo) for (const h of logoColors) edge(`brand_asset:${logo.id}`, `brand_color:${h}`, 'has_color');
  for (const o of offers) {
    for (const k of BRAIN_OFFER_FIELDS) edge(`offer:${o.id}`, `offer_field:${o.id}:${k}`, 'has_field');
    for (const it of painsOf.get(o.id)!) edge(`audience:${o.id}`, `pain:${o.id}:${itemHash(it)}`, 'has_pain');
    const provas = proofsOf.get(o.id)!;
    if (provas.length >= 2) for (const it of provas) edge(`proof:${o.id}`, `proof_item:${o.id}:${itemHash(it)}`, 'has_proof');
  }
  for (const f of fontes.values()) {
    edge(biz, `source:${f.hash}`, 'read_from');
    for (const oid of f.offerIds) edge(`offer:${oid}`, `source:${f.hash}`, 'read_from');
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
  // lacunas-home-eddy-v1 §3.2: lote → origem (vencedor), → oferta; criativo → lote
  for (const b of batches) {
    const bid = `batch:${b.id}`;
    if (!byId.has(bid)) continue;
    if (b.sourceMetaAdId) edge(bid, `meta_ad:${b.sourceMetaAdId}`, 'iterated_from');
    if (b.sourceCreativeId) edge(bid, `creative:${b.sourceCreativeId}`, 'iterated_from');
    edge(bid, `offer:${b.offerId}`, 'for_offer');
  }
  for (const c of creatives) if (c.batchId) edge(`creative:${c.id}`, `batch:${c.batchId}`, 'in_batch');
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
  for (const b of batches) if (byId.has(`batch:${b.id}`) && !linked.has(`batch:${b.id}`)) edge(w, `batch:${b.id}`, 'part_of');

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
