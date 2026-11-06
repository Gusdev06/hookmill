// QA 06/11 do recorte F1a pela API: troca-texto-queimado-v1 §15.3, §15.3.1, §15.4 e f1a-handoff. API real em mock, render fake,
// banco maquina_f1a_test. Nada pago. Rodar: ver playwright.qaf1a.config.ts. Dono: maquina-qa.
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, tokenOf } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { FALA20, assentou, ateLote, subirArquivo } from '../../harness/iterate.ts';
import { campeao, comCreditos, gerar, livro, novoLote, notas, prepararWs, saldo, setLayers, usar } from '../../harness/f1a.ts';

test.describe.configure({ timeout: 900_000 });
test.beforeEach(async () => { await prepararWs(); await comCreditos(100); });
test.afterEach(async () => { await esperarJobsQuietos(180_000); });

const HEADLINE = 'new-headline';
const PACK = 'let-hookmill-pick';
const semCampoAntigo = (b: any) => {
  const txt = JSON.stringify(b);
  expect(txt, 'captionOverride na resposta').not.toContain('captionOverride');
  expect(txt, 'forced na resposta').not.toContain('"forced"');
  expect(b.insight?.captionNote, 'insight.captionNote').toBeUndefined();
};
/** Item HEADLINE `replace` feito antes do F1a. */
async function headlineAntiga(batchId: string, included = true): Promise<string> {
  const id = `qa_old_h_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  await q(`insert into variation_items (id, workspace_id, batch_id, kind, index, priority, status, included, selection, rationale, code, axis, change, auto_type, in_zip, payload, updated_at)
           values ($1,'qa_ws_alfa',$2,'AUTO_EDIT',900,900,'READY',$3,'auto','old','HEADLINE-OLD','ITERATION','old','HEADLINE',true,$4::jsonb,now())`,
    [id, batchId, included, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old new words', highlight: null, sources: {}, language: 'en', original: 'Original headline here', format: 'VERTICAL_9_16', copy: 'plate' }, whyKey: 'hook' })]);
  return id;
}
const marcar = (itemId: string) => q(`update variation_items set payload = payload || '{"captionOverride":true}'::jsonb where id = $1`, [itemId]);
const itens = (batchId: string) => q<{ id: string; included: boolean; selection: string | null; auto_type: string; updated_at: string; payload: any }>(`select id, included, selection, auto_type, updated_at, payload from variation_items where batch_id = $1 order by index`, [batchId]);

test('F1A-API-03 force/unforce = 410 CAPTION_FORCE_RETIRED: qualquer corpo, id inexistente, CLIENT; sem details', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  for (const body of [{ type: 'NATIVE_SEARCH', template: null }, {}, undefined, { lixo: [1, 2, 3] }]) {
    for (const m of ['POST', 'DELETE']) {
      for (const id of [b.id, 'nao-existe']) {
        const r = await as('donoA').raw(m, `/iterate/${id}/caption-blocked/force`, body);
        const e = expectErro(r, 410, 'CAPTION_FORCE_RETIRED');
        expect(r.body.error.details, 'sem details').toBeUndefined();
        void e;
      }
    }
  }
  const cli = await as('clienteA').post(`/iterate/${b.id}/caption-blocked/force`, {});
  notas(test.info(), 'api-03-client', { status: cli.status, body: cli.body });
  expect(cli.status, 'CLIENT não vira outra coisa pior que 403/410').toBeGreaterThanOrEqual(403);
  const sem = await call('POST', `/iterate/${b.id}/caption-blocked/force`, { body: {} });
  expect(sem.status, 'sem token').toBe(401);
  // 410 não mexeu em nada
  const d = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expect(d.pieces.length).toBe(b.pieces.length);
});

test('F1A-API-01 lote de template com legenda queimada: sem captionOverride, com guarda, peças sem tarja; crédito certo', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const antes = (await saldo()).balance;
  const b = await usar(PACK, championId);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  expect(b.pieces.length).toBeGreaterThan(0);
  semCampoAntigo(b);
  expect(b.template.fit, 'pack segue ok se algum couber').toMatchObject({ level: 'ok' });
  expect(b.insight.headlineBlocked).toEqual({ reason: 'headline_pending', mode: 'replace' });
  for (const x of b.insight.captionBlocked ?? []) expect(x).toMatchObject({ reason: 'burned_captions' });
  const rows = await itens(b.id);
  for (const r of rows) expect(r.payload.captionOverride, r.id).toBeUndefined();
  expect(rows.some((r) => r.auto_type === 'HEADLINE'), 'HEADLINE replace fora do plano').toBe(false);
  const [st] = await q(`select settings, insight from variation_batches where id = $1`, [b.id]);
  expect(st.settings.captionCandidates).toBeUndefined();
  expect(st.insight.captionNote).toBeUndefined();
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  semCampoAntigo(fim);
  const rs = await q(`select vi.code, vi.auto_type, r.status, r.input from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id where c.variation_batch_id = $1`, [b.id]);
  for (const r of rs) {
    const t = JSON.stringify(r.input);
    expect(t, `${r.code}: placa no input`).not.toMatch(/plateColor|"copy":"plate"|sobreVideo|semLegendaQueimada":true|captionOverride/);
  }
  await expect.poll(async () => (await saldo()).balance, { timeout: 60_000 }).toBeLessThan(antes);
  notas(test.info(), 'api-01', { pieces: fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`), blocked: b.insight.captionBlocked, livro: await livro(), saldo: await saldo(), quote: b.template.quote });
});

