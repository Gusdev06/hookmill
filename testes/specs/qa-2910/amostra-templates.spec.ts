// QA 29/10 (loop Tordan): amostra grátis + prévia borrada + 402 + admin libera, templates de publicação no Meta,
// "Still working" no /iterate/new e faixa de CPA no onboarding. API de teste de verdade (maquina_test, META_MODE=mock,
// META_CRON=off, IA mock, render fake) + web de teste, em 1440 e 390. Dono: maquina-qa.
// Rodar: E2E_API_PORT=3141 E2E_WEB_PORT=3236 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261029000200_amostra_e_meta_templates \
//        E2E_LIMITES_V2=1 E2E_COM_WEB=1 npx playwright test --project=qa2910-1440 --project=qa2910-390
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../harness/fixtures.ts';
import { q } from '../../harness/db.ts';
import { as, call, tokenOf } from '../../harness/api.ts';
import { QA_API_DIST, TESTES_DIR } from '../../harness/env.ts';
import { createRequire } from 'node:module';
import { PODCAST, oferta } from '../../harness/iterate.ts';
import { loginRapido, semRolagemHorizontal, tela } from '../../harness/navegador.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';

test.use({ actionTimeout: 30_000 });
test.afterEach(async () => { await esperarJobsQuietos(180_000); });

const SENHA = 'qa-senha-forte-2026';
const OUT = join(TESTES_DIR, 'test-results', 'qa-2910');
let seq = 0;

