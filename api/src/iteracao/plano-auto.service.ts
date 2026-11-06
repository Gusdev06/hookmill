import { BRAND_LOGO_INCLUDE } from '../brand-kit/logo';
import { DEFAULT_ANSWERS, selectPieces } from './selecao';
import type { IterateAnswers } from '@maquina/contratos';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnalysisStage, AutoInsight, AutoVariationType, FrameTemplateId, ListTemplateId } from '@maquina/contratos';
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
import { templateSettingsOf } from '../creditos/creditos.service';
import { batchFitOf, captionBlockedForTemplate, keysOf, pieceKeyOf, restrictToTemplate, templateFitOf } from './templates-lote';
import type { TemplateFit } from '@maquina/contratos';
import { WANT_OF } from './selecao';
import {
  type AllowedType, type PlanCtx, type Violation, allowedFor, pickedMissing, listCtxOf, listTemplatesOf, endcardVariants, templateOnlyTypesOf, allowedFrames, allowedFrameIds, buildInsight, fallbackWhy, finalizePlan, partialInsight, repairPlan, rulesFor, swapsFor, validatePlan, violationText,
} from './regras';

/** Etapas do job AUTO_PLAN (JOB_CHECKLIST) e progresso do job. */
export const AUTO_PLAN_STAGES = { checking_brain: 20, planning: 50 } as const;
/** Até 8 frames-chave pro Claude (STATIC e teaser). */
const MAX_PLAN_KEYFRAMES = 8;
const PAGE_TEXT_MAX = 4000;
export const FROM_VIDEO = 'From the video';

const PLAN_BATCH_INCLUDE = {
  offer: true, workspace: { include: { brandAssets: BRAND_LOGO_INCLUDE } }, createdBy: { select: { uiLocale: true } },
  champion: { include: { teardown: true, videoFile: { select: { width: true, height: true } } } },
} satisfies Prisma.VariationBatchInclude;
type PlanBatch = Prisma.VariationBatchGetPayload<{ include: typeof PLAN_BATCH_INCLUDE }>;

const listTemplateOf = (params: unknown): ListTemplateId | null => ((params as { templateId?: ListTemplateId } | null)?.templateId ?? null);
/** `insight.headlineBlocked` (TRANSIÇÃO, fora do AutoInsight até o arquiteto tipar): motivo e modo do HEADLINE fora do plano. */
export function headlineBlockedOf(ctx: { headline?: { blockedReason: string | null; mode: string } | null }): { reason: string; mode: string } | null {
  return ctx.headline?.blockedReason ? { reason: ctx.headline.blockedReason, mode: ctx.headline.mode } : null;
}

type CaptionBlockedEntry = { type: AutoVariationType; template: FrameTemplateId | null; listTemplate?: ListTemplateId };
const frameTemplateOfDraft = (it: unknown): FrameTemplateId | null => ((it as { params?: { template?: FrameTemplateId } } | null)?.params?.template ?? null);

/**
 * legenda-protegida-v1 §2.3: `insight.captionBlocked` = tipos e molduras que o plano não ofereceu (ou o reparo tirou) por
 * tampar a legenda queimada. Vazio = o campo nem vai (lote sem legenda queimada).
 */
