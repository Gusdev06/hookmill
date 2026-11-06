# Template de campanha da Meta, contrato v2 ("campos fáceis" saem do Soon)
Data: 2026-11-02 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 03/11** (decisões no §13). B0, F0 e A0 feitos pelo arquiteto em 03/11 (`tsc` verde nos 4 workspaces). **Sem sonda real na Meta por enquanto: tudo em mock.**
Origem: decisão do Gusta de 02/11 (`decisions/log.md`, "testes do dia e template de campanha"). Tela: `design/mockup-template-campanha.html` + `design/template-campanha-2026-11-02.md` (editor em página inteira, formato Gerenciador, "Custom" continua no seletor, destino padrão REUSE, orçamento do 1º template vazio).
Vale **por cima** de `meta-templates-v1.md` só no que muda aqui. Envelope, papéis e erros: `api.md` §1 e `meta-v1.md` §3.4. Tipos: `contratos/src/meta-templates.ts` e `contratos/src/meta.ts` (blocos "v2", já aplicados, `tsc` verde em contratos, api, web e testes).
Graph usada no código: **v25.0** (`api/src/integracoes/meta/cliente.ts`). Nomes de campo conferidos na doc da Meta em 02/11 (refs no §12).

## 0. Em 5 linhas
1. Seis campos saem do "Soon" e passam a ir pra Graph de verdade: objetivos **Awareness** e **Engagement**, **orçamento total**, **agendamento**, **idiomas**, **conta do Instagram** e **públicos personalizados** (incluir e excluir).
2. Todos os campos novos do template são **opcionais**. Um template v1 salvo continua válido e publica igual. **Sem migração Prisma**, porque o template já é JSON.
3. O editor ganha 3 listas da conta: `GET /meta/instagram-accounts`, `GET /meta/custom-audiences` e `GET /meta/locales`.
4. A importação passa a copiar esses campos. Continuam em `unsupported`: interesses e segmentação detalhada, A/B, carrossel/flexível, Reservation, geo além de país, e outros (§7).
5. Nenhum código de erro novo. Usamos `VALIDATION_ERROR` com regras novas e o `META_BUDGET_TOO_LOW` com 2 campos opcionais.

## 1. Escopo
**Entra:** os 6 campos acima, no **template** (editor, salvar, importar, publicar 1 peça com `templateId` e `publish-batch`).
**Não entra (continua "Soon"):** interesses/segmentação detalhada, A/B test, carrossel/flexível, Buying type Reservation, local de conversão App/Mensagens.
**Não muda:** o formulário **Custom** (`MetaPublishBody`) continua com os 4 objetivos, só orçamento diário e sem os campos novos. O DTO do Custom não aceita os objetivos novos.

## 2. Campos novos (tipo → regra → Graph)
Os nomes de tipo são os de `contratos/src/meta-templates.ts`. "Ausente" quer dizer a chave não veio. Nos campos que aceitam `null`, `null` vale o mesmo que ausente.

### 2.1 Objetivos Awareness e Engagement
- **Tipo:** `campaign.objective` aceita `OUTCOME_AWARENESS` e `OUTCOME_ENGAGEMENT`. Desde o **A0** (03/11) o `MetaObjective` tem os 6 (`MetaTemplateObjective` ficou como alias). O DTO do Custom continua aceitando só os 4 de antes; o validador do template passa a aceitar os 6 no B1.
- **Novo:** `adset.optimizationGoal?: MetaTemplateOptimizationGoal | null` ("Performance goal" do Gerenciador). Só vale com esses 2 objetivos. Nos outros, ele fica ausente ou `null`, e a otimização sai do pixel como na v1.

| objetivo | metas aceitas (`optimizationGoal`) | padrão quando `null` | pixel | `destination_type` | `promoted_object` | `billing_event` |
|---|---|---|---|---|---|---|
| `OUTCOME_AWARENESS` | `REACH`, `IMPRESSIONS`, `AD_RECALL_LIFT`, `THRUPLAY`, `TWO_SECOND_CONTINUOUS_VIDEO_VIEWS` | `REACH` | **proibido** (`pixelId` e `pixelEvent` = null) | não envia | `{ page_id }` (Página da conexão) | `IMPRESSIONS` |
| `OUTCOME_ENGAGEMENT` | `THRUPLAY`, `TWO_SECOND_CONTINUOUS_VIDEO_VIEWS` | `THRUPLAY` | proibido | `ON_VIDEO` | não envia | `IMPRESSIONS` |
| `OUTCOME_ENGAGEMENT` | `POST_ENGAGEMENT` | — | proibido | `ON_POST` | não envia | `IMPRESSIONS` |
| Sales / Leads / App / Traffic | `null` (ausente) | — | igual v1 (Sales/Leads/App exigem) | igual v1 | igual v1 | `IMPRESSIONS` |

Fonte: tabela de mapeamento ODAX da referência de Campaign (v25/v26). `billing_event=IMPRESSIONS` serve pra todas as metas da tabela. Pagar por ThruPlay fica fora da v2.
- **CTA padrão** (quando a importação não traz CTA, e o `CTA_BY_OBJECTIVE` da publicação): `LEARN_MORE` nos dois objetivos. O `ad.link` continua obrigatório, igual à v1, e o anúncio de vídeo leva botão e link nos dois objetivos.
- **Tela:** a grade de objetivo tira o "Soon" dos 2 cartões. No Conjunto, a seção "Conversion" vira **"Performance goal"** com um `Select` das metas do objetivo. O Pixel some, e "Website events" do Anúncio mostra "—".

