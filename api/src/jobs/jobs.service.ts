import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, JobStatus, JobType, Prisma } from '@prisma/client';
import { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor } from '../common/errors/falhas';
import { EventosService } from '../eventos/eventos.service';
import { isIntegracaoError } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { JobView, presentJob } from './job.presenter';

/**
 * Jobs do Claude dentro da API. Toda mudança emite 'job.progress' (evento interno, eventos.md §5)
 * e, se o job é de um criativo, 'job.updated' no SSE dele.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');
  /** Execuções em segundo plano ainda vivas (os testes esperam esvaziar; nada mais lê isto). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventEmitter2,
    private readonly eventos: EventosService,
  ) {}

  async get(auth: AuthContext, id: string): Promise<JobView> {
    const job = await this.prisma.job.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!job) throw new AppException('NOT_FOUND');
    return presentJob(job);
  }

  async create(input: {
    workspaceId: string; type: JobType; input: Prisma.InputJsonValue; createdById: string;
    offerId?: string; creativeId?: string;
  }): Promise<JobView> {
    const job = await this.prisma.job.create({ data: { ...input, status: 'QUEUED' } });
    return this.announce(job);
  }

  async stage(id: string, stage: string, progress?: number, etaSec?: number | null): Promise<JobView> {
    const current = await this.prisma.job.findUniqueOrThrow({ where: { id }, select: { startedAt: true } });
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        status: 'RUNNING',
        stage,
        startedAt: current.startedAt ?? new Date(),
        ...(progress !== undefined && { progress }),
        ...(etaSec !== undefined && { etaSec }),
      },
    });
    return this.announce(job);
  }

  async finish(id: string, result: {
    status: Extract<JobStatus, 'SUCCEEDED' | 'PARTIAL' | 'FAILED'>;
    output?: Prisma.InputJsonValue; errorCode?: string | null; failReason?: string | null;
  }): Promise<JobView> {
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        status: result.status,
        ...(result.status !== 'FAILED' && { progress: 100 }),
        etaSec: 0,
        output: result.output,
        errorCode: result.errorCode ?? null,
        failReason: result.failReason ?? null,
        finishedAt: new Date(),
      },
    });
    return this.announce(job);
  }

  /**
   * Executor ÚNICO de trabalho em segundo plano (fire-and-forget depois de responder o HTTP).
   * Nenhuma falha sai daqui: um erro não tratado num job (ex.: P2003 porque o lote foi apagado no meio) derrubava
   * o processo Node inteiro. Aqui ele vira log + job FAILED (se ainda aberto). A falha de domínio (item, lote,
   * campeão) continua com quem roda o job; isto é a última rede.
   */
  detach(jobId: string | null, label: string, fn: () => Promise<unknown>): Promise<void> {
    const run = (async () => {
      try {
        await fn();
      } catch (e) {
        this.log.error(`${label}${jobId ? ` (job ${jobId})` : ''} falhou em segundo plano: ${(e as Error)?.stack ?? e}`);
        if (jobId) await this.failIfOpen(jobId, e).catch((e2) => this.log.error(`job ${jobId}: não deu pra marcar FAILED: ${(e2 as Error)?.message ?? e2}`));
      }
    })();
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
    return run;
  }

  /** Espera os trabalhos em segundo plano em voo (testes). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  /** QUEUED/RUNNING → FAILED com o código da integração (ou PROVIDER_ERROR). Job já fechado ou apagado: nada. */
  private async failIfOpen(jobId: string, e: unknown) {
    const code = asAsyncErrorCode(isIntegracaoError(e) ? e.code : null);
    const r = await this.prisma.job.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', etaSec: 0, errorCode: code, failReason: failReasonFor(code), finishedAt: new Date() },
    });
    if (r.count) await this.announceById(jobId);
  }

  /** Anuncia um job criado dentro de outra transação (job.updated no SSE do criativo). */
  async announceById(id: string): Promise<JobView> {
    return this.announce(await this.prisma.job.findUniqueOrThrow({ where: { id } }));
  }

  private announce(job: Job): JobView {
    const view = presentJob(job);
    this.bus.emit('job.progress', view);
    if (job.creativeId) this.eventos.publish(job.creativeId, 'job.updated', view);
    return view;
  }
}
