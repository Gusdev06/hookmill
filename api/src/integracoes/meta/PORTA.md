# Porta `MetaService` (I1 → B1)
Data: 2026-10-21 (revisão do arquiteto aplicada no mesmo dia, ver "Ajustes pós-revisão") · Dono: maquina-ia · Fonte da assinatura: `api/src/integracoes/contrato.ts` (seção "Meta v1") · Contrato: `docs/contratos/meta-v1.md`.

## Como o backend usa
```ts
import { META_SERVICE, type MetaService, type MetaAuth, MetaError, isMetaError, cifrar, decifrar } from '../integracoes';
constructor(@Inject(META_SERVICE) private readonly meta: MetaService) {}
const auth: MetaAuth = { accessToken: decifrar(conn.tokenCiphertext, process.env.META_TOKEN_KEY) };
```
- A integração **não toca no banco**. O backend lê a `MetaConnection`, decifra o token (`cifra.ts`, AES-256-GCM, `base64(iv ‖ tag ‖ ciphertext)`), passa `auth` e grava o que volta.
- Modo em `META_MODE` (`mock` padrão · `live` · `off`). `off` e live sem `META_APP_ID`/`META_APP_SECRET`/`META_CONFIG_ID`/`META_TOKEN_KEY` → toda chamada lança `MetaError META_NOT_CONFIGURED { reason }`; `status()` diz `configured:false`.
- Erro = `MetaError { code, message, action, details, failDetail, retryAfterSec }` (`meta/erros.ts`). `code` é um dos `META_*` do contrato (§3.3 tabela + §3.4). `failDetail` = `code/subcode/fbtrace_id` da Meta (debug), `message` = `error_user_msg` quando veio. **Nunca contém token, `code` do OAuth nem `client_secret`**: `message` e `failDetail` passam pelo `scrubToken` no construtor do `MetaError` (e o OAuth scrubba antes de cortar).
- `META_TOKEN_INVALID` em qualquer chamada = o backend marca a conexão `TOKEN_INVALID`.

