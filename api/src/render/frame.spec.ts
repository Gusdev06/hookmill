// estatico-montado-e-molduras-v1 §B2: buildFrameInput (função pura do video) + igualdade de tipos video × contratos.
import type { FrameTemplateId as FrameIdContrato, FrameTexts as FrameTextsContrato } from '@maquina/contratos';
import { FRAME_IDS, molduraSchema, type FrameTextsMap, type MolduraId, type FrameTemplateId as FrameIdVideo } from '@maquina/video';
import type { FrameSpec } from '../integracoes/contrato';
import { FRAME_BUILDER, frameSpecOf, type FrameBuilder } from '../edicao/frame-input';
import type { AutoEditContext } from './auto-edit';
import { kindDe, isFrame, type RenderInput } from './contrato';
import { buildFrameInput, FrameTextOverflowError } from './frame';

// ── teste de tipo: falha no tsc (e no ts-jest) se os ids/textos divergirem ──
type Igual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const idsIguais: Igual<MolduraId, FrameIdContrato> = true;
const idsIguaisVideo: Igual<FrameIdVideo, FrameIdContrato> = true;
type TextosCompat<K extends FrameIdContrato> = FrameTextsContrato[K] extends FrameTextsMap[K] ? (FrameTextsMap[K] extends FrameTextsContrato[K] ? true : false) : false;
type TodosCompat = { [K in Exclude<FrameIdContrato, 'live'>]: TextosCompat<K> }[Exclude<FrameIdContrato, 'live'>];
const textosCompat: TodosCompat = true;
// a assinatura que o backend injeta no token FRAME_BUILDER
const builder: FrameBuilder = buildFrameInput;

