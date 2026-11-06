import { z } from 'zod';
import { outputProtectedBandSchema } from './captionsSchema';
import { frameReframeSchema } from './reframeSchema';

// Template `remix-keep` (§13.6 da feature 2): o vídeo do campeão de fundo, o clipe novo colado nas regiões do rosto
// nos frames exatos e as camadas de texto redesenhadas por cima. Tudo na grade do campeão (mesma largura, altura, fps e
// nº de frames; nada reescalado pra 1080). Props = RemixKeepRenderInput sem renderId/kind/templateId/audioPassthroughUrl
// (o áudio é remuxado depois, com -c:a copy, pelo RenderService).

/** Catálogo fechado de fontes (ids estáveis, = FontId do @maquina/contratos). Arquivos empacotados no bundle (src/fontes.ts). */
export const FONT_CATALOG = {
  'montserrat-800': { family: 'MaquinaMontserrat', weight: 800, label: 'Montserrat ExtraBold' },
  'montserrat-900': { family: 'MaquinaMontserrat', weight: 900, label: 'Montserrat Black' },
  'inter-800': { family: 'MaquinaInter', weight: 800, label: 'Inter ExtraBold' },
  'anton-400': { family: 'MaquinaAnton', weight: 400, label: 'Anton' },
  'oswald-700': { family: 'MaquinaOswald', weight: 700, label: 'Oswald Bold' },
  'bebas-neue-400': { family: 'MaquinaBebasNeue', weight: 400, label: 'Bebas Neue' },
  'archivo-black-400': { family: 'MaquinaArchivoBlack', weight: 400, label: 'Archivo Black' },
  'poppins-800': { family: 'MaquinaPoppins', weight: 800, label: 'Poppins ExtraBold' },
  'roboto-condensed-700': { family: 'MaquinaRobotoCondensed', weight: 700, label: 'Roboto Condensed Bold' },
  // Cópia de headline (troca-texto §14.1.2, §15.7.3, V1 do F1b, 06/11): pesos médios para texto corrido. Todas OFL-1.1,
  // licença e origem em public/fonts/licenses/. Aprovadas na S4: 02 Montserrat 600, 05 Albert Sans 500, 06 Montserrat 500,
  // solto Arimo 600 (Gusta, §16.11).
  'montserrat-500': { family: 'MaquinaMontserrat', weight: 500, label: 'Montserrat Medium' },
  'montserrat-600': { family: 'MaquinaMontserrat', weight: 600, label: 'Montserrat SemiBold' },
  'montserrat-700': { family: 'MaquinaMontserrat', weight: 700, label: 'Montserrat Bold' },
  'inter-400': { family: 'MaquinaInter', weight: 400, label: 'Inter Regular' },
  'inter-500': { family: 'MaquinaInter', weight: 500, label: 'Inter Medium' },
  'inter-600': { family: 'MaquinaInter', weight: 600, label: 'Inter SemiBold' },
  'inter-700': { family: 'MaquinaInter', weight: 700, label: 'Inter Bold' },
  'poppins-500': { family: 'MaquinaPoppins', weight: 500, label: 'Poppins Medium' },
  'poppins-600': { family: 'MaquinaPoppins', weight: 600, label: 'Poppins SemiBold' },
  'arimo-400': { family: 'MaquinaArimo', weight: 400, label: 'Arimo Regular' },
  'arimo-500': { family: 'MaquinaArimo', weight: 500, label: 'Arimo Medium' },
  'arimo-600': { family: 'MaquinaArimo', weight: 600, label: 'Arimo SemiBold' },
  'arimo-700': { family: 'MaquinaArimo', weight: 700, label: 'Arimo Bold' },
  'tiktok-sans-400': { family: 'MaquinaTikTokSans', weight: 400, label: 'TikTok Sans Regular' },
  'tiktok-sans-500': { family: 'MaquinaTikTokSans', weight: 500, label: 'TikTok Sans Medium' },
  'tiktok-sans-600': { family: 'MaquinaTikTokSans', weight: 600, label: 'TikTok Sans SemiBold' },
  'tiktok-sans-700': { family: 'MaquinaTikTokSans', weight: 700, label: 'TikTok Sans Bold' },
  'albert-sans-500': { family: 'MaquinaAlbertSans', weight: 500, label: 'Albert Sans Medium' },
} as const;
export type FontId = keyof typeof FONT_CATALOG;
export const FONT_IDS = Object.keys(FONT_CATALOG) as [FontId, ...FontId[]];

