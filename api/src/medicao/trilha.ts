// Trilha do rosto (§13.1 itens 3-5) e encaixe do clipe novo (§13.3 item 4). Funções puras: entram amostras do YuNet
// e células do layout, sai em que célula o rosto está, frame a frame. O refino das bordas (±2 frames pelo pico de
// diferença da região) precisa decodificar o vídeo e mora no serviço (refineEdge abaixo é a parte pura dele).
import type { FaceTrackSegment, Rect } from '@maquina/contratos';
import { tightestCell } from './celulas';
import type { Face, FaceSample } from './rostos';

/** cellsAlt = a outra ordem da guilhotina (x→y→x); a região é a menor célula, de qualquer das duas, que contém o rosto. */
export interface LayoutFrames { startFrame: number; endFrame: number; cells: Rect[]; cellsAlt?: Rect[] }

/** Contagens por trecho pra o backend aplicar as regras de bloqueio (§13.1 item 5, §13.3 item 6). */
export interface FaceTrackStats {
  startFrame: number; endFrame: number;
  samples: number;
  /** amostras com ≥ 2 rostos (score ≥ minScore) dentro da região */
  multiFaceSamples: number;
  /** amostras do trecho em que o melhor rosto da região ficou abaixo de minScore (ou sumiu) */
  lowConfidenceSamples: number;
}

/** Borda de trecho que caiu entre duas amostras: o frame exato está em [lo, hi] e sai do refino. */
export interface UncertainEdge { segment: number; side: 'start' | 'end'; lo: number; hi: number }

export interface FaceTrackDraft {
  segments: FaceTrackSegment[];
  stats: FaceTrackStats[];
  edges: UncertainEdge[];
  /** outras células com rosto ≥ minScore em ≥ 80 % das amostras (ex.: câmera de segurança com gente): não é a região,
   *  é parte da edição; fica registrado pra quem conferir */
  otherFaceCells: { startFrame: number; endFrame: number; cell: Rect; medianScore: number }[];
}

export interface TrackOptions { minScore: number; maxGapSamples: number; minRunSamples: number; scaleJump: number }
export const DEFAULT_TRACK: TrackOptions = { minScore: 0.8, maxGapSamples: 2, minRunSamples: 2, scaleJump: 0.15 };

const center = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (r: Rect, b: Rect) => { const c = center(b); return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h; };
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function med(v: number[]): number {
  const a = [...v].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Melhor rosto (por SCORE, nunca por área) de uma amostra. */
export function bestFace(faces: Face[], minScore: number, within?: Rect): Face | null {
  let best: Face | null = null;
  for (const f of faces) if (f.score >= minScore && (!within || inside(within, f.box)) && (!best || f.score > best.score)) best = f;
  return best;
}

/** Passos de escala: nova caixa quando a altura do rosto foge > scaleJump da mediana do passo em 2 amostras seguidas. */
export function scaleSteps(points: { frame: number; rel: Rect }[], jump: number): { atFrame: number; box: Rect }[] {
  if (!points.length) return [];
  const groups: { frame: number; rel: Rect }[][] = [[points[0]]];
  let strike = 0;
  for (let i = 1; i < points.length; i++) {
    const g = groups[groups.length - 1];
    const mh = med(g.map((p) => p.rel.h));
    if (Math.abs(points[i].rel.h - mh) / mh > jump) {
      strike++;
      if (strike >= 2) { const moved = g.pop()!; groups.push([moved, points[i]]); strike = 0; continue; }
    } else strike = 0;
    g.push(points[i]);
  }
  return groups.filter((g) => g.length).map((g) => ({
    atFrame: g[0].frame,
    box: { x: r4(med(g.map((p) => p.rel.x))), y: r4(med(g.map((p) => p.rel.y))), w: r4(med(g.map((p) => p.rel.w))), h: r4(med(g.map((p) => p.rel.h))) },
  }));
}

/**
 * Monta a trilha. Por segmento de layout: cada amostra vota na célula do seu melhor rosto; corridas da mesma célula
 * (tolerando `maxGapSamples` amostras sem rosto/outra célula no meio) viram trechos. Bordas que coincidem com borda de
 * segmento de layout já são frame exato; as outras caem entre duas amostras e vão pra `edges` (refino no vídeo).
 */
/**
 * Avatar principal do trecho de layout (regra do Gusta, 06/10: a variação é só de quem fala; os outros rostos são b-roll):
 * rostos ≥ minScore agrupados em trilhas por posição (centro a menos de 0,6 altura de rosto da última aparição); vence a
 * trilha mais PERSISTENTE e MAIOR (nº de amostras × altura mediana). Devolve, por amostra, o rosto do principal (ou null).
 */
/** Cosseno mínimo pra ser a mesma pessoa (SFace: mesma pessoa 0,65-0,97 no podcast; convidada 0,0-0,3; b-roll ≤ 0,2). */
export const SAME_PERSON = 0.45;
const dot = (a: number[], b: number[]) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; };
const norm = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };

