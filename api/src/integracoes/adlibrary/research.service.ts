// ads-research-v1 (Ad Radar), C.3/C.8: coleta da Ad Library pelo actor da Apify `curious_coder~facebook-ads-library-scraper`.
// Página + país (view_all_page_id) ou busca por termo/domínio (unordered | exact_phrase), sempre com país e limite ≥ 10.
// REST puro (sem SDK), espera o run dentro da chamada (sem webhook). Regras da R0/R1:
//   - todo run leva `maxTotalChargeUsd = (limit + 30) × 0,00075 + 0,001` (trava dura na Apify);
//   - item de erro (PAGE_PRIVATE, ADS_NOT_FOUND…) sai de `items`, vai pra `errors`, e é cobrado igual;
//   - custo real = `usageTotalUsd` relido ~15 s depois do fim (antes disso ele mostra só a partida);
//   - 402 concurrent-runs-limit-exceeded = tenta de novo (não é cobrado); esgotou = RETRYABLE;
//   - no máximo `concurrency` runs ao mesmo tempo por processo (fila interna).
// A porta NÃO grava cost_entry: devolve o custo (inclusive no erro, em details.costUsd) e o backend grava.
// NÃO VALIDADO LIVE nesta forma (sondas R0/R1 rodaram o mesmo pedido por script); live só com a conta própria (R7).
import { Logger } from '@nestjs/common';
import type { AdLibraryResearchService, ResearchScrapeInput, ResearchScrapeResult } from '../contrato';
import { IntegracaoError } from '../erros';
import { APIFY_BASE, DEFAULT_AD_LIBRARY_ACTOR } from './ad-library.service';
import { splitItems } from './mapear';

type Status = { available: boolean; reason: 'quota' | 'not_configured' | null; retryAfter: string | null };
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Preço do actor medido na R0 (pay-per-event): por item no dataset e por partida (1 GB). */
export const APIFY_PRICE = { perItem: 0.00075, perRun: 0.00005 } as const;
export const RESEARCH_MIN_LIMIT = 10;

export interface ApifyResearchOptions {
  token: string;
  actor?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** espera total pelo run (ADS_RESEARCH_SYNC_TIMEOUT_MS, padrão 6 min) */
  timeoutMs?: number;
  /** runs simultâneos (ADS_RESEARCH_APIFY_CONCURRENCY, padrão 4) */
  concurrency?: number;
  /** espera antes de reler o custo (padrão 15 s) */
  settleMs?: number;
  /** tentativas no 402 concurrent-runs (padrão 5, 8 s entre elas) */
  concurrentRetries?: number;
  concurrentRetryMs?: number;
  /** cache do status() (padrão 10 min) */
  statusTtlMs?: number;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Teto da Apify por run (R0, recomendação 3). */
export function maxChargeFor(limit: number): number {
  return Math.round(((limit + 30) * APIFY_PRICE.perItem + 0.001) * 10000) / 10000;
}

/** Custo pela fórmula da R0 (quando a releitura falha ou ainda não assentou). */
export function formulaCost(itemsRaw: number): number {
  return r6(itemsRaw * APIFY_PRICE.perItem + APIFY_PRICE.perRun);
}

/** URL da Ad Library que o actor recebe. */
export function researchUrl(i: Pick<ResearchScrapeInput, 'kind' | 'query' | 'searchType' | 'countryCode'>): string {
  const cc = i.countryCode.toUpperCase();
  const base = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${cc}&media_type=all`;
  if (i.kind === 'PAGE') return `${base}&search_type=page&view_all_page_id=${encodeURIComponent(i.query.trim())}`;
  const exact = i.searchType === 'exact_phrase';
  const q = exact ? `"${i.query.trim().replace(/"/g, '')}"` : i.query.trim();
  return `${base}&q=${encodeURIComponent(q)}&search_type=${exact ? 'keyword_exact_phrase' : 'keyword_unordered'}`;
}

/** Corpo do run (mesmo pedido das sondas R0/R1). */
export function actorInput(i: ResearchScrapeInput, limit: number): Record<string, unknown> {
  return {
    urls: [{ url: researchUrl(i) }],
    limitPerSource: limit,
    count: limit,
    scrapeAdDetails: false,
    'scrapePageAds.activeStatus': 'active',
    'scrapePageAds.countryCode': i.countryCode.toUpperCase(),
    'scrapePageAds.sortBy': 'impressions_desc',
  };
}

