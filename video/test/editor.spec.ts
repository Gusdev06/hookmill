// Funções puras do editor (editor-v1 §5.4, §7.2): resolverProps, validarDoc, normalizarDoc. Fixtures = mídia de teste local.
import amostra from '../public/fixtures/amostra.json';
import realTake from '../scripts/editor-f1/real-take.json';
import {
  aplicarDoc, chavePalavra, criativoSchema, duracaoEmFrames, layoutPadrao, normalizarDoc, resolverProps, validarDoc,
  type CriativoProps, type EditDoc, type EditSettingsLike, type ScratchSource,
} from '../src/lib';

const settings: EditSettingsLike = { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: 'Try it free today', endCard: true };

/** 5 cenas Kling (SCENES), uma por clipe. */
const fonte: ScratchSource = {
  format: 'VERTICAL_9_16', fps: 30, language: 'en',
  scenes: amostra.scenes.map((s, i) => ({
    sceneId: `s${i + 1}`, index: i, label: `Cena ${i + 1}`, attempt: 1, durationSec: s.durationSec, clipStartSec: 0,
    clip: { url: s.clipUrl }, thumbnail: null, words: s.words,
  })),
};

/** = props da composição `Amostra-clean-9x16` (Root.tsx), o que a API monta hoje. */
const hoje: CriativoProps = { ...settings, templateId: 'clean', format: 'VERTICAL_9_16', language: 'en', scenes: amostra.scenes };

const doc = (d: Partial<EditDoc>): EditDoc => ({ version: 1, clips: [], trim: null, layers: [], captionWords: [], ...d });
const clipsTodos = (over: Record<string, Partial<{ enabled: boolean; attempt: number; inSec: number; outSec: number }>> = {}, ordem = fonte.scenes.map((s) => s.sceneId)) =>
  ordem.map((id) => {
    const s = fonte.scenes.find((x) => x.sceneId === id)!;
    return { sceneId: id, enabled: true, attempt: s.attempt, inSec: 0, outSec: s.durationSec, ...over[id] };
  });
const regras = (d: EditDoc | null, f = fonte) => validarDoc(d, f).map((e) => e.rule);

describe('resolverProps: doc nulo = props de hoje', () => {
  it('doc null e doc vazio devolvem exatamente as props de hoje (sem layers)', () => {
    expect(resolverProps(fonte, settings, null)).toEqual(hoje);
    expect(resolverProps(fonte, settings, doc({}))).toEqual(hoje);
    expect(resolverProps(fonte, settings, null)).not.toHaveProperty('layers');
    expect(criativoSchema.parse(resolverProps(fonte, settings, null))).toEqual(hoje);
  });

  it('cena com palavra: mesmos objetos de palavra (nada recalculado sem corte)', () => {
    const p = resolverProps(fonte, settings, null);
    expect(p.scenes[1].words).toEqual(amostra.scenes[1].words);
  });

  it('fatias contíguas do mesmo take viram 1 cena, como o renderPieces da API', () => {
    const take: ScratchSource = {
      format: 'VERTICAL_9_16', fps: 30, language: 'en',
      scenes: realTake.scenes.map((s, i) => ({
        sceneId: `t${i}`, index: i, attempt: 1, durationSec: s.durationSec, clipStartSec: s.clipStartSec, clip: { url: s.clipUrl },
        words: s.words,
      })),
    };
    const p = resolverProps(take, { ...settings, templateId: 'bold' }, null);
    expect(p.scenes).toHaveLength(1);
    const total = realTake.scenes.reduce((t, s) => t + s.durationSec, 0);
    expect(p.scenes[0].durationSec).toBeCloseTo(total, 9);
    expect(p.scenes[0].clipStartSec).toBeUndefined();
    const esperado = realTake.scenes.flatMap((s) => s.words.map((w) => ({ word: w.word, startSec: Math.round((w.startSec + s.clipStartSec) * 1000) / 1000, endSec: Math.round((w.endSec + s.clipStartSec) * 1000) / 1000 })));
    expect(p.scenes[0].words).toEqual(esperado);
    // aparar o meio de uma fatia quebra a continuidade: 2 cenas, a 2ª começa no instante do clipe
    const p2 = resolverProps(take, { ...settings, templateId: 'bold' }, doc({ clips: take.scenes.map((s, i) => ({ sceneId: s.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: i === 1 ? 5 : s.durationSec })) }));
    expect(p2.scenes.map((s) => s.clipStartSec ?? 0)).toEqual([0, 15]);
    expect(p2.scenes[0].durationSec).toBeCloseTo(12.5, 9);
  });

  it('template do remix não passa', () => {
    expect(() => resolverProps(fonte, { ...settings, templateId: 'remix-keep' }, null)).toThrow(/remix/);
  });
});

