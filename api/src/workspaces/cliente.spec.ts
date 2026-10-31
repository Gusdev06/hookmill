import { clientStatusOf, defaultResultOf, presentWorkspace, shortCodeFromName } from './cliente';

describe('cliente (fase2-agencia.md §1-§2)', () => {
  it('status derivado: pausado > concluído > setup', () => {
    const d = new Date();
    expect(clientStatusOf({ pausedAt: null, onboardingCompletedAt: null })).toBe('SETUP');
    expect(clientStatusOf({ pausedAt: null, onboardingCompletedAt: d })).toBe('LIVE');
    expect(clientStatusOf({ pausedAt: d, onboardingCompletedAt: null })).toBe('PAUSED');
    expect(clientStatusOf({ pausedAt: d, onboardingCompletedAt: d })).toBe('PAUSED');
  });
  it('resultado padrão derivado do resultType (resultado-v1)', () => {
    expect(defaultResultOf('PURCHASE')).toBe('PURCHASES');
    expect(defaultResultOf('LEAD')).toBe('LEADS');
    expect(defaultResultOf('APP_INSTALL')).toBe('INSTALLS');
    expect(defaultResultOf('MESSAGE')).toBe('MESSAGES');
    expect(defaultResultOf('OTHER')).toBe('RESULTS');
    expect(defaultResultOf(null)).toBeNull();
  });
  it('shortCode do nome: iniciais, senão 2 primeiras letras, senão WS', () => {
    expect(shortCodeFromName('Mattress Company')).toBe('MC');
    expect(shortCodeFromName('Clínica Ótima Sorriso')).toBe('COS');
    expect(shortCodeFromName('Acme')).toBe('AC');
    expect(shortCodeFromName('a b c d e f g h')).toBe('ABCDEF');
    expect(shortCodeFromName('!!')).toBe('WS');
    expect(shortCodeFromName('x')).toBe('WS');
  });
  it('presentWorkspace: formato novo do contrato', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const v = presentWorkspace({
      id: 'w', name: 'N', uiLocale: 'EN', monthlySpendCapUsd: null, createdAt: now, updatedAt: now,
      shortCode: 'NN', industry: null, market: 'US', businessType: 'APP', resultType: 'APP_INSTALL', resultTypeOther: 'stale', websiteUrl: null,
      onboardingStep: 3, onboardingCompletedAt: null, pausedAt: null,
    } as never);
    expect(v).toEqual({
      id: 'w', name: 'N', uiLocale: 'EN', monthlySpendCapUsd: null, shortCode: 'NN', industry: null, market: 'US',
      resultType: 'APP_INSTALL', resultTypeOther: null, businessType: 'APP', defaultResult: 'INSTALLS', websiteUrl: null, brandColor: null, status: 'SETUP',
      targetCpa: null, // 29/10 (CPA alvo): sem faixa no banco = null
      onboarding: { step: 3, totalSteps: 6, completedAt: null },
    });
  });

  it('presentWorkspace: OTHER devolve o texto livre e businessType null', () => {
    const v = presentWorkspace({ id: 'w', name: 'N', uiLocale: 'EN', monthlySpendCapUsd: null, shortCode: 'NN', industry: null, market: null,
      businessType: null, resultType: 'OTHER', resultTypeOther: 'Doações', websiteUrl: null, onboardingStep: 1, onboardingCompletedAt: null, pausedAt: null } as never);
    expect(v).toMatchObject({ resultType: 'OTHER', resultTypeOther: 'Doações', businessType: null, defaultResult: 'RESULTS' });
  });
});
