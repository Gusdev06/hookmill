// Fluxo inteiro no navegador (Q3 → portão G2), em 1440 (fluxo-1440) e 390 px (fluxo-390, viewport aplicada pelo
// Playwright via CDP Emulation.setDeviceMetricsOverride, por isso passa do piso de 500 px da janela headless).
// Web de teste: Next dev na 3210 (sem MSW) → API de teste na 3101 → banco maquina_test, INTEGRACOES_MODE=mock. Nada pago.
// Screenshots por etapa em test-results/telas/<projeto>/.
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { ENV } from '../../harness/env.ts';
import { criarCriativoNoEstado, estadoNoBanco } from '../../harness/fabrica.ts';
import { esperarEtapa, idDaUrl, loginPelaTela, loginRapido, primario, semRolagemHorizontal, tela } from '../../harness/navegador.ts';

test.use({ actionTimeout: 30_000 });

const ESPERA = { timeout: 90_000 };

test('F-00 viewport certa e o web fala com a API de teste (3101), não com a de dev', async ({ page }, info) => {
  const apis = new Set<string>();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/v1')) apis.add(u.origin);
  });
  await loginRapido(page, 'adminA');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Creatives', exact: true })).toBeVisible(ESPERA);
  expect(await page.evaluate(() => window.innerWidth)).toBe(info.project.name === 'fluxo-390' ? 390 : 1440);
  expect([...apis]).toEqual([new URL(ENV.apiUrl).origin]);
  await tela(page, info, '00-home-vazia');
});

