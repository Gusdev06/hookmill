# Variação automática de campeão v1: contrato
Data: 2026-10-13 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 13/10** (as 5 decisões do §13 como recomendadas). Código liberado na ordem do §11.
Base: spec aprovada `design/variacao-auto-v1-2026-10-12.md` (13/10, §10 respondido) + mockup https://claude.ai/artifact/D9F5BwAoxCUKTihuu95Rmv; `design/catalogo-variacoes-criativo-2026-10-12.md`; `decisions/log.md` (12/10 "variação de campeão vira automática"; 13/10 "spec da variação automática aprovada"). Convenções, envelope, erros e auth: [`api.md` §1](api.md). Reaproveita: uploads, campeão + teardown + editMap ([`feature-2-variar-campeao.md`](feature-2-variar-campeao.md)), `VariationBatch`/`VariationItem`, fila de render, `adName` e download ([`fase2-agencia.md` §3.5 e §6](fase2-agencia.md)), Library.

## 0. Resumo em 5 linhas
1. O usuário sobe um vídeo (ou escolhe da Library) e a API cria **um lote `AUTO`**: roda a análise que já existe (transcrição, medição, mapa da edição, teardown) e depois **uma chamada nova do Claude** que devolve o "porquê" (HOOK/PROOF/CTA), o que fica intacto e o plano de 8 a 12 peças.
2. O plano usa só os 9 tipos da v1 (CUT, COLD-OPEN, HOOK-TEXT, ENDCARD, SPLIT-LP, STORY, REVIEW, NATIVE-SEARCH, STATIC). O backend confere as regras (contagem, ≥ 40 % diversidade, uma variável por peça, nada inventado) antes de mostrar.
3. **Gerar** cria 1 `Creative` por peça (variação do campeão, `variationCode` = código) e 3 renders (9:16, 4:5, 1:1) num template Remotion novo `auto-edit`, sem nenhuma chamada de vídeo paga. Peça pronta é aprovada sozinha e entra na Library.
4. O único ajuste depois de gerar é **"In zip"**. O zip sai com 2 pastas (esticar a vida / público novo), README em cada uma e nomes `CLIENTE_MMDD_CODIGO_FORMATO`.
5. Status por **polling** de `GET /iterate/:id` (1,5 s). Custo: só a análise (Whisper + Claude). Render = US$ 0.

## 1. Conceitos
| conceito | onde mora | o que é |
|---|---|---|
| **Lote automático** | `VariationBatch` com `mode = AUTO` | 1 por "Iterate". Guarda o insight (porquê, blocos, flags), o plano e o estado. |
| **Campeão** | `Champion` (existente) | o vídeo analisado. Upload → campeão novo. Library → campeão com `sourceCreativeId`, reaproveitado se já foi analisado. |
| **Linha do plano / peça** | `VariationItem` com `kind = AUTO_EDIT` | uma linha do plano antes de gerar; a mesma linha é a peça depois. O `id` da peça é o `id` do item (estável do plano ao download). |
| **Criativo da peça** | `Creative` (`origin VARIATION`, `variationKind AUTO_EDIT`, `variationCode`) | nasce no Gerar; 3 `Render` (um por formato). É o que a Library mostra. |
| **Tipo / código** | `autoType` + `code` | tipo = um dos 9; código = o rótulo da variável no idioma da oferta (`CUT-15S` / `CORTE-15S`), igual na tela, no arquivo, no zip e no README. |
| **Eixo** | `axis` | `ITERATION` (mesmo visual, edição diferente → pasta "esticar a vida") ou `DIVERSITY` (muda o 1º frame → pasta "público novo"). Fixo por tipo (§6). |

**Alinhamento com a spec.** A spec fala em `sourceCreativeId + variationType`. No código, o vínculo da variação com o campeão já é `Creative.championId` (o campeão quase nunca é um `Creative` nosso; quando é, fica em `Champion.sourceCreativeId`). O "variationType = código" vira a coluna nova `Creative.variationCode`. Nada paralelo.

## 2. Modelo de dados (delta no `schema.prisma`, descrito; **não aplicado**)
Migração aditiva `20261014000000_variacao_auto`, escrita pelo arquiteto depois do ok, via `npm run db:diff`, com `npm run db:backup` antes (regra do TIME.md). Nada removido, nada renomeado.

```prisma
// ── enums: valores novos ──
// VariationKind         + AUTO_EDIT
// VariationBatchStatus  + ANALYZING  + ANALYSIS_FAILED      (só lotes AUTO usam)
// JobType               + AUTO_PLAN  + ZIP_BUILD
// FileKind              + RENDER_IMAGE (PNG do STATIC)  + PAGE_CAPTURE (print da página)  + ZIP_ARCHIVE

// ── enums novos ──
enum BatchMode { MANUAL AUTO }                       // MANUAL = feature 2 de hoje (default); AUTO = este contrato
enum AutoVariationType { CUT COLD_OPEN HOOK_TEXT ENDCARD SPLIT_LP STORY REVIEW NATIVE_SEARCH STATIC }
enum VariationAxis { ITERATION DIVERSITY }

model VariationBatch {
  // ... campos atuais sem mudança (requests = [] e settings = {} nos lotes AUTO)
  mode              BatchMode  @default(MANUAL)
  insight           Json?                          // AutoInsight (§4): blocos com função, porquê, kept, flags, contexto do Brain
  errorCode         String?    @map("error_code")  // ANALYSIS_FAILED: código assíncrono
  failReason        String?    @map("fail_reason") // frase humana (fallback EN; o web traduz pelo código)
  failDetail        String?    @map("fail_detail") // detalhe técnico (mono na tela)
  failStage         String?    @map("fail_stage")  // 'reading' | 'brain' | 'planning'
  pageCaptureFileId String?    @map("page_capture_file_id") // PAGE_CAPTURE tirado na análise (SPLIT-LP)
  zipFileId         String?    @map("zip_file_id") // último zip gerado
  zipKey            String?    @map("zip_key")     // sha1 dos (pieceId, fileIds) incluídos; igual = reaproveita o zip
  downloadedAt      DateTime?  @map("downloaded_at") // 1º download do zip; tira o lote do "Waiting for you"
  @@index([workspaceId, mode, status])
}

model VariationItem {
  // ... campos atuais sem mudança; nos itens AUTO: kind = AUTO_EDIT, index = ordem no plano (0..n-1),
  //     status = READY (o plano nasce inteiro), lever = null, rationale = porquê da linha, payload = { params } (§7)
  autoType  AutoVariationType? @map("auto_type")
  code      String?                                 // "CUT-15S" / "CORTE-15S"; único no lote
  axis      VariationAxis?
  change    String?                                 // "a única coisa que muda", idioma da interface, ≤ 90
  inZip     Boolean            @default(true) @map("in_zip")
  leftOutAt DateTime?          @map("left_out_at")  // "Leave out" numa peça falha; Retry limpa
  @@unique([batchId, code])
}

model Creative {
  // ... campos atuais sem mudança
  variationCode String? @map("variation_code")      // = item.code (filtro da Library e adName)
}

model Render {
  // ... campos atuais sem mudança
  format VideoFormat?                               // null = creative.format (renders de hoje); peça AUTO = um por formato
  @@index([creativeId, format])
}
```
**Por que não uma tabela `Piece`:** a peça já é exatamente `VariationItem` (plano) + `Creative` (resultado), que é como a feature 2 inteira funciona; uma tabela nova duplicaria estado. **Por que `Render.format`:** a peça é 1 criativo com 3 saídas; `Creative.finalRenderId` continua apontando pro 9:16 (o que a Library toca), os outros dois são achados por `(creativeId, format, status READY)`.

