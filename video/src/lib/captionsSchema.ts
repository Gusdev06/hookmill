import { z } from 'zod';

/** Legenda automática (headline-e-legenda-v1 §2, `captionsAuto`): palavras do campeão (tempo do arquivo), cor da palavra
 *  da vez (brandColor) e idioma da fala. Usada pela Moldura, pelo AutoEdit e pelo remix-keep (src/lib/legendaAuto.ts).
 *  Arquivo só com zod (sem dependência) pra não criar ciclo entre autoEdit.ts e molduras.ts. */
export const captionsAutoSchema = z.object({
  words: z.array(z.object({ word: z.string(), startSec: z.number().min(0), endSec: z.number().min(0) })),
  highlightColor: z.string(),
  language: z.string(),
  /** legenda-protegida-v1 §2.2: estilo da legenda ORIGINAL do campeão (a nossa entra no lugar dela). fontId fora do catálogo
   *  ou ausente = fonte do template, mantendo cor, contorno e caixa alta (D-LP2). `sizeRel` = tamanho / altura do arquivo. */
  style: z.object({
    fontId: z.string().nullable(), uppercase: z.boolean(), color: z.string(), highlightColor: z.string().nullable(),
    strokeColor: z.string().nullable(), strokeWidthRel: z.number().min(0), sizeRel: z.number().positive(), shadow: z.boolean(),
    wordsPerPage: z.number().int().positive().nullable(),
  }).optional(),
});

/** legenda-protegida-v1 §1: faixa protegida (px do arquivo do campeão, já com folga), com o intervalo em que aparece. */
export const protectedBandSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), startSec: z.number().min(0), endSec: z.number().min(0) });
export type ProtectedBand = z.infer<typeof protectedBandSchema>;
/** Região da legenda no vídeo RENDERIZADO (px da saída, tempo da peça), pra checagem por visão (§4.2). Calculada pelos
 *  builders (faixasProtegidasNaSaida*); a composição ignora. */
export const outputProtectedBandSchema = z.object({ kind: z.enum(['original', 'replaced']), x: z.number(), y: z.number(), w: z.number(), h: z.number(), startSec: z.number().min(0), endSec: z.number().min(0) });
export type CaptionsAuto = z.infer<typeof captionsAutoSchema>;
