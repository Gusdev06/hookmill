import type { CatalogService, FaceAspect, ScenePipeline, SceneDraft, ScriptBlockDraft, TakeKind, TakeSlice, TranscriptWord, VideoFormat } from '../contrato';
import { faceAspectFor, sliceTake, takeSecondsFor, takeText } from './take';
import { CLAUDE_PRICES } from '../claude/custo';
import { splitSourceScenes } from './fatiar';
import { estimateSwap, fitEngineVoice, planSwapWindows, swapResolutionFor } from './troca-motor';
import { IntegracaoError } from '../erros';
import { genderOf } from './genero';
import {
  FACE_MODEL,
  SCENE_MODELS,
  STATIC_IMAGE_MODEL,
  STATIC_TEXT_CHECK_MODEL,
  staticImageUsd,
  TRANSCRIBE_MODEL,
  TTS_MODEL,
  VOICES,
  VOICE_LANGUAGES,
  findSceneModel,
  round4,
  speechSeconds,
  type SceneModel,
} from './precos';

type EstimateResult = ReturnType<CatalogService['estimate']>;
type Line = EstimateResult['lines'][number];

export interface CatalogOptions {
  /** Monta a URL da amostra de voz. Mock: rota local de mídia sintética. Live: vazio até o I3 gravar as amostras. */
  voiceSampleUrl: (voiceId: string, language: string) => string;
}

/** Catálogo, quebra em cenas e estimativa. Puro e determinístico: sem rede, sem banco, sem custo. */
export class CatalogServiceImpl implements CatalogService {
  constructor(private readonly opts: CatalogOptions) {}

  engines() {
    const of = (engine: 'SCENES' | 'LIPSYNC') =>
      SCENE_MODELS.filter((m) => m.engine === engine).map((m) => ({ id: m.id, label: m.label, maxSceneSec: m.maxSceneSec }));
    return [
      { id: 'SCENES' as const, models: of('SCENES'), tradeoffKey: 'engine.scenes.tradeoff' },
      { id: 'LIPSYNC' as const, models: of('LIPSYNC'), tradeoffKey: 'engine.lipsync.tradeoff' },
    ];
  }

  voices(language?: string) {
    const langs = language ? [language] : VOICE_LANGUAGES;
    return langs.flatMap((lang) =>
      VOICES.map((v) => ({
        id: v.id,
        name: v.name,
        language: lang,
        gender: v.gender,
        sampleUrl: this.opts.voiceSampleUrl(v.id, lang),
      })),
    );
  }

  splitScenes(blocks: ScriptBlockDraft[], engine: 'SCENES' | 'LIPSYNC', model: string): SceneDraft[] {
    const m = this.model(engine, model);
    if (!blocks.length) throw new IntegracaoError('INVALID_SCRIPT', 'script has no blocks');
    const scenes: SceneDraft[] = [];
    for (const b of blocks) {
      const dur = b.endSec - b.startSec;
      if (!(dur > 0)) throw new IntegracaoError('INVALID_SCRIPT', `block "${b.label}" has non-positive duration`);
      const parts = Math.max(1, Math.ceil(dur / m.maxSceneSec - 1e-9));
      const speeches = splitWords(b.speech, parts);
      for (let p = 0; p < parts; p++) {
        scenes.push({
          index: scenes.length,
          label: b.label,
          startSec: round3(b.startSec + (dur * p) / parts),
          endSec: round3(b.startSec + (dur * (p + 1)) / parts),
          speech: speeches[p],
          visualPrompt: b.visualPrompt,
        });
      }
    }
    return scenes;
  }

