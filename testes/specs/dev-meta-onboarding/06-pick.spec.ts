// Item 5: Pick from Meta no Iterate (meta-v1 §3.2, D13): lista → POST /iterate { metaAdId } → campeão OWN/META → lote; reuso; novideo.
import { test, expect } from '@playwright/test';
import { as, conectarMeta, convidar, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, sql, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 90_000 };
const LONGO = { timeout: 240_000 };

async function contaPick(label: string) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await conectarMeta(c);
  return c;
}
const assentou = (b: any) => b.status === 'LAUNCHED' && b.phase === 'download';

test('PK-01 lista com verdict/trend → Iterate it → campeão OWN source META → plano → Generate → peças; repetir reaproveita o campeão', async ({ page }, info) => {
  const c = await contaPick('pick');
  const a = as(c);
  await login(page, c.email);
  await page.goto('/iterate/new');
  const card = page.locator('#t-winner');
  await expect(card).toContainText('From Mock Store (USD)', E);
  await expect(card).toContainText('Hook A — the pain');
  await expect(card.getByText(/Winner = spend ≥ \$50, ≥ 3 results/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Iterate it' })).toHaveCount(3);
  await expect(card.locator('[class*="grid-cols-[40px"]').first()).toHaveClass(/bg-brand-soft/);
  await expect(card.getByText('Working', { exact: true })).toBeVisible();
  await semRolagemHorizontal(page, 'iterate/new');
  await tela(page, info, 'pk-01a-lista');
  await card.getByRole('button', { name: /See all \d+ active ads/ }).click();
  await expect(card.getByRole('button', { name: 'Iterate it' })).toHaveCount(8, E);
  await expect(card.getByText('Tiring', { exact: true })).toBeVisible();
  await tela(page, info, 'pk-01b-lista-toda');
  await card.getByRole('button', { name: 'Iterate it' }).first().click();
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, E);
  const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  await page.waitForTimeout(1500);
  await tela(page, info, 'pk-01c-analisando');
  const gerar = page.getByRole('button', { name: /^Generate \d+ pieces$/ });
  await expect(gerar).toBeVisible(LONGO);
  await tela(page, info, 'pk-01d-plano');
  const [ch] = await sql(`select id, rights, status, meta_ad_id, meta_ad_account_id, name, video_file_id from champions where workspace_id = $1`, [c.workspaceId]);
  expect(ch.rights).toBe('OWN');
  expect(ch.meta_ad_id).toBe('mock_ad_1');
  expect(ch.meta_ad_account_id).toBe('act_mock_1');
  expect(ch.name).toBe('Hook A — the pain');
  expect(ch.video_file_id).not.toBeNull();
  const det = (await a.get(`/champions/${ch.id}`)).data;
  expect(det.sources).toContain('META');
  expect(det.metaAd).toEqual({ adId: 'mock_ad_1', adAccountId: 'act_mock_1' });
  const lote = (await a.get(`/iterate/${batchId}`)).data;
  expect(lote.source?.fromMeta, JSON.stringify(lote.source)).toBe(true);
  info.annotations.push({ type: 'lote', description: `pieces ${lote.pieces.length}; source ${JSON.stringify(lote.source).slice(0, 160)}` });
  await gerar.click();
  await expect.poll(async () => { const b = (await a.get(`/iterate/${batchId}`)).data; return assentou(b) ? `ok ${b.summary?.failed}` : b.status; }, LONGO).toMatch(/^ok/);
  const zip = page.getByRole('button', { name: 'Download zip' });
  const cont = page.getByRole('link', { name: 'Continue to download' }).or(page.getByRole('button', { name: 'Continue to download' })).first();
  await expect(zip.or(cont).first()).toBeVisible(LONGO);
  await tela(page, info, 'pk-01e-pecas');
  // a lista marca o anúncio já importado e reaproveita o campeão
  await page.goto('/iterate/new');
  await expect(card.getByRole('button', { name: 'Iterate again' })).toBeVisible(E);
  expect((await a.get('/meta/ads?limit=1')).data[0].championId).toBe(ch.id);
  await card.getByRole('button', { name: 'Iterate again' }).click();
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, E);
  const batch2 = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  expect(batch2).not.toBe(batchId);
  await expect(page.getByRole('button', { name: /^Generate \d+ pieces$/ })).toBeVisible(LONGO);
  const rows = await sql(`select id from champions where workspace_id = $1 and meta_ad_id = 'mock_ad_1'`, [c.workspaceId]);
  expect(rows.length, 'um campeão só pro mesmo anúncio').toBe(1);
  const imports = await sql(`select count(*)::int n from jobs where workspace_id = $1 and type = 'META_IMPORT'`, [c.workspaceId]);
  info.annotations.push({ type: 'jobs META_IMPORT', description: String(imports[0].n) });
  expect(imports[0].n, 'não baixa de novo').toBe(1);
  await tela(page, info, 'pk-01f-reuso');
});

