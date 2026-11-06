# Vários templates num lote só — contrato v1 (adendo do `templates-creditos-v1`)
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **PROPOSTA, aguardando ok do Gusta** (pedido dele em 04/11: marcar vários templates na galeria e gerar todos de uma vez no mesmo anúncio; preço = soma dos marcados, **sem teto**). Nada implementado; os tipos já estão em `contratos/src/templates.ts` (bloco `templates-multi-v1`).
Vale **por cima** de [`templates-creditos-v1.md`](templates-creditos-v1.md) só no que muda aqui; tudo o que não está aqui segue de lá (créditos, livro-razão, reserva no Gerar, assentamento e estorno por linha, Retry A4, amostra, fit, "Gerar mesmo assim", 4:5/1:1 grátis). Envelope e erros: [`api.md` §1](api.md). Tempo real: polling de `GET /iterate/:id` a 1,5 s, como hoje.

## 0. Em 6 linhas
1. Na galeria, a pessoa marca **2 a 12** templates (Edição e Estático) e clica **Continuar**: escolhe o anúncio uma vez e sai **um lote só** com uma linha por template marcado.
2. Rota nova `POST /ad-templates/use { slugs, fonte }`. A `POST /ad-templates/:slug/use` continua igual (1 marcado = o fluxo de hoje).
3. **Preço = soma dos créditos das linhas, sem teto** (`TemplateRun.cap = null`). O pack "Deixa o HookMill escolher" continua com teto de 10 e não entra na seleção.
4. Reaproveita o pack: o lote guarda as chaves dos marcados em `settings.template.keys`, as linhas saem do catálogo pela chave, e reserva, assentamento, estorno e Retry por linha não mudam. A diferença: **quem escolhe as chaves é a pessoa**, todas as peças nascem marcadas e o plano tenta 1 peça de **cada** template.
5. Fit: anúncio já lido com algum marcado `hard` = **422 com a lista** (o web oferece "tirar este e continuar"). Anúncio ainda não lido: o template que não cabe sai no Reading, **não cobra** e aparece como "ficou de fora".
6. Teto de tamanho: **≤ 12 vídeos** (soma do `outputs` dos marcados, o `BATCH_MAX` do lote auto). Amostra: só Edição, e a soma tem que caber nos usos que restam.

## 1. Decisões do arquiteto (o Gusta pode trocar)
| # | decisão | por quê |
|---|---|---|
| M1 | Rota nova `POST /ad-templates/use` (não estender `/:slug/use`) | o corpo muda de forma (lista de slugs). A rota de 1 template fica intacta, assim como o web e os testes de hoje |
| M2 | `slugs`: 2 a 12, distintos. 1 slug = 400 (use `/:slug/use`) | um caminho por caso; o web manda 1 marcado pra `/templates/[slug]` |
| M3 | Só tier `EDIT` e `STATIC`. Pack = 422 `pack`; IA = 422 `ai_tier` | o pack já é uma seleção (teto próprio); a IA roda em outro fluxo (`ai/start`, F3) e hoje nem aparece pro cliente |
| M4 | **≤ 12 vídeos** (Σ `outputs`) por lote, senão 422 `too_many_videos` | é o `BATCH_MAX` do lote auto e o tamanho que o plano de 1 chamada aguenta hoje (o pack tem o mesmo teto). Exemplo: Headline 3 + Cortes 2 + 7 molduras = 12 |
| M5 | Fit `hard` com anúncio já lido = **recusa a seleção inteira** (422 `TEMPLATE_DOESNT_FIT` com `items`), sem tirar sozinho | a pessoa vê o preço da seleção na barra; tirar em silêncio muda o que ela escolheu e o que vai pagar. O passo do anúncio já mostra o fit de cada um antes (`fits` com `slugs`), então o 422 só aparece em corrida ou chamada direta |
| M6 | Anúncio **não lido**: quem não cabe sai no Reading, vira `skipped` e não cobra | não dá pra saber antes de ler; a leitura é grátis (A5). Bloquear o lote inteiro depois de ler seria pior pra pessoa |
| M7 | Âncora do `TemplateRun` = **linha de sistema no catálogo** (`slug 'selection'`, `internalKey 'SELECTION'`, `HIDDEN`, sem preço). Sem mudança de schema | `TemplateRun.templateId` é obrigatório e o histórico, o livro-razão e a tela do run leem nome e slug dele. Deixar nulo obrigaria tratar nulo em 5 lugares; a linha de sistema dá o nome "Your selection / Sua seleção" de graça e o `uses` dela conta quantos lotes de seleção saíram |
| M8 | Todas as peças nascem marcadas (como no template único); a pessoa pode desmarcar uma linha no Plan (como no pack) | quem escolheu foi ela; desmarcar só tira a linha do quote |
| M9 | Amostra: soma dos créditos > usos restantes = 402 já no `use` | mesma razão do A5 (a leitura custa pra nós); a amostra não tem como comprar mais no meio |

