// Editor no vídeo v1 (F2d) no navegador, em 1440 (editor-1440) e 390 px (editor-390, viewport via Emulation.setDeviceMetricsOverride
// do Playwright). Web de teste (Next dev 3210, distDir próprio, sem MSW) → API de teste 3111 (mock, render fake) → maquina_test.
// Clipes de verdade (mock-media, grátis) no bucket de teste, pro Player tocar. Screenshots em test-results/telas/<projeto>/.
// D4: arrastar, redimensionar, girar, tempo e cenas só no desktop; no celular texto, estilo e correção de palavra.
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { PERSONAS, q } from '../../harness/db.ts';
import { estadoNoBanco } from '../../harness/fabrica.ts';
import { criarCriativoEditor, criarRemixKeep, doc, esperarRender, linha, putEditor, salvar } from '../../harness/editor.ts';
import { abrirEditor, arrastar, ehCelular, espiao, esperarPlayer, hit, midiaCarregada, painel, salvo, telaEd } from '../../harness/editor-ui.ts';
import { loginRapido, semRolagemHorizontal } from '../../harness/navegador.ts';

test.use({ actionTimeout: 20_000 });
const ESPERA = { timeout: 60_000 };

test('ED-N-01 abre pelo "Edit on the video" da Edição e do OK final; Player toca a mídia assinada; web só fala com a API de teste', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await loginRapido(page, 'adminA');
  await page.goto(`/creatives/${c.id}/edit`);
  const entrar = page.getByRole('link', { name: 'Edit on the video' });
  await expect(entrar).toBeVisible(ESPERA);
  await telaEd(page, info, '01a-edicao-entrada');
  await entrar.click();
  await page.waitForURL(new RegExp(`/creatives/${c.id}/editor$`), ESPERA);
  await esperarPlayer(page);
  await expect.poll(async () => (await midiaCarregada(page)).prontos, { timeout: 30_000, message: 'vídeo da cena carregado no Player' }).toBeGreaterThan(0);
  expect((await midiaCarregada(page)).erros).toBe(0);
  await semRolagemHorizontal(page, 'editor');
  await telaEd(page, info, '01b-editor-aberto');
  // OK final (RENDER_READY): ação secundária "Edit on the video"
  await page.goto(`/creatives/${c.id}/review`);
  await expect(page.getByRole('link', { name: 'Edit on the video' })).toBeVisible(ESPERA);
  spy.soApiDeTeste();
  expect(spy.erros.filter((e) => /CORS|ERR_FAILED|MEDIA_ERR|NotSupportedError/i.test(e)), spy.erros.join('\n')).toEqual([]);
});

