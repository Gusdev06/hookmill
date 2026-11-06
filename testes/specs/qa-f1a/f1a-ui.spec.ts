// QA 06/11 do recorte F1a no navegador, 1440 e 390, EN e PT: web de teste (sem MSW) → API do QA (mock, render fake, maquina_f1a_test).
// Prova por tela + clique; screenshots em test-results/qa-f1a-telas/<projeto>/. Rodar: ver playwright.qaf1a.config.ts. Dono: maquina-qa.
import { readFileSync, statSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { assentou, ateLote, FALA20 } from '../../harness/iterate.ts';
import { loginRapido } from '../../harness/navegador.ts';
import { DATA, LANGS, type Lang, campeao, comCreditos, conectarMetaMock, espiar, gerar, idioma, livro, notas, novoLote, prepararWs, saldo, semAposentado, semLateral, semSeloDev, setLayers, tela, usar } from '../../harness/f1a.ts';

test.describe.configure({ timeout: 1_200_000 });
test.beforeEach(async ({ page }) => { await prepararWs(); await comCreditos(100); await conectarMetaMock(); await semSeloDev(page); });
test.afterEach(async () => { await esperarJobsQuietos(180_000); });

const T = {
  en: { pending: "This video's headline can't be rewritten yet", pill: "Headline can't be rewritten yet", use: 'Use template', headline: 'New headline', soft: 'Your ad has captions burned in', upload: 'Upload the version without captions', other: 'Pick another template', generate: /^Generate/, download: 'Download', editReason: 'This older piece no longer opens in the editor', zip: /Download zip/, planChanged: /plan changed/i, replan: /Plan again/ },
  'pt-BR': { pending: 'A headline deste vídeo ainda não pode ser reescrita', pill: 'Headline ainda não pode ser reescrita', use: 'Usar template', headline: 'Headline nova', soft: 'Seu anúncio tem legenda queimada', upload: 'Subir a versão sem legenda', other: 'Escolher outro template', generate: /^Gerar/, download: 'Baixar', editReason: 'Esta peça antiga não abre mais no editor', zip: /Baixar zip/, planChanged: /plano mudou/i, replan: /Planejar de novo/ },
} as const;

async function abrir(page: Page, path: string, lang: Lang, baseURL: string) {
  await idioma(page.context(), lang, baseURL);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}
/** Passa pelo quiz do lote normal por clique até o plano. */
async function passarQuiz(page: Page) {
  const gerarBtn = page.getByRole('button', { name: /^(Generate|Gerar) \d+/ });
  for (let i = 0; i < 6; i++) {
    if (await gerarBtn.first().isVisible().catch(() => false)) return gerarBtn.first();
    await fechaTour(page);
    const c = page.getByRole('button', { name: /^(Continue|Continuar|See the plan|Ver o plano|Show the plan)/ }).first();
    if (await c.isVisible().catch(() => false)) await c.click().catch(() => undefined);
    await page.waitForTimeout(1_200);
  }
  await expect(gerarBtn.first()).toBeVisible({ timeout: 30_000 });
  return gerarBtn.first();
}
const fechaTour = async (page: Page) => { for (const name of [/^(got it|entendi)/i]) { const b = page.getByRole('button', { name }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => undefined); } };

test('F1A-UI-01 lote de template com legenda: Plan, geração e download sem tarja nem texto antigo', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const b = await usar('let-hookmill-pick', championId);
  expect(b.pieces.length).toBeGreaterThan(0);
  for (const lang of LANGS) {
    await abrir(page, `/templates/run/${b.id}`, lang, baseURL!);
    await expect(page.locator('#t-plan, #t-generate').first()).toBeVisible();
    await semAposentado(page, `plan ${lang}`);
    await semLateral(page, `plan ${lang}`);
    await tela(page, info, `01-plan-pack-${lang}`);
    notas(info, `01-plan-texto-${lang}`, await page.locator('main').innerText());
  }
  await fechaTour(page);
  await page.locator('#t-generate').first().click();
  await expect.poll(async () => (await q(`select status from variation_batches where id = $1`, [b.id]))[0].status, { timeout: 30_000 }).toBe('LAUNCHED');
  await tela(page, info, '01-gerando-pt-BR');
  await semAposentado(page, 'gerando');
  await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  for (const lang of LANGS) {
    await abrir(page, `/templates/run/${b.id}`, lang, baseURL!);
    await semAposentado(page, `pronto ${lang}`);
    await semLateral(page, `pronto ${lang}`);
    await tela(page, info, `01-pronto-${lang}`);
    await abrir(page, `/iterate/${b.id}?view=generate`, lang, baseURL!);
    await semAposentado(page, `generate ${lang}`);
    await tela(page, info, `01-generate-${lang}`);
  }
  expect(spy.campos, 'campo aposentado no JSON da API').toEqual([]);
  notas(info, '01-erros', spy.erros);
});