## 2. Modelo de dados (sem migração de schema; 1 migração de dados)
- **Migração de dados `20261104000100_templates_selection`:** insere no catálogo `{ slug: 'selection', internalKey: 'SELECTION', autoType: null, frameId: null, pack: false, tier: 'EDIT', credits: null, outputs: 0, category: 'pack', nameEn: 'Your selection', namePt: 'Sua seleção', descEn/descPt: 'Templates you picked' / 'Templates que você marcou', outEn/outPt: '', needs: [], order: 0, status: 'HIDDEN', beta: false }`.
- **Linha de sistema** (`isSelectionRow(t) = t.internalKey === 'SELECTION'`, em `templates/catalogo.ts`): nunca aparece na galeria (HIDDEN e sem preço = `disabled`), `/:slug/use` com `selection` = 404 até pra equipe, o admin não lista nem edita (404), `packKeysOf` já a ignora (não é `LIVE`).
- **`VariationBatch.settings.template`** (o `BatchTemplateSettings` do `creditos.service.ts` ganha 3 campos opcionais):
  ```ts
  { slug: 'selection', pack: false, selection: true,
    slugs: string[],                     // os marcados, na ordem do pedido
    keys: string[],                      // internalKey de cada marcado ("FRAME:news", "HEADLINE", "STATIC"…)
    max: Record<string, number>,         // por autoType ≠ FRAME: Σ outputs dos marcados daquele tipo (HEADLINE 3, CUT 2, STATIC 1…)
    fits?: Record<string, TemplateFit>,  // gravado no PLAN_READY: fit de cada slug (base do `skipped`)
    fit?: TemplateFit }                  // o do lote (§4)
  ```
  `settings.quizEnabled = false`; amostra: `settings.sample = true`, como hoje.
- **`TemplateRun`**: `templateId` = id da linha `selection`; `cap = null`. Linhas (`RunLine`) iguais às do pack: agrupadas pela chave da peça, procuradas no catálogo por `internalKey`.
- **`uses`**: o Gerar já soma +1 no `run.templateId` e em cada linha. Fica: +1 na linha `selection` e +1 em **cada template que virou linha**. Marcado que ficou de fora ou linha desmarcada não conta.

## 3. API
### 3.1 `POST /ad-templates/use` (novo) · OWNER/ADMIN/MEMBER · `@ExpensiveAction` · 202
Entrada `UseTemplatesBody`: `{ slugs: string[]; uploadId | creativeId | metaAdId | championId (exatamente 1); offerId?; cleanUploadId? }`.
Saída: `202 IterateBatch` com `template.selection` preenchido. O web vai pra `/templates/run/:batchId`.

