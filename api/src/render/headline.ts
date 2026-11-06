/**
 * headline-e-legenda-v1 §1.3: buildHeadlineInput(spec, ctx) → RemixKeepRenderInput. Função PURA do maquina-video (como o
 * buildFrameInput): a headline nova por cima do campeão no render `remix-keep` (mesmo corte, mesmo áudio, mesmo quadro;
 * a API compõe sobre o campeão decodificado com máscara na caixa nova).
 * - `replace` (troca-texto §16.6 V3): cópia da headline medida (`spec.look`). `box` = imagem 2D da caixa original + texto
 *   novo por linha de base, máscara = a caixa; `loose` = a placa do campeão (texto antigo apagado, `opts.plateUrl`) como base,
 *   texto novo e emoji recortado por cima, com A8. Sem `look` = `HEADLINE_PENDING` (F1a). Isento de `protectedBands` (§15.5.4.7).
 * - `add` (campeão sem headline): faixa na cor da marca no topo da área segura, Montserrat 800 caixa alta centralizada;
 *   cobrindo o rosto em > 10 % dos frames desce pra logo abaixo dele; ainda colidindo = `HEADLINE_NO_ROOM`.
 * Texto até 3 linhas, tamanho entre 80 % e 100 %; não coube = `HEADLINE_TOO_LONG`. Destaque: *trecho* = `highlight`.
 * Legenda automática (`captionsAuto`, §2.2): camada karaokê embaixo, nunca na faixa nova.
 */
