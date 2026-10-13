// Ajudantes do editor no navegador (F2d). Dono: maquina-qa.
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ENV } from './env.ts';
import { loginRapido, tela } from './navegador.ts';
import type { Persona } from './db.ts';

export const ehCelular = (info: TestInfo) => info.project.name.endsWith('390');

export interface Put { at: number; body: any; status: number | null; resp: any }
/** Registra todo PUT /editor da página (corpo, hora, resposta) e as origens de /api/v1 (tem que ser só a API de teste). */
export function espiao(page: Page) {
  const puts: Put[] = [];
  const origens = new Set<string>();
  const erros: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/v1')) origens.add(u.origin);
    if (r.method() === 'PUT' && u.pathname.endsWith('/editor')) puts.push({ at: Date.now(), body: r.postDataJSON(), status: null, resp: null });
  });
  page.on('response', async (r) => {
    if (r.request().method() !== 'PUT' || !new URL(r.url()).pathname.endsWith('/editor')) return;
    const p = puts.find((x) => x.status === null);
    if (!p) return;
    const resp = await r.json().catch(() => null);
    p.resp = resp;
    p.status = r.status(); // por último: quem espera o status já acha a resposta lida
  });
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
  return {
    puts, origens, erros,
    /** espera o n-ésimo PUT (1-based) ter resposta */
    async put(n: number, timeout = 15_000): Promise<Put> {
      const ate = Date.now() + timeout;
      while (Date.now() < ate) {
        if (puts.length >= n && puts[n - 1].status !== null) return puts[n - 1];
        await page.waitForTimeout(100);
      }
      throw new Error(`[qa] PUT /editor nº ${n} não veio em ${timeout} ms (vieram ${puts.length})`);
    },
    /** espera o autosave assentar: nenhum PUT pendente e nenhum PUT novo por `calmoMs` (o autosave é 800 ms) */
    async ocioso(calmoMs = 1500, timeout = 30_000): Promise<void> {
      const ate = Date.now() + timeout;
      let n = -1;
      let desde = Date.now();
      while (Date.now() < ate) {
        if (puts.length !== n) { n = puts.length; desde = Date.now(); }
        if (puts.every((p) => p.status !== null) && Date.now() - desde >= calmoMs) return;
        await page.waitForTimeout(100);
      }
      throw new Error('[qa] o autosave não assentou');
    },
    soApiDeTeste() {
      expect([...origens], 'o web só pode falar com a API de teste').toEqual([new URL(ENV.apiUrl).origin]);
    },
  };
}

/** Login (cookie do BFF) e abre o editor; espera o Player montar com vídeo e o "Saved". */
export async function abrirEditor(page: Page, persona: Persona, id: string, opts: { login?: boolean } = {}): Promise<void> {
  if (opts.login !== false) await loginRapido(page, persona);
  await page.goto(`/creatives/${id}/editor`);
  await esperarPlayer(page);
}
export async function esperarPlayer(page: Page): Promise<void> {
  await page.locator('.ed-player video').first().waitFor({ state: 'attached', timeout: 120_000 });
  await expect(page.locator('.ed-save .txt').first()).toHaveText(/Saved|Salvo/, { timeout: 30_000 });
}
/** Vídeos do Player com mídia carregada (readyState ≥ 2): prova que a URL assinada tocou no browser. */
export async function midiaCarregada(page: Page): Promise<{ n: number; prontos: number; erros: number }> {
  return page.evaluate(() => {
    const vs = [...document.querySelectorAll<HTMLVideoElement>('.ed-player video')];
    return { n: vs.length, prontos: vs.filter((v) => v.readyState >= 2).length, erros: vs.filter((v) => !!v.error).length };
  });
}
export const painel = (page: Page) => page.locator('aside[aria-label="Properties"], aside[aria-label="Propriedades"]');
export const hit = (page: Page, nome: string) => page.locator(`.ed-hit[aria-label="${nome}"]`);
export const salvo = (page: Page) => page.locator('.ed-save .txt').first();

/** Arrasta de (x,y) pra (x+dx, y+dy) com o mouse em passos (Pointer Events). */
export async function arrastar(page: Page, alvo: Locator, dx: number, dy: number, pos: 'centro' | { x: number; y: number } = 'centro'): Promise<number> {
  const b = await alvo.boundingBox();
  if (!b) throw new Error('[qa] alvo sem caixa');
  const x = pos === 'centro' ? b.x + b.width / 2 : b.x + pos.x;
  const y = pos === 'centro' ? b.y + b.height / 2 : b.y + pos.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  return Date.now();
}

export async function telaEd(page: Page, info: TestInfo, nome: string) {
  return tela(page, info, `editor-${nome}`);
}