Limites do upload passam a ser os da spec (env, sem código novo): `UPLOAD_MAX_BYTES=524288000` (500 MB), `CHAMPION_MIN_SEC=4`, `CHAMPION_MAX_SEC=180`. Valem pro fluxo antigo também. O backend confere antes se o bucket aceita 500 MB por objeto.

## 3. Estados
### 3.1 Lote AUTO (`VariationBatch.status`; compare-and-set, só o backend escreve)
| de | evento | para |
|---|---|---|
| (novo) | `POST /iterate` com campeão novo ou ainda não analisado | `ANALYZING` (job `CHAMPION_ANALYZE` do campeão, o mesmo de hoje) |
| (novo) | `POST /iterate` com campeão da Library já `READY` (teardown + editMap prontos) | `PLANNING` (pula a leitura; custo da análise = só o plano) |
| `ANALYZING` | campeão `READY` | `PLANNING` (job `AUTO_PLAN`) |
| `ANALYZING` | campeão `FAILED` | `ANALYSIS_FAILED` (`failStage: reading`) |
| `PLANNING` | plano válido (§6.3) | `PLAN_READY` |
| `PLANNING` | Claude falhou 2x, plano inválido depois do reparo, `INTERRUPTED` | `ANALYSIS_FAILED` (`failStage: brain` ou `planning`) |
| `ANALYSIS_FAILED` | `POST /iterate/:id/retry` | `ANALYZING` (se o campeão não está `READY`) ou `PLANNING`. O que já ficou pronto é reaproveitado (regra do campeão). |
| `PLAN_READY` | `POST /iterate/:id/start` | `LAUNCHED` (final; cria criativos e renders) |

Depois de `LAUNCHED` o progresso é **derivado** das peças (como na feature 2). O web recebe `phase`: `analyze` (ANALYZING, PLANNING, PLAN_READY, ANALYSIS_FAILED) · `generate` (LAUNCHED com peça em `queued`/`rendering`) · `download` (LAUNCHED com todas as peças em `ready`/`failed`/`left_out`). Sem replan, sem editar item: o plano é da IA (decisão 12/10).

### 3.2 Peça (derivado; nunca salvo como coluna)
| status | regra (na ordem) |
|---|---|
| `planned` | lote ainda não `LAUNCHED` |
| `left_out` | `item.leftOutAt != null` |
| `ready` | criativo `APPROVED` (3 formatos `READY`) |
| `failed` | criativo `RENDER_FAILED` |
| `rendering` | algum render da peça `RENDERING` |
| `queued` | resto |
`previewReady = true` assim que o render 9:16 está `READY` (o preview libera antes dos outros formatos).

### 3.3 Criativo da peça (transições novas no `CreativeStateMachine`)
| evento novo | de | para | quando |
|---|---|---|---|
| `AUTO_PIECE_START` | (novo) | `RENDERING` | `POST /iterate/:id/start`, na mesma transação que cria o criativo e os 3 `Render` `QUEUED` |
| `RENDER_FINISHED` (existente) | `RENDERING` | `RENDER_READY` / `RENDER_FAILED` | peça AUTO: `RENDER_READY` só com os 3 formatos `READY`; qualquer formato `FAILED` (depois do retry interno da fila) = `RENDER_FAILED` |
| `AUTO_APPROVE` | `RENDER_READY` | `APPROVED` | **na mesma transação** do `RENDER_READY`: `approvedById` = quem clicou Gerar, grava `adName` (§8). É o "vai sozinha pra Library". |
| `RENDER` (existente) | `RENDER_FAILED` | `RENDERING` | Retry da peça: re-enfileira só os formatos `FAILED` |
Travas: criativo `AUTO_EDIT` não aceita `generate`, `scripts/*`, `engine`, `edit`, `editor`, `changes` (`409 INVALID_STATE` `reason: 'variation_locked'`). "Edit in video" do preview **fica fora da v1**: a decisão de 13/10 diz que o único ajuste depois de gerar é "In zip" (§12, conflito 3).

