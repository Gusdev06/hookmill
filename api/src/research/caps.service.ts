// ads-research-v1 §9 + C.5: tetos da pesquisa e o ledger.
//  - Teto do workspace (mês UTC): soma de cost_entries.amount_usd com researchSyncId OU discoveryId. Não entra no
//    monthlySpendCapUsd (a pesquisa não trava o Gerar). Estourou = 409 SPEND_CAP_EXCEEDED { scope: 'research' }.
//  - Teto global diário (UTC): research_syncs.cost_usd do dia + parte Claude das descobertas (cost_entries ANTHROPIC com
//    discoveryId). Passou: descoberta/importação vão pra fila do dia seguinte; "atualizar agora" = 503 quota.
//  - Amostras: no máximo N descobertas por dia em workspaces sem OWNER PAID/INTERNAL.
//  - Custo real do provedor mora no sync/descoberta; o CostEntry é a parte atribuída (rateio da semanal).
import { Injectable } from '@nestjs/common';
import type { AccountAccess } from '@maquina/contratos';
import { Prisma } from '@prisma/client';
import { AmostraService } from '../amostra/amostra.service';
import { testMode } from '../amostra/acesso';
import { AppException } from '../common/errors/app-exception';
import { spendCapExceeded } from '../common/errors/teto';
import { num } from '../common/util/format';
import { monthRange } from '../custos/custos.service';
import { PrismaService } from '../prisma/prisma.service';
import { DAY_MS } from './regras';
import { ResearchConfig } from './research.config';