describe('resolverProps: cenas (cortar, reordenar, apagar) e legenda acompanhando', () => {
  it('corta in/out (arredonda pra frame), reordena e apaga', () => {
    const d = doc({ clips: clipsTodos({ s1: { inSec: 0.51, outSec: 3.0 }, s3: { enabled: false } }, ['s2', 's1', 's3', 's4', 's5']) });
    const p = resolverProps(fonte, settings, d);
    expect(p.scenes.map((s) => s.clipUrl)).toEqual(['fixtures/cena-2.mp4', 'fixtures/cena-1.mp4', 'fixtures/cena-4.mp4', 'fixtures/cena-5.mp4']);
    const c1 = p.scenes[1];
    expect(c1.clipStartSec).toBeCloseTo(15 / 30, 9); // 0,51 s -> frame 15
    expect(c1.durationSec).toBeCloseTo(3.0 - 0.5, 9);
    // palavras relativas ao novo começo; a que termina antes do in sai; a que atravessa o in começa em 0
    const original = amostra.scenes[0].words;
    expect(c1.words[0]).toEqual({ word: original[1].word, startSec: expect.closeTo(original[1].startSec - 0.5, 9), endSec: expect.closeTo(original[1].endSec - 0.5, 9) });
    expect(c1.words.every((w) => w.startSec < c1.durationSec)).toBe(true);
    expect(c1.words.find((w) => w.word === 'away.')).toBeUndefined(); // 3,14 s > out 3,0 s
    expect(duracaoEmFrames(p)).toBe(Math.round((7.628 + 2.5 + 5.584 + 3.5) * 30) + 75);
  });

  it('palavra que atravessa o in começa em 0 e a que atravessa o out termina no out', () => {
    const p = resolverProps(fonte, settings, doc({ clips: clipsTodos({ s1: { inSec: 0.3, outSec: 1.4 } }) }));
    const w = p.scenes[0].words;
    expect(w[0]).toEqual({ word: "There's", startSec: 0, endSec: expect.closeTo(0.22, 9) });
    expect(w[w.length - 1]).toEqual({ word: 'Instagram', startSec: expect.closeTo(0.9, 9), endSec: expect.closeTo(1.1, 9) });
  });

  it('corte de attempt antigo volta pro clipe inteiro; cena nova (fora do doc) entra no fim', () => {
    const regerada: ScratchSource = { ...fonte, scenes: fonte.scenes.map((s) => (s.sceneId === 's2' ? { ...s, attempt: 2 } : s)) };
    const d = doc({ clips: clipsTodos({ s2: { inSec: 1, outSec: 2 } }).filter((c) => c.sceneId !== 's5').map((c) => ({ ...c, attempt: 1 })) });
    const p = resolverProps(regerada, settings, d);
    expect(p.scenes[1].durationSec).toBe(7.628);
    expect(p.scenes[4].clipUrl).toBe('fixtures/cena-5.mp4');
  });

  it('nenhuma ativa = todas (tolerante, o validarDoc recusa antes)', () => {
    const p = resolverProps(fonte, settings, doc({ clips: clipsTodos(Object.fromEntries(fonte.scenes.map((s) => [s.sceneId, { enabled: false }]))) }));
    expect(p.scenes).toHaveLength(5);
  });

  it('correção de palavra: troca, esconde (texto vazio) e cai com attempt antigo', () => {
    const d = doc({ captionWords: [
      { key: chavePalavra('s1', 1, 4), text: 'Insta' },
      { key: chavePalavra('s1', 1, 1), text: '' },
      { key: chavePalavra('s2', 0, 0), text: 'STALE' },
    ] });
    const p = resolverProps(fonte, settings, d);
    const ws = p.scenes[0].words.map((w) => w.word);
    expect(ws).toContain('Insta');
    expect(ws).not.toContain('Instagram');
    expect(ws).toHaveLength(amostra.scenes[0].words.length - 1);
    expect(p.scenes[1].words).toEqual(amostra.scenes[1].words);
  });

  it('correção segue a palavra depois do corte', () => {
    const p = resolverProps(fonte, settings, doc({ clips: clipsTodos({ s1: { inSec: 1.2, outSec: 3.5 } }), captionWords: [{ key: chavePalavra('s1', 1, 4), text: 'IG' }] }));
    expect(p.scenes[0].words[0]).toEqual({ word: 'IG', startSec: 0, endSec: expect.closeTo(0.38, 9) });
  });
});

