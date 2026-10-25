# API HTTP (contrato v1)
Data: 2026-10-05 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta (G0, 05/10)**
Derivado da spec [`design/wizard-v1-2026-10-05.md`](../../design/wizard-v1-2026-10-05.md) (§8) e do [modelo de dados](modelo-de-dados.md). Eventos em tempo real: [`eventos.md`](eventos.md).

## Mudanças 25/10 (estático montado + molduras; detalhe em [`estatico-montado-e-molduras-v1.md`](estatico-montado-e-molduras-v1.md)) · **aprovado pelo Gusta 25/10**
- **Rotas que mudam:** `PATCH /workspace` aceita `brandColor: string | null` (`#RGB`/`#RRGGBB`; inválido = 400 `VALIDATION_ERROR`); `GET /workspace` devolve `brandColor`. `POST /iterate/pieces/:pieceId/formats` de moldura sem o formato = 409 `INVALID_STATE` `reason: 'format_not_supported'`. `POST /iterate/pieces/:pieceId/retry` aceita também STATIC `ready` com `textCheck.status = 'mismatch'` (`202`, cobra `staticImageUsd`, teto `SPEND_CAP_EXCEEDED`); tirar/devolver peça `ready` do zip = `PATCH /iterate/pieces/:pieceId { inZip }` (sem rota `put-back`). Retry e formato sob demanda rodam com `priority: 10` e não voltam o `phase` (derivado só dos 9:16 do Gerar): a tela de Download continua. 409 do teto = `{ spentUsd, capUsd, estimateUsd }` (teto mensal). `textCheck.items` = todos os textos conferidos, com `match`. Detalhe no §A10 do contrato.
- **Respostas (TRANSIÇÃO, opcionais):** `IteratePiece.frame` (`PieceFrame`: template, 2ª fonte, proveniência do b-roll, `canSwapBroll`), `textCheck` (`StaticTextCheck` com `items[].key` e `extraText`), `suggestedPrimaryText` (read_caption), `render.stage`/`render.attempt`; `PieceFormat.supported`/`textCheck`; `retryHint` + `'leave_out'`. Erros assíncronos: `FRAME_TEXT_OVERFLOW`, `BROLL_UNAVAILABLE`.
- **Rotas novas (fase B2, §B3.1):** `GET /iterate/pieces/:pieceId/broll/candidates` → `BrollCandidatesResponse`; `POST /iterate/pieces/:pieceId/broll { candidateId? }` → `202 IteratePiece` (troca o clipe e re-renderiza, grátis). Só FRAME de 2 fontes com `stock_broll`; outro = 409 `INVALID_STATE`. OWNER, ADMIN, MEMBER; CLIENT 403.

## Mudanças 23/10 (variação AUTO: só 9:16 no lote + STATIC no GPT Image 2; detalhe em [`variacao-auto-v1.md` §14](variacao-auto-v1.md)) · **decisões do Gusta 23/10**
- **Rota nova:** `POST /iterate/pieces/:pieceId/formats { format: '4x5'|'1x1' }` → `202 IteratePiece` (enfileirou, na frente do lote) ou `200` (já na fila/rodando/pronto). Só peça `ready`; `failed` = refaz. Erros: 400, 404, 409 `INVALID_STATE`, 409 `SPEND_CAP_EXCEEDED` (só STATIC), 403 CLIENT. OWNER, ADMIN, MEMBER.
- **Rotas que mudam:** `POST /iterate/:id/start { expectedPieces, expectedCostUsd }` (custo das imagens do STATIC; 409 `ESTIMATE_CHANGED`/`SPEND_CAP_EXCEEDED`); `POST /iterate/pieces/:pieceId/retry` de STATIC checa o teto; `GET /creatives/:id/download?format=` de formato não pronto = 409 `INVALID_STATE` `reason: 'format_not_ready'`.
- **Respostas:** `IteratePiece` + `formats: PieceFormat[]` (os 3, `none|queued|rendering|ready|failed`, `requestUsd`), `media`, `retryUsd`; `IterateBatch.cost` + `generateEstimateUsd`, `imagesUsd` (`totalUsd` = análise + imagens); `IterateConfig.staticImageUsd`. Erros assíncronos da peça/formato: `SAFETY_BLOCK`, `DOWNLOAD_INVALID`.

## Mudanças 22/10 (Brain 3D v1; detalhe em [`brain-3d-v1.md`](brain-3d-v1.md)) · **aprovado pelo Gusta 22/10**
- **Rotas novas (módulo `brain`, `api/src/brain/`; tipos em `contratos/src/brain.ts`):**

| rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /brain/graph` | `BrainGraphQuery` (`?offerId=`, `?fresh=1`) | `BrainGraph` (`nodes` com `kind`/`category`/`winner`, `edges { from, to, kind, publication? }`, `counts` `total`/`shown` por kind, `meta { enabled, connected, lastSyncAt }`, `truncated`, `generatedAt`). Teto 800 nós / 2 500 arestas, amostragem por prioridade (brain-3d-v1 §1.3); cache em memória 60 s. `META_MODE=off` = 200 sem nós Meta (não é 503) | 400 `VALIDATION_ERROR`; 404 (offerId de outro workspace ou arquivada) | web `/brain`, tour (parada `brain`). Todos, inclusive CLIENT (`@ClientAllowed`) |
| `GET /brain/node/:id` | `id` = `<kind>:<chave>` (brain-3d-v1 §2.1), URL-encoded | `BrainNodeDetail` (`node`, `fields`, `neighbors` ≤ 50, `media { videoUrl, posterUrl }` assinadas, `open`) | 400 `VALIDATION_ERROR` (kind ou formato); 404 (inexistente, outro workspace, arquivado, `meta_ad` com `META_MODE=off`/sem conexão) | drawer do Brain. Todos, inclusive CLIENT |

- **Sem erro novo, sem migração.** O % do Brain continua no web (`brainCompleteness`, fase2 D5); o grafo não manda `completeness`. Publicação é aresta (`published_as`), vencedor é `node.winner`, gancho é derivado (sem entidade).

## Mudanças 22/10 (Campaigns v1; detalhe em [`campanhas-v1.md`](campanhas-v1.md)) · **aprovado pelo Gusta 22/10**
- **Rotas novas (módulo `meta`; tipos em `contratos/src/campanhas.ts`):** `GET /meta/campaigns` (`MetaCampaignRow[]` + `meta: MetaCampaignsMeta` com `totals`, `truncated`, `sync`; só snapshot) · `GET /meta/campaigns/:campaignId?period` (`MetaCampaignDetail`) · `POST /meta/{campaigns|adsets|ads}/:id/status` (`MetaStatusBody { status, expected, confirm: true, includeParents? }` → `MetaWriteResult`) · `PATCH /meta/{campaigns|adsets}/:id/budget` (`MetaBudgetBody { dailyBudgetMinor, expectedDailyBudgetMinor, confirm: true }` → `MetaWriteResult`) · `GET /meta/changes?level&objectId&limit&cursor` (`MetaChangeRow[]`).
- **Rotas que mudam:** `GET /meta/ads` aceita `status`, `origin`, `campaignId`, `adsetId`, `format` (**padrão `video`**), `period`, `dir`, `sort` + `results`/`name`; `MetaAdRow` ganha `status`, `fromHookMill`, `adsManagerUrl`, `canToggle`, `canIterate`; `MetaMetrics.reach` (campanha/conjunto). `POST /meta/sync`: checklist `listing_campaigns` → `listing_adsets` → `listing_ads` → `reading_insights` → `scoring`. `activate`/`pause` da tela Send passam a gravar `MetaChange` (`source PUBLISH`).
- **Erros novos:** `META_OBJECT_CHANGED` 409 `{ current }`, `META_OBJECT_GONE` 404, `META_PARENT_PAUSED` 409 `{ parents }`, `META_BUDGET_NOT_EDITABLE` 422 `{ budgetLevel, kind }`, `META_BUDGET_STEP_TOO_LARGE` 422 `{ maxMinor, currency }`. `Action` ganha `refresh`.
- **Papéis:** leituras (incl. `GET /meta/changes`) = todos, inclusive CLIENT (`@ClientAllowed`); escritas = **OWNER/ADMIN** (D5).
- **Ajustes do design 22/10 (campanhas-v1 §10, sem migração):** `MetaCampaignRow.matchedIn` (com `q`) e `anyAdsetLearning`; `meta.counts: MetaStatusCounts` em `GET /meta/campaigns` e `GET /meta/ads`; `MetaChangeRow.alsoChangedRefs` (nomes dos pais pelo snapshot).

## Mudanças 21/10 (Meta v1 + onboarding v2; detalhe em [`meta-v1.md`](meta-v1.md) e [`onboarding-v2.md`](onboarding-v2.md)) · **aprovado pelo Gusta 21/10**
- **Módulo `meta` (rotas novas; tipos em `contratos/src/meta.ts`):** `POST /meta/connect { returnTo? }` → `{ url }` (Facebook Login for Business) · `GET /meta/callback` *pública* (redirect pro web com `?meta=connected` ou `?meta=error&code=<MetaOAuthErrorCode>`) · `GET /meta/connection` (`MetaConnection | null`, nunca o token) · `GET /meta/options?adAccountId=` (`MetaOptions`, contas com `canManage`) · `PUT /meta/selection` · `POST /meta/health` (`MetaHealth` com níveis ok/warn/bad) · `DELETE /meta/connection` · `POST /meta/sync` (202 `{ job }`, `META_SYNC`) · `GET /meta/ads` (`MetaAdRow[]` com `verdict` WINNER/OK/LOW_DATA e `trend` WORKING/STEADY/TIRING + `meta.summary`) · `GET /meta/summary?period=7d|30d` (`MetaSummary` com `prev` e `sync`) · `GET /meta/publications` · `GET /creatives/:id/meta` (`CreativeMetaResponse` com defaults) · `POST /creatives/:id/meta/publish` (202 `MetaPublication`, `META_PUBLISH`, tudo PAUSED) · `…/meta/retry` · `…/meta/activate { confirm: true }` (OWNER/ADMIN) · `…/meta/pause`.
- **Rotas que mudam:** `POST /iterate` aceita `{ metaAdId }` (exatamente um de `uploadId`/`creativeId`/`metaAdId`; único caminho do "Pick from Meta", D13); `IterateBatch.source.fromMeta`; `ChampionRow.sources` ganha `'META'` e `ChampionDetail.metaAd`; `GET /workspace/services` lista `META`; `PATCH /auth/me { accountMode }`; `POST /auth/signup { accountMode? }`; `GET /auth/me`/login/refresh/switch devolvem `user.accountMode` e, em `workspace` e cada `workspaces[]`, `status` + `onboarding: { step, percent, completedAt }` (só o ativo tem `tourCompletedAt`); `GET /workspace`/`GET /workspaces`: `onboarding` ganha `percent`, `steps[]` (com `enabled`; 5 passos quando `META_MODE=off`) e `updatedBy`/`updatedAt`; rotas novas `GET /workspace/tour` e `POST /workspace/tour/complete` (ambas `@ClientAllowed`).
- **Erros novos (§1):** síncronos `META_NOT_CONFIGURED` 503 `{ reason }`, `META_NOT_CONNECTED` 422, `META_SELECTION_MISSING` 422 `{ missing }`, `META_TOKEN_INVALID` 422, `META_PERMISSION` 422 `{ adAccountId?, reason, scope? }`, `META_PIXEL_REQUIRED` 422 `{ objective }`, `META_ACCOUNT_UNUSABLE` 422 `{ accountStatus, label }`, `META_BUDGET_TOO_LOW` 422 `{ minimumMinor, currency }`, `META_UNAVAILABLE` 503 `{ reason: 'rate_limited'|'down', retryAfterSec }`; `INVALID_STATE.reason` + `not_approved`, `publish_in_progress`, `sync_in_progress`. OAuth (query do redirect): `META_OAUTH_DENIED`, `META_SCOPES_MISSING` (+`missing=`), `META_OAUTH_FAILED`, `META_STATE_INVALID`, `META_UNAVAILABLE`. Assíncronos (job): `META_TOKEN_INVALID`, `META_PERMISSION`, `META_ACCOUNT_UNUSABLE`, `META_PAYMENT_REQUIRED`, `META_POLICY`, `META_BUDGET_TOO_LOW`, `META_VIDEO_REJECTED`, `META_VIDEO_UNAVAILABLE`, `META_RATE_LIMITED`, `META_ERROR`. `Action` ganha `reconnect_meta`, `choose_account`, `fix_payment`, `edit_ad_text`, `raise_budget`. `JobType` ganha `META_SYNC`, `META_IMPORT`, `META_PUBLISH` (checklists em `job.presenter.ts`).
- **Papéis:** conectar/opções/seleção/desconectar = OWNER/ADMIN; sync, Pick from Meta e publicar (pausado) = OWNER/ADMIN/MEMBER; **ativar/pausar = OWNER/ADMIN** (D11); CLIENT só `GET` (nenhuma rota de escrita da Meta leva `@ClientAllowed`). Tour: todos, inclusive CLIENT.
- **Mock (§17):** `META_MODE=mock` (padrão) com os gatilhos do meta-v1 §8 (`[mock:meta-policy]`, `[mock:meta-payment]`, `[mock:meta-token]`, `[mock:meta-rate]`, `[mock:meta-error]`, `[mock:meta-slow]`, `metaAdId mock_ad_novideo`, callback `?code=mock-denied|mock-scopes|mock-failed`, conta `act_mock_3` sem permissão).

## Mudanças 13/10 (variação automática de campeão v1; detalhe em [`variacao-auto-v1.md`](variacao-auto-v1.md)) · **aprovado pelo Gusta 13/10**
- **Rotas novas** (módulo `iteracao`; tipos em `contratos/src/iteracao.ts`): `GET /iterate/config` · `POST /iterate { uploadId?|creativeId?, offerId? }` (202, a análise começa sozinha) · `GET /iterate/:id` (`IterateBatch`) · `POST /iterate/:id/retry` · `POST /iterate/:id/start { expectedPieces }` · `POST /iterate/:id/zip` (`@ClientAllowed`) · `POST /iterate/pieces/:pieceId/retry { useProductPhoto? }` · `POST /iterate/pieces/:pieceId/leave-out` · `PATCH /iterate/pieces/:pieceId { inZip }` (`@ClientAllowed`). D4: `PUT /offers/:id/product-image { uploadId }` e `DELETE /offers/:id/product-image`; `POST /uploads` aceita `purpose: 'PRODUCT_IMAGE'` (jpeg/png/webp, ≤ 10 MB); `Offer` ganha `productImage: FileRef|null`.
- **Rotas que mudam:** `GET /creatives/:id/download?format=9x16|4x5|1x1`; `GET /library` aceita `&variationCode=` e `&media=video`, `LibraryItem` ganha `media` e `formats`; `VariationRef` ganha `code` e `axis`; `meta.waitingBatches` inclui lotes AUTO (`ANALYSIS_FAILED`, `PIECES_READY`, `mode`, `readyCount`); criativo `AUTO_EDIT` não entra no `counts.needs_you` e é travado (`variation_locked`) em generate/scripts/engine/edit/editor/changes.
- **Erros novos:** `422 OFFER_REQUIRED { offers }`, `409 PLAN_CHANGED { pieces }`, `422 NO_PRODUCT_PHOTO`; `INVALID_STATE` aceita `reason` `not_a_video`, `upload_another`, `nothing_to_zip`. Assíncronos: `PLAN_INVALID`, `PAGE_TIMEOUT`, `SOURCE_UNAVAILABLE` (somam a `MEDIA_*`, `PAGE_*`, `RENDER_ERROR`, `PROVIDER_*`, `INTERRUPTED`).
- **Limites do upload** (env): 500 MB, 4 s a 3 min (`MEDIA_TOO_SHORT`/`MEDIA_TOO_LONG` passam a usar esses números). O `complete` devolve `analysisEstimateUsd` já com o plano do lote AUTO.
- Telas Pick a winner/Breakdown/Plan/Batch saem da navegação do web; as rotas `/champions` e `/variation-batches` (lote `MANUAL`) continuam iguais.

## Mudanças 08/10 (Trocar avatar com motor Kling/Seedance; detalhe em [`feature-2-variar-campeao.md` §13.15](feature-2-variar-campeao.md)) · **proposto, aguarda ok do Gusta**
- Lote: `settings.swapEngine: 'LIPSYNC'|'KLING'|'SEEDANCE'` (padrão LIPSYNC) e `settings.voiceSource` aceita `'ENGINE_VOICE'`. Combinação inválida = `400 VALIDATION_ERROR` (`engine_voice_needs_video_engine`, `video_engine_needs_keep_edit`, `catalog_voice_not_in_keep_edit`, `engine_voice_seedance_only` = KLING + ENGINE_VOICE, decisão do Gusta; `engine_voice_not_enabled` = SEEDANCE + ENGINE_VOICE até a cadeia (B) ser liberada). Em `swapQuotes` essas combinações saem `notEnabled: true` + `disabledReason` (a mesma `rule`); `changeOptions[].sceneLabel?` = trecho do `SCENE` em criativo `SWAP_VIDEO`; `ENGINE_VOICE` com bloqueio = `422 KEEP_EDIT_UNSUPPORTED`.
- `GET /champions/:id` + `engineVoice: KeepEditAvailability` (bloqueio novo `caption_unredrawable`). `GET /variation-batches/:id/estimate` + `swapQuotes: SwapQuote[] | null` (3 motores × áudio, preço lado a lado).
- Criativo com motor de vídeo: 1 cena `pipeline: 'SWAP_VIDEO'` por trecho main, `Scene.swap: SceneSwap`; regerar trecho exige `confirm` + `expectedCostUsd` (sem = `409 INVALID_STATE` `reason: 'regenerate_swap_scene'`). Erros de cena: `VOICE_FIT_OUT_OF_RANGE`, `SPEECH_MISMATCH`, `IDENTITY_DRIFT`.
- Tipos em `contratos/src/troca-motor.ts` (exportados pelo index só na janela de reinício da 3001).

## Mudanças 06/10 noite (manter a edição + take contínuo; detalhe em [`feature-2-variar-campeao.md` §13](feature-2-variar-campeao.md))
- `GET /champions/:id`: `teardown.editMap` + `keepEdit` por tipo (bloqueios com motivo); checklist do `CHAMPION_ANALYZE` ganha `mapping_edit` antes de `diagnosing`.
- Lote: `settings.keepEdit` (padrão true se disponível; com bloqueio = `422 KEEP_EDIT_UNSUPPORTED`) e `settings.hookMode: 'TEXT'` (único até a D6). NEW_HOOKS TEXT: item só edita `hook.onScreenText`, sem controle, criativo com 1 cena `SOURCE_CUT`.
- Lipsync = **1 take por criativo** (áudio inteiro numa chamada). `CreativeDetail.take`, `Scene.take`; `POST /creatives/:id/take/regenerate` `{ expectedCostUsd, note? }`; regerar cena `TAKE_SLICE` sem `confirm` + `expectedCostUsd` = `409 INVALID_STATE` `reason: 'regenerate_take'`. `changes` SCENE/LINE em lipsync custam o take inteiro (`changeOptions.estimateUsd`).
- Erros novos: `KEEP_EDIT_UNSUPPORTED` (422) e `LIPSYNC_AUDIO_TOO_LONG` (422 síncrono; também assíncrono no take). Criativo `remix-keep`: `PATCH /edit` = `409 variation_locked`.
> ⚠️ API dev da porta 3001 em MODO LIVE (Gusta testando com dinheiro): nenhum agente usa a 3001. Testes = API própria em mock; web = MSW ou API própria em outra porta.

## Mudanças 06/10 (feature 2 "variar campeão", aprovada pelo Gusta; detalhe e porquês em [`feature-2-variar-campeao.md`](feature-2-variar-campeao.md))
1. **Rotas novas:** uploads (§18), campeões (§19), lotes de variação (§20); gatilhos de mock em §17.
2. **`variation: VariationRef | null`** em `CreativeRow`/`CreativeDetail` e no item da Biblioteca (null no criativo do zero). Filtros novos: `GET /creatives?championId=&origin=scratch|variation`, `GET /library?championId=&variationKind=`.
3. **Criativo de variação** nasce em `SCENES_GENERATING` e não aceita `scripts/*` nem `PATCH engine` (`409 INVALID_STATE` com `details.reason: 'variation_locked'`); `POST /generate` só com os parâmetros do lote (§20, esclarecimento 5). `review.changeOptions` vem filtrado por tipo; pedido fora da lista = `409 INVALID_STATE` `reason: 'change_not_available'`.
4. **Erros novos** na tabela do §1; `INVALID_STATE.details` aceita `reason` e passa a valer pra criativo, campeão e lote (`state`/`allowed` como string).
5. `GET /templates`: `id` vira string livre do registro + `kind: 'scratch'|'remix'` (remix só depois do REMIX_EDIT).
6. **Rosto = Higgsfield Soul V2 desde 06/10:** `GET /workspace/services` lista `HIGGSFIELD` (e `APIFY`); `GET /workspace/spend` traz `HIGGSFIELD`/`APIFY` em `byProvider` e `SCRAPE` em `byKind`. `PROVIDER_UNAVAILABLE.provider` aceita `HIGGSFIELD`.
7. Nenhum tipo de variação é bloqueado pela declaração de dono do campeão (`rights` é só registro).

## Mudanças 05/10 (F3: miniatura da cena e clipes do lipsync)
- **`scenes[].thumbnail` vem preenchido em cena `READY`.** Quem gera é o **backend**, na ingestão do clipe (já roda ffmpeg pra validar): extrai um JPEG de um frame em ~1 s (nunca o frame 0, que no Pruna é a própria imagem do rosto; clipe < 2 s → meio do clipe), sobe como `File` kind `THUMBNAIL` e grava em `scenes.thumbnail_file_id` (migração `20261005210000_scene_thumbnail`). Antes de `READY`, `thumbnail` é null.
- **LIPSYNC = um clipe por bloco do roteiro, até 30 s** (`GET /engines` passa a dizer `maxSceneSec: 30` pro `pruna-lipsync`; bloco acima de 30 s vira 2+ clipes). Num roteiro típico de 25-30 s, isso dá 3-5 clipes, não 1: o mockup muda o texto, o web só mostra o `sceneCount` da API. Motivo: custo igual (o Pruna cobra por segundo de áudio; a diferença é o arredondamento, < US$ 0,10 por criativo); cada clipe recomeça da imagem do rosto, o que corta a deriva/troca de pessoa que a operação viu a partir do 2º-4º segundo; e "Refazer uma cena"/"Reescrever uma fala" regeram só aquele bloco, sem pagar o vídeo todo. O corte entre blocos é corte seco de talking head, normal em anúncio. SCENES (Kling/Seedance) continua com 15 s.

## Mudanças 05/10 (chips e pedido de ajuste)
- **`statusKey` oficial:** `status.<state em minúsculas>` (15) + `status.draft`, com `statusParams` por chave (tabela em §3; tipo `StatusParamsByKey` no `@maquina/contratos`). Vem da API em `CreativeRow`/`CreativeDetail` (Home, cards e trilho) e no SSE `creative.updated`.
- **"Reescrever uma fala" (change `LINE`) volta pra Geração** (`returnTo: 'generation'`), não pra Roteiros: a fala nova vai direto pra cena e só ela é regerada. O mockup estava errado neste ponto.

## Mudanças 05/10 (revisão da onda 2)
1. `POST /creatives/:id/generate` também vale em `SCENES_FAILED`, `EDIT_PENDING`, `RENDER_FAILED` e `RENDER_READY`, sempre com `confirm: true` (sem ele: 409 `CONFIRM_DOWNSTREAM_RESET`).
2. Submissão recusada pelo provedor (fora do ar, 5xx, chave ausente/inválida, `NOT_CONFIGURED` no live sem chave): se **nenhum** item do pedido foi submetido, os itens ficam `FAILED` (`PROVIDER_ERROR`) e a rota responde **503 `PROVIDER_UNAVAILABLE`** `{ provider }`; se parte foi, responde 202 e os que falharam aparecem `FAILED`. Bloqueio de conteúdo na submissão **não** é 503: vira item `FAILED` com `SAFETY_BLOCK`, igual a uma falha vinda do webhook.
3. Em `NODE_ENV=test`, os limites `default` (600/min) e `expensive` (20/min) sobem 100x se a env não estiver definida; login não muda.
4. `progress` é sempre inteiro 0-100.
5. Rota pública nova: `GET /templates/:id/thumbnail` (imagem estática do template, igual pra todos); é a `thumbnail.url` de `GET /templates`.

## Mudanças 05/10 (fechamento da onda 1)
1. **Tipos em código:** o contrato agora também existe como pacote `@maquina/contratos` (`contratos/src/index.ts`, só tipos). web, api (DTO `implements <Body>`) e testes importam dele. Sai o `api:types` (geração do OpenAPI): o plugin do Swagger quebra o `nest build` com TS 5.9. Swagger em `/api/docs` continua opcional, sem plugin, só como documentação.
2. **Novo código `LAST_OWNER` (409)** pra rebaixar/remover o último OWNER (no lugar de `INVALID_STATE`).
3. **Sai `OFFER_LOCKED`:** `PATCH /creatives/:id` só aceita `name`; mandar `offerId` = `400 VALIDATION_ERROR` (campo fora do DTO).
4. **`inviteUrl` = `<primeira origem de WEB_ORIGIN>/invite/<token>`;** o web tem a rota `/invite/[token]`.
5. **Login:** 5 tentativas/min por **IP + e-mail** e 20/min por IP.
6. **Regerar cena com outras gerando é permitido**, desde que a cena alvo esteja `READY` ou `FAILED` (cena `QUEUED`/`GENERATING` = `409 INVALID_STATE`).
7. **`Face` ganha `errorCode` e `action`** (o `SAFETY_BLOCK` do Avatar precisa deles); `Estimate.warnings` passa a vir sempre (lista vazia se nada).
8. **Gatilhos do modo mock oficializados** (§17) pro QA forçar falha, incluindo `[mock:RENDER_ERROR]` no headline/CTA (render).

> Mudança em relação à tabela da spec: as ações usam **barra** (`/scripts/generate`), não dois-pontos (`scripts:generate`), porque `:` é parâmetro de rota no Nest/Express. O resto segue a spec.

## 1. Convenções
- **Base:** `https://<api>/api/v1`. JSON UTF-8. Datas ISO 8601 UTC. Dinheiro em USD como número (`1.2345`). Durações em segundos (número).
- **Auth:** `Authorization: Bearer <accessToken>` em tudo, exceto rotas marcadas *pública*. O access token (JWT, 15 min) leva `sub` (userId), `wid` (workspace ativo) e `role`. O workspace **nunca** vem do corpo ou da URL: vem do token.
- **Envelope de sucesso** (mesmo padrão do modelhub):
  ```json
  { "success": true, "data": { … }, "meta": { "nextCursor": "…" } }
  ```
  `meta` só em listas paginadas.
- **Envelope de erro:**
  ```json
  { "success": false, "error": { "code": "SPEND_CAP_EXCEEDED", "message": "Monthly spend cap reached.", "statusCode": 409, "details": { … } } }
  ```
  O web traduz pelo `code` (i18n); `message` é fallback em inglês. `details` é opcional e tipado por código (abaixo).
- **Validação:** DTO com `class-validator`, `whitelist` + `forbidNonWhitelisted`. Campo a mais ou inválido = `400 VALIDATION_ERROR` com `details.fields: [{ field, rule }]`.
- **Paginação:** cursor. `?limit=` (1-100, padrão 30) e `?cursor=`; resposta traz `meta.nextCursor` (null no fim).
- **Assíncrono:** ação que dispara trabalho longo responde `202` com o recurso já no estado `QUEUED/WRITING/GENERATING`. O progresso chega por SSE do criativo ou por `GET /jobs/:id`.
- **URLs de arquivo** nas respostas são assinadas (validade 6 h). Expirou: `GET /files/:id` redireciona pra uma nova.
- **Idempotência de ação cara:** `POST /creatives/:id/generate`, `…/faces/generate`, `…/scenes/:index/regenerate` e `…/changes` só passam se o estado do criativo permitir (compare-and-set). Clique duplo recebe `409 INVALID_STATE`.

### Códigos de erro
| code | http | quando | `details` |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | DTO inválido | `{ fields: [{ field, rule }] }` |
| `UNAUTHORIZED` | 401 | sem token / token expirado | — |
| `INVALID_CREDENTIALS` | 401 | login errado | — |
| `REFRESH_INVALID` | 401 | refresh revogado/expirado | — |
| `FORBIDDEN` | 403 | papel sem permissão (ex.: MEMBER mudando teto) | — |
| `NOT_FOUND` | 404 | não existe **ou é de outro workspace** (nunca 403 aqui, pra não vazar existência) | — |
| `INVALID_STATE` | 409 | ação não permitida no estado atual (criativo, campeão ou lote) | `{ state, allowed: [<estado>], reason?: 'variation_locked'\|'change_not_available' }` |
| `CONFIRM_DOWNSTREAM_RESET` | 409 | mudança a montante descarta cenas/render | `{ scenesLost, rendersLost, spentUsd }` → reenviar com `confirm: true` |
| `OFFER_INCOMPLETE` | 422 | criar criativo de oferta sem `what`/`promise` | `{ missing: ["what"] }` |
| `SPEND_CAP_EXCEEDED` | 409 | gasto do mês + estimativa > teto | `{ spentUsd, capUsd, estimateUsd }` |
| `ESTIMATE_CHANGED` | 409 | custo calculado no Generate > `expectedCostUsd` × 1,10 | `{ estimateUsd }` |
| `INVITE_INVALID` | 410 | convite expirado/usado/revogado | — |
| `EMAIL_TAKEN` | 409 | convite pra e-mail já membro | — |
| `LAST_OWNER` | 409 | rebaixar ou remover o último OWNER do workspace | — |
| `RATE_LIMITED` | 429 | throttle (login: 5/min por IP+e-mail e 20/min por IP; ações caras: 20/min por workspace) | `{ retryAfterSec }` |
| `PROVIDER_UNAVAILABLE` | 503 | Anthropic/WaveSpeed/Higgsfield recusou a submissão na hora | `{ provider: 'ANTHROPIC'\|'WAVESPEED'\|'HIGGSFIELD' }` |
| `AD_LIBRARY_UNAVAILABLE` | 503 | campeão só com link e a Apify recusou na hora (teto, sem chave, fora do ar); nada é criado | `{ reason: 'quota'\|'not_configured'\|'provider_error', retryAfter }` |
| `MEDIA_TOO_LARGE` | 422 | upload acima do limite | `{ maxBytes }` |
| `MEDIA_TOO_SHORT` / `MEDIA_TOO_LONG` | 422 | duração fora de 5-120 s | `{ durationSec, minSec }` / `{ durationSec, maxSec }` |
| `MEDIA_INVALID` | 422 | mime, sem vídeo, não decodifica, pequeno demais | `{ reason: 'mime'\|'no_video'\|'undecodable'\|'too_small' }` |
| `UPLOAD_EXPIRED` | 410 | upload com mais de 30 min | — |
| `UPLOAD_INCOMPLETE` | 409 | objeto ausente ou de tamanho diferente do declarado | `{ expectedBytes, actualBytes }` |
| `NO_SPEECH` | 422 | tipo de variação que precisa de fala num campeão sem fala | `{ kind }` |
| `KIND_NOT_ENABLED` | 422 | tipo ainda fora do build (`COPY_NEW`, `REMIX_EDIT` até serem entregues) | `{ kind }` |
| `BATCH_INCOMPLETE` | 422 | launch sem rosto escolhido, item pronto ou voz | `{ missing: [...] }` |
| `INTERNAL_ERROR` | 500 | inesperado | — |

Falha **dentro** de um trabalho assíncrono não é erro HTTP: vira `status: FAILED` + `errorCode` + `failReason` (frase humana) + `action` sugerida no recurso (job, roteiro, rosto, cena, render). Códigos assíncronos: `PAGE_FORBIDDEN` (403 da página), `PAGE_UNREADABLE`, `RATE_LIMITED`, `SAFETY_BLOCK`, `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`, `DOWNLOAD_INVALID` (arquivo truncado após 3 tentativas), `INTERRUPTED` (API reiniciou), `RENDER_ERROR`; feature 2: `AD_LIBRARY_UNAVAILABLE`, `AD_NOT_FOUND`, `AD_HAS_NO_VIDEO`, `MEDIA_INVALID`. `Action` ganha `upload_video` e `analyze_again`.

### Tipos compartilhados (TypeScript; versão completa, com corpos de requisição e eventos SSE, em `@maquina/contratos`)
```ts
type CreativeState = 'SCRIPTS_WRITING'|'SCRIPTS_READY'|'SCRIPTS_FAILED'|'AVATAR_PENDING'|'FACES_GENERATING'|'FACES_READY'|'FACES_FAILED'|'ENGINE_PENDING'|'SCENES_GENERATING'|'SCENES_FAILED'|'EDIT_PENDING'|'RENDERING'|'RENDER_FAILED'|'RENDER_READY'|'APPROVED';
type Step = 'offer'|'scripts'|'avatar'|'engine'|'generation'|'edit'|'review';   // 'library' quando aprovado
type ChipStatus = 'progress'|'waiting'|'failed'|'approved'|'draft';
type Engine = 'SCENES'|'LIPSYNC';
type VideoFormat = 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';
type AssetStatus = 'QUEUED'|'GENERATING'|'READY'|'FAILED';
type Action = 'retry'|'regenerate'|'paste_page_text'|'fill_manually'|'change_description'|'render_again'|'contact_support'|'upload_video'|'analyze_again';

interface FileRef { id: string; url: string; mimeType: string; width?: number; height?: number; durationSec?: number }
interface UserRef { id: string; name: string; initials: string }
interface Progress { stage: string|null; progress: number; etaSec: number|null }   // stage = chave i18n

interface CreativeRow {                // linha da Home e card "Waiting on you"
  id: string; name: string;
  offer: { id: string; name: string };
  state: CreativeState; step: Step | 'library'; status: ChipStatus;
  statusKey: string;                   // chave i18n do texto do chip, ex. "status.scenes_generating"
  statusParams: Record<string, string|number>; // ex. { ready: 2, total: 4 }
  progress: number | null;             // 0-100 só quando status = progress
  engine: Engine | null; engineModel: string | null;
  thumbnail: FileRef | null;           // render final > rosto escolhido > null
  createdBy: UserRef; updatedAt: string;
  variation: { kind: VariationKind; championId: string; championName: string; batchId: string; lever: string|null; isControl: boolean } | null; // feature 2
}

interface OfferBrief {                 // todos texto livre
  kind: string|null; what: string|null; audience: string|null; promise: string|null;
  pains: string|null; proof: string|null; offerAndPrice: string|null; cta: string|null; notes: string|null;
}
interface Offer extends OfferBrief {
  id: string; name: string; language: string; sourceUrl: string|null;
  fieldSources: Partial<Record<keyof OfferBrief | 'name' | 'language', 'page'|'user'>>;
  creativesCount: number; winnersCount: number; updatedAt: string;
}

interface Job extends Progress {
  id: string; type: 'OFFER_EXTRACT'|'SCRIPTS_GENERATE'|'SCRIPT_REGENERATE'|'CHAMPION_RESOLVE'|'CHAMPION_ANALYZE'|'VARIATIONS_PLAN'|'VARIATION_ITEM_REGENERATE';
  status: 'QUEUED'|'RUNNING'|'SUCCEEDED'|'PARTIAL'|'FAILED';
  checklist: { key: string; done: boolean }[];   // ex. fetching_page, extracting, detecting_language
  errorCode: string|null; failReason: string|null; action: Action|null;
  output: unknown | null;              // OFFER_EXTRACT → { name, language, sourceUrl, brief: OfferBrief, fieldSources, relatedUrls? }
}

interface ScriptBlock { label: string; startSec: number; endSec: number; speech: string; visualPrompt: string }
interface Script {
  id: string; letter: string; status: 'WRITING'|'READY'|'FAILED';
  angle: string|null; rationale: string|null; durationSec: number|null;
  blocks: ScriptBlock[];               // blocks[0] = gancho
  editedByUser: boolean; selected: boolean;
  failReason: string|null;
}

interface Face { id: string; batch: number; position: number; status: AssetStatus; image: FileRef|null; failReason: string|null; errorCode: string|null; action: Action|null; selected: boolean }

interface Scene {
  id: string; index: number; label: string; startSec: number; endSec: number;
  speech: string; visualPrompt: string;
  status: AssetStatus; progress: number; attempt: number;
  failReason: string|null; errorCode: string|null; action: Action|null;
  clip: FileRef|null; thumbnail: FileRef|null;
}

interface EditSettings { templateId: string; captionStyle: 'word'|'line'|'off'; captionPosition: 'top'|'middle'|'bottom'; headline: string|null; ctaText: string; endCard: boolean }

interface Render {
  id: string; status: 'QUEUED'|'RENDERING'|'READY'|'FAILED';
  stage: string|null; progress: number; frame: number|null; totalFrames: number|null;
  failReason: string|null; failedFrame: number|null; action: Action|null;
  video: FileRef|null; durationSec: number|null; settings: EditSettings; createdAt: string;
}

interface StepInfo { step: Step; state: 'done'|'current'|'progress'|'failed'|'todo' }

interface CreativeDetail extends CreativeRow {
  language: string; format: VideoFormat; voiceId: string|null;
  steps: StepInfo[];                   // 7 itens, ordem do trilho
  summary: { scriptLetter: string|null; scriptDurationSec: number|null; face: FileRef|null; engineLabel: string|null };
  faceDescription: string|null;
  editSettings: EditSettings | null; editDirty: boolean;
  estimatedCostUsd: number|null; costUsd: number;   // custo real até agora
  finalRender: Render | null; approvedAt: string|null; isWinner: boolean;
  savedAt: string;                     // "Saved just now"
}
```

## 2. Auth (tela Login)
Sem cadastro aberto na v1: o primeiro OWNER nasce do seed (`npm run seed -w api`); os demais entram por convite.

| método e rota | entrada | saída | erros |
|---|---|---|---|
| `POST /auth/login` *pública* | `{ email, password }` | `{ accessToken, refreshToken, expiresIn: 900, user: { id, name, email, uiLocale }, workspace: { id, name, role } }` | 400, 401 `INVALID_CREDENTIALS`, 429 |
| `POST /auth/refresh` *pública* | `{ refreshToken }` | igual ao login (refresh rotativo: o antigo é revogado) | 401 `REFRESH_INVALID` |
| `POST /auth/logout` | `{ refreshToken }` | `{ ok: true }` | — |
| `GET /auth/me` | — | `{ user, workspace, workspaces: [{ id, name, role }] }` | 401 |
| `POST /auth/switch-workspace` | `{ workspaceId }` | igual ao login, com `wid` novo | 404 |
| `GET /auth/invites/:token` *pública* | — | `{ workspaceName, email, role }` | 410 `INVITE_INVALID` |
| `POST /auth/invites/:token/accept` *pública* | `{ name, password (≥10) }` (ou só `{}` se o e-mail já tem conta e o usuário está logado) | igual ao login | 400, 410 |
| `PATCH /auth/me` | `{ name?, uiLocale?: 'EN'\|'PT_BR', password?: { current, next } }` | `user` | 400, 401 |

Web guarda o refresh token em cookie httpOnly do próprio Next (rota `/api/session`), nunca em `localStorage`. Detalhe do frontend; a API só vê o header.

## 3. Home `/`
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives` | `?filter=all\|progress\|needs_you\|approved` `&q=` (busca no nome) `&offerId=` `&championId=` `&origin=scratch\|variation` `&limit` `&cursor` | `CreativeRow[]` ordenado por `updatedAt desc` + `meta.nextCursor` + `meta.counts: { all, progress, needs_you, approved }` | 400 |

Texto do chip: `statusKey` + `statusParams` (o web traduz pela chave; `status.draft` quando `status = draft`, senão `status.<state em minúsculas>`):
| statusKey | statusParams |
|---|---|
| `status.scripts_writing` | `{ ready, total }` (roteiros prontos ou falhos / total) |
| `status.faces_generating` | `{ ready, total }` (rostos do lote atual terminados / 4) |
| `status.scenes_generating` | `{ ready, total }` |
| `status.scenes_failed` | `{ failed, total }` |
| `status.rendering` | `{ progress }` (0-100) |
| `status.scripts_ready`, `status.scripts_failed`, `status.avatar_pending`, `status.faces_ready`, `status.faces_failed`, `status.engine_pending`, `status.edit_pending`, `status.render_failed`, `status.render_ready`, `status.approved`, `status.draft` | `{}` |

"Waiting on you" = `GET /creatives?filter=needs_you&limit=6`. Tempo real da Home: **polling de 5 s** só enquanto houver linha com `status = progress` (ver `eventos.md`). Para o banner "Showing the list from 3 minutes ago", o web usa o próprio cache (React Query) e o timestamp dele.

## 4. Ofertas `/offers` e etapa 1 do wizard (Offer)
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /offers` | `?limit&cursor` | `Offer[]` (sem arquivadas) | — |
| `GET /offers/:id` | — | `Offer` | 404 |
| `POST /offers/extract` | `{ url }` **ou** `{ pageText, url? }` (fallback do 403: texto colado) | `202 Job` (`type: OFFER_EXTRACT`) | 400, 429 |
| `POST /offers` | `{ name, language, sourceUrl?, ...OfferBrief, fieldSources? }` | `201 Offer` | 400 |
| `PATCH /offers/:id` | qualquer subconjunto de `{ name, language, sourceUrl, ...OfferBrief }` (autosave; campo editado vira `user` em `fieldSources`) | `Offer` | 400, 404 |
| `POST /offers/:id/reread` | `{}` (usa `sourceUrl`) ou `{ pageText }` | `202 Job`; quando termina, **não** sobrescreve: o `output` traz o briefing novo e o web mostra pra o usuário aplicar campo a campo (ou tudo) via `PATCH` | 404, 409 `INVALID_STATE` (sem `sourceUrl` e sem `pageText`) |
| `DELETE /offers/:id` | — | `{ ok: true }` (arquiva; criativos existentes seguem) | 404 |

Fluxo "New from link" no wizard: `POST /offers/extract` → `GET /jobs/:id` a cada 1,5 s até `SUCCEEDED`/`FAILED` → formulário preenchido a partir de `job.output` (campos com `fieldSources = page`) → ao clicar Continue, `POST /offers` e em seguida `POST /creatives`. Erro `PAGE_FORBIDDEN` → `action: 'paste_page_text'` (a tela mostra o campo "Page text").

Checklist do job de extração: `fetching_page` → `extracting` → `detecting_language`.

## 5. Jobs (genérico)
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /jobs/:id` | — | `Job` | 404 |

## 6. Criativo (trilho do wizard)
| método e rota | entrada | saída | erros | tela |
|---|---|---|---|---|
| `POST /creatives` | `{ offerId, name?, scriptCount?: 3-5 (padrão 4) }` | `201 CreativeDetail` em `SCRIPTS_WRITING` (roteiros já começam) | 404, 422 `OFFER_INCOMPLETE`, 409 `SPEND_CAP_EXCEEDED` | Offer → Continue |
| `GET /creatives/:id` | — | `CreativeDetail` | 404 | todas as etapas (o web abre na `step` atual) |
| `PATCH /creatives/:id` | `{ name }` (só isso; `offerId` ou outro campo = 400 `VALIDATION_ERROR`, a oferta nunca muda) | `CreativeDetail` | 400, 404 | nome no trilho |
| `DELETE /creatives/:id` | — | `{ ok: true }` (arquiva) | 404, 409 se `RENDERING` | menu da linha |
| `GET /creatives/:id/events` | — | **SSE** (ver `eventos.md`) | 404 | wizard inteiro |

Nome padrão: `"<oferta> · <n>"` (ex.: "Orbit Budget · 5").

## 7. Etapa 2: Scripts
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives/:id/scripts` | — | `{ scripts: Script[] (sem descartados, ordem A→E), job: Job \| null (o mais recente), winnersUsed: [{ creativeId, name, offerName, sameOffer: boolean }] }` | 404 |
| `POST /creatives/:id/scripts/generate` | `{ count: 1-5, replace: boolean }`. "Regenerate all" = `{ count: 4, replace: true }` (descarta os atuais). "Write the other 2" = `{ count: 2, replace: false }`. Total ativo nunca passa de 5. | `202 { job: Job, scripts: Script[] }` (os novos em `WRITING`) | 404, 409 `INVALID_STATE` (só em `SCRIPTS_READY`/`SCRIPTS_FAILED`, ou depois com `confirm`), 409 `CONFIRM_DOWNSTREAM_RESET`, 400 se passar de 5 |
| `POST /creatives/:id/scripts/:scriptId/regenerate` | `{ confirm?: boolean }` | `202 { job, script }` (mesma letra, conteúdo novo) | 404, 409 |
| `PATCH /creatives/:id/scripts/:scriptId` | `{ angle?, blocks?: [{ index, speech?, visualPrompt? }] }` (edita fala/prompt de blocos existentes; tempos são recalculados pela API proporcional ao nº de palavras) | `Script` (`editedByUser: true`) | 400, 404, 409 se o roteiro for o escolhido e já houver cenas sem `confirm` |
| `POST /creatives/:id/scripts/:scriptId/select` | `{ confirm?: boolean }` | `CreativeDetail` (vai pra `AVATAR_PENDING`/`FACES_READY`/`ENGINE_PENDING`) | 404, 409 `INVALID_STATE` (roteiro não `READY`), 409 `CONFIRM_DOWNSTREAM_RESET` |

Criativo de variação (feature 2): todas as rotas desta etapa respondem `409 INVALID_STATE` `reason: 'variation_locked'`.
Streaming do texto: eventos `script.delta` no SSE do criativo. Estado parcial (rate limit): job `PARTIAL`, roteiros prontos `READY`, os que faltaram `FAILED` com `failReason`; o web mostra "Write the other N" = `generate { count: N, replace: false }`.
Checklist do job: `reading_brief` → `studying_winners` → `writing` (com `statusParams.letter`).

## 8. Etapa 3: Avatar
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives/:id/faces` | — | `{ description: string \| null (sugestão da ia ao escolher o roteiro, editável), batches: [{ batch, description, faces: Face[] }] (mais recente primeiro), selectedFaceId, faceUnitPriceUsd }` | 404 |
| `POST /creatives/:id/faces/generate` | `{ description (10-600 chars), count?: 1\|2\|3\|4 (padrão 4) }` | `202 { batch, faces: Face[count] em QUEUED }` | 400, 404, 409 `INVALID_STATE`, 409 `SPEND_CAP_EXCEEDED`, 503 |
| `POST /creatives/:id/faces/:faceId/select` | `{ confirm?: boolean }` | `CreativeDetail` (→ `ENGINE_PENDING`) | 404, 409 (rosto não `READY`; `CONFIRM_DOWNSTREAM_RESET` se já houver cenas) |
| `PATCH /creatives/:id/faces/description` | `{ description }` | `{ description }` (autosave do campo) | 400 |

Quantidade (07/10, `feature-2-variar-campeao.md` §13.13): o usuário escolhe 1-4 rostos; o botão mostra `count × faceUnitPriceUsd` e "Mais N rostos" repete o mesmo `count`. `count` fora de 1-4 = 400.

Erro de segurança: rosto `FAILED` com `errorCode: SAFETY_BLOCK`, `failReason` explica a causa provável, `action: change_description`. Lotes anteriores continuam na resposta (a tela esmaece).

## 9. Etapa 4: Engine
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /engines` | — | `{ engines: [{ id: 'SCENES', models: [{ id: 'kling-3.0', label: 'Kling 3.0', maxSceneSec: 15 }, { id: 'seedance-…', label: 'Seedance' }], tradeoffKey }, { id: 'LIPSYNC', models: [{ id: 'pruna-lipsync', label: 'Lipsync' }], tradeoffKey }], formats: VideoFormat[] }` (catálogo da ia; ids opacos pro web) | — |
| `GET /voices` | `?language=pt-BR` | `[{ id, name, language, gender: 'female'\|'male'\|'neutral', sample: FileRef \| { url } }]` | — |
| `GET /creatives/:id/estimate` | `?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16&voiceId=` | `{ costUsd, etaSec, sceneCount, lines: [{ kind: 'VIDEO'\|'TTS'\|'LIPSYNC'\|'TRANSCRIBE', units, unit, unitPriceUsd, amountUsd }], spend: { monthUsd, capUsd \| null, afterUsd } }` | 400, 404, 409 se ainda não há roteiro e rosto |
| `PATCH /creatives/:id/engine` | `{ engine?, engineModel?, voiceId?, format? }` (autosave das escolhas) | `CreativeDetail` | 400, 404, 409 depois do Generate (trocar motor exige novo Generate com `confirm`) |
| `POST /creatives/:id/generate` | `{ engine, engineModel, voiceId? (obrigatório se LIPSYNC), format, expectedCostUsd, confirm?: boolean }`. Estados: `ENGINE_PENDING`; ou `SCENES_FAILED`/`EDIT_PENDING`/`RENDER_FAILED`/`RENDER_READY` com `confirm: true` | `202 { creative: CreativeDetail, scenes: Scene[] }` (todas `QUEUED`) | 400, 404, 409 `INVALID_STATE` / `SPEND_CAP_EXCEEDED` / `ESTIMATE_CHANGED` / `CONFIRM_DOWNSTREAM_RESET`, 503 |

Criativo de variação: `PATCH …/engine` = `409 INVALID_STATE` `reason: 'variation_locked'`; `POST …/generate` só com `engine`/`engineModel`/`voiceId`/`format` iguais aos do criativo (usado depois de trocar o rosto), senão o mesmo 409 (motor, voz e formato são do lote).
Regra da voz: `estimate.warnings` (sempre presente, pode ser `[]`) traz `'voice_gender_mismatch'` quando o motor é LIPSYNC e o gênero da voz não bate com o rosto escolhido, porque o lipsync sai ruim. Quem decide é a ia (`CatalogService.estimate` recebe `voiceId` e a descrição do rosto, ver `estrutura.md` §2.1); só avisa quando tem certeza, nunca bloqueia.

## 10. Etapa 5: Generation
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives/:id/scenes` | — | `{ summary: { ready, total, failed, progress, etaSec }, scenes: Scene[] (geração vigente, ordem) }`; cena `READY` sempre traz `clip` **e** `thumbnail` (frame em ~1 s, gerado pelo backend) | 404 |
| `POST /creatives/:id/scenes/:index/regenerate` | `{ visualPrompt?, speech? }` (opcional: ajustar antes de regerar) | `202 Scene` (`QUEUED`, `attempt+1`) | 400, 404, 409 `INVALID_STATE` / `SPEND_CAP_EXCEEDED`, 503 |

Regerar uma cena não mexe nas outras e vale mesmo com outras cenas gerando (estado `SCENES_GENERATING`), desde que a cena alvo esteja `READY` ou `FAILED`; cena `QUEUED`/`GENERATING` = 409 `INVALID_STATE`. "Continue to Edit" habilita quando `summary.ready === summary.total` (o estado já terá ido pra `RENDERING`).

## 11. Etapa 6: Edit
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /templates` | — | `[{ id, kind: 'scratch'\|'remix', labelKey, thumbnail: { url }, supportsHeadline: boolean }]` (registro do `video/`; hoje `clean`, `bold`, `headline`, todos `scratch`) | — |
| `GET /templates/:id/thumbnail` *pública* | — | imagem (PNG) do template | 404 |
| `GET /creatives/:id/edit` | — | `{ settings: EditSettings, dirty: boolean, latestRender: Render \| null, previewRender: Render \| null (último READY não stale) }` | 404, 409 se ainda sem cenas prontas |
| `PATCH /creatives/:id/edit` | subconjunto de `EditSettings` | `{ settings, dirty: true }` | 400, 404, 409 |
| `POST /creatives/:id/render` | `{}` | `202 Render` (`QUEUED`) | 404, 409 `INVALID_STATE` (já renderizando ou cenas incompletas) |
| `GET /creatives/:id/renders/:renderId` | — | `Render` | 404 |

Progresso: eventos `render.updated` no SSE (%, frame, totalFrames, stage). Falha: `failedFrame`, `failReason`, `action: render_again`.

## 12. Etapa 7: Final OK
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives/:id/review` | — | `{ creative: CreativeDetail, video: FileRef, facts: { offerName, scriptLetter, angle, face: FileRef, engineLabel, durationSec, format, costUsd }, changeOptions: [{ type: 'SCENE'\|'TEXT'\|'LINE'\|'FACE', returnsTo: Step, estimateUsd, etaSec }] }` | 404, 409 se não estiver em `RENDER_READY`/`APPROVED` |
| `POST /creatives/:id/approve` | `{}` | `CreativeDetail` (`APPROVED`) | 404, 409 `INVALID_STATE` (precisa `RENDER_READY` e `editDirty = false`) |
| `POST /creatives/:id/changes` | `{ type: 'SCENE', sceneIndex, note? }` \| `{ type: 'LINE', sceneIndex, newSpeech, note? }` \| `{ type: 'TEXT', note? }` \| `{ type: 'FACE', note? }` | `{ creative: CreativeDetail, returnTo: Step }` (`SCENE`→`generation`, `LINE`→`generation`, `TEXT`→`edit`, `FACE`→`avatar`). SCENE/LINE já disparam a regeração da cena (LINE com a fala nova); TEXT volta pro Edit; FACE volta pro Avatar com cenas `stale` | 400, 404, 409 `INVALID_STATE` / `SPEND_CAP_EXCEEDED` |

`changeOptions` em variação (feature 2): `TEXT` e `SCENE` sempre; `LINE` não aparece em cenas `AUDIO_LIPSYNC`/`SOURCE_CUT` (a voz original não fala texto novo); `FACE` só em `SWAP_AVATAR`.

## 13. Biblioteca `/library`
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /library` | `?offerId=&winners=true&championId=&variationKind=&limit&cursor` | `[{ id, name, offer: { id, name }, engineLabel, durationSec, video: FileRef, thumbnail: FileRef, isWinner, approvedAt, approvedBy: UserRef, variation }]` + `meta.nextCursor` + `meta.offers: [{ id, name }]` (pros filtros) | 400 |
| `PUT /library/:creativeId/winner` | `{ isWinner: boolean }` (idempotente, no lugar do "toggle") | `{ id, isWinner }` | 404, 409 se não `APPROVED` |

## 14. Configurações `/settings`
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /workspace` | — | `{ id, name, uiLocale, monthlySpendCapUsd }` | — | todos |
| `PATCH /workspace` | `{ name?, uiLocale?, monthlySpendCapUsd?: number \| null, brandColor?: string \| null }` (25/10) | igual | 400, 403 | OWNER/ADMIN |
| `GET /workspace/members` | — | `{ members: [{ userId, name, email, role, initials }], invites: [{ id, email, role, expiresAt }] }` | — | todos |
| `POST /workspace/invites` | `{ email, role: 'ADMIN'\|'MEMBER' }` | `201 { id, inviteUrl, expiresAt }`; `inviteUrl = <primeira origem de WEB_ORIGIN>/invite/<token>` (rota `/invite/[token]` no web). v1 não manda e-mail: o link é copiado | 400, 403, 409 `EMAIL_TAKEN` | OWNER/ADMIN |
| `DELETE /workspace/invites/:id` | — | `{ ok: true }` | 403, 404 | OWNER/ADMIN |
| `PATCH /workspace/members/:userId` | `{ role }` | membro | 403, 404, 409 `LAST_OWNER` | OWNER |
| `DELETE /workspace/members/:userId` | — | `{ ok: true }` (revoga refresh tokens dele no workspace) | 403, 404, 409 `LAST_OWNER` | OWNER |
| `GET /workspace/services` | — | `[{ provider: 'ANTHROPIC'\|'WAVESPEED'\|'HIGGSFIELD'\|'APIFY'\|'STORAGE'\|'META', connected: boolean, keyMasked: 'sk-…a91f' \| null }]` (lido do `.env` da API; só leitura na v1). `HIGGSFIELD` = rosto Soul V2 (`HF_API_KEY_ID`/`SECRET`, mascara o id); `APIFY` = link da Ad Library (`APIFY_TOKEN`); `META` (21/10) = app configurado (`META_APP_ID`/`SECRET`/`TOKEN_KEY` em live, ou mock; `off` = `connected: false`), mascara o app id. A conexão do workspace em si é `GET /meta/connection` | — | todos |
| `GET /workspace/tour` (21/10) | — | `TourState` (`completedAt` do membership do usuário; `stops` sem `iterate` quando não há WINNER na Meta) | — | todos (`@ClientAllowed`) |
| `POST /workspace/tour/complete` (21/10) | `{}` | `{ tourCompletedAt }` (idempotente) | — | todos (`@ClientAllowed`) |
| `GET /workspace/spend` | `?month=2026-10` | `{ month, spentUsd, capUsd, byProvider: [{ provider: 'ANTHROPIC'\|'WAVESPEED'\|'HIGGSFIELD'\|'APIFY', amountUsd }], byKind: [{ kind: 'LLM'\|'IMAGE'\|'VIDEO'\|'TTS'\|'LIPSYNC'\|'TRANSCRIBE'\|'SCRAPE', amountUsd }] }` (inclui custo de campeões e lotes) | 400 | todos |

## 15. Arquivos, saúde e webhooks
| método e rota | entrada | saída | quem chama |
|---|---|---|---|
| `GET /files/:id` | — | `302` pra URL assinada nova (6 h) | web, quando a URL venceu |
| `GET /health` *pública* | — | `{ ok, db, storage, version }` | EasyPanel healthcheck |
| `POST /webhooks/wavespeed` *pública, assinada* | payload da WaveSpeed | `200 { received: true }` | WaveSpeed (ver `eventos.md`) |

## 16. Quem usa o quê (resumo por tela)
| tela | leitura | ação | tempo real |
|---|---|---|---|
| Login / convite | `GET /auth/invites/:token` | `POST /auth/login`, `/refresh`, `/invites/:token/accept` | — |
| Home | `GET /creatives` | — | polling 5 s com linha em andamento |
| Offers | `GET /offers`, `GET /offers/:id` | `POST /offers/extract`, `POST /offers`, `PATCH /offers/:id`, `POST /offers/:id/reread`, `DELETE /offers/:id` | `GET /jobs/:id` 1,5 s |
| Wizard · Offer | `GET /offers` | `POST /offers/extract`, `POST /offers`, `POST /creatives` | `GET /jobs/:id` |
| Wizard · trilho | `GET /creatives/:id` | `PATCH /creatives/:id` | SSE `/creatives/:id/events` |
| Wizard · Scripts | `GET …/scripts` | `…/scripts/generate`, `…/:sid/regenerate`, `PATCH …/:sid`, `…/:sid/select` | SSE (`script.delta`, `job.updated`) |
| Wizard · Avatar | `GET …/faces` | `…/faces/generate`, `…/faces/:fid/select`, `PATCH …/faces/description` | SSE (`face.updated`) |
| Wizard · Engine | `GET /engines`, `GET /voices`, `GET …/estimate`, `GET /workspace/spend` | `PATCH …/engine`, `POST …/generate` | — |
| Wizard · Generation | `GET …/scenes` | `…/scenes/:index/regenerate` | SSE (`scene.updated`) |
| Wizard · Edit | `GET /templates`, `GET …/edit` | `PATCH …/edit`, `POST …/render` | SSE (`render.updated`) |
| Wizard · Final OK | `GET …/review` | `POST …/approve`, `POST …/changes` | — |
| Library | `GET /library` | `PUT /library/:id/winner` | — |
| Settings | `GET /workspace`, `/members`, `/services`, `/spend` | `PATCH /workspace`, invites, members, `PATCH /auth/me` | — |
| Campeões (lista) | `GET /champions` | — | — |
| Importar campeão | `GET /champions/config`, `GET /offers` | `POST /uploads` → PUT → `/uploads/:id/complete`, `POST /champions` (e `POST /offers` se nova) | `GET /champions/:id` 2 s |
| Campeão / teardown | `GET /champions/:id`, `GET /champions/:id/batches` | `PATCH /champions/:id`, `PATCH …/teardown`, `PUT …/video`, `POST …/analyze`, `POST …/batches` | `GET /champions/:id` 2 s enquanto analisa |
| Lote (plano e progresso) | `GET /variation-batches/:id`, `GET …/estimate`, `GET /voices` | itens, elencos, rostos, settings, `replan`, `launch` | `GET /variation-batches/:id` 1,5 s (plano) / 5 s (lançado) |
| Start (agência ou próprio, 21/10) | `GET /auth/me` | `PATCH /auth/me { accountMode }` | — |
| Onboarding · passo 2 Connect Meta (21/10) | `GET /meta/connection`, `GET /meta/options` | `POST /meta/connect`, `PUT /meta/selection`, `POST /meta/health`, `PATCH /workspace { onboardingStep }` | `GET /meta/options` 2 s em `connecting` |
| Setup in progress (MEMBER/CLIENT, 21/10) | `GET /workspace` (`onboarding.updatedBy`, `percent`) | — | ao abrir e no foco |
| Tour (21/10) | `GET /workspace/tour`, `GET /meta/ads?verdict=WINNER&limit=1` | `POST /workspace/tour/complete` | — |
| Home · performance (21/10) | `GET /meta/summary?period=`, `GET /meta/ads?sort=spend&limit=3`, `GET /meta/publications?limit=6`, `GET /meta/connection` | `POST /meta/sync` | 5 s só em `first_sync` |
| Iterate · Pick from Meta (21/10) | `GET /meta/ads` | `POST /iterate { metaAdId }` | `GET /iterate/:id` 1,5 s (como hoje) |
| Send · Publish to Meta (21/10) | `GET /creatives/:id/meta` | `…/meta/publish`, `…/retry`, `…/activate`, `…/pause` | `GET /creatives/:id/meta` 2 s em `PUBLISHING` |
| Settings · Meta (21/10) | `GET /meta/connection`, `GET /workspace/services` | `POST /meta/connect`, `PUT /meta/selection`, `POST /meta/health`, `DELETE /meta/connection`, `POST /meta/sync` | `GET /jobs/:id` 1,5 s no "Sync now" |
| Brain 3D (22/10) | `GET /brain/graph`, `GET /brain/node/:id`, `GET /workspace`, `GET /offers` | — ("Fill in setup"/"Edit in setup" são links pro onboarding) | sem polling; React Query `staleTime` 60 s; "Refresh" = `?fresh=1` |

O que vale é este arquivo + `@maquina/contratos`. DTO que não `implements` o tipo do pacote, ou resposta fora do tipo, = bug do backend. Swagger em `/api/docs` (fora de produção) é opcional e sem o plugin do CLI.

## 17. Modo mock: gatilhos oficiais pro QA (`INTEGRACOES_MODE=mock`)
Texto mágico nos campos de entrada força falhas determinísticas sem custo. Fazem parte do contrato: a ia não muda sem o arquiteto. Fora do mock, são texto comum.
| onde escrever | gatilho | resultado |
|---|---|---|
| URL da oferta (`POST /offers/extract`, `/reread`) | contém `mock-403` / `mock-unreadable` / `mock-429` | job `FAILED` com `PAGE_FORBIDDEN` (`action: paste_page_text`) / `PAGE_UNREADABLE` / `RATE_LIMITED` |
| `notes` da oferta | `[mock:fail-slot:N]` (N a partir de 0) / `[mock:fail-all]` | roteiro N falha → job `PARTIAL` / todos falham → `SCRIPTS_FAILED` |
| descrição do rosto | `[mock:SAFETY_BLOCK]` / `[mock:PROVIDER_ERROR]` / `[mock:PROVIDER_TIMEOUT]` / `[mock:CANCELLED]` | os 4 rostos do lote terminam com esse `errorCode` → `FACES_FAILED` |
| fala ou prompt visual de um bloco do roteiro (via `PATCH …/scripts/:id`) ou no `regenerate` da cena | os mesmos 4 de cima | só aquela cena falha com esse `errorCode` |
| `headline` ou `ctaText` dos ajustes de edição (`PATCH …/edit`) | `[mock:RENDER_ERROR]` | o render falha no meio (render fake) → criativo `RENDER_FAILED`, render `FAILED` com `failedFrame`, `failReason` e `action: render_again` |
Tempo: toda task mock termina em 2-5 s, custo US$ 0. Mídia sintética servida em `GET /api/v1/mock-media/…` (só existe em mock).

**Feature 2:**
| onde | gatilho | resultado |
|---|---|---|
| `adLibraryUrl` | `mock-ad-unavailable` | `503 AD_LIBRARY_UNAVAILABLE` `{ reason: 'quota', retryAfter: '2026-10-19' }` (síncrono) |
| `adLibraryUrl` | `mock-ad-notfound` / `mock-ad-novideo` | campeão `FAILED` com `AD_NOT_FOUND` / `AD_HAS_NO_VIDEO`, `action: upload_video` |
| `adLibraryUrl` | qualquer outro `?id=` | resolve com vídeo sintético de 20 s com fala |
| `notes` do campeão | `[mock:analysis-fail]` | análise falha em `diagnosing` (`PROVIDER_ERROR`); transcrição e medições ficam |
| `notes` do lote | `[mock:fail-item:<KIND>:<N>]` / `[mock:fail-all]` | item falha / `PLAN_FAILED` |
| descrição do elenco | os 4 gatilhos de rosto v1 | igual ao v1 |
| `notes` do campeão (§13, passa pela **visão**: `describeEdit` mock) | `[mock:keep-straddle]` / `[mock:keep-overlay]` / `[mock:hook-over-video]` | legenda metade dentro, metade fora da região do rosto → `caption_straddles_face` / painel sobre o rosto → `overlay_over_face` / headline sem fundo → `hook_text_over_video` |
| `notes` do campeão (§13, **medição / backend / geração**, não a visão) | `[mock:keep-two-faces]` / `[mock:not-mapped]` / `[mock:take-fail]` | trilha com 2 rostos → `multiple_faces` (medição) / campeão sem `editMap` → `not_mapped` (backend) / o take do lipsync falha (`PROVIDER_ERROR`) e as fatias `TAKE_SLICE` ficam `FAILED` juntas (geração) |
A medição (`MediaAnalysisService`) roda **de verdade** também em mock: é local e grátis. O QA usa vídeos curtos em `testes/fixtures/campeoes/` (um com fala e split screen, um sem áudio, um 400 px, um truncado).

## 18. Uploads (feature 2)
O web não sabe se o PUT vai direto pro storage ou passa pela API: segue `method/url/headers` da resposta, com barra de progresso (XHR).
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `POST /uploads` | `{ purpose: 'CHAMPION_VIDEO', filename, mimeType, sizeBytes }` | `201 { uploadId, method: 'PUT', url, headers, expiresAt }`. `UPLOAD_MODE=direct`: `url` = URL pré-assinada do storage (assinada com `Content-Length` e `Content-Type`, 30 min). `UPLOAD_MODE=proxy` (padrão em dev, versitygw sem CORS garantido): `url` = `<api>/uploads/:id/content` | 400, 422 `MEDIA_TOO_LARGE` / `MEDIA_INVALID` (mime) | Importar campeão |
| `PUT /uploads/:id/content` | corpo cru do arquivo (só em `proxy`, **com Bearer**), stream direto pro storage em multipart | `{ ok: true }` | 404, 410 `UPLOAD_EXPIRED`, 413 se passar do declarado | web (via `url`) |
| `POST /uploads/:id/complete` | `{}` | `{ uploadId, status: 'READY', file: FileRef (com durationSec/width/height), warnings: ('no_audio'\|'low_resolution')[], analysisEstimateUsd }`. O backend confere o objeto (tamanho igual ao declarado), roda ffprobe e valida a duração | 404, 409 `UPLOAD_INCOMPLETE`, 410 `UPLOAD_EXPIRED`, 422 `MEDIA_INVALID` / `MEDIA_TOO_SHORT` / `MEDIA_TOO_LONG` | web |
A decodificação completa (o arquivo inteiro, regra do download truncado) roda no início do job de análise, não no `complete`, pra não segurar a requisição com 200 MB.

## 19. Campeões (feature 2)
| método e rota | entrada | saída | erros | tela |
|---|---|---|---|---|
| `GET /champions/config` | — | `ChampionConfig` | — | Importar (desliga o campo de link com o motivo, se `adLibrary.available = false`) |
| `GET /champions` | `?offerId&limit&cursor` | `ChampionRow[]` + `meta.nextCursor` | 400 | lista de campeões |
| `POST /champions` | `{ offerId, name?, uploadId?, adLibraryUrl?, rights, notes? }` (ao menos um de `uploadId`/`adLibraryUrl`; `rights` só é gravado) | `202 ChampionDetail` em `ANALYZING` ou `RESOLVING`, com `job` | 400, 404 (oferta/upload), 409 `UPLOAD_INCOMPLETE`, 409 `SPEND_CAP_EXCEEDED`, **503 `AD_LIBRARY_UNAVAILABLE`** (só quando veio **só** link e a Apify recusou na hora: teto, sem chave, fora do ar; nada é criado) | Importar → Analyze |
| `GET /champions/:id` | — | `ChampionDetail` | 404 | campeão / teardown |
| `PATCH /champions/:id` | `{ name?, rights?, notes? }` | `ChampionDetail` | 400, 404 | campeão |
| `PUT /champions/:id/video` | `{ uploadId }` (anexa vídeo a um campeão `FAILED`, ex.: link não resolveu) | `202 ChampionDetail` (`ANALYZING`) | 404, 409 `INVALID_STATE` | campeão com falha (`action: upload_video`) |
| `POST /champions/:id/analyze` | `{ confirm?: boolean }` | `202 { job }` | 404, 409 `INVALID_STATE` (já analisando), 409 `CONFIRM_DOWNSTREAM_RESET` `{ editedSections }` se houver seção editada, 409 `SPEND_CAP_EXCEEDED` | "Analyze again" |
| `PATCH /champions/:id/teardown` | `{ sections?: Partial<{ [k in TeardownSectionKey]: Section<any> }>, transcriptWords?: [{ index, word }] }` (corrige palavra do Whisper; tempos não mudam) | `Teardown` (`editedSections` atualizado) | 400, 404, 409 se `ANALYZING` | teardown (autosave) |
| `DELETE /champions/:id` | — | `{ ok: true }` (arquiva; criativos ficam) | 404 | menu |
| `GET /champions/:id/batches` | — | `VariationBatch[]` (resumo, mais recente primeiro) | 404 | campeão |

Checklist do job `CHAMPION_RESOLVE`: `fetching_ad` → `downloading_video`. Do `CHAMPION_ANALYZE`: `reading_video` (decodifica inteiro) → `extracting_audio` → `transcribing` → `measuring` → `diagnosing`. Estimativa da análise (mostrada antes): `analysisUsdPerSec × duração` (Whisper US$ 0,002/s + Claude com frames, ~US$ 0,20-0,30 fixo; ver §7).

## 20. Lotes de variação (feature 2)
| método e rota | entrada | saída | erros | tela |
|---|---|---|---|---|
| `POST /champions/:id/batches` | `{ requests: [{ kind, count }], settings?: Partial<BatchSettings>, notes?, castingStyle?: 'DIVERSE'\|'MATCH_ORIGINAL' (padrão DIVERSE, §13.13) }` | `202 VariationBatch` (`PLANNING`, itens `WRITING`, controle incluído em `NEW_HOOKS`) | 400, 404, 409 `INVALID_STATE` (campeão não `READY`), 422 `NO_SPEECH` `{ kind }`, 422 `KIND_NOT_ENABLED` `{ kind }`, 409 `SPEND_CAP_EXCEEDED` | escolher variações |
| `GET /variation-batches/:id` | — | `VariationBatch` | 404 | revisão do plano e progresso |
| `POST /variation-batches/:id/replan` | `{ requests?, notes?, castingStyle? }` (omitido = mantém) | `202 VariationBatch` (`PLANNING`) | 404, 409 `INVALID_STATE` | "Planejar de novo" |
| `PATCH /variation-batches/:id/items/:itemId` | `{ included?, hook?: { speech?, onScreenText? }, blocks?: [{ index, speech? }] }` (só o que a alavanca do tipo permite: em `NEW_HOOKS` só `hook`; em `COPY_NEW` só `blocks`; em `SWAP_AVATAR` só `included`; campo de outro tipo = 400) | `VariationItem` | 400, 404, 409 se não `PLAN_READY` | revisão do plano |
| `POST /variation-batches/:id/items/:itemId/regenerate` | `{ note? }` | `202 VariationItem` (`WRITING`); só em `PLAN_READY` com item `READY`/`FAILED` | 404, 409 `INVALID_STATE` | "Regerar este" |
| `PATCH /variation-batches/:id/settings` | `Partial<BatchSettings>` | `VariationBatch` | 400, 404, 409 se não `PLAN_READY` | revisão do plano |
| `PATCH /variation-batches/:id/castings/:castingId` | `{ description }` (10-600) | `VariationCasting` | 400, 404 | elenco |
| `POST /variation-batches/:id/castings/:castingId/faces/generate` | `{ description, count?: 1\|2\|3\|4 (padrão 1) }` | `202 { batch, faces: Face[count] }` (Soul V2, mesma mecânica dos rostos v1) | 400, 404, 409, 409 `SPEND_CAP_EXCEEDED`, 503 | elenco |
| `POST /variation-batches/:id/castings/:castingId/faces/:faceId/select` | `{}` | `VariationCasting` | 404, 409 (rosto não `READY`) | elenco |
| `GET /variation-batches/:id/estimate` | — | `BatchEstimate` (só itens `included` e `READY`) | 404, 422 `BATCH_INCOMPLETE` | revisão do plano |
| `POST /variation-batches/:id/launch` | `{ expectedCostUsd }` | `202 { batch: VariationBatch, creatives: CreativeRow[] }` (criativos em `SCENES_GENERATING`) | 404, 409 `INVALID_STATE`, **422 `BATCH_INCOMPLETE`** `{ missing: [{ castingId, reason: 'face_not_selected' } \| { itemId, reason: 'not_ready' } \| { field: 'voiceId' }] }`, 409 `SPEND_CAP_EXCEEDED`, 409 `ESTIMATE_CHANGED`, 503 | OK do lote |

`VariationBatch` ganha `castingStyle` e `faceUnitPriceUsd` (preço do Soul por rosto; a tela do elenco mostra `count × faceUnitPriceUsd`). Trocar `castingStyle` depois do plano = `replan` (o `PATCH …/settings` não aceita).

Checklist do job `VARIATIONS_PLAN`: `reading_teardown` → `writing` (`statusParams: { kind, index }`). Nome dos criativos: `"<campeão> · <rótulo do tipo> <n>"` (controle: `"… · Control"`).

**Esclarecimentos 06/10 (casos do QA):**
1. `PUT /uploads/:id/content` (modo proxy) **exige Bearer** como toda rota da API; upload de outro workspace = 404. O web manda os `headers` devolvidos e, quando a `url` é da própria API, também o `Authorization`. No modo direct a URL pré-assinada dispensa Bearer.
2. Vídeo que não decodifica (no `complete` ou no `reading_video` da análise): campeão `FAILED`, `errorCode: MEDIA_INVALID`, **`action: upload_video`** (analisar de novo não conserta arquivo ruim). `analyze_again` só para falhas transitórias: transcrição, medição, Claude, `INTERRUPTED`.
3. "Regerar este" (`POST …/items/:itemId/regenerate`) só vale com o lote em **`PLAN_READY`** e o item `READY` ou `FAILED`; o lote continua `PLAN_READY` e o item vai pra `WRITING` (launch com item `WRITING` = `422 BATCH_INCOMPLETE`). `PLANNING`, `PLAN_FAILED` (use `replan`) e `LAUNCHED` = `409 INVALID_STATE`.
4. Campeão arquivado = **404** em `GET /champions/:id` e em toda rota dele (e sai do `GET /champions`); os criativos já criados seguem com `variation.championName`. `POST /uploads/:id/complete` é **idempotente**: upload já `READY` devolve 200 com a mesma resposta (mesmo `file`); `FAILED` repete o mesmo 422; `EXPIRED` = 410.

**Esclarecimentos 06/10 (backend):**
5. **Trocar o rosto de uma variação `SWAP_AVATAR`** (change `FACE`) segue a máquina v1, sem reinício automático: escolher o rosto novo leva a `ENGINE_PENDING`, e as cenas só recomeçam com `POST /creatives/:id/generate` (`expectedCostUsd` e `confirm` quando houver cenas), porque gasto sem estimativa na tela é proibido. Em variação o `/generate` é **liberado só com os parâmetros do lote**: `engine`, `engineModel`, `voiceId` e `format` iguais aos gravados no criativo (`voiceSource` e `pipeline` das cenas também se mantêm); qualquer diferença = `409 INVALID_STATE` `reason: 'variation_locked'`. Na etapa Engine, o web mostra só a estimativa e o botão Generate, com os campos travados. `PATCH …/engine` continua travado.
6. **Custo dos rostos do elenco** (`submitFace` com rosto de `castingId`): a `cost_entry` sai com `variationBatchId` = lote do elenco e `creativeId` nulo (quem grava é a ia, achando o lote pelo `casting.batchId`). Entra no `VariationBatch.costUsd` (= entradas com `variationBatchId` + soma dos criativos do lote) e no gasto do mês. Não entra no `costUsd` de nenhum criativo.
7. `@aws-sdk/lib-storage` (multipart do `putStream`) no `api/package.json` está aprovado: o lock da raiz resolveu 3.1146.0, a mesma versão do `client-s3`, deduplicado.

Tipos completos (`ChampionDetail`, `Teardown`, `TeardownSections`, `VariationBatch`, `BatchEstimate`…) em `@maquina/contratos` e em `feature-2-variar-campeao.md` §4. Limites em `feature-2-variar-campeao.md` §2.