Ordem das checagens (a 1ª que falhar responde):
| # | checagem | erro |
|---|---|---|
| 1 | DTO: `slugs` array 2-12, distintos, cada um 1-64 caracteres; exatamente 1 fonte | 400 `VALIDATION_ERROR` |
| 2 | cada slug existe e é visível ao cliente (equipe: qualquer um não-sistema); `selection` conta como inexistente | 422 `TEMPLATE_SELECTION_INVALID { reason: 'not_found', slugs }` |
| 3 | nenhum é pack | 422 `TEMPLATE_SELECTION_INVALID { reason: 'pack', slugs }` |
| 4 | nenhum é tier `AI` | 422 `TEMPLATE_SELECTION_INVALID { reason: 'ai_tier', slugs }` |
| 5 | todos disponíveis (`availabilityOf`) | 422 `TEMPLATE_UNAVAILABLE { reason, slug }` (o 1º) |
| 5b | **04/11:** ≤ 8 molduras (autoType `FRAME`) marcadas — o FRAME ≤ 8 do plano (regra de 25/10) | 422 `TEMPLATE_SELECTION_INVALID { reason: 'too_many_frames', slugs: <as molduras marcadas>, frames, max: 8 }` |
| 6 | Σ `outputs` ≤ 12 | 422 `TEMPLATE_SELECTION_INVALID { reason: 'too_many_videos', slugs: [], videos, maxVideos: 12 }` |
| 7 | amostra: todos tier `EDIT` | 402 `PAYMENT_REQUIRED { reason: 'sample_tier', unlock: { pieces: 0 }, slugs }` |
| 8 | amostra: garante o GRANT; saldo 0 | 402 `PAYMENT_REQUIRED { reason: 'sample_used', unlock: { pieces: 0 } }` |
| 9 | amostra: Σ créditos ≤ usos restantes | 402 `INSUFFICIENT_CREDITS { need: Σ, balance, pool: 'SAMPLE' }` |
| 10 | anúncio já lido: nenhum marcado com fit `hard` | 422 `TEMPLATE_DOESNT_FIT { reason, slug, items: [{ slug, reason }] }` (`reason`/`slug` = o 1º; `items` = todos os `hard`) |
| 11 | os do `POST /iterate` (OFFER_REQUIRED, upload…) | como hoje |
Conta `PAID` sem saldo **não** é barrada no `use` (o plano é grátis; o Gerar dá 402 `INSUFFICIENT_CREDITS`, igual ao template único). CLIENT = 403.

### 3.2 `POST /ad-templates/fits` (estendido)
Entrada: **exatamente 1** de `slug` (como hoje) ou `slugs` (2-12, distintos); `sources` 1-50. Os dois ou nenhum = 400.
Com `slugs`, cada item ganha `bySlug: { slug, fit }[]` (ordem pedida) e `fit` = o da seleção: `unknown` se o anúncio não foi lido; senão `hard` se algum é `hard` (reason = o do 1º `hard`); senão `soft` se algum é `soft`; senão `ok`. Slug inexistente ou invisível na lista = 404, como hoje. Custo: 1 contexto por fonte, os fits são puros (sem chamada paga).

### 3.3 `GET /ad-templates` (estendido)
`TemplateList.selection: { minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: 8 }` (o web não fixa número; `maxFrames` desde 04/11 — o web conta como moldura o card `category: 'frames'`). Os cards não mudam (`outputs`, `credits`, `tier`, `sampleOk` já bastam pra barra).

### 3.4 `GET /iterate/:id` → `IterateBatch.template` (estendido)
- `slug: 'selection'`, `name: 'Your selection' | 'Sua seleção'`, `pack: false`, `cap: null`, `tier: 'EDIT'`.
- `lines`: uma por template que virou peça (como no pack), com `credits` e `pieces`. **04/11 (Gusta):** no plano (`status: 'DRAFT'`) a linha cujas peças foram todas desmarcadas **continua** em `lines`, com `pieces: 0`, `state: 'planned'` e o `credits` do template (pra o web mostrar nome e crédito); ela não entra no `quote` nem na reserva. Depois do Gerar, `lines` = as linhas reservadas (como antes).
- `quote` = Σ créditos das linhas marcadas (sem teto). `expectedCredits` no Gerar = esse número.
- `selection: { slugs, skipped: [{ slug, name, reason }] }`: `skipped` = marcados sem linha. `reason` = o fit `hard` do Reading (`no_face`, `short_video`…) ou `not_planned` (cabia, mas o plano não fez peça dele mesmo depois do reparo). `null` em lote que não é de seleção.
- `texts`: os textos editáveis de **todas** as peças marcadas (FRAME e HEADLINE, A7), como no template único.
- `fit` (§4).

### 3.5 `GET /ad-templates/runs` e `GET /credits/ledger`
`TemplateRunRef.selection: { slugs } | null` (o histórico mostra "Sua seleção · 3 templates"). No livro-razão, `run.templateSlug = 'selection'` e `templateName` = o nome da linha de sistema; nada novo no tipo.

