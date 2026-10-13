import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { CompleteUploadResponse, CreateUploadResponse, UploadWarning } from '@maquina/contratos';
import type { Upload } from '@prisma/client';
import type { Request } from 'express';
import { Transform, type Readable } from 'node:stream';
import { MediaInvalidError, probeHeader } from '../arquivos/media-validator';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { CHAMPION_MIME_TYPES, LOW_RES_SIDE_PX, MIN_SIDE_PX, PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIME_TYPES, UPLOAD_TTL_MS, autoAnalysisEstimateUsd } from '../campeoes/limites';
import type { CreateUploadDto } from './uploads.dto';

/**
 * Upload do navegador (feature-2 §4.1). O web segue method/url/headers da resposta:
 *  - direct: PUT direto no storage (URL pré-assinada com Content-Length/Content-Type);
 *  - proxy: PUT na API (`/uploads/:id/content`, com Bearer), que faz stream multipart pro storage.
 * O `complete` confere o objeto (tamanho), roda ffprobe (só cabeçalho) e cria o File CHAMPION_VIDEO.
 */
@Injectable()
export class UploadsService {
  private readonly log = new Logger('Uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  async create(auth: AuthContext, dto: CreateUploadDto): Promise<CreateUploadResponse> {
    // variacao-auto-v1 D4: PRODUCT_IMAGE = foto do produto da oferta (jpeg/png/webp, ≤ 10 MB)
    const image = dto.purpose === 'PRODUCT_IMAGE';
    const mimes: readonly string[] = image ? PRODUCT_IMAGE_MIME_TYPES : CHAMPION_MIME_TYPES;
    const maxBytes = image ? PRODUCT_IMAGE_MAX_BYTES : this.config.uploadMaxBytes;
    if (!mimes.includes(dto.mimeType)) throw new AppException('MEDIA_INVALID', { reason: 'mime' });
    if (dto.sizeBytes > maxBytes) throw new AppException('MEDIA_TOO_LARGE', { maxBytes });
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const storageKey = this.storage.newKey(auth.workspaceId, image ? 'PRODUCT_IMAGE' : 'CHAMPION_VIDEO', dto.mimeType);
    const up = await this.prisma.upload.create({
      data: {
        workspaceId: auth.workspaceId, purpose: dto.purpose, filename: dto.filename, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes,
        storageKey, expiresAt, createdById: auth.userId,
      },
    });
    const ttlSec = Math.floor(UPLOAD_TTL_MS / 1000);
    if (this.config.uploadMode === 'direct') {
      const url = await this.storage.presignPut(storageKey, { contentType: dto.mimeType, contentLength: dto.sizeBytes, expiresInSec: ttlSec });
      return { uploadId: up.id, method: 'PUT', url, headers: { 'Content-Type': dto.mimeType }, expiresAt: expiresAt.toISOString() };
    }
    // proxy: o web manda o próprio Bearer junto (rota autenticada)
    const url = `${this.config.publicApiUrl.replace(/\/$/, '')}/api/v1/uploads/${up.id}/content`;
    return { uploadId: up.id, method: 'PUT', url, headers: { 'Content-Type': dto.mimeType }, expiresAt: expiresAt.toISOString() };
  }

