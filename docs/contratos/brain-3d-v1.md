# Brain 3D v1 · o Brain vira o grafo da /3d-brain
Data: 2026-10-22 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 22/10** (D1-D5 do §6 como recomendadas; `decisions/log.md`). **A5 feito 22/10:** tipos em `@maquina/contratos` (`contratos/src/brain.ts`, exportado no `index.ts`), rotas no `api.md`. **Revisão 22/10 pelo mockup aprovado** (`design/brain-3d-2026-10-22.md` §2 e §9): 8 categorias + o cliente no centro, vencedor = estado (anel lima), publicação = aresta, ângulo = atributo do gancho, roteiro vira nó, sem nó fantasma de seção vazia (§7 lista o que mudou). Sem migração. Código liberado: B5 ‖ F5 (depois do F4) → Q5 (§5).
Base: pedido do Gusta 22/10 ("o Brain deveria ser igual à skill /3d-brain"); referência `apps/3d-brain/` (`src/app.js`, `constellation.js`, `growth.js`); Brain atual `web/src/app/(app)/brain/page.tsx` + `components/brain/brain-knows.tsx` + `lib/brain.ts` ([`fase2-agencia.md`](fase2-agencia.md) §5/D5); tour em [`onboarding-v2.md`](onboarding-v2.md) §3.3-3.4; dados Meta em [`meta-v1.md`](meta-v1.md) e [`campanhas-v1.md`](campanhas-v1.md). Visual é do design (`design/brain-3d-2026-10-22.md`, mockup aprovado); aqui só API, regras e tarefas.

## 0. Resumo em 5 linhas
1. **Uma rota de leitura nova**, `GET /brain/graph`, monta por workspace o grafo `{ nodes, edges, counts, meta }`: cliente no centro, negócio, ofertas, público, provas, instruções, metas, ganchos, roteiros, criativos e anúncios da Meta. `GET /brain/node/:id` serve o drawer (com vídeo quando existe). **Sem migração nem custo de IA.**
2. **Teto de 800 nós com amostragem por prioridade** (setup → vencedores → publicados → aprovados → resto); `counts` traz o total real de cada tipo.
3. **Web com a mesma lib da /3d-brain** (`3d-force-graph` + `three`), só na rota `/brain`; celular abre em List (3D a um toque), sem WebGL = List.
4. **O % do Brain não muda de lugar**: `brainCompleteness()` no web (fase2 D5), com `GET /workspace` + `GET /offers`. O grafo não manda `completeness`.
5. Estimativa: **~4 dias úteis** depois que o frontend sair do Campaigns. Não toca em `api/src/meta/` nem em `api/src/integracoes/meta/`.

## 1. Rotas (módulo novo `api/src/brain/`, dono backend)
Convenções do [`api.md` §1](api.md). Só `GET`, com **`@ClientAllowed()`** (fase2 §4: CLIENT lê tudo). Nenhum código de erro novo.

| rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /brain/graph` | `BrainGraphQuery` (`?offerId=` recorta pros nós ligados àquela oferta + centro/negócio/metas; `?fresh=1`) | `BrainGraph` | 400 `VALIDATION_ERROR`; 404 (offerId de outro workspace ou arquivada) | web `/brain`, tour. Todos os papéis |
| `GET /brain/node/:id` | `id` = `<kind>:<chave>` (§2.1), URL-encoded. **Singular `node`** (a spec do design escreveu `nodes`; vale esta) | `BrainNodeDetail` | 400 `VALIDATION_ERROR` (kind/formato); 404 (não existe, outro workspace, arquivado, `meta_ad` com `META_MODE=off` ou sem conexão) | drawer. Todos os papéis |

### 1.1 Nós (`kind` → `category`)
| kind | category | 1 nó por | fonte | entra quando |
|---|---|---|---|---|
| `workspace` | center | workspace | `Workspace.name` | sempre |
| `business` | business | workspace | `businessType`, `industry`, `market`, `websiteUrl` | algum preenchido |
| `proof` | business | oferta | `Offer.proof` | preenchido |
| `instructions` | business | oferta | `Offer.notes` (voz, o que evitar) | preenchido |
| `offer` | offers | oferta não arquivada (até 30, recentes) | `name`, `kind`, `what`, `promise`, `offerAndPrice`, `cta` | sempre |
| `audience` | audience | oferta | `Offer.audience` + `pains`. **1 nó por oferta**: público é texto único, não há segmentos | preenchido |
| `goal` | goals | workspace | `monthlySpendCapUsd` + resultado padrão derivado do `businessType` | algum dos dois |
| `hook` | hooks | **texto de gancho normalizado** (trim, minúsculas, espaços colapsados; id = sha1 12 hex) | `Script.blocks[0].speech` do roteiro escolhido dos criativos incluídos **e** `Teardown.sections.hook.spoken` dos campeões cujo `metaAdId` está nos anúncios incluídos. Sem entidade `Hook` nova | ≥ 1 uso |
| `script` | scripts | roteiro **escolhido** (`Creative.selectedScriptId`) de criativo incluído | `letter`, `angle`, `durationSec`, `blocks` (no drawer) | entra junto com o criativo |
| `creative` | creatives | criativo não arquivado | `name`, `state`, `isWinner`, `origin`, `variationCode`, `engine`, `thumbnailFileId`; `sourceMetaAdId`/`sourceCreativeId` via `Champion` (`championId` → `metaAdId`/`sourceCreativeId`, **colunas que já existem**) | amostragem §1.3 |
| `meta_ad` | meta_ads | `MetaAdSnapshot` da conta escolhida | `name`, `verdict`, `trend`, `effectiveStatus`, `metrics` 30 d, `thumbnailUrl`, `videoId`, `adCreatedTime` | `META_MODE ≠ off` e conectado; todos os `WINNER`, todos os publicados pelo HookMill, depois top por gasto 30 d, até 200 |

Vencedor não é nó nem categoria: `node.winner = true` em criativo `isWinner` e em anúncio `WINNER`. Fora da v1: roteiros não escolhidos, rostos, cenas, lotes, campeões como nó (aparecem como `iterated_from` e no drawer do criativo), CPA alvo (não existe coluna; recusado, ver §7).

### 1.2 Arestas (`from → to`)
| kind | de → para | regra |
|---|---|---|
| `part_of` | `workspace` → `business` / `offer` / `goal` | nó existe |
| `part_of` | `workspace` → `meta_ad` | anúncio sem nenhum outro elo (nada inventado) |
| `targets` · `uses_proof` · `instructed_by` | `offer` → `audience` / `proof` / `instructions` | campo preenchido |
| `for_offer` | `hook` → `offer`; `script` → `offer`; `meta_ad` → `offer` | oferta do criativo dono do roteiro; anúncio: oferta do criativo publicado ou `Champion.offerId` do campeão importado dele |
| `speaks_to` | `script` → `audience` | a oferta do criativo tem nó `audience` |
| `opens_with` | `script` → `hook` | roteiro com `blocks[0].speech` |
| `made_from` | `creative` → `script` | `selectedScriptId` |
| `published_as` | `creative` → `meta_ad` | `MetaPublication` `PAUSED`/`ACTIVE` com `metaAdId` no snapshot; `edge.publication` traz status, datas e quem publicou |
| `uses_hook` | `meta_ad` → `hook` | campeão importado desse anúncio (`Champion.metaAdId`) com teardown e `sections.hook.spoken` |
| `iterated_from` | `creative` → `meta_ad` | `Champion.metaAdId` do campeão de origem, se o anúncio estiver incluído |
| `iterated_from` | `creative` → `creative` | `Champion.sourceCreativeId`, se incluído |

Só arestas entre nós incluídos; teto 2 500.

### 1.3 Limites, amostragem, cache
- **Teto 800 nós.** Ordem: `workspace`, `business`, `goal` → ofertas com `audience`/`proof`/`instructions` → criativos vencedores → anúncios `WINNER` → anúncios publicados pelo HookMill → criativos `APPROVED` → anúncios por gasto (até 200 no total) → criativos `RENDER_READY` → demais criativos (mais recentes). **Criativo entra como unidade** (criativo + roteiro escolhido + gancho, este deduplicado); a unidade que não cabe inteira para a amostragem. `counts[kind] = { total, shown }`, `truncated`.
- **Consultas:** no máximo 10, com `select`, sem N+1. p95 < 400 ms com 800 nós.
- **Cache:** em memória por `workspaceId` (+ `offerId`), TTL 60 s, `generatedAt` na resposta; `?fresh=1` pula (1 por 10 s por workspace). Web: React Query `staleTime: 60_000`, sem polling.
- **`META_MODE=off` / sem conexão:** 200 sem nós `meta_ad` e sem arestas `published_as`/`uses_hook`/`iterated_from → meta_ad`; `meta = { enabled, connected, lastSyncAt }`. Não é 503 (não é rota da Meta).
- **Papéis:** todos leem tudo, inclusive custo do criativo no drawer (fase2 §4: CLIENT lê qualquer tela).

## 2. Tipos (`contratos/src/brain.ts`; o arquivo é a fonte)
`BrainGraph { generatedAt, nodes: BrainNode[], edges: BrainEdge[], counts: Record<BrainNodeKind, {total, shown}>, meta: BrainMetaState, truncated }` · `BrainNode { id, kind, category, refId, label (creative: name, cai pro adName só se vazio), summary, weight, winner, meta }` (meta tipado por kind: `setupStep` nos nós do setup; `hook { angle, scripts, ads, bestCpa, currency }`; `creative { name, adName, state, status: approved|in_review|draft, isWinner, origin, variationCode, offerId, engine, durationSec, thumbnailUrl, published, sourceMetaAdId, sourceCreativeId }`; `meta_ad { verdict, trend, effectiveStatus, spend30d, cpa, ctr, hookRate, currency, daysRunning, thumbnailUrl, isVideo, fromHookMill, championId }`) · `BrainEdge { from, to, kind, publication? }` · `BrainNodeDetail { node, fields, neighbors, media: { videoUrl, posterUrl } | null, open }`. Constantes `BRAIN_MAX_NODES`, `BRAIN_MAX_EDGES`, `BRAIN_MAX_META_ADS`, `BRAIN_CACHE_TTL_SEC`, `BRAIN_CATEGORY_OF`. O 3d-force-graph usa `source`/`target`: o web mapeia de `from`/`to`.

### 2.1 Ids
`workspace:<wid>`, `business:<wid>`, `goal:<wid>`, `offer:<id>`, `audience:<offerId>`, `proof:<offerId>`, `instructions:<offerId>`, `hook:<sha1 12 hex>`, `script:<id>`, `creative:<id>`, `meta_ad:<metaAdId>`.

### 2.2 Peso (0..1)
`workspace` 1 · `offer` = criativos dela / maior (mín. 0,4) · `hook` = usos / maior (mín. 0,2) · `creative` vencedor 1, `APPROVED` 0,6, `RENDER_READY` 0,4, rascunho 0,25 · `meta_ad` = gasto 30 d / maior gasto (WINNER mín. 0,7) · `script` 0,3 · `business`/`audience`/`proof`/`instructions`/`goal` 0,5.

### 2.3 Drawer
- `open`: nós do setup → `{ route: 'setup', step }` com o passo do `BRAIN_ITEM_STEP` (business 1, offer/proof 3, audience/instructions 4, goal 5): é o "Edit in setup · step N of 6"; `offer` → `offer`; `script` → `{ route: 'creative', id: creativeId, step: 'scripts' }`; `creative` → `creative`; `meta_ad` → `{ route: 'campaigns', id: metaAdId }`; `hook` e `workspace` → null (o web abre o `BrainKnows` no centro).
- `media` (só `creative` e `meta_ad`): criativo = render final (`finalRender`, senão o último render `READY`), pôster = `thumbnailFileId`. Anúncio = o render publicado (`MetaPublication.renderFileId`) se for do HookMill; senão o vídeo do campeão importado dele (`Champion.videoFileId`); senão `videoUrl: null` + `posterUrl = thumbnailUrl` da Meta. URLs assinadas (6 h), geradas só no drawer.
- `fields` por kind: textos do setup; gancho (texto, ângulo, roteiros, anúncios, melhor CPA); roteiro (`blocks`); criativo (motor, duração, `costUsd` somado do `CostEntry`, "iterated from"); anúncio (spend, CPA, CTR, hook rate 30 d, dias rodando, campanha/conjunto).
- Ações do drawer (New concept with this hook, Iterate this ad, Send to Meta, Open in Campaigns) usam rotas que já existem; o web decide pela `meta` (`isVideo`, `published`, `winner`) e pelo papel.

## 3. Web (dono frontend; visual na spec aprovada)
- **Lib:** `3d-force-graph@^1.80` + `three@0.185.1` (iguais aos da /3d-brain), imperativo num `useEffect`; porta pra TS `composeGlobe`/`makeOrbitals` (`constellation.js`), `growth.js`, bloom. Sem `marked`/`dompurify`.
- **Peso:** a /3d-brain empacotada mede **462 KB gzip** (com marked+dompurify); a spec do design estima ~180 KB, **o número que vale é o do `next build`**, registrado pelo frontend na entrega. Em qualquer caso: `next/dynamic(..., { ssr: false })` só em `brain/page.tsx`; nenhum outro arquivo importa `three`/`3d-force-graph` (First Load JS das outras rotas igual ao de antes).
- **List:** gêmeo acessível (seções por categoria, mesmo drawer); padrão no celular (< 761 px, com "Open the 3D view"), sem WebGL e com `prefers-reduced-data`. Reduced-motion: sem rotação, sem partículas, sem replay, bloom desligado.
- **Categoria vazia** = chip tracejado com o motivo (sem nó fantasma), conforme o mockup.
- **CLIENT:** chip "View only"; somem Revisit setup, Edit offer, Edit in setup, New concept, Iterate e Send to Meta.

## 4. Tour e "Edit in setup"
- **Parada `brain`** (API do tour sem mudança): replay de crescimento de ~8 s com o anel do % contando; `#t-brain` no contêiner do palco; no List/reduced-motion, a animação de hoje.
- **"Edit in setup"**: no drawer dos nós do setup (`open.step`) e "Revisit setup" no cabeçalho; só OWNER/ADMIN/MEMBER. Ao voltar, o web invalida `["brain","graph"]`, `["workspace"]`, `["offers"]`.

