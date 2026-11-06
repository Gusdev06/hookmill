// Partes puras da troca de texto (troca-texto-queimado-v1 §15.5, §16.2, §16.3): alvo, portões geométricos e a montagem
// do HeadlineLook a partir da medida Python e da régua. Sem I/O: testável sem vídeo. Dono: video.
import type { EditLayer, EditMap, HeadlineFitLook, HeadlineLook, HeadlineLookReason, Rect } from '@maquina/contratos';
import type { MedidaHeadline, ResultadoRegua } from './evento';

type FontIdLook = HeadlineLook['font']['fontId'];

/** §15.5.2: a 1ª camada no tempo, `headline`, ou `text` começando acima de 70 % da altura; nunca a maior. */
export function escolherAlvo(m: EditMap): EditLayer | null {
  const cands = m.layers
    .filter((l) => l.kind === 'headline' || (l.kind === 'text' && l.box.y < 0.7 * m.height))
    .filter((l) => (l.text ?? '').trim().length > 0 && l.endFrame > l.startFrame);
  cands.sort((a, b) => a.startFrame - b.startFrame || a.box.y - b.box.y);
  return cands[0] ?? null;
}

/** Folga da legenda, escalada pela largura: 7 px a 464, 16 a 1080 (§15.5.4 item 3). */
export const folgaLegenda = (W: number) => Math.round((7 * W) / 464);

export interface RostoQuadro { startFrame: number; endFrame: number; box: Rect }

/** Caixas do rosto `main` em px do campeão, por trecho de escala (faceInRegion é relativo à região). */
export function rostosMain(m: EditMap): RostoQuadro[] {
  const out: RostoQuadro[] = [];
  for (const s of m.faceTrack) {
    if (s.role && s.role !== 'main') continue;
    const passos = [...s.faceInRegion].sort((a, b) => a.atFrame - b.atFrame);
    passos.forEach((p, k) => {
      const ini = Math.max(s.startFrame, k === 0 ? s.startFrame : p.atFrame);
      const fim = k + 1 < passos.length ? Math.max(ini, passos[k + 1].atFrame) : s.endFrame;
      if (fim <= ini) return;
      out.push({ startFrame: ini, endFrame: fim, box: {
        x: s.region.x + p.box.x * s.region.w, y: s.region.y + p.box.y * s.region.h, w: p.box.w * s.region.w, h: p.box.h * s.region.h } });
    });
  }
  return out;
}

const inter = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const uniao = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const crescer = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export interface Geometria {
  /** área que a peça repinta: caixa, ou texto + emoji dilatados */
  area: Rect;
  textBox: Rect;
  chinY: number | null;
  bottomLimitY: number | null;
  reason: HeadlineLookReason | null;
  gates: Record<string, number>;
}

/** §15.5.4-5 e §16.2 A6: legenda perto, rosto na máscara, queixo e limite de baixo. */
export function geometria(m: EditMap, md: MedidaHeadline): Geometria {
  const W = md.canvas.width;
  const a = md.startFrame ?? 0, b = md.endFrame ?? 0;
  const linhas = md.linhasMedidas ?? [];
  const caixas: Rect[] = linhas.map(([y0, y1, x0, x1]) => ({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 }));
  if (md.emoji) caixas.push({ x: md.emoji.bbox[0], y: md.emoji.bbox[1], w: md.emoji.bbox[2] - md.emoji.bbox[0] + 1, h: md.emoji.bbox[3] - md.emoji.bbox[1] + 1 });
  const textBox = caixas.length ? uniao(caixas) : (md.box ?? { x: 0, y: 0, w: 0, h: 0 });
  const area = md.kind === 'box' && md.box ? md.box : crescer(textBox, Math.ceil((md.dilatacao ?? 0) / 2));
  const fps = md.fps || m.fps;
  const folga = folgaLegenda(W);
  const gates: Record<string, number> = {};
  let reason: HeadlineLookReason | null = null;
  // legenda: banda no mesmo tempo e na mesma coluna
  const bandas = (m.protectedBands ?? []).filter((bd) => bd.startSec * fps < b && bd.endSec * fps > a && bd.x < area.x + area.w && area.x < bd.x + bd.w);
  let dist = Infinity;
  for (const bd of bandas) {
    const d = bd.y >= area.y ? bd.y - (area.y + area.h) : area.y - (bd.y + bd.h);
    dist = Math.min(dist, d);
  }
  if (Number.isFinite(dist)) gates.distancia_legenda = Math.round(dist * 10) / 10;
  gates.folga_legenda = folga;
  if (dist < folga) reason = 'near_caption';
  const abaixo = bandas.filter((bd) => bd.y >= textBox.y + textBox.h / 2);
  const bottomLimitY = abaixo.length ? Math.min(...abaixo.map((bd) => bd.y)) - folga : null;
  // rosto: fração de quadros do intervalo em que a caixa do rosto cruza a área repintada
  const rostos = rostosMain(m).filter((r) => r.startFrame < b && r.endFrame > a);
  let cruza = 0;
  const fundos: number[] = [];
  for (const r of rostos) {
    const n = Math.min(b, r.endFrame) - Math.max(a, r.startFrame);
    if (inter(r.box, area)) cruza += n;
    for (let k = 0; k < n; k++) fundos.push(r.box.y + r.box.h);
  }
  const fr = b > a ? cruza / (b - a) : 0;
  gates.rosto_frac = Math.round(fr * 1000) / 1000;
  if (!reason && fr > 0.1) reason = 'over_face';
  fundos.sort((x, y) => x - y);
  const chinY = fundos.length ? Math.round(fundos[Math.min(fundos.length - 1, Math.floor(0.95 * (fundos.length - 1)))]) : null;
  return { area, textBox, chinY, bottomLimitY, reason, gates };
}

