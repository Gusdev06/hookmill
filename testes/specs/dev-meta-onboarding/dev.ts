// Ajudantes do QA contra a API/web de DEV (:3001/:3000, mock). Só cria contas novas pelo signup; nunca zera banco.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const API = process.env.QA_DEV_API ?? 'http://localhost:3001/api/v1';
export const TELAS = process.env.QA_TELAS ?? join(process.cwd(), 'test-results', 'dev', 'telas');
export const PASSWORD = 'qa-senha-forte-2026';
export const RUN = Date.now().toString(36);

export interface Res { status: number; body: any; data: any; headers: Headers }
export async function call(method: string, path: string, opts: { body?: unknown; token?: string | null } = {}): Promise<Res> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(API + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: 'manual' });
  const text = await r.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* 302 etc. */ }
  return { status: r.status, body, data: body?.data, headers: r.headers };
}

export interface Conta { email: string; name: string; token: string; workspaceId: string; wsName: string }
let n = 0;
/** Conta nova pelo signup da API (login throttle: 20/min por IP). */
export async function signup(label: string, opts: { agencyName?: string; accountMode?: 'AGENCY' | 'OWN' } = {}): Promise<Conta> {
  const email = `qa-final-${RUN}-${label}-${++n}@teste.local`;
  const name = `QA ${label}`;
  const r = await call('POST', '/auth/signup', { body: { name, email, password: PASSWORD, ...(opts.agencyName ? { agencyName: opts.agencyName } : {}), ...(opts.accountMode ? { accountMode: opts.accountMode } : {}) } });
  if (r.status === 429) { await new Promise((res) => setTimeout(res, 61_000)); return signup(label, opts); }
  if (r.status !== 201) throw new Error(`[qa] signup ${r.status}: ${JSON.stringify(r.body)}`);
  return { email, name, token: r.data.accessToken, workspaceId: r.data.workspace.id, wsName: r.data.workspace.name };
}
export const as = (c: { token: string }) => ({
  get: (p: string) => call('GET', p, { token: c.token }),
  post: (p: string, body: unknown = {}) => call('POST', p, { body, token: c.token }),
  patch: (p: string, body: unknown = {}) => call('PATCH', p, { body, token: c.token }),
  put: (p: string, body: unknown = {}) => call('PUT', p, { body, token: c.token }),
  del: (p: string) => call('DELETE', p, { token: c.token }),
});

/** Login pelo BFF do web (/api/session): mesmo cookie da tela. */
export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const r = await page.request.post('/api/session', { data: { email, password } });
    if (r.ok()) return;
    if (r.status() !== 429) throw new Error(`[qa] /api/session ${r.status()}: ${await r.text()}`);
    await page.waitForTimeout(61_000);
  }
  throw new Error('[qa] login preso no throttle');
}
export async function ptBR(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pt-BR', url: baseURL }]);
}

