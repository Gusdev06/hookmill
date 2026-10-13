import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Take, TranscriptWord } from '@maquina/contratos';
import { Prisma, type Creative, type ProviderTask, type Take as TakeRow } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { asAsyncErrorCode, codeFromTaskStatus, failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { CreativeViews, currentScenes, scenesSummary } from '../criativos/views';
import { EventosService } from '../eventos/eventos.service';
import { CATALOG_SERVICE, GENERATION_SERVICE, integracoesMode, isIntegracaoError, type CatalogService, type GenerationService } from '../integracoes';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { PrismaService } from '../prisma/prisma.service';
import { alignCaptionToScript } from './legenda';
import { AUDIO_LIPSYNC_MIN_SEC, TAKE_MAX_AUDIO_SEC, takeSeed } from './take';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const PENDING = ['QUEUED', 'GENERATING'] as const;

/** Erro de submissão/encadeamento do take que já tem código do contrato (ex.: LIPSYNC_AUDIO_TOO_LONG). */
export class TakeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TakeError';
  }
}

/**
 * §13.5: o take = o clipe contínuo de lipsync do criativo (1 por geração, áudio inteiro numa chamada).
 *   TTS_LIPSYNC:   TTS (texto inteiro) → LIPSYNC → TRANSCRIBE → sliceTake → fatias READY juntas
 *   AUDIO_LIPSYNC: janela do áudio do campeão → LIPSYNC → sliceTake (words do teardown) → fatias READY
 * As fatias (cenas TAKE_SLICE) espelham o status do take. Quem fecha a geração do criativo é o `settle` do chamador.
 */
