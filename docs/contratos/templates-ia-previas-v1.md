# Templates IA — prévias em imagem antes do vídeo (v1)

**07/11/2026 · APROVADO pelo Gusta (07/11) · dono `maquina-arquiteto`.** Código do passo 1 liberado: F04, F09 e F10, **local, sem deploy, sem push**, no worktree `../maquina-anuncios-wt-previas` (branch `with-ai-previas`, §12).
Decisões em `decisions/log.md` (entradas de 07/11). Mockup aprovado: [`design/mockup-with-ai-previas.html`](../../design/mockup-with-ai-previas.html) + spec [`design/with-ai-previas-2026-11-07.md`](../../design/with-ai-previas-2026-11-07.md).
Substitui, só no ponto da aprovação, a regra de 04/11 "sem aprovação intermediária" de [`templates-ia-background-v1.md`](templates-ia-background-v1.md) e do [handoff de 05/11](../handoffs/templates-ia-2026-11-05.md). O resto daquele contrato continua: reserva atômica do vídeo, idempotência, recuperação sem repetir chamada paga, estorno pelo ledger, template sem preço só para a equipe.

Escopo: FAQ (F04), podcast solo (F09), podcast duplo (F10). Os outros formatos ficam no §10, cada um com adendo próprio antes do código.

---

## 1. O delta, em 8 linhas

1. **Gerar** deixa de produzir vídeo. Gera **4 prévias grátis**: 4 ideias novas no formato escolhido (nenhuma fiel ao campeão), cada uma com **apresentador próprio** e a imagem-chave dele.
2. A pessoa aprova de 1 a 4 e confirma. Só as aprovadas viram MP4, cada uma uma peça (`VariationItem` + `Creative`) no mesmo lote.
3. **Aprovações incrementais:** ela pode voltar ao lote e aprovar mais prévias depois. Cada aprovação tem sua chave idempotente e sua reserva de vídeo. Não existe `409 already_approved`.
4. **A imagem aprovada é o quadro que o lipsync anima** (mesmo `Face`/`File`, §6).
5. **Prévias e refações não cobram crédito.** O vídeo continua com `Template.credits = null` (preço a definir): só equipe/INTERNAL usa, e o template não vai para `LIVE` (§7).
6. **Refazer = "Novo ângulo"** (refaz ideia + apresentador + imagem), grátis, teto **3 por prévia e 6 por lote**. Prévia que falhou tem **Tentar de novo**, que não conta no teto (§5.4).
7. Rotas novas: `approve`, `regenerate` e `retry` em `/iterate/:id/ai-previews/…`. O `/use` troca `generation` por `previews`. Status por polling de `GET /iterate/:id`, como hoje (sem SSE novo).
8. Migração aditiva: 1 enum, 4 colunas em `variation_items`, `UPDATE` de `outputs`. Flag `AI_PREVIEWS=on|off`: com `off`, o fluxo de 04/11 roda igual (rollback sem migração).

## 2. Fluxo do usuário

Templates › With AI › card do formato › campeão › **Make 4 previews** (sem custo) › tela de prévias (cards chegam um a um e já podem ser aprovados) › marcar › **Make N videos** › Confirmar (único passo com custo; hoje "— credits · price TBD") › progresso por peça › player, Download MP4 e Biblioteca.

Fechar a página não cancela nada. As prévias não aprovadas ficam `READY` no lote **sem prazo de validade**. A pessoa volta pelo histórico (`GET /ad-templates/runs`) ou pela Home ("Waiting for you") e aprova mais. Prévia que já virou vídeo aparece como "Video made".

## 3. Máquina de estados

### 3.1 Lote (`VariationBatch.status`, enum existente)

```
 /use (sem reserva)
      │
      ▼
 ┌──────────┐  planejador falhou / <2 prévias produzíveis / job interrompido / fim do planning com <2 READY
 │ PLANNING │────────────────────────────────────────────────────────────────► PLAN_FAILED (final)
 └────┬─────┘        (só sem nenhuma aprovação; depois da 1ª aprovação o lote já é LAUNCHED)
      │ nenhuma prévia em PLANNED/IMAGING e ≥2 READY
      ▼
 ┌────────────┐
 │ PLAN_READY │
 └────┬───────┘
      │ 1ª aprovação (de PLANNING ou PLAN_READY; CAS → LAUNCHED)
      ▼
 ┌──────────┐  aprovações seguintes, novo ângulo e retry continuam aceitos aqui
 │ LAUNCHED │
 └──────────┘
```

- A 1ª aprovação pode chegar ainda em `PLANNING` (o design deixa aprovar o card que já chegou). O lote vai direto para `LAUNCHED` e as prévias restantes terminam normalmente.
- `PLAN_FAILED` é avaliado **só** enquanto o lote está `PLANNING` e sem aprovação.

**Fase pública** (`IterateBatch.ai.phase`, derivada, só leitura). Avaliar nesta ordem:

| phase | regra |
|---|---|
| `failed` | lote `PLAN_FAILED`; ou há aprovadas, nenhuma rodando e todas `failed` |
| `producing` | alguma aprovada com peça ainda não terminada (`queued`/`running`) |
| `planning` | sem aprovadas e lote `PLANNING` |
| `previews_ready` | sem aprovadas e lote `PLAN_READY` |
| `done` | há aprovadas, todas terminadas e ≥1 `ready` |

