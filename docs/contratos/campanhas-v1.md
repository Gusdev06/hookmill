# Campaigns v1 · ver e operar as campanhas da conta conectada
Data: 2026-10-22 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 22/10** (D1-D12 do §9 como recomendadas; `decisions/log.md`). **A4 feito 22/10:** tipos em `@maquina/contratos` (`contratos/src/campanhas.ts` + aditivos opcionais em `meta.ts`/`index.ts`), schema e migração `20261023000100_campanhas_v1` aplicados no `maquina` e no `maquina_test`, porta `MetaService` estendida em `api/src/integracoes/contrato.ts` (métodos novos opcionais até a I4), 5 códigos novos em `error-codes.ts`. Código liberado: I4 ‖ B4 ‖ D4 → F4 → Q4 (§8). **Ajustes do design 22/10 no §10** (4 campos, sem migração; B4b). **§11 (23/10, QA):** `meta.totals` no `GET /meta/ads` + `totals.count` e `MetaChangeResult BLOCKED` (migração `20261023000200_meta_change_blocked`, aplicada no `maquina` e no `maquina_test`).
Base: pedido do Gusta 22/10 ("a parte de campanhas está em breve, acho que podemos construir já", testando ao vivo com a conta real conectada: 100 anúncios, 7 vencedores, 6 ativos), [`meta-v1.md`](meta-v1.md) (conexão, `MetaAdSnapshot`, sync, regra de vencedor §5, tendência §5.2, publicação, `activate`/`pause`, erros §3.3-3.4, mock §8; **este doc reabre o item "Campaigns completo" do §9 de lá**), [`onboarding-v2.md`](onboarding-v2.md) (Home de performance), `feedback/tordan-loom-2026-10-20.md`, convenções de [`api.md` §1](api.md). Hoje a rota `/campaigns` do web é o `SoonPage` (`web/src/components/soon-pages.tsx`, preview estático) e a sidebar marca `soon: true`.

## 0. Resumo em 5 linhas
1. **Tela Campaigns real:** tabela campanha → conjunto → anúncio (linha expansível) + modo "só anúncios" (lista plana), com status, orçamento, gasto/resultados/CPA/CTR/hook rate em **30 d ou 7 d (com delta contra os 7 d anteriores)**, veredito/tendência por anúncio, selo **HookMill** e link pro Ads Manager em cada nível.
2. **Dados por snapshot, não ao vivo:** o `META_SYNC` passa a gravar também `MetaCampaignSnapshot` e `MetaAdsetSnapshot` (estrutura + orçamento + insights por nível nas mesmas 3 janelas) e a guardar **todos** os anúncios (inclusive imagem). Ao vivo só no instante de escrever (guarda de "mudou desde o sync").
3. **Ações v1 (OWNER/ADMIN, confirmação, tudo auditado):** pausar/ativar campanha, conjunto e anúncio; mudar o **orçamento diário** onde ele mora (campanha em CBO, conjunto em ABO); "Iterate this ad" (já existe, `POST /iterate { metaAdId }`). Fora: duplicar, editar público/criativo/texto/lance, criar campanha aqui, apagar, ação em lote.
4. **Segurança de dinheiro:** nada ativa sem confirmação explícita, ativar não sobe pais pausados sem pedir, aumento de orçamento limitado a **2× por ação**, guarda de concorrência (`expected*`), conta inutilizável bloqueia escrita, tabela `MetaChange` com quem/quando/de→para/resultado.
5. Estimativa: **~5 dias úteis** com paralelo (A4 ½ d → I4 ‖ B4 ‖ D4 ~2 d → F4 2 d → Q4 1 d), §8.

## 1. O que a tela mostra (e de onde vem)
| informação | nível | já existe no snapshot? | falta ler da Graph |
|---|---|---|---|
| nome, `effectiveStatus`, ids de campanha/conjunto | anúncio | sim (`MetaAdSnapshot`) | `status` configurado do anúncio (o liga/desliga; `effective_status` explica por que não entrega) |
| métricas 30 d / 7 d / 7 d anteriores (gasto, resultados, CPA, ROAS, CTR, hook rate, thruplays, frequência 7 d) | anúncio | sim (`metrics`, `metrics7d`, `metricsPrev7d`) | — |
| veredito WINNER/OK/LOW_DATA e tendência | anúncio | sim | — |
| origem HookMill (criativo de origem) | anúncio | sim (via `MetaPublication.metaAdId`; `MetaAdRow.creative`) | — |
| anúncios que **não são vídeo** | anúncio | **não** (o sync filtra vídeo, `leitura.ts` `isVideoAd`) | nada novo: só parar de descartar (D2) |
| objetivo, status, `effective_status`, compra (`buying_type`), estratégia de lance, `daily_budget`/`lifetime_budget`/`budget_remaining`, CBO ou não, datas | campanha | **não** | `act_<id>/campaigns?fields=id,name,objective,status,effective_status,buying_type,bid_strategy,daily_budget,lifetime_budget,budget_remaining,special_ad_categories,start_time,stop_time,created_time` |
| status, meta de otimização, evento de cobrança, lance, orçamento diário/vitalício, fase de aprendizado (`learning_stage_info.status`), datas | conjunto | **não** | `act_<id>/adsets?fields=id,name,campaign_id,status,effective_status,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,budget_remaining,learning_stage_info,start_time,end_time,created_time` |
| métricas por campanha e por conjunto (inclusive alcance e frequência, que não somam) | campanha, conjunto | **não** | `act_<id>/insights?level=campaign` e `level=adset`, mesmos campos do `level=ad` + `reach,frequency`, nas **mesmas 3 janelas** (6 leituras a mais por sync) |
| mínimo de orçamento da conta | conta | sim (`minimum_budgets`, lido no health) | — |

