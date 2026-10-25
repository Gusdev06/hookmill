import { clientStatusOf, defaultResultOf, presentWorkspace, shortCodeFromName } from './cliente';

describe('cliente (fase2-agencia.md §1-§2)', () => {
  it('status derivado: pausado > concluído > setup', () => {
    const d = new Date();
    expect(clientStatusOf({ pausedAt: null, onboardingCompletedAt: null })).toBe('SETUP');
    expect(clientStatusOf({ pausedAt: null, onboardingCompletedAt: d })).toBe('LIVE');
    expect(clientStatusOf({ pausedAt: d, onboardingCompletedAt: null })).toBe('PAUSED');
    expect(clientStatusOf({ pausedAt: d, onboardingCompletedAt: d })).toBe('PAUSED');
  });
  it('resultado padrão derivado do tipo de negócio', () => {
    expect(defaultResultOf('ONLINE_STORE')).toBe('PURCHASES');
    expect(defaultResultOf('LOCAL_BUSINESS')).toBe('LEADS');
    expect(defaultResultOf('APP')).toBe('INSTALLS');
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
      shortCode: 'NN', industry: null, market: 'US', businessType: 'APP', websiteUrl: null,
      onboardingStep: 3, onboardingCompletedAt: null, pausedAt: null,
    } as never);
    expect(v).toEqual({
      id: 'w', name: 'N', uiLocale: 'EN', monthlySpendCapUsd: null, shortCode: 'NN', industry: null, market: 'US',
      businessType: 'APP', defaultResult: 'INSTALLS', websiteUrl: null, brandColor: null, status: 'SETUP',
      onboarding: { step: 3, totalSteps: 6, completedAt: null },
    });
  });
});
