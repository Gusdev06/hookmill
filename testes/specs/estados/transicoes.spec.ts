// Máquina de estados do criativo (modelo-de-dados.md, "Transições (as únicas válidas)").
// Cada ação é disparada em cada estado de origem que o contrato define: estado permitido → vai pro destino certo;
// estado proibido → 409 INVALID_STATE com { state, allowed } e o banco NÃO muda.
// Estados que o contrato não define pra uma ação ficam fora da matriz (listados em CASOS.md como pergunta ao arquiteto).
// Depende de: B2 (CreativeStateMachine + rotas) e I1 (mock). Integrações sempre em mock: nada pago.
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectErro, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { subirSegundaApi } from '../../harness/segunda-api.ts';
import { criarCriativoNoEstado, criarOferta, estadoNoBanco, type CreativeState, type CriativoFabricado } from '../../harness/fabrica.ts';

interface Acao {
  nome: string;
  req: (c: CriativoFabricado) => [string, string, unknown];
  permitido: Partial<Record<CreativeState, CreativeState>>;
  proibido: CreativeState[];
}

const GEN = { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: 1000 };
const ACOES: Acao[] = [
  { nome: 'gerar roteiros', req: (c) => ['POST', `/creatives/${c.id}/scripts/generate`, { count: 4, replace: true }],
    permitido: { SCRIPTS_READY: 'SCRIPTS_WRITING', SCRIPTS_FAILED: 'SCRIPTS_WRITING' }, proibido: ['SCRIPTS_WRITING', 'APPROVED'] },
  { nome: 'escolher roteiro', req: (c) => ['POST', `/creatives/${c.id}/scripts/${c.scriptIds[1]}/select`, {}],
    permitido: { SCRIPTS_READY: 'AVATAR_PENDING' }, proibido: ['SCRIPTS_WRITING', 'SCRIPTS_FAILED', 'APPROVED'] },
  { nome: 'gerar rostos', req: (c) => ['POST', `/creatives/${c.id}/faces/generate`, { description: 'woman in her 30s, kitchen, natural light' }],
    permitido: { AVATAR_PENDING: 'FACES_GENERATING', FACES_READY: 'FACES_GENERATING', FACES_FAILED: 'FACES_GENERATING' },
    proibido: ['SCRIPTS_WRITING', 'SCRIPTS_READY', 'SCRIPTS_FAILED', 'FACES_GENERATING', 'APPROVED'] },
  { nome: 'escolher rosto', req: (c) => ['POST', `/creatives/${c.id}/faces/${c.faceIds[1]}/select`, {}],
    permitido: { FACES_READY: 'ENGINE_PENDING' }, proibido: ['FACES_GENERATING', 'FACES_FAILED', 'APPROVED'] },
  { nome: 'Generate', req: (c) => ['POST', `/creatives/${c.id}/generate`, GEN],
    permitido: { ENGINE_PENDING: 'SCENES_GENERATING' },
    proibido: ['SCRIPTS_READY', 'AVATAR_PENDING', 'FACES_READY', 'SCENES_GENERATING', 'RENDERING', 'APPROVED'] },
  { nome: 'regerar cena', req: (c) => ['POST', `/creatives/${c.id}/scenes/2/regenerate`, {}],
    permitido: { SCENES_FAILED: 'SCENES_GENERATING', EDIT_PENDING: 'SCENES_GENERATING', RENDER_FAILED: 'SCENES_GENERATING', RENDER_READY: 'SCENES_GENERATING' },
    proibido: ['ENGINE_PENDING', 'RENDERING', 'APPROVED'] },
  { nome: 'render', req: (c) => ['POST', `/creatives/${c.id}/render`, {}],
    permitido: { EDIT_PENDING: 'RENDERING', RENDER_FAILED: 'RENDERING', RENDER_READY: 'RENDERING' },
    proibido: ['ENGINE_PENDING', 'SCENES_GENERATING', 'SCENES_FAILED', 'RENDERING', 'APPROVED'] },
  { nome: 'aprovar', req: (c) => ['POST', `/creatives/${c.id}/approve`, {}],
    permitido: { RENDER_READY: 'APPROVED' }, proibido: ['SCENES_GENERATING', 'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'APPROVED'] },
  { nome: 'ajuste TEXT', req: (c) => ['POST', `/creatives/${c.id}/changes`, { type: 'TEXT', note: 'bigger CTA' }],
    permitido: { RENDER_READY: 'EDIT_PENDING' }, proibido: ['SCENES_GENERATING', 'EDIT_PENDING', 'RENDERING', 'APPROVED'] },
  { nome: 'ajuste SCENE', req: (c) => ['POST', `/creatives/${c.id}/changes`, { type: 'SCENE', sceneIndex: 1 }],
    permitido: { RENDER_READY: 'SCENES_GENERATING' }, proibido: ['RENDERING', 'APPROVED'] },
  { nome: 'ajuste LINE', req: (c) => ['POST', `/creatives/${c.id}/changes`, { type: 'LINE', sceneIndex: 1, newSpeech: 'A new line for QA.' }],
    permitido: { RENDER_READY: 'SCENES_GENERATING' }, proibido: ['RENDERING', 'APPROVED'] },
  { nome: 'ajuste FACE', req: (c) => ['POST', `/creatives/${c.id}/changes`, { type: 'FACE' }],
    permitido: { RENDER_READY: 'FACES_READY' }, proibido: ['RENDERING', 'APPROVED'] },
  { nome: 'mudar ajuste de edição', req: (c) => ['PATCH', `/creatives/${c.id}/edit`, { captionStyle: 'off' }],
    permitido: { RENDER_READY: 'EDIT_PENDING' }, proibido: ['APPROVED'] },
  { nome: 'mudar motor', req: (c) => ['PATCH', `/creatives/${c.id}/engine`, { format: 'SQUARE_1_1' }],
    permitido: { ENGINE_PENDING: 'ENGINE_PENDING' }, proibido: ['APPROVED'] },
];

for (const a of ACOES) {
  for (const [de, para] of Object.entries(a.permitido) as [CreativeState, CreativeState][]) {
    test(`E-OK ${a.nome}: ${de} → ${para}`, async () => {
      const c = await criarCriativoNoEstado('A', de);
      const [m, path, body] = a.req(c);
      const r = await as('membroA').raw(m, path, body);
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(200);
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      expect(await estadoNoBanco(c.id)).toBe(para);
    });
  }
  for (const de of a.proibido) {
    test(`E-409 ${a.nome} em ${de} → 409 INVALID_STATE e estado não muda`, async () => {
      const c = await criarCriativoNoEstado('A', de);
      const [m, path, body] = a.req(c);
      const d = expectErro(await as('membroA').raw(m, path, body), 409, 'INVALID_STATE');
      expect(d.state).toBe(de);
      expect(Array.isArray(d.allowed)).toBe(true);
      for (const s of Object.keys(a.permitido)) expect(d.allowed).toContain(s);
      expect(await estadoNoBanco(c.id)).toBe(de);
    });
  }
}

test('E-SEL-01 escolher roteiro com rostos já gerados → FACES_READY; com rosto já escolhido → ENGINE_PENDING', async () => {
  const c1 = await criarCriativoNoEstado('A', 'FACES_READY');
  await q(`update creatives set state = 'SCRIPTS_READY' where id = $1`, [c1.id]);
  expectOk(await as('membroA').post(`/creatives/${c1.id}/scripts/${c1.scriptIds[1]}/select`, {}));
  expect(await estadoNoBanco(c1.id)).toBe('FACES_READY');
  const c2 = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  await q(`update creatives set state = 'SCRIPTS_READY' where id = $1`, [c2.id]);
  expectOk(await as('membroA').post(`/creatives/${c2.id}/scripts/${c2.scriptIds[1]}/select`, {}));
  expect(await estadoNoBanco(c2.id)).toBe('ENGINE_PENDING');
});

test('E-RESET-01 trocar roteiro com cenas prontas: sem confirm → 409 CONFIRM_DOWNSTREAM_RESET; com confirm → cenas e renders stale', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  const d = expectErro(await as('membroA').post(`/creatives/${c.id}/scripts/${c.scriptIds[1]}/select`, {}), 409, 'CONFIRM_DOWNSTREAM_RESET');
  expect(d).toMatchObject({ scenesLost: 4, rendersLost: 1 });
  expect(d).toHaveProperty('spentUsd');
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
  expectOk(await as('membroA').post(`/creatives/${c.id}/scripts/${c.scriptIds[1]}/select`, { confirm: true }));
  expect(['ENGINE_PENDING', 'FACES_READY', 'AVATAR_PENDING']).toContain(await estadoNoBanco(c.id));
  const cenas = await q<{ stale: boolean }>('select stale from scenes where creative_id = $1', [c.id]);
  expect(cenas.length).toBe(4); // nada se apaga: histórico fica
  expect(cenas.every((s) => s.stale)).toBe(true);
  const [r] = await q<{ stale: boolean }>('select stale from renders where creative_id = $1', [c.id]);
  expect(r.stale).toBe(true);
});

test('E-RESET-02 trocar rosto com cenas prontas: sem confirm → 409 CONFIRM_DOWNSTREAM_RESET', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  expectErro(await as('membroA').post(`/creatives/${c.id}/faces/${c.faceIds[1]}/select`, {}), 409, 'CONFIRM_DOWNSTREAM_RESET');
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
});

