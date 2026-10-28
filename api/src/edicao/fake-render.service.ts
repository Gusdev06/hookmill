import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RenderInput, RenderProgress, RenderResult, RenderService, ScratchRenderInput } from '../render/contrato';
import { RenderError, isAutoEdit, isFrame, isRemixKeep, isTemplate, type AutoEditRenderInput } from '../render/contrato';

const run = promisify(execFile);

/** Forma mínima do input da moldura que o fake lê (TRANSIÇÃO: o tipo real `FrameRenderInput` é do video). */
interface FakeFrameInput {
  kind: 'frame'; renderId: string; format: ScratchRenderInput['format'];
  frame?: { texts?: unknown }; video?: { timeline?: { startSec: number; endSec: number }[] };
}
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/** Mesmos 3 templates do registro do video/ (V1). */
export const FAKE_TEMPLATES: { id: string; kind: 'scratch' | 'remix'; labelKey: string; thumbnailPath: string; supportsHeadline: boolean }[] = [
  { id: 'clean', kind: 'scratch', labelKey: 'template.clean', thumbnailPath: '', supportsHeadline: false },
  { id: 'bold', kind: 'scratch', labelKey: 'template.bold', thumbnailPath: '', supportsHeadline: false },
  { id: 'headline', kind: 'scratch', labelKey: 'template.headline', thumbnailPath: '', supportsHeadline: true },
  { id: 'remix-keep', kind: 'remix', labelKey: 'template.remixKeep', thumbnailPath: '', supportsHeadline: false }, // §13.6
];

/** Resolução reduzida (1/4) do formato: o fake é pra fluxo e teste, não pra qualidade. */
const DIMS: Record<ScratchRenderInput['format'], [number, number]> = {
  VERTICAL_9_16: [270, 480],
  PORTRAIT_4_5: [270, 338],
  SQUARE_1_1: [270, 270],
};

/**
 * RenderService falso (modo mock e testes): gera um MP4 sintético de verdade com ffmpeg (cor + silêncio) com a
 * duração das cenas, e um pôster PNG. Mesma interface do RenderService real (api/src/render/contrato.ts).
 * Leva ~1,5 s no mínimo e emite progresso como o real (bundling → rendering → encoding).
 * Gatilho de falha: headline ou ctaText com "[mock:RENDER_ERROR]".
 */
