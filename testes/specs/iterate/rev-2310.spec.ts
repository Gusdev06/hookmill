// Revisão 23/10 da variação AUTO (docs/contratos/variacao-auto-v1.md §14.8): só 9:16 no lote, 4:5/1:1 sob demanda
// (POST /iterate/pieces/:pieceId/formats), STATIC no GPT Image 2 (fake em mock), custo no start. API do QA em mock
// (render fake, banco *_test próprio). Nada pago. Dono: maquina-qa.
// Rodar (de testes/): E2E_API_PORT=3101 E2E_WEB_PORT=3100 E2E_DATABASE_URL=…/maquina_qa2310_test E2E_LIMITES_V2=1 \
//   npx playwright test --project=iterate specs/iterate/rev-2310.spec.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { WS, q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { PODCAST, assentou, ateLote, getLote, lotePronto, oferta } from '../../harness/iterate.ts';

test.describe.configure({ timeout: 900_000 }); // 27/10: HEADLINE compõe em CPU (~90 s/peça) mesmo no render fake
test.afterEach(async () => {
  await q(`update workspaces set monthly_spend_cap_usd = 200 where id = $1`, [WS.A]);
  await esperarJobsQuietos(120_000);
});

/** Preço de 1 imagem do STATIC. 25/10 (estatico-montado-e-molduras-v1 D1): 2k = US$ 0,40 (era 1k = 0,22 em 23/10).
 *  E2E_STATIC_USD sobrescreve se a API do QA ainda rodar o código de 23/10. */
const PRECO_STATIC = Number(process.env.E2E_STATIC_USD ?? 0.4);
const pecaPor = (b: any, pred: (p: any) => boolean) => b.pieces.find(pred);
const fmt = (p: any, f: string) => p.formats?.find((x: any) => x.format === f);
async function rendersDe(creativeId: string) {
  return q<{ id: string; format: string; engine: string; priority: number; status: string; stale: boolean; error_code: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null }>(
    `select id, format, engine, priority, status, stale, error_code, created_at, started_at, finished_at from renders where creative_id = $1 order by created_at, id`, [creativeId]);
}
async function tasksDoRender(renderId: string) {
  return q<{ id: string; status: string; kind: string; input: any; error_code: string | null }>(
    `select id, status, kind, input, error_code from provider_tasks where render_id = $1 order by submitted_at, id`, [renderId]);
}
async function listaZip(url: string): Promise<string[]> {
  const dl = await fetch(url);
  expect(dl.status).toBe(200);
  const dir = mkdtempSync(join(tmpdir(), 'qa-zip-2310-'));
  const zpath = join(dir, 'z.zip');
  writeFileSync(zpath, Buffer.from(await dl.arrayBuffer()));
  return execFileSync('unzip', ['-Z1', zpath], { encoding: 'utf8' }).trim().split('\n').sort();
}
async function zipPronto(persona: 'donoA' | 'clienteA', batchId: string) {
  const z = await as(persona).post(`/iterate/${batchId}/zip`, {});
  expect([200, 202], JSON.stringify(z.body)).toContain(z.status);
  const b = await ateLote(persona, batchId, (x) => x.zip.status === 'ready' || x.zip.status === 'failed', { oQue: 'zip' });
  expect(b.zip.status).toBe('ready');
  const z2 = expectOk(await as(persona).post(`/iterate/${batchId}/zip`, {}));
  return { b, url: z2.zip.url as string };
}

