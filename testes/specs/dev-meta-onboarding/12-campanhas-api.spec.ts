// Campaigns v1 (docs/contratos/campanhas-v1.md §3-§6, §10) pela API, em mock (FakeMetaService), API isolada no maquina_test.
// Nenhuma escrita real na Meta: META_MODE=mock. Cada teste cria conta nova (qa-final-*).
import { test, expect } from '@playwright/test';
import { as, atePublicacao, call, conectarMeta, convidar, criativoAprovado, prepararWorkspace, signup, sql } from './dev.ts';

test.use({ actionTimeout: 20_000 });

async function conta(label: string) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await conectarMeta(c);
  return c;
}
const ok = (r: any, s = 200) => { expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(s); return r.data; };
const err = (r: any, s: number, code: string) => { expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(s); expect(r.body.error.code).toBe(code); return r.body.error.details; };
const ST = (status: string, expected: string, extra: Record<string, unknown> = {}) => ({ status, expected, confirm: true, ...extra });

test('CA-01 leitura: 3 campanhas, totais, counts, CBO/ABO/vitalício, aprendizado, ordem e dir, filtros, busca com matchedIn', async () => {
  const c = await conta('ca1');
  const a = as(c);
  const r = await a.get('/meta/campaigns');
  const rows = ok(r);
  const m = r.body.meta;
  expect(rows.map((x: any) => x.id).sort()).toEqual(['mock_cmp_abo', 'mock_cmp_cbo', 'mock_cmp_life']);
  expect(m.period).toBe('30d');
  expect(m.currency).toBe('USD');
  expect(m.truncated).toBe(false);
  expect(m.sync.state).toBe('ok');
  expect(m.totals.spend).toBeGreaterThan(0);
  const by = Object.fromEntries(rows.map((x: any) => [x.id, x]));
  expect(by.mock_cmp_cbo.isCbo).toBe(true);
  expect(by.mock_cmp_cbo.budget).toMatchObject({ level: 'campaign', kind: 'daily', amountMinor: 5000, editable: true, minimumMinor: 500 });
  expect(by.mock_cmp_cbo.anyAdsetLearning).toBe(true);
  expect(by.mock_cmp_abo.budget).toMatchObject({ level: null, editable: false });
  expect(by.mock_cmp_life.budget).toMatchObject({ kind: 'lifetime', editable: false });
  // no mock o link do Ads Manager é '#' (PORTA.md: `adsManagerUrl` "# no mock"); o formato real é testado na unitária da ia
  test.info().annotations.push({ type: 'adsManagerUrl mock', description: String(by.mock_cmp_cbo.adsManagerUrl) });
  expect(by.mock_cmp_cbo.adsManagerUrl).toBeTruthy();
  // ordem: spend desc padrão; dir asc inverte; name asc
  const spends = rows.map((x: any) => x.metrics.spend);
  expect(spends).toEqual([...spends].sort((x: number, y: number) => y - x));
  const asc = ok(await a.get('/meta/campaigns?sort=spend&dir=asc')).map((x: any) => x.metrics.spend);
  expect(asc).toEqual([...asc].sort((x: number, y: number) => x - y));
  const names = ok(await a.get('/meta/campaigns?sort=name&dir=asc')).map((x: any) => x.name);
  expect(names).toEqual([...names].sort((x: string, y: string) => x.localeCompare(y)));
  // 7d: delta existe (metricsPrev7d), 30d sem janela anterior
  const s7 = await a.get('/meta/campaigns?period=7d');
  expect(s7.body.meta.period).toBe('7d');
  expect(ok(s7)[0].metricsPrev7d).toBeTruthy();
  // counts ignoram status; filtros batem com counts
  const counts = m.counts;
  for (const st of ['active', 'paused', 'issues'] as const) {
    const f = await a.get(`/meta/campaigns?status=${st}`);
    test.info().annotations.push({ type: `status=${st}`, description: `${f.data.length} linhas, counts.${st} = ${counts[st]}, counts após filtro ${JSON.stringify(f.body.meta.counts)}` });
    expect(f.data.length, `status=${st} bate com counts`).toBe(counts[st]);
    expect(f.body.meta.counts).toEqual(counts);
  }
  // busca: nome de anúncio abre o pai (matchedIn ['ad']); nome de conjunto (['adset']); nada → vazio
  const q1 = ok(await a.get('/meta/campaigns?q=testimonial'));
  expect(q1.map((x: any) => x.id)).toEqual(['mock_cmp_abo']);
  expect(q1[0].matchedIn).toEqual(['ad']);
  const q2 = ok(await a.get('/meta/campaigns?q=lookalike'));
  expect(q2.map((x: any) => x.id)).toEqual(['mock_cmp_cbo']);
  expect(q2[0].matchedIn).toContain('adset');
  const q3 = ok(await a.get('/meta/campaigns?q=prospecting'));
  expect(q3[0].matchedIn).toEqual([]);
  expect(ok(await a.get('/meta/campaigns?q=zzzz-nada')).length).toBe(0);
  // detalhe: conjuntos + anúncios de todos os formatos
  const d = ok(await a.get('/meta/campaigns/mock_cmp_cbo'));
  const ads = d.adsets.flatMap((s: any) => s.ads);
  expect(ads.some((x: any) => x.videoId === null && x.canIterate === false)).toBe(true);
  expect(d.adsets.find((s: any) => s.id === 'mock_adset_cbo_2').learningStage).toBe('LEARNING');
  expect(d.adsets[0].budget).toMatchObject({ level: 'campaign', editable: false });
  err(await a.get('/meta/campaigns/nao_existe'), 404, 'NOT_FOUND');
  err(await a.get('/meta/campaigns?period=90d'), 400, 'VALIDATION_ERROR');
});

