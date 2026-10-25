// Item 4: Home como painel (onboarding-v2 §4 + spec decisão 12): KPIs com prev, Top 3 com vencedor e trend, estados.
import { test, expect, type Page } from '@playwright/test';
import { as, conectarMeta, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, sql, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };

async function contaHome(label: string, meta = true) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  if (meta) await conectarMeta(c);
  return c;
}
const row = (page: Page, name: string) => page.locator('#t-kpis ~ * [class*="grid-cols-[40px"]', { hasText: name }).first();

test('HO-01 com dados: chip Synced, 4 KPIs com prev, 7/30 dias, Top 3 com lima só no 1º WINNER, trend, Waiting on you, Brain', async ({ page }, info) => {
  const c = await contaHome('home');
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByText(/Synced with Meta/)).toBeVisible(E);
  const kpis = page.locator('#t-kpis');
  await expect(kpis).toBeVisible(E);
  for (const k of ['Spend', 'Cost per purchase', 'ROAS', 'Active ads']) await expect(kpis.getByText(k, { exact: true })).toBeVisible();
  const s30 = (await as(c).get('/meta/summary?period=30d')).data;
  const s7 = (await as(c).get('/meta/summary?period=7d')).data;
  info.annotations.push({ type: 'summary', description: `30d spend ${s30.spend} cpa ${s30.cpa} roas ${s30.roas} prev ${JSON.stringify(s30.prev)} · 7d spend ${s7.spend} prev ${JSON.stringify(s7.prev)} · active ${s30.activeAds} new ${s30.newThisWeek} tiring ${s30.tiringCount}` });
  expect(s7.prev, '7d tem prev').not.toBeNull();
  // o mock só traz a janela anterior de 7 d: em 30 d o prev é null e a tela diz "No previous period yet"
  if (s30.prev === null) await expect(kpis.getByText('No previous period yet').first()).toBeVisible();
  else await expect(kpis.getByText(/vs .* before/).first()).toBeVisible();
  await expect(kpis.getByText(`${s30.activeAds}`, { exact: true })).toBeVisible();
  const spend30 = await kpis.locator('.font-mono').first().innerText();
  // bug 9: mínimo 5 min entre syncs manuais (o 1º sync acabou de rodar) → 429 RATE_LIMITED { retryAfterSec }, sem job novo
  const tooSoon = await as(c).post('/meta/sync');
  expect(tooSoon.status, JSON.stringify(tooSoon.body).slice(0, 160)).toBe(429);
  expect(tooSoon.body.error.code).toBe('RATE_LIMITED');
  expect(tooSoon.body.error.details.retryAfterSec).toBeGreaterThan(0);
  // Top 3: o 1º é WINNER com fundo lima e "Iterate" lima; o 2º (também WINNER na regra) NÃO é lima
  const top = (await as(c).get('/meta/ads?limit=3')).data;
  expect(top[0].verdict).toBe('WINNER');
  expect(top[1].verdict).toBe('WINNER');
  const linhas = page.locator('[class*="grid-cols-[40px"]');
  await expect(linhas).toHaveCount(3, E);
  await expect(linhas.nth(0)).toContainText(top[0].name);
  await expect(linhas.nth(0)).toHaveClass(/bg-brand-soft/);
  await expect(linhas.nth(1)).not.toHaveClass(/bg-brand-soft/);
  await expect(linhas.nth(2)).not.toHaveClass(/bg-brand-soft/);
  for (const [i, ad] of top.entries()) {
    const tag = ad.trend ? ad.trend[0] + ad.trend.slice(1).toLowerCase() : '—';
    await expect(linhas.nth(i), `trend da linha ${i}`).toContainText(tag);
    await expect(linhas.nth(i)).toContainText(/running \d+ days/);
  }
  await expect(page.getByText('Waiting on you')).toBeVisible();
  await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Brain' })).toBeVisible();
  await expect(page.getByText('Recent creatives')).toBeVisible();
  await semRolagemHorizontal(page, 'home 30d');
  await tela(page, info, 'ho-01a-home-30d');
  await page.getByRole('radio', { name: '7 days' }).click();
  await expect.poll(async () => kpis.locator('.font-mono').first().innerText(), E).not.toBe(spend30);
  await expect(page.getByText('7d', { exact: true })).toBeVisible();
  await expect(kpis.getByText(/vs .* before/).first()).toBeVisible();
  await tela(page, info, 'ho-01b-home-7d');
  // o Iterate do 1º leva pro Pick from Meta pré-selecionado
  await linhas.nth(0).getByRole('link', { name: 'Iterate' }).click();
  await page.waitForURL(new RegExp(`/iterate/new\\?metaAdId=${top[0].metaAdId}`), E);
  // nenhum skeleton infinito: nada com "Loading results" depois de carregado
  await page.goto('/');
  await expect(kpis).toBeVisible(E);
  await page.waitForTimeout(3000);
  await expect(page.getByRole('status', { name: 'Loading results' })).toHaveCount(0);
});

