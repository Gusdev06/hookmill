import { z } from 'zod';

// Troca de legenda (troca-texto-queimado-v1 §15.6, F2): a placa (legenda antiga apagada) é a base, e a legenda nova entra com as MESMAS
// palavras, palavra a palavra (karaokê), no estilo medido (fonte, corpo, tracking, traço, sombra dura, cor, caixa de destaque).
// Funções puras: a composição (`LegendaSwap.tsx`), os builders da API e os testes usam as mesmas. Sem DOM.
// A legenda tem o catálogo próprio (`LEGENDA_FONTES`), maior que o FontId da headline; as TTFs OFL moram em public/fonts-legenda.

export const LEGENDA_SWAP_COMPOSITION_ID = 'LegendaSwap';

/** Id de texto do `captionTrack.estilo.fontId` → arquivo (relativo a public/) e como pedir o peso. `variavel` = TTF variável (eixo wght). */
export const LEGENDA_FONTES: Record<string, { arquivo: string; peso: number; variavel?: boolean }> = {
  'poppins-700': { arquivo: 'fonts-legenda/Poppins-Bold.ttf', peso: 700 },
  'poppins-800': { arquivo: 'fonts-legenda/Poppins-ExtraBold.ttf', peso: 800 },
  'poppins-900': { arquivo: 'fonts-legenda/Poppins-Black.ttf', peso: 900 },
  'montserrat-800': { arquivo: 'fonts-legenda/Montserrat-ExtraBold.ttf', peso: 800 },
  'montserrat-900': { arquivo: 'fonts-legenda/Montserrat-Variable.ttf', peso: 900, variavel: true },
  'montserrat-700': { arquivo: 'fonts-legenda/Montserrat-Variable.ttf', peso: 700, variavel: true },
  'inter-700': { arquivo: 'fonts-legenda/Inter-Bold.ttf', peso: 700 },
  'tiktok-sans-700': { arquivo: 'fonts-legenda/TikTokSans-Bold.ttf', peso: 700 },
  'gabarito-900': { arquivo: 'fonts-legenda/Gabarito-Variable.ttf', peso: 900, variavel: true },
  'gabarito-700': { arquivo: 'fonts-legenda/Gabarito-Variable.ttf', peso: 700, variavel: true },
  'manrope-800': { arquivo: 'fonts-legenda/Manrope-Variable.ttf', peso: 800, variavel: true },
  'archivo-w100-900': { arquivo: 'fonts-legenda/Archivo-w1000-900.ttf', peso: 900 },
  'archivo-w112-900': { arquivo: 'fonts-legenda/Archivo-w1125-900.ttf', peso: 900 },
  'archivo-w112-700': { arquivo: 'fonts-legenda/Archivo-w1125-700.ttf', peso: 700 },
  'archivo-w125-700': { arquivo: 'fonts-legenda/Archivo-w1250-700.ttf', peso: 700 },
  'archivo-w125-900': { arquivo: 'fonts-legenda/Archivo-w1250-900.ttf', peso: 900 },
};

export const legendaSwapSchema = z.object({
  /** tamanho, fps e nº de quadros do campeão (a composição não reescala: a moldura aplica a transformação depois) */
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), frameCount: z.number().int().positive() }),
  /** a placa (legenda antiga apagada): `champion_plates` READY. Sem áudio: o áudio vem do arquivo original, no mux */
  baseVideoUrl: z.string().min(1),
  trechos: z.array(z.object({ iniFrame: z.number().int().min(0), fimFrame: z.number().int().min(0), texto: z.string(), herdado: z.boolean().optional() })),
  /** palavras com tempo, da transcrição da leitura (a mesma que o `detectar` usou) */
  words: z.array(z.object({ word: z.string(), startSec: z.number().min(0), endSec: z.number().min(0) })),
  atrasoSec: z.number(),
  estilo: z.object({
    fontId: z.string(), tamPx: z.number().positive(), tracking: z.number(), espaco: z.number().positive(), strokePx: z.number().min(0),
    sombra: z.tuple([z.number(), z.number()]), corTexto: z.string(), corDestaque: z.string().nullable(), corTraco: z.string(),
    caixaDestaque: z.object({ cor: z.string(), raioPx: z.number() }).nullable().optional(),
    baseY: z.number(), centroX: z.number(),
  }),
});
export type LegendaSwapProps = z.infer<typeof legendaSwapSchema>;

