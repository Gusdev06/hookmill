// Contrato §3 (Home), §4 (ofertas), §5 (jobs), §6 (criativo), §7-13 formatos de leitura.
// Depende de: B2 (ofertas, criativos, roteiros, biblioteca) + I1 (mock de extração e roteiros, 2-5 s, custo zero).
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectErro, expectOk, expectPagina } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { criarCriativoNoEstado, criarOferta } from '../../harness/fabrica.ts';

const OFERTA = {
  name: 'Orbit Budget', language: 'en', kind: 'Subscription app', what: 'Budget app', audience: 'Adults',
  promise: 'Find forgotten money', pains: null, proof: null, offerAndPrice: '$9/mo', cta: 'Start free', notes: null,
};
const CHIP: Record<string, string> = {
  SCRIPTS_WRITING: 'progress', SCRIPTS_READY: 'waiting', SCRIPTS_FAILED: 'failed', AVATAR_PENDING: 'waiting',
  FACES_GENERATING: 'progress', FACES_READY: 'waiting', FACES_FAILED: 'failed', ENGINE_PENDING: 'waiting',
  SCENES_GENERATING: 'progress', SCENES_FAILED: 'failed', EDIT_PENDING: 'waiting', RENDERING: 'progress',
  RENDER_FAILED: 'failed', RENDER_READY: 'waiting', APPROVED: 'approved',
};
const STEP: Record<string, string> = {
  SCRIPTS_WRITING: 'scripts', SCRIPTS_READY: 'scripts', SCRIPTS_FAILED: 'scripts', AVATAR_PENDING: 'avatar',
  FACES_GENERATING: 'avatar', FACES_READY: 'avatar', FACES_FAILED: 'avatar', ENGINE_PENDING: 'engine',
  SCENES_GENERATING: 'generation', SCENES_FAILED: 'generation', EDIT_PENDING: 'edit', RENDERING: 'edit',
  RENDER_FAILED: 'edit', RENDER_READY: 'review', APPROVED: 'library',
};

test('C-OF-01 POST /offers cria (201) e GET /offers/:id devolve o mesmo Offer', async () => {
  const o = expectOk(await as('membroA').post('/offers', OFERTA), 201);
  expect(o).toMatchObject({ name: 'Orbit Budget', language: 'en', what: 'Budget app', creativesCount: 0, winnersCount: 0 });
  expect(o).toHaveProperty('fieldSources');
  expect(expectOk(await as('membroA').get(`/offers/${o.id}`)).id).toBe(o.id);
});

test('C-OF-02 POST /offers exige name e language; campo a mais → 400 VALIDATION_ERROR', async () => {
  const d = expectErro(await as('membroA').post('/offers', { what: 'x' }), 400, 'VALIDATION_ERROR');
  const campos = d.fields.map((f: any) => f.field);
  expect(campos).toEqual(expect.arrayContaining(['name', 'language']));
  expectErro(await as('membroA').post('/offers', { ...OFERTA, workspaceId: 'qa_ws_beta' }), 400, 'VALIDATION_ERROR');
});

test('C-OF-03 PATCH /offers/:id (autosave) marca o campo editado como "user" em fieldSources', async () => {
  const o = expectOk(await as('membroA').post('/offers', { ...OFERTA, fieldSources: { what: 'page', promise: 'page' } }), 201);
  const p = expectOk(await as('membroA').patch(`/offers/${o.id}`, { promise: 'Nova promessa' }));
  expect(p.promise).toBe('Nova promessa');
  expect(p.fieldSources.promise).toBe('user');
  expect(p.fieldSources.what).toBe('page');
  expectErro(await as('membroA').patch('/offers/nao-existe', { name: 'x' }), 404, 'NOT_FOUND');
});

