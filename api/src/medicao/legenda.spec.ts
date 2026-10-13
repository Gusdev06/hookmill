// Jest do captionBox (legenda sem fundo, caixa medida por pixel) com vídeo sintético: fundo que muda (degradê),
// gancho fixo em cima (listras claras que nunca mudam) e "legenda" que troca de página (listras em outra posição).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMediaAnalysisService } from './media-analysis.service';

jest.setTimeout(120_000);
const svc = new FfmpegMediaAnalysisService();
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
let dir: string, comLegenda: string, semLegenda: string;
const instantes = [0.3, 0.7, 1.3, 1.7, 2.3, 2.7];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'legenda-'));
  comLegenda = join(dir, 'com.mp4'); semLegenda = join(dir, 'sem.mp4');
  const fundo = ['-f', 'lavfi', '-i', 'gradients=s=720x1280:r=30:d=3:speed=0.05'];
  // "letras" = listras claras de 3 px a cada 6 px sobre escuro (faixa preta embaixo, como o podcast)
  const listras = (w: number) => ['-f', 'lavfi', '-i', `color=c=black:s=${w}x40:r=30:d=3,drawgrid=w=6:h=1000:t=3:c=white`];
  ff([...fundo, ...listras(300), ...listras(300), ...listras(300), ...listras(500),
    '-filter_complex', [
      '[0:v]drawbox=x=0:y=960:w=720:h=120:c=black:t=fill[b]',
      '[b][4:v]overlay=110:100[g]',                                              // gancho fixo
      "[g][1:v]overlay=200:1000:enable='lt(t,1)'[p1]",
      "[p1][2:v]overlay=150:1000:enable='between(t,1,2)'[p2]",
      "[p2][3:v]overlay=260:1000:enable='gte(t,2)',format=yuv420p[v]",
    ].join(';'), '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', comLegenda]);
  ff([...fundo, ...listras(500), '-filter_complex', '[0:v][1:v]overlay=110:100,format=yuv420p[v]', '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', semLegenda]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('captionBox', () => {
  it('acha a faixa da legenda que muda, mesmo com a caixa da visão errada; o gancho fixo não conta', async () => {
    const r = await svc.captionBox(comLegenda, instantes, { x: 72, y: 589, w: 576, h: 64 });
    expect(r).not.toBeNull();
    // letras em y 1003-1039 (o drawgrid pinta uma linha cheia de 3 px no topo: claro sem escuro do lado não é letra),
    // x 150-559; folga 0,65 × 37 = 24 → caixa y 979-1064
    expect(Math.abs(r!.y - 979)).toBeLessThanOrEqual(4);
    expect(Math.abs(r!.y + r!.h - 1064)).toBeLessThanOrEqual(4);
    expect(r!.x).toBeLessThanOrEqual(150);
    expect(r!.x + r!.w).toBeGreaterThanOrEqual(556);
    expect(r!.y).toBeGreaterThan(300);   // nunca a faixa do gancho (y 100-140)
  });
  it('sem legenda (só texto fixo e fundo liso que muda) = null', async () => {
    expect(await svc.captionBox(semLegenda, instantes, null)).toBeNull();
  });
  it('menos de 2 instantes = null', async () => {
    expect(await svc.captionBox(comLegenda, [1], null)).toBeNull();
  });
});
