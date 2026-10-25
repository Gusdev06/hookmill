// Estático "anúncio montado" (Parte A) — docs/contratos/estatico-montado-e-molduras-v1.md §A2-§A9 (APROVADO 25/10).
// Contrato + "nada inventado" + paleta + checagem de texto + legado + isolamento, contra a API do QA em mock (render fake,
// STATIC no fake da ia: PNG determinístico, custo 0). Banco *_test próprio. NADA PAGO. Dono: maquina-qa.
// PENDENTE até A-I + A-B (§C.1): cada teste pula sozinho enquanto o config não tiver o preço 2k (harness › entrega()).
// Rodar (de testes/): npm run em      (E2E_EM=1, API do QA na 3131)
//   E2E_EM_FORCAR=1 roda mesmo sem a entrega (pra ver o que falta); E2E_DATABASE_URL=…/maquina_qa_em_test pra banco próprio.
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { WS, q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { BRAIN_VAZIO, PODCAST, assentou, ateLote, lotePronto, oferta } from '../../harness/iterate.ts';
import {
  BRAIN_SEM_OFERTA, blocosEsperados, confereStaticV2, contrasteBranco, ctxDoLote, entrega, familiasEm, hsl, itensDoLote,
  maxCards, nadaPago, renderVigente, specDoRender, tasksDo, textosDoCopy,
} from '../../harness/estatico-molduras.ts';

test.describe.configure({ timeout: 300_000 });
let E: Awaited<ReturnType<typeof entrega>>;
test.beforeAll(async () => { E = await entrega(); });
test.beforeEach(() => { test.skip(!E.estaticoV2, 'pendente: A-I (STATIC_IMAGE_MODEL 2k, planAutoBatch V2, checkStaticText, fakes) + A-B (validação V2, paleta, ImagemEstaticaService) — §C.1'); });
test.afterEach(async () => {
  await q(`update workspaces set monthly_spend_cap_usd = 200, brand_color = null where id in ($1, $2)`, [WS.A, WS.B]);
  await esperarJobsQuietos(120_000);
});

const PRECO = 0.4; // D1 = 2k
const estaticos = (b: any) => b.pieces.filter((p: any) => p.type === 'STATIC');
const start = (b: any, persona: 'donoA' | 'donoB' = 'donoA') =>
  as(persona).post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd });
const fmtDe = (p: any, f: string) => p.formats?.find((x: any) => x.format === f);
async function paramsStatic(batchId: string) {
  return (await itensDoLote(batchId)).filter((i) => i.auto_type === 'STATIC').map((i) => ({ ...i, params: i.payload?.params ?? {} }));
}
async function promptsDe(creativeId: string, format: string) {
  const r = await renderVigente(creativeId, format);
  const tks = r ? await tasksDo(r.id) : [];
  return { r, tks, prompt: String(tks.at(-1)?.input?.prompt ?? '') };
}

// ───────────────────────── plano (§A2, §A3) ─────────────────────────

test('EA-01 custo 2k: staticImageUsd = 0,40; generateEstimateUsd = nº STATIC × 0,40; estimativa 0,85× = ESTIMATE_CHANGED; requestUsd/retryUsd = 0,40', async () => {
  await oferta('A');
  expect(E.cfg.staticImageUsd).toBeCloseTo(PRECO, 4);
  const b = await lotePronto('donoA', PODCAST);
  expect(b.status).toBe('PLAN_READY');
  const n = estaticos(b).length;
  expect(n, 'plano do mock com STATIC').toBeGreaterThan(0);
  expect(b.cost.generateEstimateUsd).toBeCloseTo(n * PRECO, 4);
  expectErro(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd * 0.85 }), 409, 'ESTIMATE_CHANGED');
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) expect(fmtDe(p, '4x5').requestUsd, `${p.code} 4:5`).toBeCloseTo(PRECO, 4);
  await nadaPago(b.id);
});

