// HEADLINE e legenda sempre na variação AUTO (headline-e-legenda-v1, aprovado 25/10), lado backend. PURO, testado em
// headline-plano.spec.ts.
//  - `headlineInfoOf`: modo (`replace` com headline no campeão / `add` sem), limites que vão pro Claude
//    (`AutoPlanInput.headline`) e o bloqueio (o plano não oferece; motivo no `allowed`). Sem `plateImpl` (ou `off`) = F1a:
//    `replace` = `headline_pending`. Com a troca ligada (troca-texto-queimado-v1 §16.5, F1b): alvo = 1ª camada no tempo, e a
//    decisão sai do `editMap.headlineLook` medido e da linha vigente de `champion_plates`.
//  - `captionsAutoOf`: o campeão não tem legenda queimada (nenhuma camada `caption` cobrindo ≥ 50 % do tempo de fala).
//  - `formatoDoCampeao`: o HEADLINE só existe no aspecto do campeão (§1.5).
import type { EditLayer, EditMap, HeadlineCopyKind, HeadlineFitLook, HeadlineFitResult, HeadlineFitStep, HeadlineLook, HeadlineLookReason, TranscriptWord } from '@maquina/contratos';
import { ajustarHeadlineCopia } from '@maquina/video';
import type { VideoFormat } from '@prisma/client';
import { escolherAlvo } from '../medicao/troca/look';
import { headlineDoCampeao } from '../render/headline';

export type HeadlineBlocked = 'headline_over_face' | 'headline_moves' | 'headline_low_confidence' | 'headline_aspect' | 'headline_pending'
  | 'headline_near_caption' | 'headline_font_far' | 'headline_plate_rejected' | 'headline_no_fit';