const unavailable = (reason: 'quota' | 'not_configured' | 'provider_error', retryAfter: string | null, msg: string) =>
  new IntegracaoError('AD_LIBRARY_UNAVAILABLE', msg, { reason, retryAfter });

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT']);

interface Run {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

/** Semáforo simples (fila FIFO). */
class Slots {
  private waiters: (() => void)[] = [];
  constructor(private free: number) {}
  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.free++;
  }
}

export class ApifyResearchService implements AdLibraryResearchService {
  private readonly log = new Logger('AdRadar');
  private cache: { at: number; ttl: number; value: Status } | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly slots: Slots;
  readonly actor: string;

  constructor(private readonly opts: ApifyResearchOptions) {
    this.f = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.slots = new Slots(Math.max(1, opts.concurrency ?? 4));
    this.actor = (opts.actor || DEFAULT_AD_LIBRARY_ACTOR).replace('/', '~');
  }

  async status(): Promise<Status> {
    if (!this.opts.token) return { available: false, reason: 'not_configured', retryAfter: null };
    const t = this.now();
    if (this.cache && t - this.cache.at < this.cache.ttl) return this.cache.value;
    let value: Status;
    let ttl = this.opts.statusTtlMs ?? 600_000;
    try {
      const res = await this.api('GET', '/users/me/limits');
      if (res.status === 401 || res.status === 403) value = { available: false, reason: 'not_configured', retryAfter: null };
      else if (!res.ok) throw new Error(`limits HTTP ${res.status}`);
      else {
        const d: Raw = ((await res.json()) as Raw).data ?? {};
        const max = Number(d.limits?.maxMonthlyUsageUsd);
        const used = Number(d.current?.monthlyUsageUsd);
        const over = Number.isFinite(max) && max > 0 && Number.isFinite(used) && used >= max - 0.01;
        value = over ? { available: false, reason: 'quota', retryAfter: nextDay(d.monthlyUsageCycle?.endAt) } : { available: true, reason: null, retryAfter: null };
      }
    } catch (e) {
      // checagem falhou (rede/5xx): não trava a tela; o scrape() falha explícito se a Apify estiver mesmo fora
      this.log.warn(`apify limits: ${(e as Error).message}`);
      value = { available: true, reason: null, retryAfter: null };
      ttl = 60_000;
    }
    this.cache = { at: t, ttl, value };
    return value;
  }

  async scrape(i: ResearchScrapeInput): Promise<ResearchScrapeResult> {
    if (!this.opts.token) throw unavailable('not_configured', null, 'ADS_RESEARCH_APIFY_TOKEN / APIFY_TOKEN is empty in api/.env');
    if (!i.query?.trim()) throw new IntegracaoError('PROVIDER_ERROR', 'research scrape: empty query');
    if (!/^[A-Za-z]{2}$/.test(i.countryCode ?? '')) throw new IntegracaoError('PROVIDER_ERROR', `research scrape: invalid countryCode "${i.countryCode}"`);
    const limit = Math.max(RESEARCH_MIN_LIMIT, Math.floor(i.limit || 0));
    const input = actorInput(i, limit);

    let run: Run;
    let finished: boolean;
    await this.slots.acquire();
    try {
      run = await this.startRun(input, maxChargeFor(limit), i.ref);
      const deadline = this.now() + (this.opts.timeoutMs ?? 360_000);
      while (!TERMINAL.has(run.status) && this.now() < deadline) {
        const wait = Math.max(1, Math.min(60, Math.ceil((deadline - this.now()) / 1000)));
        const res = await this.api('GET', `/actor-runs/${run.id}?waitForFinish=${wait}`).catch(() => null);
        if (res?.ok) run = (((await res.json()) as Raw).data ?? run) as Run;
        else await this.sleep(2000);
      }
      finished = TERMINAL.has(run.status);
      if (!finished) await this.api('POST', `/actor-runs/${run.id}/abort`).catch(() => null);
    } finally {
      this.slots.release();
    }

    // dataset: lido mesmo em FAILED/timeout (o que entrou foi cobrado)
    let raw: unknown[] = [];
    if (run.defaultDatasetId) {
      const res = await this.api('GET', `/datasets/${run.defaultDatasetId}/items?clean=true&format=json`).catch(() => null);
      if (res?.ok) {
        const body = (await res.json().catch(() => [])) as unknown;
        raw = Array.isArray(body) ? body : [];
      } else if (run.status === 'SUCCEEDED') {
        const costUsd = await this.settle(run.id, 0);
        throw new IntegracaoError('PROVIDER_ERROR', `apify dataset HTTP ${res?.status ?? 'network'}`, { runId: run.id, costUsd });
      }
    }
    const costUsd = await this.settle(run.id, raw.length);
    if (!finished) throw new IntegracaoError('PROVIDER_TIMEOUT', `apify run ${run.id} did not finish in time`, { runId: run.id, costUsd });
    if (run.status !== 'SUCCEEDED') throw new IntegracaoError('PROVIDER_ERROR', `apify run ${run.id} ${run.status}`, { runId: run.id, costUsd });

    const { items, errors } = splitItems(raw);
    if (errors.length) this.log.log(`${i.ref}: ${errors.length} item(s) de erro descartado(s) (${[...new Set(errors.map((e) => e.code))].join(', ')})`);
    return { items, errors, runId: run.id, costUsd, itemsRaw: raw.length, actor: this.actor };
  }

