// Mídia sintética do modo mock: rosto (PNG), clipe (MP4 H.264 + AAC) e áudio (WAV), gerados com ffmpeg
// local na primeira vez e guardados em cache no tmp. Determinístico: mesma semente → mesmo arquivo.
// Nada pago, nada de rede. O backend baixa essas URLs como baixaria a saída da WaveSpeed.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VideoFormat } from '../contrato';

const run = promisify(execFile);

export const MOCK_MEDIA_ROUTE = 'mock-media';
/** `static` (rev. 23/10): imagem da peça STATIC, gradiente PNG no aspecto (nunca foto de rosto). */
export type MockMediaKind = 'face' | 'video' | 'audio' | 'static';
const isImage = (k: MockMediaKind) => k === 'face' || k === 'static';

const DIMS: Record<VideoFormat, [number, number]> = {
  VERTICAL_9_16: [360, 640],
  PORTRAIT_4_5: [432, 540],
  SQUARE_1_1: [480, 480],
};
export const FORMATS = Object.keys(DIMS) as VideoFormat[];

export function seedOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Número estável 0..1 a partir de uma semente. */
export function unit(seed: string, salt = ''): number {
  const h = createHash('sha256').update(seed + salt).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

/** Maior clipe que o mock gera: o do lipsync (1 clipe por bloco, até 30 s). */
export const MOCK_MAX_SEC = 30;

export function clampSec(sec: number): number {
  if (!Number.isFinite(sec)) return 5;
  return Math.min(MOCK_MAX_SEC, Math.max(1, Math.round(sec * 10) / 10));
}

export interface MockMediaParams {
  kind: MockMediaKind;
  seed: string; // [0-9a-f]{16}
  format?: VideoFormat;
  sec?: number;
}

/** URL pública da mídia sintética (rota servida pelo MockMediaController). */
export function mockMediaUrl(publicApiUrl: string, p: MockMediaParams): string {
  const ext = isImage(p.kind) ? 'png' : p.kind === 'video' ? 'mp4' : 'wav';
  const q = new URLSearchParams();
  if (p.format) q.set('format', p.format);
  if (p.sec != null) q.set('sec', String(clampSec(p.sec)));
  const qs = q.toString();
  return `${publicApiUrl.replace(/\/$/, '')}/api/v1/${MOCK_MEDIA_ROUTE}/${p.kind}/${p.seed}.${ext}${qs ? `?${qs}` : ''}`;
}

export function mockMediaDir(): string {
  return process.env.INTEGRACOES_MOCK_MEDIA_DIR || join(tmpdir(), 'maquina-mock-media');
}

/** Gera (ou reaproveita do cache) e devolve o caminho local. Lança se os parâmetros forem inválidos. */
export async function ensureMockMedia(p: MockMediaParams): Promise<{ path: string; mimeType: string }> {
  if (!/^[0-9a-f]{16}$/.test(p.seed)) throw new Error('invalid seed');
  const format = p.format ?? 'VERTICAL_9_16';
  if (!DIMS[format]) throw new Error('invalid format');
  const sec = clampSec(p.sec ?? 5);
  const [w, h] = DIMS[format];
  const dir = mockMediaDir();
  mkdirSync(dir, { recursive: true });

  const ext = isImage(p.kind) ? 'png' : p.kind === 'video' ? 'mp4' : 'wav';
  const mimeType = isImage(p.kind) ? 'image/png' : p.kind === 'video' ? 'video/mp4' : 'audio/wav';
  const realFace = p.kind === 'face' ? pickMockFacePhoto(p.seed) : null;
  // rosto de foto ganha outro nome no cache (o gradiente antigo, sem rosto, não pode ser reaproveitado)
  const faceTag = realFace ? `-real-${createHash('sha256').update(realFace).digest('hex').slice(0, 8)}` : '';
  const name = p.kind === 'audio' ? `${p.kind}-${p.seed}-${sec}.${ext}` : `${p.kind}-${p.seed}-${format}${faceTag}${p.kind === 'video' ? `-${sec}` : ''}.${ext}`;
  const out = join(dir, name);
  if (existsSync(out)) return { path: out, mimeType };

  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.${ext}`;
  const freq = 220 + Math.round(unit(p.seed, 'f') * 440);
  const hue = Math.round(unit(p.seed, 'h') * 360);
  const color = (salt: string) => '0x' + Math.floor(unit(p.seed, salt) * 0xffffff).toString(16).padStart(6, '0');

  let args: string[];
  if (realFace) {
    // §13: rosto de verdade (foto nossa, ex.: Soul) pra o YuNet do Trocar avatar achar rosto no modo mock
    // cobre a grade 2× do formato (rosto 9:16 = 720×1280), centrado
    const fw = w * 2;
    const fh = h * 2;
    args = ['-i', realFace, '-vf', `scale=${fw}:${fh}:force_original_aspect_ratio=increase,crop=${fw}:${fh}`, '-frames:v', '1', tmp];
  } else if (isImage(p.kind)) {
    const fw = w * 2;
    const fh = h * 2;
    args = ['-f', 'lavfi', '-i', `gradients=s=${fw}x${fh}:c0=${color('c0')}:c1=${color('c1')}:c2=${color('c2')}:nb_colors=3:seed=${Math.floor(unit(p.seed, 's') * 1e6)}:d=1`, '-frames:v', '1', tmp];
  } else if (p.kind === 'video') {
    args = [
      '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30:d=${sec}`,
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:d=${sec}`,
      '-vf', `hue=h=${hue}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', tmp,
    ];
  } else {
    args = ['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:d=${sec}`, '-c:a', 'pcm_s16le', tmp];
  }
  await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60_000 });
  renameSync(tmp, out);
  return { path: out, mimeType };
}

