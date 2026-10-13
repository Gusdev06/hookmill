// Feature 2 · travas do criativo de variação (feature-2 §3.3; api.md "Mudanças 06/10" item 3, §7/§9/§10/§12).
// A alavanca é do lote: mudar roteiro/motor/voz/formato num item contamina o teste → 409 INVALID_STATE reason variation_locked.
// Pedido de ajuste fora do tipo → 409 reason change_not_available; review.changeOptions já vem filtrado.
// Depende de: B4b. PENDENTE até lá (projeto `feature2`).
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { estadoNoBanco } from '../../harness/fabrica.ts';
import { campeaoReal, criarCriativoVariacao, criarLote, esperarJobsQuietos } from '../../harness/f2.ts';
import { q } from '../../harness/db.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const GEN = { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', voiceId: 'Wise_Woman', format: 'SQUARE_1_1', expectedCostUsd: 1000, confirm: true } // formato diferente do lote: tem que travar;

test('E-TRV-01 rotas de roteiro, motor e Generate em criativo de variação → 409 variation_locked, estado não muda', async () => {
  for (const state of ['SCENES_FAILED', 'EDIT_PENDING', 'RENDER_READY'] as const) {
    const c = await criarCriativoVariacao('A', state, 'NEW_HOOKS');
    const base = `/creatives/${c.id}`;
    for (const [m, p, b] of [
      ['POST', `${base}/scripts/generate`, { count: 4, replace: true }],
      ['POST', `${base}/scripts/${c.scriptIds[0]}/regenerate`, { confirm: true }],
      ['POST', `${base}/scripts/${c.scriptIds[1]}/select`, { confirm: true }],
      ['PATCH', `${base}/scripts/${c.scriptIds[0]}`, { angle: 'outro' }],
      ['PATCH', `${base}/engine`, { format: 'SQUARE_1_1' }],
      ['POST', `${base}/generate`, GEN],
    ] as const) {
      const det = expectErro(await as('membroA').raw(m, p, b), 409, 'INVALID_STATE');
      expect(det.reason, `${state} ${m} ${p}`).toBe('variation_locked');
    }
    expect(await estadoNoBanco(c.id)).toBe(state);
  }
});

test('E-TRV-02 o que continua valendo na variação: regerar cena, editar texto, render, aprovar', async () => {
  // regerar cena AUDIO_LIPSYNC corta o áudio real do campeão: precisa de campeão de verdade no storage
  const champion = await campeaoReal('membroA', 'A');
  const lote = await criarLote('A', 'LAUNCHED', { champion, voiceSource: 'CHAMPION_AUDIO' });
  const c = await criarCriativoVariacao('A', 'SCENES_FAILED', 'SWAP_AVATAR', { lote });
  await q(`update scenes set source_start_sec = start_sec, source_end_sec = end_sec where creative_id = $1`, [c.id]);
  expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/2/regenerate`, {}), 202);
  const r = await criarCriativoVariacao('A', 'RENDER_READY', 'NEW_HOOKS');
  expectOk(await as('membroA').patch(`/creatives/${r.id}/edit`, { captionStyle: 'line' }));
  const a = await criarCriativoVariacao('A', 'RENDER_READY', 'SWAP_AVATAR');
  expect(expectOk(await as('membroA').post(`/creatives/${a.id}/approve`, {})).state).toBe('APPROVED');
});

test('E-TRV-03 changeOptions por tipo: SWAP com áudio original = TEXT, SCENE, FACE (sem LINE); NEW_HOOKS = TEXT, SCENE, LINE (sem FACE)', async () => {
  const swap = await criarCriativoVariacao('A', 'RENDER_READY', 'SWAP_AVATAR', { voiceSource: 'CHAMPION_AUDIO' });
  const tipos = async (id: string) => expectOk(await as('membroA').get(`/creatives/${id}/review`)).changeOptions.map((o: any) => o.type).sort();
  expect(await tipos(swap.id)).toEqual(['FACE', 'SCENE', 'TEXT']);
  const swapCat = await criarCriativoVariacao('A', 'RENDER_READY', 'SWAP_AVATAR', { voiceSource: 'CATALOG' });
  expect(await tipos(swapCat.id)).toEqual(['FACE', 'LINE', 'SCENE', 'TEXT']);
  const hook = await criarCriativoVariacao('A', 'RENDER_READY', 'NEW_HOOKS');
  expect(await tipos(hook.id)).toEqual(['LINE', 'SCENE', 'TEXT']);
});

test('E-TRV-04 pedido fora do tipo → 409 change_not_available (FACE em NEW_HOOKS, LINE em AUDIO_LIPSYNC); TEXT passa', async () => {
  const hook = await criarCriativoVariacao('A', 'RENDER_READY', 'NEW_HOOKS');
  expect(expectErro(await as('membroA').post(`/creatives/${hook.id}/changes`, { type: 'FACE' }), 409, 'INVALID_STATE').reason).toBe('change_not_available');
  expect(await estadoNoBanco(hook.id)).toBe('RENDER_READY');
  const swap = await criarCriativoVariacao('A', 'RENDER_READY', 'SWAP_AVATAR', { voiceSource: 'CHAMPION_AUDIO' });
  const det = expectErro(await as('membroA').post(`/creatives/${swap.id}/changes`, { type: 'LINE', sceneIndex: 0, newSpeech: 'outra fala' }), 409, 'INVALID_STATE');
  expect(det.reason).toBe('change_not_available');
  const t = expectOk(await as('membroA').post(`/creatives/${swap.id}/changes`, { type: 'TEXT' }));
  expect(t.returnTo).toBe('edit');
});

test('E-TRV-05 CreativeDetail de variação: steps offer/scripts/avatar/engine done, variation preenchido, engineLabel = rótulo do tipo', async () => {
  const c = await criarCriativoVariacao('A', 'SCENES_GENERATING', 'SWAP_AVATAR');
  const d = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  const st = Object.fromEntries(d.steps.map((s: any) => [s.step, s.state]));
  expect(st).toMatchObject({ offer: 'done', scripts: 'done', avatar: 'done', engine: 'done' });
  expect(d.variation).toMatchObject({ kind: 'SWAP_AVATAR', championId: c.lote.champion.id, batchId: c.lote.id, isControl: false });
  expect(typeof d.summary.engineLabel).toBe('string');
  expect(d.summary.engineLabel).not.toMatch(/pruna|kling|seedance/i);
});