### 3.6 Sem mudança
`POST /iterate/:id/start { expectedCredits }`, `PATCH /iterate/:id/items/:itemId { included }` (desmarcar linha), `PATCH .../texts`, Retry (A4: `retryNeed` com `cap = null` = créditos da linha), "Gerar mesmo assim", 4:5/1:1, assentamento (A3 por linha, sem teto).

## 4. Plano do lote de seleção (backend + ia)
1. `restrictToTemplate(ctx, allowed, { keys, max })` como hoje (FRAME = só as molduras marcadas que passam; `max` por tipo).
2. `fits` por slug = `templateFitOf` de cada marcado (as mesmas regras; `templateOnlyTypes` pelas `keys`), gravado em `settings.template.fits`.
3. Fit do lote = `batchFitOf(restricted, true)` (a regra do pack: `ok` se algum cabe). Nenhum cabe = plano pronto **sem peça**, sem chamar o Claude (o `readyEmpty` de hoje), `fit` = o do 1º marcado.
4. Regras do plano: `min` = nº de marcados que cabem (no máximo Σ max), `max` = Σ max (≤ 12), `minDiversityPct: 0`.
5. **ia (novo):** `AutoPlanInput.picked?: string[]` = as chaves dos marcados que cabem. Com ele, o pedido ganha um bloco `<picked_templates>`: "a pessoa escolheu estes templates; escreva pelo menos 1 peça de cada; FRAME = 1 peça por moldura listada". Validação nova `picked_missing` (chave sem peça) entra na **1 chamada de reparo** que já existe; se ainda faltar depois do reparo, **não reprova o plano**: a chave vira `skipped: not_planned` e não cobra. O sistema do prompt não muda (cache).
6. Seleção: todas as peças `included: true` (o caminho `tpl && !tpl.pack` de hoje).
7. Amostra: o filtro `SAMPLE_BLOCKED_TYPES` e o teto de US$ 1 por lote no Gerar continuam. 4 usos = no máximo 4 templates de Edição.

## 5. Web
### 5.1 Galeria (`/templates`, `gallery.tsx`)
- Cada card de Edição/Estático ganha uma **caixa de seleção** no canto do vídeo (rótulo acessível "Selecionar <nome>"). Clicar no card continua abrindo o detalhe; no detalhe, o botão secundário "Adicionar à seleção" / "Tirar da seleção". O pack, os cards de IA e o papel CLIENT não têm caixa.
- **Barra fixa** no rodapé quando há ≥ 1 marcado: "**N selecionados · X créditos · Y vídeos**" + "Limpar" + **Continuar**. Amostra: "N de L usos" no lugar de créditos. Conta paga com X > saldo: aviso "Seu saldo é S" (Continuar segue liberado; o Gerar pede crédito).
- Limites (`TemplateList.selection`): passou de `maxTemplates`, `maxFrames` (04/11: a 9ª moldura, "Máximo de 8 molduras por lote") ou `maxVideos` = as caixas que estourariam ficam desabilitadas com dica "Máximo de 12 vídeos por lote". Amostra: Estático desabilitado ("Plano pago"); caixa que passaria dos usos restantes desabilitada ("Você tem L usos").
- **Continuar:** 1 marcado = `/templates/[slug]` (fluxo de hoje); ≥ 2 = `/templates/selection?t=a,b,c`. Com anúncio já fixado na URL (`PinnedAd`): chama direto `POST /ad-templates/use` (≥ 2) ou `/:slug/use` (1) e vai pro run.
- A seleção mora na URL: a galeria lê `?t=` (ex.: voltar do passo do anúncio mantém as marcações). Slug que não está mais na lista é ignorado em silêncio.

