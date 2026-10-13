// Isolamento entre workspaces (modelo-de-dados: "workspace em tudo"; api.md: 404 NOT_FOUND, nunca 403, pra não vazar existência).
// O clonador antigo deixava um job ler a pasta do outro: aqui cada rota com id é atacada com o id de OUTRO workspace,
// e o banco de B é comparado byte a byte antes/depois. Depende de: B1 (guard JWT + workspace) e B2 (todas as rotas).
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, expectPagina } from '../../harness/api.ts';
import { q, WS, type Persona } from '../../harness/db.ts';
import { criarCriativoNoEstado, criarOferta, type CriativoFabricado } from '../../harness/fabrica.ts';

/** Foto de tudo que pertence ao workspace B (pra provar que nada mudou). */
async function fotoDeB(): Promise<string> {
  const tabelas = ['offers', 'creatives', 'scripts', 'faces', 'scenes', 'renders', 'files', 'jobs', 'change_requests', 'invites', 'memberships'];
  const out: Record<string, unknown> = {};
  for (const t of tabelas) out[t] = await q(`select * from "${t}" where workspace_id = $1 order by id`, [WS.B]);
  out.workspace = await q('select * from workspaces where id = $1', [WS.B]);
  return JSON.stringify(out);
}

interface Alvo { b: CriativoFabricado; bApproved: CriativoFabricado; bFailed: CriativoFabricado; jobId: string; fileId: string; inviteId: string }
async function montarB(): Promise<Alvo> {
  const offer = await criarOferta('B', { name: 'Segredo do B' });
  const b = await criarCriativoNoEstado('B', 'RENDER_READY', { offer });
  const bApproved = await criarCriativoNoEstado('B', 'APPROVED', { offer });
  const bFailed = await criarCriativoNoEstado('B', 'SCENES_FAILED', { offer });
  const jobId = 'qa_job_b';
  await q(`insert into jobs (id, workspace_id, type, status, input, output, offer_id, created_by_id) values ($1,$2,'OFFER_EXTRACT','SUCCEEDED','{}'::jsonb,'{"brief":{"what":"segredo"}}'::jsonb,$3,'qa_user_dono_b')`, [jobId, WS.B, offer.id]);
  const [f] = await q<{ file_id: string }>('select file_id from renders where id = $1', [b.renderIds[0]]);
  const inviteId = 'qa_invite_b';
  await q(`insert into invites (id, workspace_id, email, role, token_hash, expires_at, created_by_id) values ($1,$2,'conv-b@teste.local','MEMBER','qa-hash-b', now() + interval '7 days','qa_user_dono_b')`, [inviteId, WS.B]);
  return { b, bApproved, bFailed, jobId, fileId: f.file_id, inviteId };
}

