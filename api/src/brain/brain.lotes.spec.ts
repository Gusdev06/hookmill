// lacunas-home-eddy-v1 §3 (31/10): needsYou, statusLabel e o nó `batch` na montagem pura do grafo.
import { montarGrafo, type BrainDados, type DadosCriativo, type DadosLote } from './brain.montagem';

const T0 = new Date('2026-10-31T12:00:00Z');
const base = (over: Partial<BrainDados> = {}): BrainDados => ({
  workspace: { id: 'w1', name: 'Loja', resultType: null, industry: null, market: null, websiteUrl: null, monthlySpendCapUsd: null, defaultResult: null },
  offers: [{ id: 'o1', name: 'Offer', kind: null, language: 'en', what: null, promise: null, offerAndPrice: null, cta: null, audience: null, pains: null, proof: null, notes: null, creatives: 0 }],
  creatives: [], metaChampions: [], connection: null, ads: [], publications: [], loadedAt: T0, ...over,
});
const cr = (id: string, over: Partial<DadosCriativo> = {}): DadosCriativo => ({
  id, offerId: 'o1', name: id, adName: null, state: 'RENDER_READY', isWinner: false, origin: 'SCRATCH', variationCode: null, engine: null,
  durationSec: null, thumbKey: null, recency: T0, script: null, sourceMetaAdId: null, sourceCreativeId: null, updatedAt: T0, ...over,
});
const lote = (id: string, over: Partial<DadosLote> = {}): DadosLote => ({
  id, mode: 'AUTO', status: 'PLAN_READY', pieces: 0, rendering: false, downloadedAt: null, published: false, championId: 'ch1', championName: 'Winner ad',
  offerId: 'o1', sourceMetaAdId: null, sourceCreativeId: null, ready: 0, thumbKey: 'k/thumb.jpg', createdAt: T0, updatedAt: T0, ...over,
});

describe('Brain: needsYou e statusLabel (lacunas-home-eddy-v1 §3.1)', () => {
  it('criativo esperando = needsYou com a chave do chip; aprovado não; peça AUTO não; rascunho parado não', () => {
    const old = new Date(T0.getTime() - 8 * 86_400_000);
    const { graph } = montarGrafo(base({ creatives: [
      cr('a', { state: 'RENDER_READY' }), cr('b', { state: 'APPROVED' }), cr('c', { state: 'RENDER_FAILED', variationKind: 'AUTO_EDIT' }),
      cr('d', { state: 'ENGINE_PENDING', updatedAt: old }),
    ] }), { metaEnabled: false });
    const n = (id: string) => graph.nodes.find((x) => x.id === `creative:${id}`)!;
    expect(n('a')).toMatchObject({ needsYou: true, statusLabel: { key: 'status.render_ready', params: {} } });
    expect(n('b')).toMatchObject({ needsYou: false, statusLabel: { key: 'status.approved' } });
    expect(n('c').needsYou).toBe(false);
    expect(n('d')).toMatchObject({ needsYou: false, statusLabel: { key: 'status.draft' } });
    expect(graph.nodes.find((x) => x.kind === 'workspace')).toMatchObject({ needsYou: false, statusLabel: null });
  });

  it('estados com número ao vivo vão na variante curta, sem params', () => {
    const { graph } = montarGrafo(base({ creatives: [cr('g', { state: 'SCENES_GENERATING' }), cr('f', { state: 'SCENES_FAILED' }), cr('r', { state: 'RENDERING' })] }), { metaEnabled: false });
    const key = (id: string) => graph.nodes.find((x) => x.id === `creative:${id}`)!.statusLabel!.key;
    expect([key('g'), key('f'), key('r')]).toEqual(['status.scenes_generating_short', 'status.scenes_failed_short', 'status.rendering_short']);
    expect(graph.nodes.find((x) => x.id === 'creative:f')!.needsYou).toBe(true);
  });
});

describe('Brain: nó do lote (lacunas-home-eddy-v1 §3.2)', () => {
  it('lote vira nó `batch` (categoria creatives) ligado ao vencedor de origem e à oferta; criativos ligam por in_batch', () => {
    const { graph, thumbKeys } = montarGrafo(base({
      creatives: [cr('src', { isWinner: true, state: 'APPROVED' }), cr('p1', { batchId: 'b1', state: 'APPROVED' })],
      batches: [lote('b1', { status: 'LAUNCHED', pieces: 1, ready: 1, sourceCreativeId: 'src' })],
    }), { metaEnabled: false });
    const b = graph.nodes.find((x) => x.id === 'batch:b1')!;
    expect(b).toMatchObject({ kind: 'batch', category: 'creatives', label: 'Winner ad', needsYou: true, statusLabel: { key: 'status.batch_pieces_ready', params: { n: 1 } } });
    expect(b.meta).toMatchObject({ kind: 'batch', stage: 'pieces_ready', mode: 'AUTO', pieces: 1, ready: 1, sourceCreativeId: 'src' });
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'batch:b1', to: 'creative:src', kind: 'iterated_from' },
      { from: 'batch:b1', to: 'offer:o1', kind: 'for_offer' },
      { from: 'creative:p1', to: 'batch:b1', kind: 'in_batch' },
    ]));
    expect(graph.counts.batch).toEqual({ total: 1, shown: 1 });
    expect(thumbKeys.get('batch:b1')).toBe('k/thumb.jpg');
  });

  it('etapas: analyzing, planning, failed, generating, done; só plan_ready/failed/pieces_ready pedem a pessoa', () => {
    const { graph } = montarGrafo(base({ batches: [
      lote('a', { status: 'ANALYZING' }), lote('p', { status: 'PLANNING' }), lote('f', { status: 'ANALYSIS_FAILED' }),
      lote('g', { status: 'LAUNCHED', pieces: 3, rendering: true }), lote('d', { status: 'LAUNCHED', pieces: 3, downloadedAt: T0 }),
      lote('m', { status: 'LAUNCHED', mode: 'MANUAL', pieces: 3 }),
    ] }), { metaEnabled: false });
    const st = (id: string) => { const n = graph.nodes.find((x) => x.id === `batch:${id}`)!; return [n.meta.kind === 'batch' ? n.meta.stage : null, n.needsYou]; };
    expect(st('a')).toEqual(['analyzing', false]);
    expect(st('p')).toEqual(['planning', false]);
    expect(st('f')).toEqual(['failed', true]);
    expect(st('g')).toEqual(['generating', false]);
    expect(st('d')).toEqual(['done', false]);
    expect(st('m')).toEqual(['done', false]);
  });

  it('teto de 20 lotes, os que esperam a pessoa primeiro; ?offerId recorta', () => {
    const many = Array.from({ length: 25 }, (_, i) => lote(`x${i}`, { status: 'PLANNING', updatedAt: new Date(T0.getTime() - i * 1000) }));
    many.push(lote('wait', { status: 'PLAN_READY', updatedAt: new Date(T0.getTime() - 999_000) }));
    const { graph } = montarGrafo(base({ batches: many }), { metaEnabled: false });
    const shown = graph.nodes.filter((n) => n.kind === 'batch');
    expect(shown).toHaveLength(20);
    expect(shown.some((n) => n.id === 'batch:wait')).toBe(true);
    expect(graph.counts.batch).toEqual({ total: 26, shown: 20 });
    expect(graph.truncated).toBe(true);
    const other = montarGrafo(base({ batches: [lote('o', { offerId: 'o2' })] }), { metaEnabled: false, offerId: 'o1' }).graph;
    expect(other.nodes.some((n) => n.kind === 'batch')).toBe(false);
  });
});
