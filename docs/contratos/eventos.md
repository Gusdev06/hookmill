# Eventos: webhooks de entrada e tempo real (contrato v1)
Data: 2026-10-05 (feature 2: 06/10) · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta (G0 05/10; F2-G0 06/10)**

## Mudanças 13/10 (variação automática v1; detalhe em [`variacao-auto-v1.md`](variacao-auto-v1.md) §10)
- **Nenhum stream SSE novo.** Lote AUTO por polling de `GET /iterate/:id` a cada **1,5 s** enquanto `status ∈ {ANALYZING, PLANNING}`, `phase = generate` ou `zip.status = building`; para nos outros casos. Porquê: tela-resumo de um recurso só, estado no banco, 1,5 s basta pra barra de frame (a spec sugeria SSE por peça).
- Análise: job `CHAMPION_ANALYZE` existente (etapa `reading`) → job novo `AUTO_PLAN` (etapas `checking_brain` → `planning`). Zip: job `ZIP_BUILD` (etapa `zipping`).
- Render das peças sem webhook (mesma fila in-process): ordem 9:16 de todas as peças, depois 4:5, depois 1:1. `renderEtaSec` = segundos de saída restantes × velocidade medida nos últimos 20 renders do formato.
- Home: o polling de 5 s já cobre os lotes AUTO no `meta.waitingBatches`.

## Mudanças 06/10 noite (manter a edição + take contínuo; detalhe em [`feature-2-variar-campeao.md` §13](feature-2-variar-campeao.md))
- SSE novo `take.updated` (`Take` + `summary`); as fatias `TAKE_SLICE` emitem `scene.updated` espelhando o take.
- Cadeia LIPSYNC passa a ser **por take**: `TTS` (texto inteiro) → `LIPSYNC` (1 chamada) → `TRANSCRIBE` → `sliceTake` → fatias `READY` juntas. `AUDIO_LIPSYNC`: `LIPSYNC` → fatias `READY` (sem TRANSCRIBE). `provider_tasks.take_id` aponta pro take.
- Render `remix-keep`: sai mudo e remuxa o áudio do campeão com `-c:a copy`. Polling sem mudança.
> ⚠️ API dev da porta 3001 em MODO LIVE (Gusta testando com dinheiro): nenhum agente usa a 3001. Testes = API própria em mock; web = MSW ou API própria em outra porta.

## Mudanças 06/10 (feature 2 + rosto na Higgsfield)
- **Nenhum stream SSE novo.** Campeão e lote usam polling (tabela do §2); cada variação aberta usa o SSE do criativo que já existe. Porquê: análise e plano levam de 30 s a 2 min e as telas são resumo, como a Home.
- `provider.task.finished` ganha `championId?` (TRANSCRIBE do campeão retoma o job de análise).
- Cadeias novas por `scenes.pipeline`: `AUDIO_LIPSYNC` = LIPSYNC → cena `READY` (words do teardown, sem TRANSCRIBE); `REUSE` e `SOURCE_CUT` = sem task. Seguidora `REUSE` emite `scene.updated` no SSE do próprio criativo quando a dona termina.
- **Apify sem webhook:** `AdLibraryService.resolve` espera o run dentro do job (≤ 180 s). Reinício no meio = job `INTERRUPTED` → campeão `FAILED` (`action: analyze_again` ou `upload_video`).
- **Rosto (Higgsfield Soul V2) sem webhook:** a ia faz polling de 5 s nas tasks `provider = HIGGSFIELD` (laço próprio do reconciliador) e emite o mesmo `provider.task.finished`. O webhook assinado do §3 é só da WaveSpeed.

## Mudanças 05/10 (revisão da onda 2)
- Task `TRANSCRIBE` termina `COMPLETED` com `outputUrls: []`: o resultado (tempos por palavra) se lê por `GenerationService.parseWords(providerTaskId)`, não por URL.
- Bloqueio de conteúdo **na submissão** (antes de existir task na WaveSpeed) segue o mesmo caminho do webhook: a ia fecha a task como `FAILED` + `SAFETY_BLOCK` e emite `provider.task.finished`.
- O backend marca `provider_tasks.handled_at` depois de aplicar o resultado (única coluna dessa tabela que ele escreve).

## Decisão: como o status chega no web
**SSE por criativo no wizard + polling de 5 s na Home.** Porquê, em uma linha: o roteiro em streaming já exige empurrar texto do servidor, e SSE faz isso sobre HTTP comum, sem WebSocket nem infra extra, enquanto a Home só precisa de um resumo e polling é mais simples e aguenta reconexão de graça.

