# Feature 2: Variar campeão (contrato proposto)
Data: 2026-10-06 · Dono: maquina-arquiteto · ⚠️ **§13 (06/10 noite) substitui §5.1, §5.2 e §6.3: manter a edição + take contínuo.** **§13.15 (08/10, proposto): Trocar avatar com motor Kling/Seedance.** Status: **aprovado pelo Gusta (F2-G0, 06/10)**, com as respostas da §10. O diff da §11 já foi aplicado nos contratos v1, no `@maquina/contratos` e no schema (migração `20261006120000_feature2_variar_campeao`, aplicada nos bancos locais `maquina` e `maquina_test`). Briefs por agente na §12.
Decisão de origem: `decisions/log.md` (06/10, "feature 2 entra antes do 10/10"). Método de referência: `.claude/skills/esteira-spy` (Peneira → Isca → Bisturi), `trocar-avatar`, `clonar-edicao`, `_shared/templates/teardown-criativo.md`.
Premissas vigentes: `submitFace` é Higgsfield Soul V2 (US$ 0,006 por imagem 1080p, provider `HIGGSFIELD`); prompts de mídia **v2 são o padrão** (`MEDIA_PROMPTS=v2`).

## 0. Resumo em 5 linhas
1. O usuário escolhe uma oferta, sobe o vídeo campeão (MP4/MOV) e/ou cola o link da Ad Library e marca, se quiser, que o anúncio é dele (só registro, não trava nada).
2. A API extrai o áudio, transcreve com tempo por palavra (Whisper que já usamos), mede cortes/faixas/paleta (método do `clonar-edicao`, em TS) e o Claude escreve o teardown em 12 seções, editável.
3. O usuário pede um **lote** com 1+ tipos de variação e quantas de cada; o Claude planeja os itens (ganchos, elencos, roteiros, layouts); o usuário revisa, escolhe rostos, vê a estimativa e dá o OK.
4. Cada item vira um `Creative` normal (com `championId` + `variationKind`) que entra direto em `SCENES_GENERATING` e segue a máquina de estados v1 até a Biblioteca.
5. **Até 10/10:** upload + teardown + **Trocar avatar** (talking head limpo) + **Novos ganchos**. Link da Ad Library entra com falha explícita (Apify no teto até 19/10). **Copy nova** e **Remontar a edição** (e "manter a edição" no trocar avatar) ficam pra depois.

## 1. Conceitos e regras que o código precisa garantir
| conceito | o que é |
|---|---|
| **Campeão** (`Champion`) | o criativo de referência importado. Pertence a uma oferta do workspace. Pode vir de upload, de link da Ad Library ou dos dois (link = metadados; upload = vídeo garantido). |
| **Teardown** | a dissecação do campeão: transcrição, medições e as 12 seções do diagnóstico. 1 por campeão; reanalisar substitui. |
| **Lote** (`VariationBatch`) | um pedido de variações sobre um campeão. Tem uma fase de plano (revisável) e um OK único que cria os criativos. |
| **Item** (`VariationItem`) | uma variação planejada; vira exatamente 1 `Creative` no OK. |
| **Elenco** (`VariationCasting`) | descrição de "quem aparece" + rostos gerados (4 por rodada) + o rosto escolhido. |

### 1.1 Declaração de dono e PII (decisão do Gusta, 06/10)
- **Nenhum tipo de variação é bloqueado por dono.** O campeão guarda `rights: 'OWN' | 'THIRD_PARTY'` (checkbox, padrão `THIRD_PARTY`, sem verificação) com `rightsDeclaredById`/`rightsDeclaredAt`, só como registro. Nenhuma rota recusa nada por causa dele; não existe erro de direitos.
- **Frames do campeão nunca entram num modelo de geração** (imagem, vídeo, lipsync). Vão só pro Claude (análise) e pra tela. O rosto novo nasce só de texto (Soul V2). Não é trava de dono: é o método (trocar avatar = trocar a pessoa).
- **A descrição da pessoa no teardown é genérica** (gênero, faixa de idade, enquadramento, cenário, figurino). Nunca nome, traço físico marcante, tatuagem, @. O elenco sugerido parte do formato, não da pessoa.
- `voiceSource: CHAMPION_AUDIO` (áudio original no lipsync) fica disponível pra qualquer campeão; a escolha é do usuário.
- Agnóstico de oferta: nenhum prompt, enum ou alavanca fala de nicho. As alavancas são genéricas (curiosidade, dor, prova, contrário, demonstração, objeção, história, avatar, layout).

### 1.2 Uma alavanca por teste (regra da casa, garantida pela forma do lote)
| tipo | o que muda (a alavanca) | o que fica idêntico em todos os itens do tipo |
|---|---|---|
| `SWAP_AVATAR` Trocar avatar | o rosto (um elenco por item) | copy literal; voz (áudio original ou a mesma voz do catálogo, escolha do lote); formato; edição |
| `NEW_HOOKS` Novos ganchos | só a fala/texto dos primeiros ~3 s (até `hook.endSec` do teardown) | corpo e CTA literais; rosto e voz (elenco compartilhado); **os clipes do corpo são gerados uma vez e reaproveitados** (§5.2); edição. O lote ganha 1 item **controle** automático (gancho original com o mesmo rosto/voz), sem contar no N. |
| `COPY_NEW` Copy nova (pós-10/10) | o roteiro inteiro, escrito pra oferta do usuário | estrutura do campeão (nº e função dos blocos, duração ±15%, ritmo em palavras/min); rosto, voz, motor, edição |
| `REMIX_EDIT` Remontar (pós-10/10) | o layout | head e locução **bit-idênticos** (cortes do próprio campeão) |

Configurações de produção (formato, voz, motor, edição) são **do lote**, não do item. O item só carrega a alavanca.

## 2. Limites
| o quê | limite | erro |
|---|---|---|
| tipo do arquivo | `video/mp4` (H.264/H.265) ou `video/quicktime` (MOV) | `422 MEDIA_INVALID` `{ reason: 'mime' }` |
| tamanho | **≤ 200 MB** (`UPLOAD_MAX_BYTES`; o bucket já é ≥ 200 MB) | `422 MEDIA_TOO_LARGE` `{ maxBytes }` no `POST /uploads` |
| duração | **5 a 120 s** (`CHAMPION_MIN_SEC`/`CHAMPION_MAX_SEC`) | `422 MEDIA_TOO_SHORT` / `MEDIA_TOO_LONG` `{ durationSec, minSec\|maxSec }` |
| conteúdo | 1 trilha de vídeo decodificável inteira; lado menor ≥ 240 px | `422 MEDIA_INVALID` `{ reason: 'no_video'\|'undecodable'\|'too_small' }` |
| avisos (não bloqueiam) | sem áudio → `no_audio`; lado menor < 720 px → `low_resolution` (painel reaproveitado sai mole, como no swipe de 360 px) | `warnings[]` na resposta |
| fala | `hasSpeech` = transcrição com ≥ 5 palavras. Sem fala: `SWAP_AVATAR` e `NEW_HOOKS` indisponíveis (`NO_SPEECH`) | `availableKinds[].reason` |
| link | só anúncio único: `facebook.com/ads/library/?id=<dígitos>` (aceita outros parâmetros) | `400 VALIDATION_ERROR` `{ field: 'adLibraryUrl', rule: 'ad_library_single_ad' }` |
| lote | ≤ 10 itens + controle; `NEW_HOOKS` 2-5; `SWAP_AVATAR` 1-4; `COPY_NEW` 1-4; `REMIX_EDIT` 1-4 (um por layout) | `400 VALIDATION_ERROR` |
| ritmo | `POST /champions`, `/analyze`, `/batches`, `/launch`, rostos do elenco = limite `expensive` (20/min por workspace) | `429 RATE_LIMITED` |

## 3. Modelo de dados
Resumo abaixo; **a fonte da verdade é `api/prisma/schema.prisma`** (migração `20261006120000_feature2_variar_campeao`, que também faz backfill de `scenes.pipeline` pelo motor e cria o `CHECK faces_owner_check`). Tudo com `workspace_id`, como no v1. Diferença do resumo pro schema: `Champion.notes` existe; `payload` dos itens tem `blocks` em todos os tipos com fala.

```prisma
// ── enums novos ──
enum ChampionStatus { RESOLVING ANALYZING READY FAILED }
enum ChampionRights { OWN THIRD_PARTY }
enum VariationKind { SWAP_AVATAR NEW_HOOKS COPY_NEW REMIX_EDIT }
enum VariationBatchStatus { PLANNING PLAN_READY PLAN_FAILED LAUNCHED }
enum CreativeOrigin { SCRATCH VARIATION }
enum VoiceSource { CATALOG CHAMPION_AUDIO }
enum ScenePipeline {
  SCENE_VIDEO    // v1: Kling/Seedance com áudio nativo → TRANSCRIBE
  TTS_LIPSYNC    // v1: TTS → LIPSYNC → TRANSCRIBE
  AUDIO_LIPSYNC  // novo: trecho do áudio do campeão → LIPSYNC (words vêm do teardown, sem TRANSCRIBE)
  SOURCE_CUT     // novo (pós-10/10): corte do próprio vídeo do campeão, sem provedor
  REUSE          // novo: copia o clipe de outra cena READY do mesmo lote, sem custo
}
enum UploadStatus { PENDING READY FAILED EXPIRED }

// ── enums existentes: valores novos ──
// JobType      + CHAMPION_RESOLVE CHAMPION_ANALYZE VARIATIONS_PLAN VARIATION_ITEM_REGENERATE
// Provider     + APIFY
// CostKind     + SCRAPE
// FileKind     + CHAMPION_VIDEO CHAMPION_AUDIO CHAMPION_FRAME

model Upload {
  id          String       @id @default(cuid())
  workspaceId String       @map("workspace_id")
  purpose     String       // "CHAMPION_VIDEO" (único na v1)
  status      UploadStatus @default(PENDING)
  filename    String
  mimeType    String       @map("mime_type")
  sizeBytes   Int          @map("size_bytes")     // declarado; conferido no complete
  storageKey  String       @unique @map("storage_key")
  fileId      String?      @unique @map("file_id") // nasce no complete
  errorCode   String?      @map("error_code")
  expiresAt   DateTime     @map("expires_at")      // 30 min pra subir; cron limpa PENDING vencido
  completedAt DateTime?    @map("completed_at")
  createdById String       @map("created_by_id")
  createdAt   DateTime     @default(now()) @map("created_at")
  @@index([workspaceId, status])
  @@map("uploads")
}

model Champion {
  id                 String         @id @default(cuid())
  workspaceId        String         @map("workspace_id")
  offerId            String         @map("offer_id")
  name               String
  status             ChampionStatus
  rights             ChampionRights @default(THIRD_PARTY) // só registro, não trava nada
  rightsDeclaredById String?        @map("rights_declared_by_id")
  rightsDeclaredAt   DateTime?      @map("rights_declared_at")
  adLibraryUrl       String?        @map("ad_library_url")
  adArchiveId        String?        @map("ad_archive_id")
  adMeta             Json?          @map("ad_meta")         // AdLibraryMeta (api.md proposto)
  videoFileId        String?        @map("video_file_id")    // CHAMPION_VIDEO
  audioFileId        String?        @map("audio_file_id")    // CHAMPION_AUDIO (m4a mono 44,1 kHz)
  thumbnailFileId    String?        @map("thumbnail_file_id")
  durationSec        Decimal?       @map("duration_sec") @db.Decimal(8, 3)
  language           String?        // BCP 47 detectado na transcrição
  hasSpeech          Boolean        @default(false) @map("has_speech")
  sourceCreativeId   String?        @map("source_creative_id") // pós-10/10: "Variar" a partir da Biblioteca (rights = OWN)
  errorCode          String?        @map("error_code")
  failReason         String?        @map("fail_reason")
  createdById        String         @map("created_by_id")
  archivedAt         DateTime?      @map("archived_at")
  createdAt          DateTime       @default(now()) @map("created_at")
  updatedAt          DateTime       @updatedAt @map("updated_at")
  // relações: workspace, offer, files (video/audio/thumbnail), teardown Teardown?, batches, creatives, jobs, costEntries, providerTasks
  @@index([workspaceId, archivedAt, updatedAt])
  @@index([offerId])
  @@map("champions")
}

model Teardown {
  id             String    @id @default(cuid())
  workspaceId    String    @map("workspace_id")
  championId     String    @unique @map("champion_id")
  transcript     Json      // { language, text, words: [{ word, startSec, endSec }], wpm, wordsSource }
  measurements   Json      // Measurements (api.md proposto): cortes, faixas, paleta, silêncios, frames-chave (fileIds)
  sections       Json      // TeardownSections: as 12 seções
  editedSections String[]  @default([]) @map("edited_sections")
  model          String?   // modelo do Claude que escreveu
  analyzedAt     DateTime? @map("analyzed_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  @@map("teardowns")
}

model VariationBatch {
  id               String               @id @default(cuid())
  workspaceId      String               @map("workspace_id")
  championId       String               @map("champion_id")
  offerId          String               @map("offer_id")      // = champion.offerId
  status           VariationBatchStatus @default(PLANNING)
  language         String               // idioma das falas: do campeão (SWAP/NEW_HOOKS/REMIX) ou da oferta (COPY_NEW)
  requests         Json                 // [{ kind, count }]
  settings         Json                 // BatchSettings (api.md proposto)
  teardownSnapshot Json?                @map("teardown_snapshot") // cópia do teardown no plano: editar depois não muda o lote
  notes            String?              // instrução livre pro plano
  estimatedCostUsd Decimal?             @map("estimated_cost_usd") @db.Decimal(12, 4) // aceita no launch
  launchedAt       DateTime?            @map("launched_at")
  createdById      String               @map("created_by_id")
  createdAt        DateTime             @default(now()) @map("created_at")
  updatedAt        DateTime             @updatedAt @map("updated_at")
  @@index([championId, createdAt])
  @@map("variation_batches")
}

model VariationCasting {
  id             String   @id @default(cuid())
  workspaceId    String   @map("workspace_id")
  batchId        String   @map("batch_id")
  scope          String   // "SHARED" (NEW_HOOKS/COPY_NEW do lote) | "ITEM" (um por item SWAP_AVATAR)
  description    String
  selectedFaceId String?  @map("selected_face_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  // faces Face[] (Face.castingId)
  @@index([batchId])
  @@map("variation_castings")
}

model VariationItem {
  id         String        @id @default(cuid())
  workspaceId String       @map("workspace_id")
  batchId    String        @map("batch_id")
  kind       VariationKind
  index      Int           // 0..n-1 dentro do tipo; controle = -1
  isControl  Boolean       @default(false) @map("is_control")
  included   Boolean       @default(true)   // o usuário pode tirar do lote antes do OK
  status     ScriptStatus  @default(WRITING) // WRITING | READY | FAILED (reuso do enum)
  lever      String?       // a alavanca em 1 linha ("curiosidade: pergunta sem resposta")
  rationale  String?       // por quê, apontando a causa do "por que vende" que ataca
  payload    Json          // NEW_HOOKS { hook } · SWAP_AVATAR { } · COPY_NEW { blocks } · REMIX_EDIT { layoutTemplateId }
  castingId  String?       @map("casting_id")
  errorCode  String?       @map("error_code")
  failReason String?       @map("fail_reason")
  jobId      String?       @map("job_id")
  createdAt  DateTime      @default(now()) @map("created_at")
  updatedAt  DateTime      @updatedAt @map("updated_at")
  // creative Creative? (Creative.variationItemId)
  @@unique([batchId, kind, index])
  @@map("variation_items")
}

// ── alterações em modelos existentes ──
// Creative      + origin CreativeOrigin @default(SCRATCH)
//               + championId String? · variationBatchId String? · variationItemId String? @unique · variationKind VariationKind?
//               + voiceSource VoiceSource @default(CATALOG)
//               + @@index([championId])
// Face          creativeId vira String? ; + castingId String? ; + @@unique([castingId, batch, position])
//               (CHECK no SQL da migração: exatamente um de creative_id / casting_id preenchido)
// Scene         + pipeline ScenePipeline (backfill: engine SCENES → SCENE_VIDEO, LIPSYNC → TTS_LIPSYNC)
//               + sourceStartSec Decimal? · sourceEndSec Decimal? (trecho do campeão; AUDIO_LIPSYNC e SOURCE_CUT)
//               + reuseOfSceneId String? (REUSE: cena dona do clipe)
// Job           + championId String? · variationBatchId String?
// ProviderTask  + championId String? (TRANSCRIBE do campeão)
// CostEntry     + championId String? · variationBatchId String? + @@index([championId])
```

Por que `Creative.championId` e não `Creative.sourceCreativeId` (o nome reservado em `modelo-de-dados.md`): o campeão quase nunca é um `Creative` nosso (é upload ou anúncio de terceiro). Quando for (Variar a partir da Biblioteca, pós-10/10), isso fica em `Champion.sourceCreativeId`.

### 3.1 Máquina de estados do campeão
| de | evento | para |
|---|---|---|
| (novo) | `POST /champions` só com link | `RESOLVING` (job `CHAMPION_RESOLVE`) |
| (novo) | `POST /champions` com upload (com ou sem link) | `ANALYZING` (job `CHAMPION_ANALYZE`; o link, se houver, só busca metadados no mesmo job, sem bloquear) |
| `RESOLVING` | link resolvido com vídeo e baixado | `ANALYZING` |
| `RESOLVING` | `AD_LIBRARY_UNAVAILABLE` / `AD_NOT_FOUND` / `AD_HAS_NO_VIDEO` / `MEDIA_INVALID` | `FAILED` (`action: upload_video`) |
| `ANALYZING` | teardown pronto | `READY` |
| `ANALYZING` | falha (transcrição, medição, Claude, `INTERRUPTED`) | `FAILED` (`action: analyze_again`; o que já ficou pronto, como transcrição e medições, é reaproveitado na nova tentativa) |
| `FAILED` | `PUT /champions/:id/video` (anexa upload) | `ANALYZING` |
| `FAILED` (campeão da Meta sem vídeo: download falhou) | `IMPORT_AGAIN` = retry do lote (`POST /iterate/:id/retry`) ou novo `POST /iterate { metaAdId }` do mesmo anúncio (meta-v1 D13, 21/10) | `RESOLVING` (job `META_IMPORT`; depois `ANALYZING` como hoje) |
| `FAILED`, `READY` | `POST /champions/:id/analyze` | `ANALYZING` (com teardown editado: exige `confirm`) |
Compare-and-set igual ao criativo. Só o backend escreve `status`.

### 3.2 Máquina de estados do lote
| de | evento | para |
|---|---|---|
| (novo) | `POST /champions/:id/batches` (campeão `READY`) | `PLANNING` (job `VARIATIONS_PLAN`) |
| `PLANNING` | ≥ 1 item `READY` e nenhum `WRITING` | `PLAN_READY` (itens falhos ficam `FAILED`, com "Regerar") |
| `PLANNING` | todos `FAILED` | `PLAN_FAILED` |
| `PLAN_READY`, `PLAN_FAILED` | `POST /variation-batches/:id/replan` | `PLANNING` (itens antigos descartados) |
| `PLAN_READY` | `POST /variation-batches/:id/launch` | `LAUNCHED` (final; cria os criativos) |
Depois de `LAUNCHED`, o progresso do lote é **derivado** dos criativos (`progress: { total, generating, waiting, failed, approved }`); não há mais estado salvo.

