// Meta v1 (docs/contratos/meta-v1.md, APROVADO pelo Gusta em 21/10). Dono: maquina-arquiteto. SÓ TIPOS.
// Exportado no index.ts; os campos aditivos nos tipos existentes (lista no fim) já estão aplicados lá.
import type { Action, Job, PageMeta, UserRef } from './index';
import type { MetaCampaignsTotals, MetaStatusCounts } from './campanhas';

// ───────────────────────── enums ─────────────────────────
export type MetaConnectionStatus = 'ACTIVE' | 'TOKEN_INVALID' | 'DISCONNECTED';
/** meta-templates-v2 A0 (03/11): +AWARENESS/ENGAGEMENT (só no template; o DTO do Custom continua aceitando os 4 primeiros). */
export type MetaObjective = 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_APP_PROMOTION' | 'OUTCOME_TRAFFIC' | MetaObjectiveV2Extra;
/** meta-templates-v2 §2.1: os 2 objetivos que saíram do "Soon" (já dentro do `MetaObjective` desde o A0). */
export type MetaObjectiveV2Extra = 'OUTCOME_AWARENESS' | 'OUTCOME_ENGAGEMENT';
/** meta-templates-v2 §2.2: ausente = DAILY (tudo o que existia antes do v2). */
export type MetaBudgetType = 'DAILY' | 'LIFETIME';
/** meta-templates-v2 §2.1: `optimization_goal` da Graph aceito por objetivo (ODAX, v25). */
export type MetaAwarenessGoal = 'REACH' | 'IMPRESSIONS' | 'AD_RECALL_LIFT' | 'THRUPLAY' | 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS';
export type MetaEngagementGoal = 'THRUPLAY' | 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS' | 'POST_ENGAGEMENT';
export type MetaTemplateOptimizationGoal = MetaAwarenessGoal | MetaEngagementGoal;
/** §5: WINNER = elegível com CPA ≤ mediana; OK = elegível acima; LOW_DATA = gasto/resultados abaixo do mínimo */
export type MetaAdVerdict = 'WINNER' | 'OK' | 'LOW_DATA';
/** §5.2: últimos 7 d contra os 7 d anteriores (null no MetaAdRow = dado insuficiente) */
export type MetaAdTrend = 'WORKING' | 'STEADY' | 'TIRING';
export type MetaPublicationStatus = 'PUBLISHING' | 'PAUSED' | 'ACTIVE' | 'FAILED' | 'DELETED';
export type MetaCallToAction =
  | 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | 'GET_OFFER' | 'BOOK_NOW' | 'CONTACT_US'
  | 'DOWNLOAD' | 'SUBSCRIBE' | 'APPLY_NOW' | 'GET_QUOTE' | 'ORDER_NOW';
export type MetaSpecialAdCategory = 'HOUSING' | 'CREDIT' | 'EMPLOYMENT' | 'ISSUES_ELECTIONS_POLITICS' | 'FINANCIAL_PRODUCTS_SERVICES';
export type MetaPeriod = '7d' | '30d';

/** §3.4: código que volta na query do redirect do callback (`?meta=error&code=`). */
export type MetaOAuthErrorCode = 'META_OAUTH_DENIED' | 'META_OAUTH_FAILED' | 'META_STATE_INVALID' | 'META_SCOPES_MISSING' | 'META_UNAVAILABLE';
/** Códigos assíncronos (job); somam ao AsyncErrorCode do index.ts depois do ok. */
export type MetaAsyncErrorCode =
  | 'META_TOKEN_INVALID' | 'META_PERMISSION' | 'META_ACCOUNT_UNUSABLE' | 'META_PAYMENT_REQUIRED' | 'META_POLICY'
  | 'META_BUDGET_TOO_LOW' | 'META_VIDEO_REJECTED' | 'META_VIDEO_UNAVAILABLE' | 'META_RATE_LIMITED' | 'META_ERROR';
/** Ações novas; somam ao `Action` do index.ts depois do ok. */
export type MetaAction = Action | 'reconnect_meta' | 'choose_account' | 'fix_payment' | 'edit_ad_text' | 'raise_budget';

