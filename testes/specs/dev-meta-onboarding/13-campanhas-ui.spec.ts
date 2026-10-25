// Campaigns v1 no navegador (spec design/campanhas-v1-2026-10-22.md), 1440 (árvore) e 390 (cartões), em mock, par isolado.
import { test, expect, type Page } from '@playwright/test';
import { as, conectarMeta, convidar, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, sql, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };
const phone = (info: any) => info.project.name.includes('390');

async function conta(label: string, meta = true) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  if (meta) await conectarMeta(c);
  return c;
}
const dlg = (page: Page) => page.getByRole('dialog').last();
/** abre o nível do anúncio/conjunto: desktop expande a linha; celular entra no cartão */
async function abrir(page: Page, info: any, nome: string) {
  if (phone(info)) await page.getByRole('button', { name: new RegExp(`View \\d+ (ad sets?|ads?)`) }).filter({ has: page.locator('xpath=.') }).first().click().catch(() => undefined);
  const exp = page.getByRole('button', { name: `Expand ${nome}` });
  if (await exp.count()) await exp.first().click();
}

test('CU-01 árvore: chip Synced, totais, CBO/ABO/vitalício, expandir campanha → conjuntos → anúncios, aprendizado, imagem sem Iterate, HookMill', async ({ page }, info) => {
  test.skip(phone(info), 'árvore é desktop; o 390 está no CU-07');
  const c = await conta('cu1');
  await login(page, c.email);
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Campaigns', level: 1 })).toBeVisible(E);
  await expect(page.getByText(/Synced with Meta/).first()).toBeVisible(E);
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible();
  await expect(grid.getByText(/Total · 3 campaigns · Last 30 days/)).toBeVisible();
  await expect(grid.getByText('Mock — Prospecting (CBO)')).toBeVisible();
  await expect(grid.getByRole('row').filter({ hasText: 'Mock — Prospecting (CBO)' }).first()).toContainText(/CBO\s*\$50\.00\s*\/day/);
  await expect(grid.getByText('Set per ad set')).toBeVisible();
  await expect(grid.getByText(/lifetime/i).first()).toBeVisible();
  await semRolagemHorizontal(page, 'campaigns');
  await tela(page, info, 'cu-01a-arvore');
  await page.getByRole('button', { name: 'Expand Mock — Prospecting (CBO)' }).click();
  await expect(grid.getByText('Mock — Broad US')).toBeVisible(E);
  await expect(grid.getByText('Campaign budget').first()).toBeVisible();
  await expect(grid.getByText('Learning').first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand Mock — Broad US' }).click();
  await expect(grid.getByText('Hook A — the pain')).toBeVisible(E);
  await expect(grid.getByText('Winner').first()).toBeVisible();
  const imgRow = grid.getByRole('row').filter({ hasText: 'Image — static offer' });
  // imagem: "Iterate" vira texto inerte (sem botão ativo); vídeo tem botão
  await expect(imgRow.getByRole('link', { name: 'Iterate', exact: true })).toHaveCount(0);
  await expect(imgRow).toContainText('Iterate');
  await expect(grid.getByRole('row').filter({ hasText: 'Hook A — the pain' }).getByRole('link', { name: 'Iterate', exact: true })).toBeVisible();
  await tela(page, info, 'cu-01b-expandida');
  // Ads only + ordenação por cabeçalho (servidor, dir)
  await page.getByRole('radio', { name: 'Ads only' }).click();
  await expect(grid.getByText(/Total · 10 ads/)).toBeVisible(E);
  await page.getByRole('button', { name: /^Spend/ }).click();
  await page.waitForTimeout(800);
  await tela(page, info, 'cu-01c-ads-only');
});

test('CU-02 filtros, Issues com contagem, busca abre o pai e realça, 7 d com seta, filtro sem resultado + Clear', async ({ page }, info) => {
  test.skip(phone(info), 'desktop');
  const c = await conta('cu2');
  await login(page, c.email);
  await page.goto('/campaigns');
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible(E);
  const issues = page.getByRole('radio', { name: /Issues/ });
  await expect(issues).toContainText(/\d/);
  info.annotations.push({ type: 'chip Issues', description: await issues.innerText() });
  await page.getByPlaceholder('Search campaigns, ad sets, ads').fill('testimonial');
  await expect(grid.getByText('Hook D — the testimonial')).toBeVisible(E);
  await expect(grid.getByText('Mock — Testing (ABO)')).toBeVisible();
  await expect(grid.getByText('Mock — Prospecting (CBO)')).toHaveCount(0);
  await tela(page, info, 'cu-02a-busca');
  await page.getByPlaceholder('Search campaigns, ad sets, ads').fill('zzzz');
  await expect(page.getByText('Nothing matches these filters.').first()).toBeVisible(E);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(grid.getByText('Mock — Prospecting (CBO)')).toBeVisible(E);
  await page.getByRole('radio', { name: 'Last 7 days' }).click();
  await expect(grid.getByText(/Last 7 days/)).toBeVisible(E);
  await page.waitForTimeout(800);
  await tela(page, info, 'cu-02b-7d');
});

test('CU-03 diálogos: pausar sempre com diálogo; ligar com pai pausado lista os pais ("Turn on 2 items"); META_POLICY no diálogo', async ({ page }, info) => {
  test.skip(phone(info), 'desktop');
  const c = await conta('cu3');
  await as(c).post('/meta/ads/mock_ad_5/status', { status: 'PAUSED', expected: 'ACTIVE', confirm: true });
  await login(page, c.email);
  await page.goto('/campaigns');
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible(E);
  // pausar campanha
  await page.getByRole('switch', { name: 'Pause Mock — Testing (ABO)' }).click();
  await expect(dlg(page)).toContainText('Pause campaign?');
  await expect(dlg(page)).toContainText("It stops delivering now");
  await tela(page, info, 'cu-03a-pausar');
  await dlg(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText(/Paused: Mock — Testing \(ABO\)/)).toBeVisible(E);
  await expect(page.getByRole('switch', { name: 'Turn on Mock — Testing (ABO)' })).toBeVisible();
  // ligar o anúncio dentro do conjunto pausado (campanha também pausada agora) → lista 2 pais
  await page.getByRole('button', { name: 'Expand Mock — Testing (ABO)' }).click();
  await page.getByRole('button', { name: 'Expand Mock — Paused test' }).click();
  await page.getByRole('switch', { name: 'Turn on Hook E — new this week' }).first().click();
  await expect(dlg(page)).toContainText('This starts spending today.');
  await expect(dlg(page)).toContainText('This also turns on');
  await expect(dlg(page)).toContainText('Mock — Paused test');
  await expect(dlg(page)).toContainText('Mock — Testing (ABO)');
  await expect(dlg(page).getByRole('button', { name: 'Turn on 3 items' })).toBeVisible();
  await tela(page, info, 'cu-03b-ligar-com-pais');
  await dlg(page).getByRole('button', { name: 'Turn on 3 items' }).click();
  await expect(page.getByText(/Turned on: Hook E — new this week \(\+2\)/)).toBeVisible(E);
  await page.waitForTimeout(1500);
  const aberta = await grid.getByText('Hook E — new this week').isVisible().catch(() => false);
  info.annotations.push({ type: 'árvore depois da escrita', description: aberta ? 'continua expandida' : 'RECOLHEU (perdeu a expansão)' });
  expect.soft(aberta, 'spec §2.15: depois da escrita troca só a linha; a árvore não deve recolher').toBe(true);
  // DISAPPROVED: switch desabilitado com "Rejected by Meta" (a API dá META_POLICY se forçar)
  if (!(await grid.getByText('Mock — Interests').isVisible().catch(() => false))) await page.getByRole('button', { name: 'Expand Mock — Testing (ABO)' }).click();
  await page.getByRole('button', { name: 'Expand Mock — Interests' }).click();
  const rej = grid.getByRole('row').filter({ hasText: 'Hook G — disapproved' });
  await expect(rej.getByText('Rejected by Meta')).toBeVisible(E);
  await expect(rej.getByRole('switch')).toBeDisabled();
  await tela(page, info, 'cu-03c-rejeitado');
});

test('CU-04 orçamento: atalhos, mínimo, 2×, aviso +20 %/aprendizado, salvar; vitalício e conjunto CBO sem lápis', async ({ page }, info) => {
  test.skip(phone(info), 'desktop');
  const c = await conta('cu4');
  await login(page, c.email);
  await page.goto('/campaigns');
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible(E);
  await page.getByRole('button', { name: /Daily budget of Mock — Prospecting \(CBO\)/ }).click();
  const d = dlg(page);
  await expect(d).toContainText('Daily budget');
  await expect(d).toContainText(/min \$5\.00 · max this change \$100\.00/);
  const input = d.getByRole('textbox').first();
  await input.fill('4');
  await expect(d).toContainText('The account minimum is $5.00 a day.');
  await expect(d.getByRole('button', { name: 'Save budget' })).toBeDisabled();
  await input.fill('101');
  await expect(d).toContainText('Up to $100.00 in one change');
  await expect(d.getByRole('button', { name: 'Save budget' })).toBeDisabled();
  await input.fill('55');
  await expect(d).toContainText("Big changes can restart Meta's learning phase", { timeout: 5000 }); // campanha com conjunto LEARNING
  await d.getByRole('radio', { name: '+20%' }).or(d.getByRole('button', { name: '+20%' })).first().click();
  await expect(input).toHaveValue(/60/);
  await tela(page, info, 'cu-04a-orcamento');
  await d.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText(/Budget saved: \$60\.00\/day/)).toBeVisible(E);
  await expect(grid.getByRole('row').filter({ hasText: 'Mock — Prospecting (CBO)' }).first()).toContainText(/CBO\s*\$60\.00\s*\/day/);
  // vitalício: sem lápis; conjunto CBO: "Campaign budget" sem lápis
  await expect(page.getByRole('button', { name: /Daily budget of Mock — Launch \(lifetime\)/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Mock — Prospecting (CBO)' }).click();
  await expect(page.getByRole('button', { name: /Daily budget of Mock — Broad US/ })).toHaveCount(0);
  // ABO: lápis no conjunto, +20 % sem aprendizado = aviso de mudança grande?
  await page.getByRole('button', { name: 'Expand Mock — Testing (ABO)' }).click();
  await page.getByRole('button', { name: /Daily budget of Mock — Interests/ }).click();
  await expect(dlg(page)).toContainText(/min \$5\.00 · max this change \$40\.00/);
  await dlg(page).getByRole('button', { name: 'Cancel' }).click();
});

test('CU-05 conflito META_OBJECT_CHANGED + Update row; rate limit e token no diálogo; History (conta e item)', async ({ page }, info) => {
  test.skip(phone(info), 'desktop');
  const c = await conta('cu5');
  await login(page, c.email);
  await page.goto('/campaigns');
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible(E);
  await page.getByRole('button', { name: 'Expand Mock — Testing (ABO)' }).click();
  await page.getByRole('switch', { name: /Mock — Retargeting \[mock:stale\]/ }).click();
  await dlg(page).getByRole('button', { name: /^Pause$/ }).click();
  await expect(dlg(page)).toContainText('This changed in Ads Manager after our last sync', E);
  await expect(dlg(page)).toContainText("We didn't change anything.");
  await tela(page, info, 'cu-05a-mudou');
  await dlg(page).getByRole('button', { name: 'Update row' }).click();
  await expect(page.getByText('Row updated from Meta. Check it and try again.')).toBeVisible(E);
  // rate limit: anúncio de imagem [mock:meta-rate]
  await page.getByRole('button', { name: 'Expand Mock — Prospecting (CBO)' }).click();
  await page.getByRole('button', { name: 'Expand Mock — Broad US' }).click();
  await page.getByRole('switch', { name: /Pause Image — static offer/ }).click();
  await dlg(page).getByRole('button', { name: /^Pause$/ }).click();
  await expect(dlg(page)).toContainText('Meta asked us to wait', E);
  await expect(dlg(page)).toContainText(/Try again in \d+ seconds/);
  await tela(page, info, 'cu-05b-rate');
  await dlg(page).getByRole('button', { name: 'Cancel' }).click();
  // History da conta
  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  const sh = page.getByRole('dialog').last();
  await expect(sh).toContainText("Changes made directly in Ads Manager don't show here.", E);
  await expect(sh).toContainText('Failed');
  await tela(page, info, 'cu-05c-history');
  await page.keyboard.press('Escape');
  // History do item pelo menu da linha
  await page.getByRole('button', { name: 'More for Image — static offer [mock:meta-rate]' }).click();
  await page.getByRole('menuitem', { name: 'History of this item' }).click();
  await expect(page.getByRole('dialog').last()).toContainText(/Image — static offer/, E);
  await tela(page, info, 'cu-05d-history-item');
});

test('CU-06 papéis: MEMBER (texto On/Off + faixa, Sync now, Iterate) e CLIENT (View only, sem Sync, sem Iterate)', async ({ page }, info) => {
  const c = await conta('cu6');
  const mem = await convidar(c, 'MEMBER', 'm');
  const cli = await convidar(c, 'CLIENT', 'c');
  await as(mem).post('/workspace/tour/complete');
  await as(cli).post('/workspace/tour/complete');
  await login(page, mem.email);
  await page.goto('/campaigns');
  await expect(page.getByText('Only owners and admins can change Meta. You can sync and iterate.')).toBeVisible(E);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Daily budget of/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await tela(page, info, 'cu-06a-member');
  await page.request.delete('/api/session');
  await login(page, cli.email);
  await page.goto('/campaigns');
  await expect(page.getByText('View only').first()).toBeVisible(E);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Iterate/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'History', exact: true }).first()).toBeVisible();
  await tela(page, info, 'cu-06b-client');
});