### 3.3 Máquina do criativo: o que muda
- **Transição de entrada nova:** `(novo) --launch do lote--> SCENES_GENERATING`, pra todo tipo. O criativo nasce com roteiro (`Script` letra A, `READY`, selecionado; `angle` = alavanca), rosto (`selectedFaceId` = rosto escolhido do elenco), motor, voz, `voiceSource`, formato e `editSettings` do lote já gravados. Daí em diante é a máquina v1 sem mudança: `SCENES_SETTLED` → `RENDERING` (render automático) → `RENDER_READY` → `APPROVED`.
- **Travas de variação** (`409 INVALID_STATE` com `details.reason: 'variation_locked'`): `scripts/generate`, `scripts/:id/regenerate|select`, `PATCH scripts` e `PATCH engine` não valem em criativo `origin = VARIATION`; `POST /generate` só vale com os parâmetros do lote (esclarecimento 5, depois da troca de rosto). A alavanca é do lote; mudar outra coisa contamina o teste.
- **Pedido de ajuste (`changes`) por tipo:** `TEXT` e `SCENE` valem em todos; `LINE` não vale com `AUDIO_LIPSYNC` (a voz original não fala texto novo) nem `SOURCE_CUT`; `FACE` só vale em `SWAP_AVATAR` (nos outros o rosto é a constante do lote). `review.changeOptions` já vem filtrado; pedido fora disso = `409 INVALID_STATE` `reason: 'change_not_available'`.
- `steps`: em variação, `offer`, `scripts`, `avatar` e `engine` vêm `done`. `summary.engineLabel` = rótulo do tipo de variação.

## 4. API (proposta, mesmas convenções do `api.md`)
Tipos novos vão para `@maquina/contratos` (o arquiteto acrescenta no A3).

```ts
type ChampionStatus = 'RESOLVING'|'ANALYZING'|'READY'|'FAILED';
type ChampionRights = 'OWN'|'THIRD_PARTY';   // só registro
type VariationKind = 'SWAP_AVATAR'|'NEW_HOOKS'|'COPY_NEW'|'REMIX_EDIT';
type ScenePipeline = 'SCENE_VIDEO'|'TTS_LIPSYNC'|'AUDIO_LIPSYNC'|'SOURCE_CUT'|'REUSE';
// Action ganha: 'upload_video' | 'analyze_again'
// Job.type ganha: 'CHAMPION_RESOLVE' | 'CHAMPION_ANALYZE' | 'VARIATIONS_PLAN' | 'VARIATION_ITEM_REGENERATE'

interface ChampionConfig {               // GET /champions/config
  maxBytes: number; minSec: number; maxSec: number; mimeTypes: string[];
  adLibrary: { available: boolean; reason: 'quota'|'not_configured'|null; retryAfter: string|null }; // ex. quota até "2026-10-19"
  analysisUsdPerSec: number;             // pra mostrar "Analyze (~US$ 0,30)" antes de subir
  kinds: { kind: VariationKind; enabled: boolean }[];   // o que já está no build (10/10: SWAP_AVATAR, NEW_HOOKS)
}

interface AdLibraryMeta {
  status: 'resolved'|'unavailable'|'not_found'|'no_video';
  adArchiveId: string|null; pageName: string|null; startDate: string|null; endDate: string|null;
  isActive: boolean|null; daysRunning: number|null; collationCount: number|null; euReach: number|null;
  primaryText: string|null; headline: string|null; ctaText: string|null; linkUrl: string|null;
  fetchedAt: string|null;                // "proxy de Ad Library, não performance" (a tela repete o aviso)
}

interface ChampionRow {
  id: string; name: string; offer: { id: string; name: string };
  status: ChampionStatus; rights: ChampionRights; sources: ('UPLOAD'|'AD_LIBRARY')[];
  thumbnail: FileRef|null; durationSec: number|null; language: string|null;
  batchesCount: number; variationsCount: number; winnersCount: number;
  createdBy: UserRef; updatedAt: string;
}
interface ChampionDetail extends ChampionRow {
  video: FileRef|null; adLibraryUrl: string|null; adMeta: AdLibraryMeta|null;
  job: Job|null;                          // o último (RESOLVE ou ANALYZE), com checklist
  errorCode: string|null; failReason: string|null; action: Action|null;
  teardown: Teardown|null;
  availableKinds: { kind: VariationKind; available: boolean; reason: 'NO_SPEECH'|'NOT_ENABLED'|null }[];
  costUsd: number;                        // gasto real da análise (Apify + Whisper + Claude)
}

interface TranscriptWord { word: string; startSec: number; endSec: number }
interface Measurements {
  durationSec: number; width: number; height: number; fps: number; hasAudio: boolean;
  cuts: { atSec: number; kind: 'layout'|'content' }[];          // "troca de conteúdo" não é corte de layout (clonar-edicao)
  segments: { startSec: number; endSec: number;
              bands: { y0: number; y1: number; pct: number; role: 'face'|'panel'|'caption'|'unknown' }[] }[];
  palette: string[];                       // hex medido dos frames
  silences: { startSec: number; endSec: number }[];
  keyframes: { atSec: number; reason: 't0'|'block'|'cut'|'end'; image: FileRef }[];
}
type TeardownSectionKey = 'identification'|'metaCopy'|'transcript'|'hook'|'structure'|'layout'
  |'visual'|'audio'|'offerProofCta'|'whySells'|'stealVsVary'|'replicationPlan';
interface Section<T> { status: 'ok'|'na'; naReason: string|null; data: T|null }  // seção sem dado = 'na' + motivo, nunca some
interface TeardownSections {
  identification: Section<{ summary: string; signals: string[] }>;           // duração, aspecto, idioma, dias no ar (proxy)
  metaCopy:       Section<{ primaryText: string|null; headline: string|null; description: string|null; button: string|null; link: string|null }>;
  transcript:     Section<{ keywords: { sentence: string; keyword: string }[] }>; // o texto com tempo vem de Teardown.transcript
  hook:           Section<{ endSec: number; visual: string; onScreenText: string|null; spoken: string }>;
  structure:      Section<{ blocks: { label: string; function: string; startSec: number; endSec: number; onScreen: string; speech: string }[] }>;
  layout:         Section<{ summary: string; segments: { startSec: number; endSec: number; description: string }[] }>;
  visual:         Section<{ palette: { hex: string; role: string }[]; typography: string; captions: string; uiElements: string; person: string; broll: string; motion: string }>;
  audio:          Section<{ voice: string; music: string; sfx: string }>;
  offerProofCta:  Section<{ promise: string; mechanism: string; proof: string; ctaSpoken: string; ctaOnScreen: string }>;
  whySells:       Section<{ avatar: string; awarenessLevel: string; painDesire: string; bigIdea: string; beliefObjection: string; retentionEngine: string; verdict: string[] }>; // verdict: 3-5 causas por peso
  stealVsVary:    Section<{ steal: string[]; vary: { lever: string; idea: string }[] }>;
  replicationPlan: Section<{ suggestions: { kind: VariationKind; lever: string; idea: string }[] }>;
}
interface Teardown {
  id: string; language: string; analyzedAt: string; editedSections: TeardownSectionKey[];
  transcript: { text: string; words: TranscriptWord[]; wpm: number };
  measurements: Measurements; sections: TeardownSections;
}

interface BatchSettings {
  format: VideoFormat;                     // padrão: o mais próximo do aspecto do campeão
  voiceId: string|null;                    // catálogo; usado por NEW_HOOKS, COPY_NEW (LIPSYNC) e SWAP_AVATAR com CATALOG
  voiceSource: 'CATALOG'|'CHAMPION_AUDIO'; // só SWAP_AVATAR
  engine: Engine|null; engineModel: string|null;   // só COPY_NEW; NEW_HOOKS e SWAP_AVATAR são sempre LIPSYNC (Pruna)
  edit: EditSettings;                      // aplicado igual a todos os criativos (uma alavanca)
}
interface VariationCasting { id: string; scope: 'SHARED'|'ITEM'; description: string;
  batches: { batch: number; faces: Face[] }[]; selectedFaceId: string|null }
interface VariationItem {
  id: string; kind: VariationKind; index: number; isControl: boolean; included: boolean;
  status: 'WRITING'|'READY'|'FAILED'; lever: string|null; rationale: string|null;
  hook: { speech: string; onScreenText: string|null } | null;   // NEW_HOOKS
  blocks: ScriptBlock[] | null;                                  // roteiro final do item (todos os tipos com fala; corpo literal em SWAP/NEW_HOOKS)
  layoutTemplateId: string|null;                                 // REMIX_EDIT
  castingId: string|null;
  errorCode: string|null; failReason: string|null; action: Action|null;
  creative: CreativeRow|null;                                    // depois do launch
}
interface VariationBatch {
  id: string; champion: { id: string; name: string }; offer: { id: string; name: string };
  status: 'PLANNING'|'PLAN_READY'|'PLAN_FAILED'|'LAUNCHED'; language: string;
  requests: { kind: VariationKind; count: number }[]; settings: BatchSettings; notes: string|null;
  job: Job|null; items: VariationItem[]; castings: VariationCasting[];
  estimatedCostUsd: number|null; costUsd: number; launchedAt: string|null;
  progress: { total: number; generating: number; waiting: number; failed: number; approved: number } | null; // só LAUNCHED
  createdBy: UserRef; createdAt: string;
}
type EstimateLine = { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }; // igual às lines do estimate v1
interface BatchEstimate {
  costUsd: number; etaSec: number; savedByReuseUsd: number;
  items: { itemId: string; kind: VariationKind; costUsd: number; lines: EstimateLine[] }[];
  spend: { monthUsd: number; capUsd: number|null; afterUsd: number };
  warnings: ('voice_gender_mismatch'|'low_resolution')[];
}
// CreativeRow e itens da Biblioteca ganham:
//   variation: { kind: VariationKind; championId: string; championName: string; batchId: string; lever: string|null; isControl: boolean } | null
```

### 4.1 Upload (assinado)
O web não sabe se o PUT vai direto pro storage ou passa pela API: segue `method/url/headers` da resposta, com barra de progresso (XHR).
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `POST /uploads` | `{ purpose: 'CHAMPION_VIDEO', filename, mimeType, sizeBytes }` | `201 { uploadId, method: 'PUT', url, headers, expiresAt }`. `UPLOAD_MODE=direct`: `url` = URL pré-assinada do storage (assinada com `Content-Length` e `Content-Type`, 30 min). `UPLOAD_MODE=proxy` (padrão em dev, versitygw sem CORS garantido): `url` = `<api>/uploads/:id/content` | 400, 422 `MEDIA_TOO_LARGE` / `MEDIA_INVALID` (mime) | Importar campeão |
| `PUT /uploads/:id/content` | corpo cru do arquivo (só em `proxy`, **com Bearer**), stream direto pro storage em multipart | `{ ok: true }` | 404, 410 `UPLOAD_EXPIRED`, 413 se passar do declarado | web (via `url`) |
| `POST /uploads/:id/complete` | `{}` | `{ uploadId, status: 'READY', file: FileRef (com durationSec/width/height), warnings: ('no_audio'\|'low_resolution')[], analysisEstimateUsd }`. O backend confere o objeto (tamanho igual ao declarado), roda ffprobe e valida a duração | 404, 409 `UPLOAD_INCOMPLETE`, 410 `UPLOAD_EXPIRED`, 422 `MEDIA_INVALID` / `MEDIA_TOO_SHORT` / `MEDIA_TOO_LONG` | web |
A decodificação completa (o arquivo inteiro, regra do download truncado) roda no início do job de análise, não no `complete`, pra não segurar a requisição com 200 MB.

### 4.2 Campeões
| método e rota | entrada | saída | erros | tela |
|---|---|---|---|---|
| `GET /champions/config` | — | `ChampionConfig` | — | Importar (desliga o campo de link com o motivo, se `adLibrary.available = false`) |
| `GET /champions` | `?offerId&limit&cursor` | `ChampionRow[]` + `meta.nextCursor` | 400 | lista de campeões |
| `POST /champions` | `{ offerId, name?, uploadId?, adLibraryUrl?, rights, notes? }` (ao menos um de `uploadId`/`adLibraryUrl`; `rights` só é gravado) | `202 ChampionDetail` em `ANALYZING` ou `RESOLVING`, com `job` | 400, 404 (oferta/upload), 409 `UPLOAD_INCOMPLETE`, 409 `SPEND_CAP_EXCEEDED`, **503 `AD_LIBRARY_UNAVAILABLE`** (só quando veio **só** link e a Apify recusou na hora: teto, sem chave, fora do ar; nada é criado) | Importar → Analyze |
| `GET /champions/:id` | — | `ChampionDetail` | 404 | campeão / teardown |
| `PATCH /champions/:id` | `{ name?, rights?, notes? }` | `ChampionDetail` | 400, 404 | campeão |
| `PUT /champions/:id/video` | `{ uploadId }` (anexa vídeo a um campeão `FAILED`, ex.: link não resolveu) | `202 ChampionDetail` (`ANALYZING`) | 404, 409 `INVALID_STATE` | campeão com falha (`action: upload_video`) |
| `POST /champions/:id/analyze` | `{ confirm?: boolean }` | `202 { job }` | 404, 409 `INVALID_STATE` (já analisando), 409 `CONFIRM_DOWNSTREAM_RESET` `{ editedSections }` se houver seção editada, 409 `SPEND_CAP_EXCEEDED` | "Analyze again" |
| `PATCH /champions/:id/teardown` | `{ sections?: Partial<{ [k in TeardownSectionKey]: Section<any> }>, transcriptWords?: [{ index, word }] }` (corrige palavra do Whisper; tempos não mudam) | `Teardown` (`editedSections` atualizado) | 400, 404, 409 se `ANALYZING` | teardown (autosave) |
| `DELETE /champions/:id` | — | `{ ok: true }` (arquiva; criativos ficam) | 404 | menu |
| `GET /champions/:id/batches` | — | `VariationBatch[]` (resumo, mais recente primeiro) | 404 | campeão |

Checklist do job `CHAMPION_RESOLVE`: `fetching_ad` → `downloading_video`. Do `CHAMPION_ANALYZE`: `reading_video` (decodifica inteiro) → `extracting_audio` → `transcribing` → `measuring` → `diagnosing`. Estimativa da análise (mostrada antes): `analysisUsdPerSec × duração` (Whisper US$ 0,002/s + Claude com frames, ~US$ 0,20-0,30 fixo; ver §7).

### 4.3 Lotes de variação
| método e rota | entrada | saída | erros | tela |
|---|---|---|---|---|
| `POST /champions/:id/batches` | `{ requests: [{ kind, count }], settings?: Partial<BatchSettings>, notes? }` | `202 VariationBatch` (`PLANNING`, itens `WRITING`, controle incluído em `NEW_HOOKS`) | 400, 404, 409 `INVALID_STATE` (campeão não `READY`), 422 `NO_SPEECH` `{ kind }`, 422 `KIND_NOT_ENABLED` `{ kind }`, 409 `SPEND_CAP_EXCEEDED` | escolher variações |
| `GET /variation-batches/:id` | — | `VariationBatch` | 404 | revisão do plano e progresso |
| `POST /variation-batches/:id/replan` | `{ requests?, notes? }` | `202 VariationBatch` (`PLANNING`) | 404, 409 `INVALID_STATE` | "Planejar de novo" |
| `PATCH /variation-batches/:id/items/:itemId` | `{ included?, hook?: { speech?, onScreenText? }, blocks?: [{ index, speech? }] }` (só o que a alavanca do tipo permite: em `NEW_HOOKS` só `hook`; em `COPY_NEW` só `blocks`; em `SWAP_AVATAR` só `included`; campo de outro tipo = 400) | `VariationItem` | 400, 404, 409 se não `PLAN_READY` | revisão do plano |
| `POST /variation-batches/:id/items/:itemId/regenerate` | `{ note? }` | `202 VariationItem` (`WRITING`); só em `PLAN_READY` com item `READY`/`FAILED` | 404, 409 `INVALID_STATE` | "Regerar este" |
| `PATCH /variation-batches/:id/settings` | `Partial<BatchSettings>` | `VariationBatch` | 400, 404, 409 se não `PLAN_READY` | revisão do plano |
| `PATCH /variation-batches/:id/castings/:castingId` | `{ description }` (10-600) | `VariationCasting` | 400, 404 | elenco |
| `POST /variation-batches/:id/castings/:castingId/faces/generate` | `{ description }` | `202 { batch, faces: Face[4] }` (Soul V2, mesma mecânica dos rostos v1) | 400, 404, 409, 409 `SPEND_CAP_EXCEEDED`, 503 | elenco |
| `POST /variation-batches/:id/castings/:castingId/faces/:faceId/select` | `{}` | `VariationCasting` | 404, 409 (rosto não `READY`) | elenco |
| `GET /variation-batches/:id/estimate` | — | `BatchEstimate` (só itens `included` e `READY`) | 404, 422 `BATCH_INCOMPLETE` | revisão do plano |
| `POST /variation-batches/:id/launch` | `{ expectedCostUsd }` | `202 { batch: VariationBatch, creatives: CreativeRow[] }` (criativos em `SCENES_GENERATING`) | 404, 409 `INVALID_STATE`, **422 `BATCH_INCOMPLETE`** `{ missing: [{ castingId, reason: 'face_not_selected' } \| { itemId, reason: 'not_ready' } \| { field: 'voiceId' }] }`, 409 `SPEND_CAP_EXCEEDED`, 409 `ESTIMATE_CHANGED`, 503 | OK do lote |

Checklist do job `VARIATIONS_PLAN`: `reading_teardown` → `writing` (`statusParams: { kind, index }`). Nome dos criativos: `"<campeão> · <rótulo do tipo> <n>"` (controle: `"… · Control"`).

**Esclarecimentos 06/10 (casos do QA):**
1. `PUT /uploads/:id/content` (modo proxy) **exige Bearer** como toda rota da API; upload de outro workspace = 404. O web manda os `headers` devolvidos e, quando a `url` é da própria API, também o `Authorization`. No modo direct a URL pré-assinada dispensa Bearer.
2. Vídeo que não decodifica (no `complete` ou no `reading_video` da análise): campeão `FAILED`, `errorCode: MEDIA_INVALID`, **`action: upload_video`** (analisar de novo não conserta arquivo ruim). `analyze_again` só para falhas transitórias: transcrição, medição, Claude, `INTERRUPTED`.
3. "Regerar este" (`POST …/items/:itemId/regenerate`) só vale com o lote em **`PLAN_READY`** e o item `READY` ou `FAILED`; o lote continua `PLAN_READY` e o item vai pra `WRITING` (launch com item `WRITING` = `422 BATCH_INCOMPLETE`). `PLANNING`, `PLAN_FAILED` (use `replan`) e `LAUNCHED` = `409 INVALID_STATE`.
4. Campeão arquivado = **404** em `GET /champions/:id` e em toda rota dele (e sai do `GET /champions`); os criativos já criados seguem com `variation.championName`. `POST /uploads/:id/complete` é **idempotente**: upload já `READY` devolve 200 com a mesma resposta (mesmo `file`); `FAILED` repete o mesmo 422; `EXPIRED` = 410.

**Esclarecimentos 06/10 (backend):**
5. **Trocar o rosto de uma variação `SWAP_AVATAR`** (change `FACE`) segue a máquina v1, sem reinício automático: escolher o rosto novo leva a `ENGINE_PENDING`, e as cenas só recomeçam com `POST /creatives/:id/generate` (`expectedCostUsd` e `confirm` quando houver cenas), porque gasto sem estimativa na tela é proibido. Em variação o `/generate` é **liberado só com os parâmetros do lote**: `engine`, `engineModel`, `voiceId` e `format` iguais aos gravados no criativo (`voiceSource` e `pipeline` das cenas também se mantêm); qualquer diferença = `409 INVALID_STATE` `reason: 'variation_locked'`. Na etapa Engine, o web mostra só a estimativa e o botão Generate, com os campos travados. `PATCH …/engine` continua travado.
6. **Custo dos rostos do elenco** (`submitFace` com rosto de `castingId`): a `cost_entry` sai com `variationBatchId` = lote do elenco e `creativeId` nulo (quem grava é a ia, achando o lote pelo `casting.batchId`). Entra no `VariationBatch.costUsd` (= entradas com `variationBatchId` + soma dos criativos do lote) e no gasto do mês. Não entra no `costUsd` de nenhum criativo.
7. `@aws-sdk/lib-storage` (multipart do `putStream`) no `api/package.json` está aprovado: o lock da raiz resolveu 3.1146.0, a mesma versão do `client-s3`, deduplicado.

### 4.4 Rotas v1 que mudam (resumo; detalhe na §11)
`GET /creatives` aceita `&championId=` e `&origin=scratch|variation`; `GET /library` aceita `&championId=` e `&variationKind=`; `CreativeRow`, `CreativeDetail` e item da Biblioteca ganham `variation`; `GET /templates` ganha `kind: 'scratch'|'remix'` (remix só pós-10/10); `review.changeOptions` filtrado por tipo (§3.3).