test('EA-02 Brain cheio: todo STATIC novo = layout assembled, copy por bloco com fonte, visual v2; limites §A2; nada inventado §A3.1; 2 STATIC = emoções e headlines diferentes', async () => {
  const o = await oferta('A');
  const b = await lotePronto('donoA', PODCAST, o.id);
  const ctx = await ctxDoLote(b.id);
  const itens = await paramsStatic(b.id);
  expect(itens.length).toBeGreaterThan(0);
  for (const it of itens) {
    const v = confereStaticV2(it.params, ctx, o.name);
    expect(v, `${it.code}: ${JSON.stringify(it.params.copy)}`).toEqual([]);
    test.info().annotations.push({ type: `copy ${it.code}`, description: textosDoCopy(it.params.copy).map((t) => `${t.key}=${t.text}`).join(' | ') });
    // headline fala com a pessoa (2ª pessoa no idioma da tela): heurística, só anota
    const h = `${it.params.copy.headline.lead} ${it.params.copy.headline.highlight}`;
    if (!/\b(you|your|você|voce|seu|sua|tú|tu|usted)\b/i.test(h)) test.info().annotations.push({ type: 'headline sem 2ª pessoa (rever)', description: h });
    // emoção ataca o porquê (whyKey) quando o item grava o whyKey
    const why = it.payload?.whyKey ?? it.params?.whyKey;
    const emo = (it.params.visualV2 ?? it.params.visual)?.hero?.emotion;
    if (why && emo) {
      const ok = { hook: ['pain', 'curiosity'], proof: ['relief', 'pride'], cta: ['desire'] }[why as 'hook'] ?? [];
      expect(ok, `${it.code}: whyKey ${why} → emoção ${emo}`).toContain(emo);
    }
  }
  if (itens.length === 2) {
    const [a, z] = itens.map((i) => i.params);
    const ea = (a.visualV2 ?? a.visual)?.hero?.emotion, ez = (z.visualV2 ?? z.visual)?.hero?.emotion;
    if (ea && ez) expect(ea, 'D2: 2 STATIC no lote = emoções diferentes').not.toBe(ez);
    const hk = (p: any) => `${p.copy.headline.lead} ${p.copy.headline.highlight}`.toLowerCase().replace(/\s+/g, ' ');
    expect(hk(a), 'duplicateKey STATIC:<headline>').not.toBe(hk(z));
  }
});

test('EA-03 Brain sem oferta/prova/CTA: nenhum grátis/garantia/desconto/plataforma; cta.sub null; trust sem offerAndPrice/proof; nada inventado', async () => {
  const o = await oferta('A', BRAIN_SEM_OFERTA);
  const b = await lotePronto('donoA', PODCAST, o.id);
  const ctx = await ctxDoLote(b.id);
  for (const it of await paramsStatic(b.id)) {
    const c = it.params.copy;
    expect(confereStaticV2(it.params, ctx, o.name), `${it.code}`).toEqual([]);
    const tudo = textosDoCopy(c, it.params.visualV2).map((t) => t.text).join(' | ');
    const famFala = new Set(familiasEm(ctx.fala));
    for (const f of familiasEm(tudo)) expect(famFala.has(f), `${it.code}: "${f}" sem dado no Brain (fala também não tem) — ${tudo}`).toBe(true);
    if (!familiasEm(ctx.fala).includes('gratis')) expect(c.cta.sub, `${it.code}: cta.sub sem offerAndPrice`).toBeNull();
    for (const t of c.trust ?? []) expect(['offerAndPrice', 'proof']).not.toContain(t.source);
  }
});

test('EA-04 Brain vazio: blocos somem em vez de inventar (brandLine null, benefits [], trust []); headline da fala; CTA genérico sem promessa', async () => {
  const o = await oferta('A', BRAIN_VAZIO);
  const b = await lotePronto('donoA', PODCAST, o.id);
  const ctx = await ctxDoLote(b.id);
  const itens = await paramsStatic(b.id);
  test.info().annotations.push({ type: 'STATIC no plano com Brain vazio', description: String(itens.length) });
  for (const it of itens) {
    const c = it.params.copy;
    expect(confereStaticV2(it.params, ctx, o.name), it.code).toEqual([]);
    expect(c.brandLine).toBeNull();
    expect(c.benefits).toEqual([]);
    expect(c.trust).toEqual([]);
    expect(c.headlineSource).toBe('transcript');
    expect(c.cta.sub).toBeNull();
    expect(familiasEm(c.cta.main), `cta.main "${c.cta.main}" sem promessa`).toEqual([]);
  }
});

