import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EditMap, SwapVoiceSource, TranscriptWord } from '@maquina/contratos';
import { Prisma, type Creative, type ProviderTask, type Scene as SceneRow } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { asAsyncErrorCode, codeFromTaskStatus, failReasonFor } from '../common/errors/falhas';
import { KeyedMutex } from '../common/util/mutex';
import { spanRegion } from '../campeoes/mapa-edicao';
import { CreativeViews, currentScenes, scenesSummary } from '../criativos/views';
import { EventosService } from '../eventos/eventos.service';
import { CATALOG_SERVICE, GENERATION_SERVICE, integracoesMode, isIntegracaoError, type CatalogService, type GenerationService } from '../integracoes';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { PrismaService } from '../prisma/prisma.service';
import { largestRegion, loadEditMap, swapSceneEstimate } from './estimativa';
import { SwapPortMissing, swapCatalog, swapGen, swapMedia } from './portas';
import {
  SPEECH_MATCH_MIN, SWAP_MODEL, compactWindows, engineVoiceEnabled, fittedWords, speechMatch, engineOfModel, freshWindows, identityOk, swapProgress, windowsOf,
  type StoredWindow, type VideoSwapEngine,
} from './regras';

const PENDING = ['QUEUED', 'GENERATING'] as const;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Falha da cadeia com código do contrato (vai pra cena como errorCode). */
export class SwapError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SwapError';
  }
}

/** `copy` = palavras do teardown no trecho (relativas ao início dele): a copy do campeão, nunca a transcrição do motor. */
type Ctx = { scene: SceneRow; c: Creative; m: EditMap; engine: VideoSwapEngine; voiceSource: SwapVoiceSource; startFrame: number; endFrame: number; copy: TranscriptWord[] };

/**
 * §13.15.3: a cena SWAP_VIDEO (1 trecho main) do Trocar avatar com Kling/Seedance.
 *   1 windows:  SCENE_VIDEO janela por janela, em sequência (a k+1 parte do último frame da k)
 *   2 joining:  emenda as janelas e corta no nº exato de frames do trecho → raw_clip_file_id (sem som)
 *   3 lipsync:  (A) LIPSYNC_VIDEO do clipe cru com a fatia do áudio do campeão
 *   4 checking: identidade (SFace) contra o rosto escolhido → READY ou FAILED IDENTITY_DRIFT
 * (B) ENGINE_VOICE fica fora do build até a sonda S2 (ENGINE_VOICE_ENABLED). Sem retentativa paga automática: falha =
 * cena FAILED com motivo; "Refazer trecho" é do usuário. Quem fecha a geração do criativo é o `settle` do chamador.
 */
