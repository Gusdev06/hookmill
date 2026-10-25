// campanhas-v1 §4 (leitura): GET /meta/campaigns (hierarquia, filtros, busca, ordem, período, totais), GET
// /meta/campaigns/:id (conjuntos + anúncios de todos os formatos) e GET /meta/changes (History). Só snapshot: nunca chama a Graph.
import { Injectable } from '@nestjs/common';
import type {
  MetaAdsetRow, MetaCampaignDetail, MetaCampaignRow, MetaCampaignsMeta, MetaChangeRow, MetaLevel, MetaObjectRef, MetaPeriod, MetaSort, MetaStatusFilter,
} from '@maquina/contratos';
import type { MetaAdSnapshot, MetaAdsetSnapshot, MetaCampaignSnapshot, MetaChange, MetaConnection, MetaObjectLevel } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { initials } from '../common/util/format';
import { PrismaService } from '../prisma/prisma.service';
import {
  type MetaCampaignAdRow, type RowCtx, countsOf, matchesStatus, periodMetrics, presentAdset, presentCampaign, sortRows, statusCounts,
} from './campanhas.views';
import { assertSelected } from './comum';
import { MetaSyncService, aggregate, decodeOffset, encodeOffset, presentAd } from './sync.service';

export const LEVEL_DB: Record<MetaLevel, MetaObjectLevel> = { campaign: 'CAMPAIGN', adset: 'ADSET', ad: 'AD' };
const LEVEL_API: Record<MetaObjectLevel, MetaLevel> = { CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad' };

/** Tudo da conta escolhida, de uma vez (≤ 500 por nível): 5 queries, qualquer que seja o tamanho da tela. */
export interface AccountView {
  conn: MetaConnection;
  ctx: RowCtx;
  campaigns: MetaCampaignSnapshot[];
  adsets: MetaAdsetSnapshot[];
  ads: MetaAdSnapshot[];
  pubCampaigns: Set<string>;
  pubAdsets: Set<string>;
  pubBy: Map<string, { id: string; name: string; adName: string | null }>;
  champBy: Map<string, string>;
}

type ChangeWithUser = MetaChange & { user: { id: string; name: string } };

/** §10: nomes dos pais ativados junto, lidos do snapshot ATUAL (sem coluna nova); id fora do snapshot = campanha com nome = id. */
export type ParentNames = Map<string, MetaObjectRef>;

export async function parentNamesOf(prisma: PrismaService, workspaceId: string, changes: Pick<MetaChange, 'alsoChanged'>[]): Promise<ParentNames> {
  const ids = [...new Set(changes.flatMap((c) => c.alsoChanged))];
  const out: ParentNames = new Map();
  if (!ids.length) return out;
  const [cmps, sets] = await Promise.all([
    prisma.metaCampaignSnapshot.findMany({ where: { workspaceId, campaignId: { in: ids } }, select: { campaignId: true, name: true } }),
    prisma.metaAdsetSnapshot.findMany({ where: { workspaceId, adsetId: { in: ids } }, select: { adsetId: true, name: true } }),
  ]);
  for (const k of cmps) out.set(k.campaignId, { level: 'campaign', id: k.campaignId, name: k.name });
  for (const a of sets) out.set(a.adsetId, { level: 'adset', id: a.adsetId, name: a.name });
  return out;
}

export function presentChange(c: ChangeWithUser, names: ParentNames = new Map()): MetaChangeRow {
  return {
    id: c.id, level: LEVEL_API[c.level], objectId: c.objectId, objectName: c.objectName, field: c.field,
    from: c.fromValue, to: c.toValue, alsoChanged: c.alsoChanged,
    alsoChangedRefs: c.alsoChanged.map((id) => names.get(id) ?? { level: 'campaign' as const, id, name: id }),
    result: c.result, errorCode: c.errorCode, source: c.source,
    by: { id: c.user.id, name: c.user.name, initials: initials(c.user.name) }, at: c.createdAt.toISOString(),
  };
}

@Injectable()
export class MetaCampanhasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: MetaSyncService,
  ) {}

  /** Conexão com conta escolhida (422 META_NOT_CONNECTED / META_SELECTION_MISSING); TOKEN_INVALID ainda lê o snapshot. */
  async connection(workspaceId: string): Promise<MetaConnection> {
    const c = await this.prisma.metaConnection.findUnique({ where: { workspaceId } });
    if (!c || c.status === 'DISCONNECTED') throw new AppException('META_NOT_CONNECTED');
    return assertSelected(c);
  }

  async load(auth: AuthContext, conn?: MetaConnection): Promise<AccountView> {
    const c = conn ?? (await this.connection(auth.workspaceId));
    const where = { connectionId: c.id };
    const [campaigns, adsets, ads, pubs, champs] = await Promise.all([
      this.prisma.metaCampaignSnapshot.findMany({ where }),
      this.prisma.metaAdsetSnapshot.findMany({ where }),
      this.prisma.metaAdSnapshot.findMany({ where }),
      this.prisma.metaPublication.findMany({
        where: { workspaceId: c.workspaceId, adAccountId: c.adAccountId!, OR: [{ campaignId: { not: null } }, { metaAdId: { not: null } }] },
        select: { campaignId: true, adsetId: true, metaAdId: true, creative: { select: { id: true, name: true, adName: true } } }, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.champion.findMany({ where: { workspaceId: c.workspaceId, metaAdId: { not: null }, archivedAt: null }, select: { id: true, metaAdId: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const pubBy = new Map<string, { id: string; name: string; adName: string | null }>();
    for (const p of pubs) if (p.metaAdId && !pubBy.has(p.metaAdId)) pubBy.set(p.metaAdId, p.creative);
    const champBy = new Map<string, string>();
    for (const ch of champs) if (ch.metaAdId && !champBy.has(ch.metaAdId)) champBy.set(ch.metaAdId, ch.id);
    return {
      conn: c, ctx: this.sync.rowCtx(auth, c), campaigns, adsets, ads,
      pubCampaigns: new Set(pubs.map((p) => p.campaignId).filter((x): x is string => !!x)),
      pubAdsets: new Set(pubs.map((p) => p.adsetId).filter((x): x is string => !!x)),
      pubBy, champBy,
    };
  }

  // ───────── linhas ─────────

  campaignRow(v: AccountView, k: MetaCampaignSnapshot, counts = countsOf(v.ads), matchedIn?: ('adset' | 'ad')[]): MetaCampaignRow {
    const mine = v.adsets.filter((a) => a.campaignId === k.campaignId);
    return presentCampaign(k, {
      ...v.ctx, fromHookMill: v.pubCampaigns.has(k.campaignId), counts: counts.campaign(k.campaignId, mine.length),
      anyAdsetLearning: mine.some((a) => a.learningStage === 'LEARNING'), matchedIn,
    });
  }

  adsetRow(v: AccountView, a: MetaAdsetSnapshot, counts = countsOf(v.ads)): MetaAdsetRow {
    const parent = v.campaigns.find((k) => k.campaignId === a.campaignId) ?? null;
    return presentAdset(a, parent, { ...v.ctx, fromHookMill: v.pubAdsets.has(a.adsetId), counts: counts.adset(a.adsetId) });
  }

  adRow(v: AccountView, r: MetaAdSnapshot, now = Date.now()): MetaCampaignAdRow {
    return presentAd(r, v.pubBy.get(r.metaAdId) ?? null, v.champBy.get(r.metaAdId) ?? null, now, v.ctx);
  }

  /** Objeto de um nível já apresentado (resposta das escritas). 404 se saiu do snapshot. */
  async presentObject(auth: AuthContext, level: MetaLevel, id: string): Promise<MetaCampaignRow | MetaAdsetRow | MetaCampaignAdRow> {
    const v = await this.load(auth);
    if (level === 'campaign') {
      const k = v.campaigns.find((x) => x.campaignId === id);
      if (k) return this.campaignRow(v, k);
    } else if (level === 'adset') {
      const a = v.adsets.find((x) => x.adsetId === id);
      if (a) return this.adsetRow(v, a);
    } else {
      const r = v.ads.find((x) => x.metaAdId === id);
      if (r) return this.adRow(v, r);
    }
    throw new AppException('NOT_FOUND');
  }

  // ───────── GET /meta/campaigns ─────────

  async list(auth: AuthContext, q: { period?: MetaPeriod; status?: MetaStatusFilter; origin?: 'all' | 'hookmill'; q?: string; sort?: MetaSort; dir?: 'asc' | 'desc'; limit?: number; cursor?: string }): Promise<{ items: MetaCampaignRow[]; meta: MetaCampaignsMeta }> {
    const v = await this.load(auth);
    const period = q.period ?? '30d';
    const counts = countsOf(v.ads);
    const needle = q.q?.trim().toLowerCase() || null;
    const adsetsOf = groupBy(v.adsets, (a) => a.campaignId);
    const adsOf = groupBy(v.ads, (a) => a.campaignId);
    const childrenOf = (k: MetaCampaignSnapshot) => [...(adsetsOf.get(k.campaignId) ?? []), ...(adsOf.get(k.campaignId) ?? [])];
    // §1: status/q batem na campanha OU em algum filho (o pai aparece quando um filho bate)
    const statusOk = (k: MetaCampaignSnapshot, f: MetaStatusFilter) => matchesStatus(k.effectiveStatus, f) || childrenOf(k).some((x) => matchesStatus(x.effectiveStatus, f));
    const others = v.campaigns.filter((k) => {
      if (q.origin === 'hookmill' && !v.pubCampaigns.has(k.campaignId)) return false;
      if (needle && !k.name.toLowerCase().includes(needle) && !childrenOf(k).some((x) => x.name.toLowerCase().includes(needle))) return false;
      return true;
    });
    // §10: contagem por status com os OUTROS filtros (origin, q), ignorando o de status
    const statusCountsMeta = statusCounts(others, statusOk);
    let rows = others.filter((k) => !q.status || q.status === 'all' || statusOk(k, q.status)).map((k) => {
      // §10 matchedIn: só com q; níveis abaixo em que algum nome bateu ([] = só o nome da campanha)
      const matchedIn = needle
        ? ([['adset', adsetsOf.get(k.campaignId) ?? []], ['ad', adsOf.get(k.campaignId) ?? []]] as const)
          .filter(([, xs]) => xs.some((x) => x.name.toLowerCase().includes(needle))).map(([lvl]) => lvl)
        : undefined;
      return this.campaignRow(v, k, counts, matchedIn as ('adset' | 'ad')[] | undefined);
    });
    rows = sortRows(rows, (r) => ({ m: period === '7d' ? r.metrics7d : r.metrics, budget: r.budget.amountMinor, name: r.name }), q.sort ?? 'spend', q.dir);
    const totals = aggregate(rows.map((r) => (period === '7d' ? r.metrics7d : r.metrics)));
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = decodeOffset(q.cursor);
    const items = rows.slice(offset, offset + limit);
    const nextCursor = offset + limit < rows.length ? encodeOffset(offset + limit) : null;
    return {
      items,
      meta: {
        nextCursor, period, currency: v.conn.currency, counts: statusCountsMeta,
        totals: { count: rows.length, spend: totals.spend, results: totals.results, resultType: totals.resultType, cpa: totals.cpa, ctr: totals.ctr, hookRate: totals.hookRate },
        truncated: await this.truncated(v.conn),
        sync: await this.sync.syncState(v.conn, v.ads.length > 0),
      },
    };
  }

  /** Último sync que terminou disse que passou de 500 em algum nível. */
  private async truncated(c: MetaConnection): Promise<boolean> {
    if (!c.lastSyncAt) return false;
    const j = await this.prisma.job.findFirst({ where: { workspaceId: c.workspaceId, type: 'META_SYNC', status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, select: { output: true } });
    const out = j?.output as { truncated?: unknown } | null | undefined;
    return out?.truncated === true;
  }

  // ───────── GET /meta/campaigns/:id ─────────

  async detail(auth: AuthContext, campaignId: string, period: MetaPeriod = '30d'): Promise<MetaCampaignDetail> {
    const v = await this.load(auth);
    const k = v.campaigns.find((x) => x.campaignId === campaignId);
    if (!k) throw new AppException('NOT_FOUND');
    const counts = countsOf(v.ads);
    const now = Date.now();
    const bySpend = <T extends { metrics: unknown; metrics7d: unknown; name: string }>(xs: T[]) =>
      sortRows(xs, (x) => ({ m: periodMetrics(x, period), budget: null, name: x.name }), 'spend');
    const adsets = bySpend(v.adsets.filter((a) => a.campaignId === campaignId)).map((a) => ({
      ...this.adsetRow(v, a, counts),
      ads: bySpend(v.ads.filter((r) => r.adsetId === a.adsetId)).map((r) => this.adRow(v, r, now)),
    }));
    return { campaign: this.campaignRow(v, k, counts), adsets };
  }

  // ───────── GET /meta/changes ─────────

  async changes(auth: AuthContext, q: { level?: MetaLevel; objectId?: string; limit?: number; cursor?: string }): Promise<{ items: MetaChangeRow[]; nextCursor: string | null }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.metaChange.findMany({
      where: {
        AND: [{ workspaceId: auth.workspaceId }, q.level ? { level: LEVEL_DB[q.level] } : {}, q.objectId ? { objectId: q.objectId } : {}, afterCursor('createdAt', decodeCursor(q.cursor))],
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    const pg = page(rows, limit, (r) => r.createdAt);
    const names = await parentNamesOf(this.prisma, auth.workspaceId, pg.items);
    return { items: pg.items.map((c) => presentChange(c, names)), nextCursor: pg.nextCursor };
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}
