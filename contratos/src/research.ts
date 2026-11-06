// ads-research-v1 (docs/contratos/ads-research-v1.md, seção "Construção 04/11" — APROVADO pra construir): **Ad Radar** na UI
// (rota web `/radar`, i18n `radar.*`); a API continua em `/research/*`. Anúncios da Ad Library dos concorrentes que o HookMill
// DESCOBRE sozinho (G2: o cliente não cola nada; só remove). Fonte = Página + país (R0). Diretos antes de vizinhos (C.2).
// Nenhum código de erro novo: tudo reaproveita ApiErrorCode com details.reason/rule (§7).
import type { AccountAccess } from './amostra';

/** Mídia global (fora de File): URL assinada curta do nosso storage, ou a URL do fbcdn enquanto vale (~4,4 dias, R0). */
export interface ResearchMediaUrl { url: string; mimeType: string; width?: number; height?: number }

export type ResearchSyncStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'SUSPECT' | 'FAILED';
export type ResearchTrigger = 'INITIAL' | 'SCHEDULED' | 'MANUAL' | 'MEDIA' | 'DISCOVERY';
export type LibraryAdFormat = 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'DCO' | 'DPA' | 'OTHER';
export type LibraryAdPlatform = 'FACEBOOK' | 'INSTAGRAM' | 'MESSENGER' | 'AUDIENCE_NETWORK' | 'THREADS' | 'WHATSAPP';
/** §5.3 + C.6: proxy calculado na leitura, nunca gravado. winner = ativo e (≥ winnerDays OU ≥ winnerVersions versões). UI: "Likely winner". */
export type ResearchAdTier = 'winner' | 'testing' | 'new' | 'stopped';
export type ResearchSort = 'longest_running' | 'newest' | 'most_variations' | 'eu_reach';
export type ResearchStatusFilter = 'active' | 'inactive' | 'all';
export type ResearchMode = 'mock' | 'live' | 'off';

export type CompetitorStatus = 'ACTIVE' | 'DISMISSED' | 'RETIRED';
/** Construção 04/11 (C.2): DIRECT = mesmo produto pro mesmo público; ADJACENT = nicho vizinho (conta, mas atrás dos diretos). */
export type CompetitorRelation = 'DIRECT' | 'ADJACENT';
/** MANUAL só pela equipe (R10: `POST /research/competitors`, INTERNAL OWNER). */
export type CompetitorOrigin = 'DISCOVERED' | 'MANUAL';
export type DismissReason = 'not_competitor' | 'not_relevant' | 'own_brand' | 'other';
export type DiscoveryTrigger = 'ONBOARDING' | 'BRAIN_CHANGED' | 'MANUAL';
export type DiscoveryStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'EMPTY' | 'FAILED';
/** Etapas do pipeline (C.3), pra barra de progresso de "procurando concorrentes". */
export type DiscoveryStage = 'propose' | 'confirm' | 'scan' | 'judge' | 'import';

/** Motivos em details.reason / details.rule dos erros do §7 (reaproveitam ApiErrorCode). */
export type ResearchErrorReason =
  | 'research_source_invalid'                                    // 400 VALIDATION_ERROR (rule), só no add da equipe
  | 'research_tier'                                              // 402 PAYMENT_REQUIRED (SAMPLE)
  | 'competitor_limit' | 'already_following' | 'sync_running'    // 409 INVALID_STATE
  | 'not_active' | 'not_dismissed'                               // 409 INVALID_STATE (dismiss/restore)
  | 'discovery_running' | 'brain_incomplete'                     // 409 INVALID_STATE (descoberta)
  | 'ad_has_no_video' | 'media_refreshing' | 'no_media';         // 409 INVALID_STATE
/** 409 SPEND_CAP_EXCEEDED com scope 'research' (ausente = teto mensal geral, como hoje). */
export interface ResearchCapDetails { scope: 'research'; spentUsd: number; capUsd: number; estimateUsd: number }

export interface ResearchLimits {
  access: AccountAccess;
  maxCompetitors: number; activeCompetitors: number;
  /** candidatos validados guardados pra preencher vaga (0 no SAMPLE) */
  reserveMax: number; reserveCount: number;
  maxAdsPerCompetitor: number;
  /** null = sem atualização manual (SAMPLE) */
  refreshEveryHours: number | null;
  autoSync: boolean;
}

