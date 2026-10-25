// GenerationService do modo mock: grava provider_tasks de verdade, termina sozinho em 2-5 s
// (atraso derivado da entrada, então determinístico), emite 'provider.task.finished' e grava
// cost_entries com valor ZERO. A saída aponta pra mídia sintética local (mock/midia.ts).
//
// Gatilhos de falha (pra QA testar os estados de erro), em qualquer texto da entrada:
//   [mock:SAFETY_BLOCK]  [mock:PROVIDER_ERROR]  [mock:PROVIDER_TIMEOUT]  [mock:CANCELLED]
// §13.15 (Trocar avatar com Kling/Seedance): janela = rosto parado pela genSec (mudo em (A), com tom em (B));
// LIPSYNC_VIDEO = vídeo de entrada remuxado com o áudio; TRANSCRIBE da cena = falas das janelas. Gatilhos nas notas do
// campeão (o backend repassa em submitSceneVideo.notes): [mock:voice-fit-out] (ratio 1,15) e [mock:speech-mismatch].
// [mock:identity-drift] é da medicao (identityScore), não daqui.
// STATIC (variacao-auto-v1 rev. 23/10 §14.7), nas notas da OFERTA (submitStaticImage.notes):
//   [mock:static-reject]     1ª submissão (safe=false) recusada SAFETY_BLOCK; o reenvio com safe=true passa.
//   [mock:static-reject-all] toda submissão recusada (inclusive a safe) → a peça vira failed SAFETY_BLOCK.
//   [mock:static-timeout]    1ª task do render fecha TIMEOUT (PROVIDER_TIMEOUT) em 3 s; o reenvio passa.
// 25/10 (§A4): `specV2` monta o prompt V2; com `screenRefUrl` a task grava o modelo `edit` (preço 0,41, custo mock 0).
// Os gatilhos do texto ([mock:static-text-mismatch] / [mock:static-text-mismatch-all]) moram no checkStaticText do FakeClaudeService.
// Saída: PNG determinístico (gradiente) no aspecto pedido, 2× a grade (9:16 720×1280, 4:5 864×1080, 1:1 960×960). Custo 0.
// TRANSCRIBE do campeão (feature 2): lê a duração e se há trilha de áudio da própria mídia (ffprobe; os fixtures do
// QA são vídeos de verdade). Sem áudio = 0 palavras (hasSpeech false); com áudio = fala sintética no idioma pedido.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { FaceAspect, GenerationService, StaticAspect, SubmitStaticImageInput, Submitted, TranscriptWord, VideoFormat } from '../contrato';
import { assertTakeDuration } from '../catalogo/take';
import { IntegracaoError } from '../erros';
import { FACE_MODEL, STATIC_IMAGE_MODEL, staticImageUsd, SWAP_V2V_MODEL, TRANSCRIBE_MODEL, TTS_MODEL, VOICES, findSceneModel, speechSeconds } from '../catalogo/precos';
import { billedSceneSeconds } from '../catalogo/catalog.service';
import {
  PROVIDER_TASK_FINISHED,
  type CostKind,
  type CostStore,
  type CostUnit,
  type NewProviderTask,
  type ProviderTaskRecord,
  type ProviderTaskStatus,
  type ProviderTaskStore,
  type TaskEventBus,
} from '../portas';
import { mockLipsyncUrl, mockMediaUrl, seedOf, unit, writeMockLipsyncSpec } from './midia';
import { normalizeLanguage } from '../claude/validacao';
import { staticImagePrompt } from '../wavespeed/prompts-estatico';

export const MOCK_EXTERNAL_PREFIX = 'mock_';
const FAIL_RE = /\[mock:(SAFETY_BLOCK|PROVIDER_ERROR|PROVIDER_TIMEOUT|CANCELLED)\]/;

