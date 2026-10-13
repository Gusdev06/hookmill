// AdLibraryService do modo mock (AD_LIBRARY_MODE=mock), gatilhos da §4.6 do contrato da feature 2:
//   url com "mock-ad-unavailable" → AD_LIBRARY_UNAVAILABLE { reason: 'quota', retryAfter: '2026-10-19' } (na hora, sem espera)
//   url com "mock-ad-notfound"    → AD_NOT_FOUND
//   url com "mock-ad-novideo"     → AD_HAS_NO_VIDEO
//   qualquer outro ?id=           → resolve com vídeo sintético de 20 s com fala (mídia mock local)
// Custo zero, mas grava a cost_entry (APIFY/SCRAPE, US$ 0) pelo mesmo caminho do live.
import type { AdLibraryMeta, AdLibraryService, Usage } from '../contrato';
import { IntegracaoError } from '../erros';
import type { CostStore } from '../portas';
import { mockMediaUrl, seedOf } from '../mock/midia';
import { adIdOf } from './ad-library.service';

type Resolved = Omit<AdLibraryMeta, 'status' | 'fetchedAt'> & { videoUrl: string | null; posterUrl: string | null };

export const MOCK_AD_QUOTA_RETRY_AFTER = '2026-10-19';

export class FakeAdLibraryService implements AdLibraryService {
  constructor(
    private readonly costs: CostStore,
    private readonly opts: { publicApiUrl: string; stepMs?: number },
  ) {}

  async status() {
    return { available: true, reason: null, retryAfter: null };
  }

  async resolve(i: { workspaceId: string; championId: string; jobId: string; url: string }): Promise<Resolved & Usage> {
    if (i.url.includes('mock-ad-unavailable')) throw new IntegracaoError('AD_LIBRARY_UNAVAILABLE', 'mock quota', { reason: 'quota', retryAfter: MOCK_AD_QUOTA_RETRY_AFTER });
    const ms = this.opts.stepMs ?? 300;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    await this.costs.record({ workspaceId: i.workspaceId, championId: i.championId, jobId: i.jobId, provider: 'APIFY', kind: 'SCRAPE', model: 'mock', units: 1, unit: 'call', amountUsd: 0 });
    if (i.url.includes('mock-ad-notfound')) throw new IntegracaoError('AD_NOT_FOUND', 'mock: ad not found');
    const id = adIdOf(i.url) ?? '1000000000000000';
    const seed = seedOf('adlibrary', id);
    const meta: Resolved = {
      adArchiveId: id,
      pageName: 'Mock Page',
      startDate: '2026-09-06',
      endDate: null,
      isActive: true,
      daysRunning: 30,
      collationCount: 3,
      euReach: null,
      primaryText: 'Mock primary text from the Ad Library.',
      headline: 'Mock headline',
      ctaText: 'Learn more',
      linkUrl: 'https://example.com/offer',
      videoUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed, format: 'VERTICAL_9_16', sec: 20 }),
      posterUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'face', seed }),
    };
    if (i.url.includes('mock-ad-novideo')) throw new IntegracaoError('AD_HAS_NO_VIDEO', 'mock: ad has no video', { meta: { ...meta, videoUrl: null, posterUrl: null } });
    return { ...meta, costUsd: 0 };
  }
}
