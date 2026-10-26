# Variação automática de campeão v1: contrato
Data: 2026-10-13 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 13/10** (as 5 decisões do §13 como recomendadas). Código liberado na ordem do §11. **Revisão 23/10 (§14, decisões do Gusta de 23/10):** lote gera só o 9:16 (4:5 e 1:1 sob demanda) e o STATIC vira imagem criada do zero no GPT Image 2; migrações `20261023000300_auto_formatos_estatico` e `20261023000400_render_error_code` aplicadas. Onde um trecho abaixo diverge do §14, vale o §14.
Base: spec aprovada `design/variacao-auto-v1-2026-10-12.md` (13/10, §10 respondido) + mockup https://claude.ai/artifact/D9F5BwAoxCUKTihuu95Rmv; `design/catalogo-variacoes-criativo-2026-10-12.md`; `decisions/log.md` (12/10 "variação de campeão vira automática"; 13/10 "spec da variação automática aprovada"). Convenções, envelope, erros e auth: [`api.md` §1](api.md). Reaproveita: uploads, campeão + teardown + editMap ([`feature-2-variar-campeao.md`](feature-2-variar-campeao.md)), `VariationBatch`/`VariationItem`, fila de render, `adName` e download ([`fase2-agencia.md` §3.5 e §6](fase2-agencia.md)), Library.

## 0. Resumo em 5 linhas
1. O usuário sobe um vídeo (ou escolhe da Library) e a API cria **um lote `AUTO`**: roda a análise que já existe (transcrição, medição, mapa da edição, teardown) e depois **uma chamada nova do Claude** que devolve o "porquê" (HOOK/PROOF/CTA), o que fica intacto e o plano de 8 a 12 peças.
2. O plano usa só os 9 tipos da v1 (CUT, COLD-OPEN, HOOK-TEXT, ENDCARD, SPLIT-LP, STORY, REVIEW, NATIVE-SEARCH, STATIC). O backend confere as regras (contagem, ≥ 40 % diversidade, uma variável por peça, nada inventado) antes de mostrar.
3. **Gerar** cria 1 `Creative` por peça (variação do campeão, `variationCode` = código) e **só o render 9:16** (rev. 23/10): vídeo no template Remotion `auto-edit`; STATIC = imagem nova no GPT Image 2 (WaveSpeed). 4:5 e 1:1 saem **sob demanda** (`POST /iterate/pieces/:pieceId/formats`). Peça com o 9:16 pronto é aprovada sozinha e entra na Library.
4. O único ajuste depois de gerar é **"In zip"**. O zip sai com 2 pastas (esticar a vida / público novo), README em cada uma e nomes `CLIENTE_MMDD_CODIGO_FORMATO`.
5. Status por **polling** de `GET /iterate/:id` (1,5 s). Custo: análise (Whisper + Claude) + **imagens do STATIC** (~US$ 0,22 cada, rev. 23/10). Render Remotion = US$ 0.

## 1. Conceitos
| conceito | onde mora | o que é |
|---|---|---|
| **Lote automático** | `VariationBatch` com `mode = AUTO` | 1 por "Iterate". Guarda o insight (porquê, blocos, flags), o plano e o estado. |
| **Campeão** | `Champion` (existente) | o vídeo analisado. Upload → campeão novo. Library → campeão com `sourceCreativeId`, reaproveitado se já foi analisado. |
| **Linha do plano / peça** | `VariationItem` com `kind = AUTO_EDIT` | uma linha do plano antes de gerar; a mesma linha é a peça depois. O `id` da peça é o `id` do item (estável do plano ao download). |
| **Criativo da peça** | `Creative` (`origin VARIATION`, `variationKind AUTO_EDIT`, `variationCode`) | nasce no Gerar; 1 `Render` 9:16 no Gerar + 1 por formato pedido depois (rev. 23/10). É o que a Library mostra. |
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
| `ready` | criativo `APPROVED` (rev. 23/10: o 9:16 `READY`; 4:5/1:1 não contam) |
| `failed` | criativo `RENDER_FAILED` |
| `rendering` | algum render da peça `RENDERING` |
| `queued` | resto |
`previewReady = true` assim que o render 9:16 está `READY`. Estado de cada formato em `formats[]` (§14.2).

