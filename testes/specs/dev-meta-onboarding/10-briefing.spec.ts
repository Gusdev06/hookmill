// Briefing v2 (docs/contratos/briefing-leitura-v2.md §4.3-4.4, §8) em MOCK (fake Claude: mock-vision, mock-login, mock-unreadable).
// Sem Claude real, sem custo. Checklist de 6 etapas, "Read from", origem por campo, login_wall + colar texto, readMeta no POST e no PATCH.
import { test, expect } from '@playwright/test';
import { as, login, prepararWorkspace, semRolagemHorizontal, signup, tela } from './dev.ts';

test.use({ actionTimeout: 30_000 });
const E = { timeout: 90_000 };
const VISION = 'https://mock-vision.example.com/sales';

async function contaLive(label: string) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  return c;
}

test('BR-01 wizard New from link (mock-vision): checklist de 6 etapas com progresso/eta, Read from, origem por campo, readMeta persistido no POST /offers', async ({ page }, info) => {
  const c = await contaLive('brief');
  const a = as(c);
  await login(page, c.email);
  await page.goto('/creatives/new');
  await page.getByRole('radio', { name: 'New from link' }).or(page.getByText('New from link')).first().click();
  await page.getByLabel('Sales page link').fill(VISION);
  // o job da leitura (POST /offers/extract) pra conferir as 6 etapas pela API; o mock termina em ~1 s, a tela passa rápido
  const jobP = page.waitForResponse((r) => r.url().endsWith('/offers/extract') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Read page' }).click();
  const LABELS = ['Fetching the page', 'Loading the page in a browser', 'Reading checkout, pricing and about pages', 'Reading images and banners', 'Pulling promise, audience, pains and proof', 'Detecting content language'];
  const vistos = new Set<string>();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && vistos.size < 6) {
    const txt = await page.locator('main').innerText().catch(() => '');
    for (const l of LABELS) if (txt.includes(l)) vistos.add(l);
    if (vistos.size && !(await tela(page, info, 'br-01a-checklist').then(() => false).catch(() => false))) { /* 1 tela */ }
    if (txt.includes('Filled from the page')) break;
    await page.waitForTimeout(150);
  }
  info.annotations.push({ type: 'etapas vistas na tela', description: `${vistos.size}/6: ${[...vistos].join(' · ')}` });
  const jobRes = await (await jobP).json();
  const jobId = jobRes.data.id;
  await expect.poll(async () => (await a.get(`/jobs/${jobId}`)).data.status, E).toBe('SUCCEEDED');
  const jobDone = (await a.get(`/jobs/${jobId}`)).data;
  expect(jobDone.checklist.map((x: any) => x.key)).toEqual(['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images', 'extracting', 'detecting_language']);
  expect(jobDone.checklist.every((x: any) => x.done)).toBe(true);
  expect(jobDone.output.readMode).toBe('vision');
  info.annotations.push({ type: 'job', description: `progress ${jobDone.progress} etaSec ${jobDone.etaSec} output.pages ${jobDone.output.pages?.length} imagesRead ${jobDone.output.imagesRead?.length} costUsd ${jobDone.output.costUsd}` });
  await expect(page.getByText('Filled from the page. Check it before you continue.')).toBeVisible(E);
  await expect(page.getByText(/Read from: main page, checkout · 2 images/)).toBeVisible();
  await expect(page.getByText(/From .*image 1/).first()).toBeVisible();
  await expect(page.getByText(/From (page|main page|checkout)/).first()).toBeVisible();
  await semRolagemHorizontal(page, 'offer lida');
  await tela(page, info, 'br-01b-lido');
  // job: 6 chaves no checklist, output v2
  await page.locator('[data-primary]').first().click();
  await page.waitForURL(/\/creatives\/[^/]+\/scripts/, E);
  const offers = (await a.get('/offers')).data;
  const of = offers.find((o: any) => o.sourceUrl === VISION) ?? offers[0];
  info.annotations.push({ type: 'readMeta salvo', description: JSON.stringify(of.readMeta).slice(0, 300) });
  expect(of.readMeta?.readMode).toBe('vision');
  expect(of.readMeta.pages.map((p: any) => p.role)).toEqual(['main', 'checkout']);
  expect(of.readMeta.imagesRead.length).toBe(2);
  expect(of.readMeta.fieldOrigins.offerAndPrice[0].imageIndex).toBe(1);
  expect(typeof of.readMeta.costUsd).toBe('number');
  expect(of.readMeta.readAt).toBeTruthy();
  expect(JSON.stringify(of.readMeta)).not.toMatch(/base64|data:image/);
  const one = (await a.get(`/offers/${of.id}`)).data;
  expect(one.readMeta?.readMode).toBe('vision');
});

