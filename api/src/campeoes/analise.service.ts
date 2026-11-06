import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { AdLibraryMeta, AsyncErrorCode, Rect, TranscriptWord } from '@maquina/contratos';
import { Prisma, type Champion, type File as FileRow } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { type EditMapParts, buildEditMap, pickMainSpeaker } from './mapa-edicao';
import { comFaixasProtegidas } from './faixas-protegidas';
import { MIN_SPEECH_WORDS } from './limites';
import { AD_LIBRARY, MediaInvalidError, errorCodeOf, type AdLibraryService } from './portas';
import { LEITURA_MIDIA, type Artefato, type LeituraMidia, type LeituraSessao, type MedirResultado } from '../medicao/leitura';

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

/** Movido pra medicao/leitura/etapas.ts (roda na API e na Lambda); exportado daqui por compatibilidade. */
export { keyframeTimes } from '../medicao/leitura';

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
    @Inject(LEITURA_MIDIA) private readonly leitura: LeituraMidia,
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

  /**
   * Pipeline completo da análise. Nunca lança: falha vira campeão FAILED + job FAILED.
   * leitura-lambda-v1 §2: a mídia passa pela porta LeituraMidia (ANALYZE_IMPL=local|lambda). A medição só depende do
   * vídeo, então começa junto com a transcrição (antes: depois dela) — mesmo resultado, menos espera.
   */
  async runAnalyze(jobId: string, championId: string): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'maquina-champion-'));
    let medicaoP: Promise<MedirResultado> | null = null;
    let mapaEmVoo: Promise<unknown> | null = null;
    try {
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId }, include: { videoFile: true, audioFile: true, offer: true, createdBy: { select: { uiLocale: true } } } });
      if (!c.videoFile) throw new AnalysisError('MEDIA_INVALID', 'campeão sem vídeo');
      // upload + link: os metadados vêm em paralelo, sem segurar a análise
      const metaP = c.adLibraryUrl && (c.adMeta as { status?: string } | null)?.status !== 'resolved' ? this.resolveMeta(c, jobId).catch(() => null) : null;
      const sess = this.leitura.abrir({ workspaceId: c.workspaceId, video: c.videoFile, audio: c.audioFile, dir });

      // 1. reading_video: decodifica o arquivo inteiro (regra do download truncado) + probe + áudio
      await this.jobs.stage(jobId, 'reading_video', STAGE_PROGRESS.reading_video);
      let lido;
      try {
        lido = await sess.ler(!c.audioFile);
      } catch (e) {
        if (e instanceof MediaInvalidError || errorCodeOf(e) === 'MEDIA_INVALID') throw new AnalysisError('MEDIA_INVALID', (e as Error).message);
        throw e;
      }
      const probe = lido.probe;
      await this.prisma.champion.update({ where: { id: c.id }, data: { durationSec: r3(probe.durationSec) } });

      // 2. extracting_audio
      await this.jobs.stage(jobId, 'extracting_audio', STAGE_PROGRESS.extracting_audio);
      let audioFile = c.audioFile;
      if (probe.hasAudio && !audioFile && lido.audio) {
        audioFile = await this.salvar(lido.audio.artefato, { workspaceId: c.workspaceId, kind: 'CHAMPION_AUDIO', mimeType: 'audio/mp4', meta: { durationSec: lido.audio.durationSec } });
        await this.prisma.champion.update({ where: { id: c.id }, data: { audioFileId: audioFile.id } });
      }
      const teardown = await this.prisma.teardown.upsert({
        where: { championId: c.id }, update: {}, create: { workspaceId: c.workspaceId, championId: c.id },
      });

      // medição + trilha do rosto + recortes (só vídeo) correm junto com a transcrição; reaproveita medições prontas
      const guardadas = measurementsOf(teardown.measurements);
      const mapear = !(integracoesMode() === 'mock' && c.notes?.includes('[mock:not-mapped]'));
      medicaoP = sess.medir({ medir: !guardadas, segmentos: guardadas?.segments, mapear });
      medicaoP.catch(() => undefined); // quem trata é o await abaixo (ou o finally, se a transcrição falhar antes)

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

      // 4. measuring
      await this.jobs.stage(jobId, 'measuring', STAGE_PROGRESS.measuring);
      const med = await medicaoP;
      const measurements = guardadas ?? await this.gravarMedidas(c, med);
      await this.prisma.teardown.update({ where: { id: teardown.id }, data: { measurements: measurements as unknown as Prisma.InputJsonValue } });
      const t0 = measurements.keyframes.find((k) => k.reason === 't0') ?? measurements.keyframes[0];
      if (t0) await this.prisma.champion.update({ where: { id: c.id }, data: { thumbnailFileId: t0.fileId } });

      // 5+6. mapping_edit (§13.1-13.2) e diagnosing (Claude) em PARALELO: o describeEdit (trilha do rosto, frames-chave,
      // recortes, transcrição) e o analyzeChampion (transcrição, medições, frames-chave, oferta, adMeta) não dependem um
      // do outro; só o editMap final precisa das seções (fim do gancho), e ele fecha depois dos dois. O checklist segue
      // em ordem: fica em mapping_edit até o mapa acabar e só então passa a diagnosing.
      // Mapa que falha não derruba a análise (campeão sem mapa, keepEdit 'not_mapped'). Claude que falha derruba na hora;
      // o mapa em voo é ignorado e o finally espera ele parar antes de apagar a pasta.
      await this.jobs.stage(jobId, 'mapping_edit', STAGE_PROGRESS.mapping_edit);
      const diagnosticoP = this.diagnosticar(championId, jobId, metaP, measurements, transcript);
      diagnosticoP.catch(() => undefined); // quem trata é o await abaixo
      const mapaP = this.mapEdit(c, jobId, sess, med, measurements, transcript).catch((e) => {
        this.log.warn(`mapa da edição do campeão ${c.id} falhou: ${(e as Error).message}`);
        return null;
      });
      mapaEmVoo = mapaP;
      // Claude falhou primeiro: a falha é do diagnóstico, então o checklist passa a diagnosing antes (o web marca ali o ✕)
      const parts = await Promise.race([
        mapaP,
        diagnosticoP.then(() => mapaP, async (e: unknown) => {
          await this.jobs.stage(jobId, 'diagnosing', STAGE_PROGRESS.diagnosing).catch(() => undefined);
          throw e;
        }),
      ]);
      await this.jobs.stage(jobId, 'diagnosing', STAGE_PROGRESS.diagnosing);
      const draft = await diagnosticoP;
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
      // a medição pode estar no ar (transcrição falhou antes): espera ela parar antes de apagar a pasta
      if (medicaoP) await medicaoP.catch(() => undefined);
      // idem o mapa da edição (o Claude falhou com ele no ar): o resultado é descartado, os custos já ficaram gravados
      if (mapaEmVoo) await mapaEmVoo.catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Diagnóstico do Claude (§13 etapa 6): espera um pouco os metadados do link, relê o campeão e chama analyzeChampion. */
  private async diagnosticar(
    championId: string, jobId: string, metaP: Promise<unknown> | null, measurements: StoredMeasurements, transcript: StoredTranscript,
  ) {
    if (metaP) await Promise.race([metaP, sleep(ADMETA_WAIT_MS)]);
    const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: championId }, include: { offer: true, createdBy: { select: { uiLocale: true } } } });
    const frames = await this.prisma.file.findMany({ where: { id: { in: measurements.keyframes.map((k) => k.fileId) } } });
    const byId = new Map(frames.map((f) => [f.id, f]));
    const keyframes: { atSec: number; reason: string; url: string }[] = [];
    for (const k of measurements.keyframes) {
      const f = byId.get(k.fileId);
      if (f) keyframes.push({ atSec: k.atSec, reason: k.reason, url: await this.storage.signedUrl(f) });
    }
    const { keyframes: _k, ...plain } = measurements;
    const adMeta = (c.adMeta as unknown as AdLibraryMeta | null) ?? null;
    return this.claude.analyzeChampion(
      {
        workspaceId: c.workspaceId, championId: c.id, jobId, uiLocale: c.createdBy.uiLocale, offer: offerForAnalysis(c),
        transcript: { language: transcript.language, words: transcript.words }, measurements: plain, keyframes,
        adMeta: adMeta?.status === 'resolved' ? adMeta : null,
      },
      () => undefined,
    );
  }

  async failAnalysis(championId: string, jobId: string | null, code: AsyncErrorCode) {
    await this.sm
      .transition({ championId, event: 'ANALYSIS_FAILED', from: 'ANALYZING', to: 'FAILED', data: { errorCode: code, failReason: failReasonFor(code) } })
      .catch(() => undefined);
    if (jobId) await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: failReasonFor(code) }).catch(() => undefined);
  }

  /** Arquivo de uma etapa da leitura → linha em `files`. local: sobe agora; storage: a Lambda já subiu, só registra. */
  private salvar(a: Artefato, opts: { workspaceId: string; kind: 'CHAMPION_AUDIO' | 'CHAMPION_FRAME'; mimeType: string; meta?: { durationSec?: number } }): Promise<FileRow> {
    return a.tipo === 'local' ? this.storage.put(a.path, opts) : this.storage.registerObject(a.key, { ...opts, mimeType: a.mimeType, sizeBytes: a.sizeBytes });
  }

  /**
   * Partes do EditMap (sem o fim do gancho): trilha do rosto + describeEdit com frames-chave e recortes das faixas.
   * Gatilhos de QA (só em mock, nas notes do campeão): `[mock:not-mapped]` = sem mapa; `[mock:keep-two-faces]` = 2 rostos
   * no 1º trecho da trilha.
   */
  private async mapEdit(
    c: Champion, jobId: string, sess: LeituraSessao, med: MedirResultado, m: StoredMeasurements, transcript: StoredTranscript,
  ): Promise<Omit<EditMapParts, 'hookEndSec'> | null> {
    const mock = integracoesMode() === 'mock';
    if (!med.trilha) return null; // [mock:not-mapped]
    if (!med.trilha.ok) throw new Error(med.trilha.erro);
    const ft = med.trilha.valor;
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
    const textCrops: { atSec: number; box: Rect; url: string }[] = [];
    for (const [i, cd] of med.recortes.entries()) {
      try {
        const f = await this.salvar(cd.artefato, { workspaceId: c.workspaceId, kind: 'CHAMPION_FRAME', mimeType: 'image/jpeg' });
        textCrops.push({ atSec: cd.atSec, box: cd.box, url: await this.storage.signedUrl(f) });
      } catch (e) {
        this.log.warn(`recorte de faixa ${i} do campeão ${c.id} falhou: ${(e as Error).message}`);
      }
    }
    const draft = await this.claude.describeEdit({
      workspaceId: c.workspaceId, championId: c.id, jobId,
      video: { width: ft.width, height: ft.height, fps: ft.fps, frameCount: ft.frameCount, durationSec: m.durationSec },
      keyframes, textCrops, faceTrack: ft.segments,
      transcript: { language: transcript.language, words: transcript.words }, notes: c.notes,
    });
    const layers = await sess.refinar({ layers: draft.layers, fps: ft.fps, frameCount: ft.frameCount, words: transcript.words ?? [] });
    return {
      width: ft.width, height: ft.height, fps: ft.fps, frameCount: ft.frameCount, cells: ft.cells,
      // avatar principal = quem fala (dica da visão); rostos de b-roll/tela não entram na trilha
      faceTrack: pickMainSpeaker(ft.segments, draft.mainSpeaker), trackBlockers,
      mainSpeaker: draft.mainSpeaker ?? null, otherFaces: draft.otherFaces ?? [],
      layers, overlaysOverFace: draft.overlaysOverFace, profile: draft.profile,
    };
  }

  /** Medições recém-feitas → frames-chave viram CHAMPION_FRAME e o formato gravado em teardowns.measurements. */
  private async gravarMedidas(c: Champion, med: MedirResultado): Promise<StoredMeasurements> {
    if (!med.medidas) throw new Error('leitura: medição pedida e não devolvida');
    const { keyframes: kfs, ...resto } = med.medidas;
    const keyframes: StoredMeasurements['keyframes'] = [];
    for (const k of kfs) {
      const file = await this.salvar(k.artefato, { workspaceId: c.workspaceId, kind: 'CHAMPION_FRAME', mimeType: 'image/jpeg' });
      keyframes.push({ atSec: k.atSec, reason: k.reason, fileId: file.id });
    }
    return {
      durationSec: resto.durationSec, width: resto.width, height: resto.height, fps: resto.fps, hasAudio: resto.hasAudio,
      cuts: resto.cuts, segments: resto.segments, palette: resto.palette, silences: resto.silences, keyframes,
    };
  }
}


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