// ───────────────────────── §3.1 conexão ─────────────────────────
/**
 * `/settings/connections` = Settings › Connections (onde o MetaConnect mora); `/settings` é alias aceito até o web trocar
 * (revisão 21/10). `/meta/done` = página mínima do web pro fluxo em popup (fecha e avisa a aba de origem).
 */
export type MetaReturnTo = '/onboarding/meta' | '/settings/connections' | '/settings' | '/meta/done';
export interface MetaConnectBody { returnTo?: MetaReturnTo }
export interface MetaConnectResponse { url: string; expiresAt: string }
/**
 * GET /meta/oauth/status (22/10, "Connect from another browser"): o login pode acontecer em OUTRO navegador (Multilogin/
 * AdsPower); a aba de origem faz polling aqui a cada 3 s. Fonte: memória do processo da API (TTL 15 min), escrita pelo
 * connect (pending) e pelo callback (sucesso limpa e grava connectedAt; falha grava lastError). Cobre a 1ª tentativa,
 * quando ainda não há linha de MetaConnection.
 */
export interface MetaOAuthStatus {
  pending: boolean;
  expiresAt: string | null;
  lastError: { code: MetaOAuthErrorCode; missing: string[]; at: string } | null;
  connectedAt: string | null;
}

export type MetaHealthLevel = 'ok' | 'warn' | 'bad';
export interface MetaHealthCheck {
  key: 'token' | 'scopes' | 'account' | 'funding' | 'page' | 'pixel' | 'budget' | 'verified';
  /** bad bloqueia publicar; warn só avisa (pixel, verified, token expirando) */
  level: MetaHealthLevel;
  /** frase curta pro usuário (EN; o web traduz por key+level quando tiver chave) */
  detail: string | null;
}
export interface MetaHealth {
  /** pior nível entre os checks (verde / âmbar / vermelho) */
  level: MetaHealthLevel;
  /** nenhum check 'bad' entre token, scopes, account, funding, page, budget */
  canPublish: boolean;
  checks: MetaHealthCheck[];
  /** anúncios de vídeo da conta no último sync (0 antes do 1º sync) */
  adsCount: number; activeCount: number;
  checkedAt: string;
}

/** GET /meta/connection (null quando nunca conectou). NUNCA traz o token. */
export interface MetaConnection {
  status: MetaConnectionStatus;
  user: { id: string; name: string };
  scopes: string[];
  tokenExpiresAt: string | null;
  adAccount: {
    id: string; name: string; currency: string; timezoneName: string; accountStatus: number;
    /** meta-templates-v2 §5.4: mínimo diário da conta (centavos), do último health; null = desconhecido. Opcional até o B2 */
    minDailyBudgetMinor?: number | null;
  } | null;
  page: { id: string; name: string } | null;
  pixel: { id: string; name: string } | null;
  health: MetaHealth | null;
  lastSyncAt: string | null;
  syncing: boolean;
  connectedBy: UserRef;
  connectedAt: string;
}

export interface MetaAdAccountOption {
  id: string; name: string; currency: string; accountStatus: number;
  business: { id: string; name: string } | null;
  /** user_tasks contém MANAGE ou ADVERTISE; false = aparece desabilitada com a instrução de pedir acesso */
  canManage: boolean;
  permissionReason: 'no_advertise_task' | 'account_disabled' | null;
}
/** GET /meta/options (ao vivo da Meta). pixels vazio até escolher a conta (ou `?adAccountId=`). */
export interface MetaOptions {
  adAccounts: MetaAdAccountOption[];
  pages: { id: string; name: string }[];
  pixels: { id: string; name: string; adAccountId: string | null; lastFiredAt: string | null }[];
}
export interface MetaOptionsQuery { adAccountId?: string }
export interface MetaSelectionBody { adAccountId: string; pageId: string; pixelId?: string | null }

