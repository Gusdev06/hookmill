// legenda-protegida-v1 §4.2: instantes da checagem por visão, palavras esperadas, recorte e o alvo de cada tipo de input.
import { captionCheckOf, captionCheckTimes, captionTargetOf, cropOf, quadroNoLog, wordsAt } from './checagem-legenda';
import { captionCoveredTwice, captionNoteOf } from './pecas';

const band = { x: 80, y: 1000, w: 900, h: 220, startSec: 0, endSec: 30 };

describe('captionCheckTimes', () => {
  it('6 instantes espalhados dentro da faixa, com folga nas bordas', () => {
    const t = captionCheckTimes([band], [{ startSec: 0, endSec: 30 }]);
    expect(t).toHaveLength(6);
    expect(t[0].atSec).toBeGreaterThan(0.25);
    expect(t[5].atSec).toBeLessThan(29.75);
    expect(t.every((x) => x.atSec === x.srcSec)).toBe(true);
  });
  it('CUT: leva o instante do campeão pro da peça pela timeline (trecho cortado fora)', () => {
    const t = captionCheckTimes([{ ...band, startSec: 10, endSec: 20 }], [{ startSec: 0, endSec: 5 }, { startSec: 12, endSec: 18 }]);
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) {
      expect(x.atSec).toBeGreaterThanOrEqual(5);
      expect(x.srcSec - x.atSec).toBeCloseTo(7, 5);
    }
  });
  it('faixa fora da peça = nenhum instante (não checa)', () => {
    expect(captionCheckTimes([{ ...band, startSec: 20, endSec: 25 }], [{ startSec: 0, endSec: 10 }])).toEqual([]);
  });
});

describe('wordsAt / cropOf / captionTargetOf', () => {
  it('palavras em volta do instante, na ordem', () => {
    const w = [{ word: 'a', startSec: 0, endSec: 0.4 }, { word: 'b', startSec: 1, endSec: 1.4 }, { word: 'c', startSec: 5, endSec: 5.4 }];
    expect(wordsAt(w, 1.2)).toEqual(['a', 'b']);
  });
  it('recorte só quando a saída é o próprio quadro do campeão (escala e par)', () => {
    const t = { mode: 'avoid' as const, bands: [band], timeline: [{ startSec: 0, endSec: 30 }], source: { width: 1080, height: 1920 }, sameFrame: true };
    expect(cropOf(t, { width: 540, height: 960 })).toEqual({ x: 40, y: 500, w: 450, h: 110 });
    expect(cropOf({ ...t, sameFrame: false }, { width: 1080, height: 1920 })).toBeNull();
  });
  it('alvo: moldura lê video.*, auto-edit o topo, remix-keep as faixas do campeão; sem faixa = null', () => {
    const frame = { kind: 'frame', captionMode: 'replace', video: { protectedBands: [band], timeline: [{ startSec: 0, endSec: 30 }], source: { width: 1080, height: 1920 } } };
    expect(captionTargetOf(frame as never)).toMatchObject({ mode: 'replace', sameFrame: false });
    expect(captionTargetOf({ ...frame, video: { ...frame.video, protectedBands: [] } } as never)).toBeNull();
    const ae = { kind: 'auto-edit', type: 'CUT', protectedBands: [band], timeline: [{ startSec: 0, endSec: 15 }], source: { width: 1080, height: 1920 } };
    expect(captionTargetOf(ae as never)).toMatchObject({ mode: 'avoid' });
    const rk = { kind: 'remix-keep', canvas: { width: 1080, height: 1920, fps: 30, frameCount: 900 } };
    expect(captionTargetOf(rk as never)).toBeNull();
    expect(captionTargetOf(rk as never, [band])).toMatchObject({ sameFrame: true, timeline: [{ startSec: 0, endSec: 30 }] });
  });
});

