import { z } from 'zod';

/** Legenda automática (headline-e-legenda-v1 §2, `captionsAuto`): palavras do campeão (tempo do arquivo), cor da palavra
 *  da vez (brandColor) e idioma da fala. Usada pela Moldura, pelo AutoEdit e pelo remix-keep (src/lib/legendaAuto.ts).
 *  Arquivo só com zod (sem dependência) pra não criar ciclo entre autoEdit.ts e molduras.ts. */
export const captionsAutoSchema = z.object({
  words: z.array(z.object({ word: z.string(), startSec: z.number().min(0), endSec: z.number().min(0) })),
  highlightColor: z.string(),
  language: z.string(),
});
export type CaptionsAuto = z.infer<typeof captionsAutoSchema>;
