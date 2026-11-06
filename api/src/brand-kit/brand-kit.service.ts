import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BrandAsset as BrandAssetView, BrandAssetKind, BrandKit } from '@maquina/contratos';
import type { BrandAsset, File as FileRow } from '@prisma/client';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../arquivos/storage.service';
import { BrainCache } from '../brain/brain.cache';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { normalizeHex } from '../iteracao/paleta';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService, type UploadPurpose } from '../uploads/uploads.service';
import type { CreateBrandAssetDto, UpdateBrandAssetDto } from './brand-kit.dto';
import { BRAND_MAX_DEMO_VIDEOS, BRAND_MAX_FILES } from './limites';

const PURPOSE: Record<BrandAssetKind, UploadPurpose> = { LOGO: 'BRAND_LOGO', FILE: 'BRAND_FILE', DEMO_VIDEO: 'BRAND_VIDEO' };
const MAX: Partial<Record<BrandAssetKind, number>> = { FILE: BRAND_MAX_FILES, DEMO_VIDEO: BRAND_MAX_DEMO_VIDEOS };
type Row = BrandAsset & { file: FileRow };

/**
 * kit-marca-v1 (docs/contratos/kit-marca-v1.md): assets da marca do cliente (workspace), com vínculo opcional a uma oferta.
 * O arquivo sobe pelo fluxo de /uploads (purpose BRAND_*); aqui só o vínculo. Apagar o asset não apaga o File.
 */
@Injectable()
export class BrandKitService {
  private readonly log = new Logger('BrandKit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly uploads: UploadsService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
    private readonly brain: BrainCache,
  ) {}

  async get(auth: AuthContext): Promise<BrandKit> {
    const rows = await this.prisma.brandAsset.findMany({ where: { workspaceId: auth.workspaceId }, include: { file: true }, orderBy: { createdAt: 'asc' } });
    const views = await Promise.all(rows.map((r) => this.view(r)));
    const logos = views.filter((v) => v.kind === 'LOGO');
    return { logo: logos[logos.length - 1] ?? null, files: views.filter((v) => v.kind === 'FILE'), demoVideos: views.filter((v) => v.kind === 'DEMO_VIDEO') };
  }

  async create(auth: AuthContext, dto: CreateBrandAssetDto): Promise<BrandAssetView> {
    const wid = auth.workspaceId;
    const offerId = await this.offerOf(wid, dto.offerId);
    const file = await this.uploads.readyFile(wid, dto.uploadId, PURPOSE[dto.kind]);
    const max = MAX[dto.kind];
    if (max !== undefined && (await this.prisma.brandAsset.count({ where: { workspaceId: wid, kind: dto.kind } })) >= max) {
      throw new AppException('INVALID_STATE', { reason: 'brand_kit_full', kind: dto.kind, max });
    }
    const dup = await this.prisma.brandAsset.findFirst({ where: { workspaceId: wid, fileId: file.id }, include: { file: true } });
    if (dup) return this.view(dup); // o mesmo upload duas vezes = o mesmo asset (idempotente)
    const colors = dto.kind === 'LOGO' ? await this.logoColors(file) : [];
    const row = await this.prisma.$transaction(async (tx) => {
      // LOGO: 1 por cliente; o novo troca o anterior (o File antigo fica)
      if (dto.kind === 'LOGO') await tx.brandAsset.deleteMany({ where: { workspaceId: wid, kind: 'LOGO' } });
      return tx.brandAsset.create({
        data: { workspaceId: wid, kind: dto.kind, label: clean(dto.label), fileId: file.id, offerId, colors, createdById: auth.userId },
        include: { file: true },
      });
    });
    this.brain.invalidate(wid); // brain-preenchido-v1: o grafo traz o asset na hora
    return this.view(row);
  }

