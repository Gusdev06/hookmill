import { FREE_WANTS, preferencesOf, selectPieces, validateAnswers } from './selecao';
import { ehCopia, medidaLegivel, medirTexto } from './headline-plano';
import { PlacasService } from '../campeoes/placas.service';
import type { IterateAnswers } from '@maquina/contratos';
import { TEMPLATE_TYPES, templatesLigados } from './templates-plano';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { aiPreviewsOf, aiSettings, aiSettingsKey, TEMPLATE_AI_RUNNER, type AiAuthorization, type TemplateAiRunner } from '../templates-ai/contract';
import { Interval } from '@nestjs/schedule';
import type { IterateBatch, IterateConfig, IterateRunningRef, LibraryItem } from '@maquina/contratos';
import { Prisma, type Champion } from '@prisma/client';
import { AnaliseService } from '../campeoes/analise.service';
import { ChampionStateMachine } from '../campeoes/champion-state-machine';
import { editMapOf, sectionsOf } from '../campeoes/champion-views';
import { CHAMPION_MIME_TYPES, autoAnalysisEstimateUsd } from '../campeoes/limites';
import { BibliotecaService } from '../biblioteca/biblioteca.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CustosService } from '../custos/custos.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { MetaImportService, type ImportMode } from '../meta/importacao.service';
import { PecasAutoService } from '../edicao/pecas.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { BATCH_ENTRY, BatchStateMachine, assertBatchCan } from '../variacoes/batch-state-machine';
import type { CreateIterateDto } from './iteracao.dto';
import { ITERATE_INCLUDE, IteracaoViews } from './iteracao.views';
import { AutoPlanError, PlanoAutoService } from './plano-auto.service';
import { captionOverrideOf } from '../edicao/pecas';
import { applyListOptions, isListSpec, listSpecViolations } from './lista-plano';
import type { ListLook } from '@maquina/contratos';
import { AUTO_TYPES_NOVOS } from './regras';
import type { AutoVariationType } from '@maquina/contratos';
import { SAMPLE_CAP_USD, isSampleSettings } from '../amostra/acesso';
import { AmostraService, SAMPLE_BATCH, paymentRequired } from '../amostra/amostra.service';
import { CreditosService, templateSettingsOf, type BatchTemplateSettings } from '../creditos/creditos.service';
import { templatesOn } from '../creditos/regras';
import { applyTexts, editableTextsOf } from './templates-lote';
import { frameContentViolations, headlineViolations, type PlanCtx } from './regras';
import type { AutoFrameDraft, AutoParamsDraft } from '../integracoes';
import { markActivation } from '../workspaces/ativacao';
import { OnEvent } from '@nestjs/event-emitter';
import { CHAMPION_SETTLED, ResearchChampionService, type ChampionSettledEvent } from '../campeoes/research-champion.service';

/** templates-creditos-v1 §2: o lote nasce de um template (sem quiz; o run de créditos nasce na mesma transação). */
export interface TemplateBatchSpec { templateId: string; settings: BatchTemplateSettings; cap: number | null; sample: boolean; aiGeneration?: AiAuthorization }

/** Varredura dos lotes ANALYZING cujo campeão terminou por outro caminho (outro lote, /champions, reinício). */
const ADVANCE_EVERY_MS = 3000;

/** import = meta-v1 D13: baixar o vídeo da Meta antes da análise (job META_IMPORT). */
type Reuse = ImportMode;

/**
 * Lote AUTO (variacao-auto-v1 §3.1, §5): POST /iterate cria o lote e dispara a análise sozinha (CHAMPION_ANALYZE do
 * campeão → AUTO_PLAN). Workspace sempre do token; lote MANUAL ou de outro workspace = 404.
 */
@Injectable()
export class IteracaoService {
  private readonly log = new Logger('Iteracao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: IteracaoViews,
    private readonly sm: BatchStateMachine,
    private readonly championSm: ChampionStateMachine,
    private readonly analise: AnaliseService,
    private readonly plano: PlanoAutoService,
    private readonly uploads: UploadsService,
    private readonly custos: CustosService,
    private readonly jobs: JobsService,
    private readonly locks: KeyedMutex,
    private readonly cfg: AppConfig,
    private readonly moduleRef: ModuleRef,
    private readonly pecas: PecasAutoService,
    private readonly metaImport: MetaImportService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    private readonly amostra: AmostraService,
    private readonly creditos: CreditosService,
    private readonly researchChampion: ResearchChampionService, // ads-research-v1 §6.1
    private readonly placas: PlacasService, // troca-texto-queimado-v1 §16.5 (F1b)
  ) {}

  // ───────── leitura ─────────

  private async load(workspaceId: string, id: string) {
    const b = await this.prisma.variationBatch.findFirst({ where: { id, workspaceId, mode: 'AUTO', champion: { archivedAt: null } }, include: ITERATE_INCLUDE });
    if (!b) throw new AppException('NOT_FOUND');
    return b;
  }

  async get(auth: AuthContext, id: string): Promise<IterateBatch> {
    await this.retireFromPlan(this.prisma, auth.workspaceId, id);
    return this.views.batch(await this.load(auth.workspaceId, id));
  }

