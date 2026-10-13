// Jest do áudio montado e das palavras mescladas (§13.15.4, ENGINE_VOICE). Áudio sintético do ffmpeg, sem rede.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conferirSplice, ganhoDoCampeao, mesclarPalavras, montarAudioSplice } from './troca-motor';

jest.setTimeout(60_000);

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
const pcm = (f: string, rate = 48000) => {
  const b = execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-']);
  return new Int16Array(b.buffer, b.byteOffset, b.length >> 1);
};
/** energia da senoide `hz` na janela [a, b) s (Goertzel simplificado por projeção) */
const tom = (x: Int16Array, hz: number, a: number, b: number, rate = 48000) => {
  let s = 0, c = 0;
  for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) { s += x[i] * Math.sin((2 * Math.PI * hz * i) / rate); c += x[i] * Math.cos((2 * Math.PI * hz * i) / rate); }
  return Math.hypot(s, c) / ((b - a) * rate);
};

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'splice-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('montarAudioSplice', () => {
  it('troca só o span pela voz, com a taxa/canais do campeão e a duração do campeão', async () => {
    const camp = join(dir, 'camp.mp4');
    const voz = join(dir, 'voz.m4a');
    ff(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=48000', '-ac', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', camp]);
    ff(['-f', 'lavfi', '-i', 'sine=f=880:d=2:sample_rate=44100', '-c:a', 'aac', voz]);   // voz mais longa que o span: corta
    const out = join(dir, 'montado.m4a');
    await montarAudioSplice({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, camp, { spans: [{ startFrame: 30, endFrame: 60, url: voz }], fadeMs: 10 },
      { fps: 30, frameCount: 90 }, out);
    const st = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,duration', '-of', 'json', out]).toString()).streams[0];
    expect(Number(st.sample_rate)).toBe(48000);
    expect(st.channels).toBe(2);
    expect(Math.abs(Number(st.duration) - 3)).toBeLessThan(0.05);
    const x = pcm(out);
    // antes e depois do span: só o campeão; dentro: só a voz
    expect(tom(x, 440, 0.1, 0.9)).toBeGreaterThan(20 * tom(x, 880, 0.1, 0.9));
    expect(tom(x, 880, 1.1, 1.9)).toBeGreaterThan(20 * tom(x, 440, 1.1, 1.9));
    expect(tom(x, 440, 2.1, 2.9)).toBeGreaterThan(20 * tom(x, 880, 2.1, 2.9));
    // fora do span o nível do campeão não muda (ganho 1, sem normalização do amix)
    const ref = pcm(camp);
    expect(tom(x, 440, 0.1, 0.9) / tom(ref, 440, 0.1, 0.9)).toBeCloseTo(1, 1);
  });
});

describe('ganhoDoCampeao / conferirSplice', () => {
  it('sem span = 1; com span vira expressão de crossfade', () => {
    expect(ganhoDoCampeao([], 0.01)).toBe('1');
    expect(ganhoDoCampeao([{ a: 1, b: 2 }], 0.01)).toContain('clip(min((t-1.000000)/0.010000,(2.000000-t)/0.010000),0,1)');
  });
  it('rejeita span fora do quadro e sobreposição', () => {
    expect(() => conferirSplice({ spans: [{ startFrame: 0, endFrame: 100, url: 'a' }], fadeMs: 10 }, 90)).toThrow(/fora/);
    expect(() => conferirSplice({ spans: [{ startFrame: 0, endFrame: 50, url: 'a' }, { startFrame: 40, endFrame: 60, url: 'b' }], fadeMs: 10 }, 90)).toThrow(/sobrep/);
  });
});

describe('mesclarPalavras', () => {
  const base = [
    { word: 'antes', startSec: 0.1, endSec: 0.5 },
    { word: 'velha1', startSec: 1.1, endSec: 1.4 },
    { word: 'velha2', startSec: 1.5, endSec: 1.9 },
    { word: 'depois', startSec: 2.2, endSec: 2.6 },
  ];
  it('troca as palavras do trecho pelas novas (relativas ao trecho) e mantém as de fora', () => {
    const r = mesclarPalavras(base, [{ startFrame: 30, endFrame: 60, words: [{ word: 'nova1', startSec: 0.05, endSec: 0.4 }, { word: 'nova2', startSec: 0.5, endSec: 1.2 }] }], 30);
    expect(r.map((w) => w.word)).toEqual(['antes', 'nova1', 'nova2', 'depois']);
    expect(r[1]).toEqual({ word: 'nova1', startFrame: 32, endFrame: 42 });
    expect(r[2].endFrame).toBe(60);              // presa ao fim do trecho
    expect(r[3]).toEqual({ word: 'depois', startFrame: 66, endFrame: 78 });
  });
  it('toda palavra tem ≥ 1 frame e nenhuma sobrepõe a seguinte', () => {
    const r = mesclarPalavras([{ word: 'a', startSec: 0, endSec: 0 }, { word: 'b', startSec: 0.01, endSec: 0.02 }, { word: 'c', startSec: 0.02, endSec: 0.5 }], [], 30);
    for (let i = 0; i < r.length; i++) {
      expect(r[i].endFrame).toBeGreaterThan(r[i].startFrame);
      if (i) expect(r[i].startFrame).toBeGreaterThanOrEqual(r[i - 1].endFrame);
    }
  });
});
