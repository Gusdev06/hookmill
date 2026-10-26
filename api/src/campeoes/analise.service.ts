import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { AdLibraryMeta, AsyncErrorCode, EditLayer, Measurements, Rect, TranscriptWord } from '@maquina/contratos';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Prisma, type Champion, type File as FileRow } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { asAsyncErrorCode, codeFromTaskStatus, failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import {
  CLAUDE_SERVICE, GENERATION_SERVICE, PROVIDER_TASK_FINISHED, integracoesMode, type ClaudeService, type GenerationService, type ProviderTaskFinishedEvent,
} from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChampionStateMachine } from './champion-state-machine';
import { type StoredMeasurements, type StoredTranscript, measurementsOf, sectionsOf, transcriptOf, wpmOf } from './champion-views';
import { type EditMapParts, buildEditMap, clampRect, pickMainSpeaker } from './mapa-edicao';
import { comFaixasProtegidas } from './faixas-protegidas';
import { KEYFRAME_MAX_SIDE, MAX_KEYFRAMES, MIN_SPEECH_WORDS } from './limites';
import { AD_LIBRARY, MEDIA_ANALYSIS, MediaInvalidError, errorCodeOf, hasCaptionBox, type AdLibraryService, type MediaAnalysisService } from './portas';

/** Falha da análise com código do contrato (vira errorCode no campeão e no job). */
export class AnalysisError extends Error {
  constructor(readonly code: AsyncErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AnalysisError';
  }
}

const STAGE_PROGRESS = { reading_video: 5, extracting_audio: 15, transcribing: 30, measuring: 50, mapping_edit: 62, diagnosing: 75, fetching_ad: 10, downloading_video: 50 } as const;
/** Espera máxima pelo TRANSCRIBE do campeão (webhook/reconciliador). Depois disso: PROVIDER_TIMEOUT. */
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;
/** Com upload + link, os metadados não seguram a análise: no máximo isso antes do Claude. */
const ADMETA_WAIT_MS = 30_000;
const AD_ERROR_CODES = ['AD_LIBRARY_UNAVAILABLE', 'AD_NOT_FOUND', 'AD_HAS_NO_VIDEO'] as const;

/** Timer que não segura o processo (testes e shutdown). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Instantes dos frames-chave: t0, cada corte, fim; completa com instantes regulares até MAX_KEYFRAMES. */
export function keyframeTimes(durationSec: number, cuts: { atSec: number }[]): { atSec: number; reason: Measurements['keyframes'][number]['reason'] }[] {
  const end = Math.max(0, durationSec - 0.1);
  const out: { atSec: number; reason: Measurements['keyframes'][number]['reason'] }[] = [{ atSec: 0, reason: 't0' }];
  for (const c of cuts) if (c.atSec > 0.2 && c.atSec < end - 0.2) out.push({ atSec: r3(c.atSec), reason: 'cut' });
  out.push({ atSec: r3(end), reason: 'end' });
  const kept = out.slice(0, MAX_KEYFRAMES - 1).concat(out.length > MAX_KEYFRAMES - 1 ? [out[out.length - 1]] : []);
  const unique = [...new Map(kept.map((k) => [k.atSec, k])).values()];
  // preenche com frames regulares ("block": o Claude ainda não dividiu os blocos), sem passar de 16
  const room = MAX_KEYFRAMES - unique.length;
  const fill = Math.min(room, Math.max(0, Math.floor(durationSec / 3) - unique.length));
  for (let i = 1; i <= fill; i++) {
    const at = r3((end * i) / (fill + 1));
    if (!unique.some((k) => Math.abs(k.atSec - at) < 0.5)) unique.push({ atSec: at, reason: 'block' });
  }
  return unique.sort((a, b) => a.atSec - b.atSec);
}

/**
 * Jobs do campeão (feature-2 §3.1, §4.2):
 *  CHAMPION_RESOLVE: fetching_ad → downloading_video (link → metadados + vídeo; depois abre a análise);
 *  CHAMPION_ANALYZE: reading_video (decodifica inteiro) → extracting_audio → transcribing → measuring → diagnosing.
 * Na nova tentativa, transcrição e medições já prontas são reaproveitadas.
 */