export const REMIX_COMPOSITION_ID = 'RemixKeep';

export const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });

export const textStyleSchema = z.object({
  fontId: z.enum(FONT_IDS),
  uppercase: z.boolean(),
  fontSizePx: z.number().positive(),
  lineHeight: z.number().positive(),
  color: z.string(),
  highlightColor: z.string().nullable(),
  /** caixa atrás da palavra atual do karaokê (opcional; §13.15, legenda redesenhada com a voz do motor) */
  highlightBackground: z.string().nullable().optional(),
  strokeColor: z.string().nullable(),
  strokeWidthPx: z.number().min(0),
  shadow: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  // ── cópia da headline (troca-texto §14.5, §16.6 V3), todos opcionais: props antigas continuam válidas ──
  /** espaçamento entre letras, em em (CSS letter-spacing) */
  letterSpacingEm: z.number().optional(),
  /** sombra medida (vale sobre o booleano `shadow`): CSS text-shadow; `blurPx` = raio de desfoque do CSS (2 × sigma) */
  shadowDetail: z.object({ dx: z.number(), dy: z.number(), blurPx: z.number().min(0), color: z.string() }).nullable().optional(),
  /** destaque do trecho entre `*`: sublinhado medido (offset = topo da barra − linha de base), cor ou caixa */
  emphasis: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('underline'), thicknessPx: z.number().positive(), offsetPx: z.number(), color: z.string() }),
    z.object({ kind: z.literal('color'), color: z.string() }),
    z.object({ kind: z.literal('box'), color: z.string() }),
  ]).nullable().optional(),
});

const frameRange = { startFrame: z.number().int().min(0), endFrame: z.number().int().positive() };

export const overlaySchema = z.object({
  ...frameRange,
  region: rectSchema,
  /** URL http(s) assinada; em dev, caminho relativo a public/ */
  clipUrl: z.string().min(1),
  /** instante do clipe que cai no startFrame */
  clipOffsetSec: z.number().min(0),
  /** px do clipe (fitCrop), escalado pra region (mesmo aspecto) */
  crop: rectSchema,
});

export const textLayerSchema = z.object({
  id: z.string(),
  ...frameRange,
  box: rectSchema,
  /** solid/pill: pinta `box` (ou a caixa da camada) antes do texto. `color` = hex ou linear-gradient(...) medido. */
  background: z.object({
    kind: z.enum(['solid', 'pill', 'none']), color: z.string().nullable(), box: rectSchema.nullable(),
    /** raio dos cantos do `solid` em px (placa sobre o vídeo da headline nova: 0,15 em); ausente = 0 */
    radius: z.number().min(0).optional(),
    /** imagem 2D medida da caixa original (data URI PNG ≤ 4 KB, §14.2), esticada em `box` (100 % × 100 %). Com ela, `color`
     *  é só reserva e a máscara do compositor é exatamente `box`, sem folga (A8) */
    image: z.string().optional(),
  }),
  style: textStyleSchema,
  content: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('static'), text: z.string(),
      /** cópia da headline: linhas prontas (de `ajustarHeadlineCopia`; `*trecho*` pode cruzar linhas) postas por linha de
       *  base, sem reajuste no render. Ausente = `text` quebrado por `ajustarTexto` dentro de `box` (o de antes) */
      lines: z.array(z.string()).min(1).optional(),
      /** posição das `lines`, px da grade: 1ª linha de base, entrelinha e âncora x (centro, borda esquerda ou direita, pelo `align`) */
      layout: z.object({ firstBaselineY: z.number(), linePitchPx: z.number().positive(), anchorX: z.number() }).optional(),
      /** emoji recortado do próprio quadro (§15.7.2, A1), no tamanho original. `topFromBaseline` = topo da imagem − linha de
       *  base da linha dele; `marginLeftPx` = coluna transparente à esquerda do recorte (a tinta começa depois dela) */
      emoji: z.object({
        image: z.string().min(1), w: z.number().positive(), h: z.number().positive(), inkWidthPx: z.number().positive(),
        topFromBaseline: z.number(), gapPx: z.number().min(0), marginLeftPx: z.number().min(0),
        lineIndex: z.number().int().min(0), side: z.enum(['start', 'end']),
      }).optional(),
    }),
    z.object({
      kind: z.literal('karaoke'),
      words: z.array(z.object({ word: z.string(), ...frameRange })),
      wordsPerPage: z.number().int().positive(),
    }),
  ]),
});

