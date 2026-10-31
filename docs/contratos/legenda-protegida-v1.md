# Legenda queimada protegida — contrato v1
Data: 2026-10-26 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 26/10 ("ok"), decisões abertas com a recomendação do arquiteto** (nada de código até o ok do Gusta nas decisões da §7)
Origem: decisão do Gusta de 26/10. **Regra:** quando o campeão tem legenda queimada, nenhum template tampa a legenda: molduras, HEADLINE, legenda automática ou qualquer overlay.
Vale por cima de `estatico-montado-e-molduras-v1.md` §B2 (layout e reenquadramento), `headline-e-legenda-v1.md` §1.3-§2 e `variacao-auto-v1.md` §6. Vem **antes** do `editor-molduras-e1.md`, que herda a checagem da §4.
O que já existe e é reaproveitado: `editMap.layers` com `kind: 'caption'`, caixa, intervalo e estilo (`describeEdit`, `feature-2` §13.2); `layerPresence` (intervalo medido por pixel); `faixasQueimadasDe(source, editMap, contentBox)` e `burnedTextBands` (`video/src/lib/molduras.ts`); `contentBox` + `reframeNaCaixa` (zoom no rosto sem cortar); a legenda palavra a palavra com fontes CJK (`headline-e-legenda-v1` §2); a checagem por visão do STATIC (`textCheck`, Haiku 4.5).

---

## 0. Resumo em 5 linhas
1. **Faixa protegida** = a união de todas as posições da legenda queimada ao longo do vídeo, com folga, no espaço do arquivo do campeão (`protectedBands`). É calculada uma vez na análise e gravada no `editMap`.
2. **Por peça, 3 tentativas em ordem:** (1) **desviar** (o layout não põe nada sobre a faixa); (2) **recortar e legendar de novo** (o vídeo corta a faixa pra fora com zoom no rosto e a nossa legenda entra **no estilo da original**); (3) **não oferecer** (`burned_captions`), com o campo "versão sem legenda" no envio do campeão, que libera tudo.
3. **Antes do render:** `checarLegendaProtegida(input)`, função pura do `video`, cruza cada elemento com as faixas por instante. Encostou = cai pro passo 2 ou 3. Nunca vai pro render um input que tampa a legenda.
4. **Depois do render:** Haiku com visão em 4-6 quadros confirma que a legenda está inteira e legível (ou foi substituída pela nossa). Se falhar, a peça vai pro Retry e sai do zip, igual ao `textCheck` do STATIC. **~US$ 0,008 por render**, ~US$ 0,10 por lote de 12.
5. **Sem migração de banco:** `protectedBands` vive no `editMap` (JSON), o veredito em `renders.input.captionCheck`, e o "sem legenda" é um upload a mais no campeão (coluna nova, §5).

## 1. Faixa protegida
- **Quando existe:** o campeão tem legenda queimada = camada `kind: 'caption'` presente em ≥ 50 % do tempo de fala (`layerPresence`). É a mesma condição que hoje desliga a legenda automática (`captionsAuto = false`).
- **Cálculo** (função pura `faixasProtegidasDe(editMap, source)`, video, generaliza o `faixasQueimadasDe`):
  - Pra cada camada `caption`, a caixa medida em cada intervalo de presença. A legenda que muda de lugar no vídeo gera várias caixas.
  - `ProtectedBand = { x, y, w, h, startSec, endSec }` em px do arquivo, com **folga** de 4 % da altura do quadro em cima e embaixo e 2 % nos lados. Folga a mais de 1 linha quando a legenda tem página de 2 linhas e a medição só viu 1.
  - Faixas da mesma posição que se tocam no tempo viram uma. A **união** (`unionBand`, a envoltória de todas) é a que o desvio usa (passo 1). As faixas por instante servem pra checagem e pro recorte (passos 2 e verificação).
- Grava em `editMap.protectedBands` (JSON) na análise, sem custo novo. Campeão antigo sem o campo é recalculado na hora pelo backend a partir de `layers`.

