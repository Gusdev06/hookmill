// variacao-auto-v1 §7.2-7.6: funções puras do auto-edit (snapSpans, hasWrittenHook, hasEndCard, reframeFor,
// buildAutoEditInput) com os tempos reais do take de teste (video/public/fixtures/reais.json, mlx-whisper local).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EditMap, TeardownSections, TranscriptWord } from '@maquina/contratos';
import { duracaoAutoEdit, propsDeAutoEditInput, reframeFor } from '@maquina/video';
import { hasEndCard, hasWrittenHook, snapSpans, snapSpansEmOrdem } from '../medicao/auto-edit';
import { buildAutoEditInput, handleDe, type AutoEditContext, type AutoItemParams } from './auto-edit';

const reais = JSON.parse(readFileSync(path.resolve(__dirname, '../../../video/public/fixtures/reais.json'), 'utf8'));
const words: TranscriptWord[] = reais.take.flatMap((s: { clipStartSec: number; words: TranscriptWord[] }) =>
  s.words.map((w) => ({ word: w.word, startSec: +(w.startSec + s.clipStartSec).toFixed(3), endSec: +(w.endSec + s.clipStartSec).toFixed(3) })));
const dentroDePalavra = (t: number) => words.find((w) => t > w.startSec + 1e-6 && t < w.endSec - 1e-6) ?? null;

const editMap = (over: Partial<EditMap> = {}): EditMap => ({
  version: 1, width: 960, height: 960, fps: 24, frameCount: 745, cells: [],
  faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
  layers: [], overlaysOverFace: [], profile: null,
  keepEdit: { SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } },
  ...over,
});
const camada = (o: Partial<EditMap['layers'][number]>): EditMap['layers'][number] => ({
  id: 'h', kind: 'headline', startFrame: 0, endFrame: 72, box: { x: 0, y: 0, w: 960, h: 120 },
  background: { kind: 'solid', color: '#d40f0f', box: { x: 0, y: 0, w: 960, h: 120 } },
  style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 34, lineHeight: 1.1, color: '#fff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
  text: 'I FOUND OUT', wordsPerPage: null, source: 'vision+pixel', ...o,
});

describe('snapSpans', () => {
  it('nenhuma borda cai no meio de palavra, mesmo com bordas soltas', () => {
    const r = snapSpans([{ startSec: 0, endSec: 6.7 }, { startSec: 20.7, endSec: 26.3 }], words, []);
    for (const s of r) { expect(dentroDePalavra(s.startSec)).toBeNull(); expect(dentroDePalavra(s.endSec)).toBeNull(); }
    expect(r[0].startSec).toBe(0);
    // "...cheating on me." (6,58) | pausa | "Yes," (6,84): meio da pausa
    expect(r[0].endSec).toBeCloseTo(6.71, 2);
    // "...phone." (20,56) | "I'll" (20,92)
    expect(r[1].startSec).toBeCloseTo(20.74, 2);
  });
  it('borda no meio de "everything," vai pra pausa mais próxima', () => {
    const [s] = snapSpans([{ startSec: 15.9, endSec: 17.5 }], words, []);
    expect(dentroDePalavra(s.startSec)).toBeNull();
    expect(dentroDePalavra(s.endSec)).toBeNull();
  });
  it('usa o silêncio medido dentro da pausa', () => {
    const [s] = snapSpans([{ startSec: 3, endSec: 6.6 }], words, [{ startSec: 6.6, endSec: 6.8 }]);
    expect(s.endSec).toBeCloseTo(6.7, 3);
  });
  it('funde trechos que se tocam e tira os vazios', () => {
    expect(snapSpans([{ startSec: 0, endSec: 6.7 }, { startSec: 6.7, endSec: 12.4 }], words, [])).toHaveLength(1);
    expect(snapSpans([{ startSec: 1.0, endSec: 1.02 }], words, [])).toHaveLength(0);
  });
  it('sem palavras = trechos como vieram', () => {
    expect(snapSpans([{ startSec: 1, endSec: 2 }], [], [])).toEqual([{ startSec: 1, endSec: 2 }]);
  });
  it('snapSpansEmOrdem não reordena (COLD-OPEN)', () => {
    const r = snapSpansEmOrdem([{ startSec: 15.5, endSec: 17.8 }, { startSec: 0, endSec: 31 }], words, []);
    expect(r[0].startSec).toBeGreaterThan(15);
    expect(r[1].startSec).toBe(0);
  });
});

