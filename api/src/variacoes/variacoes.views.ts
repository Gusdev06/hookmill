import { Inject, Injectable } from '@nestjs/common';
import type {
  Action, BatchSettings, CreativeRow, Face, VariationBatch, VariationBatchStatus, VariationCasting, VariationItem, VariationKind,
} from '@maquina/contratos';
import type { Face as FaceRow, File as FileRow, Prisma, VariationCasting as CastingRow, VariationItem as ItemRow } from '@prisma/client';
import { asAsyncErrorCode } from '../common/errors/falhas';
import { initials, num } from '../common/util/format';
import { statusOf } from '../criativos/derivacao';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { CREATIVE_INCLUDE, CreativeViews } from '../criativos/views';
import { presentJob } from '../jobs/job.presenter';
import { PrismaService } from '../prisma/prisma.service';
import type { ItemPayload } from './plano';

export const BATCH_INCLUDE = {
  champion: { select: { id: true, name: true } },
  offer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.VariationBatchInclude;
export type BatchFull = Prisma.VariationBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

export function payloadOf(json: Prisma.JsonValue): ItemPayload {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as unknown as ItemPayload) : {};
}

/** Lote gravado antes do §13 não tem keepEdit/hookMode: lê como talking head limpo (o caminho com que foi lançado). */
export function settingsOf(json: Prisma.JsonValue): BatchSettings {
  const s = (json ?? {}) as unknown as Partial<BatchSettings>;
  return { ...s, keepEdit: s.keepEdit ?? false, hookMode: s.hookMode ?? 'TEXT', swapEngine: s.swapEngine ?? 'LIPSYNC' } as BatchSettings;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Ordem dos itens: por tipo (como no pedido), controle primeiro dentro do NEW_HOOKS. */
const KIND_ORDER: VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT'];

@Injectable()
export class VariacoesViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creatives: CreativeViews,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  async face(f: FaceRow & { file: FileRow | null }, selectedId: string | null): Promise<Face> {
    return this.creatives.face(f, selectedId);
  }

  async casting(c: CastingRow & { faces: (FaceRow & { file: FileRow | null })[] }): Promise<VariationCasting> {
    const batches = new Map<number, { batch: number; faces: Face[] }>();
    for (const f of [...c.faces].sort((a, b) => b.batch - a.batch || a.position - b.position)) {
      const b = batches.get(f.batch) ?? { batch: f.batch, faces: [] };
      b.faces.push(await this.face(f, c.selectedFaceId));
      batches.set(f.batch, b);
    }
    return { id: c.id, scope: c.scope === 'ITEM' ? 'ITEM' : 'SHARED', description: c.description, batches: [...batches.values()], selectedFaceId: c.selectedFaceId };
  }

  async item(i: ItemRow, creative: CreativeRow | null): Promise<VariationItem> {
    const p = payloadOf(i.payload);
    const failed = i.status === 'FAILED';
    const action: Action | null = failed ? 'regenerate' : null;
    return {
      id: i.id, kind: i.kind, index: i.index, isControl: i.isControl, included: i.included, status: i.status,
      lever: i.lever, rationale: i.rationale,
      hook: i.kind === 'NEW_HOOKS' && p.hook ? { speech: p.hook.speech, onScreenText: p.hook.onScreenText } : null,
      blocks: p.blocks ?? null,
      layoutTemplateId: p.layoutTemplateId ?? null,
      castingId: i.castingId,
      errorCode: failed ? asAsyncErrorCode(i.errorCode) : null, failReason: failed ? i.failReason : null, action,
      creative,
    };
  }

  async batch(b: BatchFull): Promise<VariationBatch> {
    const [items, castings, job, creatives, cost] = await Promise.all([
      this.prisma.variationItem.findMany({ where: { batchId: b.id } }),
      this.prisma.variationCasting.findMany({ where: { batchId: b.id }, include: { faces: { include: { file: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.job.findFirst({ where: { variationBatchId: b.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.creative.findMany({ where: { variationBatchId: b.id }, include: CREATIVE_INCLUDE }),
      this.prisma.costEntry.aggregate({ where: { variationBatchId: b.id }, _sum: { amountUsd: true } }),
    ]);
    const rows = new Map<string, CreativeRow>();
    for (const c of creatives) if (c.variationItemId && !c.archivedAt) rows.set(c.variationItemId, await this.creatives.row(c));
    const creativesCost = creatives.length
      ? num((await this.prisma.costEntry.aggregate({ where: { creativeId: { in: creatives.map((c) => c.id) } }, _sum: { amountUsd: true } }))._sum.amountUsd) ?? 0
      : 0;
    const sorted = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.index - b.index);
    const status = b.status as VariationBatchStatus;
    let progress: VariationBatch['progress'] = null;
    if (status === 'LAUNCHED') {
      const live = creatives.filter((c) => !c.archivedAt);
      const chips = live.map((c) => statusOf(c.state, c.updatedAt));
      progress = {
        total: live.length,
        generating: chips.filter((x) => x === 'progress').length,
        waiting: chips.filter((x) => x === 'waiting').length,
        failed: chips.filter((x) => x === 'failed').length,
        approved: chips.filter((x) => x === 'approved').length,
      };
    }
    return {
      id: b.id,
      champion: b.champion,
      offer: b.offer,
      status,
      language: b.language,
      requests: b.requests as unknown as VariationBatch['requests'],
      settings: settingsOf(b.settings),
      notes: b.notes,
      castingStyle: b.castingStyle,
      faceUnitPriceUsd: this.catalog.estimateFaces(1),
      job: job ? presentJob(job) : null,
      items: await Promise.all(sorted.map((i) => this.item(i, rows.get(i.id) ?? null))),
      castings: await Promise.all(castings.map((c) => this.casting(c))),
      estimatedCostUsd: num(b.estimatedCostUsd),
      costUsd: r4((num(cost._sum.amountUsd) ?? 0) + creativesCost),
      launchedAt: b.launchedAt?.toISOString() ?? null,
      progress,
      createdBy: { id: b.createdBy.id, name: b.createdBy.name, initials: initials(b.createdBy.name) },
      createdAt: b.createdAt.toISOString(),
    };
  }
}
