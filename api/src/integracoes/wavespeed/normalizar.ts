// Status e erros da WaveSpeed → contrato (eventos.md §3), e a saída do Whisper → palavras com tempo.
import type { ProviderTaskStatus } from '../portas';
import { isContentRefusal, type WsPrediction } from './cliente';

export type Final = Exclude<ProviderTaskStatus, 'SUBMITTED'>;

/** null = ainda rodando (created/processing). */
export function finalStatus(p: Pick<WsPrediction, 'status' | 'error'>): { status: Final; errorCode: string | null } | null {
  switch (p.status) {
    case 'completed':
      return { status: 'COMPLETED', errorCode: null };
    case 'failed':
      return { status: 'FAILED', errorCode: isContentRefusal(p.error) ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR' };
    case 'timeout':
      return { status: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' };
    case 'cancelled':
    case 'deleted':
      return { status: 'CANCELLED', errorCode: 'CANCELLED' };
    default:
      return null;
  }
}

export interface Word {
  word: string;
  startSec: number;
  endSec: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function startOf(o: Record<string, unknown>): number | null {
  if (Array.isArray(o.timestamp)) return num(o.timestamp[0]);
  return num(o.start ?? o.start_time ?? o.startSec ?? o.begin);
}
function endOf(o: Record<string, unknown>): number | null {
  if (Array.isArray(o.timestamp)) return num(o.timestamp[1]);
  return num(o.end ?? o.end_time ?? o.endSec ?? o.stop);
}
function textOf(o: Record<string, unknown>): string | null {
  const t = o.word ?? o.text ?? o.token;
  return typeof t === 'string' ? t : null;
}

/** Espalha as palavras de um trecho igualmente entre início e fim (trecho sem tempo por palavra). */
export function spread(text: string, start: number, end: number): Word[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const step = Math.max(0, end - start) / words.length;
  return words.map((word, i) => ({ word, startSec: r3(start + i * step), endSec: r3(start + (i + 1) * step) }));
}

function collectArrays(v: unknown, out: Record<string, unknown>[][], depth = 0) {
  if (depth > 6 || v == null) return;
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) out.push(v as Record<string, unknown>[]);
    for (const x of v) collectArrays(x, out, depth + 1);
  } else if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) collectArrays(x, out, depth + 1);
  }
}

function plainText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).text === 'string') return (v as Record<string, string>).text;
  return null;
}

/**
 * Palavras com tempo a partir da saída do Whisper, tolerante ao formato (a página do modelo não documenta a forma
 * com enable_timestamps; a sonda G3 confirma). Ordem de preferência:
 *   1. lista de palavras com tempo ({word|text, start, end} ou {text, timestamp:[s,e]});
 *   2. segmentos com tempo: palavras espalhadas dentro de cada segmento;
 *   3. só texto: espalhado na duração da mídia (fallbackSec).
 */
export function extractWords(output: unknown, fallbackSec: number): { words: Word[]; source: 'words' | 'segments' | 'text' | 'none' } {
  let parsed: unknown = output;
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = output;
    }
  }
  const arrays: Record<string, unknown>[][] = [];
  collectArrays(parsed, arrays);
  const timed = arrays.filter((a) => a.every((o) => textOf(o) !== null && startOf(o) !== null && endOf(o) !== null));

  // Todas as listas de palavras, não só a 1ª: o Whisper da WaveSpeed devolve `text_details[].words`, uma lista
  // por segmento (sonda G3, 05/10). Junta, tira duplicata (lista de topo repetindo os segmentos) e ordena.
  const wordLists = timed.filter((a) => a.every((o) => !/\s/.test(textOf(o)!.trim())));
  if (wordLists.length) {
    const seen = new Set<string>();
    const words = wordLists
      .flat()
      .map((o) => ({ word: textOf(o)!.trim(), startSec: r3(startOf(o)!), endSec: r3(endOf(o)!) }))
      .filter((w) => w.word && !seen.has(`${w.startSec}|${w.word}`) && seen.add(`${w.startSec}|${w.word}`))
      .sort((a, b) => a.startSec - b.startSec);
    return { words, source: 'words' };
  }
  const segments = timed[0];
  if (segments) return { words: segments.flatMap((o) => spread(textOf(o)!, startOf(o)!, endOf(o)!)), source: 'segments' };

  const text = plainText(parsed);
  if (text?.trim()) return { words: spread(text, 0, fallbackSec), source: 'text' };
  return { words: [], source: 'none' };
}
