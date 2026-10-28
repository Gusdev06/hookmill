// Molduras de vídeo (Parte B) — docs/contratos/estatico-montado-e-molduras-v1.md §B1-§B6 (APROVADO 25/10).
// Tipo FRAME na variação AUTO: plano (templates permitidos, textos com fonte, nada inventado, preço literal), render
// `kind 'frame'` (fake), formatos sob demanda, falha + retry, zip, isolamento. API do QA em mock, banco *_test. NADA PAGO.
// PENDENTE até a fusão do B1 (§C.0: 'FRAME' no AutoVariationType/config.types) + B1-I/B1-B/B1-V. Cada teste pula sozinho.
// B2 (6 templates de 2 fontes + b-roll §B3.1): só casos fixme no fim, escritos quando o B2 tiver data.
// Rodar (de testes/): npm run em
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { WS, q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { BRAIN_VAZIO, CURTO6, PODCAST, assentou, ateLote, lotePronto, oferta } from '../../harness/iterate.ts';
import {
  BRAIN_PRECO_DUPLO, BRAIN_PRECO_UNICO, BRAIN_SEM_OFERTA, BRAIN_SEM_PRECO, FRAME_B1, confereFrame, ctxDoLote, entrega, itensDoLote,
  nadaPago, renderVigente,
} from '../../harness/estatico-molduras.ts';

test.describe.configure({ timeout: 300_000 });
let E: Awaited<ReturnType<typeof entrega>>;
test.beforeAll(async () => { E = await entrega(); });
test.beforeEach(() => { test.skip(!E.molduras, "pendente: fusão do B1 (§C.0: 'FRAME' no config.types) + B1-I (plano/fake) + B1-B (allowedFrames, fila, códigos) + B1-V (buildFrameInput)"); });
test.afterEach(async () => {
  await q(`update workspaces set monthly_spend_cap_usd = 200 where id in ($1, $2)`, [WS.A, WS.B]);
  await esperarJobsQuietos(120_000);
});

const frames = (b: any) => b.pieces.filter((p: any) => p.type === 'FRAME');
const start = (b: any, persona: 'donoA' | 'donoB' = 'donoA') =>
  as(persona).post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd ?? 0 });
const fmtDe = (p: any, f: string) => p.formats?.find((x: any) => x.format === f);
async function paramsFrame(batchId: string) {
  return (await itensDoLote(batchId)).filter((i) => i.auto_type === 'FRAME').map((i) => ({ ...i, params: i.payload?.params ?? {} }));
}
/** Templates FRAME planejados para um Brain (o fake é determinístico pelo fixture). */
async function planoCom(brain: Record<string, unknown>, ws: 'A' | 'B' = 'A', video = PODCAST) {
  const o = await oferta(ws, brain);
  const b = await lotePronto(ws === 'A' ? 'donoA' : 'donoB', video, o.id);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  return { o, b, fr: await paramsFrame(b.id), ctx: await ctxDoLote(b.id) };
}
async function listaZip(url: string) {
  const dl = await fetch(url);
  expect(dl.status).toBe(200);
  const dir = mkdtempSync(join(tmpdir(), 'qa-zip-em-'));
  const zpath = join(dir, 'z.zip');
  writeFileSync(zpath, Buffer.from(await dl.arrayBuffer()));
  execFileSync('unzip', ['-q', zpath, '-d', dir]);
  return { dir, lista: execFileSync('unzip', ['-Z1', zpath], { encoding: 'utf8' }).trim().split('\n').sort() };
}
async function zipPronto(batchId: string) {
  const z = await as('donoA').post(`/iterate/${batchId}/zip`, {});
  expect([200, 202], JSON.stringify(z.body)).toContain(z.status);
  const b = await ateLote('donoA', batchId, (x) => ['ready', 'failed'].includes(x.zip.status), { oQue: 'zip' });
  expect(b.zip.status).toBe('ready');
  return { b, url: expectOk(await as('donoA').post(`/iterate/${batchId}/zip`, {})).zip.url as string };
}