## 5. Tarefas por agente
| # | dono | o quê | depende de | verificação |
|---|---|---|---|---|
| A5 | arquiteto | tipos `contratos/src/brain.ts` + `index.ts`, `api.md`; revisão pelo mockup. **Feito 22/10** | — | `tsc` do pacote, api e web ok |
| B5 | backend | `api/src/brain/` (module, controller `@ClientAllowed`, service da montagem §1, cache TTL 60 s, DTOs `class-validator`, assinatura de URL pelo `StorageService` existente); lê `MetaAdSnapshot`/`MetaPublication`/`MetaConnection`/`Champion`/`Teardown` direto pelo Prisma, **sem importar `api/src/meta/`**; `META_MODE` pelo `AppConfig`; 1 linha no `app.module.ts`. 1½ d | A5 | Jest + int: workspace novo = só centro + o que o setup tem (sem nó vazio); 2 criativos com o mesmo gancho (SWAP_AVATAR) = 1 nó `hook` com `scripts 2`; publicação vira aresta `published_as` com `publication`, nunca nó; criativo de `POST /iterate { metaAdId }` tem `sourceMetaAdId` e aresta `iterated_from`; anúncio importado com teardown liga `uses_hook`; anúncio sem elo liga `part_of` ao centro; 1 000 criativos → 800 nós, `truncated`, todo vencedor presente, nenhuma aresta pendurada; `META_MODE=off` 200 sem `meta_ad`; drawer de anúncio HookMill traz `videoUrl` do render, de anúncio importado o do campeão, de outro `null`; outro workspace 404; CLIENT 200; ≤ 10 queries; api `tsc` |
| F5 | frontend | palco 3D lazy + List + drawer + chips/busca/atalhos + galeria `G` (dos nós `creative`/`meta_ad` com vídeo) + tour + papéis + MSW. 2½ d | A5, mockup, B5 ou MSW; **depois do F4** | web `tsc` + `next build` (peso da `/brain` registrado; outras rotas iguais); desktop, 390 px, sem WebGL; EN/PT; reduced-motion; CLIENT |
| Q5 | qa | ponta a ponta em mock: cliente novo, cliente cheio (truncado), Meta mock (vencedor → iterate → criativo → publicado), `META_MODE=off`, CLIENT, tour, mobile. 1 d | B5, F5 | só o qa declara "funciona" |
Pastas: B5 `api/src/brain/` + `app.module.ts`; F5 `web/`; Q5 `testes/`. Nada em `api/src/meta/` nem `api/src/integracoes/meta/`.

