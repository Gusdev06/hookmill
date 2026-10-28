// Revisão 23/10 no navegador (variacao-auto-v1 §14): plano com STATIC e custo → Generate (só 9:16) → preview →
// 4:5/1:1 de um vídeo e de um STATIC → Download (chips, "for all", zip) → falhas forçadas → CLIENT sem botões.
// Web do QA (Next dev, sem MSW) → API do QA (mock, render fake) → banco *_test próprio. 1440 e 390 (Emulation do
// Playwright por rota), EN e PT. Screenshots em test-results/telas/<projeto>/r23-*.png. Nada pago. Dono: maquina-qa.
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { ENV } from '../../harness/env.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { PODCAST, assentou, ateLote, lotePronto, oferta } from '../../harness/iterate.ts';
import { loginRapido, semRolagemHorizontal, tela } from '../../harness/navegador.ts';
import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });
test.afterEach(async () => { await esperarJobsQuietos(120_000); });
// onboarding-v2 (21/10): workspace sem setup concluído cai no /onboarding; tour e pergunta /start também
test.beforeEach(async () => {
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  await q(`update users set account_mode = 'OWN'`);
});
const LONGO = { timeout: 900_000 };

const L = {
  en: {
    generate: /^Generate \d+ pieces/, images: 'Images', preview: (c: string) => `Preview ${c}`, close: 'Close preview', zip: 'Download zip', cont: 'Continue to download',
    make: (f: string) => new RegExp(`^Make ${f}`), tryAgain: (f: string) => new RegExp(`^Try ${f} again`), dl: (f: string) => `Download ${f}`,
    forAll: (f: string) => new RegExp(`^${f} for all · \\d+`), confirm: /^Make them · /, safety: 'The image model refused this concept', retry: 'Retry',
    clientCant: 'Ask someone on the team to make this format.', formatsOf: (c: string) => `Formats of ${c}`,
  },
  pt: {
    generate: /^Gerar \d+ peças/, images: 'Imagens', preview: (c: string) => `Prévia de ${c}`, close: 'Fechar prévia', zip: 'Baixar zip', cont: 'Continuar pro download',
    make: (f: string) => new RegExp(`^Fazer ${f}`), tryAgain: (f: string) => new RegExp(`^Tentar ${f} de novo`), dl: (f: string) => `Baixar ${f}`,
    forAll: (f: string) => new RegExp(`^${f} pra todas · \\d+`), confirm: /^Fazer · /, safety: 'O modelo de imagem recusou este conceito', retry: 'Tentar de novo',
    clientCant: 'Peça pra alguém do time fazer este formato.', formatsOf: (c: string) => `Formatos de ${c}`,
  },
};
type Lang = keyof typeof L;

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
async function idioma(page: Page, info: any, lang: Lang) {
  if (lang === 'pt') await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: info.project.use.baseURL! }]);
}
const fmtDe = (p: any, f: string) => p.formats.find((x: any) => x.format === f);
const lote = async (id: string) => (await as('donoA').get(`/iterate/${id}`)).data;