describe('resolverProps: camadas', () => {
  it('layers só com as camadas do doc; estilo parcial por cima do padrão; texto e tempo', () => {
    const d = doc({ layers: [
      { id: 'caption', transform: { x: 0.5, y: 0.4, scale: 1.2, rotationDeg: -8, boxWidth: 0.7 }, style: { color: '#FFE14D', background: { kind: 'pill', color: '#000000CC' } } },
      { id: 'cta', text: 'Baixa agora', timing: { fromSec: 2, durationSec: 4 } },
      { id: 'bogus', visible: false },
    ] });
    const p = resolverProps(fonte, settings, d);
    expect(Object.keys(p.layers!)).toEqual(['caption', 'cta']);
    const pad = layoutPadrao('clean', 'VERTICAL_9_16', settings, 29.507);
    expect(p.layers!.caption!.style).toEqual({ ...pad.caption.style, color: '#FFE14D', background: { kind: 'pill', color: '#000000CC' } });
    expect(p.layers!.caption!.transform!.rotationDeg).toBe(-8);
    expect(p.layers!.cta).toMatchObject({ text: 'Baixa agora', fromFrame: 60, durationInFrames: 120, transform: null });
    expect(p.layers!.cta!.style).toBeUndefined();
    expect(criativoSchema.parse(p)).toEqual(p);
  });

  it('tempo automático e limites seguem o total depois do corte', () => {
    const d = doc({ clips: clipsTodos({ s2: { enabled: false }, s3: { enabled: false }, s4: { enabled: false } }), layers: [{ id: 'cta', timing: { fromSec: 0, durationSec: 999 } }, { id: 'hook', visible: false }] });
    const p = resolverProps(fonte, { ...settings, templateId: 'headline', headline: 'X' }, d);
    const total = Math.round((3.925 + 3.5) * 30);
    expect(p.layers!.cta).toMatchObject({ fromFrame: 0, durationInFrames: total });
    expect(p.layers!.hook).toMatchObject({ visible: false, fromFrame: 0, durationInFrames: 90 });
  });

  it('aplicarDoc (F1) continua igual pras camadas', () => {
    const d = doc({ layers: [{ id: 'hook', transform: { x: 0.45, y: 0.3, scale: 1, rotationDeg: 0, boxWidth: 0.7 } }] });
    expect(aplicarDoc(hoje, d).layers).toEqual(resolverProps(fonte, settings, d).layers);
    expect(aplicarDoc(hoje, null)).toBe(hoje);
  });
});

