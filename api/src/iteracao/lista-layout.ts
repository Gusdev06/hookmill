// templates-lista-v1 §3.2: as funções puras de layout da lista são do maquina-video (`video/src/lib/listaOverlay.ts`).
// Aqui só a ponte: o backend fala `FormatCode` ('9x16'…) e o video `VideoFormat` ('VERTICAL_9_16'…).
import type { FormatCode } from '@maquina/contratos';
import { agendaLista, needLista, posicionarLista as posicionarListaV, type ListPlacement, type VideoFormat } from '@maquina/video';

export type { ListPlacement };
export interface Rect { x: number; y: number; w: number; h: number }
export { agendaLista, needLista };

export const VIDEO_FORMAT_OF: Record<FormatCode, VideoFormat> = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' };

export function posicionarLista(i: Omit<Parameters<typeof posicionarListaV>[0], 'format'> & { format: FormatCode }): ListPlacement {
  return posicionarListaV({ ...i, format: VIDEO_FORMAT_OF[i.format] });
}