// ───────────────────────── §3.2 leitura ─────────────────────────
export interface MetaMetrics {
  spend: number; impressions: number; clicks: number;
  /** clicks / impressions, em % */
  ctr: number;
  results: number; resultType: string | null;
  /** spend / results; null sem resultado */
  cpa: number | null;
  /** purchase_roas (só compra) */
  roas: number | null;
  /** video_continuous_2_sec_watched_actions ("2-Second Continuous Video Plays"); era `plays3s` até 22/10: a Marketing API v25 não tem campo de 3 s */
  plays2s: number | null;
  /** plays2s / impressions, em %; null se a Graph não devolver o campo */
  hookRate: number | null;
  thruplays: number | null;
  /** impressions / reach; só nas janelas de 7 d */
  frequency: number | null;
  /** campanhas-v1: só em campanha e conjunto (lido por nível; não soma) */
  reach?: number | null;
}
export interface MetaAdRow {
  metaAdId: string; name: string; effectiveStatus: string;
  campaign: { id: string; name: string }; adset: { id: string; name: string };
  thumbnailUrl: string | null; videoId: string | null;
  /** 30 d */
  metrics: MetaMetrics;
  metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
  verdict: MetaAdVerdict;
  /** §5.2; null = dado insuficiente (a tela mostra "—") */
  trend: MetaAdTrend | null;
  /** hoje − adCreatedTime, em dias */
  daysRunning: number | null;
  /** publicado pelo HookMill: o criativo de origem */
  creative: { id: string; name: string; adName: string | null } | null;
  /** já importado como campeão (Pick from Meta) */
  championId: string | null;
  adCreatedTime: string | null; syncedAt: string;
  // campanhas-v1 §3 (22/10): opcionais no pacote até a B4 entregar; o backend devolve sempre
  /** status configurado do anúncio (o toggle) */
  status?: 'ACTIVE' | 'PAUSED';
  fromHookMill?: boolean;
  adsManagerUrl?: string;
  /** OWNER/ADMIN, conta usável, não DISAPPROVED/DELETED */
  canToggle?: boolean;
  /** anúncio de vídeo (videoId != null): "Iterate this ad" */
  canIterate?: boolean;
  /** lacunas-home-eddy-v1 §4 (31/10): createdAt do lote mais recente feito deste anúncio (campeão não arquivado com este metaAdId); null = nunca. Opcional só no tipo; a API manda sempre */
  lastIteratedAt?: string | null;
  /** meta-oferta-v1 §4.5 (04/11): de qual oferta é o anúncio. Opcional até o B3; a API manda sempre. `fit` só com `?offerId` */
  offer?: MetaAdOfferInfo;
}
/** §5.3, derivado */
export interface MetaSyncState {
  state: 'ok' | 'first_sync' | 'syncing' | 'stale' | 'failed' | 'never';
  syncedAt: string | null;
  /** só em first_sync/syncing (do job META_SYNC) */
  progress: { done: number; total: number; unit: 'ads' } | null;
  /** o job em andamento (ou o último que falhou) */
  job: Job | null;
}
export interface MetaSummary {
  period: MetaPeriod; currency: string | null;
  spend: number; results: number; resultType: string | null;
  cpa: number | null; roas: number | null; ctr: number | null; hookRate: number | null;
  /** período anterior de mesmo tamanho (null = sem dado) */
  prev: { spend: number; cpa: number | null; roas: number | null } | null;
  /** dos elegíveis, 30 d (o "account median CPA" do tour) */
  medianCpa: number | null;
  adsCount: number; activeAds: number;
  /** adCreatedTime nos últimos 7 d */
  newThisWeek: number;
  eligibleCount: number; winnersCount: number; tiringCount: number;
  /** o que a regra usou, pra tela explicar */
  rule: { minSpendUsd: number; minResults: number };
  sync: MetaSyncState;
}
export interface MetaSummaryQuery { period?: MetaPeriod }
export interface MetaAdsQuery {
  verdict?: MetaAdVerdict; trend?: MetaAdTrend; q?: string;
  sort?: 'spend' | 'cpa' | 'hookRate' | 'ctr' | 'results' | 'name'; limit?: number; cursor?: string;
  // campanhas-v1 §3 (22/10)
  /** active | paused | issues | all (padrão all) */
  status?: 'active' | 'paused' | 'issues' | 'all';
  /** hookmill = só os publicados pelo HookMill */
  origin?: 'all' | 'hookmill';
  campaignId?: string; adsetId?: string;
  /** padrão 'video' (Pick from Meta e tour não mudam); a Campaigns manda 'all' */
  format?: 'video' | 'all';
  /** janela usada pra ordenar (padrão 30d) */
  period?: MetaPeriod;
  dir?: 'asc' | 'desc';
  // meta-oferta-v1 §4.1 (04/11)
  /** oferta ativa do web; agrupa this → unknown → other. De outro workspace = 404 NOT_FOUND { resource: 'offer' } */
  offerId?: string;
  /** só com offerId (senão 400 VALIDATION_ERROR rule 'requires_offer'); padrão 'all' */
  offerScope?: MetaOfferScope;
}
export interface MetaAdsMeta extends PageMeta {
  summary: MetaSummary;
  /** campanhas-v1 §10: contagem por status com os outros filtros aplicados (modo "Ads only"). Opcional até a B4b */
  counts: MetaStatusCounts;
  /** campanhas-v1 §11 (23/10): totais do conjunto FILTRADO inteiro (todos os filtros, inclusive status e format), na janela
   *  de `period` (padrão 30d). Linha Total do "Ads only": não somar a página no cliente */
  totals: MetaCampaignsTotals;
  /** meta-oferta-v1 §4.2-4.4: só com `?offerId`. Opcional até o B3 */
  offer?: MetaOfferListMeta;
}
export interface MetaSyncResponse { job: Job }
export interface MetaPublicationsQuery { status?: MetaPublicationStatus; limit?: number; cursor?: string }

