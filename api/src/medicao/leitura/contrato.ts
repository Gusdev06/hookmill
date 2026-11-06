// Contrato da leitura de mídia do anúncio (docs/contratos/leitura-lambda-v1.md §3). Só o maquina-arquiteto muda.
// O analise.service (backend) fala com a porta LeituraMidia; a porta escolhe local ou Lambda por ANALYZE_IMPL.
import type { EditLayer, Rect } from '@maquina/contratos';
import type { FaceTrackResult } from '../contrato';
import type { KeyframeReason, Medidas, Probe, RefinarEntrada, Segmentos } from './etapas';

export const LEITURA_MIDIA = Symbol('LEITURA_MIDIA');

/** Arquivo produzido por uma etapa. local = caminho no disco da API (o backend faz storage.put);
 *  storage = já está no storage nessa chave (a Lambda subiu por PUT pré-assinado; o backend só registra a linha). */
export type Artefato = { tipo: 'local'; path: string } | { tipo: 'storage'; key: string; sizeBytes: number; mimeType: string };

export interface ArquivoRef { storageKey: string }

export interface LeituraAbertura {
  workspaceId: string;
  video: ArquivoRef;
  /** Áudio já extraído numa tentativa anterior (reaproveitado; não sobe de novo). */
  audio: ArquivoRef | null;
  /** Pasta de trabalho da análise (o backend apaga no fim). */
  dir: string;
}

export interface LerResultado { probe: Probe; audio: { artefato: Artefato; durationSec: number } | null }

export interface MedirPedido {
  /** false = medições já gravadas (nova tentativa). */
  medir: boolean;
  /** Segmentos das medições gravadas (recortes de texto) quando `medir` é false. */
  segmentos?: Segmentos;
  /** false = sem mapa ([mock:not-mapped]). */
  mapear: boolean;
}

export interface MedirResultado {
  medidas: (Omit<Medidas, 'keyframes'> & { keyframes: { atSec: number; reason: KeyframeReason; artefato: Artefato }[] }) | null;
  trilha: { ok: true; valor: FaceTrackResult } | { ok: false; erro: string } | null;
  recortes: { atSec: number; box: Rect; artefato: Artefato }[];
}

/** Uma análise = uma sessão. A Lambda guarda o vídeo baixado no /tmp entre as chamadas (contêiner quente). */
export interface LeituraSessao {
  /** Quem fez a última etapa (log e testes): 'lambda' ou 'local' (inclusive fallback). */
  readonly ultimaImpl: 'local' | 'lambda' | null;
  /** validateFull + probe + áudio (só extrai e devolve se `extrairAudio`). Lança MediaInvalidError. */
  ler(extrairAudio: boolean): Promise<LerResultado>;
  /** Medições + frames-chave + trilha do rosto + recortes de texto. Precisa do `ler` antes (usa o probe). */
  medir(p: MedirPedido): Promise<MedirResultado>;
  /** Refino por pixel das camadas que a visão descreveu. */
  refinar(p: RefinarEntrada): Promise<EditLayer[]>;
}

export interface LeituraMidia {
  readonly impl: 'local' | 'lambda';
  abrir(a: LeituraAbertura): LeituraSessao;
}

/** O que os adaptadores usam do StorageService (o backend injeta o real). */
export interface StorageDaLeitura {
  downloadTo(file: ArquivoRef, path: string): Promise<void>;
  signedUrl(file: ArquivoRef): Promise<string>;
  newKey(workspaceId: string, kind: 'CHAMPION_AUDIO' | 'CHAMPION_FRAME', mimeType: string): string;
  presignPut(key: string, opts: { contentType: string; expiresInSec: number }): Promise<string>;
}

// ───────── evento e resposta da função (handler.ts) ─────────

export const LEITURA_EVENTO_VERSAO = 1;

export interface VideoRemoto {
  /** GET pré-assinado (storage). */
  url: string;
  /** Identifica o vídeo no cache do /tmp do contêiner (storageKey). */
  cacheKey: string;
}
export interface PutRemoto { url: string; contentType: string }

export type EventoLeitura =
  | { v: 1; op: 'ler'; video: VideoRemoto; audioPut: PutRemoto | null }
  | { v: 1; op: 'medir'; video: VideoRemoto; probe: Probe; medir: boolean; segmentos?: Segmentos; mapear: boolean; framePuts: PutRemoto[]; cropPuts: PutRemoto[] }
  | { v: 1; op: 'refinar'; video: VideoRemoto; entrada: RefinarEntrada };

export type ResultadoLer = { probe: Probe; audio: { durationSec: number; sizeBytes: number } | null };
export type ResultadoMedir = {
  medidas: (Omit<Medidas, 'keyframes'> & { keyframes: { atSec: number; reason: KeyframeReason; slot: number; sizeBytes: number }[] }) | null;
  trilha: MedirResultado['trilha'];
  recortes: { atSec: number; box: Rect; slot: number; sizeBytes: number }[];
};
export type ResultadoRefinar = { layers: EditLayer[] };

export interface TemposLeitura { totalMs: number; downloadMs: number; etapaMs: number; uploadMs: number; fria: boolean; cacheVideo: boolean }

export type RespostaLeitura =
  | { ok: true; op: 'ler'; resultado: ResultadoLer; tempos: TemposLeitura; avisos: string[] }
  | { ok: true; op: 'medir'; resultado: ResultadoMedir; tempos: TemposLeitura; avisos: string[] }
  | { ok: true; op: 'refinar'; resultado: ResultadoRefinar; tempos: TemposLeitura; avisos: string[] }
  | { ok: false; erro: { name: string; message: string; reason?: string } };