export interface FakeGenerationOptions {
  publicApiUrl: string;
  /** Atraso até o fim da task. Padrão: 2000-5000 ms, estável por entrada. */
  delayMs?: (seed: string) => number;
  /** Duração e trilha de áudio da mídia do campeão (testes trocam). Padrão: ffprobe na URL. */
  probeMedia?: (url: string) => Promise<{ durationSec: number | null; hasAudio: boolean }>;
}

const run = promisify(execFile);

/** ffprobe da mídia: duração e se tem áudio. Falhou = desconhecido (20 s, com áudio, como o vídeo do link mock). */
export async function ffprobeMedia(url: string): Promise<{ durationSec: number | null; hasAudio: boolean }> {
  try {
    const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', url], { timeout: 20_000 });
    const j = JSON.parse(stdout) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
    const d = Number(j.format?.duration);
    return { durationSec: Number.isFinite(d) && d > 0 ? d : null, hasAudio: (j.streams ?? []).some((x) => x.codec_type === 'audio') };
  } catch {
    return { durationSec: null, hasAudio: true };
  }
}

/** Fala sintética do campeão no mock: frases genéricas (agnósticas de oferta), ~2,6 palavras/s, pausa entre frases. */
const MOCK_CHAMPION_LINES: Record<'en' | 'pt' | 'es', string[]> = {
  en: ['Nobody tells you this about the problem you have.', 'I tried everything and nothing worked for me.', 'Then I found a simple way that actually works.', 'It takes a few minutes a day and you see the difference.', 'Tap the link below and try it today.'],
  pt: ['Ninguém te conta isso sobre o problema que você tem.', 'Eu tentei de tudo e nada funcionou pra mim.', 'Até que eu achei um jeito simples que funciona de verdade.', 'Leva poucos minutos por dia e você vê a diferença.', 'Toca no link aqui embaixo e testa hoje.'],
  es: ['Nadie te cuenta esto sobre el problema que tienes.', 'Probé de todo y nada me funcionó.', 'Hasta que encontré una forma simple que funciona de verdad.', 'Toma pocos minutos al día y ves la diferencia.', 'Toca el enlace de abajo y pruébalo hoy.'],
};

export function mockChampionWords(language: string, durationSec: number): TranscriptWord[] {
  const l = language.toLowerCase();
  const lines = MOCK_CHAMPION_LINES[l.startsWith('pt') ? 'pt' : l.startsWith('es') ? 'es' : 'en'];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const out: TranscriptWord[] = [];
  const step = 1 / 2.6;
  let at = 0.2;
  for (let k = 0; ; k++) {
    const ws = lines[k % lines.length].split(' ');
    if (at + ws.length * step > durationSec - 0.2) break;
    for (const w of ws) {
      out.push({ word: w, startSec: r(at), endSec: r(at + step * 0.85) });
      at += step;
    }
    at += 0.45; // respiro entre frases (silêncio onde o fatiamento corta)
  }
  return out;
}

export function defaultMockDelay(seed: string): number {
  return 2000 + Math.round(unit(seed, 'delay') * 3000);
}

interface Words {
  word: string;
  startSec: number;
  endSec: number;
}

const ASPECT_FORMAT: Record<StaticAspect, VideoFormat> = { '9:16': 'VERTICAL_9_16', '4:5': 'PORTRAIT_4_5', '1:1': 'SQUARE_1_1' };

export class FakeGenerationService implements GenerationService {
  private readonly timers = new Set<NodeJS.Timeout>();
  /** renders cuja 1ª imagem já "deu timeout" no [mock:static-timeout] (memória do processo; o reenvio passa) */
  private readonly staticTimedOut = new Set<string>();

  constructor(
    private readonly tasks: ProviderTaskStore,
    private readonly costs: CostStore,
    private readonly bus: TaskEventBus,
    private readonly opts: FakeGenerationOptions,
  ) {}

