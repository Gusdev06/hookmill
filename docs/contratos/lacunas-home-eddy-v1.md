# Lacunas da Home v2 e do onboarding com o Eddy · contrato v1
Data: 2026-10-31 · Dono: maquina-arquiteto · Status: **aditivo, pedido dos agentes de frontend em 31/10 (via coordenador); implementado no local, aguarda o visto do Gusta.** Nada aqui quebra quem já consome: campo novo é opcional no tipo enquanto houver mock antigo, e a API devolve sempre.
Base: `design/onboarding-eddy-2026-10-31.md` (itens "novo" 1 e 3), `design/home-v2-2026-10-31.md` §6, [`onboarding-v2.md`](onboarding-v2.md), [`brain-3d-v1.md`](brain-3d-v1.md), [`meta-v1.md`](meta-v1.md), [`variacao-auto-v1.md`](variacao-auto-v1.md). Convenções e erros: [`api.md` §1](api.md). Tipos: `contratos/src/onboarding-v2.ts`, `agencia.ts`, `brain.ts`, `meta.ts`, `iteracao.ts`.

## 0. Em 5 linhas
1. **`onboarding.confirmed`** no `Workspace` (`GET /workspace`) e no `WorkspaceRef` (`GET /auth/me`, sessão) + **`PATCH /workspace { confirm }`** idempotente (OWNER/ADMIN). A conversa do Eddy volta no ponto certo em qualquer aparelho. Migração aditiva de 1 coluna.
2. **Logo e 2ª cor na leitura do site** (`OFFER_EXTRACT` → `business.logoUrl/logoSource/secondaryColor/secondaryColorSource`), tirados do HTML e do DOM que a leitura já abre. Nenhuma chamada paga nova; sem achar = `null`.
3. **Brain:** todo nó ganha `needsYou` e `statusLabel`; o **lote do Iterate vira nó** (`kind: 'batch'`, categoria `creatives`) ligado ao vencedor de origem por `iterated_from`. Some o `GET /champions/:id` por lote da Home.
4. **`MetaAdRow.lastIteratedAt`**: data do lote mais recente feito daquele anúncio. A regra dos 14 dias da Home passa a ser exata.
5. **Lotes nos recentes da Home = rota própria `GET /iterate`** (lista de lotes), não campo na lista de criativos. O web junta os dois por `updatedAt`.

## 1. `onboarding.confirmed` (item 1)
- **Por quê:** "preenchido pela leitura" ≠ "confirmado pela pessoa". A transcrição do Eddy é derivada do estado; faltava só o que a pessoa confirmou.
- **Banco:** `workspaces.onboarding_confirmed OnboardingConfirm[] NOT NULL DEFAULT '{}'`, enum `OnboardingConfirm { business offer meta goals kit }` (migração `20261031000300_onboarding_confirmed`). Ordem do array = ordem em que a pessoa confirmou; sem repetição.
- **Tipo:** `OnboardingConfirmItem = 'business' | 'offer' | 'meta' | 'goals' | 'kit'`; `Onboarding.confirmed?: OnboardingConfirmItem[]` e `OnboardingSummary.confirmed?: OnboardingConfirmItem[]` (opcional só no tipo; a API manda sempre, `[]` em conta nova).
- **`PATCH /workspace { confirm: OnboardingConfirmItem }`**: acrescenta o item se faltar (idempotente: repetido = 200 sem mudar). Pode vir junto com outros campos (ex. `{ onboardingStep: 5, confirm: 'meta' }`). OWNER/ADMIN (a rota já é); MEMBER/CLIENT = 403. Vale também com o onboarding concluído (não dá 409: confirmar não move o passo). Conta como "mexeu no setup" (`updatedBy`). Valor fora da lista = 400 `VALIDATION_ERROR`.
- **Não muda:** `percent`, `steps`, `step`. "Meta pulada" = `confirmed` tem `meta` e o passo `meta` não está `done` (`state: 'skipped'` continua derivado). "Kit pulado" = `confirmed` tem `kit` e o kit está vazio (`GET /brand-kit`). Nada disso ganha coluna.
- **Web:** o `eddy-store` (localStorage) vira só fallback: lê `ws.onboarding.confirmed` (une com o local enquanto a API antiga não manda) e grava com `PATCH { confirm }`. O job da leitura em andamento continua no localStorage (é transitório).

