// Editor universal v1 §8: proxy 540p dos vídeos que o Player do editor toca (o render continua com o original). H.264
// baseline, 540 de largura, mesmo fps, GOP 1 s, crf 28, AAC 96k quando tem áudio. `files` kind PROXY com
// `proxy_of_file_id` = original (apagado junto, FK cascade). Custo US$ 0 (CPU da API).
// Fila em memória (1 por vez, sem repetir o mesmo original): a linha PROXY no banco é o estado. Se a API reiniciar no
// meio, o próximo GET /editor (ou o próximo lote) enfileira de novo. Sem JobType novo: a §11 do contrato não tem.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { File as FileRow } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { StorageService } from '../arquivos/storage.service';
import { num } from '../common/util/format';
import { PrismaService } from '../prisma/prisma.service';

const run = promisify(execFile);
export const PROXY_WIDTH = 540;

/** Argumentos do ffmpeg do proxy (§8). Puro: testado em proxy.spec.ts. */
export function proxyArgs(input: string, output: string): string[] {
  return [
    '-hide_banner', '-v', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale='min(${PROXY_WIDTH},iw)':-2`,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '28',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', output,
  ];
}

/** ETA do proxy: ~2-4 s de CPU por 30 s de vídeo (§8); piso de 3 s. */
export function proxyEtaSec(durationSec: number | null | undefined): number {
  return Math.max(3, Math.ceil((durationSec ?? 30) / 10));
}

@Injectable()
export class ProxyService implements OnModuleDestroy {
  private readonly log = new Logger('Proxy');
  private readonly pendentes = new Map<string, Promise<FileRow | null>>();
  private cadeia: Promise<unknown> = Promise.resolve();
  private parado = false;

  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  onModuleDestroy() {
    this.parado = true;
  }

  /** Proxy pronto do original (o mais novo), ou null. */
  async of(originalId: string): Promise<FileRow | null> {
    return this.prisma.file.findFirst({ where: { proxyOfFileId: originalId, kind: 'PROXY' }, orderBy: { createdAt: 'desc' } });
  }

  /** Está na fila/rodando agora (nesta instância). */
  building(originalId: string): boolean {
    return this.pendentes.has(originalId);
  }

  /** Enfileira (sem repetir) e devolve a promessa do proxy; o GET não espera, os testes podem. */
  ensure(original: FileRow): Promise<FileRow | null> {
    const ja = this.pendentes.get(original.id);
    if (ja) return ja;
    const p = (this.cadeia = this.cadeia.then(() => this.build(original), () => this.build(original))) as Promise<FileRow | null>;
    this.pendentes.set(original.id, p);
    void p.finally(() => this.pendentes.delete(original.id)).catch(() => undefined);
    return p;
  }

  private async build(original: FileRow): Promise<FileRow | null> {
    if (this.parado) return null;
    const pronto = await this.of(original.id);
    if (pronto) return pronto;
    const dir = await mkdtemp(join(tmpdir(), 'maquina-proxy-'));
    try {
      const src = join(dir, 'in.mp4');
      const out = join(dir, 'proxy.mp4');
      await this.storage.downloadTo(original, src);
      const t0 = Date.now();
      await run(process.env.FFMPEG_PATH || 'ffmpeg', proxyArgs(src, out), { timeout: 10 * 60_000 });
      const w = original.width ?? null, h = original.height ?? null;
      const pw = w ? Math.min(PROXY_WIDTH, w) : PROXY_WIDTH;
      const ph = w && h ? Math.round((h * pw) / w / 2) * 2 : null;
      const f = await this.storage.put(out, {
        workspaceId: original.workspaceId, kind: 'PROXY', mimeType: 'video/mp4',
        meta: { durationSec: num(original.durationSec) ?? undefined, width: pw, height: ph ?? undefined },
      });
      const linked = await this.prisma.file.update({ where: { id: f.id }, data: { proxyOfFileId: original.id } });
      this.log.log(`proxy ${original.id} → ${f.id} (${Date.now() - t0} ms, ${linked.sizeBytes} B)`);
      return linked;
    } catch (e) {
      this.log.warn(`proxy de ${original.id} falhou (o editor fica no original): ${(e as Error).message}`);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
