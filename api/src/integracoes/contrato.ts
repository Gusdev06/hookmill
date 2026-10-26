// Contrato da integracoes (maquina-ia). Cópia de docs/contratos/estrutura.md §2.1 + §2.5.1 (feature 2,
// = feature-2-variar-campeao.md §6.1), com as mudanças da §2.5.1 aplicadas DENTRO das interfaces v1
// (no doc elas aparecem como "... v1 sem mudança ..." e não compilam soltas). Tipos da API vêm do @maquina/contratos.
// Não edite aqui: mudança de contrato é do maquina-arquiteto (docs/contratos/) e depois se recopia.
import type {
  AdLibraryMeta, CastingStyle, EditLayer, EditMap, FaceTrackSegment, FontId, HookMode, Measurements, PersonProfile, Rect, ScenePipeline,
  TakeKind, TeardownSections, TextStyle, TranscriptWord, VariationKind,
  SwapEngine, SwapFit, SwapQuote, SwapResolution, SwapVoiceSource,
  AutoVariationType, BlockFn, BrainField, EndcardVariant, ProtectedBand,
} from '@maquina/contratos';
import type { CaptionsAuto } from '@maquina/video';
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

// ---- briefing-leitura-v2 (22/10) §4.1: de onde veio o briefing
/** O mais "fundo" que a leitura precisou ir. */
export type ReadMode = 'pasted'|'http'|'rendered'|'crawled'|'vision';
export type PageRole = 'main'|'checkout'|'pricing'|'about'|'faq'|'testimonials'|'terms'|'thankyou'|'other';
export type BriefField = 'name'|'kind'|'what'|'audience'|'promise'|'pains'|'proof'|'offerAndPrice'|'cta'|'notes';
/** Imagem que entrou na chamada do Claude; `read` = o que o modelo viu (imageNotes). Nunca carrega base64. */
export interface PageImage { index: number; src: string; alt: string|null; kind: 'screenshot'|'img'|'poster'; widthPx: number; heightPx: number; read?: string }
/** `imageIndex` presente = o campo saiu de uma imagem. */
export interface FieldOrigin { role: PageRole; url: string; imageIndex?: number }
export interface ExtractSources {
  readMode: ReadMode;
  pages: { url: string; role: PageRole; via: 'http'|'rendered'; chars: number }[];
  imagesRead: PageImage[];
  fieldOrigins: Partial<Record<BriefField, FieldOrigin[]>>;
  /** @deprecated = pages.filter(p => p.role !== 'main').map(p => p.url); mantido 1 versão pro web atual */
  relatedUrls: string[];
}
/** Etapas do checklist (§4.3). Texto colado só emite as duas últimas; etapa pulada é emitida mesmo assim (o backend marca feita). */
export type ExtractStage = 'fetching_page'|'rendering_page'|'reading_subpages'|'reading_images'|'extracting'|'detecting_language';

/** 25/10: `extends StaticTextCheckPort` (checkStaticText, estatico-montado-e-molduras-v1 §A6), ligado no fechamento do A-I. */
export interface ClaudeService extends StaticTextCheckPort {
  /**
   * Lê a oferta em cascata (HTTP → render headless → subpáginas → imagens com visão) ou usa o texto colado, e devolve o
   * briefing com a origem de cada campo. Erros: PAGE_FORBIDDEN, PAGE_UNREADABLE (details.reason = login_wall | empty_after_render), RATE_LIMITED.
   */
  extractOffer(input: { url?: string; pageText?: string; workspaceId: string; jobId: string },
               onStage: (stage: ExtractStage) => void): Promise<OfferBriefDraft & Usage & ExtractSources>;

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
  /** até 8 (os do teardown): teaser do COLD_OPEN e, rev. 23/10, REFERÊNCIA do STATIC (pessoa genérica, cenário, paleta,
   *  momento da prova). O STATIC nunca copia o frame: é uma imagem nova no GPT Image 2 (§14.3). */
  keyframes: { atSec: number; reason: string; url: string }[];
  /** 25/10 (molduras §B2): aceita FRAME (o backend só manda FRAME depois do B1-B) */
  allowed: { type: AutoVariationTypeWithFrame; max: number }[];
  /** 25/10 (§B2, TRANSIÇÃO): templates liberados pelo `allowedFrames` do backend pra este lote; ausente = padrão
   *  conservador da ia (`defaultAllowedFrames`, só B1). Só tem efeito com FRAME em `allowed`. */
  allowedFrames?: FrameTemplateId[];
  rules: { min: number; max: number; minDiversityPct: 40 };
  /** 25/10 (headline-e-legenda-v1 §1.2): o que a IA precisa pra escrever as headlines (backend, do editMap). Ausente = sem HEADLINE no `allowed`. */
  headline?: { mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string };
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
  /** 25/10: inclui FRAME (params = AutoFrameDraft) */
  type: AutoVariationTypeWithFrame;
  /** ≤ 90, uiLocale: "a única coisa que muda" */
  change: string;
  /** ≤ 160, uiLocale: qual linha do porquê ela ataca */
  rationale: string;
  whyKey: 'hook'|'proof'|'cta';
  params: AutoParamsDraftWithFrame;
}
export type AutoParamsDraft =
  | { type: 'CUT'; targetSec: 15|20; blockIndexes: number[] }                    // blocos inteiros, em ordem
  | { type: 'COLD_OPEN'; teaserStartSec: number; teaserEndSec: number }          // 1,5-3,5 s, depois de 0:05
  | { type: 'HOOK_TEXT'; text: string }                                         // ≤ 60, screenLanguage
  | { type: 'ENDCARD'; variant: EndcardVariant; headline: string; subline: string|null; ctaText: string } // ≤ 40 / 60 / 24
  | { type: 'SPLIT_LP' } | { type: 'STORY' }
  | { type: 'REVIEW'; quote: string; author: string|null; stars: 1|2|3|4|5|null } // literal do proof; stars só se estiver lá
  | { type: 'NATIVE_SEARCH'; query: string }                                    // ≤ 60, screenLanguage, sem marca
  // rev. 23/10 (§14.3): STATIC criado do zero no GPT Image 2. TRANSIÇÃO: `refAtSec`/`visual` opcionais e `atSec` legado
  // (= refAtSec ?? 0) só até o fechamento; aí o membro vira `AutoStaticDraft` (abaixo). Sem `visual` = violação no validatePlan.
  // 25/10 (estatico-montado-e-molduras-v1 §A2/§A5, TRANSIÇÃO): plano novo traz `layout: 'assembled'` + `copy` + `visualV2`;
  // enquanto o regras.ts lê o legado, a ia preenche também `headline` = `${copy.headline.lead} ${highlight}` e `atSec`.
  // No fechamento o membro vira `AutoStaticDraftV2` (`visualV2` → `visual`; saem `atSec`/`headline`).
  | { type: 'STATIC'; atSec: number; headline: string; refAtSec?: number | null; visual?: StaticVisualDraft;
      layout?: StaticLayout; copy?: StaticCopy; visualV2?: StaticVisualV2 } // headline ≤ 50 (legado)
  // 25/10: FRAME (molduras §B2), fundido na entrega B1
  | AutoFrameDraft
  // 25/10 (headline-e-legenda-v1 §1.2)
  | AutoHeadlineDraft;