// ───────────────────────── meta-oferta-v1 (04/11, PROPOSTA; docs/contratos/meta-oferta-v1.md) ─────────────────────────
/** §2.1: de onde saiu o link do criativo; null no snapshot = ainda não lido */
export type MetaDestinationSource = 'video_cta' | 'story_link' | 'template' | 'asset_feed' | 'lead_form' | 'messaging' | 'existing_post' | 'none';
/** §3.6: relativo à oferta pedida */
export type MetaOfferFit = 'this' | 'unknown' | 'other';
export type MetaOfferScope = 'all' | MetaOfferFit;
/** §3.5: regra que atribuiu a oferta (a primeira que deu oferta única) */
export type MetaOfferMatch = 'manual' | 'manual_campaign' | 'hookmill' | 'champion' | 'link' | 'name' | 'sibling' | 'domain' | 'none';
/** §3.6: por que ficou sem oferta (só com `offerId` null) */
export type MetaOfferNoneReason = 'foreign_link' | 'no_link' | 'link_pending' | 'ambiguous' | 'offer_has_no_url' | 'excluded';
export type MetaOfferDecision = 'BELONGS' | 'NOT_BELONGS';
/** §5: correção manual vale por anúncio ou por campanha (ADSET = 400) */
export type MetaOfferLinkLevel = 'AD' | 'CAMPAIGN';

