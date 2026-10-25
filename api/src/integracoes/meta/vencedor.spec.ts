import type { MetaMetrics } from '@maquina/contratos';
import { metricsOf } from './mock.service';
import { DEFAULT_RULE, compareAds, medianCpaOf, minSpendIn, parseRates, ruleFromEnv, scoreAds, trendOf, verdictOf } from './vencedor';

const m = (spend: number, results: number, extra: Partial<Parameters<typeof metricsOf>[0]> = {}): MetaMetrics =>
  metricsOf({ spend, impressions: 10000, clicks: 200, results, resultType: 'omni_purchase', ...extra });
const ad = (spend: number, results: number, hook = 30) => ({ metrics: m(spend, results, { plays2s: hook * 100 }) });

describe('verdictOf (meta-v1 §5)', () => {
  it('0 elegíveis: tudo LOW_DATA, mediana null', () => {
    const r = verdictOf([ad(40, 5), ad(100, 2)], DEFAULT_RULE, 'USD');
    expect(r).toEqual({ verdicts: ['LOW_DATA', 'LOW_DATA'], medianCpa: null, eligibleCount: 0 });
  });
  it('1 elegível: WINNER (sem mediana que separe)', () => {
    const r = verdictOf([ad(200, 4), ad(10, 0)], DEFAULT_RULE, 'USD');
    expect(r.verdicts).toEqual(['WINNER', 'LOW_DATA']);
    expect(r.medianCpa).toBe(50);
  });
  it('2 elegíveis: os dois WINNER mesmo com CPA diferente', () => {
    const r = verdictOf([ad(200, 4), ad(300, 3)], DEFAULT_RULE, 'USD');
    expect(r.verdicts).toEqual(['WINNER', 'WINNER']);
    expect(r.medianCpa).toBe(75);
  });
  it('N elegíveis: cpa ≤ mediana = WINNER, acima = OK; mediana par = média dos 2 do meio', () => {
    const ads = [ad(420, 21), ad(380, 16), ad(310, 10), ad(260, 7), ad(40, 1)];
    const r = verdictOf(ads, DEFAULT_RULE, 'USD');
    expect(r.medianCpa).toBeCloseTo(27.375, 3);
    expect(r.verdicts).toEqual(['WINNER', 'WINNER', 'OK', 'OK', 'LOW_DATA']);
    expect(r.eligibleCount).toBe(4);
    expect(medianCpaOf(ads, DEFAULT_RULE, 'USD')).toBeCloseTo(27.375, 3);
  });
  it('sem pixel (link_click): mesma regra sobre custo por clique', () => {
    const ads = [{ metrics: m(80, 40, { resultType: 'link_click' }) }, { metrics: m(60, 10, { resultType: 'link_click' }) }, { metrics: m(70, 20, { resultType: 'link_click' }) }];
    const r = verdictOf(ads, DEFAULT_RULE, 'USD');
    expect(r.verdicts).toEqual(['WINNER', 'OK', 'WINNER']);
  });
  it('empate: cpa igual à mediana conta como WINNER; ordem desempata por hookRate e depois gasto', () => {
    const ads = [ad(100, 5, 20), ad(100, 5, 40), ad(300, 5, 10)];
    const r = verdictOf(ads, DEFAULT_RULE, 'USD');
    expect(r.verdicts).toEqual(['WINNER', 'WINNER', 'OK']);
    const sorted = [...ads.map((a, i) => ({ ...a, verdict: r.verdicts[i] }))].sort(compareAds);
    expect(sorted.map((a) => a.metrics.hookRate)).toEqual([40, 20, 10]);
  });
  it('moeda da conta: mínimo convertido pela META_USD_RATES; sem taxa = 1:1', () => {
    const rule = { ...DEFAULT_RULE, usdRates: parseRates('BRL=5.5, eur=0.92') };
    expect(minSpendIn('BRL', rule)).toBe(275);
    expect(minSpendIn('EUR', rule)).toBe(46);
    expect(minSpendIn('MXN', rule)).toBe(50);
    expect(verdictOf([ad(200, 5)], rule, 'BRL').verdicts).toEqual(['LOW_DATA']);
    expect(verdictOf([ad(280, 5)], rule, 'BRL').verdicts).toEqual(['WINNER']);
  });
  it('ruleFromEnv: lê as envs e cai no padrão com valor inválido', () => {
    const r = ruleFromEnv({ META_WINNER_MIN_SPEND_USD: '80', META_WINNER_MIN_RESULTS: 'abc', META_TREND_WORSE: '1.5', META_USD_RATES: 'BRL=5' } as NodeJS.ProcessEnv);
    expect(r).toEqual({ minSpendUsd: 80, minResults: 3, trendBetter: 0.85, trendWorse: 1.5, trendFreq: 3, usdRates: { BRL: 5 } });
  });
});

