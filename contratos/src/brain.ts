// Brain 3D v1 (docs/contratos/brain-3d-v1.md, APROVADO pelo Gusta em 22/10, D1-D5; revisão 22/10 pelo mockup aprovado,
// design/brain-3d-2026-10-22.md: 8 categorias + centro, vencedor = estado, publicação = aresta, ângulo = atributo do gancho,
// roteiros como nó). Dono: maquina-arquiteto. SÓ TIPOS.
// Adendo 04/11 (docs/contratos/brain-preenchido-v1.md, aprovado pelo Gusta 04/11): kit da marca, campos da oferta,
// dores e provas em itens e fontes lidas viram nós (kinds brand_asset, brand_color, offer_field, pain, proof_item, source).
// Rotas: GET /brain/graph (BrainGraph) e GET /brain/node/:id (BrainNodeDetail). Leitura; todos os papéis (@ClientAllowed).
import type { CreativeState, Engine, PageRole } from './index';
import type { DefaultResult } from './agencia';
import type { MetaAdTrend, MetaAdVerdict, MetaPublicationStatus } from './meta';
import type { BatchMode, IterateBatchStage } from './iteracao';
import type { BrandAssetKind } from './brand-kit';

// ───────────────────────── enums ─────────────────────────
export type BrainNodeKind =
  | 'workspace' | 'business' | 'offer' | 'audience' | 'proof' | 'instructions' | 'goal'
  | 'hook' | 'script' | 'creative' | 'meta_ad'
  /** lacunas-home-eddy-v1 §3.2 (31/10): lote do Iterate (categoria creatives) */
  | 'batch'
  /** brain-preenchido-v1 (04/11): logo, arquivo ou vídeo demo do kit da marca (categoria business) */
  | 'brand_asset'
  /** brain-preenchido-v1: cor dominante do logo, #RRGGBB (categoria business) */
  | 'brand_color'
  /** brain-preenchido-v1: what / promise / offerAndPrice / cta da oferta (categoria offers) */
  | 'offer_field'
  /** brain-preenchido-v1: 1 item de Offer.pains (categoria audience), filho do nó audience */
  | 'pain'
  /** brain-preenchido-v1: 1 item de Offer.proof (categoria business), filho do nó proof; só com ≥ 2 itens */
  | 'proof_item'
  /** brain-preenchido-v1: site do cliente ou página lida pela leitura (Offer.readMeta.pages), categoria business */
  | 'source';
export const BRAIN_NODE_KINDS: readonly BrainNodeKind[] = [
  'workspace', 'business', 'offer', 'audience', 'proof', 'instructions', 'goal', 'hook', 'script', 'creative', 'meta_ad', 'batch',
  'brand_asset', 'brand_color', 'offer_field', 'pain', 'proof_item', 'source',
];
/** Categoria do mockup (cor, chip, régua). 'center' = o cliente (workspace). */
export type BrainCategory = 'center' | 'business' | 'offers' | 'audience' | 'goals' | 'hooks' | 'scripts' | 'creatives' | 'meta_ads';
export const BRAIN_CATEGORY_OF: Readonly<Record<BrainNodeKind, BrainCategory>> = {
  workspace: 'center', business: 'business', proof: 'business', instructions: 'business',
  offer: 'offers', audience: 'audience', goal: 'goals', hook: 'hooks', script: 'scripts', creative: 'creatives', meta_ad: 'meta_ads',
  batch: 'creatives',
  // brain-preenchido-v1: sem categoria nova (o mapa reaproveita as 8 cores)
  brand_asset: 'business', brand_color: 'business', proof_item: 'business', source: 'business',
  offer_field: 'offers', pain: 'audience',
};
export type BrainEdgeKind =
  | 'part_of'        // workspace → business | offer | goal | meta_ad (anúncio sem outro elo)
  | 'targets'        // offer → audience
  | 'uses_proof'     // offer → proof
  | 'instructed_by'  // offer → instructions
  | 'for_offer'      // hook | script | meta_ad → offer
  | 'speaks_to'      // script → audience
  | 'opens_with'     // script → hook
  | 'made_from'      // creative → script
  | 'published_as'   // creative → meta_ad (MetaPublication; publicação é aresta, não nó)
  | 'uses_hook'      // meta_ad → hook (gancho do teardown do campeão importado desse anúncio)
  | 'iterated_from'  // creative | batch → meta_ad (Champion.metaAdId) | creative | batch → creative (Champion.sourceCreativeId)
  | 'in_batch'       // creative → batch (lacunas-home-eddy-v1 §3.2)
  // brain-preenchido-v1 (04/11). brand_asset com offerId usa 'for_offer' (brand_asset → offer) no lugar de has_brand
  | 'has_brand'      // business → brand_asset (asset da marca toda, ou da oferta fora do grafo)
  | 'has_color'      // brand_asset (LOGO) → brand_color
  | 'has_field'      // offer → offer_field
  | 'has_pain'       // audience → pain
  | 'has_proof'      // proof → proof_item
  | 'read_from';     // business → source (toda fonte) · offer → source (página da leitura daquela oferta)