test('F1A-UI-02 HEADLINE replace: galeria, lote normal, sem crédito nem data; add segue', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  const antes = (await saldo()).balance;
  for (const headline of ['loose', 'box'] as const) {
    await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline });
    for (const lang of LANGS) {
      await abrir(page, `/templates?championId=${championId}`, lang, baseURL!);
      const card = page.locator(`article[aria-label="${T[lang].headline}"]`).first();
      await expect(card).toBeVisible({ timeout: 40_000 });
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByText(T[lang].pill)).toBeVisible();
      await expect(card.getByRole('button', { name: T[lang].use })).toBeDisabled();
      await semAposentado(page, `galeria ${headline} ${lang}`);
      await semLateral(page, `galeria ${headline} ${lang}`);
      const txt = await card.innerText();
      expect(txt, 'sem data').not.toMatch(DATA);
      const estouro = await card.getByText(T[lang].pill).evaluate((el) => { const c = el.closest('article')!.getBoundingClientRect(), r = el.getBoundingClientRect(); return { pill: r.right, card: c.right }; });
      expect.soft(estouro.pill, `selo não sai do cartão ${lang}`).toBeLessThanOrEqual(estouro.card);
      await card.screenshot({ path: `${(await tela(page, info, `02-galeria-${headline}-${lang}`)).replace('.png', '-card.png')}` });
    }
  }
  // lote normal, solta
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const n = await novoLote(championId);
  for (const lang of LANGS) {
    await abrir(page, `/iterate/${n.id}`, lang, baseURL!);
    await passarQuiz(page);
    await expect(page.getByText(T[lang].pending).first()).toBeVisible({ timeout: 40_000 });
    await semAposentado(page, `lote normal ${lang}`);
    await semLateral(page, `lote normal ${lang}`);
    const linha = await page.getByRole('status').filter({ hasText: T[lang].pending }).first().innerText();
    expect(linha, 'sem data na linha').not.toMatch(DATA);
    notas(info, `02-linha-${lang}`, linha);
    await tela(page, info, `02-lote-normal-pendente-${lang}`);
  }
  expect((await saldo()).balance, 'sem crédito').toBe(antes);
  expect(await livro()).toEqual([]);
  // sem headline: add oferecido
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: null });
  for (const lang of LANGS) {
    await abrir(page, `/templates?championId=${championId}`, lang, baseURL!);
    const card = page.locator(`article[aria-label="${T[lang].headline}"]`).first();
    await expect(card).toBeVisible({ timeout: 40_000 });
    await expect(card.getByText(T[lang].pill)).toHaveCount(0);
    await expect(card.getByRole('button', { name: T[lang].use })).toBeEnabled();
    await tela(page, info, `02-galeria-add-${lang}`);
  }
  // clique de verdade: usa o Headline `add`
  const card = page.locator(`article[aria-label="${T['pt-BR'].headline}"]`).first();
  await card.getByRole('button', { name: T['pt-BR'].use }).click();
  await page.waitForURL(/\/templates\/run\//, { timeout: 60_000 });
  await expect(page.locator('#t-plan')).toBeVisible({ timeout: 120_000 });
  await tela(page, info, '02-plan-add-pt-BR');
  await semAposentado(page, 'plan add');
  notas(info, '02-erros', { erros: spy.erros, campos: spy.campos });
  expect(spy.campos).toEqual([]);
});

