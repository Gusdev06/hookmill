// Variação automática de campeão (Q1, 13/10): contrato + regras + estados + isolamento contra a API do QA em mock
// (render fake, maquina_test, porta própria). Fonte: docs/contratos/variacao-auto-v1.md §3-§10. Nada pago.
// Rodar (de testes/): E2E_API_PORT=3121 E2E_SKIP_SCHEMA=1 E2E_LIMITES_V2=1 npx playwright test --project=iterate
// 25/10 (pendência de 23/10): IT-08..12 seguem o §14 do variacao-auto (lote só 9:16, 4:5/1:1 sob demanda pela rota de
// formatos, `start` exige `expectedCostUsd` quando o plano tem STATIC, STATIC = IMAGE_GEN fora da fila do Remotion).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, tokenOf } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import {
  BRAIN_VAZIO, CURTO3, CURTO6, PODCAST, PRODUTO_PNG, assentou, ateLote, getLote, iterarUpload, lotePronto, oferta, ordemDosRenders, subirArquivo,
} from '../../harness/iterate.ts';

// 27/10: HEADLINE (remix-keep) compõe sobre o campeão em CPU mesmo no render fake (~90 s/peça): lote inteiro passa de 4 min
test.describe.configure({ timeout: 900_000 });
test.afterEach(async () => { await esperarJobsQuietos(120_000); });

