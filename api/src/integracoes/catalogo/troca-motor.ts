// §13.15 (08/10): Trocar avatar com motor Kling 3.0 / Seedance 2.0 mantendo a edição. Funções PURAS do catálogo:
// janelas do trecho, reencaixe da voz do motor, resolução do Seedance e o preço lado a lado. Sem rede, sem banco.
// Preços e limites em precos.ts (SWAP_*); fonte e sondas S1/S2 em docs/integracoes.md §13.15.
import type { FaceAspect, SwapEngine, SwapFit, SwapQuote, SwapResolution, SwapVoiceSource, TranscriptWord } from '../contrato';
import { IntegracaoError } from '../erros';
import { SWAP_ENGINES, SWAP_ENGINE_VOICE_CONSISTENT, SWAP_LIMITS, SWAP_V2V_MODEL, TRANSCRIBE_MODEL, findSceneModel, round4, type SwapEngineDef } from './precos';

export interface SwapWindowPlan { startSec: number; endSec: number; genSec: number }
export type SwapFitError = { error: 'VOICE_FIT_OUT_OF_RANGE'; ratio: number; sourceSec: number; voiceSec: number };
export type SwapEstimate = Omit<SwapQuote, 'available' | 'blockers' | 'notEnabled' | 'selected' | 'costUsd'>;

const EPS = 1e-9;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function engineDef(engine: SwapEngine): SwapEngineDef {
  const d = engine === 'LIPSYNC' ? null : SWAP_ENGINES[engine];
  if (!d) throw new IntegracaoError('INVALID_MODEL', `swap engine "${engine}" is not a video engine`);
  return d;
}

/** Segundos pedidos ao motor pra cobrir `lenSec` de fonte (inteiro, ≥ mínimo do motor, ≤ 15). §13.15.2. */
export function swapGenSec(lenSec: number, engine: Exclude<SwapEngine, 'LIPSYNC'>, voiceSource: SwapVoiceSource): number {
  const d = engineDef(engine);
  const want = voiceSource === 'ENGINE_VOICE' ? lenSec * SWAP_LIMITS.engineVoiceSlack + SWAP_LIMITS.engineVoicePadSec : lenSec + SWAP_LIMITS.championAudioPadSec;
  return Math.min(SWAP_LIMITS.maxGenSec, Math.max(d.minSec, Math.ceil(want - EPS)));
}

/**
 * Janelas de um trecho main (§13.15.2). `words` relativas ao início do trecho. Até o limite da fonte por janela
 * ((A) 14,5 s, (B) 12,5 s) = 1 janela. Acima: corta no meio do MAIOR silêncio entre palavras (≥ 0,15 s) dentro de
 * [0,5 × limite, limite] a partir do início da janela; sem silêncio assim, na fronteira de palavra mais perto do limite
 * (nunca no meio de palavra). Contíguas, cobrem o trecho inteiro. Determinístico.
 */
export function planSwapWindows(i: { spanSec: number; words: TranscriptWord[]; engine: 'KLING' | 'SEEDANCE'; voiceSource: SwapVoiceSource }): SwapWindowPlan[] {
  if (!(i.spanSec > 0)) throw new IntegracaoError('INVALID_SCRIPT', 'swap segment must have a positive duration');
  const limit = i.voiceSource === 'ENGINE_VOICE' ? SWAP_LIMITS.engineVoiceSourceSec : SWAP_LIMITS.championAudioSourceSec;
  const words = [...i.words].filter((w) => w.endSec > 0 && w.startSec < i.spanSec).sort((a, b) => a.startSec - b.startSec);
  // fronteiras possíveis: meio do vão entre duas palavras seguidas (vão 0 = fim da palavra)
  const gaps = words.slice(0, -1).map((w, k) => {
    const a = Math.max(w.endSec, 0);
    const b = Math.max(words[k + 1].startSec, a);
    return { at: (a + b) / 2, len: b - a };
  });
  const cuts: number[] = [];
  let start = 0;
  while (i.spanSec - start > limit + EPS) {
    const lo = start + 0.5 * limit;
    const hi = start + limit;
    const silent = gaps.filter((g) => g.at > lo - EPS && g.at < hi + EPS && g.len >= SWAP_LIMITS.minSilenceSec - EPS);
    let cut: number | null = null;
    if (silent.length) {
      cut = silent.reduce((best, g) => (g.len > best.len + EPS ? g : best)).at;
    } else {
      const inside = gaps.filter((g) => g.at > start + EPS && g.at < hi + EPS);
      if (inside.length) cut = inside[inside.length - 1].at; // a fronteira mais perto do limite, sem passar dele
    }
    if (cut == null || cut <= start + EPS) cut = hi; // sem palavra no caminho (silêncio longo / palavra única enorme)
    cut = r3(cut);
    cuts.push(cut);
    start = cut;
  }
  const bounds = [0, ...cuts, i.spanSec];
  return bounds.slice(0, -1).map((s, k) => {
    const e = k === bounds.length - 2 ? i.spanSec : bounds[k + 1];
    return { startSec: r3(s), endSec: r3(e), genSec: swapGenSec(e - s, i.engine, i.voiceSource) };
  });
}

