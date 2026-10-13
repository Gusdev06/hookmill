import type { Take as TakeRow } from '@prisma/client';
import { TAKE_MAX_SEC, type CatalogService } from '../integracoes';
import { num } from '../common/util/format';

/** §13.5: teto do áudio de um take (o Pruna aceita até 600 s numa chamada). */
export const TAKE_MAX_AUDIO_SEC = TAKE_MAX_SEC;
/** Piso do Pruna (áudio < ~1 s falha). */
export const AUDIO_LIPSYNC_MIN_SEC = 2;
/** Modelo de lipsync do take (o único hoje). */
export const TAKE_LIPSYNC_MODEL = 'pruna-lipsync';
/** Seed do Pruna: 7 na 1ª tentativa e +1 a cada nova tentativa (a 1ª regeração = 8). */
export const takeSeed = (attempt: number) => 6 + Math.max(1, attempt); // 7, 8, 9…

type Format = 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1';

/** Estimativa de (re)fazer o take inteiro (um arredondamento só, §13.5). */
export function takeEstimate(
  catalog: Pick<CatalogService, 'estimate'>,
  t: Pick<TakeRow, 'kind' | 'speech' | 'durationSec' | 'sourceStartSec' | 'sourceEndSec'>,
  format: Format,
  voiceId?: string | null,
) {
  const audio = takeAudioSec(t);
  const speech = t.speech ?? '';
  return catalog.estimate({
    engine: 'LIPSYNC', model: TAKE_LIPSYNC_MODEL, format, ...(voiceId && { voiceId }),
    scenes: [{ index: 0, label: 'take', startSec: 0, endSec: Math.max(audio, 0.001), speech, visualPrompt: '' }],
    pipelines: ['TAKE_SLICE'],
    take: { kind: t.kind, ...(t.kind === 'AUDIO_LIPSYNC' && { audioSec: audio }) },
  });
}

/** Só o custo (0 se o catálogo recusar, pra a leitura nunca quebrar). */
export function takeEstimateUsd(
  catalog: Pick<CatalogService, 'estimate'>,
  t: Pick<TakeRow, 'kind' | 'speech' | 'durationSec' | 'sourceStartSec' | 'sourceEndSec'>,
  format: Format,
): number {
  try {
    return takeEstimate(catalog, t, format).costUsd;
  } catch {
    return 0;
  }
}

/** Segundos do áudio do take: real quando já existe; senão a janela do campeão (AUDIO_LIPSYNC). */
export function takeAudioSec(t: Pick<TakeRow, 'durationSec' | 'sourceStartSec' | 'sourceEndSec'>): number {
  const d = num(t.durationSec);
  if (d != null && d > 0) return d;
  const a = num(t.sourceStartSec);
  const b = num(t.sourceEndSec);
  return a != null && b != null ? Math.max(0, b - a) : 0;
}
