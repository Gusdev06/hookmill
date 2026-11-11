// F2 (troca de legenda, §15.6.5): o builder liga a decisão real. `ctx.swap` (veredito.swap + placa CAPTION READY) troca o padrão "bloqueia"
// (CAPTION_PROTECTED) por `decidirLegenda`/`decidirLegendaAutoEdit` com `swap`: a PLACA vira o vídeo da peça, sem faixa protegida, com a nossa legenda.
import type { FrameSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import { buildAutoEditInput } from './auto-edit';
import { amostrasDoTemplate } from '../iteracao/legenda-protegida';
import { buildFrameInput } from './frame';

const PLACA = 'https://s3/placa-caption.mp4';
const editMap = {
  version: 1, width: 720, height: 1280, fps: 30, frameCount: 300, mainSpeaker: { box: { x: 0, y: 187, w: 720, h: 933 } },
  faceTrack: [{ startFrame: 0, endFrame: 300, region: { x: 0, y: 187, w: 720, h: 933 }, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }] }],
  layers: [{ id: 'c', box: { x: 0, y: 200, w: 720, h: 870 }, startFrame: 0, endFrame: 300, kind: 'caption', style: { fontSizePx: 60, lineHeight: 1.15 } }],
};
const ctx = (over: Partial<AutoEditContext> = {}): AutoEditContext => ({
  renderId: 'r-swap', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: 'en',
  source: { videoUrl: 'https://s3/c.mp4', width: 720, height: 1280, fps: 30, durationSec: 10, hasAudio: true },
  editMap: editMap as never, words: [{ word: 'hello', startSec: 0.2, endSec: 0.6 }, { word: 'world', startSec: 0.7, endSec: 1.1 }],
  silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null, ...over,
});
const brand = { name: 'Coluna', handle: '@c', initials: 'C', color: '#5B4BF5' };
const live = { template: 'live', texts: {}, screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as unknown as FrameSpec;
const TELA_TODA = [{ x: 0, y: 0, w: 1080, h: 1920 }];

// fixture realista (a do campeão 27 da S3: 720×1280, rosto no alto, legenda de 1 linha, caixa 202,947 317×46, corpo 35)
const em27 = {
  version: 1, width: 720, height: 1280, fps: 30, frameCount: 1017,
  faceTrack: [{ startFrame: 0, endFrame: 1017, region: { x: 0, y: 0, w: 720, h: 1280 }, fullFrame: true, facesMax: 1, minScore: 0.9, faceInRegion: [{ atFrame: 0, box: { x: 0.305, y: 0.14, w: 0.427, h: 0.345 } }] }],
  layers: [{ id: 'c', kind: 'caption', startFrame: 0, endFrame: 1017, box: { x: 202, y: 947, w: 317, h: 46 }, background: { kind: 'none', color: null, box: null }, style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 35, lineHeight: 1.1, color: '#ffffff', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 4, shadow: true, align: 'center' }, text: null, wordsPerPage: 1, source: 'vision' }],
};

