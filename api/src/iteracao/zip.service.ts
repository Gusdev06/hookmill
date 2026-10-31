// Zip do lote AUTO (variacao-auto-v1 §5.1 esclarecimento 5, §8; rev. 23/10 §14.2: os formatos READY de cada peça, 9:16 + os pedidos): job ZIP_BUILD, sem compressão (MP4/PNG já vêm
// comprimidos), 2 pastas por eixo com README, nomes <adName>_<FMT>.<ext>. Só peças `ready` com `inZip`. zipKey igual =
// reaproveita; 72 h depois o cron apaga e o próximo pedido refaz.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { BrollProvenance, GeneratedProvenance, IterateZip, VariationAxis } from '@maquina/contratos';
import { proveniencias } from '../edicao/trilha-broll';
import type { File as FileRow, VideoFormat } from '@prisma/client';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { AmostraService } from '../amostra/amostra.service';
import { ALL_FORMATS, autoFileName, latestByFormat, paramsOf, pieceStatus, suggestedPrimaryTextOf } from '../edicao/pecas';
import { ZIP_TTL_MS, creditoDoBroll, folderFor, notaDoTemplate, readmeFor, zipFileName, zipFolders, zipKeyOf, type ZipLocale } from './zip';

interface ZipEntry {
  pieceId: string; axis: VariationAxis; change: string;
  /** D14: FRAME read_caption = texto do anúncio sugerido (vai no README da pasta) */
  primaryText: string | null;
  /** §B3.1: proveniência do b-roll da 2ª fonte (molduras de 2 fontes) */
  provenance: (BrollProvenance | GeneratedProvenance)[];
  /** iterate-v2 F1.8: tipo da peça (a nota do template no README) */
  autoType: string | null;
  files: { name: string; format: VideoFormat; file: FileRow }[];
}

