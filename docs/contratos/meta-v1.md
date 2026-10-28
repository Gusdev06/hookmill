# Meta v1 · conectar, ler vencedores e publicar a 1ª campanha
Data: 2026-10-21 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 21/10** (D1-D16 do §10 como recomendadas + spec do design `design/onboarding-v2-2026-10-21.md`). Tipos em `@maquina/contratos` (`contratos/src/meta.ts` + aditivos no `index.ts`/`iteracao.ts`), schema e migração `20261021000000_meta_v1` **já aplicados** (A1 feito 21/10). Código liberado na ordem do §12: I1 ‖ B1 ‖ F1 → Q1.
Base: `feedback/tordan-loom-2026-10-20.md` (prioridade nº 1: "subir meu anúncio, integrar tudo e lançar a primeira campanha pelo HookMill"), `decisions/log.md` 21/10 (Meta sai do §8 do [`fase2-agencia.md`](fase2-agencia.md)), convenções e erros em [`api.md` §1](api.md), padrão mock/live de [`../integracoes.md`](../integracoes.md), `Job` em [`api.md` §5](api.md), `Champion`/`Upload` em [`api.md` §18-19](api.md), `POST /iterate` em [`variacao-auto-v1.md`](variacao-auto-v1.md). Onboarding (passo 2) e tour em [`onboarding-v2.md`](onboarding-v2.md).

Escopo: **só o que o Tordan pediu**. Conectar a conta, listar os anúncios de vídeo com números de 30 dias e apontar o vencedor (Iterate a winner "Pick from Meta", Home), publicar um criativo `APPROVED` como campanha + conjunto + anúncio (tudo pausado; ele ativa). Fora: Eddy, Campaigns completo, regras de orçamento, otimização automática, webhooks da Meta, Instagram actor, catálogo, A/B nativo (§9).

## 0. Resumo em 5 linhas
1. **Conexão por workspace** (tabela nova `MetaConnection`, 1 por cliente): Facebook Login for Business com redirect tratado pela API (`PUBLIC_API_URL/api/v1/meta/callback`), token long-lived **cifrado** (AES-256-GCM, chave em env), nunca vai pro web. Depois da conexão o usuário escolhe ad account + página (+ pixel opcional); health check diz se dá pra publicar.
2. **Leitura:** job `META_SYNC` lê os anúncios de vídeo da conta escolhida com insights de 30 d, 7 d e 7 d anteriores e grava em `MetaAdSnapshot` (gasto, resultados, CPA, ROAS, CTR, hook rate, frequência). Regras explicáveis: **vencedor** (gasto ≥ US$ 50 e ≥ 3 resultados, CPA ≤ mediana da conta) e **tendência** working/steady/tiring (CPA 7 d × 7 d anteriores), §5. "Pick from Meta" = `POST /iterate { metaAdId }` (um caminho só, §3.2): baixa o vídeo do anúncio, cria o `Champion` (reaproveita `ingestVideoWithThumbnail`) e segue o fluxo de hoje.
3. **Publicação:** job `META_PUBLISH` a partir de um `Creative` `APPROVED`: vídeo → criativo da Meta → campanha → conjunto → anúncio, **tudo `PAUSED`**, ids gravados em `MetaPublication` a cada passo (retry retoma de onde parou, sem duplicar). Nome da campanha/anúncio = `Creative.adName` (fase2 D6). Erro da Meta vira `errorCode` + frase legível + `action`.
4. **Defaults mínimos:** objetivo pelo `resultType` do cliente (resultado-v1, 28/10: tabela em [`fase2-agencia.md` §1.1](fase2-agencia.md), com o evento do pixel em `settings.pixelEvent`; antes era pelo `businessType`: ONLINE_STORE → `OUTCOME_SALES`, LOCAL_BUSINESS → `OUTCOME_LEADS`, APP → `OUTCOME_APP_PROMOTION`; sem pixel → `OUTCOME_TRAFFIC` com aviso), orçamento diário informado pelo usuário, público amplo (país do `market`, 18-65, Advantage+ audience), posicionamentos automáticos.
5. **Modo `META_MODE=mock`** (padrão) roda tudo sem app na Meta, com gatilhos pro QA (§8). Live só com o checklist do §11 feito pelo Gusta.

## 1. Modelo de dados (diff do `schema.prisma`, em texto; migração `20261022000000_meta_v1`, aditiva, escrita pelo arquiteto via `npm run db:diff` com `npm run db:backup` antes)
```prisma
enum MetaConnectionStatus {
  ACTIVE          // token válido na última checagem
  TOKEN_INVALID   // debug_token falhou, expirou ou perdeu permissão: reconectar
  DISCONNECTED    // usuário desconectou (token apagado); a linha fica pelo histórico
}

enum MetaTokenType {
  USER_LONG_LIVED // 60 dias; v1 (D4)
  SYSTEM_USER     // reservado: token de system user da integração, não expira (pós-v1)
}

enum MetaObjective {
  OUTCOME_SALES
  OUTCOME_LEADS
  OUTCOME_APP_PROMOTION
  OUTCOME_TRAFFIC
}

enum MetaAdVerdict {
  WINNER    // §5
  OK        // elegível, mas CPA acima da mediana
  LOW_DATA  // gasto ou resultados abaixo do mínimo
}

// §5.2: tendência dos últimos 7 d contra os 7 d anteriores (null = dado insuficiente)
enum MetaAdTrend {
  WORKING
  STEADY
  TIRING
}

enum MetaPublicationStatus {
  PUBLISHING  // job META_PUBLISH rodando
  PAUSED      // criado na Meta, pausado (estado em que nasce)
  ACTIVE      // usuário ativou pelo HookMill
  FAILED      // job falhou; errorCode/failReason/action
  DELETED     // apagado na Meta (visto no sync)
}

enum JobType {
  // ... existentes
  META_SYNC     // lê anúncios + insights 30 d da conta escolhida → MetaAdSnapshot
  META_IMPORT   // baixa o vídeo de um anúncio → File CHAMPION_VIDEO → Champion (rights OWN)
  META_PUBLISH  // vídeo → creative → campanha → ad set → ad (PAUSED)
}

// 1 por workspace. O token NUNCA sai da API: cifrado com META_TOKEN_KEY (AES-256-GCM; iv + tag + ciphertext em base64 numa coluna).
model MetaConnection {
  id               String               @id @default(cuid())
  workspaceId      String               @unique @map("workspace_id")
  status           MetaConnectionStatus @default(ACTIVE)
  tokenType        MetaTokenType        @default(USER_LONG_LIVED) @map("token_type")
  tokenCiphertext  String?              @map("token_ciphertext") // null depois de DISCONNECTED
  tokenExpiresAt   DateTime?            @map("token_expires_at") // do debug_token; null = não expira (SYSTEM_USER)
  scopes           String[]             @default([])             // concedidos de fato (debug_token.scopes)
  metaUserId       String               @map("meta_user_id")
  metaUserName     String               @map("meta_user_name")
  // escolha do usuário (PUT /meta/selection). null = conectado mas sem conta escolhida (health = selection_missing)
  adAccountId      String?              @map("ad_account_id")    // "act_123"
  adAccountName    String?              @map("ad_account_name")
  currency         String?                                        // "USD", "BRL" (da conta)
  timezoneName     String?              @map("timezone_name")
  accountStatus    Int?                 @map("account_status")   // 1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED...
  businessId       String?              @map("business_id")
  pageId           String?              @map("page_id")
  pageName         String?              @map("page_name")
  pixelId          String?              @map("pixel_id")
  pixelName        String?              @map("pixel_name")
  lastHealth       Json?                @map("last_health")      // MetaHealth (§2) da última checagem
  lastHealthAt     DateTime?            @map("last_health_at")
  lastSyncAt       DateTime?            @map("last_sync_at")
  lastSyncJobId    String?              @map("last_sync_job_id")
  lastSyncError    String?              @map("last_sync_error")  // errorCode do último sync que falhou; null quando o último deu certo
  connectedById    String               @map("connected_by_id")
  connectedAt      DateTime             @default(now()) @map("connected_at")
  disconnectedAt   DateTime?            @map("disconnected_at")
  createdAt        DateTime             @default(now()) @map("created_at")
  updatedAt        DateTime             @updatedAt @map("updated_at")

  workspace    Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connectedBy  User              @relation("MetaConnectedBy", fields: [connectedById], references: [id])
  snapshots    MetaAdSnapshot[]
  publications MetaPublication[]

  @@map("meta_connections")
}

// Um anúncio de vídeo da conta escolhida + insights dos últimos 30 dias. Substituído inteiro a cada META_SYNC (delete + insert da conexão).
model MetaAdSnapshot {
  id              String        @id @default(cuid())
  workspaceId     String        @map("workspace_id")
  connectionId    String        @map("connection_id")
  adAccountId     String        @map("ad_account_id")
  metaAdId        String        @map("meta_ad_id")
  name            String
  effectiveStatus String        @map("effective_status") // ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED, WITH_ISSUES...
  campaignId      String        @map("campaign_id")
  campaignName    String        @map("campaign_name")
  adsetId         String        @map("adset_id")
  adsetName       String        @map("adset_name")
  metaCreativeId  String?       @map("meta_creative_id")
  videoId         String?       @map("video_id")         // null = não é anúncio de vídeo (não entra na lista; guardado só se vier de uma publicação nossa)
  thumbnailUrl    String?       @map("thumbnail_url")    // URL da Meta (expira; o web usa como está)
  resultType      String?       @map("result_type")      // action_type usado como "resultado": purchase | lead | mobile_app_install | link_click
  metrics         Json                                   // MetaMetrics (§2) dos últimos 30 d
  metrics7d       Json          @map("metrics_7d")       // MetaMetrics dos últimos 7 d (+ frequency)
  metricsPrev7d   Json          @map("metrics_prev_7d")  // MetaMetrics dos 7 d anteriores (dias 8-14)
  verdict         MetaAdVerdict @default(LOW_DATA)
  trend           MetaAdTrend?                           // §5.2; null = dado insuficiente
  adCreatedTime   DateTime?     @map("ad_created_time")
  syncedAt        DateTime      @map("synced_at")

  workspace  Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connection MetaConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, metaAdId])
  @@index([workspaceId, verdict])
  @@map("meta_ad_snapshots")
}

// Uma publicação de um Creative na Meta. Ids gravados a cada passo do job (retomada idempotente). Várias por criativo
// são permitidas (ex.: republicar em outra conta), mas só uma pode estar PUBLISHING por vez.
model MetaPublication {
  id              String                @id @default(cuid())
  workspaceId     String                @map("workspace_id")
  connectionId    String                @map("connection_id")
  creativeId      String                @map("creative_id")
  status          MetaPublicationStatus @default(PUBLISHING)
  adAccountId     String                @map("ad_account_id")
  pageId          String                @map("page_id")
  pixelId         String?               @map("pixel_id")
  settings        Json                                           // MetaPublishSettings (§2): o que o usuário mandou + defaults resolvidos
  renderFileId    String                @map("render_file_id")   // File RENDER_VIDEO enviado (= creative.finalRender.fileId no momento)
  videoId         String?               @map("video_id")         // /advideos
  metaCreativeId  String?               @map("meta_creative_id") // /adcreatives
  campaignId      String?               @map("campaign_id")
  adsetId         String?               @map("adset_id")
  metaAdId        String?               @map("meta_ad_id")
  previewUrl      String?               @map("preview_url")      // /{ad}/previews (iframe src), opcional
  errorCode       String?               @map("error_code")       // MetaAsyncErrorCode
  failReason      String?               @map("fail_reason")      // frase humana (error_user_msg da Meta quando houver)
  failDetail      String?               @map("fail_detail")      // code/subcode/fbtrace_id (debug)
  failedStage     String?               @map("failed_stage")     // etapa do checklist em que parou
  jobId           String?               @map("job_id")
  publishedAt     DateTime?             @map("published_at")     // anúncio criado (PAUSED)
  activatedAt     DateTime?             @map("activated_at")
  createdById     String                @map("created_by_id")
  createdAt       DateTime              @default(now()) @map("created_at")
  updatedAt       DateTime              @updatedAt @map("updated_at")

  workspace  Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connection MetaConnection @relation(fields: [connectionId], references: [id])
  creative   Creative       @relation(fields: [creativeId], references: [id], onDelete: Cascade)
  renderFile File           @relation("MetaPublicationVideo", fields: [renderFileId], references: [id])
  createdBy  User           @relation("MetaPublishedBy", fields: [createdById], references: [id])

  @@index([creativeId, createdAt])
  @@index([workspaceId, status])
  @@map("meta_publications")
}

model Champion {
  // ... existentes
  metaAdId        String? @map("meta_ad_id")         // NOVO: veio do "Pick from Meta" (META_IMPORT). sources ganha 'META'
  metaAdAccountId String? @map("meta_ad_account_id") // NOVO
}

model Job {
  // ... existentes
  metaPublicationId String? @map("meta_publication_id") // NOVO (META_PUBLISH)
}
```
Relações novas em `Workspace` (`metaConnection MetaConnection?`, `metaAdSnapshots`, `metaPublications`), `User` (`metaConnections`, `metaPublications`), `Creative` (`metaPublications MetaPublication[]`), `File` (`metaPublicationVideos`). Nenhuma coluna removida; nada do que existe muda de tipo. `Creative` **não** ganha colunas da Meta (D7): a publicação é uma entidade própria com histórico.

