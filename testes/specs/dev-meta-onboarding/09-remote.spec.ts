// "Connect from another browser" (meta-v1 §3.1, 22/10): link copiável + contagem, login noutro navegador termina em
// /meta/done, a aba de origem detecta via GET /meta/oauth/status. EN/PT, 1440/390.
import { test, expect } from '@playwright/test';
import { as, login, ptBR, semRolagemHorizontal, signup, tela, API } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };

test('RM-01 link pro outro navegador: painel, contagem, status pending; abrir noutro contexto → /meta/done "Connected." → a aba de origem passa pro choose', async ({ page, browser, baseURL }, info) => {
  const c = await signup('remote', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await page.goto('/onboarding/meta');
  await page.getByRole('button', { name: 'Connect from another browser' }).click();
  await expect(page.getByText('Link for the other browser')).toBeVisible(E);
  const url = await page.locator('#meta-remote-url').inputValue();
  expect(url).toContain(`${API}/meta/callback?code=mock`);
  await expect(page.getByText(/Expires in 09:[0-9]{2}|Expires in 10:00/)).toBeVisible();
  await expect(page.getByText('Waiting for the login in the other browser…')).toBeVisible();
  const st = (await as(c).get('/meta/oauth/status')).data;
  expect(st.pending).toBe(true);
  expect(st.connectedAt).toBeNull();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copied')).toBeVisible(E);
  await semRolagemHorizontal(page, 'remote panel');
  await tela(page, info, 'rm-01a-link');
  // outro navegador: contexto novo, sem sessão do HookMill
  const outro = await browser.newContext();
  const p2 = await outro.newPage();
  await p2.goto(url);
  await p2.waitForURL(/\/meta\/done\?meta=connected/, E);
  await expect(p2.getByText('Connected.')).toBeVisible(E);
  await expect(p2.getByText('You can close this window and go back to HookMill.')).toBeVisible();
  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.screenshot({ path: `${process.env.QA_TELAS}/${info.project.name}/rm-01b-done-390.png`, fullPage: true });
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.screenshot({ path: `${process.env.QA_TELAS}/${info.project.name}/rm-01c-done-1440.png`, fullPage: true });
  await outro.close();
  // a aba de origem detecta pelo polling (3 s) e abre o choose
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toBeVisible(E);
  await expect(page.locator('#meta-remote-url')).toHaveCount(0);
  const st2 = (await as(c).get('/meta/oauth/status')).data;
  expect(st2.pending).toBe(false);
  expect(st2.connectedAt).not.toBeNull();
  await tela(page, info, 'rm-01d-origem-choose');
});

test('RM-02 erro no outro navegador (denied): /meta/done com a frase; a aba de origem mostra o alerta com "New link"', async ({ page, browser }, info) => {
  const c = await signup('remoteerr', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await page.goto('/onboarding/meta');
  await page.getByRole('button', { name: 'Connect from another browser' }).click();
  const url = await page.locator('#meta-remote-url').inputValue({ timeout: 30_000 });
  const outro = await browser.newContext();
  const p2 = await outro.newPage();
  await p2.goto(url.replace('code=mock&', 'code=mock-denied&'));
  await p2.waitForURL(/\/meta\/done\?meta=error&code=META_OAUTH_DENIED/, E);
  await expect(p2.getByText("Facebook didn't finish the login")).toBeVisible(E);
  await expect(p2.getByText(/The window was closed before it finished/)).toBeVisible();
  await expect(p2.getByText('Go back to HookMill and try again.')).toBeVisible();
  await p2.screenshot({ path: `${process.env.QA_TELAS}/${info.project.name}/rm-02a-done-error.png`, fullPage: true });
  await outro.close();
  await expect(page.getByText("Facebook didn't finish the login")).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'New link' })).toBeVisible();
  await tela(page, info, 'rm-02b-origem-erro');
  const st = (await as(c).get('/meta/oauth/status')).data;
  expect(st.pending).toBe(false);
  expect(st.lastError?.code).toBe('META_OAUTH_DENIED');
  expect((await as(c).get('/meta/connection')).data).toBeNull();
  // New link reabre o painel e um login bom conecta
  await page.getByRole('button', { name: 'New link' }).click();
  await expect(page.locator('#meta-remote-url')).not.toHaveValue(url, E);
  const url2 = await page.locator('#meta-remote-url').inputValue();
  const r = await fetch(url2, { redirect: 'manual' });
  expect(r.headers.get('location')).toContain('/meta/done?meta=connected');
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toBeVisible(E);
});

test('RM-03 PT-BR do link e da /meta/done; fechar o painel', async ({ page, browser, baseURL }, info) => {
  const c = await signup('remotept', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/onboarding/meta');
  await page.getByRole('button', { name: 'Conectar por outro navegador' }).click();
  await expect(page.getByText('Link pro outro navegador')).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Copiar link' })).toBeVisible();
  await expect(page.getByText(/Vence em/)).toBeVisible();
  await tela(page, info, 'rm-03a-link-pt');
  const url = await page.locator('#meta-remote-url').inputValue();
  const outro = await browser.newContext();
  await outro.addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: baseURL! }]);
  const p2 = await outro.newPage();
  await p2.goto(url);
  await expect(p2.getByText('Conectado.')).toBeVisible(E);
  await p2.screenshot({ path: `${process.env.QA_TELAS}/${info.project.name}/rm-03b-done-pt.png`, fullPage: true });
  await outro.close();
  await expect(page.getByRole('radio', { name: /Mock Store/ })).toBeVisible(E);
});
