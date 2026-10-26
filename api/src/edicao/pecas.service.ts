// Peças do lote AUTO (variacao-auto-v1 §3.2, §3.3, §5.1; Revisão 23/10 §14.2): criação no start (só 9:16), vista
// IteratePiece (com `formats`), Retry, Leave out, In zip e o pedido de formato sob demanda (4:5/1:1).
// O lote (máquina, start, GET /iterate/:id) é do módulo iteracao (B1); ele chama createPieces/launched/pieces daqui.
import { Inject, Injectable } from '@nestjs/common';
import type { AutoVariationType, FormatCode, IteratePiece, VariationAxis } from '@maquina/contratos';
import type { Prisma, VideoFormat } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { computeAdName } from '../biblioteca/ad-names';
import { CreativeStateMachine, initialState } from '../criativos/state-machine';
import { CustosService } from '../custos/custos.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { EdicaoService } from './edicao.service';
import { ImagemEstaticaService } from './imagem-estatica.service';
import {
  ALL_FORMATS, AUTO_EDIT_TEMPLATE, FORMAT_CODE, criticalErrorsOf, latestReadyByFormat, FORMAT_OF_CODE, FRAME_TEXT_OVERFLOW, PRIORITY_BATCH, PRIORITY_ON_DEMAND, STATIC_IMAGE_ETA_SEC,
  autoFileName, engineFor, estimateStaticUsd, expectedOutputSec, folderOf, latestByFormat, median, paramsOf, pieceFormats, pieceFrameOf, pieceStatus,
  primaryFormatOf, renderOrder, staticRenderStage, suggestedPrimaryTextOf, supportedFormatsOf, textCheckOf,
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

/** O que o start criou: criativos (SSE) e os renders IMAGE_GEN do STATIC (submetidos depois do commit). */
export interface LaunchedPieces { creativeIds: string[]; staticRenderIds: string[] }

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
    private readonly imagem: ImagemEstaticaService,
    private readonly custos: CustosService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  /** §14.4: preço de 1 imagem do STATIC (`IterateConfig.staticImageUsd`, `requestUsd`, `retryUsd`). */
  staticImageUsd(): number {
    return estimateStaticUsd(this.catalog, 1);
  }

  // ───────── start (chamado pelo B1) ─────────

  /**
   * `POST /iterate/:id/start`, DENTRO da transação que pôs o lote em LAUNCHED: 1 criativo por peça (AUTO_PIECE_START →
   * RENDERING) e 1 render 9:16 QUEUED por peça (§14.2), na ordem do plano (`createdAt = launchedAt + index`, priority 0).
   * Vídeo = engine REMOTION (fila); STATIC = IMAGE_GEN (submetido depois do commit). `launchedAt` = o gravado no lote
   * (MMDD do adName). Depois do commit, chame `launched(resultado)`.
   */
  async createPieces(tx: Prisma.TransactionClient, input: { batchId: string; userId: string; launchedAt: Date }): Promise<LaunchedPieces> {
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
    // a fila tira o QUEUED mais antigo primeiro (mesma prioridade): createdAt = launchedAt + posição (ms) = ordem do plano
    await tx.render.createMany({
      // headline-e-legenda-v1 §1.5: HEADLINE nasce no aspecto do campeão (o resto, no 9:16)
      data: renderOrder(batch.items).map(({ item, seq }) => ({ item, seq, format: primaryFormatOf(item.autoType, paramsOf(item.payload)) })).map(({ item, format, seq }) => ({
        workspaceId: batch.workspaceId, creativeId: ids.get(item.id)!, status: 'QUEUED' as const, format,
        engine: engineFor(item.autoType), priority: PRIORITY_BATCH,
        settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {}, createdAt: new Date(input.launchedAt.getTime() + seq),
      })),
    });
    const statics = await tx.render.findMany({ where: { creativeId: { in: [...ids.values()] }, engine: 'IMAGE_GEN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    return { creativeIds: [...ids.values()], staticRenderIds: statics.map((r) => r.id) };
  }

  /** Depois do commit do start: avisa o SSE de cada criativo, acorda a fila do Remotion e submete as imagens do STATIC. */
  launched(p: LaunchedPieces): void {
    for (const id of p.creativeIds) this.sm.announce(id);
    this.edicao.kick();
    for (const id of p.staticRenderIds) void this.imagem.dispatch(id);
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
    // §A10.1: enquanto uma refação roda, `files` mostra a imagem pronta anterior (o READY mais novo de cada formato)
    const readyBy = latestReadyByFormat(renders);
    const ready = ALL_FORMATS.map((f) => readyBy.get(f)).filter((r): r is NonNullable<typeof r> => !!r?.file);
    const isStatic = i.autoType === 'STATIC';
    const staticUsd = this.staticImageUsd();
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
    const params = paramsOf(i.payload);
    const retryHint: IteratePiece['retryHint'] = !failedish || errorCode === 'SOURCE_UNAVAILABLE' ? null
      : errorCode === FRAME_TEXT_OVERFLOW || errorCode?.startsWith('HEADLINE_') ? 'leave_out' // §B2 / headline §1.3-1.4: refazer não adianta
        : i.autoType === 'SPLIT_LP' && errorCode?.startsWith('PAGE_') ? 'use_product_photo' : 'retry';
    const vertical = readyBy.get('VERTICAL_9_16');
    return {
      id: i.id, index: i.index, type: i.autoType!, code: i.code ?? '', axis: i.axis as VariationAxis, change: i.change ?? '',
      status, previewReady: (primaryFormatOf(i.autoType, params) === 'VERTICAL_9_16' ? vertical : readyBy.get(primaryFormatOf(i.autoType, params)))?.status === 'READY',
      media: isStatic ? 'image' : 'video',
      render: now ? {
        format: FORMAT_CODE[(now.format ?? 'VERTICAL_9_16') as VideoFormat], progress: now.progress, frame: now.frame, frames: now.totalFrames,
        // §A10.4: STATIC mostra a etapa (imagem / checagem / refação) e a tentativa (1 ou 2)
        ...(isStatic && { stage: staticRenderStage(now.stage), attempt: (Math.min(2, Math.max(1, ((now.input as { providerTaskIds?: string[] } | null)?.providerTaskIds?.length ?? 1))) as 1 | 2) }),
      } : null,
      formatsReady: ready.length as IteratePiece['formatsReady'],
      formats: pieceFormats(renders, isStatic, staticUsd, supportedFormatsOf(i.autoType, params)).map((f) => {
        if (!isStatic) return f;
        const r = readyBy.get(FORMAT_OF_CODE[f.format]);
        return { ...f, textCheck: r?.status === 'READY' ? textCheckOf(r.input) : null }; // §A10.4: checagem de cada formato
      }),
      errorCode, failReason: failedish ? i.failReason : null,
      retryHint,
      retryUsd: retryHint && retryHint !== 'leave_out' ? (isStatic ? staticUsd : 0) : null,
      inZip: i.inZip, creativeId: c?.id ?? null,
      poster: c?.thumbnail ? await this.storage.fileRef(c.thumbnail) : null,
      files, folder: folderOf(i.axis),
      frame: i.autoType === 'FRAME' ? pieceFrameOf(params) : null,
      // §A6: só STATIC assembled com a imagem do 9:16 pronta
      textCheck: isStatic && vertical?.status === 'READY' ? textCheckOf(vertical.input) : null,
      suggestedPrimaryText: i.autoType === 'FRAME' ? suggestedPrimaryTextOf(params) : null,
      // headline-e-legenda-v1 (TRANSIÇÃO, nomes do web/types.ts): "original → nova" na peça HEADLINE
      ...((i.autoType as string) === 'HEADLINE' && {
        headline: { mode: params?.mode === 'add' ? 'add' : 'replace', original: (params?.original as string | null) ?? null, text: String(params?.text ?? ''), highlight: (params?.highlight as string | null) ?? null },
      }),
    } as IteratePiece;
  }

  /**
   * `summary.renderEtaSec` (§10, §14.2): renders pendentes do lote (9:16 e sob demanda). Remotion = segundos de saída que
   * faltam × velocidade medida (mediana dos últimos 20 renders READY do mesmo formato: (finishedAt − startedAt) ÷
   * durationSec; sem histórico = null); IMAGE_GEN = STATIC_IMAGE_ETA_SEC fixos por imagem.
   */
  async renderEtaSec(batchId: string): Promise<number | null> {
    const pending = await this.prisma.render.findMany({
      where: { stale: false, status: { in: ['QUEUED', 'RENDERING'] }, creative: { variationBatchId: batchId, variationKind: 'AUTO_EDIT' } },
      select: { format: true, engine: true, progress: true, creative: { select: { variationItem: { select: { autoType: true, payload: true } }, champion: { select: { durationSec: true } } } } },
    });
    if (!pending.length) return 0;
    let total = pending.filter((p) => p.engine === 'IMAGE_GEN').length * STATIC_IMAGE_ETA_SEC;
    for (const f of ALL_FORMATS) {
      const mine = pending.filter((p) => p.format === f && p.engine === 'REMOTION');
      if (!mine.length) continue;
      const hist = await this.prisma.render.findMany({
        where: { format: f, engine: 'REMOTION', status: 'READY', startedAt: { not: null }, finishedAt: { not: null }, durationSec: { gt: 0 } },
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
   * `POST /iterate/pieces/:pieceId/retry`: peça `failed`/`left_out` → re-enfileira os formatos FAILED (os antigos viram
   * stale; no lote novo é só o 9:16), RENDER_FAILED → RENDERING (evento RENDER), limpa leftOutAt e o erro. Vídeo é grátis
   * e sem teto; STATIC (§14.3/§14.4) cria IMAGE_GEN novo e checa o teto com 1 imagem por formato (preço em `retryUsd`).
   * D4: `useProductPhoto` (só SPLIT-LP) exige a foto do produto na oferta.
   */
  async retry(auth: AuthContext, pieceId: string, dto: { useProductPhoto?: boolean }): Promise<IteratePiece> {
    const pre = await this.item(auth, pieceId);
    if (!pre.creative) throw PecasAutoService.invalid(this.status(pre), ['failed', 'left_out']);
    const creativeId = pre.creative.id;
    let staticIds: string[] = [];
    let nothingQueued = false;
    await this.locks.run(creativeId, async () => {
      const i = await this.item(auth, pieceId);
      const st = this.status(i);
      // §A10.1: STATIC `ready` com texto errado = refaz a imagem 9:16 (cobra, teto); a anterior fica até a nova assentar
      const cur = latestByFormat(i.creative!.renders).get('VERTICAL_9_16');
      const check = st === 'ready' && i.autoType === 'STATIC' && cur?.status === 'READY' ? textCheckOf(cur.input) : null;
      if (check?.status === 'mismatch' && cur?.fileId) {
        await this.custos.assertWithinCap(i.workspaceId, this.staticImageUsd());
        const r = await this.prisma.render.create({
          data: {
            workspaceId: i.workspaceId, creativeId, status: 'QUEUED', format: 'VERTICAL_9_16', engine: 'IMAGE_GEN', priority: PRIORITY_ON_DEMAND,
            settings: { templateId: AUTO_EDIT_TEMPLATE },
            // a imagem atual entra como candidata: a nova só troca se tiver ≤ erros críticos (§A6); falhou = fica a atual
            input: { retakeOf: cur.id, candidates: [{ providerTaskId: `render:${cur.id}`, fileId: cur.fileId, check, criticalErrors: criticalErrorsOf(check) }] } as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        staticIds = [r.id];
        return;
      }
      if (st !== 'failed' && st !== 'left_out') throw PecasAutoService.invalid(st, ['failed', 'left_out']);
      if (dto.useProductPhoto && i.autoType === 'SPLIT_LP') {
        const offer = await this.prisma.offer.findUnique({ where: { id: i.batch.offerId }, select: { productImageFileId: true } });
        if (!offer?.productImageFileId) throw new AppException('NO_PRODUCT_PHOTO');
      }
      const latest = latestByFormat(i.creative!.renders);
      const failed = ALL_FORMATS.filter((f) => latest.get(f)?.status === 'FAILED');
      const engine = engineFor(i.autoType);
      if (engine === 'IMAGE_GEN' && failed.length) await this.custos.assertWithinCap(i.workspaceId, estimateStaticUsd(this.catalog, failed.length));
      const payload = (i.payload ?? {}) as Record<string, unknown>;
      nothingQueued = !failed.length;
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId, event: 'RENDER', from: 'RENDER_FAILED', to: 'RENDERING' });
        await tx.render.updateMany({ where: { id: { in: failed.map((f) => latest.get(f)!.id) } }, data: { stale: true } });
        const t = Date.now();
        const created: string[] = [];
        for (const format of failed) {
          const r = await tx.render.create({
            data: {
              // §A10 1b: Retry roda com prioridade 10 (não volta o lote pra Generate; o `phase` só olha os 9:16 de prioridade 0)
              workspaceId: i.workspaceId, creativeId, status: 'QUEUED', format, engine, priority: PRIORITY_ON_DEMAND,
              settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {}, createdAt: new Date(t + ALL_FORMATS.indexOf(format)),
            },
            select: { id: true },
          });
          created.push(r.id);
        }
        if (engine === 'IMAGE_GEN') staticIds = created;
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
    for (const id of staticIds) void this.imagem.dispatch(id);
    if (nothingQueued) await this.edicao.settleAuto(creativeId); // peça de lote antigo sem formato FAILED: assenta pelo 9:16
    return this.pieceById(pieceId);
  }

  /**
   * `POST /iterate/pieces/:pieceId/formats` (§14.2): pede (ou refaz) o 4:5/1:1 de uma peça `ready`. Idempotente por
   * (peça, formato) sob o lock do criativo: vigente QUEUED/RENDERING/READY = 200 sem criar nada; FAILED = o antigo vira
   * stale e nasce outro (retry do formato); sem render = cria. Vídeo: REMOTION priority 10 (na frente do lote, FIFO entre
   * os pedidos; nunca interrompe o que já roda). STATIC: teto com 1 imagem + IMAGE_GEN submetido depois do commit. O
   * criativo não muda de estado (segue APPROVED, adName congelado); só sai `render.updated`.
   */
  async requestFormat(auth: AuthContext, pieceId: string, code: Exclude<FormatCode, '9x16'>): Promise<{ httpStatus: 200 | 202; piece: IteratePiece }> {
    const format = FORMAT_OF_CODE[code];
    const pre = await this.item(auth, pieceId);
    if (!pre.creative) throw PecasAutoService.invalid(this.status(pre), ['ready']);
    const creativeId = pre.creative.id;
    let created: { id: string; engine: 'REMOTION' | 'IMAGE_GEN' } | null = null;
    await this.locks.run(creativeId, async () => {
      const i = await this.item(auth, pieceId);
      const st = this.status(i);
      if (st !== 'ready') throw PecasAutoService.invalid(st, ['ready']);
      // §B4: moldura sem este formato (reprovado na revisão visual) = 409 format_not_supported
      const supported = supportedFormatsOf(i.autoType, paramsOf(i.payload));
      if (supported && !supported.includes(code)) throw new AppException('INVALID_STATE', { state: st, allowed: [], reason: 'format_not_supported' });
      const cur = latestByFormat(i.creative!.renders).get(format);
      if (cur && cur.status !== 'FAILED') return;
      const engine = engineFor(i.autoType);
      if (engine === 'IMAGE_GEN') await this.custos.assertWithinCap(i.workspaceId, this.staticImageUsd());
      created = await this.prisma.$transaction(async (tx) => {
        if (cur) await tx.render.update({ where: { id: cur.id }, data: { stale: true } });
        return tx.render.create({
          data: {
            workspaceId: i.workspaceId, creativeId, status: 'QUEUED', format, engine, priority: PRIORITY_ON_DEMAND,
            settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {},
          },
          select: { id: true, engine: true },
        });
      });
    });
    const c = created as { id: string; engine: 'REMOTION' | 'IMAGE_GEN' } | null;
    if (c) {
      await this.edicao.publish(c.id);
      if (c.engine === 'IMAGE_GEN') void this.imagem.dispatch(c.id);
      else this.edicao.kick();
    }
    return { httpStatus: c ? 202 : 200, piece: await this.pieceById(pieceId) };
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
