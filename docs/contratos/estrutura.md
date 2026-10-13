# Estrutura do monorepo, interfaces internas e ambiente (contrato v1)
Data: 2026-10-05 (feature 2: 06/10) · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta (G0 05/10; F2-G0 06/10)**, com banco e arquivos no Supabase

## Mudanças 09/10 (editor no vídeo v1; detalhe em [`editor-v1.md`](editor-v1.md))
- **Banco:** migração `20261009120000_editor_v1` (aditiva): `creatives.edit_doc`, `creatives.edit_revision` (default 0), `creatives.remix_base`, `renders.doc`, `renders.edit_revision`.
- **Tipos:** `contratos/src/editor.ts` (EditDoc, EditorState, travas, `EDIT_CONFLICT`/`EDIT_NOT_SUPPORTED`, SSE `editor.updated`), exportado pelo index. Campos novos em tipos existentes (`editedInEditor`, `Render.doc`/`editRevision`, `hasEditorChanges`/`editorAvailable`) são obrigatórios desde o F2a (09/10).
- **CORS do storage** (o `@remotion/player` busca a mídia das URLs assinadas com `fetch`, com `Range`): regra `GET`/`HEAD`, headers `*`, expõe `Content-Length`, `Content-Range`, `Accept-Ranges`, `Content-Type`, `ETag`. Dev: o `infra:up` aplica nos dois buckets do versitygw (origens = `WEB_ORIGIN` do `api/.env` + `localhost:3000`/`127.0.0.1:3000`); `npm run infra:cors` reaplica e o `infra:status` testa o preflight. Prod: ver §6, linha "arquivos".
- **Remotion em dois pacotes:** `npm run check:remotion` falha se `remotion`/`@remotion/*` divergirem entre `web/`, `video/` e `api/` (declarado e instalado).

## Mudanças 06/10 noite (manter a edição + take contínuo; detalhe em [`feature-2-variar-campeao.md` §13](feature-2-variar-campeao.md))
- `medicao`: `measureLayout` com `cells` (colunas entram agora), `detectFaces` (YuNet ONNX via `onnxruntime-node`, score ≥ 0,8, por score), `faceTrack`, `layerPresence`, `fitCrop`; modelo em `api/src/medicao/modelos/`.
- `integracoes`: `describeEdit`, `planVariations` com `profile`/`hookMode`, `sliceTake` (substitui `splitScenes`/`splitSourceScenes` no lipsync), `estimate` por take, `submitLipsync` com `seed`.
- `render`: `RenderInput` = `ScratchRenderInput` (com `scenes[].clipStartSec`) | `RemixKeepRenderInput` (§13.6, substitui a §2.2 pós-10/10); `FONT_CATALOG` no `video/`.
> ⚠️ API dev da porta 3001 em MODO LIVE (Gusta testando com dinheiro): nenhum agente usa a 3001. Testes = API própria em mock; web = MSW ou API própria em outra porta.

## Mudanças 06/10 (feature 2 + Higgsfield)
- **Pastas novas:** `api/src/uploads/`, `api/src/campeoes/`, `api/src/variacoes/` (backend); `api/src/medicao/` (**maquina-video**: `MediaAnalysisService`, §2.4); `api/src/integracoes/adlibrary/` (ia); `testes/fixtures/campeoes/` (qa; mídia pesada fora do git).
- **Interfaces novas/alteradas** (§2.5, copiadas de `feature-2-variar-campeao.md` §6): `AdLibraryService`, `ClaudeService.analyzeChampion`/`planVariations`, `CatalogService.estimate` com `pipelines`, `estimateAnalysis`, `splitSourceScenes`, `GenerationService.submitTranscribe` generalizado + `parseTranscript`; `StorageService.putStream` e `presignPut` (backend); `RenderInput.regions`/`overlayClipUrl` e `templates().kind` (pós-10/10).
- **Envs novas** no `api/.env.example`: `APIFY_TOKEN`, `APIFY_AD_LIBRARY_ACTOR`, `AD_LIBRARY_MODE`, `UPLOAD_MODE`, `UPLOAD_MAX_BYTES`, `CHAMPION_MIN_SEC`, `CHAMPION_MAX_SEC`. **`MEDIA_PROMPTS=v2` é o padrão.** Rosto: `HF_API_KEY_ID`/`HF_API_KEY_SECRET` (Higgsfield Soul V2).
- **Deploy:** `api/Dockerfile` com ffmpeg/ffprobe do sistema (extração de áudio, cortes, medição); CORS do bucket do Supabase pro domínio do web só se `UPLOAD_MODE=direct`.

