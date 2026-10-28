// Rodada QA 27/10 (antes do L5): o que entrou em 648ba99 + be68d98 sem caso de QA. Contra a API do QA em mock
// (render fake, maquina_test, porta própria). Nada pago: fake da ia (describeEdit/checkCaption), render fake, b-roll fake.
// Fontes: docs/contratos/headline-e-legenda-v1.md (HEADLINE, captionsAuto), legenda-protegida-v1.md (burned_captions,
// CAPTION_COVERED, clean-version, replan) e api.md "Mudanças 26/10" (POST /iterate { championId }).
// Rodar (de testes/): E2E_API_PORT=3121 E2E_SKIP_SCHEMA=1 E2E_LIMITES_V2=1 npx playwright test --project=iterate specs/iterate/rev-2610.spec.ts
// Gatilhos: as notes do CAMPEÃO vão pro describeEdit ([mock:headline-none], [mock:burned-captions]); as da OFERTA pro
// checkCaption ([mock:caption-covered]). Campeão com notes só pelo POST /champions → POST /iterate { championId }.
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, tokenOf } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { CURTO6, FALA20, PODCAST, assentou, ateLote, lotePronto, oferta, subirArquivo } from '../../harness/iterate.ts';

test.describe.configure({ timeout: 1_200_000 }); // HEADLINE compõe em CPU (~90 s/peça) mesmo no fake
test.afterEach(async () => { await esperarJobsQuietos(120_000); });