export interface MetaAdOfferInfo {
  /** null sem `?offerId` */
  fit: MetaOfferFit | null;
  /** oferta atribuída (qualquer uma do workspace, arquivada inclusive); null = nenhuma */
  offerId: string | null; offerName: string | null;
  match: MetaOfferMatch;
  /** high = manual, manual_campaign, hookmill, champion, link; low = name, sibling, domain; null com match 'none' */
  confidence: 'high' | 'low' | null;
  noneReason: MetaOfferNoneReason | null;
  /** destinationUrls[0] do snapshot (já sem encurtador); null = sem link legível */
  destinationUrl: string | null;
  /** host sem www., pra mostrar ("spygram.app") */
  destinationHost: string | null;
  /** destinationSource null: link na fila do próximo sync */
  linkPending: boolean;
  /** correção que valeu pra oferta pedida (pro "Desfazer"); null = automático ou sem `?offerId` */
  manual: { level: MetaOfferLinkLevel; decision: MetaOfferDecision } | null;
  /** OWNER/ADMIN/MEMBER (CLIENT não corrige) */
  canEdit: boolean;
}
export interface MetaOfferCounts { this: number; unknown: number; other: number }
/** `meta.offer` de GET /meta/ads e GET /meta/campaigns com `?offerId` */
export interface MetaOfferListMeta {
  offerId: string;
  /** com os outros filtros, antes do offerScope (anúncios em /meta/ads, campanhas em /meta/campaigns) */
  counts: MetaOfferCounts;
  /** §4.3: 'offer' = WINNER recalculado só entre os `this` (≥ 3 elegíveis) */
  verdictScope: 'offer' | 'account';
  medianCpa: number | null;
  /** §4.4: cobertura de link dos anúncios filtrados */
  links: { read: number; pending: number; unreadable: number };
  /** a oferta tem ≥ 1 referência de URL (§3.3); false = aviso "adicione o link" */
  offerHasUrl: boolean;
}
/** PUT /meta/offer-links */
export interface MetaOfferLinkBody { level: MetaOfferLinkLevel; objectId: string; offerId: string; belongs: boolean }
/** DELETE /meta/offer-links?level=&objectId=&offerId= */
export interface MetaOfferLinkQuery { level: MetaOfferLinkLevel; objectId: string; offerId: string }
export interface MetaOfferLinkResult {
  level: MetaOfferLinkLevel; objectId: string; offerId: string;
  /** null depois do DELETE (volta ao automático) */
  decision: MetaOfferDecision | null;
  /** anúncios do snapshot atual cujo `fit` pra essa oferta mudou */
  affectedAds: number;
}

// ───────────────────────── §3.3 publicação ─────────────────────────
export interface MetaPublishDefaults {
  objective: MetaObjective;
  /** 'business_type' = saiu do resultType do cliente (nome mantido) */
  objectiveReason: 'business_type' | 'no_pixel';
  /** resultado-v1 (28/10): evento do pixel que a publicação vai otimizar com este objetivo; null = sem pixel/LINK_CLICKS */
  pixelEvent?: MetaPixelEvent | null;
  /** ISO-3166-1 alfa-2 derivado de workspace.market; vazio = usuário escolhe */
  countries: string[];
  ageMin: 18; ageMax: 65;
  /** mínimo da conta (minimum_budgets), em centavos da moeda dela */
  dailyBudgetMinor: number | null;
  currency: string | null;
  page: { id: string; name: string } | null;
  pixel: { id: string; name: string } | null;
  /** creative.adName (fase2 D6) */
  name: string;
  primaryText: string;
  headline: string | null;
  description: string | null;
  callToAction: MetaCallToAction;
  link: string | null;
}
export interface MetaPublishBody {
  /** centavos na moeda da conta; ≥ mínimo da conta (422 META_BUDGET_TOO_LOW) */
  dailyBudgetMinor: number;
  /** 1-10, ISO alfa-2 */
  countries: string[];
  /** sem = default do GET */
  objective?: MetaObjective;
  /** 1-2000 */
  primaryText: string;
  /** ≤ 40 (acima = aviso) */
  headline?: string;
  /** ≤ 125 */
  description?: string;
  callToAction: MetaCallToAction;
  /** http(s), ≤ 2048 */
  link: string;
  /** padrão [] */
  specialAdCategories?: MetaSpecialAdCategory[];
  /** 18-65 */
  ageMin?: number; ageMax?: number;
}
/** resultado-v1 (28/10): `promoted_object.custom_event_type` do conjunto (pixel), resolvido pelo resultType do cliente. */
export type MetaPixelEvent = 'PURCHASE' | 'LEAD' | 'COMPLETE_REGISTRATION' | 'SCHEDULE' | 'SUBSCRIBE';
export type MetaPublishSettings = Required<Omit<MetaPublishBody, 'headline' | 'description'>> & {
  headline: string | null; description: string | null;
  objectiveReason: MetaPublishDefaults['objectiveReason'];
  /** resultado-v1: evento do pixel na otimização (SALES/LEADS com pixel). Ausente (publicação antiga) = PURCHASE em SALES, LEAD em LEADS. */
  pixelEvent?: MetaPixelEvent | null;
  // meta-templates-v2 §6 (02/11): resolvidos do template NO ENVIO (iguais pra todo o lote; retry usa os mesmos). Ausentes = v1.
  /** ausente = DAILY */
  budgetType?: MetaBudgetType;
  /** LIFETIME: total em centavos (CBO = da campanha; ABO = de cada ad set). Com LIFETIME, `dailyBudgetMinor` = 0 */
  lifetimeBudgetMinor?: number | null;
  /** ISO 8601 UTC; null = começa ao publicar */
  startTime?: string | null;
  /** ISO 8601 UTC; null = sem fim (só DAILY) */
  endTime?: string | null;
  /** só AWARENESS/ENGAGEMENT; null = o padrão do objetivo */
  optimizationGoal?: MetaTemplateOptimizationGoal | null;
  /** chaves de idioma da Meta (targeting.locales); vazio = todos */
  locales?: number[];
  customAudienceIds?: string[];
  excludedCustomAudienceIds?: string[];
  /** object_story_spec.instagram_user_id; null = a Página como identidade no Instagram (v1) */
  instagramUserId?: string | null;
};
export interface MetaPublication {
  id: string; status: MetaPublicationStatus;
  creativeId: string; adAccountId: string;
  ids: { videoId: string | null; creativeId: string | null; campaignId: string | null; adsetId: string | null; adId: string | null };
  settings: MetaPublishSettings;
  adsManagerUrl: string | null;
  previewUrl: string | null;
  /** checklist: uploading_video → processing_video → creating_campaign → creating_adset → creating_creative → creating_ad */
  job: Job | null;
  errorCode: MetaAsyncErrorCode | null; failReason: string | null; action: MetaAction | null;
  /** do snapshot, quando o sync já viu o anúncio */
  metrics: MetaMetrics | null;
  publishedAt: string | null; activatedAt: string | null;
  createdBy: UserRef; createdAt: string;
}
export interface CreativeMetaResponse {
  /** a mais recente (createdAt desc) */
  publication: MetaPublication | null;
  /** SÓ as anteriores, mais recente primeiro; a atual não repete aqui (21/10 pós-QA). Vazio na 1ª publicação */
  history: MetaPublication[];
  /** null sem conexão */
  defaults: MetaPublishDefaults | null;
  connection: { status: MetaConnectionStatus; canPublish: boolean } | null;
}
export interface MetaActivateBody { confirm: true }