export function captionBlockedOf(ctx: PlanCtx, allowed: AllowedType[], removed: CaptionBlockedEntry[] = []): { captionBlocked?: AutoInsight['captionBlocked'] } {
  const out: CaptionBlockedEntry[] = [
    ...allowed.filter((a) => a.blockedReason === 'burned_captions').map((a): CaptionBlockedEntry => ({ type: a.type, template: null, ...(a.templateId && { listTemplate: a.templateId }) })),
    ...allowedFrames(ctx).filter((f) => f.blockedReason === 'burned_captions').map((f) => ({ type: 'FRAME' as const, template: f.template })),
  ];
  for (const r of removed) if (!out.some((o) => o.type === r.type && o.template === r.template && o.listTemplate === r.listTemplate)) out.push(r);
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
      // templates-creditos-v1 §2: lote de template = só as chaves do template (o `use` já conferiu a disponibilidade)
      const tpl = templateSettingsOf(b.settings);
      if ((sample || tpl?.keys.some((k) => k === 'CHAT_DM' || k === 'PERSON_MOTION')) && ctx.templates) ctx.templates = { ...ctx.templates, enabled: true };
      const base = sample ? allowedFor(ctx).filter((a) => !SAMPLE_BLOCKED_TYPES.includes(a.type)) : allowedFor(ctx);
      const restricted = tpl ? restrictToTemplate(ctx, base, tpl) : null;
      const allowed = restricted ? restricted.allowed : base;
      // templates-multi-v1 §4.2-4.3: seleção = fit de cada marcado (as regras do template único) e o do lote pela regra do
      // pack (ok se algum cabe; nenhum = o do 1º marcado). `picked` = as chaves dos marcados que cabem.
      const sel = tpl?.selection ? await this.selectionFits(ctx, tpl) : null;
      const fit = !tpl ? null : sel && !allowed.some((a) => a.max > 0) ? sel.first : batchFitOf(allowed, tpl.pack || !!tpl.selection);
      const sumMax = Math.max(1, allowed.reduce((n, a) => n + a.max, 0));
      // template único: 1..Σmax peças (o piso 4 e o teto 12 são do lote auto); o pack segue as regras do lote auto. Seleção: o
      // piso da VALIDAÇÃO é 1 (marcado que o plano não fez vira `not_planned`, não reprova); o pedido à ia leva o nº de marcados.
      if (tpl && !tpl.pack) ctx.planRules = { min: 1, max: sumMax };
      // troca-texto-queimado-v1 §15.3: lote de template com a guarda ligada; a lista só traz as chaves dele
      const blockedOf = (x: { captionBlocked?: AutoInsight['captionBlocked'] }) => {
        if (!tpl) return x;
        const captionBlocked = captionBlockedForTemplate(x.captionBlocked, tpl.keys);
        return captionBlocked.length ? { captionBlocked } : {};
      };
      const swaps = swapsFor(allowed);
      const flags = flagsOf(ctx);
      // régua parcial (blocos sem função) já na tela durante o plano
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { insight: { ...partialInsight(ctx, flags, swaps), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...blockedOf(captionBlockedOf(ctx, allowed)), ...(cleanVersion && { cleanVersion }) } as unknown as Prisma.InputJsonValue } });
      // template que não cabe (legenda queimada ou motivo duro): plano pronto SEM peça e sem chamar o Claude; o fit diz por quê
      if (tpl && !allowed.some((a) => a.max > 0)) {
        await this.readyEmpty(b.id, jobId, { ...partialInsight(ctx, flags, swaps), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...blockedOf(captionBlockedOf(ctx, allowed)), ...(cleanVersion && { cleanVersion }) }, fit!, sel?.fits);
        return;
      }

      // 2. planning: Claude → validação → 1 reparo pela ia → reparo determinístico
      stage = 'planning';
      await this.jobs.stage(jobId, 'planning', AUTO_PLAN_STAGES.planning);
      const sections = sectionsOf(teardown.sections)!;
      const input0 = await this.planInput(b, ctx, allowed, jobId, { captured: !!page.fileId, text: page.text });
      // template único: 1..Σmax peças, sem regra de diversidade; molduras só as do template
      const input: AutoPlanInput = !tpl ? input0 : {
        ...input0, allowedFrames: restricted!.frames,
        ...(!tpl.pack && !sel && { rules: { min: 1, max: sumMax, minDiversityPct: 0 } }),
        // templates-multi-v1 §4.4-4.5: min = nº de marcados que cabem (≤ Σmax), 1 peça de cada
        ...(sel && { rules: { min: Math.max(1, Math.min(sel.picked.length, sumMax)), max: sumMax, minDiversityPct: 0 }, picked: sel.picked }),
      };
      const first = await this.plan(input);
      let draft: AutoPlanDraft = first;
      // `picked_missing` só pede o reparo à ia; depois dele não reprova (fica fora do 2º validatePlan)
      let violations: Violation[] = [...validatePlan(first, ctx, allowed), ...(sel ? pickedMissing(first, sel.picked) : [])];
      let removedByCaption: CaptionBlockedEntry[] = [];
      let rDraftItems: unknown[] = [];
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
        // lote de template em que a legenda tirou tudo: plano vazio com a faixa `soft` (abaixo), não falha
        const soLegenda = !!tpl && r.removed.some((x) => x.rules.includes('burned_captions'));
        if (!r.ok && !(ctx.caption?.bands.length && (r.draft.items.length > 0 || soLegenda))) {
          const detail = violations.map((v) => violationText(v, draft.items ?? [])).join('; ').slice(0, 2000);
          throw new AutoPlanError('PLAN_INVALID', 'planning', detail);
        }
        this.log.log(`lote ${b.id}: reparo determinístico tirou ${r.removed.length} peça(s): ${r.removed.map((x) => `${x.type}(${x.rules.join(',')})`).join(' ')}`);
        draft = r.draft;
        removedByCaption = r.removed.filter((x) => x.rules.includes('burned_captions')).map((x) => ({
          type: x.type, template: x.type === 'FRAME' ? frameTemplateOfDraft(rDraftItems[x.index]) : null,
          ...(x.type === 'LIST_OVERLAY' && { listTemplate: listTemplateOf((rDraftItems[x.index] as { params?: unknown } | undefined)?.params) ?? undefined }),
        }));
      }
      const tplKeys = tpl ? keysOf(tpl.keys) : null;
      // lote de template: peça de outra chave (moldura fora do template) sai antes da checagem
      const finalized = finalizePlan(draft, ctx, this.media).filter((it) => !tpl || tpl.keys.includes(pieceKeyOf(it.type, it.params)) || (it.type !== 'FRAME' && it.type !== 'LIST_OVERLAY' && tplKeys!.types.has(it.type)));
      // Check the final payload too: snapped cuts and finalized layout are what the render queue will receive.
      const items = finalized.filter((it) => {
        if (!ctx.caption?.check({ type: it.type, params: it.params as unknown as Record<string, unknown> })) return true;
        removedByCaption.push({ type: it.type, template: it.type === 'FRAME' ? (it.params as { template: FrameTemplateId }).template : null, ...(it.type === 'LIST_OVERLAY' && { listTemplate: listTemplateOf(it.params) ?? undefined }) });
        return false;
      });
      if (!items.length && tpl && removedByCaption.length) {
        // template tirado pela legenda queimada: plano sem peça + faixa `soft` (saídas: versão sem legenda, outro template)
        await this.readyEmpty(b.id, jobId, { ...partialInsight(ctx, flags, swaps), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...blockedOf(captionBlockedOf(ctx, allowed, removedByCaption)), ...(cleanVersion && { cleanVersion }) }, { level: 'soft', reason: 'burned_captions' }, sel?.fits);
        return;
      }
      if (!items.length) throw new AutoPlanError('PLAN_INVALID', 'planning', 'No compatible pieces remain after caption validation');
      // §2.1: `captionsAuto` no insight (TRANSIÇÃO: fora do AutoInsight até o arquiteto tipar; o web já lê)
      // 26/10: por que o HEADLINE ficou fora (o web mostra); null = entrou ou o campeão não tem dado pra ele
      const insight = { ...buildInsight(draft, ctx, flags, swaps, FROM_VIDEO, items.length), captionsAuto: !!ctx.captionsAuto, headlineBlocked: headlineBlockedOf(ctx), ...blockedOf(captionBlockedOf(ctx, allowed, removedByCaption)), ...(cleanVersion && { cleanVersion }) };

      // 3. PLAN_READY: itens e insight na mesma transação da troca de estado
      await this.prisma.$transaction(async (tx) => {
        const prev = await tx.variationBatch.findUniqueOrThrow({ where: { id: b.id }, select: { settings: true } });
        const settings = { ...((prev.settings ?? {}) as Record<string, unknown>) };
        if (tpl) settings.template = { ...tpl, fit, ...(sel && { fits: sel.fits }) };
        const locked = await tx.variationBatch.update({ where: { id: b.id }, data: { updatedAt: new Date(), settings: settings as unknown as Prisma.InputJsonValue } });
        const result = selectPieces(items.map((it) => ({ ...it, autoType: it.type })), (locked.answers as unknown as IterateAnswers | null) ?? DEFAULT_ANSWERS);
        // §2: amostra = no máximo 4 peças selecionadas
        // templates-creditos-v1: template único = todas as peças marcadas; pack = a seleção de hoje (sem o corte de 4 da amostra antiga)
        const selected = tpl && !tpl.pack
          ? items.map((it) => ({ item: { ...it, autoType: it.type }, included: true, wantKey: WANT_OF[it.type] ?? null, selection: 'auto' as const }))
          : sample && !tpl ? capSampleSelection(result.selected) : result.selected;
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        await tx.variationItem.createMany({
          data: selected.map(({ item: it, included, wantKey, selection }) => ({
            // templates-lista-v1 §2.3: lista com < 2 âncoras (`fill: 'pending'`) fica fora do lote e do quote até "Fill from Brain"
            included: included && (it.params as { fill?: string }).fill !== 'pending', wantKey, selection, priority: it.index,
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

  /**
   * templates-creditos-v1 §6: lote de template sem peça possível (não cabe) → PLAN_READY vazio, com o fit no settings.
   * Nada a gerar = nada a cobrar.
   */
  private async readyEmpty(batchId: string, jobId: string, insight: Record<string, unknown>, fit: { level: string; reason: string | null }, fits?: Record<string, TemplateFit>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.variationBatch.findUniqueOrThrow({ where: { id: batchId }, select: { settings: true } });
      const rest = (prev.settings ?? {}) as Record<string, unknown>;
      const settings: Record<string, unknown> = { ...rest, template: { ...(rest.template as object), fit, ...(fits && { fits }) } };
      await tx.variationBatch.update({ where: { id: batchId }, data: { settings: settings as unknown as Prisma.InputJsonValue } });
      await tx.variationItem.deleteMany({ where: { batchId } });
      await this.sm.transition({
        tx, batchId, event: 'AUTO_PLAN_DONE', from: 'PLANNING', to: 'PLAN_READY',
        data: { insight: insight as unknown as Prisma.InputJsonValue, errorCode: null, failReason: null, failDetail: null, failStage: null },
      });
    }, { timeout: 30_000 });
    await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { pieces: 0 } });
  }

  /**
   * templates-multi-v1 §4.2: fit de cada marcado (as regras do template único, no contexto do plano, com a guarda da legenda)
   * → `fits` por slug, as chaves dos que cabem (`picked`; `soft` não cabe, §15.4) e o fit do 1º marcado.
   */
  private async selectionFits(ctx: PlanCtx, tpl: { slugs?: string[]; keys: string[] }): Promise<{ fits: Record<string, TemplateFit>; picked: string[]; first: TemplateFit }> {
    const slugs = tpl.slugs ?? [];
    const rows = await this.prisma.template.findMany({ where: { slug: { in: slugs } }, select: { slug: true, internalKey: true, autoType: true, frameId: true, pack: true } });
    const fits: Record<string, TemplateFit> = {};
    const picked: string[] = [];
    for (const slug of slugs) {
      const t = rows.find((r) => r.slug === slug);
      const f: TemplateFit = t ? templateFitOf(ctx, t) : { level: 'hard', reason: 'no_data' };
      fits[slug] = f;
      if (t && f.level === 'ok') picked.push(t.internalKey);
    }
    return { fits, picked, first: fits[slugs[0]] ?? { level: 'hard', reason: 'no_data' } };
  }

  /** templates-creditos-v1: contexto das regras do campeão (fit na galeria e validação dos textos editados). */
  async ctxForChampion(championId: string, language?: string | null): Promise<PlanCtx | null> {
    const c = await this.prisma.champion.findUnique({
      where: { id: championId },
      include: { teardown: true, videoFile: { select: { width: true, height: true } }, offer: true, workspace: { include: { brandAssets: BRAND_LOGO_INCLUDE } } },
    });
    if (!c || c.status !== 'READY' || !c.teardown || !sectionsOf(c.teardown.sections)) return null;
    const { offer, workspace, ...champion } = c;
    const b = { offer, workspace, champion, language: language ?? c.language ?? offer.language } as unknown as PlanBatch;
    return this.guardedCtx(b, true);
  }

  /** Contexto das regras com a guarda da legenda (o mesmo do plano). */
  private guardedCtx(b: PlanBatch, captured: boolean): PlanCtx {
    const ctxSrc = { offer: b.offer, workspace: b.workspace, champion: b.champion, teardown: b.champion.teardown };
    const ctx = withCaptionGuard(planCtxOf(ctxSrc, this.media, { captured }), { ...ctxSrc, video: b.champion.videoFile, language: b.language });
    // templates-creditos-v1 A6: COLD_OPEN/ENDCARD só no lote de template que tem a chave (o Iterate normal segue sem)
    const tpl = templateSettingsOf((b as { settings?: unknown }).settings);
    if (tpl) {
      ctx.templateOnlyTypes = templateOnlyTypesOf(tpl.keys);
      // templates-lista-v1 §1: as chaves `LIST_OVERLAY:<id>` (template, pack ou seleção) liberam os templates de lista
      ctx.listTemplates = listTemplatesOf(tpl.keys);
    }
    return ctx;
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
      // templates-lista-v1 §1: LIST_OVERLAY = 1 entrada por template, com `templateId`; `list` = maxPairs do posicionarLista
      allowed: allowed.map((a) => ({ type: a.type, max: a.max, ...(a.templateId && { templateId: a.templateId }) })) as unknown as AutoPlanInput['allowed'],
      ...(allowed.some((a) => a.type === 'LIST_OVERLAY' && a.max > 0) && { list: listCtxOf(ctx) }),
      allowedFrames: allowedFrameIds(ctx),
      rules: rulesFor(allowed, true),
      // templates-creditos-v1 A6: as variantes de end card que o Brain sustenta (só com ENDCARD no lote de template)
      ...(allowed.some((a) => a.type === 'ENDCARD' && a.max > 0) && { endcardVariants: endcardVariants(ctx) }),
      ...(ctx.headline && !ctx.headline.blockedReason && {
        headline: { mode: ctx.headline.mode, original: ctx.headline.original, lines: ctx.headline.lines, maxChars: ctx.headline.maxChars, hasHighlight: ctx.headline.hasHighlight, language: ctx.headline.language },
      }),
    };
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