### 3.3 Criativo da peça (transições novas no `CreativeStateMachine`)
| evento novo | de | para | quando |
|---|---|---|---|
| `AUTO_PIECE_START` | (novo) | `RENDERING` | `POST /iterate/:id/start`, na mesma transação que cria o criativo e o `Render` 9:16 `QUEUED` (rev. 23/10) |
| `RENDER_FINISHED` (existente) | `RENDERING` | `RENDER_READY` / `RENDER_FAILED` | peça AUTO (rev. 23/10): `RENDER_READY` com o 9:16 `READY`; 9:16 `FAILED` = `RENDER_FAILED`. Formato sob demanda **não** mexe no estado do criativo (§14.2) |
| `AUTO_APPROVE` | `RENDER_READY` | `APPROVED` | **na mesma transação** do `RENDER_READY`: `approvedById` = quem clicou Gerar, grava `adName` (§8). É o "vai sozinha pra Library". |
| `RENDER` (existente) | `RENDER_FAILED` | `RENDERING` | Retry da peça: re-enfileira o 9:16 (rev. 23/10; formato sob demanda falho se refaz pela rota de formatos) |
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
3. ~~`start` não tem custo~~ **rev. 23/10:** o `start` custa as imagens do STATIC: recebe `expectedCostUsd` (= `cost.generateEstimateUsd`), checa `ESTIMATE_CHANGED` e o teto (§14.4). O `expectedPieces` continua protegendo contra plano que mudou.
4. **Ordem da fila (rev. 23/10):** no `start` só entra o 9:16 de cada peça de vídeo, na ordem do plano (o STATIC vai direto pra WaveSpeed, fora da fila). Formato pedido depois entra **na frente** dos renders do lote (`priority`, §14.2). Falha de uma peça não para as outras.
5. **Zip:** job `ZIP_BUILD` monta o zip **sem compressão** (MP4/PNG já são comprimidos) a partir dos arquivos no storage, sobe como `ZIP_ARCHIVE` e devolve URL assinada com `Content-Disposition: attachment; filename="<fileName>"` (mesmo mecanismo do `GET /creatives/:id/download`). `zipKey` igual = reaproveita. Zip apagado do storage depois de 72 h (cron), refeito sob demanda. O 1º `ready` entregue grava `downloadedAt`.
6. **Retry de peça de vídeo é grátis**; não passa pelo teto. Rev. 23/10: retry de STATIC e formato de STATIC custam 1 imagem e checam o teto (§14.4).

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
**Revisão 25/10 noite (aprovada pelo Gusta, `headline-e-legenda-v1.md`):** entra `HEADLINE` (ITERATION; código `HEADLINE-<n>` em EN e PT; 3 no campeão com headline, 2 sem), com a regra de 40 % mantida e o reparo tirando `CUT` antes de `HEADLINE`. As peças de vídeo ganham legenda palavra a palavra quando o campeão não tem legenda queimada (`captionsAuto`). Catálogo final dos lotes novos: HEADLINE 3/2, CUT 2, REVIEW 1, NATIVE_SEARCH 2, STATIC 2, FRAME 8.

**Revisão 25/10 (decisão do Gusta depois do teste live das molduras; vale por cima da tabela e da §6.2):**
- **Catálogo dos lotes novos:** `CUT` (ITERATION, até 2), `REVIEW` (1), `NATIVE_SEARCH` (até 2), `STATIC` (até 2) e **`FRAME` (até 8, todas de templates diferentes**, D10 revista; DIVERSITY). Máximo possível = 15, então o lote de 8 a 12 fecha.
- **Saem dos lotes novos:** `COLD_OPEN`, `HOOK_TEXT`, `ENDCARD`, `STORY` (o layout antigo, não confundir com a moldura `story`) e `SPLIT_LP`. Continuam no enum do banco e no código de leitura: lote antigo segue abrindo, com Retry, formatos e zip. O `allowed` do plano nunca mais oferece esses tipos, e o `validatePlan` marca como violação se a IA mandar.
- **Molduras de 2 fontes liberadas (B2):** o `allowedFrames` oferece as 6 (`split_stack`, `split_torn`, `gossip_page`, `gossip_white`, `gossip_pink`, `call_dialog`), com a 2ª fonte na ordem Pexels → imagem gerada → trecho do campeão (`estatico-montado-e-molduras-v1.md` §B3.1 item 8). Ficam fora só no campeão sem rosto (caso 3, `no_face`, §B3.2).
- **Conferência das regras (ajuste mínimo):**
  1. **40 % de diversidade:** continua igual e passa sempre, porque o único tipo ITERATION que sobrou é o `CUT` (≤ 2): com 8 peças a diversidade é ≥ 75 %. O efeito colateral é que a pasta "esticar a vida" fica com no máximo 2 peças por lote. Não mexo na regra, porque ela só ficou folgada.
  2. **8-12 peças:** fecha mesmo no pior caso. Campeão curto (sem `CUT`) e sem depoimento (sem `REVIEW`) = `NATIVE_SEARCH` 2 + `STATIC` 2 + `FRAME` até 8 = 12. No caso 3 (`no_face`) restam 10 templates de 1 fonte sem rosto, alguns condicionados ao Brain (`ranking`, `call`, `direct_offer`), e o piso de 8 continua alcançável. O piso de 4 com aviso (D2) fica como está.
  3. **Troca do §6.2.4** (tipo sem o dado do Brain): passa a trocar por `FRAME` (outra moldura permitida) ou `STATIC`, nunca por `STORY`/`HOOK_TEXT`. Prioridade dentro da diversidade: `FRAME` e `STATIC`, depois `REVIEW` e `NATIVE_SEARCH`.
  4. **Custo e teto (§14.4):** `cost.generateEstimateUsd` passa a ser = nº de `STATIC` × `staticImageUsd` **+ nº de `FRAME` de 2 fontes × `BROLL_ESTIMATED_USD` (US$ 0,016, seleção por visão)**. A imagem de reserva (~US$ 0,22) não entra na estimativa, porque só acontece sem clipe bom. Ela passa pelo `assertWithinCap` na hora: se o teto bloquear, cai direto pro trecho do campeão, sem falhar a peça. Pior caso por lote: 2 × 2 imagens do STATIC + 6 reservas ≈ US$ 2,2. Quando o render for pro Lambda, ~US$ 0,01 por peça 9:16 (`render-lambda-v1.md` §10) também conta no custo do lote.

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
| `STATIC` | `STATIC-F1` / `ESTATICO-F1` | DIVERSITY | sempre 1 (rev. 23/10: imagem nova no GPT Image 2 a partir do Brain; o campeão é referência, §14.3) | Brain + frames-chave como referência | 1 (D2: 2, `-F2`) |
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
  | { type: 'STATIC'; atSec: number; headline: string };                        // ≤ 50 — rev. 23/10: vira AutoStaticDraft (§14.3)