describe('hasWrittenHook / hasEndCard', () => {
  it('gancho escrito = camada não-legenda com texto nos primeiros 3 s', () => {
    expect(hasWrittenHook(null)).toBe(false);
    expect(hasWrittenHook(editMap())).toBe(false);
    expect(hasWrittenHook(editMap({ layers: [camada({})] }))).toBe(true);
    expect(hasWrittenHook(editMap({ layers: [camada({ kind: 'caption', text: null })] }))).toBe(false);
    expect(hasWrittenHook(editMap({ layers: [camada({ startFrame: 100, endFrame: 200 })] }))).toBe(false);   // 4,2 s
  });
  it('end card = texto que fecha o vídeo, ou último bloco com texto sem rosto no fim', () => {
    expect(hasEndCard(null, null)).toBe(false);
    expect(hasEndCard(editMap({ layers: [camada({ startFrame: 700, endFrame: 745, kind: 'text' })] }), null)).toBe(true);
    const td = { structure: { status: 'ok', naReason: null, data: { blocks: [{ label: 'CTA', function: 'cta', startSec: 28, endSec: 31, onScreen: 'Link below', speech: '' }] } } } as unknown as TeardownSections;
    expect(hasEndCard(editMap(), td)).toBe(false);   // o rosto vai até o fim
    expect(hasEndCard(editMap({ timeline: [{ startFrame: 0, endFrame: 700, kind: 'main' }, { startFrame: 700, endFrame: 745, kind: 'broll' }] }), td)).toBe(true);
  });
});

describe('reframeFor', () => {
  it('mesma proporção = cover', () => {
    expect(reframeFor('SQUARE_1_1', { width: 960, height: 960 }, editMap()).mode).toBe('cover');
  });
  it('quadrado → 9:16 com rosto e sem camadas = cover centrado no rosto', () => {
    const r = reframeFor('VERTICAL_9_16', { width: 960, height: 960 }, editMap());
    expect(r).toEqual({ mode: 'cover', focus: { x: 0.54, y: 0.275 } });
  });
  it('camada queimada que sai da janela = contain_blur', () => {
    const r = reframeFor('VERTICAL_9_16', { width: 960, height: 960 }, editMap({ layers: [camada({ box: { x: 20, y: 800, w: 920, h: 100 } })] }));
    expect(r.mode).toBe('contain_blur');
  });
  it('mapa em outra grade é escalado', () => {
    const r = reframeFor('VERTICAL_9_16', { width: 1920, height: 1920 }, editMap());
    expect(r).toEqual({ mode: 'cover', focus: { x: 0.54, y: 0.275 } });
  });
});