## Mudanças 05/10 (F3)
- `CatalogService.engines()`: `pruna-lipsync` com `maxSceneSec: 30`; `splitScenes` com LIPSYNC = um clipe por bloco, bloco > 30 s dividido em partes iguais por palavras inteiras (dono: ia).
- `StorageService.ingestFromUrl(..., { validate: 'video' })` devolve também a miniatura (JPEG de um frame em ~1 s) pra cena (dono: backend).

## Mudanças 05/10 (revisão da onda 2)
- Envs novas no `api/.env.example`: `REMOTION_BROWSER_EXECUTABLE` (**obrigatória em produção**; o Chrome headless é baixado no build da imagem e a env aponta pra ele), `RENDER_FRAMES_CONCURRENCY` (opcional, 1), `THROTTLE_DEFAULT_PER_MIN` (600) e `THROTTLE_EXPENSIVE_PER_MIN` (20).
- Unidade de todo `progress` (job, cena, render): inteiro 0-100.

## Mudanças 05/10 (fechamento da onda 1)
1. **`@maquina/contratos`** (pasta `contratos/`, dono: arquiteto): os tipos da API e do SSE em TypeScript, só tipos. Substitui o `api:types` (OpenAPI → tipos), que dependia do plugin do Swagger, e o plugin quebra o `nest build` com TS 5.9 ("Debug Failure"). Sem plugin, sem codegen, sem fixar TS. A api faz `class XDto implements XBody` (o compilador acusa divergência), o web e os testes importam os mesmos tipos. Testado com `import type` em `node10`/CommonJS (api), `nodenext` (testes) e `bundler` (web).
2. **`CatalogService.estimate`** recebe `voiceId?` e `faceDescription?`; o aviso `voice_gender_mismatch` é da ia (gênero da voz pelo catálogo; gênero do rosto pela descrição, só quando for inequívoco).
3. **`allowScripts` da raiz** libera `prisma`, `@prisma/client`, `@prisma/engines`, `esbuild`, `@swc/core`, `unrs-resolver` e o Postgres embutido (versões fixas); nega `@scarf/scarf` (telemetria), `@parcel/watcher` e `fsevents` (usam binário pronto). Atualizou uma dessas? Rode `npm approve-scripts <pacote>` na raiz.

## Decisões (aprovadas 05/10, `decisions/log.md`)
| ponto | decisão | porquê |
|---|---|---|
| Banco | **Postgres do Supabase**. A API conecta pelo **pooler (Supavisor)**; migração pela conexão de sessão (`DIRECT_URL`) | o Gusta vetou Cloudflare e quer banco + arquivos num lugar só |
| Arquivos | **Supabase Storage pela API compatível com S3** (SigV4, URL pré-assinada e multipart suportados), bucket privado `maquina-anuncios`, URL assinada de 6 h | mesmo SDK `@aws-sdk/client-s3` do modelhub; trocar de provedor depois = trocar 4 variáveis de ambiente |
| Modelo do Claude (roteiros e extração do briefing) | **`claude-opus-5-5`** (US$ 4 / US$ 20 por milhão de tokens), `effort: medium`, saída estruturada, streaming; configurável em `ANTHROPIC_MODEL` | roteiro é o que decide se o anúncio vende; 4 roteiros custam centavos (estimativa: US$ 0,10-0,30 por rodada, a medir) |
| Tempo real | SSE no wizard + polling de 5 s na Home | ver `eventos.md` |
| Infra local (decisão do arquiteto, depois do G0) | **Postgres 17 embutido (pacote npm `embedded-postgres`) + versitygw (gateway S3 open-source) num script Node**, tudo em `.infra/`, sem Docker | este Mac não tem Docker, e o Supabase CLI local exige Docker e sobe ~10 contêineres pra usarmos só 2 (Postgres e S3). O MinIO comunitário parou de publicar binário (HTTP 410), então o S3 local é o versitygw |