Contadores ao lado (não mudam a fase): `ai.generating` (prévias em `planned`/`imaging`) e `ai.approvable` (prévias `ready`). Home "Waiting for you" = `approvable > 0` e nenhuma aprovação; a faixa "Make them too" = `phase = 'done'` e `approvable > 0`.

### 3.2 Prévia (`VariationItem.previewStatus`, enum novo `AiPreviewStatus`)

```
PLANNED ──(imagens submetidas)──► IMAGING ──(todas as imagens READY)──► READY ──(approve)──► APPROVED ──► segue o Creative
   │                                 │                                    │
   │ planejador falhou               │ imagem FAILED/nsfw/10 min          │ regenerate (novo ângulo, conta no teto)
   ▼                                 ▼                                    ▼
 FAILED ◄────────────────────────── FAILED                              PLANNED (sem variação até o planejador responder)
   │
   └─ retry (não conta no teto, máx. 2): failStage 'planning' → PLANNED · failStage 'imaging' → IMAGING (mesma descrição, seed nova)
```

- `PLANNED` tem dois sabores: com variação (aguardando submeter imagens) ou sem variação (novo ângulo/retry aguardando o planejador). A tela mostra os dois como "Writing the angle and hook".
- Prévia falha **não derruba o lote**. `APPROVED` é final para a prévia: não volta, não regenera.
- **Não existe `DISCARDED`**: prévia não aprovada fica `READY` para sempre (P4).
- O `Creative` **só nasce na aprovação**. Prévia não aprovada não deixa criativo nem peça na Biblioteca.
- Depois de `APPROVED`: `Creative` nasce em `FACES_GENERATING` com os rostos já `READY` → `SCENES_GENERATING` → `RENDERING` → `RENDER_READY`, com `RENDER_FAILED` e o retry de peça de hoje (`POST /iterate/pieces/:pieceId/retry`, reserva de novo pelo `beforeRetry`).

### 3.3 Falhas e recuperação (regra de 04/11: nunca repetir chamada paga de resultado desconhecido)

| onde | o que acontece |
|---|---|
| Planejador inicial falha, resposta inválida ou <2 produzíveis | job `FAILED`, lote `PLAN_FAILED` (`errorCode`, `failReason`). Nada a estornar |
| API reinicia com job do planejador `RUNNING` | job `FAILED/INTERRUPTED`, sem nova chamada. Inicial: lote `PLAN_FAILED`. Novo ângulo/retry: só aquela prévia `FAILED` (`failStage: 'planning'`) |
| API reinicia com job `QUEUED` (nenhuma chamada feita) | o sweep dispara o job |
| Imagem `FAILED`/`nsfw`/10 min sem terminar | só aquela prévia `FAILED` (`failStage: 'imaging'`, `action: 'retry'`) |
| Task de imagem com resultado desconhecido após reinício | reconciliador de `provider_tasks` (Higgsfield, polling 5 s), como hoje |
| Fim do planning sem aprovação e <2 `READY` | lote `PLAN_FAILED` |
| Boot (`RecuperacaoService`) | job de prévia (`AUTO_PLAN`, `input.kind` `ai_preview*`) `QUEUED` e rosto de prévia `QUEUED` ficam como estão (nenhuma chamada feita; o sweep retoma). Só `RUNNING`/`GENERATING` sem task viva viram `INTERRUPTED` |
| Vídeo aprovado falha | peça `failed`, estorno **daquela** peça pela linha da aprovação dela (§7) |

O `sweep` de `TemplatesAiService` varre: lotes IA `PLANNING`, itens com `preview_status ∈ {PLANNED, IMAGING}` e itens aprovados com `Creative` nos estados de hoje. O `advance()` passa a ser **por item** (`advanceItem(itemId)`), não `findFirst` por lote, e o `fail()` também (falha de uma peça não toca nas outras).

## 4. O que é uma prévia

### 4.1 Conteúdo (o que a tela mostra)

| campo | origem | limite |
|---|---|---|
| imagem-chave | F04/F09: 1 imagem 9:16 do apresentador no cenário. F10: 2 (host e convidado), lado a lado | Soul V2 1080p, 1152×2048 |
| título do ângulo (`title`) | planejador | ≤ 60 caracteres |
| ângulo em 1 frase (`angle`) | planejador | ≤ 140 |
| gancho (`hook`) | `beats[0].text` | — |
| resumo (`summary`) | planejador | ≤ 240 (2 frases) |
| roteiro (`beats[]`) | planejador; a v1 da tela não mostra (fica no tipo para o disclosure futuro) | 3 a 6 falas, cada ≥ 5 palavras, total ≤ 120 |
| "vs. your ad" (`changes[]`) | planejador; a tela mostra no máximo 3 | — |
| "Kept" (`preserved[]`) | planejador | — |
| elenco (`cast[]`) | por falante: nome de exibição, imagem, voz | F04/F09: 1 · F10: 2 |
| estimativa | duração (palavras / 2,6) e créditos do vídeo | — |

### 4.2 Regras do planejador (`semantic-v2`; o `semantic-v1` do `/ai-variations` interno não muda)

