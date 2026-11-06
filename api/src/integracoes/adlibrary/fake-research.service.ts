// ads-research-v1 (Ad Radar), C.8: AdLibraryResearchService do modo mock (ADS_RESEARCH_MODE=mock). Mundo em mock-radar.ts.
// Custo fake (pra exercitar os tetos): US$ 0,008 por sonda D2 (KEYWORD unordered), 0,023 por D3 (exact_phrase),
// fórmula da R0 na coleta de Página (itens × 0,00075 + 0,00005). `zeroCost: true` zera tudo.
// Gatilhos: query com "mock-quota" → AD_LIBRARY_UNAVAILABLE quota; Página mock-empty / mock-suspect (3) / mock-gone
// (PAGE_PRIVATE, cobrado como 1 item) / mock-big (300, cortado pelo limite).
import type { AdLibraryResearchService, ResearchScrapeInput, ResearchScrapeResult } from '../contrato';
import { IntegracaoError } from '../erros';
import { MOCK_QUOTA_RETRY_AFTER, mockAd, mockScrapePlan } from './mock-radar';
import { RESEARCH_MIN_LIMIT, formulaCost } from './research.service';

export const MOCK_RESEARCH_COST = { d2: 0.008, d3: 0.023 } as const;

export interface FakeResearchOptions {
  publicApiUrl: string;
  /** espera simulada por coleta (padrão 300 ms; testes 0) */
  stepMs?: number;
  zeroCost?: boolean;
  now?: () => number;
}

export class FakeResearchService implements AdLibraryResearchService {
  private runs = 0;
  constructor(private readonly opts: FakeResearchOptions) {}

  async status() {
    return { available: true, reason: null, retryAfter: null };
  }

  async scrape(i: ResearchScrapeInput): Promise<ResearchScrapeResult> {
    const plan = mockScrapePlan(i);
    if (plan.quota) throw new IntegracaoError('AD_LIBRARY_UNAVAILABLE', 'mock quota', { reason: 'quota', retryAfter: MOCK_QUOTA_RETRY_AFTER });
    const ms = this.opts.stepMs ?? 300;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    const limit = Math.max(RESEARCH_MIN_LIMIT, Math.floor(i.limit || 0));
    const now = (this.opts.now ?? Date.now)();
    const items = [];
    for (const p of plan.pages) {
      for (let k = 0; k < p.count && items.length < limit; k++) {
        items.push({ ...mockAd({ pageId: p.pageId, name: p.name, k, publicApiUrl: this.opts.publicApiUrl, now }), searchTerm: i.kind === 'KEYWORD' ? i.query.trim().replace(/^"(.*)"$/, '$1') : null });
      }
    }
    const itemsRaw = items.length + plan.errors.length;
    let costUsd = 0;
    if (!this.opts.zeroCost) {
      if (i.kind === 'PAGE') costUsd = formulaCost(itemsRaw);
      else costUsd = i.searchType === 'exact_phrase' ? MOCK_RESEARCH_COST.d3 : MOCK_RESEARCH_COST.d2;
    }
    this.runs++;
    return { items, errors: plan.errors, runId: `mock-run-${this.runs}-${i.ref}`, costUsd, itemsRaw, actor: 'mock' };
  }
}
