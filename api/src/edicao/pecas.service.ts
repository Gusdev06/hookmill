// Peças do lote AUTO (variacao-auto-v1 §3.2, §3.3, §5.1): criação no start, vista IteratePiece, Retry, Leave out, In zip.
// O lote (máquina, start, GET /iterate/:id) é do módulo iteracao (B1); ele chama createPieces/launched/pieces daqui.
import { Injectable } from '@nestjs/common';
import type { IteratePiece, VariationAxis } from '@maquina/contratos';
import type { Prisma, VideoFormat } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { computeAdName } from '../biblioteca/ad-names';
import { CreativeStateMachine, initialState } from '../criativos/state-machine';
import { PrismaService } from '../prisma/prisma.service';
import { EdicaoService } from './edicao.service';
import {
  AUTO_EDIT_TEMPLATE, AUTO_FORMATS, FORMAT_CODE, autoFileName, expectedOutputSec, folderOf, latestByFormat, median, pieceStatus, renderOrder,
} from './pecas';

const ITEM_INCLUDE = {
  creative: {
    include: {
      renders: { where: { stale: false }, include: { file: true }, orderBy: { createdAt: 'asc' } },
      thumbnail: true,
    },
  },
} satisfies Prisma.VariationItemInclude;
type ItemRow = Prisma.VariationItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** Status do lote que o B1 passa pra vista (só importa se já lançou). */
export interface PieceBatchRef { id: string; workspaceId: string; status: string }

