// headline-e-legenda-v1 §1.3: buildHeadlineInput (puro) — faixa repintada, placa sobre o vídeo, faixa adicionada, ajuste.
import { propsDeRemixInput } from '@maquina/video';
import type { AutoEditContext } from './auto-edit';
import { alphaDaCor, buildHeadlineInput, corOpaca, HeadlineError, marcarDestaque, razaoContraste, type HeadlineSpec } from './headline';

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
  it('sobre o vídeo: placa da cor medida cobrindo a caixa antiga, mesmo estilo, destaque marcado, mesmo intervalo; valida no remix-keep', () => {
    const i = buildHeadlineInput(spec({ plateColor: '#101010' }), ctx([camada()]));
    expect(i).toMatchObject({ kind: 'remix-keep', canvas: { width: 720, height: 1280, fps: 30, frameCount: 300 }, baseVideoUrl: 'https://s3/c.mp4', audioPassthroughUrl: 'https://s3/c.mp4', overlays: [], language: 'zh-TW' });
    const l = i.textLayers[0];
    expect(l.background).toMatchObject({ kind: 'solid', color: '#101010' });
    const placa = l.background.box!;
    expect(placa.x <= 58 && placa.y <= 96 && placa.x + placa.w >= 663 && placa.y + placa.h >= 173).toBe(true);
    expect(l.style).toMatchObject({ fontId: 'inter-800', color: '#FFFFFF', highlightColor: '#FF5FAE', strokeColor: '#E0207F' });
    expect(l.style.fontSizePx).toBeGreaterThanOrEqual(33 * 0.8);
    expect(l.content).toEqual({ kind: 'static', text: '你跟外國同事說過 *I\'m not convenient* 嗎？' });
    expect(() => propsDeRemixInput(i as never)).not.toThrow();
  });
  it('placa com contraste baixo vira preto OPACO (texto claro) — H1 + F11', () => {
    expect(buildHeadlineInput(spec({ plateColor: '#F0F0F0' }), ctx([camada()])).textLayers[0].background.color).toBe('#000000');
  });
  it('F11 (28/10): no replace a placa tem alpha 1 e cobre a caixa da headline original, em todo caminho da cor', () => {
    const orig = { x: 58, y: 96, w: 605, h: 77 };
    const casos: { plateColor?: string; texto?: string; cor?: string }[] = [
      {}, // sem plateColor: fallback
      { plateColor: '#F0F0F0' }, // contraste < 3 com texto branco: fallback preto
      { plateColor: '#101010' },
      { plateColor: 'rgba(16,16,16,0.6)' }, // medida translúcida: vira opaca
      { plateColor: '#10101080' },
      { cor: '#111111', plateColor: '#202020' }, // texto escuro, contraste baixo: fallback branco
    ];
    for (const c of casos) {
      const st = c.cor ? { ...estilo, color: c.cor, strokeColor: null, strokeWidthPx: 0 } : estilo;
      const l = buildHeadlineInput(spec({ plateColor: c.plateColor }), ctx([camada({ style: st })])).textLayers[0];
      expect(l.background.kind).toBe('solid');
      expect(alphaDaCor(l.background.color!)).toBe(1);
      const p = l.background.box!;
      expect(p.x <= orig.x && p.y <= orig.y && p.x + p.w >= orig.x + orig.w && p.y + p.h >= orig.y + orig.h).toBe(true);
    }
    // faixa da original translúcida: repintada opaca (o texto antigo não atravessa)
    const f = buildHeadlineInput(spec(), ctx([camada({ background: { kind: 'solid', color: 'rgba(240,8,0,0.7)', box: { x: 0, y: 80, w: 720, h: 110 } } })])).textLayers[0];
    expect(f.background.color).toBe('rgb(240, 8, 0)');
    expect(alphaDaCor(f.background.color!)).toBe(1);
  });
  it('corOpaca / alphaDaCor: rgba, hsla, #rrggbbaa, sintaxe com barra e degradê', () => {
    expect(alphaDaCor('rgba(0,0,0,0.85)')).toBeCloseTo(0.85);
    expect(corOpaca('rgba(0,0,0,0.85)')).toBe('rgb(0, 0, 0)');
    expect(corOpaca('hsla(10, 50%, 40%, .3)')).toBe('hsl(10, 50%, 40%)');
    expect(corOpaca('rgb(10 20 30 / 50%)')).toBe('rgb(10, 20, 30)');
    expect(corOpaca('#10101080')).toBe('#101010');
    expect(corOpaca('#ffffff')).toBe('#ffffff');
    const grad = corOpaca('linear-gradient(180deg, rgba(240,8,0,0.5) 0px, #4f040380 140px)');
    expect(grad).toBe('linear-gradient(180deg, rgb(240, 8, 0) 0px, #4f0403 140px)');
    expect(alphaDaCor(grad)).toBe(1);
  });
  it('faixa sólida: repinta a faixa inteira com a cor medida (degradê também)', () => {
    const grad = 'linear-gradient(180deg, #f00800 0px, #4f0403 140px)';
    const l = buildHeadlineInput(spec(), ctx([camada({ background: { kind: 'solid', color: grad, box: { x: 0, y: 80, w: 720, h: 110 } } })])).textLayers[0];
    expect(l.background).toEqual({ kind: 'solid', color: grad, box: { x: 0, y: 80, w: 720, h: 110 } });
  });
  it('texto longo demais pra caixa (+1 linha, ≥ 80 %) = HEADLINE_TOO_LONG', () => {
    expect(() => buildHeadlineInput(spec({ text: '這是一個非常非常長的標題'.repeat(8), highlight: null }), ctx([camada()]))).toThrow(HeadlineError);
  });
  it('sem camada com fonte do catálogo = HEADLINE_LOW_CONFIDENCE', () => {
    expect(() => buildHeadlineInput(spec(), ctx([]))).toThrow(/HEADLINE_LOW_CONFIDENCE/);
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
    const i = buildHeadlineInput(spec({ plateColor: '#101010', captions }), ctx([camada()]));
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