test('CA-02 Ads only e Home/Pick: /meta/ads padrão = só vídeo (8, os mesmos WINNER), format=all = 10, dir no servidor, counts', async () => {
  const c = await conta('ca2');
  const a = as(c);
  const v = await a.get('/meta/ads');
  const vids = ok(v);
  expect(vids.length).toBe(8);
  expect(vids.every((x: any) => x.videoId)).toBe(true);
  expect(vids.filter((x: any) => x.verdict === 'WINNER').map((x: any) => x.metaAdId).sort()).toEqual(['mock_ad_1', 'mock_ad_2']);
  const all = ok(await a.get('/meta/ads?format=all'));
  expect(all.length).toBe(10);
  expect(all.find((x: any) => x.metaAdId === 'mock_ad_img_1').verdict, 'imagem julgada pela régua de vídeo').toBe('WINNER');
  const asc = ok(await a.get('/meta/ads?format=all&sort=spend&dir=asc')).map((x: any) => x.metrics.spend);
  expect(asc).toEqual([...asc].sort((x: number, y: number) => x - y));
  const desc = ok(await a.get('/meta/ads?format=all&dir=desc')).map((x: any) => x.metrics.spend);
  expect(desc).toEqual([...desc].sort((x: number, y: number) => y - x));
  const cAll = (await a.get('/meta/ads?format=all')).body.meta.counts;
  const cPaused = await a.get('/meta/ads?format=all&status=paused');
  expect(cPaused.data.length).toBe(cAll.paused);
  expect(cPaused.body.meta.counts).toEqual(cAll);
  // os nomes de campanha/conjunto vêm na linha
  expect(all[0].campaign?.name).toBeTruthy();
  expect(all[0].adset?.name).toBeTruthy();
  // Iterate de imagem = 409 not_a_video
  const it = await a.post('/iterate', { metaAdId: 'mock_ad_img_1' });
  test.info().annotations.push({ type: 'iterate imagem', description: `${it.status} ${JSON.stringify(it.body).slice(0, 200)}` });
  expect(it.status).toBe(409);
  expect(it.body.error.details?.reason).toBe('not_a_video');
  // o resumo da Home continua o de antes
  const s = ok(await a.get('/meta/summary'));
  expect(s.winnersCount).toBe(2);
});

