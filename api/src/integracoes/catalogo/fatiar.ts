// Fatiamento do campeão em cenas (feature 2, §5): os blocos do teardown viram cenas cortadas SEMPRE no meio do
// silêncio entre duas palavras, nunca no meio de uma palavra; bloco maior que o limite do modelo (Pruna: 30 s)
// vira 2+ cenas, cada corte no silêncio mais perto do ponto ideal. Puro e determinístico.
import type { TranscriptWord } from '../contrato';

export interface SourceScene {
  index: number;
  label: string;
  sourceStartSec: number;
  sourceEndSec: number;
  speech: string;
  /** Palavras da cena com tempo RELATIVO ao início da cena (sourceStartSec), prontas pra legenda (§5.1). */
  words: TranscriptWord[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mid = (w: TranscriptWord) => (w.startSec + w.endSec) / 2;

/** Silêncios entre palavras consecutivas: [fim da palavra i, início da i+1]. */
export function gapsOf(words: TranscriptWord[]): { a: number; b: number; at: number }[] {
  const out: { a: number; b: number; at: number }[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i].endSec;
    const b = Math.max(a, words[i + 1].startSec);
    out.push({ a, b, at: (a + b) / 2 });
  }
  return out;
}

/** Janela (s) em volta do ponto pedido onde se procura o melhor silêncio. */
export const SNAP_WINDOW_SEC = 1;

/**
 * Corte válido perto de `t`: entre os silêncios com o meio em (lo, hi) e a até SNAP_WINDOW_SEC de `t`, o MAIS LONGO
 * (respiro natural, fim de frase; empate = o mais perto). Nenhum na janela: o silêncio de meio mais próximo.
 * Sem silêncio no intervalo: o próprio `t`.
 */
export function snapCut(t: number, gaps: { a: number; b: number; at: number }[], lo: number, hi: number): number {
  const ok = gaps.filter((g) => g.at > lo + 1e-6 && g.at < hi - 1e-6);
  if (!ok.length) return t;
  const near = ok.filter((g) => Math.abs(g.at - t) <= SNAP_WINDOW_SEC);
  const pool = near.length ? near : ok;
  let best = pool[0];
  for (const g of pool) {
    const len = g.b - g.a;
    const blen = best.b - best.a;
    if (near.length) {
      if (len > blen + 1e-6 || (Math.abs(len - blen) <= 1e-6 && Math.abs(g.at - t) < Math.abs(best.at - t))) best = g;
    } else if (Math.abs(g.at - t) < Math.abs(best.at - t)) best = g;
  }
  return best.at;
}

export function splitSourceScenes(
  words: TranscriptWord[],
  blocks: { label: string; startSec: number; endSec: number }[],
  maxSceneSec: number,
): SourceScene[] {
  const sorted = blocks.filter((b) => b.endSec > b.startSec).sort((a, b) => a.startSec - b.startSec);
  if (!sorted.length) return [];
  const ws = [...words].sort((a, b) => a.startSec - b.startSec);
  const gaps = gapsOf(ws);
  const start = sorted[0].startSec;
  const end = sorted[sorted.length - 1].endSec;

  // 1. fronteiras entre blocos encaixadas num silêncio (monotônicas)
  const bounds = [start];
  for (let i = 1; i < sorted.length; i++) {
    const prev = bounds[bounds.length - 1];
    const c = snapCut(sorted[i].startSec, gaps, prev, end);
    bounds.push(c > prev ? c : Math.max(prev, sorted[i].startSec));
  }
  bounds.push(end);

  // 2. cada bloco; o que passa do limite é dividido em partes iguais, cada corte no silêncio mais próximo
  const ranges: { label: string; a: number; b: number }[] = [];
  sorted.forEach((blk, i) => {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (!(b > a)) return; // bloco engolido pelo vizinho (sem palavra própria)
    const parts = Math.max(1, Math.ceil((b - a) / maxSceneSec - 1e-9));
    let from = a;
    for (let p = 1; p < parts; p++) {
      const ideal = a + ((b - a) * p) / parts;
      // corte precisa deixar a parte atual ≤ limite e sobrar espaço pras próximas
      const hi = Math.min(from + maxSceneSec, b);
      let cut = snapCut(ideal, gaps, from, hi);
      if (!(cut > from && cut - from <= maxSceneSec + 1e-6)) cut = Math.min(ideal, from + maxSceneSec);
      ranges.push({ label: blk.label, a: from, b: cut });
      from = cut;
    }
    ranges.push({ label: blk.label, a: from, b });
  });

  // 3. palavras de cada cena pelo meio da palavra (corte no silêncio = nenhuma palavra fica dividida)
  return ranges.map((r, index) => {
    const last = index === ranges.length - 1;
    const inside = ws.filter((w) => mid(w) >= r.a && (last ? mid(w) <= r.b : mid(w) < r.b));
    return {
      index,
      label: r.label,
      sourceStartSec: r3(r.a),
      sourceEndSec: r3(r.b),
      speech: inside.map((w) => w.word).join(' '),
      words: inside.map((w) => ({ word: w.word, startSec: r3(Math.max(0, w.startSec - r.a)), endSec: r3(Math.max(0, w.endSec - r.a)) })),
    };
  });
}