Já decidido (não reabrir): web Next 16 na Vercel, api NestJS + Prisma no EasyPanel da VPS, render Remotion dentro da API, sem worker.

## 1. Pastas
```
projects/maquina-anuncios/            ← repo git PRÓPRIO (git init feito 05/10, sem remote; fora do git do AIS-OS)
├── package.json                      ← npm workspaces: contratos, web, api, video, testes (dono: arquiteto)
├── contratos/                        ← @maquina/contratos: tipos da API + SSE, só tipos (arquiteto)
├── scripts/infra.mjs                 ← Postgres 17 (5433) + S3 local versitygw (9000) em .infra/ (arquiteto)
├── scripts/guard-db.mjs              ← trava: migração/seed só em banco localhost (arquiteto)
├── .nvmrc                            ← Node 24 (engines: >=22)
├── docs/
│   ├── contratos/                    ← este contrato (arquiteto)
│   ├── integracoes.md                ← modelos, preços e o que foi validado (ia)
│   └── render.md                     ← tempo/memória medidos do render (video)
├── design/                           ← mockup + spec (design)
├── time/                             ← TIME.md e briefings
├── web/                              ← Next 16 + Tailwind v4 + shadcn/ui + next-intl (frontend)
├── api/                              ← NestJS 11 + Prisma 6 (backend; exceções abaixo)
│   ├── prisma/schema.prisma          ← arquiteto
│   └── src/
│       ├── main.ts, app.module.ts
│       ├── common/                   ← filtros de erro, interceptor de envelope, guards, decorators (backend)
│       ├── auth/ workspaces/ ofertas/ criativos/ roteiros/ rostos/ geracao/ edicao/
│       │   biblioteca/ arquivos/ custos/ jobs/ eventos/ saude/        ← backend
│       ├── uploads/ campeoes/ variacoes/   ← backend (feature 2)
│       ├── integracoes/              ← maquina-ia (Claude, WaveSpeed, Higgsfield, Apify, webhook, reconciliador, custo)
│       ├── medicao/                  ← maquina-video (feature 2: ffmpeg/ffprobe, medição de layout e cortes)
│       └── render/                   ← maquina-video (RenderService com @remotion/renderer)
├── video/                            ← pacote @maquina/video: composições Remotion + registro de templates (video)
└── testes/                           ← e2e (Playwright) + testes de contrato da API (qa)
```
Regra de posse: cada agente só escreve na sua pasta (tabela do `TIME.md`). `api/package.json` é do backend; dependência nova de `integracoes/` ou `render/` é pedida ao backend.

## 2. Interfaces entre os módulos da API
O backend é o **dono do estado** (banco, máquina de estados, storage, SSE). `integracoes` e `render` são **serviços sem regra de negócio**: recebem dados prontos, devolvem resultado. Exceção única: `integracoes` grava `provider_tasks` e `cost_entries`.

Os tipos abaixo moram em `api/src/integracoes/contrato.ts` e `api/src/render/contrato.ts` (cada dono cria o seu, **idêntico** a este texto). O backend importa só deles.