- Pedido fixo no formato do template. **4 ideias novas, nenhuma fiel** (P1): cada uma muda o eixo `angle` com tese própria, diferente do campeão e das outras 3. Sinônimo de headline não conta. Nenhuma repete o gancho do campeão.
- O planejador pede **5 candidatas**; o código guarda as 4 primeiras que passam no `producibleVariation` v2: formato certo, sem `requirements`, 3–6 falas, ≥ 5 palavras por fala, ≤ 120 palavras, F10 alternando host/presenter começando pelo host, `title`/`angle` distintos (normalizados) das já aceitas, `cast` com 1 (F04/F09) ou 2 (F10) falantes. Sobrou 2 ou 3: o lote mostra essas ("3 of 4"). Menos de 2: `PLAN_FAILED`.
- **Mesma oferta e mesmos fatos** (`factRefs`): preço, promessa, garantia e claims da oferta/Brain; número só se estiver na fala do campeão ou no `proof`; nada de depoimento inventado; apresentador sintético não relata experiência própria.
- **Apresentador diferente em cada prévia** (P2): cada variação traz `cast[]` com `gender` e `description` (pessoa + cenário) próprios, gerados a partir da oferta, sem nicho fixo no código. No F10, as 4 duplas diferem entre si; os 2 falantes da dupla têm olhares opostos. A voz sai de `voiceFor(gender, language, exclude)` (catálogo da `maquina-ia`): no gênero do rosto (`voice_gender_mismatch` nunca ocorre) e, quando o catálogo permitir, sem repetir voz dentro do lote.
- **Novo ângulo:** 1 chamada ao planejador pedindo 1 variação distinta das outras prévias vivas do lote (`READY`/`APPROVED`/`IMAGING`), com apresentador novo. Mesma validação.
- Idiomas: gancho e falas = idioma do campeão; `title`, `angle`, `changes`, `summary` e nomes no idioma da interface (`uiLocale` de quem pediu).

## 5. API

Convenções do `api.md` §1 (envelope, 202 para trabalho longo, workspace pelo token, `NOT_FOUND` para outro workspace). Quem chama: tela Templates/With AI (`web/src/components/templates/`). `CLIENT` só lê (403 nas escritas). Todas as escritas exigem `AI_PREVIEWS=on` (com `off`: `404` nas rotas novas e o `/use` volta ao corpo de 04/11).

### 5.1 `POST /ad-templates/:slug/use` (template `AI_VIDEO`)

- **Entrada:** fonte (igual a hoje: exatamente uma de `uploadId`/`creativeId`/`metaAdId`/`championId`/`researchAdId`, + `offerId?`, `cleanUploadId?`) + `previews: { requestId: UUIDv4 }`. `generation` passa a ser recusado (`400 VALIDATION_ERROR {field:'generation', rule:'notAllowed'}`). Não há `expectedCredits` (prévias grátis).
- **Saída:** `202 IterateBatch` com `status: 'PLANNING'`, `ai.phase: 'planning'`, `ai.previews: []`.
- **Erros:** os de hoje + `400 VALIDATION_ERROR {field:'previews'}` · `402 PAYMENT_REQUIRED` (amostra, ou `credits = null` com pagador não-INTERNAL, igual a hoje) · `409 SPEND_CAP_EXCEEDED` (estimativa planejador + imagens) · `409 INVALID_STATE {reason:'request_conflict'}` (mesma chave, outro corpo) · `422 OFFER_INCOMPLETE {fields}` · `503 PROVIDER_UNAVAILABLE`.
- **Idempotência:** chave em `batch.settings.aiPreviews.requestId` + `fingerprint` (fonte + template). Mesma chave e mesmo corpo = devolve o mesmo lote, sem novo job.

### 5.2 `GET /iterate/:id`

`IterateBatch` ganha `ai: AiPreviewsView | null` (null = lote que não é de prévias, incluindo os lotes IA de 04/11). Polling a cada 2 s enquanto `phase ∈ {planning, producing}` ou `generating > 0`. As prévias **não** aparecem em `pieces[]`; só as aprovadas, como peças normais (`pieceId`).

### 5.3 `POST /iterate/:id/ai-previews/approve`

- **Entrada:** `{ requestId: UUIDv4; previewIds: string[] (1..4, únicos); expectedCredits: int 0..10000 }`. `expectedCredits = (Template.credits ?? 0) × previewIds.length`.
- **Aceito com o lote em** `PLANNING`, `PLAN_READY` ou `LAUNCHED`; todas as `previewIds` precisam estar `READY` neste lote.
- **Saída:** `202 IterateBatch` com `status: 'LAUNCHED'` e `pieceId` preenchido nas recém-aprovadas.
- **Erros:** `400 VALIDATION_ERROR` · `404` (lote ou prévia de outro lote/workspace) · `409 INVALID_STATE {state, allowed:['PLANNING','PLAN_READY','LAUNCHED'], reason?: 'preview_not_ready' | 'request_conflict', previewIds?: string[]}` (lote `PLAN_FAILED`; alguma prévia não `READY`, inclusive já `APPROVED`; mesma chave com outro corpo) · `409 CREDITS_CHANGED {credits}` · `402 INSUFFICIENT_CREDITS` · `402 PAYMENT_REQUIRED` · `409 SPEND_CAP_EXCEEDED` (`MEDIA_BUDGET` × N) · `422 OFFER_INCOMPLETE`.
- **Concorrência:** roda sob o lock `template-run:<runId>`. Dentro de 1 transação: CAS de cada prévia `READY → APPROVED` (`updateMany … where previewStatus = READY`; contagem ≠ N = rollback e `409 preview_not_ready`), cria os `Creative`, chama `reserveOnApprove` (§7), lote `→ LAUNCHED` (se ainda não). Clique duplo e duas abas com a mesma chave produzem uma vez; duas abas com chaves diferentes e as mesmas prévias: a 2ª recebe `409 preview_not_ready`.
- **Idempotência:** `batch.settings.aiApprovals[]` = `{ requestId, previewIds, credits, attempt, at }`. Chave existente com o mesmo corpo = devolve o lote atual, sem nova reserva.