Escopo da leitura: campanhas/conjuntos/anúncios com `effective_status` fora de `ARCHIVED`/`DELETED`, teto **500 por nível** (o mesmo `MAX_ADS` de hoje); passou disso, os mais recentes entram e a resposta traz `truncated: true` (a tela avisa "showing the 500 most recent; open Ads Manager for the rest").

**Períodos:** `30d` e `7d`, os que o sync já tem. Delta (seta) só existe em `7d` (contra os 7 d anteriores); em `30d` não há janela anterior guardada, então sem seta. Intervalo de datas livre fica fora (exigiria leitura ao vivo).
**Filtros:** status (`active` = `effective_status ACTIVE`; `paused` = `PAUSED`/`CAMPAIGN_PAUSED`/`ADSET_PAUSED`; `issues` = `DISAPPROVED`/`WITH_ISSUES`/`PENDING_REVIEW`/`IN_PROCESS`; `all`), período, origem (`all` | `hookmill`), formato no modo anúncios (`all` | `video`). **Busca** `q`: nome de campanha, conjunto ou anúncio (o pai aparece quando um filho bate). **Ordenação:** `spend` (padrão, desc), `cpa`, `results`, `ctr`, `hookRate`, `budget`, `name`.
**Totais** do conjunto filtrado no período (gasto, resultados, CPA, CTR) no topo da tabela; os KPIs da conta continuam sendo os da Home (`GET /meta/summary`).

## 2. Modelo de dados (diff em texto; migração `20261023000100_campanhas_v1` (aplicada 22/10), aditiva, pelo arquiteto com `npm run db:backup` + `npm run db:diff`)
```prisma
enum MetaObjectLevel { CAMPAIGN  ADSET  AD }
enum MetaChangeField { STATUS  DAILY_BUDGET }
enum MetaChangeResult { APPLIED  FAILED  BLOCKED }   // BLOCKED: §11 (23/10)
enum MetaChangeSource { CAMPAIGNS  PUBLISH }   // tela Campaigns · activate/pause da tela Send (meta-v1 §3.3)

// Substituídas inteiras a cada META_SYNC, na MESMA transação do MetaAdSnapshot (as três tabelas sempre do mesmo instante).
model MetaCampaignSnapshot {
  id                   String   @id @default(cuid())
  workspaceId          String   @map("workspace_id")
  connectionId         String   @map("connection_id")
  adAccountId          String   @map("ad_account_id")
  campaignId           String   @map("campaign_id")
  name                 String
  objective            String                                  // texto da Graph (OUTCOME_*, ou legado)
  status               String                                  // configurado: ACTIVE | PAUSED
  effectiveStatus      String   @map("effective_status")
  buyingType           String?  @map("buying_type")
  bidStrategy          String?  @map("bid_strategy")
  dailyBudgetMinor     Int?     @map("daily_budget_minor")     // não nulo = CBO com orçamento diário
  lifetimeBudgetMinor  Int?     @map("lifetime_budget_minor")  // não nulo = CBO vitalício (só leitura na v1)
  budgetRemainingMinor Int?     @map("budget_remaining_minor")
  startTime            DateTime? @map("start_time")
  stopTime             DateTime? @map("stop_time")
  createdTime          DateTime? @map("created_time")
  metrics              Json                                    // MetaMetrics 30 d (com reach/frequency)
  metrics7d            Json     @map("metrics_7d")
  metricsPrev7d        Json     @map("metrics_prev_7d")
  syncedAt             DateTime @map("synced_at")
  workspace  Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connection MetaConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  @@unique([connectionId, campaignId])
  @@index([workspaceId, effectiveStatus])
  @@map("meta_campaign_snapshots")
}

model MetaAdsetSnapshot {
  // mesmos campos de identidade/orçamento/métricas da campanha, mais:
  campaignId          String   @map("campaign_id")
  adsetId             String   @map("adset_id")
  optimizationGoal    String?  @map("optimization_goal")
  billingEvent        String?  @map("billing_event")
  learningStage       String?  @map("learning_stage")          // LEARNING | SUCCESS | FAIL (learning limited) | null
  endTime             DateTime? @map("end_time")
  // (aplicado: o conjunto também tem bidStrategy e createdTime; sem specialAdCategories/objective/buyingType/stopTime)
  @@unique([connectionId, adsetId])
  @@index([connectionId, campaignId])
  @@map("meta_adset_snapshots")
}

model MetaAdSnapshot {
  // ... existentes
  status String @default("ACTIVE")   // NOVO: status configurado do anúncio (o toggle). videoId null = não é vídeo e agora É guardado (D2)
}

// Toda escrita na Meta feita pelo HookMill, inclusive a que falhou. Append-only.
model MetaChange {
  id           String           @id @default(cuid())
  workspaceId  String           @map("workspace_id")
  connectionId String           @map("connection_id")
  adAccountId  String           @map("ad_account_id")
  level        MetaObjectLevel
  objectId     String           @map("object_id")
  objectName   String           @map("object_name")
  field        MetaChangeField
  fromValue    String?          @map("from_value")   // "PAUSED" / "2000" (minor), o lido AO VIVO antes de escrever
  toValue      String           @map("to_value")
  alsoChanged  String[]         @default([]) @map("also_changed") // ids dos pais ativados junto (includeParents, D6)
  result       MetaChangeResult
  errorCode    String?          @map("error_code")
  failDetail   String?          @map("fail_detail")  // code/subcode/fbtrace_id
  source       MetaChangeSource
  userId       String           @map("user_id")
  createdAt    DateTime         @default(now()) @map("created_at")
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation("MetaChangedBy", fields: [userId], references: [id])
  @@index([workspaceId, createdAt])
  @@index([objectId, createdAt])
  @@map("meta_changes")
}
```
`DELETE /meta/connection` apaga os dois snapshots novos (como já apaga o de anúncios); `MetaChange` fica (histórico, como as publicações). Trocar de conta apaga snapshots, mantém `MetaChange`.