export const remixKeepSchema = z.object({
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), frameCount: z.number().int().positive() }),
  baseVideoUrl: z.string().min(1),
  overlays: z.array(overlaySchema),
  textLayers: z.array(textLayerSchema),
  /** idioma dos textos (headline nova / legenda): escolhe a Noto CJK (TC/SC/JP/KR) e o "sem espaço" do zh/ja */
  language: z.string().optional(),
  /** faixa da legenda queimada no vídeo renderizado (checagem por visão); a composição ignora */
  outputProtectedBands: z.array(outputProtectedBandSchema).optional(),
  /** editor universal F-U2: rosto principal (px da grade), pro auto reframe numa caixa nova. A composição ignora. */
  faceHint: rectSchema.optional(),
  /** editor universal F-U2 (resolverPropsHeadline): vídeo aparado (`inFrame` = quadro do arquivo que vira o quadro 0; camadas e
   *  `canvas.frameCount` já vêm deslocados) e/ou na caixa com outro enquadramento (`pintura`). Ausente = o render de hoje. */
  edicao: z.object({
    video: z.object({
      inFrame: z.number().int().min(0),
      pintura: z.object({ box: rectSchema, reframe: frameReframeSchema, contentBox: rectSchema.nullable() }).nullable(),
    }),
  }).optional(),
});

export type RemixKeepProps = z.infer<typeof remixKeepSchema>;
export type RemixOverlay = z.infer<typeof overlaySchema>;
export type RemixTextLayer = z.infer<typeof textLayerSchema>;
export type RemixTextStyle = z.infer<typeof textStyleSchema>;

/** Valida e confere as faixas de frame (end > start, dentro do quadro). */
export const propsDeRemixInput = (input: RemixKeepProps): RemixKeepProps => {
  const p = remixKeepSchema.parse({ canvas: input.canvas, baseVideoUrl: input.baseVideoUrl, overlays: input.overlays, textLayers: input.textLayers, ...(input.language && { language: input.language }), ...(input.edicao && { edicao: input.edicao }) });
  const n = p.canvas.frameCount;
  for (const [i, o] of p.overlays.entries()) {
    if (!(o.endFrame > o.startFrame) || o.endFrame > n) throw new Error(`overlay ${i}: frames ${o.startFrame}-${o.endFrame} fora de 0-${n}`);
    const a = o.region.w / o.region.h, b = o.crop.w / o.crop.h;
    if (Math.abs(a - b) / a > 0.02) throw new Error(`overlay ${i}: aspecto do crop (${b.toFixed(3)}) != da região (${a.toFixed(3)})`);
  }
  for (const l of p.textLayers) {
    if (!(l.endFrame > l.startFrame) || l.endFrame > n) throw new Error(`camada ${l.id}: frames ${l.startFrame}-${l.endFrame} fora de 0-${n}`);
    if (l.content.kind === 'static' && (l.content.lines || l.content.emoji) && !(l.content.lines && l.content.layout)) throw new Error(`camada ${l.id}: lines/emoji pedem lines e layout`);
    if (l.content.kind === 'static' && l.content.emoji && l.content.emoji.lineIndex >= l.content.lines!.length) throw new Error(`camada ${l.id}: emoji na linha ${l.content.emoji.lineIndex} de ${l.content.lines!.length}`);
  }
  return p;
};

