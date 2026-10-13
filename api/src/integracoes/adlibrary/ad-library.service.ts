// AdLibraryService (feature 2): resolve UM anúncio da Ad Library da Meta pelo actor do ad-radar na Apify
// (curious_coder/facebook-ads-library-scraper, scrapeAdDetails, 512 MB), mesma conta do ad-radar.
// Sem SDK (REST puro, como o ad-radar). Sem webhook: espera o run dentro do job, até 180 s.
// Falha explícita: sem chave / teto do mês / Apify fora = AD_LIBRARY_UNAVAILABLE com { reason, retryAfter }.
// NÃO VALIDADO LIVE: a conta está no teto até 19/10 (docs/integracoes.md). Formato do item = o mesmo que o
// ad-radar já lê em produção (lib/normalizar.ts).
import { Logger } from '@nestjs/common';
import type { AdLibraryMeta, AdLibraryService, Usage } from '../contrato';
import { IntegracaoError } from '../erros';
import type { CostStore } from '../portas';

export const APIFY_BASE = 'https://api.apify.com/v2';
export const DEFAULT_AD_LIBRARY_ACTOR = 'curious_coder~facebook-ads-library-scraper';

type Resolved = Omit<AdLibraryMeta, 'status' | 'fetchedAt'> & { videoUrl: string | null; posterUrl: string | null };
type Status = { available: boolean; reason: 'quota' | 'not_configured' | null; retryAfter: string | null };

export interface ApifyAdLibraryOptions {
  token: string;
  actor?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** espera total pelo run (padrão 180 s) */
  waitTotalMs?: number;
  /** cache do status() (padrão 10 min) */
  statusTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const unavailable = (reason: 'quota' | 'not_configured' | 'provider_error', retryAfter: string | null, msg: string) =>
  new IntegracaoError('AD_LIBRARY_UNAVAILABLE', msg, { reason, retryAfter });

/** id do anúncio na URL da Ad Library (`?id=<dígitos>`). */
export function adIdOf(url: string): string | null {
  const m = /[?&]id=(\d+)/.exec(url);
  return m ? m[1] : null;
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && typeof (v as Raw).text === 'string') return ((v as Raw).text as string).trim() || null;
  return null;
}
const isoDay = (epoch: unknown) => (typeof epoch === 'number' && epoch > 0 ? new Date(epoch * 1000).toISOString().slice(0, 10) : null);

/** Item cru do actor → metadados do contrato + vídeo (mesmos campos que o ad-radar lê). */
export function mapAdItem(item: Raw, now: number): Resolved {
  const s: Raw = item.snapshot ?? {};
  const cards: Raw[] = Array.isArray(s.cards) ? s.cards : [];
  const videos: Raw[] = [...(Array.isArray(s.videos) ? s.videos : []), ...cards.filter((c) => c.video_hd_url || c.video_sd_url)];
  const v = videos[0] ?? null;
  const card = cards[0] ?? null;
  const aaa: Raw = item.aaa_info ?? item.transparency_by_location?.eu_transparency ?? {};
  const startDate = isoDay(item.start_date);
  const endDate = isoDay(item.end_date);
  const isActive = typeof item.is_active === 'boolean' ? item.is_active : null;
  const endMs = isActive === false && item.end_date ? item.end_date * 1000 : now;
  const daysRunning = typeof item.start_date === 'number' && item.start_date > 0 ? Math.max(0, Math.floor((endMs - item.start_date * 1000) / 86_400_000)) : null;
  return {
    adArchiveId: String(item.ad_archive_id ?? item.adArchiveID ?? '') || null,
    pageName: (String(item.page_name ?? s.page_name ?? '').trim() || null),
    startDate,
    endDate,
    isActive,
    daysRunning,
    collationCount: typeof item.collation_count === 'number' ? item.collation_count : null,
    euReach: typeof aaa.eu_total_reach === 'number' ? aaa.eu_total_reach : null,
    primaryText: text(s.body) ?? text(card?.body),
    headline: text(s.title) ?? text(card?.title),
    ctaText: text(s.cta_text) ?? text(card?.cta_text),
    linkUrl: text(s.link_url) ?? text(card?.link_url),
    videoUrl: (v?.video_hd_url || v?.video_sd_url || null) as string | null,
    posterUrl: (v?.video_preview_image_url || null) as string | null,
  };
}

