// Contrato da integracoes (maquina-ia). Cópia de docs/contratos/estrutura.md §2.1 + §2.5.1 (feature 2,
// = feature-2-variar-campeao.md §6.1), com as mudanças da §2.5.1 aplicadas DENTRO das interfaces v1
// (no doc elas aparecem como "... v1 sem mudança ..." e não compilam soltas). Tipos da API vêm do @maquina/contratos.
// Não edite aqui: mudança de contrato é do maquina-arquiteto (docs/contratos/) e depois se recopia.
import type {
  AdLibraryMeta, CastingStyle, EditLayer, EditMap, FaceTrackSegment, FontId, HookMode, Measurements, PersonProfile, Rect, ScenePipeline,
  TakeKind, TeardownSections, TextStyle, TranscriptWord, VariationKind,
  SwapEngine, SwapFit, SwapQuote, SwapResolution, SwapVoiceSource,
  AutoVariationType, BlockFn, BrainField, EndcardVariant,
} from '@maquina/contratos';
export type {
  AutoVariationType, BlockFn, BrainField, EndcardVariant,
  AdLibraryMeta, CastingStyle, EditLayer, EditMap, FaceTrackSegment, FontId, HookMode, Measurements, PersonProfile, Rect, ScenePipeline,
  TakeKind, TeardownSections, TextStyle, TranscriptWord, VariationKind,
  SwapEngine, SwapFit, SwapQuote, SwapResolution, SwapVoiceSource,
};
// §13 (06/10 noite): o doc só lista os NOMES (§13.7 "Interfaces internas"); as assinaturas abaixo são da maquina-ia,
// marcadas com "§13". Mudou o doc? recopiar.

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

  // ---------- feature 2 (§2.5.1) ----------
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
      slots: { kind: VariationKind; index: number }[]; avoidLevers: string[]; notes: string|null;
      /** §13: mapa da edição do campeão (teardown.editMap). Dá o `profile` (elenco parecido com o original) e a camada de
       *  texto do gancho (tamanho máximo do texto novo). null/ausente = elenco pelo formato (v1) e gancho sem camada. */
      editMap?: EditMap|null;
      /** §13.4: 'TEXT' = só o texto da tela do gancho muda (speech = fala original, sem elenco compartilhado).
       *  Ausente = comportamento anterior (gancho falado). Só 'TEXT' é aceito até a D6. */
      hookMode?: HookMode;
      /** §13.13: 'DIVERSE' = cada elenco do lote (e o compartilhado) marcadamente diferente dos outros e do original; os
       *  eixos (etnia, idade, cabelo, olhos, tatuagem, piercing, barba/maquiagem, roupa, cenário) são sorteados no código
       *  pela semente do lote e passados como restrição; luz/enquadramento/pose seguem o original.
       *  'MATCH_ORIGINAL' = §13.3.1 (mesmo perfil, outra pessoa). Ausente = 'DIVERSE' (padrão do lote). */
      castingStyle?: CastingStyle;
      /** §13.13: gênero aparente obrigatório dos elencos (voz original no SWAP_AVATAR). null/ausente = gênero da voz do
       *  teardown, senão do perfil. Gênero nunca é sorteado (o avatar tem que bater com a voz). */
      castingGender?: 'female'|'male'|null },
    cb: { onSharedCasting(description: string): void;
          onItemDone(kind: VariationKind, index: number, draft: VariationItemDraft): void;
          onItemFailed(kind: VariationKind, index: number, errorCode: string): void }): Promise<Usage>;

  /** §13.2: camadas de texto queimadas + elementos por cima do rosto + perfil genérico da pessoa (Claude com visão).
   *  Chamada separada do analyzeChampion (refazer sem reescrever o teardown). Saída já na grade do campeão (px, frames),
   *  `source: 'vision'`; o refino por pixel (layerPresence, maquina-video) vem depois. Legenda: intervalo = 1ª-última
   *  palavra da transcrição. Grava cost_entry (LLM) no campeão. Erros: SAFETY_BLOCK, RATE_LIMITED, PROVIDER_*. */
  describeEdit(i: DescribeEditInput): Promise<EditMapDraft & Usage>;

  // ---------- variação automática v1 (variacao-auto-v1.md §7.1) ----------
  /** Porquê (HOOK/PROOF/CTA), o que fica intacto e o plano de 8-12 peças só com os tipos de `allowed`. 1 chamada
   *  (+1 nova tentativa interna se a resposta não serve); o reparo é o backend chamar de novo com `violations`.
   *  Grava cost_entry (LLM, variationBatchId). Erros: SAFETY_BLOCK, RATE_LIMITED, PROVIDER_*. */
  planAutoBatch(i: AutoPlanInput, onStage: (s: 'planning') => void): Promise<AutoPlanDraft & Usage>;
}

