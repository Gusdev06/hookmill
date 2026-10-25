// Molduras (contrato estatico-montado-e-molduras-v1 §B2-§B6): layout puro 18 x 3 formatos, fitText com textos no
// limite em pt/en/es, reenquadramento na caixa, schema e textos fixos por idioma.
import {
  FORMATOS, FRAME_IDS, FRAME_MIN_FONT_PX, TEXT_LIMITS, fitText, frameLayout, frameUi, medirTexto, molduraSchema, propsDeFrameInput,
  reframeNaCaixa, pinturaNaCaixa, textosQueNaoCouberam, duracaoMoldura, opcoesDeLayout, contentBoxDe, faixasQueimadasDe, faixasNaSaida,
  type EditMapLike, type FrameTemplateId, type FrameTextsMap, type VideoFormat,
} from '../src/lib';

const FORMATS: VideoFormat[] = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'];

/** Repete a frase até exatamente n caracteres (texto no limite do contrato). */
const lim = (frase: string, n: number) => {
  let s = '';
  while (s.length < n) s += (s ? ' ' : '') + frase;
  s = s.slice(0, n);
  return s.endsWith(' ') ? `${s.slice(0, -1)}a` : s;
};

/** Textos no limite, por idioma (acentos, ñ, ¿¡, palavras longas). */
const FRASES = {
  pt: { a: 'Por que minha lombar trava toda manhã quando levanto da cama', b: 'Saúde', c: 'Toque no botão e garanta já', p: 'R$ 1.997,90' },
  en: { a: 'Why does my lower back lock up every single morning when I get up', b: 'Health', c: 'Tap the button and grab it', p: '$1,997.99' },
  es: { a: '¿Por qué mi espalda baja se traba cada mañana al levantarme?', b: 'Salud', c: 'Toca el botón y aprovéchalo', p: '$1.997,90' },
};
type Lang = keyof typeof FRASES;
const noLimite = (l: Lang): FrameTextsMap => {
  const f = FRASES[l];
  const T = TEXT_LIMITS;
  return {
    question_box: { question: lim(f.a, T.question_box.question) },
    meme: { pov: lim(f.a, T.meme.pov), cta: lim(f.c, T.meme.cta) },
    cinema: { question: lim(f.a, T.cinema.question), subtitle: lim(f.a, T.cinema.subtitle) },
    news: { topic: lim(f.b, T.news.topic), headline: { lead: lim(f.a, T.news.lead), highlight: lim(f.a, T.news.highlight) }, dek: lim(f.a, T.news.dek), cta: lim(f.c, T.news.cta) },
    read_caption: { headline: lim(f.a, T.read_caption.headline), primaryText: lim(f.a, 600) },
    pov_testimonial: { pov: lim(f.a, T.pov_testimonial.pov), cta: lim(f.c, T.pov_testimonial.cta) },
    direct_offer: { promise: lim(f.a, T.direct_offer.promise), price: { from: f.p, to: f.p }, cta: lim(f.c, T.direct_offer.cta) },
    live: {},
    ranking: { title: lim(f.a, T.ranking.title), items: [1, 2, 3, 4, 5].map((i) => lim(`${i} ${f.a}`, T.ranking.item)) },
    post_card: { copy: lim(f.a, T.post_card.copy) },
    split_stack: { headline: lim(f.a, T.split_stack.headline) },
    split_torn: { headline: lim(f.a, T.split_torn.headline) },
    gossip_page: { headline: lim(f.a, T.gossip_page.headline), pageName: lim(f.a, T.gossip_page.pageName) },
    gossip_white: { headline: lim(f.a, T.gossip_white.headline) },
    gossip_pink: { headline: lim(f.a, T.gossip_pink.headline) },
    call: { title: lim(f.a, T.call.title), slideTitle: lim(f.a, T.call.slideTitle), slideSteps: [1, 2, 3].map((i) => lim(`${i} ${f.a}`, T.call.step)) },
    call_dialog: { title: lim(f.a, T.call_dialog.title), names: [lim(f.b, 14), lim(f.b, 14)] },
    story: { question: lim(f.a, T.story.question), headline: lim(f.a, T.story.headline), support: lim(f.a, T.story.support), copy: lim(f.a, T.story.copy) },
  };
};

