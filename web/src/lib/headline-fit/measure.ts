/**
 * The ONLY door to `ajustarHeadlineCopia` in the web (troca-texto-queimado-v1 §14.4, §16.3): the same pure function the API runs on
 * the plan and on PATCH …/texts. It measures with video/src/lib/metricas-fontes.ts (~0.9 MB of font tables), so this module is
 * never imported statically: `loadHeadlineFit()` (index.ts) pulls it with a dynamic import, in its own chunk, only on a screen
 * that has a headline to measure.
 *
 * Imported from the source file, not from `@maquina/video` or `@maquina/video/player`: those barrels drag the whole lib (and the
 * Remotion compositions) into the chunk. The relative path stays inside the monorepo (video/ is a workspace, transpiled by Next).
 */
export { ajustarHeadlineCopia } from "../../../../video/src/lib/ajuste-headline"