  async submitFace(i: { workspaceId: string; faceId: string; description: string; language: string; aspectRatio?: FaceAspect }): Promise<Submitted> {
    return this.submit({ workspaceId: i.workspaceId, provider: FACE_MODEL.provider, kind: 'FACE_IMAGE', model: FACE_MODEL.providerModel, faceId: i.faceId, input: { ...i } });
  }

  async submitSceneVideo(i: {
    workspaceId: string; sceneId: string; model: string; faceImageUrl: string; speech: string;
    visualPrompt: string; durationSec: number; format: VideoFormat; language: string;
    windowIndex?: number; sound?: boolean; voiceDescriptor?: string; aspectRatio?: FaceAspect;
    resolution?: '480p' | '720p'; seed?: number; notes?: string | null;
  }): Promise<Submitted> {
    const m = findSceneModel(i.model);
    if (!m || m.engine !== 'SCENES') throw new IntegracaoError('INVALID_MODEL', `model "${i.model}" is not a SCENES model`);
    const durationSec = billedSceneSeconds(m, i.durationSec);
    const swap = i.windowIndex != null;
    return this.submit({ workspaceId: i.workspaceId, kind: 'SCENE_VIDEO', model: m.providerModel, sceneId: i.sceneId, windowIndex: i.windowIndex, input: { ...i, durationSec, ...(swap ? { swap: true, sound: i.sound === true } : {}) } });
  }

  /** §14.3: mesma forma do live (task STATIC_IMAGE com renderId e o prompt montado); termina sozinha com um PNG no aspecto. */
  async submitStaticImage(i: SubmitStaticImageInput): Promise<Submitted> {
    const notes = i.notes ?? '';
    const ref = i.specV2?.screenRefUrl?.trim() || null;
    const prompt = staticImagePrompt(i, !!ref);
    const model = ref ? STATIC_IMAGE_MODEL.editProviderModel : STATIC_IMAGE_MODEL.providerModel;
    const { notes: _notes, ...rest } = i;
    let mockFail: string | null = null;
    let mockDelayMs: number | null = null;
    if (notes.includes('[mock:static-reject-all]') || (notes.includes('[mock:static-reject]') && !i.safe)) {
      mockFail = '[mock:SAFETY_BLOCK]'; // recusa "na submissão": fecha logo, como o rejected() do live
      mockDelayMs = 50;
    } else if (notes.includes('[mock:static-timeout]') && !this.staticTimedOut.has(i.renderId)) {
      this.staticTimedOut.add(i.renderId);
      mockFail = '[mock:PROVIDER_TIMEOUT]';
      mockDelayMs = 3000;
    }
    const input = {
      ...rest, prompt, model, resolution: STATIC_IMAGE_MODEL.resolution, usdPerImage: staticImageUsd(ref ? 1 : 0), layout: i.specV2 ? 'assembled' : 'legacy',
      ...(mockFail ? { mockFail } : {}), ...(mockDelayMs != null ? { mockDelayMs } : {}),
    };
    return this.submit({ workspaceId: i.workspaceId, kind: 'STATIC_IMAGE', model, renderId: i.renderId, input });
  }

  /** §13.15 (A): o vídeo de entrada remuxado com o áudio (cut_off: o mais curto dos dois). */
  async submitLipsyncVideo(i: { workspaceId: string; sceneId: string; videoUrl: string; audioUrl: string; seed?: number }): Promise<Submitted> {
    const p = await (this.opts.probeMedia ?? ffprobeMedia)(i.videoUrl);
    return this.submit({ workspaceId: i.workspaceId, kind: 'LIPSYNC_VIDEO', model: SWAP_V2V_MODEL.providerModel, sceneId: i.sceneId, input: { ...i, videoSec: p.durationSec ?? 5 } });
  }

