// meta-v1.md §3.3: publicar um Creative APPROVED na Meta (vídeo → campanha → conjunto → criativo → anúncio, tudo
// PAUSED), com os ids gravados em MetaPublication a cada etapa (retry retoma sem duplicar), activate/pause e a lista.
import { AmostraService } from '../amostra/amostra.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreativeMetaResponse, MetaCallToAction, MetaObjective, MetaPublication as MetaPublicationView, MetaPublishBatchResponse, MetaPublishDefaults,
  MetaPublishSettings, MetaPublishTemplate as MetaPublishTemplateView,
} from '@maquina/contratos';
import { Prisma, type Job, type MetaConnection, type MetaPublication } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { initials } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { blocksOf } from '../criativos/views';
import { paramsOf, suggestedPrimaryTextOf } from '../edicao/pecas';
import { META_PUBLISH_STAGES, META_SERVICE, type MetaAuth, type MetaPublishIds, type MetaPublishInput, type MetaService, accountUnusable, isMetaError } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { presentJob } from '../jobs/job.presenter';
import { PrismaService } from '../prisma/prisma.service';
import { asMetaAsyncCode, assertSelected, assertUsable, countriesOf, markTokenInvalid, metaActionOf, metaAuthOf, metricsOf, ZERO_METRICS } from './comum';
import { MetaConexaoService, storedHealthOf } from './conexao.service';
import { MetaEscritaService } from './escrita.service';
import { POLICY_BLOCKED } from './campanhas.views';
import type { MetaPublishBatchDto, MetaPublishDto } from './meta.dto';
import { MetaTemplatesService } from './templates.service';
import { groupKeyOf, isoDate, parseGroupKey, pixelMissing, planGroups, planOf, resolveName, structureOf } from './templates';
import { RESULT_PROFILE, pixelEventFor } from '../workspaces/resultado';

const PUB_INCLUDE = { createdBy: { select: { id: true, name: true } } } satisfies Prisma.MetaPublicationInclude;
type PubRow = Prisma.MetaPublicationGetPayload<{ include: typeof PUB_INCLUDE }>;

const STAGE_PROGRESS: Record<string, number> = { uploading_video: 5, processing_video: 25, creating_campaign: 50, creating_adset: 65, creating_creative: 80, creating_ad: 92 };
const CTA_BY_OBJECTIVE: Record<MetaObjective, MetaCallToAction> = { OUTCOME_SALES: 'SHOP_NOW', OUTCOME_LEADS: 'SIGN_UP', OUTCOME_APP_PROMOTION: 'DOWNLOAD', OUTCOME_TRAFFIC: 'LEARN_MORE' };
const NEEDS_PIXEL: MetaObjective[] = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION'];

@Injectable()
export class MetaPublicacaoService {
  private readonly log = new Logger('MetaPublish');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly locks: KeyedMutex,
    private readonly conexao: MetaConexaoService,
    private readonly escrita: MetaEscritaService,
    private readonly templates: MetaTemplatesService,
    private readonly amostra: AmostraService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  /** Nome do anúncio pro MetaChange (snapshot; senão o id). */
  private async adName(connectionId: string, metaAdId: string): Promise<string> {
    const s = await this.prisma.metaAdSnapshot.findFirst({ where: { connectionId, metaAdId }, select: { name: true } });
    return s?.name ?? metaAdId;
  }

  // ───────── leitura ─────────