test('ED-N-02 [desktop] arrastar, redimensionar, girar e largura da caixa do gancho: autosave com baseRevision encadeado; desfazer salva de volta', async ({ page }, info) => {
  test.skip(ehCelular(info), 'D4: arrastar/redimensionar/girar só no desktop (o celular tem o ED-N-12)');
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'donoA', c.id);
  await page.keyboard.press('Shift+ArrowRight'); // 1 s: o gancho já entrou
  const gancho = hit(page, 'Hook');
  await expect(gancho).toBeVisible(ESPERA);
  await gancho.click();
  const solto = await arrastar(page, gancho, 0, 80);
  const p1 = await spy.put(1);
  expect(p1.status).toBe(200);
  // autosave: 800 ms depois do último gesto (tolerância do browser e do setTimeout)
  expect(p1.at - solto, 'autosave ~800 ms').toBeGreaterThanOrEqual(650);
  expect(p1.at - solto).toBeLessThan(2500);
  expect(p1.body.baseRevision).toBe(0);
  const t1 = p1.body.doc.layers.find((l: any) => l.id === 'hook').transform;
  expect(t1.y).toBeGreaterThan(0.2);
  expect(t1.scale).toBe(1);
  await expect(salvo(page)).toHaveText('Saved');
  // canto = escala
  await arrastar(page, page.locator('.ed-hit.sel .ed-hd.se'), 40, 20);
  const p2 = await spy.put(2);
  expect(p2.body.baseRevision).toBe(1);
  const t2 = p2.body.doc.layers.find((l: any) => l.id === 'hook').transform;
  expect(t2.scale).toBeGreaterThan(1);
  // lateral = largura da caixa
  await arrastar(page, page.locator('.ed-hit.sel .ed-hd.e'), -30, 0);
  const p3 = await spy.put(3);
  expect(p3.body.baseRevision).toBe(2);
  expect(p3.body.doc.layers.find((l: any) => l.id === 'hook').transform.boxWidth).toBeLessThan(t2.boxWidth);
  // alça de cima = giro
  await arrastar(page, page.locator('.ed-hit.sel .ed-hd.rot'), 60, 10);
  const p4 = await spy.put(4);
  expect(p4.body.baseRevision).toBe(3);
  expect(Math.abs(p4.body.doc.layers.find((l: any) => l.id === 'hook').transform.rotationDeg)).toBeGreaterThan(5);
  await telaEd(page, info, '02-gancho-movido');
  // banco = último salvamento
  const l = await linha(c.id);
  expect(l.edit_revision).toBe(4);
  expect(l.edit_doc?.layers.find((x) => x.id === 'hook')?.transform).toEqual(p4.resp.data.doc.layers.find((x: any) => x.id === 'hook').transform);
  // desfazer (⌘Z) volta o giro e salva de novo
  await page.locator('.ed-top').getByRole('button', { name: 'Undo' }).click();
  const p5 = await spy.put(5);
  expect(p5.body.baseRevision).toBe(4);
  expect(p5.body.doc.layers.find((x: any) => x.id === 'hook').transform.rotationDeg).toBe(p3.body.doc.layers.find((x: any) => x.id === 'hook').transform.rotationDeg);
  expect(spy.puts.every((p) => p.status === 200)).toBe(true);
});

test('ED-N-03 [desktop] autosave de 800 ms: digitar rápido = 1 PUT só; mudanças seguidas encadeiam a revisão; "1 change not exported" e Continuar travado', async ({ page }, info) => {
  test.skip(ehCelular(info), 'gesto do desktop; o texto no celular está no ED-N-12');
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  await page.locator('.ed-clip').filter({ hasText: 'Start free today' }).click();
  const txt = painel(page).getByRole('textbox', { name: 'Text', exact: true });
  await txt.click();
  await txt.press('End');
  await txt.pressSequentially(' now', { delay: 120 });
  const ultimaTecla = Date.now();
  const p1 = await spy.put(1);
  expect(spy.puts).toHaveLength(1);
  expect(p1.at - ultimaTecla).toBeGreaterThanOrEqual(650);
  expect(p1.body).toMatchObject({ baseRevision: 0, settings: { ctaText: 'Start free today now' } });
  await page.waitForTimeout(1500);
  expect(spy.puts, 'nada de PUT extra sem mudança').toHaveLength(1);
  await expect(page.locator('.ed-save')).toContainText('change not exported');
  const continuar = page.getByRole('button', { name: 'Continue to Final OK' });
  await expect(continuar).toBeDisabled();
  await expect(continuar).toHaveAttribute('title', 'Export the editor changes to continue');
  expect((await linha(c.id)).edit_settings.ctaText).toBe('Start free today now');
  await telaEd(page, info, '03-cta-texto');
});

test('ED-N-04 estilo: cor e fonte do CTA (desktop pelo painel; celular pela folha Estilo) chegam no doc', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  if (ehCelular(info)) {
    await page.locator('.ed-dock').getByRole('button', { name: 'CTA' }).click();
    await page.locator('.ed-dock').getByRole('button', { name: 'Style' }).click();
  } else {
    await page.locator('.ed-clip').filter({ hasText: 'Start free today' }).click();
  }
  const area = ehCelular(info) ? page.locator('.ed-sheet') : painel(page);
  await area.getByRole('textbox', { name: 'Text color (hex)' }).fill('#E5484D');
  const p1 = await spy.put(1);
  expect(p1.body.doc.layers.find((l: any) => l.id === 'cta').style.color).toBe('#E5484D');
  await area.getByRole('combobox', { name: 'Font' }).click();
  await page.getByRole('option', { name: /Anton/ }).click();
  const p2 = await spy.put(2);
  expect(p2.body.baseRevision).toBe(1);
  expect(p2.body.doc.layers.find((l: any) => l.id === 'cta').style).toMatchObject({ color: '#E5484D', fontId: 'anton-400' });
  expect((await linha(c.id)).edit_doc?.layers.find((l) => l.id === 'cta')?.style).toMatchObject({ color: '#E5484D', fontId: 'anton-400' });
  await telaEd(page, info, '04-cta-estilo');
});