## 4. Tipos compartilhados (vão pra `contratos/src/iteracao.ts` no A0)
```ts
type AutoVariationType = 'CUT'|'COLD_OPEN'|'HOOK_TEXT'|'ENDCARD'|'SPLIT_LP'|'STORY'|'REVIEW'|'NATIVE_SEARCH'|'STATIC';
type VariationAxis = 'ITERATION'|'DIVERSITY';
type IterateStatus = 'ANALYZING'|'PLANNING'|'PLAN_READY'|'ANALYSIS_FAILED'|'LAUNCHED';
type IteratePhase = 'analyze'|'generate'|'download';
type PieceStatus = 'planned'|'queued'|'rendering'|'ready'|'failed'|'left_out';
type BlockFn = 'hook'|'problem'|'mechanism'|'proof'|'cta'|'other';
type BrainField = 'what'|'audience'|'pains'|'promise'|'proof'|'offerAndPrice'|'cta'|'notes'|'page';
type FormatCode = '9x16'|'4x5'|'1x1';

interface IterateConfig {                        // GET /iterate/config
  maxBytes: number; minSec: number; maxSec: number; mimeTypes: string[];
  analysisUsdPerSec: number; analysisTypicalUsd: number;   // linha "custa cerca de US$ X" antes de subir (vídeo de 30 s)
  types: AutoVariationType[];                    // tipos no build (v1: os 9)
  metaConnected: false;                          // sempre false na v1
  offers: { id: string; name: string; language: string }[];  // ativas; >1 = o web pede a oferta (D3)
  defaultOfferId: string|null;                   // única oferta, ou a última usada num lote AUTO
  recentWinners: LibraryItem[];                  // até 3 (isWinner, só vídeo): "Or pick from your Library"
}

interface WhyLine {
  key: 'hook'|'proof'|'cta';
  text: string;                                  // idioma da interface, ≤ 120
  refSource: 'brain'|'video';
  brainField: BrainField|null;                   // refSource brain: o web monta "Brain › Audience"
  ref: string;                                   // ≤ 60 ("tried and gave up"); vídeo: "From the video"
}
interface AutoInsight {
  blocks: { index: number; label: string; fn: BlockFn|null; startSec: number; endSec: number; kept: boolean }[];
  why: WhyLine[];                                // sempre 3, na ordem hook, proof, cta
  kept: string[];                                // 2-4 pílulas "Kept in every piece"
  flags: { brainEmpty: boolean; shortVideo: boolean; metaConnected: false; pageCaptured: boolean };
  swaps: { from: AutoVariationType; to: AutoVariationType; reason: 'no_page'|'no_proof'|'no_offer'|'short_video'|'no_speech' }[]; // o alerta "no Brain" diz o que trocou
}

interface PieceFile { format: FormatCode; name: string; url: string; mimeType: 'video/mp4'|'image/png'; sizeBytes: number; durationSec: number|null }
interface IteratePiece {
  id: string;                                    // = VariationItem.id
  index: number; type: AutoVariationType; code: string; axis: VariationAxis;
  change: string;                                // "a única coisa que muda"
  status: PieceStatus; previewReady: boolean;
  render: { format: FormatCode; progress: number; frame: number|null; frames: number|null } | null; // o que está renderizando agora
  formatsReady: number;                          // 0..3
  errorCode: string|null; failReason: string|null;
  retryHint: 'retry'|'use_product_photo'|null;   // use_product_photo só com D4
  inZip: boolean;
  creativeId: string|null;                       // depois do start
  poster: FileRef|null;                          // frame do 9:16 renderizado (antes: null; o web usa o TypeThumb)
  files: PieceFile[];                            // só formatos READY
  folder: '1-stretch'|'2-new-audience';          // chave; o nome da pasta no idioma vem em `zip.folders`
}

interface IterateBatch {                         // GET /iterate/:id (e respostas 202)
  id: string; status: IterateStatus; phase: IteratePhase;
  offer: { id: string; name: string; language: string };
  codeLanguage: 'EN'|'PT';                       // idioma dos códigos (da oferta)
  source: { championId: string; name: string; fromLibrary: boolean; durationSec: number|null;
            width: number|null; height: number|null; ratioLabel: string|null; cuts: number|null;
            thumbnail: FileRef|null; video: FileRef|null };
  analysis: { stage: 'reading'|'brain'|'planning'|null; step: 1|2|3; progress: number; etaSec: number|null;
              checklist: { key: string; status: 'done'|'running'|'pending'|'failed' }[] }; // keys no §5.2
  insight: AutoInsight|null;                     // blocks parciais (fn null) já em PLANNING; completo em PLAN_READY
  error: { code: string; reason: string; detail: string|null; params: Record<string, string|number>;
           stage: 'reading'|'brain'|'planning'; chargedUsd: number; action: 'upload_another'|'try_again' } | null;
  pieces: IteratePiece[];                        // em PLAN_READY já vem com status 'planned'
  summary: { pieces: number; stretch: number; newAudience: number; files: number; ready: number; failed: number; leftOut: number;
             renderEtaSec: number|null; videoCreditsUsd: 0 };
  cost: { analysisEstimateUsd: number; analysisUsd: number; renderUsd: 0; totalUsd: number };
  zip: { status: 'none'|'building'|'ready'|'failed'; fileName: string|null; url: string|null; sizeBytes: number|null;
         pieces: number; files: number; folders: { stretch: string; newAudience: string } } ;
  downloadedAt: string|null; createdBy: UserRef; createdAt: string; launchedAt: string|null;
}
```
Mudanças em tipos existentes: `VariationKind` ganha `'AUTO_EDIT'`; `VariationRef` (CreativeRow/LibraryItem) ganha `code: string|null` e `axis: VariationAxis|null`; `LibraryItem` ganha `media: 'video'|'image'` (o campo `video` carrega o PNG quando `image`) e `formats: { format: FormatCode; file: FileRef }[]`; `WaitingBatchRef.status` aceita `'ANALYSIS_FAILED'|'PIECES_READY'` e ganha `mode: 'MANUAL'|'AUTO'` e `readyCount: number|null`.

## 5. API (mesmas convenções do `api.md` §1)
Módulo Nest novo **`api/src/iteracao/`** (controller, DTOs, service, regras puras). Reaproveita `campeoes` (análise), `variacoes` (tabelas e máquina do lote), `edicao` (fila de render), `biblioteca` (adName, download). Workspace sempre do token (a rota da spec `/clients/:id/...` não se aplica).

### 5.1 Rotas
| método e rota | entrada | saída | erros | quem chama / papel |
|---|---|---|---|---|
| `GET /iterate/config` | — | `IterateConfig` | — | Analyze (empty) · todos menos CLIENT |
| `POST /uploads` · `PUT /uploads/:id/content` · `POST /uploads/:id/complete` | sem mudança (`purpose: 'CHAMPION_VIDEO'`) | sem mudança; o `complete` devolve `analysisEstimateUsd` **já com o plano** (§9) | sem mudança (limites novos do §2) | Analyze (uploading) |
| `POST /iterate` | `{ uploadId?: string; creativeId?: string; offerId?: string }` (exatamente um de `uploadId`/`creativeId`; `offerId` obrigatório só se o workspace tem >1 oferta ativa e a origem é upload; Library usa a oferta do criativo) | `202 IterateBatch` (`ANALYZING` ou `PLANNING`) | 400 `VALIDATION_ERROR`; 404 (upload/criativo/oferta); 409 `UPLOAD_INCOMPLETE`; 409 `INVALID_STATE` (criativo não `APPROVED` ou é imagem: `reason: 'not_a_video'`); 409 `SPEND_CAP_EXCEEDED`; 422 `OFFER_REQUIRED` `{ offers: [{id,name}] }`; 422 `MEDIA_*`; 503 `PROVIDER_UNAVAILABLE`; 429 (limite `expensive`) | fim do upload (automático) e "Use this"/"Vary" · OWNER, ADMIN, MEMBER |
| `GET /iterate/:id` | — | `IterateBatch` | 404 (inclui lote `MANUAL`) | todas as telas · todos |
| `POST /iterate/:id/retry` | `{}` | `202 IterateBatch` | 404; 409 `INVALID_STATE` (não `ANALYSIS_FAILED`, ou falha foi `MEDIA_INVALID`: `reason: 'upload_another'`); 409 `SPEND_CAP_EXCEEDED` | "Try again" · OWNER, ADMIN, MEMBER |
| `POST /iterate/:id/start` | `{ expectedPieces: number }` (o nº mostrado no botão; diferente = plano mudou) | `202 IterateBatch` (`LAUNCHED`, peças `queued`) | 404; 409 `INVALID_STATE`; 409 `PLAN_CHANGED` `{ pieces }` | "Generate N pieces" · OWNER, ADMIN, MEMBER |
| `POST /iterate/pieces/:pieceId/retry` | `{ useProductPhoto?: boolean }` (só com D4) | `202 IteratePiece` (`queued`; `leftOutAt` limpo) | 404; 409 `INVALID_STATE` (peça não `failed`/`left_out`); 422 `NO_PRODUCT_PHOTO` (D4) | "Retry" · OWNER, ADMIN, MEMBER |
| `POST /iterate/pieces/:pieceId/leave-out` | `{}` | `IteratePiece` (`left_out`, `inZip: false`) | 404; 409 `INVALID_STATE` (só `failed`) | "Leave out" · OWNER, ADMIN, MEMBER |
| `PATCH /iterate/pieces/:pieceId` | `{ inZip: boolean }` | `IteratePiece` | 400; 404; 409 `INVALID_STATE` (só `ready`) | "In zip" e "Leave out of zip" · todos (`@ClientAllowed`) |
| `POST /iterate/:id/zip` | `{}` | `202 { zip }` (`building`) ou `200 { zip }` (`ready`, mesmo `zipKey`) | 404; 409 `INVALID_STATE` `reason: 'nothing_to_zip'` (nenhuma peça `ready` com `inZip`) ou lote não `LAUNCHED` | "Download zip" · todos (`@ClientAllowed`) |
| `GET /creatives/:id/download` | `?format=9x16\|4x5\|1x1` (novo, opcional; padrão 9x16) | `CreativeDownload` | sem mudança | Library · todos |
| `GET /library` | aceita `&variationCode=` e `&media=video` | `LibraryItem` com os campos novos | sem mudança | Library, "Pick from your Library" |
| `PUT /offers/:id/product-image` · `DELETE /offers/:id/product-image` (D4) | `{ uploadId }` de um `POST /uploads` com `purpose: 'PRODUCT_IMAGE'` (jpeg/png/webp, ≤ 10 MB) · — | `Offer` com `productImage: FileRef\|null` | 400; 404; 409 `UPLOAD_INCOMPLETE`; 422 `MEDIA_INVALID` `{ reason: 'mime' }` | Brain › Business & offer · OWNER, ADMIN, MEMBER |
| `GET /creatives` (Home) | sem mudança | `meta.waitingBatches` inclui lotes AUTO (§5.4) | — | Home |