test('CA-03 escritas de status: pausar/ligar campanha, pai pausado (409 + includeParents + alsoChangedRefs), DISAPPROVED = META_POLICY, stale = META_OBJECT_CHANGED, confirm obrigatório, objeto fora = 404', async () => {
  const c = await conta('ca3');
  const a = as(c);
  // confirm ausente
  err(await a.post('/meta/campaigns/mock_cmp_abo/status', { status: 'PAUSED', expected: 'ACTIVE' }), 400, 'VALIDATION_ERROR');
  // pausar campanha ABO → filhos CAMPAIGN_PAUSED; ligar de novo
  const p = ok(await a.post('/meta/campaigns/mock_cmp_abo/status', ST('PAUSED', 'ACTIVE')));
  expect(p.object.status).toBe('PAUSED');
  expect(p.change).toMatchObject({ level: 'campaign', objectId: 'mock_cmp_abo', field: 'STATUS', from: 'ACTIVE', to: 'PAUSED', result: 'APPLIED', source: 'CAMPAIGNS' });
  const det = ok(await a.get('/meta/campaigns/mock_cmp_abo'));
  test.info().annotations.push({ type: 'filhos depois de pausar a campanha', description: det.adsets.map((s: any) => `${s.id}:${s.effectiveStatus}`).join(', ') });
  const on = ok(await a.post('/meta/campaigns/mock_cmp_abo/status', ST('ACTIVE', 'PAUSED')));
  expect(on.object.status).toBe('ACTIVE');
  // expected errado (a tela mostrava outra coisa) = 409 META_OBJECT_CHANGED com current
  const ch = err(await a.post('/meta/campaigns/mock_cmp_abo/status', ST('PAUSED', 'PAUSED')), 409, 'META_OBJECT_CHANGED');
  expect(ch.current.status).toBe('ACTIVE');
  // anúncio ativo dentro do conjunto pausado: ligar o anúncio sem includeParents = 409 com a lista dos pais
  await a.post('/meta/ads/mock_ad_5/status', ST('PAUSED', 'ACTIVE'));
  const pp = err(await a.post('/meta/ads/mock_ad_5/status', ST('ACTIVE', 'PAUSED')), 409, 'META_PARENT_PAUSED');
  expect(pp.parents.map((x: any) => x.id)).toContain('mock_adset_abo_paused');
  expect(pp.parents[0].name).toBeTruthy();
  const inc = ok(await a.post('/meta/ads/mock_ad_5/status', ST('ACTIVE', 'PAUSED', { includeParents: true })));
  expect(inc.alsoActivated.map((x: any) => x.id)).toContain('mock_adset_abo_paused');
  const adset = ok(await a.get('/meta/campaigns/mock_cmp_abo')).adsets.find((s: any) => s.id === 'mock_adset_abo_paused');
  expect(adset.status).toBe('ACTIVE');
  // pausar nunca mexe em pai/filho
  const pa = ok(await a.post('/meta/adsets/mock_adset_abo_paused/status', ST('PAUSED', 'ACTIVE')));
  expect(pa.alsoActivated ?? []).toEqual([]);
  const ad5 = ok(await a.get('/meta/campaigns/mock_cmp_abo')).adsets.find((s: any) => s.id === 'mock_adset_abo_paused').ads[0];
  expect(ad5.status, 'pausar o conjunto não muda o liga/desliga do anúncio').toBe('ACTIVE');
  // DISAPPROVED
  err(await a.post('/meta/ads/mock_ad_7/status', ST('ACTIVE', 'ACTIVE')), 422, 'META_POLICY');
  const pol = await a.post('/meta/ads/mock_ad_7/status', ST('PAUSED', 'ACTIVE'));
  test.info().annotations.push({ type: 'pausar DISAPPROVED', description: `${pol.status} ${pol.body?.error?.code ?? 'ok'}` });
  // [mock:stale]: qualquer escrita no conjunto = 409 META_OBJECT_CHANGED (Meta difere do snapshot)
  const st = err(await a.post('/meta/adsets/mock_adset_abo_stale/status', ST('PAUSED', 'ACTIVE')), 409, 'META_OBJECT_CHANGED');
  test.info().annotations.push({ type: 'stale current', description: JSON.stringify(st.current) });
  expect(st.current).toHaveProperty('status');
  // fora da estrutura
  const gone = await a.post('/meta/ads/mock_ad_inexistente/status', ST('PAUSED', 'ACTIVE'));
  expect([404]).toContain(gone.status);
  // History: conta e item, com alsoChangedRefs nomeados
  const h = ok(await a.get('/meta/changes'));
  test.info().annotations.push({ type: 'history', description: h.map((x: any) => `${x.objectId}:${x.field}:${x.from}->${x.to}:${x.result}:${x.errorCode ?? ''}`).join(' | ') });
  const withParents = h.find((x: any) => x.objectId === 'mock_ad_5' && x.to === 'ACTIVE' && x.result === 'APPLIED');
  expect(withParents.alsoChangedRefs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mock_adset_abo_paused', level: 'adset', name: expect.stringMatching(/Paused test/) })]));
  // §4 passo 5: "Grava MetaChange (APPLIED ou FAILED, mesmo quando a Meta recusa)"; spec §2.12 "Toda falha também entra no History"
  // META_POLICY aqui é a trava do HookMill (§4.1, antes de escrever), não recusa da Meta: o contrato só grava FAILED a partir do passo 4.
  // A spec do design §2.12 diz "toda falha também entra no History": divergência registrada como nota pro arquiteto.
  test.info().annotations.push({ type: 'META_POLICY no History', description: String(h.some((x: any) => x.objectId === 'mock_ad_7' && x.errorCode === 'META_POLICY')) });
  const item = ok(await a.get('/meta/changes?level=ad&objectId=mock_ad_5'));
  expect(item.every((x: any) => x.objectId === 'mock_ad_5')).toBe(true);
  expect(h[0].by.name).toBeTruthy();
});

test('CA-04 orçamento: CBO na campanha, ABO no conjunto, NOT_EDITABLE (conjunto CBO, campanha ABO, vitalício), mínimo, 2×, expected, rate/token', async () => {
  const c = await conta('ca4');
  const a = as(c);
  const B = (n: number, exp: number) => ({ dailyBudgetMinor: n, expectedDailyBudgetMinor: exp, confirm: true });
  const r1 = ok(await a.patch('/meta/campaigns/mock_cmp_cbo/budget', B(6000, 5000)));
  expect(r1.object.budget.amountMinor).toBe(6000);
  expect(r1.change).toMatchObject({ field: 'DAILY_BUDGET', from: '5000', to: '6000', result: 'APPLIED' });
  const r2 = ok(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(4000, 2000)));
  expect(r2.object.budget.amountMinor).toBe(4000);
  const ne1 = err(await a.patch('/meta/adsets/mock_adset_cbo_1/budget', B(6000, 6000)), 422, 'META_BUDGET_NOT_EDITABLE');
  expect(ne1.budgetLevel).toBe('campaign');
  err(await a.patch('/meta/campaigns/mock_cmp_abo/budget', B(3000, 0)), 422, 'META_BUDGET_NOT_EDITABLE');
  const ne3 = err(await a.patch('/meta/campaigns/mock_cmp_life/budget', B(31000, 30000)), 422, 'META_BUDGET_NOT_EDITABLE');
  expect(ne3.kind).toBe('lifetime');
  const low = err(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(400, 4000)), 422, 'META_BUDGET_TOO_LOW');
  expect(low.minimumMinor).toBe(500);
  const big = err(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(8001, 4000)), 422, 'META_BUDGET_STEP_TOO_LARGE');
  expect(big.maxMinor).toBe(8000);
  ok(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(8000, 4000)));
  // diminuir é livre até o mínimo
  ok(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(500, 8000)));
  // expected errado
  const ch = err(await a.patch('/meta/adsets/mock_adset_abo_1/budget', B(700, 9999)), 409, 'META_OBJECT_CHANGED');
  expect(ch.current.dailyBudgetMinor).toBe(500);
  // [mock:meta-rate] / [mock:meta-token] (anúncios de imagem) → 503 rate_limited / 422 token; FAILED no History
  const rate = err(await a.post('/meta/ads/mock_ad_img_1/status', ST('PAUSED', 'ACTIVE')), 503, 'META_UNAVAILABLE');
  expect(rate.reason).toBe('rate_limited');
  expect(rate.retryAfterSec).toBeGreaterThan(0);
  err(await a.post('/meta/ads/mock_ad_img_2/status', ST('PAUSED', 'ACTIVE')), 422, 'META_TOKEN_INVALID');
  const conn = ok(await a.get('/meta/connection'));
  test.info().annotations.push({ type: 'conexão depois do META_TOKEN_INVALID de escrita', description: conn.status });
  const h = ok(await a.get('/meta/changes'));
  expect(h.filter((x: any) => x.result === 'FAILED').map((x: any) => x.errorCode)).toEqual(expect.arrayContaining(['META_UNAVAILABLE', 'META_TOKEN_INVALID']));
});

