import { FPS } from './formatos';
import { paginar } from './legenda';
import { cjkDe, faixasNaSaida, fitText, pinturaNaCaixa, temCJK, type FittedText, type FrameLayout, type MolduraProps, type Rect } from './molduras';
import { FORMATOS, type VideoFormat } from './formatos';

// Legenda automática (headline-e-legenda-v1 §2): quando o campeão não tem legenda queimada (`captionsAuto`), toda peça
// de vídeo do lote ganha legenda palavra a palavra no estilo único do lote (H5): Montserrat 800, branco com contorno
// preto, palavra da vez na cor da marca. Funções puras: a composição e os builders da API usam as mesmas.

export { captionsAutoSchema, type CaptionsAuto } from './captionsSchema';
export type PalavraPeca = { word: string; startSec: number; endSec: number };

/** zh e ja escrevem sem espaço: as palavras do Whisper se juntam sem espaço e a página conta caracteres (≤ 8). ko tem espaço. */
export const semEspaco = (language: string) => /^(zh|ja)/i.test(language);

/** Palavras do campeão no tempo da PEÇA: só as que começam dentro de um trecho do timeline (o CUT corta as de fora). */
export const palavrasNaPeca = (words: PalavraPeca[], timeline: { startSec: number; endSec: number }[], fps: number = FPS): PalavraPeca[] => {
  const out: PalavraPeca[] = [];
  let at = 0;
  for (const t of timeline) {
    const a = Math.round(t.startSec * fps) / fps, b = Math.round(t.endSec * fps) / fps;
    for (const w of words) {
      if (w.startSec >= a - 1e-6 && w.startSec < b) out.push({ word: w.word.trim(), startSec: at + (w.startSec - a), endSec: at + (Math.min(w.endSec, b) - a) });
    }
    at += b - a;
  }
  return out.filter((w) => w.word);
};

export interface PaginaAuto { startSec: number; endSec: number; palavras: PalavraPeca[] }
/** Páginas: latino/ko = 2-4 palavras (quebra em fim de frase e pausa); zh/ja = até 8 caracteres, sem espaço. */
export const paginasLegendaAuto = (words: PalavraPeca[], language: string, ateSec: number, maxPalavras = 4): PaginaAuto[] => {
  if (!semEspaco(language)) return paginar(words, { maxPalavras, maxChars: 24, ateSec });
  // CJK: cada "palavra" do Whisper pode ter 1+ caracteres; conta caracteres, sem o +1 do espaço
  const paginas: PaginaAuto[] = [];
  let atual: PalavraPeca[] = [];
  let chars = 0;
  const fecha = () => { if (atual.length) paginas.push({ startSec: atual[0].startSec, endSec: atual[atual.length - 1].endSec, palavras: atual }); atual = []; chars = 0; };
  for (const w of words) {
    const n = [...w.word].length;
    const ant = atual[atual.length - 1];
    if (ant && (chars + n > 8 || w.startSec - ant.endSec > 0.45)) fecha();
    atual.push(w);
    chars += n;
    if (/[。！？!?…]$/.test(w.word)) fecha();
  }
  fecha();
  return paginas.map((p, i) => {
    const prox = paginas[i + 1];
    const fim = Math.min(prox ? prox.startSec : ateSec, p.endSec + 0.5);
    return { ...p, endSec: prox && prox.startSec - p.endSec < 0.5 ? prox.startSec : Math.max(fim, p.endSec) };
  });
};

const cjkCp = (cp: number | undefined) => cp !== undefined && ((cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff));
/** Espaço antes da palavra `w` (depois de `ant`): nunca entre dois CJK (zh/ja), nem antes de 'm/'s (o Whisper parte
 *  "I'm") e pontuação; entre CJK e latino, espaço (como "說過 I'm not"). */