test('E-APR-01 aprovar com editDirty = true → 409 INVALID_STATE', async () => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY', { editDirty: true });
  expectErro(await as('membroA').post(`/creatives/${c.id}/approve`, {}), 409, 'INVALID_STATE');
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
});

test('E-APR-02 APPROVED é final: nada a montante muda (rosto, roteiro, descrição)', async () => {
  const c = await criarCriativoNoEstado('A', 'APPROVED');
  for (const [m, path, body] of [
    ['POST', `/creatives/${c.id}/faces/${c.faceIds[1]}/select`, { confirm: true }],
    ['POST', `/creatives/${c.id}/scripts/${c.scriptIds[1]}/select`, { confirm: true }],
    ['POST', `/creatives/${c.id}/scripts/${c.scriptIds[1]}/regenerate`, { confirm: true }],
  ] as [string, string, unknown][]) {
    expect((await as('membroA').raw(m, path, body)).status, path).toBe(409);
  }
  expect(await estadoNoBanco(c.id)).toBe('APPROVED');
});

test('E-CAS-01 clique duplo no Generate: só um passa (202) e o outro recebe 409; cenas criadas uma vez só', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  const cli = as('membroA');
  const [r1, r2] = await Promise.all([cli.post(`/creatives/${c.id}/generate`, GEN), cli.post(`/creatives/${c.id}/generate`, GEN)]);
  expect([r1.status, r2.status].sort()).toEqual([202, 409]);
  const [{ n }] = await q<{ n: string }>('select count(distinct generation) n from scenes where creative_id = $1', [c.id]);
  expect(Number(n)).toBe(1);
});

