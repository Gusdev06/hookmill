// headline-e-legenda-v1 §1.3 + troca-texto-queimado-v1 §15.3: buildHeadlineInput (puro). `replace` = HEADLINE_PENDING; `add` = faixa adicionada.
import { propsDeRemixInput } from '@maquina/video';
import type { AutoEditContext } from './auto-edit';
import { buildHeadlineInput, HeadlineError, marcarDestaque, razaoContraste, type HeadlineSpec } from './headline';

const estilo = { fontId: 'inter-800', uppercase: false, fontSizePx: 33, lineHeight: 1.15, color: '#FFFFFF', highlightColor: '#FF5FAE', strokeColor: '#E0207F', strokeWidthPx: 3, shadow: true, align: 'center' } as const;
const camada = (over: Record<string, unknown> = {}) => ({
  id: 'headline-1', kind: 'headline', box: { x: 58, y: 96, w: 605, h: 77 }, startFrame: 0, endFrame: 300, text: 'Original headline here',
  background: { kind: 'none', color: null, box: null }, style: estilo, source: 'vision', wordsPerPage: null, ...over,
});
const ctx = (layers: unknown[], face = true, rostoY = 0.1): AutoEditContext => ({
  renderId: 'r-h', type: 'HEADLINE' as never, params: { type: 'HEADLINE' } as never, language: 'zh-TW',
  source: { videoUrl: 'https://s3/c.mp4', width: 720, height: 1280, fps: 30, durationSec: 10, hasAudio: true },
  editMap: {
    version: 1, width: 720, height: 1280, fps: 30, frameCount: 300, cells: [], overlaysOverFace: [], profile: null, layers,
    faceTrack: face ? [{ startFrame: 0, endFrame: 300, region: { x: 0, y: 187, w: 720, h: 933 }, fullFrame: false, faceInRegion: [{ atFrame: 0, box: { x: 0.36, y: rostoY, w: 0.38, h: 0.4 } }], facesMax: 1, minScore: 0.9 }] : [],
    keepEdit: {} as never,
  } as never,
  words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null,
});
const spec = (o: Partial<HeadlineSpec> = {}): HeadlineSpec => ({ mode: 'replace', text: '你跟外國同事說過 I\'m not convenient 嗎？', highlight: 'I\'m not convenient', language: 'zh-TW', brandColor: '#0008FF', ...o });

describe('buildHeadlineInput', () => {
  it('finds a free band below when the default headline position would cover burned-in captions', () => {
    const source = ctx([camada({ kind: 'caption', box: { x: 0, y: 20, w: 720, h: 300 } })], false);
    const result = buildHeadlineInput(spec({ mode: 'add', text: 'A clear headline', highlight: null, language: 'en' }), source);
    const newBox = result.textLayers[0].background.box!;
    expect(newBox.y).toBeGreaterThan(320);
    expect(result.outputProtectedBands?.length).toBeGreaterThan(0);
    expect(result.audioPassthroughUrl).toBe(source.source.videoUrl);
    expect(source.editMap!.layers[0].kind).toBe('caption');
  });
  it('§15.3: replace nunca monta placa nem faixa, em nenhum caso de fundo, com ou sem cor medida', () => {
    const faixa = { kind: 'solid', color: 'rgba(240,8,0,0.7)', box: { x: 0, y: 80, w: 720, h: 110 } };
    const casos: [Partial<HeadlineSpec>, unknown[]][] = [
      [{}, [camada()]],
      [{ plateColor: '#101010' }, [camada()]],
      [{}, [camada({ background: faixa })]],
      [{}, [camada({ background: { kind: 'pill', color: '#101010', box: null } })]],
      [{}, []],
    ];
    for (const [s, layers] of casos) {
      expect(() => buildHeadlineInput(spec(s), ctx(layers))).toThrow(HeadlineError);
      expect(() => buildHeadlineInput(spec(s), ctx(layers))).toThrow(/HEADLINE_PENDING/);
    }
  });
  it('add: faixa na cor da marca, texto pelo contraste; no rosto desce pra baixo dele; sem lugar = HEADLINE_NO_ROOM', () => {
    const semRosto = buildHeadlineInput(spec({ mode: 'add', text: 'Seu inglês trava?', highlight: null, language: 'pt' }), ctx([], false)).textLayers[0];
    expect(semRosto.background).toMatchObject({ kind: 'solid', color: '#0008FF' });
    expect(semRosto.style).toMatchObject({ fontId: 'montserrat-800', uppercase: true, color: '#ffffff' });
    // rosto alto (começa logo abaixo da faixa preta): a faixa no topo da área segura cobriria a testa → desce pra baixo do rosto
    const rostoAlto = ctx([], true, -0.05);
    const comRosto = buildHeadlineInput(spec({ mode: 'add', text: 'Seu inglês trava?', highlight: null, language: 'pt' }), rostoAlto).textLayers[0];
    expect(comRosto.background.box!.y).toBeGreaterThan(semRosto.background.box!.y + 200);
    // rosto ocupando quase tudo: não há lugar fora dele
    const enorme = ctx([], true, -0.2);
    (enorme.editMap as unknown as { faceTrack: { faceInRegion: { box: { h: number } }[] }[] }).faceTrack[0].faceInRegion[0].box.h = 1.3;
    expect(() => buildHeadlineInput(spec({ mode: 'add', text: 'Seu inglês trava?', highlight: null, language: 'pt' }), enorme)).toThrow(/HEADLINE_NO_ROOM/);
  });
  it('legenda automática: karaokê embaixo, fora da faixa nova; zh = 6 por página', () => {
    const captions = { words: [...'上次有個學生跟我說'].map((w, k) => ({ word: w, startSec: k * 0.3, endSec: k * 0.3 + 0.25 })), highlightColor: '#0008FF', language: 'zh-TW' };
    const i = buildHeadlineInput(spec({ mode: 'add', text: 'Seu inglês trava?', highlight: null, captions }), ctx([], false));
    const leg = i.textLayers.find((l) => l.id === 'legenda-auto')!;
    expect(leg.content).toMatchObject({ kind: 'karaoke', wordsPerPage: 6 });
    expect(leg.box.y).toBeGreaterThan(640);
  });
  it('apoios', () => {
    expect(marcarDestaque('a b c', 'b')).toBe('a *b* c');
    expect(marcarDestaque('a b c', 'x')).toBe('a b c');
    expect(razaoContraste('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});
