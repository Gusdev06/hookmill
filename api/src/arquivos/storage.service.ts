import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload as S3Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { File as FileRow, FileKind } from '@prisma/client';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { MediaInfo, MediaKind, validateMedia } from './media-validator';

/** FileRef do contrato (api.md §1). */
export interface FileRef { id: string; url: string; mimeType: string; width?: number; height?: number; durationSec?: number }

export interface PutOptions {
  workspaceId: string;
  kind: FileKind;
  mimeType: string;
  sourceUrl?: string;
  meta?: Partial<Pick<MediaInfo, 'durationSec' | 'width' | 'height'>>;
}

export interface IngestOptions {
  workspaceId: string;
  kind: FileKind;
  validate: MediaKind;
  mimeType?: string;
}

/** Miniatura do clipe: frame em ~1 s (nunca o 0: no lipsync o frame 0 é a própria foto do rosto). */
export function thumbnailAtSec(durationSec: number | null): number {
  const d = durationSec ?? 0;
  return d > 1.2 ? 1 : Math.max(0.04, d / 2);
}

/** Falha assíncrona de ingestão (vira errorCode DOWNLOAD_INVALID no recurso, não erro HTTP). */
export class IngestError extends Error {
  readonly code = 'DOWNLOAD_INVALID' as const;
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = 'IngestError';
  }
}

const EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/zip': 'zip', // variacao-auto-v1 §8 (ZIP_ARCHIVE)
};
const DEFAULT_MIME: Record<MediaKind, string> = { video: 'video/mp4', audio: 'audio/mpeg', image: 'image/png' };
export const INGEST_ATTEMPTS = 3;

