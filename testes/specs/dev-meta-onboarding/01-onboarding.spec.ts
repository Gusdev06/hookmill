// Q2 onboarding-v2 (item 1): cadastro → /start → gate do wizard → Save and exit → Setup in progress → caminho de volta.
// Contra o dev (:3000/:3001 em mock), contas novas por teste. Telas em test-results/dev/telas/<projeto>/.
import { test, expect } from '@playwright/test';
import { PASSWORD, RUN, as, call, convidar, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };
const semSidebar = async (page: any) => {
  await expect(page.getByRole('link', { name: 'Iterate a winner' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'All clients' })).toHaveCount(0);
};

test('OB-01 cadastro pela tela → /start (AGENCY) → wizard fechado, shell mínimo, % e gate', async ({ page }, info) => {
  const email = `qa-ob2-${RUN}-ui-${info.project.name}@teste.local`;
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('QA Signup');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/start$/, E);
  await expect(page.getByRole('heading', { name: 'How will you use HookMill?' })).toBeVisible(E);
  await expect(page.getByText('Welcome, QA')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await semRolagemHorizontal(page, '/start');
  await tela(page, info, 'ob-01a-start');
  await page.locator('button[role=radio][value=AGENCY]').click();
  await page.getByLabel(/First client's name/).fill('Mooncloth QA');
  await tela(page, info, 'ob-01b-start-agency');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
  await expect(page.getByText('Mooncloth QA').first()).toBeVisible(E);
  await semSidebar(page);
  await expect(page.getByRole('button', { name: 'Save and exit' })).toBeVisible();
  await expect(page.getByText('Step 1 of 6', { exact: true })).toBeVisible();
  const pct = (await page.locator('[role=group] .font-mono').first().innerText()).trim();
  info.annotations.push({ type: 'percent conta nova', description: pct });
  await semRolagemHorizontal(page, 'business');
  await tela(page, info, 'ob-01c-business');
  // gate: qualquer rota fora de /onboarding/* volta pro passo salvo
  for (const r of ['/', '/brain', '/clients', '/settings/connections', '/iterate/new']) {
    await page.goto(r);
    await page.waitForURL(/\/onboarding\/business$/, E);
  }
  // passo 1 → % sobe por conteúdo
  await page.getByLabel('Business name').fill('Mooncloth QA');
  await page.getByRole('button', { name: 'Online store' }).click();
  await page.getByLabel('Client code').fill('MC');
  await page.getByRole('button', { name: /^Continue: / }).click();
  await page.waitForURL(/\/onboarding\/meta$/, E);
  await expect(page.getByText('Step 2 of 6', { exact: true })).toBeVisible(E);
  const pct2 = (await page.locator('[role=group] .font-mono').first().innerText()).trim();
  info.annotations.push({ type: 'percent após passo 1', description: pct2 });
  expect(Number.parseInt(pct2)).toBeGreaterThan(Number.parseInt(pct));
  expect(pct, 'conta nova nasce com 0 % (D10)').toBe('0%');
  expect(pct2, 'passo 1 preenchido = 17 %').toBe('17%');
  await tela(page, info, 'ob-01d-meta-step');
  // Save and exit (AGENCY) → tela de retomada
  await page.getByRole('button', { name: 'Save and exit' }).click();
  await page.waitForURL(/\/onboarding\/saved$/, E);
  await expect(page.getByRole('heading', { name: /setup is saved at step 2/ })).toBeVisible(E);
  await expect(page.getByText('Your other clients')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await semRolagemHorizontal(page, 'saved');
  await tela(page, info, 'ob-01e-saved-agency');
  await page.getByRole('link', { name: 'Continue setup' }).click();
  await page.waitForURL(/\/onboarding\/meta$/, E);
  // relogar cai no passo salvo
  await page.request.delete('/api/session');
  await login(page, email);
  await page.goto('/');
  await page.waitForURL(/\/onboarding\/meta$/, E);
  // /start não aparece mais (modo já respondido)
  await page.goto('/start');
  await page.waitForURL(/\/onboarding\/meta$/, E);
});

test('OB-02 /start OWN: "Log out" no lugar de Save and exit; relogar volta pro passo; sem /clients', async ({ page }, info) => {
  const c = await signup('own');
  await login(page, c.email);
  await page.goto('/');
  await page.waitForURL(/\/start$/, E);
  await page.locator('button[role=radio][value=OWN]').click();
  await expect(page.getByText('Next: set up your business')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
  await semSidebar(page);
  const out = page.getByRole('button', { name: 'Log out' });
  await expect(out).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Save and exit' })).toHaveCount(0);
  await tela(page, info, 'ob-02a-own-business');
  const me = await as(c).get('/auth/me');
  expect(me.data.user.accountMode).toBe('OWN');
  await out.click();
  await page.waitForURL(/\/login/, E);
  await tela(page, info, 'ob-02b-own-logout');
  await login(page, c.email);
  await page.goto('/clients');
  await page.waitForURL(/\/onboarding\/business$/, E);
});

test('OB-03 MEMBER e CLIENT convidados num workspace SETUP: "Setup in progress" com quem mexeu, sem /start, sem gate pro wizard', async ({ page }, info) => {
  const dono = await signup('dono', { agencyName: 'Dental Kirk QA', accountMode: 'AGENCY' });
  await as(dono).patch('/workspace', { onboardingStep: 2, businessType: 'LOCAL_BUSINESS' }); // grava onboardingUpdatedBy
  for (const role of ['MEMBER', 'CLIENT'] as const) {
    const m = await convidar(dono, role, role.toLowerCase());
    await page.request.delete('/api/session');
    await login(page, m.email);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: `${dono.name} is setting Dental Kirk QA up` })).toBeVisible(E);
    await expect(page.getByText(/Step 2 of 6/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await semSidebar(page);
    expect(page.url()).not.toMatch(/\/start|\/onboarding\//);
    await semRolagemHorizontal(page, `waiting ${role}`);
    await tela(page, info, `ob-03-waiting-${role.toLowerCase()}`);
    // o convidado abre o wizard só em leitura (sem gate que prenda)
    await page.goto('/onboarding/business');
    await expect(page.getByText('Only agency admins can change the setup')).toBeVisible(E);
    await expect(page.getByLabel('Business name')).toBeDisabled();
  }
});

test('OB-04 caminho de volta: Clients "Continue setup", Brain "Revisit setup", /onboarding, Settings "Edit setup"', async ({ page }, info) => {
  const c = await signup('volta', { agencyName: 'Lumen Bikes QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  const novo = await as(c).post('/workspaces', { name: 'Segundo Cliente QA' });
  expect(novo.status, JSON.stringify(novo.body)).toBe(201);
  // a sessão do BFF continua no 1º (LIVE)
  await login(page, c.email);
  await as(c).post('/workspace/tour/complete'); // o tour é testado à parte (item 3)
  await page.goto('/clients');
  await expect(page.getByText('Segundo Cliente QA')).toBeVisible(E);
  await expect(page.getByText(/Setup · step 1 of 6/).first()).toBeVisible();
  // bug 5 (frontend 22/10): o chip não espreme o nome; o nome pode truncar, mas o texto inteiro vai no `title`
  const nome = page.getByRole('button', { name: /Segundo Cliente QA/ }).first();
  await expect(nome).toHaveAttribute('title', 'Segundo Cliente QA');
  const dims = await nome.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  info.annotations.push({ type: 'nome no cartão', description: `scrollWidth ${dims.sw} clientWidth ${dims.cw} (${dims.sw > dims.cw + 1 ? 'trunca com title' : 'inteiro'})` });
  await tela(page, info, 'ob-04a-clients');
  await page.getByRole('button', { name: /Segundo Cliente QA/ }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
  await expect(page.getByText('Segundo Cliente QA').first()).toBeVisible(E);
  await tela(page, info, 'ob-04b-continue-setup');
  // volta pro 1º cliente (LIVE) pelo BFF e testa Brain → Revisit setup (modo edição) e Settings → Edit setup
  const sw = await page.request.put('/api/session', { data: { workspaceId: c.workspaceId }, headers: { authorization: `Bearer ${c.token}` } });
  expect(sw.ok(), await sw.text()).toBe(true);
  await page.goto('/brain');
  await page.getByRole('link', { name: 'Revisit setup' }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
  await expect(page.getByText('Client setup', { exact: true }).first()).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Save and exit' })).toBeVisible();
  await tela(page, info, 'ob-04c-revisit');
  await page.getByRole('button', { name: 'Save and exit' }).click();
  await page.waitForURL(/\/brain$/, E);
  await page.goto('/onboarding');
  await page.waitForURL(/\/onboarding\/business$/, E);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Edit setup' }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
});

test('OB-05 PT-BR: /start, wizard e tela de retomada', async ({ page, baseURL }, info) => {
  const c = await signup('pt');
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/');
  await page.waitForURL(/\/start$/, E);
  await expect(page.getByRole('heading', { name: 'Como você vai usar o HookMill?' })).toBeVisible(E);
  await tela(page, info, 'ob-05a-start-pt');
  await page.locator('button[role=radio][value=AGENCY]').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.waitForURL(/\/onboarding\/business$/, E);
  await expect(page.getByText('Passo 1 de 6', { exact: true })).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Salvar e sair' })).toBeVisible();
  await tela(page, info, 'ob-05b-business-pt');
  await page.getByRole('button', { name: 'Salvar e sair' }).click();
  await page.waitForURL(/\/onboarding\/saved$/, E);
  await expect(page.getByRole('link', { name: 'Continuar configuração' })).toBeVisible(E);
  await tela(page, info, 'ob-05c-saved-pt');
});

test('OB-06 API: signup nasce accountMode null + tourCompletedAt null; percent por conteúdo; AGENCY→OWN com 2 workspaces = 200', async () => {
  const c = await signup('api', { agencyName: 'Pct QA' });
  const a = as(c);
  const me = await a.get('/auth/me');
  expect(me.data.user.accountMode).toBeNull();
  expect(me.data.workspace.tourCompletedAt).toBeNull();
  expect(me.data.workspace.status).toBe('SETUP');
  const w0 = (await a.get('/workspace')).data;
  test.info().annotations.push({ type: 'percent/steps conta nova', description: `${w0.onboarding.percent}% ${JSON.stringify(w0.onboarding.steps.map((s: any) => `${s.key}:${s.state}`))} cap=${w0.monthlySpendCapUsd}` });
  // D10 (22/10): o % só conta os passos JÁ PASSADOS (antes do passo salvo): preencher o passo 1 e seguir pro 2 = 17 %
  await a.patch('/workspace', { businessType: 'ONLINE_STORE' });
  const w1a = (await a.get('/workspace')).data;
  test.info().annotations.push({ type: 'percent com business done e step 1', description: String(w1a.onboarding.percent) });
  await a.patch('/workspace', { onboardingStep: 2 });
  const w1 = (await a.get('/workspace')).data;
  expect(w0.onboarding.percent, 'D10: conta nova = 0 %').toBe(0);
  expect(w1.onboarding.percent, 'passo 1 preenchido e passado = 17 %').toBe(17);
  await a.patch('/workspace', { onboardingStep: 3 });
  expect((await a.get('/workspace')).data.onboarding.percent, 'passo 2 pulado: 17 %').toBe(17);
  expect((await a.patch('/auth/me', { accountMode: 'X' })).status).toBe(400);
  await a.post('/workspaces', { name: 'Outro' });
  const own = await a.patch('/auth/me', { accountMode: 'OWN' });
  expect(own.status, JSON.stringify(own.body)).toBe(200);
  expect(own.data.accountMode).toBe('OWN');
  expect((await a.get('/auth/me')).data.workspaces.length).toBe(2);
});