test('E-CAS-02 clique duplo em gerar rostos: um lote só (4 rostos)', async () => {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  const cli = as('membroA');
  const body = { description: 'man in his 40s, office, daylight' };
  const rs = await Promise.all([cli.post(`/creatives/${c.id}/faces/generate`, body), cli.post(`/creatives/${c.id}/faces/generate`, body)]);
  expect(rs.map((r) => r.status).sort()).toEqual([202, 409]);
  const [{ n }] = await q<{ n: string }>('select count(*) n from faces where creative_id = $1', [c.id]);
  expect(Number(n)).toBe(4);
});

test('E-MOCK-01 rostos no mock: FACES_GENERATING → FACES_READY sozinho em segundos', async () => {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  expectOk(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'woman in her 30s, kitchen, natural light' }), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'FACES_GENERATING', { oQue: 'rostos do mock' });
  expect(await estadoNoBanco(c.id)).toBe('FACES_READY');
});

test('E-MOCK-02 geração no mock: SCENES_GENERATING → RENDERING (render automático) → RENDER_READY', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...GEN, expectedCostUsd: e.costUsd }), 202);
  const visto = new Set<string>();
  await aguardar(async () => { const s = await estadoNoBanco(c.id); visto.add(s); return s; }, (s) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), { timeoutMs: 180_000, intervalMs: 300, oQue: 'geração + render no mock' });
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
  expect([...visto]).toContain('RENDERING');
});

// ── falha de geração vira "esperando você", não trava (gatilhos oficiais do mock: api.md §17) ──

