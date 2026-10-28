// legenda-protegida-v1 §1: faixa protegida = a legenda queimada do campeão (união das posições, com folga, px do arquivo).
// Calculada uma vez na análise e gravada no editMap; campeão antigo sem o campo é recalculado na hora a partir de `layers`.
// Com a "versão sem legenda" (§2.3) a faixa deixa de ser protegida: o mapa usado pelas peças perde as camadas `caption`.
import type { EditMap, ProtectedBand } from '@maquina/contratos';
import { faixasProtegidasDe } from '@maquina/video';

type Dim = { width: number; height: number };

/** Mapa com `protectedBands` (só quando há legenda queimada). */
export function comFaixasProtegidas<T extends EditMap>(m: T, source: Dim): T {
  const bands = faixasProtegidasDe(m as never, source);
  return bands.length ? { ...m, protectedBands: bands } : m;
}

/** Faixas do campeão (px do arquivo): as gravadas na análise ou, campeão antigo sem o campo, recalculadas das camadas. */
export function faixasDoCampeao(m: EditMap | null, source: Dim): ProtectedBand[] {
  if (!m) return [];
  // Use the current layers, exactly like the render builders. A cached [] can predate caption detection.
  return faixasProtegidasDe(m as never, source);
}

/** §2.3: com a versão sem legenda, o mapa das peças não tem legenda queimada (nada protegido, legenda nossa liga). */
export function semLegendaQueimada(m: EditMap | null): EditMap | null {
  if (!m) return m;
  const { protectedBands: _p, ...rest } = m;
  return { ...rest, layers: (m.layers ?? []).filter((l) => l.kind !== 'caption') };
}
