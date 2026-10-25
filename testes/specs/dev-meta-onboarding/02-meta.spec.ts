// Q1 meta-v1 (item 2): passo 2 Connect Meta no mock — fluxo feliz, erros do OAuth, sem permissão, suspensa, Skip,
// Disconnect/reconectar em Settings › Connections. META_MODE=off fica em 03-off.spec.ts (API reiniciada).
import { test, expect } from '@playwright/test';
import { as, call, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };

test('ME-01 fluxo feliz: Continue with Facebook → callback → escolher conta/página/pixel → saúde → Continue; 1º sync', async ({ page }, info) => {
  const c = await signup('meta', { agencyName: 'Mooncloth QA', accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2, businessType: 'ONLINE_STORE' });
  await login(page, c.email);
  await page.goto('/onboarding/meta');
  await expect(page.getByRole('heading', { name: 'Connect Meta' })).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await semRolagemHorizontal(page, 'meta idle');
  await tela(page, info, 'me-01a-idle');
  await page.getByRole('button', { name: 'Continue with Facebook' }).click();
  await page.waitForURL(/\/onboarding\/meta/, E);
  // estado choose: 3 contas do mock, a read-only desabilitada com "No permission"
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toBeVisible(E);
  await expect(page.getByRole('radio', { name: /Mock Disabled \(BRL\)/ })).toBeVisible();
  const ro = page.getByRole('radio', { name: /Mock Read-only/ });
  await expect(ro).toBeDisabled();
  await expect(page.getByText('No permission')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toHaveAttribute('data-state', 'checked');
  await expect(page.locator('#meta-page')).toContainText('Mock Page');
  await expect(page.locator('#meta-pixel')).toContainText('Mock Pixel', E);
  await expect(page.getByText(/Logged in · 3 ad accounts, 1 Page/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('meta'), '?meta=connected some da URL').toBeNull();
  await semRolagemHorizontal(page, 'meta choose');
  await tela(page, info, 'me-01b-choose');
  await page.getByRole('button', { name: 'Use this account' }).click();
  await expect(page.getByText('Account health')).toBeVisible(E);
  await expect(page.getByText('1 thing to look at')).toBeVisible(E);
  for (const k of ['Ad account active', 'Payment method valid', 'Pixel firing', 'Business verified']) await expect(page.getByText(k)).toBeVisible();
  await expect(page.getByText(/Mock Store \(USD\) · act_mock_1/)).toBeVisible();
  // bug 4 corrigido: depois do 1º sync o cartão mostra 8 · 6 active sozinho (sem Check again)
  await expect(page.getByText(/^8 · 6 active$/)).toBeVisible({ timeout: 40_000 });
  await semRolagemHorizontal(page, 'meta health');
  await tela(page, info, 'me-01c-health');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  // 1º sync disparado pela seleção: 8 anúncios, 2 WINNER
  const a = as(c);
  await expect.poll(async () => (await a.get('/meta/summary')).data?.sync?.state, E).toBe('ok');
  const list = await a.get('/meta/ads');
  expect(list.data.length).toBe(8);
  expect(list.data.filter((x: any) => x.verdict === 'WINNER').map((x: any) => x.metaAdId).sort()).toEqual(['mock_ad_1', 'mock_ad_2']);
  const conn = (await a.get('/meta/connection')).data;
  expect(conn).not.toHaveProperty('tokenCiphertext');
  expect(JSON.stringify(conn)).not.toMatch(/accessToken|ciphertext|"mock"/i);
  expect(conn.adAccount.id).toBe('act_mock_1');
  expect(conn.pixel?.id).toBe('pix_mock');
  // Check again atualiza "Ads found"
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText(/^8 · \d+ active$/)).toBeVisible(E);
  const ads2 = await page.getByText(/^8 · \d+ active$/).innerText();
  info.annotations.push({ type: 'Ads found após Check again', description: ads2 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/\/onboarding\/offer$/, E);
  const w = (await a.get('/workspace')).data;
  expect(w.onboarding.steps.find((s: any) => s.key === 'meta').state).toBe('done');
  info.annotations.push({ type: 'percent com Meta', description: String(w.onboarding.percent) });
});

test('ME-02 os erros do OAuth na volta do callback: denied, scopes, failed, state inválido', async ({ page }, info) => {
  const c = await signup('oauth', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  const url = (await as(c).post('/meta/connect', { returnTo: '/onboarding/meta' })).data.url as string;
  const casos: [string, string, RegExp][] = [
    ['mock-denied', 'META_OAUTH_DENIED', /The window was closed before it finished/],
    ['mock-scopes', 'META_SCOPES_MISSING', /needs these permissions to work: ads_management/],
    ['mock-failed', 'META_OAUTH_FAILED', /Meta login failed\. Try again/],
  ];
  for (const [code, esperado, msg] of casos) {
    await page.goto(url.replace('code=mock&', `code=${code}&`));
    await page.waitForURL(/\/onboarding\/meta/, E);
    await expect(page.getByText('Facebook didn\'t finish the login')).toBeVisible(E);
    await expect(page.getByText(msg)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await tela(page, info, `me-02-${esperado.toLowerCase()}`);
    // o redirect da API traz o código (conferido pela API, já que o web limpa a query)
    const r = await fetch(url.replace('code=mock&', `code=${code}&`), { redirect: 'manual' });
    expect(r.headers.get('location')).toContain(`meta=error&code=${esperado}`);
  }
  const r = await fetch(url.replace(/state=[^&]+/, 'state=abc'), { redirect: 'manual' });
  expect(r.headers.get('location')).toContain('code=META_STATE_INVALID');
  await page.goto(url.replace(/state=[^&]+/, 'state=abc'));
  await expect(page.getByText('This login link expired')).toBeVisible(E);
  await tela(page, info, 'me-02-meta_state_invalid');
  // nada foi gravado
  expect((await as(c).get('/meta/connection')).data).toBeNull();
  // Try again leva de novo ao callback e conecta
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('radio', { name: /Mock Store/ })).toBeVisible(E);
});

test('ME-03 conta suspensa (act_mock_2): bloqueada, Continue desabilitado, "Choose another account"; conta sem permissão = 422 na API', async ({ page }, info) => {
  const c = await signup('susp', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await page.goto('/onboarding/meta');
  await page.getByRole('button', { name: 'Continue with Facebook' }).click();
  await page.getByRole('radio', { name: /Mock Disabled \(BRL\)/ }).click(E);
  await page.getByRole('button', { name: 'Use this account' }).click();
  await expect(page.getByText('Blocked', { exact: true })).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByText('This account cannot be used yet')).toBeVisible();
  const alerta = page.locator('[role=alert], [data-slot=alert]').filter({ hasText: /account/i }).first();
  const titulo = await alerta.innerText().catch(() => '');
  info.annotations.push({ type: 'texto do alerta da conta suspensa', description: titulo.slice(0, 200) });
  expect(titulo, 'bug 3: conta suspensa não pode mostrar o texto de permissão').not.toMatch(/can't manage ads|Advertiser/);
  expect(titulo).toMatch(/disabled|suspend|another account/i);
  await semRolagemHorizontal(page, 'meta blocked');
  await tela(page, info, 'me-03a-blocked');
  const h = (await as(c).get('/meta/connection')).data.health;
  expect(h.canPublish).toBe(false);
  expect(h.checks.find((x: any) => x.key === 'account').level).toBe('bad');
  await page.getByRole('button', { name: 'Choose another account' }).click();
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toBeVisible(E);
  // sem permissão: a UI não deixa escolher; a API recusa
  const r = await as(c).put('/meta/selection', { adAccountId: 'act_mock_3', pageId: 'page_mock' });
  expect(r.status).toBe(422);
  expect(r.body.error.code).toBe('META_PERMISSION');
  expect(r.body.error.details.reason).toBe('no_advertise_task');
  await page.getByRole('radio', { name: /Mock Store \(USD\)/ }).click();
  await page.getByRole('button', { name: 'Use this account' }).click();
  await expect(page.getByText('1 thing to look at')).toBeVisible(E);
  await tela(page, info, 'me-03b-recovered');
});

test('ME-04 Skip for now: passo vira skipped, segue pro 3; Settings lembra', async ({ page }, info) => {
  const c = await signup('skip', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await page.goto('/onboarding/meta');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForURL(/\/onboarding\/offer$/, E);
  const w = (await as(c).get('/workspace')).data;
  expect(w.onboarding.step).toBe(3);
  expect(w.onboarding.steps.find((s: any) => s.key === 'meta').state).toBe('skipped');
  await tela(page, info, 'me-04-skipped');
});

test('ME-05 Settings › Connections: conectar depois de LIVE, Disconnect (token e snapshots somem), reconectar', async ({ page }, info) => {
  const c = await signup('conn', { agencyName: 'Lumen QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await login(page, c.email);
  await page.goto('/settings/connections');
  await expect(page.getByText('Not connected')).toBeVisible(E);
  await tela(page, info, 'me-05a-settings-idle');
  await page.getByRole('button', { name: 'Continue with Facebook' }).click();
  await page.waitForURL(/\/settings\/connections/, E);
  await expect(page.getByRole('radio', { name: /Mock Store \(USD\)/ })).toBeVisible(E);
  await page.getByRole('button', { name: 'Use this account' }).click();
  await expect(page.getByText('Account health')).toBeVisible(E);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  const a = as(c);
  await expect.poll(async () => (await a.get('/meta/summary')).data?.sync?.state, E).toBe('ok');
  await semRolagemHorizontal(page, 'settings connected');
  await tela(page, info, 'me-05b-settings-connected');
  await page.getByRole('button', { name: 'Disconnect' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Facebook' })).toBeVisible(E);
  await expect(page.getByText('Not connected')).toBeVisible();
  await tela(page, info, 'me-05c-disconnected');
  const conn = (await a.get('/meta/connection')).data;
  expect(conn.status).toBe('DISCONNECTED');
  expect((await a.get('/meta/ads')).status).toBe(422);
  // reconectar: volta ao choose (seleção anterior é oferecida/mantida?)
  await page.getByRole('button', { name: 'Continue with Facebook' }).click();
  await page.waitForURL(/\/settings\/connections/, E);
  const choose = await page.getByRole('radio', { name: /Mock Store \(USD\)/ }).isVisible({ timeout: 15_000 }).catch(() => false);
  info.annotations.push({ type: 'reconectar após disconnect', description: choose ? 'volta ao choose (seleção não mantida)' : 'seleção mantida' });
  if (choose) await page.getByRole('button', { name: 'Use this account' }).click();
  await expect(page.getByText('Account health')).toBeVisible(E);
  await expect.poll(async () => (await a.get('/meta/connection')).data?.status, E).toBe('ACTIVE');
  await tela(page, info, 'me-05d-reconnected');
});

test('ME-06 PT-BR: passo 2 conectando (choose + saúde)', async ({ page, baseURL }, info) => {
  const c = await signup('metapt', { accountMode: 'AGENCY' });
  await as(c).patch('/workspace', { onboardingStep: 2 });
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/onboarding/meta');
  await expect(page.getByRole('button', { name: 'Pular por enquanto' })).toBeVisible(E);
  await page.getByRole('button', { name: 'Continuar com o Facebook' }).click();
  await expect(page.getByRole('radio', { name: /Mock Store/ })).toBeVisible(E);
  await tela(page, info, 'me-06a-choose-pt');
  await page.getByRole('button', { name: 'Usar esta conta' }).click();
  await expect(page.getByText('Saúde da conta')).toBeVisible(E);
  await expect(page.getByText('1 ponto pra olhar')).toBeVisible(E);
  await tela(page, info, 'me-06b-health-pt');
});
