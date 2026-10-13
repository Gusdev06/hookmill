import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BatchEstimate, BatchSettings, CastingStyle, SwapQuote, SwapQuoteWarning, CreativeRow, FaceCount, EditSettings, EstimateLine, GenerateFacesResponse, LaunchBatchResponse, ScriptBlock,
  TeardownSections, VariationBatch, VariationCasting, VariationItem, VariationKind,
} from '@maquina/contratos';
import type { Prisma, VariationItem as ItemRow } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor } from '../common/errors/falhas';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { ChampionViews, editMapOf, engineVoiceOf, keepEditOf, measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { QUOTE_COMBOS, engineVoiceEnabled, SWAP_MODEL, isVideoEngine, validateSwapSettings } from '../troca/regras';
import { swapItemQuote } from '../troca/estimativa';
import { ENABLED_KINDS, LOW_RES_SIDE_PX, NEEDS_SPEECH } from '../campeoes/limites';
import { CreativeStateMachine } from '../criativos/state-machine';
import { CREATIVE_INCLUDE, CreativeViews, VARIATION_KIND_LABEL } from '../criativos/views';
import { CustosService } from '../custos/custos.service';
import { defaultEditSettings } from '../edicao/edicao.service';
import { GeracaoService, assertTakeLength } from '../geracao/geracao.service';
import { TakeService } from '../geracao/take.service';
import { takeSeed } from '../geracao/take';
import {
  CATALOG_SERVICE, CLAUDE_SERVICE, GENERATION_SERVICE, isIntegracaoError, type CatalogService, type ClaudeService, type GenerationService,
  type VariationItemDraft,
} from '../integracoes';
import { genderOf } from '../integracoes/catalogo/genero';
import { JobsService } from '../jobs/jobs.service';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaService } from '../prisma/prisma.service';
import { CASTING_FACES_DEFAULT, RostosService } from '../rostos/rostos.service';
import { BatchStateMachine, assertBatchCan, batchInvalidState } from './batch-state-machine';
import {
  KEEP_EDIT_KINDS, KIND_LIMITS, MAX_BATCH_ITEMS, type ItemPayload, type ItemPlan, type TeardownSnapshot, audioSecOf, defaultSettings, draftsOf,
  itemBlocks, keepEditBlockers, nearestFormat, originalHook, planItem, plannedTakeAudioSec, sourceBlocks,
} from './plano';
import type { BatchSettingsDto, CreateBatchDto, ReplanBatchDto, UpdateItemDto } from './variacoes.dto';
import { BATCH_INCLUDE, VariacoesViews, payloadOf, settingsOf } from './variacoes.views';
import { definidos } from '../edicao/editor-doc';

/** Plano do lote (Claude, 1 chamada curta por item): estimativa pra checar o teto antes (§7: US$ 0,03-0,05 por item). */
export const PLAN_ITEM_ESTIMATE_USD = 0.05;
const MAX_ESTIMATE_DRIFT = 1.1;
const CONTROL_INDEX = -1;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

type Requests = { kind: VariationKind; count: number }[];

/**
 * §13.13: estilo do elenco e o gênero travado. SWAP_AVATAR falando com a voz do campeão (CHAMPION_AUDIO) = gênero do
 * perfil do original (editMap.profile) ou, sem perfil, o da voz descrita no teardown; senão null (livre).
 */
export function castingPlanOf(style: CastingStyle, settings: BatchSettings, snapshot: TeardownSnapshot, kinds: VariationKind[]): { castingStyle: CastingStyle; castingGender: 'female' | 'male' | null } {
  const locked = kinds.includes('SWAP_AVATAR') && settings.voiceSource === 'CHAMPION_AUDIO';
  const castingGender = locked ? snapshot.editMap?.profile?.gender ?? genderOf(snapshot.sections.audio?.data?.voice) : null;
  return { castingStyle: style, castingGender };
}
type Missing = ({ castingId: string; reason: 'face_not_selected' } | { itemId: string; reason: 'not_ready' } | { field: 'voiceId' })[];

/**
 * Lotes de variação (feature-2 §3.2, §4.3, §5): plano revisável com o Claude, elencos (rostos Soul), settings do lote,
 * estimativa e o OK único (launch) que cria 1 criativo por item direto em SCENES_GENERATING.
 */
@Injectable()
export class VariacoesService {
  private readonly log = new Logger('Variacoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly views: VariacoesViews,
    private readonly creativeViews: CreativeViews,
    private readonly championViews: ChampionViews,
    private readonly sm: BatchStateMachine,
    private readonly creativeSm: CreativeStateMachine,
    private readonly jobs: JobsService,
    private readonly custos: CustosService,
    private readonly geracao: GeracaoService,
    private readonly rostos: RostosService,
    private readonly takes: TakeService,
    private readonly locks: KeyedMutex,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
  ) {}

  // ───────── leitura ─────────

  private async load(auth: AuthContext, id: string) {
    const b = await this.prisma.variationBatch.findFirst({ where: { id, workspaceId: auth.workspaceId, mode: 'MANUAL', champion: { archivedAt: null } }, include: BATCH_INCLUDE });
    if (!b) throw new AppException('NOT_FOUND');
    return b;
  }

  async get(auth: AuthContext, id: string): Promise<VariationBatch> {
    return this.views.batch(await this.load(auth, id));
  }