/** Mesma limpeza do Python (`leg_fontes.limpa`): sem pontuação (menos $ e %), maiúsculas. */
export const limpaPalavra = (w: string) => w.replace(/[^\p{L}\p{N}_$%]/gu, '').toUpperCase();

export interface PalavraDaPagina { texto: string; iniSec: number | null }
export interface PaginaSwap { iniFrame: number; fimFrame: number; palavras: PalavraDaPagina[] }

/**
 * Páginas da legenda nova: 1 por trecho. Cada trecho consome da transcrição as palavras do próprio texto, em ordem (o alinhamento do
 * Python pode pular palavras entre trechos: procura adiante até 6 palavras). Sem casar, cai no tempo: palavras que começam (+atraso) dentro
 * do trecho. §16.2 A7: a página fica na tela até a PRÓXIMA (fim = início da próxima; a última vai até o fim do vídeo).
 */
export function paginasDaLegenda(p: Pick<LegendaSwapProps, 'trechos' | 'words' | 'atrasoSec' | 'canvas'>): PaginaSwap[] {
  const ws = p.words.map((w) => ({ ...w, k: limpaPalavra(w.word) })).filter((w) => w.k);
  const ts = [...p.trechos].filter((t) => t.texto.trim()).sort((a, b) => a.iniFrame - b.iniFrame);
  const out: PaginaSwap[] = [];
  let ptr = 0;
  for (const t of ts) {
    const toks = t.texto.split(/\s+/).map(limpaPalavra).filter(Boolean);
    let achou = -1;
    for (let d = 0; d <= 6 && achou < 0; d++) {
      const i = ptr + d;
      if (i + toks.length <= ws.length && toks.every((k, j) => ws[i + j].k === k)) achou = i;
    }
    let palavras: PalavraDaPagina[];
    if (achou >= 0) {
      palavras = toks.map((k, j) => ({ texto: k, iniSec: ws[achou + j].startSec + p.atrasoSec }));
      ptr = achou + toks.length;
    } else {
      const a = t.iniFrame / p.canvas.fps, b = t.fimFrame / p.canvas.fps;
      const dentro = ws.filter((w) => w.startSec + p.atrasoSec >= a - 0.05 && w.startSec + p.atrasoSec < b);
      palavras = (dentro.length ? dentro.map((w) => ({ texto: w.k, iniSec: w.startSec + p.atrasoSec })) : toks.map((k) => ({ texto: k, iniSec: null })));
    }
    out.push({ iniFrame: t.iniFrame, fimFrame: t.fimFrame, palavras });
  }
  return out.map((pg, i) => ({ ...pg, fimFrame: i + 1 < out.length ? out[i + 1].iniFrame : p.canvas.frameCount }));
}

/** Índice da palavra da vez (karaokê) no segundo `t`; -1 antes da 1ª. Palavra sem tempo (`null`) nunca acende. */
export const palavraDaVez = (pg: PaginaSwap, t: number): number => {
  let ativa = -1;
  pg.palavras.forEach((w, i) => { if (w.iniSec !== null && t >= w.iniSec) ativa = i; });
  return ativa;
};

/** Larguras → x de cada palavra (centradas em `cx`), como o `layout()` do Python: avanço por caractere + tracking·corpo, espaço = esp·espaço da fonte. */
export function posicoesDasPalavras(larguras: number[], espacoPx: number, cx: number): { x: number[]; total: number } {
  const total = larguras.reduce((s, w) => s + w, 0) + Math.max(0, larguras.length - 1) * espacoPx;
  const x: number[] = [];
  let at = cx - total / 2;
  for (const w of larguras) { x.push(at); at += w + espacoPx; }
  return { x, total };
}

