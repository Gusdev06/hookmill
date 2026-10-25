// campanhas-v1 §4 (escrita): UM caminho pras 5 rotas da Campaigns (status nos 3 níveis, orçamento diário onde mora) e
// pro registro das ações da tela Send (activate/pause, source PUBLISH). Ordem: conexão + conta utilizável → objeto no
// snapshot → throttle por workspace → cota da Meta → LEITURA AO VIVO → regras (§4.1) → escrita → MetaChange (APPLIED ou
// FAILED, inclusive quando a Meta recusa; BLOCKED quando a trava META_POLICY recusa antes de escrever, §11) + snapshot/publicação atualizados. Nada aqui ativa sem confirmação explícita.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MetaLevel, MetaObjectRef, MetaToggleStatus, MetaWriteResult } from '@maquina/contratos';
import type { MetaChangeField, MetaChangeResult, MetaChangeSource, MetaConnection, Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaService, accountStatusLabel, accountUnusable, isMetaError, type MetaError } from '../integracoes';
import type { MetaLiveObject } from '../integracoes/contrato';
import { PrismaService } from '../prisma/prisma.service';
import { POLICY_BLOCKED, editableBudget, toggleOf } from './campanhas.views';
import { LEVEL_DB, MetaCampanhasService, parentNamesOf, presentChange } from './campanhas.service';
import { assertSelected, assertUsable, markTokenInvalid, metaAuthOf, toHttp } from './comum';
import { storedHealthOf } from './conexao.service';

const WINDOW_MS = 60_000;
/** effective_status que o HookMill recalcula ao mexer no toggle; o resto (DISAPPROVED, WITH_ISSUES…) só o sync muda. */
const DELIVERY = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];

interface Target {
  level: MetaLevel; id: string; name: string; effectiveStatus: string;
  campaignId: string | null; adsetId: string | null;
  status: MetaToggleStatus; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null;
}

@Injectable()
export class MetaEscritaService {
  private readonly log = new Logger('MetaWrite');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly campanhas: MetaCampanhasService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  // ───────── rotas ─────────

  /** POST /meta/{campaigns|adsets|ads}/:id/status (OWNER/ADMIN). */
  async setStatus(auth: AuthContext, level: MetaLevel, id: string, body: { status: MetaToggleStatus; expected: MetaToggleStatus; includeParents?: boolean }): Promise<MetaWriteResult> {
    const { conn, target } = await this.prelude(auth, level, id);
    const live = await this.readLive(auth, conn, target, 'STATUS', body.status);
    if (live.status !== body.expected) await this.changed(conn, target, live);
    let parents: MetaObjectRef[] = [];
    if (body.status === 'ACTIVE') {
      // §4.1: anúncio reprovado não liga (a Meta recusaria; o motivo mora no Ads Manager)
      // §11: a recusa entra no History como BLOCKED (sem escrita na Meta)
      if (level === 'ad' && (POLICY_BLOCKED.includes(live.effectiveStatus) || POLICY_BLOCKED.includes(target.effectiveStatus))) {
        const effectiveStatus = POLICY_BLOCKED.includes(live.effectiveStatus) ? live.effectiveStatus : target.effectiveStatus;
        await this.record(auth, conn, target, 'STATUS', live.status, body.status, [], 'BLOCKED', { code: 'META_POLICY' }, 'CAMPAIGNS');
        throw new AppException('META_POLICY', { effectiveStatus });
      }
      // D6: ativar não sobe pai pausado sem pedir
      if (live.campaign && level !== 'campaign' && live.campaign.status === 'PAUSED') parents.push({ level: 'campaign', id: live.campaign.id, name: live.campaign.name });
      if (live.adset && level === 'ad' && live.adset.status === 'PAUSED') parents.push({ level: 'adset', id: live.adset.id, name: live.adset.name });
      if (parents.length && !body.includeParents) throw new AppException('META_PARENT_PAUSED', { parents });
    } else {
      parents = []; // pausar nunca cascateia
    }
    const objectIds = [...parents.map((p) => p.id), id];
    const write = () => this.meta.setStatus(metaAuthOf(conn, this.config), { objectIds, status: body.status });
    const change = await this.apply(auth, conn, target, 'STATUS', live.status, body.status, parents.map((p) => p.id), 'CAMPAIGNS', write);
    await this.afterStatus(conn, target, body.status, parents);
    return { level, object: await this.campanhas.presentObject(auth, level, id), change, alsoActivated: parents };
  }