## 2. Por peça: desviar → recortar e legendar → não oferecer
### 2.1 Passo 1, desviar
O layout respeita a faixa. Valem os mesmos mecanismos de hoje, com a faixa protegida no lugar das `burnedTextBands`:
- **Moldura:** `frameLayout` não põe slot de texto, faixa, placa nem selo sobre a área em que a `unionBand` cai **depois do reenquadramento** na `videoBox`. O reenquadramento escolhe, entre as janelas que mantêm o rosto (`reframeNaCaixa`), a que deixa a legenda inteira **dentro** da `videoBox` (a legenda é do vídeo: ela pode aparecer, só não pode ser coberta nem cortada no meio).
- **HEADLINE:** placa ou faixa adicionada não pode cruzar a faixa (vira `HEADLINE_NO_ROOM`, como já é).
- **Legenda automática:** não roda quando há legenda queimada (`captionsAuto = false`), então não colide.
- **Qualquer overlay** (CTA, selo, b-roll da 2ª fonte em tela dividida): a caixa dele, no espaço da saída, não cruza a faixa transformada no mesmo instante.
- Também conta como problema a legenda **cortada** pela borda da `videoBox`: metade dentro, metade fora é falha, e não desvio.

### 2.2 Passo 2, recortar e legendar de novo
Quando o desvio não cabe (ex.: a moldura precisa de texto exatamente onde a legenda passa, ou a `videoBox` não comporta a legenda inteira):
- **Recorte:** a janela do vídeo exclui a faixa. A `contentBox` vira `contentBox − unionBand` (o retângulo do lado do rosto, normalmente o de cima) e o `reframeNaCaixa` faz zoom no rosto dentro dela, como faz com o letterbox. **Só vale se o rosto não for cortado:** a caixa do rosto principal (`faceTrack`, com folga de 8 % da altura do rosto) fica inteira dentro da nova `contentBox` em ≥ 95 % dos frames. Senão, passo 3.
- **Nossa legenda no lugar:** palavra a palavra, com os tempos da transcrição remapeados pelo `timeline` da peça (mesma função da legenda automática, `headline-e-legenda-v1` §2.2, com CJK). **Estilo = o da original**, lido do `describeEdit`: `fontId` do catálogo, peso, caixa alta, cor, cor de destaque da palavra atual, contorno, sombra, palavras por página e tamanho relativo à altura do quadro. Se a visão não deu `fontId` do catálogo, entra o estilo da legenda do template como reserva (D-LP2). Posição = a mesma posição relativa da original, levada pro espaço da saída e reposicionada pra fora dos slots da moldura.
- O input grava `captionMode: 'replaced'` e a nova `contentBox`. A peça mostra "Legenda refeita no estilo do original" (`IteratePiece.captionNote`, §5).

### 2.3 Passo 3, não oferecer
- O plano tira o template (ou o tipo) do `allowed` com `blockedReason: 'burned_captions'`, e a validação do backend repete a conta (função pura, a mesma do passo 1/2).
- A tela do plano e a do Gerar mostram nos itens bloqueados: **"Este formato precisa do vídeo sem legenda"**, com o link "Enviar versão sem legenda".
- **"Versão sem legenda"** (opcional, no envio do campeão e depois, na tela do campeão): o usuário sobe o **mesmo vídeo** sem a legenda queimada. O backend confere que é o mesmo vídeo (duração ±0,1 s, mesma resolução e fps, PSNR fora da faixa protegida ≥ 30 dB em 6 quadros; falhou = 422 `CLEAN_VERSION_MISMATCH`) e a partir daí usa ele como fonte de **todas** as peças. A faixa deixa de ser protegida, o `captionsAuto` liga (legenda nossa no estilo da original) e o lote pode ser replanejado. Grava em `champions.clean_video_file_id`.

## 3. Ordem de decisão (função pura, video + backend)
`decidirLegenda(layout, input, faixas) → { mode: 'avoid' | 'replace' | 'blocked'; reason?: 'face_cut' | 'no_room' }`:
1. Tenta o layout do template com desvio. A checagem geométrica (§4.1) passou = `avoid`.
2. Senão, tenta o recorte. O rosto cabe e a checagem do input recortado passou = `replace`.
3. Senão, `blocked` (`burned_captions`, com o motivo interno).
Roda **no plano** (`allowed`, por template e formato) e **de novo no build do input** (`buildFrameInput`/`buildHeadlineInput`). No build, `blocked` = a peça falha com `CAPTION_PROTECTED` (Leave out), o que só acontece se o plano errou.