/** = enum CreativeOrigin do Prisma */
export type BrainCreativeOrigin = 'SCRATCH' | 'VARIATION';
/** chip do criativo: approved = APPROVED · in_review = RENDER_READY · draft = qualquer outro estado */
export type BrainCreativeStatus = 'approved' | 'in_review' | 'draft';

// ───────────────────────── limites (§1.3) ─────────────────────────
export const BRAIN_MAX_NODES = 800;
export const BRAIN_MAX_EDGES = 2500;
export const BRAIN_MAX_META_ADS = 200;
export const BRAIN_CACHE_TTL_SEC = 60;
/** lacunas-home-eddy-v1 §3.2: lotes no grafo (esperando a pessoa, trabalhando ou dos últimos 14 dias) */
export const BRAIN_MAX_BATCHES = 20;
/** brain-preenchido-v1 §3: teto somado dos kinds novos (brand_asset, brand_color, offer_field, pain, proof_item, source) */
export const BRAIN_MAX_SETUP_DETAIL = 160;
/** arquivos FILE do kit no grafo (mais recentes); LOGO = 1 e DEMO_VIDEO ≤ 5 entram todos */
export const BRAIN_MAX_BRAND_FILES = 8;
/** fontes (site + páginas lidas) por workspace / páginas por oferta */
export const BRAIN_MAX_SOURCES = 12;
export const BRAIN_MAX_SOURCES_PER_OFFER = 6;
/** itens por oferta depois da divisão (§2): o excedente não vira nó nem entra em counts.total */
export const BRAIN_MAX_PAINS_PER_OFFER = 8;
export const BRAIN_MAX_PROOFS_PER_OFFER = 8;
/** campos da oferta que viram nó, na ordem do passo 3 */
export type BrainOfferFieldKey = 'what' | 'promise' | 'offerAndPrice' | 'cta';
export const BRAIN_OFFER_FIELDS: readonly BrainOfferFieldKey[] = ['what', 'promise', 'offerAndPrice', 'cta'];

