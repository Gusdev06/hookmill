// contentBox/burnedTextBands com o editMap REAL do campeão do lote cmvnlm4yd000l22emdoob1j5a (720×1280: headline 0-187 px,
// vídeo 187-1120, campo preto 1120-1280; legenda queimada em 624-818 e CTA "馬上點擊貼文連結" em 986-1050), lido do banco local em 25/10.
import type { EditMap } from '@maquina/contratos';
import { burnedTextBandsOf, championContentOf, contentBoxOf } from './conteudo-campeao';

const VIDEO = { h: 933, w: 720, x: 0, y: 187 };
const REAL = {
  version: 1, width: 720, height: 1280, fps: 29.97, frameCount: 2544,
  cells: [{ startFrame: 0, endFrame: 2544, cells: [{ h: 135, w: 720, x: 0, y: 0 }, { h: 52, w: 720, x: 0, y: 135 }, VIDEO, { h: 160, w: 720, x: 0, y: 1120 }] }],
  faceTrack: [
    { region: VIDEO, startFrame: 0, endFrame: 111, fullFrame: false },
    { region: VIDEO, startFrame: 179, endFrame: 978, fullFrame: false },
    { region: VIDEO, startFrame: 1069, endFrame: 1667, fullFrame: false },
    { region: VIDEO, startFrame: 1746, endFrame: 2544, fullFrame: false },
  ],
  layers: [
    { id: 'h', kind: 'headline', startFrame: 0, endFrame: 2544, box: { h: 77, w: 605, x: 58, y: 96 }, background: { kind: 'none', color: null, box: null }, style: {}, text: '「我不方便」' },
    { id: 'c', kind: 'caption', startFrame: 0, endFrame: 2537, box: { h: 194, w: 689, x: 0, y: 624 }, background: { kind: 'none', color: null, box: null }, style: {}, text: null },
    { id: 't', kind: 'text', startFrame: 1828, endFrame: 2544, box: { h: 64, w: 461, x: 130, y: 986 }, background: { kind: 'none', color: null, box: null }, style: {}, text: '馬上點擊貼文連結' },
  ],
  overlaysOverFace: [], profile: null,
} as unknown as EditMap;

describe('contentBox e burnedTextBands (feedback do Gusta 25/10)', () => {
  it('campeão real: o vídeo é a célula 0,187 720×933 (sem a headline de cima nem o campo preto de baixo)', () => {
    expect(contentBoxOf(REAL, { width: 720, height: 1280 })).toEqual({ contentBox: VIDEO, contentBoxSource: 'face_track' });
    const c = championContentOf(REAL, { width: 720, height: 1280 });
    // a headline (96-173) fica fora; a legenda e o CTA queimados ficam, como faixa da largura do vídeo
    const s = (f: number) => Math.round((f / 29.97) * 1000) / 1000;
    expect(c.burnedTextBands).toEqual([
      { kind: 'caption', box: { x: 0, y: 624, w: 720, h: 194 }, startSec: 0, endSec: s(2537) },
      { kind: 'text', box: { x: 0, y: 986, w: 720, h: 64 }, startSec: s(1828), endSec: s(2544) },
    ]);
  });
  it('sem rosto: maior célula do trecho mais longo; sem nada: quadro inteiro; célula pequena não conta', () => {
    expect(contentBoxOf({ ...REAL, faceTrack: [] }, { width: 720, height: 1280 })).toEqual({ contentBox: VIDEO, contentBoxSource: 'cells' });
    expect(contentBoxOf(null, { width: 1080, height: 1920 })).toEqual({ contentBox: { x: 0, y: 0, w: 1080, h: 1920 }, contentBoxSource: 'full_frame' });
    const soFaixa = { ...REAL, faceTrack: [], cells: [{ startFrame: 0, endFrame: 10, cells: [{ x: 0, y: 0, w: 720, h: 100 }] }] } as EditMap;
    expect(contentBoxOf(soFaixa, { width: 720, height: 1280 }).contentBoxSource).toBe('full_frame');
    expect(burnedTextBandsOf(null, VIDEO)).toEqual([]);
  });
});