Por que `MetaAdSnapshot` e não ler a Meta a cada tela: a Home, o Clients e o tour abrem muitas vezes; a Marketing API tem limite por conta (BUC) e cada leitura de insights de 100+ anúncios leva segundos. Snapshot de 30 dias + sync a cada 6 h (e manual) dá número igual em todas as telas e deixa a regra de vencedor rodar em SQL/JS sobre dados locais.

## 2. Tipos (`contratos/src/meta.ts`, proposta; só entram no `index.ts` depois do ok)
```ts
type MetaConnectionStatus = 'ACTIVE' | 'TOKEN_INVALID' | 'DISCONNECTED';
type MetaObjective = 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_APP_PROMOTION' | 'OUTCOME_TRAFFIC';
type MetaAdVerdict = 'WINNER' | 'OK' | 'LOW_DATA';
type MetaPublicationStatus = 'PUBLISHING' | 'PAUSED' | 'ACTIVE' | 'FAILED' | 'DELETED';
type MetaCallToAction = 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP' | 'GET_OFFER' | 'BOOK_NOW' | 'CONTACT_US' | 'DOWNLOAD' | 'SUBSCRIBE' | 'APPLY_NOW' | 'GET_QUOTE' | 'ORDER_NOW';
type MetaSpecialAdCategory = 'HOUSING' | 'CREDIT' | 'EMPLOYMENT' | 'ISSUES_ELECTIONS_POLITICS' | 'FINANCIAL_PRODUCTS_SERVICES';

type MetaHealthLevel = 'ok' | 'warn' | 'bad';
interface MetaHealthCheck {
  key: 'token' | 'scopes' | 'account' | 'funding' | 'page' | 'pixel' | 'budget' | 'verified';
  level: MetaHealthLevel;            // bad bloqueia publicar; warn só avisa (pixel, verified, token expirando)
  detail: string | null;             // frase curta pro usuário (EN; o web traduz pelo key+level quando tiver chave)
}
interface MetaHealth {
  level: MetaHealthLevel;            // pior nível entre os checks (a tela: verde / âmbar / vermelho)
  canPublish: boolean;               // nenhum check 'bad' entre token, scopes, account, funding, page, budget
  checks: MetaHealthCheck[];
  adsCount: number; activeCount: number;   // anúncios de vídeo da conta no último sync (0 antes do 1º sync)
  checkedAt: string;
}

// GET /meta/connection (nunca traz token)
interface MetaConnection {
  status: MetaConnectionStatus;
  user: { id: string; name: string };
  scopes: string[]; tokenExpiresAt: string | null;
  adAccount: { id: string; name: string; currency: string; timezoneName: string; accountStatus: number } | null;
  page: { id: string; name: string } | null;
  pixel: { id: string; name: string } | null;
  health: MetaHealth | null;
  lastSyncAt: string | null; syncing: boolean;
  connectedBy: UserRef; connectedAt: string;
}

// GET /meta/oauth/status (22/10): acompanhamento do login feito em OUTRO navegador (memória do processo, TTL 15 min)
interface MetaOAuthStatus {
  pending: boolean;                      // há um connect deste workspace sem callback e dentro do prazo
  expiresAt: string | null;              // do state pendente
  lastError: { code: MetaOAuthErrorCode; missing: string[]; at: string } | null;   // último callback que falhou (limpo no sucesso)
  connectedAt: string | null;            // último callback que deu certo
}

// GET /meta/options (lido ao vivo da Meta)
interface MetaAdAccountOption {
  id: string; name: string; currency: string; accountStatus: number;
  business: { id: string; name: string } | null;
  canManage: boolean;                    // user_tasks contém MANAGE ou ADVERTISE (sem = só leitura: aparece desabilitada)
  permissionReason: 'no_advertise_task' | 'account_disabled' | null;   // por que não dá pra escolher (chip "No permission")
}
interface MetaOptions {
  adAccounts: MetaAdAccountOption[];
  pages: { id: string; name: string }[];
  pixels: { id: string; name: string; adAccountId: string | null; lastFiredAt: string | null }[];   // vazio até escolher a conta
}
interface MetaSelectionBody { adAccountId: string; pageId: string; pixelId?: string | null }

interface MetaMetrics {
  spend: number; impressions: number; clicks: number; ctr: number;      // ctr = clicks/impressions (%)
  results: number; resultType: string | null; cpa: number | null;       // cpa = spend/results
  roas: number | null;                                                  // purchase_roas (só compra)
  plays2s: number | null; hookRate: number | null;                      // plays2s = video_continuous_2_sec_watched_actions (2-Second Continuous Video Plays); hookRate = plays2s/impressions (%). Era `plays2s` até 22/10 (campo de 3 s não existe na Marketing API v25)
  thruplays: number | null;
  frequency: number | null;                                             // impressions/reach (só vem nas janelas de 7 d)
}
type MetaAdTrend = 'WORKING' | 'STEADY' | 'TIRING';
interface MetaAdRow {
  metaAdId: string; name: string; effectiveStatus: string;
  campaign: { id: string; name: string }; adset: { id: string; name: string };
  thumbnailUrl: string | null; videoId: string | null;
  metrics: MetaMetrics;                  // 30 d
  metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
  verdict: MetaAdVerdict;
  trend: MetaAdTrend | null;             // §5.2; null = dado insuficiente (a tela mostra "—")
  daysRunning: number | null;            // hoje − adCreatedTime, em dias
  /** anúncio publicado pelo HookMill: o criativo de origem */
  creative: { id: string; name: string; adName: string | null } | null;
  /** já importado como campeão (Pick from Meta) */
  championId: string | null;
  adCreatedTime: string | null; syncedAt: string;
}
type MetaPeriod = '7d' | '30d';
interface MetaSyncState {
  state: 'ok' | 'first_sync' | 'syncing' | 'stale' | 'failed' | 'never';   // stale = syncedAt > 12 h; never = sem conta escolhida
  syncedAt: string | null;
  progress: { done: number; total: number; unit: 'ads' } | null;            // só em first_sync/syncing (do job META_SYNC)
  job: Job | null;                                                          // o job em andamento (ou o último que falhou)
}
interface MetaSummary {
  period: MetaPeriod; currency: string | null;
  spend: number; results: number; resultType: string | null; cpa: number | null; roas: number | null; ctr: number | null; hookRate: number | null;
  prev: { spend: number; cpa: number | null; roas: number | null } | null;  // período anterior de mesmo tamanho (null = sem dado)
  medianCpa: number | null;              // dos elegíveis, 30 d (é o "account median CPA" do tour)
  adsCount: number; activeAds: number; newThisWeek: number;                 // newThisWeek = adCreatedTime nos últimos 7 d
  eligibleCount: number; winnersCount: number; tiringCount: number;
  rule: { minSpendUsd: number; minResults: number };                        // o que a regra usou (pra tela explicar)
  sync: MetaSyncState;
}
interface MetaSummaryQuery { period?: MetaPeriod }                          // padrão 30d
interface MetaAdsQuery { verdict?: MetaAdVerdict; trend?: MetaAdTrend; q?: string; sort?: 'spend' | 'cpa' | 'hookRate' | 'ctr'; limit?: number; cursor?: string }
interface MetaAdsMeta extends PageMeta { summary: MetaSummary }

// defaults que o web mostra antes de publicar (GET /creatives/:id/meta)
interface MetaPublishDefaults {
  objective: MetaObjective; objectiveReason: 'business_type' | 'no_pixel';
  countries: string[];                   // ISO-3166-1 alfa-2 derivado de workspace.market (vazio = usuário escolhe)
  ageMin: 18; ageMax: 65;
  dailyBudgetMinor: number | null;       // mínimo da conta na moeda dela (minimum_budgets), em centavos
  currency: string | null;
  page: { id: string; name: string } | null; pixel: { id: string; name: string } | null;
  name: string;                          // creative.adName (fase2 D6)
  primaryText: string;                   // 1ª fala do roteiro (gancho) ou offer.promise
  headline: string | null;               // editSettings.headline ?? offer.what (≤ 40)
  description: string | null;
  callToAction: MetaCallToAction;        // por objetivo: SALES → SHOP_NOW, LEADS → SIGN_UP, APP → DOWNLOAD, TRAFFIC → LEARN_MORE
  link: string | null;                   // offer.sourceUrl ?? workspace.websiteUrl
}
interface MetaPublishBody {
  dailyBudgetMinor: number;              // centavos na moeda da conta; ≥ mínimo da conta
  countries: string[];                   // 1-10, ISO alfa-2
  objective?: MetaObjective;             // sem = default
  primaryText: string;                   // 1-2000
  headline?: string;                     // ≤ 40 (acima = aviso, não erro)
  description?: string;                  // ≤ 125
  callToAction: MetaCallToAction;
  link: string;                          // http(s), ≤ 2048
  specialAdCategories?: MetaSpecialAdCategory[];   // padrão []
  ageMin?: number; ageMax?: number;      // 18-65
}
type MetaPublishSettings = Required<Omit<MetaPublishBody, 'headline' | 'description'>> & { headline: string | null; description: string | null; objectiveReason: MetaPublishDefaults['objectiveReason'] };

interface MetaPublication {
  id: string; status: MetaPublicationStatus;
  creativeId: string; adAccountId: string;
  ids: { videoId: string | null; creativeId: string | null; campaignId: string | null; adsetId: string | null; adId: string | null };
  settings: MetaPublishSettings;
  adsManagerUrl: string | null;          // https://adsmanager.facebook.com/adsmanager/manage/ads?act=<id sem act_>&selected_ad_ids=<adId>
  previewUrl: string | null;
  job: Job | null;                       // checklist: uploading_video → processing_video → creating_campaign → creating_adset → creating_creative → creating_ad
  errorCode: MetaAsyncErrorCode | null; failReason: string | null; action: Action | null;
  metrics: MetaMetrics | null;           // do snapshot, quando o sync já viu o anúncio
  publishedAt: string | null; activatedAt: string | null; createdBy: UserRef; createdAt: string;
}
interface CreativeMetaResponse {
  publication: MetaPublication | null;   // a mais recente (createdAt desc)
  history: MetaPublication[];            // SÓ as anteriores, mais recente primeiro; a atual NÃO repete aqui (decisão 21/10 pós-QA)
  defaults: MetaPublishDefaults | null; connection: { status: MetaConnectionStatus; canPublish: boolean } | null;
}

// §3.4: código que volta na query do redirect do callback (?meta=error&code=)
type MetaOAuthErrorCode = 'META_OAUTH_DENIED' | 'META_OAUTH_FAILED' | 'META_STATE_INVALID' | 'META_SCOPES_MISSING' | 'META_UNAVAILABLE';

type MetaAsyncErrorCode =
  | 'META_TOKEN_INVALID' | 'META_PERMISSION' | 'META_ACCOUNT_UNUSABLE' | 'META_PAYMENT_REQUIRED' | 'META_POLICY'
  | 'META_BUDGET_TOO_LOW' | 'META_VIDEO_REJECTED' | 'META_VIDEO_UNAVAILABLE' | 'META_RATE_LIMITED' | 'META_ERROR';
// Action ganha: 'reconnect_meta' | 'choose_account' | 'fix_payment' | 'edit_ad_text' | 'raise_budget' (aditivo ao union de api.md §1)
// ServiceStatus.provider ganha 'META' (connected = META_APP_ID + META_APP_SECRET + META_TOKEN_KEY no .env; keyMasked = app id mascarado)
// CreateIterateBody ganha `metaAdId?: string` (exatamente um de uploadId/creativeId/metaAdId); IterateBatch.source ganha `fromMeta?: boolean` e ChampionDetail ganha `metaAd?` (opcionais no pacote até B1 entregar; o backend devolve sempre)
// ChampionRow.sources ganha 'META'; ChampionDetail ganha `metaAd: { adId: string; adAccountId: string } | null`
// JobType ganha 'META_SYNC' | 'META_IMPORT' | 'META_PUBLISH'; AsyncErrorCode ganha MetaAsyncErrorCode
```

