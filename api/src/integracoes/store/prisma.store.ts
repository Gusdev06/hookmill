import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CostStore,
  NewCostEntry,
  NewProviderTask,
  ProviderTaskKind,
  ProviderTaskRecord,
  ProviderTaskStore,
  TaskFinish,
  TaskProvider,
} from '../portas';

/** Só o que a integracoes usa do client (o PrismaService do backend estende PrismaClient). */
export type IntegracoesDb = Pick<PrismaClient, 'providerTask' | 'costEntry' | 'scene' | 'face' | 'variationCasting' | 'take'>;

type Row = Prisma.ProviderTaskGetPayload<object>;

function toRecord(r: Row): ProviderTaskRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    provider: r.provider as TaskProvider,
    kind: r.kind,
    model: r.model,
    externalId: r.externalId,
    status: r.status,
    input: (r.input ?? {}) as Record<string, unknown>,
    outputUrls: r.outputUrls,
    output: (r.output ?? null) as Record<string, unknown> | null,
    errorCode: r.errorCode,
    estimatedUsd: r.estimatedUsd == null ? null : Number(r.estimatedUsd),
    faceId: r.faceId,
    sceneId: r.sceneId,
    championId: r.championId,
    takeId: r.takeId,
    windowIndex: r.windowIndex ?? null,
    renderId: r.renderId ?? null,
    submittedAt: r.submittedAt,
  };
}

export class PrismaTaskStore implements ProviderTaskStore {
  constructor(private readonly db: IntegracoesDb) {}

  async create(t: NewProviderTask) {
    const r = await this.db.providerTask.create({
      data: {
        workspaceId: t.workspaceId,
        provider: t.provider ?? 'WAVESPEED',
        kind: t.kind,
        model: t.model,
        externalId: t.externalId,
        input: t.input as Prisma.InputJsonValue,
        estimatedUsd: new Prisma.Decimal(t.estimatedUsd),
        faceId: t.faceId ?? null,
        sceneId: t.sceneId ?? null,
        championId: t.championId ?? null,
        takeId: t.takeId ?? null,
        windowIndex: t.windowIndex ?? null,
        renderId: t.renderId ?? null,
      },
    });
    return toRecord(r);
  }

  async finish(id: string, f: TaskFinish) {
    // compare-and-set: só quem pega SUBMITTED termina (webhook duplicado / reconciliador / mock)
    const { count } = await this.db.providerTask.updateMany({
      where: { id, status: 'SUBMITTED' },
      data: {
        status: f.status,
        outputUrls: f.outputUrls,
        output: f.output == null ? Prisma.DbNull : (f.output as Prisma.InputJsonValue),
        errorCode: f.errorCode,
        errorRaw: f.errorRaw,
        completedAt: new Date(),
      },
    });
    if (count === 0) return null;
    const r = await this.db.providerTask.findUnique({ where: { id } });
    return r ? toRecord(r) : null;
  }

  async get(id: string) {
    const r = await this.db.providerTask.findUnique({ where: { id } });
    return r ? toRecord(r) : null;
  }

  async latestForScene(sceneId: string, kinds: ProviderTaskKind[]) {
    const r = await this.db.providerTask.findFirst({
      where: { sceneId, kind: { in: kinds } },
      orderBy: { submittedAt: 'desc' },
    });
    return r ? toRecord(r) : null;
  }

  async listForScene(sceneId: string, kinds: ProviderTaskKind[]) {
    const rs = await this.db.providerTask.findMany({ where: { sceneId, kind: { in: kinds } }, orderBy: { submittedAt: 'asc' } });
    return rs.map(toRecord);
  }

  async latestForTake(takeId: string, kinds: ProviderTaskKind[]) {
    const r = await this.db.providerTask.findFirst({
      where: { takeId, kind: { in: kinds } },
      orderBy: { submittedAt: 'desc' },
    });
    return r ? toRecord(r) : null;
  }

  async listSubmitted(prefix: string) {
    const rs = await this.db.providerTask.findMany({ where: { status: 'SUBMITTED', externalId: { startsWith: prefix } } });
    return rs.map(toRecord);
  }

  async findByExternalId(externalId: string) {
    const r = await this.db.providerTask.findUnique({ where: { externalId } });
    return r ? toRecord(r) : null;
  }

  async listStale(before: Date, excludePrefix: string, limit: number, provider?: TaskProvider, kinds?: ProviderTaskKind[]) {
    const rs = await this.db.providerTask.findMany({
      where: { status: 'SUBMITTED', submittedAt: { lt: before }, NOT: { externalId: { startsWith: excludePrefix } }, ...(provider ? { provider } : {}), ...(kinds?.length ? { kind: { in: kinds } } : {}) },
      orderBy: { submittedAt: 'asc' },
      take: limit,
    });
    return rs.map(toRecord);
  }

  async markPolled(id: string) {
    await this.db.providerTask.updateMany({ where: { id }, data: { lastPolledAt: new Date() } });
  }
}

export class PrismaCostStore implements CostStore {
  constructor(private readonly db: IntegracoesDb) {}

  async record(e: NewCostEntry) {
    let creativeId = e.creativeId ?? null;
    let championId = e.championId ?? null;
    let variationBatchId = e.variationBatchId ?? null;
    if (!creativeId && !championId && !variationBatchId && e.providerTaskId) ({ creativeId, championId, variationBatchId } = await this.ownerOfTask(e.providerTaskId));
    await this.db.costEntry.create({
      data: {
        workspaceId: e.workspaceId,
        creativeId,
        championId,
        variationBatchId,
        provider: e.provider,
        kind: e.kind,
        model: e.model,
        units: new Prisma.Decimal(e.units),
        unit: e.unit,
        amountUsd: new Prisma.Decimal(e.amountUsd),
        providerTaskId: e.providerTaskId ?? null,
        jobId: e.jobId ?? null,
      },
    });
  }

  /** O GenerationService não recebe creativeId: deduz pela cena, pelo take ou pelo rosto da task; TRANSCRIBE do campeão = championId. */
  private async ownerOfTask(providerTaskId: string): Promise<{ creativeId: string | null; championId: string | null; variationBatchId: string | null }> {
    const none = { creativeId: null, championId: null, variationBatchId: null };
    const t = await this.db.providerTask.findUnique({ where: { id: providerTaskId }, select: { sceneId: true, faceId: true, championId: true, takeId: true } });
    if (t?.championId) return { ...none, championId: t.championId };
    // §13.5: take = clipe contínuo do criativo; o custo entra no criativo
    if (t?.takeId) return { ...none, creativeId: (await this.db.take.findUnique({ where: { id: t.takeId }, select: { creativeId: true } }))?.creativeId ?? null };
    if (t?.sceneId) return { ...none, creativeId: (await this.db.scene.findUnique({ where: { id: t.sceneId }, select: { creativeId: true } }))?.creativeId ?? null };
    if (t?.faceId) {
      const f = await this.db.face.findUnique({ where: { id: t.faceId }, select: { creativeId: true, castingId: true } });
      if (f?.creativeId) return { ...none, creativeId: f.creativeId };
      // rosto de elenco (feature 2): sem criativo; o custo vai pro lote do elenco
      if (f?.castingId) return { ...none, variationBatchId: (await this.db.variationCasting.findUnique({ where: { id: f.castingId }, select: { batchId: true } }))?.batchId ?? null };
    }
    return none;
  }
}