/**
 * Reencaixe da voz do motor no tempo do campeão (§13.15.3, só ENGINE_VOICE). `sourceWords` relativas ao início do
 * trecho e `sourceSec` = DURAÇÃO DO TRECHO; `clipWords`/`clipSec` = transcrição e duração do clipe emendado.
 * Saída: `sourceSec` = fala no campeão (1ª → última palavra), `voiceSec` = idem no clipe, `ratio` = voice/source,
 * corte no clipe = [vPrimeira − padL × ratio, vÚltima + padR × ratio] (pads do campeão), limitado ao clipe.
 * f = corte / duração do trecho: |f−1| ≤ 0,02 EXACT, ≤ 0,08 STRETCH, senão VOICE_FIT_OUT_OF_RANGE.
 */
export function fitEngineVoice(i: { sourceWords: TranscriptWord[]; sourceSec: number; clipWords: TranscriptWord[]; clipSec: number }): SwapFit | SwapFitError {
  const src = [...i.sourceWords].sort((a, b) => a.startSec - b.startSec);
  const clip = [...i.clipWords].sort((a, b) => a.startSec - b.startSec);
  if (!src.length || !clip.length || !(i.sourceSec > 0) || !(i.clipSec > 0)) {
    return { error: 'VOICE_FIT_OUT_OF_RANGE', ratio: 0, sourceSec: 0, voiceSec: 0 };
  }
  const sFirst = src[0].startSec;
  const sLast = Math.max(...src.map((w) => w.endSec));
  const vFirst = clip[0].startSec;
  const vLast = Math.max(...clip.map((w) => w.endSec));
  const sourceSpeech = Math.max(sLast - sFirst, EPS);
  const voiceSec = Math.max(vLast - vFirst, 0);
  const ratio = voiceSec / sourceSpeech;
  const padL = Math.max(0, sFirst);
  const padR = Math.max(0, i.sourceSec - sLast);
  const cutStart = Math.max(0, vFirst - padL * ratio);
  const cutEnd = Math.min(i.clipSec, vLast + padR * ratio);
  const f = (cutEnd - cutStart) / i.sourceSec;
  const dev = Math.abs(f - 1);
  const base = { ratio: round4(ratio), sourceSec: r3(sourceSpeech), voiceSec: r3(voiceSec) };
  if (dev > SWAP_LIMITS.fitStretchMax + EPS) return { error: 'VOICE_FIT_OUT_OF_RANGE', ...base };
  return { mode: dev <= SWAP_LIMITS.fitExactMax + EPS ? 'EXACT' : 'STRETCH', ...base, cutStartSec: r3(cutStart), cutEndSec: r3(cutEnd) };
}

/** Quadro do Seedance 480p no aspecto pedido (lado menor 480). */
function frame480(aspect: FaceAspect): { w: number; h: number } {
  const [a, b] = aspect.split(':').map(Number);
  const ar = a / b;
  return ar < 1 ? { w: 480, h: 480 / ar } : { w: 480 * ar, h: 480 };
}

/**
 * Resolução do Seedance pela maior região do rosto (§13.15.2): 480p se a região, em `cover`, pede ≤ 110 % dos pixels
 * do quadro 480p naquele aspecto (split screen, região ~336×324); senão 720p (tela cheia 9:16). Kling = 1080p sempre.
 */
export function swapResolutionFor(region: { w: number; h: number }, aspect: FaceAspect): '480p' | '720p' {
  const f = frame480(aspect);
  const fa = f.w / f.h;
  const ra = region.w / region.h;
  // cover: o quadro é escalado até cobrir a região e o excedente é cortado; pixels de fonte que a região "pede"
  // = pixels da região × quanto do quadro sobra fora dela
  const needed = region.w * region.h * Math.max(fa / ra, ra / fa);
  return needed <= SWAP_LIMITS.res480MaxFill * f.w * f.h + EPS ? '480p' : '720p';
}

