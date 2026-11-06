// Editor universal v1, F-U2 (docs/contratos/editor-universal-v1.md §4, §6; handoff editor-u2-video-handoff.md): vídeo do
// cliente como camada nas molduras e na HEADLINE: caixa, enquadramento, auto reframe, aparar e checagens caption_cut/face_cut.
import { HEADLINE_ADD } from '../scripts/editor-universal/casos';
import { casoTrilha } from '../src/molduras/casos';
import { DEMO_EDIT_MAP, demoProps } from '../src/molduras/demo';
import {
  checarEdicao, comVideoEditado, duracaoMoldura, exportLiberado, FRAME_IDS, layoutDaPeca, manifestoDe, molduraSchema, normalizarDocV3, palavrasNaPeca, pinturaNaCaixa, propsDeRemixInput,
  resolverPropsHeadline, resolverPropsMoldura, validarDocHeadline, validarDocMoldura,
  type EditDocV3, type EditorGuard, type MolduraProps, type RemixKeepProps,
} from '../src/lib';

const doc = (o: Partial<EditDocV3> = {}): EditDocV3 => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], ...o });
const video = (o: Partial<NonNullable<EditDocV3['video']>>) => doc({ video: { layerId: 'video', ...o } });
const F9 = { format: '9x16' as const };
const comLegenda = (): MolduraProps => {
  const b = demoProps('question_box', 'VERTICAL_9_16');
  return { ...b, video: { ...b.video, protectedBands: [{ x: 120, y: 760, w: 720, h: 90, startSec: 0, endSec: 31 }] } };
};
const GUARDA = (p: Pick<MolduraProps, 'video'>): EditorGuard => ({
  source: { width: 960, height: 960, fps: 24 },
  protectedBands: p.video.protectedBands ?? [],
  faceTrack: DEMO_EDIT_MAP.faceTrack.map((s) => ({ ...s, role: 'main' })),
});
const regras = (p: MolduraProps, d: EditDocV3) => {
  const r = resolverPropsMoldura(p, d, F9);
  return checarEdicao(r.layout, GUARDA(p), r.textos, { numbers: [] }, d);
};

describe('manifesto: camada video', () => {
  it.each(FRAME_IDS.map((id) => [id]))('frame:%s move, redimensiona, reenquadra e apara; não gira', (id) => {
    const base = demoProps(id);
    const l = manifestoDe(`frame:${id}`, base).layers.find((x) => x.id === 'video')!;
    expect(l.lockedReason).toBeNull();
    expect(l.editable).toMatchObject({ move: true, resize: true, reframe: true, trim: true, rotate: false, hide: false, text: false });
    const tl = base.video.timeline;
    expect(l.video).toEqual({ zoomMin: 0.5, zoomMax: 3, panAbsMax: 1, minBoxFrac: 0.1, minTrimSec: 1, trimMinSec: tl[0].startSec, trimMaxSec: tl[tl.length - 1].endSec, fits: ['cover', 'contain_blur'] });
  });
  it('HEADLINE idem, com o limite do quadro do campeão', () => {
    const l = manifestoDe('headline', HEADLINE_ADD).layers.find((x) => x.id === 'video')!;
    expect(l.editable).toMatchObject({ move: true, resize: true, reframe: true, trim: true, rotate: false });
    expect(l.video).toMatchObject({ trimMinSec: 0, trimMaxSec: 5 });
  });
  it('video:2 segue travada', () => {
    expect(manifestoDe('frame:split_stack', demoProps('split_stack')).layers.find((x) => x.id === 'video:2')!.editable.reframe).toBe(false);
  });
});

describe('moldura: doc sem efeito = a base', () => {
  it('video vazio não muda nada', () => {
    const base = demoProps('news');
    for (const d of [video({}), video({ box: null, framing: null, trim: null })]) expect(resolverPropsMoldura(base, d, F9).props).toBe(base);
  });
  it('sem edição: auto, edited false e o framing descreve a pintura de hoje', () => {
    const base = demoProps('news');
    const v = resolverPropsMoldura(base, null, F9).layout.video!;
    expect(v).toMatchObject({ auto: true, edited: false, checksCaption: true });
    expect(v.visibleRect.w).toBeGreaterThan(0);
  });
});