**Rev. 26/10 (coordenador, dentro do aprovado; implementado no video):**
- **Campeão sem rosto** (b-roll com narração, `faceTrack` sem trecho `main`): a única trava do recorte era cortar o rosto, então o `recorteSemLegenda` libera o maior lado da `contentBox` sem a faixa (≥ 25 % da altura) e o passo 2 vale normalmente.
- **Modo forçado (Retry depois de `CAPTION_COVERED`):** os builders aceitam um 4º/3º argumento `opts: { captionMode?: 'avoid' | 'replace' }` (`OpcoesDeBuild`, `api/src/render/frame.ts`): `buildFrameInput(spec, ctx, format, opts)`, `buildAutoEditInput(ctx, format, opts)`, `buildHeadlineInput(spec, ctx, opts)`. Com `captionMode: 'replace'` o build pula o desvio e vai direto pro recorte com a nossa legenda no estilo da original; recorte impossível = `CAPTION_PROTECTED` (`reason: 'face_cut' | 'no_room'`). O HEADLINE (remix-keep, quadro inteiro do campeão) não recorta: `replace` forçado com legenda protegida = `CAPTION_PROTECTED` direto. Nas funções puras: `decidirLegenda(p, editMap, legenda, 'replace')` e `decidirLegendaAutoEdit(...)`, mesma assinatura. O AutoEdit aplica a regra em CUT, NATIVE_SEARCH e REVIEW, e desde 26/10 nunca usa `contain_blur` nesses tipos (`reframeNaCaixa`).

## 4. Verificação em 2 camadas
### 4.1 Antes do render: geométrica
`checarLegendaProtegida(input): { ok: boolean; hits: { element: string; atSec: number; overlapPx: number }[] }`, função pura em `@maquina/video/lib`, sem React:
- Leva cada faixa protegida pro espaço da saída (mesma transformação do vídeo na `videoBox`: `pinturaNaCaixa`) e cruza, **por instante** (grade de 0,1 s), com cada elemento desenhado por cima: slots de texto da moldura, faixas, placas, selos, rosto redondo, b-roll, CTA, headline e legenda automática.
- Falha também se a faixa ficar cortada pela borda da `videoBox` (`clipped`).
- `ok = false` = cai pro passo 2 ou 3 (§3). No editor (`editor-molduras-e1`) a mesma função dá o contorno vermelho.
- Teste: tabela de casos com fixtures (legenda no terço de baixo, legenda no meio, legenda que muda de lugar, letterbox + legenda).

### 4.2 Depois do render: visão
- **Quando:** toda peça de vídeo de campeão com faixa protegida (`avoid` ou `replace`), em cada formato renderizado.
- **Como:** o backend extrai 4-6 quadros (ffmpeg) em instantes com legenda presente (dentro dos intervalos medidos, espalhados no vídeo) e manda ao **Haiku 4.5**, em cada quadro, o recorte da região da legenda em resolução cheia + o quadro inteiro reduzido (lado maior 768). Pergunta estruturada: "a legenda está inteira, legível e sem nada por cima?" + o texto lido. Pra `replace`, confere que é a nossa (bate com as palavras da transcrição no instante, comparação normalizada) e que **não** há legenda duplicada (a original vazando na borda do recorte).
- **Veredito:** grava em `renders.input.captionCheck = { status: 'ok' | 'covered' | 'skipped'; frames: { atSec, ok, seen, problem?, reason? }[]; attempt }`. `problem` ∈ `covered | cut | missing | illegible | duplicated | wrong_text | null` e `reason` = o motivo dado pelo modelo (texto, até 300 caracteres; null = ok ou não disse); os dois são opcionais no tipo (`CaptionCheck`, contratos) só porque renders anteriores a 28/10 não os têm, e também saem no log do render (F10).
- **Regra do veredito (F9 27/10, F10 28/10):** o modelo é obrigado a dar `reason` sempre que `problem` ≠ `none`; "não inteira" sem problema dito vira `illegible` (ruim, sem prova). A peça é `covered` com **≥ 2 quadros ruins** (tampada, cortada, duplicada, ilegível, texto errado), **ou 1 quadro** `covered`/`cut`/`duplicated` **com `reason`**, ou ≥ 2 quadros sem legenda (`missing`; 1 é tolerado, é a troca de página/pausa entre falas). 1 quadro ruim sem motivo = `ok`. `covered` = o formato vai pra `failed` com `CAPTION_COVERED` (`retryHint: 'retry'`; o retry usa o passo seguinte da ordem, ou seja `avoid` → `replace` → leave out) e **sai do zip**, igual ao `textCheck`. `skipped` (Claude fora) não segura a peça.
- **Custo:** 6 quadros × (recorte ~430 tokens + quadro reduzido ~440 tokens) ≈ 5,2 mil tokens de entrada + ~600 de prompt + ~300 de saída, no Haiku 4.5 (US$ 1 / 5 por milhão) ≈ **US$ 0,008 por render**. Lote de 12 peças 9:16 ≈ **US$ 0,10**; cada formato sob demanda +US$ 0,008. Entra no `generateEstimateUsd` (o botão Gerar) só nos lotes com legenda queimada. Com 4 quadros: ~US$ 0,006.