### 2.2 Orçamento total (lifetime)
- **Tipo:** `campaign.budgetType?: 'DAILY' | 'LIFETIME'` (ausente = DAILY) e `campaign.lifetimeBudgetMinor?: number | null`.
- **DAILY:** igual v1. `dailyBudgetMinor` ≥ 1 e `lifetimeBudgetMinor` ausente ou `null`.
- **LIFETIME:** `lifetimeBudgetMinor` inteiro ≥ 1, `dailyBudgetMinor` = **0** e `adset.schedule.end` **obrigatório**.
- **Onde mora:** igual ao diário. Com CBO fica na campanha (`lifetime_budget` + `bid_strategy`). Com ABO fica em cada ad set (`lifetime_budget` + `bid_strategy`).
- **CBO + LIFETIME exige `destination = NEW_CAMPAIGN`** (regra `lifetimeCboNeedsNewCampaign` em `campaign.destination`). O orçamento total de uma campanha é um pote só, gasto no período dela. Reaproveitar a mesma campanha a cada publicação colocaria conjuntos novos num pote já gasto. ABO + LIFETIME + REUSE pode, porque cada conjunto tem o seu total.
- **Mínimo:** a Meta diz que "os mínimos são definidos pelo diário, mas valem pro total também". Então **mínimo total = mínimo diário da conta × dias**, com dias = teto((fim − início) / 24 h). A checagem acontece ao salvar (quando dá pra calcular, §3) e de novo no envio, com as datas resolvidas. A resposta é 422 `META_BUDGET_TOO_LOW { minimumMinor: <total>, currency, budgetType: 'LIFETIME', days }`. O DAILY continua mandando `{ minimumMinor, currency }`.
- **Forma da campanha reaproveitada:** `campaignShapeChanged` passa a comparar também `budgetType`. Se trocar entre diário e total, o `reuseCampaignId` é esquecido, porque a Meta não troca o tipo de orçamento de uma campanha que já existe.
- **Tela:** "Budget type" (`Select` Daily/Lifetime) tira o "Soon". Com CBO fica na Campanha, com ABO fica em "Budget & schedule" do Conjunto. Com Lifetime e CBO, o cartão "Publish into" trava em "New campaign each publish", com a explicação de 1 linha.

### 2.3 Agendamento (início e fim do conjunto)
- **Tipo:** `adset.schedule?: { start: MetaLocalDateTime | null; end: null | { kind: 'AT'; at } | { kind: 'AFTER_DAYS'; days } } | null`.
- **`MetaLocalDateTime`** = `YYYY-MM-DDTHH:mm` **no fuso da conta de anúncio** (`MetaConnection.adAccount.timezoneName`), sem offset. A tela mostra "Times in America/Sao_Paulo (ad account)". O backend converte pra UTC com esse fuso na hora de publicar.
- **Por que existe fim relativo:** um template é usado várias vezes. Com data fixa, ele "vence" na data de fim. `AFTER_DAYS` (1–365) quer dizer "termina N dias depois do início". O início `null` quer dizer "começa ao publicar". Data fixa (`AT`) continua possível pra quem quer, como no Gerenciador.
- **Graph:** `start_time` e `end_time` vão **no ad set**, em ISO 8601 com offset (`2026-11-10T14:00:00+0000`). Na campanha esses campos são só leitura. Quando o início é `null` ou já passou, `start_time` não vai. Quando o fim é `null`, `end_time` não vai (conjunto contínuo, só com DAILY).
- **Resolução no envio:** no `POST …/publish` e no `publish-batch`, o backend calcula **uma vez** `startTime`/`endTime` em UTC e grava em `MetaPublication.settings` (§6). Todos os conjuntos do lote recebem os mesmos horários, e um retry usa os mesmos.
- **Regras:** ver §3 (formato, início no passado, duração mínima de 24 h, fim obrigatório com LIFETIME).
- **Tela:** a seção "Schedule" do Conjunto tira o "Soon": "Start: When published / On a date" e "End: No end date / After N days / On a date".

### 2.4 Idiomas (`targeting.locales`)
- **Tipo:** `adset.locales?: { key: number; name: string }[]`, de 0 a 50 itens, sem chave repetida. Vazio ou ausente = todos os idiomas. Pra Graph vai só `key`. O `name` serve pra mostrar o resumo sem buscar a lista de novo.
- **Fonte da lista: Graph, não lista fixa.** As chaves são números internos da Meta (6 = English (US), 24 = English (UK)), não ISO. Uma lista fixa no código pode ficar desatualizada, e cada chave errada vira erro na publicação. A Graph devolve a lista inteira numa chamada (`GET /search?type=adlocale&q=&limit=1000`), que vai pra cache de 24 h no processo. Custa uma chamada por dia.
- **Tela:** "Languages" sai do "Soon" com um `Combobox` multi (filtro local em cima de `GET /meta/locales`).