### 4.5 Códigos de erro novos
| code | http | quando | `details` |
|---|---|---|---|
| `AD_LIBRARY_UNAVAILABLE` | 503 | só link e a Apify recusou na hora (teto da conta, chave ausente, fora do ar). Também código assíncrono no campeão | `{ reason: 'quota'\|'not_configured'\|'provider_error', retryAfter: string\|null }` |
| `MEDIA_TOO_LARGE` | 422 | `sizeBytes` > limite | `{ maxBytes }` |
| `MEDIA_TOO_SHORT` / `MEDIA_TOO_LONG` | 422 | duração fora de 5-120 s | `{ durationSec, minSec }` / `{ durationSec, maxSec }` |
| `MEDIA_INVALID` | 422 | mime, sem vídeo, não decodifica, pequeno demais. Também assíncrono | `{ reason }` |
| `UPLOAD_EXPIRED` | 410 | upload passou de 30 min | — |
| `UPLOAD_INCOMPLETE` | 409 | objeto ausente ou de tamanho diferente do declarado | `{ expectedBytes, actualBytes\|null }` |
| `NO_SPEECH` | 422 | tipo que precisa de fala e o campeão não tem | `{ kind }` |
| `KIND_NOT_ENABLED` | 422 | tipo ainda fora do build (ex.: `REMIX_EDIT` antes de entregue) | `{ kind }` |
| `BATCH_INCOMPLETE` | 422 | falta rosto escolhido, item pronto ou voz | `{ missing: [...] }` |
Códigos assíncronos novos (no campeão, job ou item): `AD_LIBRARY_UNAVAILABLE`, `AD_NOT_FOUND`, `AD_HAS_NO_VIDEO`, `MEDIA_INVALID`. `INVALID_STATE` passa a aceitar `details.reason` (`'variation_locked'`, `'change_not_available'`).

### 4.6 Gatilhos de mock (`INTEGRACOES_MODE=mock`, pro QA)
| onde | gatilho | resultado |
|---|---|---|
| `adLibraryUrl` | `mock-ad-unavailable` | `503 AD_LIBRARY_UNAVAILABLE` `{ reason: 'quota', retryAfter: '2026-10-19' }` (síncrono) |
| `adLibraryUrl` | `mock-ad-notfound` / `mock-ad-novideo` | campeão `FAILED` com `AD_NOT_FOUND` / `AD_HAS_NO_VIDEO`, `action: upload_video` |
| `adLibraryUrl` | qualquer outro `?id=` | resolve com vídeo sintético de 20 s com fala |
| `notes` do campeão | `[mock:analysis-fail]` | análise falha em `diagnosing` (`PROVIDER_ERROR`); transcrição e medições ficam |
| `notes` do lote | `[mock:fail-item:<KIND>:<N>]` / `[mock:fail-all]` | item falha / `PLAN_FAILED` |
| descrição do elenco | os 4 gatilhos de rosto v1 | igual ao v1 |
A medição (`MediaAnalysisService`) roda **de verdade** também em mock: é local e grátis. O QA usa vídeos curtos em `testes/fixtures/campeoes/` (um com fala e split screen, um sem áudio, um 400 px, um truncado).

## 5. Pipeline por tipo (o que o backend cria no launch)
Fatiamento: blocos do `structure` do teardown (editável); bloco > 30 s vira 2+ cenas cortadas **no meio do silêncio entre palavras**, nunca no meio de uma palavra (`CatalogService.splitSourceScenes`, determinístico). Pruna = 1 clipe por bloco até 30 s (decisão F3), cada um recomeça do rosto.

### 5.1 `SWAP_AVATAR` (10/10)
- `voiceSource: CHAMPION_AUDIO` (padrão do tipo): por cena, `pipeline AUDIO_LIPSYNC`. O backend corta o trecho `sourceStartSec–sourceEndSec` do áudio do campeão (`MediaAnalysisService.sliceAudio`, piso de 2 s do Pruna), sobe como `SCENE_AUDIO`, chama `submitLipsync` (rosto do elenco do item + trecho). `words` = palavras do teardown no trecho (já corrigidas pelo usuário), relativas ao início da cena: **sem TRANSCRIBE**. Cena `READY` com clipe validado + miniatura + words, como no v1.
- `voiceSource: CATALOG`: `pipeline TTS_LIPSYNC` com a fala literal do teardown e a voz do lote (cadeia v1).
- Edição: templates v1 (`clean`/`bold`/`headline`), `editSettings` do lote. **"Manter a edição em volta" (painéis do original + head novo) é pós-10/10** (§9).

### 5.2 `NEW_HOOKS` (10/10)
- Itens: N ganchos + 1 controle (gancho original). Todos com o mesmo elenco `SHARED`, a mesma voz e `edit`; `headline` do template = `hook.onScreenText` do item (controle = o texto da tela original).
- Cena 0 (`hook`, de 0 a `hook.endSec`): `TTS_LIPSYNC` com a fala nova do item.
- Cenas do corpo: o **controle é o dono** (`TTS_LIPSYNC`); nos outros itens as cenas do corpo nascem `REUSE` com `reuseOfSceneId` = cena do controle. Quando a dona fica `READY`, o backend copia `clipFileId`/`thumbnailFileId`/`words` (arquivo é imutável, só referência) e marca `READY` sem custo. Dona `FAILED` → seguidoras `FAILED` com o mesmo `errorCode`; "Refazer cena" numa seguidora a torna independente (`TTS_LIPSYNC`, cobrada).
- Fala do corpo = literal do campeão (idioma do campeão). O gancho novo sai no mesmo idioma, senão a voz troca de língua no meio.

### 5.3 `COPY_NEW` (pós-10/10)
`ClaudeService.planVariations` escreve o roteiro inteiro pra oferta do usuário, preso à estrutura do campeão (nº e função dos blocos, duração por bloco ±15%, palavras/min). Pipeline v1 conforme o motor do lote (`SCENE_VIDEO` ou `TTS_LIPSYNC`). Rosto: elenco `SHARED`. Idioma: o da oferta.

### 5.4 `REMIX_EDIT` (pós-10/10)
Cenas `SOURCE_CUT`: `MediaAnalysisService.cutVideo` corta os blocos do campeão (recodifica, corte exato no frame), `words` do teardown, sem provedor, custo US$ 0. O render usa os templates `remix-*` com as regiões medidas (§6.3). Head e locução saem bit-idênticos entre itens (conferir md5 do áudio, regra da esteira).

## 6. Contratos internos (estrutura.md §2, propostos)
### 6.1 `integracoes` (maquina-ia): o que entra
```ts
// ---------- Ad Library (Apify) ----------
export interface AdLibraryService {
  /** Barato e cacheado 10 min: lê GET /v2/users/me/limits da Apify (uso do mês x teto). */
  status(): Promise<{ available: boolean; reason: 'quota'|'not_configured'|null; retryAfter: string|null }>;
  /** Roda o actor do ad-radar (curious_coder/facebook-ads-library-scraper, scrapeAdDetails, 512 MB) pra UM anúncio,
   *  esperando até 180 s. Grava cost_entry (APIFY, SCRAPE) com o uso real do run.
   *  Erros (IntegracaoError.code): AD_LIBRARY_UNAVAILABLE (teto/sem chave/5xx; com reason), AD_NOT_FOUND, AD_HAS_NO_VIDEO. */
  resolve(i: { workspaceId: string; championId: string; jobId: string; url: string }):
    Promise<Omit<AdLibraryMeta,'status'|'fetchedAt'> & { videoUrl: string|null; posterUrl: string|null } & Usage>;
}
// A URL do vídeo (fbcdn) expira em horas: o backend faz ingestFromUrl(validate:'video') no mesmo job.

// ---------- Claude ----------
export interface TeardownDraft { language: string; sections: TeardownSections }   // tipo do @maquina/contratos
export type VariationItemDraft = { lever: string; rationale: string } & (
  { hook: { speech: string; onScreenText: string|null; durationSec: number } } | { castingDescription: string } |
  { script: ScriptDraft } | { layoutTemplateId: string });
export interface ClaudeService {
  // ... v1 sem mudança ...
  /** Escreve as 12 seções. Recebe frames-chave (t0, início de cada bloco, cada corte, fim; até 16, lado maior 768 px),
   *  transcrição com tempo, medições, metadados da Ad Library e a oferta (pra "o que variar").
   *  Texto do diagnóstico no idioma da interface (uiLocale); citações da fala/tela literais no idioma original.
   *  Regras: seção sem dado = 'na' + motivo; pessoa descrita de forma genérica (nunca traço identificável);
   *  nada de número de performance inventado (Ad Library é proxy). */
  analyzeChampion(i: { workspaceId: string; championId: string; jobId: string; uiLocale: 'EN'|'PT_BR';
      offer: OfferBriefDraft|null; transcript: { language: string; words: TranscriptWord[] };
      measurements: Omit<Measurements,'keyframes'>; keyframes: { atSec: number; reason: string; url: string }[];
      adMeta: AdLibraryMeta|null },
    onStage: (s: 'diagnosing') => void): Promise<TeardownDraft & Usage>;

  /** Planeja os itens do lote, em paralelo, um por slot. Uma alavanca por item, dita em `lever` + `rationale`
   *  apontando a causa do whySells que ataca.
   *  NEW_HOOKS: { hook: { speech, onScreenText|null, durationSec } } no idioma do campeão, ~mesma duração do gancho original.
   *  SWAP_AVATAR: { castingDescription } (elencos diferentes entre si; nunca descreve a pessoa do campeão).
   *  COPY_NEW: { script: ScriptDraft } preso à estrutura. REMIX_EDIT: { layoutTemplateId } do catálogo remix.
   *  Também devolve sharedCastingDescription quando houver NEW_HOOKS/COPY_NEW. */
  planVariations(i: { workspaceId: string; batchId: string; jobId: string; language: string;
      offer: OfferBriefDraft; teardown: TeardownSections; transcript: TranscriptWord[];
      slots: { kind: VariationKind; index: number }[]; avoidLevers: string[]; notes: string|null },
    cb: { onSharedCasting(description: string): void;
          onItemDone(kind: VariationKind, index: number, draft: VariationItemDraft): void;
          onItemFailed(kind: VariationKind, index: number, errorCode: string): void }): Promise<Usage>;
}

// ---------- catálogo ----------
export interface CatalogService {
  // ... v1 ...
  /** estimate passa a aceitar o pipeline de cada cena: REUSE e SOURCE_CUT = US$ 0; AUDIO_LIPSYNC = só LIPSYNC
   *  (segundos reais do trecho, sem TTS nem TRANSCRIBE). Sem `pipelines` = comportamento v1. */
  estimate(i: { /* v1 */ ; pipelines?: ScenePipeline[]; audioSecByScene?: number[] }): { /* v1 */ };
  /** Custo da análise: Whisper por segundo + Claude (fixo estimado por nº de frames). */
  estimateAnalysis(durationSec: number, keyframeCount: number): number;
  /** Fatiamento do campeão em cenas no silêncio entre palavras, respeitando maxSceneSec do modelo. Determinístico. */
  splitSourceScenes(words: TranscriptWord[], blocks: { label: string; startSec: number; endSec: number }[], maxSceneSec: number):
    { index: number; label: string; sourceStartSec: number; sourceEndSec: number; speech: string; words: TranscriptWord[] }[];
}

// ---------- WaveSpeed ----------
export interface GenerationService {
  // submitFace: Soul V2 (Higgsfield), sem mudança de assinatura. Rosto de elenco também é um `faces` (faceId).
  /** Generalizado: sceneId OU championId; language opcional (campeão = detecção automática). */
  submitTranscribe(i: { workspaceId: string; sceneId?: string; championId?: string; mediaUrl: string; language?: string }): Promise<Submitted>;
  /** Novo: palavras + idioma detectado (o parseWords v1 continua). */
  parseTranscript(providerTaskId: string): Promise<{ language: string; words: TranscriptWord[] }>;
}
```
`provider.task.finished` ganha `championId?`. Mock: `AdLibraryService` fake (gatilhos §4.6), `analyzeChampion` e `planVariations` determinísticos, custo US$ 0.

### 6.2 `medicao` (maquina-video, pasta nova `api/src/medicao/`): `MediaAnalysisService`
Sem regra de negócio, só caminhos locais (o backend baixa do storage e sobe o resultado). ffmpeg/ffprobe do sistema (o `api/Dockerfile` já precisa deles).
```ts
export interface MediaAnalysisService {
  probe(path: string): Promise<{ durationSec: number; width: number; height: number; fps: number; hasAudio: boolean; videoCodec: string }>;
  /** Decodifica o arquivo inteiro (regra do download truncado). Lança MediaInvalidError. */
  validateFull(path: string): Promise<void>;
  extractAudio(videoPath: string, outPath: string): Promise<{ durationSec: number }>;   // m4a mono 44,1 kHz
  sliceAudio(audioPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]>;
  cutVideo(videoPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]>; // pós-10/10
  keyframes(videoPath: string, atSec: number[], outDir: string, maxSide: number): Promise<{ atSec: number; path: string }[]>;
  /** silencedetect a -35 dB; NUNCA com -v error (engole a saída do filtro): usar -hide_banner. */
  silences(audioPath: string, minSec?: number): Promise<{ startSec: number; endSec: number }[]>;
  /** Port em TS do analisar_estrutura.py (clonar-edicao): variância temporal por linha, penhasco (argmin), nunca limiar
   *  absoluto; separa corte de layout de troca de conteúdo; colunas = mesma análise no vídeo transposto (pós-10/10). */
  measureLayout(videoPath: string): Promise<Pick<Measurements,'cuts'|'segments'>>;
  palette(framePaths: string[], k: number): Promise<string[]>;                          // hex
}
```
Teste de aceite do port: rodar o `.py` e o TS nos mesmos 3 vídeos do swipe local e bater cortes (±0,1 s) e faixas (±2 px). Mídia de teste fora do git.

### 6.3 `render` (maquina-video), pós-10/10
`RenderInput.scenes[]` ganha `regions?: { head: Rect|null; panel: Rect|null }` (retângulos normalizados 0-1 do quadro do campeão, vindos de `measurements.segments`) e `overlayClipUrl?: string` (head novo por cima, pro "manter a edição" do SWAP_AVATAR). `templates()` ganha `kind: 'scratch'|'remix'` e `requiresRegions: boolean`. Templates remix iniciais: `remix-head-full` (só a faixa do rosto em tela cheia, laterais com cópia desfocada), `remix-split` (rosto em cima, painel embaixo, proporção medida), `remix-captions` (quadro original + legenda/headline novos). B-roll novo fica fora (não temos fonte de b-roll no produto).

## 7. Custos por tipo (estimativa; preço por unidade, conferir na sonda)
Base: campeão de 30 s com fala, Pruna US$ 0,025/s, Soul V2 US$ 0,006/imagem, Whisper US$ 0,002/s, Opus 5.5 US$ 4/20 por milhão.
| etapa | conta | estimativa |
|---|---|---|
| Resolver link (Apify) | 1 anúncio, 512 MB, ~60-90 s de run | ≤ US$ 0,01 (a confirmar depois de 19/10) |
| Análise | Whisper 30 s = 0,06 + Claude (~12 frames ≈ 17k tokens + texto ≈ 25k entrada, ~6k saída) ≈ 0,22 | **≈ US$ 0,30** (120 s ≈ US$ 0,50) |
| Plano do lote | Claude, 1 chamada por item, saída curta | US$ 0,03-0,05 por item |
| Elenco (4 rostos) | 4 × 0,006 | US$ 0,024 por rodada |
| `SWAP_AVATAR` com áudio original | 30 s × 0,025 (Pruna, por bloco) | **≈ US$ 0,78** por variação (com o elenco) |
| `SWAP_AVATAR` com voz do catálogo | + TTS ~0,02 + Whisper 0,06 | **≈ US$ 0,86** por variação |
| `NEW_HOOKS` | corpo uma vez (controle): ~27 s ≈ 0,75 com TTS/Whisper; cada gancho ~4 s ≈ 0,12 | **3 ganchos + controle ≈ US$ 1,15** (sem o reuso seria ≈ 3,40) |
| `COPY_NEW` | igual ao v1 | Pruna ≈ 0,85 · Kling ≈ 4,93 · Seedance ≈ 7,26 por variação |
| `REMIX_EDIT` | só CPU do render | **US$ 0** de provedor |
Toda ação paga passa pelo teto do mês (`SPEND_CAP_EXCEEDED`). Análise e plano custam centavos e seguem o precedente do v1 (roteiros disparam sem tela de confirmação; o preço aparece no botão). O lançamento do lote é como o Generate: estimativa na tela, `expectedCostUsd`, tolerância de 10% (`ESTIMATE_CHANGED`). Custo real do campeão = `cost_entries` com `championId`; do lote = plano + elencos + soma dos criativos.

## 8. Eventos e tempo real
**Decisão: nenhum stream SSE novo; polling nas telas de campeão e lote, SSE v1 em cada variação aberta.** Porquê, em uma linha: análise e plano levam de 30 s a 2 min e as telas são resumo (como a Home), então polling cobre sem estado novo no servidor, e cada criativo do lote já tem o SSE dele.
| quem | rota | intervalo | para quando |
|---|---|---|---|
| Importar / campeão | `GET /champions/:id` | 2 s | `status` ∈ `READY`, `FAILED` |
| Plano do lote | `GET /variation-batches/:id` | 1,5 s | `status` ≠ `PLANNING` |
| Lote lançado | `GET /variation-batches/:id` | 5 s | nenhum criativo do lote com `status = progress` (volta a 30 s) |
- Apify **sem webhook**: o `resolve` espera o run dentro do job (≤ 180 s). API reiniciou no meio → job `INTERRUPTED` → campeão `FAILED` com `action: analyze_again` (ou `upload_video` se ainda não havia vídeo).
- TRANSCRIBE do campeão é uma `provider_task` normal (webhook + reconciliador v1); o job de análise retoma no `provider.task.finished` com `championId`.
- Seguidoras `REUSE` mudam junto com a dona e emitem `scene.updated` no SSE do próprio criativo.

## 9. Plano de construção (por agente)
Hoje é 06/10 (Bali). 10/10 tem 3,5 dias úteis, e o G4 do v1 (deploy + 1º criativo real) disputa as mesmas pessoas. Proposta honesta:

**Até 10/10:** upload (proxy em dev; direct em prod se o CORS do Supabase passar) · link da Ad Library com falha explícita (código e mock completos; live só validável depois de 19/10) · análise com as 12 seções editáveis · **Trocar avatar** (talking head limpo; áudio original ou voz do catálogo) · **Novos ganchos** (com controle e reuso do corpo).
**Depois do 10/10, nesta ordem:** (1) `COPY_NEW` (~1 dia: é o pipeline v1 com roteiro preso à estrutura); (2) "Variar" a partir da Biblioteca (~0,5 dia); (3) `REMIX_EDIT` + "manter a edição" no Trocar avatar (~2-3 dias: templates remix, regiões medidas no render, conferência de medição; foi onde a esteira mais errou medida); (4) validar o link live com a Apify depois de 19/10.

### Portões
| portão | o quê | quem libera |
|---|---|---|
| **F2-G0** | este doc (**aprovado 06/10**) + mockup do maquina-design (F4a/F4b só codam a tela depois do mockup aprovado) | Gusta |
| **F2-G1** | A3: migração aplicada local, tipos no `@maquina/contratos`, contratos v1 editados com o diff da §11 | **feito 06/10** |
| **F2-G2** | fluxo inteiro em mock no navegador (1440/390): upload → teardown → lote SWAP + NEW_HOOKS → criativos renderizados; falhas forçadas (link indisponível, análise falha, item falha, sem fala, upload inválido) | qa (09/10) |
| **F2-G4** | 1 campeão real **do Gusta**: análise (~US$ 0,30) + 1 Trocar avatar com áudio original (~0,80) + 3 ganchos + controle (~1,15) ≈ **US$ 2,30**, estimativa na tela antes | Gusta autoriza e aprova as peças (10/10) |

