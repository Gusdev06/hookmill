// §13.15.4 (B) ENGINE_VOICE no remix-keep: áudio montado (campeão com os trechos main trocados pela voz do motor) e
// palavras da legenda mescladas (transcrição nova dentro dos trechos, teardown fora). Sem regra de negócio.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface AudioSplice { spans: { startFrame: number; endFrame: number; url: string }[]; fadeMs: number }
export interface PalavraSeg { word: string; startSec: number; endSec: number }
export interface PalavraFrame { word: string; startFrame: number; endFrame: number }

/** Spans válidos, ordenados e sem sobreposição; lança com a explicação. */
export function conferirSplice(s: AudioSplice, frameCount: number): AudioSplice['spans'] {
  const spans = [...s.spans].sort((a, b) => a.startFrame - b.startFrame);
  spans.forEach((x, i) => {
    if (!(x.endFrame > x.startFrame) || x.startFrame < 0 || x.endFrame > frameCount) throw new Error(`audioSplice span ${i}: frames ${x.startFrame}-${x.endFrame} fora de 0-${frameCount}`);
    if (i && spans[i - 1].endFrame > x.startFrame) throw new Error(`audioSplice: spans ${i - 1} e ${i} se sobrepõem`);
  });
  if (!(s.fadeMs >= 0 && s.fadeMs <= 200)) throw new Error(`audioSplice.fadeMs ${s.fadeMs} fora de 0-200`);
  return spans;
}

/**
 * Ganho do campeão por amostra: 1 fora dos spans, 0 dentro, rampa linear de `f` s nas bordas (por dentro do span, onde
 * a voz nova faz a rampa oposta: crossfade de soma 1). Expressão do aeval do ffmpeg.
 */
export function ganhoDoCampeao(spans: { a: number; b: number }[], f: number): string {
  if (!spans.length) return '1';
  const fs = Math.max(f, 1e-4).toFixed(6);
  return `(1-${spans.map(({ a, b }) => `clip(min((t-${a.toFixed(6)})/${fs},(${b.toFixed(6)}-t)/${fs}),0,1)`).join('-')})`;
}

/**
 * Monta o áudio da peça: campeão inteiro, e em cada span a voz da cena (do instante 0 do arquivo, cortada no tamanho do
 * span) com crossfade de fadeMs. Mesma taxa e canais do campeão, AAC 192 kbps, duração do campeão. Fora dos spans a
 * amostra é a do campeão com ganho 1 (só a codificação AAC mexe; o md5 do decodificado deixa de bater, por definição).
 */
export async function montarAudioSplice(bins: { ffmpeg: string; ffprobe: string }, campeao: string, splice: AudioSplice,
  canvas: { fps: number; frameCount: number }, outPath: string): Promise<void> {
  const spans = conferirSplice(splice, canvas.frameCount);
  const { stdout } = await execFileP(bins.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,channel_layout',
    '-of', 'json', campeao]);
  const st = JSON.parse(String(stdout)).streams?.[0];
  if (!st) throw new Error('audioSplice: o campeão não tem áudio');
  const rate = Number(st.sample_rate) || 48000;
  const ch = Number(st.channels) || 2;
  const layout = st.channel_layout || (ch === 1 ? 'mono' : 'stereo');
  const f = splice.fadeMs / 1000;
  const sec = spans.map((s) => ({ a: s.startFrame / canvas.fps, b: s.endFrame / canvas.fps }));
  const g = ganhoDoCampeao(sec, f);
  const total = canvas.frameCount / canvas.fps;
  const ins = ['-i', campeao, ...spans.flatMap((s) => ['-i', s.url])];
  const fmt = `aresample=${rate},aformat=sample_fmts=fltp:sample_rates=${rate}:channel_layouts=${layout}`;
  const parts = [`[0:a:0]${fmt},aeval='${Array.from({ length: ch }, (_, c) => `val(${c})*${g}`).join('|')}':c=same[c]`];
  sec.forEach(({ a, b }, i) => {
    const L = b - a;
    const fd = Math.min(f, L / 2);
    parts.push(`[${i + 1}:a:0]${fmt},asetpts=PTS-STARTPTS,apad,atrim=0:${L.toFixed(6)},`
      + (fd > 0 ? `afade=t=in:st=0:d=${fd.toFixed(6)}:curve=tri,afade=t=out:st=${(L - fd).toFixed(6)}:d=${fd.toFixed(6)}:curve=tri,` : '')
      + `adelay=delays=${Math.round(a * 1000)}:all=1[v${i}]`);
  });
  parts.push(`[c]${sec.map((_, i) => `[v${i}]`).join('')}amix=inputs=${sec.length + 1}:duration=first:dropout_transition=0:normalize=0,atrim=0:${total.toFixed(6)}[a]`);
  await execFileP(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...ins, '-filter_complex', parts.join(';'),
    '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', String(rate), '-movflags', '+faststart', outPath], { maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Palavras da legenda redesenhada (B): fora dos trechos main ficam as do teardown; dentro de cada trecho entram as da
 * transcrição nova (já reencaixada: segundos relativos ao início do trecho). Teardown com o meio dentro de um trecho
 * sai. Frames na grade do campeão, cada palavra com ≥ 1 frame, presas ao trecho, em ordem e sem sobreposição.
 */
export function mesclarPalavras(base: PalavraSeg[], trechos: { startFrame: number; endFrame: number; words: PalavraSeg[] }[], fps: number): PalavraFrame[] {
  const dentro = (sec: number) => trechos.some((t) => sec * fps >= t.startFrame && sec * fps < t.endFrame);
  const out: PalavraFrame[] = [];
  for (const w of base) {
    if (dentro((w.startSec + w.endSec) / 2)) continue;
    out.push({ word: w.word, startFrame: Math.round(w.startSec * fps), endFrame: Math.round(w.endSec * fps) });
  }
  for (const t of trechos) {
    for (const w of t.words) {
      const s = Math.min(t.endFrame - 1, Math.max(t.startFrame, t.startFrame + Math.round(w.startSec * fps)));
      const e = Math.min(t.endFrame, Math.max(s + 1, t.startFrame + Math.round(w.endSec * fps)));
      out.push({ word: w.word, startFrame: s, endFrame: e });
    }
  }
  out.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  for (let i = 0; i < out.length; i++) {
    out[i].endFrame = Math.max(out[i].endFrame, out[i].startFrame + 1);
    if (i && out[i].startFrame < out[i - 1].endFrame) {
      // vizinha que invade: a anterior encolhe (nunca abaixo de 1 frame); se não der, a atual anda
      out[i - 1].endFrame = Math.max(out[i - 1].startFrame + 1, out[i].startFrame);
      if (out[i].startFrame < out[i - 1].endFrame) { out[i].startFrame = out[i - 1].endFrame; out[i].endFrame = Math.max(out[i].endFrame, out[i].startFrame + 1); }
    }
  }
  return out;
}