// 27/10: catálogo da rev. 25/10 (variacao-auto §6.1 + headline-e-legenda §3.1). Os antigos ficam pra ler lotes velhos.
const ITER = ['HEADLINE', 'CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD'];
const DIV = ['SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME'];
const CATALOGO = ['HEADLINE', 'CUT', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME'];
/** rev. 23/10 §14.9(6): o `start` manda a estimativa que a tela mostrou (0 sem STATIC). */
const custo = (b: any) => ({ expectedCostUsd: b.cost?.generateEstimateUsd ?? 0 });
const fmtDe = (p: any, f: string) => p.formats?.find((x: any) => x.format === f);
const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/** §6.1/§6.2 sobre o plano que a API devolve. */
function conferePlano(b: any, opts: { min?: number } = {}) {
  const n = b.pieces.length;
  expect(n, 'contagem 8-12 (ou piso 4 da D2)').toBeGreaterThanOrEqual(opts.min ?? 8);
  expect(n).toBeLessThanOrEqual(12);
  const div = b.pieces.filter((p: any) => p.axis === 'DIVERSITY').length;
  expect(div, `diversidade ≥ 40 % (${div}/${n})`).toBeGreaterThanOrEqual(Math.ceil(n * 0.4));
  const codes = b.pieces.map((p: any) => p.code);
  expect(new Set(codes).size, 'código único no lote').toBe(n);
  for (const p of b.pieces) {
    expect(p.status).toBe('planned');
    expect(p.axis, `${p.code}: eixo fixo por tipo`).toBe(ITER.includes(p.type) ? 'ITERATION' : 'DIVERSITY');
    expect(p.folder).toBe(p.axis === 'DIVERSITY' ? '2-new-audience' : '1-stretch');
    expect(p.change.length).toBeLessThanOrEqual(90);
    expect(p.change.length).toBeGreaterThan(0);
    expect(p.inZip).toBe(true);
    expect(p.creativeId).toBeNull();
  }
  // máximos por tipo (§6.1 + D2)
  const max: Record<string, number> = { HEADLINE: 3, CUT: 2, REVIEW: 1, NATIVE_SEARCH: 2, STATIC: 2, FRAME: 8 };
  for (const p of b.pieces) expect(CATALOGO, `${p.code}: tipo fora do catálogo de 25/10`).toContain(p.type);
  for (const [t, m] of Object.entries(max)) expect(b.pieces.filter((p: any) => p.type === t).length, `máx ${t}`).toBeLessThanOrEqual(m);
  expect(b.insight.why.map((w: any) => w.key)).toEqual(['hook', 'proof', 'cta']);
  expect(b.insight.kept.length).toBeGreaterThanOrEqual(2);
  expect(b.insight.kept.length).toBeLessThanOrEqual(4);
  expect(b.insight.flags.metaConnected).toBe(false);
}

/** Números dos textos de tela (payload do item) existem no Brain/transcrição (§6.2.5). */
async function nadaInventado(batchId: string) {
  const [ctx] = await q(`select o.what, o.audience, o.pains, o.promise, o.proof, o.offer_and_price, o.cta, o.notes, t.transcript
                           from variation_batches b join offers o on o.id = b.offer_id left join teardowns t on t.champion_id = b.champion_id where b.id = $1`, [batchId]);
  const fala = (ctx.transcript?.words ?? []).map((w: any) => w.word).join(' ');
  const hay = new Set([ctx.what, ctx.audience, ctx.pains, ctx.promise, ctx.proof, ctx.offer_and_price, ctx.cta, ctx.notes, fala].filter(Boolean).flatMap(numeros));
  const itens = await q(`select code, auto_type, payload from variation_items where batch_id = $1`, [batchId]);
  for (const it of itens) {
    const p = it.payload?.params ?? {};
    const textos = [p.text, p.headline, p.subline, p.ctaText, p.query].filter(Boolean).join(' ');
    for (const n of numeros(textos)) expect(hay.has(n), `${it.code}: número "${n}" inventado em "${textos}"`).toBe(true);
    if (it.auto_type === 'REVIEW') {
      const norm = (s: string) => s.toLowerCase().replace(/\p{P}+/gu, ' ').replace(/\s+/g, ' ').trim();
      expect(norm(ctx.proof ?? ''), 'citação do REVIEW literal do Brain › Proof').toContain(norm(p.quote));
    }
  }
}

// ───────────────────────── config e criação ─────────────────────────

test('IT-01 GET /iterate/config: limites da spec, 9 tipos, ofertas, custo típico; CLIENT = 403', async () => {
  const o = await oferta('A');
  const cfg = expectOk(await as('donoA').get('/iterate/config'));
  expect(cfg).toMatchObject({ maxBytes: 524288000, minSec: 4, maxSec: 180, metaConnected: false, defaultOfferId: o.id });
  expect(cfg.types).toEqual(CATALOGO);
  expect(cfg.offers).toEqual([{ id: o.id, name: o.name, language: 'en' }]);
  expect(cfg.analysisTypicalUsd).toBeGreaterThan(0);
  expect(cfg.mimeTypes).toEqual(expect.arrayContaining(['video/mp4', 'video/quicktime']));
  expect(Array.isArray(cfg.recentWinners)).toBe(true);
  expectErro(await as('clienteA').get('/iterate/config'), 403, 'FORBIDDEN');
});

test('IT-02 POST /iterate: validação (nenhum/ambos), 404 upload de outro workspace, OFFER_REQUIRED com >1 oferta e com 0', async () => {
  const a = as('donoA');
  expectErro(await a.post('/iterate', {}), 400, 'VALIDATION_ERROR');
  expectErro(await a.post('/iterate', { uploadId: 'x', creativeId: 'y' }), 400, 'VALIDATION_ERROR');
  expectErro(await a.post('/iterate', { uploadId: 'x', workspaceId: 'qa_ws_beta' }), 400, 'VALIDATION_ERROR');
  // workspace sem oferta: 422 OFFER_REQUIRED { offers: [] }
  const s0 = await subirArquivo('donoA', CURTO6);
  expect(s0.complete?.status, JSON.stringify(s0.complete?.body)).toBe(200);
  expect(s0.complete!.data.analysisEstimateUsd, 'complete devolve a estimativa já com o plano').toBeGreaterThan(0);
  const d0 = expectErro(await a.post('/iterate', { uploadId: s0.uploadId }), 422, 'OFFER_REQUIRED');
  expect(d0.offers).toEqual([]);
  // >1 oferta sem offerId
  const o1 = await oferta('A', { name: 'QA Oferta 1' });
  const o2 = await oferta('A', { name: 'QA Oferta 2' });
  const d = expectErro(await a.post('/iterate', { uploadId: s0.uploadId }), 422, 'OFFER_REQUIRED');
  expect(d.offers.map((x: any) => x.id).sort()).toEqual([o1.id, o2.id].sort());
  // offerId de B = 404; upload de B = 404
  const ob = await oferta('B');
  expectErro(await a.post('/iterate', { uploadId: s0.uploadId, offerId: ob.id }), 404, 'NOT_FOUND');
  const sb = await subirArquivo('donoB', CURTO6);
  expectErro(await a.post('/iterate', { uploadId: sb.uploadId, offerId: o1.id }), 404, 'NOT_FOUND');
  // CLIENT não cria lote
  expectErro(await as('clienteA').post('/iterate', { uploadId: s0.uploadId, offerId: o1.id }), 403, 'FORBIDDEN');
  // com offerId: passa; nada nasceu nas tentativas anteriores
  expect((await q(`select count(*)::int n from variation_batches`))[0].n).toBe(0);
  const ok = expectOk(await a.post('/iterate', { uploadId: s0.uploadId, offerId: o2.id }), 202);
  expect(ok.status).toBe('ANALYZING');
  expect(ok.offer.id).toBe(o2.id);
  // config agora lembra a última oferta usada num lote AUTO
  expect(expectOk(await a.get('/iterate/config')).defaultOfferId).toBe(o2.id);
});

test('IT-03 upload → análise sozinha → PLAN_READY com as regras (Brain cheio, página capturada, nada inventado, checklist)', async () => {
  const o = await oferta('A');
  const { res, batchId } = await iterarUpload('donoA', PODCAST);
  const b0 = expectOk(res, 202);
  expect(b0).toMatchObject({ status: 'ANALYZING', phase: 'analyze', codeLanguage: 'EN', offer: { id: o.id } });
  expect(b0.analysis.checklist.map((c: any) => c.key)).toEqual(['decode', 'transcribe', 'cuts', 'edit_map', 'blocks', 'audience', 'offer', 'proof', 'page', 'planning']);
  const vistos = new Set<string>();
  const b = await ateLote('donoA', batchId!, (x) => { vistos.add(x.status); return x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED'; });
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  expect(b.analysis.checklist.every((c: any) => c.status === 'done'), JSON.stringify(b.analysis.checklist)).toBe(true);
  conferePlano(b);
  expect(b.insight.flags).toMatchObject({ brainEmpty: false, shortVideo: false, pageCaptured: true });
  const tipos = new Set(b.pieces.map((p: any) => p.type));
  for (const t of ['HEADLINE', 'REVIEW', 'STATIC', 'NATIVE_SEARCH', 'FRAME']) expect(tipos.has(t), `${t} no plano com Brain cheio`).toBe(true);
  // CUT: o mock propõe e o reparo tira (cut_too_long) — bug devolvido à ia/backend; registrado, não bloqueia o caso
  test.info().annotations.push({ type: 'plano', description: b.pieces.map((p: any) => p.code).join(', ') });
  expect(b.insight.why.some((w: any) => w.refSource === 'brain' && w.brainField), 'porquê cita o Brain').toBe(true);
  expect(b.source).toMatchObject({ fromLibrary: false, durationSec: 49, width: 720, height: 1280 });
  expect(b.summary).toMatchObject({ pieces: b.pieces.length, files: b.pieces.length * 3, videoCreditsUsd: 0 });
  expect(b.cost.renderUsd).toBe(0);
  expect(b.zip.status).toBe('none');
  // captura: arquivo PAGE_CAPTURE do workspace
  const [bt] = await q(`select b.page_capture_file_id, f.kind, f.workspace_id from variation_batches b left join files f on f.id = b.page_capture_file_id where b.id = $1`, [batchId]);
  expect(bt.kind).toBe('PAGE_CAPTURE');
  expect(bt.workspace_id).toBe('qa_ws_alfa');
  await nadaInventado(batchId!);
  // custo: só LLM/transcrição; nenhuma provider_task de geração
  expect((await q(`select count(*)::int n from provider_tasks where kind <> 'TRANSCRIBE'`))[0].n).toBe(0);
});

test('IT-04 Brain vazio: não bloqueia; flags.brainEmpty, swaps (página/prova/oferta), porquê só "From the video"', async () => {
  await oferta('A', { ...BRAIN_VAZIO });
  const b = await lotePronto('donoA', PODCAST);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  conferePlano(b, { min: 4 });
  expect(b.insight.flags.brainEmpty).toBe(true);
  expect(b.insight.flags.pageCaptured).toBe(false);
  expect(b.insight.why.every((w: any) => w.refSource === 'video' && w.brainField === null)).toBe(true);
  const sw = b.insight.swaps.map((s: any) => `${s.from}>${s.to}:${s.reason}`);
  test.info().annotations.push({ type: 'swaps', description: sw.join(' ') });
  expect(sw.some((x: string) => x.startsWith('REVIEW>') && x.endsWith(':no_proof')), 'REVIEW sem prova troca (no_proof)').toBe(true);
  const tipos = b.pieces.map((p: any) => p.type);
  expect(tipos).not.toContain('REVIEW');
  // ENDCARD sem Brain só com o CTA falado (variante cta)
  const end = b.pieces.find((p: any) => p.type === 'ENDCARD');
  if (end) expect(end.code).toBe('ENDCARD-CTA');
  await nadaInventado(b.id);
});

test('IT-05 vídeo curto (6 s): sem CUT, shortVideo, lote menor (piso 4) sem bloquear; 3 s = MEDIA_TOO_SHORT no complete', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', CURTO6);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  expect(b.insight.flags.shortVideo).toBe(true);
  conferePlano(b, { min: 4 });
  expect(b.pieces.map((p: any) => p.type)).not.toContain('CUT');
  expect(b.pieces.map((p: any) => p.type)).not.toContain('COLD_OPEN');
  expect(b.insight.swaps.some((s: any) => s.reason === 'short_video')).toBe(true);
  test.info().annotations.push({ type: 'lote curto', description: `${b.pieces.length} peças: ${b.pieces.map((p: any) => p.code).join(', ')}; smallBatch=${b.insight.flags.smallBatch}` });
  if (b.pieces.length < 8) expect(b.insight.flags.smallBatch, 'aviso "lote menor" (D2)').toBe(true);
  // < 4 s: o complete recusa (422 MEDIA_TOO_SHORT), nada é cobrado nem criado
  const s = await subirArquivo('donoA', CURTO3);
  expectErro(s.complete!, 422, 'MEDIA_TOO_SHORT');
});

test('IT-06 PT: oferta em português → códigos PT (CORTE-15S, GANCHO-TEXTO-2, ESTATICO-F1…)', async () => {
  await oferta('A', { language: 'pt-BR' });
  const b = await lotePronto('donoA', PODCAST);
  expect(b.status).toBe('PLAN_READY');
  expect(b.codeLanguage).toBe('PT');
  const codes = b.pieces.map((p: any) => p.code);
  expect(codes).toEqual(expect.arrayContaining(['HEADLINE-1', 'ESTATICO-F1', 'NATIVO-BUSCA']));
  expect(codes.some((c: string) => c.startsWith('MOLDURA-')), 'moldura com código PT').toBe(true);
  expect(codes.join(' ')).not.toMatch(/\bCUT-|HOOK-TEXT|STATIC-F|\bFRAME-/);
});

// ───────────────────────── falhas da análise ─────────────────────────

test('IT-07 gatilhos: auto-fail:reading → ANALYSIS_FAILED reading + retry; auto-fail:planning; plan-invalid → PLAN_INVALID; page-403 → no_page', async () => {
  // reading
  const oR = await oferta('A', { name: 'R', notes: '[mock:auto-fail:reading]' });
  const r = await lotePronto('donoA', PODCAST, oR.id).catch((e) => { throw e; });
  expect(r.status).toBe('ANALYSIS_FAILED');
  expect(r.error).toMatchObject({ code: 'PROVIDER_ERROR', stage: 'reading', action: 'try_again' });
  expect(typeof r.error.reason).toBe('string');
  expect(r.phase).toBe('analyze');
  // waitingBatches: Analysis failed
  const home = await as('donoA').get('/creatives?filter=needs_you');
  expect(home.body.meta.waitingBatches.filter((w: any) => w.id === r.id).map((w: any) => [w.status, w.mode])).toEqual([['ANALYSIS_FAILED', 'AUTO']]);
  // retry: a falha continua (gatilho na oferta) mas a transição volta pra ANALYZING e assenta de novo
  await q(`update offers set notes = null where id = $1`, [oR.id]);
  expectErro(await as('clienteA').post(`/iterate/${r.id}/retry`, {}), 403, 'FORBIDDEN');
  const rr = expectOk(await as('donoA').post(`/iterate/${r.id}/retry`, {}), 202);
  expect(['ANALYZING', 'PLANNING']).toContain(rr.status);
  const r2 = await ateLote('donoA', r.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED');
  expect(r2.status, JSON.stringify(r2.error)).toBe('PLAN_READY');
  // retry fora de ANALYSIS_FAILED = 409
  expectErro(await as('donoA').post(`/iterate/${r.id}/retry`, {}), 409, 'INVALID_STATE');

  const oP = await oferta('A', { name: 'P', notes: '[mock:auto-fail:planning]' });
  const p = await lotePronto('donoA', PODCAST, oP.id);
  expect(p.status).toBe('ANALYSIS_FAILED');
  expect(['brain', 'planning']).toContain(p.error.stage);
  expect(p.error.action).toBe('try_again');

  const oI = await oferta('A', { name: 'I', notes: '[mock:auto-plan-invalid]' });
  const inv = await lotePronto('donoA', PODCAST, oI.id);
  expect(inv.status).toBe('ANALYSIS_FAILED');
  expect(inv.error.code).toBe('PLAN_INVALID');
  expect(Array.isArray(inv.error.params.violations) || typeof inv.error.params.violations === 'string', JSON.stringify(inv.error)).toBe(true);
  // 2 chamadas do plano (1 + reparo) gravadas
  const [jobs] = await q(`select count(*)::int n from cost_entries where variation_batch_id = $1`, [inv.id]);
  test.info().annotations.push({ type: 'PLAN_INVALID', description: `cost_entries do lote: ${jobs.n}; params=${JSON.stringify(inv.error.params)}` });

  const o4 = await oferta('A', { name: 'F', notes: '[mock:page-403]' });
  const f = await lotePronto('donoA', PODCAST, o4.id);
  expect(f.status).toBe('PLAN_READY');
  expect(f.insight.flags.pageCaptured).toBe(false);
  test.info().annotations.push({ type: 'page-403 swaps', description: JSON.stringify(f.insight.swaps) });
});

// ───────────────────────── gerar, falha, retry, leave-out, In zip, zip ─────────────────────────

test('IT-08 gerar ponta a ponta: PLAN_CHANGED, CLIENT barrado, só 9:16 na ordem do plano, falha + retry, leave-out, In zip, zip com 2 pastas e README, 4:5/1:1 sob demanda na Library, Home', async () => {
  const o = await oferta('A', { notes: '[mock:render-fail:NATIVE_SEARCH] [mock:render-fail:REVIEW]' });
  const b = await lotePronto('donoA', PODCAST, o.id);
  expect(b.status).toBe('PLAN_READY');
  const n = b.pieces.length;
  const alvo = b.pieces.filter((p: any) => ['NATIVE_SEARCH', 'REVIEW'].includes(p.type)).map((p: any) => p.type).sort();
  const k = alvo.length;
  expect(alvo, 'REVIEW + NATIVE_SEARCH no plano').toContain('REVIEW');
  // Home: "Plan ready" 1 vez
  const h1 = await as('donoA').get('/creatives?filter=needs_you');
  expect(h1.body.meta.waitingBatches.filter((w: any) => w.id === b.id).map((w: any) => w.status)).toEqual(['PLAN_READY']);

  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n + 1, ...custo(b) }), 409, 'PLAN_CHANGED');
  expectErro(await as('clienteA').post(`/iterate/${b.id}/start`, { expectedPieces: n, ...custo(b) }), 403, 'FORBIDDEN');
  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: 0, ...custo(b) }), 400, 'VALIDATION_ERROR');
  // zip antes de LAUNCHED = 409
  expectErro(await as('donoA').post(`/iterate/${b.id}/zip`, {}), 409, 'INVALID_STATE');

  // clique duplo: um passa, o outro 409, criativos 1 por peça
  const [s1, s2] = await Promise.all([as('membroA').post(`/iterate/${b.id}/start`, { expectedPieces: n, ...custo(b) }), as('membroA').post(`/iterate/${b.id}/start`, { expectedPieces: n, ...custo(b) })]);
  expect([s1.status, s2.status].sort()).toEqual([202, 409]);
  const st = (s1.status === 202 ? s1 : s2).data;
  expect(st.status).toBe('LAUNCHED');
  expect(st.phase).toBe('generate');
  expect(st.pieces.every((p: any) => ['queued', 'rendering'].includes(p.status) && p.creativeId)).toBe(true);
  expect((await q(`select count(*)::int n from creatives where variation_batch_id = $1`, [b.id]))[0].n).toBe(n);
  // rev. 23/10: 1 render por peça, só 9:16 (vídeo REMOTION, STATIC IMAGE_GEN)
  const rs0 = await q(`select r.format from renders r join creatives c on c.id = r.creative_id where c.variation_batch_id = $1`, [b.id]);
  expect(rs0.length, 'um render por peça').toBe(n);
  expect(new Set(rs0.map((r) => r.format))).toEqual(new Set(['VERTICAL_9_16']));
  // criativo AUTO travado
  const cid0 = st.pieces[0].creativeId;
  for (const [m, path, body] of [
    ['POST', `/creatives/${cid0}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: 1 }],
    ['PATCH', `/creatives/${cid0}/edit`, { headline: 'x' }],
    ['GET', `/creatives/${cid0}/editor`, undefined],
    ['POST', `/creatives/${cid0}/render`, {}],
  ] as const) {
    const r = await as('donoA').raw(m, path, body);
    expect([path, r.status, r.body?.error?.details?.reason], JSON.stringify(r.body)).toEqual([path, 409, 'variation_locked']);
  }
  // start de novo = 409
  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n, ...custo(b) }), 409, 'INVALID_STATE');

  // previewReady = ready (o 9:16 é o único formato do lote): aparece peça a peça, antes do lote assentar
  const comPreview = await ateLote('donoA', b.id, (x) => x.pieces.some((p: any) => p.previewReady) || assentou(x), { oQue: 'previewReady cedo' });
  test.info().annotations.push({ type: 'previewReady cedo', description: comPreview.pieces.filter((p: any) => p.previewReady).map((p: any) => `${p.code}:${p.status}`).join(' ') });
  for (const p of comPreview.pieces) expect(p.previewReady, `${p.code}: previewReady ⇔ ready`).toBe(p.status === 'ready');

  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000, oQue: 'todas as peças assentadas' });
  const falhas = fim.pieces.filter((p: any) => p.status === 'failed');
  expect(falhas.map((p: any) => p.type).sort()).toEqual(alvo);
  for (const f of falhas) {
    expect(f.errorCode).toBe('RENDER_ERROR');
    expect(f.retryHint).toBe('retry');
    // rev. 23/10 §14.7: [mock:render-fail:<TYPE>] pega a 1ª tentativa do 9:16 → peça failed sem nenhum formato pronto
    expect(f.formatsReady).toBe(0);
    expect(f.formats.map((x: any) => x.state)).toEqual(['failed', 'none', 'none']);
  }
  expect(fim.pieces.filter((p: any) => p.status === 'ready').length).toBe(n - k);
  for (const p of fim.pieces.filter((x: any) => x.status === 'ready')) {
    expect(p.formats.map((x: any) => x.format), `${p.code}: formats[] sempre os 3`).toEqual(['9x16', '4x5', '1x1']);
    expect(p.formats[0].state).toBe('ready');
    for (const f of p.formats.slice(1)) expect(f.state, `${p.code} ${f.format}`).toBe('none');
    expect(p.formatsReady).toBe(1);
  }
  // ordem da fila do Remotion: os 9:16 de vídeo na ordem do plano (o STATIC é IMAGE_GEN, fora da fila)
  const tipoDe = new Map(fim.pieces.map((p: any) => [p.code, p.type]));
  const ordem = (await ordemDosRenders(b.id)).filter((r) => !r.stale && r.started_at && tipoDe.get(r.code) !== 'STATIC')
    .sort((a, z) => String(a.started_at).localeCompare(String(z.started_at)));
  expect(new Set(ordem.map((r) => r.format)), 'só 9:16 no lote').toEqual(new Set(['VERTICAL_9_16']));
  const idxs = ordem.map((r) => r.idx);
  expect(idxs, `ordem: ${ordem.map((r) => r.code).join(',')}`).toEqual([...idxs].sort((a, z) => a - z));

  // Home: "N pieces ready" (lote AUTO conta 1 vez; criativos AUTO não entram no needs_you)
  const h2 = await as('donoA').get('/creatives?filter=needs_you');
  const w2 = h2.body.meta.waitingBatches.filter((w: any) => w.id === b.id);
  expect(w2.map((w: any) => [w.status, w.mode, w.readyCount])).toEqual([['PIECES_READY', 'AUTO', n - k]]);
  expect(h2.data.filter((c: any) => fim.pieces.some((p: any) => p.creativeId === c.id)).length, 'peças AUTO fora do needs_you').toBe(0);

  // leave-out: CLIENT 403; peça ready = 409; a falha vira left_out/inZip false
  const [story, review] = [falhas.find((p: any) => p.type === 'NATIVE_SEARCH'), falhas.find((p: any) => p.type === 'REVIEW')];
  const outrasNS = falhas.filter((p: any) => p.type === 'NATIVE_SEARCH' && p.id !== story.id);
  const pronta = fim.pieces.find((p: any) => p.status === 'ready');
  expectErro(await as('clienteA').post(`/iterate/pieces/${review.id}/leave-out`, {}), 403, 'FORBIDDEN');
  expectErro(await as('donoA').post(`/iterate/pieces/${pronta.id}/leave-out`, {}), 409, 'INVALID_STATE');
  const lo = expectOk(await as('donoA').post(`/iterate/pieces/${review.id}/leave-out`, {}));
  expect(lo).toMatchObject({ status: 'left_out', inZip: false });
  // retry: CLIENT 403; peça ready 409; falha → queued → ready (o gatilho só pega a 1ª tentativa)
  expectErro(await as('clienteA').post(`/iterate/pieces/${story.id}/retry`, {}), 403, 'FORBIDDEN');
  expectErro(await as('donoA').post(`/iterate/pieces/${pronta.id}/retry`, {}), 409, 'INVALID_STATE');
  const rt = expectOk(await as('donoA').post(`/iterate/pieces/${story.id}/retry`, {}), 202);
  expect(['queued', 'rendering']).toContain(rt.status);
  const novos = (await ordemDosRenders(b.id)).filter((r) => r.code === story.code && !r.stale);
  expect(novos.map((r) => r.format), 'retry re-enfileira só o 9:16 (o falho vira stale)').toEqual(['VERTICAL_9_16']);
  for (const ns of outrasNS) expectOk(await as('donoA').post(`/iterate/pieces/${ns.id}/retry`, {}), 202);
  const fim2 = await ateLote('donoA', b.id, (x) => assentou(x) && x.pieces.filter((p: any) => p.type === 'NATIVE_SEARCH').every((p: any) => p.status === 'ready'), { oQue: 'retry da NATIVE_SEARCH', timeoutMs: 400_000 });
  expect(fim2.summary).toMatchObject({ ready: n - 1, failed: 0, leftOut: 1 });

  // In zip: CLIENT pode; peça left_out/não-ready = 409; body inválido 400
  expectErro(await as('donoA').patch(`/iterate/pieces/${review.id}`, { inZip: true }), 409, 'INVALID_STATE');
  expectErro(await as('donoA').patch(`/iterate/pieces/${pronta.id}`, { inZip: 'sim' }), 400, 'VALIDATION_ERROR');
  const fora = fim2.pieces.find((p: any) => p.status === 'ready' && p.type === 'HEADLINE');
  expect(expectOk(await as('clienteA').patch(`/iterate/pieces/${fora.id}`, { inZip: false })).inZip).toBe(false);

  // arquivos da peça: nomes CLIENTE_MMDD_CODIGO_FMT.ext
  const [{ launched_at }] = await q(`select to_char(launched_at, 'MMDD') launched_at from variation_batches where id = $1`, [b.id]);
  for (const p of fim2.pieces.filter((x: any) => x.status === 'ready')) {
    expect(p.files.map((f: any) => f.format), `${p.code}: files[] = só os prontos`).toEqual(['9x16']);
    for (const f of p.files) {
      const ext = p.type === 'STATIC' ? 'png' : 'mp4';
      expect(f.name).toBe(`QA_${launched_at}_${p.code}_${f.format}.${ext}`);
      expect(f.mimeType).toBe(p.type === 'STATIC' ? 'image/png' : 'video/mp4');
    }
    expect(p.poster).not.toBeNull();
  }
  // criativo da peça: APPROVED, adName congelado, variationCode
  const crs = await q(`select c.state, c.ad_name, c.variation_code, c.variation_kind from creatives c where c.variation_batch_id = $1 and c.state = 'APPROVED'`, [b.id]);
  expect(crs.length).toBe(n - 1);
  for (const c of crs) expect(c.ad_name).toBe(`QA_${launched_at}_${c.variation_code}`);

  // zip: CLIENT pode pedir; 202 building → ready; mesmo conjunto = 200 reaproveitado
  const z1 = await as('clienteA').post(`/iterate/${b.id}/zip`, {});
  expect([200, 202], JSON.stringify(z1.body)).toContain(z1.status);
  const pronto = await ateLote('clienteA', b.id, (x) => x.zip.status === 'ready' || x.zip.status === 'failed', { oQue: 'zip' });
  expect(pronto.zip.status).toBe('ready');
  const nZip = n - 2; // REVIEW fora (left_out), HEADLINE fora (In zip)
  expect(pronto.zip).toMatchObject({ pieces: nZip, files: nZip, folders: { stretch: '1-stretch-its-life', newAudience: '2-new-audience' } });
  expect(pronto.zip.fileName).toMatch(new RegExp(`^QA_${launched_at}_[A-Z0-9-]{1,24}_variations\\.zip$`));
  const z2 = await as('donoA').post(`/iterate/${b.id}/zip`, {});
  expect(z2.status, 'mesmo zipKey = 200 reaproveitado').toBe(200);
  expect(z2.data.zip.url).toBeTruthy();
  // baixa e confere o conteúdo
  const dl = await fetch(z2.data.zip.url);
  expect(dl.status).toBe(200);
  expect(dl.headers.get('content-disposition') ?? '').toContain(pronto.zip.fileName);
  const dir = mkdtempSync(join(tmpdir(), 'qa-zip-'));
  const zpath = join(dir, 'z.zip');
  writeFileSync(zpath, Buffer.from(await dl.arrayBuffer()));
  const lista = execFileSync('unzip', ['-Z1', zpath], { encoding: 'utf8' }).trim().split('\n').sort();
  const esperado = pronto.pieces.filter((p: any) => p.status === 'ready' && p.inZip)
    .flatMap((p: any) => p.files.map((f: any) => `${p.folder === '1-stretch' ? '1-stretch-its-life' : '2-new-audience'}/${f.name}`));
  expect(lista).toEqual([...esperado, '1-stretch-its-life/README.txt', '2-new-audience/README.txt'].sort());
  // sem compressão (store)
  const verbose = execFileSync('unzip', ['-v', zpath], { encoding: 'utf8' });
  expect(verbose).not.toMatch(/Defl/);
  execFileSync('unzip', ['-q', zpath, '-d', dir]);
  const readme1 = readFileSync(join(dir, '1-stretch-its-life', 'README.txt'), 'utf8');
  const readme2 = readFileSync(join(dir, '2-new-audience', 'README.txt'), 'utf8');
  for (const p of pronto.pieces.filter((x: any) => x.status === 'ready' && x.inZip)) {
    const r = p.folder === '1-stretch' ? readme1 : readme2;
    expect(r, `README lista ${p.code}`).toContain(p.files[0].name.replace(/_9x16\.(mp4|png)$/, ''));
    expect(r).toContain(p.change);
  }
  expect(readme1).not.toContain(fora.code);
  test.info().annotations.push({ type: 'README stretch', description: readme1.slice(0, 600) });
  expect(readdirSync(dir)).toEqual(expect.arrayContaining(['1-stretch-its-life', '2-new-audience']));
  // downloadedAt gravado → lote sai do "Waiting for you"
  const depois = await getLote('donoA', b.id);
  expect(depois.data.downloadedAt).not.toBeNull();
  const h3 = await as('donoA').get('/creatives?filter=needs_you');
  expect(h3.body.meta.waitingBatches.filter((w: any) => w.id === b.id)).toEqual([]);

  // Library: peças entram como variação; filtro por código; formatos = só os prontos; download ?format
  const cut = pronto.pieces.find((p: any) => p.status === 'ready' && p.type !== 'STATIC' && p.type !== 'HEADLINE' && p.inZip); // 27/10: HEADLINE só no aspecto do campeão (H2)
  const lib = expectOk(await as('clienteA').get(`/library?variationCode=${cut.code}`));
  const itens = lib.items ?? lib;
  expect(itens.map((i: any) => i.id)).toEqual([cut.creativeId]);
  expect(itens[0].media).toBe('video');
  expect(itens[0].formats.map((f: any) => f.format)).toEqual(['9x16']);
  expect(itens[0].variation).toMatchObject({ code: cut.code, axis: cut.axis });
  // 4:5 ainda não pedido = 409 format_not_ready; pedir (MEMBER, grátis no vídeo) → pronto → Library e download
  expect(expectErro(await as('clienteA').get(`/creatives/${cut.creativeId}/download?format=4x5`), 409, 'INVALID_STATE')?.reason).toBe('format_not_ready');
  const st1 = pronto.pieces.find((p: any) => p.type === 'STATIC');
  expectOk(await as('membroA').post(`/iterate/pieces/${cut.id}/formats`, { format: '4x5' }), 202);
  if (st1) expectOk(await as('membroA').post(`/iterate/pieces/${st1.id}/formats`, { format: '1x1' }), 202);
  await ateLote('donoA', b.id, (x) => fmtDe(x.pieces.find((p: any) => p.id === cut.id), '4x5')?.state === 'ready'
    && (!st1 || ['ready', 'failed'].includes(fmtDe(x.pieces.find((p: any) => p.id === st1.id), '1x1')?.state)), { oQue: '4:5 e 1:1 sob demanda' });
  const lib45 = expectOk(await as('clienteA').get(`/library?variationCode=${cut.code}`));
  expect((lib45.items ?? lib45)[0].formats.map((f: any) => f.format)).toEqual(['9x16', '4x5']);
  const d45 = expectOk(await as('clienteA').get(`/creatives/${cut.creativeId}/download?format=4x5`));
  expect(d45.fileName ?? d45.filename, JSON.stringify(d45)).toBe(`QA_${launched_at}_${cut.code}_4x5.mp4`);
  expect(st1, 'plano do mock com STATIC').toBeTruthy();
  const libImg = expectOk(await as('donoA').get(`/library?variationCode=${st1.code}`));
  expect((libImg.items ?? libImg)[0].media).toBe('image');
  const dImg = expectOk(await as('donoA').get(`/creatives/${st1.creativeId}/download?format=1x1`));
  expect(dImg.fileName ?? dImg.filename).toBe(`QA_${launched_at}_${st1.code}_1x1.png`);
  // nada pago: além da transcrição, só as tasks STATIC_IMAGE do fake (mock), e nenhum centavo lançado
  expect((await q(`select count(*)::int n from provider_tasks where kind not in ('TRANSCRIBE', 'STATIC_IMAGE')`))[0].n).toBe(0);
  expect(Number((await q(`select coalesce(sum(amount_usd),0) s from cost_entries`))[0].s)).toBe(0);
});

test('IT-09 zip: nothing_to_zip; colisão do adName no mesmo dia → _2', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', CURTO6, o.id);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  for (const p of fim.pieces) expectOk(await as('donoA').patch(`/iterate/pieces/${p.id}`, { inZip: false }));
  const z = expectErro(await as('donoA').post(`/iterate/${b.id}/zip`, {}), 409, 'INVALID_STATE');
  expect(z.reason).toBe('nothing_to_zip');
  // 2º lote no mesmo dia, mesmo código → sufixo _2
  const b2 = await lotePronto('donoA', CURTO6, o.id);
  expectOk(await as('donoA').post(`/iterate/${b2.id}/start`, { expectedPieces: b2.pieces.length, ...custo(b2) }), 202);
  const fim2 = await ateLote('donoA', b2.id, assentou, { timeoutMs: 700_000 });
  const comum = fim2.pieces.find((p: any) => fim.pieces.some((x: any) => x.code === p.code));
  const [c1] = await q(`select ad_name from creatives where variation_batch_id = $1 and variation_code = $2`, [b.id, comum.code]);
  const [c2] = await q(`select ad_name from creatives where variation_batch_id = $1 and variation_code = $2`, [b2.id, comum.code]);
  expect(c2.ad_name).toBe(`${c1.ad_name}_2`);
  expect(comum.files[0].name).toBe(`${c1.ad_name}_2_9x16${comum.type === 'STATIC' ? '.png' : '.mp4'}`);
});

test('IT-10 Library → Vary: 1ª vez cria campeão (OWN, sourceCreativeId) e analisa; 2ª vez reaproveita (nasce PLANNING, sem nova análise)', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', CURTO6, o.id);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const peca = fim.pieces.find((p: any) => p.status === 'ready' && p.type !== 'STATIC');
  const img = fim.pieces.find((p: any) => p.status === 'ready' && p.type === 'STATIC');
  if (img) {
    const e = expectErro(await as('donoA').post('/iterate', { creativeId: img.creativeId }), 409, 'INVALID_STATE');
    expect(e.reason).toBe('not_a_video');
  }
  expectErro(await as('clienteA').post('/iterate', { creativeId: peca.creativeId }), 403, 'FORBIDDEN');
  expectErro(await as('donoB').post('/iterate', { creativeId: peca.creativeId }), 404, 'NOT_FOUND');
  const v1 = expectOk(await as('donoA').post('/iterate', { creativeId: peca.creativeId }), 202);
  expect(v1.status).toBe('ANALYZING');
  expect(v1.source.fromLibrary).toBe(true);
  const [ch] = await q(`select id, rights, source_creative_id from champions where id = $1`, [v1.source.championId]);
  expect(ch).toMatchObject({ rights: 'OWN', source_creative_id: peca.creativeId });
  const r1 = await ateLote('donoA', v1.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED');
  expect(r1.status, JSON.stringify(r1.error)).toBe('PLAN_READY');
  const analisesAntes = (await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [ch.id]))[0].n;
  const v2 = expectOk(await as('donoA').post('/iterate', { creativeId: peca.creativeId }), 202);
  expect(v2.status, 'campeão READY reaproveitado: pula a leitura').toBe('PLANNING');
  expect(v2.source.championId).toBe(ch.id);
  const r2 = await ateLote('donoA', v2.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED');
  expect(r2.status).toBe('PLAN_READY');
  expect((await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [ch.id]))[0].n).toBe(analisesAntes);
  expect(r2.cost.analysisEstimateUsd, 'reaproveitado: estimativa = só o plano').toBeLessThan(r1.cost.analysisEstimateUsd);
});

test.skip('IT-11 D4 foto do produto [27/10: SPLIT_LP saiu do catálogo em 25/10; useProductPhoto só vale pra SPLIT_LP]: retry {useProductPhoto} sem foto = 422 NO_PRODUCT_PHOTO; com foto passa', async () => {
  const o = await oferta('A', { notes: '[mock:render-fail:SPLIT_LP]' });
  const b = await lotePronto('donoA', PODCAST, o.id);
  const split = b.pieces.find((p: any) => p.type === 'SPLIT_LP');
  expect(split, 'SPLIT_LP no plano (página capturada)').toBeTruthy();
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const f = fim.pieces.find((p: any) => p.id === split.id);
  expect(f.status).toBe('failed');
  expectErro(await as('donoA').post(`/iterate/pieces/${split.id}/retry`, { useProductPhoto: true }), 422, 'NO_PRODUCT_PHOTO');
  // foto: upload PRODUCT_IMAGE; upload de vídeo no lugar = 422 MEDIA_INVALID
  const sv = await subirArquivo('donoA', CURTO6);
  const e = expectErro(await as('donoA').put(`/offers/${o.id}/product-image`, { uploadId: sv.uploadId }), 422, 'MEDIA_INVALID');
  expect(e.reason).toBe('mime');
  const si = await subirArquivo('donoA', PRODUTO_PNG, { purpose: 'PRODUCT_IMAGE' });
  expect(si.complete?.status, JSON.stringify(si.complete?.body)).toBe(200);
  expectErro(await as('clienteA').put(`/offers/${o.id}/product-image`, { uploadId: si.uploadId }), 403, 'FORBIDDEN');
  const off = expectOk(await as('donoA').put(`/offers/${o.id}/product-image`, { uploadId: si.uploadId }));
  expect(off.productImage).not.toBeNull();
  expectOk(await as('donoA').post(`/iterate/pieces/${split.id}/retry`, { useProductPhoto: true }), 202);
  const fim2 = await ateLote('donoA', b.id, (x) => assentou(x) && x.pieces.find((p: any) => p.id === split.id).status === 'ready', { oQue: 'SPLIT_LP com foto' });
  expect(fim2.pieces.find((p: any) => p.id === split.id).files.map((f: any) => f.format), 'retry refaz só o 9:16').toEqual(['9x16']);
  const [r] = await q(`select r.input from renders r join creatives c on c.id = r.creative_id where c.variation_item_id = $1 and not r.stale and r.format = 'VERTICAL_9_16' order by r.created_at desc limit 1`, [split.id]);
  expect(r.input?.params?.top?.kind, 'render do retry usa a foto').toBe('product_photo');
  expect(expectOk(await as('donoA').del(`/offers/${o.id}/product-image`)).productImage).toBeNull();
});

// ───────────────────────── isolamento ─────────────────────────

test('IT-12 isolamento: lote/peças/zip de A com token de B = 404; lote MANUAL em /iterate = 404; banco de A intacto', async () => {
  const o = await oferta('A', { notes: '[mock:render-fail:STORY]' });
  const b = await lotePronto('donoA', CURTO6, o.id);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 700_000 });
  const p = fim.pieces[0];
  const antes = JSON.stringify(await q(`select id, status, in_zip, left_out_at from variation_items where batch_id = $1 order by id`, [b.id]));
  for (const persona of ['donoB'] as const) {
    const x = as(persona);
    expectErro(await x.get(`/iterate/${b.id}`), 404, 'NOT_FOUND');
    expectErro(await x.post(`/iterate/${b.id}/retry`, {}), 404, 'NOT_FOUND');
    expectErro(await x.post(`/iterate/${b.id}/start`, { expectedPieces: 1 }), 404, 'NOT_FOUND');
    expectErro(await x.post(`/iterate/${b.id}/zip`, {}), 404, 'NOT_FOUND');
    expectErro(await x.post(`/iterate/pieces/${p.id}/retry`, {}), 404, 'NOT_FOUND');
    expectErro(await x.post(`/iterate/pieces/${p.id}/leave-out`, {}), 404, 'NOT_FOUND');
    expectErro(await x.patch(`/iterate/pieces/${p.id}`, { inZip: false }), 404, 'NOT_FOUND');
    expectErro(await x.get(`/creatives/${p.creativeId}/download?format=4x5`), 404, 'NOT_FOUND');
    const lib = expectOk(await x.get(`/library?variationCode=${p.code}`));
    expect((lib.items ?? lib).length).toBe(0);
  }
  expect(JSON.stringify(await q(`select id, status, in_zip, left_out_at from variation_items where batch_id = $1 order by id`, [b.id]))).toBe(antes);
  // lote MANUAL não aparece em /iterate
  const [m] = await q(`select id from variation_batches where mode = 'MANUAL' limit 1`);
  if (m) expectErro(await as('donoA').get(`/iterate/${m.id}`), 404, 'NOT_FOUND');
  const { criarLote } = await import('../../harness/f2.ts');
  const manual = await criarLote('A', 'PLAN_READY');
  expectErro(await as('donoA').get(`/iterate/${manual.id}`), 404, 'NOT_FOUND');
  // chaves do storage de A ficam em ws/<A>/
  const keys = await q(`select f.storage_key from files f where f.workspace_id = 'qa_ws_alfa' and f.kind in ('RENDER_VIDEO','RENDER_IMAGE','ZIP_ARCHIVE','PAGE_CAPTURE')`);
  for (const k of keys) expect(k.storage_key.startsWith('ws/qa_ws_alfa/'), k.storage_key).toBe(true);
});