const CURTOS: FrameTextsMap = {
  question_box: { question: 'Dói?' }, meme: { pov: 'dor', cta: 'Veja' }, cinema: { question: 'E se?', subtitle: 'Leve.' },
  news: { topic: 'Saúde', headline: { lead: 'Dor:', highlight: 'noite' }, dek: 'Leve.', cta: 'Veja' }, read_caption: { headline: 'Leia', primaryText: 'x' },
  pov_testimonial: { pov: 'dormi', cta: 'Teste' }, direct_offer: { promise: 'Leve', price: { from: null, to: 'R$ 9' }, cta: 'Já' }, live: {},
  ranking: { title: 'Top', items: ['A', 'B', 'C'] }, post_card: { copy: 'Oi.' }, split_stack: { headline: 'Dor' }, split_torn: { headline: 'Dor' },
  gossip_page: { headline: 'Dor', pageName: 'Bem' }, gossip_white: { headline: 'Dor' }, gossip_pink: { headline: 'Dor' },
  call: { title: 'Aula', slideTitle: 'Noite 1', slideSteps: ['A', 'B'] }, call_dialog: { title: 'Conversa', names: ['A', 'B'] },
  story: { question: 'Dói?', headline: 'Tem saída.', support: 'Leve.', copy: 'Leve.' },
};

const dentro = (r: { x: number; y: number; w: number; h: number }, W: number, H: number, tol = 1) => r.x >= -tol && r.y >= -tol && r.x + r.w <= W + tol && r.y + r.h <= H + tol;
// Templates de 1 vídeo cuja caixa é o vídeo da peça (a regra de 55 % do 4:5 vale pra eles; nos de 2 fontes e na chamada
// o vídeo é um quadro da interface, por desenho).
const UM_VIDEO: FrameTemplateId[] = ['question_box', 'meme', 'cinema', 'news', 'read_caption', 'pov_testimonial', 'direct_offer', 'live', 'ranking', 'post_card', 'story'];

