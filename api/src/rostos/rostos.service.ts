import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreativeDetail, Face, FaceCount, FacesResponse, GenerateFacesResponse } from '@maquina/contratos';
import type { Creative } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor } from '../common/errors/falhas';
import { KeyedMutex } from '../common/util/mutex';
import { hasLoss, markStale, requireConfirm } from '../criativos/downstream';
import { CreativeStateMachine, invalidState, pickEvent } from '../criativos/state-machine';
import { CreativeViews } from '../criativos/views';
import { CustosService } from '../custos/custos.service';
import { EventosService } from '../eventos/eventos.service';
import { CATALOG_SERVICE, GENERATION_SERVICE, isIntegracaoError, type CatalogService, type GenerationService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';

/** §13.13: padrão de rostos por geração no v1 (o usuário escolhe 1-4). */
export const FACES_PER_BATCH: FaceCount = 4;
/** §13.13: padrão de rostos por geração no elenco de um lote de variação. */
export const CASTING_FACES_DEFAULT: FaceCount = 1;

@Injectable()
export class RostosService {
  private readonly log = new Logger('Rostos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly custos: CustosService,
    private readonly eventos: EventosService,
    private readonly locks: KeyedMutex,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  private async creative(auth: AuthContext, id: string): Promise<Creative> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  async list(auth: AuthContext, creativeId: string): Promise<FacesResponse> {
    const c = await this.creative(auth, creativeId);
    const faces = await this.prisma.face.findMany({ where: { creativeId: c.id }, include: { file: true }, orderBy: [{ batch: 'desc' }, { position: 'asc' }] });
    const batches = new Map<number, { batch: number; description: string; faces: Face[] }>();
    for (const f of faces) {
      const b = batches.get(f.batch) ?? { batch: f.batch, description: f.description, faces: [] };
      b.faces.push(await this.views.face(f, c.selectedFaceId));
      batches.set(f.batch, b);
    }
    return { description: c.faceDescription, batches: [...batches.values()], selectedFaceId: c.selectedFaceId, faceUnitPriceUsd: this.catalog.estimateFaces(1) };
  }

  /** POST …/faces/generate: um lote de `count` (1-4, padrão 4). Clique duplo = 409 (compare-and-set no estado). */
  async generate(auth: AuthContext, creativeId: string, description: string, count: FaceCount = FACES_PER_BATCH): Promise<GenerateFacesResponse> {
    const { c, batch, faces } = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      pickEvent(c.state, ['GENERATE_FACES']);
      await this.custos.assertWithinCap(auth.workspaceId, this.catalog.estimateFaces(count));
      const out = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'GENERATE_FACES', from: c.state, to: 'FACES_GENERATING', data: { faceDescription: description } });
        const last = await tx.face.findFirst({ where: { creativeId: c.id }, orderBy: { batch: 'desc' }, select: { batch: true } });
        const batch = (last?.batch ?? 0) + 1;
        const faces = [];
        for (let position = 0; position < count; position++) {
          faces.push(await tx.face.create({ data: { workspaceId: c.workspaceId, creativeId: c.id, batch, position, description, status: 'QUEUED' } }));
        }
        return { batch, faces };
      });
      this.sm.announce(c.id);
      return { c, ...out };
    });

    const views = await Promise.all(faces.map((f) => this.views.face({ ...f, file: null }, null)));
    let submitted = 0;
    for (const f of faces) {
      try {
        await this.gen.submitFace({ workspaceId: c.workspaceId, faceId: f.id, description, language: c.language });
        await this.prisma.face.updateMany({ where: { id: f.id, status: 'QUEUED' }, data: { status: 'GENERATING' } });
        submitted++;
      } catch (e) {
        // bloqueio de conteúdo na submissão = item FAILED SAFETY_BLOCK (não é 503); o resto = PROVIDER_ERROR (api.md, revisão onda 2)
        const blocked = isIntegracaoError(e) && e.code === 'SAFETY_BLOCK';
        this.log.warn(`submitFace ${f.id} falhou: ${(e as Error).message}`);
        await this.failFace(f.id, blocked ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR');
        if (blocked) submitted++;
      }
    }
    await this.settleBatch(c.id, batch);
    if (!submitted) {
      throw new AppException('PROVIDER_UNAVAILABLE', { provider: 'HIGGSFIELD' }); // rosto = Soul V2 desde 06/10
    }
    return { batch, faces: views };
  }

  async failFace(faceId: string, code: string) {
    const ac = asAsyncErrorCode(code);
    const f = await this.prisma.face.update({ where: { id: faceId }, data: { status: 'FAILED', errorCode: ac, failReason: failReasonFor(ac) } });
    if (f.creativeId) this.eventos.publish(f.creativeId, 'face.updated', await this.views.face({ ...f, file: null }, null));
  }

  /** Lote sem pendência: ≥1 READY → FACES_READY; todos FAILED → FACES_FAILED. Chamado pelo orquestrador. */
  async settleBatch(creativeId: string, batch: number) {
    const faces = await this.prisma.face.findMany({ where: { creativeId, batch }, select: { status: true } });
    if (!faces.length || faces.some((f) => f.status === 'QUEUED' || f.status === 'GENERATING')) return;
    const c = await this.prisma.creative.findUnique({ where: { id: creativeId }, select: { state: true } });
    if (c?.state !== 'FACES_GENERATING') return;
    const last = await this.prisma.face.findFirst({ where: { creativeId }, orderBy: { batch: 'desc' }, select: { batch: true } });
    if (last?.batch !== batch) return; // lote antigo
    await this.sm
      .transition({ creativeId, event: 'FACES_BATCH_DONE', from: 'FACES_GENERATING', to: faces.some((f) => f.status === 'READY') ? 'FACES_READY' : 'FACES_FAILED' })
      .catch(() => undefined);
  }

  async select(auth: AuthContext, creativeId: string, faceId: string, confirm?: boolean): Promise<CreativeDetail> {
    await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      const f = await this.prisma.face.findFirst({ where: { id: faceId, creativeId: c.id, workspaceId: c.workspaceId } });
      if (!f) throw new AppException('NOT_FOUND');
      const ev = pickEvent(c.state, ['SELECT_FACE', 'RESELECT_FACE']);
      if (f.status !== 'READY') throw invalidState(c.state, ['FACES_READY']);
      if (ev === 'RESELECT_FACE' && c.selectedFaceId === f.id) return;
      await this.prisma.$transaction(async (tx) => {
        const loss = ev === 'RESELECT_FACE' ? await requireConfirm(tx, c.id, confirm) : null;
        await this.sm.transition({ tx, creativeId: c.id, event: ev, from: c.state, to: 'ENGINE_PENDING', data: { selectedFaceId: f.id } });
        if (loss && hasLoss(loss)) await markStale(tx, c.id);
      });
      this.sm.announce(c.id);
    });
    return (await this.views.detailById(auth.workspaceId, creativeId))!;
  }

  async updateDescription(auth: AuthContext, creativeId: string, description: string) {
    const c = await this.creative(auth, creativeId);
    if (c.state === 'APPROVED') throw invalidState(c.state, ['AVATAR_PENDING', 'FACES_READY', 'FACES_FAILED']);
    await this.prisma.creative.update({ where: { id: c.id }, data: { faceDescription: description } });
    this.sm.announce(c.id);
    return { description };
  }
}
