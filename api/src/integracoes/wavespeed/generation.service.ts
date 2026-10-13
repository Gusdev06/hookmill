// GenerationService real (I3): submete na WaveSpeed (rosto na Higgsfield Soul V2 desde 06/10), grava provider_tasks ANTES de responder, termina pelo
// webhook (assinado) ou pelo reconciliador (polling), grava cost_entries com o custo real por unidade e emite
// 'provider.task.finished'. Sem regra de negócio: baixar a saída e validar o arquivo inteiro é do backend
// (StorageService.ingestFromUrl), porque a WaveSpeed já entregou download truncado sem erro.
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { billedSceneSeconds } from '../catalogo/catalog.service';
import { FACE_MODEL, SWAP_ENGINES, SWAP_V2V_MODEL, TRANSCRIBE_MODEL, TTS_MODEL, VOICES, findSceneModel, round4, speechSeconds } from '../catalogo/precos';
import type { FaceAspect, GenerationService, Submitted, TranscriptWord, VideoFormat } from '../contrato';
import { assertTakeDuration } from '../catalogo/take';
import { IntegracaoError } from '../erros';
import {
  PROVIDER_TASK_FINISHED,
  type CostKind,
  type CostStore,
  type CostUnit,
  type ProviderTaskKind,
  type ProviderTaskRecord,
  type ProviderTaskStore,
  type TaskEventBus,
  type TaskProvider,
} from '../portas';
import { HfContentRejected, SOUL_V2_ENDPOINT, hfFinalStatus, type HfRequest, type HfSoulInput, type HiggsfieldClient } from '../higgsfield/cliente';
import { WsContentRejected, toPrediction, type WaveSpeedClient, type WsPrediction } from './cliente';
import { ffprobeSeconds, type ProbeSeconds } from './duracao';
import { filenameFor, isPublicUrl, readInput } from './midia-publica';
import { extractWords, finalStatus, type Final, type Word } from './normalizar';
import { transcriptLanguage } from './idioma';
import {
  LIPSYNC_SEED,
  SCENE_NEGATIVE,
  SWAP_NEGATIVE,
  seedanceSwapAspect,
  swapScenePrompt,
  mediaPrompts,
  minimaxLanguage,
  seedanceAspect,
  whisperLanguage,
  type MediaPromptVersion,
  type MediaPrompts,
} from './prompts-midia';

/** externalId das tasks recusadas na submissão (nunca existiram na WaveSpeed). */
export const REJECTED_PREFIX = 'rejected_';
const MOCK_PREFIX = 'mock_';

export interface WaveSpeedGenOptions {
  /** URL pública do webhook; null = WAVESPEED_WEBHOOKS=off (só reconciliador). */
  webhookUrl: string | null;
  probeSeconds?: ProbeSeconds;
  /** baixa a saída de texto do Whisper quando vier como URL */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** espera entre tentativas de achar a task quando o webhook chega antes do insert (ms) */
  lookupRetryMs?: number;
  /** PUBLIC_MEDIA=off: sobe TODA entrada pela WaveSpeed, mesmo com URL pública */
  forceUpload?: boolean;
  /** Rosto (Soul V2). null/ausente = HF_API_KEY_ID/SECRET vazios → submitFace falha NOT_CONFIGURED (nunca mock). */
  higgsfield?: HiggsfieldClient | null;
  /** MEDIA_PROMPTS (v1 | v2). Padrão v2 desde 06/10. */
  promptVersion?: MediaPromptVersion;
}

/** Resultado de um provedor já normalizado (WaveSpeed prediction ou request da Higgsfield). */
interface Outcome {
  fin: { status: Final; errorCode: string | null } | null;
  outputs: string[];
  error: string | null;
  output: Record<string, unknown>;
  lastStatus: string;
  /** só WaveSpeed: a transcrição lê a saída crua */
  ws?: WsPrediction;
}

const httpUrls = (xs: unknown[]) => xs.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));

function fromWs(p: WsPrediction): Outcome {
  return { fin: finalStatus(p), outputs: httpUrls(p.outputs), error: p.error, output: { prediction: p.raw }, lastStatus: p.status, ws: p };
}