test('R-01 config + custo: staticImageUsd, generateEstimateUsd = nº STATIC × preço; start sem/baixo expectedCostUsd = ESTIMATE_CHANGED; teto = SPEND_CAP_EXCEEDED', async () => {
  await oferta('A');
  const cfg = expectOk(await as('membroA').get('/iterate/config'));
  expect(cfg.staticImageUsd).toBeCloseTo(PRECO_STATIC, 4);
  const b = await lotePronto('donoA', PODCAST);
  expect(b.status).toBe('PLAN_READY');
  const nStatic = b.pieces.filter((p: any) => p.type === 'STATIC').length;
  expect(nStatic, 'plano do mock com STATIC').toBeGreaterThan(0);
  expect(b.cost.generateEstimateUsd).toBeCloseTo(nStatic * cfg.staticImageUsd, 4);
  expect(b.cost.imagesUsd).toBe(0);
  for (const p of b.pieces) expect(p.media, `${p.code} media`).toBe(p.type === 'STATIC' ? 'image' : 'video');
  const n = b.pieces.length;
  // expectedCostUsd ausente = 0 → com STATIC no plano = 409 (divergência do backend: aceitável, é o mesmo 409 do contrato)
  const sem = expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n }), 409, 'ESTIMATE_CHANGED');
  expect(sem.estimateUsd).toBeCloseTo(b.cost.generateEstimateUsd, 4);
  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: b.cost.generateEstimateUsd * 0.85 }), 409, 'ESTIMATE_CHANGED');
  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: -1 }), 400, 'VALIDATION_ERROR');
  // teto abaixo da estimativa
  await q(`update workspaces set monthly_spend_cap_usd = $2 where id = $1`, [WS.A, b.cost.generateEstimateUsd / 2]);
  const cap = expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: b.cost.generateEstimateUsd }), 409, 'SPEND_CAP_EXCEEDED');
  expect(cap.estimateUsd).toBeCloseTo(b.cost.generateEstimateUsd, 4);
  expect((await getLote('donoA', b.id)).data.status).toBe('PLAN_READY');
  await q(`update workspaces set monthly_spend_cap_usd = 200 where id = $1`, [WS.A]);
  // tolerância de 10 %: 0,92 × estimativa passa
  const ok = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: b.cost.generateEstimateUsd * 0.92 });
  expect(ok.status, JSON.stringify(ok.body)).toBe(202);
  expect(ok.data.cost.generateEstimateUsd).toBeNull();
  await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
});

test('R-02 lote só 9:16: N peças → N renders 9:16 (vídeo REMOTION p0, STATIC IMAGE_GEN); ready pelo 9:16; zip só 9:16; formats[] com 3 entradas', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  const n = b.pieces.length;
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const rs = await q(`select r.format, r.engine, r.priority, vi.auto_type from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id where c.variation_batch_id = $1`, [b.id]);
  expect(rs.length, 'um render por peça').toBe(n);
  expect(new Set(rs.map((r) => r.format))).toEqual(new Set(['VERTICAL_9_16']));
  for (const r of rs) {
    expect(r.engine, r.auto_type).toBe(r.auto_type === 'STATIC' ? 'IMAGE_GEN' : 'REMOTION');
    expect(r.priority).toBe(0);
  }
  expect(fim.summary.ready).toBe(n);
  expect(fim.summary.files, 'summary.files = formatos feitos').toBe(n);
  for (const p of fim.pieces) {
    expect(p.status).toBe('ready');
    expect(p.formats.map((f: any) => f.format)).toEqual(['9x16', '4x5', '1x1']);
    expect(p.formats.map((f: any) => f.state)).toEqual(['ready', 'none', 'none']);
    expect(p.formatsReady).toBe(1);
    expect(p.files.map((f: any) => f.format)).toEqual(['9x16']);
    const req = fmt(p, '4x5').requestUsd;
    if (p.type === 'STATIC') {
      expect(req).toBeCloseTo(PRECO_STATIC, 4);
      expect(p.files[0].name).toMatch(/_9x16\.png$/);
      expect(p.files[0].mimeType).toBe('image/png');
      expect(p.poster?.url, 'pôster = a imagem').toBeTruthy();
    } else expect(req).toBe(0);
  }
  const st = pecaPor(fim, (p) => p.type === 'STATIC');
  const [tk] = await q(`select t.kind, t.input, t.status from provider_tasks t join renders r on r.id = t.render_id where r.creative_id = $1`, [st.creativeId]);
  expect(tk.kind).toBe('STATIC_IMAGE');
  test.info().annotations.push({ type: 'prompt STATIC', description: String(tk.input?.prompt ?? JSON.stringify(tk.input)).slice(0, 500) });
  const [th] = await q(`select c.thumbnail_file_id, r.file_id from creatives c join renders r on r.creative_id = c.id where c.id = $1`, [st.creativeId]);
  expect(th.thumbnail_file_id).toBe(th.file_id);
  const { b: z, url } = await zipPronto('donoA', b.id);
  expect(z.zip.files).toBe(n);
  const lista = await listaZip(url);
  expect(lista.filter((x) => !x.endsWith('README.txt')).every((x) => /_9x16\.(mp4|png)$/.test(x)), lista.join(',')).toBe(true);
  expect(lista.some((x) => new RegExp(`${st.code}_9x16\\.png$`).test(x))).toBe(true);
  // download ?format=4x5 sem 4:5 pronto = 409 format_not_ready
  const cut = pecaPor(fim, (p) => p.type !== 'STATIC');
  const e = expectErro(await as('donoA').get(`/creatives/${cut.creativeId}/download?format=4x5`), 409, 'INVALID_STATE');
  expect(e?.reason).toBe('format_not_ready');
  // nada pago
  expect(Number((await q(`select coalesce(sum(amount_usd),0) s from cost_entries where variation_batch_id = $1`, [b.id]))[0].s)).toBe(0);
});

