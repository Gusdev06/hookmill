// Variação automática v1 no navegador (Q1, 13/10), em 1440 (iterate-1440) e 390 px (iterate-390: viewport por
// Emulation.setDeviceMetricsOverride do Playwright, a cada rota). Web do QA (Next dev 3216, sem MSW) → API do QA 3121
// (mock, render fake) → maquina_test. Screenshots em test-results/telas/<projeto>/iter-*.png. Nada pago.
import { readFileSync } from 'node:fs';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { ENV } from '../../harness/env.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { PODCAST, ateLote, assentou, lotePronto, oferta } from '../../harness/iterate.ts';
import { loginRapido, semRolagemHorizontal, tela } from '../../harness/navegador.ts';
import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });
test.afterEach(async () => { await esperarJobsQuietos(120_000); });
const LONGO = { timeout: 180_000 };

const L = {
  en: { generate: /^Generate \d+ pieces$/, failed: /LAYOUT-STORY failed\. The other \d+ keep going\./, retry: 'Retry', leaveOut: 'Leave out', cont: 'Continue to download',
        inZip: 'In zip', zip: 'Download zip', downloaded: /Downloaded · \d+ files/, offer: 'Which offer is this ad for?', why: 'Why this ad works', preview: (c: string) => `Preview ${c}`, close: 'Close preview' },
  pt: { generate: /^Gerar \d+ peças$/, failed: /LAYOUT-STORY falhou\. As outras \d+ continuam\./, retry: 'Tentar de novo', leaveOut: 'Deixar de fora', cont: 'Continuar pro download',
        inZip: 'No zip', zip: 'Baixar zip', downloaded: /Baixado · \d+ arquivos/, offer: 'De qual oferta é este anúncio?', why: /Por que esse anúncio funciona|Por que este anúncio funciona/, preview: (c: string) => `Prévia de ${c}`, close: 'Fechar prévia' },
};

