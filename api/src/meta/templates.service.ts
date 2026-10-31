// meta-templates-v1 §1-§3 (29/10): templates de publicação por (workspace, conta de anúncio) — CRUD com 1 padrão por
// conta (o primeiro criado vira padrão; arquivar o padrão promove o mais antigo que sobrou) e o import de campanha,
// ad set ou anúncio da conta (lê a Graph pela porta, mapeia, NÃO salva).
import { Inject, Injectable } from '@nestjs/common';
import type {
  MetaPublishTemplate as MetaPublishTemplateView, MetaTemplateAd, MetaTemplateAdset, MetaTemplateBody, MetaTemplateCampaign,
  MetaTemplateImportBody, MetaTemplateImportResult, MetaTemplateImportedFrom, UpdateMetaTemplateBody,
} from '@maquina/contratos';
import { Prisma, type MetaConnection, type MetaPublishTemplate } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { assertSelected, countriesOf, metaAuthOf, viaPorta } from './comum';
import { MetaConexaoService, storedHealthOf } from './conexao.service';
import { campaignShapeChanged, pixelMissing, templateBodyErrors, templateFromSource } from './templates';

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

@Injectable()
export class MetaTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly locks: KeyedMutex,
    private readonly conexao: MetaConexaoService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  present(t: MetaPublishTemplate): MetaPublishTemplateView {
    return {
      id: t.id, adAccountId: t.adAccountId, name: t.name, isDefault: t.isDefault, source: t.source,
      importedFrom: (t.importedFrom as unknown as MetaTemplateImportedFrom | null) ?? null,
      campaign: t.campaign as unknown as MetaTemplateCampaign, adset: t.adset as unknown as MetaTemplateAdset, ad: t.ad as unknown as MetaTemplateAd,
      reuseCampaignId: t.reuseCampaignId, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
    };
  }

  /** Conta selecionada (422 META_NOT_CONNECTED / META_SELECTION_MISSING). */
  private async selected(auth: AuthContext) {
    return assertSelected(await this.conexao.usable(auth.workspaceId));
  }

  /** Template ativo da conta selecionada; de outra conta, arquivado ou de outro workspace = 404. */
  async load(auth: AuthContext, id: string, conn?: MetaConnection & { adAccountId: string }): Promise<MetaPublishTemplate> {
    const c = conn ?? (await this.selected(auth));
    const t = await this.prisma.metaPublishTemplate.findFirst({ where: { id, workspaceId: auth.workspaceId, adAccountId: c.adAccountId, archivedAt: null } });
    if (!t) throw new AppException('NOT_FOUND');
    return t;
  }

  /** P2/§2: 400 de formato; 422 META_PIXEL_REQUIRED; 422 META_BUDGET_TOO_LOW (mínimo do último health, como a publicação). */
  private check(conn: MetaConnection, b: MetaTemplateBody) {
    const errors = templateBodyErrors(b, false);
    if (errors.length) throw new AppException('VALIDATION_ERROR', { fields: errors });
    if (pixelMissing(b.campaign, b.adset)) throw new AppException('META_PIXEL_REQUIRED', { objective: b.campaign.objective });
    const minimum = storedHealthOf(conn.lastHealth)?._account?.minimumDailyBudgetMinor ?? null;
    if (minimum != null && b.campaign.dailyBudgetMinor < minimum) throw new AppException('META_BUDGET_TOO_LOW', { minimumMinor: minimum, currency: conn.currency ?? 'USD' });
  }

  /** GET /meta/templates: da conta selecionada, padrão primeiro (depois o mais antigo). */
  async list(auth: AuthContext): Promise<MetaPublishTemplateView[]> {
    const c = await this.selected(auth);
    const rows = await this.prisma.metaPublishTemplate.findMany({
      where: { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((t) => this.present(t));
  }

  /** POST /meta/templates: o primeiro da conta vira padrão; `isDefault: true` tira o padrão dos outros. */
  async create(auth: AuthContext, body: MetaTemplateBody): Promise<MetaPublishTemplateView> {
    const errors = templateBodyErrors(body, false);
    if (errors.length) throw new AppException('VALIDATION_ERROR', { fields: errors });
    const c = await this.selected(auth);
    this.check(c, body);
    const t = await this.locks.run(`meta-tpl:${auth.workspaceId}:${c.adAccountId}`, () => this.prisma.$transaction(async (tx) => {
      const scope = { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, archivedAt: null };
      const hasDefault = (await tx.metaPublishTemplate.count({ where: { ...scope, isDefault: true } })) > 0;
      const isDefault = body.isDefault === true || !hasDefault;
      if (isDefault) await tx.metaPublishTemplate.updateMany({ where: { ...scope, isDefault: true }, data: { isDefault: false } });
      return tx.metaPublishTemplate.create({
        data: {
          workspaceId: auth.workspaceId, adAccountId: c.adAccountId, name: body.name.trim(), isDefault,
          source: body.importedFrom ? 'IMPORTED' : 'MANUAL', importedFrom: body.importedFrom ? json(body.importedFrom) : Prisma.DbNull,
          campaign: json(body.campaign), adset: json(body.adset), ad: json(body.ad), createdById: auth.userId,
        },
      });
    }));
    return this.present(t);
  }

  /** PATCH /meta/templates/:id: seções inteiras; mudar a forma da campanha esquece a campanha reaproveitada. */
  async update(auth: AuthContext, id: string, patch: UpdateMetaTemplateBody): Promise<MetaPublishTemplateView> {
    const errors = templateBodyErrors(patch, true);
    if (errors.length) throw new AppException('VALIDATION_ERROR', { fields: errors });
    const c = await this.selected(auth);
    const t = await this.locks.run(`meta-tpl:${auth.workspaceId}:${c.adAccountId}`, async () => {
      const cur = await this.load(auth, id, c);
      const before = this.present(cur);
      const merged: MetaTemplateBody = {
        name: patch.name ?? before.name, campaign: patch.campaign ?? before.campaign, adset: patch.adset ?? before.adset, ad: patch.ad ?? before.ad,
        importedFrom: patch.importedFrom !== undefined ? patch.importedFrom : before.importedFrom,
      };
      this.check(c, merged);
      return this.prisma.$transaction(async (tx) => {
        if (patch.isDefault === true && !cur.isDefault) {
          await tx.metaPublishTemplate.updateMany({ where: { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, archivedAt: null, isDefault: true }, data: { isDefault: false } });
        }
        return tx.metaPublishTemplate.update({
          where: { id: cur.id },
          data: {
            name: merged.name.trim(), campaign: json(merged.campaign), adset: json(merged.adset), ad: json(merged.ad),
            ...(patch.isDefault !== undefined && { isDefault: patch.isDefault }),
            ...(patch.importedFrom !== undefined && { importedFrom: patch.importedFrom ? json(patch.importedFrom) : Prisma.DbNull, source: patch.importedFrom ? 'IMPORTED' : cur.source }),
            ...(campaignShapeChanged(before.campaign, merged.campaign) && { reuseCampaignId: null }),
          },
        });
      });
    });
    return this.present(t);
  }

  /** DELETE /meta/templates/:id: arquiva. 409 se há publicação rodando com ele; arquivar o padrão promove o mais antigo que sobrou. */
  async archive(auth: AuthContext, id: string): Promise<MetaPublishTemplateView> {
    const c = await this.selected(auth);
    const t = await this.locks.run(`meta-tpl:${auth.workspaceId}:${c.adAccountId}`, async () => {
      const cur = await this.load(auth, id, c);
      const running = await this.prisma.metaPublication.count({ where: { templateId: cur.id, status: 'PUBLISHING' } });
      if (running) throw new AppException('INVALID_STATE', { state: 'PUBLISHING', allowed: ['PAUSED', 'ACTIVE', 'FAILED'], reason: 'publish_in_progress' });
      return this.prisma.$transaction(async (tx) => {
        const done = await tx.metaPublishTemplate.update({ where: { id: cur.id }, data: { archivedAt: new Date(), isDefault: false } });
        if (cur.isDefault) {
          const next = await tx.metaPublishTemplate.findFirst({ where: { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, archivedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
          if (next) await tx.metaPublishTemplate.update({ where: { id: next.id }, data: { isDefault: true } });
        }
        return done;
      });
    });
    return this.present(t);
  }

  /** POST /meta/templates/import: lê na Graph (filhos pelo snapshot de campanhas-v1 quando há), mapeia e devolve. Não salva. */
  async importFrom(auth: AuthContext, body: MetaTemplateImportBody): Promise<MetaTemplateImportResult> {
    const c = await this.selected(auth);
    const hint: { adsetId?: string | null; adId?: string | null } = {};
    if (body.level === 'campaign') {
      const sets = await this.prisma.metaAdsetSnapshot.findMany({ where: { connectionId: c.id, campaignId: body.id }, select: { adsetId: true, effectiveStatus: true }, orderBy: [{ createdTime: 'asc' }, { adsetId: 'asc' }] });
      hint.adsetId = (sets.find((s) => s.effectiveStatus === 'ACTIVE') ?? sets[0])?.adsetId ?? null;
    }
    const adsetId = body.level === 'adset' ? body.id : hint.adsetId;
    if (adsetId) {
      const ads = await this.prisma.metaAdSnapshot.findMany({ where: { connectionId: c.id, adsetId }, select: { metaAdId: true, effectiveStatus: true }, orderBy: [{ adCreatedTime: 'asc' }, { metaAdId: 'asc' }] });
      hint.adId = (ads.find((s) => s.effectiveStatus === 'ACTIVE') ?? ads[0])?.metaAdId ?? null;
    }
    if (!hint.adsetId) delete hint.adsetId;
    if (!hint.adId) delete hint.adId;
    const src = await viaPorta(this.prisma, c, () => this.meta.readTemplateSource(metaAuthOf(c, this.config), { level: body.level, id: body.id, hint }));
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { market: true, websiteUrl: true } });
    return templateFromSource(src, { level: body.level, id: body.id, defaultCountries: countriesOf(ws.market), fallbackLink: ws.websiteUrl ?? null });
  }
}