test('CA-05 throttle: 21ª escrita no minuto = 429 RATE_LIMITED { retryAfterSec }', async () => {
  const c = await conta('ca5');
  const a = as(c);
  let cur = 'ACTIVE';
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) {
    const to = cur === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const r = await a.post('/meta/ads/mock_ad_4/status', ST(to, cur));
    statuses.push(r.status);
    if (r.status === 200) cur = to;
    if (r.status === 429) {
      expect(r.body.error.code).toBe('RATE_LIMITED');
      expect(r.body.error.details.retryAfterSec).toBeGreaterThan(0);
    }
  }
  test.info().annotations.push({ type: 'statuses', description: statuses.join(',') });
  expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
  expect(statuses[20]).toBe(429);
});

test('CA-06 cota ≥ 90 % bloqueia escrita (503 rate_limited); conta inutilizável = 422 META_ACCOUNT_UNUSABLE', async () => {
  const c = await conta('ca6');
  const a = as(c);
  // conta inutilizável: muda a seleção pra act_mock_2 (account_status 2) e tenta escrever
  await a.put('/meta/selection', { adAccountId: 'act_mock_2', pageId: 'page_mock', pixelId: 'pix_mock' });
  await expect.poll(async () => (await a.get('/meta/summary')).data?.sync?.state, { timeout: 60_000 }).toBe('ok');
  const rows = ok(await a.get('/meta/campaigns'));
  test.info().annotations.push({ type: 'act_mock_2 canToggle', description: rows.map((x: any) => `${x.id}:${x.canToggle}:${x.budget.editable}`).join(', ') });
  const u = await a.post('/meta/campaigns/mock_cmp_cbo/status', ST('PAUSED', 'ACTIVE'));
  test.info().annotations.push({ type: 'escrita em act_mock_2', description: `${u.status} ${JSON.stringify(u.body).slice(0, 200)}` });
  expect(u.status).toBe(422);
  expect(u.body.error.code).toBe('META_ACCOUNT_UNUSABLE');
  expect(rows.every((x: any) => x.canToggle === false)).toBe(true);
});