/** Todo /api/v1 que o web chama tem que ser a API do QA (nunca 3001). Erros de console guardados. */
function espiao(page: Page) {
  const origens = new Set<string>();
  const erros: string[] = [];
  const respostas: { url: string; status: number }[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1')) origens.add(u.origin); });
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1')) respostas.push({ url: `${r.request().method()} ${u.pathname}`, status: r.status() }); });
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  return { origens, erros, respostas, soApiDoQa: () => expect([...origens], 'o web só fala com a API do QA').toEqual([new URL(ENV.apiUrl).origin]) };
}

async function fluxoCompleto(page: Page, info: any, lang: 'en' | 'pt') {
  const t = L[lang];
  const tag = `iter-${lang}`;
  await oferta('A', { language: lang === 'pt' ? 'pt-BR' : 'en', notes: '[mock:render-fail:STORY]' });
  const spy = espiao(page);
  await loginRapido(page, 'adminA');
  // o login (BFF) grava o NEXT_LOCALE do usuário; o idioma da interface troca depois, como no seletor EN/PT
  if (lang === 'pt') await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: info.project.use.baseURL! }]);
  await page.goto('/iterate/new');
  await expect(page.locator('input[type=file]')).toBeAttached(LONGO);
  if (lang === 'pt') await expect(page.getByText('Escolher arquivo').first()).toBeVisible();
  await tela(page, info, `${tag}-01-vazio`);
  await semRolagemHorizontal(page, 'iterate/new');
  // upload pelo input (no celular abre a galeria); a análise começa sozinha
  await page.locator('input[type=file]').setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, LONGO);
  const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  await page.waitForTimeout(1500);
  await tela(page, info, `${tag}-02-analisando`);
  const gerar = page.getByRole('button', { name: t.generate });
  await expect(gerar).toBeVisible(LONGO);
  await expect(page.getByText(t.why).first()).toBeVisible();
  await semRolagemHorizontal(page, 'analyze ready');
  await tela(page, info, `${tag}-03-plano`);
  const plano = (await as('adminA').get(`/iterate/${batchId}`)).data;
  await expect(gerar).toHaveText(new RegExp(`${plano.pieces.length}`));
  for (const p of plano.pieces) await expect(page.getByText(p.code, { exact: true }).first(), `código ${p.code} na tela`).toBeVisible();
  // códigos no idioma da OFERTA
  if (lang === 'pt') expect(plano.pieces.map((p: any) => p.code)).toEqual(expect.arrayContaining(['GANCHO-TEXTO-2', 'ESTATICO-F1']));
  await gerar.click();
  // 1 falha não para as outras; alerta com o código; Retry
  const alerta = page.getByText(t.failed);
  await expect(alerta).toBeVisible(LONGO);
  await page.waitForTimeout(500);
  await tela(page, info, `${tag}-04-falhou`);
  await semRolagemHorizontal(page, 'generate failed');
  await page.getByRole('button', { name: t.retry, exact: true }).first().click();
  await ateLote('adminA', batchId, (b) => assentou(b) && b.summary.failed === 0, { timeoutMs: 180_000, oQue: 'retry da STORY' });
  // com tudo pronto a tela passa sozinha pro Download (phase=download); se ainda estiver no Generate, "Continue to download"
  const cont = page.getByRole('link', { name: t.cont }).or(page.getByRole('button', { name: t.cont })).first();
  const zipBtn = page.getByRole('button', { name: t.zip });
  await expect(zipBtn.or(cont).first()).toBeVisible(LONGO);
  await page.waitForTimeout(2000);
  await tela(page, info, `${tag}-05-prontas`);
  if (!(await zipBtn.isVisible()) && (await cont.isVisible())) await cont.click();
  await expect(zipBtn).toBeVisible(LONGO);
  await semRolagemHorizontal(page, 'download');
  await tela(page, info, `${tag}-06-download`);
  // preview de uma peça
  const final = (await as('adminA').get(`/iterate/${batchId}`)).data;
  const peca = final.pieces.find((p: any) => p.type === 'STORY');
  await page.getByRole('button', { name: t.preview(peca.code) }).click();
  await expect(page.getByText(peca.files[0].name).first()).toBeVisible();
  await page.waitForTimeout(800);
  await tela(page, info, `${tag}-07-preview`);
  await page.getByRole('button', { name: t.close }).first().click();
  // In zip: tira 1 peça (a 1ª HOOK_TEXT)
  const hook = final.pieces.find((p: any) => p.type === 'HOOK_TEXT');
  const caixa = page.locator(`[aria-label="${t.preview(hook.code)}"]`).locator('xpath=ancestor::*[.//button[@role="checkbox"]][1]').getByRole('checkbox');
  await caixa.click();
  await expect.poll(async () => (await as('adminA').get(`/iterate/${batchId}`)).data.pieces.find((p: any) => p.id === hook.id).inZip, { timeout: 15_000 }).toBe(false);
  // Download zip → o browser recebe o arquivo com o nome do contrato
  const [dl] = await Promise.all([page.waitForEvent('download', LONGO), page.getByRole('button', { name: t.zip }).click()]);
  const nome = dl.suggestedFilename();
  const mmdd = (await q(`select to_char(launched_at, 'MMDD') d from variation_batches where id = $1`, [batchId]))[0].d;
  expect(nome).toMatch(new RegExp(`^QA_${mmdd}_[A-Z0-9-]+_${lang === 'pt' ? 'variations|variacoes' : 'variations'}\\.zip$`));
  const path = await dl.path();
  expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK');
  // alerta "Downloaded": sem recarregar (bug devolvido ao frontend se não aparecer) e depois de recarregar
  const semReload = await page.getByText(t.downloaded).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  info.annotations.push({ type: 'alerta Downloaded sem recarregar', description: String(semReload) });
  expect.soft(semReload, 'alerta "Downloaded" aparece sem recarregar a página').toBe(true);
  if (!semReload) {
    await tela(page, info, `${tag}-08a-baixado-sem-alerta`);
    await page.reload();
  }
  await expect(page.getByText(t.downloaded)).toBeVisible(LONGO);
  await tela(page, info, `${tag}-08-baixado`);
  spy.soApiDoQa();
  const ruins = spy.respostas.filter((r) => r.status >= 500);
  expect(ruins, JSON.stringify(ruins)).toEqual([]);
  info.annotations.push({ type: 'zip', description: `${nome}; erros console: ${spy.erros.filter((e) => !/Download the React DevTools|HMR/.test(e)).slice(0, 5).join(' | ')}` });
  return { batchId, nome };
}

test('IU-01 EN: upload → análise sozinha → plano → gerar → falha + Retry → download → preview → In zip → zip', async ({ page }, info) => {
  await fluxoCompleto(page, info, 'en');
});

test('IU-02 PT-BR: o mesmo fluxo em português, códigos PT (oferta pt-BR)', async ({ page }, info) => {
  await fluxoCompleto(page, info, 'pt');
});