// ───────────────────────── cor da marca + spec do render (§A3.3, §A4) ─────────────────────────

test('EA-05 brandColor: PATCH /workspace (#RGB/#RRGGBB, normaliza maiúsculo; inválido 400; MEMBER/CLIENT 403; null limpa) e vira o accent do spec; fundo escuro mesmo matiz, contraste ≥ 7:1', async () => {
  for (const ruim of ['3d8bff', '#3d8bf', '#GGGGGG', 'blue', 123]) expectErro(await as('donoA').patch('/workspace', { brandColor: ruim }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch('/workspace', { brandColor: '#3D8BFF' }), 403, 'FORBIDDEN');
  expectErro(await as('clienteA').patch('/workspace', { brandColor: '#3D8BFF' }), 403, 'FORBIDDEN');
  expect(expectOk(await as('adminA').patch('/workspace', { brandColor: '#3d8bff' })).brandColor).toBe('#3D8BFF');
  expect(expectOk(await as('donoA').patch('/workspace', { brandColor: '#f80' })).brandColor, '#RGB expande').toBe('#FF8800');
  expect(expectOk(await as('donoA').patch('/workspace', { brandColor: null })).brandColor).toBeNull();
  expect(expectOk(await as('donoA').patch('/workspace', { brandColor: '#3D8BFF' })).brandColor).toBe('#3D8BFF');
  expect(expectOk(await as('membroA').get('/workspace')).brandColor).toBe('#3D8BFF');

  const o = await oferta('A');
  const b = await lotePronto('donoA', PODCAST, o.id);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const plano = await paramsStatic(b.id);
  for (const p of estaticos(fim)) {
    const { r, prompt } = await promptsDe(p.creativeId, 'VERTICAL_9_16');
    expect(r.engine).toBe('IMAGE_GEN');
    const spec = specDoRender(r.input);
    expect(spec?.layout, `${p.code}: spec V2 no render`).toBe('assembled');
    expect(spec.brandName).toBe(o.name);
    expect(spec.palette.accent).toBe('#3D8BFF');
    const ha = hsl(spec.palette.accent), hb = hsl(spec.palette.background);
    expect(Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h)), 'fundo no mesmo matiz').toBeLessThanOrEqual(12);
    expect(hb.l, 'fundo L ≈ 8-12 %').toBeGreaterThanOrEqual(0.06);
    expect(hb.l).toBeLessThanOrEqual(0.14);
    expect(contrasteBranco(spec.palette.background), 'texto branco ≥ 7:1').toBeGreaterThanOrEqual(7);
    const it = plano.find((i) => i.code === p.code)!;
    expect(spec.copy, 'o render escreve o copy salvo no plano').toEqual(it.params.copy);
    expect(prompt).toContain(spec.palette.accent);
  }
  await nadaPago(b.id);
});

test('EA-06 sem brandColor: accent cai na cadeia (página › campeão › #FF8A3D), hex válido, contraste ≥ 7:1', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) {
    const spec = specDoRender((await renderVigente(p.creativeId)).input);
    expect(spec.palette.accent).toMatch(/^#[0-9A-F]{6}$/i);
    expect(contrasteBranco(spec.palette.background)).toBeGreaterThanOrEqual(7);
    test.info().annotations.push({ type: `paleta ${p.code}`, description: JSON.stringify(spec.palette) });
  }
});

