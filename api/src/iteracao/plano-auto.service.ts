import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnalysisStage, AutoVariationType } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { failReasonFor, asAsyncErrorCode } from '../common/errors/falhas';
import { CLAUDE_SERVICE, integracoesMode, isIntegracaoError, type AutoPlanDraft, type AutoPlanInput, type ClaudeService } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaService } from '../prisma/prisma.service';
import { BatchStateMachine } from '../variacoes/batch-state-machine';
import { diagnosticarPagina } from '../medicao/pagina-quebrada';
import { flagsOf, planCtxOf } from './contexto';
import { MEDIA_RULES, PAGE_CAPTURE, type MediaRulesPort, type PageCapturePort } from './portas';
import {
  type Violation, allowedFor, allowedFrameIds, buildInsight, fallbackWhy, finalizePlan, partialInsight, repairPlan, rulesFor, swapsFor, validatePlan, violationText,
} from './regras';

/** Etapas do job AUTO_PLAN (JOB_CHECKLIST) e progresso do job. */
export const AUTO_PLAN_STAGES = { checking_brain: 20, planning: 50 } as const;
/** Até 8 frames-chave pro Claude (STATIC e teaser). */
const MAX_PLAN_KEYFRAMES = 8;
const PAGE_TEXT_MAX = 4000;
export const FROM_VIDEO = 'From the video';

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
  ) {}

  async run(jobId: string, batchId: string): Promise<void> {
    let stage: AnalysisStage = 'brain';
    try {
      const b = await this.prisma.variationBatch.findUniqueOrThrow({
        where: { id: batchId },
        include: { offer: true, workspace: true, createdBy: { select: { uiLocale: true } }, champion: { include: { teardown: true } } },
      });
      const teardown = b.champion.teardown;
      if (!teardown || !sectionsOf(teardown.sections)) throw new AutoPlanError('PROVIDER_ERROR', 'brain', 'campeão sem teardown');

      // 1. checking_brain: Brain (oferta/workspace) + captura da página (§7.5; falhou = SPLIT-LP sai, a análise segue)
      await this.jobs.stage(jobId, 'checking_brain', AUTO_PLAN_STAGES.checking_brain);
      const page = await this.capturePage(b);
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { pageCaptureFileId: page.fileId } });
      const ctx = planCtxOf({ offer: b.offer, workspace: b.workspace, champion: b.champion, teardown }, this.media, { captured: !!page.fileId });
      const allowed = allowedFor(ctx);
      const swaps = swapsFor(allowed);
      const flags = flagsOf(ctx);
      // régua parcial (blocos sem função) já na tela durante o plano
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { insight: { ...partialInsight(ctx, flags, swaps), captionsAuto: !!ctx.captionsAuto } as unknown as Prisma.InputJsonValue } });

      // 2. planning: Claude → validação → 1 reparo pela ia → reparo determinístico
      stage = 'planning';
      await this.jobs.stage(jobId, 'planning', AUTO_PLAN_STAGES.planning);
      const m = measurementsOf(teardown.measurements);
      const transcript = transcriptOf(teardown.transcript);
      const keyframes = await this.keyframes(m?.keyframes ?? []);
      const sections = sectionsOf(teardown.sections)!;
      const input: AutoPlanInput = {
        workspaceId: b.workspaceId, batchId: b.id, jobId,
        uiLocale: b.createdBy.uiLocale,
        screenLanguage: b.champion.language || transcript?.language || b.offer.language,
        offer: draftOf(b.offer),
        workspace: { name: b.workspace.name, industry: b.workspace.industry, market: b.workspace.market },
        page: { captured: !!page.fileId, text: page.text ? page.text.slice(0, PAGE_TEXT_MAX) : null },
        teardown: sections, transcript: transcript?.words ?? [],
        media: { durationSec: ctx.durationSec, cuts: m?.cuts?.length ?? 0, silences: ctx.silences, hasWrittenHook: ctx.hasWrittenHook, hasEndCard: ctx.hasEndCard },
        keyframes,
        // headline-e-legenda-v1: HEADLINE no `allowed` (TRANSIÇÃO: fora do AutoVariationType até a fusão) + o que a ia precisa
        allowed: allowed.map((a) => ({ type: a.type, max: a.max })) as unknown as AutoPlanInput['allowed'],
        allowedFrames: allowedFrameIds(ctx),
        rules: rulesFor(allowed),
        ...(ctx.headline && !ctx.headline.blockedReason && {
          headline: { mode: ctx.headline.mode, original: ctx.headline.original, lines: ctx.headline.lines, maxChars: ctx.headline.maxChars, hasHighlight: ctx.headline.hasHighlight, language: ctx.headline.language },
        }),
      };
      const first = await this.plan(input);
      let draft: AutoPlanDraft = first;
      let violations: Violation[] = validatePlan(first, ctx, allowed);
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
        const r = repairPlan(draft, ctx, allowed, fb);
        if (!r.ok) {
          const detail = violations.map((v) => violationText(v, draft.items ?? [])).join('; ').slice(0, 2000);
          throw new AutoPlanError('PLAN_INVALID', 'planning', detail);
        }
        this.log.log(`lote ${b.id}: reparo determinístico tirou ${r.removed.length} peça(s): ${r.removed.map((x) => `${x.type}(${x.rules.join(',')})`).join(' ')}`);
        draft = r.draft;
      }
      const items = finalizePlan(draft, ctx, this.media);
      // §2.1: `captionsAuto` no insight (TRANSIÇÃO: fora do AutoInsight até o arquiteto tipar; o web já lê)
      const insight = { ...buildInsight(draft, ctx, flags, swaps, FROM_VIDEO, items.length), captionsAuto: !!ctx.captionsAuto };

      // 3. PLAN_READY: itens e insight na mesma transação da troca de estado
      await this.prisma.$transaction(async (tx) => {
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        await tx.variationItem.createMany({
          data: items.map((it) => ({
            workspaceId: b.workspaceId, batchId: b.id, kind: 'AUTO_EDIT' as const, index: it.index, status: 'READY' as const,
            rationale: it.rationale, payload: { params: it.params, whyKey: it.whyKey } as unknown as Prisma.InputJsonValue,
            autoType: it.type, code: it.code, axis: it.axis, change: it.change, inZip: true, jobId,
          })),
        });
        await this.sm.transition({
          tx, batchId: b.id, event: 'AUTO_PLAN_DONE', from: 'PLANNING', to: 'PLAN_READY',
          data: { insight: insight as unknown as Prisma.InputJsonValue, errorCode: null, failReason: null, failDetail: null, failStage: null },
        });
      });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { pieces: items.length } });
    } catch (e) {
      const err = e instanceof AutoPlanError ? e : new AutoPlanError(plannerCode(e), stage, (e as Error)?.message?.slice(0, 500) ?? null);
      if (!(e instanceof AutoPlanError) && !isIntegracaoError(e)) this.log.error(`plano do lote ${batchId}: ${(e as Error)?.stack ?? e}`);
      await this.fail(batchId, jobId, err);
    }
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
