// Ajudantes do QA 01/11 (web em MSW). Dono: maquina-qa.
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// .cache/ (fora do git e fora do outputDir do Playwright, que é limpo a cada execução)
export const TELAS = resolve(import.meta.dirname, '..', '..', '.cache', 'telas-qa-0111');
export async function tela(page: Page, info: TestInfo, nome: string, full = false): Promise<string> {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nome}.png`);
  await page.screenshot({ path, fullPage: full });
  return path;
}
/** Login no BFF em modo mock (gusta@maquina.dev / maquina123). */
export async function login(page: Page) {
  const r = await page.request.post('/api/session', { data: { email: 'gusta@maquina.dev', password: 'maquina123' } });
  if (!r.ok()) throw new Error(`login mock ${r.status()} ${await r.text()}`);
}
/** Erros de console/página (ignora ruído do HMR e do MSW em dev). */
export function coletarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(t)) return;
    erros.push(`console: ${t.slice(0, 300)}`);
  });
  return erros;
}
/** Métricas de rolagem: o documento rola? o #app-scroll rola? barras visíveis? */
export async function rolagem(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const app = document.getElementById('app-scroll');
    const cs = app ? getComputedStyle(app) : null;
    // barra visível = algum elemento rolável cuja largura de barra (offsetWidth - clientWidth - bordas) > 0
    const comBarra: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el);
      const ovY = s.overflowY, ovX = s.overflowX;
      const rolaY = (ovY === 'auto' || ovY === 'scroll') && el.scrollHeight > el.clientHeight;
      const rolaX = (ovX === 'auto' || ovX === 'scroll') && el.scrollWidth > el.clientWidth;
      if (!rolaY && !rolaX) continue;
      const bl = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
      const bt = parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
      const barY = el.offsetWidth - el.clientWidth - bl;
      const barX = el.offsetHeight - el.clientHeight - bt;
      if (barY > 0.5 || barX > 0.5) comBarra.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 60)} (${barY}/${barX})`);
    }
    const docBar = window.innerWidth - de.clientWidth;
    return {
      docRola: de.scrollHeight > de.clientHeight + 1, docSH: de.scrollHeight, docCH: de.clientHeight,
      docSW: de.scrollWidth, docCW: de.clientWidth, docBar,
      app: app ? { overflowY: cs!.overflowY, sh: app.scrollHeight, ch: app.clientHeight, sbw: cs!.scrollbarWidth } : null,
      comBarra: comBarra.slice(0, 10),
    };
  });
}