### 5.4 `POST /iterate/:id/ai-previews/:previewId/regenerate` ("Novo ângulo")

- **Entrada:** `{ requestId: UUIDv4 }`. Não há `part`: sempre refaz ideia + apresentador + imagem(ns).
- **Aceito:** prévia `READY`; lote `PLANNING`, `PLAN_READY` ou `LAUNCHED`.
- **Saída:** `202 AiPreview` com `status: 'planned'` e `regenerations.used` incrementado. O conteúdo anterior vai para `payload.preview.history[]` (auditoria; não volta na API).
- **Erros:** `404` · `409 INVALID_STATE {state: <previewStatus>, allowed:['READY'], reason?:'request_conflict'}` (prévia `planned`/`imaging`/`failed`/`approved`, ou lote `PLAN_FAILED`) · `429 REGEN_LIMIT {scope:'preview'|'batch', used, max}` (código novo) · `409 SPEND_CAP_EXCEEDED`.
- **Teto:** 3 por prévia (`preview_regens`) e 6 por lote (soma), constantes no código (`AI_PREVIEW_REGEN_PER_PREVIEW = 3`, `AI_PREVIEW_REGEN_PER_BATCH = 6`). Grátis: nenhum crédito; o custo de provedor vai para `cost_entries` e conta no teto mensal.
- **Idempotência:** `payload.preview.regens[] = { requestId, at }`. Mesma chave = devolve a prévia atual sem incrementar.

### 5.5 `POST /iterate/:id/ai-previews/:previewId/retry` ("Try again")

- **Entrada:** `{ requestId: UUIDv4 }`. **Aceito:** prévia `FAILED`; lote ≠ `PLAN_FAILED`.
- Refaz só o que falhou: `failStage: 'planning'` → `PLANNED` (planejador, 1 variação distinta); `failStage: 'imaging'` → `IMAGING` (mesmas descrições, seed nova; o apresentador não muda). **Não conta** no teto de refações. Máx. **2 por prévia** (`preview_retries`).
- **Saída:** `202 AiPreview`. **Erros:** `404` · `409 INVALID_STATE {allowed:['FAILED']}` · `429 REGEN_LIMIT {scope:'retry', used, max: 2}` · `409 SPEND_CAP_EXCEEDED`.
- **Idempotência:** `payload.preview.retries[] = { requestId, at }`.

### 5.6 Tipos (`contratos/src/templates-ai.ts`, exportados pelo `index.ts`; o arquivo é a fonte da verdade, inclusive dos tipos `semantic-v2` da porta do planejador)

```ts
type AiFormat = 'F04' | 'F09' | 'F10';
type AiPhase = 'planning' | 'previews_ready' | 'producing' | 'done' | 'failed';
type AiPreviewStatus = 'planned' | 'imaging' | 'ready' | 'failed' | 'approved';

interface UseAiTemplateBody { /* fonte de hoje */ previews: { requestId: string } }
interface ApproveAiPreviewsBody { requestId: string; previewIds: string[]; expectedCredits: number }
interface RegenerateAiPreviewBody { requestId: string }
interface RetryAiPreviewBody { requestId: string }

interface AiPreviewsView {
  phase: AiPhase;
  format: AiFormat;
  previews: AiPreview[];                       // ordem por index; 0 durante o planejador inicial, 2 a 4 depois
  generating: number;                          // prévias em planned/imaging
  approvable: number;                          // prévias ready
  prices: { videoEach: number | null };        // créditos por vídeo; null = sem preço (só equipe). Prévias: sempre grátis
  approvals: { requestId: string; previewIds: string[]; credits: number; at: string }[];
  limits: { regenPerPreview: 3; regenPerBatch: 6; regenUsed: number; retryPerPreview: 2 };
  errorCode: string | null; failReason: string | null;              // só em phase 'failed' por PLAN_FAILED
}

interface AiPreview {
  id: string; index: number; letter: 'A' | 'B' | 'C' | 'D'; status: AiPreviewStatus;
  title: string | null; angle: string | null; hook: string | null; summary: string | null;   // null enquanto planned sem variação
  beats: { speaker: 'host' | 'presenter'; role: string; text: string }[];
  changes: { axis: SemanticAxis; before: string; after: string }[];
  preserved: string[];
  cast: {
    speaker: 'host' | 'presenter'; name: string; gender: 'female' | 'male';
    voiceId: string; voiceName: string;
    image: { fileId: string; url: string; width: number; height: number } | null;
    status: 'queued' | 'generating' | 'ready' | 'failed';
  }[];
  estimate: { durationSec: number; credits: number | null };
  regenerations: { used: number; max: 3 };
  retries: { used: number; max: 2 };
  errorCode: string | null; failReason: string | null;
  failStage: 'planning' | 'imaging' | null;
  action: 'retry' | null;                      // 'retry' em failed com retries sobrando
  approvedAt: string | null;
  pieceId: string | null;                      // após approved: o IteratePiece do vídeo (player, MP4, retry)
}
```