export type CandidateOrigin = 'LLM' | 'KEYWORD' | 'BOTH' | 'MEMORY';
export type CandidateStatus = 'FOLLOWED' | 'RESERVE' | 'REJECTED_NICHE' | 'NOT_FOUND' | 'TOO_FEW_ADS' | 'BLOCKED';
export interface DiscoveryCandidateView {
  pageId: string | null; pageName: string | null; brandName: string | null; domain: string | null;
  /** MEMORY = aprovado de descoberta anterior que voltou como reserva sem custo (C.4) */
  origin: CandidateOrigin;
  status: CandidateStatus;
  /** null = o juiz não aprovou */
  relation: CompetitorRelation | null;
  rank: number | null;
  activeAdsSeen: number; oldestDays: number | null; nicheScore: number | null;
  suspectDisposable: boolean;
  /** termo que achou a Página (KEYWORD/BOTH) */
  term: string | null;
  reason: string | null;
}
export type ResearchTermKind = 'PROMISE' | 'PRODUCT' | 'PAIN';
export interface DiscoveryTermView {
  term: string; kind: ResearchTermKind;
  /** REUSED = memória (termo que já rendeu aprovado) */
  origin: 'NEW' | 'REUSED';
  outcome: 'SEARCHED' | 'EMPTY' | 'DIFFUSE' | 'UNUSED';
  pagesFound: number; pagesMultiAd: number; approvedCount: number;
}
/** `GET /research/discovery` (última descoberta do workspace; null em `last` se nunca rodou). */
export interface CompetitorDiscoveryView {
  last: {
    id: string; trigger: DiscoveryTrigger; status: DiscoveryStatus;
    /** etapa atual enquanto RUNNING */
    stage: DiscoveryStage | null;
    countryCode: string | null; keywords: string[];
    candidatesFound: number; followed: number; reserved: number;
    /** só a equipe (INTERNAL) recebe as listas e o custo; cliente recebe [] e null */
    candidates: DiscoveryCandidateView[];
    terms: DiscoveryTermView[];
    costUsd: number | null;
    errorCode: string | null; failReason: string | null;
    createdAt: string; finishedAt: string | null;
  } | null;
  /** quando o botão "Procurar de novo" volta (null = já pode, ou nunca pra SAMPLE: ver `manualAllowed`) */
  manualAvailableAt: string | null;
  manualAllowed: boolean;
  /** o Brain mudou desde a última e a automática está esperando debounce/janela de 30 dias */
  autoPendingAt: string | null;
  /** estimativa mostrada no "Procurar de novo" (US$ 0,15 PAID; C.3) */
  estimateUsd: number;
}

/** `GET /research/status` */
export interface ResearchStatus {
  mode: ResearchMode;
  available: boolean;
  reason: 'quota' | 'not_configured' | null;
  retryAfter: string | null;
  limits: ResearchLimits;
  spend: { monthUsd: number; capUsd: number };
  discovery: { status: DiscoveryStatus | null; stage: DiscoveryStage | null };
  /** país das fontes do workspace (ISO-2) */
  countryCode: string | null;
  /** selo "provável vencedor" = ativo e (daysRunning ≥ winnerDays OU collationCount ≥ winnerVersions) — C.6 */
  winnerDays: number; winnerVersions: number; newDays: number;
}