test('EA-07 prompt por aspecto (§A4): 9:16 escreve todo bloco presente + TEXT CHECKLIST + 2k; 4:5 sem fechamento e ≤ 3 cards; 1:1 sem tagline/manuscrito/confiança/fechamento', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const st = estaticos(fim)[0];
  expect(st?.status).toBe('ready');
  for (const f of ['4x5', '1x1']) expectOk(await as('donoA').post(`/iterate/pieces/${st.id}/formats`, { format: f }), 202);
  await ateLote('donoA', b.id, (x) => ['4x5', '1x1'].every((f) => fmtDe(x.pieces.find((p: any) => p.id === st.id), f)?.state === 'ready'), { oQue: '4:5 e 1:1 do STATIC' });
  const copy = (await paramsStatic(b.id)).find((i) => i.code === st.code)!.params.copy;
  for (const [format, aspect] of [['VERTICAL_9_16', '9:16'], ['PORTRAIT_4_5', '4:5'], ['SQUARE_1_1', '1:1']] as const) {
    const { r, tks, prompt } = await promptsDe(st.creativeId, format);
    expect(tks.length, `${aspect}: 1 task`).toBe(1);
    expect(JSON.stringify(tks[0].input), `${aspect}: resolução 2k`).toMatch(/2k/i);
    expect(JSON.stringify(tks[0].input)).toContain(aspect);
    expect(prompt, `${aspect}: TEXT CHECKLIST`).toMatch(/TEXT CHECKLIST/);
    expect(specDoRender(r.input).copy, `${aspect}: copy salvo é o mesmo`).toEqual(copy);
    const quer = blocosEsperados(aspect, copy);
    const tem = (s: string | null | undefined) => !!s && prompt.includes(s);
    expect(tem(copy.headline.lead) && tem(copy.headline.highlight), `${aspect}: headline`).toBe(true);
    expect(tem(copy.cta.main), `${aspect}: CTA`).toBe(true);
    if (copy.tagline) expect(tem(copy.tagline), `${aspect}: tagline`).toBe(quer.includes('tagline'));
    if (copy.handwritten) expect(tem(copy.handwritten), `${aspect}: manuscrito`).toBe(quer.includes('handwritten'));
    if (copy.closing) expect(tem(copy.closing), `${aspect}: fechamento`).toBe(quer.includes('closing'));
    for (const t of copy.trust ?? []) expect(tem(t.text), `${aspect}: confiança "${t.text}"`).toBe(quer.includes('trust'));
    const cards = (copy.benefits ?? []).filter((x: any) => tem(x.title)).length;
    expect(cards, `${aspect}: cards`).toBeLessThanOrEqual(Math.min(maxCards(aspect), copy.benefits?.length ?? 0));
    if (aspect === '1:1') for (const x of copy.benefits ?? []) if (x.line) expect(tem(x.line), '1:1 card compacto (só título)').toBe(false);
    test.info().annotations.push({ type: `prompt ${aspect}`, description: prompt.slice(0, 400) });
  }
});

// ───────────────────────── checagem de texto (§A6) ─────────────────────────

test('EA-08 textCheck ok: STATIC pronto com textCheck {status ok} (headline e CTA críticos), 1 task; peças de vídeo textCheck null', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of fim.pieces) {
    if (p.type !== 'STATIC') { expect(p.textCheck ?? null, `${p.code}: vídeo sem textCheck`).toBeNull(); continue; }
    expect(p.status).toBe('ready');
    expect(p.textCheck?.status, `${p.code}: ${JSON.stringify(p.textCheck)}`).toBe('ok');
    const r = await renderVigente(p.creativeId);
    expect((await tasksDo(r.id)).length).toBe(1);
    const crit = (p.textCheck.items ?? []).filter((i: any) => i.critical).map((i: any) => i.expected);
    test.info().annotations.push({ type: `críticos ${p.code}`, description: crit.join(' | ') });
  }
  await nadaPago(b.id);
});