// ───────────────────────── plano (§B2) ─────────────────────────

test('MO-01 config: FRAME no catálogo (types), eixo DIVERSITY', async () => {
  expect(E.cfg.types).toContain('FRAME');
  test.info().annotations.push({ type: 'types', description: JSON.stringify(E.cfg.types) });
});

test('MO-02 Brain cheio: ≤ 2 FRAME de templates diferentes, só os 12 do B1, DIVERSITY/2-new-audience, código FRAME-<ID>, textos nos limites, com fonte, nada inventado, sem texto fixo de interface', async () => {
  const { b, fr, ctx } = await planoCom({});
  expect(fr.length, 'plano do mock com FRAME').toBeGreaterThan(0);
  expect(fr.length, 'D10: máx. 2').toBeLessThanOrEqual(2);
  expect(new Set(fr.map((f) => f.params.template)).size, 'templates diferentes').toBe(fr.length);
  const n = b.pieces.length;
  expect(b.pieces.filter((p: any) => p.axis === 'DIVERSITY').length, 'diversidade ≥ 40 % com FRAME contando').toBeGreaterThanOrEqual(Math.ceil(n * 0.4));
  for (const it of fr) {
    const p = b.pieces.find((x: any) => x.id === it.id);
    expect(FRAME_B1 as readonly string[], `${it.code}: só B1 antes do B2`).toContain(it.params.template);
    expect(p.axis).toBe('DIVERSITY');
    expect(p.folder).toBe('2-new-audience');
    expect(p.code).toMatch(/^FRAME-[A-Z0-9-]+$/);
    expect(p.change.length).toBeGreaterThan(0);
    expect(p.frame?.template, 'vista: piece.frame.template').toBe(it.params.template);
    expect(p.frame?.second ?? null, 'B1 = 1 fonte').toBeNull();
    expect(confereFrame(it.params, ctx), `${it.code}: ${JSON.stringify(it.params.texts)}`).toEqual([]);
    // fonte de cada texto (sources por caminho)
    const src = it.params.sources ?? {};
    test.info().annotations.push({ type: `${it.code} ${it.params.template}`, description: `${JSON.stringify(it.params.texts)} · sources ${JSON.stringify(src)}` });
    if (it.params.template === 'ranking') for (const [i] of (it.params.texts.items ?? []).entries()) expect(src[`items.${i}`], `ranking items.${i} sem fonte`).toBeTruthy();
    if (it.params.template === 'call') for (const [i] of (it.params.texts.slideSteps ?? []).entries()) expect(src[`slideSteps.${i}`], `call slideSteps.${i} sem fonte`).toBeTruthy();
    if (it.params.template === 'live') expect(it.params.texts).toEqual({});
  }
});

test('MO-03 oferta PT-BR → código MOLDURA-<ID-PT>, nunca FRAME-', async () => {
  const { b, fr } = await planoCom({ language: 'pt-BR' });
  for (const it of fr) {
    const p = b.pieces.find((x: any) => x.id === it.id);
    expect(p.code, it.params.template).toMatch(/^MOLDURA-[A-Z0-9-]+$/);
    if (it.params.template === 'news') expect(p.code).toBe('MOLDURA-NOTICIA');
  }
});

test('MO-04 sem preço com moeda (sem oferta / só "7-day free trial" / Brain vazio): nunca direct_offer; prova nula sem bloco de prova = sem pov_testimonial', async () => {
  for (const [nome, brain] of [['sem oferta', BRAIN_SEM_OFERTA], ['sem moeda', BRAIN_SEM_PRECO], ['vazio', BRAIN_VAZIO]] as const) {
    const { fr, ctx } = await planoCom(brain);
    const ts = fr.map((f) => f.params.template);
    test.info().annotations.push({ type: `templates (${nome})`, description: ts.join(', ') || '(nenhum FRAME)' });
    expect(ts, `${nome}: direct_offer sem preço (§B5 no_price)`).not.toContain('direct_offer');
    for (const it of fr) expect(confereFrame(it.params, ctx), `${nome} ${it.code}`).toEqual([]);
  }
});

