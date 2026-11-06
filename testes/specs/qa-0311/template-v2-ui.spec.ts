// QA 03/11 (Q1 do meta-templates-v2): editor de template em página inteira + envio, no navegador (1440 e 390), contra a
// API real em mock (harness/api-qa-espiao.cjs) e o web de teste sem MSW. F1-F4 da spec template-campanha, os 6 campos
// novos, ABO movendo o orçamento, erro pulando pro nível, prévia com @, sem rolagem lateral e console limpo. Dono: maquina-qa.
// Rodar (de testes/): E2E_API_PORT=3161 E2E_WEB_PORT=3256 E2E_COM_WEB=1 E2E_SKIP_SCHEMA=1 \
//   E2E_EXIGE_MIGRACAO=20261101000100_templates_cold_open_endcard npx playwright test -c playwright.qa0311.config.ts --project=qa0311-1440 --project=qa0311-390
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, tokenOf } from '../../harness/api.ts';
import { q, resetDb } from '../../harness/db.ts';
import { ENV, TESTES_DIR } from '../../harness/env.ts';
import { oferta } from '../../harness/iterate.ts';
import { loginRapido } from '../../harness/navegador.ts';

const SPY = ENV.apiUrl.replace(/\/api\/v1$/, '') + '/__qa/meta-sent';
const TELAS = join(TESTES_DIR, 'test-results', 'qa-0311-telas');

/** console.error + pageerror por teste (anexado; o teste checa no fim). */
const test = base.extend<{ erros: string[] }>({
  erros: async ({ page }, use) => {
    const erros: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`console: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message.slice(0, 300)}`));
    // o selo "N" do next dev fica no canto inferior esquerdo, por cima do Back/Archive do rodapé (só existe em dev)
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(st); }));
    await use(erros);
  },
});
test.use({ actionTimeout: 20_000 });
test.describe.configure({ timeout: 240_000 });

async function tela(page: Page, info: TestInfo, nome: string) {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nome}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}
async function semLateral(page: Page, onde: string, notas: string[]) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, x0: (window.scrollTo(400, window.scrollY), window.scrollX) }));
  await page.evaluate(() => window.scrollTo(0, window.scrollY));
  notas.push(`${onde}: scrollWidth ${r.sw} clientWidth ${r.cw} scrollX após scrollTo(400) ${r.x0}`);
  expect.soft(r.x0, `${onde}: rola na horizontal (scrollWidth ${r.sw} > ${r.cw})`).toBe(0);
}
const celular = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;
async function nivel(page: Page, n: 0 | 1 | 2) {
  const nome = ['Campaign', 'Ad set', 'Ad'][n];
  if (celular(page)) await page.getByRole('tab').nth(n).click();
  else await page.getByRole('navigation', { name: 'Campaign structure' }).getByRole('button').nth(n).click();
  await expect(page.locator('main h2').first()).toHaveText(nome);
}
const h2 = (page: Page) => page.locator('main h2').first();
/** Opção de um Select do Radix pelo rótulo do campo. */
async function escolher(page: Page, label: string | RegExp, opcao: string | RegExp) {
  await page.getByLabel(label, { exact: typeof label === 'string' }).first().click();
  await page.getByRole('option', { name: opcao }).first().click();
}
async function multi(page: Page, label: string, add: string, opcao: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('listbox', { name: add }).getByText(opcao).first().click();
  await page.keyboard.press('Escape');
}