export async function tela(page: Page, info: TestInfo, nome: string): Promise<string> {
  const dir = join(TELAS, info.project.name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nome}.png`);
  await page.waitForTimeout(450); // 23/10: deixa a animação de Dialog/Sheet (~300 ms) terminar antes da foto
  await page.screenshot({ path, fullPage: true });
  await info.attach(nome, { path, contentType: 'image/png' });
  return path;
}
export async function semRolagemHorizontal(page: Page, onde: string): Promise<void> {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${onde}: scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw + 1);
}

/** Preenche o que o complete exige (businessType + oferta) e, se pedido, conclui o onboarding (LIVE). */
export async function prepararWorkspace(c: Conta, o: { live?: boolean; step?: number; name?: string } = {}) {
  const a = as(c);
  const w = await a.patch('/workspace', { name: o.name ?? c.wsName, businessType: 'ONLINE_STORE', market: 'United States', ...(o.step ? { onboardingStep: o.step } : {}) });
  if (w.status !== 200) throw new Error(`PATCH /workspace ${w.status} ${JSON.stringify(w.body)}`);
  const off = await a.post('/offers', { name: `Offer ${RUN}`, language: 'en', kind: 'Subscription app', what: 'A budgeting app that finds forgotten subscriptions.', promise: 'Find money you forgot you were spending.', audience: 'Adults who lose track of money', cta: 'Start your free trial', sourceUrl: 'https://example.com/' });
  if (off.status !== 201) throw new Error(`POST /offers ${off.status} ${JSON.stringify(off.body)}`);
  if (o.live) {
    const d = await a.post('/workspace/onboarding/complete');
    if (d.status !== 200) throw new Error(`complete ${d.status} ${JSON.stringify(d.body)}`);
  }
  return off.data;
}

/** Conecta a Meta pela API (callback mock) e escolhe a conta 1; espera o 1º sync. */
export async function conectarMeta(c: Conta, acct = 'act_mock_1', pixel: string | null = 'pix_mock') {
  const a = as(c);
  const u = await a.post('/meta/connect', { returnTo: '/settings' });
  if (u.status !== 201) throw new Error(`connect ${u.status} ${JSON.stringify(u.body)}`);
  const cb = await fetch(u.data.url, { redirect: 'manual' });
  if (cb.status !== 302 || !cb.headers.get('location')?.includes('meta=connected')) throw new Error(`callback ${cb.status} ${cb.headers.get('location')}`);
  const s = await a.put('/meta/selection', { adAccountId: acct, pageId: 'page_mock', pixelId: pixel });
  if (s.status !== 200) throw new Error(`selection ${s.status} ${JSON.stringify(s.body)}`);
  await expect.poll(async () => (await a.get('/meta/summary')).data?.sync?.state, { timeout: 60_000 }).toBe('ok');
}

/** Convida e aceita (API): devolve o e-mail do convidado (mesma senha). */
export async function convidar(dono: Conta, role: 'ADMIN' | 'MEMBER' | 'CLIENT', label: string): Promise<{ email: string; token: string }> {
  const email = `qa-final-${RUN}-${label}-${++n}@teste.local`;
  const inv = await as(dono).post('/workspace/invites', { email, role });
  if (inv.status !== 201) throw new Error(`invite ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = inv.data.inviteUrl.split('/invite/')[1];
  const acc = await call('POST', `/auth/invites/${token}/accept`, { body: { name: `QA ${label}`, password: PASSWORD } });
  if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.body)}`);
  return { email, token: acc.data.accessToken };
}

// ───── banco de DEV (só pra mexer em linhas das contas qa-ob2-* criadas aqui: stale/failed/TOKEN_INVALID) ─────
import pg from 'pg';
import { readFileSync } from 'node:fs';
let pool: pg.Pool | null = null;
export function dbDev(): pg.Pool {
  if (pool) return pool;
  const env = readFileSync(join(process.cwd(), '..', 'api', '.env'), 'utf8');
  // 22/10: a API do QA roda no maquina_test (QA_DEV_DB); sem a env, o banco do api/.env (rodadas 1-2)
  const url = process.env.QA_DEV_DB ?? /^DATABASE_URL=(\S+)/m.exec(env)?.[1];
  if (!url || !/localhost|127\.0\.0\.1/.test(url)) throw new Error('[qa] DATABASE_URL do api/.env não é local; não mexo');
  pool = new pg.Pool({ connectionString: url, max: 2 });
  return pool;
}
export const sql = async <T = any>(q: string, params: unknown[] = []): Promise<T[]> => (await dbDev().query(q, params)).rows as T[];

/** Criativo APPROVED com render final (só linhas no banco; o mock da Meta não baixa o vídeo). */
export async function criativoAprovado(c: Conta, offerId: string, nome = 'Hook QA'): Promise<{ id: string; adName: string }> {
  const me = (await as(c).get('/auth/me')).data;
  const uid = me.user.id as string;
  const rid = () => 'qa' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const id = rid(); const fileId = rid(); const renderId = rid();
  const adName = `QA_1021_${id.slice(-4).toUpperCase()}`;
  await sql(`insert into creatives (id, workspace_id, offer_id, name, language, state, approved_at, approved_by_id, ad_name, created_by_id, updated_at)
             values ($1,$2,$3,$4,'en','APPROVED',now(),$5,$6,$5,now())`, [id, c.workspaceId, offerId, nome, uid, adName]);
  await sql(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height)
             values ($1,$2,'RENDER_VIDEO',$3,'video/mp4',1000000,20,1080,1920)`, [fileId, c.workspaceId, `ws/${c.workspaceId}/render_video/${fileId}.mp4`]);
  await sql(`insert into renders (id, workspace_id, creative_id, status, settings, input, file_id, duration_sec)
             values ($1,$2,$3,'READY','{}'::jsonb,'{}'::jsonb,$4,20)`, [renderId, c.workspaceId, id, fileId]);
  await sql(`update creatives set final_render_id = $2 where id = $1`, [id, renderId]);
  return { id, adName };
}
/** Espera a publicação sair de PUBLISHING. */
export async function atePublicacao(c: Conta, creativeId: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = (await as(c).get(`/creatives/${creativeId}/meta`)).data;
    if (r?.publication && r.publication.status !== 'PUBLISHING') return r;
    if (Date.now() > until) throw new Error(`[qa] publicação presa: ${JSON.stringify(r?.publication).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 800));
  }
}
