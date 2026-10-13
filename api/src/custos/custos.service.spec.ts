import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { CustosService, monthRange } from './custos.service';

function svc(spent: number, cap: number | null, openUsd: number | null = null) {
  const prisma = {
    costEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountUsd: new Prisma.Decimal(spent) } }) },
    providerTask: { aggregate: jest.fn().mockResolvedValue({ _sum: { estimatedUsd: openUsd == null ? null : new Prisma.Decimal(openUsd) } }) },
    workspace: { findUnique: jest.fn().mockResolvedValue({ monthlySpendCapUsd: cap == null ? null : new Prisma.Decimal(cap) }) },
  } as any;
  return { s: new CustosService(prisma), prisma };
}

describe('CustosService (teto de gasto)', () => {
  it('mês UTC', () => {
    const r = monthRange(new Date('2026-10-31T23:30:00-03:00')); // já é 01/11 em UTC
    expect(r.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('gasto + estimativa ≤ teto passa; acima → SPEND_CAP_EXCEEDED com detalhes', async () => {
    await expect(svc(150, 200).s.assertWithinCap('w', 50)).resolves.toBeUndefined();
    const err = await svc(150, 200).s.assertWithinCap('w', 50.01).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('SPEND_CAP_EXCEEDED');
    expect(err.details).toEqual({ spentUsd: 150, capUsd: 200, estimateUsd: 50.01 });
  });

  it('sem teto (null) nunca bloqueia; o gasto do mês filtra pelo workspace e pelo mês', async () => {
    const { s, prisma } = svc(1e6, null);
    await expect(s.assertWithinCap('w', 1e6)).resolves.toBeUndefined();
    expect(prisma.costEntry.aggregate.mock.calls[0][0].where).toMatchObject({ workspaceId: 'w', createdAt: { gte: expect.any(Date), lt: expect.any(Date) } });
  });

  it('teto já estourado bloqueia até estimativa zero', async () => {
    const err = await svc(5, 0.0001).s.assertWithinCap('w', 0).catch((e) => e);
    expect(err.code).toBe('SPEND_CAP_EXCEEDED');
  });

  it('task paga ainda aberta no provedor conta no gasto do mês pela estimativa (lipsync em voo não sai de graça)', async () => {
    // 06/10: 15 lipsyncs live SUBMITTED (US$ 1,625 cobrados pela WaveSpeed) e zero em cost_entries
    const { s, prisma } = svc(10, 11, 1.625);
    expect(await s.monthSpent('w')).toBe(11.625);
    const err = await s.assertWithinCap('w', 0).catch((e) => e);
    expect(err.code).toBe('SPEND_CAP_EXCEEDED');
    expect(err.details.spentUsd).toBe(11.625);
    const where = prisma.providerTask.aggregate.mock.calls[0][0].where;
    expect(where).toMatchObject({ workspaceId: 'w', status: 'SUBMITTED', costEntry: null, NOT: { externalId: { startsWith: 'mock_' } } });
    expect(where.submittedAt).toEqual({ gte: expect.any(Date), lt: expect.any(Date) });
  });

  it('sem task aberta, o gasto é só o gravado', async () => {
    expect(await svc(3.5, null).s.monthSpent('w')).toBe(3.5);
  });
});
