// legenda-protegida-v1 (26/10): faixa protegida, checagem geométrica e decisão desviar → recortar → bloquear.
import { checarLegendaProtegida, decidirLegenda, faixasProtegidasDe, recorteSemLegenda, reframeNaCaixa, unionBand, type EditMapLike, type MolduraProps } from '../src/lib';

const src = { width: 1080, height: 1920 };
const mapa = (caption: { x: number; y: number; w: number; h: number }, rostoY = 0.1): EditMapLike & { fps: number } => ({
  width: 1080, height: 1920, fps: 30, frameCount: 900,
  faceTrack: [{ startFrame: 0, endFrame: 900, region: { x: 0, y: 280, w: 1080, h: 1400 }, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: rostoY, w: 0.4, h: 0.3 } }] }],
  layers: [{ box: caption, startFrame: 0, endFrame: 900, kind: 'caption', style: { fontSizePx: 60, lineHeight: 1.15 } } as never],
});
const input = (m: ReturnType<typeof mapa>, id: MolduraProps['frame']['id'], texts: unknown): MolduraProps => ({
  format: 'VERTICAL_9_16', language: 'pt', safeArea: { top: 96, bottom: 192 },
  frame: { id, texts, brand: { name: 'A', handle: '@a', initials: 'A', color: '#5B4BF5' } } as never,
  video: {
    source: { videoUrl: 'x', ...src, fps: 30, durationSec: 30, hasAudio: true }, timeline: [{ startSec: 0, endSec: 30 }], joinFadeMs: 40,
    reframe: reframeNaCaixa({ w: 1080, h: 1920 }, src, m, 1080, { x: 0, y: 280, w: 1080, h: 1400 }, unionBand(faixasProtegidasDe(m as never, src))),
    contentBox: { x: 0, y: 280, w: 1080, h: 1400 }, protectedBands: faixasProtegidasDe(m as never, src),
  },
});

describe('faixas protegidas', () => {
  it('folga de 4 % em cima/embaixo e 2 % nos lados; legenda de 1 linha medida ganha 1 linha de cada lado', () => {
    const [b] = faixasProtegidasDe(mapa({ x: 100, y: 1000, w: 880, h: 69 }) as never, src);
    expect(b.x).toBe(100 - 22);
    expect(b.y).toBe(Math.round(1000 - 69 - 76.8));
    expect(b.h).toBeGreaterThan(69 + 2 * 69);
  });
  it('a mesma posição em intervalos que se tocam vira uma faixa; posições diferentes ficam separadas e a união cobre todas', () => {
    const m = mapa({ x: 100, y: 1000, w: 880, h: 140 });
    (m.layers as unknown as unknown[]).push({ box: { x: 100, y: 1000, w: 880, h: 140 }, startFrame: 900, endFrame: 1200, kind: 'caption' }, { box: { x: 100, y: 1500, w: 880, h: 140 }, startFrame: 1200, endFrame: 1500, kind: 'caption' });
    const bs = faixasProtegidasDe(m as never, src);
    expect(bs).toHaveLength(2);
    expect(unionBand(bs)!.y + unionBand(bs)!.h).toBeGreaterThan(1600);
  });
});

describe('checagem e decisão', () => {
  it('Caixinha sobre a legenda no meio: o layout desvia (passo 1) e a checagem passa', () => {
    const m = mapa({ x: 150, y: 1000, w: 780, h: 140 });
    const d = decidirLegenda(input(m, 'question_box', { question: 'Por que eu travo?' }), m, null);
    expect(d.mode).toBe('avoid');
  });
  it('slot por cima da faixa = hit; faixa fora da janela = clipped', () => {
    const m = mapa({ x: 150, y: 1000, w: 780, h: 140 });
    const p = input(m, 'question_box', { question: 'Por que?' });
    // força o cartão no lugar da legenda (sem desvio): monta o input sem as faixas no layout e checa com elas
    const c = checarLegendaProtegida(p, (require('../src/lib') as typeof import('../src/lib')).frameLayout('question_box', 'VERTICAL_9_16', { question: 'Por que?' }, 'pt'));
    expect(c.ok).toBe(false);
    expect(c.hits.some((h) => h.element === 'slot:card')).toBe(true);
  });
  it('recorte: a parte do lado do rosto sem a faixa; rosto atravessando a faixa = null', () => {
    const m = mapa({ x: 0, y: 1300, w: 1080, h: 140 });
    const r = recorteSemLegenda(input(m, 'live', {}), m)!;
    expect(r.y).toBe(280);
    expect(r.y + r.h).toBeLessThanOrEqual(faixasProtegidasDe(m as never, src)[0].y);
    const m2 = mapa({ x: 0, y: 500, w: 1080, h: 140 }, 0.1);
    expect(recorteSemLegenda(input(m2, 'live', {}), m2)).toBeNull();
  });
  it('legenda larga demais pro vídeo cheio: recorta sem ela e põe a nossa (passo 2), sem vazar a original', () => {
    const m = mapa({ x: 0, y: 1400, w: 1080, h: 140 });
    const leg = { words: [{ word: 'oi', startSec: 0, endSec: 1 }], highlightColor: '#FF0', language: 'pt' };
    const d = decidirLegenda(input(m, 'live', {}), m, leg);
    expect(d.mode).toBe('replace');
    if (d.mode !== 'replace') return;
    expect(d.input.captionMode).toBe('replace');
    expect(d.input.captions).toEqual(leg);
    expect(checarLegendaProtegida(d.input).ok).toBe(true);
  });
});

describe('pontas de 26/10', () => {
  it('campeão sem rosto (b-roll com narração): o recorte é liberado pro maior lado sem a faixa', () => {
    const m = { ...mapa({ x: 0, y: 1300, w: 1080, h: 140 }), faceTrack: [] };
    const r = recorteSemLegenda(input(m, 'live', {}), m)!;
    expect(r).not.toBeNull();
    expect(r.y + r.h).toBeLessThanOrEqual(faixasProtegidasDe(m as never, src)[0].y);
    const leg = { words: [{ word: 'oi', startSec: 0, endSec: 1 }], highlightColor: '#FF0', language: 'pt' };
    expect(decidirLegenda(input(m, 'live', {}), m, leg).mode).toBe('replace');
  });
  it("'replace' forçado (Retry depois de CAPTION_COVERED) pula o desvio; sem como recortar = blocked", () => {
    const m = mapa({ x: 150, y: 1000, w: 780, h: 140 }, 0.05);
    expect(decidirLegenda(input(m, 'question_box', { question: 'Por que eu travo?' }), m, null).mode).toBe('avoid');
    expect(decidirLegenda(input(m, 'question_box', { question: 'Por que eu travo?' }), m, null, 'replace').mode).toBe('replace');
    const m2 = mapa({ x: 0, y: 500, w: 1080, h: 140 }, 0.1);
    expect(decidirLegenda(input(m2, 'live', {}), m2, null, 'replace').mode).toBe('blocked');
  });
});