```
Regras do prompt (ia): agnóstico de oferta, nunca nomeia nicho; descreve a pessoa só de forma genérica; não inventa número; textos de tela no idioma da fala; `why` cita o Brain só quando o campo existe (senão `source: 'video'`). Grava `cost_entry` (`LLM`, `variationBatchId`). Mock: determinístico a partir do teardown, com os gatilhos do §10.

### 7.2 Render (maquina-video): `AutoEditRenderInput`
Entra em `api/src/render/contrato.ts` como terceiro membro de `RenderInput`. Composições novas `AutoEdit` (vídeo) e `AutoEditStill` (PNG, `renderStill` no frame 0) em `video/src`. **Rev. 23/10: o STATIC sai do Remotion** (`AutoEditStill`, `output: 'still'` e o membro `STATIC` de `AutoEditParams` aposentados, §14.6).
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
  - Os formatos **prontos** de cada peça na mesma pasta (rev. 23/10: o 9:16 sempre; 4:5/1:1 só se foram pedidos e estão `ready`; o zip não espera formato na fila). Só peças `ready` com `inZip`. Pasta vazia não entra.
- Idiomas: **código** no idioma da oferta (decisão 13/10); **nomes de pasta e README** no idioma da interface do workspace (são instrução pro operador). `zip.folders` traz os nomes prontos.

## 9. Custos
| item | custo | quem grava |
|---|---|---|
| Transcrição (WaveSpeed, por segundo) | preço por segundo do catálogo × duração | ia (`TRANSCRIBE`, `championId`) |
| Teardown + mapa da edição (Claude com frames) | o que já é cobrado hoje na análise do campeão | ia (`LLM`, `championId`) |
| Plano (`planAutoBatch`, + 1 reparo se preciso) | tokens reais | ia (`LLM`, `variationBatchId`) |
| Captura da página, render Remotion, zip | US$ 0 | — |
| **Imagem do STATIC (rev. 23/10)** | GPT Image 2 high 1k, ~US$ 0,22 por imagem (9:16 no Gerar; 4:5/1:1 sob demanda; retry) | ia (`IMAGE`, `creativeId`, `variationBatchId`, `providerTaskId`) |
| **Vídeo/voz/lipsync** | **nenhum** (v1 sem crédito de vídeo) | — |
- Estimativa mostrada antes: `CatalogService.estimateAutoAnalysis(durationSec)` (nova; = `estimateAnalysis` de hoje + o plano). `analysisTypicalUsd` = estimativa de 30 s. Campeão reaproveitado da Library = só o plano.
- **Conflito com a spec:** o mockup diz "~US$ 0,06" (marcado como placeholder). Só a transcrição de 30 s já fica nessa ordem pelo preço de hoje (US$ 0,002/s), e a análise atual soma o Claude com frames por cima; o número real vai sair maior. A tela mostra a estimativa do catálogo, não um valor fixo. O valor certo sai da primeira análise de teste do Gusta (as `cost_entries` são reais).
- Teto de gasto: `POST /iterate` e `retry` checam `SPEND_CAP_EXCEEDED` com a estimativa. Rev. 23/10: `start`, retry de STATIC e formato de STATIC também (§14.4). `IterateBatch.cost.totalUsd` = análise + imagens (§14.4).

## 10. Tempo real e mock
- **Polling, sem stream novo.** Porquê: é a tela-resumo de um recurso só, o estado está no banco e 1,5 s basta pra barra de frame; mesma linha do `eventos.md` (campeão e lote já são polling). `GET /iterate/:id` a cada 1,5 s enquanto `status ∈ {ANALYZING, PLANNING}`, `phase = generate` ou `zip.status = building`; para nos outros casos. A spec sugeria "SSE por peça"; descartado por isso.
- `renderEtaSec` = soma dos segundos de saída que faltam × velocidade medida (mediana dos últimos 20 renders do mesmo formato na máquina: `finishedAt − startedAt` ÷ `durationSec`). Sem histórico: `null` (a tela esconde o tempo).
- Gatilhos de mock (`INTEGRACOES_MODE=mock` + render fake do `edicao`), nas `notes` da oferta: `[mock:auto-fail:reading]` / `[mock:auto-fail:planning]` / `[mock:auto-plan-invalid]` (as duas chamadas violam → `PLAN_INVALID`) / `[mock:page-403]` (captura falha → SPLIT-LP trocado) / `[mock:render-fail:<TYPE>]` (rev. 23/10: a 1ª tentativa do **9:16** daquele tipo falha com `RENDER_ERROR`; o retry passa) + gatilhos novos do §14.7. A medição, a captura (contra um HTML de fixture) e o render real rodam de verdade e de graça quando o QA liga `RENDER_IMPL=remotion` numa API própria (nunca a 3001).

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

## 14. Revisão 23/10: só 9:16 no lote, formatos sob demanda e STATIC no GPT Image 2
Data: 2026-10-23 · Dono: maquina-arquiteto · Status: **decisões do Gusta de 23/10** (`decisions/log.md`, 23/10: "o lote gera só o 9:16 … o STATIC vira criativo em imagem criado do zero no GPT Image 2"). Por quê: o lote real de 23/10 teve 25 renders em fila única (~45 min) e "as variações de imagem estática não devem ser um print do vídeo". Este § vale sobre qualquer trecho anterior que diga outra coisa.

### 14.1 Modelo de dados (aplicado em `maquina` e `maquina_test`; backups `.infra/backups/maquina-2026-10-23-2017.sql.gz` e `-2023.sql.gz`)
Migrações aditivas `20261023000300_auto_formatos_estatico` e `20261023000400_render_error_code`:
```prisma
enum ProviderTaskKind { … STATIC_IMAGE }          // imagem do STATIC (GPT Image 2 na WaveSpeed)
enum RenderEngine { REMOTION IMAGE_GEN }          // novo: quem produz o arquivo do render
model Render {
  engine    RenderEngine @default(REMOTION)       // IMAGE_GEN = STATIC; a fila do Remotion só tira REMOTION
  priority  Int          @default(0)              // fila = priority DESC, created_at ASC; 0 = lote, 10 = sob demanda
  errorCode String?      @map("error_code")       // código do formato FAILED (vira PieceFormat.errorCode)
  providerTasks ProviderTask[]
  @@index([status, engine, priority, createdAt])
}
model ProviderTask {
  renderId String? @map("render_id")              // STATIC_IMAGE → o render (formato) que ela preenche; ≤ 2 tasks por render
  render   Render? @relation(onDelete: SetNull)
  @@index([renderId])
}
```
**Por que o STATIC continua sendo um `Render`:** o estado por formato fica igual pra vídeo e imagem (o render vigente do formato), e zip, Library, `files[]`, download e `latestByFormat` não ganham ramo novo. O que muda é só quem produz o arquivo (`engine`). **Por que `render_id` na task e não `creative_id`/`variation_item_id`:** a task preenche um formato específico; render → criativo → item já existe. O `CostEntry` continua com `creativeId` + `variationBatchId` + `providerTaskId`.

### 14.2 Formatos sob demanda
**No Gerar** (`start`, mesma transação de hoje): 1 criativo por peça e **1 render 9:16**. Peça de vídeo: `engine REMOTION`, `priority 0`, `createdAt = launchedAt + index` (ordem do plano). STATIC: `engine IMAGE_GEN`, submetido logo depois do commit (§14.3), fora da fila do Remotion.

**Peça:** `ready` = criativo `APPROVED` = 9:16 `READY` (`pieceOutcome` olha só o 9:16; `AUTO_FORMATS` do lote = `['VERTICAL_9_16']`, e `ALL_FORMATS` = os 3 pra vista/zip). `failed` = 9:16 `FAILED`. Lote antigo com 3 renders segue funcionando: o 4:5/1:1 que ainda estiver na fila vira, na prática, formato sob demanda.

**Rota nova:**
| método e rota | entrada | saída | erros | quem chama / papel |
|---|---|---|---|---|
| `POST /iterate/pieces/:pieceId/formats` | `RequestPieceFormatBody { format: '4x5' \| '1x1' }` | `202 IteratePiece` (enfileirou) · `200 IteratePiece` (já estava `queued`/`rendering`/`ready`: nada muda) | 400 `VALIDATION_ERROR` (`9x16` ou outro valor); 404; 409 `INVALID_STATE` (peça não `ready`: `{ state, allowed: ['ready'] }`); 409 `SPEND_CAP_EXCEEDED` (só STATIC); 403 `FORBIDDEN` (CLIENT) | botões 4:5 / 1:1 do preview e do Download · OWNER, ADMIN, MEMBER |

Regras: (1) idempotente por `(peça, formato)` sob o lock do criativo: render vigente `QUEUED`/`RENDERING`/`READY` = `200` sem criar nada; `FAILED` = marca o antigo `stale` e cria outro (é o **retry do formato**, mesma rota); sem render = cria. (2) Vídeo: `Render` `REMOTION`, `priority 10`, `createdAt = now` → a fila pega **na frente** de todo render do lote ainda `QUEUED` (FIFO entre os pedidos); nunca interrompe o render que já está rodando. (3) STATIC: checa o teto com 1 imagem, cria `Render` `IMAGE_GEN` e submete depois do commit (nova geração no aspecto `4:5`/`1:1`, §14.3). (4) O estado do criativo **não muda** (segue `APPROVED`, `adName` congelado); só sai `render.updated` no SSE. (5) Falha de formato sob demanda = só aquele formato `failed` (`Render.errorCode` + `failReason`); a peça segue `ready`, no zip e na Library. (6) CLIENT não pede formato (o STATIC custa dinheiro e o resto do contrato barra CLIENT em tudo que gera); ele baixa o que estiver pronto.

**Vista (`IteratePiece`):** `formats: PieceFormat[]`, sempre os 3 na ordem `9x16, 4x5, 1x1`: `state` = render vigente do formato (`none` sem render; `queued`/`rendering`/`ready`/`failed`), `progress` em `rendering`, `errorCode`/`failReason` em `failed`, `requestUsd` em `none`/`failed` (STATIC = `staticImageUsd`; vídeo = 0). `formatsReady` = nº de `ready`. `render` = o que está rodando agora (9:16 ou sob demanda). `files[]` = os `ready`. `media: 'image'` no STATIC. `retryUsd` = custo do Retry da peça.
**Lote:** `phase` continua pelo 9:16 (`generate` enquanto algum 9:16 está na fila/rodando; formato sob demanda **não** volta a fase). `summary.files` = Σ formatos `queued`/`rendering`/`ready` das peças não `left_out` (antes do start: nº de peças). `renderEtaSec` = renders pendentes do lote, 9:16 e sob demanda: Remotion pela velocidade medida (§10); `IMAGE_GEN` conta `STATIC_IMAGE_MODEL.etaSec` (60 s) fixos.
**Fila (`edicao`):** claim `status QUEUED, engine REMOTION, creative não arquivado`, ordem `priority DESC, createdAt ASC`. Boot: `RENDERING` órfão `REMOTION` → `QUEUED` (como hoje); `IMAGE_GEN` segue o §14.3.
**Zip:** leva os formatos `ready` de cada peça `ready` com `inZip` (o `zipKey` muda quando um formato novo fica pronto, então o zip é refeito sozinho no próximo clique). Não espera formato na fila. README sem mudança.
**Download/Library:** `GET /creatives/:id/download?format=` de formato não `READY` = `409 INVALID_STATE` `reason: 'format_not_ready'` (antes vinha sem reason). `LibraryItem.formats` = só os prontos (sem mudança).
**Polling (eventos.md):** o web segue fazendo polling de `GET /iterate/:id` a 1,5 s também enquanto **qualquer** `formats[].state` estiver `queued`/`rendering`.

### 14.3 STATIC criado do zero (GPT Image 2 na WaveSpeed)
**Plano (`planAutoBatch`, ia).** Entrada sem mudança de forma; muda o papel dos `keyframes`: são **referência** (pessoa genérica, cenário, paleta, momento da prova), nunca o frame da peça. A imagem nasce do Brain (promessa, dor, prova, oferta) e ataca a linha do porquê do item (`whyKey`, normalmente `proof` ou `hook`). Saída do STATIC (`AutoStaticDraft`, `api/src/integracoes/contrato.ts`):
```ts
{ type: 'STATIC';
  headline: string;            // ≤ 50, idioma da tela, "nada inventado" (§6.2.5); a própria imagem escreve
  refAtSec: number|null;       // frame-chave usado como referência (rastreio); null = nenhum
  visual: {                    // em INGLÊS (vai pro prompt)
    object: string;            // ≤ 220: o sujeito (pessoa só genérica: idade aproximada, jeito, roupa; sem celebridade, sem marca)
    scene: string;             // ≤ 220: onde e o que acontece
    vibe: string;              // ≤ 140: clima e luz nomeada
    style: 'everyday_photo'|'cinematic'|'ad_graphic';
    headlinePlacement: 'top'|'center'|'bottom' } }