  private async creative(auth: AuthContext, id: string) {
    const c = await this.prisma.creative.findFirst({
      where: { id, workspaceId: auth.workspaceId, archivedAt: null },
      include: {
        offer: true, workspace: true, selectedScript: true, finalRender: { include: { file: true } }, thumbnail: true,
        variationItem: { select: { autoType: true, payload: true } }, // 25/10 D14: primaryText sugerido da moldura read_caption
      },
    });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  /** 1 publicação = presentMany de 1 (mesmas 2 queries). */
  async present(p: PubRow): Promise<MetaPublicationView> {
    return (await this.presentMany([p]))[0];
  }

  /**
   * N publicações em 2 queries (jobs + snapshots por id), sem N+1: a lista, o histórico do criativo e o Campaigns v0
   * passam por aqui. Ordem de entrada preservada.
   */
  async presentMany(rows: PubRow[]): Promise<MetaPublicationView[]> {
    if (!rows.length) return [];
    const jobIds = rows.map((p) => p.jobId).filter((x): x is string => !!x);
    const withAd = rows.filter((p) => !!p.metaAdId);
    const [jobs, snaps] = await Promise.all([
      jobIds.length ? this.prisma.job.findMany({ where: { id: { in: jobIds } } }) : [],
      withAd.length
        ? this.prisma.metaAdSnapshot.findMany({
          where: { OR: withAd.map((p) => ({ connectionId: p.connectionId, metaAdId: p.metaAdId! })) },
          select: { connectionId: true, metaAdId: true, metrics: true },
        })
        : [],
    ]);
    const jobBy = new Map(jobs.map((j) => [j.id, j]));
    const snapBy = new Map(snaps.map((sn) => [`${sn.connectionId}:${sn.metaAdId}`, sn]));
    return rows.map((p) => {
      const job = p.jobId ? jobBy.get(p.jobId) ?? null : null;
      const snap = p.metaAdId ? snapBy.get(`${p.connectionId}:${p.metaAdId}`) ?? null : null;
      return this.view(p, job, snap);
    });
  }

  private view(p: PubRow, job: Job | null, snap: { metrics: Prisma.JsonValue } | null): MetaPublicationView {
    return {
      id: p.id, status: p.status, creativeId: p.creativeId, adAccountId: p.adAccountId,
      ids: { videoId: p.videoId, creativeId: p.metaCreativeId, campaignId: p.campaignId, adsetId: p.adsetId, adId: p.metaAdId },
      settings: p.settings as unknown as MetaPublishSettings,
      adsManagerUrl: p.metaAdId ? this.meta.adsManagerUrl(p.adAccountId, p.metaAdId) : null,
      previewUrl: p.previewUrl,
      job: job ? presentJob(job) : null,
      errorCode: p.status === 'FAILED' && p.errorCode ? asMetaAsyncCode(p.errorCode) : null,
      failReason: p.status === 'FAILED' ? p.failReason : null,
      action: p.status === 'FAILED' ? metaActionOf(p.errorCode) ?? 'retry' : null,
      metrics: snap ? metricsOf(snap.metrics) : null,
      publishedAt: p.publishedAt?.toISOString() ?? null, activatedAt: p.activatedAt?.toISOString() ?? null,
      createdBy: { id: p.createdBy.id, name: p.createdBy.name, initials: initials(p.createdBy.name) },
      createdAt: p.createdAt.toISOString(),
    };
  }

  private async load(auth: AuthContext, id: string): Promise<PubRow> {
    const p = await this.prisma.metaPublication.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: PUB_INCLUDE });
    if (!p) throw new AppException('NOT_FOUND');
    return p;
  }

  /** Publicação atual do criativo (a mais recente). */
  private async latest(auth: AuthContext, creativeId: string): Promise<PubRow | null> {
    return this.prisma.metaPublication.findFirst({ where: { creativeId, workspaceId: auth.workspaceId }, orderBy: { createdAt: 'desc' }, include: PUB_INCLUDE });
  }

  /** GET /creatives/:id/meta: publicação atual, histórico (SÓ as anteriores; vazio na 1ª), defaults (null sem conexão) e conexão. */
  async creativeMeta(auth: AuthContext, id: string): Promise<CreativeMetaResponse> {
    const c = await this.creative(auth, id);
    const [history, conn] = await Promise.all([
      this.prisma.metaPublication.findMany({ where: { creativeId: c.id }, orderBy: { createdAt: 'desc' }, include: PUB_INCLUDE }),
      this.prisma.metaConnection.findUnique({ where: { workspaceId: auth.workspaceId } }),
    ]);
    const usable = conn && conn.status !== 'DISCONNECTED' && conn.tokenCiphertext ? conn : null;
    const health = usable ? storedHealthOf(usable.lastHealth) : null;
    const views = await this.presentMany(history);
    const current = views[0] ?? null;
    return {
      publication: current,
      history: views.filter((v) => v.id !== current?.id), // §3.3 (21/10 pós-QA): a atual não repete no histórico
      defaults: usable ? this.defaults(c, usable) : null,
      connection: usable ? { status: usable.status, canPublish: health?.canPublish ?? false } : null,
    };
  }

  /** Defaults pré-preenchidos (§2 MetaPublishDefaults). */
  defaults(c: Awaited<ReturnType<MetaPublicacaoService['creative']>>, conn: MetaConnection): MetaPublishDefaults {
    // resultado-v1 (28/10): objetivo e evento do pixel saem do resultType do cliente (workspaces/resultado.ts)
    const rt = c.workspace.resultType;
    const byType: MetaObjective = rt ? RESULT_PROFILE[rt].objective : 'OUTCOME_TRAFFIC';
    const noPixel = !conn.pixelId && NEEDS_PIXEL.includes(byType);
    const objective: MetaObjective = noPixel ? 'OUTCOME_TRAFFIC' : byType;
    const pixelEvent = conn.pixelId ? pixelEventFor(objective, rt) : null;
    const health = storedHealthOf(conn.lastHealth);
    const firstSpeech = c.selectedScript ? blocksOf(c.selectedScript.blocks)[0]?.speech?.trim() : '';
    const settings = (c.editSettings ?? {}) as { headline?: string | null };
    const headline = (settings.headline?.trim() || c.offer.what?.trim() || null)?.slice(0, 40) ?? null;
    return {
      objective, objectiveReason: noPixel ? 'no_pixel' : 'business_type', pixelEvent,
      countries: countriesOf(c.workspace.market), ageMin: 18, ageMax: 65,
      dailyBudgetMinor: health?._account?.minimumDailyBudgetMinor ?? null, currency: conn.currency,
      page: conn.pageId ? { id: conn.pageId, name: conn.pageName ?? conn.pageId } : null,
      pixel: conn.pixelId ? { id: conn.pixelId, name: conn.pixelName ?? conn.pixelId } : null,
      name: c.adName ?? c.name,
      // estatico-montado-e-molduras-v1 D14: peça FRAME read_caption traz o texto que paga a curiosidade da moldura
      primaryText: (c.variationItem?.autoType === 'FRAME' ? suggestedPrimaryTextOf(paramsOf(c.variationItem.payload)) : null)
        || firstSpeech || c.offer.promise?.trim() || '',
      headline, description: null,
      callToAction: CTA_BY_OBJECTIVE[objective],
      link: c.offer.sourceUrl ?? c.workspace.websiteUrl ?? null,
    };
  }

  // ───────── publicar ─────────

  /**
   * POST /creatives/:id/meta/publish: APPROVED com render final (409 not_approved), sem outra PUBLISHING (409
   * publish_in_progress), conexão com conta e página (422), pixel por objetivo (422 META_PIXEL_REQUIRED), conta
   * utilizável (422 META_ACCOUNT_UNUSABLE), orçamento ≥ mínimo (422 META_BUDGET_TOO_LOW). Cria a linha + job e roda.
   */
  async publish(auth: AuthContext, id: string, dto: MetaPublishDto): Promise<MetaPublicationView> {
    if (dto.templateId !== undefined) return this.publishWithTemplate(auth, id, dto);
    const pubId = await this.locks.run(`meta-pub:${id}`, async () => {
      const c = await this.creative(auth, id);
      const render = c.finalRender;
      if (c.state !== 'APPROVED' || !render?.file || !render.file.mimeType.startsWith('video/')) {
        throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'not_approved' });
      }
      const inFlight = await this.prisma.metaPublication.count({ where: { creativeId: c.id, status: 'PUBLISHING' } });
      if (inFlight) throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'publish_in_progress' });
      const conn = assertSelected(await this.conexao.usable(auth.workspaceId));
      // health antes de toda publicação (§3.1): atualiza conta/token; o que bloqueia é conferido abaixo
      const health = await this.conexao.runHealth(conn.id).catch((e) => {
        if (e instanceof AppException) throw e;
        return storedHealthOf(conn.lastHealth);
      });
      const fresh = assertSelected(await this.conexao.usable(auth.workspaceId));
      const d = this.defaults(c, fresh);
      const objective = dto.objective ?? d.objective;
      if (NEEDS_PIXEL.includes(objective) && !fresh.pixelId) throw new AppException('META_PIXEL_REQUIRED', { objective });
      if (accountUnusable(fresh.accountStatus)) throw new AppException('META_ACCOUNT_UNUSABLE', { accountStatus: fresh.accountStatus, label: accountLabel(fresh.accountStatus) });
      const minimum = health?._account?.minimumDailyBudgetMinor ?? null;
      if (minimum != null && dto.dailyBudgetMinor < minimum) throw new AppException('META_BUDGET_TOO_LOW', { minimumMinor: minimum, currency: fresh.currency ?? 'USD' });
      const settings: MetaPublishSettings = {
        dailyBudgetMinor: dto.dailyBudgetMinor, countries: dto.countries, objective, primaryText: dto.primaryText,
        headline: dto.headline?.trim() || null, description: dto.description?.trim() || null, callToAction: dto.callToAction, link: dto.link,
        specialAdCategories: dto.specialAdCategories ?? [], ageMin: dto.ageMin ?? 18, ageMax: dto.ageMax ?? 65,
        objectiveReason: dto.objective && dto.objective !== d.objective ? 'business_type' : d.objectiveReason,
        // resultado-v1: o evento do resultType quando o objetivo é o dele; trocou o objetivo = evento padrão do objetivo
        pixelEvent: fresh.pixelId ? pixelEventFor(objective, c.workspace.resultType) : null,
      };
      const { pub } = await this.prisma.$transaction(async (tx) => {
        const pub = await tx.metaPublication.create({
          data: {
            workspaceId: auth.workspaceId, connectionId: fresh.id, creativeId: c.id, status: 'PUBLISHING', adAccountId: fresh.adAccountId, pageId: fresh.pageId,
            pixelId: fresh.pixelId, settings: settings as unknown as Prisma.InputJsonValue, renderFileId: render.file!.id, createdById: auth.userId,
          },
        });
        const job = await tx.job.create({
          data: { workspaceId: auth.workspaceId, type: 'META_PUBLISH', status: 'QUEUED', input: { publicationId: pub.id }, creativeId: c.id, metaPublicationId: pub.id, createdById: auth.userId },
        });
        await tx.metaPublication.update({ where: { id: pub.id }, data: { jobId: job.id } });
        return { pub, job };
      });
      return pub.id;
    });
    const p = await this.prisma.metaPublication.findUniqueOrThrow({ where: { id: pubId } });
    void this.jobs.detach(p.jobId, 'publicação na Meta', () => this.run(p.jobId!, p.id));
    return this.present(await this.load(auth, pubId));
  }

  // ───────── meta-templates-v1: publicar com template / lote ─────────

  /** Conta pronta pra publicar: conta+página (422), health rodado antes (§3.1), conta utilizável (422). */
  private async gate(auth: AuthContext) {
    const conn = assertSelected(await this.conexao.usable(auth.workspaceId));
    const health = await this.conexao.runHealth(conn.id).catch((e) => {
      if (e instanceof AppException) throw e;
      return storedHealthOf(conn.lastHealth);
    });
    const fresh = assertSelected(await this.conexao.usable(auth.workspaceId));
    if (accountUnusable(fresh.accountStatus)) throw new AppException('META_ACCOUNT_UNUSABLE', { accountStatus: fresh.accountStatus, label: accountLabel(fresh.accountStatus) });
    return { fresh, minimum: health?._account?.minimumDailyBudgetMinor ?? null };
  }

  /** Template → checagens de pixel e orçamento iguais às da publicação de hoje. */
  private async templateFor(auth: AuthContext, templateId: string, fresh: MetaConnection & { adAccountId: string }, minimum: number | null): Promise<MetaPublishTemplateView> {
    const tpl = this.templates.present(await this.templates.load(auth, templateId, fresh));
    if (pixelMissing(tpl.campaign, tpl.adset)) throw new AppException('META_PIXEL_REQUIRED', { objective: tpl.campaign.objective });
    if (minimum != null && tpl.campaign.dailyBudgetMinor < minimum) throw new AppException('META_BUDGET_TOO_LOW', { minimumMinor: minimum, currency: fresh.currency ?? 'USD' });
    return tpl;
  }

  /** Settings resolvidos do template (só o que a publicação usa; o template fica no templateId). Texto null herda do criativo/oferta. */
  private templateSettings(c: Awaited<ReturnType<MetaPublicacaoService['creative']>>, conn: MetaConnection, tpl: MetaPublishTemplateView): MetaPublishSettings {
    const d = this.defaults(c, conn);
    const objective = tpl.campaign.objective;
    const primaryText = (tpl.ad.primaryText ?? d.primaryText ?? '').trim();
    if (!primaryText) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'ad.primaryText', rule: 'inheritedEmpty' }], creativeId: c.id });
    return {
      dailyBudgetMinor: tpl.campaign.dailyBudgetMinor, countries: tpl.adset.countries, objective, primaryText,
      headline: tpl.ad.headline ?? d.headline, description: tpl.ad.description ?? d.description,
      callToAction: tpl.ad.callToAction, link: tpl.ad.link, specialAdCategories: tpl.campaign.specialAdCategories,
      ageMin: tpl.adset.ageMin, ageMax: tpl.adset.ageMax,
      objectiveReason: objective === d.objective ? d.objectiveReason : 'business_type',
      pixelEvent: tpl.adset.pixelId ? tpl.adset.pixelEvent ?? pixelEventFor(objective, c.workspace.resultType) : null,
    };
  }

  /** POST /creatives/:id/meta/publish { templateId }: 1 anúncio; campanha nova ou a reaproveitada (REUSE), ad set próprio. */
  private async publishWithTemplate(auth: AuthContext, id: string, dto: MetaPublishDto): Promise<MetaPublicationView> {
    const extra = Object.entries(dto).filter(([k, v]) => k !== 'templateId' && v !== undefined).map(([k]) => ({ field: k, rule: 'exclusiveWithTemplateId' }));
    if (extra.length) throw new AppException('VALIDATION_ERROR', { fields: extra });
    const pubId = await this.locks.run(`meta-pub:${id}`, async () => {
      const c = await this.creative(auth, id);
      const render = c.finalRender;
      if (c.state !== 'APPROVED' || !render?.file || !render.file.mimeType.startsWith('video/')) {
        throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'not_approved' });
      }
      if (await this.prisma.metaPublication.count({ where: { creativeId: c.id, status: 'PUBLISHING' } })) {
        throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'publish_in_progress' });
      }
      const { fresh, minimum } = await this.gate(auth);
      const tpl = await this.templateFor(auth, dto.templateId!, fresh, minimum);
      const settings = this.templateSettings(c, fresh, tpl);
      return this.prisma.$transaction(async (tx) => {
        const pub = await tx.metaPublication.create({
          data: {
            workspaceId: auth.workspaceId, connectionId: fresh.id, creativeId: c.id, status: 'PUBLISHING', adAccountId: fresh.adAccountId, pageId: fresh.pageId,
            pixelId: tpl.adset.pixelId, settings: settings as unknown as Prisma.InputJsonValue, renderFileId: render.file!.id, createdById: auth.userId, templateId: tpl.id,
          },
        });
        const job = await tx.job.create({
          data: { workspaceId: auth.workspaceId, type: 'META_PUBLISH', status: 'QUEUED', input: { publicationId: pub.id, templateId: tpl.id }, creativeId: c.id, metaPublicationId: pub.id, createdById: auth.userId },
        });
        await tx.metaPublication.update({ where: { id: pub.id }, data: { jobId: job.id } });
        return pub.id;
      });
    });
    const p = await this.prisma.metaPublication.findUniqueOrThrow({ where: { id: pubId } });
    void this.jobs.detach(p.jobId, 'publicação na Meta (template)', () => this.run(p.jobId!, p.id));
    return this.present(await this.load(auth, pubId));
  }

  /**
   * POST /meta/publish-batch { creativeIds (1–50), templateId } (P3): ad sets de até adsPerAdset.max na ordem pedida
   * (`groupKey` = `<lote>:<n>`); 1 job META_PUBLISH por anúncio, mas campanha 1× por lote (ou a reaproveitada) e ad set
   * 1× por grupo (run(): trava por grupo e reaproveita o id do irmão). 409 com os ids que não estão APPROVED.
   */
  async publishBatch(auth: AuthContext, dto: MetaPublishBatchDto): Promise<MetaPublishBatchResponse> {
    const r = await this.locks.run(`meta-batch:${auth.workspaceId}`, async () => {
      const rows = await this.prisma.creative.findMany({
        where: { id: { in: dto.creativeIds }, workspaceId: auth.workspaceId, archivedAt: null },
        include: {
          offer: true, workspace: true, selectedScript: true, finalRender: { include: { file: true } }, thumbnail: true,
          variationItem: { select: { autoType: true, payload: true } },
        },
      });
      const byId = new Map(rows.map((c) => [c.id, c]));
      const missing = dto.creativeIds.filter((x) => !byId.has(x));
      if (missing.length) throw new AppException('NOT_FOUND', { creativeIds: missing });
      const creatives = dto.creativeIds.map((x) => byId.get(x)!);
      // amostra-gratis-v1 §4 (QA 29/10, F1): peça da amostra travada não vai pro Meta nem em lote (402 locked)
      for (const batchId of new Set(creatives.map((c) => c.variationBatchId).filter((x): x is string => !!x))) {
        await this.amostra.assertBatchUnlocked(auth.workspaceId, batchId);
      }
      const notApproved = creatives.filter((c) => c.state !== 'APPROVED' || !c.finalRender?.file || !c.finalRender.file.mimeType.startsWith('video/')).map((c) => c.id);
      if (notApproved.length) throw new AppException('INVALID_STATE', { allowed: ['APPROVED'], reason: 'not_approved', creativeIds: notApproved });
      const busy = await this.prisma.metaPublication.findMany({ where: { creativeId: { in: dto.creativeIds }, status: 'PUBLISHING' }, select: { creativeId: true } });
      if (busy.length) throw new AppException('INVALID_STATE', { allowed: ['APPROVED'], reason: 'publish_in_progress', creativeIds: [...new Set(busy.map((b) => b.creativeId))] });
      const { fresh, minimum } = await this.gate(auth);
      const tpl = await this.templateFor(auth, dto.templateId, fresh, minimum);
      const settings = new Map(creatives.map((c) => [c.id, this.templateSettings(c, fresh, tpl)]));
      const batchId = randomUUID();
      const now = Date.now();
      const date = isoDate(new Date(now));
      const groups = planGroups(creatives, tpl.adset.adsPerAdset).map((g, i) => ({
        n: i + 1, items: g.items, belowMin: g.belowMin,
        name: resolveName(tpl.adset.namePattern, { offer: g.items[0].offer.name, code: codeOf(g.items[0]), date, n: i + 1 }),
      }));
      const pubIds = await this.prisma.$transaction(async (tx) => {
        const out: string[] = [];
        let k = 0;
        for (const g of groups) {
          for (const c of g.items) {
            const pub = await tx.metaPublication.create({
              data: {
                workspaceId: auth.workspaceId, connectionId: fresh.id, creativeId: c.id, status: 'PUBLISHING', adAccountId: fresh.adAccountId, pageId: fresh.pageId,
                pixelId: tpl.adset.pixelId, settings: settings.get(c.id) as unknown as Prisma.InputJsonValue, renderFileId: c.finalRender!.file!.id, createdById: auth.userId,
                templateId: tpl.id, groupKey: groupKeyOf(batchId, g.n),
                createdAt: new Date(now + k++), // ordem estável dentro do lote: o 1º do grupo dá o nome do ad set, a posição dá o {n} do anúncio
              },
            });
            const job = await tx.job.create({
              data: { workspaceId: auth.workspaceId, type: 'META_PUBLISH', status: 'QUEUED', input: { publicationId: pub.id, templateId: tpl.id, groupKey: pub.groupKey }, creativeId: c.id, metaPublicationId: pub.id, createdById: auth.userId },
            });
            await tx.metaPublication.update({ where: { id: pub.id }, data: { jobId: job.id } });
            out.push(pub.id);
          }
        }
        return out;
      }, { timeout: 60_000 });
      return { pubIds, plan: planOf(groups.map((g) => ({ name: g.name, creativeIds: g.items.map((c) => c.id), belowMin: g.belowMin }))) };
    });
    const pubs = await this.prisma.metaPublication.findMany({ where: { id: { in: r.pubIds } }, include: PUB_INCLUDE });
    const order = new Map(r.pubIds.map((x, i) => [x, i]));
    pubs.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    for (const p of pubs) void this.jobs.detach(p.jobId, 'publicação na Meta (lote)', () => this.run(p.jobId!, p.id));
    return { publications: await this.presentMany(pubs), plan: r.plan };
  }

  /** Nomes da publicação com template: campanha do 1º anúncio do lote, ad set do 1º do grupo, anúncio com {n} = posição no grupo. */
  private async templateNames(p: MetaPublication & { creative: { name: string; adName: string | null; variationCode: string | null; offerId: string } }, tpl: MetaPublishTemplateView) {
    const date = isoDate(p.createdAt);
    const g = parseGroupKey(p.groupKey);
    const siblings = g
      ? await this.prisma.metaPublication.findMany({
        where: { groupKey: { startsWith: `${g.batchId}:` } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, groupKey: true, creative: { select: { name: true, adName: true, variationCode: true, offer: { select: { name: true } } } } },
      })
      : [];
    const own = { id: p.id, groupKey: p.groupKey, creative: { ...p.creative, offer: await this.prisma.offer.findUniqueOrThrow({ where: { id: p.creative.offerId }, select: { name: true } }) } };
    const firstOfBatch = siblings[0] ?? own;
    const group = siblings.filter((x) => x.groupKey === p.groupKey);
    const firstOfGroup = group[0] ?? own;
    const pos = Math.max(0, group.findIndex((x) => x.id === p.id)) + 1;
    type Ref = { creative: { name: string; adName: string | null; variationCode: string | null; offer: { name: string } } };
    const vars = (x: Ref, n: number) => ({ offer: x.creative.offer.name, code: codeOf(x.creative), date, n });
    return {
      campaign: resolveName(tpl.campaign.namePattern, vars(firstOfBatch, 1)),
      adset: resolveName(tpl.adset.namePattern, vars(firstOfGroup, g?.n ?? 1)),
      ad: resolveName(tpl.ad.namePattern, vars(own, pos)),
    };
  }

  /**
   * Campanha da publicação com template (dentro da trava, gravando antes de soltar): irmão do lote que já tem campanha →
   * ela; REUSE → a guardada no template se ainda existe na Meta (senão cria e grava); NEW → cria (1× por lote).
   */
  private async templateCampaign(auth: MetaAuth, p: MetaPublication, tpl: MetaPublishTemplateView, input: MetaPublishInput, save: (data: Prisma.MetaPublicationUncheckedUpdateInput) => Promise<unknown>): Promise<string> {
    const batch = parseGroupKey(p.groupKey)?.batchId ?? null;
    const reuse = tpl.campaign.destination === 'REUSE_CAMPAIGN';
    const key = reuse ? `meta-camp:tpl:${tpl.id}` : batch ? `meta-camp:batch:${batch}` : `meta-camp:pub:${p.id}`;
    return this.locks.run(key, async () => {
      let id: string | null = null;
      if (batch) {
        const sib = await this.prisma.metaPublication.findFirst({ where: { groupKey: { startsWith: `${batch}:` }, campaignId: { not: null }, id: { not: p.id } }, select: { campaignId: true } });
        id = sib?.campaignId ?? null;
      }
      if (!id && reuse) {
        const stored = (await this.prisma.metaPublishTemplate.findUnique({ where: { id: tpl.id }, select: { reuseCampaignId: true } }))?.reuseCampaignId ?? null;
        if (stored) {
          try {
            await this.meta.readObject(auth, { level: 'campaign', id: stored });
            id = stored;
          } catch (e) {
            if (!(isMetaError(e) && e.code === 'META_OBJECT_GONE')) throw e; // apagada/arquivada na Meta: cria outra e troca o id
          }
        }
      }
      if (!id) {
        id = (await this.meta.createCampaign(auth, input)).campaignId;
        if (reuse) await this.prisma.metaPublishTemplate.update({ where: { id: tpl.id }, data: { reuseCampaignId: id } });
      }
      await save({ campaignId: id });
      return id;
    });
  }

  /** Ad set do grupo (1× por grupo): o do irmão na mesma campanha, senão cria. Sem grupo (publicação avulsa) = cria. */
  private async templateAdset(auth: MetaAuth, p: MetaPublication, input: MetaPublishInput, ids: MetaPublishIds, save: (data: Prisma.MetaPublicationUncheckedUpdateInput) => Promise<unknown>): Promise<string> {
    return this.locks.run(`meta-adset:${p.groupKey ?? p.id}`, async () => {
      const sib = p.groupKey
        ? await this.prisma.metaPublication.findFirst({ where: { groupKey: p.groupKey, adsetId: { not: null }, campaignId: ids.campaignId, id: { not: p.id } }, select: { adsetId: true } })
        : null;
      const id = sib?.adsetId ?? (await this.meta.createAdSet(auth, input, ids)).adsetId;
      await save({ adsetId: id });
      return id;
    });
  }

  /** POST /creatives/:id/meta/retry: FAILED → PUBLISHING com job novo, retomando dos ids já gravados. */
  async retry(auth: AuthContext, id: string): Promise<MetaPublicationView> {
    const pubId = await this.locks.run(`meta-pub:${id}`, async () => {
      await this.creative(auth, id);
      const p = await this.latest(auth, id);
      if (!p) throw new AppException('NOT_FOUND');
      if (p.status !== 'FAILED') throw new AppException('INVALID_STATE', { state: p.status, allowed: ['FAILED'] });
      assertSelected(await this.conexao.usable(auth.workspaceId));
      await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: { workspaceId: auth.workspaceId, type: 'META_PUBLISH', status: 'QUEUED', input: { publicationId: p.id, retry: true }, creativeId: p.creativeId, metaPublicationId: p.id, createdById: auth.userId },
        });
        await tx.metaPublication.update({ where: { id: p.id }, data: { status: 'PUBLISHING', jobId: job.id, errorCode: null, failReason: null, failDetail: null, failedStage: null } });
      });
      return p.id;
    });
    const p = await this.prisma.metaPublication.findUniqueOrThrow({ where: { id: pubId } });
    void this.jobs.detach(p.jobId, 'publicação na Meta (retry)', () => this.run(p.jobId!, p.id));
    return this.present(await this.load(auth, pubId));
  }

  /** Nome na Meta (D10): adName; republicação na mesma conta = adName_2, _3… */
  private async metaName(p: MetaPublication, adName: string): Promise<string> {
    const earlier = await this.prisma.metaPublication.count({
      where: { creativeId: p.creativeId, adAccountId: p.adAccountId, status: { not: 'FAILED' }, createdAt: { lt: p.createdAt } },
    });
    return earlier ? `${adName}_${earlier + 1}` : adName;
  }

  /** Job META_PUBLISH: cada etapa grava o id antes de seguir; etapa com id já gravado é pulada (retomada idempotente). */
  async run(jobId: string, publicationId: string): Promise<void> {
    const p = await this.prisma.metaPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { creative: true, renderFile: true, connection: true, template: true } });
    let stageKey: string | null = null;
    try {
      const conn = assertSelected(assertUsable(p.connection));
      const auth = metaAuthOf(conn, this.config);
      const settings = p.settings as unknown as MetaPublishSettings;
      const thumb = p.creative.thumbnailFileId ? await this.prisma.file.findUnique({ where: { id: p.creative.thumbnailFileId } }) : null;
      const publicMedia = (process.env.PUBLIC_MEDIA ?? 'on').toLowerCase() !== 'off';
      const fileUrl = await this.storage.signedUrl(p.renderFile);
      const renderFile = p.renderFile;
      // meta-templates-v1: com template, nomes pelos padrões e a estrutura (CBO/ABO, lance, público, posicionamentos, UTM)
      const tpl = p.template ? this.templates.present(p.template) : null;
      const names = tpl ? await this.templateNames(p, tpl) : null;
      const input: MetaPublishInput = {
        adAccountId: conn.adAccountId, pageId: conn.pageId, pixelId: tpl ? p.pixelId : conn.pixelId,
        adName: await this.metaName(p, names?.ad ?? p.creative.adName ?? p.creative.name),
        settings,
        structure: tpl && names ? structureOf(tpl, names) : null,
        video: {
          fileUrl: publicMedia ? fileUrl : null,
          sizeBytes: p.renderFile.sizeBytes,
          // §3.3 passo 1: pedaços de 8 MB lidos por faixa do storage (Range), nunca o MP4 inteiro em memória
          read: (offset, length) => this.storage.readRange(renderFile, offset, length),
        },
        // image_url do video_data só com imagem de verdade (JPEG/PNG do render); sem thumb = null e a Meta gera o frame
        thumbnailUrl: thumb && thumb.mimeType.startsWith('image/') ? await this.storage.signedUrl(thumb) : null,
      };
      const ids: MetaPublishIds = { videoId: p.videoId, creativeId: p.metaCreativeId, campaignId: p.campaignId, adsetId: p.adsetId, adId: p.metaAdId };
      const save = (data: Prisma.MetaPublicationUncheckedUpdateInput) => this.prisma.metaPublication.update({ where: { id: p.id }, data });
      let previewUrl: string | null = p.previewUrl;
      for (const stage of META_PUBLISH_STAGES) {
        stageKey = stage;
        const done = stage === 'uploading_video' ? !!ids.videoId : stage === 'processing_video' ? !!ids.creativeId || !!ids.campaignId
          : stage === 'creating_campaign' ? !!ids.campaignId : stage === 'creating_adset' ? !!ids.adsetId
            : stage === 'creating_creative' ? !!ids.creativeId : !!ids.adId;
        if (done) continue;
        await this.jobs.stage(jobId, stage, STAGE_PROGRESS[stage]);
        switch (stage) {
          case 'uploading_video': ids.videoId = (await this.meta.uploadVideo(auth, input)).videoId; await save({ videoId: ids.videoId }); break;
          case 'processing_video': await this.meta.waitVideoReady(auth, input, ids); break;
          case 'creating_campaign':
            if (tpl) ids.campaignId = await this.templateCampaign(auth, p, tpl, input, save);
            else { ids.campaignId = (await this.meta.createCampaign(auth, input)).campaignId; await save({ campaignId: ids.campaignId }); }
            break;
          case 'creating_adset':
            if (tpl) ids.adsetId = await this.templateAdset(auth, p, input, ids, save);
            else { ids.adsetId = (await this.meta.createAdSet(auth, input, ids)).adsetId; await save({ adsetId: ids.adsetId }); }
            break;
          case 'creating_creative': ids.creativeId = (await this.meta.createAdCreative(auth, input, ids)).creativeId; await save({ metaCreativeId: ids.creativeId }); break;
          case 'creating_ad': {
            const r = await this.meta.createAd(auth, input, ids);
            ids.adId = r.adId;
            previewUrl = r.previewUrl;
            await save({ metaAdId: ids.adId, previewUrl });
            break;
          }
        }
      }
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.metaPublication.update({ where: { id: p.id }, data: { status: 'PAUSED', publishedAt: p.publishedAt ?? now, previewUrl, errorCode: null, failReason: null, failDetail: null, failedStage: null } });
        // §3.3 passo 7: o anúncio aparece na Home sem esperar o sync (métricas zeradas)
        await tx.metaAdSnapshot.upsert({
          where: { connectionId_metaAdId: { connectionId: conn.id, metaAdId: ids.adId! } },
          create: {
            workspaceId: p.workspaceId, connectionId: conn.id, adAccountId: conn.adAccountId, metaAdId: ids.adId!, name: input.adName, effectiveStatus: 'PAUSED', status: 'PAUSED',
            campaignId: ids.campaignId!, campaignName: input.structure?.campaignName ?? input.adName, adsetId: ids.adsetId!, adsetName: input.structure?.adsetName ?? input.adName, metaCreativeId: ids.creativeId, videoId: ids.videoId,
            thumbnailUrl: null, resultType: null, metrics: ZERO_METRICS as unknown as Prisma.InputJsonValue, metrics7d: ZERO_METRICS as unknown as Prisma.InputJsonValue,
            metricsPrev7d: ZERO_METRICS as unknown as Prisma.InputJsonValue, verdict: 'LOW_DATA', trend: null, adCreatedTime: now, syncedAt: now,
          },
          update: { effectiveStatus: 'PAUSED', status: 'PAUSED', metaCreativeId: ids.creativeId, videoId: ids.videoId },
        });
      });
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { ...ids } });
    } catch (e) {
      const code = isMetaError(e) ? asMetaAsyncCode(e.code) : e instanceof AppException ? asMetaAsyncCode(e.code) : 'META_ERROR';
      const reason = isMetaError(e) ? e.message : e instanceof AppException ? e.body().message : 'Meta did not accept this request. Try again.';
      const detail = isMetaError(e) ? e.failDetail : null;
      if (!isMetaError(e) && !(e instanceof AppException)) this.log.error(`publish ${publicationId}: ${(e as Error).stack ?? e}`);
      if (code === 'META_TOKEN_INVALID') await markTokenInvalid(this.prisma, p.connectionId);
      await this.prisma.metaPublication.update({ where: { id: p.id }, data: { status: 'FAILED', errorCode: code, failReason: reason, failDetail: detail, failedStage: stageKey } }).catch(() => undefined);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: reason }).catch(() => undefined);
    }
  }

  // ───────── ativar / pausar ─────────

  /** POST /creatives/:id/meta/activate { confirm: true } (OWNER/ADMIN, D11): ACTIVE em anúncio, conjunto e campanha. */
  async activate(auth: AuthContext, id: string): Promise<MetaPublicationView> {
    await this.creative(auth, id);
    const p = await this.latest(auth, id);
    if (!p) throw new AppException('NOT_FOUND');
    if (p.status !== 'PAUSED' || !p.metaAdId) throw new AppException('INVALID_STATE', { state: p.status, allowed: ['PAUSED'] });
    const conn = assertSelected(await this.conexao.usable(auth.workspaceId));
    if (accountUnusable(conn.accountStatus)) throw new AppException('META_ACCOUNT_UNUSABLE', { accountStatus: conn.accountStatus, label: accountLabel(conn.accountStatus) });
    // campanhas-v1 §10.1: anúncio reprovado não liga (mesma regra da Campaigns)
    const snap = await this.prisma.metaAdSnapshot.findFirst({ where: { connectionId: conn.id, metaAdId: p.metaAdId }, select: { effectiveStatus: true } });
    if (snap && POLICY_BLOCKED.includes(snap.effectiveStatus)) {
      // §11: a recusa entra no History como BLOCKED (sem escrita na Meta)
      await this.escrita.recordPublishBlocked(auth, conn, { id: p.metaAdId, name: await this.adName(conn.id, p.metaAdId) }, 'PAUSED', 'ACTIVE', 'META_POLICY');
      throw new AppException('META_POLICY', { effectiveStatus: snap.effectiveStatus });
    }
    // campanhas-v1 §4: ativar pela tela Send continua ligando os 3 níveis e agora deixa rastro (MetaChange, source PUBLISH)
    const parents = [p.adsetId, p.campaignId].filter((x): x is string => !!x);
    await this.escrita.recordPublish(auth, conn, { id: p.metaAdId, name: await this.adName(conn.id, p.metaAdId) }, 'PAUSED', 'ACTIVE', parents,
      () => this.meta.setStatus(metaAuthOf(conn, this.config), { objectIds: [p.metaAdId!, ...parents], status: 'ACTIVE' }));
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.metaPublication.update({ where: { id: p.id }, data: { status: 'ACTIVE', activatedAt: now } }),
      this.prisma.metaAdSnapshot.updateMany({ where: { connectionId: conn.id, metaAdId: p.metaAdId }, data: { effectiveStatus: 'ACTIVE', status: 'ACTIVE' } }),
    ]);
    return this.present(await this.load(auth, p.id));
  }

  /** POST /creatives/:id/meta/pause (OWNER/ADMIN): pausa só o anúncio. */
  async pause(auth: AuthContext, id: string): Promise<MetaPublicationView> {
    await this.creative(auth, id);
    const p = await this.latest(auth, id);
    if (!p) throw new AppException('NOT_FOUND');
    if (p.status !== 'ACTIVE' || !p.metaAdId) throw new AppException('INVALID_STATE', { state: p.status, allowed: ['ACTIVE'] });
    const conn = assertSelected(await this.conexao.usable(auth.workspaceId));
    await this.escrita.recordPublish(auth, conn, { id: p.metaAdId, name: await this.adName(conn.id, p.metaAdId) }, 'ACTIVE', 'PAUSED', [],
      () => this.meta.setStatus(metaAuthOf(conn, this.config), { objectIds: [p.metaAdId!], status: 'PAUSED' }));
    await this.prisma.$transaction([
      this.prisma.metaPublication.update({ where: { id: p.id }, data: { status: 'PAUSED' } }),
      this.prisma.metaAdSnapshot.updateMany({ where: { connectionId: conn.id, metaAdId: p.metaAdId }, data: { effectiveStatus: 'PAUSED', status: 'PAUSED' } }),
    ]);
    return this.present(await this.load(auth, p.id));
  }

  // ───────── lista ─────────

  /** GET /meta/publications?status&limit&cursor (mais recente primeiro). */
  async list(auth: AuthContext, q: { status?: string; limit?: number; cursor?: string }): Promise<{ items: MetaPublicationView[]; nextCursor: string | null }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.metaPublication.findMany({
      where: { AND: [{ workspaceId: auth.workspaceId }, q.status ? { status: q.status as MetaPublication['status'] } : {}, afterCursor('createdAt', decodeCursor(q.cursor))] },
      include: PUB_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    const pg = page(rows, limit, (r) => r.createdAt);
    return { items: await this.presentMany(pg.items), nextCursor: pg.nextCursor };
  }

  // ───────── retomada ─────────

  /** Boot: publicação PUBLISHING cujo job morreu → FAILED META_ERROR (action retry). */
  async recover(workspaceId?: string): Promise<number> {
    const rows = await this.prisma.metaPublication.findMany({ where: { ...(workspaceId && { workspaceId }), status: 'PUBLISHING' } });
    const jobIds = rows.map((p) => p.jobId).filter((x): x is string => !!x);
    const alive = new Set(jobIds.length ? (await this.prisma.job.findMany({ where: { id: { in: jobIds }, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } })).map((j) => j.id) : []);
    let n = 0;
    for (const p of rows) {
      if (p.jobId && alive.has(p.jobId)) continue;
      await this.prisma.metaPublication.update({ where: { id: p.id }, data: { status: 'FAILED', errorCode: 'META_ERROR', failReason: 'The server restarted while this was running. Try again.', failedStage: null } });
      n++;
    }
    return n;
  }
}

/** `{code}` = código da peça (variationCode, ex. HEADLINE-02), senão o adName, senão o nome. */
function codeOf(c: { variationCode: string | null; adName: string | null; name: string }): string {
  return c.variationCode ?? c.adName ?? c.name;
}

function accountLabel(status: number | null): string {
  const labels: Record<number, string> = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending risk review', 9: 'in grace period', 100: 'pending closure', 101: 'closed' };
  return status != null ? labels[status] ?? `status ${status}` : 'unknown';
}
