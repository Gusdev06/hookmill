// QA Q1 07/11 — tela With AI › prévias (templates-ia-previas-v1 + design/mockup-with-ai-previas.html), web 3246 → API do QA 3151,
// banco maquina_previas_test, tudo mock. Q1_LOCALE=en|pt. Projetos qaprevias-1440 e qaprevias-390 (Emulation do Playwright).
// Screenshots em /tmp/qprev/shots/ui-<projeto>-<locale>-<passo>.png (lidos no relatório).
import { expect, test, type Page } from '@playwright/test';
import { TRANSCRIPT, cleanup, created, db, uuid } from '../qa-previas-api/fx.ts';

const L = (process.env.Q1_LOCALE ?? 'en') as 'en' | 'pt';
const T = {
  en: { make4: /Make 4 previews/i, approve: /^Approve$/, newAngle: /New angle/i, makeN: /^Make 1 video/i, confirm: /Confirm · make 1/i, makeToo: /Make them too/i, download: /Download MP4/i, tryAgain: /Try again/i, planFailed: /couldn't write the previews/i, got: /Got it/i, watch: /^Watch$/, title: 'Podcast conversation', use: /Use this template/i },
  pt: { make4: /Gerar 4 prévias/i, approve: /^Aprovar$/, newAngle: /Novo ângulo/i, makeN: /^Gerar 1 vídeo/i, confirm: /Confirmar · gerar 1/i, makeToo: /Gerar essas também/i, download: /Baixar MP4/i, tryAgain: /Tentar de novo/i, planFailed: /prévias/i, got: /Entendi|Got it/i, watch: /^Assistir$/, title: 'Conversa de podcast', use: /Usar este template|Use this template/i },
}[L];
let HASH = '';

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanup);

