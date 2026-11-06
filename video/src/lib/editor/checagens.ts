// Checagens de posição e conteúdo do editor universal (editor-universal-v1 §6.2): UMA função pra todas as famílias, a
// mesma no web (a cada mudança) e no PUT/export da API. Lê só o `EditLayout` (fonte única da geometria), a guarda (faixas
// protegidas e rosto, px do arquivo do cliente), os textos do resolver, os fatos e as confirmações do doc.
// caption_covered, face_covered, caption_cut, face_cut, text_overflow, too_long, invented_number, low_contrast.
// item_out_of_range entra junto dos itens com tempo (F-U3).
import { textoVisivel } from '../molduras';
import { docV3De, numerosNaoConfirmados } from './comum';
import type { AnyEditDoc, EditIssue, EditLayout, EditLayoutLayer, EditorFacts, EditorGuard, RectFracao, TextoEditor } from './tipos';

const area = (a: RectFracao, b: RectFracao) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const corta = (a: RectFracao, b: RectFracao): RectFracao | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
const mesmoRect = (a: RectFracao, b: RectFracao) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Retângulo do arquivo do cliente (px) → fração do canvas, pela pintura do vídeo (`layout.video.sourceRect`). */
const noCanvas = (r: { x: number; y: number; w: number; h: number }, guard: EditorGuard, v: NonNullable<EditLayout['video']>): RectFracao => {
  const sx = v.sourceRect.w / guard.source.width, sy = v.sourceRect.h / guard.source.height;
  return { x: v.sourceRect.x + r.x * sx, y: v.sourceRect.y + r.y * sy, w: r.w * sx, h: r.h * sy };
};

/** Camadas que podem cobrir rosto/legenda: texto, caixa, lista, chat e b-roll/2ª fonte visíveis. Texto que mora dentro de
 *  uma caixa (mesmo retângulo dela) não conta duas vezes. */
const cobridoras = (layout: EditLayout): EditLayoutLayer[] => {
  const vis = layout.layers.filter((l) => l.visible && l.rect.w > 0 && l.rect.h > 0 && ['text', 'box', 'list', 'chat', 'broll'].includes(l.kind));
  const caixas = vis.filter((l) => l.kind !== 'text');
  return vis.filter((l) => l.kind !== 'text' || !caixas.some((c) => mesmoRect(c.rect, l.rect)));
};

const hexRgb = (h: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(h.trim());
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
};
const lum = ([r, g, b]: [number, number, number]) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
/** Razão de contraste WCAG (1..21); cor inválida = 21 (não acusa). */
export const razaoDeContraste = (a: string, b: string) => { const x = hexRgb(a), y = hexRgb(b); if (!x || !y) return 21; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };

/** Rosto `main` (px do arquivo) no instante `t` (segundos do arquivo); null = sem rosto nesse instante. */
const rostoEm = (guard: EditorGuard, t: number) => {
  const f = t * guard.source.fps;
  const s = guard.faceTrack.find((x) => (x.role ?? 'main') === 'main' && f >= x.startFrame && f < x.endFrame && x.faceInRegion.length);
  if (!s) return null;
  let b = s.faceInRegion[0];
  for (const q of s.faceInRegion) if (q.atFrame <= f) b = q;
  return { x: s.region.x + b.box.x * s.region.w, y: s.region.y + b.box.y * s.region.h, w: b.box.w * s.region.w, h: b.box.h * s.region.h };
};

/**
 * Issues do doc (§6.2). `textos` = os do resolver (`ResolvidoEditor.textos`); `doc` dá as confirmações. Sem rosto no
 * faceTrack ou sem faixa protegida = a regra não roda (a pílula some, não fica verde à toa).
 */
