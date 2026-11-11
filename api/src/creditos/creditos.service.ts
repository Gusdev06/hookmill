// templates-creditos-v1 §4-§5 (31/10): saldo por CONTA, livro-razão idempotente, reserva no Gerar, assentamento (cobra o que
// ficou pronto, devolve o que falhou), Retry depois do estorno, usos da amostra e o crédito manual do admin.
// Única porta de escrita de `users.credit_balance`, `users.sample_uses` e `credit_entries`.
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type {
  AccountAccess, CreditEntryView, CreditPool, CreditsSummary, GrantCreditsBody, GrantCreditsResponse, IterateTemplateRun, PieceStatus, RunLineView,
  TemplateFit, TemplateRunRef, TemplateSelectionView,
} from '@maquina/contratos';
import { Prisma } from '@prisma/client';
import { AmostraService } from '../amostra/amostra.service';
import { effectiveAccess, testMode } from '../amostra/acesso';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { KeyedMutex } from '../common/util/mutex';
import { pieceStatus } from '../edicao/pecas';
import { PrismaService } from '../prisma/prisma.service';
import { isSelectionRow } from '../templates/catalogo';
import { skippedOf } from '../iteracao/templates-lote';
import { type RunLine, ledgerKey, lineKeyOf, lineSubIdOf, quoteOf, retryNeed, sampleTemplateUses, settle } from './regras';

type Db = Prisma.TransactionClient | PrismaService;

/** Quem paga o Gerar de um workspace (§4.1). pool null = INTERNAL (ilimitado, sem lançamento). */
export interface Payer { access: AccountAccess; accountId: string | null; pool: CreditPool | null }

/** Settings do lote de template (`variation_batches.settings.template`). */
export interface BatchTemplateSettings {
  slug: string;
  pack: boolean;
  /** chaves do catálogo que o plano pode usar ("FRAME:news", "HEADLINE"…) */
  keys: string[];
  /** máximo por tipo (template único e seleção; o pack usa o do plano) */
  max?: Record<string, number>;
  /** fit gravado quando o plano fica pronto (§6) */
  fit?: { level: 'ok' | 'soft' | 'hard' | 'unknown'; reason: string | null };
  /** templates-multi-v1 §2 (04/11): lote de vários templates marcados pela pessoa (slug 'selection', pack false) */
  selection?: boolean;
  /** os marcados, na ordem do pedido (`keys` na mesma ordem) */
  slugs?: string[];
  /** fit de cada marcado, gravado no PLAN_READY (base do `skipped`) */
  fits?: Record<string, TemplateFit>;
}
export function templateSettingsOf(settings: unknown): BatchTemplateSettings | null {
  const t = (settings as { template?: unknown } | null)?.template;
  return t && typeof t === 'object' && typeof (t as BatchTemplateSettings).slug === 'string' ? (t as BatchTemplateSettings) : null;
}

const SETTLE_EVERY_MS = 5000;
const LEDGER_MAX = 100;

const PIECE_INCLUDE = {
  creative: { select: { state: true, renders: { where: { stale: false }, select: { format: true, status: true, createdAt: true } } } },
} satisfies Prisma.VariationItemInclude;

@Injectable()
export class CreditosService {
  private readonly log = new Logger('Creditos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly amostra: AmostraService,
    private readonly locks: KeyedMutex,
  ) {}

  // ───────── quem paga ─────────

