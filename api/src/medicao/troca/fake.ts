// Fake da porta (troca-texto §16.5, §16.6 V2: publicado ANTES do backend). Dono: video. Determinístico, sem Python,
// sem Chrome, sem rede: o backend (B1) e a QA testam o fluxo inteiro com ele, inclusive os caminhos de reprovação.
import type { CaptionSwapReason, EditMap, HeadlineLook, HeadlineLookReason } from '@maquina/contratos';
import type { MedidaHeadline } from './evento';
import { escolherAlvo, montarLook } from './look';
import { avaliarPlacaLegenda, avaliarPortoesLegenda, type CaptionTrack, type CaptionTrecho } from './legenda';
import { ErroTroca } from './orquestra';
import type { DetectarLegendaInput, DetectarLegendaResult, PlacaLegendaInput, PlacaLegendaResult, TrocaPorta, MedirHeadlineInput, MedirHeadlineResult, PlacaHeadlineInput, PlacaHeadlineResult, PlacaStatus } from './porta';

export interface FakeTrocaOpcoes {
  /** força o veredito da medida (padrão: aprovado) */
  motivo?: HeadlineLookReason | null;
  /** força o tipo (padrão: pelo fundo da camada: 'none' = solto) */
  kind?: 'box' | 'loose';
  /** resultado da placa (padrão READY) */
  placa?: PlacaStatus;
  /** atraso artificial em ms (para testar espera e timeout de 180 s) */
  atrasoMs?: number;
  /** legenda: força o veredito de `detectar` (padrão: aprovado pelos portões, com a duração do pedido) */
  motivoLegenda?: CaptionSwapReason | null;
  /** legenda: resultado da placa (padrão READY) */
  placaLegenda?: PlacaStatus;
  /** grava a placa: o backend injeta o storage de teste; ausente = não grava nada */
  gravar?: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
}

