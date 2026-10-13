// Feature 2 · máquinas do campeão e do lote (modelo-de-dados.md "Máquina do campeão"/"Máquina do lote"; feature-2 §3.1/§3.2).
// Cada ação em cada estado de origem: permitido → destino certo no banco; proibido → 409 INVALID_STATE { state, allowed }
// e o banco NÃO muda. Mais compare-and-set (clique duplo). Depende de: B4a (campeão) e B4b (lote). PENDENTE até lá.
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { criarCampeao, criarLote, statusCampeao, statusLote, subir, type BatchStatus, type CampeaoFabricado, type ChampionStatus, type LoteFabricado, esperarJobsQuietos } from '../../harness/f2.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const CH: ChampionStatus[] = ['RESOLVING', 'ANALYZING', 'READY', 'FAILED'];
const LT: BatchStatus[] = ['PLANNING', 'PLAN_READY', 'PLAN_FAILED', 'LAUNCHED'];

// ───────────── campeão ─────────────
interface AcaoCampeao { nome: string; req: (c: CampeaoFabricado, uploadId: string) => [string, string, unknown]; permitido: Partial<Record<ChampionStatus, ChampionStatus>> }
const ACOES_CAMPEAO: AcaoCampeao[] = [
  { nome: 'analisar de novo', req: (c) => ['POST', `/champions/${c.id}/analyze`, { confirm: true }], permitido: { READY: 'ANALYZING', FAILED: 'ANALYZING' } },
  { nome: 'anexar vídeo', req: (c, u) => ['PUT', `/champions/${c.id}/video`, { uploadId: u }], permitido: { FAILED: 'ANALYZING' } },
];
for (const a of ACOES_CAMPEAO) {
  for (const origem of CH) {
    const destino = a.permitido[origem];
    test(`E-CH ${a.nome} em ${origem} → ${destino ?? '409 INVALID_STATE'}`, async () => {
      const c = await criarCampeao('A', origem);
      const s = await subir('membroA', 'fala-split-20s.mp4');
      const [m, path, body] = a.req(c, s.uploadId!);
      const r = await as('membroA').raw(m, path, body);
      if (destino) {
        expect(r.status, JSON.stringify(r.body)).toBe(202);
        expect(await statusCampeao(c.id)).toBe(destino);
      } else {
        const det = expectErro(r, 409, 'INVALID_STATE');
        expect(det.state).toBe(origem);
        expect(det.allowed.sort()).toEqual(Object.keys(a.permitido).sort());
        expect(await statusCampeao(c.id)).toBe(origem);
      }
    });
  }
}

test('E-CH PATCH teardown em ANALYZING → 409 (o job vai sobrescrever)', async () => {
  const c = await criarCampeao('A', 'READY');
  await q(`update champions set status = 'ANALYZING' where id = $1`, [c.id]);
  const r = await as('membroA').patch(`/champions/${c.id}/teardown`, { transcriptWords: [{ index: 0, word: 'x' }] });
  expect(r.status, JSON.stringify(r.body)).toBe(409);
});

for (const origem of CH) {
  test(`E-CH pedir lote com campeão ${origem} → ${origem === 'READY' ? '202 PLANNING' : '409 INVALID_STATE'}`, async () => {
    const c = await criarCampeao('A', origem);
    const r = await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] });
    if (origem === 'READY') {
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      expect(await statusLote(r.data.id)).toBe('PLANNING');
    } else {
      const det = expectErro(r, 409, 'INVALID_STATE');
      expect(det).toMatchObject({ state: origem, allowed: ['READY'] });
      expect(await q('select id from variation_batches where champion_id = $1', [c.id])).toHaveLength(0);
    }
  });
}

