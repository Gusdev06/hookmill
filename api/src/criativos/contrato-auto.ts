// variacao-auto-v1 §4 "Mudanças em tipos existentes": os campos novos de VariationRef, LibraryItem, LibraryQuery e
// WaitingBatchRef ainda não estão em @maquina/contratos (index.ts/agencia.ts, dono: arquiteto). Estes tipos são a ponte:
// interseção com os do pacote, mesmo nome de campo do contrato. Quando o arquiteto subir os campos, viram aliases.
import type { FileRef, LibraryItem, LibraryQuery, VariationRef, WaitingBatchRef } from '@maquina/contratos';
import type { FormatCode, VariationAxis } from '@maquina/contratos';

export type VariationRefAuto = VariationRef & { code: string | null; axis: VariationAxis | null };

export type LibraryItemAuto = Omit<LibraryItem, 'variation'> & {
  variation: VariationRefAuto | null;
  /** 'image' = peça STATIC: o campo `video` carrega o PNG */
  media: 'video' | 'image';
  formats: { format: FormatCode; file: FileRef }[];
};

export type LibraryQueryAuto = LibraryQuery & { variationCode?: string; media?: 'video' };

export type WaitingBatchRefAuto = Omit<WaitingBatchRef, 'status'> & {
  status: WaitingBatchRef['status'] | 'ANALYSIS_FAILED' | 'PIECES_READY';
  mode: 'MANUAL' | 'AUTO';
  /** lote AUTO LAUNCHED: peças prontas ("N pieces ready"); null nos outros */
  readyCount: number | null;
};