test('C-OF-04 GET /offers pagina por cursor (limit 1-100) e não traz arquivadas', async () => {
  for (let i = 0; i < 3; i++) await criarOferta('A', { name: `Oferta ${i}` });
  const p1 = await as('membroA').get('/offers?limit=2');
  expect(expectPagina(p1).length).toBe(2);
  const p2 = expectPagina(await as('membroA').get(`/offers?limit=2&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`));
  expect(p2.length).toBe(1);
  expectErro(await as('membroA').get('/offers?limit=0'), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').get('/offers?limit=101'), 400, 'VALIDATION_ERROR');
  expect(expectOk(await as('membroA').del(`/offers/${p2[0].id}`))).toEqual({ ok: true });
  expect(expectPagina(await as('membroA').get('/offers?limit=100')).map((o: any) => o.id)).not.toContain(p2[0].id);
});

test('C-OF-05 POST /offers/extract → 202 Job OFFER_EXTRACT; mock termina em SUCCEEDED com output.brief', async () => {
  const j = expectOk(await as('membroA').post('/offers/extract', { url: 'https://example.com/oferta' }), 202);
  expect(j).toMatchObject({ type: 'OFFER_EXTRACT' });
  expect(['QUEUED', 'RUNNING']).toContain(j.status);
  const fim = await aguardar(() => as('membroA').get(`/jobs/${j.id}`), (r) => ['SUCCEEDED', 'FAILED'].includes(r.data?.status), { oQue: 'job de extração' });
  expect(fim.data.status).toBe('SUCCEEDED');
  expect(fim.data.output).toHaveProperty('brief');
  // briefing-leitura-v2 §4.3 (22/10): 6 etapas
  expect(fim.data.checklist.map((c: any) => c.key)).toEqual(['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images', 'extracting', 'detecting_language']);
});

test('C-OF-06 extract: sem url nem pageText → 400; url inválida → 400', async () => {
  expectErro(await as('membroA').post('/offers/extract', {}), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').post('/offers/extract', { url: 'nao e url' }), 400, 'VALIDATION_ERROR');
});

test('C-OF-07 reread sem sourceUrl e sem pageText → 409 INVALID_STATE', async () => {
  const o = await criarOferta('A');
  expectErro(await as('membroA').post(`/offers/${o.id}/reread`, {}), 409, 'INVALID_STATE');
});

test('C-CR-01 POST /creatives → 201 CreativeDetail em SCRIPTS_WRITING, nome padrão "<oferta> · <n>", 7 steps', async () => {
  const o = await criarOferta('A', { name: 'Orbit Budget' });
  const c = expectOk(await as('membroA').post('/creatives', { offerId: o.id }), 201);
  expect(c).toMatchObject({ state: 'SCRIPTS_WRITING', step: 'scripts', status: 'progress', offer: { id: o.id } });
  expect(c.name).toMatch(/^Orbit Budget · \d+$/);
  expect(c.steps.map((s: any) => s.step)).toEqual(['offer', 'scripts', 'avatar', 'engine', 'generation', 'edit', 'review']);
  expect(c.createdBy).toHaveProperty('initials');
});

test('C-CR-02 POST /creatives: oferta sem what/promise → 422 OFFER_INCOMPLETE com details.missing', async () => {
  const o = await criarOferta('A', { what: null, promise: null });
  const d = expectErro(await as('membroA').post('/creatives', { offerId: o.id }), 422, 'OFFER_INCOMPLETE');
  expect(d.missing.sort()).toEqual(['promise', 'what']);
});

test('C-CR-03 POST /creatives: oferta inexistente → 404; scriptCount fora de 3-5 → 400', async () => {
  expectErro(await as('membroA').post('/creatives', { offerId: 'nao-existe' }), 404, 'NOT_FOUND');
  const o = await criarOferta('A');
  expectErro(await as('membroA').post('/creatives', { offerId: o.id, scriptCount: 2 }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').post('/creatives', { offerId: o.id, scriptCount: 6 }), 400, 'VALIDATION_ERROR');
});

test('C-CR-04 POST /creatives com teto estourado → 409 SPEND_CAP_EXCEEDED com { spentUsd, capUsd, estimateUsd }', async () => {
  const o = await criarOferta('A');
  await q(`update workspaces set monthly_spend_cap_usd = 0.0001 where id = 'qa_ws_alfa'`);
  await q(`insert into cost_entries (id, workspace_id, provider, kind, model, units, unit, amount_usd) values ('qa_cost_1','qa_ws_alfa','ANTHROPIC','LLM','claude-opus-5-5',1,'call',5)`);
  const d = expectErro(await as('membroA').post('/creatives', { offerId: o.id }), 409, 'SPEND_CAP_EXCEEDED');
  for (const k of ['spentUsd', 'capUsd', 'estimateUsd']) expect(d).toHaveProperty(k);
});

test('C-CR-05 mock: SCRIPTS_WRITING → SCRIPTS_READY sozinho, com 4 roteiros READY, blocks[0] = hook', async () => {
  const o = await criarOferta('A');
  const c = expectOk(await as('membroA').post('/creatives', { offerId: o.id }), 201);
  const pronto = await aguardar(() => as('membroA').get(`/creatives/${c.id}`), (r) => r.data?.state !== 'SCRIPTS_WRITING', { oQue: 'roteiros do mock' });
  expect(pronto.data.state).toBe('SCRIPTS_READY');
  const s = expectOk(await as('membroA').get(`/creatives/${c.id}/scripts`));
  expect(s.scripts.map((x: any) => x.letter)).toEqual(['A', 'B', 'C', 'D']);
  for (const x of s.scripts) {
    expect(x.status).toBe('READY');
    expect(x.blocks[0].label).toBe('hook');
  }
});

test('C-CR-06 step e chip derivados do estado (tabela do modelo-de-dados) em GET /creatives/:id', async () => {
  for (const state of Object.keys(CHIP)) {
    const c = await criarCriativoNoEstado('A', state as any);
    const d = expectOk(await as('membroA').get(`/creatives/${c.id}`));
    expect({ state, step: d.step, status: d.status }).toEqual({ state, step: STEP[state], status: CHIP[state] });
  }
});

test('C-CR-07 GET /creatives: filtros, ordem updatedAt desc e meta.counts', async () => {
  for (const s of ['SCRIPTS_WRITING', 'FACES_FAILED', 'RENDER_READY', 'APPROVED'] as const) await criarCriativoNoEstado('A', s);
  const all = await as('membroA').get('/creatives?filter=all');
  const linhas = expectPagina(all);
  expect(linhas.length).toBe(4);
  expect(all.body.meta.counts).toEqual({ all: 4, progress: 1, needs_you: 2, approved: 1 });
  const datas = linhas.map((l: any) => l.updatedAt);
  expect([...datas].sort().reverse()).toEqual(datas);
  expect(expectPagina(await as('membroA').get('/creatives?filter=needs_you')).map((l: any) => l.state).sort()).toEqual(['FACES_FAILED', 'RENDER_READY']);
  expectErro(await as('membroA').get('/creatives?filter=xpto'), 400, 'VALIDATION_ERROR');
});

test('C-CR-08 PATCH /creatives/:id só troca nome; mandar offerId → 400 VALIDATION_ERROR (api.md, Mudanças 05/10 §3)', async () => {
  const c = await criarCriativoNoEstado('A', 'SCRIPTS_READY');
  expect(expectOk(await as('membroA').patch(`/creatives/${c.id}`, { name: 'Novo' })).name).toBe('Novo');
  const outra = await criarOferta('A');
  const d = expectErro(await as('membroA').patch(`/creatives/${c.id}`, { offerId: outra.id }), 400, 'VALIDATION_ERROR');
  expect(d.fields.some((f: any) => f.field === 'offerId')).toBe(true);
  const [row] = await q<{ offer_id: string }>('select offer_id from creatives where id = $1', [c.id]);
  expect(row.offer_id).toBe(c.offer.id);
});

test('C-CR-09 DELETE /creatives/:id arquiva; em RENDERING → 409', async () => {
  const c = await criarCriativoNoEstado('A', 'SCRIPTS_READY');
  expect(expectOk(await as('membroA').del(`/creatives/${c.id}`))).toEqual({ ok: true });
  expect(expectPagina(await as('membroA').get('/creatives')).map((l: any) => l.id)).not.toContain(c.id);
  const r = await criarCriativoNoEstado('A', 'RENDERING');
  expect((await as('membroA').del(`/creatives/${r.id}`)).status).toBe(409);
});

test('C-CR-10 leituras por etapa respondem no formato do contrato', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  const f = expectOk(await as('membroA').get(`/creatives/${c.id}/faces`));
  expect(f).toHaveProperty('batches');
  expect(f.selectedFaceId).toBe(c.selectedFaceId);
  const sc = expectOk(await as('membroA').get(`/creatives/${c.id}/scenes`));
  expect(sc.summary).toMatchObject({ ready: 4, total: 4, failed: 0 });
  const ed = expectOk(await as('membroA').get(`/creatives/${c.id}/edit`));
  expect(ed.settings).toMatchObject({ templateId: 'clean', captionStyle: 'word' });
  const rv = expectOk(await as('membroA').get(`/creatives/${c.id}/review`));
  expect(rv.changeOptions.map((o: any) => o.type).sort()).toEqual(['FACE', 'LINE', 'SCENE', 'TEXT']);
  expect(rv.video).toHaveProperty('url');
  const rd = expectOk(await as('membroA').get(`/creatives/${c.id}/renders/${c.renderIds[0]}`));
  expect(rd.status).toBe('READY');
});

test('C-CR-11 estimate: formato com lines e spend; sem rosto escolhido → 409', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  for (const k of ['costUsd', 'etaSec', 'sceneCount', 'lines', 'spend']) expect(e).toHaveProperty(k);
  expect(Array.isArray(e.warnings)).toBe(true); // Mudanças 05/10 §7: sempre presente
  expectErro(await as('membroA').get(`/creatives/${c.id}/estimate?engine=XPTO&model=kling-3.0&format=VERTICAL_9_16`), 400, 'VALIDATION_ERROR');
  const cedo = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  expect((await as('membroA').get(`/creatives/${cedo.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`)).status).toBe(409);
});

test('C-CR-12 generate: custo calculado > expectedCostUsd × 1,10 → 409 ESTIMATE_CHANGED', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  test.skip(!(e.costUsd > 0), 'mock com custo 0: ESTIMATE_CHANGED não é exercitável');
  const d = expectErro(await as('membroA').post(`/creatives/${c.id}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: e.costUsd / 2 }), 409, 'ESTIMATE_CHANGED');
  expect(d).toHaveProperty('estimateUsd');
});

test('C-CR-13 generate LIPSYNC sem voiceId → 400', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  expectErro(await as('membroA').post(`/creatives/${c.id}/generate`, { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', format: 'VERTICAL_9_16', expectedCostUsd: 10 }), 400, 'VALIDATION_ERROR');
});

test('C-CR-14 faces/generate: descrição fora de 10-600 chars → 400', async () => {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  expectErro(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'curta' }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'x'.repeat(601) }), 400, 'VALIDATION_ERROR');
});

test('C-CR-15 scripts/generate: total ativo nunca passa de 5 → 400', async () => {
  const c = await criarCriativoNoEstado('A', 'SCRIPTS_READY'); // já tem 4
  expect((await as('membroA').post(`/creatives/${c.id}/scripts/generate`, { count: 2, replace: false })).status).toBe(400);
  expectErro(await as('membroA').post(`/creatives/${c.id}/scripts/generate`, { count: 6, replace: true }), 400, 'VALIDATION_ERROR');
});

test('C-CR-16 biblioteca: só APPROVED; PUT winner idempotente; winner fora de APPROVED → 409', async () => {
  const ap = await criarCriativoNoEstado('A', 'APPROVED');
  const rr = await criarCriativoNoEstado('A', 'RENDER_READY');
  const lib = await as('membroA').get('/library');
  expect(expectPagina(lib).map((x: any) => x.id)).toEqual([ap.id]);
  expect(lib.body.meta).toHaveProperty('offers');
  expect(expectOk(await as('membroA').put(`/library/${ap.id}/winner`, { isWinner: true }))).toEqual({ id: ap.id, isWinner: true });
  expect(expectOk(await as('membroA').put(`/library/${ap.id}/winner`, { isWinner: true }))).toEqual({ id: ap.id, isWinner: true });
  expect(expectPagina(await as('membroA').get('/library?winners=true')).length).toBe(1);
  expect((await as('membroA').put(`/library/${rr.id}/winner`, { isWinner: true })).status).toBe(409);
});

test('C-CR-17 SSE: primeiro evento é snapshot com o CreativeDetail', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  const { tokenOf } = await import('../../harness/api.ts');
  const { ENV } = await import('../../harness/env.ts');
  const ctrl = new AbortController();
  const r = await fetch(`${ENV.apiUrl}/creatives/${c.id}/events`, { headers: { authorization: `Bearer ${await tokenOf('membroA')}` }, signal: ctrl.signal });
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toContain('text/event-stream');
  const reader = r.body!.getReader();
  let buf = '';
  const until = Date.now() + 5000;
  while (!buf.includes('\n\n') && Date.now() < until) buf += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  expect(buf).toContain('event: snapshot');
  expect(buf).toContain(c.id);
});

test('C-ARQ-01 GET /files/:id → 302 pra URL assinada', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  const [f] = await q<{ file_id: string }>('select file_id from renders where id = $1', [c.renderIds[0]]);
  const r = await as('membroA').get(`/files/${f.file_id}`);
  expect(r.status).toBe(302);
  expect(r.headers.get('location')).toMatch(/X-Amz-Signature|signature/i);
});