/**
 * Único dono do storage (S3: versitygw local / Supabase Storage em produção).
 * O banco guarda só a chave; URL pra fora é sempre pré-assinada na hora (6 h).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;
  /** Espera entre tentativas do ingest (ms). Teste zera. */
  retryDelayMs = 1500;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    const s = config.storage;
    this.bucket = s.bucket;
    this.ttl = s.signedUrlTtlSec;
    this.s3 = new S3Client({
      endpoint: s.endpoint,
      region: s.region,
      forcePathStyle: s.forcePathStyle,
      credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Sobe um arquivo local ou buffer e cria a linha em `files`. */
  async put(source: string | Buffer, opts: PutOptions): Promise<FileRow> {
    const buffer = typeof source === 'string' ? null : source;
    const sizeBytes = buffer ? buffer.length : (await stat(source as string)).size;
    const sha256 = buffer ? createHash('sha256').update(buffer).digest('hex') : await hashFile(source as string);
    const ext = EXT[opts.mimeType] ?? 'bin';
    const storageKey = `ws/${opts.workspaceId}/${opts.kind.toLowerCase()}/${randomUUID()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buffer ?? createReadStream(source as string),
        ContentLength: sizeBytes,
        ContentType: opts.mimeType,
      }),
    );

    return this.prisma.file.create({
      data: {
        workspaceId: opts.workspaceId,
        kind: opts.kind,
        storageKey,
        mimeType: opts.mimeType,
        sizeBytes,
        sha256,
        sourceUrl: opts.sourceUrl,
        durationSec: opts.meta?.durationSec ?? undefined,
        width: opts.meta?.width ?? undefined,
        height: opts.meta?.height ?? undefined,
      },
    });
  }

  /** URL pré-assinada nova (SIGNED_URL_TTL_SEC, padrão 6 h). Aceita id ou a linha já carregada. */
  async signedUrl(file: string | Pick<FileRow, 'storageKey'>): Promise<string> {
    const key = typeof file === 'string' ? (await this.prisma.file.findUniqueOrThrow({ where: { id: file } })).storageKey : file.storageKey;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: this.ttl });
  }

  /**
   * fase2-agencia.md §3.5: URL assinada de download com `Content-Disposition: attachment; filename="<fileName>"`
   * (ResponseContentDisposition na assinatura). Devolve também quando expira.
   */
  async signedDownloadUrl(file: Pick<FileRow, 'storageKey'>, fileName: string): Promise<{ url: string; expiresAt: Date }> {
    const safe = fileName.replace(/["\\\r\n]/g, '_');
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey, ResponseContentDisposition: `attachment; filename="${safe}"` }),
      { expiresIn: this.ttl },
    );
    return { url, expiresAt: new Date(Date.now() + this.ttl * 1000) };
  }

  /** Linha de `files` → FileRef do contrato, com URL assinada. */
  async fileRef(file: FileRow): Promise<FileRef> {
    const ref: FileRef = { id: file.id, url: await this.signedUrl(file), mimeType: file.mimeType };
    if (file.width != null) ref.width = file.width;
    if (file.height != null) ref.height = file.height;
    const d = num(file.durationSec);
    if (d != null) ref.durationSec = d;
    return ref;
  }

  /** Arquivo do workspace (404 se não existe ou é de outro workspace). */
  async getForWorkspace(workspaceId: string, fileId: string): Promise<FileRow> {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, workspaceId } });
    if (!file) throw new AppException('NOT_FOUND');
    return file;
  }

  /**
   * Baixa a saída de um provedor e guarda no storage SÓ se o arquivo estiver inteiro:
   * tamanho bate com Content-Length e ffprobe/ffmpeg decodificam até o fim.
   * Até 3 tentativas; depois lança IngestError (DOWNLOAD_INVALID).
   */
  async ingestFromUrl(url: string, opts: IngestOptions): Promise<FileRow> {
    return (await this.ingest(url, opts, false)).file;
  }

  /**
   * Igual ao ingestFromUrl pra vídeo, e ainda tira um JPEG em ~1 s do arquivo já validado e sobe como THUMBNAIL.
   * Miniatura que não sai conta como download inválido (tenta de novo, até 3x).
   */
  async ingestVideoWithThumbnail(url: string, opts: Omit<IngestOptions, 'validate'>): Promise<{ file: FileRow; thumbnail: FileRow }> {
    const r = await this.ingest(url, { ...opts, validate: 'video' }, true);
    return { file: r.file, thumbnail: r.thumbnail! };
  }

  private async ingest(url: string, opts: IngestOptions, withThumb: boolean): Promise<{ file: FileRow; thumbnail?: FileRow }> {
    let lastError = '';
    for (let attempt = 1; attempt <= INGEST_ATTEMPTS; attempt++) {
      const dir = await mkdtemp(join(tmpdir(), 'maquina-ingest-'));
      const path = join(dir, 'download');
      try {
        const contentType = await download(url, path);
        const info = await validateMedia(path, opts.validate);
        const mimeType = opts.mimeType ?? pickMime(contentType, opts.validate);
        let thumbPath: string | null = null;
        if (withThumb) {
          thumbPath = join(dir, 'thumb.jpg');
          await extractFrame(path, thumbnailAtSec(info.durationSec), thumbPath);
          await validateMedia(thumbPath, 'image');
        }
        const file = await this.put(path, {
          workspaceId: opts.workspaceId,
          kind: opts.kind,
          mimeType,
          sourceUrl: url,
          meta: { durationSec: info.durationSec, width: info.width, height: info.height },
        });
        const thumbnail = thumbPath
          ? await this.put(thumbPath, { workspaceId: opts.workspaceId, kind: 'THUMBNAIL', mimeType: 'image/jpeg', meta: { width: info.width, height: info.height } })
          : undefined;
        return { file, thumbnail };
      } catch (e) {
        lastError = (e as Error).message;
        this.logger.warn(`ingest tentativa ${attempt}/${INGEST_ATTEMPTS} falhou (${redact(url)}): ${lastError}`);
        if (attempt < INGEST_ATTEMPTS && this.retryDelayMs > 0) await sleep(this.retryDelayMs * attempt);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    throw new IngestError(lastError, INGEST_ATTEMPTS);
  }

  // ───────── feature 2: upload do navegador (UPLOAD_MODE proxy | direct) ─────────

  /** Chave nova de objeto no padrão ws/<workspaceId>/<kind>/<uuid>.<ext>. */
  newKey(workspaceId: string, kind: FileKind, mimeType: string): string {
    return `ws/${workspaceId}/${kind.toLowerCase()}/${randomUUID()}.${EXT[mimeType] ?? 'bin'}`;
  }

  /** URL pré-assinada de PUT, presa ao Content-Length e Content-Type declarados (UPLOAD_MODE=direct). */
  async presignPut(key: string, opts: { contentType: string; contentLength: number; expiresInSec: number }): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: opts.contentType, ContentLength: opts.contentLength }),
      { expiresIn: opts.expiresInSec, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** Sobe um stream direto pro storage em multipart (UPLOAD_MODE=proxy). Não cria linha em `files`. */
  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    await new S3Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    }).done();
  }

  /** Tamanho do objeto, ou null se não existe. */
  async head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NotFound' || (e as Error).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }

  /** URL pré-assinada de GET por chave (o objeto ainda não tem linha em `files`). */
  async signedUrlForKey(key: string): Promise<string> {
    return this.signedUrl({ storageKey: key });
  }

  /** Cria a linha em `files` pra um objeto que já está no storage (upload concluído). */
  async registerObject(key: string, opts: PutOptions & { sizeBytes: number }): Promise<FileRow> {
    return this.prisma.file.create({
      data: {
        workspaceId: opts.workspaceId, kind: opts.kind, storageKey: key, mimeType: opts.mimeType, sizeBytes: opts.sizeBytes,
        sourceUrl: opts.sourceUrl, durationSec: opts.meta?.durationSec ?? undefined, width: opts.meta?.width ?? undefined, height: opts.meta?.height ?? undefined,
      },
    });
  }

  /** Baixa o objeto pra um caminho local (stream; sem carregar 200 MB na memória). */
  async downloadTo(file: Pick<FileRow, 'storageKey'>, path: string): Promise<void> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }));
    await pipeline(out.Body as Readable, createWriteStream(path));
  }

  /** Lê o objeto inteiro (uso interno/teste; o web nunca baixa pela API). */
  async read(file: Pick<FileRow, 'storageKey'>): Promise<Buffer> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  /** Lê só uma faixa do objeto (`Range: bytes=offset-(offset+length-1)`): upload em pedaços sem carregar o MP4 inteiro. */
  async readRange(file: Pick<FileRow, 'storageKey'>, offset: number, length: number): Promise<Buffer> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0) throw new RangeError(`faixa inválida: ${offset}+${length}`);
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey, Range: `bytes=${offset}-${offset + length - 1}` }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async ping(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
async function extractFrame(video: string, atSec: number, out: string): Promise<void> {
  await promisify(execFile)(FFMPEG_BIN, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', atSec.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '3', out], {
    timeout: 60_000,
  });
}

async function download(url: string, path: string): Promise<string | null> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
  const expected = Number(res.headers.get('content-length'));
  if (Number.isFinite(expected) && expected > 0) {
    const { size } = await stat(path);
    if (size !== expected) throw new Error(`truncated: ${size} of ${expected} bytes`);
  }
  return res.headers.get('content-type');
}

function pickMime(contentType: string | null, kind: MediaKind): string {
  const ct = contentType?.split(';')[0].trim().toLowerCase();
  return ct && ct.startsWith(`${kind}/`) && EXT[ct] ? ct : DEFAULT_MIME[kind];
}

async function hashFile(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

/** URL de provedor pode ter token na query: não vai pro log. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