test('F1A-UI-04 peça e lote antigos: abre, baixa de verdade (clique), zip; Editar desligado com motivo; biblioteca', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const prontas = fim.pieces.filter((p: any) => p.status === 'ready' && p.files?.length);
  const [coberta, placa] = prontas;
  await q(`update variation_items set payload = payload || '{"captionOverride":true}'::jsonb where id = $1`, [coberta.id]);
  await q(`update variation_items set auto_type = 'HEADLINE', payload = $2::jsonb where id = $1`, [placa.id, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old new words', highlight: null, sources: {}, language: 'en', original: 'Original headline here', format: 'VERTICAL_9_16' }, whyKey: 'hook', captionOverride: true })]);
  await q(`update variation_batches set insight = insight || $2::jsonb, settings = coalesce(settings,'{}'::jsonb) || '{"captionCandidates":[{"type":"REVIEW","params":{}}]}'::jsonb where id = $1`, [b.id, JSON.stringify({ captionNote: true, captionBlocked: [{ type: 'REVIEW', template: null, reason: 'burned_captions', forced: true }] })]);
  const d = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  const pc = d.pieces.find((p: any) => p.id === coberta.id), pp = d.pieces.find((p: any) => p.id === placa.id);
  const baixou: Record<string, unknown>[] = [];
  for (const lang of LANGS) {
    await abrir(page, `/iterate/${b.id}?view=download`, lang, baseURL!);
    await semAposentado(page, `download ${lang}`);
    await semLateral(page, `download ${lang}`);
    await tela(page, info, `04-download-${lang}`);
    // os dois cartões: clique no Download do rodapé; Edit do HEADLINE antigo desligado com title
    for (const [nome, p] of [['coberta', pc], ['placa', pp]] as const) {
      const cartao = page.locator('div', { has: page.locator(`a[download="${p.files[0].name}"]`) }).last();
      const fundo = page.locator(`a[download="${p.files.find((f: any) => f.format === '9x16').name}"]`).first();
      await expect(fundo, `${nome} ${lang}: botão Download`).toBeVisible();
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), fundo.click()]);
      const path = await dl.path();
      const buf = readFileSync(path);
      baixou.push({ lang, nome, sugestao: dl.suggestedFilename(), bytes: statSync(path).size, magic: buf.subarray(4, 8).toString() });
      expect(buf.subarray(4, 8).toString(), `${nome}: é mp4`).toBe('ftyp');
      expect(buf.length).toBeGreaterThan(1000);
      void cartao;
    }
    const fundoPlaca = page.locator(`a[download="${pp.files.find((f: any) => f.format === '9x16').name}"]`).first();
    const editar = fundoPlaca.locator('xpath=following-sibling::*[1]');
    await expect(editar).toBeDisabled();
    await expect(editar).toHaveAttribute('title', T[lang].editReason);
    await fundoPlaca.scrollIntoViewIfNeeded();
    await tela(page, info, `04-editar-off-${lang}`);
    // motivo visível sem hover? (no celular o title não aparece)
    const visivel = await page.getByText(T[lang].editReason).count();
    notas(info, `04-motivo-visivel-${lang}`, { textoVisivelNaTela: visivel, titulo: await editar.getAttribute('title') });
    // zip de verdade
    const zipBtn = page.getByRole('button', { name: T[lang].zip }).first();
    const [z] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), zipBtn.click()]);
    const zb = readFileSync(await z.path());
    baixou.push({ lang, nome: 'zip', sugestao: z.suggestedFilename(), bytes: zb.length, magic: zb.subarray(0, 2).toString() });
    expect(zb.subarray(0, 2).toString()).toBe('PK');
    // Generate (lista) e prévia
    await abrir(page, `/iterate/${b.id}?view=generate`, lang, baseURL!);
    await semAposentado(page, `generate antigo ${lang}`);
    await tela(page, info, `04-generate-${lang}`);
    // biblioteca
    await abrir(page, `/library`, lang, baseURL!);
    await semAposentado(page, `library ${lang}`);
    await semLateral(page, `library ${lang}`);
    await tela(page, info, `04-library-${lang}`);
  }
  // Biblioteca: clique no Download de verdade
  const linkLib = page.locator('main a[download]').first();
  await expect(linkLib).toBeVisible({ timeout: 30_000 });
  // B1: o clique pede GET /creatives/:id/download (URL com Content-Disposition: attachment)
  const dlLib = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
  const hrefLib = await linkLib.getAttribute('href');
  await linkLib.click();
  const dl = await dlLib;
  if (dl) {
    const lb = readFileSync(await dl.path());
    baixou.push({ nome: 'library', sugestao: dl.suggestedFilename(), bytes: lb.length, magic: lb.subarray(4, 8).toString() });
    expect(lb.subarray(4, 8).toString()).toBe('ftyp');
  } else {
    await tela(page, info, '04-library-clique-abriu-player');
    baixou.push({ nome: 'library', baixou: false, urlDepoisDoClique: page.url().slice(0, 120), temContentDisposition: /response-content-disposition/i.test(hrefLib ?? '') });
    await page.goBack();
  }
  expect.soft(dl, 'Biblioteca: clique no Download baixa').not.toBeNull();
  // Biblioteca: o Edit da peça HEADLINE replace antiga
  await abrir(page, `/library`, 'en', baseURL!);
  await tela(page, info, '04-library-en-final');
  const linkPlaca = page.locator('main').getByRole('link', { name: /^Edit$/ });
  notas(info, '04-library-edit-links', await linkPlaca.evaluateAll((els) => els.map((e) => e.getAttribute('href'))));
  const naBib = await page.locator(`main a[href*="/creatives/${pp.creativeId}/editor"]`).count();
  notas(info, '04-library-edit-placa-ligado', { creativeId: pp.creativeId, linksParaOEditor: naBib });
  // abrir editor direto pela URL da peça antiga
  await abrir(page, `/creatives/${pp.creativeId}/editor`, 'en', baseURL!);
  await page.waitForTimeout(3_000);
  await tela(page, info, '04-editor-url-sem-from-en');
  notas(info, '04-editor-url-sem-from-texto', await page.locator('body').innerText());
  // B2: a Biblioteca não tem mais link pro editor desta peça; o gate segue valendo por URL (?from=library)
  await abrir(page, `/library`, 'en', baseURL!);
  await expect(page.locator(`main a[href*="/creatives/${pp.creativeId}/editor"]`), 'B2: Editar desligado').toHaveCount(0);
  await abrir(page, `/creatives/${pp.creativeId}/editor?from=library`, 'en', baseURL!);
  await expect(page.getByText('This older piece no longer opens in the editor', { exact: false }).first(), 'gate do editor explica o motivo').toBeVisible({ timeout: 30_000 });
  await tela(page, info, '04-editor-gate-en');
  notas(info, '04-baixou', baixou);
  expect(spy.campos, 'campo aposentado no JSON').toEqual([]);
  notas(info, '04-erros', spy.erros);
});