test('E-FALHA-01 rostos com [mock:SAFETY_BLOCK] → FACES_FAILED, chip failed, rosto com errorCode/action, aparece em needs_you; gerar de novo destrava', async () => {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  expectOk(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'woman in her 30s, kitchen [mock:SAFETY_BLOCK]' }), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'FACES_GENERATING', { oQue: 'rostos falharem' });
  expect(await estadoNoBanco(c.id)).toBe('FACES_FAILED');
  const d = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  expect(d.status).toBe('failed');
  const f = expectOk(await as('membroA').get(`/creatives/${c.id}/faces`));
  const lote = f.batches[0].faces;
  expect(lote).toHaveLength(4);
  for (const face of lote) {
    expect(face).toMatchObject({ status: 'FAILED', errorCode: 'SAFETY_BLOCK', action: 'change_description' });
    expect(typeof face.failReason).toBe('string');
  }
  expect(expectOk(await as('membroA').get('/creatives?filter=needs_you')).map((l: any) => l.id)).toContain(c.id);
  // não trava: nova descrição gera de novo
  expectOk(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'woman in her 30s, kitchen, daylight' }), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s === 'FACES_READY', { oQue: 'segundo lote de rostos' });
});

for (const code of ['PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'CANCELLED'] as const) {
  test(`E-FALHA-01b rostos com [mock:${code}] → FACES_FAILED com errorCode ${code}`, async () => {
    const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
    expectOk(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: `man in his 40s, office [mock:${code}]` }), 202);
    await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'FACES_GENERATING', { oQue: 'rostos falharem' });
    expect(await estadoNoBanco(c.id)).toBe('FACES_FAILED');
    const f = expectOk(await as('membroA').get(`/creatives/${c.id}/faces`));
    expect(f.batches[0].faces.every((x: any) => x.errorCode === code)).toBe(true);
  });
}

