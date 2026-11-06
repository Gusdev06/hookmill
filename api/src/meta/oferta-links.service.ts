// meta-oferta-v1 §3 e §5: carrega o que o casamento anúncio → oferta precisa (ofertas com refs, correções manuais,
// publicações HookMill, campeões) e grava a correção manual (PUT/DELETE /meta/offer-links). A regra em si é pura
// (oferta-match.ts). Não escreve na Meta, então não grava MetaChange.
import { Injectable } from '@nestjs/common';
import type { MetaAdOfferInfo, MetaOfferFit, MetaOfferLinkBody, MetaOfferLinkQuery, MetaOfferLinkResult, PageRole } from '@maquina/contratos';
import type { MetaAdSnapshot, MetaConnection, Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { assertUsable } from './comum';
import { type AdAttribution, type MatchAd, type MatchInput, type MatchOffer, attributeAds, fitOf, offerInfoOf, refsOf } from './oferta-match';

/** §3.3: páginas lidas que um anúncio pode apontar (fora: terms, faq, about, testimonials, thankyou). */
const AD_PAGE_ROLES: ReadonlySet<PageRole> = new Set<PageRole>(['main', 'offer', 'quiz_step', 'checkout', 'pricing', 'other']);

export const toMatchAd = (r: Pick<MetaAdSnapshot, 'metaAdId' | 'name' | 'campaignId' | 'campaignName' | 'adsetId' | 'adsetName' | 'destinationUrls' | 'destinationSource' | 'urlTags'>): MatchAd => ({
  metaAdId: r.metaAdId, name: r.name, campaignId: r.campaignId, campaignName: r.campaignName, adsetId: r.adsetId, adsetName: r.adsetName,
  destinationUrls: r.destinationUrls ?? [], destinationSource: r.destinationSource, urlTags: r.urlTags,
});

/** Casamento já calculado pra uma lista de snapshots (a conta inteira: o irmão precisa dos vizinhos). */
export class OfferMatch {
  readonly atts: Map<string, AdAttribution>;
  private readonly ads = new Map<string, MatchAd>();
  constructor(readonly input: MatchInput, rows: MetaAdSnapshot[], readonly requested: string | null, private readonly canEdit: boolean) {
    for (const r of rows) this.ads.set(r.metaAdId, toMatchAd(r));
    this.atts = attributeAds([...this.ads.values()], input);
  }
  /** `this | unknown | other` pra oferta pedida (null sem `?offerId`). */
  fit(metaAdId: string): MetaOfferFit | null {
    const att = this.atts.get(metaAdId);
    return this.requested && att ? fitOf(att, this.requested, this.input.offers) : null;
  }
  info(r: MetaAdSnapshot): MetaAdOfferInfo {
    const ad = this.ads.get(r.metaAdId) ?? toMatchAd(r);
    const att = this.atts.get(r.metaAdId) ?? attributeAds([ad], this.input).get(r.metaAdId)!;
    return offerInfoOf(ad, att, this.input, this.requested, this.canEdit);
  }
  /** §4.4: a oferta pedida tem ≥ 1 referência de URL. */
  offerHasUrl(): boolean {
    return (this.input.offers.find((o) => o.id === this.requested)?.refs.length ?? 0) > 0;
  }
}

const linkOf = (settings: Prisma.JsonValue): string | null => {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as { link?: unknown }).link : null;
  return typeof s === 'string' ? s : null;
};