describe('frameLayout: 18 templates x 3 formatos', () => {
  for (const lang of ['pt', 'en', 'es'] as Lang[]) {
    for (const [nome, textos] of [['limite', noLimite(lang)], ['curto', CURTOS]] as const) {
      for (const f of FORMATS) {
        it(`${lang} ${nome} ${f}: caixas dentro do canvas, vídeo com tamanho útil, texto fora da safeArea, nada transborda`, () => {
          const { width: W, height: H } = FORMATOS[f];
          for (const id of FRAME_IDS) {
            const L = frameLayout(id, f, textos[id] as never, lang);
            const ctx = `${id} ${f}`;
            expect([ctx, dentro(L.videoBox, W, H)]).toEqual([ctx, true]);
            if (L.secondBox) expect([ctx, dentro(L.secondBox, W, H)]).toEqual([ctx, true]);
            if (L.faceBox) expect([ctx, dentro(L.faceBox, W, H)]).toEqual([ctx, true]);
            expect([ctx, L.videoBox.w >= 300 && L.videoBox.h >= 300]).toEqual([ctx, true]);
            if (f === 'PORTRAIT_4_5' && UM_VIDEO.includes(id)) expect([ctx, L.videoBox.h / H >= 0.55]).toEqual([ctx, true]);
            for (const [k, s] of Object.entries(L.slots)) {
              const ok = s.y >= L.safe.top - 1 && s.y + s.h <= H - L.safe.bottom + 1 && s.x >= 0 && s.x + s.w <= W;
              expect([ctx, k, ok, s]).toEqual([ctx, k, true, s]);
            }
            expect([ctx, textosQueNaoCouberam(L)]).toEqual([ctx, []]);
            for (const t of Object.values(L.text)) expect(t.size).toBeGreaterThanOrEqual(FRAME_MIN_FONT_PX);
          }
        });
      }
    }
  }

  it('9:16 = geometria do protótipo aprovado (amostra)', () => {
    const q = frameLayout('question_box', 'VERTICAL_9_16', CURTOS.question_box);
    expect(q.n.cardY).toBe(1010);
    expect(frameLayout('meme', 'VERTICAL_9_16', CURTOS.meme).videoBox).toEqual({ x: 0, y: 640, w: 1080, h: 880 });
    expect(frameLayout('gossip_page', 'VERTICAL_9_16', CURTOS.gossip_page).videoBox).toEqual({ x: 60, y: 620, w: 472, h: 940 });
    expect(frameLayout('split_stack', 'VERTICAL_9_16', CURTOS.split_stack).secondBox).toEqual({ x: 0, y: 960, w: 1080, h: 960 });
  });

  it('1:1 corta o secundário: ranking máx. 3 (TOP 3), sem linha fina, sem subtítulo, sem CTA do meme', () => {
    const t = noLimite('pt');
    expect(frameLayout('ranking', 'SQUARE_1_1', t.ranking).items).toHaveLength(3);
    expect(frameLayout('ranking', 'PORTRAIT_4_5', t.ranking).items).toHaveLength(5);
    expect(frameLayout('news', 'SQUARE_1_1', t.news).text.dek).toBeUndefined();
    expect(frameLayout('cinema', 'SQUARE_1_1', t.cinema).text.subtitle).toBeUndefined();
    expect(frameLayout('meme', 'SQUARE_1_1', t.meme).slots.cta).toBeUndefined();
  });

  it('Oferta direta sem vão: vídeo desce até a promessa; preço e CTA presos ao rodapé', () => {
    for (const f of FORMATS) {
      const L = frameLayout('direct_offer', f, CURTOS.direct_offer);
      expect(L.videoBox.y + L.videoBox.h).toBeGreaterThan(L.slots.promise.y);
      expect(L.slots.cta.y + L.slots.cta.h).toBeCloseTo(FORMATOS[f].height - L.safe.bottom, 5);
      expect(L.slots.price.y - (L.slots.promise.y + L.slots.promise.h)).toBeLessThanOrEqual(40);
    }
  });

  it('Google Meet com foto/captura (2ª fonte): imagem dentro do slide nos 3 formatos, textos no limite cabem', () => {
    expect(opcoesDeLayout({ kind: 'product_photo' })).toEqual({ slideImage: true });
    expect(opcoesDeLayout({ kind: 'champion_segment' })).toEqual({ slideImage: false });
    for (const lang of ['pt', 'en', 'es'] as Lang[]) {
      for (const f of FORMATS) {
        const L = frameLayout('call', f, noLimite(lang).call, lang, { slideImage: true });
        const img = L.slots.slideImage, sl = L.slots.slide;
        expect(img.w).toBeGreaterThan(200);
        expect(img.h).toBeGreaterThan(150);
        expect(img.x >= sl.x && img.y >= sl.y && img.x + img.w <= sl.x + sl.w && img.y + img.h <= sl.y + sl.h).toBe(true);
        expect(textosQueNaoCouberam(L)).toEqual([]);
      }
    }
    expect(frameLayout('call', 'VERTICAL_9_16', CURTOS.call).slots.slideImage).toBeUndefined();
    expect(frameLayout('news', 'VERTICAL_9_16', CURTOS.news, 'pt', { slideImage: true }).slots.slideImage).toBeUndefined();
  });

  it('Google Meet sem slide vazio: o slide tem a altura do conteúdo (9:16 e 4:5)', () => {
    for (const f of ['VERTICAL_9_16', 'PORTRAIT_4_5'] as VideoFormat[]) {
      const curto = frameLayout('call', f, CURTOS.call);
      const longo = frameLayout('call', f, noLimite('pt').call);
      expect(curto.slots.slide.h).toBeLessThan(longo.slots.slide.h);
      expect(curto.videoBox.h).toBeGreaterThan(longo.videoBox.h);
    }
  });
});