describe('validarDoc: uma regra por caso', () => {
  it('doc nulo e doc válido = sem erro', () => {
    expect(regras(null)).toEqual([]);
    expect(regras(doc({ clips: clipsTodos({ s1: { inSec: 0.5, outSec: 2 } }, ['s3', 's1', 's2', 's4', 's5']), layers: [{ id: 'hook', style: { color: '#ffffff', fontId: 'anton-400' } }], captionWords: [{ key: 's1@1:0', text: 'Oi' }] }))).toEqual([]);
  });
  it('unknown_scene', () => {
    expect(validarDoc(doc({ clips: [...clipsTodos(), { sceneId: 'zz', enabled: true, attempt: 1, inSec: 0, outSec: 1 }] }), fonte)).toContainEqual({ field: 'clips[5].sceneId', rule: 'unknown_scene' });
  });
  it('clips_must_cover_scenes (faltando e repetida)', () => {
    expect(regras(doc({ clips: clipsTodos().slice(0, 4) }))).toEqual(['clips_must_cover_scenes']);
    expect(regras(doc({ clips: [...clipsTodos(), clipsTodos()[0]] }))).toEqual(['clips_must_cover_scenes']);
  });
  it('no_enabled_clip', () => {
    expect(regras(doc({ clips: clipsTodos(Object.fromEntries(fonte.scenes.map((s) => [s.sceneId, { enabled: false }]))) }))).toEqual(['no_enabled_clip']);
  });
  it('trim_out_of_range (out > duração, in < 0, out <= in, trim no do zero)', () => {
    expect(regras(doc({ clips: clipsTodos({ s1: { outSec: 5 } }) }))).toEqual(['trim_out_of_range']);
    expect(regras(doc({ clips: clipsTodos({ s1: { inSec: -1 } }) }))).toEqual(['trim_out_of_range']);
    expect(regras(doc({ clips: clipsTodos({ s1: { inSec: 2, outSec: 1 } }) }))).toEqual(['trim_out_of_range']);
    expect(regras(doc({ trim: { inFrame: 0, outFrame: 10 } }))).toEqual(['trim_out_of_range']);
    // out até meio frame além da duração é tolerado (o web arredonda pra frame); attempt antigo não é erro
    expect(regras(doc({ clips: clipsTodos({ s1: { outSec: 3.93 } }) }))).toEqual([]);
    expect(regras(doc({ clips: clipsTodos({ s1: { attempt: 0, outSec: 99 } }) }))).toEqual([]);
  });
  it('clip_too_short (< 0,3 s = 9 frames)', () => {
    expect(validarDoc(doc({ clips: clipsTodos({ s2: { inSec: 1, outSec: 1.25 } }) }), fonte)).toEqual([{ field: 'clips[1]', rule: 'clip_too_short' }]);
    expect(regras(doc({ clips: clipsTodos({ s2: { inSec: 1, outSec: 1.3 } }) }))).toEqual([]);
  });
  it('video_too_short (< 1 s no total)', () => {
    const c = clipsTodos(Object.fromEntries(fonte.scenes.map((s) => [s.sceneId, { enabled: false }])));
    c[0] = { ...c[0], enabled: true, inSec: 0, outSec: 0.6 };
    expect(regras(doc({ clips: c }))).toEqual(['video_too_short']);
  });
  it('unknown_layer', () => {
    expect(validarDoc(doc({ layers: [{ id: 'headline' }] }), fonte)).toEqual([{ field: 'layers[0].id', rule: 'unknown_layer' }]);
  });
  it('bad_color (cor, destaque, contorno, fundo)', () => {
    const e = validarDoc(doc({ layers: [{ id: 'caption', style: { color: 'red', highlightColor: '#12345', strokeColor: '#GGGGGG', background: { kind: 'box', color: 'rgba(0,0,0,1)' } } }] }), fonte);
    expect(e.map((x) => x.field)).toEqual(['layers[0].style.color', 'layers[0].style.highlightColor', 'layers[0].style.strokeColor', 'layers[0].style.background.color']);
    expect(new Set(e.map((x) => x.rule))).toEqual(new Set(['bad_color']));
    expect(regras(doc({ layers: [{ id: 'caption', style: { color: '#FFFFFF80', highlightColor: null, strokeColor: null, background: { kind: 'none', color: null } } }] }))).toEqual([]);
  });
  it('unknown_font', () => {
    expect(validarDoc(doc({ layers: [{ id: 'cta', style: { fontId: 'comic-sans' as never } }] }), fonte)).toEqual([{ field: 'layers[0].style.fontId', rule: 'unknown_font' }]);
  });
  it('doc_too_large (64 KB, 50 camadas, 2000 palavras, texto 300)', () => {
    expect(regras(doc({ layers: [{ id: 'cta', text: 'x'.repeat(70 * 1024) }] }))).toEqual(['doc_too_large', 'doc_too_large']);
    expect(regras(doc({ layers: Array.from({ length: 51 }, () => ({ id: 'cta' })) }))).toEqual(['doc_too_large']);
    expect(regras(doc({ captionWords: Array.from({ length: 2001 }, () => ({ key: 's1@1:0', text: 'a' })) }))).toEqual(['doc_too_large']);
    expect(regras(doc({ layers: [{ id: 'hook', text: 'x'.repeat(301) }] }))).toEqual(['doc_too_large']);
  });
  it('unknown_word (chave malformada, cena desconhecida, índice fora; attempt antigo não é erro)', () => {
    expect(regras(doc({ captionWords: [{ key: 't:3', text: 'a' }] }))).toEqual(['unknown_word']);
    expect(regras(doc({ captionWords: [{ key: 'zz@1:0', text: 'a' }] }))).toEqual(['unknown_word']);
    expect(regras(doc({ captionWords: [{ key: 's1@1:10', text: 'a' }] }))).toEqual(['unknown_word']);
    expect(regras(doc({ captionWords: [{ key: 's1@0:10', text: 'a' }] }))).toEqual([]);
  });
});

