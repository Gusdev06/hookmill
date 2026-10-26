// legenda-protegida-v1 §2.3: "versão sem legenda" do campeão. O usuário sobe o MESMO vídeo sem a legenda queimada; o backend
// confere (duração ±0,1 s, mesma resolução e fps, PSNR fora da faixa protegida ≥ 30 dB em 6 quadros) e grava em
// `champions.clean_video_file_id`. Daí em diante ela é a fonte de todas as peças (edicao.autoContext) e o plano não protege
// a faixa. Não conferiu = 422 CLEAN_VERSION_MISMATCH { reason }. As regras são funções puras; o ffmpeg fica na borda.
import { Inject, Injectable } from '@nestjs/common';
import type { ProtectedBand } from '@maquina/contratos';
import type { File as FileRow } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { StorageService } from '../arquivos/storage.service';
import { AppException } from '../common/errors/app-exception';
import { MEDIA_ANALYSIS, type MediaAnalysisService } from './portas';

const exec = promisify(execFile);

export const CLEAN_DURATION_TOLERANCE_SEC = 0.1;
export const CLEAN_FPS_TOLERANCE = 0.01;
export const CLEAN_MIN_PSNR_DB = 30;
export const CLEAN_FRAMES = 6;

export type CleanMismatch = 'duration' | 'resolution' | 'fps' | 'content';
type Probe = { durationSec: number; width: number; height: number; fps: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Duração, resolução e fps (a ordem do 422). null = bate. */
export function cleanProbeMismatch(original: Probe, clean: Probe): CleanMismatch | null {
  if (Math.abs(original.durationSec - clean.durationSec) > CLEAN_DURATION_TOLERANCE_SEC) return 'duration';
  if (original.width !== clean.width || original.height !== clean.height) return 'resolution';
  if (Math.abs(original.fps - clean.fps) > CLEAN_FPS_TOLERANCE * Math.max(1, original.fps)) return 'fps';
  return null;
}

/** 6 instantes espalhados (sem a 1ª e a última fração, onde fade/quadro preto confundem). */
export function cleanCheckTimes(durationSec: number, n = CLEAN_FRAMES): number[] {
  return Array.from({ length: n }, (_, k) => Math.round(((k + 1) / (n + 1)) * durationSec * 100) / 100);
}

/** Área tapada nas duas imagens antes do PSNR: a envoltória das faixas (a legenda some só ali). */
export function maskOf(bands: ProtectedBand[], dim: { width: number; height: number }): Rect | null {
  if (!bands.length) return null;
  const x0 = Math.max(0, Math.min(...bands.map((b) => b.x))), y0 = Math.max(0, Math.min(...bands.map((b) => b.y)));
  const x1 = Math.min(dim.width, Math.max(...bands.map((b) => b.x + b.w))), y1 = Math.min(dim.height, Math.max(...bands.map((b) => b.y + b.h)));
  return x1 > x0 && y1 > y0 ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) } : null;
}

/** `average:NN.NN` (ou `inf`, imagens iguais) da saída do filtro psnr. */
export function parsePsnr(stderr: string): number | null {
  const m = /average:(inf|[\d.]+)/.exec(stderr);
  if (!m) return null;
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

/** O conteúdo bate quando TODO quadro tem PSNR (fora da faixa) ≥ 30 dB. */
export function contentMatches(psnrs: (number | null)[]): boolean {
  return psnrs.length > 0 && psnrs.every((p) => p !== null && p >= CLEAN_MIN_PSNR_DB);
}

@Injectable()
export class VersaoSemLegendaService {
  private readonly ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

  constructor(
    private readonly storage: StorageService,
    @Inject(MEDIA_ANALYSIS) private readonly media: MediaAnalysisService,
  ) {}

  /** Lança 422 CLEAN_VERSION_MISMATCH { reason } quando não é o mesmo vídeo. */
  async assertSameVideo(original: FileRow, clean: FileRow, bands: ProtectedBand[]): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'sem-legenda-'));
    try {
      const a = join(dir, `original${extname(original.storageKey) || '.mp4'}`);
      const b = join(dir, `clean${extname(clean.storageKey) || '.mp4'}`);
      await Promise.all([this.storage.downloadTo(original, a), this.storage.downloadTo(clean, b)]);
      const [pa, pb] = await Promise.all([this.media.probe(a), this.media.probe(b)]);
      const bad = cleanProbeMismatch(pa, pb);
      if (bad) throw new AppException('CLEAN_VERSION_MISMATCH', { reason: bad });
      const mask = maskOf(bands, pa);
      const psnrs: (number | null)[] = [];
      for (const t of cleanCheckTimes(pa.durationSec)) psnrs.push(await this.psnrAt(a, b, t, mask));
      if (!contentMatches(psnrs)) throw new AppException('CLEAN_VERSION_MISMATCH', { reason: 'content' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async psnrAt(a: string, b: string, t: number, mask: Rect | null): Promise<number | null> {
    const box = mask ? `drawbox=x=${mask.x}:y=${mask.y}:w=${mask.w}:h=${mask.h}:color=black:t=fill,` : '';
    const graph = `[0:v]${box}format=yuv420p[a];[1:v]${box}format=yuv420p[b];[a][b]psnr`;
    try {
      const { stderr } = await exec(this.ffmpeg, ['-hide_banner', '-ss', t.toFixed(2), '-i', a, '-ss', t.toFixed(2), '-i', b, '-frames:v', '1', '-lavfi', graph, '-f', 'null', '-'], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      return parsePsnr(stderr);
    } catch (e) {
      return parsePsnr((e as { stderr?: string }).stderr ?? '');
    }
  }
}
