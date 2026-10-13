import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RenderError, type ScratchRenderInput as RenderInput, type RenderProgress } from './contrato';
import { FilaLimitada } from './fila';
import { frameDoErro, limitarProgresso, mapearProgresso } from './progresso';
import { RemotionRenderService, type RemotionPort } from './remotion-render.service';
import { renderConfig } from './render.module';

const entrada = (over: Partial<RenderInput> = {}): RenderInput => ({
  renderId: 'r1',
  templateId: 'clean',
  format: 'VERTICAL_9_16',
  fps: 30,
  language: 'en',
  scenes: [{ clipUrl: 'https://exemplo/c1.mp4', durationSec: 2, words: [{ word: 'Oi', startSec: 0, endSec: 0.4 }] }],
  captionStyle: 'word',
  captionPosition: 'bottom',
  headline: null,
  ctaText: 'Go',
  endCard: false,
  ...over,
});

/** Remotion falso: simula frames, grava um arquivo de saída e pode falhar num frame. */
function fakeRemotion(opts: { falharNoFrame?: number; atrasoMs?: number; log?: string[] } = {}): RemotionPort & { chamadas: Record<string, unknown>[] } {
  const chamadas: Record<string, unknown>[] = [];
  return {
    chamadas,
    ensureBrowser: async () => undefined,
    bundle: async () => '/bundle-fake',
    selectComposition: async () => ({ width: 1080, height: 1920, fps: 30, durationInFrames: 60 }),
    renderMedia: async (o) => {
      chamadas.push(o);
      opts.log?.push(`inicio:${path.basename(path.dirname(String(o.outputLocation)))}`);
      for (let f = 1; f <= 60; f++) {
        if (opts.falharNoFrame === f) {
          const e = new Error(`boom`) as Error & { frame: number };
          e.frame = f;
          throw e;
        }
        o.onProgress({ progress: f / 60, renderedFrames: f, encodedFrames: f });
      }
      if (opts.atrasoMs) await new Promise((r) => setTimeout(r, opts.atrasoMs));
      writeFileSync(String(o.outputLocation), Buffer.alloc(1234));
      opts.log?.push(`fim:${path.basename(path.dirname(String(o.outputLocation)))}`);
    },
    renderStill: async (o) => {
      writeFileSync(String(o.output), Buffer.alloc(10));
    },
  };
}

const novoServico = (port: RemotionPort, concurrency = 1) =>
  new RemotionRenderService({ concurrency, tmpDir: mkdtempSync(path.join(tmpdir(), 'render-')), bundleDir: null, framesConcurrency: 1, browserExecutable: null }, port);