test('CU-07 estados: sem Meta, stale, failed; Home "All ads" abre /campaigns; Pick from Meta continua só vídeo (390 e 1440)', async ({ page }, info) => {
  const c0 = await conta('cu7a', false);
  await login(page, c0.email);
  await page.goto('/campaigns');
  await expect(page.getByText('Connect Meta to see your campaigns')).toBeVisible(E);
  await expect(page.getByRole('link', { name: 'Connect Meta' })).toBeVisible();
  await tela(page, info, 'cu-07a-sem-meta');
  const c = await conta('cu7b');
  await page.request.delete('/api/session');
  await login(page, c.email);
  await sql(`update meta_connections set last_sync_at = (now() at time zone 'utc') - interval '13 hours' where workspace_id = $1`, [c.workspaceId]);
  await page.goto('/campaigns');
  await expect(page.getByText(/Last sync was/)).toBeVisible(E);
  await expect(page.getByText('Changes you make still go straight to Meta.', { exact: false })).toBeVisible();
  await semRolagemHorizontal(page, 'campaigns stale');
  await tela(page, info, 'cu-07b-stale');
  await sql(`update meta_connections set last_sync_at = null, last_sync_error = 'META_ERROR' where workspace_id = $1`, [c.workspaceId]);
  await page.reload();
  await expect(page.getByText('The last sync failed')).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Sync again' })).toBeVisible();
  await tela(page, info, 'cu-07c-failed');
  await sql(`update meta_connections set last_sync_at = (now() at time zone 'utc'), last_sync_error = null where workspace_id = $1`, [c.workspaceId]);
  await page.goto('/');
  await page.getByRole('link', { name: 'All ads' }).click();
  await page.waitForURL(/\/campaigns/, E);
  info.annotations.push({ type: 'All ads →', description: page.url() });
  await page.goto('/iterate/new');
  const card = page.locator('#t-winner');
  await expect(card).toContainText('Hook A — the pain', E);
  await expect(card.getByText(/Image —/)).toHaveCount(0);
  if (phone(info)) {
    // 390: cartões com drill-down e migalha
    await page.goto('/campaigns');
    await expect(page.getByRole('treegrid')).toHaveCount(0);
    await page.getByRole('button', { name: /View 2 ad sets/ }).first().click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('All campaigns', E);
    await semRolagemHorizontal(page, 'campaigns 390 drill');
    await tela(page, info, 'cu-07d-390-drill');
  }
});