### 2.5 Conta do Instagram do anúncio
- **Tipo:** `ad.instagramAccount?: { id: string; username: string } | null`. `null` = comportamento v1, em que a Página aparece como identidade no Instagram.
- **Graph:** `object_story_spec.instagram_user_id = id` no `adcreatives`. **Não usamos `instagram_actor_id`.** Ele saiu da referência de `object_story_spec`, e o guia de contas do Instagram manda usar `instagram_user_id` (e diz que o endpoint antigo `InstagramUserID` foi descontinuado na v22 e em todas as versões a partir de 21/04/2025). Regra da Meta: se a conta for ligada a uma Página, o `page_id` do criativo tem que ser **essa** Página.
- **Lista:** junta, sem repetir id, as contas de `GET act_<id>/instagram_accounts` (fields `id,username,profile_pic`, token do usuário) com as de `GET <pageId>/instagram_accounts` (ligadas à Página da conexão). A da Página exige token da Página. Esse token sai de `GET <pageId>?fields=access_token`. Se a Meta negar, a lista sai só com as da conta e vem `pageLookup: 'unavailable'`.
- **Tela:** "Identity › Instagram account" sai do "Soon" com um `Select`: "Use Facebook Page" (`null`) + as contas com foto. Com `pageLookup ≠ ok` aparece o hint "Don't see it? Add the Instagram account to this ad account in Business Settings". A prévia do anúncio mostra o @ escolhido.

### 2.6 Públicos personalizados (incluir e excluir)
- **Tipo:** `adset.customAudiences?: { id; name }[]` e `adset.excludedCustomAudiences?: { id; name }[]`, de 0 a 20 cada. O mesmo id não pode estar nas duas listas.
- **Graph:** `targeting.custom_audiences = [{ id }]` e `targeting.excluded_custom_audiences = [{ id }]`. Lista vazia não vai.
- **Lista:** `GET act_<id>/customaudiences?fields=id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated` (até 500, ordenada por `time_updated` desc). Lookalikes vêm na mesma lista (`subtype LOOKALIKE`). `usable` = `delivery_status.code < 300` e `operation_status.code ≠ 471`.
- **Advantage+ audience ligado:** a Meta trata o público incluído como **sugestão**, e só a exclusão é regra fixa. A tela mostra essa linha embaixo de "Custom audiences" quando `advantageAudience = true`.
- **Tela:** "Custom audiences" sai do "Soon" com 2 `Combobox` multi ("Include" e "Exclude"), tamanho aproximado e um selo "Not usable" (com o motivo) nos públicos `usable: false`. Selecionar um público não usável pode, mas aparece o aviso.

## 3. Validações (backend `templates.ts`; o web espelha no `build()`)
Formato: `400 VALIDATION_ERROR { fields: [{ field, rule }] }`. Valem no POST e no PATCH (seção inteira, como na v1) e na publicação, quando a regra depende de data.
**PATCH (corrigido 03/11, B2 do QA):** o PATCH valida o template **mesclado** inteiro (o que fica salvo) com as mesmas regras e a mesma ordem do POST, inclusive o relógio, o `notAvailable` e os 422, mesmo quando a seção com problema não veio no corpo. **Exceção:** corpo só com `name` e/ou `isDefault` salva sem essa revalidação (renomear ou trocar o padrão não pode falhar); o envio continua barrando o template que não serve.

| campo | regra (`rule`) | quando |
|---|---|---|
| `campaign.objective` | `isIn` | fora dos 6 (lista do template = `MetaTemplateObjective`; o Custom continua com 4) |
| `campaign.budgetType` | `isIn` | diferente de `DAILY`/`LIFETIME` |
| `campaign.dailyBudgetMinor` | `isInt` | DAILY e < 1 |
| `campaign.dailyBudgetMinor` | `zeroForLifetime` | LIFETIME e ≠ 0 |
| `campaign.lifetimeBudgetMinor` | `isInt` | LIFETIME e não é inteiro entre 1 e o teto |
| `campaign.lifetimeBudgetMinor` | `notAllowed` | DAILY e não nulo |
| `campaign.destination` | `lifetimeCboNeedsNewCampaign` | CBO + LIFETIME + REUSE_CAMPAIGN |
| `adset.optimizationGoal` | `isIn` | valor fora da tabela do §2.1 pro objetivo |
| `adset.optimizationGoal` | `notForObjective` | não nulo com Sales/Leads/App/Traffic |
| `adset.pixelId` | `notForObjective` | pixel ou evento com AWARENESS/ENGAGEMENT (o erro sai em `pixelId`, mesmo quando o problema é só o evento) |
| `adset.schedule.start` | `isLocalDateTime` / `inPast` | formato inválido / ao salvar, mais de 5 min no passado (no fuso da conta) |
| `adset.schedule.end` | `isLocalDateTime` / `inPast` | formato / `AT` no passado |
| `adset.schedule.end` | `minDuration24h` | `AT` menos de 24 h depois do início (início `null` = agora) |
| `adset.schedule.end` | `isInt` | `AFTER_DAYS` fora de 1–365 |
| `adset.schedule.end` | `requiredForLifetime` | LIFETIME sem fim |
| `adset.locales` | `isLocaleList` | > 50, chave não inteira (1–100000), nome > 100 ou chave repetida |
| `adset.customAudiences` / `adset.excludedCustomAudiences` | `isAudienceList` | > 20, id fora de 1–64 caracteres, nome > 200 ou repetido |
| `adset.excludedCustomAudiences` | `includedAndExcluded` | id nas duas listas |
| `ad.instagramAccount` | `isInstagramAccount` | não é `{ id (1–64), username (≤ 100) }` |
| `ad.instagramAccount` / `adset.customAudiences` / `adset.excludedCustomAudiences` | `notAvailable` | o id não aparece mais na lista da conta (§4). Checado ao salvar e no envio. Se a Graph estiver fora (`META_UNAVAILABLE`), a checagem **é pulada ao salvar** e roda no envio |