test('R-03 rota de formatos: 400 (9x16/valor ruim/sem body), 409 peça não ready, 403 CLIENT, 404 de outro workspace; 202 → 200 idempotente; 4:5 passa na frente do lote', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  const n = b.pieces.length;
  const st = expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const ultima = st.pieces.filter((p: any) => p.type !== 'STATIC').at(-1);
  // peça não ready (na fila) = 409 com allowed ['ready']
  const nr = expectErro(await as('donoA').post(`/iterate/pieces/${ultima.id}/formats`, { format: '4x5' }), 409, 'INVALID_STATE');
  expect(nr.allowed).toEqual(['ready']);
  // espera a 1ª peça de vídeo ficar pronta com o lote ainda rodando
  const cedo = await ateLote('donoA', b.id, (x) => x.pieces.some((p: any) => p.status === 'ready' && p.type !== 'STATIC' && p.type !== 'HEADLINE'), { oQue: '1ª pronta', timeoutMs: 700_000 });
  const pronta = pecaPor(cedo, (p) => p.status === 'ready' && p.type !== 'STATIC' && p.type !== 'HEADLINE'); // 27/10: HEADLINE só no aspecto do campeão
  const pend = cedo.pieces.filter((p: any) => p.type !== 'STATIC' && ['queued', 'rendering'].includes(p.status)).length;
  test.info().annotations.push({ type: 'peças de vídeo ainda pendentes no pedido do 4:5', description: String(pend) });
  for (const body of [{ format: '9x16' }, { format: '16x9' }, {}, { format: '4x5', x: 1 }]) {
    expectErro(await as('donoA').post(`/iterate/pieces/${pronta.id}/formats`, body), 400, 'VALIDATION_ERROR');
  }
  expectErro(await as('clienteA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '4x5' }), 403, 'FORBIDDEN');
  expectErro(await as('donoB').post(`/iterate/pieces/${pronta.id}/formats`, { format: '4x5' }), 404, 'NOT_FOUND');
  const r1 = await as('membroA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '4x5' });
  expect(r1.status, JSON.stringify(r1.body)).toBe(202);
  expect(['queued', 'rendering']).toContain(fmt(r1.data, '4x5').state);
  expect(fmt(r1.data, '4x5').requestUsd ?? 0).toBe(0);
  const r2 = await as('adminA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '4x5' });
  expect(r2.status, 'pedido repetido na fila = 200').toBe(200);
  // concorrência: dois 1:1 ao mesmo tempo = um 202 e um 200, 1 render só
  const [c1, c2] = await Promise.all([as('donoA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '1x1' }), as('adminA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '1x1' })]);
  expect([c1.status, c2.status].sort()).toEqual([200, 202]);
  const fim = await ateLote('donoA', b.id, (x) => assentou(x) && fmt(pecaPor(x, (p: any) => p.id === pronta.id), '1x1').state === 'ready' && fmt(pecaPor(x, (p: any) => p.id === pronta.id), '4x5').state === 'ready', { timeoutMs: 700_000, oQue: '4:5 e 1:1 prontos' });
  const rs = await rendersDe(pronta.creativeId);
  expect(rs.map((r) => r.format).sort()).toEqual(['PORTRAIT_4_5', 'SQUARE_1_1', 'VERTICAL_9_16']);
  const r45 = rs.find((r) => r.format === 'PORTRAIT_4_5')!;
  expect(r45.priority).toBe(10);
  expect(r45.engine).toBe('REMOTION');
  // prioridade: o 4:5 começou antes de todo 9:16 do lote que ainda estava na fila quando foi pedido
  const lote = await q<{ started_at: Date; created_at: Date }>(
    `select r.started_at, r.created_at from renders r join creatives c on c.id = r.creative_id where c.variation_batch_id = $1 and r.format = 'VERTICAL_9_16' and r.engine = 'REMOTION' and r.started_at > $2`,
    [b.id, r45.created_at]);
  const depois = lote.filter((r) => r.started_at > r45.started_at!).length;
  test.info().annotations.push({ type: 'prioridade', description: `9:16 começados depois do pedido: ${lote.length}; depois do 4:5: ${depois}` });
  if (pend > 1) expect(depois, '4:5 roda antes dos 9:16 que faltavam (só o que já rodava pode vir antes)').toBeGreaterThanOrEqual(lote.length - 1);
  // pronto = 200 sem render novo; peça segue APPROVED
  const r3 = await as('donoA').post(`/iterate/pieces/${pronta.id}/formats`, { format: '4x5' });
  expect(r3.status).toBe(200);
  expect((await rendersDe(pronta.creativeId)).length).toBe(3);
  const p = pecaPor(fim, (x) => x.id === pronta.id);
  expect(p.formatsReady).toBe(3);
  expect(p.status).toBe('ready');
  expect((await q(`select state from creatives where id = $1`, [pronta.creativeId]))[0].state).toBe('APPROVED');
  // fase não volta; summary.files conta os formatos feitos
  expect(fim.phase).toBe('download');
  expect(fim.summary.files).toBe(n + 2);
  // zip leva 9:16 + 4:5 + 1:1 da peça
  const { url } = await zipPronto('donoA', b.id);
  const lista = await listaZip(url);
  for (const f of ['9x16', '4x5', '1x1']) expect(lista.some((x) => x.endsWith(`${pronta.code}_${f}.mp4`)), `${f} no zip`).toBe(true);
  // download ?format=4x5 agora passa
  const d = expectOk(await as('clienteA').get(`/creatives/${pronta.creativeId}/download?format=4x5`));
  expect(d.fileName ?? d.filename).toMatch(new RegExp(`${pronta.code}_4x5\\.mp4$`));
});

test('R-04 [mock:format-fail:NATIVE_SEARCH] 4:5 falha (RENDER_ERROR), peça segue ready e no zip sem o 4:5; pedir de novo passa (antigo vira stale)', async () => {
  await oferta('A', { notes: '[mock:format-fail:NATIVE_SEARCH]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const cut = pecaPor(fim, (p) => p.type === 'NATIVE_SEARCH'); // 27/10: HOOK_TEXT saiu do catálogo (HEADLINE não tem 4:5)
  expect(cut, 'plano com NATIVE_SEARCH').toBeTruthy();
  expect(cut.status, 'format-fail não mexe no 9:16').toBe('ready');
  expectOk(await as('donoA').post(`/iterate/pieces/${cut.id}/formats`, { format: '4x5' }), 202);
  const f1 = await ateLote('donoA', b.id, (x) => ['failed', 'ready'].includes(fmt(pecaPor(x, (p: any) => p.id === cut.id), '4x5').state), { oQue: '4:5 do CUT' });
  const p1 = pecaPor(f1, (p) => p.id === cut.id);
  const f45 = fmt(p1, '4x5');
  expect(f45.state).toBe('failed');
  expect(f45.errorCode).toBe('RENDER_ERROR');
  expect(f45.failReason).toBeTruthy();
  expect(p1.status).toBe('ready');
  expect(p1.inZip).toBe(true);
  expect(p1.errorCode).toBeNull();
  const [{ b: z, url }] = [await zipPronto('donoA', b.id)];
  const lista = await listaZip(url);
  expect(lista.some((x) => x.endsWith(`${cut.code}_9x16.mp4`))).toBe(true);
  expect(lista.some((x) => x.includes(`${cut.code}_4x5`))).toBe(false);
  expect(z.zip.files).toBe(fim.pieces.length);
  // de novo: 202, o FAILED vira stale, o novo passa
  expectOk(await as('donoA').post(`/iterate/pieces/${cut.id}/formats`, { format: '4x5' }), 202);
  await ateLote('donoA', b.id, (x) => fmt(pecaPor(x, (p: any) => p.id === cut.id), '4x5').state === 'ready', { oQue: 'retry 4:5' });
  const rs = (await rendersDe(cut.creativeId)).filter((r) => r.format === 'PORTRAIT_4_5');
  expect(rs.map((r) => [r.status, r.stale, r.error_code])).toEqual([['FAILED', true, 'RENDER_ERROR'], ['READY', false, null]]);
  // o zip refaz com o 4:5 (zipKey mudou)
  const { url: url2 } = await zipPronto('donoA', b.id);
  expect((await listaZip(url2)).some((x) => x.endsWith(`${cut.code}_4x5.mp4`))).toBe(true);
});

test('R-05 STATIC sob demanda: 4:5 cria IMAGE_GEN p10 + 1 task STATIC_IMAGE aspecto 4:5, PNG no zip; teto bloqueia STATIC e não bloqueia vídeo', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const st = pecaPor(fim, (p) => p.type === 'STATIC');
  const vid = pecaPor(fim, (p) => p.type !== 'STATIC' && p.type !== 'HEADLINE'); // 27/10: HEADLINE só no aspecto do campeão
  // teto: gasto 0, teto 0,10 < preço da imagem → STATIC = 409; vídeo passa (grátis)
  await q(`update workspaces set monthly_spend_cap_usd = 0.1 where id = $1`, [WS.A]);
  expectErro(await as('donoA').post(`/iterate/pieces/${st.id}/formats`, { format: '4x5' }), 409, 'SPEND_CAP_EXCEEDED');
  expect((await rendersDe(st.creativeId)).length, 'teto não cria render').toBe(1);
  expectOk(await as('donoA').post(`/iterate/pieces/${vid.id}/formats`, { format: '1x1' }), 202);
  await q(`update workspaces set monthly_spend_cap_usd = 200 where id = $1`, [WS.A]);
  expectOk(await as('donoA').post(`/iterate/pieces/${st.id}/formats`, { format: '4x5' }), 202);
  const f = await ateLote('donoA', b.id, (x) => ['ready', 'failed'].includes(fmt(pecaPor(x, (p: any) => p.id === st.id), '4x5').state) && fmt(pecaPor(x, (p: any) => p.id === vid.id), '1x1').state === 'ready', { oQue: '4:5 do STATIC' });
  const p = pecaPor(f, (x) => x.id === st.id);
  expect(fmt(p, '4x5').state).toBe('ready');
  expect(p.files.map((x: any) => x.name)).toEqual([expect.stringMatching(/_9x16\.png$/), expect.stringMatching(/_4x5\.png$/)]);
  const r45 = (await rendersDe(st.creativeId)).find((r) => r.format === 'PORTRAIT_4_5')!;
  expect(r45.engine).toBe('IMAGE_GEN');
  expect(r45.priority).toBe(10);
  const tks = await tasksDoRender(r45.id);
  expect(tks.length).toBe(1);
  expect(JSON.stringify(tks[0].input)).toMatch(/4:5/);
  // dimensões do PNG 4:5
  const d = expectOk(await as('donoA').get(`/creatives/${st.creativeId}/download?format=4x5`));
  const png = Buffer.from(await (await fetch(d.url)).arrayBuffer());
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  test.info().annotations.push({ type: 'PNG 4:5', description: `${w}x${h}` });
  expect(w / h).toBeCloseTo(0.8, 1);
  const { url } = await zipPronto('donoA', b.id);
  expect((await listaZip(url)).some((x) => x.endsWith(`${st.code}_4x5.png`))).toBe(true);
});

test('R-06 [mock:static-reject]: 1ª recusa, reenvio safe passa (2 tasks no render); [mock:static-timeout]: reenvio passa', async () => {
  for (const gat of ['[mock:static-reject]', '[mock:static-timeout]']) {
    const o = await oferta('A', { notes: gat });
    const b = await lotePronto('donoA', PODCAST, o.id);
    expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
    const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
    for (const st of fim.pieces.filter((p: any) => p.type === 'STATIC')) {
      expect(st.status, `${gat} ${st.code}`).toBe('ready');
      const [r] = await rendersDe(st.creativeId);
      const tks = await tasksDoRender(r.id);
      test.info().annotations.push({ type: gat, description: tks.map((t) => `${t.status}/${t.error_code}/safe=${JSON.stringify(t.input?.safe ?? null)}`).join(' → ') });
      expect(tks.length, `${gat}: 2 tasks (1 reenvio)`).toBe(2);
      expect(tks[0].status).not.toBe('COMPLETED');
      expect(tks[1].status).toBe('COMPLETED');
      if (gat === '[mock:static-reject]') expect(tks[0].error_code).toBe('SAFETY_BLOCK');
    }
  }
});

test('R-07 [mock:static-reject-all]: STATIC failed SAFETY_BLOCK (2 tasks), retryUsd = preço da imagem; retry checa teto; outras peças seguem; leave-out', async () => {
  await oferta('A', { notes: '[mock:static-reject-all]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const sts = fim.pieces.filter((p: any) => p.type === 'STATIC');
  expect(fim.summary.failed).toBe(sts.length);
  expect(fim.summary.ready).toBe(fim.pieces.length - sts.length);
  const st = sts[0];
  expect(st.status).toBe('failed');
  expect(st.errorCode).toBe('SAFETY_BLOCK');
  expect(st.retryHint).toBe('retry');
  test.info().annotations.push({ type: 'peça STATIC falha', description: JSON.stringify({ errorCode: st.errorCode, failReason: st.failReason, retryUsd: st.retryUsd, f: fmt(st, '9x16') }) });
  expect(st.retryUsd).toBeCloseTo(PRECO_STATIC, 4);
  expect(fmt(st, '9x16').state).toBe('failed');
  const [r] = await rendersDe(st.creativeId);
  expect((await tasksDoRender(r.id)).length).toBe(2);
  // formato de peça failed = 409
  expectErro(await as('donoA').post(`/iterate/pieces/${st.id}/formats`, { format: '4x5' }), 409, 'INVALID_STATE');
  // retry com teto estourado = 409 e nada muda
  await q(`update workspaces set monthly_spend_cap_usd = 0.1 where id = $1`, [WS.A]);
  expectErro(await as('donoA').post(`/iterate/pieces/${st.id}/retry`, {}), 409, 'SPEND_CAP_EXCEEDED');
  expect((await rendersDe(st.creativeId)).length).toBe(1);
  await q(`update workspaces set monthly_spend_cap_usd = 200 where id = $1`, [WS.A]);
  // retry sem teto: falha de novo (reject-all) com mais 2 tasks
  const rr = await as('donoA').post(`/iterate/pieces/${st.id}/retry`, {});
  expect(rr.status, JSON.stringify(rr.body)).toBe(202);
  await ateLote('donoA', b.id, (x) => pecaPor(x, (p: any) => p.id === st.id).status === 'failed' && assentou(x), { timeoutMs: 120_000, oQue: 'retry STATIC' });
  const rs = await rendersDe(st.creativeId);
  expect(rs.map((x) => [x.status, x.stale])).toEqual([['FAILED', true], ['FAILED', false]]);
  // leave-out
  const lo = expectOk(await as('donoA').post(`/iterate/pieces/${st.id}/leave-out`, {}));
  expect(lo.status).toBe('left_out');
  expect(lo.inZip).toBe(false);
});

test('R-08 retry do 9:16 de vídeo ([mock:render-fail:REVIEW]) é grátis e não passa pelo teto', async () => {
  await oferta('A', { notes: '[mock:render-fail:REVIEW]' }); // 27/10: STORY saiu do catálogo
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const story = pecaPor(fim, (p) => p.type === 'REVIEW');
  expect(story.status).toBe('failed');
  expect(story.retryUsd ?? 0).toBe(0);
  expect(fmt(story, '9x16').state).toBe('failed');
  await q(`update workspaces set monthly_spend_cap_usd = 0 where id = $1`, [WS.A]);
  expectOk(await as('donoA').post(`/iterate/pieces/${story.id}/retry`, {}), 202);
  const f = await ateLote('donoA', b.id, (x) => pecaPor(x, (p: any) => p.id === story.id).status === 'ready', { oQue: 'retry STORY' });
  expect(pecaPor(f, (p) => p.id === story.id).formats.map((x: any) => x.state)).toEqual(['ready', 'none', 'none']);
});

test('R-09 retomada no boot: IMAGE_GEN QUEUED órfão é submetido por uma 2ª API (mesmo banco)', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const st = pecaPor(fim, (p) => p.type === 'STATIC');
  // render IMAGE_GEN 1:1 QUEUED inserido direto (como se a API tivesse caído antes do dispatch)
  const id = `qa_r_${Date.now()}`;
  await q(`insert into renders (id, workspace_id, creative_id, status, format, engine, priority, settings, input, created_at)
           values ($1, $2, $3, 'QUEUED', 'SQUARE_1_1', 'IMAGE_GEN', 10, '{"templateId":"auto-edit"}'::jsonb, '{}'::jsonb, now())`, [id, WS.A, st.creativeId]).catch(async (e) => {
    test.info().annotations.push({ type: 'insert render', description: e.message });
    throw e;
  });
  const { subirSegundaApi } = await import('../../harness/segunda-api.ts');
  const api2 = await subirSegundaApi();
  try {
    await expect.poll(async () => (await q(`select status from renders where id = $1`, [id]))[0].status, { timeout: 60_000 }).toBe('READY');
  } finally {
    await api2.parar();
  }
  expect((await tasksDoRender(id)).length).toBeGreaterThanOrEqual(1);
});
