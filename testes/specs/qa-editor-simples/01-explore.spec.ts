import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { loginRapido } from '../../harness/navegador.ts';
import { CACHE_DIR } from '../../harness/env.ts';
import { prepararWs } from '../../harness/f1a.ts';
const OUT = process.env.QA_OUT!;
test('explore', async ({ page, baseURL }, info) => {
  const { pieces } = JSON.parse(readFileSync(`${CACHE_DIR}/qa-editor-simples.json`, 'utf8'));
  await prepararWs();
  await loginRapido(page, 'donoA');
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseURL! }]);
  for (const p of pieces.slice(0, 4)) {
    await page.goto(`/creatives/${p.creativeId}/editor`);
    await page.waitForTimeout(8000);
    const cls = await page.evaluate(() => ({ simples: !!document.querySelector('.ed.simples'), tabs: [...document.querySelectorAll('[role=tab]')].map((e) => e.textContent), btns: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 40), inputs: document.querySelectorAll('[data-text-layer]').length }));
    console.log(p.creativeId, JSON.stringify(cls));
  }
  await page.screenshot({ path: `${OUT}/explore-${info.project.name}.png` });
});
