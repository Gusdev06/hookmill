// ffmpeg do b-roll (§B3.1), no MÉTODO da skill get-brolls: antes de escolher, OLHAR uma folha de quadros (contact
// sheet) numerada do intervalo, não um poster solto; depois baixar só o escolhido, validar decodificando o arquivo
// inteiro (download truncado sem erro já aconteceu na WaveSpeed) e cortar o intervalo.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SHEET = { cells: 12, cols: 4, maxWindowSec: 36, cellWidthPortrait: 240, cellWidthLandscape: 320 } as const;

/** Fonte TrueType pro número da célula (sem fonte = folha sem número; o pedido ao Claude descreve a ordem). */
export function sheetFont(env: NodeJS.ProcessEnv = process.env): string | null {
  const cands = [env.BROLL_FONT_FILE, env.GB_FONT_FILE, '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'];
  return cands.find((f): f is string => !!f && existsSync(f)) ?? null;
}

/** Tempos (s) de cada célula: 12 quadros igualmente espaçados na janela [0, min(duração, 36 s)], no meio de cada fatia. */
export function cellTimes(durationSec: number, cells: number = SHEET.cells): number[] {
  const win = Math.max(0.5, Math.min(durationSec, SHEET.maxWindowSec));
  const step = win / cells;
  return Array.from({ length: cells }, (_, k) => Math.round((k + 0.5) * step * 100) / 100);
}

/** Intervalo a partir das células escolhidas (1-based): da metade antes da 1ª à metade depois da última, alongado até
 *  `minSec` quando o clipe deixa (mais curto que isso = o clipe inteiro; o render faz loop). */
export function intervalFromCells(durationSec: number, first: number, last: number, minSec: number): { startSec: number; endSec: number } {
  const times = cellTimes(durationSec);
  const step = times.length > 1 ? times[1] - times[0] : durationSec;
  const a = Math.min(Math.max(1, Math.round(first)), times.length);
  const b = Math.min(Math.max(a, Math.round(last)), times.length);
  let start = Math.max(0, times[a - 1] - step / 2);
  let end = Math.min(durationSec, times[b - 1] + step / 2);
  if (end - start < minSec) {
    end = Math.min(durationSec, start + minSec);
    if (end - start < minSec) start = Math.max(0, end - minSec);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { startSec: r2(start), endSec: r2(end) };
}

export interface Ffmpeg {
  /** folha JPEG de `cells` quadros da URL/arquivo; devolve os bytes */
  contactSheet(src: string, durationSec: number, portrait: boolean): Promise<Buffer>;
  /** decodifica o arquivo inteiro; lança se houver erro */
  validate(path: string): Promise<void>;
  /** corta [start, end] mudo, h264 yuv420p, cabendo em 1080×1920 */
  cut(src: string, startSec: number, endSec: number, out: string): Promise<void>;
}

export function ffmpegOf(bin = process.env.FFMPEG_PATH || 'ffmpeg', font: string | null = sheetFont()): Ffmpeg {
  return {
    async contactSheet(src, durationSec, portrait) {
      const win = Math.max(0.5, Math.min(durationSec, SHEET.maxWindowSec));
      const w = portrait ? SHEET.cellWidthPortrait : SHEET.cellWidthLandscape;
      const label = font ? `,drawtext=fontfile='${font}':text='%{eif\\:n+1\\:d}':x=8:y=8:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6` : '';
      const vf = `fps=${SHEET.cells}/${win.toFixed(3)},scale=${w}:-2${label},tile=${SHEET.cols}x${SHEET.cells / SHEET.cols}:padding=4:color=white`;
      const { stdout } = await run(bin, ['-hide_banner', '-v', 'error', '-t', win.toFixed(3), '-i', src, '-vf', vf, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'],
        { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 90_000 });
      if (!stdout.length) throw new Error('empty contact sheet');
      return stdout as Buffer;
    },
    async validate(path) {
      const { stderr } = await run(bin, ['-v', 'error', '-i', path, '-f', 'null', '-'], { timeout: 120_000 });
      if (String(stderr).trim()) throw new Error(`decode error: ${String(stderr).trim().slice(0, 200)}`);
    },
    async cut(src, startSec, endSec, out) {
      await run(bin, ['-hide_banner', '-v', 'error', '-y', '-ss', startSec.toFixed(2), '-to', endSec.toFixed(2), '-i', src, '-an',
        '-vf', "scale='min(iw,1080)':'min(ih,1920)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { timeout: 180_000 });
    },
  };
}