async function conectarMeta(token: string) {
  const u = await call('POST', '/meta/connect', { body: { returnTo: '/settings' }, token });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  expect((await fetch(u.data.url, { redirect: 'manual' })).status).toBe(302);
  const s = await call('PUT', '/meta/selection', { body: { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' }, token });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  await expect.poll(async () => (await call('GET', '/meta/summary', { token })).data?.sync?.state, { timeout: 90_000 }).toBe('ok');
}
async function criativos(n: number): Promise<string[]> {
  const off = await oferta('A');
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `qa0311u${i}${Date.now().toString(36)}`;
    await q(`insert into creatives (id, workspace_id, offer_id, name, language, state, approved_at, approved_by_id, ad_name, variation_code, created_by_id, updated_at)
             values ($1,'qa_ws_alfa',$2,$3,'en','APPROVED',now(),'qa_user_dono_a',$4,$5,'qa_user_dono_a',now())`, [id, off.id, `Hook ${i}`, `QA_0311_${i}`, `HEADLINE-${String(i).padStart(2, '0')}`]);
    await q(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height) values ($1,'qa_ws_alfa','RENDER_VIDEO',$2,'video/mp4',1000000,20,1080,1920)`, [`${id}f`, `ws/qa_ws_alfa/render_video/${id}.mp4`]);
    await q(`insert into renders (id, workspace_id, creative_id, status, settings, input, file_id, duration_sec) values ($1,'qa_ws_alfa',$2,'READY','{}'::jsonb,'{}'::jsonb,$3,20)`, [`${id}r`, id, `${id}f`]);
    await q(`update creatives set final_render_id = $2 where id = $1`, [id, `${id}r`]);
    ids.push(id);
  }
  return ids;
}
async function preparar(): Promise<{ tok: string; ids: string[] }> {
  await resetDb();
  await q(`update users set account_mode = 'OWN'`);
  await q(`update workspaces set onboarding_completed_at = now(), market = 'US', website_url = 'https://example.com/'`).catch(async () => {
    await q(`update workspaces set onboarding_completed_at = now()`);
  });
  await q(`update memberships set tour_completed_at = now()`);
  const tok = await tokenOf('donoA');
  await conectarMeta(tok);
  return { tok, ids: await criativos(3) };
}
const tplApi = (over: Record<string, any> = {}) => ({
  name: over.name ?? 'QA API v1', isDefault: over.isDefault ?? false,
  campaign: { destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 2000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null, specialAdCategories: [], namePattern: 'HookMill — {offer}', ...over.campaign },
  adset: { pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US'], ageMin: 18, ageMax: 65, genders: 'ALL', advantageAudience: true, placements: 'AUTO', adsPerAdset: { min: 4, max: 8 }, namePattern: '{offer} — {date} — {n}', ...over.adset },
  ad: { primaryText: null, headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com/', urlTags: null, namePattern: '{code}', ...over.ad },
});
async function preencherObrigatorios(page: Page) {
  // Locations / Website URL podem vir vazios (sem mercado/site no workspace)
  await nivel(page, 1);
  const geo = page.getByLabel('Locations');
  if (!(await geo.inputValue())) await geo.fill('US');
  await nivel(page, 2);
  const link = page.getByLabel('Website URL');
  if (!(await link.inputValue())) await link.fill('https://example.com/');
}
async function publicado(id: string) {
  await expect.poll(async () => (await q<{ status: string }>(`select status from meta_publications where creative_id = $1 order by created_at desc limit 1`, [id]))[0]?.status ?? 'NONE', { timeout: 120_000 }).toMatch(/^(PAUSED|ACTIVE|FAILED)$/);
  return (await q(`select status, error_code, fail_reason, template_id, settings from meta_publications where creative_id = $1 order by created_at desc limit 1`, [id]))[0];
}
function salvarNotas(info: TestInfo, nome: string, notas: unknown) {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${nome}.json`), JSON.stringify(notas, null, 2));
}

// ───────────── F1: envio sem template → editor → salvar → volta selecionado → publicar paused ─────────────
test('F1: sem template → editor (orçamento vazio, erro) → salvar → volta com o template → publicar paused', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${ids[0]}/send`);
  await expect(page.getByText('No campaign template yet')).toBeVisible({ timeout: 60_000 });
  await semLateral(page, 'send vazio', notas);
  await tela(page, info, 'f1-01-send-vazio');
  await page.getByRole('link', { name: 'Create paused campaign' }).click();
  await page.waitForURL(/\/publish\/template\/new\?/);
  await expect(page.getByText('Set up how your ads go up on Meta.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Template name')).toHaveValue('Tests · CBO 4–8 · US');
  const padrao = page.getByRole('checkbox', { name: /Default for/ });
  notas.push(`1º template: default marcado=${await padrao.isChecked()} travado=${await padrao.isDisabled()}`);
  expect(await padrao.isChecked()).toBe(true);
  expect(await padrao.isDisabled()).toBe(true);
  const orc = page.getByLabel('Daily budget', { exact: true });
  expect(await orc.inputValue(), 'orçamento do 1º template vazio').toBe('');
  // destino padrão REUSE
  expect(await page.getByRole('radio', { name: /One campaign for every publish/ }).isChecked()).toBe(true);
  await semLateral(page, 'editor novo', notas);
  await tela(page, info, 'f1-02-editor-novo');
  // salvar sem orçamento: erro no campo, nó com bolinha, rodapé com contagem
  await nivel(page, 2);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(h2(page), 'Save pula pro nível do 1º erro').toHaveText('Campaign');
  await expect(page.getByText('Enter a daily budget.')).toBeVisible();
  if (celular(page)) await expect(page.getByRole('tab', { name: /Campaign/ }).getByLabel(/1 error/)).toBeVisible();
  else await expect(page.getByText(/field(s)? needs? attention/)).toBeVisible();
  await tela(page, info, 'f1-03-erro-orcamento');
  await orc.fill('3');
  await expect(page.getByText(/Below Meta’s minimum for this account: \$5\.00 a day\./)).toBeVisible();
  await tela(page, info, 'f1-04-abaixo-minimo');
  await page.getByRole('button', { name: /Use \$5\.00/ }).click();
  expect(await orc.inputValue()).toMatch(/^5(\.00)?$/);
  await orc.fill('20');
  await preencherObrigatorios(page);
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(new RegExp(`/creatives/${ids[0]}/send\\?.*template=`), { timeout: 30_000 });
  await expect(page.getByText(/saved and selected for this publish/)).toBeVisible();
  const lista = (await call('GET', '/meta/templates', { token: tok })).data;
  notas.push(`template salvo: ${JSON.stringify(lista.map((t: any) => [t.name, t.isDefault, t.campaign.dailyBudgetMinor, t.campaign.destination, t.campaign.budgetType ?? 'ausente']))}`);
  expect(lista).toHaveLength(1);
  expect(lista[0].campaign.dailyBudgetMinor).toBe(2000);
  expect(new URL(page.url()).searchParams.get('template')).toBe(lista[0].id);
  await expect(page.getByLabel('Publish template')).toContainText('Tests · CBO 4–8 · US');
  await semLateral(page, 'send com template', notas);
  await tela(page, info, 'f1-05-send-selecionado');
  await page.getByRole('button', { name: 'Create paused campaign' }).click();
  const pub = await publicado(ids[0]);
  notas.push(`publicação: ${JSON.stringify(pub)}`);
  expect(pub.status).toBe('PAUSED');
  expect(pub.template_id).toBe(lista[0].id);
  await page.waitForTimeout(1500);
  await tela(page, info, 'f1-06-publicado');
  notas.push(...erros);
  salvarNotas(info, 'f1', notas);
  expect.soft(erros, 'console sem erro').toEqual([]);
});

// ───────────── os 6 campos novos pela tela + publicar (corpo da porta) ─────────────
test('v2: Awareness + total (CBO trava NEW) + 7 dias + idiomas + públicos + Instagram (prévia com @) → salvar → publicar', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA base', isDefault: true }) });
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${ids[0]}/send`);
  await expect(page.getByLabel('Publish template')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: 'New template' }).click();
  await page.waitForURL(/\/publish\/template\/new\?/);
  await page.getByLabel('Template name').fill('QA v2 tela');
  expect(await page.getByRole('checkbox', { name: /Default for/ }).isChecked(), 'New template vem com padrão desmarcado').toBe(false);
  // Campanha: Awareness, Lifetime
  await page.getByRole('radio', { name: /^Awareness/ }).click();
  await escolher(page, 'Budget', 'Lifetime');
  await expect(page.getByText(/A lifetime budget with Advantage\+ campaign budget needs a new campaign each publish/)).toBeVisible();
  expect(await page.getByRole('radio', { name: /A new campaign for each batch/ }).isChecked(), 'CBO + total trava NEW').toBe(true);
  await page.getByLabel('Lifetime budget', { exact: true }).fill('300');
  await tela(page, info, 'v2-01-campanha');
  // Conjunto: performance goal, agendamento, idiomas, públicos
  await nivel(page, 1);
  await expect(page.getByLabel('Pixel')).toHaveCount(0);
  await escolher(page, 'Performance goal', 'Maximize reach of ads');
  await page.getByRole('group', { name: 'End' }).getByText('After N days').click().catch(async () => page.getByRole('radio', { name: 'After N days' }).click());
  const dias = page.locator('input[inputmode=numeric]').filter({ hasNot: page.getByLabel(/age/i) });
  await page.getByText('days after the start').locator('xpath=preceding-sibling::input').fill('7');
  await expect(page.getByText(/Ends 7 days after it starts/)).toBeVisible();
  await expect(page.getByText(/Times in America\/New_York \(ad account\)/)).toBeVisible();
  void dias;
  await multi(page, 'Languages', 'Add language', 'English (US)');
  await multi(page, 'Custom audiences · Include', 'Add audience to include', /Lookalike \(US, 1%\)/);
  await multi(page, 'Custom audiences · Exclude', 'Add audience to exclude', 'Website buyers 180d');
  await expect(page.getByText(/Meta treats included audiences as a suggestion/)).toBeVisible();
  // público não usável: selo + aviso
  await page.getByLabel('Custom audiences · Include', { exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Add audience to include' }).getByText('Not usable').first()).toBeVisible();
  await tela(page, info, 'v2-02-publicos-aberto');
  await page.keyboard.press('Escape');
  const geo = page.getByLabel('Locations');
  if (!(await geo.inputValue())) await geo.fill('US');
  await semLateral(page, 'editor conjunto v2', notas);
  await tela(page, info, 'v2-03-conjunto');
  // a campanha agora mostra o mínimo do total por 7 dias
  await nivel(page, 0);
  notas.push(`hint do total: ${await page.getByText(/At least .* for 7 days/).textContent().catch(() => 'AUSENTE')}`);
  await expect(page.getByText(/At least \$35\.00 for 7 days/)).toBeVisible();
  // Anúncio: Instagram + prévia
  await nivel(page, 2);
  await escolher(page, 'Instagram account', '@hookmill.demo');
  const prev = page.getByRole('complementary', { name: 'Ad preview' });
  await expect(prev).toContainText('hookmill.demo');
  const link = page.getByLabel('Website URL');
  if (!(await link.inputValue())) await link.fill('https://example.com/');
  await semLateral(page, 'editor anúncio v2', notas);
  await tela(page, info, 'v2-04-anuncio-previa');
  // resumo da árvore (desktop)
  if (!celular(page)) notas.push(`árvore: ${(await page.getByRole('navigation', { name: 'Campaign structure' }).innerText()).replace(/\s+/g, ' ')}`);
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(new RegExp(`/creatives/${ids[0]}/send\\?.*template=`), { timeout: 30_000 });
  const salvo = (await call('GET', '/meta/templates', { token: tok })).data.find((t: any) => t.name === 'QA v2 tela');
  notas.push(`salvo: ${JSON.stringify({ campaign: salvo?.campaign, adset: salvo?.adset, ad: salvo?.ad })}`);
  expect(salvo.campaign).toMatchObject({ objective: 'OUTCOME_AWARENESS', budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, dailyBudgetMinor: 0, destination: 'NEW_CAMPAIGN' });
  expect(salvo.adset).toMatchObject({ optimizationGoal: 'REACH', pixelId: null, pixelEvent: null, schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }, locales: [{ key: 6, name: 'English (US)' }] });
  expect(salvo.adset.customAudiences.map((x: any) => x.id)).toEqual(['ca_mock_lal_1']);
  expect(salvo.adset.excludedCustomAudiences.map((x: any) => x.id)).toEqual(['ca_mock_buyers']);
  expect(salvo.ad.instagramAccount).toEqual({ id: 'ig_mock_1', username: 'hookmill.demo' });
  const resumo = (await page.locator('dl').first().innerText()).replace(/\s+/g, ' ');
  notas.push(`resumo no envio: ${resumo}`);
  expect.soft(resumo).toMatch(/Awareness/);
  expect.soft(resumo).toMatch(/\$300(\.00)? total/);
  expect.soft(resumo).toMatch(/7 days/);
  expect.soft(resumo).toMatch(/@hookmill\.demo/);
  await semLateral(page, 'send v2', notas);
  await tela(page, info, 'v2-05-send-resumo');
  await fetch(SPY + '/reset', { method: 'POST' });
  await page.getByRole('button', { name: 'Create paused campaign' }).click();
  const pub = await publicado(ids[0]);
  const sent = await (await fetch(SPY)).json();
  notas.push(`pub: ${JSON.stringify(pub)}`, `corpos: ${JSON.stringify(sent)}`);
  expect(pub.status).toBe('PAUSED');
  expect(sent.campaigns[0]).toMatchObject({ objective: 'OUTCOME_AWARENESS', lifetime_budget: 30000 });
  expect(sent.adsets[0]).toMatchObject({ optimization_goal: 'REACH', end_time: expect.any(String) });
  expect(sent.adsets[0].targeting).toMatchObject({ locales: [6], custom_audiences: [{ id: 'ca_mock_lal_1' }], excluded_custom_audiences: [{ id: 'ca_mock_buyers' }] });
  expect(sent.creatives[0].object_story_spec.instagram_user_id).toBe('ig_mock_1');
  await page.waitForTimeout(1500);
  await tela(page, info, 'v2-06-publicado');
  notas.push(...erros);
  salvarNotas(info, 'v2', notas);
  expect.soft(erros, 'console sem erro').toEqual([]);
});