describe('moldura: caixa', () => {
  const box = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
  it.each(FRAME_IDS.map((id) => [id]))('frame:%s: a caixa vai pro layout e o texto não sai do lugar', (id) => {
    const base = demoProps(id);
    const r0 = resolverPropsMoldura(base, null, F9);
    const r = resolverPropsMoldura(base, video({ box }), F9);
    expect(r.layout.video!.box.x).toBeCloseTo(box.x, 3);
    expect(r.layout.video!.box.h).toBeCloseTo(box.h, 3);
    expect(r.layout.video!.auto).toBe(true);
    expect(r.layout.video!.edited).toBe(true);
    expect(r.layout.layers.find((l) => l.id === 'video')!.rect).toEqual(r.layout.video!.box);
    // slot:names (call_dialog) são as etiquetas dos tiles: andam com o vídeo
    const fixas = (x: typeof r) => x.layout.layers.filter((l) => (l.kind === 'text' || l.kind === 'box') && l.id !== 'slot:names').map((l) => [l.id, l.rect]);
    expect(fixas(r)).toEqual(fixas(r0));
    expect(layoutDaPeca(r.props).videoBox).toEqual(r.props.edicao!.video!.box);
  });
  it('as props editadas passam no schema da composição', () => {
    const r = resolverPropsMoldura(demoProps('question_box'), video({ box, framing: { fit: 'contain_blur', zoom: 1, panX: 0, panY: 0 }, trim: { inSec: 1, outSec: 3 } }), F9);
    const p = molduraSchema.parse(r.props);
    expect(p.edicao!.video!.box).not.toBeNull();
    expect(p.video.reframe.mode).toBe('manual');
  });
  it('caixa nova refaz o auto reframe (cobre a caixa)', () => {
    const r = resolverPropsMoldura(demoProps('question_box'), video({ box: { x: 0, y: 0.5, w: 1, h: 0.4 } }), F9);
    const { box: b, sourceRect: s } = r.layout.video!;
    expect(s.w).toBeGreaterThanOrEqual(b.w - 1e-3);
    expect(s.h).toBeGreaterThanOrEqual(b.h - 1e-3);
    expect(s.x).toBeLessThanOrEqual(b.x + 1e-3);
  });
  it('legenda queimada: auto na caixa nova mantém a legenda inteira', () => {
    const base = comLegenda();
    const d = video({ box: { x: 0, y: 0.3, w: 1, h: 0.45 } });
    expect(regras(base, d).map((i) => i.rule)).not.toContain('caption_cut');
  });
  it('caixa igual à do template não conta como edição', () => {
    const base = demoProps('news');
    const r0 = resolverPropsMoldura(base, null, F9);
    expect(resolverPropsMoldura(base, video({ box: r0.layout.video!.box }), F9).props).toEqual(base);
  });
  it('faixas de saída acompanham a caixa', () => {
    const b = comLegenda();
    const base: MolduraProps = { ...b, outputProtectedBands: [{ kind: 'original', x: 0, y: 0, w: 10, h: 10, startSec: 0, endSec: 5 }] };
    const r = resolverPropsMoldura(base, video({ box: { x: 0, y: 0.5, w: 1, h: 0.5 } }), F9);
    const f = r.props.outputProtectedBands![0];
    expect(f.y).toBeGreaterThanOrEqual(960 - 1);
  });
});