/** O que `legendaDoCaptionTrack` precisa do `captionTrack` (sem pixel). */
export interface CaptionTrackLike {
  trechos: Array<{ iniFrame: number; fimFrame: number; texto: string; herdado?: boolean; box?: { x: number; y: number; w: number; h: number } }>;
  atrasoSec: number;
  fps: number;
  quadros: number;
  /** modo livre (12/11): `veredito.estilo === 'padrao'` = o estilo do original não foi copiado; a legenda nova usa o estilo padrão do HookMill */
  veredito?: { estilo?: 'copiado' | 'padrao' | null };
  estilo: {
    tamPx: number; strokePx: number; corTexto: string; corDestaque: string | null; corTraco: string; sombra: [number, number];
    caixaDestaque?: { cor: string; raioPx: number } | null; palavrasPorPagina: number;
  };
}

/**
 * Páginas da legenda original por TEMPO (F2, 12/11): o detector alinha palavras a trechos por LARGURA (programação dinâmica), o que erra quando as páginas têm
 * larguras parecidas (no 26 a peça mostrava "OKAY" onde a original mostra "IN THE MORNING"). Aqui: as páginas são TODOS os trechos (inclusive os curtos de 1 palavra,
 * que o ajuste de fonte descarta), o atraso da legenda é reestimado (o deslocamento, de −1 a +1 s, que mais casa o início de cada página com o início de uma palavra
 * da transcrição; empate = o mais perto do `atrasoHint`) e cada palavra vai para a página em cujo intervalo ela cai. Pura.
 */
export function paginasPorTempo(
  trechos: Array<{ iniFrame: number; fimFrame: number; box?: { x: number; w: number } }>, words: Array<{ word: string; startSec: number; endSec: number }>, fps: number, quadros: number, atrasoHint = 0,
): { paginas: Array<{ iniFrame: number; fimFrame: number; palavras: Array<{ texto: string; iniSec: number }> }>; atrasoSec: number } {
  const ws = words.map((w) => ({ k: limpaPalavra(w.word), s: w.startSec, e: w.endSec })).filter((w) => w.k);
  const passos = [...trechos].sort((a, b) => a.iniFrame - b.iniFrame);
  // karaokê: o detector parte a página a cada palavra que acende/entra (a máscara muda); passos seguidos são a mesma página enquanto o texto só CRESCE
  const ini: Array<{ iniFrame: number; fimFrame: number }> = [];
  let ant: (typeof passos)[number] | null = null;
  for (const t of passos) {
    // mesma página = o texto cresce (palavra acende/entra) em torno do mesmo centro: centro estável (±40 px), largura não encolhe (±4), sem buraco
    const mesma = ant && ant.box && t.box && Math.abs(ant.box.x + ant.box.w / 2 - (t.box.x + t.box.w / 2)) <= 40 && t.box.w >= ant.box.w - 4 && t.iniFrame - ant.fimFrame <= 2;
    if (mesma) ini[ini.length - 1].fimFrame = t.fimFrame; else ini.push({ iniFrame: t.iniFrame, fimFrame: t.fimFrame });
    ant = t;
  }
  const casa = (d: number) => {
    let n = 0;
    for (const t of ini) { const a = t.iniFrame / fps; if (ws.some((w) => Math.abs(w.s + d - a) <= 0.12)) n++; }
    return n;
  };
  let melhor = atrasoHint, nMelhor = casa(atrasoHint);
  for (let d = -1; d <= 1.0001; d += 0.05) {
    const n = casa(d);
    if (n > nMelhor || (n === nMelhor && Math.abs(d - atrasoHint) < Math.abs(melhor - atrasoHint))) { melhor = d; nMelhor = n; }
  }
  const paginas = ini.map((t, i) => ({ iniFrame: t.iniFrame, fimFrame: i + 1 < ini.length ? ini[i + 1].iniFrame : quadros, palavras: [] as Array<{ texto: string; iniSec: number }> }));
  for (const w of ws) {
    const t = w.s + melhor + 0.12;   // folga igual à tolerância do casamento: a palavra que abre a página não cai fora dela por décimos
    const k = paginas.findIndex((p) => t >= p.iniFrame / fps && t < p.fimFrame / fps);
    if (k >= 0) paginas[k].palavras.push({ texto: w.k, iniSec: Math.max(0, w.s + melhor) });
  }
  return { paginas: paginas.filter((p) => p.palavras.length), atrasoSec: Math.round(melhor * 1000) / 1000 };
}

