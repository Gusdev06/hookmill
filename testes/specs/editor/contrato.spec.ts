// Editor no vídeo v1 (F2d): contrato do GET/PUT /creatives/:id/editor (docs/contratos/editor-v1.md §2, §3.2, §4, §5, §9).
// API de teste (3111, mock, render fake), banco maquina_test. Nada pago. Dono: maquina-qa.
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, call, expectErro, expectOk, expectPagina } from '../../harness/api.ts';
import { PERSONAS, WS, q } from '../../harness/db.ts';
import { estadoNoBanco } from '../../harness/fabrica.ts';
import {
  CENAS, SETTINGS, criarCriativoEditor, criarRemixKeep, doc, esperarRender, getEditor, linha, ouvirSse, putEditor, salvar,
  semAssinatura, ultimoRender, videoLib, type EditDoc,
} from '../../harness/editor.ts';

const TOTAL = CENAS.reduce((a, c) => a + c.durSec, 0); // 15 s

test('ED-C-01 GET /editor: forma do EditorState (do zero, RENDER_READY, doc nulo)', async () => {
  const c = await criarCriativoEditor('A');
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st).toMatchObject({ revision: 0, base: 'scratch', composition: 'Criativo', doc: null, dirty: false, editedInEditor: false });
  expect(st.settings).toEqual(SETTINGS);
  // fonte: cenas vigentes na ordem, com URL assinada e as palavras do banco
  expect(st.source).toMatchObject({ format: 'VERTICAL_9_16', fps: 30, language: 'en' });
  expect(st.source.scenes.map((s: any) => s.sceneId)).toEqual(c.sceneIds);
  for (const [i, s] of st.source.scenes.entries()) {
    expect(s).toMatchObject({ index: i, label: CENAS[i].label, attempt: 1, durationSec: CENAS[i].durSec, clipStartSec: 0, thumbnail: null });
    expect(s.clip.url).toMatch(/X-Amz-Signature/);
    expect(s.clip.url).toContain(`ws/${WS.A}/`);
    expect(s.words).toEqual(c.cenas[i].words);
  }
  // URLs valem 6 h (api.md §1); o web refaz o GET 10 min antes
  const exp = Date.parse(st.urlsExpireAt) - Date.now();
  expect(exp).toBeGreaterThan(5.9 * 3600_000);
  expect(exp).toBeLessThan(6.1 * 3600_000);
  // camadas: os 3 fixos do zero, com os padrões do layoutPadrao (§5.1)
  const padrao = videoLib().layoutPadrao(SETTINGS.templateId, 'VERTICAL_9_16', SETTINGS, TOTAL);
  expect(st.layers.map((l: any) => l.id)).toEqual(['hook', 'caption', 'cta']);
  for (const l of st.layers) {
    expect(l).toMatchObject({ role: l.id, labelKey: `editor.layer.${l.id}`, lockedReason: null, leavesEmptyCover: false });
    expect(l.defaults.transform).toEqual(padrao[l.id].transform);
    expect(l.defaults.timing).toEqual(padrao[l.id].timing);
    expect(l.defaults.style).toEqual(padrao[l.id].style);
    expect(l.editable).toEqual({ move: true, text: l.id !== 'caption', style: true, timing: true, hide: true });
  }
  // tempo automático (§3.3): gancho 0..3 s, CTA nos últimos 3 s das cenas, legenda o vídeo todo
  expect(st.layers[0].defaults.timing).toEqual({ fromSec: 0, durationSec: 3 });
  expect(st.layers[2].defaults.timing.fromSec + st.layers[2].defaults.timing.durationSec).toBeCloseTo(TOTAL, 3);
  expect(st.layers[1].defaults.timing).toEqual({ fromSec: 0, durationSec: TOTAL });
  expect(st.layers[0].defaults.text).toBe(SETTINGS.headline);
  expect(st.layers[2].defaults.text).toBe(SETTINGS.ctaText);
  expect(st.capabilities).toMatchObject({ trimScenes: true, reorderScenes: true, trimVideo: false, fixCaptionWords: true });
  expect(Array.isArray(st.capabilities.locked)).toBe(true);
  expect(st.fonts.map((f: any) => f.id).sort()).toEqual(Object.keys(videoLib().FONT_CATALOG).sort());
  expect(st.fonts).toHaveLength(9);
  expect(st.latestRender?.id).toBe(c.renderIds[0]);
  expect(st.previewRender?.id).toBe(c.renderIds[0]);
});

test('ED-C-02 GET/PUT /editor: 404 com id que não existe, 401 sem token', async () => {
  expectErro(await getEditor('membroA', 'qa_creative_nao_existe'), 404, 'NOT_FOUND');
  expectErro(await putEditor('membroA', 'qa_creative_nao_existe', { baseRevision: 0, doc: null }), 404, 'NOT_FOUND');
  const c = await criarCriativoEditor('A');
  expect((await call('GET', `/creatives/${c.id}/editor`, { token: null })).status).toBe(401);
  expect((await call('PUT', `/creatives/${c.id}/editor`, { token: null, body: { baseRevision: 0, doc: null } })).status).toBe(401);
});

