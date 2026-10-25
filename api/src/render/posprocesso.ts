// Pós-processo do render com ffmpeg/ffprobe, comum aos adaptadores `local` e `lambda` (render-lambda-v1 §1 itens 11-13).
// Extraído do RemotionRenderService sem mudar comportamento: o local chama as mesmas funções de antes.
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { RENDER_REMIX } from '@maquina/video';
import type { RemixKeepRenderInput } from './contrato';
import { montarAudioSplice } from './troca-motor';

const execFileP = promisify(execFile);

export interface Ff { ffmpeg: string; ffprobe: string }

/**
 * Peça final do remix-keep: o campeão DECODIFICADO é a base (nunca passa por RGB/navegador), e só as áreas que mudam
 * (regiões do rosto e caixas das camadas, cada uma no seu intervalo de frames) vêm do render do Remotion, por uma
 * máscara de alfa desenhada por frame. Fora da máscara o pixel é o do campeão; a única perda é a codificação final
 * (crf 12). Pelo navegador inteiro dava 35,8 dB RGB (PSNR do QA), abaixo dos 40. Áudio do campeão copiado (-c:a copy).
 */
export async function comporSobreOCampeao(ff: Ff, input: RemixKeepRenderInput, mudo: string, saida: string): Promise<void> {
  const { width: W, height: H, fps, frameCount } = input.canvas;
  const pad = 4;   // contorno/sombra da letra passa um pouco da caixa
  const caixa = (r: { x: number; y: number; w: number; h: number }, p: number) => {
    const x = Math.max(0, Math.floor(r.x - p)), y = Math.max(0, Math.floor(r.y - p));
    return { x, y, w: Math.min(W, Math.ceil(r.x + r.w + p)) - x, h: Math.min(H, Math.ceil(r.y + r.h + p)) - y };
  };
  const areas: { r: { x: number; y: number; w: number; h: number }; s: number; e: number }[] = [];
  for (const o of input.overlays) areas.push({ r: caixa(o.region, 0), s: o.startFrame, e: o.endFrame });
  for (const l of input.textLayers) {
    areas.push({ r: caixa(l.box, pad), s: l.startFrame, e: l.endFrame });
    if (l.background.kind !== 'none' && l.background.box) areas.push({ r: caixa(l.background.box, 0), s: l.startFrame, e: l.endFrame });
  }
  const boxes = areas.map((a) => `drawbox=x=${a.r.x}:y=${a.r.y}:w=${a.r.w}:h=${a.r.h}:c=white:t=fill:enable='between(n\\,${a.s}\\,${a.e - 1})'`);
  const filtro = [
    `color=c=black:s=${W}x${H}:r=${fps},format=gray${boxes.length ? ',' + boxes.join(',') : ''}[m]`,
    `[0:v]format=yuv420p[top]`,
    `[top][m]alphamerge[ta]`,
    `[1:v]format=yuv420p[base]`,
    `[base][ta]overlay=format=yuv420:eof_action=pass:shortest=0[v]`,
  ].join(';');
  const cor = await corDoCampeao(ff, input.baseVideoUrl);
  // (B) voz do motor: o áudio é montado antes (campeão + voz nos trechos main) e entra no lugar do passthrough
  const audioMontado = input.audioSplice ? path.join(path.dirname(saida), 'audio.montado.m4a') : null;
  if (audioMontado) {
    await montarAudioSplice({ ffmpeg: ff.ffmpeg, ffprobe: ff.ffprobe }, input.audioPassthroughUrl, input.audioSplice!, input.canvas, audioMontado);
  }
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', mudo, '-i', input.baseVideoUrl, '-i', audioMontado ?? input.audioPassthroughUrl,
    '-filter_complex', filtro, '-map', '[v]', '-map', '2:a:0?', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(RENDER_REMIX.crfFinal), '-pix_fmt', 'yuv420p', ...cor,
    '-c:a', 'copy', '-movflags', '+faststart', saida];
  try {
    await execFileP(ff.ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 });
  } finally {
    await rm(mudo, { force: true });
    if (audioMontado) await rm(audioMontado, { force: true });
  }
}

/** Tags de cor do campeão (a QA converte pra RGB pela tag: peça sem tag e campeão bt709 = desvio de 1-2 níveis). */
export async function corDoCampeao(ff: Ff, url: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=color_space,color_primaries,color_transfer,color_range', '-of', 'json', url]);
    const st = JSON.parse(String(stdout)).streams?.[0] ?? {};
    const out: string[] = [];
    const ok = (v: unknown) => typeof v === 'string' && v !== 'unknown' && v !== '';
    if (ok(st.color_space)) out.push('-colorspace', st.color_space);
    if (ok(st.color_primaries)) out.push('-color_primaries', st.color_primaries);
    if (ok(st.color_transfer)) out.push('-color_trc', st.color_transfer);
    if (ok(st.color_range)) out.push('-color_range', st.color_range);
    return out;
  } catch {
    return [];
  }
}

/** Nº de frames de vídeo do arquivo (pacotes contados, não o nb_frames do cabeçalho). */
export async function contarFrames(ff: Pick<Ff, 'ffprobe'>, arquivo: string): Promise<number> {
  const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', arquivo]);
  return parseInt(String(stdout).trim(), 10);
}

/** Largura, altura, fps e nº de frames (pacotes contados) do vídeo baixado. */
export async function sondarVideo(ff: Pick<Ff, 'ffprobe'>, arquivo: string): Promise<{ width: number; height: number; fps: number; frames: number }> {
  const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_packets', '-of', 'json', arquivo]);
  const st = JSON.parse(String(stdout)).streams?.[0] ?? {};
  const [n, d] = String(st.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { width: Number(st.width), height: Number(st.height), fps: d ? n / d : 0, frames: parseInt(String(st.nb_read_packets), 10) };
}

/** L-D5: pôster pelo ffmpeg no MP4 pronto (sem renderStill, sem 2º render na licença). JPEG q2 ≈ o 85 do renderStill. */
export async function posterPorFfmpeg(ff: Pick<Ff, 'ffmpeg'>, video: string, poster: string, sec: number): Promise<void> {
  await execFileP(ff.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, sec)), '-i', video,
    '-frames:v', '1', '-q:v', '2', poster]);
}