function line(kind: string, units: number, unit: string, unitPriceUsd: number) {
  return { kind, units: round4(units), unit, unitPriceUsd, amountUsd: round4(units * unitPriceUsd) };
}

/**
 * Preço e prazo de UM item Trocar avatar no motor/áudio pedidos (§13.15.5). `spans` = trechos main (s e palavras
 * relativas ao trecho), `takeSec` = janela do take do Pruna (1ª → última fala main), `region`/`aspect` = maior região
 * do rosto e aspecto do rosto Soul. Linhas: VIDEO (janelas), LIPSYNC (Pruna ou v2v), TRANSCRIBE (só ENGINE_VOICE).
 * Avisos: voice_may_vary (ENGINE_VOICE no motor que mudou a voz na sonda S2 = Kling; nenhum aceita voz de referência
 * na WaveSpeed), short_segment_padded.
 * `music_bed_drops` depende do teardown e é do backend.
 */
export function estimateSwap(i: { engine: SwapEngine; voiceSource: SwapVoiceSource; spans: { sec: number; words: TranscriptWord[] }[]; takeSec: number; region: { w: number; h: number }; aspect: FaceAspect }): SwapEstimate {
  if (i.engine === 'LIPSYNC') {
    if (i.voiceSource !== 'CHAMPION_AUDIO') throw new IntegracaoError('INVALID_MODEL', 'LIPSYNC only takes CHAMPION_AUDIO');
    const pruna = findSceneModel('pruna-lipsync')!;
    const sec = Math.max(pruna.minSceneSec, Math.ceil(Math.max(0, i.takeSec) - EPS));
    const l = line('LIPSYNC', sec, 'second', pruna.usdPerSecond);
    return { engine: 'LIPSYNC', voiceSource: 'CHAMPION_AUDIO', resolution: null, perItemUsd: l.amountUsd, etaSec: Math.round(pruna.etaBaseSec + pruna.etaPerSecond * sec), lines: [l], warnings: [] };
  }
  const d = engineDef(i.engine);
  const resolution: SwapResolution = i.engine === 'KLING' ? '1080p' : swapResolutionFor(i.region, i.aspect);
  const usdPerSec = d.usdPerSecond(resolution, i.voiceSource === 'ENGINE_VOICE');
  let videoSec = 0;
  let v2vSec = 0;
  let transcribeSec = 0;
  let eta = 0;
  let padded = false;
  for (const s of i.spans) {
    if (!(s.sec > 0)) continue;
    if (s.sec < d.minSec - EPS) padded = true;
    const wins = planSwapWindows({ spanSec: s.sec, words: s.words, engine: i.engine, voiceSource: i.voiceSource });
    const gen = wins.reduce((a, w) => a + w.genSec, 0);
    videoSec += gen;
    // janelas do trecho em sequência; trechos diferentes em paralelo → prazo = o trecho mais lento
    let spanEta = wins.reduce((a, w) => a + d.etaBaseSec + d.etaPerSecond * w.genSec, 0);
    if (i.voiceSource === 'CHAMPION_AUDIO') {
      const sec = Math.ceil(s.sec - EPS);
      v2vSec += sec;
      spanEta += SWAP_V2V_MODEL.etaBaseSec + SWAP_V2V_MODEL.etaPerSecond * sec;
    } else {
      transcribeSec += Math.ceil(gen - EPS);
      spanEta += TRANSCRIBE_MODEL.etaSec;
    }
    eta = Math.max(eta, spanEta);
  }
  if (!videoSec) throw new IntegracaoError('INVALID_SCRIPT', 'swap needs at least one main segment');
  const lines = [line('VIDEO', videoSec, 'second', usdPerSec)];
  if (v2vSec) lines.push(line('LIPSYNC', v2vSec, 'second', SWAP_V2V_MODEL.usdPerSecond));
  if (transcribeSec) lines.push(line('TRANSCRIBE', transcribeSec, 'second', TRANSCRIBE_MODEL.usdPerSecond));
  const warnings: SwapQuote['warnings'] = [];
  if (i.voiceSource === 'ENGINE_VOICE' && !SWAP_ENGINE_VOICE_CONSISTENT[i.engine]) warnings.push('voice_may_vary');
  if (padded) warnings.push('short_segment_padded');
  return {
    engine: i.engine, voiceSource: i.voiceSource, resolution,
    perItemUsd: round4(lines.reduce((a, l) => a + l.amountUsd, 0)),
    etaSec: Math.round(eta), lines, warnings,
  };
}
