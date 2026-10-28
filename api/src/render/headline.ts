/**
 * headline-e-legenda-v1 §1.3: buildHeadlineInput(spec, ctx) → RemixKeepRenderInput. Função PURA do maquina-video (como o
 * buildFrameInput): a headline nova por cima do campeão no render `remix-keep` (mesmo corte, mesmo áudio, mesmo quadro;
 * a API compõe sobre o campeão decodificado com máscara na caixa nova).
 * - `replace`, faixa sólida/pílula (inclusive degradê medido): a faixa é repintada inteira com a cor medida e o texto novo
 *   vai na caixa da original, no estilo dela.
 * - `replace`, texto sobre o vídeo: placa sólida (cor mediana do fundo medida = `spec.plateColor`; contraste < 3 com o
 *   texto → preto ou branco, H1) OPACA (F11, 28/10) cobrindo a caixa antiga + margem, cantos 0,15 em.
 * - `add` (campeão sem headline): faixa na cor da marca no topo da área segura, Montserrat 800 caixa alta centralizada;
 *   cobrindo o rosto em > 10 % dos frames desce pra logo abaixo dele; ainda colidindo = `HEADLINE_NO_ROOM`.
 * Texto: mesma caixa e mesmo nº de linhas da original (até +1), tamanho entre 80 % e 100 % do original; não coube =
 * `HEADLINE_TOO_LONG`. Mesma fonte, cor, destaque (*trecho* = `highlight`), peso, contorno, sombra e alinhamento.
 * Legenda automática (`captionsAuto`, §2.2): camada karaokê embaixo, nunca na faixa nova.
 */
