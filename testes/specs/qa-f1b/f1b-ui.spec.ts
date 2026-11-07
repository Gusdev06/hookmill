// QA 06/11 do recorte F1b no navegador (1440 e 390, EN e PT): web de teste (sem MSW) → API do QA (mock, troca LOCAL no
// workspace alfa, banco maquina_q1_test). Telas do F1: galeria com o estado certo depois da medida, marcas da cópia no Plan
// (`copy`, "Closest font"), degrau ao digitar, `preparing_plate`, e o workspace fora da lista (beta) pendente.
// Screenshots em /tmp/q1/telas/<projeto>/. Rodar: ver playwright.qaf1b.config.ts. Dono: maquina-qa.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { loginRapido } from '../../harness/navegador.ts';
import { LANGS, type Lang, comCreditos, espiar, idioma, prepararWs, semLateral, semSeloDev } from '../../harness/f1a.ts';
import { HEADLINE, camadaS4, campeaoReal, fitHeadline, novoLote, planejado, type Caso } from '../../harness/f1b.ts';

test.describe.configure({ timeout: 2_400_000 });
test.skip((process.env.Q1_FASE ?? 'local') !== 'local', 'só com a troca ligada');
test.beforeEach(async ({ page }) => { await prepararWs(); await comCreditos(100); await semSeloDev(page); });
test.afterEach(async () => { await esperarJobsQuietos(600_000); });

const TELAS = process.env.Q1_TELAS ?? '/tmp/q1/telas';
const T = {
  en: { card: 'New headline', pending: "Headline can't be rewritten yet", use: 'Use template', loose: 'Old text erased, same style', box: 'Same box, new words', close: 'Closest font', short: "Too short: part of the old headline's space", fits: /^Fits/, grows: /Box grows|Fits with one more line|One more line/, plate: 'erasing the old headline' },
  'pt-BR': { card: 'Headline nova', pending: 'Headline ainda não pode ser reescrita', use: 'Usar template', loose: 'Texto antigo apagado, mesmo estilo', box: 'Mesma caixa, palavras novas', close: 'Fonte mais próxima', short: 'Curto demais: parte do espaço da headline antiga', fits: /^Cabe/, grows: /Caixa cresce|Cabe com uma linha a mais|Uma linha a mais/, plate: 'apagando a headline antiga' },
} as const;

async function tela(page: Page, info: TestInfo, nome: string) {
  const d = join(TELAS, info.project.name);
  mkdirSync(d, { recursive: true });
  await page.screenshot({ path: join(d, `${nome}.png`), fullPage: true });
}
async function abrir(page: Page, path: string, lang: Lang, baseURL: string) {
  await idioma(page.context(), lang, baseURL);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
}
async function medidoUi(caso: Caso) {
  const c = await campeaoReal(caso);
  await camadaS4(c.championId, caso, c.baseMap);
  await novoLote(c.championId);
  expect(await fitHeadline(c.championId), `${caso} medido`).toEqual({ level: 'ok', reason: null });
  return c.championId;
}
const usar = async (championId: string) => planejado('donoA', expectOk(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId }), 202).id);

