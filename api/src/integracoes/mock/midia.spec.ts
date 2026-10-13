// Gera a mídia sintética de verdade com o ffmpeg local e confere com ffprobe que o arquivo decodifica
// e tem a duração/dimensão pedida (é o que o backend vai validar no ingestFromUrl).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureMockMedia, mockMediaUrl, mockVoiceSampleUrl, seedOf } from './midia';

const dir = mkdtempSync(join(tmpdir(), 'mock-media-test-'));
beforeAll(() => (process.env.INTEGRACOES_MOCK_MEDIA_DIR = dir));
afterAll(() => {
  delete process.env.INTEGRACOES_MOCK_MEDIA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function probe(path: string) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path]).toString();
  return JSON.parse(out) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration?: string } };
}

const seed = seedOf('teste');

it('vídeo: H.264 + áudio, duração e formato pedidos, decodifica inteiro', async () => {
  const f = await ensureMockMedia({ kind: 'video', seed, format: 'PORTRAIT_4_5', sec: 3 });
  expect(f.mimeType).toBe('video/mp4');
  const p = probe(f.path);
  expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(p.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 432, height: 540 });
  expect(Number(p.format.duration)).toBeCloseTo(3, 0);
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', f.path, '-f', 'null', '-']); // lança se truncado/corrompido
}, 60_000);

it('áudio WAV e rosto PNG', async () => {
  const a = await ensureMockMedia({ kind: 'audio', seed, sec: 2 });
  expect(Number(probe(a.path).format.duration)).toBeCloseTo(2, 1);
  const img = await ensureMockMedia({ kind: 'face', seed });
  expect(probe(img.path).streams[0]).toMatchObject({ codec_type: 'video', width: 720, height: 1280 });
}, 60_000);

it('cache: segunda chamada devolve o mesmo arquivo', async () => {
  const a = await ensureMockMedia({ kind: 'audio', seed, sec: 2 });
  const b = await ensureMockMedia({ kind: 'audio', seed, sec: 2 });
  expect(b.path).toBe(a.path);
});

it('rejeita semente/formato inválidos (não vira gerador aberto)', async () => {
  await expect(ensureMockMedia({ kind: 'video', seed: '../etc' })).rejects.toThrow('invalid seed');
  await expect(ensureMockMedia({ kind: 'video', seed, format: 'X' as never })).rejects.toThrow('invalid format');
});

it('URLs', () => {
  expect(mockMediaUrl('http://h/', { kind: 'video', seed, format: 'SQUARE_1_1', sec: 99 })).toBe(`http://h/api/v1/mock-media/video/${seed}.mp4?format=SQUARE_1_1&sec=30`);
  expect(mockVoiceSampleUrl('http://h', 'Calm_Woman')).toBe('http://h/api/v1/mock-media/voice/Calm_Woman.wav');
});