describe('peça (pecas.ts)', () => {
  it('captionNote = replaced só no modo replace', () => {
    expect(captionNoteOf({ captionMode: 'replace' })).toBe('replaced');
    expect(captionNoteOf({ captionMode: 'avoid' })).toBeNull();
    expect(captionNoteOf(null)).toBeNull();
  });
  it('tampada de novo depois do Retry (tentativa ≥ 2) = Leave out', () => {
    expect(captionCoveredTwice({ errorCode: 'CAPTION_COVERED', input: { captionCheck: { attempt: 1 } } })).toBe(false);
    expect(captionCoveredTwice({ errorCode: 'CAPTION_COVERED', input: { captionCheck: { attempt: 2 } } })).toBe(true);
    expect(captionCoveredTwice(undefined)).toBe(false);
  });
});

describe('faixas na saída (rev. 26/10: outputProtectedBands)', () => {
  const { outputCropAt, outputCheckTimes, pieceToSource } = jest.requireActual('./checagem-legenda') as typeof import('./checagem-legenda');
  const out = [
    { kind: 'original' as const, x: 100, y: 1200, w: 880, h: 200, startSec: 0, endSec: 10 },
    { kind: 'original' as const, x: 100, y: 600, w: 880, h: 200, startSec: 10, endSec: 20 },
    { kind: 'replaced' as const, x: 60, y: 1500, w: 960, h: 180, startSec: 0, endSec: 20 },
  ];
  it('recorte por instante e por modo, com folga e dentro do quadro', () => {
    const o = { width: 1080, height: 1920 };
    expect(outputCropAt(out, 'avoid', 5, o)).toMatchObject({ y: 1200 - 38 });
    expect(outputCropAt(out, 'avoid', 15, o)).toMatchObject({ y: 600 - 38 });
    expect(outputCropAt(out, 'replace', 15, o)).toMatchObject({ y: 1500 - 38 });
    expect(outputCropAt(out, 'avoid', 25, o)).toBeNull();
  });
  it('instantes no tempo da peça; srcSec pela timeline do CUT', () => {
    expect(pieceToSource(6, [{ startSec: 0, endSec: 5 }, { startSec: 12, endSec: 18 }])).toBe(13);
    const t = outputCheckTimes(out, 'avoid', [{ startSec: 0, endSec: 20 }]);
    expect(t).toHaveLength(6);
    expect(t.every((x) => x.atSec > 0 && x.atSec < 20)).toBe(true);
  });
  it('captionTargetOf leva as faixas na saída quando o input tem', () => {
    const frame = { kind: 'frame', video: { protectedBands: [band], timeline: [{ startSec: 0, endSec: 30 }], source: { width: 1080, height: 1920 } }, outputProtectedBands: out };
    expect(captionTargetOf(frame as never)?.output).toHaveLength(3);
  });
});

describe('captionCheckOf (F10, 28/10)', () => {
  const q = (o: Record<string, unknown>) => ({ atSec: 1, ok: true, covered: false, duplicated: false, seen: 'oi', ...o });
  it('grava problem e reason de cada quadro e mantém o status da porta', () => {
    const c = captionCheckOf({
      status: 'covered',
      frames: [q({ atSec: 21.29, ok: false, seen: null, problem: 'missing', reason: null }), q({ atSec: 40, ok: false, covered: true, problem: 'covered', reason: 'o card do topo tampa "você"' }), q({ atSec: 77.39, problem: null })],
    }, 2);
    expect(c).toEqual({
      status: 'covered', attempt: 2,
      frames: [
        { atSec: 21.29, ok: false, seen: null, problem: 'missing', reason: null },
        { atSec: 40, ok: false, seen: 'oi', problem: 'covered', reason: 'o card do topo tampa "você"' },
        { atSec: 77.39, ok: true, seen: 'oi', problem: null, reason: null },
      ],
    });
    expect(c.frames.map(quadroNoLog)).toEqual(['21.29s missing', '40s covered: o card do topo tampa "você"', '77.39s ok']);
  });
  it('porta sem status/problem (mock antigo): covered pelo flag, problem/reason null', () => {
    const c = captionCheckOf({ frames: [q({ ok: false, duplicated: true })] }, 1);
    expect(c.status).toBe('covered');
    expect(c.frames[0]).toEqual({ atSec: 1, ok: false, seen: 'oi', problem: null, reason: null });
  });
});
