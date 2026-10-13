import type { EditLayer, EditMap, FaceTrackSegment, KeepEditAvailability, KeepEditBlockerHit, Rect } from '@maquina/contratos';

/**
 * Regra de produto do "manter a edição" (§13.1-13.4), dona do backend: junta a trilha do rosto (medicao) e as camadas
 * da visão (ia) num EditMap e decide, por tipo, se dá pra manter a edição — com bloqueio explícito, nunca peça inventada.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

type TrackBlocker = { reason: 'no_face' | 'multiple_faces' | 'low_confidence'; startSec: number | null; endSec: number | null };

/** Dica da visão (informativa): quem fala pra câmera e rostos de b-roll/tela/CCTV. Guardados no EditMap (jsonb) além do contrato. */
export interface SpeakerHints {
  mainSpeaker?: { box: Rect; description: string } | null;
  otherFaces?: { startFrame: number; endFrame: number; box: Rect | null; where: string }[];
}

/** Centro do rosto do trecho (px do vídeo), pelo 1º passo de escala. */
function faceCenter(seg: FaceTrackSegment): { x: number; y: number } | null {
  const s = seg.faceInRegion[0];
  if (!s) return null;
  return { x: seg.region.x + (s.box.x + s.box.w / 2) * seg.region.w, y: seg.region.y + (s.box.y + s.box.h / 2) * seg.region.h };
}

/**
 * Avatar principal = quem fala pra câmera: trechos da trilha cujo rosto cai dentro de `mainSpeaker.box` vencem; os
 * outros (b-roll, tela, CCTV) saem da trilha. Sem dica, ou nenhum trecho dentro dela = trilha da medição intacta.
 */
export function pickMainSpeaker(track: FaceTrackSegment[], hint: SpeakerHints['mainSpeaker']): FaceTrackSegment[] {
  if (!hint?.box) return track;
  const b = hint.box;
  const mine = track.filter((t) => {
    const c = faceCenter(t);
    return !!c && c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h;
  });
  return mine.length ? mine : track;
}

export interface EditMapParts extends SpeakerHints {
  width: number; height: number; fps: number; frameCount: number;
  cells: EditMap['cells'];
  faceTrack: FaceTrackSegment[];
  trackBlockers: TrackBlocker[];
  layers: EditLayer[];
  overlaysOverFace: EditMap['overlaysOverFace'];
  profile: EditMap['profile'];
  /** fim do gancho original (s), da seção hook do teardown */
  hookEndSec: number;
}

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
/** Área que a camada ocupa: o fundo pintado (solid/pill, medido) ou a caixa do texto. */
export const layerArea = (l: EditLayer): Rect => (l.background.kind !== 'none' && l.background.box ? l.background.box : l.box);

/** Texto dentro do fundo medido (a visão erra a caixa por alguns px; o fundo é medido por pixel). */
export function clampRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : { ...b };
}

/** Bloqueios do Trocar avatar: os da trilha + texto que cruza a borda da região + elemento por cima do rosto. */
/** Papel do trecho da trilha (medicao): avatar principal, outra pessoa (convidada) ou b-roll. Ausente = `main` (mapas antigos). */
export type TrackRole = 'main' | 'other_person' | 'broll';
export const roleOf = (t: FaceTrackSegment): TrackRole => ((t as FaceTrackSegment & { role?: TrackRole }).role ?? 'main');
/** Só os trechos do avatar principal: é neles que o rosto novo entra; fora deles o vídeo fica como o original. */
export const mainSegments = (track: FaceTrackSegment[]) => track.filter((t) => roleOf(t) === 'main');

/**
 * Bloqueios do Trocar avatar: só contam DENTRO de trechos `main` (convidada e b-roll ficam como o original e não
 * bloqueiam). Bloqueio da trilha que cruza um trecho main é recortado ao trecho; sem nenhum trecho main = no_face.
 */