### 2.1 `integracoes` (maquina-ia) → expõe `IntegracoesModule`
```ts
// ---------- Claude ----------
export interface OfferBriefDraft {
  name: string; language: string;   // BCP 47
  kind: string|null; what: string|null; audience: string|null; promise: string|null;
  pains: string|null; proof: string|null; offerAndPrice: string|null; cta: string|null; notes: string|null;
}
export interface WinnerExample {
  creativeId: string; sameOffer: boolean;
  angle: string|null; blocks: ScriptBlockDraft[];          // de outra oferta: usar estrutura, nunca a promessa
}
export interface ScriptBlockDraft { label: string; startSec: number; endSec: number; speech: string; visualPrompt: string }
export interface ScriptDraft { angle: string; rationale: string; durationSec: number; blocks: ScriptBlockDraft[] }
export interface SceneDraft { index: number; label: string; startSec: number; endSec: number; speech: string; visualPrompt: string }
export interface Usage { costUsd: number }                  // a ia já gravou a cost_entry

export interface ClaudeService {
  /** Lê a página (fetch na própria API) ou usa o texto colado e devolve o briefing. Erros: PAGE_FORBIDDEN, PAGE_UNREADABLE, RATE_LIMITED. */
  extractOffer(input: { url?: string; pageText?: string; workspaceId: string; jobId: string },
               onStage: (stage: 'fetching_page'|'extracting'|'detecting_language') => void): Promise<OfferBriefDraft & Usage>;

  /** Escreve N roteiros, em paralelo, com streaming. Falha parcial não derruba os outros. */
  generateScripts(input: {
      workspaceId: string; creativeId: string; jobId: string;
      offer: OfferBriefDraft; count: number; avoidAngles: string[]; winners: WinnerExample[];
    }, cb: {
      onStage(stage: 'reading_brief'|'studying_winners'|'writing'): void;
      onDelta(slot: number, blockIndex: number, field: 'speech'|'angle'|'rationale', text: string): void;
      onScriptDone(slot: number, draft: ScriptDraft): void;
      onScriptFailed(slot: number, errorCode: string): void;
    }): Promise<Usage>;

  /** Sugestão de "quem aparece no vídeo" a partir da oferta + roteiro escolhido. */
  suggestFaceDescription(input: { offer: OfferBriefDraft; script: ScriptDraft; workspaceId: string; creativeId: string }): Promise<string>;
}

// ---------- catálogo, estimativa e cenas (sem custo) ----------
export interface CatalogService {
  engines(): { id: 'SCENES'|'LIPSYNC'; models: { id: string; label: string; maxSceneSec: number }[]; tradeoffKey: string }[];
  voices(language?: string): { id: string; name: string; language: string; gender: 'female'|'male'|'neutral'; sampleUrl: string }[];
  /** Quebra o roteiro em cenas respeitando o limite do modelo. Determinístico. */
  splitScenes(blocks: ScriptBlockDraft[], engine: 'SCENES'|'LIPSYNC', model: string): SceneDraft[];
  /** warnings: 'voice_gender_mismatch' só com engine LIPSYNC, voiceId e um gênero inequívoco na faceDescription. */
  estimate(input: { engine: 'SCENES'|'LIPSYNC'; model: string; scenes: SceneDraft[]; format: VideoFormat; voiceId?: string; faceDescription?: string; faceCount?: number }):
    { costUsd: number; etaSec: number; lines: { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }[]; warnings: 'voice_gender_mismatch'[] };
  estimateFaces(count: number): number;                     // USD
}

// ---------- WaveSpeed (assíncrono, termina por webhook/reconciliador) ----------
export type VideoFormat = 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';
export interface Submitted { providerTaskId: string; externalId: string; estimatedUsd: number }
export interface GenerationService {
  submitFace(i: { workspaceId: string; faceId: string; description: string; language: string }): Promise<Submitted>;
  submitSceneVideo(i: { workspaceId: string; sceneId: string; model: string; faceImageUrl: string; speech: string;
                        visualPrompt: string; durationSec: number; format: VideoFormat; language: string }): Promise<Submitted>;
  submitTts(i: { workspaceId: string; sceneId: string; voiceId: string; text: string; language: string }): Promise<Submitted>;
  submitLipsync(i: { workspaceId: string; sceneId: string; faceImageUrl: string; audioUrl: string; visualPrompt: string; format: VideoFormat }): Promise<Submitted>;
  submitTranscribe(i: { workspaceId: string; sceneId: string; mediaUrl: string; language: string }): Promise<Submitted>;
  /** Saída do TRANSCRIBE já normalizada pra legenda. */
  parseWords(providerTaskId: string): Promise<{ word: string; startSec: number; endSec: number }[]>;
}
// Fim de qualquer task: evento interno 'provider.task.finished' (eventos.md §5).
```
Regras da ia que o backend assume: as URLs que o backend passa (rosto, áudio) são URLs assinadas do storage válidas por 6 h; a ia nunca baixa a saída pro storage (isso é do backend, com validação); `INTEGRACOES_MODE=mock` troca tudo por fakes determinísticos que terminam por evento interno em 2-5 s, com custo zero (testes e QA rodam assim).

