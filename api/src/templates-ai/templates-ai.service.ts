import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { SemanticPlan, SemanticVariation } from '@maquina/contratos';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { CreativeStateMachine } from '../criativos/state-machine';
import { CreditosService } from '../creditos/creditos.service';
import { CustosService } from '../custos/custos.service';
import { GeracaoService } from '../geracao/geracao.service';
import { GENERATION_SERVICE, type GenerationService } from '../integracoes';
import { speechSeconds } from '../integracoes/catalogo/precos';
import { SEMANTIC_PLANNER, type SemanticPlannerPort } from '../integracoes/claude/semantic-planner';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { semanticContext } from '../variacao-ia/contexto';
import { aiPreviewsOf, aiSettings, producibleVariation, type AiAuthorization, type TemplateAiRunner } from './contract';
import { AiPreviewsService, MEDIA_BUDGET } from './previews.service';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const INSTRUCTIONS = 'Produce a finished short ad ready for automatic production. Preserve the original audience, angle and offer. All three options must use the requested format. 3 to 6 spoken turns, each at least 5 words, at most 120 spoken words total. No placeholders, no visual proof assets, no fictional personal experience or testimonial, no celebrity likeness. Use only supplied offer facts. If proof is unavailable omit that claim and use a grounded mechanism or objection. Requirements must be empty only when no evidence or asset is missing. Speakers are fictional presenters, not customers or experts. For F04 one presenter asks and answers one useful objection. F09 is one podcast presenter. F10 is a real question/answer dialogue, starting with the host and alternating host/presenter. Visuals describe a realistic, consistent studio set and presenter shot, no inserts that require unavailable product footage.';
type Production = { variation: SemanticVariation; actors: { speaker: string; faceId: string; voiceId: string }[]; generation: number };

@Injectable()
export class TemplatesAiService implements TemplateAiRunner {
  private readonly log = new Logger('TemplatesAI');
  private sweeping = false;
  constructor(
    private readonly db: PrismaService,
    private readonly cfg: ConfigService,
    private readonly jobs: JobsService,
    private readonly costs: CustosService,
    private readonly credits: CreditosService,
    private readonly sm: CreativeStateMachine,
    private readonly generation: GeracaoService,
    @Inject(SEMANTIC_PLANNER) private readonly planner: SemanticPlannerPort,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    private readonly previews: AiPreviewsService,
  ) {
    // templates-ia-previas-v1: a prévia aprovada entra na mesma produção por item do fluxo de 04/11
    this.previews.production = (itemId) => this.advanceProduction(itemId);
  }

  available(): boolean {
    if (this.cfg.get('AI_TEMPLATES_ENABLED') === 'off') return false;
    return this.planner.configured && (this.planner.mode === 'mock' || ['WAVESPEED_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET'].every((k) => !!this.cfg.get(k)));
  }

