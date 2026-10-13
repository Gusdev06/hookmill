# Modelo de dados (contrato v1)
Data: 2026-10-05 (feature 2: 06/10) · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta (G0 05/10; F2-G0 06/10)**
Fonte da verdade do banco: [`api/prisma/schema.prisma`](../../api/prisma/schema.prisma) (validado com Prisma 6.19). Este arquivo explica o porquê e as regras que o schema sozinho não diz.

## Mudanças 13/10 (variação automática v1; detalhe em [`variacao-auto-v1.md`](variacao-auto-v1.md) §2-§3)
- Migração `20261014000000_variacao_auto` (aditiva), aplicada em `maquina` (backup `.infra/backups/maquina-2026-10-13-1340.sql.gz`) e `maquina_test`.
- Enums novos `BatchMode` (MANUAL padrão | AUTO), `AutoVariationType` (os 9 tipos), `VariationAxis` (ITERATION | DIVERSITY). Valores novos: `VariationKind` + `AUTO_EDIT`; `VariationBatchStatus` + `ANALYZING`, `ANALYSIS_FAILED` (só AUTO); `JobType` + `AUTO_PLAN`, `ZIP_BUILD`; `FileKind` + `RENDER_IMAGE`, `PAGE_CAPTURE`, `ZIP_ARCHIVE`, `PRODUCT_IMAGE`.
- `variation_batches` + `mode`, `insight` (AutoInsight), `error_code`, `fail_reason`, `fail_detail`, `fail_stage`, `page_capture_file_id`, `zip_file_id`, `zip_key`, `downloaded_at`. `variation_items` + `auto_type`, `code` (`UNIQUE(batch_id, code)`), `axis`, `change`, `in_zip`, `left_out_at`. `creatives` + `variation_code`. `renders` + `format` (null = `creative.format`; peça AUTO = 1 render por formato). `offers` + `product_image_file_id` (D4).
- Regras que o schema não diz: a peça = `VariationItem` (plano) + `Creative` (resultado), sem tabela própria; status da peça é **derivado** (§3.2 do contrato); `finalRenderId` da peça = o render 9:16; `AUTO_APPROVE` grava `adName` (`CLIENTE_MMDD_CODIGO`, data UTC do `launchedAt`) na mesma transação do `RENDER_READY`; `axis` é fixo por tipo.

## Mudanças 06/10 noite (manter a edição + take contínuo; detalhe em [`feature-2-variar-campeao.md` §13](feature-2-variar-campeao.md))
- `teardowns.edit_map` (EditMap). Tabela nova `takes` (1 por criativo e geração; `UNIQUE(creative_id, generation)`), `ScenePipeline` + `TAKE_SLICE`, `scenes.take_id/take_start_sec/take_end_sec`, `provider_tasks.take_id`. Migração `20261006200000_keep_edit_take`, aplicada em `maquina` e `maquina_test`.
- Cena `TAKE_SLICE` só fica READY quando o take fica READY (clipe validado, words, miniatura da fatia). `TTS_LIPSYNC`/`AUDIO_LIPSYNC`/`REUSE` como pipeline de cena: só criativos antigos.
> ⚠️ API dev da porta 3001 em MODO LIVE (Gusta testando com dinheiro): nenhum agente usa a 3001. Testes = API própria em mock; web = MSW ou API própria em outra porta.

## Mudanças 06/10 (feature 2 "variar campeão" + rosto na Higgsfield)
- **Rosto = Higgsfield Soul V2** (migração `20261006000000_provider_higgsfield`): `Provider` ganha `HIGGSFIELD`; `provider_tasks` do rosto e as `cost_entries` deles saem com esse provider (US$ 0,006/imagem 1080p). Prompts de mídia v2 são o padrão (`MEDIA_PROMPTS=v2`).
- **Feature 2** (migração `20261006120000_feature2_variar_campeao`; contrato completo em [`feature-2-variar-campeao.md`](feature-2-variar-campeao.md)): tabelas `uploads`, `champions`, `teardowns`, `variation_batches`, `variation_castings`, `variation_items`; colunas novas em `creatives` (`origin`, `champion_id`, `variation_batch_id`, `variation_item_id`, `variation_kind`, `voice_source`), `faces` (`creative_id` opcional + `casting_id`, `CHECK faces_owner_check`: exatamente um), `scenes` (`pipeline` com backfill pelo motor, `source_start_sec`, `source_end_sec`, `reuse_of_scene_id`), `jobs`, `provider_tasks` e `cost_entries` (`champion_id`, `variation_batch_id`). Enums: `JobType` +4, `Provider` + `APIFY`, `CostKind` + `SCRAPE`, `FileKind` + `CHAMPION_VIDEO`/`CHAMPION_AUDIO`/`CHAMPION_FRAME`.
- `champions.rights` (`OWN`/`THIRD_PARTY`) é só a declaração do usuário: **não trava nada** (decisão do Gusta, 06/10).