  estimate(input: {
    engine: 'SCENES' | 'LIPSYNC'; model: string; scenes: SceneDraft[]; format: VideoFormat;
    voiceId?: string; faceDescription?: string; faceCount?: number;
    pipelines?: ScenePipeline[]; audioSecByScene?: number[];
    take?: { kind: TakeKind; audioSec?: number; wordsPerSec?: number };
  }): EstimateResult {
    const m = this.model(input.engine, input.model);
    if (!input.scenes.length) throw new IntegracaoError('INVALID_SCRIPT', 'no scenes to estimate');
    const warnings: EstimateResult['warnings'] = [];
    const lines: Line[] = [];
    let slowestSceneSec = 0;

    if (input.pipelines) {
      const r = this.byPipeline(input.scenes, input.pipelines, input.audioSecByScene, m, input.take);
      lines.push(...r.lines);
      slowestSceneSec = r.slowestSceneSec;
    } else if (input.engine === 'SCENES') {
      let videoSec = 0;
      for (const s of input.scenes) {
        const dur = s.endSec - s.startSec;
        const billed = billedSceneSeconds(m, dur);
        videoSec += billed;
        slowestSceneSec = Math.max(slowestSceneSec, m.etaBaseSec + m.etaPerSecond * billed);
      }
      lines.push(line('VIDEO', videoSec, 'second', m.usdPerSecond));
      lines.push(line('TRANSCRIBE', videoSec, 'second', TRANSCRIBE_MODEL.usdPerSecond));
      slowestSceneSec += TRANSCRIBE_MODEL.etaSec;
    } else {
      // §13.5: 1 take com o texto inteiro (TTS → 1 Pruna → 1 TRANSCRIBE), um arredondamento só
      const r = takeLines(input.scenes, input.take ?? { kind: 'TTS_LIPSYNC' });
      lines.push(...r.lines);
      slowestSceneSec = r.etaSec;
    }

    if (input.faceCount && input.faceCount > 0) {
      lines.push(line('IMAGE', input.faceCount, 'image', FACE_MODEL.usdPerImage));
    }

    const costUsd = round4(lines.reduce((a, l) => a + l.amountUsd, 0));
    // Lipsync com voz de um gênero e rosto de outro sai ruim: avisa (nunca bloqueia) só quando os dois são certos.
    // Com pipelines, só conta quem usa a voz do catálogo (TTS_LIPSYNC); áudio do campeão não tem voiceId.
    const usesCatalogVoice = input.pipelines
      ? input.pipelines.includes('TTS_LIPSYNC') || (input.pipelines.includes('TAKE_SLICE') && (input.take?.kind ?? 'TTS_LIPSYNC') === 'TTS_LIPSYNC')
      : input.take?.kind !== 'AUDIO_LIPSYNC';
    if (input.engine === 'LIPSYNC' && input.voiceId && usesCatalogVoice) {
      const voice = VOICES.find((v) => v.id === input.voiceId)?.gender;
      const face = genderOf(input.faceDescription);
      if ((voice === 'female' || voice === 'male') && face && voice !== face) warnings.push('voice_gender_mismatch');
    }

    return { costUsd, etaSec: Math.round(slowestSceneSec), lines, warnings };
  }

  estimateFaces(count: number): number {
    return round4(Math.max(0, count) * FACE_MODEL.usdPerImage);
  }

  /** US$ de `count` imagens do STATIC (GPT Image 2 high 2k, por imagem: 0,40; `withScreenRef` = edit com 1 referência,
   *  0,41, D4). A checagem de texto (~0,0075) e a refação por texto crítico não entram: a refação passa pelo teto (§A8).
   *  `opts` é extra da ia (o contrato só tem `count`): o backend que quiser o preço do edit chama com `{ withScreenRef }`. */
  estimateStaticImages(count: number, opts?: { withScreenRef?: boolean }): number {
    return round4(Math.max(0, Math.ceil(count)) * staticImageUsd(opts?.withScreenRef ? 1 : 0));
  }

  /** §A6: US$ estimado de `count` checagens de texto (visão). */
  estimateStaticTextChecks(count: number): number {
    return round4(Math.max(0, Math.ceil(count)) * STATIC_TEXT_CHECK_MODEL.estimatedUsd);
  }

  /** Whisper (s × 0,002, com timestamps) + Claude com frames (tokens estimados pra cima; calibrar com a sonda). */
  estimateAnalysis(durationSec: number, keyframeCount: number): number {
    const sec = Math.ceil(Math.max(0, durationSec));
    const p = CLAUDE_PRICES['claude-opus-5-5'];
    const frames = Math.min(Math.max(0, Math.round(keyframeCount)), ANALYSIS.maxFrames);
    const inTok = ANALYSIS.baseInTokens + sec * ANALYSIS.inTokensPerSec + frames * ANALYSIS.tokensPerFrame;
    const claude = (inTok * p.input + ANALYSIS.outTokens * p.output) / 1e6;
    // §13.2: describeEdit (frames-chave + até 6 recortes de faixa) entra na análise
    const e = ANALYSIS.edit;
    const edit = ((e.baseInTokens + (frames + e.crops) * e.tokensPerImage) * p.input + e.outTokens * p.output) / 1e6;
    return round4(sec * TRANSCRIBE_MODEL.usdPerSecond + claude + edit);
  }