## 3. Tipos (`contratos/src/campanhas.ts`, proposta)
```ts
type MetaLevel = 'campaign' | 'adset' | 'ad';
type MetaStatusFilter = 'active' | 'paused' | 'issues' | 'all';
type MetaOrigin = 'all' | 'hookmill';
type MetaSort = 'spend' | 'cpa' | 'results' | 'ctr' | 'hookRate' | 'budget' | 'name';

interface MetaBudget {
  level: 'campaign' | 'adset' | null;   // onde o orçamento mora (CBO = campaign; ABO = adset); null só em campanha ABO
  kind: 'daily' | 'lifetime' | null;
  amountMinor: number | null; remainingMinor: number | null; currency: string;
  editable: boolean;                    // daily + OWNER/ADMIN + conta usável
  minimumMinor: number | null;          // minimum_budgets da conta
}
interface MetaObjectBase {
  id: string; name: string;
  status: 'ACTIVE' | 'PAUSED';          // configurado (o toggle)
  effectiveStatus: string;              // por que entrega ou não (ex.: ADSET_PAUSED)
  metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;   // reach/frequency presentes em campanha/conjunto
  fromHookMill: boolean;                // campanha/conjunto: algum MetaPublication criou; anúncio: MetaAdRow.creative != null
  adsManagerUrl: string;                // §5.3
  canToggle: boolean;                   // OWNER/ADMIN, conta usável, não DISAPPROVED/DELETED
}
interface MetaCampaignRow extends MetaObjectBase {
  objective: string; buyingType: string | null; bidStrategy: string | null; isCbo: boolean;
  budget: MetaBudget;
  counts: { adsets: number; ads: number; activeAds: number; winners: number; tiring: number };
  startTime: string | null; stopTime: string | null;
}
interface MetaAdsetRow extends MetaObjectBase {
  campaignId: string; optimizationGoal: string | null; billingEvent: string | null;
  learningStage: 'LEARNING' | 'SUCCESS' | 'FAIL' | null;
  budget: MetaBudget;                   // em CBO: level 'campaign', editable false (a tela diz "budget set on the campaign")
  counts: { ads: number; activeAds: number; winners: number };
}
// anúncio = MetaAdRow do meta-v1 §2 + `status`, `fromHookMill`, `adsManagerUrl`, `canToggle`, `canIterate` (videoId != null)

interface MetaCampaignsQuery { period?: '30d' | '7d'; status?: MetaStatusFilter; origin?: MetaOrigin; q?: string; sort?: MetaSort; dir?: 'asc' | 'desc'; limit?: number; cursor?: string }
interface MetaCampaignsMeta extends PageMeta {
  period: '30d' | '7d'; currency: string | null;
  totals: { spend: number; results: number; resultType: string | null; cpa: number | null; ctr: number | null; hookRate: number | null };
  truncated: boolean;                   // passou de 500 em algum nível
  sync: MetaSyncState;                  // o mesmo do meta-v1 §5.3
}
interface MetaCampaignDetail { campaign: MetaCampaignRow; adsets: (MetaAdsetRow & { ads: MetaAdRow[] })[] }

interface MetaStatusBody { status: 'ACTIVE' | 'PAUSED'; expected: 'ACTIVE' | 'PAUSED'; confirm: true; includeParents?: boolean }
interface MetaBudgetBody { dailyBudgetMinor: number; expectedDailyBudgetMinor: number; confirm: true }
interface MetaWriteResult { level: MetaLevel; object: MetaCampaignRow | MetaAdsetRow | MetaAdRow; change: MetaChangeRow; alsoActivated: { level: MetaLevel; id: string; name: string }[] }
interface MetaChangeRow { id: string; level: MetaLevel; objectId: string; objectName: string; field: 'STATUS' | 'DAILY_BUDGET'; from: string | null; to: string; result: 'APPLIED' | 'FAILED' | 'BLOCKED'; errorCode: string | null; source: 'CAMPAIGNS' | 'PUBLISH'; by: UserRef; at: string }   // BLOCKED: §11
```
`MetaAdsQuery` (meta-v1) ganha `status`, `origin`, `campaignId`, `adsetId`, `format: 'video' | 'all'` (**padrão `video`**, então o Pick from Meta e o tour não mudam) e `period` (decide a janela usada pra ordenar). `Action` ganha `refresh` (recarregar o objeto depois de `META_OBJECT_CHANGED`).

