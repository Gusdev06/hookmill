// Item 3: tour obrigatório na 1ª entrada depois do passo 6 (onboarding-v2 §3.4 + spec decisão 9).
import { test, expect, type Page } from '@playwright/test';
import { as, conectarMeta, convidar, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };
const coach = (page: Page) => page.getByRole('dialog', { name: /./ }).filter({ hasText: /Tour · / });

async function contaLiveComMeta(label: string) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await conectarMeta(c);
  return c;
}

test('TO-01 5 paradas com vencedor real: sem X/Esc/skip, Back, recarregar mantém a parada, Finish grava, recarregar não reabre', async ({ page }, info) => {
  const c = await contaLiveComMeta('tour5');
  await login(page, c.email);
  await page.goto('/');
  await page.waitForURL(/\/brain$/, E);
  const d = coach(page);
  await expect(d).toBeVisible(E);
  await expect(d).toContainText('Tour · 1 of 5');
  await expect(d).toContainText(`We're building ${c.wsName}'s Brain`);
  await expect(d.getByRole('button', { name: /close|skip/i })).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Back' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(d).toBeVisible();
  await semRolagemHorizontal(page, 'tour 1');
  await tela(page, info, 'to-01a-brain');
  await d.getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/\/iterate\/new$/, E);
  await expect(coach(page)).toContainText('Tour · 2 of 5', E);
  await expect(coach(page)).toContainText('This ad is already working');
  await expect(page.locator('#t-winner')).toContainText('Hook A — the pain', E);
  await tela(page, info, 'to-01b-winner');
  // Back e recarregar
  await coach(page).getByRole('button', { name: 'Back' }).click();
  await expect(coach(page)).toContainText('Tour · 1 of 5', E);
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await expect(coach(page)).toContainText('Tour · 2 of 5', E);
  await page.reload();
  await expect(coach(page)).toContainText('Tour · 2 of 5', E);
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/\/creatives\/new$/, E);
  await expect(coach(page)).toContainText('Tour · 3 of 5', E);
  await expect(coach(page)).toContainText('Or start from a blank page');
  await tela(page, info, 'to-01c-concepts');
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/\/eddy$/, E);
  await expect(coach(page)).toContainText('Tour · 4 of 5', E);
  await expect(coach(page)).toContainText('Not live yet');
  await tela(page, info, 'to-01d-eddy');
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/\/$/, E);
  await expect(coach(page)).toContainText('Tour · 5 of 5', E);
  await expect(coach(page)).toContainText('Home is your scoreboard');
  await expect(coach(page).getByRole('button', { name: 'Next' })).toHaveCount(0);
  await semRolagemHorizontal(page, 'tour 5');
  await tela(page, info, 'to-01e-home');
  await coach(page).getByRole('button', { name: 'Finish' }).click();
  await expect(coach(page)).toHaveCount(0, E);
  await expect.poll(async () => (await as(c).get('/auth/me')).data.workspace.tourCompletedAt, E).not.toBeNull();
  expect((await as(c).get('/workspace/tour')).data.completedAt).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible(E);
  await page.waitForTimeout(2000);
  await expect(coach(page)).toHaveCount(0);
  await page.goto('/brain');
  await page.waitForTimeout(1500);
  await expect(coach(page)).toHaveCount(0);
});

test('TO-02 sem vencedor (sem Meta): 4 paradas, a 2ª é New concepts', async ({ page }, info) => {
  const c = await signup('tour4', { agencyName: 'Tour4 QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  expect((await as(c).get('/workspace/tour')).data.stops).toEqual(['brain', 'concepts', 'eddy', 'home']);
  await login(page, c.email);
  await page.goto('/');
  await page.waitForURL(/\/brain$/, E);
  await expect(coach(page)).toContainText('Tour · 1 of 4', E);
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await page.waitForURL(/\/creatives\/new$/, E);
  await expect(coach(page)).toContainText('Tour · 2 of 4', E);
  await tela(page, info, 'to-02-sem-vencedor');
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await coach(page).getByRole('button', { name: 'Next' }).click();
  await expect(coach(page)).toContainText('Tour · 4 of 4', E);
  await expect(page.locator('#t-kpis')).toContainText('No results here yet');
  await coach(page).getByRole('button', { name: 'Finish' }).click();
  await expect.poll(async () => (await as(c).get('/workspace/tour')).data.completedAt, E).not.toBeNull();
});

test('TO-03 Replay em Settings: roda de novo sem mexer em tourCompletedAt; Esc permitido no replay', async ({ page }, info) => {
  const c = await signup('replay', { agencyName: 'Replay QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  const done = (await as(c).post('/workspace/tour/complete')).data.tourCompletedAt;
  await login(page, c.email);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Replay tour' }).click();
  await page.waitForURL(/\/brain$/, E);
  await expect(coach(page)).toContainText('Tour · 1 of 4', E);
  await tela(page, info, 'to-03-replay');
  await coach(page).getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Escape');
  const depoisEsc = await coach(page).count();
  info.annotations.push({ type: 'Esc no replay', description: depoisEsc ? 'avança a parada (coachmark continua)' : 'fecha' });
  // termina o replay
  for (let i = 0; i < 4 && (await coach(page).count()); i++) {
    const fim = coach(page).getByRole('button', { name: 'Finish' });
    if (await fim.count()) await fim.click();
    else await coach(page).getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(800);
  }
  await expect(coach(page)).toHaveCount(0, E);
  expect((await as(c).get('/workspace/tour')).data.completedAt).toBe(done);
});

test('TO-04 CLIENT convidado faz e completa o tour (5 paradas com vencedor)', async ({ page }, info) => {
  const dono = await contaLiveComMeta('tourcli');
  const cli = await convidar(dono, 'CLIENT', 'cliente');
  await login(page, cli.email);
  await page.goto('/');
  await page.waitForURL(/\/brain$/, E);
  await expect(coach(page)).toContainText('Tour · 1 of 5', E);
  const vistas: string[] = ['1'];
  for (let i = 0; i < 4; i++) {
    await coach(page).getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(3500); // a parada sem alvo é pulada em 3 s
    await expect(coach(page)).toBeVisible(E);
    const txt = (await coach(page).textContent()) ?? '';
    vistas.push(/Tour · (\d) of 5/i.exec(txt)?.[1] ?? '?');
    if (await coach(page).getByRole('button', { name: 'Finish' }).count()) break;
  }
  info.annotations.push({ type: 'paradas vistas pelo CLIENT', description: vistas.join(' → ') });
  expect(vistas, 'CLIENT deveria ver as 5 paradas (a 2 em leitura)').toEqual(['1', '2', '3', '4', '5']);
  await tela(page, info, 'to-04-client-home');
  await coach(page).getByRole('button', { name: 'Finish' }).click();
  await expect.poll(async () => (await as(cli).get('/workspace/tour')).data.completedAt, E).not.toBeNull();
  // o dono continua sem tour feito (é por membership)
  expect((await as(dono).get('/workspace/tour')).data.completedAt).toBeNull();
});

test('TO-05 PT-BR: contador e textos', async ({ page, baseURL }, info) => {
  const c = await signup('tourpt', { agencyName: 'Tour PT QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/');
  await page.waitForURL(/\/brain$/, E);
  await expect(coach(page)).toContainText('Tour · 1 de 4', E);
  await expect(coach(page)).toContainText('Estamos montando o Cérebro de');
  await expect(coach(page).getByRole('button', { name: 'Avançar' })).toBeVisible();
  await tela(page, info, 'to-05-pt');
});