describe('fitText', () => {
  it('curto cresce até o máximo; longo encolhe; nunca abaixo de 36 px', () => {
    const o = { font: 'montserrat-800' as const, width: 740, maxLines: 4, max: 70, min: 30 };
    expect(fitText('Dói?', o).size).toBe(70);
    const l = fitText(lim('Por que minha lombar trava toda manhã', 200), o);
    expect(l.size).toBe(FRAME_MIN_FONT_PX);
    expect(l.fits).toBe(false);
    expect(l.overflow).toBe('lines');
  });

  it('palavra maior que a linha: parte por caractere (não corta) e marca overflow word', () => {
    const r = fitText('Pneumoultramicroscopicossilicovulcanoconiótico', { font: 'montserrat-900', width: 400, maxLines: 4, max: 70, min: 44 });
    expect(r.fits).toBe(false);
    expect(r.overflow).toBe('word');
    expect(r.lines.join('')).toBe('Pneumoultramicroscopicossilicovulcanoconiótico');
    for (const ln of r.lines) expect(medirTexto('montserrat-900', ln, r.size)).toBeLessThanOrEqual(400);
  });

  it('as linhas respeitam a largura e o *destaque* não conta', () => {
    const r = fitText('Ninguém te contou, mas a dor que você sente *começa na noite anterior.*', { font: 'inter-600', width: 912, maxLines: 5, max: 54, min: 40 });
    expect(r.fits).toBe(true);
    expect(r.lines.join(' ')).not.toContain('*');
    for (const ln of r.lines) expect(medirTexto('inter-600', ln, r.size)).toBeLessThanOrEqual(912);
  });

  it('medida da tabela: acento cai no avanço da letra, caixa alta mais larga, letter-spacing soma por caractere', () => {
    expect(medirTexto('inter-800', 'ação', 40)).toBeGreaterThan(medirTexto('inter-800', 'aco', 40));
    expect(medirTexto('anton-400', 'LEVE', 100)).toBeGreaterThan(medirTexto('anton-400', 'leve', 100));
    expect(medirTexto('inter-800', 'abc', 40, 0.1) - medirTexto('inter-800', 'abc', 40)).toBeCloseTo(12, 5);
  });
});

describe('textos fixos por idioma', () => {
  it('pt / en / es; variante regional cai no idioma; outro idioma = en', () => {
    expect(frameUi('pt').askQuestion).toBe('Faça uma pergunta');
    expect(frameUi('pt-BR').readCaption).toBe('Leia a legenda');
    expect(frameUi('en').tapButton).toBe('Tap the button');
    expect(frameUi('es-MX').live).toBe('EN VIVO');
    expect(frameUi('fr').comments).toBe('Comments limited');
  });
});

