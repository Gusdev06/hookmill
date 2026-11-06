import { IntegracaoError } from '../erros';
import { ApifyResearchService, OffResearchService, actorInput, formulaCost, maxChargeFor, researchUrl } from './research.service';

const ad = (id: string, pageId = 'p1') => ({ ad_archive_id: id, page_id: pageId, page_name: 'Page', is_active: true, snapshot: { display_format: 'IMAGE', images: [{ original_image_url: 'https://i/x.jpg' }] } });

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };
const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function makeFetch(h: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = h(url, init);
    return json(r.status, r.body);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const base = { token: 'tok', sleep: async () => undefined, settleMs: 0, concurrentRetryMs: 0 };
const input = { kind: 'KEYWORD' as const, query: 'daily prayer', searchType: 'exact_phrase' as const, countryCode: 'us', limit: 30, ref: 'sync-1' };

describe('ApifyResearchService (Ad Radar, live com fetch falso)', () => {
  it('monta o pedido da R1: frase exata, país, limite, maxTotalChargeUsd e Bearer; separa erro e relê o custo', async () => {
    let reads = 0;
    const { f, calls } = makeFetch((url, init) => {
      if (url.includes('/acts/') && init.method === 'POST') return { status: 201, body: { data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.00005 } } };
      if (url.includes('/datasets/ds1/items')) return { status: 200, body: [ad('1'), ad('2'), { error: 'x', errorCode: 'ADS_NOT_FOUND' }] };
      if (url.endsWith('/actor-runs/run1')) {
        reads++;
        return { status: 200, body: { data: { id: 'run1', status: 'SUCCEEDED', usageTotalUsd: 0.0023 } } };
      }
      throw new Error(`unexpected ${url}`);
    });
    const svc = new ApifyResearchService({ ...base, fetchImpl: f });
    const out = await svc.scrape(input);
    expect(out.items.map((x) => x.adArchiveId)).toEqual(['1', '2']);
    expect(out.errors).toEqual([{ code: 'ADS_NOT_FOUND', message: 'x' }]);
    expect(out).toMatchObject({ runId: 'run1', costUsd: 0.0023, itemsRaw: 3, actor: 'curious_coder~facebook-ads-library-scraper' });
    expect(reads).toBe(1);
    const start = calls[0];
    expect(start.url).toContain(`maxTotalChargeUsd=${maxChargeFor(30)}`);
    expect(start.url).not.toContain('token=');
    expect((start.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(String(start.init.body));
    expect(body).toMatchObject({ limitPerSource: 30, count: 30, scrapeAdDetails: false, 'scrapePageAds.countryCode': 'US', 'scrapePageAds.activeStatus': 'active' });
    expect(decodeURIComponent(body.urls[0].url)).toContain('q="daily prayer"&search_type=keyword_exact_phrase');
  });

  it('custo que não assentou (abaixo da metade da fórmula) grava a fórmula da R0', async () => {
    const { f } = makeFetch((url, init) => {
      if (init.method === 'POST') return { status: 201, body: { data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } } };
      if (url.includes('/datasets/')) return { status: 200, body: Array.from({ length: 10 }, (_, k) => ad(String(k))) };
      return { status: 200, body: { data: { usageTotalUsd: 0.00005 } } };
    });
    const out = await new ApifyResearchService({ ...base, fetchImpl: f }).scrape({ ...input, limit: 3 });
    expect(out.costUsd).toBe(formulaCost(10));
  });

  it('402 concurrent-runs: tenta de novo; esgotou = RETRYABLE', async () => {
    let n = 0;
    const { f } = makeFetch((url, init) => {
      if (init.method === 'POST') {
        n++;
        return n < 3 ? { status: 402, body: '{"error":{"type":"concurrent-runs-limit-exceeded"}}' } : { status: 201, body: { data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } } };
      }
      if (url.includes('/datasets/')) return { status: 200, body: [] };
      return { status: 200, body: { data: { usageTotalUsd: 0.00005 } } };
    });
    const ok = await new ApifyResearchService({ ...base, fetchImpl: f, concurrentRetries: 5 }).scrape(input);
    expect(ok.items).toEqual([]);
    expect(n).toBe(3);

    const always = makeFetch(() => ({ status: 402, body: 'concurrent-runs-limit-exceeded' }));
    await expect(new ApifyResearchService({ ...base, fetchImpl: always.f, concurrentRetries: 2 }).scrape(input)).rejects.toMatchObject({ code: 'RETRYABLE' });
    expect(always.calls.filter((c) => c.init.method === 'POST')).toHaveLength(3);
  });

  it('402 de teto do mês = AD_LIBRARY_UNAVAILABLE quota; 401 = not_configured; sem token = not_configured', async () => {
    const quota = makeFetch((url) => (url.includes('/users/me/limits')
      ? { status: 200, body: { data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 5 }, monthlyUsageCycle: { endAt: '2026-11-28T23:59:59.999Z' } } } }
      : { status: 402, body: 'monthly usage hard limit exceeded' }));
    await expect(new ApifyResearchService({ ...base, fetchImpl: quota.f }).scrape(input)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota', retryAfter: '2026-11-29' } });
    const bad = makeFetch(() => ({ status: 401, body: 'no' }));
    await expect(new ApifyResearchService({ ...base, fetchImpl: bad.f }).scrape(input)).rejects.toMatchObject({ details: { reason: 'not_configured' } });
    await expect(new ApifyResearchService({ ...base, token: '' }).scrape(input)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'not_configured' } });
    expect(await new ApifyResearchService({ ...base, token: '' }).status()).toEqual({ available: false, reason: 'not_configured', retryAfter: null });
  });

  it('run FAILED = PROVIDER_ERROR com o custo em details; tempo esgotado = aborta e PROVIDER_TIMEOUT', async () => {
    const failed = makeFetch((url, init) => {
      if (init.method === 'POST') return { status: 201, body: { data: { id: 'r', status: 'FAILED', defaultDatasetId: 'd' } } };
      if (url.includes('/datasets/')) return { status: 200, body: [ad('1')] };
      return { status: 200, body: { data: { usageTotalUsd: 0.0008 } } };
    });
    const e = await new ApifyResearchService({ ...base, fetchImpl: failed.f }).scrape(input).catch((x) => x);
    expect(e).toBeInstanceOf(IntegracaoError);
    expect(e).toMatchObject({ code: 'PROVIDER_ERROR', details: { runId: 'r', costUsd: 0.0008 } });

    let t = 0;
    const slow = makeFetch((url, init) => {
      if (url.includes('/abort')) return { status: 200, body: {} };
      if (init.method === 'POST') return { status: 201, body: { data: { id: 'r', status: 'RUNNING', defaultDatasetId: 'd' } } };
      if (url.includes('waitForFinish')) {
        t += 100_000;
        return { status: 200, body: { data: { id: 'r', status: 'RUNNING', defaultDatasetId: 'd' } } };
      }
      if (url.includes('/datasets/')) return { status: 200, body: [] };
      return { status: 200, body: { data: { usageTotalUsd: 0.00005 } } };
    });
    await expect(new ApifyResearchService({ ...base, fetchImpl: slow.f, now: () => t, timeoutMs: 250_000 }).scrape(input)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(slow.calls.some((c) => c.url.includes('/actor-runs/r/abort'))).toBe(true);
  });

  it('no máximo `concurrency` runs ao mesmo tempo', async () => {
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const f = (async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((r) => releases.push(r));
        running--;
        return json(201, { data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } });
      }
      if (url.includes('/datasets/')) return json(200, []);
      return json(200, { data: { usageTotalUsd: 0.00005 } });
    }) as unknown as typeof fetch;
    const svc = new ApifyResearchService({ ...base, fetchImpl: f, concurrency: 2 });
    let done = 0;
    const all = Promise.all(Array.from({ length: 5 }, (_, k) => svc.scrape({ ...input, ref: `s${k}` }).then(() => done++)));
    while (done < 5) {
      await new Promise((r) => setTimeout(r, 2));
      releases.shift()?.();
    }
    await all;
    expect(peak).toBe(2);
  });

  it('URL de Página e limite mínimo 10', () => {
    expect(researchUrl({ kind: 'PAGE', query: '531203563996048', countryCode: 'br' })).toContain('country=BR');
    expect(researchUrl({ kind: 'PAGE', query: '531203563996048', countryCode: 'br' })).toContain('view_all_page_id=531203563996048');
    expect(researchUrl({ kind: 'KEYWORD', query: 'hallow.com', countryCode: 'US' })).toContain('search_type=keyword_unordered');
    expect(actorInput({ ...input, kind: 'PAGE', query: '1' }, 10)).toMatchObject({ limitPerSource: 10, count: 10 });
    expect(maxChargeFor(150)).toBe(0.136);
  });

  it('off: indisponível com motivo', async () => {
    const off = new OffResearchService();
    expect(await off.status()).toEqual({ available: false, reason: 'not_configured', retryAfter: null });
    await expect(off.scrape()).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE' });
  });
});