test('F1A-UI-05 template vazio: soft, saídas, nada cobrado; toast do 422 TEMPLATE_DOESNT_FIT; replan com a versão limpa', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  // toast: galeria carregada com o Headline cabendo; a headline "aparece" no anúncio; clique
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: null });
  for (const lang of LANGS) {
    await abrir(page, `/templates?championId=${championId}`, lang, baseURL!);
    const card = page.locator(`article[aria-label="${T[lang].headline}"]`).first();
    await expect(card.getByRole('button', { name: T[lang].use })).toBeEnabled({ timeout: 40_000 });
    await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
    const antes = await q(`select count(*)::int n from variation_batches`);
    const resp = page.waitForResponse((r) => /\/ad-templates\/new-headline\/use$/.test(r.url()) && r.request().method() === 'POST');
    await card.getByRole('button', { name: T[lang].use }).click();
    const r = await resp;
    expect(r.status()).toBe(422);
    const corpo = await r.json();
    expect(corpo.error.code).toBe('TEMPLATE_DOESNT_FIT');
    expect(corpo.error.details.reason).toBe('headline_pending');
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: T[lang].pending });
    await expect(toast, `toast ${lang}`).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: (await tela(page, info, `05-toast-422-${lang}`)).replace('.png', '-viewport.png') });
    expect(await q(`select count(*)::int n from variation_batches`), 'nenhum lote criado').toEqual(antes);
    await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: null });
  }
  expect(await livro()).toEqual([]);

  // template único com a legenda no caminho
  await setLayers(championId, baseMap, { captionY: 100, captionH: 1080 });
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const soft = (g.items ?? g).filter((t: any) => t.fit?.level === 'soft' && !t.pack);
  expect(soft.length).toBeGreaterThan(0);
  const alvo = soft[0];
  const antes = (await saldo()).balance;
  await abrir(page, `/templates?championId=${championId}`, 'en', baseURL!);
  await tela(page, info, '05-galeria-soft-en');
  await semAposentado(page, 'galeria soft');
  await semLateral(page, 'galeria soft');
  const cardEn = page.locator(`article[aria-label="${alvo.name}"]`).first();
  await cardEn.scrollIntoViewIfNeeded();
  await tela(page, info, '05-galeria-card-soft-en');
  await cardEn.getByRole('button', { name: T.en.use }).click();
  await page.waitForURL(/\/templates\/run\//, { timeout: 60_000 });
  const batchId = new URL(page.url()).pathname.split('/').pop()!;
  await ateLote('donoA', batchId, (x) => x.status === 'PLAN_READY', { oQue: 'soft', timeoutMs: 180_000 });
  for (const lang of LANGS) {
    await abrir(page, `/templates/run/${batchId}`, lang, baseURL!);
    await expect(page.getByText(T[lang].soft)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: T[lang].upload })).toBeVisible();
    await expect(page.getByRole('link', { name: T[lang].other })).toBeVisible();
    await expect(page.locator('#t-generate').first()).toBeDisabled();
    await semAposentado(page, `soft ${lang}`);
    await semLateral(page, `soft ${lang}`);
    await tela(page, info, `05-soft-${lang}`);
    notas(info, `05-soft-texto-${lang}`, await page.locator('main').innerText());
  }
  expect((await saldo()).balance, 'nada cobrado').toBe(antes);
  expect(await livro()).toEqual([]);
  // saída: outro template leva à galeria com o anúncio
  await page.getByRole('link', { name: T['pt-BR'].other }).click();
  await page.waitForURL(/\/templates\?/, { timeout: 30_000 });
  expect(page.url()).toContain(championId);
  // saída: enviar a versão sem legenda e planejar de novo
  await abrir(page, `/templates/run/${batchId}`, 'en', baseURL!);
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles(FALA20);
  const replan = page.getByRole('button', { name: T.en.replan });
  await expect(replan, 'depois do upload aparece Plan again').toBeVisible({ timeout: 120_000 });
  await tela(page, info, '05-depois-upload-en');
  await replan.click();
  await ateLote('donoA', batchId, (x) => x.status === 'PLAN_READY' && x.template?.fit?.level !== 'soft', { oQue: 'replan', timeoutMs: 180_000 }).catch((e) => notas(info, '05-replan-erro', String(e)));
  const dep = expectOk(await as('donoA').get(`/iterate/${batchId}`));
  notas(info, '05-replan', { fit: dep.template?.fit, pieces: dep.pieces.map((p: any) => p.code), quote: dep.template?.quote, status: dep.status, erro: dep.error });
  await abrir(page, `/templates/run/${batchId}`, 'en', baseURL!);
  await tela(page, info, '05-replan-en');
  expect(dep.template.fit.level, 'com a versão limpa encaixa').toBe('ok');
  expect(dep.pieces.length).toBeGreaterThan(0);
  expect(spy.campos).toEqual([]);
  notas(info, '05-erros', spy.erros);
});