  async submitTts(i: { workspaceId: string; sceneId?: string; takeId?: string; voiceId: string; text: string; language: string }): Promise<Submitted> {
    one('submitTts', { sceneId: i.sceneId, takeId: i.takeId });
    if (!VOICES.some((v) => v.id === i.voiceId)) throw new IntegracaoError('INVALID_VOICE', `unknown voice "${i.voiceId}"`);
    if (i.text.length > TTS_MODEL.maxChars) throw new IntegracaoError('INVALID_SCRIPT', `TTS text has ${i.text.length} characters (max ${TTS_MODEL.maxChars})`);
    return this.submit({ workspaceId: i.workspaceId, kind: 'TTS', model: TTS_MODEL.providerModel, sceneId: i.sceneId, takeId: i.takeId, input: { ...i } });
  }

  /** §13.5: igual ao live, mede o áudio antes (> 600 s = LIPSYNC_AUDIO_TOO_LONG); o clipe é o rosto em loop (midia.ts). */
  async submitLipsync(i: { workspaceId: string; sceneId?: string; takeId?: string; faceImageUrl: string; audioUrl: string; visualPrompt: string; format: VideoFormat; seed?: number }): Promise<Submitted> {
    one('submitLipsync', { sceneId: i.sceneId, takeId: i.takeId });
    const m = findSceneModel('pruna-lipsync')!;
    const sec = await this.audioSeconds(i.audioUrl, i.sceneId ?? null, i.takeId ?? null);
    assertTakeDuration(sec);
    return this.submit({ workspaceId: i.workspaceId, kind: 'LIPSYNC', model: m.providerModel, sceneId: i.sceneId, takeId: i.takeId, input: { ...i, seed: i.seed ?? 7, audioSec: sec } });
  }

  async submitTranscribe(i: { workspaceId: string; sceneId?: string; championId?: string; takeId?: string; mediaUrl: string; language?: string }): Promise<Submitted> {
    one('submitTranscribe', { sceneId: i.sceneId, championId: i.championId, takeId: i.takeId });
    return this.submit({ workspaceId: i.workspaceId, kind: 'TRANSCRIBE', model: TRANSCRIBE_MODEL.providerModel, sceneId: i.sceneId, championId: i.championId, takeId: i.takeId, input: { ...i } });
  }

  async parseWords(providerTaskId: string): Promise<Words[]> {
    return (await this.parseTranscript(providerTaskId)).words;
  }

  async parseTranscript(providerTaskId: string): Promise<{ language: string; words: TranscriptWord[] }> {
    const t = await this.tasks.get(providerTaskId);
    if (!t) throw new IntegracaoError('TASK_NOT_FOUND', providerTaskId);
    if (t.kind !== 'TRANSCRIBE' || t.status !== 'COMPLETED') throw new IntegracaoError('TASK_NOT_READY', `${t.kind} ${t.status}`);
    const words = ((t.output?.words as Words[]) ?? []).map((w) => ({ ...w }));
    return { language: typeof t.output?.language === 'string' ? t.output.language : 'en', words };
  }

  /** Retoma tasks mock que ficaram SUBMITTED (API reiniciou no meio). Chamado no boot. */
  async resumePending(): Promise<number> {
    const pending = await this.tasks.listSubmitted(MOCK_EXTERNAL_PREFIX);
    for (const t of pending) this.schedule(t);
    return pending.length;
  }

  /** Cancela os timers (shutdown e testes). */
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ---------------------------------------------------------------------------

  private async submit(t: Omit<NewProviderTask, 'externalId' | 'estimatedUsd'>): Promise<Submitted> {
    const rec = await this.tasks.create({ ...t, externalId: MOCK_EXTERNAL_PREFIX + randomUUID(), estimatedUsd: 0 });
    this.schedule(rec);
    return { providerTaskId: rec.id, externalId: rec.externalId, estimatedUsd: 0 };
  }

  private inputSeed(t: ProviderTaskRecord): string {
    return seedOf(t.kind, t.faceId ?? '', t.sceneId ?? '', t.championId ?? '', t.takeId ?? '', JSON.stringify(t.input));
  }