## 5. Tipos e mudanças (arquiteto escreve no aceite)
- `EditMap.protectedBands?: ProtectedBand[]` (contratos) + `ProtectedBand`.
- `BlockedReason` + `'burned_captions'`; `IterateAsyncErrorCode` + `'CAPTION_COVERED'`, `'CAPTION_PROTECTED'`; `ApiErrorCode` + `'CLEAN_VERSION_MISMATCH'` (422).
- `IteratePiece.captionNote?: 'replaced' | null` (o web mostra "Legenda refeita no estilo do original").
- Inputs de render (`FrameRenderInput`, `HeadlineSpec`/remix): `captionMode?: 'avoid' | 'replace'` + `protectedBands?` (o `video` desenha a nossa legenda quando `replace`).
- `renders.input.captionCheck` (JSON, sem coluna).
- **Banco:** `champions.clean_video_file_id` (FK `files`, null) e `FileKind` + `CHAMPION_CLEAN_VIDEO`, migração aditiva. Rota: `POST /champions/:id/clean-version { uploadId }` (mesmo fluxo de upload), `DELETE` volta pro original.

- **Replanejar e versão na criação (26/10, backend, pedido do frontend):** `POST /iterate/:id/replan` (só `PLAN_READY`; evento `AUTO_REPLAN` → `PLANNING`; reaproveita a análise; `LAUNCHED` = 409 `INVALID_STATE` `reason: 'launched'`). `CreateIterateBody.cleanUploadId?` conferido antes do plano; resultado em `AutoInsight.cleanVersion { status: 'applied' | 'mismatch'; reason }`.

## 6. Divisão do trabalho
| agente | entrega |
|---|---|
| **arquiteto** | tipos, migração, `api.md` (rota do clean version, erros) |
| **video** | `faixasProtegidasDe`, `checarLegendaProtegida`, `decidirLegenda`; desvio no `frameLayout` e no `reframeNaCaixa`; recorte (`contentBox − faixa`) e a legenda no estilo da original; testes de função pura |
| **ia** | `describeEdit` confere o estilo completo da camada `caption` (já existe; garantir `wordsPerPage`, destaque e tamanho); `checkCaption` (Haiku visão, schema, custo, fake com `[mock:caption-covered]`) |
| **backend** | `protectedBands` na análise; `allowed`/validação com `burned_captions`; build com `captionMode`; extração dos quadros + `checkCaption` depois do render; `failed`/Retry/zip; rota e validação da versão sem legenda; estimativa |
| **frontend** | aviso "Este formato precisa do vídeo sem legenda" nos itens bloqueados; envio da versão sem legenda (no upload e na tela do campeão); nota "Legenda refeita"; i18n dos erros |
| **qa** | fixtures (legenda embaixo, no meio, que muda de lugar, CJK, letterbox + legenda); folha de frames por peça; `covered` forçado pelo mock; versão sem legenda que não bate (`CLEAN_VERSION_MISMATCH`) |
Ordem: arquiteto (tipos) → video + ia em paralelo → backend → frontend → qa.

## 7. Decisões abertas (com recomendação)
| # | decisão | recomendação |
|---|---|---|
| **D-LP1** | Folga da faixa | 4 % da altura do quadro em cima e embaixo, 2 % nos lados. A QA mede no 1º lote e ajusta. |
| **D-LP2** | Estilo da nossa legenda quando a visão não deu fonte do catálogo | Usa o estilo do template, mas com **cor, contorno e caixa alta da original**, que a visão sempre dá. Só a fonte cai pra reserva. |
| **D-LP3** | Nº de quadros da checagem | **6** (~US$ 0,008); 4 se o custo pesar. Abaixo de 4 perde a legenda que muda de lugar. |
| **D-LP4** | Checagem roda também quando o modo é `replace` | Sim: é onde mais pode dar errado (legenda original vazando na borda do recorte, duplicada). |
| **D-LP5** | Versão sem legenda: replanejar o lote sozinho? | Não: aparece "Replanejar com a versão sem legenda" (o plano custa ~US$ 0,03); os lotes seguintes já usam ela. |
| **D-LP6** | Legenda queimada **parcial** (só em parte da fala, < 50 %) | Também protegida nos intervalos dela (a regra é não tampar). Fora deles, a legenda automática só entra se o Gusta quiser (hoje não: ficaria legenda em metade do vídeo em 2 estilos). |
# Revisão 28/10 — preservar a legenda e procurar área livre