Esclarecimentos:
1. **A análise começa sozinha:** o web chama `POST /iterate` assim que o `complete` responde. Não existe "Analisar" separado. O custo mostrado antes vem de `IterateConfig.analysisTypicalUsd` (antes de subir) e de `complete.analysisEstimateUsd` (com a duração real).
2. **Library → "Vary":** procura um `Champion` com `sourceCreativeId = creativeId` não arquivado. `READY` com teardown e editMap = reaproveita (lote nasce em `PLANNING`, só o plano é cobrado). Senão cria um (`rights: OWN`, vídeo = `finalRender` 9:16 do criativo, `name` = nome do criativo). Peça AUTO também pode ser variada (vira campeão).
3. **`start` não tem custo nem estimativa** (render é US$ 0), por isso não usa `expectedCostUsd`; o `expectedPieces` só protege contra plano que mudou entre a tela e o clique.
4. **Ordem da fila:** no `start`, os renders entram na fila nesta ordem: o 9:16 de todas as peças (na ordem do plano), depois todos os 4:5, depois todos os 1:1. Preview e Library ficam úteis cedo. Falha de uma peça não para as outras.
5. **Zip:** job `ZIP_BUILD` monta o zip **sem compressão** (MP4/PNG já são comprimidos) a partir dos arquivos no storage, sobe como `ZIP_ARCHIVE` e devolve URL assinada com `Content-Disposition: attachment; filename="<fileName>"` (mesmo mecanismo do `GET /creatives/:id/download`). `zipKey` igual = reaproveita. Zip apagado do storage depois de 72 h (cron), refeito sob demanda. O 1º `ready` entregue grava `downloadedAt`.
6. **Retry de peça é grátis**; não passa pelo teto de gasto.

### 5.2 Checklist da análise (`analysis.checklist[].key`, chaves i18n)
| etapa da tela | chaves (em ordem) | de onde vem |
|---|---|---|
| 1 `reading` "Reading the video" | `decode`, `transcribe`, `cuts`, `edit_map`, `blocks` | job `CHAMPION_ANALYZE` existente (`reading_video` → decode; `extracting_audio`+`transcribing` → transcribe; `measuring` → cuts; `mapping_edit` → edit_map; `diagnosing` → blocks) |
| 2 `brain` "Checking against the Brain" | `audience`, `offer`, `proof`, `page` | job `AUTO_PLAN`, etapa `checking_brain` (lê oferta/workspace; `page` = captura da LP, §7.5) |
| 3 `planning` "Planning the batch" | `planning` | job `AUTO_PLAN`, etapa `planning` (Claude + validação) |
A spec mostra "frame 412 of 960" durante a leitura; esse dado não existe no pipeline (a análise não percorre frames em sequência). O web mostra a chave da etapa e `progress`. `etaSec` = mediana das últimas 20 análises do workspace (sem histórico: 40 s).

### 5.3 Erros
Novos (somam ao `api.md` §1):
| code | http | quando | `details` |
|---|---|---|---|
| `OFFER_REQUIRED` | 422 | `POST /iterate` por upload sem `offerId` com >1 oferta ativa, ou workspace sem oferta | `{ offers: { id, name }[] }` (vazio = "crie a oferta no Brain") |
| `PLAN_CHANGED` | 409 | `start` com `expectedPieces` diferente do plano | `{ pieces }` |
| `NO_PRODUCT_PHOTO` | 422 | retry com `useProductPhoto` sem foto na oferta (só com D4) | — |
| `INVALID_STATE` (reasons novas) | 409 | `'not_a_video'`, `'upload_another'`, `'nothing_to_zip'`, `'variation_locked'` em criativo AUTO | `{ state, allowed, reason }` |

Assíncronos (no lote em `ANALYSIS_FAILED` ou na peça `failed`), com `failReason` humano e `failDetail` técnico:
| code | onde | `params` | ação |
|---|---|---|---|
| `MEDIA_INVALID` | lote, `reading` | `{ decodedSec, durationSec }` ("para de tocar em 0:11 de 0:32") | `upload_another` |
| `MEDIA_TOO_SHORT` | lote, `reading` (duração real < 4 s, ou nenhum frame utilizável) | `{ durationSec, minSec }` | `upload_another` |
| `PROVIDER_ERROR` / `PROVIDER_TIMEOUT` / `RATE_LIMITED` / `INTERRUPTED` | lote, qualquer etapa | — | `try_again` |
| `PLAN_INVALID` | lote, `planning` (plano não fecha as regras nem depois do reparo, §6.3) | `{ violations: string[] }` | `try_again` |
| `PAGE_FORBIDDEN` / `PAGE_UNREADABLE` | peça SPLIT-LP (só se a captura da análise não serviu no render) | `{ host, status }` | `retry` / `use_product_photo` |
| `RENDER_ERROR` | peça | `{ format, failedFrame }` | `retry` |
| `SOURCE_UNAVAILABLE` | peça (vídeo do campeão sumiu do storage) | — | nenhuma (`contact_support`) |
`error.chargedUsd` = soma real das `cost_entries` do lote e do campeão nesta tentativa. A tela só diz "Nothing was charged" quando é 0 (falha no `decode`); falha depois da transcrição mostra os centavos gastos. É o número verdadeiro, não o da spec.

