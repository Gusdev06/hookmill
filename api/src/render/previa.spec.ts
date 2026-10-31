// Prévia borrada da amostra (amostra-gratis-v1 §3) com ffmpeg real sobre um MP4 sintético (lavfi testsrc2 + seno).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../medicao/ffmpeg';
import { PREVIEW, SHARP_SEC, gerarPrevia, previaArgs } from './previa';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const W = 480, H = 854; // 1080x1920 → 480 de largura, altura par

/** Variância do Laplaciano (4-vizinhos) do quadro em cinza no instante `t`, na metade de baixo (longe do selo). */
async function nitidez(arquivo: string, t: number): Promise<number> {
  const { stdout } = await run(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', arquivo, '-frames:v', '1',
    '-vf', `scale=${W}:${H},crop=${W}:${H / 2 - 1}:0:${H / 2},format=gray`, '-f', 'rawvideo', 'pipe:1']);
  const w = W, h = H / 2 - 1;
  let soma = 0, soma2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = stdout[i - 1] + stdout[i + 1] + stdout[i - w] + stdout[i + w] - 4 * stdout[i];
    soma += l; soma2 += l * l; n++;
  }
  return soma2 / n - (soma / n) ** 2;
}

describe('prévia borrada da amostra', () => {
  let dir: string;
  let fonte: string;
  let previa: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'previa-'));
    fonte = join(dir, 'final.mp4');
    previa = join(dir, 'preview.mp4');
    await run(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fonte]);
    await gerarPrevia(fonte, previa, { ffmpeg: FFMPEG });
  }, 120_000);

  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('480 de largura, proporção, duração mantida, H.264 + AAC', async () => {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', previa]);
    const j = JSON.parse(stdout.toString()) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format: { duration: string } };
    const v = j.streams.find((s) => s.codec_type === 'video')!;
    const a = j.streams.find((s) => s.codec_type === 'audio')!;
    expect([v.codec_name, v.width, v.height]).toEqual(['h264', PREVIEW.width, H]);
    expect(a.codec_name).toBe('aac');
    expect(Math.abs(Number(j.format.duration) - 6)).toBeLessThan(0.15);
  });

  it('0-3 s nítido como o original; depois borrado, com corte seco', async () => {
    const [orig, antes, quaseCorte, logoDepois, fim] = await Promise.all([
      nitidez(fonte, 1.5), nitidez(previa, 1.5), nitidez(previa, SHARP_SEC - 0.1), nitidez(previa, SHARP_SEC + 0.1), nitidez(previa, 5.5),
    ]);
    // nítido: perto do original reduzido (a codificação crf 28 tira um pouco)
    expect(antes).toBeGreaterThan(orig * 0.5);
    expect(quaseCorte).toBeGreaterThan(orig * 0.5);
    // borrado: cai pra uma fração pequena, já no 1º quadro depois do corte (sem fade)
    expect(logoDepois).toBeLessThan(antes * 0.1);
    expect(fim).toBeLessThan(antes * 0.1);
  });

  it('selo e áudio opcional nos argumentos', () => {
    const args = previaArgs('in.mp4', 'out.mp4', { font: null, sharpSec: 3 });
    const filtro = args[args.indexOf('-filter_complex') + 1];
    expect(filtro).toContain(`text='${PREVIEW.label}'`);
    expect(filtro).toContain("enable='gte(t\\,3)'");
    expect(args).toEqual(expect.arrayContaining(['0:a:0?', '+faststart', 'aac', 'libx264']));
  });
});
