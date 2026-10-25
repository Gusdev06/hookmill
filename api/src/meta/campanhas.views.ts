// campanhas-v1 §1/§3/§5.4: funções puras da tela Campaigns (filtros de status, orçamento por nível, link do Ads Manager,
// ordenação, linhas de campanha/conjunto/anúncio). Nada aqui fala com o banco nem com a Meta.
import type {
  MetaAdsetRow, MetaBudget, MetaCampaignAdRow, MetaCampaignRow, MetaLevel, MetaMetrics, MetaPeriod, MetaSort, MetaStatusCounts, MetaStatusFilter,
} from '@maquina/contratos';
import type { MetaAdSnapshot, MetaAdsetSnapshot, MetaCampaignSnapshot, MetaConnection } from '@prisma/client';
import type { MemberRole } from '@prisma/client';
import { accountUnusable } from '../integracoes';
import { metricsOf } from './comum';

// ───────── status ─────────

const PAUSED_EFFECTIVE = ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];
const ISSUE_EFFECTIVE = ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_REVIEW', 'IN_PROCESS'];
/** Ativar recusado (422 META_POLICY) e toggle desligado na tela. */
export const POLICY_BLOCKED = ['DISAPPROVED', 'WITH_ISSUES'];
const NO_TOGGLE = ['DISAPPROVED', 'DELETED', 'ARCHIVED'];

/** §10: { all, active, paused, issues } contando com os outros filtros (o de status ignorado). */
export function statusCounts<T>(rows: T[], matches: (r: T, f: MetaStatusFilter) => boolean): MetaStatusCounts {
  return { all: rows.length, active: rows.filter((r) => matches(r, 'active')).length, paused: rows.filter((r) => matches(r, 'paused')).length, issues: rows.filter((r) => matches(r, 'issues')).length };
}

/** §1 filtros: active = ACTIVE · paused = PAUSED/CAMPAIGN_PAUSED/ADSET_PAUSED · issues = DISAPPROVED/WITH_ISSUES/PENDING_REVIEW/IN_PROCESS. */
export function matchesStatus(effectiveStatus: string, f: MetaStatusFilter | undefined): boolean {
  if (!f || f === 'all') return true;
  if (f === 'active') return effectiveStatus === 'ACTIVE';
  if (f === 'paused') return PAUSED_EFFECTIVE.includes(effectiveStatus);
  return ISSUE_EFFECTIVE.includes(effectiveStatus);
}

export const toggleOf = (s: string): 'ACTIVE' | 'PAUSED' => (s === 'PAUSED' ? 'PAUSED' : 'ACTIVE');

// ───────── permissões ─────────

/** D5: escreve = OWNER/ADMIN com conexão ACTIVE e conta utilizável. */
export function canWriteOf(role: MemberRole, conn: Pick<MetaConnection, 'status' | 'accountStatus'>): boolean {
  return (role === 'OWNER' || role === 'ADMIN') && conn.status === 'ACTIVE' && !accountUnusable(conn.accountStatus);
}
export const canToggleOf = (canWrite: boolean, effectiveStatus: string) => canWrite && !NO_TOGGLE.includes(effectiveStatus);

// ───────── Ads Manager (§5.4) ─────────

export function adsManagerObjectUrl(adAccountId: string, level: MetaLevel, id: string): string {
  const act = adAccountId.replace(/^act_/, '');
  const path = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  const key = level === 'campaign' ? 'selected_campaign_ids' : level === 'adset' ? 'selected_adset_ids' : 'selected_ad_ids';
  return `https://adsmanager.facebook.com/adsmanager/manage/${path}?act=${act}&${key}=${id}`;
}

// ───────── orçamento ─────────

type BudgetFields = Pick<MetaCampaignSnapshot, 'dailyBudgetMinor' | 'lifetimeBudgetMinor' | 'budgetRemainingMinor'>;
export interface BudgetCtx { currency: string; minimumMinor: number | null; canWrite: boolean }

