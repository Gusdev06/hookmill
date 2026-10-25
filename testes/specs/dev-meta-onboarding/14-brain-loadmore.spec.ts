// Brain 3D v1 (docs/contratos/brain-3d-v1.md) pela API e no navegador + "Load more" do Campaigns (limit 100), em mock, par isolado.
import { test, expect, type Page } from '@playwright/test';
import { as, atePublicacao, conectarMeta, convidar, criativoAprovado, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, sql, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };
const phone = (info: any) => info.project.name.includes('390');

async function cheio(label: string) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  const offer = await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await conectarMeta(c);
  const cr = await criativoAprovado(c, offer.id, 'Hook QA publicado');
  await as(c).post(`/creatives/${cr.id}/meta/publish`, { dailyBudgetMinor: 1500, countries: ['US'], primaryText: 'x', callToAction: 'SHOP_NOW', link: 'https://example.com/' });
  const pub = (await atePublicacao(c, cr.id)).publication;
  await as(c).post('/iterate', { metaAdId: 'mock_ad_1' });
  await expect.poll(async () => (await sql(`select status from champions where workspace_id = $1 and meta_ad_id = 'mock_ad_1'`, [c.workspaceId]))[0]?.status, { timeout: 90_000 }).toMatch(/READY|PLANNING/);
  return { c, offer, cr, pub };
}