## 6. Decisões aprovadas 22/10
- **D1** Lib = a da /3d-brain, lazy só na `/brain`. **D2** O que entra + teto 800 nós com totais reais. **D3** Ganchos sem IA (1º bloco do roteiro escolhido + gancho do teardown), deduplicados por texto. **D4** Celular/sem WebGL = List, List também no desktop. **D5** Tour com replay de ~8 s; CLIENT sem botões de edição.

## 7. Revisão pelo mockup aprovado (22/10) e pedidos do design (§9 da spec)
| pedido / mudança | decisão |
|---|---|
| 8 categorias + centro | **aceito**: `category` em todo nó (`BRAIN_CATEGORY_OF`); kinds `brain_section`, `angle`, `champion`, `meta_account`, `publication` saem; entram `business`, `instructions`, `script` |
| Vencedor = estado; publicação = aresta | **aceito**: `node.winner`; `published_as` creative → meta_ad com `edge.publication` |
| Ganchos como entidade `Hook` | **recusado** (migração e escrita nova não aprovadas; decisão do Gusta 22/10: conforme o contrato). Gancho derivado e deduplicado por texto; ângulo vira atributo `hook.meta.angle` |
| `sourceMetaAdId` nos criativos iterados | **aceito sem coluna**: já existe via `Creative.championId` → `Champion.metaAdId` (e `sourceCreativeId`) |
| Vídeo do anúncio da Meta pro player | **aceito em parte, sem coluna**: render publicado (HookMill) ou vídeo do campeão importado (já está no R2). Anúncio de terceiros/não importado: **recusado na v1** (exigiria `GET /{videoId}?fields=source` ao vivo na integração Meta, URL que expira e permissão por vídeo; fora do escopo aprovado). Drawer mostra pôster + "Open in Campaigns" |
| `GET /brain/nodes/:id` | rota é **`/brain/node/:id`** |
| `links { source, target }` | **mantido `edges { from, to }`**; o web mapeia |
| `completeness` no grafo | **recusado**: um número só, `brainCompleteness()` no web (fase2 D5) |
| `sync: MetaSyncState` | **trocado por `meta.lastSyncAt`** (o rodapé só precisa da hora; a derivação do estado mora em `api/src/meta/`, que o Brain não importa) |
| Público em segmentos | **recusado**: é texto único no passo 4; segmentos exigem campo estruturado (migração + onboarding) |
| CPA alvo em Goals | **recusado**: não há coluna; metas = teto mensal + resultado padrão |
| Teto 1 500 do mockup | vale **800** (contrato aprovado) |
