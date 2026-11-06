// HEADLINE e legenda sempre na variação AUTO (headline-e-legenda-v1, aprovado 25/10), lado backend. PURO, testado em
// headline-plano.spec.ts.
//  - `headlineInfoOf`: modo (`replace` com headline no campeão / `add` sem), limites que vão pro Claude
//    (`AutoPlanInput.headline`) e o bloqueio (o plano não oferece; motivo no `allowed`). No F1a, `replace` = `headline_pending`.
//  - `captionsAutoOf`: o campeão não tem legenda queimada (nenhuma camada `caption` cobrindo ≥ 50 % do tempo de fala).
//  - `formatoDoCampeao`: o HEADLINE só existe no aspecto do campeão (§1.5).
import type { EditLayer, EditMap, TranscriptWord } from '@maquina/contratos';
import type { VideoFormat } from '@prisma/client';
import { headlineDoCampeao } from '../render/headline';

export type HeadlineBlocked = 'headline_over_face' | 'headline_moves' | 'headline_low_confidence' | 'headline_aspect' | 'headline_pending';
export interface HeadlineInfo {
  mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string;
  /** null = pode entrar */
  blockedReason: HeadlineBlocked | null;
  /** o aspecto do campeão (a peça só existe nele) */
  format: VideoFormat | null;
}

export const HEADLINE_MAX_ADD = 60;

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
  // troca-texto-queimado-v1 §15.4 (F1a): sem placa e sem a medida antiga, o `replace` não é oferecido até o F1b.
  const blockedReason: HeadlineBlocked = format ? 'headline_pending' : 'headline_aspect';
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