## 4. Rotas (módulo `meta`, arquivo novo `api/src/meta/campanhas.*`)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /meta/campaigns` | `MetaCampaignsQuery` | `MetaCampaignRow[]` + `meta: MetaCampaignsMeta`. Só snapshot, nunca chama a Graph | 400, 422 `META_NOT_CONNECTED`/`META_SELECTION_MISSING` | todos (`@ClientAllowed`) |
| `GET /meta/campaigns/:campaignId` | `?period` | `MetaCampaignDetail` (conjuntos + anúncios, todos os formatos, ordenados como a lista) | 404 (fora do snapshot), 422 | todos (`@ClientAllowed`) |
| `GET /meta/ads` (existe) | `MetaAdsQuery` estendida (§3) | igual + campos novos na linha + `meta.totals` do conjunto filtrado (§11) | igual | todos |
| `POST /meta/campaigns/:id/status` · `POST /meta/adsets/:id/status` · `POST /meta/ads/:id/status` | `MetaStatusBody` | `MetaWriteResult` (snapshot do objeto já atualizado; métricas esperam o próximo sync) | ver §4.1 | **OWNER, ADMIN** |
| `PATCH /meta/campaigns/:id/budget` · `PATCH /meta/adsets/:id/budget` | `MetaBudgetBody` | `MetaWriteResult` | ver §4.1 | **OWNER, ADMIN** |
| `GET /meta/changes` | `?level&objectId&limit&cursor` | `MetaChangeRow[]` + `nextCursor` (mais recente primeiro): gaveta "History" do objeto e da conta | 400 | todos (`@ClientAllowed`) |
| `POST /iterate { metaAdId }` (existe) | — | igual meta-v1 §3.2. Anúncio sem vídeo = `409 INVALID_STATE { reason: 'not_a_video' }` (reason já existe) | igual | OWNER, ADMIN, MEMBER |
| `POST /meta/sync` (existe) | — | o mesmo job, agora com as etapas `listing_campaigns` → `listing_adsets` → `listing_ads` → `reading_insights` (9 leituras) → `scoring` | igual | OWNER, ADMIN, MEMBER |

Ordem de uma escrita (`MetaWriteService`, 1 caminho pros 5 endpoints e pro `activate`/`pause` da tela Send, que passam a gravar `MetaChange` com `source PUBLISH`):
1. Conexão `ACTIVE` + conta escolhida; objeto existe no snapshot da conta escolhida (senão 404). Conta com `account_status ≠ 1` → `422 META_ACCOUNT_UNUSABLE` (D5 do meta-v1).
2. **Leitura ao vivo** do objeto (`GET /{id}?fields=status,effective_status,daily_budget,lifetime_budget,campaign{id,name,status,daily_budget},adset{id,name,status,daily_budget}`). Diferente de `expected`/`expectedDailyBudgetMinor` → `409 META_OBJECT_CHANGED { current }` (alguém mexeu no Ads Manager depois do sync; o web atualiza a linha e pede de novo). Objeto sumiu → `404 META_OBJECT_GONE` e o snapshot dele sai.
3. Regras (§4.1). 4. `POST /{id}` com `status` ou `daily_budget`. 5. Grava `MetaChange` (APPLIED ou FAILED, mesmo quando a Meta recusa; a trava `META_POLICY` do passo 3 grava BLOCKED antes de devolver o 422, §11) e atualiza o snapshot do objeto (+ `MetaPublication.status` quando o anúncio/campanha é de uma publicação: ACTIVE/PAUSED). 6. Devolve.