## Mudanças 05/10 (F3)
- `scenes.thumbnail_file_id` (migração `20261005210000_scene_thumbnail`): miniatura da cena, extraída pelo backend na ingestão do clipe (frame em ~1 s, nunca o 0). Cena só fica `READY` com clipe validado, `words` gravado **e** miniatura.
- Quebra em cenas do LIPSYNC: um clipe por bloco do roteiro, até 30 s (SCENES segue até 15 s). Quem quebra é a ia (`splitScenes`).

## Mudanças 05/10 (revisão da onda 2)
- **Coluna `error_code` em `faces` e `scenes`** (migração `20261005200000_face_scene_error_code`): o código da falha (`AsyncErrorCode`) fica gravado; `fail_reason` é só o texto humano. Acaba a busca reversa do código pelo texto.
- **Novo Generate** com `confirm: true` a partir de `SCENES_FAILED`, `EDIT_PENDING`, `RENDER_FAILED` e `RENDER_READY` (pra trocar motor/voz/formato): a geração anterior vira `stale`, nasce `generation + 1`.
- **Letras dos roteiros:** sequência A, B, C… sem repetir no criativo (descartado não devolve a letra); depois de Z, AA.
- **Exceção na posse de `provider_tasks`:** o backend escreve só `handled_at` (marca que aplicou o resultado, `eventos.md` §3). O resto da tabela continua só da ia.
- `progress` (cena, render, job) é inteiro 0-100.

## Mudanças 05/10 (fechamento da onda 1)
- Regerar uma cena `READY`/`FAILED` vale também em `SCENES_GENERATING` (transição nova na tabela).
- Sai `OFFER_LOCKED`: a oferta não muda porque o `PATCH` do criativo não aceita `offerId` (400).

## Princípios
- **Workspace em tudo.** Toda tabela de negócio tem `workspace_id`. Toda query do backend filtra por ele (guard + repositório); um membro nunca lê nem escreve fora do workspace do token.
- **Agnóstico de oferta.** Nenhum campo, enum ou prompt fala de nicho. O briefing é texto livre por campo.
- **Um estado por criativo** (`creatives.state`). A etapa do wizard e o chip de status são derivados dele por uma função pura. Só o `CreativeStateMachine` (backend) escreve `state`, sempre com compare-and-set (`updateMany where id and state = <esperado>`), o que também mata clique duplo.
- **Nada se apaga no meio do fluxo.** Trocar roteiro, rosto ou motor marca cenas e renders como `stale`; o histórico (e o custo) fica.
- **Binário nunca no banco.** `files` guarda a chave do storage; a URL assinada é gerada na resposta.
- **Dinheiro em USD** `Decimal(12,4)`; na API sai como número (`costUsd: 1.2345`). Tempo de mídia em segundos `Decimal(8,3)`.