  /** §4.1 / A1: o OWNER mais antigo com o acesso efetivo do workspace. */
  async payerOf(workspaceId: string, db: Db = this.prisma): Promise<Payer> {
    const owners = await db.membership.findMany({
      where: { workspaceId, role: 'OWNER' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { userId: true, user: { select: { access: true } } },
    });
    const access = effectiveAccess(owners.map((o) => o.user.access as AccountAccess));
    if (access === 'INTERNAL' && testMode()) return { access, accountId: null, pool: null };
    if (access === 'INTERNAL') return { access, accountId: owners.find((o) => o.user.access === 'INTERNAL')?.userId ?? null, pool: null };
    if (access === 'PAID') return { access, accountId: owners.find((o) => o.user.access === 'PAID')!.userId, pool: 'CREDITS' };
    return { access, accountId: owners[0]?.userId ?? null, pool: 'SAMPLE' };
  }

  // ───────── livro-razão ─────────

  /**
   * §4.2: 1 lançamento. Chave já usada = devolve o existente (sem mexer no saldo). delta < 0 sem saldo = 402
   * INSUFFICIENT_CREDITS (CAS: o UPDATE só acontece com saldo ≥ −delta). Rode dentro de transação.
   */
  async post(tx: Prisma.TransactionClient, e: {
    userId: string; pool: CreditPool; kind: 'GRANT' | 'RESERVE' | 'CHARGE' | 'REFUND' | 'MANUAL'; delta: number; amount: number; key: string;
    runId?: string | null; workspaceId?: string | null; byId?: string | null; note?: string | null;
  }) {
    const dup = await tx.creditEntry.findUnique({ where: { idempotencyKey: e.key } });
    if (dup) return { entry: dup, balance: dup.balanceAfter, duplicate: true };
    const col = e.pool === 'CREDITS' ? 'creditBalance' : 'sampleUses';
    if (e.delta !== 0) {
      const where: Prisma.UserWhereInput = { id: e.userId, ...(e.delta < 0 && { [col]: { gte: -e.delta } }) };
      const r = await tx.user.updateMany({ where, data: { [col]: { increment: e.delta } } });
      if (r.count !== 1) {
        const u = await tx.user.findUnique({ where: { id: e.userId }, select: { creditBalance: true, sampleUses: true } });
        if (!u) throw new AppException('NOT_FOUND');
        throw new AppException('INSUFFICIENT_CREDITS', { need: -e.delta, balance: e.pool === 'CREDITS' ? u.creditBalance : u.sampleUses, pool: e.pool });
      }
    }
    const u = await tx.user.findUniqueOrThrow({ where: { id: e.userId }, select: { creditBalance: true, sampleUses: true } });
    const balance = e.pool === 'CREDITS' ? u.creditBalance : u.sampleUses;
    const entry = await tx.creditEntry.create({
      data: {
        userId: e.userId, pool: e.pool, kind: e.kind, delta: e.delta, amount: e.amount, balanceAfter: balance, idempotencyKey: e.key,
        templateRunId: e.runId ?? null, workspaceId: e.workspaceId ?? null, byId: e.byId ?? null, note: e.note ?? null,
      },
    });
    return { entry, balance, duplicate: false };
  }

  /**
   * §5: os 4 usos da amostra, 1 vez por conta (chave `sample-grant:<userId>`). 0 se a conta já gastou a amostra antiga, não
   * é modo OWN (P4) ou herdou pela conta de anúncio (§6 do amostra-gratis-v1).
   */
  async ensureSampleGrant(userId: string, workspaceId: string): Promise<void> {
    const key = ledgerKey.sampleGrant(userId);
    if (await this.prisma.creditEntry.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { access: true, sampleUsedAt: true, accountMode: true } });
    if (!u || u.access !== 'SAMPLE') return;
    const inherited = u.sampleUsedAt ? true : !!(await this.amostra.inheritedSampleAt(userId, workspaceId));
    const uses = inherited || u.accountMode !== 'OWN' ? 0 : sampleTemplateUses();
    const note = inherited ? 'sample_already_used' : u.accountMode !== 'OWN' ? 'not_own_mode' : 'free_sample';
    await this.prisma.$transaction((tx) => this.post(tx, { userId, pool: 'SAMPLE', kind: 'GRANT', delta: uses, amount: uses, key, workspaceId, note }))
      .catch((e) => { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; }); // corrida: outro pedido concedeu
  }

  // ───────── leitura ─────────