/** Amostra de voz sintética do mock (tom de 3 s, estável por voz). */
export function mockVoiceSampleUrl(publicApiUrl: string, voiceId: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/api/v1/${MOCK_MEDIA_ROUTE}/voice/${voiceId}.wav`;
}

// ---------------------------------------------------------------- §13: rosto de verdade e lipsync em loop

/**
 * INTEGRACOES_MOCK_FACES_DIR (opcional): pasta com fotos de rosto NOSSAS (jpg/png, ex.: rostos Soul do QA). Com ela, o
 * rosto do mock é uma dessas fotos (escolhida pela semente) em vez do gradiente, e o YuNet acha rosto no fluxo inteiro.
 */
export function pickMockFacePhoto(seed: string): string | null {
  const dir = process.env.INTEGRACOES_MOCK_FACES_DIR;
  if (dir) {
    try {
      const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
      if (files.length) return join(dir, files[Math.floor(unit(seed, 'face') * files.length) % files.length]);
    } catch {
      /* cai no rosto padrão */
    }
  }
  return defaultMockFacePhoto();
}

/**
 * Rosto padrão do mock (QA PC-01/02): foto NOSSA (`testes/fixtures/rostos/rosto-a.jpg`, copiada em mock/assets) que o YuNet
 * acha com score ≥ 0,8. Procurada ao lado do arquivo (ts-node/jest) e em src/ quando roda de dist/ (o .jpg não vai pro build).
 */
export function defaultMockFacePhoto(): string | null {
  const c = [join(__dirname, 'assets', 'rosto-mock.jpg'), join(__dirname, '..', '..', '..', 'src', 'integracoes', 'mock', 'assets', 'rosto-mock.jpg')];
  return c.find((p) => existsSync(p)) ?? null;
}

/** Teto do lipsync no mock = teto do Pruna (take até 600 s). */
export const MOCK_LIPSYNC_MAX_SEC = 600;
/** Cauda que o Pruna deixa depois do áudio (o render corta no frame exato). */
export const MOCK_LIPSYNC_TAIL_SEC = 0.2;

interface LipsyncSpec {
  faceUrl: string; audioUrl: string; sec: number;
  /** §13.15: cauda depois do áudio (padrão MOCK_LIPSYNC_TAIL_SEC); janela/v2v = 0 */
  tailSec?: number;
  /** §13.15: janela sem áudio enviado: 'none' = sem trilha (Kling mudo), 'tone' = tom no lugar da voz do motor */
  audio?: 'none' | 'tone';
  /** §13.15: LIPSYNC_VIDEO = este vídeo remuxado com o áudio (cut_off) em vez do rosto em loop */
  videoUrl?: string;
}

/** Grava o que o clipe precisa (o ffmpeg só roda quando o backend baixar a URL). */
export function writeMockLipsyncSpec(seed: string, spec: LipsyncSpec): void {
  if (!/^[0-9a-f]{16}$/.test(seed)) throw new Error('invalid seed');
  const dir = mockMediaDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `lipsync-${seed}.json`), JSON.stringify(spec));
}

export function mockLipsyncUrl(publicApiUrl: string, seed: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/api/v1/${MOCK_MEDIA_ROUTE}/lipsync/${seed}.mp4`;
}