```
Regras do prompt (ia): agnóstico de oferta; nada de marca, logo, nome de produto ou app no `visual` (descreve pela aparência); **nenhum texto no `visual`** (o único texto da imagem é a headline); dois STATIC no mesmo lote com conceitos diferentes; `change` (uiLocale) descreve o conceito ("Imagem nova: pessoa conferindo a fatura na cozinha").
**Validação (backend, `regras.ts`, antes de mostrar o plano = antes de gerar):** `headline` não vazia, ≤ 50, sem número inventado (o `screenTexts` já cobre); `visual` presente com os 3 textos não vazios e nos limites (`static_visual_missing`, `text_too_long`); `static_visual_has_text` (aspas `"` `“` `”` no `visual`); `static_visual_has_brand` (`brandTerms` no `visual`); `refAtSec` null ou dentro do vídeo; `duplicateKey` = `STATIC:<headline normalizada>`. Violou = mesma rotina de reparo do §6.3. `FinalParams` do STATIC = `{ type, headline, refAtSec, visual }` (o `atSec` sai no fechamento). **Plano antigo** (item `PLAN_READY` de antes do deploy, sem `visual`): o backend manda `visual = { object: '', scene: '', vibe: '', style: 'ad_graphic', headlinePlacement: 'center' }` e o prompt builder da ia faz um pôster tipográfico só com a headline e a paleta.
**Prompt (ia, função pura `buildStaticImagePrompt(spec, aspect, { safe })` em `api/src/integracoes/wavespeed/prompts-midia.ts`):** blocos da skill `gpt-image-2-prompt` (`object`, `scene`, `vibe`, `photo quality` pelo `style` (recomendação "real/everyday", "cinematic" ou "ads"), `aspect ratio`) + `text on the image, exactly as written, in <screenLanguage>: "<headline>"` na posição pedida, dentro da safe area (topo/base livres ~12 %), "no other text, no watermarks, no logos". `safe: true` tira descrições de corpo/pessoa e mantém cena, clima e headline. Passa pelo `scrubSlop` existente.
**Submissão (ia, `GenerationService.submitStaticImage`, `StaticImagePort`):** `openai/gpt-image-2/text-to-image`, `quality high`, `resolution 1k`, `output_format png`, `aspect_ratio` `9:16`/`4:5`/`1:1` (os 3 existem no schema do modelo, conferido 23/10 com `wavespeed schema`). Webhook como as outras. Grava `provider_tasks` (`kind STATIC_IMAGE`, `render_id`, `input.prompt`). Recusa na submissão (`WsContentRejected`) = task `FAILED` `SAFETY_BLOCK` + `provider.task.finished` (mesmo caminho do eventos.md §3). `cost_entry` `IMAGE` só na task `COMPLETED` (falha não cobra; a ia confere no billing na 1ª sonda). Saída guardada no tamanho nativo do modelo (1k; 9:16 ≈ 864×1536), sem upscale. Catálogo: `STATIC_IMAGE_MODEL = { providerModel, quality: 'high', resolution: '1k', usdPerImage: 0.22, etaSec: 60 }` em `precos.ts` e `estimateStaticImages(count)` (`StaticImageCatalog`).
**Ciclo do render `IMAGE_GEN` (backend, `edicao`, serviço novo `ImagemEstaticaService`):**
1. `dispatch(renderId)` (depois do commit do `start`, do retry da peça e do pedido de formato; e no boot pra `IMAGE_GEN` `QUEUED`): monta `StaticImageSpec` (item `payload.params` + `batch.language`), aspecto pelo `format`, chama `submitStaticImage({ safe: false })`. OK → render `RENDERING` (`stage 'generating'`, `startedAt`, `input = { model, aspectRatio, spec, providerTaskIds }`). Erro síncrono (`PROVIDER_UNAVAILABLE`, `RATE_LIMITED`) → render `FAILED` `PROVIDER_ERROR`.
2. **Fim:** quem ouve o `provider.task.finished` de `STATIC_IMAGE` é o `ImagemEstaticaService` (`@OnEvent`, lê `render_id` da task). O `orquestrador` (`geracao`) **ignora** task com `renderId` (não processa nem marca `handledAt`). Idempotente: task com `handledAt` ou render que não está `RENDERING` = nada.
3. `COMPLETED` → `storage.ingestFromUrl(outputUrls[0], { kind: 'RENDER_IMAGE', validate: 'image' })` (download truncado: 3 tentativas, depois `DOWNLOAD_INVALID`) → render `READY` (`fileId`, `durationSec null`, `finishedAt`). 9:16: `creative.thumbnailFileId` = o mesmo arquivo (pôster) e `settleAuto` (aprova a peça). Sob demanda: só `render.updated`.
4. **Reenvio automático, no máximo 1 por render** (2 tasks): `SAFETY_BLOCK` com `safe: false` → reenvia com `safe: true`; `PROVIDER_ERROR`/`TIMEOUT`/`DOWNLOAD_INVALID` → reenvia igual. Não passa de novo pelo teto (no máximo 1 imagem a mais, e falha não cobra). Falhou de novo → render `FAILED` com `errorCode` (`SAFETY_BLOCK`, `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`, `DOWNLOAD_INVALID`); 9:16 → `failAuto` (código no item, peça `failed`, `retryHint: 'retry'`, `retryUsd = staticImageUsd`); sob demanda → só o formato `failed`. `failReason` humano no backend: `SAFETY_BLOCK` "The image model refused this concept. Retry tries again; Leave out removes it."
5. **Timeouts (ia, reconciliador):** `STATIC_IMAGE` sem webhook é consultada a partir de **2 min** (não 10) e vira `TIMEOUT` com **10 min** (não 30). Com `WAVESPEED_WEBHOOKS=off`, polling de 15 s como hoje.
6. **Boot:** `IMAGE_GEN` `QUEUED` → `dispatch`; `RENDERING` com task `SUBMITTED` → nada (o reconciliador fecha); `RENDERING` com task terminada e sem `handledAt` → processa como no passo 2.
**Retry da peça STATIC:** igual ao de vídeo (marca o 9:16 `FAILED` como `stale`, cria um `IMAGE_GEN` novo, `RENDER_FAILED` → `RENDERING`), mais o teto com 1 imagem.