- O estado de verdade está **sempre no banco**. O SSE só avisa; se a conexão cair, o web refaz o `GET` da tela e reabre o stream. Não existe replay de evento perdido (não precisa).
- O barramento é in-process (`@nestjs/event-emitter`), porque a API roda em **uma** instância na VPS. Se um dia virar 2+ instâncias, troca o barramento por Postgres `LISTEN/NOTIFY` sem mudar o formato dos eventos.

## 1. SSE do criativo
`GET /api/v1/creatives/:id/events` · `Content-Type: text/event-stream` · autenticado.

- **Auth:** o `EventSource` nativo não manda header, então o web abre o stream com `fetch` + leitor de stream (ex.: `@microsoft/fetch-event-source`) mandando `Authorization: Bearer`. Token expirou → o web renova e reconecta.
- **Ao conectar**, o primeiro evento é `snapshot` com o `CreativeDetail` atual. Depois só deltas.
- **Heartbeat:** comentário `: ping` a cada 20 s (proxy do EasyPanel/Traefik não derruba conexão ociosa). O Nginx/Traefik precisa de `X-Accel-Buffering: no` (a API manda esse header).
- Fecha sozinho quando o criativo vai pra `APPROVED`.

Formato: `event: <tipo>` + `data: <json>`. Tipos:

| event | data | quando |
|---|---|---|
| `snapshot` | `CreativeDetail` | ao conectar |
| `creative.updated` | `{ id, state, step, status, statusKey, statusParams, progress, savedAt }` | toda transição de estado e autosave |
| `job.updated` | `Job` (com `checklist`) | job do Claude mudou etapa/status |
| `script.delta` | `{ scriptId, letter, blockIndex, field: 'speech'\|'angle'\|'rationale', text }` | pedaço de texto novo enquanto escreve (append no campo) |
| `script.updated` | `Script` | roteiro terminou, falhou ou foi editado |
| `face.updated` | `Face` | rosto mudou de status |
| `scene.updated` | `Scene` + `summary: { ready, total, failed, progress, etaSec }` | cena mudou de status/progresso |
| `render.updated` | `Render` | progresso do render (no máximo 2 eventos/s) |
| `cost.updated` | `{ costUsd }` | custo real do criativo mudou |
| `editor.updated` | `{ revision, savedBy: UserRef, savedAt }` | editor v1 (09/10, [`editor-v1.md`](editor-v1.md) §9): a cada `PUT /editor` e `PATCH /edit`; outra aba recarrega o doc ou avisa |

## 2. Polling
| quem | rota | intervalo | para quando |
|---|---|---|---|
| Home | `GET /creatives?filter=…` | 5 s | não houver linha com `status = progress` (volta a 30 s) |
| Extração de oferta (sem criativo ainda) | `GET /jobs/:id` | 1,5 s | `SUCCEEDED`/`PARTIAL`/`FAILED` |
| Importar / campeão (feature 2) | `GET /champions/:id` | 2 s | `status` ∈ `READY`, `FAILED` |
| Plano do lote (feature 2) | `GET /variation-batches/:id` | 1,5 s | `status` ≠ `PLANNING` |
| Lote lançado (feature 2) | `GET /variation-batches/:id` | 5 s | nenhum criativo do lote com `status = progress` (volta a 30 s) |

## 3. Webhook de entrada: WaveSpeed
`POST /api/v1/webhooks/wavespeed` · público · **assinado**. Dono: maquina-ia (`api/src/integracoes/`).

### Submissão
Toda chamada assíncrona na WaveSpeed vai com `?webhook=<PUBLIC_API_URL>/api/v1/webhooks/wavespeed` e grava uma `provider_tasks` com o `externalId` (id da task) **antes** de responder ao web.

### Verificação (doc oficial: wavespeed.ai/docs/verify-webhooks, conferida em 05/10)
- Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`.
- Segredo: `GET https://api.wavespeed.ai/api/v3/webhook/secret` (Bearer). Vem com prefixo `whsec_`, que sai antes de usar como chave. Fica em `WAVESPEED_WEBHOOK_SECRET`.
- Conteúdo assinado: `"{webhook-id}.{webhook-timestamp}.{raw_body}"` com o **corpo cru** (a API guarda `rawBody`; nada de re-serializar JSON).
- HMAC-SHA256, hex. Comparação em tempo constante. A doc não deixa claro se o header traz prefixo de versão (`v3,<hex>`): a ia confirma com uma sonda de centavos e registra em `docs/integracoes.md`.
- Rejeita timestamp com mais de 300 s → `401`. Assinatura inválida → `401`, sem tocar no banco.

### Payload (campos usados)
`id`, `model`, `status` (`completed`|`failed`|`cancelled`|`timeout`|`deleted`), `outputs[]` (URLs, só no sucesso), `error`, `created_at`, `urls.get`.

