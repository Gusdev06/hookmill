// Schema do enquadramento do vídeo numa caixa (FrameReframe, molduras.ts). Mora separado pra o remix.ts usar sem ciclo
// (molduras → autoEdit → remix).
import { z } from 'zod';

const focusSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const frameReframeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('cover'), focus: focusSchema, scale: z.number().positive().max(1).optional() }),
  z.object({ mode: z.literal('contain_blur'), focus: focusSchema.optional() }),
  z.object({ mode: z.literal('manual'), fit: z.enum(['cover', 'contain_blur']), zoom: z.number().positive(), dx: z.number(), dy: z.number() }),
]);