/** Páginas do karaokê: blocos de `wordsPerPage` palavras; cada página fica até a próxima começar (ou até a última palavra acabar). */
export const paginasKaraoke = (words: { word: string; startFrame: number; endFrame: number }[], porPagina: number) => {
  const pags: { startFrame: number; endFrame: number; words: typeof words }[] = [];
  for (let i = 0; i < words.length; i += porPagina) {
    const ws = words.slice(i, i + porPagina);
    pags.push({ startFrame: ws[0].startFrame, endFrame: ws[ws.length - 1].endFrame, words: ws });
  }
  return pags.map((p, i) => ({ ...p, endFrame: pags[i + 1] ? pags[i + 1].startFrame : p.endFrame }));
};

// ── fichas de texto (headline/karaokê) com CJK: ideograma e kana viram fichas sem espaço entre si (quebra por caractere);
// latino e hangul seguem por palavra. Pontuação de fechamento gruda na ficha anterior, abertura na seguinte (kinsoku).
export interface TokenTexto { t: string; espaco: boolean; destaque: boolean }
const ehIdeograma = (cp: number) => (cp >= 0x2e80 && cp <= 0x9fff && !(cp >= 0x3130 && cp <= 0x318f)) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff);
const FECHA = new Set([...'，。、．・：；！？）」』】》〉〕｝’”…ー々ぁぃぅぇぉっゃゅょァィゥェォッャュョ%％,.!?:;)]}']);
const ABRE = new Set([...'（「『【《〈〔｛‘“([{']);
/** Texto → fichas. `*trecho*` marca destaque (o * some). */
export const tokensDoTexto = (texto: string): TokenTexto[] => {
  const out: TokenTexto[] = [];
  let destaque = false, espacoPendente = false, palavra: TokenTexto | null = null;
  const fecha = () => { if (palavra) { out.push(palavra); palavra = null; } };
  for (const ch of texto) {
    if (ch === '*') { fecha(); destaque = !destaque; continue; }
    if (/\s/.test(ch)) { fecha(); espacoPendente = out.length > 0; continue; }
    const cp = ch.codePointAt(0)!;
    const ant = out[out.length - 1];
    if (ehIdeograma(cp)) {
      fecha();
      if (ant && !espacoPendente && FECHA.has(ch)) { ant.t += ch; continue; }
      out.push({ t: ch, espaco: espacoPendente, destaque });
      espacoPendente = false;
      continue;
    }
    if (palavra && palavra.destaque === destaque) palavra.t += ch;
    else { fecha(); palavra = { t: ch, espaco: espacoPendente, destaque }; espacoPendente = false; }
  }
  fecha();
  // abertura gruda na ficha seguinte
  for (let i = out.length - 2; i >= 0; i--) if (ABRE.has(out[i].t.slice(-1)) && !out[i + 1].espaco && out[i].t.length === 1) { out[i + 1] = { ...out[i + 1], t: out[i].t + out[i + 1].t, espaco: out[i].espaco }; out.splice(i, 1); }
  return out;
};
/** Palavras do karaokê → fichas: sem espaço entre duas palavras CJK (zh/ja do Whisper), com espaço no resto. */
/** Linhas com `*trecho*` (o destaque pode cruzar linhas) → pedaços por linha, sem os `*`. */
export const pedacosDasLinhas = (linhas: string[]): { t: string; destaque: boolean }[][] => {
  let destaque = false;
  return linhas.map((l) => {
    const out: { t: string; destaque: boolean }[] = [];
    for (const parte of l.split('*').map((t, i) => ({ t, troca: i > 0 }))) {
      if (parte.troca) destaque = !destaque;
      if (parte.t) out.push({ t: parte.t, destaque });
    }
    return out;
  });
};
export const tokensDoKaraoke = (palavras: string[]): TokenTexto[] => palavras.map((t, i) => {
  const ini = t.codePointAt(0) ?? 0;
  const ant = i > 0 ? palavras[i - 1] : '';
  const fimAnt = ant ? ant.codePointAt(ant.length - 1) ?? 0 : 0;
  return { t, espaco: i > 0 && !(ehIdeograma(ini) && ehIdeograma(fimAnt)) && !/^['’,.!?;:，。！？、]/.test(t), destaque: false };
});
