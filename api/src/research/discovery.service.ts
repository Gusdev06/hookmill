// ads-research-v1 §2.1 (gatilhos) + C.3 (D1–D5) + C.2 (direto × vizinho) + C.4 (memória). A descoberta mora em
// competitor_discoveries (status + notBefore = fila própria, sem Job). O cliente não cola nada: o HookMill descobre.
//   D1 propor (Claude) → D2 confirmar marcas (sonda por domínio) → D3 varrer termos (frase exata, troca de termo fraco)
//   → D4 julgar (Claude, até 25 Páginas) → D5 escolher (seguidos + reserva) → importar (coleta INITIAL de cada seguido).
// Trava de custo por descoberta (ADS_RESEARCH_DISCOVERY_MAX_USD): passou, para as sondas restantes e escolhe com o que tem.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccountAccess, DiscoveryStage } from '@maquina/contratos';
import { Prisma, type CompetitorDiscovery, type DiscoveryTrigger, type ResearchTermKind } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { failReasonFor } from '../common/errors/falhas';
import { CLAUDE_SERVICE, isIntegracaoError, type BrainDigest, type ClaudeService, type JudgeCompetitorsResult, type ResearchLlmUsage } from '../integracoes';
import type { AdLibraryResearchService } from '../integracoes/contrato';
import { ADS_RESEARCH_SERVICE } from '../integracoes/portas';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResearchCapsService, nextDayUtc, nextMonthUtc } from './caps.service';
import { DAY_MS, brainHash, countryOf, daysBetween, hostOf, sameSite, suspectDisposable, termOutcome } from './regras';
import { ResearchConfig } from './research.config';
import { selectCompetitors, type RankInput } from './selecao';
import { ResearchSyncService, type MergeResult } from './sync.service';

const D2_LIMIT = 10;
const D3_LIMIT = 30;
const D2_MIN_ACTIVE = 3;
const MAX_TERM_SWAPS = 2;
const JUDGE_MAX = 25;
const JUDGE_MAX_SAMPLE = 15;
const MEMORY_ACTIVE_DAYS = 30;
const MAX_BRANDS = 6;
const SAMPLE_BRANDS = 2;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const KIND: Record<'promise' | 'product' | 'pain', ResearchTermKind> = { promise: 'PROMISE', product: 'PRODUCT', pain: 'PAIN' };

/** Página vista na descoberta (sondas ou memória). */
interface PageAgg {
  pageId: string; pageName: string; likeCount: number | null; avatarUrl: string | null;
  adIds: Set<string>; origin: 'LLM' | 'KEYWORD' | 'BOTH' | 'MEMORY';
  brandName: string | null; domain: string | null; termId: string | null;
  adsSeen: number; oldestDays: number | null; hosts: string[]; texts: string[];
  suspect: boolean;
  /** status já decidido antes do juiz (bloqueio, própria marca, seguido) */
  preStatus: 'BLOCKED' | 'FOLLOWED' | 'REJECTED_NICHE' | 'TOO_FEW_ADS' | null;
  preReason: string | null;
  relation: 'DIRECT' | 'ADJACENT' | null; score: number | null; reason: string | null;
  /** memória que não é rejulgada (veredito antigo vale) */
  keepVerdict: boolean;
}

interface Ctx {
  d: CompetitorDiscovery; ws: { id: string; name: string; websiteUrl: string | null }; access: AccountAccess; sample: boolean;
  cost: number; country: string; brain: BrainDigest;
}

class DiscoveryError extends Error {
  constructor(readonly code: string, readonly reason: string) { super(code); }
}

@Injectable()
export class DiscoveryService {
  private readonly log = new Logger('ResearchDiscovery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ResearchConfig,
    private readonly caps: ResearchCapsService,
    private readonly sync: ResearchSyncService,
    private readonly jobs: JobsService,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    @Inject(ADS_RESEARCH_SERVICE) private readonly adlib: AdLibraryResearchService,
  ) {
    this.sync.discoveryTick = () => this.drain();
  }

  // ───────── Brain ─────────