### 14.4 Custos e teto
- `IterateConfig.staticImageUsd` = `estimateStaticImages(1)`.
- `cost.generateEstimateUsd` (só `PLAN_READY`, senão `null`) = nº de itens STATIC × `staticImageUsd`. O botão "Generate N pieces" mostra esse valor e manda `expectedCostUsd`.
- `start`: estimativa > `expectedCostUsd` × 1,10 → `409 ESTIMATE_CHANGED { estimateUsd }`; `assertWithinCap(estimativa)` → `409 SPEND_CAP_EXCEEDED`. Estimativa 0 (lote sem STATIC) não chama o teto. Retry de STATIC e formato de STATIC: `assertWithinCap(staticImageUsd)` (sem `expectedCostUsd`: o preço fixo vem em `requestUsd`/`retryUsd`).
- `cost.imagesUsd` = Σ `cost_entries` `IMAGE` com `variationBatchId` do lote. `cost.analysisUsd` passa a excluir `IMAGE` (era "tudo do lote + campeão"). `totalUsd = analysisUsd + imagesUsd`. `renderUsd` e `summary.videoCreditsUsd` continuam 0 (Remotion e nenhum crédito de vídeo, o que é verdade).
- Custo por criativo (`creativeCost`, Library) já soma por `creativeId`: a imagem entra sem mudança.

