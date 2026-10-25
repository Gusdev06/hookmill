// Item 6: Publish to Meta (meta-v1 §3.3) — tela /creatives/:id/send, gatilhos do §8, retry sem duplicar, papéis, sem conexão.
import { test, expect, type Page } from '@playwright/test';
import { as, atePublicacao, conectarMeta, convidar, criativoAprovado, login, prepararWorkspace, ptBR, semRolagemHorizontal, signup, sql, tela } from './dev.ts';

test.use({ actionTimeout: 20_000 });
const E = { timeout: 60_000 };

async function contaPub(label: string, meta = true) {
  const c = await signup(label, { agencyName: `${label} QA`, accountMode: 'AGENCY' });
  const offer = await prepararWorkspace(c, { live: true });
  await as(c).post('/workspace/tour/complete');
  if (meta) await conectarMeta(c);
  return { c, offer };
}
const BODY = (over: Record<string, unknown> = {}) => ({ dailyBudgetMinor: 1500, countries: ['US'], primaryText: 'Stop losing money on forgotten subscriptions.', callToAction: 'SHOP_NOW', link: 'https://example.com/', ...over });

test('PB-01 Final OK → Publish to Meta → form com defaults → 6 etapas → PAUSED + Ads Manager → Activate (confirmação) → ACTIVE → Pause; Library "Send to Meta"', async ({ page }, info) => {
  const { c, offer } = await contaPub('pub');
  const cr = await criativoAprovado(c, offer.id);
  await login(page, c.email);
  await page.goto(`/creatives/${cr.id}/review`);
  await page.getByRole('link', { name: 'Publish to Meta' }).click();
  await page.waitForURL(new RegExp(`/creatives/${cr.id}/send$`), E);
  await expect(page.getByRole('heading', { name: 'Publish to Meta' })).toBeVisible(E);
  await expect(page.getByText('Create a paused campaign in Mock Store (USD)')).toBeVisible(E);
  // defaults (§2): objetivo pelo businessType, país do market, CTA por objetivo, link da oferta, mínimo da conta
  const d = (await as(c).get(`/creatives/${cr.id}/meta`)).data;
  info.annotations.push({ type: 'defaults', description: JSON.stringify(d.defaults).slice(0, 400) });
  expect(d.defaults.objective).toBe('OUTCOME_SALES');
  expect(d.defaults.countries).toEqual(['US']);
  expect(d.defaults.callToAction).toBe('SHOP_NOW');
  expect(d.defaults.dailyBudgetMinor).toBe(500);
  expect(d.defaults.name).toBe(cr.adName);
  await expect(page.getByRole('combobox').first()).toContainText('Sales');
  await expect(page.getByText('Minimum for this account: $5.00')).toBeVisible();
  await expect(page.locator('input[id$="-countries"]')).toHaveValue(/US/);
  await expect(page.getByLabel('Primary text')).not.toHaveValue('');
  await expect(page.getByLabel('Link')).toHaveValue(/example\.com/);
  await expect(page.getByText(`${cr.adName}.mp4`)).toBeVisible();
  await expect(page.getByText('Page: Mock Page')).toBeVisible();
  await semRolagemHorizontal(page, 'send form');
  await tela(page, info, 'pb-01a-form');
  await page.getByLabel('Daily budget').fill('20');
  await page.getByRole('button', { name: 'Create paused campaign' }).click();
  await expect(page.getByText('Publishing…')).toBeVisible(E);
  await expect(page.getByText('Uploading the video')).toBeVisible();
  await tela(page, info, 'pb-01b-publishing');
  await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
  const p1 = (await as(c).get(`/creatives/${cr.id}/meta`)).data.publication;
  expect(p1.status).toBe('PAUSED');
  expect(p1.ids.videoId && p1.ids.campaignId && p1.ids.adsetId && p1.ids.creativeId && p1.ids.adId).toBeTruthy();
  expect(p1.settings.dailyBudgetMinor).toBe(2000);
  expect(p1.job.checklist.filter((x: any) => x.done).length).toBe(6);
  for (const idv of [p1.ids.campaignId, p1.ids.adsetId, p1.ids.adId]) await expect(page.getByText(idv)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Ads Manager' })).toBeVisible();
  await expect(page.getByText('$20.00/day · US · Sales')).toBeVisible();
  await semRolagemHorizontal(page, 'send paused');
  await tela(page, info, 'pb-01c-paused');
  // aparece na Home (snapshot) e em /meta/publications
  expect((await as(c).get('/meta/publications')).data.map((x: any) => x.id)).toContain(p1.id);
  // Activate com confirmação
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('starts spending $20.00 per day in Mock Store (USD)');
  await tela(page, info, 'pb-01d-activate-dialog');
  await page.getByRole('button', { name: 'Activate and start spending' }).click();
  await expect(page.getByRole('heading', { name: 'Running' })).toBeVisible(E);
  expect((await as(c).get(`/creatives/${cr.id}/meta`)).data.publication.status).toBe('ACTIVE');
  await tela(page, info, 'pb-01e-active');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
  expect((await as(c).get(`/creatives/${cr.id}/meta`)).data.publication.status).toBe('PAUSED');
  // Library → Send to Meta
  await page.goto('/library');
  await page.getByRole('link', { name: 'Send to Meta' }).first().click();
  await page.waitForURL(/\/creatives\/[^/]+\/send$/, E);
  await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
  // achado pro arquiteto: a publicação atual também vem em history?
  const r = (await as(c).get(`/creatives/${cr.id}/meta`)).data;
  info.annotations.push({ type: 'publication em history', description: `history ids ${JSON.stringify(r.history.map((h: any) => h.id))} · atual ${r.publication.id}` });
  await expect(page.getByText('Previous attempts')).toHaveCount(0);
});

test('PB-02 gatilhos do §8: policy → Edit ad text; payment; token → Reconnect; rate e error → Retry que retoma sem duplicar', async ({ page }, info) => {
  const { c, offer } = await contaPub('trig');
  const a = as(c);
  await login(page, c.email);
  const casos: [string, string, string, string][] = [
    ['[mock:meta-policy]', 'META_POLICY', 'edit_ad_text', 'Edit ad text'],
    ['[mock:meta-payment]', 'META_PAYMENT_REQUIRED', 'fix_payment', 'Check the account'],
    ['[mock:meta-token]', 'META_TOKEN_INVALID', 'reconnect_meta', 'Reconnect Meta'],
    ['[mock:meta-rate]', 'META_RATE_LIMITED', 'retry', 'Retry'],
    ['[mock:meta-error]', 'META_ERROR', 'retry', 'Retry'],
  ];
  for (const [gatilho, code, action, botao] of casos) {
    const cr = await criativoAprovado(c, offer.id, `Hook ${code}`);
    const r = await a.post(`/creatives/${cr.id}/meta/publish`, BODY({ primaryText: `Buy now ${gatilho}` }));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const done = await atePublicacao(c, cr.id);
    const p = done.publication;
    expect(p.status).toBe('FAILED');
    expect(p.errorCode).toBe(code);
    expect(p.action).toBe(action);
    info.annotations.push({ type: code, description: `stage ${p.job?.stage} failReason "${p.failReason}" ids ${JSON.stringify(p.ids)}` });
    if (code === 'META_POLICY') { expect(p.ids.videoId && p.ids.campaignId && p.ids.adsetId).toBeTruthy(); expect(p.ids.creativeId).toBeNull(); }
    if (code === 'META_TOKEN_INVALID') {
      expect((await a.get('/meta/connection')).data.status).toBe('TOKEN_INVALID');
    }
    await page.goto(`/creatives/${cr.id}/send`);
    await expect(page.getByText('Publishing failed')).toBeVisible(E);
    await expect(page.getByText(p.failReason)).toBeVisible();
    const b = page.getByRole('button', { name: botao }).or(page.getByRole('link', { name: botao }));
    await expect(b.first(), `ação ${action} → botão "${botao}"`).toBeVisible();
    await semRolagemHorizontal(page, code);
    await tela(page, info, `pb-02-${code.toLowerCase()}`);
    if (code === 'META_TOKEN_INVALID') {
      // reconecta pela API (callback mock) pra seguir os outros casos
      const u = await a.post('/meta/connect', { returnTo: '/settings' });
      await fetch(u.data.url, { redirect: 'manual' });
      await expect.poll(async () => (await a.get('/meta/connection')).data.status, E).toBe('ACTIVE');
    }
    if (code === 'META_ERROR') {
      // Retry com o gatilho ainda no texto falha de novo na mesma etapa e NÃO cria 2ª campanha; tirando o gatilho, retoma e termina
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect.poll(async () => (await a.get(`/creatives/${cr.id}/meta`)).data.publication.status, E).toBe('PUBLISHING').catch(() => undefined);
      const again = await atePublicacao(c, cr.id);
      expect(again.publication.id).toBe(p.id);
      expect(again.publication.status).toBe('FAILED');
      expect(again.publication.ids.videoId).toBe(p.ids.videoId);
      await sql(`update meta_publications set settings = settings || '{"primaryText":"Buy now"}'::jsonb where id = $1`, [p.id]);
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible(E);
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect.poll(async () => (await a.get(`/creatives/${cr.id}/meta`)).data.publication.status, { timeout: 60_000 }).toBe('PAUSED');
      const ok = await atePublicacao(c, cr.id);
      expect(ok.publication.id).toBe(p.id);
      expect(ok.publication.status).toBe('PAUSED');
      expect(ok.publication.ids.videoId, 'vídeo não sobe de novo').toBe(p.ids.videoId);
      const pubs = await sql(`select count(*)::int n from meta_publications where creative_id = $1`, [cr.id]);
      expect(pubs[0].n, 'uma publicação só').toBe(1);
      await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
      await tela(page, info, 'pb-02-retry-ok');
    }
    if (code === 'META_POLICY') {
      // Edit ad text abre o form preenchido; publicar de novo = publicação nova, a antiga vai pro histórico
      await page.getByRole('button', { name: 'Edit ad text' }).click();
      await expect(page.getByLabel('Primary text')).toHaveValue(/meta-policy/);
      await page.getByLabel('Primary text').fill('Buy now, policy fixed');
      await page.getByRole('button', { name: 'Create paused campaign' }).click();
      await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
      await expect(page.getByText('Previous attempts')).toBeVisible();
      const h = (await a.get(`/creatives/${cr.id}/meta`)).data;
      expect(h.history.some((x: any) => x.id === p.id)).toBe(true);
      await tela(page, info, 'pb-02-policy-republicado');
    }
  }
});

test('PB-03 validações: 422 orçamento baixo, 422 sem pixel em SALES (Switch to Traffic), 409 em andamento ([mock:meta-slow]), 409 não aprovado; papéis', async ({ page }, info) => {
  const { c, offer } = await contaPub('val');
  const a = as(c);
  const cr = await criativoAprovado(c, offer.id);
  // 422 budget
  const low = await a.post(`/creatives/${cr.id}/meta/publish`, BODY({ dailyBudgetMinor: 400 }));
  expect(low.status).toBe(422); expect(low.body.error.code).toBe('META_BUDGET_TOO_LOW'); expect(low.body.error.details.minimumMinor).toBe(500);
  await login(page, c.email);
  await page.goto(`/creatives/${cr.id}/send`);
  await page.getByLabel('Daily budget').fill('4');
  await page.getByRole('button', { name: 'Create paused campaign' }).click();
  await expect(page.getByText(/Daily budget must be at least \$5\.00/)).toBeVisible(E);
  await tela(page, info, 'pb-03a-budget');
  // sem pixel: SALES → 422 META_PIXEL_REQUIRED; a tela avisa e troca pra Traffic
  await a.put('/meta/selection', { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: null });
  const nopix = await a.post(`/creatives/${cr.id}/meta/publish`, BODY({ objective: 'OUTCOME_SALES' }));
  expect(nopix.status).toBe(422); expect(nopix.body.error.code).toBe('META_PIXEL_REQUIRED');
  const d = (await a.get(`/creatives/${cr.id}/meta`)).data.defaults;
  expect(d.objective).toBe('OUTCOME_TRAFFIC'); expect(d.objectiveReason).toBe('no_pixel'); expect(d.callToAction).toBe('LEARN_MORE');
  await page.reload();
  await expect(page.getByText('No pixel on this account: ads optimize for clicks.')).toBeVisible(E);
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Sales' }).click();
  await expect(page.getByText('Sales needs a pixel')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Traffic' }).click();
  await expect(page.getByText('Sales needs a pixel')).toHaveCount(0);
  await tela(page, info, 'pb-03b-no-pixel');
  await a.put('/meta/selection', { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
  // 409 em andamento com [mock:meta-slow] (processing_video de 30 s) + progresso na tela
  const slow = await a.post(`/creatives/${cr.id}/meta/publish`, BODY({ headline: 'Slow [mock:meta-slow]' }));
  expect(slow.status, JSON.stringify(slow.body)).toBe(202);
  const dup = await a.post(`/creatives/${cr.id}/meta/publish`, BODY());
  expect(dup.status).toBe(409); expect(dup.body.error.details.reason).toBe('publish_in_progress');
  await page.reload();
  await expect(page.getByText('Publishing…')).toBeVisible(E);
  await expect(page.getByText('Meta is processing the video')).toBeVisible(E);
  await tela(page, info, 'pb-03c-progress');
  // 409 não aprovado / sem render
  const cr2 = await criativoAprovado(c, offer.id, 'Hook não aprovado');
  await sql(`update creatives set state = 'RENDER_READY', final_render_id = null, approved_at = null where id = $1`, [cr2.id]);
  const na = await a.post(`/creatives/${cr2.id}/meta/publish`, BODY());
  expect(na.status).toBe(409); expect(na.body.error.details.reason).toBe('not_approved');
  await page.goto(`/creatives/${cr2.id}/send`);
  await expect(page.getByText('Approve the video first')).toBeVisible(E);
  await tela(page, info, 'pb-03d-not-approved');
  // papéis
  const ok = await atePublicacao(c, cr.id, 120_000);
  expect(ok.publication.status).toBe('PAUSED');
  const mem = await convidar(c, 'MEMBER', 'm');
  const cli = await convidar(c, 'CLIENT', 'cl');
  expect((await as(mem).post(`/creatives/${cr.id}/meta/activate`, { confirm: true })).status).toBe(403);
  expect((await as(mem).post(`/creatives/${cr.id}/meta/pause`)).status).toBe(403);
  expect((await as(cli).post(`/creatives/${cr.id}/meta/publish`, BODY())).status).toBe(403);
  expect((await as(cli).post(`/creatives/${cr.id}/meta/activate`, { confirm: true })).status).toBe(403);
  expect((await as(cli).post(`/creatives/${cr.id}/meta/retry`)).status).toBe(403);
  expect((await as(cli).get(`/creatives/${cr.id}/meta`)).status).toBe(200);
  // retry só em FAILED
  expect((await a.post(`/creatives/${cr.id}/meta/retry`)).status).toBe(409);
  // MEMBER na tela: sem Activate; CLIENT: sem botão nenhum
  await as(mem).post('/workspace/tour/complete'); await as(cli).post('/workspace/tour/complete');
  await page.request.delete('/api/session'); await login(page, mem.email);
  await page.goto(`/creatives/${cr.id}/send`);
  await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
  await expect(page.getByRole('button', { name: 'Activate' })).toHaveCount(0);
  await expect(page.getByText('Only owners and admins can activate or pause.')).toBeVisible();
  await tela(page, info, 'pb-03e-member');
  await page.request.delete('/api/session'); await login(page, cli.email);
  await page.goto(`/creatives/${cr.id}/send`);
  await expect(page.getByRole('heading', { name: 'Created, paused' })).toBeVisible(E);
  await expect(page.getByRole('button', { name: /Activate|Pause|Retry|Edit/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create paused campaign' })).toHaveCount(0);
  await tela(page, info, 'pb-03f-client');
});

test('PB-04 sem conexão → "Connect Meta first"; desconectar mantém a publicação (histórico) e o Ads Manager', async ({ page }, info) => {
  const { c, offer } = await contaPub('noconn', false);
  const cr = await criativoAprovado(c, offer.id);
  const a = as(c);
  expect((await a.post(`/creatives/${cr.id}/meta/publish`, BODY())).status).toBe(422);
  await login(page, c.email);
  await page.goto(`/creatives/${cr.id}/send`);
  await expect(page.getByText('Connect Meta first')).toBeVisible(E);
  await expect(page.getByRole('link', { name: 'Connect Meta' })).toBeVisible();
  await tela(page, info, 'pb-04a-sem-conexao');
  await conectarMeta(c);
  expect((await a.post(`/creatives/${cr.id}/meta/publish`, BODY())).status).toBe(202);
  const p = (await atePublicacao(c, cr.id)).publication;
  expect(p.status).toBe('PAUSED');
  expect((await a.del('/meta/connection')).status).toBe(200);
  const depois = (await a.get(`/creatives/${cr.id}/meta`)).data;
  expect(depois.publication?.id ?? depois.history[0]?.id).toBe(p.id);
  expect((await a.get('/meta/publications')).data.map((x: any) => x.id)).toContain(p.id);
  await page.reload();
  await expect(page.getByText('Connect Meta first')).toBeVisible(E);
  await page.getByText('Previous attempts').click();
  await expect(page.getByText(p.ids.campaignId).or(page.getByRole('link', { name: /Ads Manager/ })).first()).toBeVisible();
  await tela(page, info, 'pb-04b-desconectado-com-historico');
});

test('PB-05 PT-BR da tela de publicar', async ({ page, baseURL }, info) => {
  const { c, offer } = await contaPub('pubpt');
  const cr = await criativoAprovado(c, offer.id);
  await login(page, c.email);
  await ptBR(page, baseURL!);
  await page.goto(`/creatives/${cr.id}/send`);
  await expect(page.getByRole('heading', { name: /Publicar na Meta/ })).toBeVisible(E);
  await tela(page, info, 'pb-05-pt');
});
