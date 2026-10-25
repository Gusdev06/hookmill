import { randomUUID } from 'node:crypto';
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

/** Store em memória (testes e scripts). Mesmo comportamento observável do Prisma. */
export class MemoryTaskStore implements ProviderTaskStore {
  readonly tasks = new Map<string, ProviderTaskRecord & { completedAt?: Date; errorRaw?: string | null }>();
  private seq = 0;

  async create(t: NewProviderTask): Promise<ProviderTaskRecord> {
    if ([...this.tasks.values()].some((x) => x.externalId === t.externalId)) throw new Error('externalId must be unique');
    const rec: ProviderTaskRecord = {
      id: randomUUID(),
      workspaceId: t.workspaceId,
      provider: t.provider ?? 'WAVESPEED',
      kind: t.kind,
      model: t.model,
      externalId: t.externalId,
      status: 'SUBMITTED',
      input: t.input,
      outputUrls: [],
      output: null,
      errorCode: null,
      estimatedUsd: t.estimatedUsd,
      faceId: t.faceId ?? null,
      sceneId: t.sceneId ?? null,
      championId: t.championId ?? null,
      takeId: t.takeId ?? null,
      windowIndex: t.windowIndex ?? null,
      renderId: t.renderId ?? null,
      // seq garante ordem estável mesmo com o relógio parado (fake timers)
      submittedAt: new Date(Date.now() + this.seq++),
    };
    this.tasks.set(rec.id, rec);
    return { ...rec };
  }

  async finish(id: string, f: TaskFinish): Promise<ProviderTaskRecord | null> {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'SUBMITTED') return null;
    Object.assign(t, f, { completedAt: new Date() });
    return { ...t };
  }

  async get(id: string) {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }

  async latestForScene(sceneId: string, kinds: ProviderTaskKind[]) {
    const list = [...this.tasks.values()]
      .filter((t) => t.sceneId === sceneId && kinds.includes(t.kind))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return list[0] ? { ...list[0] } : null;
  }

  async listForScene(sceneId: string, kinds: ProviderTaskKind[]) {
    return [...this.tasks.values()]
      .filter((t) => t.sceneId === sceneId && kinds.includes(t.kind))
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
      .map((t) => ({ ...t }));
  }

  async latestForTake(takeId: string, kinds: ProviderTaskKind[]) {
    const list = [...this.tasks.values()]
      .filter((t) => t.takeId === takeId && kinds.includes(t.kind))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return list[0] ? { ...list[0] } : null;
  }

  async listSubmitted(prefix: string) {
    return [...this.tasks.values()].filter((t) => t.status === 'SUBMITTED' && t.externalId.startsWith(prefix)).map((t) => ({ ...t }));
  }

  async findByExternalId(externalId: string) {
    const t = [...this.tasks.values()].find((x) => x.externalId === externalId);
    return t ? { ...t } : null;
  }

  async listStale(before: Date, excludePrefix: string, limit: number, provider?: TaskProvider, kinds?: ProviderTaskKind[]) {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'SUBMITTED' && !t.externalId.startsWith(excludePrefix) && t.submittedAt < before && (!provider || t.provider === provider) && (!kinds?.length || kinds.includes(t.kind)))
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  readonly polled = new Map<string, number>();
  async markPolled(id: string) {
    this.polled.set(id, (this.polled.get(id) ?? 0) + 1);
  }
}

export class MemoryCostStore implements CostStore {
  readonly entries: NewCostEntry[] = [];
  async record(e: NewCostEntry) {
    this.entries.push(e);
  }
}