test('F1A-UI-02b quiz com headline_pending: pedir só "New headlines" não deixa a pessoa sem saída nem sem aviso', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const n = await novoLote(championId);
  await abrir(page, `/iterate/${n.id}`, 'en', baseURL!);
  // pergunta 1
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  // pergunta 2: wants
  // B4: com headline_pending o quiz não oferece a opção
  await expect(page.getByText('Let HookMill choose', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('New headlines', { exact: true }), 'quiz não oferece New headlines').toHaveCount(0);
  await tela(page, info, '02b-quiz-sem-new-headlines-en');
  await page.getByRole('button', { name: /^(Continue|See|Show|Save)/ }).last().click();
  await page.waitForTimeout(2_500);
  await tela(page, info, '02b-depois-do-quiz-en');
  const d = expectOk(await as('donoA').get(`/iterate/${n.id}`));
  const pendente = await page.getByText(T.en.pending).count();
  notas(info, '02b', { pecas: d.pieces.map((p: any) => p.code), pendenteNaTela: pendente, wants: d.answers?.wants ?? null, texto: (await page.locator('main').innerText()).slice(0, 900) });
  expect(pendente, 'a linha headline_pending aparece no plano').toBeGreaterThan(0);
  expect(d.pieces.some((p: any) => p.type === 'HEADLINE')).toBe(false);
});