  async update(auth: AuthContext, id: string, dto: UpdateBrandAssetDto): Promise<BrandAssetView> {
    const cur = await this.find(auth, id);
    const data: { label?: string | null; offerId?: string | null } = {};
    if (dto.label !== undefined) data.label = clean(dto.label);
    if (dto.offerId !== undefined) data.offerId = await this.offerOf(auth.workspaceId, dto.offerId);
    const row = await this.prisma.brandAsset.update({ where: { id: cur.id }, data, include: { file: true } });
    this.brain.invalidate(auth.workspaceId);
    return this.view(row);
  }

  async remove(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const r = await this.prisma.brandAsset.deleteMany({ where: { id, workspaceId: auth.workspaceId } });
    if (r.count !== 1) throw new AppException('NOT_FOUND');
    this.brain.invalidate(auth.workspaceId);
    return { ok: true };
  }

  /**
   * Porta pra geração (kit-marca-v1 §5): vídeos demo do cliente, os da oferta primeiro e depois os da marca toda.
   * Ainda sem consumidor (b-roll/tela de produto fica pra depois).
   */
  async demoVideosFor(workspaceId: string, offerId: string | null): Promise<{ id: string; fileId: string; label: string | null; offerId: string | null }[]> {
    const rows = await this.prisma.brandAsset.findMany({
      where: { workspaceId, kind: 'DEMO_VIDEO', OR: [{ offerId: null }, ...(offerId ? [{ offerId }] : [])] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fileId: true, label: true, offerId: true },
    });
    return [...rows.filter((r) => r.offerId), ...rows.filter((r) => !r.offerId)];
  }

  // ───────── internos ─────────

  private async find(auth: AuthContext, id: string): Promise<Row> {
    const row = await this.prisma.brandAsset.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: { file: true } });
    if (!row) throw new AppException('NOT_FOUND');
    return row;
  }

  /** Oferta do vínculo: do mesmo workspace e não arquivada (senão 404). null/undefined = marca toda. */
  private async offerOf(workspaceId: string, offerId: string | null | undefined): Promise<string | null> {
    if (!offerId) return null;
    const o = await this.prisma.offer.findFirst({ where: { id: offerId, workspaceId, archivedAt: null }, select: { id: true } });
    if (!o) throw new AppException('NOT_FOUND');
    return o.id;
  }

  /** Até 5 cores dominantes do logo (#RRGGBB). SVG: as cores escritas no arquivo, por frequência; raster: paleta da medição. */
  private async logoColors(file: FileRow): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), 'maquina-logo-'));
    try {
      const path = join(dir, `logo.${file.mimeType === 'image/svg+xml' ? 'svg' : 'img'}`);
      await this.storage.downloadTo(file, path);
      if (file.mimeType === 'image/svg+xml') return svgColors((await readFile(path)).toString('utf8'));
      return uniqHex(await this.media.palette([path], 5));
    } catch (e) {
      this.log.warn(`cores do logo ${file.id}: ${(e as Error).message}`);
      return [];
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async view(r: Row): Promise<BrandAssetView> {
    return { id: r.id, kind: r.kind, label: r.label, file: await this.storage.fileRef(r.file), offerId: r.offerId, colors: r.colors ?? [], createdAt: r.createdAt.toISOString() };
  }
}

const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

function uniqHex(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const c of list) {
    const h = normalizeHex(c);
    if (h && !out.includes(h)) out.push(h);
    if (out.length === 5) break;
  }
  return out;
}

/** Cores de um SVG (#rgb/#rrggbb em fill/stroke/stop-color/style), da mais usada pra menos; branco e preto puros vão pro fim. */
export function svgColors(svg: string): string[] {
  const count = new Map<string, number>();
  for (const m of svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = normalizeHex(`#${m[1]}`);
    if (h) count.set(h, (count.get(h) ?? 0) + 1);
  }
  const neutral = (h: string) => h === '#FFFFFF' || h === '#000000';
  return [...count.entries()]
    .sort((a, b) => Number(neutral(a[0])) - Number(neutral(b[0])) || b[1] - a[1])
    .map(([h]) => h)
    .slice(0, 5);
}