### 4.1 Regras e erros das escritas
| regra | erro |
|---|---|
| `confirm: true` ausente | 400 `VALIDATION_ERROR` |
| ativar anúncio/conjunto com pai pausado e sem `includeParents: true` | **409 `META_PARENT_PAUSED` `{ parents: [{ level, id, name }] }`**: o web mostra "this also turns on: <campanha>, <conjunto>" e reenvia com `includeParents`. Pausar nunca mexe em pai nem filho |
| ativar anúncio `DISAPPROVED` / `WITH_ISSUES` | 422 `META_POLICY` (código já existia como assíncrono do publish; **somado ao `ApiErrorCode` como síncrono em 22/10**, `details` nenhum, `action: edit_ad_text` não se aplica: o web mostra "Meta rejected this ad. Fix it in Ads Manager"). **Grava `MetaChange` BLOCKED** (§11) |
| orçamento em objeto que não tem orçamento diário próprio (CBO no conjunto, ABO na campanha, vitalício) | **422 `META_BUDGET_NOT_EDITABLE` `{ budgetLevel, kind }`** ("This budget is set on the campaign" / "Lifetime budgets: edit in Ads Manager") |
| abaixo do mínimo da conta | 422 `META_BUDGET_TOO_LOW { minimumMinor, currency }` (já existe) |
| acima de `META_BUDGET_MAX_STEP` × atual (padrão 2) numa ação | **422 `META_BUDGET_STEP_TOO_LARGE` `{ maxMinor, currency }`** (sobe em passos, ou no Ads Manager). Diminuir não tem teto |
| > `META_WRITES_PER_MIN` escritas por workspace (padrão 20) | 429 `RATE_LIMITED { retryAfterSec }` (já existe) |
| BUC da conta ≥ 90 % no último header lido (`GraphClient.lastUsage`) ou a Meta devolveu 4/17/32/613 | 503 `META_UNAVAILABLE { reason: 'rate_limited', retryAfterSec }` (já existe; a 90 % e não 100 % pra não gastar a cota do sync numa escrita) |
| token/permissão | 422 `META_TOKEN_INVALID` / `META_PERMISSION` (já existem) |
| `META_MODE=off` | 503 `META_NOT_CONFIGURED { reason: 'off' }` em toda rota daqui (regra do meta-v1) |
Erros novos (somam ao `api.md` §1): `META_POLICY` 422 síncrono (uso novo do código existente) · `META_OBJECT_CHANGED` 409 `{ current: { status, dailyBudgetMinor } }` · `META_OBJECT_GONE` 404 · `META_PARENT_PAUSED` 409 `{ parents }` · `META_BUDGET_NOT_EDITABLE` 422 `{ budgetLevel, kind }` · `META_BUDGET_STEP_TOO_LARGE` 422 `{ maxMinor, currency }`. Nenhum assíncrono novo (escrita é síncrona, 1-3 chamadas).
Aviso (não erro) que o web mostra no modal de orçamento: aumento > 20 % ou qualquer mudança em conjunto com `learningStage = LEARNING` → "big changes can restart Meta's learning phase".

## 5. Relação com o que existe
1. **Home** continua com `GET /meta/summary` (KPIs da conta) e o cartão do vencedor; o link "All ads" passa a abrir `/campaigns` real (modo anúncios, ordenado por gasto).
2. **Pick from Meta** e **tour** não mudam: `GET /meta/ads` segue com `format=video` por padrão. A mediana do veredito continua calculada **só sobre anúncios de vídeo** (os mesmos 7 vencedores de hoje); os anúncios de imagem recebem veredito contra essa mesma régua só pra aparecerem com chip na Campaigns (D2).
3. **Publicação do HookMill:** linha com selo "HookMill" (campanha, conjunto e anúncio criados por `MetaPublication`) e link pro criativo de origem (`/creatives/:id`). A tela Send continua sendo o único lugar que **cria** campanha.
4. **Links pro Ads Manager** (`act` sem o prefixo `act_`): campanha `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=<n>&selected_campaign_ids=<id>`, conjunto `…/manage/adsets?act=<n>&selected_adset_ids=<id>`, anúncio `…/manage/ads?act=<n>&selected_ad_ids=<id>` (o mesmo formato do `MetaPublication.adsManagerUrl`).
5. **Estados da tela:** `META_MODE=off` → continua o `SoonPage` de hoje; sem conexão → vazio com "Connect Meta" (`/settings/connections`); `sync.state first_sync` → progresso do job; `stale`/`failed` → faixa com "Sync now"; conta inutilizável → tudo visível, toggles desabilitados com o motivo. Sidebar perde o `soon: true` quando `META_MODE ≠ off`.
6. **Atualização:** sem SSE nem webhook (mesmo porquê do meta-v1 §6). `GET /meta/campaigns` ao abrir e no foco da janela; depois de uma escrita o web troca a linha pelo `object` devolvido; "Sync now" (`POST /meta/sync`, mínimo 5 min) e o cron de 6 h trazem métricas.