## 2. Logo e 2ª cor da leitura (item 2)
`BusinessSuggestion` (em `OfferExtractOutput.business`) ganha:
| campo | regra |
|---|---|
| `logoUrl: string \| null` | URL absoluta `http(s)` (sem `data:`), na ordem: `<img>` de logo no cabeçalho (`<header>`/`nav` ou classe/id/alt/src com "logo") → `<link rel="apple-touch-icon">` → `<link rel="icon">` (maior `sizes`, SVG primeiro) → `og:image`. Só do HTML que o passo (a) já baixou: **não** baixa a imagem nem testa a URL (o web carrega com `onError` → slot vazio) |
| `logoSource: 'header' \| 'icon' \| 'og_image' \| null` | de onde saiu (`icon` cobre apple-touch-icon e icon) |
| `secondaryColor: string \| null` | `#RRGGBB` maiúsculo, cor de destaque **diferente** da `brandColor` (distância RGB ≥ 60). Candidatas, nesta ordem: 2º grupo de cor dos CTAs no DOM renderizado (quando a página renderizou) → `theme-color` → variáveis CSS do HTML com nome de marca (`--primary`, `--secondary`, `--accent`, `--brand…`, `--color-primary…`) em `<style>`/`style=`. Só cor de destaque (mesma regra `isAccent` da 1ª) |
| `secondaryColorSource: 'cta' \| 'theme_color' \| 'css' \| null` | de onde saiu |
- Texto colado (`pageText`) = os 4 `null`. Sem 1ª cor, a 2ª também é `null` (o web nunca mostra só a "segunda").
- Custo: zero. Usa só o HTML do passo (a) e as amostras de CTA do render que já roda (`render-pagina.ts`); a sonda de cor existente devolve a cor dominante como antes.
- O web oferece "peguei o logo do site": hoje só mostra (`<img src>` externo). Gravar no kit (`LOGO`) continua pelo upload do `kit-marca-v1`; trazer a imagem pro R2 pelo servidor fica pra depois (fora deste contrato).

## 3. Brain: `needsYou`, `statusLabel` e o nó do lote (item 3)
### 3.1 Campos novos em todo `BrainNode`
| campo | regra |
|---|---|
| `needsYou?: boolean` | criativo: mesma regra do `needs_you` da Home (chip `waiting`/`failed`, rascunho parado ≥ 7 d não conta, peça AUTO não conta). Lote: `stage` em `plan_ready`, `failed` ou `pieces_ready` (= `WAITING_BATCH_WHERE`). Outros kinds: `false` |
| `statusLabel?: { key: string; params: Record<string, string \| number> } \| null` | chave i18n completa no namespace `status` (o web usa o mesmo `useStatusLabel`). Criativo: o `statusKey` do `CreativeRow`, **sem números ao vivo** (o grafo tem cache de 60 s): os 3 estados com contagem usam a variante curta `status.scenes_generating_short`, `status.scenes_failed_short`, `status.rendering_short` (sem params). Lote: `status.batch_<stage>` (`pieces_ready` com `{ n }`). Outros kinds: `null` |
Opcionais só no tipo (os mocks do web ainda montam nós sem eles); a API manda sempre.

