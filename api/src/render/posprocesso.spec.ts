// Peça final do remix-keep com o vídeo editado (editor universal F-U2): ffmpeg real com clipes gerados na hora (sem mídia, nada pago).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calibrarY, comporSobreOCampeao, contarFrames } from './posprocesso';
import type { RemixKeepRenderInput } from './contrato';

const ff = { ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
const W = 320, H = 320, FPS = 30, N = 150;

// ffmpeg real: com a suíte inteira em paralelo, um teste passa dos 5 s padrão do jest
jest.setTimeout(30_000);

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
  it('fora da máscara = base ± 1 (sem os 6,3 % de vazamento do Y=16 da máscara, troca-texto §16.7)', async () => {
    // base 102 e render 188 (cinza): com o bug, fora saía 107-108; dentro da caixa, o render; depois do intervalo, a base
    const base = join(dir, 'base-cinza.mp4');
    execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x666666:s=${W}x${H}:r=${FPS}:d=2`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-shortest', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', base]);
    const mudo = clipe('m-cinza.mp4', '0xBCBCBC', 60, false);
    const saida = join(dir, 'mascara.mp4');
    const region = { x: 100, y: 100, w: 50, h: 50 };
    await comporSobreOCampeao(ff, { ...input(60), baseVideoUrl: base, audioPassthroughUrl: base,
      overlays: [{ startFrame: 0, endFrame: 30, region, clipUrl: '', clipOffsetSec: 0, crop: region }] }, mudo, saida);
    const y = (f: string, frame: number, x: number, yy: number) => execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', f,
      '-vf', `select=eq(n\\,${frame}),format=gray,crop=10:10:${x}:${yy},scale=1:1:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-'])[0];
    const ref = y(base, 10, 10, 10);
    for (const frame of [10, 45]) {
      expect(Math.abs(y(saida, frame, 10, 10) - ref)).toBeLessThanOrEqual(1);
      expect(Math.abs(y(saida, frame, 250, 250) - ref)).toBeLessThanOrEqual(1);
    }
    expect(y(saida, 10, 120, 120) - ref).toBeGreaterThan(60);          // dentro, no intervalo: render
    expect(Math.abs(y(saida, 45, 120, 120) - ref)).toBeLessThanOrEqual(1); // dentro, fora do intervalo: base
  });
  it('áudio copiado = duração do vídeo ± 1 quadro, também com áudio mais longo (ffmpeg 5.1 cortava ~1,8 s com -frames:v)', async () => {
    const longo = join(dir, 'longo.mp4');   // vídeo de 5 s com 7 s de áudio: a peça fica nos 5 s
    execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:s=${W}x${H}:r=${FPS}:d=${N / FPS}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${N / FPS + 2}`, '-c:a', 'aac', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longo]);
    const videoSec = (f: string) => Number(execFileSync(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' }).trim());
    for (const [nome, base] of [['igual', campeao], ['longo', longo]] as const) {
      const saida = join(dir, `audio-${nome}.mp4`);
      await comporSobreOCampeao(ff, { ...input(N), baseVideoUrl: base, audioPassthroughUrl: base }, clipe(`m-a-${nome}.mp4`, 'red', N, false), saida);
      expect(await contarFrames(ff, saida)).toBe(N);
      expect(Math.abs(audioSec(saida) - videoSec(saida))).toBeLessThanOrEqual(1 / FPS);
    }
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

  // troca-texto §16.2 A8 (F1b, V3): caixa copiada = máscara exata; placa de base = Y calibrado no render
  const cinza = (nome: string, hex: string, frames: number, audio: boolean) => {
    const f = join(dir, nome);
    execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex}:s=${W}x${H}:r=${FPS}:d=${frames / FPS}`,
      ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${frames / FPS}`, '-c:a', 'aac', '-shortest'] : []), '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', f]);
    return f;
  };
  const yDe = (f: string, frame: number, x: number, yy: number) => execFileSync(ff.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', f,
    '-vf', `select=eq(n\\,${frame}),format=gray,crop=4:4:${x}:${yy},scale=1:1:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-'])[0];
  const camadaTexto = (o: Partial<RemixKeepRenderInput['textLayers'][number]>): RemixKeepRenderInput['textLayers'][number] => ({
    id: 'headline-nova', startFrame: 0, endFrame: 30, box: { x: 100, y: 100, w: 40, h: 40 }, background: { kind: 'none', color: null, box: null },
    style: { fontId: 'inter-600', uppercase: false, fontSizePx: 30, lineHeight: 1.2, color: '#fff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
    content: { kind: 'static', text: 'x' }, ...o,
  });
  it('caixa com imagem medida: a máscara é a caixa exata, sem o pad de 4 px', async () => {
    const base = cinza('b-caixa.mp4', '0x666666', 60, true);
    const saida = join(dir, 'caixa-exata.mp4');
    const camada = camadaTexto({ background: { kind: 'solid', color: '#000', box: { x: 100, y: 100, w: 60, h: 60 }, image: 'data:image/png;base64,' } });
    await comporSobreOCampeao(ff, { ...input(60), baseVideoUrl: base, audioPassthroughUrl: base, textLayers: [camada] }, cinza('m-caixa.mp4', '0xBCBCBC', 60, false), saida);
    const ref = yDe(base, 10, 10, 10);
    expect(yDe(saida, 10, 120, 120) - ref).toBeGreaterThan(60);                 // dentro da caixa: render
    expect(Math.abs(yDe(saida, 10, 95, 120) - ref)).toBeLessThanOrEqual(1);     // 1-5 px fora: base (antes, o pad pintava)
    expect(Math.abs(yDe(saida, 10, 161, 120) - ref)).toBeLessThanOrEqual(1);
   }, 30_000);
  it('A8: render 2 Y abaixo da placa = +2 só no render; fora de ± 4 = RENDER_ERROR', async () => {
    const placa = cinza('placa.mp4', '0x666666', 60, false);
    const camp = cinza('camp-a8.mp4', '0x666666', 60, true);
    const mudo = cinza('m-a8.mp4', '0x646464', 60, false);       // 0x66 − 2: o OffthreadVideo escurece a placa
    const i8: RemixKeepRenderInput = { ...input(60), baseVideoUrl: placa, audioPassthroughUrl: camp, placaComoBase: true, textLayers: [camadaTexto({})] };
    expect(await calibrarY(ff, i8, mudo)).toBe(2);   // antes de compor: o compositor apaga o mudo
    const saida = join(dir, 'a8.mp4');
    await comporSobreOCampeao(ff, i8, mudo, saida);
    const ref = yDe(placa, 10, 10, 10);
    expect(Math.abs(yDe(saida, 10, 110, 110) - ref)).toBeLessThanOrEqual(1);   // dentro da máscara, corrigido
    expect(Math.abs(yDe(saida, 10, 250, 250) - ref)).toBeLessThanOrEqual(1);   // fora: a placa
    expect(Math.abs(audioSec(saida) - 2)).toBeLessThan(0.1);
    await expect(calibrarY(ff, i8, cinza('m-a8-ruim.mp4', '0x5A5A5A', 60, false))).rejects.toThrow(/A8/);
   }, 30_000);
});
