// Contrato do módulo medicao (maquina-video). §6.2 de docs/contratos/feature-2-variar-campeao.md + interfaces internas da §13.7.
// Só o maquina-arquiteto muda o contrato; o backend importa os tipos daqui.
// Sem regra de negócio, só caminhos locais (o backend baixa do storage e sobe o resultado). ffmpeg/ffprobe do sistema.
import type { FaceTrackSegment, Measurements, Rect } from '@maquina/contratos';
import type { LayoutMeasure } from './layout';
import type { FaceSample } from './rostos';
import type { FaceTrackStats } from './trilha';
import type { SolidBackground } from './camadas';

export type { LayoutMeasure, FaceSample, FaceTrackStats, SolidBackground };

/** §13.1: trilha do rosto do campeão + contagens pra os bloqueios. Frames na grade do vídeo: [start, end). */
export interface FaceTrackResult {
  width: number; height: number; fps: number; frameCount: number;
  /** = EditMap.cells */
  cells: { startFrame: number; endFrame: number; cells: Rect[] }[];
  /** = EditMap.faceTrack */
  segments: FaceTrackSegment[];
  stats: FaceTrackStats[];
  /** no_face / multiple_faces / low_confidence (só o que sai da trilha; os das camadas são do backend) */
  blockers: { reason: 'no_face' | 'multiple_faces' | 'low_confidence'; startSec: number | null; endSec: number | null }[];
  /** células com rosto persistente que NÃO são a região (ex.: câmera de segurança com gente): ficam intactas */
  otherFaceCells: { startFrame: number; endFrame: number; cell: Rect; medianScore: number }[];
  /** o vídeo inteiro no tempo: main (= os segments, vira região de troca), other_person e broll (ficam como no original,
   *  nunca bloqueiam). Contíguo de 0 a frameCount. */
  timeline: { startFrame: number; endFrame: number; kind: 'main' | 'other_person' | 'broll' }[];
}

export interface MediaAnalysisService {
  probe(path: string): Promise<{ durationSec: number; width: number; height: number; fps: number; hasAudio: boolean; videoCodec: string }>;
  /** Decodifica o arquivo inteiro (regra do download truncado). Lança MediaInvalidError. */
  validateFull(path: string): Promise<void>;
  extractAudio(videoPath: string, outPath: string): Promise<{ durationSec: number }>;   // m4a mono 44,1 kHz
  sliceAudio(audioPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]>;
  cutVideo(videoPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]>; // pós-10/10
  keyframes(videoPath: string, atSec: number[], outDir: string, maxSide: number): Promise<{ atSec: number; path: string }[]>;
  /** silencedetect a -35 dB; NUNCA com -v error (engole a saída do filtro): usar -hide_banner. */
  silences(audioPath: string, minSec?: number): Promise<{ startSec: number; endSec: number }[]>;
  /** Port em TS do analisar_estrutura.py (clonar-edicao): variância temporal por linha, penhasco (argmin), nunca limiar
   *  absoluto; separa corte de layout de troca de conteúdo. §13.1: cada segmento ganha `cells` (px, guilhotina
   *  linhas → colunas → linhas). Continua atribuível a Pick<Measurements,'cuts'|'segments'>. */
  measureLayout(videoPath: string): Promise<LayoutMeasure>;
  palette(framePaths: string[], k: number): Promise<string[]>;                          // hex