test('ED-N-05 corrigir palavra (sugestão do roteiro) e esconder palavra (text: \'\') pela transcrição', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const [s0, , s2] = c.cenas;
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  if (ehCelular(info)) {
    await page.locator('.ed-dock').getByRole('button', { name: 'Captions' }).click();
    await page.locator('.ed-dock').getByRole('button', { name: 'Transcript' }).click();
  } else {
    await page.locator('.ed-clip').filter({ hasText: 'Follows the speech' }).click();
  }
  const area = ehCelular(info) ? page.locator('.ed-sheet') : painel(page);
  // a palavra que a transcrição errou aparece marcada, com a sugestão do roteiro
  const errada = area.locator('.ed-wd.low', { hasText: 'subscripshun' });
  await expect(errada).toBeVisible(ESPERA);
  await errada.click();
  await expect(page.locator('#wfix')).toHaveValue('subscripshun');
  await area.getByRole('button', { name: 'subscription', exact: true }).click();
  await area.getByRole('button', { name: 'Save', exact: true }).click();
  const p1 = await spy.put(1);
  expect(p1.body.doc.captionWords).toEqual(expect.arrayContaining([{ key: `${s2.sceneId}@1:4`, text: 'subscription' }]));
  // esconder uma palavra: text '' (o tempo dela continua contando pro destaque)
  await area.locator('.ed-wd', { hasText: /^right$/ }).click();
  await area.getByRole('button', { name: 'Hide word' }).click();
  const p2 = await spy.put(2);
  expect(p2.body.doc.captionWords).toEqual(expect.arrayContaining([{ key: `${s0.sceneId}@1:2`, text: '' }]));
  const salvoDb = (await linha(c.id)).edit_doc?.captionWords ?? [];
  expect(salvoDb).toEqual(expect.arrayContaining([{ key: `${s2.sceneId}@1:4`, text: 'subscription' }, { key: `${s0.sceneId}@1:2`, text: '' }]));
  await telaEd(page, info, '05-palavras');
});