## Entidades
| tabela | o que é | quem escreve |
|---|---|---|
| `users`, `refresh_tokens` | conta e sessão (JWT de acesso 15 min + refresh rotativo 30 dias, hash sha256) | backend (auth) |
| `workspaces`, `memberships`, `invites` | conta da empresa, quem está dentro (OWNER/ADMIN/MEMBER), convite por link | backend (workspaces) |
| `offers` | briefing de uma oferta: nome, idioma do conteúdo, link e 9 campos de texto (`kind, what, audience, promise, pains, proof, offer_and_price, cta, notes`) + `field_sources` (`page`/`user` por campo) | backend; extração preenche via job |
| `creatives` | um anúncio em produção: oferta (travada), estado, escolhas (roteiro, rosto, motor, voz, formato), ajustes de edição, render final, vencedor | backend (state machine) |
| `scripts` | 3 a 5 opções por criativo (letra A-E, ângulo, porquê, duração, blocos com tempo, vencedores usados) | backend grava o que a ia devolve |
| `faces` | rostos candidatos em lotes de 4 (`error_code` + `fail_reason` na falha) | backend; status vem do resultado da ia |
| `scenes` | cenas da geração (fala + prompt visual + clipe + tempos por palavra; `error_code` + `fail_reason` na falha) | backend |
| `renders` | cada render do Remotion (progresso, frame, falha, arquivo) | backend cria; progresso vem do render |
| `files` | todo arquivo no storage | backend (StorageService) |
| `jobs` | trabalho do Claude dentro da API (extrair briefing, escrever roteiros) com `stage` + `%` + erro humano | backend |
| `provider_tasks` | cada chamada assíncrona num provedor de mídia: WaveSpeed (cenas, voz, lipsync, transcrição) e Higgsfield (rosto Soul V2) — externalId, status, saídas, erro normalizado | **integracoes (ia)**; o backend só marca `handled_at` |
| `cost_entries` | custo real por chamada (Claude, WaveSpeed, Higgsfield e, na feature 2, Apify) | **só integracoes (ia)** |
| `change_requests` | "Pedir ajustes" da revisão final (tipo, cena, fala nova, nota) | backend |
| `uploads` | upload do navegador (PUT direto no storage ou pela API); vira `files` no complete | backend |
| `champions` | criativo de referência importado (vídeo, link da Ad Library, metadados, idioma, `has_speech`, declaração de dono) | backend |
| `teardowns` | transcrição com tempo por palavra, medições e as 12 seções do diagnóstico (editáveis) | backend grava o que a ia e a medição (video) devolvem |
| `variation_batches` | lote de variações: pedido, configurações de produção, estado do plano, `casting_style` (`DIVERSE` padrão \| `MATCH_ORIGINAL`, migração `20261007000000_casting_style`, §13.13) | backend |
| `variation_castings` | elenco do lote (descrição + rostos + escolhido) | backend |
| `variation_items` | uma variação planejada (alavanca, gancho/blocos); vira 1 criativo no launch | backend grava o que a ia devolve |

### Briefing (`offers`)
Os campos são os do mockup (`Offer name`, `Content language`, `What it is`, `Who it is for`, `Main promise`, `Pains`, `Proof`, `Offer and price`, `Call to action`) mais `kind` (aparece na lista de ofertas) e `notes` (o que evitar, tom). Todos opcionais no banco; a API exige `name` e `language` para salvar e `what` + `promise` para criar criativo a partir da oferta (sem isso o roteiro sai genérico).
`language` é BCP 47 (`en`, `pt-BR`, `es`): define o idioma do roteiro e da voz, não da interface.

### Roteiro (`scripts.blocks`)
```json
[
  { "label": "hook",    "startSec": 0,  "endSec": 3,  "speech": "I found $312 a month…", "visualPrompt": "SOLO SHOT, woman 30s in kitchen, looks at camera, holds phone at chest height" },
  { "label": "problem", "startSec": 3,  "endSec": 11, "speech": "…", "visualPrompt": "…" },
  { "label": "product", "startSec": 11, "endSec": 21, "speech": "…", "visualPrompt": "…" },
  { "label": "cta",     "startSec": 21, "endSec": 27, "speech": "…", "visualPrompt": "…" }
]
```
- `blocks[0]` é sempre o gancho (`label: "hook"`); a UI destaca ele. Labels seguintes são livres (a ia usa `problem`, `product`, `proof`, `cta`); o web traduz as conhecidas e mostra as outras como vieram.
- Formato único para os dois motores (decisão Q6): a fala alimenta TTS ou o áudio nativo; o prompt visual alimenta Kling/Seedance ou o lipsync.
- `informed_by_creative_ids`: vencedores usados na escrita (da mesma oferta primeiro; de outras ofertas só a estrutura, nunca a promessa).

### Cenas (`scenes`)
Criadas no **Generate** a partir do roteiro escolhido. A ia decide a quebra (um bloco pode virar 2 cenas se passar do limite do modelo, ex.: Kling 5/10/15 s). `generation` sobe a cada Generate completo; a geração vigente é a maior com `stale = false`. `words` (tempo por palavra) vem da transcrição e alimenta a legenda; a cena só fica `READY` com clipe validado **e** `words` gravado.