## 3. Endpoints (módulo Nest novo `api/src/meta/`; prefixo `/meta` e `/creatives/:id/meta`)
### 3.1 Conexão (onboarding passo 2 e Settings → Meta)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `POST /meta/connect` | `{ returnTo?: '/onboarding/meta' \| '/settings/connections' \| '/meta/done' }` (padrão `/onboarding/meta`; `/settings/connections` é a tela Settings › Connections onde o `MetaConnect` mora (ajuste 21/10 pós-revisão: `/settings` sozinho volta pra aba Account, que não lê `?meta=`); `/settings` continua aceito como alias até o web trocar; **`/meta/done`** = página mínima do web **fora do shell e sem sessão** que lê `?meta=connected\|error&code=` e mostra "Connected, go back to HookMill" ou o erro com "Try again in HookMill"; se foi aberta como popup, faz `postMessage` pra aba de origem e fecha. É o `returnTo` do **"Connect from another browser"** (caso real do Gusta, 22/10: Multilogin/AdsPower, uma conta de anúncios por navegador com proxy, Facebook não logado no navegador do HookMill): a tela de origem mostra a `url` com **Copy link** + contagem até `expiresAt` (10 min) e fica em polling até a conexão aparecer (§3.1 `GET /meta/oauth/status`). O fluxo já é compatível por desenho: callback público, `state` leva `wid`/`sub`, nada de cookie; a API não sabe (nem precisa) em que navegador o login aconteceu) | `201 { url, expiresAt }`: URL do diálogo `https://www.facebook.com/<v>/dialog/oauth?client_id&config_id=<META_CONFIG_ID>&redirect_uri=<PUBLIC_API_URL>/api/v1/meta/callback&state=<jwt>&response_type=code&override_default_response_type=true`. `state` = JWT de 10 min assinado com `JWT_ACCESS_SECRET` com `{ wid, sub, returnTo, nonce }`; nada no banco | 503 `META_NOT_CONFIGURED` (live sem app id/secret/config/chave) | OWNER, ADMIN |
| `GET /meta/callback` *pública* | `?code&state` (ou `?error&error_reason&error_description`) | **302** pra `<WEB_ORIGIN[0]><returnTo>?meta=connected` ou `?meta=error&code=<MetaOAuthErrorCode>` (tabela em §3.4; `META_SCOPES_MISSING` leva também `&missing=ads_management,…`). Por dentro: valida `state` → troca `code` por token (`GET /oauth/access_token` com app secret) → troca por long-lived (`fb_exchange_token`) → `GET /debug_token` (scopes, `expires_at`, `is_valid`) → `GET /me?fields=id,name` → upsert `MetaConnection` (ACTIVE, token cifrado, seleção anterior mantida se for o mesmo `metaUserId`; usuário diferente limpa a seleção e os snapshots) | nunca JSON (é navegação); falha = redirect com `code` | — |
| `GET /meta/connection` | — | `MetaConnection` (§2) ou `null` quando nunca conectou | — | todos |
| `GET /meta/oauth/status` (22/10, "Connect from another browser") | — | `MetaOAuthStatus` (§2): `pending` (um `POST /meta/connect` deste workspace ainda dentro do `expiresAt` e sem callback), `expiresAt`, `lastError` (`{ code: MetaOAuthErrorCode, missing, at }` do **último callback que falhou**, ou `null`) e `connectedAt` (do último callback que deu certo). **Fonte: memória do processo da API** (`Map<workspaceId, …>`, TTL 15 min), escrita por `POST /meta/connect` (pending) e por `GET /meta/callback` (sucesso limpa `pending`/`lastError` e grava `connectedAt`; falha grava `lastError`). Sem coluna nem migração: cobre inclusive a 1ª tentativa, quando ainda não existe linha em `meta_connections`; a API roda numa instância (eventos.md), e se um dia virar 2+ o store vira tabela `meta_oauth_attempts` sem mudar a rota. A aba de origem faz polling aqui a cada **3 s** enquanto `pending`; `pending = false` → refaz `GET /meta/connection` (sucesso) ou mostra `lastError` (frases do §3.4) com "Try again" | — | todos |
| `GET /meta/options` | `?adAccountId=` (opcional: pixels dessa conta antes de escolher) | `MetaOptions` lido ao vivo (`/me/adaccounts?fields=id,name,currency,account_status,business,user_tasks`, `/me/accounts?fields=id,name`, `act_<id>/adspixels?fields=id,name,last_fired_time` só da conta escolhida ou da query). `canManage = user_tasks ∋ MANAGE \| ADVERTISE`; conta sem isso vem com `permissionReason` e a tela mostra desabilitada com a instrução de pedir acesso no Business Manager | 422 `META_NOT_CONNECTED`, 422 `META_TOKEN_INVALID`, 503 `META_UNAVAILABLE` | OWNER, ADMIN |
| `PUT /meta/selection` | `MetaSelectionBody` | `MetaConnection` com `health` novo (roda o health na hora) e dispara `META_SYNC` se `canPublish` ou `ads_read` ok. Conta diferente da anterior apaga os snapshots | 400, 404 `NOT_FOUND` (conta/página/pixel não estão nas opções do usuário), 422 `META_NOT_CONNECTED`, **422 `META_PERMISSION`** `{ adAccountId, reason }` (conta com `canManage = false`) | OWNER, ADMIN |
| `POST /meta/health` | `{}` | `MetaHealth` (e grava `lastHealth`). Checks e níveis: `token` (`is_valid` false = **bad**; expira em < 7 d = **warn** "Reconnect before <data>"), `scopes` (faltando um dos 4 do §4 = **bad** com a lista), `account` (`account_status = 1` ok; 2 DISABLED/100-101 CLOSED = **bad** "Account disabled, choose another"; 3 UNSETTLED/9 IN_GRACE_PERIOD = **bad** "Unpaid balance"; 7 PENDING_RISK_REVIEW = **warn**), `funding` (`funding_source_details` presente = ok; ausente = **bad** "Add a payment method in Ads Manager"), `page` (`/{pageId}?fields=id` responde = ok; senão **bad** "You lost access to this Page"), `pixel` (sem pixel = **warn** "No pixel: ads will optimize for clicks"; `last_fired_time` > 7 d ou null = **warn** "Pixel hasn't fired in 7 days: results on Home may be empty"), `budget` (`minimum_budgets` lido e cacheado; falha de leitura = **warn**; **a Graph devolve `minimum_budgets` como `{ data: [...] }`** na conta real (22/10), não como lista crua: a integração aceita as duas formas), `verified` (`/{businessId}?fields=verification_status`: `verified` ok; outro = **warn** "Business not verified: Meta may limit spend"; sem business = **warn**). `canPublish` = nenhum **bad** fora de `pixel`/`verified` | 422 `META_NOT_CONNECTED`, 503 `META_UNAVAILABLE` | **todos, inclusive CLIENT** (`@ClientAllowed`: é leitura que só atualiza o cache `lastHealth`; regra fechada 21/10 pós-QA) |
| `DELETE /meta/connection` | — | `{ ok: true }`: `DELETE /me/permissions` na Meta (melhor esforço), apaga `tokenCiphertext`, `status = DISCONNECTED`, apaga snapshots; publicações ficam (histórico) | 404 | OWNER, ADMIN |