Decisão posterior do Gusta: remover legenda com IA foi rejeitado. Esta revisão prevalece sobre o recorte com substituição automática descrito acima.

- Plano e render calculam as faixas a partir das camadas atuais, evitando cache antigo vazio.
- Templates preservam toda a área do vídeo; isso também protege a segunda linha de uma legenda quando a análise mediu só uma linha.
- Textos e cartões procuram áreas livres fora da legenda e do rosto principal (`video.faceSafeBand`, opcional, pixels da fonte).
- HEADLINE adicionada testa topo, rodapé e limites das áreas ocupadas; sem área segura retorna `HEADLINE_NO_ROOM` antes de gerar.
- Sem posição segura: template fora do plano. Retry novo preserva a legenda; `replace` antigo fica apenas por compatibilidade explícita.
- Reparação tenta cortes válidos do vídeo original para completar o piso de quatro, sem duplicar cortes nem inventar texto. Se o material não permitir quatro peças, mostra a quantidade real e o aviso de lote menor.

# Revisão 29/10 — o vídeo preenche a caixa (cover), cortando um pouco se preciso

Decisão do Gusta testando ao vivo ("aceito cortar um pouco"). Prevalece sobre a revisão de 28/10 no item "templates preservam toda a área do vídeo" e sobre a decisão de 25/10 no que muda; o resto continua.

- **O vídeo preenche a caixa** (cover, sem faixa de cor), mesmo cortando um pouco das laterais ou do topo/base do original. A segunda linha que a análise não mediu continua coberta pela folga de `faixasProtegidasDe` (1 linha a mais em cima e embaixo quando a caixa medida tem < 1,5 linha).
- **Nunca corta** a legenda queimada (`protectedBands`) nem o rosto (`faceSafeBand`).
- **Ordem dos candidatos** (`enquadramentosPreservandoLegenda`, `video/src/lib/legendaProtegida.ts`, exportada): (1) scale 1 com o foco deslizando no eixo cortado: o mais perto do foco original e as duas pontas do intervalo em que a envoltória legenda ∪ rosto fica dentro da janela (3 px de folga); (2) se ela não cabe no cover, o **menor** afastamento que a faz caber (arredondado pra baixo), com o mesmo deslize; (3) último recurso, só se o texto da moldura não achar lugar: 95/90/85/75/65 % disso, até o contain.
- **Faixa de cor = caso extremo** (legenda + rosto não cabem juntos no cover). Ela vai **inteira de um lado** no eixo vertical (primeiro em cima, depois embaixo), nunca um filete em cada ponta; no horizontal, dividida.
- `decidirLegenda` (moldura) escolhe o primeiro candidato que passa na checagem §4.1 **e** cujo texto cabe (`textosQueNaoCouberam` vazio); sem nenhum com texto cabendo, o primeiro que passa (o build acusa `FRAME_TEXT_OVERFLOW`, como antes). `decidirLegendaAutoEdit` usa os mesmos candidatos. Plano (`api/src/iteracao/legenda-protegida.ts` → `buildFrameInput`) e render chamam a mesma função: chegam no mesmo enquadramento.
- O texto da moldura continua sem cobrir a legenda (`burnedTextBands`, `frameLayout`). A composição não mudou (só lê `reframe` e `contentBox`).
- Prova: `video/out/molduras-cover-2026-10-29/index.html` (Amnayalife, NEWS e POV-TESTIMONIAL em cover cheio; READ-CAPTION é o caso extremo: legenda de 891 px contra janela de 787 px, faixa de 444 → 236 px, toda em cima).

# §8. Revisão 29/10: "Gerar mesmo assim" por formato bloqueado
Pedido do Gusta em 29/10, testando ao vivo. O padrão de 28/10 continua: o formato sem espaço seguro sai do plano antes de gerar. Agora a pessoa pode escolher, formato por formato, colocá-lo de volta e aceitar que o elemento novo cubra a legenda original. Remover a legenda com IA continua fora (rejeitado em 28/10).

