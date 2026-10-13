// Bug 06/10 (QA, testes/CASOS.md): lote SWAP_AVATAR apagado antes do plano terminar → variationCasting.create lança P2003
// dentro do callback do planVariations, ninguém pega, e o Node sai (API inteira fora do ar). Aqui: o erro vira item
// FAILED, o job fecha, e NENHUMA rejeição fica sem dono. Integrações e banco em mock.
import { Prisma } from '@prisma/client';
import { JobsService } from './jobs.service';
import { VariacoesService } from '../variacoes/variacoes.service';

const p2003 = () =>
  new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated: `variation_castings_batch_id_fkey (index)`', {
    code: 'P2003', clientVersion: 'test',
  });

/** Escuta rejeições sem dono durante o teste (o que derrubava o processo). */
function watchUnhandled() {
  const seen: unknown[] = [];
  const onRejection = (r: unknown) => seen.push(r);
  process.on('unhandledRejection', onRejection);
  return { seen, stop: () => process.off('unhandledRejection', onRejection) };
}
const ticks = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function jobsWith(prisma: any) {
  return new JobsService(prisma, { emit: jest.fn() } as any, { publish: jest.fn() } as any);
}

describe('trabalho em segundo plano nunca derruba o processo', () => {
  it('detach: erro no job vira log + job FAILED (se aberto) e a promise resolve', async () => {
    const prisma = {
      job: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'j1', type: 'VARIATIONS_PLAN', status: 'FAILED', stage: null, progress: 0, etaSec: 0, errorCode: 'PROVIDER_ERROR', failReason: 'x', output: null, creativeId: null }),
      },
    };
    const jobs = jobsWith(prisma);
    const w = watchUnhandled();
    try {
      await expect(jobs.detach('j1', 'teste', async () => { throw p2003(); })).resolves.toBeUndefined();
      await ticks();
    } finally {
      w.stop();
    }
    expect(w.seen).toEqual([]);
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: 'j1', status: { in: ['QUEUED', 'RUNNING'] } },
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' }),
    });
  });

  it('detach: até o banco fora do ar ao marcar FAILED fica contido', async () => {
    const prisma = { job: { updateMany: jest.fn().mockRejectedValue(new Error('db down')) } };
    const jobs = jobsWith(prisma);
    const w = watchUnhandled();
    try {
      await expect(jobs.detach('j1', 'teste', async () => { throw new Error('boom'); })).resolves.toBeUndefined();
      await expect(jobs.detach(null, 'sem job', async () => { throw new Error('boom'); })).resolves.toBeUndefined();
      await jobs.idle();
      await ticks();
    } finally {
      w.stop();
    }
    expect(w.seen).toEqual([]);
  });

  it('plano do lote: lote apagado no meio (P2003 no elenco do SWAP_AVATAR) → item FAILED, job fechado, sem rejeição solta', async () => {
    const item = { id: 'i1', workspaceId: 'w', batchId: 'b1', kind: 'SWAP_AVATAR', index: 0, status: 'WRITING', castingId: null, isControl: false };
    const prisma: any = {
      variationBatch: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'b1', workspaceId: 'w', language: 'pt-BR', notes: null, teardownSnapshot: { sections: {}, words: [] }, offer: {} }),
        findUnique: jest.fn().mockResolvedValue(null), // o lote sumiu
      },
      variationItem: {
        findMany: jest.fn()
          .mockResolvedValueOnce([item]) // WRITING
          .mockResolvedValueOnce([]) // outros READY
          .mockResolvedValue([{ status: 'FAILED', errorCode: 'PROVIDER_ERROR' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      variationCasting: { create: jest.fn().mockRejectedValue(p2003()), updateMany: jest.fn() },
    };
    const jobs = { stage: jest.fn().mockResolvedValue(undefined), finish: jest.fn().mockResolvedValue(undefined) };
    const claude = {
      // devolve o item e SEGUE rodando um pouco: é nessa janela que a rejeição ficava sem dono
      planVariations: jest.fn(async (_input: unknown, cb: any) => {
        cb.onItemDone('SWAP_AVATAR', 0, { lever: 'avatar', rationale: 'r', castingDescription: 'mulher 30 anos' });
        await ticks();
      }),
    };
    const svc = new VariacoesService(
      prisma, {} as any, {} as any, {} as any, { transition: jest.fn() } as any, {} as any, jobs as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, claude as any, {} as any, {} as any,
    );
    const w = watchUnhandled();
    try {
      await expect(svc.runPlan('j1', 'b1')).resolves.toBeUndefined();
      await ticks();
    } finally {
      w.stop();
    }
    expect(w.seen).toEqual([]);
    expect(prisma.variationCasting.create).toHaveBeenCalled();
    expect(prisma.variationItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', status: 'WRITING' },
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' }),
    });
    expect(jobs.finish).toHaveBeenCalledWith('j1', expect.objectContaining({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' }));
  });
});
