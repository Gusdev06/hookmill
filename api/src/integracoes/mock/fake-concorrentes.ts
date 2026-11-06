// ads-research-v1 (Ad Radar), C.8: D1/D4 determinísticos pelo `industry` do Brain (mundo em adlibrary/mock-radar.ts).
// Usado pelo FakeClaudeService e enxertado no ClaudeService real quando ADS_RESEARCH_MODE=mock e INTEGRACOES_MODE=live
// (o Ad Radar fica em mock sem gastar Claude). Custo fake US$ 0,02 por chamada (exercita os tetos); `costUsd: 0` zera.
// Gatilhos: mock-discovery-fail (D1 falha PROVIDER_ERROR) · mock-slow (D1 espera `slowMs`, padrão 20 s) ·
// mock-only-adjacent (D4 marca tudo que não é none como vizinho) · os outros vêm do mundo (mockProposal/mockScrapePlan).
import type { CompetitorAiPort, JudgeCompetitorsInput, JudgeCompetitorsResult, ProposeCompetitorsInput, ProposeCompetitorsResult, ResearchLlmUsage } from '../contrato';
import { IntegracaoError } from '../erros';
import { MOCK_TRIGGERS, hasTrigger, mockPage, mockProposal } from '../adlibrary/mock-radar';
import { RESEARCH_MAX_JUDGE_PAGES, bareDomain } from '../claude/concorrentes';

export const MOCK_RESEARCH_LLM_USD = 0.02;

export interface FakeCompetitorAiOptions {
  /** custo fake por chamada (padrão 0,02) */
  costUsd?: number;
  /** espera do gatilho mock-slow (padrão 20 s) */
  slowMs?: number;
  /** pausa por chamada (padrão 150 ms; testes 0) */
  stepMs?: number;
}

const COUNTRY: [RegExp, string][] = [[/bra[sz]il/i, 'BR'], [/portugal/i, 'PT'], [/m[eé]xico/i, 'MX'], [/united kingdom|\buk\b|england/i, 'GB'], [/canada/i, 'CA'], [/spain|espa[nñ]a/i, 'ES']];

export class FakeCompetitorAi implements CompetitorAiPort {
  constructor(private readonly opts: FakeCompetitorAiOptions = {}) {}

  async proposeCompetitors(i: ProposeCompetitorsInput): Promise<ProposeCompetitorsResult> {
    const industry = i.brain.industry;
    if (hasTrigger(industry, MOCK_TRIGGERS.slow)) await sleep(this.opts.slowMs ?? 20_000);
    else await sleep(this.opts.stepMs ?? 150);
    if (hasTrigger(industry, MOCK_TRIGGERS.discoveryFail)) throw new IntegracaoError('PROVIDER_ERROR', 'mock discovery failure');
    const second = i.reuseTerms.length > 0;
    const { brands, terms } = mockProposal(industry, second);
    const blockedDomains = i.blocked.domains.map((d) => bareDomain(d) ?? d.toLowerCase());
    const blockedNames = i.blocked.pageNames.map((n) => n.toLowerCase());
    const reuse = new Set(i.reuseTerms.map((t) => t.toLowerCase()));
    const market = i.brain.market ?? '';
    const countryCode = COUNTRY.find(([re]) => re.test(market))?.[1] ?? 'US';
    return {
      countryCode,
      countryReason: market ? `Mercado informado: ${market}.` : 'Sem mercado informado: padrão US.',
      brands: brands.filter((b) => !blockedDomains.includes(b.domain) && !blockedNames.includes(b.brand.toLowerCase())).slice(0, Math.max(0, i.maxBrands)),
      terms: terms.filter((t) => !reuse.has(t.term.toLowerCase())),
      ...this.usage('claude-sonnet-5-5'),
    };
  }

  async judgeCompetitors(i: JudgeCompetitorsInput): Promise<JudgeCompetitorsResult> {
    await sleep(this.opts.stepMs ?? 150);
    const onlyAdjacent = hasTrigger(i.brain.industry, MOCK_TRIGGERS.onlyAdjacent);
    const items = i.pages.slice(0, RESEARCH_MAX_JUDGE_PAGES).map((p) => {
      const known = mockPage(p.pageId);
      if (p.suspectDisposable) return { pageId: p.pageId, relation: 'none' as const, score: Math.min(known?.score ?? 10, 40), reason: 'Página com cara de descartável: fora.' };
      if (!known) return { pageId: p.pageId, relation: 'none' as const, score: 10, reason: 'Anunciante solto, sem ligação clara com a oferta.' };
      const relation = onlyAdjacent && known.relation !== 'none' ? ('adjacent' as const) : known.relation;
      return { pageId: p.pageId, relation, score: known.score, reason: relation === 'adjacent' && known.relation === 'direct' ? 'Mesmo público com produto vizinho (mock-only-adjacent).' : known.reason };
    });
    return { items, ...this.usage('claude-haiku-4-5') };
  }

  private usage(model: string): ResearchLlmUsage {
    const usd = this.opts.costUsd ?? MOCK_RESEARCH_LLM_USD;
    return { model: `mock:${model}`, inputKtok: 0, outputKtok: 0, inputUsd: usd, outputUsd: 0, costUsd: usd };
  }
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