test('ED-N-06 [desktop] cenas: aparar (mín. 0,3 s), reordenar e apagar (≥ 1 ativa); a legenda acompanha; restaurar', async ({ page }, info) => {
  test.skip(ehCelular(info), 'D4: cenas só no desktop (o celular confere que não mexe, no ED-N-12)');
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const [s0, s1, s2, s3] = c.cenas;
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  const ROTULO = ['hook', 'problem', 'product', 'cta'];
  const cena = (n: number) => page.locator('.ed-clip.scn').filter({ hasText: ROTULO[n - 1] });
  // aparar o começo da cena 2 em 2,7 s: a 1ª linha da legenda ("You pay for apps you", até 2,625 s) sai junto com a fala
  await cena(2).click();
  await painel(page).locator('#f-sc-in').fill('2.7');
  await painel(page).locator('#f-sc-in').blur();
  const p1 = await spy.put(1);
  expect(p1.body.doc.clips.find((k: any) => k.sceneId === s1.sceneId)).toMatchObject({ inSec: 2.7, outSec: 4, enabled: true, attempt: 1 });
  await expect(painel(page).getByText('Leaves the captions (speech was cut):')).toBeVisible();
  await expect(painel(page).locator('.ed-cutlist')).toContainText('You pay for apps you');
  await expect(page.locator('.ed-tl')).toContainText('14.8 s');
  // mínimo 0,3 s: começo além do fim − 0,3 é preso em fim − 0,3
  await painel(page).locator('#f-sc-in').fill('3.95');
  await painel(page).locator('#f-sc-in').blur();
  const p2 = await spy.put(2);
  const k2 = p2.body.doc.clips.find((k: any) => k.sceneId === s1.sceneId);
  expect(k2.outSec - k2.inSec).toBeCloseTo(0.3, 6);
  expect(p2.status).toBe(200);
  await telaEd(page, info, '06a-cena-aparada');
  await painel(page).getByRole('button', { name: 'Restore original cut' }).click();
  const p3 = await spy.put(3);
  expect(p3.body.doc === null || !p3.body.doc.clips.some((k: any) => k.sceneId === s1.sceneId && (k.inSec !== 0 || k.outSec !== 4)), JSON.stringify(p3.body.doc)).toBe(true);
  // reordenar: cena 2 pra direita (vai depois da 3)
  await painel(page).getByRole('button', { name: 'Move right' }).click();
  await expect.poll(async () => (await linha(c.id)).edit_doc?.clips.filter((k) => k.enabled).map((k) => k.sceneId), ESPERA).toEqual([s0.sceneId, s2.sceneId, s1.sceneId, s3.sceneId]);
  // apagar a cena 4: a fala e a legenda saem; Restaurar aparece
  await cena(4).click();
  await painel(page).getByRole('button', { name: 'Delete scene' }).click();
  await expect(page.getByRole('button', { name: /1 scene deleted · Restore/ })).toBeVisible();
  await expect.poll(async () => (await linha(c.id)).edit_doc?.clips.find((k) => k.sceneId === s3.sceneId)?.enabled, ESPERA).toBe(false);
  // apagar até sobrar 1: o último fica travado com o motivo
  for (const n of [1, 3]) {
    await cena(n).click();
    await painel(page).getByRole('button', { name: 'Delete scene' }).click();
  }
  await cena(2).click();
  const apagar = painel(page).getByRole('button', { name: 'Delete scene' });
  await expect(apagar).toBeDisabled();
  await expect(apagar).toHaveAttribute('title', 'The video needs at least one scene.');
  await expect(salvo(page)).toHaveText('Saved', ESPERA);
  await expect.poll(async () => (await linha(c.id)).edit_doc?.clips.filter((k) => k.enabled).map((k) => k.sceneId), ESPERA).toEqual([s1.sceneId]);
  await telaEd(page, info, '06b-uma-cena');
  // restaurar todas
  await page.getByRole('button', { name: /3 scenes deleted · Restore/ }).click();
  await expect.poll(async () => (await linha(c.id)).edit_doc?.clips.filter((k) => k.enabled).length ?? 4, ESPERA).toBe(4);
  await spy.ocioso();
  expect(spy.puts.every((p) => p.status === 200), JSON.stringify(spy.puts.map((p) => [p.status, p.resp?.error?.details]))).toBe(true);
  // vídeo com menos de 1 s (spec §2.9: "o mínimo é 0,3 s por clipe e 1 s de vídeo"; §8: validarDoc no cliente antes de salvar)
  await cena(2).click();
  await painel(page).locator('#f-sc-in').fill('3.95');
  await painel(page).locator('#f-sc-in').blur();
  // o 3º apagar deixaria 0,3 s: tem que parar no limite de 1 s (botão travado ou recusa sem PUT)
  for (const n of [1, 3, 4]) {
    await cena(n).click();
    const b = painel(page).getByRole('button', { name: 'Delete scene' });
    if (await b.isEnabled()) await b.click();
  }
  await spy.ocioso();
  const ativos = (await linha(c.id)).edit_doc?.clips.filter((k) => k.enabled) ?? [];
  expect(ativos.reduce((a, k) => a + (k.outSec - k.inSec), 0), 'vídeo salvo tem que ter ≥ 1 s').toBeGreaterThanOrEqual(1);
  const recusados = spy.puts.filter((p) => p.status === 400);
  if (recusados.length) await telaEd(page, info, '06c-video-curto-recusado');
  expect.soft(recusados.map((p) => p.resp?.error?.details?.fields), 'o editor deixou o vídeo com 0,3 s e mandou um doc que o servidor recusa (video_too_short); fica "Not saved · retrying"').toEqual([]);
  // desfaz até voltar a salvar
  for (let i = 0; i < 4 && (await salvo(page).textContent()) !== 'Saved'; i++) {
    await page.locator('.ed-top').getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(1500);
  }
  info.annotations.push({ type: 'console', description: spy.erros.slice(0, 5).join(' | ') });
});