/**
 * Identidade do avatar principal no vídeo INTEIRO (rostos ≥ minScore com SFace): agrupa por identidade (cosseno ao
 * centroide ≥ SAME_PERSON) e vence o grupo mais persistente × maior (nº de amostras × altura mediana). null = sem
 * identidade (modelo SFace ausente): a trilha cai pra posição/tamanho por trecho.
 */
export function mainIdentity(samples: FaceSample[], minScore: number): number[] | null {
  type G = { soma: number[]; c: number[]; n: number; hs: number[] };
  const gs: G[] = [];
  for (const s of samples) for (const f of s.faces) {
    if (f.score < minScore || !f.emb) continue;
    let best: G | null = null, bc = SAME_PERSON;
    for (const g of gs) { const c = dot(g.c, f.emb); if (c >= bc) { bc = c; best = g; } }
    if (!best) { best = { soma: new Array(f.emb.length).fill(0), c: f.emb, n: 0, hs: [] }; gs.push(best); }
    best.soma = best.soma.map((v, i) => v + f.emb![i]); best.c = norm(best.soma); best.n++; best.hs.push(f.box.h);
  }
  if (!gs.length) return null;
  gs.sort((a, b) => b.n * med(b.hs) - a.n * med(a.hs));
  return gs[0].c;
}

/** O rosto do principal numa amostra (identidade, se houver; senão null). */
export function mainFaceIn(s: FaceSample, ident: number[]): Face | null {
  let best: Face | null = null, bc = SAME_PERSON;
  for (const f of s.faces) if (f.emb) { const c = dot(ident, f.emb); if (c >= bc) { bc = c; best = f; } }
  return best;
}

export function mainAvatar(S: FaceSample[], minScore: number, ident: number[] | null = null): { faces: (Face | null)[]; others: { faces: (Face | null)[] }[] } {
  type Tr = { last: Face; hs: number[]; faces: (Face | null)[] };
  const trs: Tr[] = [];
  const doPrincipal = ident ? S.map((s) => mainFaceIn(s, ident)) : null;
  S.forEach((s, i) => {
    for (const f of s.faces.filter((x) => x.score >= minScore && (!doPrincipal || x !== doPrincipal[i]))) {
      const c = center(f.box);
      let best: Tr | null = null, bd = Infinity;
      for (const t of trs) {
        if (t.faces[i]) continue;
        const lc = center(t.last.box);
        const d = Math.hypot(c.x - lc.x, c.y - lc.y);
        if (d < 0.6 * med(t.hs) && d < bd) { bd = d; best = t; }
      }
      if (!best) { best = { last: f, hs: [], faces: new Array(S.length).fill(null) }; trs.push(best); }
      best.faces[i] = f; best.last = f; best.hs.push(f.box.h);
    }
  });
  const nota = (t: Tr) => t.hs.length * med(t.hs);
  trs.sort((a, b) => nota(b) - nota(a));
  // com identidade: o principal é quem é (a convidada no mesmo enquadramento e a mulher do b-roll são "outros")
  if (doPrincipal) return { faces: doPrincipal, others: trs };
  if (!trs.length) return { faces: new Array(S.length).fill(null), others: [] };
  return { faces: trs[0].faces, others: trs.slice(1) };
}

/** Caixa do principal dentro de uma célula com outro conteúdo (painel.ts). Recebe a célula e a caixa mediana do rosto. */
export type RefineRegion = (layIndex: number, cell: Rect, face: Rect) => Rect;