test('ED-C-03 PUT /editor: salva, devolve o doc normalizado, revisão + 1, RENDER_READY → EDIT_PENDING (EDIT_CHANGED)', async () => {
  const c = await criarCriativoEditor('A');
  const d = doc({ layers: [{ id: 'hook', transform: { x: 0.5, y: 0.3, scale: 1.2, rotationDeg: -8, boxWidth: 0.8 } }, { id: 'cta', style: { color: '#FFE14D' } }] });
  const r = expectOk(await putEditor('membroA', c.id, { baseRevision: 0, doc: d }));
  expect(r).toMatchObject({ revision: 1, dirty: true });
  expect(r.settings).toEqual(SETTINGS);
  expect(r.doc.layers).toEqual(expect.arrayContaining([
    { id: 'hook', transform: { x: 0.5, y: 0.3, scale: 1.2, rotationDeg: -8, boxWidth: 0.8 } },
    { id: 'cta', style: { color: '#FFE14D' } },
  ]));
  const l = await linha(c.id);
  expect(l).toMatchObject({ state: 'EDIT_PENDING', edit_revision: 1, edit_dirty: true });
  expect(l.edit_doc).toEqual(r.doc);
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st).toMatchObject({ revision: 1, dirty: true });
  expect(st.doc).toEqual(r.doc);
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/edit`));
  expect(e).toMatchObject({ hasEditorChanges: true, editorAvailable: true, dirty: true });
});

test('ED-C-04 PUT doc nulo = voltar tudo ao padrão (coluna nula, hasEditorChanges false)', async () => {
  const c = await criarCriativoEditor('A');
  await salvar('membroA', c.id, doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }));
  const r = expectOk(await putEditor('membroA', c.id, { baseRevision: 1, doc: null }));
  expect(r).toMatchObject({ revision: 2, doc: null, dirty: true });
  // §3.4/§4: "edit_doc nulo". Aceita NULL de SQL ou o JSON null do Prisma (JsonNull); anota qual (o comentário do backend diz "coluna nula")
  const [{ sql, json }] = await q<{ sql: boolean; json: boolean }>(`select edit_doc is null as sql, edit_doc = 'null'::jsonb as json from creatives where id = $1`, [c.id]);
  expect(sql || json).toBe(true);
  test.info().annotations.push({ type: 'edit_doc nulo', description: sql ? 'NULL de SQL' : "JSON null ('null'::jsonb), não NULL" });
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}/edit`)).hasEditorChanges).toBe(false);
});

test('ED-C-05 normalização (§5.4): arredonda pra frame, fim dentro de meio frame = fim da cena, ordem original inteira = [], camada igual ao padrão sai', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  const full = (s: typeof s0) => ({ sceneId: s.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: s.durSec });
  // corte em 0,51 s → frame 15 = 0,5 s; fim 2,99 num clipe de 3 s (dentro de meio frame) = 3
  let r = expectOk(await putEditor('membroA', c.id, { baseRevision: 0, doc: doc({ clips: [{ ...full(s0), inSec: 0.51, outSec: 2.99 }, full(s1), full(s2), full(s3)] }) }));
  expect(r.doc.clips[0]).toMatchObject({ sceneId: s0.sceneId, inSec: 0.5, outSec: 3 });
  // a ordem original, inteira e ativa = clips []
  r = expectOk(await putEditor('membroA', c.id, { baseRevision: 1, doc: doc({ clips: [full(s0), full(s1), full(s2), full(s3)], layers: [{ id: 'cta', visible: false }] }) }));
  expect(r.doc.clips).toEqual([]);
  expect(r.doc.layers).toEqual([{ id: 'cta', visible: false }]);
  // camada com transform/timing/estilo iguais ao padrão sai; doc que sobra vazio = null
  const st = expectOk(await getEditor('membroA', c.id));
  const hook = st.layers.find((x: any) => x.id === 'hook').defaults;
  r = expectOk(await putEditor('membroA', c.id, { baseRevision: 2, doc: doc({ layers: [{ id: 'hook', transform: hook.transform, timing: hook.timing, style: { color: hook.style.color } }] }) }));
  expect(r.doc).toBeNull();
});