### Tarefas
| id | agente | tarefa | depende de | entrega verificada por |
|---|---|---|---|---|
| A3 | arquiteto | migração + `schema.prisma`; tipos novos no `@maquina/contratos`; aplicar o diff da §11 nos contratos v1; `TIME.md` (posse de `api/src/medicao/`); envs novas nos `.env.example` | F2-G0 | **feito 06/10**: `prisma validate`, migração aplicada em `maquina` e `maquina_test`, `tsc` do pacote limpo (quebras esperadas em api/web listadas na §12) |
| V3 | video | `api/src/medicao/`: `probe`, `validateFull`, `extractAudio`, `sliceAudio`, `keyframes`, `silences`, `palette`, `measureLayout` (port do `.py`) | A3 (só o contrato; pode começar no dia 1) | Jest + bater o port com o `.py` em 3 vídeos do swipe |
| I4a | ia | `AdLibraryService` (live + mock, `status()` pelos limites da Apify), `submitTranscribe` generalizado + `parseTranscript`, `analyzeChampion` (visão, saída estruturada das 12 seções, regras de PII), `estimateAnalysis` | A3 | Jest com SDK/fetch falsos; **sonda de centavos** do `analyzeChampion` num vídeo nosso (~US$ 0,25, avisada) |
| B4a | backend | módulos `uploads/` (proxy e direct, complete com ffprobe, cron de expirados) e `campeoes/` (máquina do campeão, job de análise: decodifica → extrai áudio → TRANSCRIBE → medição → Claude → teardown; `PATCH teardown`; `PUT video`; `availableKinds`; custo por campeão) | A3, V3 (contrato), I4a (mock) | Jest por transição + rotas batendo com o `@maquina/contratos` |
| F4a | frontend | Importar (oferta existente ou nova, upload com progresso, link com estado indisponível vindo do `config`, declaração de direitos, preço da análise no botão), tela do campeão com o teardown (player + frames-chave numa linha do tempo, 12 seções editáveis, correção de palavra) | F2-G0 (mockup), A3 (tipos) | `tsc`, `next build`, 1440/390 com MSW |
| I4b | ia | `planVariations` (SWAP_AVATAR e NEW_HOOKS no 10/10; COPY_NEW e REMIX depois), `splitSourceScenes`, `estimate` com `pipelines` | I4a | Jest; sonda do plano (~US$ 0,05) |
| B4b | backend | módulo `variacoes/` (lote, itens, elencos com rostos Soul, settings, estimate, launch criando criativos em `SCENES_GENERATING`); orquestrador: `AUDIO_LIPSYNC` (corte do áudio, sem TRANSCRIBE), `REUSE` (seguidoras); travas de variação na máquina do criativo; `changeOptions` por tipo; filtros novos em `/creatives` e `/library` | B4a, I4b (mock) | Jest: launch, reuso, travas |
| F4b | frontend | escolher variações (tipos × quantidade, indisponíveis com motivo), revisão do plano (editar gancho, tirar item, elenco e rostos, voz/formato/edição do lote, estimativa, OK), progresso do lote; selo de variação na Home, no criativo e na Biblioteca | F4a, B4b (contrato) | `tsc`, `next build`, 1440/390 com MSW |
| F4c | frontend | MSW → API real | F4b, B4b | fluxo manual |
| Q5 | qa | contrato endpoint a endpoint, isolamento entre workspaces (campeão, lote, upload), máquinas do campeão/lote, travas, gatilhos de mock, fixtures de vídeo → **F2-G2** | B4b, F4c | Playwright + relatório com comando e saída |
| Q6 | qa + Gusta | **F2-G4** real com o vídeo do Gusta | F2-G2 + chaves | folha de frames, áudio (md5 do trecho original no Trocar avatar), legenda; Gusta aprova |
| D2 | design | mockup das telas (em paralelo, já pedido) | — | Gusta |

### Paralelismo
```
F2-G0 ─► A3 ─┬─► V3 ─────────────┐
             ├─► I4a ─► I4b ─────┼─► B4b ─► F4c ─► Q5 (F2-G2) ─► Q6 (F2-G4)
             ├─► B4a ────────────┘                 ▲
             └─► F4a ─► F4b ───────────────────────┘
```
- **07/10:** A3 (manhã) → V3, I4a, B4a, F4a em paralelo (B4a contra o contrato do V3 e o mock da I4a).
- **08/10:** I4b, B4b, F4b. Q5 escreve os casos a partir deste doc.
- **09/10:** F4c, Q5 → F2-G2. Correções.
- **10/10:** F2-G4 com ok do Gusta. Se escorregar, sai primeiro o Trocar avatar (não depende de reuso) e Novos ganchos entra no dia seguinte.
Posse de pasta: backend cria `api/src/uploads/`, `api/src/campeoes/`, `api/src/variacoes/`; ia só em `api/src/integracoes/`; video em `api/src/medicao/` (nova, precisa do ok no `TIME.md`) e `api/src/render/`; nada de agente escrevendo na pasta do outro.

### Riscos
- **G4 do v1 e feature 2 na mesma semana**: o F2-G4 também valida o caminho LIPSYNC do v1, mas o deploy (Supabase, EasyPanel, Vercel) continua pendente com o Gusta. O F2-G4 pode rodar local em `live` com `WAVESPEED_WEBHOOKS=off`.
- **Apify no teto até 19/10**: o link fica sem validação live até lá; a UI já mostra o motivo antes de o usuário tentar.
- **Copy literal de terceiro sai na peça** (Trocar avatar e Novos ganchos reaproveitam a fala do campeão, de quem for): decisão do Gusta, sem trava no produto.
- **Medição errada passa calada** (histórico da esteira): no 10/10 a medição só alimenta o teardown (texto); ela só vira corte de vídeo no `REMIX_EDIT`, que ficou pra depois com teste de aceite contra o `.py`.

## 10. Decisões do Gusta (06/10)
| # | decisão |
|---|---|
| D1 | **Nenhum tipo de variação é bloqueado por dono** ("não precisa ter isso"). A declaração fica gravada, não trava nada. Sem erro de direitos, sem aviso de copy de terceiro. |
| D2 | Direito de uso = checkbox, sem verificação. |
| D3 | Link da Ad Library pela **mesma conta Apify do ad-radar**, com `AD_LIBRARY_UNAVAILABLE` explícito até 19/10. |
| D4 | Análise roda logo depois do upload; preço no botão. |
| D5 | Até 10/10: upload + análise + Trocar avatar + Novos ganchos (Novos ganchos em Pruna). Copy nova e Remontar depois. Upload até 200 MB, 5-120 s. |
Também vigente: prompts de mídia v2 são o padrão (`MEDIA_PROMPTS=v2`); rosto = Soul V2 (provider `HIGGSFIELD`, migração `20261006000000_provider_higgsfield`).

## 11. Diff nos contratos v1 (aplicado 06/10 no A3)
### `modelo-de-dados.md`
- Entidades novas na tabela: `uploads`, `champions`, `teardowns`, `variation_batches`, `variation_castings`, `variation_items` (quem escreve: backend; teardown e itens gravam o que a ia devolve).
- Seção nova "Máquina do campeão" e "Máquina do lote" (§3.1 e §3.2 deste doc).
- Transições do criativo: linha nova `(novo) | launch do lote | SCENES_GENERATING`; parágrafo das travas de variação e do `changes` por tipo (§3.3).
- `APPROVED é final ... (pra variar, cria criativo novo; feature 2)` → "pra variar, importa como campeão (pós-10/10: Variar a partir da Biblioteca)".
- Cenas: coluna `pipeline` (explica os 5), `source_start_sec`/`source_end_sec`, `reuse_of_scene_id`; "a cena só fica READY com clipe validado, words e miniatura" continua valendo (em `AUDIO_LIPSYNC`/`SOURCE_CUT` as words vêm do teardown).
- Rostos: `creative_id` opcional + `casting_id` (exatamente um dos dois, `CHECK faces_owner_check`).
- Custos: `cost_entries.champion_id` e `variation_batch_id`; provider `APIFY`, kind `SCRAPE`; custo do campeão e do lote.
- "Fora da v1": tirar "variar campeão (feature 2: novo `Creative.sourceCreativeId`)" e trocar pela referência a este doc.
### `api.md`
- Tipos: `Action` + `upload_video`, `analyze_again`; `Job.type` + 4 tipos; `CreativeRow`/`CreativeDetail`/item da Biblioteca + `variation`; tipos novos da §4.
- Tabela de erros: os códigos da §4.5; `INVALID_STATE.details.reason`. `/workspace/services` e `/workspace/spend` com `HIGGSFIELD` e `APIFY`. Códigos assíncronos: + `AD_LIBRARY_UNAVAILABLE`, `AD_NOT_FOUND`, `AD_HAS_NO_VIDEO`, `MEDIA_INVALID`.
- Seções novas: Uploads, Campeões, Lotes de variação (§4.1-4.3), gatilhos de mock (§4.6) no §17.
- §3 Home: filtros `championId`, `origin`. §13 Biblioteca: filtros `championId`, `variationKind`. §11 Edit: `GET /templates` + `kind`. §12 Final OK: `changeOptions` por tipo. §16 "quem usa o quê": telas novas.
- §7, §9 e §10: nota "em criativo de variação, 409 `variation_locked`".
### `eventos.md`
- Linha de decisão: "nenhum stream novo na feature 2" + justificativa (§8).
- Polling: 3 linhas novas (§8). `provider.task.finished` + `championId?`. Cadeia por pipeline: `AUDIO_LIPSYNC` = LIPSYNC → READY (sem TRANSCRIBE); `REUSE` = sem task; `SOURCE_CUT` = sem task. Apify sem webhook, dentro do job.
### `estrutura.md`
- Pastas: `api/src/uploads/`, `api/src/campeoes/`, `api/src/variacoes/` (backend), `api/src/medicao/` (video), `api/src/integracoes/adlibrary/` (ia); `testes/fixtures/campeoes/` (qa, mídia pesada fora do git).
- §2.1: `AdLibraryService`, `analyzeChampion`, `planVariations`, `estimate` com `pipelines`, `estimateAnalysis`, `splitSourceScenes`, `submitTranscribe` generalizado, `parseTranscript`. §2.2 (pós-10/10): `regions`, `overlayClipUrl`, `kind`/`requiresRegions`. §2.4 nova: `MediaAnalysisService`. §2.3: `StorageService.putStream` e `presignPut` (backend).
- `api/.env.example`: `MEDIA_PROMPTS=v2`, `APIFY_TOKEN=`, `APIFY_AD_LIBRARY_ACTOR=curious_coder~facebook-ads-library-scraper`, `AD_LIBRARY_MODE=mock|live|off`, `UPLOAD_MODE=proxy|direct`, `UPLOAD_MAX_BYTES=209715200`, `CHAMPION_MIN_SEC=5`, `CHAMPION_MAX_SEC=120`.
- Deploy: CORS do bucket do Supabase pro domínio do web (só se `UPLOAD_MODE=direct`); `api/Dockerfile` com ffmpeg/ffprobe do sistema (extração, corte, medição).
### `plano-de-construcao.md`
- Seção "Feature 2" com portões F2-G0..G4, tarefas A3, V3, I4a/b, B4a/b, F4a/b/c, Q5, Q6, D2 e o paralelismo da §9.
### `time/TIME.md`
- maquina-video passa a ter `api/src/medicao/`. Nome HookMill já está lá.

## 12. Briefs por agente (pra disparar)
Regras comuns: `time/TIME.md` (posse de pasta, nada pago sem perguntar, verificado = executado, relatório de 5 linhas). Todo mundo lê antes: este doc (§1-§9), `api.md` §18-20, `modelo-de-dados.md` (Mudanças 06/10 + máquinas do campeão e do lote) e os tipos novos no fim de `contratos/src/index.ts`. Banco local `maquina` e `maquina_test` já estão na migração `20261006120000_feature2_variar_campeao`. Mudou o contrato? Pede ao arquiteto, não edita `docs/contratos/`, `contratos/` nem `api/prisma/`.

### Ordem e paralelismo
```
agora ──► B0 (backend, ~1 h: deixa a api compilando) ─┬─► B4a ─► B4b ─► F4c ─► Q5 (F2-G2, 09/10) ─► Q6 (F2-G4, 10/10)
      ├─► F0 (frontend, ~30 min) ─► F4a ─► F4b ───────┘                ▲
      ├─► V3 (video) ──────────────► (B4a consome)                      │
      ├─► I4a (ia) ─► I4b ─────────► (B4a/B4b consomem; mock primeiro)  │
      └─► Q5-prep (qa: fixtures + casos) ───────────────────────────────┘
```
- **Podem começar já e em paralelo:** backend (B0 primeiro), ia, video, frontend (F0; telas novas só depois do mockup aprovado), qa (fixtures e casos).
- `tsc` da api fica vermelho até o B0 terminar: ia e video podem codar antes, mas só declaram pronto com o `tsc` da api limpo.
- Ninguém espera ninguém sem motivo: backend trabalha contra o mock da ia e o contrato do video; frontend contra MSW.

### Backend (maquina-backend) · pastas: `api/src/` menos `integracoes/`, `render/`, `medicao/`; `api/package.json`; `api/src/app.module.ts`
**B0 (primeiro, ~1 h): deixar a api compilando com o schema e os tipos novos.** Quebras conhecidas (`npx tsc --noEmit` em `api/`):
- `faces.creative_id` agora é opcional (rosto pode ser de elenco): `geracao/orquestrador.service.ts:69,74,75`, `recuperacao/recuperacao.service.ts:74`, `rostos/rostos.service.ts:96`.
- `jobs/job.presenter.ts:8`: checklist dos jobs novos. `CHAMPION_RESOLVE`: `fetching_ad`, `downloading_video`. `CHAMPION_ANALYZE`: `reading_video`, `extracting_audio`, `transcribing`, `measuring`, `diagnosing`. `VARIATIONS_PLAN`: `reading_teardown`, `writing`. `VARIATION_ITEM_REGENERATE`: `writing`.
- `criativos/views.ts:115` e `biblioteca/biblioteca.service.ts:51`: campo `variation` (null no criativo do zero).
- `edicao/edicao.service.ts:53`: `Template.kind` (`'scratch'` nos 3 atuais).
- `common/errors/error-codes.ts:52` e `common/errors/falhas.ts:12`: códigos novos (`api.md` §1) e texto humano dos assíncronos novos.
- De carona: `GET /workspace/services` com `HIGGSFIELD` (`HF_API_KEY_ID`/`SECRET`) e `APIFY` (`APIFY_TOKEN`); `/workspace/spend` já soma por provider/kind do banco, conferir que `HIGGSFIELD`/`APIFY`/`SCRAPE` aparecem.
Pronto quando: `tsc` limpo, Jest da api passando como antes.

**B4a:** módulos `uploads/` (§4.1: `UPLOAD_MODE` proxy/direct, `PUT /uploads/:id/content` em stream com limite, `complete` com ffprobe, cron de `EXPIRED`) e `campeoes/` (§4.2: rotas, máquina do campeão §3.1 com compare-and-set, job de análise: `validateFull` → `extractAudio` → `submitTranscribe({ championId })` → espera `provider.task.finished` → `keyframes`/`measureLayout`/`silences`/`palette` → `analyzeChampion` → `Teardown`; `hasSpeech`; `availableKinds`; `PATCH teardown` com `editedSections` e correção de palavra; `PUT video`; job de link: `AdLibraryService.resolve` → `ingestFromUrl` no mesmo job; com upload + link, o link só busca metadados e não bloqueia). `StorageService.presignPut`/`putStream`/`head`. Custo por campeão.
**B4b:** módulo `variacoes/` (§4.3 e §3.2: lote, `planVariations` com controle automático em `NEW_HOOKS`, itens, elencos com rostos via `submitFace` (rosto com `castingId`), settings, `estimate` (`CatalogService.estimate` com `pipelines`), `launch` criando criativos em `SCENES_GENERATING` com `Script` A, rosto, motor LIPSYNC, voz, `voiceSource`, `editSettings` (`headline` = `hook.onScreenText` no NEW_HOOKS)). Orquestrador: `AUDIO_LIPSYNC` (corta o trecho com `sliceAudio`, sobe `SCENE_AUDIO`, `submitLipsync`, words do teardown, sem TRANSCRIBE) e `REUSE` (§5.2). Travas de variação e `changeOptions` por tipo (§3.3). Filtros `championId`/`origin`/`variationKind`. Spend cap em toda ação paga.
**Não fazer:** nada de trava por `rights` (decisão do Gusta). Não editar `integracoes/`, `medicao/`, `render/`.
**Verificado por:** `tsc`, Jest (uma transição por teste nas máquinas do campeão e do lote; launch; reuso; travas), respostas batendo com `@maquina/contratos`.

### IA (maquina-ia) · pasta: `api/src/integracoes/` (dependência nova = pedir ao backend)
**I4a:** (1) `MEDIA_PROMPTS` sem env = **v2** (o padrão mudou; hoje o código cai em v1). (2) Copiar §6.1 para `contrato.ts` (idêntico). (3) `adlibrary/`: `AdLibraryService` live (actor `APIFY_AD_LIBRARY_ACTOR`, 512 MB, 1 anúncio, espera ≤ 180 s, `status()` por `GET /v2/users/me/limits` cacheado 10 min, `cost_entry` APIFY/SCRAPE com o uso real) + mock com os gatilhos §4.6 + `AD_LIBRARY_MODE=off`. Falha explícita: teto/sem chave = `AD_LIBRARY_UNAVAILABLE` com `reason` e `retryAfter`. (4) `submitTranscribe` com `championId` e idioma opcional (detecção) + `parseTranscript`; `provider.task.finished` com `championId`. (5) `analyzeChampion`: visão (até 16 frames, lado maior 768 px), saída estruturada nas 12 seções (`TeardownSections`), diagnóstico no `uiLocale`, citações literais, pessoa genérica, `na` + motivo em vez de inventar, sem número de performance. (6) `estimateAnalysis`.
**I4b:** `planVariations` (no 10/10 só `SWAP_AVATAR` e `NEW_HOOKS`; `COPY_NEW`/`REMIX_EDIT` devolvem falha `KIND_NOT_ENABLED` no mock até a vez deles): uma alavanca por item, `lever` + `rationale` ligado ao `whySells`, ganchos no idioma do campeão e com ~a duração do gancho original, elencos diferentes entre si e nunca descrevendo a pessoa do campeão. `splitSourceScenes` (corte no silêncio entre palavras, máx. 30 s no Pruna). `estimate` com `pipelines` (`REUSE`/`SOURCE_CUT` = 0; `AUDIO_LIPSYNC` = só lipsync).
**Dinheiro:** testes em mock. Sondas: `analyzeChampion` num vídeo nosso (~US$ 0,25) e `planVariations` (~US$ 0,05), **avisando o valor antes**. Nada de Apify live até 19/10 (conta no teto).
**Verificado por:** Jest com SDK/fetch falsos; `docs/integracoes.md` atualizado com preços e resultado das sondas.

### Video (maquina-video) · pastas: `api/src/medicao/` (nova), `video/`, `api/src/render/`
**V3 (até 10/10):** `api/src/medicao/` com `contrato.ts` (§6.2, idêntico) + `MediaAnalysisService` + `MedicaoModule` exportando o token (o backend importa no `app.module`). `probe`, `validateFull`, `extractAudio` (m4a mono 44,1 kHz), `sliceAudio`, `keyframes`, `silences` (silencedetect a -35 dB com `-hide_banner`, **nunca** `-v error`, que engole a saída), `palette`, `measureLayout` (port em TS do `.claude/skills/clonar-edicao/scripts/analisar_estrutura.py`: penhasco/argmin, nunca limiar absoluto; separa corte de layout de troca de conteúdo). Só caminhos locais, sem storage, sem regra de negócio.
**Aceite do port:** rodar o `.py` e o TS nos mesmos 3 vídeos do swipe local (`projects/mentoria-spy/**/referencias` ou `escalados`) e bater cortes (±0,1 s) e faixas (±2 px); registrar em `docs/render.md` (seção "medição"). Mídia de teste fora do git.
**Depois do 10/10:** `cutVideo`, templates `remix-*` e `RenderInput.regions`/`overlayClipUrl` (§6.3).
**Verificado por:** Jest com vídeos sintéticos gerados por ffmpeg + o aceite acima.