// ---------- variação automática v1 (§7.1) ----------
export interface AutoPlanInput {
  workspaceId: string; batchId: string; jobId: string;
  /** idioma de why/kept/change/rationale */
  uiLocale: 'EN'|'PT_BR';
  /** BCP 47 da FALA do campeão: textos que aparecem no vídeo */
  screenLanguage: string;
  /** Brain v0 (fase2-agencia §5). `notes` também carrega os gatilhos do mock (§10). */
  offer: OfferBriefDraft;
  workspace: { name: string; industry: string|null; market: string|null };
  /** texto visível da LP (≤ 4 mil caracteres), se capturada */
  page: { captured: boolean; text: string|null };
  teardown: TeardownSections; transcript: TranscriptWord[];
  media: { durationSec: number; cuts: number; silences: { startSec: number; endSec: number }[]; hasWrittenHook: boolean; hasEndCard: boolean };
  /** até 8 (os do teardown), pra escolher o frame do STATIC e o teaser */
  keyframes: { atSec: number; reason: string; url: string }[];
  allowed: { type: AutoVariationType; max: number }[];
  rules: { min: number; max: number; minDiversityPct: 40 };
  /** 2ª chamada (reparo) */
  violations?: string[];
}
export interface AutoPlanDraft {
  /** normaliza os blocos do teardown.structure */
  blocks: { index: number; fn: BlockFn }[];
  why: { hook: WhyDraft; proof: WhyDraft; cta: WhyDraft };
  /** 2-4 */
  kept: { label: string; blockIndex: number|null }[];
  /** 8-12, na ordem em que aparecem no plano */
  items: AutoItemDraft[];
}
export interface WhyDraft { text: string; source: 'brain'|'video'; brainField: BrainField|null; ref: string }
export interface AutoItemDraft {
  type: AutoVariationType;
  /** ≤ 90, uiLocale: "a única coisa que muda" */
  change: string;
  /** ≤ 160, uiLocale: qual linha do porquê ela ataca */
  rationale: string;
  whyKey: 'hook'|'proof'|'cta';
  params: AutoParamsDraft;
}
export type AutoParamsDraft =
  | { type: 'CUT'; targetSec: 15|20; blockIndexes: number[] }                    // blocos inteiros, em ordem
  | { type: 'COLD_OPEN'; teaserStartSec: number; teaserEndSec: number }          // 1,5-3,5 s, depois de 0:05
  | { type: 'HOOK_TEXT'; text: string }                                         // ≤ 60, screenLanguage
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string|null; ctaText: string } // ≤ 40 / 60 / 24
  | { type: 'SPLIT_LP' } | { type: 'STORY' }
  | { type: 'REVIEW'; quote: string; author: string|null; stars: 1|2|3|4|5|null } // literal do proof; stars só se estiver lá
  | { type: 'NATIVE_SEARCH'; query: string }                                    // ≤ 60, screenLanguage, sem marca
  | { type: 'STATIC'; atSec: number; headline: string };                        // ≤ 50

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
/** O que entra no EditMap vindo da visão (o resto do EditMap é da medicao/backend).
 *  `overlaysOverFace` = SÓ o que é desenhado por cima do rosto do avatar principal (figurinha, emoji, painel sobreposto);
 *  painel vizinho de split screen nunca entra (bug 06/10, campeão cmuwsqw79000922x2t8gz86v3).
 *  `mainSpeaker` e `otherFaces` são informativos (não bloqueiam nada): quem fala pra câmera e rostos de b-roll/tela/CCTV. */
export type EditMapDraft = Pick<EditMap, 'layers' | 'overlaysOverFace' | 'profile'> & {
  mainSpeaker?: { box: Rect; description: string } | null;
  otherFaces?: { startFrame: number; endFrame: number; box: Rect | null; where: string }[];
};

// ---------- §13.5: take contínuo ----------
/** Fatia do take = cena TAKE_SLICE. Tempos em s RELATIVOS ao início do take; words relativas ao início da fatia. */
export interface TakeSlice {
  index: number; label: string; takeStartSec: number; takeEndSec: number; speech: string; words: TranscriptWord[];
  /** false = nenhuma palavra do bloco casou com o take: fronteira proporcional aos caracteres (logar, nunca falhar) */
  matched: boolean;
}

// ---------- feature 2: Claude (§2.5.1) ----------
export interface TeardownDraft { language: string; sections: TeardownSections }   // tipo do @maquina/contratos
export type VariationItemDraft = { lever: string; rationale: string } & (
  { hook: { speech: string; onScreenText: string|null; durationSec: number } } | { castingDescription: string } |
  { script: ScriptDraft } | { layoutTemplateId: string });