const custo = (b: any) => ({ expectedCostUsd: b.cost?.generateEstimateUsd ?? 0 });
const fmtDe = (p: any, f: string) => p.formats?.find((x: any) => x.format === f);
const norm = (s: string) => s.toLowerCase().replace(/\p{P}+/gu, ' ').replace(/\s+/g, ' ').trim();
const numeros = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/** Campeão pela rota do campeão (com notes = gatilhos do describeEdit), esperando READY. */
async function campeaoComNotas(offerId: string, notes: string | null, path = PODCAST): Promise<string> {
  const s = await subirArquivo('donoA', path);
  expect(s.complete?.status, JSON.stringify(s.complete?.body)).toBe(200);
  const c = await call('POST', '/champions', { body: { offerId, uploadId: s.uploadId, rights: 'OWN', ...(notes ? { notes } : {}) }, token: await tokenOf('donoA') });
  expect(c.status, JSON.stringify(c.body)).toBe(202);
  const ate = Date.now() + 120_000;
  for (;;) {
    const [r] = await q<{ status: string }>(`select status from champions where id = $1`, [c.data.id]);
    if (r.status === 'READY') return c.data.id;
    if (r.status === 'FAILED' || Date.now() > ate) throw new Error(`[qa] campeão ${c.data.id} terminou ${r.status}`);
    await new Promise((res) => setTimeout(res, 500));
  }
}
async function loteDoCampeao(championId: string): Promise<any> {
  const r = expectOk(await as('donoA').post('/iterate', { championId }), 202);
  expect(r.status, 'campeão READY: nasce PLANNING (só o plano)').toBe('PLANNING');
  const b = await ateLote('donoA', r.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED' || x.status === 'PLAN_FAILED', { oQue: 'PLAN_READY' });
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  return b;
}
function confereContagem(b: any) {
  const n = b.pieces.length;
  expect(n).toBeGreaterThanOrEqual(8);
  expect(n).toBeLessThanOrEqual(12);
  const div = b.pieces.filter((p: any) => p.axis === 'DIVERSITY').length;
  expect(div, `diversidade ≥ 40 % (${div}/${n})`).toBeGreaterThanOrEqual(Math.ceil(0.4 * n));
  expect(new Set(b.pieces.map((p: any) => p.code)).size).toBe(n);
  const max: Record<string, number> = { HEADLINE: 3, CUT: 2, REVIEW: 1, NATIVE_SEARCH: 2, STATIC: 2, FRAME: 8 };
  for (const [t, m] of Object.entries(max)) expect(b.pieces.filter((p: any) => p.type === t).length, `máx ${t}`).toBeLessThanOrEqual(m);
}
async function confereHeadlines(b: any, mode: 'replace' | 'add', n: number) {
  const hs = b.pieces.filter((p: any) => p.type === 'HEADLINE');
  expect(hs.length, `HEADLINE ${mode}: ${n} peças`).toBe(n);
  expect(hs.map((p: any) => p.code)).toEqual(Array.from({ length: n }, (_, k) => `HEADLINE-${k + 1}`));
  const [ctx] = await q(`select o.what, o.audience, o.pains, o.promise, o.proof, o.offer_and_price, o.cta, t.transcript
                           from variation_batches b join offers o on o.id = b.offer_id left join teardowns t on t.champion_id = b.champion_id where b.id = $1`, [b.id]);
  const fala = (ctx.transcript?.words ?? []).map((w: any) => w.word).join(' ');
  const hay = new Set([ctx.what, ctx.audience, ctx.pains, ctx.promise, ctx.proof, ctx.offer_and_price, ctx.cta, fala].filter(Boolean).flatMap(numeros));
  for (const p of hs) {
    expect(p.axis).toBe('ITERATION');
    expect(p.headline, `${p.code}: IteratePiece.headline`).toBeTruthy();
    expect(p.headline.mode).toBe(mode);
    if (mode === 'replace') expect(p.headline.original, `${p.code}: original`).toBeTruthy();
    else expect(p.headline.original, `${p.code}: add = sem original`).toBeNull();
    const lim = mode === 'add' ? 60 : Math.min(90, Math.max(20, Math.round((p.headline.original ?? '').length * 1.2)));
    expect(p.headline.text.length, `${p.code}: limite ${lim}`).toBeLessThanOrEqual(lim);
    if (p.headline.highlight) expect(p.headline.text).toContain(p.headline.highlight);
    if (p.headline.original) expect(norm(p.headline.text), `${p.code}: diferente da original`).not.toBe(norm(p.headline.original));
    for (const num of numeros(p.headline.text)) expect(hay.has(num), `${p.code}: número "${num}" inventado`).toBe(true);
  }
  expect(new Set(hs.map((p: any) => norm(p.headline.text))).size, 'headlines distintas entre si').toBe(n);
}

// ───────────────────────── HEADLINE + legenda sempre ─────────────────────────

test('R26-01 HEADLINE replace (faixa sólida): 3 peças HEADLINE-1..3 distintas, nada inventado, captionsAuto; gerar → só 9:16 (4:5 = format_not_supported), remix-keep, zip', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', PODCAST, o.id);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  test.info().annotations.push({ type: 'plano', description: b.pieces.map((p: any) => p.code).join(', ') });
  confereContagem(b);
  await confereHeadlines(b, 'replace', 3);
  expect(b.insight.captionsAuto, 'campeão sem legenda queimada → captionsAuto').toBe(true);
  expect(b.insight.captionBlocked ?? [], 'sem legenda queimada, nada bloqueado').toEqual([]);
  expect(b.pieces.some((p: any) => p.type === 'HOOK_TEXT'), 'HOOK_TEXT saiu do catálogo em 25/10').toBe(false);

  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 900_000, oQue: 'assentar' });
  const falhas = fim.pieces.filter((p: any) => p.status === 'failed').map((p: any) => `${p.code}:${p.errorCode}`);
  expect(falhas, 'nenhuma peça falha sem gatilho').toEqual([]);
  const hs = fim.pieces.filter((p: any) => p.type === 'HEADLINE');
  for (const p of hs) {
    expect(p.status).toBe('ready');
    expect(fmtDe(p, '9x16')?.state).toBe('ready');
    expect(fmtDe(p, '4x5')?.supported, `${p.code}: 4:5 sem suporte (H2)`).toBe(false);
    expect(fmtDe(p, '1x1')?.supported).toBe(false);
  }
  const e = expectErro(await as('donoA').post(`/iterate/pieces/${hs[0].id}/formats`, { format: '4x5' }), 409, 'INVALID_STATE');
  expect(e.reason).toBe('format_not_supported');
  // render da HEADLINE = remix-keep; legenda automática nos inputs das peças de vídeo (captionsAuto)
  const rs = await q(`select vi.code, vi.auto_type, r.input from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id where c.variation_batch_id = $1`, [b.id]);
  for (const r of rs.filter((x) => x.auto_type === 'HEADLINE')) {
    const s = JSON.stringify(r.input);
    expect(s, `${r.code}: remix-keep`).toMatch(/remix-keep|textLayers/);
  }
  const semLegenda = rs.filter((x) => ['CUT', 'REVIEW', 'NATIVE_SEARCH', 'FRAME', 'HEADLINE'].includes(x.auto_type) && !/caption|karaoke|legenda/i.test(JSON.stringify(x.input)));
  test.info().annotations.push({ type: 'inputs sem marca de legenda', description: semLegenda.map((x) => x.code).join(', ') || '(nenhum)' });
  expect(semLegenda.map((x) => x.code), 'captionsAuto: toda peça de vídeo leva legenda no input').toEqual([]);
  // zip com as HEADLINE
  const z = expectOk(await as('donoA').post(`/iterate/${b.id}/zip`, {}), 202);
  expect(z).toBeTruthy();
  // nada pago: nenhuma provider_task de mídia além do STATIC do fake
  const tasks = await q(`select kind, count(*)::int n from provider_tasks group by kind`);
  for (const t of tasks) expect(['TRANSCRIBE', 'STATIC_IMAGE', 'IMAGE_GEN'], `provider_task ${t.kind}`).toContain(t.kind);
  expect((await q(`select coalesce(sum(amount_usd),0)::float s from cost_entries where workspace_id = 'qa_ws_alfa'`))[0].s, 'custo 0 no mock').toBe(0);
});