  // ── §13 (manter a edição) ──
  /** Nº exato de frames de vídeo (conta pacotes; a grade do campeão). */
  frameCount(videoPath: string): Promise<number>;
  /** YuNet (score, nunca área) por amostra; imagem = 1 amostra. `minScore` padrão 0,8. Caixas em px do arquivo. */
  detectFaces(videoOrImagePath: string, sampleFps?: number, opts?: { minScore?: number; crop?: Rect }): Promise<FaceSample[]>;
  /** Trilha do rosto (§13.1 itens 1-5): layout com células + YuNet a 5 amostras/s + bordas refinadas por frame. */
  faceTrack(videoPath: string, layout?: LayoutMeasure): Promise<FaceTrackResult>;
  /** Intervalo [start, end) em frames em que o recorte `box` bate com o do frame de `refAtSec` (penhasco, sem limiar). */
  layerPresence(videoPath: string, box: Rect, refAtSec: number): Promise<{ startFrame: number; endFrame: number }>;
  /** Fundo chapado (ou degradê vertical) da camada: caixa medida + cor reconstruída das medianas das linhas. */
  solidBackground(videoPath: string, atSec: number, approxBox: Rect): Promise<SolidBackground | null>;
  /** Recorte do clipe (px do clipe) pra uma região: mesma proporção rosto/região do original, cover, sem barra. Puro. */
  fitCrop(clip: { w: number; h: number }, clipFace: Rect, region: { w: number; h: number }, faceInRegion: Rect): Rect;

  /** Caixa real (px) de uma legenda SEM fundo, medida nos instantes das palavras (`atSec`, até 24 amostras): a faixa de
   *  linhas com letra (claro colado em escuro) que muda entre os instantes. `approxBox` (visão) só desempata entre faixas
   *  parecidas. null = nenhum texto que mude. */
  captionBox(videoPath: string, atSec: number[], approxBox: Rect | null): Promise<Rect | null>;

  // ── §13.15.7 (Trocar avatar com Kling/Seedance, mantendo a edição) ──
  /** Emenda na ordem, recodificada na fps/tamanho da 1ª, sem buraco. Com som só se todas têm som. Cada janela já
   *  cortada no pedaço usado (trimToFrames); senão a sobra de genSec entra no meio. */
  concatClips(paths: string[], outPath: string): Promise<{ durationSec: number }>;
  /** Exatamente frameCount frames na fps dada, do instante 0 (clipe curto repete o último frame). Som cortado junto. */
  trimToFrames(videoPath: string, frameCount: number, fps: number, outPath: string): Promise<void>;
  /** Último frame decodificado, png. Passar a janela JÁ cortada: é o frame que aparece na emenda. */
  lastFrame(videoPath: string, outPath: string): Promise<string>;
  /** setpts + atempo (tom preservado). factor = duração de saída / de entrada (0,5-2); reencaixe (B) = 1 / f. */
  timeStretch(videoPath: string, factor: number, outPath: string): Promise<void>;
  /** SFace (cosseno) do clipe contra o rosto escolhido, `sampleFps` padrão 2; amostra sem rosto conta 0. */
  identityScore(videoPath: string, refImagePath: string, sampleFps?: number): Promise<{ median: number; min: number; samples: number }>;
}

/** Lançado por validateFull/probe quando o arquivo não serve. `reason` = MEDIA_INVALID.details.reason (api.md §4.5). */
export class MediaInvalidError extends Error {
  constructor(public reason: 'no_video' | 'undecodable' | 'too_small', message: string) {
    super(message);
    this.name = 'MediaInvalidError';
  }
}

// ── variacao-auto-v1 §7.5-7.6 (13/10) ──
/** §7.5: captura da landing page (SPLIT-LP). Implementação: PuppeteerPageCaptureService (./captura-pagina). */
export interface PageCaptureError { error: 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT'; status: number | null; /** vai pro failDetail */ detail?: string }
export type PageCaptureResult = { fileId: string; widthPx: number; heightPx: number; text: string } | PageCaptureError;
export interface PageCaptureService {
  /** Viewport de celular renderizado a 1080 px de largura, até 3 telas de altura, 15 s de teto. Nunca lança. */
  capture(i: { workspaceId: string; url: string }): Promise<PageCaptureResult>;
}
/** §7.6 (./auto-edit): snapSpans(spans, words, silences) encaixa cada borda no meio da pausa entre palavras mais próxima;
 *  snapSpansEmOrdem não funde (COLD-OPEN); hasWrittenHook(editMap, 3); hasEndCard(editMap, teardown). Puras. */
export type { Span } from './auto-edit';
