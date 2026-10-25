// META_MODE=off (item 2): a API precisa estar no ar com META_MODE=off. Só roda com QA_META_OFF=1.
import { test, expect } from '@playwright/test';
import { as, criativoAprovado, login, prepararWorkspace, signup, tela } from './dev.ts';

test.skip(process.env.QA_META_OFF !== '1', 'precisa da API com META_MODE=off (QA_META_OFF=1)');
const E = { timeout: 60_000 };

test('OFF-01 META_MODE=off: passo some (5 passos), 1 → 3, Home sem bloco Meta, Settings sem Connections, API 503 off', async ({ page }, info) => {
  const c = await signup('off', { agencyName: 'Off QA', accountMode: 'AGENCY' });
  const a = as(c);
  const conn = await a.get('/meta/connection');
  info.annotations.push({ type: 'GET /meta/connection em off', description: `${conn.status} ${JSON.stringify(conn.body).slice(0, 120)}` });
  expect(conn.status, 'contrato §8: toda rota /meta = 503 META_NOT_CONFIGURED reason off').toBe(503);
  expect(conn.body.error.details.reason).toBe('off');
  for (const p of ['/meta/ads', '/meta/summary', '/meta/options', '/meta/publications']) { const r = await a.get(p); expect(r.status, p).toBe(503); expect(r.body.error.code, p).toBe('META_NOT_CONFIGURED'); }
  const cn = await a.post('/meta/connect', { returnTo: '/settings' });
  expect(cn.status).toBe(503);
  expect(cn.body.error.details.reason).toBe('off');
  const w = (await a.get('/workspace')).data;
  expect(w.onboarding.steps.find((s: any) => s.key === 'meta').enabled).toBe(false);
  info.annotations.push({ type: 'percent conta nova (off)', description: String(w.onboarding.percent) });
  await login(page, c.email);
  await page.goto('/onboarding/business');
  await expect(page.getByText('Step 1 of 5', { exact: true })).toBeVisible(E);
  await expect(page.getByText('Connect Meta')).toHaveCount(0);
  await tela(page, info, 'off-01a-business-5-passos');
  await page.getByLabel('Business name').fill('Off QA');
  await page.getByRole('button', { name: 'Online store' }).click();
  await page.getByLabel('Client code').fill('OFF');
  await page.getByRole('button', { name: /^Continue: / }).click();
  await page.waitForURL(/\/onboarding\/offer$/, E);
  await expect(page.getByText('Step 2 of 5', { exact: true })).toBeVisible(E);
  await tela(page, info, 'off-01b-offer-2-de-5');
  await prepararWorkspace(c, { live: true });
  await a.post('/workspace/tour/complete');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible(E);
  await expect(page.getByText('Waiting on you')).toBeVisible(E);
  await expect(page.getByText('No results here yet'), 'Home em off não deve mostrar o cartão da Meta').toHaveCount(0);
  await expect(page.getByText('Meta not connected'), 'Home em off sem chip Meta').toHaveCount(0);
  await tela(page, info, 'off-01c-home');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible(E);
  await expect(page.getByRole('link', { name: 'Manage' }), 'Settings em off sem painel Connections').toHaveCount(0);
  await tela(page, info, 'off-01d-settings');
  await page.goto('/iterate/new');
  await expect(page.getByText('Pick from your Meta account'), 'Iterate em off sem Pick from Meta').toHaveCount(0);
  await tela(page, info, 'off-01e-iterate');
  // publicar em off: 503 na API e a tela diz que a Meta não está disponível
  const off = (await a.get('/offers')).data[0];
  const cr = await criativoAprovado(c, off.id);
  const cm = await a.get(`/creatives/${cr.id}/meta`);
  expect(cm.status, 'GET /creatives/:id/meta em off').toBe(503);
  expect((await a.post(`/creatives/${cr.id}/meta/publish`, { dailyBudgetMinor: 1500, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com/' })).status).toBe(503);
  await page.goto(`/creatives/${cr.id}/send`);
  await expect(page.getByText("Meta isn't available on this server")).toBeVisible(E);
  await tela(page, info, 'off-01f-send');
  await page.goto(`/creatives/${cr.id}/review`);
  await page.waitForTimeout(1500);
  await expect(page.getByRole('link', { name: 'Publish to Meta' })).toHaveCount(0);
  await page.goto('/library');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('link', { name: 'Send to Meta' })).toHaveCount(0);
  await tela(page, info, 'off-01g-library');
  const tour = (await a.get('/workspace/tour')).data;
  expect(tour.stops).not.toContain('iterate');
});