describe('normalizarDoc', () => {
  it('null e doc sem efeito viram null', () => {
    expect(normalizarDoc(null, fonte)).toBeNull();
    expect(normalizarDoc(doc({}), fonte)).toBeNull();
    expect(normalizarDoc(doc({ clips: clipsTodos(), layers: [{ id: 'hook' }, { id: 'caption', visible: true, transform: null, timing: null }], captionWords: [{ key: 's1@1:0', text: "There's" }] }), fonte)).toBeNull();
  });
  it('arredonda corte pra frame, corta pro clipe, estica o curto, encaixa fim inteiro', () => {
    const n = normalizarDoc(doc({ clips: clipsTodos({ s1: { inSec: 0.51, outSec: 3.92 }, s2: { inSec: 2, outSec: 2.1 }, s3: { inSec: -3, outSec: 50 } }) }), fonte)!;
    expect(n.clips[0]).toMatchObject({ inSec: 0.5, outSec: 3.925 });
    expect(n.clips[1].inSec).toBe(2);
    expect(n.clips[1].outSec).toBeCloseTo(2.3, 9);
    expect(n.clips[2]).toMatchObject({ inSec: 0, outSec: 8.87 });
    expect(validarDoc(n, fonte)).toEqual([]);
  });
  it('descarta cena desconhecida/duplicada, corte e correção de attempt antigo; cena nova entra ativa no fim; ≥ 1 ativa', () => {
    const regerada: ScratchSource = { ...fonte, scenes: fonte.scenes.map((s) => (s.sceneId === 's2' ? { ...s, attempt: 2 } : s)) };
    const n = normalizarDoc(doc({
      clips: [{ sceneId: 'zz', enabled: true, attempt: 1, inSec: 0, outSec: 1 }, ...clipsTodos({ s2: { inSec: 1, outSec: 2, attempt: 1 }, s1: { enabled: false } }, ['s2', 's1', 's1', 's3', 's4'])],
      captionWords: [{ key: 's2@1:0', text: 'velha' }, { key: 's1@1:0', text: 'nova' }, { key: 's1@1:0', text: 'nova2' }],
    }), regerada)!;
    expect(n.clips.map((c) => [c.sceneId, c.enabled, c.attempt, c.inSec, c.outSec])).toEqual([
      ['s2', true, 2, 0, 7.628], ['s1', false, 1, 0, 3.925], ['s3', true, 1, 0, 8.87], ['s4', true, 1, 0, 5.584], ['s5', true, 1, 0, 3.5],
    ]);
    expect(n.captionWords).toEqual([{ key: 's1@1:0', text: 'nova2' }]);
    expect(validarDoc(n, regerada)).toEqual([]);
    const nenhuma = normalizarDoc(doc({ clips: clipsTodos(Object.fromEntries(fonte.scenes.map((s) => [s.sceneId, { enabled: false }]))) }), fonte);
    expect(nenhuma).toBeNull(); // todas voltam ativas na ordem original = identidade
  });
  it('camadas: tira desconhecida, mescla repetida, limita transform; com settings tira o que é igual ao padrão', () => {
    const pad = layoutPadrao('clean', 'VERTICAL_9_16', settings, 29.507);
    const n = normalizarDoc(doc({ layers: [
      { id: 'bogus', visible: false },
      { id: 'cta', transform: { x: 9, y: 0.5, scale: 10, rotationDeg: 400, boxWidth: 0.5 } },
      { id: 'caption', transform: pad.caption.transform, style: { color: '#FFFFFF', shadow: false } },
      { id: 'hook', text: '' },
    ] }), fonte, settings)!;
    expect(n.layers).toEqual([
      { id: 'cta', transform: { x: 1.25, y: 0.5, scale: 4, rotationDeg: 180, boxWidth: 0.5 } },
      { id: 'caption', style: { shadow: false } },
    ]);
  });
});