test('F1A-UI-05b seleção: soft + ok no gerador, skipped na tela; hard fica desligado; misfit com o texto headline_pending', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 100, captionH: 1080, headline: 'loose' });
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const lista = (g.items ?? g) as any[];
  notas(info, '05b-fits', lista.map((t) => `${t.slug}:${t.fit?.level}:${t.fit?.reason ?? ''}`));
  const soft = lista.find((t) => t.fit?.level === 'soft' && !t.pack), ok = lista.find((t) => t.fit?.level === 'ok' && !t.pack && t.category === 'frames');
  const h = lista.find((t) => t.slug === 'new-headline');
  expect(h.fit).toEqual({ level: 'hard', reason: 'headline_pending' });
  // anúncio já escolhido, ?t= com o soft e o ok: Continue
  await abrir(page, `/templates?championId=${championId}&t=${soft.slug},${ok.slug}`, 'en', baseURL!);
  await tela(page, info, '05b-selecao-marcada-en');
  const cont = page.getByRole('button', { name: /Continue|Use|Generate/ }).last();
  notas(info, '05b-barra', await page.locator('body').innerText().then((t) => t.slice(-300)));
  await cont.click().catch(() => undefined);
  await page.waitForURL(/\/templates\/run\//, { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(3_000);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  if (/\/templates\/run\//.test(page.url())) {
    await ateLote('donoA', id, (x) => x.status === 'PLAN_READY', { oQue: 'seleção', timeoutMs: 180_000 });
    await abrir(page, `/templates/run/${id}`, 'en', baseURL!);
    await tela(page, info, '05b-selecao-plano-en');
    notas(info, '05b-plano-texto', await page.locator('main').innerText());
    await semAposentado(page, 'selecao plano');
    await abrir(page, `/templates/run/${id}`, 'pt-BR', baseURL!);
    await tela(page, info, '05b-selecao-plano-pt-BR');
    await semAposentado(page, 'selecao plano pt');
  } else {
    notas(info, '05b-sem-plano', page.url());
    await tela(page, info, '05b-sem-plano');
  }
  // sem anúncio: marca Headline + outro e escolhe o anúncio depois → misfit lista o motivo
  await abrir(page, `/templates/selection?t=new-headline,${ok.slug}`, 'en', baseURL!);
  await tela(page, info, '05b-passo-do-anuncio-en');
  notas(info, '05b-passo-do-anuncio', await page.locator('main').innerText());
  expect(await livro()).toEqual([]);
});