/** Campanha: CBO diário/vitalício mora nela; ABO = level null (o orçamento está nos conjuntos). */
export function campaignBudget(k: BudgetFields, ctx: BudgetCtx): MetaBudget {
  const kind = k.dailyBudgetMinor != null ? 'daily' : k.lifetimeBudgetMinor != null ? 'lifetime' : null;
  return {
    level: kind ? 'campaign' : null, kind,
    amountMinor: k.dailyBudgetMinor ?? k.lifetimeBudgetMinor ?? null, remainingMinor: k.budgetRemainingMinor ?? null, currency: ctx.currency,
    editable: kind === 'daily' && ctx.canWrite, minimumMinor: ctx.minimumMinor,
  };
}

/** Conjunto: ABO mora nele; em CBO aponta pra campanha (editable false: "budget set on the campaign"). */
export function adsetBudget(a: BudgetFields, parent: BudgetFields | null, ctx: BudgetCtx): MetaBudget {
  const own = a.dailyBudgetMinor != null ? 'daily' : a.lifetimeBudgetMinor != null ? 'lifetime' : null;
  if (own) {
    return {
      level: 'adset', kind: own, amountMinor: a.dailyBudgetMinor ?? a.lifetimeBudgetMinor ?? null, remainingMinor: a.budgetRemainingMinor ?? null,
      currency: ctx.currency, editable: own === 'daily' && ctx.canWrite, minimumMinor: ctx.minimumMinor,
    };
  }
  const b = parent ? campaignBudget(parent, ctx) : null;
  return { level: b?.level ?? null, kind: b?.kind ?? null, amountMinor: b?.amountMinor ?? null, remainingMinor: b?.remainingMinor ?? null, currency: ctx.currency, editable: false, minimumMinor: ctx.minimumMinor };
}

/** Onde mora o orçamento DIÁRIO editável de um objeto; null + motivo = 422 META_BUDGET_NOT_EDITABLE { budgetLevel, kind }. */
export function editableBudget(
  level: 'campaign' | 'adset',
  own: { dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null },
  campaign: { dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null } | null,
): { ok: true; currentMinor: number } | { ok: false; budgetLevel: 'campaign' | 'adset' | null; kind: 'daily' | 'lifetime' | null } {
  if (own.dailyBudgetMinor != null) return { ok: true, currentMinor: own.dailyBudgetMinor };
  if (own.lifetimeBudgetMinor != null) return { ok: false, budgetLevel: level, kind: 'lifetime' };
  if (level === 'campaign') return { ok: false, budgetLevel: 'adset', kind: 'daily' }; // ABO: o orçamento está nos conjuntos
  if (campaign?.dailyBudgetMinor != null) return { ok: false, budgetLevel: 'campaign', kind: 'daily' };
  if (campaign?.lifetimeBudgetMinor != null) return { ok: false, budgetLevel: 'campaign', kind: 'lifetime' };
  return { ok: false, budgetLevel: null, kind: null };
}

// ───────── ordenação ─────────

export function periodMetrics(r: { metrics: unknown; metrics7d: unknown }, period: MetaPeriod): MetaMetrics {
  return metricsOf((period === '7d' ? r.metrics7d : r.metrics) as never);
}

/** §1: spend (padrão, desc), cpa, results, ctr, hookRate, budget, name. `null` sempre no fim. */
export function sortRows<T>(rows: T[], key: (r: T) => { m: MetaMetrics; budget: number | null; name: string }, sort: MetaSort = 'spend', dir?: 'asc' | 'desc'): T[] {
  const d = dir ?? (sort === 'name' || sort === 'cpa' ? 'asc' : 'desc');
  const val = (r: T): number | string | null => {
    const k = key(r);
    if (sort === 'name') return k.name.toLowerCase();
    if (sort === 'budget') return k.budget;
    return k.m[sort] ?? null;
  };
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return key(a).name.localeCompare(key(b).name);
    if (av == null) return 1;
    if (bv == null) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return d === 'asc' ? c : -c;
  });
}

// ───────── linhas ─────────

export interface RowCtx {
  adAccountId: string; currency: string; minimumMinor: number | null; canWrite: boolean;
  url: (level: MetaLevel, id: string) => string;
}