async function abrirPreview(page: Page, t: (typeof L)[Lang], code: string) {
  await page.getByRole('button', { name: t.preview(code), exact: true }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  return dlg;
}

for (const lang of ['en', 'pt'] as Lang[]) {
  test(`R23-UI-01 ${lang}: plano com STATIC e custo → Generate só 9:16 → preview → 4:5/1:1 de vídeo (format-fail) e STATIC (static-reject) → for all → zip`, async ({ page }, info) => {
    test.setTimeout(1_800_000);
    const t = L[lang];
    const tag = `r23-${lang}`;
    await oferta('A', { language: lang === 'pt' ? 'pt-BR' : 'en', notes: '[mock:format-fail:NATIVE_SEARCH] [mock:static-reject]', sourceUrl: process.env.E2E_SEM_PAGINA === '1' ? null : 'https://example.com/' });
    const spy = espiao(page);
    await loginRapido(page, 'adminA');
    await idioma(page, info, lang);
    await page.goto('/iterate/new');
    await expect(page.locator('input[type=file]')).toBeAttached(LONGO);
    await page.locator('input[type=file]').setInputFiles(PODCAST);
    await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, LONGO);
    const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
    const gerar = page.getByRole('button', { name: t.generate });
    await expect(gerar).toBeVisible(LONGO);
    const plano = await lote(batchId);
    const nStatic = plano.pieces.filter((p: any) => p.type === 'STATIC').length;
    expect(nStatic).toBeGreaterThan(0);
    // custo das imagens no botão e na linha "Images"
    const usd = plano.cost.generateEstimateUsd as number;
    const txtBotao = (await gerar.innerText()).replace(/\s+/g, ' ');
    info.annotations.push({ type: 'botão Generate', description: txtBotao });
    // 25/10 (D1 = 2k): o preço vem do config, não fixo; o botão mostra a soma com 2 casas
    const precoImg = (await as('donoA').get('/iterate/config')).data.staticImageUsd as number;
    const precoRe = new RegExp(precoImg.toFixed(2).replace('.', '[.,]'));
    expect(usd).toBeCloseTo(nStatic * precoImg, 4);
    const [int, dec] = usd.toFixed(2).split('.');
    expect(txtBotao).toMatch(lang === 'pt' ? new RegExp(`(US)?\\$\\s?${int}[.,]${dec}`) : new RegExp(`\\$${int}\\.${dec}`));
    await expect(page.getByText(t.images, { exact: true }).first()).toBeVisible();
    await semRolagemHorizontal(page, 'plano');
    await tela(page, info, `${tag}-01-plano-custo`);
    await gerar.click();
    // 9:16 só: espera assentar
    await ateLote('adminA', batchId, assentou, { timeoutMs: 900_000, oQue: 'lote assentado' });
    const nRenders = (await q(`select count(*)::int n, count(*) filter (where r.format <> 'VERTICAL_9_16')::int outros from renders r join creatives c on c.id = r.creative_id where c.variation_batch_id = $1`, [batchId]))[0];
    expect(nRenders).toEqual({ n: plano.pieces.length, outros: 0 });
    const cont = page.getByRole('link', { name: t.cont }).or(page.getByRole('button', { name: t.cont })).first();
    const zipBtn = page.getByRole('button', { name: t.zip });
    await expect(zipBtn.or(cont).first()).toBeVisible(LONGO);
    if (!(await zipBtn.isVisible()) && (await cont.isVisible())) await cont.click();
    await expect(zipBtn).toBeVisible(LONGO);
    await page.waitForTimeout(1200);
    await semRolagemHorizontal(page, 'download');
    await tela(page, info, `${tag}-02-download-so-9x16`);
    const b1 = await lote(batchId);
    const cut = b1.pieces.find((p: any) => p.type === 'NATIVE_SEARCH'); // 27/10: HOOK_TEXT saiu do catálogo; HEADLINE não tem 4:5
    const st = b1.pieces.find((p: any) => p.type === 'STATIC');
    expect(st.status, 'static-reject: reenvio safe passou').toBe('ready');
    // chips da peça: 9:16 pronto, 4:5 e 1:1 com botão (STATIC mostra o preço)
    const chipsSt = page.getByRole('group', { name: t.formatsOf(st.code) });
    await expect(chipsSt.getByRole('button')).toHaveCount(2);
    expect((await chipsSt.getByRole('button').first().getAttribute('aria-label')) ?? '').toMatch(precoRe);

    // ── vídeo (CUT): preview → 4:5 falha (format-fail) → Try again → pronto; 1:1 → pronto
    let dlg = await abrirPreview(page, t, cut.code);
    await dlg.getByRole('radio', { name: '4:5', exact: true }).click();
    await tela(page, info, `${tag}-03-preview-cut-4x5-none`);
    await dlg.getByRole('button', { name: t.make('4:5') }).click();
    await expect(dlg.getByRole('button', { name: t.tryAgain('4:5') })).toBeVisible(LONGO);
    await tela(page, info, `${tag}-04-preview-cut-4x5-falhou`);
    expect(fmtDe((await lote(batchId)).pieces.find((p: any) => p.id === cut.id), '4x5')).toMatchObject({ state: 'failed', errorCode: 'RENDER_ERROR' });
    await dlg.getByRole('button', { name: t.tryAgain('4:5') }).click();
    await expect(dlg.getByRole('link', { name: t.dl('4:5') })).toBeVisible(LONGO);
    await page.waitForTimeout(800);
    await tela(page, info, `${tag}-05-preview-cut-4x5-pronto`);
    await dlg.getByRole('radio', { name: '1:1', exact: true }).click();
    await dlg.getByRole('button', { name: t.make('1:1') }).click();
    await expect(dlg.getByRole('link', { name: t.dl('1:1') })).toBeVisible(LONGO);
    await dlg.getByRole('button', { name: t.close }).first().click();

    // ── STATIC: imagem no 9:16; 4:5 com preço → pronto (imagem)
    dlg = await abrirPreview(page, t, st.code);
    await expect(dlg.locator(`img[alt="${st.code}, 9:16"]`)).toBeVisible();
    await dlg.getByRole('radio', { name: '4:5', exact: true }).click();
    const mk = dlg.getByRole('button', { name: t.make('4:5') });
    await expect(mk).toContainText(precoRe);
    await tela(page, info, `${tag}-06-preview-static-4x5-preco`);
    await mk.click();
    await expect(dlg.locator(`img[alt="${st.code}, 4:5"]`)).toBeVisible(LONGO);
    await page.waitForTimeout(800);
    await tela(page, info, `${tag}-07-preview-static-4x5-pronto`);
    const nat = await dlg.locator(`img[alt="${st.code}, 4:5"]`).evaluate((i: HTMLImageElement) => `${i.naturalWidth}x${i.naturalHeight}`);
    info.annotations.push({ type: 'STATIC 4:5 natural', description: nat });
    await dlg.getByRole('button', { name: t.close }).first().click();

    // ── "1:1 for all": confirm com o total das imagens (STATIC sem 1:1) → todas na fila → prontas
    const forAll = page.getByRole('button', { name: t.forAll('1:1') });
    await expect(forAll).toBeEnabled();
    await forAll.click();
    const conf = page.getByRole('alertdialog');
    await expect(conf).toBeVisible();
    await tela(page, info, `${tag}-08-for-all-confirm`);
    await conf.getByRole('button', { name: t.confirm }).click();
    await page.waitForTimeout(1500);
    await tela(page, info, `${tag}-09-for-all-na-fila`);
    const todas = await ateLote('adminA', batchId, (x) => x.pieces.filter((p: any) => p.status === 'ready').every((p: any) => ['ready', 'failed'].includes(fmtDe(p, '1x1').state)), { timeoutMs: 900_000, oQue: '1:1 pra todas' });
    const naoProntas = todas.pieces.filter((p: any) => p.status === 'ready' && fmtDe(p, '1x1').state !== 'ready').map((p: any) => `${p.code}:${fmtDe(p, '1x1').state}`);
    expect(naoProntas, '1:1 pra todas').toEqual([]);
    await expect(page.getByRole('button', { name: lang === 'pt' ? /^1:1 pra todas$/ : /^1:1 for all$/ })).toBeDisabled(LONGO);
    await page.waitForTimeout(1000);
    await semRolagemHorizontal(page, 'download com formatos');
    await tela(page, info, `${tag}-10-download-formatos`);

    // ── zip com 9:16 + formatos feitos
    const [dl] = await Promise.all([page.waitForEvent('download', LONGO), zipBtn.click()]);
    const lista = execFileSync('unzip', ['-Z1', await dl.path()], { encoding: 'utf8' }).trim().split('\n');
    const pronto = await lote(batchId);
    const esperados = pronto.pieces.filter((p: any) => p.status === 'ready' && p.inZip).reduce((a: number, p: any) => a + p.files.length, 0);
    expect(lista.filter((x) => !x.endsWith('README.txt')).length, 'zip = todos os formatos prontos').toBe(esperados);
    for (const nome of [`${cut.code}_4x5.mp4`, `${cut.code}_1x1.mp4`, `${st.code}_9x16.png`, `${st.code}_4x5.png`, `${st.code}_1x1.png`]) {
      expect(lista.some((x) => x.endsWith(nome)), `${nome} no zip`).toBe(true);
    }
    info.annotations.push({ type: 'zip', description: `${dl.suggestedFilename()} · ${lista.length} entradas` });
    spy.soApiDoQa();
    const ruins = spy.respostas.filter((r) => r.status >= 500);
    expect(ruins, JSON.stringify(ruins)).toEqual([]);
    info.annotations.push({ type: 'erros console', description: spy.erros.filter((e) => !/React DevTools|HMR/.test(e)).slice(0, 6).join(' | ') || '-' });
    // nada pago
    expect(Number((await q(`select coalesce(sum(amount_usd),0) s from cost_entries where variation_batch_id = $1`, [batchId]))[0].s)).toBe(0);
  });
}

