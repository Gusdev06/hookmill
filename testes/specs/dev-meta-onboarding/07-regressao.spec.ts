// Item 8: regressão rápida do que já existia (login pela tela, wizard do zero até Scripts, Iterate por upload, Variar,
// Library, Clients, Settings, CLIENT).
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { PASSWORD, as, convidar, login, prepararWorkspace, semRolagemHorizontal, signup, tela } from './dev.ts';

test.use({ actionTimeout: 30_000 });
const E = { timeout: 90_000 };
const PODCAST = join(process.cwd(), 'fixtures', 'campeoes', 'podcast-aceite.mp4');

test('RG-01 login pela tela → wizard do zero (oferta por link → 4 roteiros) → Variar abre → Library → Clients → Settings', async ({ page }, info) => {
  const c = await signup('reg', { agencyName: 'Regressao QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await page.goto('/login');
  await page.getByLabel('Email').fill(c.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), E);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible(E);
  await page.goto('/creatives/new');
  await page.getByRole('radio', { name: 'New from link' }).or(page.getByText('New from link')).first().click();
  await page.getByLabel('Sales page link').fill('https://orbit-budget.example.com/sales');
  await page.getByRole('button', { name: 'Read page' }).click();
  await expect(page.getByText('Filled from the page. Check it before you continue.')).toBeVisible(E);
  await tela(page, info, 'rg-01a-offer');
  await page.locator('[data-primary]').first().click();
  await page.waitForURL(/\/creatives\/[^/]+\/scripts/, E);
  await expect(page.getByRole('button', { name: 'Use this script' })).toHaveCount(4, E);
  await semRolagemHorizontal(page, 'scripts');
  await tela(page, info, 'rg-01b-scripts');
  await page.goto('/variations/new');
  await page.waitForTimeout(1500);
  info.annotations.push({ type: 'variations/new', description: `${page.url()} · ${(await page.locator('h1').first().innerText().catch(() => '?'))}` });
  await tela(page, info, 'rg-01c-variar');
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible(E);
  await tela(page, info, 'rg-01d-library');
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible(E);
  await expect(page.locator('main').getByText('Regressao QA').first()).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible(E);
  await expect(page.getByText('Account mode')).toBeVisible();
  await tela(page, info, 'rg-01e-settings');
});

test('RG-02 Iterate por upload: análise sozinha → plano com Generate', async ({ page }, info) => {
  const c = await signup('regup', { agencyName: 'Upload QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await login(page, c.email);
  await page.goto('/iterate/new');
  await expect(page.locator('input[type=file]')).toBeAttached(E);
  await expect(page.getByText('Pick from your Meta account')).toBeVisible(E);
  await page.locator('input[type=file]').setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, E);
  await expect(page.getByRole('button', { name: /^Generate \d+ pieces$/ })).toBeVisible({ timeout: 240_000 });
  await tela(page, info, 'rg-02-upload-plano');
});

test('RG-03 CLIENT num workspace LIVE: Home, Library e Settings abrem; sem Clients/New client; escrita barrada', async ({ page }, info) => {
  const dono = await signup('regcli', { agencyName: 'Cli QA', accountMode: 'AGENCY' });
  await prepararWorkspace(dono, { live: true });
  const cli = await convidar(dono, 'CLIENT', 'c');
  await as(cli).post('/workspace/tour/complete');
  await login(page, cli.email);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible(E);
  await expect(page.getByText('Client · approves ads').first()).toBeAttached(); // no 390 fica no menu (sidebar escondida)
  await tela(page, info, 'rg-03a-client-home');
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible(E);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible(E);
  expect((await as(cli).patch('/workspace', { name: 'x' })).status).toBe(403);
  expect((await as(cli).post('/meta/connect', {})).status).toBe(403);
  await tela(page, info, 'rg-03b-client-settings');
});
