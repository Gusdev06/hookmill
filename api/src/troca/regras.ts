import type { AssetStatus, BatchSettings, SceneSwap, SwapEngine, SwapResolution, SwapVoiceSource, SwapWindow } from '@maquina/contratos';
import { AppException } from '../common/errors/app-exception';
import type { SwapModel, SwapWindowPlan } from './portas';

/**
 * Regras puras do Trocar avatar com motor de vídeo (§13.15). Sem banco, sem provedor: o que é válido, como a cena é
 * gravada e em que etapa ela está.
 */

export type VideoSwapEngine = Exclude<SwapEngine, 'LIPSYNC'>;
export const SWAP_MODEL: Record<VideoSwapEngine, SwapModel> = { KLING: 'kling-3.0', SEEDANCE: 'seedance-2.0' };
export const isVideoEngine = (e: SwapEngine | null | undefined): e is VideoSwapEngine => e === 'KLING' || e === 'SEEDANCE';
export const engineOfModel = (m: string | null | undefined): VideoSwapEngine | null =>
  m === SWAP_MODEL.KLING ? 'KLING' : m === SWAP_MODEL.SEEDANCE ? 'SEEDANCE' : null;

/**
 * (B) ENGINE_VOICE: a sonda S2 (ia, 08/10) só achou voz consistente entre janelas no Seedance; Kling = só (A)
 * (decisão do Gusta 08/10: KLING + ENGINE_VOICE = 400). Cadeia (B) no build desde 08/10 (Jest de ponta a ponta no mock).
 */
export const ENGINE_VOICE_BUILT = true;
const ENGINE_VOICE_ENGINES: SwapEngine[] = ['SEEDANCE'];
export const engineVoiceEnabled = (e: SwapEngine | null | undefined) => ENGINE_VOICE_BUILT && !!e && ENGINE_VOICE_ENGINES.includes(e);

/** §13.15.3 passo 4: SFace, mediana ≥ 0,363 e nenhuma amostra < 0,30. */
export const IDENTITY_MEDIAN_MIN = 0.363;
export const IDENTITY_SAMPLE_MIN = 0.3;
export const identityOk = (s: { median: number; min: number }) => s.median >= IDENTITY_MEDIAN_MIN && s.min >= IDENTITY_SAMPLE_MIN;

/** Seed da tentativa (7 na 1ª, +1 a cada "Refazer trecho"): mesmo esquema do take. */
export const swapSeed = (attempt: number) => 6 + Math.max(1, attempt);

const bad = (field: string, rule: string) => new AppException('VALIDATION_ERROR', { fields: [{ field, rule }] });

/**
 * Tabela da §13.15.1 (combinações válidas de swapEngine × voiceSource × keepEdit). Lança 400 VALIDATION_ERROR.
 * LIPSYNC segue como antes (keepEdit força CHAMPION_AUDIO; limpo aceita CATALOG).
 */
export function validateSwapSettings(s: Pick<BatchSettings, 'swapEngine' | 'voiceSource' | 'keepEdit'>): void {
  const video = isVideoEngine(s.swapEngine);
  if (!video && s.voiceSource === 'ENGINE_VOICE') throw bad('settings.voiceSource', 'engine_voice_needs_video_engine');
  if (video && !s.keepEdit) throw bad('settings.swapEngine', 'video_engine_needs_keep_edit');
  if (video && s.voiceSource === 'CATALOG') throw bad('settings.voiceSource', 'catalog_voice_not_in_keep_edit');
  // decisão do Gusta 08/10: voz do motor só no Seedance (S2: Kling muda a voz entre janelas); Kling = só (A)
  if (s.swapEngine === 'KLING' && s.voiceSource === 'ENGINE_VOICE') throw bad('settings.voiceSource', 'engine_voice_seedance_only');
}