describe('trendOf (meta-v1 §5.2)', () => {
  const w = (spend: number, results: number, extra: Partial<Parameters<typeof metricsOf>[0]> = {}) => m(spend, results, { reach: 5000, ...extra });
  it('null por pouco dado: spend7d < minSpend/4', () => {
    expect(trendOf(w(10, 5), w(50, 5), DEFAULT_RULE, 'USD')).toBeNull();
  });
  it('null por anúncio novo: resultsPrev7d < 3 (ou results7d < 3)', () => {
    expect(trendOf(w(60, 5), w(0, 0), DEFAULT_RULE, 'USD')).toBeNull();
    expect(trendOf(w(60, 2), w(60, 5), DEFAULT_RULE, 'USD')).toBeNull();
  });
  it('WORKING: cpa7d ≤ 0,85 × anterior', () => {
    expect(trendOf(w(60, 6), w(60, 4), DEFAULT_RULE, 'USD')).toBe('WORKING'); // 10 vs 15
    expect(trendOf(w(85, 10), w(100, 10), DEFAULT_RULE, 'USD')).toBe('WORKING'); // 8,5 vs 10 (igual ao limite)
  });
  it('TIRING por CPA: cpa7d ≥ 1,25 × anterior', () => {
    expect(trendOf(w(100, 4), w(100, 5), DEFAULT_RULE, 'USD')).toBe('TIRING'); // 25 vs 20
  });
  it('TIRING por frequência ≥ 3 com CTR caindo ≥ 20 %', () => {
    const cur = m(100, 5, { impressions: 15000, reach: 5000, clicks: 150 }); // freq 3, ctr 1,0
    const prev = m(100, 5, { impressions: 10000, reach: 5000, clicks: 130 }); // ctr 1,3
    expect(trendOf(cur, prev, DEFAULT_RULE, 'USD')).toBe('TIRING');
    const curLowFreq = m(100, 5, { impressions: 10000, reach: 5000, clicks: 100 }); // freq 2
    expect(trendOf(curLowFreq, prev, DEFAULT_RULE, 'USD')).toBe('STEADY');
  });
  it('STEADY: o resto', () => {
    expect(trendOf(w(100, 5), w(100, 5), DEFAULT_RULE, 'USD')).toBe('STEADY');
    expect(trendOf(w(110, 5), w(100, 5), DEFAULT_RULE, 'USD')).toBe('STEADY'); // 22 vs 20 (+10 %)
  });
  it('scoreAds: aplica verdict + trend e ordena WINNER primeiro, gasto desc', () => {
    const ads = [
      { id: 'a', metrics: m(100, 5), metrics7d: w(60, 6), metricsPrev7d: w(60, 4) },
      { id: 'b', metrics: m(300, 5), metrics7d: w(100, 4), metricsPrev7d: w(100, 5) },
      { id: 'c', metrics: m(20, 1), metrics7d: w(20, 1), metricsPrev7d: w(0, 0) },
    ];
    const r = scoreAds(ads, DEFAULT_RULE, 'USD');
    expect(r.ads.map((a) => [a.id, a.verdict, a.trend])).toEqual([
      ['b', 'WINNER', 'TIRING'],
      ['a', 'WINNER', 'WORKING'],
      ['c', 'LOW_DATA', null],
    ]);
  });
});