  /** PATCH /meta/{campaigns|adsets}/:id/budget (OWNER/ADMIN). */
  async setBudget(auth: AuthContext, level: 'campaign' | 'adset', id: string, body: { dailyBudgetMinor: number; expectedDailyBudgetMinor: number }): Promise<MetaWriteResult> {
    const { conn, target } = await this.prelude(auth, level, id);
    const live = await this.readLive(auth, conn, target, 'DAILY_BUDGET', String(body.dailyBudgetMinor));
    // §4.1: só o orçamento DIÁRIO que mora neste nível (CBO na campanha, ABO no conjunto)
    const where = editableBudget(level, live, live.campaign);
    if (!where.ok) throw new AppException('META_BUDGET_NOT_EDITABLE', { budgetLevel: where.budgetLevel, kind: where.kind });
    if (where.currentMinor !== body.expectedDailyBudgetMinor) await this.changed(conn, target, live);
    const currency = conn.currency ?? 'USD';
    const minimum = storedHealthOf(conn.lastHealth)?._account?.minimumDailyBudgetMinor ?? null;
    if (minimum != null && body.dailyBudgetMinor < minimum) throw new AppException('META_BUDGET_TOO_LOW', { minimumMinor: minimum, currency });
    // D7: subir no máximo META_BUDGET_MAX_STEP× numa ação; diminuir é livre até o mínimo
    const maxMinor = Math.floor(where.currentMinor * this.config.metaBudgetMaxStep);
    if (body.dailyBudgetMinor > maxMinor) throw new AppException('META_BUDGET_STEP_TOO_LARGE', { maxMinor, currency });
    const write = async () => {
      if (!this.meta.setDailyBudget) throw new AppException('META_UNAVAILABLE', { reason: 'down', retryAfterSec: 30 });
      await this.meta.setDailyBudget(metaAuthOf(conn, this.config), { level, id, dailyBudgetMinor: body.dailyBudgetMinor });
    };
    const change = await this.apply(auth, conn, target, 'DAILY_BUDGET', String(where.currentMinor), String(body.dailyBudgetMinor), [], 'CAMPAIGNS', write);
    const data = { dailyBudgetMinor: body.dailyBudgetMinor };
    if (level === 'campaign') await this.prisma.metaCampaignSnapshot.updateMany({ where: { connectionId: conn.id, campaignId: id }, data });
    else await this.prisma.metaAdsetSnapshot.updateMany({ where: { connectionId: conn.id, adsetId: id }, data });
    return { level, object: await this.campanhas.presentObject(auth, level, id), change, alsoActivated: [] };
  }

  // ───────── tela Send (activate/pause; meta-v1 §3.3) ─────────

  /**
   * activate/pause da publicação passam a deixar rastro (source PUBLISH). A escrita em si continua no publicacao.service
   * (ativar liga os 3 níveis, como sempre fez; D6 registra os pais em `alsoChanged`).
   */
  async recordPublish(
    auth: AuthContext, conn: MetaConnection, ad: { id: string; name: string }, from: string | null, to: MetaToggleStatus, alsoChanged: string[],
    write: () => Promise<void>,
  ): Promise<void> {
    const target: Target = { level: 'ad', id: ad.id, name: ad.name, effectiveStatus: '', campaignId: null, adsetId: null, status: toggleOf(from ?? 'PAUSED'), dailyBudgetMinor: null, lifetimeBudgetMinor: null };
    await this.apply(auth, conn, target, 'STATUS', from, to, alsoChanged, 'PUBLISH', write);
  }

  /** §11: a trava META_POLICY da tela Send (anúncio reprovado no snapshot) também deixa rastro: BLOCKED, sem escrita na Meta. */
  async recordPublishBlocked(auth: AuthContext, conn: MetaConnection, ad: { id: string; name: string }, from: string | null, to: MetaToggleStatus, code: 'META_POLICY'): Promise<void> {
    const target: Target = { level: 'ad', id: ad.id, name: ad.name, effectiveStatus: '', campaignId: null, adsetId: null, status: toggleOf(from ?? 'PAUSED'), dailyBudgetMinor: null, lifetimeBudgetMinor: null };
    await this.record(auth, conn, target, 'STATUS', from, to, [], 'BLOCKED', { code }, 'PUBLISH');
  }

  // ───────── passos ─────────