import type { EditLayer, EditMap, HeadlineLook, Rect } from '@maquina/contratos';
import { SAFE_AREA, ajustarHeadlineCopia, contraste, faixasProtegidasDe, faixasProtegidasNaSaidaRemix, larguraCopia, medirTexto, rostoPrincipal, semEspaco, tintaCopia, tokensDoTexto, type CaptionsAuto, type FrameFontKey, type HeadlineFitLook } from '@maquina/video';
import type { HeadlineSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import type { RemixKeepRenderInput } from './contrato';
import { CaptionProtectedError, type OpcoesDeBuild } from './frame';

/** Oficial em `integracoes/contrato.ts` (headline-e-legenda-v1 §1.2, fechado 25/10). */
export type { HeadlineSpec };

export class HeadlineError extends Error {
  constructor(public readonly code: 'HEADLINE_TOO_LONG' | 'HEADLINE_NO_FIT' | 'HEADLINE_NO_ROOM' | 'HEADLINE_OVER_FACE' | 'HEADLINE_LOW_CONFIDENCE' | 'HEADLINE_PENDING', msg: string) { super(`${code}: ${msg}`); }
}

/** Opções do build da headline. `plateUrl` (F1b): placa do campeão (`champion_plates`, READY), URL que o render lê; só `loose`. */
export interface OpcoesHeadline extends OpcoesDeBuild { plateUrl?: string | null }

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

export function buildHeadlineInput(spec: HeadlineSpec, ctx: AutoEditContext, opts: OpcoesHeadline = {}): RemixKeepRenderInput {
  const src = ctx.source;
  const W = src.width, H = src.height, fps = src.fps;
  const m = ctx.editMap;
  const ex = m ? W / m.width : 1, ey = m ? H / m.height : 1;
  // F7 (27/10): nº de quadros = o do STREAM de vídeo (editMap.frameCount = pacotes contados pelo ffprobe na análise).
  // `durationSec` é a do contêiner: com o áudio mais longo que o vídeo dava 2547 contra 2544 reais, e o finalize recusava.
  const frameCount = quadrosDoCampeao(src, m);
  const texto = marcarDestaque(spec.text.trim(), spec.highlight);
  const camadas: TextLayer[] = [];
  let caixaNova: Rect;
  let baseVideoUrl = src.videoUrl;
  let placaComoBase = false;
  let copia = false;

  if (spec.mode === 'replace') {
    // troca-texto §15.3 (F1a): sem medida, nada cobre o texto original
    if (!spec.look) throw new HeadlineError('HEADLINE_PENDING', 'a headline deste vídeo ainda não pode ser refeita');
    const c = camadaDaCopia(spec, spec.look, { W, H, frameCount });
    if (c.look.kind === 'loose') {
      if (!opts.plateUrl) throw new HeadlineError('HEADLINE_PENDING', 'placa do texto solto ainda não está pronta');
      baseVideoUrl = opts.plateUrl;
      placaComoBase = true;
    }
    camadas.push(c.camada);
    caixaNova = c.camada.background.box ?? c.camada.box;
    copia = true;
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
    const queimado = (m?.layers ?? []).map((l) => escala(l.box, ex, ey));
    const protegidas = faixasProtegidasDe(m as never, src);
    const obstaculos = [...queimado, ...protegidas];
    const rosto = m ? rostoPrincipal(src, m as never) : null;
    const candidatos = [
      safe.top, H - safe.bottom - hFaixa,
      ...(rosto ? [rosto.cy - rosto.h / 2 - hFaixa - 16, rosto.cy + rosto.h / 2 + 16] : []),
      ...obstaculos.flatMap((q) => [q.y - hFaixa - 16, q.y + q.h + 16]),
    ];
    const y = candidatos.map(Math.round).find((candidate) => {
      const box = { x: 0, y: candidate, w: W, h: hFaixa };
      return candidate >= safe.top && candidate + hFaixa <= H - safe.bottom
        && fracaoSobreRosto(m, box, ex, ey, frameCount) <= 0.1 && obstaculos.every((q) => !cruza(q, box));
    });
    if (y === undefined) throw new HeadlineError('HEADLINE_NO_ROOM', 'sem área livre fora do rosto, da legenda e do texto original');
    const faixa = { x: 0, y, w: W, h: hFaixa };
    caixaNova = faixa;
    camadas.push({
      id: 'headline-nova', startFrame: 0, endFrame: frameCount, box: { x: mx, y: y + pad, w: W - 2 * mx, h: hFaixa - 2 * pad },
      background: { kind: 'solid', color: cor, box: faixa }, style: { ...st, fontSizePx: aj.size }, content: { kind: 'static', text: texto },
    });
  }

  // legenda-protegida-v1 §2.1: a faixa adicionada não pode cruzar a legenda queimada
  const protegidas = faixasProtegidasDe(m as never, src);
  // remix-keep mantém o quadro inteiro do campeão: não dá pra recortar a legenda; 'replace' forçado = CAPTION_PROTECTED
  if (opts.captionMode === 'replace' && protegidas.length) throw new CaptionProtectedError('no_room', [{ element: 'forced_replace', atSec: 0, overlapPx: 0 }]);
  // cópia (box ou loose): não pinta fora do texto antigo + o novo, e o novo respeita `bottomLimitY` (§15.5.4 item 7)
  const cruzou = copia ? undefined : protegidas.find((b) => cruza(caixaNova, b));
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

  const rostoHint = m ? rostoPrincipal(src, m as never) : null;
  return {
    kind: 'remix-keep', renderId: ctx.renderId, templateId: 'remix-keep',
    canvas: { width: W, height: H, fps, frameCount },
    baseVideoUrl, audioPassthroughUrl: src.videoUrl, overlays: [], textLayers: camadas, language: spec.language,
    ...(placaComoBase && { placaComoBase: true }),
    ...(protegidas.length && { outputProtectedBands: faixasProtegidasNaSaidaRemix(protegidas, { width: W, height: H, fps, frameCount }) }),
    // editor universal F-U2: auto reframe numa caixa nova (a composição ignora)
    ...(rostoHint && { faceHint: { x: rostoHint.cx - rostoHint.w / 2, y: rostoHint.cy - rostoHint.h / 2, w: rostoHint.w, h: rostoHint.h } }),
  };
}

// ───────── cópia da headline (troca-texto §14.4, §15.5, §16.2 A4, §16.6 V3) ─────────

/** `*trecho*` nas linhas prontas: o `highlight` (1ª ocorrência, sem caixa) pode cruzar linhas. Ausente = sem marca. */
export function marcarDestaqueNasLinhas(linhas: string[], highlight: string | null): string[] {
  const h = highlight?.replace(/\*/g, '').trim().replace(/\s+/g, ' ');
  if (!h) return linhas;
  const junto = linhas.join(' ');
  const i = junto.toLocaleLowerCase().indexOf(h.toLocaleLowerCase());
  if (i < 0) return linhas;
  const j = i + h.length;
  let ini = 0;
  return linhas.map((l) => {
    const a = ini, b = ini + l.length;
    ini = b + 1;
    const s0 = Math.max(a, i), s1 = Math.min(b, j);
    if (s1 <= s0) return l;
    const ab = s0 === i ? '*' : '', fe = s1 === j ? '*' : '';
    // trecho que continua na linha seguinte: fecha na próxima (o `*` vale entre linhas)
    return l.slice(0, s0 - a) + ab + l.slice(s0 - a, s1 - a) + fe + l.slice(s1 - a);
  });
}

/** Linha do emoji no texto novo (mesma regra de `ajustarHeadlineCopia`): última → última, primeira → primeira. */
const linhaDoEmojiNova = (fit: HeadlineFitLook, lineIndex: number, k: number) => {
  const n0 = fit.originalLines.length;
  if (lineIndex >= n0 - 1) return k - 1;
  if (lineIndex <= 0) return 0;
  return Math.min(lineIndex, k - 1);
};

/** Âncora x das linhas (A4: centro único; `left`/`right` pela borda), a mesma de `ajustarHeadlineCopia`. */
const ancoraDaCopia = (fit: HeadlineFitLook) => {
  const side = fit.sideMarginPx;
  const L = fit.box ? fit.box.x + side : side, R = fit.box ? fit.box.x + fit.box.w - side : fit.canvas.width - side;
  if (fit.align === 'center') return fit.centerX ?? (fit.box ? fit.box.x + fit.box.w / 2 : fit.canvas.width / 2);
  const er = fit.erasedRects;
  if (fit.align === 'left') return !fit.box && er.length ? Math.min(...er.map((r) => r.x)) : L;
  return !fit.box && er.length ? Math.max(...er.map((r) => r.x + r.w)) : R;
};

/** Caixa que cresce (degrau `grow`, §14.4): pra baixo se encosta no topo, pra cima se encosta embaixo, senão os dois. */
const caixaCrescida = (b: Rect, grow: number, H: number): Rect => {
  if (grow <= 0) return b;
  const encosta = 0.02 * H;
  const cima = b.y <= encosta ? 0 : b.y + b.h >= H - encosta ? grow : grow / 2;
  return { x: b.x, y: Math.round(b.y - cima), w: b.w, h: b.h + grow };
};

/** A camada `remix-keep` da cópia. Pura: a medida (`look`) e o texto novo decidem tudo; o render não reajusta. */
export function camadaDaCopia(spec: Pick<HeadlineSpec, 'text' | 'highlight'>, look: HeadlineLook, g: { W: number; H: number; frameCount: number }): { camada: TextLayer; look: HeadlineLook; fit: ReturnType<typeof ajustarHeadlineCopia> } {
  if (!look.verdict.ok) throw new HeadlineError('HEADLINE_LOW_CONFIDENCE', `medida reprovada: ${look.verdict.reason ?? 'sem motivo'}`);
  const fitLook = look.fit as unknown as HeadlineFitLook;
  if (Math.abs(fitLook.canvas.width - g.W) > 1 || Math.abs(fitLook.canvas.height - g.H) > 1) {
    throw new HeadlineError('HEADLINE_LOW_CONFIDENCE', `medida em ${fitLook.canvas.width}x${fitLook.canvas.height}, vídeo em ${g.W}x${g.H}`);
  }
  if (look.kind === 'box' && (!look.box || !look.plate)) throw new HeadlineError('HEADLINE_LOW_CONFIDENCE', 'caixa sem imagem medida');
  const texto = spec.text.replace(/\*/g, '').trim();
  const fit = ajustarHeadlineCopia(fitLook, texto);
  if (!fit.fits) {
    if (fit.reject === 'too_long') throw new HeadlineError('HEADLINE_TOO_LONG', 'não cabe na headline copiada');
    throw new HeadlineError('HEADLINE_NO_FIT', `${fit.reject}: E ${fit.exposure}, queixo ${fit.chinGapPx ?? '-'}`);
  }
  const startFrame = Math.max(0, look.startFrame), endFrame = Math.min(g.frameCount, look.endFrame);
  if (!(endFrame > startFrame)) throw new HeadlineError('HEADLINE_LOW_CONFIDENCE', `intervalo ${look.startFrame}-${look.endFrame} fora do vídeo`);
  const escala = fit.sizePx / fitLook.sizePx;
  const pitch = fitLook.linePitchPx * escala;
  const anchorX = ancoraDaCopia(fitLook);
  const t = look.text;
  const lines = look.emphasis ? marcarDestaqueNasLinhas(fit.lines, spec.highlight) : fit.lines;
  const emoji = look.emoji ? {
    image: look.emoji.image, w: look.emoji.w, h: look.emoji.h, inkWidthPx: fitLook.emoji?.widthPx ?? look.emoji.w - look.emoji.marginLeftPx,
    topFromBaseline: look.emoji.y - (fitLook.firstBaselineY + look.emoji.lineIndex * fitLook.linePitchPx),
    gapPx: look.emoji.gapPx, marginLeftPx: look.emoji.marginLeftPx,
    lineIndex: linhaDoEmojiNova(fitLook, look.emoji.lineIndex, fit.lines.length), side: look.emoji.side,
  } : undefined;
  const style: TextLayer['style'] = {
    fontId: look.font.fontId, uppercase: false, fontSizePx: fit.sizePx, lineHeight: pitch / fit.sizePx, color: t.color,
    highlightColor: null, strokeColor: t.stroke?.color ?? null, strokeWidthPx: t.stroke?.px ?? 0, shadow: !!t.shadow, align: t.align,
    letterSpacingEm: t.letterSpacingEm, shadowDetail: t.shadow ?? null, emphasis: look.emphasis ?? null,
  };
  // caixa da camada = tinta nova + emoji + sombra (máscara do compositor no `loose`; no `box` a máscara é a caixa)
  const sombra = t.shadow ? Math.abs(t.shadow.dx) + Math.abs(t.shadow.dy) + 1.5 * t.shadow.blurPx : 0;
  const folga = Math.ceil(2 + sombra + (t.stroke?.px ?? 0) + (look.emphasis?.kind === 'underline' ? Math.max(0, look.emphasis.offsetPx + look.emphasis.thicknessPx) : 0));
  const rs = fit.lines.map((l, i) => {
    const w = larguraCopia(look.font.fontId, l, fit.sizePx, t.letterSpacingEm);
    const extra = emoji && emoji.lineIndex === i ? emoji.gapPx + emoji.inkWidthPx : 0;
    const tot = w + extra;
    const x = t.align === 'center' ? anchorX - tot / 2 : t.align === 'left' ? anchorX : anchorX - tot;
    const base = fit.firstBaselineY + i * pitch;
    const tin = tintaCopia(look.font.fontId, l || 'H', fit.sizePx);
    const r = { x, y: base - Math.max(tin.top, 0.8 * fit.sizePx), w: tot, h: Math.max(tin.top, 0.8 * fit.sizePx) + Math.max(tin.bot, 0.25 * fit.sizePx) };
    if (emoji && emoji.lineIndex === i) { const ey = base + emoji.topFromBaseline; r.y = Math.min(r.y, ey); r.h = Math.max(r.y + r.h, ey + emoji.h) - r.y; }
    return r;
  });
  const x0 = Math.min(...rs.map((r) => r.x)) - folga, y0 = Math.min(...rs.map((r) => r.y)) - folga;
  const x1 = Math.max(...rs.map((r) => r.x + r.w)) + folga, y1 = Math.max(...rs.map((r) => r.y + r.h)) + folga;
  const box = { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)), w: 0, h: 0 };
  box.w = Math.min(g.W, Math.ceil(x1)) - box.x; box.h = Math.min(g.H, Math.ceil(y1)) - box.y;
  const caixa = look.kind === 'box' ? caixaCrescida(look.box!, fit.boxGrowPx, g.H) : null;
  const camada: TextLayer = {
    id: 'headline-nova', startFrame, endFrame, box,
    background: caixa
      ? { kind: 'solid', color: look.plate!.color, box: caixa, image: look.plate!.image, ...(look.radiusPx ? { radius: look.radiusPx } : {}) }
      : { kind: 'none', color: null, box: null },
    style,
    content: { kind: 'static', text: lines.join('\n'), lines, layout: { firstBaselineY: fit.firstBaselineY, linePitchPx: pitch, anchorX }, ...(emoji && { emoji }) },
  };
  return { camada, look, fit };
}