test('BR-02 login_wall (mock-login) e unreadable: frase certa + colar texto → readMode pasted (2 etapas)', async ({ page }, info) => {
  const c = await contaLive('login');
  const a = as(c);
  await login(page, c.email);
  await page.goto('/creatives/new');
  await page.getByRole('radio', { name: 'New from link' }).or(page.getByText('New from link')).first().click();
  await page.getByLabel('Sales page link').fill('https://mock-login.example.com/members');
  await page.getByRole('button', { name: 'Read page' }).click();
  await expect(page.getByText('This page is behind a login. Paste the page text, or use the public sales page link.')).toBeVisible(E);
  await expect(page.locator('#paste')).toBeVisible();
  await tela(page, info, 'br-02a-login-wall');
  await page.locator('#paste').fill('Orbit Budget finds forgotten subscriptions. Save $300 a year. Start your free trial today. 4.8 stars from 2,000 reviews.');
  await page.getByRole('button', { name: 'Read pasted text' }).click();
  await expect(page.getByText('Filled from the page. Check it before you continue.')).toBeVisible(E);
  await expect(page.getByText('Read from the pasted text')).toBeVisible();
  await tela(page, info, 'br-02b-pasted');
  await page.locator('[data-primary]').first().click();
  await page.waitForURL(/\/creatives\/[^/]+\/scripts/, E);
  const of = (await a.get('/offers')).data[0];
  expect(of.readMeta?.readMode).toBe('pasted');
  expect(of.readMeta.pages.length).toBe(1);
  // unreadable sem detalhe → frase genérica + colar
  const r = await a.post('/offers/extract', { url: 'https://mock-unreadable.example.com/x' });
  info.annotations.push({ type: 'POST /offers/extract mock-unreadable', description: `${r.status} ${JSON.stringify(r.body).slice(0, 160)}` });
});

test('BR-03 Offers: Re-read page (mock-vision) → From page → Save brief manda readMeta no PATCH; GET devolve; PATCH readMeta null limpa', async ({ page }, info) => {
  const c = await contaLive('reread');
  const a = as(c);
  const of = (await a.get('/offers')).data[0];
  expect(of.readMeta).toBeNull();
  await a.patch(`/offers/${of.id}`, { sourceUrl: VISION });
  await login(page, c.email);
  await page.goto('/offers');
  await page.getByRole('button', { name: 'Re-read page' }).first().click();
  await expect(page.getByText('New brief read from the page. Check the fields marked “From page” and save.')).toBeVisible(E);
  await expect(page.getByText(/Read from: main page, checkout · 2 images/)).toBeVisible();
  await tela(page, info, 'br-03a-reread');
  await page.getByRole('button', { name: 'Save brief' }).first().click();
  await expect(page.getByText('Brief saved')).toBeVisible(E);
  await expect.poll(async () => (await a.get(`/offers/${of.id}`)).data.readMeta?.readMode, E).toBe('vision');
  await page.reload();
  await expect(page.getByText(/Read from: main page, checkout · 2 images/)).toBeVisible(E);
  await tela(page, info, 'br-03b-persistido');
  const clear = await a.patch(`/offers/${of.id}`, { readMeta: null });
  expect(clear.status).toBe(200);
  expect(clear.data.readMeta).toBeNull();
});

