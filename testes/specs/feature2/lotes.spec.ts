// Feature 2 · contrato dos lotes de variação (api.md §20; feature-2 §1.2 uma alavanca, §2 limites, §3.2 máquina, §5 pipeline).
// Depende de: B4b (variacoes/ + launch + orquestrador AUDIO_LIPSYNC/REUSE) + I4b (planVariations mock, estimate com pipelines).
// PENDENTE até o B4b: roda só no projeto `feature2` (npm run feature2). Nada pago: tudo em mock (US$ 0).
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectErro, expectOk } from '../../harness/api.ts';
import { q, WS } from '../../harness/db.ts';
import { criarCriativoNoEstado } from '../../harness/fabrica.ts';
import { campeaoReal, criarCampeao, criarLote, statusLote, esperarJobsQuietos } from '../../harness/f2.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const SWAP1_HOOKS3 = { requests: [{ kind: 'SWAP_AVATAR', count: 1 }, { kind: 'NEW_HOOKS', count: 3 }] };
const lerLote = (id: string) => as('membroA').get(`/variation-batches/${id}`).then((r) => expectOk(r));
const ateSairDePlanning = (id: string) =>
  aguardar(() => lerLote(id), (b) => b.status !== 'PLANNING', { timeoutMs: 30_000, intervalMs: 750, oQue: `lote ${id} sair de PLANNING` });

test('C-LT-01 POST /champions/:id/batches → 202 PLANNING, itens WRITING, controle automático em NEW_HOOKS (fora do N) → PLAN_READY', async () => {
  const c = await criarCampeao('A', 'READY');
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, SWAP1_HOOKS3), 202);
  expect(b).toMatchObject({ status: 'PLANNING', champion: { id: c.id }, offer: { id: c.offer.id }, language: 'en', requests: SWAP1_HOOKS3.requests,
    job: { type: 'VARIATIONS_PLAN' }, estimatedCostUsd: null, launchedAt: null, progress: null });
  expect(b.items).toHaveLength(5); // 1 swap + 3 ganchos + 1 controle
  // o controle já nasce READY (gancho original, nada a escrever); os outros WRITING
  expect(b.items.filter((i: any) => !i.isControl).every((i: any) => i.status === 'WRITING')).toBe(true);
  const ctrl = b.items.filter((i: any) => i.isControl);
  expect(ctrl).toHaveLength(1);
  expect(ctrl[0]).toMatchObject({ kind: 'NEW_HOOKS', index: -1 });
  const pronto = await ateSairDePlanning(b.id);
  expect(pronto.status).toBe('PLAN_READY');
  expect(pronto.job.checklist.map((k: any) => k.key)).toEqual(['reading_teardown', 'writing']);
  for (const i of pronto.items) {
    expect(i.status, JSON.stringify(i)).toBe('READY');
    if (i.isControl) continue; // controle = gancho original, sem alavanca (rationale null é válido: string|null)
    expect(typeof i.lever).toBe('string');
    expect(typeof i.rationale).toBe('string');
  }
  // NEW_HOOKS: gancho no item, corpo literal; os 3 ganchos são diferentes entre si
  const hooks = pronto.items.filter((i: any) => i.kind === 'NEW_HOOKS' && !i.isControl);
  expect(new Set(hooks.map((h: any) => h.hook.speech)).size).toBe(3);
  const corpo = (i: any) => JSON.stringify(i.blocks.slice(1).map((x: any) => x.speech));
  for (const h of hooks) expect(corpo(h)).toBe(corpo(pronto.items.find((i: any) => i.isControl)));
  // elencos: 1 SHARED pros ganchos (+controle), 1 ITEM por swap
  const shared = pronto.castings.filter((x: any) => x.scope === 'SHARED');
  const porItem = pronto.castings.filter((x: any) => x.scope === 'ITEM');
  expect(shared).toHaveLength(1);
  expect(porItem).toHaveLength(1);
  for (const h of pronto.items.filter((i: any) => i.kind === 'NEW_HOOKS')) expect(h.castingId).toBe(shared[0].id);
  expect(pronto.items.find((i: any) => i.kind === 'SWAP_AVATAR').castingId).toBe(porItem[0].id);
  // teardownSnapshot: editar o teardown depois não muda o lote
  const [snap] = await q('select teardown_snapshot from variation_batches where id = $1', [b.id]);
  expect(snap.teardown_snapshot).not.toBeNull();
});