### 3.2 Nó `batch` (lote do Iterate)
- **kind `batch`, categoria `creatives`** (sem cor nem chip novos). Id `batch:<batchId>`, `refId` = batchId, `label` = nome do campeão (≤ 80), `summary` = nome da oferta.
- **Entram:** lotes de campeão não arquivado que (a) esperam a pessoa, (b) estão trabalhando (`ANALYZING`, `PLANNING`, `LAUNCHED` com peça em render) ou (c) foram criados nos últimos 14 dias; até **`BRAIN_MAX_BATCHES = 20`**, mais recentes primeiro (os que esperam a pessoa antes). Na amostragem do teto de 800 entram logo depois dos criativos vencedores.
- **`meta`:** `{ kind: 'batch'; mode: 'MANUAL' | 'AUTO'; stage: IterateBatchStage; championId; championName; offerId; sourceMetaAdId: string | null; sourceCreativeId: string | null; pieces: number; ready: number; thumbnailUrl: string | null; createdAt; updatedAt }`. `pieces`/`ready` = criativos do lote não arquivados / em `APPROVED`. `thumbnailUrl` = miniatura do campeão, assinada (6 h).
- **`IterateBatchStage`** (derivado, a mesma função do `GET /iterate`): `ANALYZING` → `analyzing`; `PLANNING` → `planning`; `PLAN_READY` → `plan_ready`; `PLAN_FAILED`/`ANALYSIS_FAILED` → `failed`; `LAUNCHED` com criativo em `RENDERING` → `generating`; `LAUNCHED` AUTO, nada renderizando, ≥ 1 criativo e zip não baixado → `pieces_ready`; resto → `done`.
- **Arestas:** `iterated_from` **batch → meta_ad** (`Champion.metaAdId`) ou **batch → creative** (`Champion.sourceCreativeId`), quando o nó de origem está no grafo; `for_offer` batch → offer (sempre, se a oferta está no grafo); **`in_batch`** creative → batch (criativos do lote incluídos). Sem nenhum elo = `part_of` workspace → batch. As arestas `iterated_from` criativo → origem continuam.
- **`counts.batch`** e `BRAIN_NODE_KINDS` ganham `batch`. **Drawer:** `open = { route: 'batch', id: batchId }` (o web abre `/iterate/:id` no AUTO e o Variar no MANUAL, pela `meta.mode`); `fields`: `batch.mode`, `batch.stage`, `batch.pieces`, `batch.ready`, `batch.offer`, `batch.createdAt`; `media = { videoUrl: null, posterUrl: <miniatura do campeão> }`.
- Custo: +1 consulta (lotes) na montagem; nenhuma no drawer. Continua ≤ 10.

## 4. `MetaAdRow.lastIteratedAt` (item 4)
- `lastIteratedAt?: string | null` = `createdAt` do `VariationBatch` mais recente (qualquer modo e estado) de campeão **não arquivado** com `Champion.metaAdId` = o anúncio, no workspace. `null` = nunca iterado. Vale em `GET /meta/ads` e nas linhas de anúncio do Campaigns (`presentAd` é o mesmo).
- +1 consulta por página (`champion.findMany` com o lote mais novo), junto do `adLinks`.
- Web (Home, "Iterate this winner"): sugere quando `lastIteratedAt` é `null` ou mais velho que 14 dias.

## 5. Lotes nos recentes da Home (item 5): **rota própria**
**Decisão:** `GET /iterate` (lista de lotes), não campo novo na lista de criativos. Lote não é criativo: misturar quebraria a paginação, os `counts` e os filtros do `GET /creatives`, e a mesma rota serve a futura tela de histórico do Iterate.
| rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /iterate` | `?limit=1..50` (padrão 10) `&cursor=` `&mode=AUTO\|MANUAL` | `{ data: IterateBatchRow[]; meta: { nextCursor: string \| null } }`, `updatedAt desc` | 400 `VALIDATION_ERROR` | Home (Recent: `limit=5`), todos os papéis |
`IterateBatchRow { id; mode; stage: IterateBatchStage; needsYou; statusKey; statusParams; champion: { id; name }; offer: { id; name }; source: { metaAdId: string | null; creativeId: string | null }; pieces; ready; thumbnail: FileRef | null; createdAt; updatedAt }` — `statusKey`/`statusParams` no mesmo formato do `CreativeRow` (`status.batch_<stage>`), pro `useStatusLabel`. Lote de campeão arquivado não entra.
- Web: a faixa Recent busca `GET /creatives?limit=5` e `GET /iterate?limit=5`, junta por `updatedAt` e mostra 5. Link: AUTO → `/iterate/:id`; MANUAL → Variar.

## 6. i18n (só acréscimo em `messages/*.json`)
`status.scenes_generating_short`, `status.scenes_failed_short`, `status.rendering_short`, `status.batch_analyzing`, `status.batch_planning`, `status.batch_plan_ready`, `status.batch_failed`, `status.batch_generating`, `status.batch_pieces_ready` (`{n}`), `status.batch_done`.

## 7. Divisão e verificação
| # | dono | entrega | verificação |
|---|---|---|---|
| L0 | arquiteto | este contrato, tipos, migração, backend (workspaces, leitura, brain, meta, iteracao) e o web dos arquivos citados. **Feito 31/10** | jest do recorte; `tsc` api/contratos/web |
| LQ | qa | Eddy em 2 aparelhos (confirmar em um, abrir no outro), leitura com/sem logo, Home com lote esperando e sem, regra dos 14 dias | só o qa declara "funciona" |