// ───────────── API ─────────────
test('BA-01 cliente novo: só centro + setup, sem nó fantasma, meta.connected false; off = 200 sem meta_ad', async () => {
  const c = await signup('ba1', { agencyName: 'ba1 QA', accountMode: 'AGENCY' });
  const g = (await as(c).get('/brain/graph')).data;
  const kinds = g.nodes.map((n: any) => n.kind);
  test.info().annotations.push({ type: 'novo', description: `${kinds.join(',')} · edges ${g.edges.length} · meta ${JSON.stringify(g.meta)}` });
  expect(kinds).toContain('workspace');
  expect(kinds).not.toContain('meta_ad');
  expect(kinds).not.toContain('creative');
  expect(g.counts.meta_ad).toEqual({ total: 0, shown: 0 });
  expect(g.truncated).toBe(false);
  expect(g.meta.connected).toBe(false);
  const ids = new Set(g.nodes.map((n: any) => n.id));
  expect(g.edges.every((e: any) => ids.has(e.from) && ids.has(e.to)), 'sem aresta pendurada').toBe(true);
  // off (3003)
  const s = await fetch('http://localhost:3003/api/v1/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'QA off', email: `qa-final-boff-${Date.now()}@teste.local`, password: 'qa-senha-forte-2026' }) }).then((r) => r.json());
  const r = await fetch('http://localhost:3003/api/v1/brain/graph', { headers: { authorization: `Bearer ${s.data.accessToken}` } });
  const b = await r.json();
  expect(r.status).toBe(200);
  expect(b.data.meta.enabled).toBe(false);
  expect(b.data.nodes.some((n: any) => n.kind === 'meta_ad')).toBe(false);
});

test('BA-02 cliente com Meta: meta_ad com vencedores, published_as com publication, uses_hook do teardown, drawer com videoUrl por tipo, 400/404, CLIENT 200, outro workspace 404', async () => {
  const { c, cr, pub } = await cheio('ba2');
  const a = as(c);
  const g = (await a.get('/brain/graph?fresh=1')).data;
  const by = (k: string) => g.nodes.filter((n: any) => n.kind === k);
  expect(by('meta_ad').length).toBeGreaterThanOrEqual(10);
  expect(g.nodes.filter((n: any) => n.winner).map((n: any) => n.id)).toEqual(expect.arrayContaining(['meta_ad:mock_ad_1', 'meta_ad:mock_ad_2']));
  const pubEdge = g.edges.find((e: any) => e.kind === 'published_as');
  expect(pubEdge.from).toBe(`creative:${cr.id}`);
  expect(pubEdge.to).toBe(`meta_ad:${pub.ids.adId}`);
  expect(pubEdge.publication).toBeTruthy();
  expect(g.edges.some((e: any) => e.kind === 'uses_hook' && e.from === 'meta_ad:mock_ad_1')).toBe(true);
  expect(by('hook').length).toBeGreaterThanOrEqual(1);
  for (const k of Object.keys(g.counts)) expect(g.counts[k].shown).toBeLessThanOrEqual(g.counts[k].total);
  expect(g.meta.connected).toBe(true);
  expect(g.meta.lastSyncAt).toBeTruthy();
  const ids = new Set(g.nodes.map((n: any) => n.id));
  expect(g.edges.every((e: any) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  const node = async (id: string) => a.get(`/brain/node/${encodeURIComponent(id)}`);
  const dCr = await node(`creative:${cr.id}`);
  expect(dCr.status).toBe(200);
  expect(dCr.data.media.videoUrl).toMatch(/render_video/);
  expect(dCr.data.open).toMatchObject({ route: 'creative', id: cr.id });
  expect((await node(`meta_ad:${pub.ids.adId}`)).data.media.videoUrl, 'anúncio HookMill = render publicado').toMatch(/render_video/);
  expect((await node('meta_ad:mock_ad_1')).data.media.videoUrl, 'anúncio importado = vídeo do campeão').toMatch(/champion_video/);
  const d3 = (await node('meta_ad:mock_ad_3')).data.media;
  expect(d3.videoUrl, 'terceiro sem import = sem vídeo').toBeNull();
  expect(d3.posterUrl).toBeTruthy();
  const dOff = await node(`offer:${(await a.get('/offers')).data[0].id}`);
  expect(dOff.data.open).toMatchObject({ route: 'offer' });
  const dBiz = await node(`business:${c.workspaceId}`);
  expect(dBiz.data.open).toMatchObject({ route: 'setup', step: 1 });
  expect((await node('xyz')).status).toBe(400);
  expect((await node('creative:nao_existe')).status).toBe(404);
  const cli = await convidar(c, 'CLIENT', 'cl');
  expect((await as(cli).get('/brain/graph')).status).toBe(200);
  expect((await as(cli).get(`/brain/node/${encodeURIComponent(`creative:${cr.id}`)}`)).status).toBe(200);
  const outro = await signup('ba2b', { accountMode: 'AGENCY' });
  expect((await as(outro).get(`/brain/node/${encodeURIComponent(`creative:${cr.id}`)}`)).status, 'outro workspace = 404').toBe(404);
  expect((await as(outro).get(`/brain/graph?offerId=${(await a.get('/offers')).data[0].id}`)).status).toBe(404);
});

test('BA-03 teto: 1 000 criativos → 800 nós, truncated, todo vencedor presente, sem aresta pendurada, counts reais', async () => {
  const c = await signup('ba3', { agencyName: 'ba3 QA', accountMode: 'AGENCY' });
  const offer = await prepararWorkspace(c, { live: true });
  const uid = (await as(c).get('/auth/me')).data.user.id;
  await sql(`insert into creatives (id, workspace_id, offer_id, name, language, state, is_winner, created_by_id, updated_at)
             select 'qab' || g || '_' || $3, $1, $2, 'Bulk ' || g, 'en', (case when g % 3 = 0 then 'APPROVED' else 'RENDER_READY' end)::"CreativeState", g <= 25, $4, now() - (g || ' minutes')::interval
             from generate_series(1, 1000) g`, [c.workspaceId, offer.id, Date.now().toString(36), uid]);
  const t0 = Date.now();
  const g = (await as(c).get('/brain/graph?fresh=1')).data;
  const ms = Date.now() - t0;
  test.info().annotations.push({ type: 'teto', description: `${g.nodes.length} nós, ${g.edges.length} arestas, truncated ${g.truncated}, creative ${JSON.stringify(g.counts.creative)}, ${ms} ms` });
  expect(g.nodes.length).toBeLessThanOrEqual(800);
  expect(g.truncated).toBe(true);
  expect(g.counts.creative.total).toBe(1000);
  expect(g.nodes.filter((n: any) => n.kind === 'creative' && n.winner).length, 'todos os 25 vencedores').toBe(25);
  const ids = new Set(g.nodes.map((n: any) => n.id));
  expect(g.edges.every((e: any) => ids.has(e.from) && ids.has(e.to))).toBe(true);
});

// ───────────── navegador ─────────────
async function abrirBrain(page: Page) {
  await page.goto('/brain');
  await expect(page.getByRole('heading', { name: 'Brain', level: 1 })).toBeVisible(E);
}

test('BU-01 palco 3D (desktop) ou List (390): busca, categorias/solo, Winners, drawer com player, Grow/Cinema/Creatives, rodapé', async ({ page }, info) => {
  const { c, cr } = await cheio('bu1');
  // o nó do criativo tem rótulo = adName (brain.montagem.ts creativeLabel); buscar pelo nome dado ao criativo não acha (nota no relatório)
  const NOME = cr.adName;
  await login(page, c.email);
  await abrirBrain(page);
  const stage = page.locator('#t-brain');
  await expect(stage).toBeVisible(E);
  if (phone(info)) {
    await expect(page.getByText('Open the 3D view')).toBeVisible(E);
    await expect(page.getByRole('application')).toHaveCount(0);
    await semRolagemHorizontal(page, 'brain 390');
    await tela(page, info, 'bu-01a-390-lista');
    await page.getByPlaceholder('Search the Brain').fill(NOME);
    await page.getByRole('button', { name: new RegExp(NOME) }).first().click();
    await expect(page.getByRole('dialog').last().locator('video')).toHaveCount(1, E);
    await tela(page, info, 'bu-01b-390-drawer');
    return;
  }
  const app = page.getByRole('application');
  const webgl = await app.waitFor({ timeout: 15_000 }).then(() => 1, () => 0);
  info.annotations.push({ type: 'WebGL no Chrome headless', description: webgl ? 'palco 3D' : 'sem WebGL → List' });
  await page.waitForTimeout(2500);
  await tela(page, info, 'bu-01a-palco');
  await expect(stage).toContainText(/\d+ nodes · \d+ connections/);
  await expect(stage).toContainText(/Meta synced/);
  // categorias: chip com contagem; Winners
  const cats = page.getByRole('group', { name: 'Categories' });
  await expect(cats).toContainText('Meta ads');
  await expect(cats.getByText(/Scripts/)).toBeVisible();
  await page.getByRole('button', { name: /^Winners/ }).first().click();
  await page.waitForTimeout(800);
  await tela(page, info, 'bu-01b-winners');
  // busca → drawer
  await page.keyboard.press('Escape');
  await page.getByPlaceholder('Search the Brain').click();
  await page.getByPlaceholder('Search the Brain').fill(NOME);
  await page.getByRole('option', { name: new RegExp(NOME) }).or(page.getByRole('button', { name: new RegExp(NOME) })).first().click();
  const drawer = page.getByRole('complementary').or(page.getByRole('dialog')).filter({ hasText: NOME }).last();
  await expect(drawer).toBeVisible(E);
  await expect(drawer.locator('video')).toHaveCount(1);
  // a busca devolve 2 nós com o mesmo rótulo (criativo e o anúncio publicado dele); se abriu o anúncio, vai pro criativo pelo vizinho
  if (await drawer.getByRole('link', { name: 'Open in Campaigns' }).count()) {
    info.annotations.push({ type: 'busca', description: 'abriu o meta_ad (rótulo igual ao do criativo); drawer com vídeo + Iterate this ad + Open in Campaigns' });
    await tela(page, info, 'bu-01c0-drawer-anuncio');
    await drawer.getByRole('button', { name: new RegExp(`${NOME} published as`) }).click();
  }
  const dc = page.getByRole('dialog').filter({ hasText: NOME }).last();
  await expect(dc.getByRole('link', { name: 'Open creative' }).or(dc.getByRole('button', { name: 'Open creative' }))).toBeVisible(E);
  await expect(dc.locator('video')).toHaveCount(1);
  await tela(page, info, 'bu-01c-drawer-criativo');
  // galeria (G), Grow (D), Cinema (C)
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Creatives/ }).click();
  await expect(page.getByText(/winners first/)).toBeVisible(E);
  await tela(page, info, 'bu-01d-galeria');
  await page.keyboard.press('Escape'); // a galeria cobre o palco (e a barra); fecha com Esc
  await expect(page.locator('[aria-labelledby="brain-gal-title"]')).toHaveCount(0, E);
  if (webgl) {
    await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Grow/ }).click();
    await page.waitForTimeout(3000);
    await tela(page, info, 'bu-01e-grow');
    await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^Cinema/ }).click();
    await expect(page.getByText('Esc · exit Cinema')).toBeVisible(E);
    await tela(page, info, 'bu-01f-cinema');
    await page.keyboard.press('Escape');
  }
  // List view
  await page.getByRole('toolbar', { name: 'View' }).getByRole('button', { name: /^List/ }).click();
  await expect(page.getByText('Hooks & angles').first()).toBeVisible(E);
  await tela(page, info, 'bu-01g-lista');
});

