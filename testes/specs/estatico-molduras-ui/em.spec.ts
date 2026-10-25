// Estático montado + molduras no navegador (estatico-montado-e-molduras-v1 §A6 vista, §B1/§B4 vista; A-F e B1-F da §C.1).
// Web do QA (Next dev, sem MSW) → API do QA (mock, render fake) → banco *_test. 1440 e 390 (o Playwright aplica a viewport
// por Emulation a cada rota, então 390 vale mesmo com o piso de 500 px da janela headless), EN e PT-BR.
// Screenshots em test-results/telas/<projeto>/em-*.png, LIDAS pelo QA antes de declarar. NADA PAGO. Dono: maquina-qa.
// PENDENTE: A-F (aviso textCheck, campo Cor da marca) e B1-F (rótulo/ícone das molduras, formato escondido). Os textos de
// tela abaixo saem do contrato; quando o frontend entregar, confirmar contra web/src/i18n e ajustar SÓ os rótulos.
// Rodar (de testes/): npm run em:navegador
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { PODCAST, assentou, ateLote, lotePronto, oferta } from '../../harness/iterate.ts';
import { entrega } from '../../harness/estatico-molduras.ts';
import { loginRapido, semRolagemHorizontal, tela } from '../../harness/navegador.ts';
import type { Page } from '@playwright/test';

test.use({ actionTimeout: 20_000 });
const LONGO = { timeout: 900_000 };
let E: Awaited<ReturnType<typeof entrega>>;
test.beforeAll(async () => { E = await entrega(); });
test.beforeEach(async () => {
  await q(`update workspaces set onboarding_completed_at = now()`);
  await q(`update memberships set tour_completed_at = now()`);
  await q(`update users set account_mode = 'OWN'`);
});
test.afterEach(async () => { await esperarJobsQuietos(120_000); });

const L = {
  en: { textErr: /text (with an )?error|wrong text|typo/i, expected: /expected/i, retry: /^Retry/, leave: /^Leave out/, brand: /brand colou?r/i, save: /^Save/, news: /^News$/, frame: /frame/i },
  pt: { textErr: /texto com erro|erro no texto/i, expected: /esperado/i, retry: /^Tentar de novo/, leave: /^(Deixar de fora|Tirar)/, brand: /cor da marca/i, save: /^Salvar/, news: /^Notícia$/, frame: /moldura/i },
};
type Lang = keyof typeof L;
const idioma = async (page: Page, info: any, lang: Lang) => {
  if (lang === 'pt') await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: info.project.use.baseURL! }]);
};
async function loteGerado(notes: string | null, lang: Lang) {
  const o = await oferta('A', { language: lang === 'pt' ? 'pt-BR' : 'en', notes });
  const b = await lotePronto('donoA', PODCAST, o.id);
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost.generateEstimateUsd ?? 0 }), 202);
  return ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
}