test('CA-07 papéis: MEMBER e CLIENT leem tudo e recebem 403 em toda escrita; MEMBER sincroniza; CLIENT não', async () => {
  const c = await conta('ca7');
  const mem = await convidar(c, 'MEMBER', 'm');
  const cli = await convidar(c, 'CLIENT', 'c');
  for (const [who, tok] of [['MEMBER', mem], ['CLIENT', cli]] as const) {
    const x = as(tok);
    expect((await x.get('/meta/campaigns')).status, `${who} lê`).toBe(200);
    expect((await x.get('/meta/campaigns/mock_cmp_cbo')).status).toBe(200);
    expect((await x.get('/meta/changes')).status).toBe(200);
    expect((await x.post('/meta/campaigns/mock_cmp_cbo/status', ST('PAUSED', 'ACTIVE'))).status, `${who} não pausa`).toBe(403);
    expect((await x.post('/meta/ads/mock_ad_4/status', ST('PAUSED', 'ACTIVE'))).status).toBe(403);
    expect((await x.patch('/meta/adsets/mock_adset_abo_1/budget', { dailyBudgetMinor: 2100, expectedDailyBudgetMinor: 2000, confirm: true })).status).toBe(403);
    const rows = (await x.get('/meta/campaigns')).data;
    expect(rows.every((r: any) => r.canToggle === false && r.budget.editable === false), `${who}: canToggle/editable false`).toBe(true);
  }
  const sm = await as(mem).post('/meta/sync');
  expect([200, 202, 429]).toContain(sm.status);
  expect((await as(cli).post('/meta/sync')).status).toBe(403);
});