### 5.4 Home e "Waiting for you"
`waitingOnYou.batches` (função única do `workspaces`, fase2-agencia §3.6) passa a contar também lotes AUTO de campeão não arquivado em: `PLAN_READY` ("Plan ready"), `ANALYSIS_FAILED` ("Analysis failed") e `LAUNCHED` com todas as peças assentadas e `downloadedAt = null` ("N pieces ready", `readyCount`). Criativos `AUTO_EDIT` **não** entram no `counts.needs_you` (a peça falha é cobrada pelo lote, não por criativo, senão uma peça conta duas vezes). Link do item: `/iterate/:id`.

## 6. Regras do plano (o backend garante; a IA segue)
### 6.1 Catálogo v1: código, eixo, quando entra e o que precisa
| tipo | código EN / PT | eixo | entra quando | precisa | máx. no lote |
|---|---|---|---|---|---|
| `CUT` | `CUT-15S`, `CUT-20S` / `CORTE-15S`, `CORTE-20S` | ITERATION | vídeo ≥ 25 s e ≥ 4 blocos; 15 s primeiro, 20 s se gancho+prova+CTA passam de 15 s | blocos do teardown | 2 (um de cada) |
| `COLD_OPEN` | `COLD-OPEN` / `COLD-OPEN` | ITERATION | há prova/reação depois de 0:05 mais forte que o frame de abertura | blocos, frames-chave | 1 |
| `HOOK_TEXT` | `HOOK-TEXT-2`, `-3` / `GANCHO-TEXTO-2`, `-3` (o "1" é o gancho do original) | ITERATION | sempre 1; 2 se o original não tem gancho escrito em 0-3 s (`editMap.layers`) | análise | 2 (D2: 3) |
| `ENDCARD` | `ENDCARD-OFFER`, `-GUARANTEE`, `-PRICE`, `-CTA` / `ENDCARD-OFERTA`, `-GARANTIA`, `-PRECO`, `-CTA` | ITERATION | original sem end card; variante pelo que o Brain tem (oferta, garantia, preço); sem Brain → `-CTA` com o CTA falado | Brain › Offer (ou CTA falado) | 1 |
| `SPLIT_LP` | `LAYOUT-SPLIT-LP` | DIVERSITY | captura da página deu certo na análise (D4: ou há foto do produto) | página (`offer.sourceUrl`, senão `workspace.websiteUrl`) | 1 |
| `STORY` | `LAYOUT-STORY` | DIVERSITY | sempre disponível; entra quando ainda falta visual novo | nada | 1 |
| `REVIEW` | `LAYOUT-REVIEW` | DIVERSITY | `offer.proof` tem um depoimento citável | Brain › Proof | 1 |
| `NATIVE_SEARCH` | `NATIVE-SEARCH` / `NATIVO-BUSCA` | DIVERSITY | o gancho nomeia um problema que se pesquisa | análise | 1 (D2: 2, `-2`) |
| `STATIC` | `STATIC-F1` / `ESTATICO-F1` | DIVERSITY | sempre 1, do momento da prova se houver | frames-chave | 1 (D2: 2, `-F2`) |
O código do catálogo `ENDCARD-60N` da spec carrega dado de uma oferta ("60 noites"); trocado por variantes genéricas (regra: agnóstico de oferta). Idioma do código: `offer.language` começa com `pt` → coluna PT; qualquer outro → EN. Função pura `codeFor(type, variant, n, lang)` no backend; a tabela EN/PT mora só nela.

### 6.2 Regras do lote
1. 8 a 12 peças; ≥ 40 % `DIVERSITY` (arredonda pra cima: 8 → 4, 11 → 5); prioridade dentro da diversidade: layouts e estático, depois NATIVE-SEARCH.
2. Uma variável por peça. Nunca dois tipos na mesma peça.
3. O que está em `kept` não muda em nenhuma peça: os blocos `kept` nunca saem de um CUT; o gancho falado está sempre no CUT; o COLD-OPEN não corta nada, só antecede.
4. Tipo que depende do Brain sem o dado é trocado por um que não depende (STORY, STATIC, HOOK-TEXT) e registrado em `insight.swaps`.
5. **Nada inventado na tela:** número, preço, prazo ou porcentagem num texto de peça (ENDCARD, HOOK-TEXT, STATIC, NATIVE-SEARCH) tem que existir no Brain ou na transcrição; a citação do REVIEW tem que estar literal em `offer.proof` (comparação normalizada: caixa, espaços, pontuação). Violou = a peça sai do plano.
6. Métricas: ignoradas (Meta não conectado; `flags.metaConnected = false`).
7. Sem música na v1 (D1).

### 6.3 Validação e reparo (backend, `api/src/iteracao/regras.ts`, puro e testado)
1. Antes do Claude, o backend calcula `allowed: { type, max, blockedReason }[]` com o contexto (duração, blocos, fala, editMap, Brain, captura da página) e manda pro Claude. O Claude só escolhe dentro disso.
2. Depois, `validatePlan(draft, ctx)` aplica §6.1 e §6.2 e devolve `violations`. Com violação: **1 nova chamada** do `planAutoBatch` com `violations` (a ia corrige). Ainda inválido: reparo determinístico (tira peças que violam; se a diversidade ficar < 40 %, tira ITERATION da última pra primeira). Ficou com menos que o piso (D2) = `ANALYSIS_FAILED` `PLAN_INVALID`.
3. O backend completa o que é dele: `code` (com sufixo de repetição), `axis`, tempos encaixados no silêncio (`snapSpans`, §7.6), caixas de capa do gancho original, foco do reenquadramento, paleta, nome da marca.

