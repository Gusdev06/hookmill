// templates-ia-previas-v1 (07/11): as 4 prévias em imagem antes do vídeo. Planejador inicial (job AUTO_PLAN kind ai_previews)
// → itens-prévia (included false) → rostos Soul V2 → READY; approve (CAS + reserva por aprovação), "Novo ângulo" e "Try again".
// Grátis: nenhuma reserva nas prévias; custo de provedor em cost_entries e no teto mensal. Status só pelas transições de previews.ts.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiFormat, AiPreview, AiPreviewsView, ApproveAiPreviewsBody, PieceStatus, RegenerateAiPreviewBody, RetryAiPreviewBody, SemanticVariationV2,
} from '@maquina/contratos';
import { Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { CreditosService } from '../creditos/creditos.service';
import { CustosService } from '../custos/custos.service';
import { pieceStatus } from '../edicao/pecas';
import { GENERATION_SERVICE, type GenerationService } from '../integracoes';
import { voiceFor } from '../integracoes/catalogo/vozes';
import { FACE_MODEL, SCENE_MODELS } from '../integracoes/catalogo/precos';
import { SEMANTIC_PLANNER, type SemanticPlannerPort } from '../integracoes/claude/semantic-planner';
import { evidenceOf, previewFaceFraming, previewImagesUsd, speakersOf, type SemanticContextV2 } from '../integracoes/claude/semantic-v2';
import { isIntegracaoError } from '../integracoes/erros';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { semanticContext } from '../variacao-ia/contexto';
import {
  AI_PREVIEW_CANDIDATES, AI_PREVIEW_IMAGING_TIMEOUT_MS, AI_PREVIEW_MAX, AI_PREVIEW_MIN, AI_PREVIEW_REGEN_PER_BATCH, AI_PREVIEW_REGEN_PER_PREVIEW,
  AI_PREVIEW_RETRY_PER_PREVIEW, aiPreviewsOf, aiPreviewsOn, producibleVariationsV2, type AiAuthorization,
} from './contract';
import {
  batchFailureCode, type AiBatchFailureCode, type AiPreviewOut,
  AI_BATCH_WRITABLE, BATCH_TRANSITIONS, PREVIEW_TRANSITIONS, emptyPreview, planningOutcome, previewCode, previewOf, previewView, sameApproval, aiPhaseOf,
  type BatchEvent, type DbPreviewStatus, type FaceInfo, type PreviewCast, type PreviewEvent, type PreviewPayload,
} from './previews';

const json = (v: unknown) => v as Prisma.InputJsonValue;
/** Orçamento de mídia de 1 vídeo aprovado (o mesmo do fluxo de 04/11): até 90 s de lipsync + 2 rostos + folga. */
export const MEDIA_BUDGET = 90 * SCENE_MODELS.find((m) => m.id === 'pruna-lipsync')!.usdPerSecond + 2 * FACE_MODEL.usdPerImage + 0.2;
const PRODUCTION_STATES = ['FACES_GENERATING', 'SCENES_GENERATING', 'SCRIPTS_WRITING', 'SCRIPTS_FAILED', 'FACES_FAILED', 'SCENES_FAILED'] as const;
type Db = Prisma.TransactionClient | PrismaService;
export interface AiApprovalRecord { requestId: string; previewIds: string[]; credits: number; attempt: number; at: string }
const approvalsOf = (settings: unknown): AiApprovalRecord[] => ((settings as { aiApprovals?: AiApprovalRecord[] } | null)?.aiApprovals ?? []);
const notFound = () => new AppException('NOT_FOUND');
const FAIL_TEXT = {
  plan: 'Could not write at least 2 previews from this offer. Try again.',
  interrupted: 'Preview preparation was interrupted. Try again.',
  planOne: 'Could not write a new angle for this preview. Try again.',
  imaging: 'Could not generate the presenter image. Try again.',
  timeout: 'The presenter image took too long. Try again.',
} as const;

@Injectable()
export class AiPreviewsService {
  private readonly log = new Logger('AiPreviews');
  /** Ligado pelo TemplatesAiService: produção (vídeo) das prévias recém-aprovadas. */
  production: ((itemId: string) => Promise<void>) | null = null;

  constructor(
    private readonly db: PrismaService,
    private readonly jobs: JobsService,
    private readonly costs: CustosService,
    private readonly credits: CreditosService,
    private readonly storage: StorageService,
    @Inject(SEMANTIC_PLANNER) private readonly planner: SemanticPlannerPort,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
  ) {}

  // ───────── contexto ─────────

  private async uiLocaleOf(userId: string | null | undefined, db: Db = this.db): Promise<string> {
    const u = userId ? await db.user.findUnique({ where: { id: userId }, select: { uiLocale: true } }) : null;
    return u?.uiLocale === 'PT_BR' ? 'pt-BR' : 'en';
  }

  private async contextOf(db: Db, batchId: string): Promise<{ ctx: SemanticContextV2; format: AiFormat; uiLocale: string; b: { id: string; workspaceId: string; championId: string; createdById: string | null; status: string; settings: unknown } }> {
    const b = await db.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { champion: { include: { offer: true, teardown: true } } } });
    const a = aiPreviewsOf(b.settings);
    if (!a) throw new Error(`lote ${batchId} não é de prévias`);
    const ctx = semanticContext(b.champion, { championId: b.championId, requestId: a.requestId, focus: 'FORMAT', instructions: '', formatIds: [a.format] });
    return { ctx, format: a.format, uiLocale: await this.uiLocaleOf(b.createdById, db), b };
  }

  // ───────── /use (§5.1): dentro da transação do lote; nenhuma chamada paga, nenhuma reserva ─────────

  async initialize(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, a: AiAuthorization) {
    const b = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { champion: { include: { offer: true, teardown: true } } } });
    if (b.workspaceId !== auth.workspaceId) throw notFound();
    const offer = b.champion.offer;
    const missing = ['what', 'cta'].filter((k) => !offer[k as 'what' | 'cta']?.trim());
    if (missing.length) throw new AppException('OFFER_INCOMPLETE', { fields: missing });
    const format = a.format as AiFormat;
    const ctx = semanticContext(b.champion, { championId: b.championId, requestId: a.requestId, focus: 'FORMAT', instructions: '', formatIds: [format] });
    const req = { format, count: AI_PREVIEW_CANDIDATES, uiLocale: await this.uiLocaleOf(auth.userId, tx) };
    const estimate = this.planner.estimatePreviews(ctx, req) + previewImagesUsd(format, AI_PREVIEW_MAX);
    await this.costs.assertWithinCap(auth.workspaceId, estimate + Number(b.estimatedCostUsd ?? 0));
  }

  // ───────── transições (as únicas escritas de status) ─────────

  private async moveBatch(db: Db, batchId: string, event: BatchEvent, data: Prisma.VariationBatchUpdateManyMutationInput = {}): Promise<boolean> {
    const t = BATCH_TRANSITIONS[event];
    const r = await db.variationBatch.updateMany({ where: { id: batchId, status: { in: t.from } }, data: { ...data, status: t.to } });
    return r.count === 1;
  }

  private async movePreview(db: Db, itemId: string, event: PreviewEvent, data: Prisma.VariationItemUpdateManyMutationInput = {}): Promise<boolean> {
    const t = PREVIEW_TRANSITIONS[event];
    const r = await db.variationItem.updateMany({ where: { id: itemId, previewStatus: { in: t.from } }, data: { ...data, previewStatus: t.to } });
    return r.count === 1;
  }

  private async failPreview(itemId: string, stage: 'planning' | 'imaging', errorCode: string, failReason: string) {
    const i = await this.db.variationItem.findUnique({ where: { id: itemId } });
    if (!i) return;
    const preview = { ...(previewOf(i.payload) ?? emptyPreview()), failStage: stage };
    const ok = await this.movePreview(this.db, itemId, 'FAIL', { errorCode, failReason, status: 'FAILED', payload: json({ ...(i.payload as object), preview }) });
    if (ok) await this.evaluate(i.batchId);
  }

  /** §3.1: fim do planning (≥ 2 READY = PLAN_READY; senão PLAN_FAILED) e planejador inicial que morreu sem itens. */
  async evaluate(batchId: string): Promise<void> {
    const b = await this.db.variationBatch.findUnique({ where: { id: batchId }, include: { items: { where: { previewStatus: { not: null } }, select: { previewStatus: true } } } });
    if (!b || b.status !== 'PLANNING' || !aiPreviewsOf(b.settings)) return;
    const approvals = approvalsOf(b.settings).length;
    if (!b.items.length) {
      const job = await this.initialJob(batchId);
      if (job?.status === 'FAILED' && !approvals) {
        await this.moveBatch(this.db, batchId, 'PLAN_FAILED', { errorCode: job.errorCode ?? 'PROVIDER_ERROR', failReason: job.errorCode === 'INTERRUPTED' ? FAIL_TEXT.interrupted : job.failReason ?? FAIL_TEXT.plan });
      } else if (job?.status === 'QUEUED') {
        void this.jobs.detach(job.id, 'prévias IA', () => this.run(job.id, batchId));
      }
      return;
    }
    const event = planningOutcome({ status: b.status, approvals }, b.items.map((i) => i.previewStatus as DbPreviewStatus));
    if (event === 'PREVIEWS_READY') await this.moveBatch(this.db, batchId, event, { errorCode: null, failReason: null });
    else if (event === 'PLAN_FAILED') await this.moveBatch(this.db, batchId, event, { errorCode: 'PROVIDER_ERROR', failReason: FAIL_TEXT.plan });
  }

  /** O job do planejador inicial (input sem itemId; os de novo ângulo/retry têm itemId). */
  private async initialJob(batchId: string) {
    const jobs = await this.db.job.findMany({ where: { variationBatchId: batchId, type: 'AUTO_PLAN' }, orderBy: { createdAt: 'desc' } });
    return jobs.find((j) => !(j.input as { itemId?: string } | null)?.itemId) ?? null;
  }

  // ───────── planejador inicial (job AUTO_PLAN, kind ai_previews) ─────────

  async run(jobId: string, batchId: string): Promise<void> {
    const claim = await this.db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), stage: 'writing', progress: 20 } });
    if (!claim.count) return; // CAS antes da chamada externa: o mesmo job nunca chama o planejador duas vezes
    try {
      const { ctx, format, uiLocale, b } = await this.contextOf(this.db, batchId);
      if (b.status !== 'PLANNING') throw new Error(`lote ${batchId} em ${b.status}`);
      const plan = await this.planner.planPreviews(ctx, { format, count: AI_PREVIEW_CANDIDATES, uiLocale }, { workspaceId: b.workspaceId, championId: b.championId, jobId, variationBatchId: batchId });
      if (!(await this.stillRunning(jobId))) return; // reinício marcou o job INTERRUPTED durante a chamada: nada a escrever
      const picks = producibleVariationsV2(plan, { format, evidence: evidenceOf(ctx), max: AI_PREVIEW_MAX });
      if (picks.length < AI_PREVIEW_MIN) {
        await this.jobs.finish(jobId, { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: FAIL_TEXT.plan, output: json({ candidates: plan.variations.length, producible: picks.length }) });
        await this.evaluate(batchId);
        return;
      }
      await this.costs.assertWithinCap(b.workspaceId, previewImagesUsd(format, picks.length));
      await this.db.$transaction(async (tx) => {
        if (await tx.variationItem.count({ where: { batchId, previewStatus: { not: null } } })) return; // idempotente
        const used: string[] = [];
        for (const [index, v] of picks.entries()) await this.createPreview(tx, { batchId, workspaceId: b.workspaceId, format, language: ctx.language, index, variation: v, usedVoices: used });
      }, { timeout: 30000 });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: json({ version: plan.version, candidates: plan.variations.length, producible: picks.length, costUsd: plan.costUsd }) });
      await this.advanceBatch(batchId);
    } catch (e) {
      this.log.warn(`prévias ${batchId}: ${(e as Error).message}`);
      const code = isIntegracaoError(e) ? e.code : e instanceof AppException ? e.code : 'PROVIDER_ERROR';
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: FAIL_TEXT.plan });
      await this.evaluate(batchId);
    }
  }

  private async stillRunning(jobId: string) {
    return (await this.db.job.findUnique({ where: { id: jobId }, select: { status: true } }))?.status === 'RUNNING';
  }

  /** Castings + rostos (QUEUED) por falante, voz pelo gênero do rosto sem repetir no lote, item-prévia PLANNED. */
  private async castOf(tx: Prisma.TransactionClient, o: { batchId: string; workspaceId: string; format: AiFormat; language: string; variation: SemanticVariationV2; usedVoices: string[] }): Promise<PreviewCast[]> {
    const cast: PreviewCast[] = [];
    for (const speaker of speakersOf(o.format)) {
      const c = o.variation.cast.find((x) => x.speaker === speaker)!;
      const voice = voiceFor(c.gender, o.language, o.usedVoices);
      o.usedVoices.push(voice.voiceId);
      const casting = await tx.variationCasting.create({ data: { workspaceId: o.workspaceId, batchId: o.batchId, scope: 'ITEM', description: c.description } });
      const face = await tx.face.create({ data: { workspaceId: o.workspaceId, castingId: casting.id, batch: 1, position: 0, description: c.description } });
      cast.push({ speaker, name: c.name, gender: c.gender, description: c.description, voiceId: voice.voiceId, voiceName: voice.voiceName, castingId: casting.id, faceId: face.id });
    }
    return cast;
  }

  private async createPreview(tx: Prisma.TransactionClient, o: { batchId: string; workspaceId: string; format: AiFormat; language: string; index: number; variation: SemanticVariationV2; usedVoices: string[] }) {
    const cast = await this.castOf(tx, o);
    const preview: PreviewPayload = { ...emptyPreview(), variation: o.variation, summary: o.variation.summary, cast };
    await tx.variationItem.create({ data: {
      workspaceId: o.workspaceId, batchId: o.batchId, kind: 'AUTO_EDIT', index: o.index, autoType: 'AI_VIDEO', axis: 'DIVERSITY', code: previewCode(o.format, o.index),
      status: 'READY', included: false, previewStatus: 'PLANNED', change: o.variation.title.slice(0, 90), rationale: o.variation.hypothesis,
      payload: json({ params: { formatId: o.format }, preview }),
    } });
  }

  /** Vozes já usadas no lote (prévias vivas e histórico): o catálogo evita repetir enquanto der. */
  private async voicesOfBatch(db: Db, batchId: string): Promise<string[]> {
    const items = await db.variationItem.findMany({ where: { batchId, previewStatus: { not: null } }, select: { payload: true } });
    return items.flatMap((i) => (previewOf(i.payload)?.cast ?? []).map((c) => c.voiceId));
  }

  /** As variações vivas do lote (ready/approved/imaging), fora `exceptId`: o planOne precisa ser distinto delas. */
  private async liveVariations(db: Db, batchId: string, exceptId: string): Promise<SemanticVariationV2[]> {
    const items = await db.variationItem.findMany({ where: { batchId, id: { not: exceptId }, previewStatus: { in: ['READY', 'APPROVED', 'IMAGING'] } }, select: { payload: true } });
    return items.map((i) => previewOf(i.payload)?.variation).filter((v): v is SemanticVariationV2 => !!v);
  }

  // ───────── novo ângulo / retry de planejamento (job AUTO_PLAN, kind ai_preview_regen|ai_preview_retry) ─────────

  async runOne(jobId: string, batchId: string, itemId: string): Promise<void> {
    const claim = await this.db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), stage: 'writing', progress: 20 } });
    if (!claim.count) return;
    try {
      const { ctx, format, uiLocale, b } = await this.contextOf(this.db, batchId);
      const item = await this.db.variationItem.findUniqueOrThrow({ where: { id: itemId } });
      if (item.previewStatus !== 'PLANNED' || previewOf(item.payload)?.variation) throw new Error(`prévia ${itemId} não espera o planejador`);
      // distinta das vivas do lote E das ideias que esta prévia já teve (novo ângulo = ideia nova, não a anterior de volta)
      const own = (previewOf(item.payload)?.history ?? []).map((h) => h.variation).filter((v): v is SemanticVariationV2 => !!v);
      const live = [...await this.liveVariations(this.db, batchId, itemId), ...own];
      const exclude = live.map((v) => ({ title: v.title, angle: v.angle, cast: v.cast }));
      const plan = await this.planner.planOne(ctx, { format, uiLocale, exclude }, { workspaceId: b.workspaceId, championId: b.championId, jobId, variationBatchId: batchId });
      if (!(await this.stillRunning(jobId))) return;
      const [pick] = producibleVariationsV2(plan, { format, evidence: evidenceOf(ctx), max: 1, accepted: live });
      if (!pick) {
        await this.jobs.finish(jobId, { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: FAIL_TEXT.planOne });
        await this.failPreview(itemId, 'planning', 'PROVIDER_ERROR', FAIL_TEXT.planOne);
        return;
      }
      await this.costs.assertWithinCap(b.workspaceId, previewImagesUsd(format, 1));
      await this.db.$transaction(async (tx) => {
        const fresh = await tx.variationItem.findUniqueOrThrow({ where: { id: itemId } });
        const p = previewOf(fresh.payload) ?? emptyPreview();
        if (fresh.previewStatus !== 'PLANNED' || p.variation) return;
        const cast = await this.castOf(tx, { batchId, workspaceId: b.workspaceId, format, language: ctx.language, variation: pick, usedVoices: await this.voicesOfBatch(tx, batchId) });
        const preview: PreviewPayload = { ...p, variation: pick, summary: pick.summary, cast, failStage: null };
        await tx.variationItem.update({ where: { id: itemId }, data: { payload: json({ ...(fresh.payload as object), preview }), change: pick.title.slice(0, 90), rationale: pick.hypothesis, errorCode: null, failReason: null } });
      }, { timeout: 30000 });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: json({ version: plan.version, candidates: plan.variations.length, costUsd: plan.costUsd }) });
      await this.advanceItem(itemId);
    } catch (e) {
      this.log.warn(`prévia ${itemId}: ${(e as Error).message}`);
      const code = isIntegracaoError(e) ? e.code : e instanceof AppException ? e.code : 'PROVIDER_ERROR';
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: FAIL_TEXT.planOne });
      await this.failPreview(itemId, 'planning', code, FAIL_TEXT.planOne);
    }
  }

  // ───────── avanço por item (§3.3): nenhum passo depende do navegador aberto ─────────

  async advanceBatch(batchId: string): Promise<void> {
    const items = await this.db.variationItem.findMany({ where: { batchId, previewStatus: { in: ['PLANNED', 'IMAGING'] } }, select: { id: true } });
    for (const i of items) await this.advanceItem(i.id).catch((e) => this.log.warn(`prévia ${i.id}: ${(e as Error).message}`));
    await this.evaluate(batchId);
  }

  async advanceItem(itemId: string): Promise<void> {
    let i = await this.db.variationItem.findUnique({ where: { id: itemId }, include: { batch: true } });
    if (!i || !i.previewStatus) return;
    const format = aiPreviewsOf(i.batch.settings)?.format;
    if (!format) return;
    if (i.previewStatus === 'PLANNED') {
      const p = previewOf(i.payload);
      if (!p?.variation) {
        const job = await this.db.job.findFirst({ where: { variationBatchId: i.batchId, type: 'AUTO_PLAN', input: { path: ['itemId'], equals: itemId } }, orderBy: { createdAt: 'desc' } });
        if (!job || job.status === 'FAILED') return this.failPreview(itemId, 'planning', job?.errorCode ?? 'INTERRUPTED', job?.errorCode === 'INTERRUPTED' || !job ? FAIL_TEXT.interrupted : FAIL_TEXT.planOne);
        if (job.status === 'QUEUED') void this.jobs.detach(job.id, 'prévia IA', () => this.runOne(job.id, i!.batchId, itemId));
        return;
      }
      const preview = { ...p, imagingAt: new Date().toISOString() };
      if (!(await this.movePreview(this.db, itemId, 'IMAGES_SUBMITTED', { payload: json({ ...(i.payload as object), preview }) }))) return;
      i = await this.db.variationItem.findUniqueOrThrow({ where: { id: itemId }, include: { batch: true } });
    }
    if (i.previewStatus !== 'IMAGING') return;
    const p = previewOf(i.payload)!;
    for (const c of p.cast) {
      const claim = await this.db.face.updateMany({ where: { id: c.faceId, status: 'QUEUED' }, data: { status: 'GENERATING' } });
      if (!claim.count) continue;
      try {
        await this.gen.submitFace({ workspaceId: i.workspaceId, faceId: c.faceId, description: c.description, language: i.batch.language ?? 'en', aspectRatio: '9:16', framing: previewFaceFraming(format, c.speaker) });
      } catch (e) {
        await this.db.face.update({ where: { id: c.faceId }, data: { status: 'FAILED', errorCode: isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR' } });
      }
    }
    const faces = await this.db.face.findMany({ where: { id: { in: p.cast.map((c) => c.faceId) } } });
    const failed = faces.find((f) => f.status === 'FAILED');
    if (failed) return this.failPreview(itemId, 'imaging', failed.errorCode ?? 'PROVIDER_ERROR', FAIL_TEXT.imaging);
    if (faces.length === p.cast.length && faces.every((f) => f.status === 'READY' && f.fileId)) {
      if (await this.movePreview(this.db, itemId, 'IMAGES_READY', { errorCode: null, failReason: null })) await this.evaluate(i.batchId);
      return;
    }
    const since = p.imagingAt ? Date.parse(p.imagingAt) : i.updatedAt.getTime();
    if (Date.now() - since > AI_PREVIEW_IMAGING_TIMEOUT_MS) return this.failPreview(itemId, 'imaging', 'PROVIDER_TIMEOUT', FAIL_TEXT.timeout);
  }

  // ───────── rotas (§5.3–§5.5) ─────────

  private async batchFor(auth: AuthContext, batchId: string) {
    if (!aiPreviewsOn()) throw notFound();
    const b = await this.db.variationBatch.findFirst({ where: { id: batchId, workspaceId: auth.workspaceId }, include: { champion: { include: { offer: true } } } });
    const a = b ? aiPreviewsOf(b.settings) : null;
    if (!b || !a) throw notFound();
    return { b, a };
  }

  /** §5.3: aprova 1..4 prévias READY (CAS), cria os criativos (rostos já prontos) e reserva o vídeo desta aprovação. */
  async approve(auth: AuthContext, batchId: string, body: ApproveAiPreviewsBody): Promise<string[]> {
    const { b } = await this.batchFor(auth, batchId);
    const offer = b.champion.offer;
    const missing = ['what', 'cta'].filter((k) => !offer[k as 'what' | 'cta']?.trim());
    if (missing.length) throw new AppException('OFFER_INCOMPLETE', { fields: missing });
    const ids = body.previewIds;
    await this.costs.assertWithinCap(auth.workspaceId, MEDIA_BUDGET * ids.length); // 409 SPEND_CAP_EXCEEDED antes de qualquer escrita
    const fresh = await this.credits.withRunLock(batchId, () => this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-previews:${batchId}`}, 0))::text`;
      const batch = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { templateRun: { include: { template: true } } } });
      const approvals = approvalsOf(batch.settings);
      const same = approvals.find((x) => x.requestId === body.requestId);
      if (same) {
        if (!sameApproval(same, { previewIds: ids, credits: body.expectedCredits })) throw new AppException('INVALID_STATE', { state: batch.status, allowed: AI_BATCH_WRITABLE, reason: 'request_conflict' });
        return [] as string[]; // mesma chave, mesmo corpo: devolve o lote atual sem nova reserva
      }
      if (!AI_BATCH_WRITABLE.includes(batch.status as never)) throw new AppException('INVALID_STATE', { state: batch.status, allowed: AI_BATCH_WRITABLE });
      const items = await tx.variationItem.findMany({ where: { id: { in: ids }, batchId, previewStatus: { not: null } } });
      if (items.length !== ids.length) throw notFound();
      const notReady = items.filter((i) => i.previewStatus !== 'READY').map((i) => i.id);
      if (notReady.length) throw new AppException('INVALID_STATE', { state: batch.status, allowed: AI_BATCH_WRITABLE, reason: 'preview_not_ready', previewIds: notReady });
      const now = new Date();
      const hit = await tx.variationItem.updateMany({ where: { id: { in: ids }, previewStatus: { in: PREVIEW_TRANSITIONS.APPROVE.from } }, data: { previewStatus: PREVIEW_TRANSITIONS.APPROVE.to, included: true, approvedAt: now } });
      if (hit.count !== ids.length) throw new AppException('INVALID_STATE', { state: batch.status, allowed: AI_BATCH_WRITABLE, reason: 'preview_not_ready', previewIds: ids });
      const template = batch.templateRun!.template;
      for (const i of items) {
        const p = previewOf(i.payload)!;
        const production = { variation: p.variation!, actors: p.cast.map((c) => ({ speaker: c.speaker, faceId: c.faceId, voiceId: c.voiceId })), generation: 1 };
        await tx.variationItem.update({ where: { id: i.id }, data: { payload: json({ ...(i.payload as object), production }) } });
        await tx.creative.create({ data: {
          workspaceId: batch.workspaceId, offerId: batch.offerId, name: `${template.nameEn} ${i.code?.slice(-1) ?? ''}`.trim(), language: offer.language,
          origin: 'VARIATION', championId: batch.championId, variationBatchId: batchId, variationItemId: i.id, variationKind: 'AUTO_EDIT',
          variationCode: i.code, state: 'FACES_GENERATING', createdById: auth.userId, engine: 'LIPSYNC', engineModel: 'pruna-lipsync', estimatedCostUsd: MEDIA_BUDGET,
          adName: `AI_${i.code ?? 'AI'}_${i.id.slice(-8)}`,
        } });
      }
      const r = await this.credits.reserveOnApprove(tx, batchId, auth, { itemIds: ids, expectedCredits: body.expectedCredits, approvalIndex: approvals.length });
      if (batch.status !== 'LAUNCHED') await this.moveBatch(tx, batchId, 'FIRST_APPROVAL', { launchedAt: batch.launchedAt ?? now, errorCode: null, failReason: null });
      const record: AiApprovalRecord = { requestId: body.requestId, previewIds: ids, credits: r.credits, attempt: r.attempt, at: now.toISOString() };
      await tx.variationBatch.update({ where: { id: batchId }, data: { settings: json({ ...(batch.settings as object), aiApprovals: [...approvals, record] }) } });
      return ids;
    }, { timeout: 30000 }));
    return fresh;
  }

  /** §5.4 "Novo ângulo": READY → PLANNED (sem variação até o planejador responder), conta no teto 3/6. */
  async regenerate(auth: AuthContext, batchId: string, previewId: string, body: RegenerateAiPreviewBody): Promise<AiPreviewOut> {
    const { b, a } = await this.batchFor(auth, batchId);
    const r = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-previews:${batchId}`}, 0))::text`;
      const i = await tx.variationItem.findFirst({ where: { id: previewId, batchId, previewStatus: { not: null } } });
      if (!i) throw notFound();
      const p = previewOf(i.payload) ?? emptyPreview();
      if (p.regens.some((x) => x.requestId === body.requestId)) return { jobId: null };
      const batch = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (!AI_BATCH_WRITABLE.includes(batch.status as never)) throw new AppException('INVALID_STATE', { state: batch.status, allowed: ['READY'] });
      if (i.previewStatus !== 'READY') throw new AppException('INVALID_STATE', { state: i.previewStatus!.toLowerCase(), allowed: ['READY'] });
      if (i.previewRegens >= AI_PREVIEW_REGEN_PER_PREVIEW) throw new AppException('REGEN_LIMIT', { scope: 'preview', used: i.previewRegens, max: AI_PREVIEW_REGEN_PER_PREVIEW });
      const used = (await tx.variationItem.aggregate({ where: { batchId, previewStatus: { not: null } }, _sum: { previewRegens: true } }))._sum.previewRegens ?? 0;
      if (used >= AI_PREVIEW_REGEN_PER_BATCH) throw new AppException('REGEN_LIMIT', { scope: 'batch', used, max: AI_PREVIEW_REGEN_PER_BATCH });
      await this.assertOneBudget(b, a.format as AiFormat, auth);
      const at = new Date().toISOString();
      const preview: PreviewPayload = { ...p, variation: null, summary: null, cast: [], failStage: null, imagingAt: null, history: [...p.history, { variation: p.variation, cast: p.cast, at }], regens: [...p.regens, { requestId: body.requestId, at }] };
      const job = await tx.job.create({ data: { workspaceId: batch.workspaceId, createdById: auth.userId, type: 'AUTO_PLAN', status: 'QUEUED', variationBatchId: batchId, championId: batch.championId, offerId: batch.offerId, input: { batchId, itemId: i.id, kind: 'ai_preview_regen' } } });
      if (!(await this.movePreview(tx, i.id, 'REGENERATE', { previewRegens: { increment: 1 }, errorCode: null, failReason: null, payload: json({ ...(i.payload as object), preview }) }))) {
        throw new AppException('INVALID_STATE', { state: i.previewStatus!.toLowerCase(), allowed: ['READY'] });
      }
      return { jobId: job.id };
    }, { timeout: 30000 });
    if (r.jobId) void this.jobs.detach(r.jobId, 'novo ângulo', () => this.runOne(r.jobId!, batchId, previewId));
    return this.previewById(batchId, previewId);
  }

  /** §5.5 "Try again": FAILED → PLANNED (planning) ou IMAGING (imaging: mesmas descrições, rosto novo = seed nova). Máx. 2. */
  async retry(auth: AuthContext, batchId: string, previewId: string, body: RetryAiPreviewBody): Promise<AiPreviewOut> {
    const { b, a } = await this.batchFor(auth, batchId);
    const r = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-previews:${batchId}`}, 0))::text`;
      const i = await tx.variationItem.findFirst({ where: { id: previewId, batchId, previewStatus: { not: null } } });
      if (!i) throw notFound();
      const p = previewOf(i.payload) ?? emptyPreview();
      if (p.retries.some((x) => x.requestId === body.requestId)) return { jobId: null, imaging: false };
      const batch = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (batch.status === 'PLAN_FAILED' || batch.status === 'ANALYSIS_FAILED') throw new AppException('INVALID_STATE', { state: batch.status, allowed: ['FAILED'] });
      if (i.previewStatus !== 'FAILED') throw new AppException('INVALID_STATE', { state: i.previewStatus!.toLowerCase(), allowed: ['FAILED'] });
      if (i.previewRetries >= AI_PREVIEW_RETRY_PER_PREVIEW) throw new AppException('REGEN_LIMIT', { scope: 'retry', used: i.previewRetries, max: AI_PREVIEW_RETRY_PER_PREVIEW });
      const at = new Date().toISOString();
      const retries = [...p.retries, { requestId: body.requestId, at }];
      const common = { previewRetries: { increment: 1 }, errorCode: null, failReason: null, status: 'READY' as const };
      if (p.failStage === 'imaging' && p.variation && p.cast.length) {
        await this.costs.assertWithinCap(batch.workspaceId, previewImagesUsd(a.format as AiFormat, 1));
        const cast: PreviewCast[] = [];
        for (const c of p.cast) {
          const last = await tx.face.findFirst({ where: { castingId: c.castingId }, orderBy: { batch: 'desc' } });
          const face = await tx.face.create({ data: { workspaceId: batch.workspaceId, castingId: c.castingId, batch: (last?.batch ?? 0) + 1, position: 0, description: c.description } });
          cast.push({ ...c, faceId: face.id });
        }
        const preview: PreviewPayload = { ...p, cast, failStage: null, imagingAt: at, retries };
        if (!(await this.movePreview(tx, i.id, 'RETRY_IMAGING', { ...common, payload: json({ ...(i.payload as object), preview }) }))) throw new AppException('INVALID_STATE', { state: 'failed', allowed: ['FAILED'] });
        return { jobId: null, imaging: true };
      }
      await this.assertOneBudget(b, a.format as AiFormat, auth);
      const preview: PreviewPayload = { ...p, variation: null, summary: null, cast: [], failStage: null, imagingAt: null, history: p.variation ? [...p.history, { variation: p.variation, cast: p.cast, at }] : p.history, retries };
      const job = await tx.job.create({ data: { workspaceId: batch.workspaceId, createdById: auth.userId, type: 'AUTO_PLAN', status: 'QUEUED', variationBatchId: batchId, championId: batch.championId, offerId: batch.offerId, input: { batchId, itemId: i.id, kind: 'ai_preview_retry' } } });
      if (!(await this.movePreview(tx, i.id, 'RETRY_PLANNING', { ...common, payload: json({ ...(i.payload as object), preview }) }))) throw new AppException('INVALID_STATE', { state: 'failed', allowed: ['FAILED'] });
      return { jobId: job.id, imaging: false };
    }, { timeout: 30000 });
    if (r.jobId) void this.jobs.detach(r.jobId, 'retry de prévia', () => this.runOne(r.jobId!, batchId, previewId));
    if (r.imaging) void this.advanceItem(previewId).catch((e) => this.log.warn(`prévia ${previewId}: ${(e as Error).message}`));
    return this.previewById(batchId, previewId);
  }

  private async assertOneBudget(b: { id: string; workspaceId: string }, format: AiFormat, auth: AuthContext) {
    const { ctx, uiLocale } = await this.contextOf(this.db, b.id);
    const live = await this.liveVariations(this.db, b.id, '');
    const est = this.planner.estimateOne(ctx, { format, uiLocale: uiLocale || (await this.uiLocaleOf(auth.userId)), exclude: live.map((v) => ({ title: v.title, angle: v.angle, cast: v.cast })) });
    await this.costs.assertWithinCap(b.workspaceId, est + previewImagesUsd(format, 1));
  }

  // ───────── vista (§5.2/§5.6) ─────────

  async previewById(batchId: string, previewId: string): Promise<AiPreviewOut> {
    const view = await this.view(batchId);
    const p = view?.previews.find((x) => x.id === previewId);
    if (!p) throw notFound();
    return p;
  }

  /** `IterateBatch.ai`. null = lote que não é de prévias (inclui os lotes IA de 04/11). */
  async view(batchId: string): Promise<AiPreviewsView | null> {
    const b = await this.db.variationBatch.findUnique({ where: { id: batchId }, include: { templateRun: { include: { template: true } } } });
    const a = b ? aiPreviewsOf(b.settings) : null;
    if (!b || !a) return null;
    const items = await this.db.variationItem.findMany({
      where: { batchId, previewStatus: { not: null } }, orderBy: { index: 'asc' },
      include: { creative: { select: { state: true, renders: { where: { stale: false }, select: { format: true, status: true, createdAt: true } } } } },
    });
    const faceIds = items.flatMap((i) => (previewOf(i.payload)?.cast ?? []).map((c) => c.faceId));
    const faces = await this.db.face.findMany({ where: { id: { in: faceIds } }, include: { file: true } });
    const info = new Map<string, FaceInfo>();
    for (const f of faces) {
      info.set(f.id, { status: f.status as FaceInfo['status'], image: f.status === 'READY' && f.file ? { fileId: f.file.id, url: await this.storage.signedUrl(f.file), width: f.file.width ?? 1152, height: f.file.height ?? 2048 } : null });
    }
    const videoEach = b.templateRun?.template.credits ?? null;
    const previews = items.map((i) => previewView({ ...i, previewStatus: i.previewStatus as DbPreviewStatus }, info, videoEach));
    const pieces: PieceStatus[] = items.filter((i) => i.previewStatus === 'APPROVED').map((i) => pieceStatus({
      launched: true, leftOutAt: i.leftOutAt, creativeState: i.creative?.state ?? 'FACES_GENERATING',
      renders: (i.creative?.renders ?? []).map((r) => ({ format: r.format, status: r.status as 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED', createdAt: r.createdAt })),
    }));
    const phase = aiPhaseOf(b.status, pieces);
    const planFailed = b.status === 'PLAN_FAILED' || b.status === 'ANALYSIS_FAILED';
    const job = planFailed && !items.length ? await this.initialJob(batchId) : null;
    const answered = items.length > 0 || (job?.output as { producible?: number } | null)?.producible !== undefined;
    return {
      phase, format: a.format as AiFormat, previews,
      generating: previews.filter((p) => p.status === 'planned' || p.status === 'imaging').length,
      approvable: previews.filter((p) => p.status === 'ready').length,
      prices: { videoEach },
      approvals: approvalsOf(b.settings).map(({ requestId, previewIds, credits, at }) => ({ requestId, previewIds, credits, at })),
      limits: { regenPerPreview: AI_PREVIEW_REGEN_PER_PREVIEW, regenPerBatch: AI_PREVIEW_REGEN_PER_BATCH, regenUsed: items.reduce((n, i) => n + i.previewRegens, 0), retryPerPreview: AI_PREVIEW_RETRY_PER_PREVIEW },
      errorCode: planFailed ? b.errorCode ?? 'PROVIDER_ERROR' : null,
      failReason: planFailed ? b.failReason : null,
      failureCode: planFailed ? batchFailureCode(b.errorCode, answered) : null,
    };
  }

  // ───────── sweep (chamado pelo TemplatesAiService) ─────────

  async sweep(): Promise<void> {
    const items = await this.db.variationItem.findMany({ where: { previewStatus: { in: ['PLANNED', 'IMAGING'] } }, select: { id: true }, take: 100 });
    for (const i of items) await this.advanceItem(i.id).catch((e) => this.log.warn(`prévia ${i.id}: ${(e as Error).message}`));
    const planning = (await this.db.variationBatch.findMany({ where: { status: 'PLANNING', mode: 'AUTO' }, select: { id: true, settings: true }, take: 200 })).filter((b) => aiPreviewsOf(b.settings));
    for (const b of planning) await this.evaluate(b.id).catch((e) => this.log.warn(`lote ${b.id}: ${(e as Error).message}`));
  }

  /** IDs das prévias aprovadas com vídeo em produção (o sweep do TemplatesAiService avança cada uma). */
  async approvedInProduction(batchId?: string): Promise<string[]> {
    const items = await this.db.variationItem.findMany({ where: { ...(batchId && { batchId }), previewStatus: 'APPROVED', creative: { archivedAt: null, state: { in: [...PRODUCTION_STATES] } } }, select: { id: true }, take: 50 });
    return items.map((i) => i.id);
  }
}