test('CA-08 estados: sem Meta (422), stale e failed no meta.sync, off = 503 em /meta/campaigns e /meta/changes', async () => {
  const c = await signup('ca8', { agencyName: 'ca8 QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  err(await as(c).get('/meta/campaigns'), 422, 'META_NOT_CONNECTED');
  await conectarMeta(c);
  await sql(`update meta_connections set last_sync_at = (now() at time zone 'utc') - interval '13 hours' where workspace_id = $1`, [c.workspaceId]);
  expect((await as(c).get('/meta/campaigns')).body.meta.sync.state).toBe('stale');
  await sql(`update meta_connections set last_sync_at = null, last_sync_error = 'META_ERROR' where workspace_id = $1`, [c.workspaceId]);
  const f = await as(c).get('/meta/campaigns');
  expect(f.body.meta.sync.state).toBe('failed');
  expect(f.data.length, 'a tabela continua com o último snapshot').toBe(3);
  // off: 2ª API (3003)
  const off = 'http://localhost:3003/api/v1';
  const s2 = await fetch(`${off}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'QA off', email: `qa-final-off-${Date.now()}@teste.local`, password: 'qa-senha-forte-2026' }) }).then((r) => r.json());
  const tok = s2.data.accessToken;
  for (const p of ['/meta/campaigns', '/meta/changes', '/meta/campaigns/mock_cmp_cbo']) {
    const r = await fetch(`${off}${p}`, { headers: { authorization: `Bearer ${tok}` } });
    const b = await r.json();
    expect(r.status, p).toBe(503);
    expect(b.error.code).toBe('META_NOT_CONFIGURED');
  }
});

test('CA-09 sync estendido: etapas do job, snapshots de campanha/conjunto, Send activate/pause gravam MetaChange source PUBLISH, publicação com selo HookMill', async () => {
  const c = await conta('ca9');
  const a = as(c);
  // §10.1: activate/pause da tela Send gravam MetaChange source PUBLISH (activate liga os 3 níveis: alsoChanged = conjunto + campanha)
  const offer = (await a.get('/offers')).data[0];
  const cr = await criativoAprovado(c, offer.id, 'Hook QA ca9');
  const pb = await a.post(`/creatives/${cr.id}/meta/publish`, { dailyBudgetMinor: 1500, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com/' });
  expect([200, 201, 202]).toContain(pb.status);
  const pub = (await atePublicacao(c, cr.id)).publication;
  expect(pub.status).toBe('PAUSED');
  ok(await a.post(`/creatives/${cr.id}/meta/activate`, { confirm: true }), 200);
  ok(await a.post(`/creatives/${cr.id}/meta/pause`, {}), 200);
  const h = ok(await a.get(`/meta/changes?level=ad&objectId=${pub.ids.adId}`));
  test.info().annotations.push({ type: 'PUBLISH history', description: h.map((x: any) => `${x.source}:${x.from}->${x.to}:${x.result}:also=${(x.alsoChangedRefs ?? []).map((r: any) => r.level + ':' + r.name).join('+')}`).join(' | ') });
  expect(h.map((x: any) => x.source)).toEqual(['PUBLISH', 'PUBLISH']);
  expect(h[1]).toMatchObject({ from: 'PAUSED', to: 'ACTIVE', result: 'APPLIED' });
  expect(h[1].alsoChanged.length).toBe(2);
  expect(h[0]).toMatchObject({ from: 'ACTIVE', to: 'PAUSED', result: 'APPLIED' });
  // sync manual: 5 etapas novas; depois dele a campanha publicada entra na Campaigns com selo
  await sql(`update meta_connections set last_sync_at = (now() at time zone 'utc') - interval '1 hour' where workspace_id = $1`, [c.workspaceId]);
  const s = await a.post('/meta/sync');
  const job = s.data.job;
  test.info().annotations.push({ type: 'sync', description: `${s.status} ${job.status} checklist ${JSON.stringify(job.checklist?.map((x: any) => x.key))}` });
  expect(job.checklist.map((x: any) => x.key)).toEqual(['listing_campaigns', 'listing_adsets', 'listing_ads', 'reading_insights', 'scoring']);
  await expect.poll(async () => (await sql(`select status from jobs where id = $1`, [job.id]))[0]?.status, { timeout: 60_000 }).toBe('SUCCEEDED');
  const n = await sql(`select (select count(*) from meta_campaign_snapshots where workspace_id = $1)::int c, (select count(*) from meta_adset_snapshots where workspace_id = $1)::int s, (select count(*) from meta_ad_snapshots where workspace_id = $1)::int a`, [c.workspaceId]);
  test.info().annotations.push({ type: 'snapshots', description: JSON.stringify(n[0]) });
  expect(n[0].c).toBeGreaterThanOrEqual(3); expect(n[0].s).toBeGreaterThanOrEqual(6); expect(n[0].a).toBeGreaterThanOrEqual(10);
  const rows = ok(await a.get('/meta/campaigns?origin=hookmill'));
  test.info().annotations.push({ type: 'origin=hookmill', description: rows.map((x: any) => `${x.id}:${x.fromHookMill}`).join(', ') });
  // §6 do contrato: "publicações mock do HookMill aparecem com selo" — o sync mock só gera as 3 campanhas fixas (Achado E)
  expect.soft(rows.map((x: any) => x.id), 'campanha publicada entra no snapshot e sai com selo (mock §6)').toContain(pub.ids.campaignId);
  expect(rows.every((x: any) => x.fromHookMill)).toBe(true);
});
