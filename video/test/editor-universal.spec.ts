// Editor universal v1, F-U1 (docs/contratos/editor-universal-v1.md §5): portão do maquina-video.
// (a) doc nulo/vazio = mesmas props (deep-equal e o MESMO objeto) nas 18 molduras × 3 formatos + casos extras + 2 HEADLINE;
// manifesto, resolver com doc, validação de estrutura, checagens e normalização. O (b) (render idêntico frame a frame) é
// scripts/editor-universal/aceite-doc-nulo.mjs (render local, mais lento que o Jest).
import { casosAceite, HEADLINE_ADD, HEADLINE_PLACA } from '../scripts/editor-universal/casos';
import { CASOS, casoTrilha, TRILHA_TEMPLATES } from '../src/molduras/casos';
import { DEMO_EDIT_MAP, demoProps } from '../src/molduras/demo';
import {
  checarEdicao, docV3De, exportLiberado, FRAME_IDS, manifestoDe, normalizarDocV3, normalizarDoc, numerosNaoConfirmados, resolverProps,
  resolverPropsHeadline, resolverPropsMoldura, validarDocHeadline, validarDocMoldura, validarDoc,
  type EditDoc, type EditDocV3, type EditorGuard, type MolduraProps, type ScratchSource,
} from '../src/lib';