type Db = Prisma.TransactionClient | PrismaService;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function dayRange(at = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** 00:05 UTC do dia seguinte (fila do teto global). */
export const nextDayUtc = (at = new Date()) => new Date(dayRange(at).to.getTime() + 5 * 60_000);
/** 00:05 UTC do dia 1 do mês seguinte (fila do teto mensal do workspace). */
export const nextMonthUtc = (at = new Date()) => new Date(monthRange(at).to.getTime() + 5 * 60_000);

export const RESEARCH_LEDGER: Prisma.CostEntryWhereInput = { OR: [{ researchSyncId: { not: null } }, { discoveryId: { not: null } }] };

@Injectable()
export class ResearchCapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly amostra: AmostraService,
  ) {}

  access(workspaceId: string, db: Db = this.prisma): Promise<AccountAccess> {
    return this.amostra.workspaceAccess(workspaceId, db);
  }

  async monthSpent(workspaceId: string, at = new Date(), db: Db = this.prisma): Promise<number> {
    const { from, to } = monthRange(at);
    const r = await db.costEntry.aggregate({ where: { workspaceId, createdAt: { gte: from, lt: to }, ...RESEARCH_LEDGER }, _sum: { amountUsd: true } });
    return round4(num(r._sum.amountUsd) ?? 0);
  }

  async spend(workspaceId: string, access?: AccountAccess): Promise<{ monthUsd: number; capUsd: number }> {
    const a = access ?? (await this.access(workspaceId));
    return { monthUsd: await this.monthSpent(workspaceId), capUsd: this.cfg.monthlyCapUsd(a) };
  }

  /** Cabe no teto mensal da pesquisa? */
  async fits(workspaceId: string, estimateUsd: number, access?: AccountAccess): Promise<boolean> {
    const { monthUsd, capUsd } = await this.spend(workspaceId, access);
    return monthUsd + estimateUsd <= capUsd + 1e-9;
  }

  /** gasto do mês + estimativa ≤ teto, senão 409 SPEND_CAP_EXCEEDED { scope: 'research', spentUsd, capUsd, estimateUsd }. */
  async assertWorkspace(workspaceId: string, estimateUsd: number, access?: AccountAccess): Promise<void> {
    const { monthUsd, capUsd } = await this.spend(workspaceId, access);
    if (monthUsd + estimateUsd > capUsd + 1e-9) throw spendCapExceeded({ scope: 'research', spentUsd: monthUsd, capUsd, estimateUsd });
  }

  async globalSpentToday(at = new Date()): Promise<number> {
    const { from, to } = dayRange(at);
    const [syncs, llm] = await Promise.all([
      this.prisma.researchSync.aggregate({ where: { createdAt: { gte: from, lt: to } }, _sum: { costUsd: true } }),
      this.prisma.costEntry.aggregate({ where: { createdAt: { gte: from, lt: to }, discoveryId: { not: null }, provider: 'ANTHROPIC' }, _sum: { amountUsd: true } }),
    ]);
    return round4((num(syncs._sum.costUsd) ?? 0) + (num(llm._sum.amountUsd) ?? 0));
  }

  /** Teto global diário ainda tem espaço pra `estimateUsd`? */
  async globalFits(estimateUsd: number): Promise<boolean> {
    return (await this.globalSpentToday()) + estimateUsd <= this.cfg.dailyGlobalUsd + 1e-9;
  }

  /** "Atualizar agora"/mídia sem espaço no global = 503 AD_LIBRARY_UNAVAILABLE quota (§9). */
  async assertGlobal(estimateUsd: number): Promise<void> {
    if (!(await this.globalFits(estimateUsd))) {
      throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'quota', retryAfter: nextDayUtc().toISOString() });
    }
  }

  /** Descobertas de amostra hoje (workspaces sem OWNER PAID/INTERNAL; no modo teste ninguém é amostra). */
  async sampleDiscoveriesToday(): Promise<number> {
    if (testMode()) return 0;
    const { from, to } = dayRange();
    return this.prisma.competitorDiscovery.count({
      where: {
        createdAt: { gte: from, lt: to }, status: { not: 'QUEUED' },
        workspace: { memberships: { none: { role: 'OWNER', user: { access: { in: ['PAID', 'INTERNAL'] } } } } },
      },
    });
  }

  async sampleDayFull(): Promise<boolean> {
    return (await this.sampleDiscoveriesToday()) >= this.cfg.sampleDiscoveriesPerDay;
  }

  // ───────── ledger ─────────

  /** Coleta pedida por um workspace (INITIAL/MANUAL/MEDIA) ou da descoberta: custo inteiro nele. */
  async chargeSync(db: Db, s: { syncId: string; workspaceId: string; discoveryId?: string | null; amountUsd: number; model: string; units: number }): Promise<void> {
    await db.costEntry.create({
      data: {
        workspaceId: s.workspaceId, provider: 'APIFY', kind: 'SCRAPE', model: s.model, units: s.units, unit: 'call',
        amountUsd: round4(s.amountUsd), researchSyncId: s.syncId, discoveryId: s.discoveryId ?? null,
      },
    });
  }

  /** Claude da descoberta: 2 entradas (ktoken_in / ktoken_out), provider ANTHROPIC, kind LLM, com discoveryId. */
  async chargeLlm(db: Db, s: { workspaceId: string; discoveryId: string; model: string; inputKtok: number; outputKtok: number; inputUsd: number; outputUsd: number }): Promise<void> {
    await db.costEntry.createMany({
      data: [
        { workspaceId: s.workspaceId, provider: 'ANTHROPIC', kind: 'LLM', model: s.model, units: s.inputKtok, unit: 'ktoken_in', amountUsd: round4(s.inputUsd), discoveryId: s.discoveryId },
        { workspaceId: s.workspaceId, provider: 'ANTHROPIC', kind: 'LLM', model: s.model, units: s.outputKtok, unit: 'ktoken_out', amountUsd: round4(s.outputUsd), discoveryId: s.discoveryId },
      ],
    });
  }

  /**
   * SCHEDULED (§4): rateio entre os seguidores ativos da fonte que ainda têm folga no teto. Quem está no teto não recebe;
   * ninguém com folga = só o custo real no sync (teto global), sem CostEntry.
   */
  async chargeShared(s: { syncId: string; sourceId: string; amountUsd: number; model: string }): Promise<string[]> {
    if (s.amountUsd <= 0) return [];
    const followers = await this.prisma.competitor.findMany({ where: { sourceId: s.sourceId, status: 'ACTIVE' }, select: { workspaceId: true }, distinct: ['workspaceId'] });
    const open: string[] = [];
    for (const f of followers) {
      const a = await this.access(f.workspaceId);
      const { monthUsd, capUsd } = await this.spend(f.workspaceId, a);
      if (monthUsd < capUsd) open.push(f.workspaceId);
    }
    if (!open.length) return [];
    const share = s.amountUsd / open.length;
    for (const workspaceId of open) await this.chargeSync(this.prisma, { syncId: s.syncId, workspaceId, amountUsd: share, model: s.model, units: 1 });
    return open;
  }
}
