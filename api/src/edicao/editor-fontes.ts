// Fontes que os editores oferecem (decisão 06/11, F1b): as 9 do catálogo de antes do F1b (`git show f7de60c:video/src/lib/remix.ts`).
// A V1 acrescentou ao `FONT_CATALOG` pesos médios (Montserrat/Inter/Poppins 500-700, Arimo, TikTok Sans, Albert Sans) só para
// COPIAR uma headline; o seletor do editor continua como era. O web filtra igual (`web/src/lib/editor-fonts.ts`).
import { FONT_CATALOG, type FontId } from '@maquina/video';

export const EDITOR_FONT_IDS: readonly FontId[] = [
  'montserrat-800', 'montserrat-900', 'inter-800', 'anton-400', 'oswald-700', 'bebas-neue-400', 'archivo-black-400', 'poppins-800', 'roboto-condensed-700',
] as FontId[];

/** `fonts` da resposta do editor: só as do seletor de antes, na ordem do catálogo. */
export function editorFonts(): { id: FontId; label: string }[] {
  return (Object.keys(FONT_CATALOG) as FontId[]).filter((id) => EDITOR_FONT_IDS.includes(id)).map((id) => ({ id, label: FONT_CATALOG[id].label }));
}