### 14.5 Tipos (escritos 23/10) e transição
- `contratos/src/iteracao.ts`: `PieceFormatState`, `PieceFormat`, `RequestPieceFormatBody`; `IteratePiece.formats`/`media`/`retryUsd`; `IterateBatch.cost.generateEstimateUsd`/`imagesUsd`; `IterateConfig.staticImageUsd`; `StartIterateBody.expectedCostUsd`; erros assíncronos `SAFETY_BLOCK`, `DOWNLOAD_INVALID`; reason `format_not_ready`.
- `api/src/integracoes/contrato.ts`: `StaticVisualDraft`, `AutoStaticDraft`, `StaticImageSpec`, `StaticAspect`, `SubmitStaticImageInput`, `StaticImagePort`, `StaticImageCatalog`; o membro `STATIC` do `AutoParamsDraft` ganhou `refAtSec?`/`visual?`. `portas.ts`: `ProviderTaskKind` + `'STATIC_IMAGE'`. Placeholders do arquiteto só pra fechar `switch` exaustivo: `case 'STATIC_IMAGE'` no `costOf` da WaveSpeed e no `complete` do fake (a R-I troca).
- **TRANSIÇÃO** (mesmo esquema do campanhas-v1): os campos novos acima estão opcionais (`?`) pra o typecheck da raiz seguir verde enquanto cada dono entrega. No fechamento (depois do R-Q), o arquiteto tira os `?`, troca o membro `STATIC` por `AutoStaticDraft` (sai o `atSec`), faz `GenerationService extends StaticImagePort` e `CatalogService extends StaticImageCatalog` se a ia já não tiver feito.

