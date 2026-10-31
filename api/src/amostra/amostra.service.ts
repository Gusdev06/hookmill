// Amostra grátis (amostra-gratis-v1): acesso efetivo do workspace, admissão do POST /iterate (com o antiabuso do §6),
// travas 402 PAYMENT_REQUIRED das rotas que entregam o arquivo e a liberação manual do admin (§5, P2 sem gateway).
import { Injectable } from '@nestjs/common';
import type { AccountAccess, AccountMode, PaymentRequiredDetails } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { admitIterate, effectiveAccess, isLocked, isUnlocked, type IterateAdmission } from './acesso';

/** Filtro Prisma do lote da amostra (`settings.sample = true`). */
export const SAMPLE_BATCH: Prisma.VariationBatchWhereInput = { settings: { path: ['sample'], equals: true } };

export const paymentRequired = (details: PaymentRequiredDetails) => new AppException('PAYMENT_REQUIRED', details as unknown as Record<string, unknown>);

@Injectable()
export class AmostraService {
  constructor(private readonly prisma: PrismaService) {}

  /** P1: acesso efetivo = o dos OWNERs do workspace (função pura `effectiveAccess`). */
  async workspaceAccess(workspaceId: string, db: Prisma.TransactionClient = this.prisma): Promise<AccountAccess> {
    const owners = await db.membership.findMany({ where: { workspaceId, role: 'OWNER' }, select: { user: { select: { access: true } } } });
    return effectiveAccess(owners.map((o) => o.user.access as AccountAccess));
  }

  /** Lote travado? `pieces` = peças incluídas (o `unlock.pieces` do 402). */
  async batchLock(batch: { id: string; workspaceId: string; settings: unknown }): Promise<{ locked: boolean; pieces: number }> {
    if (!isLocked(batch.settings, 'SAMPLE')) return { locked: false, pieces: 0 }; // não é amostra: nem consulta o acesso
    const access = await this.workspaceAccess(batch.workspaceId);
    if (isUnlocked(access)) return { locked: false, pieces: 0 };
    const pieces = await this.prisma.variationItem.count({ where: { batchId: batch.id, kind: 'AUTO_EDIT', included: true } });
    return { locked: true, pieces };
  }

  /** 402 `locked` se o lote (do workspace do token) é a amostra sem plano. Lote inexistente = deixa a rota dar o 404 dela. */
  async assertBatchUnlocked(workspaceId: string, batchId: string): Promise<void> {
    const b = await this.prisma.variationBatch.findFirst({ where: { id: batchId, workspaceId }, select: { id: true, workspaceId: true, settings: true } });
    if (!b) return;
    const l = await this.batchLock(b);
    if (l.locked) throw paymentRequired({ reason: 'locked', unlock: { pieces: l.pieces } });
  }

  /** Peça (VariationItem) de lote travado = 402. */
  async assertItemUnlocked(workspaceId: string, itemId: string): Promise<void> {
    const i = await this.prisma.variationItem.findFirst({ where: { id: itemId, workspaceId }, select: { batchId: true } });
    if (i) await this.assertBatchUnlocked(workspaceId, i.batchId);
  }

  /** Criativo nascido de um lote travado (editor, publicar no Meta, download, detalhe) = 402. */
  async assertCreativeUnlocked(workspaceId: string, creativeId: string): Promise<void> {
    const c = await this.prisma.creative.findFirst({ where: { id: creativeId, workspaceId }, select: { variationBatchId: true } });
    if (c?.variationBatchId) await this.assertBatchUnlocked(workspaceId, c.variationBatchId);
  }

  /** Campeão com lote da amostra (o "Novo lote" a partir dele) = 402 enquanto travado. */
  async assertChampionUnlocked(workspaceId: string, championId: string): Promise<void> {
    const b = await this.prisma.variationBatch.findFirst({ where: { championId, workspaceId, ...SAMPLE_BATCH }, select: { id: true, workspaceId: true, settings: true } });
    if (!b) return;
    const l = await this.batchLock(b);
    if (l.locked) throw paymentRequired({ reason: 'locked', unlock: { pieces: l.pieces } });
  }

