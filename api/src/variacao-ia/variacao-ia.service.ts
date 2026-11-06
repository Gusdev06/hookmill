import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SemanticPlan, SemanticPlanJob, SemanticPlanRequest, SemanticPlannerConfig } from '@maquina/contratos';
import type { Job, Prisma } from '@prisma/client';
import { AmostraService } from '../amostra/amostra.service';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { CustosService } from '../custos/custos.service';
import { SEMANTIC_PLANNER, type SemanticPlannerPort } from '../integracoes/claude/semantic-planner';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { FORMATS, PURPOSE } from './catalogo';
import { semanticContext, type SemanticContext } from './contexto';

type StoredInput = { purpose: typeof PURPOSE; request: SemanticPlanRequest; context: SemanticContext };
const json = (v: unknown) => v as Prisma.InputJsonValue;
const PURPOSE_FILTER = { type: 'VARIATIONS_PLAN', input: { path: ['purpose'], equals: PURPOSE } } satisfies Prisma.JobWhereInput;
// JSONB não preserva a ordem das chaves de objetos.
const requestKey = (r: SemanticPlanRequest) => JSON.stringify([r.championId, r.requestId, r.focus, r.instructions, r.formatIds]);

function present(job: Job): SemanticPlanJob {
  const input = job.input as unknown as StoredInput;
  return { id: job.id, status: job.status, championId: job.championId!, offerId: job.offerId!, request: input.request, plan: job.status === 'SUCCEEDED' ? job.output as unknown as SemanticPlan : null, errorCode: job.errorCode, createdAt: job.createdAt.toISOString() };
}

@Injectable()
export class VariacaoIaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly costs: CustosService,
    private readonly access: AmostraService,
    private readonly cfg: ConfigService,
    @Inject(SEMANTIC_PLANNER) private readonly planner: SemanticPlannerPort,
  ) {}

  async config(auth: AuthContext): Promise<SemanticPlannerConfig> {
    const flag = this.cfg.get<string>('AI_VARIATIONS_ENABLED');
    const enabled = flag ? flag === 'on' : this.cfg.get<string>('NODE_ENV') !== 'production';
    const allowed = (await this.access.workspaceAccess(auth.workspaceId)) === 'INTERNAL';
    const reason = !enabled ? 'disabled' : !allowed ? 'access_required' : !this.planner.configured ? 'not_configured' : null;
    return { enabled, available: !reason, reason, mode: this.planner.mode, formats: FORMATS, variationsPerPlan: 3, producesMedia: false };
  }

  async list(auth: AuthContext, championId?: string): Promise<SemanticPlanJob[]> {
    const rows = await this.prisma.job.findMany({ where: { ...PURPOSE_FILTER, workspaceId: auth.workspaceId, ...(championId && { championId }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    return rows.map(present);
  }
  async get(auth: AuthContext, id: string): Promise<SemanticPlanJob> {
    const job = await this.prisma.job.findFirst({ where: { ...PURPOSE_FILTER, id, workspaceId: auth.workspaceId } });
    if (!job) throw new AppException('NOT_FOUND');
    return present(job);
  }

  async create(auth: AuthContext, request: SemanticPlanRequest): Promise<SemanticPlanJob> {
    const config = await this.config(auth);
    if (!config.available) throw new AppException(config.reason === 'access_required' ? 'FORBIDDEN' : 'PROVIDER_UNAVAILABLE', { reason: config.reason });
    // Sem migração: lock do workspace evita dois cliques/jobs pagos em instâncias diferentes.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`semantic:${auth.workspaceId}`}, 0))::text`;
      const existing = await tx.job.findFirst({ where: { workspaceId: auth.workspaceId, type: 'VARIATIONS_PLAN', AND: [{ input: { path: ['purpose'], equals: PURPOSE } }, { input: { path: ['request', 'requestId'], equals: request.requestId } }] } });
      if (existing) {
        const old = (existing.input as unknown as StoredInput).request;
        if (requestKey(old) !== requestKey(request)) throw new AppException('INVALID_STATE', { reason: 'idempotency_conflict' });
        return { job: existing, fresh: false };
      }
      const active = await tx.job.findFirst({ where: { ...PURPOSE_FILTER, workspaceId: auth.workspaceId, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (active) throw new AppException('INVALID_STATE', { reason: 'semantic_plan_running', planId: active.id });
      const champion = await tx.champion.findFirst({ where: { id: request.championId, workspaceId: auth.workspaceId, archivedAt: null, offer: { workspaceId: auth.workspaceId, archivedAt: null } }, include: { offer: true, teardown: true } });
      if (!champion) throw new AppException('NOT_FOUND');
      if (champion.status !== 'READY' || !champion.teardown) throw new AppException('INVALID_STATE', { reason: 'champion_not_ready' });
      const missing = ['what', 'cta'].filter((k) => !champion.offer[k as 'what' | 'cta']?.trim());
      if (missing.length) throw new AppException('OFFER_INCOMPLETE', { fields: missing });
      const context = semanticContext(champion, request);
      await this.costs.assertWithinCap(auth.workspaceId, this.planner.estimate(context));
      const job = await tx.job.create({ data: { workspaceId: auth.workspaceId, createdById: auth.userId, offerId: champion.offerId, championId: champion.id, type: 'VARIATIONS_PLAN', status: 'QUEUED', input: json({ purpose: PURPOSE, request, context }) } });
      return { job, fresh: true };
    }, { timeout: 15000 });
    if (result.fresh) void this.jobs.detach(result.job.id, 'planejamento semântico', () => this.run(result.job));
    return present(result.job);
  }

  private async run(job: Job) {
    const { context } = job.input as unknown as StoredInput;
    await this.jobs.stage(job.id, 'reading_teardown', 15);
    await this.jobs.stage(job.id, 'writing', 40);
    const plan = await this.planner.plan(context, { workspaceId: job.workspaceId, championId: job.championId!, jobId: job.id });
    await this.jobs.finish(job.id, { status: 'SUCCEEDED', output: json(plan) });
  }
}