`IterateBatch` ganha `ai?: AiPreviewsView | null`. `TemplateCard` ganha `aiFormat?: AiFormat` (só AI_VIDEO; A2, pedido do frontend: a tela não mapeia formato por slug).

**Fica para depois (A2, 07/11):** etapa do vídeo por peça além de `status`/`render.progress` do `IteratePiece` (a tela mostra as etapas derivadas do `status`; o chip "Faces" sai, como o design já previa); `phase`/`approvable` na lista `GET /iterate` e o bloco "Waiting for you" da Home (a pessoa volta pelo histórico `GET /ad-templates/runs`, que abre o lote). `PLAN_FAILED` na tela = `ai.phase === 'failed'` (sem campo novo). `ErrorCode` ganha `REGEN_LIMIT` (429) com detalhe `{ scope: 'preview' | 'batch' | 'retry'; used: number; max: number }`.

### 5.7 Persistência (para o backend; não sai na API)

- 1 `VariationItem` por prévia: `kind AUTO_EDIT`, `autoType AI_VIDEO`, `index` 0..3, `code` `AI-F10-A`, **`included: false` até a aprovação** (o `linesOf` genérico não pode contá-las), `preview_status`, `preview_regens`, `preview_retries`, `approved_at`.
- `payload = { params: { formatId }, preview: { version: 'semantic-v2', variation, summary, cast: [{ speaker, name, gender, description, voiceId, voiceName, castingId, faceId }], failStage, history: [], regens: [], retries: [] }, production? }`. `production` (formato de hoje: `variation`, `actors`, `generation`) nasce na aprovação a partir de `preview`.
- Rostos: `VariationCasting` (scope `ITEM`) + `Face` por falante, como hoje. Novo ângulo cria casting/face novos; os antigos ficam (auditoria, sem custo).
- Jobs: planejador inicial = `AUTO_PLAN` com `input { batchId, kind: 'ai_previews' }`; novo ângulo/retry de planejamento = `AUTO_PLAN` com `input { batchId, itemId, kind: 'ai_preview_regen' | 'ai_preview_retry' }`. CAS `QUEUED → RUNNING` antes da chamada externa, como hoje.

## 6. Da imagem da prévia ao vídeo (consistência)

- F04, F09 e F10 usam lipsync (Pruna `p-video/avatar`, imagem + áudio). A imagem-chave **é** o `Face` (`status READY`, `fileId`) que o `Scene.faceId` aponta. Na aprovação **nenhuma imagem é gerada de novo**: o criativo usa `selectedFaceId` = rosto da prévia e o lipsync anima o mesmo arquivo.
- Voz fixada na prévia (`cast[].voiceId`) e gravada no `Scene.voiceId`.
- F10: 2 imagens, uma por falante, olhares opostos; o vídeo corta entre os takes. Sem plano a dois na v1.
- Risco do Pruna (troca de pessoa após o frame 0, mão/celular inventado, segunda pessoa): mitigações de hoje continuam (clipes ≤ 30 s que recomeçam da foto, `SOLO SHOT`, pose em positivo, braços abaixo do quadro, nunca citar o objeto proibido). A revisão do vídeo antes de publicar continua.
- Prompt da imagem: `description` do planejador por falante → `facePromptV2` (realismo, sem marca, anti-slop). Nada de nicho no código.

## 7. Cobrança (decidida 07/11)

- **Prévias, novo ângulo e retry: grátis.** Nenhuma reserva, nenhuma linha no `TemplateRun`, nenhum `expectedCredits`. O custo de provedor (≈ US$ 0,19–0,21 por rodada, §7.1) é registrado em `cost_entries` e conta no `assertWithinCap` do workspace.
- **Vídeo:** `Template.credits` × N por aprovação. Hoje `credits = null` nos 3 templates: eles seguem `DRAFT`, o `TEMPLATE_UNPRICED` impede `LIVE`, e só equipe/INTERNAL usa (`expectedCredits: 0`). Antes de liberar para cliente, o Gusta define o preço do vídeo e se as prévias continuam grátis (aí entra um limite de rodadas por dia; fora da v1).
- **`reserveOnApprove(tx, run, auth, { itemIds, expectedCredits, approvalIndex })`** (novo, irmão do `reserveOnStart`), por aprovação:
  - aceita `run.status ∈ {DRAFT, RESERVED, SETTLED}`;
  - acrescenta 1 linha `{ key: '<internalKey>#<approvalIndex>', itemIds, credits: Template.credits × N, state: 'held' }` às `lines` (**decidido na A2: a linha guarda o total**, como as linhas de tier `AI` de hoje; o `deliveredOf` cobra a parte das prontas);
  - `quote = credits × N`; `≠ expectedCredits` = `409 CREDITS_CHANGED`; com pagador: `RESERVE` com `ledgerKey.reserve(run.id, attempt + 1)`; `held += quote`, `attempt += 1`, `status = RESERVED`, `settledAt = null`; `uses + 1` só na 1ª aprovação.
  - O `settleRun` reavalia só as linhas `held` e mantém as já assentadas como estão (testado em `creditos/regras.spec.ts` com linhas mistas). **Decidido na A2:** ele espera **todas** as linhas `held` terminarem antes de assentar; o estorno de uma peça falha pode esperar a produção de outra aprovação do mesmo lote (aceito: no máximo minutos, e o saldo já reservado não some). O CAS por `attempt` impede assentar no meio de uma aprovação nova.