describe('moldura: enquadramento', () => {
  const base = demoProps('question_box');
  const framing = (o: object = {}) => ({ fit: 'cover' as const, zoom: 1, panX: 0, panY: 0, ...o });
  it('manual: zoom multiplica a escala do cover, pan em fração do canvas', () => {
    const a = resolverPropsMoldura(base, video({ framing: framing() }), F9).layout.video!;
    const b = resolverPropsMoldura(base, video({ framing: framing({ zoom: 2 }) }), F9).layout.video!;
    const c = resolverPropsMoldura(base, video({ framing: framing({ panX: 0.1, panY: -0.05 }) }), F9).layout.video!;
    expect(a).toMatchObject({ auto: false, edited: true, fit: 'cover' });
    expect(b.sourceRect.w).toBeCloseTo(a.sourceRect.w * 2, 5);
    expect(c.sourceRect.x).toBeCloseTo(a.sourceRect.x + 0.1, 5);
    expect(c.sourceRect.y).toBeCloseTo(a.sourceRect.y - 0.05, 5);
  });
  it('caber: o vídeo inteiro dentro da caixa', () => {
    const v = resolverPropsMoldura(base, video({ framing: framing({ fit: 'contain_blur' }) }), F9).layout.video!;
    expect(v.fit).toBe('contain_blur');
    expect(v.sourceRect.y).toBeGreaterThanOrEqual(v.box.y - 1e-3);
    expect(v.sourceRect.y + v.sourceRect.h).toBeLessThanOrEqual(v.box.y + v.box.h + 1e-3);
  });
  it('o framing do layout, gravado no doc, reproduz a pintura do auto', () => {
    for (const p of [base, comLegenda(), demoProps('split_stack'), demoProps('call', 'SQUARE_1_1')]) {
      const fmt = p.format === 'SQUARE_1_1' ? '1x1' as const : '9x16' as const;
      const auto = resolverPropsMoldura(p, null, { format: fmt, principal: fmt }).layout.video!;
      const man = resolverPropsMoldura(p, video({ framing: auto.framing }), { format: fmt, principal: fmt }).layout.video!;
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(man.sourceRect[k] - auto.sourceRect[k])).toBeLessThan(0.002);
      expect(man.auto).toBe(false);
    }
  });
  it('pintura manual: sem clamp, pode sobrar fundo', () => {
    const p = pinturaNaCaixa({ w: 100, h: 100 }, { width: 200, height: 100 }, { mode: 'manual', fit: 'contain_blur', zoom: 1, dx: 10, dy: 0 });
    expect(p.s).toBeCloseTo(0.5);
    expect(p.area.left).toBeCloseTo(10);
    expect(p.cheio).toBe(false);
  });
  it('formato não principal lê o formatOverrides', () => {
    const b = demoProps('question_box', 'SQUARE_1_1');
    const box = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    const c = { format: '1x1' as const, principal: '9x16' as const };
    expect(resolverPropsMoldura(b, video({ box }), c).props).toEqual(b);
    const r = resolverPropsMoldura(b, doc({ formatOverrides: { '1x1': { layers: [], video: { box } } } }), c);
    expect(r.layout.video!.box.x).toBeCloseTo(0.2, 3);
  });
});

describe('moldura: aparar', () => {
  it('corta a duração, desloca a legenda e guarda o corte', () => {
    const b = demoProps('news');
    const words = [{ word: 'antes', startSec: 0.5, endSec: 0.9 }, { word: 'dentro', startSec: 2.5, endSec: 2.9 }, { word: 'depois', startSec: 9, endSec: 9.5 }];
    const base: MolduraProps = { ...b, captions: { ...(b.captions ?? { language: 'pt', highlightColor: '#fff' }), words } as MolduraProps['captions'] };
    const r = resolverPropsMoldura(base, video({ trim: { inSec: 2, outSec: 5 } }), F9);
    expect(duracaoMoldura(r.props)).toBe(90);
    expect(r.layout.durationSec).toBe(3);
    expect(r.layout.video!.trim).toEqual({ inSec: 2, outSec: 5 });
    expect(r.layout.video!.edited).toBe(false);
    expect(r.layout.layers.find((l) => l.id === 'video')!.toSec).toBe(3);
    const ws = palavrasNaPeca(r.props.captions!.words, r.props.video.timeline);
    expect(ws.map((w) => w.word)).toEqual(['dentro']);
    expect(ws[0].startSec).toBeCloseTo(0.5, 5);
  });
  it('trilha de b-roll desloca junto', () => {
    const base = casoTrilha('split_stack', 'VERTICAL_9_16');
    const s0 = base.second as Extract<MolduraProps['second'], { kind: 'broll_track' }>;
    const cs = [...s0.clips].sort((a, b) => a.fromSec - b.fromSec);
    const corte = (cs[0].fromSec + cs[1].fromSec) / 2 + 0.001;
    const fim = Math.min(base.video.source.durationSec, corte + 3);
    const r = resolverPropsMoldura(base, video({ trim: { inSec: corte, outSec: fim } }), F9);
    const s = r.props.second as typeof s0;
    expect(s.clips[0].fromSec).toBe(0);
    expect(s.clips[0].srcStartSec).toBeCloseTo(cs[0].srcStartSec + corte - cs[0].fromSec, 5);
    if (s.clips[1]) expect(s.clips[1].fromSec).toBeCloseTo(cs[1].fromSec - corte, 5);
  });
  it('faixas de saída no tempo novo; a que sai do corte some', () => {
    const b = comLegenda();
    const base: MolduraProps = { ...b, video: { ...b.video, protectedBands: [{ x: 120, y: 760, w: 720, h: 90, startSec: 0, endSec: 1 }, { x: 120, y: 760, w: 720, h: 90, startSec: 4, endSec: 6 }] }, outputProtectedBands: [] };
    const r = resolverPropsMoldura(base, video({ trim: { inSec: 3, outSec: 8 } }), F9);
    expect(r.props.outputProtectedBands!.map((f) => [f.startSec, f.endSec])).toEqual([[1, 3]]);
  });
});