test('R23-UI-02 static-reject-all: STATIC failed com o motivo e Retry com preço; CLIENT vê o lote sem botões de formato/Retry', async ({ page }, info) => {
  test.setTimeout(1_200_000);
  await oferta('A', { notes: '[mock:static-reject-all]', sourceUrl: process.env.E2E_SEM_PAGINA === '1' ? null : 'https://example.com/' });
  const b = await lotePronto('donoA', PODCAST);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd }), 202);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 900_000 });
  const sts = fim.pieces.filter((p: any) => p.type === 'STATIC');
  expect(sts.every((p: any) => p.status === 'failed' && p.errorCode === 'SAFETY_BLOCK')).toBe(true);
  // um vídeo com 4:5 pronto pra ver o que o CLIENT baixa
  const vid = fim.pieces.find((p: any) => p.type !== 'STATIC' && p.type !== 'HEADLINE');
  expectOk(await as('donoA').post(`/iterate/pieces/${vid.id}/formats`, { format: '4x5' }), 202);
  await ateLote('donoA', b.id, (x) => fmtDe(x.pieces.find((p: any) => p.id === vid.id), '4x5').state === 'ready', { oQue: '4:5', timeoutMs: 900_000 });

  // ADMIN no Generate: motivo SAFETY_BLOCK + Retry com preço
  await loginRapido(page, 'adminA');
  await page.goto(`/iterate/${b.id}?view=generate`);
  await expect(page.getByText(L.en.safety).first()).toBeVisible(LONGO);
  const retry = page.getByRole('button', { name: /^Retry/ }).first();
  await expect(retry).toBeVisible();
  const txtRetry = (await retry.innerText()).replace(/\s+/g, ' ');
  info.annotations.push({ type: 'Retry STATIC', description: txtRetry });
  await page.waitForTimeout(800);
  await semRolagemHorizontal(page, 'generate falha');
  await tela(page, info, 'r23-11-static-reject-all-admin');
  const precoRe = new RegExp(((await as('donoA').get('/iterate/config')).data.staticImageUsd as number).toFixed(2).replace('.', '[.,]'));
  expect(txtRetry, 'Retry do STATIC mostra o preço da imagem').toMatch(precoRe);

  // CLIENT
  await page.context().clearCookies();
  const spy = espiao(page);
  await loginRapido(page, 'clienteA');
  await page.goto(`/iterate/${b.id}?view=download`);
  await expect(page.getByRole('button', { name: L.en.zip })).toBeVisible(LONGO);
  await page.waitForTimeout(1000);
  await tela(page, info, 'r23-12-cliente-download');
  await expect(page.getByRole('button', { name: /^Make (4:5|1:1)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Try (4:5|1:1) again/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /for all/ })).toHaveCount(0);
  const dlg = await abrirPreview(page, L.en, vid.code);
  await dlg.getByRole('radio', { name: '1:1', exact: true }).click();
  await expect(dlg.getByText(L.en.clientCant)).toBeVisible();
  await expect(dlg.getByRole('button', { name: /^Make 1:1/ })).toHaveCount(0);
  await tela(page, info, 'r23-13-cliente-preview-1x1');
  await dlg.getByRole('radio', { name: '4:5', exact: true }).click();
  await expect(dlg.getByRole('link', { name: 'Download 4:5' })).toBeVisible();
  await dlg.getByRole('button', { name: L.en.close }).first().click();
  await page.goto(`/iterate/${b.id}?view=generate`);
  await expect(page.getByText(L.en.safety).first()).toBeVisible(LONGO);
  const retryCliente = await page.getByRole('button', { name: /^Retry/ }).count();
  info.annotations.push({ type: 'Retry visível pro CLIENT', description: String(retryCliente) });
  await page.waitForTimeout(800);
  await tela(page, info, 'r23-14-cliente-generate');
  const r403 = spy.respostas.filter((r) => r.status === 403);
  expect(r403, 'CLIENT não dispara rota proibida').toEqual([]);
  spy.soApiDoQa();
});
