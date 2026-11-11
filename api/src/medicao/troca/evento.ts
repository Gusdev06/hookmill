// Formato das ops Python (py/worker.py) da troca de texto. Igual no adaptador local e no lambda. Dono: video.
import type { Rect } from '@maquina/contratos';

export const TROCA_EVENTO_VERSAO = 1;

export type TrocaOp = 'versoes' | 'sondar' | 'medir_headline' | 'placa_headline' | 'juntar' | 'conferir' | 'detectar' | 'placa_legenda' | 'conferir_legenda';

/** Arquivos: nome local na função → URL (GET/PUT assinado) ou caminho absoluto (local). */
export interface EventoTroca {
  v: typeof TROCA_EVENTO_VERSAO;
  op: TrocaOp;
  get?: Record<string, string>;
  put?: Record<string, string>;
  [k: string]: unknown;
}

/** O que o worker devolve: `ok_op` false = erro da op (traz `erro`); o handler do Lambda soma `proc_ok`, `frio`, pico de RSS.
 *  `ok` é da MEDIDA (vídeo aprovado ou não), nunca da execução. */
export interface RespostaTroca {
  op: string;
  ok_op?: boolean;
  proc_ok?: boolean;
  ok?: boolean;
  erro?: string;
  trace?: string;
  total_s?: number;
  pico_arvore_MB?: number;
  frio?: boolean;
  [k: string]: unknown;
}

/** Fronteira de execução: roda 1 op e devolve o JSON + custo; dá destinos e origens de arquivo. Trocada por falso nos testes. */
export interface ExecutorTroca {
  readonly impl: 'local' | 'lambda';
  executar(ev: EventoTroca): Promise<{ r: RespostaTroca; costUsd: number; ms: number }>;
  /** Onde a op grava um arquivo. Com `chaveFinal`, já é a chave definitiva do storage (lambda). */
  destino(nome: string, contentType: string, chaveFinal?: string): Promise<SaidaTroca>;
  /** Como outra op lê um arquivo gravado antes (outro pedaço). */
  origem(s: SaidaTroca): Promise<string>;
  /** Garante o arquivo em `chave` no storage (local: sobe; lambda: já está lá se o destino foi criado com a chave). */
  publicar(s: SaidaTroca, chave: string, contentType: string): Promise<void>;
  apagar(s: SaidaTroca): Promise<void>;
}

export interface SaidaTroca {
  /** URL de PUT assinada (lambda) ou caminho absoluto (local) */
  destino: string;
  /** chave no storage (lambda) ou caminho (local) */
  ref: string;
}

/** Camada alvo e contexto mandados à medida (fase `medida`). Px na grade do campeão. */
export interface AlvoMedida {
  layerId: string;
  startFrame: number;
  endFrame: number;
  box: Rect;
  text: string;
}

export interface LayoutFonte { sz: number; pitch: number; base: number; cxs: number[]; tr: number }

export interface CandidataFonte { fontId: string; cosPillow: number; preStemErr: number; layout: LayoutFonte }

export interface MedidaHeadline {
  ok: boolean;
  reason: string | null;
  kind?: 'box' | 'loose';
  canvas: { width: number; height: number };
  fps: number;
  quadros: number;
  startFrame?: number;
  endFrame?: number;
  gates: Record<string, number | string>;
  box?: Rect | null;
  radiusPx?: number;
  plate?: { color: string; image: string; temporalP99: number; translucent: boolean } | null;
  dilatacao?: number;
  sombra?: { dx: number; dy: number; blurPx: number; color: string } | null;
  stemPx?: number;
  color?: string;
  lines?: string[];
  /** [y0, y1, x0, x1, largura] por linha, px do campeão (sem o emoji) */
  linhasMedidas?: number[][];
  align?: 'left' | 'center' | 'right';
  caseStyle?: 'upper' | 'sentence' | 'title';
  emphasis?: { kind: 'underline'; thicknessPx: number; offsetPx: number; color: string } | null;
  emoji?: {
    char: string; image: string; x: number; y: number; w: number; h: number; lineIndex: number; side: 'start' | 'end';
    gapPx: number; marginLeftPx: number; solidity: number; bbox: [number, number, number, number]; ocupa: number;
  } | null;
  sideMarginPx?: number;
  erasedRects?: Rect[];
  candidatas?: CandidataFonte[];
  molde?: { roi: [number, number, number, number]; brilho: number };
  ref?: Record<string, unknown>;
}

export interface MedidaRegua {
  fontId: string;
  corr?: number;
  stem?: number;
  stemErr?: number;
  widthErr?: number;
  baseErr720?: number;
  pitchErr720?: number;
  ok?: boolean;
  motivo?: string;
}

export interface ResultadoRegua {
  escolhida: string | null;
  tier: 'same' | 'close' | 'far';
  medidas: MedidaRegua[];
  motivo?: string;
}

/** Resposta da op `detectar` (py/legenda_ops.py). `detectou: false` = nada com contorno na faixa (só traz `gates`). */
export interface RespostaDetectarLegenda {
  detectou: boolean;
  gates: Record<string, number>;
  quadros: number;
  fps: number;
  tempos?: Record<string, number>;
  estilo?: {
    fontId: string; tamPx: number; tracking: number; espaco: number; strokePx: number; sombra: [number, number];
    corTexto: string; corDestaque: string | null; corTraco: string; caixaDestaque: { cor: string; raioPx: number } | null;
    palavrasPorPagina: number; linhas: number; baseY: number; centroX: number;
  };
  atrasoSec?: number;
  trechos?: Array<{ iniFrame: number; fimFrame: number; box: [number, number, number, number]; iou: number; texto: string; herdado: boolean }>;
  pegada?: Array<{ iniFrame: number; fimFrame: number; areaPx: number }>;
  cortes?: number[];
  caixa?: boolean;
  faixa?: [number, number];
}

/** Resposta de `conferir_legenda` por intervalo; `janelas[].ruim` null = janela sem medida (sem legenda ou com corte). */
export interface RespostaConferirLegenda {
  ini: number; fim: number;
  janelas: Array<{ iniFrame: number; ruim: boolean | null; corte: boolean; lisura: number | null; trem: number | null; degrau: number | null; detalhe: number | null }>;
  fora_buraco_media: number; fora_buraco_pior: number; fora_valor_soma: number; fora_valor_n: number;
  letra_valores: number[]; salto_emenda_db: number[]; matriz_desconhecida: boolean; quadros_video: number; quadros_placa: number;
}
