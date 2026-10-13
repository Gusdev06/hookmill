// Nome padronizado do arquivo (fase2-agencia.md §6, D6): CLIENTE_CAMINHO_MMDD_ROTEIRO_ROSTO_FORMATO (sem ".mp4").
// Função pura: o download (provisório) e o approve (congelado em Creative.adName) usam a mesma.
import type { VariationKind, VideoFormat } from '@maquina/contratos';

export interface AdNameInput {
  shortCode: string;
  origin: 'SCRATCH' | 'VARIATION';
  /** data do OK final; sem ela, `now` (UTC) */
  approvedAt: Date | null;
  now?: Date;
  /** letra do roteiro escolhido (criativo do zero) */
  scriptLetter: string | null;
  /** item do lote (variação) */
  variation: { kind: VariationKind; index: number; isControl: boolean } | null;
  /** rosto escolhido (do criativo ou do elenco); null = rosto original do campeão */
  face: { batch: number; position: number } | null;
  format: VideoFormat;
}

const KIND_CODE: Record<VariationKind, string> = { NEW_HOOKS: 'H', SWAP_AVATAR: 'AV', COPY_NEW: 'C', REMIX_EDIT: 'L', AUTO_EDIT: 'A' }; // AUTO_EDIT: peça AUTO usa o nome próprio (variacao-auto-v1 §8); 'A' é só reserva
const FORMAT_CODE: Record<VideoFormat, string> = { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' };

const pad2 = (n: number) => String(n).padStart(2, '0');

export function adFileName(c: AdNameInput): string {
  const d = c.approvedAt ?? c.now ?? new Date();
  const mmdd = `${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
  const path = c.origin === 'VARIATION' ? 'ITER' : 'NEW';
  let script: string;
  if (c.origin === 'VARIATION' && c.variation) {
    script = c.variation.isControl ? 'CTRL' : `${KIND_CODE[c.variation.kind]}${pad2(c.variation.index + 1)}`;
  } else {
    script = c.scriptLetter?.toUpperCase() || 'X';
  }
  const face = c.face ? `F${(c.face.batch - 1) * 4 + c.face.position + 1}` : 'ORIG';
  return [c.shortCode, path, mmdd, script, face, FORMAT_CODE[c.format]].join('_');
}

/** Primeiro nome livre: base, base_2, base_3… (sufixo no fim pra não quebrar o parse das 6 partes). */
export function withCollisionSuffix(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}