/** §16.5: a linha vigente de `champion_plates` (kind HEADLINE, layerKey = look.layerId, version = HEADLINE_PLATE_VERSION). */
export interface HeadlinePlateState { status: 'QUEUED' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED'; reason: string | null; version: number }
export type PlateImplMode = 'off' | 'local' | 'lambda';
export interface HeadlineInfo {
  mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string;
  /** null = pode entrar */
  blockedReason: HeadlineBlocked | null;
  /** o aspecto do campeão (a peça só existe nele) */
  format: VideoFormat | null;
  /** §16.5: `box`/`loose` = cópia medida; `add` = faixa nova; null = `replace` sem medida (F1a ou ainda não medido) */
  copy: HeadlineCopyKind | 'add' | null;
  /** a medida do texto antigo (`editMap.headlineLook`), só no `replace` medido */
  look: HeadlineLook | null;
  /** true: o chamador mede (`TrocaTextoPort.medirHeadline`), grava no editMap e chama de novo */
  needsMeasure: boolean;
  /** true: `loose` sem placa READY; o chamador enfileira o CHAMPION_PLATE e espera (blockedReason fica null) */
  needsPlate: boolean;
}

/** §16.5: `verdict.reason` da medida → motivo do `allowed`. */
export const LOOK_REASON_BLOCK: Record<HeadlineLookReason, HeadlineBlocked> = {
  not_measured: 'headline_low_confidence', text_not_light: 'headline_low_confidence', emoji_unsupported: 'headline_low_confidence',
  no_box: 'headline_low_confidence', low_contrast: 'headline_low_confidence',
  box_moves: 'headline_moves', fades: 'headline_moves', text_changes: 'headline_moves',
  over_face: 'headline_over_face', near_caption: 'headline_near_caption', font_far: 'headline_font_far',
  plate_rejected: 'headline_plate_rejected', plate_failed: 'headline_pending',
};

/** A camada que o `replace` troca: com a troca ligada, a 1ª no tempo (§15.5.2, conserta o 06); desligada, a regra do F1a. */
export function camadaAlvo(m: EditMap, plateImpl: PlateImplMode = 'off'): EditLayer | null {
  return plateImpl === 'off' ? headlineDoCampeao(m) : escolherAlvo(m);
}

export const HEADLINE_MAX_ADD = 60;

/** 9:16 / 4:5 / 1:1 até 3 % de folga; 3:4 conta como 4:5 (decisão do Gusta 07/11, Q1-B2: a peça sai no tamanho do
 *  campeão e o feed do Meta corta pra 4:5); outro aspecto (16:9…) = null (sem HEADLINE: não há formato pra ele). */
export function formatoDoCampeao(width: number, height: number): VideoFormat | null {
  if (!width || !height) return null;
  const r = width / height;
  const perto = (v: number) => Math.abs(r - v) / v <= 0.03;
  return perto(9 / 16) ? 'VERTICAL_9_16' : perto(4 / 5) || perto(3 / 4) ? 'PORTRAIT_4_5' : perto(1) ? 'SQUARE_1_1' : null;
}

/** Nº de linhas da original: quebras explícitas, senão pela altura da caixa ÷ altura da linha. */
function linhasDe(l: EditLayer): number {
  const porTexto = (l.text ?? '').split('\n').filter((x) => x.trim()).length;
  const lh = (l.style?.fontSizePx ?? 0) * (l.style?.lineHeight || 1.15);
  const porAltura = lh > 0 ? Math.round(l.box.h / lh) : 1;
  return Math.max(1, porTexto > 1 ? porTexto : porAltura || 1);
}

export function headlineInfoOf(m: EditMap | null, o: {
  screenLanguage: string; offerLanguage: string; width: number; height: number;
  /** ausente = 'off' (F1a). O chamador passa 'off' também quando o workspace está fora de PLATE_WORKSPACE_IDS */
  plateImpl?: PlateImplMode;
  /** linha vigente de champion_plates (só conta no `loose`) */
  plate?: HeadlinePlateState | null;
}): HeadlineInfo {
  const impl = o.plateImpl ?? 'off';
  const format = formatoDoCampeao(o.width || m?.width || 0, o.height || m?.height || 0);
  const orig = m ? camadaAlvo(m, impl) : null;
  const nada = { look: null, needsMeasure: false, needsPlate: false };
  if (!orig || !(orig.text ?? '').trim()) {
    return { mode: 'add', original: null, lines: 2, maxChars: HEADLINE_MAX_ADD, hasHighlight: false, language: o.offerLanguage, blockedReason: format ? null : 'headline_aspect', format, copy: 'add', ...nada };
  }
  const original = (orig.text ?? '').replace(/\s+/g, ' ').trim();
  const maxChars = Math.min(90, Math.max(20, Math.round(original.length * 1.2)));
  const base = { mode: 'replace' as const, original, lines: linhasDe(orig), maxChars, hasHighlight: !!orig.style?.highlightColor, language: o.screenLanguage, format };
  // §16.5, ordem da decisão: aspecto → troca desligada (F1a) → sem medida → veredito → placa
  if (!format) return { ...base, blockedReason: 'headline_aspect', copy: null, ...nada };
  if (impl === 'off') return { ...base, blockedReason: 'headline_pending', copy: null, ...nada };
  const look = m?.headlineLook;
  if (!look || look.version !== 2 || look.layerId !== orig.id) return { ...base, blockedReason: 'headline_pending', copy: null, ...nada, needsMeasure: true };
  const medido = { ...base, lines: Math.max(1, look.fit.originalLines.length || base.lines), hasHighlight: base.hasHighlight || look.emphasis !== null, copy: look.kind, look };
  if (!look.verdict.ok || look.verdict.reason) {
    return { ...medido, blockedReason: LOOK_REASON_BLOCK[look.verdict.reason ?? 'not_measured'] ?? 'headline_low_confidence', needsMeasure: false, needsPlate: false };
  }
  if (look.font.tier === 'far') return { ...medido, blockedReason: 'headline_font_far', needsMeasure: false, needsPlate: false };
  if (look.kind === 'loose') {
    const p = o.plate ?? null;
    if (!p || p.status === 'QUEUED' || p.status === 'RUNNING') return { ...medido, blockedReason: null, needsMeasure: false, needsPlate: true };
    if (p.status === 'REJECTED') return { ...medido, blockedReason: 'headline_plate_rejected', needsMeasure: false, needsPlate: false };
    if (p.status === 'FAILED') return { ...medido, blockedReason: 'headline_pending', needsMeasure: false, needsPlate: false };
  }
  return { ...medido, blockedReason: null, needsMeasure: false, needsPlate: false };
}

/** No AUTO_PLAN, depois da espera da §16.5: placa que não ficou pronta = `headline_pending` neste lote. */
export function semEsperarPlaca(h: HeadlineInfo): HeadlineInfo {
  return h.needsPlate ? { ...h, blockedReason: 'headline_pending' } : h;
}

/** O `replace` copiado do criativo (§16.5): medido e oferecido como `box` ou `loose`. */
export const ehCopia = (h: Pick<HeadlineInfo, 'mode' | 'copy' | 'look'> | null | undefined): h is HeadlineInfo & { look: HeadlineLook } =>
  !!h && h.mode === 'replace' && (h.copy === 'box' || h.copy === 'loose') && !!h.look;

/** A medida do texto novo (`ajustarHeadlineCopia`), igual no plano, no PATCH, no build e no web. */
export function medirTexto(look: HeadlineLook, text: string): HeadlineFitResult {
  return ajustarHeadlineCopia(look.fit, text);
}

/** "E 0.33 > 0.15", "chin gap 12 px", "does not fit 3 lines at 90 %": a medida legível (IA e `detail` do 422). */
export function medidaLegivel(r: HeadlineFitResult, maxLines: number): string {
  if (r.reject === 'too_short') return `exposure ${r.exposure.toFixed(2)} > 0.15 (part of the old text area stays uncovered)`;
  if (r.reject === 'over_chin') return `chin gap ${r.chinGapPx ?? 0} px (the text reaches the face)`;
  if (r.reject === 'too_long') return `does not fit ${maxLines + 1} lines at 90 % of the original size`;
  return `fits (${r.step ?? 'same'})`;
}

/** Params da peça HEADLINE no `replace` copiado (§16.5): `copy`, `fontTier` (`far` nunca chega), `fitStep` e `fit`. */
export function headlineCopyParams(h: HeadlineInfo | null, text: string): { copy?: HeadlineCopyKind; fontTier?: 'same' | 'close'; fitStep?: HeadlineFitStep | null; fit?: HeadlineFitLook } {
  if (!ehCopia(h)) return {};
  const tier = h.look.font.tier === 'close' ? 'close' : 'same';
  let step: HeadlineFitStep | null = null;
  try { step = medirTexto(h.look, text).step; } catch { step = null; }
  return { copy: h.look.kind, fontTier: tier, fitStep: step, fit: h.look.fit };
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