test('BR-04 onboarding passo 1 "Read the site" (mock-vision) com oferta existente → reread + PATCH readMeta → passo 3 mostra origens', async ({ page }, info) => {
  const c = await signup('obread', { agencyName: 'Read QA', accountMode: 'AGENCY' });
  const a = as(c);
  const off = await a.post('/offers', { name: 'Existing', language: 'en' });
  expect(off.status).toBe(201);
  await login(page, c.email);
  await page.goto('/onboarding/business');
  await page.getByLabel('Website address').fill(VISION);
  await page.getByRole('button', { name: 'Read the site' }).click();
  await expect(page.getByText("Read the site. You'll check what we found in steps 3 and 4.")).toBeVisible(E);
  await expect(page.getByText(/Read from: main page, checkout · 2 images/)).toBeVisible();
  await tela(page, info, 'br-04a-step1-read');
  await expect.poll(async () => (await a.get(`/offers/${off.data.id}`)).data.readMeta?.readMode, E).toBe('vision');
  const o = (await a.get(`/offers/${off.data.id}`)).data;
  expect(o.what).toBeTruthy();
  await page.getByLabel('Business name').fill('Read QA');
  await page.getByRole('button', { name: 'Online store' }).click();
  await page.getByLabel('Client code').fill('RQ');
  await page.getByRole('button', { name: /^Continue: / }).click();
  await page.waitForURL(/\/onboarding\/meta$/, E);
  await page.goto('/onboarding/offer');
  const o2 = (await a.get(`/offers/${off.data.id}`)).data;
  info.annotations.push({ type: 'oferta após o passo 1', description: `fieldSources ${JSON.stringify(o2.fieldSources)} readMode ${o2.readMeta?.readMode} origins ${Object.keys(o2.readMeta?.fieldOrigins ?? {}).join(',')}` });
  await expect(page.getByLabel('What it is')).toHaveValue(/Mock-vision/, E);
  const tags = await page.getByText(/From .*(main page|checkout|image)/).count();
  info.annotations.push({ type: 'tags de origem no passo 3', description: String(tags) });
  expect(tags, 'passo 3 deve mostrar a origem por campo (readMeta.fieldOrigins) — contrato §4.4').toBeGreaterThan(0);
  await semRolagemHorizontal(page, 'step 3 origens');
  await tela(page, info, 'br-04b-step3-origens');
});

test('BR-05 API: POST /offers com readMeta persiste; GET /offers lista readMeta; texto colado = 2 etapas', async () => {
  const c = await contaLive('api');
  const a = as(c);
  const rm = { readMode: 'http', pages: [{ url: 'https://x.example.com/', role: 'main', via: 'http', chars: 100 }], imagesRead: [], fieldOrigins: { what: [{ role: 'main', url: 'https://x.example.com/' }] }, costUsd: 0.01, readAt: new Date().toISOString() };
  const r = await a.post('/offers', { name: 'Com readMeta', language: 'en', what: 'x', promise: 'y', readMeta: rm });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.data.readMeta.readMode).toBe('http');
  const list = (await a.get('/offers')).data;
  expect(list.find((o: any) => o.id === r.data.id).readMeta.fieldOrigins.what[0].role).toBe('main');
  const ex = await a.post('/offers/extract', { pageText: 'Orbit Budget finds forgotten subscriptions. Save money every month. Start your free trial.' });
  expect(ex.status, JSON.stringify(ex.body)).toBe(202);
  const jobId = ex.data.job?.id ?? ex.data.id;
  await expect.poll(async () => (await a.get(`/jobs/${jobId}`)).data?.status, E).toMatch(/DONE|SUCCEEDED|READY|COMPLETED/);
  const job = (await a.get(`/jobs/${jobId}`)).data;
  test.info().annotations.push({ type: 'pasted job', description: `${job.status} checklist ${JSON.stringify(job.checklist?.map((x: any) => `${x.key}:${x.done}`))} readMode ${job.output?.readMode}` });
  expect(job.output.readMode).toBe('pasted');
  expect(job.checklist.every((x: any) => x.done)).toBe(true);
});
