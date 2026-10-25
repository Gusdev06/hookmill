// Tabela de modelos e preços (WaveSpeed; rosto na Higgsfield) usada pelo CatalogService e pela estimativa.
// Fonte de cada número: docs/integracoes.md (página do modelo conferida em 05/10/2026).
// Regra: o preço base da WaveSpeed é POR UNIDADE (segundo, imagem, mil caracteres), nunca por chamada.

export type EngineId = 'SCENES' | 'LIPSYNC';

export interface SceneModel {
  /** id opaco que o web vê (GET /engines) */
  id: string;
  label: string;
  engine: EngineId;
  /** id do modelo na WaveSpeed */
  providerModel: string;
  /** limite de duração de UM clipe gerado (s) */
  maxSceneSec: number;
  /** duração mínima cobrada/aceita por clipe (s) */
  minSceneSec: number;
  /** o modelo só aceita segundos inteiros */
  integerSeconds: boolean;
  /** US$ por segundo de vídeo (já com áudio nativo / resolução escolhida) */
  usdPerSecond: number;
  /** parâmetros fixos que mudam o preço (registrados pra auditoria) */
  pricedWith: string;
  /** tempo de fila + geração por clipe, em s (estimativa; medir na sonda G3) */
  etaBaseSec: number;
  etaPerSecond: number;
}

export const SCENE_MODELS: SceneModel[] = [
  {
    id: 'kling-3.0',
    label: 'Kling 3.0',
    engine: 'SCENES',
    providerModel: 'kwaivgi/kling-v3.0-pro/image-to-video',
    maxSceneSec: 15,
    minSceneSec: 3,
    integerSeconds: true,
    usdPerSecond: 0.168, // US$ 0,56 / 5 s = 0,112/s, × 1,5 com sound=true
    pricedWith: 'sound=true',
    etaBaseSec: 90,
    etaPerSecond: 12,
  },
  {
    id: 'seedance-2.0',
    label: 'Seedance 2.0',
    engine: 'SCENES',
    providerModel: 'bytedance/seedance-2.0/image-to-video',
    maxSceneSec: 15,
    minSceneSec: 4,
    integerSeconds: true,
    // Página: US$ 0,12/s em 480p, × 2 em 720p (áudio nativo incluso). Sonda G3 (05/10): 4 s em 480p cobrou
    // US$ 0,432 = 0,108/s (10% abaixo da página). Fica 0,24 até confirmar o 720p no billing (estimar pra cima).
    usdPerSecond: 0.24,
    pricedWith: 'resolution=720p, generate_audio=true',
    etaBaseSec: 90,
    etaPerSecond: 12,
  },
  {
    id: 'pruna-lipsync',
    label: 'Lipsync',
    engine: 'LIPSYNC',
    providerModel: 'pruna-ai/p-video/avatar',
    // maxSceneSec = tamanho de CENA (fatia) mostrado no catálogo. Desde 06/10 (§13.5, regra do Gusta) o lipsync é UM take
    // por criativo com o áudio inteiro (até 600 s, TAKE_MAX_SEC) e as cenas são fatias dele (sliceTake).
    maxSceneSec: 30,
    minSceneSec: 2, // áudio < ~1 s falha ("Service temporarily unavailable"); mandar >= 2 s
    integerSeconds: false,
    usdPerSecond: 0.025, // 720p; cobra segundos de áudio arredondados pra cima
    pricedWith: 'resolution=720p',
    etaBaseSec: 60,
    etaPerSecond: 4,
  },
];

/**
 * Rosto: Higgsfield Soul V2 (troca aprovada pelo Gusta em 06/10, após A/B de 4 rostos contra o gpt-image-2 high).
 * Preço pela rota grátis POST /estimate da Higgsfield: 1080p 9:16 = US$ 0,006 (0,090 crédito); 720p = 0,004.
 * failed/nsfw não cobram.
 */
