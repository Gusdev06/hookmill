// troca-texto-queimado-v1 §15.4, §15.6.5 (F2 backend): o estado da troca de legenda de um campeão, em função PURA do que a
// leitura gravou (`editMap.captionTrack`) e da placa CAPTION vigente (`champion_plates`). Sem banco, sem porta.
// `CaptionTrack` ainda é tipo local do video (medicao/troca/legenda.ts), pendente de promoção ao `contratos/`.
import type { CaptionSwapReason, EditMap, Rect } from '@maquina/contratos';
import type { CaptionTrack } from '../medicao/troca/legenda';

/** `EditMap` com o campo novo da leitura. Ausente = não detectado; null = detectado, sem legenda queimada. */
export type EditMapLegenda = EditMap & { captionTrack?: CaptionTrack | null };

/** Linha vigente de `champion_plates` kind CAPTION (a mesma forma da headline). */
export interface CaptionPlateState { status: 'QUEUED' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED'; reason: string | null; version: number }

/**
 * - `unmeasured`: leitura sem `captionTrack` (campeão antigo, ou troca desligada): o chamador detecta.
 * - `none`: sem legenda queimada (`captionTrack === null`): nada a trocar, `avoid` não precisa de nada.
 * - `blocked`: o vídeo reprovou (`veredito.swap=false`) ou a placa reprovou/falhou: o formato segue fora, com `reason`.
 * - `needs_plate`: `swap` aprovado, placa ainda não pedida/pronta (QUEUED, RUNNING ou sem linha): o chamador enfileira e espera.
 * - `ready`: `swap` aprovado e placa READY: o formato bloqueado por legenda pode ser oferecido.
 */
export type CaptionSwapState = 'unmeasured' | 'none' | 'blocked' | 'needs_plate' | 'ready';
export interface CaptionSwapInfo { state: CaptionSwapState; reason: CaptionSwapReason | null }

const RAZOES_DA_PLACA: readonly CaptionSwapReason[] = ['plate_rejected', 'color_shift'];

export function captionSwapOf(m: EditMapLegenda | null, plate: CaptionPlateState | null): CaptionSwapInfo {
  const t = m?.captionTrack;
  if (t === undefined) return { state: 'unmeasured', reason: null };
  if (t === null) return { state: 'none', reason: null };
  if (!t.veredito.swap) return { state: 'blocked', reason: t.veredito.reason ?? 'not_detected' };
  if (!plate || plate.status === 'QUEUED' || plate.status === 'RUNNING') return { state: 'needs_plate', reason: null };
  if (plate.status === 'READY') return { state: 'ready', reason: null };
  if (plate.status === 'FAILED') return { state: 'blocked', reason: 'plate_failed' };
  const r = RAZOES_DA_PLACA.find((x) => x === plate.reason);
  return { state: 'blocked', reason: r ?? 'plate_rejected' };
}

/** Caixa (px do campeão) que a função exige acima de 60 s (§15.6.2): união das camadas `caption`. null = sem camada. */
export function captionBoxOf(m: EditMap): Rect | null {
  const bs = (m.layers ?? []).filter((l) => l.kind === 'caption').map((l) => l.box);
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const x2 = Math.max(...bs.map((b) => b.x + b.w)), y2 = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export const temCamadaLegenda = (m: EditMap | null): boolean => !!m?.layers?.some((l) => l.kind === 'caption');

/** `LEGENDA_MAX_SEC` (§15.8); inválido = padrão. */
export function legendaMaxSecDoEnv(v: string | undefined, padrao = 60): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

/** `CAPTION_SWAP=on|off` (padrão off): liga SÓ a troca de legenda (F2). A headline (F1b) segue por `PLATE_IMPL`. Lida a cada chamada. */
export const captionSwapLigado = (): boolean => (process.env.CAPTION_SWAP ?? '').trim().toLowerCase() === 'on';
