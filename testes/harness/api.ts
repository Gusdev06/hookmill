// Cliente da API pros testes de contrato + asserts do envelope de `docs/contratos/api.md` §1. Dono: maquina-qa.
import { expect } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, ENV } from './env.ts';
import { PERSONAS, readSnapshot, type Persona } from './db.ts';

export interface Res<T = any> {
  status: number;
  body: any;
  data: T;
  headers: Headers;
}

export async function call<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string>; raw?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined || opts.raw !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let r: Response;
  try {
    r = await fetch(ENV.apiUrl + path, {
      method,
      headers,
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      redirect: 'manual',
    });
  } catch (err) {
    throw new Error(`[qa] API fora do ar em ${ENV.apiUrl} (depende do B1/B2 entregue e do webServer do Playwright): ${(err as Error).message}`);
  }
  const text = await r.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* corpo não-JSON (ex.: SSE, 302) */
  }
  return { status: r.status, body, data: body?.data, headers: r.headers };
}

// ───────────── sessão por persona (login UMA vez por execução) ─────────────
// O reset por teste preserva ids de user/workspace, então o access token (JWT 15 min) continua válido entre testes.
// O cache fica em memória E em disco (.cache/tokens.json), amarrado ao snapshot desta execução: quando um teste falha,
// o Playwright mata o worker e sobe outro, e sem o disco ele refaria o login de todas as personas, estourando o
// limite da API (20 logins/min por IP). Com o disco, o worker novo reaproveita os tokens. O limite da API não muda.
const TOKENS = join(CACHE_DIR, 'tokens.json');
type Sessao = { token: string; at: number };
const cache = new Map<Persona, Sessao>();
const TTL_MS = 12 * 60_000; // access token vale 15 min

function lerDisco(): Record<string, Sessao> {
  try {
    const f = JSON.parse(readFileSync(TOKENS, 'utf8'));
    return f.run === readSnapshot().createdAt ? f.sessions : {};
  } catch {
    return {};
  }
}
function gravarDisco(p: Persona, s: Sessao): void {
  const sessions = { ...lerDisco(), [p]: s };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(TOKENS, JSON.stringify({ run: readSnapshot().createdAt, sessions }, null, 2));
}

/** Faz login; se o throttle de login responder 429, espera `retryAfterSec` e tenta de novo (até 2 min). */
export async function login(email: string, password = ENV.password): Promise<Res> {
  const until = Date.now() + 120_000;
  for (;;) {
    const res = await call('POST', '/auth/login', { body: { email, password } });
    if (res.status !== 429 || Date.now() > until) return res;
    const wait = Number(res.body?.error?.details?.retryAfterSec ?? 10);
    await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000 + 250));
  }
}

export async function tokenOf(p: Persona): Promise<string> {
  const fresh = (s?: Sessao) => s && Date.now() - s.at < TTL_MS;
  const mem = cache.get(p);
  if (fresh(mem)) return mem!.token;
  const disk = lerDisco()[p];
  if (fresh(disk)) {
    cache.set(p, disk);
    return disk.token;
  }
  const res = await login(PERSONAS[p].email);
  if (res.status !== 200) {
    throw new Error(`[qa] login de ${p} falhou (${res.status}): ${JSON.stringify(res.body)}. Depende do B1 (auth + seed).`);
  }
  const s = { token: res.data.accessToken as string, at: Date.now() };
  cache.set(p, s);
  gravarDisco(p, s);
  return s.token;
}
export function forgetTokens(): void {
  cache.clear();
  rmSync(TOKENS, { force: true });
}

/** Cliente já autenticado como uma persona. */
export function as(p: Persona) {
  const go = async <T = any>(method: string, path: string, body?: unknown, extra: { raw?: string; headers?: Record<string, string> } = {}) =>
    call<T>(method, path, { body, token: await tokenOf(p), ...extra });
  return {
    get: <T = any>(path: string) => go<T>('GET', path),
    post: <T = any>(path: string, body: unknown = {}) => go<T>('POST', path, body),
    patch: <T = any>(path: string, body: unknown = {}) => go<T>('PATCH', path, body),
    put: <T = any>(path: string, body: unknown = {}) => go<T>('PUT', path, body),
    del: <T = any>(path: string) => go<T>('DELETE', path),
    raw: go,
  };
}
export type Client = ReturnType<typeof as>;

// ───────────── asserts do envelope ─────────────
const show = (res: Res) => `HTTP ${res.status} ${JSON.stringify(res.body)?.slice(0, 600)}`;

/** Sucesso: `{ success: true, data }` com o status esperado. */
export function expectOk<T = any>(res: Res<T>, status = 200): T {
  expect(res.status, show(res)).toBe(status);
  expect(res.body?.success, show(res)).toBe(true);
  expect(res.body, show(res)).toHaveProperty('data');
  return res.data;
}

/** Erro: `{ success: false, error: { code, message, statusCode } }` com status e code do contrato. */
export function expectErro(res: Res, status: number, code: string): any {
  expect(res.status, show(res)).toBe(status);
  expect(res.body?.success, show(res)).toBe(false);
  expect(res.body?.error?.code, show(res)).toBe(code);
  expect(typeof res.body?.error?.message, show(res)).toBe('string');
  expect(res.body?.error?.statusCode, show(res)).toBe(status);
  return res.body.error.details;
}

/** Lista paginada: `data` array + `meta.nextCursor` presente (null no fim). */
export function expectPagina<T = any>(res: Res<T[]>): T[] {
  const data = expectOk(res);
  expect(Array.isArray(data), show(res)).toBe(true);
  expect(res.body?.meta, show(res)).toHaveProperty('nextCursor');
  return data as T[];
}

/** Espera uma condição sobre a API (estado assíncrono do mock termina em 2-5 s). */
export async function aguardar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, { timeoutMs = 20_000, intervalMs = 500, oQue = 'condição' } = {}): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < until);
  throw new Error(`[qa] timeout esperando ${oQue}; último valor: ${JSON.stringify(last).slice(0, 600)}`);
}