  private schedule(t: ProviderTaskRecord) {
    const fixed = Number(t.input.mockDelayMs);
    const delay = Number.isFinite(fixed) && fixed >= 0 ? fixed : (this.opts.delayMs ?? defaultMockDelay)(this.inputSeed(t));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.complete(t).catch((e) => console.error('[integracoes/mock] failed to complete task', t.id, e));
    }, delay);
    timer.unref?.();
    this.timers.add(timer);
  }

  private async complete(t: ProviderTaskRecord) {
    const failCode = JSON.stringify(t.input).match(FAIL_RE)?.[1] ?? null;
    let status: Exclude<ProviderTaskStatus, 'SUBMITTED'> = 'COMPLETED';
    let outputUrls: string[] = [];
    let output: Record<string, unknown> | null = null;
    let cost: { kind: CostKind; units: number; unit: CostUnit };

    const seed = this.inputSeed(t);
    const format = (t.input.format as VideoFormat | undefined) ?? 'VERTICAL_9_16';

    switch (t.kind) {
      case 'STATIC_IMAGE': {
        const aspect = String(t.input.aspectRatio ?? '9:16') as StaticAspect;
        outputUrls = [mockMediaUrl(this.opts.publicApiUrl, { kind: 'static', seed, format: ASPECT_FORMAT[aspect] ?? 'VERTICAL_9_16' })];
        cost = { kind: 'IMAGE', units: 1, unit: 'image' };
        break;
      }
      case 'FACE_IMAGE':
        outputUrls = [mockMediaUrl(this.opts.publicApiUrl, { kind: 'face', seed, format: 'VERTICAL_9_16' })];
        cost = { kind: 'IMAGE', units: 1, unit: 'image' };
        break;
      case 'SCENE_VIDEO': {
        const sec = Number(t.input.durationSec);
        if (t.input.swap) {
          // §13.15: o rosto enviado (ou o último frame da janela anterior) parado pela genSec, sem cauda; (A) sem trilha
          // de áudio, (B) com um tom no lugar da voz do motor (a transcrição mock lê as palavras das janelas)
          writeMockLipsyncSpec(seed, { faceUrl: String(t.input.faceImageUrl ?? ''), audioUrl: '', sec, tailSec: 0, audio: t.input.sound ? 'tone' : 'none' });
          outputUrls = [mockLipsyncUrl(this.opts.publicApiUrl, seed)];
          output = { durationSec: sec };
        } else {
          outputUrls = [mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed, format, sec })];
        }
        cost = { kind: 'VIDEO', units: sec, unit: 'second' };
        break;
      }
      case 'LIPSYNC_VIDEO': {
        const sec = Number(t.input.videoSec) || 5;
        writeMockLipsyncSpec(seed, { faceUrl: '', audioUrl: String(t.input.audioUrl ?? ''), videoUrl: String(t.input.videoUrl ?? ''), sec, tailSec: 0 });
        outputUrls = [mockLipsyncUrl(this.opts.publicApiUrl, seed)];
        output = { durationSec: sec };
        cost = { kind: 'LIPSYNC', units: Math.ceil(sec - 1e-9), unit: 'second' };
        break;
      }
      case 'TTS': {
        const text = String(t.input.text ?? '');
        outputUrls = [mockMediaUrl(this.opts.publicApiUrl, { kind: 'audio', seed, sec: speechSeconds(text) })];
        output = { durationSec: speechSeconds(text) };
        cost = { kind: 'TTS', units: text.length, unit: 'character' };
        break;
      }
      case 'LIPSYNC': {
        // §13.8: o rosto enviado em loop pela duração do áudio (o YuNet acha rosto no clipe), com o próprio áudio
        const known = Number(t.input.audioSec);
        const sec = known > 0 ? known : await this.sceneSpeechSeconds(t.sceneId);
        writeMockLipsyncSpec(seed, { faceUrl: String(t.input.faceImageUrl ?? ''), audioUrl: String(t.input.audioUrl ?? ''), sec });
        outputUrls = [mockLipsyncUrl(this.opts.publicApiUrl, seed)];
        output = { durationSec: sec };
        cost = { kind: 'LIPSYNC', units: Math.max(2, Math.ceil(sec - 1e-9)), unit: 'second' };
        break;
      }
      case 'TRANSCRIBE': {
        if (t.championId) {
          const p = await (this.opts.probeMedia ?? ffprobeMedia)(String(t.input.mediaUrl ?? ''));
          const sec = p.durationSec ?? 20;
          const language = normalizeLanguage(typeof t.input.language === 'string' && t.input.language ? t.input.language : 'en');
          output = { words: p.hasAudio ? mockChampionWords(language, sec) : [], language };
          cost = { kind: 'TRANSCRIBE', units: Math.ceil(sec), unit: 'second' };
          break;
        }
        const swapWords = !t.takeId && t.sceneId ? await this.swapSceneWords(t.sceneId) : null;
        if (swapWords) {
          output = { words: swapWords.words, language: normalizeLanguage(String(t.input.language ?? 'en')) };
          cost = { kind: 'TRANSCRIBE', units: Math.ceil(swapWords.sec - 1e-9), unit: 'second' };
          break;
        }
        const { text, sec } = t.takeId ? await this.takeSpeech(t.takeId) : await this.sceneSpeech(t.sceneId);
        output = { words: spreadWords(text, sec), language: normalizeLanguage(String(t.input.language ?? 'en')) };
        cost = { kind: 'TRANSCRIBE', units: sec, unit: 'second' };
        break;
      }
    }

    if (failCode) {
      status = failCode === 'PROVIDER_TIMEOUT' ? 'TIMEOUT' : failCode === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      outputUrls = [];
      output = null;
    }

    const done = await this.tasks.finish(t.id, { status, outputUrls, output, errorCode: failCode, errorRaw: failCode ? `mock ${failCode}` : null });
    if (!done) return; // já terminado por outro caminho (idempotência)

    // STATIC: como no live, falha não cobra e o custo vai pro criativo/lote da peça
    const isStatic = t.kind === 'STATIC_IMAGE';
    if (!isStatic || status === 'COMPLETED') {
      await this.costs.record({
        workspaceId: t.workspaceId,
        provider: t.provider,
        kind: cost.kind,
        model: t.model,
        units: cost.units,
        unit: cost.unit,
        amountUsd: 0, // modo mock: custo zero, mas o caminho de gravação é o mesmo do live
        providerTaskId: t.id,
        ...(isStatic && typeof t.input.creativeId === 'string' ? { creativeId: t.input.creativeId } : {}),
        ...(isStatic && typeof t.input.variationBatchId === 'string' ? { variationBatchId: t.input.variationBatchId } : {}),
      });
    }

    this.bus.emit(PROVIDER_TASK_FINISHED, {
      providerTaskId: t.id,
      kind: t.kind,
      status,
      outputUrls,
      errorCode: failCode,
      ...(t.faceId ? { faceId: t.faceId } : {}),
      ...(t.sceneId ? { sceneId: t.sceneId } : {}),
      ...(t.championId ? { championId: t.championId } : {}),
      ...(t.takeId ? { takeId: t.takeId } : {}),
      ...(t.windowIndex != null ? { windowIndex: t.windowIndex } : {}),
      ...(t.renderId ? { renderId: t.renderId } : {}),
    });
  }

  /**
   * §13.15 (B): transcrição do clipe emendado de uma cena SWAP_VIDEO com voz do motor = as falas das janelas (a última
   * tentativa de cada windowIndex), em ordem, cada uma começando 0,3 s depois do início da janela a 2,6 palavras/s,
   * deslocadas pela soma das genSec anteriores. Gatilhos nas notas do campeão: [mock:voice-fit-out] = fala 15 % mais
   * lenta (ratio 1,15); [mock:speech-mismatch] = metade das palavras trocadas. null = não é cena de janelas com som.
   */
  private async swapSceneWords(sceneId: string): Promise<{ words: Words[]; sec: number } | null> {
    const all = await this.tasks.listForScene(sceneId, ['SCENE_VIDEO']);
    const latest = new Map<number, ProviderTaskRecord>();
    for (const t of all) if (t.input.swap && t.windowIndex != null) latest.set(t.windowIndex, t); // listForScene: mais antigas primeiro
    const wins = [...latest.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
    if (!wins.length || !wins.some((w) => w.input.sound)) return null;
    const notes = wins.map((w) => String(w.input.notes ?? '')).join(' ');
    const slow = notes.includes('[mock:voice-fit-out]') ? 1.15 : 1;
    const mismatch = notes.includes('[mock:speech-mismatch]');
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const words: Words[] = [];
    let offset = 0;
    let k = 0;
    for (const w of wins) {
      const gen = Number(w.input.durationSec) || 5;
      const step = slow / 2.6;
      let at = offset + 0.3;
      for (const word of String(w.input.speech ?? '').trim().split(/\s+/).filter(Boolean)) {
        if (at + step * 0.85 > offset + gen) break; // não passa do fim da janela
        words.push({ word: mismatch && k % 2 === 1 ? 'banana' : word, startSec: r(at), endSec: r(at + step * 0.85) });
        at += step;
        k++;
      }
      offset += gen;
    }
    return { words, sec: offset };
  }

  /** §13.5: fala e duração do take = texto do TTS do take (TTS_LIPSYNC), duração do LIPSYNC se houver. */
  private async takeSpeech(takeId: string): Promise<{ text: string; sec: number }> {
    const tts = await this.tasks.latestForTake(takeId, ['TTS']);
    const lip = await this.tasks.latestForTake(takeId, ['LIPSYNC']);
    const text = String(tts?.input.text ?? '');
    const known = Number(lip?.input.audioSec);
    return { text, sec: known > 0 ? known : speechSeconds(text) };
  }

  /** Duração do áudio: ffprobe na URL; sem isso, a fala estimada da cena/take. */
  private async audioSeconds(url: string, sceneId: string | null, takeId: string | null): Promise<number> {
    const p = url ? await (this.opts.probeMedia ?? ffprobeMedia)(url) : { durationSec: null };
    if (p.durationSec) return p.durationSec;
    if (takeId) return (await this.takeSpeech(takeId)).sec;
    return this.sceneSpeechSeconds(sceneId);
  }

  /** Fala e duração da cena, pela task de SCENE_VIDEO ou TTS mais recente dela. */
  private async sceneSpeech(sceneId: string | null): Promise<{ text: string; sec: number }> {
    const src = sceneId ? await this.tasks.latestForScene(sceneId, ['SCENE_VIDEO', 'TTS']) : null;
    if (!src) return { text: '', sec: 5 };
    if (src.kind === 'SCENE_VIDEO') return { text: String(src.input.speech ?? ''), sec: Number(src.input.durationSec) || 5 };
    const text = String(src.input.text ?? '');
    return { text, sec: speechSeconds(text) };
  }

  private async sceneSpeechSeconds(sceneId: string | null): Promise<number> {
    return (await this.sceneSpeech(sceneId)).sec;
  }
}

function one(what: string, ids: Record<string, string | undefined>) {
  const set = Object.entries(ids).filter(([, v]) => !!v);
  if (set.length !== 1) throw new Error(`${what}: pass exactly one of ${Object.keys(ids).join(' / ')}`);
}

/** Distribui as palavras igualmente na duração (o mock não ouve o áudio). */
export function spreadWords(text: string, sec: number): Words[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const step = sec / words.length;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return words.map((word, i) => ({ word, startSec: r(i * step), endSec: r((i + 1) * step) }));
}