  /** Executa na mesma transação do lote + TemplateRun: nenhuma chamada paga aqui. */
  async initialize(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, a: AiAuthorization) {
    if (!this.available()) throw new AppException('PROVIDER_UNAVAILABLE');
    if (a.previews) return this.previews.initialize(tx, batchId, auth, a); // §5.1: sem item, sem criativo, sem reserva
    const b = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { champion: { include: { offer: true, teardown: true } }, templateRun: { include: { template: true } } } });
    if (b.workspaceId !== auth.workspaceId) throw new AppException('NOT_FOUND');
    const offer = b.champion.offer;
    const missing = ['what', 'cta'].filter((k) => !offer[k as 'what' | 'cta']?.trim());
    if (missing.length) throw new AppException('OFFER_INCOMPLETE', { fields: missing });
    const context = semanticContext(b.champion, { championId: b.championId, requestId: a.requestId, focus: 'FORMAT', instructions: INSTRUCTIONS, formatIds: [a.format] });
    const estimate = this.planner.estimate(context) + MEDIA_BUDGET;
    await this.costs.assertWithinCap(auth.workspaceId, estimate + Number(b.estimatedCostUsd ?? 0));
    const item = await tx.variationItem.create({ data: {
      workspaceId: b.workspaceId, batchId, kind: 'AUTO_EDIT', index: 0, autoType: 'AI_VIDEO', axis: 'DIVERSITY', code: `AI-${a.format}`,
      status: 'WRITING', payload: { params: { formatId: a.format } }, change: b.templateRun!.template.nameEn,
    } });
    await tx.creative.create({ data: {
      workspaceId: b.workspaceId, offerId: b.offerId, name: b.templateRun!.template.nameEn, language: offer.language,
      origin: 'VARIATION', championId: b.championId, variationBatchId: batchId, variationItemId: item.id, variationKind: 'AUTO_EDIT',
      variationCode: item.code, state: 'SCRIPTS_WRITING', createdById: auth.userId, engine: 'LIPSYNC', engineModel: 'pruna-lipsync', estimatedCostUsd: estimate,
      adName: `AI_${a.format}_${item.id.slice(-8)}`,
    } });
    await this.credits.reserveOnStart(tx, b, auth, a.expectedCredits ?? 0);
  }

  async run(jobId: string, batchId: string) {
    const job = await this.db.job.findUnique({ where: { id: jobId }, select: { input: true } });
    const itemId = (job?.input as { itemId?: string } | null)?.itemId;
    const head = await this.db.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
    if (aiPreviewsOf(head?.settings)) return itemId ? this.previews.runOne(jobId, batchId, itemId) : this.previews.run(jobId, batchId);
    try {
      const b = await this.db.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { champion: { include: { offer: true, teardown: true } }, items: { include: { creative: true } } } });
      const a = aiSettings(b.settings)!;
      const item = b.items.find((i) => i.autoType === 'AI_VIDEO')!;
      const c = item.creative!;
      if (c.state !== 'SCRIPTS_WRITING') return;
      // CAS do job antes da chamada externa: o mesmo job nunca submete duas vezes.
      const claim = await this.db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), stage: 'writing', progress: 20, creativeId: c.id } });
      if (!claim.count) return;
      const context = semanticContext(b.champion, { championId: b.championId, requestId: a.requestId, focus: 'FORMAT', instructions: INSTRUCTIONS, formatIds: [a.format] });
      const plan = await this.planner.plan(context, { workspaceId: b.workspaceId, championId: b.championId, jobId });
      const variation = producibleVariation(plan, a.format);
      await this.costs.assertWithinCap(b.workspaceId, MEDIA_BUDGET);
      await this.db.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'AI_PLAN_DONE', from: 'SCRIPTS_WRITING', to: 'FACES_GENERATING' });
        const last = await tx.scene.findFirst({ where: { creativeId: c.id }, orderBy: { generation: 'desc' } });
        const generation = (last?.generation ?? 0) + 1;
        const speakers = a.format === 'F10' ? ['host', 'presenter'] : ['presenter'];
        const actors: Production['actors'] = [];
        for (const [index, speaker] of speakers.entries()) {
          const podcast = a.format !== 'F04';
          const description = `Photorealistic vertical medium close-up of an original fictional adult ${index ? 'female presenter in a beige shirt' : 'male presenter in a dark blue shirt'}, age 30-40. ${podcast ? `Warm podcast studio, acoustic wood panels, broadcast microphone below the chin, ${index ? 'looking slightly to camera left' : 'looking slightly to camera right'}, opposite eyelines for a conversation` : 'Bright quiet home studio, speaking to camera, natural daylight'}. Face and mouth fully visible, natural skin texture. One person only, no logos, no text, no resemblance to a public figure. Consistent warm neutral palette.`;
          const casting = await tx.variationCasting.create({ data: { workspaceId: b.workspaceId, batchId, scope: 'ITEM', description } });
          const face = await tx.face.create({ data: { workspaceId: b.workspaceId, castingId: casting.id, batch: generation, position: 0, description } });
          actors.push({ speaker, faceId: face.id, voiceId: index ? 'Calm_Woman' : 'Casual_Guy' });
        }
        const production: Production = { variation, actors, generation };
        await tx.variationItem.update({ where: { id: item.id }, data: { status: 'READY', payload: json({ params: { formatId: a.format, production }, semanticPlan: plan }), rationale: variation.hypothesis } });
        await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt: b.launchedAt ?? new Date(), errorCode: null, failReason: null } });
      }, { timeout: 30000 });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: json(plan) });
      await this.advance(batchId);
    } catch (e) {
      this.log.warn(`lote ${batchId}: ${(e as Error).message}`);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: 'Could not prepare this AI video from the supplied offer.' });
      await this.fail(batchId, 'Could not prepare this AI video from the supplied offer.');
    }
  }

  async advance(batchId: string) {
    const head = await this.db.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
    if (aiPreviewsOf(head?.settings)) {
      // templates-ia-previas-v1 §3.3: por item. Prévias (planejador/imagens) e, nas aprovadas, a produção do vídeo.
      await this.previews.advanceBatch(batchId);
      for (const id of await this.previews.approvedInProduction(batchId)) await this.advanceProduction(id).catch((e) => this.log.warn(`${id}: ${(e as Error).message}`));
      return;
    }
    const item = await this.db.variationItem.findFirst({ where: { batchId, autoType: 'AI_VIDEO' }, select: { id: true } });
    if (item) await this.advanceProduction(item.id);
  }

  /** Produção do vídeo de 1 item (fluxo de 04/11 ou prévia aprovada). Persistência + CAS em cada submissão. */
  async advanceProduction(itemId: string): Promise<void> {
    const item = await this.db.variationItem.findUnique({ where: { id: itemId }, include: { creative: true, batch: true } });
    if (!item?.creative || item.creative.archivedAt) return;
    const batchId = item.batchId;
    const c = item.creative;
    const preview = !!item.previewStatus;
    if (item.batch.status === 'ANALYSIS_FAILED' || ['SCRIPTS_FAILED', 'FACES_FAILED', 'SCENES_FAILED'].includes(c.state)) return this.failItem(itemId, 'AI video generation failed. Your credits will be returned.');
    if (c.state === 'SCRIPTS_WRITING' && preview) {
      // retry de peça de prévia aprovada: nada a replanejar (roteiro, rostos e vozes fixados na prévia); cenas de novo
      await this.db.$transaction(async (tx) => {
        const last = await tx.scene.findFirst({ where: { creativeId: c.id }, orderBy: { generation: 'desc' } });
        const payload = item.payload as { production?: Production; params?: { production?: Production } };
        const production = payload.production ?? payload.params?.production;
        if (!production) throw new Error(`prévia ${itemId} aprovada sem produção`);
        await tx.variationItem.update({ where: { id: itemId }, data: { status: 'READY', payload: json({ ...payload, production: { ...production, generation: (last?.generation ?? 0) + 1 } }) } });
        await this.sm.transition({ tx, creativeId: c.id, event: 'AI_PLAN_DONE', from: 'SCRIPTS_WRITING', to: 'FACES_GENERATING' });
      }, { timeout: 30000 });
      return this.advanceProduction(itemId);
    }
    if (c.state === 'SCRIPTS_WRITING') {
      const job = await this.db.job.findFirst({ where: { variationBatchId: batchId, type: 'AUTO_PLAN' }, orderBy: { createdAt: 'desc' } });
      if (job?.status === 'FAILED') return this.failItem(itemId, 'AI preparation was interrupted. Please generate again.');
      // Pedido aceito antes de um reinício, mas sem qualquer chamada paga iniciada.
      if (job?.status === 'QUEUED') void this.jobs.detach(job.id, 'template IA', () => this.run(job.id, batchId));
      return;
    }
    const payload = item.payload as unknown as { production?: Production; params?: { production?: Production } };
    const production = payload.production ?? payload.params?.production;
    if (!production) return;
    if (c.state === 'FACES_GENERATING') {
      for (const actor of production.actors) {
        const claim = await this.db.face.updateMany({ where: { id: actor.faceId, status: 'QUEUED' }, data: { status: 'GENERATING' } });
        if (!claim.count) continue;
        const face = await this.db.face.findUniqueOrThrow({ where: { id: actor.faceId } });
        try { await this.gen.submitFace({ workspaceId: c.workspaceId, faceId: face.id, description: face.description, language: c.language }); }
        catch { await this.db.face.update({ where: { id: face.id }, data: { status: 'FAILED', errorCode: 'PROVIDER_ERROR' } }); }
      }
      const faces = await this.db.face.findMany({ where: { id: { in: production.actors.map((a) => a.faceId) } } });
      if (faces.some((f) => f.status === 'FAILED')) return this.failItem(itemId, 'Could not generate the presenters. Your credits will be returned.');
      if (faces.length !== production.actors.length || faces.some((f) => f.status !== 'READY')) {
        if (Date.now() - c.stateChangedAt.getTime() > 20 * 60_000) return this.failItem(itemId, 'Presenter generation timed out.');
        return;
      }
      await this.db.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'AI_FACES_DONE', from: 'FACES_GENERATING', to: 'SCENES_GENERATING', data: { selectedFaceId: faces[0].id, voiceId: production.actors[0].voiceId, generatedAt: new Date() } });
        let startSec = 0;
        for (const [index, beat] of production.variation.beats.entries()) {
          const actor = production.actors.find((a) => a.speaker === beat.speaker) ?? production.actors[0];
          const endSec = startSec + Math.max(2, speechSeconds(beat.text));
          await tx.scene.create({ data: { workspaceId: c.workspaceId, creativeId: c.id, generation: production.generation, index, label: beat.role, startSec, endSec, speech: beat.text,
            visualPrompt: 'Natural conversational delivery, restrained gestures, stable camera, preserve the face and studio in the reference image.', pipeline: 'TTS_LIPSYNC', faceId: actor.faceId, voiceId: actor.voiceId,
          } });
          startSec = endSec;
        }
      }, { timeout: 30000 }).catch(async (e) => { if ((await this.db.creative.findUnique({ where: { id: c.id } }))?.state === 'FACES_GENERATING') throw e; });
    }
    const fresh = await this.db.creative.findUniqueOrThrow({ where: { id: c.id } });
    if (fresh.state !== 'SCENES_GENERATING') return;
    const scenes = await this.db.scene.findMany({ where: { creativeId: c.id, stale: false }, orderBy: { index: 'asc' } });
    for (const scene of scenes) {
      const claim = await this.db.scene.updateMany({ where: { id: scene.id, status: 'QUEUED' }, data: { status: 'GENERATING', startedAt: new Date() } });
      if (claim.count) await this.generation.submitFirstStep(fresh, scene.id);
    }
    if (Date.now() - fresh.stateChangedAt.getTime() > 40 * 60_000) {
      for (const s of scenes.filter((s) => s.status === 'GENERATING')) await this.generation.failScene(s.id, 'TIMEOUT');
    }
    await this.generation.settle(c.id);
  }

  private async fail(batchId: string, reason: string) {
    const item = await this.db.variationItem.findFirst({ where: { batchId, autoType: 'AI_VIDEO' }, select: { id: true } });
    if (item) await this.failItem(item.id, reason);
  }

  /** Falha de 1 peça (§3.3): só ela vai a RENDER_FAILED; o estorno sai pela linha dela no assentamento. */
  private async failItem(itemId: string, reason: string) {
    const item = await this.db.variationItem.findUnique({ where: { id: itemId }, include: { creative: true } });
    const batchId = item?.batchId;
    if (!item?.creative || ['APPROVED', 'RENDER_READY', 'RENDERING'].includes(item.creative.state)) return;
    await this.db.$transaction(async (tx) => {
      if (item.creative!.state !== 'RENDER_FAILED') await this.sm.transition({ tx, creativeId: item.creative!.id, event: 'AI_PRODUCTION_FAILED', from: item.creative!.state, to: 'RENDER_FAILED' });
      await tx.variationItem.update({ where: { id: item.id }, data: { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: reason } });
      // fluxo de 04/11: o lote vira LAUNCHED pra assentar; prévias: o lote já está LAUNCHED desde a 1ª aprovação
      if (!item.previewStatus) await tx.variationBatch.update({ where: { id: batchId! }, data: { status: 'LAUNCHED', errorCode: null, failReason: null, launchedAt: new Date() } });
    }, { timeout: 30000 });
    await this.credits.settleAll(item.workspaceId);
  }

  async retry(auth: AuthContext, pieceId: string) {
    const item = await this.db.variationItem.findFirst({ where: { id: pieceId, workspaceId: auth.workspaceId, autoType: 'AI_VIDEO' }, include: { creative: true, batch: { include: { champion: true } } } });
    if (!item?.creative || item.batch.champion.archivedAt) throw new AppException('NOT_FOUND');
    if (!['RENDER_FAILED', 'SCENES_FAILED'].includes(item.creative.state)) throw new AppException('INVALID_STATE');
    if (item.batch.champion.status !== 'READY') throw new AppException('INVALID_STATE', { reason: 'champion_not_ready' });
    await this.costs.assertWithinCap(auth.workspaceId, Number(item.creative.estimatedCostUsd ?? MEDIA_BUDGET));
    // Mesmo caminho de reserva do retry de templates; a transição CAS abaixo impede duas produções.
    await this.credits.beforeRetry(auth.workspaceId, item.batchId, item.id, auth.userId);
    const job = await this.db.$transaction(async (tx) => {
      await this.sm.transition({ tx, creativeId: item.creative!.id, event: 'AI_PRODUCTION_RETRY', from: item.creative!.state, to: 'SCRIPTS_WRITING' });
      await tx.scene.updateMany({ where: { creativeId: item.creative!.id }, data: { stale: true } });
      await tx.render.updateMany({ where: { creativeId: item.creative!.id }, data: { stale: true } });
      await tx.variationItem.update({ where: { id: item.id }, data: { status: 'WRITING', leftOutAt: null, errorCode: null, failReason: null } });
      if (item.previewStatus) return null; // prévia aprovada: roteiro/rostos/vozes já fixados, sem planejador (advanceProduction refaz as cenas)
      return tx.job.create({ data: { workspaceId: auth.workspaceId, createdById: auth.userId, type: 'AUTO_PLAN', status: 'QUEUED', variationBatchId: item.batchId, championId: item.batch.championId, offerId: item.batch.offerId, input: { batchId: item.batchId } } });
    }, { timeout: 30000 });
    if (!job) { void this.jobs.detach(null, 'retry de prévia aprovada', () => this.advanceProduction(item.id)); return; }
    void this.jobs.detach(job.id, 'retry template IA', () => this.run(job.id, item.batchId));
  }

  @Interval('templates-ai-production', 3000)
  async sweep() {
    if (this.sweeping || (process.env.NODE_ENV === 'test' && process.env.BOOT_RECOVERY === 'off')) return;
    this.sweeping = true;
    try {
      const items = await this.db.variationItem.findMany({ where: { autoType: 'AI_VIDEO', creative: { archivedAt: null, state: { in: ['SCRIPTS_WRITING', 'SCRIPTS_FAILED', 'FACES_GENERATING', 'FACES_FAILED', 'SCENES_GENERATING', 'SCENES_FAILED'] } } }, select: { batchId: true }, take: 50 });
      for (const batchId of new Set(items.map((i) => i.batchId))) await this.advance(batchId).catch((e) => this.log.warn(`${batchId}: ${(e as Error).message}`));
      await this.previews.sweep(); // templates-ia-previas-v1: prévias PLANNED/IMAGING e lotes PLANNING
    } finally { this.sweeping = false; }
  }
}