### 2.2 `render` (maquina-video) → expõe `RenderModule`
```ts
export interface RenderInput {
  renderId: string;
  templateId: string;                                       // registro em @maquina/video
  format: 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';      // 1080x1920 | 1080x1350 | 1080x1080
  fps: 30;
  language: string;
  scenes: { clipUrl: string; durationSec: number; words: { word: string; startSec: number; endSec: number }[] }[];
  captionStyle: 'word'|'line'|'off';
  captionPosition: 'top'|'middle'|'bottom';
  headline: string|null;                                    // primeiros 3 s, se o template aceitar
  ctaText: string;
  endCard: boolean;
}
export interface RenderProgress { stage: 'bundling'|'rendering'|'encoding'; progress: number; frame: number; totalFrames: number }
export interface RenderResult { outputPath: string; posterPath: string; durationSec: number; width: number; height: number; sizeBytes: number }
export class RenderError extends Error { constructor(public code: 'RENDER_ERROR', public failedFrame: number|null, message: string) { super(message) } }

export interface RenderService {
  templates(): { id: string; labelKey: string; thumbnailPath: string; supportsHeadline: boolean }[];
  /** Renderiza um por vez (fila interna com concorrência RENDER_CONCURRENCY). Arquivos em RENDER_TMP_DIR; o backend sobe e apaga. */
  render(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult>;
}
```
`video/` exporta `TEMPLATES` (id, rótulo, `supportsHeadline`, schema zod das props) e a composição raiz; o `RenderService` usa o bundle pré-compilado em `video/dist/bundle` (build de produção) ou `bundle()` em dev. A composição é a mesma que um dia iria pro Lambda.

### 2.5 Feature 2 (`integracoes`, `medicao`, `render`)
Os donos copiam pro `contrato.ts` de cada pasta (`api/src/integracoes/contrato.ts`, `api/src/medicao/contrato.ts`, `api/src/render/contrato.ts`), idêntico a este texto.

#### 2.5.1 `integracoes` (maquina-ia): o que entra
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

#### 2.5.2 `medicao` (maquina-video, pasta nova `api/src/medicao/`): `MediaAnalysisService`
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

#### 2.5.3 `render` (maquina-video), pós-10/10
`RenderInput.scenes[]` ganha `regions?: { head: Rect|null; panel: Rect|null }` (retângulos normalizados 0-1 do quadro do campeão, vindos de `measurements.segments`) e `overlayClipUrl?: string` (head novo por cima, pro "manter a edição" do SWAP_AVATAR). `templates()` ganha `kind: 'scratch'|'remix'` e `requiresRegions: boolean`. Templates remix iniciais: `remix-head-full` (só a faixa do rosto em tela cheia, laterais com cópia desfocada), `remix-split` (rosto em cima, painel embaixo, proporção medida), `remix-captions` (quadro original + legenda/headline novos). B-roll novo fica fora (não temos fonte de b-roll no produto).