const mediana = (v: number[]) => { const s = [...v].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/** A4: centro único = mediana dos centros das linhas antigas, com o emoji dentro da linha dele. */
export function centroUnico(md: MedidaHeadline): number | null {
  if (md.align !== 'center' || !md.linhasMedidas?.length) return null;
  const cs = md.linhasMedidas.map(([, , x0, x1], i) => {
    let a = x0, b = x1;
    if (md.emoji && md.emoji.lineIndex === i) { a = Math.min(a, md.emoji.bbox[0]); b = Math.max(b, md.emoji.bbox[2]); }
    return (a + b) / 2;
  });
  return Math.round(mediana(cs) * 100) / 100;
}

export interface Escolha { fontId: string; corr: number; stemErr: number; widthErr: number; tier: 'same' | 'close' | 'far' }

/** Monta o HeadlineLook (version 2). `regua` null = a medida reprovou antes da prova. */
export function montarLook(o: {
  layer: EditLayer; m: EditMap; md: MedidaHeadline; regua: ResultadoRegua | null; measuredIn: 'chrome-linux' | 'chrome-mac';
}): HeadlineLook {
  const { layer, m, md, regua } = o;
  const W = md.canvas?.width ?? m.width, H = md.canvas?.height ?? m.height;
  const kind = md.kind ?? (layer.background.kind === 'none' ? 'loose' : 'box');
  const geo = md.linhasMedidas ? geometria(m, md) : null;
  const cand = regua?.escolhida ? md.candidatas?.find((c) => c.fontId === regua.escolhida) ?? null : null;
  const med = regua?.escolhida ? regua.medidas.find((x) => x.fontId === regua.escolhida) ?? null : null;
  const lay = cand?.layout ?? md.candidatas?.[0]?.layout ?? null;
  const fontId = (cand?.fontId ?? md.candidatas?.[0]?.fontId ?? layer.style.fontId) as FontIdLook;
  // ordem dos motivos: a medida; a fonte; legenda e rosto
  let reason: HeadlineLookReason | null = md.ok ? null : ((md.reason as HeadlineLookReason) ?? 'not_measured');
  if (!reason && regua && (!regua.escolhida || regua.tier === 'far')) reason = 'font_far';
  if (!reason && geo?.reason) reason = geo.reason;
  const gates: Record<string, number> = {};
  for (const [k, v] of Object.entries({ ...md.gates, ...(geo?.gates ?? {}) })) if (typeof v === 'number') gates[k] = v;
  if (med?.corr !== undefined) gates.font_corr = med.corr;
  const textBox = geo?.textBox ?? layer.box;
  const linhas = md.linhasMedidas ?? [];
  const lines = md.lines ?? (layer.text ? [layer.text] : []);
  const sizePx = lay ? r2(lay.sz) : layer.style.fontSizePx;
  const pitch = lay ? r2(lay.pitch) : r2(sizePx * layer.style.lineHeight);
  const base = lay ? r2(lay.base) : textBox.y + textBox.h;
  const align = md.align ?? layer.style.align;
  const fit: HeadlineFitLook = {
    kind, canvas: { width: W, height: H }, fontId, sizePx, letterSpacingEm: lay ? lay.tr : 0, linePitchPx: pitch, firstBaselineY: base,
    align, centerX: md.align ? centroUnico(md) : null, caseStyle: md.caseStyle ?? (layer.style.uppercase ? 'upper' : 'sentence'),
    originalLines: lines.map((t, i) => ({ chars: [...t].length, widthPx: linhas[i]?.[4] ?? 0 })),
    erasedRects: kind === 'box' ? [] : (md.erasedRects ?? []),
    bottomLimitY: geo?.bottomLimitY ?? null, chinY: geo?.chinY ?? null,
    sideMarginPx: md.sideMarginPx ?? Math.round(0.05 * W),
    emoji: md.emoji ? { widthPx: md.emoji.bbox[2] - md.emoji.bbox[0] + 1, gapPx: md.emoji.gapPx, lineIndex: md.emoji.lineIndex, side: md.emoji.side } : null,
    box: kind === 'box' ? md.box ?? null : null,
  };
  return {
    version: 2, kind, layerId: layer.id,
    startFrame: md.startFrame ?? layer.startFrame, endFrame: md.endFrame ?? layer.endFrame,
    box: kind === 'box' ? md.box ?? null : null, radiusPx: md.radiusPx ?? 0,
    plate: kind === 'box' ? md.plate ?? null : null,
    plateRef: kind === 'loose' ? { kind: 'HEADLINE', layerKey: layer.id, version: 0 } : null,
    emoji: md.emoji ? {
      char: md.emoji.char, image: md.emoji.image, x: md.emoji.x, y: md.emoji.y, w: md.emoji.w, h: md.emoji.h,
      lineIndex: md.emoji.lineIndex, side: md.emoji.side, gapPx: md.emoji.gapPx, marginLeftPx: md.emoji.marginLeftPx, solidity: md.emoji.solidity,
    } : null,
    text: {
      lines, textBox, firstBaselineY: base, linePitchPx: pitch, sizePx, letterSpacingEm: lay ? lay.tr : 0, align,
      caseStyle: fit.caseStyle, color: md.color ?? layer.style.color,
      stroke: layer.style.strokeColor && layer.style.strokeWidthPx > 0 ? { color: layer.style.strokeColor, px: layer.style.strokeWidthPx } : null,
      shadow: md.sombra ?? null, stemPx: md.stemPx ?? 0,
    },
    emphasis: md.emphasis ?? null,
    font: { fontId, corr: med?.corr ?? 0, stemErr: med?.stemErr ?? 0, widthErr: med?.widthErr ?? 0, tier: regua?.tier ?? 'far', measuredIn: o.measuredIn },
    fit,
    verdict: { ok: reason === null, reason, gates },
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Custo relativo de um quadro FORA do intervalo na placa (decodifica, converte e recodifica; não apaga). Medido no G1
 *  (06/11, Lambda, solto de 60 s a 720p): ~0,2 s por quadro dentro (TELEA + x264) e ~0,06-0,08 s fora. O 0,05 antigo
 *  deixava o último pedaço com 1204 quadros fora: 96,6 s contra 13,7 s do 1º. */
export const PESO_FORA_DO_INTERVALO = 0.35;

/** Pedaços da placa (§15.6.4): até `max`, balanceados pelo custo (quadro do intervalo = 1; fora = PESO_FORA_DO_INTERVALO). */
export function planejarPedacos(n: number, a: number, b: number, max = 4, minQuadros = 30): Array<[number, number]> {
  const custo = (i: number) => (i >= a && i < b ? 1 : PESO_FORA_DO_INTERVALO);
  let total = 0;
  for (let i = 0; i < n; i++) total += custo(i);
  const k = Math.max(1, Math.min(max, Math.floor(n / minQuadros)));
  const alvo = total / k;
  const out: Array<[number, number]> = [];
  let ini = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    acc += custo(i);
    if (acc >= alvo && out.length < k - 1 && i + 1 - ini >= minQuadros && n - (i + 1) >= minQuadros) { out.push([ini, i + 1]); ini = i + 1; acc = 0; }
  }
  out.push([ini, n]);
  return out;
}

/** Parâmetros da placa a partir do look (o mesmo molde da medida): ROI = texto + emoji + 12 px, brilho 205,
 *  letras antigas redesenhadas com o centro de cada linha medida (a prova de mesmas palavras usa centro por linha). */
export function parametrosDaPlaca(look: HeadlineLook, W: number, H: number) {
  const tb = look.text.textBox;
  const em = look.emoji ? { x: look.emoji.x, y: look.emoji.y, w: look.emoji.w, h: look.emoji.h } : null;
  const r = crescer(em ? uniao([tb, em]) : tb, 12);
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const roi: [number, number, number, number] = [x0, y0, Math.min(W, Math.ceil(r.x + r.w)) - x0, Math.min(H, Math.ceil(r.y + r.h)) - y0];
  const linhas = look.fit.erasedRects;
  const dil = Math.round((17 * W) / 1080);
  return {
    startFrame: look.startFrame, endFrame: look.endFrame, roi, brilho: 205,
    emoji: em ? [em.x + look.emoji!.marginLeftPx, em.y, em.x + em.w - 1, em.y + em.h - 1] : null,
    dil: dil % 2 ? dil : dil + 1,
    redesenho: linhas.length === look.text.lines.length ? {
      fontId: look.font.fontId, lines: look.text.lines, sz: look.text.sizePx, pitch: look.text.linePitchPx, base: look.text.firstBaselineY,
      cxs: linhas.map((q) => q.x + q.w / 2), tr: look.text.letterSpacingEm,
    } : null,
  };
}
