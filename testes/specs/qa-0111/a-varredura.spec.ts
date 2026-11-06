// Passe 1: cada rota nova/mexida em 1440 e 390, com print, erros de console e rolagem (shell de painéis). Dono: maquina-qa.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { coletarErros, login, rolagem, tela, TELAS } from './ajuda.ts';

const ROTAS = ['/', '/creatives', '/brain', '/brain?view=map', '/templates', '/credits', '/templates/admin', '/library', '/campaigns', '/settings', '/offers'];

test('varredura de rotas (MSW, INTERNAL)', async ({ page }, info) => {
  const erros = coletarErros(page);
  await login(page);
  const out: Record<string, unknown> = {};
  for (const r of ROTAS) {
    const n0 = erros.length;
    // 390: Playwright aplica a viewport por Emulation.setDeviceMetricsOverride; recarrega a cada rota
    await page.goto(r + (r.includes('?') ? '&' : '?') + 'mockaccess=internal');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1500);
    const nome = r === '/' ? 'home' : r.slice(1).replace(/[/?=]/g, '_');
    const path = await tela(page, info, `v-${nome}`);
    // elementos que passam da largura da janela (fora de um contêiner com overflow que os corte)
    const estouro = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const corta = (el: Element | null): boolean => { for (let p = el?.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== 'visible' && p !== document.body && p !== document.documentElement) return true; } return false; };
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => el.getBoundingClientRect().right > W + 1 && !corta(el))
        .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 90)} right=${Math.round(el.getBoundingClientRect().right)}`);
    });
    out[r] = { url: page.url(), print: path, rolagem: await rolagem(page), estouro, erros: erros.slice(n0) };
  }
  mkdirSync(join(TELAS, info.project.name), { recursive: true });
  writeFileSync(join(TELAS, info.project.name, 'varredura.json'), JSON.stringify(out, null, 2));
  expect(true).toBe(true);
});

test('landing /welcome sem sessão', async ({ page }, info) => {
  const erros = coletarErros(page);
  await page.goto('/welcome');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await tela(page, info, 'landing-topo');
  // rola em passos pra disparar os ScrollTriggers
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 400) { await page.mouse.wheel(0, 400); await page.waitForTimeout(120); }
  await page.waitForTimeout(800);
  await tela(page, info, 'landing-fim');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await tela(page, info, 'landing-inteira', true);
  const m = await rolagem(page);
  writeFileSync(join(TELAS, info.project.name, 'landing.json'), JSON.stringify({ m, erros, h }, null, 2));
  expect(m.docSW, 'landing rola na horizontal').toBeLessThanOrEqual(m.docCW + 1);
});