export const FACE_MODEL = {
  provider: 'HIGGSFIELD' as const,
  providerModel: 'higgsfield-ai/soul/v2/standard',
  aspectRatio: '9:16' as const,
  resolution: '1080p' as const,
  usdPerImage: 0.006,
  etaSec: 25, // ~20 s medidos no teste de 06/10
};

/** Rosto anterior (WaveSpeed gpt-image-2 high/1k, US$ 0,22). Fica só como referência de preço/histórico. */
export const FACE_MODEL_GPT_IMAGE_2 = {
  providerModel: 'openai/gpt-image-2/text-to-image',
  quality: 'high' as const,
  resolution: '1k' as const,
  usdPerImage: 0.22,
};

/**
 * Imagem da peça STATIC. rev. 23/10 (§14.3): criada do zero (nunca o frame do campeão). 25/10 (estatico-montado-e-molduras
 * §A7/§A8, D1 = 2k): página da WaveSpeed lida 25/10 ("o valor final da task prevalece"): text-to-image high = US$ 0,22 (1k)
 * / 0,40 (2k) / 0,72 (4k); edit high = 0,23 / 0,41 / 0,73 com 1 imagem de entrada, +0,012 por imagem extra. Billing de
 * 06/10 cobrou 0,209 no 1k (estimar pra cima com a página). Falha/recusa não cobra. Aspectos 9:16, 4:5 e 1:1 nos dois.
 * 2k 9:16 medido 1440×2560 em 85 s (sonda S1, 25/10); 1k medido 768×1360 e 864×1536 (varia). Legado (photo_headline/poster)
 * também sai em 2k: o spec reproduz o plano, a resolução é do produto.
 */
export const STATIC_IMAGE_MODEL = {
  providerModel: FACE_MODEL_GPT_IMAGE_2.providerModel,
  /** D4: com referência da tela (captura da página / foto do produto) */
  editProviderModel: 'openai/gpt-image-2/edit',
  quality: 'high' as const,
  resolution: '2k' as const,
  outputFormat: 'png' as const,
  /** text-to-image high 2k */
  usdPerImage: 0.4,
  /** edit high 2k com 1 imagem de entrada */
  usdPerImageEdit: 0.41,
  /** edit: cada imagem de entrada além da 1ª */
  usdPerExtraInput: 0.012,
  /** fila + geração por imagem (s), o que o backend usa no renderEtaSec: 1k medido 72-82 s, 2k 85 s (S1) */
  etaSec: 90,
  /** reconciliador (§14.3.5): consulta a partir de 2 min sem webhook, TIMEOUT com 10 min */
  pollAfterMs: 2 * 60_000,
  timeoutMs: 10 * 60_000,
};

/** US$ de 1 imagem do STATIC: text-to-image, ou edit com `inputs` imagens de referência (≥ 1). */
export function staticImageUsd(inputs = 0): number {
  const m = STATIC_IMAGE_MODEL;
  return inputs > 0 ? round4(m.usdPerImageEdit + (inputs - 1) * m.usdPerExtraInput) : m.usdPerImage;
}

/**
 * §A6: checagem de texto do STATIC por visão. Modelo do contrato: Haiku 4.5 (US$ 1 / 5 por milhão). A imagem 9:16 vai em
 * 2 metades sobrepostas (lado maior ≤ 1568 px cada, ~2,6 mil tokens cada) pra o acento ser legível; ~5,5 mil tokens de
 * entrada + ~400 de saída ≈ US$ 0,0075 (estimativa; o real vem do usage e vira cost_entry LLM no lote).
 * `ANTHROPIC_TEXT_CHECK_MODEL` troca o modelo (ex.: claude-haiku-5-5, US$ 0,10 / 0,50: ~10× mais barato, não sondado).
 */
export const STATIC_TEXT_CHECK_MODEL = {
  model: 'claude-haiku-4-5',
  estimatedUsd: 0.0075,
  /** lado maior de cada recorte (o Claude reduz acima disso) */
  maxSidePx: 1568,
  maxTokens: 4000,
};

