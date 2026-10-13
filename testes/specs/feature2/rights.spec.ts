// Feature 2 · "nada é recusado por rights" (decisão do Gusta, 06/10: feature-2 §1.1 e §10 D1/D2; api.md Mudanças 06/10 item 7).
// rights (OWN | THIRD_PARTY) é só registro: nenhuma rota recusa nada por causa dele, não existe erro de direitos
// e não há aviso de copy de terceiro. Depende de: B4a + B4b. PENDENTE até lá (projeto `feature2`).
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectOk } from '../../harness/api.ts';
import { criarOferta } from '../../harness/fabrica.ts';
import { criarCampeao, criarLote, subir, esperarJobsQuietos } from '../../harness/f2.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const semDireitos = (body: unknown) => expect(JSON.stringify(body ?? '')).not.toMatch(/RIGHTS|rights_|NOT_OWNER|COPYRIGHT|THIRD_PARTY_(BLOCK|COPY)/);

test('R-01 THIRD_PARTY (padrão) passa em tudo: importar, analisar, lote SWAP + NEW_HOOKS com áudio original, launch', async () => {
  const offer = await criarOferta('A');
  const s = await subir('membroA', 'fala-split-20s.mp4');
  // sem `rights` explícito no PATCH depois; no POST vai THIRD_PARTY
  const d = expectOk(await as('membroA').post('/champions', { offerId: offer.id, uploadId: s.uploadId, rights: 'THIRD_PARTY' }), 202);
  semDireitos(d);
  const c = await aguardar(() => as('membroA').get(`/champions/${d.id}`).then((r) => expectOk(r)), (x) => x.status !== 'ANALYZING', { timeoutMs: 60_000, intervalMs: 1000, oQue: 'análise' });
  expect(c.status).toBe('READY');
  expect(c.rights).toBe('THIRD_PARTY');
  for (const k of c.availableKinds.filter((x: any) => ['SWAP_AVATAR', 'NEW_HOOKS'].includes(x.kind))) expect(k).toMatchObject({ available: true, reason: null });
  const b = expectOk(await as('membroA').post(`/champions/${d.id}/batches`, {
    requests: [{ kind: 'SWAP_AVATAR', count: 1 }, { kind: 'NEW_HOOKS', count: 2 }], settings: { voiceSource: 'CHAMPION_AUDIO' },
  }), 202);
  semDireitos(b);
  expect(b.settings.voiceSource).toBe('CHAMPION_AUDIO');
});

test('R-02 lote de campeão THIRD_PARTY lança com voiceSource CHAMPION_AUDIO (fala literal de terceiro sai na peça, sem aviso)', async () => {
  const champ = await criarCampeao('A', 'READY', { rights: 'THIRD_PARTY' });
  const l = await criarLote('A', 'PLAN_READY', { champion: champ, rostosEscolhidos: true, voiceSource: 'CHAMPION_AUDIO' });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  semDireitos(e);
  expect(e.warnings).not.toContainEqual(expect.stringMatching(/right|copy|third/i));
  const r = expectOk(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd }), 202);
  semDireitos(r);
  expect(r.creatives).toHaveLength(l.items.length);
});

test('R-03 trocar rights no meio (OWN ↔ THIRD_PARTY) não muda o que está disponível nem trava o lote em andamento', async () => {
  const champ = await criarCampeao('A', 'READY', { rights: 'OWN' });
  const kinds = async () => expectOk(await as('membroA').get(`/champions/${champ.id}`)).availableKinds;
  const antes = await kinds();
  const l = await criarLote('A', 'PLAN_READY', { champion: champ, rostosEscolhidos: true });
  expectOk(await as('membroA').patch(`/champions/${champ.id}`, { rights: 'THIRD_PARTY' }));
  expect(await kinds()).toEqual(antes);
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  expect((await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd })).status).toBe(202);
  expectOk(await as('membroA').patch(`/champions/${champ.id}`, { rights: 'OWN' }));
});