test('MO-05 Oferta direta: preço literal do offerAndPrice; from só com 2 valores (§B5)', async () => {
  let exercitou = 0;
  for (const [nome, brain] of [['2 preços', BRAIN_PRECO_DUPLO], ['1 preço', BRAIN_PRECO_UNICO]] as const) {
    const { fr, ctx } = await planoCom(brain);
    const d = fr.find((f) => f.params.template === 'direct_offer');
    if (!d) { test.info().annotations.push({ type: nome, description: 'fake não escolheu direct_offer' }); continue; }
    exercitou++;
    expect(confereFrame(d.params, ctx), nome).toEqual([]);
    if (nome === '1 preço') expect(d.params.texts.price.from).toBeNull();
    else expect(d.params.texts.price.from).toBeTruthy();
  }
  // o fake "escolhe 2 templates pelo fixture" (§B6); se não cair em direct_offer, falta um gatilho pra forçar o template
  test.skip(exercitou === 0, 'não exercitado: pedir à maquina-ia um gatilho de mock pra forçar o template (ex. [mock:frame-pick:direct_offer])');
});

test('MO-06 vários Brains: cada lote ≤ 2 FRAME distintos; templates permitidos pelo contexto (ranking/call com ≥ 3 itens com fonte)', async () => {
  const vistos = new Set<string>();
  for (const brain of [{}, BRAIN_SEM_OFERTA, BRAIN_PRECO_DUPLO, BRAIN_PRECO_UNICO, BRAIN_VAZIO]) {
    const { fr, ctx } = await planoCom(brain);
    expect(fr.length).toBeLessThanOrEqual(2);
    expect(new Set(fr.map((f) => f.params.template)).size).toBe(fr.length);
    for (const it of fr) { vistos.add(it.params.template); expect(confereFrame(it.params, ctx), it.code).toEqual([]); }
  }
  test.info().annotations.push({ type: 'templates exercitados no plano', description: [...vistos].sort().join(', ') });
});

// ───────────────────────── gerar, render, zip (§B2 render, §B6 qa) ─────────────────────────