- O `beforeRetry` (retry de peça falha) continua igual, procurando a linha pelo `itemId`.

### 7.1 Custo de provedor (estimativa; o real vem do `cost_entries`)

| etapa | conta | US$ |
|---|---|---|
| Planejador inicial (Opus 5.5, US$ 4/20 por Mtok, 5 candidatas) | ~10 mil tokens entrada + ~6 mil saída | ≈ 0,16 |
| Imagens Soul V2 (US$ 0,006 cada) | F04/F09: 4 · F10: 8 | 0,024 / 0,048 |
| **Rodada de prévias** | | **≈ 0,19 – 0,21** |
| Novo ângulo | ≈ 0,05 + 1–2 imagens | ≈ 0,06 |
| Teto de refações por lote (6) | 6 × 0,06 | ≈ 0,36 |
| **1 vídeo aprovado** (≤ 120 palavras ≈ 46 s) | TTS ~0,04 + lipsync 46 × 0,025 + transcrição 46 × 0,002 | **≈ 0,85 – 1,30** |

Pior caso de prévias por lote, grátis: ≈ US$ 0,57. Modelos de imagem: **Soul V2** para F04/F09/F10 (integrado, A/B de 06/10). gpt-image-2 não entra em prévia. Nano Banana 2.1 / Seedream 4.5 ficam para cartoon (§10).

## 8. Migração aditiva `20261110000300_templates_ai_previews`

```sql
CREATE TYPE "AiPreviewStatus" AS ENUM ('PLANNED','IMAGING','READY','FAILED','APPROVED');
ALTER TABLE "variation_items"
  ADD COLUMN "preview_status"  "AiPreviewStatus",            -- null = item que não é prévia (todos os de hoje)
  ADD COLUMN "preview_regens"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "preview_retries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approved_at"     TIMESTAMP(3);
CREATE INDEX "variation_items_batch_id_preview_status_idx" ON "variation_items" ("batch_id","preview_status");
UPDATE "templates" SET "outputs" = 4 WHERE "internal_key" IN ('AI_VIDEO:F04','AI_VIDEO:F09','AI_VIDEO:F10');
```

- Nenhuma coluna existente muda, nenhum dado é reescrito (fora o `outputs` dos 3 templates). Lotes IA de 04/11 (`preview_status` null) seguem no fluxo antigo.
- **Sem `templates.preview_credits`**: prévias grátis (P3). Se um dia tiverem preço, entra numa migração própria.
- **Onde roda agora: só local**, nos bancos do worktree (§12): `maquina_previas` e `maquina_previas_test`. **Nunca** no `maquina` (F1b + dados do Gusta) nem em produção nesta fatia. Backup antes. Ao juntar com a F1b, conferir se ela criou uma migração com o mesmo prefixo de data; se sim, renomear a nossa para depois da dela.

## 9. Teste real (autorizado 07/11; só depois do QA verde em mock)

- **Teto: US$ 4 e 2 vídeos** (resposta do Gusta lida como a 1ª opção de "US$ 4 com 2 vídeos ou US$ 3 com 1"; confirmar a leitura com ele antes de rodar).
- **Sem campeão real:** criar oferta fictícia **"renda extra com IA", R$ 97**, num workspace INTERNAL de teste, e um criativo de partida com fala; as prévias saem dele.
- Pré-condições: §13 fechado com QA verde em mock (idempotência das 4 rotas, aprovação incremental, aprovação concorrente, teto de refações, retry, recuperação com job interrompido, estorno por peça). Workspace com **teto mensal de US$ 4** (`assertWithinCap` corta sozinho). API **numa instância própria**, nunca a 3001 do time. `INTEGRACOES_MODE=live` só nela.
- Rodada: **F10**. Gerar prévias (≈ US$ 0,21), conferir que as 4 são distintas, sem fato inventado, com 4 duplas diferentes. Aprovar 1, depois voltar e aprovar a 2ª (prova o P4). ≈ US$ 2,8 no pior caso.
- Medir em `reports/templates-ia-previas-<data>/`: `cost_entries` vs. estimativa, tempo até `PLAN_READY` e até o MP4, frame 0 vs. imagem aprovada (lado a lado), troca de pessoa no take (folha de contato 1 fps), alternância, voz no gênero do rosto, legenda. Download validado decodificando inteiro (a WaveSpeed trunca sem erro).
- Parada: `SPEND_CAP_EXCEEDED`, fato fora da oferta ou troca de pessoa encerram. Decisão volta ao Gusta, sem retry automático.

## 10. Formatos 2 a 4 no mesmo esqueleto

O esqueleto não muda: planejador por formato → 4 prévias (ângulo + imagem-chave) → aprovar → motor do formato. Cada um define só **o que é a imagem-chave** e **qual motor anima**, com adendo de contrato antes do código.

