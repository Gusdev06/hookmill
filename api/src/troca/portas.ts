// §13.15.7 de docs/contratos/feature-2-variar-campeao.md: as assinaturas novas da ia (I6) e do video (V5) que o
// Trocar avatar com motor usa. Cópia LITERAL do doc, só pra o backend compilar e testar antes de os donos escreverem nos
// contrato.ts deles. Quando os contratos ganharem esses métodos, os `as` abaixo viram redundantes (nada muda aqui).
// Método ausente em runtime (dono ainda não entregou) = a etapa falha com PROVIDER_ERROR, nunca chamada inventada.
import type { SwapEngine, SwapFit, SwapQuote, SwapVoiceSource, TranscriptWord } from '@maquina/contratos';
import type { CatalogService, FaceAspect, GenerationService, Submitted, VideoFormat } from '../integracoes';
import type { MediaAnalysisService } from '../medicao';

export type SwapModel = 'kling-3.0' | 'seedance-2.0';

export interface SwapGenerationPort {
  submitSceneVideo(i: {
    workspaceId: string; sceneId: string; windowIndex?: number; model: SwapModel; faceImageUrl: string /* rosto ou último frame */;
    speech: string /* '' em (A) */; sound: boolean; voiceDescriptor?: string; visualPrompt: string; durationSec: number;
    format: VideoFormat; aspectRatio?: FaceAspect; resolution?: '480p' | '720p'; seed?: number; language: string;
    /** notas do campeão (só o mock lê) */
    notes?: string | null;
  }): Promise<Submitted>;
  /** kind LIPSYNC_VIDEO, CostKind LIPSYNC */
  submitLipsyncVideo(i: { workspaceId: string; sceneId: string; videoUrl: string; audioUrl: string; seed?: number }): Promise<Submitted>;
}

export type SwapWindowPlan = { startSec: number; endSec: number; genSec: number };
export type SwapFitResult = SwapFit | { error: 'VOICE_FIT_OUT_OF_RANGE'; ratio: number; sourceSec: number; voiceSec: number };
export type SwapEstimate = Omit<SwapQuote, 'available' | 'blockers' | 'notEnabled' | 'selected' | 'costUsd'>;

export interface SwapCatalogPort {
  planSwapWindows(i: { spanSec: number; words: TranscriptWord[] /* relativas ao trecho */; engine: 'KLING' | 'SEEDANCE'; voiceSource: SwapVoiceSource }): SwapWindowPlan[];
  fitEngineVoice(i: { sourceWords: TranscriptWord[]; sourceSec: number; clipWords: TranscriptWord[]; clipSec: number }): SwapFitResult;
  swapResolutionFor(region: { w: number; h: number }, aspect: FaceAspect): '480p' | '720p';
  estimateSwap(i: {
    engine: SwapEngine; voiceSource: SwapVoiceSource; spans: { sec: number; words: TranscriptWord[] }[]; takeSec: number;
    region: { w: number; h: number }; aspect: FaceAspect;
  }): SwapEstimate;
}

export interface SwapMediaPort {
  /** reencoda na fps do 1º, sem buraco */
  concatClips(paths: string[], outPath: string): Promise<{ durationSec: number }>;
  trimToFrames(videoPath: string, frameCount: number, fps: number, outPath: string): Promise<void>;
  /** último frame decodificado, png */
  lastFrame(videoPath: string, outPath: string): Promise<string>;
  /** setpts + atempo, tom preservado */
  timeStretch(videoPath: string, factor: number, outPath: string): Promise<void>;
  /** SFace */
  identityScore(videoPath: string, refImagePath: string, sampleFps?: number): Promise<{ median: number; min: number; samples: number }>;
}

/** Erro de etapa sem o método do dono (I6/V5 ainda não entregue). */
export class SwapPortMissing extends Error {
  constructor(readonly method: string) {
    super(`método ${method} ainda não existe (§13.15.7)`);
    this.name = 'SwapPortMissing';
  }
}

function need<T extends object>(o: object, methods: string[]): T {
  for (const m of methods) if (typeof (o as Record<string, unknown>)[m] !== 'function') throw new SwapPortMissing(m);
  return o as T;
}

export const swapGen = (g: GenerationService, ...m: (keyof SwapGenerationPort)[]) => need<SwapGenerationPort>(g, m);
export const swapCatalog = (c: CatalogService, ...m: (keyof SwapCatalogPort)[]) => need<SwapCatalogPort>(c, m);
export const swapMedia = (x: MediaAnalysisService, ...m: (keyof SwapMediaPort)[]) => need<SwapMediaPort>(x, m);
/** true quando o catálogo já tem o método (estimativa: sem ele, swapQuotes = null). */
export const hasSwapCatalog = (c: CatalogService, m: keyof SwapCatalogPort) => typeof (c as unknown as Record<string, unknown>)[m] === 'function';