test('IU-03 >1 oferta: seletor acima do dropzone; Leave out numa peça falha; Library "Use this"', async ({ page }, info) => {
  const o1 = await oferta('A', { name: 'QA Oferta Um', notes: '[mock:render-fail:REVIEW]' });
  await oferta('A', { name: 'QA Oferta Dois' });
  await loginRapido(page, 'donoA');
  await page.goto('/iterate/new');
  await expect(page.locator('label[for="iter-offer"]')).toHaveText(L.en.offer, LONGO);
  await tela(page, info, 'iter-09-duas-ofertas');
  await page.locator('#iter-offer').click();
  await page.getByRole('option', { name: 'QA Oferta Um' }).click();
  await page.locator('input[type=file]').setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, LONGO);
  const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  expect((await as('donoA').get(`/iterate/${batchId}`)).data.offer.id).toBe(o1.id);
  await page.getByRole('button', { name: L.en.generate }).click(LONGO);
  await expect(page.getByText(/LAYOUT-REVIEW failed/)).toBeVisible(LONGO);
  await page.getByRole('button', { name: L.en.leaveOut, exact: true }).first().click();
  await expect.poll(async () => (await as('donoA').get(`/iterate/${batchId}`)).data.summary.leftOut, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(800);
  await tela(page, info, 'iter-10-deixou-de-fora');
  // vencedor da Library (peça pronta marcada como vencedora) → "Use this" na tela vazia
  await ateLote('donoA', batchId, assentou, { timeoutMs: 180_000 });
  const pronta = (await as('donoA').get(`/iterate/${batchId}`)).data.pieces.find((p: any) => p.status === 'ready' && p.type !== 'STATIC');
  await q(`update creatives set is_winner = true where id = $1`, [pronta.creativeId]);
  await page.goto('/iterate/new');
  const usar = page.getByRole('button', { name: 'Use this' }).first();
  await expect(usar).toBeVisible(LONGO);
  await tela(page, info, 'iter-11-library');
  await usar.click();
  await page.waitForURL((u) => /\/iterate\/(?!new)[^/?]+/.test(u.pathname) && !u.pathname.includes(batchId), LONGO);
  await expect(page.getByRole('button', { name: L.en.generate })).toBeVisible(LONGO);
  await tela(page, info, 'iter-12-library-plano');
});

test('IU-04 CLIENT: abre o lote; o que a tela oferece pra gerar/refazer, e In zip + zip liberados', async ({ page }, info) => {
  await oferta('A', { notes: '[mock:render-fail:STORY]' });
  const b = await lotePronto('donoA', PODCAST);
  const spy = espiao(page);
  await loginRapido(page, 'clienteA');
  await page.goto(`/iterate/${b.id}`);
  const gerar = page.getByRole('button', { name: L.en.generate });
  await expect(gerar).toBeVisible(LONGO);
  await tela(page, info, 'iter-13-cliente-plano');
  const gerarHabilitado = await gerar.isEnabled();
  if (gerarHabilitado) {
    await gerar.click();
    await page.waitForTimeout(2000);
    await tela(page, info, 'iter-14-cliente-clicou-gerar');
  }
  const r403 = spy.respostas.filter((r) => r.status === 403).map((r) => r.url);
  info.annotations.push({ type: 'CLIENT', description: `Generate habilitado pro CLIENT: ${gerarHabilitado}; 403 recebidos: ${r403.join(', ')}` });
  expect((await as('donoA').get(`/iterate/${b.id}`)).data.status, 'CLIENT não lança o lote').toBe('PLAN_READY');
  // dono gera; o CLIENT faz In zip e baixa
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length }), 202);
  await ateLote('donoA', b.id, assentou, { timeoutMs: 180_000 });
  await page.goto(`/iterate/${b.id}?view=download`);
  await expect(page.getByRole('button', { name: L.en.zip })).toBeVisible(LONGO);
  await tela(page, info, 'iter-15-cliente-download');
  const hook = (await as('donoA').get(`/iterate/${b.id}`)).data.pieces.find((p: any) => p.type === 'HOOK_TEXT');
  await page.locator(`[aria-label="Preview ${hook.code}"]`).locator('xpath=ancestor::*[.//button[@role="checkbox"]][1]').getByRole('checkbox').click();
  await expect.poll(async () => (await as('donoA').get(`/iterate/${b.id}`)).data.pieces.find((p: any) => p.id === hook.id).inZip, { timeout: 15_000 }).toBe(false);
  const [dl] = await Promise.all([page.waitForEvent('download', LONGO), page.getByRole('button', { name: L.en.zip }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^QA_\d{4}_.+_variations\.zip$/);
  // a peça falha: o que o CLIENT vê no Generate
  await page.goto(`/iterate/${b.id}?view=generate`);
  await expect(page.getByText(/LAYOUT-STORY failed/)).toBeVisible(LONGO);
  const retryVisivel = await page.getByRole('button', { name: 'Retry', exact: true }).first().isVisible();
  await tela(page, info, 'iter-16-cliente-falha');
  info.annotations.push({ type: 'CLIENT retry', description: `Retry visível pro CLIENT: ${retryVisivel}` });
  spy.soApiDoQa();
});
