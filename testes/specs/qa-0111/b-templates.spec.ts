// Templates com créditos no navegador (MSW): pago, saldo baixo, quote mudou, pack com teto, amostra e Gerar no 390. Dono: maquina-qa.
import { test, expect, type Page } from '@playwright/test';
import { coletarErros, login, tela } from './ajuda.ts';

const ADO = 'I tried 11 sleep masks';
const main = (p: Page) => p.locator('main');

/** Galeria → card → anúncio → Continue → plano (Generate visível). */
async function atePlano(page: Page, card: RegExp | string, query: string) {
  await page.goto(`/templates?${query}`);
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  if (card === 'pack') await page.getByRole('button', { name: 'Use the pack' }).click();
  else {
    const c = page.locator('article, [data-template], li, div').filter({ has: page.getByText(card, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Use template' }) }).last();
    await c.getByRole('button', { name: 'Use template' }).click();
  }
  await page.waitForURL(/\/templates\/[^/]+$/);
  await page.getByText(ADO).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // 1º Continue sem oferta = OFFER_REQUIRED → aparece o seletor; escolhe a 1ª e aperta de novo
  const sel = page.getByRole('combobox').filter({ hasText: 'Which offer is this ad for?' });
  const veio = await Promise.race([
    sel.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true),
    page.waitForURL(/\/templates\/run\//, { timeout: 20_000 }).then(() => false),
  ]).catch(() => false);
  if (veio) {
    await sel.click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL(/\/templates\/run\//, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Generate/ }).last()).toBeVisible({ timeout: 90_000 });
}
const saldoMedidor = async (page: Page) => (await page.request.get('/api/session')).ok();

test('pago: plano com texto editável, Gerar 1 crédito, saldo 42 → 41', async ({ page }, info) => {
  const erros = coletarErros(page);
  const r4xx: string[] = [];
  page.on('response', async (r) => { if (r.status() >= 400) r4xx.push(`${r.status()} ${r.request().method()} ${r.url()} ${(await r.text().catch(() => '')).slice(0, 300)}`); });
  await login(page);
  await atePlano(page, 'Breaking news', 'mockaccess=paid&mockcredits=reset&metamock=connected');
  const txt = await main(page).innerText();
  expect(txt.toLowerCase()).toContain('nothing charged yet');
  await tela(page, info, 't1-plano');
  const gerar = page.getByRole('button', { name: /^Generate · 1 credit$/ });
  await expect(gerar).toBeVisible();
  // texto editável (FRAME): muda o headline
  const campo = main(page).locator('input, textarea').first();
  await campo.fill('Doctors talk about the 12-minute routine');
  await campo.blur();
  await page.waitForTimeout(1200);
  // 390: o botão Gerar tem que estar inteiro dentro da janela (barra de ação)
  const bb = await gerar.boundingBox();
  const vp = page.viewportSize()!;
  expect(bb, 'Gerar sem caixa').not.toBeNull();
  expect(bb!.y + bb!.height, 'Gerar fora da janela').toBeLessThanOrEqual(vp.height + 1);
  expect(bb!.x + bb!.width, 'Gerar cortado à direita').toBeLessThanOrEqual(vp.width + 1);
  await gerar.click();
  await page.waitForTimeout(2500);
  await tela(page, info, 't1-gerando');
  await page.goto('/credits');
  await page.waitForTimeout(1500);
  const c = await main(page).innerText();
  await tela(page, info, 't1-credits');
  expect(c).toMatch(/Breaking news · reserved|Breaking news · charged/);
  expect(c).toContain('41');
  console.log('4xx:', r4xx);
  // 422 OFFER_REQUIRED do 1º Continue é o contrato (a tela pede a oferta), não erro
  if (r4xx.length && r4xx.every((x) => x.includes('OFFER_REQUIRED'))) erros.splice(0, erros.length, ...erros.filter((e) => !e.includes('status of 422')));
  expect(erros, erros.join('\n') + '\n' + r4xx.join('\n')).toEqual([]);
});

test('saldo baixo: Gerar desabilitado + Get credits; quote mudou: 409 mostra o custo novo', async ({ page }, info) => {
  await login(page);
  await atePlano(page, 'Breaking news', 'mockaccess=paid&mockcredits=low&metamock=connected');
  await tela(page, info, 't2-sem-saldo');
  const t = await main(page).innerText();
  expect(t).toMatch(/You need 1 more credit|not enough/);
  await expect(page.getByRole('button', { name: /^Generate$/ })).toBeDisabled();
  // changed
  await atePlano(page, 'Meme POV', 'mockaccess=paid&mockcredits=reset&metamock=connected');
  await page.goto(page.url() + '?mockcredits=changed');
  await page.getByRole('button', { name: /^Generate · / }).click();
  await expect(main(page).getByText(/The cost changed: now/)).toBeVisible();
  await tela(page, info, 't2-quote-mudou');
});

test('pack: soma com teto de 10, desmarcar atualiza o total', async ({ page }, info) => {
  await login(page);
  await atePlano(page, 'pack', 'mockaccess=paid&mockcredits=reset&metamock=connected');
  await tela(page, info, 't3-pack');
  const linhas = page.locator('main label:has([role="checkbox"])');
  const n = await linhas.count();
  const gerar = page.getByRole('button', { name: /^Generate · / });
  const custo = async () => Number((await gerar.innerText()).match(/(\d+) credit/)?.[1]);
  const c0 = await custo();
  console.log(`pack: ${n} linhas, custo ${c0}`);
  expect(c0).toBe(Math.min(10, n));
  // desmarca até ficar abaixo do teto
  for (let i = 0; i < n && (await custo()) >= 10; i++) { await linhas.nth(i).getByRole('checkbox').click(); await page.waitForTimeout(700); }
  const c1 = await custo();
  const marcadas = await page.locator('main label [role="checkbox"][data-state="checked"]').count();
  expect(c1).toBe(Math.min(10, marcadas));
  await tela(page, info, 't3-pack-desmarcado');
});

test('amostra: 4 usos, Estático = plano pago, Gerar grátis gasta 1', async ({ page }, info) => {
  await login(page);
  await page.goto('/templates?mockaccess=sample&mockcredits=reset&metamock=connected');
  await expect(main(page).getByText(/Free sample · 4 of 4 left/)).toBeVisible();
  await tela(page, info, 't4-amostra-galeria');
  const est = page.locator('div').filter({ has: page.getByText('Static ad', { exact: false }) }).filter({ has: page.getByRole('link', { name: 'Paid plan' }) }).last();
  await expect(est.getByRole('link', { name: 'Paid plan' })).toBeVisible();
  await atePlano(page, 'Breaking news', 'mockaccess=sample&metamock=connected');
  await expect(page.getByRole('button', { name: 'Generate free sample' })).toBeVisible();
  await tela(page, info, 't4-amostra-plano');
  await page.getByRole('button', { name: 'Generate free sample' }).click();
  await page.waitForTimeout(2000);
  await page.goto('/templates');
  await expect(main(page).getByText(/Free sample · 3 of 4 left/)).toBeVisible({ timeout: 45_000 });
});