  /** `GET /credits` (§7). */
  async summary(auth: AuthContext): Promise<CreditsSummary> {
    const payer = await this.payerOf(auth.workspaceId);
    if (payer.pool === 'SAMPLE' && payer.accountId) await this.ensureSampleGrant(payer.accountId, auth.workspaceId);
    const u = payer.accountId ? await this.prisma.user.findUnique({ where: { id: payer.accountId }, select: { creditBalance: true, sampleUses: true } }) : null;
    const held = payer.accountId && payer.pool
      ? (await this.prisma.templateRun.aggregate({ where: { accountId: payer.accountId, pool: payer.pool, status: 'RESERVED' }, _sum: { held: true } }))._sum.held ?? 0
      : 0;
    const total = payer.pool === 'SAMPLE' && payer.accountId
      ? (await this.prisma.creditEntry.findUnique({ where: { idempotencyKey: ledgerKey.sampleGrant(payer.accountId) }, select: { amount: true } }))?.amount ?? 0
      : 0;
    return {
      unlimited: payer.pool === null, access: payer.access, pool: payer.pool,
      balance: payer.pool === null ? null : payer.pool === 'CREDITS' ? u?.creditBalance ?? 0 : u?.sampleUses ?? 0,
      credits: u?.creditBalance ?? 0,
      sample: payer.pool === 'SAMPLE' ? { left: u?.sampleUses ?? 0, total } : null,
      held, checkoutUrl: null, contactEmail: process.env.CREDITS_CONTACT_EMAIL?.trim() || null,
    };
  }

  /** Saldo do pool em uso (null = ilimitado). */
  async balanceOf(payer: Payer, db: Db = this.prisma): Promise<number | null> {
    if (!payer.pool || !payer.accountId) return payer.pool ? 0 : null;
    const u = await db.user.findUnique({ where: { id: payer.accountId }, select: { creditBalance: true, sampleUses: true } });
    return payer.pool === 'CREDITS' ? u?.creditBalance ?? 0 : u?.sampleUses ?? 0;
  }