@Injectable()
export class TrocaService {
  private readonly log = new Logger('Troca');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly views: CreativeViews,
    private readonly eventos: EventosService,
    private readonly locks: KeyedMutex,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
  ) {}

  // ───────── contexto ─────────

  /** Mapa da edição do criativo: a fotografia do lote (a mesma do plano); senão o do campeão. */
  editMapFor(c: Pick<Creative, 'variationBatchId' | 'championId'>): Promise<EditMap | null> {
    return loadEditMap(this.prisma, c);
  }

  private async ctx(scene: SceneRow, c: Creative): Promise<Ctx> {
    const engine = engineOfModel(c.engineModel);
    if (!engine) throw new Error(`criativo ${c.id}: engineModel ${c.engineModel} não é motor de troca`);
    if (scene.startFrame == null || scene.endFrame == null) throw new Error(`cena ${scene.id} sem trecho em frames`);
    const voiceSource: SwapVoiceSource = c.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO';
    if (voiceSource === 'ENGINE_VOICE' && !engineVoiceEnabled(engine)) throw new Error(`ENGINE_VOICE fora do build pra ${engine}`);
    const m = await this.editMapFor(c);
    if (!m) throw new Error(`criativo ${c.id} sem mapa da edição`);
    const copy = (await this.copyOf(c, scene.startFrame / m.fps, scene.endFrame / m.fps)) ?? wordsOf(scene.words);
    return { scene, c, m, engine, voiceSource, startFrame: scene.startFrame, endFrame: scene.endFrame, copy };
  }

  private async faceFile(c: Pick<Creative, 'selectedFaceId'>) {
    const face = c.selectedFaceId ? await this.prisma.face.findUnique({ where: { id: c.selectedFaceId }, include: { file: true } }) : null;
    if (!face?.file) throw new Error('rosto escolhido sem arquivo');
    return face.file;
  }

  /** Palavras do teardown (fotografia do lote) em [a, b) s, relativas a a. null sem fotografia. */
  private async copyOf(c: Pick<Creative, 'variationBatchId'>, a: number, b: number): Promise<TranscriptWord[] | null> {
    if (!c.variationBatchId) return null;
    const batch = await this.prisma.variationBatch.findUnique({ where: { id: c.variationBatchId }, select: { teardownSnapshot: true } });
    const ws = (batch?.teardownSnapshot as { words?: TranscriptWord[] } | null)?.words;
    if (!Array.isArray(ws)) return null;
    return ws
      .filter((w) => (w.startSec + w.endSec) / 2 >= a && (w.startSec + w.endSec) / 2 < b)
      .map((w) => ({ word: w.word, startSec: r3(Math.max(0, w.startSec - a)), endSec: r3(Math.min(b, w.endSec) - a) }));
  }

  private region(x: Ctx) {
    const r = spanRegion(x.m, x) ?? largestRegion(x.m);
    if (!r) throw new Error('trecho sem região do rosto');
    return { w: r.w, h: r.h };
  }

  // ───────── submissão ─────────

  /**
   * Primeiro passo da cena (launch, novo Generate ou "Refazer trecho"): planeja as janelas da tentativa e submete a 1ª.
   * Falha = cena FAILED. Devolve true se algo foi submetido (ou bloqueio de conteúdo, que não é provedor fora do ar).
   */
  async submitFirstStep(c: Creative, sceneId: string): Promise<boolean> {
    const s = await this.prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
    try {
      const x = await this.ctx(s, c);
      const region = this.region(x);
      const aspect = this.catalog.faceAspectFor(region.w, region.h);
      const resolution = x.engine === 'KLING' ? '1080p' : swapCatalog(this.catalog, 'swapResolutionFor').swapResolutionFor(region, aspect);
      const plan = swapCatalog(this.catalog, 'planSwapWindows').planSwapWindows({
        spanSec: (x.endFrame - x.startFrame) / x.m.fps, words: x.copy, engine: x.engine, voiceSource: x.voiceSource,
      });
      if (!plan.length) throw new Error('planSwapWindows sem janela');
      const windows = freshWindows(plan, resolution, s.attempt);
      // (B) refeito: a legenda volta pra copy até a transcrição nova chegar
      await this.prisma.scene.update({ where: { id: s.id }, data: { windows: windows as unknown as Prisma.InputJsonValue, ...(x.voiceSource === 'ENGINE_VOICE' && { words: x.copy as unknown as Prisma.InputJsonValue }) } });
      await this.submitWindow(x, windows, 0, await this.storage.signedUrl(await this.faceFile(c)));
      await this.prisma.scene.updateMany({ where: { id: s.id, status: 'QUEUED' }, data: { status: 'GENERATING', progress: 5 } });
      await this.publish(s.id);
      return true;
    } catch (e) {
      const code = this.codeOf(e);
      this.log.warn(`submissão da cena SWAP_VIDEO ${s.id} falhou: ${(e as Error).message}`);
      await this.fail(s.id, code);
      return code === 'SAFETY_BLOCK';
    }
  }

  /** Submete a janela k (imagem = rosto na 1ª, último frame da anterior nas seguintes) e marca GENERATING. */
  private async submitWindow(x: Ctx, windows: StoredWindow[], k: number, imageUrl: string) {
    const w = windows[k];
    const region = this.region(x);
    const speech = x.voiceSource === 'ENGINE_VOICE'
      ? x.copy.filter((p) => (p.startSec + p.endSec) / 2 >= w.startSec && (p.startSec + p.endSec) / 2 < w.endSec).map((p) => p.word).join(' ')
      : '';
    await swapGen(this.gen, 'submitSceneVideo').submitSceneVideo({
      workspaceId: x.c.workspaceId, sceneId: x.scene.id, windowIndex: k, model: SWAP_MODEL[x.engine], faceImageUrl: imageUrl,
      speech, sound: x.voiceSource === 'ENGINE_VOICE', visualPrompt: x.scene.visualPrompt, durationSec: w.genSec, format: x.c.format,
      aspectRatio: this.catalog.faceAspectFor(region.w, region.h), ...(w.resolution !== '1080p' && { resolution: w.resolution }),
      seed: w.seed, language: x.c.language, notes: await this.championNotes(x.c),
    });
    const next = windows.map((y, i) => (i === k ? { ...y, status: 'GENERATING' as const } : y));
    await this.prisma.scene.update({ where: { id: x.scene.id }, data: { windows: next as unknown as Prisma.InputJsonValue } });
  }

  /** Notas do campeão (só o mock da ia lê: gatilhos [mock:voice-fit-out] / [mock:speech-mismatch]). */
  private async championNotes(c: Pick<Creative, 'championId'>): Promise<string | null> {
    if (!c.championId) return null;
    return (await this.prisma.champion.findUnique({ where: { id: c.championId }, select: { notes: true } }))?.notes ?? null;
  }

  // ───────── fim de task (chamado pelo orquestrador) ─────────

  /** Task de uma cena SWAP_VIDEO terminou. Resultado de tentativa antiga, repetido ou fora de ordem só é ignorado. Nunca lança. */
  async onTask(t: ProviderTask): Promise<string | null> {
    const pre = await this.prisma.scene.findUnique({ where: { id: t.sceneId! }, select: { id: true, creativeId: true } });
    if (!pre) return null;
    await this.locks.run(`swap:${pre.id}`, () => this.handle(t, pre.id));
    return pre.creativeId;
  }

  private async handle(t: ProviderTask, sceneId: string) {
    const scene = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!scene || scene.stale || !(PENDING as readonly string[]).includes(scene.status)) return;
    if (scene.startedAt && t.submittedAt < scene.startedAt) return; // tentativa anterior
    const c = await this.prisma.creative.findUnique({ where: { id: scene.creativeId } });
    if (!c || c.archivedAt) return;
    try {
      const x = await this.ctx(scene, c);
      if (t.kind === 'SCENE_VIDEO') await this.onWindow(x, t);
      else if (t.kind === 'LIPSYNC_VIDEO') await this.onLipsync(x, t);
      else if (t.kind === 'TRANSCRIBE') await this.onTranscribe(x, t);
      else this.log.warn(`cena SWAP_VIDEO ${scene.id}: task ${t.kind} ignorada`);
    } catch (e) {
      const code = this.codeOf(e);
      if (code === 'PROVIDER_ERROR' && !(e instanceof SwapError)) this.log.error(`cena SWAP_VIDEO ${scene.id}: ${(e as Error).stack ?? e}`);
      await this.fail(scene.id, code);
    }
  }

  /**
   * Janela k pronta: corta no pedaço usado (frames da janela na grade do campeão; a sobra da genSec nunca entra na
   * emenda) e grava; submete a k+1 a partir do último frame do pedaço cortado ou, na última, emenda.
   */
  private async onWindow(x: Ctx, t: ProviderTask) {
    const windows = windowsOf(x.scene.windows);
    const k = t.windowIndex ?? 0;
    const w = windows[k];
    if (!w || w.status !== 'GENERATING') return; // repetido, ou de uma janela que não está no ar
    if (t.status !== 'COMPLETED' || !t.outputUrls[0]) throw new SwapError(codeFromTaskStatus(t.status, t.errorCode), `janela ${k}: ${t.status}`);
    const media = swapMedia(this.media, 'trimToFrames');
    const file = await this.storage.ingestFromUrl(t.outputUrls[0], { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', validate: 'video' });
    const last = k + 1 === windows.length;
    const dir = await mkdtemp(join(tmpdir(), 'maquina-swap-win-'));
    let nextUrl: string | null = null;
    try {
      const src = join(dir, 'gen.mp4');
      await this.storage.downloadTo(file, src);
      // (A) só o pedaço da janela; (B) a janela inteira (o corte vem do reencaixe da voz)
      const frames = x.voiceSource === 'ENGINE_VOICE' ? Math.round(w.genSec * x.m.fps) : windowFrames(windows, k, x.endFrame - x.startFrame, x.m.fps);
      const cut = join(dir, 'cut.mp4');
      await media.trimToFrames(src, frames, x.m.fps, cut);
      const cutFile = await this.storage.put(cut, { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', meta: { durationSec: r3(frames / x.m.fps) } });
      windows[k] = { ...w, status: 'READY', clipFileId: cutFile.id };
      if (!last) nextUrl = await this.lastFrameUrl(x, cut, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    await this.saveWindows(x.scene.id, windows, x.voiceSource);
    if (!last) {
      const fromFace = !nextUrl;
      if (fromFace) windows[k + 1] = { ...windows[k + 1], startImage: 'FACE' };
      const image = nextUrl ?? (await this.storage.signedUrl(await this.faceFile(x.c)));
      await this.submitWindow({ ...x, scene: { ...x.scene, windows: windows as unknown as Prisma.JsonValue } }, windows, k + 1, image);
      await this.publish(x.scene.id);
      return;
    }
    await this.join(x, windows);
  }

  /** Último frame do pedaço cortado (nosso, nunca do campeão). null = método do video ausente: a janela seguinte parte do rosto. */
  private async lastFrameUrl(x: Ctx, cutPath: string, dir: string): Promise<string | null> {
    try {
      const png = await swapMedia(this.media, 'lastFrame').lastFrame(cutPath, join(dir, 'last.png'));
      const f = await this.storage.put(png, { workspaceId: x.c.workspaceId, kind: 'FACE_IMAGE', mimeType: 'image/png' });
      return this.storage.signedUrl(f);
    } catch (e) {
      if (!(e instanceof SwapPortMissing)) throw e;
      // §13.15.8 "corta se apertar": todas as janelas do rosto (salto visível entre janelas)
      this.log.warn(`cena ${x.scene.id}: ${e.message}; janela seguinte parte do rosto`);
      return null;
    }
  }

  /** Emenda os pedaços e confere o nº exato de frames do trecho (clipe cru, sem som); (A) submete o lipsync v2v. */
  private async join(x: Ctx, windows: StoredWindow[]) {
    const media = swapMedia(this.media, 'concatClips', 'trimToFrames');
    const frames = x.endFrame - x.startFrame;
    const dir = await mkdtemp(join(tmpdir(), 'maquina-swap-join-'));
    try {
      const files = await this.prisma.file.findMany({ where: { id: { in: windows.map((w) => w.clipFileId!).filter(Boolean) } } });
      const byId = new Map(files.map((f) => [f.id, f]));
      const paths: string[] = [];
      for (const w of windows) {
        const f = byId.get(w.clipFileId ?? '');
        if (!f) throw new Error(`janela ${w.index} sem clipe`);
        const p = join(dir, `w${w.index}.mp4`);
        await this.storage.downloadTo(f, p);
        paths.push(p);
      }
      const joined = join(dir, 'joined.mp4');
      await media.concatClips(paths, joined);
      if (x.voiceSource === 'ENGINE_VOICE') {
        // (B): clipe cru = janelas emendadas com a voz do motor; a transcrição diz onde a fala caiu
        const d = await media.concatClips(paths, joined).then((r) => r.durationSec).catch(() => null);
        const rawFile = await this.storage.put(joined, { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', ...(d && { meta: { durationSec: r3(d) } }) });
        await this.prisma.scene.update({ where: { id: x.scene.id }, data: { rawClipFileId: rawFile.id, progress: 70 } });
        await this.gen.submitTranscribe({ workspaceId: x.c.workspaceId, sceneId: x.scene.id, mediaUrl: await this.storage.signedUrl(rawFile), language: x.c.language });
        await this.publish(x.scene.id);
        return;
      }
      const raw = join(dir, 'raw.mp4');
      await media.trimToFrames(joined, frames, x.m.fps, raw);
      const rawFile = await this.storage.put(raw, { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', meta: { durationSec: r3(frames / x.m.fps) } });
      await this.prisma.scene.update({ where: { id: x.scene.id }, data: { rawClipFileId: rawFile.id, progress: 65 } });
      await this.publish(x.scene.id);
      const audio = await this.championSlice(x, dir);
      await this.prisma.scene.update({ where: { id: x.scene.id }, data: { audioFileId: audio.id, progress: 70 } });
      await swapGen(this.gen, 'submitLipsyncVideo').submitLipsyncVideo({
        workspaceId: x.c.workspaceId, sceneId: x.scene.id, videoUrl: await this.storage.signedUrl(rawFile), audioUrl: await this.storage.signedUrl(audio),
        seed: windows[0]?.seed,
      });
      await this.publish(x.scene.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Fatia do áudio do campeão em [startFrame/fps, endFrame/fps) (o mesmo arquivo que o Pruna recebe hoje). */
  private async championSlice(x: Ctx, dir: string) {
    if (!x.c.championId) throw new Error('SWAP_VIDEO sem campeão');
    const ch = await this.prisma.champion.findUnique({ where: { id: x.c.championId }, include: { audioFile: true } });
    if (!ch?.audioFile) throw new Error('campeão sem áudio extraído');
    const src = join(dir, 'champion.m4a');
    await this.storage.downloadTo(ch.audioFile, src);
    const a = x.startFrame / x.m.fps;
    const b = x.endFrame / x.m.fps;
    const [out] = await this.media.sliceAudio(src, [{ startSec: a, endSec: b }], dir);
    return this.storage.put(out, {
      workspaceId: x.c.workspaceId, kind: 'SCENE_AUDIO', mimeType: /\.wav$/i.test(out) ? 'audio/wav' : 'audio/mp4', meta: { durationSec: r3(b - a) },
    });
  }

  /** (A) lipsync v2v pronto: grava o clipe (etapa checking), confere a identidade e fecha a cena. */
  /**
   * (B) transcrição do clipe cru pronta: reencaixe (fitEngineVoice) → corte + timeStretch até o nº exato de frames do
   * trecho → palavras × fator → checagem (fala casada ≥ 85 % e identidade). Fora da faixa = VOICE_FIT_OUT_OF_RANGE.
   */
  private async onTranscribe(x: Ctx, t: ProviderTask) {
    if (x.voiceSource !== 'ENGINE_VOICE' || !x.scene.rawClipFileId || x.scene.fit || x.scene.clipFileId) return; // fora de ordem/repetido
    if (t.status !== 'COMPLETED') throw new SwapError(codeFromTaskStatus(t.status, t.errorCode), `transcrição: ${t.status}`);
    const raw = await this.prisma.file.findUniqueOrThrow({ where: { id: x.scene.rawClipFileId } });
    const spanFrames = x.endFrame - x.startFrame;
    const spanSec = spanFrames / x.m.fps;
    const media = swapMedia(this.media, 'trimToFrames', 'timeStretch', 'concatClips');
    const dir = await mkdtemp(join(tmpdir(), 'maquina-swap-fit-'));
    try {
      let src = join(dir, 'raw.mp4');
      await this.storage.downloadTo(raw, src);
      let heard = (await this.gen.parseTranscript(t.id)).words;
      let clipSec = (await this.media.probe(src)).durationSec;
      const windows = windowsOf(x.scene.windows);
      if (windows.length > 1) {
        // a sobra da genSec no fim de cada janela sai antes do reencaixe (senão vira pausa no meio do trecho)
        const c = compactWindows(heard, windows.map((w) => w.genSec));
        const parts = await this.media.cutVideo(src, c.segments, join(dir, 'pedacos'));
        src = join(dir, 'compacto.mp4');
        clipSec = (await media.concatClips(parts, src)).durationSec;
        heard = c.words;
      }
      const fit = swapCatalog(this.catalog, 'fitEngineVoice').fitEngineVoice({ sourceWords: x.copy, sourceSec: spanSec, clipWords: heard, clipSec });
      if ('error' in fit) throw new SwapError('VOICE_FIT_OUT_OF_RANGE', `ratio ${fit.ratio} (fonte ${fit.sourceSec} s, voz ${fit.voiceSec} s)`);
      const [cut] = await this.media.cutVideo(src, [{ startSec: fit.cutStartSec, endSec: fit.cutEndSec }], join(dir, 'corte'));
      const factor = spanSec / (fit.cutEndSec - fit.cutStartSec);
      let fitted = cut;
      if (fit.mode === 'STRETCH') {
        fitted = join(dir, 'esticado.mp4');
        await media.timeStretch(cut, factor, fitted);
      }
      const out = join(dir, 'clip.mp4');
      await media.trimToFrames(fitted, spanFrames, x.m.fps, out);
      const words = fittedWords(heard, fit.cutStartSec, factor, spanSec);
      const clip = await this.storage.put(out, { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', meta: { durationSec: r3(spanSec) } });
      const voice = await this.media.extractAudio(out, join(dir, 'voz.m4a'));
      const audio = await this.storage.put(join(dir, 'voz.m4a'), { workspaceId: x.c.workspaceId, kind: 'SCENE_AUDIO', mimeType: 'audio/mp4', meta: { durationSec: r3(voice.durationSec) } });
      const [thumb] = await this.media.keyframes(out, [spanSec / 2], dir, 720);
      const thumbnail = thumb ? await this.storage.put(thumb.path, { workspaceId: x.c.workspaceId, kind: 'THUMBNAIL', mimeType: 'image/jpeg' }) : null;
      await this.prisma.scene.update({
        where: { id: x.scene.id },
        data: {
          fit: fit as unknown as Prisma.InputJsonValue, words: words as unknown as Prisma.InputJsonValue, clipFileId: clip.id, audioFileId: audio.id,
          ...(thumbnail && { thumbnailFileId: thumbnail.id }), progress: 90,
        },
      });
      await this.publish(x.scene.id);
      const match = speechMatch(x.copy.map((w) => w.word), heard.map((w) => w.word));
      if (match < SPEECH_MATCH_MIN) throw new SwapError('SPEECH_MISMATCH', `fala casada ${Math.round(match * 100)} %`);
      await this.close(x, clip);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Checagem final (identidade) e READY | FAILED IDENTITY_DRIFT. */
  private async close(x: Ctx, clip: { storageKey: string }) {
    const score = await this.identity(x, clip);
    const ok = !score || identityOk(score);
    const r = await this.prisma.scene.updateMany({
      where: { id: x.scene.id, status: { in: [...PENDING] } },
      data: ok
        ? { status: 'READY', progress: 100, readyAt: new Date(), failReason: null, errorCode: null, identityScore: score ? r3(score.median) : null }
        : { status: 'FAILED', errorCode: 'IDENTITY_DRIFT', failReason: failReasonFor('IDENTITY_DRIFT'), identityScore: r3(score!.median) },
    });
    if (r.count) await this.publish(x.scene.id);
  }

  private async onLipsync(x: Ctx, t: ProviderTask) {
    if (!x.scene.rawClipFileId || x.scene.clipFileId) return; // fora de ordem ou repetido
    if (t.status !== 'COMPLETED' || !t.outputUrls[0]) throw new SwapError(codeFromTaskStatus(t.status, t.errorCode), `lipsync v2v: ${t.status}`);
    const out = await this.storage.ingestVideoWithThumbnail(t.outputUrls[0], { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP' });
    // o sync/lipsync-2 devolve 1 frame a menos (123 → 122, ia 08/10): repõe até o nº exato de frames do trecho
    const file = await this.exactFrames(x, out.file);
    await this.prisma.scene.update({ where: { id: x.scene.id }, data: { clipFileId: file.id, thumbnailFileId: out.thumbnail.id, progress: 90 } });
    await this.publish(x.scene.id);
    await this.close(x, file);
  }

  /** Clipe com exatamente endFrame − startFrame frames (trimToFrames repete o último quando falta). */
  private async exactFrames(x: Ctx, f: { id: string; storageKey: string }) {
    const frames = x.endFrame - x.startFrame;
    const dir = await mkdtemp(join(tmpdir(), 'maquina-swap-exact-'));
    try {
      const src = join(dir, 'lip.mp4');
      const out = join(dir, 'exact.mp4');
      await this.storage.downloadTo(f, src);
      await swapMedia(this.media, 'trimToFrames').trimToFrames(src, frames, x.m.fps, out);
      return await this.storage.put(out, { workspaceId: x.c.workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', meta: { durationSec: r3(frames / x.m.fps) } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * SFace do clipe contra o rosto escolhido (2 amostras/s). null = não deu pra medir (método do video ainda não entregue
   * ou erro da medição): a cena segue e a conferência fica com o QA (§13.15.8, "corta se apertar").
   * Mock: gatilho `[mock:identity-drift]` nas notas do campeão força a deriva.
   */
  private async identity(x: Ctx, clip: { storageKey: string }): Promise<{ median: number; min: number } | null> {
    if (integracoesMode() === 'mock' && x.c.championId) {
      const ch = await this.prisma.champion.findUnique({ where: { id: x.c.championId }, select: { notes: true } });
      if (ch?.notes?.includes('[mock:identity-drift]')) return { median: 0.12, min: 0.05 };
    }
    const dir = await mkdtemp(join(tmpdir(), 'maquina-swap-id-'));
    try {
      const media = swapMedia(this.media, 'identityScore');
      const v = join(dir, 'clip.mp4');
      const f = join(dir, 'face.png');
      await this.storage.downloadTo(clip, v);
      await this.storage.downloadTo(await this.faceFile(x.c), f);
      return await media.identityScore(v, f, 2);
    } catch (e) {
      this.log.warn(`cena ${x.scene.id}: identidade não medida (${(e as Error).message})`);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // ───────── estado ─────────

  private async saveWindows(sceneId: string, windows: StoredWindow[], voiceSource: SwapVoiceSource) {
    const s = await this.prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
    const progress = swapProgress({ status: s.status, windows, rawClipFileId: s.rawClipFileId, clipFileId: s.clipFileId, voiceSource, fit: s.fit });
    await this.prisma.scene.update({ where: { id: sceneId }, data: { windows: windows as unknown as Prisma.InputJsonValue, status: 'GENERATING', progress } });
  }

  /** Cena FAILED com motivo (janelas pendentes param onde estão). */
  async fail(sceneId: string, code: string) {
    const ac = asAsyncErrorCode(code);
    const r = await this.prisma.scene.updateMany({ where: { id: sceneId, status: { in: [...PENDING] } }, data: { status: 'FAILED', errorCode: ac, failReason: failReasonFor(ac) } });
    if (r.count) await this.publish(sceneId);
  }

  private codeOf(e: unknown): string {
    if (e instanceof SwapError) return e.code;
    if (e instanceof IngestError) return 'DOWNLOAD_INVALID';
    if (isIntegracaoError(e)) return e.code;
    return 'PROVIDER_ERROR';
  }

  /** Campos da cena zerados pra uma nova tentativa ("Refazer trecho"): janelas replanejadas no submitFirstStep. */
  static resetData(): Prisma.SceneUncheckedUpdateManyInput {
    return { windows: Prisma.DbNull, rawClipFileId: null, fit: Prisma.DbNull, identityScore: null };
  }

  /** scene.updated (+ resumo) pro SSE do criativo. */
  async publish(sceneId: string) {
    const s = await this.prisma.scene.findUnique({ where: { id: sceneId } });
    if (!s || !this.eventos.listenerCount(s.creativeId)) return;
    const summary = scenesSummary(await currentScenes(this.prisma, s.creativeId));
    this.eventos.publish(s.creativeId, 'scene.updated', { ...(await this.views.scene(s)), summary });
  }

  /** "Refazer trecho (US$ x)" de uma cena. */
  async regenerateEstimate(c: Creative, s: Pick<SceneRow, 'startFrame' | 'endFrame' | 'words'>): Promise<{ costUsd: number; etaSec: number }> {
    const engine = engineOfModel(c.engineModel);
    const m = await this.editMapFor(c);
    if (!engine || !m || s.startFrame == null || s.endFrame == null) return { costUsd: 0, etaSec: 0 };
    return swapSceneEstimate(this.catalog, engine, c.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO', m, {
      startFrame: s.startFrame, endFrame: s.endFrame, words: wordsOf(s.words),
    });
  }
}

/** Frames da janela k na grade do campeão: fronteiras arredondadas, a última fecha no fim do trecho (soma = trecho). */
export function windowFrames(windows: Pick<StoredWindow, 'startSec' | 'endSec'>[], k: number, spanFrames: number, fps: number): number {
  const at = (i: number) => (i >= windows.length ? spanFrames : Math.min(spanFrames, Math.round(windows[i].startSec * fps)));
  return Math.max(1, at(k + 1) - at(k));
}

function wordsOf(json: Prisma.JsonValue | null): TranscriptWord[] {
  return Array.isArray(json) ? (json as unknown as TranscriptWord[]) : [];
}