### 2.3 Backend → o que os outros podem chamar dele
`StorageService` (`api/src/arquivos/`): `signedUrl(fileId)`, `put(localPath|buffer, { workspaceId, kind, mimeType })`, `ingestFromUrl(url, { workspaceId, kind, validate: 'video'|'audio'|'image' })` (com retry e validação de arquivo inteiro); feature 2: `presignPut(storageKey, { mimeType, sizeBytes, expiresSec })`, `putStream(stream, { storageKey, mimeType, maxBytes })` e `head(storageKey)`. A ia, a medição e o render **não** chamam o storage diretamente.

## 3. Ambiente (`.env.example` de cada parte)
Segredo só em `.env` local / painel da Vercel / EasyPanel. Nunca no git. Antes de rodar migração, confira pra onde `DATABASE_URL` aponta.

### `api/.env.example`
```bash
NODE_ENV=development
PORT=3001
PUBLIC_API_URL=http://localhost:3001          # em prod: https://api.<dominio>; vira a URL do webhook
WEB_ORIGIN=http://localhost:3000              # CORS (lista separada por vírgula)

# Banco. Local = npm run infra:up (Postgres 17 na 5433). NUNCA aponte pro Supabase de produção em dev
# (o scripts/guard-db.mjs bloqueia migração/seed fora de localhost).
DATABASE_URL=postgresql://maquina:maquina@localhost:5433/maquina?schema=public
DIRECT_URL=postgresql://maquina:maquina@localhost:5433/maquina?schema=public
# Produção (Supabase), preenchido só no EasyPanel:
#   DATABASE_URL = pooler em modo TRANSAÇÃO (porta 6543) — o Prisma exige pgbouncer=true (sem prepared statements):
#     postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
#   DIRECT_URL   = pooler em modo SESSÃO (porta 5432, IPv4) — usado pelo prisma migrate (DDL e advisory lock não rodam no 6543):
#     postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
#   (a conexão "direta" db.<ref>.supabase.co é só IPv6 sem o add-on pago; por isso a sessão do pooler)

# Auth
JWT_ACCESS_SECRET=troque-por-64-chars-aleatorios
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
INVITE_TTL_DAYS=7
SEED_OWNER_EMAIL=gusta@exemplo.com
SEED_OWNER_PASSWORD=troque-isto
SEED_WORKSPACE_NAME=Workspace

# Storage: interface S3 nos dois ambientes (dev = versitygw local; prod = Supabase Storage S3)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=maquina-anuncios
STORAGE_ACCESS_KEY_ID=maquina
STORAGE_SECRET_ACCESS_KEY=maquina-dev-secret
STORAGE_FORCE_PATH_STYLE=true                 # true nos dois (Supabase exige path style)
SIGNED_URL_TTL_SEC=21600
# Produção (Supabase → Storage → S3 Connection), só no EasyPanel:
#   STORAGE_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
#   STORAGE_REGION=<regiao do projeto, ex. sa-east-1>
#   STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY = chave S3 do projeto (acesso total, ignora RLS: só no servidor)

# Integrações (maquina-ia)
INTEGRACOES_MODE=mock                         # mock | live  (testes e QA: sempre mock)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5-5               # aprovado 05/10
ANTHROPIC_EFFORT=medium
WAVESPEED_API_KEY=
WAVESPEED_WEBHOOK_SECRET=                     # sem o prefixo whsec_
WAVESPEED_WEBHOOKS=on                         # off = só reconciliador (dev sem túnel)
HF_API_KEY_ID=                                # rosto: Higgsfield Soul V2 (desde 06/10)
HF_API_KEY_SECRET=
MEDIA_PROMPTS=v2                              # padrão desde 06/10

# Feature 2
APIFY_TOKEN=                                  # mesma conta do ad-radar (teto até 19/10)
APIFY_AD_LIBRARY_ACTOR=curious_coder~facebook-ads-library-scraper
AD_LIBRARY_MODE=mock                          # mock | live | off
UPLOAD_MODE=proxy                             # proxy (dev) | direct (prod com CORS no bucket)
UPLOAD_MAX_BYTES=209715200
CHAMPION_MIN_SEC=5
CHAMPION_MAX_SEC=120

# Render (maquina-video)
RENDER_CONCURRENCY=1
RENDER_FRAMES_CONCURRENCY=1                   # frames em paralelo dentro de um render (opcional; subir só depois de medir memória)
RENDER_TMP_DIR=/tmp/maquina-render
REMOTION_BUNDLE_DIR=../video/dist/bundle      # vazio em dev = bundle na hora
REMOTION_BROWSER_EXECUTABLE=                  # OBRIGATÓRIA em produção: caminho do Chrome headless baixado no build da imagem.
                                              # Vazia (só dev) = ensureBrowser do Remotion, que travou e derrubou o Node na VPS.

# Gasto
DEFAULT_MONTHLY_SPEND_CAP_USD=200

# Limites (opcionais). Em NODE_ENV=test, sem a variável, default e expensive sobem 100x; login nunca muda.
THROTTLE_DEFAULT_PER_MIN=600                  # por workspace (logado) ou IP (público)
THROTTLE_EXPENSIVE_PER_MIN=20                 # ações caras, por workspace
```

