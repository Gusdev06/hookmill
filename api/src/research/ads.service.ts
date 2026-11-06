// ads-research-v1 §5/§6.2/§6.3: grid, detalhe, salvar e "carregar vídeo". Visibilidade: o workspace lê anúncios das fontes
// que segue (ACTIVE) e dos que salvou/usou; o resto é 404.
import { Injectable } from '@nestjs/common';
import type { ResearchAdCard, ResearchAdDetail, ResearchAdPage } from '@maquina/contratos';
import { Prisma, type LibraryAd } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS } from './regras';
import { ResearchConfig } from './research.config';
import { ResearchViews } from './research.views';
import { ResearchMediaService } from './media.service';
import { ADS_PAGE_DEFAULT, type ListResearchAdsQueryDto } from './dto/research.dto';

const encodeOffset = (n: number) => Buffer.from(JSON.stringify({ o: n })).toString('base64url');
function decodeOffset(c: string | undefined): number {
  if (!c) return 0;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { o: unknown };
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0) return v.o;
  } catch { /* cai no erro */ }
  throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'cursor', rule: 'isCursor' }] });
}

@Injectable()
export class ResearchAdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly views: ResearchViews,
    private readonly media: ResearchMediaService,
  ) {}

  /** O que o workspace enxerga (§7). */
  visibleWhere(workspaceId: string): Prisma.LibraryAdWhereInput {
    return {
      OR: [
        { sources: { some: { source: { competitors: { some: { workspaceId, status: 'ACTIVE' } } } } } },
        { saves: { some: { workspaceId } } },
        { champions: { some: { workspaceId } } },
      ],
    };
  }

  async loadVisible(workspaceId: string, id: string): Promise<LibraryAd> {
    const ad = await this.prisma.libraryAd.findFirst({ where: { id, ...this.visibleWhere(workspaceId) } });
    if (!ad) throw new AppException('NOT_FOUND');
    return ad;
  }

  private tierWhere(tiers: string[], now: Date): Prisma.LibraryAdWhereInput {
    const W = new Date(now.getTime() - this.cfg.winnerDays * DAY_MS);
    const N = new Date(now.getTime() - this.cfg.newDays * DAY_MS);
    const fewVersions: Prisma.LibraryAdWhereInput = { OR: [{ collationCount: null }, { collationCount: { lt: this.cfg.winnerVersions } }] };
    const or: Prisma.LibraryAdWhereInput[] = [];
    if (tiers.includes('winner')) or.push(this.views.winnerWhere(now));
    if (tiers.includes('testing')) or.push({ isActive: true, AND: [fewVersions, { OR: [{ startDate: null }, { startDate: { gt: W, lte: N } }] }] });
    if (tiers.includes('new')) or.push({ isActive: true, startDate: { gt: N }, AND: [fewVersions] });
    if (tiers.includes('stopped')) or.push({ isActive: false });
    return { OR: or };
  }

  /** `GET /research/ads`. */
  async list(auth: AuthContext, q: ListResearchAdsQueryDto): Promise<ResearchAdPage> {
    const ws = auth.workspaceId;
    const now = new Date();
    const and: Prisma.LibraryAdWhereInput[] = [this.visibleWhere(ws)];
    if (q.competitorId?.length) {
      and.push({ sources: { some: { source: { competitors: { some: { workspaceId: ws, id: { in: q.competitorId } } } } } } });
    }
    const status = q.status ?? 'active';
    if (status !== 'all') and.push({ isActive: status === 'active' });
    if (q.format?.length) and.push({ format: { in: q.format } });
    if (q.hasVideo !== undefined) and.push({ hasVideo: q.hasVideo });
    if (q.tier?.length) and.push(this.tierWhere(q.tier, now));
    if (q.minDays) and.push({ startDate: { lte: new Date(now.getTime() - q.minDays * DAY_MS) } });
    if (q.startedAfter) and.push({ startDate: { gte: new Date(q.startedAfter) } });
    if (q.startedBefore) and.push({ startDate: { lte: new Date(q.startedBefore) } });
    if (q.platform?.length) and.push({ platforms: { hasSome: q.platform } });
    if (q.language?.length) and.push({ language: { in: q.language } });
    if (q.q?.trim()) {
      const t = q.q.trim();
      and.push({ OR: [{ primaryText: { contains: t, mode: 'insensitive' } }, { headline: { contains: t, mode: 'insensitive' } }, { pageName: { contains: t, mode: 'insensitive' } }] });
    }
    if (q.saved) and.push({ saves: { some: { workspaceId: ws } } });
    const where: Prisma.LibraryAdWhereInput = { AND: and };
    const sort = q.sort ?? 'longest_running';
    const orderBy: Prisma.LibraryAdOrderByWithRelationInput[] = sort === 'newest' ? [{ startDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      : sort === 'most_variations' ? [{ collationCount: { sort: 'desc', nulls: 'last' } }, { startDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
        : sort === 'eu_reach' ? [{ euReach: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          : [{ isActive: 'desc' }, { startDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    const limit = q.limit ?? ADS_PAGE_DEFAULT;
    const offset = decodeOffset(q.cursor);
    const [rows, total, winners] = await Promise.all([
      this.prisma.libraryAd.findMany({ where, orderBy, skip: offset, take: limit + 1 }),
      this.prisma.libraryAd.count({ where }),
      this.prisma.libraryAd.count({ where: { AND: [where, this.views.winnerWhere(now)] } }),
    ]);
    const items = await this.views.cards(ws, rows.slice(0, limit));
    return { items, nextCursor: rows.length > limit ? encodeOffset(offset + limit) : null, total, winners };
  }

  async detail(auth: AuthContext, id: string): Promise<ResearchAdDetail> {
    return this.views.detail(auth.workspaceId, await this.loadVisible(auth.workspaceId, id));
  }

  /** `PUT /research/ads/:id/save`: idempotente (atualiza a nota). Com URL válida, baixa o vídeo pro storage em segundo plano. */
  async save(auth: AuthContext, id: string, note: string | null | undefined): Promise<ResearchAdCard> {
    const ad = await this.loadVisible(auth.workspaceId, id);
    await this.prisma.savedAd.upsert({
      where: { workspaceId_adId: { workspaceId: auth.workspaceId, adId: ad.id } },
      create: { workspaceId: auth.workspaceId, adId: ad.id, savedById: auth.userId, note: note?.trim() || null },
      update: { ...(note !== undefined && { note: note?.trim() || null }) },
    });
    this.media.storeInBackground(ad);
    return (await this.views.cards(auth.workspaceId, [ad]))[0];
  }

  async unsave(auth: AuthContext, id: string): Promise<void> {
    const ad = await this.loadVisible(auth.workspaceId, id);
    await this.prisma.savedAd.deleteMany({ where: { workspaceId: auth.workspaceId, adId: ad.id } });
  }

  /** `POST /research/ads/:id/media` (§6.3): 202 com media.status = 'refreshing'. */
  async requestMedia(auth: AuthContext, id: string): Promise<ResearchAdDetail> {
    const ad = await this.loadVisible(auth.workspaceId, id);
    await this.media.requestRefresh(auth, ad);
    return this.views.detail(auth.workspaceId, await this.prisma.libraryAd.findUniqueOrThrow({ where: { id: ad.id } }));
  }
}