describe('troca de legenda no builder (decisão real)', () => {
  it('sem swap, ou com a placa ainda não pronta: o formato continua bloqueado (CAPTION_PROTECTED)', () => {
    expect(() => buildFrameInput(live, ctx(), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
    expect(() => buildFrameInput(live, ctx({ swap: { swap: true, plateReady: false, plateUrl: PLACA } }), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
    expect(() => buildFrameInput(live, ctx({ swap: { swap: false, plateReady: true, plateUrl: PLACA } }), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
  });

  it('swap pronto, mas a faixa antiga ficaria à vista sem texto em cima (nada a esconde): continua bloqueado, sem retoque à mostra', () => {
    expect(() => buildFrameInput(live, ctx({ swap: { swap: true, plateReady: true, plateUrl: PLACA } }), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
  });

  it('swap pronto e a faixa antiga escondida (opaco por cima): oferece; a placa é o vídeo, sem faixa protegida, com a nossa legenda', () => {
    // a legenda larga de `editMap` não deixa onde pôr a nossa: com o opaco manual a decisão passa o resíduo, mas SEM lugar para a legenda nova não oferece
    expect(() => buildFrameInput(live, ctx({ swap: { swap: true, plateReady: true, plateUrl: PLACA, opacos: TELA_TODA } }), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);
  });

  // fixture realista (a do campeão 27 da S3: 720×1280, rosto no alto, legenda de 1 linha, caixa 202,947 317×46, corpo 35)
  const c27 = (over: Partial<AutoEditContext> = {}) => ctx({ editMap: em27 as never, source: { videoUrl: 'https://s3/c.mp4', width: 720, height: 1280, fps: 30, durationSec: 33.9, hasAudio: true }, ...over });
  const swapOk = { swap: true, plateReady: true, plateUrl: PLACA };

  it('F2: question_box é RESGATADO sem opaco manual: o cartão do layout cobre a faixa antiga; a placa vira o vídeo, com a nossa legenda', () => {
    // o texto decide a altura do cartão: com a amostra do plano (a mesma que a guarda usa) o cartão chega até a faixa; uma pergunta de 1 linha não chegaria (e bloquearia)
    const spec = { ...live, template: 'question_box', texts: amostrasDoTemplate('question_box', 'en')[0] } as never;
    expect(() => buildFrameInput(spec, c27(), 'VERTICAL_9_16')).toThrow(/CAPTION_PROTECTED/);   // sem swap: bloqueia
    const i = buildFrameInput(spec, c27({ swap: swapOk }), 'VERTICAL_9_16');
    expect(i.video.source.videoUrl).toBe(PLACA);
    expect(i.video.protectedBands).toBeUndefined();
    expect(i.video.burnedTextBands?.length).toBeGreaterThan(0);   // a faixa antiga virou "texto a esconder", não "a proteger"
    expect(i.captionMode).toBe('avoid');
    expect(i.captions?.words.length).toBeGreaterThan(0);
  });

  it('F2 (regra de resíduo de 12/11): com a placa READY o apagado à vista vale; read_caption e live são resgatados, post_card segue bloqueado (a legenda nova não tem onde entrar)', () => {
    const tentar = (t: string, texts: unknown, over: Partial<AutoEditContext> = {}) => {
      const spec = { ...live, template: t, texts } as never;
      try { return buildFrameInput(spec, c27({ swap: swapOk, ...over }), 'VERTICAL_9_16'); } catch (e) { return (e as { code?: string }).code; }
    };
    for (const t of ['read_caption', 'live']) {
      const r = tentar(t, amostrasDoTemplate(t as never, 'en')[0]) as { video: { source: { videoUrl: string } }; captions?: { words: unknown[] } };
      expect([t, r?.video?.source?.videoUrl, (r?.captions?.words.length ?? 0) > 0]).toEqual([t, PLACA, true]);
    }
    expect(tentar('post_card', amostrasDoTemplate('post_card', 'en')[0])).toBe('CAPTION_PROTECTED');
    // `exigirResiduo` religa a regra antiga: sem opaco que esconda a faixa, bloqueia
    expect(tentar('read_caption', amostrasDoTemplate('read_caption', 'en')[0], { swap: { ...swapOk, exigirResiduo: true } })).toBe('CAPTION_PROTECTED');
  });

  it('F2: a legenda nova vem do estilo MEDIDO (ctx.swap.legenda): palavras sem pontuação, caixa do destaque, sem traço; é ela que o builder usa', () => {
    const legenda = { words: [{ word: 'IN', startSec: 0.2, endSec: 0.5 }, { word: 'MORNING', startSec: 0.5, endSec: 1 }], highlightColor: '#ffffff', language: 'en',
      style: { fontId: null, uppercase: true, color: '#fcfcfc', highlightColor: null, strokeColor: null, strokeWidthRel: 0, sizeRel: 0.04, shadow: false, wordsPerPage: 3, highlightBox: { color: '#6f26d9', radiusRel: 0.2 } } };
    const spec = { ...live, template: 'read_caption', texts: amostrasDoTemplate('read_caption', 'en')[0] } as never;
    const i = buildFrameInput(spec, c27({ swap: { ...swapOk, legenda: legenda as never } }), 'VERTICAL_9_16');
    expect(i.captions?.words.map((w) => w.word)).toEqual(['IN', 'MORNING']);
    expect(i.captions?.style?.highlightBox).toEqual({ color: '#6f26d9', radiusRel: 0.2 });
    expect(i.captions?.style?.strokeColor).toBeNull();
  });
});

describe('seam do plano: a decisão real é o padrão', () => {
  it('swapDecisao.decidir = decidirSwapReal; plano e build concordam: sem lugar para a legenda nova bloqueia; com lugar, resgata', async () => {
    const { decidirSwapReal, swapDecisao } = await import('../iteracao/legenda-protegida');
    expect(swapDecisao.decidir).toBe(decidirSwapReal);
    const falas = [{ word: 'hello', startSec: 0.2, endSec: 0.6 }, { word: 'world', startSec: 0.7, endSec: 1.1 }];
    const base = { source: { width: 720, height: 1280, fps: 30, durationSec: 10, hasAudio: true }, words: falas, silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', language: 'en', brandColor: null };
    const item = (t: string) => ({ type: 'FRAME' as const, params: { ...live, template: t, texts: amostrasDoTemplate(t as never, 'en')[0] } as unknown as Record<string, unknown> });
    // legenda larga que ocupa o quadro: a nossa não tem onde entrar → bloqueia (a decisão do plano = a do build)
    expect(decidirSwapReal({ item: item('live'), reason: 'no_room' as never, track: {} as never, s: { ...base, editMap: editMap as never } })).toBe('blocked');
    // legenda de 1 linha (campeão 27): read_caption e live resgatam; post_card não
    const s27 = { ...base, editMap: em27 as never, source: { ...base.source, durationSec: 33.9 } };
    expect(decidirSwapReal({ item: item('read_caption'), reason: 'no_room' as never, track: {} as never, s: s27 })).toBe('swap');
    expect(decidirSwapReal({ item: item('post_card'), reason: 'no_room' as never, track: {} as never, s: s27 })).toBe('blocked');
  });
});