@Injectable()
export class ZipService {
  private readonly log = new Logger('Zip');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly amostra: AmostraService,
  ) {}

  private async batch(workspaceId: string, batchId: string) {
    const b = await this.prisma.variationBatch.findFirst({
      where: { id: batchId, workspaceId, mode: 'AUTO' },
      include: { zipFile: true, champion: { select: { name: true } }, workspace: { select: { shortCode: true, uiLocale: true } } },
    });
    if (!b) throw new AppException('NOT_FOUND');
    return b;
  }

  /** Peças `ready` com `inZip`, cada uma com os formatos READY vigentes e o adName congelado. */
  private async entries(batchId: string, launched: boolean): Promise<ZipEntry[]> {
    const items = await this.prisma.variationItem.findMany({
      where: { batchId, kind: 'AUTO_EDIT', inZip: true },
      orderBy: { index: 'asc' },
      include: { creative: { include: { renders: { where: { stale: false }, include: { file: true } } } } },
    });
    const out: ZipEntry[] = [];
    for (const i of items) {
      const c = i.creative;
      if (!c?.adName) continue;
      if (pieceStatus({ launched, leftOutAt: i.leftOutAt, creativeState: c.state, renders: c.renders }) !== 'ready') continue;
      const latest = latestByFormat(c.renders);
      const files = ALL_FORMATS.flatMap((f) => {
        const r = latest.get(f);
        return r?.status === 'READY' && r.file ? [{ name: autoFileName(c.adName!, f, r.file.mimeType), format: f, file: r.file }] : [];
      });
      if (files.length) {
        out.push({
          pieceId: i.id, axis: (i.axis ?? 'ITERATION') as VariationAxis, change: i.change ?? '', files,
          primaryText: i.autoType === 'FRAME' ? suggestedPrimaryTextOf(paramsOf(i.payload)) : null, // D14
          provenance: i.autoType === 'FRAME' ? proveniencias(paramsOf(i.payload)?.second) : [], // §B3.1 (1 clipe, trilha ou imagem gerada)
          autoType: i.autoType ?? null,
        });
      }
    }
    return out;
  }

  private keyOf(entries: ZipEntry[]): string {
    return zipKeyOf(entries.map((e) => ({ pieceId: e.pieceId, fileIds: e.files.map((f) => f.file.id) })));
  }

  /**
   * `IterateBatch.zip` (o B1 chama no GET /iterate/:id). Zip pronto com a chave atual devolve a URL de download; a 1ª
   * entrega grava `downloadedAt` (tira o lote do "Waiting for you").
   */
  async view(workspaceId: string, batchId: string): Promise<IterateZip> {
    const b = await this.batch(workspaceId, batchId);
    const locale = b.workspace.uiLocale as ZipLocale;
    const entries = b.status === 'LAUNCHED' ? await this.entries(b.id, true) : [];
    const key = this.keyOf(entries);
    const base = { pieces: entries.length, files: entries.reduce((a, e) => a + e.files.length, 0), folders: zipFolders(locale) };
    const fileName = b.launchedAt ? zipFileName({ shortCode: b.workspace.shortCode, launchedAt: b.launchedAt, championName: b.champion.name, locale }) : null;
    // amostra-gratis-v1 §3: lote travado nunca devolve a URL do zip
    if (b.zipFile && b.zipKey === key && entries.length && !(await this.amostra.batchLock(b)).locked) {
      const { url } = await this.storage.signedDownloadUrl(b.zipFile, fileName!);
      if (!b.downloadedAt) await this.prisma.variationBatch.updateMany({ where: { id: b.id, downloadedAt: null }, data: { downloadedAt: new Date() } });
      return { status: 'ready', fileName, url, sizeBytes: b.zipFile.sizeBytes, ...base };
    }
    const job = await this.prisma.job.findFirst({ where: { variationBatchId: b.id, type: 'ZIP_BUILD' }, orderBy: { createdAt: 'desc' } });
    const status = job && (job.status === 'QUEUED' || job.status === 'RUNNING') ? 'building' : job?.status === 'FAILED' && (job.input as { key?: string })?.key === key ? 'failed' : 'none';
    return { status, fileName, url: null, sizeBytes: null, ...base };
  }

  /** `POST /iterate/:id/zip`: 200 `ready` (mesmo zipKey) ou 202 `building` (job ZIP_BUILD). */
  async request(auth: AuthContext, batchId: string): Promise<{ httpStatus: 200 | 202; zip: IterateZip }> {
    const b = await this.batch(auth.workspaceId, batchId);
    await this.amostra.assertBatchUnlocked(auth.workspaceId, b.id); // amostra-gratis-v1 §4: zip trava (402)
    if (b.status !== 'LAUNCHED') throw new AppException('INVALID_STATE', { state: b.status, allowed: ['LAUNCHED'] });
    const entries = await this.entries(b.id, true);
    if (!entries.length) throw new AppException('INVALID_STATE', { state: b.status, allowed: [], reason: 'nothing_to_zip' });
    const key = this.keyOf(entries);
    if (b.zipFile && b.zipKey === key) return { httpStatus: 200, zip: await this.view(auth.workspaceId, b.id) };
    const open = await this.prisma.job.findFirst({ where: { variationBatchId: b.id, type: 'ZIP_BUILD', status: { in: ['QUEUED', 'RUNNING'] } } });
    if (!open) {
      const job = await this.prisma.job.create({
        data: { workspaceId: b.workspaceId, type: 'ZIP_BUILD', status: 'QUEUED', input: { key }, variationBatchId: b.id, createdById: auth.userId },
      });
      void this.jobs.detach(job.id, 'zip', () => this.build(job.id, b.id));
    }
    return { httpStatus: 202, zip: { ...(await this.view(auth.workspaceId, b.id)), status: 'building' } };
  }

  /** Monta o zip (store), sobe como ZIP_ARCHIVE e troca o do lote (o anterior sai do storage). */
  private async build(jobId: string, batchId: string): Promise<void> {
    await this.jobs.stage(jobId, 'zipping', 0);
    const b = await this.prisma.variationBatch.findUniqueOrThrow({
      where: { id: batchId }, include: { zipFile: true, champion: { select: { name: true } }, workspace: { select: { shortCode: true, uiLocale: true } } },
    });
    const locale = b.workspace.uiLocale as ZipLocale;
    const entries = await this.entries(b.id, true);
    const key = this.keyOf(entries);
    const dir = await mkdtemp(join(tmpdir(), 'maquina-zip-'));
    try {
      const zipPath = join(dir, 'out.zip');
      const out = createWriteStream(zipPath);
      const archive = archiver('zip', { store: true });
      const done = new Promise<void>((resolve, reject) => {
        out.on('close', () => resolve());
        archive.on('error', reject);
        out.on('error', reject);
      });
      archive.pipe(out);
      const byAxis = new Map<VariationAxis, ZipEntry[]>();
      for (const e of entries) byAxis.set(e.axis, [...(byAxis.get(e.axis) ?? []), e]);
      let n = 0;
      const total = entries.reduce((a, e) => a + e.files.length, 0);
      for (const axis of ['ITERATION', 'DIVERSITY'] as VariationAxis[]) {
        const list = byAxis.get(axis);
        if (!list?.length) continue; // pasta vazia não entra
        const folder = folderFor(axis, locale);
        for (const e of list) {
          for (const f of e.files) {
            const local = join(dir, `${n}-${f.name}`);
            await this.storage.downloadTo(f.file, local);
            archive.file(local, { name: `${folder}/${f.name}` });
            n++;
            await this.jobs.stage(jobId, 'zipping', Math.min(95, Math.round((n / total) * 90)));
          }
        }
        const lines = list.flatMap((e) => e.files.map((f) => ({ file: f.name, change: e.change, primaryText: e.primaryText, credit: e.provenance.map((p) => creditoDoBroll(p, locale)).filter((c): c is string => !!c), note: notaDoTemplate(e.autoType, locale) })));
        archive.append(readmeFor(axis, lines, locale), { name: `${folder}/README.txt` });
      }
      await archive.finalize();
      await done;
      const file = await this.storage.put(zipPath, { workspaceId: b.workspaceId, kind: 'ZIP_ARCHIVE', mimeType: 'application/zip' });
      await this.prisma.variationBatch.update({ where: { id: b.id }, data: { zipFileId: file.id, zipKey: key } });
      if (b.zipFile) await this.dropFile(b.zipFile);
      await this.jobs.finish(jobId, {
        status: 'SUCCEEDED',
        output: { fileId: file.id, fileName: zipFileName({ shortCode: b.workspace.shortCode, launchedAt: b.launchedAt ?? b.createdAt, championName: b.champion.name, locale }) },
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async dropFile(f: FileRow): Promise<void> {
    await this.storage.deleteObject(f.storageKey);
    await this.prisma.file.deleteMany({ where: { id: f.id, zipOf: { none: {} } } }).catch(() => undefined);
  }

  /** Cron (hora em hora): zip com mais de 72 h sai do storage; o lote volta a `none` e o próximo pedido refaz. */
  @Cron('17 * * * *')
  async purgeOld(now = Date.now()): Promise<number> {
    const old = await this.prisma.file.findMany({ where: { kind: 'ZIP_ARCHIVE', createdAt: { lt: new Date(now - ZIP_TTL_MS) } } });
    for (const f of old) {
      await this.prisma.variationBatch.updateMany({ where: { zipFileId: f.id }, data: { zipFileId: null, zipKey: null } });
      await this.dropFile(f).catch((e) => this.log.warn(`zip ${f.id}: ${(e as Error).message}`));
    }
    return old.length;
  }
}