/** 25/10 (headline-e-legenda-v1 §1.2): headline do vídeo inteiro. `text` = a headline toda; `highlight` = trecho do `text`
 *  na cor de destaque (null = nenhum; só se a original tem destaque). Limite: replace = nº de caracteres da original × 1,2
 *  (mín. 20, máx. 90); add = 60. Nada inventado (§6.2.5); as do lote diferentes entre si e da original. */
export type AutoHeadlineDraft = { type: 'HEADLINE'; mode: 'replace' | 'add'; text: string; highlight: string | null; sources: Record<string, CopySource> };
/** Params final da peça HEADLINE (variation_items.payload.params validado + o que o backend mede/sabe), lido pelo
 *  `buildHeadlineInput` (api/src/render/headline.ts). */
export type HeadlineSpec = Pick<AutoHeadlineDraft, 'mode' | 'text' | 'highlight'> & {
  /** idioma da headline (H4) */
  language: string;
  /** cor da marca (workspace.brandColor); null = 1ª cor da paleta medida */
  brandColor: string | null;
  /** `replace` sobre o vídeo: cor mediana do fundo dentro da caixa da original. Hoje vem pronta (medição do backend sobre o
   *  editMap); medir no quadro real do campeão é pendência do video (§1.3). null/ausente = cor de contraste (H1). */
  plateColor?: string | null;
  /** legenda automática do lote (campeão sem legenda queimada, §2) */
  captions?: CaptionsAuto | null;
  /** legenda-protegida-v1 §2 (26/10): faixas da legenda queimada que a placa/faixa não pode cruzar (vira HEADLINE_NO_ROOM) */
  protectedBands?: ProtectedBand[];
};
/** @deprecated fusão B1 (25/10): igual a `AutoParamsDraft`. */
export type AutoParamsDraftWithFrame = AutoParamsDraft;

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
/** rev. 23/10: `extends StaticImageCatalog` ligado na R-I (estimateStaticImages). */
export interface CatalogService extends StaticImageCatalog {
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
/** rev. 23/10: `extends StaticImagePort` ligado na R-I (submitStaticImage). */
export interface GenerationService extends StaticImagePort {
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

// ---------- variacao-auto-v1 Revisão 23/10 (§14): STATIC criado do zero no GPT Image 2 (WaveSpeed) ----------
// R-I (23/10, maquina-ia): (2) `GenerationService extends StaticImagePort` e `CatalogService extends StaticImageCatalog`
// ligados; (3) `renderId?` no ProviderTaskFinishedEvent (portas.ts). (1) FICA pro fechamento do arquiteto: o membro STATIC do
// AutoParamsDraft segue com `atSec` legado porque o `iteracao/regras.ts` (backend) ainda lê `atSec`; o planAutoBatch já
// devolve os campos do `AutoStaticDraft` (`refAtSec`, `visual`) + `atSec = refAtSec ?? 0`.
export type StaticStyle = 'everyday_photo' | 'cinematic' | 'ad_graphic';
export type HeadlinePlacement = 'top' | 'center' | 'bottom';
/** Conceito visual do STATIC, em INGLÊS (vai pro prompt do GPT Image 2). Nada de marca/logo/nicho; pessoa só genérica;
 *  nenhum texto entre aspas (o único texto da imagem é a headline). Limites: object ≤ 220, scene ≤ 220, vibe ≤ 140. */
export interface StaticVisualDraft {
  object: string; scene: string; vibe: string;
  style: StaticStyle;
  headlinePlacement: HeadlinePlacement;
}
/** Saída do planAutoBatch pro STATIC (substitui `{ type: 'STATIC'; atSec; headline }`). */
export interface AutoStaticDraft {
  type: 'STATIC';
  /** ≤ 50, screenLanguage, regra "nada inventado" (§6.2.5); escrita pela própria imagem */
  headline: string;
  /** frame-chave do campeão usado como REFERÊNCIA (pessoa/cenário/paleta); nunca copiado. null = nenhum */
  refAtSec: number | null;
  visual: StaticVisualDraft;
}
/** O que o backend manda gerar (= item.payload.params do STATIC depois da validação + idioma da tela). */
export interface StaticImageSpec { headline: string; screenLanguage: string; visual: StaticVisualDraft }
export type StaticAspect = '9:16' | '4:5' | '1:1';
export interface SubmitStaticImageInput {
  workspaceId: string;
  /** o render (formato) que essa imagem preenche → provider_tasks.render_id */
  renderId: string;
  creativeId: string; variationBatchId: string;
  spec: StaticImageSpec;
  aspectRatio: StaticAspect;
  /** true = reenvio automático depois de SAFETY_BLOCK: prompt seguro (sem descrição de pessoa/corpo; mesma headline) */
  safe: boolean;
  /** notes da OFERTA: só o mock lê ([mock:static-reject] / [mock:static-reject-all] / [mock:static-timeout]) */
  notes?: string | null;
  /** 25/10 (TRANSIÇÃO): presente = layout assembled (builder V2, resolução 2k, `edit` se `screenRefUrl`); ausente = `spec` legado */
  specV2?: StaticImageSpecV2;
}
export interface StaticImagePort {
  /** kind STATIC_IMAGE, `openai/gpt-image-2/text-to-image` (quality high, resolution 1k, png, aspect_ratio do formato).
   *  Prompt montado pela ia com `buildStaticImagePrompt(spec, aspect, { safe })` (função pura, campos object/scene/vibe/
   *  photo quality/aspect ratio + `text on the image: "<headline>"`); gravado em provider_tasks.input.prompt.
   *  cost_entry IMAGE (creativeId, variationBatchId, providerTaskId) no fim. Recusa na submissão (WsContentRejected) =
   *  task FAILED SAFETY_BLOCK + provider.task.finished, como no eventos.md §3. Erros síncronos: PROVIDER_UNAVAILABLE, RATE_LIMITED. */
  submitStaticImage(i: SubmitStaticImageInput): Promise<Submitted>;
}
export interface StaticImageCatalog {
  /** US$ de `count` imagens do STATIC (FACE_MODEL_GPT_IMAGE_2 vira STATIC_IMAGE_MODEL no precos.ts: high 1k, 0,22). */
  /** 25/10: `withScreenRef` = `gpt-image-2/edit` com a referência da tela (D4): 0,41 em vez de 0,40 por imagem (2k) */
  estimateStaticImages(count: number, opts?: { withScreenRef?: boolean }): number;
}

// ---------- estatico-montado-e-molduras-v1 (APROVADO 25/10) PARTE A: STATIC "anúncio montado" ----------
// TRANSIÇÃO (mesmo esquema do §14.5): tipos novos ao lado dos de 23/10; ninguém é obrigado a usá-los até a entrega
// A-I/A-B. No fechamento: `AutoStaticDraft` vira `AutoStaticDraftV1` (leitura de plano legado), `SubmitStaticImageInput.spec`
// passa a `StaticImageSpecAny` e `specV2` sai; `ClaudeService extends StaticTextCheckPort`.
import type {
  AutoVariationTypeWithFrame,
  BrollProvenance, BrollProvider, FrameSecondKind, FrameTemplateId, FrameTexts, FrameTwoSourceId, StaticTextCheck, GeneratedProvenance, PieceHeadline,
} from '@maquina/contratos';
export type { AutoVariationTypeWithFrame, PieceHeadline, BrollProvenance, BrollProvider, FrameSecondKind, FrameTemplateId, FrameTexts, FrameTwoSourceId, StaticTextCheck, GeneratedProvenance };

/** `assembled` = único layout de plano novo (D7). `photo_headline` (23-25/10) e `poster` (antes de 23/10) só pra legado (§A5). */
export type StaticLayout = 'assembled';
export type StaticLayoutAny = StaticLayout | 'photo_headline' | 'poster';
/** Conjunto fechado e neutro (o prompt descreve o desenho em palavras, nunca um logo). */
export type StaticIcon =
  | 'moon' | 'sun' | 'clock' | 'calendar' | 'check' | 'shield' | 'lock' | 'heart' | 'star' | 'lightning'
  | 'home' | 'phone' | 'chat' | 'chart' | 'money' | 'gift' | 'person' | 'people' | 'play' | 'leaf'
  | 'target' | 'book' | 'spark' | 'route';
export type StaticEmotion = 'pain' | 'relief' | 'desire' | 'curiosity' | 'pride';
/** De onde saiu o texto de tela. 'generic' só onde a tabela §A3.1 deixa (frase sem afirmação nenhuma). */
export type CopySource = BriefField | 'transcript' | 'generic';
/** Textos de tela por bloco, no idioma da tela. null/[] = o bloco some (nunca texto genérico com promessa). Limites §A2. */
export interface StaticCopy {
  brandLine: string | null; brandLineSource: CopySource | null;                      // ≤ 32
  tagline: string | null; taglineSource?: CopySource | null;                         // ≤ 32 · source: TRANSIÇÃO (§A3.1)
  headline: { lead: string; highlight: string }; headlineSource: CopySource;         // lead ≤ 45, highlight ≤ 22, soma ≤ 60; nunca 'generic'
  subheadline: string | null; subheadlineSource: CopySource | null;                  // ≤ 90
  handwritten: string | null; handwrittenSource?: CopySource | null;                 // ≤ 28 e ≤ 5 palavras
  benefits: { icon: StaticIcon; title: string; line: string; source: CopySource }[]; // 0 ou 3-5; title ≤ 24, line ≤ 40
  trust: { icon: StaticIcon; text: string; source: CopySource }[];                   // 0 ou 3; text ≤ 24
  cta: { main: string; mainSource?: CopySource; sub: string | null; subSource: CopySource | null }; // main ≤ 18, sub ≤ 22
  closing: string | null; closingSource?: CopySource | null;                         // ≤ 50 e ≤ 9 palavras
}
/** Em INGLÊS (vai pro prompt); nada de texto, aspas, marca ou nicho nomeado. */
export interface StaticVisualV2 {
  hero: { person: string; setting: string; emotion: StaticEmotion; light: string } | null; // ≤ 200 / 160 / 80; null = sem pessoa
  product: {
    kind: 'phone_screen' | 'laptop_screen' | 'physical_product' | 'none';
    look: string | null;                         // ≤ 200, sem texto legível
    screenTitle: string | null;                  // ≤ 24, idioma da tela: único texto dentro da tela
    screenTitleSource: CopySource | null;
  };
  mood: string;                                  // ≤ 100
}
/** Saída final do planAutoBatch pro STATIC (§A2). Hoje chega pelo membro STATIC do AutoParamsDraft (TRANSIÇÃO). */
export interface AutoStaticDraftV2 {
  type: 'STATIC'; layout: StaticLayout;
  refAtSec: number | null;
  copy: StaticCopy;
  visual: StaticVisualV2;
}
/** O que o backend manda gerar no layout assembled (§A4). `palette` vem do `paletaDoEstatico` (backend, §A3.3). */
export interface StaticImageSpecV2 {
  layout: 'assembled'; screenLanguage: string; brandName: string;
  palette: { background: string; accent: string };
  copy: StaticCopy; visual: StaticVisualV2;
  /** D4: captura da página ou foto do produto como referência da tela (`gpt-image-2/edit`, +US$ 0,012); null = tela abstrata */
  screenRefUrl: string | null;
}
/** Legado (§A5): spec de 23/10 = `photo_headline`; sem `visual` (plano anterior a 23/10) = `poster`. */
export type StaticImageSpecLegacy = StaticImageSpec & { layout?: 'photo_headline' | 'poster' };
export type StaticImageSpecAny = StaticImageSpecV2 | StaticImageSpecLegacy;
/** §A6: checagem de texto por visão (Haiku). O backend compara (`compararTexto`: NFC, caixa/espaço ignorados, acento conta). */
export interface CheckStaticTextInput {
  workspaceId: string; creativeId: string; variationBatchId: string; renderId: string;
  imageUrl: string; language: string;
  expected: { key: string; text: string; critical: boolean }[];
  /** notes da OFERTA: só o mock lê ([mock:static-text-mismatch] / [mock:static-text-mismatch-all]) */
  notes?: string | null;
}
export interface CheckStaticTextResult { items: { key: string; found: boolean; seen: string | null }[]; extraText: string[] }
/** Grava cost_entry LLM no lote. Falha (Claude fora) = o backend marca `textCheck.status = 'skipped'`; não segura a peça. */
export interface StaticTextCheckPort {
  checkStaticText(i: CheckStaticTextInput): Promise<CheckStaticTextResult & Usage>;
}
/** legenda-protegida-v1 §4.2 (26/10): a legenda queimada (ou a nossa, no modo `replace`) está inteira, legível e sem nada por
 *  cima? 4-6 quadros; cada um com o recorte da faixa em resolução cheia + o quadro inteiro reduzido (lado maior 768).
 *  Haiku 4.5, ~US$ 0,008 por render; grava cost_entry LLM no lote. Falha do Claude = o backend marca `skipped`. */
export interface CheckCaptionInput {
  workspaceId: string; creativeId: string; variationBatchId: string; renderId: string;
  mode: 'avoid' | 'replace';
  language: string;
  frames: { atSec: number; frameUrl: string; /** recorte da faixa em resolução cheia; null/ausente = só o quadro */ bandUrl?: string | null; /** `replace`: as palavras da transcrição nesse instante */ expectedWords: string[] | null }[];
  /** notes da OFERTA: só o mock lê ([mock:caption-covered]) */
  notes?: string | null;
}
export interface CheckCaptionResult { frames: { atSec: number; ok: boolean; covered: boolean; duplicated: boolean; seen: string | null }[] }
export interface CaptionCheckPort {
  checkCaption(i: CheckCaptionInput): Promise<CheckCaptionResult & Usage>;
}

// ---------- estatico-montado-e-molduras-v1 PARTE B: molduras (FRAME) ----------
/** Saída do plano pra uma moldura. `sources`: chave = caminho do texto ("headline", "items.0", "price.to") → fonte.
 *  Todo texto vindo do Brain/da fala tem fonte; os de interface ("POV:", "AO VIVO", "Faça uma pergunta") são do template. */
export type AutoFrameDraft = {
  [K in FrameTemplateId]: { type: 'FRAME'; template: K; texts: FrameTexts[K]; sources: Record<string, CopySource> }
}[FrameTemplateId];
/** Marca na moldura (backend preenche; a IA não escreve): nome = offer.name, handle = workspace.name normalizado, cor = paleta. */
export interface FrameBrand { name: string; handle: string; initials: string; color: string }
/** 2ª mídia (B2, §B3). `stock_broll` = clipe de terceiro (§B3.1) já baixado no nosso storage. */
export type FrameSecondSource =
  | { kind: 'champion_segment'; startSec: number; endSec: number }
  | { kind: 'page_capture'; fileUrl: string; scroll: boolean }
  | { kind: 'product_photo'; fileUrl: string }
  | { kind: 'stock_broll'; fileUrl: string; provenance: BrollProvenance }
  /** 25/10 (D Gusta): reserva quando o Pexels não tem clipe bom. Imagem nossa (GPT Image 2, `BrollPort.fallbackImage`),
   *  já no storage; `prompt`/`model` = proveniência (vai pro README do zip como "imagem gerada"). Sem licença de terceiro. */
  | { kind: 'generated_image'; fileUrl: string; prompt: string; model: string; subject: string }
  /** 25/10 (Gusta): trilha de b-roll que troca conforme a fala (§B3.1 item 9). Substitui o `stock_broll` (1 clipe pro vídeo
   *  todo), que fica só pra compatibilidade com peças antigas. */
  | { kind: 'broll_track'; clips: BrollTrackClip[] };
/** Um clipe da trilha. `fromSec`/`toSec` na linha do tempo da PEÇA: os clipes cobrem a duração toda, em ordem, sem buraco
 *  nem sobreposição; trecho de 2-5 s cortado nas pausas/fim de frase; nunca o mesmo clipe duas vezes seguidas.
 *  `srcStartSec`/`srcEndSec` = trecho do arquivo de origem (mudo; = 0 e a duração do trecho quando é imagem gerada). */
export interface BrollTrackClip {
  fromSec: number; toSec: number;
  fileUrl: string; srcStartSec: number; srcEndSec: number;
  /** a fala que ele ilustra */
  segmentText: string;
  provenance: BrollProvenance | GeneratedProvenance;
}
/** Trecho da fala a ilustrar (segundos do campeão = da peça, a moldura toca o campeão inteiro). */
export interface BrollSegment { startSec: number; endSec: number; text: string }
/** Escolha de um trecho: o clipe já baixado e cortado no nosso storage. */
export interface BrollPick {
  candidateId: string; fileUrl: string; srcStartSec: number; srcEndSec: number;
  provenance: BrollProvenance;
  /** ≤ 160, por que esse clipe ilustra a fala (visão) */
  reason: string;
  /** 25/10: próximos candidatos do mesmo trecho, na ordem da visão (troca de clipe e reserva sem nova busca). Sem aninhar. */
  alternatives?: BrollPick[];
}
/** 1 busca da trilha por LOTE (§B3.1 item 9), reaproveitada por todas as molduras de 2 fontes do lote. */
export interface BrollTrackSearchInput {
  workspaceId: string; batchId: string;
  segments: BrollSegment[];
  offer?: BrollSearchInput['offer'];
  language: string;
  notes?: string | null;
}
/** Params final da peça FRAME (variation_items.payload.params depois da validação), lido pelo buildFrameInput (api/src/render/frame.ts). */
export interface FrameSpec {
  template: FrameTemplateId; texts: FrameTexts[FrameTemplateId]; screenLanguage: string;
  brand: FrameBrand;
  /** foto redonda = frame do campeão no faceTrack (question_box, live, gossip_*); null = sem rosto */
  faceAtSec: number | null;
  second: FrameSecondSource | null;
  /** read_caption (D14) */
  suggestedPrimaryText: string | null;
}
/** §B3.1: busca de b-roll pela fala do roteiro (porta da ia; implementação em api/src/integracoes/broll/, fase B2). */
export interface BrollSearchInput {
  workspaceId: string; variationBatchId: string; jobId: string;
  /** trecho da fala (screenLanguage); a ia monta as queries com as entidades do Brain */
  speech: string; language: string; minSec: number;
  providers: BrollProvider[];
  limit: number;
  /** 25/10: tom e entidades pras queries (nada de nicho embutido; vem da oferta do lote) */
  offer?: { name?: string | null; kind?: string | null; what?: string | null; audience?: string | null } | null;
  /** 25/10: `offer.notes` (gatilhos do mock `[mock:broll-*]`) */
  notes?: string | null;
}
export interface BrollCandidateDraft {
  candidateId: string; provenance: BrollProvenance; posterUrl: string; previewUrl: string | null; durationSec: number; query: string;
  /** 25/10: escolha da ia por visão (contact sheet + fala). O 1º `chosen: true` é o usado; `reason` ≤ 160, uiLocale.
   *  TRANSIÇÃO: opcionais até a ia trocar o `pick` local (BrollCandidatePick) por estes dois e o backend ler daqui. */
  chosen?: boolean;
  reason?: string;
}
export interface BrollPort {
  search(i: BrollSearchInput): Promise<{ candidates: BrollCandidateDraft[] } & Usage>;
  /** 25/10: reserva sem clipe bom (`BROLL_NO_MATCH`): imagem do `subject` no GPT Image 2 → FrameSecondSource `generated_image`.
   *  Grava cost_entry IMAGE no lote. Sem WaveSpeed configurada = NOT_CONFIGURED (o backend cai pro champion_segment). */
  fallbackImage?(i: { workspaceId: string; variationBatchId: string; subject: string }): Promise<{ fileUrl: string; prompt: string; model: string; costUsd: number }>;
  /** 25/10: trilha por fala. `picks[i]` responde `segments[i]` (mesmo tamanho e ordem); `{ none }` = sem b-roll bom →
   *  o backend pede `fallbackImage(fallbackSubject)`; se o teto barrar, estende o clipe vizinho. TRANSIÇÃO opcional até a ia entregar. */
  searchTrack?(i: BrollTrackSearchInput): Promise<{ picks: (BrollPick | { none: true; fallbackSubject: string })[] } & Usage>;
  /** baixa o intervalo, verifica (ffprobe) e ingere no storage; devolve o fileUrl pra FrameSecondSource */
  fetch(i: { workspaceId: string; variationBatchId: string; candidateId: string }): Promise<{ fileUrl: string; provenance: BrollProvenance }>;
}

// ---------- Meta v1 (docs/contratos/meta-v1.md §3, §5, §8; I1, 21/10) ----------
// Porta entre o backend (api/src/meta/, B1) e a integração (api/src/integracoes/meta/). Assinatura em
// integracoes/meta/PORTA.md. A integração NÃO toca no banco: o backend lê a MetaConnection, decifra o token
// (integracoes/meta/cifra.ts) e passa `MetaAuth` em cada chamada; o que volta ele grava. Erros = `MetaError`
// (integracoes/meta/erros.ts) com `code` META_* do contrato, `action`, `details` e `failDetail` (code/subcode/fbtrace).
import type {
  BusinessType, MetaAdTrend, MetaAdVerdict, MetaCallToAction, MetaHealth, MetaMetrics, MetaObjective, MetaOptions,
  MetaPublishSettings, MetaSpecialAdCategory,
} from '@maquina/contratos';
export type { BusinessType, MetaAdTrend, MetaAdVerdict, MetaCallToAction, MetaHealth, MetaMetrics, MetaObjective, MetaOptions, MetaPublishSettings, MetaSpecialAdCategory };

export type MetaMode = 'mock' | 'live' | 'off';
export type MetaReturnTo = '/onboarding/meta' | '/settings/connections' | '/settings' | '/meta/done';
/** Token em claro, só dentro da API (decifrado pelo backend na hora da chamada). Nunca logar, nunca serializar. */
export interface MetaAuth { accessToken: string }

/** `state` do OAuth (JWT HS256 de 10 min assinado com JWT_ACCESS_SECRET; nada no banco). */
export interface MetaOAuthState { workspaceId: string; userId: string; returnTo: MetaReturnTo; nonce: string; expiresAt: string }
/** Resultado da troca do `code` (§3.1 callback). O backend cifra `accessToken` e grava a MetaConnection. */
export interface MetaTokenGrant {
  accessToken: string; tokenType: 'USER_LONG_LIVED';
  /** do debug_token; null = não expira */
  expiresAt: string | null;
  /** escopos concedidos de fato (debug_token.scopes) */
  scopes: string[];
  user: { id: string; name: string };
}
export interface MetaTokenInfo { isValid: boolean; expiresAt: string | null; scopes: string[]; missingScopes: string[] }

/** Conta de anúncios lida ao vivo (`act_<id>?fields=…`). Alimenta a seleção, o health e os defaults de publicação. */
export interface MetaAdAccountInfo {
  id: string; name: string; currency: string; timezoneName: string;
  accountStatus: number; accountStatusLabel: string;
  business: { id: string; name: string } | null;
  /** user_tasks contém MANAGE ou ADVERTISE */
  canManage: boolean;
  /** funding_source_details presente */
  hasFunding: boolean;
  /** minimum_budgets.min_daily_budget_imp (centavos da moeda da conta); null se a leitura falhou */
  minimumDailyBudgetMinor: number | null;
}

/** O que o health precisa saber da conexão (vem da MetaConnection). Contagens vêm dos snapshots do backend. */
export interface MetaHealthInput {
  adAccountId: string | null; pageId: string | null; pixelId: string | null; businessId: string | null;
  /** tokenExpiresAt gravado (o health também consulta o debug_token) */
  tokenExpiresAt: string | null;
  scopes: string[];
  counts: { adsCount: number; activeCount: number };
}
export interface MetaHealthResult {
  health: MetaHealth;
  /** conta relida (null se não há conta escolhida ou se a leitura falhou) — o backend atualiza accountStatus/currency/timezone */
  account: MetaAdAccountInfo | null;
  token: MetaTokenInfo;
}

/** Regra do §5 (env META_WINNER_MIN_SPEND_USD, META_WINNER_MIN_RESULTS, META_TREND_*, META_USD_RATES). */
export interface MetaWinnerRule {
  minSpendUsd: number; minResults: number;
  trendBetter: number; trendWorse: number; trendFreq: number;
  /** moeda da conta → USD (BRL=5.5 significa 5,5 BRL por USD); sem a moeda = 1:1 */
  usdRates: Record<string, number>;
}
/** Uma linha do MetaAdSnapshot sem os ids do banco. `verdict`/`trend` já calculados pela integração (§5).
 *  `metrics*.plays2s`/`hookRate` vêm de `video_continuous_2_sec_watched_actions` (2-Second Continuous Video Plays): a Graph
 *  v25.0 não tem campo de 3 s (22/10, meta/PORTA.md). O nome `plays2s` é do contrato compartilhado; renomear é do arquiteto. */
export interface MetaAdSnapshotDraft {
  metaAdId: string; name: string; effectiveStatus: string;
  campaign: { id: string; name: string }; adset: { id: string; name: string };
  metaCreativeId: string | null; videoId: string | null; thumbnailUrl: string | null;
  resultType: string | null;
  metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
  verdict: MetaAdVerdict; trend: MetaAdTrend | null;
  adCreatedTime: string | null;
  /** campanhas-v1 (22/10): status configurado do anúncio (ACTIVE | PAUSED). Opcional até a I4 entregar; o backend grava 'ACTIVE' se faltar */
  status?: 'ACTIVE' | 'PAUSED';
}

// ---------- campanhas-v1 (docs/contratos/campanhas-v1.md §1, §2, §4; I4/B4, aprovado 22/10) ----------
/** Uma linha do MetaCampaignSnapshot (sem ids do banco). Orçamentos em centavos da moeda da conta (a Graph devolve string). */
export interface MetaCampaignSnapshotDraft {
  campaignId: string; name: string; objective: string;
  status: 'ACTIVE' | 'PAUSED'; effectiveStatus: string;
  buyingType: string | null; bidStrategy: string | null;
  dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null; budgetRemainingMinor: number | null;
  specialAdCategories: string[];
  startTime: string | null; stopTime: string | null; createdTime: string | null;
  /** insights level=campaign nas 3 janelas (com reach/frequency) */
  metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
}
/** Uma linha do MetaAdsetSnapshot. learningStage = learning_stage_info.status (LEARNING | SUCCESS | FAIL). */
export interface MetaAdsetSnapshotDraft {
  adsetId: string; campaignId: string; name: string;
  status: 'ACTIVE' | 'PAUSED'; effectiveStatus: string;
  optimizationGoal: string | null; billingEvent: string | null; bidStrategy: string | null;
  dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null; budgetRemainingMinor: number | null;
  learningStage: 'LEARNING' | 'SUCCESS' | 'FAIL' | null;
  startTime: string | null; endTime: string | null; createdTime: string | null;
  /** insights level=adset nas 3 janelas (com reach/frequency) */
  metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
}
export type MetaObjectLevelPort = 'campaign' | 'adset' | 'ad';
/** Leitura AO VIVO de um objeto antes de escrever (guarda D8 e regras do §4.1). Pais vêm junto pra checar pausa/CBO. */
export interface MetaLiveObject {
  level: MetaObjectLevelPort; id: string; name: string;
  status: 'ACTIVE' | 'PAUSED'; effectiveStatus: string;
  dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null;
  /** pai campanha (em conjunto e anúncio) */
  campaign: { id: string; name: string; status: 'ACTIVE' | 'PAUSED'; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null } | null;
  /** pai conjunto (só em anúncio) */
  adset: { id: string; name: string; status: 'ACTIVE' | 'PAUSED'; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null } | null;
}
/** Último uso lido dos headers X-Business-Use-Case-Usage / x-app-usage / x-ad-account-usage (pct = maior entre os eixos). */
export interface MetaUsage { pct: number; regainSec: number | null; at: string }

export type MetaSyncStage = 'listing_campaigns' | 'listing_adsets' | 'listing_ads' | 'reading_insights' | 'scoring';
export interface MetaSyncInput {
  adAccountId: string;
  /** moeda da conta (pra converter o mínimo em USD da regra) */
  currency: string;
  /** decide o action_type do "resultado" (§3.2); null = link_click */
  businessType: BusinessType | null;
  /** sem pixel = resultado por clique, resultType diz isso */
  hasPixel: boolean;
  /** teto de anúncios lidos (padrão 500) */
  maxAds?: number;
  /** relógio (testes) */
  now?: Date;
}
export interface MetaSyncResult {
  ads: MetaAdSnapshotDraft[];
  /** mediana do CPA dos elegíveis (30 d); null sem elegível */
  medianCpa: number | null;
  rule: { minSpendUsd: number; minResults: number };
  /** anúncios lidos no total (inclui os que não são de vídeo e ficaram fora) */
  listed: number;
  syncedAt: string;
  // campanhas-v1 (22/10): opcionais até a I4 entregar. Com eles, `ads` passa a trazer TODOS os formatos (videoId null =
  // imagem; D2) e o verdict dos não-vídeo é calculado contra a mediana dos VÍDEOS (medianCpa continua só de vídeo).
  campaigns?: MetaCampaignSnapshotDraft[];
  adsets?: MetaAdsetSnapshotDraft[];
  /** passou de maxAds (500) em algum nível */
  truncated?: boolean;
}

export type MetaPublishStage = 'uploading_video' | 'processing_video' | 'creating_campaign' | 'creating_adset' | 'creating_creative' | 'creating_ad';
export const META_PUBLISH_STAGES: readonly MetaPublishStage[] = ['uploading_video', 'processing_video', 'creating_campaign', 'creating_adset', 'creating_creative', 'creating_ad'];
/** Tudo que as 6 etapas precisam (a MetaPublication + o render). O mock lê os gatilhos do §8 em `settings.primaryText`/`headline`. */
export interface MetaPublishInput {
  adAccountId: string; pageId: string; pixelId: string | null;
  /** nome na Meta (campanha, conjunto, anúncio, vídeo, criativo) = Creative.adName (D10; `_2` em republicação é do backend) */
  adName: string;
  settings: MetaPublishSettings;
  video: {
    /** URL pública (assinada) do render: a Meta baixa (`file_url`). Vazio/privado → `read` (upload resumable) */
    fileUrl: string | null;
    /** tamanho em bytes + leitura por faixa (storage), pro upload resumable em pedaços de 8 MB */
    sizeBytes: number | null;
    read: ((offset: number, length: number) => Promise<Buffer>) | null;
  };
  /** thumbnail JPEG/PNG do render (assinado ≥ 6 h) = `image_url` do video_data. `null` = sem JPEG: o creative vai sem `image_url` e a Meta gera o thumb do vídeo (nunca passe a URL do .mp4 aqui) */
  thumbnailUrl: string | null;
}
/** Ids já criados (retomada idempotente: etapa com id gravado não roda de novo). */
export interface MetaPublishIds { videoId: string | null; creativeId: string | null; campaignId: string | null; adsetId: string | null; adId: string | null }

export interface MetaServiceStatus { mode: MetaMode; configured: boolean; appIdMasked: string | null; graphVersion: string }

/**
 * MetaService (token META_SERVICE). Mock (META_MODE=mock, padrão), live (Graph API) e off. Todas as chamadas que
 * recebem `auth` podem lançar MetaError META_TOKEN_INVALID (code 190 / is_valid false → o backend marca TOKEN_INVALID),
 * META_PERMISSION, META_UNAVAILABLE ({ reason: 'rate_limited' | 'down', retryAfterSec }) e META_ERROR.
 * Em `off`/live sem config, toda chamada lança META_NOT_CONFIGURED { reason: 'off' | 'not_configured' }.
 */
export interface MetaService {
  /** ServiceStatus.provider = 'META' (connected = configurado; keyMasked = app id mascarado). Síncrono, sem rede. */
  status(): MetaServiceStatus;

