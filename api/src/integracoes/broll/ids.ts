// Ids, proveniência e modelo do b-roll Pexels (separado pra trilha.ts e broll.service.ts não se importarem em ciclo).
import type { BrollProvenance } from '../contrato';
import { IntegracaoError } from '../erros';
import type { PexelsVideo } from './pexels';

export const PEXELS_LICENSE = 'Pexels License';
/** Modelo barato das duas chamadas (buscas e escolha por visão). */
export const BROLL_MODEL = 'claude-haiku-4-5';
export function candidateIdOf(videoId: number, startSec: number, endSec: number): string {
  return `pexels:${videoId}:${startSec.toFixed(2)}-${endSec.toFixed(2)}`;
}
export function parseCandidateId(id: string): { videoId: number; startSec: number; endSec: number } {
  const m = id.match(/^pexels:(\d+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!m) throw new IntegracaoError('BROLL_SOURCE_NOT_SUPPORTED', `unknown b-roll candidate "${id}"`, { reason: 'unknown_candidate' });
  return { videoId: Number(m[1]), startSec: Number(m[2]), endSec: Number(m[3]) };
}
export function provenanceOf(v: PexelsVideo, startSec: number, endSec: number): BrollProvenance {
  return { provider: 'pexels', sourceUrl: v.url, creator: v.user?.name || null, license: PEXELS_LICENSE, licenseCommercialOk: true, startSec, endSec };
}