  /** §4 passo 1 + D11: conexão/conta, objeto no snapshot, throttle por workspace, cota da Meta. */
  private async prelude(auth: AuthContext, level: MetaLevel, id: string): Promise<{ conn: MetaConnection; target: Target }> {
    const conn = assertSelected(assertUsable(await this.prisma.metaConnection.findUnique({ where: { workspaceId: auth.workspaceId } })));
    if (accountUnusable(conn.accountStatus)) {
      throw new AppException('META_ACCOUNT_UNUSABLE', { accountStatus: conn.accountStatus, label: accountStatusLabel(conn.accountStatus ?? 0) });
    }
    const target = await this.target(conn, level, id);
    const since = new Date(Date.now() - WINDOW_MS);
    const recent = await this.prisma.metaChange.findMany({ where: { workspaceId: auth.workspaceId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    if (recent.length >= this.config.metaWritesPerMin) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0].createdAt.getTime() + WINDOW_MS - Date.now()) / 1000));
      throw new AppException('RATE_LIMITED', { retryAfterSec });
    }
    const usage = this.meta.usage?.() ?? null;
    if (usage && usage.pct >= this.config.metaWriteUsageCeiling) {
      throw new AppException('META_UNAVAILABLE', { reason: 'rate_limited', retryAfterSec: usage.regainSec ?? 60 });
    }
    return { conn, target };
  }

  private async target(conn: MetaConnection, level: MetaLevel, id: string): Promise<Target> {
    const where = { connectionId: conn.id };
    if (level === 'campaign') {
      const k = await this.prisma.metaCampaignSnapshot.findFirst({ where: { ...where, campaignId: id } });
      if (!k) throw new AppException('NOT_FOUND');
      return { level, id, name: k.name, effectiveStatus: k.effectiveStatus, campaignId: id, adsetId: null, status: toggleOf(k.status), dailyBudgetMinor: k.dailyBudgetMinor, lifetimeBudgetMinor: k.lifetimeBudgetMinor };
    }
    if (level === 'adset') {
      const a = await this.prisma.metaAdsetSnapshot.findFirst({ where: { ...where, adsetId: id } });
      if (!a) throw new AppException('NOT_FOUND');
      return { level, id, name: a.name, effectiveStatus: a.effectiveStatus, campaignId: a.campaignId, adsetId: id, status: toggleOf(a.status), dailyBudgetMinor: a.dailyBudgetMinor, lifetimeBudgetMinor: a.lifetimeBudgetMinor };
    }
    const r = await this.prisma.metaAdSnapshot.findFirst({ where: { ...where, metaAdId: id } });
    if (!r) throw new AppException('NOT_FOUND');
    return { level, id, name: r.name, effectiveStatus: r.effectiveStatus, campaignId: r.campaignId, adsetId: r.adsetId, status: toggleOf(r.status), dailyBudgetMinor: null, lifetimeBudgetMinor: null };
  }

  /**
   * §4 passo 2 (D8): estado AO VIVO antes de escrever. Objeto sumiu = 404 META_OBJECT_GONE (sai do snapshot). Erro da Meta
   * aqui já conta como tentativa: MetaChange FAILED. Porta sem `readObject` (antes da I4) = estado do snapshot.
   */
  private async readLive(auth: AuthContext, conn: MetaConnection, t: Target, field: MetaChangeField, to: string): Promise<MetaLiveObject> {
    if (!this.meta.readObject) return this.liveFromSnapshot(conn, t);
    try {
      return await this.meta.readObject(metaAuthOf(conn, this.config), { level: t.level, id: t.id });
    } catch (e) {
      if (!isMetaError(e)) throw e;
      await this.record(auth, conn, t, field, null, to, [], 'FAILED', e, 'CAMPAIGNS');
      if (e.code === 'META_OBJECT_GONE') {
        await this.dropSnapshot(conn, t);
        throw new AppException('META_OBJECT_GONE');
      }
      if (e.code === 'META_TOKEN_INVALID') await markTokenInvalid(this.prisma, conn.id);
      throw toHttp(e);
    }
  }

  private async liveFromSnapshot(conn: MetaConnection, t: Target): Promise<MetaLiveObject> {
    const [k, a] = await Promise.all([
      t.campaignId && t.level !== 'campaign' ? this.prisma.metaCampaignSnapshot.findFirst({ where: { connectionId: conn.id, campaignId: t.campaignId } }) : null,
      t.adsetId && t.level === 'ad' ? this.prisma.metaAdsetSnapshot.findFirst({ where: { connectionId: conn.id, adsetId: t.adsetId } }) : null,
    ]);
    const parent = (x: { name: string; status: string; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null }, id: string) =>
      ({ id, name: x.name, status: toggleOf(x.status), dailyBudgetMinor: x.dailyBudgetMinor, lifetimeBudgetMinor: x.lifetimeBudgetMinor });
    return {
      level: t.level, id: t.id, name: t.name, status: t.status, effectiveStatus: t.effectiveStatus,
      dailyBudgetMinor: t.dailyBudgetMinor, lifetimeBudgetMinor: t.lifetimeBudgetMinor,
      campaign: k ? parent(k, k.campaignId) : null, adset: a ? parent(a, a.adsetId) : null,
    };
  }

  /** 409 META_OBJECT_CHANGED { current } e o snapshot passa a refletir o que a Meta disse (o web troca a linha). */
  private async changed(conn: MetaConnection, t: Target, live: MetaLiveObject): Promise<never> {
    const data = { status: live.status, effectiveStatus: live.effectiveStatus };
    if (t.level === 'campaign') await this.prisma.metaCampaignSnapshot.updateMany({ where: { connectionId: conn.id, campaignId: t.id }, data: { ...data, dailyBudgetMinor: live.dailyBudgetMinor, lifetimeBudgetMinor: live.lifetimeBudgetMinor } });
    else if (t.level === 'adset') await this.prisma.metaAdsetSnapshot.updateMany({ where: { connectionId: conn.id, adsetId: t.id }, data: { ...data, dailyBudgetMinor: live.dailyBudgetMinor, lifetimeBudgetMinor: live.lifetimeBudgetMinor } });
    else await this.prisma.metaAdSnapshot.updateMany({ where: { connectionId: conn.id, metaAdId: t.id }, data });
    throw new AppException('META_OBJECT_CHANGED', { current: { status: live.status, dailyBudgetMinor: live.dailyBudgetMinor } });
  }

  private async dropSnapshot(conn: MetaConnection, t: Target): Promise<void> {
    if (t.level === 'campaign') {
      await this.prisma.$transaction([
        this.prisma.metaCampaignSnapshot.deleteMany({ where: { connectionId: conn.id, campaignId: t.id } }),
        this.prisma.metaAdsetSnapshot.deleteMany({ where: { connectionId: conn.id, campaignId: t.id } }),
        this.prisma.metaAdSnapshot.deleteMany({ where: { connectionId: conn.id, campaignId: t.id } }),
      ]);
    } else if (t.level === 'adset') {
      await this.prisma.$transaction([
        this.prisma.metaAdsetSnapshot.deleteMany({ where: { connectionId: conn.id, adsetId: t.id } }),
        this.prisma.metaAdSnapshot.deleteMany({ where: { connectionId: conn.id, adsetId: t.id } }),
      ]);
    } else {
      await this.prisma.metaAdSnapshot.deleteMany({ where: { connectionId: conn.id, metaAdId: t.id } });
    }
  }

  /** §4 passos 4-5: escreve; MetaChange APPLIED ou FAILED (a recusa da Meta também fica registrada). */
  private async apply(
    auth: AuthContext, conn: MetaConnection, t: Target, field: MetaChangeField, from: string | null, to: string, alsoChanged: string[],
    source: MetaChangeSource, write: () => Promise<void>,
  ) {
    try {
      await write();
    } catch (e) {
      if (isMetaError(e)) {
        await this.record(auth, conn, t, field, from, to, alsoChanged, 'FAILED', e, source);
        if (e.code === 'META_TOKEN_INVALID') await markTokenInvalid(this.prisma, conn.id);
        if (e.code === 'META_OBJECT_GONE') await this.dropSnapshot(conn, t);
        throw toHttp(e);
      }
      const code = e instanceof AppException ? e.code : 'META_ERROR';
      await this.record(auth, conn, t, field, from, to, alsoChanged, 'FAILED', { code, message: (e as Error).message } as MetaError, source);
      if (!(e instanceof AppException)) this.log.error(`escrita ${t.level} ${t.id}: ${(e as Error).stack ?? e}`);
      throw e;
    }
    const row = await this.record(auth, conn, t, field, from, to, alsoChanged, 'APPLIED', null, source);
    return presentChange(row, await parentNamesOf(this.prisma, auth.workspaceId, [row]));
  }

  private async record(
    auth: AuthContext, conn: MetaConnection, t: Target, field: MetaChangeField, from: string | null, to: string, alsoChanged: string[],
    result: MetaChangeResult, e: Pick<MetaError, 'code'> & Partial<Pick<MetaError, 'failDetail'>> | null, source: MetaChangeSource,
  ) {
    return this.prisma.metaChange.create({
      data: {
        workspaceId: auth.workspaceId, connectionId: conn.id, adAccountId: conn.adAccountId!, level: LEVEL_DB[t.level], objectId: t.id, objectName: t.name,
        field, fromValue: from, toValue: to, alsoChanged, result, errorCode: e?.code ?? null, failDetail: e?.failDetail ?? null, source, userId: auth.userId,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /**
   * Snapshot depois de mudar o toggle: status configurado do objeto (e dos pais ligados junto) e o effective_status de
   * entrega recalculado na árvore da campanha (só ACTIVE/PAUSED/CAMPAIGN_PAUSED/ADSET_PAUSED; reprovação etc. é do sync).
   * Publicação do HookMill acompanha (meta-v1: ACTIVE/PAUSED).
   */
  async afterStatus(conn: MetaConnection, t: Target, status: MetaToggleStatus, parents: MetaObjectRef[]): Promise<void> {
    const w = { connectionId: conn.id };
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (t.level === 'campaign') ops.push(this.prisma.metaCampaignSnapshot.updateMany({ where: { ...w, campaignId: t.id }, data: { status } }));
    if (t.level === 'adset') ops.push(this.prisma.metaAdsetSnapshot.updateMany({ where: { ...w, adsetId: t.id }, data: { status } }));
    if (t.level === 'ad') ops.push(this.prisma.metaAdSnapshot.updateMany({ where: { ...w, metaAdId: t.id }, data: { status } }));
    for (const p of parents) {
      if (p.level === 'campaign') ops.push(this.prisma.metaCampaignSnapshot.updateMany({ where: { ...w, campaignId: p.id }, data: { status: 'ACTIVE' } }));
      if (p.level === 'adset') ops.push(this.prisma.metaAdsetSnapshot.updateMany({ where: { ...w, adsetId: p.id }, data: { status: 'ACTIVE' } }));
    }
    // publicação do HookMill: o anúncio manda; pausar campanha/conjunto pausa a entrega dele
    const now = new Date();
    if (t.level === 'ad') {
      ops.push(this.prisma.metaPublication.updateMany({ where: { connectionId: conn.id, metaAdId: t.id, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status, ...(status === 'ACTIVE' && { activatedAt: now }) } }));
    } else if (status === 'PAUSED') {
      ops.push(this.prisma.metaPublication.updateMany({ where: { connectionId: conn.id, status: 'ACTIVE', ...(t.level === 'campaign' ? { campaignId: t.id } : { adsetId: t.id }) }, data: { status: 'PAUSED' } }));
    }
    await this.prisma.$transaction(ops);
    if (t.campaignId) await this.recomputeDelivery(conn, t.campaignId);
  }

  /** effective_status de entrega da árvore de UMA campanha a partir dos status configurados. */
  private async recomputeDelivery(conn: MetaConnection, campaignId: string): Promise<void> {
    const w = { connectionId: conn.id };
    const [k, adsets, ads] = await Promise.all([
      this.prisma.metaCampaignSnapshot.findFirst({ where: { ...w, campaignId } }),
      this.prisma.metaAdsetSnapshot.findMany({ where: { ...w, campaignId } }),
      this.prisma.metaAdSnapshot.findMany({ where: { ...w, campaignId }, select: { id: true, adsetId: true, status: true, effectiveStatus: true } }),
    ]);
    const campaignPaused = k?.status === 'PAUSED';
    const adsetPaused = new Map(adsets.map((a) => [a.adsetId, a.status === 'PAUSED']));
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (k && DELIVERY.includes(k.effectiveStatus)) {
      const eff = campaignPaused ? 'PAUSED' : 'ACTIVE';
      if (eff !== k.effectiveStatus) ops.push(this.prisma.metaCampaignSnapshot.update({ where: { id: k.id }, data: { effectiveStatus: eff } }));
    }
    for (const a of adsets) {
      if (!DELIVERY.includes(a.effectiveStatus)) continue;
      const eff = a.status === 'PAUSED' ? 'PAUSED' : campaignPaused ? 'CAMPAIGN_PAUSED' : 'ACTIVE';
      if (eff !== a.effectiveStatus) ops.push(this.prisma.metaAdsetSnapshot.update({ where: { id: a.id }, data: { effectiveStatus: eff } }));
    }
    for (const r of ads) {
      if (!DELIVERY.includes(r.effectiveStatus)) continue;
      const eff = r.status === 'PAUSED' ? 'PAUSED' : campaignPaused ? 'CAMPAIGN_PAUSED' : adsetPaused.get(r.adsetId) ? 'ADSET_PAUSED' : 'ACTIVE';
      if (eff !== r.effectiveStatus) ops.push(this.prisma.metaAdSnapshot.update({ where: { id: r.id }, data: { effectiveStatus: eff } }));
    }
    if (ops.length) await this.prisma.$transaction(ops);
  }
}