test('C-LT-02 limites do lote → 400 VALIDATION_ERROR (NEW_HOOKS 2-5, SWAP 1-4, total ≤ 10, requests vazio, kind inválido)', async () => {
  const c = await criarCampeao('A', 'READY');
  for (const requests of [
    [{ kind: 'NEW_HOOKS', count: 1 }], [{ kind: 'NEW_HOOKS', count: 6 }],
    [{ kind: 'SWAP_AVATAR', count: 0 }], [{ kind: 'SWAP_AVATAR', count: 5 }],
    [{ kind: 'SWAP_AVATAR', count: 4 }, { kind: 'NEW_HOOKS', count: 5 }, { kind: 'SWAP_AVATAR', count: 4 }],
    [], [{ kind: 'CLONE', count: 1 }],
  ]) {
    expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests }), 400, 'VALIDATION_ERROR');
  }
  // 4 + 5 (+controle) = 9 + 1 = 10 itens: passa no limite
  expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 4 }, { kind: 'NEW_HOOKS', count: 5 }] }), 202);
});

for (const kind of ['COPY_NEW', 'REMIX_EDIT']) {
  test(`C-LT-03 ${kind} fora do build de 10/10 → 422 KIND_NOT_ENABLED { kind }`, async () => {
    const c = await criarCampeao('A', 'READY');
    const det = expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind, count: 1 }] }), 422, 'KIND_NOT_ENABLED');
    expect(det).toEqual({ kind });
  });
}

test('C-LT-04 campeão sem fala → 422 NO_SPEECH { kind } pra SWAP_AVATAR e NEW_HOOKS', async () => {
  const c = await criarCampeao('A', 'READY', { hasSpeech: false });
  for (const kind of ['SWAP_AVATAR', 'NEW_HOOKS']) {
    const count = kind === 'NEW_HOOKS' ? 2 : 1;
    expect(expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind, count }] }), 422, 'NO_SPEECH')).toEqual({ kind });
  }
});

test('C-LT-05 [mock:fail-item:NEW_HOOKS:1] → PLAN_READY com só o item 1 FAILED (com action); Regerar este → 202 WRITING', async () => {
  const c = await criarCampeao('A', 'READY');
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { ...SWAP1_HOOKS3, notes: '[mock:fail-item:NEW_HOOKS:1]' }), 202);
  const p = await ateSairDePlanning(b.id);
  expect(p.status).toBe('PLAN_READY');
  const falhos = p.items.filter((i: any) => i.status === 'FAILED');
  expect(falhos).toHaveLength(1);
  expect(falhos[0]).toMatchObject({ kind: 'NEW_HOOKS', index: 1, errorCode: expect.any(String), failReason: expect.any(String), action: expect.any(String) });
  const r = expectOk(await as('membroA').post(`/variation-batches/${b.id}/items/${falhos[0].id}/regenerate`, { note: 'outra' }), 202);
  expect(r).toMatchObject({ id: falhos[0].id, status: 'WRITING' });
  // estimativa só conta itens READY e incluídos
  await aguardar(() => lerLote(b.id), (x) => x.items.every((i: any) => i.status !== 'WRITING'), { oQue: 'regerar terminar' });
});

