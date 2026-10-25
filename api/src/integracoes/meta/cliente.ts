// Cliente HTTP da Graph API (Marketing API). fetch nativo, versão por env (META_GRAPH_VERSION), token SEMPRE no header
// `Authorization: Bearer` (nunca na URL: não vaza em log/proxy) e appsecret_proof na query em TODA chamada com token (§7), paginação por `paging.next`/`cursors.after`, leitura de X-Business-Use-Case-Usage / x-app-usage e
// backoff curto só em 5xx/rede (nunca repete POST que cria objeto: a Meta pode ter criado). NUNCA loga o token.
import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { type GraphErrorBody, MetaError, mapGraphError, scrubToken } from './erros';

export const GRAPH_BASE = 'https://graph.facebook.com';
export const DEFAULT_GRAPH_VERSION = 'v25.0';

export interface GraphClientOptions {
  appId: string;
  appSecret: string;
  version?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** tentativas extras em 5xx/rede para GET (padrão 1) */
  retries?: number;
}

export type Params = Record<string, string | number | boolean | null | undefined>;
export type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GraphUsage {
  /** maior % entre call_count / total_cputime / total_time (BUC por conta ou app usage) */
  pct: number;
  /** segundos até liberar (estimated_time_to_regain_access, em minutos na Meta) */
  regainSec: number | null;
}

export function parseUsageHeaders(h: Headers): GraphUsage | null {
  const buc = h.get('x-business-use-case-usage');
  const app = h.get('x-app-usage');
  const ad = h.get('x-ad-account-usage');
  let pct = -1;
  let regainSec: number | null = null;
  const look = (o: Raw | null | undefined) => {
    if (!o || typeof o !== 'object') return;
    for (const k of ['call_count', 'total_cputime', 'total_time', 'acc_id_util_pct']) {
      const v = Number(o[k]);
      if (Number.isFinite(v)) pct = Math.max(pct, v);
    }
    const r = Number(o.estimated_time_to_regain_access);
    if (Number.isFinite(r) && r > 0) regainSec = Math.max(regainSec ?? 0, r * 60);
  };
  try {
    if (buc) for (const list of Object.values(JSON.parse(buc) as Record<string, Raw[]>)) (Array.isArray(list) ? list : [list]).forEach(look);
    if (app) look(JSON.parse(app));
    if (ad) look(JSON.parse(ad));
  } catch {
    return null;
  }
  return pct < 0 ? null : { pct, regainSec };
}

export class GraphClient {
  private readonly log = new Logger('MetaGraph');
  private readonly f: typeof fetch;
  private readonly base: string;
  readonly version: string;
  private readonly sleep: (ms: number) => Promise<void>;
  /** último uso visto (pro health/log) */
  lastUsage: GraphUsage | null = null;
  /** quando o `lastUsage` foi lido (MetaService.usage()) */
  lastUsageAt: Date | null = null;