test('BU-02 sem WebGL (?webgl=off) abre em List com aviso; reduced-motion sem animação', async ({ page }, info) => {
  test.skip(phone(info), 'desktop');
  const { c } = await cheio('bu2');
  await login(page, c.email);
  await page.goto('/brain?webgl=off');
  await expect(page.getByText("This device can't draw the 3D view, so the Brain opens as a list. Everything is here.")).toBeVisible(E);
  await expect(page.getByRole('application')).toHaveCount(0);
  await tela(page, info, 'bu-02a-sem-webgl');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/brain');
  await expect(page.locator('#t-brain')).toBeVisible(E);
  await page.waitForTimeout(1500);
  await tela(page, info, 'bu-02b-reduced-motion');
});

test('BU-03 CLIENT: View only, sem Revisit setup/Edit/Iterate/Send; cliente novo com o cartão "The Brain grows"; PT-BR', async ({ page, baseURL }, info) => {
  const { c } = await cheio('bu3');
  const cli = await convidar(c, 'CLIENT', 'cl');
  await as(cli).post('/workspace/tour/complete');
  await login(page, cli.email);
  await abrirBrain(page);
  await expect(page.getByText('View only').first()).toBeVisible(E);
  for (const n of ['Revisit setup', 'Edit offer', 'Iterate this winner', 'Send to Meta', 'Edit in setup']) await expect(page.getByRole('link', { name: n }).or(page.getByRole('button', { name: n }))).toHaveCount(0);
  await tela(page, info, 'bu-03a-client');
  const novo = await signup('bu3n', { agencyName: 'Novo QA', accountMode: 'AGENCY' });
  await prepararWorkspace(novo, { live: true });
  await as(novo).post('/workspace/tour/complete');
  await page.request.delete('/api/session');
  await login(page, novo.email);
  await abrirBrain(page);
  if (phone(info)) await expect(page.getByText('Hooks & angles').first()).toBeVisible(E);
  else await expect(page.getByText('The Brain grows as you work').first()).toBeVisible(E);
  if (!phone(info)) await expect(page.locator('[aria-label*="Connect Meta to read your ads"], [title*="Connect Meta to read your ads"]').first()).toBeAttached();
  else await expect(page.getByText(/Connect Meta to read your ads/).first()).toBeAttached(E); // na List o motivo fica dentro da seção "Meta ads 0" (recolhida)
  const rotulo = await page.locator('#t-brain').innerText().catch(() => '');
  info.annotations.push({ type: 'rótulos do palco (cliente novo)', description: rotulo.replace(/\s+/g, ' ').slice(0, 200) });
  expect.soft(rotulo, 'nó Business com enum cru ONLINE_STORE no rótulo').not.toContain('ONLINE_STORE');
  await tela(page, info, 'bu-03b-novo');
  await ptBR(page, baseURL!);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Cérebro|Brain/, level: 1 })).toBeVisible(E);
  await tela(page, info, 'bu-03c-pt');
});

