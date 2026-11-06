// ads-research-v1 C.9: envs do Ad Radar (bloco "Ad Radar" do api/.env.example). Leitura tipada e com padrão do contrato;
// valor inválido ou vazio = padrão. Lido a cada acesso (os testes trocam env entre casos).
import { Injectable } from '@nestjs/common';
import type { AccountAccess, ResearchMode } from '@maquina/contratos';

const env = (k: string): string => (process.env[k] ?? '').trim();
const num = (k: string, fallback: number, min = 0): number => {
  const raw = env(k);
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min ? v : fallback;
};
const int = (k: string, fallback: number, min = 0): number => Math.floor(num(k, fallback, min));

/**
 * `ADS_RESEARCH_MODE` (mock | live | off). Vazio = MOCK, sem seguir o INTEGRACOES_MODE (mesma regra da porta da maquina-ia:
 * o api/.env tem INTEGRACOES_MODE=live e um token Apify de outra conta; live só com ADS_RESEARCH_MODE=live explícito).
 */
export function researchMode(): ResearchMode {
  const v = env('ADS_RESEARCH_MODE').toLowerCase();
  return v === 'live' || v === 'off' ? v : 'mock';
}

@Injectable()
export class ResearchConfig {
  get mode(): ResearchMode { return researchMode(); }
  /** Coleta semanal: só em live e com `ADS_RESEARCH_CRON` ≠ off (padrão do .env.example = off). */
  get cronEnabled(): boolean {
    const v = env('ADS_RESEARCH_CRON').toLowerCase();
    return this.mode === 'live' && v !== '' && v !== 'off';
  }
  /** `ADS_RESEARCH_DISCOVERY=off` desliga só a descoberta automática (onboarding / Brain mudou); o botão segue. */
  get autoDiscoveryEnabled(): boolean { return env('ADS_RESEARCH_DISCOVERY').toLowerCase() !== 'off'; }

  get minScore(): number { return int('ADS_RESEARCH_MIN_SCORE', 50); }
  maxCompetitors(a: AccountAccess): number {
    return a === 'SAMPLE' ? int('ADS_RESEARCH_MAX_COMPETITORS_SAMPLE', 1) : a === 'INTERNAL' ? int('ADS_RESEARCH_MAX_COMPETITORS_INTERNAL', 15) : int('ADS_RESEARCH_MAX_COMPETITORS_PAID', 5);
  }
  /** SAMPLE não tem reserva (C.3). */
  reserveMax(a: AccountAccess): number { return a === 'SAMPLE' ? 0 : int('ADS_RESEARCH_RESERVE_MAX', 10); }
  maxAds(a: AccountAccess): number {
    return a === 'SAMPLE' ? int('ADS_RESEARCH_MAX_ADS_SAMPLE', 100, 10) : a === 'INTERNAL' ? int('ADS_RESEARCH_MAX_ADS_INTERNAL', 300, 10) : int('ADS_RESEARCH_MAX_ADS_PAID', 150, 10);
  }
  /** null = sem "Atualizar agora" (SAMPLE). */
  refreshHours(a: AccountAccess): number | null {
    return a === 'SAMPLE' ? null : a === 'INTERNAL' ? num('ADS_RESEARCH_REFRESH_HOURS_INTERNAL', 6, 0) : num('ADS_RESEARCH_REFRESH_HOURS_PAID', 24, 0);
  }
  get discoveryEveryDays(): number { return num('ADS_RESEARCH_DISCOVERY_EVERY_DAYS', 7); }
  get discoveryAutoEveryDays(): number { return num('ADS_RESEARCH_DISCOVERY_AUTO_EVERY_DAYS', 30); }
  /** Debounce da automática por Brain mudou (§2.1). */
  readonly brainDebounceMs = 24 * 3_600_000;

  get discoveryEstimateUsd(): number { return num('ADS_RESEARCH_DISCOVERY_ESTIMATE_USD', 0.15); }
  get discoveryMaxUsd(): number { return num('ADS_RESEARCH_DISCOVERY_MAX_USD', 0.3); }
  monthlyCapUsd(a: AccountAccess): number {
    return a === 'SAMPLE' ? num('ADS_RESEARCH_MONTHLY_CAP_USD_SAMPLE', 0.3) : a === 'INTERNAL' ? num('ADS_RESEARCH_MONTHLY_CAP_USD_INTERNAL', 10) : num('ADS_RESEARCH_MONTHLY_CAP_USD', 4);
  }
  get dailyGlobalUsd(): number { return num('ADS_RESEARCH_DAILY_GLOBAL_USD', 10); }
  get sampleDiscoveriesPerDay(): number { return int('ADS_RESEARCH_SAMPLE_DISCOVERIES_PER_DAY', 30); }
  get apifyConcurrency(): number { return Math.max(1, int('ADS_RESEARCH_APIFY_CONCURRENCY', 4, 1)); }

  get winnerDays(): number { return int('ADS_RESEARCH_WINNER_DAYS', 30, 1); }
  get winnerVersions(): number { return int('ADS_RESEARCH_WINNER_VERSIONS', 5, 1); }
  get newDays(): number { return int('ADS_RESEARCH_NEW_DAYS', 7, 1); }
  get retireDays(): number { return int('ADS_RESEARCH_RETIRE_DAYS', 30, 1); }
  get retentionDays(): number { return int('ADS_RESEARCH_RETENTION_DAYS', 90, 1); }
  get syncTimeoutMs(): number { return int('ADS_RESEARCH_SYNC_TIMEOUT_MS', 360_000, 1000); }

  /** Preço da Apify (R0): US$ 0,00075 por item + US$ 0,00005 por run. Base das estimativas de coleta. */
  readonly pricePerItemUsd = 0.00075;
  readonly pricePerRunUsd = 0.00005;
  /** Estimativa de uma coleta de `limit` itens (o teto confere com ela antes de pedir). */
  scrapeEstimateUsd(limit: number): number { return Math.round((limit * this.pricePerItemUsd + this.pricePerRunUsd) * 10_000) / 10_000; }
  /** Semanal/refresh/mídia: limite adaptativo `min(teto, lastActiveCount + 30)` (§3). */
  adaptiveLimit(a: AccountAccess, lastActiveCount: number): number { return Math.max(10, Math.min(this.maxAds(a), lastActiveCount + 30)); }
}
