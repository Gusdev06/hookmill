// Rodada QA 27/10 no navegador (antes do L5): o que entrou em 648ba99 + be68d98. Web do QA (Next dev, sem MSW) → API do
// QA (mock, render fake, banco *_test próprio). 1440 e 390 (Playwright aplica a viewport por Emulation em cada rota).
// Screenshots em test-results/telas/<projeto>/r26-*.png. Nada pago. Dono: maquina-qa.
//   R26-UI-01 bloqueio sem Meta (Home, Campaigns, Iterate › New): none → Connect Meta; TOKEN_INVALID → Reconnect; MEMBER → "Ask an admin"
//   R26-UI-02 AUTO com HEADLINE: plano com HEADLINE-1..3 ("original → nova"), selo "Captions added", gerar, Download,
//             "Make another batch with this champion" → lote novo do mesmo campeão (PLAN_READY sem upload)
//   R26-UI-03 legenda queimada: "N formats left out", "Send version without captions" (upload) → salvo → Replan → plano novo
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectOk, tokenOf } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { ENV } from '../../harness/env.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { PODCAST, assentou, ateLote, oferta, subirArquivo } from '../../harness/iterate.ts';
import { loginRapido, semRolagemHorizontal, tela } from '../../harness/navegador.ts';
import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });
test.afterEach(async () => { await esperarJobsQuietos(120_000); });
test.beforeEach(async () => {
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  await q(`update users set account_mode = 'OWN'`);
});
const LONGO = { timeout: 600_000 };

function espiao(page: Page) {
  const origens = new Set<string>();
  const erros: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/v1')) origens.add(u.origin); });
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  return { erros, soApiDoQa: () => expect([...origens].filter((o) => o !== new URL(ENV.webUrl).origin), 'o web só fala com a API do QA').toEqual([new URL(ENV.apiUrl).origin]) };
}

