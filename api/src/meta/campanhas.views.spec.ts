// campanhas-v1 §1/§3/§4.1/§5.4: filtros de status, onde mora o orçamento (CBO/ABO/vitalício), link por nível, ordenação, contagens.
import { adsetBudget, adsManagerObjectUrl, campaignBudget, canToggleOf, canWriteOf, countsOf, editableBudget, matchesStatus, sortRows } from './campanhas.views';
import { ZERO_METRICS } from './comum';

const ctx = { currency: 'USD', minimumMinor: 500, canWrite: true };
const b = (daily: number | null, lifetime: number | null = null) => ({ dailyBudgetMinor: daily, lifetimeBudgetMinor: lifetime, budgetRemainingMinor: null });

describe('status e permissões', () => {
  it('filtros: active / paused (3 tipos) / issues (4 tipos) / all', () => {
    expect(matchesStatus('ACTIVE', 'active')).toBe(true);
    expect(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'].every((s) => matchesStatus(s, 'paused'))).toBe(true);
    expect(['DISAPPROVED', 'WITH_ISSUES', 'PENDING_REVIEW', 'IN_PROCESS'].every((s) => matchesStatus(s, 'issues'))).toBe(true);
    expect(matchesStatus('ACTIVE', 'paused')).toBe(false);
    expect(matchesStatus('ARCHIVED', 'all')).toBe(true);
    expect(matchesStatus('ARCHIVED', undefined)).toBe(true);
  });

  it('escreve só OWNER/ADMIN com conexão ACTIVE e conta utilizável; toggle desligado em DISAPPROVED/DELETED', () => {
    expect(canWriteOf('OWNER', { status: 'ACTIVE', accountStatus: 1 })).toBe(true);
    expect(canWriteOf('ADMIN', { status: 'ACTIVE', accountStatus: 1 })).toBe(true);
    expect(canWriteOf('MEMBER', { status: 'ACTIVE', accountStatus: 1 })).toBe(false);
    expect(canWriteOf('CLIENT', { status: 'ACTIVE', accountStatus: 1 })).toBe(false);
    expect(canWriteOf('OWNER', { status: 'ACTIVE', accountStatus: 2 })).toBe(false);
    expect(canWriteOf('OWNER', { status: 'TOKEN_INVALID', accountStatus: 1 })).toBe(false);
    expect(canToggleOf(true, 'DISAPPROVED')).toBe(false);
    expect(canToggleOf(true, 'ADSET_PAUSED')).toBe(true);
  });

  it('link do Ads Manager por nível, sem o prefixo act_', () => {
    expect(adsManagerObjectUrl('act_123', 'campaign', 'c1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=c1');
    expect(adsManagerObjectUrl('act_123', 'adset', 's1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/adsets?act=123&selected_adset_ids=s1');
    expect(adsManagerObjectUrl('act_123', 'ad', 'a1')).toBe('https://adsmanager.facebook.com/adsmanager/manage/ads?act=123&selected_ad_ids=a1');
  });
});

describe('orçamento (§3 MetaBudget, §4.1 META_BUDGET_NOT_EDITABLE)', () => {
  it('campanha: CBO diário editável; CBO vitalício só leitura; ABO = level null', () => {
    expect(campaignBudget(b(5000), ctx)).toEqual({ level: 'campaign', kind: 'daily', amountMinor: 5000, remainingMinor: null, currency: 'USD', editable: true, minimumMinor: 500 });
    expect(campaignBudget(b(null, 100000), ctx)).toMatchObject({ level: 'campaign', kind: 'lifetime', amountMinor: 100000, editable: false });
    expect(campaignBudget(b(null), ctx)).toMatchObject({ level: null, kind: null, amountMinor: null, editable: false });
    expect(campaignBudget(b(5000), { ...ctx, canWrite: false }).editable).toBe(false);
  });

  it('conjunto: ABO mora nele; em CBO aponta a campanha com editable false', () => {
    expect(adsetBudget(b(2000), b(null), ctx)).toMatchObject({ level: 'adset', kind: 'daily', amountMinor: 2000, editable: true });
    expect(adsetBudget(b(null), b(5000), ctx)).toMatchObject({ level: 'campaign', kind: 'daily', amountMinor: 5000, editable: false });
    expect(adsetBudget(b(null), b(null, 9000), ctx)).toMatchObject({ level: 'campaign', kind: 'lifetime', editable: false });
  });

  it('editableBudget: só o diário que mora no nível; o resto diz onde mora', () => {
    expect(editableBudget('campaign', b(5000), null)).toEqual({ ok: true, currentMinor: 5000 });
    expect(editableBudget('campaign', b(null, 9000), null)).toEqual({ ok: false, budgetLevel: 'campaign', kind: 'lifetime' });
    expect(editableBudget('campaign', b(null), null)).toEqual({ ok: false, budgetLevel: 'adset', kind: 'daily' });
    expect(editableBudget('adset', b(2000), b(null))).toEqual({ ok: true, currentMinor: 2000 });
    expect(editableBudget('adset', b(null), b(5000))).toEqual({ ok: false, budgetLevel: 'campaign', kind: 'daily' });
    expect(editableBudget('adset', b(null), b(null, 9000))).toEqual({ ok: false, budgetLevel: 'campaign', kind: 'lifetime' });
    expect(editableBudget('adset', b(null, 300), b(null))).toEqual({ ok: false, budgetLevel: 'adset', kind: 'lifetime' });
  });
});

describe('ordenação e contagens', () => {
  const row = (name: string, spend: number, cpa: number | null, budget: number | null) => ({ name, m: { ...ZERO_METRICS, spend, cpa }, budget });
  const rows = [row('b', 10, 5, 100), row('a', 30, null, null), row('c', 20, 2, 300)];
  const key = (r: (typeof rows)[number]) => r;

  it('spend desc (padrão); cpa asc com null no fim; name asc; budget desc; dir inverte', () => {
    expect(sortRows(rows, key).map((r) => r.name)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, key, 'cpa').map((r) => r.name)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, key, 'name').map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, key, 'budget').map((r) => r.name)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, key, 'spend', 'asc').map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('countsOf: por campanha (conjuntos, anúncios, ativos, vencedores, cansando ativos) e por conjunto', () => {
    const ads = [
      { campaignId: 'c1', adsetId: 's1', effectiveStatus: 'ACTIVE', verdict: 'WINNER' as const, trend: 'TIRING' as const },
      { campaignId: 'c1', adsetId: 's1', effectiveStatus: 'PAUSED', verdict: 'OK' as const, trend: 'TIRING' as const },
      { campaignId: 'c1', adsetId: 's2', effectiveStatus: 'ACTIVE', verdict: 'LOW_DATA' as const, trend: null },
    ];
    const c = countsOf(ads);
    expect(c.campaign('c1', 3)).toEqual({ adsets: 3, ads: 3, activeAds: 2, winners: 1, tiring: 1 });
    expect(c.campaign('nope', 0)).toEqual({ adsets: 0, ads: 0, activeAds: 0, winners: 0, tiring: 0 });
    expect(c.adset('s1')).toEqual({ ads: 2, activeAds: 1, winners: 1 });
  });
});