test('C-LT-06 [mock:fail-all] → PLAN_FAILED; replan → PLANNING com itens novos (antigos descartados) → PLAN_READY', async () => {
  const c = await criarCampeao('A', 'READY');
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { ...SWAP1_HOOKS3, notes: '[mock:fail-all]' }), 202);
  const f = await ateSairDePlanning(b.id);
  expect(f.status).toBe('PLAN_FAILED');
  // DIVERGÊNCIA aberta (CASOS.md): a máquina diz "todos FAILED → PLAN_FAILED", mas o controle fica READY
  expect(f.items.filter((i: any) => !i.isControl).every((i: any) => i.status === 'FAILED')).toBe(true);
  const antigos = f.items.map((i: any) => i.id);
  const r = expectOk(await as('membroA').post(`/variation-batches/${b.id}/replan`, { notes: 'sem gatilho' }), 202);
  expect(r.status).toBe('PLANNING');
  const ok = await ateSairDePlanning(b.id);
  expect(ok.status).toBe('PLAN_READY');
  for (const i of ok.items) expect(antigos).not.toContain(i.id);
  expect(await q('select id from variation_items where id = any($1)', [antigos])).toHaveLength(0);
});

test('C-LT-07 PATCH item: só a alavanca do tipo (NEW_HOOKS = hook; SWAP = included; campo de outro tipo = 400)', async () => {
  const l = await criarLote('A', 'PLAN_READY');
  const hook = l.items.find((i) => i.kind === 'NEW_HOOKS' && !i.isControl)!;
  const swap = l.items.find((i) => i.kind === 'SWAP_AVATAR')!;
  const u = `/variation-batches/${l.id}/items`;
  const h = expectOk(await as('membroA').patch(`${u}/${hook.id}`, { hook: { speech: 'Novo gancho editado.', onScreenText: 'Novo' } }));
  expect(h.hook).toEqual({ speech: 'Novo gancho editado.', onScreenText: 'Novo' });
  expect(expectOk(await as('membroA').patch(`${u}/${swap.id}`, { included: false })).included).toBe(false);
  expectErro(await as('membroA').patch(`${u}/${hook.id}`, { blocks: [{ index: 1, speech: 'corpo novo' }] }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`${u}/${swap.id}`, { hook: { speech: 'x' } }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`${u}/${swap.id}`, { blocks: [{ index: 0, speech: 'x' }] }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`${u}/qa_nao_existe`, { included: false }), 404, 'NOT_FOUND');
});

test('C-LT-08 PATCH settings do lote (formato, voz, fonte da voz, edição); 400 pra valor fora do enum', async () => {
  const l = await criarLote('A', 'PLAN_READY');
  const b = expectOk(await as('membroA').patch(`/variation-batches/${l.id}/settings`, { format: 'SQUARE_1_1', voiceSource: 'CATALOG', voiceId: 'Wise_Woman', edit: { captionStyle: 'line' } }));
  expect(b.settings).toMatchObject({ format: 'SQUARE_1_1', voiceSource: 'CATALOG', voiceId: 'Wise_Woman' });
  expect(b.settings.edit.captionStyle).toBe('line');
  expectErro(await as('membroA').patch(`/variation-batches/${l.id}/settings`, { format: 'WIDE_16_9' }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`/variation-batches/${l.id}/settings`, { voiceSource: 'CLONE' }), 400, 'VALIDATION_ERROR');
});

test('C-LT-09 elenco: descrição 10-600; 4 rostos Soul (mock) → READY; escolher rosto não READY = 409; escolher READY grava', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: false });
  const cast = l.castings.find((c) => c.scope === 'SHARED')!;
  const u = `/variation-batches/${l.id}/castings/${cast.id}`;
  expectErro(await as('membroA').patch(u, { description: 'curta' }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(u, { description: 'x'.repeat(601) }), 400, 'VALIDATION_ERROR');
  expect(expectOk(await as('membroA').patch(u, { description: 'man in his 40s, office, daylight' })).description).toBe('man in his 40s, office, daylight');
  const g = expectOk(await as('membroA').post(`${u}/faces/generate`, { description: 'man in his 40s, office, daylight' }), 202);
  expect(g.batch).toBe(2); // a fábrica já pôs o lote 1
  expect(g.faces).toHaveLength(4);
  expectErro(await as('membroA').post(`${u}/faces/${g.faces[0].id}/select`, {}), 409, 'INVALID_STATE');
  await aguardar(() => q('select status from faces where casting_id = $1 and batch = 2', [cast.id]), (r) => r.every((x: any) => x.status === 'READY'), { oQue: 'rostos do elenco READY' });
  const sel = expectOk(await as('membroA').post(`${u}/faces/${g.faces[0].id}/select`, {}));
  expect(sel.selectedFaceId).toBe(g.faces[0].id);
  // rosto de elenco: casting_id preenchido, creative_id nulo (CHECK faces_owner_check)
  const [f] = await q('select creative_id, casting_id from faces where id = $1', [g.faces[0].id]);
  expect(f).toEqual({ creative_id: null, casting_id: cast.id });
});