describe('RenderService (Remotion)', () => {
  it('lista os 3 templates scratch + o remix-keep (kind remix); só headline aceita headline', () => {
    const t = novoServico(fakeRemotion()).templates();
    expect(t.map((x) => x.id)).toEqual(['clean', 'bold', 'headline', 'remix-keep']);
    expect(t.filter((x) => x.kind === 'scratch').map((x) => x.id)).toEqual(['clean', 'bold', 'headline']);
    expect(t.filter((x) => x.supportsHeadline).map((x) => x.id)).toEqual(['headline']);
    expect(path.isAbsolute(t[0].thumbnailPath)).toBe(true);
  });

  it('renderiza: devolve arquivos, dimensões e duração; progresso termina em 100', async () => {
    const port = fakeRemotion();
    const progresso: RenderProgress[] = [];
    const r = await novoServico(port).render(entrada(), (p) => progresso.push(p));
    expect(r).toMatchObject({ width: 1080, height: 1920, durationSec: 2, sizeBytes: 1234 });
    expect(existsSync(r.outputPath) && existsSync(r.posterPath)).toBe(true);
    expect(progresso[0].stage).toBe('bundling');
    expect(progresso.some((p) => p.stage === 'rendering')).toBe(true);
    expect(progresso[progresso.length - 1]).toEqual({ stage: 'encoding', progress: 100, frame: 60, totalFrames: 60 });
    // opções medidas em docs/render.md
    expect(port.chamadas[0]).toMatchObject({ codec: 'h264', concurrency: 1, offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024 });
    // props sem renderId/fps
    expect(port.chamadas[0].inputProps).not.toHaveProperty('renderId');
  });

  it('falha no meio vira RenderError com o frame e apaga a saída parcial', async () => {
    const svc = novoServico(fakeRemotion({ falharNoFrame: 38 }));
    const err = await svc.render(entrada(), () => undefined).catch((e) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(err).toMatchObject({ code: 'RENDER_ERROR', failedFrame: 38 });
  });

  it('templateId desconhecido vira RenderError sem frame', async () => {
    const err = await novoServico(fakeRemotion()).render(entrada({ templateId: 'nao-existe' }), () => undefined).catch((e) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(err.failedFrame).toBeNull();
  });

  it('um por vez: o segundo render só começa quando o primeiro termina', async () => {
    const log: string[] = [];
    const svc = novoServico(fakeRemotion({ atrasoMs: 30, log }), 1);
    await Promise.all([svc.render(entrada({ renderId: 'a' }), () => undefined), svc.render(entrada({ renderId: 'b' }), () => undefined)]);
    expect(log).toEqual(['inicio:a', 'fim:a', 'inicio:b', 'fim:b']);
  });

  it('erro de um render não trava a fila', async () => {
    let n = 0;
    const port = fakeRemotion();
    const original = port.renderMedia;
    port.renderMedia = async (o) => (n++ === 0 ? Promise.reject(new Error('Error on frame 5')) : original(o));
    const svc = novoServico(port);
    const [a, b] = await Promise.allSettled([svc.render(entrada({ renderId: 'a' }), () => undefined), svc.render(entrada({ renderId: 'b' }), () => undefined)]);
    expect(a.status).toBe('rejected');
    expect((a as PromiseRejectedResult).reason.failedFrame).toBe(5);
    expect(b.status).toBe('fulfilled');
  });
});

describe('peças do render', () => {
  it('FilaLimitada respeita o limite', async () => {
    const fila = new FilaLimitada(2);
    let max = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        fila.executar(async () => {
          max = Math.max(max, fila.emAndamento);
          await new Promise((r) => setTimeout(r, 5));
        }),
      ),
    );
    expect(max).toBe(2);
  });

  it('mapearProgresso: % inteiro e etapa', () => {
    expect(mapearProgresso({ progress: 0.505, renderedFrames: 40, encodedFrames: 30 }, 100)).toEqual({ stage: 'rendering', progress: 50, frame: 40, totalFrames: 100 });
    expect(mapearProgresso({ progress: 0.97, renderedFrames: 100, encodedFrames: 90 }, 100).stage).toBe('encoding');
  });

  it('limitarProgresso: no máximo 1 aviso por intervalo, mas etapa nova e 100% passam', () => {
    let t = 0;
    const out: RenderProgress[] = [];
    const avisar = limitarProgresso((p) => out.push(p), 500, () => t);
    avisar({ stage: 'rendering', progress: 1, frame: 1, totalFrames: 10 });
    t = 100; avisar({ stage: 'rendering', progress: 2, frame: 2, totalFrames: 10 });
    t = 600; avisar({ stage: 'rendering', progress: 3, frame: 3, totalFrames: 10 });
    t = 650; avisar({ stage: 'encoding', progress: 99, frame: 10, totalFrames: 10 });
    t = 660; avisar({ stage: 'encoding', progress: 100, frame: 10, totalFrames: 10 });
    expect(out.map((p) => p.progress)).toEqual([1, 3, 99, 100]);
  });

  it('frameDoErro lê a propriedade ou a mensagem', () => {
    expect(frameDoErro(Object.assign(new Error('x'), { frame: 388 }))).toBe(388);
    expect(frameDoErro(new Error('Error while rendering frame 12: timeout'))).toBe(12);
    expect(frameDoErro(new Error('sem número'))).toBeNull();
  });

  it('renderConfig lê o .env com padrões', () => {
    expect(renderConfig(() => undefined)).toEqual({ concurrency: 1, tmpDir: '/tmp/maquina-render', bundleDir: null, framesConcurrency: 1, browserExecutable: null, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
    expect(renderConfig((k) => ({ RENDER_CONCURRENCY: '2', REMOTION_BUNDLE_DIR: '../video/dist/bundle' } as Record<string, string>)[k]).concurrency).toBe(2);
  });
});

describe('remix-keep (§13.6)', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
  const md5Audio = (f: string) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', f, '-map', '0:a', '-f', 'md5', '-']).toString().trim();
  const dir = mkdtempSync(path.join(tmpdir(), 'remix-'));
  const campeao = path.join(dir, 'campeao.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=330:d=2:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', campeao]);

  const remixInput = (frameCount: number) => ({
    renderId: `rk${frameCount}`, templateId: 'remix-keep' as const, kind: 'remix-keep' as const,
    canvas: { width: 64, height: 96, fps: 30, frameCount },
    baseVideoUrl: campeao, audioPassthroughUrl: campeao,
    overlays: [{ startFrame: 0, endFrame: 60, region: { x: 0, y: 10, w: 32, h: 32 }, clipUrl: campeao, clipOffsetSec: 0, crop: { x: 0, y: 0, w: 64, h: 64 } }],
    textLayers: [{ id: 'h', startFrame: 0, endFrame: 60, box: { x: 0, y: 0, w: 64, h: 10 },
      background: { kind: 'solid' as const, color: 'linear-gradient(180deg, #f00800 0px, #4f0403 10px)', box: { x: 0, y: 0, w: 64, h: 10 } },
      style: { fontId: 'anton-400' as const, uppercase: true, fontSizePx: 8, lineHeight: 1.1, color: '#fff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' as const },
      content: { kind: 'static' as const, text: 'Novo gancho' } }],
  });

  /** Remotion falso que grava um vídeo MUDO de verdade com 60 frames (o render do remix sai sem áudio). */
  const portRemix = (): RemotionPort & { chamadas: Record<string, unknown>[] } => {
    const chamadas: Record<string, unknown>[] = [];
    return {
      chamadas,
      ensureBrowser: async () => undefined,
      bundle: async () => '/bundle-fake',
      selectComposition: async (o) => { chamadas.push({ select: o.id }); return { width: 64, height: 96, fps: 30, durationInFrames: 60 }; },
      renderMedia: async (o) => {
        chamadas.push(o);
        ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=30', '-frames:v', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', String(o.outputLocation)]);
        o.onProgress({ progress: 1, renderedFrames: 60, encodedFrames: 60 });
      },
      renderStill: async (o) => { writeFileSync(String(o.output), Buffer.alloc(10)); },
    };
  };

  it('compõe RemixKeep mudo, cola sobre o campeão decodificado (fora da máscara = campeão) e copia o áudio (md5 igual)', async () => {
    const port = portRemix();
    const r = await novoServico(port).render(remixInput(60), () => undefined);
    expect(port.chamadas[0]).toEqual({ select: 'RemixKeep' });
    const media = port.chamadas[1];
    expect(media).toMatchObject({ muted: true, crf: 10, imageFormat: 'png', colorSpace: 'bt709' });
    expect(String(media.outputLocation)).toMatch(/\.mudo\.mp4$/);
    expect(md5Audio(r.outputPath)).toBe(md5Audio(campeao));
    expect(path.basename(path.dirname(r.outputPath))).toBe('rk60');   // pasta própria: o backend apaga dirname
    // fora da máscara (região 0,10 32x32 e faixa 0,0 64x10 + 4 px) o pixel é o do campeão (o render falso é outro vídeo)
    const out = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', r.outputPath, '-i', campeao, '-filter_complex',
      '[0:v]crop=64:50:0:46[a];[1:v]crop=64:50:0:46[b];[a][b]psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr as string;
    const psnrMedia = Number(/average:([\d.]+|inf)/.exec(out)?.[1].replace('inf', '99'));
    expect(psnrMedia).toBeGreaterThanOrEqual(40);
    expect(existsSync(String(media.outputLocation))).toBe(false); // intermediário apagado
  });

  it('nº de frames diferente do campeão = RENDER_ERROR (nada de peça esticada até o áudio)', async () => {
    await expect(novoServico(portRemix()).render(remixInput(61), () => undefined)).rejects.toMatchObject({ code: 'RENDER_ERROR', message: expect.stringMatching(/nb_frames 60 != campeão 61/) });
  });

  it('crop com aspecto diferente da região é recusado antes de abrir o navegador', async () => {
    const i = remixInput(60);
    i.overlays[0].crop = { x: 0, y: 0, w: 64, h: 32 };
    await expect(novoServico(portRemix()).render(i, () => undefined)).rejects.toBeInstanceOf(RenderError);
  });
});