### Frontend (maquina-frontend) · pasta: `web/`
**F0 (já):** `tsc` do web quebrou com os tipos novos: `variation: null` nos mocks (`src/mocks/db.ts:283`, `src/mocks/fixtures.ts:67-71`, `src/mocks/handlers.ts:459`) e chaves i18n `settings.service.HIGGSFIELD`/`APIFY` (EN/PT) em `src/app/(app)/settings/page.tsx:113`.
**F4a (depois do mockup aprovado; até lá, só cliente e MSW):** cliente HTTP das rotas §4.1-4.3; Importar campeão (oferta existente ou nova; upload com barra de progresso seguindo `method/url/headers` do `POST /uploads`; link com o estado de `GET /champions/config` (indisponível = campo desligado com o motivo e a data de volta); checkbox de dono, só registro; preço da análise no botão); tela do campeão com polling de 2 s, checklist do job, player com os frames-chave numa linha do tempo, as 12 seções editáveis (autosave em `PATCH teardown`), correção de palavra da transcrição, falha com `action` (`upload_video`/`analyze_again`).
**F4b:** escolher variações (tipos × quantidade; indisponível com o motivo `NO_SPEECH`/`NOT_ENABLED`); revisão do plano (polling 1,5 s; editar gancho, tirar item, "Regerar este", elencos com 4 rostos e escolha, voz/fonte da voz/formato/edição do lote, estimativa, OK com `expectedCostUsd`, `BATCH_INCOMPLETE` apontando o que falta); progresso do lote (polling 5 s) com link pra cada criativo; selo de variação (`variation`) na Home, no trilho do criativo e na Biblioteca, com filtros novos.
**F4c:** MSW → API real.
**Verificado por:** `tsc`, `next build`, 1440 e 390 px com MSW, EN e PT.

### QA (maquina-qa) · pasta: `testes/`
**Q5-prep (já):** fixtures em `testes/fixtures/campeoes/` (geradas por script com ffmpeg, fora do git): com fala e split screen, sem áudio, 400 px de largura, truncado, 3 s (curto demais), > 200 MB simulado por `sizeBytes`. Casos a partir de `api.md` §18-20 e das máquinas do campeão e do lote (falham até o B4a/B4b).
**Q5 → F2-G2 (09/10):** contrato endpoint a endpoint; isolamento entre workspaces (upload, campeão, teardown, lote, elenco, rosto do elenco); transições inválidas = 409; travas de variação (`variation_locked`, `change_not_available`); `REUSE` (seguidoras ficam `READY` sem `cost_entry`); gatilhos de mock §4.6 (link indisponível síncrono, `AD_NOT_FOUND`, `AD_HAS_NO_VIDEO`, análise falha, item falha); confirmar que **nada** é recusado por `rights`. Navegador 1440/390: upload → teardown → lote com 1 Trocar avatar + 3 ganchos → 5 criativos renderizados.
**Q6 → F2-G4 (10/10, com ok do Gusta pro gasto ≈ US$ 2,30):** vídeo real do Gusta; folha de frames de cada peça; md5 do trecho de áudio original no Trocar avatar com voz original; corpo idêntico entre os ganchos (md5 dos clipes reaproveitados); legenda; custo real × estimativa.
**Verificado por:** saída do Playwright + screenshots lidos, relatório com comando e saída.

## 13. Manter a edição + take contínuo (06/10, noite)
Status: **proposto pelo arquiteto, a aplicar já** (decisão do Gusta de 06/10: prioridade única até 10/10, registrada em `decisions/log.md`). Este bloco **substitui** a §5.1 (talking head limpo como padrão), a §5.2 (Novos ganchos com Pruna + `REUSE`) e a §6.3 (regiões por cena). O que segue valendo do resto do doc: upload, análise, lote, elenco, estimativa, launch, travas.
Uma pendência é do Gusta: **D6** (como fazer os Novos ganchos, §13.4). Até ele responder, o time constrói a opção (a), que serve a qualquer resposta.

> ⚠️ **A API dev da porta 3001 está em MODO LIVE (o Gusta testa com dinheiro real).** Nenhum agente usa a 3001 nem o banco dela pra teste. Testes sobem a própria API em `INTEGRACOES_MODE=mock` (o harness do QA já trava 3000/3001); o frontend testa com MSW ou com uma API própria em outra porta, em mock. Sonda paga só com o valor avisado antes e o ok do Gusta.

### 13.0 Resumo em 5 linhas
1. A análise do campeão ganha uma etapa `mapping_edit`: detecção de rosto por frame (YuNet, score ≥ 0,8) + colunas/faixas medidas → **trilha do rosto** (em que célula do layout ele aparece, frame a frame); Claude com visão → **camadas de texto** (headline, legenda karaokê, texto da tela: caixa, estilo, fundo) + **perfil da pessoa** (genérico). Tudo vira o `EditMap` do teardown.
2. **Trocar avatar** = vídeo do campeão como base + o rosto novo (Soul V2 no aspecto da região, perfil parecido com o original) animado no Pruna com o **áudio original contínuo numa chamada só**, colado na região do rosto nos frames exatos; texto queimado que caía dentro da região é **redesenhado** por cima (mesmo estilo, tempos da transcrição). Áudio do campeão copiado sem recodificar.
3. **Novos ganchos** (opção (a), até 10/10) = vídeo do campeão intacto (duração, cortes, fala, karaokê); só o **texto do gancho** muda: a headline (ou o texto da tela) dos primeiros ~3 s é redesenhada sobre o próprio fundo dela. Custo de provedor ≈ US$ 0.
4. Composição num template Remotion novo, `remix-keep` (base + overlays + camadas redesenhadas), frame a frame na grade do campeão (mesma resolução, fps e nº de frames).
5. **Regra nova do produto inteiro (Gusta, 06/10): lipsync manda o áudio COMPLETO numa chamada só.** Nasce o `Take` (o clipe contínuo de lipsync do criativo); as cenas de lipsync viram **fatias** dele (`TAKE_SLICE`). Vale pro Trocar avatar, pro criativo do zero com motor LIPSYNC e pros ganchos com fala nova. Áudio > 600 s = erro explícito.

### 13.1 Trilha do rosto (onde está a pessoa, em que frames)
Dono: maquina-video (`api/src/medicao/`). Determinístico, sem provedor, roda também em mock.
1. **Células do layout.** `measureLayout` passa a medir **colunas também** (a mesma análise de variância no vídeo transposto, que estava marcada pós-10/10 e entra agora): cada segmento ganha `cells` = retângulos (px) formados por faixas × colunas. No caso de referência (`zap-working-late`): barra do topo, caixa do rosto `x 0-336, y 119-443`, câmera de segurança abaixo, tela do app à direita, faixa de baixo.
2. **Rostos por frame.** `detectFaces(videoPath, sampleFps = 5)`: YuNet (`face_detection_yunet_2023mar.onnx`, 230 KB, versionado em `api/src/medicao/modelos/`) via `onnxruntime-node` (dependência nova; o backend aprova no `api/package.json`). Mantém só detecções com **score ≥ 0,8** e escolhe por **score, nunca por área** (área pega falso rosto em planta). Devolve por amostra: `[{ box, score }]`.
3. **Montagem da trilha** (`faceTrack`, função pura): para cada segmento de layout, a célula que contém o centro do rosto em ≥ 80 % das amostras é a **região** (a célula inteira, não a caixa do rosto: é ela que o rosto novo ocupa). Célula = quadro inteiro → `fullFrame: true`. As bordas de cada trecho vêm em **número de frame** (`startFrame` inclusivo, `endFrame` exclusivo), refinadas em ±2 frames pelo pico de diferença da própria região (regra da casa: emenda por frame, nunca por segundo arredondado; segundo arredondado deixou 1-5 frames da pessoa original piscando no lote Kendall).
4. **Escala do rosto.** Cada trecho guarda `faceInRegion` (caixa mediana do rosto, relativa à região). Se a altura do rosto muda > 15 % dentro de um trecho (punch-in/zoom do original), o trecho é partido nos saltos e cada pedaço guarda a sua caixa; zoom contínuo vira passos de 5 amostras/s (interpolação linear). O render usa isso pra manter a mesma proporção rosto/região do original.
5. **Conferência.** `faceTrack` também conta rostos por amostra: ≥ 2 rostos com score ≥ 0,8 em > 10 % das amostras de um trecho = bloqueio `multiple_faces` nesse trecho.

### 13.2 Camadas de texto queimadas e perfil (Claude com visão)
Dono: maquina-ia (`ClaudeService.describeEdit`, chamada separada do `analyzeChampion` pra poder refazer sem reescrever o teardown). Entrada: os frames-chave já extraídos + recortes em resolução cheia das faixas candidatas a texto (até 6, lado maior 1024 px) + trilha do rosto + transcrição + **catálogo fechado de fontes** do `video/` (§13.6). Saída estruturada (`EditMapDraft`):
- `layers[]`: uma por camada de texto: `kind` (`headline` | `caption` | `text`), caixa aproximada (fração 0-1 do quadro), intervalo aproximado (s), `text` literal (headline/texto; a legenda não tem texto fixo: vem da transcrição), `background` (`solid` com a cor, `pill` com a cor, ou `none` = texto direto sobre o vídeo), estilo (`fontId` do catálogo, peso, caixa alta, cor, cor de destaque da palavra atual, contorno, sombra, alinhamento, tamanho relativo à altura do quadro, palavras por página no karaokê).
- `overlaysOverFace`: lista de elementos não-texto (painel, seta, figurinha) que aparecem **por cima** da região do rosto, com intervalo. Cada um vira bloqueio `overlay_over_face` até 10/10.
- `profile` (perfil da pessoa, pra o elenco parecido): gênero aparente, faixa de idade, etnia aparente, cabelo (estilo/cor em termos gerais), roupa, cenário, luz, enquadramento, pose. **Nunca** nome, @, tatuagem, cicatriz, marca única. Esta é a única mudança da §1.1: a descrição genérica passa a incluir etnia aparente e estilo, porque o padrão do Gusta é rosto novo **parecido com o perfil do original**. O rosto continua nascendo **só de texto** (Soul V2); frame do campeão continua sem entrar em modelo de geração (exceto na opção (b) da §13.4, que é decisão do Gusta).
**Refino por pixel (maquina-video, `layerPresence`)**: para cada camada, a caixa e o intervalo da visão são refinados no vídeo: caixa de `background: solid` = corrida de linhas/colunas de cor chapada (medida, não chutada); intervalo = frames em que o recorte da caixa bate com o frame de referência (diferença média, penhasco/argmin, nunca limiar absoluto). Legenda: intervalo = da 1ª à última palavra da transcrição, conferido nos frames-chave.
**Custo**: ~US$ 0,10-0,15 por campeão (6-16 imagens + texto curto). Entra na estimativa da análise (`analysisUsdPerSec` sobe; a ia recalcula).

### 13.3 Trocar avatar mantendo a edição (`SWAP_AVATAR`, `keepEdit: true`)
1. **Elenco.** `planVariations` escreve `castingDescription` a partir do `profile`: mesmo gênero, faixa de idade, etnia aparente, roupa, cenário, luz, enquadramento e pose do original; cada item é **outra pessoa** (traços individuais diferentes entre os itens; o usuário pode mudar o perfil, ex.: outra etnia, no elenco). Mesmo gênero da voz, sempre.
2. **Rosto no aspecto da região.** Aspecto-alvo = o da **maior** região da trilha (em área). O Soul V2 gera no aspecto suportado mais próximo (1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9), com o enquadramento do original ("do peito pra cima", "rosto ocupa ~X % da altura", vindo do `faceInRegion`). As outras regiões (ex.: tela cheia num trecho, caixa noutro) são **recortes do mesmo clipe**, centrados no rosto.
3. **Take único.** 1 `Take` `AUDIO_LIPSYNC` por criativo: o áudio original **da 1ª à última frame com rosto** (inclui os buracos em que o rosto some, pra o clipe ser contínuo), numa chamada Pruna (`seed` 7 na 1ª tentativa; `7 + attempt` ao regerar). Sem TRANSCRIBE: `words` = palavras do teardown (corrigidas pelo usuário) na janela. Piso de 2 s do Pruna; teto de 600 s = `LIPSYNC_AUDIO_TOO_LONG`.
4. **Encaixe.** Para cada trecho da trilha, `fitCrop` (função pura do `medicao`) calcula o recorte do clipe: rosto do clipe detectado pelo YuNet (score, ≥ 0,8, no clipe inteiro: também acha a 2ª pessoa que o Pruna inventa), escala tal que `altura do rosto / altura da região` = a do original, centrado no rosto, sempre cobrindo a região inteira (`cover`, sem barra). O clipe sai do Pruna a 24 fps com cauda: o render reamostra na grade do campeão e corta no frame exato.
5. **Camadas redesenhadas.** Toda camada de texto cuja caixa cai **inteira dentro** da região num trecho (ex.: legenda sobre o rosto em tela cheia) é redesenhada por cima do rosto novo naquele trecho, no estilo medido, com os tempos da transcrição. Camada fora da região fica como está no vídeo base (é o original, intacto). É reconstrução de verdade: o texto antigo some debaixo do rosto novo e o novo é desenhado, não recortado.
6. **Bloqueios até 10/10** (explícitos, com motivo e trecho; nada inventado): `multiple_faces` (2+ rostos), `no_face` (nenhum trecho com rosto), `caption_straddles_face` (texto metade dentro, metade fora da região: precisa apagar o texto fora da região, ver pós-10/10), `overlay_over_face` (painel/figurinha por cima do rosto), `low_confidence` (YuNet abaixo de 0,8 em > 20 % das amostras do trecho). Com bloqueio, `keepEdit` fica indisponível pro tipo com o motivo; o usuário pode escolher explicitamente o **talking head limpo** (`keepEdit: false`, o caminho v1 da §5.1, agora com take único).
7. **Áudio.** O render sai mudo e o `RenderService` remuxa o áudio do campeão com `-c:a copy` (o md5 do áudio decodificado da peça = o do campeão, conferência da esteira).
8. **Custo** (30 s com rosto o tempo todo): Pruna 30 × 0,025 = 0,75 + elenco 0,024 = **≈ US$ 0,78** por variação (igual à §7). Rosto só em 12 s (caixa some num trecho longo) cobra a janela da 1ª à última aparição.

### 13.4 Novos ganchos mantendo o corpo (`NEW_HOOKS`): opções pro Gusta (D6)
Regra: corpo do campeão intacto (frames, fala, duração, ritmo); muda só o gancho (~primeiros 3 s, até `hook.endSec`). O gancho tem que ser da **mesma pessoa e voz** do corpo.
| opção | o que muda | como | custo por gancho | riscos / limites |
|---|---|---|---|---|
| **(a) gancho escrito** | só o texto da tela no gancho (headline, ou o texto de tela do gancho) | camada `headline`/`text` do intervalo do gancho redesenhada **sobre o próprio fundo dela** (faixa chapada medida, `solid`/`pill`) com o texto novo; fala e karaokê originais | **≈ US$ 0** de provedor (plano ~0,03-0,05 por item, render em CPU) | texto direto sobre vídeo (`background: none`) não dá pra trocar sem apagar o antigo → bloqueio `hook_text_over_video` até haver apagador (pós-10/10). Headline fixa o vídeo todo: troca no intervalo inteiro dela (é a mesma camada, uma alavanca). Original sem texto no gancho: o texto entra como camada nova no estilo da legenda, no topo (avisado na tela). |
| (b) fala nova com a voz do original | texto falado dos ~3 s (+ texto da tela) | voz clonada do próprio áudio do campeão (WaveSpeed `wavespeed-ai/omnivoice/voice-clone` ou `qwen3-tts/voice-clone`: **US$ 0,005 por fala < 100 caracteres**, referência 3-15 s do corpo) + **lipsync vídeo-a-vídeo** na região do rosto do original só na janela do gancho (`sync/lipsync-2` US$ 0,05/s ≈ 0,20 por 4 s; o Pruna não serve, ele anima foto e o rosto "pularia" na emenda com o corpo) + apagar o karaokê antigo da janela (`bria/video-eraser/mask` US$ 0,05/s, até 5 s por chamada ≈ 0,20) + karaokê redesenhado | **≈ US$ 0,40-0,45** (preços das páginas em 06/10; sonda antes) | põe frame e voz da pessoa original em modelo de geração (muda a §1.1) e faz a pessoa real dizer o que não disse: a regra da casa só usa voz de terceiro se o usuário declarar que o criativo é dele → só com `rights: OWN`, o que **reabre a D1** ("nada é bloqueado por dono"). Fala nova presa à duração do gancho original ±10 % (`speed` do clone), pra o corpo começar no mesmo frame. 2-3 dias de trabalho (clone, lipsync v2v, apagador, máscara) |
| (c) gancho com o avatar novo | fala nova + rosto novo | só combinada com o Trocar avatar: take único do item = áudio do gancho novo (voz clonada ou do catálogo) + áudio original do corpo, numa chamada Pruna | ≈ US$ 0,78 por gancho (o corpo é relipsincado em cada item; o reuso de corpo da §5.2 deixa de existir com take contínuo) | são duas alavancas contra o campeão (rosto + gancho); o controle certo é o Trocar avatar com o gancho original. Herda os limites da (b) na voz. |
**Recomendação do arquiteto: (a) até 10/10** (custo zero, nenhum risco de voz/rosto de terceiro, cabe no prazo, serve de base pra (b) e (c)); **(b) logo depois do 10/10, só pra campeão `OWN`**, com sonda de ~US$ 0,50 antes; (c) depois, como opção do lote do Trocar avatar. **Decisão D6 do Gusta: pendente.**
No modo (a): o lote **não cria controle** (o próprio campeão é o controle); o item só carrega `hook.onScreenText` (o `speech` fica igual ao original e não é editável); o criativo nasce com 1 cena `SOURCE_CUT` cobrindo o campeão inteiro (clipe = o vídeo do campeão, sem provedor, US$ 0) e vai direto pro render `remix-keep`.

