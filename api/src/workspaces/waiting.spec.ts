import { waitingOnYou } from './waiting';

describe('waitingOnYou (uma função pra Home e Clients)', () => {
  it('2 groupBy pra N workspaces (sem N+1) e soma creatives + batches', async () => {
    const db = {
      creative: { groupBy: jest.fn().mockResolvedValue([{ workspaceId: 'a', _count: { _all: 2 } }]) },
      variationBatch: { groupBy: jest.fn().mockResolvedValue([{ workspaceId: 'a', _count: { _all: 1 } }, { workspaceId: 'b', _count: { _all: 4 } }]) },
    };
    const ids = Array.from({ length: 50 }, (_, i) => `w${i}`).concat(['a', 'b']);
    const m = await waitingOnYou(db as never, ids);
    expect(db.creative.groupBy).toHaveBeenCalledTimes(1);
    expect(db.variationBatch.groupBy).toHaveBeenCalledTimes(1);
    expect(m.get('a')).toEqual({ creatives: 2, batches: 1, total: 3 });
    expect(m.get('b')).toEqual({ creatives: 0, batches: 4, total: 4 });
    expect(m.get('w0')).toEqual({ creatives: 0, batches: 0, total: 0 });
    // lote: só PLAN_READY/PLAN_FAILED de campeão não arquivado
    const where = JSON.stringify(db.variationBatch.groupBy.mock.calls[0][0].where);
    expect(where).toContain('PLAN_READY');
    expect(where).toContain('PLAN_FAILED');
    expect(where).toContain('"archivedAt":null');
    // variacao-auto-v1 §5.4: lote AUTO conta em ANALYSIS_FAILED e LAUNCHED assentado sem download
    expect(where).toContain('ANALYSIS_FAILED');
    expect(where).toContain('"downloadedAt":null');
  });
  it('lista vazia: nenhuma query', async () => {
    const db = { creative: { groupBy: jest.fn() }, variationBatch: { groupBy: jest.fn() } };
    expect((await waitingOnYou(db as never, [])).size).toBe(0);
    expect(db.creative.groupBy).not.toHaveBeenCalled();
  });
});
