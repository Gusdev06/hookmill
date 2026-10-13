// Fumaça da fábrica da feature 2: roda SEM API (npm run fumaca). Prova que o setup dos specs de feature2 bate com a
// migração 20261006120000_feature2_variar_campeao (colunas, enums, CHECK faces_owner_check) e que as fixtures existem.
import { test, expect } from '../../harness/fixtures.ts';
import { q } from '../../harness/db.ts';
import { criarCampeao, criarCriativoVariacao, criarLote, fixture, manifesto, type BatchStatus, type ChampionStatus } from '../../harness/f2.ts';

test('F2-FAB-01 campeão em cada estado; READY com teardown de 12 seções', async () => {
  for (const s of ['RESOLVING', 'ANALYZING', 'READY', 'FAILED'] as ChampionStatus[]) {
    const c = await criarCampeao('A', s);
    const [r] = await q('select status, has_speech, video_file_id from champions where id = $1', [c.id]);
    expect(r.status).toBe(s);
    expect(r.video_file_id === null).toBe(s === 'RESOLVING');
  }
  const [t] = await q(`select jsonb_object_keys(sections) k from teardowns limit 1`);
  expect(t).toBeTruthy();
  expect((await q(`select count(*)::int n from (select jsonb_object_keys(sections) from teardowns) x`))[0].n).toBe(12);
});

test('F2-FAB-02 lote em cada estado: SWAP 1 + NEW_HOOKS 3 + controle, elencos SHARED/ITEM e rostos de elenco', async () => {
  for (const s of ['PLANNING', 'PLAN_READY', 'PLAN_FAILED', 'LAUNCHED'] as BatchStatus[]) {
    const l = await criarLote('A', s, { rostosEscolhidos: true });
    expect(l.items).toHaveLength(5);
    expect(l.items.filter((i) => i.isControl)).toHaveLength(1);
    expect(l.castings.map((c) => c.scope).sort()).toEqual(['ITEM', 'SHARED']);
    const [b] = await q('select status from variation_batches where id = $1', [l.id]);
    expect(b.status).toBe(s);
  }
  // CHECK faces_owner_check: rosto sem dono nenhum é recusado pelo banco
  await expect(q(`insert into faces (id, workspace_id, batch, position, description, status, updated_at) values ('qa_face_orfa','qa_ws_alfa',1,0,'x','READY',now())`)).rejects.toThrow(/faces_owner_check/);
});

test('F2-FAB-03 criativo de variação: origin VARIATION, ligado ao lote/item, pipeline AUDIO_LIPSYNC no SWAP com áudio original', async () => {
  const c = await criarCriativoVariacao('A', 'RENDER_READY', 'SWAP_AVATAR');
  const [r] = await q('select origin, variation_kind, voice_source, engine, champion_id, variation_item_id from creatives where id = $1', [c.id]);
  expect(r).toMatchObject({ origin: 'VARIATION', variation_kind: 'SWAP_AVATAR', voice_source: 'CHAMPION_AUDIO', engine: 'LIPSYNC', champion_id: c.lote.champion.id, variation_item_id: c.itemId });
  expect((await q('select distinct pipeline from scenes where creative_id = $1', [c.id])).map((x) => x.pipeline)).toEqual(['AUDIO_LIPSYNC']);
});

test('F2-FAB-04 fixtures geradas e coerentes com o manifest (rode npm run fixtures se faltar)', () => {
  const m = manifesto();
  expect(m.fixtures.length).toBeGreaterThanOrEqual(11);
  expect(fixture('truncado-20s.mp4').decodificaInteiro).toBe(false);
  expect(fixture('fala-split-20s.mp4').decodificaInteiro).toBe(true);
});