test('E-FALHA-02 uma cena com [mock:PROVIDER_ERROR] → as outras terminam, SCENES_FAILED; regerar a cena destrava até RENDER_READY', async () => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  const cli = as('membroA');
  expectOk(await cli.patch(`/creatives/${c.id}/scripts/${c.selectedScriptId}`, { blocks: [{ index: 2, speech: 'QA product line. [mock:PROVIDER_ERROR]' }] }));
  const e = expectOk(await cli.get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  expectOk(await cli.post(`/creatives/${c.id}/generate`, { ...GEN, expectedCostUsd: e.costUsd }), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'SCENES_GENERATING', { timeoutMs: 60_000, oQue: 'cenas terminarem' });
  expect(await estadoNoBanco(c.id)).toBe('SCENES_FAILED');
  const sc = expectOk(await cli.get(`/creatives/${c.id}/scenes`));
  const ruim = sc.scenes.filter((x: any) => x.status === 'FAILED');
  expect(ruim).toHaveLength(1);
  expect(ruim[0]).toMatchObject({ errorCode: 'PROVIDER_ERROR' });
  expect(ruim[0].speech).toContain('[mock:PROVIDER_ERROR]');
  expect(typeof ruim[0].failReason).toBe('string');
  expect(sc.scenes.filter((x: any) => x.status === 'READY')).toHaveLength(sc.scenes.length - 1);
  expect(sc.summary).toMatchObject({ failed: 1, ready: sc.scenes.length - 1, total: sc.scenes.length });
  expect(expectOk(await cli.get(`/creatives/${c.id}`)).status).toBe('failed');
  const s2 = expectOk(await cli.post(`/creatives/${c.id}/scenes/${ruim[0].index}/regenerate`, { speech: 'QA product line.' }), 202);
  expect(s2).toMatchObject({ status: 'QUEUED', attempt: ruim[0].attempt + 1 });
  expect(await estadoNoBanco(c.id)).toBe('SCENES_GENERATING');
  await aguardar(() => estadoNoBanco(c.id), (s) => ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED'].includes(s), { timeoutMs: 180_000, oQue: 'cena regerada + render' });
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
});

test('E-FALHA-02b regerar cena com outras gerando: alvo READY/FAILED passa, alvo GENERATING → 409 (Mudanças 05/10 §6)', async () => {
  const c = await criarCriativoNoEstado('A', 'SCENES_GENERATING'); // cenas 0-1 READY, 2-3 GENERATING
  expectErro(await as('membroA').post(`/creatives/${c.id}/scenes/2/regenerate`, {}), 409, 'INVALID_STATE');
  expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/0/regenerate`, {}), 202);
  expect(await estadoNoBanco(c.id)).toBe('SCENES_GENERATING');
});

test('E-FALHA-03 roteiros: [mock:fail-slot:1] → job PARTIAL, SCRIPTS_READY com B FAILED; "Write the other 1" repõe', async () => {
  const o = await criarOferta('A', { name: 'Parcial' });
  await q(`update offers set notes = '[mock:fail-slot:1]' where id = $1`, [o.id]);
  const c = expectOk(await as('membroA').post('/creatives', { offerId: o.id }), 201);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'SCRIPTS_WRITING', { oQue: 'roteiros' });
  expect(await estadoNoBanco(c.id)).toBe('SCRIPTS_READY');
  const s = expectOk(await as('membroA').get(`/creatives/${c.id}/scripts`));
  expect(s.job.status).toBe('PARTIAL');
  const falhos = s.scripts.filter((x: any) => x.status === 'FAILED');
  expect(falhos.map((x: any) => x.letter)).toEqual(['B']);
  expect(typeof falhos[0].failReason).toBe('string');
  expect(s.scripts.filter((x: any) => x.status === 'READY')).toHaveLength(3);
  await q(`update offers set notes = null where id = $1`, [o.id]);
  expectOk(await as('membroA').post(`/creatives/${c.id}/scripts/generate`, { count: 1, replace: false }), 202);
  await aguardar(() => estadoNoBanco(c.id), (st) => st === 'SCRIPTS_READY', { oQue: 'roteiro reposto' });
});

test('E-FALHA-03b roteiros: [mock:fail-all] → SCRIPTS_FAILED (chip failed); "Try again" destrava', async () => {
  const o = await criarOferta('A', { name: 'Tudo falha' });
  await q(`update offers set notes = '[mock:fail-all]' where id = $1`, [o.id]);
  const c = expectOk(await as('membroA').post('/creatives', { offerId: o.id }), 201);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'SCRIPTS_WRITING', { oQue: 'roteiros' });
  expect(await estadoNoBanco(c.id)).toBe('SCRIPTS_FAILED');
  expect(expectOk(await as('membroA').get(`/creatives/${c.id}`)).status).toBe('failed');
  await q(`update offers set notes = null where id = $1`, [o.id]);
  expectOk(await as('membroA').post(`/creatives/${c.id}/scripts/generate`, { count: 4, replace: true }), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s === 'SCRIPTS_READY', { oQue: 'nova rodada de roteiros' });
});

test('E-FALHA-04 render com [mock:RENDER_ERROR] no CTA → RENDER_FAILED com failedFrame, failReason e action render_again; "Render again" destrava', async () => {
  // gatilho do FakeRenderService (api/src/edicao/fake-render.service.ts); ainda NÃO está na §17 do api.md (pedido ao arquiteto)
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  const cli = as('membroA');
  expectOk(await cli.patch(`/creatives/${c.id}/edit`, { ctaText: 'Start now [mock:RENDER_ERROR]' }));
  expect(await estadoNoBanco(c.id)).toBe('EDIT_PENDING');
  const r = expectOk(await cli.post(`/creatives/${c.id}/render`, {}), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s !== 'RENDERING', { timeoutMs: 120_000, oQue: 'render terminar' });
  expect(await estadoNoBanco(c.id)).toBe('RENDER_FAILED');
  const rd = expectOk(await cli.get(`/creatives/${c.id}/renders/${r.id}`));
  expect(rd).toMatchObject({ status: 'FAILED', action: 'render_again' });
  expect(typeof rd.failReason).toBe('string');
  expect(typeof rd.failedFrame).toBe('number');
  expect(expectOk(await cli.get(`/creatives/${c.id}`)).status).toBe('failed');
  expectOk(await cli.patch(`/creatives/${c.id}/edit`, { ctaText: 'Start now' }));
  expectOk(await cli.post(`/creatives/${c.id}/render`, {}), 202);
  await aguardar(() => estadoNoBanco(c.id), (s) => s === 'RENDER_READY', { timeoutMs: 120_000, oQue: 'render de novo' });
});

for (const [gatilho, code, action] of [['mock-403', 'PAGE_FORBIDDEN', 'paste_page_text'], ['mock-unreadable', 'PAGE_UNREADABLE', null], ['mock-429', 'RATE_LIMITED', null]] as const) {
  test(`E-FALHA-05 extração com ${gatilho} → job FAILED ${code}${action ? ` e action ${action}` : ''}`, async () => {
    const j = expectOk(await as('membroA').post('/offers/extract', { url: `https://example.com/${gatilho}` }), 202);
    const fim = await aguardar(() => as('membroA').get(`/jobs/${j.id}`), (r) => ['SUCCEEDED', 'FAILED', 'PARTIAL'].includes(r.data?.status), { oQue: 'job de extração' });
    expect(fim.data).toMatchObject({ status: 'FAILED', errorCode: code });
    expect(typeof fim.data.failReason).toBe('string');
    if (action) expect(fim.data.action).toBe(action);
    if (code === 'PAGE_FORBIDDEN') {
      // o caminho que a tela oferece: colar o texto da página
      const j2 = expectOk(await as('membroA').post('/offers/extract', { pageText: 'Orbit Budget finds forgotten subscriptions. $9/mo.', url: `https://example.com/${gatilho}` }), 202);
      const ok = await aguardar(() => as('membroA').get(`/jobs/${j2.id}`), (r) => ['SUCCEEDED', 'FAILED'].includes(r.data?.status), { oQue: 'extração por texto' });
      expect(ok.data.status).toBe('SUCCEEDED');
    }
  });
}