## Assinatura (resumo; a verdade é o `contrato.ts`)
| método | pra qual rota | devolve | lança |
|---|---|---|---|
| `status()` | `ServiceStatus` META | `{ mode, configured, appIdMasked, graphVersion }` | — |
| `buildAuthUrl({ workspaceId, userId, returnTo })` | `POST /meta/connect` | `{ url, state, expiresAt }` (state = JWT HS256 10 min com `JWT_ACCESS_SECRET`; `returnTo` só da allowlist `/onboarding/meta` · `/settings/connections` · `/settings` (alias) · `/meta/done`, fora dela cai em `/onboarding/meta`) | `META_NOT_CONFIGURED` |
| `verifyState(state, expect?)` | `GET /meta/callback` | `MetaOAuthState` | `META_STATE_INVALID` |
| `exchangeCode({ code, error, errorReason, errorDescription })` | `GET /meta/callback` | `MetaTokenGrant { accessToken, expiresAt, scopes, user }` | `META_OAUTH_DENIED`, `META_SCOPES_MISSING { missing }`, `META_OAUTH_FAILED`, `META_UNAVAILABLE` |
| `inspectToken(auth)` | health / cron | `{ isValid, expiresAt, scopes, missingScopes }` (is_valid=false **não** lança) | `META_UNAVAILABLE` |
| `revoke(auth)` | `DELETE /meta/connection` | void (melhor esforço, nunca lança) | — |
| `listOptions(auth, { adAccountId? })` | `GET /meta/options` | `MetaOptions` (`canManage`, `permissionReason`, pixels só da conta pedida) | `META_TOKEN_INVALID`, `META_PERMISSION`, `META_UNAVAILABLE` |
| `readAdAccount(auth, 'act_…')` | `PUT /meta/selection`, defaults | `MetaAdAccountInfo` (status+label, currency, timezone, business, canManage, hasFunding, minimumDailyBudgetMinor) | `META_PERMISSION` (conta fora do alcance) |
| `health(auth, { adAccountId, pageId, pixelId, businessId, tokenExpiresAt, scopes, counts })` | `POST /meta/health` | `{ health: MetaHealth (8 checks), account, token }` | `META_TOKEN_INVALID`, `META_UNAVAILABLE` |
| `syncAds(auth, { adAccountId, currency, businessType, hasPixel }, onProgress)` | job `META_SYNC` | `{ ads: MetaAdSnapshotDraft[], medianCpa, rule, listed, syncedAt }` (só vídeo; verdict/trend prontos) | idem |
| `videoSource(auth, videoId, ctx)` (`ctx.metaAdId` libera o upload original do criativo e a mídia do Instagram) | job `META_IMPORT` | `{ sourceUrl, permalinkUrl, lengthSec }` → `storage.ingestVideoWithThumbnail` | `META_VIDEO_UNAVAILABLE` (action `upload_video`) |
| `rule()` | `MetaSummary.rule`, recálculo | `MetaWinnerRule` | — |
| `uploadVideo(auth, input)` | `META_PUBLISH` 1 | `{ videoId }` | `META_VIDEO_REJECTED`, `META_PERMISSION`, `META_ERROR` |
| `waitVideoReady(auth, input, ids, { timeoutMs?, onPoll? })` | 2 | void | `META_VIDEO_REJECTED`, `META_ERROR` (action `retry` no teto 10 min) |
| `createCampaign(auth, input)` | 3 | `{ campaignId }` | `META_PAYMENT_REQUIRED`, `META_TOKEN_INVALID`, `META_RATE_LIMITED`, `META_ERROR` |
| `createAdSet(auth, input, ids)` | 4 | `{ adsetId }` | `META_BUDGET_TOO_LOW { minimumMinor, currency }`, `META_ACCOUNT_UNUSABLE`, `META_PAYMENT_REQUIRED` |
| `createAdCreative(auth, input, ids)` | 5 | `{ creativeId }` (`image_url` só quando `input.thumbnailUrl` é string; `null` = sem `image_url`, a Meta gera o thumb do vídeo) | `META_POLICY` (action `edit_ad_text`), `META_PERMISSION` |
| `createAd(auth, input, ids)` | 6 | `{ adId, previewUrl }` | `META_POLICY`, `META_ERROR` |
| `setStatus(auth, { objectIds, status })` | `activate` (ad+adset+campaign) / `pause` (só ad) | void | `META_TOKEN_INVALID`, `META_PERMISSION`, `META_ACCOUNT_UNUSABLE` |
| `adsManagerUrl(adAccountId, adId)` | `MetaPublication.adsManagerUrl` | string (`#` no mock) | — |

Ordem das etapas: `META_PUBLISH_STAGES`. Retomada: o backend pula a etapa cujo id já está em `MetaPublishIds` e passa os ids nas seguintes. `MetaPublishInput.video`: `fileUrl` público (prod) **ou** `sizeBytes` + `read(offset, length)` do storage (dev/`PUBLIC_MEDIA=off`, upload resumable em pedaços de 8 MB). `MetaPublishInput.thumbnailUrl: string | null`: URL assinada (≥ 6 h) do **JPEG/PNG** do render, ou `null` quando não houver JPEG — **nunca** a URL do `.mp4` (a Meta rejeita `image_url` que não é imagem).