test('F1A-UI-06 plano limpo em 2 abas: sem laço, sem cobrança errada; aba velha recebe "plano mudou"', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await usar('let-hookmill-pick', championId);
  const N = b.pieces.length, Q = b.template.quote;
  // aba A abre ANTES do plano ser "velho"
  await abrir(page, `/templates/run/${b.id}`, 'en', baseURL!);
  await expect(page.locator('#t-generate').first()).toBeEnabled({ timeout: 30_000 });
  await tela(page, info, '06-aba-a-antes');
  await q(`update variation_items set payload = payload || '{"captionOverride":true}'::jsonb where id = $1`, [b.pieces[0].id]);
  await q(`insert into variation_items (id, workspace_id, batch_id, kind, index, priority, status, included, selection, rationale, code, axis, change, auto_type, in_zip, payload, updated_at)
           values ('qa_old_headline','qa_ws_alfa',$1,'AUTO_EDIT',900,900,'READY',true,'auto','old','HEADLINE-OLD','ITERATION','old','HEADLINE',true,$2::jsonb,now())`,
    [b.id, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old', highlight: null, sources: {}, language: 'en', original: 'Orig', format: 'VERTICAL_9_16' }, whyKey: 'hook' })]);
  const ab = await page.context().newPage();
  const spyB = espiar(ab);
  await semSeloDev(ab);
  await abrir(ab, `/templates/run/${b.id}`, 'en', baseURL!);
  await expect(ab.locator('#t-generate').first()).toBeEnabled({ timeout: 30_000 });
  await tela(ab, info, '06-aba-b-depois');
  // sem laço: janela de 20 s nas duas abas
  const c0 = spy.gets.length, d0 = spyB.gets.length;
  await page.waitForTimeout(20_000);
  const gA = spy.gets.length - c0, gB = spyB.gets.length - d0;
  notas(info, '06-gets-20s', { abaA: gA, abaB: gB });
  expect(gA, 'aba A: GET /iterate/:id em 20 s').toBeLessThanOrEqual(16);
  expect(gB, 'aba B: GET /iterate/:id em 20 s').toBeLessThanOrEqual(16);
  const d = expectOk(await as('donoA').get(`/iterate/${b.id}`));
  expect(d.pieces.length).toBe(N - 1);
  // refoco da aba A (o react-query refaz no foco); se ela ainda mostra o velho, o Generate leva o 409
  await page.bringToFront();
  await page.locator('#t-generate').first().click();
  await page.waitForTimeout(3_000);
  await tela(page, info, '06-aba-a-clique');
  const resA = await q(`select status from variation_batches where id = $1`, [b.id]);
  const toasts = await page.locator('[data-sonner-toast]').allInnerTexts();
  notas(info, '06-aba-a', { status: resA[0].status, toasts, N, Q, Q1: d.template.quote });
  // se a aba A lançou, foi com os números novos; nunca com os velhos
  const reservas = (await livro()).filter((x) => x.kind === 'RESERVE');
  if (resA[0].status === 'LAUNCHED') expect(reservas.map((x) => x.delta)).toEqual([-d.template.quote]);
  else {
    expect(reservas).toEqual([]);
    await expect(page.locator('#t-generate').first()).toBeEnabled({ timeout: 15_000 });
    await page.locator('#t-generate').first().click();
    await expect.poll(async () => (await q(`select status from variation_batches where id = $1`, [b.id]))[0].status, { timeout: 30_000 }).toBe('LAUNCHED');
  }
  // aba B ainda com o plano aberto clica Generate: nada de 2ª cobrança
  await ab.bringToFront();
  const gb = ab.locator('#t-generate').first();
  if (await gb.isVisible().catch(() => false) && await gb.isEnabled().catch(() => false)) {
    await gb.click().catch(() => undefined);
    await ab.waitForTimeout(2_000);
  }
  await tela(ab, info, '06-aba-b-clique');
  expect((await livro()).filter((x) => x.kind === 'RESERVE').map((x) => x.delta), '1 reserva, com o quote novo').toEqual([-d.template.quote]);
  expect(await q(`select count(*)::int n from creatives where variation_item_id in ($1,'qa_old_headline')`, [b.pieces[0].id])).toEqual([{ n: 0 }]);
  await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  notas(info, '06-erros', { a: spy.erros, b: spyB.erros, livro: await livro() });
});

test('F1A-UI-06b aba velha com lote que ficou vazio: Generate não cobra, a tela sai do estado velho', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await usar('breaking-news', championId);
  expect(b.pieces.length, JSON.stringify(b.error)).toBeGreaterThan(0);
  await abrir(page, `/templates/run/${b.id}`, 'en', baseURL!);
  await expect(page.locator('#t-generate').first()).toBeEnabled({ timeout: 30_000 });
  await q(`update variation_items set payload = payload || '{"captionOverride":true}'::jsonb where batch_id = $1`, [b.id]);
  const resp = page.waitForResponse((r) => /\/iterate\/[^/]+\/start$/.test(r.url()));
  await page.locator('#t-generate').first().click();
  const r = await resp;
  const corpo = await r.json();
  await page.waitForTimeout(2_500);
  await tela(page, info, '06b-aba-velha-depois-do-clique');
  const estado = { status: r.status(), erro: corpo.error, toasts: await page.locator('[data-sonner-toast]').allInnerTexts(), softNaTela: await page.getByText(T.en.soft).count(), generateLigado: await page.locator('#t-generate').first().isEnabled().catch(() => null), livro: await livro() };
  notas(info, '06b', estado);
  expect(await livro(), 'sem reserva').toEqual([]);
  expect(estado.toasts.join(' '), 'B6: toast diz que o plano mudou, sem mandar recarregar').toMatch(/nothing fits anymore/);
  await page.reload();
  await expect(page.getByText(T.en.soft), 'recarregou: faixa soft, Generate desligado').toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#t-generate').first()).toBeDisabled();
  await tela(page, info, '06b-depois-de-recarregar');
});