export const espacoAntes = (ant: string | null, w: string) => {
  if (!ant) return false;
  if (/^['’]/.test(w) || /^[,.!?;:，。！？、]/.test(w)) return false;
  return !(cjkCp(ant.codePointAt(ant.length - 1)) && cjkCp(w.codePointAt(0)));
};
/** Texto da página como aparece. */
export const textoDaPagina = (p: PaginaAuto, _language: string) => p.palavras.reduce((t, w, i) => t + (espacoAntes(i ? p.palavras[i - 1].word : null, w.word) ? ' ' : '') + w.word, '');

/** Tamanho da legenda por formato (px da saída de 1080) e o mínimo do contrato. */
export const LEGENDA_PX = { VERTICAL_9_16: 64, PORTRAIT_4_5: 56, SQUARE_1_1: 52 } as const;
export const LEGENDA_MIN_PX = 36;
export const LEGENDA_LH = 1.15;

export interface CaixaLegenda { box: Rect; maxLinhas: 1 | 2; tamanho: number; maxPalavras: number }

const cruza = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Onde a legenda cabe dentro de `area` (a videoBox da moldura, ou a tela no AutoEdit): no terço de baixo, sem cruzar
 * nenhum `obstaculo` (slots de texto da moldura, faixas de texto queimado, UI do formato). Tenta 2 linhas no tamanho do
 * formato, subindo dentro da metade de baixo; depois 1 linha (2 palavras por página) no mínimo de 36 px. Nada = null
 * (sem legenda naquela peça, registrado; não falha).
 */
export const caixaDaLegenda = (area: Rect, limiteBaixo: number, obstaculos: Rect[], tamanho: number): CaixaLegenda | null => {
  const margemX = Math.max(40, area.w * 0.06);
  const w = area.w - 2 * margemX;
  const fundo = Math.min(area.y + area.h - area.h * 0.04, limiteBaixo);
  const topoMin = area.y + area.h * 0.5;
  const tentativas: { linhas: 1 | 2; t: number; maxPalavras: number }[] = [
    { linhas: 2, t: tamanho, maxPalavras: 4 }, { linhas: 2, t: LEGENDA_MIN_PX, maxPalavras: 4 }, { linhas: 1, t: LEGENDA_MIN_PX, maxPalavras: 2 },
  ];
  for (const tt of tentativas) {
    const h = Math.ceil(tt.linhas * tt.t * LEGENDA_LH);
    for (let y = fundo - h; y >= topoMin; y -= 8) {
      const box = { x: area.x + margemX, y: Math.round(y), w: Math.round(w), h };
      if (!obstaculos.some((o) => cruza(box, { x: o.x - 4, y: o.y - 8, w: o.w + 8, h: o.h + 16 }))) return { box, maxLinhas: tt.linhas, tamanho: tt.t, maxPalavras: tt.maxPalavras };
    }
  }
  return null;
};

/** Ajuste do texto de uma página na caixa (mesma medida do fitText das molduras; CJK quebra por caractere). */
export const ajusteDaPagina = (texto: string, c: CaixaLegenda, language: string): FittedText =>
  fitText(texto, { font: 'montserrat-800', width: c.box.w, maxLines: c.maxLinhas, max: c.tamanho, min: Math.min(c.tamanho, LEGENDA_MIN_PX), lineHeight: LEGENDA_LH, cjk: cjkDe(language) });

export { temCJK };

/** Caixa da legenda na Moldura (§2.2): dentro da videoBox (o vídeo com o áudio), no terço de baixo, fora de todo slot de
 *  texto da moldura, do rosto redondo e das faixas de texto queimado; acima da área segura. */
export const caixaLegendaMoldura = (p: Pick<MolduraProps, 'format' | 'video' | 'safeArea' | 'captions'>, L: FrameLayout): CaixaLegenda | null => {
  const H = FORMATOS[p.format].height;
  const faixas = faixasNaSaida(p.video.burnedTextBands, p.video.source, p.video.reframe, L.videoBox, p.video.contentBox ?? null)
    .map((f) => ({ x: L.videoBox.x, y: f.y0, w: L.videoBox.w, h: f.y1 - f.y0 }));
  const obst = [...Object.values(L.slots), ...(L.faceBox ? [L.faceBox] : []), ...faixas];
  let tamanho = Math.max(LEGENDA_MIN_PX, Math.min(LEGENDA_PX[p.format], Math.round(L.videoBox.w / 15)));
  // legenda refeita no estilo da original: o tamanho relativo dela, levado pra escala do vídeo na caixa
  const st = (p as { captions?: { style?: { sizeRel: number } } }).captions?.style;
  if (st) {
    const pt = pinturaNaCaixa(L.videoBox, p.video.source, p.video.reframe, p.video.contentBox ?? null);
    tamanho = Math.max(LEGENDA_MIN_PX, Math.min(Math.round(LEGENDA_PX[p.format] * 1.3), Math.round(st.sizeRel * p.video.source.height * pt.s)));
  }
  return caixaDaLegenda(L.videoBox, H - L.safe.bottom, obst, tamanho);
};

/** Caixa da legenda no AutoEdit (§2.2): terço de baixo da área do vídeo, acima da UI do formato (safeArea). REVIEW: o
 *  vídeo é a parte de baixo; o resto é a tela toda. */
export const caixaLegendaAutoEdit = (format: VideoFormat, safeArea: { top: number; bottom: number }, area?: Rect, tamanho?: number): CaixaLegenda | null => {
  const { width: W, height: H } = FORMATOS[format];
  const t = tamanho ? Math.max(LEGENDA_MIN_PX, Math.min(Math.round(LEGENDA_PX[format] * 1.3), tamanho)) : LEGENDA_PX[format];
  return caixaDaLegenda(area ?? { x: 0, y: 0, w: W, h: H }, H - safeArea.bottom, [], t);
};