export function buildFaceTrack(samples: FaceSample[], layout: LayoutFrames[], frame: { width: number; height: number },
  opt: TrackOptions = DEFAULT_TRACK, refine?: RefineRegion): FaceTrackDraft {
  const segments: FaceTrackSegment[] = [];
  const stats: FaceTrackStats[] = [];
  const edges: UncertainEdge[] = [];
  const otherFaceCells: FaceTrackDraft['otherFaceCells'] = [];
  const ident = mainIdentity(samples, opt.minScore);
  for (const [li, lay] of layout.entries()) {
    const S = samples.filter((s) => s.frame >= lay.startFrame && s.frame < lay.endFrame).sort((a, b) => a.frame - b.frame);
    if (!S.length || !lay.cells.length) continue;
    const all = [...lay.cells, ...(lay.cellsAlt ?? [])];
    const principal = mainAvatar(S, opt.minScore, ident);
    const vote = S.map((_, i) => {
      const b = principal.faces[i];
      if (!b) return -1;
      const c = tightestCell([lay.cells, lay.cellsAlt ?? []], b.box);
      return c ? all.indexOf(c) : -1;
    });
    // corridas
    type Run = { cell: number; i0: number; i1: number };
    const runs: Run[] = [];
    let cur: Run | null = null;
    let gap = 0;
    for (let i = 0; i < S.length; i++) {
      const v = vote[i];
      if (cur && v === cur.cell) { cur.i1 = i; gap = 0; continue; }
      // ponte só sobre amostra SEM outra pessoa (rosto perdido num frame); corte pra convidada nunca vira main
      const outraPessoa = S[i].faces.some((f) => f.score >= opt.minScore && f !== principal.faces[i]);
      if (cur && gap < opt.maxGapSamples && !outraPessoa) {
        // olha à frente: a mesma célula volta dentro da tolerância?
        let back = false;
        for (let j = i; j <= Math.min(S.length - 1, i + opt.maxGapSamples - gap); j++) if (vote[j] === cur.cell) { back = true; break; }
        if (back) { gap++; continue; }
      }
      if (cur) runs.push(cur);
      cur = v >= 0 ? { cell: v, i0: i, i1: i } : null;
      gap = 0;
    }
    if (cur) runs.push(cur);

    for (const run of runs.filter((r) => r.i1 - r.i0 + 1 >= opt.minRunSamples)) {
      let region = all[run.cell];
      const RS = S.slice(run.i0, run.i1 + 1);
      // célula com outro rosto persistente dentro (câmera de segurança no mesmo bloco): a região é o painel do principal
      const mf = principal.faces.slice(run.i0, run.i1 + 1).filter((f): f is Face => !!f);
      const outroDentro = principal.others.some((o) => o.faces.slice(run.i0, run.i1 + 1).filter((f) => f && inside(region, f.box)).length >= 0.5 * RS.length);
      if (refine && outroDentro && mf.length) {
        const fb = { x: med(mf.map((f) => f.box.x)), y: med(mf.map((f) => f.box.y)), w: med(mf.map((f) => f.box.w)), h: med(mf.map((f) => f.box.h)) };
        region = refine(li, region, fb);
      }
      const startFrame = run.i0 === 0 ? lay.startFrame : RS[0].frame;
      const endFrame = run.i1 === S.length - 1 ? lay.endFrame : S[run.i1 + 1].frame;
      const idx = segments.length;
      if (run.i0 > 0) edges.push({ segment: idx, side: 'start', lo: S[run.i0 - 1].frame + 1, hi: RS[0].frame });
      if (run.i1 < S.length - 1) edges.push({ segment: idx, side: 'end', lo: S[run.i1].frame + 1, hi: S[run.i1 + 1].frame });
      const pts: { frame: number; rel: Rect }[] = [];
      let facesMax = 0, multi = 0, low = 0, minScore = 1;
      for (const s of RS) {
        const inRegion = s.faces.filter((f) => f.score >= opt.minScore && inside(region, f.box));
        facesMax = Math.max(facesMax, inRegion.length);
        if (inRegion.length >= 2) multi++;
        const b = bestFace(s.faces, 0, region);
        if (!b || b.score < opt.minScore) low++;
        if (b) minScore = Math.min(minScore, b.score);
        if (b && b.score >= opt.minScore) {
          pts.push({ frame: s.frame, rel: { x: (b.box.x - region.x) / region.w, y: (b.box.y - region.y) / region.h, w: b.box.w / region.w, h: b.box.h / region.h } });
        }
      }
      segments.push({
        startFrame, endFrame, region: { ...region },
        fullFrame: region.x === 0 && region.y === 0 && region.w === frame.width && region.h === frame.height,
        faceInRegion: scaleSteps(pts, opt.scaleJump),
        facesMax, minScore: Math.round(minScore * 1000) / 1000,
      });
      stats.push({ startFrame, endFrame, samples: RS.length, multiFaceSamples: multi, lowConfidenceSamples: low });
    }

    // outras células com rosto persistente (não são a região: ficam intactas, mas o QA quer saber)
    const chosen = new Set(runs.map((r) => r.cell));
    lay.cells.forEach((c, ci) => {
      if ([...chosen].some((k) => sameRect(all[k], c))) return;
      const sc = S.map((s) => bestFace(s.faces, opt.minScore, c)?.score ?? null).filter((x): x is number => x !== null);
      if (sc.length >= 0.8 * S.length) otherFaceCells.push({ startFrame: lay.startFrame, endFrame: lay.endFrame, cell: { ...c }, medianScore: med(sc) });
    });
  }
  // trechos vizinhos na mesma célula (corte de conteúdo sem mudar a caixa) viram um só
  for (let i = segments.length - 1; i > 0; i--) {
    const a = segments[i - 1], b = segments[i];
    if (a.endFrame === b.startFrame && sameRect(a.region, b.region) && !edges.some((e) => e.segment === i - 1 && e.side === 'end')) {
      a.endFrame = b.endFrame;
      a.faceInRegion = [...a.faceInRegion, ...b.faceInRegion];
      a.facesMax = Math.max(a.facesMax, b.facesMax);
      a.minScore = Math.min(a.minScore, b.minScore);
      stats[i - 1] = { ...stats[i - 1], endFrame: b.endFrame, samples: stats[i - 1].samples + stats[i].samples,
        multiFaceSamples: stats[i - 1].multiFaceSamples + stats[i].multiFaceSamples, lowConfidenceSamples: stats[i - 1].lowConfidenceSamples + stats[i].lowConfidenceSamples };
      segments.splice(i, 1);
      stats.splice(i, 1);
      for (const e of edges) if (e.segment >= i) e.segment--;
    }
  }
  return { segments, stats, edges, otherFaceCells };
}

