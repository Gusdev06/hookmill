// Ajudantes do fluxo no navegador (Q3). Dono: maquina-qa.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, TESTES_DIR } from './env.ts';
import { PERSONAS, type Persona } from './db.ts';

export const TELAS = join(TESTES_DIR, 'test-results', 'telas');

/** Screenshot nomeado por projeto (1440/390) e etapa, em test-results/telas/<projeto>/. */
export async function tela(page: Page, info: TestInfo, nome: string): Promise<string> {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nome}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(nome, { path, contentType: 'image/png' });
  return path;
}

/** Login pela tela (F-01). Se o throttle responder, espera e tenta de novo (o limite da API não muda). */
export async function loginPelaTela(page: Page, p: Persona): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(PERSONAS[p].email);
    await page.getByLabel('Password').fill(ENV.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    const r = await Promise.race([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).then(() => 'ok'),
      page.getByText('Too many attempts').waitFor({ timeout: 30_000 }).then(() => 'throttle'),
    ]);
    if (r === 'ok') return;
    await page.waitForTimeout(61_000);
  }
  throw new Error(`[qa] login pela tela de ${p} não passou`);
}

/** Login direto no BFF do web (/api/session): mesmo cookie httpOnly da tela, sem gastar tempo de UI. */
export async function loginRapido(page: Page, p: Persona): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const r = await page.request.post('/api/session', { data: { email: PERSONAS[p].email, password: ENV.password } });
    if (r.ok()) return;
    if (r.status() !== 429) throw new Error(`[qa] /api/session ${r.status()}: ${await r.text()}`);
    await page.waitForTimeout(61_000);
  }
  throw new Error(`[qa] login de ${p} preso no throttle`);
}

export const idDaUrl = (page: Page) => decodeURIComponent(new URL(page.url()).pathname.split('/')[2] ?? '');

/** Botão principal da barra de ação (data-primary). */
export const primario = (page: Page) => page.locator('[data-primary]').first();

export async function esperarEtapa(page: Page, step: string, timeout = 60_000): Promise<void> {
  await page.waitForURL(new RegExp(`/creatives/[^/]+/${step}(\\?|$)`), { timeout });
}

/** Confere que a página não rola na horizontal (layout quebrado no 390). */
export async function semRolagemHorizontal(page: Page, onde: string): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${onde}: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw + 1);
}