test('C-LT-10 elenco com [mock:SAFETY_BLOCK] → os 4 rostos FAILED com errorCode e action, igual ao v1', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: false });
  const cast = l.castings[0];
  const g = expectOk(await as('membroA').post(`/variation-batches/${l.id}/castings/${cast.id}/faces/generate`, { description: 'woman in a park [mock:SAFETY_BLOCK]' }), 202);
  const fs = await aguardar(() => lerLote(l.id), (b) => b.castings.find((c: any) => c.id === cast.id).batches.find((x: any) => x.batch === g.batch)?.faces.every((f: any) => f.status === 'FAILED'),
    { oQue: 'rostos do elenco FAILED' });
  const faces = fs.castings.find((c: any) => c.id === cast.id).batches.find((x: any) => x.batch === g.batch).faces;
  for (const f of faces) expect(f).toMatchObject({ errorCode: 'SAFETY_BLOCK', action: 'change_description' });
});

test('C-LT-11 estimate: só itens incluídos e READY, savedByReuseUsd = 0 (§13.5: take contínuo, sem reuso de corpo), teto do mês', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  expect(e).toMatchObject({ costUsd: expect.any(Number), etaSec: expect.any(Number), savedByReuseUsd: expect.any(Number), warnings: expect.any(Array),
    spend: { monthUsd: expect.any(Number), afterUsd: expect.any(Number) } });
  expect(e.items).toHaveLength(5);
  expect(e.savedByReuseUsd).toBe(0); // §13.7: savedByReuseUsd fica 0
  expect(e.costUsd).toBeCloseTo(e.items.reduce((s: number, i: any) => s + i.costUsd, 0), 4);
  // tirar um gancho do lote baixa a estimativa
  const hook = l.items.find((i) => i.kind === 'NEW_HOOKS' && !i.isControl)!;
  expectOk(await as('membroA').patch(`/variation-batches/${l.id}/items/${hook.id}`, { included: false }));
  const e2 = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  expect(e2.items).toHaveLength(4);
  expect(e2.costUsd).toBeLessThan(e.costUsd);
});

test('C-LT-12 launch sem rosto escolhido → 422 BATCH_INCOMPLETE apontando cada elenco; nada é criado', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: false });
  const det = expectErro(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: 100 }), 422, 'BATCH_INCOMPLETE');
  for (const c of l.castings) expect(det.missing).toContainEqual({ castingId: c.id, reason: 'face_not_selected' });
  expect(await statusLote(l.id)).toBe('PLAN_READY');
  expect(await q('select id from creatives where variation_batch_id = $1', [l.id])).toHaveLength(0);
});

test('C-LT-13 launch com voz do catálogo e sem voiceId → 422 BATCH_INCOMPLETE { field: voiceId }', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  await q(`update variation_batches set settings = jsonb_set(settings, '{voiceId}', 'null') where id = $1`, [l.id]);
  const det = expectErro(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: 100 }), 422, 'BATCH_INCOMPLETE');
  expect(det.missing).toContainEqual({ field: 'voiceId' });
});