describe('validação do vídeo (estrutura → 400)', () => {
  const base = demoProps('question_box');
  const erros = (d: EditDocV3) => validarDocMoldura(d, base).map((e) => `${e.field}:${e.rule}`);
  it('doc bom passa', () => {
    expect(erros(video({ box: { x: 0, y: 0.2, w: 1, h: 0.5 }, framing: { fit: 'contain_blur', zoom: 2.5, panX: -1, panY: 1 }, trim: { inSec: 1, outSec: 2 } }))).toEqual([]);
  });
  it('acusa cada regra', () => {
    expect(erros(video({ layerId: 'outro' }))).toEqual(['video.layerId:unknown_layer']);
    expect(erros(video({ box: { x: 0.5, y: 0, w: 0.6, h: 0.5 } }))).toEqual(['video.box:video_box_out_of_canvas']);
    expect(erros(video({ box: { x: 0, y: 0, w: 0.05, h: 0.5 } }))).toEqual(['video.box:video_box_out_of_canvas']);
    expect(erros(video({ framing: { fit: 'cover', zoom: 3.5, panX: 0, panY: 0 } }))).toEqual(['video.framing.zoom:video_zoom_out_of_range']);
    expect(erros(video({ framing: { fit: 'cover', zoom: 0.4, panX: 1.1, panY: 0 } }))).toEqual(['video.framing.zoom:video_zoom_out_of_range', 'video.framing.panX:video_pan_out_of_range']);
    expect(erros(video({ framing: { fit: 'x' as never, zoom: 1, panX: 0, panY: 0 } }))).toEqual(['video.framing.fit:bad_template_opt_value']);
    expect(erros(video({ trim: { inSec: 1, outSec: 1.5 } }))).toEqual(['video.trim:trim_too_short']);
    expect(erros(video({ trim: { inSec: 2, outSec: 1 } }))).toEqual(['video.trim:trim_out_of_range']);
    expect(erros(video({ trim: { inSec: 0, outSec: 99999 } }))).toEqual(['video.trim:trim_out_of_range']);
    expect(erros(doc({ layers: [{ id: 'video', rect: { x: 0, y: 0, w: 1, h: 1 } }] }))).toEqual(['layers[0].rect:not_editable']);
    expect(erros(doc({ formatOverrides: { '1x1': { layers: [], video: { box: { x: 0.9, y: 0, w: 0.5, h: 0.5 } } } } }))).toEqual(['formatOverrides.1x1.video.box:video_box_out_of_canvas']);
  });
  it('HEADLINE', () => {
    expect(validarDocHeadline(video({ trim: { inSec: 0, outSec: 0.5 } }), HEADLINE_ADD).map((e) => e.rule)).toEqual(['trim_too_short']);
    expect(validarDocHeadline(video({ box: { x: 0, y: 0, w: 1, h: 0.5 } }), HEADLINE_ADD)).toEqual([]);
  });
});