/** Todas as rotas com id do api.md, apontadas pros recursos de B. */
function ataques(t: Alvo): [string, string, unknown?][] {
  const { b } = t;
  const c = `/creatives/${b.id}`;
  return [
    ['GET', `/offers/${b.offer.id}`], ['PATCH', `/offers/${b.offer.id}`, { name: 'hackeado' }], ['DELETE', `/offers/${b.offer.id}`],
    ['POST', `/offers/${b.offer.id}/reread`, { pageText: 'x' }],
    ['GET', `/jobs/${t.jobId}`],
    ['GET', c], ['PATCH', c, { name: 'hackeado' }], ['DELETE', c], ['GET', `${c}/events`],
    ['GET', `${c}/scripts`], ['POST', `${c}/scripts/generate`, { count: 1, replace: false }],
    ['POST', `${c}/scripts/${b.scriptIds[1]}/regenerate`, { confirm: true }],
    ['PATCH', `${c}/scripts/${b.scriptIds[1]}`, { angle: 'hackeado' }],
    ['POST', `${c}/scripts/${b.scriptIds[1]}/select`, { confirm: true }],
    ['GET', `${c}/faces`], ['POST', `${c}/faces/generate`, { description: 'alguém qualquer no vídeo' }],
    ['POST', `${c}/faces/${b.faceIds[1]}/select`, { confirm: true }], ['PATCH', `${c}/faces/description`, { description: 'hackeado hackeado' }],
    ['GET', `${c}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`], ['PATCH', `${c}/engine`, { format: 'SQUARE_1_1' }],
    ['POST', `${c}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: 100, confirm: true }],
    ['GET', `${c}/scenes`], ['POST', `/creatives/${t.bFailed.id}/scenes/2/regenerate`, {}],
    ['GET', `${c}/edit`], ['PATCH', `${c}/edit`, { captionStyle: 'off' }], ['POST', `${c}/render`, {}],
    ['GET', `${c}/renders/${b.renderIds[0]}`],
    ['GET', `${c}/review`], ['POST', `${c}/approve`, {}], ['POST', `${c}/changes`, { type: 'TEXT' }],
    ['PUT', `/library/${t.bApproved.id}/winner`, { isWinner: true }],
    ['GET', `/files/${t.fileId}`],
    ['DELETE', `/workspace/invites/${t.inviteId}`],
    ['PATCH', `/workspace/members/qa_user_dono_b`, { role: 'MEMBER' }], ['DELETE', `/workspace/members/qa_user_dono_b`],
  ];
}

for (const atacante of ['donoA', 'membroA', 'duplo'] as Persona[]) {
  test(`I-01 ${atacante} (token de A) recebe 404 NOT_FOUND em toda rota com id de B, e B fica intacto`, async () => {
    const alvo = await montarB();
    const antes = await fotoDeB();
    const falhas: string[] = [];
    for (const [m, path, body] of ataques(alvo)) {
      const r = await as(atacante).raw(m, path, body);
      // rotas de papel (OWNER/ADMIN): pra MEMBER, 403 FORBIDDEN também não vaza nada (o papel é checado antes do recurso)
      const rotaDePapel = path.startsWith('/workspace/');
      const ok =
        (r.status === 404 && r.body?.error?.code === 'NOT_FOUND') ||
        (rotaDePapel && atacante !== 'donoA' && r.status === 403 && r.body?.error?.code === 'FORBIDDEN');
      if (!ok) falhas.push(`${m} ${path} → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
      expect(JSON.stringify(r.body ?? '')).not.toContain('Segredo do B');
    }
    expect(falhas, `rotas que vazaram ou responderam fora do contrato:\n${falhas.join('\n')}`).toEqual([]);
    expect(await fotoDeB()).toBe(antes);
  });
}

test('I-02 listas de A nunca trazem nada de B (Home, ofertas, biblioteca, membros, spend)', async () => {
  const alvo = await montarB();
  await q(`insert into cost_entries (id, workspace_id, provider, kind, model, units, unit, amount_usd) values ('qa_cost_b','qa_ws_beta','WAVESPEED','VIDEO','kling',1,'call',42)`);
  const idsB = [alvo.b.id, alvo.bApproved.id, alvo.bFailed.id, alvo.b.offer.id];
  for (const path of ['/creatives?filter=all&limit=100', '/creatives?filter=needs_you', `/creatives?offerId=${alvo.b.offer.id}`, '/offers?limit=100', '/library', `/library?offerId=${alvo.b.offer.id}`]) {
    const r = await as('duplo').get(path);
    if (r.status === 400 || r.status === 404) continue; // filtro com offerId de B pode ser recusado; não pode é listar
    const txt = JSON.stringify(expectPagina(r)) + JSON.stringify(r.body.meta);
    for (const id of idsB) expect(txt, `${path} vazou ${id}`).not.toContain(id);
  }
  const membros = expectOk(await as('donoA').get('/workspace/members'));
  expect(JSON.stringify(membros)).not.toContain('qa_user_dono_b');
  expect(JSON.stringify(membros)).not.toContain('conv-b@teste.local');
  expect(expectOk(await as('donoA').get('/workspace/spend?month=' + new Date().toISOString().slice(0, 7))).spentUsd).toBe(0);
});