  async preferences(auth: AuthContext) {
    const w = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { iteratePreferences: true } });
    return preferencesOf(w.iteratePreferences);
  }

  async forgetPreferences(auth: AuthContext) {
    await this.prisma.workspace.update({ where: { id: auth.workspaceId }, data: { iteratePreferences: Prisma.DbNull } });
  }

  async answers(auth: AuthContext, id: string, value: unknown, save: boolean): Promise<IterateBatch> {
    const answers = validateAnswers(value);
    await this.locks.run(`batch:${id}`, () => this.prisma.$transaction(async (tx) => {
      // The write locks this row against planning completion, launch and other answer requests.
      const hit = await tx.variationBatch.updateMany({ where: { id, workspaceId: auth.workspaceId, mode: 'AUTO', champion: { archivedAt: null } }, data: { updatedAt: new Date() } });
      if (!hit.count) throw new AppException('NOT_FOUND');
      const b = await tx.variationBatch.findUniqueOrThrow({ where: { id }, include: { items: { where: { kind: 'AUTO_EDIT' } } } });
      if (!['ANALYZING', 'PLANNING', 'PLAN_READY'].includes(b.status)) throw new AppException('INVALID_STATE', { state: b.status, reason: b.status === 'LAUNCHED' ? 'launched' : b.status });
      const now = new Date();
      await tx.variationBatch.update({ where: { id }, data: { answers: answers as unknown as Prisma.InputJsonValue, answersAt: now, answersById: auth.userId } });
      if (b.status === 'PLAN_READY') {
        // §15.3.1: item marcado no antigo "Gerar mesmo assim" não volta para o lote
        const result = selectPieces(b.items.filter((i) => !captionOverrideOf(i.payload)), answers);
        for (const v of result.selected) await tx.variationItem.update({ where: { id: v.item.id }, data: { included: v.included, wantKey: v.wantKey, selection: v.selection } });
      }
      if (save) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true } });
        const savedBy = { ...user, initials: user.name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() };
        await tx.workspace.update({ where: { id: auth.workspaceId }, data: { iteratePreferences: { ...answers, savedAt: now.toISOString(), savedBy, fromBatchId: id } } });
      }
    }, { timeout: 30_000 }));
    return this.get(auth, id);
  }

  async select(auth: AuthContext, id: string, itemId: string, included: boolean): Promise<IterateBatch> {
    await this.locks.run(`batch:${id}`, () => this.prisma.$transaction(async (tx) => {
      const hit = await tx.variationBatch.updateMany({ where: { id, workspaceId: auth.workspaceId, mode: 'AUTO', champion: { archivedAt: null } }, data: { updatedAt: new Date() } });
      if (!hit.count) throw new AppException('NOT_FOUND');
      const b = await tx.variationBatch.findUniqueOrThrow({ where: { id } });
      if (b.status !== 'PLAN_READY' || aiPreviewsOf(b.settings)) throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'] }); // prévias: só approve
      const item = await tx.variationItem.findFirst({ where: { id: itemId, batchId: id, kind: 'AUTO_EDIT' } });
      if (!item) throw new AppException('NOT_FOUND');
      if (item.selection === 'goal_cut') throw new AppException('ITEM_NOT_SELECTABLE');
      const n = await tx.variationItem.count({ where: { batchId: id, included: true, kind: 'AUTO_EDIT' } });
      if (included && !item.included && n >= 12) throw new AppException('ITEM_NOT_SELECTABLE', { reason: 'batch_full' });
      await tx.variationItem.update({ where: { id: itemId }, data: { included, selection: included ? 'user_added' : 'user_removed' } });
    }, { timeout: 30_000 }));
    return this.get(auth, id);
  }

  /** GET /iterate/config (§4). */
  async config(auth: AuthContext): Promise<IterateConfig> {
    const typical = autoAnalysisEstimateUsd(this.catalog, 30);
    const offers = await this.prisma.offer.findMany({
      where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: { id: true, name: true, language: true },
    });
    let defaultOfferId: string | null = offers.length === 1 ? offers[0].id : null;
    if (offers.length > 1) {
      const last = await this.prisma.variationBatch.findFirst({ where: { workspaceId: auth.workspaceId, mode: 'AUTO' }, orderBy: { createdAt: 'desc' }, select: { offerId: true } });
      defaultOfferId = last && offers.some((o) => o.id === last.offerId) ? last.offerId : null;
    }
    return {
      quiz: { aiEnabled: false, wants: FREE_WANTS },
      savedPreferences: await this.preferences(auth),
      maxBytes: this.cfg.uploadMaxBytes, minSec: this.cfg.championMinSec, maxSec: this.cfg.championMaxSec, mimeTypes: [...CHAMPION_MIME_TYPES],
      analysisUsdPerSec: Math.round((typical / 30) * 10_000) / 10_000, analysisTypicalUsd: typical,
      // iterate-v2 F1.7: os 2 templates grátis só com ITERATE_TEMPLATES=on (padrão off até o QA passar)
      types: [...AUTO_TYPES_NOVOS, ...(templatesLigados() ? TEMPLATE_TYPES : [])] as AutoVariationType[], metaConnected: false, offers, defaultOfferId,
      staticImageUsd: this.pecas.staticImageUsd(), // rev. 23/10 §14.4
      recentWinners: await this.recentWinners(auth),
      running: await this.running(auth),
    };
  }

  /** 29/10 (feedback Tordan): lotes AUTO ainda trabalhando — análise/plano, ou lançado com peça em render. */
  private async running(auth: AuthContext): Promise<IterateRunningRef[]> {
    const rows = await this.prisma.variationBatch.findMany({
      where: {
        workspaceId: auth.workspaceId, mode: 'AUTO', champion: { archivedAt: null },
        OR: [{ status: { in: ['ANALYZING', 'PLANNING'] } }, { status: 'LAUNCHED', creatives: { some: { state: 'RENDERING', archivedAt: null } } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { id: true, status: true, createdAt: true, champion: { select: { name: true, metaAdId: true } } },
    });
    return rows.map((b) => ({
      id: b.id, championName: b.champion.name, status: b.status as IterateRunningRef['status'],
      metaAdId: b.champion.metaAdId ?? null, createdAt: b.createdAt.toISOString(),
    }));
  }

  /** Até 3 vencedores em vídeo da Library (a lista e o formato do item são da biblioteca, B2). */
  private async recentWinners(auth: AuthContext): Promise<LibraryItem[]> {
    const lib = this.moduleRef.get(BibliotecaService, { strict: false });
    const r = await lib.list(auth, { winners: true, limit: 10 });
    return r.items.filter((i) => (i as LibraryItem & { media?: string }).media !== 'image' && i.video?.mimeType?.startsWith('video/')).slice(0, 3);
  }

  // ───────── criar (POST /iterate) ─────────

  async create(auth: AuthContext, dto: CreateIterateDto, template?: TemplateBatchSpec): Promise<IterateBatch> {
    const ai = template?.aiGeneration;
    // templates-ia-previas-v1 §5.1: lote de prévias guarda a chave em settings.aiPreviews (conflito = reason 'request_conflict')
    const aiKey = ai ? aiSettingsKey(ai) : null;
    const aiConflict = () => new AppException('INVALID_STATE', ai?.previews ? { state: 'PLANNING', allowed: [], reason: 'request_conflict' } : { reason: 'idempotency_conflict' });
    if (ai) {
      const existing = await this.prisma.variationBatch.findFirst({ where: { workspaceId: auth.workspaceId, settings: { path: [aiKey!, 'requestId'], equals: ai.requestId } } });
      if (existing) {
        if (aiSettings(existing.settings)?.fingerprint !== ai.fingerprint) throw aiConflict();
        return this.get(auth, existing.id);
      }
    }
    const given = [dto.uploadId && 'uploadId', dto.creativeId && 'creativeId', dto.metaAdId && 'metaAdId', dto.championId && 'championId', dto.researchAdId && 'researchAdId'].filter(Boolean) as string[];
    if (given.length !== 1) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: given[1] ?? 'uploadId', rule: 'exactlyOneOf:uploadId,creativeId,metaAdId,championId,researchAdId' }] });
    }
    // amostra-gratis-v1 §2/§6/P4: workspace sem plano = só a amostra (1 por conta, só modo OWN); gasta ou outro modo = 402
    // templates-creditos-v1 §5: lote de template = o TemplatesService já decidiu a amostra (usos); quiz com TEMPLATES=on e
    // conta SAMPLE = 402 `sample_templates` (a porta da amostra é a galeria)
    let sample: boolean;
    if (template) sample = template.sample;
    else {
      if (templatesOn() && (await this.amostra.workspaceAccess(auth.workspaceId)) === 'SAMPLE') throw paymentRequired({ reason: 'sample_templates', unlock: { pieces: 0 } });
      const admission = await this.amostra.admit(auth, dto.championId);
      if (admission.kind === 'blocked') throw paymentRequired(admission.details);
      sample = admission.kind === 'sample';
    }
    const src = dto.uploadId ? await this.fromUpload(auth, dto.uploadId, dto.offerId)
      : dto.championId ? await this.fromChampion(auth, dto.championId)
      : dto.metaAdId ? await this.metaImport.prepare(auth, dto.metaAdId, dto.offerId) // meta-v1 D13: Pick from Meta
        : dto.researchAdId ? await this.researchChampion.prepare(auth, dto.researchAdId, dto.offerId) // ads-research-v1 §6.1: Ad Radar
          : await this.fromLibrary(auth, dto.creativeId!);
    // legenda-protegida-v1 D-LP5: a versão sem legenda fica presa no lote e é conferida antes do plano (a análise precisa acabar)
    const cleanFile = dto.cleanUploadId ? await this.uploads.readyFile(auth.workspaceId, dto.cleanUploadId) : null;
    const durationSec = num(src.champion.durationSec) ?? 30;
    const estimate = autoAnalysisEstimateUsd(this.catalog, durationSec, src.mode === 'reuse');
    // §2: o custo da amostra é nosso, fora do teto mensal do cliente. Teste do Gusta 29/10: a análise de um vídeo longo já
    // passa de US$ 1 sozinha, então a análise da amostra não tem teto (o limite é o maxSec do campeão); o teto fixo vale só
    // pra geração das peças (autoStartSample corta peças até caber).
    if (!sample) await this.custos.assertWithinCap(auth.workspaceId, estimate);

    const r = await this.prisma.$transaction(async (tx) => {
      if (ai) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-template:${auth.workspaceId}:${ai.requestId}`}, 0))::text`;
        const existing = await tx.variationBatch.findFirst({ where: { workspaceId: auth.workspaceId, settings: { path: [aiKey!, 'requestId'], equals: ai.requestId } } });
        if (existing) {
          if (aiSettings(existing.settings)?.fingerprint !== ai.fingerprint) throw aiConflict();
          return { batchId: existing.id, jobId: null, championId: existing.championId, duplicate: true };
        }
      }
      if (sample && !template) await this.amostra.claim(tx, auth.userId, new Date());
      let champion = src.champion;
      if (src.isNew) champion = await tx.champion.create({ data: src.newData! });
      else if (src.mode === 'analyze') await this.reanalyzeChampion(tx, champion);
      else if (src.mode === 'import') await this.metaImport.importAgain(tx, champion);
      const batch = await tx.variationBatch.create({
        data: {
          workspaceId: auth.workspaceId, championId: champion.id, offerId: champion.offerId, mode: 'AUTO',
          status: src.mode === 'reuse' ? BATCH_ENTRY.AUTO_REUSE : BATCH_ENTRY.AUTO_ANALYZE,
          language: champion.language ?? src.offerLanguage, requests: [],
          settings: { quizEnabled: !template, ...(sample && { sample: true }), ...(cleanFile ? { cleanFileId: cleanFile.id } : {}), ...(template && { template: template.settings }), ...(ai && { [aiKey!]: ai }) } as unknown as Prisma.InputJsonValue,
          estimatedCostUsd: estimate, createdById: auth.userId,
        },
      });
      if (template) await tx.templateRun.create({ data: { workspaceId: auth.workspaceId, batchId: batch.id, templateId: template.templateId, cap: template.cap, createdById: auth.userId } });
      if (ai) await this.moduleRef.get<TemplateAiRunner>(TEMPLATE_AI_RUNNER, { strict: false }).initialize(tx, batch.id, auth, ai);
      await markActivation(tx, auth.workspaceId, 'firstBatchAt', batch.createdAt); // tour-v2 §6
      const job = src.mode === 'wait' ? null
        : src.mode === 'reuse' ? await this.newPlanJob(tx, batch.id, champion, auth.userId)
          : src.mode === 'import' ? await this.metaImport.newImportJob(tx, champion, auth.userId)
            : await tx.job.create({ data: { workspaceId: auth.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: champion.id }, championId: champion.id, offerId: champion.offerId, createdById: auth.userId } });
      return { batchId: batch.id, jobId: job?.id ?? null, championId: champion.id };
    }, { timeout: 30000 });
    // ads-research-v1 §6.1: o vídeo do anúncio do Ad Radar é resolvido depois do commit (o campeão espera em RESOLVING)
    if ('duplicate' in r && r.duplicate) return this.get(auth, r.batchId);
    (src as { afterCommit?: ((championId: string) => void) | null }).afterCommit?.(r.championId);
    this.kick(r.batchId, src.mode, r.jobId, r.championId, auth.userId);
    return this.get(auth, r.batchId);
  }

  /** Upload → campeão novo (rights do schema: só registro). Oferta: a do corpo, ou a única ativa (§5.1, D3). */
  private async fromUpload(auth: AuthContext, uploadId: string, offerId?: string) {
    const file = await this.uploads.readyFile(auth.workspaceId, uploadId); // 404/409/410 antes de pedir a oferta
    const offers = await this.prisma.offer.findMany({ where: { workspaceId: auth.workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
    const offer = offerId ? offers.find((o) => o.id === offerId) : offers.length === 1 ? offers[0] : undefined;
    if (offerId && !offer) throw new AppException('NOT_FOUND');
    if (!offer) throw new AppException('OFFER_REQUIRED', { offers: offers.map((o) => ({ id: o.id, name: o.name })) });
    const up = await this.prisma.upload.findUnique({ where: { id: uploadId }, select: { filename: true } });
    const name = (up?.filename ?? 'Champion').replace(/\.[A-Za-z0-9]{2,4}$/, '').trim().slice(0, 120) || 'Champion';
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: offer.id, name, status: 'ANALYZING', videoFileId: file.id, durationSec: file.durationSec, createdById: auth.userId,
    };
    return { champion: { ...newData, id: '', language: null, durationSec: file.durationSec } as unknown as Champion, isNew: true, newData, mode: 'analyze' as Reuse, offerLanguage: offer.language };
  }

  /**
   * Library → "Vary" (§5.1 esclarecimento 2): criativo APPROVED com vídeo. Campeão com sourceCreativeId não arquivado:
   * READY com teardown e editMap = reaproveita (lote nasce PLANNING); ANALYZING = espera; FAILED ou READY sem mapa =
   * analisa de novo. Sem campeão: cria um (rights OWN, vídeo = render final 9:16, nome do criativo).
   */
  /**
   * 26/10 "Novo lote": campeão já analisado do workspace (READY, com teardown e mapa) → reaproveita a análise (nasce
   * PLANNING, só o plano). Outro workspace/arquivado = 404; analisando/falhou = 409 INVALID_STATE `allowed: ['READY']`.
   */
  private async fromChampion(auth: AuthContext, championId: string) {
    const c = await this.prisma.champion.findFirst({ where: { id: championId, workspaceId: auth.workspaceId, archivedAt: null }, include: { teardown: true, offer: true } });
    if (!c || c.offer.archivedAt) throw new AppException('NOT_FOUND');
    if (c.status !== 'READY' || !sectionsOf(c.teardown?.sections)) throw new AppException('INVALID_STATE', { state: c.status, allowed: ['READY'] });
    const { teardown: _t, offer, ...champion } = c;
    return { champion: champion as Champion, isNew: false, newData: null, mode: 'reuse' as Reuse, offerLanguage: offer.language };
  }

  private async fromLibrary(auth: AuthContext, creativeId: string) {
    const c = await this.prisma.creative.findFirst({
      where: { id: creativeId, workspaceId: auth.workspaceId, archivedAt: null },
      include: { finalRender: { include: { file: true } }, offer: true },
    });
    if (!c) throw new AppException('NOT_FOUND');
    if (c.state !== 'APPROVED') throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'] });
    const file = c.finalRender?.file;
    if (!file || !file.mimeType.startsWith('video/')) throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'not_a_video' });
    if (c.offer.archivedAt) throw new AppException('NOT_FOUND');
    const existing = await this.prisma.champion.findFirst({
      where: { workspaceId: auth.workspaceId, sourceCreativeId: c.id, archivedAt: null }, include: { teardown: true }, orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const ready = existing.status === 'READY' && !!sectionsOf(existing.teardown?.sections) && !!editMapOf(existing.teardown?.editMap);
      const mode: Reuse = ready ? 'reuse' : existing.status === 'ANALYZING' || existing.status === 'RESOLVING' ? 'wait' : 'analyze';
      return { champion: existing as Champion, isNew: false, newData: null, mode, offerLanguage: c.offer.language };
    }
    const newData: Prisma.ChampionUncheckedCreateInput = {
      workspaceId: auth.workspaceId, offerId: c.offerId, name: c.name.slice(0, 120), status: 'ANALYZING', rights: 'OWN',
      rightsDeclaredById: auth.userId, rightsDeclaredAt: new Date(), videoFileId: file.id,
      durationSec: file.durationSec ?? c.finalRender?.durationSec ?? null, sourceCreativeId: c.id, createdById: auth.userId,
    };
    return { champion: { ...newData, id: '', language: null } as unknown as Champion, isNew: true, newData, mode: 'analyze' as Reuse, offerLanguage: c.offer.language };
  }

  /** Campeão existente FAILED/READY → ANALYZING (máquina do campeão). Seções editadas à mão são refeitas (o lote é da IA). */
  private async reanalyzeChampion(tx: Prisma.TransactionClient, c: Champion) {
    await this.championSm.transition({ tx, championId: c.id, event: 'ANALYZE_AGAIN', from: c.status, to: 'ANALYZING', data: { errorCode: null, failReason: null } });
  }

  private async newPlanJob(tx: Prisma.TransactionClient, batchId: string, c: Pick<Champion, 'id' | 'workspaceId' | 'offerId'>, userId: string) {
    // templates-ia-previas-v1 §5.7: o planejador inicial das prévias leva `kind: 'ai_previews'` (a retomada o reconhece por ele
    // e o deixa QUEUED pro sweep). Vale pros 3 caminhos: /use com campeão lido, campeão que termina a leitura e retry do lote.
    const b = await tx.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
    const input = aiPreviewsOf(b?.settings) ? { batchId, kind: 'ai_previews' } : { batchId };
    return tx.job.create({
      data: { workspaceId: c.workspaceId, type: 'AUTO_PLAN', status: 'QUEUED', input, variationBatchId: batchId, championId: c.id, offerId: c.offerId, createdById: userId },
    });
  }

  /** Depois do commit: dispara o trabalho em segundo plano. */
  private kick(batchId: string, mode: Reuse, jobId: string | null, championId: string, userId: string) {
    if (!jobId) return; // 'wait': a varredura avança quando o campeão terminar
    if (mode === 'reuse') {
      void this.jobs.detach(jobId, 'plano do lote AUTO', () => this.runPlan(jobId, batchId));
    } else if (mode === 'import') {
      // meta-v1 D13: META_IMPORT baixa o vídeo → campeão ANALYZING + job de análise → segue como o upload
      void this.jobs.detach(jobId, 'import do anúncio da Meta (lote AUTO)', async () => {
        const analyzeJobId = await this.metaImport.run(jobId, championId, userId);
        if (analyzeJobId) await this.analise.runAnalyze(analyzeJobId, championId);
        await this.advanceFromChampion(championId);
      });
    } else {
      void this.jobs.detach(jobId, 'análise do campeão (lote AUTO)', async () => {
        await this.analise.runAnalyze(jobId, championId);
        await this.advanceFromChampion(championId);
      });
    }
  }

  // ───────── campeão terminou → lote avança (§3.1) ─────────

  /** Lotes AUTO em ANALYZING deste campeão: READY → PLANNING (+ job AUTO_PLAN); FAILED → ANALYSIS_FAILED (reading). */
  async advanceFromChampion(championId: string): Promise<void> {
    const c = await this.prisma.champion.findUnique({ where: { id: championId } });
    if (!c || (c.status !== 'READY' && c.status !== 'FAILED')) return;
    const batches = await this.prisma.variationBatch.findMany({ where: { championId, mode: 'AUTO', status: 'ANALYZING' }, select: { id: true, createdById: true } });
    for (const b of batches) {
      if (c.status === 'READY') {
        const jobId = await this.prisma.$transaction(async (tx) => {
          await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_READING_DONE', from: 'ANALYZING', to: 'PLANNING' });
          return (await this.newPlanJob(tx, b.id, c, b.createdById)).id;
        }).catch(() => null); // outro processo/varredura avançou antes (CAS)
        if (jobId) void this.jobs.detach(jobId, 'plano do lote AUTO', () => this.runPlan(jobId, b.id));
      } else {
        const code = this.readingCode(c);
        await this.plano.fail(b.id, null, new AutoPlanError(code, 'reading', c.failReason ?? c.errorCode ?? null));
      }
    }
  }

  /** Código do lote a partir da falha do campeão: vídeo inválido e curto demais = MEDIA_TOO_SHORT (§5.3). */
  private readingCode(c: Champion): string {
    const code = c.errorCode ?? 'PROVIDER_ERROR';
    if (code === 'MEDIA_INVALID' && (num(c.durationSec) ?? Infinity) < this.cfg.championMinSec) return 'MEDIA_TOO_SHORT';
    return code;
  }

  /** ads-research-v1 §6.1: campeão do Ad Radar terminou (READY/FAILED) fora do kick do lote: avança sem esperar a varredura. */
  @OnEvent(CHAMPION_SETTLED, { async: true })
  async onChampionSettled(e: ChampionSettledEvent): Promise<void> {
    await this.advanceFromChampion(e.championId).catch((err) => this.log.warn(`avançar ${e.championId}: ${(err as Error).message}`));
  }

  @Interval('iterate-advance', ADVANCE_EVERY_MS)
  async sweep(): Promise<void> {
    if (process.env.BOOT_RECOVERY === 'off' && process.env.NODE_ENV === 'test') return; // int specs dividem o banco: cada um avança o seu
    const rows = await this.prisma.variationBatch.findMany({
      where: { mode: 'AUTO', status: 'ANALYZING', champion: { status: { in: ['READY', 'FAILED'] } } }, select: { championId: true }, take: 50,
    }).catch(() => []);
    for (const championId of new Set(rows.map((r) => r.championId))) await this.advanceFromChampion(championId).catch((e) => this.log.warn(`varredura ${championId}: ${(e as Error).message}`));
  }

  // ───────── retry da análise ─────────

  /** POST /iterate/:id/retry: ANALYSIS_FAILED → ANALYZING (campeão não READY) ou PLANNING. Vídeo inválido = 409 upload_another. */
  async retry(auth: AuthContext, id: string): Promise<IterateBatch> {
    const kick = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth.workspaceId, id);
      assertBatchCan(b.status, 'AUTO_RETRY');
      if (b.errorCode === 'MEDIA_INVALID' || b.errorCode === 'MEDIA_TOO_SHORT') {
        throw new AppException('INVALID_STATE', { state: b.status, allowed: ['ANALYSIS_FAILED'], reason: 'upload_another' });
      }
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId } });
      // ads-research-v1 §6.1: campeão do Ad Radar sem vídeo (download/coleta falhou) volta a RESOLVING e busca o vídeo de novo
      const researchAgain = c.status === 'FAILED' && !!c.researchAdId && !c.videoFileId
        ? await this.researchChampion.retryVideo(auth, c) : null;
      const mode: Reuse = researchAgain ? 'wait'
        : c.status === 'READY' && sectionsOf((await this.prisma.teardown.findUnique({ where: { championId: c.id } }))?.sections) ? 'reuse'
          : c.status === 'ANALYZING' || c.status === 'RESOLVING' ? 'wait'
            : c.metaAdId && !c.videoFileId ? 'import' // meta-v1 D13: o download falhou; baixa de novo
              : 'analyze';
      await this.capFor(b, autoAnalysisEstimateUsd(this.catalog, num(c.durationSec) ?? 30, mode === 'reuse'), 'analysis');
      const clear = { errorCode: null, failReason: null, failDetail: null, failStage: null };
      const jobId = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_RETRY', from: 'ANALYSIS_FAILED', to: mode === 'reuse' ? 'PLANNING' : 'ANALYZING', data: clear });
        if (mode === 'wait') return null;
        if (mode === 'reuse') return (await this.newPlanJob(tx, b.id, c, auth.userId)).id;
        if (mode === 'import') {
          await this.metaImport.importAgain(tx, c);
          return (await this.metaImport.newImportJob(tx, c, auth.userId)).id;
        }
        await this.reanalyzeChampion(tx, c);
        return (await tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: c.id }, championId: c.id, offerId: c.offerId, createdById: auth.userId } })).id;
      });
      researchAgain?.();
      return { mode, jobId, championId: c.id };
    });
    this.kick(id, kick.mode, kick.jobId, kick.championId, auth.userId);
    return this.get(auth, id);
  }

  /**
   * `POST /iterate/:id/replan` (legenda-protegida-v1 D-LP5): PLAN_READY → PLANNING com um job AUTO_PLAN novo sobre a análise
   * pronta (não cobra a análise de novo; o teto confere só o plano). Os itens do plano antigo são descartados. Lote LAUNCHED
   * = 409 INVALID_STATE `reason: 'launched'` (as peças já são criativos; o caminho é um lote novo do mesmo campeão);
   * PLANNING/ANALYZING = 409 (já está planejando); ANALYSIS_FAILED = use `retry`.
   */
  async replan(auth: AuthContext, id: string): Promise<IterateBatch> {
    const r = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth.workspaceId, id);
      if (b.status !== 'PLAN_READY' || aiPreviewsOf(b.settings)) {
        throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], ...(b.status === 'LAUNCHED' && { reason: 'launched' }) });
      }
      const c = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId } });
      const td = await this.prisma.teardown.findUnique({ where: { championId: c.id } });
      if (c.status !== 'READY' || !sectionsOf(td?.sections)) throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], reason: 'champion_not_ready' });
      await this.capFor(b, autoAnalysisEstimateUsd(this.catalog, num(c.durationSec) ?? 30, true), 'analysis');
      const jobId = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_REPLAN', from: 'PLAN_READY', to: 'PLANNING', data: { errorCode: null, failReason: null, failDetail: null, failStage: null } });
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        return (await this.newPlanJob(tx, b.id, c, auth.userId)).id;
      });
      return { jobId, championId: c.id };
    });
    this.kick(id, 'reuse', r.jobId, r.championId, auth.userId);
    return this.get(auth, id);
  }

  // ───────── o que saiu do plano (troca-texto-queimado-v1 §15.3.1) ─────────

  /**
   * Plano feito antes do F1a: item marcado "Gerar mesmo assim" (`captionOverride`) e HEADLINE `replace` não entram no lote,
   * não aparecem no Plan e não contam no quote. `goal_cut` = fora da lista e não selecionável. Sem migração: resolve aqui,
   * na leitura e no Gerar. Lote de template que fica vazio assim passa a mostrar a faixa `soft`. Sem item desses = sem escrita.
   */
  private async retireFromPlan(db: Prisma.TransactionClient | PrismaService, workspaceId: string, batchId: string): Promise<void> {
    const where: Prisma.VariationItemWhereInput = {
      batchId, workspaceId, kind: 'AUTO_EDIT', batch: { status: 'PLAN_READY' },
      AND: [
        { OR: [{ included: true }, { selection: { in: ['not_asked', 'user_removed'] } }] },
        { OR: [{ payload: { path: ['captionOverride'], equals: true } }, { autoType: 'HEADLINE', payload: { path: ['params', 'mode'], equals: 'replace' } }] },
      ],
    };
    // troca-texto-queimado-v1 §16.5 (F1b): HEADLINE `replace` copiado (`copy` box/loose, do plano do F1b) fica, enquanto a
    // troca estiver ligada pra este workspace. Desligada depois do plano = volta ao F1a (sai do lote, sem crédito).
    const ligada = this.placas.implPara(workspaceId) !== 'off';
    const alvo = await db.variationItem.findMany({ where, select: { id: true, payload: true } });
    const sair = alvo.filter((i) => {
      const pl = (i.payload ?? {}) as { captionOverride?: unknown; params?: { copy?: unknown } };
      return pl.captionOverride === true || !ligada || (pl.params?.copy !== 'box' && pl.params?.copy !== 'loose');
    }).map((i) => i.id);
    if (!sair.length) return;
    const hit = await db.variationItem.updateMany({ where: { id: { in: sair } }, data: { included: false, selection: 'goal_cut' } });
    if (!hit.count) return;
    const left = await db.variationItem.count({ where: { batchId, kind: 'AUTO_EDIT', included: true } });
    if (left) return;
    const b = await db.variationBatch.findUniqueOrThrow({ where: { id: batchId }, select: { settings: true } });
    const settings = (b.settings ?? {}) as Record<string, unknown>;
    if (!templateSettingsOf(settings)) return;
    await db.variationBatch.update({ where: { id: batchId }, data: { settings: { ...settings, template: { ...(settings.template as object), fit: { level: 'soft', reason: 'burned_captions' } } } as unknown as Prisma.InputJsonValue } });
  }

  // ───────── textos editáveis do Plan (templates-creditos-v1 A7) ─────────

  /**
   * `PATCH /iterate/:id/items/:itemId/texts`: edita os textos de tela de uma peça planejada (FRAME e HEADLINE), grátis e sem
   * chamar o modelo. Revalida com as regras do plano ("nada inventado", limites, fonte, preço literal, legenda queimada).
   */
  async updateTexts(auth: AuthContext, id: string, itemId: string, edits: { path: string; value: string }[]): Promise<IterateBatch> {
    const b = await this.load(auth.workspaceId, id);
    if (b.status !== 'PLAN_READY') throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'] });
    const item = await this.prisma.variationItem.findFirst({ where: { id: itemId, batchId: id, kind: 'AUTO_EDIT' } });
    if (!item) throw new AppException('NOT_FOUND');
    const payload = (item.payload ?? {}) as { params?: Record<string, unknown> };
    const type = item.autoType as string | null;
    if (!type || !editableTextsOf(type, payload.params ?? null).length) throw new AppException('EDIT_NOT_SUPPORTED', { reason: 'type', type });
    const { params, unknownPaths } = applyTexts(type, payload.params!, edits);
    if (unknownPaths.length) throw new AppException('VALIDATION_ERROR', { fields: unknownPaths.map((p) => ({ field: `texts.${p}`, rule: 'not_editable' })) });
    const ctx = await this.plano.ctxForChampion(b.championId, b.language);
    if (!ctx) throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], reason: 'champion_not_ready' });
    const violations = this.textViolations(type, params, ctx);
    if (type !== 'LIST_OVERLAY' && ctx.caption?.check({ type: type as AutoVariationType, params })) {
      violations.push({ path: '*', rule: 'burned_captions', detail: 'this text would cover the burned-in captions' });
    }
    if (violations.length) throw new AppException('TEXT_INVALID', { violations });
    await this.locks.run(`batch:${id}`, () => this.prisma.$transaction(async (tx) => {
      const cur = await tx.variationBatch.update({ where: { id }, data: { updatedAt: new Date() } });
      if (cur.status !== 'PLAN_READY') throw new AppException('INVALID_STATE', { state: cur.status, allowed: ['PLAN_READY'] });
      await tx.variationItem.update({ where: { id: itemId }, data: { payload: { ...payload, params, textsEditedAt: new Date().toISOString(), textsEditedById: auth.userId } as unknown as Prisma.InputJsonValue } });
    }, { timeout: 30_000 }));
    return this.get(auth, id);
  }

  /** As mesmas regras do plano sobre o texto editado (o rascunho é montado com os params finais). */
  private textViolations(type: string, params: Record<string, unknown>, ctx: PlanCtx): { path: string; rule: string; detail: string }[] {
    // templates-lista-v1 §5: as regras do §2.3 (inclui price_not_in_brain, invented_number), caminho `list.…`
    if (type === 'LIST_OVERLAY') return isListSpec(params) ? listSpecViolations(params, ctx) : [{ path: '*', rule: 'template_shape', detail: 'not a list piece' }];
    if (type === 'FRAME') {
      const draft = { type: 'FRAME', template: params.template, texts: params.texts, sources: params.sources ?? {} } as unknown as AutoFrameDraft;
      return frameContentViolations(draft, 0, ctx).map((v) => ({ path: /^([\w.]+?)(?: |$)/.exec(v.detail)?.[1] ?? '*', rule: v.rule, detail: v.detail }));
    }
    const draft = { type: 'HEADLINE', mode: params.mode, text: params.text, highlight: params.highlight ?? null, sources: params.sources ?? {} } as unknown as Extract<AutoParamsDraft, { type: 'HEADLINE' }>;
    const out = headlineViolations(draft, 0, ctx)
      // a original não muda; editar de volta pra original é escolha da pessoa só se ela digitou igual (a regra do plano vale)
      .map((v) => ({ path: 'text', rule: v.rule, detail: v.detail }));
    // troca-texto-queimado-v1 §16.3 item 6 (F1b): `replace` copiado = a mesma função do plano e do web, sem IA. Não coube =
    // `headline_too_long` | `headline_too_short` | `headline_over_chin`, com a medida no `detail`
    if (params.mode === 'replace' && ehCopia(ctx.headline)) {
      const r = medirTexto(ctx.headline.look, String(params.text ?? ''));
      if (!r.fits) out.push({ path: 'text', rule: `headline_${r.reject ?? 'too_long'}`, detail: medidaLegivel(r, ctx.headline.look.fit.originalLines.length) });
      else params.fitStep = r.step;
    }
    return out;
  }

  // ───────── opções da lista (templates-lista-v1 §5) ─────────

  /**
   * `PATCH /iterate/:id/items/:itemId/list`: look, colunas (só Versus) e "Fill from Brain" (`fill` pending → accepted: a peça
   * entra no lote e no quote, `included: true`). Grátis, sem chamada nova (as linhas do Brain já vieram no plano). Só PLAN_READY.
   */
  async updateListOptions(auth: AuthContext, id: string, itemId: string, body: { look?: ListLook; columns?: 1 | 2; acceptFill?: true }): Promise<IterateBatch> {
    if (body.look === undefined && body.columns === undefined && body.acceptFill === undefined) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'body', rule: 'at_least_one' }] });
    }
    const b = await this.load(auth.workspaceId, id);
    if (b.status !== 'PLAN_READY') throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'] });
    const item = await this.prisma.variationItem.findFirst({ where: { id: itemId, batchId: id, kind: 'AUTO_EDIT' } });
    if (!item) throw new AppException('NOT_FOUND');
    const payload = (item.payload ?? {}) as { params?: Record<string, unknown> };
    if (item.autoType !== 'LIST_OVERLAY' || !isListSpec(payload.params)) throw new AppException('EDIT_NOT_SUPPORTED', { reason: 'type', type: item.autoType });
    const ctx = await this.plano.ctxForChampion(b.championId, b.language);
    if (!ctx) throw new AppException('INVALID_STATE', { state: b.status, allowed: ['PLAN_READY'], reason: 'champion_not_ready' });
    const { params, error } = applyListOptions(payload.params, body, ctx);
    if (error) throw new AppException('EDIT_NOT_SUPPORTED', { reason: error.reason, type: 'LIST_OVERLAY' });
    const accepted = payload.params.fill === 'pending' && params.fill === 'accepted';
    await this.locks.run(`batch:${id}`, () => this.prisma.$transaction(async (tx) => {
      const cur = await tx.variationBatch.update({ where: { id }, data: { updatedAt: new Date() } });
      if (cur.status !== 'PLAN_READY') throw new AppException('INVALID_STATE', { state: cur.status, allowed: ['PLAN_READY'] });
      await tx.variationItem.update({
        where: { id: itemId },
        data: { payload: { ...payload, params } as unknown as Prisma.InputJsonValue, ...(accepted && { included: true }) },
      });
    }, { timeout: 30_000 }));
    return this.get(auth, id);
  }

  // ───────── gerar (start) ─────────

  /**
   * POST /iterate/:id/start: PLAN_READY → LAUNCHED; as peças (B2) nascem na MESMA transação (§3.3), só o 9:16 (§14.2).
   * §14.4: estimativa (nº de STATIC × staticImageUsd) > expectedCostUsd × 1,10 = 409 ESTIMATE_CHANGED; teto = 409
   * SPEND_CAP_EXCEEDED (estimativa 0 não chama o teto). As imagens do STATIC são submetidas depois do commit.
   */
  async start(auth: AuthContext, id: string, expectedPieces: number, expectedCostUsd?: number, expectedCredits?: number): Promise<IterateBatch> {
    const launched = await this.locks.run(`batch:${id}`, () => this.prisma.$transaction(async (tx) => {
      const hit = await tx.variationBatch.updateMany({ where: { id, workspaceId: auth.workspaceId, mode: 'AUTO', champion: { archivedAt: null } }, data: { updatedAt: new Date() } });
      if (!hit.count) throw new AppException('NOT_FOUND');
      const b = await tx.variationBatch.findUniqueOrThrow({ where: { id } });
      // templates-ia-previas-v1 §5.3: lote de prévias não tem Generate; o vídeo nasce no approve
      if (aiPreviewsOf(b.settings)) throw new AppException('INVALID_STATE', { state: b.status, allowed: [], reason: 'change_not_available' });
      assertBatchCan(b.status, 'AUTO_START');
      await this.retireFromPlan(tx, auth.workspaceId, b.id);
      const count = await tx.variationItem.count({ where: { batchId: id, kind: 'AUTO_EDIT', included: true } });
      if (!count) throw new AppException('INVALID_STATE', { reason: 'nothing_selected' });
      if (count !== expectedPieces) throw new AppException('PLAN_CHANGED', { pieces: count });
      const estimateUsd = await this.views.generateEstimateUsd(b.id);
      if (estimateUsd > (expectedCostUsd ?? 0) * 1.1 + 1e-9) throw new AppException('ESTIMATE_CHANGED', { estimateUsd });
      if (estimateUsd > 0) await this.capFor(b, estimateUsd);
      // templates-creditos-v1 §4.3: reserva o crédito na MESMA transação (402/409 = nada lança)
      await this.creditos.reserveOnStart(tx, b, auth, expectedCredits);
      const launchedAt = new Date();
      await this.sm.transition({ tx, batchId: b.id, event: 'AUTO_START', from: 'PLAN_READY', to: 'LAUNCHED', data: { launchedAt } });
      await markActivation(tx, b.workspaceId, 'firstGenerateAt', launchedAt); // tour-v2 §6
      return this.pecas.createPieces(tx, { batchId: b.id, userId: auth.userId, launchedAt });
    }, { timeout: 30_000 }));
    this.pecas.launched(launched);
    return this.get(auth, id);
  }

  // ───────── amostra grátis (amostra-gratis-v1 §2) ─────────

  /** Job AUTO_PLAN e, se o lote é a amostra, o lançamento automático (sem botão Generate). */
  private async runPlan(jobId: string, batchId: string): Promise<void> {
    const batch = await this.prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (aiSettings(batch.settings)) return this.moduleRef.get<TemplateAiRunner>(TEMPLATE_AI_RUNNER, { strict: false }).run(jobId, batchId);
    await this.plano.run(jobId, batchId);
    await this.autoStartSample(batchId).catch((e) => this.log.warn(`amostra ${batchId}: lançamento automático falhou (${(e as Error).message})`));
  }

  /** Teto do lote: amostra = teto fixo nosso só na geração (análise da amostra sem teto, 29/10); resto = teto mensal do workspace. */
  private async capFor(b: { id: string; workspaceId: string; settings: unknown }, estimateUsd: number, what: 'analysis' | 'generate' = 'generate'): Promise<void> {
    if (isSampleSettings(b.settings)) {
      if (what === 'generate') this.assertSampleBudget(await this.sampleGenerateSpentUsd(b.id), estimateUsd);
    }
    else await this.custos.assertWithinCap(b.workspaceId, estimateUsd);
  }

  private assertSampleBudget(spentUsd: number, estimateUsd: number): void {
    if (spentUsd + estimateUsd > SAMPLE_CAP_USD + 1e-9) {
      throw new AppException('SPEND_CAP_EXCEEDED', { spentUsd, capUsd: SAMPLE_CAP_USD, estimateUsd: Math.round(estimateUsd * 10_000) / 10_000 });
    }
  }

  /** 29/10: o teto da amostra conta só a geração (criativos do lote); a análise (campeão/lote) fica de fora. */
  private async sampleGenerateSpentUsd(batchId: string): Promise<number> {
    const r = await this.prisma.costEntry.aggregate({ where: { creative: { is: { variationBatchId: batchId } } }, _sum: { amountUsd: true } });
    return num(r._sum.amountUsd) ?? 0;
  }

  /**
   * §2: amostra em PLAN_READY → LAUNCHED sozinha (custo nosso e fixo). Se a estimativa do Gerar estourar o teto da amostra,
   * tira peças do fim até caber; sem peça = fica em PLAN_READY (nada a gerar).
   */
  async autoStartSample(batchId: string): Promise<void> {
    const launched = await this.locks.run(`batch:${batchId}`, async () => {
      const b = await this.prisma.variationBatch.findFirst({ where: { id: batchId, status: 'PLAN_READY', ...SAMPLE_BATCH } });
      if (!b || templateSettingsOf(b.settings)) return null; // templates-creditos-v1 §5: a amostra por template espera o Gerar
      const room = SAMPLE_CAP_USD - (await this.sampleGenerateSpentUsd(b.id));
      for (;;) {
        const included = await this.prisma.variationItem.findMany({ where: { batchId, kind: 'AUTO_EDIT', included: true }, orderBy: [{ priority: 'asc' }, { index: 'asc' }], select: { id: true } });
        if (!included.length) return null;
        if ((await this.views.generateEstimateUsd(batchId)) <= room + 1e-9) break;
        await this.prisma.variationItem.update({ where: { id: included[included.length - 1].id }, data: { included: false, selection: 'goal_cut' } });
      }
      return this.prisma.$transaction(async (tx) => {
        const launchedAt = new Date();
        await this.sm.transition({ tx, batchId, event: 'AUTO_START', from: 'PLAN_READY', to: 'LAUNCHED', data: { launchedAt } });
        return this.pecas.createPieces(tx, { batchId, userId: b.createdById, launchedAt });
      }, { timeout: 30_000 });
    });
    if (launched) this.pecas.launched(launched);
  }

  // ───────── retomada ─────────

  /**
   * Boot (depois da retomada dos jobs e dos campeões): lote PLANNING sem processo vivo → ANALYSIS_FAILED INTERRUPTED;
   * lote ANALYZING cujo campeão já assentou (FAILED pela retomada) avança pelo campeão.
   */
  async recover(workspaceId?: string): Promise<number> {
    const ws = workspaceId ? { workspaceId } : {};
    // templates-ia-previas-v1 §3.3: lote de prévias PLANNING não vira ANALYSIS_FAILED (as imagens seguem pelos provider_tasks;
    // o planejador inicial interrompido vira PLAN_FAILED pelo sweep do TemplatesAiService)
    const planning = (await this.prisma.variationBatch.findMany({ where: { ...ws, mode: 'AUTO', status: 'PLANNING' }, select: { id: true, settings: true } })).filter((b) => !aiPreviewsOf(b.settings));
    for (const b of planning) await this.plano.fail(b.id, null, new AutoPlanError('INTERRUPTED', 'planning'));
    const analyzing = await this.prisma.variationBatch.findMany({ where: { ...ws, mode: 'AUTO', status: 'ANALYZING' }, select: { championId: true } });
    for (const championId of new Set(analyzing.map((b) => b.championId))) await this.advanceFromChampion(championId);
    return planning.length + analyzing.length;
  }
}