// ───────────────────────── details de erro (api.md §1) ─────────────────────────
export interface MetaNotConfiguredDetails { reason: 'not_configured' | 'off' }
export interface MetaSelectionMissingDetails { missing: ('adAccount' | 'page')[] }
export interface MetaPermissionDetails { adAccountId?: string; reason: 'no_advertise_task' | 'account_disabled' | 'missing_scope'; scope?: string }
export interface MetaPixelRequiredDetails { objective: MetaObjective }
export interface MetaAccountUnusableDetails { accountStatus: number; label: string }
export interface MetaBudgetTooLowDetails {
  minimumMinor: number; currency: string;
  /** meta-templates-v2 §5.2: LIFETIME = `minimumMinor` é o TOTAL (mínimo diário × `days`). Ausente = DAILY */
  budgetType?: MetaBudgetType;
  days?: number;
}
export interface MetaUnavailableDetails { reason: 'rate_limited' | 'down'; retryAfterSec: number }
export type MetaInvalidStateReason = 'not_approved' | 'publish_in_progress' | 'sync_in_progress';

/*
 * Aditivos em tipos EXISTENTES (APLICADOS no index.ts/agencia.ts/iteracao.ts/cadastro.ts em 21/10; obrigatórios desde o fim do QA):
 *   Action                  += 'reconnect_meta' | 'choose_account' | 'fix_payment' | 'edit_ad_text' | 'raise_budget'
 *   AsyncErrorCode          += MetaAsyncErrorCode
 *   JobType                 += 'META_SYNC' | 'META_IMPORT' | 'META_PUBLISH'
 *   ServiceStatus.provider  += 'META'
 *   CreateIterateBody       += metaAdId?: string          (exatamente um de uploadId/creativeId/metaAdId; D13: único caminho do Pick from Meta)
 *   IterateBatch.source     += fromMeta: boolean
 *   ChampionRow.sources     += 'META'
 *   ChampionDetail          += metaAd: { adId: string; adAccountId: string } | null
 */
