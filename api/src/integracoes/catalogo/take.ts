// §13.5 take contínuo: um TTS do texto inteiro → UMA chamada Pruna → as cenas viram fatias do clipe.
// Aqui moram as contas puras do take: duração, teto de 600 s, aspecto do rosto e o fatiamento (sliceTake).
import type { FaceAspect, TakeSlice, TranscriptWord } from '../contrato';
import { TAKE_MAX_SEC } from '../contrato';
import { IntegracaoError } from '../erros';
import { WORDS_PER_SECOND, countWords } from './precos';
import { gapsOf } from './fatiar';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mid = (w: TranscriptWord) => (w.startSec + w.endSec) / 2;

/** Texto inteiro do take: as falas dos blocos unidas, na ordem (o que vai pro TTS). */
export function takeText(speeches: string[]): string {
  return speeches.map((s) => s.trim()).filter(Boolean).join(' ');
}

/** Segundos estimados do take antes de existir áudio (palavras/s do idioma ou do campeão medido). */
export function takeSecondsFor(text: string, wordsPerSec = WORDS_PER_SECOND): number {
  const wps = wordsPerSec > 0 ? wordsPerSec : WORDS_PER_SECOND;
  return Math.max(1, Math.round((countWords(text) / wps) * 10) / 10);
}

/** Lança LIPSYNC_AUDIO_TOO_LONG { durationSec, maxSec: 600 } quando o áudio passa do teto do Pruna. */
export function assertTakeDuration(durationSec: number): void {
  if (durationSec > TAKE_MAX_SEC) {
    throw new IntegracaoError('LIPSYNC_AUDIO_TOO_LONG', `take audio ${r3(durationSec)} s > ${TAKE_MAX_SEC} s`, { durationSec: r3(durationSec), maxSec: TAKE_MAX_SEC });
  }
}

const ASPECTS: [FaceAspect, number][] = [['1:1', 1], ['3:4', 3 / 4], ['4:3', 4 / 3], ['2:3', 2 / 3], ['3:2', 3 / 2], ['9:16', 9 / 16], ['16:9', 16 / 9]];

/** Aspecto do Soul V2 mais perto (em escala log, pra 1:2 e 2:1 pesarem igual) da região w × h. */
export function faceAspectFor(width: number, height: number): FaceAspect {
  if (!(width > 0 && height > 0)) return '9:16';
  const r = Math.log(width / height);
  let best = ASPECTS[0];
  for (const a of ASPECTS) if (Math.abs(Math.log(a[1]) - r) < Math.abs(Math.log(best[1]) - r)) best = a;
  return best[0];
}