| ordem | formato | imagem-chave | motor candidato | custo/vídeo (≈ 30 s) | risco principal |
|---|---|---|---|---|---|
| 2 | Talking head (F01) | Soul V2, pessoa falando para a câmera (US$ 0,006) | o de hoje: TTS + Pruna + Remotion | ≈ US$ 0,85 | parecer depoimento de cliente; selfie atrai o celular inventado do Pruna |
| 3a | Animação explicativa / motion (F20, F06) | quadro do próprio Remotion (US$ 0) | TTS + Remotion, sem IA de vídeo | ≈ US$ 0,05–0,10 | ficar genérico; pede templates Remotion de qualidade |
| 3b | Cartoon com personagem (F24) | Nano Banana 2.1 edit, ficha + quadro (≈ US$ 0,08–0,12) | Seedance 2.0 i2v ou Kling 3.0; lipsync em rosto desenhado não testado | ≈ US$ 3,2–7,2 | custo 4–8× o podcast; personagem muda entre clipes; sonda de 4 s antes (≈ US$ 0,43) |
| 4 | Musical (F28) | capa + letra; a prévia precisa de 15 s de áudio | modelo de música com voz (fora do catálogo) + lipsync cantado + Remotion | desconhecido | letra presa aos fatos, licença do modelo; pesquisa de motor antes do contrato |

## 11. Decisões do Gusta (07/11)

| # | pergunta | decisão |
|---|---|---|
| P1 | prévia fiel ao campeão? | 4 ideias novas, nenhuma fiel |
| P2 | mesmo apresentador ou diferente? | diferente em cada prévia |
| P3 | quanto cobrar? | prévias grátis por enquanto; preço do vídeo em aberto (`null`, só equipe) |
| P4 | aprovou, acabou? | pode voltar e aprovar mais prévias do mesmo lote |
| P5 | teste real | US$ 4 com 2 vídeos; oferta fictícia "renda extra com IA", R$ 97 |
| — | refazer | só "Novo ângulo", grátis, 3 por prévia e 6 por lote |
| — | código | passo 1 liberado, local, sem deploy, sem push |

## 12. Ambiente isolado (preparado em 07/11 pelo arquiteto)

A F1b trabalha no checkout principal (branch `f1b`, com arquivos sem commit). **Ninguém desta frente toca no checkout principal, no banco `maquina` nem na API 3001.**

| item | valor |
|---|---|
| worktree | `/data/cerebros/gusta/projects/maquina-anuncios-wt-previas` |
| branch | `with-ai-previas`, criada do HEAD de `f1b` (`9317939`) |
| AIOS | `projects/maquina-anuncios-wt-*/` no `.gitignore` do AIOS (o auto-sync não versiona o worktree) |
| `node_modules` | **sem reinstalar**: a raiz tem symlinks para cada pacote do checkout principal, exceto `@maquina/*` (links relativos para os pacotes do próprio worktree), `.prisma` e `@prisma` (cópia própria: o `prisma generate` daqui não sobrescreve o client da F1b). `api/`, `testes/`, `video/node_modules` = symlink. `video/dist` construído no worktree |
| dependência nova | **não instalar** sem falar com o arquiteto (o `npm install` escreveria no `node_modules` compartilhado da F1b) |
| `api/.env` | do `.env.example`, sem chave paga: porta **3141**, banco `maquina_previas`, `INTEGRACOES_MODE=mock`, `META_MODE=mock`, `RENDER_IMPL=remotion`, MinIO local, `META_CRON=off`, `AI_PREVIEWS=on` |
| `web/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:3141/api/v1`; web na **3236** (`npx next dev --port 3236`) |
| banco dev | `maquina_previas` (local, migrado até `20261110000300_templates_ai_previews` em 07/11, seed: `gusta@exemplo.com`) |
| banco de teste | `maquina_previas_test` (local, migrado até `20261110000300_templates_ai_previews` em 07/11); jest e e2e desta frente usam só ele |
| shadow | só `npm run db:diff` (URL literal do `maquina_shadow`). Proibido `migrate dev`/`reset`/`db push` |

Comandos (sempre a partir do worktree):

```bash
W=/data/cerebros/gusta/projects/maquina-anuncios-wt-previas
cd $W && npm run typecheck -w contratos -w api -w web -w video      # verde em 07/11
cd $W && npm run typecheck -w testes                                  # já falha na f1b: 5 erros em specs/qa-0311-api/templates-v2.spec.ts (não é desta frente)
cd $W/api && npx prisma generate                                      # client local do worktree
cd $W/api && npx jest src/templates-ai src/creditos/regras.spec.ts    # unitários: rodam hoje
# int specs (depois da B0): só no banco desta frente
cd $W/api && TEST_DATABASE_URL='postgresql://maquina:maquina@localhost:5433/maquina_previas_test?schema=public' npx jest templates-ai
# migração nova (depois da A1), nesta ordem:
cd $W && npm run db:backup -- --from maquina_previas && npm run db:backup -- --from maquina_previas_test
cd $W/api && for d in maquina_previas maquina_previas_test; do DATABASE_URL="postgresql://maquina:maquina@localhost:5433/$d?schema=public" DIRECT_URL="postgresql://maquina:maquina@localhost:5433/$d?schema=public" npx prisma migrate deploy; done
# API e web do worktree
cd $W/api && npm run dev        # 3141
cd $W/web && npx next dev --port 3236
```

## 13. Tarefas