export class ApifyAdLibraryService implements AdLibraryService {
  private readonly log = new Logger('AdLibrary');
  private cache: { at: number; ttl: number; value: Status } | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly costs: CostStore,
    private readonly opts: ApifyAdLibraryOptions,
  ) {
    this.f = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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
      // checagem falhou (rede/5xx): não trava a tela; o resolve() falha explícito se a Apify estiver mesmo fora
      this.log.warn(`apify limits: ${(e as Error).message}`);
      value = { available: true, reason: null, retryAfter: null };
      ttl = 60_000;
    }
    this.cache = { at: t, ttl, value };
    return value;
  }

  async resolve(i: { workspaceId: string; championId: string; jobId: string; url: string }): Promise<Resolved & Usage> {
    if (!this.opts.token) throw unavailable('not_configured', null, 'APIFY_TOKEN is empty in api/.env');
    const st = await this.status();
    if (!st.available && st.reason) throw unavailable(st.reason, st.retryAfter, `apify ${st.reason}`);
    const adId = adIdOf(i.url);
    if (!adId) throw new IntegracaoError('AD_NOT_FOUND', 'no ?id= in the Ad Library url');

    const actor = (this.opts.actor || DEFAULT_AD_LIBRARY_ACTOR).replace('/', '~');
    const input = { urls: [{ url: `https://www.facebook.com/ads/library/?id=${adId}` }], count: 1, scrapeAdDetails: true };
    let run = await this.startRun(actor, input);
    const deadline = this.now() + (this.opts.waitTotalMs ?? 180_000);
    while (!TERMINAL.has(run.status) && this.now() < deadline) {
      const wait = Math.max(1, Math.min(60, Math.ceil((deadline - this.now()) / 1000)));
      const res = await this.api('GET', `/actor-runs/${run.id}?waitForFinish=${wait}`).catch(() => null);
      if (res?.ok) run = (((await res.json()) as Raw).data ?? run) as Run;
      else await this.sleep(2000);
    }
    if (!TERMINAL.has(run.status)) {
      await this.api('POST', `/actor-runs/${run.id}/abort`).catch(() => null);
      run = await this.readRun(run.id).catch(() => run);
      await this.charge(i, run);
      throw unavailable('provider_error', null, `apify run ${run.id} did not finish in time`);
    }
    const costUsd = await this.charge(i, run);
    if (run.status !== 'SUCCEEDED') throw unavailable('provider_error', null, `apify run ${run.id} ${run.status}`);

    const res = await this.api('GET', `/datasets/${run.defaultDatasetId}/items?clean=true`);
    if (!res.ok) throw unavailable('provider_error', null, `apify dataset HTTP ${res.status}`);
    const items = ((await res.json()) as Raw[]).filter((x) => x && typeof x === 'object');
    const item = items.find((x) => String(x.ad_archive_id ?? x.adArchiveID ?? '') === adId) ?? null;
    if (!item) throw new IntegracaoError('AD_NOT_FOUND', `ad ${adId} not in the actor output (${items.length} item(s))`);
    const meta = mapAdItem(item, this.now());
    if (!meta.videoUrl) throw new IntegracaoError('AD_HAS_NO_VIDEO', `ad ${adId} has no video`, { meta });
    return { ...meta, costUsd };
  }

  // ------------------------------------------------------------------

  private api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const sep = path.includes('?') ? '&' : '?';
    return this.f(`${APIFY_BASE}${path}${sep}token=${encodeURIComponent(this.opts.token)}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(75_000),
    });
  }

  private async startRun(actor: string, input: unknown): Promise<Run> {
    let res: Response;
    try {
      res = await this.api('POST', `/acts/${actor}/runs?memory=512&waitForFinish=60`, input);
    } catch (e) {
      throw unavailable('provider_error', null, `apify: ${(e as Error).message}`);
    }
    if (res.ok) return (((await res.json()) as Raw).data ?? {}) as Run;
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw unavailable('not_configured', null, 'apify token rejected');
    // 402 / 403 com limite do mês ("monthly usage hard limit exceeded"): teto da conta
    if (res.status === 402 || (res.status === 403 && /limit|usage|quota/i.test(body))) {
      this.cache = null;
      const st = await this.status().catch(() => null);
      throw unavailable('quota', st?.retryAfter ?? null, `apify ${res.status}: ${body.slice(0, 200)}`);
    }
    throw unavailable('provider_error', null, `apify ${res.status}: ${body.slice(0, 200)}`);
  }

  private async readRun(id: string): Promise<Run> {
    const res = await this.api('GET', `/actor-runs/${id}`);
    return (((await res.json()) as Raw).data ?? {}) as Run;
  }

  /** Custo real do run (usageTotalUsd da Apify), gravado mesmo quando o anúncio não serve. */
  private async charge(i: { workspaceId: string; championId: string; jobId: string }, run: Run): Promise<number> {
    const usd = Math.round((Number(run.usageTotalUsd) || 0) * 10000) / 10000;
    await this.costs.record({ workspaceId: i.workspaceId, championId: i.championId, jobId: i.jobId, provider: 'APIFY', kind: 'SCRAPE', model: this.opts.actor || DEFAULT_AD_LIBRARY_ACTOR, units: 1, unit: 'call', amountUsd: usd });
    return usd;
  }
}

interface Run {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT']);

/** Fim do ciclo de cobrança (endAt) → dia em que volta (AAAA-MM-DD). */
function nextDay(endAt: unknown): string | null {
  const t = typeof endAt === 'string' ? Date.parse(endAt) : NaN;
  return Number.isFinite(t) ? new Date(t + 1).toISOString().slice(0, 10) : null;
}

/** AD_LIBRARY_MODE=off: o link fica desligado, com motivo explícito. */
export class OffAdLibraryService implements AdLibraryService {
  async status(): Promise<Status> {
    return { available: false, reason: 'not_configured', retryAfter: null };
  }
  async resolve(): Promise<Resolved & Usage> {
    throw unavailable('not_configured', null, 'AD_LIBRARY_MODE=off');
  }
}