// ───────────────────────── nó ─────────────────────────
export type BrainNodeMeta =
  | { kind: 'workspace' }
  | { kind: 'business' | 'proof' | 'instructions' | 'audience'; setupStep: number }
  | { kind: 'goal'; setupStep: number; spendCapUsd: number | null; defaultResult: DefaultResult | null }
  | { kind: 'offer'; setupStep: number; creatives: number; winners: number }
  | {
      kind: 'hook';
      /** ângulo mais frequente entre os roteiros que abrem com este gancho; null = nenhum */
      angle: string | null;
      scripts: number; ads: number;
      /** menor CPA 30 d entre os anúncios ligados (published_as do criativo ou uses_hook); null sem resultado */
      bestCpa: number | null; currency: string | null;
    }
  | { kind: 'script'; creativeId: string; letter: string; angle: string | null; durationSec: number | null; editedByUser: boolean }
  | {
      kind: 'creative';
      /** nome que a pessoa deu ao criativo (o label usa este; cai pro adName só se vazio) */
      name: string;
      /** nome do anúncio no Meta (Creative.adName); null = ainda sem nome de anúncio */
      adName: string | null;
      state: CreativeState; status: BrainCreativeStatus; isWinner: boolean; origin: BrainCreativeOrigin;
      variationCode: string | null; offerId: string; engine: Engine | null; durationSec: number | null;
      thumbnailUrl: string | null;
      /** tem MetaPublication PAUSED/ACTIVE (esconde "Send to Meta") */
      published: boolean;
      /** veio de "Iterate this ad": Champion.metaAdId do campeão de origem (sem coluna nova) */
      sourceMetaAdId: string | null;
      /** veio de "Variar" na Biblioteca: Champion.sourceCreativeId */
      sourceCreativeId: string | null;
    }
  | {
      kind: 'meta_ad';
      verdict: MetaAdVerdict; trend: MetaAdTrend | null; effectiveStatus: string;
      spend30d: number; cpa: number | null; ctr: number | null; hookRate: number | null; currency: string | null;
      daysRunning: number | null; thumbnailUrl: string | null;
      /** videoId != null ("Iterate this ad" só em vídeo) */
      isVideo: boolean;
      /** publicado pelo HookMill (selo HOOKMILL) */
      fromHookMill: boolean;
      /** já importado como campeão */
      championId: string | null;
    }
  | {
      kind: 'batch';
      mode: BatchMode;
      stage: IterateBatchStage;
      championId: string; championName: string; offerId: string;
      /** origem do campeão: anúncio da Meta / criativo da Biblioteca (null = upload) */
      sourceMetaAdId: string | null; sourceCreativeId: string | null;
      /** criativos do lote não arquivados / em APPROVED */
      pieces: number; ready: number;
      /** miniatura do campeão, assinada (6 h) */
      thumbnailUrl: string | null;
      createdAt: string; updatedAt: string;
    }
  // ── brain-preenchido-v1 (04/11) ──
  | {
      kind: 'brand_asset';
      assetKind: BrandAssetKind;
      /** BrandAsset.label; null = o web mostra o rótulo i18n do assetKind (node.label leva o fallback em EN) */
      customLabel: string | null;
      mimeType: string;
      /** null = da marca toda; senão a oferta (aresta for_offer quando a oferta está no grafo) */
      offerId: string | null;
      /** imagem (LOGO e FILE png/jpeg/webp/svg): URL assinada (6 h) do próprio arquivo; PDF e DEMO_VIDEO = null */
      thumbnailUrl: string | null;
      /** só DEMO_VIDEO (File.durationSec) */
      durationSec: number | null;
      createdAt: string;
    }
  | { kind: 'brand_color'; /** #RRGGBB maiúsculo */ hex: string }
  | { kind: 'offer_field'; setupStep: number; offerId: string; field: BrainOfferFieldKey; /** fieldSources[field] */ from: 'page' | 'user' | null }
  | {
      kind: 'pain' | 'proof_item';
      setupStep: number;
      offerId: string;
      /** posição 0-based na lista dividida e total de itens (depois do teto) */
      index: number; of: number;
    }
  | {
      kind: 'source';
      /** URL como foi lida (a 1ª vista), http(s) */
      url: string;
      /** host sem "www." */
      host: string;
      /** é o Workspace.websiteUrl */
      isWebsite: boolean;
      /** papéis em que a página foi lida (vazio = só o site do cadastro); o web traduz por offers.role.* */
      roles: PageRole[];
      /** ofertas cuja leitura usou a página */
      offers: number;
      /** readMeta.readAt mais recente entre essas ofertas; null = só o site do cadastro */
      readAt: string | null;
    };

/** lacunas-home-eddy-v1 §3.1: chave i18n completa no namespace `status` (o web usa o useStatusLabel) */
export interface BrainStatusLabel { key: string; params: Record<string, string | number> }