Posse por arquivo para rodar em paralelo sem colisão. Fora da lista = pedir ao dono. Ninguém faz commit/push sem o Gusta pedir.

| id | dono | o que | arquivos (posse) | depende de |
|---|---|---|---|---|
| **A1** ✅ 07/11 | maquina-arquiteto | tipos (vista, corpos, `semantic-v2` da porta), schema, migração aplicada nos 2 bancos com backup, `REGEN_LIMIT` no contrato e no `error-codes.ts` (só código + mensagem, para a checagem de paridade não quebrar) | `contratos/src/templates-ai.ts` (novo), `contratos/src/index.ts`, `contratos/src/iteracao.ts` (só `IterateBatch.ai`), `contratos/src/templates.ts` (só `UseTemplateBody.previews`), `api/prisma/schema.prisma`, `api/prisma/migrations/20261110000300_templates_ai_previews/`, `api/src/common/errors/error-codes.ts` (2 linhas), `docs/` | — |
| **B0** | maquina-backend | jest aceitar `maquina_<x>_test` local via `TEST_DATABASE_URL` (hoje só `maquina_test`) | `api/src/common/testing/ambiente-teste.ts`, `api/src/jest.setup-env.spec.ts` | — (pode começar já) |
| **I1** | maquina-ia | porta do planejador v2: `planPreviews(ctx, { format, count: 5, uiLocale })` e `planOne(ctx, { format, exclude: variações vivas })`, prompt `semantic-v2` (§4.2: ideias novas, cast próprio, fatos da oferta), mock determinístico com 5 candidatas distintas (inclui 1 inválida para testar o filtro), custo em `cost_entries`; `voiceFor(gender, language, exclude)`; `facePromptV2` aceitar a `description` do cast | `api/src/integracoes/claude/semantic-planner.ts`, `api/src/integracoes/claude/` (arquivos novos `semantic-v2*.ts`), catálogo de vozes e `facePromptV2` em `api/src/integracoes/` | A1 |
| **B1** | maquina-backend | `/use` com `previews` (DTO, idempotência, sem reserva); job do planejador inicial → itens-prévia (`included: false`) → imagens; `producibleVariation` v2; sweep/`advanceItem`/`fail` por item; transições do lote e da prévia (§3) | `api/src/templates-ai/` (todos), `api/src/templates/templates.service.ts` (só o ramo `AI_VIDEO` do `use`), `api/src/templates/templates.dto.ts` | A1, I1 (pode codar contra a interface da porta antes do mock ficar pronto) |
| **B2** | maquina-backend | rotas `approve`, `regenerate`, `retry` (DTOs, lock, CAS, idempotência, tetos); `reserveOnApprove` + `settle` com linhas mistas + testes; `ai` no `GET /iterate/:id` (vista, fase, contadores) e prévias fora de `pieces[]`; int specs no `maquina_previas_test` | `api/src/iteracao/iteracao.controller.ts`, `iteracao.dto.ts`, `iteracao.views.ts`, `api/src/creditos/creditos.service.ts`, `api/src/creditos/regras.ts` + specs, `api/src/common/errors/error-codes.ts`, `api/src/templates-ai/*.int.spec.ts` | B1 |
| **F1** | maquina-frontend | telas do mockup: galeria IA (cards, "Soon"), detalhe, Winner com "Make 4 previews", tela de prévias (cards A–D, F10 lado a lado, estados gerando/falhou/refazendo/esgotado/"Video made"), Confirmar, vídeos, assistir; Home "Waiting for you"; polling de 2 s; EN/PT; 1440 e 390 | `web/src/components/templates/` (arquivos novos `ai-*.tsx` + `gallery.tsx`, `run-screen.tsx`, `ad-step.tsx`, `parts.tsx`), `web/src/lib/` (cliente das rotas novas), `web/messages/` (chaves `templates.ai.*`), componente da Home só no bloco "Waiting for you" | A1 (tipos). Contra a API mock: B2 |
| **Q1** | maquina-qa | API (4 rotas): idempotência, conflito de chave, aprovação incremental (1 + depois mais 1), aprovação concorrente (2 abas), teto 3/6, retry (2) fora do teto, `PLAN_FAILED` com <2, job interrompido no reinício, estorno por peça, `AI_PREVIEWS=off` = fluxo de 04/11; UI 1440/390 contra o mockup; relatório datado | `testes/specs/qa-previas-api/`, `testes/specs/qa-previas-ui/`, `testes/playwright.qaprevias.config.ts` (`E2E_DATABASE_URL` = `maquina_previas_test`, portas 3151/3246), `testes/qa-previas-<data>.md` | B2 + F1 |
| **A2** | maquina-arquiteto | revisão de cada entrega contra este contrato (divergência volta ao dono com o ponto exato) | — | cada entrega |
| **T1** | arquiteto + qa | teste real do §9 (US$ 4, 2 vídeos), instância própria em live | `reports/templates-ia-previas-<data>/` | Q1 verde + confirmação da leitura "US$ 4 / 2 vídeos" |

Ordem: **A1 e B0 em paralelo → I1 e B1 em paralelo (B1 contra a interface da porta) → B2 → F1 começa logo após A1 (com fixtures dos tipos) e liga na API quando B2 fechar → Q1 → T1.** `maquina-video` não entra: o render e o lipsync são os de hoje.
