// Fontes em public/fonts (cópia dos .woff2 do @fontsource, subconjunto latin: PT, EN, ES, FR, DE, IT), carregadas com
// staticFile. No render, staticFile aponta pro public do bundle (sem rede, serve igual pro Lambda). No @remotion/player
// do web aponta pra /fonts/... do site: o web copia video/public/fonts -> web/public/fonts (editor-v1 §8).
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';
import { FONT_CATALOG, type FontId } from './lib/remix';
import { cjkDe, ehCJK, type CjkFont } from './lib/molduras';
import { CJK_PEDACOS } from './fontes-cjk';

export const INTER = 'MaquinaInter';
export const MONTSERRAT = 'MaquinaMontserrat';

/** Arquivo (relativo a public/) de cada fonte do catálogo (§13.6). */
const ARQUIVOS: Record<FontId, string> = {
  'montserrat-800': 'fonts/montserrat-latin-800-normal.woff2',
  'montserrat-900': 'fonts/montserrat-latin-900-normal.woff2',
  'inter-800': 'fonts/inter-latin-800-normal.woff2',
  'anton-400': 'fonts/anton-latin-400-normal.woff2',
  'oswald-700': 'fonts/oswald-latin-700-normal.woff2',
  'bebas-neue-400': 'fonts/bebas-neue-latin-400-normal.woff2',
  'archivo-black-400': 'fonts/archivo-black-latin-400-normal.woff2',
  'poppins-800': 'fonts/poppins-latin-800-normal.woff2',
  'roboto-condensed-700': 'fonts/roboto-condensed-latin-700-normal.woff2',
};
const INTER_600 = 'fonts/inter-latin-600-normal.woff2';

/** Os 10 arquivos que o web precisa servir em /fonts (o prebuild do web copia esta lista). */
export const ARQUIVOS_DE_FONTE: readonly string[] = [INTER_600, ...new Set(Object.values(ARQUIVOS))];

let fontesDosTemplates: Promise<void> | null = null;
/** Fontes dos templates do zero (clean/bold/headline). Uma vez por página. No render, cada loadFont segura o frame
 *  (delayRender); no Player, espere esta promessa antes de mostrar a prévia (senão mede e pinta com o fallback). */
export const carregarFontes = (): Promise<void> => {
  if (!fontesDosTemplates) {
    fontesDosTemplates = Promise.all([
      loadFont({ family: INTER, url: staticFile(INTER_600), weight: '600' }),
      loadFont({ family: INTER, url: staticFile(ARQUIVOS['inter-800']), weight: '800' }),
      loadFont({ family: MONTSERRAT, url: staticFile(ARQUIVOS['montserrat-800']), weight: '800' }),
      loadFont({ family: MONTSERRAT, url: staticFile(ARQUIVOS['montserrat-900']), weight: '900' }),
    ]).then(() => undefined);
  }
  return fontesDosTemplates;
};

const promessas = new Map<FontId, Promise<void>>();
/** Carrega uma fonte do catálogo uma vez por página. O texto só é medido depois disto (senão mede com a fonte de fallback). */
export const carregarFonteCatalogo = (id: FontId): Promise<void> => {
  let p = promessas.get(id);
  if (!p) {
    const f = FONT_CATALOG[id];
    p = loadFont({ family: f.family, url: staticFile(ARQUIVOS[id]), weight: String(f.weight) }).then(() => undefined);
    promessas.set(id, p);
  }
  return p;
};

// ───────── CJK (zh/ja/ko): Noto Sans TC/SC/JP/KR por baixo de cada família latina (scripts/fontes-cjk.mjs) ─────────
// Cada pedaço vira um FontFace com o MESMO nome de família/peso da fonte latina e unicode-range só CJK: qualquer
// template que já usa 'MaquinaInter' etc. ganha os glifos CJK sem mudar nada, e o navegador só baixa os pedaços que o
// texto usa. Peso da Noto = PESO_CJK (600 no texto corrido, 900 nos títulos/display), o mesmo que o fitText mede.
// Arquivos em public/fonts/cjk (vão no bundle: render local, Lambda e Player do web, que copia public/fonts inteiro).
const FAMILIAS_CJK: { family: string; weight: number; cjk: 600 | 900 }[] = [
  { family: INTER, weight: 600, cjk: 600 }, { family: INTER, weight: 800, cjk: 900 },
  { family: MONTSERRAT, weight: 800, cjk: 900 }, { family: MONTSERRAT, weight: 900, cjk: 900 },
  ...(['anton-400', 'archivo-black-400', 'bebas-neue-400', 'poppins-800'] as const).map((id) => ({ family: FONT_CATALOG[id].family, weight: FONT_CATALOG[id].weight, cjk: 900 as const })),
  ...(['oswald-700', 'roboto-condensed-700'] as const).map((id) => ({ family: FONT_CATALOG[id].family, weight: FONT_CATALOG[id].weight, cjk: 600 as const })),
];
const registradas = new Set<CjkFont>();
const registrarCJK = (k: CjkFont) => {
  if (registradas.has(k) || typeof document === 'undefined') return;
  registradas.add(k);
  for (const fam of FAMILIAS_CJK) {
    for (const p of CJK_PEDACOS[k]) {
      const face = new FontFace(fam.family, `url(${staticFile(`fonts/cjk/${k}/${p.i}-${fam.cjk}.woff2`)}) format('woff2')`, { weight: String(fam.weight), unicodeRange: p.r });
      (document.fonts as unknown as { add: (f: FontFace) => void }).add(face);
    }
  }
};
/**
 * Registra a Noto do idioma (cjkDe) e baixa já os pedaços que `texto` usa, em todas as famílias/pesos. Chame DEPOIS das
 * fontes latinas (a face registrada por último ganha nos caracteres do seu unicode-range). Texto sem CJK: só registra.
 */
export const carregarFontesCJK = async (language: string, texto: string): Promise<void> => {
  const k = cjkDe(language);
  registrarCJK(k);
  const cjk = [...new Set([...texto].filter((c) => ehCJK(c.codePointAt(0)!)))].join('');
  if (!cjk || typeof document === 'undefined') return;
  await Promise.all(FAMILIAS_CJK.map((f) => document.fonts.load(`${f.weight} 40px "${f.family}"`, cjk)));
};