export const TTS_MODEL = {
  providerModel: 'minimax/speech-2.6-turbo',
  usdPerChar: 0.00006, // US$ 0,06 por mil caracteres
  /** schema do modelo (wavespeed schema, 06/10): "Maximum 10000 characters" — ~600 s de fala cabem (§13.5) */
  maxChars: 10000,
  etaSec: 15,
};

export const TRANSCRIBE_MODEL = {
  /** aceita vídeo ou áudio por URL; timestamps por palavra */
  providerModel: 'wavespeed-ai/openai-whisper-with-video',
  usdPerSecond: 0.002, // 0,001/s sem timestamp; com enable_timestamps=true dobra
  etaSec: 20,
};

/** Fala em voz alta: ~2,6 palavras/s (ritmo de anúncio). Usado pra estimar TTS/lipsync antes de existir áudio. */
export const WORDS_PER_SECOND = 2.6;

export interface VoiceDef {
  id: string;
  name: string;
  gender: 'female' | 'male' | 'neutral';
}

/** Vozes prontas do MiniMax Speech 2.6 (multilíngues: o idioma vai em language_boost). */
export const VOICES: VoiceDef[] = [
  { id: 'Wise_Woman', name: 'Wise Woman', gender: 'female' },
  { id: 'Calm_Woman', name: 'Calm Woman', gender: 'female' },
  { id: 'Inspirational_girl', name: 'Inspirational Girl', gender: 'female' },
  { id: 'Lively_Girl', name: 'Lively Girl', gender: 'female' },
  { id: 'Lovely_Girl', name: 'Lovely Girl', gender: 'female' },
  { id: 'Sweet_Girl_2', name: 'Sweet Girl', gender: 'female' },
  { id: 'Exuberant_Girl', name: 'Exuberant Girl', gender: 'female' },
  { id: 'Abbess', name: 'Abbess', gender: 'female' },
  { id: 'Deep_Voice_Man', name: 'Deep Voice Man', gender: 'male' },
  { id: 'Casual_Guy', name: 'Casual Guy', gender: 'male' },
  { id: 'Patient_Man', name: 'Patient Man', gender: 'male' },
  { id: 'Young_Knight', name: 'Young Knight', gender: 'male' },
  { id: 'Determined_Man', name: 'Determined Man', gender: 'male' },
  { id: 'Decent_Boy', name: 'Decent Boy', gender: 'male' },
  { id: 'Imposing_Manner', name: 'Imposing Manner', gender: 'male' },
  { id: 'Elegant_Man', name: 'Elegant Man', gender: 'male' },
  { id: 'Friendly_Person', name: 'Friendly Person', gender: 'neutral' },
];

/** Idiomas que oferecemos pra voz (BCP 47). A MiniMax fala 40+; a lista cresce quando houver demanda. */
export const VOICE_LANGUAGES = ['en', 'pt-BR', 'es'];

