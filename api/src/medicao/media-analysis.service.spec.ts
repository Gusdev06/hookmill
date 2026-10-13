// Jest do MediaAnalysisService com vídeos sintéticos gerados por ffmpeg (sem mídia de terceiro, sem rede).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMediaAnalysisService, kmeansHex, NoAudioError } from './media-analysis.service';
import { MediaInvalidError } from './contrato';
import { halfCliffIndex, bandsFromSignatures, signature, sameStructure } from './layout';

jest.setTimeout(120_000);

const svc = new FfmpegMediaAnalysisService();
let dir: string;
let split: string;   // 0-2 s tela cheia; 2-4 s dividido em y=400 (testsrc em cima, azul liso embaixo); áudio: tom 0-1, silêncio 1-2, tom 2-4
let mute: string;    // sem áudio

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'medicao-'));
  split = join(dir, 'split.mp4');
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=2',
    '-f', 'lavfi', '-i', 'testsrc2=s=360x400:r=30:d=2',
    '-f', 'lavfi', '-i', 'color=c=0x1040c0:s=360x240:r=30:d=2',
    '-f', 'lavfi', '-i', 'sine=f=440:d=1:sample_rate=44100',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
    '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=44100',
    '-filter_complex',
    '[1:v][2:v]vstack[b];[0:v][b]concat=n=2:v=1:a=0,format=yuv420p[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', split,
  ]);
  mute = join(dir, 'mute.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', mute]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('probe / validateFull', () => {
  it('lê dimensão, fps, duração, áudio e codec', async () => {
    const p = await svc.probe(split);
    expect(p).toMatchObject({ width: 360, height: 640, fps: 30, hasAudio: true, videoCodec: 'h264' });
    expect(p.durationSec).toBeGreaterThan(3.9);
    expect(p.durationSec).toBeLessThan(4.2);
    expect((await svc.probe(mute)).hasAudio).toBe(false);
  });

  it('arquivo que não é vídeo = MediaInvalidError undecodable; só áudio = no_video', async () => {
    const junk = join(dir, 'junk.mp4');
    writeFileSync(junk, 'isto não é um mp4');
    await expect(svc.probe(junk)).rejects.toMatchObject({ reason: 'undecodable' });
    const audioOnly = join(dir, 'audio-only.m4a');
    ff(['-f', 'lavfi', '-i', 'sine=d=1', '-c:a', 'aac', audioOnly]);
    await expect(svc.probe(audioOnly)).rejects.toBeInstanceOf(MediaInvalidError);
    await expect(svc.probe(audioOnly)).rejects.toMatchObject({ reason: 'no_video' });
  });

  it('decodifica inteiro o arquivo bom e recusa o truncado', async () => {
    await expect(svc.validateFull(split)).resolves.toBeUndefined();
    // moov no começo (faststart) e mdat cortado pela metade = o "download truncado sem erro" da WaveSpeed
    const fast = join(dir, 'fast.mp4');
    ff(['-i', split, '-c', 'copy', '-movflags', '+faststart', fast]);
    const buf = readFileSync(fast);
    const cut = join(dir, 'truncado.mp4');
    writeFileSync(cut, buf.subarray(0, Math.floor(buf.length * 0.6)));
    await expect(svc.validateFull(cut)).rejects.toMatchObject({ reason: 'undecodable' });
  });
});

describe('áudio', () => {
  it('extractAudio = m4a mono 44,1 kHz; sem áudio = NoAudioError', async () => {
    const out = join(dir, 'a.m4a');
    const r = await svc.extractAudio(split, out);
    expect(r.durationSec).toBeGreaterThan(3.9);
    const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate', '-of', 'csv=p=0', out]).toString().trim();
    expect(info).toBe('aac,44100,1');
    await expect(svc.extractAudio(mute, join(dir, 'x.m4a'))).rejects.toBeInstanceOf(NoAudioError);
  });

  it('silences acha o buraco de 1 a 2 s (a -35 dB, saída do filtro lida)', async () => {
    const a = join(dir, 'a.m4a');
    const s = await svc.silences(a, 0.3);
    expect(s).toHaveLength(1);
    expect(s[0].startSec).toBeCloseTo(1, 1);
    expect(s[0].endSec).toBeCloseTo(2, 1);
  });

  it('sliceAudio corta cada trecho na duração pedida', async () => {
    const files = await svc.sliceAudio(join(dir, 'a.m4a'), [{ startSec: 0.5, endSec: 1.5 }, { startSec: 2, endSec: 3.75 }], join(dir, 'slices'));
    expect(files).toHaveLength(2);
    const d = files.map((f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()));
    expect(d[0]).toBeCloseTo(1, 1);
    expect(d[1]).toBeCloseTo(1.75, 1);
    await expect(svc.sliceAudio(join(dir, 'a.m4a'), [{ startSec: 2, endSec: 2 }], join(dir, 'slices'))).rejects.toBeInstanceOf(RangeError);
  });
});

