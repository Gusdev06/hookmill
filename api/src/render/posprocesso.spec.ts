// Peça final do remix-keep com o vídeo editado (editor universal F-U2): ffmpeg real com clipes gerados na hora (sem mídia, nada pago).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comporSobreOCampeao, contarFrames } from './posprocesso';
import type { RemixKeepRenderInput } from './contrato';

const ff = { ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
const W = 320, H = 320, FPS = 30, N = 150;

describe('comporSobreOCampeao com edição de vídeo', () => {
  let dir: string, campeao: string;
  /** campeão azul com áudio; o "render" do Remotion é vermelho (dá pra saber de quem é cada pixel). */
  const clipe = (nome: string, cor: string, frames: number, audio: boolean) => {
    const f = join(dir, nome);
    execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=${W}x${H}:r=${FPS}:d=${frames / FPS}`,
      ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${frames / FPS}`, '-c:a', 'aac', '-shortest'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    return f;
  };
  const cor = (f: string, frame: number) => {
    const b = execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', f, '-vf', `select=eq(n\\,${frame}),scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    return [b[0], b[1], b[2]];
  };
  const audioSec = (f: string) => Number(execFileSync(ff.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' }).trim());
  const input = (frameCount: number, edicao?: RemixKeepRenderInput['edicao']): RemixKeepRenderInput => ({
    renderId: 'r', templateId: 'remix-keep', kind: 'remix-keep', canvas: { width: W, height: H, fps: FPS, frameCount },
    baseVideoUrl: campeao, audioPassthroughUrl: campeao, overlays: [], textLayers: [], ...(edicao && { edicao }),
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'posproc-'));
    campeao = clipe('campeao.mp4', 'blue', N, true);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sem edição: fora da máscara é o campeão, com a duração dele', async () => {
    const saida = join(dir, 'a.mp4');
    await comporSobreOCampeao(ff, input(N), clipe('m1.mp4', 'red', N, false), saida);
    expect(await contarFrames(ff, saida)).toBe(N);
    expect(cor(saida, 10)[2]).toBeGreaterThan(200);
    expect(audioSec(saida)).toBeCloseTo(N / FPS, 0);
  });
  it('aparado: nb_frames e áudio do corte; a base continua sendo o campeão', async () => {
    const saida = join(dir, 'b.mp4');
    await comporSobreOCampeao(ff, input(60, { video: { inFrame: 30, pintura: null } }), clipe('m2.mp4', 'red', 60, false), saida);
    expect(await contarFrames(ff, saida)).toBe(60);
    expect(cor(saida, 10)[2]).toBeGreaterThan(200);
    expect(Math.abs(audioSec(saida) - 2)).toBeLessThan(0.1);
  });
  it('caixa/enquadramento: vale o render inteiro, sem o campeão por baixo', async () => {
    const saida = join(dir, 'c.mp4');
    const pintura = { box: { x: 0, y: 0, w: W, h: H / 2 }, reframe: { mode: 'manual' as const, fit: 'cover' as const, zoom: 1, dx: 0, dy: 0 }, contentBox: null };
    await comporSobreOCampeao(ff, input(60, { video: { inFrame: 30, pintura } }), clipe('m3.mp4', 'red', 60, false), saida);
    expect(await contarFrames(ff, saida)).toBe(60);
    expect(cor(saida, 10)[0]).toBeGreaterThan(200);
    expect(Math.abs(audioSec(saida) - 2)).toBeLessThan(0.1);
  });
});
