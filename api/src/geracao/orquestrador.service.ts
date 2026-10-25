import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ProviderTask } from '@prisma/client';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { codeFromTaskStatus } from '../common/errors/falhas';
import { CreativeViews } from '../criativos/views';
import { CustosService } from '../custos/custos.service';
import { EventosService } from '../eventos/eventos.service';
import { GENERATION_SERVICE, PROVIDER_TASK_FINISHED, isIntegracaoError, type GenerationService, type ProviderTaskFinishedEvent } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { RostosService } from '../rostos/rostos.service';
import { GeracaoService } from './geracao.service';
import { TakeService } from './take.service';
import { TrocaService } from '../troca/troca.service';
import { alignCaptionToScript } from './legenda';

/**
 * Orquestrador da geração (eventos.md §3): ouve `provider.task.finished`, baixa e VALIDA a saída pro storage e
 * encadeia o próximo passo.
 *   SCENES:  SCENE_VIDEO → TRANSCRIBE → cena READY
 *   LIPSYNC: TTS → LIPSYNC → TRANSCRIBE → cena READY
 *   feature 2: AUDIO_LIPSYNC: LIPSYNC (trecho do campeão) → READY (words do teardown); REUSE: sem task, copia da dona
 *   rostos:  FACE_IMAGE → rosto READY
 *   STATIC_IMAGE (task com renderId, rev. 23/10): ignorada aqui; quem trata é o ImagemEstaticaService (edicao)
 * Idempotente: task com handledAt é ignorada; resultado de tentativa antiga (cena regerada/stale) só é marcado.
 */
