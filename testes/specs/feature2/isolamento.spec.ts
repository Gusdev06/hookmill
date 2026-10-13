// Feature 2 · isolamento entre workspaces (upload, campeão, teardown, lote, item, elenco, rosto do elenco).
// Mesma regra do v1: id de outro workspace = 404 NOT_FOUND (nunca 403/200), nada do B no corpo, banco de B idêntico.
// Depende de: B4a + B4b. PENDENTE até lá (projeto `feature2`).
import { readFileSync } from 'node:fs';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk, expectPagina } from '../../harness/api.ts';
import { q, WS, type Persona } from '../../harness/db.ts';
import { criarOferta } from '../../harness/fabrica.ts';
import { criarCampeao, criarCriativoVariacao, criarLote, fixture, putCru, subir, esperarJobsQuietos } from '../../harness/f2.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

async function fotoDeB(): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const t of ['uploads', 'champions', 'teardowns', 'variation_batches', 'variation_items', 'variation_castings', 'faces', 'creatives', 'scenes', 'files', 'jobs', 'cost_entries']) {
    out[t] = await q(`select * from "${t}" where workspace_id = $1 order by id`, [WS.B]);
  }
  return JSON.stringify(out);
}

async function montarB() {
  const offer = await criarOferta('B', { name: 'Segredo do B' });
  const champ = await criarCampeao('B', 'READY', { offer, name: 'Campeão secreto do B' });
  const falho = await criarCampeao('B', 'FAILED', { offer });
  const lote = await criarLote('B', 'PLAN_READY', { champion: champ, rostosEscolhidos: false });
  const variacao = await criarCriativoVariacao('B', 'RENDER_READY', 'NEW_HOOKS');
  const up = await subir('donoB', 'curto-3s.mp4', { semPut: true, semComplete: true });
  const upPronto = await subir('donoB', 'fala-split-20s.mp4');
  return { offer, champ, falho, lote, variacao, uploadPendente: up.create.data, uploadPronto: upPronto.uploadId! };
}