### 13.5 Take contínuo (regra nova do produto inteiro)
**Por quê:** lipsync cortado em trechos (1 chamada Pruna por cena ≤ 30 s) sai ruim (cada trecho recomeça da foto; a emenda aparece) e paga o arredondamento por trecho. Agora: **um TTS do roteiro inteiro → uma chamada Pruna → as cenas viram cortes de edição sobre o clipe contínuo**. O Pruna aceita até 600 s.
**Modelo:** `Take` = o clipe contínuo de lipsync do criativo, 1 por geração (`@@unique([creativeId, generation])`). Cenas de lipsync passam a ser `pipeline: TAKE_SLICE`, apontando pro take com `takeStartSec`/`takeEndSec` (fatia do clipe). `SCENE_VIDEO` (Kling/Seedance) e `SOURCE_CUT` não mudam. `TTS_LIPSYNC`, `AUDIO_LIPSYNC` e `REUSE` como pipeline de cena ficam **só pra criativos antigos** (leitura); nada novo nasce com eles.
| take | cadeia | words |
|---|---|---|
| `TTS_LIPSYNC` (criativo do zero, LIPSYNC; Trocar avatar limpo com voz do catálogo; gancho com fala nova) | `TTS` do texto inteiro (as falas dos blocos unidas, na ordem) → `LIPSYNC` (rosto + áudio inteiro) → `TRANSCRIBE` do take | do TRANSCRIBE, relativas ao início do take |
| `AUDIO_LIPSYNC` (Trocar avatar com áudio original) | trecho contínuo do áudio do campeão (`sliceAudio` de uma janela só) → `LIPSYNC` | do teardown, na janela, sem TRANSCRIBE |
**Fatiamento depois do take pronto** (`CatalogService.sliceTake`, função pura da ia, substitui o `splitScenes`/`splitSourceScenes` no lipsync): casa as palavras de cada bloco do roteiro com as palavras do take, em ordem; a fronteira entre a cena i e a i+1 fica **no meio do silêncio** entre a última palavra de uma e a primeira da outra; a 1ª cena começa em 0 e a última termina no fim do clipe. O backend grava `takeStartSec`/`takeEndSec` e `startSec`/`endSec` reais nas cenas, `words` fatiadas (relativas ao início da cena), miniatura no meio da fatia, e marca as fatias `READY` juntas. Bloco sem palavra casada (Whisper errou) = fronteira proporcional ao nº de caracteres, com aviso no log; nunca falha a cena por isso.
**Status:** as fatias espelham o take (`QUEUED` → `GENERATING` com o progresso do take → `READY`/`FAILED` com o `errorCode` do take). O SSE emite `take.updated` e um `scene.updated` por fatia.
**Limites:** áudio do take > **600 s** = `422 LIPSYNC_AUDIO_TOO_LONG` `{ durationSec, maxSec: 600 }` no `generate`/`launch` (duração estimada pelas palavras/min do idioma) e `FAILED` com o mesmo código se o TTS real passar. < 2 s: piso do Pruna (já existe).
**Estimativa:** `CatalogService.estimate` cobra por **take**: TTS = caracteres do texto inteiro; LIPSYNC = `ceil(segundos do take) × 0,025` **uma vez**; TRANSCRIBE = `ceil(segundos) × 0,002` uma vez (não em `AUDIO_LIPSYNC`). Sai mais barato que por cena (um arredondamento só).
**Regerar:**
- "Refazer cena" numa fatia (`POST /creatives/:id/scenes/:index/regenerate` ou `changes` `SCENE`) **regera o take inteiro** (o clipe é um só): `409 INVALID_STATE` `{ reason: 'regenerate_take', takeId, estimateUsd }` se vier sem `confirm: true` + `expectedCostUsd`; com eles, nova tentativa (`attempt + 1`, `seed` novo), todas as fatias voltam a `GENERATING`. `changeOptions` mostra `SCENE` com o custo do take inteiro.
- `changes` `LINE` (fala nova numa cena) no `TTS_LIPSYNC` = TTS do texto inteiro de novo + take novo (custo do take inteiro, mesma confirmação). No `AUDIO_LIPSYNC` continua indisponível.
- Mexer só no corte (onde uma cena começa/termina) ou no texto da tela = **re-edição**, sem provedor: `PATCH /creatives/:id/edit` + render. Não existe "regerar uma fatia" sozinha.
- Rota nova: `POST /creatives/:id/take/regenerate` `{ expectedCostUsd, note? }` → `202 Take` (a mesma ação, chamada pelo botão "Refazer o clipe" da tela de geração).
**Risco honesto:** clipe longo dá mais chance de o Pruna trocar de pessoa no meio (memória da casa, ~15 % no podcast; o lote `zap-working-late` saiu limpo com 30 s numa chamada). Mitigação: prompt de identidade travada que já existe + a conferência do QA (YuNet no clipe inteiro, 1 rosto por frame, folha de frames a cada 2 s) + "Refazer o clipe" com seed novo.

### 13.6 Render `remix-keep` (maquina-video)
`RenderInput` vira união discriminada: `ScratchRenderInput` (o de hoje, com `scenes[].clipStartSec` novo pra fatia de take) e `RemixKeepRenderInput`. Substitui a proposta da §6.3.
```ts
interface Rect { x: number; y: number; w: number; h: number }            // px na grade do campeão
interface RemixKeepRenderInput {
  renderId: string; templateId: 'remix-keep'; kind: 'remix-keep';
  canvas: { width: number; height: number; fps: number; frameCount: number };  // = campeão (sem reescalar pra 1080)
  baseVideoUrl: string;                                // vídeo do campeão (fundo de tudo)
  audioPassthroughUrl: string;                         // render sai mudo; remux com -c:a copy deste arquivo
  overlays: { startFrame: number; endFrame: number; region: Rect;          // [start, end) na grade do campeão
              clipUrl: string; clipOffsetSec: number;                      // instante do clipe no startFrame
              crop: Rect }[];                                              // px do clipe (fitCrop), escalado pra region
  textLayers: { id: string; startFrame: number; endFrame: number; box: Rect;
                background: { kind: 'solid'|'pill'|'none'; color: string|null; box: Rect|null };   // solid/pill: pinta a caixa inteira antes do texto; color = hex OU 'linear-gradient(...)' CSS (barra degradê)
                style: TextStyle;
                content: { kind: 'static'; text: string }
                       | { kind: 'karaoke'; words: { word: string; startFrame: number; endFrame: number }[]; wordsPerPage: number } }[];
}
```
Ordem de pintura: base → overlays → `textLayers` (fundo da camada, depois o texto). Fontes: o catálogo (`FONT_CATALOG` exportado pelo `video/`, ids estáveis) cresce de Inter/Montserrat pra cobrir os estilos de anúncio: Montserrat 800/900, Inter 800, **Anton, Oswald 700, Bebas Neue, Archivo Black, Poppins 800, Roboto Condensed 700** (`@fontsource`, empacotadas, sem rede). `templates()` lista `remix-keep` com `kind: 'remix'` (não aparece na escolha de template do criativo do zero). Saída: mesma largura/altura/fps/nº de frames do campeão; o pós-processo remuxa o áudio e confere `nb_frames`.

### 13.7 Contrato: o que muda
**Schema** (migração `20261006200000_keep_edit_take`, aplicada nos bancos locais `maquina` e `maquina_test` com `guard-db`):
- `teardowns.edit_map jsonb NULL` (`EditMap`; nulo = campeão analisado antes desta etapa → `keepEdit` indisponível com `not_mapped` e "Analyze again").
- `enum TakeKind { TTS_LIPSYNC AUDIO_LIPSYNC }`; tabela `takes` (id, workspace, creative, generation, kind, status `AssetStatus`, progress, attempt, seed, speech, source_start_sec/source_end_sec, duration_sec, audio_file_id, clip_file_id, thumbnail_file_id, words, error_code, fail_reason, stale, started_at, ready_at; `UNIQUE(creative_id, generation)`).
- `ScenePipeline` + `TAKE_SLICE`; `scenes.take_id`, `take_start_sec`, `take_end_sec`.
- `provider_tasks.take_id` (TTS, LIPSYNC e TRANSCRIBE do take apontam pro take, não pra cena).
- `cost_entries` sem mudança (custo do take entra no criativo).
**Tipos** (`@maquina/contratos`, fim do arquivo): `Rect`, `TextStyle`, `FontId`, `FaceTrackSegment`, `EditLayer`, `PersonProfile`, `KeepEditBlocker`, `KeepEditAvailability`, `EditMap`, `HookMode`, `Take`, `RegenerateTakeBody`; `Teardown.editMap`; `ChampionDetail.keepEdit`; `BatchSettings.keepEdit` + `hookMode`; `ScenePipeline` + `TAKE_SLICE`; `Scene.take`; `CreativeDetail.take`; erros `KEEP_EDIT_UNSUPPORTED` e `LIPSYNC_AUDIO_TOO_LONG`; `INVALID_STATE.reason` + `'regenerate_take'`; `UploadWarning`/estimativa sem mudança.
**API** (`api.md` §19-20 e §10):
- `GET /champions/:id`: `teardown.editMap` e `keepEdit: { SWAP_AVATAR: KeepEditAvailability; NEW_HOOKS: KeepEditAvailability }` (`{ available, blockers: [{ reason, startSec, endSec }] }`).
- Checklist do `CHAMPION_ANALYZE`: `reading_video → extracting_audio → transcribing → measuring → mapping_edit → diagnosing`.
- `POST /champions/:id/batches` e `PATCH …/settings`: `settings.keepEdit` (padrão `true` quando disponível) e `settings.hookMode: 'TEXT'` (único aceito até D6). `keepEdit: true` com bloqueio = `422 KEEP_EDIT_UNSUPPORTED { kind, blockers }`. Em `keepEdit` o Trocar avatar força `voiceSource: CHAMPION_AUDIO` (voz do catálogo mudaria os tempos da legenda queimada) e `format` = do campeão.
- `PATCH …/items/:itemId` no `NEW_HOOKS` com `hookMode: TEXT`: só `hook.onScreenText` (`speech` = 400).
- Estimativa: em `keepEdit`, `SWAP_AVATAR` = 1 take `AUDIO_LIPSYNC` + elenco; `NEW_HOOKS` `TEXT` = US$ 0 de geração. `savedByReuseUsd` fica 0.
- Criativo: `GET /creatives/:id` e `/scenes` trazem `take`; `POST /creatives/:id/take/regenerate`; cena `TAKE_SLICE` no `regenerate` = `409 regenerate_take` sem `confirm`. Edit de criativo `remix-keep`: `GET …/edit` devolve `templateId: 'remix-keep'` e o `PATCH …/edit` é `409 variation_locked` (a edição é a do campeão).
**Eventos:** SSE `take.updated` (`Take` + `summary`). Cadeia: `TTS → LIPSYNC → TRANSCRIBE` **por take** (não por cena); `AUDIO_LIPSYNC` = `LIPSYNC → READY`. Polling sem mudança.
**Interfaces internas:** `medicao`: `measureLayout` com `cells`; `detectFaces(videoPath|imagePath, sampleFps)`; `faceTrack(...)`; `layerPresence(videoPath, box, refAtSec)`; `fitCrop(...)`. `integracoes`: `describeEdit`; `planVariations` com `profile` e `hookMode`; `sliceTake`; `estimate` por take; `submitLipsync` aceita `seed`. `render`: `RemixKeepRenderInput`, `FONT_CATALOG`, remux de áudio.

### 13.8 Plano por agente (até 10/10)
⚠️ **Porta 3001 = API LIVE do Gusta. Proibido usar.** Testes: API própria em mock (o harness do QA trava 3000/3001); frontend com MSW ou API própria em outra porta, em mock. Nenhuma chamada paga sem o valor avisado e o ok do Gusta.
| id | agente | pasta | tarefa | depende de | pronto quando |
|---|---|---|---|---|---|
| A4 | arquiteto | `docs/`, `contratos/`, `api/prisma/` | este §13, tipos, migração aplicada local | — | **feito 06/10** (`prisma validate`, migração em `maquina` e `maquina_test`, `tsc` do pacote) |
| V4a | video | `api/src/medicao/` | colunas + `cells` no `measureLayout`; `detectFaces` (YuNet ONNX, score ≥ 0,8, por score); `faceTrack` (frames, escala, contagem de rostos); `layerPresence`; `fitCrop` | A4 | Jest com vídeo sintético (rosto Soul nosso colado numa caixa por ffmpeg) + a trilha do `zap-working-late` batendo `x 0-336, y 119-443` ±2 px e bordas ±1 frame |
| V4b | video | `video/`, `api/src/render/` | template `remix-keep` (§13.6, encode crf ≤ 18), fontes do catálogo, `RenderInput` em união, `clipStartSec` no scratch, remux `-c:a copy`, conferência de `nb_frames` (aceite §13.10) | A4 (começa já com um `EditMap` escrito à mão do caso `zap-working-late`) | render local do caso de referência com um rosto Soul nosso: tira de frames + md5 do áudio decodificado = original |
| I5 | ia | `api/src/integracoes/` | `describeEdit` (+ mock determinístico com 1 headline `solid` e 1 karaokê); `planVariations` com `profile` (elenco parecido) e `hookMode: TEXT`; `sliceTake`; `estimate` por take e `keepEdit`; `submitLipsync` com `seed`; mock de lipsync devolve a imagem do rosto em loop com a duração do áudio (pra o YuNet achar rosto) | A4 | Jest; sonda `describeEdit` no vídeo de referência (~US$ 0,12, avisada) |
| B5 | backend | `api/src/` (menos as 3 acima) | etapa `mapping_edit` no job (V4a + I5 → `EditMap` + bloqueios, regra de produto no `campeoes/`); `keepEdit` no detalhe; settings/422; **take**: orquestrador por take (`TTS→LIPSYNC→TRANSCRIBE` e `AUDIO_LIPSYNC`), fatias `TAKE_SLICE` via `sliceTake`, `take.updated`, `take/regenerate`, `409 regenerate_take`, `LIPSYNC_AUDIO_TOO_LONG`; launch por modo (SWAP keep = take; NEW_HOOKS TEXT = 1 `SOURCE_CUT`); montar `RemixKeepRenderInput`; travas de edição | A4; V4a/I5 pelo contrato e mock | Jest: fatiamento, regerar take, launch nos 2 modos, bloqueios; `tsc` limpo |
| F5 | frontend | `web/` | campeão: camada "edição mapeada" sobre os frames-chave (região do rosto, caixas de texto) + disponibilidade com motivo; lote: "Manter a edição" (ligado por padrão, desligado com o motivo), ganchos só com texto da tela; geração: "Refazer o clipe (US$ x)" no lugar de "Refazer cena" em lipsync, com confirmação; edição travada no `remix-keep` | A4 | `tsc`, `next build`, 1440/390 com MSW, EN e PT |
| Q7 | qa | `testes/` | fixtures (caixa com rosto Soul nosso + painel + headline em faixa chapada + karaokê; variante tela cheia/caixa; variante 2 rostos; variante legenda cruzando a região); casos: trilha, bloqueios, take único (1 LIPSYNC por criativo nas `provider_tasks`), regerar take, NEW_HOOKS TEXT custo 0; peça: nº de frames = campeão, md5 do áudio = campeão, fora da região PSNR ≥ 40 dB contra o campeão, dentro da região **diferente** do campeão em todo frame da trilha (pega o original "piscando"), 1 rosto por frame (YuNet) | B5, F5 | Playwright + saída dos comandos → **F2-G2b (09/10)** |
| Q8 | qa + Gusta | — | **F2-G4b**: o campeão do Gusta (`zap-working-late-v2-latino.mp4`): 1 Trocar avatar mantendo a edição (~US$ 0,78) + 3 ganchos escritos (~US$ 0,15 de plano) + análise de novo (~US$ 0,45) ≈ **US$ 1,40**, estimativa na tela antes | F2-G2b + ok do Gusta | Gusta aprova as peças (10/10) |
**Paralelismo:** 07/10 V4a, V4b, I5, B5 (take primeiro: é independente do mapa), F5 em paralelo; Q7 prepara fixtures. 08/10 integração (B5 consome V4a/I5 reais). 09/10 Q7 → F2-G2b. 10/10 Q8.
**Corta se apertar (nesta ordem):** escala por zoom do original (fica escala fixa por trecho) → refino por pixel das caixas `pill` (fica só `solid`) → fontes extras além de Montserrat/Anton/Oswald. **Fica pra depois do 10/10, com bloqueio explícito até lá:** `caption_straddles_face` e `hook_text_over_video` (precisam do apagador `bria/video-eraser/mask`, US$ 0,05/s, ≤ 5 s por chamada), `overlay_over_face` (recompor painel como elemento próprio), opções (b) e (c) dos ganchos (D6), escolha de fonte por largura medida.
**Não corta:** take único, trilha por frame com YuNet por score, áudio original copiado, bloqueio explícito em vez de peça inventada.
**Quebras de compilação deixadas pelo A4 (conferidas com `tsc` em 06/10), a primeira coisa de cada dono:**
- backend (`api/`): `campeoes/champion-views.ts:112,142` (`keepEdit`, `editMap`), `criativos/views.ts:173,236` (`take` no `CreativeDetail` e no `Scene`), `common/errors/error-codes.ts:73` e `common/errors/falhas.ts:13` (2 códigos novos), `variacoes/plano.ts:50` e `variacoes/variacoes.service.ts:131` (`keepEdit`/`hookMode` nas settings). Cliente Prisma já regenerado.
- frontend (`web/`): `src/mocks/db.ts:83,305` e `src/mocks/variar.ts:255,294,326` (mesmos campos nos mocks).
- O criativo do zero com motor LIPSYNC também muda (take único): é parte do B5 e do Q7, não é só feature 2.

### 13.9 Assinaturas da ia (cópia de `api/src/integracoes/contrato.ts`, 06/10 noite)
Escritas pela maquina-ia e aceitas pelo arquiteto. Fonte da verdade = o `contrato.ts`; mudou lá, recopiar aqui. Novidade: `DescribeEditInput.notes` (notas do campeão; só o mock lê os gatilhos `[mock:keep-straddle]`, `[mock:keep-overlay]`, `[mock:hook-over-video]`).
```ts
// ClaudeService (§13)
  /** §13.2: camadas de texto queimadas + elementos por cima do rosto + perfil genérico da pessoa (Claude com visão).
   *  Chamada separada do analyzeChampion (refazer sem reescrever o teardown). Saída já na grade do campeão (px, frames),
   *  `source: 'vision'`; o refino por pixel (layerPresence, maquina-video) vem depois. Legenda: intervalo = 1ª-última
   *  palavra da transcrição. Grava cost_entry (LLM) no campeão. Erros: SAFETY_BLOCK, RATE_LIMITED, PROVIDER_*. */
  describeEdit(i: DescribeEditInput): Promise<EditMapDraft & Usage>;

// ---------- §13.2: describeEdit ----------
export interface DescribeEditInput {
  workspaceId: string; championId: string; jobId: string;
  video: { width: number; height: number; fps: number; frameCount: number; durationSec: number };
  /** os frames-chave do teardown (até 16, lado maior 768 px) */
  keyframes: { atSec: number; reason: string; url: string }[];
  /** recortes em resolução cheia das faixas candidatas a texto (até 6, lado maior 1024 px); `box` em px do campeão */
  textCrops: { atSec: number; box: Rect; url: string }[];
  /** trilha do rosto (medicao.faceTrack); pode vir vazia */
  faceTrack: FaceTrackSegment[];
  transcript: { language: string; words: TranscriptWord[] };
  /** notas do CAMPEÃO: só o mock lê (gatilhos [mock:keep-straddle] / [mock:keep-overlay] / [mock:hook-over-video]) */
  notes?: string | null;
}
/** O que entra no EditMap vindo da visão (o resto do EditMap é da medicao/backend). */
export type EditMapDraft = Pick<EditMap, 'layers' | 'overlaysOverFace' | 'profile'>;

// ---------- §13.5: take contínuo ----------
/** Fatia do take = cena TAKE_SLICE. Tempos em s RELATIVOS ao início do take; words relativas ao início da fatia. */
export interface TakeSlice {
  index: number; label: string; takeStartSec: number; takeEndSec: number; speech: string; words: TranscriptWord[];
  /** false = nenhuma palavra do bloco casou com o take: fronteira proporcional aos caracteres (logar, nunca falhar) */
  matched: boolean;
}

// planVariations: parâmetros novos (§13)
      /** §13: mapa da edição do campeão (teardown.editMap). Dá o `profile` (elenco parecido com o original) e a camada de
       *  texto do gancho (tamanho máximo do texto novo). null/ausente = elenco pelo formato (v1) e gancho sem camada. */
      editMap?: EditMap|null;
      /** §13.4: 'TEXT' = só o texto da tela do gancho muda (speech = fala original, sem elenco compartilhado).
       *  Ausente = comportamento anterior (gancho falado). Só 'TEXT' é aceito até a D6. */
      hookMode?: HookMode },

// CatalogService (§13)
  /** …
   *  §13.5: lipsync cobra por TAKE (um arredondamento só): sem `pipelines` com engine LIPSYNC = 1 take TTS_LIPSYNC com as
   *  falas unidas; cenas TAKE_SLICE somam num take só, do tipo `take.kind` (padrão TTS_LIPSYNC). AUDIO_LIPSYNC = só LIPSYNC
   *  de `take.audioSec` (segundos reais da janela). Nunca lança por > 600 s: o 422 é do backend (use takeSecondsFor). */
  estimate(input: { engine: 'SCENES'|'LIPSYNC'; model: string; scenes: SceneDraft[]; format: VideoFormat; voiceId?: string; faceDescription?: string; faceCount?: number;
                    pipelines?: ScenePipeline[]; audioSecByScene?: number[];
                    take?: { kind: TakeKind; audioSec?: number; wordsPerSec?: number } }):
    { costUsd: number; etaSec: number; lines: { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }[]; warnings: 'voice_gender_mismatch'[] };

  /** §13.5: depois do take pronto, casa as palavras de cada bloco (na ordem) com as do take; fronteira no meio do
   *  silêncio entre a última palavra de um bloco e a 1ª do seguinte; 1ª fatia começa em 0, última termina em durationSec.
   *  `words` = TRANSCRIBE do take (TTS_LIPSYNC) ou teardown na janela, relativas ao início do take (AUDIO_LIPSYNC). Puro. */
  sliceTake(i: { blocks: { label: string; speech: string }[]; words: TranscriptWord[]; durationSec: number }): TakeSlice[];
  /** §13.3: aspecto do Soul V2 mais perto da região do rosto (1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9). */
  faceAspectFor(width: number, height: number): FaceAspect;
}
export type FaceAspect = '1:1' | '3:4' | '4:3' | '2:3' | '3:2' | '9:16' | '16:9';
/** §13.5: teto do Pruna por chamada. Acima = LIPSYNC_AUDIO_TOO_LONG { durationSec, maxSec: 600 }. */
export const TAKE_MAX_SEC = 600;

// GenerationService (§13)
  /** §13.3: aspectRatio = o da região do rosto (CatalogService.faceAspectFor). Ausente = 9:16 (v1). */
  submitFace(i: { workspaceId: string; faceId: string; description: string; language: string; aspectRatio?: FaceAspect }): Promise<Submitted>;

  /** §13.5: sceneId OU takeId (take = texto inteiro, até 10 mil caracteres da MiniMax → INVALID_SCRIPT). */
  submitTts(i: { workspaceId: string; sceneId?: string; takeId?: string; voiceId: string; text: string; language: string }): Promise<Submitted>;
  /** §13.5: sceneId OU takeId; seed (padrão 7; o backend manda 7 + attempt ao regerar). Áudio > 600 s = LIPSYNC_AUDIO_TOO_LONG. */
  submitLipsync(i: { workspaceId: string; sceneId?: string; takeId?: string; faceImageUrl: string; audioUrl: string; visualPrompt: string; format: VideoFormat; seed?: number }): Promise<Submitted>;
  /** feature 2: generalizado: sceneId OU championId OU takeId (§13.5); language opcional (campeão = detecção automática). */
  submitTranscribe(i: { workspaceId: string; sceneId?: string; championId?: string; takeId?: string; mediaUrl: string; language?: string }): Promise<Submitted>;
```