test('MO-07 gerar: FRAME → 9:16 renderizado (REMOTION, kind frame), textos = os do plano, marca do workspace; arquivo …_FRAME-<ID>_9x16.mp4 no zip; custo 0', async () => {
  const { o, b, fr } = await planoCom({});
  expect(fr.length).toBeGreaterThan(0);
  expect(b.cost.generateEstimateUsd ?? 0, 'FRAME não soma custo de geração').toBeCloseTo((b.pieces.filter((p: any) => p.type === 'STATIC').length) * E.cfg.staticImageUsd, 4);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const [{ launched_at }] = await q(`select to_char(launched_at, 'MMDD') launched_at from variation_batches where id = $1`, [b.id]);
  for (const it of fr) {
    const p = fim.pieces.find((x: any) => x.id === it.id);
    expect(p.status, `${p.code}: ${p.errorCode} ${p.failReason}`).toBe('ready');
    expect(p.media ?? 'video').toBe('video');
    expect(p.files.map((f: any) => f.name)).toEqual([`QA_${launched_at}_${p.code}_9x16.mp4`]);
    const r = await renderVigente(p.creativeId);
    expect(r.engine).toBe('REMOTION');
    const inp = r.input ?? {};
    test.info().annotations.push({ type: `render input ${p.code}`, description: JSON.stringify(inp).slice(0, 700) });
    const fin = inp.kind === 'frame' ? inp : inp.params ?? inp;
    expect(fin.kind ?? inp.templateId, 'RenderInput kind frame').toMatch(/frame/);
    expect(fin.frame?.id).toBe(it.params.template);
    expect(fin.frame?.texts, 'render escreve o texto do plano').toEqual(it.params.texts);
    expect(fin.frame?.brand?.name).toBe(o.name);
    expect(fin.frame?.brand?.handle).toMatch(/^@?[a-z0-9._]+$/); // 27/10: o backend já manda com @ (§B2 live: "o @ é do backend")
    expect(fin.frame?.brand?.color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(JSON.stringify(fin), 'nada do workspace B').not.toMatch(/QA Beta|qa_ws_beta/);
    if (['question_box', 'live'].includes(it.params.template)) expect(typeof fin.face?.atSec, 'rosto do campeão').toBe('number');
    expect(fin.second ?? null, 'B1 sem 2ª fonte').toBeNull();
    expect(fin.video?.joinFadeMs).toBe(40);
    expect(fin.safeArea).toBeTruthy();
    expect((await q(`select count(*)::int n from provider_tasks t join renders r on r.id = t.render_id where r.creative_id = $1`, [p.creativeId]))[0].n, 'moldura = 0 geração').toBe(0);
  }
  const { lista } = await listaZip((await zipPronto(b.id)).url);
  for (const it of fr) {
    const p = fim.pieces.find((x: any) => x.id === it.id);
    expect(lista, `zip com ${p.code}`).toContain(`2-new-audience/QA_${launched_at}_${p.code}_9x16.mp4`);
  }
  await nadaPago(b.id);
});

test('MO-08 4:5 e 1:1 sob demanda da moldura: 202 → ready, grátis (requestUsd 0); supported:false = 409 format_not_supported', async () => {
  const { b, fr } = await planoCom({});
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const p = fim.pieces.find((x: any) => x.id === fr[0].id);
  for (const f of ['4x5', '1x1']) {
    const pf = fmtDe(p, f);
    if (pf?.supported === false) {
      const e = expectErro(await as('donoA').post(`/iterate/pieces/${p.id}/formats`, { format: f }), 409, 'INVALID_STATE');
      expect(e.reason).toBe('format_not_supported');
      continue;
    }
    expect(pf?.requestUsd ?? 0).toBe(0);
    expectOk(await as('membroA').post(`/iterate/pieces/${p.id}/formats`, { format: f }), 202);
  }
  expectErro(await as('clienteA').post(`/iterate/pieces/${p.id}/formats`, { format: '4x5' }), 403, 'FORBIDDEN');
  const f2 = await ateLote('donoA', b.id, (x) => ['4x5', '1x1'].every((f) => { const s = fmtDe(x.pieces.find((y: any) => y.id === p.id), f); return s?.supported === false || ['ready', 'failed'].includes(s?.state); }), { oQue: 'formatos da moldura' });
  const pp = f2.pieces.find((x: any) => x.id === p.id);
  for (const f of ['4x5', '1x1']) if (fmtDe(pp, f).supported !== false) expect(fmtDe(pp, f).state, `${pp.code} ${f}`).toBe('ready');
  for (const fmt of ['PORTRAIT_4_5', 'SQUARE_1_1']) {
    const r = await renderVigente(p.creativeId, fmt);
    if (r) expect(r.input?.format ?? fmt).toBeTruthy();
  }
});

test('MO-09 [mock:frame-fail:<id>]: peça failed (retry), outras seguem; retry grátis passa mesmo com teto 0', async () => {
  // 1º lote descobre o template que o fake escolhe pra este Brain; o 2º (mesmo Brain + gatilho) força a falha dele
  const { fr } = await planoCom({});
  const alvo = fr[0].params.template;
  const { b } = await planoCom({ notes: `[mock:frame-fail:${alvo}]` });
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const p = fim.pieces.find((x: any) => x.type === 'FRAME' && x.frame?.template === alvo);
  expect(p, `FRAME ${alvo} no 2º plano (fake determinístico)`).toBeTruthy();
  expect(p.status).toBe('failed');
  expect(p.retryHint).toBe('retry');
  expect(fim.pieces.filter((x: any) => x.id !== p.id).every((x: any) => x.status === 'ready'), 'só a moldura falha').toBe(true);
  await q(`update workspaces set monthly_spend_cap_usd = 0 where id = $1`, [WS.A]);
  expectOk(await as('donoA').post(`/iterate/pieces/${p.id}/retry`, {}), 202);
  const f2 = await ateLote('donoA', b.id, (x) => x.pieces.find((y: any) => y.id === p.id).status === 'ready', { oQue: 'retry da moldura' });
  expect(f2.summary.failed).toBe(0);
});

test('MO-10 texto que não cabe (36 px): FRAME_TEXT_OVERFLOW → failed com retryHint leave_out; Leave out tira do zip', async () => {
  const { b, fr } = await planoCom({});
  // força um texto acima do que o fitText aguenta (o plano normal respeita os limites; aqui é a exceção do §B2)
  const it = fr[0];
  const chave = Object.keys(it.params.texts).find((k) => typeof it.params.texts[k] === 'string');
  test.skip(!chave, `template ${it.params.template} sem texto simples pra estourar`);
  // 27/10: dentro do limite de caracteres do schema (senão o render recusa antes do fitText = RENDER_ERROR, não overflow):
  // uma palavra só, maior que a linha a 36 px, cortada no limite do slot
  const limite = Number(process.env.E2E_MO10_LIMITE ?? 26);
  const longo = 'Palavrasuperlongaquenaocabeemlugarnenhumjamais'.slice(0, Math.min(limite, String(it.params.texts[chave!]).length + 18));
  await q(`update variation_items set payload = jsonb_set(payload, $2::text[], to_jsonb($3::text)) where id = $1`, [it.id, `{params,texts,${chave}}`, longo]);
  expectOk(await start(expectOk(await as('donoA').get(`/iterate/${b.id}`))), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const p = fim.pieces.find((x: any) => x.id === it.id);
  test.info().annotations.push({ type: 'overflow', description: `${p.status} ${p.errorCode} ${p.retryHint} ${p.failReason}` });
  expect(p.status).toBe('failed');
  expect(p.errorCode).toBe('FRAME_TEXT_OVERFLOW');
  expect(p.retryHint).toBe('leave_out');
  expect(expectOk(await as('donoA').post(`/iterate/pieces/${p.id}/leave-out`, {}))).toMatchObject({ status: 'left_out', inZip: false });
});

test('MO-11 read_caption (D14): suggestedPrimaryText = texts.primaryText; vai no README do zip', async () => {
  let achou = false;
  for (const brain of [{}, BRAIN_PRECO_UNICO, BRAIN_SEM_OFERTA]) {
    const { b, fr } = await planoCom(brain);
    const rc = fr.find((f) => f.params.template === 'read_caption');
    if (!rc) continue;
    achou = true;
    expectOk(await start(b), 202);
    const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
    const p = fim.pieces.find((x: any) => x.id === rc.id);
    expect(p.suggestedPrimaryText).toBe(rc.params.texts.primaryText);
    for (const x of fim.pieces.filter((y: any) => y.id !== rc.id)) expect(x.suggestedPrimaryText ?? null).toBeNull();
    const { dir } = await listaZip((await zipPronto(b.id)).url);
    expect(readFileSync(join(dir, '2-new-audience', 'README.txt'), 'utf8')).toContain(rc.params.texts.primaryText.slice(0, 80));
    break;
  }
  test.skip(!achou, 'não exercitado: fake não escolheu read_caption (pedir gatilho de template à maquina-ia)');
});

// ───────────────────────── isolamento + estados ─────────────────────────

test('MO-12 isolamento: marca da moldura vem do workspace do lote; rotas da peça FRAME de A com token de B = 404; banco de A intacto', async () => {
  const a = await planoCom({});
  const bb = await planoCom({}, 'B');
  expectOk(await start(a.b), 202);
  expectOk(await start(bb.b, 'donoB'), 202);
  const fa = await ateLote('donoA', a.b.id, assentou, { timeoutMs: 240_000 });
  const fb = await ateLote('donoB', bb.b.id, assentou, { timeoutMs: 240_000 });
  const pa = frames(fa)[0], pb = frames(fb)[0];
  const ia = (await renderVigente(pa.creativeId)).input, ib = (await renderVigente(pb.creativeId)).input;
  const marca = (x: any) => (x.kind === 'frame' ? x : x.params ?? x).frame?.brand;
  expect(marca(ia).name).toBe(a.o.name);
  expect(marca(ib).name).toBe(bb.o.name);
  expect(marca(ia).handle).not.toBe(marca(ib).handle);
  const antes = JSON.stringify(await q(`select id, status, in_zip, payload from variation_items where batch_id = $1 order by id`, [a.b.id]));
  const x = as('donoB');
  expectErro(await x.post(`/iterate/pieces/${pa.id}/formats`, { format: '4x5' }), 404, 'NOT_FOUND');
  expectErro(await x.post(`/iterate/pieces/${pa.id}/retry`, {}), 404, 'NOT_FOUND');
  expectErro(await x.post(`/iterate/pieces/${pa.id}/leave-out`, {}), 404, 'NOT_FOUND');
  expectErro(await x.patch(`/iterate/pieces/${pa.id}`, { inZip: false }), 404, 'NOT_FOUND');
  expectErro(await x.get(`/creatives/${pa.creativeId}/download?format=9x16`), 404, 'NOT_FOUND');
  expect(JSON.stringify(await q(`select id, status, in_zip, payload from variation_items where batch_id = $1 order by id`, [a.b.id]))).toBe(antes);
});

test('MO-13 máquina de estados: criativo FRAME travado como toda peça AUTO (variation_locked); vídeo curto (6 s) também gera moldura sem travar o lote', async () => {
  const { b } = await planoCom({}, 'A', CURTO6);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const p = frames(fim)[0];
  test.skip(!p, 'plano do vídeo de 6 s sem FRAME');
  for (const [m, path, body] of [['PATCH', `/creatives/${p.creativeId}/edit`, { headline: 'x' }], ['POST', `/creatives/${p.creativeId}/render`, {}], ['GET', `/creatives/${p.creativeId}/editor`, undefined]] as const) {
    const r = await as('donoA').raw(m, path, body);
    expect([path, r.status], JSON.stringify(r.body)).toEqual([path, 409]);
    test.info().annotations.push({ type: path, description: String(r.body?.error?.details?.reason) });
  }
  expect((await q(`select state from creatives where id = $1`, [p.creativeId]))[0].state).toBe('APPROVED');
});

// ───────────────────────── B2 (fase seguinte, §B3/§B3.1) ─────────────────────────
test.fixme('MO-B2-01 6 templates de 2 fontes: champion_segment ≥ 3 s fora do gancho, rosto pelo faceTrack, call_dialog com 2º quadro mudo; names = papéis, nunca nome de pessoa', async () => {});
test.fixme('MO-B2-02 b-roll: GET /iterate/pieces/:id/broll/candidates; POST …/broll { candidateId | url } → 202 re-render grátis; TikTok por URL; Instagram = 422 BROLL_SOURCE_NOT_SUPPORTED; CLIENT 403; FRAME sem stock_broll = 409', async () => {});
test.fixme('MO-B2-03 [mock:broll-none] → champion_segment; [mock:broll-fail] → failed BROLL_UNAVAILABLE e Retry troca pelo próximo candidato', async () => {});
test.fixme('MO-B2-04 proveniência: frame.second.provenance na peça e 1 linha por arquivo no README (fonte, autor, licença, link, intervalo); licença desconhecida = null, redes = licenseCommercialOk false', async () => {});