## Ajustes pós-revisão (21/10, revisão do arquiteto)
1. **`returnTo`**: allowlist ganhou `/settings/connections` (Settings › Connections, onde o `MetaConnect` lê `?meta=`); `/settings` fica como alias até o web trocar. Tipo `MetaReturnTo` em `contrato.ts`; `contratos/src/meta.ts` já tinha.
2. **Token no header**: `GraphClient` manda o token em `Authorization: Bearer` em toda chamada; a URL leva só `appsecret_proof` (+ params). Se a Meta devolver `paging.next` com `access_token` na query, o cliente tira da URL antes de seguir. Token nunca aparece em URL, log ou mensagem de erro de rede. `debug_token` segue com o app token (`app_id|app_secret`) em `access_token` da query + `input_token`, como a Meta documenta.
3. **`failDetail` higienizado**: `scrubToken` cobre `access_token`, `fb_exchange_token`, `input_token`, `client_secret`, `code=` e `Bearer …`; aplicado no construtor do `MetaError` (mensagem e `failDetail`) e no OAuth antes do corte de 240 chars; `mapGraphError` scrubba antes de cortar a mensagem da Meta.
4. **`image_url`**: `thumbnailUrl` virou `string | null`; `null` → creative sem `image_url`. O backend passa `null` quando não há JPEG do render (antes caía na URL do vídeo).
5. **Nonce do `state`**: o `state` **já** carrega `nonce` aleatório (12 bytes) assinado junto com `wid/sub/returnTo/exp/purpose`, e `verifyState` devolve ele. **Validar o nonce na volta (anti-replay dentro dos 10 min) exige persistir o nonce emitido** (cookie no navegador ou tabela/cache no banco), e o contrato §7 diz que `GET /meta/callback` não lê cookie e o `state` não vai pro banco. **Pendência, não feita:** se o arquiteto quiser anti-replay, a opção mais barata é o backend gravar `nonce` + `exp` numa tabela pequena (ou em memória com TTL no processo único) ao emitir e marcar como usado no callback; a integração só precisa expor o `nonce` (já expõe). Hoje a proteção é: assinatura HMAC, `exp` de 10 min, `purpose`, e `wid/sub` conferidos — um `state` interceptado só serve pra ligar a Meta ao mesmo workspace/usuário que o pediu.

Funções puras exportadas (`integracoes/index.ts`): `verdictOf(ads, rule, currency)`, `trendOf(m7d, mPrev7d, rule, currency)`, `medianCpaOf`, `ruleFromEnv(env)`, `cifrar`, `decifrar`, `metaMode(env)`.

## Mock (`META_MODE=mock`) — gatilhos do §8 do contrato
| onde | gatilho | efeito |
|---|---|---|
| `exchangeCode` | `code` = `mock` / `mock-denied` / `mock-scopes` / `mock-failed` | ok / `META_OAUTH_DENIED` / `META_SCOPES_MISSING {missing:['ads_management']}` / `META_OAUTH_FAILED` |
| `listOptions` | — | `act_mock_1` (USD, ativa), `act_mock_2` (BRL, `accountStatus 2`), `act_mock_3` (USD, `canManage:false`); 1 página `page_mock`; pixel `pix_mock` (lastFiredAt ontem) só com `adAccountId` |
| `health` | `adAccountId: 'act_mock_2'` | check `account` **bad**, `canPublish:false`; `act_mock_1` = tudo ok menos `verified` warn |
| `syncAds` | — | 8 anúncios: `mock_ad_1`,`mock_ad_2` WINNER (cpa 20 / 23,75; mediana 27,375); `mock_ad_3` OK+TIRING; `mock_ad_4` OK; `mock_ad_1` WORKING; `mock_ad_5`,`mock_ad_6` LOW_DATA novos (`trend null`); `mock_ad_7` DISAPPROVED; `mock_ad_novideo` LOW_DATA; progresso em 4 passos |
| `videoSource` | `videoId: 'mock_video_novideo'` (do `mock_ad_novideo`) | `META_VIDEO_UNAVAILABLE` |
| `readAdAccount` | `act_mock_*` | `minimumDailyBudgetMinor: 500` (o 422 `META_BUDGET_TOO_LOW` para `< 500` é do backend) |
| publicação | `settings.primaryText` contém `[mock:meta-policy]` | `createAdCreative` lança `META_POLICY` |
| publicação | `[mock:meta-payment]` / `[mock:meta-token]` / `[mock:meta-rate]` / `[mock:meta-error]` | `createCampaign` lança `META_PAYMENT_REQUIRED` / `META_TOKEN_INVALID` / `META_RATE_LIMITED` / `META_ERROR` |
| publicação | `settings.headline` contém `[mock:meta-slow]` | `waitVideoReady` leva 30 s |
Atrasos do mock: `stepMs` (padrão 500 ms por passo; testes passam 0). Sem rede, determinístico.