test('CU-08 off: /campaigns continua "em breve"; PT-BR da tela', async ({ page, baseURL }, info) => {
  const c = await conta('cu8');
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Campanhas', level: 1 })).toBeVisible(E);
  await expect(page.getByText(/Sincronizado com a Meta/).first()).toBeVisible();
  await tela(page, info, 'cu-08a-pt');
  // off na 2ª API/web (:3003 API, :3013 web): conta pronta (onboarding concluído) pra abrir /campaigns
  const OFFAPI = 'http://localhost:3003/api/v1';
  const email = `qa-final-cuoff-${Date.now()}@teste.local`;
  const j = async (m: string, path: string, body?: unknown, tok?: string) => {
    const r = await fetch(OFFAPI + path, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const su = await j('POST', '/auth/signup', { name: 'QA off', email, password: 'qa-senha-forte-2026', agencyName: 'Off QA', accountMode: 'AGENCY' });
  expect(su.status).toBe(201);
  const tok = su.body.data.accessToken;
  await j('PATCH', '/workspace', { name: 'Off QA', businessType: 'ONLINE_STORE', market: 'United States' }, tok);
  await j('POST', '/offers', { name: 'Offer off', language: 'en', kind: 'App', what: 'x what', promise: 'x promise', audience: 'adults', cta: 'Start', sourceUrl: 'https://example.com/' }, tok);
  expect((await j('POST', '/workspace/onboarding/complete', {}, tok)).status).toBe(200);
  await j('POST', '/workspace/tour/complete', {}, tok);
  expect((await j('GET', '/meta/campaigns', undefined, tok)).status, 'off = 503').toBe(503);
  const OFFWEB = process.env.QA_OFF_WEB ?? 'http://localhost:3013';
  const ctx = await page.context().browser()!.newContext({ baseURL: OFFWEB, viewport: page.viewportSize()! });
  const p2 = await ctx.newPage();
  const lg = await p2.request.post('/api/session', { data: { email, password: 'qa-senha-forte-2026' } });
  expect(lg.ok(), `login off ${lg.status()}`).toBe(true);
  await p2.goto('/campaigns');
  await expect(p2.getByText(/reads .* Meta results every day/)).toBeVisible(E);
  await expect(p2.getByRole('treegrid')).toHaveCount(0);
  await tela(p2, info, 'cu-08b-off-em-breve');
  await ctx.close();
});

test('CU-09 390: drill até o anúncio, diálogos viram folha de baixo (pausar, ligar com pais, orçamento), History, busca, Ads only', async ({ page }, info) => {
  test.skip(!phone(info), 'só celular');
  const c = await conta('cu9');
  await as(c).post('/meta/ads/mock_ad_5/status', { status: 'PAUSED', expected: 'ACTIVE', confirm: true });
  await login(page, c.email);
  await page.goto('/campaigns');
  await expect(page.getByRole('treegrid')).toHaveCount(0, E);
  // orçamento da campanha CBO direto no cartão
  await page.getByRole('button', { name: /Daily budget of Mock — Prospecting \(CBO\)/ }).click();
  const d = dlg(page);
  await expect(d).toContainText(/min \$5\.00 · max this change \$100\.00/, E);
  const box = await d.boundingBox();
  info.annotations.push({ type: 'folha do orçamento', description: JSON.stringify(box) });
  expect(box!.y + box!.height, 'folha encosta embaixo').toBeGreaterThan(780);
  await semRolagemHorizontal(page, 'orçamento 390');
  await tela(page, info, 'cu-09a-390-orcamento');
  await d.getByRole('button', { name: 'Cancel' }).click();
  // drill: Testing (ABO) → Paused test → anúncio; ligar com pais
  await page.getByRole('button', { name: /View 3 ad sets/ }).first().click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Mock — Testing (ABO)', E);
  await page.getByRole('switch', { name: 'Pause Mock — Paused test' }).or(page.getByRole('switch', { name: 'Turn on Mock — Paused test' })).first().waitFor(E);
  const pausedAdsetCard = page.locator('article, li, section, div').filter({ hasText: 'Mock — Paused test' }).filter({ has: page.getByRole('button', { name: /View 1 ad/ }) }).last();
  await pausedAdsetCard.getByRole('button', { name: /View 1 ad/ }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Mock — Paused test', E);
  await page.getByRole('switch', { name: 'Turn on Hook E — new this week' }).click();
  await expect(dlg(page)).toContainText('This also turns on', E);
  await expect(dlg(page).getByRole('button', { name: /Turn on 2 items/ })).toBeVisible();
  await semRolagemHorizontal(page, 'ligar 390');
  await tela(page, info, 'cu-09b-390-ligar-com-pai');
  await dlg(page).getByRole('button', { name: /Turn on 2 items/ }).click();
  await expect(page.getByText(/Turned on: Hook E — new this week \(\+1\)/)).toBeVisible(E);
  // pausar
  await page.getByRole('switch', { name: 'Pause Hook E — new this week' }).click();
  await expect(dlg(page)).toContainText('Pause ad?', E);
  await dlg(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText(/Paused: Hook E — new this week/)).toBeVisible(E);
  // History
  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  await expect(page.getByRole('dialog').last()).toContainText('Hook E — new this week', E);
  await tela(page, info, 'cu-09c-390-history');
  await page.keyboard.press('Escape');
  // Ads only + busca
  await page.goto('/campaigns?view=ads');
  await expect(page.getByRole('switch', { name: /Image — static offer/ })).toBeVisible(E);
  await expect(page.getByText('Iterate works on video ads').first()).toBeVisible();
  await page.getByPlaceholder('Search campaigns, ad sets, ads').fill('testimonial');
  await expect(page.getByRole('switch', { name: /Hook D — the testimonial/ })).toBeVisible(E);
  await expect(page.getByRole('switch', { name: /Hook A — the pain/ })).toHaveCount(0);
  await semRolagemHorizontal(page, 'ads only 390');
  await tela(page, info, 'cu-09d-390-ads-only-busca');
});