async function conectarMetaMock(): Promise<void> {
  const tok = await tokenOf('donoA');
  const u = await call('POST', '/meta/connect', { body: { returnTo: '/settings' }, token: tok });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  const cb = await fetch(u.data.url, { redirect: 'manual' });
  expect(cb.status).toBe(302);
  const s = await call('PUT', '/meta/selection', { body: { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' }, token: tok });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
}

async function campeaoComNotas(offerId: string, notes: string): Promise<string> {
  const s = await subirArquivo('donoA', PODCAST);
  const c = await call('POST', '/champions', { body: { offerId, uploadId: s.uploadId, rights: 'OWN', notes }, token: await tokenOf('donoA') });
  expect(c.status, JSON.stringify(c.body)).toBe(202);
  await expect.poll(async () => (await q(`select status from champions where id = $1`, [c.data.id]))[0].status, { timeout: 120_000 }).toBe('READY');
  return c.data.id;
}

test('R26-UI-01 bloqueio sem Meta: Home, Campaigns e Iterate › New mostram o cadeado (sem números); TOKEN_INVALID = Reconnect; MEMBER pede ao admin', async ({ page }, info) => {
  await oferta('A'); // sem oferta o /iterate/new mostra "Add an offer first" antes do cartão da Meta
  const spy = espiao(page);
  await loginRapido(page, 'donoA');
  // nunca conectou: none
  await page.goto('/');
  const lockHome = page.getByText('Connect your ad account to see CPA, ROAS and campaigns');
  await expect(lockHome).toBeVisible(LONGO);
  await expect(page.getByRole('button', { name: 'Connect Meta' }).first()).toBeVisible();
  await semRolagemHorizontal(page, 'home sem meta');
  await tela(page, info, 'r26-01-home-sem-meta');
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Connect your ad account' })).toBeVisible(LONGO);
  await expect(page.getByRole('button', { name: 'Connect Meta' })).toBeVisible();
  await semRolagemHorizontal(page, 'campaigns sem meta');
  await tela(page, info, 'r26-02-campaigns-sem-meta');
  await page.goto('/iterate/new');
  await expect(page.getByText('Connect your ad account to see CPA, ROAS and campaigns')).toBeVisible(LONGO);
  await tela(page, info, 'r26-03-iterate-new-sem-meta');
  // conecta (mock) → Campaigns abre; login vence → Reconnect
  await conectarMetaMock();
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Connect your ad account' })).toHaveCount(0, LONGO);
  await tela(page, info, 'r26-04-campaigns-conectado');
  await q(`update meta_connections set status = 'TOKEN_INVALID' where workspace_id = 'qa_ws_alfa'`);
  const apiCamp = await as('donoA').get('/meta/campaigns');
  info.annotations.push({ type: 'GET /meta/campaigns com TOKEN_INVALID', description: `${apiCamp.status} ${apiCamp.body?.error?.code}` });
  expect([apiCamp.status, apiCamp.body?.error?.code], 'servidor também bloqueia (nunca o snapshot)').toEqual([422, 'META_TOKEN_INVALID']);
  await page.goto('/');
  await expect(page.getByText('Reconnect your ad account to see CPA, ROAS and campaigns')).toBeVisible(LONGO);
  await expect(page.getByRole('button', { name: 'Reconnect' }).first()).toBeVisible();
  await tela(page, info, 'r26-05-home-token-invalido');
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Reconnect your ad account' })).toBeVisible(LONGO);
  await tela(page, info, 'r26-06-campaigns-token-invalido');
  // checagem bloqueante (scopes bad) num ACTIVE = broken → Reconnect
  await q(`update meta_connections set status = 'ACTIVE', last_health = '{"checks":[{"key":"token","level":"ok"},{"key":"scopes","level":"bad"}]}'::jsonb where workspace_id = 'qa_ws_alfa'`);
  await page.goto('/campaigns');
  await expect(page.getByText('The connection is missing a permission on the ad account.', { exact: false })).toBeVisible(LONGO);
  await tela(page, info, 'r26-07-campaigns-permissao');
  // MEMBER: sem botão, pede ao admin
  await page.context().clearCookies();
  await loginRapido(page, 'membroA');
  await page.goto('/campaigns');
  await expect(page.getByText('Ask an admin to connect the ad account.')).toBeVisible(LONGO);
  await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
  await tela(page, info, 'r26-08-campaigns-member');
  spy.soApiDoQa();
  info.annotations.push({ type: 'erros de console', description: spy.erros.slice(0, 5).join(' | ') || '(nenhum)' });
});

test('R26-UI-02 AUTO com HEADLINE: plano mostra HEADLINE-1..3 com "original → nova" e "Captions added"; gerar → Download → lote novo do mesmo campeão', async ({ page }, info) => {
  test.setTimeout(1_500_000);
  await oferta('A');
  const spy = espiao(page);
  await loginRapido(page, 'adminA');
  await page.goto('/iterate/new');
  await expect(page.locator('input[type=file]').first()).toBeAttached(LONGO);
  await page.locator('input[type=file]').first().setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, LONGO);
  const batchId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  const gerar = page.getByRole('button', { name: /^Generate \d+ pieces/ });
  await expect(gerar).toBeVisible(LONGO);
  const b = (await as('donoA').get(`/iterate/${batchId}`)).data;
  const hs = b.pieces.filter((p: any) => p.type === 'HEADLINE');
  expect(hs.length).toBe(3);
  for (const p of hs) {
    await expect(page.getByText(p.code, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`“${p.headline.original}”`).first(), `${p.code}: original riscada`).toBeVisible();
  }
  await expect(page.getByText('Captions added').first()).toBeVisible();
  await expect(page.getByText(/HOOK_TEXT|\b(iterate|captions)\.[a-z][A-Za-z.]+/)).toHaveCount(0); // sem chave i18n crua
  await semRolagemHorizontal(page, 'plano headline');
  await tela(page, info, 'r26-10-plano-headline');
  await gerar.click();
  await ateLote('adminA', batchId, assentou, { timeoutMs: 900_000, oQue: 'lote assentado' });
  const outro = page.getByRole('button', { name: 'Make another batch with this champion' });
  await expect(outro.first()).toBeVisible(LONGO);
  await page.waitForTimeout(800);
  await semRolagemHorizontal(page, 'download headline');
  await tela(page, info, 'r26-11-download-headline');
  const uploads0 = (await q(`select count(*)::int n from uploads`))[0].n;
  await outro.first().click();
  await page.waitForURL((u) => u.pathname.startsWith('/iterate/') && !u.pathname.includes(batchId), LONGO);
  const novoId = decodeURIComponent(new URL(page.url()).pathname.split('/')[2]);
  expect(novoId).not.toBe(batchId);
  await expect(page.getByRole('button', { name: /^Generate \d+ pieces/ })).toBeVisible(LONGO);
  const novo = (await as('donoA').get(`/iterate/${novoId}`)).data;
  expect(novo.source.championId, 'mesmo campeão').toBe(b.source.championId);
  expect((await q(`select count(*)::int n from uploads`))[0].n, 'sem upload novo').toBe(uploads0);
  await tela(page, info, 'r26-12-lote-novo-mesmo-campeao');
  spy.soApiDoQa();
});

test('R26-UI-03 legenda queimada: formatos de fora com o porquê, envio da versão sem legenda e Replanejar', async ({ page }, info) => {
  test.setTimeout(1_200_000);
  const o = await oferta('A');
  // [mock:burned-captions] sozinho: o desvio/recorte resolve tudo (nada bloqueado, visto no R26-04); [mock:keep-straddle] põe a
  // legenda cruzando o rosto, o que deve impedir o recorte em parte dos templates
  let r: any = null, b: any = null, bloqueados: any[] = [];
  for (const notas of ['[mock:burned-captions]', '[mock:keep-straddle]']) {
    const champ = await campeaoComNotas(o.id, notas);
    r = expectOk(await as('donoA').post('/iterate', { championId: champ }), 202);
    b = await ateLote('donoA', r.id, (x) => x.status === 'PLAN_READY');
    bloqueados = b.insight.captionBlocked ?? [];
    info.annotations.push({ type: `captionBlocked ${notas}`, description: JSON.stringify(bloqueados) });
    if (bloqueados.length) break;
  }
  test.skip(!bloqueados.length, 'nenhum gatilho do mock deixa formato bloqueado por burned_captions: tela não exercitável (pedir gatilho à ia)');
  const spy = espiao(page);
  await loginRapido(page, 'adminA');
  await page.goto(`/iterate/${r.id}`);
  await expect(page.getByRole('button', { name: /^Generate \d+ pieces/ })).toBeVisible(LONGO);
  expect(bloqueados.length, 'campeão com legenda queimada deixa algo de fora (moldura que tampa)').toBeGreaterThan(0);
  await expect(page.getByText(/formats? left out: the video has burned-in captions/)).toBeVisible();
  await expect(page.getByText('This format needs the video without captions', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Captions added')).toHaveCount(0);
  await semRolagemHorizontal(page, 'plano bloqueado');
  await tela(page, info, 'r26-20-plano-legenda-queimada');
  const enviar = page.getByRole('button', { name: 'Send version without captions' });
  await expect(enviar).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), enviar.click()]);
  await chooser.setFiles(PODCAST);
  await expect(page.getByText('Version without captions saved.').first()).toBeVisible(LONGO);
  await tela(page, info, 'r26-21-versao-sem-legenda-salva');
  const replan = page.getByRole('button', { name: 'Replan with the version without captions' });
  await expect(replan).toBeVisible(LONGO);
  await replan.click();
  await ateLote('donoA', r.id, (x) => x.status === 'PLAN_READY' && (x.insight?.captionBlocked ?? []).length === 0, { timeoutMs: 120_000, oQue: 'replanejado' });
  await expect(page.getByText('Captions added').first()).toBeVisible(LONGO);
  await expect(page.getByText(/formats? left out: the video has burned-in captions/)).toHaveCount(0);
  await tela(page, info, 'r26-22-replanejado');
  spy.soApiDoQa();
});
