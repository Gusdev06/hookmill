// Jest das peças de mídia do §13.15 (Trocar avatar com Kling/Seedance) com clipes sintéticos do ffmpeg (sem rede, nada pago).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMediaAnalysisService } from './media-analysis.service';
import { closeFaceDetector, sfaceModelPath } from './rostos';

jest.setTimeout(180_000);

const svc = new FfmpegMediaAnalysisService();
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
const probe = (f: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries',
  'stream=codec_type,nb_read_packets,avg_frame_rate,width,height:format=duration', '-of', 'json', f]).toString());
const nFrames = (f: string) => Number(probe(f).streams.find((s: any) => s.codec_type === 'video').nb_read_packets);
const temAudio = (f: string) => probe(f).streams.some((s: any) => s.codec_type === 'audio');
const audioDur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration',
  '-of', 'default=nw=1:nk=1', f]).toString().trim());
/** rgb24 cru de 1 frame (png ou frame n de um vídeo), reduzido pra 64x64 */
const rgb = (f: string, n?: number) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', f,
  '-vf', `${n === undefined ? '' : `select=eq(n\\,${n}),`}scale=64:64:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const dif = (a: Buffer, b: Buffer) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };

let dir: string;
let a24: string;      // 2 s, 24 fps, 320x240, com som (janela do motor com voz)
let b24: string;      // 1 s, 24 fps, outra cena, com som
let mudo24: string;   // 1 s, 24 fps, sem som (janela CHAMPION_AUDIO)
let fala30: string;   // 2 s, 30 fps, com som
const FIX = join(__dirname, '__fixtures__');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'troca-motor-'));
  a24 = join(dir, 'a24.mp4'); b24 = join(dir, 'b24.mp4'); mudo24 = join(dir, 'mudo24.mp4'); fala30 = join(dir, 'fala30.mp4');
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', ...enc, '-c:a', 'aac', '-shortest', a24]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=320x240:r=24', '-f', 'lavfi', '-i', 'sine=f=660:d=1', '-t', '1', ...enc, '-c:a', 'aac', b24]);
  ff(['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=24:d=1', ...enc, mudo24]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2', ...enc, '-c:a', 'aac', '-shortest', fala30]);
});
afterAll(async () => { rmSync(dir, { recursive: true, force: true }); await closeFaceDetector(); });

describe('trimToFrames', () => {
  it('corta no nº exato de frames na fps do campeão (24 → 30 fps), som junto', async () => {
    const out = join(dir, 'trim.mp4');
    await svc.trimToFrames(a24, 47, 30, out);
    expect(nFrames(out)).toBe(47);
    expect(temAudio(out)).toBe(true);
    expect(Math.abs(audioDur(out) - 47 / 30)).toBeLessThan(0.03);
  });
  it('clipe curto: repete o último frame até completar', async () => {
    const out = join(dir, 'trim-longo.mp4');
    await svc.trimToFrames(mudo24, 45, 30, out);   // 1 s de fonte → 1,5 s
    expect(nFrames(out)).toBe(45);
    expect(dif(rgb(out, 44), rgb(out, 35))).toBeLessThan(1);   // o fim é o último frame congelado
  });
  it('rejeita frameCount inválido', async () => {
    await expect(svc.trimToFrames(a24, 0, 30, join(dir, 'x.mp4'))).rejects.toThrow(RangeError);
  });
});

describe('concatClips', () => {
  it('emenda sem buraco na fps da 1ª, com som quando todas têm som', async () => {
    const out = join(dir, 'concat.mp4');
    const r = await svc.concatClips([a24, b24], out);
    expect(Math.abs(r.durationSec - 3)).toBeLessThan(0.1);
    expect(nFrames(out)).toBe(72);
    expect(temAudio(out)).toBe(true);
    // o frame 48 é o 1º da 2ª janela
    expect(dif(rgb(out, 48), rgb(b24, 0))).toBeLessThan(6);
    expect(dif(rgb(out, 47), rgb(a24, 47))).toBeLessThan(6);
  });
  it('janela muda no meio = saída muda (CHAMPION_AUDIO)', async () => {
    const out = join(dir, 'concat-mudo.mp4');
    await svc.concatClips([mudo24, a24], out);
    expect(temAudio(out)).toBe(false);
    expect(nFrames(out)).toBe(72);
  });
});

describe('lastFrame', () => {
  it('devolve o último frame decodificado (o que aparece na emenda)', async () => {
    const png = await svc.lastFrame(a24, join(dir, 'ultimo.png'));
    const n = nFrames(a24);
    // mesma conversão dos dois lados (frame → png → rgb), senão a escala em yuv × rgb já dá diferença
    const quadro = (k: number) => { const f = join(dir, `q${k}.png`); ff(['-i', a24, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', f]); return rgb(f); };
    expect(dif(rgb(png), quadro(n - 1))).toBe(0);
    expect(dif(rgb(png), quadro(n - 2))).toBeGreaterThan(1);   // não é um frame qualquer do fim
  });
});

describe('timeStretch', () => {
  it.each([0.95, 1.05])('factor %p: duração de vídeo e voz = fonte × factor, mesma fps', async (f) => {
    const out = join(dir, `stretch-${f}.mp4`);
    await svc.timeStretch(fala30, f, out);
    const p = probe(out);
    const v = p.streams.find((s: any) => s.codec_type === 'video');
    expect(v.avg_frame_rate).toBe('30/1');
    expect(Math.abs(nFrames(out) - Math.round(60 * f))).toBeLessThanOrEqual(1);
    expect(Math.abs(audioDur(out) - 2 * f)).toBeLessThan(0.05);
  });
  it('fora de 0,5-2 = erro', async () => {
    await expect(svc.timeStretch(fala30, 3, join(dir, 'x.mp4'))).rejects.toThrow(RangeError);
  });
});

(sfaceModelPath() ? describe : describe.skip)('identityScore (SFace)', () => {
  let clip: string;
  beforeAll(() => {
    // "clipe do motor" com o rosto da fixture: 2 s, leve zoom (o rosto se mexe), 24 fps
    clip = join(dir, 'rosto.mp4');
    ff(['-loop', '1', '-i', join(FIX, 'rosto.jpg'), '-vf', "scale=640:640,zoompan=z='1+0.0015*on':d=48:s=640x640:fps=24", '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip]);
  });
  it('mesmo rosto: mediana alta, nenhuma amostra abaixo de 0,30', async () => {
    const r = await svc.identityScore(clip, join(FIX, 'rosto.jpg'));
    expect(r.samples).toBeGreaterThanOrEqual(4);
    expect(r.median).toBeGreaterThan(0.6);
    expect(r.min).toBeGreaterThanOrEqual(0.3);
  });
  it('rosto trocado: mediana abaixo do limiar 0,363', async () => {
    const r = await svc.identityScore(clip, join(FIX, 'rosto-outro.jpg'));
    expect(r.median).toBeLessThan(0.363);
  });
  it('amostra sem rosto conta 0', async () => {
    const r = await svc.identityScore(a24, join(FIX, 'rosto.jpg'));
    expect(r.min).toBe(0);
    expect(r.median).toBe(0);
  });
});