for (const atacante of ['donoA', 'membroA', 'duplo'] as Persona[]) {
  test(`I-F2-01 ${atacante} (token de A) recebe 404 em toda rota da feature 2 com id de B, e B fica intacto`, async () => {
    const b = await montarB();
    const antes = await fotoDeB();
    const L = `/variation-batches/${b.lote.id}`;
    const cast = b.lote.castings[0];
    const item = b.lote.items[0];
    const ataques: [string, string, unknown?][] = [
      ['POST', `/uploads/${b.uploadPendente.uploadId}/complete`, {}],
      ['GET', `/champions/${b.champ.id}`], ['PATCH', `/champions/${b.champ.id}`, { name: 'hackeado' }], ['DELETE', `/champions/${b.champ.id}`],
      ['PUT', `/champions/${b.falho.id}/video`, { uploadId: b.uploadPronto }],
      ['POST', `/champions/${b.champ.id}/analyze`, { confirm: true }],
      ['PATCH', `/champions/${b.champ.id}/teardown`, { transcriptWords: [{ index: 0, word: 'hack' }] }],
      ['GET', `/champions/${b.champ.id}/batches`],
      ['POST', `/champions/${b.champ.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] }],
      ['GET', L], ['POST', `${L}/replan`, {}],
      ['PATCH', `${L}/items/${item.id}`, { included: false }], ['POST', `${L}/items/${item.id}/regenerate`, {}],
      ['PATCH', `${L}/settings`, { format: 'SQUARE_1_1' }],
      ['PATCH', `${L}/castings/${cast.id}`, { description: 'hackeado hackeado' }],
      ['POST', `${L}/castings/${cast.id}/faces/generate`, { description: 'hackeado hackeado' }],
      ['POST', `${L}/castings/${cast.id}/faces/${cast.faceIds[0]}/select`, {}],
      ['GET', `${L}/estimate`], ['POST', `${L}/launch`, { expectedCostUsd: 1000 }],
      ['GET', `/creatives/${b.variacao.id}`], ['GET', `/creatives/${b.variacao.id}/review`],
      ['GET', `/files/${b.champ.videoFileId}`],
    ];
    const falhas: string[] = [];
    for (const [m, path, body] of ataques) {
      const r = await as(atacante).raw(m, path, body);
      if (!(r.status === 404 && r.body?.error?.code === 'NOT_FOUND')) falhas.push(`${m} ${path} → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
      expect(JSON.stringify(r.body ?? '')).not.toMatch(/Segredo do B|Campeão secreto do B/);
    }
    // PUT do conteúdo do upload de B com o token de A
    const put = await putCru(atacante, b.uploadPendente.url, readFileSync(fixture('curto-3s.mp4').path), b.uploadPendente.headers);
    if (put.status !== 404) falhas.push(`PUT ${b.uploadPendente.url} → ${put.status}`);
    expect(falhas, `rotas que vazaram ou responderam fora do contrato:\n${falhas.join('\n')}`).toEqual([]);
    expect(await fotoDeB()).toBe(antes);
  });
}

test('I-F2-02 ids cruzados: oferta de B, upload de B, lote de A com elenco/item/rosto de B → 404', async () => {
  const b = await montarB();
  const offerA = await criarOferta('A');
  const loteA = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: false });
  const uA = await subir('membroA', 'fala-split-20s.mp4');
  expectErro(await as('membroA').post('/champions', { offerId: b.offer.id, uploadId: uA.uploadId, rights: 'THIRD_PARTY' }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post('/champions', { offerId: offerA.id, uploadId: b.uploadPronto, rights: 'THIRD_PARTY' }), 404, 'NOT_FOUND');
  const falhoA = await criarCampeao('A', 'FAILED', { offer: offerA });
  expectErro(await as('membroA').put(`/champions/${falhoA.id}/video`, { uploadId: b.uploadPronto }), 404, 'NOT_FOUND');
  const LA = `/variation-batches/${loteA.id}`;
  expectErro(await as('membroA').patch(`${LA}/items/${b.lote.items[0].id}`, { included: false }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').patch(`${LA}/castings/${b.lote.castings[0].id}`, { description: 'hackeado hackeado' }), 404, 'NOT_FOUND');
  // rosto de B escolhido num elenco de A
  expectErro(await as('membroA').post(`${LA}/castings/${loteA.castings[0].id}/faces/${b.lote.castings[0].faceIds[0]}/select`, {}), 404, 'NOT_FOUND');
  // rosto de outro elenco do MESMO workspace também não serve (o rosto é do elenco)
  const outro = loteA.castings[1] ?? (await criarLote('A', 'PLAN_READY')).castings[0];
  const r = await as('membroA').post(`${LA}/castings/${loteA.castings[0].id}/faces/${outro.faceIds[0]}/select`, {});
  expect([404, 409], JSON.stringify(r.body)).toContain(r.status);
});

test('I-F2-03 listas e filtros de A nunca trazem nada de B (champions, creatives?championId=<de B>, library?championId=<de B>)', async () => {
  const b = await montarB();
  await criarCampeao('A', 'READY');
  const ch = expectPagina(await as('duplo').get('/champions'));
  expect(ch.map((c) => c.id)).not.toContain(b.champ.id);
  expect(expectPagina(await as('membroA').get(`/champions?offerId=${b.offer.id}`))).toEqual([]);
  expect(expectOk(await as('membroA').get(`/creatives?championId=${b.variacao.lote.champion.id}`))).toEqual([]);
  expect(expectOk(await as('membroA').get(`/library?championId=${b.variacao.lote.champion.id}`))).toEqual([]);
});

test('I-F2-04 o que A cria nasce no workspace do token, com arquivo em ws/<A>/', async () => {
  const offer = await criarOferta('A');
  const s = await subir('duplo', 'fala-split-20s.mp4'); // duplo é MEMBER de A e B; o token diz A
  const d = expectOk(await as('duplo').post('/champions', { offerId: offer.id, uploadId: s.uploadId, rights: 'THIRD_PARTY' }), 202);
  const [c] = await q('select workspace_id from champions where id = $1', [d.id]);
  expect(c.workspace_id).toBe(WS.A);
  const files = await q(`select f.storage_key from files f join uploads u on u.file_id = f.id where u.id = $1`, [s.uploadId]);
  expect(files[0].storage_key.startsWith(`ws/${WS.A}/`)).toBe(true);
});