@Injectable()
export class OrquestradorService {
  private readonly log = new Logger('Orquestrador');
  private readonly inflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly geracao: GeracaoService,
    private readonly takes: TakeService,
    private readonly troca: TrocaService,
    private readonly rostos: RostosService,
    private readonly views: CreativeViews,
    private readonly custos: CustosService,
    private readonly eventos: EventosService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
  ) {}

  @OnEvent(PROVIDER_TASK_FINISHED, { async: true })
  async onFinished(e: ProviderTaskFinishedEvent) {
    await this.handle(e.providerTaskId);
  }

  /** Processa uma task terminada (evento, ou o boot pra tasks terminadas e não tratadas). Nunca lança. */
  async handle(providerTaskId: string): Promise<void> {
    if (this.inflight.has(providerTaskId)) return;
    this.inflight.add(providerTaskId);
    try {
      const t = await this.prisma.providerTask.findUnique({ where: { id: providerTaskId } });
      if (!t || t.handledAt || t.status === 'SUBMITTED') return;
      // variacao-auto-v1 rev. 23/10 §14.3: task do STATIC (render_id) é do ImagemEstaticaService (edicao); aqui nem marca handledAt
      if (t.renderId) return;
      if (t.faceId) await this.onFace(t);
      else if (t.takeId) await this.onTake(t);
      else if (t.sceneId && (await this.isSwap(t.sceneId))) await this.onSwap(t);
      else if (t.sceneId) await this.onScene(t);
      await this.prisma.providerTask.updateMany({ where: { id: t.id, handledAt: null }, data: { handledAt: new Date() } });
    } catch (err) {
      this.log.error(`task ${providerTaskId}: ${(err as Error).stack ?? err}`);
    } finally {
      this.inflight.delete(providerTaskId);
    }
  }

  private async onFace(t: ProviderTask) {
    const face = await this.prisma.face.findUnique({ where: { id: t.faceId! } });
    if (!face || (face.status !== 'QUEUED' && face.status !== 'GENERATING')) return;
    if (t.status !== 'COMPLETED' || !t.outputUrls[0]) {
      await this.rostos.failFace(face.id, codeFromTaskStatus(t.status, t.errorCode));
    } else {
      try {
        const file = await this.storage.ingestFromUrl(t.outputUrls[0], { workspaceId: face.workspaceId, kind: 'FACE_IMAGE', validate: 'image' });
        const f = await this.prisma.face.update({ where: { id: face.id }, data: { status: 'READY', fileId: file.id, failReason: null, errorCode: null }, include: { file: true } });
        if (f.creativeId) this.eventos.publish(f.creativeId, 'face.updated', await this.views.face(f, null));
      } catch (e) {
        await this.rostos.failFace(face.id, e instanceof IngestError ? 'DOWNLOAD_INVALID' : 'PROVIDER_ERROR');
      }
    }
    if (!face.creativeId) return; // rosto de elenco (feature 2): sem SSE nem máquina do criativo; a tela do lote faz polling
    await this.rostos.settleBatch(face.creativeId, face.batch);
    this.publishCost(face.creativeId);
  }

  private async onScene(t: ProviderTask) {
    const scene = await this.prisma.scene.findUnique({ where: { id: t.sceneId! } });
    if (!scene || scene.stale || (scene.status !== 'QUEUED' && scene.status !== 'GENERATING')) return;
    if (scene.startedAt && t.submittedAt < scene.startedAt) return; // resultado de tentativa anterior
    const c = await this.prisma.creative.findUnique({ where: { id: scene.creativeId } });
    if (!c || c.archivedAt) return;

    try {
      if (t.status !== 'COMPLETED') {
        await this.geracao.failScene(scene.id, codeFromTaskStatus(t.status, t.errorCode));
      } else if (t.kind === 'SCENE_VIDEO' || t.kind === 'LIPSYNC') {
        const { file, thumbnail } = await this.storage.ingestVideoWithThumbnail(t.outputUrls[0], { workspaceId: scene.workspaceId, kind: 'SCENE_CLIP' });
        if (scene.pipeline === 'AUDIO_LIPSYNC') {
          // feature 2: words já vieram do teardown (trecho original), sem TRANSCRIBE
          const r = await this.prisma.scene.updateMany({
            where: { id: scene.id, status: { in: ['QUEUED', 'GENERATING'] } },
            data: { clipFileId: file.id, thumbnailFileId: thumbnail.id, status: 'READY', progress: 100, readyAt: new Date(), failReason: null, errorCode: null },
          });
          if (r.count) {
            await this.geracao.publishScene(await this.prisma.scene.findUniqueOrThrow({ where: { id: scene.id } }));
            await this.geracao.propagateToFollowers(scene.id);
          }
        } else {
          const s = await this.prisma.scene.update({ where: { id: scene.id }, data: { clipFileId: file.id, thumbnailFileId: thumbnail.id, progress: 70 } });
          await this.geracao.publishScene(s);
          await this.gen.submitTranscribe({ workspaceId: scene.workspaceId, sceneId: scene.id, mediaUrl: await this.storage.signedUrl(file), language: c.language });
        }
      } else if (t.kind === 'TTS') {
        const file = await this.storage.ingestFromUrl(t.outputUrls[0], { workspaceId: scene.workspaceId, kind: 'SCENE_AUDIO', validate: 'audio' });
        const s = await this.prisma.scene.update({ where: { id: scene.id }, data: { audioFileId: file.id, progress: 35 } });
        await this.geracao.publishScene(s);
        await this.gen.submitLipsync({
          workspaceId: scene.workspaceId, sceneId: scene.id, faceImageUrl: await this.geracao.faceUrl(c),
          audioUrl: await this.storage.signedUrl(file), visualPrompt: scene.visualPrompt, format: c.format,
        });
      } else if (t.kind === 'TRANSCRIBE') {
        // legenda = texto do roteiro com os tempos da transcrição (a transcrição erra marca e número)
        const words = alignCaptionToScript(scene.speech, await this.gen.parseWords(t.id));
        // a cena só fica READY com clipe validado, words gravado E miniatura
        const r = await this.prisma.scene.updateMany({
          where: { id: scene.id, status: { in: ['QUEUED', 'GENERATING'] }, clipFileId: { not: null }, thumbnailFileId: { not: null } },
          data: { status: 'READY', words, progress: 100, readyAt: new Date(), failReason: null, errorCode: null },
        });
        if (!r.count) await this.geracao.failScene(scene.id, 'PROVIDER_ERROR');
        else {
          await this.geracao.publishScene(await this.prisma.scene.findUniqueOrThrow({ where: { id: scene.id } }));
          await this.geracao.propagateToFollowers(scene.id); // feature 2: seguidoras REUSE copiam o clipe
        }
      }
    } catch (e) {
      const code = e instanceof IngestError ? 'DOWNLOAD_INVALID' : isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      if (!(e instanceof IngestError) && !isIntegracaoError(e)) this.log.error(`cena ${scene.id}: ${(e as Error).stack ?? e}`);
      await this.geracao.failScene(scene.id, code);
    }
    await this.geracao.settle(scene.creativeId);
    this.publishCost(scene.creativeId);
  }

  /** §13.5: TTS → LIPSYNC → TRANSCRIBE do take (ou LIPSYNC → READY no AUDIO_LIPSYNC); fatias espelham. */
  private async onTake(t: ProviderTask) {
    const creativeId = await this.takes.onTask(t);
    if (!creativeId) return;
    await this.geracao.settle(creativeId);
    this.publishCost(creativeId);
  }

  private async isSwap(sceneId: string): Promise<boolean> {
    const s = await this.prisma.scene.findUnique({ where: { id: sceneId }, select: { pipeline: true } });
    return s?.pipeline === 'SWAP_VIDEO';
  }

  /** §13.15: janelas Kling/Seedance → emenda → lipsync v2v → identidade (TrocaService); fecha a geração. */
  private async onSwap(t: ProviderTask) {
    const creativeId = await this.troca.onTask(t);
    if (!creativeId) return;
    await this.geracao.settle(creativeId);
    this.publishCost(creativeId);
  }

  private publishCost(creativeId: string) {
    if (!this.eventos.listenerCount(creativeId)) return;
    void this.custos
      .creativeCost(creativeId)
      .then((costUsd) => this.eventos.publish(creativeId, 'cost.updated', { costUsd }))
      .catch(() => undefined);
  }
}
