// legenda-protegida-v1 §2.3: conferência da versão sem legenda (regras puras + ffmpeg de verdade em vídeos gerados).
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { VersaoSemLegendaService, cleanCheckTimes, cleanProbeMismatch, contentMatches, maskOf, parsePsnr } from './versao-sem-legenda';

const exec = promisify(execFile);
const P = { durationSec: 10, width: 1080, height: 1920, fps: 30 };

describe('regras', () => {
  it('duração ±0,1 s, resolução e fps, nessa ordem', () => {
    expect(cleanProbeMismatch(P, { ...P, durationSec: 10.08 })).toBeNull();
    expect(cleanProbeMismatch(P, { ...P, durationSec: 10.2 })).toBe('duration');
    expect(cleanProbeMismatch(P, { ...P, width: 720 })).toBe('resolution');
    expect(cleanProbeMismatch(P, { ...P, fps: 25 })).toBe('fps');
  });
  it('máscara = envoltória das faixas dentro do quadro; PSNR e veredito', () => {
    expect(maskOf([{ x: -5, y: 1000, w: 500, h: 100, startSec: 0, endSec: 1 }, { x: 400, y: 1500, w: 800, h: 100, startSec: 1, endSec: 2 }], P)).toEqual({ x: 0, y: 1000, w: 1080, h: 600 });
    expect(maskOf([], P)).toBeNull();
    expect(parsePsnr('[Parsed_psnr_0] PSNR y:40.1 u:41 v:42 average:40.52 min:40 max:41')).toBe(40.52);
    expect(parsePsnr('average:inf min:inf')).toBe(Infinity);
    expect(contentMatches([35, Infinity])).toBe(true);
    expect(contentMatches([35, 22])).toBe(false);
    expect(contentMatches([null])).toBe(false);
    expect(cleanCheckTimes(14)).toEqual([2, 4, 6, 8, 10, 12]);
  });
});

describe('assertSameVideo (ffmpeg real)', () => {
  let dir: string;
  const gen = async (name: string, extra: string) => {
    const out = join(dir, name);
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=30:d=3', '-vf', `format=yuv420p${extra}`, '-c:v', 'libx264', '-crf', '12', out]);
    return out;
  };
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'clean-spec-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  const svc = (probe: typeof P) => new VersaoSemLegendaService(
    { downloadTo: (f: { storageKey: string }, to: string) => copyFile(f.storageKey, to) } as never,
    { probe: async () => probe } as never,
  );
  const band = { x: 20, y: 400, w: 280, h: 60, startSec: 0, endSec: 3 };

  it('o mesmo vídeo com "legenda" (caixa na faixa) passa; outro vídeo = content', async () => {
    const original = await gen('o.mp4', ',drawbox=x=40:y=410:w=240:h=40:color=white:t=fill');
    const clean = await gen('c.mp4', '');
    const other = join(dir, 'x.mp4');
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'smptebars=s=320x568:r=30:d=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', other]);
    const s = svc({ durationSec: 3, width: 320, height: 568, fps: 30 });
    await expect(s.assertSameVideo({ storageKey: original } as never, { storageKey: clean } as never, [band])).resolves.toBeUndefined();
    await expect(s.assertSameVideo({ storageKey: original } as never, { storageKey: other } as never, [band])).rejects.toMatchObject({ code: 'CLEAN_VERSION_MISMATCH', details: { reason: 'content' } });
  }, 60_000);
});
