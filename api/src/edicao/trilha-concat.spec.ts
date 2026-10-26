// Bug 429 (25/10): a trilha de uma variante vira 1 MP4 mudo (cover 1080×1920, 30 fps), na duração exata de cada trecho.
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BrollProvenance } from '@maquina/contratos';
import { baixarComEspera, chaveDaTrilha, chaveDoStorage, concatenarTrilha, filtroDoTrecho, posicoesNoArquivo, trilhaNoArquivo } from './trilha-concat';
import type { BrollTrack } from './trilha-broll';

const run = promisify(execFile);
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const FP = process.env.FFPROBE_PATH || 'ffprobe';
jest.setTimeout(120_000);
const prov = (n: number): BrollProvenance => ({ provider: 'pexels', sourceUrl: `https://pexels.com/v/${n}`, creator: 'Ana', license: 'Pexels License', licenseCommercialOk: true, startSec: 0, endSec: 3 });

describe('trilha num arquivo só', () => {
  const track = (urls: string[]): BrollTrack => ({
    kind: 'broll_track',
    clips: [
      { fromSec: 0, toSec: 2.5, fileUrl: urls[0], srcStartSec: 0.5, srcEndSec: 3, segmentText: 'a', provenance: prov(1) },
      { fromSec: 2.5, toSec: 6.01, fileUrl: urls[1], srcStartSec: 0, srcEndSec: 1.5, segmentText: 'b', provenance: prov(2) }, // curto: desacelera + segura
      { fromSec: 6.01, toSec: 8, fileUrl: urls[2], srcStartSec: 0, srcEndSec: 2, segmentText: 'c', provenance: { provider: 'generated', model: 'm', prompt: 'p', subject: 's', licenseCommercialOk: true } },
    ],
  });
  it('posições sem deriva, todos os clipes no mesmo arquivo, proveniência intacta', () => {
    const t = track(['https://st/1.mp4?x=1', 'https://st/2.mp4', 'https://st/i.png']);
    expect(posicoesNoArquivo(t).map((p) => p.frames)).toEqual([75, 105, 60]); // 30 fps: 0-75, 75-180, 180-240
    const u = trilhaNoArquivo(t, 'https://st/trilha.mp4');
    expect(u.clips.map((c) => [c.fileUrl, c.srcStartSec, c.srcEndSec, c.fromSec, c.toSec])).toEqual([
      ['https://st/trilha.mp4', 0, 2.5, 0, 2.5], ['https://st/trilha.mp4', 2.5, 6, 2.5, 6.01], ['https://st/trilha.mp4', 6, 8, 6.01, 8],
    ]);
    expect(u.clips.map((c) => c.provenance)).toEqual(t.clips.map((c) => c.provenance));
    expect(chaveDaTrilha(t)).toBe(chaveDaTrilha(track(['https://st/1.mp4?x=2', 'https://st/2.mp4', 'https://st/i.png']))); // URL assinada nova = mesma trilha
    expect(filtroDoTrecho(1.5, 3.5)).toContain('setpts=PTS/0.6');
    expect(filtroDoTrecho(1.5, 3.5)).toContain('tpad=stop_mode=clone');
    expect(filtroDoTrecho(3, 2)).not.toContain('setpts');
  });
  it('ffmpeg de verdade: 1 MP4 mudo 1080×1920 30 fps com o nº exato de frames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'concat-spec-'));
    try {
      const a = join(dir, 'a.mp4'), b = join(dir, 'b.mp4'), i = join(dir, 'i.png');
      await run(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1012x1920:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a]);
      await run(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b]);
      await run(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=1024x1536', '-frames:v', '1', i]);
      const map: Record<string, string> = { 'https://st/a.mp4': a, 'https://st/b.mp4': b, 'https://st/i.png': i };
      const baixados: string[] = [];
      const r = await concatenarTrilha(track(['https://st/a.mp4', 'https://st/b.mp4', 'https://st/i.png']), { baixar: async (u, p) => { baixados.push(u); await copyFile(map[u], p); } });
      try {
        const { stdout } = await run(FP, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'csv=p=0', r.path]);
        expect(stdout.trim()).toBe('1080,1920,30/1,240');
        const audio = await run(FP, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', r.path]);
        expect(audio.stdout.trim()).toBe(''); // mudo
        expect(r.durationSec).toBe(8);
        expect(baixados).toHaveLength(3);
      } finally {
        await rm(r.dir, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('download espera e tenta de novo no 429/5xx; 404 falha na hora', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dl-spec-'));
    try {
      const st = [429, 503, 200];
      let n = 0;
      const fetchImpl = (async () => { const s = st[n++]; return { ok: s === 200, status: s, arrayBuffer: async () => new ArrayBuffer(4) }; }) as unknown as typeof fetch;
      await baixarComEspera('https://x', join(dir, 'f'), { esperaMs: 1, fetchImpl });
      expect(n).toBe(3);
      const f404 = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
      await expect(baixarComEspera('https://x', join(dir, 'g'), { esperaMs: 1, fetchImpl: f404 })).rejects.toThrow(/404/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('chave do objeto pela URL assinada (re-assinar trilha vencida)', () => {
    expect(chaveDoStorage('https://x.storage.supabase.co/storage/v1/s3/hookmill-dev/ws/w1/scene_clip/a%20b.mp4?X-Amz-Expires=1', 'hookmill-dev')).toBe('ws/w1/scene_clip/a b.mp4');
    expect(chaveDoStorage('https://pexels.com/v/1.mp4', 'hookmill-dev')).toBeNull();
  });
});