/** As 5 combinações das cotações lado a lado (§13.15.6), na ordem do contrato. */
export const QUOTE_COMBOS: { engine: SwapEngine; voiceSource: SwapVoiceSource }[] = [
  { engine: 'LIPSYNC', voiceSource: 'CHAMPION_AUDIO' },
  { engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' },
  { engine: 'KLING', voiceSource: 'ENGINE_VOICE' },
  { engine: 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' },
  { engine: 'SEEDANCE', voiceSource: 'ENGINE_VOICE' },
];

// ───────── a cena SWAP_VIDEO no banco ─────────

/** Janela como fica em `scenes.windows` (jsonb): igual ao SwapWindow, com o id do arquivo no lugar do FileRef. */
export interface StoredWindow extends Omit<SwapWindow, 'clip'> {
  clipFileId: string | null;
}

/** Janelas novas de uma tentativa (todas QUEUED, sem clipe). A 1ª parte do rosto; as seguintes, do último frame da anterior. */
export function freshWindows(plan: SwapWindowPlan[], resolution: SwapResolution, attempt: number): StoredWindow[] {
  return plan.map((w, i) => ({
    index: i, startSec: w.startSec, endSec: w.endSec, genSec: w.genSec, startImage: i === 0 ? 'FACE' : 'PREVIOUS_LAST_FRAME',
    resolution, status: 'QUEUED' as AssetStatus, attempt, seed: swapSeed(attempt), clipFileId: null,
  }));
}

export function windowsOf(json: unknown): StoredWindow[] {
  return Array.isArray(json) ? (json as StoredWindow[]) : [];
}

/** O que é preciso pra saber a etapa da cena (colunas de `scenes`). */
export interface SwapSceneState {
  status: AssetStatus;
  windows: StoredWindow[];
  rawClipFileId: string | null;
  clipFileId: string | null;
  voiceSource: SwapVoiceSource;
  fit: unknown;
  transcribed?: boolean;
}

/**
 * Etapa da cena (não é gravada; sai dos dados): janelas → emenda → lipsync (A) | transcrição → reencaixe (B) →
 * checagem → done. Cena FAILED mostra a etapa em que parou.
 */
export function swapStage(s: SwapSceneState): SceneSwap['stage'] {
  if (s.status === 'READY') return 'done';
  if (!s.windows.length || s.windows.some((w) => w.status !== 'READY')) return 'windows';
  if (!s.rawClipFileId) return 'joining';
  if (s.voiceSource === 'CHAMPION_AUDIO') return s.clipFileId ? 'checking' : 'lipsync';
  if (!s.transcribed) return 'transcribing';
  if (!s.fit) return 'fitting';
  return 'checking';
}

/** Progresso da cena pela etapa (janelas: 5 → 60 proporcional às prontas). */
export function swapProgress(s: SwapSceneState): number {
  const stage = swapStage(s);
  if (stage === 'done') return 100;
  if (stage === 'windows') {
    const n = s.windows.length || 1;
    return Math.round(5 + (55 * s.windows.filter((w) => w.status === 'READY').length) / n);
  }
  return { joining: 62, lipsync: 70, transcribing: 70, fitting: 80, checking: 90 }[stage];
}

// ───────── (B) voz do motor ─────────

/** §13.15.3: SPEECH_MISMATCH quando a transcrição do motor casa < 85 % das palavras da copy (normalizadas). */
export const SPEECH_MATCH_MIN = 0.85;
const norm = (w: string) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Fração das palavras da copy que aparecem, na ordem, na transcrição (maior subsequência comum / nº de palavras da copy). */
export function speechMatch(copy: string[], heard: string[]): number {
  const a = copy.map(norm).filter(Boolean);
  const b = heard.map(norm).filter(Boolean);
  if (!a.length) return 1;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / a.length;
}

/** Palavras do clipe reencaixadas: (t − corte) × fator, presas a [0, trecho). */
export function fittedWords(clip: { word: string; startSec: number; endSec: number }[], cutStartSec: number, factor: number, spanSec: number) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return clip
    .map((w) => ({ word: w.word, startSec: r3((w.startSec - cutStartSec) * factor), endSec: r3((w.endSec - cutStartSec) * factor) }))
    .filter((w) => w.endSec > 0 && w.startSec < spanSec)
    .map((w) => ({ ...w, startSec: Math.max(0, w.startSec), endSec: Math.min(spanSec, w.endSec) }));
}

/**
 * (B) com mais de uma janela: cada janela tem genSec > a fala dela, e a sobra (silêncio no fim) viraria pausa no meio do
 * trecho e estouraria o reencaixe. Corta cada janela (menos a última) logo depois da última palavra dela (+ `padSec`),
 * e devolve os pedaços do clipe emendado + as palavras no tempo do clipe compactado.
 */
export function compactWindows(heard: { word: string; startSec: number; endSec: number }[], gens: number[], padSec = 0.15) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const segments: { startSec: number; endSec: number }[] = [];
  const words: { word: string; startSec: number; endSec: number }[] = [];
  let offset = 0;
  let out = 0;
  gens.forEach((gen, k) => {
    const mine = heard.filter((w) => w.startSec >= offset && w.startSec < offset + gen);
    const last = k === gens.length - 1;
    const end = last || !mine.length ? offset + gen : Math.min(offset + gen, Math.max(...mine.map((w) => w.endSec)) + padSec);
    segments.push({ startSec: r3(offset), endSec: r3(end) });
    for (const w of mine) words.push({ word: w.word, startSec: r3(w.startSec - offset + out), endSec: r3(Math.min(w.endSec, end) - offset + out) });
    out += end - offset;
    offset += gen;
  });
  return { segments, words, durationSec: r3(out) };
}