  /** `GET /files/:id`: arquivo final de render de criativo travado = 402 (a prévia é outro arquivo e continua saindo). */
  async assertFileUnlocked(workspaceId: string, fileId: string): Promise<void> {
    const r = await this.prisma.render.findFirst({ where: { fileId, workspaceId }, select: { creativeId: true } });
    if (r) await this.assertCreativeUnlocked(workspaceId, r.creativeId);
  }

  /** Filtro da Library: sem os criativos de lote travado (o arquivo original não sai por URL assinada). */
  async libraryFilter(workspaceId: string): Promise<Prisma.CreativeWhereInput> {
    return isUnlocked(await this.workspaceAccess(workspaceId)) ? {} : { NOT: { variationBatch: { is: SAMPLE_BATCH } } };
  }

  /**
   * Admissão do `POST /iterate` (§2, §6, P4). `championId` de um lote travado = 402 `locked`. Antiabuso: se outra conta
   * já fez a amostra com a mesma conta de anúncio do Meta conectada aqui, esta herda o `sampleUsedAt` (e leva 402).
   */
  async admit(auth: AuthContext, championId?: string): Promise<IterateAdmission> {
    const access = await this.workspaceAccess(auth.workspaceId);
    if (isUnlocked(access)) return { kind: 'normal' };
    if (championId) await this.assertChampionUnlocked(auth.workspaceId, championId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { sampleUsedAt: true, accountMode: true } });
    let sampleUsed = !!user.sampleUsedAt;
    if (!sampleUsed) {
      const inherited = await this.sampleOfSameAdAccount(auth);
      if (inherited) {
        await this.prisma.user.updateMany({ where: { id: auth.userId, sampleUsedAt: null }, data: { sampleUsedAt: inherited } });
        sampleUsed = true;
      }
    }
    return admitIterate({ access, sampleUsed, accountMode: (user.accountMode as AccountMode | null) ?? null });
  }

  /** §6: data da amostra feita por OUTRA conta com a mesma `adAccountId` do Meta deste workspace; null = nenhuma. */
  private async sampleOfSameAdAccount(auth: AuthContext): Promise<Date | null> {
    const conn = await this.prisma.metaConnection.findUnique({ where: { workspaceId: auth.workspaceId }, select: { adAccountId: true } });
    if (!conn?.adAccountId) return null;
    const b = await this.prisma.variationBatch.findFirst({
      where: { ...SAMPLE_BATCH, createdById: { not: auth.userId }, workspace: { metaConnection: { is: { adAccountId: conn.adAccountId } } } },
      orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    });
    return b?.createdAt ?? null;
  }

  /** Dentro da transação que cria o lote: grava `sampleUsedAt` (CAS). Já gasto por outra requisição = 402 `sample_used`. */
  async claim(tx: Prisma.TransactionClient, userId: string, at: Date): Promise<void> {
    const r = await tx.user.updateMany({ where: { id: userId, sampleUsedAt: null }, data: { sampleUsedAt: at } });
    if (r.count !== 1) throw paymentRequired({ reason: 'sample_used', unlock: { pieces: 0 } });
  }

  /** `PATCH /admin/users/:id/access` (§5): só INTERNAL que seja OWNER do workspace ativo. Nada renderiza de novo. */
  async updateAccess(auth: AuthContext, userId: string, access: AccountAccess): Promise<{ id: string; access: AccountAccess }> {
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { access: true } });
    if (auth.role !== 'OWNER' || me?.access !== 'INTERNAL') throw new AppException('FORBIDDEN');
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new AppException('NOT_FOUND');
    const r = await this.prisma.user.update({ where: { id: userId }, data: { access }, select: { id: true, access: true } });
    return { id: r.id, access: r.access as AccountAccess };
  }
}
