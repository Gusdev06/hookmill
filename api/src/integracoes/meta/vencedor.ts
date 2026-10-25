// Regra de vencedor e tendência (meta-v1.md §5 e §5.2): funções puras, sem rede, sem banco. O backend pode recalcular
// sobre snapshots com a mesma função. Limites vêm da env (ruleFromEnv).
import type { MetaAdTrend, MetaAdVerdict, MetaMetrics } from '@maquina/contratos';
import type { MetaWinnerRule } from '../contrato';

export const DEFAULT_RULE: MetaWinnerRule = { minSpendUsd: 50, minResults: 3, trendBetter: 0.85, trendWorse: 1.25, trendFreq: 3, usdRates: {} };

export function ruleFromEnv(env: NodeJS.ProcessEnv = process.env): MetaWinnerRule {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    minSpendUsd: num(env.META_WINNER_MIN_SPEND_USD, DEFAULT_RULE.minSpendUsd),
    minResults: num(env.META_WINNER_MIN_RESULTS, DEFAULT_RULE.minResults),
    trendBetter: num(env.META_TREND_BETTER, DEFAULT_RULE.trendBetter),
    trendWorse: num(env.META_TREND_WORSE, DEFAULT_RULE.trendWorse),
    trendFreq: num(env.META_TREND_FREQ, DEFAULT_RULE.trendFreq),
    usdRates: parseRates(env.META_USD_RATES),
  };
}

/** "BRL=5.5,EUR=0.92" → { BRL: 5.5, EUR: 0.92 } (unidades da moeda por 1 USD). */
export function parseRates(s: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (s ?? '').split(',')) {
    const [cur, val] = part.split('=').map((x) => x.trim());
    const n = Number(val);
    if (cur && Number.isFinite(n) && n > 0) out[cur.toUpperCase()] = n;
  }
  return out;
}

/** Mínimo de gasto da regra na moeda da conta (1:1 sem taxa). */
export function minSpendIn(currency: string | null | undefined, rule: MetaWinnerRule): number {
  const rate = currency ? rule.usdRates[currency.toUpperCase()] : undefined;
  return rule.minSpendUsd * (rate ?? 1);
}