// ───────────── ABO move orçamento pro Conjunto; erro pula pro Conjunto; Engagement troca limpa pixel ─────────────
test('ABO: orçamento vai pro Conjunto; Save sem orçamento pula pro Conjunto; trocar objetivo limpa pixel; pixel em Sales volta', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA base', isDefault: true }) });
  await loginRapido(page, 'donoA');
  await page.goto(`/publish/template/new?return=${encodeURIComponent(`/creatives/${ids[0]}/send`)}`);
  await expect(page.getByLabel('Template name')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Template name').fill('QA ABO');
  await expect(page.getByLabel('Daily budget', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: /Advantage\+ campaign budget/ }).click();
  await expect(page.getByLabel('Daily budget', { exact: true })).toHaveCount(0);
  await tela(page, info, 'abo-01-campanha-sem-orcamento');
  await nivel(page, 1);
  await expect(page.getByText('Budget & schedule')).toBeVisible();
  await expect(page.getByLabel('Daily budget per ad set')).toBeVisible();
  await page.getByLabel('Daily budget per ad set').fill('');
  await tela(page, info, 'abo-02-conjunto-orcamento');
  // Engagement: pixel some, goal aparece; voltar pra Sales: pixel volta e goal some
  await nivel(page, 0);
  await page.getByRole('radio', { name: /^Engagement/ }).click();
  await nivel(page, 1);
  await expect(page.getByLabel('Pixel')).toHaveCount(0);
  await expect(page.getByLabel('Performance goal')).toBeVisible();
  await nivel(page, 0);
  await page.getByRole('radio', { name: /^Sales/ }).click();
  await nivel(page, 1);
  await expect(page.getByLabel('Pixel')).toBeVisible();
  await tela(page, info, 'abo-03-sales-pixel-voltou');
  // Save do nível Anúncio com orçamento vazio → pula pro Conjunto
  await nivel(page, 2);
  const link = page.getByLabel('Website URL');
  if (!(await link.inputValue())) await link.fill('https://example.com/');
  await nivel(page, 1);
  const geo = page.getByLabel('Locations');
  if (!(await geo.inputValue())) await geo.fill('US');
  await nivel(page, 2);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(h2(page), 'erro de orçamento ABO cai no Conjunto').toHaveText('Ad set');
  await expect(page.getByText('Enter a daily budget.')).toBeVisible();
  if (celular(page)) await expect(page.getByRole('tab', { name: /Ad set/ }).getByLabel(/error/)).toBeVisible();
  else await expect(page.getByRole('navigation', { name: 'Campaign structure' }).getByRole('button').nth(1).getByLabel(/error/)).toBeVisible();
  await semLateral(page, 'ABO erro', notas);
  await tela(page, info, 'abo-04-erro-no-conjunto');
  // Lifetime em ABO: REUSE continua permitido
  await escolher(page, 'Budget', 'Lifetime');
  await page.getByLabel('Lifetime budget per ad set').fill('100');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('A lifetime budget needs an end.')).toBeVisible();
  await tela(page, info, 'abo-05-lifetime-sem-fim');
  await page.getByText('After N days').click();
  await page.getByText('days after the start').locator('xpath=preceding-sibling::input').fill('7');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(new RegExp(`/creatives/${ids[0]}/send\\?.*template=`), { timeout: 30_000 });
  const salvo = (await call('GET', '/meta/templates', { token: tok })).data.find((t: any) => t.name === 'QA ABO');
  notas.push(`salvo: ${JSON.stringify(salvo?.campaign)}`);
  expect(salvo.campaign).toMatchObject({ budgetMode: 'ABO', budgetType: 'LIFETIME', lifetimeBudgetMinor: 10000, destination: 'REUSE_CAMPAIGN' });
  notas.push(...erros);
  salvarNotas(info, 'abo', notas);
  expect.soft(erros, 'console sem erro').toEqual([]);
});

