// Emendas do auto-edit no silêncio de verdade. Os tempos de palavra do Whisper erram 0,1-0,2 s (medido no take de teste:
// "everything," termina em 16,20 no áudio e em 16,36 na transcrição), então um corte "no meio da pausa entre palavras" ainda
// pode pegar o fim de uma sílaba. Antes do render, cada borda interna do timeline vai pro vale de energia mais fundo do
// áudio do campeão a até ±0,3 s dela (janela de 60 ms, envelope de 10 ms). Determinístico: mesmo arquivo, mesmo corte.
import { spawn } from 'node:child_process';

/** §7.1: teaser do COLD-OPEN entre 1,5 e 3,5 s. */
export const TEASER_MIN_SEC = 1.5;

const RATE = 16000, BIN = 0.01, JANELA = 6 /* bins = 60 ms: o corte fica no meio do vale, não na beira */, ALCANCE = 0.3;

/** Envelope RMS (dB) de 10 em 10 ms do áudio do arquivo em [a, b]. */
export async function envelope(ffmpeg: string, arquivo: string, a: number, b: number): Promise<number[]> {
  const pcm: Buffer = await new Promise((ok, err) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(Math.max(0, a)), '-t', String(b - Math.max(0, a)), '-i', arquivo, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']);
    const bufs: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => bufs.push(d));
    p.on('error', err);
    p.on('close', (c) => (c === 0 ? ok(Buffer.concat(bufs)) : err(new Error(`ffmpeg saiu com ${c}`))));
  });
  const x = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const n = Math.round(RATE * BIN);
  const out: number[] = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0;
    for (let k = i; k < i + n; k++) s += x[k] * x[k];
    out.push(20 * Math.log10(Math.sqrt(s / n) / 32768 + 1e-9));
  }
  return out;
}

/** Instante (s) do centro do vale mais silencioso perto de `t` (janela de 60 ms; penalidade leve pela distância: 2 dB a
 *  0,3 s). `minT`/`maxT` restringem o centro (trava de duração mínima). Só aceita vale de silêncio de verdade: ≤ -30 dB ou
 *  12 dB abaixo da mediana do envelope; senão null (a borda fica onde estava). */
export function valeMaisProximo(env: number[], inicioSec: number, t: number, lim: { minT?: number; maxT?: number } = {}): { t: number; db: number } | null {
  const ord = [...env].sort((a, b) => a - b);
  const mediana = ord.length ? ord[ord.length >> 1] : 0;
  const teto = Math.max(-30, mediana - 12);
  let melhor: { t: number; db: number; score: number } | null = null;
  for (let i = 0; i + JANELA <= env.length; i++) {
    const db = env.slice(i, i + JANELA).reduce((a, b) => a + b, 0) / JANELA;
    const centro = inicioSec + (i + JANELA / 2) * BIN;
    if (db > teto) continue;
    if (lim.minT !== undefined && centro < lim.minT - 1e-9) continue;
    if (lim.maxT !== undefined && centro > lim.maxT + 1e-9) continue;
    const score = db + (Math.abs(centro - t) / ALCANCE) * 2;
    if (!melhor || score < melhor.score) melhor = { t: centro, db, score };
  }
  return melhor ? { t: Math.round(melhor.t * 1000) / 1000, db: melhor.db } : null;
}

/**
 * Leva cada borda interna (não a 0 nem a do fim do campeão) pro vale mais silencioso a ±0,3 s. Não inverte a ordem.
 * `minSec[i]` = duração mínima do trecho i (COLD-OPEN: teaser ≥ 1,5 s): o fim só vai pra um vale que respeite o mínimo
 * a partir do começo já encaixado; sem vale assim, tenta com o começo original; sem nenhum, o trecho fica com os tempos
 * originais. Sem mínimo, trecho < 0,2 s depois do encaixe também volta ao original.
 */
export async function emendasNoSilencio(
  ffmpeg: string, arquivo: string, timeline: { startSec: number; endSec: number }[], durationSec: number,
  opts: { minSec?: (number | undefined)[] } = {},
): Promise<{ timeline: { startSec: number; endSec: number }[]; movidas: { de: number; para: number; db: number }[] }> {
  const movidas: { de: number; para: number; db: number }[] = [];
  const interna = (t: number) => t > 0.05 && t < durationSec - 0.05;
  const vale = async (t: number, lim: { minT?: number; maxT?: number } = {}) => {
    const a = Math.max(0, t - ALCANCE - 0.03);
    const env = await envelope(ffmpeg, arquivo, a, Math.min(durationSec, t + ALCANCE + 0.03));
    return valeMaisProximo(env, a, t, lim);
  };
  const out: { startSec: number; endSec: number }[] = [];
  for (const [i, s] of timeline.entries()) {
    const min = Math.max(0.2, opts.minSec?.[i] ?? 0.2);
    const vIni = interna(s.startSec) ? await vale(s.startSec) : null;
    const inicios = vIni ? [{ t: vIni.t, v: vIni }, { t: s.startSec, v: null }] : [{ t: s.startSec, v: null }];
    let escolhido: { startSec: number; endSec: number; mov: typeof movidas } | null = null;
    for (const ini of inicios) {
      const mov = ini.v ? [{ de: s.startSec, para: ini.t, db: Math.round(ini.v.db * 10) / 10 }] : [];
      if (!interna(s.endSec)) {
        if (s.endSec - ini.t >= min) { escolhido = { startSec: ini.t, endSec: s.endSec, mov }; break; }
        continue;
      }
      const vFim = await vale(s.endSec, { minT: ini.t + min });
      if (vFim) { escolhido = { startSec: ini.t, endSec: vFim.t, mov: [...mov, { de: s.endSec, para: vFim.t, db: Math.round(vFim.db * 10) / 10 }] }; break; }
      if (s.endSec - ini.t >= min) { escolhido = { startSec: ini.t, endSec: s.endSec, mov }; break; }
    }
    if (escolhido) { out.push({ startSec: escolhido.startSec, endSec: escolhido.endSec }); movidas.push(...escolhido.mov); }
    else out.push({ ...s });
  }
  return { timeline: out, movidas };
}