describe('buildAutoEditInput', () => {
  const ctx = (params: AutoItemParams, over: Partial<AutoEditContext> = {}): AutoEditContext => ({
    renderId: 'r1', type: params.type, params, language: 'en',
    source: { videoUrl: 'https://x/take.mp4', width: 960, height: 960, fps: 24, durationSec: 31.042, hasAudio: true },
    editMap: editMap(), words, silences: [],
    blocks: [{ index: 0, startSec: 0, endSec: 6.7 }, { index: 1, startSec: 6.7, endSec: 12.4 }, { index: 2, startSec: 12.4, endSec: 20.7 }, { index: 3, startSec: 20.7, endSec: 26.3 }],
    hookEndSec: 6.58, palette: ['#08090f', '#aea197', '#d21f1f'], brandName: 'Northwind Planner', page: { imageUrl: 'https://x/p.png', kind: 'page' }, ...over,
  });
  const formatos = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const;
  const todos: AutoItemParams[] = [
    { type: 'CUT', targetSec: 15, blockIndexes: [3, 0] },
    { type: 'COLD_OPEN', teaserStartSec: 15.5, teaserEndSec: 17.8 },
    { type: 'HOOK_TEXT', text: 'She never knew' },
    { type: 'ENDCARD', variant: 'cta', headline: 'See how it works', subline: null, ctaText: 'Learn more' },
    { type: 'SPLIT_LP' }, { type: 'STORY' },
    { type: 'REVIEW', quote: 'Great', author: null, stars: 5 },
    { type: 'NATIVE_SEARCH', query: 'how to know if my wife is cheating' },
    { type: 'STATIC', atSec: 17.2, headline: 'It showed everything' },
  ];
  it.each(formatos)('os 9 tipos em %s passam no schema da composição e são determinísticos', (fmt) => {
    for (const p of todos) {
      const a = buildAutoEditInput(ctx(p), fmt);
      expect(buildAutoEditInput(ctx(p), fmt)).toEqual(a);
      const props = propsDeAutoEditInput(a as never);
      expect(props.output).toBe(p.type === 'STATIC' ? 'still' : 'video');
      expect(duracaoAutoEdit(props)).toBeGreaterThan(0);
      for (const t of a.timeline) { expect(dentroDePalavra(t.startSec)).toBeNull(); if (t.endSec < 31) expect(dentroDePalavra(t.endSec)).toBeNull(); }
    }
  });
  it('CUT: blocos em ordem, encaixados; duração = soma', () => {
    const a = buildAutoEditInput(ctx(todos[0]), 'VERTICAL_9_16');
    expect(a.timeline.map((t) => t.startSec)).toEqual([0, expect.closeTo(20.74, 2)]);
    expect(duracaoAutoEdit(propsDeAutoEditInput(a as never))).toBe(Math.round(6.71 * 30) + Math.round(a.timeline[1].endSec * 30) - Math.round(a.timeline[1].startSec * 30));
  });
  it('COLD_OPEN: teaser + vídeo inteiro', () => {
    const a = buildAutoEditInput(ctx(todos[1]), 'SQUARE_1_1');
    expect(a.timeline).toHaveLength(2);
    expect(a.timeline[1]).toEqual({ startSec: 0, endSec: 31.042 });
    expect(a.params).toMatchObject({ type: 'COLD_OPEN' });
    // 15,5-17,8 encaixaria em 16,47-17,85 (1,38 s): a trava estica até a próxima pausa
    expect(a.timeline[0].endSec - a.timeline[0].startSec).toBeGreaterThanOrEqual(1.5);
    expect((a.params as { teaserSec: number }).teaserSec).toBeGreaterThanOrEqual(1.5);
    for (const t of [a.timeline[0].startSec, a.timeline[0].endSec]) expect(dentroDePalavra(t)).toBeNull();
  });
  it('ENDCARD: +2 s', () => {
    const a = buildAutoEditInput(ctx(todos[3]), 'VERTICAL_9_16');
    expect(duracaoAutoEdit(propsDeAutoEditInput(a as never))).toBe(Math.round(31.042 * 30) + 60);
  });
  it('HOOK_TEXT tapa o gancho escrito do original com a cor da faixa', () => {
    const a = buildAutoEditInput(ctx(todos[2], { editMap: editMap({ layers: [camada({})] }) }), 'SQUARE_1_1');
    expect(a.params).toMatchObject({ type: 'HOOK_TEXT', endSec: 3, cover: { color: '#d40f0f' } });
    const p = a.params as Extract<typeof a.params, { type: 'HOOK_TEXT' }>;
    expect(p.cover!.box.y).toBeLessThanOrEqual(0);
    expect(p.box.y).toBeGreaterThanOrEqual(0);
  });
  it('HOOK_TEXT sem gancho escrito: caixa dentro da safeArea, fora do rosto', () => {
    const a = buildAutoEditInput(ctx(todos[2]), 'VERTICAL_9_16');
    const p = a.params as Extract<typeof a.params, { type: 'HOOK_TEXT' }>;
    expect(p.cover).toBeNull();
    expect(p.box.y).toBeGreaterThanOrEqual(a.safeArea.top);
    expect(p.box.y + p.box.h).toBeLessThanOrEqual(1920 - a.safeArea.bottom);
  });
  it('SPLIT_LP sem página falha; REVIEW/SPLIT sempre cover', () => {
    expect(() => buildAutoEditInput(ctx(todos[4], { page: null }), 'VERTICAL_9_16')).toThrow();
    const a = buildAutoEditInput(ctx(todos[6], { editMap: editMap({ layers: [camada({ box: { x: 20, y: 800, w: 920, h: 100 } })] }) }), 'VERTICAL_9_16');
    expect(a.reframe.mode).toBe('cover');
  });
  it('STORY e NATIVE_SEARCH localizados pela língua da fala', () => {
    const s = buildAutoEditInput(ctx(todos[5], { language: 'pt-BR' }), 'VERTICAL_9_16');
    expect(s.params).toMatchObject({ handle: '@northwindplanner', replyLabel: 'Enviar mensagem', bars: 3 });
    const n = buildAutoEditInput(ctx(todos[7], { language: 'pt-BR' }), 'VERTICAL_9_16');
    expect(n.params).toMatchObject({ placeholder: 'Pesquisar', typingCps: 14 });
    expect((n.params as { introSec: number }).introSec).toBeLessThanOrEqual(2.5);
    expect(handleDe('Café São João')).toBe('@cafesaojoao');
  });
});

describe('valeMaisProximo (emendas no silêncio do áudio)', () => {
  // envelope de 10 em 10 ms começando em 16,0 s: fala, vale fundo em 16,20-16,28, fala
  const env = [...Array(20).fill(-15), ...Array(8).fill(-35), ...Array(30).fill(-16)];
  it('acha o vale perto da borda do Whisper', () => {
    const { valeMaisProximo } = jest.requireActual('./emendas');
    const v = valeMaisProximo(env, 16.0, 16.36);
    expect(v.t).toBeGreaterThanOrEqual(16.2);
    expect(v.t).toBeLessThanOrEqual(16.28);
    expect(v.db).toBeLessThan(-30);
  });
});
