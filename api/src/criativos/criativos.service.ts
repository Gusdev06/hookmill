import { Injectable } from '@nestjs/common';
import type { CreativeDetail, CreativeFilter, CreativeRow, CreativesMeta } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { CustosService, SCRIPT_ESTIMATE_USD } from '../custos/custos.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoteirosService } from '../roteiros/roteiros.service';
import { ALL_STATES, filterWhere } from './derivacao';
import { waitingBatches, waitingOnYou, ZERO_WAITING } from '../workspaces/waiting';
import { invalidState } from './state-machine';
import { CREATIVE_INCLUDE, CreativeViews } from './views';
import { CreateCreativeDto, ListCreativesDto } from './criativos.dto';
import type { WaitingBatchRefAuto } from './contrato-auto';

export const DEFAULT_SCRIPT_COUNT = 4;

@Injectable()
export class CriativosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: CreativeViews,
    private readonly custos: CustosService,
    private readonly roteiros: RoteirosService,
    private readonly jobs: JobsService,
  ) {}

  async list(auth: AuthContext, q: ListCreativesDto): Promise<{ items: CreativeRow[]; meta: Omit<CreativesMeta, 'waitingBatches'> & { waitingBatches: WaitingBatchRefAuto[] } }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const cursor = decodeCursor(q.cursor);
    const base: Prisma.CreativeWhereInput = {
      workspaceId: auth.workspaceId,
      archivedAt: null,
      ...(q.q?.trim() && { name: { contains: q.q.trim(), mode: 'insensitive' } }),
      ...(q.offerId && { offerId: q.offerId }),
      ...(q.championId && { championId: q.championId }),
      ...(q.origin && { origin: q.origin === 'variation' ? ('VARIATION' as const) : ('SCRATCH' as const) }),
    };
    const filter = q.filter ?? 'all';
    const rows = await this.prisma.creative.findMany({
      where: { AND: [base, filterWhere(filter), afterCursor('updatedAt', cursor)] },
      include: CREATIVE_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const p = page(rows, limit, (r) => r.updatedAt);
    const filters: CreativeFilter[] = ['all', 'progress', 'needs_you', 'approved'];
    const [counts, waiting, batches] = await Promise.all([
      Promise.all(filters.map((f) => this.prisma.creative.count({ where: { AND: [base, filterWhere(f)] } }))),
      // fase2-agencia.md §3.6: número do workspace (sem q/offerId/championId/origin), a mesma função do cartão do Clients
      waitingOnYou(this.prisma, [auth.workspaceId]),
      filter === 'needs_you' ? waitingBatches(this.prisma, auth.workspaceId) : Promise.resolve([]),
    ]);
    return {
      items: await Promise.all(p.items.map((c) => this.views.row(c))),
      meta: {
        nextCursor: p.nextCursor,
        counts: Object.fromEntries(filters.map((f, i) => [f, counts[i]])) as CreativesMeta['counts'],
        waitingOnYou: waiting.get(auth.workspaceId) ?? { ...ZERO_WAITING },
        waitingBatches: batches,
      },
    };
  }

  async get(auth: AuthContext, id: string): Promise<CreativeDetail> {
    const d = await this.views.detailById(auth.workspaceId, id);
    if (!d) throw new AppException('NOT_FOUND');
    return d;
  }

  /**
   * POST /creatives: oferta do workspace com what + promise, teto de gasto, nome "<oferta> · <n>",
   * nasce em SCRIPTS_WRITING com os roteiros já sendo escritos.
   */
  async create(auth: AuthContext, dto: CreateCreativeDto): Promise<CreativeDetail> {
    const offer = await this.prisma.offer.findFirst({ where: { id: dto.offerId, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!offer) throw new AppException('NOT_FOUND');
    const missing = (['what', 'promise'] as const).filter((k) => !offer[k]?.trim());
    if (missing.length) throw new AppException('OFFER_INCOMPLETE', { missing });
    const count = dto.scriptCount ?? DEFAULT_SCRIPT_COUNT;
    await this.custos.assertWithinCap(auth.workspaceId, count * SCRIPT_ESTIMATE_USD);

    const { creative, slots, job } = await this.prisma.$transaction(async (tx) => {
      const n = (await tx.creative.count({ where: { offerId: offer.id } })) + 1;
      const creative = await tx.creative.create({
        data: {
          workspaceId: auth.workspaceId,
          offerId: offer.id,
          name: dto.name?.trim() || `${offer.name} · ${n}`,
          language: offer.language,
          state: 'SCRIPTS_WRITING',
          createdById: auth.userId,
        },
      });
      const opened = await this.roteiros.openSlots(tx, creative, auth.userId, count, 'SCRIPTS_GENERATE', { count, replace: false });
      return { creative, ...opened };
    });
    await this.jobs.announceById(job.id);
    void this.jobs.detach(job.id, 'roteiros', () => this.roteiros.run(job.id, creative.id, slots, []));
    return this.get(auth, creative.id);
  }

  async rename(auth: AuthContext, id: string, name: string): Promise<CreativeDetail> {
    const r = await this.prisma.creative.updateMany({ where: { id, workspaceId: auth.workspaceId, archivedAt: null }, data: { name: name.trim() } });
    if (r.count !== 1) throw new AppException('NOT_FOUND');
    return this.get(auth, id);
  }

  /** Arquiva (some da Home e da Biblioteca). Renderizando = 409. */
  async archive(auth: AuthContext, id: string) {
    const r = await this.prisma.creative.updateMany({
      where: { id, workspaceId: auth.workspaceId, archivedAt: null, state: { not: 'RENDERING' } },
      data: { archivedAt: new Date() },
    });
    if (r.count !== 1) {
      const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null }, select: { state: true } });
      if (!c) throw new AppException('NOT_FOUND');
      throw invalidState(c.state, ALL_STATES.filter((s) => s !== 'RENDERING'));
    }
    return { ok: true as const };
  }
}