function fromHf(r: HfRequest): Outcome {
  return { fin: hfFinalStatus(r), outputs: r.images, error: r.error, output: { request: r.raw }, lastStatus: r.status };
}

interface Cost {
  kind: CostKind;
  units: number;
  unit: CostUnit;
  usdPerUnit: number;
}

export class WaveSpeedGenerationService implements GenerationService {
  private readonly log = new Logger('WaveSpeed');
  private readonly probe: ProbeSeconds;
  private readonly now: () => number;
  /** URL de entrada → URL da WaveSpeed já subida (o mesmo rosto entra em 3-5 cenas; sobe uma vez só). */
  private readonly uploaded = new Map<string, Promise<string>>();
  private readonly prompts: MediaPrompts;

  constructor(
    private readonly client: WaveSpeedClient,
    private readonly tasks: ProviderTaskStore,
    private readonly costs: CostStore,
    private readonly bus: TaskEventBus,
    private readonly opts: WaveSpeedGenOptions,
  ) {
    this.probe = opts.probeSeconds ?? ffprobeSeconds;
    this.now = opts.now ?? Date.now;
    this.prompts = mediaPrompts(opts.promptVersion);
  }

  // ------------------------------------------------------------------ submissões

  /** Rosto na Higgsfield Soul V2 (1080p 9:16, 1 imagem). Termina pelo laço rápido do reconciliador (polling). */
  async submitFace(i: { workspaceId: string; faceId: string; description: string; language: string; aspectRatio?: FaceAspect }): Promise<Submitted> {
    const hf = this.opts.higgsfield;
    if (!hf) throw new IntegracaoError('NOT_CONFIGURED', 'GenerationService.submitFace: HF_API_KEY_ID / HF_API_KEY_SECRET is empty in api/.env');
    const aspect = i.aspectRatio ?? FACE_MODEL.aspectRatio; // §13.3: aspecto da região do rosto do campeão
    const body: HfSoulInput = { prompt: this.prompts.face(i.description, aspect), aspect_ratio: aspect, resolution: FACE_MODEL.resolution, batch_size: 1 };
    const t = { workspaceId: i.workspaceId, faceId: i.faceId };
    const input = { ...i, promptVersion: this.prompts.version, request: body };
    let r: HfRequest;
    try {
      r = await hf.submit(SOUL_V2_ENDPOINT, body, randomUUID());
    } catch (e) {
      if (!(e instanceof HfContentRejected)) throw e;
      return this.rejected('FACE_IMAGE', 'HIGGSFIELD', FACE_MODEL.providerModel, t, input, e.message);
    }
    const est = round4(FACE_MODEL.usdPerImage);
    const rec = await this.tasks.create({ ...t, provider: 'HIGGSFIELD', kind: 'FACE_IMAGE', model: FACE_MODEL.providerModel, externalId: r.requestId, input, estimatedUsd: est });
    if (hfFinalStatus(r)) setImmediate(() => void this.process(rec, fromHf(r)).catch((err) => this.log.error(err)));
    return { providerTaskId: rec.id, externalId: rec.externalId, estimatedUsd: est };
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
    const image = await this.reachable(i.faceImageUrl, 'face');
    const { notes: _notes, ...rest } = i; // notas do campeão: só o mock lê
    if (i.windowIndex == null) {
      // cena v1 (motor de cenas com fala)
      const prompt = this.prompts.scene(i);
      const body =
        m.id === 'kling-3.0'
          ? // Kling segue a proporção da imagem (rosto 9:16); 4:5 e 1:1 saem por recorte no render
            { image, prompt, negative_prompt: SCENE_NEGATIVE, duration: durationSec, sound: true, cfg_scale: 0.5 }
          : { image, prompt, duration: durationSec, resolution: '720p', aspect_ratio: seedanceAspect(i.format), generate_audio: true };
      return this.submit('SCENE_VIDEO', m.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, input: { ...rest, durationSec, catalogModel: m.id, promptVersion: this.prompts.version } }, durationSec * m.usdPerSecond);
    }
    // §13.15: janela do Trocar avatar. Nenhum dos dois modelos tem `seed` no schema (WaveSpeed, 08/10): fica só gravado.
    const sound = i.sound === true;
    const engine = swapEngineOf(m.id);
    const resolution = engine === 'KLING' ? '1080p' : (i.resolution ?? '720p');
    const prompt = swapScenePrompt({ visualPrompt: i.visualPrompt, speech: i.speech, language: i.language, sound, voiceDescriptor: i.voiceDescriptor });
    const body =
      engine === 'KLING'
        ? { image, prompt, negative_prompt: SWAP_NEGATIVE, duration: durationSec, sound, cfg_scale: 0.5 }
        : { image, prompt, duration: durationSec, resolution, ...(i.aspectRatio ? { aspect_ratio: seedanceSwapAspect(i.aspectRatio) } : {}), generate_audio: sound };
    const usdPerSecond = SWAP_ENGINES[engine].usdPerSecond(resolution, sound);
    return this.submit('SCENE_VIDEO', m.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, windowIndex: i.windowIndex, input: { ...rest, durationSec, sound, resolution, usdPerSecond, catalogModel: m.id, swap: true } }, durationSec * usdPerSecond);
  }

  /** §13.15 (A): lipsync vídeo-a-vídeo do nosso clipe mudo com a fatia do áudio do campeão. Cobra por s do VÍDEO. */
  async submitLipsyncVideo(i: { workspaceId: string; sceneId: string; videoUrl: string; audioUrl: string; seed?: number }): Promise<Submitted> {
    const sec = await this.mediaSeconds(i.videoUrl, i.sceneId);
    const [video, audio] = await Promise.all([this.reachable(i.videoUrl, 'video'), this.reachable(i.audioUrl, 'audio')]);
    const body = { video, audio, sync_mode: SWAP_V2V_MODEL.syncMode };
    return this.submit('LIPSYNC_VIDEO', SWAP_V2V_MODEL.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, input: { ...i, videoSec: sec } }, Math.ceil(sec - 1e-9) * SWAP_V2V_MODEL.usdPerSecond);
  }

  /** Cena (v1) ou take (§13.5: texto inteiro numa chamada; a MiniMax aceita até 10 mil caracteres). */
  async submitTts(i: { workspaceId: string; sceneId?: string; takeId?: string; voiceId: string; text: string; language: string }): Promise<Submitted> {
    one('submitTts', { sceneId: i.sceneId, takeId: i.takeId });
    if (!VOICES.some((v) => v.id === i.voiceId)) throw new IntegracaoError('INVALID_VOICE', `unknown voice "${i.voiceId}"`);
    if (i.text.length > TTS_MODEL.maxChars) throw new IntegracaoError('INVALID_SCRIPT', `TTS text has ${i.text.length} characters (max ${TTS_MODEL.maxChars})`);
    const lang = minimaxLanguage(i.language);
    const body = { text: i.text, voice_id: i.voiceId, language_boost: lang, english_normalization: lang === 'English', format: 'mp3', sample_rate: 44100 };
    return this.submit('TTS', TTS_MODEL.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, takeId: i.takeId, input: { ...i } }, i.text.length * TTS_MODEL.usdPerChar);
  }

  /** Cena (v1) ou take (§13.5: áudio inteiro numa chamada, até 600 s). seed: 7 na 1ª tentativa; o backend manda 7 + attempt. */
  async submitLipsync(i: { workspaceId: string; sceneId?: string; takeId?: string; faceImageUrl: string; audioUrl: string; visualPrompt: string; format: VideoFormat; seed?: number }): Promise<Submitted> {
    one('submitLipsync', { sceneId: i.sceneId, takeId: i.takeId });
    const m = findSceneModel('pruna-lipsync')!;
    // mede ANTES de subir/pagar: áudio acima do teto do Pruna é erro explícito, nunca corte silencioso
    const sec = await this.mediaSeconds(i.audioUrl, i.sceneId ?? null, i.takeId ?? null);
    assertTakeDuration(sec);
    const [image, audio] = await Promise.all([this.reachable(i.faceImageUrl, 'face'), this.reachable(i.audioUrl, 'audio')]);
    const seed = Number.isInteger(i.seed) ? (i.seed as number) : LIPSYNC_SEED;
    const body = { image, audio, video_prompt: this.prompts.lipsync(i.visualPrompt), resolution: '720p', seed };
    return this.submit('LIPSYNC', m.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, takeId: i.takeId, input: { ...i, seed, audioSec: sec, promptVersion: this.prompts.version } }, Math.max(m.minSceneSec, Math.ceil(sec)) * m.usdPerSecond);
  }

  /** Cena (v1), campeão (feature 2) ou take (§13.5). Sem `language` = detecção automática do Whisper (`auto`). */
  async submitTranscribe(i: { workspaceId: string; sceneId?: string; championId?: string; takeId?: string; mediaUrl: string; language?: string }): Promise<Submitted> {
    one('submitTranscribe', { sceneId: i.sceneId, championId: i.championId, takeId: i.takeId });
    const body = { video: await this.reachable(i.mediaUrl, 'media'), language: i.language ? whisperLanguage(i.language) : 'auto', task: 'transcribe', enable_timestamps: true };
    const sec = await this.mediaSeconds(i.mediaUrl, i.sceneId ?? null, i.takeId ?? null);
    return this.submit('TRANSCRIBE', TRANSCRIBE_MODEL.providerModel, body, { workspaceId: i.workspaceId, sceneId: i.sceneId, championId: i.championId, takeId: i.takeId, input: { ...i } }, Math.ceil(sec) * TRANSCRIBE_MODEL.usdPerSecond);
  }

  async parseWords(providerTaskId: string): Promise<Word[]> {
    return (await this.parseTranscript(providerTaskId)).words;
  }

  async parseTranscript(providerTaskId: string): Promise<{ language: string; words: TranscriptWord[] }> {
    const t = await this.tasks.get(providerTaskId);
    if (!t) throw new IntegracaoError('TASK_NOT_FOUND', providerTaskId);
    if (t.kind !== 'TRANSCRIBE' || t.status !== 'COMPLETED') throw new IntegracaoError('TASK_NOT_READY', `${t.kind} ${t.status}`);
    const words = ((t.output?.words as Word[]) ?? []).map((w) => ({ ...w }));
    const language = typeof t.output?.language === 'string' ? t.output.language : transcriptLanguage({ requested: t.input.language as string | undefined, text: words.map((w) => w.word).join(' ') });
    return { language, words };
  }

  // ------------------------------------------------------------------ fim da task (webhook e reconciliador)

  /** Webhook já verificado. Webhook pode chegar antes do insert (TTS termina em segundos): tenta achar 3x. */
  async handleWebhook(body: unknown): Promise<'processed' | 'pending' | 'unknown' | 'duplicate'> {
    const p = toPrediction((body ?? {}) as Record<string, unknown>);
    if (!p.id) return 'unknown';
    let t: ProviderTaskRecord | null = null;
    for (let i = 0; i < 3 && !t; i++) {
      t = await this.tasks.findByExternalId(p.id);
      if (!t && i < 2) await sleep(this.opts.lookupRetryMs ?? 1000);
    }
    if (!t) {
      this.log.warn(`webhook for unknown prediction ${p.id} (${p.model ?? '?'}): ignored`);
      return 'unknown';
    }
    if (t.status !== 'SUBMITTED') return 'duplicate';
    return (await this.process(t, fromWs(p))) ? 'processed' : 'pending';
  }

  /**
   * Reconciliador: tasks SUBMITTED há mais de `minAgeMs` são consultadas; terminadas são processadas igual ao
   * webhook; passou de `timeoutMs` sem terminar → TIMEOUT (PROVIDER_TIMEOUT). Devolve quantas fechou.
   */
  async reconcile(o: { minAgeMs: number; timeoutMs: number; limit?: number; provider?: TaskProvider }): Promise<number> {
    const now = this.now();
    const stale = await this.tasks.listStale(new Date(now - o.minAgeMs), MOCK_PREFIX, o.limit ?? 50, o.provider);
    let closed = 0;
    for (const t of stale) {
      if (t.externalId.startsWith(REJECTED_PREFIX)) continue;
      const tooOld = now - t.submittedAt.getTime() > o.timeoutMs;
      try {
        const out = await this.poll(t);
        if (!out) continue;
        await this.tasks.markPolled(t.id);
        if (await this.process(t, out)) closed++;
        else if (tooOld && (await this.close(t, 'TIMEOUT', 'PROVIDER_TIMEOUT', [], { lastStatus: out.lastStatus }, 'reconciler: no result after timeout'))) closed++;
      } catch (e) {
        if (e instanceof IntegracaoError && e.code === 'TASK_NOT_FOUND' && tooOld) {
          if (await this.close(t, 'FAILED', 'PROVIDER_ERROR', [], null, 'prediction not found at provider')) closed++;
        } else {
          this.log.warn(`reconcile ${t.externalId}: ${(e as Error).message}`);
        }
      }
    }
    return closed;
  }

  // ------------------------------------------------------------------ internos

  /** Consulta o provedor certo da task. null = provedor sem cliente configurado (não dá pra consultar). */
  private async poll(t: ProviderTaskRecord): Promise<Outcome | null> {
    if (t.provider === 'HIGGSFIELD') {
      if (!this.opts.higgsfield) {
        this.log.warn(`reconcile ${t.externalId}: higgsfield task but HF_API_KEY_ID/SECRET empty`);
        return null;
      }
      return fromHf(await this.opts.higgsfield.status(t.externalId));
    }
    return fromWs(await this.client.result(t.externalId));
  }

  /** Recusa de conteúdo na submissão: mesmo caminho de uma task que falhou (rosto/cena FAILED + SAFETY_BLOCK). */
  private async rejected(
    kind: ProviderTaskKind,
    provider: TaskProvider,
    model: string,
    t: { workspaceId: string; faceId?: string; sceneId?: string; championId?: string; takeId?: string; windowIndex?: number },
    input: Record<string, unknown>,
    message: string,
  ): Promise<Submitted> {
    const rec = await this.tasks.create({ workspaceId: t.workspaceId, provider, kind, model, externalId: REJECTED_PREFIX + randomUUID(), input, estimatedUsd: 0, faceId: t.faceId, sceneId: t.sceneId, championId: t.championId, takeId: t.takeId, windowIndex: t.windowIndex });
    setImmediate(() => void this.close(rec, 'FAILED', 'SAFETY_BLOCK', [], null, message).catch((err) => this.log.error(err)));
    return { providerTaskId: rec.id, externalId: rec.externalId, estimatedUsd: 0 };
  }

  /** URL que a WaveSpeed consegue baixar: a própria, se pública; senão baixa do storage e sobe pela WaveSpeed. */
  private reachable(url: string, kind: string): Promise<string> {
    if (!this.opts.forceUpload && isPublicUrl(url)) return Promise.resolve(url);
    const key = url.split('?')[0]; // URL assinada muda a query a cada pedido; o objeto é o mesmo
    const hit = this.uploaded.get(key);
    if (hit) return hit;
    const job = (async () => {
      const { bytes, contentType } = await readInput(url, this.opts.fetchImpl ?? fetch);
      return this.client.upload(bytes, filenameFor(url, contentType, kind));
    })();
    job.catch(() => this.uploaded.delete(key)); // falhou: a próxima tentativa sobe de novo
    if (this.uploaded.size > 500) this.uploaded.clear();
    this.uploaded.set(key, job);
    return job;
  }

  private async submit(
    kind: ProviderTaskKind,
    providerModel: string,
    body: Record<string, unknown>,
    t: { workspaceId: string; faceId?: string; sceneId?: string; championId?: string; takeId?: string; windowIndex?: number; input: Record<string, unknown> },
    estimatedUsd: number,
  ): Promise<Submitted> {
    const est = round4(estimatedUsd);
    const input = { ...t.input, request: body };
    let p: WsPrediction;
    try {
      p = await this.client.submit(providerModel, body, this.opts.webhookUrl);
    } catch (e) {
      if (!(e instanceof WsContentRejected)) throw e;
      return this.rejected(kind, 'WAVESPEED', providerModel, t, input, e.message);
    }
    const rec = await this.tasks.create({ workspaceId: t.workspaceId, kind, model: providerModel, externalId: p.id, input, estimatedUsd: est, faceId: t.faceId, sceneId: t.sceneId, championId: t.championId, takeId: t.takeId, windowIndex: t.windowIndex });
    if (finalStatus(p)) setImmediate(() => void this.process(rec, fromWs(p)).catch((err) => this.log.error(err))); // modo síncrono / já terminou
    return { providerTaskId: rec.id, externalId: rec.externalId, estimatedUsd: est };
  }

  /** true = a task terminou (agora ou antes); false = ainda rodando no provedor. */
  private async process(t: ProviderTaskRecord, o: Outcome): Promise<boolean> {
    if (!o.fin) return false;
    let { status, errorCode } = o.fin;
    let outputUrls = status === 'COMPLETED' ? o.outputs : [];
    let output: Record<string, unknown> = o.output;

    if (status === 'COMPLETED' && t.kind === 'TRANSCRIBE' && o.ws) {
      const fallbackSec = await this.mediaSeconds(String(t.input.mediaUrl ?? ''), t.sceneId, t.takeId);
      const src = await this.transcriptSource(o.ws);
      const { words, source } = extractWords(src, fallbackSec);
      const language = transcriptLanguage({ raw: [src, o.ws.raw], requested: t.input.language as string | undefined, text: words.map((w) => w.word).join(' ') });
      output = { words, wordsSource: source, language, prediction: o.ws.raw };
      outputUrls = []; // transcrição não vira arquivo no storage
      if (source === 'none') this.log.warn(`transcribe ${t.externalId}: no text in output`);
    } else if (status === 'COMPLETED' && !outputUrls.length) {
      status = 'FAILED';
      errorCode = 'PROVIDER_ERROR';
    }

    const cost = status === 'COMPLETED' ? await this.costOf(t) : null;
    return this.close(t, status, errorCode, outputUrls, output, o.error, cost);
  }

  /** Fecha a task (compare-and-set), grava o custo e emite o evento. false se outro caminho fechou antes. */
  private async close(t: ProviderTaskRecord, status: Final, errorCode: string | null, outputUrls: string[], output: Record<string, unknown> | null, errorRaw: string | null, cost: Cost | null = null): Promise<boolean> {
    const done = await this.tasks.finish(t.id, { status, outputUrls, output, errorCode, errorRaw: errorRaw ? errorRaw.slice(0, 2000) : null });
    if (!done) return true;
    if (cost) {
      await this.costs.record({
        workspaceId: t.workspaceId, provider: t.provider, kind: cost.kind, model: t.model,
        units: round4(cost.units), unit: cost.unit, amountUsd: round4(cost.units * cost.usdPerUnit), providerTaskId: t.id,
      });
    }
    this.bus.emit(PROVIDER_TASK_FINISHED, {
      providerTaskId: t.id, kind: t.kind, status, outputUrls, errorCode,
      ...(t.faceId ? { faceId: t.faceId } : {}),
      ...(t.sceneId ? { sceneId: t.sceneId } : {}),
      ...(t.championId ? { championId: t.championId } : {}),
      ...(t.takeId ? { takeId: t.takeId } : {}),
      ...(t.windowIndex != null ? { windowIndex: t.windowIndex } : {}),
    });
    return true;
  }

  /** Custo real por unidade (o preço base é por segundo / imagem / caractere, nunca por chamada). Rosto = Soul V2. */
  private async costOf(t: ProviderTaskRecord): Promise<Cost> {
    switch (t.kind) {
      case 'FACE_IMAGE':
        return { kind: 'IMAGE', units: 1, unit: 'image', usdPerUnit: FACE_MODEL.usdPerImage };
      case 'SCENE_VIDEO': {
        const m = findSceneModel(String(t.input.catalogModel)) ?? findSceneModel('kling-3.0')!;
        // §13.15: janela do Trocar avatar grava o preço/s da combinação (som, resolução) na submissão
        const swapUsd = Number(t.input.usdPerSecond);
        return { kind: 'VIDEO', units: Number(t.input.durationSec), unit: 'second', usdPerUnit: t.input.swap && swapUsd > 0 ? swapUsd : m.usdPerSecond };
      }
      case 'LIPSYNC_VIDEO': {
        const known = Number(t.input.videoSec);
        const sec = known > 0 ? known : await this.mediaSeconds(String(t.input.videoUrl ?? ''), t.sceneId);
        return { kind: 'LIPSYNC', units: Math.ceil(sec - 1e-9), unit: 'second', usdPerUnit: SWAP_V2V_MODEL.usdPerSecond };
      }
      case 'TTS':
        return { kind: 'TTS', units: String(t.input.text ?? '').length, unit: 'character', usdPerUnit: TTS_MODEL.usdPerChar };
      case 'LIPSYNC': {
        const m = findSceneModel('pruna-lipsync')!;
        const known = Number(t.input.audioSec);
        const sec = known > 0 ? known : await this.mediaSeconds(String(t.input.audioUrl ?? ''), t.sceneId, t.takeId);
        return { kind: 'LIPSYNC', units: Math.max(m.minSceneSec, Math.ceil(sec)), unit: 'second', usdPerUnit: m.usdPerSecond };
      }
      case 'TRANSCRIBE': {
        const sec = await this.mediaSeconds(String(t.input.mediaUrl ?? ''), t.sceneId, t.takeId);
        return { kind: 'TRANSCRIBE', units: Math.ceil(sec), unit: 'second', usdPerUnit: TRANSCRIBE_MODEL.usdPerSecond };
      }
    }
  }

  /** Duração real da mídia (ffprobe na URL); sem isso, a estimada pela fala/cena. */
  private async mediaSeconds(url: string, sceneId: string | null, takeId: string | null = null): Promise<number> {
    const real = url ? await this.probe(url) : null;
    if (real) return real;
    const src = sceneId ? await this.tasks.latestForScene(sceneId, ['SCENE_VIDEO', 'TTS']) : takeId ? await this.tasks.latestForTake(takeId, ['TTS']) : null;
    if (src?.kind === 'SCENE_VIDEO') return Number(src.input.durationSec) || 5;
    if (src?.kind === 'TTS') return speechSeconds(String(src.input.text ?? ''));
    return 5;
  }

  /** Saída do Whisper: texto/JSON inline, ou URL de um arquivo de texto (baixa até 2 MB). */
  private async transcriptSource(p: WsPrediction): Promise<unknown> {
    const first = p.outputs[0];
    if (typeof first === 'string' && /^https?:\/\//.test(first)) {
      try {
        const res = await (this.opts.fetchImpl ?? fetch)(first, { signal: AbortSignal.timeout(20_000) });
        const text = (await res.text()).slice(0, 2_000_000);
        return text;
      } catch (e) {
        this.log.warn(`transcript download failed: ${(e as Error).message}`);
        return null;
      }
    }
    return p.outputs.length ? (p.outputs.length === 1 ? first : p.outputs) : p.raw;
  }
}

function swapEngineOf(catalogModel: string): 'KLING' | 'SEEDANCE' {
  if (catalogModel === SWAP_ENGINES.KLING.catalogModel) return 'KLING';
  if (catalogModel === SWAP_ENGINES.SEEDANCE.catalogModel) return 'SEEDANCE';
  throw new IntegracaoError('INVALID_MODEL', `model "${catalogModel}" has no swap window`);
}

/** Exatamente um alvo por task (cena, campeão ou take). */
function one(what: string, ids: Record<string, string | undefined>) {
  const set = Object.entries(ids).filter(([, v]) => !!v);
  if (set.length !== 1) throw new Error(`${what}: pass exactly one of ${Object.keys(ids).join(' / ')}`);
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
