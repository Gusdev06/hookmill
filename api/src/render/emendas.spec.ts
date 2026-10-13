// Emendas no silêncio do áudio + trava do teaser do COLD-OPEN (≥ 1,5 s). Áudio sintético do ffmpeg, sem rede.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emendasNoSilencio, valeMaisProximo } from './emendas';

jest.setTimeout(60_000);
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'emendas-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Tom de 4 s com silêncios (s) nos intervalos dados. */
const audio = (nome: string, silencios: [number, number][]) => {
  const f = join(dir, nome);
  const mudo = silencios.map(([a, b]) => `between(t,${a},${b})`).join('+') || '0';
  execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=300:d=4:sample_rate=48000',
    '-af', `volume=eval=frame:volume='if(${mudo},0,1)'`, '-c:a', 'aac', f]);
  return f;
};

describe('valeMaisProximo', () => {
  const env = [...Array(20).fill(-15), ...Array(8).fill(-35), ...Array(30).fill(-16)];
  it('respeita minT e recusa o que não é silêncio', () => {
    expect(valeMaisProximo(env, 16, 16.36)!.t).toBeLessThanOrEqual(16.28);
    expect(valeMaisProximo(env, 16, 16.36, { minT: 16.3 })).toBeNull();
    expect(valeMaisProximo(Array(40).fill(-15), 0, 0.2)).toBeNull();
  });
});

describe('emendasNoSilencio', () => {
  it('teaser não encolhe abaixo de 1,5 s: escolhe o vale mais longe que respeita o mínimo', async () => {
    const f = audio('a.m4a', [[1.0, 1.1], [2.4, 2.48], [2.8, 2.88]]);
    const livre = await emendasNoSilencio('ffmpeg', f, [{ startSec: 1.05, endSec: 2.6 }], 4);
    expect(livre.timeline[0].endSec).toBeCloseTo(2.44, 1);                   // sem trava: 1,39 s
    const r = await emendasNoSilencio('ffmpeg', f, [{ startSec: 1.05, endSec: 2.6 }, { startSec: 0, endSec: 4 }], 4, { minSec: [1.5] });
    const t = r.timeline[0];
    expect(t.endSec - t.startSec).toBeGreaterThanOrEqual(1.5);
    expect(t.endSec).toBeCloseTo(2.84, 1);
    expect(r.timeline[1]).toEqual({ startSec: 0, endSec: 4 });
  });
  it('sem vale que respeite o mínimo, o teaser fica com os tempos originais', async () => {
    const f = audio('b.m4a', [[1.0, 1.1], [2.4, 2.48]]);
    const r = await emendasNoSilencio('ffmpeg', f, [{ startSec: 1.05, endSec: 2.6 }], 4, { minSec: [1.5] });
    expect(r.timeline[0].endSec - r.timeline[0].startSec).toBeGreaterThanOrEqual(1.5);
    expect(r.timeline[0].endSec).toBe(2.6);
  });
  it('borda sem silêncio por perto não se mexe', async () => {
    const f = audio('c.m4a', []);
    const r = await emendasNoSilencio('ffmpeg', f, [{ startSec: 1.0, endSec: 3.0 }], 4);
    expect(r.timeline[0]).toEqual({ startSec: 1.0, endSec: 3.0 });
    expect(r.movidas).toHaveLength(0);
  });
});