### 13.10 Aceite das peças (decisão do coordenador, 06/10)
Vale pro Trocar avatar e pros Novos ganchos mantendo a edição (Q7/Q8):
- **Áudio md5-idêntico** ao do campeão (áudio decodificado; o remux é `-c:a copy`).
- **Mesma contagem de frames** do campeão (`nb_frames`), mesma largura/altura/fps.
- **PSNR ≥ 40 dB fora da região alterada** contra o campeão (região alterada = região do rosto nos trechos da trilha, ou a caixa da camada redesenhada no intervalo dela). Dentro da região do rosto, o frame tem que ser **diferente** do campeão em todo frame da trilha.
- **md5 do vídeo não é critério** (o render recodifica). `remix-keep` encoda com **crf ≤ 18** (`libx264`, `yuv420p`), pra o PSNR fora da região passar com folga.

- **Atualização 06/10 (video):** `EditLayer.background.color` aceita hex **ou** `linear-gradient(...)` CSS (a barra do `zap-working-late` é degradê); o refino por pixel mede o degradê em vez de forçar cor chapada. Modelo YuNet sai no build pelo `assets` do `api/nest-cli.json` (`medicao/modelos/*.onnx` → `dist`); `onnxruntime-node` 1.30.0 no `api/package.json` (backend).

### 13.11 Decisões do arquiteto na revisão do B5 (06/10 noite)
1. **`Scene.pipeline` entra no contrato**: `pipeline: ScenePipeline` em `Scene` (todas as rotas e o SSE `scene.updated`), valor literal do enum do banco (`SCENE_VIDEO` | `TTS_LIPSYNC` | `AUDIO_LIPSYNC` | `SOURCE_CUT` | `REUSE` | `TAKE_SLICE`). O web decide a ação por ele: `TAKE_SLICE` = "Refazer o clipe (US$ x)" com `take.regenerateEstimateUsd`; `SOURCE_CUT` e `REUSE` = sem refazer; os demais = "Refazer cena" v1.
2. **Confirmado (a):** `NEW_HOOKS` com `keepEdit: false` segue o caminho falado (gancho + corpo com o elenco compartilhado), **já em take único por item** (§13.5), como alternativa explícita: o padrão é `keepEdit: true` quando disponível, e quando não está (`not_mapped`, bloqueios) a tela mostra o motivo e a opção "Analyze again" antes de cair no falado. Nada de cair no falado em silêncio.
3. **Confirmado (b):** `changes` `SCENE`/`LINE` refaz o take sem confirmação extra, porque o `changeOptions[].estimateUsd` já mostra na tela o custo do take inteiro antes do clique. Continua valendo o teto do mês (`SPEND_CAP_EXCEEDED`). A confirmação `confirm` + `expectedCostUsd` fica nas rotas diretas (`scenes/:index/regenerate` em `TAKE_SLICE` e `take/regenerate`).
4. **Revertido (c):** o backend não importa caminho interno da ia (`../integracoes/catalogo/take`). A ia reexporta a função pura no ponto de entrada (`api/src/integracoes/index.ts`: `export { takeSecondsFor } from './catalogo/take'`, assinatura `takeSecondsFor(text: string, wordsPerSec?: number): number`, ao lado de `TAKE_MAX_SEC`) e o backend importa de `'../integracoes'`.
5. **Custo da análise live:** toda análise de campeão agora paga também o `describeEdit` (~US$ 0,10-0,15 por campeão, Claude com 6-16 imagens). Análise de 30 s passa de ~US$ 0,30 para **~US$ 0,40-0,45**; o `estimateAnalysis`/`analysisUsdPerSec` (ia) tem que incluir esse fixo, pra o preço no botão "Analyze" bater. O teste real do 10/10 (Q8) já conta com isso (≈ US$ 1,40).

### 13.12 Avatar principal e outros rostos (06/10 noite, revisão do B5)
`EditMap` ganha `mainSpeaker?: { box: Rect; description } | null` (dica da visão: quem fala pra câmera) e `otherFaces?: [{ startFrame, endFrame, box: Rect|null, where }]` (b-roll, CCTV, telas, painel vizinho; só informativo). Opcionais: mapas gravados antes não têm.
Regras (substituem o que conflitar na §13.1 item 5 e na §13.3 item 6):
- **Avatar principal** = a trilha de rosto mais persistente (mais frames) e, no empate, a maior; trecho cujo rosto cai dentro de `mainSpeaker.box` vence (a visão é dica, a medição decide). Só o principal é trocado; `profile` descreve só ele.
- **Outros rostos não bloqueiam**: rosto em b-roll, câmera de segurança, tela de app, foto ou outro painel de split screen vai pra `otherFaces` e fica como está no vídeo base. `multiple_faces` só vale com 2+ rostos **persistentes dentro da mesma caixa** do avatar principal (confirmado pelo coordenador em 06/10; é o que o video implementou).
- **`overlay_over_face` só bloqueia** se o elemento cobre a caixa do rosto do principal em **≥ 20 % dos frames** do trecho; painel vizinho (split screen) nunca bloqueia.

### 13.13 Quantidade de rostos e elenco diverso (07/10, decisão do Gusta)
Substitui o padrão "parecido com o perfil do original" da §13.3 item 1, que vira a opção `MATCH_ORIGINAL`.

**1. Quantidade de rostos (1-4), em toda geração de rosto.**
- `POST /creatives/:id/faces/generate` `{ description, count?: 1|2|3|4 }`, padrão **4** (comportamento atual).
- `POST /variation-batches/:id/castings/:castingId/faces/generate` `{ description, count?: 1|2|3|4 }`, padrão **1**.
- Saída `{ batch, faces: Face[count] }`; posições `0..count-1` no lote de rostos (o `@@unique([…, batch, position])` não muda). `count` fora de 1-4 = 400.
- Preço na tela = `count × faceUnitPriceUsd`. `faceUnitPriceUsd` (= `CatalogService.estimateFaces(1)`, Soul V2) vem em `GET /creatives/:id/faces` e no `VariationBatch`. "Mais N rostos" manda o mesmo `count` da última geração. Spend cap checado com `count × preço`.
- Tipos: `FaceCount`, `GenerateFacesBody.count`, `GenerateCastingFacesBody`, `FacesResponse.faceUnitPriceUsd`.

**2. Elenco diverso por padrão nas variações.**
- Lote ganha `castingStyle: 'DIVERSE' | 'MATCH_ORIGINAL'` (coluna `variation_batches.casting_style`, enum `CastingStyle`, padrão `DIVERSE`; lotes anteriores a 07/10 ficaram `MATCH_ORIGINAL`). Entra em `CreateBatchBody` e `ReplanBatchBody` (omitido no replan = mantém); sai em `VariationBatch.castingStyle`. Não está em `BatchSettings`: trocar depois do plano exige `replan`.
- **DIVERSE:** cada elenco do lote é marcadamente diferente dos outros elencos do mesmo lote **e** da pessoa do original. Eixos que o `planVariations` distribui entre os elencos (sem repetir combinação): etnia aparente (negro, asiático do leste, sul-asiático, latino, branco, árabe/médio-oriental, indígena…), idade dentro da faixa plausível pro público da oferta, cabelo (cor, comprimento, textura), cor dos olhos, tatuagens visíveis, piercings, barba/sem barba, estilo de roupa e cenário. Luz, enquadramento e pose seguem o original (a edição mantida depende disso).
- **MATCH_ORIGINAL:** comportamento de 06/10 (§13.3 item 1): mesmo perfil do original, outra pessoa.
- **Restrição nos dois modos:** `SWAP_AVATAR` com voz original (`CHAMPION_AUDIO`, sempre em `keepEdit`) → gênero aparente = gênero da voz/`profile` do original; o resto varia. Nada de pessoa real identificável (nem famoso, nem "parecido com X"); nunca descrever traço identificável da pessoa do campeão.
- **Contrato interno (ia, `api/src/integracoes/contrato.ts`):** `planVariations` recebe `castingStyle: CastingStyle` e `castingGender: 'female'|'male'|null` (o backend preenche pelo `profile`/voz quando houver `SWAP_AVATAR` com `CHAMPION_AUDIO`). Em `DIVERSE` o Claude escreve todas as `castingDescription` do lote numa chamada só (ou passa as já escritas pras seguintes), pra garantir que nenhum eixo se repita; a `sharedCastingDescription` (NEW_HOOKS/COPY_NEW) também é diferente do original.
- **Donos:** arquiteto (feito: schema, migração `20261007000000_casting_style` aplicada em `maquina` e `maquina_test`, `@maquina/contratos`, `api.md`); backend (DTOs, padrões de `count`, coluna no create/replan, `faceUnitPriceUsd` nas respostas, repassar `castingStyle`/`castingGender`); ia (assinatura e prompt do `planVariations`); frontend (seletor 1-4 com preço nos dois lugares, "Mais N rostos", seletor Diverso/Parecido com o original no "escolher variações", padrão Diverso).

### 13.14 Trechos do avatar principal: formato podcast (07/10, caso do Gusta)
Caso: podcast/entrevista em que a câmera alterna entre o avatar principal e outra pessoa (ou b-roll). Antes, o rosto da outra pessoa contava como bloqueio ou entrava no take.
- `FaceTrackSegment.role?: 'main' | 'other_person' | 'broll'`. Ausente = `'main'` (mapas gravados antes continuam valendo). Quem marca é a medição (video), usando a regra do avatar principal da §13.12.
- **Bloqueios** (`overlay_over_face`, `multiple_faces`, `low_confidence`) só contam dentro dos trechos `main`, recortados nas bordas do trecho. Fora deles nada bloqueia.
- **Sem nenhum trecho `main`** = `no_face`.
- **Take `AUDIO_LIPSYNC`**: vai do início do 1º trecho `main` até o fim do último trecho `main` (inclui o que fica no meio; a fatia de cada cena sai desse take).
- **Render `remix-keep`**: aplica o rosto novo só nos frames `main`. Trechos `other_person` e `broll` e o que está fora de qualquer trecho saem iguais ao original.
- **Linha do tempo:** `FaceTrackResult.timeline` (medição) = `EditMap.timeline?: FaceTimelineSpan[]` (`{ startFrame, endFrame, kind: 'main' | 'other_person' | 'broll' }`), contígua de 0 a `frameCount`. Ausente em mapas antigos: tudo que está em `faceTrack` é main.
- **Identidade do avatar principal (SFace, 08/10):** a medição usa YuNet (detecção) + SFace (`face_recognition_sface_2021dec.onnx`, OpenCV Zoo, Apache-2.0, 37 MB) pra saber se o rosto do trecho é o mesmo do principal. YuNet (230 KB) fica versionado; SFace fica fora do git e é baixado com sha256 por `api/src/medicao/modelos/baixar.sh`, que roda no `prebuild` da api (todo `npm run build -w api`, inclusive no Docker). Sem o modelo, a trilha cai pra posição/tamanho (sem identidade). `nest-cli.json` copia `medicao/modelos/*.onnx` pro `dist`.
- Donos: video (medição marca `role` e `timeline`, bloqueios por trecho, render), backend (janela do take), ia (sem mudança).


### 13.15 Trocar avatar com motor Kling 3.0 / Seedance 2.0, mantendo a edição (08/10, decisão do Gusta)
Status: **proposto pelo arquiteto, aguarda o ok do Gusta pra código.** Decisão de origem: `decisions/log.md` 08/10. Não muda nada do caminho Lipsync (Pruna, take único, §13.3/§13.5), que segue padrão.
> ⚠️ 3001 LIVE. Schema e migração `20261008120000_swap_engine` escritos (só aditiva); **migração ainda não aplicada** (o classificador de permissão barrou o `npm run db:migrate`; roda o Gusta ou libera). Tipos em `contratos/src/troca-motor.ts`, **ainda não exportados**: editar `contratos/src/index.ts` reinicia a API da 3001 (nest --watch; conferido 08/10). As 8 edições do index (§13.15.9) e o `prisma generate` entram na janela de reinício que o Gusta liberar.

#### 13.15.0 Resumo em 5 linhas
1. O lote ganha `settings.swapEngine: 'LIPSYNC' | 'KLING' | 'SEEDANCE'` (padrão `LIPSYNC`) e o `voiceSource` ganha `'ENGINE_VOICE'`. Kling/Seedance exigem `keepEdit: true`: só a região do rosto nos trechos `main` muda (§13.14).
2. Unidade de geração = **trecho main** (span `main` contíguo da `EditMap.timeline`) → 1 cena `pipeline: 'SWAP_VIDEO'`. Trecho > janela máxima vira janelas ≤ 15 s cortadas **no meio de um silêncio**, geradas em sequência (a janela k+1 parte do último frame da k); todas partem do mesmo rosto Soul escolhido.
3. **(A) `CHAMPION_AUDIO`:** Kling/Seedance animam o rosto **sem som** → janelas emendadas e cortadas no nº exato de frames do trecho → **lipsync vídeo-a-vídeo** (`sync/lipsync-2`, US$ 0,05/s) com a fatia do áudio do campeão. Edição, duração e áudio (md5) idênticos ao campeão.
4. **(B) `ENGINE_VOICE`:** o motor fala a copy do trecho com voz própria → TRANSCRIBE → reencaixe: |ratio−1| ≤ 2 % só corta, ≤ 8 % time-stretch (vídeo e voz juntos, tom preservado), > 8 % = cena `FAILED` `VOICE_FIT_OUT_OF_RANGE` (sem regerar sozinho: gasto só com clique). A duração do criativo não muda; áudio final = voz nova nos trechos main + áudio do campeão no resto; legenda/karaokê redesenhados com a transcrição nova.
5. Estimativa com os 3 motores lado a lado (`BatchEstimate.swapQuotes`); o mais rápido de entregar é **(A) com Kling e Seedance** (reaproveita render, md5 do áudio e aceite do §13.10); (B) depende de uma sonda que prove voz estável entre trechos.

#### 13.15.1 Regras e combinações válidas
| `swapEngine` | `voiceSource` | `keepEdit` | resultado |
|---|---|---|---|
| `LIPSYNC` | `CHAMPION_AUDIO` | `true` | §13.3 (take único Pruna). Sem mudança |
| `LIPSYNC` | `CATALOG` | `false` | talking head limpo v1. Sem mudança |
| `KLING` / `SEEDANCE` | `CHAMPION_AUDIO` | `true` | (A) |
| `SEEDANCE` | `ENGINE_VOICE` | `true` | (B) (Kling fora: ver abaixo) |
| `LIPSYNC` | `ENGINE_VOICE` | qualquer | `400 VALIDATION_ERROR` `{ field: 'settings.voiceSource', rule: 'engine_voice_needs_video_engine' }` |
| `KLING` / `SEEDANCE` | qualquer | `false` | `400 VALIDATION_ERROR` `{ field: 'settings.swapEngine', rule: 'video_engine_needs_keep_edit' }` |
| `KLING` / `SEEDANCE` | `CATALOG` | `true` | `400 VALIDATION_ERROR` `{ field: 'settings.voiceSource', rule: 'catalog_voice_not_in_keep_edit' }` |
| `KLING` | `ENGINE_VOICE` | `true` | `400 VALIDATION_ERROR` `{ field: 'settings.voiceSource', rule: 'engine_voice_seedance_only' }` (decisão do Gusta 08/10: (B) só no Seedance) |
| `SEEDANCE` | `ENGINE_VOICE` | `true` | enquanto a cadeia (B) não estiver liberada no build: `400 VALIDATION_ERROR` `{ field: 'settings.voiceSource', rule: 'engine_voice_not_enabled' }`; depois, (B) |
- Cotações: combinação fora do produto/build sai em `swapQuotes` com `available: false`, `notEnabled: true` e `disabledReason` (`engine_voice_seedance_only` \| `engine_voice_not_enabled`, = a `rule` do 400). Bloqueio do campeão continua em `blockers`. `changeOptions[].sceneLabel` (opcional): no `SCENE` de criativo `SWAP_VIDEO`, rótulo do trecho mais caro, cujo preço vai em `estimateUsd`.
- `swapEngine`/`voiceSource` mudam no `PATCH /variation-batches/:id/settings` em `PLAN_READY`, sem `replan` (não mudam o plano, só a produção). Valem pra todos os itens `SWAP_AVATAR` do lote (uma alavanca por teste: o motor é config do lote).
- Gênero do elenco (§13.13): em (A) segue o gênero da voz do campeão (igual hoje). Em (B) a voz é do motor e acompanha o rosto, então o gênero fica livre no `DIVERSE` (`castingGender: null` pro `planVariations`).
- Frame do campeão continua sem entrar em modelo de geração (§1.1): o motor recebe só o rosto Soul (ou o último frame da janela anterior, que é nosso). Em (A) o lipsync v2v recebe o **nosso** clipe + o áudio do campeão (o mesmo que o Pruna já recebe hoje).
- Disponibilidade de (B): `ChampionDetail.engineVoice: KeepEditAvailability` (calculado pelo backend a partir do `editMap`, não gravado). Bloqueio novo `caption_unredrawable`: camada `caption` com `background: 'none'` cujo intervalo cruza um trecho main e cuja caixa não cai inteira dentro da região (o karaokê queimado no vídeo base mostraria os tempos da voz antiga e não dá pra apagar sem o eraser). `ENGINE_VOICE` com bloqueio = `422 KEEP_EDIT_UNSUPPORTED { kind: 'SWAP_AVATAR', blockers }`. (A) usa o `keepEdit.SWAP_AVATAR` de hoje.

