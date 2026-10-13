// Portas internas da integracoes: onde ela grava provider_tasks / cost_entries e por onde avisa o backend.
// Implementações: store/prisma.store.ts (app) e store/memoria.store.ts (testes).

/** §13.15: LIPSYNC_VIDEO = lipsync vídeo-a-vídeo do Trocar avatar (A) com motor de vídeo. */
export type ProviderTaskKind = 'FACE_IMAGE' | 'SCENE_VIDEO' | 'TTS' | 'LIPSYNC' | 'TRANSCRIBE' | 'LIPSYNC_VIDEO';
export type ProviderTaskStatus = 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
export type CostKind = 'LLM' | 'IMAGE' | 'VIDEO' | 'TTS' | 'LIPSYNC' | 'TRANSCRIBE' | 'SCRAPE';
export type CostUnit = 'second' | 'image' | 'character' | 'ktoken_in' | 'ktoken_out' | 'call';
/** Provedor de uma task assíncrona (enum Provider do Prisma, sem o ANTHROPIC, que é síncrono). */
export type TaskProvider = 'WAVESPEED' | 'HIGGSFIELD';

export interface ProviderTaskRecord {
  id: string;
  workspaceId: string;
  provider: TaskProvider;
  kind: ProviderTaskKind;
  model: string;
  externalId: string;
  status: ProviderTaskStatus;
  input: Record<string, unknown>;
  outputUrls: string[];
  output: Record<string, unknown> | null;
  errorCode: string | null;
  estimatedUsd: number | null;
  faceId: string | null;
  sceneId: string | null;
  /** feature 2: TRANSCRIBE do campeão */
  championId: string | null;
  /** §13.5: TTS/LIPSYNC/TRANSCRIBE do take */
  takeId: string | null;
  /** §13.15: janela da cena SWAP_VIDEO (SCENE_VIDEO da janela); null fora dela */
  windowIndex: number | null;
  submittedAt: Date;
}

export interface NewProviderTask {
  workspaceId: string;
  /** padrão WAVESPEED */
  provider?: TaskProvider;
  kind: ProviderTaskKind;
  model: string;
  externalId: string;
  input: Record<string, unknown>;
  estimatedUsd: number;
  faceId?: string;
  sceneId?: string;
  championId?: string;
  takeId?: string;
  /** §13.15 */
  windowIndex?: number;
}

export interface TaskFinish {
  status: Exclude<ProviderTaskStatus, 'SUBMITTED'>;
  outputUrls: string[];
  output: Record<string, unknown> | null;
  errorCode: string | null;
  errorRaw: string | null;
}

export interface ProviderTaskStore {
  create(t: NewProviderTask): Promise<ProviderTaskRecord>;
  /** Só termina se ainda estiver SUBMITTED (idempotente). Devolve null se já tinha terminado. */
  finish(id: string, f: TaskFinish): Promise<ProviderTaskRecord | null>;
  get(id: string): Promise<ProviderTaskRecord | null>;
  /** Task mais recente da cena entre os tipos pedidos (o mock usa pra saber a fala/duração). */
  latestForScene(sceneId: string, kinds: ProviderTaskKind[]): Promise<ProviderTaskRecord | null>;
  /** §13.5: idem pro take (o mock lê o texto do TTS do take pra transcrição). */
  latestForTake(takeId: string, kinds: ProviderTaskKind[]): Promise<ProviderTaskRecord | null>;
  /** §13.15: todas as tasks da cena entre os tipos pedidos, mais antigas primeiro (o mock monta a fala das janelas). */
  listForScene(sceneId: string, kinds: ProviderTaskKind[]): Promise<ProviderTaskRecord[]>;
  /** Tasks ainda SUBMITTED cujo externalId começa com o prefixo (o mock retoma no boot). */
  listSubmitted(externalIdPrefix: string): Promise<ProviderTaskRecord[]>;
  /** Live: acha a task pelo id da WaveSpeed (webhook). */
  findByExternalId(externalId: string): Promise<ProviderTaskRecord | null>;
  /** Live (reconciliador): SUBMITTED enviadas antes de `before`, fora do mock, mais antigas primeiro.
   *  `provider` filtra (o laço rápido do rosto só olha HIGGSFIELD). */
  listStale(before: Date, excludePrefix: string, limit: number, provider?: TaskProvider): Promise<ProviderTaskRecord[]>;
  /** Marca a última consulta do reconciliador (debug / não martelar a mesma task). */
  markPolled(id: string): Promise<void>;
}

export interface NewCostEntry {
  workspaceId: string;
  creativeId?: string | null;
  /** feature 2: custo da análise do campeão (Whisper, Claude, Apify) */
  championId?: string | null;
  /** feature 2: plano do lote */
  variationBatchId?: string | null;
  provider: 'ANTHROPIC' | 'APIFY' | TaskProvider;
  kind: CostKind;
  model: string;
  units: number;
  unit: CostUnit;
  amountUsd: number;
  providerTaskId?: string;
  jobId?: string;
}

export interface CostStore {
  record(e: NewCostEntry): Promise<void>;
}

/** Nome do evento interno de fim de task (eventos.md §5). */
export const PROVIDER_TASK_FINISHED = 'provider.task.finished';

export interface ProviderTaskFinishedEvent {
  providerTaskId: string;
  kind: ProviderTaskKind;
  status: Exclude<ProviderTaskStatus, 'SUBMITTED'>;
  outputUrls: string[];
  errorCode: string | null;
  faceId?: string;
  sceneId?: string;
  championId?: string;
  /** §13.5 */
  takeId?: string;
  /** §13.15: janela da cena SWAP_VIDEO */
  windowIndex?: number;
}

export interface TaskEventBus {
  emit(event: typeof PROVIDER_TASK_FINISHED, payload: ProviderTaskFinishedEvent): unknown;
}