/** 1×1 PNG transparente, como `plate.image` e `emoji.image` do fake. */
const PNG_VAZIO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export class FakeTrocaTexto implements TrocaPorta {
  readonly chamadas: Array<{ op: 'medir' | 'placa' | 'detectar_legenda' | 'placa_legenda'; championId: string }> = [];
  constructor(private readonly o: FakeTrocaOpcoes = {}) {}

  private async esperar() {
    if (this.o.atrasoMs) await new Promise((r) => setTimeout(r, this.o.atrasoMs));
  }

  async medirHeadline(i: MedirHeadlineInput): Promise<MedirHeadlineResult> {
    this.chamadas.push({ op: 'medir', championId: i.championId });
    await this.esperar();
    const layer = escolherAlvo(i.editMap);
    if (!layer) return { look: null, costUsd: 0, ms: 0 };
    return { look: lookFake(i.editMap, layer.id, this.o), costUsd: 0, ms: 0 };
  }

  async placaHeadline(i: PlacaHeadlineInput): Promise<PlacaHeadlineResult> {
    this.chamadas.push({ op: 'placa', championId: i.championId });
    await this.esperar();
    const status = this.o.placa ?? 'READY';
    const metrics = { pedacos: 4, quadros: i.look.fit.canvas.height > 0 ? i.look.endFrame : 0, fantasma_pior_media: status === 'REJECTED' ? 9.5 : 0.3, fantasma_pior_corr: status === 'REJECTED' ? 0.4 : 0.01 };
    if (status !== 'READY') return { status, reason: status === 'REJECTED' ? 'plate_rejected' : 'plate_failed', metrics, sizeBytes: null, costUsd: 0, ms: 0 };
    const bytes = Buffer.from(`fake-plate:${i.championId}:${i.look.layerId}:v${i.version}`);
    if (this.o.gravar) await this.o.gravar(i.outputKey, bytes, 'video/mp4');
    return { status, reason: null, metrics, sizeBytes: bytes.length, costUsd: 0, ms: 0 };
  }
  async detectarLegenda(i: DetectarLegendaInput): Promise<DetectarLegendaResult> {
    this.chamadas.push({ op: 'detectar_legenda', championId: i.championId });
    await this.esperar();
    const layer = i.editMap.layers.find((l) => l.kind === 'caption');
    if (!layer) return { captionTrack: null, costUsd: 0, ms: 0 };
    return { captionTrack: trackFake(i, layer.wordsPerPage ?? 3, layer.style.fontId, layer.box, this.o.motivoLegenda ?? null), costUsd: 0, ms: 0 };
  }

  async placaLegenda(i: PlacaLegendaInput): Promise<PlacaLegendaResult> {
    this.chamadas.push({ op: 'placa_legenda', championId: i.championId });
    if (!i.captionTrack.veredito.swap) throw new ErroTroca('placa_legenda', `placa só com swap aprovado (reason ${i.captionTrack.veredito.reason})`);
    await this.esperar();
    const status = this.o.placaLegenda ?? 'READY';
    const quadros = i.captionTrack.trechos.reduce((m, t) => Math.max(m, t.fimFrame), 0);
    const ruim = status === 'REJECTED';
    const metrics: Record<string, number> = {
      pedacos: 4, quadros, quadros_placa: status === 'FAILED' ? 0 : quadros, janelas: 60, janelas_ruins_pct: ruim ? 0.9 : 0.05,
      ruim_gancho_s: ruim ? 3 : 0, ruim_pct: ruim ? 0.9 : 0.05, lisura_min: ruim ? 0.35 : 0.7, trem_max: ruim ? 6 : 2, degrau_max: ruim ? 3.5 : 1.5,
      letra_p95_pct: 0.1, fora_buraco_media: 0.4, salto_emenda_db_min: 41, cor_deslocamento: 0.3, pedaco_max_s: 0, pico_MB: 0,
    };
    if (status === 'FAILED') return { status, reason: 'plate_failed', metrics, sizeBytes: null, costUsd: 0, ms: 0 };
    const reason = avaliarPlacaLegenda(metrics);
    if (status === 'REJECTED') return { status, reason: reason ?? 'plate_rejected', metrics, sizeBytes: null, costUsd: 0, ms: 0 };
    const bytes = Buffer.from(`fake-caption-plate:${i.championId}:v${i.version}`);
    if (this.o.gravar) await this.o.gravar(i.outputKey, bytes, 'video/mp4');
    return { status, reason: null, metrics, sizeBytes: bytes.length, costUsd: 0, ms: 0, pioresQuadros: [30, 75, 120, 165, 210, 255].filter((f) => f < quadros) };
  }
}