### `web/.env.example`
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_DEFAULT_LOCALE=en
SESSION_COOKIE_SECRET=troque-por-32-chars     # cifra o cookie httpOnly do refresh token
```

### `video/.env.example`
Nenhuma variável: o pacote recebe tudo por props. (Mídia de teste local em `video/fixtures/`, fora do git se pesada.)

### `testes/.env.example`
```bash
E2E_WEB_URL=http://localhost:3000
E2E_API_URL=http://localhost:3001/api/v1
E2E_DATABASE_URL=postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public   # banco próprio dos testes
E2E_OWNER_EMAIL=qa@teste.local
E2E_OWNER_PASSWORD=teste12345
```

## 4. Scripts da raiz (`package.json`)
| script | faz |
|---|---|
| `npm run infra:up` | sobe Postgres 17 (5433, bancos `maquina` e `maquina_test`, usuário/senha `maquina`) e o S3 local (9000, buckets `maquina-anuncios` e `maquina-anuncios-test`, chave `maquina`/`maquina-dev-secret`); idempotente; termina com um teste de conexão e de put/get no S3 |
| `npm run infra:down` / `infra:status` / `infra:reset` | para / mostra estado com teste real (put/get e preflight CORS) / apaga os dados locais |
| `npm run infra:cors` | reaplica o CORS dos buckets locais (editor v1) sem reiniciar nada |
| `npm run check:remotion` | falha se as versões de `remotion`/`@remotion/*` divergirem entre `web/`, `video/` e `api/` (o Remotion exige todas iguais) |
| `npm run db:migrate` | `guard-db` (só localhost) → `npm run prisma:migrate -w api` (o backend cria esse script no B1) |
| `npm run db:seed` | `guard-db` → `npm run seed -w api`: cria workspace + OWNER do `.env` |
| `npm run dev` | sobe `api` (3001, watch) e `web` (3000) juntos |
| `npm run build` | `video` (bundle) → `api` (nest build) → `web` (next build) |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm test` | Jest da api + vitest do web |
| `npm run test:e2e` | Playwright em `testes/` contra api em `INTEGRACOES_MODE=mock` e banco `maquina_test` |

## 5. Subir local (do zero)
```bash
npm install                   # Node >= 22 (a máquina do Gusta tem 24); baixa os binários do Postgres via npm
cp api/.env.example api/.env && cp web/.env.example web/.env.local
npm run infra:up              # Postgres + S3 local em .infra/ (1ª vez baixa o versitygw do GitHub, sha256 conferido)
npm run db:migrate && npm run db:seed
npm run dev                   # web http://localhost:3000 · api http://localhost:3001/api/v1 · swagger /api/docs
```
O npm 11 bloqueia script de instalação por padrão: o `package.json` já libera só o `@embedded-postgres/darwin-arm64` (recria links de bibliotecas). Em Linux/Intel, aprove o pacote da plataforma com `npm approve-scripts`.
Webhook real da WaveSpeed em dev (só com `INTEGRACOES_MODE=live` e ok do Gusta pra gastar): deixe `WAVESPEED_WEBHOOKS=off` e o reconciliador busca o resultado; se precisar testar o webhook em si, use um túnel (ex.: `ngrok http 3001`) e ponha a URL em `PUBLIC_API_URL`.

## 6. Deploy (quando o Gusta pedir)
| parte | onde | detalhe |
|---|---|---|
| web | Vercel, root `web/` | env `NEXT_PUBLIC_API_URL`, `SESSION_COOKIE_SECRET` |
| api | EasyPanel na VPS (Docker) | `api/Dockerfile` multi-stage com Chrome headless shell baixado no build (caminho em `REMOTION_BROWSER_EXECUTABLE`) + ffmpeg (Remotion e validação de vídeo); build inclui `video/dist/bundle`; `npm run build -w api` roda o `prebuild` que baixa o SFace (`api/src/medicao/modelos/baixar.sh`, sha256 conferido; precisa de `curl`) e o `nest-cli.json` copia `medicao/modelos/*.onnx` pro `dist`; `prisma migrate deploy` no start; healthcheck `GET /api/v1/health`; domínio público com HTTPS (webhook). Memória mínima: medir no render de 30 s (`docs/render.md`) antes de dimensionar |
| banco | Supabase (projeto próprio da Máquina, criado no deploy com o Gusta; região mais perto da VPS) | `DATABASE_URL` = pooler transação 6543 + `pgbouncer=true`; `DIRECT_URL` = pooler sessão 5432; `prisma migrate deploy` usa a `DIRECT_URL`. Plano Pro recomendado: o grátis pausa o projeto após 7 dias sem uso |
| arquivos | Supabase Storage (mesmo projeto), acesso só pela API S3 com a chave de servidor | bucket privado `maquina-anuncios`; limite de arquivo do bucket ≥ 200 MB (o padrão do plano grátis é 50 MB); o `<video>` do web toca direto da URL pré-assinada. Banda de saída conta no plano: medir depois do 1º mês. **CORS (editor v1):** até onde se sabe (NÃO verificado em 09/10: não há projeto de produção ainda), o Supabase Storage não expõe CORS por bucket e responde CORS liberado (`*`) nas rotas de objeto; não dá pra assumir isso pro endpoint S3 com URL assinada. **Conferir no deploy, antes de liberar o editor**, com uma URL assinada real: `curl -si -X OPTIONS '<url>' -H 'Origin: https://<web>' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: range'` tem que voltar 2xx com `Access-Control-Allow-Origin`, e `curl -si '<url>' -H 'Origin: https://<web>' -H 'Range: bytes=0-99'` tem que voltar 206 com `Access-Control-Allow-Origin` e `Content-Range` legível (`Access-Control-Expose-Headers`). Se não vier, o plano B é servir a mídia do editor por um proxy de leitura da API com `Range` (custo de banda na VPS) |
| Supabase Auth, Data API, Realtime | **não usados** | auth é JWT da própria API e o web nunca fala com o Supabase direto (só pela API). No deploy: desligar a Data API (PostgREST) do projeto, pra chave pública não expor tabela nenhuma |
