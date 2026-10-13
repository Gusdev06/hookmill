// §13.15 de docs/contratos/feature-2-variar-campeao.md (08/10): Trocar avatar com motor escolhível (Lipsync · Kling 3.0 ·
// Seedance 2.0), sempre mantendo a edição do campeão. Dono: maquina-arquiteto. SÓ TIPOS.
//
// Exportado pelo index.ts desde 08/10 (janela de reinício liberada pelo Gusta).
import type { AssetStatus, EstimateLine, FileRef, KeepEditBlockerHit } from './index';

/** Motor do Trocar avatar, no lote. LIPSYNC = Pruna (take único, §13.3), padrão e mais barato. */
export type SwapEngine = 'LIPSYNC' | 'KLING' | 'SEEDANCE';
/** Áudio do Trocar avatar com motor de vídeo (no index.ts, VoiceSource ganha 'ENGINE_VOICE'). */
export type SwapVoiceSource = 'CHAMPION_AUDIO' | 'ENGINE_VOICE';
/** Resolução da janela: Kling sai sempre 1080p (sem parâmetro); Seedance 480p ou 720p pela região (§13.15.3). */
export type SwapResolution = '480p' | '720p' | '1080p';

/** Uma geração do Kling/Seedance (image-to-video) dentro de um trecho main. Tempos em s relativos ao início do trecho. */
export interface SwapWindow {
  index: number;
  startSec: number; endSec: number;        // fatia do trecho que esta janela cobre (corte no meio de um silêncio)
  genSec: number;                          // duração pedida ao motor (inteiro, ≥ mínimo do motor, ≤ 15)
  startImage: 'FACE' | 'PREVIOUS_LAST_FRAME';   // 1ª janela = rosto escolhido; as seguintes = último frame da anterior
  resolution: SwapResolution;
  status: AssetStatus; attempt: number; seed: number;
  clip: FileRef | null;
}
/** Reencaixe da voz do motor (só ENGINE_VOICE). ratio = fala do motor / fala do campeão no trecho. */
export interface SwapFit {
  mode: 'EXACT' | 'STRETCH';               // |ratio-1| ≤ 0,02 = EXACT (só corte); ≤ 0,08 = STRETCH (setpts + atempo)
  ratio: number; sourceSec: number; voiceSec: number;
  cutStartSec: number; cutEndSec: number;  // janela usada do clipe emendado, antes do stretch
}
/** Cena `pipeline: 'SWAP_VIDEO'` = 1 trecho main contíguo da timeline (§13.14). No index.ts: `Scene.swap: SceneSwap | null`. */
export interface SceneSwap {
  engine: Exclude<SwapEngine, 'LIPSYNC'>;
  voiceSource: SwapVoiceSource;
  startFrame: number; endFrame: number;    // grade do campeão, [start, end)
  windows: SwapWindow[];
  stage: 'windows' | 'joining' | 'lipsync' | 'transcribing' | 'fitting' | 'checking' | 'done';
  fit: SwapFit | null;
  identityScore: number | null;            // SFace, mediana do cosseno (clipe × rosto escolhido)
  regenerateEstimateUsd: number;           // "Refazer trecho (US$ x)"
}
/** Preço lado a lado (GET /variation-batches/:id/estimate → BatchEstimate.swapQuotes). Uma linha por combinação. */
export interface SwapQuote {
  engine: SwapEngine;
  voiceSource: SwapVoiceSource;            // LIPSYNC só aparece com CHAMPION_AUDIO
  available: boolean;
  /** por que não dá: bloqueio de manter a edição (ENGINE_VOICE: caption_unredrawable…) ou 'not_enabled' (build) */
  blockers: KeepEditBlockerHit[]; notEnabled: boolean;
  /** por que a combinação está fora do build/produto (com notEnabled: true). Bloqueio do campeão vai em `blockers`. */
  disabledReason?: SwapDisabledReason | null;
  selected: boolean;                       // = settings atuais do lote
  resolution: SwapResolution | null;       // Seedance: a escolhida pela região; Kling 1080p; LIPSYNC null
  perItemUsd: number; costUsd: number;     // costUsd = perItemUsd × itens SWAP_AVATAR incluídos (+ rostos já contados à parte)
  etaSec: number;
  lines: EstimateLine[];                   // de 1 item (VIDEO, LIPSYNC, TRANSCRIBE)
  warnings: SwapQuoteWarning[];
}
/** = `rule` do 400 VALIDATION_ERROR quando o lote tenta a combinação. */
export type SwapDisabledReason =
  | 'engine_voice_seedance_only'   // KLING + ENGINE_VOICE: decisão do Gusta (08/10), (B) só no Seedance
  | 'engine_voice_not_enabled';    // SEEDANCE + ENGINE_VOICE enquanto a cadeia (B) não estiver liberada
export type SwapQuoteWarning =
  | 'voice_may_vary'      // ENGINE_VOICE: o motor pode mudar a voz entre trechos (sem voz de referência na API)
  | 'music_bed_drops'     // ENGINE_VOICE: o campeão tem música por baixo da fala; nos trechos main ela some
  | 'short_segment_padded'; // trecho < mínimo do motor (Kling 3 s, Seedance 4 s): paga o mínimo

// ── códigos novos (no index.ts: AsyncErrorCode e KeepEditBlocker) ──
export type SwapAsyncErrorCode =
  | 'VOICE_FIT_OUT_OF_RANGE'   // ENGINE_VOICE: |ratio-1| > 0,08 · details { ratio, sourceSec, voiceSec }
  | 'SPEECH_MISMATCH'          // ENGINE_VOICE: transcrição do motor casa < 85 % das palavras da copy
  | 'IDENTITY_DRIFT';          // SFace: o clipe virou outra pessoa (mediana < 0,363 ou algum frame amostrado < 0,30)
export type SwapKeepEditBlocker = 'caption_unredrawable';   // ENGINE_VOICE: legenda sem fundo fora da região num trecho main