test('ED-N-07 conflito em 2 abas: a outra pessoa salva, minha mudança local vira 409 EDIT_CONFLICT e o card mostra a versão dela', async ({ browser, page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'donoA', c.id);
  // aba B (outra pessoa) abre e salva primeiro, sem conflito
  const ctxB = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  const pageB = await ctxB.newPage();
  const spyB = espiao(pageB);
  await abrirEditor(pageB, 'adminA', c.id);
  await pageB.locator('.ed-clip').filter({ hasText: 'Start free today' }).click();
  await painel(pageB).getByRole('textbox', { name: 'Text color (hex)' }).fill('#52A8FF');
  expect((await spyB.put(1)).status).toBe(200);
  // aba A, ociosa: o SSE editor.updated recarrega a versão nova sozinho (toast com o nome)
  await expect(page.getByText(`${PERSONAS.adminA.name} saved a newer version; it's loaded.`)).toBeVisible(ESPERA);
  // A muda algo e, antes do autosave dela (800 ms), B salva de novo → o PUT da A vai com a revisão velha
  if (ehCelular(info)) {
    // bug 4 (09/10): no 390 o toast não pode cobrir a dock; a dock tem que dar pra tocar com o toast na tela
    await telaEd(page, info, '07a-toast-e-dock');
    const t = await page.locator('[data-sonner-toast]').first().boundingBox();
    const d = await page.locator('.ed-dock').boundingBox();
    if (t && d) expect(t.y + t.height, `toast ${JSON.stringify(t)} × dock ${JSON.stringify(d)}`).toBeLessThanOrEqual(d.y + 1);
    await page.locator('.ed-dock').getByRole('button', { name: 'CTA' }).click();
    await page.locator('.ed-dock').getByRole('button', { name: 'Text' }).click();
  } else {
    await page.locator('.ed-clip').filter({ hasText: 'Start free today' }).click();
  }
  const area = ehCelular(info) ? page.locator('.ed-sheet') : painel(page);
  await area.getByRole('textbox', { name: 'Text', exact: true }).fill('Mine wins?');
  const st = expectOk(await as('adminA').get(`/creatives/${c.id}/editor`));
  expectOk(await putEditor('adminA', c.id, { baseRevision: st.revision, doc: st.doc, settings: { ctaText: 'Hers wins' } }));
  const pA = await spy.put(1);
  expect(pA.status).toBe(409);
  expect(pA.resp?.error?.code).toBe('EDIT_CONFLICT');
  const card = page.locator('.ed-card.warn');
  await expect(card).toContainText(`${PERSONAS.adminA.name} saved this video`, ESPERA);
  await telaEd(page, info, '07-conflito');
  await card.getByRole('button', { name: 'Got it' }).click();
  // a versão carregada é a dela; nada da minha mudança foi gravado
  await expect(area.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Hers wins', ESPERA);
  expect((await linha(c.id)).edit_settings.ctaText).toBe('Hers wins');
  await ctxB.close();
});

test('ED-N-08 exportar: OK final travado com edição não exportada (editor e Edição), Export destrava, aprova e o selo "edited" aparece na Biblioteca e na Home', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  if (ehCelular(info)) {
    await page.locator('.ed-dock').getByRole('button', { name: 'CTA' }).click();
    await page.locator('.ed-dock').getByRole('button', { name: 'Style' }).click();
    await page.locator('.ed-sheet').getByRole('textbox', { name: 'Text color (hex)' }).fill('#E5484D');
  } else {
    await page.locator('.ed-clip').filter({ hasText: 'Start free today' }).click();
    await painel(page).getByRole('textbox', { name: 'Text color (hex)' }).fill('#E5484D');
  }
  await spy.put(1);
  const continuar = page.getByRole('button', { name: ehCelular(info) ? 'Final OK' : 'Continue to Final OK' });
  await expect(continuar).toBeDisabled();
  // na Edição: banner âmbar + Continuar travado
  await page.goto(`/creatives/${c.id}/edit`);
  await expect(page.getByText('Editor changes are not in the video yet')).toBeVisible(ESPERA);
  await expect(page.locator('[data-primary]').first()).toBeDisabled();
  await telaEd(page, info, '08a-edicao-banner');
  await page.getByRole('link', { name: 'Back to editor' }).click();
  await esperarPlayer(page);
  const [render] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/creatives/${c.id}/render`)),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(render.status()).toBe(202);
  await telaEd(page, info, '08b-exportando');
  await expect(page.getByText('Exported. The new video is in the Edit step.')).toBeVisible({ timeout: 120_000 });
  await expect(continuar).toBeEnabled(ESPERA);
  expect(await estadoNoBanco(c.id)).toBe('RENDER_READY');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 });
  await continuar.click();
  await page.waitForURL(/\/review$/, ESPERA);
  await expect(page.getByText('edited', { exact: true }).first()).toBeVisible(ESPERA);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.waitForURL(/\/library/, ESPERA);
  const [{ name }] = await q<{ name: string }>('select name from creatives where id = $1', [c.id]);
  const card = page.locator('article, li, [data-item], div').filter({ hasText: name }).filter({ hasText: 'edited' }).first();
  await expect(card).toBeVisible(ESPERA);
  await telaEd(page, info, '08c-biblioteca-selo');
  await page.goto('/');
  await expect(page.getByRole('link').filter({ hasText: name }).filter({ hasText: 'edited' }).first()).toBeVisible(ESPERA);
  await telaEd(page, info, '08d-home-selo');
});

test('ED-N-09 trocar template com camada posicionada pede confirmação: "Keep as is" não troca; "Switch and reposition" apaga os transform', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  await salvar('membroA', c.id, doc({ layers: [{ id: 'hook', transform: { x: 0.45, y: 0.32, scale: 1.2, rotationDeg: -5, boxWidth: 0.8 }, style: { color: '#52A8FF' } }] }));
  await loginRapido(page, 'membroA');
  await page.goto(`/creatives/${c.id}/edit`);
  await expect(page.getByText('has changes')).toBeVisible(ESPERA);
  const patches: any[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().endsWith('/edit')) patches.push(r.postDataJSON()); });
  await page.getByRole('radio', { name: /Bold/ }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('Switch to Bold captions?');
  await telaEd(page, info, '09a-confirmar-template');
  await dlg.getByRole('button', { name: 'Keep as is' }).click();
  await page.waitForTimeout(1200);
  expect(patches.filter((p) => p.templateId)).toEqual([]);
  expect((await linha(c.id)).edit_settings.templateId).toBe('headline');
  await page.getByRole('radio', { name: /Bold/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Switch and reposition' }).click();
  await expect.poll(async () => (await linha(c.id)).edit_settings.templateId, ESPERA).toBe('bold');
  const l = await linha(c.id);
  expect(l.edit_doc?.layers.every((x) => !x.transform)).toBe(true);
  expect(l.edit_doc?.layers.find((x) => x.id === 'hook')?.style).toEqual({ color: '#52A8FF' });
  // sem transform no doc: trocar de novo é direto, sem diálogo (§3.2 + spec §5 "Se nenhuma camada tem transform, a troca é direta")
  await page.waitForTimeout(1500);
  await page.getByRole('radio', { name: /Clean/ }).click();
  const pediuDeNovo = await page.getByRole('alertdialog').isVisible({ timeout: 2000 }).catch(() => false);
  if (pediuDeNovo) {
    await telaEd(page, info, '09b-pede-de-novo-sem-transform');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Switch and reposition' }).click();
  }
  await expect.poll(async () => (await linha(c.id)).edit_settings.templateId, ESPERA).toBe('clean');
  expect.soft(pediuDeNovo, 'depois de "Switch and reposition" não sobra transform; a próxima troca devia ser direta (flags do GET /editor velhas)').toBe(false);
});

test('ED-N-10 remix-keep (F3): entrada travada com o motivo na Edição, editor mostra a trava; nada é salvo', async ({ page }, info) => {
  const c = await criarRemixKeep('A');
  await loginRapido(page, 'membroA');
  await page.goto(`/creatives/${c.id}/edit`);
  const btn = page.getByRole('button', { name: 'Edit on the video' });
  await expect(btn).toBeDisabled(ESPERA);
  await expect(page.getByRole('link', { name: 'Edit on the video' })).toHaveCount(0);
  await telaEd(page, info, '10a-remix-entrada');
  await page.goto(`/creatives/${c.id}/editor`);
  await expect(page.getByRole('heading', { name: 'Editing a variation comes next' })).toBeVisible(ESPERA);
  await telaEd(page, info, '10b-remix-editor');
  expect((await linha(c.id)).edit_revision).toBe(0);
});

test('ED-N-11 i18n: PT-BR pelo cookie (Exportar, Salvo, Gancho, Transcrição) e EN por padrão', async ({ page, context }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  await abrirEditor(page, 'membroA', c.id);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: info.project.use.baseURL! }]);
  await page.reload();
  await esperarPlayer(page);
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toBeVisible(ESPERA);
  await expect(salvo(page)).toHaveText('Salvo');
  if (ehCelular(info)) {
    await expect(page.locator('.ed-dock')).toContainText('Gancho');
    await expect(page.locator('.ed-dock')).toContainText('Legenda');
    await expect(page.locator('.ed-tl')).toContainText('Tempo e cenas: no computador');
    await page.locator('.ed-dock').getByRole('button', { name: 'Legenda' }).click();
    await expect(page.locator('.ed-dock')).toContainText('Transcrição');
  } else {
    await expect(page.getByRole('button', { name: 'Continuar pro OK final' })).toBeVisible();
    await expect(painel(page)).toContainText('Projeto');
    await page.locator('.ed-clip').filter({ hasText: 'Stop wasting money' }).click();
    await expect(painel(page)).toContainText('Gancho');
    await expect(painel(page)).toContainText('Posição');
    await expect(page.locator('.ed-tl')).toContainText('Cortar início');
  }
  // nenhuma chave crua (editor.x.y) na tela
  expect(await page.locator('body').innerText()).not.toMatch(/\beditor\.[a-z]+\.[a-zA-Z]+/);
  await telaEd(page, info, '11-pt-br');
});

test('ED-N-12 [celular] D4: sem alças e sem arrastar; dock → Texto/Estilo/Transcrição; editar texto do CTA salva; cena e tempo travados', async ({ page }, info) => {
  test.skip(!ehCelular(info), 'só no 390');
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const spy = espiao(page);
  await abrirEditor(page, 'membroA', c.id);
  await semRolagemHorizontal(page, 'editor 390');
  await expect(page.locator('.ed-panel')).toHaveCount(0);
  await expect(page.locator('.ed-tl')).toContainText('Timing and scenes: on a computer');
  await expect(page.locator('.ed-dock')).toContainText('Move, resize, rotate, timing and scenes: on a computer.');
  // tocar no gancho do vídeo seleciona e abre a folha; nenhuma alça; arrastar não move
  await page.keyboard.press('Shift+ArrowRight');
  const gancho = hit(page, 'Hook');
  await expect(gancho).toBeVisible(ESPERA);
  await arrastar(page, gancho, 0, 120);
  await expect(page.locator('.ed-hd')).toHaveCount(0);
  await expect(page.locator('.ed-sheet')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(spy.puts, 'arrastar no celular não pode salvar posição').toHaveLength(0);
  await telaEd(page, info, '12a-folha-gancho');
  // cena: "No computador" com o motivo; arrastar cena na timeline não muda nada
  await page.locator('.ed-sheet .ed-shhead button').last().click(); // ✓ fecha a folha
  await page.locator('.ed-dock').getByRole('button', { name: 'Back' }).click();
  await arrastar(page, page.locator('.ed-clip.scn').nth(1), 150, 0);
  await expect(page.locator('.ed-dock')).toContainText('On a computer');
  await page.waitForTimeout(1500);
  expect(spy.puts).toHaveLength(0);
  // texto do CTA pela folha
  if (await page.locator('.ed-sheet .ed-shhead').isVisible()) await page.locator('.ed-sheet .ed-shhead button').last().click();
  if (await page.locator('.ed-dock').getByRole('button', { name: 'Back' }).isVisible()) await page.locator('.ed-dock').getByRole('button', { name: 'Back' }).click();
  await page.locator('.ed-dock').getByRole('button', { name: 'CTA' }).click();
  await page.locator('.ed-dock').getByRole('button', { name: 'Text' }).click();
  await page.locator('.ed-sheet').getByRole('textbox', { name: 'Text', exact: true }).fill('Try it free');
  const p1 = await spy.put(1);
  expect(p1.body).toMatchObject({ baseRevision: 0, settings: { ctaText: 'Try it free' } });
  expect(p1.body.doc).toBeNull();
  await telaEd(page, info, '12b-folha-texto');
});

test('ED-N-13 regerar uma cena com o editor aberto: o corte dela volta pro clipe inteiro sozinho (attempt 2)', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const [s0, s1, s2, s3] = c.cenas;
  await salvar('membroA', c.id, doc({ clips: [
    { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
    { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 1, outSec: 4 },
    { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 5 },
    { sceneId: s3.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
  ] }));
  await abrirEditor(page, 'membroA', c.id);
  await expect(page.getByText(/00:16:15/)).toBeVisible(ESPERA); // 14 s de cenas + 2,5 s de end card
  expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/1/regenerate`, {}), 202);
  await expect.poll(() => estadoNoBanco(c.id), { timeout: 120_000 }).toMatch(/RENDER_READY|EDIT_PENDING/);
  const [{ dur }] = await q<{ dur: string }>(`select f.duration_sec as dur from scenes s join files f on f.id = s.clip_file_id where s.id = $1`, [s1.sceneId]);
  const total = 3 + Number(dur) + 5 + 3 + 2.5;
  const tc = (x: number) => { const f = Math.round(x * 30); return `${String(Math.floor(f / 1800)).padStart(2, '0')}:${String(Math.floor(f / 30) % 60).padStart(2, '0')}:${String(f % 30).padStart(2, '0')}`; };
  await expect(page.getByText(new RegExp(tc(total))), `duração com a cena 2 inteira (${total} s)`).toBeVisible({ timeout: 60_000 });
  await telaEd(page, info, '13-cena-regerada');
});

