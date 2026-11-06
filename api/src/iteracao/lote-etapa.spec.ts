import { batchNeedsYou, batchStageOf, batchStatusOf, piecesPublished, SENT_PUBLICATION_WHERE } from './lote-etapa';

const b = (over: Partial<Parameters<typeof batchStageOf>[0]> = {}) => batchStageOf({ status: 'LAUNCHED', mode: 'AUTO', pieces: 2, rendering: false, downloadedAt: null, published: false, ...over });

describe('etapa do lote (lacunas-home-eddy-v1 §3.2)', () => {
  it('deriva igual ao WAITING_BATCH_WHERE', () => {
    expect(b({ status: 'ANALYZING' })).toBe('analyzing');
    expect(b({ status: 'PLANNING' })).toBe('planning');
    expect(b({ status: 'PLAN_READY' })).toBe('plan_ready');
    expect(b({ status: 'PLAN_FAILED' })).toBe('failed');
    expect(b({ status: 'ANALYSIS_FAILED' })).toBe('failed');
    expect(b({ rendering: true })).toBe('generating');
    expect(b()).toBe('pieces_ready');
    expect(b({ downloadedAt: new Date() })).toBe('done');
    expect(b({ pieces: 0 })).toBe('done');
    // 04/11: todas as peças prontas enviadas pra Meta = sai do "Waiting for you" mesmo sem baixar
    expect(b({ published: true })).toBe('done');
    expect(b({ published: true, rendering: true })).toBe('generating');
    expect(b({ mode: 'MANUAL' })).toBe('done');
    expect(['plan_ready', 'failed', 'pieces_ready'].every((s) => batchNeedsYou(s as never))).toBe(true);
    expect(batchNeedsYou('generating')).toBe(false);
  });
  it('piecesPublished: ≥ 1 pronta e todas com publicação ≠ FAILED (peça com falha não bloqueia)', () => {
    const sent = { state: 'APPROVED', metaPublications: [{ id: 'p' }] };
    const unsent = { state: 'APPROVED', metaPublications: [] };
    const failed = { state: 'RENDER_FAILED', metaPublications: [] };
    expect(piecesPublished([sent, failed])).toBe(true);
    expect(piecesPublished([sent, unsent])).toBe(false);
    expect(piecesPublished([failed])).toBe(false);
    expect(piecesPublished([])).toBe(false);
    expect(JSON.stringify(SENT_PUBLICATION_WHERE)).toBe('{"status":{"not":"FAILED"}}');
  });
  it('chave do chip no namespace status, com n só no pieces_ready', () => {
    expect(batchStatusOf('pieces_ready', 3)).toEqual({ key: 'status.batch_pieces_ready', params: { n: 3 } });
    expect(batchStatusOf('planning', 3)).toEqual({ key: 'status.batch_planning', params: {} });
  });
});