/**
 * Contagens do trecho a partir da 2ª passada do YuNet RECORTADA na região (resolução cheia ou ampliada: no quadro
 * inteiro reduzido pra 640 um rosto borrado ganha nitidez e passa de 0,8; recortado ele fica em ~0,5, que é o real).
 * multiple_faces também conta rosto de tamanho parecido FORA da região (≥ 60 % da altura do rosto dela, score ≥ minScore):
 * é outra pessoa protagonista (dois rostos lado a lado), não gente pequena num painel (câmera de segurança: 0,44).
 */
export function regionStats(seg: FaceTrackSegment, crop: FaceSample[], full: FaceSample[], minScore = 0.8):
  Pick<FaceTrackStats, 'samples' | 'multiFaceSamples' | 'lowConfidenceSamples'> & { facesMax: number; minScore: number } {
  const inSeg = (s: FaceSample) => s.frame >= seg.startFrame && s.frame < seg.endFrame;
  const C = crop.filter(inSeg);
  const F = new Map(full.filter(inSeg).map((s) => [s.frame, s]));
  let multi = 0, low = 0, facesMax = 0, minS = 1;
  for (const s of C) {
    const strong = s.faces.filter((f) => f.score >= minScore);
    const best = bestFace(s.faces, 0);
    facesMax = Math.max(facesMax, strong.length);
    if (!best || best.score < minScore) low++;
    if (best) minS = Math.min(minS, best.score);
    let outros = 0;
    const fs = F.get(s.frame);
    if (fs && best) {
      const mainH = best.box.h;
      outros = fs.faces.filter((f) => f.score >= minScore && !inside(seg.region, f.box) && f.box.h >= 0.6 * mainH).length;
    }
    if (strong.length >= 2 || (strong.length >= 1 && outros >= 1)) multi++;
    facesMax = Math.max(facesMax, strong.length + outros);
  }
  return { samples: C.length, multiFaceSamples: multi, lowConfidenceSamples: low, facesMax, minScore: Math.round(minS * 1000) / 1000 };
}

export type TrackKind = 'main' | 'other_person' | 'broll';
/**
 * Classificação do vídeo inteiro no tempo (regra do Gusta 07/10): `main` = trechos da trilha (o principal visível, vira
 * região de troca); fora deles, `other_person` (outra pessoa ≥ minScore na amostra: convidada, mulher do b-roll) ou
 * `broll` (sem rosto: tela, insert). Só `main` gera bloqueio.
 */
