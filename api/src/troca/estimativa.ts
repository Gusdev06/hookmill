import type { EditMap, SwapEngine, SwapVoiceSource, TranscriptWord } from '@maquina/contratos';
import { spanRegion } from '../campeoes/mapa-edicao';
import type { Creative } from '@prisma/client';
import { editMapOf } from '../campeoes/champion-views';
import type { CatalogService } from '../integracoes';
import type { PrismaService } from '../prisma/prisma.service';
import { faceWindowOf, swapScenes, type TeardownSnapshot } from '../variacoes/plano';
import { hasSwapCatalog, swapCatalog, type SwapEstimate } from './portas';

type Region = { w: number; h: number };

/** Maior região do rosto entre os trechos main (a do rosto Soul, §13.3). */
export function largestRegion(m: EditMap): Region | null {
  let best: Region | null = null;
  for (const sp of swapScenes({ words: [] }, m)) {
    const r = spanRegion(m, sp.frames!);
    if (r && (!best || r.w * r.h > best.w * best.h)) best = { w: r.w, h: r.h };
  }
  return best;
}

/**
 * Cotação de 1 item SWAP_AVATAR numa combinação motor × voz (§13.15.5, preço da ia). null = catálogo ainda sem
 * `estimateSwap` (I6) ou campeão sem trecho main.
 */
export function swapItemQuote(catalog: CatalogService, engine: SwapEngine, voiceSource: SwapVoiceSource, s: Pick<TeardownSnapshot, 'words' | 'editMap'>): SwapEstimate | null {
  const m = s.editMap;
  if (!m || !hasSwapCatalog(catalog, 'estimateSwap')) return null;
  const region = largestRegion(m);
  if (!region) return null;
  const spans = swapScenes(s, m).map((x) => ({ sec: x.endSec - x.startSec, words: x.words ?? [] }));
  const win = faceWindowOf(m);
  return swapCatalog(catalog, 'estimateSwap').estimateSwap({
    engine, voiceSource, spans, takeSec: win ? win.endSec - win.startSec : 0, region, aspect: catalog.faceAspectFor(region.w, region.h),
  });
}

/** "Refazer trecho (US$ x)": todas as janelas + v2v/transcrição de UM trecho. 0 quando o catálogo ainda não cota. */
export function swapSceneEstimate(
  catalog: CatalogService, engine: SwapEngine, voiceSource: SwapVoiceSource, m: EditMap,
  scene: { startFrame: number; endFrame: number; words: TranscriptWord[] },
): { costUsd: number; etaSec: number } {
  if (!hasSwapCatalog(catalog, 'estimateSwap')) return { costUsd: 0, etaSec: 0 };
  const r = spanRegion(m, scene) ?? largestRegion(m);
  if (!r) return { costUsd: 0, etaSec: 0 };
  const e = swapCatalog(catalog, 'estimateSwap').estimateSwap({
    engine, voiceSource, spans: [{ sec: (scene.endFrame - scene.startFrame) / m.fps, words: scene.words }], takeSec: 0,
    region: { w: r.w, h: r.h }, aspect: catalog.faceAspectFor(r.w, r.h),
  });
  return { costUsd: e.perItemUsd, etaSec: e.etaSec };
}

/** Mapa da edição do criativo de variação: a fotografia do lote (a mesma do plano); senão o do campeão. */
export async function loadEditMap(prisma: Pick<PrismaService, 'variationBatch' | 'teardown'>, c: Pick<Creative, 'variationBatchId' | 'championId'>): Promise<EditMap | null> {
  if (c.variationBatchId) {
    const b = await prisma.variationBatch.findUnique({ where: { id: c.variationBatchId }, select: { teardownSnapshot: true } });
    const snap = b?.teardownSnapshot as { editMap?: EditMap | null } | null;
    if (snap?.editMap) return snap.editMap;
  }
  if (!c.championId) return null;
  const t = await prisma.teardown.findUnique({ where: { championId: c.championId }, select: { editMap: true } });
  return editMapOf(t?.editMap);
}
