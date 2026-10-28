// F7 (lote live 27/10): campeão com o ÁUDIO mais longo que o vídeo. A duração do contêiner (a do áudio) × fps dava mais
// quadros que o stream de vídeo tem; o remix-keep compõe sobre o campeão decodificado (que acaba antes) e o finalize
// recusava: "nb_frames 2544 != campeão 2547". Fixture gerada com o ffmpeg local: vídeo 2 s (60 quadros a 30 fps) +
// áudio 2,5 s. Render local com o Remotion falso (grava o mudo com o nº de quadros da composição = canvas.frameCount,
// como o de verdade) e o pós-processo real (ffmpeg): compõe, conta os quadros e confere.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AutoEditContext } from './auto-edit';
import { buildHeadlineInput, quadrosDoCampeao } from './headline';
import { contarFrames } from './posprocesso';
import { RemotionRenderService, type RemotionPort } from './remotion-render.service';
import type { RemixKeepRenderInput } from './contrato';

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
const duracaoDoConteiner = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString().trim());

const dir = mkdtempSync(path.join(tmpdir(), 'headline-quadros-'));
const campeao = path.join(dir, 'campeao.mp4');
// sem -shortest: o contêiner dura o áudio (2,5 s), o vídeo tem 60 quadros
ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=330:d=2.5:sample_rate=44100',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', campeao]);

const estilo = { fontId: 'inter-800', uppercase: false, fontSizePx: 33, lineHeight: 1.15, color: '#FFFFFF', highlightColor: '#FF5FAE', strokeColor: '#E0207F', strokeWidthPx: 3, shadow: true, align: 'center' } as const;
const ctxDo = (durationSec: number, frameCount: number): AutoEditContext => ({
  renderId: 'h-quadros', type: 'HEADLINE' as never, params: { type: 'HEADLINE' } as never, language: 'zh-TW',
  source: { videoUrl: campeao, width: 720, height: 1280, fps: 30, durationSec, hasAudio: true },
  editMap: {
    version: 1, width: 720, height: 1280, fps: 30, frameCount, cells: [], overlaysOverFace: [], profile: null, faceTrack: [], keepEdit: {} as never,
    layers: [{ id: 'headline-1', kind: 'headline', box: { x: 58, y: 96, w: 605, h: 77 }, startFrame: 0, endFrame: frameCount, text: 'Original',
      background: { kind: 'none', color: null, box: null }, style: estilo, source: 'vision', wordsPerPage: null }],
  } as never,
  words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null,
});

/** Remotion falso: a composição dura `canvas.frameCount` (igual à RemixKeep de verdade) e o mudo sai com esse nº de quadros. */
const portRemix = (): RemotionPort => {
  let n = 0;
  return {
    ensureBrowser: async () => undefined,
    bundle: async () => '/bundle-fake',
    selectComposition: async (o) => {
      n = (o.inputProps as { canvas?: { frameCount: number } }).canvas?.frameCount ?? 0;
      return { width: 720, height: 1280, fps: 30, durationInFrames: n };
    },
    renderMedia: async (o) => {
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30', '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', String(o.outputLocation)]);
      o.onProgress({ progress: 1, renderedFrames: n, encodedFrames: n });
    },
    renderStill: async (o) => { writeFileSync(String(o.output), Buffer.alloc(10)); },
  };
};
const servico = () => new RemotionRenderService({ concurrency: 1, tmpDir: mkdtempSync(path.join(dir, 'r-')), bundleDir: null, framesConcurrency: 1, browserExecutable: null }, portRemix());
const spec = { mode: 'replace' as const, text: '開會只敢聽、不敢講？', highlight: null, language: 'zh-TW', brandColor: '#0008FF', plateColor: '#101010' };

describe('HEADLINE com áudio mais longo que o vídeo (F7)', () => {
  jest.setTimeout(120_000);
  const durationSec = duracaoDoConteiner(campeao);
  let reais = 0;
  beforeAll(async () => { reais = await contarFrames({ ffprobe: 'ffprobe' }, campeao); });

  it('a fixture reproduz o caso: contêiner 2,5 s × 30 = 75, stream de vídeo com 60 quadros', () => {
    expect(durationSec).toBeGreaterThan(2.4);
    expect(reais).toBe(60);
    expect(Math.round(durationSec * 30)).toBe(75);
  });

  it('a conta antiga (duração do contêiner) é recusada pelo finalize: nb_frames 60 != campeão 75', async () => {
    const i = buildHeadlineInput(spec, ctxDo(durationSec, reais));
    const antigo: RemixKeepRenderInput = { ...i, renderId: 'h-antigo', canvas: { ...i.canvas, frameCount: Math.round(durationSec * 30) } };
    await expect(servico().render(antigo, () => undefined)).rejects.toMatchObject({ code: 'RENDER_ERROR', message: 'nb_frames 60 != campeão 75' });
  });

  it('buildHeadlineInput usa os quadros do stream (editMap.frameCount) e o render local passa com o áudio do campeão', async () => {
    const i = buildHeadlineInput(spec, ctxDo(durationSec, reais));
    expect(i.canvas.frameCount).toBe(60);
    expect(i.textLayers[0].endFrame).toBeLessThanOrEqual(60);
    const r = await servico().render(i, () => undefined);
    expect(await contarFrames({ ffprobe: 'ffprobe' }, r.outputPath)).toBe(60);
  });

  it('quadrosDoCampeao: mapa manda (reescala pelo fps); sem mapa, cai na duração', () => {
    expect(quadrosDoCampeao({ fps: 29.97, durationSec: 84.991 }, { fps: 29.97, frameCount: 2544 })).toBe(2544);
    expect(quadrosDoCampeao({ fps: 60, durationSec: 2.5 }, { fps: 30, frameCount: 60 })).toBe(120);
    expect(quadrosDoCampeao({ fps: 30, durationSec: 2 }, null)).toBe(60);
  });
});