  /** `GET /credits/ledger`: lançamentos da conta que paga este workspace, do mais novo pro mais velho (cursor = id). */
  async ledger(auth: AuthContext, cursor?: string, limit = 50): Promise<{ items: CreditEntryView[]; nextCursor: string | null }> {
    const payer = await this.payerOf(auth.workspaceId);
    if (!payer.accountId) return { items: [], nextCursor: null };
    const take = Math.min(LEDGER_MAX, Math.max(1, limit));
    const rows = await this.prisma.creditEntry.findMany({
      where: { userId: payer.accountId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { by: { select: { id: true, name: true } }, templateRun: { select: { id: true, batchId: true, template: { select: { slug: true, nameEn: true, namePt: true } } } } },
    });
    const locale = await this.localeOf(auth.userId);
    return {
      items: rows.slice(0, take).map((r) => ({
        id: r.id, kind: r.kind, pool: r.pool, delta: r.delta, amount: r.amount, balanceAfter: r.balanceAfter, note: r.note, createdAt: r.createdAt.toISOString(),
        run: r.templateRun ? { id: r.templateRun.id, batchId: r.templateRun.batchId, templateSlug: r.templateRun.template.slug, templateName: locale === 'PT_BR' ? r.templateRun.template.namePt : r.templateRun.template.nameEn } : null,
        by: r.by ? { id: r.by.id, name: r.by.name } : null,
      })),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
    };
  }

  /** `GET /templates/runs`: histórico de usos do workspace. */
  async runs(auth: AuthContext, cursor?: string, limit = 50): Promise<{ items: TemplateRunRef[]; nextCursor: string | null }> {
    const take = Math.min(LEDGER_MAX, Math.max(1, limit));
    const rows = await this.prisma.templateRun.findMany({
      where: { workspaceId: auth.workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { template: { select: { slug: true, nameEn: true, namePt: true, pack: true, internalKey: true } }, batch: { select: { settings: true, champion: { select: { name: true } } } } },
    });
    const locale = await this.localeOf(auth.userId);
    return {
      items: rows.slice(0, take).map((r) => ({
        id: r.id, batchId: r.batchId, templateSlug: r.template.slug, templateName: locale === 'PT_BR' ? r.template.namePt : r.template.nameEn, pack: r.template.pack,
        status: r.status, held: r.held, charged: r.charged, refunded: r.refunded, pool: r.pool, championName: r.batch.champion.name,
        createdAt: r.createdAt.toISOString(), settledAt: r.settledAt?.toISOString() ?? null,
        // templates-multi-v1 §3.5: "Sua seleção · N templates"
        selection: isSelectionRow(r.template) ? { slugs: templateSettingsOf(r.batch.settings)?.slugs ?? [] } : null,
      })),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
    };
  }

  private async localeOf(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { uiLocale: true } }))?.uiLocale ?? 'EN';
  }

  // ───────── linhas e quote ─────────

  /** Linhas do lote a partir das peças marcadas (agrupadas pelo template; §2). */
  async linesOf(batchId: string, db: Db = this.prisma): Promise<RunLine[]> {
    const run = await db.templateRun.findUnique({ where: { batchId }, include: { template: true } });
    if (!run) return [];
    const items = await db.variationItem.findMany({ where: { batchId, kind: 'AUTO_EDIT', included: true }, orderBy: { index: 'asc' }, select: { id: true, autoType: true, payload: true } });
    const keyOf = (i: (typeof items)[number]) => lineKeyOf(i.autoType, lineSubIdOf(i.payload));
    const keys = [...new Set(items.map(keyOf))];
    // pack e seleção (templates-multi-v1): cada peça acha o seu template no catálogo pela chave
    const byCatalog = run.template.pack || isSelectionRow(run.template);
    const catalog = byCatalog
      ? await db.template.findMany({ where: { internalKey: { in: keys } } })
      : [run.template];
    const lines: RunLine[] = [];
    for (const k of keys) {
      // template único: todas as peças são do template (a chave da peça pode diferir, ex.: STATIC); pack/seleção: pelo catálogo
      const t = byCatalog ? catalog.find((c) => c.internalKey === k) : run.template;
      if (!t) continue;
      const line = lines.find((l) => l.templateId === t.id);
      const ids = items.filter((i) => keyOf(i) === k).map((i) => i.id);
      if (line) line.itemIds.push(...ids);
      else lines.push({ key: t.internalKey, templateId: t.id, slug: t.slug, tier: t.tier, credits: t.credits ?? 0, itemIds: ids, state: 'held', delivered: null });
    }
    return lines;
  }

  /**
   * Seleção em DRAFT: linhas cujas peças estão todas desmarcadas (`included: false`), achadas no catálogo pela chave como no
   * linesOf, com `itemIds: []` (= `pieces: 0`). Só pra mostrar nome e crédito; nunca entram no quote nem na reserva.
   */
  private async unpickedLines(batchId: string, picked: readonly RunLine[]): Promise<RunLine[]> {
    const items = await this.prisma.variationItem.findMany({ where: { batchId, kind: 'AUTO_EDIT', included: false }, orderBy: { index: 'asc' }, select: { autoType: true, payload: true } });
    const keys = [...new Set(items.map((i) => lineKeyOf(i.autoType, lineSubIdOf(i.payload))))];
    if (!keys.length) return [];
    const catalog = await this.prisma.template.findMany({ where: { internalKey: { in: keys } } });
    const out: RunLine[] = [];
    for (const k of keys) {
      const t = catalog.find((c) => c.internalKey === k);
      if (!t || picked.some((l) => l.templateId === t.id) || out.some((l) => l.templateId === t.id)) continue;
      out.push({ key: t.internalKey, templateId: t.id, slug: t.slug, tier: t.tier, credits: t.credits ?? 0, itemIds: [], state: 'held', delivered: null });
    }
    return out;
  }

  /** `IterateBatch.template` (sem `texts` e `fit`, que o iteracao completa). null = lote que não é de template. */
  async runView(batch: { id: string; workspaceId: string; status: string }, uiLocale: string): Promise<Omit<IterateTemplateRun, 'texts' | 'fit'> | null> {
    const run = await this.prisma.templateRun.findUnique({ where: { batchId: batch.id }, include: { template: true } });
    if (!run) return null;
    const draft = run.status === 'DRAFT';
    const lines = draft ? await this.linesOf(batch.id) : ((run.lines ?? []) as unknown as RunLine[]);
    // templates-multi-v1 §3.4 (04/11): no plano da seleção a linha desmarcada continua na lista (pieces 0, fora do quote)
    const shown = draft && isSelectionRow(run.template) ? [...lines, ...(await this.unpickedLines(batch.id, lines))] : lines;
    const names = new Map((await this.prisma.template.findMany({ where: { id: { in: shown.map((l) => l.templateId) } }, select: { id: true, nameEn: true, namePt: true } }))
      .map((t) => [t.id, uiLocale === 'PT_BR' ? t.namePt : t.nameEn]));
    const payer = await this.payerOf(batch.workspaceId);
    const balance = await this.balanceOf(payer);
    const quote = draft ? quoteOf(lines, run.cap) : 0;
    const view: RunLineView[] = shown.map((l) => ({
      key: l.key, slug: l.slug, name: names.get(l.templateId) ?? l.slug, tier: l.tier, credits: l.credits, pieces: l.itemIds.length,
      state: draft ? 'planned' : l.state, delivered: l.delivered,
    }));
    return {
      runId: run.id, slug: run.template.slug, name: uiLocale === 'PT_BR' ? run.template.namePt : run.template.nameEn, pack: run.template.pack, tier: run.template.tier,
      status: run.status, cap: run.cap, lines: view, quote, balance, after: balance == null ? null : balance - quote,
      enough: balance == null || balance >= quote, pool: payer.pool, held: run.held, charged: run.charged, refunded: run.refunded,
      selection: isSelectionRow(run.template) ? await this.selectionView(batch.id, uiLocale) : null,
    };
  }

  /**
   * templates-multi-v1 §3.4: os marcados e os que ficaram de fora (fit `hard` no Reading ou `not_planned`). Peça desmarcada
   * na tela do plano não é "ficar de fora": conta qualquer peça do lote, marcada ou não.
   */
  private async selectionView(batchId: string, uiLocale: string): Promise<TemplateSelectionView> {
    const b = await this.prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
    const tpl = templateSettingsOf(b?.settings);
    const slugs = tpl?.slugs ?? [];
    const items = await this.prisma.variationItem.findMany({ where: { batchId, kind: 'AUTO_EDIT' }, select: { autoType: true, payload: true } });
    const planned = new Set(items.map((i) => lineKeyOf(i.autoType, lineSubIdOf(i.payload))));
    const skipped = skippedOf({ slugs, keys: tpl?.keys ?? [], fits: tpl?.fits }, planned);
    const names = new Map((await this.prisma.template.findMany({ where: { slug: { in: skipped.map((x) => x.slug) } }, select: { slug: true, nameEn: true, namePt: true } }))
      .map((t) => [t.slug, uiLocale === 'PT_BR' ? t.namePt : t.nameEn]));
    return { slugs, skipped: skipped.map((x) => ({ slug: x.slug, name: names.get(x.slug) ?? x.slug, reason: x.reason })) };
  }

  // ───────── Gerar: reserva (chamado DENTRO da transação do POST /iterate/:id/start) ─────────

  /**
   * §4.3: lote de template = quote das linhas marcadas; ≠ expectedCredits = 409 CREDITS_CHANGED; amostra com Estático/IA =
   * 402 sample_tier; sem saldo = 402 INSUFFICIENT_CREDITS (rollback do start inteiro). Lote que não é de template = nada.
   */
  async reserveOnStart(tx: Prisma.TransactionClient, b: { id: string; workspaceId: string }, auth: AuthContext, expectedCredits: number | undefined): Promise<void> {
    const run = await tx.templateRun.findUnique({ where: { batchId: b.id } });
    if (!run) return;
    if (run.status !== 'DRAFT') throw new AppException('INVALID_STATE', { state: run.status, allowed: ['DRAFT'] });
    if (expectedCredits === undefined) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'expectedCredits', rule: 'required' }] });
    const lines = await this.linesOf(b.id, tx);
    const quote = quoteOf(lines, run.cap);
    if (quote !== expectedCredits) throw new AppException('CREDITS_CHANGED', { credits: quote });
    const payer = await this.payerOf(b.workspaceId, tx);
    if (payer.pool === 'SAMPLE' && lines.some((l) => l.tier !== 'EDIT')) throw new AppException('PAYMENT_REQUIRED', { reason: 'sample_tier', unlock: { pieces: 0 } });
    const attempt = run.attempt + 1;
    if (payer.pool) {
      if (!payer.accountId) throw new AppException('INSUFFICIENT_CREDITS', { need: quote, balance: 0, pool: payer.pool });
      await this.post(tx, { userId: payer.accountId, pool: payer.pool, kind: 'RESERVE', delta: -quote, amount: quote, key: ledgerKey.reserve(run.id, attempt), runId: run.id, workspaceId: b.workspaceId, byId: auth.userId });
      if (payer.pool === 'SAMPLE') await tx.user.updateMany({ where: { id: payer.accountId, sampleUsedAt: null }, data: { sampleUsedAt: new Date() } });
    }
    await tx.templateRun.update({
      where: { id: run.id },
      data: { status: 'RESERVED', lines: lines as unknown as Prisma.InputJsonValue, held: quote, attempt, pool: payer.pool, accountId: payer.accountId, reservedAt: new Date() },
    });
    await tx.template.updateMany({ where: { id: { in: [...new Set([run.templateId, ...lines.map((l) => l.templateId)])] } }, data: { uses: { increment: 1 } } });
  }

  // ───────── aprovação incremental das prévias (templates-ia-previas-v1 §7) ─────────

  /** Roda `fn` sob o lock do run (o mesmo do settleRun/beforeRetry). Lote sem TemplateRun = sem lock de run. */
  async withRunLock<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
    const run = await this.prisma.templateRun.findUnique({ where: { batchId }, select: { id: true } });
    return run ? this.locks.run(`template-run:${run.id}`, fn) : fn();
  }

  /**
   * Irmão do reserveOnStart, 1 vez por aprovação (DENTRO da transação do approve). Aceita run DRAFT/RESERVED/SETTLED;
   * acrescenta a linha `<internalKey>#<approvalIndex>` (held) com as peças aprovadas; quote = Template.credits × N
   * (≠ expectedCredits = 409 CREDITS_CHANGED); com pagador, RESERVE `run:<id>:reserve:<attempt+1>`. `uses + 1` só na 1ª.
   * A linha guarda o total (credits × N), como as linhas de IA de hoje (deliveredOf = parte das prontas).
   */
  async reserveOnApprove(tx: Prisma.TransactionClient, batchId: string, auth: AuthContext, o: { itemIds: string[]; expectedCredits: number; approvalIndex: number }): Promise<{ credits: number; attempt: number }> {
    const run = await tx.templateRun.findUnique({ where: { batchId }, include: { template: true } });
    if (!run) throw new AppException('INVALID_STATE', { state: 'NO_TEMPLATE_RUN', allowed: ['DRAFT', 'RESERVED', 'SETTLED'] });
    if (!['DRAFT', 'RESERVED', 'SETTLED'].includes(run.status)) throw new AppException('INVALID_STATE', { state: run.status, allowed: ['DRAFT', 'RESERVED', 'SETTLED'] });
    const payer = await this.payerOf(run.workspaceId, tx);
    if (payer.pool === 'SAMPLE' || (run.template.credits == null && payer.pool != null)) throw new AppException('PAYMENT_REQUIRED');
    const each = run.template.credits ?? 0;
    const quote = each * o.itemIds.length;
    if (quote !== o.expectedCredits) throw new AppException('CREDITS_CHANGED', { credits: quote });
    const attempt = run.attempt + 1;
    if (payer.pool && quote > 0) {
      if (!payer.accountId) throw new AppException('INSUFFICIENT_CREDITS', { need: quote, balance: 0, pool: payer.pool });
      await this.post(tx, { userId: payer.accountId, pool: payer.pool, kind: 'RESERVE', delta: -quote, amount: quote, key: ledgerKey.reserve(run.id, attempt), runId: run.id, workspaceId: run.workspaceId, byId: auth.userId, note: `approve#${o.approvalIndex}` });
    }
    const lines = [...((run.lines ?? []) as unknown as RunLine[]), {
      key: `${run.template.internalKey}#${o.approvalIndex}`, templateId: run.templateId, slug: run.template.slug, tier: run.template.tier,
      credits: quote, itemIds: o.itemIds, state: 'held' as const, delivered: null,
    }];
    const hit = await tx.templateRun.updateMany({
      where: { id: run.id, attempt: run.attempt },
      data: {
        status: 'RESERVED', lines: lines as unknown as Prisma.InputJsonValue, held: { increment: quote }, attempt, pool: payer.pool, accountId: payer.accountId,
        settledAt: null, ...(!run.reservedAt && { reservedAt: new Date() }),
      },
    });
    if (hit.count !== 1) throw new AppException('INVALID_STATE', { state: run.status, allowed: ['DRAFT', 'RESERVED', 'SETTLED'], reason: 'request_conflict' });
    if (run.status === 'DRAFT') await tx.template.update({ where: { id: run.templateId }, data: { uses: { increment: 1 } } });
    return { credits: quote, attempt };
  }

  // ───────── assentar (§4.3) ─────────

  @Interval('template-runs-settle', SETTLE_EVERY_MS)
  async sweep(): Promise<void> {
    if (process.env.BOOT_RECOVERY === 'off' && process.env.NODE_ENV === 'test') return; // int specs dividem o banco: cada um assenta o seu
    await this.settleAll().catch((e) => this.log.warn(`assentamento: ${(e as Error).message}`));
  }

  /** Assenta os lotes RESERVED lançados (opcional: só de um workspace, pros testes). Devolve quantos assentaram. */
  async settleAll(workspaceId?: string): Promise<number> {
    const runs = await this.prisma.templateRun.findMany({ where: { status: 'RESERVED', batch: { status: 'LAUNCHED' }, ...(workspaceId && { workspaceId }) }, select: { id: true }, take: 50 });
    let n = 0;
    for (const r of runs) if (await this.settleRun(r.id).catch((e) => { this.log.warn(`run ${r.id}: ${(e as Error).message}`); return false; })) n++;
    return n;
  }

  /** Assenta 1 lote se todas as peças terminaram: CHARGE (delta 0) + REFUND (+ o que não entregou). Idempotente. */
  async settleRun(runId: string): Promise<boolean> {
    return this.locks.run(`template-run:${runId}`, async () => {
      const run = await this.prisma.templateRun.findUnique({ where: { id: runId }, include: { batch: { select: { status: true } } } });
      if (!run || run.status !== 'RESERVED' || run.batch.status !== 'LAUNCHED') return false;
      const lines = (run.lines ?? []) as unknown as RunLine[];
      const statuses = await this.statusesOf(lines.flatMap((l) => l.itemIds));
      const s = settle({ cap: run.cap, held: run.held, charged: run.charged, lines }, (id) => statuses.get(id) ?? 'failed');
      if (!s) return false;
      await this.prisma.$transaction(async (tx) => {
        const hit = await tx.templateRun.updateMany({
          where: { id: run.id, status: 'RESERVED', attempt: run.attempt },
          data: { status: 'SETTLED', held: 0, charged: { increment: s.charge }, refunded: { increment: s.refund }, lines: s.lines as unknown as Prisma.InputJsonValue, settledAt: new Date() },
        });
        if (hit.count !== 1) return; // outro processo assentou ou um Retry reservou de novo
        if (run.pool && run.accountId) {
          const base = { userId: run.accountId, pool: run.pool, runId: run.id, workspaceId: run.workspaceId };
          if (s.charge > 0) await this.post(tx, { ...base, kind: 'CHARGE', delta: 0, amount: s.charge, key: ledgerKey.charge(run.id, run.attempt) });
          if (s.refund > 0) await this.post(tx, { ...base, kind: 'REFUND', delta: s.refund, amount: s.refund, key: ledgerKey.refund(run.id, run.attempt) });
        }
      }, { timeout: 30_000 });
      return true;
    });
  }

  /** Status derivado das peças (§3.2 do variacao-auto-v1), o mesmo da vista. */
  private async statusesOf(itemIds: string[]): Promise<Map<string, PieceStatus>> {
    const items = await this.prisma.variationItem.findMany({ where: { id: { in: itemIds } }, include: PIECE_INCLUDE });
    return new Map(items.map((i) => [i.id, pieceStatus({
      launched: true, leftOutAt: i.leftOutAt, creativeState: i.creative?.state ?? null,
      renders: (i.creative?.renders ?? []).map((r) => ({ format: r.format, status: r.status as 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED', createdAt: r.createdAt })),
    })]));
  }

  // ───────── Retry depois do estorno (A4) ─────────

  /**
   * Chamado pelo Retry da peça (antes de enfileirar). Lote de template já assentado cuja linha desta peça não entregou:
   * reserva de novo (402 sem saldo) e volta o lote pra RESERVED. Peça de linha que entregou, lote ainda rodando ou lote que
   * não é de template = grátis (nada a fazer).
   */
  async beforeRetry(workspaceId: string, batchId: string, itemId: string, userId: string): Promise<void> {
    const run0 = await this.prisma.templateRun.findUnique({ where: { batchId }, select: { id: true } });
    if (!run0) return;
    await this.locks.run(`template-run:${run0.id}`, () => this.prisma.$transaction(async (tx) => {
      const run = await tx.templateRun.findUniqueOrThrow({ where: { id: run0.id } });
      if (run.workspaceId !== workspaceId || run.status !== 'SETTLED') return;
      const lines = (run.lines ?? []) as unknown as RunLine[];
      const line = lines.find((l) => l.itemIds.includes(itemId));
      if (!line || line.state !== 'refunded') return;
      const need = retryNeed({ cap: run.cap, held: run.held, charged: run.charged, lines }, line.key);
      const attempt = run.attempt + 1;
      if (need > 0 && run.pool) {
        if (!run.accountId) throw new AppException('INSUFFICIENT_CREDITS', { need, balance: 0, pool: run.pool });
        await this.post(tx, { userId: run.accountId, pool: run.pool, kind: 'RESERVE', delta: -need, amount: need, key: ledgerKey.reserve(run.id, attempt), runId: run.id, workspaceId, byId: userId, note: 'retry' });
      }
      const next = lines.map((l) => (l.key === line.key ? { ...l, state: 'held' as const, delivered: null } : l));
      await tx.templateRun.update({ where: { id: run.id }, data: { status: 'RESERVED', held: { increment: run.pool ? need : 0 }, attempt, lines: next as unknown as Prisma.InputJsonValue, settledAt: null } });
    }, { timeout: 30_000 }));
  }

  // ───────── admin (§7) ─────────

  /** Só usuário INTERNAL que é OWNER do workspace ativo (o mesmo critério do `PATCH /admin/users/:id/access`). */
  async assertStaff(auth: AuthContext): Promise<void> {
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { access: true } });
    // 04/11 (Gusta): no modo teste o admin vale pra qualquer OWNER. Desligar TEST_MODE no lançamento (docs/backlog.md).
    if (auth.role !== 'OWNER' || (!testMode() && me?.access !== 'INTERNAL')) throw new AppException('FORBIDDEN');
  }

  /** `POST /admin/credits/grant`: credita (> 0) ou debita (< 0, nunca abaixo de 0 = 409) a conta. Idempotente pela chave. */
  async grant(auth: AuthContext, body: GrantCreditsBody): Promise<GrantCreditsResponse> {
    await this.assertStaff(auth);
    const u = body.userId
      ? await this.prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } })
      : await this.prisma.user.findUnique({ where: { email: (body.email ?? '').trim().toLowerCase() }, select: { id: true } });
    if (!u) throw new AppException('NOT_FOUND');
    const key = ledgerKey.manual(body.idempotencyKey);
    const r = await this.prisma.$transaction((tx) => this.post(tx, {
      userId: u.id, pool: 'CREDITS', kind: 'MANUAL', delta: body.credits, amount: Math.abs(body.credits), key, byId: auth.userId, note: body.note?.trim() || null,
    })).catch(async (e) => {
      // Concurrent requests can both miss the first lookup. The loser rolls back on the unique
      // key (or insufficient balance after the first debit); return the committed entry.
      if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
          (e instanceof AppException && e.code === 'INSUFFICIENT_CREDITS')) {
        const entry = await this.prisma.creditEntry.findUnique({ where: { idempotencyKey: key } });
        if (entry) return { entry, balance: entry.balanceAfter, duplicate: true };
      }
      // débito maior que o saldo: 409 pro admin (pro cliente o mesmo código é 402)
      if (e instanceof AppException && e.code === 'INSUFFICIENT_CREDITS') throw new AppException('INVALID_STATE', { state: 'insufficient_balance', allowed: [], ...(e.details ?? {}) });
      throw e;
    });
    if (r.entry.userId !== u.id) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'idempotencyKey', rule: 'used_for_another_account' }] });
    const by = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { id: true, name: true } });
    return {
      entry: {
        id: r.entry.id, kind: r.entry.kind, pool: r.entry.pool, delta: r.entry.delta, amount: r.entry.amount, balanceAfter: r.entry.balanceAfter, note: r.entry.note,
        createdAt: r.entry.createdAt.toISOString(), run: null, by,
      },
      balance: (await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { creditBalance: true } })).creditBalance,
    };
  }
}