**422** (depois do 400, na ordem da v1): `META_PIXEL_REQUIRED` (igual v1, só Sales/Leads/App), depois `META_BUDGET_TOO_LOW` (DAILY igual v1; LIFETIME com o total do §2.2, quando os dias dão pra calcular: `AT`→`AT`, início `null`/`AT` + `AFTER_DAYS`, início `null` + `AT` contra agora).

**No envio** (`POST /creatives/:id/meta/publish { templateId }` e `POST /meta/publish-batch`), com o template já salvo:
- O início que já passou vira "agora" e o `start_time` não vai.
- Fim `AT` a menos de 24 h do início efetivo dá **400** `VALIDATION_ERROR { fields: [{ field: 'adset.schedule.end', rule: 'inPast' | 'minDuration24h' }], templateId }`. A tela abre o template no Conjunto. Esse formato com `templateId` é o mesmo da v1 (`ad.primaryText` / `inheritedEmpty`).
- O total abaixo do mínimo com os dias resolvidos dá 422 `META_BUDGET_TOO_LOW` com `budgetType`/`days`.
- Instagram ou público que sumiu dá 400 `notAvailable`.

## 4. Endpoints novos (listas pro editor)
Todos ficam no `MetaController` (`/meta`), com papéis **OWNER, ADMIN, MEMBER** (os mesmos de quem edita template; CLIENT vê o editor só leitura com os nomes gravados e não chama as listas). Valem pra **conta e Página selecionadas**.
Erros comuns (iguais aos de `GET /meta/options`): 503 `META_NOT_CONFIGURED`, 422 `META_NOT_CONNECTED`, 422 `META_SELECTION_MISSING`, 422 `META_TOKEN_INVALID` (marca a conexão), 422 `META_PERMISSION`, 503 `META_UNAVAILABLE { reason, retryAfterSec }`.

| método e rota | entrada | saída (`data`) | notas |
|---|---|---|---|
| `GET /meta/instagram-accounts` | — | `MetaInstagramAccountsResponse` `{ accounts: { id, username, profilePicUrl, source: 'AD_ACCOUNT' \| 'PAGE' }[], pageLookup: 'ok' \| 'unavailable' \| 'no_page' }` | ordem: PAGE primeiro, depois por username. Sem cache (a lista é curta e muda quando o cliente liga uma conta) |
| `GET /meta/custom-audiences` | — | `MetaCustomAudiencesResponse` `{ audiences: MetaCustomAudienceOption[], truncated }` | até 500, `updatedAt` desc. Cache de 5 min por conta no processo. O web filtra local |
| `GET /meta/locales` | — | `MetaLocalesResponse` `{ locales: { key, name }[] }` | lista inteira, `name` asc, em inglês (`locale=en_US`). Cache de 24 h por versão da Graph, igual pra todo workspace |

**Mudança aditiva em rota existente:** `GET /meta/connection` passa a trazer `adAccount.minDailyBudgetMinor` (do último health; `null` se não souber), pra a tela validar diário e total antes do 422. É o "desejável 1" da spec de design §9.
`POST/PATCH /meta/templates`, `POST /meta/templates/import`, `POST …/publish` e `POST /meta/publish-batch` não mudam de rota nem de formato: só aceitam ou devolvem os campos novos.

**Erros do `GET /meta/templates` (corrigido 03/11, B1 do QA):** a lista lê só o nosso banco, então **não exige token válido**: responde 200 com a conexão `TOKEN_INVALID` (é o que deixa o editor abrir na F4 com a faixa âmbar). Erros: 422 `META_NOT_CONNECTED` (sem conexão ou `DISCONNECTED`) e 422 `META_SELECTION_MISSING`. Não há `GET /meta/templates/:id`: o editor acha o template na lista. `POST`/`PATCH`/`DELETE`/`import`/publicar continuam exigindo token válido (422 `META_TOKEN_INVALID`), inclusive o PATCH só de nome.

## 5. Persistência
- **Sem migração Prisma.** `MetaPublishTemplate.campaign/adset/ad` já são `Json` e os campos novos entram dentro deles. `MetaPublication.settings` também é `Json` e recebe os resolvidos do §6.
- **Leitura de template v1:** ausente = padrão v1. O `present()` **não** preenche os campos novos (devolve o que foi gravado). Quem lê trata ausente como v1.
- Ao salvar com o editor v2, o web pode mandar os campos novos com valor neutro (`budgetType: 'DAILY'`, `schedule: null`, listas vazias, `instagramAccount: null`). O backend grava como vier.

## 6. Publicação: mapeamento exato pra Graph (v25)
O backend resolve no envio e grava em `MetaPublication.settings` (campos opcionais novos em `MetaPublishSettings`): `budgetType`, `lifetimeBudgetMinor`, `startTime`, `endTime` (UTC ISO), `optimizationGoal`, `locales` (só as chaves), `customAudienceIds`, `excludedCustomAudienceIds` e `instagramUserId`. A porta recebe isso em `MetaPublishStructure` (campos novos abaixo) e monta os corpos:

**Campanha (`POST act/campaigns`)**, sempre `status PAUSED`, `buying_type AUCTION` e `special_ad_categories`:
- `objective`: o do template, inclusive `OUTCOME_AWARENESS` / `OUTCOME_ENGAGEMENT`.
- CBO + DAILY: `daily_budget`, `bid_strategy` (igual v1). CBO + LIFETIME: `lifetime_budget`, `bid_strategy`. ABO: sem orçamento na campanha (igual v1).