describe('normalizarDocV3: vídeo', () => {
  const base = demoProps('question_box');
  const m = manifestoDe('frame:question_box', base);
  const dur = base.video.timeline[0].endSec;
  const f = { fit: 'cover' as const, zoom: 1.5, panX: 0, panY: 0 };
  const box1 = { x: 0, y: 0.1, w: 1, h: 0.5 }, box2 = { x: 0, y: 0.2, w: 1, h: 0.5 };
  it('o que é igual ao padrão some; sobra nada = null', () => {
    const r0 = resolverPropsMoldura(base, null, F9);
    expect(normalizarDocV3(video({ box: r0.layout.video!.box, framing: null, trim: { inSec: 0, outSec: dur } }), base, m)).toBeNull();
  });
  it('mudar a caixa mantendo o framing de antes zera; framing novo no mesmo PUT fica; sem anterior fica', () => {
    const antes = video({ box: box1, framing: f });
    expect(normalizarDocV3(video({ box: box2, framing: f }), base, m, antes)!.video).toEqual({ layerId: 'video', box: box2 });
    const f2 = { ...f, zoom: 2 };
    expect(normalizarDocV3(video({ box: box2, framing: f2 }), base, m, antes)!.video).toEqual({ layerId: 'video', box: box2, framing: f2 });
    expect(normalizarDocV3(video({ box: box1, framing: f }), base, m, antes)!.video).toEqual({ layerId: 'video', box: box1, framing: f });
    expect(normalizarDocV3(video({ box: box1, framing: f }), base, m)!.video).toEqual({ layerId: 'video', box: box1, framing: f });
  });
  it('formatOverrides.video fica e layers[] do vídeo sai', () => {
    const n = normalizarDocV3(doc({ layers: [{ id: 'video', rect: box1 }], formatOverrides: { '4x5': { layers: [], video: { box: box1 } } } }), base, m)!;
    expect(n.layers).toEqual([]);
    expect(n.formatOverrides!['4x5']).toEqual({ layers: [], video: { box: box1 } });
  });
});

describe('caption_cut e face_cut', () => {
  it('intocado ou só texto: não roda, mesmo com a faixa fora', () => {
    const base = comLegenda();
    expect(regras(base, doc({ layers: [{ id: 'slot:question', text: 'Por que dói?' }] })).map((i) => i.rule)).not.toEqual(expect.arrayContaining(['caption_cut']));
    const guard: EditorGuard = { ...GUARDA(base), protectedBands: [{ x: 0, y: 0, w: 960, h: 40, startSec: 0, endSec: 5 }] };
    const r = resolverPropsMoldura(base, null, F9);
    expect(checarEdicao(r.layout, guard, r.textos, null, null).map((i) => i.rule)).not.toContain('caption_cut');
  });
  it('zoom que corta a legenda bloqueia; o autosave não depende disso; voltar ao auto libera', () => {
    const base = comLegenda();
    const d = video({ framing: { fit: 'cover', zoom: 3, panX: 0, panY: 0.5 } });
    const is = regras(base, d);
    const i = is.find((x) => x.rule === 'caption_cut')!;
    expect(i).toMatchObject({ level: 'block', layerId: 'video', format: '9x16', atSec: 0 });
    expect(i.detail!.visiblePct).toBeLessThan(99);
    expect(exportLiberado(is)).toBe(false);
    expect(validarDocMoldura(d, base)).toEqual([]);
    expect(regras(base, video({ framing: null })).map((x) => x.rule)).not.toContain('caption_cut');
  });
  it('faixa toda fora do corte não conta', () => {
    const b = comLegenda();
    const base: MolduraProps = { ...b, video: { ...b.video, protectedBands: [{ x: 120, y: 760, w: 720, h: 90, startSec: 0, endSec: 1 }] } };
    const f = { fit: 'cover' as const, zoom: 3, panX: 0, panY: 0.5 };
    expect(regras(base, video({ framing: f })).map((x) => x.rule)).toContain('caption_cut');
    expect(regras(base, video({ framing: f, trim: { inSec: 2, outSec: 5 } })).map((x) => x.rule)).not.toContain('caption_cut');
  });
  it('captionMode replace: regras de legenda não valem', () => {
    const base: MolduraProps = { ...comLegenda(), captionMode: 'replace' };
    const is = regras(base, video({ framing: { fit: 'cover', zoom: 3, panX: 0, panY: 0.5 } }));
    expect(is.map((x) => x.rule)).not.toContain('caption_cut');
    expect(is.map((x) => x.rule)).not.toContain('caption_covered');
  });
  it('rosto: pan que tira o rosto da caixa bloqueia; enquadrado, não', () => {
    const base = demoProps('question_box');
    const fora = regras(base, video({ framing: { fit: 'cover', zoom: 1, panX: 1, panY: 0 } })).find((x) => x.rule === 'face_cut')!;
    expect(fora).toMatchObject({ level: 'block', layerId: 'video' });
    expect(fora.detail!.visiblePct).toBeLessThan(90);
    const auto = resolverPropsMoldura(base, null, F9).layout.video!;
    expect(regras(base, video({ framing: auto.framing })).map((x) => x.rule)).not.toContain('face_cut');
  });
  it('sem faceTrack a regra não roda', () => {
    const base = demoProps('question_box');
    const d = video({ framing: { fit: 'cover', zoom: 1, panX: 1, panY: 0 } });
    const r = resolverPropsMoldura(base, d, F9);
    expect(checarEdicao(r.layout, { ...GUARDA(base), faceTrack: [] }, r.textos, null, d).map((x) => x.rule)).not.toContain('face_cut');
  });
  it('caixa do vídeo por cima de nada: caption_covered segue a pintura nova', () => {
    const base = comLegenda();
    const r0 = resolverPropsMoldura(base, null, F9);
    const card = r0.layout.layers.find((l) => l.id === 'box:card')!;
    const auto = r0.layout.video!;
    // leva a legenda pra debaixo do cartão só com pan
    const faixaY = auto.sourceRect.y + (760 / 960) * auto.sourceRect.h;
    const d = video({ framing: { ...auto.framing, panY: auto.framing.panY + (card.rect.y + card.rect.h / 2 - faixaY) } });
    expect(regras(base, d).map((x) => x.rule)).toContain('caption_covered');
  });
});

