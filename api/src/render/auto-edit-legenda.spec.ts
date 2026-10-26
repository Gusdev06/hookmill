// legenda-protegida-v1 no AutoEdit (26/10): CUT/NATIVE_SEARCH/REVIEW desviam, recortam e legendam, ou bloqueiam.
import { buildAutoEditInput, type AutoEditContext } from './auto-edit';

const em = (caption: { x: number; y: number; w: number; h: number }, rostoY = 0.1) => ({
  version: 1, width: 960, height: 960, fps: 24, frameCount: 288, cells: [], overlaysOverFace: [], profile: null, keepEdit: {},
  faceTrack: [{ startFrame: 0, endFrame: 288, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: rostoY, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
  layers: [{ id: 'c', kind: 'caption', box: caption, startFrame: 0, endFrame: 288, text: null, wordsPerPage: 3, source: 'vision', background: { kind: 'none', color: null, box: null },
    style: { fontId: 'montserrat-900', uppercase: true, fontSizePx: 46, lineHeight: 1.1, color: '#FFFFFF', highlightColor: '#FFD43B', strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' } }],
});
const ctx = (o: Partial<AutoEditContext>): AutoEditContext => ({
  renderId: 'r', type: 'CUT', params: { type: 'CUT', targetSec: 15, blockIndexes: [0] }, language: 'en',
  source: { videoUrl: 'https://s3/t.mp4', width: 960, height: 960, fps: 24, durationSec: 12, hasAudio: true },
  editMap: em({ x: 130, y: 795, w: 700, h: 60 }) as never, words: [{ word: 'hey', startSec: 0, endSec: 0.3 }], silences: [], blocks: [{ index: 0, startSec: 0, endSec: 7.5 }],
  hookEndSec: null, palette: ['#5B4BF5'], brandName: 'A', page: null, ...o,
});

describe('AutoEdit × legenda protegida', () => {
  it('CUT com a legenda cabendo na janela do cover: desvia (avoid), sem legenda nossa e sem borrado', () => {
    const i = buildAutoEditInput(ctx({ editMap: em({ x: 300, y: 795, w: 360, h: 60 }) as never }), 'VERTICAL_9_16');
    expect(i.captionMode).toBe('avoid');
    expect(i.reframe.mode).toBe('cover');
    expect(i.protectedBands?.length).toBe(1);
    expect(i.captions).toBeUndefined();
  });
  it('CUT de take quadrado com legenda mais larga que a janela do cover (sem borrado): recorta e legenda de novo', () => {
    const i = buildAutoEditInput(ctx({}), 'VERTICAL_9_16');
    expect(i.reframe.mode).toBe('cover');
    expect(i.captionMode).toBe('replace');
  });
  it('NATIVE_SEARCH: a tela de busca cobriria a legenda → recorta sem ela e põe a nossa no estilo da original', () => {
    const i = buildAutoEditInput(ctx({ type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: 'dor nas costas' } }), 'VERTICAL_9_16');
    expect(i.captionMode).toBe('replace');
    expect(i.contentBox!.y + i.contentBox!.h).toBeLessThanOrEqual(i.protectedBands![0].y);
    expect(i.captions?.style).toMatchObject({ fontId: 'montserrat-900', uppercase: true, color: '#FFFFFF', highlightColor: '#FFD43B' });
  });
  it('legenda atravessando o rosto: não dá pra recortar → CAPTION_PROTECTED (face_cut)', () => {
    expect(() => buildAutoEditInput(ctx({ type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: 'x' }, editMap: em({ x: 130, y: 250, w: 700, h: 60 }) as never }), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
  });
});

describe("captionMode 'replace' forçado nos builders (Retry depois de CAPTION_COVERED)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildFrameInput } = require('./frame') as typeof import('./frame');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildHeadlineInput } = require('./headline') as typeof import('./headline');
  const brand = { name: 'A', handle: '@a', initials: 'A', color: '#5B4BF5' };
  const estreita = ctx({ editMap: em({ x: 300, y: 795, w: 360, h: 60 }) as never });
  it('AutoEdit e Moldura: o que desviaria vai direto pro recorte com a nossa legenda', () => {
    expect(buildAutoEditInput(estreita, 'VERTICAL_9_16').captionMode).toBe('avoid');
    expect(buildAutoEditInput(estreita, 'VERTICAL_9_16', { captionMode: 'replace' }).captionMode).toBe('replace');
    const f = buildFrameInput({ template: 'meme', texts: { pov: 'x', cta: 'y' }, screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as never, estreita, 'VERTICAL_9_16', { captionMode: 'replace' });
    expect(f.captionMode).toBe('replace');
    expect(f.captions?.style?.fontId).toBe('montserrat-900');
  });
  it('recorte impossível (legenda no rosto) ou HEADLINE (remix-keep não recorta) = CAPTION_PROTECTED', () => {
    const noRosto = ctx({ editMap: em({ x: 130, y: 250, w: 700, h: 60 }) as never });
    expect(() => buildAutoEditInput(noRosto, 'VERTICAL_9_16', { captionMode: 'replace' })).toThrow(/CAPTION_PROTECTED/);
    expect(() => buildHeadlineInput({ mode: 'add', text: 'Oi', highlight: null, language: 'pt', brandColor: '#5B4BF5' }, estreita, { captionMode: 'replace' })).toThrow(/CAPTION_PROTECTED/);
  });
});

describe('outputProtectedBands: a legenda no vídeo renderizado (checagem por visão)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildFrameInput } = require('./frame') as typeof import('./frame');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildHeadlineInput } = require('./headline') as typeof import('./headline');
  const brand = { name: 'A', handle: '@a', initials: 'A', color: '#5B4BF5' };
  const estreita = ctx({ editMap: em({ x: 300, y: 795, w: 360, h: 60 }) as never });
  it('AutoEdit avoid: a faixa original em px da saída, dentro do quadro, com o intervalo na peça', () => {
    const i = buildAutoEditInput(estreita, 'VERTICAL_9_16');
    const [b] = i.outputProtectedBands!;
    expect(b.kind).toBe('original');
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1080 && b.y + b.h <= 1920).toBe(true);
    expect(b.y).toBeGreaterThan(1000); // a legenda (y 795 de 960) cai na parte de baixo da saída
    expect([b.startSec, b.endSec]).toEqual([0, 7.5]);
  });
  it('Moldura replace: a região da NOSSA legenda (kind replaced)', () => {
    const f = buildFrameInput({ template: 'meme', texts: { pov: 'x', cta: 'y' }, screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as never, estreita, 'VERTICAL_9_16', { captionMode: 'replace' });
    expect(f.outputProtectedBands).toHaveLength(1);
    expect(f.outputProtectedBands![0].kind).toBe('replaced');
    const vb = { y: 640, h: 880 };
    expect(f.outputProtectedBands![0].y).toBeGreaterThanOrEqual(vb.y);
  });
  it('HEADLINE (remix-keep, quadro do campeão): a faixa no arquivo = a faixa na saída', () => {
    const h = buildHeadlineInput({ mode: 'add', text: 'Oi', highlight: null, language: 'pt', brandColor: '#5B4BF5' }, estreita);
    expect(h.outputProtectedBands![0]).toMatchObject({ kind: 'original', x: Math.round(300 - 0.02 * 960) });
  });
});
