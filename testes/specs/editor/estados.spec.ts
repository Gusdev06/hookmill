// Editor v1 (F2d): máquina de estados. GET/PUT /editor e GET /edit.editorAvailable em cada um dos 15 estados do criativo
// (editor-v1 §5: "409 INVALID_STATE sem cenas prontas, em APPROVED ou em SCENES_GENERATING de Generate novo"; PUT só em
// EDITABLE, RENDER_READY → EDIT_PENDING). Falha de render vira "esperando você" e não trava o editor.
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { STATES, estadoNoBanco, type CreativeState } from '../../harness/fabrica.ts';
import { criarCriativoEditor, doc, esperarRender, getEditor, linha, putEditor } from '../../harness/editor.ts';

// abre: todas as cenas vigentes READY com clipe, estado editável
const ABRE: CreativeState[] = ['EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'RENDER_READY'];
// PUT: o que acontece com o estado
const DEPOIS_DO_PUT: Partial<Record<CreativeState, CreativeState>> = {
  EDIT_PENDING: 'EDIT_PENDING', RENDERING: 'RENDERING', RENDER_FAILED: 'RENDER_FAILED', RENDER_READY: 'EDIT_PENDING',
};

for (const s of STATES) {
  test(`ED-E-01 ${s}: GET /editor ${ABRE.includes(s) ? '200' : '409'} · PUT ${DEPOIS_DO_PUT[s] ? `→ ${DEPOIS_DO_PUT[s]}` : '409'} · editorAvailable ${ABRE.includes(s)}`, async () => {
    const c = await criarCriativoEditor('A', { state: s });
    const g = await getEditor('membroA', c.id);
    if (ABRE.includes(s)) {
      expect(expectOk(g).revision).toBe(0);
    } else {
      const det = expectErro(g, 409, 'INVALID_STATE');
      expect(det?.state).toBe(s);
    }
    const p = await putEditor('membroA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', visible: false }] }) });
    const alvo = DEPOIS_DO_PUT[s];
    if (alvo) {
      expect(expectOk(p).revision).toBe(1);
      expect(await linha(c.id)).toMatchObject({ state: alvo, edit_revision: 1, edit_dirty: true });
    } else {
      expectErro(p, 409, 'INVALID_STATE');
      expect(await linha(c.id)).toMatchObject({ state: s, edit_revision: 0 });
    }
    // GET /edit: só existe com ajustes de edição; quando existe, editorAvailable concorda com o GET /editor
    const e = await as('membroA').get(`/creatives/${c.id}/edit`);
    if (e.status === 200) expect(e.data.editorAvailable, JSON.stringify(e.data)).toBe(ABRE.includes(s) || false);
    else expectErro(e, 409, 'INVALID_STATE');
  });
}

test('ED-E-02 falha de render vira "esperando você" e não trava: RENDER_FAILED abre o editor, salva e exporta de novo até RENDER_READY', async () => {
  const c = await criarCriativoEditor('A');
  // gatilho oficial do render fake (api.md §17): ctaText com [mock:RENDER_ERROR]
  const st = expectOk(await getEditor('membroA', c.id));
  expectOk(await putEditor('membroA', c.id, { baseRevision: st.revision, doc: doc({ layers: [{ id: 'hook', visible: false }] }), settings: { ctaText: 'Start now [mock:RENDER_ERROR]' } }));
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r = await esperarRender(c.id);
  expect(r.status).toBe('FAILED');
  expect(r.failed_frame).not.toBeNull();
  expect(await estadoNoBanco(c.id)).toBe('RENDER_FAILED');
  const d = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  expect(d.status).toBe('failed');
  expect(expectOk(await as('membroA').get('/creatives?filter=needs_you')).map((x: any) => x.id)).toContain(c.id);
  // o editor continua abrindo, mostra o render que falhou e deixa corrigir
  const st2 = expectOk(await getEditor('membroA', c.id));
  expect(st2.latestRender).toMatchObject({ status: 'FAILED' });
  expectOk(await putEditor('membroA', c.id, { baseRevision: st2.revision, doc: st2.doc, settings: { ctaText: 'Start now' } }));
  expect(await estadoNoBanco(c.id)).toBe('RENDER_FAILED');
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  expect((await esperarRender(c.id)).status).toBe('READY');
  expect(await linha(c.id)).toMatchObject({ state: 'RENDER_READY', edit_dirty: false });
  expectOk(await as('membroA').post(`/creatives/${c.id}/approve`, {}));
  expect(await estadoNoBanco(c.id)).toBe('APPROVED');
  // depois do OK final o editor fecha
  expectErro(await getEditor('membroA', c.id), 409, 'INVALID_STATE');
});
