// Fake da porta (troca-texto §16.5, §16.6 V2: publicado ANTES do backend). Dono: video. Determinístico, sem Python,
// sem Chrome, sem rede: o backend (B1) e a QA testam o fluxo inteiro com ele, inclusive os caminhos de reprovação.
import type { EditMap, HeadlineLook, HeadlineLookReason } from '@maquina/contratos';
import type { MedidaHeadline } from './evento';
import { escolherAlvo, montarLook } from './look';
import type { MedirHeadlineInput, MedirHeadlineResult, PlacaHeadlineInput, PlacaHeadlineResult, PlacaStatus, TrocaTextoPort } from './porta';

export interface FakeTrocaOpcoes {
  /** força o veredito da medida (padrão: aprovado) */
  motivo?: HeadlineLookReason | null;
  /** força o tipo (padrão: pelo fundo da camada: 'none' = solto) */
  kind?: 'box' | 'loose';
  /** resultado da placa (padrão READY) */
  placa?: PlacaStatus;
  /** atraso artificial em ms (para testar espera e timeout de 180 s) */
  atrasoMs?: number;
  /** grava a placa: o backend injeta o storage de teste; ausente = não grava nada */
  gravar?: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
}

/** 1×1 PNG transparente, como `plate.image` e `emoji.image` do fake. */
const PNG_VAZIO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export class FakeTrocaTexto implements TrocaTextoPort {
  readonly chamadas: Array<{ op: 'medir' | 'placa'; championId: string }> = [];
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
