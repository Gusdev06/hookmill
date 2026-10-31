import { DEFAULT_ANSWERS, selectPieces } from './selecao';
import type { IterateAnswers } from '@maquina/contratos';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnalysisStage, AutoInsight, AutoVariationType, FrameTemplateId } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { editMapOf, measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { faixasDoCampeao } from '../campeoes/faixas-protegidas';
import { VersaoSemLegendaService, type CleanMismatch } from '../campeoes/versao-sem-legenda';
import { failReasonFor, asAsyncErrorCode } from '../common/errors/falhas';
import { CLAUDE_SERVICE, integracoesMode, isIntegracaoError, type AutoPlanDraft, type AutoPlanInput, type ClaudeService } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaService } from '../prisma/prisma.service';
import { BatchStateMachine } from '../variacoes/batch-state-machine';
import { diagnosticarPagina } from '../medicao/pagina-quebrada';
import { flagsOf, planCtxOf, withCaptionGuard } from './contexto';
import { targetCpaOf, targetCpaText } from '../workspaces/cliente';
import { SAMPLE_BLOCKED_TYPES, capSampleSelection, isSampleSettings } from '../amostra/acesso';
import { MEDIA_RULES, PAGE_CAPTURE, type MediaRulesPort, type PageCapturePort } from './portas';
import {
  type AllowedType, type FinalItem, type PlanCtx, type Violation, allowedFor, allowedFrames, allowedFrameIds, buildInsight, fallbackWhy, finalizePlan, partialInsight, repairPlan, rulesFor, swapsFor, validatePlan, violationText,
} from './regras';

/** Etapas do job AUTO_PLAN (JOB_CHECKLIST) e progresso do job. */
export const AUTO_PLAN_STAGES = { checking_brain: 20, planning: 50 } as const;
/** Até 8 frames-chave pro Claude (STATIC e teaser). */
const MAX_PLAN_KEYFRAMES = 8;
const PAGE_TEXT_MAX = 4000;
export const FROM_VIDEO = 'From the video';

const PLAN_BATCH_INCLUDE = {
  offer: true, workspace: true, createdBy: { select: { uiLocale: true } },
  champion: { include: { teardown: true, videoFile: { select: { width: true, height: true } } } },
} satisfies Prisma.VariationBatchInclude;
type PlanBatch = Prisma.VariationBatchGetPayload<{ include: typeof PLAN_BATCH_INCLUDE }>;

/** 29/10 (legenda-protegida-v1 §8): formato bloqueado pela legenda que a pessoa pode pôr de volta ("Gerar mesmo assim"). */
export interface CaptionForceTarget { type: AutoVariationType; template: FrameTemplateId | null }
const sameTarget = (a: CaptionForceTarget, b: CaptionForceTarget) => a.type === b.type && (a.template ?? null) === (b.template ?? null);
const targetOfFinal = (it: Pick<FinalItem, 'type' | 'params'>): CaptionForceTarget =>
  ({ type: it.type, template: it.type === 'FRAME' ? ((it.params as { template?: FrameTemplateId }).template ?? null) : null });

/**
 * §8: peças que o Claude planejou e a guarda da legenda tirou (validação, reparo ou checagem final), já finalizadas. Ficam
 * em `variation_batches.settings.captionCandidates` (JSON, sem migração): o "Gerar mesmo assim" reusa sem chamar o Claude.
 */
export function captionCandidatesOf(settings: unknown): FinalItem[] {
  const c = (settings as { captionCandidates?: unknown } | null)?.captionCandidates;
  return Array.isArray(c) ? (c as FinalItem[]).filter((x) => !!x && typeof x === 'object' && !!x.type && !!x.params) : [];
}
export function captionCandidateFor(settings: unknown, t: CaptionForceTarget): FinalItem | null {
  return captionCandidatesOf(settings).find((c) => sameTarget(targetOfFinal(c), t)) ?? null;
}

