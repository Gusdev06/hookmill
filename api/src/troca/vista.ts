import type { FileRef, SceneSwap, SwapVoiceSource } from '@maquina/contratos';
import type { Creative, Scene as SceneRow } from '@prisma/client';
import { num } from '../common/util/format';
import { engineOfModel, swapStage, windowsOf } from './regras';

/** SceneSwap do contrato a partir da linha (o FileRef de cada janela vem de `fileRef`). */
export async function sceneSwapOf(
  s: SceneRow, c: Pick<Creative, 'engineModel' | 'voiceSource'>, fileRef: (id: string) => Promise<FileRef | null>, regenerateEstimateUsd: number,
): Promise<SceneSwap | null> {
  const engine = engineOfModel(c.engineModel);
  if (s.pipeline !== 'SWAP_VIDEO' || !engine || s.startFrame == null || s.endFrame == null) return null;
  const voiceSource: SwapVoiceSource = c.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO';
  const windows = windowsOf(s.windows);
  return {
    engine, voiceSource, startFrame: s.startFrame, endFrame: s.endFrame,
    windows: await Promise.all(windows.map(async ({ clipFileId, ...w }) => ({ ...w, clip: w.status === 'READY' && clipFileId ? await fileRef(clipFileId) : null }))),
    stage: swapStage({ status: s.status, windows, rawClipFileId: s.rawClipFileId, clipFileId: s.clipFileId, voiceSource, fit: s.fit }),
    fit: (s.fit as unknown as SceneSwap['fit']) ?? null,
    identityScore: num(s.identityScore),
    regenerateEstimateUsd,
  };
}