@Injectable()
export class AnaliseService {
  private readonly log = new Logger('Campeoes');
  private readonly waiters = new Map<string, (e: ProviderTaskFinishedEvent) => void>();
  /** Última recusa AD_LIBRARY_UNAVAILABLE por campeão (o POST /champions síncrono devolve reason/retryAfter). */
  private readonly adRefusals = new Map<string, AdRefusal>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly sm: ChampionStateMachine,
    private readonly config: AppConfig,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(AD_LIBRARY) private readonly adlib: AdLibraryService,
    @Inject(MEDIA_ANALYSIS) private readonly media: MediaAnalysisService,
  ) {}

  // ───────── espera do TRANSCRIBE do campeão ─────────

  @OnEvent(PROVIDER_TASK_FINISHED)
  onTaskFinished(e: ProviderTaskFinishedEvent) {
    const w = this.waiters.get(e.providerTaskId);
    if (w) w(e);
  }

  private async waitTask(providerTaskId: string): Promise<{ status: string; errorCode: string | null }> {
    const done = new Promise<{ status: string; errorCode: string | null }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(providerTaskId);
        reject(new AnalysisError('PROVIDER_TIMEOUT'));
      }, TRANSCRIBE_TIMEOUT_MS);
      timer.unref();
      this.waiters.set(providerTaskId, (e) => {
        clearTimeout(timer);
        this.waiters.delete(providerTaskId);
        resolve({ status: e.status, errorCode: e.errorCode });
      });
    });
    // terminou antes de a espera existir (mock rápido, reconciliador)
    const t = await this.prisma.providerTask.findUnique({ where: { id: providerTaskId }, select: { status: true, errorCode: true } });
    if (t && t.status !== 'SUBMITTED') {
      this.waiters.get(providerTaskId)?.({ providerTaskId, status: t.status, errorCode: t.errorCode } as ProviderTaskFinishedEvent);
    }
    return done;
  }

  // ───────── CHAMPION_RESOLVE ─────────

  /** Link → metadados → baixa o vídeo → RESOLVED (ANALYZING) e abre o job de análise. Nunca lança. */
  async runResolve(jobId: string, championId: string, createdById: string): Promise<void> {
    try {
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId } });
      await this.jobs.stage(jobId, 'fetching_ad', STAGE_PROGRESS.fetching_ad);
      const r = await this.resolveMeta(c, jobId);
      if (!r.ok) throw new AnalysisError(r.code);
      if (!r.videoUrl) throw new AnalysisError('AD_HAS_NO_VIDEO');
      await this.jobs.stage(jobId, 'downloading_video', STAGE_PROGRESS.downloading_video);
      let file: FileRow;
      try {
        file = await this.storage.ingestFromUrl(r.videoUrl, { workspaceId: c.workspaceId, kind: 'CHAMPION_VIDEO', validate: 'video' });
      } catch (e) {
        throw new AnalysisError(e instanceof IngestError ? 'MEDIA_INVALID' : 'PROVIDER_ERROR');
      }
      const d = num(file.durationSec) ?? 0;
      if (d < this.config.championMinSec || d > this.config.championMaxSec || Math.min(file.width ?? 0, file.height ?? 0) < 240) {
        throw new AnalysisError('MEDIA_INVALID', `duração ${d}s fora do limite ou vídeo pequeno`);
      }
      const analyze = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, championId, event: 'RESOLVED', from: 'RESOLVING', to: 'ANALYZING', data: { videoFileId: file.id, durationSec: d, errorCode: null, failReason: null } });
        return tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId }, championId, offerId: c.offerId, createdById } });
      });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { videoFileId: file.id } });
      void this.jobs.detach(analyze.id, 'análise do campeão', () => this.runAnalyze(analyze.id, championId));
    } catch (e) {
      const code = e instanceof AnalysisError ? e.code : 'PROVIDER_ERROR';
      if (!(e instanceof AnalysisError)) this.log.error(`resolve ${championId}: ${(e as Error).stack ?? e}`);
      await this.sm
        .transition({ championId, event: 'RESOLVE_FAILED', from: 'RESOLVING', to: 'FAILED', data: { errorCode: code, failReason: failReasonFor(code) } })
        .catch(() => undefined);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: failReasonFor(code) }).catch(() => undefined);
    }
  }

  /** Chama a Ad Library e grava adMeta (resolvido ou com o motivo da falha). */
  private async resolveMeta(c: Champion, jobId: string): Promise<{ ok: true; videoUrl: string | null } | { ok: false; code: AsyncErrorCode }> {
    const url = c.adLibraryUrl!;
    try {
      const r = await this.adlib.resolve({ workspaceId: c.workspaceId, championId: c.id, jobId, url });
      const meta: AdLibraryMeta = {
        status: 'resolved', adArchiveId: r.adArchiveId, pageName: r.pageName, startDate: r.startDate, endDate: r.endDate, isActive: r.isActive,
        daysRunning: r.daysRunning, collationCount: r.collationCount, euReach: r.euReach, primaryText: r.primaryText, headline: r.headline,
        ctaText: r.ctaText, linkUrl: r.linkUrl, fetchedAt: new Date().toISOString(),
      };
      await this.prisma.champion.update({ where: { id: c.id }, data: { adMeta: meta as unknown as Prisma.InputJsonValue, adArchiveId: r.adArchiveId ?? c.adArchiveId } });
      return { ok: true, videoUrl: r.videoUrl };
    } catch (e) {
      const raw = errorCodeOf(e);
      const code: AsyncErrorCode = (AD_ERROR_CODES as readonly string[]).includes(raw ?? '') ? (raw as AsyncErrorCode) : 'AD_LIBRARY_UNAVAILABLE';
      const status: AdLibraryMeta['status'] = code === 'AD_NOT_FOUND' ? 'not_found' : code === 'AD_HAS_NO_VIDEO' ? 'no_video' : 'unavailable';
      const meta: AdLibraryMeta = {
        status, adArchiveId: c.adArchiveId, pageName: null, startDate: null, endDate: null, isActive: null, daysRunning: null, collationCount: null,
        euReach: null, primaryText: null, headline: null, ctaText: null, linkUrl: null, fetchedAt: null,
      };
      await this.prisma.champion.update({ where: { id: c.id }, data: { adMeta: meta as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
      if (code === 'AD_LIBRARY_UNAVAILABLE') this.adRefusals.set(c.id, adRefusalOf(e, raw));
      this.log.warn(`ad library ${c.id}: ${raw ?? (e as Error).message}`);
      return { ok: false, code };
    }
  }

  takeAdRefusal(championId: string): AdRefusal | null {
    const r = this.adRefusals.get(championId) ?? null;
    this.adRefusals.delete(championId);
    return r;
  }

  // ───────── CHAMPION_ANALYZE ─────────

  /** Pipeline completo da análise. Nunca lança: falha vira campeão FAILED + job FAILED. */
  async runAnalyze(jobId: string, championId: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'maquina-champion-'));
    try {
      let c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId }, include: { videoFile: true, audioFile: true, offer: true, createdBy: { select: { uiLocale: true } } } });
      if (!c.videoFile) throw new AnalysisError('MEDIA_INVALID', 'campeão sem vídeo');
      // upload + link: os metadados vêm em paralelo, sem segurar a análise
      const metaP = c.adLibraryUrl && (c.adMeta as { status?: string } | null)?.status !== 'resolved' ? this.resolveMeta(c, jobId).catch(() => null) : null;

      // 1. reading_video: decodifica o arquivo inteiro (regra do download truncado)
      await this.jobs.stage(jobId, 'reading_video', STAGE_PROGRESS.reading_video);
      const videoPath = join(dir, `video${extname(c.videoFile.storageKey) || '.mp4'}`);
      await this.storage.downloadTo(c.videoFile, videoPath);
      try {
        await this.media.validateFull(videoPath);
      } catch (e) {
        if (e instanceof MediaInvalidError || errorCodeOf(e) === 'MEDIA_INVALID') throw new AnalysisError('MEDIA_INVALID', (e as Error).message);
        throw e;
      }
      const probe = await this.media.probe(videoPath);
      await this.prisma.champion.update({ where: { id: c.id }, data: { durationSec: r3(probe.durationSec) } });

      // 2. extracting_audio
      await this.jobs.stage(jobId, 'extracting_audio', STAGE_PROGRESS.extracting_audio);
      let audioPath: string | null = null;
      let audioFile = c.audioFile;
      if (probe.hasAudio) {
        audioPath = join(dir, 'audio.m4a');
        if (audioFile) {
          await this.storage.downloadTo(audioFile, audioPath);
        } else {
          const a = await this.media.extractAudio(videoPath, audioPath);
          audioFile = await this.storage.put(audioPath, { workspaceId: c.workspaceId, kind: 'CHAMPION_AUDIO', mimeType: 'audio/mp4', meta: { durationSec: a.durationSec } });
          await this.prisma.champion.update({ where: { id: c.id }, data: { audioFileId: audioFile.id } });
        }
      }
      const teardown = await this.prisma.teardown.upsert({
        where: { championId: c.id }, update: {}, create: { workspaceId: c.workspaceId, championId: c.id },
      });

      // 3. transcribing (reaproveita a transcrição pronta, inclusive palavras corrigidas pelo usuário)
      await this.jobs.stage(jobId, 'transcribing', STAGE_PROGRESS.transcribing);
      let transcript = transcriptOf(teardown.transcript);
      if (!transcript) {
        if (audioFile) {
          const sub = await this.gen.submitTranscribe({ workspaceId: c.workspaceId, championId: c.id, mediaUrl: await this.storage.signedUrl(audioFile) });
          const fin = await this.waitTask(sub.providerTaskId);
          if (fin.status !== 'COMPLETED') throw new AnalysisError(codeFromTaskStatus(fin.status, fin.errorCode));
          const tr = await this.gen.parseTranscript(sub.providerTaskId);
          transcript = storedTranscript(tr.language || c.offer.language, tr.words, 'whisper');
        } else {
          transcript = storedTranscript(c.offer.language, [], 'none');
        }
        await this.prisma.teardown.update({ where: { id: teardown.id }, data: { transcript: transcript as unknown as Prisma.InputJsonValue } });
      }

      // 4. measuring (reaproveita as medições prontas)
      await this.jobs.stage(jobId, 'measuring', STAGE_PROGRESS.measuring);
      let measurements = measurementsOf(teardown.measurements);
      if (!measurements) measurements = await this.measure(c, videoPath, audioPath, probe, dir);
      await this.prisma.teardown.update({ where: { id: teardown.id }, data: { measurements: measurements as unknown as Prisma.InputJsonValue } });
      const t0 = measurements.keyframes.find((k) => k.reason === 't0') ?? measurements.keyframes[0];
      if (t0) await this.prisma.champion.update({ where: { id: c.id }, data: { thumbnailFileId: t0.fileId } });

      // 5. mapping_edit (§13.1-13.2): trilha do rosto (medicao) + camadas de texto e perfil (visão). Falhar aqui não
      // derruba a análise: o campeão fica sem mapa (keepEdit 'not_mapped') e o resto segue.
      await this.jobs.stage(jobId, 'mapping_edit', STAGE_PROGRESS.mapping_edit);
      const parts = await this.mapEdit(c, jobId, videoPath, measurements, transcript, dir).catch((e) => {
        this.log.warn(`mapa da edição do campeão ${c.id} falhou: ${(e as Error).message}`);
        return null;
      });

      // 6. diagnosing (Claude)
      await this.jobs.stage(jobId, 'diagnosing', STAGE_PROGRESS.diagnosing);
      if (metaP) await Promise.race([metaP, sleep(ADMETA_WAIT_MS)]);
      c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId }, include: { videoFile: true, audioFile: true, offer: true, createdBy: { select: { uiLocale: true } } } });
      const frames = await this.prisma.file.findMany({ where: { id: { in: measurements.keyframes.map((k) => k.fileId) } } });
      const byId = new Map(frames.map((f) => [f.id, f]));
      const keyframes: { atSec: number; reason: string; url: string }[] = [];
      for (const k of measurements.keyframes) {
        const f = byId.get(k.fileId);
        if (f) keyframes.push({ atSec: k.atSec, reason: k.reason, url: await this.storage.signedUrl(f) });
      }
      const { keyframes: _k, ...plain } = measurements;
      const adMeta = (c.adMeta as unknown as AdLibraryMeta | null) ?? null;
      const draft = await this.claude.analyzeChampion(
        {
          workspaceId: c.workspaceId, championId: c.id, jobId, uiLocale: c.createdBy.uiLocale, offer: offerForAnalysis(c),
          transcript: { language: transcript.language, words: transcript.words }, measurements: plain, keyframes,
          adMeta: adMeta?.status === 'resolved' ? adMeta : null,
        },
        () => undefined,
      );
      const hasSpeech = transcript.words.length >= MIN_SPEECH_WORDS;
      await this.prisma.$transaction(async (tx) => {
        await tx.teardown.update({
          where: { id: teardown.id },
          data: {
            sections: draft.sections as unknown as Prisma.InputJsonValue, editedSections: [], model: this.config.optional('ANTHROPIC_MODEL') ?? null, analyzedAt: new Date(),
            // o bloqueio do gancho precisa do fim do gancho (seção hook), por isso o mapa fecha aqui
            // legenda-protegida-v1 §1: a faixa protegida (legenda queimada, px do arquivo) fica gravada no mapa
            editMap: parts ? (comFaixasProtegidas(buildEditMap({ ...parts, hookEndSec: hookEndOfSections(draft.sections, measurements.durationSec) }), probe) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          },
        });
        await this.sm.transition({
          tx, championId, event: 'ANALYSIS_DONE', from: 'ANALYZING', to: 'READY',
          data: { language: draft.language || transcript!.language, hasSpeech, errorCode: null, failReason: null },
        });
      });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { teardownId: teardown.id } });
    } catch (e) {
      const code: AsyncErrorCode = e instanceof AnalysisError ? e.code : asAsyncErrorCode(errorCodeOf(e));
      if (!(e instanceof AnalysisError)) this.log.error(`análise ${championId}: ${(e as Error).stack ?? e}`);
      await this.failAnalysis(championId, jobId, code);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async failAnalysis(championId: string, jobId: string | null, code: AsyncErrorCode) {
    await this.sm
      .transition({ championId, event: 'ANALYSIS_FAILED', from: 'ANALYZING', to: 'FAILED', data: { errorCode: code, failReason: failReasonFor(code) } })
      .catch(() => undefined);
    if (jobId) await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: failReasonFor(code) }).catch(() => undefined);
  }

  /**
   * Partes do EditMap (sem o fim do gancho): trilha do rosto + describeEdit com frames-chave e recortes das faixas.
   * Gatilhos de QA (só em mock, nas notes do campeão): `[mock:not-mapped]` = sem mapa; `[mock:keep-two-faces]` = 2 rostos
   * no 1º trecho da trilha.
   */
  private async mapEdit(
    c: Champion, jobId: string, videoPath: string, m: StoredMeasurements, transcript: StoredTranscript, dir: string,
  ): Promise<Omit<EditMapParts, 'hookEndSec'> | null> {
    const mock = integracoesMode() === 'mock';
    if (mock && c.notes?.includes('[mock:not-mapped]')) return null;
    const ft = await this.media.faceTrack(videoPath);
    const trackBlockers = [...ft.blockers];
    if (mock && c.notes?.includes('[mock:keep-two-faces]')) {
      const seg = ft.segments[0];
      trackBlockers.push({ reason: 'multiple_faces', startSec: seg ? r3(seg.startFrame / ft.fps) : 0, endSec: seg ? r3(seg.endFrame / ft.fps) : r3(m.durationSec) });
    }
    const frames = await this.prisma.file.findMany({ where: { id: { in: m.keyframes.map((k) => k.fileId) } } });
    const byId = new Map(frames.map((f) => [f.id, f]));
    const keyframes: { atSec: number; reason: string; url: string }[] = [];
    for (const k of m.keyframes) {
      const f = byId.get(k.fileId);
      if (f) keyframes.push({ atSec: k.atSec, reason: k.reason, url: await this.storage.signedUrl(f) });
    }
    const textCrops = await this.textCrops(c, videoPath, m, dir);
    const draft = await this.claude.describeEdit({
      workspaceId: c.workspaceId, championId: c.id, jobId,
      video: { width: ft.width, height: ft.height, fps: ft.fps, frameCount: ft.frameCount, durationSec: m.durationSec },
      keyframes, textCrops, faceTrack: ft.segments,
      transcript: { language: transcript.language, words: transcript.words }, notes: c.notes,
    });
    const layers = await this.refineLayers(videoPath, draft.layers, ft.fps, ft.frameCount, transcript.words);
    return {
      width: ft.width, height: ft.height, fps: ft.fps, frameCount: ft.frameCount, cells: ft.cells,
      // avatar principal = quem fala (dica da visão); rostos de b-roll/tela não entram na trilha
      faceTrack: pickMainSpeaker(ft.segments, draft.mainSpeaker), trackBlockers,
      mainSpeaker: draft.mainSpeaker ?? null, otherFaces: draft.otherFaces ?? [],
      layers, overlaysOverFace: draft.overlaysOverFace, profile: draft.profile,
    };
  }

  /**
   * §13.2 refino por pixel (medicao): camada com fundo (solid/pill) ganha a faixa medida (caixa e cor) e o texto é
   * preso dentro dela; o intervalo vem da presença do recorte no vídeo (frames). Legenda (karaokê) fica com a visão +
   * tempos da transcrição. Falhou a medição de uma camada = fica a da visão.
   */
  private async refineLayers(videoPath: string, layers: EditLayer[], fps: number, frameCount: number, words: TranscriptWord[] = []): Promise<EditLayer[]> {
    const out: EditLayer[] = [];
    for (const l of layers) {
      if (l.kind === 'caption' && l.background.kind === 'none') {
        out.push(await this.refineCaptionBox(videoPath, l, fps, words));
        continue;
      }
      if (l.kind === 'caption' || l.background.kind === 'none') {
        out.push(l);
        continue;
      }
      try {
        const at = r3((l.startFrame + l.endFrame) / 2 / fps);
        const sb = await this.media.solidBackground(videoPath, at, l.box);
        let next: EditLayer = l;
        if (sb) next = { ...l, box: clampRect(l.box, sb.box), background: { ...l.background, color: sb.color, box: sb.box }, source: 'vision+pixel' };
        const pr = await this.media.layerPresence(videoPath, next.background.box ?? next.box, at);
        if (pr.endFrame > pr.startFrame) next = { ...next, startFrame: Math.max(0, pr.startFrame), endFrame: Math.min(frameCount, pr.endFrame), source: 'vision+pixel' };
        out.push(next);
      } catch (e) {
        this.log.warn(`refino da camada ${l.id} falhou: ${(e as Error).message}`);
        out.push(l);
      }
    }
    return out;
  }

  /**
   * (c) 08/10: legenda sem fundo = caixa medida por pixel nos instantes das palavras do intervalo dela (medicao.captionBox,
   * proposta ao video). Sem o método, sem palavra ou sem achado = a caixa da visão.
   */
  private async refineCaptionBox(videoPath: string, l: EditLayer, fps: number, words: TranscriptWord[]): Promise<EditLayer> {
    if (!hasCaptionBox(this.media)) return l;
    const at = words
      .map((w) => r3((w.startSec + w.endSec) / 2))
      .filter((t) => t * fps >= l.startFrame && t * fps < l.endFrame);
    if (!at.length) return l;
    try {
      const box = await this.media.captionBox(videoPath, at.filter((_, i) => i % Math.max(1, Math.ceil(at.length / 24)) === 0), l.box);
      return box ? { ...l, box, source: 'vision+pixel' } : l;
    } catch (e) {
      this.log.warn(`refino da legenda ${l.id} falhou: ${(e as Error).message}`);
      return l;
    }
  }

  /** Até 6 recortes em resolução cheia das faixas candidatas a texto (faixas que não são o rosto), lado maior 1024 px. */
  private async textCrops(c: Champion, videoPath: string, m: StoredMeasurements, dir: string): Promise<{ atSec: number; box: Rect; url: string }[]> {
    const cands: { atSec: number; box: Rect }[] = [];
    for (const seg of m.segments) {
      const at = r3((seg.startSec + seg.endSec) / 2);
      for (const b of seg.bands) {
        if (b.role === 'face' || b.y1 - b.y0 < 8) continue;
        cands.push({ atSec: at, box: { x: 0, y: Math.round(b.y0), w: m.width, h: Math.round(b.y1 - b.y0) } });
      }
    }
    const out: { atSec: number; box: Rect; url: string }[] = [];
    for (const [i, cd] of cands.slice(0, 6).entries()) {
      const path = join(dir, `crop-${i}.jpg`);
      try {
        await run(process.env.FFMPEG_PATH || 'ffmpeg', [
          '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', cd.atSec.toFixed(3), '-i', videoPath, '-frames:v', '1',
          '-vf', `crop=${cd.box.w}:${cd.box.h}:${cd.box.x}:${cd.box.y},scale='min(1024,iw)':-2`, '-q:v', '3', path,
        ], { timeout: 30_000 });
        const f = await this.storage.put(path, { workspaceId: c.workspaceId, kind: 'CHAMPION_FRAME', mimeType: 'image/jpeg' });
        out.push({ ...cd, url: await this.storage.signedUrl(f) });
      } catch (e) {
        this.log.warn(`recorte de faixa ${i} do campeão ${c.id} falhou: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** Medições + frames-chave (sobem como CHAMPION_FRAME). Medição é local e grátis. */
  private async measure(
    c: Champion, videoPath: string, audioPath: string | null,
    probe: { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean }, dir: string,
  ): Promise<StoredMeasurements> {
    const layout = await this.media.measureLayout(videoPath);
    const silences = audioPath ? await this.media.silences(audioPath) : [];
    const times = keyframeTimes(probe.durationSec, layout.cuts);
    const framesDir = join(dir, 'frames');
    const frames = await this.media.keyframes(videoPath, times.map((t) => t.atSec), framesDir, KEYFRAME_MAX_SIDE);
    const palette = frames.length ? await this.media.palette(frames.map((f) => f.path), 6) : [];
    const keyframes: StoredMeasurements['keyframes'] = [];
    for (const f of frames) {
      const mime = /\.png$/i.test(f.path) ? 'image/png' : 'image/jpeg';
      const file = await this.storage.put(f.path, { workspaceId: c.workspaceId, kind: 'CHAMPION_FRAME', mimeType: mime });
      const reason = times.find((t) => Math.abs(t.atSec - f.atSec) < 0.01)?.reason ?? 'block';
      keyframes.push({ atSec: f.atSec, reason, fileId: file.id });
    }
    return {
      durationSec: r3(probe.durationSec), width: probe.width, height: probe.height, fps: probe.fps, hasAudio: probe.hasAudio,
      cuts: layout.cuts, segments: layout.segments, palette, silences, keyframes,
    };
  }
}

const run = promisify(execFile);

/** Fim do gancho original (seção hook; senão ~3 s). */
function hookEndOfSections(sections: { hook?: { status: string; data: { endSec: number } | null } }, durationSec: number): number {
  const h = sections.hook;
  return h?.status === 'ok' && h.data && h.data.endSec > 0 ? h.data.endSec : Math.min(3, durationSec);
}

/** Briefing da oferta pro Claude. O gatilho de QA `[mock:analysis-fail]` mora nas notes do campeão (§4.6) e só
 *  chega ao fake da ia pelas notes da oferta: repassa o gatilho (só ele, não as notes do campeão). */
function offerForAnalysis(c: { notes: string | null; offer: Parameters<typeof draftOf>[0] }) {
  const d = draftOf(c.offer);
  const trig = '[mock:analysis-fail]';
  return c.notes?.includes(trig) ? { ...d, notes: `${d.notes ?? ''} ${trig}`.trim() } : d;
}

export interface AdRefusal { reason: 'quota' | 'not_configured' | 'provider_error'; retryAfter: string | null }

/** reason/retryAfter da recusa (IntegracaoError da ia: em `details` ou no próprio erro). */
export function adRefusalOf(e: unknown, raw: string | null): AdRefusal {
  const o = (e ?? {}) as { reason?: unknown; retryAfter?: unknown; details?: { reason?: unknown; retryAfter?: unknown } };
  const reason = o.details?.reason ?? o.reason;
  const retryAfter = o.details?.retryAfter ?? o.retryAfter;
  return {
    reason: reason === 'quota' || reason === 'not_configured' || reason === 'provider_error' ? reason : raw === 'NOT_CONFIGURED' ? 'not_configured' : 'provider_error',
    retryAfter: typeof retryAfter === 'string' ? retryAfter : null,
  };
}

export function storedTranscript(language: string, words: TranscriptWord[], source: StoredTranscript['wordsSource']): StoredTranscript {
  return { language, text: words.map((w) => w.word).join(' ').trim(), words, wpm: wpmOf(words), wordsSource: source };
}

export { sectionsOf };