test('ED-C-06 forma (DTO): 400 VALIDATION_ERROR com o caminho do campo; nada muda no banco', async () => {
  const c = await criarCriativoEditor('A');
  const casos: [string, unknown, string, string][] = [
    ['sem baseRevision', { doc: null }, 'baseRevision', ''],
    ['baseRevision negativo', { baseRevision: -1, doc: null }, 'baseRevision', 'min'],
    ['sem doc', { baseRevision: 0 }, 'doc', ''],
    ['version 2', { baseRevision: 0, doc: { ...doc(), version: 2 } }, 'doc.version', 'isIn'],
    ['scale 5 (0,25..4)', { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', transform: { x: 0.5, y: 0.5, scale: 5, rotationDeg: 0, boxWidth: 0.8 } }] }) }, 'doc.layers.0.transform.scale', 'max'],
    ['x 2 (-0,25..1,25)', { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', transform: { x: 2, y: 0.5, scale: 1, rotationDeg: 0, boxWidth: 0.8 } }] }) }, 'doc.layers.0.transform.x', 'max'],
    ['giro 200°', { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', transform: { x: 0.5, y: 0.5, scale: 1, rotationDeg: 200, boxWidth: 0.8 } }] }) }, 'doc.layers.0.transform.rotationDeg', 'max'],
    ['caixa 0,05', { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', transform: { x: 0.5, y: 0.5, scale: 1, rotationDeg: 0, boxWidth: 0.05 } }] }) }, 'doc.layers.0.transform.boxWidth', 'min'],
    ['campo a mais no topo', { baseRevision: 0, doc: null, workspaceId: WS.B }, 'workspaceId', 'notAllowed'],
    ['campo a mais na camada', { baseRevision: 0, doc: doc({ layers: [{ id: 'hook', foo: 1 } as any] }) }, 'doc.layers.0.foo', 'notAllowed'],
    ['template de remix nos settings', { baseRevision: 0, doc: null, settings: { templateId: 'remix-keep' } }, 'settings.templateId', 'isIn'],
    ['attempt 0', { baseRevision: 0, doc: doc({ clips: [{ sceneId: c.sceneIds[0], enabled: true, attempt: 0, inSec: 0, outSec: 1 }] }) }, 'doc.clips.0.attempt', 'min'],
    ['inSec negativo', { baseRevision: 0, doc: doc({ clips: [{ sceneId: c.sceneIds[0], enabled: true, attempt: 1, inSec: -1, outSec: 1 }] }) }, 'doc.clips.0.inSec', 'min'],
    ['texto da palavra não é string', { baseRevision: 0, doc: doc({ captionWords: [{ key: `${c.sceneIds[0]}@1:0`, text: 7 as any }] }) }, 'doc.captionWords.0.text', 'isString'],
  ];
  for (const [nome, body, field, rule] of casos) {
    const det = expectErro(await putEditor('membroA', c.id, body), 400, 'VALIDATION_ERROR');
    const f = (det?.fields ?? []) as { field: string; rule: string }[];
    expect(f.some((x) => x.field === field && (!rule || x.rule === rule)), `${nome}: ${JSON.stringify(f)}`).toBe(true);
  }
  expect(await linha(c.id)).toMatchObject({ state: 'RENDER_READY', edit_revision: 0, edit_doc: null, edit_dirty: false });
});

test('ED-C-07 §5.4 cada regra semântica → 400 VALIDATION_ERROR com details.fields[].rule; nada muda no banco', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  const full = (s: typeof s0, extra: object = {}) => ({ sceneId: s.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: s.durSec, ...extra });
  const todas = (extra: Record<number, object> = {}) => [s0, s1, s2, s3].map((s, i) => full(s, extra[i]));
  const muitas = (n: number, text = 'x') => Array.from({ length: n }, (_, i) => ({ key: `${s1.sceneId}@1:${i % s1.words.length}`, text }));
  const casos: [string, EditDoc, string, string][] = [
    ['cena desconhecida', doc({ clips: [...todas(), full({ ...s0, sceneId: 'qa_scene_nao_existe' })] }), 'clips[4].sceneId', 'unknown_scene'],
    ['falta uma cena', doc({ clips: todas().slice(0, 3) }), 'clips', 'clips_must_cover_scenes'],
    ['cena repetida', doc({ clips: [...todas(), full(s0)] }), 'clips', 'clips_must_cover_scenes'],
    ['nenhuma ativa', doc({ clips: todas({ 0: { enabled: false }, 1: { enabled: false }, 2: { enabled: false }, 3: { enabled: false } }) }), 'clips', 'no_enabled_clip'],
    ['fim depois da cena', doc({ clips: todas({ 0: { outSec: 99 } }) }), 'clips[0]', 'trim_out_of_range'],
    ['fim antes do começo', doc({ clips: todas({ 1: { inSec: 2, outSec: 1 } }) }), 'clips[1]', 'trim_out_of_range'],
    ['clipe com 0,2 s', doc({ clips: todas({ 2: { inSec: 1, outSec: 1.2 } }) }), 'clips[2]', 'clip_too_short'],
    ['vídeo com 0,5 s', doc({ clips: todas({ 0: { inSec: 0, outSec: 0.5 }, 1: { enabled: false }, 2: { enabled: false }, 3: { enabled: false } }) }), 'clips', 'video_too_short'],
    ['camada desconhecida', doc({ layers: [{ id: 'tarja-1' }] }), 'layers[0].id', 'unknown_layer'],
    ['cor que não é hex', doc({ layers: [{ id: 'cta', style: { color: 'red' } }] }), 'layers[0].style.color', 'bad_color'],
    ['destaque com 5 dígitos', doc({ layers: [{ id: 'caption', style: { highlightColor: '#12345' } }] }), 'layers[0].style.highlightColor', 'bad_color'],
    ['contorno inválido', doc({ layers: [{ id: 'hook', style: { strokeColor: '#GGGGGG' } }] }), 'layers[0].style.strokeColor', 'bad_color'],
    ['fundo rgb()', doc({ layers: [{ id: 'cta', style: { background: { kind: 'pill', color: 'rgb(0,0,0)' } } }] }), 'layers[0].style.background.color', 'bad_color'],
    ['fonte fora do catálogo', doc({ layers: [{ id: 'hook', style: { fontId: 'comic-sans' } }] }), 'layers[0].style.fontId', 'unknown_font'],
    ['51 camadas', doc({ layers: Array.from({ length: 51 }, () => ({ id: 'hook', visible: false })) }), 'layers', 'doc_too_large'],
    ['texto com 301', doc({ layers: [{ id: 'cta', text: 'x'.repeat(301) }] }), 'layers[0].text', 'doc_too_large'],
    ['2001 correções', doc({ captionWords: muitas(2001) }), 'captionWords', 'doc_too_large'],
    ['doc > 64 KB', doc({ captionWords: muitas(1200, 'y'.repeat(40)) }), 'doc', 'doc_too_large'],
    ['correção com 301', doc({ captionWords: [{ key: `${s0.sceneId}@1:0`, text: 'z'.repeat(301) }] }), 'captionWords[0].text', 'doc_too_large'],
    ['palavra de cena desconhecida', doc({ captionWords: [{ key: 'qa_scene_nao_existe@1:0', text: 'oi' }] }), 'captionWords[0].key', 'unknown_word'],
    ['índice além das palavras', doc({ captionWords: [{ key: `${s0.sceneId}@1:${s0.words.length}`, text: 'oi' }] }), 'captionWords[0].key', 'unknown_word'],
    ['chave mal formada', doc({ captionWords: [{ key: 'abc', text: 'oi' }] }), 'captionWords[0].key', 'unknown_word'],
  ];
  for (const [nome, d, field, rule] of casos) {
    const res = await putEditor('membroA', c.id, { baseRevision: 0, doc: d });
    const det = expectErro(res, 400, 'VALIDATION_ERROR');
    const f = (det?.fields ?? []) as { field: string; rule: string }[];
    expect(f.some((x) => x.field === field && x.rule === rule), `${nome}: ${JSON.stringify(f).slice(0, 400)}`).toBe(true);
  }
  expect(await linha(c.id)).toMatchObject({ state: 'RENDER_READY', edit_revision: 0, edit_doc: null, edit_dirty: false });
});

test('ED-C-08 trim no criativo do zero (só remix F4): recusado com trim_out_of_range ou 422 (divergência anotada)', async () => {
  const c = await criarCriativoEditor('A');
  const res = await putEditor('membroA', c.id, { baseRevision: 0, doc: doc({ trim: { inFrame: 0, outFrame: 30 } }) });
  // §2: "Do zero: sempre null". §5.4 lista trim_out_of_range; §5.4 também diz 422 EDIT_NOT_SUPPORTED pro que capabilities trava
  expect([400, 422], JSON.stringify(res.body)).toContain(res.status);
  if (res.status === 400) expect(res.body.error.details.fields).toEqual(expect.arrayContaining([{ field: 'trim', rule: 'trim_out_of_range' }]));
  expect((await linha(c.id)).edit_revision).toBe(0);
});

test('ED-C-09 EDIT_CONFLICT (409): baseRevision velho → details {revision, savedBy, savedAt}; banco intacto; PATCH /edit também conta', async () => {
  const c = await criarCriativoEditor('A');
  expectOk(await putEditor('donoA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', style: { color: '#7CF29A' } }] }) }));
  const antes = await linha(c.id);
  const det = expectErro(await putEditor('adminA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }) }), 409, 'EDIT_CONFLICT');
  expect(det).toMatchObject({ revision: 1, savedBy: { id: PERSONAS.donoA.id, name: PERSONAS.donoA.name } });
  expect(typeof det.savedBy.initials).toBe('string');
  expect(Math.abs(Date.parse(det.savedAt) - Date.now())).toBeLessThan(60_000);
  expect(await linha(c.id)).toEqual(antes);
  // PATCH /edit sobe a revisão (§4): o editor com a revisão velha recebe conflito, com quem salvou por último
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { ctaText: 'Try it free' }));
  const det2 = expectErro(await putEditor('donoA', c.id, { baseRevision: 1, doc: null }), 409, 'EDIT_CONFLICT');
  expect(det2).toMatchObject({ revision: 2, savedBy: { id: PERSONAS.membroA.id } });
  // com a revisão certa passa
  expect(expectOk(await putEditor('donoA', c.id, { baseRevision: 2, doc: null })).revision).toBe(3);
});

test('ED-C-10 dois PUT ao mesmo tempo com a mesma baseRevision: um passa, o outro 409 EDIT_CONFLICT', async () => {
  const c = await criarCriativoEditor('A');
  const [a, b] = await Promise.all([
    putEditor('donoA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', style: { color: '#7CF29A' } }] }) }),
    putEditor('adminA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }) }),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('EDIT_CONFLICT');
  expect((await linha(c.id)).edit_revision).toBe(1);
});