  /** variacao-auto §9: análise do lote AUTO = análise do campeão + o plano (1 chamada; o reparo, quando há, é real
   *  nas cost_entries). Campeão da Library já analisado = só o plano. Conta pra cima, como a estimateAnalysis. */
  estimateAutoAnalysis(durationSec: number, opts?: { keyframeCount?: number; planOnly?: boolean }): number {
    const sec = Math.ceil(Math.max(0, durationSec));
    const p = CLAUDE_PRICES['claude-opus-5-5'];
    const plan = ((AUTO_PLAN.baseInTokens + sec * AUTO_PLAN.inTokensPerSec + AUTO_PLAN.refImages * AUTO_PLAN.tokensPerRefImage) * p.input + AUTO_PLAN.outTokens * p.output) / 1e6;
    const { static: st, frames: fr } = AUTO_PLAN.details;
    const details = (st.calls * (st.uncachedInTokens * p.input + (st.cachedInTokens + sec * AUTO_PLAN.inTokensPerSec) * p.cacheRead + st.outTokens * p.output)
      + fr.calls * ((fr.inTokens + sec * AUTO_PLAN.inTokensPerSec) * p.input + fr.outTokens * p.output)) / 1e6;
    if (opts?.planOnly) return round4(plan + details);
    return round4(this.estimateAnalysis(durationSec, opts?.keyframeCount ?? AUTO_PLAN.defaultKeyframes) + plan + details);
  }

  splitSourceScenes(words: TranscriptWord[], blocks: { label: string; startSec: number; endSec: number }[], maxSceneSec: number) {
    if (!(maxSceneSec > 0)) throw new IntegracaoError('INVALID_SCRIPT', 'maxSceneSec must be > 0');
    return splitSourceScenes(words, blocks, maxSceneSec);
  }

  sliceTake(i: { blocks: { label: string; speech: string }[]; words: TranscriptWord[]; durationSec: number }): TakeSlice[] {
    return sliceTake(i);
  }

  faceAspectFor(width: number, height: number): FaceAspect {
    return faceAspectFor(width, height);
  }

  // §13.15: Trocar avatar com motor Kling/Seedance (catalogo/troca-motor.ts)
  planSwapWindows(i: Parameters<CatalogService['planSwapWindows']>[0]) {
    return planSwapWindows(i);
  }

  fitEngineVoice(i: Parameters<CatalogService['fitEngineVoice']>[0]) {
    return fitEngineVoice(i);
  }

  swapResolutionFor(region: { w: number; h: number }, aspect: FaceAspect) {
    return swapResolutionFor(region, aspect);
  }

  estimateSwap(i: Parameters<CatalogService['estimateSwap']>[0]) {
    return estimateSwap(i);
  }