**Conjunto (`POST act/adsets`)**:
- ABO + DAILY: `daily_budget`, `bid_strategy`. ABO + LIFETIME: `lifetime_budget`, `bid_strategy`. CBO: sem orçamento. `bid_amount` sempre aqui quando há cap (igual v1).
- `start_time` só quando o `startTime` é futuro. `end_time` quando `endTime` não é nulo. LIFETIME sempre tem `end_time`, porque a Meta exige ("end_time required when lifetime_budget is specified").
- `optimization_goal`, `billing_event`, `promoted_object` e `destination_type`: tabela do §2.1. Para Sales/Leads/App/Traffic a função `optimizationFor` da v1 não muda.
- `targeting` (além da v1): `locales: [keys]` se a lista não estiver vazia; `custom_audiences: [{id}]` e `excluded_custom_audiences: [{id}]` se não estiverem vazias.

**Criativo (`POST act/adcreatives`)**: `object_story_spec.instagram_user_id` quando `instagramUserId` não é nulo. O `page_id` continua sendo o da conexão. O resto fica igual à v1.

**`MetaPublishStructure`** (porta, `api/src/integracoes/contrato.ts`; dono maquina-ia) ganha estes campos opcionais: `budgetType?`, `lifetimeBudgetMinor?`, `startTime?`, `endTime?`, `optimizationGoal?`, `locales?: number[]`, `customAudienceIds?: string[]`, `excludedCustomAudienceIds?: string[]`, `instagramUserId?: string | null`. Ausente = v1. A Awareness também precisa do `pageId`, que já está em `MetaPublishInput`.

**REUSE:** `campaignShapeChanged` também compara `budgetType`. A combinação CBO + LIFETIME + REUSE não chega aqui (é barrada no §3).

## 7. Importação de campanha existente (`POST /meta/templates/import`)
A porta passa a ler mais estes campos (`TEMPLATE_FIELDS`): campanha `buying_type`; ad set `destination_type` (o `targeting` já vem inteiro); anúncio `creative{…, instagram_user_id, object_story_spec}` (a `object_story_spec` já vem, ler também `instagram_user_id` de dentro dela). `MetaTemplateSourceRead` ganha `campaign.buyingType`, `adset.destinationType` e `ad.creative.instagramUserId` (opcionais).

| origem na Graph | vira no template | vai em |
|---|---|---|
| `objective` AWARENESS/ENGAGEMENT | `campaign.objective` | — |
| `optimization_goal` aceito pro objetivo (§2.1); ENGAGEMENT com `destination_type` ON_VIDEO/ON_POST | `adset.optimizationGoal` | — |
| ENGAGEMENT com outro `destination_type` (MESSENGER, WEBSITE+pixel…) ou meta fora da tabela | padrão do objetivo | `unsupported` (`adset.optimizationGoal` / `adset.destinationType`) |
| `lifetime_budget` da campanha | CBO + LIFETIME, `destination: NEW_CAMPAIGN` (regra do §2.2) | — |
| `lifetime_budget` do ad set | ABO + LIFETIME | — |
| `start_time` + `end_time` do ad set | `schedule = { start: null, end: { kind: 'AFTER_DAYS', days: max(1, round((end − start)/1 d)) } }` | `adjusted` ("Ran Nov 1–8 → runs 7 days from publish") |
| só `end_time` (sem `start_time`) | `AFTER_DAYS` contado a partir de agora, se o fim for futuro; senão `schedule: null` | `adjusted` |
| `targeting.locales` | `adset.locales` (nome tirado da lista de `/meta/locales`; se não achar, `"Locale <key>"`) | — |
| `targeting.custom_audiences` / `excluded_custom_audiences` (`[{id,name}]`) | `adset.customAudiences` / `excludedCustomAudiences` | — |
| `instagram_user_id` do criativo | `ad.instagramAccount` (username tirado da lista do §4; se não achar, `username = id`) | — |
| sem orçamento diário nem total | `dailyBudgetMinor: 0`, DAILY (igual v1: a pessoa preenche) | `unsupported` igual v1 |

**Continuam em `unsupported`** (e aparecem na faixa "Not copied: …"): `adset.targeting.flexible_spec` e `exclusions` (interesses, comportamentos, segmentação detalhada), `interests`/`behaviors` soltos, `geo_locations` além de `countries` (cidades, regiões, CEP, `custom_locations`), `excluded_geo_locations`, `connections`/`excluded_connections`, `campaign.buyingType` RESERVED, criativo com `asset_feed_spec` (flexível/dinâmico) ou `child_attachments` (carrossel), `bid_strategy` `LOWEST_COST_WITH_MIN_ROAS`, `adset_schedule` (horário por dia), `attribution_spec`, `promoted_object.application_id`, e qualquer outra chave de `targeting` que o template não conhece.
`TARGETING_KNOWN` ganha `locales`, `custom_audiences` e `excluded_custom_audiences`. Saem do `unsupported` os campos `campaign.lifetimeBudget`, `adset.lifetimeBudget`, `adset.schedule` e `campaign.schedule` (o `stop_time` da campanha é só leitura e é ignorado).