export class FakeRenderService implements RenderService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: { tmpDir: string; minMs?: number }) {}

  templates() {
    return FAKE_TEMPLATES.map((t) => ({ ...t }));
  }

  render(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    const job = this.queue.then(() => this.doRender(input, onProgress));
    this.queue = job.catch(() => undefined); // concorrência 1
    return job;
  }

  private async doRender(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    if (isAutoEdit(input)) return this.doAutoEdit(input, onProgress);
    if (isFrame(input)) return this.doFrame(input as unknown as FakeFrameInput, onProgress);
    // iterate-v2 F1.4: template grátis = vídeo sintético com a duração calculada pelo builder
    if (isTemplate(input)) return this.doFrame({ kind: 'frame', renderId: input.renderId, format: input.format, video: { timeline: [{ startSec: 0, endSec: input.durationInFrames / 30 }] } }, onProgress);
    // remix-keep: duração/fps/tamanho do campeão (1/4 da resolução); scratch: soma das cenas
    const remix = isRemixKeep(input);
    const fps = remix ? input.canvas.fps : input.fps;
    const durationSec = remix
      ? Math.max(0.04, input.canvas.frameCount / input.canvas.fps)
      : Math.min(120, Math.max(1, input.scenes.reduce((a, s) => a + (s.durationSec || 0), 0) + (input.endCard ? 1 : 0)));
    const totalFrames = Math.round(durationSec * fps);
    const failText = remix ? input.textLayers.map((l) => (l.content.kind === 'static' ? l.content.text : '')).join(' ') : `${input.headline ?? ''} ${input.ctaText}`;
    const steps = 6;
    const wait = Math.max(0, (this.opts.minMs ?? 1500) / steps);
    onProgress({ stage: 'bundling', progress: 5, frame: 0, totalFrames });
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, wait));
      const frame = Math.round((totalFrames * i) / steps);
      if (failText.includes('[mock:RENDER_ERROR]') && i === 3) {
        throw new RenderError('RENDER_ERROR', frame, 'mock render error');
      }
      onProgress({ stage: 'rendering', progress: 5 + Math.round((85 * i) / steps), frame, totalFrames });
    }
    onProgress({ stage: 'encoding', progress: 95, frame: totalFrames, totalFrames });
    const dir = join(this.opts.tmpDir, input.renderId);
    await mkdir(dir, { recursive: true });
    const even = (n: number) => Math.max(2, Math.round(n / 8) * 2);
    const [w, h] = remix ? [even(input.canvas.width), even(input.canvas.height)] : DIMS[input.format];
    const outputPath = join(dir, 'video.mp4');
    const posterPath = join(dir, 'poster.png');
    try {
      await run(FFMPEG, [
        '-hide_banner', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=0x1d1d2b:s=${w}x${h}:r=${fps}:d=${durationSec}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        '-movflags', '+faststart', outputPath,
      ]);
      await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', outputPath, '-frames:v', '1', posterPath]);
    } catch (e) {
      throw new RenderError('RENDER_ERROR', null, (e as Error).message.split('\n')[0]);
    }
    const { size } = await stat(outputPath);
    return { outputPath, posterPath, durationSec, width: w, height: h, sizeBytes: size };
  }

  /**
   * 25/10 (molduras §B2): input `kind 'frame'` (fake). Duração = soma do `video.timeline`; MP4 sintético no formato.
   * Gatilho de falha: "[mock:RENDER_ERROR]" em algum texto da moldura.
   */
  private async doFrame(input: FakeFrameInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    const fps = 30;
    const durationSec = Math.max(0.5, (input.video?.timeline ?? []).reduce((a, t) => a + Math.max(0, t.endSec - t.startSec), 0));
    const totalFrames = Math.round(durationSec * fps);
    const wait = Math.max(0, (this.opts.minMs ?? 1500) / 3);
    onProgress({ stage: 'bundling', progress: 5, frame: 0, totalFrames });
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, wait));
      if (JSON.stringify(input.frame?.texts ?? {}).includes('[mock:RENDER_ERROR]') && i === 2) throw new RenderError('RENDER_ERROR', Math.round(totalFrames / 2), 'mock render error');
      onProgress({ stage: 'rendering', progress: 5 + 28 * i, frame: Math.round((totalFrames * i) / 3), totalFrames });
    }
    onProgress({ stage: 'encoding', progress: 95, frame: totalFrames, totalFrames });
    const dir = join(this.opts.tmpDir, input.renderId);
    await mkdir(dir, { recursive: true });
    const [w, h] = DIMS[input.format];
    const outputPath = join(dir, 'video.mp4');
    const posterPath = join(dir, 'poster.png');
    try {
      await run(FFMPEG, [
        '-hide_banner', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=0x2b2b1d:s=${w}x${h}:r=${fps}:d=${durationSec}`,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
        '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        '-movflags', '+faststart', outputPath,
      ]);
      await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', outputPath, '-frames:v', '1', posterPath]);
    } catch (e) {
      throw new RenderError('RENDER_ERROR', null, (e as Error).message.split('\n')[0]);
    }
    const { size } = await stat(outputPath);
    return { outputPath, posterPath, durationSec, width: w, height: h, sizeBytes: size, mimeType: 'video/mp4' };
  }

  /**
   * variacao-auto-v1: peça `auto-edit` (fake). Duração = soma do timeline (+2 s no ENDCARD); `still` (STATIC) = PNG.
   * Gatilho de falha: params com "[mock:RENDER_ERROR]" em qualquer texto (o do §10 por oferta fica na fila do edicao).
   */
  private async doAutoEdit(input: AutoEditRenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    const fps = 30;
    const still = input.output === 'still';
    const durationSec = still ? 0 : Math.max(0.5, input.timeline.reduce((a, t) => a + Math.max(0, t.endSec - t.startSec), 0) + (input.type === 'ENDCARD' ? 2 : 0));
    const totalFrames = still ? 1 : Math.round(durationSec * fps);
    const wait = Math.max(0, (this.opts.minMs ?? 1500) / 3);
    onProgress({ stage: 'bundling', progress: 5, frame: 0, totalFrames });
    for (let i = 1; i <= 3; i++) {
      await new Promise((r) => setTimeout(r, wait));
      if (JSON.stringify(input.params).includes('[mock:RENDER_ERROR]') && i === 2) throw new RenderError('RENDER_ERROR', Math.round(totalFrames / 2), 'mock render error');
      onProgress({ stage: 'rendering', progress: 5 + 28 * i, frame: Math.round((totalFrames * i) / 3), totalFrames });
    }
    onProgress({ stage: 'encoding', progress: 95, frame: totalFrames, totalFrames });
    const dir = join(this.opts.tmpDir, input.renderId);
    await mkdir(dir, { recursive: true });
    const [w, h] = DIMS[input.format];
    const posterPath = join(dir, 'poster.png');
    const outputPath = still ? posterPath : join(dir, 'video.mp4');
    try {
      if (still) {
        await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x2b1d1d:s=${w}x${h}`, '-frames:v', '1', posterPath]);
      } else {
        await run(FFMPEG, [
          '-hide_banner', '-v', 'error', '-y',
          '-f', 'lavfi', '-i', `color=c=0x1d2b1d:s=${w}x${h}:r=${fps}:d=${durationSec}`,
          '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
          '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
          '-movflags', '+faststart', outputPath,
        ]);
        await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-i', outputPath, '-frames:v', '1', posterPath]);
      }
    } catch (e) {
      throw new RenderError('RENDER_ERROR', null, (e as Error).message.split('\n')[0]);
    }
    const { size } = await stat(outputPath);
    return { outputPath, posterPath, durationSec, width: w, height: h, sizeBytes: size, mimeType: still ? 'image/png' : 'video/mp4' };
  }
}
