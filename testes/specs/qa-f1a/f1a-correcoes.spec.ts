// Prova das correções B1 a B8 do testes/qa-f1a-2026-11-06.md, por clique, em 1440 e 390. Rodar: ver playwright.qaf1a.config.ts (-g F1A-FIX).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { assentou, ateLote } from '../../harness/iterate.ts';
import { loginRapido } from '../../harness/navegador.ts';
import { type Lang, campeao, comCreditos, conectarMetaMock, gerar, idioma, livro, novoLote, prepararWs, semLateral, semSeloDev, setLayers, tela, usar } from '../../harness/f1a.ts';

test.describe.configure({ timeout: 1_200_000 });
test.beforeEach(async ({ page }) => { await prepararWs(); await comCreditos(100); await conectarMetaMock(); await semSeloDev(page); });
test.afterEach(async () => { await esperarJobsQuietos(180_000); });

async function abrir(page: Page, path: string, lang: Lang, baseURL: string) {
  await idioma(page.context(), lang, baseURL);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}

test('F1A-FIX-B1-B2-B3-B7-B8 Biblioteca: baixa mp4 por clique, Editar desligado com motivo visível; URL direta cai no gate', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const prontas = fim.pieces.filter((p: any) => p.status === 'ready' && p.files?.length);
  const [antiga, normal] = prontas;
  await q(`update variation_items set auto_type = 'HEADLINE', code = 'HEADLINE-1', payload = $2::jsonb where id = $1`, [antiga.id, JSON.stringify({ params: { type: 'HEADLINE', mode: 'replace', text: 'Old new words', highlight: null, sources: {}, language: 'en', original: 'Original words' } })]);
  await q(`update creatives set variation_code = 'HEADLINE-1' where id = $1`, [antiga.creativeId]);

  const TXT = {
    en: { download: 'Download', edit: 'Edit', motivo: 'This older piece no longer opens in the editor', titulo: "This piece can't be edited" },
    'pt-BR': { download: 'Baixar', edit: 'Editar', motivo: 'Esta peça antiga não abre mais no editor', titulo: 'Esta peça não pode ser editada' },
  } as const;
  for (const lang of ['en', 'pt-BR'] as const) {
    const x = TXT[lang];
    await abrir(page, '/library', lang, baseURL!);
    await semLateral(page, `library ${lang}`);
    // B2: a peça antiga não tem link pro editor; a normal segue tendo
    await expect(page.locator(`main a[href*="/creatives/${normal.creativeId}/editor"]`).first(), `${lang}: peça normal abre`).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`main a[href*="/creatives/${antiga.creativeId}/editor"]`), `${lang}: B2 antiga sem link`).toHaveCount(0);
    // B3: o motivo é texto visível, sem precisar de hover
    await expect(page.locator('main').getByText(x.motivo).first(), `${lang}: B3 motivo visível`).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: new RegExp(`^${x.edit}$`) }).first()).toBeDisabled();
    await page.locator('main').getByText(x.motivo).first().scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /^(got it|entendi)/i }).first().click({ timeout: 2_000 }).catch(() => undefined);
    await tela(page, info, `fix-library-${lang}`);
    // B1: clique real no Download, a página fica onde está e o arquivo é mp4
    const link = page.locator('main a[download]').first();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), link.click()]);
    expect(dl.suggestedFilename(), 'B1 nome').toMatch(/\.mp4$/);
    const bytes = readFileSync(await dl.path());
    expect(bytes.subarray(4, 8).toString(), 'B1 mp4').toBe('ftyp');
    expect(new URL(page.url()).pathname, 'B1 não navegou').toBe('/library');
    expect(new URL(dl.url()).searchParams.get('response-content-disposition') ?? '', 'B1 URL com attachment').toMatch(/attachment/);
    // botões alinhados entre vizinhos da mesma linha (regra de 04/11), mesmo com a linha do motivo
    const caixas = await page.locator('main a[download]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
    const porFila = new Map<number, number[]>();
    for (const c of caixas) { const fila = [...porFila.keys()].find((y) => Math.abs(y - c.y) < 40) ?? c.y; porFila.set(fila, [...(porFila.get(fila) ?? []), c.y]); }
    for (const ys of porFila.values()) expect(Math.max(...ys) - Math.min(...ys), `${lang}: Download alinhado na fila`).toBeLessThanOrEqual(1);
    // B7 + B8: URL direta, sem ?from=
    await abrir(page, `/creatives/${antiga.creativeId}/editor`, lang, baseURL!);
    await expect(page.getByText(x.titulo, { exact: true }), `${lang}: B7 gate`).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(x.motivo, { exact: false }).first()).toBeVisible();
    await expect(page.locator('body'), `${lang}: B8 sem "yet"`).not.toContainText(/open in the editor yet|ainda não abre no editor/);
    await tela(page, info, `fix-editor-sem-from-${lang}`);
    await page.getByRole('link', { name: /^(Back|Voltar)$/ }).first().click();
    await page.waitForURL(/\/library/, { timeout: 30_000 });
    // B8 também com from
    await abrir(page, `/creatives/${antiga.creativeId}/editor?from=library`, lang, baseURL!);
    await expect(page.getByText(x.titulo, { exact: true })).toBeVisible({ timeout: 30_000 });
    // B3 na tela do lote
    await abrir(page, `/iterate/${b.id}?view=download`, lang, baseURL!);
    await expect(page.locator('main').getByText(x.motivo).first(), `${lang}: B3 no lote`).toBeVisible({ timeout: 30_000 });
    await semLateral(page, `download ${lang}`);
    await page.locator('main').getByText(x.motivo).first().scrollIntoViewIfNeeded();
    await tela(page, info, `fix-download-${lang}`);
  }
});