test('PK-02 mock_ad_novideo: import falha com mensagem legível (upload_video), lote ANALYSIS_FAILED; 404 e OFFER_REQUIRED na API', async ({ page }, info) => {
  const c = await contaPick('novideo');
  const a = as(c);
  await login(page, c.email);
  await page.goto('/iterate/new?metaAdId=mock_ad_novideo');
  const card = page.locator('#t-winner');
  await card.getByRole('button', { name: /See all \d+ active ads/ }).click();
  const linha = card.locator('[class*="grid-cols-[40px"]', { hasText: 'video not downloadable' });
  await expect(linha).toHaveClass(/shadow-\[0_0_0_1\.5px/, E); // pré-selecionado pela query
  await linha.getByRole('button', { name: 'Iterate it' }).click();
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, E);
  const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  await expect.poll(async () => (await a.get(`/iterate/${batchId}`)).data.status, LONGO).toBe('ANALYSIS_FAILED');
  const b = (await a.get(`/iterate/${batchId}`)).data;
  info.annotations.push({ type: 'erro do lote', description: JSON.stringify(b.error).slice(0, 300) });
  expect(b.error.code).toBe('META_VIDEO_UNAVAILABLE');
  await expect(page.getByRole('link', { name: 'Upload another file' })).toBeVisible(E);
  const texto = await page.locator('main').innerText();
  info.annotations.push({ type: 'tela da falha', description: texto.replace(/\s+/g, ' ').slice(0, 400) });
  expect(texto).not.toMatch(/META_VIDEO_UNAVAILABLE|undefined|\[object/);
  expect(texto).toContain('We could not download the video of that ad from Meta');
  await semRolagemHorizontal(page, 'novideo');
  await tela(page, info, 'pk-02-novideo');
  // API
  expect((await a.post('/iterate', { metaAdId: 'mock_ad_999' })).status).toBe(404);
  const v = await a.post('/iterate', { metaAdId: 'mock_ad_2', uploadId: 'x' });
  expect(v.status).toBe(400);
  await a.post('/offers', { name: 'Segunda oferta', language: 'en', what: 'x', promise: 'y' });
  const o = await a.post('/iterate', { metaAdId: 'mock_ad_2' });
  expect(o.status).toBe(422);
  expect(o.body.error.code).toBe('OFFER_REQUIRED');
  await page.goto('/iterate/new');
  await expect(page.locator('#iter-offer')).toBeVisible(E); // seletor de oferta (a última usada vem pré-escolhida)
  await page.locator('#iter-offer').click();
  await page.getByRole('option', { name: 'Segunda oferta' }).click();
  await expect(page.locator('#t-winner').getByRole('button', { name: 'Iterate it' }).first()).toBeEnabled();
  await tela(page, info, 'pk-02b-duas-ofertas');
});

test('PK-03 CLIENT: vê a lista; Iterate it é barrado (403 na API)', async ({ page }, info) => {
  const dono = await contaPick('pickcli');
  const cli = await convidar(dono, 'CLIENT', 'cli');
  await as(cli).post('/workspace/tour/complete');
  expect((await as(cli).post('/iterate', { metaAdId: 'mock_ad_1' })).status).toBe(403);
  expect((await as(cli).post('/meta/sync')).status).toBe(403);
  expect((await as(cli).get('/meta/ads')).status).toBe(200);
  await login(page, cli.email);
  await page.goto('/iterate/new');
  const btn = page.locator('#t-winner').getByRole('button', { name: 'Iterate it' }).first();
  const visivel = await btn.isVisible({ timeout: 15_000 }).catch(() => false);
  info.annotations.push({ type: 'CLIENT em /iterate/new', description: visivel ? `botão Iterate it visível, enabled=${await btn.isEnabled()}` : 'sem botão / tela diferente' });
  if (visivel && (await btn.isEnabled())) {
    await btn.click();
    await page.waitForTimeout(1500);
    const t = await page.locator('body').innerText();
    info.annotations.push({ type: 'CLIENT clicou', description: /can't do this|403|role/i.test(t) ? 'toast de papel' : `url ${page.url()}` });
  }
  await tela(page, info, 'pk-03-client');
});

test('PK-04 PT-BR: "De Mock Store (USD)" e "Iterar este"', async ({ page, baseURL }, info) => {
  const c = await contaPick('pickpt');
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/iterate/new');
  await expect(page.locator('#t-winner')).toContainText('De Mock Store (USD)', E);
  await expect(page.locator('#t-winner').getByRole('button', { name: 'Iterar este' }).first()).toBeVisible();
  await tela(page, info, 'pk-04-pt');
});