export function presentCampaign(
  k: MetaCampaignSnapshot,
  ctx: RowCtx & { fromHookMill: boolean; counts: MetaCampaignRow['counts']; anyAdsetLearning: boolean; matchedIn?: ('adset' | 'ad')[] },
): MetaCampaignRow {
  return {
    id: k.campaignId, name: k.name, status: toggleOf(k.status), effectiveStatus: k.effectiveStatus,
    metrics: metricsOf(k.metrics), metrics7d: metricsOf(k.metrics7d), metricsPrev7d: metricsOf(k.metricsPrev7d),
    fromHookMill: ctx.fromHookMill, adsManagerUrl: ctx.url('campaign', k.campaignId), canToggle: canToggleOf(ctx.canWrite, k.effectiveStatus),
    objective: k.objective, buyingType: k.buyingType, bidStrategy: k.bidStrategy,
    isCbo: k.dailyBudgetMinor != null || k.lifetimeBudgetMinor != null,
    budget: campaignBudget(k, ctx), counts: ctx.counts,
    startTime: k.startTime?.toISOString() ?? null, stopTime: k.stopTime?.toISOString() ?? null,
    anyAdsetLearning: ctx.anyAdsetLearning,
    ...(ctx.matchedIn && { matchedIn: ctx.matchedIn }),
  };
}

export function presentAdset(
  a: MetaAdsetSnapshot, parent: MetaCampaignSnapshot | null,
  ctx: RowCtx & { fromHookMill: boolean; counts: MetaAdsetRow['counts'] },
): MetaAdsetRow {
  const stage = a.learningStage;
  return {
    id: a.adsetId, name: a.name, status: toggleOf(a.status), effectiveStatus: a.effectiveStatus,
    metrics: metricsOf(a.metrics), metrics7d: metricsOf(a.metrics7d), metricsPrev7d: metricsOf(a.metricsPrev7d),
    fromHookMill: ctx.fromHookMill, adsManagerUrl: ctx.url('adset', a.adsetId), canToggle: canToggleOf(ctx.canWrite, a.effectiveStatus),
    campaignId: a.campaignId, optimizationGoal: a.optimizationGoal, billingEvent: a.billingEvent, bidStrategy: a.bidStrategy,
    learningStage: stage === 'LEARNING' || stage === 'SUCCESS' || stage === 'FAIL' ? stage : null,
    budget: adsetBudget(a, parent, ctx), counts: ctx.counts,
    startTime: a.startTime?.toISOString() ?? null, endTime: a.endTime?.toISOString() ?? null,
  };
}

/** Contagens por campanha e por conjunto a partir dos anúncios (todos os formatos). */
export function countsOf(ads: Pick<MetaAdSnapshot, 'campaignId' | 'adsetId' | 'effectiveStatus' | 'verdict' | 'trend'>[]) {
  const byCampaign = new Map<string, MetaCampaignRow['counts'] & { adsetIds: Set<string> }>();
  const byAdset = new Map<string, MetaAdsetRow['counts']>();
  for (const a of ads) {
    const c = byCampaign.get(a.campaignId) ?? { adsets: 0, ads: 0, activeAds: 0, winners: 0, tiring: 0, adsetIds: new Set<string>() };
    const s = byAdset.get(a.adsetId) ?? { ads: 0, activeAds: 0, winners: 0 };
    const active = a.effectiveStatus === 'ACTIVE';
    c.ads++; s.ads++;
    if (active) { c.activeAds++; s.activeAds++; }
    if (a.verdict === 'WINNER') { c.winners++; s.winners++; }
    if (active && a.trend === 'TIRING') c.tiring++;
    c.adsetIds.add(a.adsetId);
    byCampaign.set(a.campaignId, c);
    byAdset.set(a.adsetId, s);
  }
  return {
    campaign: (id: string, adsetCount: number): MetaCampaignRow['counts'] => {
      const c = byCampaign.get(id);
      return { adsets: Math.max(adsetCount, c?.adsetIds.size ?? 0), ads: c?.ads ?? 0, activeAds: c?.activeAds ?? 0, winners: c?.winners ?? 0, tiring: c?.tiring ?? 0 };
    },
    adset: (id: string): MetaAdsetRow['counts'] => byAdset.get(id) ?? { ads: 0, activeAds: 0, winners: 0 },
  };
}

export type { MetaCampaignAdRow };