test('F-01..F-11 login → oferta por link → roteiros → rosto → motor → geração → edição → Pedir ajustes → aprovar → Biblioteca → Home', async ({ page }, info) => {
  let id = '';
  await test.step('F-01 login pela tela', async () => {
    await loginPelaTela(page, info.project.name === 'fluxo-390' ? 'membroA' : 'donoA');
    await expect(page.getByRole('heading', { name: 'Creatives', exact: true })).toBeVisible(ESPERA);
    await tela(page, info, '01-home');
  });

  await test.step('F-02 Offer: link lido pelo mock, campos "From page", Continue cria oferta + criativo', async () => {
    await page.goto('/creatives/new');
    await page.getByRole('radio', { name: 'New from link' }).or(page.getByText('New from link')).first().click();
    await page.getByLabel('Sales page link').fill('https://orbit-budget.example.com/sales');
    await page.getByRole('button', { name: 'Read page' }).click();
    await expect(page.getByText('Filled from the page. Check it before you continue.')).toBeVisible(ESPERA);
    await expect(page.getByLabel('What it is')).not.toHaveValue('');
    await expect(page.getByLabel('Main promise')).not.toHaveValue('');
    await expect(page.getByText('From page').first()).toBeVisible();
    await semRolagemHorizontal(page, 'offer');
    await tela(page, info, '02-offer-lida');
    await primario(page).click();
    await esperarEtapa(page, 'scripts');
    id = idDaUrl(page);
    expect(id).not.toBe('');
  });

  await test.step('F-03 Scripts: 4 roteiros do mock, escolher o B, recarregar mantém a escolha', async () => {
    const cardB = page.locator('article').filter({ hasText: 'Script B' });
    await expect(page.getByRole('button', { name: 'Use this script' })).toHaveCount(4, ESPERA);
    await tela(page, info, '03-scripts');
    await cardB.getByRole('button', { name: 'Use this script' }).click();
    await expect(cardB.getByText('Selected')).toBeVisible(ESPERA);
    await page.reload(); // F-11: estado vem do banco
    await expect(page.locator('article').filter({ hasText: 'Script B' }).getByText('Selected')).toBeVisible(ESPERA);
    await semRolagemHorizontal(page, 'scripts');
    await primario(page).click();
    await esperarEtapa(page, 'avatar');
  });

  await test.step('F-04 Avatar: gerar 4 rostos e escolher o 2', async () => {
    await page.getByLabel('Who is on camera').fill('woman in her 30s, kitchen, natural light, looks at camera');
    await page.getByRole('button', { name: 'Generate 4 new faces' }).click();
    const face2 = page.getByRole('radio', { name: /Face 2/ });
    await expect(face2).toBeEnabled(ESPERA);
    await tela(page, info, '04-avatar-rostos');
    await face2.click();
    // a dica "Face 2 selected" da barra some no mobile (design); o estado real é o radio marcado
    await expect(face2).toHaveAttribute('data-state', 'checked', ESPERA);
    await expect(primario(page)).toBeEnabled();
    await primario(page).click();
    await esperarEtapa(page, 'engine');
  });

  await test.step('F-05 Engine: Scenes/Kling, 9:16, custo estimado na tela → Generate', async () => {
    await expect(page.getByText('Estimated cost')).toBeVisible(ESPERA);
    await expect(primario(page)).toBeEnabled(ESPERA);
    await semRolagemHorizontal(page, 'engine');
    await tela(page, info, '05-engine');
    await primario(page).click();
    await esperarEtapa(page, 'generation');
  });

  await test.step('F-06 Generation: todas as cenas prontas, render automático', async () => {
    await tela(page, info, '06a-generation-gerando');
    await page.reload(); // F-11 no meio da geração
    await expect(page).toHaveURL(new RegExp(`/creatives/${id}/generation`));
    await expect(page.getByText(/All \d+ scenes ready/)).toBeVisible(ESPERA);
    await tela(page, info, '06b-generation-pronta');
    await expect(primario(page)).toBeEnabled(ESPERA);
    await primario(page).click();
    await esperarEtapa(page, 'edit');
  });

  await test.step('F-07 Edit: espera o render automático e segue pro Final OK', async () => {
    await expect(primario(page)).toBeEnabled({ timeout: 180_000 });
    await semRolagemHorizontal(page, 'edit');
    await tela(page, info, '07-edit-pronto');
    await primario(page).click();
    await esperarEtapa(page, 'review');
  });

  await test.step('F-10 Final OK → Pedir ajustes (legenda) volta pro Edit; render de novo; volta pro Final OK', async () => {
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled(ESPERA);
    await expect(page.locator('video').first()).toBeVisible();
    await tela(page, info, '08a-review');
    await page.getByRole('button', { name: 'Request changes' }).click();
    await page.getByRole('radio', { name: /Change captions, headline or CTA/ }).click();
    await page.getByRole('button', { name: 'Send back to Edit' }).click();
    await esperarEtapa(page, 'edit');
    expect(await estadoNoBanco(id)).toBe('EDIT_PENDING');
    await page.getByRole('radio', { name: 'Full line' }).or(page.getByRole('button', { name: 'Full line' })).first().click();
    await page.getByRole('button', { name: 'Render preview' }).click();
    await expect(primario(page)).toBeEnabled({ timeout: 180_000 });
    await tela(page, info, '08b-edit-depois-do-ajuste');
    await primario(page).click();
    await esperarEtapa(page, 'review');
  });

  await test.step('F-08 Approve → Biblioteca', async () => {
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL(/\/library/, ESPERA);
    expect(await estadoNoBanco(id)).toBe('APPROVED');
  });

  await test.step('F-09 Library: criativo aparece e vira vencedor', async () => {
    const [{ name }] = await q<{ name: string }>('select name from creatives where id = $1', [id]);
    await expect(page.getByText(name).first()).toBeVisible(ESPERA);
    await page.getByRole('button', { name: 'Mark as winner' }).first().click();
    await expect(page.getByRole('button', { name: 'Remove winner mark' }).first()).toBeVisible(ESPERA);
    const [{ is_winner }] = await q<{ is_winner: boolean }>('select is_winner from creatives where id = $1', [id]);
    expect(is_winner).toBe(true);
    await semRolagemHorizontal(page, 'library');
    await tela(page, info, '09-library');
  });

  await test.step('Home atualizada: criativo aprovado, nada esperando', async () => {
    const [{ name }] = await q<{ name: string }>('select name from creatives where id = $1', [id]);
    await page.goto('/');
    const linha = page.getByRole('link').filter({ hasText: name }).first();
    await expect(linha).toBeVisible(ESPERA);
    await expect(linha.getByText('Approved')).toBeVisible();
    await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
    await tela(page, info, '10-home-final');
  });
});

