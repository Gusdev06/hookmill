import { adsResearchMode } from '../integracoes.module';

describe('adsResearchMode (Ad Radar)', () => {
  it('live e off só explícitos; vazio ou inválido = mock (o .env de hoje tem INTEGRACOES_MODE=live e o token do Trendcat)', () => {
    expect(adsResearchMode('live')).toBe('live');
    expect(adsResearchMode(' OFF ')).toBe('off');
    expect(adsResearchMode('mock')).toBe('mock');
    expect(adsResearchMode(undefined)).toBe('mock');
    expect(adsResearchMode('')).toBe('mock');
    expect(adsResearchMode('sim')).toBe('mock');
  });
});