test('E-BOOT-01 API reinicia com trabalho no meio → job FAILED INTERRUPTED, roteiros/rostos/cenas pendentes viram falha (nada trava), render volta pra fila', async () => {
  // estados "no meio" fabricados sem task viva = exatamente o que sobra quando a API cai
  const roteiro = await criarCriativoNoEstado('A', 'SCRIPTS_WRITING');
  await q(`insert into jobs (id, workspace_id, type, status, stage, input, creative_id, created_by_id, started_at)
           values ('qa_job_boot', 'qa_ws_alfa', 'SCRIPTS_GENERATE', 'RUNNING', 'writing', '{"count":4}'::jsonb, $1, 'qa_user_dono_a', now())`, [roteiro.id]);
  await q(`update scripts set job_id = 'qa_job_boot' where creative_id = $1`, [roteiro.id]);
  await q(`insert into jobs (id, workspace_id, type, status, stage, input, created_by_id, started_at)
           values ('qa_job_boot_extract', 'qa_ws_alfa', 'OFFER_EXTRACT', 'RUNNING', 'extracting', '{"url":"https://example.com"}'::jsonb, 'qa_user_dono_a', now())`);
  const rostos = await criarCriativoNoEstado('A', 'FACES_GENERATING');
  const cenas = await criarCriativoNoEstado('A', 'SCENES_GENERATING');
  const render = await criarCriativoNoEstado('A', 'RENDERING');

  const api2 = await subirSegundaApi();
  try {
    await aguardar(async () => (await q(`select status from jobs where id = 'qa_job_boot'`))[0].status, (s) => s === 'FAILED', { oQue: 'retomada do job' });
    const [j] = await q('select status, error_code from jobs where id = $1', ['qa_job_boot']);
    expect(j).toMatchObject({ status: 'FAILED', error_code: 'INTERRUPTED' });
    const [jx] = await q('select status, error_code from jobs where id = $1', ['qa_job_boot_extract']);
    expect(jx).toMatchObject({ status: 'FAILED', error_code: 'INTERRUPTED' });
    expect(await estadoNoBanco(roteiro.id)).toBe('SCRIPTS_FAILED');
    await aguardar(() => estadoNoBanco(rostos.id), (s) => s === 'FACES_FAILED', { oQue: 'rostos interrompidos' });
    await aguardar(() => estadoNoBanco(cenas.id), (s) => s === 'SCENES_FAILED', { oQue: 'cenas interrompidas' });
    // render: RENDERING órfão volta pra QUEUED e a fila pega de novo (aqui ele falha por falta dos clipes, o que também destrava)
    await aguardar(async () => api2.saida(), (o: string) => /retomada:.*"renders":1/.test(o), { oQue: 'log da retomada' });
    expect(api2.saida()).toMatch(/"jobs":2/);
    const [r] = await q('select status from renders where id = $1', [render.renderIds[0]]);
    expect(['QUEUED', 'RENDERING', 'FAILED', 'READY']).toContain(r.status);
  } finally {
    await api2.parar();
  }
});
