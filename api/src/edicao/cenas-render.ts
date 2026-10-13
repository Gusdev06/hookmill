import type { Scene as SceneRow } from '@prisma/client';
import { num } from '../common/util/format';

type Word = { word: string; startSec: number; endSec: number };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Trecho de clipe que vira uma cena do RenderInput. */
export interface RenderPiece { clipFileId: string | null; durationSec: number | null; words: Word[]; fallbackSec: number }

/**
 * §13.5: fatias consecutivas do MESMO take (TAKE_SLICE, contíguas de 0 ao fim do clipe) viram UMA cena de render:
 * o clipe contínuo inteiro, com as palavras das fatias deslocadas pro tempo do take. Mesmo resultado que cortar
 * por fatia, sem emenda e sem depender de recorte por instante no template. As outras cenas passam como estão.
 * `durationSec` null = usar a duração do arquivo.
 */
export function renderPieces(scenes: Pick<SceneRow, 'pipeline' | 'takeId' | 'takeStartSec' | 'takeEndSec' | 'clipFileId' | 'words' | 'startSec' | 'endSec'>[]): RenderPiece[] {
  const out: RenderPiece[] = [];
  let cur: (RenderPiece & { takeId: string }) | null = null;
  for (const sc of scenes) {
    const words = (Array.isArray(sc.words) ? sc.words : []) as unknown as Word[];
    if (sc.pipeline === 'TAKE_SLICE' && sc.takeId) {
      const off = num(sc.takeStartSec) ?? 0;
      const shifted = words.map((w) => ({ word: w.word, startSec: r3(w.startSec + off), endSec: r3(w.endSec + off) }));
      if (cur && cur.takeId === sc.takeId) {
        cur.words.push(...shifted);
        cur.fallbackSec = num(sc.takeEndSec) ?? cur.fallbackSec;
      } else {
        cur = { takeId: sc.takeId, clipFileId: sc.clipFileId, durationSec: null, words: shifted, fallbackSec: num(sc.takeEndSec) ?? 0 };
        out.push(cur);
      }
      continue;
    }
    cur = null;
    out.push({ clipFileId: sc.clipFileId, durationSec: null, words, fallbackSec: (num(sc.endSec) ?? 0) - (num(sc.startSec) ?? 0) });
  }
  return out.map(({ clipFileId, durationSec, words, fallbackSec }) => ({ clipFileId, durationSec, words, fallbackSec }));
}