## 7. Saídas e parâmetros
### 7.1 O que o Claude devolve (maquina-ia, `ClaudeService.planAutoBatch`, saída estruturada por schema)
```ts
planAutoBatch(i: {
  workspaceId: string; batchId: string; jobId: string;
  uiLocale: 'EN'|'PT_BR';                      // idioma de why/kept/change/rationale
  screenLanguage: string;                      // BCP 47 da FALA do campeão: textos que aparecem no vídeo
  offer: OfferBriefDraft;                      // Brain v0 (fase2-agencia §5)
  workspace: { name: string; industry: string|null; market: string|null };
  page: { captured: boolean; text: string|null } ; // texto visível da LP (≤ 4 mil caracteres), se capturada
  teardown: TeardownSections; transcript: TranscriptWord[];
  media: { durationSec: number; cuts: number; silences: { startSec: number; endSec: number }[]; hasWrittenHook: boolean; hasEndCard: boolean };
  keyframes: { atSec: number; reason: string; url: string }[];   // até 8 (os do teardown), pra escolher o frame do STATIC e o teaser
  allowed: { type: AutoVariationType; max: number }[];
  rules: { min: number; max: number; minDiversityPct: 40 };
  violations?: string[];                       // 2ª chamada (reparo)
}, onStage: (s: 'planning') => void): Promise<AutoPlanDraft & Usage>;

interface AutoPlanDraft {
  blocks: { index: number; fn: BlockFn }[];    // normaliza os blocos do teardown.structure
  why: { hook: WhyDraft; proof: WhyDraft; cta: WhyDraft };
  kept: { label: string; blockIndex: number|null }[];   // 2-4
  items: AutoItemDraft[];                      // 8-12, na ordem em que aparecem no plano
}
interface WhyDraft { text: string; source: 'brain'|'video'; brainField: BrainField|null; ref: string }
interface AutoItemDraft {
  type: AutoVariationType;
  change: string;                              // ≤ 90, uiLocale: "a única coisa que muda"
  rationale: string;                           // ≤ 160, uiLocale: qual linha do porquê ela ataca
  whyKey: 'hook'|'proof'|'cta';
  params: AutoParamsDraft;
}
type AutoParamsDraft =
  | { type: 'CUT'; targetSec: 15|20; blockIndexes: number[] }                    // blocos inteiros, em ordem
  | { type: 'COLD_OPEN'; teaserStartSec: number; teaserEndSec: number }          // 1,5-3,5 s, depois de 0:05
  | { type: 'HOOK_TEXT'; text: string }                                         // ≤ 60, screenLanguage
  | { type: 'ENDCARD'; variant: 'offer'|'guarantee'|'price'|'cta'; headline: string; subline: string|null; ctaText: string } // ≤ 40 / 60 / 24
  | { type: 'SPLIT_LP' } | { type: 'STORY' }
  | { type: 'REVIEW'; quote: string; author: string|null; stars: 1|2|3|4|5|null } // literal do proof; stars só se estiver lá
  | { type: 'NATIVE_SEARCH'; query: string }                                    // ≤ 60, screenLanguage, sem marca
  | { type: 'STATIC'; atSec: number; headline: string };                        // ≤ 50
```
Regras do prompt (ia): agnóstico de oferta, nunca nomeia nicho; descreve a pessoa só de forma genérica; não inventa número; textos de tela no idioma da fala; `why` cita o Brain só quando o campo existe (senão `source: 'video'`). Grava `cost_entry` (`LLM`, `variationBatchId`). Mock: determinístico a partir do teardown, com os gatilhos do §10.

### 7.2 Render (maquina-video): `AutoEditRenderInput`
Entra em `api/src/render/contrato.ts` como terceiro membro de `RenderInput`. Composições novas `AutoEdit` (vídeo) e `AutoEditStill` (PNG, `renderStill` no frame 0) em `video/src`.
```ts
interface AutoEditRenderInput {
  kind: 'auto-edit'; renderId: string; templateId: 'auto-edit';
  output: 'video'|'still';                     // still só no STATIC
  format: 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';   // 1080x1920 | 1080x1350 | 1080x1080, 30 fps
  language: string;                            // dos textos de tela
  source: { videoUrl: string; width: number; height: number; fps: number; durationSec: number; hasAudio: boolean };
  reframe: { mode: 'cover'; focus: { x: number; y: number } }    // corta centrado no rosto (0-1 do quadro)
         | { mode: 'contain_blur' };                             // cabe inteiro, fundo = o próprio vídeo desfocado
  timeline: { startSec: number; endSec: number }[];              // trechos do campeão, em ordem; padrão [[0, dur]]
  joinFadeMs: 40;                                                // rampa de volume em cada emenda (sem clique)
  safeArea: { top: number; bottom: number };                     // px da saída livres da UI do Reels/Stories
  palette: string[];                                             // medida do campeão (fundo do end card etc.)
  brandName: string;                                             // workspace.name (STORY)
  type: AutoVariationType;
  params: AutoEditParams;
}
type AutoEditParams =
  | { type: 'CUT'; targetSec: 15|20 }                                            // o corte já vem no timeline
  | { type: 'COLD_OPEN'; teaserSec: number }                                     // timeline = [teaser, [0, dur]]; corte seco
  | { type: 'HOOK_TEXT'; text: string; endSec: number;                          // endSec = min(3, fim do bloco do gancho)
      box: Rect;                                                                 // px da saída, fora do rosto e da safeArea
      cover: { box: Rect; color: string } | null }                              // tapa o gancho escrito do original (px da saída)
  | { type: 'ENDCARD'; variant: 'offer'|'guarantee'|'price'|'cta'; headline: string; subline: string|null; ctaText: string;
      durationSec: 2; background: string }                                     // anexado no fim; sem áudio; reaproveita EndCard.tsx
  | { type: 'SPLIT_LP'; top: { imageUrl: string; kind: 'page'|'product_photo'; scroll: boolean }; ratio: 0.5 } // vídeo embaixo, cover no rosto
  | { type: 'STORY'; handle: string; timeAgo: string; replyLabel: string; bars: 1|2|3 }   // strings já localizadas
  | { type: 'REVIEW'; quote: string; author: string|null; stars: 1|2|3|4|5|null; ratio: 0.42 } // review em cima, vídeo embaixo
  | { type: 'NATIVE_SEARCH'; query: string; introSec: number; typingCps: 14; placeholder: string } // tela de busca genérica (sem marca) nos 1,5-2,5 s iniciais; áudio original corre por baixo
  | { type: 'STATIC'; atSec: number; headline: string; box: Rect };             // PNG do frame atSec + headline
```
Regras do template: uma coisa muda por tipo (nada de legenda nova, música ou efeito extra); áudio = o do campeão, recortado pelo `timeline` (ENDCARD mudo nos 2 s finais); duração = soma do `timeline` (+2 s no ENDCARD); `nb_frames` conferido como no remix-keep.
**Reenquadramento** (função pura do video, `reframeFor(format, source, editMap)`): `cover` centrado no rosto (`editMap.faceTrack`) quando todas as camadas de texto queimadas do original (`editMap.layers`) cabem na janela de corte; senão `contain_blur`. 9:16 de origem em 9:16 = sem corte. Determinístico, testado com os fixtures do `testes/fixtures/campeoes/`.

### 7.3 Quem monta o input
`buildAutoEditInput(ctx: AutoEditContext, format): AutoEditRenderInput` é **função pura do maquina-video** (`api/src/render/auto-edit.ts`, como o `remix-real.ts`). O backend (`edicao`, dono da fila e da tabela `renders`) monta o `ctx` com dados planos (URLs assinadas, item.payload, teardown, editMap, medidas, Brain) e chama a função ao tirar o render da fila. `RenderService.render` aceita `kind 'auto-edit'`; `output 'still'` devolve `outputPath` PNG (o `RenderResult` ganha `mimeType`).

### 7.4 Payload salvo no item (`VariationItem.payload.params`)
É o `AutoParamsDraft` **depois** do backend: tempos já encaixados, `code`, caixas calculadas e `source` do SPLIT-LP. Reprodutível: o `Render.input` guarda o `AutoEditRenderInput` completo de cada formato.

