// Briefing v2 PAGO (Claude real, só OFFER_EXTRACT, teto US$ 1,25; para em US$ 1,00): 5 páginas de referência do §8.
// API isolada :3002 (maquina_test, META off, cron off), web :3012. Só roda com QA_PAGO=1 (ok do Gusta 22/10).
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { as, login, prepararWorkspace, signup, sql, tela } from './dev.ts';

test.skip(process.env.QA_PAGO !== '1', 'teste pago: só com QA_PAGO=1');
test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 30_000 });

const PAGINAS: [string, string, string][] = [
  ['1-estatica', 'https://basecamp.com', 'crawled'],
  ['2-spa-quiz', 'https://thekingdomoflove.vercel.app', 'vision'],
  ['3-banners-imagem', 'https://material-dra-giovana.vercel.app', 'vision'],
  ['4-checkout', 'https://followcatch.vercel.app', 'vision'],
  ['5-login', 'https://github.com/settings/profile', 'login_wall'],
];
const LABELS = ['Fetching the page', 'Loading the page in a browser', 'Reading checkout, pricing and about pages', 'Reading images and banners', 'Pulling promise, audience, pains and proof', 'Detecting content language'];
const resultados: any[] = [];
let conta: Awaited<ReturnType<typeof signup>>;
let t0Custos = '';

test.beforeAll(async () => {
  conta = await signup('pago', { agencyName: 'Pago QA', accountMode: 'AGENCY' });
  await prepararWorkspace(conta, { live: true });
  await as(conta).patch('/workspace', { monthlySpendCapUsd: 5 });
  await as(conta).post('/workspace/tour/complete');
  t0Custos = new Date().toISOString();
});
test.afterAll(() => {
  writeFileSync(`${process.env.QA_TELAS}/briefing-pago.json`, JSON.stringify(resultados, null, 2));
});

for (const [nome, url, esperado] of PAGINAS) {
  test(`BP ${nome}: ${url}`, async ({ page }, info) => {
    const gasto = (await sql(`select coalesce(sum(amount_usd),0)::float s from cost_entries where workspace_id = $1`, [conta.workspaceId]))[0].s;
    test.skip(gasto > 1.0, `teto: já gastou US$ ${gasto}`);
    await login(page, conta.email);
    await page.goto('/creatives/new');
    await page.getByRole('radio', { name: 'New from link' }).or(page.getByText('New from link')).first().click();
    await page.getByLabel('Sales page link').fill(url);
    const jobP = page.waitForResponse((r) => r.url().endsWith('/offers/extract') && r.request().method() === 'POST');
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Read page' }).click();
    const jobId = (await (await jobP).json()).data.id;
    const vistos = new Set<string>();
    let fotografado = false;
    let fim: any = null;
    while (Date.now() - t0 < 150_000) {
      const txt = await page.locator('main').innerText().catch(() => '');
      for (const l of LABELS) if (txt.includes(l)) vistos.add(l);
      if (!fotografado && vistos.size >= 2) { await tela(page, info, `bp-${nome}-a-progresso`); fotografado = true; }
      const j = (await as(conta).get(`/jobs/${jobId}`)).data;
      if (j && ['SUCCEEDED', 'FAILED', 'PARTIAL'].includes(j.status)) { fim = j; break; }
      await page.waitForTimeout(700);
    }
    const ms = Date.now() - t0;
    expect(fim, 'job terminou em 150 s').not.toBeNull();
    await page.waitForTimeout(1500);
    const tela2 = await page.locator('main').innerText();
    await tela(page, info, `bp-${nome}-b-resultado`);
    const custo = (await sql(`select coalesce(sum(amount_usd),0)::float s from cost_entries where job_id = $1`, [jobId]))[0].s;
    const total = (await sql(`select coalesce(sum(amount_usd),0)::float s from cost_entries where workspace_id = $1`, [conta.workspaceId]))[0].s;
    const o = fim.output ?? {};
    const origens = Object.fromEntries(Object.entries(o.fieldOrigins ?? {}).map(([k, v]: any) => [k, v.map((x: any) => x.role + (x.imageIndex ? `#img${x.imageIndex}` : '')).join('+')]));
    const r = {
      nome, url, ms, status: fim.status, errorCode: fim.errorCode ?? null, failReason: fim.failReason ?? null, action: fim.action ?? null,
      readMode: o.readMode ?? null, pages: (o.pages ?? []).map((p: any) => `${p.role}:${p.via}:${p.chars}`), imagens: (o.imagesRead ?? []).length,
      imagesRead: (o.imagesRead ?? []).map((i: any) => `${i.index}:${i.kind}:${(i.read ?? '').slice(0, 90)}`), origens,
      brief: { name: o.name, language: o.language, what: o.brief?.what, promise: o.brief?.promise, offerAndPrice: o.brief?.offerAndPrice, audience: o.brief?.audience, cta: o.brief?.cta },
      costUsdOutput: o.costUsd ?? null, costUsdCostEntries: custo, acumulado: total,
      checklist: (fim.checklist ?? []).map((c: any) => `${c.key}:${c.done}`), etapasVistas: [...vistos],
      readFromNaTela: (/Read from: [^\n]+/.exec(tela2) ?? [/Read from the pasted text/.exec(tela2)?.[0] ?? null])[0],
      tagsOrigemNaTela: (tela2.match(/From [^\n]+/g) ?? []).length,
      telaErro: /behind a login[^\n]*/.exec(tela2)?.[0] ?? null,
    };
    resultados.push(r);
    info.annotations.push({ type: 'resultado', description: JSON.stringify(r).slice(0, 1500) });
    if (esperado === 'login_wall') {
      expect(fim.status).toBe('FAILED');
      expect(fim.errorCode).toBe('PAGE_UNREADABLE');
      expect(fim.failReason).toBe('This page is behind a login. Paste the page text, or use the public sales page link.');
      expect(r.telaErro).toContain('behind a login');
      expect(custo, 'login wall não chama o Claude').toBe(0);
    } else {
      expect(fim.status).toBe('SUCCEEDED');
      expect(fim.checklist.map((c: any) => c.key)).toEqual(['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images', 'extracting', 'detecting_language']);
      expect(r.readFromNaTela).toBeTruthy();
      expect(custo).toBeGreaterThan(0);
      expect.soft(r.readMode, `readMode esperado ${esperado}`).toBe(esperado);
      expect.soft(r.tagsOrigemNaTela, 'tags de origem na tela').toBeGreaterThan(0);
    }
  });
}