interface Conta { email: string; token: string; userId: string; workspaceId: string }
async function signupOwn(label: string): Promise<Conta> {
  const email = `qa-2910-${Date.now().toString(36)}-${label}-${++seq}@teste.local`;
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', '/auth/signup', { body: { name: `QA ${label}`, email, password: SENHA, accountMode: 'OWN' } });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 61_000)); continue; }
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { email, token: r.data.accessToken, userId: r.data.user.id, workspaceId: r.data.workspace.id };
  }
  throw new Error('[qa] signup preso no throttle');
}
const api = (c: { token: string }) => ({
  get: (p: string) => call('GET', p, { token: c.token }),
  post: (p: string, body: unknown = {}) => call('POST', p, { body, token: c.token }),
  patch: (p: string, body: unknown = {}) => call('PATCH', p, { body, token: c.token }),
  put: (p: string, body: unknown = {}) => call('PUT', p, { body, token: c.token }),
});
async function loginConta(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  for (let i = 0; i < 3; i++) {
    const r = await page.request.post('/api/session', { data: { email, password: SENHA } });
    if (r.ok()) return;
    if (r.status() !== 429) throw new Error(`[qa] /api/session ${r.status()}: ${await r.text()}`);
    await page.waitForTimeout(61_000);
  }
  throw new Error('[qa] login preso no throttle');
}
async function prontoPraIterar(c: Conta) {
  await q(`update workspaces set onboarding_completed_at = now() where id = $1`, [c.workspaceId]);
  await q(`update memberships set tour_completed_at = now() where workspace_id = $1`, [c.workspaceId]);
  const off = await api(c).post('/offers', { name: 'QA Sample Offer', language: 'en', kind: 'Subscription app', what: 'A budgeting app that finds forgotten subscriptions.', promise: 'Find money you forgot you were spending.', audience: 'Adults who lose track of money', cta: 'Start your free trial', sourceUrl: 'https://example.com/' });
  expect(off.status, JSON.stringify(off.body)).toBe(201);
  return off.data.id as string;
}
async function conectarMeta(token: string) {
  const u = await call('POST', '/meta/connect', { body: { returnTo: '/settings' }, token });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  const cb = await fetch(u.data.url, { redirect: 'manual' });
  expect(cb.status).toBe(302);
  const s = await call('PUT', '/meta/selection', { body: { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' }, token });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  await expect.poll(async () => (await call('GET', '/meta/summary', { token })).data?.sync?.state, { timeout: 90_000 }).toBe('ok');
}
const corpoTemplate = (over: Record<string, unknown> = {}) => ({
  name: 'Tordan CBO', isDefault: true,
  campaign: { destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 2000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null, specialAdCategories: [], namePattern: 'HookMill — {offer}' },
  adset: { pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US'], ageMin: 18, ageMax: 65, genders: 'ALL', advantageAudience: true, placements: 'AUTO', adsPerAdset: { min: 4, max: 8 }, namePattern: '{offer} — {date} — {n}' },
  ad: { primaryText: null, headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com/', urlTags: null, namePattern: '{code}' },
  ...over,
});
/** Quiz de objetivos (se aparecer): primeiro objetivo → "Let HookMill choose" → See the plan. */
async function responderQuiz(page: Page) {
  const h = page.getByRole('heading', { name: 'What do you want this batch to do?' });
  await h.waitFor({ timeout: 120_000 });
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const auto = page.getByRole('checkbox', { name: /Let HookMill choose/ });
  if (await auto.isVisible().catch(() => false)) { if (!(await auto.isChecked())) await auto.check(); }
  await page.getByRole('button', { name: 'See the plan', exact: true }).click();
}
function ff(args: string[]): string {
  return execFileSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function blurdetect(file: string, ss: number, t: number): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-vf', 'blurdetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /blur mean: ([\d.]+)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) : NaN;
}

// ───────────────────────────── 1. amostra grátis (SAMPLE, OWN) ─────────────────────────────
test('amostra: upload → ≤4 peças → prévia borrada após 3 s → travado (UI + 402) → admin libera → destrava → 2ª amostra', async ({ page }, info) => {
  const proj = info.project.name;
  mkdirSync(join(OUT, proj), { recursive: true });
  const c = await signupOwn('sample');
  const me0 = await api(c).get('/auth/me');
  info.annotations.push({ type: '/auth/me (conta nova)', description: JSON.stringify({ access: me0.data?.user?.access ?? me0.data?.access, sampleUsed: me0.data?.user?.sampleUsed ?? me0.data?.sampleUsed }) });
  expect(JSON.stringify(me0.data)).toContain('"access":"SAMPLE"');
  await prontoPraIterar(c);

  await loginConta(page, c.email);
  await page.goto('/iterate/new');
  await expect(page.getByText(/Your free sample: up to 4 variations/)).toBeVisible({ timeout: 60_000 });
  await semRolagemHorizontal(page, 'iterate/new sample');
  await tela(page, info, 'a01-new-sample');
  await page.locator('input[type=file]').first().setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, { timeout: 120_000 });
  const batchId = new URL(page.url()).pathname.split('/')[2];
  await tela(page, info, 'a02-analyze-sample');
  await responderQuiz(page);

  // lote assentado (lança sozinho): todas as peças fora de render e com prévia
  const lote = async () => (await api(c).get(`/iterate/${batchId}`)).data;
  let v: any;
  await expect.poll(async () => {
    v = await lote();
    return v.status === 'LAUNCHED' && v.pieces.length > 0 && v.pieces.every((p: any) => p.status === 'failed' || (p.status === 'ready' && p.preview?.url));
  }, { timeout: 400_000, intervals: [2000] }).toBe(true);
  writeFileSync(join(OUT, proj, 'lote-travado.json'), JSON.stringify(v, null, 2));
  expect(v.sample).toBe(true);
  expect(v.pieces.length).toBeLessThanOrEqual(4);
  const tipos = v.pieces.map((p: any) => p.type);
  info.annotations.push({ type: 'peças da amostra', description: `${v.pieces.length}: ${tipos.join(', ')}` });
  expect(tipos).not.toContain('STATIC');
  const prontas = v.pieces.filter((p: any) => p.status === 'ready');
  expect(prontas.length).toBeGreaterThan(0);
  for (const p of prontas) {
    expect(p.locked, p.code).toBe(true);
    expect(p.files, p.code).toEqual([]);
    for (const f of p.formats ?? []) expect(f.file ?? null, `${p.code} ${f.format}`).toBeNull();
  }
  const custo = await q<{ kind: string; n: number }>(`select kind, count(*)::int n from cost_entries where workspace_id = $1 group by kind`, [c.workspaceId]);
  info.annotations.push({ type: 'cost_entries da amostra', description: JSON.stringify(custo) });

  // prévia: 480p, 0–3 s nítido, resto borrado (blurdetect + 2 quadros pra ler)
  const p0 = prontas[0];
  const prev = join(OUT, proj, 'previa.mp4');
  writeFileSync(prev, Buffer.from(await (await fetch(p0.preview.url)).arrayBuffer()));
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', prev], { encoding: 'utf8' });
  const pj = JSON.parse(probe);
  const sharp = blurdetect(prev, 0.2, 2.6), blurred = blurdetect(prev, 3.5, 4);
  info.annotations.push({ type: 'prévia', description: `${pj.streams[0].codec_name} ${pj.streams[0].width}x${pj.streams[0].height} ${pj.format.duration}s · blur 0.2–2.8 s = ${sharp} · blur 3.5–7.5 s = ${blurred}` });
  writeFileSync(join(OUT, proj, 'previa-medidas.txt'), `${probe}\nblur 0.2-2.8s=${sharp}\nblur 3.5-7.5s=${blurred}\n`);
  ff(['-y', '-ss', '1.5', '-i', prev, '-frames:v', '1', join(OUT, proj, 'previa-1.5s.png')]);
  ff(['-y', '-ss', '6', '-i', prev, '-frames:v', '1', join(OUT, proj, 'previa-6s.png')]);
  expect(Math.min(pj.streams[0].width, pj.streams[0].height)).toBeLessThanOrEqual(480);
  // o render fake da API do QA é um quadro liso (sem detalhe pra borrar): a prova do blur roda a MESMA função da API
  // (gerarPrevia, build do QA) sobre o campeão real do podcast e mede 0–3 s vs depois
  const { gerarPrevia } = createRequire(import.meta.url)(join(QA_API_DIST, 'render', 'previa.js'));
  const real = join(OUT, proj, 'previa-podcast.mp4');
  await gerarPrevia(PODCAST, real);
  const rs = blurdetect(real, 0.2, 2.6), rb = blurdetect(real, 3.5, 4);
  ff(['-y', '-ss', '1.5', '-i', real, '-frames:v', '1', join(OUT, proj, 'previa-podcast-1.5s.png')]);
  ff(['-y', '-ss', '6', '-i', real, '-frames:v', '1', join(OUT, proj, 'previa-podcast-6s.png')]);
  ff(['-y', '-ss', '2.9', '-i', real, '-frames:v', '1', join(OUT, proj, 'previa-podcast-2.9s.png')]);
  ff(['-y', '-ss', '3.1', '-i', real, '-frames:v', '1', join(OUT, proj, 'previa-podcast-3.1s.png')]);
  info.annotations.push({ type: 'prévia (gerarPrevia no podcast real)', description: `blur 0.2–2.8 s = ${rs} · 3.5–7.5 s = ${rb}` });
  writeFileSync(join(OUT, proj, 'previa-medidas.txt'), `${probe}\nAPI (render fake liso): blur 0.2-2.8s=${sharp} 3.5-7.5s=${blurred}\ngerarPrevia(podcast): blur 0.2-2.8s=${rs} 3.5-7.5s=${rb}\n`);
  expect(rb).toBeGreaterThan(rs * 1.5);

  // 402 nas rotas travadas
  const cid = p0.creativeId as string;
  const [fr] = await q<{ file_id: string }>(`select r.file_id from renders r where r.creative_id = $1 and r.status = 'READY' and r.file_id is not null limit 1`, [cid]);
  const travadas: [string, string, unknown?][] = [
    ['POST', `/iterate/${batchId}/zip`, {}],
    ['POST', `/iterate/pieces/${p0.id}/formats`, { format: '4x5' }],
    ['POST', `/iterate/pieces/${p0.id}/retry`, {}],
    ['GET', `/creatives/${cid}`],
    ['GET', `/creatives/${cid}/editor`],
    ['GET', `/creatives/${cid}/edit`],
    ['GET', `/creatives/${cid}/download`],
    ['POST', `/creatives/${cid}/meta/publish`, { templateId: 'x' }],
    ...(fr ? [['GET', `/files/${fr.file_id}`] as [string, string]] : []),
    ['POST', '/iterate', { championId: v.source.championId }],
  ];
  const res402: string[] = [];
  for (const [m, path, body] of travadas) {
    const r = await call(m, path, { token: c.token, ...(body !== undefined ? { body } : {}) });
    res402.push(`${m} ${path} → ${r.status} ${r.body?.error?.code ?? ''} ${JSON.stringify(r.body?.error?.details ?? '')}`);
  }
  writeFileSync(join(OUT, proj, '402.txt'), res402.join('\n') + '\n');
  info.annotations.push({ type: '402', description: res402.join(' | ') });
  for (const l of res402) expect(l, l).toMatch(/→ 402 PAYMENT_REQUIRED/);
  // vazamento: lista de criativos e Library não podem trazer o arquivo original
  const lista = await api(c).get('/creatives');
  const lib = await api(c).get('/library');
  const vaza = JSON.stringify(lista.body).includes(cid) && /render_video|\.mp4/.test(JSON.stringify(lista.body));
  info.annotations.push({ type: 'GET /creatives (travado)', description: `${lista.status} contém o criativo=${JSON.stringify(lista.body).includes(cid)} url mp4=${/\.mp4/.test(JSON.stringify(lista.body))}; /library ${lib.status} contém=${JSON.stringify(lib.body).includes(cid)}` });
  writeFileSync(join(OUT, proj, 'creatives-travado.json'), JSON.stringify(lista.body, null, 2));
  void vaza;

  // furo possível: POST /meta/publish-batch (rota sem :id, fora do SampleCreativeGuard) com as peças travadas
  await conectarMeta(c.token);
  const tplS = await api(c).post('/meta/templates', corpoTemplate());
  const batchPub = await api(c).post('/meta/publish-batch', { creativeIds: prontas.map((p: any) => p.creativeId), templateId: tplS.data?.id });
  const estados = await q<{ id: string; state: string }>(`select id, state from creatives where id = any($1)`, [prontas.map((p: any) => p.creativeId)]);
  const pubsS = await q<{ n: number }>(`select count(*)::int n from meta_publications where workspace_id = $1`, [c.workspaceId]);
  info.annotations.push({ type: 'publish-batch com peças travadas', description: `template ${tplS.status} · publish-batch ${batchPub.status} ${batchPub.body?.error?.code ?? ''} · criativos ${JSON.stringify(estados.map((e) => e.state))} · publicações ${pubsS[0].n}` });
  writeFileSync(join(OUT, proj, 'publish-batch-travado.json'), JSON.stringify({ tpl: tplS.status, batchPub: batchPub.body, estados, pubs: pubsS }, null, 2));
  await expect.poll(async () => (await q<{ n: number }>(`select count(*)::int n from meta_publications where workspace_id = $1 and status = 'PUBLISHING'`, [c.workspaceId]))[0].n, { timeout: 120_000 }).toBe(0);
  expect.soft(batchPub.status, 'publish-batch deveria dar 402 com peça travada').toBe(402);

  // UI travada: Download da amostra
  await page.goto(`/iterate/${batchId}`);
  await expect(page.getByText('Unlock to watch the rest').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Send to Meta \(\d+\)/ })).toBeDisabled();
  if (proj.endsWith('1440')) await expect(page.getByRole('button', { name: 'Download zip' })).toBeDisabled(); // no 390 fica oculto (max-tablet:hidden)
  await semRolagemHorizontal(page, 'download sample');
  await tela(page, info, 'a03-download-travado');
  await page.waitForTimeout(4000);
  await tela(page, info, 'a04-download-travado-4s');
  await page.getByRole('button', { name: /Unlock — see plans/ }).first().click();
  await expect(page.getByText('Talk to us to unlock')).toBeVisible();
  await expect(page.getByText(c.userId)).toBeVisible();
  await tela(page, info, 'a05-talk-to-us');

  // 2ª amostra
  await page.goto('/iterate/new');
  await expect(page.getByText('You already used your free sample')).toBeVisible({ timeout: 60_000 });
  await semRolagemHorizontal(page, 'sample used');
  await tela(page, info, 'a06-sample-used');

  // admin INTERNAL libera pela tela de Settings
  const rendersAntes = (await q<{ n: number }>(`select count(*)::int n from renders where workspace_id = $1`, [c.workspaceId]))[0].n;
  await q(`update users set account_mode = 'OWN' where id = 'qa_user_dono_a'`);
  await q(`update workspaces set onboarding_completed_at = now() where id = 'qa_ws_alfa'`);
  await q(`update memberships set tour_completed_at = now() where workspace_id = 'qa_ws_alfa'`);
  await loginRapido(page, 'donoA');
  await page.goto('/settings');
  const card = page.getByText('Unlock an account').first();
  await card.scrollIntoViewIfNeeded();
  await page.getByLabel('Account id').fill(c.userId);
  const plan = page.getByRole('combobox', { name: /Plan/ });
  if (await plan.count()) { await plan.click(); await page.getByRole('option', { name: 'Paid' }).click(); }
  await tela(page, info, 'a07-admin-unlock');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect.poll(async () => (await q<{ access: string }>(`select access from users where id = $1`, [c.userId]))[0].access, { timeout: 20_000 }).toBe('PAID');
  await tela(page, info, 'a08-admin-unlocked');

  // as mesmas peças destravam, sem render novo
  const v2 = (await api(c).get(`/iterate/${batchId}`)).data;
  writeFileSync(join(OUT, proj, 'lote-destravado.json'), JSON.stringify(v2, null, 2));
  for (const p of v2.pieces.filter((x: any) => x.status === 'ready')) {
    expect(p.locked ?? false, p.code).toBe(false);
    expect(p.files.length, p.code).toBeGreaterThan(0);
    expect(p.preview ?? null, p.code).toBeNull();
  }
  expect(v2.pieces.map((p: any) => p.id)).toEqual(v.pieces.map((p: any) => p.id));
  const zip = await api(c).post(`/iterate/${batchId}/zip`, {});
  const det = await api(c).get(`/creatives/${cid}`);
  const rendersDepois = (await q<{ n: number }>(`select count(*)::int n from renders where workspace_id = $1`, [c.workspaceId]))[0].n;
  info.annotations.push({ type: 'destravado', description: `zip ${zip.status} · GET creative ${det.status} · renders ${rendersAntes} → ${rendersDepois}` });
  expect(zip.status).toBeLessThan(300);
  expect(det.status).toBe(200);
  expect(rendersDepois).toBe(rendersAntes);
  // nova amostra continua barrada? (PAID = normal; POST /iterate não dá 402)
  await loginConta(page, c.email);
  await page.goto(`/iterate/${batchId}`);
  await expect(page.getByRole('button', { name: /Download zip|Download/ }).first()).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText('Unlock to watch the rest')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await semRolagemHorizontal(page, 'download destravado');
  await tela(page, info, 'a09-download-destravado');
});

// ───────────────────────────── 2. templates de publicação ─────────────────────────────
test('templates: criar padrão (tela) → importar campanha do mock → publicar 1 com template → lote de 10 = 2 ad sets', async ({ page }, info) => {
  const proj = info.project.name;
  mkdirSync(join(OUT, proj), { recursive: true });
  await q(`update users set account_mode = 'OWN'`);
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  const tok = await tokenOf('donoA');
  await conectarMeta(tok);
  await loginRapido(page, 'donoA');
  await page.goto('/settings/connections/templates');
  await expect(page.getByText('No publish template yet')).toBeVisible({ timeout: 60_000 });
  await semRolagemHorizontal(page, 'templates vazio');
  await tela(page, info, 't01-vazio');

  // do zero pela janela
  await page.getByRole('button', { name: 'New template' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Template name').fill('QA Tordan CBO');
  await dlg.getByLabel('Daily budget').fill('20');
  await tela(page, info, 't02-janela-campanha');
  await dlg.getByRole('tab', { name: /^Ad set/ }).click();
  const geo = dlg.getByLabel('Locations');
  if (!(await geo.inputValue())) await geo.fill('US'); // workspace sem mercado = locais vazios (obrigatório)
  await tela(page, info, 't02b-janela-adset');
  await dlg.getByRole('tab', { name: /^Ad (?!set)/ }).click();
  const link = dlg.getByLabel('Website URL');
  if (!(await link.inputValue())) await link.fill('https://example.com/');
  await tela(page, info, 't03-janela-anuncio');
  await dlg.getByRole('button', { name: 'Save template' }).click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText('Default').first()).toBeVisible();
  const lista1 = (await call('GET', '/meta/templates', { token: tok })).data;
  info.annotations.push({ type: 'template criado', description: JSON.stringify(lista1.map((t: any) => [t.name, t.isDefault, t.campaign.budgetMode, t.campaign.dailyBudgetMinor, t.adset.adsPerAdset, t.campaign.destination])) });
  expect(lista1).toHaveLength(1);
  expect(lista1[0].isDefault).toBe(true);
  await tela(page, info, 't04-lista-1');

  // importar de campanha do mock
  await page.getByRole('button', { name: 'Import from a campaign' }).first().click();
  const pick = page.getByRole('dialog');
  await expect(pick.getByRole('button', { name: 'Use' }).first()).toBeVisible({ timeout: 30_000 });
  await tela(page, info, 't05-import-picker');
  await pick.getByRole('button', { name: 'Use' }).first().click();
  await expect(page.getByText(/Imported from ".*"\./)).toBeVisible({ timeout: 30_000 });
  await tela(page, info, 't06-importado-revisar');
  { const g2 = page.getByRole('dialog').getByRole('tab', { name: /^Ad set/ }); await g2.click(); const geo2 = page.getByRole('dialog').getByLabel('Locations'); if (!(await geo2.inputValue())) await geo2.fill('US'); }
  const nome = page.getByRole('dialog').getByLabel('Template name');
  await nome.fill('QA Importado');
  await page.getByRole('dialog').getByRole('tab', { name: /^Campaign/ }).click();
  const bud = page.getByRole('dialog').getByLabel(/Daily budget/);
  if (!(await bud.inputValue())) await bud.fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText('Imported').first()).toBeVisible();
  await semRolagemHorizontal(page, 'templates 2');
  await tela(page, info, 't07-lista-2');
  const lista2 = (await call('GET', '/meta/templates', { token: tok })).data;
  expect(lista2).toHaveLength(2);
  expect(lista2[0].isDefault).toBe(true);
  const padrao = lista2.find((t: any) => t.isDefault);

  // 11 criativos aprovados com render (linhas no banco; o mock da Meta não baixa o vídeo)
  const off = await oferta('A');
  const ids: string[] = [];
  for (let i = 1; i <= 11; i++) {
    const id = `qa2910c${i}${Date.now().toString(36)}`;
    await q(`insert into creatives (id, workspace_id, offer_id, name, language, state, approved_at, approved_by_id, ad_name, variation_code, created_by_id, updated_at)
             values ($1,'qa_ws_alfa',$2,$3,'en','APPROVED',now(),'qa_user_dono_a',$4,$5,'qa_user_dono_a',now())`, [id, off.id, `Hook ${i}`, `QA_2910_${i}`, `HEADLINE-${String(i).padStart(2, '0')}`]);
    await q(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height) values ($1,'qa_ws_alfa','RENDER_VIDEO',$2,'video/mp4',1000000,20,1080,1920)`, [`${id}f`, `ws/qa_ws_alfa/render_video/${id}.mp4`]);
    await q(`insert into renders (id, workspace_id, creative_id, status, settings, input, file_id, duration_sec) values ($1,'qa_ws_alfa',$2,'READY','{}'::jsonb,'{}'::jsonb,$3,20)`, [`${id}r`, id, `${id}f`]);
    await q(`update creatives set final_render_id = $2 where id = $1`, [id, `${id}r`]);
    ids.push(id);
  }
  // publicar 1 com template
  const um = await call('POST', `/creatives/${ids[0]}/meta/publish`, { body: { templateId: padrao.id }, token: tok });
  expect(um.status, JSON.stringify(um.body)).toBe(202);
  await expect.poll(async () => (await q<{ status: string }>(`select status from meta_publications where creative_id = $1 order by created_at desc limit 1`, [ids[0]]))[0]?.status, { timeout: 90_000 }).not.toBe('PUBLISHING');
  const pub1 = (await q(`select status, campaign_id, adset_id, meta_ad_id, error_code from meta_publications where creative_id = $1`, [ids[0]]))[0];
  const tpl1 = (await call('GET', '/meta/templates', { token: tok })).data.find((t: any) => t.id === padrao.id);
  info.annotations.push({ type: 'publicar 1 com template', description: `${JSON.stringify(pub1)} reuseCampaignId=${tpl1.reuseCampaignId}` });
  expect(pub1.status).toBe('PAUSED');
  expect(tpl1.reuseCampaignId).toBeTruthy();

  // lote de 10 → 2 ad sets (8 + 2, o 2º abaixo do mínimo), mesma campanha
  const lote = await call('POST', '/meta/publish-batch', { body: { creativeIds: ids.slice(1), templateId: padrao.id }, token: tok });
  expect(lote.status, JSON.stringify(lote.body)).toBe(202);
  info.annotations.push({ type: 'publish-batch plano', description: JSON.stringify(lote.data.plan.adsets.map((a: any) => [a.name, a.creativeIds.length, a.belowMin])) });
  expect(lote.data.plan.adsets.map((a: any) => a.creativeIds.length)).toEqual([8, 2]);
  expect(lote.data.plan.adsets[1].belowMin).toBe(true);
  await expect.poll(async () => (await q<{ n: number }>(`select count(*)::int n from meta_publications where creative_id = any($1) and status = 'PUBLISHING'`, [ids.slice(1)]))[0].n, { timeout: 180_000 }).toBe(0);
  const pubs = await q<{ status: string; campaign_id: string; adset_id: string }>(`select status, campaign_id, adset_id from meta_publications where creative_id = any($1)`, [ids.slice(1)]);
  const camps = new Set(pubs.map((p) => p.campaign_id)), sets = new Set(pubs.map((p) => p.adset_id));
  info.annotations.push({ type: 'publish-batch resultado', description: `${pubs.length} pubs · status ${[...new Set(pubs.map((p) => p.status))]} · campanhas ${[...camps]} · ad sets ${sets.size}` });
  writeFileSync(join(OUT, proj, 'publish-batch.json'), JSON.stringify({ plan: lote.data.plan, pubs, pub1, reuse: tpl1.reuseCampaignId }, null, 2));
  expect(pubs.every((p) => p.status === 'PAUSED')).toBe(true);
  expect(sets.size).toBe(2);
  expect([...camps]).toEqual([tpl1.reuseCampaignId]);

  // seletor de template na tela Send de um criativo
  await page.goto(`/creatives/${ids[0]}/send`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await semRolagemHorizontal(page, 'send');
  await tela(page, info, 't08-send-seletor');
  const seletor = await page.getByText('Publish template').count();
  info.annotations.push({ type: 'Send: seletor de template visível', description: String(seletor > 0) });
});

// ───────────────────────────── 3. "Still working" + Open no Pick from Meta ─────────────────────────────
test('still working: sair da análise e voltar → cartão "Still working" com Open; anúncio do Meta com lote rodando = Open', async ({ page }, info) => {
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  await q(`update users set account_mode = 'OWN'`);
  await oferta('A');
  const tok = await tokenOf('donoA');
  await conectarMeta(tok);
  await loginRapido(page, 'donoA');
  await page.goto('/iterate/new');
  await page.locator('input[type=file]').first().setInputFiles(PODCAST);
  await page.waitForURL(/\/iterate\/(?!new)[^/?]+/, { timeout: 120_000 });
  const batchId = new URL(page.url()).pathname.split('/')[2];
  await page.goto('/'); // sai no meio da análise
  const st = (await q<{ status: string }>(`select status from variation_batches where id = $1`, [batchId]))[0].status;
  let forcado = false;
  if (!['ANALYZING', 'PLANNING'].includes(st)) { // análise do mock já acabou: segura o lote em ANALYZING pra ver o cartão
    await q(`update variation_batches set status = 'ANALYZING' where id = $1`, [batchId]);
    forcado = true;
  }
  info.annotations.push({ type: 'estado ao sair', description: `${st}${forcado ? ' (forçado ANALYZING por SQL: o mock termina antes)' : ''}` });
  const cfg = (await call('GET', '/iterate/config', { token: tok })).data;
  info.annotations.push({ type: 'GET /iterate/config.running', description: JSON.stringify(cfg.running) });
  expect(cfg.running.map((r: any) => r.id)).toContain(batchId);
  await page.goto('/iterate/new');
  await expect(page.getByText('Still working — you can come back any time')).toBeVisible({ timeout: 60_000 });
  await semRolagemHorizontal(page, 'still working');
  await tela(page, info, 's01-still-working');

  // Pick from Meta: o anúncio cujo campeão tem lote rodando vira "Open"
  const ads = (await call('GET', '/meta/ads', { token: tok })).data;
  const lista = Array.isArray(ads) ? ads : ads?.items ?? ads?.ads ?? [];
  const ad = lista[0];
  if (ad?.metaAdId ?? ad?.id) {
    await q(`update champions set meta_ad_id = $2 where id = (select champion_id from variation_batches where id = $1)`, [batchId, ad.metaAdId ?? ad.id]);
    await page.reload();
    await page.waitForTimeout(1500);
    await tela(page, info, 's02-pick-meta-open');
    const open = await page.getByRole('link', { name: /Open/ }).count();
    await expect(page.getByRole('link', { name: 'Open — working' })).toBeVisible();
    info.annotations.push({ type: 'Pick from Meta: Open', description: `anúncio ${ad.metaAdId ?? ad.id} · botões/links "Open" = ${open}` });
    expect(open).toBeGreaterThanOrEqual(2); // cartão Still working + linha do anúncio
  } else info.annotations.push({ type: 'Pick from Meta', description: `sem anúncio no mock: ${JSON.stringify(ads).slice(0, 200)}` });
  await page.getByRole('link', { name: /Reading the ad Open/ }).first().click();
  await page.waitForURL(new RegExp(`/iterate/${batchId}`), { timeout: 30_000 });
  await q(`update variation_batches set status = 'ANALYSIS_FAILED' where id = $1 and $2`, [batchId, forcado]).catch(() => undefined);
});

// ───────────────────────────── 4. faixa de CPA no onboarding ─────────────────────────────
test('onboarding: faixa de CPA (inválida trava, válida salva no PATCH e aparece no Brain)', async ({ page }, info) => {
  await q(`update users set account_mode = 'OWN'`);
  await loginRapido(page, 'donoA');
  await page.goto('/onboarding/business');
  const min = page.getByLabel('From', { exact: true });
  await expect(min).toBeVisible({ timeout: 60_000 });
  await min.scrollIntoViewIfNeeded();
  await min.fill('150');
  await page.getByLabel('To', { exact: true }).fill('100');
  await expect(page.getByText('Fill both values of the cost range, with the first one not above the second.').first()).toBeVisible();
  await semRolagemHorizontal(page, 'cpa inválido');
  await tela(page, info, 'c01-cpa-invalido');
  await min.fill('100');
  await page.getByLabel('To', { exact: true }).fill('150');
  await tela(page, info, 'c02-cpa-valido');
  // salvar: botão Save and exit / continuar
  const save = page.getByRole('button', { name: /Save and exit/ });
  if (await save.count()) await save.first().click();
  else await page.getByRole('button', { name: /Continue/ }).first().click();
  await expect.poll(async () => (await as('donoA').get('/workspace')).data?.targetCpa, { timeout: 20_000 }).toEqual({ min: 100, max: 150, currency: 'USD' });
  // API: inválidos
  const bad1 = await as('donoA').patch('/workspace', { targetCpa: { min: 200, max: 100, currency: 'USD' } });
  const bad2 = await as('donoA').patch('/workspace', { targetCpa: { min: 0, max: 100, currency: 'USD' } });
  const bad3 = await as('donoA').patch('/workspace', { targetCpa: { min: 1, max: 2, currency: 'usdx' } });
  const nul = await as('donoA').patch('/workspace', { targetCpa: null });
  info.annotations.push({ type: 'PATCH targetCpa', description: `min>max ${bad1.status} · min=0 ${bad2.status} · moeda ruim ${bad3.status} · null ${nul.status} → ${JSON.stringify(nul.data?.targetCpa)}` });
  expect([bad1.status, bad2.status, bad3.status]).toEqual([400, 400, 400]);
  expect(nul.status).toBe(200);
  await as('donoA').patch('/workspace', { targetCpa: { min: 100, max: 150, currency: 'USD' } });
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  const g = await as('donoA').get('/brain/graph');
  const goal = JSON.stringify(g.body).match(/.{0,80}(CPA \d|goal\.targetCpa).{0,80}/)?.[0] ?? 'não achei';
  info.annotations.push({ type: 'GET /brain/graph (nó Goal)', description: `${g.status} ${goal}` });
  await page.goto('/brain');
  await page.waitForTimeout(2500);
  await semRolagemHorizontal(page, 'brain');
  await tela(page, info, 'c03-brain');
  const txt = await page.locator('body').innerText();
  info.annotations.push({ type: 'Brain mostra faixa', description: String(/100.*150/.test(txt)) });
});
