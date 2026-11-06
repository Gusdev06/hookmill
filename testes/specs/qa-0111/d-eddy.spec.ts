// Onboarding com o Eddy (NEXT_PUBLIC_ONBOARDING_EDDY=on) num cliente novo em SETUP, MSW. Dono: maquina-qa.
import { test, expect } from '@playwright/test';
import { coletarErros, login, tela } from './ajuda.ts';

test('Eddy: cliente novo abre a conversa (não o wizard), lê o site e mostra o card do negócio', async ({ page }, info) => {
  const erros = coletarErros(page);
  const patches: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && /\/workspace$/.test(r.url())) patches.push(r.postData() ?? ''); });
  await login(page);
  const tok = (await (await page.request.get('/api/session')).json()).accessToken as string;
  const r = await page.request.post('/api/session/client', { data: { name: 'QA Eddy Co' }, headers: { authorization: `Bearer ${tok}` } });
  expect(r.ok(), await r.text()).toBe(true);
  await page.goto('/onboarding');
  // conta sem accountMode: /start pergunta Agência x Só eu (onboarding-v2 §3.1)
  const soEu = page.getByText('Just me', { exact: true });
  if (await soEu.waitFor({ timeout: 20_000 }).then(() => true, () => false)) {
    await soEu.click();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByText(/Hi, I'm Eddy/)).toBeVisible({ timeout: 60_000 });
  await tela(page, info, 'd-eddy-oi');
  // no MSW as 3 ofertas do mock valem pra todo workspace → siteDone (eddy-onboarding.tsx:189) e a conversa abre no card do negócio
  const site = page.getByLabel('Website address');
  const card = page.getByText(/Here's the business as I read it/);
  const qual = await Promise.race([site.waitFor({ timeout: 60_000 }).then(() => 'site'), card.waitFor({ timeout: 60_000 }).then(() => 'card')]);
  console.log('Eddy abriu em:', qual);
  if (qual === 'site') {
    await site.fill('https://example.com');
    await page.getByRole('button', { name: 'Read the site' }).click();
    await expect(card.or(page.getByText(/I couldn't read/))).toBeVisible({ timeout: 120_000 });
  }
  await tela(page, info, 'd-eddy-negocio');
  // preenche o nome e o resultado, confirma
  const linhaNome = page.locator('div').filter({ has: page.getByText('Name', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Add' }) }).last();
  await linhaNome.getByRole('button', { name: 'Add' }).click();
  await linhaNome.locator('input').first().fill('QA Eddy Co');
  await linhaNome.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('radio', { name: 'Purchase' }).or(page.getByRole('button', { name: 'Purchase' })).first().click();
  await page.waitForTimeout(1200);
  const ok = page.getByRole('button', { name: 'Looks right' }).first();
  await expect(ok).toBeEnabled({ timeout: 15_000 });
  await ok.click();
  await page.waitForTimeout(2500);
  expect(patches.some((b) => b.includes('"confirm":"business"')), `PATCH /workspace sem confirm: ${patches.join(' | ')}`).toBe(true);
  await tela(page, info, 'd-eddy-depois-confirmar');
  console.log('PATCH /workspace:', patches, '\nerros:', erros);
  // composer (barra de baixo) inteiro na tela
  const comp = page.getByLabel('Your answer');
  const bb = await comp.boundingBox();
  if (bb) expect(bb.y + bb.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
});