export function swapBlockers(p: Pick<EditMapParts, 'fps' | 'faceTrack' | 'trackBlockers' | 'layers' | 'overlaysOverFace'>): KeepEditBlockerHit[] {
  const sec = (f: number) => r3(f / p.fps);
  const main = mainSegments(p.faceTrack);
  if (!main.length) return [{ reason: 'no_face', startSec: null, endSec: null }]; // nenhum trecho do avatar principal
  const out: KeepEditBlockerHit[] = [];
  for (const b of p.trackBlockers) {
    if (b.reason === 'no_face') continue; // já há trecho main
    if (b.startSec == null || b.endSec == null) {
      out.push(b);
      continue;
    }
    for (const seg of main) {
      const a = Math.max(b.startSec, sec(seg.startFrame));
      const e = Math.min(b.endSec, sec(seg.endFrame));
      if (e > a) out.push({ reason: b.reason, startSec: r3(a), endSec: r3(e) });
    }
  }
  for (const seg of main) {
    for (const l of p.layers) {
      if (!overlap(l.startFrame, l.endFrame, seg.startFrame, seg.endFrame)) continue;
      // inteira dentro = redesenhada por cima do rosto novo; inteira fora = fica como está; metade/metade = bloqueio
      const area = layerArea(l);
      if (intersects(area, seg.region) && !inside(area, seg.region)) {
        out.push({ reason: 'caption_straddles_face', startSec: sec(Math.max(l.startFrame, seg.startFrame)), endSec: sec(Math.min(l.endFrame, seg.endFrame)) });
      }
    }
  }
  for (const o of p.overlaysOverFace) if (overlayCoversFace(o, { ...p, faceTrack: main })) out.push({ reason: 'overlay_over_face', startSec: sec(o.startFrame), endSec: sec(o.endFrame) });
  return dedupeBlockers(out);
}

/** Painel vizinho / split-screen / b-roll ao lado: a visão às vezes chama de "overlay", mas não cobre o rosto. */
const SIDE_PANEL = /split|side[- ]by[- ]side|next to|beside|adjacent|neighbou?r|panel (on|to) the (left|right)|left panel|right panel|b-?roll|screen recording|second (panel|column)|ao lado|vizinh|tela dividida|painel (da|à) (esquerda|direita)/i;
/** Fração mínima dos frames do overlay em que ele precisa cobrir o rosto pra bloquear. */
export const OVERLAY_MIN_FRACTION = 0.2;

type Overlay = EditMap['overlaysOverFace'][number] & { box?: Rect | null };

/** Caixa do rosto (px do vídeo) no frame `f`: passo de escala vigente do trecho da trilha. */
function faceBoxAt(track: FaceTrackSegment[], f: number): Rect | null {
  const seg = track.find((t) => f >= t.startFrame && f < t.endFrame);
  if (!seg || !seg.faceInRegion.length) return null;
  const step = [...seg.faceInRegion].sort((a, b) => a.atFrame - b.atFrame).filter((x) => x.atFrame <= f).pop() ?? seg.faceInRegion[0];
  const r = seg.region;
  return { x: r.x + step.box.x * r.w, y: r.y + step.box.y * r.h, w: step.box.w * r.w, h: step.box.h * r.h };
}

/**
 * `overlay_over_face` só bloqueia se o elemento cobre o ROSTO do avatar principal (não a região) numa fração relevante
 * dos frames: com caixa = interseção com a caixa do rosto em ≥ 20 % dos frames do overlay; sem caixa = vale a triagem da
 * ia (overlaysOverFace já vem só com o que cobre o rosto), desde que o intervalo cruze a trilha. Descrição de painel
 * vizinho/split-screen nunca bloqueia (rede de segurança contra o falso positivo do campeão cmuwsqw79000922x2t8gz86v3).
 */
export function overlayCoversFace(o: Overlay, p: Pick<EditMapParts, 'fps' | 'faceTrack' | 'trackBlockers'>): boolean {
  if (SIDE_PANEL.test(o.description ?? '')) return false;
  const total = o.endFrame - o.startFrame;
  if (total <= 0) return false;
  if (o.box) {
    let hit = 0;
    for (let f = o.startFrame; f < o.endFrame; f++) {
      const fb = faceBoxAt(p.faceTrack, f);
      if (fb && intersects(o.box, fb)) hit++;
    }
    return hit / total >= OVERLAY_MIN_FRACTION;
  }
  const a = o.startFrame / p.fps;
  const b = o.endFrame / p.fps;
  // sem caixa: a ia já filtra (só o que é desenhado POR CIMA do rosto do avatar principal) → vale se cruza a trilha
  return p.faceTrack.some((t) => o.startFrame < t.endFrame && t.startFrame < o.endFrame) && a < b;
}

