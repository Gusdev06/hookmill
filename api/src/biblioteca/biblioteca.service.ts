import { Injectable } from '@nestjs/common';
import { AmostraService } from '../amostra/amostra.service';
import type { CreativeDownload, CreativeState, FileRef, FormatCode, LibraryMeta } from '@maquina/contratos';
import type { LibraryItemAuto } from '../criativos/contrato-auto';
import { ALL_FORMATS, FORMAT_CODE, autoFileName, formatFromQuery } from '../edicao/pecas';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { initials, num } from '../common/util/format';
import { invalidState } from '../criativos/state-machine';
import { CreativeViews, VARIATION_KIND_LABEL, variationRefOf } from '../criativos/views';
import { StorageService } from '../arquivos/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeAdName } from './ad-names';
import { LibraryQueryDto } from './biblioteca.dto';

const INCLUDE = {
  offer: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  finalRender: { include: { file: true } },
  thumbnail: true,
  selectedFace: { include: { file: true } },
  champion: { select: { id: true, name: true } },
  variationItem: { select: { kind: true, lever: true, isControl: true, batchId: true, code: true, axis: true, autoType: true } },
  // variacao-auto-v1: os 3 formatos da peça AUTO (render vigente READY de cada um)
  renders: { where: { status: 'READY', stale: false, format: { not: null } }, include: { file: true }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.CreativeInclude;

/** "Pick from your Library" (media=video): fora só a peça STATIC (PNG). Nulos explícitos: NOT no SQL descarta NULL. */
const ONLY_VIDEO: Prisma.CreativeWhereInput = {
  OR: [{ variationItemId: null }, { variationItem: { OR: [{ autoType: null }, { autoType: { not: 'STATIC' } }] } }],
};

@Injectable()
export class BibliotecaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: CreativeViews,
    private readonly storage: StorageService,
    private readonly amostra: AmostraService,
  ) {}

  async list(auth: AuthContext, q: LibraryQueryDto): Promise<{ items: LibraryItemAuto[]; meta: LibraryMeta }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    // amostra-gratis-v1 §3: peça de lote travado não entra na Library (o arquivo original não sai por URL assinada)
    const base: Prisma.CreativeWhereInput = { workspaceId: auth.workspaceId, archivedAt: null, state: 'APPROVED', ...(await this.amostra.libraryFilter(auth.workspaceId)) };
    const rows = await this.prisma.creative.findMany({
      where: {
        AND: [base, q.offerId ? { offerId: q.offerId } : {}, q.winners ? { isWinner: true } : {},
          q.championId ? { championId: q.championId } : {}, q.variationKind ? { variationKind: q.variationKind } : {},
          q.variationCode ? { variationCode: q.variationCode } : {}, q.media === 'video' ? ONLY_VIDEO : {}, afterCursor('approvedAt', decodeCursor(q.cursor))],
      },
      include: INCLUDE,
      orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const p = page(rows, limit, (r) => r.approvedAt ?? r.updatedAt);
    const offers = await this.prisma.offer.findMany({
      where: { workspaceId: auth.workspaceId, creatives: { some: base } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const items: LibraryItemAuto[] = [];
    for (const c of p.items) {
      const video = await this.views.file(c.finalRender?.file);
      if (!video) continue; // aprovado sem arquivo de render (dado inconsistente): não lista
      const thumb = (await this.views.file(c.thumbnail)) ?? (await this.views.file(c.selectedFace?.file)) ?? video;
      const by = c.approvedBy ?? { id: c.createdById, name: '' };
      items.push({
        id: c.id,
        name: c.name,
        offer: c.offer,
        engineLabel: c.variationKind ? VARIATION_KIND_LABEL[c.variationKind] : this.views.engineLabel(c.engineModel) ?? '',
        durationSec: num(c.finalRender?.durationSec) ?? 0,
        video,
        thumbnail: thumb as FileRef,
        isWinner: c.isWinner,
        approvedAt: (c.approvedAt ?? c.updatedAt).toISOString(),
        approvedBy: { id: by.id, name: by.name, initials: initials(by.name) },
        variation: variationRefOf(c),
        editedInEditor: await this.views.editedInEditor(c),
        adName: c.adName,
        media: c.finalRender?.file?.mimeType === 'image/png' ? 'image' : 'video',
        formats: await this.formatsOf(c.renders),
      });
    }
    return { items, meta: { nextCursor: p.nextCursor, offers } };
  }

  /** Formatos prontos da peça AUTO, na ordem 9:16, 4:5, 1:1 (criativo comum: só o do render final, que é o `video`). */
  private async formatsOf(renders: Prisma.RenderGetPayload<{ include: { file: true } }>[]): Promise<{ format: FormatCode; file: FileRef }[]> {
    const out: { format: FormatCode; file: FileRef }[] = [];
    for (const f of ALL_FORMATS) {
      const r = renders.find((x) => x.format === f && x.file);
      if (r) out.push({ format: FORMAT_CODE[f], file: (await this.views.file(r.file))! });
    }
    return out;
  }

  /** Marcar/desmarcar vencedor (idempotente). Só APPROVED. */
  async setWinner(auth: AuthContext, creativeId: string, isWinner: boolean) {
    const c = await this.prisma.creative.findFirst({ where: { id: creativeId, workspaceId: auth.workspaceId, archivedAt: null }, select: { id: true, state: true, isWinner: true } });
    if (!c) throw new AppException('NOT_FOUND');
    if (c.state !== 'APPROVED') throw invalidState(c.state, ['APPROVED']);
    if (c.isWinner !== isWinner) {
      await this.prisma.creative.update({ where: { id: c.id }, data: { isWinner, winnerMarkedAt: isWinner ? new Date() : null } });
    }
    return { id: c.id, isWinner };
  }

  /**
   * GET /creatives/:id/download (fase2-agencia.md §3.5): APPROVED → render final, nome congelado (adName);
   * RENDER_READY sem editDirty → último render READY não stale, nome provisório (calculado, não salvo).
   */
  async download(auth: AuthContext, creativeId: string, format?: FormatCode): Promise<CreativeDownload> {
    const c = await this.prisma.creative.findFirst({
      where: { id: creativeId, workspaceId: auth.workspaceId, archivedAt: null },
      select: { id: true, state: true, editDirty: true, adName: true, variationKind: true, finalRender: { include: { file: true } } },
    });
    if (!c) throw new AppException('NOT_FOUND');
    const allowed: CreativeState[] = ['RENDER_READY', 'APPROVED'];
    // variacao-auto-v1 §5.1/§8: peça AUTO tem 1 render por formato; ?format escolhe (padrão 9x16); nome <adName>_<FMT>.<ext>
    if (c.variationKind === 'AUTO_EDIT') {
      const fmt = formatFromQuery(format);
      const r = c.state === 'APPROVED'
        ? await this.prisma.render.findFirst({ where: { creativeId: c.id, format: fmt, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' }, include: { file: true } })
        : null;
      if (c.state !== 'APPROVED') throw invalidState(c.state, ['APPROVED']);
      // rev. 23/10 §14.2: formato que não está READY (sob demanda ainda não pedido, na fila ou falho) = reason format_not_ready
      if (!r?.file) throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'format_not_ready' });
      const frozen = !!c.adName;
      const fileName = autoFileName(c.adName ?? (await computeAdName(this.prisma, c.id)), fmt, r.file.mimeType);
      const { url, expiresAt } = await this.storage.signedDownloadUrl(r.file, fileName);
      return {
        url, fileName, frozen, sizeBytes: r.file.sizeBytes,
        durationSec: r.file.mimeType === 'image/png' ? null : num(r.durationSec) ?? num(r.file.durationSec),
        expiresAt: expiresAt.toISOString(),
      };
    }
    let render = c.state === 'APPROVED' ? c.finalRender : null;
    if (c.state === 'RENDER_READY' && !c.editDirty) {
      render = await this.prisma.render.findFirst({
        where: { creativeId: c.id, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' }, include: { file: true },
      });
    }
    if (!render?.file) throw invalidState(c.state, allowed);
    // aprovado antes da fase 2 (sem adName): nome calculado com a data do OK, sem congelar
    const frozen = c.state === 'APPROVED' && !!c.adName;
    const base = frozen ? c.adName! : await computeAdName(this.prisma, c.id);
    const fileName = `${base}.mp4`;
    const { url, expiresAt } = await this.storage.signedDownloadUrl(render.file, fileName);
    return {
      url, fileName, frozen,
      sizeBytes: render.file.sizeBytes,
      durationSec: num(render.durationSec) ?? num(render.file.durationSec),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