const vazio = (o: Partial<EditDocV3> = {}): EditDocV3 => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], ...o });
const COD = { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' } as const;

describe('(a) doc nulo = props de hoje', () => {
  const casos = casosAceite();
  it('cobre 18 molduras × 3 formatos + 2 HEADLINE', () => {
    expect(casos.filter((c) => c.composicao === 'Moldura')).toHaveLength(54);
    expect(casos.filter((c) => c.composicao === 'RemixKeep')).toHaveLength(2);
  });
  it.each(casos.map((c) => [c.nome, c] as const))('%s', (_n, c) => {
    for (const doc of [null, undefined, vazio(), { version: 1, clips: [], trim: null, layers: [], captionWords: [] } as EditDoc, vazio({ templateOpts: {}, items: {}, formatOverrides: {} })]) {
      const base = JSON.parse(JSON.stringify(c.props));
      const r = c.composicao === 'Moldura' ? resolverPropsMoldura(c.props as MolduraProps, doc, { format: c.formato }) : resolverPropsHeadline(c.props as never, doc, { format: c.formato });
      expect(r.props).toBe(c.props);
      expect(r.props).toEqual(base);
      expect(r.layout.layers.length).toBeGreaterThan(0);
    }
  });
  it('casos extras das molduras (limite, idiomas, sem facetrack, Meet com imagem) e trilha de b-roll', () => {
    const extras: MolduraProps[] = [...CASOS.map((c) => c.props), ...TRILHA_TEMPLATES.flatMap((id) => (['VERTICAL_9_16', 'SQUARE_1_1'] as const).map((f) => casoTrilha(id, f)))];
    for (const p of extras) expect(resolverPropsMoldura(p, null, { format: COD[p.format] }).props).toBe(p);
  });
});

describe('manifesto', () => {
  it.each(FRAME_IDS.map((id) => [id]))('frame:%s tem ids estáveis, cor da marca, formato, textos e guias', (id) => {
    const base = demoProps(id, 'VERTICAL_9_16');
    const m = manifestoDe(`frame:${id}`, base);
    expect(m.formats).toEqual(['9x16', '4x5', '1x1']);
    expect(m.defaults.brand).toBe('#5B4BF5');
    expect(m.layers.map((l) => l.id)).toContain('video');
    expect(new Set(m.layers.map((l) => l.id)).size).toBe(m.layers.length);
    expect(m.controls.map((c) => c.type)).toEqual(expect.arrayContaining(['color', 'format', 'guides']));
    for (const l of m.layers) expect(Object.keys(l.editable).sort()).toEqual(['fill', 'hide', 'move', 'reframe', 'resize', 'rotate', 'style', 'text', 'timing', 'trim']);
    // mesmo manifesto montado da base de outro formato (o da peça não depende do formato)
    expect(manifestoDe(`frame:${id}`, demoProps(id, 'SQUARE_1_1')).layers.map((l) => l.id)).toEqual(m.layers.map((l) => l.id));
  });
  it('ids da moldura seguem o §3.2', () => {
    const ids = (id: (typeof FRAME_IDS)[number]) => manifestoDe(`frame:${id}`, demoProps(id)).layers.map((l) => l.id);
    expect(ids('news')).toEqual(['slot:topic', 'slot:headline.lead', 'slot:headline.highlight', 'slot:dek', 'slot:cta', 'box:header', 'video']);
    expect(ids('ranking')).toEqual(['slot:title', 'slot:items', 'box:card', 'box:list', 'video']);
    expect(ids('split_stack')).toEqual(['slot:headline', 'box:band', 'video', 'video:2']);
    expect(ids('cinema')).toEqual(['slot:question', 'slot:subtitle', 'brand', 'box:text', 'video']);
    const r = manifestoDe('frame:ranking', demoProps('ranking'));
    expect(r.controls.find((c) => c.type === 'rows')).toEqual({ type: 'rows', group: 'content', layers: ['slot:title'], itemsOf: 'slot:items', timed: false });
  });
  it('legenda queimada vira camada travada `burned`', () => {
    const base = comLegenda();
    const m = manifestoDe('frame:question_box', base);
    expect(m.layers.find((l) => l.id === 'burned')).toMatchObject({ kind: 'burned', lockedReason: 'burned_caption_pixels' });
  });
  it('HEADLINE: headline + headline:box + video, formato do quadro do campeão', () => {
    const m = manifestoDe('headline', HEADLINE_ADD);
    expect(m.layers.map((l) => l.id)).toEqual(['headline', 'headline:box', 'video']);
    expect(m.formats).toEqual(['9x16']);
    expect(manifestoDe('headline', HEADLINE_PLACA).formats).toEqual(['1x1']);
  });
  it('família fora do F-U1 lança', () => {
    expect(() => manifestoDe('chat-dm', HEADLINE_ADD)).toThrow();
  });
});

/** question_box com legenda queimada no meio do quadro (px do arquivo 960×960). */
function comLegenda(): MolduraProps {
  const b = demoProps('question_box', 'VERTICAL_9_16');
  return { ...b, video: { ...b.video, protectedBands: [{ x: 120, y: 760, w: 720, h: 90, startSec: 0, endSec: 31 }] } };
}
const GUARDA = (p: MolduraProps): EditorGuard => ({
  source: { width: 960, height: 960, fps: 24 },
  protectedBands: p.video.protectedBands ?? [],
  faceTrack: DEMO_EDIT_MAP.faceTrack.map((s) => ({ ...s, role: 'main' })),
});

describe('resolverPropsMoldura com doc', () => {
  it('texto, item, cor da marca e caixa mexida/escondida', () => {
    const base = demoProps('ranking', 'VERTICAL_9_16');
    const doc = vazio({
      templateOpts: { brand: '#FF0000' },
      layers: [{ id: 'slot:title', text: 'O que destrava' }, { id: 'box:card', rect: { x: 0.1, y: 0.3, w: 0.4, h: 0.4 } }, { id: 'box:list', visible: false }],
      items: { 'slot:items': [{ id: 'i2', text: 'Dormir torto' }] },
    });
    const r = resolverPropsMoldura(base, doc, { format: '9x16' });
    expect(r.props.frame.brand.color).toBe('#FF0000');
    expect((r.props.frame.texts as { title: string }).title).toBe('O que destrava');
    expect((r.props.frame.texts as { items: string[] }).items[1]).toBe('Dormir torto');
    const card = r.props.edicao!.camadas.find((c) => c.id === 'box:card')!;
    expect(card.para!.x).toBeCloseTo(108, 0);
    expect(card.para!.w / card.de.w).toBeCloseTo(card.para!.h / card.de.h, 5); // escala por igual
    expect(r.props.edicao!.camadas.find((c) => c.id === 'box:list')).toMatchObject({ visible: false, para: null });
    expect(r.layout.layers.find((l) => l.id === 'box:card')!.rect.x).toBeCloseTo(0.1, 4);
    expect(r.layout.layers.find((l) => l.id === 'box:list')!.visible).toBe(false);
    expect(r.textos.find((t) => t.path === 'item:slot:items/i2')).toMatchObject({ edited: true, text: 'Dormir torto' });
    expect(base.frame.brand.color).toBe('#5B4BF5'); // a base não muda
  });
  it('geometria vale no formato principal; os outros usam o layout do template (ou o formatOverrides)', () => {
    const doc = vazio({ layers: [{ id: 'box:card', rect: { x: 0.05, y: 0.05, w: 0.5, h: 0.5 } }, { id: 'slot:title', text: 'Novo título' }] });
    const r1 = resolverPropsMoldura(demoProps('ranking', 'SQUARE_1_1'), doc, { format: '1x1' });
    expect(r1.props.edicao).toBeUndefined();
    expect((r1.props.frame.texts as { title: string }).title).toBe('Novo título');
    const r2 = resolverPropsMoldura(demoProps('ranking', 'SQUARE_1_1'), { ...doc, formatOverrides: { '1x1': { layers: [{ id: 'box:card', rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } }] } } }, { format: '1x1' });
    expect(r2.props.edicao!.camadas[0].para!.x).toBeCloseTo(216, 0);
  });
  it('"De" do preço vazio some (campo nulo); texto vazio no resto fica o da base', () => {
    const r = resolverPropsMoldura(demoProps('direct_offer'), vazio({ layers: [{ id: 'slot:price.from', text: '' }, { id: 'slot:promise', text: ' ' }] }), { format: '9x16' });
    const t = r.props.frame.texts as { price: { from: string | null }; promise: string };
    expect(t.price.from).toBeNull();
    expect(t.promise).toBe('Sua coluna *leve* de novo');
  });
});