  constructor(private readonly opts: GraphClientOptions) {
    this.f = opts.fetchImpl ?? fetch;
    this.version = opts.version || DEFAULT_GRAPH_VERSION;
    this.base = `${(opts.baseUrl ?? GRAPH_BASE).replace(/\/$/, '')}/${this.version}`;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  proof(token: string): string {
    return createHmac('sha256', this.opts.appSecret).update(token).digest('hex');
  }

  /** URL da chamada: params + `appsecret_proof` (o token em si vai no header, nunca aqui; se vier na URL, sai). */
  url(path: string, params: Params = {}, token?: string | null): string {
    const u = new URL(/^https?:/.test(path) ? path : `${this.base}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    if (token) {
      u.searchParams.delete('access_token');
      u.searchParams.set('appsecret_proof', this.proof(token));
    }
    return u.toString();
  }

  /** GET com token (appsecret_proof). `stage` só pra etiquetar o erro. */
  async get<T = Raw>(path: string, params: Params, token: string | null, ctx: { stage?: string | null; retries?: number } = {}): Promise<T> {
    return this.call<T>('GET', this.url(path, params, token), token, undefined, ctx.stage ?? null, ctx.retries ?? this.opts.retries ?? 1);
  }
  /** POST com corpo JSON (ids de objeto criados: NUNCA repetido). */
  async post<T = Raw>(path: string, body: Raw, token: string, ctx: { stage?: string | null } = {}): Promise<T> {
    return this.call<T>('POST', this.url(path, {}, token), token, { kind: 'json', body }, ctx.stage ?? null, 0);
  }
  /** POST multipart (upload resumable). */
  async postForm<T = Raw>(path: string, form: FormData, token: string, ctx: { stage?: string | null } = {}): Promise<T> {
    return this.call<T>('POST', this.url(path, {}, token), token, { kind: 'form', form }, ctx.stage ?? null, 0);
  }
  async delete<T = Raw>(path: string, token: string): Promise<T> {
    return this.call<T>('DELETE', this.url(path, {}, token), token, undefined, null, 0);
  }

  /**
   * Pagina `data[]` até `max` itens (ou até acabar `paging.next`). Se a Graph pedir menos dados por página
   * (code 1 "Please reduce the amount of data…", bug live 22/10), repete a MESMA página com `limit` menor
   * (100 → 50 → 25 → 10; 500 → 250 → 125 → …) antes de desistir; o cursor `after` da página é mantido.
   */
  async paginate<T = Raw>(path: string, params: Params, token: string, max: number, ctx: { stage?: string | null; onPage?: (n: number) => void } = {}): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = this.url(path, params, token);
    while (next && out.length < max) {
      let page: Raw;
      try {
        page = await this.call<Raw>('GET', next, token, undefined, ctx.stage ?? null, this.opts.retries ?? 1);
      } catch (e) {
        const smaller: string | null = isTooMuchData(e) ? shrinkLimit(next) : null;
        if (!smaller) throw e;
        this.log.warn(`graph GET ${pathOf(next)}: Meta pediu menos dados; repetindo a página com limit=${new URL(smaller).searchParams.get('limit')}`);
        next = smaller;
        continue;
      }
      const data: T[] = Array.isArray(page.data) ? page.data : [];
      out.push(...data);
      ctx.onPage?.(out.length);
      const n: unknown = page.paging?.next;
      // paging.next vem da Meta com o access_token na query: tira da URL (vai no header) e garante o proof
      next = typeof n === 'string' && data.length ? this.url(n, {}, token) : null;
    }
    return out.slice(0, max);
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', url: string, token: string | null | undefined, body: { kind: 'json'; body: Raw } | { kind: 'form'; form: FormData } | undefined, stage: string | null, retries: number): Promise<T> {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body?.kind === 'json') headers['content-type'] = 'application/json';
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.f(url, {
          method,
          headers,
          body: body?.kind === 'json' ? JSON.stringify(body.body) : body?.kind === 'form' ? body.form : undefined,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
        });
      } catch (e) {
        if (attempt < retries) {
          attempt++;
          await this.sleep(500 * attempt);
          continue;
        }
        throw new MetaError('META_UNAVAILABLE', `Meta didn't answer (${scrubToken((e as Error).message)})`, { details: { reason: 'down', retryAfterSec: 30 }, action: 'retry', retryAfterSec: 30, stage });
      }
      const usage = parseUsageHeaders(res.headers);
      if (usage) {
        this.lastUsage = usage;
        this.lastUsageAt = new Date();
      }
      const json = await safeJson(res);
      if (res.ok && !json.error) {
        if (usage && usage.pct >= 100) throw rateLimited(usage.regainSec ?? 60, stage, 'usage header ≥ 100%');
        return json as T;
      }
      const err: GraphErrorBody | null = json.error && typeof json.error === 'object' ? (json.error as GraphErrorBody) : null;
      const retryAfterSec = usage?.regainSec ?? (res.headers.get('retry-after') ? Number(res.headers.get('retry-after')) : null);
      if (!err && res.status >= 500 && attempt < retries) {
        attempt++;
        await this.sleep(500 * attempt);
        continue;
      }
      const mapped = mapGraphError(err, { httpStatus: res.status, stage, retryAfterSec: Number.isFinite(retryAfterSec as number) ? (retryAfterSec as number) : null });
      this.log.warn(`graph ${method} ${pathOf(url)} → ${res.status} ${mapped.code}${mapped.failDetail ? ` (${mapped.failDetail})` : ''}`);
      throw mapped;
    }
  }
}

/** Graph code 1 "Please reduce the amount of data you're asking for" (mapeado em erros.ts como reason 'too_much_data'). */
export function isTooMuchData(e: unknown): boolean {
  return e instanceof MetaError && e.options.details?.reason === 'too_much_data';
}

/** Próximo `limit` menor (100 → 50 → 25 → 10; abaixo de 10 desiste). `null` = não dá pra encolher. */
export function nextLimit(limit: number): number | null {
  if (!Number.isFinite(limit) || limit <= 10) return null;
  return limit > 25 ? Math.floor(limit / 2) : 10;
}

function shrinkLimit(url: string): string | null {
  const u = new URL(url);
  const cur = Number(u.searchParams.get('limit') ?? 25); // sem limit, a Graph usa 25
  const n = nextLimit(cur);
  if (!n) return null;
  u.searchParams.set('limit', String(n));
  return u.toString();
}

export function rateLimited(retryAfterSec: number, stage: string | null, why: string): MetaError {
  return new MetaError('META_RATE_LIMITED', `Meta asked us to wait (${why}).`, { details: { reason: 'rate_limited', retryAfterSec }, retryAfterSec, action: 'retry', stage });
}

async function safeJson(res: Response): Promise<Raw> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : { raw: text };
  } catch {
    // corpo que não é JSON (HTML de 502, texto cru): sem `error` da Graph; o status HTTP decide (5xx → retry → META_UNAVAILABLE)
    return text && res.ok ? { raw: text } : {};
  }
}
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '?';
  }
}
