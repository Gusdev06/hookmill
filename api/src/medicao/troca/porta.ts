// Porta da troca de texto queimado (troca-texto-queimado-v1 §16.5). Dono: video. Publicada com o fake ANTES do backend.
// O backend injeta por TROCA_TEXTO e só conhece esta interface; o adaptador (fake | local | lambda) sai de PLATE_IMPL.
import type { CaptionSwapReason, EditMap, HeadlineLook, Rect, TranscriptWord } from '@maquina/contratos';
import type { CaptionTrack } from './legenda';

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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LEGENDA (F2, troca-texto §15.6). Mesmo padrão das ops da headline. Separada de `TrocaTextoPort` de propósito: dobles de
// teste do F1b (`implements TrocaTextoPort`) não quebram. Quem quer as duas injeta TROCA_TEXTO e tipa `TrocaPorta`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DetectarLegendaInput {
  workspaceId: string;
  championId: string;
  videoUrl: string;
  /** a leitura do campeão: camadas `caption`, `protectedBands`, `faceTrack` (portão `no_person`), `frameCount`, `fps` */
  editMap: EditMap;
  /** palavras com tempo, da transcrição da leitura (`transcript.words`); o texto novo é este, sem tradução */
  words: TranscriptWord[];
  /** duração do vídeo em s (portão `too_long`) */
  durationSec: number;
  /** faixa da legenda em px do campeão, se já conhecida (EXIGIDA acima de 60 s: sem ela o 120 s levou 283 s) */
  captionBox?: Rect | null;
  /** dica de fonte da visão: omitido = `layer.style.fontId` da camada caption; null = sem dica (todas as fontes da legenda competem) */
  fontIdVisao?: string | null;
  /** teto de duração (env LEGENDA_MAX_SEC; padrão 60) */
  legendaMaxSec?: number;
  /** onde guardar os trechos estáveis para a placa (`d.npz`, ~centenas de KB): chave do storage (FileKind CHAMPION_PLATE, layerKey 'caption-data').
   *  OBRIGATÓRIO no adaptador real; o fake ignora. Vem de volta em `captionTrack.artefato` (null se o veredito for sem swap: o arquivo é apagado) */
  artefatoKey?: string;
}

export interface DetectarLegendaResult {
  /** null = campeão sem legenda queimada (nenhuma camada `caption`): não há o que trocar, não é reprovação */
  captionTrack: CaptionTrack | null;
  costUsd: number;
  ms: number;
}

export interface PlacaLegendaInput {
  workspaceId: string;
  championId: string;
  videoUrl: string;
  /** só vale com `captionTrack.veredito.swap === true`; senão a porta lança ErroTroca (erro de uso) */
  captionTrack: CaptionTrack;
  version: number;
  /** chave do storage onde a placa pronta fica (FileKind CHAMPION_PLATE) */
  outputKey: string;
}

export interface PlacaLegendaResult extends PlacaHeadlineResult {
  /** READY: null; REJECTED: 'plate_rejected' | 'color_shift'; FAILED: 'plate_failed' */
  reason: CaptionSwapReason | null;
  /** quadros (grade do campeão) das até 6 janelas mais ruins da placa: o backend os extrai e manda ao `checkCaption` modo swap. Ausente no FAILED */
  pioresQuadros?: number[];
}

export interface TrocaLegendaPort {
  detectarLegenda(i: DetectarLegendaInput): Promise<DetectarLegendaResult>;
  placaLegenda(i: PlacaLegendaInput): Promise<PlacaLegendaResult>;
}

/** A porta inteira: headline + legenda. É o que o fake e a orquestra implementam. */
export type TrocaPorta = TrocaTextoPort & TrocaLegendaPort;