export interface BrainNode {
  /** "<kind>:<chave>" (§2.1), estável entre chamadas */
  id: string;
  kind: BrainNodeKind;
  category: BrainCategory;
  /**
   * id da linha no banco (offer/script/creative), metaAdId (meta_ad), workspaceId (workspace/business/goal), offerId (audience/proof/instructions), hash (hook).
   * brain-preenchido-v1: BrandAsset.id (brand_asset), RRGGBB minúsculo (brand_color), `<offerId>:<field>` (offer_field),
   * `<offerId>:<sha1 12 hex do item normalizado>` (pain, proof_item), sha1 12 hex da URL normalizada (source)
   */
  refId: string;
  /** ≤ 80, pronto pra mostrar (nome, texto do gancho, "Script B") */
  label: string;
  /** ≤ 200, texto plano */
  summary: string | null;
  /** 0..1 (§2.2) */
  weight: number;
  /** criativo isWinner ou anúncio WINNER: anel lima */
  winner: boolean;
  meta: BrainNodeMeta;
  /**
   * lacunas-home-eddy-v1 §3.1 (31/10). Criativo: a regra do needs_you da Home; lote: stage plan_ready | failed | pieces_ready;
   * outros: false. Opcional só no tipo (mocks antigos); a API manda sempre.
   */
  needsYou?: boolean;
  /** criativo: statusKey sem números ao vivo (variantes `_short`); lote: `status.batch_<stage>`; outros: null */
  statusLabel?: BrainStatusLabel | null;
}

export interface BrainPublicationEdgeMeta {
  publicationId: string; status: MetaPublicationStatus;
  publishedAt: string | null; activatedAt: string | null; byName: string;
}
export interface BrainEdge {
  from: string; to: string; kind: BrainEdgeKind;
  /** só em published_as */
  publication?: BrainPublicationEdgeMeta;
}

export interface BrainKindCount { total: number; shown: number }
export type BrainCounts = Record<BrainNodeKind, BrainKindCount>;
export interface BrainMetaState {
  /** META_MODE ≠ off */
  enabled: boolean;
  /** conexão ACTIVE com conta escolhida */
  connected: boolean;
  /** MetaConnection.lastSyncAt (rodapé "Meta synced 12 min ago") */
  lastSyncAt: string | null;
}

/** GET /brain/graph */
export interface BrainGraph {
  generatedAt: string;
  nodes: BrainNode[];
  edges: BrainEdge[];
  counts: BrainCounts;
  meta: BrainMetaState;
  /** algum kind teve total > shown (teto de 800 nós) */
  truncated: boolean;
}
/** querystring do GET /brain/graph */
export interface BrainGraphQuery {
  offerId?: string;
  /** '1' pula o cache (no máx. 1 por 10 s por workspace; senão serve o cache) */
  fresh?: '1';
}

// ───────────────────────── drawer ─────────────────────────
/** 'brand' (brain-preenchido-v1) = aba Brand da /brain (o kit da marca) */
export type BrainOpenRoute = 'setup' | 'offer' | 'creative' | 'campaigns' | 'batch' | 'brand';
export interface BrainOpenTarget {
  route: BrainOpenRoute;
  /** offer/creative/batch: id da linha; campaigns: metaAdId; brand: id do BrandAsset (opcional) */
  id?: string;
  /** setup: passo 1..6 (BRAIN_ITEM_STEP); creative: etapa do wizard ("scripts" pro nó de roteiro) */
  step?: number | 'scripts';
}
export interface BrainNodeField { key: string; value: string | number | null }
export interface BrainNeighbor { id: string; kind: BrainNodeKind; category: BrainCategory; label: string; edge: BrainEdgeKind; winner: boolean }
export interface BrainMedia {
  /**
   * URL assinada (6 h) do vídeo: render final do criativo; no meta_ad, o render publicado (HookMill) ou o vídeo do campeão importado;
   * no brand_asset DEMO_VIDEO, o próprio vídeo (posterUrl null: o kit não guarda pôster). null = só pôster
   */
  videoUrl: string | null;
  posterUrl: string | null;
}

/** GET /brain/node/:id */
export interface BrainNodeDetail {
  node: BrainNode;
  /** chaves estáveis (ex. "offer.promise", "script.blocks", "creative.costUsd", "meta_ad.cpa"); o web rotula por i18n */
  fields: BrainNodeField[];
  /** até 50, agrupáveis por category no web */
  neighbors: BrainNeighbor[];
  media: BrainMedia | null;
  open: BrainOpenTarget | null;
}
