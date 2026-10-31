// legenda-protegida-v1 (26/10): faixa protegida, checagem geométrica e decisão desviar → recortar → bloquear.
import { checarLegendaProtegida, decidirLegenda, enquadramentosPreservandoLegenda, faixasProtegidasDe, layoutDaPeca, pinturaNaCaixa, recorteSemLegenda, reframeNaCaixa, unionBand, type EditMapLike, type MolduraProps } from '../src/lib';

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
  it('29/10: o vídeo preenche a caixa (cover, sem faixa de cor), com a legenda e o rosto inteiros dentro', () => {
    const m = mapa({ x: 150, y: 1000, w: 780, h: 140 });
    for (const [id, texts] of [['meme', { pov: 'Uma pergunta', cta: 'Saiba mais' }], ['pov_testimonial', { pov: 'Quando eu travei', cta: 'Saiba mais' }]] as const) {
      const p = { ...input(m, id, texts) };
      const rosto = { x: 0.3 * 1080, y: 280 + 0.1 * 1400, w: 0.4 * 1080, h: 0.3 * 1400 };
      p.video = { ...p.video, faceSafeBand: rosto };
      const d = decidirLegenda(p, m, null);
      expect(d.mode).toBe('avoid');
      if (d.mode !== 'avoid') return;
      const box = layoutDaPeca(d.input).videoBox;
      const paint = pinturaNaCaixa(box, d.input.video.source, d.input.video.reframe, d.input.video.contentBox ?? null);
      expect(paint.cheio).toBe(true);
      expect(d.input.video.reframe.mode === 'cover' && d.input.video.reframe.scale).toBeFalsy();
      expect(d.check.hits).toEqual([]);
      expect(d.input.captions).toBeUndefined();
    }
  });
  it('29/10: o foco desliza no eixo cortado até a legenda entrar (cover), em vez de afastar o zoom', () => {
    // vídeo quadrado numa caixa 9:16: cover corta as laterais; a legenda está colada na direita
    const sq = { videoUrl: 'x', width: 1920, height: 1920, fps: 30, durationSec: 30, hasAudio: true };
    const v = { source: sq, timeline: [{ startSec: 0, endSec: 30 }], joinFadeMs: 40, reframe: { mode: 'cover' as const, focus: { x: 0.5, y: 0.5 } },
      protectedBands: [{ x: 1300, y: 1500, w: 560, h: 150, startSec: 0, endSec: 30 }] } as MolduraProps['video'];
    const [c0] = enquadramentosPreservandoLegenda(v, { w: 1080, h: 1920 });
    expect(c0.reframe.mode === 'cover' && c0.reframe.scale).toBeFalsy();
    const pt = pinturaNaCaixa({ w: 1080, h: 1920 }, sq, c0.reframe, c0.contentBox ?? null);
    expect(pt.cheio).toBe(true);
    const x0 = pt.area.left + 1300 * pt.s, x1 = pt.area.left + 1860 * pt.s;
    expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(1080);
  });
  it('29/10: legenda + rosto que não cabem no cover = afasta só o necessário (faixa de cor mínima)', () => {
    const sq = { videoUrl: 'x', width: 1920, height: 1920, fps: 30, durationSec: 30, hasAudio: true };
    const v = { source: sq, timeline: [{ startSec: 0, endSec: 30 }], joinFadeMs: 40, reframe: { mode: 'cover' as const, focus: { x: 0.5, y: 0.5 } },
      protectedBands: [{ x: 100, y: 1500, w: 1400, h: 150, startSec: 0, endSec: 30 }] } as MolduraProps['video'];
    const [c0] = enquadramentosPreservandoLegenda(v, { w: 1080, h: 1920 });
    const s = c0.reframe.mode === 'cover' ? c0.reframe.scale ?? 1 : 1;
    // a legenda tem 1400 px; o cover mostra 1080 de 1920 px → precisa de ~1080/1406 do cover, não do contain (0,56)
    expect(s).toBeLessThan(0.78); expect(s).toBeGreaterThan(0.75);
  });
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
  it('template sem área segura sai do plano, preservando a legenda original', () => {
    // 29/10: legenda de rodapé larga já cabe (o vídeo encosta em cima e a sobra vai inteira pra baixo); sem área
    // segura = texto queimado ocupando quase o quadro todo
    const m = mapa({ x: 0, y: 300, w: 1080, h: 1300 });
    const leg = { words: [{ word: 'oi', startSec: 0, endSec: 1 }], highlightColor: '#FF0', language: 'pt' };
    const d = decidirLegenda(input(m, 'live', {}), m, leg);
    expect(d.mode).toBe('blocked');
    expect(input(m, 'live', {}).video.protectedBands?.length).toBeGreaterThan(0);
  });
});

describe('pontas de 26/10', () => {
  it('campeão sem rosto (b-roll com narração): o recorte é liberado pro maior lado sem a faixa', () => {
    const m = { ...mapa({ x: 0, y: 1300, w: 1080, h: 140 }), faceTrack: [] };
    const r = recorteSemLegenda(input(m, 'live', {}), m)!;
    expect(r).not.toBeNull();
    expect(r.y + r.h).toBeLessThanOrEqual(faixasProtegidasDe(m as never, src)[0].y);
    const leg = { words: [{ word: 'oi', startSec: 0, endSec: 1 }], highlightColor: '#FF0', language: 'pt' };
    // 29/10: sem o recorte automático (revisão 28/10), o desvio acha lugar pra legenda de rodapé, com o vídeo cheio na largura
    const d = decidirLegenda(input(m, 'live', {}), m, leg);
    expect(d.mode).toBe('avoid');
    if (d.mode === 'avoid') expect(d.check.hits).toEqual([]);
  });
  it("'replace' forçado (Retry depois de CAPTION_COVERED) pula o desvio; sem como recortar = blocked", () => {
    const m = mapa({ x: 150, y: 1000, w: 780, h: 140 }, 0.05);
    expect(decidirLegenda(input(m, 'question_box', { question: 'Por que eu travo?' }), m, null).mode).toBe('avoid');
    expect(decidirLegenda(input(m, 'question_box', { question: 'Por que eu travo?' }), m, null, 'replace').mode).toBe('replace');
    const m2 = mapa({ x: 0, y: 500, w: 1080, h: 140 }, 0.1);
    expect(decidirLegenda(input(m2, 'live', {}), m2, null, 'replace').mode).toBe('blocked');
  });
});