test('E-CH-CAS dois "Analyze again" ao mesmo tempo: um 202, um 409, um job só', async () => {
  const c = await criarCampeao('A', 'FAILED');
  const rs = await Promise.all([1, 2].map(() => as('membroA').post(`/champions/${c.id}/analyze`, {})));
  expect(rs.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(await q(`select id from jobs where champion_id = $1 and type = 'CHAMPION_ANALYZE'`, [c.id])).toHaveLength(1);
});

// ───────────── lote ─────────────
interface AcaoLote { nome: string; req: (l: LoteFabricado) => [string, string, unknown]; permitido: Partial<Record<BatchStatus, BatchStatus | 'mesmo'>>; status: number }
const ACOES_LOTE: AcaoLote[] = [
  { nome: 'replan', req: (l) => ['POST', `/variation-batches/${l.id}/replan`, {}], permitido: { PLAN_READY: 'PLANNING', PLAN_FAILED: 'PLANNING' }, status: 202 },
  { nome: 'launch', req: (l) => ['POST', `/variation-batches/${l.id}/launch`, { expectedCostUsd: 1000 }], permitido: { PLAN_READY: 'LAUNCHED' }, status: 202 },
  { nome: 'editar item', req: (l) => ['PATCH', `/variation-batches/${l.id}/items/${l.items[0].id}`, { included: true }], permitido: { PLAN_READY: 'mesmo' }, status: 200 },
  { nome: 'editar settings', req: (l) => ['PATCH', `/variation-batches/${l.id}/settings`, { format: 'SQUARE_1_1' }], permitido: { PLAN_READY: 'mesmo' }, status: 200 },
];
for (const a of ACOES_LOTE) {
  for (const origem of LT) {
    const destino = a.permitido[origem];
    test(`E-LT ${a.nome} em ${origem} → ${destino ? (destino === 'mesmo' ? a.status : destino) : '409'}`, async () => {
      const l = await criarLote('A', origem, { rostosEscolhidos: true });
      const [m, path, body] = a.req(l);
      const r = await as('membroA').raw(m, path, body);
      if (destino) {
        expect(r.status, JSON.stringify(r.body)).toBe(a.status);
        expect(await statusLote(l.id)).toBe(destino === 'mesmo' ? origem : destino);
      } else {
        expect(r.status, JSON.stringify(r.body)).toBe(409);
        expect(r.body?.error?.code).toBe('INVALID_STATE');
        expect(r.body.error.details.state).toBe(origem);
        expect(await statusLote(l.id)).toBe(origem);
        expect(await q('select id from creatives where variation_batch_id = $1', [l.id])).toHaveLength(0);
      }
    });
  }
}

test('E-LT LAUNCHED é final: replan, launch, PATCH item/settings e regerar item → 409', async () => {
  const l = await criarLote('A', 'LAUNCHED');
  for (const [m, p, b] of [
    ['POST', `/variation-batches/${l.id}/replan`, {}],
    ['POST', `/variation-batches/${l.id}/launch`, { expectedCostUsd: 1000 }],
    ['POST', `/variation-batches/${l.id}/items/${l.items[0].id}/regenerate`, {}],
  ] as const) {
    expect((await as('membroA').raw(m, p, b)).status, `${m} ${p}`).toBe(409);
  }
});

test('E-LT-CAS dois launch ao mesmo tempo: um 202, um 409, criativos criados uma vez só', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  const rs = await Promise.all([1, 2].map(() => as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: 1000 })));
  expect(rs.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(await q('select id from creatives where variation_batch_id = $1', [l.id])).toHaveLength(l.items.length);
});


// Esclarecimento 06/10 nº 3: "Regerar este" só com lote PLAN_READY e item READY/FAILED; lote fica PLAN_READY, item → WRITING;
// launch com item WRITING = 422 BATCH_INCOMPLETE { itemId, reason: not_ready }.
for (const origem of LT) {
  test(`E-LT regerar item em ${origem} → ${origem === 'PLAN_READY' ? '202 WRITING' : '409'}`, async () => {
    const l = await criarLote('A', origem, { rostosEscolhidos: true });
    const it = l.items.find((i) => !i.isControl)!;
    const r = await as('membroA').post(`/variation-batches/${l.id}/items/${it.id}/regenerate`, {});
    if (origem === 'PLAN_READY') {
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      expect(r.data.status).toBe('WRITING');
      expect(await statusLote(l.id)).toBe('PLAN_READY');
    } else {
      const det = expectErro(r, 409, 'INVALID_STATE');
      expect(det.state).toBe(origem);
      expect(await statusLote(l.id)).toBe(origem);
    }
  });
}

test('E-LT launch com item WRITING → 422 BATCH_INCOMPLETE { itemId, reason: not_ready }', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  const it = l.items.find((i) => !i.isControl)!;
  await q(`update variation_items set status = 'WRITING' where id = $1`, [it.id]);
  const det = expectErro(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: 1000 }), 422, 'BATCH_INCOMPLETE');
  expect(det.missing).toContainEqual({ itemId: it.id, reason: 'not_ready' });
  expect(await statusLote(l.id)).toBe('PLAN_READY');
});