- **Rota:** `POST /iterate/:id/caption-blocked/force` `{ type, template }` (`ForceCaptionBlockedBody`; `template` = a moldura no FRAME, `null` no tipo inteiro). Vale em `PLAN_READY` e em `LAUNCHED`. O par precisa estar em `insight.captionBlocked`, senão 400 `VALIDATION_ERROR` (`rule: 'not_caption_blocked'`). Resposta 200 = `IterateBatch`. Outros estados = 409 `INVALID_STATE` (`reason: 'launched'` no lançado).
- **Lote `LAUNCHED` (29/10, 2ª rodada).** A rota exige lote destravado, ou seja, acesso PAID/INTERNAL ou lote que não é amostra. A amostra travada recebe 402 `PAYMENT_REQUIRED { reason: 'locked', unlock: { pieces } }`.
  - A peça nasce com criativo e render 9:16 na fila (`createPieces` com `itemIds`, fim da fila, prioridade do lote), e o lote volta pra fase `generate` até ela assentar.
  - A peça **não conta** no teto de 12: a seleção terminou no Gerar, e o limite é o teto mensal do workspace. O teto confere o plano, se precisar chamar. O render da peça forçada custa US$ 0 (Remotion, sem checagem por visão).
  - Forçar de novo não cria nada novo.
- **Desfazer:** `DELETE /iterate/:id/caption-blocked/force` com o mesmo corpo apaga a peça forçada (404 se não houver). Em `LAUNCHED` a resposta é 409 `INVALID_STATE` `reason: 'launched'`: a peça já virou criativo e passa a ser peça normal (Remove/Excluir do zip). O "Remove/Add back" (`PATCH /iterate/:id/items/:itemId`) também funciona nela.
- **Peça:** item `AUTO_EDIT` novo, `included: true`, `selection: 'user_added'`, `payload.captionOverride = true` (JSON, sem migração). Trocar as respostas do quiz não reseleciona a peça forçada.
- **Parâmetros do formato**, do mais barato pro mais caro:
  1. **Candidata guardada (grátis):** o plano agora guarda, em `variation_batches.settings.captionCandidates`, as peças que o Claude planejou e que a guarda tirou (validação, reparo ou checagem final), já finalizadas.
  2. **Chamada nova do plano:** usada quando o `allowed` já tirava o formato e o Claude não chegou a planejá-lo. É 1 `planAutoBatch` só com esse tipo (`max: 1`; na moldura, `allowedFrames: [template]`; `rules: { min: 1, max: 1 }`), sem a guarda da legenda e com as outras regras valendo. A chamada tem job `AUTO_PLAN` próprio (`input.captionForce`), `cost_entry` LLM no lote e passa pelo teto do workspace (estimativa = plano completo, ~US$ 0,44 num vídeo de 30 s, conta pra cima). O real esperado fica em ~US$ 0,05-0,15 no tipo simples e até ~US$ 0,27 na moldura, que tem a 2ª etapa de textos. A candidata resultante fica guardada, então desfazer e forçar de novo não paga outra vez. Se o Claude não devolver peça válida, a resposta é 422 `ITEM_NOT_SELECTABLE` (`reason: 'not_planned'`). Se o Claude estiver fora, a resposta é 503 `PROVIDER_UNAVAILABLE`.
- **Tetos:** 12 selecionadas (amostra: 4) = 422 `ITEM_NOT_SELECTABLE` `reason: 'batch_full'`. A amostra não aceita tipo pago (`STATIC`), que dá `reason: 'sample_type'`. NATIVE_SEARCH, molduras e HEADLINE são grátis (Remotion).
- **Render:** o contexto da peça usa o `editMap` sem as camadas `caption` (`semLegendaQueimada`). O layout é o normal, sem faixa protegida, então pode cobrir a legenda. A checagem por visão (§4.2) **não roda** nessa peça e `CAPTION_COVERED` nunca a reprova. A estimativa do Gerar (`generateEstimateUsd`) também não soma a checagem dela.
- **Contrato:** `AutoInsight.captionBlocked[].forced?: boolean` (true = há peça incluída com override daquele tipo/moldura) e `IteratePiece.captionOverride?: boolean` (o web mostra o selo "Cobre a legenda").