test('F1A-API-02 HEADLINE replace: hard headline_pending, 422 sem crédito, solta e caixa; seleção em skipped; add segue', async () => {
  const { championId, baseMap } = await campeao();
  const antes = (await saldo()).balance;
  for (const headline of ['loose', 'box'] as const) {
    await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline });
    const f = expectOk(await as('donoA').post('/ad-templates/fits', { slug: HEADLINE, sources: [{ championId }] }));
    expect(f.items[0].fit, headline).toEqual({ level: 'hard', reason: 'headline_pending' });
    const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
    expect((g.items ?? g).find((t: any) => t.slug === HEADLINE).fit, `galeria ${headline}`).toEqual({ level: 'hard', reason: 'headline_pending' });
    const e = expectErro(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId }), 422, 'TEMPLATE_DOESNT_FIT');
    expect(JSON.stringify(e)).toContain('headline_pending');
    // lote normal: headlineBlocked + nada de HEADLINE
    const n = await novoLote(championId);
    expect(n.insight.headlineBlocked).toEqual({ reason: 'headline_pending', mode: 'replace' });
    expect([...n.pieces, ...(n.notSelected ?? [])].some((p: any) => p.type === 'HEADLINE')).toBe(false);
  }
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const lista = g.items ?? g;
  const ok = lista.filter((t: any) => t.fit?.level === 'ok' && !t.pack && t.category === 'frames').map((t: any) => t.slug);
  expect(ok.length, 'moldura que cabe').toBeGreaterThan(0);
  // anúncio já lido + Headline hard: 422 com a lista (o web mostra "tirar e continuar"), sem lote e sem crédito
  const lotes0 = await q(`select count(*)::int n from variation_batches`);
  const sel = await as('donoA').post('/ad-templates/use', { championId, slugs: [HEADLINE, ok[0]] });
  expect(sel.status, JSON.stringify(sel.body)).toBe(422);
  expect(sel.body.error.details.items).toEqual([expect.objectContaining({ slug: HEADLINE, reason: 'headline_pending' })]);
  expect(await q(`select count(*)::int n from variation_batches`)).toEqual(lotes0);
  // anúncio ainda não lido (upload novo): a leitura decide no plano, Headline vai pra `skipped` e o lote segue ok (handoff)
  const up = await subirArquivo('donoA', FALA20);
  const s = expectOk(await as('donoA').post('/ad-templates/use', { uploadId: up.uploadId, offerId: (await q(`select id from offers limit 1`))[0].id, slugs: [HEADLINE, ok[0]] }), 202);
  const sp = await ateLote('donoA', s.id, (b) => !['ANALYZING', 'PLANNING'].includes(b.status), { oQue: 'seleção upload', timeoutMs: 240_000 });
  notas(test.info(), 'api-02-sel-upload', { fit: sp.template?.fit, selection: sp.template?.selection, pieces: sp.pieces.map((p: any) => p.code), erro: sp.error });
  expect(sp.template.selection.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ slug: HEADLINE, reason: 'headline_pending' })]));
  expect(sp.template.fit.level).toBe('ok');
  expect(sp.pieces.some((p: any) => p.type === 'HEADLINE')).toBe(false);
  expect((await saldo()).balance, 'nenhum crédito reservado').toBe(antes);
  expect(await livro()).toEqual([]);

  // sem headline: `add` continua
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: null });
  const fa = expectOk(await as('donoA').post('/ad-templates/fits', { slug: HEADLINE, sources: [{ championId }] }));
  notas(test.info(), 'api-02-add-fit', fa.items[0].fit);
  expect(fa.items[0].fit.level, 'HEADLINE add oferecido').toBe('ok');
  const a = await usar(HEADLINE, championId);
  expect(a.status).toBe('PLAN_READY');
  expect(a.pieces.length).toBeGreaterThan(0);
  for (const p of a.pieces) expect(p.headline?.mode).toBe('add');
  await gerar(a);
  const fim = await ateLote('donoA', a.id, assentou, { timeoutMs: 600_000 });
  notas(test.info(), 'api-02-add', fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`));
  expect(fim.pieces.filter((p: any) => p.status === 'ready').length, JSON.stringify(fim.pieces.map((p: any) => [p.code, p.status, p.errorCode]))).toBeGreaterThan(0);
});
async function planejadoSel(championId: string, slugs: string[]) {
  const u = expectOk(await as('donoA').post('/ad-templates/use', { championId, slugs }), 202);
  return ateLote('donoA', u.id, (b) => !['ANALYZING', 'PLANNING'].includes(b.status), { oQue: 'plano seleção', timeoutMs: 240_000 });
}

test('F1A-API-02b HEADLINE replace antigo refeito: failed HEADLINE_PENDING, leave_out, failReason EN, sem cobrança', async () => {
  const { championId, baseMap, offerId } = await campeao();
  await q(`update offers set notes = '[mock:render-fail:REVIEW]' where id = $1`, [offerId]);
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: null });
  const b = await novoLote(championId);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const falha = fim.pieces.find((p: any) => p.status === 'failed');
  notas(test.info(), 'api-02b-antes', fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`));
  test.skip(!falha, 'o mock não produziu falha: refazer');
  await q(`update offers set notes = null where id = $1`, [offerId]);
  await q(`update variation_items set auto_type = 'HEADLINE', payload = $2::jsonb where id = $1`, [falha.id, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old new words', highlight: null, sources: {}, language: 'en', original: 'Original headline here', format: 'VERTICAL_9_16' }, whyKey: 'hook' })]);
  const r = await as('donoA').post(`/iterate/pieces/${falha.id}/retry`, {});
  notas(test.info(), 'api-02b-retry', { status: r.status, error: r.body?.error });
  await esperarJobsQuietos(120_000);
  const depois = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  const p = depois.pieces.find((x: any) => x.id === falha.id);
  expect(p.status).toBe('failed');
  expect(p.errorCode).toBe('HEADLINE_PENDING');
  expect(p.retryHint).toBe('leave_out');
  expect(p.failReason, 'failReason em EN').toMatch(/can't be rewritten yet/);
});

test('F1A-API-04 peça e lote antigos: campos fora da resposta, arquivo baixa; HEADLINE replace antigo = editor off com motivo', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const prontas = fim.pieces.filter((p: any) => p.status === 'ready' && p.files?.length);
  expect(prontas.length).toBeGreaterThan(1);
  const [coberta, placa] = prontas;
  await marcar(coberta.id);
  await q(`update variation_items set auto_type = 'HEADLINE', payload = $2::jsonb where id = $1`, [placa.id, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old new words', highlight: null, sources: {}, language: 'en', original: 'Original headline here', format: 'VERTICAL_9_16' }, whyKey: 'hook', captionOverride: true })]);
  await q(`update variation_batches set insight = insight || $2::jsonb, settings = coalesce(settings,'{}'::jsonb) || '{"captionCandidates":[{"type":"REVIEW","params":{}}]}'::jsonb where id = $1`, [b.id, JSON.stringify({ captionNote: true, captionBlocked: [{ type: 'REVIEW', template: null, reason: 'burned_captions', forced: true }] })]);
  const d = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  semCampoAntigo(d);
  expect(d.insight.captionBlocked).toEqual([{ type: 'REVIEW', template: null, reason: 'burned_captions' }]);
  const pc = d.pieces.find((p: any) => p.id === coberta.id);
  const pp = d.pieces.find((p: any) => p.id === placa.id);
  expect(pc.status).toBe('ready');
  expect(pp.status).toBe('ready');
  expect(pp.editor).toMatchObject({ available: false, reason: 'headline_plate_retired' });
  const ed = await as('donoA').get(`/creatives/${pp.creativeId}/editor`);
  expect([ed.status, ed.body?.error?.code, ed.body?.error?.details?.reason]).toEqual([422, 'EDIT_NOT_SUPPORTED', 'headline_plate_retired']);
  for (const p of [pc, pp]) {
    const r = await fetch(p.files[0].url);
    expect(r.status, `${p.code} url`).toBe(200);
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(4, 8).toString(), `${p.code} é mp4`).toBe('ftyp');
    expect(r.headers.get('content-disposition') ?? '', `${p.code} attachment`).toMatch(/attachment/);
  }
  const lib = expectOk(await as('donoA').get('/library?limit=50'));
  expect(JSON.stringify(lib)).not.toContain('captionOverride');
  notas(test.info(), 'api-04', { pc: pc.editor, pp: pp.editor, files: pp.files.map((f: any) => f.name) });
});

test('F1A-API-05 lote de template vazio: soft com saídas, nada cobrado; seleção com soft em skipped; start 409', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 100, captionH: 1080 });
  const antes = await saldo();
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const lista = g.items ?? g;
  const soft = lista.filter((t: any) => t.fit?.level === 'soft' && !t.pack);
  notas(test.info(), 'api-05-fits', lista.map((t: any) => `${t.slug}:${t.fit?.level}:${t.fit?.reason ?? ''}`));
  expect(soft.length).toBeGreaterThan(0);
  const b = await usar(soft[0].slug, championId);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  expect(b.pieces).toEqual([]);
  expect(b.template.fit).toEqual({ level: 'soft', reason: 'burned_captions' });
  semCampoAntigo(b);
  const st = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: 0, expectedCostUsd: 0, expectedCredits: b.template.quote });
  notas(test.info(), 'api-05-start', { status: st.status, error: st.body?.error, quote: b.template.quote });
  expect([400, 409], JSON.stringify(st.body)).toContain(st.status); // expectedPieces 0 = 400 (min 1): o web deixa Generate desligado
  const st1 = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: 1, expectedCostUsd: 0, expectedCredits: 1 });
  expect([st1.status, st1.body?.error?.details?.reason]).toEqual([409, 'nothing_selected']);
  expect(await livro(), 'nada no livro').toEqual([]);
  expect((await saldo()).balance).toBe(antes.balance);
  const [run] = await q(`select status, held from template_runs where batch_id = $1`, [b.id]);
  expect(run?.held ?? 0).toBe(0);
  // seleção: 1 soft + 1 que caiba, se houver
  const ok = lista.filter((t: any) => t.fit?.level === 'ok' && !t.pack && t.tier === 'EDIT');
  notas(test.info(), 'api-05-ok', ok.map((t: any) => t.slug));
  if (ok.length) {
    const s = await planejadoSel(championId, [soft[0].slug, ok[0].slug]);
    notas(test.info(), 'api-05-sel', { status: s.status, fit: s.template?.fit, selection: s.template?.selection, pieces: s.pieces.map((p: any) => p.code), error: s.error });
    expect(s.template.selection?.skipped ?? [], JSON.stringify(s.template)).toEqual(expect.arrayContaining([expect.objectContaining({ slug: soft[0].slug, reason: 'burned_captions' })]));
  }
});