/** `insight.headlineBlocked` (TRANSIÇÃO, fora do AutoInsight até o arquiteto tipar): motivo e modo do HEADLINE fora do plano. */
export function headlineBlockedOf(ctx: { headline?: { blockedReason: string | null; mode: string } | null }): { reason: string; mode: string } | null {
  return ctx.headline?.blockedReason ? { reason: ctx.headline.blockedReason, mode: ctx.headline.mode } : null;
}

type CaptionBlockedEntry = { type: AutoVariationType; template: FrameTemplateId | null };
const frameTemplateOfDraft = (it: unknown): FrameTemplateId | null => ((it as { params?: { template?: FrameTemplateId } } | null)?.params?.template ?? null);

/**
 * legenda-protegida-v1 §2.3: `insight.captionBlocked` = tipos e molduras que o plano não ofereceu (ou o reparo tirou) por
 * tampar a legenda queimada. Vazio = o campo nem vai (lote sem legenda queimada).
 */
export function captionBlockedOf(ctx: PlanCtx, allowed: AllowedType[], removed: CaptionBlockedEntry[] = []): { captionBlocked?: AutoInsight['captionBlocked'] } {
  const out: CaptionBlockedEntry[] = [
    ...allowed.filter((a) => a.blockedReason === 'burned_captions').map((a) => ({ type: a.type, template: null })),
    ...allowedFrames(ctx).filter((f) => f.blockedReason === 'burned_captions').map((f) => ({ type: 'FRAME' as const, template: f.template })),
  ];
  for (const r of removed) if (!out.some((o) => o.type === r.type && o.template === r.template)) out.push(r);
  return out.length ? { captionBlocked: out.map((o) => ({ ...o, reason: 'burned_captions' as const })) } : {};
}

/** Frase humana dos códigos assíncronos do lote AUTO (fallback EN; o web traduz pelo code). */
const REASON: Record<string, string> = {
  PLAN_INVALID: 'The plan did not pass the rules, even after a fix. Try again.',
  MEDIA_TOO_SHORT: 'The video is too short to vary. Upload another one.',
  SOURCE_UNAVAILABLE: 'The original video is no longer available.',
  PAGE_TIMEOUT: 'The page took too long to load.',
};
export function autoFailReason(code: string): string {
  return REASON[code] ?? failReasonFor(asAsyncErrorCode(code));
}

/** Falha do lote com o código assíncrono do contrato (§5.3). */
export class AutoPlanError extends Error {
  constructor(readonly code: string, readonly stage: AnalysisStage, readonly detail: string | null = null) {
    super(code);
    this.name = 'AutoPlanError';
  }
}

const PLANNER_CODES = ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'RATE_LIMITED'] as const;
const plannerCode = (e: unknown) => {
  const c = isIntegracaoError(e) ? e.code : null;
  return (PLANNER_CODES as readonly string[]).includes(c ?? '') ? c! : 'PROVIDER_ERROR';
};

/**
 * Job AUTO_PLAN (variacao-auto-v1 §3.1, §6.3): checking_brain (Brain + captura da página) → planning (Claude →
 * validação → 1 chamada de reparo → reparo determinístico) → PLAN_READY com os itens. Nunca lança: falha = ANALYSIS_FAILED.
 */
@Injectable()
export class PlanoAutoService {
  private readonly log = new Logger('Iteracao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly sm: BatchStateMachine,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    @Inject(PAGE_CAPTURE) private readonly pages: PageCapturePort,
    @Inject(MEDIA_RULES) private readonly media: MediaRulesPort,
    private readonly semLegenda: VersaoSemLegendaService,
  ) {}

  async run(jobId: string, batchId: string): Promise<void> {
    let stage: AnalysisStage = 'brain';
    try {
      const cleanVersion = await this.applyCleanVersion(batchId);
      const b = await this.prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: PLAN_BATCH_INCLUDE });
      const teardown = b.champion.teardown;
      if (!teardown || !sectionsOf(teardown.sections)) throw new AutoPlanError('PROVIDER_ERROR', 'brain', 'campeão sem teardown');