### 5.2 Passo do anúncio (`/templates/selection?t=a,b,c`)
- Página nova `app/(app)/templates/selection/page.tsx` (a pasta estática ganha da `[slug]`; nenhum template público se chama `selection`). Lê `t`, tira repetidos e desconhecidos; sobrou 1 = `replace` pra `/templates/[slug]`; 0 = `/templates`.
- `ad-step.tsx` generalizado pra `slugs: string[]`: o topo lista os marcados (chips com o crédito de cada um, total "X créditos · Y vídeos", link "Editar seleção" → `/templates?t=…`).
- Fit por linha: `POST /ad-templates/fits { slugs, sources }` → pílula com o `fit` da seleção. Linha selecionada com algum `hard`: a barra mostra "**<nome> não cabe neste anúncio**: <motivo>" e o botão "**Tirar <nome> e continuar**" (atualiza `t` e recalcula); com todos `hard`, a linha fica desabilitada como hoje. Continuar só com nenhum `hard`.
- Continuar = `POST /ad-templates/use { slugs, fonte, offerId? }`. Erros: `TEMPLATE_DOESNT_FIT` (marca os `items` na barra), `TEMPLATE_SELECTION_INVALID` (volta pra galeria com aviso), `PAYMENT_REQUIRED`/`INSUFFICIENT_CREDITS` (o tratamento de hoje).

### 5.3 Run (`/templates/run/:batchId`, `run-screen.tsx`)
- `PLAN_READY` com `tpl.selection` = **SelectionPlan**: as linhas do `PackPlan` (1 por template, caixa pra desmarcar, crédito por linha) + dentro de cada linha os textos editáveis das peças (`PieceTexts`, como no `Plan`) + as linhas `skipped` em cinza, sem caixa, com a pílula do motivo e "0 créditos". Barra: "Y vídeos · X créditos" **sem** o aviso de teto (`capped` é só do pack).
- **Não chamar `GET /ad-templates/selection`** (`useTemplateCard(tpl.slug)` do `Plan`/`Flow`): é 404. O "out/créditos" do `Flow` sai das linhas.
- "Voltar" e o `ad` do FlowBar: `/templates/selection?t=<slugs>` em vez de `templateAdHref(tpl.slug)`.
- Generating/Download e `RunNote`: sem mudança (o nome vem "Sua seleção").
- Histórico de usos / Credits: `TemplateRunRef.selection` = "Sua seleção · N templates".

## 6. Erros novos (`api.md` §1)
| código | HTTP | details |
|---|---|---|
| `TEMPLATE_SELECTION_INVALID` | 422 | `{ reason: 'not_found' \| 'pack' \| 'ai_tier' \| 'too_many_videos' \| 'too_many_frames'; slugs: string[]; videos?; maxVideos?; frames?; max? }` (`too_many_frames` em 04/11) |
`TEMPLATE_DOESNT_FIT` ganha `slug?` e `items?`; `TEMPLATE_UNAVAILABLE` ganha `slug?`; `PAYMENT_REQUIRED` ganha `slugs?` (só em `sample_tier` da seleção). `TemplateFitReason` ganha `not_planned`.

## 7. Tipos (feito em 04/11, `contratos` com `tsc` verde)
`contratos/src/templates.ts`: `UseTemplatesBody`, `TemplateSelectionLimits`, `TemplateSelectionView`, `TemplateSkipReason`, `TemplateSelectionInvalidReason`/`Details`, `TemplateDoesntFitDetails`, `TemplateUnavailableDetails`; `TemplateFitsBody.slug` opcional + `slugs?`; `TemplateFitsResponse.items[].bySlug?`; **obrigatórios novos**: `IterateTemplateRun.selection`, `TemplateRunRef.selection`, `TemplateList.selection`. `contratos/src/index.ts`: `ApiErrorCode` + `TEMPLATE_SELECTION_INVALID` e os `ErrorDetails`. `contratos/src/amostra.ts`: `PaymentRequiredDetails.slugs?`.

**O que quebrou no `tsc` (de propósito; cada dono conserta na sua tarefa):**
- api: `common/errors/error-codes.ts:156` (falta `TEMPLATE_SELECTION_INVALID` no `ErrorCode`); `creditos/creditos.service.ts:181` (`runs` sem `selection`) e `:234` (`runView` sem `selection`); `templates/templates.service.ts:114` (`list` sem `selection`).
- web: `mocks/handlers-templates.ts:280` (run sem `selection`), `:303` (runs sem `selection`), `:327` (`fits` lê `slug` que agora é opcional).
- testes: nada novo (os erros de `specs/qa-0311-api/templates-v2.spec.ts` são anteriores, do template de campanha da Meta).