test('I-03 ids cruzados: criativo de A com roteiro/rosto/render de B → 404', async () => {
  const alvo = await montarB();
  const a = await criarCriativoNoEstado('A', 'RENDER_READY');
  const antes = await fotoDeB();
  const cA = `/creatives/${a.id}`;
  for (const [m, path, body] of [
    ['POST', `${cA}/scripts/${alvo.b.scriptIds[1]}/select`, { confirm: true }],
    ['PATCH', `${cA}/scripts/${alvo.b.scriptIds[1]}`, { angle: 'x' }],
    ['POST', `${cA}/scripts/${alvo.b.scriptIds[1]}/regenerate`, { confirm: true }],
    ['POST', `${cA}/faces/${alvo.b.faceIds[1]}/select`, { confirm: true }],
    ['GET', `${cA}/renders/${alvo.b.renderIds[0]}`],
  ] as [string, string, unknown?][]) {
    expectErro(await as('donoA').raw(m, path, body), 404, 'NOT_FOUND');
  }
  expect(await fotoDeB()).toBe(antes);
});

test('I-04 criar coisa em A apontando pra recurso de B: POST /creatives com offerId de B → 404, nada criado', async () => {
  const alvo = await montarB();
  expectErro(await as('donoA').post('/creatives', { offerId: alvo.b.offer.id }), 404, 'NOT_FOUND');
  const [{ n }] = await q<{ n: string }>(`select count(*) n from creatives where offer_id = $1 and workspace_id = $2`, [alvo.b.offer.id, WS.A]);
  expect(Number(n)).toBe(0);
});

test('I-05 workspace nunca vem do corpo nem da query: workspaceId no body → 400; na query → ignorado', async () => {
  await montarB();
  expectErro(await as('donoA').post('/offers', { name: 'x', language: 'en', workspaceId: WS.B }), 400, 'VALIDATION_ERROR');
  const r = await as('donoA').get(`/creatives?workspaceId=${WS.B}`);
  if (r.status === 200) expect(r.data.every((l: any) => !String(l.offer?.name).includes('Segredo do B'))).toBe(true);
  else expect(r.status).toBe(400);
  const [{ n }] = await q<{ n: string }>(`select count(*) n from offers where workspace_id = $1`, [WS.B]);
  expect(Number(n)).toBe(1);
});

test('I-06 o que A cria nasce no workspace do token (banco confirma workspace_id = A)', async () => {
  const o = expectOk(await as('duplo').post('/offers', { name: 'Do duplo', language: 'en', what: 'x', promise: 'y' }), 201);
  const [row] = await q<{ workspace_id: string }>('select workspace_id from offers where id = $1', [o.id]);
  expect(row.workspace_id).toBe(WS.A);
  expectErro(await as('donoB').get(`/offers/${o.id}`), 404, 'NOT_FOUND');
});

test('I-07 duplo depois do switch pra B não enxerga mais A', async () => {
  const a = await criarCriativoNoEstado('A', 'SCRIPTS_READY');
  const sw = expectOk(await as('duplo').post('/auth/switch-workspace', { workspaceId: WS.B }));
  expectErro(await call('GET', `/creatives/${a.id}`, { token: sw.accessToken }), 404, 'NOT_FOUND');
  expectOk(await as('duplo').get(`/creatives/${a.id}`)); // token antigo (wid = A) continua vendo A
});

test('I-08 arquivos no storage são por workspace: storage_key de B começa com ws/<B>/', async () => {
  // StorageService grava ws/<workspaceId>/<kind>/<cuid>.<ext>; a URL assinada de A nunca aponta pra chave de B
  const a = await criarCriativoNoEstado('A', 'RENDER_READY');
  const rv = expectOk(await as('donoA').get(`/creatives/${a.id}/review`));
  expect(decodeURIComponent(rv.video.url)).toContain(`ws/${WS.A}/`);
  expect(decodeURIComponent(rv.video.url)).not.toContain(`ws/${WS.B}/`);
});