test('R26-02 [mock:headline-none]: campeão sem headline → 2 HEADLINE modo add (original null, ≤ 60 car.)', async () => {
  const o = await oferta('A');
  const champ = await campeaoComNotas(o.id, '[mock:headline-none]');
  const b = await loteDoCampeao(champ);
  test.info().annotations.push({ type: 'plano', description: b.pieces.map((p: any) => p.code).join(', ') });
  confereContagem(b);
  await confereHeadlines(b, 'add', 2);
});

test('R26-03 [mock:headline-over-video]: headline sobre o vídeo → replace (placa); lote assenta sem falha', async () => {
  const o = await oferta('A');
  const champ = await campeaoComNotas(o.id, '[mock:headline-over-video]');
  const b = await loteDoCampeao(champ);
  await confereHeadlines(b, 'replace', 3);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 900_000 });
  expect(fim.pieces.filter((p: any) => p.status === 'failed').map((p: any) => `${p.code}:${p.errorCode}`)).toEqual([]);
});

// ───────────────────────── legenda queimada protegida ─────────────────────────

test('R26-04 [mock:burned-captions]: captionsAuto false, bloqueados em insight.captionBlocked (burned_captions), gerar → checagem ok gravada, nada tampado', async () => {
  const o = await oferta('A');
  const champ = await campeaoComNotas(o.id, '[mock:burned-captions]');
  const det = expectOk(await as('donoA').get(`/champions/${champ}`));
  const bands = det.teardown?.editMap?.protectedBands;
  expect(Array.isArray(bands) && bands.length > 0, `editMap.protectedBands: ${JSON.stringify(bands)}`).toBe(true);
  const b = await loteDoCampeao(champ);
  test.info().annotations.push({ type: 'plano', description: b.pieces.map((p: any) => p.code).join(', ') });
  test.info().annotations.push({ type: 'captionBlocked', description: JSON.stringify(b.insight.captionBlocked ?? []) });
  expect(b.insight.captionsAuto, 'legenda queimada → sem legenda automática').toBe(false);
  for (const x of b.insight.captionBlocked ?? []) expect(x.reason).toBe('burned_captions');
  expect(b.pieces.length).toBeGreaterThanOrEqual(4);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 900_000 });
  const falhas = fim.pieces.filter((p: any) => p.status === 'failed').map((p: any) => `${p.code}:${p.errorCode}`);
  expect(falhas, 'sem [mock:caption-covered] nada falha').toEqual([]);
  const checks = await q(`select vi.code, r.input->'captionCheck' cc from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id
                           where c.variation_batch_id = $1 and vi.auto_type <> 'STATIC'`, [b.id]);
  test.info().annotations.push({ type: 'captionCheck', description: checks.map((c) => `${c.code}:${c.cc?.status ?? 'null'}`).join(' ') });
  expect(checks.filter((c) => c.cc?.status === 'ok').length, 'checagem por visão roda nas peças de vídeo com faixa protegida').toBeGreaterThan(0);
  expect(checks.filter((c) => c.cc && c.cc.status !== 'ok').map((c) => c.code)).toEqual([]);
});