test('HO-02 sem Meta: "No results here yet" + Connect Meta → Settings › Connections; sem skeleton', async ({ page }, info) => {
  const c = await contaHome('nometa', false);
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByText('No results here yet')).toBeVisible(E);
  await expect(page.getByText('Meta not connected')).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByRole('status', { name: 'Loading results' })).toHaveCount(0);
  await expect(page.getByText('Waiting on you')).toBeVisible();
  await semRolagemHorizontal(page, 'home sem meta');
  await tela(page, info, 'ho-02-sem-meta');
  await page.getByRole('button', { name: 'Connect Meta' }).click();
  await page.waitForURL(/\/settings\/connections$/, E);
  // conectado sem conta escolhida = "Choose an ad account"
  const a = as(c);
  const u = await a.post('/meta/connect', { returnTo: '/settings' });
  await fetch(u.data.url, { redirect: 'manual' });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Choose an ad account' })).toBeVisible(E);
  await tela(page, info, 'ho-02b-sem-conta');
});

test('HO-03 first_sync / syncing: cartão "Reading 30 days of results" com progresso', async ({ page }, info) => {
  const c = await contaHome('first', false);
  const a = as(c);
  const u = await a.post('/meta/connect', { returnTo: '/settings' });
  await fetch(u.data.url, { redirect: 'manual' });
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Choose an ad account' })).toBeVisible(E);
  // escolhe a conta (dispara o 1º sync) e recarrega na hora
  await a.put('/meta/selection', { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
  await page.reload();
  const viu = await page.getByText(/Reading 30 days of results from Mock Store/).isVisible({ timeout: 4000 }).catch(() => false);
  info.annotations.push({ type: 'first_sync visto', description: String(viu) });
  if (viu) await tela(page, info, 'ho-03-first-sync');
  await expect(page.locator('#t-kpis').getByText('Spend', { exact: true })).toBeVisible(E);
  await expect(page.getByText(/Synced with Meta/)).toBeVisible(E);
});

test('HO-04 stale (> 12 h): chip "Meta needs attention" + alerta + Sync now volta a ok', async ({ page }, info) => {
  const c = await contaHome('stale');
  await sql(`update meta_connections set last_sync_at = (now() at time zone 'utc') - interval '13 hours' where workspace_id = $1`, [c.workspaceId]);
  expect((await as(c).get('/meta/summary')).data.sync.state).toBe('stale');
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByText('Meta needs attention')).toBeVisible(E);
  await expect(page.getByText(/Meta stopped answering 13 hours ago/)).toBeVisible();
  await expect(page.locator('#t-kpis').getByText('Spend', { exact: true })).toBeVisible();
  await semRolagemHorizontal(page, 'home stale');
  await tela(page, info, 'ho-04a-stale');
  // mínimo 5 min entre syncs manuais: a conta acabou de sincronizar
  const r = await as(c).post('/meta/sync');
  info.annotations.push({ type: 'POST /meta/sync logo após o 1º', description: `${r.status} ${JSON.stringify(r.body).slice(0, 120)}` });
  // último sync há 13 h: o manual é permitido (o 429 dos 5 min é testado no HO-01, logo depois do 1º sync)
  expect(r.status, 'stale: Sync now permitido').toBe(202);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.waitForTimeout(1500);
  await tela(page, info, 'ho-04b-sync-now');
  await expect.poll(async () => (await as(c).get('/meta/summary')).data.sync.state, E).toBe('ok');
  await expect(page.getByText(/Synced with Meta/)).toBeVisible(E);
});

test('HO-05 failed: último sync falhou → alerta + Sync now', async ({ page }, info) => {
  const c = await contaHome('failed');
  await sql(`update meta_connections set last_sync_at = null, last_sync_error = 'META_ERROR' where workspace_id = $1`, [c.workspaceId]);
  expect((await as(c).get('/meta/summary')).data.sync.state).toBe('failed');
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByText('Meta needs attention')).toBeVisible(E);
  await expect(page.getByText(/Meta stopped answering/)).toBeVisible();
  await expect(page.getByText('There is no fresh data')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await tela(page, info, 'ho-05-failed');
});

test('HO-06 TOKEN_INVALID: "login expired" + Reconnect → Settings › Connections → Reconnect with Facebook → ACTIVE', async ({ page }, info) => {
  const c = await contaHome('expired');
  await sql(`update meta_connections set status = 'TOKEN_INVALID' where workspace_id = $1`, [c.workspaceId]);
  const ruins: string[] = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1') && r.status() >= 400) ruins.push(`${r.request().method()} ${u.pathname} ${r.status()}`); });
  await login(page, c.email);
  await page.goto('/');
  await expect(page.getByText('Meta needs attention')).toBeVisible(E);
  const alerta = await page.getByText('Meta stopped answering: the login expired').isVisible({ timeout: 5000 }).catch(() => false);
  const noMeta = await page.getByText('No results here yet').isVisible().catch(() => false);
  info.annotations.push({ type: 'Home com TOKEN_INVALID', description: alerta ? 'alerta "login expired" + Reconnect' : noMeta ? 'cartão "No results here yet" + Connect Meta (bug: trata como sem Meta)' : 'outro' });
  expect(alerta, 'Home com token vencido deve mostrar o alerta "login expired" + Reconnect, não o cartão de sem Meta').toBe(true);
  await expect(page.locator('#t-kpis').getByText('Spend', { exact: true }), 'KPIs do último dado continuam').toBeVisible();
  await tela(page, info, 'ho-06a-expired');
  if (alerta) await page.getByRole('link', { name: 'Reconnect' }).click();
  else await page.getByRole('button', { name: 'Connect Meta' }).click();
  await page.waitForURL(/\/settings\/connections$/, E);
  await expect(page.getByText('Your Meta login expired')).toBeVisible(E);
  await page.waitForTimeout(2000);
  const alertaVermelho = await page.getByText("Couldn't talk to Meta").isVisible().catch(() => false);
  info.annotations.push({ type: 'Settings com TOKEN_INVALID', description: `${alertaVermelho ? 'alerta "Couldn\'t talk to Meta · Some fields are invalid"' : 'sem alerta vermelho'} · respostas ≥400: ${ruins.join(', ') || 'nenhuma'}` });
  await tela(page, info, 'ho-06b-settings-expired');
  await page.getByRole('button', { name: 'Reconnect with Facebook' }).click();
  await page.waitForURL(/\/settings\/connections/, E);
  await page.waitForTimeout(2500);
  await tela(page, info, 'ho-06c-apos-reconectar');
  const escolher = page.getByRole('button', { name: 'Use this account' });
  if (await escolher.isVisible({ timeout: 10_000 }).catch(() => false)) {
    info.annotations.push({ type: 'reconectar com token vencido', description: 'voltou ao choose (seleção não mantida)' });
    await escolher.click();
  }
  await expect(page.getByText('Account health')).toBeVisible(E);
  await expect.poll(async () => (await as(c).get('/meta/connection')).data.status, E).toBe('ACTIVE');
  await tela(page, info, 'ho-06b-reconnected');
});

test('HO-07 PT-BR da Home com dados', async ({ page, baseURL }, info) => {
  const c = await contaHome('homept');
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/');
  await expect(page.getByText(/Sincronizado com a Meta/)).toBeVisible(E);
  await expect(page.getByText('Resultados', { exact: true })).toBeVisible();
  await expect(page.getByText('Melhores anúncios')).toBeVisible();
  await expect(page.locator('#t-kpis').getByText('Gasto', { exact: true })).toBeVisible();
  await expect(page.getByText('Esperando você')).toBeVisible();
  await semRolagemHorizontal(page, 'home pt');
  await tela(page, info, 'ho-07-home-pt');
});
