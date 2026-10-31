// Prévia borrada da amostra grátis (amostra-gratis-v1 §3): a partir do MP4 final da peça (local ou baixado do Lambda),
// 480 px de largura, 0 a SAMPLE_SHARP_SEC nítido, depois boxblur forte até o fim (corte seco, sem fade), selo
// "HOOKMILL PREVIEW" sempre visível, áudio mantido. H.264 + AAC, faststart. O blur é no servidor: o original não sai.
import { existsSync } from 'node:fs';
import type { SAMPLE_SHARP_SEC as SharpSec } from '@maquina/contratos';
import { run } from '../medicao/ffmpeg';

/** Espelho de `SAMPLE_SHARP_SEC` (o pacote de contratos é só tipos); o `satisfies` quebra o tsc se divergir. */
export const SHARP_SEC = 3 as const satisfies typeof SharpSec;

export const PREVIEW = { width: 480, blur: '20:2', crf: 28, audioKbps: 96, label: 'HOOKMILL PREVIEW', timeoutMs: 3 * 60_000 } as const;

/** Fonte TrueType do selo; sem nenhuma, o drawtext usa a padrão do fontconfig (a imagem da API tem fonts-liberation). */
export function previaFont(env: NodeJS.ProcessEnv = process.env): string | null {
  const cands = [env.PREVIEW_FONT_FILE, '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'];
  return cands.find((f): f is string => !!f && existsSync(f)) ?? null;
}

/** Argumentos do ffmpeg (puro, testável sem rodar). */
export function previaArgs(entrada: string, saida: string, opts: { sharpSec?: number; font?: string | null } = {}): string[] {
  const sharp = opts.sharpSec ?? SHARP_SEC;
  const font = opts.font === undefined ? previaFont() : opts.font;
  const fonte = font ? `fontfile='${font.replace(/'/g, "\\'").replace(/:/g, '\\:')}'` : 'font=Sans';
  const selo = `drawtext=${fonte}:text='${PREVIEW.label}':fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-16:y=16`;
  const filtro = [
    `[0:v]scale=${PREVIEW.width}:-2:flags=bicubic,setsar=1,split=2[a][b]`,
    `[b]boxblur=${PREVIEW.blur}[bl]`,
    // corte seco: a partir de `sharp` s o quadro borrado cobre o nítido inteiro
    `[a][bl]overlay=0:0:enable='gte(t\\,${sharp})'[m]`,
    `[m]${selo},format=yuv420p[v]`,
  ].join(';');
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', entrada, '-filter_complex', filtro,
    '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(PREVIEW.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', `${PREVIEW.audioKbps}k`, '-movflags', '+faststart', saida];
}

/** Gera a prévia em `saida`. Lança em falha (quem chama decide: a peça não falha por causa da prévia). */
export async function gerarPrevia(entrada: string, saida: string, opts: { ffmpeg?: string; sharpSec?: number; font?: string | null } = {}): Promise<void> {
  await run(opts.ffmpeg ?? (process.env.FFMPEG_PATH || 'ffmpeg'), previaArgs(entrada, saida, opts), { timeoutMs: PREVIEW.timeoutMs });
}