import type { EditLayer, EditMap, Rect } from '@maquina/contratos';
import { SAFE_AREA, contraste, faixasProtegidasDe, faixasProtegidasNaSaidaRemix, medirTexto, rostoPrincipal, semEspaco, tokensDoTexto, type CaptionsAuto, type FrameFontKey } from '@maquina/video';
import type { HeadlineSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import type { RemixKeepRenderInput } from './contrato';
import { CaptionProtectedError, type OpcoesDeBuild } from './frame';

/** Oficial em `integracoes/contrato.ts` (headline-e-legenda-v1 §1.2, fechado 25/10). */
export type { HeadlineSpec };

export class HeadlineError extends Error {
  constructor(public readonly code: 'HEADLINE_TOO_LONG' | 'HEADLINE_NO_ROOM' | 'HEADLINE_OVER_FACE' | 'HEADLINE_LOW_CONFIDENCE', msg: string) { super(`${code}: ${msg}`); }
}

type TextLayer = RemixKeepRenderInput['textLayers'][number];
type Estilo = TextLayer['style'];

/** Fonte do catálogo → tabela de medida (as 6 medidas; as outras medem pela mais parecida). */
const MEDIDA: Record<string, FrameFontKey> = {
  'inter-800': 'inter-800', 'montserrat-800': 'montserrat-800', 'montserrat-900': 'montserrat-900', 'anton-400': 'anton-400',
  'archivo-black-400': 'archivo-black-400', 'oswald-700': 'anton-400', 'bebas-neue-400': 'anton-400', 'poppins-800': 'montserrat-800', 'roboto-condensed-700': 'inter-800',
};

/** Linhas do texto (fichas com CJK por caractere) num tamanho; null = uma ficha não cabe na largura. */
export function quebrarHeadline(texto: string, fontId: string, size: number, largura: number, uppercase: boolean, cjk: 'tc' | 'sc' | 'jp' | 'kr'): string[] | null {
  const f = MEDIDA[fontId] ?? 'montserrat-800';
  const toks = tokensDoTexto(uppercase ? texto.toUpperCase() : texto);
  const mede = (t: string) => medirTexto(f, t, size, 0, cjk);
  const linhas: string[] = [];
  let atual = '';
  for (const k of toks) {
    const tent = atual ? atual + (k.espaco ? ' ' : '') + k.t : k.t;
    if (mede(tent) <= largura) { atual = tent; continue; }
    if (mede(k.t) > largura) return null;
    linhas.push(atual);
    atual = k.t;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Maior tamanho (100 % → 80 % do original, passo 2 %) em que cabe em `largura` com até `maxLinhas` linhas. */
export function ajustarHeadline(texto: string, st: Pick<Estilo, 'fontId' | 'uppercase' | 'fontSizePx' | 'strokeWidthPx'>, largura: number, maxLinhas: number, language: string) {
  const cjk = /^ja/i.test(language) ? 'jp' : /^ko/i.test(language) ? 'kr' : /^zh/i.test(language) && !/(-tw|-hk|-mo|hant)/i.test(language) ? 'sc' : 'tc';
  for (let f = 1; f >= 0.799; f -= 0.02) {
    const size = Math.round(st.fontSizePx * f * 10) / 10;
    const l = quebrarHeadline(texto.replace(/\*/g, ''), st.fontId, size, largura - 2 * st.strokeWidthPx, st.uppercase, cjk);
    if (l && l.length <= maxLinhas) return { size, linhas: l };
  }
  return null;
}

const hexRgb = (h: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
};
const lum = (c: [number, number, number]) => { const l = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * l(c[0]) + 0.7152 * l(c[1]) + 0.0722 * l(c[2]); };
export const razaoContraste = (a: string, b: string) => { const x = hexRgb(a), y = hexRgb(b); if (!x || !y) return 21; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };

/**
 * F11 (28/10): a mesma cor com alpha 1. No `replace` a placa/faixa apaga a headline original; com alpha < 1 (era
 * `rgba(0,0,0,0.85)`) 15 % do texto antigo atravessava em cinza. Vale pra `rgba()`/`hsla()`, `#rrggbbaa`/`#rgba`, `transparent`
 * e cada parada de um degradê.
 */
export function corOpaca(cor: string): string {
  return cor
    .replace(/\b(rgb|hsl)a?\(\s*([^,()\s]+)[\s,]+([^,()\s]+)[\s,]+([^,()\s/]+)(?:\s*[,/]\s*[^)]+)?\)/gi, (_m, f: string, a: string, b: string, c: string) => `${f.toLowerCase()}(${a}, ${b}, ${c})`)
    .replace(/#([0-9a-f]{6})[0-9a-f]{2}\b/gi, '#$1')
    .replace(/#([0-9a-f]{3})[0-9a-f]\b/gi, '#$1')
    .replace(/\btransparent\b/gi, '#000000');
}

/** Alpha de uma cor simples (1 = opaca); degradê = menor alpha das paradas. Pra teste e diagnóstico. */
export function alphaDaCor(cor: string): number {
  const as: number[] = [];
  for (const m of cor.matchAll(/\b(?:rgb|hsl)a?\(([^)]*)\)/gi)) {
    const partes = m[1].split(/[\s,/]+/).filter(Boolean);
    if (partes.length >= 4) as.push(partes[3].endsWith('%') ? parseFloat(partes[3]) / 100 : parseFloat(partes[3]));
  }
  for (const m of cor.matchAll(/#([0-9a-f]{8}|[0-9a-f]{4})\b/gi)) {
    const h = m[1];
    as.push(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : parseInt(h[3] + h[3], 16) / 255);
  }
  if (/\btransparent\b/i.test(cor)) as.push(0);
  return as.length ? Math.min(...as) : 1;
}

/** Texto com o destaque marcado (*trecho*) a partir do `highlight` (1ª ocorrência; ausente no texto = sem destaque). */
export const marcarDestaque = (text: string, highlight: string | null) => {
  if (!highlight) return text;
  const i = text.indexOf(highlight);
  return i < 0 ? text : `${text.slice(0, i)}*${highlight}*${text.slice(i + highlight.length)}`;
};

const escala = (r: Rect, ex: number, ey: number): Rect => ({ x: Math.round(r.x * ex), y: Math.round(r.y * ey), w: Math.round(r.w * ex), h: Math.round(r.h * ey) });
const cruza = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A headline do campeão: a maior camada `headline` ou `text` presente em ≥ 50 % da duração, no topo/meio (não legenda). */
export function headlineDoCampeao(m: EditMap): EditLayer | null {
  const cands = m.layers.filter((l) => l.kind === 'headline' || (l.kind === 'text' && l.endFrame - l.startFrame >= 0.5 * m.frameCount && l.box.y + l.box.h / 2 < 0.7 * m.height));
  return cands.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0] ?? null;
}

/** Fração dos frames em que `caixa` (px do campeão) cobre o rosto principal. */
function fracaoSobreRosto(m: EditMap | null, caixa: Rect, ex: number, ey: number, total: number): number {
  if (!m || !total) return 0;
  let n = 0;
  for (const s of m.faceTrack.filter((x) => (x.role ?? 'main') === 'main' && x.faceInRegion.length)) {
    const f = s.faceInRegion[0].box;
    const rosto = { x: (s.region.x + f.x * s.region.w) * ex, y: (s.region.y + f.y * s.region.h) * ey, w: f.w * s.region.w * ex, h: f.h * s.region.h * ey };
    if (cruza(caixa, rosto)) n += s.endFrame - s.startFrame;
  }
  return n / m.frameCount;
}

/** Quadros do vídeo do campeão: os do mapa (stream de vídeo, reescalado se o fps diferir); sem mapa, pela duração. */
export function quadrosDoCampeao(src: { fps: number; durationSec: number }, m: Pick<EditMap, 'fps' | 'frameCount'> | null): number {
  if (m && m.frameCount > 0 && m.fps > 0) return Math.max(1, Math.round(m.frameCount * (src.fps / m.fps)));
  return Math.max(1, Math.round(src.durationSec * src.fps));
}

export function buildHeadlineInput(spec: HeadlineSpec, ctx: AutoEditContext, opts: OpcoesDeBuild = {}): RemixKeepRenderInput {
  const src = ctx.source;
  const W = src.width, H = src.height, fps = src.fps;
  const m = ctx.editMap;
  const ex = m ? W / m.width : 1, ey = m ? H / m.height : 1, ef = m ? fps / m.fps : 1;
  // F7 (27/10): nº de quadros = o do STREAM de vídeo (editMap.frameCount = pacotes contados pelo ffprobe na análise).
  // `durationSec` é a do contêiner: com o áudio mais longo que o vídeo dava 2547 contra 2544 reais, e o finalize recusava.
  const frameCount = quadrosDoCampeao(src, m);
  const texto = marcarDestaque(spec.text.trim(), spec.highlight);
  const camadas: TextLayer[] = [];
  let caixaNova: Rect;

  if (spec.mode === 'replace') {
    const orig = m ? headlineDoCampeao(m) : null;
    if (!orig || !MEDIDA[orig.style.fontId]) throw new HeadlineError('HEADLINE_LOW_CONFIDENCE', 'campeão sem camada de headline com fonte do catálogo');
    const st0 = orig.style;
    const box = escala(orig.box, ex, ey);
    const size0 = st0.fontSizePx * ey;
    const linhas0 = Math.max(1, Math.round(box.h / (size0 * st0.lineHeight)));
    const st: Estilo = { ...st0, fontSizePx: size0, strokeWidthPx: st0.strokeWidthPx * ey };
    const aj = ajustarHeadline(texto, st, box.w, linhas0 + 1, spec.language);
    if (!aj) throw new HeadlineError('HEADLINE_TOO_LONG', `não cabe em ${linhas0 + 1} linhas de ${box.w}px entre 80 e 100 % de ${size0.toFixed(1)}px`);
    // caixa do texto: a da original; com +1 linha, cresce igual pra cima e pra baixo
    const altura = Math.max(box.h, Math.ceil(aj.linhas.length * aj.size * st.lineHeight));
    const caixaTexto = { x: box.x, y: Math.max(0, Math.round(box.y - (altura - box.h) / 2)), w: box.w, h: altura };
    let fundo: TextLayer['background'];
    if (orig.background.kind !== 'none' && orig.background.color) {
      const fb = escala(orig.background.box ?? orig.box, ex, ey);
      fundo = { kind: orig.background.kind, color: corOpaca(orig.background.color), box: fb };
      caixaNova = fb.h >= caixaTexto.h ? fb : caixaTexto;
    } else {
      // placa sobre o vídeo (H1): cor mediana do fundo; contraste baixo com o texto → preto / branco. F11 (28/10): sempre
      // OPACA (alpha 1) e cobrindo a caixa da original + margem: com 85 % a headline antiga vazava em cinza por trás da nova.
      const mg = Math.round(0.02 * H);
      const x0 = Math.max(0, Math.min(caixaTexto.x, box.x) - mg), y0 = Math.max(0, Math.min(caixaTexto.y, box.y) - mg);
      const x1 = Math.min(W, Math.max(caixaTexto.x + caixaTexto.w, box.x + box.w) + mg), y1 = Math.min(H, Math.max(caixaTexto.y + caixaTexto.h, box.y + box.h) + mg);
      const placa = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const claro = razaoContraste(st.color, '#000000') > razaoContraste(st.color, '#ffffff');
      const cor = corOpaca(spec.plateColor && razaoContraste(spec.plateColor, st.color) >= 3 ? spec.plateColor : claro ? '#000000' : '#ffffff');
      fundo = { kind: 'solid', color: cor, box: placa, radius: Math.round(0.15 * aj.size) };
      caixaNova = placa;
      if (fracaoSobreRosto(m, placa, ex, ey, frameCount) > 0.1) throw new HeadlineError('HEADLINE_OVER_FACE', 'a placa cobre o rosto em mais de 10 % dos frames');
    }
    camadas.push({
      id: 'headline-nova', startFrame: Math.round(orig.startFrame * ef), endFrame: Math.min(frameCount, Math.max(1, Math.round(orig.endFrame * ef))),
      box: caixaTexto, background: fundo, style: { ...st, fontSizePx: aj.size }, content: { kind: 'static', text: texto },
    });
  } else {
    // add: faixa na cor da marca no topo da área segura (H3)
    const fmt = Math.abs(W / H - 9 / 16) < 0.02 ? 'VERTICAL_9_16' : Math.abs(W / H - 4 / 5) < 0.02 ? 'PORTRAIT_4_5' : 'SQUARE_1_1';
    const u = W / 1080;
    const safe = { top: SAFE_AREA[fmt].top * u, bottom: SAFE_AREA[fmt].bottom * u };
    const cor = spec.brandColor ?? ctx.palette[0] ?? '#111111';
    const corTexto = razaoContraste(cor, '#ffffff') >= 4.5 ? '#ffffff' : razaoContraste(cor, '#111111') >= 4.5 ? '#111111' : contraste(cor);
    const st: Estilo = {
      fontId: 'montserrat-800', uppercase: true, fontSizePx: Math.round(70 * u), lineHeight: 1.1, color: corTexto,
      highlightColor: corTexto === '#ffffff' ? '#FFE14D' : '#D7261E', strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center',
    };
    const mx = Math.round(0.06 * W), pad = Math.round(0.3 * st.fontSizePx);
    const aj = ajustarHeadline(texto, st, W - 2 * mx, 3, spec.language);
    if (!aj) throw new HeadlineError('HEADLINE_TOO_LONG', 'headline adicionada não cabe em 3 linhas');
    const hTexto = Math.ceil(aj.linhas.length * aj.size * st.lineHeight);
    const hFaixa = Math.min(Math.round(0.22 * H), hTexto + 2 * pad);
    if (hTexto > hFaixa) throw new HeadlineError('HEADLINE_TOO_LONG', 'headline adicionada passa de 22 % da altura');
    let y = Math.round(safe.top);
    let faixa = { x: 0, y, w: W, h: hFaixa };
    if (fracaoSobreRosto(m, faixa, ex, ey, frameCount) > 0.1) {
      const r = m ? rostoPrincipal(src, m as never) : null;
      y = r ? Math.round(r.cy + r.h / 2 + 16) : y;
      faixa = { x: 0, y, w: W, h: hFaixa };
      const queimado = (m?.layers ?? []).map((l) => escala(l.box, ex, ey));
      if (y + hFaixa > H - safe.bottom || fracaoSobreRosto(m, faixa, ex, ey, frameCount) > 0.1 || queimado.some((q) => cruza(q, faixa))) {
        throw new HeadlineError('HEADLINE_NO_ROOM', 'sem lugar pra faixa fora do rosto e do texto queimado');
      }
    }
    caixaNova = faixa;
    camadas.push({
      id: 'headline-nova', startFrame: 0, endFrame: frameCount, box: { x: mx, y: y + pad, w: W - 2 * mx, h: hFaixa - 2 * pad },
      background: { kind: 'solid', color: cor, box: faixa }, style: { ...st, fontSizePx: aj.size }, content: { kind: 'static', text: texto },
    });
  }

  // legenda-protegida-v1 §2.1: a headline nova (faixa, placa ou faixa adicionada) não pode cruzar a legenda queimada
  const protegidas = faixasProtegidasDe(m as never, src);
  // remix-keep mantém o quadro inteiro do campeão: não dá pra recortar a legenda; 'replace' forçado = CAPTION_PROTECTED
  if (opts.captionMode === 'replace' && protegidas.length) throw new CaptionProtectedError('no_room', [{ element: 'forced_replace', atSec: 0, overlapPx: 0 }]);
  const cruzou = protegidas.find((b) => cruza(caixaNova, b));
  if (cruzou) throw new HeadlineError('HEADLINE_NO_ROOM', `a headline nova cruza a legenda queimada (y ${cruzou.y}-${cruzou.y + cruzou.h})`);

  // legenda automática (§2.2): karaokê embaixo, acima da área segura, nunca na faixa nova; com legenda queimada, não entra
  const cap = protegidas.length ? null : spec.captions;
  if (cap?.words.length) {
    const u = W / 1080;
    const size = Math.round(60 * u), hCap = Math.ceil(2 * size * 1.15);
    let yCap = Math.round(H - (SAFE_AREA.VERTICAL_9_16.bottom * u) - hCap - 0.02 * H);
    if (W / H > 0.7) yCap = Math.round(H - 0.1 * H - hCap);
    const caixaCap = { x: Math.round(0.06 * W), y: yCap, w: Math.round(0.88 * W), h: hCap };
    if (cruza(caixaCap, caixaNova)) caixaCap.y = Math.max(0, caixaNova.y - hCap - Math.round(0.02 * H));
    const words = cap.words.map((w) => ({ word: w.word.trim(), startFrame: Math.round(w.startSec * fps), endFrame: Math.max(Math.round(w.startSec * fps) + 1, Math.round(w.endSec * fps)) }))
      .filter((w) => w.word && w.startFrame < frameCount).map((w) => ({ ...w, endFrame: Math.min(frameCount, w.endFrame) }));
    if (words.length) {
      camadas.push({
        id: 'legenda-auto', startFrame: 0, endFrame: frameCount, box: caixaCap, background: { kind: 'none', color: null, box: null },
        style: { fontId: 'montserrat-800', uppercase: false, fontSizePx: size, lineHeight: 1.15, color: '#ffffff', highlightColor: cap.highlightColor, strokeColor: '#000000', strokeWidthPx: Math.max(2, Math.round(size * 0.08)), shadow: true, align: 'center' },
        content: { kind: 'karaoke', words, wordsPerPage: semEspaco(cap.language) ? 6 : 3 },
      });
    }
  }

  return {
    kind: 'remix-keep', renderId: ctx.renderId, templateId: 'remix-keep',
    canvas: { width: W, height: H, fps, frameCount },
    baseVideoUrl: src.videoUrl, audioPassthroughUrl: src.videoUrl, overlays: [], textLayers: camadas, language: spec.language,
    ...(protegidas.length && { outputProtectedBands: faixasProtegidasNaSaidaRemix(protegidas, { width: W, height: H, fps, frameCount }) }),
  };
}