  /** feature 2: custo por cena conforme o pipeline (REUSE/SOURCE_CUT = 0; AUDIO_LIPSYNC = só o lipsync dos segundos reais). */
  private byPipeline(scenes: SceneDraft[], pipelines: ScenePipeline[], audioSec: number[] | undefined, m: SceneModel, take?: { kind: TakeKind; audioSec?: number; wordsPerSec?: number }): { lines: Line[]; slowestSceneSec: number } {
    if (pipelines.length !== scenes.length) throw new IntegracaoError('INVALID_SCRIPT', `pipelines (${pipelines.length}) must match scenes (${scenes.length})`);
    const pruna = findSceneModel('pruna-lipsync')!;
    const units: Record<string, number> = { VIDEO: 0, TTS: 0, LIPSYNC: 0, TRANSCRIBE: 0 };
    let slowest = 0;
    let videoModel: SceneModel | null = null;
    const sliceScenes = scenes.filter((_, i) => pipelines[i] === 'TAKE_SLICE');
    scenes.forEach((s, i) => {
      const dur = s.endSec - s.startSec;
      switch (pipelines[i]) {
        case 'TAKE_SLICE': // somadas num take só, logo abaixo
        case 'REUSE':
        case 'SOURCE_CUT':
          return;
        case 'AUDIO_LIPSYNC': {
          const real = audioSec?.[i];
          const sec = Math.max(pruna.minSceneSec, Math.ceil((real != null && real > 0 ? real : dur) - 1e-9));
          units.LIPSYNC += sec;
          slowest = Math.max(slowest, pruna.etaBaseSec + pruna.etaPerSecond * sec);
          return;
        }
        case 'TTS_LIPSYNC': {
          const sec = Math.max(pruna.minSceneSec, Math.ceil(speechSeconds(s.speech)));
          units.TTS += s.speech.length;
          units.LIPSYNC += sec;
          units.TRANSCRIBE += sec;
          slowest = Math.max(slowest, TTS_MODEL.etaSec + pruna.etaBaseSec + pruna.etaPerSecond * sec + TRANSCRIBE_MODEL.etaSec);
          return;
        }
        case 'SCENE_VIDEO': {
          if (m.engine !== 'SCENES') throw new IntegracaoError('INVALID_MODEL', `SCENE_VIDEO needs a SCENES model, got "${m.id}"`);
          videoModel = m;
          const billed = billedSceneSeconds(m, dur);
          units.VIDEO += billed;
          units.TRANSCRIBE += billed;
          slowest = Math.max(slowest, m.etaBaseSec + m.etaPerSecond * billed + TRANSCRIBE_MODEL.etaSec);
          return;
        }
      }
    });
    if (sliceScenes.length) {
      const t = takeUnits(sliceScenes, take ?? { kind: 'TTS_LIPSYNC' });
      units.TTS += t.chars;
      units.LIPSYNC += t.lipsyncSec;
      units.TRANSCRIBE += t.transcribeSec;
      slowest = Math.max(slowest, t.etaSec);
    }
    const lines: Line[] = [];
    if (units.VIDEO) lines.push(line('VIDEO', units.VIDEO, 'second', (videoModel ?? m).usdPerSecond));
    if (units.TTS) lines.push(line('TTS', units.TTS, 'character', TTS_MODEL.usdPerChar));
    if (units.LIPSYNC) lines.push(line('LIPSYNC', units.LIPSYNC, 'second', pruna.usdPerSecond));
    if (units.TRANSCRIBE) lines.push(line('TRANSCRIBE', units.TRANSCRIBE, 'second', TRANSCRIBE_MODEL.usdPerSecond));
    return { lines, slowestSceneSec: slowest };
  }

  private model(engine: 'SCENES' | 'LIPSYNC', id: string): SceneModel {
    const m = findSceneModel(id);
    if (!m || m.engine !== engine) throw new IntegracaoError('INVALID_MODEL', `model "${id}" is not a ${engine} model`);
    return m;
  }
}

/**
 * Premissas da estimativa da análise do campeão (Claude com visão, 2 chamadas: fatos com frames + diagnóstico).
 * Calibrada pela sonda de 06/10 (21,5 s, 8 frames, effort medium): real US$ 0,229 de Claude; esta conta dá 0,239
 * (pra cima de propósito). docs/integracoes.md, "Feature 2".
 */
export const ANALYSIS = {
  maxFrames: 16,
  /** sistema e esquema das 2 chamadas + medições/oferta (2ª lê do cache) + os fatos repassados à 2ª */
  baseInTokens: 14000,
  /** transcrição com tempo por palavra (~2,6 palavras/s, ~9 tokens por palavra com o tempo) */
  inTokensPerSec: 25,
  /** frame de até 768 px no lado maior (conta pra cima) */
  tokensPerFrame: 1600,
  /** 11 seções + raciocínio (effort medium); a sonda mediu 5,6 mil */
  outTokens: 6500,
  /** §13.2 describeEdit. Sonda 06/10 (30,4 s, 12 frames + 4 recortes): 10 mil tokens de entrada contados, US$ 0,063 real.
   *  Conta pra cima (~US$ 0,12 com 12 frames + 6 recortes). */
  edit: { baseInTokens: 4000, tokensPerImage: 600, crops: 6, outTokens: 3000 },
};