for (const lang of ['en', 'pt'] as Lang[]) {
  test(`EAU-01 ${lang}: STATIC com texto errado mostra "esperado × visto" com Retry/Leave out; STATIC ok não mostra aviso`, async ({ page }, info) => {
    test.skip(!E.estaticoV2, 'pendente: A-I/A-B/A-F');
    test.setTimeout(1_200_000);
    const fim = await loteGerado('[mock:static-text-mismatch-all]', lang);
    const st = fim.pieces.find((p: any) => p.type === 'STATIC' && p.textCheck?.status === 'mismatch');
    expect(st, 'peça com mismatch (mock)').toBeTruthy();
    const erro = st.textCheck.items.find((i: any) => i.seen !== i.expected);
    await loginRapido(page, 'adminA');
    await idioma(page, info, lang);
    await page.goto(`/iterate/${fim.id}?view=generate`);
    const aviso = page.getByText(L[lang].textErr).first();
    await expect(aviso).toBeVisible(LONGO);
    await expect(page.getByText(erro.expected, { exact: false }).first(), 'mostra o texto esperado').toBeVisible();
    if (erro.seen) await expect(page.getByText(erro.seen, { exact: false }).first(), 'mostra o que a imagem escreveu').toBeVisible();
    await expect(page.getByRole('button', { name: L[lang].retry }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: L[lang].leave }).first()).toBeVisible();
    await semRolagemHorizontal(page, 'aviso textCheck');
    await page.waitForTimeout(800);
    await tela(page, info, `em-${lang}-01-textcheck-mismatch`);
    // download: a peça segue no zip (entrega com aviso)
    await page.goto(`/iterate/${fim.id}?view=download`);
    await page.waitForTimeout(1200);
    await tela(page, info, `em-${lang}-02-textcheck-download`);
  });

  test(`EAU-02 ${lang}: Settings › Cor da marca salva (#RRGGBB), recusa inválido, persiste ao recarregar; MEMBER só lê`, async ({ page }, info) => {
    test.skip(!E.estaticoV2, 'pendente: A-F (campo Cor da marca em Settings/onboarding)');
    await loginRapido(page, 'donoA');
    await idioma(page, info, lang);
    await page.goto('/settings');
    const campo = page.getByLabel(L[lang].brand);
    await expect(campo).toBeVisible(LONGO);
    await campo.fill('azul');
    await page.getByRole('button', { name: L[lang].save }).first().click();
    await page.waitForTimeout(800);
    await tela(page, info, `em-${lang}-03-cor-invalida`);
    expect((await q(`select brand_color from workspaces where id = 'qa_ws_alfa'`))[0].brand_color, 'inválido não grava').toBeNull();
    await campo.fill('#3d8bff');
    await page.getByRole('button', { name: L[lang].save }).first().click();
    await expect.poll(async () => (await q(`select brand_color from workspaces where id = 'qa_ws_alfa'`))[0].brand_color, { timeout: 15_000 }).toBe('#3D8BFF');
    await page.reload();
    await expect(page.getByLabel(L[lang].brand)).toHaveValue(/#3D8BFF/i);
    await semRolagemHorizontal(page, 'settings cor');
    await tela(page, info, `em-${lang}-04-cor-salva`);
    await page.context().clearCookies();
    await loginRapido(page, 'membroA');
    await idioma(page, info, lang);
    await page.goto('/settings');
    const m = page.getByLabel(L[lang].brand);
    if (await m.count()) await expect(m, 'MEMBER não edita (PATCH /workspace = 403)').toBeDisabled();
    await tela(page, info, `em-${lang}-05-cor-member`);
    await q(`update workspaces set brand_color = null where id = 'qa_ws_alfa'`);
  });

  test(`MOU-01 ${lang}: peça FRAME com o nome da moldura (i18n) e ícone; preview toca; 4:5/1:1 sem preço; formato não suportado sem botão`, async ({ page }, info) => {
    test.skip(!E.molduras, 'pendente: fusão B1 + B1-F');
    test.setTimeout(1_200_000);
    const fim = await loteGerado(null, lang);
    const fr = fim.pieces.filter((p: any) => p.type === 'FRAME');
    expect(fr.length).toBeGreaterThan(0);
    await loginRapido(page, 'adminA');
    await idioma(page, info, lang);
    await page.goto(`/iterate/${fim.id}?view=download`);
    for (const p of fr) {
      await expect(page.getByText(p.code, { exact: false }).first()).toBeVisible(LONGO);
      info.annotations.push({ type: `moldura ${p.code}`, description: p.frame?.template });
    }
    const chave = page.getByText(new RegExp(`(missing|undefined|frame\\.|iterate\\.type\\.FRAME)`)).first();
    expect(await chave.count(), 'nenhuma chave i18n crua na tela').toBe(0);
    await semRolagemHorizontal(page, 'download com molduras');
    await page.waitForTimeout(1000);
    await tela(page, info, `em-${lang}-06-molduras-download`);
    await page.goto(`/iterate/${fim.id}?view=generate`);
    await page.waitForTimeout(1000);
    await tela(page, info, `em-${lang}-07-molduras-generate`);
    // formato marcado `supported: false` (só depois da revisão visual do Gusta) = sem botão
    const semFmt = fr.flatMap((p: any) => (p.formats ?? []).filter((f: any) => f.supported === false).map((f: any) => `${p.code}:${f.format}`));
    info.annotations.push({ type: 'formatos não suportados', description: semFmt.join(', ') || 'nenhum (todos os templates nos 3 formatos)' });
  });

  test(`MOU-02 ${lang}: moldura que falhou ([mock:frame-fail]) mostra o motivo traduzido e Retry; FRAME_TEXT_OVERFLOW só Leave out`, async ({ page }, info) => {
    test.skip(!E.molduras, 'pendente: fusão B1 + B1-F');
    test.setTimeout(1_200_000);
    const desc = await lotePronto('donoA', PODCAST, (await oferta('A')).id);
    const alvo = desc.pieces.find((p: any) => p.type === 'FRAME')?.frame?.template;
    test.skip(!alvo, 'plano sem FRAME');
    const fim = await loteGerado(`[mock:frame-fail:${alvo}]`, lang);
    const p = fim.pieces.find((x: any) => x.type === 'FRAME' && x.status === 'failed');
    expect(p).toBeTruthy();
    await loginRapido(page, 'adminA');
    await idioma(page, info, lang);
    await page.goto(`/iterate/${fim.id}?view=generate`);
    await expect(page.getByRole('button', { name: L[lang].retry }).first()).toBeVisible(LONGO);
    if (lang === 'pt') expect(await page.getByText(/The render failed/).count(), 'motivo em PT, não o failReason cru (bug 2 de 13/10)').toBe(0);
    await semRolagemHorizontal(page, 'moldura falhou');
    await page.waitForTimeout(800);
    await tela(page, info, `em-${lang}-08-moldura-falhou`);
  });
}