describe('validarDocMoldura (estrutura → 400)', () => {
  const base = demoProps('news', 'VERTICAL_9_16');
  const regras = (doc: EditDocV3) => validarDocMoldura(doc, base).map((e) => `${e.field}:${e.rule}`);
  it('doc bom passa', () => {
    expect(regras(vazio({ templateOpts: { brand: '#00AA00' }, layers: [{ id: 'slot:cta', rect: { x: 0.1, y: 0.8, w: 0.8, h: 0.06 } }, { id: 'slot:dek', text: 'Outro texto' }] }))).toEqual([]);
  });
  it('acusa camada desconhecida, o que é travado, cor, caixa fora, opção, item, confirmação e formato', () => {
    const r = regras(vazio({
      templateOpts: { brand: 'red', look: 'ink' },
      layers: [
        { id: 'nada', text: 'x' }, { id: 'slot:dek', rect: { x: 0, y: 0, w: 0.5, h: 0.1 } }, { id: 'video', visible: false },
        { id: 'box:header', rect: { x: 1.2, y: 0, w: 0.5, h: 0.1 } }, { id: 'slot:cta', transform: { x: 0.5, y: 0.5, scale: 1, rotationDeg: 10, boxWidth: 0.8 } },
      ],
      items: { 'slot:topic': [{ id: 'i1', text: 'x' }] },
      confirmations: [{ path: 'layer:slot:dek', numbers: ['42'], byUserId: 'u', at: '2026-11-04T00:00:00Z' }],
      formatOverrides: { '9x16': { layers: [] } },
      video: { layerId: 'video', box: { x: 0, y: 0, w: 1, h: 1 } },
    }));
    expect(r).toEqual(expect.arrayContaining([
      'templateOpts.brand:bad_template_opt_value', 'templateOpts.look:unknown_template_opt', 'layers[0].id:unknown_layer', 'layers[1].rect:not_editable',
      'layers[2].visible:not_editable', 'layers[3].rect:rect_out_of_range', 'layers[4].transform.rotationDeg:not_editable', 'items.slot:topic:unknown_layer',
      'confirmations[0]:bad_confirmation', 'formatOverrides.9x16:format_not_supported',
    ]));
  });
  it('item desconhecido e confirmação válida', () => {
    const b = demoProps('ranking');
    expect(validarDocMoldura(vazio({ items: { 'slot:items': [{ id: 'i9', text: 'x' }] } }), b).map((e) => e.rule)).toEqual(['unknown_item']);
    const ok = vazio({ layers: [{ id: 'slot:title', text: 'Top 7 erros' }], confirmations: [{ path: 'layer:slot:title', numbers: ['7'], byUserId: 'u', at: 'x' }] });
    expect(validarDocMoldura(ok, b)).toEqual([]);
  });
});