### 7.5 Captura da página (maquina-video, `api/src/medicao/`)
`PageCaptureService.capture({ workspaceId, url }): { fileId, widthPx, heightPx, text } | { error: 'PAGE_FORBIDDEN'|'PAGE_UNREADABLE'|'PAGE_TIMEOUT', status: number|null }`. Chromium headless que já vai na imagem pro Remotion (`REMOTION_BROWSER_EXECUTABLE`), via `puppeteer-core` (dependência nova, aprovada aqui): viewport 1080 px, até 3 telas de altura, 15 s de teto, cookies/banners não tratados. Roda na etapa `brain` da análise. Falhou = SPLIT-LP sai do plano (`swaps: no_page`) e a análise segue. Custo US$ 0.

### 7.6 Funções puras de mídia (maquina-video, `medicao`)
`snapSpans(spans, words, silences)`: move cada borda pro meio do silêncio entre palavras mais próximo (nunca no meio de palavra), usado em CUT e COLD-OPEN. `hasWrittenHook(editMap, 3)` e `hasEndCard(editMap, teardown)` alimentam o `allowed`.

## 8. Nomes de arquivo e zip
- **adName da peça AUTO** (sem formato nem extensão): `CLIENTE_MMDD_CODIGO` → `MC_1013_CUT-15S`. `MMDD` = data **UTC do `launchedAt` do lote** (todas as peças de um zip com a mesma data, mesmo virando a meia-noite). Congelado no `AUTO_APPROVE`. Colisão no workspace (outro lote no mesmo dia com o mesmo código) → sufixo `_2`, `_3` no fim do adName (regra D6 de 12/10): `MC_1013_CUT-15S_2`.
- **Arquivo:** `<adName>_<FMT>.<ext>` → `MC_1013_CUT-15S_9x16.mp4`, `MC_1013_LAYOUT-SPLIT-LP_4x5.mp4`, `MC_1013_STATIC-F1_1x1.png`. A função `adFileName` da fase 2 ganha o ramo AUTO; o resto não muda (`CLIENTE_CAMINHO_MMDD_ROTEIRO_ROSTO_FORMATO` segue pros outros criativos).
- **Zip:** `<CLIENTE>_<MMDD>_<SLUG>_variations.zip` (PT: `_variacoes.zip`), `SLUG` = nome do campeão em ASCII maiúsculo com hífen, ≤ 24 caracteres.
  - `1-stretch-its-life/` (PT `1-esticar-a-vida/`): peças `ITERATION`. `README.txt`: "conjunto de teste do mesmo conceito, separado do conjunto do campeão (que segue rodando); a que ganhar migra pro conjunto principal" + lista `arquivo → o que mudou`.
  - `2-new-audience/` (PT `2-publico-novo/`): peças `DIVERSITY`. `README.txt`: "conjunto novo, todas as peças juntas" + lista.
  - Os 3 formatos de cada peça na mesma pasta. Só peças `ready` com `inZip`. Pasta vazia não entra.
- Idiomas: **código** no idioma da oferta (decisão 13/10); **nomes de pasta e README** no idioma da interface do workspace (são instrução pro operador). `zip.folders` traz os nomes prontos.

## 9. Custos
| item | custo | quem grava |
|---|---|---|
| Transcrição (WaveSpeed, por segundo) | preço por segundo do catálogo × duração | ia (`TRANSCRIBE`, `championId`) |
| Teardown + mapa da edição (Claude com frames) | o que já é cobrado hoje na análise do campeão | ia (`LLM`, `championId`) |
| Plano (`planAutoBatch`, + 1 reparo se preciso) | tokens reais | ia (`LLM`, `variationBatchId`) |
| Captura da página, render, zip | US$ 0 | — |
| **Vídeo/imagem/voz/lipsync** | **nenhum** (v1 sem crédito de vídeo) | — |
- Estimativa mostrada antes: `CatalogService.estimateAutoAnalysis(durationSec)` (nova; = `estimateAnalysis` de hoje + o plano). `analysisTypicalUsd` = estimativa de 30 s. Campeão reaproveitado da Library = só o plano.
- **Conflito com a spec:** o mockup diz "~US$ 0,06" (marcado como placeholder). Só a transcrição de 30 s já fica nessa ordem pelo preço de hoje (US$ 0,002/s), e a análise atual soma o Claude com frames por cima; o número real vai sair maior. A tela mostra a estimativa do catálogo, não um valor fixo. O valor certo sai da primeira análise de teste do Gusta (as `cost_entries` são reais).
- Teto de gasto: `POST /iterate` e `retry` checam `SPEND_CAP_EXCEEDED` com a estimativa. `IterateBatch.cost.totalUsd` = entradas do lote + do campeão desta análise.

## 10. Tempo real e mock
- **Polling, sem stream novo.** Porquê: é a tela-resumo de um recurso só, o estado está no banco e 1,5 s basta pra barra de frame; mesma linha do `eventos.md` (campeão e lote já são polling). `GET /iterate/:id` a cada 1,5 s enquanto `status ∈ {ANALYZING, PLANNING}`, `phase = generate` ou `zip.status = building`; para nos outros casos. A spec sugeria "SSE por peça"; descartado por isso.
- `renderEtaSec` = soma dos segundos de saída que faltam × velocidade medida (mediana dos últimos 20 renders do mesmo formato na máquina: `finishedAt − startedAt` ÷ `durationSec`). Sem histórico: `null` (a tela esconde o tempo).
- Gatilhos de mock (`INTEGRACOES_MODE=mock` + render fake do `edicao`), nas `notes` da oferta: `[mock:auto-fail:reading]` / `[mock:auto-fail:planning]` / `[mock:auto-plan-invalid]` (as duas chamadas violam → `PLAN_INVALID`) / `[mock:page-403]` (captura falha → SPLIT-LP trocado) / `[mock:render-fail:<TYPE>]` (a 1ª tentativa do 4:5 daquele tipo falha com `RENDER_ERROR`; o retry passa). A medição, a captura (contra um HTML de fixture) e o render real rodam de verdade e de graça quando o QA liga `RENDER_IMPL=remotion` numa API própria (nunca a 3001).