## 6. Modo mock (`META_MODE=mock`; gatilhos novos pro QA)
O `META_SYNC` mock passa a gerar **3 campanhas**: `mock_cmp_cbo` (CBO, diário US$ 50, 2 conjuntos, 1 em `LEARNING`), `mock_cmp_abo` (ABO, 3 conjuntos com diário próprio: 1 **pausado** com anúncio ativo dentro e 1 chamado `[mock:stale]`), `mock_cmp_life` (CBO **vitalício**); os 8 anúncios de vídeo de hoje distribuídos nelas + **2 anúncios de imagem**; publicações mock do HookMill aparecem com selo. Escritas mock alteram o snapshot de verdade (o QA vê o toggle mudar).
| gatilho | resultado |
|---|---|
| ativar o anúncio dentro do conjunto pausado de `mock_cmp_abo` sem `includeParents` | 409 `META_PARENT_PAUSED` |
| qualquer escrita no conjunto `[mock:stale]` de `mock_cmp_abo` | 409 `META_OBJECT_CHANGED` |
| ativar o anúncio `mock_ad_disapproved` (o `DISAPPROVED` de hoje) | 422 `META_POLICY` |
| orçamento no conjunto de `mock_cmp_cbo` / em `mock_cmp_life` | 422 `META_BUDGET_NOT_EDITABLE` |
| `dailyBudgetMinor < 500` / `> 2 × atual` | 422 `META_BUDGET_TOO_LOW` / `META_BUDGET_STEP_TOO_LARGE` |
| objeto com nome `[mock:meta-rate]` / `[mock:meta-token]` | 503 `rate_limited` / 422 `META_TOKEN_INVALID` (e a escrita sai FAILED no `MetaChange`) |
| 21ª escrita no minuto | 429 `RATE_LIMITED` |

Env novas: `META_BUDGET_MAX_STEP=2` · `META_WRITES_PER_MIN=20` · `META_WRITE_USAGE_CEILING=90`.

## 7. Fora da v1 (e por quê)
Duplicar campanha/conjunto/anúncio (é o caminho de "escalar" e merece regra própria de orçamento; hoje o Ads Manager faz em 2 cliques pelo link) · editar público, posicionamento, lance, criativo ou texto (cada um é uma tela; erro aqui custa dinheiro e o ganho sobre o Ads Manager é pequeno) · criar campanha pela Campaigns (continua só pela tela Send) · apagar/arquivar · ações em lote · orçamento vitalício e agendamento · gráfico de linha diário (exige histórico diário de insights; a Home e esta tela ficam nas janelas) · intervalo de datas livre · regras automáticas, CPA alvo e teto de mídia (Goals, fase2 §8) · Eddy · webhooks da Meta · contas além da escolhida.

## 8. Tarefas por agente
| # | agente | tarefa | depende de | tempo | verificação |
|---|---|---|---|---|---|
| A4 | arquiteto | `contratos/src/campanhas.ts` + aditivos (`MetaAdsQuery`, `MetaAdRow`, `Action`), schema + migração `campanhas_v1`, `api.md`/`modelo-de-dados.md`/`eventos.md`, interface nova no `integracoes/contrato.ts` (`listCampaigns`, `listAdsets`, insights por nível, `readObject`, `setStatus`, `setDailyBudget`) | ok do Gusta | ½ d | `prisma validate`, `tsc` do pacote |
| I4 | ia (`integracoes/meta/`) | leitura de campanhas/conjuntos + insights `level=campaign`/`adset` × 3 janelas; anúncios com `status` e sem descartar imagem (veredito de imagem contra a mediana de vídeo); `readObject`/`setStatus`/`setDailyBudget`; mapa de erros da escrita (budget CBO/ABO, política); mock do §6; sonda live só de leitura | A4 | 1½ d | Jest com `fetch` falso (1 teste por linha do §4.1 que vem da Meta), mock determinístico, `tsc`; sonda com ok |
| B4 | backend (`api/src/meta/`) | sync grava as 3 tabelas numa transação; `GET /meta/campaigns(/:id)`, filtros/busca/ordem/totais; `MetaWriteService` (§4 passos 1-6) usado também por `activate`/`pause`; `MetaChange`; `GET /meta/changes`; throttle por workspace; `MetaAdsQuery` estendida | A4, I4 (ou mock dela) | 2 d | int em mock: cada linha da tabela do §6; CLIENT 403 nas escritas e 200 nas leituras; MEMBER 403 nas escritas; `MetaChange` gravado também no FAILED; `includeParents` ativa e registra `alsoChanged`; Pick from Meta continua só vídeo e com os mesmos WINNER; `tsc` |
| D4 | design | mockup da Campaigns desktop e 390 px: tabela expansível + modo anúncios, filtros/busca, chips de veredito/tendência/aprendizado, selo HookMill, modal de ativar ("this starts spending", lista de pais), modal de orçamento (mínimo, teto 2×, aviso de aprendizado), gaveta History, estados do §5.5, EN/PT | A4 (tipos) | 1 d (paralelo) | ok do Gusta no mockup |
| F4 | frontend | página `/campaigns` real ligada nas rotas (React Query, MSW nos tipos novos), sidebar sem `soon` fora do `off`, link "All ads" da Home | A4, D4; B4 ou MSW | 2 d | `tsc`, MSW cobre os 7 erros do §4.1; desktop e 390, EN/PT |
| Q4 | qa | ponta a ponta em mock (tabela do §6 inteira, papéis, sync estendido, Pick from Meta intacto) + **live** com ok: pausar e reativar a campanha PAUSED publicada pelo HookMill (gasto zero) e subir/voltar o orçamento de 1 conjunto de teste, conferindo no Ads Manager e no History | B4, F4, I4 | 1 d | só o qa declara "funciona" |
Pastas: A4 `docs/`, `contratos/`, `api/prisma/`, `integracoes/contrato.ts` · I4 `api/src/integracoes/meta/` · B4 `api/src/meta/`, `error-codes.ts` · F4 `web/` · D4 `design/` · Q4 `testes/`. Caminho crítico: A4 → I4 ‖ B4 ‖ D4 → F4 → Q4 ≈ **5 dias úteis**.

