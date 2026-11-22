// Legenda móvel (20/11, design/spec-legenda-movel-2026-11-20.md): a NOSSA legenda (captionMode 'replace') das molduras vira a camada
// `caption`: só vertical, 3 tamanhos, 2 cores; fora da faixa segura / sobre rosto / sobre título só AVISA (decisão do Gusta, sem limite duro).
import { demoProps, DEMO_EDIT_MAP } from '../src/molduras/demo';
import {
  checarEdicao, exportLiberado, manifestoDe, normalizarDocV3, resolverPropsMoldura, validarDocMoldura, caixaLegendaMoldura, layoutDaPeca,
  contornoDaCor, edicaoDaLegenda,
  type EditDocV3, type EditorGuard, type MolduraProps,
} from '../src/lib';

const vazio = (o: Partial<EditDocV3> = {}): EditDocV3 => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], ...o });
const PALAVRAS = 'Esse truque simples muda a sua rotina todos os dias sem esforço nenhum'.split(' ').map((word, i) => ({ word, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
/** question_box com a nossa legenda no lugar da queimada (captionMode 'replace'). */
const nossa = (fmt: 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1' = 'VERTICAL_9_16'): MolduraProps => ({
  ...demoProps('question_box', fmt),
  captionMode: 'replace',
  captions: { words: PALAVRAS, highlightColor: '#ffe14a', language: 'pt' },
});
const GUARDA = (p: MolduraProps): EditorGuard => ({
  source: { width: 960, height: 960, fps: 24 },
  protectedBands: p.video.protectedBands ?? [],
  faceTrack: DEMO_EDIT_MAP.faceTrack.map((s) => ({ ...s, role: 'main' })),
});
const F9 = { format: '9x16' as const };
const cap = (base: MolduraProps, doc: EditDocV3 | null) => resolverPropsMoldura(base, doc, F9).layout.layers.find((l) => l.id === 'caption')!;
const yDoc = (y: number, style?: Record<string, unknown>) => vazio({ layers: [{ id: 'caption', transform: { x: 0.5, y, scale: 1, rotationDeg: 0, boxWidth: 1 }, ...(style && { style: style as never }) }] });
const regras = (base: MolduraProps, doc: EditDocV3 | null) => {
  const r = resolverPropsMoldura(base, doc, F9);
  return checarEdicao(r.layout, GUARDA(base), r.textos, { numbers: [] }, doc);
};

describe('manifesto', () => {
  it('caption só existe com a nossa legenda; move e estilo, sem redimensionar nem esconder', () => {
    const l = manifestoDe('frame:question_box', nossa()).layers.find((x) => x.id === 'caption')!;
    expect(l).toMatchObject({ kind: 'caption', lockedReason: null, optional: false });
    expect(l.editable).toMatchObject({ move: true, style: true, resize: false, rotate: false, text: false, hide: false, fill: false });
    // legenda original (queimada): sem caption, com o burned travado
    const queimada: MolduraProps = { ...demoProps('question_box'), video: { ...demoProps('question_box').video, protectedBands: [{ x: 120, y: 760, w: 720, h: 90, startSec: 0, endSec: 31 }] }, captions: undefined };
    const m = manifestoDe('frame:question_box', queimada).layers;
    expect(m.some((x) => x.id === 'caption')).toBe(false);
    expect(m.find((x) => x.id === 'burned')).toMatchObject({ lockedReason: 'burned_caption_pixels' });
    // captions automáticas sem 'replace' também não viram camada (escopo: só a nossa legenda do replace)
    expect(manifestoDe('frame:question_box', { ...nossa(), captionMode: undefined }).layers.some((x) => x.id === 'caption')).toBe(false);
  });
});

describe('resolver', () => {
  it('sem edição = as mesmas props (mesmo objeto), com ou sem doc vazio', () => {
    const b = nossa();
    expect(resolverPropsMoldura(b, null, F9).props).toBe(b);
    expect(resolverPropsMoldura(b, vazio(), F9).props).toBe(b);
  });
  it('a camada caption entra no layout com a caixa de hoje', () => {
    const b = nossa();
    const L = layoutDaPeca(b);
    const c = caixaLegendaMoldura(b, L)!.box;
    const l = cap(b, null);
    expect(l).toMatchObject({ kind: 'caption', visible: true });
    expect(l.rect.y * 1920).toBeCloseTo(c.y, 0);
    expect(l.rect.h * 1920).toBeCloseTo(c.h, 0);
  });
  it('posição: o centro da caixa vai pro y do doc, em qualquer ponto até a borda', () => {
    const b = nossa();
    const alto = cap(b, yDoc(0.3));
    expect(alto.rect.y + alto.rect.h / 2).toBeCloseTo(0.3, 2);
    const borda = cap(b, yDoc(0.01)); // sem limite duro: cola na borda de cima
    expect(borda.rect.y).toBeGreaterThanOrEqual(0);
    expect(borda.rect.y).toBeLessThan(0.02);
    const baixo = cap(b, yDoc(0.999));
    expect(baixo.rect.y + baixo.rect.h).toBeLessThanOrEqual(1 + 1e-6);
    expect(resolverPropsMoldura(b, yDoc(0.3), F9).props.captions!.edicao).toEqual({ cy: 0.3 });
  });
  it('tamanho: Pequena 0,8 / Grande 1,23 sobre o padrão; cor do texto troca e o contorno inverte sozinho', () => {
    const b = nossa();
    const pad = cap(b, null).fontPx!;
    expect(cap(b, vazio({ layers: [{ id: 'caption', style: { size: 'lg' } }] })).fontPx!).toBeCloseTo(pad * 1.23, 0);
    expect(cap(b, vazio({ layers: [{ id: 'caption', style: { size: 'sm' } }] })).fontPx!).toBeCloseTo(pad * 0.8, 0);
    const p = resolverPropsMoldura(b, vazio({ layers: [{ id: 'caption', style: { color: '#111111', highlightColor: '#ff5fa2' } }] }), F9).props;
    expect(p.captions!.edicao).toEqual({ color: '#111111', stroke: '#ffffff', highlight: '#ff5fa2' });
    expect(contornoDaCor('#ffffff')).toBe('#000000');
    expect(contornoDaCor('#ffe14a')).toBe('#000000');
    expect(contornoDaCor('#111111')).toBe('#ffffff');
  });
  it('posição por formato: o 9:16 e o 4:5 guardam cada um a sua', () => {
    const d = vazio({ layers: [{ id: 'caption', transform: { x: 0.5, y: 0.3, scale: 1, rotationDeg: 0, boxWidth: 1 } }], formatOverrides: { '4x5': { layers: [{ id: 'caption', transform: { x: 0.5, y: 0.6, scale: 1, rotationDeg: 0, boxWidth: 1 } }] } } });
    expect(edicaoDaLegenda(d, '9x16', '9x16')!.cy).toBe(0.3);
    expect(edicaoDaLegenda(d, '4x5', '9x16')!.cy).toBe(0.6);
    expect(edicaoDaLegenda(d, '1x1', '9x16')).toBeNull();
  });
  it('a faixa protegida da saída segue a legenda (a checagem por visão olha onde ela está)', () => {
    const b = { ...nossa(), outputProtectedBands: [{ kind: 'replaced' as const, x: 0, y: 1, w: 1, h: 1, startSec: 0, endSec: 1 }] };
    const r = resolverPropsMoldura(b, yDoc(0.25), F9).props;
    const f = r.outputProtectedBands!.find((x) => x.kind === 'replaced')!;
    expect(f.y + f.h / 2).toBeCloseTo(0.25 * 1920, -1);
  });
});

describe('validação (só vertical, cor hex livre)', () => {
  const base = nossa();
  const erros = (d: EditDocV3) => validarDocMoldura(d, base).map((e) => `${e.field}:${e.rule}`);
  it('doc bom passa; cor da lista e tamanho passam', () => {
    expect(erros(yDoc(0.4, { size: 'lg', color: '#ffe14a', highlightColor: '#4aa8ff' }))).toEqual([]);
    expect(erros(yDoc(0.02))).toEqual([]); // perto da borda: não é erro
  });
  it('x/escala/largura fora do marcador, rect e altura fora do quadro', () => {
    expect(erros(vazio({ layers: [{ id: 'caption', transform: { x: 0.3, y: 0.5, scale: 1, rotationDeg: 0, boxWidth: 1 } }] }))).toContain('layers[0].transform:not_editable');
    expect(erros(vazio({ layers: [{ id: 'caption', transform: { x: 0.5, y: 0.5, scale: 1, rotationDeg: 10, boxWidth: 1 } }] }))).toContain('layers[0].transform.rotationDeg:not_editable');
    expect(erros(vazio({ layers: [{ id: 'caption', rect: { x: 0, y: 0.5, w: 0.5, h: 0.1 } }] }))).toContain('layers[0].rect:not_editable');
    expect(erros(yDoc(1.2))).toContain('layers[0].transform.y:rect_out_of_range');
  });
  it('cor livre (22/11) aceita qualquer hex; texto = palavra falada, texto e fonte/contorno não editáveis', () => {
    expect(erros(vazio({ layers: [{ id: 'caption', style: { color: '#123456', highlightColor: '#ab12cd' } }] }))).toEqual([]);
    expect(erros(vazio({ layers: [{ id: 'caption', style: { color: 'vermelho' } }] }))).toContain('layers[0].style.color:bad_color');
    expect(erros(vazio({ layers: [{ id: 'caption', style: { color: '#ffe14a' } }] }))).toContain('layers[0].style.highlightColor:bad_color'); // a palavra falada padrão já é amarela
    expect(erros(vazio({ layers: [{ id: 'caption', style: { color: '#ffffff', highlightColor: '#ffffff' } }] }))).toContain('layers[0].style.highlightColor:bad_color');
    expect(erros(vazio({ layers: [{ id: 'caption', style: { size: 'xl' as never } }] }))).toContain('layers[0].style.size:bad_template_opt_value');
    expect(erros(vazio({ layers: [{ id: 'caption', style: { strokeColor: '#ff0000' } }] }))).toContain('layers[0].style.strokeColor:not_editable');
    expect(erros(vazio({ layers: [{ id: 'caption', text: 'oi' }] }))).toContain('layers[0].text:not_editable');
    expect(erros(vazio({ layers: [{ id: 'caption', visible: false }] }))).toContain('layers[0].visible:not_editable');
  });
  it('chave do estilo com undefined (como chega do DTO da API) não é erro (QA 22/11)', () => {
    const st = { fontId: undefined, background: undefined, strokeColor: undefined, size: 'lg', color: '#ffe14a', highlightColor: '#4aa8ff' } as never;
    expect(erros(vazio({ layers: [{ id: 'caption', style: st }] }))).toEqual([]);
  });
  it('peça sem a nossa legenda: a camada caption não existe (unknown_layer)', () => {
    expect(validarDocMoldura(yDoc(0.4), demoProps('question_box')).map((e) => e.rule)).toContain('unknown_layer');
  });
});

describe('checagens (só avisam, nunca travam o Baixar)', () => {
  const base = nossa();
  it('sem edição: nenhum aviso de legenda (o padrão não muda)', () => {
    expect(regras(base, null).filter((i) => i.rule.startsWith('caption_over') || i.rule === 'caption_off_safe')).toEqual([]);
  });
  it('fora da faixa segura do Reels/TikTok: warn', () => {
    const i = regras(base, yDoc(0.03));
    expect(i).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'caption_off_safe', level: 'warn', layerId: 'caption' })]));
    expect(exportLiberado(i)).toBe(true);
    expect(regras(base, yDoc(0.96)).map((x) => x.rule)).toContain('caption_off_safe');
    expect(regras(base, yDoc(0.5)).map((x) => x.rule)).not.toContain('caption_off_safe');
  });
  it('em 4:5 a faixa segura é 6% a 94%', () => {
    const b45 = nossa('PORTRAIT_4_5');
    const r = (y: number) => { const d = vazio({ layers: [{ id: 'caption', transform: { x: 0.5, y, scale: 1, rotationDeg: 0, boxWidth: 1 } }] }); const rr = resolverPropsMoldura(b45, d, { format: '4x5', principal: '4x5' }); return checarEdicao(rr.layout, GUARDA(b45), rr.textos, null, d).map((i) => i.rule); };
    expect(r(0.5)).not.toContain('caption_off_safe');
    expect(r(0.02)).toContain('caption_off_safe');
  });
  it('em cima do título: warn; em cima do rosto: warn', () => {
    const r0 = resolverPropsMoldura(base, null, F9);
    const titulo = r0.layout.layers.find((l) => l.id === 'slot:question')!;
    const sobreTitulo = regras(base, yDoc(titulo.rect.y + titulo.rect.h / 2));
    expect(sobreTitulo).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'caption_over_text', level: 'warn', layerId: 'caption' })]));
    expect(exportLiberado(sobreTitulo)).toBe(true);
    const v = r0.layout.video!;
    const rostoY = v.sourceRect.y + 0.3 * v.sourceRect.h; // o rosto da demo vai de 0.1 a 0.45 do arquivo
    const sobreRosto = regras(base, yDoc(rostoY));
    expect(sobreRosto.map((i) => i.rule)).toContain('caption_over_face');
    expect(sobreRosto.every((i) => i.level !== 'block' && i.level !== 'confirm' || !i.rule.startsWith('caption_over'))).toBe(true);
  });
  it('trocar só o tamanho já liga as checagens (rodam depois de mexer na legenda)', () => {
    const d = vazio({ layers: [{ id: 'caption', style: { size: 'lg' } }] });
    expect(regras(base, d).every((i) => i.level === 'warn' || i.level === 'info')).toBe(true);
  });
});

describe('normalização', () => {
  it('tamanho médio some do doc; posição e cor ficam', () => {
    const base = nossa();
    const m = manifestoDe('frame:question_box', base);
    const n = normalizarDocV3(yDoc(0.4, { size: 'md', color: '#ffe14a' }), base, m)!;
    expect(n.layers).toEqual([{ id: 'caption', transform: { x: 0.5, y: 0.4, scale: 1, rotationDeg: 0, boxWidth: 1 }, style: { color: '#ffe14a' } }]);
  });
});
