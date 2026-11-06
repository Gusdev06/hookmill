// ads-research-v1: regras puras (selo C.6, termo D3, descartável D4, trava de 30 %, links, id da Página).
import { brainHash, countryOf, daysBetween, hostOf, isSuspectSync, pageIdFrom, sameSite, suspectDisposable, termOutcome, tierOf } from './regras';

const rules = { winnerDays: 30, winnerVersions: 5, newDays: 7 };
const now = new Date('2026-11-04T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('tierOf (C.6)', () => {
  it('winner = ativo e (≥ 30 dias OU ≥ 5 versões)', () => {
    expect(tierOf({ isActive: true, startDate: daysAgo(30), stoppedAt: null, collationCount: 1 }, rules, now)).toMatchObject({ tier: 'winner', daysRunning: 30 });
    expect(tierOf({ isActive: true, startDate: daysAgo(2), stoppedAt: null, collationCount: 5 }, rules, now).tier).toBe('winner');
  });
  it('testing 7–29, new < 7, sem data = testing', () => {
    expect(tierOf({ isActive: true, startDate: daysAgo(29), stoppedAt: null, collationCount: null }, rules, now).tier).toBe('testing');
    expect(tierOf({ isActive: true, startDate: daysAgo(6), stoppedAt: null, collationCount: 4 }, rules, now).tier).toBe('new');
    expect(tierOf({ isActive: true, startDate: null, stoppedAt: null, collationCount: null }, rules, now)).toMatchObject({ tier: 'testing', daysRunning: null });
  });
  it('stopped conta até stoppedAt; killedFast se durou < 7', () => {
    expect(tierOf({ isActive: false, startDate: daysAgo(40), stoppedAt: daysAgo(35), collationCount: 9 }, rules, now)).toEqual({ tier: 'stopped', daysRunning: 5, killedFast: true });
    expect(tierOf({ isActive: false, startDate: daysAgo(40), stoppedAt: daysAgo(1), collationCount: 1 }, rules, now)).toEqual({ tier: 'stopped', daysRunning: 39, killedFast: false });
  });
  it('daysBetween por dia de calendário', () => {
    expect(daysBetween(new Date('2026-11-01T23:59:00Z'), new Date('2026-11-02T00:01:00Z'))).toBe(1);
  });
});

describe('termOutcome (D3)', () => {
  it('EMPTY com 0–1 Página; DIFFUSE com ≥ 8 Páginas e ≥ 80 % de 1 anúncio; senão SEARCHED', () => {
    expect(termOutcome([])).toBe('EMPTY');
    expect(termOutcome([5])).toBe('EMPTY');
    expect(termOutcome(Array(10).fill(1))).toBe('DIFFUSE');
    expect(termOutcome([...Array(8).fill(1), 3, 4])).toBe('DIFFUSE'); // 80 %
    expect(termOutcome([...Array(7).fill(1), 3, 4, 2])).toBe('SEARCHED'); // 70 %
    expect(termOutcome([1, 1, 1])).toBe('SEARCHED'); // < 8 Páginas
  });
});

describe('suspectDisposable (D4, regra do backend)', () => {
  it('0 ativos, alfabetos misturados, nome sem sentido = suspeito', () => {
    expect(suspectDisposable({ pageName: 'Rival A', activeAdsSeen: 0 })).toBe(true);
    expect(suspectDisposable({ pageName: 'Rival I Ѕtore', activeAdsSeen: 2 })).toBe(true); // Ѕ cirílico
    expect(suspectDisposable({ pageName: 'xq 48213', activeAdsSeen: 3 })).toBe(true);
    expect(suspectDisposable({ pageName: 'bcdfghkl', activeAdsSeen: 3 })).toBe(true);
    expect(suspectDisposable({ pageName: '1234', activeAdsSeen: 3 })).toBe(true);
  });
  it('nomes normais passam (inclui acento e japonês)', () => {
    for (const n of ['Rival A', 'Pocketwise', 'Hallow: Prayer & Meditation', 'Sono Bom Colchões', 'ユニクロ', 'Nike Store 2']) {
      expect(suspectDisposable({ pageName: n, activeAdsSeen: 3 })).toBe(false);
    }
  });
});

describe('outras', () => {
  it('trava de 30 %: só com a anterior ≥ 10', () => {
    expect(isSuspectSync(2, 10)).toBe(true);
    expect(isSuspectSync(3, 10)).toBe(false);
    expect(isSuspectSync(0, 9)).toBe(false);
  });
  it('host/sameSite/país', () => {
    expect(hostOf('https://www.Foo.com/x')).toBe('foo.com');
    expect(hostOf('foo.com')).toBe('foo.com');
    expect(hostOf(null)).toBeNull();
    expect(sameSite('app.foo.com', 'foo.com')).toBe(true);
    expect(sameSite('foo.com.br', 'foo.com')).toBe(false);
    expect(countryOf('br')).toBe('BR');
    expect(countryOf('BRA')).toBeNull();
  });
  it('pageIdFrom (R10): id ou URL com o id; slug não resolve', () => {
    expect(pageIdFrom({ pageId: '123456789' })).toBe('123456789');
    expect(pageIdFrom({ pageId: 'abc' })).toBeNull();
    expect(pageIdFrom({ pageUrl: 'https://www.facebook.com/ads/library/?active_status=all&view_all_page_id=987654321' })).toBe('987654321');
    expect(pageIdFrom({ pageUrl: 'https://facebook.com/profile.php?id=55555555' })).toBe('55555555');
    expect(pageIdFrom({ pageUrl: 'https://www.facebook.com/minhapagina' })).toBeNull();
    expect(pageIdFrom({ pageUrl: 'https://evil.com/?view_all_page_id=123456' })).toBeNull();
  });
  it('brainHash muda com ramo/mercado/oferta e ignora caixa/espaço', () => {
    const base = { industry: 'Apps', market: 'US', websiteUrl: null, offer: { id: 'o1', what: 'Budget app', audience: null, promise: null, kind: null } };
    expect(brainHash(base)).toBe(brainHash({ ...base, industry: '  apps ' }));
    expect(brainHash(base)).not.toBe(brainHash({ ...base, market: 'BR' }));
    expect(brainHash(base)).not.toBe(brainHash({ ...base, offer: { ...base.offer, what: 'Credit score' } }));
  });
});