/** Dono novo (senha teste12345, hash copiado do usuário de UI criado pelo /auth/signup), onboarding e tour feitos, campeão READY. */
async function persona(tag: string, what?: string) {
  if (!HASH) HASH = (await db.user.findUniqueOrThrow({ where: { email: 'qprev-ui-en@teste.local' } })).passwordHash;
  const email = `qprev-ui-${tag}-${uuid().slice(0, 8)}@teste.local`;
  const u = await db.user.create({ data: { email, name: 'QA Prévias UI', passwordHash: HASH, access: 'INTERNAL', accountMode: 'OWN', uiLocale: L === 'pt' ? 'PT_BR' : 'EN' } });
  created.users.push(u.id);
  const w = await db.workspace.create({ data: { name: 'QA Prévias UI', shortCode: 'QU', memberships: { create: { userId: u.id, role: 'OWNER' } } } });
  created.workspaces.push(w.id);
  await db.$executeRawUnsafe(`update workspaces set onboarding_completed_at = now(), market = 'US', website_url = 'https://example.com/' where id = $1`, w.id);
  await db.$executeRawUnsafe(`update memberships set tour_completed_at = now() where user_id = $1`, u.id);
  const off = await db.offer.create({ data: { workspaceId: w.id, name: 'Renda extra com IA', language: 'en', createdById: u.id,
    what: what ?? 'A step-by-step guide to earning extra income with AI tools, for 97 reais.', cta: 'Tap the link and get the guide today.',
    audience: 'Adults who want a side income without quitting their job.', promise: 'Start a side income with AI in one weekend.' } });
  const words = TRANSCRIPT.split(' ').map((word, i) => ({ word, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
  await db.champion.create({ data: { workspaceId: w.id, offerId: off.id, name: 'Talking head vencedor', status: 'READY', durationSec: 30, createdById: u.id,
    teardown: { create: { workspaceId: w.id, sections: { identification: { status: 'pending' }, whySells: { status: 'pending' } }, transcript: { language: 'en', words } } } } });
  return { email, ws: w.id };
}

async function login(page: Page, email: string) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: L === 'pt' ? 'pt-BR' : 'en', url: test.info().project.use.baseURL! }]);
  await page.goto('/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/password|senha/i).fill('teste12345');
  await page.getByRole('button', { name: /log in|sign in|entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}
const shot = async (page: Page, step: string) => {
  const path = `/tmp/qprev/shots/ui-${test.info().project.name.replace('qaprevias-', '')}-${L}-${step}.png`;
  await page.screenshot({ path, fullPage: true });
};
const noHScroll = async (page: Page, where: string) => {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `rolagem horizontal em ${where} (${sw} > ${cw})`).toBeLessThanOrEqual(cw + 1);
};
const dismissTip = async (page: Page) => { const g = page.getByRole('button', { name: T.got }); if (await g.count()) await g.first().click().catch(() => undefined); };

async function toPreviews(page: Page) {
  await page.goto('/templates?tab=ai');
  await expect(page.getByText(T.title).first()).toBeVisible();
  await noHScroll(page, 'galeria');
  await shot(page, '1-galeria');
  await page.getByText(T.title).first().click();
  await expect(page.getByRole('button', { name: T.use })).toBeVisible();
  await shot(page, '2-detalhe');
  await page.getByRole('button', { name: T.use }).click();
  await page.waitForURL(/\/templates\/podcast-conversation/);
  await dismissTip(page);
  await page.getByText('Talking head vencedor').first().click();
  await shot(page, '3-winner');
  const make = page.getByRole('button', { name: T.make4 });
  await expect(make).toBeEnabled();
  await make.dblclick(); // duplo clique não pode criar 2 lotes
  await page.waitForURL(/\/templates\/run\//, { timeout: 30_000 });
  return page.url().split('/run/')[1].split(/[?#]/)[0];
}

test('fluxo completo: galeria → detalhe → winner → 4 prévias → novo ângulo → aprovar 1 → confirmar → vídeo → assistir → "Make them too"', async ({ page }) => {
  const p = await persona(`flow-${L}`);
  await login(page, p.email);
  const batchId = await toPreviews(page);
  expect(await db.variationBatch.count({ where: { workspaceId: p.ws } }), 'duplo clique em Make 4 previews').toBe(1);
  const approveBtns = page.getByRole('checkbox', { name: T.approve });
  await expect.poll(() => db.variationItem.count({ where: { batchId, previewStatus: 'READY' } }), { timeout: 60_000 }).toBe(4);
  await expect(approveBtns.nth(3)).toBeVisible({ timeout: 20_000 });
  test.info().annotations.push({ type: 'checkboxes', description: String(await approveBtns.count()) });
  await dismissTip(page);
  await noHScroll(page, 'prévias');
  await shot(page, '4-previas');
  // texto da prévia no idioma da interface (título/ângulo) e gancho no idioma do campeão (en)
  const v = (await db.variationItem.findMany({ where: { batchId, previewStatus: 'READY' }, orderBy: { index: 'asc' } })).map((i: any) => i.payload.preview.variation);
  await expect(page.getByText(v[0].title).first()).toBeVisible();
  if (L === 'pt') expect(v[0].title).toMatch(/[ãçéêõá]|que|de|para/i);
  // Novo ângulo na A: elenco e ideia mudam
  const castBefore = (await db.variationItem.findFirstOrThrow({ where: { batchId, index: 0 } }) as any).payload.preview.cast.map((c: any) => c.name);
  const dump = async () => (await db.variationItem.findMany({ where: { batchId, previewStatus: { not: null } }, orderBy: { index: 'asc' } })).map((i: any) => `${i.index}:${i.previewStatus}:r${i.previewRegens}:${i.payload.preview.variation?.title}`).join(' | ');
  console.log('[antes]', await dump());
  const btn = page.getByRole('article', { name: /^(Preview|Prévia) A$/ }).getByRole('button', { name: T.newAngle });
  await expect(btn).toBeEnabled({ timeout: 20_000 });
  console.log('[botão]', await btn.getAttribute('aria-label'));
  await btn.click();
  await page.waitForTimeout(500);
  console.log('[depois]', await dump());
  await expect(approveBtns).toHaveCount(3, { timeout: 10_000 }).catch(() => undefined); // A vira "gerando" (pode ser rápido demais no mock)
  await shot(page, '5-novo-angulo-gerando');
  await expect(approveBtns).toHaveCount(4, { timeout: 60_000 });
  const a = await db.variationItem.findFirstOrThrow({ where: { batchId, index: 0 } }) as any;
  expect(a.previewRegens).toBe(1);
  expect(a.payload.preview.cast.map((c: any) => c.name)).not.toEqual(castBefore);
  await expect(page.getByText(a.payload.preview.variation.title).first()).toBeVisible();
  await shot(page, '6-novo-angulo-pronto');
  // aprovar 1 → Make 1 video → Confirmar
  const card = (l: string) => page.getByRole('article', { name: new RegExp(`^(Preview|Prévia) ${l}$`) });
  const boxB = card('B').getByRole('checkbox');
  await boxB.click();
  await expect(boxB).toHaveAttribute('aria-checked', 'true');
  const makeN = page.getByRole('button', { name: T.makeN });
  await expect(makeN).toBeEnabled();
  await makeN.click();
  const confirm = page.getByRole('button', { name: T.confirm });
  await expect(confirm).toBeVisible();
  await shot(page, '7-confirmar');
  await confirm.dblclick();
  await expect.poll(async () => (await db.variationItem.count({ where: { batchId, previewStatus: 'APPROVED' } })), { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(await db.creative.count({ where: { variationBatchId: batchId } }), 'duplo clique no Confirmar = 1 vídeo').toBe(1);
  await shot(page, '8-produzindo');
  await expect.poll(() => db.creative.count({ where: { variationBatchId: batchId, state: { in: ['RENDER_READY', 'APPROVED'] } } }), { timeout: 240_000 }).toBe(1);
  await page.waitForTimeout(3000);
  await shot(page, '8b-pronto-na-lista');
  // reteste 07/11: com tudo pronto a tela passa SOZINHA pro player (sem clicar em Watch)
  await expect(page.getByRole('button', { name: T.download }).or(page.getByRole('link', { name: T.download })).first()).toBeVisible({ timeout: 240_000 });
  await noHScroll(page, 'assistir');
  await shot(page, '9-assistir');
  // volta e aprova mais ("Make them too")
  const too = page.getByRole('button', { name: T.makeToo }).or(page.getByRole('link', { name: T.makeToo })).first();
  await expect(too).toBeVisible();
  await too.click();
  // design §2.7: volta com as não feitas já marcadas (B aparece como "Video made")
  for (const l of ['A', 'C', 'D']) await expect(card(l).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await expect(card('B').getByRole('checkbox')).toHaveCount(0);
  await shot(page, '10-make-them-too');
  await card('A').getByRole('checkbox').click();
  await card('D').getByRole('checkbox').click();
  await expect(card('C').getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: T.makeN }).click();
  await page.getByRole('button', { name: T.confirm }).click();
  await expect.poll(async () => (await db.variationItem.count({ where: { batchId, previewStatus: 'APPROVED' } })), { timeout: 20_000 }).toBe(2);
  await expect.poll(async () => (await db.creative.count({ where: { variationBatchId: batchId, state: { in: ['RENDER_READY', 'APPROVED'] } } })), { timeout: 240_000 }).toBe(2);
  // recarregar a rota (390: Emulation reaplicado a cada navegação)
  await page.reload();
  await page.waitForTimeout(3000);
  await shot(page, '11a-lista-tudo-pronto');
  // reteste 07/11: com tudo pronto a tela passa SOZINHA pro player (sem clicar em Watch)
  await expect(page.getByRole('button', { name: T.download }).or(page.getByRole('link', { name: T.download })).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '11-dois-videos');
  // biblioteca
  await page.goto('/library');
  await page.waitForTimeout(4000);
  await noHScroll(page, 'biblioteca');
  await shot(page, '12-biblioteca');
});

test('estados de falha: PLAN_FAILED (plan-few) e prévia falha + Try again (plan-one-fail)', async ({ page }) => {
  const f = await persona(`few-${L}`, 'A step-by-step guide to earning extra income with AI tools. [mock:plan-few]');
  await login(page, f.email);
  await toPreviews(page);
  await expect(page.getByRole('button', { name: /Pick another winner|Escolher outro|outro vencedor/i }).or(page.getByRole('link', { name: /Pick another winner|Escolher outro|outro vencedor/i })).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, '13-plan-failed');
  const pf = await page.locator('main').innerText();
  if (L === 'pt') expect(pf, 'texto em inglês no PLAN_FAILED em PT').not.toMatch(/Could not|Try again|Nothing was/);
  expect((pf.match(L === 'pt' ? /Tent(e|ar) de novo/gi : /Try again/gi) ?? []).length, '"Tentar de novo" repetido no PLAN_FAILED').toBeLessThanOrEqual(1);
  await page.context().clearCookies();
  const g = await persona(`onefail-${L}`, 'A step-by-step guide to earning extra income with AI tools. [mock:plan-one-fail]');
  await login(page, g.email);
  await toPreviews(page);
  await expect(page.getByRole('checkbox', { name: T.approve })).toHaveCount(4, { timeout: 60_000 });
  const angA = page.getByRole('article', { name: /^(Preview|Prévia) A$/ }).getByRole('button', { name: T.newAngle });
  await expect(angA).toBeEnabled({ timeout: 30_000 });
  await angA.click();
  const again = page.getByRole('button', { name: T.tryAgain });
  await expect(again).toBeVisible({ timeout: 60_000 });
  await shot(page, '14-previa-falhou');
  const failTxt = await page.getByRole('article', { name: /^(Preview|Prévia) A$/ }).innerText();
  test.info().annotations.push({ type: 'card falho', description: failTxt.replace(/\n+/g, ' | ') });
  if (L === 'pt') expect(failTxt, 'texto em inglês no card falho em PT').not.toMatch(/Could not|Try again|Nothing was/);
  expect((failTxt.match(L === 'pt' ? /Tent(e|ar) de novo/gi : /Try again/gi) ?? []).length, 'um só "Tentar de novo"').toBe(1);
  await again.click();
  await expect(again).toBeVisible({ timeout: 60_000 }); // o gatilho continua: falha de novo, com 1 retry usado
  await again.click();
  await expect(page.getByRole('button', { name: T.tryAgain })).toHaveCount(0, { timeout: 60_000 }); // sem retry sobrando: some o botão
  await shot(page, '15-previa-sem-retry');
});
