// troca-texto §16.6 V3: buildHeadlineInput com `look` (box e loose). Puro: look do fake da porta (mesma montagem da medida).
import type { EditMap, HeadlineLook } from '@maquina/contratos';
import { propsDeRemixInput } from '@maquina/video';
import { lookFake } from '../medicao/troca/fake';
import type { AutoEditContext } from './auto-edit';
import { buildHeadlineInput, marcarDestaqueNasLinhas, type HeadlineSpec } from './headline';

const W = 720, H = 1280;
const camada = (background: unknown) => ({
  id: 'headline-1', kind: 'headline', box: { x: 60, y: 120, w: 600, h: 150 }, startFrame: 0, endFrame: 200,
  text: 'Si en 2 minutos no te\nbusca, es porque\nnunca fue para ti..', background, source: 'vision', wordsPerPage: null,
  style: { fontId: 'montserrat-600', uppercase: false, fontSizePx: 44, lineHeight: 1.2, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
});
const mapa = (layers: unknown[], bandas: unknown[] = []) => ({
  version: 1, width: W, height: H, fps: 30, frameCount: 300, cells: [], overlaysOverFace: [], profile: null, layers, faceTrack: [],
  keepEdit: {} as never, protectedBands: bandas,
}) as unknown as EditMap;
const ctx = (m: EditMap): AutoEditContext => ({
  renderId: 'r-c', type: 'HEADLINE' as never, params: {} as never, language: 'es',
  source: { videoUrl: 'https://s3/campeao.mp4', width: W, height: H, fps: 30, durationSec: 10, hasAudio: true },
  editMap: m, words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null,
});
const caixa = { kind: 'solid', color: '#093c7b', box: { x: 0, y: 100, w: 720, h: 190 } };
const spec = (look: HeadlineLook, o: Partial<HeadlineSpec> = {}): HeadlineSpec => ({
  mode: 'replace', text: 'Si en 2 minutos no te\nbusca, es porque\nnunca fue para ti..', highlight: null, language: 'es', brandColor: null, look, ...o,
});

describe('buildHeadlineInput: cópia da headline (F1b, V3)', () => {
  it('box: imagem 2D na caixa medida, linhas prontas por linha de base, sem placa de vídeo', () => {
    const m = mapa([camada(caixa)]);
    const look = lookFake(m, 'headline-1', { kind: 'box' });
    const r = buildHeadlineInput(spec(look), ctx(m));
    const l = r.textLayers[0];
    expect(r.baseVideoUrl).toBe('https://s3/campeao.mp4');
    expect(r.placaComoBase).toBeUndefined();
    expect(l.background.image).toBe(look.plate!.image);
    expect(l.background.box).toEqual(look.box);
    expect([l.startFrame, l.endFrame]).toEqual([look.startFrame, look.endFrame]);
    expect(l.content.kind === 'static' && l.content.lines).toEqual(['Si en 2 minutos no te', 'busca, es porque', 'nunca fue para ti..']);
    expect(l.content.kind === 'static' && l.content.layout?.anchorX).toBe(look.fit.centerX);
    expect(l.style.fontId).toBe(look.font.fontId);
    expect(() => propsDeRemixInput(r)).not.toThrow();
  });
  it('loose: base = placa, áudio = campeão, placaComoBase; sem placa = HEADLINE_PENDING', () => {
    const m = mapa([camada({ kind: 'none', color: null, box: null })]);
    const look = lookFake(m, 'headline-1', { kind: 'loose' });
    expect(() => buildHeadlineInput(spec(look), ctx(m))).toThrow(/HEADLINE_PENDING/);
    const r = buildHeadlineInput(spec(look), ctx(m), { plateUrl: 'https://s3/placa.mp4' });
    expect(r.baseVideoUrl).toBe('https://s3/placa.mp4');
    expect(r.audioPassthroughUrl).toBe('https://s3/campeao.mp4');
    expect(r.placaComoBase).toBe(true);
    expect(r.textLayers[0].background.kind).toBe('none');
  });
  it('medida reprovada = HEADLINE_LOW_CONFIDENCE; sem look = HEADLINE_PENDING (F1a)', () => {
    const m = mapa([camada(caixa)]);
    expect(() => buildHeadlineInput(spec(lookFake(m, 'headline-1', { kind: 'box', motivo: 'font_far' })), ctx(m))).toThrow(/HEADLINE_LOW_CONFIDENCE/);
    expect(() => buildHeadlineInput(spec(null as never), ctx(m))).toThrow(/HEADLINE_PENDING/);
  });
  it('cópia é isenta da faixa protegida (§15.5.4 item 7)', () => {
    // legenda queimada cruzando a caixa (só na camada: o portão `near_caption` é da medida, aqui ela já passou)
    const m = mapa([camada(caixa), { ...camada({ kind: 'none', color: null, box: null }), id: 'cap', kind: 'caption', box: { x: 0, y: 150, w: 720, h: 80 } }]);
    const look = lookFake(m, 'headline-1', { kind: 'box' });
    expect(() => buildHeadlineInput(spec(look), ctx(m))).not.toThrow();
  });
  it('texto longo demais = HEADLINE_TOO_LONG', () => {
    const m = mapa([camada(caixa)]);
    const look = lookFake(m, 'headline-1', { kind: 'box' });
    expect(() => buildHeadlineInput(spec(look, { text: 'palavra '.repeat(60) }), ctx(m))).toThrow(/HEADLINE_TOO_LONG/);
  });
});

describe('marcarDestaqueNasLinhas', () => {
  it('o trecho cruza linhas e ignora caixa', () => {
    expect(marcarDestaqueNasLinhas(['SI EN 2 MINUTOS NO TE', 'BUSCA, ES PORQUE', 'NUNCA FUE PARA TI..'], 'es porque nunca fue para ti..'))
      .toEqual(['SI EN 2 MINUTOS NO TE', 'BUSCA, *ES PORQUE', 'NUNCA FUE PARA TI..*']);
    expect(marcarDestaqueNasLinhas(['a b', 'c d'], 'b')).toEqual(['a *b*', 'c d']);
    expect(marcarDestaqueNasLinhas(['a b'], 'zz')).toEqual(['a b']);
    expect(marcarDestaqueNasLinhas(['a b'], null)).toEqual(['a b']);
  });
});