test('F1B-UI-01 galeria e Plan da HEADLINE copiada: solto (apagado, fonte mais próxima) e caixa; degrau ao digitar', async ({ page, baseURL }, info) => {
  const spy = espiar(page);
  await loginRapido(page, 'donoA');
  for (const [caso, kind] of [['s4-solto', 'loose'], ['s4-02', 'box']] as const) {
    const id = await medidoUi(caso);
    for (const lang of LANGS) {
      await abrir(page, `/templates?championId=${id}`, lang, baseURL!);
      const card = page.locator(`article[aria-label="${T[lang].card}"]`).first();
      await expect(card).toBeVisible({ timeout: 40_000 });
      await card.scrollIntoViewIfNeeded();
      await expect.soft(card.getByText(T[lang].pending), `${caso} ${lang}: sem selo pendente`).toHaveCount(0);
      await expect.soft(card.getByRole('button', { name: T[lang].use }), `${caso} ${lang}: Use ligado`).toBeEnabled();
      await semLateral(page, `galeria ${caso} ${lang}`);
      await tela(page, info, `01-galeria-${caso}-${lang}`);
    }
    const b = await usar(id);
    const h = b.pieces.find((p: any) => p.type === 'HEADLINE');
    for (const lang of LANGS) {
      await abrir(page, `/templates/run/${b.id}`, lang, baseURL!);
      await expect(page.locator('#t-plan')).toBeVisible({ timeout: 120_000 });
      const campo = page.locator(`[id="txt-${h.id}-text"]`);
      await expect(campo).toBeVisible({ timeout: 30_000 });
      await campo.scrollIntoViewIfNeeded();
      await expect.soft(page.getByText(T[lang][kind]).first(), `${caso} ${lang}: marca da cópia`).toBeVisible();
      if (kind === 'loose') await expect.soft(page.getByText(T[lang].close).first(), `${caso} ${lang}: fonte close (Arimo, corr 0,82)`).toBeVisible();
      else await expect.soft(page.getByText(T[lang].close), `${caso} ${lang}: fonte same, sem marca`).toHaveCount(0);
      const ajuda = page.locator(`[id="txt-${h.id}-text-h"]`);
      await tela(page, info, `01-plan-${caso}-${lang}`);
      if (kind === 'loose') {
        await campo.fill('See who he follows');
        await expect.soft(ajuda, `${lang}: curta ao digitar`).toContainText(T[lang].short, { timeout: 10_000 });
        await expect.soft(campo).toHaveAttribute('aria-invalid', 'true');
        await tela(page, info, `01-plan-${caso}-curta-${lang}`);
        await campo.fill('Tired of scrolling his endless following list?');
        await expect.soft(ajuda, `${lang}: aprovada cabe`).toContainText(T[lang].fits, { timeout: 10_000 });
        await tela(page, info, `01-plan-${caso}-aprovada-${lang}`);
      } else {
        await campo.fill('Si en 7 días no vuelve a escribirte ni a buscarte por ningún lado, es porque nunca fue para ti y nunca lo será..');
        await page.waitForTimeout(1500);
        const linha = await ajuda.innerText();
        test.info().annotations.push({ type: `02-longa-${lang}`, description: linha });
        await tela(page, info, `01-plan-${caso}-longa-${lang}`);
        await campo.fill('Si en 7 días no vuelve a escribirte, nunca fue para ti..');
        await expect.soft(ajuda, `${lang}: 02 novo cabe`).toContainText(T[lang].fits, { timeout: 10_000 });
      }
      await semLateral(page, `plan ${caso} ${lang}`);
    }
  }
  expect.soft(spy.erros.filter((e) => !/favicon|hydrat/i.test(e)), 'console').toEqual([]);
});

test('F1B-UI-02 preparing_plate na espera do Plan e workspace fora da lista (beta) pendente', async ({ page, baseURL }, info) => {
  await loginRapido(page, 'donoA');
  const id = await medidoUi('s4-solto');
  // placa apagada: o próximo Use espera a placa nova (≈ 25 s local) e mostra a etapa
  await q(`delete from champion_plates where champion_id = $1`, [id]);
  await abrir(page, `/templates?championId=${id}`, 'en', baseURL!);
  const card = page.locator(`article[aria-label="${T.en.card}"]`).first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  await card.getByRole('button', { name: T.en.use }).click();
  await page.waitForURL(/\/templates\/run\//, { timeout: 60_000 });
  let viu = false;
  for (let i = 0; i < 120 && !viu; i++) {
    viu = await page.getByText(T.en.plate).first().isVisible().catch(() => false);
    if (viu) await tela(page, info, '02-preparing-plate-en');
    else if (await page.locator('#t-plan').isVisible().catch(() => false)) break;
    else await page.waitForTimeout(500);
  }
  expect.soft(viu, 'etapa "erasing the old headline" visível na espera').toBe(true);
  await expect(page.locator('#t-plan')).toBeVisible({ timeout: 300_000 });

  await loginRapido(page, 'donoB');
  const b = await campeaoReal('s4-solto', 'B');
  await camadaS4(b.championId, 's4-solto', b.baseMap);
  for (const lang of LANGS) {
    await abrir(page, `/templates?championId=${b.championId}`, lang, baseURL!);
    const c = page.locator(`article[aria-label="${T[lang].card}"]`).first();
    await expect(c).toBeVisible({ timeout: 40_000 });
    await c.scrollIntoViewIfNeeded();
    await expect.soft(c.getByText(T[lang].pending), `beta ${lang}`).toBeVisible();
    await expect.soft(c.getByRole('button', { name: T[lang].use })).toBeDisabled();
    await tela(page, info, `02-galeria-beta-${lang}`);
  }
});