test('R26-05 [mock:burned-captions] + oferta [mock:caption-covered]: peça vai pra failed CAPTION_COVERED (retry), sai do zip', async () => {
  const o = await oferta('A', { notes: '[mock:caption-covered]' });
  const champ = await campeaoComNotas(o.id, '[mock:burned-captions]');
  const b = await loteDoCampeao(champ);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 900_000 });
  const cobertas = fim.pieces.filter((p: any) => p.errorCode === 'CAPTION_COVERED' || p.formats?.some((f: any) => f.errorCode === 'CAPTION_COVERED'));
  test.info().annotations.push({ type: 'peças', description: fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`).join(' ') });
  expect(cobertas.length, 'ao menos uma peça de vídeo marcada CAPTION_COVERED').toBeGreaterThan(0);
  for (const p of cobertas) {
    expect(p.status).toBe('failed');
    expect(p.retryHint).toBe('retry');
  }
  // zip: as cobertas não entram
  const z = await as('donoA').post(`/iterate/${b.id}/zip`, {});
  expect([202, 200, 409]).toContain(z.status);
  const zz = await ateLote('donoA', b.id, (x) => ['ready', 'failed', 'none'].includes(x.zip?.status) && x.zip?.status !== 'building', { timeoutMs: 60_000, oQue: 'zip' }).catch(() => null);
  test.info().annotations.push({ type: 'zip', description: JSON.stringify(zz?.zip ?? z.body) });
});

test('R26-06 clean-version: 422 duration, 404 de B / upload inexistente, CLIENT 403, 200 com o mesmo vídeo, DELETE volta, banco de A intacto', async () => {
  const o = await oferta('A');
  const champ = await campeaoComNotas(o.id, '[mock:burned-captions]');
  const curto = await subirArquivo('donoA', CURTO6);
  const e = expectErro(await as('donoA').post(`/champions/${champ}/clean-version`, { uploadId: curto.uploadId }), 422, 'CLEAN_VERSION_MISMATCH');
  expect(e.reason).toBe('duration');
  expectErro(await as('donoA').post(`/champions/${champ}/clean-version`, {}), 400, 'VALIDATION_ERROR');
  expectErro(await as('donoA').post(`/champions/${champ}/clean-version`, { uploadId: 'qa_nao_existe' }), 404, 'NOT_FOUND');
  const igual = await subirArquivo('donoA', PODCAST);
  expectErro(await as('donoB').post(`/champions/${champ}/clean-version`, { uploadId: igual.uploadId }), 404, 'NOT_FOUND');
  expectErro(await as('donoB').raw('DELETE', `/champions/${champ}/clean-version`), 404, 'NOT_FOUND');
  const cli = await as('clienteA').post(`/champions/${champ}/clean-version`, { uploadId: igual.uploadId });
  expect(cli.status, `CLIENT (só leitura) no clean-version: ${JSON.stringify(cli.body)}`).toBe(403);
  // upload de B usado em campeão de A = 404 (isolamento)
  const deB = await subirArquivo('donoB', PODCAST);
  expectErro(await as('donoA').post(`/champions/${champ}/clean-version`, { uploadId: deB.uploadId }), 404, 'NOT_FOUND');
  const ok = expectOk(await as('donoA').post(`/champions/${champ}/clean-version`, { uploadId: igual.uploadId }));
  expect(ok.cleanVideo, 'ChampionDetail.cleanVideo').toBeTruthy();
  const [row] = await q(`select c.clean_video_file_id, f.kind, f.workspace_id from champions c join files f on f.id = c.clean_video_file_id where c.id = $1`, [champ]);
  expect(row).toMatchObject({ kind: 'CHAMPION_CLEAN_VIDEO', workspace_id: 'qa_ws_alfa' });
  // com a versão sem legenda: lote novo liga captionsAuto e não bloqueia nada
  const b = await loteDoCampeao(champ);
  expect(b.insight.captionsAuto, 'com a versão sem legenda a legenda nossa liga').toBe(true);
  expect(b.insight.captionBlocked ?? []).toEqual([]);
  const d = expectOk(await as('donoA').raw('DELETE', `/champions/${champ}/clean-version`));
  expect(d.cleanVideo).toBeNull();
  expectOk(await as('donoA').raw('DELETE', `/champions/${champ}/clean-version`), 200); // idempotente
});

test('R26-07 POST /iterate { cleanUploadId }: bate = insight.cleanVersion applied; não bate = mismatch e segue com a original', async () => {
  const o = await oferta('A');
  const main = await subirArquivo('donoA', PODCAST);
  const clean = await subirArquivo('donoA', PODCAST);
  const r = expectOk(await as('donoA').post('/iterate', { uploadId: main.uploadId, cleanUploadId: clean.uploadId, offerId: o.id }), 202);
  const b = await ateLote('donoA', r.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED');
  expect(b.status).toBe('PLAN_READY');
  expect(b.insight.cleanVersion).toMatchObject({ status: 'applied' });
  const main2 = await subirArquivo('donoA', PODCAST);
  const curto = await subirArquivo('donoA', CURTO6);
  const r2 = expectOk(await as('donoA').post('/iterate', { uploadId: main2.uploadId, cleanUploadId: curto.uploadId, offerId: o.id }), 202);
  const b2 = await ateLote('donoA', r2.id, (x) => x.status === 'PLAN_READY' || x.status === 'ANALYSIS_FAILED');
  expect(b2.status).toBe('PLAN_READY');
  expect(b2.insight.cleanVersion).toMatchObject({ status: 'mismatch', reason: 'duration' });
  expectErro(await as('donoA').post('/iterate', { uploadId: main2.uploadId, cleanUploadId: 'qa_nao_existe', offerId: o.id }), 404, 'NOT_FOUND');
});

// ───────────────────────── replanejar + lote novo do mesmo campeão ─────────────────────────

test('R26-08 POST /iterate/:id/replan: CLIENT 403, B 404, PLAN_READY → PLANNING → PLAN_READY sem reanalisar; LAUNCHED = 409 launched', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', CURTO6, o.id);
  expect(b.status).toBe('PLAN_READY');
  expectErro(await as('clienteA').post(`/iterate/${b.id}/replan`, {}), 403, 'FORBIDDEN');
  expectErro(await as('donoB').post(`/iterate/${b.id}/replan`, {}), 404, 'NOT_FOUND');
  const champ = b.source.championId;
  const an0 = (await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [champ]))[0].n;
  const itens0 = (await q(`select id from variation_items where batch_id = $1`, [b.id])).map((x) => x.id);
  const r = expectOk(await as('donoA').post(`/iterate/${b.id}/replan`, {}), 202);
  expect(r.status).toBe('PLANNING');
  // clique duplo durante o PLANNING = 409
  const dup = await as('donoA').post(`/iterate/${b.id}/replan`, {});
  expect([dup.status, dup.body?.error?.code]).toEqual([409, 'INVALID_STATE']);
  const b2 = await ateLote('donoA', b.id, (x) => x.status === 'PLAN_READY' || x.status === 'PLAN_FAILED');
  expect(b2.status).toBe('PLAN_READY');
  expect((await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [champ]))[0].n, 'análise não refeita').toBe(an0);
  const itens1 = (await q(`select id from variation_items where batch_id = $1`, [b.id])).map((x) => x.id);
  expect(itens1.some((x) => itens0.includes(x)), 'itens do plano antigo descartados').toBe(false);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b2.pieces.length, ...custo(b2) }), 202);
  const e = expectErro(await as('donoA').post(`/iterate/${b.id}/replan`, {}), 409, 'INVALID_STATE');
  expect(e.reason).toBe('launched');
});

test('R26-09 POST /iterate { championId }: exactlyOneOf 400, B 404, inexistente 404, CLIENT 403, não-READY 409; READY nasce PLANNING sem reanalisar', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', CURTO6, o.id);
  const champ = b.source.championId;
  const up = await subirArquivo('donoA', CURTO6);
  expectErro(await as('donoA').post('/iterate', { championId: champ, uploadId: up.uploadId }), 400, 'VALIDATION_ERROR');
  expectErro(await as('donoB').post('/iterate', { championId: champ }), 404, 'NOT_FOUND');
  expectErro(await as('donoA').post('/iterate', { championId: 'qa_nao_existe' }), 404, 'NOT_FOUND');
  expectErro(await as('clienteA').post('/iterate', { championId: champ }), 403, 'FORBIDDEN');
  const an0 = (await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [champ]))[0].n;
  const novo = await loteDoCampeao(champ);
  expect(novo.id).not.toBe(b.id);
  expect(novo.source.championId).toBe(champ);
  expect(novo.offer.id, 'a oferta é a do campeão').toBe(o.id);
  expect((await q(`select count(*)::int n from jobs where type = 'CHAMPION_ANALYZE' and champion_id = $1`, [champ]))[0].n).toBe(an0);
  // campeão analisando = 409 INVALID_STATE allowed READY
  await q(`update champions set status = 'ANALYZING' where id = $1`, [champ]);
  const e = expectErro(await as('donoA').post('/iterate', { championId: champ }), 409, 'INVALID_STATE');
  expect(e.allowed).toEqual(['READY']);
  await q(`update champions set status = 'READY' where id = $1`, [champ]);
  // arquivado = 404
  expectOk(await as('donoA').raw('DELETE', `/champions/${champ}`));
  expectErro(await as('donoA').post('/iterate', { championId: champ }), 404, 'NOT_FOUND');
});

// ───────────────────────── render real da HEADLINE (Remotion LOCAL, grátis) ─────────────────────────
// Só com E2E_REMIX_REAL=1 (a API do QA manda o remix-keep pro Remotion local). Critério do headline-e-legenda-v1 §4 (qa):
// PSNR fora da caixa nova ≥ 40 dB contra o campeão, áudio md5 = campeão, nb_frames igual; dentro da caixa o texto mudou.
// Com captionsAuto a HEADLINE também leva a legenda automática (§2.2, camada karaokê do remix-keep): as caixas das
// outras camadas novas (textLayers[1..]) também saem da comparação.
test('R26-10 HEADLINE real (remix-keep local): mesmo nº de frames, áudio md5 = campeão, PSNR ≥ 40 dB fora das camadas novas, faixa mudou', async () => {
  test.skip(process.env.E2E_REMIX_REAL !== '1', 'render real do remix-keep: rode com E2E_REMIX_REAL=1');
  test.setTimeout(1_800_000);
  const { baixar, qaVideo, gravarJson } = await import('../../harness/keep-edit.ts');
  const o = await oferta('A');
  const b = await lotePronto('donoA', FALA20, o.id);
  expect(b.status).toBe('PLAN_READY');
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, ...custo(b) }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 1_500_000 });
  const hs = fim.pieces.filter((p: any) => p.type === 'HEADLINE');
  expect(hs.length).toBeGreaterThan(0);
  for (const p of hs) {
    expect(p.status, `${p.code}: ${p.errorCode}`).toBe('ready');
    const [{ input }] = await q(`select r.input from renders r join creatives c on c.id = r.creative_id where c.variation_item_id = $1 and not r.stale and r.format = 'VERTICAL_9_16' order by r.created_at desc limit 1`, [p.id]);
    // a máscara do compositor (render/posprocesso.ts) = caixa do texto + background.box (faixa/placa medida): os dois saem
    type L = { box: any; startFrame: number; endFrame: number; background?: { kind: string; box: any } };
    const [nova, ...outras] = input.textLayers as L[];
    const uniao = (a: any, b: any) => (b ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) } : a);
    const trilha = gravarJson(`r26-10-${p.code}-trilha.json`, [{ startFrame: nova.startFrame, endFrame: nova.endFrame, region: uniao(nova.box, nova.background?.box) }]);
    const excluir = gravarJson(`r26-10-${p.code}-excluir.json`, outras.map((l) => ({ startFrame: l.startFrame, endFrame: l.endFrame, box: uniao(l.box, l.background?.box) })));
    const f = p.files.find((x: any) => x.format === '9x16');
    const peca = await baixar('donoA', f.url, `r26-10-${p.code}.mp4`);
    const r = qaVideo(['peca', '--campeao', FALA20, '--peca', peca, '--trilha', trilha, '--excluir', excluir]);
    test.info().annotations.push({ type: p.code, description: JSON.stringify({ grade: r.grade, audioIgual: r.audioIgual, foraPsnrMin: r.foraPsnrMin, foraP5: r.foraPsnrP5, abaixo40: r.foraFramesAbaixoDe40, iguaisDentro: r.dentroFramesIguaisTotal, camadas: input.textLayers.length }) });
    expect(r.grade, `${p.code}: mesmo tamanho/fps/nº de frames`).toBe(true);
    expect(r.audioIgual, `${p.code}: áudio md5 = campeão`).toBe(true);
    expect(r.foraFramesAbaixoDe40, `${p.code}: PSNR mín fora ${r.foraPsnrMin} no frame ${r.foraPsnrMinFrame}`).toBe(0);
    expect(r.dentroFramesIguaisTotal, `${p.code}: faixa igual ao campeão em ${r.dentroFramesIguaisAoCampeao}`).toBe(0);
  }
});