  // ---------- §3.1 OAuth e conexão ----------
  /** URL do diálogo (live: facebook.com/<v>/dialog/oauth?…config_id…; mock: <api>/api/v1/meta/callback?code=mock&state=…). */
  buildAuthUrl(i: { workspaceId: string; userId: string; returnTo: MetaReturnTo }): { url: string; state: string; expiresAt: string };
  /** Valida assinatura, prazo (10 min) e, se pedido, dono. Falha = META_STATE_INVALID. */
  verifyState(state: string | undefined | null, expect?: { workspaceId?: string; userId?: string }): MetaOAuthState;
  /** Query do callback → token long-lived + debug_token + /me. Falhas: META_OAUTH_DENIED (error=access_denied),
   *  META_SCOPES_MISSING { missing } (não gravar a conexão), META_OAUTH_FAILED (code usado/expirado/redirect/secret),
   *  META_UNAVAILABLE. Mock: code 'mock' ok; 'mock-denied' / 'mock-scopes' / 'mock-failed' = os 3 erros. */
  exchangeCode(q: { code?: string | null; error?: string | null; errorReason?: string | null; errorDescription?: string | null }): Promise<MetaTokenGrant>;
  /** debug_token: validade, prazo, escopos e os que faltam dos 4 do §4. is_valid=false NÃO lança (volta isValid:false). */
  inspectToken(auth: MetaAuth): Promise<MetaTokenInfo>;
  /** DELETE /me/permissions (melhor esforço: nunca lança). */
  revoke(auth: MetaAuth): Promise<void>;