### Processamento (rápido e idempotente)
1. Verifica assinatura → acha `provider_tasks` por `externalId` (não achou: `200` e log, pra WaveSpeed não reenviar lixo).
2. Se `handledAt` já preenchido → `200` (reentrega).
3. Atualiza a task (`status`, `outputUrls`, `errorCode` normalizado) e grava `cost_entries` (ia).
4. Emite `provider.task.finished` no barramento interno e responde `200` **sem esperar** o resto.
5. O backend (orquestrador de geração) ouve o evento e faz o trabalho pesado fora da requisição: baixa a saída pro storage **validando o arquivo inteiro** (vídeo decodificado com ffprobe/ffmpeg; download truncado = tenta de novo até 3x, depois `DOWNLOAD_INVALID`), encadeia o próximo passo e marca `handledAt`.

### Cadeia por motor (o que cada webhook dispara)
| motor | por cena |
|---|---|
| `SCENES` | `SCENE_VIDEO` (rosto + prompt + fala, áudio nativo) → `TRANSCRIBE` (tempos por palavra) → cena `READY` |
| `LIPSYNC` | `TTS` (fala com a voz) → `LIPSYNC` (rosto + áudio) → `TRANSCRIBE` → cena `READY` |
| `SWAP_VIDEO` (A, §13.15, proposto) | `SCENE_VIDEO` sem som por janela, em sequência (`provider_tasks.window_index`; a k+1 parte do último frame da k) → emenda/corte (medicao) → `LIPSYNC_VIDEO` (clipe + fatia do áudio do campeão) → checagem SFace → cena `READY` |
| `SWAP_VIDEO` (B, §13.15, proposto) | `SCENE_VIDEO` com som por janela, em sequência → emenda → `TRANSCRIBE` → reencaixe (±8 %) → checagem → cena `READY` (ou `FAILED` `VOICE_FIT_OUT_OF_RANGE`/`SPEECH_MISMATCH`/`IDENTITY_DRIFT`) |
| rostos | `FACE_IMAGE` (Higgsfield Soul V2, termina por polling da ia) → rosto `READY` |
| feature 2: `AUDIO_LIPSYNC` | `LIPSYNC` (trecho do áudio do campeão) → cena `READY` |
| feature 2: campeão | `TRANSCRIBE` (`championId`) → job de análise segue (medição → Claude) |

Falha em qualquer passo → cena/rosto `FAILED` com `errorCode` e `failReason` humano (ex.: `SAFETY_BLOCK` → "The model blocked this image. Try a description without …"). Falha de uma cena não para as outras.

### Erros normalizados (ia → backend)
`SAFETY_BLOCK`, `PROVIDER_TIMEOUT` (status `timeout`), `PROVIDER_ERROR`, `CANCELLED`, `DOWNLOAD_INVALID`. O texto humano é do backend (i18n por `errorCode`), não da WaveSpeed.

### Reconciliador (webhook perdido)
Cron a cada 2 min (`@nestjs/schedule`, dono: ia): pega `provider_tasks` `SUBMITTED` com mais de 10 min, consulta `GET urls.get` e, se terminou, processa igual ao webhook (mesma função, mesma idempotência). Mais de 30 min sem terminar → `TIMEOUT`. O mesmo caminho serve pra desenvolvimento local sem túnel (`WAVESPEED_WEBHOOKS=off` → só polling a cada 15 s).

## 4. Render (sem webhook na v1)
O render roda **dentro da API** (decisão Q12), então não há webhook HTTP: o serviço de render (`api/src/render/`) chama `onProgress` e o backend grava em `renders` e emite `render.updated`.
- Fila: `renders` com `QUEUED`, um render por vez (`RENDER_CONCURRENCY=1`), mais antigo primeiro.
- Boot: `RENDERING` órfão volta pra `QUEUED`.
- **Reservado para o futuro (Lambda):** `POST /api/v1/webhooks/render`, assinado com HMAC-SHA256 do corpo cru em `X-Render-Signature` (`RENDER_WEBHOOK_SECRET`), payload `{ renderId, status, progress, frame, totalFrames, fileKey?, error? }`. Não implementar na v1.

## 5. Eventos internos (contrato entre módulos)
| evento | quem emite | quem ouve | payload |
|---|---|---|---|
| `provider.task.finished` | integracoes | backend (geracao; campeoes na feature 2) | `{ providerTaskId, kind, status, outputUrls, errorCode, faceId?, sceneId?, championId? }` |
| `job.progress` | backend (jobs) | backend (sse) | `Job` |
| `script.delta` | integracoes (via callback do backend) | backend (sse) | ver acima |
| `render.progress` | render (callback) | backend (renders) | `{ renderId, stage, progress, frame, totalFrames }` |
| `creative.changed` | backend (state machine) | backend (sse) | `{ creativeId }` |