/** variacao-auto §9: planAutoBatch. Entrada: sistema + esquema (~2,5 mil) + Brain/página (até 4 mil
 *  caracteres ≈ 1,2 mil) + teardown resumido (~1,5 mil) + pedido; transcrição ~25 tokens/s como na análise. Saída:
 *  raciocínio (effort medium) + JSON de 8-12 peças. Estimado pra cima; sem sonda real ainda (13/10).
 *  Rev. 23/10 (§14.3): com STATIC em `allowed`, até `refImages` frames-chave vão como REFERÊNCIA visual (fora do cache);
 *  a estimativa conta sempre (pra cima). */
export const AUTO_PLAN = {
  baseInTokens: 7000, inTokensPerSec: 25, outTokens: 6000, defaultKeyframes: 12, refImages: 4, tokensPerRefImage: 1600,
  /** 25/10 (bug live da gramática + catálogo novo): 2ª etapa = 1 chamada por STATIC (até 2, com as imagens de referência
   *  fora do cache) + 1 chamada com TODAS as molduras (até 8, effort low; a troca de effort perde o cache das mensagens,
   *  então o contexto conta inteiro). Conta sempre o máximo (pra cima). */
  details: {
    static: { calls: 2, uncachedInTokens: 4000, cachedInTokens: 8000, outTokens: 2500 },
    frames: { calls: 1, inTokens: 10000, outTokens: 4000 },
  },
};

/**
 * §13.5: unidades de UM take. TTS_LIPSYNC: caracteres do texto inteiro, LIPSYNC e TRANSCRIBE = ceil(s do take) uma vez.
 * AUDIO_LIPSYNC: só LIPSYNC de ceil(audioSec) (sem audioSec = soma das durações das cenas). Piso de 2 s do Pruna.
 */
export function takeUnits(scenes: { speech: string; startSec: number; endSec: number }[], take: { kind: TakeKind; audioSec?: number; wordsPerSec?: number }) {
  const pruna = findSceneModel('pruna-lipsync')!;
  if (take.kind === 'AUDIO_LIPSYNC') {
    const raw = take.audioSec != null && take.audioSec > 0 ? take.audioSec : scenes.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);
    const sec = Math.max(pruna.minSceneSec, Math.ceil(raw - 1e-9));
    return { chars: 0, lipsyncSec: sec, transcribeSec: 0, etaSec: pruna.etaBaseSec + pruna.etaPerSecond * sec };
  }
  const text = takeText(scenes.map((s) => s.speech));
  const sec = Math.max(pruna.minSceneSec, Math.ceil((take.audioSec != null && take.audioSec > 0 ? take.audioSec : takeSecondsFor(text, take.wordsPerSec)) - 1e-9));
  return { chars: text.length, lipsyncSec: sec, transcribeSec: sec, etaSec: TTS_MODEL.etaSec + pruna.etaBaseSec + pruna.etaPerSecond * sec + TRANSCRIBE_MODEL.etaSec };
}

function takeLines(scenes: SceneDraft[], take: { kind: TakeKind; audioSec?: number; wordsPerSec?: number }): { lines: Line[]; etaSec: number } {
  const pruna = findSceneModel('pruna-lipsync')!;
  const t = takeUnits(scenes, take);
  const lines: Line[] = [];
  if (t.chars) lines.push(line('TTS', t.chars, 'character', TTS_MODEL.usdPerChar));
  lines.push(line('LIPSYNC', t.lipsyncSec, 'second', pruna.usdPerSecond));
  if (t.transcribeSec) lines.push(line('TRANSCRIBE', t.transcribeSec, 'second', TRANSCRIBE_MODEL.usdPerSecond));
  return { lines, etaSec: t.etaSec };
}

/** Segundos que o provedor cobra por um clipe de `dur` segundos. */
export function billedSceneSeconds(m: SceneModel, dur: number): number {
  const s = m.integerSeconds ? Math.ceil(dur - 1e-9) : dur;
  return Math.min(m.maxSceneSec, Math.max(m.minSceneSec, s));
}

function line(kind: string, units: number, unit: string, unitPriceUsd: number): Line {
  return { kind, units: round4(units), unit, unitPriceUsd, amountUsd: round4(units * unitPriceUsd) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Divide a fala em `parts` pedaços de palavras inteiras, o mais iguais possível. */
function splitWords(text: string, parts: number): string[] {
  if (parts === 1) return [text];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let p = 0; p < parts; p++) {
    const a = Math.round((words.length * p) / parts);
    const b = Math.round((words.length * (p + 1)) / parts);
    out.push(words.slice(a, b).join(' '));
  }
  return out;
}