export interface ResearchSyncRef {
  id: string; trigger: ResearchTrigger; status: ResearchSyncStatus;
  adsActive: number; adsNew: number; adsStopped: number;
  /** código assíncrono quando FAILED: AD_LIBRARY_UNAVAILABLE | AD_NOT_FOUND | PROVIDER_TIMEOUT | PROVIDER_ERROR */
  errorCode: string | null; failReason: string | null;
  startedAt: string | null; finishedAt: string | null;
}
export interface Competitor {
  id: string;
  name: string;
  status: CompetitorStatus;
  origin: CompetitorOrigin;
  /** C.2: a barra mostra diretos primeiro; vizinho ganha a pílula "nicho vizinho" */
  relation: CompetitorRelation;
  nicheScore: number | null;
  /** "por que este" (1 linha do juiz de nicho, PT-BR); null no MANUAL */
  reason: string | null;
  source: { pageId: string; countryCode: string; displayName: string; avatar: ResearchMediaUrl | null; likeCount: number | null; adLibraryUrl: string };
  domain: string | null;
  /** `active` vem da importação; antes dela (`activeIsLowerBound`) é o visto na sonda e a UI mostra "≥ N" */
  counts: { active: number; winners: number; new7d: number; stopped30d: number };
  activeIsLowerBound: boolean;
  sync: ResearchSyncRef | null;
  lastValidSyncAt: string | null;
  nextSyncAt: string | null;
  refreshAvailableAt: string | null;
  lastSyncSuspect: boolean;
  autoSyncPausedByCap: boolean;
  dismissedAt: string | null; dismissReason: DismissReason | null;
  createdAt: string;
}
export interface UpdateCompetitorBody { name: string }
export interface DismissCompetitorBody { reason: DismissReason }
export interface DismissCompetitorResponse { dismissed: Competitor; replacement: Competitor | null }
/** Só equipe (INTERNAL OWNER), R10: id da Página ou URL da Página/Ad Library com view_all_page_id. */
export interface AddCompetitorBody { pageId?: string; pageUrl?: string; countryCode?: string; name?: string }
export interface ListCompetitorsQuery { status?: 'active' | 'dismissed' | 'retired' }

export interface ResearchAdMedia {
  playable: boolean;
  status: 'stored' | 'remote' | 'expired' | 'refreshing' | 'none';
  poster: ResearchMediaUrl | null;
  video: ResearchMediaUrl | null;
  durationSec: number | null;
  expiresAt: string | null;
}
export interface ResearchAdCard {
  id: string;
  adArchiveId: string;
  adLibraryUrl: string;
  page: { id: string | null; name: string; avatar: ResearchMediaUrl | null };
  competitors: { id: string; name: string }[];
  format: LibraryAdFormat;
  /** tem vídeo (inclusive DCO/carrossel com vídeo em card) */
  hasVideo: boolean;
  media: ResearchAdMedia;
  primaryText: string | null; headline: string | null; ctaText: string | null;
  linkUrl: string | null; linkHost: string | null;
  platforms: LibraryAdPlatform[];
  language: string | null;
  /** país da fonte (a Ad Library não diz o país de entrega por anúncio) */
  countryCode: string | null;
  startDate: string | null; stoppedAt: string | null;
  isActive: boolean;
  daysRunning: number | null;
  tier: ResearchAdTier;
  killedFast: boolean;
  /** null quando a Meta não informa (17 % na R0) */
  collationCount: number | null;
  euReach: number | null;
  lowImpressions: boolean;
  saved: boolean;
  usedInBatches: number;
  usable: boolean;
}
export interface ResearchAdDetail extends ResearchAdCard {
  cards: { headline: string | null; body: string | null; linkUrl: string | null; mediaKind: 'VIDEO' | 'IMAGE' | null; poster: ResearchMediaUrl | null }[];
  firstSeenAt: string; lastSeenAt: string;
  savedNote: string | null;
  championId: string | null;
}
/** `GET /research/ads` (arrays como parâmetro repetido). */
export interface ListResearchAdsQuery {
  competitorId?: string[];
  status?: ResearchStatusFilter;
  format?: LibraryAdFormat[];
  hasVideo?: boolean;
  tier?: ResearchAdTier[];
  minDays?: number;
  startedAfter?: string; startedBefore?: string;
  platform?: LibraryAdPlatform[];
  language?: string[];
  q?: string;
  saved?: boolean;
  sort?: ResearchSort;
  limit?: number;
  cursor?: string;
}
/** `total`/`winners` = da consulta inteira (linha "126 ads · 41 likely winners"); null se caro demais de contar. */
export interface ResearchAdPage { items: ResearchAdCard[]; nextCursor: string | null; total: number | null; winners: number | null }
export interface SaveResearchAdBody { note?: string | null }