describe('checarEdicao (§6.2)', () => {
  it('base sem doc: nenhuma pílula', () => {
    const base = comLegenda();
    const r = resolverPropsMoldura(base, null, { format: '9x16' });
    expect(checarEdicao(r.layout, GUARDA(base), r.textos, { numbers: [] }, null)).toEqual([]);
  });
  it('caixa por cima da legenda queimada = caption_covered (block); por cima do rosto = face_covered', () => {
    const base = comLegenda();
    const r0 = resolverPropsMoldura(base, null, { format: '9x16' });
    const burned = r0.layout.layers.find((l) => l.id === 'burned')!;
    const card0 = r0.layout.layers.find((l) => l.id === 'box:card')!;
    const sobre = vazio({ layers: [{ id: 'box:card', rect: { x: card0.rect.x, y: burned.rect.y - 0.01, w: card0.rect.w, h: card0.rect.h } }] });
    const r1 = resolverPropsMoldura(base, sobre, { format: '9x16' });
    const i1 = checarEdicao(r1.layout, GUARDA(base), r1.textos, { numbers: [] }, sobre);
    expect(i1).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'caption_covered', level: 'block', layerId: 'box:card', format: '9x16', atSec: 0 })]));
    expect(exportLiberado(i1)).toBe(false);
    // rosto: 0.41..0.67 × 0.1..0.45 do arquivo, projetado pela pintura da caixa
    const v = r0.layout.video!;
    const rosto = { x: v.sourceRect.x + 0.45 * v.sourceRect.w, y: v.sourceRect.y + 0.15 * v.sourceRect.h, w: 0.2 * v.sourceRect.w, h: 0.2 * v.sourceRect.h };
    const noRosto = vazio({ layers: [{ id: 'box:card', rect: rosto }] });
    const r2 = resolverPropsMoldura(base, noRosto, { format: '9x16' });
    expect(checarEdicao(r2.layout, GUARDA(base), r2.textos, { numbers: [] }, noRosto).map((i) => i.rule)).toContain('face_covered');
  });
  it('número novo pede confirmação; confirmado, libera', () => {
    const base = demoProps('news');
    const doc = vazio({ layers: [{ id: 'slot:dek', text: 'Rotina de 12 minutos solta a lombar' }] });
    const r = resolverPropsMoldura(base, doc, { format: '9x16' });
    const i = checarEdicao(r.layout, null, r.textos, { numbers: ['10'] }, doc);
    expect(i).toEqual([expect.objectContaining({ rule: 'invented_number', level: 'confirm', layerId: 'slot:dek', detail: { numbers: ['12'] } })]);
    const conf = { ...doc, confirmations: [{ path: 'layer:slot:dek', numbers: ['12'], byUserId: 'u', at: 'x' }] };
    expect(checarEdicao(r.layout, null, r.textos, { numbers: ['10'] }, conf)).toEqual([]);
    // texto da IA (não editado) com número não passa pela regra
    const r0 = resolverPropsMoldura(base, null, { format: '9x16' });
    expect(checarEdicao(r0.layout, null, r0.textos, { numbers: [] }, null).map((x) => x.rule)).not.toContain('invented_number');
  });
  it('texto longo demais (too_long) e caixa pequena demais (text_overflow)', () => {
    const base = demoProps('question_box');
    const longo = vazio({ layers: [{ id: 'slot:question', text: 'x'.repeat(71) }] });
    const r = resolverPropsMoldura(base, longo, { format: '9x16' });
    expect(checarEdicao(r.layout, null, r.textos, null, longo).map((i) => i.rule)).toEqual(expect.arrayContaining(['too_long']));
    const card = resolverPropsMoldura(base, null, { format: '9x16' }).layout.layers.find((l) => l.id === 'box:card')!.rect;
    const pequeno = vazio({ layers: [{ id: 'box:card', rect: { x: card.x, y: card.y, w: card.w * 0.4, h: card.h * 0.4 } }] });
    const r2 = resolverPropsMoldura(base, pequeno, { format: '9x16' });
    expect(checarEdicao(r2.layout, null, r2.textos, null, pequeno)).toEqual([expect.objectContaining({ rule: 'text_overflow', layerId: 'slot:question' })]);
  });
  it('numerosNaoConfirmados usa a normalização da API (só dígitos)', () => {
    expect(numerosNaoConfirmados('De R$ 97,90 por 1.000 pessoas', { numbers: ['9790'] }, [], 'layer:x')).toEqual(['1000']);
  });
});