test('C-LT-14 launch com expectedCostUsd baixo → 409 ESTIMATE_CHANGED; teto estourado → 409 SPEND_CAP_EXCEEDED', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  if (e.costUsd > 0) {
    const det = expectErro(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd / 2 }), 409, 'ESTIMATE_CHANGED');
    expect(det.estimateUsd).toBeCloseTo(e.costUsd, 4);
  }
  // gasto do mês já no teto: qualquer estimativa > 0 estoura (sem depender do preço do catálogo)
  await q('update workspaces set monthly_spend_cap_usd = 1 where id = $1', [WS.A]);
  await q(`insert into cost_entries (id, workspace_id, provider, kind, model, units, unit, amount_usd) values ('qa_cost_cap', $1, 'WAVESPEED', 'LIPSYNC', 'qa', 40, 'second', 1)`, [WS.A]);
  expectErro(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: 1000 }), 409, 'SPEND_CAP_EXCEEDED');
  expect(await statusLote(l.id)).toBe('PLAN_READY');
});

test('C-LT-15 launch → 202 { batch LAUNCHED, creatives } em SCENES_GENERATING, nomes, variation, pipelines AUDIO_LIPSYNC/TTS_LIPSYNC/REUSE', async () => {
  const champion = await campeaoReal('membroA', 'A'); // AUDIO_LIPSYNC corta o áudio real do campeão
  const l = await criarLote('A', 'PLAN_READY', { champion, rostosEscolhidos: true, voiceSource: 'CHAMPION_AUDIO' });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  const r = expectOk(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd }), 202);
  expect(r.batch).toMatchObject({ id: l.id, status: 'LAUNCHED', launchedAt: expect.any(String) });
  expect(r.batch.progress).toMatchObject({ total: 5 });
  expect(r.creatives).toHaveLength(5);
  const nome = `${(await q('select name from champions where id = $1', [l.champion.id]))[0].name}`;
  for (const c of r.creatives) {
    expect(c.state).toBe('SCENES_GENERATING');
    expect(c.variation).toMatchObject({ championId: l.champion.id, championName: nome, batchId: l.id });
    expect(c.name.startsWith(`${nome} · `), c.name).toBe(true);
  }
  expect(r.creatives.filter((c: any) => c.variation.isControl)).toHaveLength(1);
  // contrato: "<campeão> · <rótulo do tipo> <n>" (controle: "… · Control"); o backend lê "…" como "<campeão> · <tipo>"
  expect(r.creatives.find((c: any) => c.variation.isControl).name).toMatch(new RegExp(`^${nome} · (.+ · )?Control$`));
  // banco: origin, item, script A selecionado com a alavanca, rosto do elenco, LIPSYNC
  const rows = await q(`select c.id, c.origin, c.variation_kind, c.voice_source, c.engine, c.selected_face_id, c.variation_item_id, s.letter, s.status as script_status, s.angle
                          from creatives c join scripts s on s.id = c.selected_script_id where c.variation_batch_id = $1`, [l.id]);
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    expect(row).toMatchObject({ origin: 'VARIATION', engine: 'LIPSYNC', letter: 'A', script_status: 'READY' });
    expect(row.selected_face_id).not.toBeNull();
    expect(row.angle).toBeTruthy();
  }
  const swap = rows.find((x: any) => x.variation_kind === 'SWAP_AVATAR');
  expect(swap.voice_source).toBe('CHAMPION_AUDIO');
  const pip = async (cid: string) => (await q('select index, pipeline, reuse_of_scene_id, source_start_sec, source_end_sec, take_id from scenes where creative_id = $1 order by index', [cid]));
  // §13.5 (06/10 noite): lipsync = 1 take por criativo; as cenas viram fatias TAKE_SLICE (AUDIO_LIPSYNC por cena só em criativo antigo)
  const [tkSwap] = await q('select id, kind, source_start_sec, source_end_sec from takes where creative_id = $1', [swap.id]);
  expect(tkSwap).toMatchObject({ kind: 'AUDIO_LIPSYNC' });
  expect(Number(tkSwap.source_end_sec) - Number(tkSwap.source_start_sec)).toBeGreaterThanOrEqual(2); // piso do Pruna
  for (const s of await pip(swap.id)) {
    expect(s.pipeline).toBe('TAKE_SLICE');
    expect(s.take_id).toBe(tkSwap.id);
  }
  const ctrlId = rows.find((x: any) => x.variation_item_id === l.items.find((i) => i.isControl)!.id).id;
  const ctrlScenes = await pip(ctrlId);
  // fábrica sem keepEdit (lote antigo, talking head limpo): cada criativo de gancho = 1 take TTS_LIPSYNC, cenas TAKE_SLICE
  for (const h of rows.filter((x: any) => x.variation_kind === 'NEW_HOOKS')) {
    const sc = await pip(h.id);
    console.log('[qa] C-LT-15 gancho', h.id === ctrlId ? 'controle' : 'item', JSON.stringify(sc.map((s: any) => s.pipeline)));
    expect(sc.every((s: any) => s.pipeline === 'TAKE_SLICE'), JSON.stringify(sc.map((s: any) => s.pipeline))).toBe(true);
  }
  void ctrlScenes;
  expect(await statusLote(l.id)).toBe('LAUNCHED');
});