### 14.6 Divisão do trabalho (sem arquivo em comum)
| # | dono | tarefa | arquivos (só estes) | depende de | verificação |
|---|---|---|---|---|---|
| R-B | maquina-backend | fila com `priority`/`engine`; `start` só 9:16 + teto/`ESTIMATE_CHANGED`; `pieceOutcome`/`AUTO_FORMATS`=9:16, `ALL_FORMATS`; rota `POST /iterate/pieces/:pieceId/formats` (DTO, controller, idempotência, prioridade 10, CLIENT 403); `formats[]`/`media`/`retryUsd` na vista; `summary.files`, `renderEtaSec` com `IMAGE_GEN`; `cost.generateEstimateUsd`/`imagesUsd`, `analysisUsd` sem IMAGE; `IterateConfig.staticImageUsd`; zip com formatos prontos; download `format_not_ready`; `ImagemEstaticaService` (dispatch, `@OnEvent`, reenvio, boot); orquestrador ignora task com `renderId`; validação e `FinalParams` do STATIC + plano legado; retry com teto pro STATIC; `mockRenderFail` no 9:16 + `[mock:format-fail:<TYPE>]`; `expectedOutputSec` sem STATIC; comentários do `state-machine.ts:63`; testes que assumem 3 renders (`pecas.spec.ts`, `pecas.int.spec.ts`, `iteracao.int.spec.ts:218`) | `api/src/edicao/`, `api/src/iteracao/`, `api/src/biblioteca/`, `api/src/geracao/orquestrador.service.ts`, `api/src/criativos/state-machine.ts` | contrato (já); usa o fake da ia quando a R-I chegar (até lá, stub local no spec) | unit + int em mock: 11 peças → 11 renders 9:16; pedido 4:5 passa na frente; 200 idempotente; formato falho não derruba a peça; zip com 9:16 + 4:5 pronto; STATIC: reject→safe→ok, reject-all→failed, retry cobra e checa teto; `start` sem `expectedCostUsd` certo = 409 |
| R-I | maquina-ia | prompt + schema do STATIC no `planAutoBatch` (campos do §14.3, regras de marca/texto/pessoa, referência dos keyframes); `buildStaticImagePrompt` (`prompts-midia.ts`, com `safe`); `submitStaticImage` na WaveSpeed (`generation.service.ts`) e no fake (PNG no aspecto, triggers do §14.7); `costOf` real; reconciliador 2 min / 10 min pra `STATIC_IMAGE`; `STATIC_IMAGE_MODEL` + `estimateStaticImages`; `renderId?` no `ProviderTaskFinishedEvent`; liga `extends` no `contrato.ts`; fake-auto-plan com `visual`; 1 sonda real só com ok do Gusta (~US$ 0,66: 1 imagem por aspecto) | `api/src/integracoes/**` | contrato (já) | spec com mock; prompt montado bate com a skill (snapshot); nenhuma chamada paga sem ok |
| R-F | maquina-frontend | preview: abas 9:16 / 4:5 / 1:1 por `formats[]` (`none` → botão "Make 4:5" com `requestUsd` quando > 0; `queued`/`rendering` → progresso; `failed` → motivo + "Try again"; `ready` → toca/baixa); STATIC mostra imagem (`media`); Download: chips por formato em cada peça + "4:5 pra todas"/"1:1 pra todas" (N chamadas da rota, soma do custo no confirm); botão Generate com `generateEstimateUsd` e `expectedCostUsd`, trata `ESTIMATE_CHANGED`/`SPEND_CAP_EXCEEDED`; linha "Images" no custo do lote (`imagesUsd`) e total; polling também com formato na fila; `generate-screen` conta progresso pelo 9:16; CLIENT sem botões de formato; textos EN/PT; MSW (`web/src/mocks/iterate.ts`) com `formats[]`, rota nova e custos | `web/` | contrato (já); MSW | `tsc`, desktop e 390 px, EN/PT |
| R-V | maquina-video | aposentar o STATIC do Remotion: tirar `AutoEditStill`, `AUTO_EDIT_STILL_COMPOSITION_ID`, o ramo STATIC do `AutoEdit.tsx` (l.290-322), `output: 'still'` e o membro `STATIC` de `AutoEditParams` (`render/contrato.ts`), o `case 'STATIC'` do `auto-edit.ts` (l.195-202) e a referência em `video/src/player.ts`. `RenderResult.mimeType` pode ficar. Nada mais muda no `video/` (4:5/1:1 de vídeo já renderizam hoje). | `video/`, `api/src/render/` | contrato (já) | `tsc` do video e da api; render real local de 1 tipo × 3 formatos continua igual |
| R-Q | maquina-qa | casos do §14.8 em mock; medir de novo o tempo do lote de 11 peças com `RENDER_IMPL=remotion` numa API própria (esperado: ~1/3 do anterior) | `testes/` | R-B, R-I, R-F, R-V | só o qa declara "funciona" |
Arquivo compartilhado inevitável: nenhum. `regras.ts` é do backend (validação); as regras do STATIC **no prompt** são da ia. `api/src/integracoes/contrato.ts` e `portas.ts`: a ia mexe (é a pasta dela); o arquiteto só revisa e faz o fechamento do §14.5. Paralelo: R-B ‖ R-I ‖ R-F ‖ R-V; R-Q por último.