test('F-FALHA-1 Avatar: SAFETY_BLOCK mostra "bloqueado" + motivo + Try again; nova descrição destrava', async ({ page }, info) => {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  await loginRapido(page, 'adminA');
  await page.goto(`/creatives/${c.id}/avatar`);
  await page.getByLabel('Who is on camera').fill('man in his 40s, office [mock:SAFETY_BLOCK]');
  await page.getByRole('button', { name: 'Generate 4 new faces' }).click();
  await expect(page.getByText('Face generation was blocked')).toBeVisible(ESPERA);
  const [{ fail_reason }] = await q<{ fail_reason: string }>('select fail_reason from faces where creative_id = $1 limit 1', [c.id]);
  await expect(page.getByText(fail_reason, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(primario(page)).toBeDisabled();
  await tela(page, info, 'falha1a-avatar-bloqueado');
  await page.getByLabel('Who is on camera').fill('man in his 40s, office, daylight');
  await page.getByRole('button', { name: 'Try again' }).click();
  const face1 = page.getByRole('radio', { name: /Face 1/ });
  await expect(face1).toBeEnabled(ESPERA);
  await face1.click();
  await expect(primario(page)).toBeEnabled(ESPERA);
  await tela(page, info, 'falha1b-avatar-destravado');
  expect(await estadoNoBanco(c.id)).toBe('ENGINE_PENDING');
});

test('F-FALHA-2 Generation: uma cena falha, as outras terminam; "Edit prompt" + regerar destrava até o Edit', async ({ page }, info) => {
  const c = await criarCriativoNoEstado('A', 'ENGINE_PENDING');
  // o gatilho mora no prompt visual do bloco (api.md §17); a tela de roteiros só edita a fala, então o setup é pela API
  expectOk(await as('duplo').patch(`/creatives/${c.id}/scripts/${c.selectedScriptId}`, { blocks: [{ index: 1, visualPrompt: 'SOLO SHOT, person in kitchen [mock:PROVIDER_ERROR]' }] }));
  await loginRapido(page, 'duplo');
  await page.goto(`/creatives/${c.id}/engine`);
  await expect(primario(page)).toBeEnabled(ESPERA);
  await primario(page).click();
  await esperarEtapa(page, 'generation');
  await expect(page.getByText(/scenes ready · 1 failed/)).toBeVisible(ESPERA);
  await expect(page.getByText(/Regenerate scene \d to continue/)).toBeVisible();
  await expect(primario(page)).toBeDisabled();
  await tela(page, info, 'falha2a-cena-falhou');
  await page.getByRole('button', { name: 'Edit prompt' }).click();
  const prompt = page.getByLabel(/Visual prompt for scene \d/);
  await prompt.fill('SOLO SHOT, person in kitchen, daylight');
  await page.getByRole('button', { name: 'Regenerate with this prompt' }).click();
  await expect(page.getByText(/All \d+ scenes ready/)).toBeVisible(ESPERA);
  await expect(primario(page)).toBeEnabled(ESPERA);
  await tela(page, info, 'falha2b-cenas-prontas');
  await primario(page).click();
  await esperarEtapa(page, 'edit');
});

test('F-FALHA-3 Edit: RENDER_ERROR mostra o frame da falha + Render again; CTA corrigido destrava até o Final OK', async ({ page }, info) => {
  const c = await criarCriativoNoEstado('A', 'RENDER_READY');
  await loginRapido(page, 'donoA');
  await page.goto(`/creatives/${c.id}/edit`);
  await page.getByLabel('CTA text').fill('Start now [mock:RENDER_ERROR]');
  await page.getByRole('button', { name: 'Render preview' }).click();
  await expect(page.getByText(/Render failed at frame \d+/)).toBeVisible(ESPERA);
  await expect(page.getByRole('button', { name: 'Render again' })).toBeVisible();
  await expect(primario(page)).toBeDisabled();
  expect(await estadoNoBanco(c.id)).toBe('RENDER_FAILED');
  await tela(page, info, 'falha3a-render-falhou');
  await page.getByLabel('CTA text').fill('Start now');
  await page.getByRole('button', { name: 'Render again' }).click();
  await expect(primario(page)).toBeEnabled({ timeout: 180_000 });
  await tela(page, info, 'falha3b-render-ok');
  await primario(page).click();
  await esperarEtapa(page, 'review');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled(ESPERA);
});
