// Editor v1 (F2d): isolamento de workspace. Um membro nunca vê nem altera o editor de outro workspace (o clonador antigo
// deixava um job ler a pasta do outro). Contrato: rota de outro workspace = 404 (nunca 403/200), nada vaza no corpo.
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, tokenOf } from '../../harness/api.ts';
import { WS, q, type Persona } from '../../harness/db.ts';
import { criarCriativoEditor, doc, esperarRender, getEditor, linha, ouvirSse, putEditor, salvar } from '../../harness/editor.ts';

const DE_A: Persona[] = ['donoA', 'adminA', 'membroA', 'duplo'];

test('ED-I-01 GET/PUT /editor de um criativo de B por qualquer persona de A (inclusive quem é membro dos dois) = 404; banco de B intacto', async () => {
  const b = await criarCriativoEditor('B');
  await salvar('donoB', b.id, doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }));
  const antes = await linha(b.id);
  for (const p of DE_A) {
    const g = await getEditor(p, b.id);
    expectErro(g, 404, 'NOT_FOUND');
    expect(JSON.stringify(g.body)).not.toContain(b.sceneIds[0]);
    expect(JSON.stringify(g.body)).not.toContain('#E5484D');
    expectErro(await putEditor(p, b.id, { baseRevision: antes.edit_revision, doc: null }), 404, 'NOT_FOUND');
    expectErro(await putEditor(p, b.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', visible: false }] }) }), 404, 'NOT_FOUND');
    expectErro(await as(p).patch(`/creatives/${b.id}/edit`, { templateId: 'bold' }), 404, 'NOT_FOUND');
    expectErro(await as(p).post(`/creatives/${b.id}/render`, {}), 404, 'NOT_FOUND');
  }
  expect(await linha(b.id)).toEqual(antes);
  const [{ n }] = await q<{ n: string }>('select count(*) n from renders where creative_id = $1', [b.id]);
  expect(Number(n)).toBe(1);
});

test('ED-I-02 dono de B no criativo de A = 404 (o contrário também)', async () => {
  const a = await criarCriativoEditor('A');
  expectErro(await getEditor('donoB', a.id), 404, 'NOT_FOUND');
  expectErro(await putEditor('donoB', a.id, { baseRevision: 0, doc: null }), 404, 'NOT_FOUND');
  expect((await linha(a.id)).edit_revision).toBe(0);
});

test('ED-I-03 ids cruzados no doc: cena e palavra de B num criativo de A = 400 (unknown_scene/unknown_word), sem eco do B', async () => {
  const a = await criarCriativoEditor('A');
  const b = await criarCriativoEditor('B');
  const clips = a.cenas.map((c) => ({ sceneId: c.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: c.durSec }));
  const r1 = await putEditor('membroA', a.id, { baseRevision: 0, doc: doc({ clips: [...clips, { sceneId: b.sceneIds[0], enabled: true, attempt: 1, inSec: 0, outSec: 1 }] }) });
  const d1 = expectErro(r1, 400, 'VALIDATION_ERROR');
  expect(d1.fields).toEqual(expect.arrayContaining([{ field: 'clips[4].sceneId', rule: 'unknown_scene' }]));
  const r2 = await putEditor('membroA', a.id, { baseRevision: 0, doc: doc({ captionWords: [{ key: `${b.sceneIds[0]}@1:0`, text: 'x' }] }) });
  expect(expectErro(r2, 400, 'VALIDATION_ERROR').fields).toEqual(expect.arrayContaining([{ field: 'captionWords[0].key', rule: 'unknown_word' }]));
  for (const r of [r1, r2]) {
    expect(JSON.stringify(r.body)).not.toContain(WS.B);
    expect(JSON.stringify(r.body)).not.toContain('X-Amz');
  }
  expect((await linha(a.id)).edit_revision).toBe(0);
  expect((await linha(b.id)).edit_revision).toBe(0);
});

test('ED-I-04 a fonte do editor e o input do render só apontam pra arquivos do workspace do token', async () => {
  const a = await criarCriativoEditor('A');
  await criarCriativoEditor('B');
  const st = expectOk(await getEditor('duplo', a.id));
  for (const s of st.source.scenes) expect(new URL(s.clip.url).pathname).toContain(`/ws/${WS.A}/`);
  expectOk(await as('duplo').post(`/creatives/${a.id}/render`, {}), 202);
  const r = await esperarRender(a.id);
  expect(r.workspace_id).toBe(WS.A);
  for (const s of r.input.scenes) expect(new URL(s.clipUrl).pathname).toContain(`/ws/${WS.A}/`);
  expect(JSON.stringify(r.input)).not.toContain(WS.B);
});

test('ED-I-05 SSE do criativo de A com token de B = 404; o B não recebe editor.updated do A', async () => {
  const a = await criarCriativoEditor('A');
  const { status } = await ouvirSse('donoB', a.id, async () => undefined, () => true, 2000);
  expect(status).toBe(404);
  const b = await criarCriativoEditor('B');
  const { eventos } = await ouvirSse('donoB', b.id, async () => { await salvar('membroA', a.id, doc({ layers: [{ id: 'cta', visible: false }] })); }, () => false, 2500);
  expect(eventos.filter((e) => e.event === 'editor.updated')).toEqual([]);
});

test('ED-I-06 workspaceId no corpo do PUT não troca de workspace (400 notAllowed) e o 404 vem antes de validar', async () => {
  const a = await criarCriativoEditor('A');
  const b = await criarCriativoEditor('B');
  expect((await putEditor('membroA', a.id, { baseRevision: 0, doc: null, workspaceId: WS.B })).status).toBe(400);
  // corpo inválido: o pipe valida antes da rota, então dá 400 pra qualquer id (existente ou não) e não revela nada do B
  const r = await call('PUT', `/creatives/${b.id}/editor`, { token: await tokenOf('membroA'), body: { baseRevision: 'x' } });
  const r404 = await call('PUT', `/creatives/qa_creative_nao_existe/editor`, { token: await tokenOf('membroA'), body: { baseRevision: 'x' } });
  expect(r.status).toBe(r404.status);
  expect((await linha(b.id)).edit_revision).toBe(0);
});