  /** PUT do proxy exige o Bearer do usuário; upload de outro workspace = 404 (esclarecimento 06/10). */
  private async uploadForContent(id: string, auth: AuthContext): Promise<Upload> {
    const up = await this.prisma.upload.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!up) throw new AppException('NOT_FOUND');
    return up;
  }

  private assertOpen(up: Upload) {
    if (up.status === 'EXPIRED' || (up.status === 'PENDING' && up.expiresAt.getTime() < Date.now())) throw new AppException('UPLOAD_EXPIRED');
  }

  /** PUT /uploads/:id/content (só proxy): corpo cru, stream pro storage, nunca passa do declarado (413). */
  async content(auth: AuthContext, id: string, req: Request): Promise<{ ok: true }> {
    const up = await this.uploadForContent(id, auth);
    this.assertOpen(up);
    if (up.status !== 'PENDING') throw new AppException('INVALID_STATE', { state: up.status, allowed: ['PENDING'] });
    const declared = up.sizeBytes;
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > declared) throw new PayloadTooLargeException();
    let seen = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > declared) cb(new PayloadTooLargeException());
        else cb(null, chunk);
      },
    });
    const body = (req as Readable).pipe(limiter);
    req.on('error', (e) => limiter.destroy(e));
    try {
      await this.storage.putStream(up.storageKey, body, up.mimeType);
    } catch (e) {
      if (e instanceof PayloadTooLargeException || seen > declared) {
        await this.storage.deleteObject(up.storageKey);
        throw new PayloadTooLargeException();
      }
      throw e;
    }
    return { ok: true };
  }

  /** POST /uploads/:id/complete: confere o objeto, ffprobe, valida duração/tamanho, cria o File. Idempotente se já READY. */
  async complete(auth: AuthContext, id: string): Promise<CompleteUploadResponse> {
    const up = await this.prisma.upload.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!up) throw new AppException('NOT_FOUND');
    if (up.status === 'READY' && up.fileId) return this.ready(up, await this.prisma.file.findUniqueOrThrow({ where: { id: up.fileId } }));
    this.assertOpen(up);
    if (up.status === 'FAILED') throw failedAgain(up.errorCode);

    const head = await this.storage.head(up.storageKey);
    if (!head || head.sizeBytes !== up.sizeBytes) {
      throw new AppException('UPLOAD_INCOMPLETE', { expectedBytes: up.sizeBytes, actualBytes: head?.sizeBytes ?? null });
    }
    if (up.purpose === 'PRODUCT_IMAGE') return this.completeImage(up, head.sizeBytes);
    let info;
    try {
      info = await probeHeader(await this.storage.signedUrlForKey(up.storageKey));
    } catch (e) {
      if (e instanceof MediaInvalidError) return this.fail(up, 'MEDIA_INVALID', { reason: 'undecodable' });
      throw e;
    }
    if (!info.hasVideo) return this.fail(up, 'MEDIA_INVALID', { reason: 'no_video' });
    const minSide = Math.min(info.width ?? 0, info.height ?? 0);
    if (minSide < MIN_SIDE_PX) return this.fail(up, 'MEDIA_INVALID', { reason: 'too_small' });
    const d = info.durationSec ?? 0;
    if (d < this.config.championMinSec) return this.fail(up, 'MEDIA_TOO_SHORT', { durationSec: round3(d), minSec: this.config.championMinSec });
    if (d > this.config.championMaxSec) return this.fail(up, 'MEDIA_TOO_LONG', { durationSec: round3(d), maxSec: this.config.championMaxSec });

    const file = await this.prisma.$transaction(async (tx) => {
      const f = await tx.file.create({
        data: {
          workspaceId: up.workspaceId, kind: 'CHAMPION_VIDEO', storageKey: up.storageKey, mimeType: up.mimeType, sizeBytes: head.sizeBytes,
          durationSec: round3(d), width: info.width, height: info.height,
        },
      });
      await tx.upload.update({ where: { id: up.id }, data: { status: 'READY', fileId: f.id, completedAt: new Date(), errorCode: null } });
      return f;
    });
    const fresh = await this.prisma.upload.findUniqueOrThrow({ where: { id: up.id } });
    return this.ready(fresh, file, { hasAudio: info.hasAudio, minSide });
  }

  /** D4: foto do produto. Confere a assinatura do arquivo (jpeg/png/webp) pelos primeiros bytes; sem ffprobe. */
  private async completeImage(up: Upload, sizeBytes: number): Promise<CompleteUploadResponse> {
    const res = await fetch(await this.storage.signedUrlForKey(up.storageKey), { headers: { range: 'bytes=0-15' } }).catch(() => null);
    const head = res && res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    if (!head || imageMimeOf(head) !== up.mimeType) return this.fail(up, 'MEDIA_INVALID', { reason: 'mime' });
    const file = await this.prisma.$transaction(async (tx) => {
      const f = await tx.file.create({
        data: { workspaceId: up.workspaceId, kind: 'PRODUCT_IMAGE', storageKey: up.storageKey, mimeType: up.mimeType, sizeBytes },
      });
      await tx.upload.update({ where: { id: up.id }, data: { status: 'READY', fileId: f.id, completedAt: new Date(), errorCode: null } });
      return f;
    });
    return { uploadId: up.id, status: 'READY', file: await this.storage.fileRef(file), warnings: [], analysisEstimateUsd: 0 };
  }

  private async ready(
    up: Upload, file: import('@prisma/client').File, probe?: { hasAudio: boolean; minSide: number },
  ): Promise<CompleteUploadResponse> {
    if (up.purpose === 'PRODUCT_IMAGE') return { uploadId: up.id, status: 'READY', file: await this.storage.fileRef(file), warnings: [], analysisEstimateUsd: 0 };
    let p = probe;
    if (!p) {
      const info = await probeHeader(await this.storage.signedUrl(file)).catch(() => null);
      p = { hasAudio: info?.hasAudio ?? true, minSide: Math.min(file.width ?? 0, file.height ?? 0) };
    }
    const warnings: UploadWarning[] = [];
    if (!p.hasAudio) warnings.push('no_audio');
    if (p.minSide < LOW_RES_SIDE_PX) warnings.push('low_resolution');
    const d = Number(file.durationSec ?? 0);
    return {
      uploadId: up.id, status: 'READY', file: await this.storage.fileRef(file), warnings,
      // variacao-auto-v1 §5.1: já com o plano do lote AUTO (a análise começa sozinha depois do complete)
      analysisEstimateUsd: autoAnalysisEstimateUsd(this.catalog, d),
    };
  }

  /** Arquivo inválido: upload FAILED, objeto apagado, 422 com o código do contrato. */
  private async fail(up: Upload, code: 'MEDIA_INVALID' | 'MEDIA_TOO_SHORT' | 'MEDIA_TOO_LONG', details: Record<string, unknown>): Promise<never> {
    const errorCode = `${code}|${JSON.stringify(details)}`; // complete repetido devolve o mesmo 422
    await this.prisma.upload.update({ where: { id: up.id }, data: { status: 'FAILED', errorCode } });
    await this.storage.deleteObject(up.storageKey);
    throw new AppException(code, details);
  }

  /**
   * Upload READY do workspace (404 se não existe; 409 UPLOAD_INCOMPLETE se ainda não terminou). `purpose` diferente do
   * esperado (foto do produto virando campeão, ou o contrário) = 422 MEDIA_INVALID { reason: 'mime' }.
   */
  async readyFile(workspaceId: string, uploadId: string, purpose: UploadPurpose = 'CHAMPION_VIDEO') {
    const up = await this.prisma.upload.findFirst({ where: { id: uploadId, workspaceId }, include: { file: true } });
    if (!up) throw new AppException('NOT_FOUND');
    if (up.purpose !== purpose) throw new AppException('MEDIA_INVALID', { reason: 'mime' });
    if (up.status === 'EXPIRED') throw new AppException('UPLOAD_EXPIRED');
    if (up.status !== 'READY' || !up.file) throw new AppException('UPLOAD_INCOMPLETE', { expectedBytes: up.sizeBytes, actualBytes: null });
    return up.file;
  }

  /** Cron: PENDING vencido vira EXPIRED e o objeto (parcial ou não) é apagado. */
  @Interval('uploads-expire', 5 * 60_000)
  async expire(now = new Date()): Promise<number> {
    const stale = await this.prisma.upload.findMany({ where: { status: 'PENDING', expiresAt: { lt: now } }, take: 200 });
    for (const up of stale) {
      const r = await this.prisma.upload.updateMany({ where: { id: up.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (r.count) await this.storage.deleteObject(up.storageKey);
    }
    if (stale.length) this.log.log(`${stale.length} upload(s) expirado(s)`);
    return stale.length;
  }
}

/** Upload FAILED: o mesmo 422 da primeira vez (código|details gravados em errorCode). */
function failedAgain(stored: string | null): AppException {
  const [code, json] = (stored ?? '').split('|');
  let details: Record<string, unknown> = { reason: 'undecodable' };
  try {
    if (json) details = JSON.parse(json);
  } catch {
    /* formato antigo */
  }
  const c = code === 'MEDIA_TOO_SHORT' || code === 'MEDIA_TOO_LONG' ? code : 'MEDIA_INVALID';
  return new AppException(c, details);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type UploadPurpose = 'CHAMPION_VIDEO' | 'PRODUCT_IMAGE';

/** Tipo real da imagem pelos primeiros bytes (null = não é jpeg/png/webp). */
export function imageMimeOf(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