/** Um bloqueio por (motivo, início, fim). */
export function dedupeBlockers(list: KeepEditBlockerHit[]): KeepEditBlockerHit[] {
  const seen = new Set<string>();
  return list.filter((b) => {
    const k = `${b.reason}|${b.startSec}|${b.endSec}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Camada que carrega o texto do gancho: headline/text visível no início do vídeo (antes do fim do gancho). */
export function hookLayerOf(layers: EditLayer[], fps: number, hookEndSec: number): EditLayer | null {
  const end = Math.max(1, Math.round(hookEndSec * fps));
  const cands = layers.filter((l) => l.kind !== 'caption' && l.startFrame < end);
  if (!cands.length) return null;
  // a que aparece primeiro; empate = headline antes de text
  return cands.sort((a, b) => a.startFrame - b.startFrame || (a.kind === 'headline' ? -1 : 1))[0];
}

/** Bloqueios do gancho escrito: só texto direto sobre o vídeo (sem fundo pra pintar por cima) até haver apagador. */
export function hookBlockers(p: Pick<EditMapParts, 'fps' | 'layers' | 'hookEndSec'>): KeepEditBlockerHit[] {
  const l = hookLayerOf(p.layers, p.fps, p.hookEndSec);
  if (l && l.background.kind === 'none') return [{ reason: 'hook_text_over_video', startSec: r3(l.startFrame / p.fps), endSec: r3(l.endFrame / p.fps) }];
  return [];
}

const avail = (blockers: KeepEditBlockerHit[]): KeepEditAvailability => ({ available: blockers.length === 0, blockers });

export function buildEditMap(p: EditMapParts): EditMap & SpeakerHints {
  return {
    ...(p.mainSpeaker !== undefined && { mainSpeaker: p.mainSpeaker }),
    ...(p.otherFaces && { otherFaces: p.otherFaces }),
    version: 1,
    width: p.width, height: p.height, fps: p.fps, frameCount: p.frameCount,
    cells: p.cells,
    faceTrack: p.faceTrack,
    layers: p.layers,
    overlaysOverFace: p.overlaysOverFace,
    profile: p.profile,
    keepEdit: { SWAP_AVATAR: avail(swapBlockers(p)), NEW_HOOKS: avail(hookBlockers(p)) },
  };
}

// ═════════════════════════ §13.15: Trocar avatar com motor (Kling/Seedance) ═════════════════════════

/** Trecho main contíguo (frames da grade do campeão, [start, end)). */
export interface MainSpan { startFrame: number; endFrame: number }

/** Une intervalos contíguos/sobrepostos (ordenados). */
function mergeSpans(list: MainSpan[]): MainSpan[] {
  const out: MainSpan[] = [];
  for (const s of [...list].filter((x) => x.endFrame > x.startFrame).sort((a, b) => a.startFrame - b.startFrame)) {
    const last = out[out.length - 1];
    if (last && s.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, s.endFrame);
    else out.push({ startFrame: s.startFrame, endFrame: s.endFrame });
  }
  return out;
}

/**
 * §13.15.2: trechos = spans `main` contíguos da timeline; mapa antigo sem timeline = os trechos main da trilha unidos
 * quando contíguos em frame. Cada trecho vira 1 cena SWAP_VIDEO.
 */
export function mainSpans(m: Pick<EditMap, 'timeline' | 'faceTrack'>): MainSpan[] {
  const fromTimeline = (m.timeline ?? []).filter((t) => t.kind === 'main');
  return mergeSpans(fromTimeline.length ? fromTimeline : mainSegments(m.faceTrack));
}

/** Maior região (área) dos trechos main da trilha que cruzam o span; null sem trecho. */
export function spanRegion(m: Pick<EditMap, 'faceTrack'>, span: MainSpan): Rect | null {
  const segs = mainSegments(m.faceTrack).filter((t) => overlap(t.startFrame, t.endFrame, span.startFrame, span.endFrame));
  if (!segs.length) return null;
  return segs.map((t) => t.region).reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
}

/**
 * §13.15.1 `caption_unredrawable` (só ENGINE_VOICE): legenda sem fundo cujo intervalo cruza um trecho main e cuja caixa
 * não cai inteira dentro da região — o karaokê queimado no vídeo base mostraria os tempos da voz antiga.
 */
export function captionUnredrawable(m: Pick<EditMap, 'fps' | 'timeline' | 'faceTrack' | 'layers'>): KeepEditBlockerHit[] {
  const sec = (f: number) => r3(f / m.fps);
  const out: KeepEditBlockerHit[] = [];
  const segs = mainSegments(m.faceTrack);
  for (const span of mainSpans(m)) {
    for (const l of m.layers) {
      if (l.kind !== 'caption' || l.background.kind !== 'none') continue;
      const a = Math.max(l.startFrame, span.startFrame);
      const b = Math.min(l.endFrame, span.endFrame);
      if (b <= a) continue;
      // dentro da região de TODO trecho da trilha que ela cruza = redesenhada por cima do rosto novo
      const crossing = segs.filter((t) => overlap(t.startFrame, t.endFrame, a, b));
      const redrawable = crossing.length > 0 && crossing.every((t) => inside(l.box, t.region));
      if (!redrawable) out.push({ reason: 'caption_unredrawable', startSec: sec(a), endSec: sec(b) });
    }
  }
  return dedupeBlockers(out);
}