      // 1. checking_brain: Brain (oferta/workspace) + captura da página (§7.5; falhou = SPLIT-LP sai, a análise segue)
      await this.jobs.stage(jobId, 'checking_brain', AUTO_PLAN_STAGES.checking_brain);
      const page = await this.capturePage(b);
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { pageCaptureFileId: page.fileId } });
      // legenda-protegida-v1: o que tamparia a legenda queimada sai do `allowed` (burned_captions), e a validação repete
      const ctx = this.guardedCtx(b, !!page.fileId);
      ctx.candidatePlan = true;
      // amostra-gratis-v1 §2: só tipos grátis (sem STATIC; IA nem entra no allowedFor) e os templates grátis CHAT_DM e
      // PERSON_MOTION entram mesmo com ITERATE_TEMPLATES desligado (a flag é do lote normal; a amostra decide por ela)
      const sample = isSampleSettings(b.settings);
      if (sample && ctx.templates) ctx.templates = { ...ctx.templates, enabled: true };
      const allowed = sample ? allowedFor(ctx).filter((a) => !SAMPLE_BLOCKED_TYPES.includes(a.type)) : allowedFor(ctx);
      const swaps = swapsFor(allowed);
      const flags = flagsOf(ctx);
      // régua parcial (blocos sem função) já na tela durante o plano
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { insight: { ...partialInsight(ctx, flags, swaps), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...captionBlockedOf(ctx, allowed), ...(cleanVersion && { cleanVersion }) } as unknown as Prisma.InputJsonValue } });

      // 2. planning: Claude → validação → 1 reparo pela ia → reparo determinístico
      stage = 'planning';
      await this.jobs.stage(jobId, 'planning', AUTO_PLAN_STAGES.planning);
      const sections = sectionsOf(teardown.sections)!;
      const input = await this.planInput(b, ctx, allowed, jobId, { captured: !!page.fileId, text: page.text });
      const first = await this.plan(input);
      let draft: AutoPlanDraft = first;
      let violations: Violation[] = validatePlan(first, ctx, allowed);
      let removedByCaption: CaptionBlockedEntry[] = [];
      let rDraftItems: unknown[] = [];
      // §8 (29/10): o que a guarda tirou, finalizado, pro "Gerar mesmo assim" sem nova chamada
      const captionCandidates: FinalItem[] = [];
      if (violations.length) {
        // 1 nova chamada com as violações (a ia corrige); se ela mesma falhar, o reparo determinístico parte da 1ª
        const second = await this.plan({ ...input, violations: violations.map((v) => violationText(v, first.items ?? [])) }).catch((e) => {
          this.log.warn(`lote ${b.id}: chamada de reparo falhou (${plannerCode(e)}); reparo determinístico na 1ª`);
          return null;
        });
        if (second) draft = second;
        violations = validatePlan(draft, ctx, allowed);
      }
      if (violations.length) {
        const fb = {
          why: fallbackWhy({
            hookSpoken: sections.hook?.status === 'ok' ? sections.hook.data?.spoken ?? null : null,
            proof: sections.offerProofCta?.status === 'ok' ? sections.offerProofCta.data?.proof ?? null : null,
            cta: ctx.spokenCta,
          }, FROM_VIDEO),
          kept: ctx.blocks.slice(0, 1).map((x) => ({ label: x.label, blockIndex: x.index })).concat(ctx.blocks.slice(-1).map((x) => ({ label: x.label, blockIndex: x.index }))),
        };
        rDraftItems = (draft.items ?? []) as unknown[];
        const r = repairPlan(draft, ctx, allowed, fb);
        if (!r.ok && !(ctx.caption?.bands.length && r.draft.items.length > 0)) {
          const detail = violations.map((v) => violationText(v, draft.items ?? [])).join('; ').slice(0, 2000);
          throw new AutoPlanError('PLAN_INVALID', 'planning', detail);
        }
        this.log.log(`lote ${b.id}: reparo determinístico tirou ${r.removed.length} peça(s): ${r.removed.map((x) => `${x.type}(${x.rules.join(',')})`).join(' ')}`);
        draft = r.draft;
        removedByCaption = r.removed.filter((x) => x.rules.includes('burned_captions')).map((x) => ({ type: x.type, template: frameTemplateOfDraft(rDraftItems[x.index]) }));
        for (const x of r.removed) {
          // só a peça que caiu APENAS pela legenda serve de candidata (outra violação = defeito próprio)
          if (x.rules.length !== 1 || x.rules[0] !== 'burned_captions' || !rDraftItems[x.index]) continue;
          try {
            const [fin] = finalizePlan({ ...draft, items: [rDraftItems[x.index]] as AutoPlanDraft['items'] }, ctx, this.media);
            if (fin) captionCandidates.push(fin);
          } catch (e) {
            this.log.warn(`lote ${b.id}: candidata ${x.type} da legenda não finalizou (${(e as Error).message})`);
          }
        }
      }
      const finalized = finalizePlan(draft, ctx, this.media);
      // Check the final payload too: snapped cuts and finalized layout are what the render queue will receive.
      const items = finalized.filter((it) => {
        if (!ctx.caption?.check({ type: it.type, params: it.params as unknown as Record<string, unknown> })) return true;
        removedByCaption.push({ type: it.type, template: it.type === 'FRAME' ? (it.params as { template: FrameTemplateId }).template : null });
        captionCandidates.push(it);
        return false;
      });
      if (!items.length) throw new AutoPlanError('PLAN_INVALID', 'planning', 'No compatible pieces remain after caption validation');
      // §2.1: `captionsAuto` no insight (TRANSIÇÃO: fora do AutoInsight até o arquiteto tipar; o web já lê)
      // 26/10: por que o HEADLINE ficou fora (o web mostra); null = entrou ou o campeão não tem dado pra ele
      const insight = { ...buildInsight(draft, ctx, flags, swaps, FROM_VIDEO, items.length), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...captionBlockedOf(ctx, allowed, removedByCaption), ...(cleanVersion && { cleanVersion }) };

      // 3. PLAN_READY: itens e insight na mesma transação da troca de estado
      await this.prisma.$transaction(async (tx) => {
        const prev = await tx.variationBatch.findUniqueOrThrow({ where: { id: b.id }, select: { settings: true } });
        const { captionCandidates: _old, ...rest } = (prev.settings ?? {}) as Record<string, unknown>;
        const settings = captionCandidates.length ? { ...rest, captionCandidates } : rest;
        const locked = await tx.variationBatch.update({ where: { id: b.id }, data: { updatedAt: new Date(), settings: settings as unknown as Prisma.InputJsonValue } });
        const result = selectPieces(items.map((it) => ({ ...it, autoType: it.type })), (locked.answers as unknown as IterateAnswers | null) ?? DEFAULT_ANSWERS);
        // §2: amostra = no máximo 4 peças selecionadas
        const selected = sample ? capSampleSelection(result.selected) : result.selected;
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        await tx.variationItem.createMany({
          data: selected.map(({ item: it, included, wantKey, selection }) => ({
            included, wantKey, selection, priority: it.index,
            workspaceId: b.workspaceId, batchId: b.id, kind: 'AUTO_EDIT' as const, index: it.index, status: 'READY' as const,
            rationale: it.rationale, payload: { params: it.params, whyKey: it.whyKey } as unknown as Prisma.InputJsonValue,
            autoType: it.type, code: it.code, axis: it.axis, change: it.change, inZip: true, jobId,
          })),
        });
        await this.sm.transition({
          tx, batchId: b.id, event: 'AUTO_PLAN_DONE', from: 'PLANNING', to: 'PLAN_READY',
          data: { insight: insight as unknown as Prisma.InputJsonValue, errorCode: null, failReason: null, failDetail: null, failStage: null },
        });
      }, { timeout: 30_000 });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { pieces: items.length } });
    } catch (e) {
      const err = e instanceof AutoPlanError ? e : new AutoPlanError(plannerCode(e), stage, (e as Error)?.message?.slice(0, 500) ?? null);
      if (!(e instanceof AutoPlanError) && !isIntegracaoError(e)) this.log.error(`plano do lote ${batchId}: ${(e as Error)?.stack ?? e}`);
      await this.fail(batchId, jobId, err);
    }
  }

  /** Contexto das regras com a guarda da legenda (o mesmo do plano). */
  private guardedCtx(b: PlanBatch, captured: boolean): PlanCtx {
    const ctxSrc = { offer: b.offer, workspace: b.workspace, champion: b.champion, teardown: b.champion.teardown };
    return withCaptionGuard(planCtxOf(ctxSrc, this.media, { captured }), { ...ctxSrc, video: b.champion.videoFile, language: b.language });
  }

  /** Entrada do planAutoBatch (o mesmo pedido do plano do lote; `allowed`/regras decidem o que pode sair). */
  private async planInput(b: PlanBatch, ctx: PlanCtx, allowed: AllowedType[], jobId: string, page: { captured: boolean; text: string | null }): Promise<AutoPlanInput> {
    const teardown = b.champion.teardown!;
    const m = measurementsOf(teardown.measurements);
    const transcript = transcriptOf(teardown.transcript);
    return {
      workspaceId: b.workspaceId, batchId: b.id, jobId,
      uiLocale: b.createdBy.uiLocale,
      screenLanguage: b.champion.language || transcript?.language || b.offer.language,
      offer: draftOf(b.offer),
      workspace: { name: b.workspace.name, industry: b.workspace.industry, market: b.workspace.market, targetCpa: targetCpaText(targetCpaOf(b.workspace)) },
      page: { captured: page.captured, text: page.text ? page.text.slice(0, PAGE_TEXT_MAX) : null },
      teardown: sectionsOf(teardown.sections)!, transcript: transcript?.words ?? [],
      media: { durationSec: ctx.durationSec, cuts: m?.cuts?.length ?? 0, silences: ctx.silences, hasWrittenHook: ctx.hasWrittenHook, hasEndCard: ctx.hasEndCard },
      keyframes: await this.keyframes(m?.keyframes ?? []),
      // headline-e-legenda-v1: HEADLINE no `allowed` (TRANSIÇÃO: fora do AutoVariationType até a fusão) + o que a ia precisa
      allowed: allowed.map((a) => ({ type: a.type, max: a.max })) as unknown as AutoPlanInput['allowed'],
      allowedFrames: allowedFrameIds(ctx),
      rules: rulesFor(allowed, true),
      ...(ctx.headline && !ctx.headline.blockedReason && {
        headline: { mode: ctx.headline.mode, original: ctx.headline.original, lines: ctx.headline.lines, maxChars: ctx.headline.maxChars, hasHighlight: ctx.headline.hasHighlight, language: ctx.headline.language },
      }),
    };
  }

  /**
   * legenda-protegida-v1 §8 (29/10), "Gerar mesmo assim" sem candidata guardada (o Claude nem planejou o formato porque o
   * `allowed` já o tirava): 1 chamada do planAutoBatch só com esse tipo (máx. 1; FRAME só com esse template), SEM a guarda
   * da legenda (a pessoa aceitou cobrir). Custo gravado no lote (cost_entry LLM, job AUTO_PLAN próprio). Não muda o estado
   * do lote. null = o Claude não devolveu uma peça válida desse formato (ou outra regra, que não a legenda, o tira).
   */
  async planForced(batchId: string, t: CaptionForceTarget, userId: string): Promise<{ item: FinalItem; jobId: string } | null> {
    const b = await this.prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: PLAN_BATCH_INCLUDE });
    if (!b.champion.teardown || !sectionsOf(b.champion.teardown.sections)) return null;
    const ctx: PlanCtx = { ...this.guardedCtx(b, !!b.pageCaptureFileId), caption: null };
    const own = allowedFor(ctx).find((a) => a.type === t.type);
    if (!own || own.max <= 0) return null;
    if (t.type === 'FRAME' && (!t.template || !allowedFrameIds(ctx).includes(t.template))) return null;
    const allowed: AllowedType[] = [{ ...own, max: 1 }];
    const job = await this.prisma.job.create({
      data: { workspaceId: b.workspaceId, type: 'AUTO_PLAN', status: 'RUNNING', stage: 'planning', startedAt: new Date(), input: { batchId, captionForce: { type: t.type, template: t.template } } as unknown as Prisma.InputJsonValue, variationBatchId: b.id, championId: b.championId, offerId: b.offerId, createdById: userId },
    });
    try {
      // a página não é recapturada (o texto não fica guardado); o Brain e a transcrição seguem iguais
      const input = await this.planInput(b, ctx, allowed, job.id, { captured: !!b.pageCaptureFileId, text: null });
      const draft = await this.plan({ ...input, ...(t.template && { allowedFrames: [t.template] }), rules: { min: 1, max: 1, minDiversityPct: 0 } });
      for (const it of draft.items ?? []) {
        if (it.type !== t.type) continue;
        const one: AutoPlanDraft = { ...draft, items: [it] };
        if (t.type === 'FRAME' && frameTemplateOfDraft(it) !== t.template) continue;
        if (validatePlan(one, ctx, allowed).some((v) => v.item !== null)) continue;
        const [fin] = finalizePlan(one, ctx, this.media);
        if (!fin) continue;
        await this.jobs.finish(job.id, { status: 'SUCCEEDED', output: { pieces: 1 } });
        return { item: fin, jobId: job.id };
      }
      await this.jobs.finish(job.id, { status: 'FAILED', errorCode: 'PLAN_INVALID', failReason: autoFailReason('PLAN_INVALID') });
      return null;
    } catch (e) {
      const code = plannerCode(e);
      await this.jobs.finish(job.id, { status: 'FAILED', errorCode: code, failReason: autoFailReason(code) }).catch(() => undefined);
      throw e;
    }
  }

  /**
   * legenda-protegida-v1 D-LP5: `cleanUploadId` do `POST /iterate` (em `settings.cleanFileId`) conferido agora que a análise
   * acabou (a faixa protegida existe). Bateu = vira a versão sem legenda do campeão; não bateu = segue com a original. Sai do
   * settings nos dois casos (o replan não confere de novo). null = não havia.
   */
  private async applyCleanVersion(batchId: string): Promise<{ status: 'applied' | 'mismatch'; reason: CleanMismatch | null } | null> {
    const b = await this.prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, select: { settings: true, champion: { include: { videoFile: true, teardown: { select: { editMap: true } } } } } });
    const settings = (b.settings ?? {}) as Record<string, unknown>;
    const fileId = typeof settings.cleanFileId === 'string' ? settings.cleanFileId : null;
    if (!fileId) return null;
    const { cleanFileId: _c, ...rest } = settings;
    await this.prisma.variationBatch.update({ where: { id: batchId }, data: { settings: rest as Prisma.InputJsonValue } });
    const ch = b.champion;
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || !ch.videoFile) return { status: 'mismatch', reason: null };
    try {
      const m = editMapOf(ch.teardown?.editMap);
      await this.semLegenda.assertSameVideo(ch.videoFile, file, faixasDoCampeao(m, { width: ch.videoFile.width ?? m?.width ?? 0, height: ch.videoFile.height ?? m?.height ?? 0 }));
    } catch (e) {
      const reason = (e as { details?: { reason?: CleanMismatch } })?.details?.reason ?? null; // AppException CLEAN_VERSION_MISMATCH
      this.log.warn(`lote ${batchId}: versão sem legenda não conferiu (${reason ?? (e as Error).message})`);
      return { status: 'mismatch', reason };
    }
    await this.prisma.$transaction([
      this.prisma.file.update({ where: { id: file.id }, data: { kind: 'CHAMPION_CLEAN_VIDEO' } }),
      this.prisma.champion.update({ where: { id: ch.id }, data: { cleanVideoFileId: file.id } }),
    ]);
    return { status: 'applied', reason: null };
  }

  /** planAutoBatch com 1 nova tentativa se a chamada falhar ("Claude falhou 2x" = falha do lote). */
  private async plan(input: Parameters<ClaudeService['planAutoBatch']>[0]): Promise<AutoPlanDraft> {
    try {
      return await this.claude.planAutoBatch(input, () => undefined);
    } catch (e) {
      this.log.warn(`planAutoBatch falhou (${plannerCode(e)}), nova tentativa`);
      return this.claude.planAutoBatch(input, () => undefined);
    }
  }

  /** Lote PLANNING/ANALYZING → ANALYSIS_FAILED (CAS; já mudou = nada) + job FAILED. */
  async fail(batchId: string, jobId: string | null, err: AutoPlanError): Promise<void> {
    await this.sm
      .transition({
        batchId, event: 'AUTO_FAILED', to: 'ANALYSIS_FAILED',
        data: { errorCode: err.code, failReason: autoFailReason(err.code), failDetail: err.detail, failStage: err.stage },
      })
      .catch(() => undefined);
    if (jobId) {
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: err.code, failReason: autoFailReason(err.code) }).catch(() => undefined);
    }
  }

  /** §7.5: página da oferta (senão o site do workspace). Gatilho de QA `[mock:page-403]` nas notes da oferta (só mock). */
  private async capturePage(b: { workspaceId: string; offer: { sourceUrl: string | null; notes: string | null }; workspace: { websiteUrl: string | null } }): Promise<{ fileId: string | null; text: string | null }> {
    const url = b.offer.sourceUrl || b.workspace.websiteUrl;
    if (!url) return { fileId: null, text: null };
    if (integracoesMode() === 'mock' && b.offer.notes?.includes('[mock:page-403]')) return { fileId: null, text: null };
    try {
      const r = await this.pages.capture({ workspaceId: b.workspaceId, url });
      if ('fileId' in r) {
        // bug 25/10: defesa se a captura vier de outro adaptador sem o diagnóstico (texto de erro do Next/Vercel/Cloudflare)
        const d = diagnosticarPagina({ title: '', text: r.text, imagens: 1 });
        if (d.ok) return { fileId: r.fileId, text: r.text };
        this.log.warn(`captura da página descartada (${d.motivo}: ${d.detalhe}): SPLIT-LP e referência do STATIC sem ela`);
        return { fileId: null, text: null };
      }
      this.log.warn(`captura da página falhou (${r.error} ${r.status ?? ''}): SPLIT-LP sai do plano`);
    } catch (e) {
      this.log.warn(`captura da página falhou: ${(e as Error).message}`);
    }
    return { fileId: null, text: null };
  }

  private async keyframes(kfs: { atSec: number; reason: string; fileId: string }[]): Promise<{ atSec: number; reason: string; url: string }[]> {
    const step = Math.max(1, Math.ceil(kfs.length / MAX_PLAN_KEYFRAMES));
    const pick = kfs.filter((_, i) => i % step === 0).slice(0, MAX_PLAN_KEYFRAMES);
    const files = await this.prisma.file.findMany({ where: { id: { in: pick.map((k) => k.fileId) } } });
    const byId = new Map(files.map((f) => [f.id, f]));
    const out: { atSec: number; reason: string; url: string }[] = [];
    for (const k of pick) {
      const f = byId.get(k.fileId);
      if (f) out.push({ atSec: k.atSec, reason: k.reason, url: await this.storage.signedUrl(f) });
    }
    return out;
  }
}
