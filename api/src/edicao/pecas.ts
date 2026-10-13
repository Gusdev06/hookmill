// Peças do lote AUTO (variacao-auto-v1 §3.2, §5.1 e §8): regras puras, sem banco. Testadas em pecas.spec.ts.
import type { FormatCode, PieceStatus, VariationAxis } from '@maquina/contratos';
import type { VideoFormat } from '@prisma/client';

/** Template das renders de peça AUTO (Render.settings.templateId). O input real é do maquina-video (`auto-edit`). */
export const AUTO_EDIT_TEMPLATE = 'auto-edit';

/** Os 3 formatos de toda peça, na ordem da fila (D5: 9:16 de todas primeiro, depois 4:5, depois 1:1). */
export const AUTO_FORMATS: VideoFormat[] = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'];

export const FORMAT_CODE: Record<VideoFormat, FormatCode> = { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' };
export const FORMAT_OF_CODE: Record<FormatCode, VideoFormat> = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' };

/**
 * Ordem da fila no start (§5.1 esclarecimento 4): o 9:16 de todas as peças (na ordem do plano), depois todos os 4:5,
 * depois todos os 1:1. `seq` é a posição global (vira o deslocamento do createdAt; a fila tira o mais antigo primeiro).
 */
export function renderOrder<T extends { index: number }>(items: T[]): { item: T; format: VideoFormat; seq: number }[] {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  let seq = 0;
  return AUTO_FORMATS.flatMap((format) => sorted.map((item) => ({ item, format, seq: seq++ })));
}

export interface PieceRenderState { format: VideoFormat | null; status: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED'; createdAt: Date }

/** Render vigente de cada formato (o mais novo; renders refeitos no Retry deixam os antigos stale). */
export function latestByFormat<R extends PieceRenderState>(renders: R[]): Map<VideoFormat, R> {
  const out = new Map<VideoFormat, R>();
  for (const r of [...renders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (r.format) out.set(r.format, r);
  return out;
}

/** Status da peça, derivado na ordem do §3.2 (nunca salvo). */
export function pieceStatus(p: {
  launched: boolean; leftOutAt: Date | null; creativeState: string | null; renders: PieceRenderState[];
}): PieceStatus {
  if (!p.launched || !p.creativeState) return 'planned';
  if (p.leftOutAt) return 'left_out';
  if (p.creativeState === 'APPROVED') return 'ready';
  if (p.creativeState === 'RENDER_FAILED') return 'failed';
  if (p.renders.some((r) => r.status === 'RENDERING')) return 'rendering';
  return 'queued';
}

/** Desfecho dos renders da peça: null = ainda tem formato na fila/renderizando (nada muda no criativo). */
export function pieceOutcome(renders: PieceRenderState[]): 'ready' | 'failed' | null {
  const latest = latestByFormat(renders);
  const all = AUTO_FORMATS.map((f) => latest.get(f));
  if (all.some((r) => !r || r.status === 'QUEUED' || r.status === 'RENDERING')) return null;
  return all.every((r) => r!.status === 'READY') ? 'ready' : 'failed';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `MMDD` = data UTC do launchedAt do lote (todas as peças de um zip com a mesma data). */
export function mmddUtc(d: Date): string {
  return `${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** adName da peça AUTO, sem formato nem extensão (§8): CLIENTE_MMDD_CODIGO → "MC_1013_CUT-15S". Sufixo de colisão: ad-name.ts. */
export function autoAdName(i: { shortCode: string; launchedAt: Date; code: string }): string {
  return [i.shortCode, mmddUtc(i.launchedAt), i.code].join('_');
}

/** Nome do arquivo de um formato (§8): `<adName>_<FMT>.<ext>` → "MC_1013_CUT-15S_9x16.mp4" / "MC_1013_STATIC-F1_1x1.png". */
export function autoFileName(adName: string, format: VideoFormat, mimeType: string): string {
  return `${adName}_${FORMAT_CODE[format]}.${mimeType === 'image/png' ? 'png' : 'mp4'}`;
}

/** Pasta do zip pelo eixo (fixo por tipo, §6.1). */
export function folderOf(axis: VariationAxis | null): '1-stretch' | '2-new-audience' {
  return axis === 'DIVERSITY' ? '2-new-audience' : '1-stretch';
}

/** Código do formato a partir do ?format do download (padrão 9x16). */
export function formatFromQuery(q: string | undefined): VideoFormat {
  return FORMAT_OF_CODE[(q ?? '9x16') as FormatCode] ?? 'VERTICAL_9_16';
}

/**
 * Gatilho de mock do §10: `[mock:render-fail:<TYPE>]` nas notes da oferta faz a 1ª tentativa do 4:5 daquele tipo
 * falhar com RENDER_ERROR (o Retry passa).
 */
export function mockRenderFail(notes: string | null, type: string | null, format: VideoFormat, attempt: number): boolean {
  if (!notes || !type || format !== 'PORTRAIT_4_5' || attempt !== 1) return false;
  return notes.includes(`[mock:render-fail:${type}]`);
}

/**
 * Duração de saída esperada de uma peça (pra `renderEtaSec`, §10): CUT = alvo; ENDCARD = original + 2 s; STATIC = still
 * (conta 1 s); resto = duração do campeão.
 */
export function expectedOutputSec(type: string | null, params: Record<string, unknown> | null, championSec: number): number {
  if (type === 'CUT' && typeof params?.targetSec === 'number') return params.targetSec;
  if (type === 'ENDCARD') return championSec + 2;
  if (type === 'STATIC') return 1;
  return championSec;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