## 9. Decisões (recomendação em negrito)
- **D1 Snapshot ou ao vivo?** **Snapshot (sync estendido, +2 listagens e +6 leituras de insights por sync) e leitura ao vivo só antes de escrever.** Mesmo motivo do meta-v1 §1 (BUC, segundos por leitura, número igual em todas as telas); a guarda de concorrência cobre o risco do snapshot de até 6 h. Alternativa: ler ao vivo a cada abertura (número sempre fresco, tela lenta e cota da Meta queimando).
- **D2 Sync guarda todos os anúncios** (imagem também), `GET /meta/ads` continua `video` por padrão e a mediana do veredito continua só de vídeo. Home, tour e Pick from Meta ficam idênticos.
- **D3 Métricas de campanha/conjunto lidas por nível**, não somadas dos anúncios: soma não bate com o Ads Manager (alcance/frequência não somam; anúncio apagado com gasto some da lista) e o Tordan compara número com número.
- **D4 Ações v1 = pausar/ativar 3 níveis + orçamento diário onde ele mora + Iterate.** Fora: duplicar e editar (§7). É o que se faz todo dia olhando a tabela; o resto o link do Ads Manager resolve.
- **D5 Quem escreve: OWNER/ADMIN.** MEMBER e CLIENT só leem (MEMBER continua com Sync now e Iterate). Coerente com o D11 do meta-v1.
- **D6 Ativar não cascateia sem pedir:** pai pausado → `409 META_PARENT_PAUSED` com a lista, o usuário confirma `includeParents`. Pausar nunca cascateia. (O `activate` da tela Send continua ligando os três, que é o que ele sempre fez, e passa a registrar `alsoChanged`.)
- **D7 Teto de aumento de orçamento: 2× por ação, bloqueio duro** (env). Aviso, sem bloqueio, acima de +20 % ou em conjunto aprendendo. Diminuir é livre até o mínimo. Alternativa: só aviso, sem teto (protege menos contra um zero a mais digitado).
- **D8 Guarda de concorrência obrigatória** (`expected` / `expectedDailyBudgetMinor`, comparados com leitura ao vivo): impede agir sobre um estado de 6 h atrás.
- **D9 Auditoria em tabela própria `MetaChange`**, append-only, inclusive falhas e as ações da tela Send; visível pra todos (gaveta History). Não é log de app: é o "quem mudou meu orçamento" que agência precisa mostrar ao cliente.
- **D10 Períodos = os do sync (30 d e 7 d), delta só no 7 d.** Intervalo livre e gráfico diário ficam fora (exigem histórico diário).
- **D11 Escrita bloqueada com BUC ≥ 90 %** e throttle de 20 escritas/min por workspace, pra a escrita nunca derrubar o sync.
- **D12 Sem nova tela de criação:** criar campanha continua só pela publicação (Send); a Campaigns opera o que existe.

## 10. Ajustes 22/10 (pedidos do design, spec `design/campanhas-v1-2026-10-22.md` aprovada) · sem migração
Tipos aplicados em `contratos/src/campanhas.ts` e `meta.ts` como **opcionais até a B4b** (o backend passa a devolver sempre).
| pedido | decisão | como |
|---|---|---|
| `matchedIn` na campanha (busca abre o pai) | **aceito** | `MetaCampaignRow.matchedIn?: ('adset'\|'ad')[]`, só quando `q` veio: níveis abaixo em que algum nome bateu (`[]` = só o nome da campanha). Calculado nos snapshots que a busca já lê |
| nomes de campanha/conjunto no `GET /meta/ads` | **já existe** | `MetaAdRow.campaign.name` e `MetaAdRow.adset.name` (meta-v1); nada muda |
| `meta.counts` (número no filtro Issues) | **aceito** | `MetaStatusCounts { all, active, paused, issues }` em `MetaCampaignsMeta.counts` (nível campanha) e em `MetaAdsMeta.counts` (modo "Ads only"), contando com os **outros** filtros aplicados (`origin`, `q`, `format`) e ignorando `status`. Mesma regra de agrupamento do `MetaStatusFilter` |
| `anyAdsetLearning` na campanha | **aceito** | `MetaCampaignRow.anyAdsetLearning?: boolean` = algum `MetaAdsetSnapshot` da campanha com `learningStage = LEARNING` |
| nomes dos pais ativados no `MetaChangeRow` | **aceito, sem coluna nova** | `MetaChangeRow.alsoChangedRefs?: MetaObjectRef[]`, resolvido na leitura pelos snapshots de campanha/conjunto atuais (nível pelo snapshot onde o id está); id fora do snapshot = `{ level: 'campaign', id, name: id }` na ordem gravada. `alsoChanged` (ids) continua. Gravar nome no `MetaChange` exigiria migração não aprovada e não muda o que a gaveta mostra |