@Injectable()
export class PecasAutoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sm: CreativeStateMachine,
    private readonly edicao: EdicaoService,
    private readonly locks: KeyedMutex,
  ) {}

  // ───────── start (chamado pelo B1) ─────────

  /**
   * `POST /iterate/:id/start`, DENTRO da transação que pôs o lote em LAUNCHED: 1 criativo por peça (AUTO_PIECE_START →
   * RENDERING) e 3 renders QUEUED na ordem da fila (9:16 de todas, depois 4:5, depois 1:1). `launchedAt` = o gravado no lote
   * (MMDD do adName). Depois do commit, chame `launched(creativeIds)`.
   */
  async createPieces(tx: Prisma.TransactionClient, input: { batchId: string; userId: string; launchedAt: Date }): Promise<{ creativeIds: string[] }> {
    const batch = await tx.variationBatch.findUniqueOrThrow({
      where: { id: input.batchId },
      include: { champion: { select: { name: true } }, items: { where: { kind: 'AUTO_EDIT' }, orderBy: { index: 'asc' } } },
    });
    const ids = new Map<string, string>();
    for (const item of batch.items) {
      const c = await tx.creative.create({
        data: {
          workspaceId: batch.workspaceId, offerId: batch.offerId, name: `${batch.champion.name} · ${item.code ?? item.index + 1}`,
          language: batch.language, state: initialState('AUTO_PIECE_START'), createdById: input.userId,
          origin: 'VARIATION', championId: batch.championId, variationBatchId: batch.id, variationItemId: item.id,
          variationKind: 'AUTO_EDIT', variationCode: item.code, voiceSource: 'CHAMPION_AUDIO', format: 'VERTICAL_9_16',
        },
      });
      ids.set(item.id, c.id);
    }
    // a fila tira o QUEUED mais antigo primeiro: createdAt = launchedAt + posição (ms) fixa a ordem do §5.1
    await tx.render.createMany({
      data: renderOrder(batch.items).map(({ item, format, seq }) => ({
        workspaceId: batch.workspaceId, creativeId: ids.get(item.id)!, status: 'QUEUED' as const, format,
        settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {}, createdAt: new Date(input.launchedAt.getTime() + seq),
      })),
    });
    return { creativeIds: [...ids.values()] };
  }

  /** Depois do commit do start: avisa o SSE de cada criativo e acorda a fila. */
  launched(creativeIds: string[]): void {
    for (const id of creativeIds) this.sm.announce(id);
    this.edicao.kick();
  }

  // ───────── vista ─────────

  /** IteratePiece[] do lote, na ordem do plano (PLAN_READY: todas `planned`). */
  async pieces(batch: PieceBatchRef): Promise<IteratePiece[]> {
    const items = await this.prisma.variationItem.findMany({ where: { batchId: batch.id, kind: 'AUTO_EDIT' }, include: ITEM_INCLUDE, orderBy: { index: 'asc' } });
    return Promise.all(items.map((i) => this.piece(i, batch.status === 'LAUNCHED')));
  }

  /** Uma peça (respostas do Retry/Leave out/In zip). */
  async pieceById(pieceId: string): Promise<IteratePiece> {
    const i = await this.prisma.variationItem.findUniqueOrThrow({ where: { id: pieceId }, include: { ...ITEM_INCLUDE, batch: { select: { status: true } } } });
    return this.piece(i, i.batch.status === 'LAUNCHED');
  }

  private async piece(i: ItemRow, launched: boolean): Promise<IteratePiece> {
    const c = i.creative;
    const renders = c?.renders ?? [];
    const status = pieceStatus({ launched, leftOutAt: i.leftOutAt, creativeState: c?.state ?? null, renders });
    const latest = latestByFormat(renders);
    const ready = AUTO_FORMATS.map((f) => latest.get(f)).filter((r): r is NonNullable<typeof r> => r?.status === 'READY' && !!r.file);
    const now = renders.find((r) => r.status === 'RENDERING');
    const failedish = status === 'failed' || status === 'left_out';
    const errorCode = failedish ? i.errorCode ?? 'RENDER_ERROR' : null;
    let files: IteratePiece['files'] = [];
    if (c && ready.length) {
      const adName = c.adName ?? (await computeAdName(this.prisma, c.id));
      files = await Promise.all(ready.map(async (r) => {
        const name = autoFileName(adName, r.format as VideoFormat, r.file!.mimeType);
        return {
          format: FORMAT_CODE[r.format as VideoFormat], name, url: (await this.storage.signedDownloadUrl(r.file!, name)).url,
          mimeType: r.file!.mimeType === 'image/png' ? ('image/png' as const) : ('video/mp4' as const),
          sizeBytes: r.file!.sizeBytes, durationSec: r.file!.mimeType === 'image/png' ? null : num(r.durationSec) ?? num(r.file!.durationSec),
        };
      }));
    }
    return {
      id: i.id, index: i.index, type: i.autoType!, code: i.code ?? '', axis: i.axis as VariationAxis, change: i.change ?? '',
      status, previewReady: latest.get('VERTICAL_9_16')?.status === 'READY',
      render: now ? { format: FORMAT_CODE[(now.format ?? 'VERTICAL_9_16') as VideoFormat], progress: now.progress, frame: now.frame, frames: now.totalFrames } : null,
      formatsReady: ready.length as IteratePiece['formatsReady'],
      errorCode, failReason: failedish ? i.failReason : null,
      retryHint: !failedish || errorCode === 'SOURCE_UNAVAILABLE' ? null
        : i.autoType === 'SPLIT_LP' && errorCode?.startsWith('PAGE_') ? 'use_product_photo' : 'retry',
      inZip: i.inZip, creativeId: c?.id ?? null,
      poster: c?.thumbnail ? await this.storage.fileRef(c.thumbnail) : null,
      files, folder: folderOf(i.axis),
    };
  }

  /**
   * `summary.renderEtaSec` (§10): segundos de saída que faltam × velocidade medida (mediana dos últimos 20 renders READY do
   * mesmo formato: (finishedAt − startedAt) ÷ durationSec). Sem histórico = null.
   */
  async renderEtaSec(batchId: string): Promise<number | null> {
    const pending = await this.prisma.render.findMany({
      where: { stale: false, status: { in: ['QUEUED', 'RENDERING'] }, creative: { variationBatchId: batchId, variationKind: 'AUTO_EDIT' } },
      select: { format: true, progress: true, creative: { select: { variationItem: { select: { autoType: true, payload: true } }, champion: { select: { durationSec: true } } } } },
    });
    if (!pending.length) return 0;
    let total = 0;
    for (const f of AUTO_FORMATS) {
      const mine = pending.filter((p) => p.format === f);
      if (!mine.length) continue;
      const hist = await this.prisma.render.findMany({
        where: { format: f, status: 'READY', startedAt: { not: null }, finishedAt: { not: null }, durationSec: { gt: 0 } },
        orderBy: { finishedAt: 'desc' }, take: 20, select: { startedAt: true, finishedAt: true, durationSec: true },
      });
      const speed = median(hist.map((h) => (h.finishedAt!.getTime() - h.startedAt!.getTime()) / 1000 / num(h.durationSec)!));
      if (speed == null) return null;
      for (const p of mine) {
        const item = p.creative.variationItem;
        const params = ((item?.payload ?? {}) as { params?: Record<string, unknown> }).params ?? null;
        const out = expectedOutputSec(item?.autoType ?? null, params, num(p.creative.champion?.durationSec) ?? 0);
        total += out * speed * (1 - p.progress / 100);
      }
    }
    return Math.round(total);
  }

  // ───────── ações da peça ─────────

  private async item(auth: AuthContext, pieceId: string) {
    const i = await this.prisma.variationItem.findFirst({
      where: { id: pieceId, workspaceId: auth.workspaceId, kind: 'AUTO_EDIT', batch: { mode: 'AUTO', champion: { archivedAt: null } } },
      include: { ...ITEM_INCLUDE, batch: { select: { status: true, offerId: true } } },
    });
    if (!i) throw new AppException('NOT_FOUND');
    return i;
  }

  private status(i: ItemRow & { batch: { status: string } }) {
    return pieceStatus({ launched: i.batch.status === 'LAUNCHED', leftOutAt: i.leftOutAt, creativeState: i.creative?.state ?? null, renders: i.creative?.renders ?? [] });
  }

  private static invalid(state: string, allowed: string[]): AppException {
    return new AppException('INVALID_STATE', { state, allowed });
  }

  /**
   * `POST /iterate/pieces/:pieceId/retry` (grátis, sem teto): peça `failed`/`left_out` → re-enfileira só os formatos FAILED
   * (os antigos viram stale), RENDER_FAILED → RENDERING (evento RENDER), limpa leftOutAt e o erro. D4: `useProductPhoto`
   * (só SPLIT-LP) exige a foto do produto na oferta.
   */
  async retry(auth: AuthContext, pieceId: string, dto: { useProductPhoto?: boolean }): Promise<IteratePiece> {
    const pre = await this.item(auth, pieceId);
    if (!pre.creative) throw PecasAutoService.invalid(this.status(pre), ['failed', 'left_out']);
    const creativeId = pre.creative.id;
    await this.locks.run(creativeId, async () => {
      const i = await this.item(auth, pieceId);
      const st = this.status(i);
      if (st !== 'failed' && st !== 'left_out') throw PecasAutoService.invalid(st, ['failed', 'left_out']);
      if (dto.useProductPhoto && i.autoType === 'SPLIT_LP') {
        const offer = await this.prisma.offer.findUnique({ where: { id: i.batch.offerId }, select: { productImageFileId: true } });
        if (!offer?.productImageFileId) throw new AppException('NO_PRODUCT_PHOTO');
      }
      const latest = latestByFormat(i.creative!.renders);
      const failed = AUTO_FORMATS.filter((f) => latest.get(f)?.status === 'FAILED');
      const payload = (i.payload ?? {}) as Record<string, unknown>;
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId, event: 'RENDER', from: 'RENDER_FAILED', to: 'RENDERING' });
        await tx.render.updateMany({ where: { id: { in: failed.map((f) => latest.get(f)!.id) } }, data: { stale: true } });
        const t = Date.now();
        await tx.render.createMany({
          data: failed.map((format) => ({
            workspaceId: i.workspaceId, creativeId, status: 'QUEUED' as const, format,
            settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {}, createdAt: new Date(t + AUTO_FORMATS.indexOf(format)),
          })),
        });
        await tx.variationItem.update({
          where: { id: i.id },
          data: {
            leftOutAt: null, errorCode: null, failReason: null,
            ...(dto.useProductPhoto !== undefined && i.autoType === 'SPLIT_LP' && { payload: { ...payload, useProductPhoto: dto.useProductPhoto } as Prisma.InputJsonValue }),
          },
        });
      });
      this.sm.announce(creativeId);
    });
    this.edicao.kick();
    return this.pieceById(pieceId);
  }

  /** `POST /iterate/pieces/:pieceId/leave-out`: só `failed` → `left_out` + fora do zip. */
  async leaveOut(auth: AuthContext, pieceId: string): Promise<IteratePiece> {
    const i = await this.item(auth, pieceId);
    const st = this.status(i);
    if (st !== 'failed') throw PecasAutoService.invalid(st, ['failed']);
    const r = await this.prisma.variationItem.updateMany({ where: { id: i.id, leftOutAt: null }, data: { leftOutAt: new Date(), inZip: false } });
    if (r.count !== 1) throw PecasAutoService.invalid('left_out', ['failed']);
    return this.pieceById(pieceId);
  }

  /** `PATCH /iterate/pieces/:pieceId { inZip }`: só `ready` (CLIENT pode). */
  async setInZip(auth: AuthContext, pieceId: string, inZip: boolean): Promise<IteratePiece> {
    const i = await this.item(auth, pieceId);
    const st = this.status(i);
    if (st !== 'ready') throw PecasAutoService.invalid(st, ['ready']);
    if (i.inZip !== inZip) await this.prisma.variationItem.update({ where: { id: i.id }, data: { inZip } });
    return this.pieceById(pieceId);
  }
}