/** Normaliza pra casar fala escrita com fala transcrita: minúsculas, sem acento, sem pontuação. */
export function normToken(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function tokensOf(text: string): string[] {
  return text.split(/\s+/).map(normToken).filter(Boolean);
}

function score(a: string, b: string): number {
  if (a === b) return 2;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 1; // "pra"/"para", plural, número escrito
  return -1;
}

/**
 * Alinhamento global (Needleman-Wunsch) entre os tokens do roteiro (cada um com o bloco dono) e as palavras do take.
 * Devolve, por palavra do take, o bloco do token com que casou (ou -1). Monotônico por construção.
 */
function alignBlocks(script: { tok: string; block: number }[], take: string[]): number[] {
  const n = script.length;
  const m = take.length;
  const GAP = -1;
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  const bt = new Uint8Array((n + 1) * W); // 0 diag, 1 cima (pula token do roteiro), 2 esquerda (pula palavra do take)
  for (let i = 1; i <= n; i++) { dp[i * W] = i * GAP; bt[i * W] = 1; }
  for (let j = 1; j <= m; j++) { dp[j] = j * GAP; bt[j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[(i - 1) * W + j - 1] + score(script[i - 1].tok, take[j - 1]);
      const u = dp[(i - 1) * W + j] + GAP;
      const l = dp[i * W + j - 1] + GAP;
      if (d >= u && d >= l) { dp[i * W + j] = d; bt[i * W + j] = 0; }
      else if (u >= l) { dp[i * W + j] = u; bt[i * W + j] = 1; }
      else { dp[i * W + j] = l; bt[i * W + j] = 2; }
    }
  }
  const owner = new Array<number>(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const b = bt[i * W + j];
    if (b === 0) {
      if (score(script[i - 1].tok, take[j - 1]) > 0) owner[j - 1] = script[i - 1].block;
      i--; j--;
    } else if (b === 1) i--;
    else j--;
  }
  return owner;
}

/**
 * Fatia o take em cenas (§13.5). Fronteira entre o bloco k-1 e o k = meio do silêncio entre a última palavra casada
 * com um bloco < k e a primeira casada com um bloco ≥ k. Bloco sem palavra casada = fronteira proporcional aos
 * caracteres (matched: false). A 1ª fatia começa em 0 e a última termina em durationSec. Puro e determinístico.
 */
export function sliceTake(i: { blocks: { label: string; speech: string }[]; words: TranscriptWord[]; durationSec: number }): TakeSlice[] {
  const blocks = i.blocks;
  if (!blocks.length) throw new IntegracaoError('INVALID_SCRIPT', 'sliceTake: no blocks');
  const dur = Math.max(0, i.durationSec);
  const ws = [...i.words].sort((a, b) => a.startSec - b.startSec);
  const script = blocks.flatMap((b, k) => tokensOf(b.speech).map((tok) => ({ tok, block: k })));
  const owner = alignBlocks(script, ws.map((w) => normToken(w.word)));
  const gaps = gapsOf(ws);

  const chars = blocks.map((b) => b.speech.trim().length);
  const totalChars = chars.reduce((a, c) => a + c, 0);
  const proportional = (k: number) => (totalChars > 0 ? (dur * chars.slice(0, k).reduce((a, c) => a + c, 0)) / totalChars : (dur * k) / blocks.length);

  const bounds: number[] = [0];
  const matched = blocks.map((_, k) => owner.some((o) => o === k));
  for (let k = 1; k < blocks.length; k++) {
    const prev = bounds[k - 1];
    let cut: number | null = null;
    const first = owner.findIndex((o) => o >= k);
    if (matched[k] && first > 0) {
      let last = -1;
      for (let j = first - 1; j >= 0; j--) if (owner[j] >= 0 && owner[j] < k) { last = j; break; }
      if (last >= 0) {
        // palavras soltas entre as duas (não casaram) ficam com a fala anterior: corte no silêncio antes da 1ª do bloco k
        const g = gaps[first - 1];
        cut = g ? g.at : (ws[last].endSec + ws[first].startSec) / 2;
      } else cut = ws[first].startSec / 2; // nada casado antes: bloco anterior sem palavra → metade do respiro inicial
    } else if (matched[k] && first === 0) cut = 0;
    if (cut == null) {
      // proporcional, mas sem invadir palavra já casada com outro bloco
      let lo = 0;
      let hi = dur;
      owner.forEach((o, j) => {
        if (o >= 0 && o < k) lo = Math.max(lo, ws[j].endSec);
        if (o > k && ws[j].startSec < hi) hi = ws[j].startSec;
      });
      cut = proportional(k);
      if (lo <= hi) cut = Math.min(hi, Math.max(lo, cut));
    }
    bounds.push(Math.min(dur, Math.max(prev, cut)));
  }
  bounds.push(dur);

  return blocks.map((b, k) => {
    const a = bounds[k];
    const e = bounds[k + 1];
    const last = k === blocks.length - 1;
    const inside = ws.filter((w) => mid(w) >= a && (last ? mid(w) <= e + 1e-6 : mid(w) < e));
    return {
      index: k,
      label: b.label,
      takeStartSec: r3(a),
      takeEndSec: r3(e),
      speech: b.speech.trim(),
      words: inside.map((w) => ({ word: w.word, startSec: r3(Math.max(0, w.startSec - a)), endSec: r3(Math.max(0, w.endSec - a)) })),
      matched: matched[k],
    };
  });
}