/**
 * Legenda da moldura no estilo MEDIDO da original (F2, 12/11): as palavras e as PÁGINAS são as do detector (`trechos[].texto`: sem pontuação, como a original
 * mostra; a transcrição traz pontuação e não vale), com o tempo de cada palavra pela transcrição; cor do texto, traço, caixa da palavra da vez e tamanho
 * são os medidos. A fonte fica nula (as da legenda não estão no catálogo da moldura): Montserrat 800 em caixa alta. Pura.
 */
/** Estilo padrão do HookMill (modo livre): branco, contorno escuro, destaque no karaokê, caixa alta, 2-3 palavras por página, sem pontuação. */
export const ESTILO_PADRAO = { texto: '#ffffff', destaque: '#ffd400', traco: '#000000', tracoRel: 0.07, sizeRel: 0.042 } as const;
export function legendaDoCaptionTrack(t: CaptionTrackLike, words: Array<{ word: string; startSec: number; endSec: number }>, language: string, sourceHeight: number) {
  // atraso da legenda reestimado (o do detector sai do alinhamento por largura e erra); as PALAVRAS são as da transcrição sem pontuação, no tempo da legenda.
  // As páginas ficam a cargo do `paginar` da moldura (frases curtas, até `wordsPerPage`): o detector parte a página a cada palavra que acende no karaokê e não
  // dá os limites reais das páginas da original (medido no 26: "IN THE MORNING" saía "THE MORNING"); por isso `pg` não é usado aqui.
  const { atrasoSec } = paginasPorTempo(t.trechos, words, t.fps, t.quadros, t.atrasoSec);
  const toks = words.map((w) => ({ k: limpaPalavra(w.word), s: w.startSec, e: w.endSec })).filter((w) => w.k);
  const ws = toks.map((w, i) => ({ word: w.k, startSec: Math.max(0, w.s + atrasoSec), endSec: Math.max(0, (toks[i + 1] ? Math.min(w.e, toks[i + 1].s) : w.e) + atrasoSec) }));
  const e = t.estilo;
  if (t.veredito?.estilo === 'padrao') {
    return {
      words: ws, highlightColor: ESTILO_PADRAO.destaque, language,
      style: {
        fontId: null as string | null, uppercase: true, color: ESTILO_PADRAO.texto, highlightColor: ESTILO_PADRAO.destaque, strokeColor: ESTILO_PADRAO.traco,
        strokeWidthRel: ESTILO_PADRAO.tracoRel, sizeRel: ESTILO_PADRAO.sizeRel, shadow: false, wordsPerPage: 3, highlightBox: null,
      },
    };
  }
  return {
    words: ws, highlightColor: e.corDestaque ?? e.corTexto, language,
    style: {
      fontId: null as string | null, uppercase: true, color: e.corTexto, highlightColor: e.corDestaque, strokeColor: e.caixaDestaque || e.strokePx <= 0 ? null : e.corTraco,
      // com caixa de destaque o "contorno" medido é a borda da própria caixa: sem traço (senão o preto cobre o roxo) e sem sombra
      strokeWidthRel: e.tamPx > 0 && !e.caixaDestaque ? Math.round((e.strokePx / e.tamPx) * 1000) / 1000 : 0, sizeRel: Math.max(0.005, e.tamPx / sourceHeight), shadow: !e.caixaDestaque && (e.sombra[0] !== 0 || e.sombra[1] !== 0),
      wordsPerPage: e.palavrasPorPagina <= 1 ? 1 : 3,
      highlightBox: e.caixaDestaque ? { color: e.caixaDestaque.cor, radiusRel: e.tamPx > 0 ? Math.round((e.caixaDestaque.raioPx / e.tamPx) * 1000) / 1000 : 0.1 } : null,
    },
  };
}