export function timeline(segments: FaceTrackSegment[], samples: FaceSample[], frameCount: number, minScore = 0.8):
  { startFrame: number; endFrame: number; kind: TrackKind }[] {
  const out: { startFrame: number; endFrame: number; kind: TrackKind }[] = [];
  const main = [...segments].sort((a, b) => a.startFrame - b.startFrame);
  const buraco = (a: number, b: number) => {
    if (b <= a) return;
    const S = samples.filter((s) => s.frame >= a && s.frame < b);
    const kinds = S.map((s) => (s.faces.some((f) => f.score >= minScore) ? 'other_person' : 'broll') as TrackKind);
    let ini = a, cur: TrackKind | null = kinds[0] ?? 'broll';
    for (let i = 1; i < S.length; i++) {
      if (kinds[i] !== cur && (kinds[i + 1] === kinds[i] || i === S.length - 1)) { out.push({ startFrame: ini, endFrame: S[i].frame, kind: cur! }); ini = S[i].frame; cur = kinds[i]; }
    }
    out.push({ startFrame: ini, endFrame: b, kind: cur ?? 'broll' });
  };
  let t = 0;
  for (const m of main) { buraco(t, m.startFrame); out.push({ startFrame: m.startFrame, endFrame: m.endFrame, kind: 'main' }); t = m.endFrame; }
  buraco(t, frameCount);
  // vizinhos do mesmo tipo viram um só
  const juntos: typeof out = [];
  for (const x of out) { const u = juntos[juntos.length - 1]; if (u && u.kind === x.kind && u.endFrame === x.startFrame && x.kind !== 'main') u.endFrame = x.endFrame; else juntos.push({ ...x }); }
  return juntos;
}

/**
 * Parte pura do refino: `diffs[k]` = diferença média da região entre o frame (lo-2+k) e o anterior. O 1º frame do
 * conteúdo novo é o do maior salto (argmax, nunca limiar absoluto).
 */
export function refineEdge(lo: number, diffs: number[]): number {
  let best = 0;
  for (let k = 1; k < diffs.length; k++) if (diffs[k] > diffs[best]) best = k;
  return lo - 2 + best;
}

/** Regras de bloqueio que dá pra tirar só da trilha (as que dependem das camadas de texto são do backend). */
export function trackBlockers(draft: FaceTrackDraft, fps: number): { reason: 'no_face' | 'multiple_faces' | 'low_confidence'; startSec: number | null; endSec: number | null }[] {
  if (!draft.segments.length) return [{ reason: 'no_face', startSec: null, endSec: null }];
  const out: { reason: 'multiple_faces' | 'low_confidence'; startSec: number; endSec: number }[] = [];
  draft.stats.forEach((s) => {
    const t = { startSec: Math.round((s.startFrame / fps) * 1000) / 1000, endSec: Math.round((s.endFrame / fps) * 1000) / 1000 };
    if (s.multiFaceSamples > 0.1 * s.samples) out.push({ reason: 'multiple_faces', ...t });
    if (s.lowConfidenceSamples > 0.2 * s.samples) out.push({ reason: 'low_confidence', ...t });
  });
  // trechos colados com o mesmo motivo viram um bloqueio só (2 rostos lado a lado alternam a região a cada poucos s)
  out.sort((a, b) => a.reason.localeCompare(b.reason) || a.startSec - b.startSec);
  const juntos: typeof out = [];
  for (const b of out) {
    const u = juntos[juntos.length - 1];
    if (u && u.reason === b.reason && b.startSec <= u.endSec + 1e-6) u.endSec = Math.max(u.endSec, b.endSec);
    else juntos.push({ ...b });
  }
  return juntos;
}

/**
 * Recorte do clipe novo pra uma região (§13.3 item 4): a altura do rosto no recorte = a do original na região
 * (`faceInRegion.h`), o rosto na mesma posição relativa do original, sempre cobrindo a região inteira (o recorte tem o
 * aspecto da região e fica dentro do clipe; se o rosto do clipe for pequeno demais pra caber, o recorte cresce até o
 * limite do clipe e o rosto sai um pouco menor que o original, nunca com barra).
 */
export function fitCrop(clip: { w: number; h: number }, clipFace: Rect, region: { w: number; h: number }, faceInRegion: Rect): Rect {
  const aspect = region.w / region.h;
  let h = clipFace.h / Math.max(0.01, faceInRegion.h);
  let w = h * aspect;
  const maxScale = Math.min(clip.w / w, clip.h / h, Infinity);
  if (maxScale < 1) { w *= maxScale; h *= maxScale; }
  const fc = center(clipFace);
  // centro do rosto do original, relativo à região
  const relCx = faceInRegion.x + faceInRegion.w / 2, relCy = faceInRegion.y + faceInRegion.h / 2;
  let x = fc.x - relCx * w, y = fc.y - relCy * h;
  x = Math.min(Math.max(0, x), clip.w - w);
  y = Math.min(Math.max(0, y), clip.h - h);
  const rd = (v: number) => Math.round(v * 100) / 100;
  return { x: rd(x), y: rd(y), w: rd(w), h: rd(h) };
}

export { sameRect };