describe('frames', () => {
  it('keyframes respeita o lado maior e puxa instante além do fim pro último frame', async () => {
    const k = await svc.keyframes(split, [0, 2.5, 99], join(dir, 'kf'), 320);
    expect(k.map((x) => x.atSec)).toEqual([0, 2.5, 99]);
    for (const f of k) {
      expect(statSync(f.path).size).toBeGreaterThan(1000);
      const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f.path]).toString().trim().split(',').map(Number);
      expect(h).toBe(320);
      expect(w).toBe(180);
    }
  });

  it('palette devolve k hex, a cor dominante primeiro', async () => {
    const blue = join(dir, 'blue.png');
    ff(['-f', 'lavfi', '-i', 'color=c=0x1040c0:s=64x64', '-frames:v', '1', blue]);
    const k = await svc.keyframes(split, [3], join(dir, 'kf2'), 640);
    const p = await svc.palette([blue, k[0].path], 4);
    expect(p.length).toBeGreaterThan(0);
    expect(p.length).toBeLessThanOrEqual(4);
    p.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/));
    // JPG/yuv420 mexe uns pontos em cada canal: dominante = o azul, com folga de 8
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    rgb(p[0]).forEach((v, i) => expect(Math.abs(v - rgb('#1040c0')[i])).toBeLessThanOrEqual(8));
    expect(kmeansHex(new Uint8Array(0), 3)).toEqual([]);
  });

  it('cutVideo recodifica cada trecho', async () => {
    const [f] = await svc.cutVideo(split, [{ startSec: 1, endSec: 2.5 }], join(dir, 'cuts'));
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
    expect(d).toBeCloseTo(1.5, 1);
  });
});

describe('measureLayout', () => {
  it('acha o corte de layout em 2 s e a fronteira da faixa em y=400', async () => {
    const m = await svc.measureLayout(split);
    const layout = m.cuts.filter((c) => c.kind === 'layout');
    expect(layout).toHaveLength(1);
    expect(Math.abs(layout[0].atSec - 2)).toBeLessThanOrEqual(0.1);
    expect(m.segments).toHaveLength(2);
    expect(m.segments[0].startSec).toBe(0);
    expect(m.segments[0].endSec).toBe(layout[0].atSec);
    const b = m.segments[1].bands;
    expect(b.length).toBeGreaterThanOrEqual(2);
    const azul = b[b.length - 1];
    expect(Math.abs(azul.y0 - 400)).toBeLessThanOrEqual(2);
    expect(azul.y1).toBe(640);
    expect(azul.role).toBe('unknown'); // faixa lisa
    expect(azul.pct).toBeCloseTo(37.5, 0);
  });
});

describe('peças puras do port', () => {
  const W = 4, H = 100;
  const frame = (fn: (y: number) => number) => {
    const a = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W * 3; x++) a[y * W * 3 + x] = fn(y) + ((x * 7 + y * 13) % 5);
    return signature(a, W, H);
  };

  it('halfCliffIndex marca o 1º frame que passa da meia altura, em corte seco e em flash preto', () => {
    const old = frame(() => 200), neu = frame(() => 60), black = frame(() => 0);
    expect(halfCliffIndex([old, old, neu, neu], old, neu)).toBe(2);
    expect(halfCliffIndex([old, black, black, neu], old, neu)).toBe(1);
    expect(halfCliffIndex([old, old], old, old)).toBe(2);
  });

  it('bandsFromSignatures acha a fronteira estável e sameStructure compara as principais', () => {
    const sig = frame((y) => (y < 60 ? 230 : 20));
    const bands = bandsFromSignatures([sig, sig, sig], H, 8);
    // borda perfeita vira platô depois da suavização e o .py pega o 1º ponto dele (viés de até (k-1)/2 px; mantido)
    expect(bands).toHaveLength(2);
    expect(Math.abs(bands[1].y0 - 60)).toBeLessThanOrEqual(2);
    expect(sameStructure(bands, bands, 4)).toBe(true);
    expect(sameStructure(bands, bandsFromSignatures([frame(() => 120)], H, 8), 4)).toBe(false);
  });
});
