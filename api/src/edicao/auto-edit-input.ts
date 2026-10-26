// Ponte entre a fila de render (backend, dono da tabela renders) e a função pura do maquina-video que monta o
// AutoEditRenderInput (variacao-auto-v1 §7.3: `buildAutoEditInput(ctx, format)` em api/src/render/auto-edit.ts).
// Token de DI pra o teste poder trocar o builder; o EdicaoModule injeta o do video.
import type { VideoFormat } from '@prisma/client';
import type { AutoEditContext } from '../render/auto-edit';
import type { AutoEditRenderInput } from '../render/contrato';
import type { OpcoesDeBuild } from '../render/frame';

export const AUTO_EDIT_BUILDER = Symbol('AUTO_EDIT_BUILDER');
export type { AutoEditContext };
/** `opts.captionMode` (legenda-protegida §3, rev. 26/10): 'replace' = Retry depois de CAPTION_COVERED */
export type AutoEditBuilder = (ctx: AutoEditContext, format: VideoFormat, opts?: OpcoesDeBuild) => AutoEditRenderInput;
