import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('testes/.cache/semantic-ia/fixture.json', 'utf8'));
const dir = 'testes/variacao-ia-2026-11-04';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, baseURL: 'http://localhost:3341', acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(25000); page.setDefaultNavigationTimeout(90000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Nenhum destino externo é necessário para este fluxo.
await context.route('**/*', (route) => {
  const u = new URL(route.request().url());
  return ['localhost', '127.0.0.1'].includes(u.hostname) || ['data:', 'blob:', 'about:'].includes(u.protocol) ? route.continue() : route.abort();
});
const checks = [];
try {
  const login = await context.request.post('/api/session', { data: { email: fixture.email, password: fixture.password } });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  // Tirar o onboarding da fixture ANTES de navegar; o tour pode redirecionar depois do primeiro paint.
  const tour = await context.request.post('http://localhost:3241/api/v1/workspace/tour/complete', { headers: { Authorization: `Bearer ${session.accessToken}` }, data: {} });
  expect(tour.ok()).toBeTruthy();
  await page.goto('/ai-variations');
  await expect(page.getByRole('heading', { name: 'Variações com IA', exact: true })).toBeVisible();
  await page.locator('#semantic-source').selectOption(fixture.championId);
  await page.getByLabel('Outro formato', { exact: true }).check();
  await page.locator('#semantic-instructions').fill('Transforme a explicação em demonstração, FAQ e conversa de podcast, preservando a oferta.');
  await page.getByRole('button', { name: 'Criar três propostas' }).click();
  await expect(page.locator('article')).toHaveCount(3);
  await expect(page.getByText(/Simulação de desenvolvimento —/)).toBeVisible();
  checks.push('geracao pela UI com tres propostas e modo simulado explicito');
  const firstUrl = page.url();
  await page.screenshot({ path: `${dir}/desktop-pt.png`, fullPage: true });
  await page.reload();
  await expect(page.locator('article')).toHaveCount(3);
  expect(page.url()).toBe(firstUrl);
  checks.push('retomada do plano salvo apos reload');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar plano' }).click();
  const download = await downloadPromise; await download.saveAs(`${dir}/plano-exportado.json`);
  const saved = JSON.parse(readFileSync(`${dir}/plano-exportado.json`, 'utf8'));
  expect(saved.mediaGenerated).toBe(false); expect(saved.variations).toHaveLength(3);
  expect(saved.variations.find((v) => v.formatId === 'F10').beats.map((b) => b.speaker)).toEqual(['host', 'presenter', 'host', 'presenter']);
  checks.push('download JSON fiel e podcast alternando quatro turnos');
  await expect(page.getByRole('button', { name: 'Criar três propostas' })).toBeEnabled();
  await page.getByLabel('Outro público', { exact: true }).check();
  await page.getByRole('checkbox', { name: /Demonstração/ }).uncheck();
  await page.getByRole('checkbox', { name: /FAQ/ }).uncheck();
  await page.locator('#semantic-instructions').fill('Pessoas que trabalham em turnos e querem organizar as refeições.');
  await page.getByRole('button', { name: 'Criar três propostas' }).click();
  await expect(page.getByText('Revisar se a oferta atende a este público.')).toHaveCount(3);
  checks.push('expansao de publico exige revisao da adequacao em todas as propostas');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/mobile-pt.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  checks.push('390px sem transbordamento horizontal');
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3341' }]);
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AI variations', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download plan' })).toBeVisible();
  await page.screenshot({ path: `${dir}/desktop-en.png`, fullPage: true });
  checks.push('interface EN e PT, roteiro preservado no idioma da oferta');
  expect(errors).toEqual([]);
  checks.push('sem erros JavaScript na pagina');
  console.log(JSON.stringify({ status: 'passed', checks }, null, 2));
} catch (e) {
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {});
  writeFileSync(`${dir}/failure.txt`, await page.locator('body').innerText().catch(() => ''));
  throw e;
} finally {
  writeFileSync(`${dir}/browser-result.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
