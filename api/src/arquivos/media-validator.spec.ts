import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaInvalidError, validateMedia } from './media-validator';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const d = hasFfmpeg ? describe : describe.skip;

d('validateMedia (arquivo inteiro, ffmpeg real)', () => {
  let dir: string;
  let mp4: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mv-'));
    mp4 = join(dir, 'ok.mp4');
    // moov no fim (padrão do ffmpeg): truncado perde o índice; com faststart o truncado só falha no decode
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-c:a', 'aac', mp4]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:duration=1', '-frames:v', '1', join(dir, 'ok.png')]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('vídeo íntegro: devolve duração e dimensões', async () => {
    const info = await validateMedia(mp4, 'video');
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.durationSec).toBeGreaterThan(1.9);
  });

  it('vídeo truncado pela metade (cabeçalho bom, fim faltando): inválido', async () => {
    const full = readFileSync(mp4);
    const cut = join(dir, 'cut.mp4');
    writeFileSync(cut, full.subarray(0, Math.floor(full.length * 0.6)));
    await expect(validateMedia(cut, 'video')).rejects.toBeInstanceOf(MediaInvalidError);
  });

  it('imagem: valida e mede; vídeo esperado mas veio áudio: inválido', async () => {
    const info = await validateMedia(join(dir, 'ok.png'), 'image');
    expect(info).toMatchObject({ width: 64, height: 64 });
    const wav = join(dir, 'a.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', wav]);
    await expect(validateMedia(wav, 'video')).rejects.toBeInstanceOf(MediaInvalidError);
    await expect(validateMedia(wav, 'audio')).resolves.toMatchObject({ width: null });
  });

  it('arquivo vazio ou lixo: inválido', async () => {
    const empty = join(dir, 'empty.mp4');
    writeFileSync(empty, '');
    await expect(validateMedia(empty, 'video')).rejects.toBeInstanceOf(MediaInvalidError);
    const junk = join(dir, 'junk.mp4');
    writeFileSync(junk, Buffer.from('<html>403 Forbidden</html>'));
    await expect(validateMedia(junk, 'video')).rejects.toBeInstanceOf(MediaInvalidError);
  });
});