test('BU-04 tour: parada 1 no palco do Brain (#t-brain) numa conta nova', async ({ page }, info) => {
  const c = await signup('bu4', { agencyName: 'bu4 QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await conectarMeta(c);
  await login(page, c.email);
  await page.goto('/');
  await page.waitForURL(/\/brain$/, E);
  const coach = page.getByRole('dialog').filter({ hasText: /Tour · / });
  await expect(coach).toContainText('Tour · 1 of 5', E);
  await expect(page.locator('#t-brain')).toBeVisible();
  await tela(page, info, 'bu-04-tour-brain');
});

test('LM-01 Campaigns "Load more": API limit 100 ok, 200 = 400, cursor; tela Ads only com 130 anúncios mostra 100 + Load more', async ({ page }, info) => {
  test.skip(phone(info), 'desktop basta pro limite');
  const c = await signup('lm1', { agencyName: 'lm1 QA', accountMode: 'AGENCY' });
  await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  await conectarMeta(c);
  const a = as(c);
  expect((await a.get('/meta/ads?format=all&limit=200')).status).toBe(400);
  expect((await a.get('/meta/campaigns?limit=200')).status).toBe(400);
  expect((await a.get('/meta/campaigns?limit=100')).status).toBe(200);
  const p1 = await a.get('/meta/ads?format=all&limit=3');
  expect(p1.data.length).toBe(3);
  expect(p1.body.meta.nextCursor).toBeTruthy();
  const p2 = await a.get(`/meta/ads?format=all&limit=3&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`);
  expect(p2.data.map((x: any) => x.metaAdId).some((id: string) => p1.data.map((x: any) => x.metaAdId).includes(id)), 'página 2 não repete a 1').toBe(false);
  const c1 = await a.get('/meta/campaigns?limit=2');
  expect(c1.data.length).toBe(2);
  const c2 = await a.get(`/meta/campaigns?limit=2&cursor=${encodeURIComponent(c1.body.meta.nextCursor)}`);
  expect(c2.data.length).toBe(1);
  // 120 anúncios a mais no snapshot (cópias do mock_ad_4) → 130 no Ads only
  await sql(`insert into meta_ad_snapshots (id, workspace_id, connection_id, ad_account_id, meta_ad_id, name, effective_status, campaign_id, campaign_name, adset_id, adset_name, meta_creative_id, video_id, thumbnail_url, result_type, metrics, metrics_7d, metrics_prev_7d, verdict, trend, ad_created_time, synced_at, status)
             select 'qalm' || g || id, workspace_id, connection_id, ad_account_id, 'qa_bulk_ad_' || g, 'Bulk ad ' || g, effective_status, campaign_id, campaign_name, adset_id, adset_name, meta_creative_id, video_id, thumbnail_url, result_type, metrics, metrics_7d, metrics_prev_7d, verdict, trend, ad_created_time, synced_at, status
             from meta_ad_snapshots, generate_series(1, 120) g where workspace_id = $1 and meta_ad_id = 'mock_ad_4'`, [c.workspaceId]);
  const reqs: string[] = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/meta/ads') || u.pathname.endsWith('/meta/campaigns')) reqs.push(`${r.status()} ${u.search}`); });
  await login(page, c.email);
  await page.goto('/campaigns?view=ads');
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible(E);
  await expect(grid.getByText(/Total · \d+ ads/)).toBeVisible(E);
  const tot0 = await grid.getByText(/Total · \d+ ads/).innerText();
  const totRow0 = await grid.getByRole('row').filter({ hasText: /Total · / }).first().innerText();
  info.annotations.push({ type: 'linha Total antes', description: totRow0.replace(/\s+/g, ' ') });
  info.annotations.push({ type: 'linha de total antes do Load more', description: tot0 });
  expect.soft(tot0, 'Total deve ser do conjunto filtrado (130), não da página carregada (contrato §1 "Totais do conjunto filtrado")').toMatch(/130 ads/);
  const rows0 = await grid.getByRole('row').count();
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect.poll(async () => grid.getByRole('row').count(), E).toBeGreaterThan(rows0);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0, E);
  info.annotations.push({ type: 'linha Total depois', description: (await grid.getByRole('row').filter({ hasText: /Total · / }).first().innerText()).replace(/\s+/g, ' ') });
  info.annotations.push({ type: 'linhas', description: `${rows0} → ${await grid.getByRole('row').count()} · reqs ${reqs.join(' | ')}` });
  expect(reqs.every((r) => !r.startsWith('400')), 'nenhum 400 (bug do limit=200)').toBe(true);
  expect(reqs.some((r) => /limit=100/.test(r))).toBe(true);
  await tela(page, info, 'lm-01-load-more');
});