Regras: `TOKEN_INVALID` é setado por qualquer chamada que receba `code 190` (ou `is_valid: false`); todas as rotas que precisam do token respondem `422 META_TOKEN_INVALID` (`action: reconnect_meta`) até reconectar. Health roda sozinho 1× por dia (cron) e antes de toda publicação.

### 3.2 Leitura (Iterate a winner "Pick from Meta", Home, Campaigns v0)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `POST /meta/sync` | `{}` | `202 { job }` (`META_SYNC`, checklist `listing_ads` → `reading_insights` → `scoring`; `progress` do job = anúncios lidos / total, que vira `sync.progress` do sumário). Se já há sync rodando, devolve o job em andamento (200) em vez de abrir outro. Mínimo 5 min entre syncs manuais | 422 `META_NOT_CONNECTED` / `META_SELECTION_MISSING`, 429 `RATE_LIMITED` `{ retryAfterSec }` | OWNER, ADMIN, MEMBER |
| `GET /meta/ads` | `MetaAdsQuery` | `MetaAdRow[]` + `meta: MetaAdsMeta` (ordem padrão: `WINNER` primeiro, depois gasto desc; o tour pega o 1º). Só anúncios de **vídeo** (`creative.video_id` presente ou `object_story_spec.video_data`). Lista vazia + `summary.sync.state = first_sync` = ainda não sincronizou | 400, 422 `META_NOT_CONNECTED` | todos |
| `GET /meta/summary` | `?period=7d\|30d` (padrão 30d) | `MetaSummary` da conta escolhida: KPIs do período, `prev` (período anterior de mesmo tamanho, pra seta de variação), contagens (ativos, novos na semana, cansando), mediana e regra, e `sync` (estado + progresso). É o bloco de KPIs da Home e o "synced X min ago" | 400, 422 `META_NOT_CONNECTED` | todos |
| `POST /iterate` (rota existente, **único caminho** do "Pick from Meta"; D13) | `{ metaAdId, offerId? }` (exatamente um de `uploadId`/`creativeId`/`metaAdId`; `offerId` obrigatório só com > 1 oferta ativa) | `202 IterateBatch` igual ao de hoje com `uploadId`: por dentro roda o job `META_IMPORT` (`fetching_video` → `downloading_video`), cria o `Champion` (`rights = OWN`, `name` = nome do anúncio, `metaAdId` + `metaAdAccountId` gravados, `sources: ['META']`) e segue `ANALYZING` → `PLANNING`. `source.fromMeta: true`. Mesmo anúncio já importado e não arquivado → reaproveita o campeão (e o vídeo), sem baixar de novo | os de hoje (`OFFER_REQUIRED`, `SPEND_CAP_EXCEEDED`…) + 404 (`metaAdId` fora do snapshot), 422 `META_NOT_CONNECTED` | OWNER, ADMIN, MEMBER |

**Fora:** `POST /champions { metaAdId }` e `POST /meta/ads/:id/import` (D13).

**`IterateConfig.metaConnected` (variacao-auto-v1) continua literal `false`:** o web não lê a conexão por ali; lê `GET /meta/connection` (`metaReady` = ACTIVE + conta + página) pra mostrar o "Pick from Meta" e o `GET /meta/ads` pra lista. Um estado só, uma fonte só; o campo legado fica até a próxima limpeza do contrato do iterate. O fluxo manual de campeão (`POST /champions`) continua só com upload e link da Ad Library.

Download do vídeo (`META_IMPORT`): `GET /{videoId}?fields=source,permalink_url,length` → `source` é uma URL temporária da CDN; `storage.ingestVideoWithThumbnail(source, { kind: 'CHAMPION_VIDEO' })` (decodificação inteira, 3 tentativas, como a Ad Library). Sem `source` (vídeo de outra página, permissão) → campeão `FAILED` `META_VIDEO_UNAVAILABLE`, `action: upload_video` (o lote fica `ANALYSIS_FAILED` e o usuário sobe o MP4 na mão pelo caminho de hoje).

Campos lidos no sync: `act_<id>/ads?fields=id,name,effective_status,created_time,campaign{id,name},adset{id,name},creative{id,video_id,thumbnail_url,object_story_spec}&limit=100` (pagina até 500 anúncios) e **3 leituras** de `act_<id>/insights?level=ad&fields=ad_id,spend,impressions,reach,clicks,ctr,actions,cost_per_action_type,purchase_roas,video_play_actions,video_thruplay_watched_actions,video_continuous_2_sec_watched_actions&limit=500`: `date_preset=last_30d`, `date_preset=last_7d` e `time_range={since: hoje−14, until: hoje−8}` (a janela anterior, pro `trend` e pro `prev`). Resultado = `action_type` pelo `businessType`: ONLINE_STORE → `omni_purchase` (fallback `purchase`), LOCAL_BUSINESS → `lead` (fallback `onsite_conversion.lead_grouped`), APP → `omni_app_install`; sem pixel/resultado → `link_click` com `resultType` dizendo isso. **Campos de insights confirmados na conta real do Gusta em 22/10 (sonda de leitura, US$ 0).** `video_3_sec_watched_actions` **não existe** na Marketing API v25 (recusado com `#100`; o enum oficial do SDK v25 confirma): o hook usa **`video_continuous_2_sec_watched_actions`** ("2-Second Continuous Video Plays") e **`hookRate = plays2s / impressions × 100`**. Se a Graph recusar um campo não essencial, a janela é relida sem ele e o campo fica `null` (a tela esconde a coluna).