test('F1A-FIX-B4 quiz: "New headlines" só quando há peça possível', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  // anúncio com headline: não oferece, nem depois do plano pronto; a preferência salva não perde o item
  const a = await campeao();
  await setLayers(a.championId, a.baseMap, { captionY: 820, captionH: 120, headline: 'loose' });
  const n = await novoLote(a.championId);
  const salva = { goal: 'auto', ai: 'free_only', aiCapUsd: null, aiCapCredits: null, wants: ['headline', 'frames'], savedAt: new Date().toISOString(), savedBy: { id: 'x', name: 'x', initials: 'x' }, fromBatchId: n.id };
  await q(`update workspaces set iterate_preferences = $2::jsonb where id = (select workspace_id from variation_batches where id = $1)`, [n.id, JSON.stringify(salva)]);
  await ateLote('donoA', n.id, (x: any) => x.status === 'PLAN_READY', { oQue: 'plano', timeoutMs: 180_000 });
  for (const lang of ['en', 'pt-BR'] as const) {
    await abrir(page, `/iterate/${n.id}`, lang, baseURL!);
    await page.getByRole('button', { name: /^(Continue|Continuar)/ }).first().click();
    await expect(page.getByText(lang === 'en' ? 'Let HookMill choose' : 'Deixar o HookMill escolher', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(lang === 'en' ? 'Frames and layouts' : 'Molduras e layouts', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(lang === 'en' ? 'New headlines' : 'Novas headlines', { exact: true }), `${lang}: não oferece`).toHaveCount(0);
    await semLateral(page, `quiz ${lang}`);
    await tela(page, info, `fix-quiz-sem-headline-${lang}`);
  }
  await page.getByRole('button', { name: /^(See|Show|Ver|Save|Continue|Continuar)/ }).last().click();
  await expect.poll(async () => expectOk(await as('donoA').get(`/iterate/${n.id}`)).answers?.wants ?? null, { timeout: 20_000 }).toEqual(['frames']);
  const pref = (await q(`select iterate_preferences p from workspaces where id = (select workspace_id from variation_batches where id = $1)`, [n.id]))[0].p;
  expect(pref.wants, 'preferência salva intacta').toEqual(['headline', 'frames']);
  await q(`update workspaces set iterate_preferences = null where id = (select workspace_id from variation_batches where id = $1)`, [n.id]);

  // anúncio sem headline: oferece depois do plano, e a peça existe
  const c = await campeao();
  await setLayers(c.championId, c.baseMap, { captionY: 820, captionH: 120, headline: null });
  const m = await novoLote(c.championId);
  await ateLote('donoA', m.id, (x: any) => x.status === 'PLAN_READY', { oQue: 'plano', timeoutMs: 180_000 });
  // análise ainda rodando (sem `insight`): não dá pra saber, então não oferece; quando o plano responde, aparece
  const analisando = `**/api/v1/iterate/${m.id}`;
  await page.route(analisando, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const r = await route.fetch();
    const j = await r.json();
    await route.fulfill({ response: r, json: { ...j, data: { ...j.data, status: 'ANALYZING', phase: 'analyze', insight: null } } });
  });
  await abrir(page, `/iterate/${m.id}`, 'en', baseURL!);
  await page.getByRole('button', { name: /^Continue/ }).first().click();
  await expect(page.getByText('Let HookMill choose', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const want = page.getByText('New headlines', { exact: true }).first();
  await expect(page.getByText('New headlines', { exact: true }), 'analisando: não oferece').toHaveCount(0);
  await page.unroute(analisando);
  await expect(want, 'plano pronto: oferece').toBeVisible({ timeout: 20_000 });
  await tela(page, info, 'fix-quiz-com-headline-en');
  await want.click();
  await page.getByRole('button', { name: /^(See|Show|Save|Continue)/ }).last().click();
  await expect.poll(async () => expectOk(await as('donoA').get(`/iterate/${m.id}`)).pieces.some((p: any) => p.type === 'HEADLINE'), { timeout: 20_000 }).toBe(true);
});

test('F1A-FIX-B5 seleção com peça no plano: a faixa não diz que cobriria', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 100, captionH: 1080, headline: 'loose' });
  const g = expectOk(await as('donoA').get(`/ad-templates?championId=${championId}`));
  const lista = (g.items ?? g) as any[];
  const soft = lista.find((t) => t.fit?.level === 'soft' && !t.pack), ok = lista.find((t) => t.fit?.level === 'ok' && !t.pack && t.category === 'frames');
  await abrir(page, `/templates?championId=${championId}&t=${soft.slug},${ok.slug}`, 'en', baseURL!);
  await page.getByRole('button', { name: /Continue|Use|Generate/ }).last().click();
  await page.waitForURL(/\/templates\/run\//, { timeout: 60_000 });
  const id = new URL(page.url()).pathname.split('/').pop()!;
  await ateLote('donoA', id, (x: any) => x.status === 'PLAN_READY', { oQue: 'seleção', timeoutMs: 180_000 });
  const TXT = { en: { t: 'Your ad has captions burned in, so part of this plan stays out.', ruim: /would cover/i }, 'pt-BR': { t: 'Seu anúncio tem legenda queimada, então parte deste plano fica de fora.', ruim: /cobriria/i } } as const;
  for (const lang of ['en', 'pt-BR'] as const) {
    await abrir(page, `/templates/run/${id}`, lang, baseURL!);
    await expect(page.getByText(TXT[lang].t), `${lang}: título`).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main')).not.toContainText(TXT[lang].ruim);
    await semLateral(page, `seleção ${lang}`);
    await tela(page, info, `fix-selecao-faixa-${lang}`);
  }
  // lote só do soft (vazio): o texto antigo também saiu
  const so = await usar(soft.slug, championId).catch(() => null);
  if (so) {
    await abrir(page, `/templates/run/${so.id}`, 'en', baseURL!);
    await expect(page.locator('main')).not.toContainText(/would cover/i);
  }
});

test('F1A-FIX-B6 aba velha com lote esvaziado: toast certo e Generate desliga sem recarregar', async ({ page, baseURL }, info) => {
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
  expect((await resp).status()).toBe(409);
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'nothing fits anymore' }).first(), 'toast').toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /Reload/ })).toHaveCount(0);
  // o toast precisa ser legível no viewport real (o fullPage desloca o que é fixo)
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/qa-f1a-telas/${info.project.name}/fix-aba-velha-viewport.png` });
  const topo = await page.locator('[data-sonner-toast]').filter({ hasText: 'nothing fits anymore' }).first().evaluate((el) => { const r = el.getBoundingClientRect(); const pt = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { naFrente: el.contains(pt), y: Math.round(r.y), h: Math.round(r.height), vh: innerHeight }; });
  expect(topo.naFrente, `toast na frente ${JSON.stringify(topo)}`).toBe(true);
  await expect(page.getByText('Your ad has captions burned in', { exact: false }).first(), 'faixa sem recarregar').toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#t-generate').first(), 'Generate desligado sem recarregar').toBeDisabled();
  await tela(page, info, 'fix-aba-velha');
  expect(await livro(), 'sem reserva').toEqual([]);
});