## 8. O que muda no editor (resumo pro frontend)
- O "Soon" sai de: objetivos Awareness/Engagement, Budget type Lifetime, Schedule, Languages, Custom audiences e Instagram account. Continuam "Soon": Reservation, A/B test, Detailed targeting, Conversion location App/Messaging, Carousel/Flexible.
- **Mapa de erro → nível** (acrescenta ao §6 da spec de design): `campaign.lifetimeBudgetMinor` e `campaign.budgetType` vão pra **Campanha se CBO, Conjunto se ABO** (como o diário). `campaign.destination` vai pra Campanha. `adset.optimizationGoal`, `adset.schedule.*`, `adset.locales`, `adset.customAudiences` e `adset.excludedCustomAudiences` vão pro Conjunto. `ad.instagramAccount` vai pro Anúncio. Um 400 de publicação com `templateId` abre o editor no nível do campo.
- **Resumo da árvore:** Campanha "Awareness · CBO · US$ 300 total"; Conjunto "Reach · 7 days · US · EN · +2 audiences −1"; Anúncio "@conta".
- **Trocar o objetivo pra Awareness/Engagement** limpa `pixelId`/`pixelEvent` e põe `optimizationGoal` no padrão. Voltar pra Sales limpa o `optimizationGoal`.
- **Lifetime + CBO** força `destination = NEW_CAMPAIGN` e mostra o porquê.

## 9. Mock
### API (`META_MODE=mock`, `FakeMetaService`; dono maquina-ia)
- `listInstagramAccounts`: `act_mock_1` devolve `ig_mock_1` (@hookmill.demo, AD_ACCOUNT) + `ig_mock_page` (@mock.page, PAGE), `pageLookup: 'ok'`. `act_mock_2` devolve `[]` com `pageLookup: 'unavailable'`.
- `listCustomAudiences`: `ca_mock_buyers` (WEBSITE, 12 000–15 000, usable), `ca_mock_lal_1` (LOOKALIKE, 1,2 M–1,4 M, usable), `ca_mock_small` (CUSTOM, usable false, "Audience too small"), `ca_mock_flagged` (CUSTOM, usable false, operation 471), `truncated: false`.
- `listLocales`: 8 itens fixos, entre eles `{6,'English (US)'}`, `{24,'English (UK)'}` (confirmados na doc). Os outros podem ser ilustrativos, desde que não colidam; o live vem da Graph.
- **Gatilhos:** id `ig_mock_gone` ou `ca_mock_gone` gravado num template não aparece nas listas, o que exercita o 400 `notAvailable` no envio. `[mock:meta-destination]` no `primaryText` faz o `createAdSet` lançar `META_ERROR` ("destination_type not available for this account"), simulando o beta do ON_VIDEO.
- `readTemplateSource`: o `mock_adset_cbo_1` (que já tem público e agendamento) passa a sair copiado. Ele ganha `flexible_spec` com 1 interesse e `geo_locations.cities` com 1 cidade, pra o `unsupported` continuar exercitado. O `mock_cmp_life` (CBO total US$ 300) importa como LIFETIME + NEW_CAMPAIGN. Criar uma campanha mock de Awareness (`mock_cmp_awareness`, REACH, `ig_mock_1` no criativo) pra importar.
- `createCampaign`/`createAdSet`/`createAdCreative` gravam no escopo o tipo de orçamento, o agendamento e o objetivo, pra a leitura ao vivo da Campaigns refletir.

### Web (MSW, `web/src/mocks/`; dono maquina-frontend)
- Os 3 GETs do §4 com **os mesmos fixtures** da API.
- `GET /meta/connection` com `adAccount.minDailyBudgetMinor: MIN_BUDGET_MINOR` (500).
- O `check()` de `handlers-meta-templates.ts` espelha o §3: pelo menos LIFETIME sem fim, `lifetimeCboNeedsNewCampaign`, `includedAndExcluded`, pixel com Awareness/Engagement, `minDuration24h` e o mínimo do total (`500 × dias`).
- Template com `[mock:schedule-expired]` no nome faz o publish devolver 400 `adset.schedule.end` / `inPast` com `templateId`.

## 10. Testes mínimos (cada dono, só o recorte; a suíte completa é do QA)
- **I:** corpos da Graph pra cada linha da tabela do §2.1, CBO/ABO × DAILY/LIFETIME, com e sem `start_time`/`end_time`, `locales`/públicos/`instagram_user_id` presentes e ausentes (template v1 = corpo idêntico ao de hoje, por snapshot).
- **B:** todas as regras do §3; o template v1 salvo antes passa sem mudança; resolução do agendamento no envio (início passado, `AFTER_DAYS`, fuso `America/Sao_Paulo` e um com horário de verão); mínimo do total; importação das linhas do §7.
- **F:** `build()` com as mesmas regras, o mapa de erro → nível e a troca de objetivo limpando o pixel.

## 11. Divisão do trabalho (sem arquivo em comum)
Pela `TIME.md`, a pasta `api/src/integracoes/` é do **maquina-ia**, então a parte da Graph e do mock é dele. Se o Gusta quiser só 2 agentes, o backend assume esse bloco com o ok do dono. Mesmo assim os arquivos não se cruzam.