test('C-LT-16 depois do launch (§13.5): nenhum REUSE; cada gancho tem o próprio take (1 LIPSYNC por criativo); criativos andam até RENDER_READY', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true, swaps: 0, hooks: 2 });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  const r = expectOk(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd }), 202);
  const ids = r.creatives.map((c: any) => c.id);
  await aguardar(() => q(`select state from creatives where id = any($1)`, [ids]), (rs) => rs.every((x: any) => x.state === 'RENDER_READY'),
    { timeoutMs: 120_000, intervalMs: 2000, oQue: 'variações chegarem em RENDER_READY (mock)' });
  expect(await q(`select id from scenes where creative_id = any($1) and pipeline = 'REUSE'`, [ids])).toHaveLength(0);
  for (const cid of ids) {
    const lip = await q(`select p.id from provider_tasks p join takes t on t.id = p.take_id where t.creative_id = $1 and p.kind = 'LIPSYNC'`, [cid]);
    expect(lip, `criativo ${cid}`).toHaveLength(1);
  }
  const b = await lerLote(l.id);
  expect(b.progress).toEqual({ total: 3, generating: 0, waiting: 3, failed: 0, approved: 0 });
});

test('C-LT-17 filtros novos: /creatives?origin=&championId=, /library?championId=&variationKind=', async () => {
  const l = await criarLote('A', 'PLAN_READY', { rostosEscolhidos: true });
  const e = expectOk(await as('membroA').get(`/variation-batches/${l.id}/estimate`));
  const r = expectOk(await as('membroA').post(`/variation-batches/${l.id}/launch`, { expectedCostUsd: e.costUsd }), 202);
  const doZero = await criarCriativoNoEstado('A', 'APPROVED');
  const ids = (res: any) => expectOk(res).map((c: any) => c.id);
  const varia = ids(await as('membroA').get('/creatives?origin=variation'));
  expect(varia.sort()).toEqual(r.creatives.map((c: any) => c.id).sort());
  expect(ids(await as('membroA').get('/creatives?origin=scratch'))).toEqual([doZero.id]);
  expect(ids(await as('membroA').get(`/creatives?championId=${l.champion.id}`)).sort()).toEqual(varia.sort());
  expect(expectOk(await as('membroA').get(`/creatives/${doZero.id}`)).variation).toBeNull();
  // biblioteca: aprova 1 variação na mão (fábrica) e filtra
  const swapId = r.creatives.find((c: any) => c.variation.kind === 'SWAP_AVATAR').id;
  await q(`update creatives set state = 'APPROVED', approved_at = now() where id = $1`, [swapId]);
  const lib = expectOk(await as('membroA').get(`/library?variationKind=SWAP_AVATAR`));
  for (const it of lib) expect(it.variation?.kind).toBe('SWAP_AVATAR');
  expect(expectOk(await as('membroA').get(`/library?championId=${l.champion.id}`)).every((it: any) => it.variation?.championId === l.champion.id)).toBe(true);
  expectErro(await as('membroA').get('/creatives?origin=clone'), 400, 'VALIDATION_ERROR');
});
