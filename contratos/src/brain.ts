// Brain 3D v1 (docs/contratos/brain-3d-v1.md, APROVADO pelo Gusta em 22/10, D1-D5; revisão 22/10 pelo mockup aprovado,
// design/brain-3d-2026-10-22.md: 8 categorias + centro, vencedor = estado, publicação = aresta, ângulo = atributo do gancho,
// roteiros como nó). Dono: maquina-arquiteto. SÓ TIPOS.
// Rotas: GET /brain/graph (BrainGraph) e GET /brain/node/:id (BrainNodeDetail). Leitura; todos os papéis (@ClientAllowed).
import type { CreativeState, Engine } from './index';
import type { DefaultResult } from './agencia';
import type { MetaAdTrend, MetaAdVerdict, MetaPublicationStatus } from './meta';

// ───────────────────────── enums ─────────────────────────
export type BrainNodeKind =
  | 'workspace' | 'business' | 'offer' | 'audience' | 'proof' | 'instructions' | 'goal'
  | 'hook' | 'script' | 'creative' | 'meta_ad';
export const BRAIN_NODE_KINDS: readonly BrainNodeKind[] = [
  'workspace', 'business', 'offer', 'audience', 'proof', 'instructions', 'goal', 'hook', 'script', 'creative', 'meta_ad',
];
/** Categoria do mockup (cor, chip, régua). 'center' = o cliente (workspace). */
export type BrainCategory = 'center' | 'business' | 'offers' | 'audience' | 'goals' | 'hooks' | 'scripts' | 'creatives' | 'meta_ads';
export const BRAIN_CATEGORY_OF: Readonly<Record<BrainNodeKind, BrainCategory>> = {
  workspace: 'center', business: 'business', proof: 'business', instructions: 'business',
  offer: 'offers', audience: 'audience', goal: 'goals', hook: 'hooks', script: 'scripts', creative: 'creatives', meta_ad: 'meta_ads',
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
  | 'iterated_from'; // creative → meta_ad (Champion.metaAdId) | creative → creative (Champion.sourceCreativeId)
/** = enum CreativeOrigin do Prisma */
export type BrainCreativeOrigin = 'SCRATCH' | 'VARIATION';
/** chip do criativo: approved = APPROVED · in_review = RENDER_READY · draft = qualquer outro estado */
export type BrainCreativeStatus = 'approved' | 'in_review' | 'draft';

// ───────────────────────── limites (§1.3) ─────────────────────────
export const BRAIN_MAX_NODES = 800;
export const BRAIN_MAX_EDGES = 2500;
export const BRAIN_MAX_META_ADS = 200;
export const BRAIN_CACHE_TTL_SEC = 60;

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
    };

export interface BrainNode {
  /** "<kind>:<chave>" (§2.1), estável entre chamadas */
  id: string;
  kind: BrainNodeKind;
  category: BrainCategory;
  /** id da linha no banco (offer/script/creative), metaAdId (meta_ad), workspaceId (workspace/business/goal), offerId (audience/proof/instructions), hash (hook) */
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
export type BrainOpenRoute = 'setup' | 'offer' | 'creative' | 'campaigns';
export interface BrainOpenTarget {
  route: BrainOpenRoute;
  /** offer/creative: id da linha; campaigns: metaAdId */
  id?: string;
  /** setup: passo 1..6 (BRAIN_ITEM_STEP); creative: etapa do wizard ("scripts" pro nó de roteiro) */
  step?: number | 'scripts';
}
export interface BrainNodeField { key: string; value: string | number | null }
export interface BrainNeighbor { id: string; kind: BrainNodeKind; category: BrainCategory; label: string; edge: BrainEdgeKind; winner: boolean }
export interface BrainMedia {
  /** URL assinada (6 h) do vídeo: render final do criativo; no meta_ad, o render publicado (HookMill) ou o vídeo do campeão importado. null = só pôster */
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