const httpOpts = (url: string) => (/^https?:\/\//.test(url) ? ['-rw_timeout', '15000000'] : []);

/**
 * Lipsync do mock (§13.8): a IMAGEM DO ROSTO enviada, parada, em loop pela duração do áudio + cauda, 24 fps, com o
 * próprio áudio enviado. Rosto inalcançável → rosto padrão do mock (foto nossa); sem ele, padrão de teste.
 */
export async function ensureMockLipsync(seed: string): Promise<{ path: string; mimeType: string }> {
  if (!/^[0-9a-f]{16}$/.test(seed)) throw new Error('invalid seed');
  const dir = mockMediaDir();
  const out = join(dir, `lipsync-${seed}.mp4`);
  const mimeType = 'video/mp4';
  if (existsSync(out)) return { path: out, mimeType };
  const specPath = join(dir, `lipsync-${seed}.json`);
  if (!existsSync(specPath)) throw new Error('unknown lipsync');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as LipsyncSpec;
  const sec = Math.min(MOCK_LIPSYNC_MAX_SEC, Math.max(1, spec.sec)) + (spec.tailSec ?? MOCK_LIPSYNC_TAIL_SEC);
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.mp4`;
  const ff = (args: string[]) => run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 180_000 });
  if (spec.videoUrl || spec.audio) {
    await ensureMockSwapClip(spec, sec, tmp, ff);
    renameSync(tmp, out);
    return { path: out, mimeType };
  }
  const enc = ['-t', sec.toFixed(3), '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp];
  const v = "[0:v]scale=w='trunc(min(720,iw)/2)*2':h=-2,fps=24,format=yuv420p[v]";
  try {
    await ff([...httpOpts(spec.faceUrl), '-loop', '1', '-i', spec.faceUrl, ...httpOpts(spec.audioUrl), '-i', spec.audioUrl, '-filter_complex', `${v};[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', ...enc]);
  } catch {
    const fallbackFace = defaultMockFacePhoto();
    const tries: string[][] = [
      // rosto enviado ok, áudio inalcançável: tom no lugar da fala
      [...httpOpts(spec.faceUrl), '-loop', '1', '-i', spec.faceUrl, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:d=${sec}`, '-filter_complex', v, '-map', '[v]', '-map', '1:a', ...enc],
    ];
    if (fallbackFace) {
      // rosto enviado inalcançável: o rosto padrão (o YuNet continua achando 1 rosto)
      tries.push(['-loop', '1', '-i', fallbackFace, ...httpOpts(spec.audioUrl), '-i', spec.audioUrl, '-filter_complex', `${v};[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', ...enc]);
      tries.push(['-loop', '1', '-i', fallbackFace, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:d=${sec}`, '-filter_complex', v, '-map', '[v]', '-map', '1:a', ...enc]);
    }
    tries.push(['-f', 'lavfi', '-i', `testsrc2=s=720x1280:r=24:d=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:d=${sec}`, ...enc]);
    let done = false;
    for (const t of tries) {
      try {
        await ff(t);
        done = true;
        break;
      } catch {
        /* próxima */
      }
    }
    if (!done) throw new Error('mock lipsync: ffmpeg failed');
  }
  renameSync(tmp, out);
  return { path: out, mimeType };
}

/** §13.15: janela do motor (rosto parado, mudo ou com tom) ou v2v (vídeo de entrada + áudio enviado, o mais curto). */
async function ensureMockSwapClip(spec: LipsyncSpec, sec: number, tmp: string, ff: (args: string[]) => Promise<unknown>): Promise<void> {
  const v264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  if (spec.videoUrl) {
    try {
      await ff([...httpOpts(spec.videoUrl), '-i', spec.videoUrl, ...httpOpts(spec.audioUrl), '-i', spec.audioUrl, '-map', '0:v:0', '-map', '1:a:0', '-shortest', ...v264, '-c:a', 'aac', '-b:a', '96k', tmp]);
    } catch {
      // áudio inalcançável: tom no lugar
      await ff([...httpOpts(spec.videoUrl), '-i', spec.videoUrl, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:d=${sec}`, '-map', '0:v:0', '-map', '1:a', '-shortest', ...v264, '-c:a', 'aac', '-b:a', '96k', tmp]);
    }
    return;
  }
  const face = spec.faceUrl || defaultMockFacePhoto();
  const v = "scale=w='trunc(min(720,iw)/2)*2':h=-2,fps=24,format=yuv420p";
  const input = face ? [...httpOpts(face), '-loop', '1', '-i', face] : ['-f', 'lavfi', '-i', `testsrc2=s=720x1280:r=24:d=${sec}`];
  const tone = ['-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:d=${sec}`];
  const args = (inp: string[]) => (spec.audio === 'tone'
    ? [...inp, ...tone, '-vf', v, '-map', '0:v', '-map', '1:a', '-t', sec.toFixed(3), ...v264, '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '96k', tmp]
    : [...inp, '-vf', v, '-an', '-t', sec.toFixed(3), ...v264, '-tune', 'stillimage', tmp]);
  try {
    await ff(args(input));
  } catch {
    const fb = defaultMockFacePhoto();
    await ff(args(fb ? ['-loop', '1', '-i', fb] : ['-f', 'lavfi', '-i', `testsrc2=s=720x1280:r=24:d=${sec}`]));
  }
}
