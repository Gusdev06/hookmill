// meta-v1.md §5 (vencedor, tendência, mediana) com números fechados, visto do backend: a regra da porta aplicada a
// snapshots, a soma do sumário (aggregate), a ordem padrão da lista, o mapa MetaError → HTTP e o mercado → país.
import type { MetaMetrics } from '@maquina/contratos';
import type { MetaAdSnapshot } from '@prisma/client';
import { MetaError, compareAds, medianCpaOf, trendOf, verdictOf, type MetaWinnerRule } from '../integracoes';
import { asMetaAsyncCode, countriesOf, metaActionOf, metricsOf, toHttp } from './comum';
import { aggregate, presentAd } from './sync.service';

const RULE: MetaWinnerRule = { minSpendUsd: 50, minResults: 3, trendBetter: 0.85, trendWorse: 1.25, trendFreq: 3, usdRates: { BRL: 5 } };
const m = (spend: number, results: number, over: Partial<MetaMetrics> = {}): MetaMetrics => ({
  spend, impressions: 10_000, clicks: 100, ctr: 1, results, resultType: 'omni_purchase', cpa: results ? spend / results : null,
  roas: null, plays2s: null, hookRate: null, thruplays: null, frequency: null, ...over,
});

describe('regra de vencedor (§5)', () => {
  it('elegível = gasto ≥ 50 e ≥ 3 resultados; WINNER = cpa ≤ mediana (4 elegíveis: mediana 27,5)', () => {
    const ads = [
      { metrics: m(400, 20) },          // cpa 20
      { metrics: m(380, 16) },          // cpa 23,75
      { metrics: m(310, 10) },          // cpa 31
      { metrics: m(260, 7) },           // cpa 37,14
      { metrics: m(40, 1) },            // gasto < 50 → LOW_DATA
      { metrics: m(60, 2) },            // 2 resultados → LOW_DATA
    ];
    const r = verdictOf(ads, RULE, 'USD');
    expect(r.eligibleCount).toBe(4);
    expect(r.medianCpa).toBe(27.375);
    expect(r.verdicts).toEqual(['WINNER', 'WINNER', 'OK', 'OK', 'LOW_DATA', 'LOW_DATA']);
    expect(medianCpaOf(ads, RULE, 'USD')).toBe(27.375);
  });

  it('1 ou 2 elegíveis: todos WINNER (não há mediana que separe); nenhum elegível: mediana null', () => {
    expect(verdictOf([{ metrics: m(100, 3) }, { metrics: m(500, 4) }], RULE, 'USD').verdicts).toEqual(['WINNER', 'WINNER']);
    expect(verdictOf([{ metrics: m(100, 3) }], RULE, 'USD').verdicts).toEqual(['WINNER']);
    const none = verdictOf([{ metrics: m(10, 1) }], RULE, 'USD');
    expect(none).toMatchObject({ verdicts: ['LOW_DATA'], medianCpa: null, eligibleCount: 0 });
  });

  it('moeda da conta: BRL=5 → mínimo de gasto 250 BRL; sem taxa = 1:1', () => {
    expect(verdictOf([{ metrics: m(200, 5) }], RULE, 'BRL').verdicts).toEqual(['LOW_DATA']);
    expect(verdictOf([{ metrics: m(260, 5) }], RULE, 'BRL').verdicts).toEqual(['WINNER']);
    expect(verdictOf([{ metrics: m(60, 5) }], RULE, 'EUR').verdicts).toEqual(['WINNER']);
  });

  it('sem pixel (resultado = clique): a mesma regra sobre o custo por clique', () => {
    const click = (spend: number, clicks: number) => m(spend, clicks, { resultType: 'link_click', clicks });
    expect(verdictOf([{ metrics: click(80, 40) }, { metrics: click(90, 10) }, { metrics: click(70, 20) }], RULE, 'USD').verdicts).toEqual(['WINNER', 'OK', 'WINNER']);
  });

  it('ordem padrão: WINNER primeiro, depois gasto desc; desempate por hookRate', () => {
    const rows = [
      { verdict: 'OK' as const, metrics: m(900, 10) },
      { verdict: 'WINNER' as const, metrics: m(100, 5, { hookRate: 20 }) },
      { verdict: 'WINNER' as const, metrics: m(100, 5, { hookRate: 35 }) },
      { verdict: 'LOW_DATA' as const, metrics: m(10, 0) },
      { verdict: 'WINNER' as const, metrics: m(300, 10) },
    ];
    expect([...rows].sort(compareAds).map((r) => `${r.verdict}:${r.metrics.spend}:${r.metrics.hookRate ?? '-'}`)).toEqual([
      'WINNER:300:-', 'WINNER:100:35', 'WINNER:100:20', 'OK:900:-', 'LOW_DATA:10:-',
    ]);
  });
});