/** Look plausível a partir da camada da visão: linhas pelo '\n' (ou 1 linha), corpo pelo estilo, régua `same`. */
export function lookFake(m: EditMap, layerId: string, o: FakeTrocaOpcoes = {}): HeadlineLook {
  const layer = m.layers.find((l) => l.id === layerId)!;
  const kind = o.kind ?? (layer.background.kind === 'none' ? 'loose' : 'box');
  const lines = (layer.text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const sz = layer.style.fontSizePx || Math.round(layer.box.h / Math.max(1, lines.length) / 1.2);
  const pitch = Math.round(sz * 1.2 * 100) / 100;
  const x0 = layer.box.x, w = layer.box.w;
  const linhas = lines.map((t, k) => {
    const y0 = Math.round(layer.box.y + k * pitch);
    const lw = Math.min(w, Math.round(t.length * sz * 0.5));
    const lx = Math.round(x0 + (w - lw) / 2);
    return [y0, Math.round(y0 + sz), lx, lx + lw - 1, lw];
  });
  const md: MedidaHeadline = {
    ok: !o.motivo, reason: o.motivo ?? null, kind, canvas: { width: m.width, height: m.height }, fps: m.fps, quadros: m.frameCount,
    startFrame: layer.startFrame, endFrame: layer.endFrame, gates: { fake: 1 },
    box: kind === 'box' ? layer.background.box ?? layer.box : null, radiusPx: 0,
    plate: kind === 'box' ? { color: layer.background.color ?? '#000000', image: PNG_VAZIO, temporalP99: 3.5, translucent: false } : null,
    dilatacao: kind === 'box' ? 9 : Math.round((17 * m.width) / 1080) | 1, sombra: null, stemPx: Math.round(sz * 0.12 * 100) / 100,
    color: layer.style.color, lines, linhasMedidas: linhas, align: layer.style.align, caseStyle: layer.style.uppercase ? 'upper' : 'sentence',
    emphasis: null, emoji: null, sideMarginPx: Math.round(0.05 * m.width),
    erasedRects: kind === 'loose' ? linhas.map(([y0, y1, a, , lw]) => ({ x: a, y: y0, w: lw, h: y1 - y0 })) : [],
    candidatas: [{ fontId: layer.style.fontId, cosPillow: 0.9, preStemErr: 0, layout: { sz, pitch, base: layer.box.y + sz, cxs: lines.map(() => x0 + w / 2), tr: 0 } }],
  };
  const regua = o.motivo ? null : { escolhida: layer.style.fontId, tier: 'same' as const, medidas: [{ fontId: layer.style.fontId, corr: 0.9, stemErr: 0, widthErr: 0.01 }] };
  return montarLook({ layer, m, md, regua, measuredIn: 'chrome-linux' });
}

/** Gates que provocam cada motivo da pré-placa (o resto fica nos valores bons medidos na S1/S4). */
const GATE_DO_MOTIVO: Partial<Record<CaptionSwapReason, Record<string, number>>> = {
  script_unsupported: { alfabeto_fora: 1 }, caption_emoji: { emoji_legenda: 1 }, not_detected: { cobertura: 0.5 }, no_outline: { contorno: 0 },
  multi_line: { linhas: 2 }, animated: { animacao: 0.2 }, font_mismatch: { iou_mediana: 0.2 }, style_unstable: { estilo_var: 0.12 },
  no_person: { pessoa_rosto: 0.6 }, busy_background: { fundo_lap: 78 }, too_long: { duracao_s: 999 },
};

/** captionTrack plausível: páginas de `wordsPerPage` palavras pela transcrição, fim = início da próxima (§16.2 A7). Determinístico. */
export function trackFake(i: DetectarLegendaInput, wordsPerPage: number, fontId: string, box: CaptionTrecho['box'], motivo: CaptionSwapReason | null = null): CaptionTrack {
  const m = i.editMap;
  const atrasoSec = 0.1;
  const paginas: CaptionTrecho[] = [];
  for (let k = 0; k < i.words.length; k += Math.max(1, wordsPerPage)) {
    const grupo = i.words.slice(k, k + Math.max(1, wordsPerPage));
    paginas.push({ iniFrame: Math.round((grupo[0].startSec + atrasoSec) * m.fps), fimFrame: 0, box, iou: 0.76, texto: grupo.map((w) => w.word).join(' '), herdado: false });
  }
  paginas.forEach((p, k) => { p.fimFrame = k + 1 < paginas.length ? paginas[k + 1].iniFrame : m.frameCount; });
  const gates: Record<string, number> = {
    duracao_s: i.durationSec, alfabeto_fora: 0, emoji_legenda: 0, cobertura: 0.97, contorno: 1, linhas: 1, animacao: 0.01, iou_mediana: 0.76, herdados: 0.03,
    estilo_var: 0.01, pessoa_rosto: 0.98, pessoa_fala: 0.95, fundo_lap: 30, ...(motivo ? GATE_DO_MOTIVO[motivo] : {}),
  };
  const v = avaliarPortoesLegenda(gates, { legendaMaxSec: i.legendaMaxSec });
  return {
    version: 1, trechos: paginas,
    estilo: { fontId, tamPx: 47, tracking: 0.02, espaco: 1, strokePx: 3, sombra: [5, 3], corTexto: '#ffffff', corDestaque: '#f9fc09', corTraco: '#000000', caixaDestaque: null, palavrasPorPagina: wordsPerPage, linhas: 1 },
    atrasoSec,
    pegada: paginas.map((p) => ({ iniFrame: p.iniFrame, fimFrame: p.fimFrame, areaPx: box.w * box.h })),
    cortes: [], artefato: v.swap ? `fake/caption-data/${i.championId}.npz` : null, caixa: false, faixa: [box.y, box.y + box.h],
    quadros: m.frameCount, fps: m.fps,
    veredito: { swap: v.swap, reason: v.reason, gates },
  };
}