// ---------- feature 2: Ad Library (Apify) (§2.5.1) ----------
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

// ---------- catálogo, estimativa e cenas (sem custo) ----------
export interface CatalogService {
  engines(): { id: 'SCENES'|'LIPSYNC'; models: { id: string; label: string; maxSceneSec: number }[]; tradeoffKey: string }[];
  voices(language?: string): { id: string; name: string; language: string; gender: 'female'|'male'|'neutral'; sampleUrl: string }[];
  /** Quebra o roteiro em cenas respeitando o limite do modelo. Determinístico. */
  splitScenes(blocks: ScriptBlockDraft[], engine: 'SCENES'|'LIPSYNC', model: string): SceneDraft[];
  /** warnings: 'voice_gender_mismatch' só com engine LIPSYNC, voiceId e um gênero inequívoco na faceDescription.
   *  feature 2: estimate passa a aceitar o pipeline de cada cena: REUSE e SOURCE_CUT = US$ 0; AUDIO_LIPSYNC = só LIPSYNC
   *  (segundos reais do trecho, sem TTS nem TRANSCRIBE). Sem `pipelines` = comportamento v1.
   *  §13.5: lipsync cobra por TAKE (um arredondamento só): sem `pipelines` com engine LIPSYNC = 1 take TTS_LIPSYNC com as
   *  falas unidas; cenas TAKE_SLICE somam num take só, do tipo `take.kind` (padrão TTS_LIPSYNC). AUDIO_LIPSYNC = só LIPSYNC
   *  de `take.audioSec` (segundos reais da janela). Nunca lança por > 600 s: o 422 é do backend (use takeSecondsFor). */
  estimate(input: { engine: 'SCENES'|'LIPSYNC'; model: string; scenes: SceneDraft[]; format: VideoFormat; voiceId?: string; faceDescription?: string; faceCount?: number;
                    pipelines?: ScenePipeline[]; audioSecByScene?: number[];
                    take?: { kind: TakeKind; audioSec?: number; wordsPerSec?: number } }):
    { costUsd: number; etaSec: number; lines: { kind: string; units: number; unit: string; unitPriceUsd: number; amountUsd: number }[]; warnings: 'voice_gender_mismatch'[] };
  estimateFaces(count: number): number;                     // USD
  /** feature 2: custo da análise: Whisper por segundo + Claude (fixo estimado por nº de frames). */
  estimateAnalysis(durationSec: number, keyframeCount: number): number;
  /** variacao-auto §9: análise do lote AUTO = estimateAnalysis (Whisper + teardown + describeEdit) + o plano
   *  (planAutoBatch, 1 chamada). `planOnly` = campeão da Library já analisado (só o plano). keyframeCount padrão 12. */
  estimateAutoAnalysis(durationSec: number, opts?: { keyframeCount?: number; planOnly?: boolean }): number;
  /** feature 2: fatiamento do campeão em cenas no silêncio entre palavras, respeitando maxSceneSec do modelo. Determinístico. */
  splitSourceScenes(words: TranscriptWord[], blocks: { label: string; startSec: number; endSec: number }[], maxSceneSec: number):
    { index: number; label: string; sourceStartSec: number; sourceEndSec: number; speech: string; words: TranscriptWord[] }[];
  /** §13.5: depois do take pronto, casa as palavras de cada bloco (na ordem) com as do take; fronteira no meio do
   *  silêncio entre a última palavra de um bloco e a 1ª do seguinte; 1ª fatia começa em 0, última termina em durationSec.
   *  `words` = TRANSCRIBE do take (TTS_LIPSYNC) ou teardown na janela, relativas ao início do take (AUDIO_LIPSYNC). Puro. */
  sliceTake(i: { blocks: { label: string; speech: string }[]; words: TranscriptWord[]; durationSec: number }): TakeSlice[];
  /** §13.3: aspecto do Soul V2 mais perto da região do rosto (1:1, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9). */
  faceAspectFor(width: number, height: number): FaceAspect;