@Injectable()
export class TakeService {
  private readonly log = new Logger('Take');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly views: CreativeViews,
    private readonly eventos: EventosService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
  ) {}

  // ───────── submissão ─────────

  /** Primeiro passo do take. Falha = take e fatias FAILED. Devolve true se algo foi submetido (ou bloqueio de conteúdo). */
  async submitFirstStep(c: Creative, takeId: string): Promise<boolean> {
    const t = await this.prisma.take.findUniqueOrThrow({ where: { id: takeId } });
    try {
      if (t.kind === 'AUDIO_LIPSYNC') {
        await this.submitAudioLipsync(c, t);
      } else {
        if (!c.voiceId) throw new Error('take TTS_LIPSYNC sem voiceId');
        await this.gen.submitTts({ workspaceId: c.workspaceId, takeId: t.id, voiceId: c.voiceId, text: t.speech ?? '', language: c.language });
      }
      await this.prisma.take.updateMany({ where: { id: t.id, status: 'QUEUED' }, data: { status: 'GENERATING', progress: 5 } });
      await this.prisma.scene.updateMany({ where: { takeId: t.id, stale: false, status: 'QUEUED' }, data: { status: 'GENERATING', progress: 5 } });
      await this.publish(t.id);
      return true;
    } catch (e) {
      const code = e instanceof TakeError ? e.code : isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      this.log.warn(`submissão do take ${t.id} falhou: ${(e as Error).message}`);
      await this.fail(t.id, code);
      return code === 'SAFETY_BLOCK';
    }
  }

  /** Janela contínua do áudio do campeão (uma chamada só), piso de 2 s do Pruna, teto de 600 s. */
  private async submitAudioLipsync(c: Creative, t: TakeRow): Promise<void> {
    if (!c.championId) throw new Error('AUDIO_LIPSYNC sem campeão');
    const ch = await this.prisma.champion.findUnique({ where: { id: c.championId }, include: { audioFile: true } });
    if (!ch?.audioFile) throw new Error('campeão sem áudio extraído');
    const start = num(t.sourceStartSec) ?? 0;
    const total = num(ch.durationSec) ?? Number.MAX_SAFE_INTEGER;
    let end = num(t.sourceEndSec) ?? total;
    if (end - start < AUDIO_LIPSYNC_MIN_SEC) end = Math.min(total, start + AUDIO_LIPSYNC_MIN_SEC);
    if (end - start > TAKE_MAX_AUDIO_SEC) throw new TakeError('LIPSYNC_AUDIO_TOO_LONG', `janela de ${r3(end - start)} s`);
    const dir = await mkdtemp(join(tmpdir(), 'maquina-take-'));
    try {
      const src = join(dir, 'champion.m4a');
      await this.storage.downloadTo(ch.audioFile, src);
      const [out] = await this.media.sliceAudio(src, [{ startSec: start, endSec: end }], dir);
      const file = await this.storage.put(out, {
        workspaceId: c.workspaceId, kind: 'SCENE_AUDIO', mimeType: /\.wav$/i.test(out) ? 'audio/wav' : 'audio/mp4', meta: { durationSec: end - start },
      });
      await this.prisma.take.update({ where: { id: t.id }, data: { audioFileId: file.id, durationSec: r3(end - start), progress: 35 } });
      await this.gen.submitLipsync({
        workspaceId: c.workspaceId, takeId: t.id, faceImageUrl: await this.faceUrl(c), audioUrl: await this.storage.signedUrl(file),
        visualPrompt: await this.lipsyncPrompt(c), format: c.format, seed: t.seed,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Gatilho de QA `[mock:take-fail]` (só em mock; notes do campeão, do lote ou a descrição do rosto): o LIPSYNC do take falha. */
  private async lipsyncPrompt(c: Pick<Creative, 'championId' | 'variationBatchId' | 'faceDescription'>): Promise<string> {
    if (integracoesMode() !== 'mock') return '';
    const trig = '[mock:take-fail]';
    const [ch, b] = await Promise.all([
      c.championId ? this.prisma.champion.findUnique({ where: { id: c.championId }, select: { notes: true } }) : null,
      c.variationBatchId ? this.prisma.variationBatch.findUnique({ where: { id: c.variationBatchId }, select: { notes: true } }) : null,
    ]);
    return [ch?.notes, b?.notes, c.faceDescription].some((x) => x?.includes(trig)) ? '[mock:PROVIDER_ERROR]' : '';
  }

  private async faceUrl(c: Pick<Creative, 'selectedFaceId'>): Promise<string> {
    const face = c.selectedFaceId ? await this.prisma.face.findUnique({ where: { id: c.selectedFaceId }, include: { file: true } }) : null;
    if (!face?.file) throw new Error('rosto escolhido sem arquivo');
    return this.storage.signedUrl(face.file);
  }

  // ───────── fim de task (chamado pelo orquestrador) ─────────

  /** Task do take terminou. Resultado de tentativa antiga (take regerado) ou de take stale só é ignorado. Nunca lança. */
  async onTask(t: ProviderTask): Promise<string | null> {
    const take = await this.prisma.take.findUnique({ where: { id: t.takeId! } });
    if (!take || take.stale || !(PENDING as readonly string[]).includes(take.status)) return take?.creativeId ?? null;
    if (take.startedAt && t.submittedAt < take.startedAt) return take.creativeId;
    const c = await this.prisma.creative.findUnique({ where: { id: take.creativeId } });
    if (!c || c.archivedAt) return null;
    try {
      if (t.status !== 'COMPLETED') {
        await this.fail(take.id, codeFromTaskStatus(t.status, t.errorCode));
      } else if (t.kind === 'TTS') {
        const file = await this.storage.ingestFromUrl(t.outputUrls[0], { workspaceId: take.workspaceId, kind: 'SCENE_AUDIO', validate: 'audio' });
        const dur = num(file.durationSec);
        if (dur != null && dur > TAKE_MAX_AUDIO_SEC) throw new TakeError('LIPSYNC_AUDIO_TOO_LONG', `TTS com ${dur} s`);
        await this.prisma.take.update({ where: { id: take.id }, data: { audioFileId: file.id, durationSec: dur, progress: 35 } });
        await this.progressSlices(take.id, 35);
        await this.gen.submitLipsync({
          workspaceId: take.workspaceId, takeId: take.id, faceImageUrl: await this.faceUrl(c), audioUrl: await this.storage.signedUrl(file),
          visualPrompt: await this.lipsyncPrompt(c), format: c.format, seed: take.seed,
        });
        await this.publish(take.id);
      } else if (t.kind === 'LIPSYNC') {
        const { file, thumbnail } = await this.storage.ingestVideoWithThumbnail(t.outputUrls[0], { workspaceId: take.workspaceId, kind: 'SCENE_CLIP' });
        await this.prisma.take.update({ where: { id: take.id }, data: { clipFileId: file.id, thumbnailFileId: thumbnail.id, progress: 70 } });
        if (take.kind === 'AUDIO_LIPSYNC') {
          await this.finish(take.id, wordsOf(take.words));
        } else {
          await this.progressSlices(take.id, 70);
          await this.gen.submitTranscribe({ workspaceId: take.workspaceId, takeId: take.id, mediaUrl: await this.storage.signedUrl(file), language: c.language });
          await this.publish(take.id);
        }
      } else if (t.kind === 'TRANSCRIBE') {
        await this.finish(take.id, await this.gen.parseWords(t.id));
      }
    } catch (e) {
      const code = e instanceof TakeError ? e.code : e instanceof IngestError ? 'DOWNLOAD_INVALID' : isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      if (!(e instanceof TakeError) && !(e instanceof IngestError) && !isIntegracaoError(e)) this.log.error(`take ${take.id}: ${(e as Error).stack ?? e}`);
      await this.fail(take.id, code);
    }
    return take.creativeId;
  }

  /**
   * Take com clipe pronto: fatia pelas palavras (sliceTake), grava tempos reais, words e miniatura por fatia,
   * e marca take + fatias READY juntos.
   */
  private async finish(takeId: string, words: TranscriptWord[]) {
    const take = await this.prisma.take.findUniqueOrThrow({ where: { id: takeId }, include: { clipFile: true } });
    if (!take.clipFile || !take.thumbnailFileId) throw new Error('take sem clipe/miniatura');
    const slices = await this.prisma.scene.findMany({ where: { takeId, stale: false }, orderBy: { index: 'asc' } });
    if (!slices.length) throw new Error('take sem fatias');
    const clipSec = num(take.clipFile.durationSec);
    const durationSec = clipSec && clipSec > 0 ? clipSec : num(take.durationSec) ?? 0;
    const cut = this.catalog.sliceTake({ blocks: slices.map((s) => ({ label: s.label, speech: s.speech })), words, durationSec });
    if (cut.length !== slices.length) throw new Error(`sliceTake devolveu ${cut.length} fatias pra ${slices.length} cenas`);
    for (const x of cut) if (!x.matched) this.log.warn(`take ${takeId}: fatia ${x.index} sem palavra casada (fronteira proporcional)`);
    const thumbs = await this.sliceThumbnails(take, cut.map((x) => (x.takeStartSec + x.takeEndSec) / 2));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.take.updateMany({
        where: { id: takeId, status: { in: [...PENDING] } },
        data: { status: 'READY', progress: 100, readyAt: now, words: words as unknown as Prisma.InputJsonValue, failReason: null, errorCode: null },
      });
      if (!r.count) return;
      for (const [i, s] of slices.entries()) {
        const x = cut[i];
        const sliceWords = take.kind === 'TTS_LIPSYNC' ? alignCaptionToScript(s.speech, x.words) : x.words;
        await tx.scene.update({
          where: { id: s.id },
          data: {
            status: 'READY', progress: 100, readyAt: now, failReason: null, errorCode: null,
            takeStartSec: r3(x.takeStartSec), takeEndSec: r3(x.takeEndSec), startSec: r3(x.takeStartSec), endSec: r3(x.takeEndSec),
            clipFileId: take.clipFileId, thumbnailFileId: thumbs[i] ?? take.thumbnailFileId, audioFileId: take.audioFileId,
            words: sliceWords as unknown as Prisma.InputJsonValue,
          },
        });
      }
    });
    await this.publish(takeId, true);
  }

  /** Miniatura de cada fatia no meio dela (nunca o frame 0). Falhou = usa a do take. */
  private async sliceThumbnails(take: TakeRow & { clipFile: { storageKey: string } | null }, atSec: number[]): Promise<(string | null)[]> {
    if (!take.clipFile) return atSec.map(() => null);
    const dir = await mkdtemp(join(tmpdir(), 'maquina-take-thumb-'));
    try {
      const src = join(dir, 'clip.mp4');
      await this.storage.downloadTo(take.clipFile, src);
      const frames = await this.media.keyframes(src, atSec.map((t) => Math.max(0.04, t)), dir, 720);
      const out: (string | null)[] = [];
      for (const [i, t] of atSec.entries()) {
        const f = frames.find((x) => Math.abs(x.atSec - Math.max(0.04, t)) < 1e-6) ?? frames[i];
        out.push(f ? (await this.storage.put(f.path, { workspaceId: take.workspaceId, kind: 'THUMBNAIL', mimeType: 'image/jpeg' })).id : null);
      }
      return out;
    } catch (e) {
      this.log.warn(`take ${take.id}: miniaturas das fatias falharam (${(e as Error).message}); usando a do take`);
      return atSec.map(() => null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Take FAILED + todas as fatias FAILED com o mesmo código. */
  async fail(takeId: string, code: string) {
    const ac = asAsyncErrorCode(code);
    const r = await this.prisma.take.updateMany({
      where: { id: takeId, status: { in: [...PENDING] } },
      data: { status: 'FAILED', errorCode: ac, failReason: failReasonFor(ac) },
    });
    if (!r.count) return;
    await this.prisma.scene.updateMany({
      where: { takeId, stale: false, status: { in: [...PENDING] } },
      data: { status: 'FAILED', errorCode: ac, failReason: failReasonFor(ac) },
    });
    await this.publish(takeId, true);
  }

  private async progressSlices(takeId: string, progress: number) {
    await this.prisma.scene.updateMany({ where: { takeId, stale: false, status: { in: [...PENDING] } }, data: { status: 'GENERATING', progress } });
  }

  // ───────── SSE ─────────

  /** take.updated (+ scene.updated por fatia quando `slices`). */
  async publish(takeId: string, slices = true) {
    const t = await this.prisma.take.findUnique({ where: { id: takeId }, include: { creative: { select: { format: true } } } });
    if (!t || !this.eventos.listenerCount(t.creativeId)) return;
    const scenes = await currentScenes(this.prisma, t.creativeId);
    const summary = scenesSummary(scenes);
    const view: Take = await this.views.take(t, t.creative.format);
    this.eventos.publish(t.creativeId, 'take.updated', { ...view, summary });
    if (slices) for (const s of scenes.filter((x) => x.takeId === takeId)) this.eventos.publish(t.creativeId, 'scene.updated', { ...(await this.views.scene(s)), summary });
  }
}

function wordsOf(json: Prisma.JsonValue | null): TranscriptWord[] {
  return Array.isArray(json) ? (json as unknown as TranscriptWord[]) : [];
}