test('EA-09 [mock:static-text-mismatch]: 1ª imagem com erro crítico → refaz 1× (2 tasks no render) → textCheck ok', async () => {
  await oferta('A', { notes: '[mock:static-text-mismatch]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) {
    expect(p.status).toBe('ready');
    const tks = await tasksDo((await renderVigente(p.creativeId)).id);
    expect(tks.map((t) => t.status), `${p.code}: 2 tasks`).toEqual(['COMPLETED', 'COMPLETED']);
    expect(p.textCheck?.status).toBe('ok');
  }
  test.info().annotations.push({ type: 'imagesUsd (mock 0)', description: String(fim.cost.imagesUsd) });
});

test('EA-10 [mock:static-text-mismatch-all]: as 2 erradas → ready com textCheck mismatch (esperado × visto, crítico), no zip; nunca 3ª task', async () => {
  await oferta('A', { notes: '[mock:static-text-mismatch-all]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) {
    expect(p.status, 'entrega com aviso, não falha').toBe('ready');
    expect(p.inZip).toBe(true);
    expect(p.textCheck?.status).toBe('mismatch');
    const erros = p.textCheck.items.filter((i: any) => i.seen !== i.expected);
    expect(erros.length).toBeGreaterThan(0);
    expect(erros.some((i: any) => i.critical)).toBe(true);
    for (const i of erros) expect(typeof i.expected).toBe('string');
    expect((await tasksDo((await renderVigente(p.creativeId)).id)).length, '≤ 2 tasks por render').toBe(2);
    test.info().annotations.push({ type: `mismatch ${p.code}`, description: JSON.stringify(erros) });
  }
  const z = await as('donoA').post(`/iterate/${b.id}/zip`, {});
  expect([200, 202]).toContain(z.status);
  const pz = await ateLote('donoA', b.id, (x) => ['ready', 'failed'].includes(x.zip.status), { oQue: 'zip' });
  expect(pz.zip.files).toBe(fim.pieces.length);
});

test('EA-11 teto na refação: [mock:static-text-mismatch] com teto baixado logo depois do start → não refaz (1 task), entrega mismatch', async () => {
  await oferta('A', { notes: '[mock:static-text-mismatch]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  await q(`update workspaces set monthly_spend_cap_usd = 0.01 where id = $1`, [WS.A]);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) {
    const tks = await tasksDo((await renderVigente(p.creativeId)).id);
    expect(tks.length, `${p.code}: refação passa pelo teto (assertWithinCap 0,40 > 0,01). Se deu 2, ou o teto não foi checado ou a 1ª checagem rodou antes do UPDATE (fake < 1 s)`).toBe(1);
    expect(p.status).toBe('ready');
    expect(p.textCheck?.status).toBe('mismatch');
  }
});

test('EA-12 recusa + texto dividem o limite de 2 tasks: [mock:static-reject] [mock:static-text-mismatch] → ≤ 2 tasks, peça ready', async () => {
  await oferta('A', { notes: '[mock:static-reject] [mock:static-text-mismatch]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  for (const p of estaticos(fim)) {
    const tks = await tasksDo((await renderVigente(p.creativeId)).id);
    expect(tks.length, `${p.code}: ${tks.map((t) => `${t.status}/${t.error_code}`).join(' → ')}`).toBe(2);
    expect(tks[0].error_code).toBe('SAFETY_BLOCK');
    expect(p.status).toBe('ready');
    expect(['ok', 'mismatch']).toContain(p.textCheck?.status);
    test.info().annotations.push({ type: p.code, description: `textCheck=${p.textCheck?.status}` });
  }
});

test.fixme('EA-13 Claude fora na checagem → READY com textCheck skipped (não segura a peça)', async () => {
  // PENDENTE: o contrato (§A9) só lista [mock:static-text-mismatch] e [mock:static-text-mismatch-all]. Pedido à maquina-ia:
  // gatilho `[mock:static-text-check-fail]` (checkStaticText lança) → backend grava textCheck { status: 'skipped', items: [] }.
});

test.fixme('EA-14 Retry e Leave out numa peça ready com textCheck mismatch (§A6 "Retry e Leave out")', async () => {
  // PERGUNTA AO ARQUITETO: §A6 manda o web mostrar Retry e Leave out na peça com texto errado, mas a peça é `ready`, e o
  // variacao-auto (IT-08) diz retry/leave-out de peça ready = 409 INVALID_STATE. Qual rota e qual estado? (retry cobra 0,40 e
  // passa pelo teto?). O caso fica escrito quando a regra estiver no contrato.
});

// ───────────────────────── legado (§A5) ─────────────────────────

test('EA-15 legado: item com visual v1 → photo_headline (builder de 23/10, sem TEXT CHECKLIST, textCheck null); visual vazio → poster', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  const its = await paramsStatic(b.id);
  expect(its.length).toBeGreaterThan(0);
  const v1 = { type: 'STATIC', atSec: 0, refAtSec: null, headline: 'Find money you forgot about',
    visual: { object: 'A man in his thirties looking at a phone', scene: 'a kitchen at night', vibe: 'calm, warm lamp light', style: 'everyday_photo', headlinePlacement: 'top' } };
  const poster = { type: 'STATIC', atSec: 0, refAtSec: null, headline: 'Find money you forgot about' };
  await q(`update variation_items set payload = jsonb_set(payload, '{params}', $2::jsonb) where id = $1`, [its[0].id, JSON.stringify(v1)]);
  if (its[1]) await q(`update variation_items set payload = jsonb_set(payload, '{params}', $2::jsonb) where id = $1`, [its[1].id, JSON.stringify(poster)]);
  else test.info().annotations.push({ type: 'poster', description: 'plano com 1 STATIC só: caso poster não exercitado nesta rodada' });
  const b2 = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expectOk(await start(b2), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const peca = (code: string) => fim.pieces.find((p: any) => p.code === code);
  const p0 = peca(its[0].code);
  expect(p0.status).toBe('ready');
  const r0 = await promptsDe(p0.creativeId, 'VERTICAL_9_16');
  const s0 = r0.r.input?.spec ?? {};
  expect(s0.layout ?? 'photo_headline', 'v1 → photo_headline').toBe('photo_headline');
  expect(s0.visual?.object).toBe(v1.visual.object);
  expect(r0.prompt).toContain(v1.headline);
  expect(r0.prompt).not.toMatch(/TEXT CHECKLIST/);
  expect(p0.textCheck ?? null, 'legado sem textCheck').toBeNull();
  if (its[1]) {
    const p1 = peca(its[1].code);
    expect(p1.status).toBe('ready');
    const s1 = (await renderVigente(p1.creativeId)).input?.spec ?? {};
    expect(s1.layout ?? 'poster').toBe('poster');
    expect(p1.textCheck ?? null).toBeNull();
  }
});

// ───────────────────────── isolamento ─────────────────────────

test('EA-16 isolamento: cor da marca de B nunca entra no spec de A; PATCH de B não muda A; MEMBER em A e B (duplo) = 403; peça STATIC de A com token de B = 404', async () => {
  expectOk(await as('donoA').patch('/workspace', { brandColor: '#3D8BFF' }));
  expectOk(await as('donoB').patch('/workspace', { brandColor: '#00FF66' }));
  expectErro(await as('duplo').patch('/workspace', { brandColor: '#123456' }), 403, 'FORBIDDEN');
  expect(expectOk(await as('donoA').get('/workspace')).brandColor).toBe('#3D8BFF');
  const [{ brand_color }] = await q(`select brand_color from workspaces where id = $1`, [WS.B]);
  expect(brand_color).toBe('#00FF66');
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const st = estaticos(fim)[0];
  const spec = specDoRender((await renderVigente(st.creativeId)).input);
  expect(spec.palette.accent).toBe('#3D8BFF');
  expect(JSON.stringify(spec)).not.toContain('00FF66');
  expect(JSON.stringify(spec)).not.toContain('QA Beta');
  const antes = JSON.stringify(await q(`select id, status, payload from variation_items where batch_id = $1 order by id`, [b.id]));
  const x = as('donoB');
  expectErro(await x.post(`/iterate/pieces/${st.id}/formats`, { format: '4x5' }), 404, 'NOT_FOUND');
  expectErro(await x.post(`/iterate/pieces/${st.id}/retry`, {}), 404, 'NOT_FOUND');
  expectErro(await x.post(`/iterate/pieces/${st.id}/leave-out`, {}), 404, 'NOT_FOUND');
  expectErro(await x.get(`/creatives/${st.creativeId}/download?format=9x16`), 404, 'NOT_FOUND');
  expect(JSON.stringify(await q(`select id, status, payload from variation_items where batch_id = $1 order by id`, [b.id]))).toBe(antes);
});

// ───────────────────────── nada pago ─────────────────────────

test('EA-17 nada pago no caminho todo: tasks só do fake (STATIC_IMAGE + TRANSCRIBE + checagem mock), custo 0', async () => {
  await oferta('A', { notes: '[mock:static-text-mismatch]' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await start(b), 202);
  await ateLote('donoA', b.id, assentou, { timeoutMs: 240_000 });
  const kinds = await q(`select kind, count(*)::int n from provider_tasks group by kind`);
  test.info().annotations.push({ type: 'provider_tasks', description: JSON.stringify(kinds) });
  expect(kinds.map((k) => k.kind).filter((k) => !['TRANSCRIBE', 'STATIC_IMAGE'].includes(k)), 'nenhum outro provider').toEqual([]);
  const [{ s }] = await q(`select coalesce(sum(amount_usd),0)::float s from cost_entries`);
  expect(s).toBe(0);
});