  async listForChampion(auth: AuthContext, championId: string): Promise<VariationBatch[]> {
    const c = await this.championViews.load(auth.workspaceId, championId);
    if (!c) throw new AppException('NOT_FOUND');
    const rows = await this.prisma.variationBatch.findMany({ where: { championId: c.id, workspaceId: auth.workspaceId, mode: 'MANUAL' }, include: BATCH_INCLUDE, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((b) => this.views.batch(b)));
  }

  // ───────── criar / replanejar ─────────

  /** Pedido válido (§2): tipos sem repetição, limites por tipo, ≤ 10 itens; tipo fora do build / sem fala = 422. */
  private validateRequests(requests: Requests, hasSpeech: boolean) {
    const seen = new Set<VariationKind>();
    let total = 0;
    requests.forEach((r, i) => {
      if (seen.has(r.kind)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `requests.${i}.kind`, rule: 'unique' }] });
      seen.add(r.kind);
      const lim = KIND_LIMITS[r.kind];
      if (r.count < lim.min || r.count > lim.max) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `requests.${i}.count`, rule: `between:${lim.min}:${lim.max}` }] });
      total += r.count;
    });
    if (total > MAX_BATCH_ITEMS) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'requests', rule: `maxItems:${MAX_BATCH_ITEMS}` }] });
    for (const r of requests) {
      if (!ENABLED_KINDS.includes(r.kind)) throw new AppException('KIND_NOT_ENABLED', { kind: r.kind });
      if (NEEDS_SPEECH.includes(r.kind) && !hasSpeech) throw new AppException('NO_SPEECH', { kind: r.kind });
    }
  }

  private snapshotOf(champion: { durationSec: Prisma.Decimal | null; teardown: { sections: Prisma.JsonValue; transcript: Prisma.JsonValue; measurements: Prisma.JsonValue; editMap: Prisma.JsonValue } | null }): TeardownSnapshot {
    const sections = sectionsOf(champion.teardown?.sections);
    const m = measurementsOf(champion.teardown?.measurements);
    if (!sections) throw new AppException('NOT_FOUND');
    return {
      sections, words: transcriptOf(champion.teardown?.transcript)?.words ?? [],
      durationSec: m?.durationSec ?? num(champion.durationSec) ?? 0, width: m?.width ?? null, height: m?.height ?? null,
      editMap: editMapOf(champion.teardown?.editMap),
    };
  }

  /**
   * §13.7: keepEdit com bloqueio pra algum tipo pedido = 422 KEEP_EDIT_UNSUPPORTED; hookMode só 'TEXT' (D6, 06/10).
   * Em keepEdit o Trocar avatar usa o áudio do campeão e o formato dele.
   */
  private applyKeepEdit(settings: BatchSettings, snapshot: TeardownSnapshot, kinds: VariationKind[]): BatchSettings {
    if (settings.hookMode !== 'TEXT') throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'settings.hookMode', rule: 'isIn:TEXT' }] });
    // §13.15.1: motor × voz × keepEdit
    validateSwapSettings(settings);
    if (!settings.keepEdit) return settings;
    const hit = keepEditBlockers(keepEditOf({ status: 'READY' }, snapshot.editMap ?? null), kinds);
    if (hit) throw new AppException('KEEP_EDIT_UNSUPPORTED', { kind: hit.kind, blockers: hit.blockers });
    if (settings.voiceSource === 'ENGINE_VOICE') {
      if (!engineVoiceEnabled(settings.swapEngine)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'settings.voiceSource', rule: 'engine_voice_not_enabled' }] });
      const ev = engineVoiceOf({ status: 'READY' }, snapshot.editMap ?? null);
      if (kinds.includes('SWAP_AVATAR') && !ev.available) throw new AppException('KEEP_EDIT_UNSUPPORTED', { kind: 'SWAP_AVATAR', blockers: ev.blockers });
    }
    // keepEdit: áudio do campeão (Lipsync e motor (A)) ou a voz do motor (B); formato do campeão
    return { ...settings, voiceSource: settings.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO', format: nearestFormat(snapshot.width, snapshot.height) };
  }

  /** keepEdit padrão: true quando todo tipo pedido que mantém a edição está disponível. */
  private keepEditDefault(snapshot: TeardownSnapshot, kinds: VariationKind[]): boolean {
    return kinds.some((k) => KEEP_EDIT_KINDS.includes(k)) && !keepEditBlockers(keepEditOf({ status: 'READY' }, snapshot.editMap ?? null), kinds);
  }

  private snap(json: Prisma.JsonValue | null): TeardownSnapshot {
    return json as unknown as TeardownSnapshot;
  }

  private mergeSettings(base: BatchSettings, patch: BatchSettingsDto | undefined): BatchSettings {
    if (!patch) return base;
    if (patch.voiceId && !this.catalog.voices().some((v) => v.id === patch.voiceId)) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'settings.voiceId', rule: 'isVoice' }] });
    }
    if (patch.engineModel && !this.catalog.engines().some((e) => e.models.some((m) => m.id === patch.engineModel))) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'settings.engineModel', rule: 'isEngineModel' }] });
    }
    // patch.edit é instância do UpdateEditDto: campo ausente existe como undefined e apagaria o ajuste do lote
    const edit: EditSettings = { ...base.edit, ...definidos(patch.edit) } as EditSettings;
    return {
      format: patch.format ?? base.format,
      voiceId: patch.voiceId !== undefined ? patch.voiceId : base.voiceId,
      voiceSource: patch.voiceSource ?? base.voiceSource,
      engine: patch.engine !== undefined ? patch.engine : base.engine,
      engineModel: patch.engineModel !== undefined ? patch.engineModel : base.engineModel,
      edit,
      keepEdit: patch.keepEdit ?? base.keepEdit,
      hookMode: patch.hookMode ?? base.hookMode,
      swapEngine: patch.swapEngine ?? base.swapEngine ?? 'LIPSYNC',
    };
  }

  /** POST /champions/:id/batches: campeão READY → lote PLANNING + itens WRITING (controle READY no NEW_HOOKS). */
  async create(auth: AuthContext, championId: string, dto: CreateBatchDto): Promise<VariationBatch> {
    const champion = await this.prisma.champion.findFirst({ where: { id: championId, workspaceId: auth.workspaceId, archivedAt: null }, include: { teardown: true, offer: true } });
    if (!champion) throw new AppException('NOT_FOUND');
    if (champion.status !== 'READY') throw new AppException('INVALID_STATE', { state: champion.status, allowed: ['READY'] });
    this.validateRequests(dto.requests, champion.hasSpeech);
    const items = dto.requests.reduce((a, r) => a + r.count, 0);
    await this.custos.assertWithinCap(auth.workspaceId, items * PLAN_ITEM_ESTIMATE_USD);
    const snapshot = this.snapshotOf(champion);
    const kinds = dto.requests.map((r) => r.kind);
    const settings = this.applyKeepEdit(
      this.mergeSettings(
        defaultSettings(snapshot, kinds, champion.offer.cta, defaultEditSettings(champion.offer.cta), this.keepEditDefault(snapshot, kinds)),
        dto.settings,
      ),
      snapshot, kinds,
    );
    const { batchId, jobId } = await this.prisma.$transaction(async (tx) => {
      const b = await tx.variationBatch.create({
        data: {
          workspaceId: auth.workspaceId, championId: champion.id, offerId: champion.offerId, status: 'PLANNING',
          language: champion.language ?? champion.offer.language, requests: dto.requests as unknown as Prisma.InputJsonValue,
          settings: settings as unknown as Prisma.InputJsonValue, teardownSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          notes: dto.notes ?? null, castingStyle: dto.castingStyle ?? 'DIVERSE', createdById: auth.userId,
        },
      });
      const job = await this.openPlan(tx, b.id, auth, dto.requests, snapshot, settings.keepEdit);
      return { batchId: b.id, jobId: job.id };
    });
    void this.jobs.detach(jobId, `plano do lote ${batchId}`, () => this.runPlan(jobId, batchId));
    return this.get(auth, batchId);
  }

  /** Itens WRITING (+ controle READY e elenco SHARED no NEW_HOOKS) e o job VARIATIONS_PLAN, dentro da transação. */
  private async openPlan(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, requests: Requests, snapshot: TeardownSnapshot, keepEdit: boolean) {
    const job = await tx.job.create({
      data: { workspaceId: auth.workspaceId, type: 'VARIATIONS_PLAN', status: 'QUEUED', input: { requests } as unknown as Prisma.InputJsonValue, variationBatchId: batchId, createdById: auth.userId },
    });
    for (const r of requests) {
      if (r.kind === 'NEW_HOOKS' && keepEdit) {
        // §13.4 (a): gancho escrito; o próprio campeão é o controle (sem item controle, sem elenco)
        for (let i = 0; i < r.count; i++) {
          await tx.variationItem.create({ data: { workspaceId: auth.workspaceId, batchId, kind: r.kind, index: i, status: 'WRITING', jobId: job.id } });
        }
      } else if (r.kind === 'NEW_HOOKS') {
        const shared = await tx.variationCasting.create({ data: { workspaceId: auth.workspaceId, batchId, scope: 'SHARED', description: '' } });
        const hook = originalHook(snapshot);
        const payload: ItemPayload = { hook: { speech: hook.speech, onScreenText: hook.onScreenText }, hookDurationSec: hook.durationSec, blocks: itemBlocks('NEW_HOOKS', snapshot, hook) };
        await tx.variationItem.create({
          data: {
            workspaceId: auth.workspaceId, batchId, kind: 'NEW_HOOKS', index: CONTROL_INDEX, isControl: true, status: 'READY',
            lever: 'control', rationale: null, payload: payload as unknown as Prisma.InputJsonValue, castingId: shared.id, jobId: job.id,
          },
        });
        for (let i = 0; i < r.count; i++) {
          await tx.variationItem.create({ data: { workspaceId: auth.workspaceId, batchId, kind: r.kind, index: i, status: 'WRITING', castingId: shared.id, jobId: job.id } });
        }
      } else {
        for (let i = 0; i < r.count; i++) {
          await tx.variationItem.create({ data: { workspaceId: auth.workspaceId, batchId, kind: r.kind, index: i, status: 'WRITING', jobId: job.id } });
        }
      }
    }
    return job;
  }

  /** POST /variation-batches/:id/replan: PLAN_READY/PLAN_FAILED → PLANNING; itens e elencos antigos descartados. */
  async replan(auth: AuthContext, id: string, dto: ReplanBatchDto): Promise<VariationBatch> {
    const jobId = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      assertBatchCan(b.status, 'REPLAN');
      const champion = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId } });
      const requests = (dto.requests ?? (b.requests as unknown as Requests)) as Requests;
      this.validateRequests(requests, champion.hasSpeech);
      await this.custos.assertWithinCap(auth.workspaceId, requests.reduce((a, r) => a + r.count, 0) * PLAN_ITEM_ESTIMATE_USD);
      return this.prisma.$transaction(async (tx) => {
        await this.sm.transition({
          tx, batchId: b.id, event: 'REPLAN', from: b.status, to: 'PLANNING',
          data: {
            requests: requests as unknown as Prisma.InputJsonValue, ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.castingStyle && { castingStyle: dto.castingStyle }), estimatedCostUsd: null,
          },
        });
        await tx.variationItem.deleteMany({ where: { batchId: b.id } });
        await tx.variationCasting.deleteMany({ where: { batchId: b.id } });
        const snapshot = this.snap(b.teardownSnapshot);
        const settings = this.applyKeepEdit(settingsOf(b.settings), snapshot, requests.map((r) => r.kind));
        return (await this.openPlan(tx, b.id, auth, requests, snapshot, settings.keepEdit)).id;
      });
    });
    void this.jobs.detach(jobId, `plano do lote ${id}`, () => this.runPlan(jobId, id));
    return this.get(auth, id);
  }

  // ───────── plano (Claude) ─────────

  /** Roda o planVariations pros itens WRITING do job. Nunca lança. */
  async runPlan(jobId: string, batchId: string, opts: { itemIds?: string[]; note?: string } = {}): Promise<void> {
    try {
      const b = await this.prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { offer: true } });
      const snapshot = this.snap(b.teardownSnapshot);
      const settings = settingsOf(b.settings);
      const keepEdit = settings.keepEdit;
      await this.jobs.stage(jobId, 'reading_teardown', 10);
      const writing = await this.prisma.variationItem.findMany({
        where: { batchId, status: 'WRITING', isControl: false, ...(opts.itemIds && { id: { in: opts.itemIds } }) },
      });
      const others = await this.prisma.variationItem.findMany({ where: { batchId, status: 'READY', isControl: false }, select: { lever: true } });
      const byKey = new Map(writing.map((i) => [`${i.kind}:${i.index}`, i]));
      await this.jobs.stage(jobId, 'writing', 30);
      const notes = [b.notes, opts.note].filter(Boolean).join('\n') || null;
      // Cada gravação dos callbacks ganha o próprio catch NA HORA: rejeitar enquanto o planVariations ainda roda (o
      // Promise.all lá embaixo só chega depois) era rejeição não tratada e o Node saía (QA 06/10: lote apagado no meio
      // → P2003 no variationCasting.create). Falhou a gravação = item FAILED; o resto do plano segue.
      const pending: Promise<unknown>[] = [];
      const track = (what: string, itemId: string | null, p: Promise<unknown>) =>
        pending.push(p.catch(async (e) => {
          this.log.error(`plano ${batchId}: ${what} falhou: ${(e as Error)?.stack ?? e}`);
          if (itemId) await this.failItem(itemId, 'PROVIDER_ERROR').catch(() => undefined);
        }));
      await this.claude.planVariations(
        {
          workspaceId: b.workspaceId, batchId, jobId, language: b.language, offer: draftOf(b.offer), teardown: snapshot.sections as TeardownSections,
          transcript: snapshot.words, slots: writing.map((i) => ({ kind: i.kind, index: i.index })),
          avoidLevers: others.map((o) => o.lever).filter((l): l is string => !!l), notes,
          editMap: snapshot.editMap ?? null, ...(keepEdit && { hookMode: 'TEXT' as const }),
          ...castingPlanOf(b.castingStyle, settings, snapshot, writing.map((i) => i.kind)),
        },
        {
          onSharedCasting: (description) => {
            track('elenco compartilhado', null, this.prisma.variationCasting.updateMany({ where: { batchId, scope: 'SHARED', description: '' }, data: { description } }));
          },
          onItemDone: (kind, index, draft) => {
            const item = byKey.get(`${kind}:${index}`);
            if (item) track(`item ${item.id}`, item.id, this.saveDraft(item, draft, snapshot, keepEdit));
          },
          onItemFailed: (kind, index, code) => {
            const item = byKey.get(`${kind}:${index}`);
            if (item) track(`item ${item.id}`, item.id, this.failItem(item.id, code));
          },
        },
      );
      await Promise.all(pending);
    } catch (e) {
      const code = isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      if (!isIntegracaoError(e)) this.log.error(`plano ${batchId}: ${(e as Error).stack ?? e}`);
      await this.prisma.variationItem.updateMany({
        where: { batchId, status: 'WRITING', ...(opts.itemIds && { id: { in: opts.itemIds } }) },
        data: { status: 'FAILED', errorCode: asAsyncErrorCode(code), failReason: failReasonFor(asAsyncErrorCode(code)) },
      });
    }
    await this.settlePlan(jobId, batchId, opts.itemIds);
  }

  private async saveDraft(item: ItemRow, draft: VariationItemDraft, snapshot: TeardownSnapshot, keepEdit = false) {
    let payload: ItemPayload;
    let castingId = item.castingId;
    if (item.kind === 'NEW_HOOKS' && 'hook' in draft && keepEdit) {
      // §13.4 (a): fala e duração do original; só o texto da tela muda
      const orig = originalHook(snapshot);
      payload = { hook: { speech: orig.speech, onScreenText: draft.hook.onScreenText }, hookDurationSec: orig.durationSec, blocks: sourceBlocks(snapshot) };
    } else if (item.kind === 'NEW_HOOKS' && 'hook' in draft) {
      const hook = { speech: draft.hook.speech, durationSec: draft.hook.durationSec };
      payload = { hook: { speech: draft.hook.speech, onScreenText: draft.hook.onScreenText }, hookDurationSec: draft.hook.durationSec, blocks: itemBlocks('NEW_HOOKS', snapshot, hook) };
    } else if (item.kind === 'SWAP_AVATAR' && 'castingDescription' in draft) {
      payload = { blocks: itemBlocks('SWAP_AVATAR', snapshot) };
      if (castingId) {
        await this.prisma.variationCasting.update({ where: { id: castingId }, data: { description: draft.castingDescription } });
      } else {
        castingId = (await this.prisma.variationCasting.create({ data: { workspaceId: item.workspaceId, batchId: item.batchId, scope: 'ITEM', description: draft.castingDescription } })).id;
      }
    } else {
      return this.failItem(item.id, 'PROVIDER_ERROR');
    }
    await this.prisma.variationItem.updateMany({
      where: { id: item.id, status: 'WRITING' },
      data: { status: 'READY', lever: draft.lever, rationale: draft.rationale, payload: payload as unknown as Prisma.InputJsonValue, castingId, errorCode: null, failReason: null },
    });
  }

  private async failItem(itemId: string, code: string) {
    const ac = asAsyncErrorCode(code);
    await this.prisma.variationItem.updateMany({ where: { id: itemId, status: 'WRITING' }, data: { status: 'FAILED', errorCode: ac, failReason: failReasonFor(ac) } });
  }

  /** Fecha o job e, se o lote estava PLANNING, decide PLAN_READY (≥ 1 item READY) ou PLAN_FAILED (§3.2). */
  private async settlePlan(jobId: string, batchId: string, itemIds?: string[]) {
    await this.prisma.variationItem.updateMany({
      where: { batchId, status: 'WRITING', isControl: false, ...(itemIds && { id: { in: itemIds } }) },
      data: { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: failReasonFor('PROVIDER_ERROR') },
    });
    const items = await this.prisma.variationItem.findMany({ where: { batchId, isControl: false, ...(itemIds && { id: { in: itemIds } }) }, select: { status: true, errorCode: true } });
    const ready = items.filter((i) => i.status === 'READY').length;
    const status = ready === items.length ? 'SUCCEEDED' : ready ? 'PARTIAL' : 'FAILED';
    const code = status === 'FAILED' ? asAsyncErrorCode(items.find((i) => i.errorCode)?.errorCode) : null;
    await this.jobs.finish(jobId, { status, errorCode: code, failReason: code ? failReasonFor(code) : null }).catch(() => undefined);
    const b = await this.prisma.variationBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (b?.status === 'PLANNING') {
      const all = await this.prisma.variationItem.findMany({ where: { batchId, isControl: false }, select: { status: true } });
      if (all.some((i) => i.status === 'WRITING')) return;
      await this.sm
        .transition({ batchId, event: 'PLAN_SETTLED', from: 'PLANNING', to: all.some((i) => i.status === 'READY') ? 'PLAN_READY' : 'PLAN_FAILED' })
        .catch(() => undefined);
    }
  }

  // ───────── revisão do plano ─────────

  private async itemOf(batchId: string, itemId: string): Promise<ItemRow> {
    const i = await this.prisma.variationItem.findFirst({ where: { id: itemId, batchId } });
    if (!i) throw new AppException('NOT_FOUND');
    return i;
  }

  /** PATCH …/items/:itemId: só a alavanca do tipo (NEW_HOOKS: hook; COPY_NEW: blocks; todos: included). */
  async updateItem(auth: AuthContext, id: string, itemId: string, dto: UpdateItemDto): Promise<VariationItem> {
    return this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      if (b.status !== 'PLAN_READY') throw batchInvalidState(b.status, ['PLAN_READY']);
      const item = await this.itemOf(b.id, itemId);
      const bad = (field: string) => new AppException('VALIDATION_ERROR', { fields: [{ field, rule: 'notAllowedForKind' }] });
      if (dto.hook && (item.kind !== 'NEW_HOOKS' || item.isControl)) throw bad('hook');
      // §13.4 (a): no gancho escrito a fala é a do original (não editável)
      if (dto.hook?.speech !== undefined && item.kind === 'NEW_HOOKS' && settingsOf(b.settings).keepEdit) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'hook.speech', rule: 'notAllowedForHookMode' }] });
      }
      if (dto.blocks && item.kind !== 'COPY_NEW') throw bad('blocks');
      if (dto.included === false && item.isControl) throw bad('included');
      const p = payloadOf(item.payload);
      const data: Prisma.VariationItemUpdateInput = {};
      if (dto.included !== undefined) data.included = dto.included;
      if (dto.hook && p.hook) {
        const hook = { speech: dto.hook.speech ?? p.hook.speech, onScreenText: dto.hook.onScreenText !== undefined ? dto.hook.onScreenText : p.hook.onScreenText };
        const blocks = [...(p.blocks ?? [])];
        if (blocks[0]) blocks[0] = { ...blocks[0], speech: hook.speech };
        data.payload = { ...p, hook, blocks } as unknown as Prisma.InputJsonValue;
      }
      if (dto.blocks) {
        const blocks: ScriptBlock[] = [...(p.blocks ?? [])];
        for (const e of dto.blocks) {
          if (!blocks[e.index]) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `blocks.${e.index}.index`, rule: 'exists' }] });
          if (e.speech !== undefined) blocks[e.index] = { ...blocks[e.index], speech: e.speech };
        }
        data.payload = { ...p, blocks } as unknown as Prisma.InputJsonValue;
      }
      const fresh = await this.prisma.variationItem.update({ where: { id: item.id }, data });
      return this.views.item(fresh, null);
    });
  }

  /** "Regerar este": lote PLAN_READY e item READY|FAILED → item WRITING; o lote segue PLAN_READY (esclarecimento 06/10). */
  async regenerateItem(auth: AuthContext, id: string, itemId: string, note?: string): Promise<VariationItem> {
    const { item, jobId } = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      if (b.status !== 'PLAN_READY') throw batchInvalidState(b.status, ['PLAN_READY']);
      const item = await this.itemOf(b.id, itemId);
      if (item.isControl || (item.status !== 'READY' && item.status !== 'FAILED')) throw batchInvalidState(b.status, ['PLAN_READY']);
      await this.custos.assertWithinCap(auth.workspaceId, PLAN_ITEM_ESTIMATE_USD);
      return this.prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: { workspaceId: b.workspaceId, type: 'VARIATION_ITEM_REGENERATE', status: 'QUEUED', input: { itemId, note: note ?? null }, variationBatchId: b.id, createdById: auth.userId },
        });
        const item = await tx.variationItem.update({ where: { id: itemId }, data: { status: 'WRITING', lever: null, rationale: null, errorCode: null, failReason: null, jobId: job.id } });
        return { item, jobId: job.id };
      });
    });
    void this.jobs.detach(jobId, `item ${itemId} do lote ${id}`, () => this.runPlan(jobId, id, { itemIds: [itemId], note }));
    return this.views.item(item, null);
  }

  /** PATCH …/settings: só em PLAN_READY. */
  async updateSettings(auth: AuthContext, id: string, dto: BatchSettingsDto): Promise<VariationBatch> {
    await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      if (b.status !== 'PLAN_READY') throw batchInvalidState(b.status, ['PLAN_READY']);
      const kinds = (b.requests as unknown as Requests).map((r) => r.kind);
      const next = this.applyKeepEdit(this.mergeSettings(settingsOf(b.settings), dto), this.snap(b.teardownSnapshot), kinds);
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    });
    return this.get(auth, id);
  }

  // ───────── elencos ─────────

  private async castingOf(batchId: string, castingId: string) {
    const c = await this.prisma.variationCasting.findFirst({ where: { id: castingId, batchId }, include: { faces: { include: { file: true } } } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  async updateCasting(auth: AuthContext, id: string, castingId: string, description: string): Promise<VariationCasting> {
    const b = await this.load(auth, id);
    if (b.status === 'LAUNCHED') throw batchInvalidState(b.status, ['PLANNING', 'PLAN_READY', 'PLAN_FAILED']);
    await this.castingOf(b.id, castingId);
    await this.prisma.variationCasting.update({ where: { id: castingId }, data: { description } });
    return this.views.casting(await this.castingOf(b.id, castingId));
  }

  /** `count` (1-4, padrão 1) rostos Soul V2 pro elenco (mesma mecânica dos rostos v1; rosto com castingId). */
  async generateCastingFaces(auth: AuthContext, id: string, castingId: string, description: string, count: FaceCount = CASTING_FACES_DEFAULT): Promise<GenerateFacesResponse> {
    const { faces, batch, language } = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      if (b.status === 'LAUNCHED') throw batchInvalidState(b.status, ['PLANNING', 'PLAN_READY', 'PLAN_FAILED']);
      const c = await this.castingOf(b.id, castingId);
      if (c.faces.some((f) => f.status === 'QUEUED' || f.status === 'GENERATING')) throw batchInvalidState(b.status, ['PLAN_READY']);
      await this.custos.assertWithinCap(auth.workspaceId, this.catalog.estimateFaces(count));
      return this.prisma.$transaction(async (tx) => {
        await tx.variationCasting.update({ where: { id: c.id }, data: { description } });
        const last = await tx.face.findFirst({ where: { castingId: c.id }, orderBy: { batch: 'desc' }, select: { batch: true } });
        const batch = (last?.batch ?? 0) + 1;
        const faces = [];
        for (let position = 0; position < count; position++) {
          faces.push(await tx.face.create({ data: { workspaceId: b.workspaceId, castingId: c.id, batch, position, description, status: 'QUEUED' } }));
        }
        return { faces, batch, language: b.language };
      });
    });
    let submitted = 0;
    for (const f of faces) {
      try {
        await this.gen.submitFace({ workspaceId: f.workspaceId, faceId: f.id, description, language });
        await this.prisma.face.updateMany({ where: { id: f.id, status: 'QUEUED' }, data: { status: 'GENERATING' } });
        submitted++;
      } catch (e) {
        const blocked = isIntegracaoError(e) && e.code === 'SAFETY_BLOCK';
        this.log.warn(`submitFace (elenco) ${f.id} falhou: ${(e as Error).message}`);
        await this.rostos.failFace(f.id, blocked ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR');
        if (blocked) submitted++;
      }
    }
    if (!submitted) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'HIGGSFIELD' });
    const fresh = await this.prisma.face.findMany({ where: { id: { in: faces.map((f) => f.id) } }, include: { file: true }, orderBy: { position: 'asc' } });
    return { batch, faces: await Promise.all(fresh.map((f) => this.views.face({ ...f, status: f.status === 'GENERATING' ? 'QUEUED' : f.status }, null))) };
  }

  async selectCastingFace(auth: AuthContext, id: string, castingId: string, faceId: string): Promise<VariationCasting> {
    return this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      if (b.status === 'LAUNCHED') throw batchInvalidState(b.status, ['PLANNING', 'PLAN_READY', 'PLAN_FAILED']);
      const c = await this.castingOf(b.id, castingId);
      const face = c.faces.find((f) => f.id === faceId);
      if (!face) throw new AppException('NOT_FOUND');
      if (face.status !== 'READY') throw new AppException('INVALID_STATE', { state: face.status, allowed: ['READY'] });
      await this.prisma.variationCasting.update({ where: { id: c.id }, data: { selectedFaceId: face.id } });
      return this.views.casting(await this.castingOf(b.id, castingId));
    });
  }

  // ───────── estimativa e launch ─────────

  private engineModel(settings: BatchSettings): string {
    const lip = this.catalog.engines().find((e) => e.id === 'LIPSYNC');
    return settings.engine === 'LIPSYNC' && settings.engineModel ? settings.engineModel : lip?.models[0]?.id ?? 'pruna-lipsync';
  }

  /** Itens que entram no launch: incluídos; o controle entra sempre que houver gancho incluído. */
  private launchItems(items: ItemRow[]): ItemRow[] {
    const hooks = items.some((i) => i.kind === 'NEW_HOOKS' && !i.isControl && i.included);
    return items.filter((i) => (i.isControl ? hooks : i.included));
  }

  private costOf(plan: ItemPlan, model: string, settings: BatchSettings, faceDescription: string | null, snapshot?: TeardownSnapshot) {
    const { scenes, take } = plan;
    if (!scenes.length || scenes.every((s) => s.pipeline === 'SOURCE_CUT')) return { costUsd: 0, etaSec: 0, lines: [] as EstimateLine[], warnings: [] as string[] };
    if (scenes.some((s) => s.pipeline === 'SWAP_VIDEO')) {
      // §13.15.5: preço do item com motor de vídeo = cotação da ia (janelas + v2v/transcrição de todos os trechos)
      const q = snapshot && isVideoEngine(settings.swapEngine)
        ? swapItemQuote(this.catalog, settings.swapEngine, settings.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO', snapshot)
        : null;
      if (!q) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' });
      return { costUsd: q.perItemUsd, etaSec: q.etaSec, lines: q.lines, warnings: [] as string[] };
    }
    const audioSec = take ? plannedTakeAudioSec(take) : null;
    return this.catalog.estimate({
      engine: 'LIPSYNC', model, scenes: draftsOf(scenes), format: settings.format,
      ...(settings.voiceId && take?.kind !== 'AUDIO_LIPSYNC' && { voiceId: settings.voiceId }), ...(faceDescription && { faceDescription }),
      pipelines: scenes.map((s) => s.pipeline), audioSecByScene: audioSecOf(scenes),
      ...(take && { take: { kind: take.kind, ...(audioSec != null && { audioSec }) } }),
    });
  }

  private async computeEstimate(b: { id: string; settings: Prisma.JsonValue; teardownSnapshot: Prisma.JsonValue; workspaceId: string }, items: ItemRow[]) {
    const settings = settingsOf(b.settings);
    const snapshot = this.snap(b.teardownSnapshot);
    const model = this.engineModel(settings);
    const castings = await this.prisma.variationCasting.findMany({ where: { batchId: b.id } });
    const descOf = new Map(castings.map((c) => [c.id, c.description]));
    const out: BatchEstimate['items'] = [];
    const warnings = new Set<BatchEstimate['warnings'][number]>();
    let saved = 0;
    let eta = 0;
    for (const i of items) {
      const plan = planItem(this.catalog, i.kind, i.isControl, payloadOf(i.payload), snapshot, settings);
      const e = this.costOf(plan, model, settings, i.castingId ? descOf.get(i.castingId) ?? null : null, snapshot);
      for (const w of e.warnings) if (w === 'voice_gender_mismatch') warnings.add(w);
      if (plan.scenes.some((s) => s.pipeline === 'REUSE')) {
        const asOwn = plan.scenes.map((s) => (s.pipeline === 'REUSE' ? { ...s, pipeline: 'TTS_LIPSYNC' as const } : s));
        saved += this.costOf({ take: null, scenes: asOwn }, model, settings, null).costUsd - e.costUsd;
      }
      eta = Math.max(eta, e.etaSec);
      out.push({ itemId: i.id, kind: i.kind, costUsd: r4(e.costUsd), lines: e.lines });
    }
    if (snapshot.width && snapshot.height && Math.min(snapshot.width, snapshot.height) < LOW_RES_SIDE_PX) warnings.add('low_resolution');
    const costUsd = r4(out.reduce((a, x) => a + x.costUsd, 0));
    const swaps = items.filter((i) => i.kind === 'SWAP_AVATAR').length;
    return { costUsd, etaSec: eta, savedByReuseUsd: r4(Math.max(0, saved)), items: out, warnings: [...warnings], swapQuotes: this.swapQuotes(settings, snapshot, swaps) };
  }

  /**
   * §13.15.6: os 3 motores do Trocar avatar lado a lado (5 linhas, preço da ia). null sem item SWAP_AVATAR incluído ou
   * com o catálogo ainda sem cotação (I6). `selected` = settings do lote; `available` = bloqueios do campeão + build.
   */
  private swapQuotes(settings: BatchSettings, snapshot: TeardownSnapshot, swaps: number): SwapQuote[] | null {
    if (!swaps) return null;
    const keep = keepEditOf({ status: 'READY' }, snapshot.editMap ?? null).SWAP_AVATAR;
    const ev = engineVoiceOf({ status: 'READY' }, snapshot.editMap ?? null);
    const music = snapshot.sections.audio?.status === 'ok' ? (snapshot.sections.audio.data?.music ?? '').trim() : '';
    const hasMusic = !!music && !/^(none|no music|sem m[uú]sica|n\/a|-)$/i.test(music);
    const out: SwapQuote[] = [];
    for (const k of QUOTE_COMBOS) {
      const q = swapItemQuote(this.catalog, k.engine, k.voiceSource, snapshot);
      if (!q) return null;
      const engineVoice = k.voiceSource === 'ENGINE_VOICE';
      const notEnabled = engineVoice && !engineVoiceEnabled(k.engine);
      // LIPSYNC: limpo ou mantendo a edição (§13.3); motor de vídeo exige manter a edição
      const blockers = engineVoice ? ev.blockers : isVideoEngine(k.engine) ? keep.blockers : [];
      const warnings = new Set<SwapQuoteWarning>(q.warnings);
      if (engineVoice && hasMusic) warnings.add('music_bed_drops');
      out.push({
        ...q, engine: k.engine, voiceSource: k.voiceSource, available: !notEnabled && blockers.length === 0, blockers, notEnabled,
        selected: settings.swapEngine === k.engine && (k.engine === 'LIPSYNC' || (settings.voiceSource === 'ENGINE_VOICE') === engineVoice),
        perItemUsd: r4(q.perItemUsd), costUsd: r4(q.perItemUsd * swaps), warnings: [...warnings],
      });
    }
    return out;
  }

  /** GET …/estimate: só itens incluídos e READY; item incluído fora de READY = 422 BATCH_INCOMPLETE. */
  async estimate(auth: AuthContext, id: string): Promise<BatchEstimate> {
    const b = await this.load(auth, id);
    const items = this.launchItems(await this.prisma.variationItem.findMany({ where: { batchId: b.id }, orderBy: [{ kind: 'asc' }, { index: 'asc' }] }));
    const notReady = items.filter((i) => i.status !== 'READY');
    if (notReady.length) throw new AppException('BATCH_INCOMPLETE', { missing: notReady.map((i) => ({ itemId: i.id, reason: 'not_ready' })) });
    const e = await this.computeEstimate(b, items);
    return { ...e, spend: await this.custos.spendWith(auth.workspaceId, e.costUsd) };
  }

  /** O que falta pro launch (§4.3): item pronto, rosto escolhido em cada elenco usado, voz quando há TTS. */
  private async missingFor(items: ItemRow[], settings: BatchSettings): Promise<Missing> {
    const missing: Missing = [];
    for (const i of items) if (i.status !== 'READY') missing.push({ itemId: i.id, reason: 'not_ready' });
    const castingIds = [...new Set(items.map((i) => i.castingId).filter((x): x is string => !!x))];
    const castings = await this.prisma.variationCasting.findMany({ where: { id: { in: castingIds } } });
    for (const c of castings) if (!c.selectedFaceId) missing.push({ castingId: c.id, reason: 'face_not_selected' });
    // §13.4 (a): gancho escrito não tem rosto nem voz
    const textHook = (i: ItemRow) => i.kind === 'NEW_HOOKS' && settings.keepEdit;
    for (const i of items) if (!i.castingId && i.status === 'READY' && !textHook(i)) missing.push({ itemId: i.id, reason: 'not_ready' });
    const needsVoice = items.some((i) => (i.kind === 'NEW_HOOKS' && !settings.keepEdit) || (i.kind === 'SWAP_AVATAR' && !settings.keepEdit && settings.voiceSource === 'CATALOG'));
    if (needsVoice && !settings.voiceId) missing.push({ field: 'voiceId' });
    return missing;
  }

  /** POST …/launch: OK único. Cria 1 criativo por item em SCENES_GENERATING (§3.3) e dispara as cenas. */
  async launch(auth: AuthContext, id: string, expectedCostUsd: number): Promise<LaunchBatchResponse> {
    const created = await this.locks.run(`batch:${id}`, async () => {
      const b = await this.load(auth, id);
      assertBatchCan(b.status, 'LAUNCH');
      const settings = settingsOf(b.settings);
      const items = this.launchItems(await this.prisma.variationItem.findMany({ where: { batchId: b.id } }));
      if (!items.length) throw new AppException('BATCH_INCOMPLETE', { missing: [] });
      const missing = await this.missingFor(items, settings);
      if (missing.length) throw new AppException('BATCH_INCOMPLETE', { missing });
      const est = await this.computeEstimate(b, items);
      if (est.costUsd > expectedCostUsd * MAX_ESTIMATE_DRIFT) throw new AppException('ESTIMATE_CHANGED', { estimateUsd: est.costUsd });
      await this.custos.assertWithinCap(auth.workspaceId, est.costUsd);

      const snapshot = this.snap(b.teardownSnapshot);
      const model = this.engineModel(settings);
      const castings = new Map((await this.prisma.variationCasting.findMany({ where: { batchId: b.id } })).map((c) => [c.id, c]));
      const costByItem = new Map(est.items.map((x) => [x.itemId, x.costUsd]));
      // controle primeiro: as cenas do corpo dele são as donas das seguidoras REUSE
      const ordered = [...items].sort((a, b2) => Number(b2.isControl) - Number(a.isControl) || a.kind.localeCompare(b2.kind) || a.index - b2.index);
      const counters = new Map<VariationKind, number>();
      const now = new Date();
      const plans = new Map(items.map((i) => [i.id, planItem(this.catalog, i.kind, i.isControl, payloadOf(i.payload), snapshot, settings)]));
      for (const pl of plans.values()) if (pl.take) assertTakeLength(pl.take);
      const champion = await this.prisma.champion.findUniqueOrThrow({ where: { id: b.championId }, select: { videoFileId: true, thumbnailFileId: true } });

      return this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, batchId: b.id, event: 'LAUNCH', from: 'PLAN_READY', to: 'LAUNCHED', data: { estimatedCostUsd: est.costUsd, launchedAt: now } });
        const ownerByBody = new Map<number, string>();
        const out: string[] = [];
        for (const i of ordered) {
          const p = payloadOf(i.payload);
          const n = (counters.get(i.kind) ?? 0) + 1;
          if (!i.isControl) counters.set(i.kind, n);
          const name = `${b.champion.name} · ${VARIATION_KIND_LABEL[i.kind]}${i.isControl ? ' · Control' : ` ${n}`}`.slice(0, 200);
          const casting = i.castingId ? castings.get(i.castingId)! : null;
          const plan = plans.get(i.id)!;
          const textHook = i.kind === 'NEW_HOOKS' && settings.keepEdit;
          const voiceSource = i.kind === 'SWAP_AVATAR' ? settings.voiceSource : 'CATALOG';
          // §13: manter a edição = template remix-keep (a edição é a do campeão; o PATCH /edit fica travado)
          const keep = settings.keepEdit && (i.kind === 'SWAP_AVATAR' || i.kind === 'NEW_HOOKS');
          // §13.15: Trocar avatar com Kling/Seedance = cenas SWAP_VIDEO (motor SCENES), sem take
          const swapModel = i.kind === 'SWAP_AVATAR' && plan.scenes.some((s) => s.pipeline === 'SWAP_VIDEO') && isVideoEngine(settings.swapEngine)
            ? SWAP_MODEL[settings.swapEngine] : null;
          const edit: EditSettings = {
            ...settings.edit, ...(i.kind === 'NEW_HOOKS' && { headline: p.hook?.onScreenText ?? settings.edit.headline }), ...(keep && { templateId: 'remix-keep' }),
          };
          const c = await tx.creative.create({
            data: {
              workspaceId: b.workspaceId, offerId: b.offerId, name, language: b.language, state: 'SCENES_GENERATING', stateChangedAt: now,
              selectedFaceId: casting?.selectedFaceId ?? null, faceDescription: casting?.description ?? null,
              engine: textHook ? null : swapModel ? 'SCENES' : 'LIPSYNC', engineModel: textHook ? null : swapModel ?? model,
              voiceId: voiceSource === 'CATALOG' && !textHook ? settings.voiceId : null, format: settings.format,
              estimatedCostUsd: costByItem.get(i.id) ?? 0, generatedAt: now, editSettings: edit as unknown as Prisma.InputJsonValue,
              origin: 'VARIATION', championId: b.championId, variationBatchId: b.id, variationItemId: i.id, variationKind: i.kind, voiceSource,
              createdById: auth.userId,
            },
          });
          const blocks = p.blocks ?? [];
          const script = await tx.script.create({
            data: {
              workspaceId: b.workspaceId, creativeId: c.id, letter: 'A', status: 'READY', angle: i.lever, rationale: i.rationale,
              durationSec: blocks.length ? blocks[blocks.length - 1].endSec : null, blocks: blocks as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.creative.update({ where: { id: c.id }, data: { selectedScriptId: script.id } });
          const take = plan.take ? await this.geracao.createTake(tx, c, 1, plan.take, now) : null;
          for (const s of plan.scenes) {
            const reuseOf = s.pipeline === 'REUSE' ? ownerByBody.get(s.bodyIndex!) ?? null : null;
            // §13.4 (a): SOURCE_CUT = o vídeo do campeão, sem provedor (US$ 0), pronto na hora
            const cut = s.pipeline === 'SOURCE_CUT';
            const row = await tx.scene.create({
              data: {
                workspaceId: b.workspaceId, creativeId: c.id, generation: 1, index: s.index, label: s.label, startSec: s.startSec, endSec: s.endSec,
                speech: s.speech, visualPrompt: s.visualPrompt, status: cut ? 'READY' : 'QUEUED', startedAt: now,
                ...(cut && { progress: 100, readyAt: now, clipFileId: champion.videoFileId, thumbnailFileId: champion.thumbnailFileId }),
                ...(take && { takeId: take.id }),
                // REUSE sem dona (controle fora): vira cena própria
                pipeline: s.pipeline === 'REUSE' && !reuseOf ? 'TTS_LIPSYNC' : s.pipeline,
                sourceStartSec: s.sourceStartSec, sourceEndSec: s.sourceEndSec, reuseOfSceneId: reuseOf,
                ...(s.words && { words: s.words as unknown as Prisma.InputJsonValue }),
                ...(s.frames && { startFrame: s.frames.startFrame, endFrame: s.frames.endFrame }),
              },
            });
            if (i.isControl && s.bodyIndex != null) ownerByBody.set(s.bodyIndex, row.id);
          }
          out.push(c.id);
        }
        return out;
      });
    });

    // cenas: primeiro passo de cada (donas antes das seguidoras), depois fecha a geração de cada criativo
    let submitted = 0;
    let total = 0;
    for (const cid of created) {
      this.creativeSm.announce(cid);
      const c = await this.prisma.creative.findUniqueOrThrow({ where: { id: cid } });
      const scenes = await this.prisma.scene.findMany({ where: { creativeId: cid }, orderBy: { index: 'asc' } });
      for (const s of scenes) {
        // REUSE acompanha a dona; SOURCE_CUT nasce READY (sem provedor); TAKE_SLICE vai com o take
        if (s.pipeline === 'REUSE' || s.pipeline === 'SOURCE_CUT' || s.pipeline === 'TAKE_SLICE') continue;
        total++;
        if (await this.geracao.submitFirstStep(c, s.id)) submitted++;
      }
      // §13.5: o take do criativo (1 por geração)
      const take = await this.prisma.take.findFirst({ where: { creativeId: cid, generation: 1 } });
      if (take) {
        total++;
        if (await this.takes.submitFirstStep(c, take.id)) submitted++;
      }
    }
    for (const cid of created) {
      for (const s of await this.prisma.scene.findMany({ where: { creativeId: cid, pipeline: 'REUSE' } })) await this.geracao.syncReuse(s.id);
      await this.geracao.settle(cid);
    }
    if (total && !submitted) throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'WAVESPEED' });
    const rows = await this.prisma.creative.findMany({ where: { id: { in: created } }, include: CREATIVE_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const creatives: CreativeRow[] = [];
    for (const cid of created) creatives.push(await this.creativeViews.row(byId.get(cid)!));
    return { batch: await this.get(auth, id), creatives };
  }

  // ───────── retomada ─────────

  /** Boot (só lotes MANUAL: itens AUTO nascem READY): itens WRITING de lote PLANNING → FAILED INTERRUPTED e o lote fecha (PLAN_READY/PLAN_FAILED). */
  async recover(workspaceId?: string): Promise<number> {
    const items = await this.prisma.variationItem.findMany({ where: { ...(workspaceId && { workspaceId }), status: 'WRITING' }, select: { id: true, batchId: true } });
    const batches = new Set(items.map((i) => i.batchId));
    for (const i of items) await this.failItem(i.id, 'INTERRUPTED');
    for (const batchId of batches) {
      const b = await this.prisma.variationBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (b?.status !== 'PLANNING') continue;
      const all = await this.prisma.variationItem.findMany({ where: { batchId, isControl: false }, select: { status: true } });
      await this.sm
        .transition({ batchId, event: 'PLAN_SETTLED', from: 'PLANNING', to: all.some((x) => x.status === 'READY') ? 'PLAN_READY' : 'PLAN_FAILED' })
        .catch(() => undefined);
    }
    return items.length;
  }
}
