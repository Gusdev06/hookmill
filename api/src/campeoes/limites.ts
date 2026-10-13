import type { VariationKind } from '@maquina/contratos';
import type { CatalogService } from '../integracoes';

/** Limites da feature 2 (feature-2-variar-campeao.md §2). Tamanho/duração vêm do AppConfig (.env). */
export const CHAMPION_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;
/** variacao-auto-v1 D4: foto opcional do produto na oferta (reserva do SPLIT-LP). */
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TTL_MS = 30 * 60_000;
export const MIN_SIDE_PX = 240;
export const LOW_RES_SIDE_PX = 720;
/** hasSpeech = transcrição com ≥ 5 palavras. */
export const MIN_SPEECH_WORDS = 5;
/** Frames-chave mandados ao Claude: até 16, lado maior 768 px (§6.1). */
export const MAX_KEYFRAMES = 16;
export const KEYFRAME_MAX_SIDE = 768;
/** Nº de frames usado só pra estimar o custo da análise antes de medir. */
export const ESTIMATE_KEYFRAMES = 12;

/** Tipos que já estão no build (10/10). COPY_NEW e REMIX_EDIT entram depois. */
export const ENABLED_KINDS: readonly VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS'];
export const ALL_KINDS: readonly VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT'];
/** Tipos que precisam de fala no campeão (§2: sem fala, SWAP_AVATAR e NEW_HOOKS indisponíveis). */
export const NEEDS_SPEECH: readonly VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS'];

/** Link aceito: um anúncio só, facebook.com/ads/library/?id=<dígitos> (outros parâmetros podem vir). */
export function adArchiveIdOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
  if (!/^\/ads\/library\/?$/i.test(u.pathname)) return null;
  const id = u.searchParams.get('id');
  return id && /^\d+$/.test(id) ? id : null;
}

/** Fallback se o catálogo ainda não souber estimar a análise: ~US$ 0,30 por 30 s (§7). */
const FALLBACK_USD_PER_SEC = 0.01;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function analysisEstimateUsd(catalog: CatalogService, durationSec: number): number {
  try {
    const v = catalog.estimateAnalysis(durationSec, ESTIMATE_KEYFRAMES);
    if (Number.isFinite(v) && v >= 0) return r4(v);
  } catch {
    /* catálogo sem a função ainda (I4a) */
  }
  return r4(durationSec * FALLBACK_USD_PER_SEC);
}

/** analysisUsdPerSec do ChampionConfig: custo médio por segundo num campeão de 30 s. */
export function analysisUsdPerSec(catalog: CatalogService): number {
  return r4(analysisEstimateUsd(catalog, 30) / 30);
}

/** Fallback do plano (planAutoBatch, 1 chamada) se o catálogo ainda não souber estimar (I1). */
const FALLBACK_PLAN_USD = 0.05;

/**
 * variacao-auto-v1 §9: análise do lote AUTO = leitura (Whisper + teardown + mapa) + o plano. `planOnly` = campeão da
 * Library já analisado (só o plano é cobrado). É o número do `complete` e do teto de gasto do POST /iterate.
 */
export function autoAnalysisEstimateUsd(catalog: CatalogService, durationSec: number, planOnly = false): number {
  try {
    const v = catalog.estimateAutoAnalysis(durationSec, { keyframeCount: ESTIMATE_KEYFRAMES, planOnly });
    if (Number.isFinite(v) && v >= 0) return r4(v);
  } catch {
    /* catálogo sem a função ainda (I1) */
  }
  return r4((planOnly ? 0 : analysisEstimateUsd(catalog, durationSec)) + FALLBACK_PLAN_USD);
}