### Ajustes de edição (`creatives.edit_settings`)
```json
{
  "templateId": "clean",                       // catálogo em GET /templates: "clean" | "bold" | "headline"
  "captionStyle": "word",                      // "word" | "line" | "off"
  "captionPosition": "bottom",                 // "top" | "middle" | "bottom"
  "headline": "I found $312 a month",          // só se o template aceitar
  "ctaText": "Start your free trial",          // default = offer.cta
  "endCard": true
}
```
Defaults preenchidos quando todas as cenas ficam prontas. Mudar qualquer campo depois de um render pronto liga `edit_dirty`.

## Máquina de estados do criativo
`step` (rail do wizard) e `status` (chip da Home) são **derivados** do `state`:

| state | step | status | o que a tela mostra / o que libera |
|---|---|---|---|
| `SCRIPTS_WRITING` | scripts | `progress` | orb + checklist + streaming |
| `SCRIPTS_READY` | scripts | `waiting` | escolher roteiro (pode ser parcial: job `PARTIAL`) |
| `SCRIPTS_FAILED` | scripts | `failed` | nenhum roteiro saiu: "Try again" |
| `AVATAR_PENDING` | avatar | `waiting` | descrever quem aparece e gerar rostos |
| `FACES_GENERATING` | avatar | `progress` | efeito por tile + tempo |
| `FACES_READY` | avatar | `waiting` | escolher rosto |
| `FACES_FAILED` | avatar | `failed` | motivo (ex.: bloqueio de segurança) + rostos anteriores esmaecidos |
| `ENGINE_PENDING` | engine | `waiting` | escolher motor/voz/formato, ver custo, Generate |
| `SCENES_GENERATING` | generation | `progress` | barra + ETA; cena falha não para as outras |
| `SCENES_FAILED` | generation | `failed` | nenhuma cena gerando e ao menos uma falhou |
| `EDIT_PENDING` | edit | `waiting` | ajustes mudaram e ainda não renderizou |
| `RENDERING` | edit | `progress` | overlay %, frame X de N |
| `RENDER_FAILED` | edit | `failed` | frame da falha + "Render again" |
| `RENDER_READY` | review | `waiting` | vídeo pronto pra revisar (Approve / Request changes) |
| `APPROVED` | library | `approved` | na Biblioteca; pode virar vencedor |

`draft` (chip cinza) não é estado: a Home mostra `draft` para criativo em `AVATAR_PENDING`/`ENGINE_PENDING` sem mexida há mais de 7 dias. Filtros da Home: `progress` = status progress; `needs_you` = waiting + failed; `approved` = approved.

### Transições (as únicas válidas)
| de | evento | para |
|---|---|---|
| (novo) | `POST /creatives` (dispara roteiros) | `SCRIPTS_WRITING` |
| `SCRIPTS_WRITING` | job SUCCEEDED/PARTIAL | `SCRIPTS_READY` |
| `SCRIPTS_WRITING` | job FAILED sem nenhum roteiro | `SCRIPTS_FAILED` |
| `SCRIPTS_READY`, `SCRIPTS_FAILED` | gerar/regerar roteiros | `SCRIPTS_WRITING` |
| `SCRIPTS_READY` | selecionar roteiro | `AVATAR_PENDING` (ou `FACES_READY` se já houver rostos, ou `ENGINE_PENDING` se já houver rosto escolhido) |
| `AVATAR_PENDING`, `FACES_READY`, `FACES_FAILED` | gerar 4 rostos | `FACES_GENERATING` |
| `FACES_GENERATING` | ≥1 rosto do lote READY e nenhum pendente | `FACES_READY` |
| `FACES_GENERATING` | todos do lote FAILED | `FACES_FAILED` |
| `FACES_READY` | selecionar rosto | `ENGINE_PENDING` |
| `ENGINE_PENDING` | `POST /generate` | `SCENES_GENERATING` |
| `SCENES_FAILED`, `EDIT_PENDING`, `RENDER_FAILED`, `RENDER_READY` | `POST /generate` com `confirm: true` (troca de motor/voz/formato) | `SCENES_GENERATING` (geração anterior `stale`, renders `stale`) |
| `SCENES_GENERATING` | todas as cenas vigentes READY | `RENDERING` (render automático com os ajustes padrão) |
| `SCENES_GENERATING` | nenhuma pendente e ≥1 FAILED | `SCENES_FAILED` |
| `SCENES_GENERATING`, `SCENES_FAILED`, `EDIT_PENDING`, `RENDER_FAILED`, `RENDER_READY` | regerar uma cena (alvo `READY` ou `FAILED`) | `SCENES_GENERATING` (renders ficam `stale`) |
| `EDIT_PENDING`, `RENDER_FAILED`, `RENDER_READY` | `POST /render` | `RENDERING` |
| `RENDERING` | render READY | `RENDER_READY` (ou `EDIT_PENDING` se os ajustes mudaram durante o render) |
| `RENDERING` | render FAILED | `RENDER_FAILED` |
| `RENDER_READY` | mudar ajuste de edição | `EDIT_PENDING` |
| `RENDER_READY` | aprovar | `APPROVED` |
| `RENDER_READY` | change TEXT | `EDIT_PENDING` |
| `RENDER_READY` | change SCENE / LINE | `SCENES_GENERATING` (regera só a cena) |
| `RENDER_READY` | change FACE | `FACES_READY` (cenas `stale`) |
| (novo) | launch de um lote de variação (feature 2) | `SCENES_GENERATING` (roteiro, rosto, motor, voz e edição já gravados pelo lote) |