  /** GET /meta/options ao vivo: contas (canManage/permissionReason), páginas, pixels (só da conta de `adAccountId`). */
  listOptions(auth: MetaAuth, q: { adAccountId?: string | null }): Promise<MetaOptions>;
  /** Conta de anúncios completa (seleção, health, defaults). Conta inexistente/sem acesso = META_PERMISSION. */
  readAdAccount(auth: MetaAuth, adAccountId: string): Promise<MetaAdAccountInfo>;
  /** Os 8 checks do §3.1 com níveis ok/warn/bad e `canPublish`. Só lança quando a checagem não roda (token/rede). */
  health(auth: MetaAuth, i: MetaHealthInput): Promise<MetaHealthResult>;

  // ---------- §3.2 leitura ----------
  /** Anúncios de VÍDEO da conta + 3 janelas de insights → snapshots com verdict/trend (§5). `onProgress` alimenta o
   *  job META_SYNC (`total` conhecido a partir de listing_ads). */
  syncAds(auth: MetaAuth, i: MetaSyncInput, onProgress?: (p: { stage: MetaSyncStage; done: number; total: number }) => void): Promise<MetaSyncResult>;
  /** GET /{videoId}?fields=source,… → URL temporária da CDN pro `storage.ingestVideoWithThumbnail`.
   *  Sem `source` = META_VIDEO_UNAVAILABLE (action upload_video). Mock: videoId 'mock_video_novideo' cai aqui. */
  videoSource(auth: MetaAuth, videoId: string, ctx?: { adAccountId?: string | null; pageId?: string | null }): Promise<{ sourceUrl: string; permalinkUrl: string | null; lengthSec: number | null }>;
  /** Regra do §5 em uso (pra MetaSummary.rule e pra recalcular sobre snapshots). */
  rule(): MetaWinnerRule;