export const checarEdicao = (layout: EditLayout, guard: EditorGuard | null, textos: TextoEditor[], facts: EditorFacts | null, doc: AnyEditDoc | null | undefined): EditIssue[] => {
  const out: EditIssue[] = [];
  const fmt = layout.format;
  const issue = (x: Omit<EditIssue, 'format'>) => out.push({ ...x, format: fmt });
  const v = layout.video;
  const camadas = cobridoras(layout);
  const trimIn = v?.trim.inSec ?? 0;

  // legenda queimada coberta (block): a faixa (já com folga) projetada no canvas, recortada à caixa do vídeo
  if (guard && v && v.checksCaption && guard.protectedBands.length) {
    for (const l of camadas) {
      for (const b of guard.protectedBands) {
        const r = corta(noCanvas(b, guard, v), v.box);
        if (!r) continue;
        const de = Math.max(l.fromSec, b.startSec - trimIn), ate = Math.min(l.toSec, b.endSec - trimIn);
        if (ate <= de || area(r, l.rect) <= 0) continue;
        issue({ rule: 'caption_covered', level: 'block', layerId: l.id, itemId: null, atSec: r3(Math.max(0, de)), detail: { coveredPct: Math.round((area(r, l.rect) / (r.w * r.h)) * 100) } });
        break;
      }
    }
  }

  // rosto coberto (block): > 10 % da área do rosto main em > 10 % das amostras (a cada 0,25 s) do intervalo da camada
  if (guard && v && guard.faceTrack.some((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length)) {
    for (const l of camadas) {
      let n = 0, ruins = 0, primeiro: number | null = null, pior = 0;
      for (let t = l.fromSec; t < l.toSec; t += 0.25) {
        const f = rostoEm(guard, t + trimIn);
        if (!f) continue;
        const rc = corta(noCanvas(f, guard, v), v.box);
        if (!rc) continue;
        n++;
        const frac = area(rc, l.rect) / (rc.w * rc.h);
        if (frac > 0.1) { ruins++; pior = Math.max(pior, frac); if (primeiro === null) primeiro = t; }
      }
      if (n && ruins / n > 0.1) issue({ rule: 'face_covered', level: 'block', layerId: l.id, itemId: null, atSec: r3(primeiro ?? l.fromSec), detail: { coveredPct: Math.round(pior * 100) } });
    }
  }

  // vídeo reenquadrado (block): só quando o doc mexeu na caixa/enquadramento; o enquadramento intocado não trava o export
  if (guard && v?.edited) {
    const trimOut = v.trim.outSec;
    if (v.checksCaption) {
      let pior = 1, primeiro: number | null = null;
      for (const b of guard.protectedBands) {
        if (b.endSec <= trimIn || b.startSec >= trimOut) continue; // fora do corte
        const r = noCanvas(b, guard, v);
        const ar = r.w * r.h;
        if (ar <= 0) continue;
        const vis = corta(r, v.visibleRect);
        const frac = vis ? (vis.w * vis.h) / ar : 0;
        // 1 % de tolerância: a faixa já vem com folga e o foco é arredondado
        if (frac < 0.99) {
          pior = Math.min(pior, frac);
          const at = Math.max(0, b.startSec - trimIn);
          if (primeiro === null || at < primeiro) primeiro = at;
        }
      }
      if (primeiro !== null) issue({ rule: 'caption_cut', level: 'block', layerId: v.layerId, itemId: null, atSec: r3(primeiro), detail: { visiblePct: Math.round(pior * 100) } });
    }
    let n = 0, ruins = 0, primeiro: number | null = null, pior = 1;
    for (let t = 0; t < layout.durationSec; t += 0.25) {
      const f = rostoEm(guard, t + trimIn);
      if (!f) continue;
      const r = noCanvas(f, guard, v);
      const ar = r.w * r.h;
      if (ar <= 0) continue;
      n++;
      const vis = corta(r, v.visibleRect);
      const frac = vis ? (vis.w * vis.h) / ar : 0;
      if (frac < 0.9) { ruins++; pior = Math.min(pior, frac); if (primeiro === null) primeiro = t; }
    }
    if (n && ruins / n > 0.1) issue({ rule: 'face_cut', level: 'block', layerId: v.layerId, itemId: null, atSec: r3(primeiro ?? 0), detail: { visiblePct: Math.round(pior * 100) } });
  }

  // textos: não coube no piso (block), longo demais (block), número fora da fala/Brain (confirm), contraste baixo (warn)
  const d = docV3De(doc);
  const visivel = new Map(layout.layers.map((l) => [l.id, l.visible]));
  for (const t of textos) {
    if (visivel.get(t.layerId) === false) continue;
    if (!t.fits || (t.fontPx !== null && t.minFontPx !== null && t.fontPx < t.minFontPx - 0.01)) {
      issue({ rule: 'text_overflow', level: 'block', layerId: t.layerId, itemId: t.itemId, atSec: null, detail: { fontPx: t.fontPx ?? undefined, minFontPx: t.minFontPx ?? undefined } });
    }
    const chars = textoVisivel(t.text).length;
    if (t.maxChars !== null && chars > t.maxChars) issue({ rule: 'too_long', level: 'block', layerId: t.layerId, itemId: t.itemId, atSec: null, detail: { chars, maxChars: t.maxChars } });
    if (t.edited) {
      const nums = numerosNaoConfirmados(t.text, facts, d?.confirmations, t.path);
      if (nums.length) issue({ rule: 'invented_number', level: 'confirm', layerId: t.layerId, itemId: t.itemId, atSec: null, detail: { numbers: nums } });
    }
    if (t.contrast && razaoDeContraste(t.contrast.color, t.contrast.background) < 3) issue({ rule: 'low_contrast', level: 'warn', layerId: t.layerId, itemId: t.itemId, atSec: null, detail: null });
  }
  return out;
};

/** Export liberado (§6.2): zero `block` e zero `confirm` pendente. */
export const exportLiberado = (issues: EditIssue[]) => !issues.some((i) => i.level === 'block' || i.level === 'confirm');