### 14.7 Mock (gatilhos novos nas `notes` da oferta)
`[mock:static-reject]` (1ª submissão `SAFETY_BLOCK`; o reenvio `safe` passa) · `[mock:static-reject-all]` (as duas recusam → peça `failed` `SAFETY_BLOCK`) · `[mock:static-timeout]` (task fecha `TIMEOUT` em 3 s no fake; reenvio passa) · `[mock:render-fail:<TYPE>]` agora na 1ª tentativa do 9:16 · `[mock:format-fail:<TYPE>]` (1ª tentativa do 4:5 sob demanda daquele tipo falha `RENDER_ERROR`; o pedido de novo passa). Fake do STATIC: PNG determinístico no tamanho do aspecto, custo 0.

### 14.8 Casos pro QA
1. Lote de 11 peças → 11 renders (só 9:16); peças `ready` assim que o 9:16 fica pronto; zip só com 9:16. 2. Pedir 4:5 de uma peça com o lote ainda renderizando: o 4:5 roda antes dos 9:16 que faltam. 3. Pedir de novo o mesmo formato (na fila, rodando, pronto) = 200 sem render novo. 4. `[mock:format-fail:CUT]`: 4:5 `failed`, peça segue `ready`, zip sem o 4:5; pedir de novo passa. 5. STATIC: `media: 'image'`, PNG no zip `…_STATIC-F1_9x16.png`, pôster = a imagem, custo em `imagesUsd`. 6. `[mock:static-reject]` passa no reenvio (2 tasks no render); `[mock:static-reject-all]` → `failed` `SAFETY_BLOCK`, Retry cobra e checa o teto. 7. `start` com `expectedCostUsd` baixo → `ESTIMATE_CHANGED`; teto estourado → `SPEND_CAP_EXCEEDED` no start, no retry do STATIC e no formato do STATIC (vídeo não). 8. CLIENT: 403 no formato; In zip e zip liberados. 9. Download `?format=4x5` sem 4:5 pronto = 409 `format_not_ready`. 10. Plano: STATIC sem `visual`, com aspas ou com marca no `visual` → violação e reparo. 11. Lote `PLAN_READY` antigo (STATIC sem `visual`) gera pôster tipográfico. 12. Reinício da API com STATIC em `RENDERING`: o reconciliador fecha; `IMAGE_GEN` `QUEUED` é submetido no boot.

### 14.9 Decisões tomadas pelo arquiteto nesta revisão
1. STATIC continua sendo `Render` (engine `IMAGE_GEN`), fora da fila do Remotion; vínculo `provider_tasks.render_id`.
2. Prioridade por coluna `renders.priority` (10 sob demanda, 0 lote), não por truque de `createdAt`.
3. Uma rota só pra pedir **e** refazer formato; idempotente; só peça `ready`.
4. CLIENT não pede formato (403). Muda com 1 decorator se o Gusta quiser liberar só os de vídeo (grátis).
5. Reenvio automático de no máximo 1 por imagem (seguro depois de recusa); não reconta o teto.
6. `start` passa a exigir `expectedCostUsd` (regra "gasto sem estimativa na tela é proibido"); retry/formato de STATIC só checam o teto, com o preço fixo na tela.
7. GPT Image 2 em `high` + `1k` (US$ 0,22, o número do Gusta), sem upscale (9:16 sai ~864×1536). 2k só se o Gusta pedir.
8. `renderUsd`/`videoCreditsUsd` continuam 0 (são verdade); o custo novo entra em `imagesUsd`.