## Ajuste 22/10 — campos de insights da Graph v25.0 (1º bug live)
**Sintoma:** 1º sync com a conta real caiu em `graph GET /v25.0/act_…/insights → 400 META_ERROR (100) video_3_sec_watched_actions is not valid for fields param`.
**Causa:** `video_3_sec_watched_actions` não existe na Marketing API (não está no enum `AdsInsights.Fields` do SDK oficial em nenhuma versão v22–v26: https://github.com/facebook/facebook-nodejs-business-sdk/blob/v25.0.0/src/objects/ads-insights.js; a referência https://developers.facebook.com/docs/marketing-api/reference/ads-insights/ que a própria Meta cita no erro responde 404 fora do navegador logado). Era um chute do §3.2 marcado "a confirmar na sonda".
**Sonda de US$ 0 (22/10, só `GET … limit=1` na conta conectada, token decifrado do banco local, nada impresso):** v25.0 **recusa** (#100) `video_3_sec_watched_actions` e `video_10_sec_watched_actions`; **aceita** `video_play_actions`, `video_continuous_2_sec_watched_actions`, `video_thruplay_watched_actions`, `video_p25_watched_actions`, `video_15_sec_watched_actions`, `video_30_sec_watched_actions`, `video_avg_time_watched_actions`, `video_6_sec_watched_actions`, `cost_per_action_type`, `purchase_roas`, `ctr`, `reach`, `frequency`, o conjunto `INSIGHT_FIELDS` inteiro (com `date_preset` e `time_range`), `AD_FIELDS` em `/ads` e `ACCOUNT_FIELDS` na conta. A conta ainda não tem anúncio, então o valor dos campos de vídeo não foi visto — só a aceitação do nome.
**Troca:** o hook passa a ser **`video_continuous_2_sec_watched_actions`** ("2-Second Continuous Video Plays": ≥ 2 s contínuos com ≥ 50 % do vídeo na tela — o indicador de atenção inicial que a Meta mantém no lugar das visualizações de 3 s; `video_play_actions` conta qualquer início, inclusive autoplay, e ThruPlay/p25 já são retenção, não gancho). `plays2s` = esse valor; `hookRate` = plays2s / impressions (%). O arquiteto renomeou `plays3s` → **`plays2s`** no `MetaMetrics` (`contratos/src/meta.ts`, 22/10); a integração já usa o nome novo.
**Robustez:** `readInsights` agora derruba **qualquer** campo não essencial que a Graph recuse com `#100 "<campo> is not valid for fields param"` (`invalidFieldOf`), relê a janela sem ele e não pede mais nas janelas seguintes (`InsightState.rejected`), com `warn` no log. Campo essencial (`INSIGHT_FIELDS_CORE`: `ad_id`, `spend`, `impressions`, `clicks`, `actions`) recusado = `META_ERROR` sobe com o nome do campo no `failDetail`. `leitura.syncAds` devolve `hookPlaysAvailable` e `rejectedFields` (debug; `MetaSyncResult` do contrato não muda).
**Pra o arquiteto (contrato `meta-v1.md`):** §3.2 lista de campos → trocar `video_3_sec_watched_actions` por `video_continuous_2_sec_watched_actions` e tirar o "campo a confirmar"; §3.2/§5 `hookRate = plays3s/impressions` → definir como **2-s continuous plays / impressions** (`plays3s` → `plays2s` já feito no `MetaMetrics`); §11 sonda → campos de insights já confirmados.
**Obs.:** o processo em `:3001` (`node dist/main.js`) começou às 20:32 de 21/10, antes do último build do `dist/` (20:39) — ele só pega este ajuste depois de reiniciar (não reiniciei).

## Campaigns v1 (I4, 22/10) — `docs/contratos/campanhas-v1.md`
Métodos novos **obrigatórios** na porta (o `?` saiu): `readObject`, `setDailyBudget`, `objectUrl`, `usage`. Arquivos: `campanhas.ts` (leitura ao vivo, `daily_budget`, links), `leitura.ts` (sync estendido), `vencedor.ts` (`scoreAllAds`).
- **`syncAds`** devolve também `campaigns`, `adsets`, `truncated` e `ads` de **todos os formatos** com `status` (configurado). Etapas: `listing_campaigns` → `listing_adsets` → `listing_ads` → `reading_insights` (3 janelas × 3 níveis = **9 leituras**, por nível, D3) → `scoring`. Arquivados/apagados ficam fora. `truncated` = algum nível passou de `maxAds` (500). O `paginate` encolhe o `limit` sozinho se a Graph pedir menos dados (code 1).
- **Veredito (D2):** mediana e "1-2 elegíveis = WINNER" só dos **vídeos** (`videoId != null`); imagem julgada contra a mesma régua. `medianCpa` continua só de vídeo. Filtrar `videoId != null` dá exatamente o resultado de antes.
- **Campanha/conjunto:** orçamento em centavos (`"0"`/ausente = `null`); `frequency` presente nas 3 janelas (reach por nível, não soma); `learningStage` = `learning_stage_info.status`.
- **`readObject({ level, id })`**: ao vivo, com pais (`campaign`, `adset`). Objeto apagado (Graph 100/33, 803, "does not exist", ou `effective_status` ARCHIVED/DELETED) = `META_OBJECT_GONE` (action `refresh`). Sem permissão continua `META_PERMISSION`.
- **`setDailyBudget({ level, id, dailyBudgetMinor })`**: `POST /{id} daily_budget`. A Meta recusando por nível/tipo (CBO no conjunto, vitalício, "Advantage campaign budget") = `META_BUDGET_NOT_EDITABLE`; mínimo = `META_BUDGET_TOO_LOW`. Valor não inteiro/≤ 0 nem sai (`META_ERROR`).
- **`setStatus`** (já existia) serve as 3 escritas de status, 1 id por chamada.
- **`objectUrl(act, level, id)`**: link do Ads Manager por nível; `usage()`: último BUC/app usage `{ pct, regainSec, at }` (null antes da 1ª chamada).
- **Fica com o backend (regras de produto):** `expected*` → `META_OBJECT_CHANGED`, pai pausado → `META_PARENT_PAUSED`, teto 2× → `META_BUDGET_STEP_TOO_LARGE`, throttle 20/min, BUC ≥ 90 %, `MetaChange`. Os 5 códigos novos existem no `MetaErrorCode` (`erros.ts`, com frase EN e `META_WRITE_ERROR_ACTION`).
- **Escrita real NUNCA rodada** (regra do Gusta): validado só com fetch falso. A 1ª escrita real é o Q4, com ok.

### Mock (§6)
3 campanhas: `mock_cmp_cbo` (CBO, US$ 50/dia; conjuntos `mock_adset_cbo_1` e `mock_adset_cbo_2` em `LEARNING`), `mock_cmp_abo` (ABO: `mock_adset_abo_1` US$ 20, `mock_adset_abo_paused` **PAUSED** com `mock_ad_5` ativo dentro → `ADSET_PAUSED`, `mock_adset_abo_stale` com `[mock:stale]` no nome), `mock_cmp_life` (CBO **vitalício** US$ 300). Os 8 vídeos de sempre distribuídos + 2 imagens: `mock_ad_img_1` (`[mock:meta-rate]` no nome, WINNER pela régua de vídeo) e `mock_ad_img_2` (`[mock:meta-token]`). Os vencedores de vídeo continuam `mock_ad_1`/`mock_ad_2`. Escritas mudam o estado do `FakeMetaService` (leitura ao vivo e próximo sync refletem; pausar campanha → filhos `CAMPAIGN_PAUSED`).

**Escopo do estado mock (QA 23/10, bug B):** cada `exchangeCode` mock devolve um token próprio `mock.<hex>` (`mock` puro segue válido), e o estado das escritas é por **token + conta de anúncio** (`FakeMetaService.scope`). Como `readObject`/`setStatus`/`setDailyBudget` não recebem a conta, vale a última conta vista por aquele token (`syncAds`, publicação, `readAdAccount`; padrão `act_mock_1`). O que um workspace pausa, muda ou publica nunca aparece na leitura ao vivo nem no sync de outro (antes vazava e dava 409 `META_OBJECT_CHANGED`). Estado só em memória: reiniciar a API ou reconectar zera.

**Publicação no snapshot (QA 23/10, bug E):** `createCampaign`/`createAdSet`/`createAd` gravam a estrutura no escopo (nome = `adName`, tudo `PAUSED`, conjunto ABO com o `dailyBudgetMinor` da publicação, anúncio com o `videoId` enviado, métricas zeradas → `LOW_DATA`, fora da mediana). O próximo `syncAds` devolve campanha/conjunto/anúncio com os mesmos ids que o backend gravou na `MetaPublication` (é daí que sai o selo HookMill e o `origin=hookmill`) e os nomes que o History usa nos `alsoChangedRefs`. `activate` liga os 3; a Campaigns lê, pausa e muda o orçamento deles como dos fixos; `objectUrl` = `#`. Retry com o mesmo `adName` não duplica.
| gatilho | resultado na integração |
|---|---|
| `readObject('ad', 'mock_ad_5')` | `adset.status PAUSED` (o backend responde `META_PARENT_PAUSED`) |
| `readObject` do `[mock:stale]` | status invertido e orçamento +700 vs snapshot (backend → `META_OBJECT_CHANGED`) |
| `setStatus(['mock_ad_7'], ACTIVE)` (DISAPPROVED) | `META_POLICY` |
| `setDailyBudget` em conjunto de `mock_cmp_cbo` / em `mock_cmp_life` | `META_BUDGET_NOT_EDITABLE { budgetLevel, kind }` |
| `setDailyBudget < 500` | `META_BUDGET_TOO_LOW { minimumMinor: 500 }` |
| qualquer chamada em `mock_ad_img_1` / `mock_ad_img_2` | `META_UNAVAILABLE { reason: rate_limited }` / `META_TOKEN_INVALID` |
| id fora da estrutura do escopo em `readObject`/`setDailyBudget` | `META_OBJECT_GONE` (id de publicação que o escopo não conhece, ex. de antes de reiniciar a API, segue aceito no `setStatus`) |
`> 2×` e 21ª escrita/min são regras do backend (não há gatilho na integração).

## meta-templates-v2 (I1/I2/I3, 03/11) — `docs/contratos/meta-templates-v2.md`
**Nada validado na Graph de verdade** (P3 adiada pelo Gusta em 03/11): corpos, listas e campos de leitura só com fetch falso e mock. Riscos 1, 2 e 8 do §12 seguem abertos.

### Porta (I1, `contrato.ts`)
| método | rota | devolve | lança |
|---|---|---|---|
| `listInstagramAccounts(auth, { adAccountId, pageId })` | `GET /meta/instagram-accounts` | `MetaInstagramAccountsResponse` (PAGE primeiro, depois username; sem repetir id). `pageId` null = `no_page`; Meta negou a Página = `unavailable` | `META_TOKEN_INVALID` (só do token do usuário), `META_PERMISSION` (conta), `META_UNAVAILABLE`/`META_RATE_LIMITED` |
| `listCustomAudiences(auth, { adAccountId })` | `GET /meta/custom-audiences` | `MetaCustomAudiencesResponse` (≤ 500, `updatedAt` desc, `truncated`) | idem |
| `listLocales(auth)` | `GET /meta/locales` | `MetaLocalesResponse` (`name` asc, `locale=en_US`) | idem |
- `MetaPublishStructure` ganhou (opcionais; ausente = corpo v1 idêntico, conferido por snapshot): `budgetType`, `lifetimeBudgetMinor`, `startTime`, `endTime` (ISO UTC), `optimizationGoal`, `locales`, `customAudienceIds`, `excludedCustomAudienceIds`, `instagramUserId`. A integração lê da `structure` e, se a chave não vier lá, do `settings` (os mesmos nomes do `MetaPublishSettings`). A `structure` ganha quando os dois vêm.
- `MetaTemplateSourceRead` ganhou `campaign.buyingType`, `adset.destinationType`, `ad.creative.instagramUserId` e **`ad.creative.format`** (`VIDEO | LINK | ASSET_FEED | CAROUSEL | null`, a mais do contrato: é o que deixa o B1 pôr `asset_feed_spec`/`child_attachments` no `unsupported` do §7 sem reler o criativo cru).
- `instagram_actor_id` não é lido nem escrito (saiu da referência; não é o mesmo id).

### Live (I2)
- `publicacao.ts`: `campaignBody`/`adSetBody(i, campaignId, now)`/`creativeBody` montam o §6. `optimizationForV2` (Awareness = `promoted_object { page_id }`, Engagement = `destination_type` ON_VIDEO/ON_POST; meta fora da tabela = `META_ERROR`). LIFETIME sem total ou sem fim = `META_ERROR` antes de chamar a Graph. `start_time` só se futuro (`now` do serviço); horários no formato `2026-11-10T14:00:00+0000`.
- `META_BUDGET_TOO_LOW` com LIFETIME: `details = { minimumMinor: mínimo diário × dias, currency, budgetType: 'LIFETIME', days }`, dias = teto((fim − max(início, agora)) / 24 h). DAILY igual v1.
- `templates.ts`: `TEMPLATE_FIELDS` + `buying_type`, `destination_type`, `creative{…instagram_user_id…}`. Se a v25 recusar algum (não sondado), o import cai em `META_ERROR (#100)`.
- `listas.ts` (novo): Instagram = `act/instagram_accounts` (token do usuário) + `{page}?fields=access_token` → `{page}/instagram_accounts` com o token DA PÁGINA. Negado (`META_PERMISSION`/`META_ERROR`, ou 190 com o token da Página) = `unavailable`; 190 do token do usuário sobe. Públicos: `act/customaudiences` (campos do §2.6), `usable` = delivery < 300 e operation ≠ 471, tamanho −1 = null, `time_updated` (s) → ISO; cache 5 min por conta + hash do token (`LiveMetaService.listas`). Idiomas: `search?type=adlocale&q=&limit=1000&locale=en_US`, sem chave repetida, cache 24 h por versão da Graph; lista vazia não vai pro cache.

### Mock (I3, `META_MODE=mock`) — fixtures exportados (`MOCK_IG_ACCOUNTS`, `MOCK_CUSTOM_AUDIENCES(_RAW)`, `MOCK_LOCALES`, `MOCK_GONE_IDS`) pro MSW copiar
| onde | gatilho | efeito |
|---|---|---|
| `listInstagramAccounts` | `act_mock_1` (+ `page_mock`) | `ig_mock_page` @mock.page (PAGE) + `ig_mock_1` @hookmill.demo (AD_ACCOUNT), `ok`; sem Página = só `ig_mock_1`, `no_page` |
| `listInstagramAccounts` | `act_mock_2` | `[]`, `unavailable` |
| `listCustomAudiences` | — | `ca_mock_buyers` (WEBSITE 12–15 mil), `ca_mock_lal_1` (LOOKALIKE 1,2–1,4 M), `ca_mock_small` (usable false, "Audience too small"), `ca_mock_flagged` (usable false, operation 471); `truncated:false` |
| `listLocales` | — | 8 fixos: 6 English (US) e 24 English (UK) confirmados; 1001, 9, 5, 16, 31, 23 ilustrativos |
| envio | `ig_mock_gone` / `ca_mock_gone` no template | não aparecem nas listas (o backend responde 400 `notAvailable`) |
| `createAdSet` | `[mock:meta-destination]` no `primaryText` | `META_ERROR` "destination_type not available for this account" |
| `createAdSet` | LIFETIME com total < 500 × dias | `META_BUDGET_TOO_LOW { minimumMinor: total, currency, budgetType, days }` |
| `readTemplateSource` | `mock_cmp_cbo` / `mock_adset_cbo_1` | públicos `ca_mock_lal_1` (incluir) e `ca_mock_buyers` (excluir), `locales [6]`, início −3 d e fim +4 d (→ 7 dias), `destinationType WEBSITE`; + `flexible_spec` (1 interesse) e `geo_locations.cities` (1 cidade) pro `unsupported` |
| `readTemplateSource` | `mock_cmp_life` | campanha CBO total 30000; `mock_adset_life_1` com início −10 d e fim +20 d |
| `readTemplateSource` | `mock_cmp_awareness` (novo) | OUTCOME_AWARENESS, CBO 3000/dia, `mock_adset_awareness_1` REACH, `mock_ad_awareness` com `instagramUserId: ig_mock_1` |
- **A Awareness é SÓ pra importar** (`MOCK_IMPORT_ONLY`): `readTemplateSource` acha `mock_cmp_awareness`/`mock_adset_awareness_1`/`mock_ad_awareness` em qualquer nível, mas eles ficam fora do sync e da leitura ao vivo (as contagens 3 campanhas / 6 conjuntos / 10 anúncios dos specs do backend e do QA não mudam). Consequência: o import-picker da tela (que lista o snapshot) não mostra a Awareness; o Q1 importa pela API (`POST /meta/templates/import { level: 'campaign', id: 'mock_cmp_awareness' }`). `mock_adset_life_1` passa a ter `startTime`/`endTime` e `optimizationGoal LINK_CLICKS` no sync.
- `createCampaign`/`createAdSet` gravam no escopo diário × total, meta e agendamento: o sync, a leitura ao vivo e o `setDailyBudget` (total = `META_BUDGET_NOT_EDITABLE`) refletem.

## meta-oferta-v1 (B1/B2, 05/11) — `docs/contratos/meta-oferta-v1.md` §2
### Porta (`contrato.ts`)
- `MetaAdSnapshotDraft += destinationUrls: string[]; destinationSource: MetaDestinationSource | null; urlTags: string | null` (null = não lido, relido no próximo sync).
- `MetaSyncInput += knownCreativeLinks?: Record<metaCreativeId, MetaKnownCreativeLink>`: cache montado pelo `sync.service` a partir dos snapshots atuais da mesma conexão/conta com `destinationSource != null`.

### Live (`leitura.ts`)
- `fillStoryVideoIds` saiu. No lugar, `readCreativeLinks`: **um** `GET /{creative_id}?fields=LINK_FIELDS` por criativo traz o link e o `video_id` juntos, **depois** dos insights (conta dentro de `reading_insights`), em ordem de gasto 30 d decrescente, `LINK_LOOKUP_MAX = 250`, `LINK_LOOKUP_PARALLEL = 5`, `retries: 0`. Falha num criativo = sem entrada (`destinationSource null`), não derruba o sync.
- Entra no lookup: criativo fora do cache **e** criativo no cache que ainda precisa do `video_id` (sem `video_id` na listagem e `object_type` VIDEO/ausente). Motivo: o cache do contrato não guarda o `video_id`; sem relê-lo, o anúncio deixaria de ser vídeo. O custo é o mesmo de antes (o `fillStoryVideoIds` relia esses a cada sync). Pro arquiteto: pôr `videoId` no cache zera essas chamadas.
- `linksOfCreative`: ordem `video_cta → story_link → template → asset_feed` (até 5 do asset_feed); sem link: `lead_form` (`lead_gen_form_id`), `messaging` (wa.me, api.whatsapp.com, m.me, messenger.com, ig.me ou CTA MESSAGE_PAGE/WHATSAPP_MESSAGE), `existing_post` (sem `object_story_spec` nem `asset_feed_spec`), `none`. URL > 2048 é ignorada; `url_tags` ≤ 1024.
- Encurtadores (`SHORTENERS`, lista fechada do §2.3): `resolveShortener` faz `HEAD` com `redirect: 'manual'`, lê só o `Location`, para no 1º host fora da lista, ≤ 3 saltos, 3 s por salto, ≤ 50 por sync, só dos links novos. Falhou = guarda o link encurtado. `syncAds(..., opts.fetchImpl)` pra teste.

### Sonda S1 (PENDENTE: precisa de sync real na conta do Gusta, autorizado só leitura; nada rodou contra a Meta)
Conferir: (a) o `fields` com sub-seleção não reacende o code 1 no lookup individual; (b) `asset_feed_spec{link_urls{website_url}}` vem com o token do usuário; (c) `call_to_action.value.link` do vídeo = o link do Gerenciador. Se (a) falhar: pedir só `object_story_spec{link_data{link},video_data{video_id,call_to_action}}` e o `asset_feed_spec` numa 2ª chamada. Anotar o resultado aqui.

### Mock (`MOCK_AD_LINKS`)
Os casos do §3.7 com X = "Spy Gram" (`spygram.app/quiz` + Kiwify `Ab12`) e Y = "Zap Spy" (`zapspy.com.br`): `mock_ad_1` casa (UTM), `_2` prefixo, `_3` Kiwify Ab12, `_4` site estrangeiro, `_5` post existente, `_6` formulário, `_7` Kiwify de outro, `img_1` site de Y (`/promo`), `img_2` conversa, `novideo` só o domínio (`lp.spygram.app`). Publicados pelo HookMill = `none` (casam pela regra 3).
