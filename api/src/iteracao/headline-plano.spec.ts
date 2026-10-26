// headline-e-legenda-v1 (backend): modo/limites/bloqueios da headline do campeão, legenda automática e aspecto.
import type { EditMap } from '@maquina/contratos';
import { captionsAutoOf, formatoDoCampeao, headlineInfoOf } from './headline-plano';

const style = { fontId: 'montserrat-800', uppercase: true, fontSizePx: 40, lineHeight: 1.1, color: '#fff', highlightColor: '#ff0', strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' };
const layer = (over: Record<string, unknown> = {}) => ({ id: 'h', kind: 'headline', startFrame: 0, endFrame: 300, box: { x: 60, y: 100, w: 600, h: 88 }, background: { kind: 'solid', color: '#000', box: null }, style, text: 'Você dorme mal toda noite?', ...over });
const em = (layers: unknown[], faceTrack: unknown[] = []) => ({ version: 1, width: 720, height: 1280, fps: 30, frameCount: 300, cells: [], faceTrack, layers, overlaysOverFace: [], profile: null }) as unknown as EditMap;
const o = { screenLanguage: 'pt-BR', offerLanguage: 'pt-BR', width: 720, height: 1280 };

describe('headlineInfoOf (§1.1, §1.4)', () => {
  it('replace: limites pela original (× 1,2, mín. 20, máx. 90), linhas, destaque, aspecto do campeão', () => {
    const h = headlineInfoOf(em([layer()]), o);
    expect(h).toMatchObject({ mode: 'replace', original: 'Você dorme mal toda noite?', maxChars: 31, lines: 2, hasHighlight: true, blockedReason: null, format: 'VERTICAL_9_16' });
    expect(headlineInfoOf(em([layer({ text: 'Oi' })]), o).maxChars).toBe(20);
  });
  it('add sem headline (máx. 60, idioma da oferta); bloqueios: fonte fora do catálogo, mexe, cobre o rosto, aspecto', () => {
    expect(headlineInfoOf(em([]), { ...o, offerLanguage: 'en' })).toMatchObject({ mode: 'add', original: null, maxChars: 60, language: 'en', blockedReason: null });
    expect(headlineInfoOf(em([layer({ style: { ...style, fontId: 'comic-sans' } })]), o).blockedReason).toBe('headline_low_confidence');
    expect(headlineInfoOf(em([layer({ endFrame: 150 }), layer({ id: 'h2', startFrame: 150, endFrame: 300, box: { x: 60, y: 900, w: 600, h: 88 } })]), o).blockedReason).toBe('headline_moves');
    const rosto = [{ startFrame: 0, endFrame: 300, region: { x: 0, y: 0, w: 720, h: 1280 }, fullFrame: true, faceInRegion: [{ box: { x: 0.3, y: 0.08, w: 0.4, h: 0.2 }, atFrame: 0 }] }];
    expect(headlineInfoOf(em([layer()], rosto), o).blockedReason).toBe('headline_over_face');
    expect(headlineInfoOf(em([layer()]), { ...o, width: 1920, height: 1080 }).blockedReason).toBe('headline_aspect');
  });
  it('aspecto: 9:16 / 4:5 / 1:1 com 3 % de folga', () => {
    expect([formatoDoCampeao(720, 1280), formatoDoCampeao(1080, 1350), formatoDoCampeao(1000, 1010), formatoDoCampeao(1920, 1080)]).toEqual(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1', null]);
  });
});

describe('bug 26/10: área do bloqueio = a do render', () => {
  // lote cmvot8qxv000b22xlz0yrm60t: headline sobre o vídeo em y 125-250 (1080×1920), rosto começando em y 322
  const rosto = [{ startFrame: 0, endFrame: 300, region: { x: 0, y: 280, w: 1080, h: 1400 }, fullFrame: false, faceInRegion: [{ box: { x: 0.28, y: 0.03, w: 0.33, h: 0.37 }, atFrame: 0 }] }];
  const big = (layers: unknown[]) => ({ ...em(layers, rosto), width: 1080, height: 1920 }) as EditMap;
  const o2 = { ...o, width: 1080, height: 1920 };
  it('placa com 2 % de margem não encosta no rosto (antes 4 % bloqueava); faixa sólida usa a caixa da faixa', () => {
    const sobreVideo = layer({ box: { x: 43, y: 125, w: 1004, h: 125 }, background: { kind: 'none', color: null, box: null } });
    expect(headlineInfoOf(big([sobreVideo]), o2).blockedReason).toBeNull();
    const faixaQueCobre = layer({ box: { x: 43, y: 125, w: 1004, h: 125 }, background: { kind: 'solid', color: '#000', box: { x: 0, y: 100, w: 1080, h: 400 } } });
    expect(headlineInfoOf(big([faixaQueCobre]), o2).blockedReason).toBe('headline_over_face');
  });
});

describe('captionsAutoOf (§2.1)', () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
  it('sem legenda queimada = legenda automática; com legenda em ≥ 50 % da fala = não; sem fala = não', () => {
    expect(captionsAutoOf(em([layer()]), words)).toBe(true);
    expect(captionsAutoOf(em([layer({ kind: 'caption', startFrame: 0, endFrame: 300 })]), words)).toBe(false);
    expect(captionsAutoOf(em([layer({ kind: 'caption', startFrame: 0, endFrame: 60 })]), words)).toBe(true); // 2 s de 10
    expect(captionsAutoOf(em([]), [])).toBe(false);
  });
});