describe('comVideoEditado (gesto do web)', () => {
  const f = { fit: 'cover' as const, zoom: 2, panX: 0, panY: 0 };
  const box = { x: 0, y: 0, w: 0.5, h: 0.5 };
  it('caixa nova sem framing volta ao auto; Auto reframe; limpar tudo = null', () => {
    const d1 = comVideoEditado(null, { framing: f })!;
    expect(d1.video).toEqual({ layerId: 'video', framing: f });
    const d2 = comVideoEditado(d1, { box })!;
    expect(d2.video).toEqual({ layerId: 'video', box });
    const d3 = comVideoEditado(d2, { framing: f, trim: { inSec: 1, outSec: 3 } })!;
    expect(d3.video).toEqual({ layerId: 'video', box, framing: f, trim: { inSec: 1, outSec: 3 } });
    expect(comVideoEditado(d3, { framing: null })!.video).toEqual({ layerId: 'video', box, trim: { inSec: 1, outSec: 3 } });
    expect(comVideoEditado(d1, { framing: null })).toBeNull();
    expect(d1.video!.framing).toEqual(f); // imutável
  });
  it('fora do principal grava no formatOverrides; o trim é um só', () => {
    const ctx = { format: '1x1' as const, principal: '9x16' as const };
    const d = comVideoEditado(null, { box, trim: { inSec: 1, outSec: 3 } }, ctx)!;
    expect(d.formatOverrides!['1x1']!.video).toEqual({ box });
    expect(d.video).toEqual({ layerId: 'video', trim: { inSec: 1, outSec: 3 } });
  });
});