test('ED-C-11 autosave encadeado: 6 PUT seguidos com a revisão de volta = revisão 6, vale o último doc', async () => {
  const c = await criarCriativoEditor('A');
  let rev = 0;
  let ultimo: any = null;
  for (let i = 1; i <= 6; i++) {
    ultimo = expectOk(await putEditor('membroA', c.id, { baseRevision: rev, doc: doc({ layers: [{ id: 'hook', transform: { x: 0.5, y: 0.2 + i * 0.05, scale: 1, rotationDeg: 0, boxWidth: 0.8 } }] }) }));
    expect(ultimo.revision).toBe(rev + 1);
    rev = ultimo.revision;
  }
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st.revision).toBe(6);
  expect(st.doc.layers[0].transform.y).toBeCloseTo(0.5, 6);
});

test('ED-C-12 remix-keep (F3): GET/PUT = 422 EDIT_NOT_SUPPORTED com motivo; editorAvailable false; PATCH /edit continua variation_locked', async () => {
  const c = await criarRemixKeep('A');
  const g = expectErro(await getEditor('membroA', c.id), 422, 'EDIT_NOT_SUPPORTED');
  expect(typeof g?.reason, `details do 422: ${JSON.stringify(g)}`).toBe('string');
  expectErro(await putEditor('membroA', c.id, { baseRevision: 0, doc: null }), 422, 'EDIT_NOT_SUPPORTED');
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}/edit`)).editorAvailable).toBe(false);
  const p = expectErro(await as('membroA').patch(`/creatives/${c.id}/edit`, { ctaText: 'x' }), 409, 'INVALID_STATE');
  expect(p.reason).toBe('variation_locked');
  expect((await linha(c.id)).edit_revision).toBe(0);
});

test('ED-C-13 §3.2 trocar template apaga todo transform e mantém texto, tempo, cortes, cenas apagadas, correções e estilo', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  const d = doc({
    clips: [
      { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
      { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 1, outSec: 4 },
      { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
      { sceneId: s3.sceneId, enabled: false, attempt: 1, inSec: 0, outSec: 3 },
    ],
    layers: [
      { id: 'hook', transform: { x: 0.4, y: 0.25, scale: 1.3, rotationDeg: 5, boxWidth: 0.7 }, timing: { fromSec: 0.5, durationSec: 2 } },
      { id: 'caption', transform: { x: 0.5, y: 0.6, scale: 1, rotationDeg: 0, boxWidth: 0.9 }, style: { color: '#FFE14D' } },
      { id: 'cta', style: { background: { kind: 'pill', color: '#52A8FF' } } },
    ],
    captionWords: [{ key: `${s2.sceneId}@1:4`, text: 'subscription' }],
  });
  const salvo = await salvar('membroA', c.id, d);
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { templateId: 'bold' }));
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st.revision).toBe(salvo.revision + 1);
  expect(st.settings.templateId).toBe('bold');
  expect(st.doc.layers.every((l: any) => !l.transform), JSON.stringify(st.doc.layers)).toBe(true);
  expect(st.doc.clips).toEqual(salvo.doc.clips);
  expect(st.doc.captionWords).toEqual(salvo.doc.captionWords);
  expect(st.doc.layers.find((l: any) => l.id === 'hook')?.timing).toEqual({ fromSec: 0.5, durationSec: 2 });
  expect(st.doc.layers.find((l: any) => l.id === 'caption')?.style).toEqual({ color: '#FFE14D' });
  expect(st.doc.layers.find((l: any) => l.id === 'cta')?.style).toEqual({ background: { kind: 'pill', color: '#52A8FF' } });
  // ajuste que não é template nem posição: doc intacto
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { ctaText: 'Try it free' }));
  expect(expectOk(await getEditor('membroA', c.id)).doc).toEqual(st.doc);
});

test('ED-C-14 §3.2 trocar captionPosition apaga só o transform da legenda', async () => {
  const c = await criarCriativoEditor('A');
  await salvar('membroA', c.id, doc({ layers: [
    { id: 'hook', transform: { x: 0.4, y: 0.25, scale: 1.3, rotationDeg: 5, boxWidth: 0.7 } },
    { id: 'caption', transform: { x: 0.5, y: 0.6, scale: 1, rotationDeg: 0, boxWidth: 0.9 }, style: { uppercase: true } },
  ] }));
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { captionPosition: 'top' }));
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st.doc.layers.find((l: any) => l.id === 'hook').transform).toEqual({ x: 0.4, y: 0.25, scale: 1.3, rotationDeg: 5, boxWidth: 0.7 });
  const cap = st.doc.layers.find((l: any) => l.id === 'caption');
  expect(cap.transform).toBeUndefined();
  expect(cap.style).toEqual({ uppercase: true });
});

test('ED-C-15 regressão (bug do PATCH que zerava ajustes): PATCH /edit e PUT com 1 ajuste não apagam os outros', async () => {
  const c = await criarCriativoEditor('A');
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { captionStyle: 'line' }));
  let st = expectOk(await getEditor('membroA', c.id));
  expect(st.settings).toEqual({ ...SETTINGS, captionStyle: 'line' });
  expectOk(await putEditor('membroA', c.id, { baseRevision: st.revision, doc: null, settings: { endCard: false } }));
  st = expectOk(await getEditor('membroA', c.id));
  expect(st.settings).toEqual({ ...SETTINGS, captionStyle: 'line', endCard: false });
  expect((await linha(c.id)).edit_settings).toEqual({ ...SETTINGS, captionStyle: 'line', endCard: false });
});

test('ED-C-16 SSE editor.updated a cada PUT /editor e PATCH /edit, com {revision, savedBy, savedAt}', async () => {
  const c = await criarCriativoEditor('A');
  const { status, eventos } = await ouvirSse('membroA', c.id, async () => {
    expectOk(await putEditor('donoA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', visible: false }] }) }));
    expectOk(await as('adminA').patch(`/creatives/${c.id}/edit`, { ctaText: 'Go now' }));
  }, (evs) => evs.filter((e) => e.event === 'editor.updated').length >= 2);
  expect(status).toBe(200);
  const ed = eventos.filter((e) => e.event === 'editor.updated');
  expect(ed.map((e) => e.data.revision)).toEqual([1, 2]);
  expect(ed[0].data.savedBy).toMatchObject({ id: PERSONAS.donoA.id, name: PERSONAS.donoA.name });
  expect(ed[1].data.savedBy).toMatchObject({ id: PERSONAS.adminA.id });
  for (const e of ed) expect(Number.isNaN(Date.parse(e.data.savedAt))).toBe(false);
});

test('ED-C-17 export com doc: render.doc = cópia, render.editRevision = revisão, input = resolverProps(fonte, settings, doc); dirty por revisão', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  const d = doc({
    clips: [
      { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 1, outSec: 4 },   // aparada e na frente
      { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
      { sceneId: s1.sceneId, enabled: false, attempt: 1, inSec: 0, outSec: 4 },  // apagada
      { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    ],
    layers: [{ id: 'hook', transform: { x: 0.5, y: 0.22, scale: 1.1, rotationDeg: -6, boxWidth: 0.8 } }, { id: 'cta', style: { color: '#0A0A0A', background: { kind: 'pill', color: '#FFE14D' } } }],
    captionWords: [{ key: `${s2.sceneId}@1:4`, text: 'subscription' }, { key: `${s0.sceneId}@1:1`, text: '' }],
  });
  const salvo = await salvar('membroA', c.id, d);
  const fonte = expectOk(await getEditor('membroA', c.id));
  const rr = expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  expect(rr).toHaveProperty('doc');
  expect(rr).toHaveProperty('editRevision');
  const r = await esperarRender(c.id);
  expect(r.status).toBe('READY');
  expect(r.doc).toEqual(salvo.doc);
  expect(r.edit_revision).toBe(salvo.revision);
  const esperado = { renderId: r.id, fps: 30, ...videoLib().resolverProps(fonte.source, fonte.settings, fonte.doc) };
  expect(semAssinatura(r.input)).toEqual(semAssinatura(esperado));
  // o que o render tem que mostrar: cena 3 aparada na frente, cena 2 fora, palavra corrigida e escondida
  expect(r.input.scenes).toHaveLength(3);
  expect(r.input.scenes[0]).toMatchObject({ durationSec: 3, clipStartSec: 1 });
  const palavras0 = r.input.scenes[0].words.map((w: any) => w.word);
  expect(palavras0).toContain('subscription');
  expect(palavras0).not.toContain('subscripshun');
  expect(r.input.scenes[1].words.map((w: any) => w.word)).not.toContain('scrolling');
  expect(await linha(c.id)).toMatchObject({ state: 'RENDER_READY', edit_dirty: false });
  // selo "editado" (D1): linha, detalhe; depois de aprovar, a Biblioteca
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).editedInEditor).toBe(true);
  expect(expectOk(await as('membroA').get('/creatives')).find((x: any) => x.id === c.id).editedInEditor).toBe(true);
  expectOk(await as('membroA').post(`/creatives/${c.id}/approve`, {}));
  expect(expectPagina(await as('membroA').get('/library')).find((x: any) => x.id === c.id)?.editedInEditor).toBe(true);
});

test('ED-C-18 §5.3 OK final bloqueado com edição não exportada; exportar destrava', async () => {
  const c = await criarCriativoEditor('A');
  await salvar('membroA', c.id, doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }));
  expect(await linha(c.id)).toMatchObject({ state: 'EDIT_PENDING', edit_dirty: true });
  expectErro(await as('membroA').post(`/creatives/${c.id}/approve`, {}), 409, 'INVALID_STATE');
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  expect((await esperarRender(c.id)).status).toBe('READY');
  expect(await linha(c.id)).toMatchObject({ state: 'RENDER_READY', edit_dirty: false });
  // salvar de novo depois do export: volta a travar
  await salvar('membroA', c.id, doc({ layers: [{ id: 'cta', style: { color: '#52A8FF' } }] }));
  expectErro(await as('membroA').post(`/creatives/${c.id}/approve`, {}), 409, 'INVALID_STATE');
});

test('ED-C-19 PUT durante RENDERING: o render em curso termina e o criativo cai em EDIT_PENDING com editDirty (revisão ≠ renderizada)', async () => {
  const c = await criarCriativoEditor('A');
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  expect(await estadoNoBanco(c.id)).toBe('RENDERING');
  const r1 = expectOk(await putEditor('membroA', c.id, { baseRevision: 0, doc: doc({ layers: [{ id: 'cta', visible: false }] }) }));
  expect(r1.revision).toBe(1);
  const r = await esperarRender(c.id);
  expect(r.status).toBe('READY');
  expect(r.edit_revision).toBe(0);
  expect(await linha(c.id)).toMatchObject({ state: 'EDIT_PENDING', edit_dirty: true, edit_revision: 1 });
});

test('ED-C-20 palavra escondida (text: \'\'): sai da lista do render, o tempo das outras não muda', async () => {
  const c = await criarCriativoEditor('A');
  const s1 = c.cenas[1];
  await salvar('membroA', c.id, doc({ captionWords: [{ key: `${s1.sceneId}@1:2`, text: '' }] }));
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r = await esperarRender(c.id);
  const ws = r.input.scenes[1].words;
  expect(ws.map((w: any) => w.word)).toEqual(s1.words.filter((_, i) => i !== 2).map((w) => w.word));
  expect(ws.find((w: any) => w.word === s1.words[3].word)).toEqual(s1.words[3]);
});

test('ED-C-21 doc nulo = input de hoje: sem `layers`, cenas e palavras como vieram (§3.4)', async () => {
  const c = await criarCriativoEditor('A');
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r = await esperarRender(c.id);
  expect(r.doc).toBeNull();
  expect(r.input).not.toHaveProperty('layers');
  expect(r.input.scenes.map((s: any) => s.durationSec)).toEqual(CENAS.map((x) => x.durSec));
  expect(r.input.scenes.every((s: any) => !('clipStartSec' in s))).toBe(true);
  expect(r.input.scenes.map((s: any) => s.words)).toEqual(c.cenas.map((x) => x.words));
  expect(r.input).toMatchObject({ templateId: SETTINGS.templateId, headline: SETTINGS.headline, ctaText: SETTINGS.ctaText, endCard: true, captionStyle: 'word', captionPosition: 'bottom' });
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).editedInEditor).toBe(false);
});

test('ED-C-22 take fatiado (LIPSYNC, TAKE_SLICE): fonte com clipStartSec por fatia e a última até o fim; doc nulo emenda numa cena só', async () => {
  const c = await criarCriativoEditor('A', { take: true });
  const st = expectOk(await getEditor('membroA', c.id));
  let t = 0;
  for (const [i, s] of st.source.scenes.entries()) {
    expect(s.clipStartSec).toBeCloseTo(t, 3);
    expect(s.durationSec).toBeCloseTo(CENAS[i].durSec, 3);
    t += CENAS[i].durSec;
  }
  expect(new Set(st.source.scenes.map((s: any) => s.clip.url.split('?')[0])).size).toBe(1);
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r = await esperarRender(c.id);
  expect(r.input.scenes).toHaveLength(1);
  expect(r.input.scenes[0].durationSec).toBeCloseTo(TOTAL, 3);
  // aparar o meio de uma fatia quebra a emenda: vira cena separada com o corte certo
  const [s0, s1, s2, s3] = c.cenas;
  await salvar('membroA', c.id, doc({ clips: [
    { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 0.5, outSec: 4 },
    { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
    { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
  ] }));
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r2 = await esperarRender(c.id);
  expect(r2.input.scenes.map((s: any) => [s.clipStartSec ?? 0, s.durationSec])).toEqual([[0, 3], [3.5, 11.5]]);
});

test('ED-C-23 GET /edit: hasEditorChanges e editorAvailable', async () => {
  const c = await criarCriativoEditor('A');
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}/edit`))).toMatchObject({ hasEditorChanges: false, editorAvailable: true });
  await salvar('membroA', c.id, doc({ layers: [{ id: 'hook', visible: false }] }));
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}/edit`))).toMatchObject({ hasEditorChanges: true, editorAvailable: true });
  const ap = await criarCriativoEditor('A', { state: 'APPROVED' });
  expect(expectOk(await as('membroA').get(`/creatives/${ap.id}/edit`)).editorAvailable).toBe(false);
});

test('ED-C-24 regerar cena depois de um corte: durante a geração 409; depois, o corte e as correções da cena caem sozinhos (attempt 2)', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  await salvar('membroA', c.id, doc({
    clips: [
      { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0.5, outSec: 3 },
      { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 1, outSec: 3.5 },
      { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
      { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    ],
    captionWords: [{ key: `${s1.sceneId}@1:0`, text: 'Hey' }, { key: `${s0.sceneId}@1:0`, text: 'STOP' }],
  }));
  const sc = expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/1/regenerate`, {}), 202);
  expect(sc.attempt).toBe(2);
  expect(await estadoNoBanco(c.id)).toBe('SCENES_GENERATING');
  expectErro(await getEditor('membroA', c.id), 409, 'INVALID_STATE');
  expectErro(await putEditor('membroA', c.id, { baseRevision: 1, doc: null }), 409, 'INVALID_STATE');
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}/edit`)).editorAvailable).toBe(false);
  await aguardar(() => estadoNoBanco(c.id), (s) => s === 'RENDER_READY' || s === 'EDIT_PENDING' || s === 'RENDER_FAILED' || s === 'SCENES_FAILED', { timeoutMs: 120_000, oQue: 'cena regerada + render' });
  const st = expectOk(await getEditor('membroA', c.id));
  const cena1 = st.source.scenes.find((s: any) => s.sceneId === s1.sceneId);
  expect(cena1.attempt).toBe(2);
  const k1 = st.doc.clips.find((k: any) => k.sceneId === s1.sceneId);
  expect(k1).toMatchObject({ attempt: 2, inSec: 0, enabled: true });
  expect(k1.outSec).toBeCloseTo(cena1.durationSec, 3);
  expect(st.doc.clips.find((k: any) => k.sceneId === s0.sceneId)).toMatchObject({ attempt: 1, inSec: 0.5, outSec: 3 });
  expect(st.doc.captionWords).toEqual([{ key: `${s0.sceneId}@1:0`, text: 'STOP' }]);
  // o render automático depois da cena regerada usou a cena inteira
  const r = await ultimoRender(c.id);
  const fonteR = videoLib().resolverProps(st.source, st.settings, st.doc);
  expect(semAssinatura(r.input.scenes)).toEqual(semAssinatura(fonteR.scenes));
});

test('ED-C-25 Generate novo: zera cortes e correções, mantém as camadas; 409 enquanto as cenas novas geram', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  await salvar('membroA', c.id, doc({
    clips: [
      { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0.5, outSec: 3 },
      { sceneId: s1.sceneId, enabled: false, attempt: 1, inSec: 0, outSec: 4 },
      { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
      { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    ],
    layers: [{ id: 'hook', transform: { x: 0.45, y: 0.3, scale: 1.2, rotationDeg: 3, boxWidth: 0.8 } }],
    captionWords: [{ key: `${s0.sceneId}@1:0`, text: 'STOP' }],
  }));
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: e.costUsd, confirm: true }), 202);
  const l = await linha(c.id);
  expect(l.state).toBe('SCENES_GENERATING');
  expect(l.edit_doc?.clips).toEqual([]);
  expect(l.edit_doc?.captionWords).toEqual([]);
  expect(l.edit_doc?.layers).toEqual([{ id: 'hook', transform: { x: 0.45, y: 0.3, scale: 1.2, rotationDeg: 3, boxWidth: 0.8 } }]);
  expectErro(await getEditor('membroA', c.id), 409, 'INVALID_STATE');
  await aguardar(() => estadoNoBanco(c.id), (s) => ['RENDER_READY', 'EDIT_PENDING', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), { timeoutMs: 180_000, oQue: 'Generate novo + render' });
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st.source.scenes.map((s: any) => s.sceneId).some((x: string) => c.sceneIds.includes(x))).toBe(false);
  expect(st.doc).toEqual(doc({ layers: [{ id: 'hook', transform: { x: 0.45, y: 0.3, scale: 1.2, rotationDeg: 3, boxWidth: 0.8 } }] }));
});

test('ED-C-27 selo "editado" no item do lote (feature 2): variação do zero exportada com doc → items[].creative.editedInEditor', async () => {
  const { criarLote } = await import('../../harness/f2.ts');
  const lote = await criarLote('A', 'LAUNCHED');
  const it = lote.items.find((i) => i.kind === 'NEW_HOOKS' && !i.isControl)!;
  const c = await criarCriativoEditor('A', { renderDoc: doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }) });
  await q(`update creatives set origin = 'VARIATION', champion_id = $2, variation_batch_id = $3, variation_item_id = $4, variation_kind = 'NEW_HOOKS' where id = $1`,
    [c.id, lote.champion.id, lote.id, it.id]);
  // variação que NÃO é remix-keep é criativo do zero: o editor abre (F2)
  expectOk(await getEditor('membroA', c.id));
  const b = expectOk(await as('membroA').get(`/variation-batches/${lote.id}`));
  const item = b.items.find((x: any) => x.id === it.id);
  expect(item.creative?.id).toBe(c.id);
  expect(item.creative?.editedInEditor).toBe(true);
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).editedInEditor).toBe(true);
});

test('ED-C-28 doc que só tinha o corte da cena regerada: depois da regeração o vídeo sai sem ajuste, sem selo e sem "com ajustes"', async () => {
  const c = await criarCriativoEditor('A');
  const [s0, s1, s2, s3] = c.cenas;
  await salvar('membroA', c.id, doc({ clips: [
    { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 1, outSec: 4 },
    { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
    { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
  ] }));
  expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/1/regenerate`, {}), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => ['RENDER_READY', 'EDIT_PENDING', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), { timeoutMs: 120_000, oQue: 'cena regerada + render' });
  const st = expectOk(await getEditor('membroA', c.id));
  expect(st.doc).toBeNull(); // normalizado: o único ajuste era o corte da cena regerada
  const r = await ultimoRender(c.id);
  expect(r.status).toBe('READY');
  // o vídeo vigente saiu sem nenhum ajuste do editor (input = doc nulo)
  expect(semAssinatura(r.input.scenes)).toEqual(semAssinatura(videoLib().resolverProps(st.source, st.settings, null).scenes));
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/edit`));
  const d = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  test.info().annotations.push({ type: 'render.doc depois da regeração', description: JSON.stringify(r.doc) });
  expect.soft(d.editedInEditor, 'selo "editado" num vídeo sem ajuste (render.doc guardou o doc cru, com o corte velho)').toBe(false);
  expect.soft(e.hasEditorChanges, '"com ajustes" na Edição sem ajuste nenhum (edit_doc cru)').toBe(false);
});

test('ED-C-26 selo "editado" (D1) segue o render vigente: render sem doc depois de um com doc = sem selo', async () => {
  const c = await criarCriativoEditor('A', { renderDoc: doc({ layers: [{ id: 'cta', visible: false }] }) });
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).editedInEditor).toBe(true);
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  await esperarRender(c.id);
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).editedInEditor).toBe(false);
});
