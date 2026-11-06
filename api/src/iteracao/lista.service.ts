// lacunas-home-eddy-v1 §5 (31/10): GET /iterate, a lista de lotes (recentes da Home; futura tela de histórico).
// Só leitura, workspace do token, todos os papéis. Lote de campeão arquivado não entra. 1 consulta + assinatura local das miniaturas.
import { Injectable } from '@nestjs/common';
import type { IterateBatchRow, IterateListResponse } from '@maquina/contratos';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { afterCursor, decodeCursor, page } from '../common/http/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { BATCH_CREATIVES_SELECT, batchNeedsYou, batchStageOf, batchStatusOf, piecesPublished } from './lote-etapa';

export const ITERATE_LIST_DEFAULT = 10;

export class ListIterateQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
  @IsOptional() @IsIn(['AUTO', 'MANUAL']) mode?: 'AUTO' | 'MANUAL';
}

@Injectable()
export class IteracaoListaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(auth: AuthContext, q: ListIterateQueryDto): Promise<IterateListResponse> {
    const limit = q.limit ?? ITERATE_LIST_DEFAULT;
    const cursor = decodeCursor(q.cursor);
    const rows = await this.prisma.variationBatch.findMany({
      where: { AND: [{ workspaceId: auth.workspaceId, champion: { archivedAt: null } }, q.mode ? { mode: q.mode } : {}, afterCursor('updatedAt', cursor)] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, mode: true, status: true, downloadedAt: true, createdAt: true, updatedAt: true,
        champion: { select: { id: true, name: true, metaAdId: true, sourceCreativeId: true, thumbnailFile: true } },
        offer: { select: { id: true, name: true } },
        creatives: BATCH_CREATIVES_SELECT,
      },
    });
    const { items, nextCursor } = page(rows, limit, (r) => r.updatedAt);
    const data = await Promise.all(items.map(async (b): Promise<IterateBatchRow> => {
      const pieces = b.creatives.length;
      const ready = b.creatives.filter((c) => c.state === 'APPROVED').length;
      const stage = batchStageOf({ status: b.status, mode: b.mode, pieces, rendering: b.creatives.some((c) => c.state === 'RENDERING'), downloadedAt: b.downloadedAt, published: piecesPublished(b.creatives) });
      const st = batchStatusOf(stage, ready);
      return {
        id: b.id, mode: b.mode, stage, needsYou: batchNeedsYou(stage), statusKey: st.key, statusParams: st.params,
        champion: { id: b.champion.id, name: b.champion.name }, offer: b.offer,
        source: { metaAdId: b.champion.metaAdId, creativeId: b.champion.sourceCreativeId },
        pieces, ready,
        thumbnail: b.champion.thumbnailFile ? await this.storage.fileRef(b.champion.thumbnailFile) : null,
        createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
      };
    }));
    return { data, meta: { nextCursor } };
  }
}