describe('HEADLINE', () => {
  it('texto, estilo, cor da faixa e caixa movida (o texto acompanha)', () => {
    const doc = vazio({ layers: [{ id: 'headline', text: 'Nova *headline*', style: { color: '#111111' } }, { id: 'headline:box', fill: '#FFFFFF', rect: { x: 0, y: 0.5, w: 1, h: 0.1421875 } }] });
    const r = resolverPropsHeadline(HEADLINE_ADD, doc, { format: '9x16' });
    const l = r.props.textLayers.find((x) => x.id === 'headline-nova')!;
    expect(l.content).toEqual({ kind: 'static', text: 'Nova *headline*' });
    expect(l.style.color).toBe('#111111');
    expect(l.background.color).toBe('#FFFFFF');
    expect(l.background.box!.y).toBe(960);
    expect(l.box.y).toBeCloseTo(960 + 21, 0);
    expect(r.props.textLayers.find((x) => x.id === 'legenda-auto')).toBe(HEADLINE_ADD.textLayers[1]);
    expect(r.layout.layers.find((x) => x.id === 'headline:box')!.rect.y).toBeCloseTo(0.5, 5);
  });
  it('contraste baixo = low_contrast (warn); transform escala a fonte', () => {
    const doc = vazio({ layers: [{ id: 'headline', style: { color: '#6A5BFF' }, transform: { x: 0.5, y: 0.3, scale: 0.5, rotationDeg: 0, boxWidth: 0.8 } }] });
    const r = resolverPropsHeadline(HEADLINE_ADD, doc, { format: '9x16' });
    expect(r.props.textLayers[0].style.fontSizePx).toBe(35);
    const i = checarEdicao(r.layout, null, r.textos, null, doc);
    expect(i.map((x) => x.rule)).toEqual(expect.arrayContaining(['low_contrast', 'text_overflow']));
  });
  it('validação', () => {
    expect(validarDocHeadline(vazio({ layers: [{ id: 'headline', style: { fontId: 'comic-sans' as never } }, { id: 'headline:box', visible: false }, { id: 'video', rect: { x: 0, y: 0, w: 1, h: 1 } }] }), HEADLINE_ADD).map((e) => `${e.field}:${e.rule}`))
      .toEqual(expect.arrayContaining(['layers[0].style.fontId:unknown_font', 'layers[1].visible:not_editable', 'layers[2].rect:not_editable']));
  });
});

describe('normalizarDocV3', () => {
  it('tira o que é igual ao padrão e devolve null quando sobra nada', () => {
    const base = demoProps('news');
    const m = manifestoDe('frame:news', base);
    const igual = vazio({ templateOpts: { brand: '#5b4bf5' }, layers: [{ id: 'slot:dek', text: (base.frame.texts as { dek: string }).dek }, { id: 'video', visible: false }] });
    expect(normalizarDocV3(igual, base, m)).toBeNull();
    const n = normalizarDocV3(vazio({ layers: [{ id: 'slot:cta', text: 'Veja agora' }, { id: 'slot:cta', rect: { x: 0.1, y: 0.8, w: 0.8, h: 0.05 } }] }), base, m)!;
    expect(n.layers).toEqual([{ id: 'slot:cta', rect: { x: 0.1, y: 0.8, w: 0.8, h: 0.05 } }]);
  });
});

describe('criativo do zero aceita o doc v3 (§13 passo 1)', () => {
  const fonte: ScratchSource = {
    format: 'VERTICAL_9_16', fps: 30, language: 'pt',
    scenes: [{ sceneId: 's1', index: 0, attempt: 1, durationSec: 4, clipStartSec: 0, clip: { url: 'a.mp4' }, words: [{ word: 'oi', startSec: 0, endSec: 0.5 }] }],
  };
  const settings = { templateId: 'clean', captionStyle: 'word' as const, captionPosition: 'bottom' as const, headline: null, ctaText: 'Toque', endCard: false };
  it('v1 e v3 dão as mesmas props; validar e normalizar mantêm a versão', () => {
    const v1: EditDoc = { version: 1, clips: [], trim: null, layers: [{ id: 'cta', text: 'Compre' }], captionWords: [{ key: 's1@1:0', text: 'olá' }] };
    const v3 = docV3De(v1)!;
    expect(v3.version).toBe(3);
    expect(resolverProps(fonte, settings, v3)).toEqual(resolverProps(fonte, settings, v1));
    expect(validarDoc(v3, fonte)).toEqual([]);
    expect(normalizarDoc(v3, fonte)!.version).toBe(3);
    expect(normalizarDoc(v1, fonte)!.version).toBe(1);
  });
});