| # | agente | tarefa | depende de | tempo | verificação |
|---|---|---|---|---|---|
| B4b | backend (`api/src/meta/`) | os 4 campos acima em `campanhas.service`/`campanhas.views` (+ `counts` no `GET /meta/ads`) | este §10 | ½ d | int em mock: `q` com nome de anúncio → `matchedIn ['ad']`; `counts` não muda com `status`; campanha com 1 conjunto LEARNING → `anyAdsetLearning true`; `includeParents` → `alsoChangedRefs` com nomes; `tsc` |

### 10.1 `activate`/`pause` da tela Send (decisão do arquiteto, 22/10)
Seguem o **meta-v1** sem mudança de comportamento: `POST /creatives/:id/meta/activate` liga anúncio + conjunto + campanha da publicação (sem `includeParents`, sem leitura ao vivo, sem guarda `expected`, sem teto de orçamento: não mexe em orçamento) e `pause` pausa só o anúncio. **Única mudança:** cada chamada grava `MetaChange` com `source PUBLISH` (`level ad`, `field STATUS`, `from` = status da publicação antes, `to`, `alsoChanged` = conjunto e campanha no activate, `APPLIED`/`FAILED`). Por quê: os 3 objetos foram criados pelo próprio HookMill e nascem pausados, o usuário já confirma no diálogo da Send (`confirm: true`), e a guarda de concorrência existe pra objeto que pode ter sido mexido no Ads Manager; lá o caminho é a tela Campaigns, que tem as travas. Exceção que vale nos dois: anúncio `DISAPPROVED`/`WITH_ISSUES` no snapshot → 422 `META_POLICY`.

**22/10 (frontend):** `GET /meta/ads` aplica `dir` (`asc|desc`) no servidor junto com `sort`; `dir` sem `sort` = gasto nessa direção. O web deixa de ordenar no cliente.

## 11. Ajustes 23/10 (QA de 23/10, `testes/qa-meta-onboarding-v2-2026-10-21.md`) · decisão do arquiteto
| ponto | decisão | como |
|---|---|---|
| **Achado D:** a linha Total do "Ads only" soma só a página carregada (> 100 anúncios = número errado) | **o servidor manda os totais** | `MetaAdsMeta.totals: MetaCampaignsTotals` (obrigatório) = `{ count, spend, results, resultType, cpa, ctr, hookRate }` agregados sobre o conjunto **filtrado inteiro** antes de paginar, com **todos** os filtros (inclusive `status` e `format`, ao contrário de `counts`), na janela de `period` (padrão `30d`; `7d` usa `metrics7d`). Mesma agregação do `GET /meta/campaigns` (CPA = gasto/resultados, CTR = cliques/impressões). Igual em toda página. `MetaCampaignsTotals.count` (novo, opcional no tipo só pra não quebrar o web antes da F4c; o backend manda sempre) = linhas do filtro: campanhas em `GET /meta/campaigns`, anúncios em `GET /meta/ads`. É o número do "Total · N ads/campaigns" |
| **META_POLICY fora do History** (contrato §4 × design §2.12 "toda falha entra no History") | **grava, como `BLOCKED`** | Enum `MetaChangeResult` ganha `BLOCKED` = a trava do HookMill recusou **antes** de escrever; a Meta não recebeu escrita (no caminho da Campaigns houve só a leitura ao vivo do passo 2). Vale nos dois caminhos: Campaigns (`source CAMPAIGNS`) e activate da Send (`source PUBLISH`, §10.1). `from` = status lido, `to` = pedido, `errorCode META_POLICY`, `alsoChanged []`. Conta no throttle de 20/min (D11) como qualquer linha. **Só `META_POLICY`**: `META_OBJECT_CHANGED` e `META_PARENT_PAUSED` são conversa (o web recarrega ou reenvia com `includeParents`) e as recusas de orçamento são validação que o diálogo já impede; nenhuma vira linha. Por que não `FAILED`: `FAILED` quer dizer "a Meta recusou/falhou"; o History de agência precisa distinguir "o HookMill nem tentou" |

Web (F4c): a linha Total do "Ads only" lê `meta.totals` da 1ª página (`count` no rótulo) e para de somar no cliente; o rótulo da árvore usa `meta.totals.count`. History: `BLOCKED` mostra o chip **Failed** (tom `bad`, design §2.12) com o texto do `errorCode` ("Rejected by Meta's ad review"), igual ao `FAILED`.
Verificação (B4c, feita 23/10): `campanhas.int.spec` (totais com `limit=3` = soma das 10 linhas, iguais na 2ª página, `status`/`format`/`period`/`origin` entram; `META_POLICY` → 1 linha BLOCKED, nenhuma chamada de escrita no fake) e `meta.int.spec` (activate da Send reprovado → BLOCKED `source PUBLISH`), `tsc` de `contratos`, `api` e `web`.

