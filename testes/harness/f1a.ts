// Ajudantes do QA do F1a (troca-texto-queimado-v1). Campeão real (upload + análise em mock) e camadas do EditMap reescritas no
// banco de teste, como no legenda-sem-cobrir.int.spec: legenda queimada, headline solta/caixa, nenhuma. Dono: maquina-qa.
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { as, call, expectOk, tokenOf } from './api.ts';
import { q } from './db.ts';
import { TESTES_DIR } from './env.ts';
import { FALA20, ateLote, oferta, subirArquivo } from './iterate.ts';

export const TELAS = join(TESTES_DIR, 'test-results', 'qa-f1a-telas');
export type Lang = 'en' | 'pt-BR';
export const LANGS: Lang[] = ['en', 'pt-BR'];

/** Textos que o F1a aposentou (§15.3, §15.1). Em qualquer tela, EN e PT. */
export const PROIBIDO = /generate anyway|gerar mesmo assim|covers? the captions?|cobre a legenda|cobre as legendas|funciona melhor sem legenda|works better without captions|new plate covers|closest font/i;
/** Nunca prometer data (§15.4). */
export const DATA = /\b(soon|coming soon|next (week|month)|em breve|próxima semana|próximo mês|until|até (o|a) )\b/i;

export async function prepararWs(): Promise<void> {
  await q(`update users set account_mode = 'OWN'`);
  await q(`update workspaces set onboarding_completed_at = now(), market = 'US', website_url = 'https://example.com/'`).catch(async () => { await q(`update workspaces set onboarding_completed_at = now()`); });
  await q(`update memberships set tour_completed_at = now()`);
}
/** Conta de crédito de verdade (PAID), pra "nada cobrado" valer: INTERNAL não tem pool. */
export async function comCreditos(saldo = 100): Promise<void> {
  await q(`update users set access = 'PAID', credit_balance = $1 where id = 'qa_user_dono_a'`, [saldo]);
}
export const saldo = async () => (await call('GET', '/credits', { token: await tokenOf('donoA') })).data;
export const livro = async () => q<{ kind: string; delta: number; amount: number; template_run_id: string | null }>(`select kind, delta, amount, template_run_id from credit_entries where user_id = 'qa_user_dono_a' order by created_at`);

