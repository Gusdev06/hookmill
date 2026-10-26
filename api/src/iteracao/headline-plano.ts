// HEADLINE e legenda sempre na variação AUTO (headline-e-legenda-v1, aprovado 25/10), lado backend. PURO, testado em
// headline-plano.spec.ts.
//  - `headlineInfoOf`: modo (`replace` com headline no campeão / `add` sem), limites que vão pro Claude
//    (`AutoPlanInput.headline`) e os bloqueios do §1.4 (o plano não oferece; motivo no `allowed`).
//  - `captionsAutoOf`: o campeão não tem legenda queimada (nenhuma camada `caption` cobrindo ≥ 50 % do tempo de fala).
//  - `formatoDoCampeao`: o HEADLINE só existe no aspecto do campeão (§1.5).
import type { EditLayer, EditMap, Rect, TranscriptWord } from '@maquina/contratos';
import type { VideoFormat } from '@prisma/client';
import { headlineDoCampeao } from '../render/headline';

export type HeadlineBlocked = 'headline_over_face' | 'headline_moves' | 'headline_low_confidence' | 'headline_aspect';
export interface HeadlineInfo {
  mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string;
  /** null = pode entrar */
  blockedReason: HeadlineBlocked | null;
  /** o aspecto do campeão (a peça só existe nele) */
  format: VideoFormat | null;
}

/** Fontes do catálogo que o render sabe medir (= `MEDIDA` do api/src/render/headline.ts). */
const FONTES_MEDIDAS = new Set(['inter-800', 'montserrat-800', 'montserrat-900', 'anton-400', 'archivo-black-400', 'oswald-700', 'bebas-neue-400', 'poppins-800', 'roboto-condensed-700']);
export const HEADLINE_MAX_ADD = 60;

const cruza = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Fração dos frames em que `caixa` cobre o rosto principal (faceTrack). */
export function fracaoSobreRosto(m: EditMap, caixa: Rect): number {
  if (!m.frameCount) return 0;
  let n = 0;
  for (const s of m.faceTrack ?? []) {
    if (((s as { role?: string }).role ?? 'main') !== 'main' || !s.faceInRegion?.length) continue;
    const f = s.faceInRegion[0].box;
    const rosto = { x: s.region.x + f.x * s.region.w, y: s.region.y + f.y * s.region.h, w: f.w * s.region.w, h: f.h * s.region.h };
    if (cruza(caixa, rosto)) n += s.endFrame - s.startFrame;
  }
  return n / m.frameCount;
}

/** 9:16 / 4:5 / 1:1 até 3 % de folga; outro aspecto (16:9…) = null (sem HEADLINE: não há formato pra ele). */
export function formatoDoCampeao(width: number, height: number): VideoFormat | null {
  if (!width || !height) return null;
  const r = width / height;
  const perto = (v: number) => Math.abs(r - v) / v <= 0.03;
  return perto(9 / 16) ? 'VERTICAL_9_16' : perto(4 / 5) ? 'PORTRAIT_4_5' : perto(1) ? 'SQUARE_1_1' : null;
}

/** Nº de linhas da original: quebras explícitas, senão pela altura da caixa ÷ altura da linha. */
function linhasDe(l: EditLayer): number {
  const porTexto = (l.text ?? '').split('\n').filter((x) => x.trim()).length;
  const lh = (l.style?.fontSizePx ?? 0) * (l.style?.lineHeight || 1.15);
  const porAltura = lh > 0 ? Math.round(l.box.h / lh) : 1;
  return Math.max(1, porTexto > 1 ? porTexto : porAltura || 1);
}

export function headlineInfoOf(m: EditMap | null, o: { screenLanguage: string; offerLanguage: string; width: number; height: number }): HeadlineInfo {
  const format = formatoDoCampeao(o.width || m?.width || 0, o.height || m?.height || 0);
  const orig = m ? headlineDoCampeao(m) : null;
  if (!orig || !(orig.text ?? '').trim()) {
    return { mode: 'add', original: null, lines: 2, maxChars: HEADLINE_MAX_ADD, hasHighlight: false, language: o.offerLanguage, blockedReason: format ? null : 'headline_aspect', format };
  }
  const original = (orig.text ?? '').replace(/\s+/g, ' ').trim();
  const maxChars = Math.min(90, Math.max(20, Math.round(original.length * 1.2)));
  const base = { mode: 'replace' as const, original, lines: linhasDe(orig), maxChars, hasHighlight: !!orig.style?.highlightColor, language: o.screenLanguage, format };
  let blockedReason: HeadlineBlocked | null = null;
  if (!format) blockedReason = 'headline_aspect';
  else if (!orig.style?.fontId || !FONTES_MEDIDAS.has(orig.style.fontId) || orig.box.w <= 0 || orig.box.h <= 0) blockedReason = 'headline_low_confidence';
  else {
    // muda de caixa no meio do vídeo: outra camada de headline (mesmo critério) com caixa diferente em outro intervalo
    const outras = m!.layers.filter((l) => l !== orig && (l.kind === 'headline' || l.kind === orig.kind) && (l.text ?? '').trim() === (orig.text ?? '').trim());
    const mexe = outras.some((l) => l.box.x !== orig.box.x || l.box.y !== orig.box.y || l.box.w !== orig.box.w || l.box.h !== orig.box.h);
    if (mexe) blockedReason = 'headline_moves';
    else {
      // a área que o render pinta, IGUAL ao buildHeadlineInput (api/src/render/headline.ts): faixa sólida = a caixa da
      // faixa medida (repintada); sobre o vídeo = placa com margem de 2 % da altura do quadro. Bug 26/10 (lote
      // cmvot8qxv000b22xlz0yrm60t): aqui estava 4 % sempre, a placa encostava 5 px no topo do rosto e bloqueava à toa.
      const sobreVideo = orig.background?.kind === 'none' || !orig.background?.color;
      const mg = Math.round(0.02 * m!.height);
      const area = sobreVideo
        ? { x: Math.max(0, orig.box.x - mg), y: Math.max(0, orig.box.y - mg), w: Math.min(m!.width, orig.box.w + 2 * mg), h: orig.box.h + 2 * mg }
        : orig.background.box ?? orig.box;
      if (fracaoSobreRosto(m!, area) > 0.1) blockedReason = 'headline_over_face';
    }
  }
  return { ...base, blockedReason };
}

/** §2.1: true = o campeão não tem legenda queimada (camada `caption` em < 50 % do tempo de fala). Sem fala = false. */
export function captionsAutoOf(m: EditMap | null, words: TranscriptWord[]): boolean {
  if (!words.length) return false;
  const fala = words.reduce((a, w) => a + Math.max(0, w.endSec - w.startSec), 0);
  if (!fala) return false;
  if (!m?.fps) return true;
  const caps = (m.layers ?? []).filter((l) => l.kind === 'caption').map((l) => ({ s: l.startFrame / m.fps, e: l.endFrame / m.fps }));
  const coberta = words.reduce((a, w) => a + (caps.some((c) => w.startSec < c.e && w.endSec > c.s) ? w.endSec - w.startSec : 0), 0);
  return coberta / fala < 0.5;
}