// ───────────── erro do envio (400 com templateId) abre o editor no nível do campo ─────────────
test('envio: Instagram que sumiu / fim vencido → alerta → Edit template abre no nível certo com o erro', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  const t = (await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA vencido', isDefault: true }) })).data;
  await q(`update meta_publish_templates set ad = ad || '{"instagramAccount":{"id":"ig_mock_gone","username":"gone.acct"}}'::jsonb where id = $1`, [t.id]);
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${ids[0]}/send`);
  await page.getByRole('button', { name: 'Create paused campaign' }).click({ timeout: 60_000 });
  await expect(page.getByText(/A setting of this template doesn.t work for today’s publish/)).toBeVisible();
  await tela(page, info, 'env-01-alerta-ig');
  await page.getByRole('alert').or(page.locator('[role=alert], .alert')).getByRole('link', { name: 'Edit template' }).first().click().catch(async () => {
    await page.getByRole('link', { name: 'Edit template' }).first().click();
  });
  await page.waitForURL(/\/publish\/template\//);
  await expect(h2(page)).toHaveText('Ad', { timeout: 30_000 });
  await expect(page.getByText('Not in this ad account anymore. Pick another.')).toBeVisible();
  await tela(page, info, 'env-02-editor-ig');
  // fim vencido → Conjunto
  await q(`update meta_publish_templates set ad = ad || '{"instagramAccount":null}'::jsonb, adset = adset || '{"schedule":{"start":null,"end":{"kind":"AT","at":"2026-01-01T10:00"}}}'::jsonb where id = $1`, [t.id]);
  await page.goto(`/creatives/${ids[0]}/send`);
  await page.getByRole('button', { name: 'Create paused campaign' }).click({ timeout: 60_000 });
  await expect(page.getByText(/A setting of this template doesn.t work for today’s publish/)).toBeVisible();
  await page.getByRole('link', { name: 'Edit template' }).first().click();
  await page.waitForURL(/\/publish\/template\//);
  await expect(h2(page)).toHaveText('Ad set', { timeout: 30_000 });
  await expect(page.getByText('That time has already passed.')).toBeVisible();
  await semLateral(page, 'editor erro de envio', notas);
  await tela(page, info, 'env-03-editor-fim-vencido');
  notas.push(...erros);
  salvarNotas(info, 'envio-erro', notas);
  // o 400 do publish aparece no console do navegador como recurso com falha: registra, não reprova
  expect.soft(erros.filter((e) => !/status of 400/.test(e)), 'console sem erro além do 400 esperado').toEqual([]);
});

// ───────────── F2: seletor com Edit / New / Import / Custom ─────────────
test('F2: seletor com padrão marcado, Edit (dados), Import (mock_cmp_life → Copied/Adjusted → salvar volta selecionado), Custom continua', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA padrão', isDefault: true }) });
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA segundo' }) });
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${ids[0]}/send`);
  const sel = page.getByLabel('Publish template');
  await expect(sel).toContainText('QA padrão (default)', { timeout: 60_000 });
  for (const n of ['Edit', 'New template', 'Import from a campaign']) await expect(page.getByRole('link', { name: n, exact: true })).toBeVisible();
  await sel.click();
  const opcoes = await page.getByRole('option').allInnerTexts();
  notas.push(`opções do seletor: ${JSON.stringify(opcoes)}`);
  expect(opcoes).toEqual(['QA padrão (default)', 'QA segundo', 'Custom (fill the form)']);
  await tela(page, info, 'f2-01-seletor-aberto');
  // teclado (no 390 o clique na opção do Radix Select não estabiliza no headless com toque)
  if (!(await page.getByRole('option', { name: 'Custom (fill the form)' }).isVisible())) await sel.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  await tela(page, info, 'f2-02-custom');
  // objetivos do Custom: continua com 4
  const objCustom = await page.getByRole('radio').allInnerTexts().catch(() => []);
  notas.push(`Custom: radios ${JSON.stringify(objCustom).slice(0, 400)}`);
  await sel.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(sel).toContainText('QA padrão (default)');
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.waitForURL(/\/publish\/template\/[^n]/);
  await expect(page.getByLabel('Template name')).toHaveValue('QA padrão');
  await expect(page.getByLabel('Daily budget', { exact: true })).toHaveValue(/^20(\.00)?$/);
  await tela(page, info, 'f2-03-edit');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForURL(new RegExp(`/creatives/${ids[0]}/send`));
  // Import
  await page.getByRole('link', { name: 'Import from a campaign', exact: true }).click();
  await page.waitForURL(/\/publish\/template\/new\?.*import=1/);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Import from a campaign')).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByRole('button', { name: 'Use' }).first()).toBeVisible({ timeout: 30_000 });
  const linhas = (await dlg.innerText()).replace(/\s+/g, ' ');
  notas.push(`diálogo de importar: ${linhas.slice(0, 600)}`, `tem Awareness: ${/Brand awareness/.test(linhas)}`);
  await semLateral(page, 'diálogo importar', notas);
  await tela(page, info, 'f2-04-importar-dialogo');
  await dlg.getByText('Mock — Launch (lifetime)').locator('xpath=ancestor::*[.//button[normalize-space()="Use"]][1]').getByRole('button', { name: 'Use' }).click();
  await expect(page.getByText(/Copied from “Mock — Launch \(lifetime\)”/)).toBeVisible({ timeout: 30_000 });
  const faixa = (await page.getByRole('status').filter({ hasText: 'Copied from' }).innerText()).replace(/\s+/g, ' ');
  notas.push(`faixa: ${faixa}`);
  expect(faixa).toMatch(/Adjusted: .*30 days/);
  await expect(page.getByLabel('Lifetime budget', { exact: true })).toHaveValue(/^300(\.00)?$/);
  expect(await page.getByRole('radio', { name: /A new campaign for each batch/ }).isChecked()).toBe(true);
  await tela(page, info, 'f2-05-importado');
  await page.getByLabel('Template name').fill('QA importado life');
  await preencherObrigatorios(page);
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(new RegExp(`/creatives/${ids[0]}/send\\?.*template=`), { timeout: 30_000 });
  await expect(sel).toContainText('QA importado life');
  const imp = (await call('GET', '/meta/templates', { token: tok })).data.find((t: any) => t.name === 'QA importado life');
  notas.push(`importado salvo: ${JSON.stringify({ c: imp?.campaign, s: imp?.adset?.schedule, src: imp?.source })}`);
  expect(imp.source).toBe('IMPORTED');
  expect(imp.campaign).toMatchObject({ budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, destination: 'NEW_CAMPAIGN' });
  await tela(page, info, 'f2-06-volta-selecionado');
  notas.push(...erros);
  salvarNotas(info, 'f2', notas);
  expect.soft(erros, 'console sem erro').toEqual([]);
});