#### 13.15.2 Trechos e janelas (`CatalogService.planSwapWindows`, função pura da ia)
- **Trecho** = span `kind: 'main'` da `EditMap.timeline` (mapa antigo sem `timeline`: os `faceTrack` contíguos em frame, unidos). Os `FaceTrackSegment` dentro do trecho (troca de célula, punch-in) viram overlays separados no render, todos recortando o mesmo clipe da cena (`clipOffsetSec = (seg.startFrame − trecho.startFrame) / fps`).
- **Janelas:** limite de fonte por janela (A) **14,5 s**, (B) **12,5 s** (folga pra fala mais lenta caber nos 15 s do motor). Trecho acima do limite: corta no meio do maior silêncio entre palavras (teardown) dentro de `[0,5 × limite, limite]` a partir do início da janela; sem silêncio ≥ 0,15 s ali, na fronteira de palavra mais perto do limite; nunca no meio de palavra. As janelas são contíguas e cobrem o trecho inteiro.
- **`genSec`** (inteiro pedido ao motor): (A) `clamp(ceil(len + 0,2), mín, 15)`; (B) `clamp(ceil(len × 1,15 + 0,3), mín, 15)`. Mínimo: Kling 3 s, Seedance 4 s (trecho curto paga o mínimo; aviso `short_segment_padded`).
- **Encadeamento:** janela 0 com `image` = rosto escolhido do elenco; janela k > 0 com `image` = último frame decodificado da janela k−1 (`medicao.lastFrame`). Por isso as janelas de um trecho são **sequenciais**; trechos diferentes rodam em paralelo (limite de concorrência da WaveSpeed do adapter).
- **Enquadramento:** o rosto Soul já nasce no aspecto da maior região (`faceAspectFor`, §13.3). Kling não tem parâmetro de proporção (sai no aspecto da imagem, 1:2,5 a 2,5:1); Seedance recebe o `aspect_ratio` suportado mais perto da região. O `fitCrop` de hoje cobre o resto (cover, rosto centrado, mesma proporção rosto/região do original).
- **Resolução Seedance** (`CatalogService.swapResolutionFor(region, aspect)`): 480p se a maior região, em `cover`, pede ≤ 110 % dos pixels do quadro 480p naquele aspecto (caso split screen, região ~336×324); senão 720p (tela cheia 9:16). Kling = 1080p sempre.
- **Prompt** (ia, `prompts-midia.ts`, método da skill `kling-3-prompt`): câmera travada no tripé, sem zoom/pan/corte, a mesma pessoa do 1º ao último frame, só ela no plano, enquadramento e luz do `profile`, olhar na lente. (A): "fala naturalmente pra câmera" sem diálogo no prompt e `sound: false` / `generate_audio: false`. (B): diálogo no formato `[Speaker, <descritor de voz fixo do item>]: "<palavras da janela>"` + "só essa voz, perto do microfone, sem música"; o descritor de voz (gênero, idade, timbre, ritmo) é escrito uma vez por item no plano e repetido igual em todas as janelas e trechos. Se o modelo na WaveSpeed aceitar voz de referência (a ia confere), a voz da 1ª janela vira referência das seguintes; sem isso, aviso `voice_may_vary`.

#### 13.15.3 Cadeia de uma cena `SWAP_VIDEO`
| passo | (A) `CHAMPION_AUDIO` | (B) `ENGINE_VOICE` | quem |
|---|---|---|---|
| 1 `windows` | `SCENE_VIDEO` sem som, janela por janela (`provider_tasks.window_index`) | `SCENE_VIDEO` com som e a fala da janela | ia submete, backend encadeia |
| 2 `joining` | emenda as janelas e corta em `endFrame − startFrame` frames na fps do campeão → `scenes.raw_clip_file_id` (sem som) | emenda as janelas (com som) → clipe cru | medicao (`concatClips`, `trimToFrames`) |
| 3 | `lipsync`: `LIPSYNC_VIDEO` (vídeo = clipe cru, áudio = fatia do campeão em `[startFrame/fps, endFrame/fps)`, `sync_mode: cut_off`) | `transcribing`: `TRANSCRIBE` do clipe cru → `fitting`: `fitEngineVoice` → `timeStretch` (setpts + atempo) até o nº exato de frames | ia / medicao |
| 4 `checking` | `identityScore` (SFace, 2 amostras/s, contra o rosto escolhido): mediana ≥ 0,363 e nenhuma amostra < 0,30; senão `FAILED` `IDENTITY_DRIFT` | igual; mais `SPEECH_MISMATCH` se a transcrição casa < 85 % das palavras da copy (normalizadas) | medicao + backend |
| 5 `done` | `clip_file_id` = saída do lipsync; `words` = teardown no trecho (relativas ao início da cena); `audio_file_id` = fatia do campeão | `clip_file_id` = clipe esticado (com a voz nova); `words` = transcrição × fator; `audio_file_id` = voz extraída; `fit` gravado | backend |
- **Reencaixe (B), `CatalogService.fitEngineVoice`** (puro): `sourceSec` = fala no campeão (1ª palavra → última do trecho); `voiceSec` = idem no clipe; `ratio = voiceSec / sourceSec`. Corte no clipe = `[vPrimeira − padL × ratio, vÚltima + padR × ratio]` (pads = do campeão: início do trecho → 1ª palavra, última → fim), limitado ao clipe. `f = corte / duração do trecho`: `|f−1| ≤ 0,02` `EXACT`, `≤ 0,08` `STRETCH`, senão `VOICE_FIT_OUT_OF_RANGE` `{ ratio, sourceSec, voiceSec }` com `action: regenerate`. Nada de mexer no corte do campeão nem na duração do vídeo (b-roll e convidada ficam no mesmo frame).
- **Sem retentativa paga automática.** Falha = cena `FAILED` com motivo; "Refazer trecho (US$ x)" refaz só aquela cena (todas as janelas + lipsync/transcrição), `attempt + 1`, `seed` novo.
- Status: a cena vai `QUEUED → GENERATING (progress pelas etapas) → READY | FAILED`; o criativo segue a máquina v1 (`SCENES_SETTLED` quando todas as cenas terminam). Sem `Take` nesse caminho.

#### 13.15.4 Render e áudio (maquina-video)
- `RemixKeepRenderInput` não muda pra (A): overlays dos `faceTrack` de role `main` apontam pro clipe da cena dona do trecho; `audioPassthroughUrl` = áudio do campeão com `-c:a copy` (md5 igual).
- (B): campo novo opcional `audioSplice?: { spans: { startFrame: number; endFrame: number; url: string }[]; fadeMs: number }` (`fadeMs` 10). Com ele, o render monta o áudio = campeão com cada span trocado pela voz da cena (crossfade de `fadeMs` nas bordas), AAC 192 kbps; sem ele, `-c:a copy` como hoje. Toda camada `caption` é redesenhada no intervalo inteiro dela com as palavras **mescladas** (transcrição nova nos trechos main + teardown fora), por cima do fundo `solid`/`pill` medido; camadas `caption` sem fundo só existem dentro da região (senão o bloqueio `caption_unredrawable` já barrou).
- Música por baixo da fala some nos trechos main em (B) (sem separar trilhas): aviso `music_bed_drops` quando a seção `audio.music` do teardown não é "none"/vazia. Separação de trilhas fica pós-10/10.

#### 13.15.5 Preço (por unidade; conferir na sonda)
| item | preço | fonte |
|---|---|---|
| Kling 3.0 i2v sem som / com som | US$ 0,112/s / 0,168/s, 1080p | sondas 05-06/10 (`integracoes.md`) |
| Seedance 2.0 i2v 480p / 720p (áudio incluso) | US$ 0,108/s (cobrado nas 2 sondas) / 0,24/s (página; o "~0,22" do Gusta não foi visto cobrado) | `integracoes.md` |
| Lipsync v2v `sync/lipsync-2` | US$ 0,05/s do vídeo (página 08/10, ~109 s por chamada) | candidato padrão |
| alternativas v2v | `wavespeed-ai/infinitetalk/video-to-video` 0,03/s 480p · 0,06/s 720p (mín. 3 s; regenera cabeça/corpo: risco de identidade); `sync/lipsync-3` 0,135/s | páginas 08/10 |
| TRANSCRIBE | 0,002/s | v1 |
**Caso podcast (4 trechos main de 4, 5, 6 e 7 s = 22 s; vídeo de ~30 s), por variação, sem o rosto (US$ 0,006):**
| motor | (A) áudio original | (B) voz do motor |
|---|---|---|
| Lipsync (Pruna) | take da 1ª à última fala main (~28 s) × 0,025 ≈ **US$ 0,70** | — |
| Kling 3.0 | 26 s × 0,112 = 2,91 + v2v 22 s × 0,05 = 1,10 → **≈ US$ 4,01** | 29 s × 0,168 = 4,87 + 0,06 → **≈ US$ 4,93** |
| Seedance 2.0 480p | 26 s × 0,108 = 2,81 + 1,10 → **≈ US$ 3,91** | 29 s × 0,108 = 3,13 + 0,06 → **≈ US$ 3,19** |
| Seedance 2.0 720p | 26 s × 0,24 = 6,24 + 1,10 → **≈ US$ 7,34** | 29 s × 0,24 = 6,96 + 0,06 → **≈ US$ 7,02** |
`etaSec` por cena ≈ Σ janelas × ~150 s (sequenciais) + v2v ~110 s; o criativo = a cena mais lenta.

#### 13.15.6 Contrato HTTP (vai pro `api.md` §20 e "Mudanças 08/10")
- `BatchSettings.swapEngine: SwapEngine` (padrão `'LIPSYNC'`); `BatchSettings.voiceSource` aceita `'ENGINE_VOICE'`. `POST /champions/:id/batches` e `PATCH /variation-batches/:id/settings` validam pela tabela da §13.15.1.
- `GET /champions/:id`: + `engineVoice: KeepEditAvailability`.
- `GET /variation-batches/:id/estimate`: + `swapQuotes: SwapQuote[] | null` (null sem item `SWAP_AVATAR` incluído). 5 linhas: `LIPSYNC/CHAMPION_AUDIO`, `KLING/CHAMPION_AUDIO`, `KLING/ENGINE_VOICE`, `SEEDANCE/CHAMPION_AUDIO`, `SEEDANCE/ENGINE_VOICE`; `selected` marca a do lote; `costUsd`/`items[]` do `BatchEstimate` continuam sendo da seleção atual. A tela mostra os 3 motores com o preço sem chamar a estimativa 5 vezes.
- `POST /variation-batches/:id/launch`: criativo `SWAP_AVATAR` com motor de vídeo nasce `engine: 'SCENES'`, `engineModel: 'kling-3.0' | 'seedance-2.0'`, `voiceSource` do lote, 1 cena `SWAP_VIDEO` por trecho main (`startFrame`, `endFrame`, `speech` = palavras do teardown no trecho, `label` = "Trecho n"). Lipsync segue com take.
- `Scene.pipeline` aceita `'SWAP_VIDEO'`; `Scene.swap: SceneSwap | null` (só nessa pipeline). SSE `scene.updated` carrega o `swap`.
- `POST /creatives/:id/scenes/:index/regenerate` numa cena `SWAP_VIDEO`: exige `{ confirm: true, expectedCostUsd }` (sem = `409 INVALID_STATE` `{ reason: 'regenerate_swap_scene', estimateUsd }`); refaz só aquele trecho. `review.changeOptions`: `SCENE` (custo do trecho mais caro, com rótulo), `FACE` (todos os trechos), `TEXT`; `LINE` não existe (a copy é a do campeão).
- Erros assíncronos novos na cena: `VOICE_FIT_OUT_OF_RANGE`, `SPEECH_MISMATCH`, `IDENTITY_DRIFT` (todos `action: 'regenerate'`). `KeepEditBlocker` + `caption_unredrawable`.
- Mock (`INTEGRACOES_MODE=mock`), gatilhos nas notas do campeão: `[mock:voice-fit-out]` (ratio 1,15), `[mock:speech-mismatch]`, `[mock:identity-drift]`. Mock de `SCENE_VIDEO` sem som = rosto em loop pela `genSec`; com som = idem + áudio do TTS mock da fala; mock de `LIPSYNC_VIDEO` = o vídeo de entrada remuxado com o áudio.

#### 13.15.7 Interfaces internas novas (assinaturas; os donos escrevem nos seus `contrato.ts` na janela de reinício)
```ts
// integracoes (maquina-ia) — GenerationService
submitSceneVideo(i: { workspaceId; sceneId; windowIndex?: number; model: 'kling-3.0'|'seedance-2.0'; faceImageUrl: string /* rosto ou último frame */;
  speech: string /* '' em (A) */; sound: boolean; voiceDescriptor?: string; visualPrompt: string; durationSec: number;
  format: VideoFormat; aspectRatio?: FaceAspect; resolution?: '480p'|'720p'; seed?: number; language: string }): Promise<Submitted>;
submitLipsyncVideo(i: { workspaceId; sceneId: string; videoUrl: string; audioUrl: string; seed?: number }): Promise<Submitted>; // kind LIPSYNC_VIDEO, CostKind LIPSYNC
// CatalogService (puras)
planSwapWindows(i: { spanSec: number; words: TranscriptWord[] /* relativas ao trecho */; engine: 'KLING'|'SEEDANCE'; voiceSource: SwapVoiceSource }): { startSec: number; endSec: number; genSec: number }[];
fitEngineVoice(i: { sourceWords: TranscriptWord[]; sourceSec: number; clipWords: TranscriptWord[]; clipSec: number }): SwapFit | { error: 'VOICE_FIT_OUT_OF_RANGE'; ratio: number; sourceSec: number; voiceSec: number };
swapResolutionFor(region: { w: number; h: number }, aspect: FaceAspect): '480p'|'720p';
estimateSwap(i: { engine: SwapEngine; voiceSource: SwapVoiceSource; spans: { sec: number; words: TranscriptWord[] }[]; takeSec: number; region: { w: number; h: number }; aspect: FaceAspect }): Omit<SwapQuote, 'available'|'blockers'|'notEnabled'|'selected'|'costUsd'>;
// medicao (maquina-video)
concatClips(paths: string[], outPath: string): Promise<{ durationSec: number }>;            // reencoda na fps do 1º, sem buraco
trimToFrames(videoPath: string, frameCount: number, fps: number, outPath: string): Promise<void>;
lastFrame(videoPath: string, outPath: string): Promise<string>;                            // último frame decodificado, png
timeStretch(videoPath: string, factor: number, outPath: string): Promise<void>;            // setpts + atempo, tom preservado
identityScore(videoPath: string, refImagePath: string, sampleFps?: number): Promise<{ median: number; min: number; samples: number }>; // SFace
// render: RemixKeepRenderInput.audioSplice?: { spans: { startFrame; endFrame; url }[]; fadeMs: number }
```

#### 13.15.8 Plano por agente (código só depois do ok do Gusta)
| id | agente | pasta | tarefa | depende de | pronto quando |
|---|---|---|---|---|---|
| A5 | arquiteto | `docs/`, `contratos/`, `api/prisma/` | esta seção, schema, migração escrita, tipos em `troca-motor.ts` | — | **feito 08/10** (`prisma validate`, `tsc` do pacote). Falta: aplicar a migração (Gusta) e, na janela de reinício, as 8 edições do index + `prisma generate` |
| I6 | ia | `api/src/integracoes/` | `submitSceneVideo` com `sound`/`aspectRatio`/`resolution`/`seed`/`windowIndex`; `submitLipsyncVideo`; prompts (A) e (B) com descritor de voz; `planSwapWindows`, `fitEngineVoice`, `swapResolutionFor`, `estimateSwap`; preços no catálogo; mocks e gatilhos; **sondas S1/S2** | A5 | Jest das funções puras (janela no silêncio, mínimo do motor, ratio nas 3 faixas); sondas com o valor avisado e ok do Gusta |
| V5 | video | `api/src/medicao/`, `video/`, `api/src/render/` | `concatClips`, `trimToFrames`, `lastFrame`, `timeStretch`, `identityScore`; `audioSplice` e legenda com palavras mescladas no `remix-keep` | A5 | Jest com clipes sintéticos: nº de frames exato, stretch 0,95/1,05 com duração certa, identidade alta no mesmo rosto e baixa em rosto trocado; render local do caso podcast |
| B6 | backend | `api/src/` (menos as 3 acima) | validação da §13.15.1; `engineVoice`; `swapQuotes`; launch com cenas `SWAP_VIDEO`; orquestrador da cena (janelas em sequência → emenda → v2v ou transcrição+reencaixe → checagem); `Scene.swap`; regerar trecho com `confirm`; `changeOptions`; `RemixKeepRenderInput` (overlays por cena, `audioSplice`, palavras mescladas) | A5; I6/V5 pelo contrato e mock | Jest: validação, launch em (A) e (B), cadeia com webhook fora de ordem, falhas com motivo, regerar só o trecho; `tsc` limpo |
| F6 | frontend | `web/` | lote: 3 cartões de motor com preço lado a lado (`swapQuotes`, Lipsync padrão) + escolha de áudio "Original" / "Voz do motor" (desligada com o motivo); avisos; geração: cartão do trecho com etapa (janela k/n, lipsync, ajuste) e "Refazer trecho (US$ x)" com confirmação; fator do reencaixe na tela | A5 | `tsc`, `next build`, 1440/390 com MSW, EN e PT |
| Q9 | qa | `testes/` | fixtures: podcast (4 main + other_person), trecho > 15 s, karaokê sem fundo fora da região; casos A/B em mock, gatilhos de falha; aceite (A) = §13.10; (B) = mesmo nº de frames, áudio fora dos trechos main com SNR ≥ 30 dB contra o campeão (ver nota do aceite abaixo), voz nova dentro, karaokê com as palavras novas, 1 rosto por frame | B6, F6 | Playwright + saída dos comandos |
| Q10 | qa + Gusta | — | 1 Trocar avatar no podcast do Gusta com Kling (A) ≈ US$ 4,0 e, se S2 passar, 1 com Seedance 480p (B) ≈ US$ 3,2; estimativa na tela antes | Q9 + ok | Gusta aprova as peças |
**Aceite do áudio (08/10, coordenador):** (A) = md5 do áudio decodificado igual ao do campeão (`-c:a copy`). (B) **não é PCM-idêntico** fora dos trechos main: o áudio montado é reencodado em AAC (~30 dB de SNR, inaudível, sem atraso). O aceite de (B) é **SNR ≥ 30 dB** fora dos trechos main + alinhamento sem atraso, não md5.
**Sondas (precisam do ok do Gusta):** S1 (A) = Kling 4 s sem som (0,45) + `sync/lipsync-2` 4 s (0,20) + `infinitetalk` v2v 480p 4 s (0,12) com a fatia do áudio do podcast ≈ **US$ 0,77** → escolhe o v2v. S2 (B) = 2 janelas encadeadas de 5 s com som no Kling (1,68) e no Seedance 480p (1,08), mesmo descritor de voz → a voz se mantém? ≈ **US$ 2,76**. Sem S2 aprovada, (B) fica fora do build (`notEnabled`).
**Ordem rápida:** (A) com Kling primeiro (1-1,5 dia: só janelas, emenda, v2v e checagem; render e aceite já existem) → Seedance (A) (mesmo código + resolução) → (B) depois da S2 (2-3 dias: transcrição, reencaixe, áudio montado, legenda mesclada).
**Corta se apertar:** encadeamento pelo último frame (cai pra todas as janelas do rosto, com salto visível em trecho > 15 s) → `identityScore` automático (fica a conferência do QA) → `swapQuotes` com 5 linhas (fica só a seleção atual).

#### 13.15.9 Edições pendentes no `contratos/src/index.ts` (aplicar na janela de reinício da 3001)
1. `export * from './troca-motor';` no fim.
2. `VoiceSource = 'CATALOG' | 'CHAMPION_AUDIO' | 'ENGINE_VOICE'`.
3. `ScenePipeline` + `'SWAP_VIDEO'`; `Scene` + `swap: SceneSwap | null`.
4. `BatchSettings` + `swapEngine: SwapEngine`.
5. `KeepEditBlocker` + `SwapKeepEditBlocker`; `ChampionDetail` + `engineVoice: KeepEditAvailability`.
6. `AsyncErrorCode` + `SwapAsyncErrorCode`.
7. `BatchEstimate` + `swapQuotes: SwapQuote[] | null`.
8. `INVALID_STATE.reason` + `'regenerate_swap_scene'`.