| id | dono | o quê | arquivos | depende de |
|---|---|---|---|---|
| A-tipos | arquiteto | tipos v2 (**feito**) | `contratos/src/meta.ts`, `contratos/src/meta-templates.ts` | — |
| B0 | arquiteto (**feito 03/11**, com ok do coordenador) | `CTA_BY_OBJECTIVE` com os 6 (Awareness/Engagement = `LEARN_MORE`). O DTO do Custom continua com os 4 (`OBJECTIVES`) | `api/src/meta/publicacao.service.ts` | — |
| F0 | arquiteto (**feito 03/11**) | chaves `publish.form.objective.OUTCOME_AWARENESS/ENGAGEMENT` (en: Awareness/Engagement; pt-BR: Reconhecimento/Engajamento) | `web/messages/en.json`, `web/messages/pt-BR.json` | — |
| A0 | arquiteto (**feito 03/11**) | `MetaObjective` com os 6; `MetaTemplateObjective` virou alias; `tsc` verde em contratos, api, web e testes | `contratos/src/meta.ts`, `contratos/src/meta-templates.ts` | — |
| I1 | ia | porta: `listInstagramAccounts`, `listCustomAudiences`, `listLocales` (assinaturas: §4 sem o envelope), campos novos de `MetaPublishStructure` e `MetaTemplateSourceRead`, `PORTA.md` | `api/src/integracoes/contrato.ts`, `api/src/integracoes/meta/PORTA.md` | A-tipos |
| I2 | ia | live: corpos do §6 (`campaignBody`, `adSetBody`, `creativeBody`, otimização por objetivo), leituras do §4 (arquivo novo `meta/listas.ts`, com cache dos locales e dos públicos), `TEMPLATE_FIELDS` do §7 | `api/src/integracoes/meta/publicacao.ts`, `templates.ts`, `listas.ts`, `live.service.ts`, `off.service.ts`, specs | I1, A0 |
| I3 | ia | mock do §9 (API) | `api/src/integracoes/meta/mock.service.ts`, `mock.spec.ts` | I1 |
| B1 | backend | validação do §3 (lista de objetivos do template com os 6), `pixelMissing`/`campaignShapeChanged`, `templateFromSource` do §7, checagem `notAvailable` e do mínimo total no `check()` | `api/src/meta/templates.ts`, `api/src/meta/templates.service.ts`, specs | A0, I1 |
| B2 | backend | rotas do §4 (controller + service fino que chama a porta via `viaPorta`), `minDailyBudgetMinor` no `present()` da conexão | `api/src/meta/meta.controller.ts`, `api/src/meta/listas.service.ts` (novo), `api/src/meta/conexao.service.ts`, `api/src/meta/meta.module.ts` | I1 |
| B3 | backend | publicação: `templateSettings` resolve o agendamento (fuso da conta) e grava os campos do §6, gate de envio do §3, `structureOf` com os campos novos | `api/src/meta/publicacao.service.ts` (`structureOf` está em `templates.ts`, já do B1: o B3 só chama) | B1, I2 |
| F1 | frontend | editor: os 6 campos do §2/§8, `build()`/`draftOf()` com o §3, mapa de erro, resumo da árvore, prévia com o @ | `web/src/components/meta/templates/*` (o editor de página inteira quando existir) | F0, A0 |
| F2 | frontend | hooks das 3 listas + MSW do §9 | `web/src/lib/api/*` (hooks meta), `web/src/mocks/handlers-meta-templates.ts`, `handlers-meta.ts`, `publish.ts`/`fixtures.ts` | A-tipos |
| Q1 | qa | e2e no mock: criar template com cada campo, importar `mock_cmp_life` e `mock_cmp_awareness`, publicar lote com LIFETIME + `AFTER_DAYS`, `notAvailable`, `inPast` | `testes/` | B3, I3, F1 |
| Q2 | qa + Gusta | sonda real (§13 P3): **parada, o Gusta disse "ainda não" em 03/11** | — | novo ok |

**Ordem (03/11):** B0, F0 e A0 feitos. Agora rodam em paralelo: ia (I1 primeiro, depois I2 e I3), backend (validação do B1 já; a parte de import do B1 e o B2 assim que o I1 publicar a assinatura da porta) e frontend (F1 e F2 já, contra o MSW). Depois B3 (depende de B1 e I2) → Q1. A Q2 fica parada.
**i18n novo do editor (F1)** é do frontend; edite `web/messages/*.json` de forma cirúrgica (os dois arquivos têm trabalho não commitado de outras frentes).
**Regra de envio:** o web só manda as chaves novas pra API **real** depois do B1. Antes disso o validador da v1 responde `notAllowed`. No MSW pode desde o primeiro dia.

## 12. Riscos
1. **ON_VIDEO / ON_POST "em beta limitado"**: a referência de Ad Set diz isso dos `destination_type` `ON_*`. Engagement pode ser recusado na conta. Mitigação: sonda real antes de liberar (P3). Se recusar, o Engagement sai com o erro da Meta (`META_ERROR` com a mensagem dela) e decidimos se ele volta pro "Soon".
2. **Instagram ligado à Página:** `{page}/instagram_accounts` pede token da Página, e os escopos de hoje (`ads_management`, `ads_read`, `business_management`, `pages_show_list`) podem não bastar. Nesse caso só aparecem as contas ligadas à conta de anúncio (`pageLookup: 'unavailable'` + hint). Ninguém fica preso: dá pra publicar com a Página como identidade.
3. **Mínimo do total é estimado** (diário × dias). A Meta tem mínimos diferentes por meta de otimização (impressão × clique). O 422 que vem da Graph na publicação continua mandando (`META_BUDGET_TOO_LOW`, igual hoje).
4. **Lance com cap + REACH/AD_RECALL_LIFT** e **categoria especial + lookalike/idioma** podem ser recusados pela Meta. A gente não valida isso antes (não achei regra documentada), e o erro dela chega com a mensagem.
5. **Advantage+ audience ligado** transforma o público incluído em sugestão. Isso é comportamento da Meta: a tela avisa, o contrato não bloqueia.
6. **Fuso:** se a conta mudar de fuso depois de salvar, um horário `AT` muda de significado. Raro, e aceito.
7. **Escrita real na Graph ainda nunca rodou** com estrutura de template (meta-templates-v1). A v2 soma corpos novos em cima disso, então a sonda Q2 é obrigatória antes de dizer "funciona".
8. Nomes de campo conferidos na doc v26 (a v25 não está mais publicada). `instagram_user_id`, `lifetime_budget`, `start_time`/`end_time`, `locales`, `custom_audiences`/`excluded_custom_audiences` e `destination_type` existem desde antes da v22. A sonda Q2 confirma na v25.