describe('tendência (§5.2)', () => {
  const win = (spend: number, results: number, over: Partial<MetaMetrics> = {}) => m(spend, results, { frequency: 1.5, ...over });
  it('dado insuficiente → null: gasto 7 d < 12,50; < 3 resultados na semana ou na anterior (anúncio novo)', () => {
    expect(trendOf(win(10, 5), win(100, 5), RULE, 'USD')).toBeNull();
    expect(trendOf(win(100, 2), win(100, 5), RULE, 'USD')).toBeNull();
    expect(trendOf(win(100, 5), win(0, 0), RULE, 'USD')).toBeNull(); // sem semana anterior
  });
  it('WORKING: cpa7d ≤ 0,85 × anterior (25 → 20 = 0,8)', () => {
    expect(trendOf(win(100, 5), win(100, 4), RULE, 'USD')).toBe('WORKING');
  });
  it('TIRING por CPA: ≥ 1,25 × anterior (20 → 30 = 1,5); STEADY entre os dois (20 → 22 = 1,1)', () => {
    expect(trendOf(win(120, 4), win(100, 5), RULE, 'USD')).toBe('TIRING');
    expect(trendOf(win(110, 5), win(100, 5), RULE, 'USD')).toBe('STEADY');
  });
  it('TIRING por frequência: freq ≥ 3 e ctr ≤ 0,8 × anterior, mesmo com CPA estável', () => {
    expect(trendOf(win(100, 5, { frequency: 3.2, ctr: 0.7 }), win(100, 5, { ctr: 1 }), RULE, 'USD')).toBe('TIRING');
    expect(trendOf(win(100, 5, { frequency: 3.2, ctr: 0.9 }), win(100, 5, { ctr: 1 }), RULE, 'USD')).toBe('STEADY');
  });
});

describe('sumário e linha do anúncio', () => {
  it('aggregate: cpa = gasto/resultados, ctr = cliques/impressões, roas ponderado pelo gasto, hookRate = plays/impressões', () => {
    const a = aggregate([
      m(100, 4, { impressions: 10_000, clicks: 100, roas: 2, plays2s: 2_000 }),
      m(300, 6, { impressions: 20_000, clicks: 500, roas: 4, plays2s: null }),
    ]);
    expect(a).toMatchObject({ spend: 400, results: 10, cpa: 40, ctr: 2, roas: 3.5, hookRate: 20, resultType: 'omni_purchase' });
    expect(aggregate([])).toMatchObject({ spend: 0, results: 0, cpa: null, ctr: null, roas: null, hookRate: null, resultType: null });
  });

  it('presentAd: daysRunning do adCreatedTime, metrics do JSON (campo faltando = zero/null), creative e championId', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    const row = {
      metaAdId: 'ad_1', name: 'Hook A', effectiveStatus: 'ACTIVE', campaignId: 'c', campaignName: 'C', adsetId: 's', adsetName: 'S', thumbnailUrl: null, videoId: 'v',
      metrics: { spend: 10 }, metrics7d: {}, metricsPrev7d: null, verdict: 'WINNER', trend: 'WORKING', adCreatedTime: new Date(now - 10.5 * 86_400_000), syncedAt: new Date(now),
    } as unknown as MetaAdSnapshot;
    const r = presentAd(row, { id: 'cr', name: 'Creative', adName: 'MC_1' }, 'ch', now);
    expect(r).toMatchObject({ metaAdId: 'ad_1', verdict: 'WINNER', trend: 'WORKING', daysRunning: 10, creative: { id: 'cr' }, championId: 'ch' });
    expect(r.metrics).toEqual({ ...metricsOf(null), spend: 10 });
    expect(r.metricsPrev7d.cpa).toBeNull();
  });
});

describe('erros e mapas', () => {
  it('MetaError síncrono → HTTP do §3.4 (D14: limite de uso = 503 META_UNAVAILABLE rate_limited)', () => {
    expect(toHttp(new MetaError('META_TOKEN_INVALID')).body()).toMatchObject({ code: 'META_TOKEN_INVALID', statusCode: 422 });
    expect(toHttp(new MetaError('META_PERMISSION', null, { details: { adAccountId: 'act_1', reason: 'no_advertise_task' } })).body()).toMatchObject({ code: 'META_PERMISSION', statusCode: 422, details: { adAccountId: 'act_1', reason: 'no_advertise_task' } });
    expect(toHttp(new MetaError('META_RATE_LIMITED', null, { retryAfterSec: 45 })).body()).toMatchObject({ code: 'META_UNAVAILABLE', statusCode: 503, details: { reason: 'rate_limited', retryAfterSec: 45 } });
    expect(toHttp(new MetaError('META_NOT_CONFIGURED', null, { details: { reason: 'off' } })).body()).toMatchObject({ code: 'META_NOT_CONFIGURED', statusCode: 503, details: { reason: 'off' } });
    expect(toHttp(new MetaError('META_BUDGET_TOO_LOW', null, { details: { minimumMinor: 500, currency: 'USD' } })).body()).toMatchObject({ code: 'META_BUDGET_TOO_LOW', details: { minimumMinor: 500 } });
    expect(toHttp(new MetaError('META_ERROR')).body()).toMatchObject({ code: 'META_UNAVAILABLE', details: { reason: 'down' } });
  });
  it('código assíncrono normalizado + ação por código', () => {
    expect(asMetaAsyncCode('META_POLICY')).toBe('META_POLICY');
    expect(asMetaAsyncCode('WHATEVER')).toBe('META_ERROR');
    expect(metaActionOf('META_POLICY')).toBe('edit_ad_text');
    expect(metaActionOf('META_VIDEO_UNAVAILABLE')).toBe('upload_video');
    expect(metaActionOf(null)).toBeNull();
  });
  it('market → país ISO (D9): texto conhecido, sigla, desconhecido = vazio (o usuário escolhe)', () => {
    expect(countriesOf('United States')).toEqual(['US']);
    expect(countriesOf('brasil')).toEqual(['BR']);
    expect(countriesOf('gb')).toEqual(['GB']);
    expect(countriesOf('Latam')).toEqual([]);
    expect(countriesOf(null)).toEqual([]);
  });
});