### 3.3 Publicação (tela Send do criativo aprovado → "Publish to Meta")
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /creatives/:id/meta` | — | `CreativeMetaResponse`: `publication` = a mais recente; **`history` = só as anteriores (`createdAt desc`), sem a atual** (o web não deduplica; ajuste 21/10 pós-QA: a 1ª entrega repetia a atual no histórico); defaults pré-preenchidos (§2) e o estado da conexão. `defaults = null` sem conexão | 404; **503 `META_NOT_CONFIGURED { reason: 'off' }` com `META_MODE=off`** (entra na regra "toda rota da Meta", inclusive este prefixo `/creatives/:id/meta`; o web esconde o bloco Publish pelo `isMetaOff`) | todos |
| `POST /creatives/:id/meta/publish` | `MetaPublishBody` | `202 MetaPublication` (`PUBLISHING`) + `job` (`META_PUBLISH`). Cria a linha com `settings` resolvidos e `renderFileId = finalRender.fileId` e roda o job | 400 `VALIDATION_ERROR`; 403 (CLIENT); 404; 409 `INVALID_STATE` `{ reason: 'not_approved' }` (estado ≠ `APPROVED` ou sem `finalRender`) / `{ reason: 'publish_in_progress' }`; 422 `META_NOT_CONNECTED` / `META_SELECTION_MISSING` / `META_TOKEN_INVALID` / `META_PIXEL_REQUIRED` (objetivo SALES/LEADS/APP sem pixel; mande `objective: OUTCOME_TRAFFIC` ou escolha o pixel) / `META_ACCOUNT_UNUSABLE` `{ accountStatus }` / `META_BUDGET_TOO_LOW` `{ minimumMinor, currency }`; 503 `META_UNAVAILABLE` | OWNER, ADMIN, MEMBER |
| `POST /creatives/:id/meta/retry` | `{}` | `202 MetaPublication`: reabre o job **retomando** dos ids já gravados (vídeo pronto não sobe de novo; campanha criada não duplica) | 404, 409 `INVALID_STATE` (não está `FAILED`) | OWNER, ADMIN, MEMBER |
| `POST /creatives/:id/meta/activate` | `{ confirm: true }` | `MetaPublication` `ACTIVE`: `POST /{adId}` `status=ACTIVE`, idem ad set e campanha | 404, 409 `INVALID_STATE` (não está `PAUSED`), 422 `META_TOKEN_INVALID`, 503 | **OWNER, ADMIN** (D11: ativar é o que gasta) |
| `POST /creatives/:id/meta/pause` | `{}` | `MetaPublication` `PAUSED` (pausa só o anúncio) | 404, 409 | OWNER, ADMIN |
| `GET /meta/publications` | `?status&limit&cursor` | `MetaPublication[]` (mais recente primeiro) + `meta.nextCursor`: lista "publicado pelo HookMill" (Campaigns v0 e Home) | 400 | todos |

#### 3.3.1 Sequência da tela Send → "Publish to Meta" (guia pro frontend; F1 pendente em 21/10, §12)
1. **Abrir:** `GET /creatives/:id/meta`. `connection = null` → bloco "Connect Meta first" (link pra `/settings/connections`); `connection.canPublish = false` → bloco "Fix your Meta account" com o health; `defaults` preenche o formulário (objetivo + `objectiveReason`, países, orçamento diário na moeda da conta com o mínimo `dailyBudgetMinor`, texto primário, headline, descrição, CTA, link, página, pixel). `publication` = estado atual (nulo = nunca publicou); `history` = **só** as tentativas anteriores, sem a atual (lista colapsada; vazia na 1ª publicação).
2. **Publicar:** `POST /creatives/:id/meta/publish` com `MetaPublishBody` → `202 MetaPublication` em `PUBLISHING`. Erros síncronos com ação na tela: `409 INVALID_STATE not_approved` (criativo sem OK final: botão desabilitado antes), `publish_in_progress` (mostrar o progresso em vez do form), `422 META_PIXEL_REQUIRED` (trocar objetivo pra TRAFFIC com 1 clique), `META_BUDGET_TOO_LOW { minimumMinor, currency }` (subir o campo), `META_ACCOUNT_UNUSABLE`, `META_TOKEN_INVALID` (link reconectar), `503 META_UNAVAILABLE` (esperar `retryAfterSec`).
3. **Progresso:** polling `GET /creatives/:id/meta` a cada **2 s** enquanto `publication.status = PUBLISHING`; mostrar `publication.job.checklist` (6 etapas: `uploading_video` → `processing_video` → `creating_campaign` → `creating_adset` → `creating_creative` → `creating_ad`) e `job.progress`.
4. **Resultado:** `PAUSED` = sucesso ("Created, paused") com `adsManagerUrl` (abrir na Meta), `ids` e botão **Activate** (OWNER/ADMIN; `POST …/meta/activate { confirm: true }` com confirmação "this starts spending"); `ACTIVE` = botão **Pause** (`POST …/meta/pause`); `FAILED` = `errorCode` + `failReason` + `action` (`edit_ad_text` → volta pro form com os campos editáveis; `fix_payment`/`choose_account`/`reconnect_meta` → links; `retry`/`raise_budget` → **Retry** = `POST …/meta/retry`, que retoma dos ids já criados sem duplicar); `DELETED` = "removed in Ads Manager" + botão publicar de novo (cria nova publicação; a anterior fica no histórico).
5. **Métricas:** `publication.metrics` (do snapshot, depois do 1º sync) aparece no cartão da publicação PAUSED/ACTIVE; nulo = "no data yet".
6. **Papéis:** CLIENT vê tudo (GET) e nenhum botão; MEMBER publica e dá retry; só OWNER/ADMIN ativa/pausa.

Passos do job `META_PUBLISH` (cada passo grava o id antes de seguir; falha em qualquer um = `FAILED` com `failedStage`):
1. `uploading_video`: `POST act_<id>/advideos` com `file_url` = URL assinada do `renderFileId` quando a URL é pública (produção, `PUBLIC_MEDIA` ligado); em dev/local ou `PUBLIC_MEDIA=off`, upload resumable (`upload_phase=start/transfer/finish`) em pedaços de 8 MB lidos do storage. `name = adName`.
2. `processing_video`: `GET /{videoId}?fields=status` a cada 3 s até `status.video_status = ready` (teto 10 min → `META_ERROR` com `action: retry`; `error` → `META_VIDEO_REJECTED`).
3. `creating_campaign`: `POST act_<id>/campaigns` `{ name: adName, objective, status: PAUSED, special_ad_categories, buying_type: AUCTION }`.
4. `creating_adset`: `POST act_<id>/adsets` `{ name: adName, campaign_id, daily_budget: dailyBudgetMinor, billing_event: IMPRESSIONS, bid_strategy: LOWEST_COST_WITHOUT_CAP, status: PAUSED, targeting: { geo_locations: { countries }, age_min, age_max, targeting_automation: { advantage_audience: 1 } }, optimization_goal + promoted_object }` por objetivo: SALES → `OFFSITE_CONVERSIONS` + `{ pixel_id, custom_event_type: PURCHASE }`; LEADS → `OFFSITE_CONVERSIONS` + `{ pixel_id, custom_event_type: LEAD }`; APP → `APP_INSTALLS` (exige `application_id` + `object_store_url`: **v1 só aceita APP se a conta tiver o app registrado; senão cai em TRAFFIC com aviso**); TRAFFIC → `LINK_CLICKS`, sem `promoted_object`. Sem `publisher_platforms` = posicionamentos automáticos. **resultado-v1 (28/10):** com `settings.pixelEvent`, o `custom_event_type` é ele (SUBSCRIBE, SCHEDULE, COMPLETE_REGISTRATION…), senão PURCHASE/LEAD como acima.
5. `creating_creative`: `POST act_<id>/adcreatives` `{ name: adName, object_story_spec: { page_id, video_data: { video_id, image_url?: <thumbnail do render, JPEG, assinada 6 h>, message: primaryText, title: headline, link_description: description, call_to_action: { type, value: { link } } } } }`. **`MetaPublishInput.thumbnailUrl` é `string | null`** (ajuste pós-revisão 21/10): sem JPEG do render (`Creative.thumbnailFileId` nulo) o backend passa `null` e a integração **não envia `image_url`**, a Meta gera a capa a partir do vídeo. Nunca mandar a URL do MP4 nesse campo (a Meta recusa o creative).
6. `creating_ad`: `POST act_<id>/ads` `{ name: adName, adset_id, creative: { creative_id }, status: PAUSED }` → `publishedAt`, `status = PAUSED`, `adsManagerUrl`, opcional `previewUrl` (`GET /{adId}/previews?ad_format=MOBILE_FEED_STANDARD`).
7. Snapshot: insere/atualiza a linha do anúncio em `MetaAdSnapshot` (métricas zeradas) com `creative` ligado, pra aparecer na Home sem esperar o sync.

Mapa de erro da Meta → nosso (`meta/erros.ts`; `failReason` = `error_user_msg` quando vier, senão frase nossa; `failDetail` = `code/subcode/fbtrace_id`):
| Meta (`code` / situação) | `errorCode` | `action` |
|---|---|---|
| 190 (token), `is_valid=false` | `META_TOKEN_INVALID` (conexão vira `TOKEN_INVALID`) | `reconnect_meta` |
| 10, 200-299 (permissão), 100 com "does not have permission" | `META_PERMISSION` | `reconnect_meta` (o `detail` diz o escopo) |
| `account_status ≠ 1`, 1487xxx de conta desativada/em revisão | `META_ACCOUNT_UNUSABLE` | `choose_account` |
| conta `UNSETTLED`/sem `funding_source`, erro de pagamento | `META_PAYMENT_REQUIRED` | `fix_payment` |
| recusa de política no creative/ad (1815xxx, `error_user_title` com policy/ad review) | `META_POLICY` | `edit_ad_text` |
| orçamento abaixo do mínimo (1487xxx budget) | `META_BUDGET_TOO_LOW` `{ minimumMinor }` | `raise_budget` |
| vídeo com `error` no processamento, formato recusado | `META_VIDEO_REJECTED` | `render_again` |
| 4, 17, 32, 613 (limite), header `X-Business-Use-Case-Usage` ≥ 100 % | `META_RATE_LIMITED` (síncrono: 503 `META_UNAVAILABLE` `{ retryAfterSec }`) | `retry` |
| resto / 5xx / rede | `META_ERROR` | `retry`, 3ª falha `contact_support` |
Subcódigos exatos ficam no `meta/erros.ts` e são confirmados na sonda (§8); o contrato fixa só o **código nosso** e a **ação**.

### 3.4 Erros novos (somam à tabela do `api.md` §1)
**Síncronos (JSON, envelope padrão):**
| code | http | quando | `details` | frase (fallback EN; o web traduz pelo `code`) |
|---|---|---|---|---|
| `META_NOT_CONFIGURED` | 503 | `META_MODE=live` sem `META_APP_ID`/`SECRET`/`LOGIN_CONFIG_ID`/`TOKEN_KEY`; ou `META_MODE=off` | `{ reason: 'not_configured' \| 'off' }` | "Meta isn't set up on this server yet." |
| `META_NOT_CONNECTED` | 422 | workspace sem conexão ativa | — | "Connect a Meta account first." |
| `META_SELECTION_MISSING` | 422 | conectado sem conta/página escolhida | `{ missing: ('adAccount' \| 'page')[] }` | "Choose an ad account and a Page to continue." |
| `META_TOKEN_INVALID` | 422 | token expirou/revogado (conexão `TOKEN_INVALID`) | — | "Your Meta login expired. Reconnect to continue." |
| `META_PERMISSION` | 422 | `PUT /meta/selection` com conta `canManage = false`; ou a Meta devolveu `(#10)`/`(#200)` numa ação síncrona (`activate`, `pause`, `options`) | `{ adAccountId?, reason: 'no_advertise_task' \| 'account_disabled' \| 'missing_scope', scope? }` | "You don't have permission to advertise on this account. Ask the account admin to add you (Business Settings → Ad accounts → Add people)." |
| `META_PIXEL_REQUIRED` | 422 | objetivo SALES/LEADS/APP sem pixel escolhido | `{ objective }` | "This objective needs a pixel. Choose one, or switch to Traffic." |
| `META_ACCOUNT_UNUSABLE` | 422 | `account_status ≠ 1` na publicação/ativação | `{ accountStatus, label }` | "This ad account is <label>. Choose another account." |
| `META_BUDGET_TOO_LOW` | 422 | orçamento abaixo do mínimo da conta | `{ minimumMinor, currency }` | "Daily budget must be at least <min>." |
| `META_UNAVAILABLE` | 503 | Graph fora do ar, timeout, ou limite de uso (`code` 4/17/32/613, header de uso ≥ 100 %) | `{ reason: 'rate_limited' \| 'down', retryAfterSec }` | `rate_limited`: "Meta asked us to wait a minute. Try again at <hh:mm>." · `down`: "Meta didn't answer. Try again in a moment." |
`INVALID_STATE.details.reason` ganha `not_approved`, `publish_in_progress`, `sync_in_progress`. `PROVIDER_UNAVAILABLE.provider` **não** ganha META (a Meta tem os códigos próprios acima, porque a ação do usuário é diferente: reconectar, trocar conta, pagar). A spec do design chama o caso de limite de `META_RATE_LIMITED`: aqui ele é `META_UNAVAILABLE { reason: 'rate_limited' }` no síncrono (um código, uma tela de "espera") e `META_RATE_LIMITED` só como código **assíncrono** de job (D14).

**OAuth (volta pelo redirect do callback, `?meta=error&code=`; não é JSON):**
| `code` | quando | query extra | frase |
|---|---|---|---|
| `META_OAUTH_DENIED` | a pessoa fechou a janela, cancelou ou clicou "Not now" (`error=access_denied`, `error_reason=user_denied`) | — | "The Meta window was closed before it finished, or a popup blocker stopped it. Try again." |
| `META_SCOPES_MISSING` | login ok, mas a pessoa desmarcou permissão (debug_token sem um dos 4 escopos do §4). A conexão **não** é gravada | `&missing=ads_management,business_management` | "HookMill needs these permissions to work: <lista>. Try again and keep them checked." |
| `META_OAUTH_FAILED` | troca do `code` falhou (code usado/expirado, redirect_uri diferente da registrada, app secret errado, `debug_token` inválido) | — | "Meta login failed. Try again; if it keeps happening, contact support." (o motivo técnico vai pro log da API, nunca pra URL) |
| `META_STATE_INVALID` | `state` ausente, assinatura inválida, expirado (> 10 min) ou de outro usuário/workspace | — | "This login link expired. Start again from HookMill." |
| `META_UNAVAILABLE` | Graph fora/limite durante a troca | — | igual ao síncrono |
Mapa da spec do design → aqui: `OAUTH_CANCELLED` = `META_OAUTH_DENIED`; `OAUTH_FAILED` = `META_OAUTH_FAILED` (+ `META_STATE_INVALID`, `META_SCOPES_MISSING`, que o design não previa e têm frase própria); `META_NO_PERMISSION` por conta = `canManage`/`permissionReason` no `GET /meta/options` e `422 META_PERMISSION` se insistir; `META_RATE_LIMITED` = `META_UNAVAILABLE { reason: 'rate_limited' }`.

**Health (não é erro HTTP):** `POST /meta/health` responde 200 com `checks[].level` + `detail` (§3.1). Só vira erro quando a própria checagem não roda: `META_NOT_CONNECTED`, `META_TOKEN_INVALID`, `META_UNAVAILABLE`.

## 4. Escopos (Facebook Login for Business, configuração `META_CONFIG_ID`)
| escopo | pra quê | sem ele |
|---|---|---|
| `ads_management` | criar campanha/conjunto/criativo/anúncio, subir vídeo, mudar status | não publica |
| `ads_read` | `act_*/insights` e listagem de anúncios (a Meta pede `ads_read` explícito pra Insights mesmo com `ads_management`) | não lê vencedores |
| `business_management` | ad accounts, páginas e pixels que vivem num **Portfólio empresarial** (caso típico de agência: a conta do Tordan está no BM dele); sem isso `/me/adaccounts` só mostra contas pessoais | agência não vê as contas dos clientes |
| `pages_show_list` | `/me/accounts` pra escolher a página que assina o anúncio | não escolhe página |
Reserva (**só se** a 1ª sonda devolver `(#10)`/`(#200)` ao criar o `adcreative` com `page_id`): `pages_read_engagement`, `pages_manage_ads`. Entram na configuração do login sem mudar código (o health mostra o que foi concedido). Instagram: v1 não manda `instagram_actor_id` (a Meta usa a conta ligada à página).

## 5. Regra de vencedor (explicável, uma função pura `verdictOf(ads, rule)` em `meta/vencedor.ts`, testada)
- **Elegível:** anúncio de vídeo com `spend ≥ minSpend` (env `META_WINNER_MIN_SPEND_USD`, padrão **50**, convertido pra moeda da conta pela taxa fixa da env `META_USD_RATES` ou 1:1 se faltar) **e** `results ≥ 3` (env `META_WINNER_MIN_RESULTS`).
- **WINNER:** elegível com `cpa ≤ mediana do CPA dos elegíveis`. Com só 1 ou 2 elegíveis, todos os elegíveis são WINNER (não há mediana que separe).
- **OK:** elegível acima da mediana. **LOW_DATA:** o resto.
- **Sem resultado na conta inteira** (sem pixel: `resultType = link_click`): a mediana usa `cpa` de clique (custo por clique) e a tela diz "vencedor por custo por clique (sem pixel)".
- Desempate na lista: `hookRate` desc, depois `spend` desc. A regra fica no `MetaSummary.rule` pra tela explicar ("gasto ≥ US$ 50, ≥ 3 compras, CPA abaixo da mediana de US$ 26,13").
- Pode haver **mais de um** WINNER (todos acima da régua). O tour e o "vencedor da Home" pegam o **1º** da ordem padrão (`GET /meta/ads?verdict=WINNER&limit=1`). A spec do design pedia `winner: true` em no máximo 1 item: registrado em D15.
Por que não score/ML: o Tordan quer ver "esse aqui tá com boas métricas"; mediana da própria conta é defensável, muda com a conta e não precisa de calibração. Score fica pro Eddy.

### 5.2 Tendência (`trend`, função pura `trendOf(m7d, mPrev7d, rule)` no mesmo `meta/vencedor.ts`)
Compara os últimos 7 d com os 7 d anteriores do mesmo anúncio. Só o custo por resultado (ou por clique, sem pixel) e a frequência; nada de modelo.
- **Dado insuficiente → `null`** ("—" na tela): `spend7d < minSpend / 4` (US$ 12,50 no padrão) **ou** `results7d < 3` **ou** `resultsPrev7d < 3` (anúncio novo ainda não tem semana anterior; `daysRunning < 8` cai aqui).
- **`WORKING`:** `cpa7d ≤ 0,85 × cpaPrev7d` (melhorou ≥ 15 %).
- **`TIRING`:** `cpa7d ≥ 1,25 × cpaPrev7d` (piorou ≥ 25 %) **ou** (`frequency7d ≥ 3` **e** `ctr7d ≤ 0,8 × ctrPrev7d`): o público já viu e parou de clicar.
- **`STEADY`:** o resto.
Limites em env (`META_TREND_BETTER=0.85`, `META_TREND_WORSE=1.25`, `META_TREND_FREQ=3`). `tiringCount` do sumário = anúncios ativos com `TIRING`. A frase da tela sai do `trend` + os dois CPAs ("CPA went from $22 to $29 this week").

### 5.3 Estado do sync (`MetaSummary.sync`, derivado)
`never` = sem conta escolhida · `first_sync` = nunca terminou um sync e há job rodando · `syncing` = já tem snapshot e há job rodando · `failed` = último job falhou e não há snapshot mais novo (`lastSyncError`) · `stale` = `syncedAt` há mais de 12 h (o cron é de 6 h: passou de 12 h, algo falhou) · `ok` = o resto. `progress = { done, total, unit: 'ads' }` vem do job (`listing_ads` dá o `total`; `reading_insights` avança por página de 100). A spec do design falava em "4 of 6 ad sets": a unidade aqui é **anúncios**, que é o que o sync lê; o texto da tela usa `unit`.

## 6. Eventos (adendo ao `eventos.md`)
**Nenhum SSE novo e nenhum webhook da Meta na v1.** Porquê, em uma linha: publicar leva 20-90 s e é uma tela só (polling de `GET /creatives/:id/meta` a cada 2 s enquanto `PUBLISHING`), e os números de performance mudam devagar (sync a cada 6 h + botão "Sync now"); webhook de anúncio da Meta exigiria assinatura de app, verificação e dá pouco em troca agora.
| quem | rota | intervalo | para quando |
|---|---|---|---|
| Send → Publish | `GET /creatives/:id/meta` | 2 s | `publication.status ≠ PUBLISHING` |
| Iterate (Pick from Meta) | `GET /champions/:id` (já existe) | 2 s | `status ∈ READY, FAILED` |
| Settings/onboarding "Sync now" | `GET /jobs/:id` | 1,5 s | job terminou |
| Connect Meta → "Connect from another browser" (22/10) | `GET /meta/oauth/status` | 3 s | `pending = false` (sucesso → `GET /meta/connection`; `lastError` → alerta) ou `expiresAt` passou |
| Home / Campaigns v0 | `GET /meta/summary`, `GET /meta/ads` | ao abrir e no foco da janela (React Query) | — |
Cron (`@nestjs/schedule`, já no app): `META_SYNC` a cada 6 h por conexão `ACTIVE` com conta escolhida (escalonado 30 s entre workspaces); health 1×/dia. Sem webhook, mudança de status feita no Ads Manager aparece no próximo sync (`effectiveStatus`; anúncio sumido → publicação `DELETED`).

## 7. Segurança
- Token cifrado com **AES-256-GCM** (`common/util/cifra.ts`: `cifrar(texto, META_TOKEN_KEY)` → `base64(iv ‖ tag ‖ ciphertext)`), chave de 32 bytes em env; perder a chave = todo mundo reconecta (sem drama). Nunca em log, nunca em resposta, nunca no `Job.input`/`output`.
- `state` do OAuth assinado (HMAC-SHA256, `exp` 10 min, `purpose`, `wid`/`sub` conferidos) e com `nonce` aleatório de 12 bytes; `returnTo` só da lista fechada. `GET /meta/callback` é a única rota pública do módulo e não lê cookie.
  **Pendência registrada (fora da v1): anti-replay do `nonce`.** O `nonce` vai assinado no `state` e `verifyState` devolve ele, mas validar na volta exige persistir o que foi emitido (o contrato não quer `state` no banco nem cookie no callback). Hoje a proteção é assinatura + `exp` + `purpose` + `wid`/`sub`: um `state` interceptado dentro dos 10 min só serve pra ligar a Meta ao mesmo workspace/usuário que o pediu, e o `code` da Meta é de uso único. Se um dia for necessário, a opção barata é o backend gravar `nonce` + `exp` numa tabela pequena (ou cache em memória com TTL, processo único) ao emitir e marcar como usado no callback; a integração não muda (detalhe em `api/src/integracoes/meta/PORTA.md`, "Ajustes pós-revisão").
- App secret só na troca de `code` e em `appsecret_proof` (`HMAC-SHA256(token, app_secret)`) em **toda** chamada à Graph (a Meta recomenda e dá pra exigir no app).
- Escrita na Meta só por `META_PUBLISH`, `activate`, `pause`, `DELETE /me/permissions`. Nada automático: o HookMill nunca ativa, nunca muda orçamento, nunca toca em anúncio que não criou.
- CLIENT (fase2 §4): só `GET`. Rotas liberadas pro CLIENT precisam de `@ClientAllowed()`; nenhuma rota de escrita da Meta leva.

## 8. Modo mock (`META_MODE=mock`, padrão; mesmo padrão de `AD_LIBRARY_MODE`)
- `POST /meta/connect` devolve `url = <api>/api/v1/meta/callback?code=mock&state=<jwt>`: o navegador faz a volta de verdade, o callback grava uma conexão fake (`metaUserId mock_user`, scopes completos, `tokenExpiresAt` em 60 dias, token cifrado `mock`).
- `GET /meta/options`: 3 contas (`act_mock_1` USD ativa, `act_mock_2` BRL `account_status 2`, `act_mock_3` USD ativa com `canManage=false`), 1 página, 1 pixel (`pix_mock`, `lastFiredAt` ontem). Health da conta 2 = `account` **bad**; da conta 1 = tudo ok menos `verified` **warn**.
- `META_SYNC` em 2-5 s: 8 anúncios de vídeo determinísticos (nome, gasto, resultados, hook rate, as 3 janelas), **2 WINNER**, 1 `TIRING`, 1 `WORKING`, 2 com `trend null` (novos), 1 com `effective_status DISAPPROVED`; `thumbnailUrl` e vídeo apontam pro `mock-media` da API (o import funciona sem rede). `sync.progress` avança em 4 passos pra tela mostrar.
- `META_PUBLISH` em 2-5 s por etapa, ids `mock_…`, `adsManagerUrl` apontando pra `#`.
- Gatilhos (texto nos campos, fora do mock são texto comum):
| onde | gatilho | resultado |
|---|---|---|
| `primaryText` | `[mock:meta-policy]` | job falha em `creating_creative` com `META_POLICY`, `action: edit_ad_text` |
| `primaryText` | `[mock:meta-payment]` / `[mock:meta-token]` / `[mock:meta-rate]` / `[mock:meta-error]` | falha com o código correspondente na etapa `creating_campaign` |
| `dailyBudgetMinor < 500` | — | `422 META_BUDGET_TOO_LOW` (mínimo mock US$ 5,00) |
| `POST /iterate { metaAdId: 'mock_ad_novideo' }` | — | import falha `META_VIDEO_UNAVAILABLE`, `action: upload_video` (lote `ANALYSIS_FAILED`) |
| `POST /meta/connect { returnTo }` + no mock o callback aceita `?code=mock-denied` / `mock-scopes` / `mock-failed` | o web manda o `code` direto no callback (sem passar pela Meta) | redirect com `META_OAUTH_DENIED` / `META_SCOPES_MISSING&missing=ads_management` / `META_OAUTH_FAILED` |
| `PUT /meta/selection { adAccountId: 'act_mock_3' }` | conta mock `canManage=false` | `422 META_PERMISSION` |
| `headline` | `[mock:meta-slow]` | `processing_video` leva 30 s (barra de progresso) |
Live sem chave: `NOT_CONFIGURED` em toda rota (nunca cai no mock em silêncio), igual às outras integrações.

## 9. O que NÃO entra (v1)
> **22/10:** a tela Campaigns saiu desta lista: contrato próprio em [`campanhas-v1.md`](campanhas-v1.md) (aprovado 22/10: árvore campanha → conjunto → anúncio, pausar/ativar nos 3 níveis, orçamento diário, `MetaChange`). Continuam fora daqui o gráfico diário e o resto da lista abaixo (ver campanhas-v1 §7). A regra "o HookMill nunca muda orçamento, nunca toca em anúncio que não criou" do §7 vale até a B4; depois, só por ação explícita de OWNER/ADMIN na Campaigns, com as guardas do campanhas-v1 §4.1.

Eddy, ~~Campaigns completo (gráfico/árvore)~~ → campanhas-v1, regras de orçamento/teto diário/CPA alvo, otimização ou pausa automática, A/B nativo, Advantage+ Shopping/catálogo, Instagram actor explícito, lead forms nativos (LEADS = site + pixel), múltiplos ad sets/países por publicação, edição do anúncio depois de publicado (muda no Ads Manager), webhooks da Meta, histórico diário de métricas (só a janela de 30 d), moeda/taxa real (env fixa), App Review/Business Verification (só pra abrir a terceiros), importar anúncio que não é vídeo.

## 10. Decisões abertas (numeradas; recomendação em negrito)
- **D1 Nasce pausado ou ativo?** **PAUSED em campanha, conjunto e anúncio; o usuário ativa pelo HookMill (`activate`, OWNER/ADMIN) ou no Ads Manager.** Alternativa: nascer ACTIVE com confirmação. Pausado protege contra gasto por engano no 1º teste e deixa o Tordan conferir no Ads Manager antes.
- **D2 Onde fica o token: colunas no `Workspace` ou tabela `MetaConnection`?** **Tabela `MetaConnection` (1:1).** O `Workspace` já tem 14 colunas e vai ganhar mais no onboarding; a conexão tem ciclo próprio (reconectar, desconectar, trocar conta, health) e o `GET /workspace` que o web chama toda hora não deve nem enxergar o campo cifrado.
- **D3 Versão da Graph API:** **env `META_GRAPH_VERSION`, padrão a versão mais nova listada no painel no dia em que o Gusta criar o app (pelo meu conhecimento, v25.0; confirmar no changelog).** Fixar em env evita deploy quando a Meta aposenta uma versão (ciclo de ~2 anos).
- **D4 Tipo de token:** **long-lived de usuário (60 dias) na v1**, `tokenExpiresAt` visível na conexão e no health (aviso a partir de 7 dias; `TOKEN_INVALID` = reconectar em 1 clique). Alternativa: token de system user da integração (não expira), que exige configuração extra no login e Business Verification; a coluna `tokenType` já reserva o caminho sem migração.
- **D5 Conta em contingência/desativada (`account_status ≠ 1`):** **mostrar o status no health, bloquear publicar e ativar (`META_ACCOUNT_UNUSABLE`), não bloquear leitura, e deixar o usuário trocar de conta.** O HookMill só lê a conta escolhida (nunca varre todas), e nunca escreve sem ação explícita: não cria sinal novo pra uma conta já marcada.
- **D6 Regra de vencedor:** **§5 (gasto ≥ US$ 50, ≥ 3 resultados, CPA ≤ mediana), limites em env.** Alternativa: deixar o usuário definir o mínimo em Settings (fica pra quando a Home for desenhada).
- **D7 Ids da Meta no `Creative` ou tabela própria:** **tabela `MetaPublication`** (histórico, retry idempotente por etapa, várias contas). O `Creative` só expõe `GET /creatives/:id/meta`.
- **D8 Sem pixel escolhido e objetivo SALES/LEADS:** **recusar com `META_PIXEL_REQUIRED` e sugerir `OUTCOME_TRAFFIC` no mesmo erro (o web troca o objetivo com 1 clique e avisa que otimiza por clique).** Alternativa: trocar sozinho pra TRAFFIC. Recusar deixa claro pro Tordan por que o anúncio não vai otimizar pra compra.
- **D9 Público:** **amplo (país do `market`, 18-65, `advantage_audience: 1`, posicionamentos automáticos), país confirmado pelo usuário no formulário** (o `market` é texto livre; o mapa texto → ISO é pequeno e falível). Interesses, lookalike e exclusões ficam fora.
- **D10 Nome na Meta:** **campanha, conjunto e anúncio = `adName`** (fase2 D6, "o que vai casar com o resultado na Meta"). Republicar o mesmo criativo na mesma conta = `adName_2` na Meta (só lá; o `Creative.adName` não muda).
- **D11 Quem ativa:** **OWNER/ADMIN** (ativar é o momento que gasta dinheiro do cliente). Publicar pausado: OWNER/ADMIN/MEMBER. CLIENT: só vê.
- **D12 Pick from Meta cria campeão com `rights = OWN` sem perguntar** (é anúncio da própria conta). Alternativa: manter a pergunta do Importar.
- **D13 Um caminho só pro "Pick from Meta": `POST /iterate { metaAdId }`.** A spec do design (§8 "Pick a winner") pedia `POST /champions { metaAdId }`; a tela "Iterate a winner" de hoje já usa `POST /iterate` (variacao-auto-v1; as telas Pick a winner/Breakdown saíram da navegação em 13/10), então o anúncio da Meta entra como 3ª origem ao lado de `uploadId`/`creativeId`. `POST /meta/ads/:id/import` (minha 1ª versão) e `POST /champions { metaAdId }` ficam **fora**. O job `META_IMPORT` continua existindo por dentro (é a etapa que baixa o vídeo e cria o campeão).
- **D14 Limite de uso da Meta no síncrono = `503 META_UNAVAILABLE { reason: 'rate_limited', retryAfterSec }`**, não um código `META_RATE_LIMITED` próprio (pedido do design). Motivo: pro usuário a ação é a mesma de "Meta fora do ar" (esperar), e o `retryAfterSec` já diz quanto; `META_RATE_LIMITED` fica só como código assíncrono de job, onde a ação é `retry`. Divergência registrada; se o Gusta preferir o nome do design, é só renomear no mapa.
- **D15 Vários WINNER, não "no máximo 1".** A regra do §5 pode marcar 2-3 anúncios acima da régua; esconder os outros tiraria informação do Pick from Meta. O tour e a Home pegam o 1º da ordem (`limit=1`). O design pedia `winner: true` em 1 item: a tela consegue o mesmo efeito com `verdict=WINNER&limit=1`.
- **D16 `GET /meta/summary?period=7d|30d` com `prev`, em vez de `GET /meta/insights`** (nome da spec). Mesma coisa, nome alinhado ao resto do módulo; `cpaTarget` fica fora (metas além do teto estão no fase2 §8).
- **D17 (revisão 21/10; aprovada pelo Gusta 21/10) KPI Spend sem teto de mídia: a variação contra o período anterior (`prev`) é suficiente na v1.** O único teto que existe é o de gasto de IA (`monthlySpendCapUsd`), que não é orçamento de mídia; inventar um "alvo" de gasto agora seria número sem dono. A Home mostra gasto do período + seta vs anterior; teto/alvo de mídia e CPA alvo entram com Goals (fase2 §8). Alternativa: pedir o budget mensal de mídia no passo 5 do onboarding (campo novo) só pra desenhar a barra.
- **D15 (reafirmada na revisão 21/10; aprovada pelo Gusta 21/10) Lima só no 1º WINNER da Home e do tour; na lista do Pick from Meta todos os WINNER levam o chip.** A Home tem um cartão "vencedor" (o 1º da ordem padrão); a lista é comparação e precisa mostrar todos os que passaram da régua. Se o Gusta preferir "só 1 em lima em todo lugar", é só o web não pintar os demais; a API não muda.

## 11. Pré-requisitos que só o Gusta faz (antes de qualquer teste live; em mock nada disto é necessário)
- [ ] **App no Meta for Developers** (developers.facebook.com → Create app → caso de uso "Outro" → tipo **Business**), ligado ao Business Portfolio do Gusta. Anotar **App ID** e **App Secret** (`META_APP_ID`, `META_APP_SECRET`).
- [ ] **Produto "Facebook Login for Business"** no app → Configurations → **Create configuration**: tipo de token *User access token*, permissões `ads_management`, `ads_read`, `business_management`, `pages_show_list` (e as 2 de reserva do §4 se a sonda pedir). Anotar o **Configuration ID** (`META_CONFIG_ID`).
- [ ] **Settings → Valid OAuth Redirect URIs:** `https://<PUBLIC_API_URL>/api/v1/meta/callback` (produção) e a URL do túnel de dev (`https://<tunel>/api/v1/meta/callback`). Localhost sem HTTPS não é aceito pelo Login for Business: dev live precisa de túnel (o mesmo do webhook da WaveSpeed).
- [ ] **Marketing API** adicionado como produto (dá acesso de desenvolvimento, nível *Standard*; basta pra contas em que os testers têm papel).
- [ ] **App em modo Desenvolvimento** com Gusta e **Tordan como Testers** (App roles → Testers; o Tordan aceita o convite em developers.facebook.com/settings → Requests). Em dev, só pessoas com papel no app conseguem logar; isso cobre o teste do Tordan sem App Review.
- [ ] **Tordan com papel na ad account e na página** que vai usar (Business Settings do BM dele), e a conta com **forma de pagamento** válida (`funding`).
- [ ] **Chave do cofre:** `META_TOKEN_KEY=$(openssl rand -base64 32)` no `.env` da API (dev e EasyPanel; chaves diferentes por ambiente).
- [ ] **Só pra abrir a terceiros (depois):** Business Verification + App Review de `ads_management`/`ads_read`/`business_management`/`pages_show_list` (vídeo de uso, política de privacidade e URL de exclusão de dados publicadas no site da HookMill). Sem isso, o modo dev atende Gusta + Tordan + até os testers que forem adicionados.
- [ ] **Sonda de centavos (ia, com ok):** 1 login real, `options`, `health`, 1 sync, 1 publicação PAUSED numa conta de teste (custo US$ 0: pausado não gasta) e **apagar** a campanha criada. Confirma versão da Graph, escopos de reserva e os subcódigos do mapa do §3.3. **Campos de insights: já confirmados em 22/10** (sonda de leitura na conta real: `video_continuous_2_sec_watched_actions` ok, `video_3_sec_watched_actions` inexistente, `minimum_budgets` em `{ data }`).

Env novas (`api/.env.example`, bloco "Meta (meta-v1.md)"):
```
META_MODE=mock                 # mock | live | off (off = toda rota da Meta, /meta/* E /creatives/:id/meta/*, responde 503 META_NOT_CONFIGURED reason off; o web esconde o passo 2, o Pick from Meta e o Publish)
META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=          # Facebook Login for Business → Configurations
META_GRAPH_VERSION=v25.0       # confirmar no painel no dia (D3)
META_TOKEN_KEY=                # openssl rand -base64 32 (AES-256-GCM do token; trocar = todo mundo reconecta)
META_WINNER_MIN_SPEND_USD=50
META_WINNER_MIN_RESULTS=3
META_TREND_BETTER=0.85         # §5.2: cpa7d ≤ 0,85 × anterior = WORKING
META_TREND_WORSE=1.25          # cpa7d ≥ 1,25 × anterior = TIRING
META_TREND_FREQ=3              # frequência 7 d ≥ 3 com CTR caindo 20 % = TIRING
META_USD_RATES=BRL=5.5,EUR=0.92   # opcional; moeda da conta → USD pra regra do vencedor (sem = 1:1)
META_SYNC_EVERY_HOURS=6
```

## 12. Tarefas por agente (dependências e verificação)
| # | agente | tarefa | depende de | verificação |
|---|---|---|---|---|
| A1 | arquiteto | ok do Gusta → exportar `meta.ts` no `index.ts` (+ os campos aditivos listados no §2: `Action`, `ServiceStatus`, `CreateIterateBody`, `ChampionRow.sources`, `ChampionDetail.metaAd`, `JobType`, `AsyncErrorCode`); schema + migração `meta_v1` (backup, `db:diff`); `api.md` §1/§5/§14/§15/§16/§19, `modelo-de-dados.md`, `eventos.md` §2, `estrutura.md` §3 e `deploy.md` §5 (envs); `.env.example` | ok do Gusta | `prisma validate`, `tsc` do pacote |
| I1 | ia (`api/src/integracoes/meta/`) | cliente Graph (`cliente.ts`: versão por env, `appsecret_proof`, paginação, leitura do `X-Business-Use-Case-Usage`, backoff), OAuth (`oauth.ts`: troca de code, long-lived, debug_token, escopos faltando), `erros.ts` (mapa do §3.3 + OAuth do §3.4), leitura (`leitura.ts`: ads + as 3 janelas de insights → `MetaMetrics`, `user_tasks`, `last_fired_time`, `verification_status`), publicação (`publicacao.ts`: as 6 chamadas do §3.3, upload resumable), `vencedor.ts` (§5: `verdictOf` + `trendOf`), **mock completo** (§8, inclusive 1 conta `canManage=false`, 1 anúncio `TIRING`, 1 `WORKING`) e `sonda-meta.ts` (§11 último item). Interface `MetaService` exposta por token `META_SERVICE` no padrão de `AD_LIBRARY_SERVICE` | A1 | Jest com `fetch` falso: oauth (denied, scopes faltando, code inválido), debug_token inválido → `TOKEN_INVALID`, paginação, mapa de erros (1 teste por linha das tabelas), `verdictOf` com 6 casos (0/1/2/N elegíveis, sem pixel, empate), `trendOf` com 5 casos (null por pouco dado/anúncio novo, working, tiring por CPA, tiring por frequência, steady), upload resumable, mock determinístico; `tsc` ok; sonda só com ok do Gusta |
| B1 | backend (`api/src/meta/`) | módulo `meta`: `cifra.ts` (AES-GCM), `MetaConnectionService` (connect/callback com os 5 códigos de redirect/options com `canManage`/selection com `META_PERMISSION`/health com níveis/disconnect), `MetaSyncService` + cron + `META_SYNC` job (progress por página; `sync` derivado do §5.3), `MetaImportService` (`META_IMPORT` → `Champion` com `metaAdId`, `sources: ['META']`, reaproveita campeão repetido; `POST /iterate { metaAdId }` no `iteracao`), `MetaPublishService` (`META_PUBLISH` com retomada por etapa, `activate`/`pause`), `GET /meta/summary?period` com `prev`, controllers, DTOs `implements` dos tipos, erros novos em `error-codes.ts`, `ServiceStatus` `META`, `GET /creatives/:id/meta` com os defaults do §2 | A1, I1 (ou mock da I1) | Jest + int (mock): callback grava token cifrado e nunca devolve; cada código de redirect do §3.4 sai na query certa; `state` de outro usuário = `META_STATE_INVALID`; conta `canManage=false` = 422 `META_PERMISSION`; health com conta `status 2` = `bad` e bloqueia publish (`META_ACCOUNT_UNUSABLE`); pixel sem disparo = `warn` e `canPublish` continua true; sync substitui snapshots, dá 2 WINNER e os `trend` do mock, `sync.state` passa por `first_sync → ok` e vira `stale` com relógio avançado 13 h; `POST /iterate { metaAdId }` cria campeão `OWN` e reaproveita se repetir; `metaAdId` fora do snapshot = 404; publish retry **não duplica** campanha (ids já gravados); CLIENT 403 em tudo que escreve; `activate` só OWNER/ADMIN; api `tsc` ok |
| F1 | frontend | passo 2 do onboarding real (ver `onboarding-v2.md` §4: botão Connect → `url` → volta com `?meta=connected` → picker de conta/página/pixel → health → Continue ou Skip), Settings → bloco Meta (status, saúde, reconectar, desconectar, Sync now), Iterate a winner "Pick from Meta" (lista `GET /meta/ads` com chips WINNER/OK/LOW_DATA e a regra explicada; import → fluxo de hoje), Send → "Publish to Meta" (form com defaults, orçamento na moeda da conta, países, objetivo com o aviso de pixel, progresso por etapa, erro com ação, link do Ads Manager, botão Activate com confirmação), MSW nos tipos novos | A1 (tipos); B1 ou MSW | web `tsc`; MSW cobre os 5 erros assíncronos; desktop e 390 px, EN/PT |
| V1 | video | nada obrigatório. Opcional: thumbnail do render em JPEG (o `image_url` do creative) já existe (`Creative.thumbnailFileId`); confirmar que é extraída do render final | — | — |
| Q1 | qa | ponta a ponta em mock: conectar (volta do callback) → escolher conta → health → sync → Pick from Meta com WINNER → lote → aprovar criativo → publish pausado → activate → pause; os 5 gatilhos do §8 com a ação certa; retry sem duplicar; desconectar apaga token e snapshots e mantém publicações; `META_MODE=off` esconde tudo; CLIENT; desktop e 390 px, EN/PT. **Live** (com o §11 feito): a sonda da ia + 1 publicação pausada real do Tordan, apagada depois | B1, F1, I1 | só o qa declara "funciona" |

**Pendência da rodada (QA 21/10):** F1 entregou passo 2, Settings › Connections, Pick from Meta e Home, mas **não** a tela Send → "Publish to Meta" (§3.3); está sendo feita agora, seguindo a sequência do §3.3.1. Q1 só declara "funciona" com ela coberta (publish pausado → activate → pause → retry nos 5 gatilhos do §8).

Pastas sem conflito: A1 = `docs/`, `contratos/src/`, `api/prisma/`; I1 = `api/src/integracoes/meta/`; B1 = `api/src/meta/`, `api/src/common/util/cifra.ts`, `error-codes.ts`, 1 linha no `iteracao` (aceitar `metaAdId`) e 1 no `campeoes` (`sources`/`metaAd`); F1 = `web/`; Q1 = `testes/`. I1 e B1 em paralelo (B1 roda no mock da I1 desde o 1º dia; o contrato entre eles é a interface `MetaService` em `integracoes/contrato.ts`, escrita pelo arquiteto no A1).