const ctx = (over: Partial<AutoEditContext> = {}): AutoEditContext => ({
  renderId: 'r-frame', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: 'pt',
  source: { videoUrl: 'https://s3/take.mp4', width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
  editMap: {
    width: 960, height: 960, fps: 24, frameCount: 745, layers: [],
    faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
  } as never,
  words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null, ...over,
});
const brand = { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' };
const spec = (template: FrameIdContrato, texts: unknown, over: Partial<FrameSpec> = {}): FrameSpec =>
  ({ template, texts, screenLanguage: 'pt', brand, faceAtSec: null, second: null, suggestedPrimaryText: null, ...over }) as FrameSpec;

describe('tipos video × contratos', () => {
  it('MolduraId = FrameTemplateId do contrato; textos com a mesma forma; FrameBuilder aceita o buildFrameInput', () => {
    expect([idsIguais, idsIguaisVideo, textosCompat]).toEqual([true, true, true]);
    expect(typeof builder).toBe('function');
    expect(typeof FRAME_BUILDER).toBe('symbol');
    expect(FRAME_IDS).toHaveLength(18);
  });
});

describe('buildFrameInput', () => {
  it('kind frame no RenderInput: campeão inteiro, safeArea do formato, marca do backend, valida no schema da composição', () => {
    for (const format of ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const) {
      const i = buildFrameInput(spec('news', { topic: 'Saúde', headline: { lead: 'Rotina de 10 minutos:', highlight: 'a dor vem da noite' }, dek: 'Leve.', cta: 'Veja' }), ctx(), format);
      const r: RenderInput = i;
      expect(isFrame(r)).toBe(true);
      expect(kindDe(r)).toBe('frame');
      expect(i).toMatchObject({ kind: 'frame', renderId: 'r-frame', templateId: 'frame', format, language: 'pt', frame: { id: 'news', brand } });
      expect(i.video.timeline).toEqual([{ startSec: 0, endSec: 31.04 }]);
      expect(molduraSchema.safeParse({ ...i, kind: undefined, renderId: undefined, templateId: undefined }).success).toBe(true);
    }
  });

  it('reenquadra na caixa sempre em cover (nunca contain_blur), centrado no rosto', () => {
    expect(buildFrameInput(spec('live', {}), ctx(), 'VERTICAL_9_16').video.reframe).toEqual({ mode: 'cover', focus: { x: 0.54, y: 0.375 } });
    expect(buildFrameInput(spec('meme', { pov: 'acordo travado', cta: 'Veja' }), ctx(), 'VERTICAL_9_16').video.reframe.mode).toBe('cover');
    expect(buildFrameInput(spec('live', {}), ctx({ editMap: null }), 'VERTICAL_9_16').video.reframe).toEqual({ mode: 'cover', focus: { x: 0.5, y: 0.4 } });
  });

  it('campeão letterbox (25/10): contentBox = a célula do vídeo real; legenda queimada vira burnedTextBands; texto desvia', () => {
    const em = {
      version: 1, width: 720, height: 1280, fps: 29.97, frameCount: 2544, mainSpeaker: { box: { x: 0, y: 187, w: 720, h: 933 } },
      faceTrack: [{ startFrame: 0, endFrame: 2544, region: { x: 0, y: 187, w: 720, h: 933 }, faceInRegion: [{ atFrame: 0, box: { x: 0.36, y: 0.1, w: 0.38, h: 0.4 } }] }],
      layers: [{ box: { x: 58, y: 96, w: 605, h: 77 }, startFrame: 0, endFrame: 2544, kind: 'headline' }, { box: { x: 100, y: 624, w: 500, h: 194 }, startFrame: 0, endFrame: 2537, kind: 'caption' }],
    };
    const c = ctx({ source: { videoUrl: 'https://s3/c.mp4', width: 720, height: 1280, fps: 29.97, durationSec: 84.99, hasAudio: true }, editMap: em as never, language: 'zh-TW' });
    const i = buildFrameInput(spec('read_caption', { headline: '你夜晚的這個小細節，*決定了你醒來的感覺*', primaryText: 'x' }, { screenLanguage: 'zh' }), c, 'VERTICAL_9_16');
    expect(i.video.contentBox).toEqual({ x: 0, y: 187, w: 720, h: 933 });
    // legenda: +1 linha em cima e embaixo (sem estilo medido, meia caixa): 624-97 .. 818+97 (bug 26/10)
    expect(i.video.burnedTextBands).toEqual([{ y: 527, h: 388, startSec: 0, endSec: 84.651 }]);
    expect(i.language).toBe('zh-TW'); // 'zh' herda a região do lote (tradicional)
    // legenda-protegida-v1: a legenda vira faixa protegida (folga 4 % / 2 %) e o layout desvia dela (passo 1)
    expect(i.video.protectedBands).toEqual([{ x: 86, y: 573, w: 528, h: 296, startSec: 0, endSec: 84.651 }]);
    expect(i.captionMode).toBe('avoid');
  });

  it('legenda protegida mais larga que a janela e em cima do rosto: nem desvia nem recorta = CAPTION_PROTECTED', () => {
    const em = {
      version: 1, width: 720, height: 1280, fps: 30, frameCount: 300, mainSpeaker: { box: { x: 0, y: 187, w: 720, h: 933 } },
      faceTrack: [{ startFrame: 0, endFrame: 300, region: { x: 0, y: 187, w: 720, h: 933 }, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }] }],
      layers: [{ box: { x: 0, y: 560, w: 720, h: 120 }, startFrame: 0, endFrame: 300, kind: 'caption' }],
    };
    const c = ctx({ source: { videoUrl: 'https://s3/c.mp4', width: 720, height: 1280, fps: 30, durationSec: 10, hasAudio: true }, editMap: em as never });
    expect(() => buildFrameInput(spec('live', {}), c, 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
  });

  it('rosto redondo só nas molduras com rosto: faceAtSec do spec, caixa do faceTrack (ou padrão sem rosto)', () => {
    const q = buildFrameInput(spec('question_box', { question: 'Dói?' }, { faceAtSec: 3.2 }), ctx(), 'VERTICAL_9_16');
    expect(q.face).toEqual({ kind: 'face_crop', atSec: 3.2, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } });
    expect(buildFrameInput(spec('question_box', { question: 'Dói?' }), ctx({ editMap: null }), 'VERTICAL_9_16').face).toMatchObject({ kind: 'face_crop', box: { x: 0.3, y: 0.08, w: 0.4, h: 0.4 } });
    expect(buildFrameInput(spec('meme', { pov: 'x', cta: 'y' }), ctx(), 'VERTICAL_9_16').face).toBeUndefined();
  });

  it('2ª fonte (B2): segmento do campeão com reenquadramento da caixa, captura, foto, b-roll com a duração baixada', () => {
    const s1 = buildFrameInput(spec('split_stack', { headline: 'Dor' }, { second: { kind: 'champion_segment', startSec: 14, endSec: 18 } }), ctx(), 'VERTICAL_9_16');
    expect(s1.second).toMatchObject({ kind: 'champion_segment', startSec: 14, endSec: 18, reframe: { mode: 'cover' } });
    const s2 = buildFrameInput(spec('gossip_white', { headline: 'Dor' }, {
      second: { kind: 'stock_broll', fileUrl: 'https://s3/b.mp4', provenance: { provider: 'pexels', sourceUrl: 'u', creator: null, license: 'Pexels License', licenseCommercialOk: true, startSec: 2, endSec: 7 } },
    }), ctx(), 'PORTRAIT_4_5');
    expect(s2.second).toEqual({ kind: 'stock_broll', fileUrl: 'https://s3/b.mp4', durationSec: 5 });
    expect(buildFrameInput(spec('call', { title: 'Aula', slideTitle: 'Noite 1', slideSteps: ['a', 'b'] }, { second: { kind: 'product_photo', fileUrl: 'https://s3/p.png' } }), ctx(), 'SQUARE_1_1').second)
      .toEqual({ kind: 'product_photo', fileUrl: 'https://s3/p.png' });
  });

  it('texto que não cabe no mínimo de 36 px: erro com code FRAME_TEXT_OVERFLOW (o backend grava na peça)', () => {
    const longa = 'Pneumoultramicroscopicossilicovulcanoconiótico';
    let erro: unknown;
    try { buildFrameInput(spec('split_stack', { headline: `${longa} ${longa.slice(0, 3)}` }), ctx(), 'SQUARE_1_1'); } catch (e) { erro = e; }
    expect(erro).toBeInstanceOf(FrameTextOverflowError);
    expect((erro as { code: string }).code).toBe('FRAME_TEXT_OVERFLOW');
    expect((erro as FrameTextOverflowError).slots[0]).toMatchObject({ slot: 'headline', overflow: 'word' });
  });

  it('zh-TW (bug de 25/10): manchete em chinês sem espaço não vira "palavra longa"; quebra por caractere, linhas no input', () => {
    const s = spec('read_caption', { headline: '你夜晚的這個小細節，*決定了你醒來的感覺*。睡前十分鐘就夠了', primaryText: '早晨的疼痛很少來自早晨。' }, { screenLanguage: 'zh-TW' });
    for (const format of ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const) {
      const i = buildFrameInput(s, ctx(), format);
      expect(i.language).toBe('zh-TW');
    }
  });

  it('acima do limite do contrato (a IA já recebe os limites) = erro de validação, não overflow', () => {
    expect(() => buildFrameInput(spec('question_box', { question: 'a '.repeat(40) }), ctx(), 'VERTICAL_9_16')).toThrow();
  });

  it('frameSpecOf (backend) + buildFrameInput: o payload.params da peça vira input', () => {
    const params = { template: 'read_caption', texts: { headline: 'Leia', primaryText: 'Texto' }, screenLanguage: 'en', brand, suggestedPrimaryText: 'Texto' };
    const i = buildFrameInput(frameSpecOf(params), ctx(), 'VERTICAL_9_16');
    expect(i).toMatchObject({ language: 'en', frame: { id: 'read_caption' } });
  });
});