@Injectable()
export class MetaOfferLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** `?offerId` do workspace (arquivada pode); de outro workspace ou inexistente = 404 NOT_FOUND { resource: 'offer' }. */
  async assertOffer(workspaceId: string, offerId: string): Promise<void> {
    const ok = await this.prisma.offer.findFirst({ where: { id: offerId, workspaceId }, select: { id: true } });
    if (!ok) throw new AppException('NOT_FOUND', { resource: 'offer' });
  }

  /** Entrada do casamento (5 queries): todas as ofertas do workspace (arquivadas inclusive, §3.5), refs, manuais da conta, HookMill e campeões. */
  async input(workspaceId: string, adAccountId: string): Promise<MatchInput> {
    const [ws, offers, pubs, champs, manual] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { websiteUrl: true } }),
      this.prisma.offer.findMany({ where: { workspaceId }, select: { id: true, name: true, archivedAt: true, sourceUrl: true, readMeta: true } }),
      this.prisma.metaPublication.findMany({
        where: { workspaceId }, select: { status: true, metaAdId: true, settings: true, creative: { select: { offerId: true } } }, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.champion.findMany({ where: { workspaceId, metaAdId: { not: null }, archivedAt: null }, select: { metaAdId: true, offerId: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.metaOfferLink.findMany({ where: { workspaceId, adAccountId }, select: { level: true, objectId: true, offerId: true, decision: true } }),
    ]);
    const hookmill = new Map<string, string>();
    const pubLinks = new Map<string, string[]>();
    for (const p of pubs) {
      if (p.metaAdId && !hookmill.has(p.metaAdId)) hookmill.set(p.metaAdId, p.creative.offerId);
      const link = p.status !== 'FAILED' ? linkOf(p.settings) : null;
      if (link) pubLinks.set(p.creative.offerId, [...(pubLinks.get(p.creative.offerId) ?? []), link]);
    }
    const champion = new Map<string, string>();
    for (const c of champs) if (c.metaAdId && !champion.has(c.metaAdId)) champion.set(c.metaAdId, c.offerId);
    const active = offers.filter((o) => !o.archivedAt);
    // §3.3/D8: o site da empresa só diz qual produto é quando há exatamente 1 oferta não arquivada
    const siteOwner = active.length === 1 ? active[0].id : null;
    const matchOffers: MatchOffer[] = offers.map((o) => {
      const pages = (o.readMeta as { pages?: { url?: unknown; role?: unknown }[] } | null)?.pages;
      const pageUrls = Array.isArray(pages) ? pages.filter((p) => AD_PAGE_ROLES.has(p?.role as PageRole) && typeof p.url === 'string').map((p) => p.url as string) : [];
      return {
        id: o.id, name: o.name, archived: !!o.archivedAt,
        refs: refsOf([o.sourceUrl, ...pageUrls, ...(pubLinks.get(o.id) ?? []), o.id === siteOwner ? ws?.websiteUrl : null]),
      };
    });
    return { offers: matchOffers, manual: manual.map((m) => ({ level: m.level === 'CAMPAIGN' ? 'CAMPAIGN' : 'AD', objectId: m.objectId, offerId: m.offerId, decision: m.decision })), hookmill, champion };
  }

  async match(auth: AuthContext, c: MetaConnection, rows: MetaAdSnapshot[], requested: string | null): Promise<OfferMatch> {
    return new OfferMatch(await this.input(c.workspaceId, c.adAccountId ?? ''), rows, requested, auth.role !== 'CLIENT');
  }

  // ───────── §5 correção manual ─────────

  /** Conexão com conta escolhida (o vínculo é por conta de anúncio, não por conexão). */
  private async account(workspaceId: string): Promise<MetaConnection & { adAccountId: string }> {
    const c = assertUsable(await this.prisma.metaConnection.findUnique({ where: { workspaceId } }));
    if (!c.adAccountId) throw new AppException('META_SELECTION_MISSING', { missing: ['adAccount'] });
    return c as MetaConnection & { adAccountId: string };
  }

  private async prepare(auth: AuthContext, q: MetaOfferLinkQuery) {
    const c = await this.account(auth.workspaceId);
    await this.assertOffer(auth.workspaceId, q.offerId);
    const rows = await this.prisma.metaAdSnapshot.findMany({ where: { connectionId: c.id } });
    const exists = q.level === 'AD' ? rows.some((r) => r.metaAdId === q.objectId) : rows.some((r) => r.campaignId === q.objectId)
      || !!(await this.prisma.metaCampaignSnapshot.findFirst({ where: { connectionId: c.id, campaignId: q.objectId }, select: { id: true } }));
    if (!exists) throw new AppException('NOT_FOUND', { resource: q.level === 'AD' ? 'ad' : 'campaign' });
    const before = await this.match(auth, c, rows, q.offerId);
    return { c, rows, before };
  }

  private async affected(auth: AuthContext, c: MetaConnection, rows: MetaAdSnapshot[], before: OfferMatch, offerId: string): Promise<number> {
    const after = await this.match(auth, c, rows, offerId);
    return rows.filter((r) => before.fit(r.metaAdId) !== after.fit(r.metaAdId)).length;
  }

  /** PUT /meta/offer-links (§5.2): BELONGS é exclusivo por objeto; NOT_BELONGS só tira a oferta pedida. */
  async put(auth: AuthContext, body: MetaOfferLinkBody): Promise<MetaOfferLinkResult> {
    const { c, rows, before } = await this.prepare(auth, body);
    const key = { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, level: body.level, objectId: body.objectId };
    const decision = body.belongs ? 'BELONGS' : 'NOT_BELONGS';
    await this.prisma.$transaction(async (tx) => {
      if (body.belongs) {
        await tx.metaOfferLink.deleteMany({ where: { ...key, decision: 'BELONGS', offerId: { not: body.offerId } } });
      }
      await tx.metaOfferLink.upsert({
        where: { workspaceId_adAccountId_level_objectId_offerId: { ...key, offerId: body.offerId } },
        create: { ...key, offerId: body.offerId, decision, createdById: auth.userId },
        update: { decision, createdById: auth.userId },
      });
    });
    return { level: body.level, objectId: body.objectId, offerId: body.offerId, decision, affectedAds: await this.affected(auth, c, rows, before, body.offerId) };
  }

  /** DELETE /meta/offer-links: volta ao automático; apagar o que não existe = 200 idempotente. */
  async remove(auth: AuthContext, q: MetaOfferLinkQuery): Promise<MetaOfferLinkResult> {
    const { c, rows, before } = await this.prepare(auth, q);
    await this.prisma.metaOfferLink.deleteMany({ where: { workspaceId: auth.workspaceId, adAccountId: c.adAccountId, level: q.level, objectId: q.objectId, offerId: q.offerId } });
    return { level: q.level, objectId: q.objectId, offerId: q.offerId, decision: null, affectedAds: await this.affected(auth, c, rows, before, q.offerId) };
  }
}