  // ---------- §13.15: Trocar avatar com motor Kling/Seedance (puras) ----------
  /** Janelas de um trecho main (`words` relativas ao trecho): ≤ 14,5 s (A) / 12,5 s (B) de fonte cada, corte no meio do
   *  maior silêncio em [0,5 × limite, limite], senão na fronteira de palavra mais perto do limite. genSec inteiro ≥ mínimo. */
  planSwapWindows(i: { spanSec: number; words: TranscriptWord[]; engine: 'KLING'|'SEEDANCE'; voiceSource: SwapVoiceSource }): { startSec: number; endSec: number; genSec: number }[];
  /** Reencaixe (B). `sourceSec` de ENTRADA = duração do trecho; o `sourceSec` da SAÍDA = fala no campeão (1ª → última palavra). */
  fitEngineVoice(i: { sourceWords: TranscriptWord[]; sourceSec: number; clipWords: TranscriptWord[]; clipSec: number }): SwapFit | { error: 'VOICE_FIT_OUT_OF_RANGE'; ratio: number; sourceSec: number; voiceSec: number };
  swapResolutionFor(region: { w: number; h: number }, aspect: FaceAspect): '480p'|'720p';
  /** Uma linha do `swapQuotes` (por item). `music_bed_drops` e os bloqueios são do backend. */
  estimateSwap(i: { engine: SwapEngine; voiceSource: SwapVoiceSource; spans: { sec: number; words: TranscriptWord[] }[]; takeSec: number; region: { w: number; h: number }; aspect: FaceAspect }): Omit<SwapQuote, 'available'|'blockers'|'notEnabled'|'selected'|'costUsd'>;
}
export type FaceAspect = '1:1' | '3:4' | '4:3' | '2:3' | '3:2' | '9:16' | '16:9';
/** §13.5: teto do Pruna por chamada. Acima = LIPSYNC_AUDIO_TOO_LONG { durationSec, maxSec: 600 }. */
export const TAKE_MAX_SEC = 600;

// ---------- WaveSpeed (assíncrono, termina por webhook/reconciliador) ----------
export type VideoFormat = 'VERTICAL_9_16'|'PORTRAIT_4_5'|'SQUARE_1_1';
export interface Submitted { providerTaskId: string; externalId: string; estimatedUsd: number }
export interface GenerationService {
  /** §13.3: aspectRatio = o da região do rosto (CatalogService.faceAspectFor). Ausente = 9:16 (v1). */
  submitFace(i: { workspaceId: string; faceId: string; description: string; language: string; aspectRatio?: FaceAspect }): Promise<Submitted>;
  /** §13.15: cena SWAP_VIDEO passa `windowIndex` (grava provider_tasks.window_index) e `sound` (false = (A), mudo, sem
   *  fala no prompt; true = (B), fala com `voiceDescriptor` fixo do item). `aspectRatio` só no Seedance (Kling segue a
   *  imagem); `resolution` só no Seedance ('480p'|'720p'; Kling sai 1080p). Sem `windowIndex` = cena v1 (sound true).
   *  `notes` = notas do campeão: só o mock lê ([mock:voice-fit-out] / [mock:speech-mismatch]). */
  submitSceneVideo(i: { workspaceId: string; sceneId: string; model: string; faceImageUrl: string; speech: string;
                        visualPrompt: string; durationSec: number; format: VideoFormat; language: string;
                        windowIndex?: number; sound?: boolean; voiceDescriptor?: string; aspectRatio?: FaceAspect;
                        resolution?: '480p'|'720p'; seed?: number; notes?: string|null }): Promise<Submitted>;
  /** §13.15 (A): lipsync vídeo-a-vídeo (sync/lipsync-2, cut_off) do NOSSO clipe mudo com a fatia do áudio do campeão.
   *  kind LIPSYNC_VIDEO; custo LIPSYNC por segundo do vídeo de entrada. */
  submitLipsyncVideo(i: { workspaceId: string; sceneId: string; videoUrl: string; audioUrl: string; seed?: number }): Promise<Submitted>;
  /** §13.5: sceneId OU takeId (take = texto inteiro, até 10 mil caracteres da MiniMax → INVALID_SCRIPT). */
  submitTts(i: { workspaceId: string; sceneId?: string; takeId?: string; voiceId: string; text: string; language: string }): Promise<Submitted>;
  /** §13.5: sceneId OU takeId; seed (padrão 7; o backend manda 7 + attempt ao regerar). Áudio > 600 s = LIPSYNC_AUDIO_TOO_LONG. */
  submitLipsync(i: { workspaceId: string; sceneId?: string; takeId?: string; faceImageUrl: string; audioUrl: string; visualPrompt: string; format: VideoFormat; seed?: number }): Promise<Submitted>;
  /** feature 2: generalizado: sceneId OU championId OU takeId (§13.5); language opcional (campeão = detecção automática). */
  submitTranscribe(i: { workspaceId: string; sceneId?: string; championId?: string; takeId?: string; mediaUrl: string; language?: string }): Promise<Submitted>;
  /** Saída do TRANSCRIBE já normalizada pra legenda. */
  parseWords(providerTaskId: string): Promise<{ word: string; startSec: number; endSec: number }[]>;
  /** feature 2: palavras + idioma detectado (o parseWords v1 continua). */
  parseTranscript(providerTaskId: string): Promise<{ language: string; words: TranscriptWord[] }>;
}
// Fim de qualquer task: evento interno 'provider.task.finished' (eventos.md §5); feature 2: ganha `championId?`; §13.5: `takeId?`.
