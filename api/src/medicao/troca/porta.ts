// Porta da troca de texto queimado (troca-texto-queimado-v1 §16.5). Dono: video. Publicada com o fake ANTES do backend.
// O backend injeta por TROCA_TEXTO e só conhece esta interface; o adaptador (fake | local | lambda) sai de PLATE_IMPL.
import type { EditMap, HeadlineLook } from '@maquina/contratos';

export const TROCA_TEXTO = Symbol('TROCA_TEXTO');

/** Sobe quando muda o método da placa: placa de versão antiga não vale (`champion_plates.version`). */
export const HEADLINE_PLATE_VERSION = 1;

export interface MedirHeadlineInput {
  workspaceId: string;
  championId: string;
  /** URL que o adaptador consegue ler (assinada, no lambda; http local ou caminho, no local) */
  videoUrl: string;
  editMap: EditMap;
}

export interface MedirHeadlineResult {
  /** null = campeão sem headline para copiar (nenhuma camada alvo). Medido e reprovado = look com verdict.ok false */
  look: HeadlineLook | null;
  costUsd: number;
  ms: number;
}

export interface PlacaHeadlineInput {
  workspaceId: string;
  championId: string;
  videoUrl: string;
  look: HeadlineLook;
  version: number;
  /** chave do storage onde a placa pronta fica (FileKind CHAMPION_PLATE) */
  outputKey: string;
}

export type PlacaStatus = 'READY' | 'REJECTED' | 'FAILED';

export interface PlacaHeadlineResult {
  status: PlacaStatus;
  /** REJECTED: 'plate_rejected'; FAILED: 'plate_failed'; READY: null */
  reason: string | null;
  /** conferência e tempos, sem pixel (vai para champion_plates.metrics) */
  metrics: Record<string, number>;
  sizeBytes: number | null;
  costUsd: number;
  ms: number;
}

export interface TrocaTextoPort {
  medirHeadline(i: MedirHeadlineInput): Promise<MedirHeadlineResult>;
  placaHeadline(i: PlacaHeadlineInput): Promise<PlacaHeadlineResult>;
}