describe('HEADLINE: vídeo', () => {
  const C = { format: '9x16' as const };
  const comFaixa: RemixKeepProps = { ...HEADLINE_ADD, outputProtectedBands: [{ kind: 'original', x: 100, y: 1500, w: 880, h: 150, startSec: 0, endSec: 5 }], faceHint: { x: 400, y: 300, w: 300, h: 400 } };
  it('sem doc: tela cheia e mesma base', () => {
    const r = resolverPropsHeadline(HEADLINE_ADD, null, C);
    expect(r.props).toBe(HEADLINE_ADD);
    expect(r.layout.video).toMatchObject({ box: { x: 0, y: 0, w: 1, h: 1 }, sourceRect: { x: 0, y: 0, w: 1, h: 1 }, visibleRect: { x: 0, y: 0, w: 1, h: 1 }, auto: true, edited: false, framing: { fit: 'cover', zoom: 1, panX: 0, panY: 0 }, trim: { inSec: 0, outSec: 5 } });
  });
  it('só texto: não mexe no vídeo', () => {
    const r = resolverPropsHeadline(HEADLINE_ADD, doc({ layers: [{ id: 'headline', text: 'Outro texto' }] }), C);
    expect(r.props.edicao).toBeUndefined();
    expect(r.props.canvas.frameCount).toBe(120);
  });
  it('caixa + framing vão pra edicao e a faixa de saída acompanha', () => {
    const r = resolverPropsHeadline(comFaixa, video({ box: { x: 0, y: 0.25, w: 1, h: 0.5 } }), C);
    const ev = r.props.edicao!.video;
    expect(ev.pintura!.box).toEqual({ x: 0, y: 480, w: 1080, h: 960 });
    expect(r.layout.video).toMatchObject({ auto: true, edited: true });
    expect(propsDeRemixInput(r.props).edicao).toEqual(r.props.edicao);
    const b = r.props.outputProtectedBands![0];
    expect(b.y).toBeLessThan(1440);
    const zoom = resolverPropsHeadline(comFaixa, video({ framing: { fit: 'cover', zoom: 2, panX: 0, panY: 0 } }), C);
    expect(zoom.layout.video!.sourceRect.w).toBeCloseTo(2, 5);
    expect(zoom.layout.video!.auto).toBe(false);
  });
  it('aparar: quadros, camadas, karaokê e faixas deslocados; base do arquivo no inFrame', () => {
    const r = resolverPropsHeadline(comFaixa, video({ trim: { inSec: 1, outSec: 3 } }), C);
    expect(r.props.canvas.frameCount).toBe(48);
    expect(r.props.edicao).toEqual({ video: { inFrame: 24, pintura: null } });
    const [h, k] = r.props.textLayers;
    expect([h.startFrame, h.endFrame]).toEqual([0, 48]);
    expect(k.content.kind === 'karaoke' && k.content.words[0]).toEqual({ word: 'travado', startFrame: 0, endFrame: 11 });
    expect(k.content.kind === 'karaoke' && k.content.words.every((w) => w.endFrame <= 48)).toBe(true);
    expect(r.layout.durationSec).toBe(2);
    expect(r.layout.video!.trim).toEqual({ inSec: 1, outSec: 3 });
    expect(r.props.outputProtectedBands![0]).toMatchObject({ startSec: 0, endSec: 2 });
    expect(propsDeRemixInput(r.props).canvas.frameCount).toBe(48);
  });
  it('caption_cut e face_cut', () => {
    const guard: EditorGuard = {
      source: { width: 1080, height: 1920, fps: 24 }, protectedBands: [{ x: 100, y: 1500, w: 880, h: 150, startSec: 0, endSec: 5 }],
      faceTrack: [{ startFrame: 0, endFrame: 120, region: { x: 0, y: 0, w: 1080, h: 1920 }, faceInRegion: [{ atFrame: 0, box: { x: 0.37, y: 0.15, w: 0.28, h: 0.2 } }] }],
    };
    const is = (d: EditDocV3) => { const r = resolverPropsHeadline(comFaixa, d, C); return checarEdicao(r.layout, guard, r.textos, null, d).map((i) => i.rule); };
    expect(is(doc({ layers: [{ id: 'headline', text: 'Outro' }] }))).not.toContain('caption_cut');
    expect(is(video({ framing: { fit: 'cover', zoom: 1, panX: 0, panY: -0.4 } }))).toContain('face_cut');
    expect(is(video({ framing: { fit: 'cover', zoom: 1, panX: 0, panY: 0.4 } }))).toContain('caption_cut');
    expect(is(video({ framing: { fit: 'cover', zoom: 1, panX: 0, panY: 0 } }))).not.toContain('caption_cut');
  });
});
