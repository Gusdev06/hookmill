// §A3.3: paleta do STATIC (cadeia de fallback do acento + fundo escuro no mesmo matiz com contraste ≥ 7:1).
import { DEFAULT_ACCENT, contrastRatio, darkBackgroundOf, dominantSaturated, hslOf, mostSaturated, normalizeHex, paletaDoEstatico } from './paleta';

describe('paletaDoEstatico (§A3.3)', () => {
  it('normalizeHex: #RGB/#RRGGBB com ou sem #, maiúsculo; inválido = null', () => {
    expect(normalizeHex('#f80')).toBe('#FF8800');
    expect(normalizeHex('1a2b3c')).toBe('#1A2B3C');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });

  it('cadeia: brandColor › dominante saturada da página › mais saturada do campeão › #FF8A3D', () => {
    const page = ['#FFFFFF', '#111111', '#2E7DFF', '#FF0000']; // branco e preto não servem; a 1ª saturada = dominante
    const champ = ['#808080', '#C04040', '#20C020'];
    expect(paletaDoEstatico({ brandColor: '#0a7', pageColors: page, championPalette: champ })).toMatchObject({ accent: '#00AA77', source: 'brand' });
    expect(paletaDoEstatico({ brandColor: null, pageColors: page, championPalette: champ })).toMatchObject({ accent: '#2E7DFF', source: 'page' });
    expect(paletaDoEstatico({ pageColors: ['#FFFFFF', '#F2F2F2'], championPalette: champ })).toMatchObject({ accent: '#20C020', source: 'champion' });
    expect(paletaDoEstatico({ pageColors: null, championPalette: ['#777777'] })).toMatchObject({ accent: DEFAULT_ACCENT, source: 'default' });
    expect(paletaDoEstatico({})).toMatchObject({ accent: DEFAULT_ACCENT, source: 'default' });
    expect(dominantSaturated(page)).toBe('#2E7DFF');
    expect(mostSaturated(champ)).toBe('#20C020');
  });

  it('fundo = mesmo matiz, L ≈ 8-12 %, texto branco ≥ 7:1 (inclusive em acento claro)', () => {
    for (const accent of ['#FF8A3D', '#2E7DFF', '#FFE600', '#00FFCC', '#C04040', '#808080', '#FFFFFF', '#000000']) {
      const bg = darkBackgroundOf(accent);
      expect(contrastRatio('#FFFFFF', bg)).toBeGreaterThanOrEqual(7);
      const { l } = hslOf(bg);
      expect(l).toBeLessThanOrEqual(0.12);
      if (hslOf(accent).s > 0.2) expect(Math.abs(hslOf(bg).h - hslOf(accent).h)).toBeLessThan(8);
    }
    const p = paletaDoEstatico({ brandColor: '#FF8A3D' });
    expect(hslOf(p.background).l).toBeGreaterThanOrEqual(0.07);
  });
});