  // ---------- §3.3 publicação (6 etapas; o backend grava o id de cada uma antes da próxima) ----------
  /** 1. POST act/advideos (file_url ou resumable 8 MB). Falhas: META_VIDEO_REJECTED, META_PERMISSION, META_ERROR. */
  uploadVideo(auth: MetaAuth, i: MetaPublishInput): Promise<{ videoId: string }>;
  /** 2. GET /{videoId}?fields=status a cada 3 s até ready (teto 10 min → META_ERROR action retry; error → META_VIDEO_REJECTED). */
  waitVideoReady(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds, opts?: { timeoutMs?: number; onPoll?: (status: string) => void }): Promise<void>;
  /** 3. POST act/campaigns (PAUSED, AUCTION). */
  createCampaign(auth: MetaAuth, i: MetaPublishInput): Promise<{ campaignId: string }>;
  /** 4. POST act/adsets (PAUSED, orçamento diário, público amplo, optimization_goal/promoted_object por objetivo).
   *  Falhas: META_BUDGET_TOO_LOW { minimumMinor, currency }, META_PAYMENT_REQUIRED, META_ACCOUNT_UNUSABLE. */
  createAdSet(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds): Promise<{ adsetId: string }>;
  /** 5. POST act/adcreatives (object_story_spec.video_data). Falhas: META_POLICY (edit_ad_text), META_PERMISSION (page). */
  createAdCreative(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds): Promise<{ creativeId: string }>;
  /** 6. POST act/ads (PAUSED) + preview opcional. */
  createAd(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds): Promise<{ adId: string; previewUrl: string | null }>;
  /** activate = ACTIVE em [adId, adsetId, campaignId]; pause = PAUSED só no adId. Falhas: META_TOKEN_INVALID, META_PERMISSION, META_ACCOUNT_UNUSABLE. */
  setStatus(auth: MetaAuth, i: { objectIds: string[]; status: 'ACTIVE' | 'PAUSED' }): Promise<void>;
  /** https://adsmanager.facebook.com/adsmanager/manage/ads?act=<id sem act_>&selected_ad_ids=<adId> (mock: '#'). */
  adsManagerUrl(adAccountId: string, adId: string): string;