describe('reframeNaCaixa', () => {
  const take = { width: 960, height: 960 };
  const mapa: EditMapLike = {
    width: 960, height: 960, frameCount: 745, layers: [],
    faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }] }],
  };
  it('sempre cover (nunca borrado): take quadrado em tela cheia 9:16 preenche a caixa, rosto a 40 % da altura', () => {
    const r = reframeNaCaixa({ w: 1080, h: 1920 }, take, mapa);
    expect(r).toEqual({ mode: 'cover', focus: { x: 0.54, y: 0.375 } }); // vertical sem folga: a janela é a altura toda
    expect(pinturaNaCaixa({ w: 1080, h: 1920 }, take, r).cheio).toBe(true);
    expect(reframeNaCaixa({ w: 1080, h: 1920 }, take, null)).toEqual({ mode: 'cover', focus: { x: 0.5, y: 0.4 } });
  });
  it('zoom máximo que não corta o rosto: rosto maior que a caixa → scale < 1, sobra fundo (cor da marca)', () => {
    const rostoGrande: EditMapLike = { ...mapa, faceTrack: [{ ...mapa.faceTrack[0], faceInRegion: [{ atFrame: 0, box: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } }] }] };
    const r = reframeNaCaixa({ w: 1080, h: 600 }, take, rostoGrande);
    if (r.mode !== 'cover') throw new Error('cover');
    expect(r.scale).toBeLessThan(1);
    const p = pinturaNaCaixa({ w: 1080, h: 600 }, take, r);
    expect(p.cheio).toBe(false);
    expect(0.8 * 960 * p.s * 0.92).toBeLessThanOrEqual(600 + 1); // rosto (aparando no máx. 4 % em cima/embaixo) cabe na altura
  });
  it('contentBox (letterbox): pinta só a área do vídeo real; a headline nas faixas pretas fica fora', () => {
    const campeao = { width: 720, height: 1280 };
    const em = { width: 720, height: 1280, frameCount: 100, fps: 30, faceTrack: [], mainSpeaker: { box: { x: 0, y: 187, w: 720, h: 933 } },
      layers: [{ box: { x: 58, y: 96, w: 605, h: 77 }, startFrame: 0, endFrame: 100 }, { box: { x: 0, y: 624, w: 689, h: 194 }, startFrame: 0, endFrame: 100 }] };
    const cb = contentBoxDe(campeao, em as never);
    expect(cb).toEqual({ x: 0, y: 187, w: 720, h: 933 });
    const bands = faixasQueimadasDe(campeao, em as never, cb);
    expect(bands).toEqual([{ y: 624, h: 194, startSec: 0, endSec: 3.333 }]); // a headline (y 96) saiu com o recorte
    const r = reframeNaCaixa({ w: 1080, h: 1920 }, campeao, null, 1080, cb);
    const p = pinturaNaCaixa({ w: 1080, h: 1920 }, campeao, r, cb);
    expect(p.cheio).toBe(true);
    expect(p.video.top).toBeCloseTo(-187 * p.s, 3); // o arquivo sobe: a faixa preta de cima fica fora da área
    const f = faixasNaSaida(bands, campeao, r, { x: 0, y: 0, w: 1080, h: 1920 }, cb);
    expect(f).toHaveLength(1);
    expect(f[0].y0).toBeCloseTo((624 - 187) * p.s, -1);
  });
  it('texto da moldura sai de cima da legenda queimada (Caixinha cobre a faixa; Leia a legenda vai pra baixo dela)', () => {
    const faixas = [{ y0: 900, y1: 1300 }];
    const q = frameLayout('question_box', 'VERTICAL_9_16', CURTOS.question_box, 'pt', { faixas });
    const card = q.slots.card;
    const cobre = card.y <= 892 && card.y + card.h >= 1308, fora = card.y >= 1308 || card.y + card.h <= 892;
    expect(cobre || fora).toBe(true);
    const longo = frameLayout('question_box', 'VERTICAL_9_16', { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' }, 'pt', { faixas }).slots.card;
    expect((longo.y <= 892 && longo.y + longo.h >= 1308) || longo.y >= 1308 || longo.y + longo.h <= 892).toBe(true);
    const rc = frameLayout('read_caption', 'VERTICAL_9_16', { headline: 'O detalhe da sua noite que *decide como você acorda*', primaryText: 'x' }, 'pt', { faixas });
    expect(rc.slots.headline.y).toBeGreaterThanOrEqual(1300);
    expect(textosQueNaoCouberam(rc)).toEqual([]);
    expect(frameLayout('question_box', 'VERTICAL_9_16', CURTOS.question_box).n.cardY).toBe(1010); // sem faixa = protótipo
  });
});

