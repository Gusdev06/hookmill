import type { FontId } from "@/lib/api/types"

/**
 * The fonts the editors offer: the 9 of the catalog before the F1b (`git show f7de60c:video/src/lib/remix.ts`). The F1b V1 added the
 * medium weights (Montserrat/Inter/Poppins 500-700, Arimo, TikTok Sans, Albert Sans) to `FONT_CATALOG` only to COPY a headline;
 * the API lists every catalog id in `fonts` (api/src/edicao/editor.service.ts and editor-auto.service.ts), so the web filters here.
 * Decision 06/11: the picker stays as it was. A layer already using another font keeps it listed, so the select never goes blank.
 */
export const EDITOR_FONT_IDS: readonly FontId[] = [
  "montserrat-800", "montserrat-900", "inter-800", "anton-400", "oswald-700", "bebas-neue-400", "archivo-black-400", "poppins-800", "roboto-condensed-700",
]
const OFFERED = new Set<string>(EDITOR_FONT_IDS)

export const editorFonts = <F extends { id: string }>(fonts: readonly F[], current?: string | null): F[] =>
  fonts.filter((f) => OFFERED.has(f.id) || f.id === current)