test('ED-N-14 selo "edited" no lote (feature 2): variação do zero exportada com doc aparece com o selo na lista do lote', async ({ page }, info) => {
  const { criarLote } = await import('../../harness/f2.ts');
  const lote = await criarLote('A', 'LAUNCHED');
  const it = lote.items.find((i) => i.kind === 'NEW_HOOKS' && !i.isControl)!;
  const c = await criarCriativoEditor('A', { renderDoc: doc({ layers: [{ id: 'cta', style: { color: '#E5484D' } }] }) });
  await q(`update creatives set origin = 'VARIATION', champion_id = $2, variation_batch_id = $3, variation_item_id = $4, variation_kind = 'NEW_HOOKS' where id = $1`,
    [c.id, lote.champion.id, lote.id, it.id]);
  await loginRapido(page, 'membroA');
  await page.goto(`/variations/${lote.champion.id}/batch?batch=${lote.id}`);
  await expect(page.getByText(/Hook 1|QA hook 0/).first()).toBeVisible(ESPERA);
  await telaEd(page, info, '14-lote');
  await expect(page.getByText('edited', { exact: true }).first(), 'contrato §5.1: o selo vem no item do lote e o web mostra na peça').toBeVisible({ timeout: 10_000 });
});

test('ED-N-15 Generate novo com o editor aberto: o editor fecha com o motivo enquanto as cenas novas geram', async ({ page }, info) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  await abrirEditor(page, 'membroA', c.id);
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=SCENES&model=kling-3.0&format=VERTICAL_9_16`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16', expectedCostUsd: e.costUsd, confirm: true }), 202);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The editor opens when the scenes are ready' })).toBeVisible(ESPERA);
  await telaEd(page, info, '15-generate-novo');
  await expect.poll(() => estadoNoBanco(c.id), { timeout: 180_000 }).toMatch(/RENDER_READY|EDIT_PENDING/);
  await page.reload();
  await esperarPlayer(page);
});

test.afterEach(async () => {
  // render fake em andamento atravessaria o TRUNCATE do próximo teste
  const { esperarJobsQuietos } = await import('../../harness/f2.ts');
  await esperarJobsQuietos(60_000);
});

void esperarRender;