## 11. Divisão do trabalho (código só depois do ok do Gusta)
| # | agente | tarefa | pastas | depende de | verificação |
|---|---|---|---|---|---|
| A0 | arquiteto | schema + migração `20261014000000_variacao_auto` (backup, `db:diff`); `contratos/src/iteracao.ts` + mudanças em `index.ts`; recopiar `render/contrato.ts` (`AutoEditRenderInput`) e `integracoes/contrato.ts` (`planAutoBatch`, `estimateAutoAnalysis`) e `medicao/contrato.ts` (`PageCaptureService`, `snapSpans`); atualizar `api.md`, `eventos.md`, `modelo-de-dados.md`, `.env.example` (limites) | `api/prisma/`, `contratos/src/`, `docs/`, contratos `.ts` | ok do Gusta | `prisma validate`, `tsc` do pacote |
| B1 | backend | módulo `iteracao` (rotas §5, DTOs, `regras.ts` com `allowed`/`validatePlan`/reparo/`codeFor`, máquina do lote AUTO, job `AUTO_PLAN` orquestrando captura → Claude → validação → 1 reparo); campeão a partir da Library | `api/src/iteracao/`, `api/src/variacoes/` (máquina), `api/src/campeoes/` (reuso) | A0 | unit das regras (cada linha do §6.1/6.2, nada inventado, swaps, reparo) + int com mock |
| B2 | backend | peças: criativo AUTO + 3 renders na ordem do §5.1, transições `AUTO_PIECE_START`/`AUTO_APPROVE`, travas, retry/leave-out/inZip, `adFileName` ramo AUTO, download `?format`, Library (`media`, `formats`, filtros), job `ZIP_BUILD` (`archiver` em modo store, dependência nova), `waitingOnYou` com lotes AUTO | `api/src/criativos/`, `api/src/edicao/`, `api/src/biblioteca/`, `api/src/workspaces/`, `api/src/iteracao/zip*` | A0 (B1 só no ponto de integração do `start`) | int: 11 peças → 33 renders na ordem, 1 falha não para as outras, nome/colisão, zip com 2 pastas + README, Home conta o lote 1 vez |
| I1 | ia | `planAutoBatch` (prompt, schema da saída, 2ª chamada com `violations`), `estimateAutoAnalysis`, mock determinístico com os gatilhos | `api/src/integracoes/` | A0 | spec com mock; nenhuma chamada paga |
| V1 | video | composições `AutoEdit` e `AutoEditStill` com os 9 tipos nos 3 formatos; `reframeFor`; `buildAutoEditInput`; `RenderService` com `auto-edit` e PNG; `PageCaptureService` (`puppeteer-core` com o Chromium do Remotion); `snapSpans`, `hasWrittenHook`, `hasEndCard` | `video/`, `api/src/render/`, `api/src/medicao/` | A0 | render real local dos 9 tipos × 3 formatos com os fixtures (grátis), contact sheet pro arquiteto; `nb_frames`; nenhuma palavra cortada nas emendas |
| F1 | frontend | `/iterate/new` e `/iterate/[batchId]` (Analyze → Generate → Download numa rota, FlowBar de 3 passos), seletor de oferta só com >1 oferta (D3), preview com Variation/Original sem "Edit in video", "Vary" na Library, item de imagem na Library, itens novos do "Waiting for you"; tira as telas Pick a winner/Breakdown/Plan/Batch do caminho 1 da navegação (as rotas da API manual continuam); MSW nos tipos novos | `web/` | A0 (tipos); B/I/V ou MSW | `tsc`, desktop e 390 px, EN/PT |
| Q1 | qa | ponta a ponta com mocks: upload → análise sozinha → plano com regras → gerar → falha + retry/leave-out → In zip → zip com nomes e README; no Brain, vídeo curto, Library reaproveitando campeão, `OFFER_REQUIRED`, CLIENT barrado em gerar e liberado em In zip/zip; **medir o tempo real de um lote de 11 peças** com `RENDER_IMPL=remotion` numa API própria | `testes/` | B1, B2, I1, V1, F1 | só o qa declara "funciona" |

**Paralelo:** depois do A0, B1, B2, I1, V1 e F1 rodam juntos; pastas não se cruzam (B1 e B2 dividem `api/src/` por módulo; o único ponto comum é o `start`, que é do B1 e chama um serviço do B2). B1/B2 usam fakes das portas da ia e do video até eles entregarem. Q1 por último. Depois do Q1, o Gusta testa no dev com análise real (custa centavos por vídeo; pedir antes).

## 12. Conflitos encontrados (spec × código × decisões) e como ficou
1. **Música:** a decisão 13/10 item 4 fala em "no máximo 1 música" e a spec tem Brain › Music, mas o corte de 9 tipos (item 6) não inclui MUSIC. Este contrato deixa música fora (D1).
2. **Lote de 8 a 12 com só 9 tipos:** sem Brain ou com vídeo curto, os 9 tipos dão 4 a 7 peças. Precisa de regra (D2).
3. **"Edit in video" no preview** contradiz "o único ajuste depois de gerar é In zip" (13/10). Ficou fora da v1. Além disso, o editor v1 não abre um render `auto-edit`.
4. **Limites do upload:** código 200 MB e 5-120 s; spec 500 MB e 4 s-3 min. Adotada a spec, por env.
5. **Custo da análise:** spec ~US$ 0,06; o real vai ser maior (§9). A tela mostra a estimativa do catálogo.
6. **Nome do arquivo:** a regra D6 (12/10) é `CLIENTE_CAMINHO_MMDD_ROTEIRO_ROSTO_FORMATO`; a spec aprovada em 13/10 é `CLIENTE_MMDD_CODIGO_FORMATO`. Vale a da spec só pras peças AUTO, com a data do lote e o sufixo `_2` da D6.
7. **"Retry with photo"** pressupõe uma foto do produto no Brain que não existe no modelo (D4).
8. **Tempo:** "about 4 min" pra 11 peças. São 33 renders numa fila de 1 (`RENDER_CONCURRENCY=1`) na VPS; o número real sai da medição do Q1 (D5).
9. Menores, resolvidos aqui: `ENDCARD-60N` virou variante genérica; `/clients/:id/brain/music` fere "workspace vem do token"; "SSE por peça" virou polling; "frame X of N" na análise não existe; "Nothing was charged" só quando for verdade.

## 13. Decisões pro Gusta
1. **Música fica fora da v1?** O corte de 9 tipos não inclui MUSIC, mas a decisão do lote fala em "no máximo 1 música". **Recomendo: fora da v1.** Sem Brain › Music, sem linha "No music variation" na tela. Entra na v1.1 com 1 tabela de faixas, 3 rotas `/brain/music` e o tipo `MUSIC-T1`, sem mexer no resto.
2. **Quando os 9 tipos não fecham 8 peças** (sem Brain ou vídeo curto). **Recomendo:** permitir repetir o tipo mudando o conteúdo (HOOK-TEXT até 3 headlines, STATIC até 2 frames, NATIVE-SEARCH até 2 buscas), cada repetição ainda com uma variável só. Se nem assim chegar a 8, o lote sai menor (mínimo 4) com o aviso "lote menor: o Brain não tem X". Não encher de peça sem sentido.
3. **De que oferta é o vídeo, quando o cliente tem mais de uma?** A oferta define o idioma do código e o Brain usado. **Recomendo:** com 1 oferta é automático; com mais de 1, um seletor pequeno acima do dropzone, que já vem marcado com a última usada.
4. **Foto do produto pro SPLIT-LP.** Muita página bloqueia navegador automático. **Recomendo:** 1 foto opcional na oferta (Brain › Business & offer), usada quando a captura da página falha; é o que faz o "Retry with photo" da spec funcionar. Sem a foto, o SPLIT-LP só entra quando a página foi capturada na análise, e o retry tenta capturar de novo.
5. **Tempo de um lote.** 33 renders numa fila de 1 na VPS levam bem mais que os 4 min do mockup. **Recomendo:** não mexer na máquina agora. Renderizar primeiro o 9:16 de todas as peças, pra preview e Library ficarem prontos rápido, e depois o 4:5 e o 1:1. Mostrar o tempo medido, não um número fixo. Subir a máquina só se a medição do QA ficar ruim.
