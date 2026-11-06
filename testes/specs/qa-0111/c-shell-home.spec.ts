// Shell de painéis, Home v2 (Recentes com lote), Brand (edição no lugar), menu/dropdown e tour no shell novo. MSW. Dono: maquina-qa.
import { test, expect, type Page } from '@playwright/test';
import { coletarErros, login, tela } from './ajuda.ts';

const dentro = async (page: Page, sel: ReturnType<Page['locator']>, nome: string) => {
  const b = await sel.boundingBox();
  const vp = page.viewportSize()!;
  expect(b, `${nome} sem caixa`).not.toBeNull();
  expect(b!.x, `${nome} cortado à esquerda`).toBeGreaterThanOrEqual(-1);
  expect(b!.y, `${nome} cortado no topo`).toBeGreaterThanOrEqual(-1);
  expect(b!.x + b!.width, `${nome} cortado à direita`).toBeLessThanOrEqual(vp.width + 1);
  expect(b!.y + b!.height, `${nome} cortado embaixo`).toBeLessThanOrEqual(vp.height + 1);
};

test('Home: Recentes juntam criativos e lotes (GET /iterate), links certos', async ({ page }, info) => {
  const erros = coletarErros(page);
  const iterate: string[] = [];
  page.on('request', (r) => { if (/\/api\/v1\/iterate\?/.test(r.url())) iterate.push(r.url()); });
  await login(page);
  await page.goto('/?mockaccess=internal');
  const recent = page.locator('section, div').filter({ has: page.getByText('Recent', { exact: true }) }).filter({ has: page.locator('a[href^="/creatives/"]') }).last();
  await expect(page.getByText('Recent', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByText('Recent', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await tela(page, info, 'c-home-recentes');
  const hrefs = await recent.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  console.log('GET /iterate:', iterate, '\nhrefs recentes:', hrefs.slice(0, 12));
  expect(iterate.some((u) => /limit=5/.test(u)), 'Home não chamou GET /iterate?limit=5').toBe(true);
  // F-web-mock: o MSW não tem GET /iterate (lista) → ERR_FAILED e nenhum lote nos Recentes; soft pra registrar sem parar o resto
  expect.soft(hrefs.some((h) => /\/iterate\/|\/templates\/run\/|\/variations\//.test(h)), 'nenhum lote nos Recentes (MSW sem GET /iterate)').toBe(true);
  // ERR_FAILED do passe 1: quais recursos?
  const falhas: string[] = [];
  page.on('requestfailed', (r) => falhas.push(`${r.failure()?.errorText} ${r.url()}`));
  await page.reload();
  await page.waitForTimeout(4000);
  console.log('requestfailed:', falhas);
  console.log('erros:', erros);
});

test('Brand: aba padrão; edição no lugar salva o campo; ?view=map abre o 3D', async ({ page }, info) => {
  await login(page);
  await page.goto('/brain?mockaccess=internal');
  await expect(page.getByRole('tab', { name: 'Brand', selected: true })).toBeVisible({ timeout: 30_000 });
  // linha "Name" dentro do card Business (#s-business); a lista de ofertas também tem campo Name
  const linha = page.locator('#s-business div').filter({ has: page.getByText('Name', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
  await linha.getByRole('button', { name: 'Edit' }).click();
  const campo = linha.locator('input, textarea').first();
  await expect(campo).toBeVisible();
  await campo.fill('Workspace QA');
  await tela(page, info, 'c-brand-editando');
  await campo.press('Enter');
  await page.waitForTimeout(1500);
  const save = linha.getByRole('button', { name: /Save/ });
  if (await save.count()) { await save.first().click().catch(() => undefined); await page.waitForTimeout(1200); }
  // salvo = "Saved just now" no card Business (o valor novo pode ficar fora da área visível no 390)
  await expect(page.locator('#s-business').getByText(/Saved just now/)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('#s-business').innerText()).toContain('Workspace QA');
  await tela(page, info, 'c-brand-salvo');
  await page.goto('/brain?view=map&mockaccess=internal', { timeout: 120_000 });
  await expect(page.getByRole('tab', { name: 'Map', selected: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  // celular: lista + cartão "Open the 3D view" (decisão do brain-3d-v1); desktop: canvas
  if (page.viewportSize()!.width < 761) await expect(page.getByText('Open the 3D view')).toBeVisible();
  else expect(await page.locator('canvas').count(), 'mapa 3D sem canvas').toBeGreaterThan(0);
  await tela(page, info, 'c-brain-mapa');
});

test('shell: menu (390) e seletor de cliente (1440) inteiros na tela; navegação fecha o menu', async ({ page }, info) => {
  await login(page);
  await page.goto('/?mockaccess=internal');
  const mobile = page.viewportSize()!.width < 761;
  if (mobile) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(800); // fim da animação de entrada do sheet
    await tela(page, info, 'c-menu-aberto');
    await dentro(page, sheet, 'menu');
    await sheet.getByRole('link', { name: 'Templates', exact: true }).first().click();
    await page.waitForURL(/\/templates$/);
    await expect(sheet).toBeHidden();
    // switcher na topbar
    await page.getByRole('button', { name: /Switch client/ }).first().click();
  } else {
    await page.getByRole('button', { name: /Switch client/ }).first().click();
  }
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await tela(page, info, 'c-switcher');
  await dentro(page, menu, 'seletor de cliente');
  await page.keyboard.press('Escape');
  if (!mobile) {
    // menu da conta no pé da sidebar (fica no fim do card da sidebar, que rola sozinho)
    const conta = page.getByRole('button', { name: 'Account' });
    await conta.scrollIntoViewIfNeeded();
    await conta.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await tela(page, info, 'c-menu-conta');
    await dentro(page, page.getByRole('menu'), 'menu da conta');
  }
});

test('tour: Replay tour percorre as paradas, balão inteiro na tela', async ({ page }, info) => {
  const avisos: string[] = [];
  page.on('console', (m) => { if (m.text().includes('[tour]')) avisos.push(m.text()); });
  await login(page);
  await page.goto('/settings?mockaccess=internal');
  await page.getByRole('button', { name: 'Replay tour' }).click();
  const balao = page.getByText(/^Tour · \d+ of \d+$/i).first();
  await expect(balao).toBeVisible({ timeout: 30_000 });
  const total = Number((await balao.innerText()).match(/of (\d+)/i)![1]);
  for (let i = 1; i <= total; i++) {
    const caixa = page.getByRole('dialog').filter({ has: page.getByText(/^Tour · /i) }).first();
    await expect(caixa).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await tela(page, info, `c-tour-${i}`);
    await dentro(page, caixa, `balão do tour ${i}`);
    const btn = caixa.getByRole('button', { name: i === total ? 'Finish' : 'Next' });
    if (!(await btn.count())) break;
    await btn.click();
  }
  console.log('tour total', total, 'avisos', avisos);
  expect(avisos, `paradas puladas: ${avisos.join(' | ')}`).toEqual([]);
});