## 8. Divisão do trabalho
| # | dono | entrega | depende |
|---|---|---|---|
| M0 | arquiteto | este contrato + tipos | feito 04/11 |
| M-B | backend | migração de dados `selection`; `isSelectionRow` + filtros (admin, `/:slug/use`); `POST /ad-templates/use` (DTO `UseTemplatesDto` com `ArrayUnique`) + checagens §3.1; `fits` com `slugs`; `TemplateList.selection`; `BatchTemplateSettings` (+`selection`, `slugs`, `fits`); `linesOf` procura no catálogo também quando `isSelectionRow(run.template)`; `runView`/`runs` com `selection` e `skipped`; plano §4 (passos 2-4, 6); `ErrorCode` novo; testes do recorte (unidade das checagens e do `skipped`; `templates-creditos.int.spec` com 1 seleção de 3 templates, 1 `hard` → 422 com `items`, quote = soma acima de 10, assentamento com 1 linha falhando = estorno só dela) | M0 + ok do Gusta |
| M-I | ia | `AutoPlanInput.picked` + bloco `<picked_templates>` no pedido + violação `picked_missing` (só reparo, não reprova) | M0; o M-B usa o campo (sem ele o plano roda, só sem a garantia de 1 por template) |
| M-F | frontend | galeria (caixas, barra, limites, `?t=`), página `templates/selection`, `ad-step` com `slugs`, `SelectionPlan` no run, voltar/FlowBar, histórico; MSW (`POST /ad-templates/use`, `fits` com `slugs`, `selection` nos mocks); `api.adTemplates.useMany` no `client.ts` | M0 (MSW pelos tipos) |
| M-Q | qa | ponta a ponta: 3 templates num anúncio (soma > 10 cobra a soma), 1 que não cabe (lido → tira e continua; não lido → `skipped` sem cobrança), amostra (Estático travado, soma > usos travada), estorno de 1 linha, Retry | M-B + M-F |

**Arquivos backend:** `api/prisma/migrations/20261104000100_templates_selection/migration.sql` (só dados), `api/src/templates/{catalogo.ts, templates.controller.ts, templates.dto.ts, templates.service.ts, catalogo.spec.ts, templates-creditos.int.spec.ts}`, `api/src/creditos/creditos.service.ts`, `api/src/iteracao/{plano-auto.service.ts, templates-lote.ts}` (+ `templates-lote.spec.ts`), `api/src/common/errors/error-codes.ts`. ia: `api/src/integracoes/contrato.ts` (`AutoPlanInput.picked`), `api/src/integracoes/claude/auto-plano.ts`, `api/src/iteracao/regras.ts` (`picked_missing`).
**Arquivos frontend:** `web/src/components/templates/{gallery.tsx, ad-step.tsx, run-screen.tsx, parts.tsx, credits-screen.tsx}`, `web/src/app/(app)/templates/selection/page.tsx` (novo), `web/src/lib/routes.ts` (`templateSelectionHref(slugs)`, `templatesHref` com `t`), `web/src/lib/api/client.ts`, `web/src/hooks/use-templates.ts` (`tk.fits` com `slugs`; hook `useUseTemplates`), `web/src/mocks/handlers-templates.ts`, mensagens i18n (`adTemplates.selection.*`, EN e PT).

## 8b. Ajustes de 04/11 (aprovados pelo Gusta)
- **2026-11-04:** teto de **8 molduras** por seleção (mantém o FRAME ≤ 8 do plano de 25/10): checagem 5b no `use`, `TemplateList.selection.maxFrames: 8`, a 9ª caixa de moldura travada na galeria; e a linha desmarcada do plano da seleção volta em `lines` com `pieces: 0` (§3.4).

## 9. Pendências do Gusta
1. **Ok no contrato** (M1-M9), em especial: teto de **12 vídeos** por lote (M4) e **recusar a seleção** quando um marcado não cabe num anúncio já lido, com o botão "tirar e continuar" (M5).
2. Mockup: barra de seleção e a tela do plano com várias linhas cabem no padrão do `mockup-templates.html`; se quiser ver antes de codar, o design faz 1 tela (galeria com 3 marcados + plano da seleção).