// ───────────── F3: Settings → editar → Archive ─────────────
test('F3: Settings › Templates mostra os campos v2 no resumo, abre o editor (sem Import, com Archive), salva e arquiva', async ({ page, erros }, info) => {
  const { tok } = await preparar();
  const notas: string[] = [];
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA padrão', isDefault: true }) });
  const v2 = await call('POST', '/meta/templates', { token: tok, body: tplApi({
    name: 'QA v2 settings',
    campaign: { objective: 'OUTCOME_AWARENESS', destination: 'NEW_CAMPAIGN', budgetType: 'LIFETIME', dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000 },
    adset: { pixelId: null, pixelEvent: null, optimizationGoal: 'REACH', schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 7 } }, locales: [{ key: 6, name: 'English (US)' }], customAudiences: [{ id: 'ca_mock_lal_1', name: 'LAL' }], excludedCustomAudiences: [{ id: 'ca_mock_buyers', name: 'Buyers' }] },
    ad: { callToAction: 'LEARN_MORE', instagramAccount: { id: 'ig_mock_1', username: 'hookmill.demo' } },
  }) });
  expect(v2.status, JSON.stringify(v2.body)).toBe(201);
  await loginRapido(page, 'donoA');
  await page.goto('/settings/connections/templates');
  await expect(page.getByText('QA v2 settings')).toBeVisible({ timeout: 60_000 });
  const card = (await page.getByText('QA v2 settings', { exact: true }).locator('xpath=ancestor::*[.//*[normalize-space()="Edit"]][1]').innerText()).replace(/\s+/g, ' ');
  notas.push(`cartão v2 na lista: ${card}`);
  const v2NaLista = { awareness: /Awareness/.test(card), total: /total/i.test(card), dias: /7 days/.test(card), ig: /hookmill\.demo/.test(card), idioma: /English/.test(card) };
  notas.push(`campos v2 no resumo do Settings: ${JSON.stringify(v2NaLista)}`);
  await semLateral(page, 'settings lista', notas);
  await tela(page, info, 'f3-01-lista');
  await page.getByText('QA v2 settings', { exact: true }).locator('xpath=ancestor::*[.//*[normalize-space()="Edit"]][1]').getByText('Edit', { exact: true }).click();
  await page.waitForURL(/\/settings\/connections\/templates\/[^/?]+/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Settings');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Templates');
  await expect(page.getByRole('button', { name: 'Import from a campaign' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
  await semLateral(page, 'settings editor', notas);
  await tela(page, info, 'f3-02-editor');
  await page.getByLabel('Template name').fill('QA v2 settings editado');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.waitForURL(/\/settings\/connections\/templates$/, { timeout: 30_000 });
  await expect(page.getByText('QA v2 settings editado', { exact: true })).toBeVisible();
  const depois = (await call('GET', '/meta/templates', { token: tok })).data.find((t: any) => t.id === v2.data.id);
  expect(depois.adset.locales, 'salvar pelo editor preserva campos v2').toEqual([{ key: 6, name: 'English (US)' }]);
  expect(depois.ad.instagramAccount).toEqual({ id: 'ig_mock_1', username: 'hookmill.demo' });
  await page.getByText('QA v2 settings editado', { exact: true }).locator('xpath=ancestor::*[.//*[normalize-space()="Edit"]][1]').getByText('Edit', { exact: true }).click();
  await page.waitForURL(/\/settings\/connections\/templates\/[^/?]+/);
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.waitForURL(/\/settings\/connections\/templates$/, { timeout: 30_000 });
  await expect(page.getByText(/Archived “QA v2 settings editado”/)).toBeVisible();
  await expect(page.getByText('QA v2 settings editado', { exact: true })).toHaveCount(0, { timeout: 10_000 }).catch(() => undefined);
  const restantes = (await call('GET', '/meta/templates', { token: tok })).data.map((t: any) => t.name);
  notas.push(`depois de arquivar: ${JSON.stringify(restantes)}`);
  expect(restantes).toEqual(['QA padrão']);
  await tela(page, info, 'f3-03-arquivado');
  notas.push(...erros);
  salvarNotas(info, 'f3', notas);
  expect.soft(v2NaLista, 'resumo do Settings mostra os campos v2 (pendência useTemplateSummary)').toEqual({ awareness: true, total: true, dias: true, ig: true, idioma: true });
  expect.soft(erros, 'console sem erro').toEqual([]);
});

// ───────────── F4: Meta expirada ─────────────
test('F4: Meta expirada → alerta + Reconnect, Publish desabilitado; Edit abre com faixa âmbar e Save desabilitado', async ({ page, erros }, info) => {
  const { tok, ids } = await preparar();
  const notas: string[] = [];
  await call('POST', '/meta/templates', { token: tok, body: tplApi({ name: 'QA padrão', isDefault: true }) });
  await q(`update meta_connections set status = 'TOKEN_INVALID' where workspace_id = 'qa_ws_alfa'`);
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${ids[0]}/send`);
  const alerta = page.getByText(/Meta connection expired|Your Meta login expired/).first();
  await expect(alerta).toBeVisible({ timeout: 60_000 });
  notas.push(`alerta no envio: ${(await alerta.textContent())}`);
  await expect(page.getByRole('link', { name: /Reconnect/ }).first()).toBeVisible();
  const pubBtn = page.getByRole('button', { name: 'Create paused campaign' });
  const estado = (await pubBtn.count()) ? (await pubBtn.isDisabled() ? 'desabilitado' : 'HABILITADO') : 'ausente';
  notas.push(`botão publicar com Meta expirada: ${estado}`);
  expect(estado).not.toBe('HABILITADO');
  await semLateral(page, 'send expirado', notas);
  await tela(page, info, 'f4-01-send-expirado');
  const edit = page.getByRole('link', { name: 'Edit', exact: true });
  notas.push(`Edit visível no envio com Meta expirada: ${await edit.isVisible().catch(() => false)}`);
  // editor NOVO com a Meta expirada: faixa âmbar + Save desabilitado
  await page.goto(`/publish/template/new?return=${encodeURIComponent(`/creatives/${ids[0]}/send`)}`);
  const faixaNovo = await page.getByText(/Meta connection expired\.|Couldn't open the template/).first().waitFor({ timeout: 30_000 }).then(() => page.getByText('Meta connection expired.').isVisible()).catch(() => false);
  const telaNovo = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  notas.push(`editor novo expirado: faixa=${faixaNovo} tela="${telaNovo}"`);
  await semLateral(page, 'editor novo expirado', notas);
  await tela(page, info, 'f4-02-editor-novo-expirado');
  // editor de um template EXISTENTE (o Edit da spec F4)
  const tid = (await q<{ id: string }>(`select id from meta_publish_templates where workspace_id = 'qa_ws_alfa' and archived_at is null limit 1`))[0].id;
  await page.goto(`/publish/template/${tid}?return=${encodeURIComponent(`/creatives/${ids[0]}/send`)}`);
  await page.waitForTimeout(4000);
  const telaEdit = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  const abriu = await page.getByLabel('Template name').isVisible().catch(() => false);
  notas.push(`editor existente expirado: abriu=${abriu} tela="${telaEdit}"`);
  await tela(page, info, 'f4-03-editor-existente-expirado');
  expect.soft(faixaNovo, 'editor novo mostra a faixa âmbar').toBe(true);
  if (faixaNovo) expect.soft(await page.getByRole('button', { name: 'Save template' }).isDisabled().catch(() => true), 'Save desabilitado').toBe(true);
  expect.soft(abriu, 'F4: Edit de template existente abre o editor com a Meta expirada (spec §3 F4)').toBe(true);
  if (abriu) {
    await expect(page.getByText('Meta connection expired.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save template' })).toBeDisabled();
  }
  notas.push(...erros);
  salvarNotas(info, 'f4', notas);
  expect.soft(erros, 'console sem erro').toEqual([]);
});