  // ---------- campanhas-v1 §4 (I4, entregue 22/10: mock + live; escrita live NUNCA exercitada de verdade, só fetch falso) ----------
  // `syncAds` passa a devolver também `campaigns`/`adsets`/`truncated` (MetaSyncResult) lendo act/campaigns, act/adsets e
  // insights level=campaign|adset nas 3 janelas (campos no campanhas-v1 §1), etapas listing_campaigns → listing_adsets →
  // listing_ads → reading_insights → scoring. `setStatus` (acima) serve às escritas da Campaigns com 1 id por chamada
  // (o backend passa os pais junto quando includeParents).
  /** GET /{id}?fields=status,effective_status,daily_budget,lifetime_budget,campaign{…},adset{…} AO VIVO.
   *  Objeto inexistente/apagado = MetaError META_OBJECT_GONE. Mock: objeto com `[mock:stale]` no nome devolve status/orçamento
   *  diferentes do snapshot (o backend responde META_OBJECT_CHANGED); `[mock:meta-rate]`/`[mock:meta-token]` lançam os erros. */
  readObject(auth: MetaAuth, i: { level: MetaObjectLevelPort; id: string }): Promise<MetaLiveObject>;
  /** POST /{id} daily_budget=<minor> (campanha CBO ou conjunto ABO). Falhas: META_BUDGET_TOO_LOW { minimumMinor, currency },
   *  META_BUDGET_NOT_EDITABLE (a Meta recusou porque o orçamento mora no outro nível), META_PERMISSION, META_ACCOUNT_UNUSABLE.
   *  As regras de produto (teto 2×, expected) são do backend; aqui só a chamada e o mapa de erro. */
  setDailyBudget(auth: MetaAuth, i: { level: 'campaign' | 'adset'; id: string; dailyBudgetMinor: number }): Promise<void>;
  /** Link do Ads Manager por nível (campanhas-v1 §5.4; mock: '#'). Substitui `adsManagerUrl` quando a I4 entregar. */
  objectUrl(adAccountId: string, level: MetaObjectLevelPort, id: string): string;
  /** Último uso de cota da Meta visto pelo cliente Graph (null antes da 1ª chamada / mock). O backend bloqueia escrita com pct ≥ META_WRITE_USAGE_CEILING (90). */
  usage(): MetaUsage | null;
}