  /** Resumo do Brain (workspace + até 3 ofertas, a principal primeiro) e a impressão digital dele. */
  async brainOf(workspaceId: string): Promise<{ digest: BrainDigest; hash: string; complete: boolean }> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const offers = await this.prisma.offer.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 3 });
    const pagesOf = (meta: Prisma.JsonValue | null): string[] => {
      const pages = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>).pages : null;
      return Array.isArray(pages) ? pages.map((p) => (p && typeof p === 'object' ? String((p as Record<string, unknown>).url ?? '') : '')).filter(Boolean).slice(0, 5) : [];
    };
    const digest: BrainDigest = {
      name: ws.name, industry: ws.industry, market: ws.market, websiteUrl: ws.websiteUrl, language: offers[0]?.language ?? null,
      offers: offers.map((o) => ({
        name: o.name, kind: o.kind, what: o.what, audience: o.audience, promise: o.promise, pains: o.pains, offerAndPrice: o.offerAndPrice, cta: o.cta,
        sourceUrl: o.sourceUrl, pagesRead: pagesOf(o.readMeta),
      })),
    };
    const main = offers[0] ?? null;
    const hash = brainHash({ industry: ws.industry, market: ws.market, websiteUrl: ws.websiteUrl, offer: main && { id: main.id, kind: main.kind, what: main.what, audience: main.audience, promise: main.promise } });
    const complete = !!ws.industry?.trim() || offers.some((o) => o.readMeta != null || !!o.what?.trim());
    return { digest, hash, complete };
  }

  // ───────── gatilhos ─────────

  /**
   * Ganchos (§2.1): fim do onboarding / 1ª oferta lida (ONBOARDING, 1 vez) e Brain mudou (BRAIN_CHANGED: debounce de 24 h,
   * no máximo 1 automática a cada 30 dias). Nunca lança: erro só vai pro log (não pode quebrar o PATCH/complete de quem chamou).
   */
  async onBrainEvent(workspaceId: string, hint: 'onboarding' | 'brain' | 'offer'): Promise<void> {
    try {
      if (this.cfg.mode === 'off' || !this.cfg.autoDiscoveryEnabled) return;
      const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { onboardingCompletedAt: true } });
      if (!ws) return;
      const brain = await this.brainOf(workspaceId);
      if (!brain.complete) return;
      const any = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
      if (!any) {
        // 1ª: fim do onboarding ou 1ª leitura de oferta pronta, o que vier primeiro
        const offerRead = hint === 'offer' && (await this.prisma.offer.count({ where: { workspaceId, archivedAt: null, NOT: { readMeta: { equals: Prisma.DbNull } } } })) > 0;
        if (hint === 'onboarding' || ws.onboardingCompletedAt || offerRead) await this.createAuto(workspaceId, 'ONBOARDING', brain.hash, null);
        return;
      }
      if (hint === 'onboarding') return;
      const last = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, status: { in: ['SUCCEEDED', 'EMPTY', 'RUNNING'] } }, orderBy: { createdAt: 'desc' } });
      if (last && last.inputHash === brain.hash) {
        // voltou ao Brain da última: a automática pendente não faz mais sentido
        await this.prisma.competitorDiscovery.deleteMany({ where: { workspaceId, trigger: 'BRAIN_CHANGED', status: 'QUEUED' } });
        return;
      }
      const lastAuto = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, trigger: { in: ['ONBOARDING', 'BRAIN_CHANGED'] }, status: { not: 'QUEUED' } }, orderBy: { createdAt: 'desc' } });
      const debounce = Date.now() + this.cfg.brainDebounceMs;
      const window = lastAuto ? lastAuto.createdAt.getTime() + this.cfg.discoveryAutoEveryDays * DAY_MS : 0;
      const notBefore = new Date(Math.max(debounce, window));
      const pending = await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId, trigger: 'BRAIN_CHANGED', status: 'QUEUED' } });
      if (pending) await this.prisma.competitorDiscovery.update({ where: { id: pending.id }, data: { inputHash: brain.hash, notBefore } });
      else await this.createAuto(workspaceId, 'BRAIN_CHANGED', brain.hash, notBefore);
    } catch (e) {
      this.log.warn(`gancho da descoberta (${workspaceId}, ${hint}): ${(e as Error).message}`);
    }
  }

  private async createAuto(workspaceId: string, trigger: DiscoveryTrigger, hash: string, notBefore: Date | null): Promise<void> {
    const access = await this.caps.access(workspaceId);
    let nb = notBefore;
    if (!nb && access === 'SAMPLE' && (await this.caps.sampleDayFull())) nb = nextDayUtc();
    if (!nb && !(await this.caps.fits(workspaceId, this.cfg.discoveryEstimateUsd, access))) nb = nextMonthUtc(); // teto do mês: fica pro dia 1
    if (!nb && !(await this.caps.globalFits(this.cfg.discoveryEstimateUsd))) nb = nextDayUtc();
    const d = await this.prisma.competitorDiscovery.create({ data: { workspaceId, trigger, status: 'QUEUED', inputHash: hash, notBefore: nb } });
    if (!nb) this.kick(d.id);
  }

  /** `POST /research/discovery` ("Procurar de novo"). */
  async requestManual(auth: AuthContext): Promise<CompetitorDiscovery> {
    if (this.cfg.mode === 'off') throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'not_configured', retryAfter: null });
    const st = await this.adlib.status();
    if (!st.available) throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: st.reason ?? 'not_configured', retryAfter: st.retryAfter });
    const ws = auth.workspaceId;
    const running = await this.prisma.competitorDiscovery.findFirst({
      where: { workspaceId: ws, OR: [{ status: 'RUNNING' }, { status: 'QUEUED', trigger: { not: 'BRAIN_CHANGED' } }] },
    });
    if (running) throw new AppException('INVALID_STATE', { state: running.status, allowed: ['SUCCEEDED', 'EMPTY', 'FAILED'], reason: 'discovery_running' });
    const access = await this.caps.access(ws);
    if (access === 'SAMPLE' && (await this.prisma.competitorDiscovery.count({ where: { workspaceId: ws, status: { not: 'QUEUED' } } }))) {
      throw new AppException('PAYMENT_REQUIRED', { reason: 'research_tier', unlock: { pieces: 0 } });
    }
    const brain = await this.brainOf(ws);
    if (!brain.complete) throw new AppException('INVALID_STATE', { state: 'brain', allowed: ['industry', 'offer'], reason: 'brain_incomplete' });
    const availableAt = await this.manualAvailableAt(ws);
    if (availableAt && availableAt.getTime() > Date.now()) throw new AppException('RATE_LIMITED', { retryAfter: availableAt.toISOString() });
    await this.caps.assertWorkspace(ws, this.cfg.discoveryEstimateUsd, access);
    if (access === 'SAMPLE' && (await this.caps.sampleDayFull())) throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: 'quota', retryAfter: nextDayUtc().toISOString() });
    const delay = !(await this.caps.globalFits(this.cfg.discoveryEstimateUsd));
    // o manual cobre a automática pendente (mesmo Brain de agora)
    await this.prisma.competitorDiscovery.deleteMany({ where: { workspaceId: ws, trigger: 'BRAIN_CHANGED', status: 'QUEUED' } });
    const d = await this.prisma.competitorDiscovery.create({
      data: { workspaceId: ws, trigger: 'MANUAL', status: 'QUEUED', inputHash: brain.hash, requestedById: auth.userId, notBefore: delay ? nextDayUtc() : null },
    });
    if (!delay) this.kick(d.id);
    return d;
  }

  /** 7 dias depois da última descoberta que não falhou (null = já pode). */
  async manualAvailableAt(workspaceId: string): Promise<Date | null> {
    const last = await this.prisma.competitorDiscovery.findFirst({
      where: { workspaceId, status: { in: ['SUCCEEDED', 'EMPTY', 'RUNNING'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (!last) return null;
    const at = new Date(last.createdAt.getTime() + this.cfg.discoveryEveryDays * DAY_MS);
    return at.getTime() > Date.now() ? at : null;
  }

  kick(id: string): void {
    void this.jobs.detach(null, `descoberta ${id}`, () => this.run(id));
  }

  /** Fila: descobertas QUEUED vencidas (notBefore ≤ agora; esquecidas > 2 min) e RUNNING presas (reinício) = FAILED. */
  async drain(): Promise<void> {
    const now = new Date();
    await this.prisma.competitorDiscovery.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - 30 * 60_000) } },
      data: { status: 'FAILED', errorCode: 'INTERRUPTED', failReason: failReasonFor('INTERRUPTED'), finishedAt: now, stage: null },
    });
    const due = await this.prisma.competitorDiscovery.findMany({
      where: { status: 'QUEUED', OR: [{ notBefore: { lte: now } }, { notBefore: null, createdAt: { lt: new Date(now.getTime() - 120_000) } }] },
      orderBy: { createdAt: 'asc' }, take: 10,
    });
    for (const d of due) {
      const access = await this.caps.access(d.workspaceId);
      if (!(await this.caps.globalFits(this.cfg.discoveryEstimateUsd)) || (access === 'SAMPLE' && (await this.caps.sampleDayFull()))) {
        await this.prisma.competitorDiscovery.update({ where: { id: d.id }, data: { notBefore: nextDayUtc() } });
        continue;
      }
      if (!(await this.caps.fits(d.workspaceId, this.cfg.discoveryEstimateUsd, access))) {
        await this.prisma.competitorDiscovery.update({ where: { id: d.id }, data: { notBefore: nextMonthUtc() } });
        continue;
      }
      if (d.trigger === 'BRAIN_CHANGED') {
        // o Brain pode ter mudado de novo (ou voltado): usa a impressão de agora
        const brain = await this.brainOf(d.workspaceId);
        await this.prisma.competitorDiscovery.update({ where: { id: d.id }, data: { inputHash: brain.hash } });
      }
      await this.run(d.id);
    }
  }

  // ───────── pipeline ─────────

  private async stage(id: string, stage: DiscoveryStage, data: Prisma.CompetitorDiscoveryUpdateInput = {}): Promise<void> {
    await this.prisma.competitorDiscovery.update({ where: { id }, data: { stage, ...data } });
  }

  private async charge(ctx: Ctx, u: ResearchLlmUsage): Promise<void> {
    ctx.cost = round4(ctx.cost + u.costUsd);
    await this.caps.chargeLlm(this.prisma, { workspaceId: ctx.ws.id, discoveryId: ctx.d.id, model: u.model, inputKtok: u.inputKtok, outputKtok: u.outputKtok, inputUsd: u.inputUsd, outputUsd: u.outputUsd });
  }

  private overBudget(ctx: Ctx, next: number): boolean {
    return ctx.cost + next > this.cfg.discoveryMaxUsd + 1e-9;
  }

  /** Roda uma descoberta QUEUED (CAS → RUNNING). Nunca lança. */
  async run(id: string): Promise<void> {
    const claimed = await this.prisma.competitorDiscovery.updateMany({
      where: { id, status: 'QUEUED', OR: [{ notBefore: null }, { notBefore: { lte: new Date() } }] },
      data: { status: 'RUNNING', startedAt: new Date(), stage: 'propose' },
    });
    if (!claimed.count) return;
    const d = await this.prisma.competitorDiscovery.findUniqueOrThrow({ where: { id } });
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: d.workspaceId }, select: { id: true, name: true, websiteUrl: true } });
    const access = await this.caps.access(ws.id);
    const brain = await this.brainOf(ws.id);
    const ctx: Ctx = { d, ws, access, sample: access === 'SAMPLE', cost: 0, country: 'US', brain: brain.digest };
    try {
      await this.pipeline(ctx);
    } catch (e) {
      const code = e instanceof DiscoveryError ? e.code : isIntegracaoError(e) ? (['AD_LIBRARY_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'SAFETY_BLOCK'].includes(e.code) ? e.code : 'PROVIDER_ERROR') : 'PROVIDER_ERROR';
      if (!(e instanceof DiscoveryError) && !isIntegracaoError(e)) this.log.error(`descoberta ${id}: ${(e as Error)?.stack ?? e}`);
      await this.prisma.competitorDiscovery.update({
        where: { id }, data: { status: 'FAILED', stage: null, errorCode: code, failReason: e instanceof DiscoveryError ? e.reason : failReasonFor(code as never) ?? failReasonFor('PROVIDER_ERROR'), costUsd: ctx.cost, finishedAt: new Date() },
      }).catch(() => undefined);
    }
  }

  private async pipeline(ctx: Ctx): Promise<void> {
    const { d, ws } = ctx;
    // bloqueio (removidos: Página e domínio) e a própria marca (site do cliente e Página da conexão Meta)
    const dismissed = await this.prisma.competitor.findMany({ where: { workspaceId: ws.id, status: 'DISMISSED' }, include: { source: { select: { pageId: true, displayName: true } } } });
    const blockedPages = new Set(dismissed.map((c) => c.source.pageId));
    const blockedDomains = dismissed.map((c) => c.domain).filter((x): x is string => !!x);
    const ownHost = hostOf(ws.websiteUrl);
    const ownPageId = (await this.prisma.metaConnection.findUnique({ where: { workspaceId: ws.id }, select: { pageId: true } }))?.pageId ?? null;
    const isBlockedDomain = (host: string | null) => !!host && blockedDomains.some((b) => sameSite(host, b));
    const isOwn = (host: string | null) => !!ownHost && !!host && sameSite(host, ownHost);

    // memória de termos (só "Procurar de novo"; ONBOARDING/BRAIN_CHANGED não reaproveitam; SAMPLE sem memória)
    const lastCountry = (await this.prisma.competitorDiscovery.findFirst({ where: { workspaceId: ws.id, status: { in: ['SUCCEEDED', 'EMPTY'] }, countryCode: { not: null } }, orderBy: { createdAt: 'desc' }, select: { countryCode: true } }))?.countryCode ?? null;
    const reuse = d.trigger === 'MANUAL' && !ctx.sample && lastCountry
      ? await this.prisma.researchTerm.findMany({
        where: { workspaceId: ws.id, approvedCount: { gt: 0 }, discovery: { countryCode: lastCountry } },
        orderBy: [{ approvedCount: 'desc' }, { createdAt: 'desc' }], take: 6,
      }).then((rows) => [...new Map(rows.map((r) => [r.term.toLowerCase(), r])).values()].slice(0, 2))
      : [];

    // D1 propor
    const p = await this.claude.proposeCompetitors({
      brain: ctx.brain, blocked: { pageNames: dismissed.map((c) => c.source.displayName), domains: blockedDomains }, reuseTerms: reuse.map((t) => t.term), maxBrands: MAX_BRANDS,
    });
    await this.charge(ctx, p);
    ctx.country = countryOf(p.countryCode) ?? 'US';
    const reused = lastCountry === ctx.country ? reuse : [];
    await this.stage(d.id, 'confirm', { countryCode: ctx.country, countryReason: p.countryReason?.slice(0, 500) ?? null, costUsd: ctx.cost });

    const pages = new Map<string, PageAgg>();
    const touch = (pageId: string, name: string, m: MergeResult | null, extra: Partial<PageAgg>) => {
      const cur = pages.get(pageId);
      if (cur) {
        if (extra.origin && cur.origin !== extra.origin && cur.origin !== 'BOTH') cur.origin = 'BOTH';
        cur.brandName ??= extra.brandName ?? null;
        cur.domain ??= extra.domain ?? null;
        cur.termId ??= extra.termId ?? null;
      } else {
        pages.set(pageId, {
          pageId, pageName: name, likeCount: null, avatarUrl: null, adIds: new Set(), origin: extra.origin ?? 'KEYWORD', brandName: extra.brandName ?? null,
          domain: extra.domain ?? null, termId: extra.termId ?? null, adsSeen: 0, oldestDays: null, hosts: [], texts: [], suspect: false,
          preStatus: null, preReason: null, relation: null, score: null, reason: null, keepVerdict: false,
        });
      }
      const g = m?.byPage.get(pageId);
      if (g) for (const a of g.adIds) pages.get(pageId)!.adIds.add(a);
    };
    const notFound: { brand: string; domain: string; status: 'NOT_FOUND' | 'TOO_FEW_ADS' | 'BLOCKED' | 'REJECTED_NICHE'; pageId: string | null; pageName: string | null; seen: number; reason: string | null }[] = [];

    // D2 confirmar marcas (SAMPLE: só as 2 primeiras)
    const brands = (p.brands ?? []).slice(0, ctx.sample ? SAMPLE_BRANDS : MAX_BRANDS);
    const d2Est = this.cfg.scrapeEstimateUsd(D2_LIMIT);
    const d2 = await pool(brands, this.cfg.apifyConcurrency, async (b) => {
      const domain = hostOf(b.domain) ?? b.domain.toLowerCase();
      if (isOwn(domain)) return { b, domain, skip: 'REJECTED_NICHE' as const };
      if (isBlockedDomain(domain)) return { b, domain, skip: 'BLOCKED' as const };
      if (this.overBudget(ctx, d2Est)) return { b, domain, skip: 'budget' as const };
      const r = await this.sync.probe({ discoveryId: d.id, workspaceId: ws.id, query: domain, searchType: 'unordered', countryCode: ctx.country, limit: D2_LIMIT });
      if ('result' in r) ctx.cost = round4(ctx.cost + r.result.costUsd);
      return { b, domain, r };
    });
    let probesOk = 0;
    let probesUnavailable = 0;
    for (const x of d2) {
      if ('skip' in x && x.skip) {
        if (x.skip !== 'budget') notFound.push({ brand: x.b.brand, domain: x.domain, status: x.skip as 'BLOCKED' | 'REJECTED_NICHE', pageId: null, pageName: null, seen: 0, reason: x.skip === 'REJECTED_NICHE' ? 'Sua própria marca' : null });
        continue;
      }
      if (!('r' in x) || !x.r) continue;
      if ('error' in x.r) {
        ctx.cost = round4(ctx.cost + x.r.costUsd);
        if (x.r.error === 'AD_LIBRARY_UNAVAILABLE') probesUnavailable++;
        notFound.push({ brand: x.b.brand, domain: x.domain, status: 'NOT_FOUND', pageId: null, pageName: null, seen: 0, reason: null });
        continue;
      }
      probesOk++;
      const items = x.r.result.items;
      // Página = a com mais anúncios linkando o domínio; senão a Página cujo nome contém a marca
      const linking = new Map<string, number>();
      for (const it of items) if (it.pageId && sameSite(it.linkHost ?? hostOf(it.linkUrl), x.domain)) linking.set(it.pageId, (linking.get(it.pageId) ?? 0) + 1);
      let pageId: string | null = [...linking.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!pageId) {
        const brand = x.b.brand.toLowerCase().trim();
        pageId = items.find((it) => it.pageId && brand && it.pageName.toLowerCase().includes(brand))?.pageId ?? null;
      }
      if (!pageId) {
        notFound.push({ brand: x.b.brand, domain: x.domain, status: 'NOT_FOUND', pageId: null, pageName: null, seen: 0, reason: null });
        continue;
      }
      const mine = items.filter((it) => it.pageId === pageId);
      const active = mine.filter((it) => it.isActive).length;
      if (active < D2_MIN_ACTIVE) {
        notFound.push({ brand: x.b.brand, domain: x.domain, status: 'TOO_FEW_ADS', pageId, pageName: mine[0]?.pageName ?? null, seen: active, reason: null });
        continue;
      }
      touch(pageId, mine[0].pageName, x.r.merge, { origin: 'LLM', brandName: x.b.brand, domain: x.domain });
      const agg = pages.get(pageId)!;
      agg.likeCount ??= mine[0].pageLikeCount;
      agg.avatarUrl ??= mine[0].pageAvatarUrl;
    }

    // D3 varrer termos (frase exata; EMPTY/DIFFUSE trocado por reserva do mesmo D1, até 2 trocas; SAMPLE: 2, sem troca)
    await this.stage(d.id, 'scan', { costUsd: ctx.cost });
    const proposed = (p.terms ?? []).map((t) => ({ term: t.term.trim(), kind: KIND[t.kind] ?? 'PRODUCT' })).filter((t) => t.term);
    const byKind = (k: ResearchTermKind) => proposed.filter((t) => t.kind === k);
    const [pr, pd, pn] = [byKind('PROMISE'), byKind('PRODUCT'), byKind('PAIN')];
    type Planned = { term: string; kind: ResearchTermKind; origin: 'NEW' | 'REUSED' };
    let plan: Planned[];
    if (ctx.sample) plan = [pr[0], pd[0]].filter(Boolean).map((t) => ({ ...t, origin: 'NEW' as const }));
    else if (reused.length) {
      const fresh = [pr[0], pn[0], pd[0], pr[1]].filter(Boolean).filter((t) => !reused.some((r) => r.term.toLowerCase() === t.term.toLowerCase())).slice(0, 4 - reused.length);
      plan = [...reused.map((r) => ({ term: r.term, kind: r.kind, origin: 'REUSED' as const })), ...fresh.map((t) => ({ ...t, origin: 'NEW' as const }))];
    } else plan = [pr[0], pd[0], pn[0], pd[1]].filter(Boolean).map((t) => ({ ...t, origin: 'NEW' as const }));
    const planned = new Set(plan.map((t) => t.term.toLowerCase()));
    const reserves = proposed.filter((t) => !planned.has(t.term.toLowerCase()));
    let swaps = 0;
    const d3Est = this.cfg.scrapeEstimateUsd(D3_LIMIT);
    const searchTerm = async (t: Planned): Promise<void> => {
      if (this.overBudget(ctx, d3Est)) {
        await this.prisma.researchTerm.create({ data: { workspaceId: ws.id, discoveryId: d.id, term: t.term, kind: t.kind, origin: t.origin, outcome: 'UNUSED' } });
        return;
      }
      const r = await this.sync.probe({ discoveryId: d.id, workspaceId: ws.id, query: t.term, searchType: 'exact_phrase', countryCode: ctx.country, limit: D3_LIMIT });
      if ('error' in r) {
        ctx.cost = round4(ctx.cost + r.costUsd);
        if (r.error === 'AD_LIBRARY_UNAVAILABLE') probesUnavailable++;
        await this.prisma.researchTerm.create({ data: { workspaceId: ws.id, discoveryId: d.id, term: t.term, kind: t.kind, origin: t.origin, outcome: 'EMPTY' } });
        return;
      }
      probesOk++;
      ctx.cost = round4(ctx.cost + r.result.costUsd);
      const perPage = new Map<string, { name: string; n: number; like: number | null; avatar: string | null }>();
      for (const it of r.result.items) {
        if (!it.pageId) continue;
        const g = perPage.get(it.pageId) ?? { name: it.pageName, n: 0, like: it.pageLikeCount, avatar: it.pageAvatarUrl };
        g.n++;
        perPage.set(it.pageId, g);
      }
      const counts = [...perPage.values()].map((g) => g.n);
      const outcome = termOutcome(counts);
      const term = await this.prisma.researchTerm.create({
        data: { workspaceId: ws.id, discoveryId: d.id, term: t.term, kind: t.kind, origin: t.origin, outcome, pagesFound: perPage.size, pagesMultiAd: counts.filter((n) => n >= 2).length },
      });
      for (const [pageId, g] of perPage) {
        if (outcome === 'DIFFUSE' && g.n <= 1) continue; // Página de 1 anúncio de termo difuso não entra
        touch(pageId, g.name, r.merge, { origin: 'KEYWORD', termId: term.id });
        const agg = pages.get(pageId)!;
        agg.likeCount ??= g.like;
        agg.avatarUrl ??= g.avatar;
      }
      if ((outcome === 'EMPTY' || outcome === 'DIFFUSE') && !ctx.sample && swaps < MAX_TERM_SWAPS) {
        const idx = reserves.findIndex((x) => x.kind === t.kind);
        const next = idx >= 0 ? reserves.splice(idx, 1)[0] : reserves.shift();
        if (next) {
          swaps++;
          await searchTerm({ ...next, origin: 'NEW' });
        }
      }
    };
    await pool(plan, this.cfg.apifyConcurrency, searchTerm);
    for (const t of reserves) await this.prisma.researchTerm.create({ data: { workspaceId: ws.id, discoveryId: d.id, term: t.term, kind: t.kind, origin: 'NEW', outcome: 'UNUSED' } });
    const searched = await this.prisma.researchTerm.findMany({ where: { discoveryId: d.id, outcome: { not: 'UNUSED' } }, select: { term: true } });
    if (!probesOk && probesUnavailable) throw new DiscoveryError('AD_LIBRARY_UNAVAILABLE', failReasonFor('AD_LIBRARY_UNAVAILABLE'));

    // agrega cada Página com o que a base global viu
    await this.aggregate([...pages.values()]);
    const followed = await this.prisma.competitor.findMany({ where: { workspaceId: ws.id, status: { in: ['ACTIVE', 'DISMISSED'] } }, include: { source: { select: { pageId: true, countryCode: true } } } });
    const followedPages = new Set(followed.filter((c) => c.status === 'ACTIVE' && c.source.countryCode === ctx.country).map((c) => c.source.pageId));
    for (const g of pages.values()) {
      g.suspect = suspectDisposable({ pageName: g.pageName, activeAdsSeen: g.adsSeen });
      if (blockedPages.has(g.pageId) || g.hosts.some(isBlockedDomain) || isBlockedDomain(g.domain)) { g.preStatus = 'BLOCKED'; continue; }
      if (g.pageId === ownPageId || isOwn(g.domain) || (g.hosts.length > 0 && g.hosts.every((h) => isOwn(h)))) { g.preStatus = 'REJECTED_NICHE'; g.preReason = 'Sua própria marca'; continue; }
      if (followedPages.has(g.pageId)) g.preStatus = 'FOLLOWED';
    }

    // memória (C.4): aprovados antigos (RESERVE, mesmo país, ainda ativos) voltam sem custo; BRAIN_CHANGED rejulga
    if (!ctx.sample) await this.addMemory(ctx, pages, blockedPages, followedPages);

    // D4 julgar (até 25; SAMPLE 15): ≥ 2 anúncios primeiro, depois por anúncios vistos
    await this.stage(d.id, 'judge', { costUsd: ctx.cost, keywords: searched.map((t) => t.term) });
    const judgeable = [...pages.values()].filter((g) => !g.preStatus && !g.keepVerdict)
      .sort((a, b) => Number(b.adsSeen >= 2) - Number(a.adsSeen >= 2) || b.adsSeen - a.adsSeen);
    const max = ctx.sample ? JUDGE_MAX_SAMPLE : JUDGE_MAX;
    for (const g of judgeable.slice(max)) { g.preStatus = 'TOO_FEW_ADS'; }
    const toJudge = judgeable.slice(0, max);
    if (toJudge.length) {
      const j: JudgeCompetitorsResult = await this.claude.judgeCompetitors({
        brain: ctx.brain,
        pages: toJudge.map((g) => ({ pageId: g.pageId, pageName: g.pageName, likeCount: g.likeCount, hosts: g.hosts.slice(0, 5), texts: g.texts.slice(0, 3), adsSeen: g.adsSeen, oldestDays: g.oldestDays, suspectDisposable: g.suspect })),
      });
      await this.charge(ctx, j);
      const verdict = new Map(j.items.map((v) => [v.pageId, v]));
      for (const g of toJudge) {
        const v = verdict.get(g.pageId);
        g.score = v ? Math.max(0, Math.min(100, Math.round(v.score))) : 0;
        g.reason = v?.reason?.slice(0, 300) ?? null;
        g.relation = v?.relation === 'direct' ? 'DIRECT' : v?.relation === 'adjacent' ? 'ADJACENT' : null;
      }
    }

    // D5 escolher
    const approved = (g: PageAgg) => !g.preStatus && g.relation != null && (g.score ?? 0) >= this.cfg.minScore;
    const all = [...pages.values()];
    const rank = (g: PageAgg): PageAgg & RankInput => Object.assign(g, { relation: g.relation!, score: g.score ?? 0 }) as PageAgg & RankInput;
    const fresh = all.filter((g) => approved(g) && g.origin !== 'MEMORY').map(rank);
    const memory = all.filter((g) => approved(g) && g.origin === 'MEMORY').map(rank);
    const active = await this.prisma.competitor.count({ where: { workspaceId: ws.id, status: 'ACTIVE' } });
    const sel = selectCompetitors({ fresh, memory, slots: this.cfg.maxCompetitors(ctx.access) - active, reserveMax: this.cfg.reserveMax(ctx.access) });
    const status = new Map<string, { status: 'FOLLOWED' | 'RESERVE'; rank: number }>();
    sel.follow.forEach((g, i) => status.set(g.pageId, { status: 'FOLLOWED', rank: i + 1 }));
    sel.reserve.forEach((g, i) => status.set(g.pageId, { status: 'RESERVE', rank: sel.follow.length + i + 1 }));

    await this.stage(d.id, 'import', { costUsd: ctx.cost });
    // candidatos: todas as Páginas avaliadas + marcas sem Página
    for (const g of all) {
      const s = status.get(g.pageId);
      const st = s?.status ?? (g.preStatus === 'FOLLOWED' ? 'FOLLOWED' : g.preStatus ?? (approved(g) ? 'REJECTED_NICHE' : g.adsSeen < 1 ? 'TOO_FEW_ADS' : 'REJECTED_NICHE'));
      await this.prisma.competitorCandidate.create({
        data: {
          discoveryId: d.id, workspaceId: ws.id, termId: g.termId, brandName: g.brandName, domain: g.domain, pageId: g.pageId, pageName: g.pageName.slice(0, 300),
          origin: g.origin, status: st, relation: approved(g) || g.keepVerdict ? g.relation : null, rank: s?.rank ?? null, activeAdsSeen: g.adsSeen,
          oldestDays: g.oldestDays, nicheScore: g.score, suspectDisposable: g.suspect, reason: g.preReason ?? g.reason,
        },
      });
    }
    for (const n of notFound) {
      await this.prisma.competitorCandidate.create({
        data: { discoveryId: d.id, workspaceId: ws.id, brandName: n.brand, domain: n.domain, pageId: n.pageId, pageName: n.pageName, origin: 'LLM', status: n.status, activeAdsSeen: n.seen, reason: n.reason },
      });
    }
    // termos que renderam (aprovados vindos de cada termo)
    const perTerm = new Map<string, number>();
    for (const g of [...sel.follow, ...sel.reserve]) if (g.termId && g.origin !== 'MEMORY') perTerm.set(g.termId, (perTerm.get(g.termId) ?? 0) + 1);
    for (const [termId, n] of perTerm) await this.prisma.researchTerm.update({ where: { id: termId }, data: { approvedCount: n } });

    // seguir + importar
    for (const g of sel.follow) {
      await this.follow(ctx, g);
    }
    const candidatesFound = all.filter((g) => g.origin !== 'MEMORY').length + notFound.length;
    await this.prisma.competitorDiscovery.update({
      where: { id: d.id },
      data: {
        status: sel.follow.length + sel.reserve.length === 0 ? 'EMPTY' : 'SUCCEEDED', stage: null, candidatesFound, followed: sel.follow.length, reserved: sel.reserve.length,
        costUsd: ctx.cost, finishedAt: new Date(),
      },
    });
  }

  /** Conta anúncios ativos vistos, o mais antigo, hosts e textos de cada Página (pelos anúncios das sondas). */
  private async aggregate(list: PageAgg[]): Promise<void> {
    const ids = list.flatMap((g) => [...g.adIds]);
    if (!ids.length) return;
    const ads = await this.prisma.libraryAd.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true, startDate: true, linkHost: true, linkUrl: true, headline: true, primaryText: true } });
    const byId = new Map(ads.map((a) => [a.id, a]));
    const now = new Date();
    for (const g of list) {
      const mine = [...g.adIds].map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
      g.adsSeen = mine.filter((a) => a.isActive).length;
      const starts = mine.map((a) => a.startDate).filter((x): x is Date => !!x);
      g.oldestDays = starts.length ? Math.max(...starts.map((s) => daysBetween(s, now))) : null;
      g.hosts = [...new Set(mine.map((a) => a.linkHost ?? hostOf(a.linkUrl)).filter((h): h is string => !!h))].slice(0, 5);
      g.texts = mine.map((a) => [a.headline, a.primaryText].filter(Boolean).join(' — ').slice(0, 400)).filter(Boolean).slice(0, 3);
    }
  }

  /** C.4: aprovados de descobertas anteriores (RESERVE, mesmo país, não seguidos nem bloqueados, ainda ativos). */
  private async addMemory(ctx: Ctx, pages: Map<string, PageAgg>, blocked: Set<string>, followed: Set<string>): Promise<void> {
    const rows = await this.prisma.competitorCandidate.findMany({
      where: { workspaceId: ctx.ws.id, status: 'RESERVE', pageId: { not: null }, discoveryId: { not: ctx.d.id }, discovery: { countryCode: ctx.country } },
      orderBy: { createdAt: 'desc' },
    });
    const since = new Date(Date.now() - MEMORY_ACTIVE_DAYS * DAY_MS);
    const seen = new Set<string>();
    for (const c of rows) {
      const pageId = c.pageId!;
      if (seen.has(pageId) || pages.has(pageId) || blocked.has(pageId) || followed.has(pageId)) continue;
      seen.add(pageId);
      const src = await this.prisma.adSource.findUnique({ where: { pageId_countryCode: { pageId, countryCode: ctx.country } }, select: { lastActiveCount: true } });
      const alive = (src?.lastActiveCount ?? 0) > 0 || (await this.prisma.libraryAd.count({ where: { pageId, isActive: true, lastSeenAt: { gte: since } } })) > 0;
      if (!alive) continue;
      const rejudge = ctx.d.trigger === 'BRAIN_CHANGED';
      const ads = await this.prisma.libraryAd.findMany({ where: { pageId, isActive: true }, select: { id: true }, take: 50 });
      pages.set(pageId, {
        pageId, pageName: c.pageName ?? pageId, likeCount: null, avatarUrl: null, adIds: new Set(ads.map((a) => a.id)), origin: 'MEMORY', brandName: c.brandName, domain: c.domain,
        termId: null, adsSeen: c.activeAdsSeen, oldestDays: c.oldestDays, hosts: [], texts: [], suspect: c.suspectDisposable, preStatus: null, preReason: null,
        relation: rejudge ? null : c.relation, score: rejudge ? null : c.nicheScore, reason: rejudge ? null : c.reason, keepVerdict: !rejudge,
      });
      if (rejudge) await this.aggregate([pages.get(pageId)!]);
    }
  }

  /** Segue a Página: fonte (global), elo dos anúncios já vistos, Competitor e a coleta INITIAL. */
  private async follow(ctx: Ctx, g: PageAgg & RankInput): Promise<void> {
    const source = await this.sync.ensureSource({ pageId: g.pageId, countryCode: ctx.country, displayName: g.pageName, likeCount: g.likeCount, avatarUrl: g.avatarUrl });
    await this.sync.linkPageAds(source);
    const domain = g.domain ?? g.hosts[0] ?? null;
    await this.prisma.competitor.upsert({
      where: { workspaceId_sourceId: { workspaceId: ctx.ws.id, sourceId: source.id } },
      create: {
        workspaceId: ctx.ws.id, sourceId: source.id, name: g.brandName?.slice(0, 80) || g.pageName.slice(0, 80), origin: 'DISCOVERED', relation: g.relation, nicheScore: g.score,
        discoveryId: ctx.d.id, reason: g.reason, domain,
      },
      // aposentado que voltou a anunciar volta a ser seguido; removido nunca chega aqui (bloqueio)
      update: { status: 'ACTIVE', retiredAt: null, relation: g.relation, nicheScore: g.score, discoveryId: ctx.d.id, reason: g.reason },
    });
    await this.sync.refreshSourceStatus(source.id);
    await this.sync.enqueuePage({ source, trigger: 'INITIAL', limit: this.cfg.maxAds(ctx.access), workspaceId: ctx.ws.id, discoveryId: ctx.d.id });
  }
}

/** Map com no máximo `n` em paralelo (ordem do resultado = ordem da entrada). */
export async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, worker));
  return out;
}