**Voltar no wizard** é navegação: não muda estado. Mudar uma escolha a montante muda:
- trocar roteiro (estado depois de `AVATAR_PENDING`) ou rosto (depois de `ENGINE_PENDING`) quando já existem cenas → a API responde `409 CONFIRM_DOWNSTREAM_RESET` com o que se perde; o web reenvia com `confirm: true`; cenas e renders viram `stale`; estado vai pro ponto certo (`ENGINE_PENDING` ou `FACES_READY`/`AVATAR_PENDING`).
- `APPROVED` é final: não aceita mudança (pra variar, importa como campeão; "Variar a partir da Biblioteca" vem depois do 10/10 via `champions.source_creative_id`).
- A oferta do criativo nunca muda depois de criado: o `PATCH /creatives/:id` só aceita `name` (`offerId` = 400 `VALIDATION_ERROR`).

### Criativo de variação (feature 2)
- **Transição de entrada nova:** `(novo) --launch do lote--> SCENES_GENERATING`, pra todo tipo. O criativo nasce com roteiro (`Script` letra A, `READY`, selecionado; `angle` = alavanca), rosto (`selectedFaceId` = rosto escolhido do elenco), motor, voz, `voiceSource`, formato e `editSettings` do lote já gravados. Daí em diante é a máquina v1 sem mudança: `SCENES_SETTLED` → `RENDERING` (render automático) → `RENDER_READY` → `APPROVED`.
- **Travas de variação** (`409 INVALID_STATE` com `details.reason: 'variation_locked'`): `scripts/generate`, `scripts/:id/regenerate|select`, `PATCH scripts` e `PATCH engine` não valem em criativo `origin = VARIATION`; `POST /generate` só com os parâmetros do lote (troca de rosto no SWAP_AVATAR: `FACES_READY` → escolher → `ENGINE_PENDING` → Generate com estimativa, sem reinício automático). A alavanca é do lote; mudar outra coisa contamina o teste.
- **Pedido de ajuste (`changes`) por tipo:** `TEXT` e `SCENE` valem em todos; `LINE` não vale com `AUDIO_LIPSYNC` (a voz original não fala texto novo) nem `SOURCE_CUT`; `FACE` só vale em `SWAP_AVATAR` (nos outros o rosto é a constante do lote). `review.changeOptions` já vem filtrado; pedido fora disso = `409 INVALID_STATE` `reason: 'change_not_available'`.
- `steps`: em variação, `offer`, `scripts`, `avatar` e `engine` vêm `done`. `summary.engineLabel` = rótulo do tipo de variação.

### Cenas: `pipeline` (feature 2)
| pipeline | cadeia | custo |
|---|---|---|
| `SCENE_VIDEO` | Kling/Seedance → TRANSCRIBE | v1 |
| `TTS_LIPSYNC` | TTS → LIPSYNC → TRANSCRIBE | v1 |
| `AUDIO_LIPSYNC` | trecho `source_start_sec`–`source_end_sec` do áudio do campeão → LIPSYNC; `words` do teardown (sem TRANSCRIBE) | só o lipsync |
| `SOURCE_CUT` | corte do vídeo do campeão, sem provedor (pós-10/10) | 0 |
| `REUSE` | copia clipe, miniatura e words de `reuse_of_scene_id` quando ela fica `READY`; dona `FAILED` → seguidora `FAILED`; regerar a seguidora a torna independente | 0 |
"Cena READY só com clipe validado, words e miniatura" continua valendo em todos.