export async function conectarMetaMock(): Promise<void> {
  const tok = await tokenOf('donoA');
  const u = await call('POST', '/meta/connect', { body: { returnTo: '/settings' }, token: tok });
  expect(u.status, JSON.stringify(u.body)).toBe(201);
  expect((await fetch(u.data.url, { redirect: 'manual' })).status).toBe(302);
  const s = await call('PUT', '/meta/selection', { body: { adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' }, token: tok });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
}

/** Upload + POST /iterate → campeão lido (PLAN_READY do 1º lote, descartado pelos testes). */
export async function campeao(notas?: string): Promise<{ championId: string; offerId: string; firstBatch: any; baseMap: any }> {
  const o = await oferta('A');
  const s = await subirArquivo('donoA', FALA20);
  expect(s.complete?.status, JSON.stringify(s.complete?.body)).toBe(200);
  const c = await call('POST', '/champions', { body: { offerId: o.id, uploadId: s.uploadId, rights: 'OWN', ...(notas ? { notes: notas } : {}) }, token: await tokenOf('donoA') });
  expect(c.status, JSON.stringify(c.body)).toBe(202);
  await expect.poll(async () => (await q(`select status from champions where id = $1`, [c.data.id]))[0].status, { timeout: 180_000 }).toBe('READY');
  const [td] = await q(`select edit_map from teardowns where champion_id = $1`, [c.data.id]);
  return { championId: c.data.id, offerId: o.id, firstBatch: null, baseMap: td.edit_map };
}

const style = { fontId: 'montserrat-800', uppercase: true, fontSizePx: 48, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' };
const none = { kind: 'none', color: null, box: null };
/** Legenda queimada o vídeo inteiro e, opcional, headline solta ou em caixa (grade do mapa). */
export async function setLayers(championId: string, baseMap: any, o: { captionY?: number; captionH?: number; headline?: 'loose' | 'box' | null }): Promise<void> {
  const fc = Number(baseMap.frameCount) || 600;
  const layers: unknown[] = [];
  if (o.captionY != null) layers.push({ id: 'cap1', kind: 'caption', startFrame: 0, endFrame: fc, box: { x: 80, y: o.captionY, w: 560, h: o.captionH ?? 120 }, background: none, text: null, wordsPerPage: 3, source: 'vision', style });
  if (o.headline) {
    layers.push({ id: 'h1', kind: 'headline', startFrame: 0, endFrame: fc, box: { x: 60, y: 70, w: 600, h: 60 }, text: 'Original headline here', wordsPerPage: null, source: 'vision', style,
      background: o.headline === 'box' ? { kind: 'solid', color: '#101010', box: { x: 40, y: 60, w: 640, h: 80 } } : none });
  }
  await q(`update teardowns set edit_map = $2::jsonb where champion_id = $1`, [championId, JSON.stringify({ ...baseMap, layers })]);
}

const ate = (b: any) => !['ANALYZING', 'PLANNING'].includes(b.status);
export const planejado = (id: string) => ateLote('donoA', id, ate, { oQue: 'plano', timeoutMs: 240_000 });
/** POST /ad-templates/:slug/use + espera o plano. */
export async function usar(slug: string, championId: string): Promise<any> {
  const u = expectOk(await as('donoA').post(`/ad-templates/${slug}/use`, { championId }), 202);
  return planejado(u.id);
}
export const novoLote = async (championId: string) => planejado(expectOk(await as('donoA').post('/iterate', { championId }), 202).id);
export const gerar = async (b: any) => expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost?.generateEstimateUsd ?? 0, ...(b.template && { expectedCredits: b.template.quote }) }), 202);

export async function tela(page: Page, info: TestInfo, nome: string): Promise<string> {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nome}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}
export async function idioma(ctx: BrowserContext, lang: Lang, baseURL: string): Promise<void> {
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: lang, url: baseURL }]);
  // o nome/descrição do template vêm do ui_locale do usuário (o seletor EN/PT grava os dois)
  await q(`update users set ui_locale = $1 where id = 'qa_user_dono_a'`, [lang === 'pt-BR' ? 'PT_BR' : 'EN']);
}
/** Texto da tela + title/aria sem nada aposentado. */
export async function semAposentado(page: Page, onde: string): Promise<void> {
  const txt = await page.evaluate(() => {
    const attrs = [...document.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((e) => ['title', 'aria-label', 'placeholder'].map((a) => e.getAttribute(a) ?? ''));
    return `${document.body.innerText}\n${attrs.join('\n')}`;
  });
  expect(txt, `${onde}: texto aposentado na tela`).not.toMatch(PROIBIDO);
}
export async function semLateral(page: Page, onde: string): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect.soft(sw, `${onde}: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw + 1);
}
/** Espia: console/pageerror, JSON da API com campo aposentado e GETs do lote (laço). */
export function espiar(page: Page) {
  const erros: string[] = [];
  const campos: string[] = [];
  const gets: number[] = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => erros.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/v1')) return;
    if (r.request().method() === 'GET' && /^\/api\/v1\/iterate\/[^/]+$/.test(u.pathname)) gets.push(Date.now());
    if (!(r.headers()['content-type'] ?? '').includes('json')) return;
    const t = await r.text().catch(() => '');
    for (const k of ['captionOverride', '"forced"', 'captionNote":true', 'captionCandidates', 'plateColor']) if (t.includes(k)) campos.push(`${k} em ${r.request().method()} ${u.pathname}`);
  });
  return { erros, campos, gets };
}
/** Mesma peça, um objeto só: tira o selo do next dev de cima do rodapé. */
export async function semSeloDev(page: Page): Promise<void> {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(st); }));
}
export function notas(info: TestInfo, nome: string, dados: unknown): void {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${nome}.json`), JSON.stringify(dados, null, 2));
}