test('F1A-UI-07 lote normal com e sem legenda: plano, gerar por clique, faixa/encolher, baixar', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 300, captionH: 700 });
  const b = await novoLote(championId);
  expect(b.status).toBe('PLAN_READY');
  for (const lang of LANGS) {
    await abrir(page, `/iterate/${b.id}`, lang, baseURL!);
    await semAposentado(page, `plano normal ${lang}`);
    await semLateral(page, `plano normal ${lang}`);
    await tela(page, info, `07-plano-${lang}`);
    notas(info, `07-plano-texto-${lang}`, await page.locator('main').innerText());
  }
  const botao = await passarQuiz(page);
  await tela(page, info, '07-plano-depois-do-quiz');
  await semAposentado(page, 'plano depois do quiz');
  notas(info, '07-plano-depois-do-quiz', await page.locator('main').innerText());
  await botao.click();
  await expect.poll(async () => (await q(`select status from variation_batches where id = $1`, [b.id]))[0].status, { timeout: 30_000 }).toBe('LAUNCHED');
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  for (const lang of LANGS) {
    await abrir(page, `/iterate/${b.id}`, lang, baseURL!);
    await semAposentado(page, `lançado ${lang}`);
    await tela(page, info, `07-lancado-${lang}`);
    await abrir(page, `/iterate/${b.id}?view=download`, lang, baseURL!);
    await semAposentado(page, `download normal ${lang}`);
    await semLateral(page, `download normal ${lang}`);
    await tela(page, info, `07-download-${lang}`);
  }
  const f = page.locator('main a[download]').first();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), f.click()]);
  expect(readFileSync(await dl.path()).subarray(4, 8).toString()).toBe('ftyp');
  const rs = await q(`select vi.code, r.status, r.input from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id where c.variation_batch_id = $1`, [b.id]);
  notas(info, '07-resumo', { pieces: fim.pieces.map((p: any) => `${p.code}:${p.status}:${p.errorCode ?? ''}`), reframes: rs.map((r) => [r.code, r.input?.video?.reframe ?? r.input?.reframe ?? null]), campos: spy.campos, erros: spy.erros });
  expect(spy.campos).toEqual([]);
});
