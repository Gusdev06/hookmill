import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaInfo {
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export class MediaInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaInvalidError';
  }
}

const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Valida o arquivo INTEIRO, não só o cabeçalho (a WaveSpeed já entregou download truncado sem erro):
 *  1. ffprobe: tem o stream esperado (vídeo / áudio / imagem) e duração > 0 quando é mídia temporal;
 *  2. ffmpeg decodifica todos os frames até o fim (-xerror: qualquer erro de decode = inválido).
 * Usa -v error sem filtros de análise (o -v error engole a saída de silencedetect, aqui não importa).
 */
export async function validateMedia(path: string, kind: MediaKind): Promise<MediaInfo> {
  const { size } = await stat(path);
  if (size === 0) throw new MediaInvalidError('empty file');

  let probe: { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  try {
    const { stdout } = await run(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    probe = JSON.parse(stdout);
  } catch (e) {
    throw new MediaInvalidError(`ffprobe failed: ${(e as Error).message.split('\n')[0]}`);
  }

  const streams = probe.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if ((kind === 'video' || kind === 'image') && !video) throw new MediaInvalidError(`no ${kind} stream`);
  if (kind === 'audio' && !audio) throw new MediaInvalidError('no audio stream');

  const duration = Number(probe.format?.duration);
  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : null;
  if (kind !== 'image' && !durationSec) throw new MediaInvalidError('no duration');

  try {
    const { stderr } = await run(
      FFMPEG,
      ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'],
      { maxBuffer: 4 * 1024 * 1024, timeout: 10 * 60_000 },
    );
    if (stderr.trim()) throw new MediaInvalidError(`decode error: ${stderr.trim().split('\n')[0]}`);
  } catch (e) {
    if (e instanceof MediaInvalidError) throw e;
    const err = e as { stderr?: string; message: string };
    throw new MediaInvalidError(`decode failed: ${(err.stderr || err.message).trim().split('\n')[0]}`);
  }

  return { sizeBytes: size, durationSec, width: video?.width ?? null, height: video?.height ?? null };
}

export interface ProbeInfo {
  durationSec: number | null; width: number | null; height: number | null; hasVideo: boolean; hasAudio: boolean; videoCodec: string | null;
}

/**
 * Só o cabeçalho (ffprobe), sem decodificar: usado no `complete` do upload (feature 2), que não pode segurar a
 * requisição decodificando 200 MB. Aceita caminho local ou URL (pré-assinada). Lança MediaInvalidError se não lê.
 */
export async function probeHeader(pathOrUrl: string): Promise<ProbeInfo> {
  let probe: { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  try {
    const { stdout } = await run(
      FFPROBE,
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', pathOrUrl],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    probe = JSON.parse(stdout);
  } catch (e) {
    throw new MediaInvalidError(`ffprobe: ${(e as Error).message.split('\n')[0]}`);
  }
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const d = Number(probe.format?.duration);
  return {
    durationSec: Number.isFinite(d) && d > 0 ? d : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: !!video,
    hasAudio: !!probe.streams?.some((s) => s.codec_type === 'audio'),
    videoCodec: video?.codec_name ?? null,
  };
}