export function findSceneModel(id: string): SceneModel | undefined {
  return SCENE_MODELS.find((m) => m.id === id);
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Duração estimada da fala (s), 1 casa decimal, mínimo 1 s. */
export function speechSeconds(text: string): number {
  const s = countWords(text) / WORDS_PER_SECOND;
  return Math.max(1, Math.round(s * 10) / 10);
}

// ---------------------------------------------------------------- §13.15: Trocar avatar com motor Kling/Seedance

export interface SwapEngineDef {
  /** id do catálogo (SceneModel.id) e modelo na WaveSpeed */
  catalogModel: 'kling-3.0' | 'seedance-2.0';
  providerModel: string;
  /** duração mínima aceita/cobrada por janela (s, inteiro) */
  minSec: number;
  /** US$/s da janela pela resolução e por ter som (Kling cobra 1,5× com som; Seedance inclui o áudio) */
  usdPerSecond: (resolution: '480p' | '720p' | '1080p', sound: boolean) => number;
  etaBaseSec: number;
  etaPerSecond: number;
}

/**
 * Motores de vídeo do Trocar avatar. Preço por SEGUNDO pedido (inteiro). Fontes (docs/integracoes.md §13.15):
 * Kling 3.0 Pro i2v 1080p: 0,112/s sem som (sonda 05/10, billing = página), 0,168/s com som (re-sonda 06/10: 3 s = 0,504).
 * Seedance 2.0 i2v: 480p 0,108/s cobrado nas sondas de 05-06/10 com e sem áudio (página: 0,12); 720p 0,24/s (página,
 * ainda não visto cobrado; estimar pra cima).
 */
export const SWAP_ENGINES: Record<'KLING' | 'SEEDANCE', SwapEngineDef> = {
  KLING: {
    catalogModel: 'kling-3.0',
    providerModel: 'kwaivgi/kling-v3.0-pro/image-to-video',
    minSec: 3,
    usdPerSecond: (_res, sound) => (sound ? 0.168 : 0.112),
    etaBaseSec: 90,
    etaPerSecond: 12,
  },
  SEEDANCE: {
    catalogModel: 'seedance-2.0',
    providerModel: 'bytedance/seedance-2.0/image-to-video',
    minSec: 4,
    usdPerSecond: (res) => (res === '480p' ? 0.108 : 0.24),
    etaBaseSec: 90,
    etaPerSecond: 12,
  },
};

/**
 * Sonda S2 (08/10): a voz do motor se mantém entre janelas/trechos do mesmo item? Embedding de locutor (Resemblyzer),
 * cosseno entre 3 janelas (w1 do último frame da w0; w2 do rosto, como trecho novo). Escala medida no campeão: mesma
 * falante 0,78-0,91, falantes diferentes 0,68-0,72.
 * Seedance 480p: 0,88 / 0,92 / 0,92 → mantém. Kling: 0,88 (encadeada) mas 0,80 e 0,68 contra o trecho novo → muda.
 * O backend usa isto pro `notEnabled` do (B); `estimateSwap` avisa `voice_may_vary` onde for false.
 */
export const SWAP_ENGINE_VOICE_CONSISTENT: Record<'KLING' | 'SEEDANCE', boolean> = { KLING: false, SEEDANCE: true };

/** Regras numéricas do §13.15.2/§13.15.3 (num lugar só, testadas em troca-motor.spec.ts). */
export const SWAP_LIMITS = {
  /** fonte máxima por janela: (A) áudio do campeão / (B) voz do motor (folga pra fala mais lenta caber nos 15 s) */
  championAudioSourceSec: 14.5,
  engineVoiceSourceSec: 12.5,
  maxGenSec: 15,
  /** (A) genSec = ceil(len + 0,2); (B) genSec = ceil(len × 1,15 + 0,3) */
  championAudioPadSec: 0.2,
  engineVoiceSlack: 1.15,
  engineVoicePadSec: 0.3,
  /** silêncio mínimo pra cortar janela no meio dele */
  minSilenceSec: 0.15,
  /** reencaixe: |f−1| ≤ 0,02 só corta; ≤ 0,08 estica; acima = VOICE_FIT_OUT_OF_RANGE */
  fitExactMax: 0.02,
  fitStretchMax: 0.08,
  /** Seedance 480p se a região pede ≤ 110 % dos pixels do quadro 480p */
  res480MaxFill: 1.1,
};

/**
 * Lipsync vídeo-a-vídeo do caminho (A): nosso clipe mudo + fatia do áudio do campeão. Escolhido na sonda S1 (08/10).
 * Cobra por segundo do VÍDEO de entrada. `sync_mode: cut_off` (o clipe já sai cortado no nº exato de frames do trecho).
 */
export const SWAP_V2V_MODEL = {
  providerModel: 'sync/lipsync-2',
  usdPerSecond: 0.05,
  syncMode: 'cut_off' as const,
  /** ~109 s por chamada na página; medir */
  etaBaseSec: 90,
  etaPerSecond: 4,
};
