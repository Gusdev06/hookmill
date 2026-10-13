import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CampeoesService } from '../campeoes/campeoes.service';
import { failReasonFor } from '../common/errors/falhas';
import { VariacoesService } from '../variacoes/variacoes.service';
import { IteracaoService } from '../iteracao/iteracao.service';
import { EdicaoService } from '../edicao/edicao.service';
import { GeracaoService } from '../geracao/geracao.service';
import { OrquestradorService } from '../geracao/orquestrador.service';
import { TakeService } from '../geracao/take.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoteirosService } from '../roteiros/roteiros.service';
import { RostosService } from '../rostos/rostos.service';

/**
 * Retomada depois de reinício da API (modelo-de-dados.md):
 *  1. jobs do Claude QUEUED/RUNNING → FAILED INTERRUPTED + transição de falha (roteiros: READY se sobrou algum, senão FAILED);
 *  2. renders RENDERING → QUEUED (a fila pega de novo);
 *  3. tasks da WaveSpeed que terminaram e não foram tratadas (API caiu no meio) → orquestrador;
 *  4. cena/rosto pendente sem task viva → FAILED INTERRUPTED (o usuário regera).
 * BOOT_RECOVERY=off desliga a rodada automática do boot: SÓ pros testes de integração, em que vários processos
 * da API dividem o banco local e a retomada de um mataria o trabalho em andamento do outro (em produção há uma instância).
 */
@Injectable()
export class RecuperacaoService implements OnApplicationBootstrap {
  private readonly log = new Logger('Recuperacao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly roteiros: RoteirosService,
    private readonly rostos: RostosService,
    private readonly geracao: GeracaoService,
    private readonly orquestrador: OrquestradorService,
    private readonly takes: TakeService,
    private readonly edicao: EdicaoService,
    private readonly campeoes: CampeoesService,
    private readonly variacoes: VariacoesService,
    private readonly iteracao: IteracaoService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.BOOT_RECOVERY === 'off') return;
    void this.recover().catch((e) => this.log.error(`retomada falhou: ${(e as Error).stack ?? e}`));
  }

  /** `workspaceId` restringe a retomada a um workspace (testes); o boot roda sem filtro. */
  async recover(opts: { workspaceId?: string } = {}): Promise<{ jobs: number; renders: number; tasks: number; scenes: number; faces: number }> {
    const ws = opts.workspaceId ? { workspaceId: opts.workspaceId } : {};
    // 1. jobs
    const jobs = await this.prisma.job.findMany({ where: { ...ws, status: { in: ['QUEUED', 'RUNNING'] } } });
    for (const j of jobs) {
      if (j.type === 'OFFER_EXTRACT' || !j.creativeId) {
        await this.jobs.finish(j.id, { status: 'FAILED', errorCode: 'INTERRUPTED', failReason: failReasonFor('INTERRUPTED') });
      } else {
        await this.roteiros.finish(j.id, j.creativeId, null, 'INTERRUPTED');
      }
    }

    // 1b. feature 2: campeão RESOLVING/ANALYZING cujo job morreu → FAILED INTERRUPTED (action: analyze_again/upload_video)
    await this.campeoes.recover(opts.workspaceId);
    await this.variacoes.recover(opts.workspaceId);
    // variacao-auto-v1: lote AUTO PLANNING sem processo vivo → ANALYSIS_FAILED INTERRUPTED; ANALYZING segue o campeão
    await this.iteracao.recover(opts.workspaceId);

    // 2. renders
    const renders = await this.prisma.render.updateMany({ where: { ...ws, status: 'RENDERING' }, data: { status: 'QUEUED', stage: null } });

    // 3. tasks terminadas e não tratadas
    const tasks = await this.prisma.providerTask.findMany({ where: { ...ws, status: { not: 'SUBMITTED' }, handledAt: null }, orderBy: { completedAt: 'asc' } });
    for (const t of tasks) await this.orquestrador.handle(t.id);

    // 4. pendentes sem task viva
    let scenes = 0;
    // 4a. §13.5: take pendente sem task viva → FAILED INTERRUPTED (fatias junto)
    const pendingTakes = await this.prisma.take.findMany({ where: { ...ws, stale: false, status: { in: ['QUEUED', 'GENERATING'] }, creative: { archivedAt: null } } });
    for (const t of pendingTakes) {
      const alive = await this.prisma.providerTask.count({ where: { takeId: t.id, status: 'SUBMITTED', ...(t.startedAt && { submittedAt: { gte: t.startedAt } }) } });
      if (alive) continue;
      await this.takes.fail(t.id, 'INTERRUPTED');
      await this.geracao.settle(t.creativeId);
      scenes++;
    }
    const pendingScenes = await this.prisma.scene.findMany({ where: { ...ws, stale: false, status: { in: ['QUEUED', 'GENERATING'] }, creative: { archivedAt: null } } });
    for (const s of pendingScenes) {
      if (s.pipeline === 'TAKE_SLICE') continue; // acompanha o take (4a)
      if (s.pipeline === 'REUSE') {
        // seguidora: sem task própria; acompanha a dona (READY copia, FAILED falha, pendente espera)
        await this.geracao.syncReuse(s.id);
        await this.geracao.settle(s.creativeId);
        continue;
      }
      const alive = await this.prisma.providerTask.count({ where: { sceneId: s.id, status: 'SUBMITTED', ...(s.startedAt && { submittedAt: { gte: s.startedAt } }) } });
      if (alive) continue;
      await this.geracao.failScene(s.id, 'INTERRUPTED');
      await this.geracao.settle(s.creativeId);
      scenes++;
    }
    let faces = 0;
    const pendingFaces = await this.prisma.face.findMany({
      where: { ...ws, status: { in: ['QUEUED', 'GENERATING'] }, OR: [{ creative: { archivedAt: null } }, { castingId: { not: null } }] },
    });
    for (const f of pendingFaces) {
      if (await this.prisma.providerTask.count({ where: { faceId: f.id, status: 'SUBMITTED' } })) continue;
      await this.rostos.failFace(f.id, 'INTERRUPTED');
      if (f.creativeId) await this.rostos.settleBatch(f.creativeId, f.batch);
      faces++;
    }

    if (!opts.workspaceId) this.edicao.kick();
    const r = { jobs: jobs.length, renders: renders.count, tasks: tasks.length, scenes, faces };
    if (Object.values(r).some(Boolean)) this.log.log(`retomada: ${JSON.stringify(r)}`);
    return r;
  }
}