Refs (02/11): Graph reference Ad Set e Campaign (`developers.facebook.com/docs/marketing-api/reference/ad-campaign` e `…/ad-campaign-group`, v26), `object_story_spec` (v26: só `instagram_user_id`), guias `instagram/ads-api/guides/pages-ig-account.md` e `ig-accounts-with-business-manager.md`, `marketing-api/audiences/reference/targeting-search.md` (adlocale), `marketing-api/bidding/overview/budgets.md`, referência Custom Audience.

## 13. Decisões do Gusta (03/11)
- **P1 SIM.** O agendamento aceita fim relativo ("termina N dias depois de publicar") além da data fixa. O início padrão é "ao publicar", e um template novo vem sem agendamento.
- **P2 SIM.** CBO + orçamento total só com `NEW_CAMPAIGN` (regra `lifetimeCboNeedsNewCampaign`).
- **P3 AINDA NÃO.** Sem sonda real na Meta por enquanto; tudo em mock (API `META_MODE=mock` e MSW). A Q2 fica parada até novo ok. Os riscos 1, 2 e 8 do §12 seguem em aberto até lá: nada de declarar "funciona na Meta".
- **P4 SIM.** O Custom fica como está, sem os campos novos.
- **QA 03/11 (decisão do dono da sessão):** B1, a lista de templates abre com o token expirado (§4, "Erros do GET"). B2, o PATCH revalida o template mesclado inteiro, exceto corpo só com `name`/`isDefault` (§3).

## 14. Envio com ajustes só pra esse envio (`override`) — 04/11
Decisão do Gusta (04/11): no envio pra Meta a pessoa revisa todas as configurações do template no editor completo, e **as mudanças valem só pra esse envio**. O template fica intacto. Dono: backend (implementado em 04/11). O web liga a flag `INLINE_SEND` em `web/src/components/meta/templates/template-editor.tsx`.

**Corpo** (tipos em `contratos/src/meta-templates.ts`: `MetaTemplateOverride`, `MetaPublishWithTemplateBody.override?`, `MetaPublishBatchBody.override?`):
- `POST /creatives/:id/meta/publish` → `{ templateId, override?: { campaign?, adset?, ad? } }`
- `POST /meta/publish-batch` → `{ creativeIds, templateId, override? }` (o mesmo override vale pro lote inteiro)

**Regras:**
1. Cada nível é opcional. O nível que vem chega **inteiro**, com o mesmo formato e a mesma validação do `MetaTemplateBody` (`templateBodyErrors`), e **substitui** o nível do template. Não existe merge campo a campo dentro de um nível. O editor manda os três níveis do `build()`.
2. Erros de formato: `400 VALIDATION_ERROR` com `fields` em `campaign.*`, `adset.*` e `ad.*`, os mesmos caminhos do POST de template. Chave fora de `campaign`/`adset`/`ad` volta como `override.<chave>` `notAllowed`. `override` sem `templateId` volta como `override` `requiresTemplateId`.
3. As regras cruzadas (§3: objetivo × meta/pixel, total × fim) rodam **sobre o mesclado**. Exemplo: override com objetivo Awareness e o conjunto do template com pixel dá `adset.pixelId` `notForObjective` (+ `templateId` nos details). Depois disso, o gate de envio de sempre (agendamento no fuso da conta, `notAvailable`, `META_PIXEL_REQUIRED`, `META_BUDGET_TOO_LOW`) roda sobre o mesclado.
4. **Snapshot:** toda publicação com template grava `MetaPublication.templateSnapshot` (Json: `{ campaign, adset, ad, overridden: ('campaign'|'adset'|'ad')[] }`), **com ou sem override**. O job, o retry e o `structureOf` leem o snapshot. Publicação anterior a 04/11 (`templateSnapshot` null) continua lendo o template ao vivo. O snapshot é gravado sempre porque assim editar o template depois não muda o que o retry manda. Migração `20261104000200_meta_publication_template_snapshot`.
5. **REUSE:** quando a campanha do envio tem a mesma forma da campanha do template (`campaignShapeChanged` falso: orçamento e padrão de nome podem mudar), o anúncio entra na campanha guardada, e uma campanha nova continua sendo gravada em `reuseCampaignId` do **template original**. Se o override muda a forma (objetivo, CBO/ABO, lance, categorias, tipo de orçamento ou destino), o envio cria campanha nova (1× por lote) e **não** toca no `reuseCampaignId`, porque a campanha guardada tem outra forma. A mesma conta vale no retry contra o template ao vivo.
6. A resposta (`MetaPublication`) não muda. Os `settings` já trazem o resolvido do mesclado. O snapshot não é exposto na view.

**Linha que o web manda** (modo revisão, mudanças só pra esse envio): `api.meta.publish(ids[0], { templateId: template.id, override: { campaign: r.body.campaign, adset: r.body.adset, ad: r.body.ad } })` e `api.meta.publishBatch({ creativeIds: ids, templateId: template.id, override: { campaign: r.body.campaign, adset: r.body.adset, ad: r.body.ad } })`.

**Testes (recorte):** `api/src/meta/templates.spec.ts` (bloco §14) e `api/src/meta-override.int.spec.ts` (mock da Meta: validação, publicar 1, forma da campanha × REUSE, lote, retry lendo o snapshot).