export function isEligible(m: MetaMetrics, rule: MetaWinnerRule, currency: string | null | undefined): boolean {
  return m.spend >= minSpendIn(currency, rule) && m.results >= rule.minResults && m.cpa != null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Mediana do CPA dos elegíveis (30 d). */
export function medianCpaOf(ads: { metrics: MetaMetrics }[], rule: MetaWinnerRule, currency: string | null | undefined): number | null {
  return median(ads.filter((a) => isEligible(a.metrics, rule, currency)).map((a) => a.metrics.cpa as number));
}

/**
 * §5: WINNER = elegível com cpa ≤ mediana dos elegíveis (1-2 elegíveis: todos WINNER); OK = elegível acima; LOW_DATA = resto.
 * Sem pixel, `cpa` já é custo por clique (resultType link_click): a regra é a mesma.
 */
export function verdictOf<T extends { metrics: MetaMetrics }>(ads: T[], rule: MetaWinnerRule, currency: string | null | undefined): { verdicts: MetaAdVerdict[]; medianCpa: number | null; eligibleCount: number } {
  const eligible = ads.map((a) => isEligible(a.metrics, rule, currency));
  const eligibleCount = eligible.filter(Boolean).length;
  const medianCpa = median(ads.filter((_, i) => eligible[i]).map((a) => a.metrics.cpa as number));
  const verdicts = ads.map<MetaAdVerdict>((a, i) => {
    if (!eligible[i]) return 'LOW_DATA';
    if (eligibleCount <= 2 || medianCpa == null) return 'WINNER';
    return (a.metrics.cpa as number) <= medianCpa ? 'WINNER' : 'OK';
  });
  return { verdicts, medianCpa, eligibleCount };
}

/** Ordem padrão da lista: WINNER primeiro, depois gasto desc; desempate hookRate desc, depois spend desc. */
export function compareAds(a: { verdict: MetaAdVerdict; metrics: MetaMetrics }, b: { verdict: MetaAdVerdict; metrics: MetaMetrics }): number {
  const rank: Record<MetaAdVerdict, number> = { WINNER: 0, OK: 1, LOW_DATA: 2 };
  if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
  if (b.metrics.spend !== a.metrics.spend) return b.metrics.spend - a.metrics.spend;
  return (b.metrics.hookRate ?? -1) - (a.metrics.hookRate ?? -1);
}

/**
 * §5.2: null por dado insuficiente (spend7d < minSpend/4, results7d < 3, resultsPrev7d < 3);
 * WORKING = cpa7d ≤ better × cpaPrev; TIRING = cpa7d ≥ worse × cpaPrev OU (frequency7d ≥ freq E ctr7d ≤ 0,8 × ctrPrev); STEADY = resto.
 */
export function trendOf(m7d: MetaMetrics, mPrev7d: MetaMetrics, rule: MetaWinnerRule, currency: string | null | undefined): MetaAdTrend | null {
  if (m7d.spend < minSpendIn(currency, rule) / 4) return null;
  if (m7d.results < rule.minResults || mPrev7d.results < rule.minResults) return null;
  if (m7d.cpa == null || mPrev7d.cpa == null || mPrev7d.cpa <= 0) return null;
  if (m7d.cpa <= rule.trendBetter * mPrev7d.cpa) return 'WORKING';
  if (m7d.cpa >= rule.trendWorse * mPrev7d.cpa) return 'TIRING';
  if ((m7d.frequency ?? 0) >= rule.trendFreq && mPrev7d.ctr > 0 && m7d.ctr <= 0.8 * mPrev7d.ctr) return 'TIRING';
  return 'STEADY';
}

/** Aplica verdict + trend numa lista crua (saída do sync). */
export function scoreAds<T extends { metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics }>(ads: T[], rule: MetaWinnerRule, currency: string | null | undefined): { ads: (T & { verdict: MetaAdVerdict; trend: MetaAdTrend | null })[]; medianCpa: number | null; eligibleCount: number } {
  const { verdicts, medianCpa, eligibleCount } = verdictOf(ads, rule, currency);
  const scored = ads.map((a, i) => ({ ...a, verdict: verdicts[i], trend: trendOf(a.metrics7d, a.metricsPrev7d, rule, currency) }));
  scored.sort(compareAds);
  return { ads: scored, medianCpa, eligibleCount };
}

/**
 * campanhas-v1 D2 (22/10): o sync guarda TODOS os formatos, mas a régua é só de vídeo. A mediana (e o "1-2 elegíveis =
 * todos WINNER") sai dos anúncios de vídeo (`videoId != null`); os outros formatos recebem veredito contra essa MESMA
 * régua, só pra aparecerem com chip na Campaigns. Assim Home, tour e Pick from Meta ficam idênticos.
 */
export function scoreAllAds<T extends { videoId: string | null; metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics }>(ads: T[], rule: MetaWinnerRule, currency: string | null | undefined): { ads: (T & { verdict: MetaAdVerdict; trend: MetaAdTrend | null })[]; medianCpa: number | null; eligibleCount: number } {
  const videos = ads.filter((a) => a.videoId != null);
  const { medianCpa, eligibleCount } = verdictOf(videos, rule, currency);
  const scored = ads.map((a) => {
    let verdict: MetaAdVerdict = 'LOW_DATA';
    if (isEligible(a.metrics, rule, currency)) verdict = eligibleCount <= 2 || medianCpa == null ? 'WINNER' : (a.metrics.cpa as number) <= medianCpa ? 'WINNER' : 'OK';
    return { ...a, verdict, trend: trendOf(a.metrics7d, a.metricsPrev7d, rule, currency) };
  });
  scored.sort(compareAds);
  return { ads: scored, medianCpa, eligibleCount };
}