## Máquina do campeão (feature 2)
| de | evento | para |
|---|---|---|
| (novo) | `POST /champions` só com link | `RESOLVING` (job `CHAMPION_RESOLVE`) |
| (novo) | `POST /champions` com upload (com ou sem link) | `ANALYZING` (job `CHAMPION_ANALYZE`; o link, se houver, só busca metadados no mesmo job, sem bloquear) |
| `RESOLVING` | link resolvido com vídeo e baixado | `ANALYZING` |
| `RESOLVING` | `AD_LIBRARY_UNAVAILABLE` / `AD_NOT_FOUND` / `AD_HAS_NO_VIDEO` / `MEDIA_INVALID` | `FAILED` (`action: upload_video`) |
| `ANALYZING` | teardown pronto | `READY` |
| `ANALYZING` | falha (transcrição, medição, Claude, `INTERRUPTED`) | `FAILED` (`action: analyze_again`; o que já ficou pronto, como transcrição e medições, é reaproveitado na nova tentativa) |
| `FAILED` | `PUT /champions/:id/video` (anexa upload) | `ANALYZING` |
| `FAILED`, `READY` | `POST /champions/:id/analyze` | `ANALYZING` (com teardown editado: exige `confirm`) |
Compare-and-set igual ao criativo. Só o backend escreve `status`.

## Máquina do lote (feature 2)
| de | evento | para |
|---|---|---|
| (novo) | `POST /champions/:id/batches` (campeão `READY`) | `PLANNING` (job `VARIATIONS_PLAN`) |
| `PLANNING` | ≥ 1 item `READY` e nenhum `WRITING` | `PLAN_READY` (itens falhos ficam `FAILED`, com "Regerar") |
| `PLANNING` | todos `FAILED` | `PLAN_FAILED` |
| `PLAN_READY`, `PLAN_FAILED` | `POST /variation-batches/:id/replan` | `PLANNING` (itens antigos descartados) |
| `PLAN_READY` | `POST /variation-batches/:id/launch` | `LAUNCHED` (final; cria os criativos) |
Depois de `LAUNCHED`, o progresso do lote é **derivado** dos criativos (`progress: { total, generating, waiting, failed, approved }`); não há mais estado salvo.

### Retomada depois de reinício da API
Jobs do Claude e renders rodam dentro do processo. No boot o backend: (1) marca jobs `RUNNING` como `FAILED` com `errorCode: INTERRUPTED` e aplica a transição de falha; (2) recoloca renders `RENDERING` como `QUEUED`. Tasks da WaveSpeed sobrevivem (o webhook volta) e o reconciliador cobre webhook perdido (ver `eventos.md`).

## Custos
- Estimativa: `GET /creatives/:id/estimate` (calculada pela ia, preço por unidade × unidades). O valor aceito no Generate vai pra `creatives.estimated_cost_usd`.
- Real: uma `cost_entries` por chamada paga (Claude incluso), gravada pela ia quando a chamada termina (sucesso ou falha cobrada).
- Gasto do mês = soma no mês UTC por workspace. Teto em `workspaces.monthly_spend_cap_usd`; toda ação paga checa `gasto + estimativa ≤ teto` antes de chamar o provedor (`409 SPEND_CAP_EXCEEDED`).
- Custo real do criativo = soma das `cost_entries` dele (aparece na revisão final).
- Feature 2: custo do campeão = `cost_entries` com `champion_id` (Apify, Whisper, Claude da análise); custo do lote = `cost_entries` com `variation_batch_id` (plano e rostos do elenco) + soma dos criativos do lote.

## Vencedores
`creatives.is_winner` (só em `APPROVED`). A ia recebe, ao escrever roteiros, até 5 vencedores da mesma oferta (roteiro escolhido + ângulo) e até 3 de outras ofertas do workspace (só estrutura). Sem tabela própria na v1: a métrica de anúncio (Meta) entra depois.

## Fora da v1 (já previsto pra não quebrar)
Credenciais de provedor por workspace (hoje as chaves vêm do `.env` da API; a tela Settings só mostra mascarado), métricas de anúncio, cobrança. Variar campeão saiu daqui: é a feature 2 ([`feature-2-variar-campeao.md`](feature-2-variar-campeao.md)), com `Creative.championId` (não `sourceCreativeId`, porque o campeão quase nunca é um criativo nosso).