describe('molduraSchema / propsDeFrameInput', () => {
  const base = (id: FrameTemplateId, texts: unknown) => ({
    kind: 'frame', renderId: 'r1', templateId: 'frame', format: 'VERTICAL_9_16', language: 'pt',
    frame: { id, texts, brand: { name: 'Acme', handle: '@acme', initials: 'AC', color: '#5B4BF5' } },
    video: { source: { videoUrl: 'https://x/v.mp4', width: 960, height: 960, fps: 24, durationSec: 31, hasAudio: true }, timeline: [{ startSec: 0, endSec: 12 }], joinFadeMs: 40, reframe: { mode: 'contain_blur' } },
    second: { kind: 'champion_segment', startSec: 14, endSec: 18 },
    face: { kind: 'face_crop', atSec: 2, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } },
    safeArea: { top: 96, bottom: 192 },
  });
  it('os 18 com textos no limite passam; duração = soma do timeline', () => {
    const t = noLimite('pt');
    for (const id of FRAME_IDS) {
      const p = propsDeFrameInput(base(id, t[id]) as never);
      expect(p.frame.id).toBe(id);
      expect(duracaoMoldura(p)).toBe(360);
    }
  });
  it('1 caractere acima do limite falha; *destaque* não conta', () => {
    expect(() => molduraSchema.parse(base('question_box', { question: 'a'.repeat(71) }))).toThrow();
    expect(molduraSchema.parse(base('question_box', { question: `*${'a'.repeat(70)}*` })).frame.id).toBe('question_box');
  });
  it('ranking com 2 ou 6 itens falha; preço sem from é aceito', () => {
    expect(() => molduraSchema.parse(base('ranking', { title: 'T', items: ['a', 'b'] }))).toThrow();
    expect(() => molduraSchema.parse(base('ranking', { title: 'T', items: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toThrow();
    expect(molduraSchema.parse(base('direct_offer', { promise: 'P', price: { from: null, to: 'R$ 47' }, cta: 'C' })).frame.id).toBe('direct_offer');
  });
  it('timeline fora do campeão falha', () => {
    const b = base('live', {});
    b.video.timeline = [{ startSec: 0, endSec: 40 }];
    expect(() => propsDeFrameInput(b as never)).toThrow(/fora de/);
  });
});

describe('CJK (zh-TW, 25/10)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TEXTOS_ZH_TW } = require('../src/molduras/casos-cjk') as { TEXTOS_ZH_TW: FrameTextsMap };
  it('os 18 com textos em chinês tradicional no limite cabem nos 3 formatos (sem FRAME_TEXT_OVERFLOW), linha a linha', () => {
    for (const f of FORMATS) {
      for (const id of FRAME_IDS) {
        const L = frameLayout(id, f, TEXTOS_ZH_TW[id] as never, 'zh-TW');
        expect([id, f, textosQueNaoCouberam(L)]).toEqual([id, f, []]);
        for (const t of Object.values(L.text)) if (/[一-鿿]/.test(t.text)) expect(t.ranges?.length).toBe(t.lines.length);
      }
    }
  });
  it('largura cheia: 1 ideograma = 1 em; quebra por caractere e kinsoku (，。！？」 não começam linha, 「 não termina)', () => {
    expect(medirTexto('inter-800', '腰痛', 50, 0, 'tc')).toBeCloseTo(100, 5);
    const r = fitText('你不是天生就該痛著醒來，你的脊椎需要十分鐘。「真的」！', { font: 'montserrat-900', width: 300, maxLines: 10, max: 50, min: 50, cjk: 'tc' });
    expect(r.fits).toBe(true);
    for (const l of r.lines) {
      expect('，。！？」'.includes(l[0])).toBe(false);
      expect(l.endsWith('「')).toBe(false);
      expect(medirTexto('montserrat-900', l, 50, 0, 'tc')).toBeLessThanOrEqual(300);
    }
    expect(r.lines.join('')).toBe('你不是天生就該痛著醒來，你的脊椎需要十分鐘。「真的」！');
  });
  it('coreano quebra no espaço; latino no meio do chinês fica inteiro', () => {
    const k = fitText('왜 아침에 일어나면 더 아플까요 정말로', { font: 'inter-800', width: 260, maxLines: 10, max: 40, min: 40, cjk: 'kr' });
    for (const l of k.lines) expect(l.startsWith(' ') || l.endsWith(' ')).toBe(false);
    expect(k.lines.join(' ')).toBe('왜 아침에 일어나면 더 아플까요 정말로');
    const m = fitText('試試 HookMill 的十分鐘', { font: 'inter-800', width: 200, maxLines: 10, max: 40, min: 40, cjk: 'tc' });
    expect(m.lines.some((l) => l.includes('HookMill'))).toBe(true);
  });
});