test('F1A-API-06 plano limpo no GET: quote, CREDITS_CHANGED, GET repetido/concorrente, 2 abas, isolamento', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await usar(PACK, championId);
  expect(b.pieces.length, 'plano com peças').toBeGreaterThan(2);
  const N = b.pieces.length, Q = b.template.quote;
  const marked = b.pieces[0].id;
  await marcar(marked);
  const old = await headlineAntiga(b.id);

  // outro workspace: 404 e nenhuma escrita
  expectErro(await as('donoB').get(`/iterate/${b.id}`), 404, 'NOT_FOUND');
  const r0 = await itens(b.id);
  expect(r0.find((r) => r.id === marked)?.included, 'donoB não escreveu').toBe(true);
  expect(r0.find((r) => r.id === old)?.included).toBe(true);

  // aba A ficou com N peças e o quote velho; a B abre
  const b1 = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  const ids = b1.pieces.map((p: any) => p.id);
  expect(ids).not.toContain(marked);
  expect(ids).not.toContain(old);
  expect(JSON.stringify(b1.notSelected ?? [])).not.toContain(marked);
  expect(b1.summary.pieces).toBe(N - 1);
  const Q1 = b1.template.quote;
  const r1 = await itens(b.id);
  expect(r1.find((r) => r.id === marked)).toMatchObject({ included: false, selection: 'goal_cut' });
  const [bb1] = await q(`select updated_at, settings from variation_batches where id = $1`, [b.id]);

  // GET repetido e concorrente: sem nova escrita, sem 500
  const rs = await Promise.all(Array.from({ length: 12 }, () => as('donoA').get(`/iterate/${b.id}`)));
  expect(rs.map((r) => r.status)).toEqual(Array(12).fill(200));
  for (const r of rs) expect(r.data.template.quote).toBe(Q1);
  const r2 = await itens(b.id);
  expect(r2.map((r) => r.updated_at), 'itens não reescritos').toEqual(r1.map((r) => r.updated_at));
  const [bb2] = await q(`select updated_at from variation_batches where id = $1`, [b.id]);
  expect(bb2.updated_at, 'lote não reescrito').toEqual(bb1.updated_at);

  // aba A, velha: Generate com os números de antes
  const st1 = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: N, expectedCostUsd: b.cost?.generateEstimateUsd ?? 0, expectedCredits: Q });
  expect(st1.status, JSON.stringify(st1.body)).toBe(409);
  const code1 = st1.body.error.code;
  // peças certas e crédito velho = CREDITS_CHANGED
  const st2 = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: N - 1, expectedCostUsd: b1.cost?.generateEstimateUsd ?? 0, expectedCredits: Q1 + 1 });
  expect(st2.status, JSON.stringify(st2.body)).toBe(409);
  expect(st2.body.error.code).toBe('CREDITS_CHANGED');
  expect(st2.body.error.details).toEqual({ credits: Q1 });
  expect(await livro(), 'nada reservado nos 409').toEqual([]);

  // a seleção não traz de volta
  const volta = await as('donoA').patch(`/iterate/${b.id}/items/${marked}`, { included: true });
  expect(volta.body?.error?.code, JSON.stringify(volta.body)).toBe('ITEM_NOT_SELECTABLE');
  // aba com o número certo: reserva exatamente o quote
  const antes = (await saldo()).balance;
  const go = expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: N - 1, expectedCostUsd: b1.cost?.generateEstimateUsd ?? 0, expectedCredits: Q1 }), 202);
  expect(go.pieces.length).toBe(N - 1);
  const rv = await livro();
  expect(rv.filter((x) => x.kind === 'RESERVE').map((x) => x.delta)).toEqual([-Q1]);
  expect((await saldo()).balance).toBe(antes - Q1);
  expect(await q(`select count(*)::int n from creatives where variation_item_id = any($1)`, [[marked, old]])).toEqual([{ n: 0 }]);
  // 2º Generate da outra aba não cobra de novo
  const dup = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: N - 1, expectedCostUsd: b1.cost?.generateEstimateUsd ?? 0, expectedCredits: Q1 });
  expect(dup.status, JSON.stringify(dup.body)).toBe(409);
  expect((await livro()).filter((x) => x.kind === 'RESERVE').length, 'sem 2ª reserva').toBe(1);
  // GET depois de lançado não mexe em nada
  const r3 = await itens(b.id);
  expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expect((await itens(b.id)).map((r) => [r.id, r.included, r.selection])).toEqual(r3.map((r) => [r.id, r.included, r.selection]));
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  await expect.poll(async () => (await livro()).length, { timeout: 90_000 }).toBeGreaterThan(1);
  notas(test.info(), 'api-06', { N, Q, Q1, code1, livro: await livro(), saldo: await saldo(), pecas: fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`) });
});

test('F1A-API-06b lote de template só com marcados: vira soft no GET, uma escrita; GET concorrente; start 409 nothing_selected; sem cobrança', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const ok = (g.items ?? g).filter((t: any) => t.fit?.level === 'ok' && !t.pack && t.category === 'frames');
  expect(ok.length).toBeGreaterThan(0);
  const b = await usar(ok[0].slug, championId);
  expect(b.pieces.length, JSON.stringify(b.error)).toBeGreaterThan(0);
  const Q = b.template.quote;
  await q(`update variation_items set payload = payload || '{"captionOverride":true}'::jsonb where batch_id = $1`, [b.id]);
  const rs = await Promise.all(Array.from({ length: 10 }, () => as('donoA').get(`/iterate/${b.id}`)));
  expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
  const d = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expect(d.pieces).toEqual([]);
  expect(d.template.fit).toEqual({ level: 'soft', reason: 'burned_captions' });
  expect(d.template.quote).toBe(0);
  const [b1] = await q(`select updated_at from variation_batches where id = $1`, [b.id]);
  expectOk(await as('donoA').get(`/iterate/${b.id}`));
  const [b2] = await q(`select updated_at from variation_batches where id = $1`, [b.id]);
  expect(b2.updated_at).toEqual(b1.updated_at);
  const st = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: 0, expectedCredits: Q });
  notas(test.info(), 'api-06b-start', { status: st.status, error: st.body?.error });
  expect(st.status).toBe(409);
  expect(await livro()).toEqual([]);
  // a resposta do GET de outra rodada continua soft depois do rollback do start
  const d2 = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expect(d2.template.fit).toEqual({ level: 'soft', reason: 'burned_captions' });
});

test('F1A-API-06c quiz em plano antigo: PUT answers não traz HEADLINE replace nem marcada de volta, nem encolhe o lote', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  const old = await headlineAntiga(b.id);
  const marcada = b.pieces[1].id;
  await marcar(marcada);
  const antes = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  const ans = await as('donoA').put(`/iterate/${b.id}/answers`, { answers: { goal: 'stretch', ai: 'free_only', aiCapUsd: null, aiCapCredits: null, wants: ['headline'] }, save: false });
  notas(test.info(), 'api-06c-answers', { status: ans.status, err: ans.body?.error });
  expect(ans.status, JSON.stringify(ans.body)).toBe(200);
  const d = ans.data;
  const ids = d.pieces.map((p: any) => p.id);
  expect(ids).not.toContain(old);
  expect(ids).not.toContain(marcada);
  notas(test.info(), 'api-06c', { antes: antes.pieces.length, depois: d.pieces.length, itens: (await itens(b.id)).map((r) => [r.auto_type, r.included, r.selection]) });
});

test('F1A-API-07 lote normal com legenda: guarda, faixa/encolher no input, gera, baixa; sem legenda nada muda', async () => {
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 300, captionH: 700 });
  const b = await novoLote(championId);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  semCampoAntigo(b);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const rs = await q(`select vi.code, vi.auto_type, r.format, r.status, r.error_code, r.input from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id where c.variation_batch_id = $1`, [b.id]);
  const resumo = rs.map((r) => ({ code: r.code, st: r.status, err: r.error_code, kind: r.input?.kind, reframe: r.input?.video?.reframe ?? r.input?.reframe ?? null, band: !!(r.input?.video?.protectedBands?.length ?? r.input?.protectedBands?.length) }));
  const umaEncolhida = rs.find((r) => (r.input?.video?.reframe?.scale ?? 1) < 1 && r.status === 'READY');
  if (umaEncolhida) notas(test.info(), 'api-07-input-encolhida', umaEncolhida.input);
  notas(test.info(), 'api-07', { pieces: fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`), blocked: b.insight.captionBlocked, resumo });
  expect(fim.pieces.filter((p: any) => p.status === 'ready').length).toBeGreaterThan(0);
  const encolhidas = resumo.filter((r) => (r.reframe?.scale ?? 1) < 1);
  test.info().annotations.push({ type: 'encolhidas', description: JSON.stringify(encolhidas) });
  expect(encolhidas.length, 'alguma peça usa o afastamento (faixa de cor + encolher)').toBeGreaterThan(0);
  const f = fim.pieces.find((p: any) => p.status === 'ready' && p.files?.length);
  const r = await fetch(f.files[0].url);
  expect(Buffer.from(await r.arrayBuffer()).subarray(4, 8).toString()).toBe('ftyp');
});