  // ------------------------------------------------------------------

  private api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    return this.f(`${APIFY_BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.opts.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(75_000),
    });
  }

  private async startRun(input: unknown, maxCharge: number, ref: string): Promise<Run> {
    const tries = Math.max(0, this.opts.concurrentRetries ?? 5);
    for (let k = 0; ; k++) {
      let res: Response;
      try {
        res = await this.api('POST', `/acts/${this.actor}/runs?memory=512&waitForFinish=60&maxTotalChargeUsd=${maxCharge}`, input);
      } catch (e) {
        throw new IntegracaoError('PROVIDER_ERROR', `apify: ${(e as Error).message}`);
      }
      if (res.ok) return (((await res.json()) as Raw).data ?? {}) as Run;
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw unavailable('not_configured', null, 'apify token rejected');
      if (/concurrent/i.test(body) && (res.status === 402 || res.status === 429 || res.status === 403)) {
        if (k < tries) {
          this.log.warn(`${ref}: apify concurrent-runs limit, retrying (${k + 1}/${tries})`);
          await this.sleep(this.opts.concurrentRetryMs ?? 8_000);
          continue;
        }
        throw new IntegracaoError('RETRYABLE', `apify concurrent-runs limit after ${tries} retries`);
      }
      // 402 / 403 com limite do mês ("monthly usage hard limit exceeded"): teto da conta
      if (res.status === 402 || (res.status === 403 && /limit|usage|quota/i.test(body))) {
        this.cache = null;
        const st = await this.status().catch(() => null);
        throw unavailable('quota', st?.retryAfter ?? null, `apify ${res.status}: ${body.slice(0, 200)}`);
      }
      throw new IntegracaoError('PROVIDER_ERROR', `apify ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /** Relê o run ~15 s depois do fim: `usageTotalUsd` assentado. Abaixo da metade da fórmula = ainda não assentou → fórmula. */
  private async settle(runId: string, itemsRaw: number): Promise<number> {
    const formula = formulaCost(itemsRaw);
    await this.sleep(this.opts.settleMs ?? 15_000);
    try {
      const res = await this.api('GET', `/actor-runs/${runId}`);
      if (!res.ok) return formula;
      const usd = Number((((await res.json()) as Raw).data ?? {}).usageTotalUsd);
      if (!Number.isFinite(usd) || usd < 0) return formula;
      if (usd < formula * 0.5) {
        this.log.warn(`run ${runId}: usageTotalUsd ${usd} < fórmula ${formula}; gravando a fórmula`);
        return formula;
      }
      return r6(usd);
    } catch {
      return formula;
    }
  }
}

/** Fim do ciclo de cobrança (endAt) → dia em que volta (AAAA-MM-DD). */
function nextDay(endAt: unknown): string | null {
  const t = typeof endAt === 'string' ? Date.parse(endAt) : NaN;
  return Number.isFinite(t) ? new Date(t + 1).toISOString().slice(0, 10) : null;
}

/** ADS_RESEARCH_MODE=off: Ad Radar desligado ("Soon" na sidebar). */
export class OffResearchService implements AdLibraryResearchService {
  async status(): Promise<Status> {
    return { available: false, reason: 'not_configured', retryAfter: null };
  }
  async scrape(): Promise<ResearchScrapeResult> {
    throw unavailable('not_configured', null, 'ADS_RESEARCH_MODE=off');
  }
}
